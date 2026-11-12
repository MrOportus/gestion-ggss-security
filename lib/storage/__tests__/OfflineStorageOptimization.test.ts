import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Suite unitaria enfocada en las optimizaciones OTA de almacenamiento offline:
 * - Coalescing O(1) y compactación histórica de UPDATE_ROUND en SyncQueueService
 * - Retención de 14 días offline en OfflineCache.cleanOldShifts
 * - Limpieza de pendingPoints post-sincronización y por antigüedad en roundsDB
 * - Recuperación segura de ítems SYNCING huérfanos en SyncQueueService
 * - Orquestación completa en StorageCleanupService.runDailyCleanup
 */

// ─── Store simulado de localforage separado por instance (name + storeName) ─
const localforageStores = new Map<string, Map<string, any>>();
let activeDriver = 'asyncStorage';

function getStoreMap(name: string): Map<string, any> {
  if (!localforageStores.has(name)) {
    localforageStores.set(name, new Map());
  }
  return localforageStores.get(name)!;
}

vi.mock('localforage', () => {
  const createInstance = vi.fn((opts: { name?: string; storeName?: string }) => {
    const storeKey = `${opts?.name || 'default'}::${opts?.storeName || 'kv'}`;
    return {
      driver: () => activeDriver,
      setItem: vi.fn(async (k: string, v: any) => {
        getStoreMap(storeKey).set(k, v);
        return v;
      }),
      getItem: vi.fn(async (k: string) => getStoreMap(storeKey).get(k) ?? null),
      removeItem: vi.fn(async (k: string) => {
        getStoreMap(storeKey).delete(k);
      }),
      clear: vi.fn(async () => {
        getStoreMap(storeKey).clear();
      }),
      iterate: vi.fn(async (cb: (val: any, key: string, idx: number) => void) => {
        let i = 0;
        for (const [k, v] of Array.from(getStoreMap(storeKey).entries())) {
          cb(v, k, i++);
        }
      }),
    };
  });

  return {
    default: {
      createInstance,
      LOCALSTORAGE: 'localStorageWrapper',
      INDEXEDDB: 'asyncStorage',
    },
    createInstance,
    LOCALSTORAGE: 'localStorageWrapper',
    INDEXEDDB: 'asyncStorage',
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  },
}));

// ─── Mock multi-store IndexedDB (pendingPoints + pendingEvidences aislados) ─
function createMultiStoreMockIDB() {
  const stores = new Map<string, Map<number, any>>([
    ['pendingPoints', new Map()],
    ['pendingEvidences', new Map()],
  ]);
  let autoId = 1;

  const ensureStore = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name)!;
  };

  const makeCursorRequest = (storeMap: Map<number, any>, tx: any) => {
    const entries = Array.from(storeMap.entries());
    let idx = 0;
    const req: any = { onsuccess: null, onerror: null };

    const advance = () => {
      if (idx < entries.length) {
        const [key, value] = entries[idx];
        const cursor = {
          key,
          value,
          delete: () => {
            storeMap.delete(key);
          },
          continue: () => {
            idx++;
            setTimeout(advance, 0);
          },
        };
        if (req.onsuccess) req.onsuccess({ target: { result: cursor } });
      } else {
        if (req.onsuccess) req.onsuccess({ target: { result: null } });
        if (tx.oncomplete) tx.oncomplete();
      }
    };

    setTimeout(advance, 0);
    return req;
  };

  const mockDB = {
    objectStoreNames: { contains: (n: string) => stores.has(n) },
    createObjectStore: vi.fn(),
    transaction: (storeName: string, _mode: string) => {
      const storeMap = ensureStore(storeName);
      const tx: any = { oncomplete: null, onerror: null, error: null };
      tx.objectStore = () => ({
        add: (val: any) => {
          const id = autoId++;
          storeMap.set(id, { ...val, id });
          const req: any = { result: id, onsuccess: null, onerror: null };
          setTimeout(() => {
            if (req.onsuccess) req.onsuccess();
            if (tx.oncomplete) tx.oncomplete();
          }, 0);
          return req;
        },
        openCursor: () => makeCursorRequest(storeMap, tx),
        index: (idxName: string) => ({
          getAllKeys: (keyVal: string) => {
            const keys = Array.from(storeMap.entries())
              .filter(([, v]) => v?.[idxName] === keyVal)
              .map(([k]) => k);
            const req: any = { result: keys, onsuccess: null, onerror: null };
            setTimeout(() => {
              if (req.onsuccess) req.onsuccess();
              if (tx.oncomplete) tx.oncomplete();
            }, 0);
            return req;
          },
          getAll: (keyVal: string) => {
            const vals = Array.from(storeMap.values()).filter(v => v?.[idxName] === keyVal);
            const req: any = { result: vals, onsuccess: null, onerror: null };
            setTimeout(() => {
              if (req.onsuccess) req.onsuccess();
            }, 0);
            return req;
          },
        }),
        delete: (key: number) => {
          storeMap.delete(key);
        },
      });
      return tx;
    },
  };

  (globalThis as any).indexedDB = {
    open: () => {
      const req: any = { result: mockDB, onupgradeneeded: null, onsuccess: null, onerror: null };
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    },
  };

  return stores;
}

