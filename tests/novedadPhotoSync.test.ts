import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  localforageStores,
  updateDocMock,
  setDocMock,
  uploadBytesMock,
  uploadStringMock,
  getDownloadURLMock,
  arrayUnionMock,
} = vi.hoisted(() => ({
  localforageStores: new Map<string, Map<string, any>>(),
  updateDocMock: vi.fn(),
  setDocMock: vi.fn(),
  uploadBytesMock: vi.fn(),
  uploadStringMock: vi.fn(),
  getDownloadURLMock: vi.fn(),
  arrayUnionMock: vi.fn((...vals: unknown[]) => ({ __arrayUnion: vals.length === 1 ? vals[0] : vals })),
}));

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
      driver: () => 'asyncStorage',
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

vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: vi.fn(async () => ({ connected: true, connectionType: 'wifi' })),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  },
}));

vi.mock('../lib/firebase', () => ({
  db: {},
  auth: {},
  secondaryAuth: {},
  storage: {},
  functions: {},
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithCustomToken: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn((_storage: any, path: string) => ({ fullPath: path })),
  uploadBytes: (...args: any[]) => uploadBytesMock(...args),
  uploadString: (...args: any[]) => uploadStringMock(...args),
  getDownloadURL: (...args: any[]) => getDownloadURLMock(...args),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn((_db: any, col: string, id: string) => ({ col, id })),
  updateDoc: (...args: any[]) => updateDocMock(...args),
  deleteDoc: vi.fn(),
  setDoc: (...args: any[]) => setDocMock(...args),
  writeBatch: vi.fn(),
  getDoc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  Timestamp: { now: vi.fn() },
  arrayUnion: (...args: unknown[]) => arrayUnionMock(...args),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  deleteField: vi.fn(),
}));

import { useAppStore } from '../store/useAppStore';
import { SyncQueueService } from '../lib/SyncQueueService';

describe('UPLOAD_NOVEDAD_PHOTO en processSyncQueue', () => {
  beforeEach(async () => {
    localforageStores.clear();
    vi.clearAllMocks();

    useAppStore.setState({
      currentUser: {
        uid: 'guardia-1',
        email: 'guardia1@test.cl',
        name: 'Guardia Prueba',
        role: 'worker',
      } as any,
      isSyncing: false,
      novedades: [
        {
          id: 'reg_123',
          descripcion: 'prueba carga imagen',
        } as any,
      ],
    });

    uploadBytesMock.mockImplementation(async (storageRef: any) => ({ ref: storageRef }));
    uploadStringMock.mockImplementation(async (storageRef: any) => ({ ref: storageRef }));
    getDownloadURLMock.mockImplementation(
      async (storageRef: any) => `https://firebasestorage.googleapis.com/v0/b/test/o/${encodeURIComponent(storageRef.fullPath)}?alt=media&token=tok`
    );
    setDocMock.mockResolvedValue(undefined);
    updateDocMock.mockResolvedValue(undefined);
  });

  it('sube la foto a Storage, actualiza evidencias en Firestore y sincroniza state.novedades', async () => {
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
    await SyncQueueService.enqueue('UPLOAD_NOVEDAD_PHOTO', {
      registroId: 'reg_123',
      photoBlob: blob,
      photoIndex: 0,
    }, 'guardia-1');

    await useAppStore.getState().processSyncQueue();

    expect(uploadBytesMock).toHaveBeenCalledTimes(1);
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(updateDocMock).toHaveBeenCalledWith(
      { col: 'novedades', id: 'reg_123' },
      {
        evidencias: {
          __arrayUnion: expect.stringContaining('https://firebasestorage.googleapis.com/'),
        },
      }
    );

    const remaining = await SyncQueueService.getPending('guardia-1');
    expect(remaining).toHaveLength(0);

    const nov = useAppStore.getState().novedades.find((n: any) => n.id === 'reg_123') as any;
    expect(nov?.evidencias).toHaveLength(1);
    expect(nov?.evidencias?.[0]).toContain('https://firebasestorage.googleapis.com/');
  });

  it('si updateDoc falla en un ciclo, no agota MAX_RETRIES en loop ni re-sube a Storage en el siguiente reintento', async () => {
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
    await SyncQueueService.enqueue('UPLOAD_NOVEDAD_PHOTO', {
      registroId: 'reg_123',
      photoBlob: blob,
      photoIndex: 0,
    }, 'guardia-1');

    updateDocMock.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));

    // Primer ciclo: sube a Storage 1 vez, falla updateDoc 1 vez y conserva retryCount = 1 sin quemar los 10 reintentos
    await useAppStore.getState().processSyncQueue();

    expect(uploadBytesMock).toHaveBeenCalledTimes(1);
    expect(updateDocMock).toHaveBeenCalledTimes(1);

    const pendingAfterFailure = await SyncQueueService.getPending('guardia-1');
    expect(pendingAfterFailure).toHaveLength(1);
    expect(pendingAfterFailure[0].retryCount).toBe(1);
    expect(pendingAfterFailure[0].status).toBe('PENDING');
    expect(pendingAfterFailure[0].payload.uploadedUrl).toContain('https://firebasestorage.googleapis.com/');

    // Segundo ciclo (tras reglas OK): reutiliza uploadedUrl sin volver a subir el binario a Storage
    updateDocMock.mockResolvedValueOnce(undefined);
    await useAppStore.getState().processSyncQueue();

    expect(uploadBytesMock).toHaveBeenCalledTimes(1);
    expect(updateDocMock).toHaveBeenCalledTimes(2);
    expect(await SyncQueueService.getPending('guardia-1')).toHaveLength(0);
  });
});

