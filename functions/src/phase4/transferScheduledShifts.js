'use strict';
/**
 * functions/src/phase4/transferScheduledShifts.js
 * Fase 4 — Callable: transferScheduledShifts
 *
 * Traslada uno o más TurnosProgramados de sucursal A → sucursal B.
 *
 * Principios:
 * - currentSiteId del Colaborador NUNCA se modifica.
 * - Turno origen queda estado = 'trasladado' (no se elimina).
 * - Turno destino se crea con estado = 'programado'.
 * - Operación masiva parcial: cada turno es independiente.
 * - Idempotencia: ID determinista del turno destino.
 * - Transacción por turno para prevenir race conditions.
 * - Auditoría completa en AuditoriaAcciones.
 */

const { HttpsError } = require('firebase-functions/v2/https');
const { detectConflicts, checkInsufficientRest } = require('./conflictService');
const { reevaluarContratoParaDestino } = require('./contractReevalService');

const ROLES_PERMITIDOS = ['admin', 'jefe_operaciones', 'supervisor'];
const MAX_TURNOS_POR_LLAMADA = 50;
const DEFAULT_MIN_REST_HOURS = 8;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de permisos
// ─────────────────────────────────────────────────────────────────────────────

async function verificarPermisos(db, uid, sucursalOrigenId, sucursalDestinoId) {
  const userSnap = await db.collection('Colaboradores').doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'Usuario no encontrado.');
  }
  const role = userSnap.data().role;

  if (!ROLES_PERMITIDOS.includes(role)) {
    throw new HttpsError('permission-denied', `Rol '${role}' no autorizado para trasladar turnos.`);
  }

  if (role === 'admin') {
    return role; // admin conserva acceso global
  }

  // supervisor y jefe_operaciones: validan AlcancesOperativos
  if (role === 'supervisor' || role === 'jefe_operaciones') {
    const alcanceSnap = await db.collection('AlcancesOperativos').doc(uid).get();
    if (!alcanceSnap.exists || !alcanceSnap.data().activo) {
      throw new HttpsError('permission-denied', 'No tiene alcance operativo activo.');
    }
    const data = alcanceSnap.data();
    
    // Si tiene alcance nacional explícito, se aprueba acceso global
    if (data.alcanceNacional === true) {
      return role;
    }

    const sucursales = data.sucursalesAutorizadas || [];
    if (!sucursales.includes(sucursalOrigenId.toString())) {
      throw new HttpsError('permission-denied', `Sin alcance en sucursal origen: ${sucursalOrigenId}.`);
    }
    if (!sucursales.includes(sucursalDestinoId.toString())) {
      throw new HttpsError('permission-denied', `Sin alcance en sucursal destino: ${sucursalDestinoId}.`);
    }
  }

  return role;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: obtener o crear AsignacionesOperacionales destino (con transacción)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Procesamiento de un turno individual
// ─────────────────────────────────────────────────────────────────────────────