describe('Offline Storage Optimizations (OTA)', () => {
  let idbStores: Map<string, Map<number, any>>;

  beforeEach(() => {
    localforageStores.clear();
    activeDriver = 'asyncStorage';
    idbStores = createMultiStoreMockIDB();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  describe('SyncQueueService — Coalescing O(1) y compactación UPDATE_ROUND', () => {
    it('fusiona múltiples UPDATE_ROUND pendientes de la misma ronda en 1 solo ítem preservando timestamp inicial', async () => {
      const { SyncQueueService } = await import('../../SyncQueueService');

      const first = await SyncQueueService.enqueue(
        'UPDATE_ROUND',
        { id: 'round_1', data: { points: [{ lat: -33.4, lng: -70.6 }] } },
        'user_1'
      );

      const second = await SyncQueueService.enqueue(
        'UPDATE_ROUND',
        {
          id: 'round_1',
          data: {
            points: [{ lat: -33.4, lng: -70.6 }, { lat: -33.41, lng: -70.61 }],
            status: 'completed',
          },
        },
        'user_1'
      );

      // Mismo ID y timestamp original, payload fusionado
      expect(second.id).toBe(first.id);
      expect(second.operationId).toBe(first.operationId);
      expect(second.timestamp).toBe(first.timestamp);
      expect(second.payload.data.points).toHaveLength(2);
      expect(second.payload.data.status).toBe('completed');

      // Ronda distinta NO se fusiona
      const otherRound = await SyncQueueService.enqueue(
        'UPDATE_ROUND',
        { id: 'round_2', data: { points: [{ lat: -33.5, lng: -70.5 }] } },
        'user_1'
      );
      expect(otherRound.id).not.toBe(first.id);

      const all = await SyncQueueService.getAllItems();
      expect(all).toHaveLength(2);
    });

    it('NO muta un ítem UPDATE_ROUND actualmente SYNCING / inFlight', async () => {
      const { SyncQueueService } = await import('../../SyncQueueService');

      const inFlightItem = await SyncQueueService.enqueue(
        'UPDATE_ROUND',
        { id: 'round_fly', data: { points: [{ lat: 1, lng: 1 }] } },
        'user_1'
      );
      await SyncQueueService.markSyncing(inFlightItem);

      const nextQueued = await SyncQueueService.enqueue(
        'UPDATE_ROUND',
        { id: 'round_fly', data: { status: 'completed' } },
        'user_1'
      );

      expect(nextQueued.id).not.toBe(inFlightItem.id);
      await SyncQueueService.markCompleted(inFlightItem.id);

      const remaining = await SyncQueueService.getAllItems();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(nextQueued.id);
    });

    it('compactPendingUpdateRounds() consolida duplicados históricos O(N²) en orden cronológico sin borrar SYNCING', async () => {
      const { SyncQueueService } = await import('../../SyncQueueService');
      const queueMap = getStoreMap('GGSS_Offline_DB::sync_queue');

      const ts1 = new Date(Date.now() - 120_000).toISOString();
      const ts2 = new Date(Date.now() - 60_000).toISOString();
      const ts3 = new Date(Date.now() - 10_000).toISOString();

      queueMap.set('sq_1', {
        id: 'sq_1',
        operationId: 'op_1',
        userId: 'u1',
        actionType: 'UPDATE_ROUND',
        payload: { id: 'r_hist', data: { points: [1] } },
        status: 'PENDING',
        timestamp: ts1,
        retryCount: 0,
      });
      queueMap.set('sq_2', {
        id: 'sq_2',
        operationId: 'op_2',
        userId: 'u1',
        actionType: 'UPDATE_ROUND',
        payload: { id: 'r_hist', data: { points: [1, 2] } },
        status: 'ERROR',
        timestamp: ts2,
        retryCount: 2,
      });
      queueMap.set('sq_3', {
        id: 'sq_3',
        operationId: 'op_3',
        userId: 'u1',
        actionType: 'UPDATE_ROUND',
        payload: { id: 'r_hist', data: { points: [1, 2, 3], status: 'completed' } },
        status: 'PENDING',
        timestamp: ts3,
        retryCount: 0,
      });
      // Ítem activo SYNCING debe preservarse intacto
      queueMap.set('sq_sync', {
        id: 'sq_sync',
        operationId: 'op_sync',
        userId: 'u1',
        actionType: 'UPDATE_ROUND',
        payload: { id: 'r_hist', data: { extra: true } },
        status: 'SYNCING',
        timestamp: ts3,
        retryCount: 0,
      });

      const res = await SyncQueueService.compactPendingUpdateRounds();
      expect(res.merged).toBe(1);
      expect(res.removed).toBe(2);

      const all = await SyncQueueService.getAllItems();
      expect(all).toHaveLength(2);
      const keeper = all.find(i => i.id === 'sq_1')!;
      expect(keeper.timestamp).toBe(ts1);
      expect(keeper.payload.data.points).toEqual([1, 2, 3]);
      expect(keeper.payload.data.status).toBe('completed');
      expect(keeper.status).toBe('PENDING');
      expect(all.some(i => i.id === 'sq_sync')).toBe(true);
    });

    it('recoverStaleSyncingItems() recupera ítems SYNCING bloqueados y detecta driver Blob vs LocalStorage', async () => {
      const { SyncQueueService } = await import('../../SyncQueueService');
      const queueMap = getStoreMap('GGSS_Offline_DB::sync_queue');

      expect(SyncQueueService.supportsBlobPayloads()).toBe(true);
      activeDriver = 'localStorageWrapper';
      expect(SyncQueueService.supportsBlobPayloads()).toBe(false);
      activeDriver = 'asyncStorage';

      queueMap.set('sq_stale', {
        id: 'sq_stale',
        operationId: 'op_stale',
        userId: 'u1',
        actionType: 'ADD_NOVEDAD',
        payload: { id: 'n1' },
        status: 'SYNCING',
        timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
        lastAttemptAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        retryCount: 1,
      });

      const recovered = await SyncQueueService.recoverStaleSyncingItems('u1');
      expect(recovered).toBe(1);
      expect(queueMap.get('sq_stale').status).toBe('PENDING');
    });
  });

  describe('OfflineCache — Retención de 14 días offline', () => {
    it('elimina solo turnos > 14 días y conserva turnos recientes y empleados', async () => {
      const { OfflineCache } = await import('../../OfflineCache');
      const cacheMap = getStoreMap('GGSS_Offline_DB::offline_cache');

      const dayMs = 24 * 60 * 60 * 1000;
      cacheMap.set('shift_emp1_old', {
        employeeId: 'emp1',
        date: '2026-01-01',
        cachedAt: new Date(Date.now() - 15 * dayMs).toISOString(),
      });
      cacheMap.set('shift_emp1_recent', {
        employeeId: 'emp1',
        date: '2026-01-10',
        cachedAt: new Date(Date.now() - 13 * dayMs).toISOString(),
      });
      cacheMap.set('employee_emp1', {
        id: 'emp1',
        cachedAt: new Date(Date.now() - 30 * dayMs).toISOString(),
      });

      const deleted = await OfflineCache.cleanOldShifts();
      expect(deleted).toBe(1);
      expect(cacheMap.has('shift_emp1_old')).toBe(false);
      expect(cacheMap.has('shift_emp1_recent')).toBe(true);
      expect(cacheMap.has('employee_emp1')).toBe(true);
    });
  });

  describe('roundsDB — Purga de pendingPoints sin dañar ronda activa ni evidencias', () => {
    it('clearPointsForRound() limpia únicamente puntos de esa ronda y clearPointsOlderThan() protege ronda activa', async () => {
      const { roundsDB } = await import('../../roundsDB');
      const pointsMap = idbStores.get('pendingPoints')!;
      const evMap = idbStores.get('pendingEvidences')!;

      const dayMs = 24 * 60 * 60 * 1000;
      const oldTs = new Date(Date.now() - 20 * dayMs).toISOString();
      const recentTs = new Date(Date.now() - 2 * dayMs).toISOString();

      pointsMap.set(1, { id: 1, roundId: 'round_done', timestamp: recentTs, lat: -33.4, lng: -70.6 });
      pointsMap.set(2, { id: 2, roundId: 'round_orphan', timestamp: oldTs, lat: -33.4, lng: -70.6 });
      pointsMap.set(3, { id: 3, roundId: 'round_active', timestamp: oldTs, lat: -33.4, lng: -70.6 });
      pointsMap.set(4, { id: 4, roundId: 'round_recent', timestamp: recentTs, lat: -33.4, lng: -70.6 });
      evMap.set(10, { id: 10, roundId: 'round_done', timestamp: recentTs, blob: new Blob(['x']), index: 0 });

      const removedDone = await roundsDB.clearPointsForRound('round_done');
      expect(removedDone).toBe(1);
      expect(pointsMap.has(1)).toBe(false);
      expect(evMap.has(10)).toBe(true);

      const cutoffIso = new Date(Date.now() - 15 * dayMs).toISOString();
      const removedOld = await roundsDB.clearPointsOlderThan(cutoffIso, 'round_active');
      expect(removedOld).toBe(1);
      expect(pointsMap.has(2)).toBe(false);
      expect(pointsMap.has(3)).toBe(true);
      expect(pointsMap.has(4)).toBe(true);
    });
  });

  describe('StorageCleanupService.runDailyCleanup — Integración completa 8 etapas', () => {
    it('reporta roundPointsDeleted, syncQueueCompactedRemoved y shiftCacheCleaned sin borrar pendientes válidos', async () => {
      const { StorageCleanupService, OFFLINE_CACHE_RETENTION_DAYS } = await import('../StorageCleanupService');
      const dayMs = 24 * 60 * 60 * 1000;

      // 1. Punto GPS huérfano > 15 días + punto de ronda activa
      const pointsMap = idbStores.get('pendingPoints')!;
      pointsMap.set(1, { id: 1, roundId: 'round_old', timestamp: new Date(Date.now() - 20 * dayMs).toISOString() });
      pointsMap.set(2, { id: 2, roundId: 'round_act', timestamp: new Date(Date.now() - 20 * dayMs).toISOString() });

      // 2. Duplicados UPDATE_ROUND heredados
      const queueMap = getStoreMap('GGSS_Offline_DB::sync_queue');
      queueMap.set('q1', {
        id: 'q1',
        operationId: 'op1',
        userId: 'u1',
        actionType: 'UPDATE_ROUND',
        payload: { id: 'r1', data: { step: 1 } },
        status: 'PENDING',
        timestamp: new Date(Date.now() - 60_000).toISOString(),
        retryCount: 0,
      });
      queueMap.set('q2', {
        id: 'q2',
        operationId: 'op2',
        userId: 'u1',
        actionType: 'UPDATE_ROUND',
        payload: { id: 'r1', data: { step: 2 } },
        status: 'PENDING',
        timestamp: new Date(Date.now() - 30_000).toISOString(),
        retryCount: 0,
      });

      // 3. Shift cache > 14 días
      const cacheMap = getStoreMap('GGSS_Offline_DB::offline_cache');
      cacheMap.set('shift_u1_exp', {
        employeeId: 'u1',
        date: '2026-01-01',
        cachedAt: new Date(Date.now() - (OFFLINE_CACHE_RETENTION_DAYS + 2) * dayMs).toISOString(),
      });

      const report = await StorageCleanupService.runDailyCleanup({
        force: true,
        activeRoundId: 'round_act',
      });

      expect(report.skipped).toBe(false);
      expect(report.errors).toEqual([]);
      expect(report.roundPointsDeleted).toBe(1);
      expect(report.syncQueueCompactedRemoved).toBe(1);
      expect(report.shiftCacheCleaned).toBe(true);
      expect(pointsMap.has(2)).toBe(true);
      expect(queueMap.size).toBe(1);
      expect(cacheMap.has('shift_u1_exp')).toBe(false);
    });
  });
});

