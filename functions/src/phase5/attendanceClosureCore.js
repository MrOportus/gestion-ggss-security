const { HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { FieldValue: AdminFieldValue } = require('firebase-admin/firestore');

// V2 Imports
const { resolveV2DualWrite, getFeatureFlagSnapshot } = require('../phase5d2/featureFlags');
const { compareLegacyAndV2Attendance } = require('../phase5d2/shadowComparator');
const { 
  buildManualAttendanceV2FromSession, 
  validateManualAttendanceV2, 
  validateManualAttendanceV2Update, 
  buildManualAttendanceV2Id 
} = require('../phase5d2/manualAttendanceV2');

/**
 * Función centralizada para el cierre de asistencias.
 * Unifica la lógica de cierre manual (por administrador) y cierre automático (por scheduler).
 */
async function executeAttendanceClosure(db, params) {
  const {
    attendanceId,
    actorUid,
    actorEmail,
    actorRole,
    origen,
    motivo,
    checkPermissions,
    cleanupDigitalAttendance,
    auditType,
    requestId,
    isSystemActor,
    payloadHash,
    FieldValue = AdminFieldValue
  } = params;

  if (!requestId) {
    throw new Error('executeAttendanceClosure requires a valid requestId for idempotency');
  }

  const tokenRef = db.collection('OperationTokens').doc(requestId);

  return db.runTransaction(async (transaction) => {
    let shadowPayload = null;
    // --- 1. LECTURAS ---
    const tokenDoc = await transaction.get(tokenRef);
    const checkInRef = db.collection('Asistencia').doc(attendanceId);
    const checkInSnap = await transaction.get(checkInRef);

    if (!checkInSnap.exists) {
      if (isSystemActor) {
        return { success: false, reason: 'not-found', message: 'Registro no encontrado' };
      }
      throw new HttpsError('not-found', 'Registro de asistencia no encontrado.');
    }
    const checkInData = checkInSnap.data();

    // Resolución de sucursal
    let tpSnap = null;
    let shiftSnap = null;
    if (checkInData.turnoProgramadoId) {
      tpSnap = await transaction.get(db.collection('TurnosProgramados').doc(checkInData.turnoProgramadoId));
    } else if (checkInData.shiftId && typeof checkInData.shiftId === 'string' && !checkInData.shiftId.startsWith('manual_')) {
      shiftSnap = await transaction.get(db.collection('programacion').doc(checkInData.shiftId));
    }

    // Alcances Operativos (solo manual)
    let alcanceSnap = null;
    if (checkPermissions && (actorRole === 'supervisor' || actorRole === 'jefe_operaciones')) {
      alcanceSnap = await transaction.get(db.collection('AlcancesOperativos').doc(actorUid));
    }

    // --- 2. VALIDACIONES E IDEMPOTENCIA ---
    if (tokenDoc.exists) {
      const tData = tokenDoc.data();
      if (!isSystemActor && payloadHash && tData.payloadHash !== payloadHash) {
        throw new HttpsError('already-exists', 'request_id_reused');
      }
      if (tData.status === 'success') {
        return tData.result;
      }
    }

    // Si ya estaba cerrado, simplemente retornar (Idempotencia base)
    if (checkInData.status === 'completed' || checkInData.estado === 'CERRADO') {
      return { success: true, message: 'La asistencia ya estaba cerrada.', checkOutId: null };
    }

    // Resolver sucursal autoritativa
    let resolvedSiteId = null;
    let resolvedSiteName = null;
    let sucursalResolution = 'unresolved';

    if (tpSnap && tpSnap.exists && tpSnap.data().sucursalId) {
      resolvedSiteId = tpSnap.data().sucursalId;
      sucursalResolution = 'TurnosProgramados';
    } else if (shiftSnap && shiftSnap.exists && shiftSnap.data().siteId) {
      resolvedSiteId = shiftSnap.data().siteId;
      sucursalResolution = 'programacion';
    } else if (checkInData.siteId) {
      resolvedSiteId = checkInData.siteId;
      resolvedSiteName = checkInData.siteName;
      sucursalResolution = 'Asistencia';
    } else {
      resolvedSiteId = 'sucursal_no_determinada';
      sucursalResolution = 'unresolved';
    }

    if (!resolvedSiteName && resolvedSiteId) {
       resolvedSiteName = resolvedSiteId.toString();
    }

    // Validar Alcances Operativos
    if (checkPermissions && (actorRole === 'supervisor' || actorRole === 'jefe_operaciones')) {
      if (resolvedSiteId === 'sucursal_no_determinada') {
         throw new HttpsError('permission-denied', 'No se puede forzar el cierre de un turno sin sucursal determinada siendo usuario no global.');
      }
      if (!alcanceSnap || !alcanceSnap.exists || !alcanceSnap.data().activo) {
         throw new HttpsError('permission-denied', 'No tiene alcance operativo activo.');
      }
      const dataAlcance = alcanceSnap.data();
      if (dataAlcance.alcanceNacional !== true) {
         const sucursales = dataAlcance.sucursalesAutorizadas || [];
         if (!sucursales.includes(resolvedSiteId.toString())) {
           throw new HttpsError('permission-denied', `Sin alcance en sucursal del turno: ${resolvedSiteId}.`);
         }
      }
    }

    // Corregir fecha operacional (jornadaDate) usando utilidad America/Santiago
    let jornadaDate = checkInData.localDate || '';
    if (!jornadaDate) {
      const startObj = new Date(checkInData.timestamp);
      const formatter = new Intl.DateTimeFormat('es-CL', {
        timeZone: 'America/Santiago',
        year: 'numeric', month: '2-digit', day: '2-digit',
      });
      const parts = formatter.formatToParts(startObj);
      const pMap = {};
      parts.forEach(p => { pMap[p.type] = p.value; });
      jornadaDate = `${pMap.year}-${pMap.month}-${pMap.day}`;
    }

    const now = new Date();
    const endTimestamp = now.toISOString();
    
    // Tipo de cierre y prefijos
    const tipoCierre = isSystemActor ? 'AUTOMATICO' : 'MANUAL';
    const detectedClosureType = isSystemActor ? 'cierre forzado' : 'cierre por Admin';
    const checkOutPrefix = isSystemActor ? 'auto_checkout_' : 'forced_checkout_';
    const checkOutId = `${checkOutPrefix}${attendanceId}`;
    
    // Validar si este checkoutId ya existe (concurrencia extrema)
    const checkOutRef = db.collection('Asistencia').doc(checkOutId);
    const checkOutDoc = await transaction.get(checkOutRef);
    if (checkOutDoc.exists) {
       return { success: true, message: 'Check-out ya existe.', checkOutId };
    }

    const finalResult = { success: true, checkOutId };

    // Feature Flag V2
    const ffRef = db.collection('FeatureFlags').doc('attendanceV2');
    const ffDoc = await transaction.get(ffRef);
    const ffData = ffDoc.exists ? ffDoc.data() : null;
    const isV2Enabled = resolveV2DualWrite(ffData, {
      employeeId: checkInData.employeeId,
      siteId: resolvedSiteId !== 'sucursal_no_determinada' ? resolvedSiteId : null,
      dateStr: jornadaDate,
      user: { uid: actorUid }
    });

    let v2SnapshotRef = null;
    let v2SnapshotDoc = null;
    let v2Id = null;
    if (isV2Enabled) {
      v2Id = buildManualAttendanceV2Id(attendanceId);
      v2SnapshotRef = db.collection('AsistenciasConsolidadas').doc(v2Id);
      v2SnapshotDoc = await transaction.get(v2SnapshotRef);
    }

    // --- 3. ESCRITURAS ---
    transaction.update(checkInRef, {
      status: 'completed',
      endTime: endTimestamp,
      estado: 'CERRADO',
      tipoCierre: tipoCierre,
      horaSalidaReal: endTimestamp,
      detalle: detectedClosureType,
    });

    const checkOutLog = {
      ...checkInData,
      id: checkOutId,
      type: 'check_out',
      timestamp: endTimestamp,
      status: 'completed',
      isManual: !isSystemActor,
      systemNote: motivo || (isSystemActor ? "Cierre automático de sesión" : "Cierre forzado por administrador"),
      tipoCierre: tipoCierre,
      estado: 'CERRADO',
      horaSalidaReal: endTimestamp,
      detalle: detectedClosureType,
      closedByAttendanceId: attendanceId
    };
    transaction.set(checkOutRef, checkOutLog);

    // asistencia_digital
    if (cleanupDigitalAttendance) {
      const siteIdForDig = checkInData.siteId || 'sin_sucursal';
      const digId = `${siteIdForDig}_${checkInData.employeeId}_${jornadaDate}`;
      const digRef = db.collection('asistencia_digital').doc(digId);
      transaction.delete(digRef);
    }

    // NOTA: forceLogout fue eliminado del flujo de cierre de turno.
    // Cerrar un turno (automático o por admin) NO debe cerrar la sesión del guardia.
    // El forceLogout solo debe usarse para logout remoto explícito, no como efecto
    // colateral de un cierre de turno.

    // asistencia_manual (Legacy)
    const manualDocId = `manual_${checkInData.employeeId}_${jornadaDate}`;
    const manualRef = db.collection('asistencia_manual').doc(manualDocId);
    let typeManual = isSystemActor ? 'auto_checkout' : 'forced_checkout';
    
    const legacyPayload = {
      employeeId: checkInData.employeeId,
      date: jornadaDate,
      status: 'presente',
      type: typeManual,
      siteId: resolvedSiteId !== 'sucursal_no_determinada' ? resolvedSiteId : 'all',
      updatedAt: FieldValue.serverTimestamp()
    };
    transaction.set(manualRef, legacyPayload, { merge: true });

    // Actualizar TurnosProgramados → estado 'completado' al cerrar turno
    if (tpSnap && tpSnap.exists) {
      const tpRef = db.collection('TurnosProgramados').doc(checkInData.turnoProgramadoId);
      transaction.update(tpRef, {
        estado: 'completado',
        asistenciaEstado: 'presente',
        horaSalidaReal: endTimestamp,
        checkOutId: checkOutId,
        updatedAt: FieldValue.serverTimestamp()
      });
    }

    const auditId = isSystemActor ? `auto_close_${attendanceId}` : `attendance_force_closed_${attendanceId}`;

    // Dual Write V2
    if (isV2Enabled) {
      const { record: v2Record } = buildManualAttendanceV2FromSession({
        checkIn: { ...checkInData, id: attendanceId },
        checkOut: checkOutLog,
        turnoProgramado: tpSnap && tpSnap.exists ? { id: tpSnap.id, ...tpSnap.data() } : null,
        programacionLegacy: shiftSnap && shiftSnap.exists ? { id: shiftSnap.id, ...shiftSnap.data() } : null,
        context: {
          now: FieldValue.serverTimestamp(),
          serverTimestampFn: () => FieldValue.serverTimestamp()
        }
      });

      // Validación pura
      const valResult = validateManualAttendanceV2(v2Record);
      if (!valResult.valid) {
        throw new Error(`[V2 Dual Write] Invalid record generated: ${JSON.stringify(valResult.errors)}`);
      }

      let finalV2Record = v2Record;
      if (v2SnapshotDoc && v2SnapshotDoc.exists) {
        const updateVal = validateManualAttendanceV2Update(v2SnapshotDoc.data(), v2Record);
        if (!updateVal.valid) {
          throw new Error(`[V2 Dual Write] Invalid update: ${JSON.stringify(updateVal.errors)}`);
        }
        // Conservar inmutables de firebase server (si existen)
        if (v2SnapshotDoc.data().createdAt) {
          finalV2Record.createdAt = v2SnapshotDoc.data().createdAt;
        }
      }

      transaction.set(v2SnapshotRef, finalV2Record);

      // Auditoria V2
      const auditV2Id = `attendance_v2_snapshot_written_${attendanceId}`;
      transaction.set(db.collection('AuditoriaAcciones').doc(auditV2Id), {
        accion: 'attendance_v2_snapshot_written',
        checkInId: attendanceId,
        v2DocumentId: v2Id,
        employeeId: checkInData.employeeId,
        sucursalId: resolvedSiteId !== 'sucursal_no_determinada' ? resolvedSiteId : null,
        jornadaDate,
        sourceOperation: auditType,
        actor: actorUid,
        requestId,
        operationTokenId: requestId,
        featureFlagSnapshot: ffData,
        createdAt: FieldValue.serverTimestamp()
      });

      // Preparar parámetros para Shadow Comparison POST-transacción
      shadowPayload = {
        checkInId: attendanceId,
        v2Data: finalV2Record,
        legacyData: { ...legacyPayload, employeeId: checkInData.employeeId, date: jornadaDate, siteId: legacyPayload.siteId },
        featureFlagSnapshot: ffData,
        sourceOperation: auditType
      };
    }

    // AuditoriaAcciones (Legacy)
    const auditRef = db.collection('AuditoriaAcciones').doc(auditId);
    transaction.set(auditRef, {
      accion: auditType,
      actorId: actorUid,
      actorEmail: actorEmail || null,
      actorRol: actorRole || null,
      colaboradorId: checkInData.employeeId,
      attendanceId,
      checkOutId,
      turnoProgramadoId: checkInData.turnoProgramadoId || null,
      shiftId: checkInData.shiftId || null,
      sucursalId: resolvedSiteId !== 'sucursal_no_determinada' ? resolvedSiteId : null,
      sucursalResolution,
      fechaOperacional: jornadaDate,
      estadoAnterior: checkInData.status || 'open',
      estadoNuevo: 'completed',
      tipoCierre: detectedClosureType,
      motivo: motivo || null,
      requestId: requestId,
      createdAt: FieldValue.serverTimestamp(),
      origen: origen
    });

    // Token
    transaction.set(tokenRef, {
      operationType: auditType,
      actorUid,
      requestId: requestId,
      attendanceId,
      payloadHash: payloadHash || null,
      status: 'success',
      result: finalResult,
      createdAt: FieldValue.serverTimestamp(),
      completedAt: FieldValue.serverTimestamp()
    });

    return { finalResult, shadowPayload };
  }).then(async (txResult) => {
    // Manejar early returns (ej: idempotencia donde devolvemos directamente un objeto sin finalResult/shadowPayload)
    if (!txResult || typeof txResult.finalResult === 'undefined') {
      return txResult;
    }

    // 4. POST-TRANSACCION: SHADOW COMPARISON
    let shadowResult = null;
    if (txResult.shadowPayload) {
      try {
        shadowResult = await compareLegacyAndV2Attendance(db, FieldValue, txResult.shadowPayload);
      } catch (error) {
        console.warn("[ATTENDANCE-V2-SHADOW-FAILED]", {
          checkInId: txResult.shadowPayload.checkInId,
          errorCode: error?.code ?? "unknown",
          message: error?.message ?? "unknown",
        });
      }
    }
    return txResult.finalResult;
  });
}

module.exports = {
  executeAttendanceClosure
};
