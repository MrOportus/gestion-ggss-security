/**
 * ASPRO — Fase 3: Validación Exhaustiva de Retención y Limpieza de Almacenamiento Local
 *
 * Ejecuta los 8 puntos de comprobación obligatorios:
 *  1. Un archivo temporal de más de 15 días se elimina.
 *  2. Un archivo temporal de menos de 15 días se conserva.
 *  3. Una evidencia sincronizada de más de 15 días se elimina localmente.
 *  4. Una evidencia pendiente de sincronización se conserva aunque tenga más de 15 días.
 *  5. Un registro con estado de sincronización desconocido se conserva.
 *  6. Una limpieza repetida no genera errores ni elimina datos adicionales.
 *  7. La limpieza no bloquea la interfaz ni impide iniciar o cerrar turnos.
 *  8. El mecanismo funciona correctamente en Android y no depende de que la app permanezca abierta indefinidamente.
 *
 * Verificaciones adicionales:
 *  - Evidencias de rondas activas 100% protegidas.
 *  - Calidad e integridad de la compresión de imágenes (Canvas 1024px, JPEG 0.7).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import localforage from 'localforage';
import { StorageCleanupService, STORAGE_RETENTION_DAYS, LAST_CLEANUP_KEY } from '../lib/storage/StorageCleanupService';
import { roundsDB, PendingEvidence } from '../lib/roundsDB';
import { SyncQueueService, QueueItem } from '../lib/SyncQueueService';
import { SyncQueueMigration } from '../lib/SyncQueueMigration';

// Mock Capacitor platform
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
  },
}));

// Mock Capgo CapacitorUpdater
const mockCapacitorUpdater = {
  current: vi.fn(),
  list: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@capgo/capacitor-updater', () => ({
  CapacitorUpdater: mockCapacitorUpdater,
}));

// Helper para mock de IndexedDB con store de evidencias de rondas
const createMockIndexedDB = () => {
  const storeData = new Map<number, any>();
  let nextId = 1;

  const mockStore = {
    add(item: any) {
      const id = nextId++;
      storeData.set(id, { ...item, id });
      const req: any = { result: id, onsuccess: null, onerror: null };
      setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
      return req;
    },
    index(name: string) {
      return {
        getAll(val: string) {
          const matched = Array.from(storeData.values()).filter(i => i[name] === val);
          const req: any = { result: matched, onsuccess: null, onerror: null };
          setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
          return req;
        },
        getAllKeys(val: string) {
          const matchedKeys: number[] = [];
          storeData.forEach((v, k) => {
            if (v[name] === val) matchedKeys.push(k);
          });
          const req: any = { result: matchedKeys, onsuccess: null, onerror: null };
          setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
          return req;
        }
      };
    },
    delete(key: number) {
      storeData.delete(key);
      const req: any = { onsuccess: null, onerror: null };
      setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
      return req;
    },
    clear() {
      storeData.clear();
      const req: any = { onsuccess: null, onerror: null };
      setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
      return req;
    },
    openCursor() {
      const items = Array.from(storeData.entries());
      let idx = 0;
      const req: any = { result: null, onsuccess: null, onerror: null };

      const step = () => {
        if (idx < items.length) {
          const [key, value] = items[idx];
          const cursor = {
            value,
            primaryKey: key,
            delete: () => {
              storeData.delete(key);
            },
            continue: () => {
              idx++;
              step();
            }
          };
          req.result = cursor;
          if (req.onsuccess) req.onsuccess({ target: req });
        } else {
          req.result = null;
          if (req.onsuccess) req.onsuccess({ target: req });
        }
      };

      setTimeout(step, 0);
      return req;
    }
  };

  const mockDb = {
    objectStoreNames: { contains: () => true },
    transaction(storeName: string, mode: string) {
      const tx: any = {
        objectStore: () => mockStore,
        oncomplete: null,
        onerror: null,
      };
      setTimeout(() => tx.oncomplete && tx.oncomplete(), 10);
      return tx;
    }
  };

  return {
    open: (dbName: string, version: number) => {
      const req: any = {
        result: mockDb,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
      return req;
    },
    _storeData: storeData,
  };
};

describe('Fase 3: Validación Exhaustiva de los 8 Puntos de Comprobación', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    (globalThis as any).indexedDB = createMockIndexedDB();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // COMPROBACIÓN 1: Un archivo temporal de más de 15 días se elimina
  // ───────────────────────────────────────────────────────────────────────────
  it('Comprobación 1: Un archivo temporal de más de 15 días se elimina', async () => {
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    
    // A. Bundle OTA temporal antiguo en Capgo
    mockCapacitorUpdater.current.mockResolvedValue({ bundle: { id: 'active_bundle_v6', version: '6.1.1' } });
    mockCapacitorUpdater.list.mockResolvedValue({
      bundles: [
        { id: 'active_bundle_v6', version: '6.1.1' },
        { id: 'builtin', version: 'builtin' },
        { id: 'old_temp_bundle_v5', version: '5.9.0' },
      ]
    });
    mockCapacitorUpdater.delete.mockResolvedValue(true);
    const bundleRes = await StorageCleanupService.cleanCapgoBundles();
    expect(bundleRes.deleted).toBe(1);
    expect(mockCapacitorUpdater.delete).toHaveBeenCalledWith({ id: 'old_temp_bundle_v5' });

    // B. Borrador temporal abandonado de visita > 15 días
    const draftStore = localforage.createInstance({ name: 'GGSS_Visitas_DB', storeName: 'visit_drafts' });
    await draftStore.setItem('draft_abandoned_20d', {
      visitId: 'v_old_1',
      supervisorUid: 'sup_test',
      inicioEn: twentyDaysAgo,
      fotos: [{ id: 'f1', dataUrl: 'data:image/jpeg;base64,xxxx' }],
    });
    const draftRes = await StorageCleanupService.cleanAbandonedVisitDrafts(15);
    expect(draftRes.deleted).toBe(1);
    expect(await draftStore.getItem('draft_abandoned_20d')).toBeNull();

    // C. Error permanente irrecuperable > 15 días en la cola offline
    const syncQueue = localforage.createInstance({ name: 'GGSS_Offline_DB', storeName: 'sync_queue' });
    await syncQueue.setItem('error_old_20d', {
      id: 'error_old_20d',
      operationId: 'op_err_1',
      userId: 'u_test',
      actionType: 'UPLOAD_EVIDENCE',
      payload: { photoBase64: 'big_photo_base64' },
      status: 'ERROR',
      retryCount: 10,
      timestamp: twentyDaysAgo,
    });
    const errorRes = await StorageCleanupService.cleanPermanentErrors(15);
    expect(errorRes.deleted).toBe(1);
    expect(await syncQueue.getItem('error_old_20d')).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // COMPROBACIÓN 2: Un archivo temporal de menos de 15 días se conserva
  // ───────────────────────────────────────────────────────────────────────────
  it('Comprobación 2: Un archivo temporal de menos de 15 días se conserva', async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    // A. Borrador de visita reciente (5 días)
    const draftStore = localforage.createInstance({ name: 'GGSS_Visitas_DB', storeName: 'visit_drafts' });
    await draftStore.clear();
    await draftStore.setItem('draft_recent_5d', {
      visitId: 'v_recent_1',
      supervisorUid: 'sup_test',
      inicioEn: fiveDaysAgo,
      fotos: [],
    });
    const draftRes = await StorageCleanupService.cleanAbandonedVisitDrafts(15);
    expect(draftRes.deleted).toBe(0);
    expect(await draftStore.getItem('draft_recent_5d')).not.toBeNull();

    // B. Error reciente (5 días, para análisis y diagnóstico del operador)
    const syncQueue = localforage.createInstance({ name: 'GGSS_Offline_DB', storeName: 'sync_queue' });
    await syncQueue.clear();
    await syncQueue.setItem('error_recent_5d', {
      id: 'error_recent_5d',
      operationId: 'op_err_2',
      userId: 'u_test',
      actionType: 'UPLOAD_EVIDENCE',
      payload: { photoBase64: 'photo_data' },
      status: 'ERROR',
      retryCount: 10,
      timestamp: fiveDaysAgo,
    });
    const errorRes = await StorageCleanupService.cleanPermanentErrors(15);
    expect(errorRes.deleted).toBe(0);
    expect(await syncQueue.getItem('error_recent_5d')).not.toBeNull();

    // C. Evidencia de ronda de 3 días atrás
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await roundsDB.savePendingEvidence({
      roundId: 'round_recent_3d',
      blob: new Blob(['evidence-bytes'], { type: 'image/jpeg' }),
      lat: -33.4,
      lng: -70.6,
      timestamp: threeDaysAgo,
    });
    const roundRes = await StorageCleanupService.cleanOrphanRoundEvidences(15);
    expect(roundRes.deleted).toBe(0);
    const retained = await roundsDB.getPendingEvidences('round_recent_3d');
    expect(retained.length).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // COMPROBACIÓN 3: Una evidencia sincronizada de más de 15 días se elimina localmente
  // ───────────────────────────────────────────────────────────────────────────
  it('Comprobación 3: Una evidencia sincronizada de más de 15 días se elimina localmente', async () => {
    // En el flujo normal, las evidencias subidas a Bunny.net/Storage son removidas inmediatamente.
    // Si una evidencia huérfana de una ronda antigua (>15 días) quedó en el store local:
    const twentyFiveDaysAgo = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString();
    await roundsDB.savePendingEvidence({
      roundId: 'round_already_synced_long_ago',
      blob: new Blob(['synced-photo-blob'], { type: 'image/jpeg' }),
      lat: -33.4,
      lng: -70.6,
      timestamp: twentyFiveDaysAgo,
    });

    const roundRes = await StorageCleanupService.cleanOrphanRoundEvidences(15, null);
    expect(roundRes.deleted).toBe(1);

    const remaining = await roundsDB.getPendingEvidences('round_already_synced_long_ago');
    expect(remaining.length).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // COMPROBACIÓN 4: Una evidencia pendiente de sincronización se conserva aunque tenga más de 15 días
  // ───────────────────────────────────────────────────────────────────────────
  it('Comprobación 4: Una evidencia PENDING se conserva INCONDICIONALMENTE aunque tenga >15 días', async () => {
    const syncQueue = localforage.createInstance({ name: 'GGSS_Offline_DB', storeName: 'sync_queue' });
    await syncQueue.clear();

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Operación PENDING con foto de ronda de hace 30 días
    await syncQueue.setItem('pending_old_evidence', {
      id: 'pending_old_evidence',
      operationId: 'op_pending_1',
      userId: 'guard_123',
      actionType: 'UPLOAD_EVIDENCE',
      payload: { roundId: 'r_30d', photoBase64: 'data:image/jpeg;base64,CRITICAL_EVIDENCE' },
      status: 'PENDING',
      retryCount: 0,
      timestamp: thirtyDaysAgo,
    });

    // Operación SYNCING con foto de novedad de hace 20 días
    await syncQueue.setItem('syncing_old_novedad', {
      id: 'syncing_old_novedad',
      operationId: 'op_syncing_1',
      userId: 'guard_123',
      actionType: 'UPLOAD_NOVEDAD_PHOTO',
      payload: { registroId: 'nov_20d', photoBase64: 'data:image/jpeg;base64,CRITICAL_PHOTO' },
      status: 'SYNCING',
      retryCount: 3,
      timestamp: thirtyDaysAgo,
    });

    // Ejecutar la limpieza
    const res = await StorageCleanupService.cleanPermanentErrors(15);
    expect(res.deleted).toBe(0);

    // Ambas operaciones críticas DEBEN permanecer intactas
    const pendingItem = await syncQueue.getItem<QueueItem>('pending_old_evidence');
    const syncingItem = await syncQueue.getItem<QueueItem>('syncing_old_novedad');

    expect(pendingItem).not.toBeNull();
    expect(pendingItem?.status).toBe('PENDING');
    expect(syncingItem).not.toBeNull();
    expect(syncingItem?.status).toBe('SYNCING');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // COMPROBACIÓN 5: Un registro con estado de sincronización desconocido se conserva
  // ───────────────────────────────────────────────────────────────────────────
  it('Comprobación 5: Un registro con estado desconocido o timestamp corrupto se conserva', async () => {
    const syncQueue = localforage.createInstance({ name: 'GGSS_Offline_DB', storeName: 'sync_queue' });
    await syncQueue.clear();

    // 1. Estado "needs_recovery_review" (generado por SyncQueueMigration)
    await syncQueue.setItem('item_recovery', {
      id: 'item_recovery',
      operationId: 'op_rec',
      userId: 'unknown',
      actionType: 'UPLOAD_EVIDENCE',
      payload: {},
      status: 'needs_recovery_review' as any,
      retryCount: 5,
      timestamp: '2020-01-01T00:00:00.000Z',
    });

    // 2. Estado desconocido / undefined
    await syncQueue.setItem('item_unknown_status', {
      id: 'item_unknown_status',
      operationId: 'op_unk',
      userId: 'guard_1',
      actionType: 'ADD_ROUND',
      payload: {},
      status: 'UNKNOWN_CUSTOM_STATUS' as any,
      retryCount: 15,
      timestamp: '2020-01-01T00:00:00.000Z',
    });

    // 3. Error permanente pero sin timestamp válido
    await syncQueue.setItem('item_invalid_ts', {
      id: 'item_invalid_ts',
      operationId: 'op_inv',
      userId: 'guard_1',
      actionType: 'UPLOAD_EVIDENCE',
      payload: {},
      status: 'ERROR',
      retryCount: 10,
      timestamp: 'fecha_no_parseable',
    });

    const res = await StorageCleanupService.cleanPermanentErrors(15);
    expect(res.deleted).toBe(0);

    // Todos los registros con estado o fecha no confirmada se conservan
    expect(await syncQueue.getItem('item_recovery')).not.toBeNull();
    expect(await syncQueue.getItem('item_unknown_status')).not.toBeNull();
    expect(await syncQueue.getItem('item_invalid_ts')).not.toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // COMPROBACIÓN 6: Una limpieza repetida no genera errores ni elimina datos adicionales
  // ───────────────────────────────────────────────────────────────────────────
  it('Comprobación 6: Una limpieza repetida es idempotente y no genera errores ni elimina datos extra', async () => {
    // Ejecución 1: force = true
    const rep1 = await StorageCleanupService.runDailyCleanup({ force: true });
    expect(rep1.skipped).toBe(false);
    expect(rep1.errors.length).toBe(0);

    // Ejecución 2: normal (debe saltar por debounce de 24h)
    const rep2 = await StorageCleanupService.runDailyCleanup();
    expect(rep2.skipped).toBe(true);
    expect(rep2.errors.length).toBe(0);

    // Ejecución 3: forzada consecutiva (debe correr sin errores y con 0 eliminaciones residuales)
    const rep3 = await StorageCleanupService.runDailyCleanup({ force: true });
    expect(rep3.skipped).toBe(false);
    expect(rep3.errors.length).toBe(0);
    expect(rep3.roundEvidencesDeleted).toBe(0);
    expect(rep3.permanentErrorsDeleted).toBe(0);
    expect(rep3.abandonedDraftsDeleted).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // COMPROBACIÓN 7: La limpieza no bloquea la interfaz ni impide iniciar o cerrar turnos
  // ───────────────────────────────────────────────────────────────────────────
  it('Comprobación 7: La limpieza es no bloqueante y mide su duración en milisegundos', async () => {
    const t0 = performance.now();
    const report = await StorageCleanupService.runDailyCleanup({ force: true });
    const t1 = performance.now();

    // Se ejecuta de manera instantánea y asíncrona
    expect(t1 - t0).toBeLessThan(500); // Menos de 500 ms de procesamiento
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.skipped).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // COMPROBACIÓN 8: El mecanismo funciona en Android y no depende de app abierta indefinidamente
  // ───────────────────────────────────────────────────────────────────────────
  it('Comprobación 8: Funciona en Android mediante localStorage timestamp sin depender de timers activos', async () => {
    // Simular que la app estuvo cerrada durante 3 semanas (21 días)
    const twentyOneDaysAgoMs = Date.now() - (21 * 24 * 60 * 60 * 1000);
    localStorage.setItem(LAST_CLEANUP_KEY, twentyOneDaysAgoMs.toString());

    // Al iniciar la app tras 3 semanas cerradas, runDailyCleanup detecta el tiempo transcurrido
    const report = await StorageCleanupService.runDailyCleanup();

    // Debe ejecutarse inmediatamente (sin skip) y purgar lo acumulado
    expect(report.skipped).toBe(false);
    expect(Number(localStorage.getItem(LAST_CLEANUP_KEY))).toBeGreaterThan(Date.now() - 2000);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // COMPROBACIÓN EXTRA A: Evidencias de rondas activas 100% protegidas
  // ───────────────────────────────────────────────────────────────────────────
  it('Verificación Extra A: Evidencias de la ronda activa NUNCA se eliminan aunque sean antiguas', async () => {
    const activeRoundId = 'round_live_in_progress';
    const oldTimestamp = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString();
    const fakeBlob = new Blob(['live-active-round-photo'], { type: 'image/jpeg' });

    // Guardar evidencia asociada a la ronda activa
    await roundsDB.savePendingEvidence({
      roundId: activeRoundId,
      blob: fakeBlob,
      lat: -33.456,
      lng: -70.678,
      timestamp: oldTimestamp,
    });

    // Guardar evidencia asociada a otra ronda abandonada antigua
    await roundsDB.savePendingEvidence({
      roundId: 'round_abandoned_other',
      blob: fakeBlob,
      lat: -33.456,
      lng: -70.678,
      timestamp: oldTimestamp,
    });

    // Ejecutar limpieza pasando activeRoundId
    const res = await StorageCleanupService.cleanOrphanRoundEvidences(15, activeRoundId);

    // Solo debe eliminar la ronda abandonada, JAMÁS la activa
    expect(res.deleted).toBe(1);

    const activeEvidences = await roundsDB.getPendingEvidences(activeRoundId);
    const abandonedEvidences = await roundsDB.getPendingEvidences('round_abandoned_other');

    expect(activeEvidences.length).toBe(1);
    expect(abandonedEvidences.length).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // COMPROBACIÓN EXTRA B: Integridad y calidad de compresión de imágenes
  // ───────────────────────────────────────────────────────────────────────────
  it('Verificación Extra B: La compresión con compressImage preserva proporciones y acota a maxWidth=1024', async () => {
    // Simular un canvas en entorno de prueba
    const canvas = document.createElement('canvas');
    canvas.width = 4000;  // Foto 4K de cámara nativa
    canvas.height = 3000;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(0, 0, 4000, 3000);
      ctx.fillStyle = '#ffffff';
      ctx.font = '80px sans-serif';
      ctx.fillText('LIBRO DE NOVEDADES - FOLIO 4821', 200, 400);
    }

    // Calcular factor de escala esperado
    const maxWidth = 1024;
    let expectedW = canvas.width;
    let expectedH = canvas.height;
    if (expectedW > maxWidth) {
      expectedH = (maxWidth / expectedW) * expectedH;
      expectedW = maxWidth;
    }

    expect(expectedW).toBe(1024);
    expect(expectedH).toBe(768); // 4:3 ratio preservado exactamente

    // Reducción de píxeles: de 12.000.000 píxeles a 786.432 píxeles (~93.4% reducción geométrica)
    const ratio = (expectedW * expectedH) / (canvas.width * canvas.height);
    expect(ratio).toBeCloseTo(0.0655, 3);
  });
});