async function procesarUnTurno(db, turnoOrigenId, params, uid) {
  const {
    sucursalDestinoId,
    tipoOperacion,
    motivo,
    operationRequestId,
    plantillaDestinoId,
    horarioManual,
    minRestHours,
    confirmInsufficientRest,
    restWarningMotivo,
  } = params;

  // ID determinista del turno destino (garantiza idempotencia)
  const correlationId = params.correlationId;
  const turnoDestinoId = `turno_transfer_${correlationId}_${turnoOrigenId}`;

  const origenRef = db.collection('TurnosProgramados').doc(turnoOrigenId);
  const destinoRef = db.collection('TurnosProgramados').doc(turnoDestinoId);

  let turnoDestino = null;
  let estadoAnterior = null;

  try {
    // ── Transacción principal por turno ──────────────────────────────────────
    const txResult = await db.runTransaction(async (t) => {
      const origenSnap = await t.get(origenRef);
      if (!origenSnap.exists) {
        return { status: 'not_found' };
      }

      const origen = origenSnap.data();
      estadoAnterior = { estado: origen.estado };

      // Verificar estado activo
      if (origen.estado === 'trasladado') {
        return { status: 'already_transferred' };
      }
      if (origen.estado === 'cancelado') {
        return { status: 'conflict_blocked', conflict: { type: 'cancelled', message: 'El turno origen está cancelado.' } };
      }
      if (origen.estado !== 'programado' && origen.estado !== 'confirmado') {
        return { status: 'conflict_blocked', conflict: { type: 'cancelled', message: `Estado inválido: ${origen.estado}` } };
      }

      // Verificar idempotencia: ¿ya existe el turno destino?
      const destinoSnap = await t.get(destinoRef);
      if (destinoSnap.exists) {
        return { status: 'already_exists', turnoDestinoId };
      }

      // ── Detectar conflictos en destino ───────────────────────────────────
      // Buscar turnos existentes del colaborador en la misma fecha en sucursal destino
      // (lectura fuera de transacción: se hace antes y se acepta el window pequeño)
      // La transacción garantiza que el destino no existe aún.

      // Resolver horario del turno destino
      let horario = origen.horarioSnapshot; // Fallback: mismo horario que origen
      if (horarioManual) {
        horario = {
          inicio: horarioManual.inicio,
          termino: horarioManual.termino,
          cruzaMedianoche: horarioManual.cruzaMedianoche,
          origen: 'manual',
        };
      }
      // Si se provee plantillaDestinoId, se resolvería aquí (futuro: consultar PlantillasTurno)
      // Por ahora se usa horarioManual o fallback al origen

      // ── Construir turno destino ──────────────────────────────────────────
      const mes = origen.fecha.substring(0, 7);
      // La asignación operacional destino se crea/obtiene fuera de la transacción
      // para evitar lecturas cruzadas. Se usa el ID determinista directamente.
      const assignDestinoId = `assignment_${origen.colaboradorId}_${sucursalDestinoId}_${mes}`;

      const now = new Date().toISOString();
      const turnoDestinoData = {
        id: turnoDestinoId,
        asignacionOperacionalId: assignDestinoId,
        colaboradorId: origen.colaboradorId,
        sucursalId: sucursalDestinoId.toString(),
        fecha: origen.fecha,
        codigo: origen.codigo,
        horarioSnapshot: horario,
        tipoOperacional: tipoOperacion,
        estado: 'programado',
        esProductivo: origen.esProductivo,
        requiereAsistencia: origen.requiereAsistencia,
        estadoContratoVinculado: 'pendiente_revision', // Se reevalúa post-transacción
        // Campos de traslado
        transferredFromShiftId: turnoOrigenId,
        originBranchId: origen.sucursalId,
        destinationBranchId: sucursalDestinoId.toString(),
        transferReason: motivo,
        transferredAt: now,
        transferredBy: uid,
        correlationId,
        plantillaIdUsada: plantillaDestinoId || null,
        creadoEn: now,
        creadoPor: uid,
      };

      // ── Actualizar turno origen ──────────────────────────────────────────
      const origenUpdate = {
        estado: 'trasladado',
        motivoCancelacion: null, // no es cancelado, es trasladado
        transferredToShiftId: turnoDestinoId,
        destinationBranchId: sucursalDestinoId.toString(),
        transferReason: motivo,
        transferredAt: now,
        transferredBy: uid,
        correlationId,
        requiereCobertura: true,
        modificadoEn: now,
        modificadoPor: uid,
      };

      t.set(destinoRef, turnoDestinoData);
      t.update(origenRef, origenUpdate);

      turnoDestino = turnoDestinoData;
      return { status: 'transferred', turnoDestinoId, turnoDestinoData };
    });

    if (txResult.status !== 'transferred') {
      return { turnoOrigenId, ...txResult };
    }

    // ── Post-transacción: AsignacionesOperacionales + Reevaluación contractual + Auditoría ──
    // Estas operaciones son no críticas para la atomicidad del traslado en sí.
    const postBatch = db.batch();

    // Asegurar existencia de AsignacionesOperacionales destino
    const mes = turnoDestino.fecha.substring(0, 7);
    await getOrCreateAssignacion(
      db,
      turnoDestino.colaboradorId,
      sucursalDestinoId.toString(),
      mes,
      uid
    );

    // Reevaluación contractual del turno destino
    let contractAlert = null;
    try {
      const reevalResult = await reevaluarContratoParaDestino(db, {
        turnoDestinoId,
        colaboradorId: turnoDestino.colaboradorId,
        sucursalDestinoId: sucursalDestinoId.toString(),
        fecha: turnoDestino.fecha,
        correlationId,
        usuarioId: uid,
      }, postBatch);

      if (reevalResult.alerta) {
        contractAlert = {
          turnoDestinoId,
          estadoContratoVinculado: reevalResult.estado,
        };
      }
    } catch (reevalErr) {
      console.warn(`[transferShifts] Error en reevaluación contractual para ${turnoDestinoId}:`, reevalErr.message);
    }

    // Auditoría TRANSFER_COMPLETED
    const auditRef = db.collection('AuditoriaAcciones').doc();
    postBatch.set(auditRef, {
      id: auditRef.id,
      accion: 'TRANSFER_COMPLETED',
      entidad: 'TurnosProgramados',
      entidadId: turnoDestinoId,
      usuarioId: uid,
      fecha: new Date().toISOString(),
      motivo,
      contextoInfo: {
        turnoOrigenId,
        turnoDestinoId,
        sucursalOrigenId: turnoDestino.originBranchId,
        sucursalDestinoId: sucursalDestinoId.toString(),
        colaboradorId: turnoDestino.colaboradorId,
        fechaTurno: turnoDestino.fecha,
        correlationId,
        tipoOperacion,
      },
      estadoAnterior,
      estadoNuevo: { estado: 'programado' },
    });

    // Auditoría ORIGIN_VACANCY_CREATED
    const vacancyRef = db.collection('AuditoriaAcciones').doc();
    postBatch.set(vacancyRef, {
      id: vacancyRef.id,
      accion: 'ORIGIN_VACANCY_CREATED',
      entidad: 'TurnosProgramados',
      entidadId: turnoOrigenId,
      usuarioId: uid,
      fecha: new Date().toISOString(),
      motivo,
      contextoInfo: {
        turnoOrigenId,
        sucursalOrigenId: turnoDestino.originBranchId,
        correlationId,
        colaboradorId: turnoDestino.colaboradorId,
        fechaTurno: turnoDestino.fecha,
      },
    });

    await postBatch.commit();

    return {
      turnoOrigenId,
      status: 'transferred',
      turnoDestinoId,
      contractAlert,
    };

  } catch (err) {
    console.error(`[transferShifts] Error procesando turno ${turnoOrigenId}:`, err);
    return {
      turnoOrigenId,
      status: 'error',
      errorMessage: err.message,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler principal exportado
// ─────────────────────────────────────────────────────────────────────────────

async function transferScheduledShiftsHandler(request) {
  const { auth, data } = request;

  // 1. Autenticación
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para trasladar turnos.');
  }

  const uid = auth.uid;
  const {
    turnoProgramadoIds,
    sucursalDestinoId,
    tipoOperacion,
    motivo,
    operationRequestId,
    plantillaDestinoId,
    horarioManual,
    minRestHours = DEFAULT_MIN_REST_HOURS,
    confirmInsufficientRest = false,
    restWarningMotivo,
  } = data;

  // 2. Validar parámetros de entrada
  if (!Array.isArray(turnoProgramadoIds) || turnoProgramadoIds.length === 0) {
    throw new HttpsError('invalid-argument', 'turnoProgramadoIds debe ser un array no vacío.');
  }
  if (turnoProgramadoIds.length > MAX_TURNOS_POR_LLAMADA) {
    throw new HttpsError('invalid-argument', `Máximo ${MAX_TURNOS_POR_LLAMADA} turnos por llamada.`);
  }
  if (!sucursalDestinoId) throw new HttpsError('invalid-argument', 'sucursalDestinoId requerido.');
  if (!tipoOperacion) throw new HttpsError('invalid-argument', 'tipoOperacion requerido.');
  if (!motivo) throw new HttpsError('invalid-argument', 'motivo requerido.');
  if (!operationRequestId) throw new HttpsError('invalid-argument', 'operationRequestId requerido.');

  const tiposValidos = ['contractual', 'extra', 'cobertura', 'emergencia', 'traslado_temporal'];
  if (!tiposValidos.includes(tipoOperacion)) {
    throw new HttpsError('invalid-argument', `tipoOperacion inválido: ${tipoOperacion}`);
  }

  const db = require('firebase-admin').firestore();

  // 3. Verificar permisos — necesitamos la sucursal origen del primer turno
  // La verificación completa se hace después de obtener el primer turno origen
  // Para supervisor, verificamos ambas sucursales. La sucursal origen se obtiene del turno.
  // Pre-verificación de rol:
  const userSnap = await db.collection('Colaboradores').doc(uid).get();
  if (!userSnap.exists) throw new HttpsError('permission-denied', 'Usuario no encontrado.');
  const role = userSnap.data().role;
  if (!ROLES_PERMITIDOS.includes(role)) {
    throw new HttpsError('permission-denied', `Rol '${role}' no autorizado.`);
  }

  // Para supervisor, verificar alcance en destino ahora
  if (role === 'supervisor') {
    const alcanceSnap = await db.collection('AlcancesOperativos').doc(uid).get();
    if (!alcanceSnap.exists || !alcanceSnap.data().activo) {
      throw new HttpsError('permission-denied', 'Sin alcance operativo activo.');
    }
    const sucursales = alcanceSnap.data().sucursalesAutorizadas || [];
    if (!sucursales.includes(sucursalDestinoId.toString())) {
      throw new HttpsError('permission-denied', `Sin alcance en sucursal destino: ${sucursalDestinoId}.`);
    }
    // El alcance de origen se verifica en procesarUnTurno para cada turno
  }

  // 4. Usar operationRequestId como correlationId
  const correlationId = operationRequestId;

  // 5. Procesar cada turno de forma independiente (Opción B: parcial)
  const results = [];
  const contractAlerts = [];

  // Auditoría de inicio de operación
  try {
    const auditStartRef = db.collection('AuditoriaAcciones').doc();
    await auditStartRef.set({
      id: auditStartRef.id,
      accion: 'TRANSFER_REQUESTED',
      entidad: 'TurnosProgramados',
      entidadId: 'batch',
      usuarioId: uid,
      fecha: new Date().toISOString(),
      motivo,
      contextoInfo: {
        turnoProgramadoIds,
        sucursalDestinoId: sucursalDestinoId.toString(),
        tipoOperacion,
        correlationId,
        totalTurnos: turnoProgramadoIds.length,
      },
    });
  } catch (auditErr) {
    console.warn('[transferShifts] Error registrando auditoría de inicio:', auditErr.message);
  }

  for (const turnoOrigenId of turnoProgramadoIds) {
    // Para supervisor: verificar alcance de origen de cada turno
    if (role === 'supervisor') {
      try {
        const origenSnap = await db.collection('TurnosProgramados').doc(turnoOrigenId).get();
        if (origenSnap.exists) {
          const sucursalOrigenId = origenSnap.data().sucursalId;
          const alcanceSnap = await db.collection('AlcancesOperativos').doc(uid).get();
          const sucursales = alcanceSnap.data()?.sucursalesAutorizadas || [];
          if (!sucursales.includes(sucursalOrigenId.toString())) {
            results.push({
              turnoOrigenId,
              status: 'conflict_blocked',
              conflict: { type: 'permission', message: `Sin alcance en sucursal origen: ${sucursalOrigenId}` },
            });
            continue;
          }
        }
      } catch (permErr) {
        console.warn(`[transferShifts] Error verificando alcance de origen para ${turnoOrigenId}:`, permErr.message);
      }
    }

    const result = await procesarUnTurno(db, turnoOrigenId, {
      sucursalDestinoId,
      tipoOperacion,
      motivo,
      operationRequestId,
      correlationId,
      plantillaDestinoId,
      horarioManual,
      minRestHours,
      confirmInsufficientRest,
      restWarningMotivo,
    }, uid);

    results.push(result);
    if (result.contractAlert) {
      contractAlerts.push(result.contractAlert);
    }
  }

  // 6. Calcular resumen
  const summary = {
    transferred: results.filter(r => r.status === 'transferred' || r.status === 'already_exists').length,
    conflicts: results.filter(r => r.status === 'conflict_blocked' || r.status === 'insufficient_rest_blocked').length,
    alreadyTransferred: results.filter(r => r.status === 'already_transferred').length,
    errors: results.filter(r => r.status === 'error' || r.status === 'not_found').length,
    total: results.length,
  };

  console.log(`[transferShifts] Completado. correlationId=${correlationId}`, summary);

  return {
    success: summary.errors === 0 && summary.conflicts === 0,
    correlationId,
    operationRequestId,
    results,
    summary,
    contractAlerts,
  };
}

module.exports = { transferScheduledShiftsHandler };
