import { db as defaultDb } from '../../../lib/firebase';
import { Firestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { legacyAdapter } from '../legacyAdapter';
import { ShadowSyncTask } from '../shadowSyncService';

/**
 * ShadowSyncProcessor simula la lógica de Cloud Function (Fase 3).
 * Este módulo procesará una tarea encolada en ShadowSyncQueue.
 */
export class ShadowSyncProcessor {
  private db: Firestore = defaultDb;

  setDb(dbInstance: Firestore) {
    this.db = dbInstance;
  }

  /**
   * Intenta procesar una tarea en estado pending o failed (en reintento).
   */
  async processTask(taskId: string): Promise<void> {
    const taskRef = doc(this.db, 'ShadowSyncQueue', taskId);
    const snap = await getDoc(taskRef);

    if (!snap.exists()) {
      console.warn(`[ShadowSyncProcessor] Tarea ${taskId} no encontrada`);
      return;
    }

    const task = snap.data() as ShadowSyncTask;

    if (task.syncStatus === 'success' || task.syncStatus === 'dead_letter' || task.syncStatus === 'cancelled') {
      console.warn(`[ShadowSyncProcessor] La tarea ${taskId} tiene estado final: ${task.syncStatus}. Ignorando.`);
      return;
    }

    // 1. Marcar como processing
    await setDoc(taskRef, { syncStatus: 'processing', updatedAt: new Date().toISOString() }, { merge: true });

    try {
      // 2. Procesar a través de legacyAdapter (el cual tiene idempotencia y validación propia)
      await legacyAdapter.adaptLegacySave(
        task.employeeId,
        task.siteId.toString(),
        task.dateStr,
        task.statusLegacy,
        task.currentUserUid
      );

      // 3. Éxito
      await setDoc(taskRef, { 
        syncStatus: 'success', 
        updatedAt: new Date().toISOString(),
        processedAt: new Date().toISOString()
      }, { merge: true });

    } catch (e: any) {
      // 4. Manejo de errores sanitizados
      const errorMessage = e.message || 'Error desconocido';
      let errorCode = 'UNKNOWN_ERROR';
      let isRetryable = true;

      // Sanitización basada en mensaje
      if (errorMessage.includes('No autorizado') || errorMessage.includes('Permission')) {
        errorCode = 'PERMISSION_DENIED';
        isRetryable = false;
      } else if (errorMessage.includes('inválido') || errorMessage.includes('formato')) {
        errorCode = 'LEGACY_DATE_INVALID';
        isRetryable = false;
      }

      const attempts = (task.attempts || 0) + 1;
      const nextStatus = (!isRetryable || attempts >= task.maxIntentos) ? 'dead_letter' : 'failed';

      await setDoc(taskRef, {
        syncStatus: nextStatus,
        attempts,
        errorCode,
        lastErrorMessageSanitized: `Error en capa de adaptación: ${errorCode}`,
        updatedAt: new Date().toISOString(),
        nextRetryAt: nextStatus === 'failed' ? new Date(Date.now() + 5000 * attempts).toISOString() : null
      }, { merge: true });
    }
  }
}

export const shadowSyncProcessor = new ShadowSyncProcessor();
