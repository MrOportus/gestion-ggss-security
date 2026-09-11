/**
 * SyncManager — Servicio centralizado de sincronización para Vista Guardia.
 * 
 * Responsabilidades:
 *   - Detectar operaciones PENDING y sincronizarlas
 *   - Ejecutar sincronización al: inicio de app, foreground, recuperar red
 *   - Detección práctica de conectividad (no confiar solo en navigator.onLine)
 *   - No bloquear la UI
 *   - Evitar sincronizaciones concurrentes
 * 
 * IMPORTANTE: Este servicio NO reemplaza processSyncQueue del store.
 * Actúa como orquestador que lo invoca en los momentos correctos.
 */

import { Network } from '@capacitor/network';
import { Capacitor } from '@capacitor/core';
import { SyncQueueService } from './SyncQueueService';
import { OfflineCache } from './OfflineCache';

type SyncCallback = () => Promise<void>;
type StatusCallback = (status: SyncManagerStatus) => void;

export interface SyncManagerStatus {
    pendingCount: number;
    errorCount: number;
    isSyncing: boolean;
    lastSyncAttempt: string | null;
    isOnline: boolean;
}

let _processSyncQueue: SyncCallback | null = null;
let _statusListeners: StatusCallback[] = [];
let _networkListener: any = null;
let _appStateListener: any = null;
let _initialized = false;
let _currentStatus: SyncManagerStatus = {
    pendingCount: 0,
    errorCount: 0,
    isSyncing: false,
    lastSyncAttempt: null,
    isOnline: true,
};

/** Actualiza el estado interno y notifica a los listeners */
async function _updateStatus(partial?: Partial<SyncManagerStatus>) {
    if (partial) {
        _currentStatus = { ..._currentStatus, ...partial };
    }
    
    // Actualizar contadores desde la cola
    try {
        const pendingCount = await SyncQueueService.getPendingCount();
        const errorCount = await SyncQueueService.getErrorCount();
        _currentStatus.pendingCount = pendingCount;
        _currentStatus.errorCount = errorCount;
    } catch (e) {
        // Si falla el acceso a la cola, mantener los valores actuales
    }
    
    // Notificar a todos los listeners
    _statusListeners.forEach(cb => {
        try { cb({ ..._currentStatus }); } catch (e) { }
    });
}

/** Intenta ejecutar una sincronización si hay condiciones */
async function _attemptSync() {
    if (!_processSyncQueue) return;
    if (_currentStatus.isSyncing) return;
    
    // Verificar conectividad real
    const isOnline = await checkRealConnectivity();
    await _updateStatus({ isOnline });
    
    if (!isOnline) {
        console.log('[SyncManager] Sin conectividad real. Posponiendo sincronización.');
        return;
    }
    
    // Verificar si hay items pendientes
    const pendingCount = await SyncQueueService.getPendingCount();
    if (pendingCount === 0) {
        await _updateStatus({ pendingCount: 0 });
        return;
    }
    
    console.log(`[SyncManager] Iniciando sincronización de ${pendingCount} items...`);
    await _updateStatus({ isSyncing: true, lastSyncAttempt: new Date().toISOString() });
    
    try {
        await _processSyncQueue();
    } catch (err) {
        console.error('[SyncManager] Error durante sincronización:', err);
    } finally {
        await _updateStatus({ isSyncing: false });
    }
}

/**
 * Verifica conectividad REAL con Firebase, no solo navigator.onLine.
 * Un timeout de 5s es suficiente para detectar 3G lento vs sin conexión.
 */
async function checkRealConnectivity(): Promise<boolean> {
    try {
        // Primer check rápido: Capacitor Network
        const status = await Network.getStatus();
        if (!status.connected) return false;
        
        // Segundo check: intentar un fetch real con timeout
        // Usamos la URL raíz de Firestore que responde rápido
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        
        try {
            const response = await fetch('https://www.googleapis.com/generate_204', {
                method: 'GET',
                mode: 'no-cors',
                signal: controller.signal,
                cache: 'no-store',
            });
            clearTimeout(timeout);
            return response.type === 'opaque' || response.ok || response.status === 204;
        } catch (fetchErr) {
            clearTimeout(timeout);
            // Si falla el fetch pero Capacitor dice que hay red,
            // es posible que sea 3G muy lento. Dar el beneficio de la duda
            // y dejar que processSyncQueue maneje el timeout individual.
            return status.connected;
        }
    } catch {
        return false;
    }
}

export const SyncManager = {
    /**
     * Inicializa el SyncManager.
     * Debe llamarse una vez cuando el usuario worker se autentica.
     * @param processSyncQueue - Función del store que procesa la cola
     */
    init(processSyncQueue: SyncCallback) {
        if (_initialized) {
            console.log('[SyncManager] Ya inicializado. Actualizando callback.');
            _processSyncQueue = processSyncQueue;
            return;
        }
        
        _processSyncQueue = processSyncQueue;
        _initialized = true;
        
        console.log('[SyncManager] Inicializando...');
        
        // 1. Sincronizar al iniciar
        setTimeout(() => _attemptSync(), 2000); // Delay para no competir con la carga inicial
        
        // 2. Escuchar cambios de red
        Network.addListener('networkStatusChange', async (status) => {
            console.log(`[SyncManager] Red cambió: connected=${status.connected}, type=${status.connectionType}`);
            await _updateStatus({ isOnline: status.connected });
            
            if (status.connected) {
                // Delay corto para que la conexión se estabilice
                setTimeout(() => _attemptSync(), 1500);
            }
        }).then(listener => {
            _networkListener = listener;
        });
        
        // 3. Escuchar cambio de estado de la app (foreground/background)
        if (Capacitor.isNativePlatform()) {
            import('@capacitor/app').then(({ App }) => {
                App.addListener('appStateChange', async ({ isActive }) => {
                    if (isActive) {
                        console.log('[SyncManager] App volvió a foreground.');
                        setTimeout(() => _attemptSync(), 1000);
                    }
                }).then(listener => {
                    _appStateListener = listener;
                });
            }).catch(err => {
                console.warn('[SyncManager] @capacitor/app no disponible:', err);
            });
        }
        
        // 4. Limpiar cache antiguo (no bloquea)
        OfflineCache.cleanOldShifts().catch(() => {});
        
        // 5. Limpiar items SYNCED huérfanos
        SyncQueueService.cleanSynced().catch(() => {});
        
        _updateStatus();
    },
    
    /** Fuerza un intento de sincronización */
    async triggerSync() {
        await _attemptSync();
    },
    
    /** Registra un listener de cambios de estado */
    onStatusChange(callback: StatusCallback): () => void {
        _statusListeners.push(callback);
        // Enviar estado actual inmediatamente
        callback({ ..._currentStatus });
        
        // Retorna función de cleanup
        return () => {
            _statusListeners = _statusListeners.filter(cb => cb !== callback);
        };
    },
    
    /** Obtiene el estado actual */
    getStatus(): SyncManagerStatus {
        return { ..._currentStatus };
    },
    
    /** Actualiza el estado (para que el store pueda informar cambios) */
    async refreshStatus() {
        await _updateStatus();
    },
    
    /** Limpia listeners y detiene el manager */
    destroy() {
        if (_networkListener) {
            _networkListener.remove();
            _networkListener = null;
        }
        if (_appStateListener) {
            _appStateListener.remove();
            _appStateListener = null;
        }
        _statusListeners = [];
        _processSyncQueue = null;
        _initialized = false;
        console.log('[SyncManager] Destruido.');
    }
};
