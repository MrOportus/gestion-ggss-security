'use strict';
/**
 * functions/src/phase4/assignVacancyReplacement.js
 * Fase 4 — Callable: assignVacancyReplacement
 *
 * Cubre una vacante dejada por un traslado asignando un reemplazante.
 */

const { HttpsError } = require('firebase-functions/v2/https');
const { detectConflicts, checkInsufficientRestForList } = require('./conflictService');
const { reevaluarContratoParaDestino } = require('./contractReevalService');

const ROLES_PERMITIDOS = ['admin', 'jefe_operaciones', 'supervisor'];
const DEFAULT_MIN_REST_HOURS = 8;

async function verificarPermisosUnicaSucursal(db, uid, sucursalId) {
  const userSnap = await db.collection('Colaboradores').doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'Usuario no encontrado.');
  }
  const role = userSnap.data().role;

  if (!ROLES_PERMITIDOS.includes(role)) {
    throw new HttpsError('permission-denied', `Rol '${role}' no autorizado para cubrir vacantes.`);
  }

  if (role === 'admin') return role;

  if (role === 'supervisor' || role === 'jefe_operaciones') {
    const alcanceSnap = await db.collection('AlcancesOperativos').doc(uid).get();
    if (!alcanceSnap.exists || !alcanceSnap.data().activo) {
      throw new HttpsError('permission-denied', 'No tiene alcance operativo activo.');
    }
    const data = alcanceSnap.data();
    if (data.alcanceNacional === true) return role;
    
    const sucursales = data.sucursalesAutorizadas || [];
    if (!sucursales.includes(sucursalId.toString())) {
      throw new HttpsError('permission-denied', `Sin alcance en sucursal de la vacante: ${sucursalId}.`);
    }
  }
  return role;
}

async function getOrCreateAssignacion(db, colaboradorId, sucursalId, mes, uid) {
  const assignId = `assignment_${colaboradorId}_${sucursalId}_${mes}`;
  const assignRef = db.collection('AsignacionesOperacionales').doc(assignId);

  return await db.runTransaction(async (t) => {
    const snap = await t.get(assignRef);
    if (snap.exists) return snap.data();

    const newAssign = {
      id: assignId,
      colaboradorId,
      sucursalId,
      mes,
      estado: 'activa',
      creadoEn: new Date().toISOString(),
      creadoPor: uid,
    };
    t.set(assignRef, newAssign);
    return newAssign;
  });
}

