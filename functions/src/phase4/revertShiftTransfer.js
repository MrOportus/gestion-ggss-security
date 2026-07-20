'use strict';
/**
 * functions/src/phase4/revertShiftTransfer.js
 * Fase 4 — Callable: revertShiftTransfer
 *
 * Revierte un traslado previamente ejecutado.
 * - No elimina documentos físicamente.
 * - Turno destino queda cancelado con motivoCancelacion = 'traslado_revertido'.
 * - Turno origen vuelve a 'programado'.
 * - Si existe asistencia en la fecha+colaborador del destino → bloqueo administrativo.
 *
 * Limitación documentada (Fase 4):
 *   El campo shiftId en Asistencia referencia programacion (legacy), no TurnosProgramados.
 *   La verificación de asistencia se hace por fecha+colaboradorId, lo que puede
 *   generar falsos positivos. Se refina en Fase 5.
 */

const { HttpsError } = require('firebase-functions/v2/https');

const ROLES_PERMITIDOS = ['admin', 'jefe_operaciones'];

async function revertShiftTransferHandler(request) {
  const { auth, data } = request;

  // 1. Autenticación
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para revertir un traslado.');
  }

  const uid = auth.uid;
  const { turnoOrigenId, motivo } = data;

  if (!turnoOrigenId) throw new HttpsError('invalid-argument', 'turnoOrigenId requerido.');
  if (!motivo) throw new HttpsError('invalid-argument', 'motivo requerido.');

  const db = require('firebase-admin').firestore();

  // 2. Verificar rol
  const userSnap = await db.collection('Colaboradores').doc(uid).get();
  if (!userSnap.exists) throw new HttpsError('permission-denied', 'Usuario no encontrado.');
  const role = userSnap.data().role;
  if (!ROLES_PERMITIDOS.includes(role)) {
    throw new HttpsError('permission-denied', `Rol '${role}' no autorizado para revertir traslados.`);
  }

  // 3. Obtener turno origen y destino temprano para validar alcances si es jefe_operaciones
  const origenRef = db.collection('TurnosProgramados').doc(turnoOrigenId);
  const origenSnap = await origenRef.get();

  if (!origenSnap.exists) {
    throw new HttpsError('not-found', `Turno origen ${turnoOrigenId} no encontrado.`);
  }

  const origen = origenSnap.data();

  if (role === 'jefe_operaciones') {
    const alcanceSnap = await db.collection('AlcancesOperativos').doc(uid).get();
    if (!alcanceSnap.exists || !alcanceSnap.data().activo) {
      throw new HttpsError('permission-denied', 'No tiene alcance operativo activo.');
    }
    const data = alcanceSnap.data();
    if (data.alcanceNacional !== true) {
      const sucursales = data.sucursalesAutorizadas || [];
      if (!sucursales.includes(origen.sucursalId.toString())) {
        throw new HttpsError('permission-denied', `Sin alcance en sucursal origen.`);
      }
      if (origen.destinationBranchId && !sucursales.includes(origen.destinationBranchId.toString())) {
        throw new HttpsError('permission-denied', `Sin alcance en sucursal destino.`);
      }
    }
  }

  // 4. Verificar estado del turno origen
  if (origen.estado !== 'trasladado') {
    return {
      success: false,
      turnoOrigenId,
      turnoDestinoId: null,
      blocked: true,
      blockReason: 'origin_not_transferred',
      errorMessage: `El turno origen tiene estado '${origen.estado}', no 'trasladado'.`,
    };
  }

  // 5. Obtener turno destino
  const turnoDestinoId = origen.transferredToShiftId;
  if (!turnoDestinoId) {
    return {
      success: false,
      turnoOrigenId,
      turnoDestinoId: null,
      blocked: true,
      blockReason: 'no_relation',
      errorMessage: 'El turno origen no tiene referencia a turno destino (transferredToShiftId ausente).',
    };
  }

  const destinoRef = db.collection('TurnosProgramados').doc(turnoDestinoId);
  const destinoSnap = await destinoRef.get();

  if (!destinoSnap.exists) {
    throw new HttpsError('not-found', `Turno destino ${turnoDestinoId} no encontrado.`);
  }

  const destino = destinoSnap.data();

  // 6. Verificar relación bidireccional
  if (destino.transferredFromShiftId !== turnoOrigenId) {
    return {
      success: false,
      turnoOrigenId,
      turnoDestinoId,
      blocked: true,
      blockReason: 'no_relation',
      errorMessage: 'La relación origen-destino no es consistente (transferredFromShiftId no coincide).',
    };
  }

  // 7. Verificar asistencia existente en la fecha+colaborador del turno destino
  //    Limitación: no hay enlace directo TurnosProgramados → Asistencia.
  //    Se busca por colaboradorId + fecha en colecciones de asistencia.
  const colaboradorId = destino.colaboradorId;
  const fechaDestino = destino.fecha;

  let hasAttendance = false;
  let attendanceSource = null;

  try {
    // Verificar Asistencia (check_in con estado ABIERTO o CERRADO del mismo día)
    const { getDocs, query, collection, where } = require('firebase/firestore');
    // Limitación documentada: todavía no existe relación directa por turnoProgramadoId.
    // Consulta acotada por: colaboradorId + fecha + sucursal
    const asistenciaSnap = await db.collection('asistencia_digital')
      .where('employeeId', '==', colaboradorId)
      .where('siteId', '==', destino.sucursalId)
      .where('date', '==', fechaDestino)
      .limit(1)
      .get();

    if (!asistenciaSnap.empty) {
      hasAttendance = true;
      attendanceSource = 'asistencia_digital';
    }

    if (!hasAttendance) {
      // Verificar asistencia_manual
      const manualId = `manual_${colaboradorId}_${fechaDestino}`;
      const manualSnap = await db.collection('asistencia_manual').doc(manualId).get();
      if (manualSnap.exists && manualSnap.data().status === 'presente') {
        hasAttendance = true;
        attendanceSource = 'asistencia_manual';
      }
    }
  } catch (attErr) {
    console.warn('[revertTransfer] Error verificando asistencia destino:', attErr.message);
  }

  // 7.1 Verificar asistencia de un posible turno de cobertura (reemplazo)
  let hasReplacementAttendance = false;
  let replacementShift = null;

  if (origen.replacementShiftId) {
    const replSnap = await db.collection('TurnosProgramados').doc(origen.replacementShiftId).get();
    if (replSnap.exists) {
      replacementShift = replSnap.data();
      const repColabId = replacementShift.colaboradorId;
      
      try {
        const replAsistenciaSnap = await db.collection('asistencia_digital')
          .where('employeeId', '==', repColabId)
          .where('siteId', '==', replacementShift.sucursalId)
          .where('date', '==', replacementShift.fecha)
          .limit(1)
          .get();
        if (!replAsistenciaSnap.empty) hasReplacementAttendance = true;

        if (!hasReplacementAttendance) {
          const replManualId = `manual_${repColabId}_${replacementShift.fecha}`;
          const replManualSnap = await db.collection('asistencia_manual').doc(replManualId).get();
          if (replManualSnap.exists && replManualSnap.data().status === 'presente') {
            hasReplacementAttendance = true;
          }
        }
      } catch (replAttErr) {
        console.warn('[revertTransfer] Error verificando asistencia reemplazo:', replAttErr.message);
      }

      if (replacementShift.estado === 'ejecutado' || replacementShift.estado === 'completado') {
        hasReplacementAttendance = true;
      }
    }
  }

  if (hasAttendance) {
    // Registrar auditoría de intento bloqueado
    try {
      await db.collection('AuditoriaAcciones').doc().set({
        accion: 'TRANSFER_REVERTED',
        entidad: 'TurnosProgramados',
        entidadId: turnoOrigenId,
        usuarioId: uid,
        fecha: new Date().toISOString(),
        motivo: `BLOQUEADO: ${motivo}`,
        contextoInfo: {
          turnoOrigenId,
          turnoDestinoId,
          colaboradorId,
          fechaDestino,
          blockReason: 'existing_attendance',
          attendanceSource,
        },
      });
    } catch (e) {}

    return {
      success: false,
      turnoOrigenId,
      turnoDestinoId,
      blocked: true,
      blockReason: 'existing_attendance',
      errorMessage: `Existen registros de asistencia para el traslado. Revisión manual requerida.`,
    };
  }

  if (hasReplacementAttendance) {
    // Registrar auditoría
    try {
      await db.collection('AuditoriaAcciones').doc().set({
        accion: 'TRANSFER_REVERTED',
        entidad: 'TurnosProgramados',
        entidadId: turnoOrigenId,
        usuarioId: uid,
        fecha: new Date().toISOString(),
        motivo: `BLOQUEADO: ${motivo}`,
        contextoInfo: {
          turnoOrigenId,
          replacementShiftId: origen.replacementShiftId,
          blockReason: 'existing_replacement_attendance',
        },
      });
    } catch (e) {}

    return {
      success: false,
      turnoOrigenId,
      turnoDestinoId,
      blocked: true,
      blockReason: 'existing_replacement_attendance',
      errorMessage: `El reemplazo asignado a la vacante ya cuenta con asistencia. No se puede revertir.`,
    };
  }

  // 8. Ejecutar reversión en transacción
  const now = new Date().toISOString();

  await db.runTransaction(async (t) => {
    // Re-leer documentos dentro de la transacción para garantizar consistencia
    const origenTx = await t.get(origenRef);
    const destinoTx = await t.get(destinoRef);

    if (!origenTx.exists || origenTx.data().estado !== 'trasladado') {
      throw new Error('Turno origen ya no está en estado trasladado (carrera detectada).');
    }

    // Cancelar turno destino
    t.update(destinoRef, {
      estado: 'cancelado',
      motivoCancelacion: 'traslado_revertido',
      modificadoEn: now,
      modificadoPor: uid,
    });

    // Cancelar turno de reemplazo si existe
    if (origen.replacementShiftId && replacementShift) {
      t.update(db.collection('TurnosProgramados').doc(origen.replacementShiftId), {
        estado: 'cancelado',
        motivoCancelacion: 'vacante_revertida',
        modificadoEn: now,
        modificadoPor: uid,
      });
    }

    // Reactivar turno origen
    t.update(origenRef, {
      estado: 'programado',
      requiereCobertura: false,
      // Limpiar referencias de traslado para que la reversión sea clara
      transferredToShiftId: null,
      destinationBranchId: null,
      replacementShiftId: null,
      modificadoEn: now,
      modificadoPor: uid,
    });
  });

  // 9. Auditoría de reversión exitosa
  try {
    await db.collection('AuditoriaAcciones').doc().set({
      accion: 'TRANSFER_REVERTED',
      entidad: 'TurnosProgramados',
      entidadId: turnoOrigenId,
      usuarioId: uid,
      fecha: now,
      motivo,
      contextoInfo: {
        turnoOrigenId,
        turnoDestinoId,
        colaboradorId,
        fechaTurno: fechaDestino,
        sucursalOrigenId: origen.sucursalId,
        sucursalDestinoId: destino.sucursalId,
        correlationId: origen.correlationId,
      },
      estadoAnterior: { origenEstado: 'trasladado', destinoEstado: destino.estado },
      estadoNuevo: { origenEstado: 'programado', destinoEstado: 'cancelado' },
    });
  } catch (auditErr) {
    console.warn('[revertTransfer] Error registrando auditoría:', auditErr.message);
  }

  console.log(`[revertTransfer] Reversión completada: origen=${turnoOrigenId}, destino=${turnoDestinoId}`);

  return {
    success: true,
    turnoOrigenId,
    turnoDestinoId,
  };
}

module.exports = { revertShiftTransferHandler };
