
// ──────────────────────────────────────────────────────────────────────
// FASE 5B.4: Shadow Resolver Backend
// ──────────────────────────────────────────────────────────────────────
exports.shadowAttendanceResolver = onDocumentCreated('Asistencia/{attendanceId}', async (event) => {
  const attendanceId = event.params.attendanceId;
  const data = event.data.data();
  
  if (!data || data.type !== 'check_in' || data.turnoProgramadoId) {
    return;
  }

  const db = admin.firestore();
  
  try {
    const { employeeId, siteId, localDate, timestamp } = data;
    
    // Validaciones
    if (!employeeId || !siteId || !localDate || !timestamp) return;

    const dateObj = event.time ? new Date(event.time) : new Date(timestamp);
    // Convertir a America/Santiago (UTC-3 o UTC-4) para operaciones exactas
    const santiagoStr = dateObj.toLocaleString('en-US', { timeZone: 'America/Santiago' });
    const santiagoDate = new Date(santiagoStr);
    
    const dateStr = `${santiagoDate.getFullYear()}-${String(santiagoDate.getMonth() + 1).padStart(2, '0')}-${String(santiagoDate.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(santiagoDate.getHours()).padStart(2, '0')}:${String(santiagoDate.getMinutes()).padStart(2, '0')}`;
    const isNextDay = dateStr !== localDate;
    
    const currentAbsMins = toAbsoluteMinutes(localDate, timeStr, isNextDay);
    
    // Ejecutar lógica como transacción atómica para garantizar idempotencia
    await db.runTransaction(async (transaction) => {
      const diagRef = db.collection('AttendanceShadowDiagnostics').doc(attendanceId);
      const diagDoc = await transaction.get(diagRef);
      if (diagDoc.exists) {
        console.log(`[SHADOW RESOLVER] Asistencia ${attendanceId} ya fue procesada, ignorando.`);
        return;
      }
      
      const candidatesSnap = await transaction.get(
        db.collection('TurnosProgramados')
          .where('colaboradorId', '==', employeeId)
          .where('fecha', 'in', [localDate, dateStr])
      );
        
      const candidates = [];
      candidatesSnap.forEach(doc => {
        candidates.push({ id: doc.id, ...doc.data() });
      });

      const legacyCode = data.turnoProgramadoStatus || 'programado'; // ej 'noche' o 'programado'
      const result = resolveShadowShift(candidates, siteId, legacyCode, currentAbsMins);

      if (result.turnoProgramadoId) {
        transaction.update(event.data.ref, { turnoProgramadoId: result.turnoProgramadoId });
      }

      transaction.set(diagRef, {
        attendanceId,
        turnoProgramadoId: result.turnoProgramadoId || null,
        resultado: result.diagnostico,
        cantidadCandidatos: candidates.length,
        sucursalId: siteId,
        fechaOperacional: localDate,
        resolverVersion: '1.0.1', // 5B.5 version
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        errorCode: result.diagnostico !== 'unico' ? result.diagnostico : null
      });
      
      console.log(`[SHADOW RESOLVER] Asistencia ${attendanceId} procesada atómicamente. Resultado: ${result.diagnostico}`);
    });

  } catch (error) {
    console.error(`[SHADOW RESOLVER] Error procesando ${attendanceId}:`, error);
    await db.collection('AttendanceShadowDiagnostics').doc(attendanceId).set({
      attendanceId,
      resultado: 'error_tecnico',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      errorCode: 'exception'
    });
  }
});
