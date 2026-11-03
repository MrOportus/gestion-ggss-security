import { describe, it, expect, beforeEach, vi } from 'vitest';
import localforage from 'localforage';
import { StorageCleanupService, STORAGE_RETENTION_DAYS, LAST_CLEANUP_KEY } from '../StorageCleanupService';
import { roundsDB, PendingEvidence } from '../../roundsDB';
import { SyncQueueService } from '../../SyncQueueService';
import { SyncQueueMigration } from '../../SyncQueueMigration';

// Mock de Capacitor
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
  },
}));

// Mock dinámico de @capgo/capacitor-updater
const mockCapacitorUpdater = {
  current: vi.fn(),
  list: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@capgo/capacitor-updater', () => ({
  CapacitorUpdater: mockCapacitorUpdater,
}));

// Mock liviano de indexedDB para RoundsOfflineDB en entorno Vitest/Node
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

describe('StorageCleanupService — Política de Retención de 15 Días', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    (globalThis as any).indexedDB = createMockIndexedDB();
  });

  describe('1. Cálculo de ventana de retención (getCutoffDate)', () => {
    it('calcula la fecha de corte exactamente a 15 días en el pasado', () => {
      const now = Date.now();
      const { cutoffIso, cutoffMs } = StorageCleanupService.getCutoffDate(STORAGE_RETENTION_DAYS);
      const expectedMs = now - (15 * 24 * 60 * 60 * 1000);

      // Margen de tolerancia de 1 segundo
      expect(Math.abs(cutoffMs - expectedMs)).toBeLessThan(1000);
      expect(new Date(cutoffIso).getTime()).toBe(cutoffMs);
    });
  });

  describe('2. Bundles OTA de Capgo (cleanCapgoBundles)', () => {
    it('elimina bundles inactivos antiguos pero conserva SIEMPRE el activo y el builtin', async () => {
      mockCapacitorUpdater.current.mockResolvedValue({
        bundle: { id: 'bundle_active_123', version: '6.1.1' },
      });

      mockCapacitorUpdater.list.mockResolvedValue({
        bundles: [
          { id: 'bundle_active_123', version: '6.1.1' }, // Activo -> CONSERVAR
          { id: 'builtin', version: 'builtin' },          // Base nativo -> CONSERVAR
          { id: 'bundle_old_001', version: '6.0.8' },     // Obsoleto -> ELIMINAR
          { id: 'bundle_old_002', version: '6.0.9' },     // Obsoleto -> ELIMINAR
        ],
      });

      mockCapacitorUpdater.delete.mockResolvedValue(true);

      const res = await StorageCleanupService.cleanCapgoBundles();

      expect(res.deleted).toBe(2);
      expect(mockCapacitorUpdater.delete).toHaveBeenCalledTimes(2);
      expect(mockCapacitorUpdater.delete).toHaveBeenCalledWith({ id: 'bundle_old_001' });
      expect(mockCapacitorUpdater.delete).toHaveBeenCalledWith({ id: 'bundle_old_002' });
      expect(mockCapacitorUpdater.delete).not.toHaveBeenCalledWith({ id: 'bundle_active_123' });
      expect(mockCapacitorUpdater.delete).not.toHaveBeenCalledWith({ id: 'builtin' });
    });
  });

  describe('3. Evidencias de rondas huérfanas en RoundsOfflineDB (cleanOrphanRoundEvidences)', () => {
    it('elimina evidencias > 15 días pero conserva recientes y las de la ronda activa', async () => {
      const now = Date.now();
      const twentyDaysAgo = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString();
      const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
      const fakeBlob = new Blob(['test-image'], { type: 'image/jpeg' });

      // 1. Evidencia huérfana de 20 días atrás (debe eliminarse)
      await roundsDB.savePendingEvidence({
        roundId: 'round_abandoned_old',
        blob: fakeBlob,
        lat: -33.4,
        lng: -70.6,
        timestamp: twentyDaysAgo,
      });

      // 2. Evidencia reciente de 2 días atrás (debe conservarse)
      await roundsDB.savePendingEvidence({
        roundId: 'round_recent',
        blob: fakeBlob,
        lat: -33.4,
        lng: -70.6,
        timestamp: twoDaysAgo,
      });

      // 3. Evidencia de ronda activa (incluso si fuese antigua, debe conservarse)
      await roundsDB.savePendingEvidence({
        roundId: 'round_currently_active',
        blob: fakeBlob,
        lat: -33.4,
        lng: -70.6,
        timestamp: twentyDaysAgo,
      });

      // 4. Evidencia con fecha inválida (debe conservarse por seguridad)
      await roundsDB.savePendingEvidence({
        roundId: 'round_unknown_date',
        blob: fakeBlob,
        lat: -33.4,
        lng: -70.6,
        timestamp: 'fecha_invalida',
      });

      // Ejecutar limpieza protegiendo 'round_currently_active'
      const res = await StorageCleanupService.cleanOrphanRoundEvidences(15, 'round_currently_active');

      expect(res.deleted).toBe(1);

      // Verificar que los otros 3 permanecen en IndexedDB
      const remainingOld = await roundsDB.getPendingEvidences('round_abandoned_old');
      const remainingRecent = await roundsDB.getPendingEvidences('round_recent');
      const remainingActive = await roundsDB.getPendingEvidences('round_currently_active');
      const remainingInvalid = await roundsDB.getPendingEvidences('round_unknown_date');

      expect(remainingOld.length).toBe(0);
      expect(remainingRecent.length).toBe(1);
      expect(remainingActive.length).toBe(1);
      expect(remainingInvalid.length).toBe(1);
    });
  });

  describe('4. Errores permanentes en SyncQueueService (cleanPermanentErrors)', () => {
    it('elimina solo ítems en ERROR con >= 10 reintentos y > 15 días, preservando PENDING y SYNCING', async () => {
      const syncQueue = localforage.createInstance({ name: 'GGSS_Offline_DB', storeName: 'sync_queue' });
      await syncQueue.clear();

      const now = Date.now();
      const twentyDaysAgo = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString();
      const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();

      // Ítem A: ERROR permanente antiguo (>15 días, retry 10) -> DEBE ELIMINARSE
      await syncQueue.setItem('item_err_old', {
        id: 'item_err_old',
        operationId: 'op_1',
        userId: 'u1',
        actionType: 'UPLOAD_EVIDENCE',
        payload: { photoBase64: 'heavy_data' },
        status: 'ERROR',
        retryCount: 10,
        timestamp: twentyDaysAgo,
      });

      // Ítem B: ERROR permanente reciente (5 días, retry 10) -> CONSERVAR
      await syncQueue.setItem('item_err_recent', {
        id: 'item_err_recent',
        operationId: 'op_2',
        userId: 'u1',
        actionType: 'UPLOAD_EVIDENCE',
        payload: { photoBase64: 'heavy_data' },
        status: 'ERROR',
        retryCount: 10,
        timestamp: fiveDaysAgo,
      });

      // Ítem C: PENDING antiguo (20 días, retry 0) -> CONSERVAR INDEFINIDAMENTE
      await syncQueue.setItem('item_pending_old', {
        id: 'item_pending_old',
        operationId: 'op_3',
        userId: 'u1',
        actionType: 'UPLOAD_EVIDENCE',
        payload: { photoBase64: 'heavy_data' },
        status: 'PENDING',
        retryCount: 0,
        timestamp: twentyDaysAgo,
      });

      // Ítem D: SYNCING antiguo (20 días) -> CONSERVAR
      await syncQueue.setItem('item_syncing_old', {
        id: 'item_syncing_old',
        operationId: 'op_4',
        userId: 'u1',
        actionType: 'UPLOAD_NOVEDAD_PHOTO',
        payload: { photoBase64: 'heavy_data' },
        status: 'SYNCING',
        retryCount: 2,
        timestamp: twentyDaysAgo,
      });

      const res = await StorageCleanupService.cleanPermanentErrors(15);
      expect(res.deleted).toBe(1);

      expect(await syncQueue.getItem('item_err_old')).toBeNull();
      expect(await syncQueue.getItem('item_err_recent')).not.toBeNull();
      expect(await syncQueue.getItem('item_pending_old')).not.toBeNull();
      expect(await syncQueue.getItem('item_syncing_old')).not.toBeNull();
    });
  });

  describe('5. Borradores de visitas de supervisor (cleanAbandonedVisitDrafts)', () => {
    it('elimina borradores > 15 días y conserva borradores recientes', async () => {
      const draftStore = localforage.createInstance({ name: 'GGSS_Visitas_DB', storeName: 'visit_drafts' });
      await draftStore.clear();

      const now = Date.now();
      const twentyDaysAgo = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString();
      const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();

      // Borrador antiguo abandonado
      await draftStore.setItem('draft_sup1', {
        visitId: 'v_old',
        supervisorUid: 'sup1',
        inicioEn: twentyDaysAgo,
        fotos: [],
      });

      // Borrador reciente
      await draftStore.setItem('draft_sup2', {
        visitId: 'v_recent',
        supervisorUid: 'sup2',
        inicioEn: threeDaysAgo,
        fotos: [],
      });

      const res = await StorageCleanupService.cleanAbandonedVisitDrafts(15);
      expect(res.deleted).toBe(1);

      expect(await draftStore.getItem('draft_sup1')).toBeNull();
      expect(await draftStore.getItem('draft_sup2')).not.toBeNull();
    });
  });

  describe('6. Respaldo de migración (cleanMigrationBackupSafe)', () => {
    it('no elimina backup si la migración tiene menos de 15 días o versión < 1', async () => {
      const backupStore = localforage.createInstance({ name: 'GGSS_Offline_DB', storeName: 'sync_queue_backup' });
      const migrationMeta = localforage.createInstance({ name: 'GGSS_Offline_DB', storeName: 'migration_meta' });
      await backupStore.setItem('backup_1', { data: 'old_backup' });

      // Caso 1: Versión no migrada (0)
      await migrationMeta.setItem('migrationVersion', 0);
      let res = await StorageCleanupService.cleanMigrationBackupSafe(15);
      expect(res.cleared).toBe(false);
      expect(await backupStore.getItem('backup_1')).not.toBeNull();

      // Caso 2: Versión 1 migrada hace solo 3 días
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      await migrationMeta.setItem('migrationVersion', 1);
      await migrationMeta.setItem('migrationTimestamp', threeDaysAgo);
      res = await StorageCleanupService.cleanMigrationBackupSafe(15);
      expect(res.cleared).toBe(false);
      expect(await backupStore.getItem('backup_1')).not.toBeNull();

      // Caso 3: Versión 1 migrada hace 25 días -> AHORA SÍ es seguro purgar
      const twentyFiveDaysAgo = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString();
      await migrationMeta.setItem('migrationTimestamp', twentyFiveDaysAgo);
      res = await StorageCleanupService.cleanMigrationBackupSafe(15);
      expect(res.cleared).toBe(true);
      expect(await backupStore.getItem('backup_1')).toBeNull();
    });
  });

  describe('7. Orquestador y control de frecuencia (runDailyCleanup)', () => {
    it('omite ejecuciones repetidas dentro de las 24 horas salvo force: true', async () => {
      // 1era ejecución
      const firstRun = await StorageCleanupService.runDailyCleanup({ force: true });
      expect(firstRun.skipped).toBe(false);
      expect(localStorage.getItem(LAST_CLEANUP_KEY)).not.toBeNull();

      // 2da ejecución inmediata (debe omitirse)
      const secondRun = await StorageCleanupService.runDailyCleanup();
      expect(secondRun.skipped).toBe(true);

      // 3ra ejecución con force: true (debe ejecutarse)
      const thirdRun = await StorageCleanupService.runDailyCleanup({ force: true });
      expect(thirdRun.skipped).toBe(false);
    });
  });
});