async function assignVacancyReplacementHandler(request) {
  const { auth, data } = request;

  if (!auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para asignar reemplazos.');
  }
  const uid = auth.uid;
  const {
    turnoOrigenTrasladadoId,
    colaboradorReemplazanteId,
    tipoOperacion, // ej: cobertura
    motivo,
    operationRequestId,
    minRestHours = DEFAULT_MIN_REST_HOURS,
    confirmInsufficientRest = false,
    restWarningMotivo = null,
  } = data;

  if (!turnoOrigenTrasladadoId || !colaboradorReemplazanteId || !tipoOperacion || !motivo || !operationRequestId) {
    throw new HttpsError('invalid-argument', 'Faltan parámetros requeridos.');
  }

  const db = require('firebase-admin').firestore();
  
  // 1. Obtener turno origen rápidamente para validar alcance (fuera de tx para fail-fast)
  const origenSnap = await db.collection('TurnosProgramados').doc(turnoOrigenTrasladadoId).get();
  if (!origenSnap.exists) {
    throw new HttpsError('not-found', 'Turno origen no encontrado.');
  }
  const origenBase = origenSnap.data();
  await verificarPermisosUnicaSucursal(db, uid, origenBase.sucursalId);

  const correlationId = operationRequestId;
  const nuevoTurnoId = `turno_repl_${correlationId}_${colaboradorReemplazanteId}_${turnoOrigenTrasladadoId}`;
  
  const txResult = await db.runTransaction(async (t) => {
    // 2. Re-leer origen en T
    const origenT = await t.get(db.collection('TurnosProgramados').doc(turnoOrigenTrasladadoId));
    if (!origenT.exists) throw new HttpsError('not-found', 'Turno origen no encontrado.');
    const origen = origenT.data();

    // 3. Validar estado y condiciones de la vacante
    if (origen.estado !== 'trasladado') {
      throw new HttpsError('failed-precondition', 'El turno no está en estado trasladado.');
    }
    if (origen.requiereCobertura !== true) {
      throw new HttpsError('failed-precondition', 'El turno no requiere cobertura o ya fue cubierto.');
    }
    if (origen.colaboradorId === colaboradorReemplazanteId) {
      throw new HttpsError('invalid-argument', 'El reemplazante no puede ser el mismo que fue trasladado.');
    }

    // Ya fue cubierto en una petición concurrente?
    if (origen.replacementShiftId) {
      return { status: 'already_covered', replacementShiftId: origen.replacementShiftId };
    }

    // 4. Verificar superposiciones del reemplazante
    const fecha = origen.fecha;
    const horario = origen.horarioSnapshot;
    
    const fechaObj = new Date(fecha + 'T12:00:00Z');
    const prevDate = new Date(fechaObj); prevDate.setDate(prevDate.getDate() - 1);
    const nextDate = new Date(fechaObj); nextDate.setDate(nextDate.getDate() + 1);
    const dStr = (d) => d.toISOString().split('T')[0];

    const turnosEnT = await t.get(
      db.collection('TurnosProgramados')
        .where('colaboradorId', '==', colaboradorReemplazanteId)
        .where('fecha', 'in', [dStr(prevDate), fecha, dStr(nextDate)])
    );

    const activeShifts = [];
    turnosEnT.forEach(doc => {
      const td = doc.data();
      if (['programado', 'ejecutado'].includes(td.estado)) {
        td.horario = td.horarioSnapshot || td.horario;
        activeShifts.push(td);
      }
    });

    const shiftCandidate = {
      fecha,
      horario: horario,
      sucursalId: origen.sucursalId,
    };

    const overlap = detectConflicts(shiftCandidate, activeShifts);
    if (overlap.type !== 'none') {
      return { status: 'conflict_blocked', overlap };
    }

    const restWarning = checkInsufficientRestForList(shiftCandidate, activeShifts, minRestHours);
    if (restWarning.hasWarning && !confirmInsufficientRest) {
      return { status: 'insufficient_rest_blocked', restWarning };
    }

    // 5. Crear el turno de reemplazo y actualizar el original
    const mes = fecha.substring(0, 7);
    const assignDestinoId = `assignment_${colaboradorReemplazanteId}_${origen.sucursalId}_${mes}`;
    const now = new Date().toISOString();

    const nuevoTurnoData = {
      id: nuevoTurnoId,
      asignacionOperacionalId: assignDestinoId,
      colaboradorId: colaboradorReemplazanteId,
      sucursalId: origen.sucursalId,
      fecha: origen.fecha,
      codigo: origen.codigo || 'X',
      horarioSnapshot: origen.horarioSnapshot,
      tipoOperacional: tipoOperacion || 'cobertura',
      estado: 'programado',
      esProductivo: origen.esProductivo ?? true,
      requiereAsistencia: origen.requiereAsistencia ?? true,
      estadoContratoVinculado: 'pendiente_revision',
      
      replacesShiftId: origen.id,
      coverageReason: motivo,
      createdAt: now,
      createdBy: uid,
      correlationId,
    };

    if (restWarning && confirmInsufficientRest) {
      nuevoTurnoData.restWarningIgnored = true;
      nuevoTurnoData.restWarningMotivo = restWarningMotivo;
    }

    t.set(db.collection('TurnosProgramados').doc(nuevoTurnoId), nuevoTurnoData);
    
    t.update(origenT.ref, {
      requiereCobertura: false,
      replacementShiftId: nuevoTurnoId,
      coveredAt: now,
      coveredBy: uid,
      modificadoEn: now,
      modificadoPor: uid,
    });

    return { status: 'created', turnoId: nuevoTurnoId, nuevoTurnoData };
  });

  if (txResult.status !== 'created') {
    return txResult;
  }

  const { turnoId, nuevoTurnoData } = txResult;

  // Post-Transacción
  const postBatch = db.batch();
  const mes = origenBase.fecha.substring(0, 7);
  await getOrCreateAssignacion(db, colaboradorReemplazanteId, origenBase.sucursalId, mes, uid);

  let contractAlert = null;
  try {
    const reevalResult = await reevaluarContratoParaDestino(db, {
      turnoDestinoId: turnoId,
      colaboradorId: colaboradorReemplazanteId,
      sucursalDestinoId: origenBase.sucursalId.toString(),
      fecha: origenBase.fecha,
      correlationId,
      usuarioId: uid,
    }, postBatch);

    if (reevalResult.alerta) {
      contractAlert = {
        turnoDestinoId: turnoId,
        estadoContratoVinculado: reevalResult.estado,
      };
    }
  } catch (reevalErr) {
    console.warn(`[assignVacancyReplacement] Error en reevaluación contractual para ${turnoId}:`, reevalErr.message);
  }

  // Auditoría
  try {
    const auditRef = db.collection('AuditoriaAcciones').doc();
    postBatch.set(auditRef, {
      accion: 'VACANCY_REPLACEMENT_ASSIGNED',
      entidad: 'TurnosProgramados',
      entidadId: turnoOrigenTrasladadoId,
      usuarioId: uid,
      fecha: new Date().toISOString(),
      motivo,
      contextoInfo: {
        replacesShiftId: turnoOrigenTrasladadoId,
        replacementShiftId: turnoId,
        colaboradorReemplazanteId,
        sucursalId: origenBase.sucursalId,
        fecha: origenBase.fecha,
        correlationId,
      },
    });
  } catch(e) {}

  await postBatch.commit();

  return {
    success: true,
    correlationId,
    operationRequestId,
    turnoOrigenTrasladadoId,
    replacementShiftId: turnoId,
    nuevoTurnoData,
    contractAlert,
  };
}

module.exports = { assignVacancyReplacementHandler };
