/**
 * StorageCleanupService — Servicio centralizado y modular de limpieza y retención de 15 días.
 *
 * Diseñado específicamente para dispositivos Android de faena (Samsung A07, Motorola G06)
 * bajo Capacitor y WebView.
 *
 * Condiciones y garantías obligatorias:
 * 1. NO limpia indiscriminadamente IndexedDB ni la caché completa del WebView.
 * 2. NO elimina respaldos de migración hasta verificar que la migración concluyó correctamente (>15 días).
 * 3. NO elimina datos pendientes, en sincronización o con estado desconocido.
 * 4. NO elimina evidencias de rondas activas.
 * 5. Conserva el bundle OTA activo y el bundle nativo base ('builtin').
 * 6. Idempotente: puede ejecutarse repetidamente sin efectos adversos.
 * 7. No bloqueante: corre en segundo plano y registra su última ejecución en localStorage.
 * 8. Ventana de retención: 15 días exactos para datos temporales seguros.
 */

import { Capacitor } from '@capacitor/core';
import localforage from 'localforage';
import { roundsDB } from '../roundsDB';
import { SyncQueueService } from '../SyncQueueService';
import { SyncQueueMigration } from '../SyncQueueMigration';
import { OfflineCache } from '../OfflineCache';
import type { VisitaDraft } from '../visitasSupervisor/visitasTypes';

export interface StorageCleanupReport {
  timestamp: string;
  durationMs: number;
  skipped: boolean;
  skipReason?: string;
  capgoBundlesDeleted: number;
  capgoBundlesRetained: string[];
  roundEvidencesDeleted: number;
  roundPointsDeleted?: number;
  syncQueueCompactedRemoved?: number;
  permanentErrorsDeleted: number;
  abandonedDraftsDeleted: number;
  migrationBackupCleared: boolean;
  migrationBackupReason?: string;
  shiftCacheCleaned: boolean;
  errors: string[];
}

export const STORAGE_RETENTION_DAYS = 15;
export const OFFLINE_CACHE_RETENTION_DAYS = 14;
export const STORAGE_RETENTION_MS = STORAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // Máximo 1 vez cada 24 horas
export const LAST_CLEANUP_KEY = 'GGSS_LAST_STORAGE_CLEANUP_TS';
export const LAST_CLEANUP_REPORT_KEY = 'GGSS_LAST_STORAGE_CLEANUP_REPORT';

