'use strict';
/**
 * functions/src/phase4/createAdditionalShift.js
 * Fase 4 — Callable: createAdditionalShift
 *
 * Crea un turno adicional para un colaborador.
 */

const { HttpsError } = require('firebase-functions/v2/https');
const { detectConflicts, checkInsufficientRestForList } = require('./conflictService');
const { reevaluarContratoParaDestino } = require('./contractReevalService');

const ROLES_PERMITIDOS = ['admin', 'jefe_operaciones', 'supervisor'];
const TIPOS_PERMITIDOS = ['extra', 'cobertura', 'emergencia'];
const DEFAULT_MIN_REST_HOURS = 8;

async function verificarPermisosUnicaSucursal(db, uid, sucursalId) {
  const userSnap = await db.collection('Colaboradores').doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'Usuario no encontrado.');
  }
  const role = userSnap.data().role;

  if (!ROLES_PERMITIDOS.includes(role)) {
    throw new HttpsError('permission-denied', `Rol '${role}' no autorizado para crear turnos adicionales.`);
  }

  if (role === 'admin') {
    return role;
  }

  if (role === 'supervisor' || role === 'jefe_operaciones') {
    const alcanceSnap = await db.collection('AlcancesOperativos').doc(uid).get();
    if (!alcanceSnap.exists || !alcanceSnap.data().activo) {
      throw new HttpsError('permission-denied', 'No tiene alcance operativo activo.');
    }
    const data = alcanceSnap.data();
    if (data.alcanceNacional === true) {
      return role;
    }
    const sucursales = data.sucursalesAutorizadas || [];
    if (!sucursales.includes(sucursalId.toString())) {
      throw new HttpsError('permission-denied', `Sin alcance en sucursal destino: ${sucursalId}.`);
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

async function createAdditionalShiftHandler(request) {
  const { auth, data } = request;

  if (!auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para crear turnos adicionales.');
  }
  const uid = auth.uid;
  const {
    colaboradorId,
    sucursalId,
    fecha,
    horario,
    tipoOperacion,
    motivo,
    operationRequestId,
    minRestHours = DEFAULT_MIN_REST_HOURS,
    confirmInsufficientRest = false,
    restWarningMotivo = null,
  } = data;

  if (!colaboradorId || !sucursalId || !fecha || !horario || !tipoOperacion || !motivo || !operationRequestId) {
    throw new HttpsError('invalid-argument', 'Faltan parámetros requeridos.');
  }

  if (!TIPOS_PERMITIDOS.includes(tipoOperacion)) {
    throw new HttpsError('invalid-argument', `tipoOperacion '${tipoOperacion}' no es válido.`);
  }

  const db = require('firebase-admin').firestore();
  await verificarPermisosUnicaSucursal(db, uid, sucursalId);

  // Determinar ID determinista para idempotencia
  const correlationId = operationRequestId;
  const turnoId = `turno_add_${correlationId}_${colaboradorId}_${fecha}`;
  const turnoRef = db.collection('TurnosProgramados').doc(turnoId);

  // Ejecutar Transacción para prevenir condiciones de carrera
  const txResult = await db.runTransaction(async (t) => {
    const turnoSnap = await t.get(turnoRef);
    if (turnoSnap.exists) {
      return { status: 'already_exists', turnoId, turnoData: turnoSnap.data() };
    }

    // Buscar superposiciones
    // Necesitamos consultar todos los turnos del colaborador (ayer, hoy, mañana)
    const fechaObj = new Date(fecha + 'T12:00:00Z');
    const prevDate = new Date(fechaObj); prevDate.setDate(prevDate.getDate() - 1);
    const nextDate = new Date(fechaObj); nextDate.setDate(nextDate.getDate() + 1);
    const dStr = (d) => d.toISOString().split('T')[0];

    const turnosEnT = await t.get(
      db.collection('TurnosProgramados')
        .where('colaboradorId', '==', colaboradorId)
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
      sucursalId
    };

    const overlap = detectConflicts(shiftCandidate, activeShifts);
    if (overlap.type !== 'none') {
      return { status: 'conflict_blocked', overlap };
    }

    const restWarning = checkInsufficientRestForList(shiftCandidate, activeShifts, minRestHours);
    if (restWarning.hasWarning && !confirmInsufficientRest) {
      return { status: 'insufficient_rest_blocked', restWarning };
    }

    const mes = fecha.substring(0, 7);
    const assignDestinoId = `assignment_${colaboradorId}_${sucursalId}_${mes}`;

    const now = new Date().toISOString();
    const turnoData = {
      id: turnoId,
      asignacionOperacionalId: assignDestinoId,
      colaboradorId,
      sucursalId: sucursalId.toString(),
      fecha,
      codigo: 'X', // Genérico, puede ser sobreescrito si mandan codigo
      horarioSnapshot: horario,
      tipoOperacional: tipoOperacion,
      estado: 'programado',
      esProductivo: true,
      requiereAsistencia: true,
      estadoContratoVinculado: 'pendiente_revision',
      
      additionalReason: motivo,
      createdAt: now,
      createdBy: uid,
      correlationId,
    };

    if (data.codigo) turnoData.codigo = data.codigo;

    if (restWarning && confirmInsufficientRest) {
      turnoData.restWarningIgnored = true;
      turnoData.restWarningMotivo = restWarningMotivo;
    }

    t.set(turnoRef, turnoData);
    return { status: 'created', turnoId, turnoData };
  });

  if (txResult.status !== 'created') {
    return txResult;
  }

  const turnoData = txResult.turnoData;

  // Post-Transacción
  const postBatch = db.batch();
  const mes = fecha.substring(0, 7);
  await getOrCreateAssignacion(db, colaboradorId, sucursalId, mes, uid);

  let contractAlert = null;
  try {
    const reevalResult = await reevaluarContratoParaDestino(db, {
      turnoDestinoId: turnoId,
      colaboradorId,
      sucursalDestinoId: sucursalId.toString(),
      fecha,
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
    console.warn(`[createAdditionalShift] Error en reevaluación contractual para ${turnoId}:`, reevalErr.message);
  }

  // Auditoría
  try {
    const auditRef = db.collection('AuditoriaAcciones').doc();
    postBatch.set(auditRef, {
      accion: 'ADDITIONAL_SHIFT_CREATED',
      entidad: 'TurnosProgramados',
      entidadId: turnoId,
      usuarioId: uid,
      fecha: new Date().toISOString(),
      motivo,
      contextoInfo: {
        colaboradorId,
        sucursalId,
        fecha,
        tipoOperacion,
        correlationId,
      },
    });
  } catch(e) {}

  await postBatch.commit();

  return {
    success: true,
    correlationId,
    operationRequestId,
    turnoId,
    turnoData,
    contractAlert,
  };
}

module.exports = { createAdditionalShiftHandler };
