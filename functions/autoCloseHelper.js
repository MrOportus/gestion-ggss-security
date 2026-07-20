const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { toTimestampMs } = require('./src/phase4/conflictService');
const { executeAttendanceClosure } = require('./src/phase5/attendanceClosureCore');

const AUTO_CLOSE_GRACE_MINUTES = 15;

async function processAutoCloseShifts(db, now, FieldValue = admin.firestore.FieldValue) {
  console.log(`[AUTO-CLOSE] Ejecutando cierre automático: ${now.toISOString()}`);
  
  const result = { procesados: 0, cerrados: 0, ignorados: 0 };

  try {
    // Buscar todos los turnos ABIERTOS
    const snapshot = await db
      .collection('Asistencia')
      .where('type', '==', 'check_in')
      .where('estado', '==', 'ABIERTO')
      .get();

    if (snapshot.empty) {
      console.log('[AUTO-CLOSE] No hay turnos abiertos.');
      return result;
    }

    console.log(`[AUTO-CLOSE] Encontrados ${snapshot.size} turnos abiertos.`);
    result.procesados = snapshot.size;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const attendanceId = docSnap.id;
      const startDate = new Date(data.timestamp);

      if (isNaN(startDate.getTime())) {
        console.log(`[AUTO-CLOSE] Turno ${attendanceId} con fecha de inicio inválida, saltando.`);
        result.ignorados++;
        continue;
      }

      let expirationTime;
      const hasValidShift = !!data.turnoProgramadoId;
      
      if (hasValidShift) {
        // Leer el TurnoProgramado
        const shiftDoc = await db.collection('TurnosProgramados').doc(data.turnoProgramadoId).get();
        if (!shiftDoc.exists) {
          console.log(`[AUTO-CLOSE] TurnoProgramado ${data.turnoProgramadoId} no existe. Fallback a legacy.`);
          // Fallback legacy (13 horas exactas)
          expirationTime = new Date(startDate.getTime() + (13 * 60 * 60 * 1000));
        } else {
          const shiftData = shiftDoc.data();
          const fechaOperacional = shiftData.fecha; // YYYY-MM-DD
          const termino = shiftData.horarioSnapshot?.termino; // HH:mm
          if (!fechaOperacional || !termino) {
            console.log(`[AUTO-CLOSE] TurnoProgramado ${data.turnoProgramadoId} sin fecha/termino. Fallback a legacy.`);
            expirationTime = new Date(startDate.getTime() + (13 * 60 * 60 * 1000));
          } else {
            // Calcular término absoluto en America/Santiago
            const [tHH, tMM] = termino.split(':').map(Number);
            const [y, m, d] = fechaOperacional.split('-').map(Number);

            const inicio = shiftData.horarioSnapshot?.inicio; // HH:mm
            let cruzaMedianoche = false;
            if (inicio && termino) {
              const [iHH, iMM] = inicio.split(':').map(Number);
              const [tHH, tMM] = termino.split(':').map(Number);
              const iMins = iHH * 60 + iMM;
              const tMins = tHH * 60 + tMM;
              if (tMins < iMins) cruzaMedianoche = true;
            } else if (shiftData.horarioSnapshot?.cruzaMedianoche === true) {
              cruzaMedianoche = true;
            }

            // Uso de la utilidad probada de conflictService.js (Bloque 4)
            const terminoUtcMs = toTimestampMs(fechaOperacional, termino, cruzaMedianoche, true);
            expirationTime = new Date(terminoUtcMs);

            // Sumar 15 minutos de tolerancia
            expirationTime = new Date(expirationTime.getTime() + (AUTO_CLOSE_GRACE_MINUTES * 60 * 1000));
          }
        }
      } else {
        // Cierre automático legacy tras 13 horas
        expirationTime = new Date(startDate.getTime() + (13 * 60 * 60 * 1000));
      }

      if (now < expirationTime) {
        console.log(`[AUTO-CLOSE] Turno ${attendanceId} aún no expira (expira: ${expirationTime.toISOString()}).`);
        result.ignorados++;
        continue;
      }

      // Ejecutar cierre unificado
      try {
        const requestId = `auto_close_${attendanceId}`;
        const closeResult = await executeAttendanceClosure(db, {
          attendanceId,
          actorUid: 'system',
          actorEmail: 'system@ggss.cl',
          actorRole: 'system',
          origen: 'scheduler',
          motivo: 'Cierre automático de sesión',
          checkPermissions: false,
          cleanupDigitalAttendance: true, // AutoClose sí debe limpiar el marcador activo
          auditType: 'auto_close',
          requestId: requestId,
          isSystemActor: true,
          payloadHash: null,
          FieldValue: FieldValue
        });

        if (closeResult.success) {
          result.cerrados++;
          console.log(`[AUTO-CLOSE] ✓ Turno cerrado para ${data.employeeName || data.employeeId}: ${attendanceId}`);
        } else {
          console.log(`[AUTO-CLOSE] Cierre no ejecutado (ya cerrado u otro motivo) para ${attendanceId}`);
        }
      } catch (txError) {
        console.error(`[AUTO-CLOSE] Error transaccional en ${attendanceId}:`, txError);
      }
    }

    console.log(`[AUTO-CLOSE] Proceso completado: ${result.cerrados} cerrados.`);
    return result;
  } catch (error) {
    console.error('[AUTO-CLOSE] Error en cierre automático:', error);
    return result;
  }
}

module.exports = {
  processAutoCloseShifts
};