export const StorageCleanupService = {
  /**
   * Calcula la fecha de corte ISO para la ventana de retención de 15 días.
   */
  getCutoffDate(retentionDays = STORAGE_RETENTION_DAYS): { cutoffIso: string; cutoffMs: number } {
    const cutoffMs = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    return {
      cutoffIso: new Date(cutoffMs).toISOString(),
      cutoffMs
    };
  },

  /**
   * 1. Limpieza de Bundles OTA obsoletos de Capgo.
   * Conserva SIEMPRE el bundle actualmente activo y el bundle nativo base ('builtin').
   */
  async cleanCapgoBundles(): Promise<{ deleted: number; retained: string[]; error?: string }> {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      return { deleted: 0, retained: ['non_android_platform'] };
    }

    try {
      const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
      const current = await CapacitorUpdater.current();
      const activeId = current?.bundle?.id;
      const activeVersion = current?.bundle?.version;

      const listResult = await CapacitorUpdater.list();
      const bundles = listResult?.bundles || [];

      let deleted = 0;
      const retained: string[] = [];

      for (const b of bundles) {
        const bId = b.id;
        const bVer = b.version;

        // Conservar bundle activo (por ID o por versión)
        if (bId && activeId && bId === activeId) {
          retained.push(`active_id:${bId}`);
          continue;
        }
        if (bVer && activeVersion && bVer === activeVersion) {
          retained.push(`active_version:${bVer}`);
          continue;
        }

        // Conservar bundle nativo base
        if (bId === 'builtin' || bVer === 'builtin') {
          retained.push('builtin');
          continue;
        }

        // Si no tiene ID asignado, omitir por seguridad
        if (!bId) {
          continue;
        }

        try {
          await CapacitorUpdater.delete({ id: bId });
          deleted++;
          console.log(`[StorageCleanup] Bundle OTA obsoleto eliminado: ID ${bId} (v${bVer})`);
        } catch (delErr: any) {
          console.warn(`[StorageCleanup] Error eliminando bundle OTA ${bId}:`, delErr?.message || delErr);
        }
      }

      return { deleted, retained };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.warn('[StorageCleanup] Error en módulo Capgo Bundles:', msg);
      return { deleted: 0, retained: [], error: msg };
    }
  },

  /**
   * 2. Limpieza de evidencias fotográficas huérfanas en RoundsOfflineDB.
   * Elimina únicamente Blobs mayores a 15 días que NO pertenezcan a la ronda activa.
   */
  async cleanOrphanRoundEvidences(
    retentionDays = STORAGE_RETENTION_DAYS,
    activeRoundId?: string | null
  ): Promise<{ deleted: number; error?: string }> {
    try {
      const { cutoffIso } = this.getCutoffDate(retentionDays);
      const deleted = await roundsDB.clearOrphanEvidencesOlderThan(cutoffIso, activeRoundId);
      if (deleted > 0) {
        console.log(`[StorageCleanup] Purgadas ${deleted} evidencias huérfanas de rondas antiguas (>15 días).`);
      }
      return { deleted };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.warn('[StorageCleanup] Error en módulo de evidencias de rondas:', msg);
      return { deleted: 0, error: msg };
    }
  },

  /**
   * 3. Limpieza de borradores de visitas de supervisor abandonados en GGSS_Visitas_DB.
   * Elimina borradores con inicioEn superior a 15 días.
   */
  async cleanAbandonedVisitDrafts(
    retentionDays = STORAGE_RETENTION_DAYS
  ): Promise<{ deleted: number; error?: string }> {
    try {
      const draftStore = localforage.createInstance({ name: 'GGSS_Visitas_DB', storeName: 'visit_drafts' });
      const { cutoffMs } = this.getCutoffDate(retentionDays);
      const keysToRemove: string[] = [];

      await draftStore.iterate((draft: VisitaDraft, key: string) => {
        if (draft && draft.inicioEn) {
          const draftTime = new Date(draft.inicioEn).getTime();
          // Solo si tiene fecha válida y es más antiguo que 15 días
          if (!isNaN(draftTime) && draftTime < cutoffMs) {
            keysToRemove.push(key);
          }
        }
      });

      for (const key of keysToRemove) {
        await draftStore.removeItem(key);
      }

      if (keysToRemove.length > 0) {
        console.log(`[StorageCleanup] Purgados ${keysToRemove.length} borradores de visita abandonados (>15 días).`);
      }
      return { deleted: keysToRemove.length };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.warn('[StorageCleanup] Error en módulo de borradores de visita:', msg);
      return { deleted: 0, error: msg };
    }
  },

  /**
   * 4. Limpieza de errores permanentes en SyncQueueService.
   * Regla estricta: Únicamente elimina si status === 'ERROR' y retryCount >= 10 y timestamp > 15 días.
   * Conserva el 100% de los ítems PENDING, SYNCING, needs_recovery_review o de antigüedad desconocida.
   */
  async cleanPermanentErrors(
    retentionDays = STORAGE_RETENTION_DAYS
  ): Promise<{ deleted: number; error?: string }> {
    try {
      const { cutoffIso } = this.getCutoffDate(retentionDays);
      const deleted = await SyncQueueService.clearPermanentErrorsOlderThan(cutoffIso);
      return { deleted };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.warn('[StorageCleanup] Error en módulo de errores permanentes de cola:', msg);
      return { deleted: 0, error: msg };
    }
  },

  /**
   * 5. Limpieza segura del respaldo de migración sync_queue_backup.
   * Solo procede si:
   *  - La versión de migración es >= 1.
   *  - La fecha de migración existe y tiene más de 15 días.
   *  - La cola principal es accesible y estable.
   */
  async cleanMigrationBackupSafe(
    retentionDays = STORAGE_RETENTION_DAYS
  ): Promise<{ cleared: boolean; reason: string; error?: string }> {
    try {
      const { cutoffIso } = this.getCutoffDate(retentionDays);
      const result = await SyncQueueMigration.cleanBackupIfEligible(cutoffIso);
      return { cleared: result.cleared, reason: result.reason };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.warn('[StorageCleanup] Error en módulo de respaldo de migración:', msg);
      return { cleared: false, reason: 'Error durante la verificación.', error: msg };
    }
  },

  /**
   * 6. Limpieza de turnos antiguos (> 14 días offline) en OfflineCache.
   */
  async cleanExpiredShiftCache(retentionDays = OFFLINE_CACHE_RETENTION_DAYS): Promise<{ cleaned: boolean; deleted?: number; error?: string }> {
    try {
      const deleted = await OfflineCache.cleanOldShifts(retentionDays);
      return { cleaned: true, deleted };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.warn('[StorageCleanup] Error en módulo de turnos en caché:', msg);
      return { cleaned: false, error: msg };
    }
  },

  /**
   * 7. Limpieza de puntos GPS huérfanos en RoundsOfflineDB.pendingPoints.
   */
  async cleanOrphanRoundPoints(
    retentionDays = STORAGE_RETENTION_DAYS,
    activeRoundId?: string | null
  ): Promise<{ deleted: number; error?: string }> {
    try {
      const { cutoffIso } = this.getCutoffDate(retentionDays);
      const deleted = await roundsDB.clearPointsOlderThan(cutoffIso, activeRoundId);
      if (deleted > 0) {
        console.log(`[StorageCleanup] Purgados ${deleted} puntos GPS huérfanos (> ${retentionDays} días).`);
      }
      return { deleted };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.warn('[StorageCleanup] Error en módulo de puntos GPS de rondas:', msg);
      return { deleted: 0, error: msg };
    }
  },

  /**
   * 8. Compactación segura de duplicados históricos UPDATE_ROUND en SyncQueueService.
   */
  async compactSyncQueue(): Promise<{ removed: number; error?: string }> {
    try {
      const res = await SyncQueueService.compactPendingUpdateRounds();
      return { removed: res.removed };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.warn('[StorageCleanup] Error compactando cola offline:', msg);
      return { removed: 0, error: msg };
    }
  },

  /**
   * Orquestador principal de limpieza periódica.
   * Idempotente, no bloqueante y tolerante a fallos individuales.
   */
  async runDailyCleanup(options?: {
    force?: boolean;
    activeRoundId?: string | null;
    retentionDays?: number;
  }): Promise<StorageCleanupReport> {
    const startTime = Date.now();
    const retentionDays = options?.retentionDays ?? STORAGE_RETENTION_DAYS;

    // Control de frecuencia (máximo 1 vez cada 24 horas salvo force)
    if (!options?.force) {
      try {
        const lastTs = localStorage.getItem(LAST_CLEANUP_KEY);
        if (lastTs) {
          const elapsed = Date.now() - Number(lastTs);
          if (elapsed < CLEANUP_INTERVAL_MS) {
            const nextInHours = ((CLEANUP_INTERVAL_MS - elapsed) / (1000 * 60 * 60)).toFixed(1);
            console.log(`[StorageCleanup] Omitiendo: última limpieza ejecutada hace ${(elapsed / (1000 * 60)).toFixed(0)} min (próxima en ${nextInHours}h).`);
            return {
              timestamp: new Date().toISOString(),
              durationMs: 0,
              skipped: true,
              skipReason: `Ejecutado recientemente. Próxima ejecución en ${nextInHours}h`,
              capgoBundlesDeleted: 0,
              capgoBundlesRetained: [],
              roundEvidencesDeleted: 0,
              permanentErrorsDeleted: 0,
              abandonedDraftsDeleted: 0,
              migrationBackupCleared: false,
              shiftCacheCleaned: false,
              errors: []
            };
          }
        }
      } catch (storageErr) {
        console.warn('[StorageCleanup] No se pudo leer localStorage para intervalo:', storageErr);
      }
    }

    console.log(`[StorageCleanup] Iniciando limpieza de almacenamiento (retención: ${retentionDays} días)...`);
    const errors: string[] = [];

    // 1. Capgo Bundles
    const capgoRes = await this.cleanCapgoBundles();
    if (capgoRes.error) errors.push(`Capgo: ${capgoRes.error}`);

    // 2. Evidencias de rondas huérfanas
    const roundsRes = await this.cleanOrphanRoundEvidences(retentionDays, options?.activeRoundId);
    if (roundsRes.error) errors.push(`Rondas: ${roundsRes.error}`);

    // 3. Borradores de visita abandonados
    const draftsRes = await this.cleanAbandonedVisitDrafts(retentionDays);
    if (draftsRes.error) errors.push(`VisitasDrafts: ${draftsRes.error}`);

    // 4. Errores permanentes en cola offline
    const errorsRes = await this.cleanPermanentErrors(retentionDays);
    if (errorsRes.error) errors.push(`SyncQueue: ${errorsRes.error}`);

    // 5. Respaldo de migración seguro
    const migrationRes = await this.cleanMigrationBackupSafe(retentionDays);
    if (migrationRes.error) errors.push(`MigrationBackup: ${migrationRes.error}`);

    // 6. Turnos en caché (>14 días)
    const shiftRes = await this.cleanExpiredShiftCache(OFFLINE_CACHE_RETENTION_DAYS);
    if (shiftRes.error) errors.push(`ShiftCache: ${shiftRes.error}`);

    // 7. Puntos GPS huérfanos en pendingPoints (>15 días, protege ronda activa)
    const pointsRes = await this.cleanOrphanRoundPoints(retentionDays, options?.activeRoundId);
    if (pointsRes.error) errors.push(`RoundPoints: ${pointsRes.error}`);

    // 8. Compactación de UPDATE_ROUND duplicados heredados
    const compactRes = await this.compactSyncQueue();
    if (compactRes.error) errors.push(`QueueCompact: ${compactRes.error}`);

    const durationMs = Date.now() - startTime;
    const report: StorageCleanupReport = {
      timestamp: new Date().toISOString(),
      durationMs,
      skipped: false,
      capgoBundlesDeleted: capgoRes.deleted,
      capgoBundlesRetained: capgoRes.retained,
      roundEvidencesDeleted: roundsRes.deleted,
      roundPointsDeleted: pointsRes.deleted,
      syncQueueCompactedRemoved: compactRes.removed,
      permanentErrorsDeleted: errorsRes.deleted,
      abandonedDraftsDeleted: draftsRes.deleted,
      migrationBackupCleared: migrationRes.cleared,
      migrationBackupReason: migrationRes.reason,
      shiftCacheCleaned: shiftRes.cleaned,
      errors
    };

    // Registrar fecha y reporte de última ejecución
    try {
      localStorage.setItem(LAST_CLEANUP_KEY, Date.now().toString());
      localStorage.setItem(LAST_CLEANUP_REPORT_KEY, JSON.stringify(report));
    } catch (e) {
      // Ignorar fallas de localStorage en entornos restringidos
    }

    console.log(`[StorageCleanup] Limpieza completada en ${durationMs}ms:`, {
      bundlesDeleted: report.capgoBundlesDeleted,
      evidencesDeleted: report.roundEvidencesDeleted,
      permanentErrorsDeleted: report.permanentErrorsDeleted,
      draftsDeleted: report.abandonedDraftsDeleted,
      migrationBackupCleared: report.migrationBackupCleared,
      errorsCount: errors.length
    });

    return report;
  }
};

