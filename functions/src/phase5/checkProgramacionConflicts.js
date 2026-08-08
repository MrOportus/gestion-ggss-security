'use strict';
/**
 * functions/src/phase5/checkProgramacionConflicts.js
 *
 * Cloud Function triggerada cuando se crea un documento en ProgramacionConflictQueue.
 * Verifica conflictos de solapamiento horario para un colaborador en las fechas dadas
 * y escribe advertencias en ConflictWarnings/{colaboradorId}_{YYYY-MM}.
 *
 * Esta función corre en segundo plano — NO bloquea el guardado de planificación.
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { detectConflict } = require('../phase4/conflictService');
const logger = require('firebase-functions/logger');

const CHUNK_SIZE = 30; // Límite de Firestore IN-query

/**
 * Obtiene todos los turnos activos de un colaborador para un conjunto de fechas,
 * consultando en lotes de CHUNK_SIZE para respetar el límite de Firestore.
 */
async function getActiveShiftsForDates(db, colaboradorId, datesArray) {
  const results = [];
  for (let i = 0; i < datesArray.length; i += CHUNK_SIZE) {
    const chunk = datesArray.slice(i, i + CHUNK_SIZE);

    // Consulta TurnosProgramados (canónico)
    const shadowSnap = await db.collection('TurnosProgramados')
      .where('colaboradorId', '==', colaboradorId)
      .where('fechaOperacional', 'in', chunk)
      .get();

    shadowSnap.forEach(doc => {
      const data = doc.data();
      // Solo turnos activos con horario definido
      if (
        data.horarioSnapshot &&
        data.codigoTurno !== 'D' &&
        data.estado !== 'cancelado' &&
        data.estado !== 'descanso'
      ) {
        results.push({
          id: doc.id,
          fecha: data.fechaOperacional,
          horario: data.horarioSnapshot,
          sucursalId: data.sucursalId,
          sucursalNombre: data.sucursalNombre || data.sucursalId,
          codigoTurno: data.codigoTurno,
          estado: data.estado,
          tipoOperacion: data.tipoOperacion || 'contractual'
        });
      }
    });
  }
  return results;
}

/**
 * Función principal de detección de conflictos.
 * Compara todos los turnos entre sí buscando solapamientos de diferente sucursal.
 */
function findConflicts(shifts) {
  const conflictos = [];
  const seen = new Set();

  for (let i = 0; i < shifts.length; i++) {
    for (let j = i + 1; j < shifts.length; j++) {
      const a = shifts[i];
      const b = shifts[j];

      // Solo interesa conflicto entre sucursales distintas
      if (String(a.sucursalId) === String(b.sucursalId)) continue;

      const pairKey = [a.id, b.id].sort().join('_');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const result = detectConflict(
        { fecha: a.fecha, horario: a.horario },
        { fecha: b.fecha, horario: b.horario, estado: b.estado }
      );

      if (result.type !== 'none' && result.type !== 'already_transferred') {
        conflictos.push({
          fecha: a.fecha,
          turnoIdA: a.id,
          sucursalIdA: a.sucursalId,
          sucursalNombreA: a.sucursalNombre,
          horarioA: `${a.horario.inicio}-${a.horario.termino}`,
          turnoIdB: b.id,
          sucursalIdB: b.sucursalId,
          sucursalNombreB: b.sucursalNombre,
          horarioB: `${b.horario.inicio}-${b.horario.termino}`,
          tipoConflicto: result.type
        });
      }
    }
  }
  return conflictos;
}

exports.checkProgramacionConflicts = onDocumentCreated(
  {
    document: 'ProgramacionConflictQueue/{docId}',
    region: 'us-central1',
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const queueData = snapshot.data();
    const { colaboradorId, fechas, sucursalIds, operationRequestId } = queueData;

    if (!colaboradorId || !Array.isArray(fechas) || fechas.length === 0) {
      logger.warn('[ConflictChecker] Documento de cola inválido:', event.params.docId);
      await snapshot.ref.delete();
      return;
    }

    logger.info(`[ConflictChecker] Verificando conflictos para ${colaboradorId}, ${fechas.length} fechas.`);

    const db = admin.firestore();

    try {
      // Marcar como en proceso
      await snapshot.ref.update({ status: 'processing', startedAt: FieldValue.serverTimestamp() });

      // Obtener todas las fechas afectadas (expandidas) para buscar conflictos contextuales
      const expandedDates = new Set(fechas);
      fechas.forEach(f => {
        // Añadir día anterior y siguiente para capturar turnos nocturnos adyacentes
        const d = new Date(`${f}T12:00:00Z`);
        const prev = new Date(d); prev.setUTCDate(d.getUTCDate() - 1);
        const next = new Date(d); next.setUTCDate(d.getUTCDate() + 1);
        expandedDates.add(prev.toISOString().split('T')[0]);
        expandedDates.add(next.toISOString().split('T')[0]);
      });

      const datesArray = Array.from(expandedDates).sort();
      const shifts = await getActiveShiftsForDates(db, colaboradorId, datesArray);

      logger.info(`[ConflictChecker] ${shifts.length} turnos activos encontrados para ${colaboradorId}.`);

      const conflictos = findConflicts(shifts);

      // Determinar mes(es) afectados para el ID del documento de advertencia
      const meses = [...new Set(fechas.map(f => f.substring(0, 7)))];

      for (const mes of meses) {
        const warningId = `${colaboradorId}_${mes}`;
        const warningRef = db.collection('ConflictWarnings').doc(warningId);

        const conflictosDelMes = conflictos.filter(c => c.fecha.startsWith(mes));

        if (conflictosDelMes.length > 0) {
          await warningRef.set({
            colaboradorId,
            mes,
            conflictos: conflictosDelMes,
            totalConflictos: conflictosDelMes.length,
            operationRequestId: operationRequestId || null,
            checkedAt: FieldValue.serverTimestamp(),
            acknowledged: false
          }, { merge: false });

          logger.info(`[ConflictChecker] ⚠️ ${conflictosDelMes.length} conflictos guardados en ConflictWarnings/${warningId}`);
        } else {
          // Si no hay conflictos, limpiar advertencias previas del mismo mes
          const existingWarning = await warningRef.get();
          if (existingWarning.exists && !existingWarning.data().acknowledged) {
            await warningRef.delete();
          }
          logger.info(`[ConflictChecker] ✅ Sin conflictos en mes ${mes} para ${colaboradorId}.`);
        }
      }

      // Limpiar el doc de la queue
      await snapshot.ref.delete();

    } catch (error) {
      logger.error(`[ConflictChecker] Error procesando ${event.params.docId}:`, error);
      // Marcar como fallido en la queue para auditoría
      try {
        await snapshot.ref.update({
          status: 'error',
          errorMessage: error.message || 'Error desconocido',
          failedAt: FieldValue.serverTimestamp()
        });
      } catch (e2) {
        logger.error('[ConflictChecker] Error actualizando status de fallo:', e2);
      }
    }
  }
);
