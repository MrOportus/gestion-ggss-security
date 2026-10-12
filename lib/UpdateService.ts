import { Capacitor } from '@capacitor/core';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { SyncQueueService } from './SyncQueueService';
import { SyncManager } from './SyncManager';

// Versión base del APK nativo instalado
export const APP_VERSION = '6.0.0';

export interface AppVersionConfig {
  version: string;        // Versión del APK nativo (ej. "6.0.0")
  apkUrl: string;         // URL del APK en Storage
  releaseNotes?: string;
  mandatory?: boolean;    // Si es true, actualización obligatoria
  webVersion?: string;    // Versión web OTA (ej. "6.0.7")
  webUrl?: string;        // URL del ZIP en Firebase Storage
}

export type AutoUpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready_next' | 'error';

export interface AutoUpdateState {
  status: AutoUpdateStatus;
  activeWebVersion: string;
  targetWebVersion: string | null;
  lastChecked: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  isApkUpdateAvailable: boolean;
  apkConfig: AppVersionConfig | null;
}

// Estado interno reactivo
let _updateState: AutoUpdateState = {
  status: 'idle',
  activeWebVersion: APP_VERSION,
  targetWebVersion: null,
  lastChecked: null,
  lastError: null,
  consecutiveFailures: 0,
  isApkUpdateAvailable: false,
  apkConfig: null,
};

type StateSubscriber = (state: AutoUpdateState) => void;
const _subscribers: Set<StateSubscriber> = new Set();

function _notifySubscribers() {
  const snapshot = { ..._updateState };
  _subscribers.forEach(cb => {
    try { cb(snapshot); } catch (e) { /* ignore */ }
  });
}

/**
 * Suscribirse a cambios en el estado de actualización.
 */
export function subscribeToUpdateState(callback: StateSubscriber): () => void {
  _subscribers.add(callback);
  callback({ ..._updateState });
  return () => {
    _subscribers.delete(callback);
  };
}

export function getUpdateState(): AutoUpdateState {
  return { ..._updateState };
}

// Locks y control de concurrencia
let _isChecking = false;
let _isDownloading = false;
let _isListenerInitialized = false;
let _retryTimeoutTimer: any = null;

/**
 * Compara versiones semánticas (soporta "6.0.7" vs "6.0.6", prefijos "v", sufijos).
 * Retorna true si 'remote' es estrictamente mayor que 'local'.
 */
export function isNewerVersion(remote: string, local: string): boolean {
  const parse = (v: string): number[] => {
    const clean = v.replace(/^v/, '').split('-')[0].trim();
    return clean.split('.').map(n => Number(n) || 0);
  };
  const [rMaj = 0, rMin = 0, rPatch = 0] = parse(remote);
  const [lMaj = 0, lMin = 0, lPatch = 0] = parse(local);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPatch > lPatch;
}

/**
 * Obtiene la versión limpia del bundle web actualmente activo en el dispositivo.
 */
export async function getCleanWebVersion(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return APP_VERSION;
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    const current = await CapacitorUpdater.current();
    if (current?.bundle?.version && current.bundle.version !== 'builtin') {
      return current.bundle.version;
    }
  } catch (error) {
    console.warn('[UpdateService] Error obteniendo versión activa del bundle:', error);
  }
  return APP_VERSION;
}

/**
 * Notifica al plugin Capgo que la app web cargó correctamente.
 * CRUCIAL: Debe llamarse inmediatamente en el arranque para evitar rollback automático.
 */
export async function notifyAppReady(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    await CapacitorUpdater.notifyAppReady();
    console.log('[UpdateService] App notificada como lista (notifyAppReady).');
  } catch (error) {
    console.error('[UpdateService] Error al notificar App lista:', error);
  }
}

/**
 * Evalúa si es seguro aplicar o preparar una actualización.
 * Garantiza que NO haya operaciones críticas en curso (cola offline, fotos subiendo, turnos).
 */
export async function isSafeToStageUpdate(): Promise<boolean> {
  try {
    const pendingCount = await SyncQueueService.getPendingCount();
    if (pendingCount > 0) {
      console.log(`[UpdateService] Aplazando: ${pendingCount} operaciones en cola offline.`);
      return false;
    }
    const syncStatus = SyncManager.getStatus();
    if (syncStatus.isSyncing) {
      console.log('[UpdateService] Aplazando: Sincronización en curso.');
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[UpdateService] Error evaluando estado de seguridad:', err);
    return true;
  }
}

/**
 * Ejecuta la verificación y descarga automática en segundo plano.
 * No interrumpe al guardia, es idempotente y tolerante a fallos.
 */
export async function performAutoUpdateCheck(options: { silent?: boolean; force?: boolean } = {}): Promise<void> {
  // Solo opera en Android nativo
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return;
  }

  // Evitar ejecuciones simultáneas
  if (_isChecking || _isDownloading) {
    console.log('[UpdateService] Chequeo o descarga ya en curso. Omitiendo.');
    return;
  }

  _isChecking = true;
  _updateState.status = 'checking';
  _notifySubscribers();

  try {
    const activeWebVer = await getCleanWebVersion();
    _updateState.activeWebVersion = activeWebVer;

    console.log(`[UpdateService] Verificando actualizaciones. Versión activa: v${activeWebVer}`);

    const versionDoc = await getDoc(doc(db, 'app_config', 'version'));
    if (!versionDoc.exists()) {
      console.log('[UpdateService] Documento app_config/version no existe.');
      _updateState.status = 'idle';
      _updateState.lastChecked = new Date();
      _notifySubscribers();
      return;
    }

    const remoteConfig = versionDoc.data() as AppVersionConfig;
    _updateState.lastChecked = new Date();

    // 1. Prioridad: Actualización de APK Nativo (cambios que requieren nuevo binario Android)
    if (remoteConfig.version && isNewerVersion(remoteConfig.version, APP_VERSION)) {
      console.log(`[UpdateService] Nueva versión nativa de APK detectada: v${remoteConfig.version} (actual: v${APP_VERSION})`);
      _updateState.isApkUpdateAvailable = true;
      _updateState.apkConfig = remoteConfig;
      _updateState.status = 'idle';
      _notifySubscribers();
      return;
    } else {
      _updateState.isApkUpdateAvailable = false;
      _updateState.apkConfig = null;
    }

    // 2. Actualización Web OTA Silenciosa y Automática
    if (
      remoteConfig.webVersion &&
      remoteConfig.webUrl &&
      isNewerVersion(remoteConfig.webVersion, activeWebVer)
    ) {
      const targetVer = remoteConfig.webVersion;
      const targetUrl = remoteConfig.webUrl;
      _updateState.targetWebVersion = targetVer;

      console.log(`[UpdateService] Actualización OTA detectada: v${targetVer} (actual: v${activeWebVer}). Iniciando gestión automática...`);

      const { CapacitorUpdater } = await import('@capgo/capacitor-updater');

      // Verificar si ya tenemos el bundle descargado previamente
      const bundleList = await CapacitorUpdater.list();
      const existingBundle = bundleList?.bundles?.find(
        b => b.version === targetVer && b.status === 'success'
      );

      if (existingBundle) {
        console.log(`[UpdateService] Bundle v${targetVer} ya descargado localmente (ID: ${existingBundle.id}). Preparando 'next'...`);
        
        // Validar que no haya operaciones críticas pendientes
        const safe = await isSafeToStageUpdate();
        if (safe) {
          await CapacitorUpdater.next({ id: existingBundle.id });
          _updateState.status = 'ready_next';
          _updateState.lastError = null;
          _updateState.consecutiveFailures = 0;
          console.log(`[UpdateService] Bundle v${targetVer} listo como 'next'. Se activará al cambiar a segundo plano.`);
        } else {
          console.log(`[UpdateService] Bundle v${targetVer} descargado, esperando momento seguro para 'next'.`);
          _updateState.status = 'idle';
        }
        _notifySubscribers();
        return;
      }

      // Descarga silenciosa en segundo plano
      _isDownloading = true;
      _updateState.status = 'downloading';
      _notifySubscribers();

      try {
        console.log(`[UpdateService] Descargando bundle v${targetVer} en segundo plano desde Storage...`);
        const downloadedBundle = await CapacitorUpdater.download({
          url: targetUrl,
          version: targetVer,
        });

        console.log(`[UpdateService] Bundle v${targetVer} descargado con éxito. ID: ${downloadedBundle.id}`);

        // Verificar condiciones de seguridad
        const safe = await isSafeToStageUpdate();
        if (safe) {
          await CapacitorUpdater.next({ id: downloadedBundle.id });
          _updateState.status = 'ready_next';
          _updateState.lastError = null;
          _updateState.consecutiveFailures = 0;
          console.log(`[UpdateService] Bundle v${targetVer} registrado como 'next'. Se aplicará al pasar a background.`);
        } else {
          console.log(`[UpdateService] Bundle v${targetVer} en disco. Se activará como 'next' al terminar tareas pendientes.`);
          _updateState.status = 'idle';
        }
      } catch (downloadErr: any) {
        console.error(`[UpdateService] Error descargando bundle v${targetVer}:`, downloadErr);
        _updateState.status = 'error';
        _updateState.lastError = downloadErr?.message || String(downloadErr);
        _updateState.consecutiveFailures += 1;
        _scheduleRetry(targetVer);
      } finally {
        _isDownloading = false;
      }
    } else {
      console.log(`[UpdateService] App actualizada al día (v${activeWebVer}).`);
      _updateState.status = 'idle';
      _updateState.targetWebVersion = null;
      _updateState.lastError = null;
      _updateState.consecutiveFailures = 0;
    }
  } catch (err: any) {
    console.warn('[UpdateService] Error en chequeo de actualizaciones:', err);
    _updateState.status = 'error';
    _updateState.lastError = err?.message || String(err);
    _updateState.consecutiveFailures += 1;
  } finally {
    _isChecking = false;
    _notifySubscribers();
  }
}

/**
 * Programa un reintento con retroceso exponencial ante fallas de red.
 */
function _scheduleRetry(targetVersion?: string) {
  if (_retryTimeoutTimer) {
    clearTimeout(_retryTimeoutTimer);
  }
  const delaySec = Math.min(30 * Math.pow(2, Math.min(_updateState.consecutiveFailures, 4)), 600);
  console.log(`[UpdateService] Programando reintento de descarga en ${delaySec}s (falla #${_updateState.consecutiveFailures})...`);
  
  _retryTimeoutTimer = setTimeout(() => {
    _retryTimeoutTimer = null;
    performAutoUpdateCheck();
  }, delaySec * 1000);
}

/**
 * Inicializa el listener del ciclo de vida y red para actualizaciones automáticas.
 * Idempotente: se ejecuta una sola vez.
 */
export function initAutoUpdateListener(): () => void {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return () => {};
  }

  if (_isListenerInitialized) {
    return () => {};
  }
  _isListenerInitialized = true;

  console.log('[UpdateService] Inicializando servicio de actualización automática en segundo plano...');

  // 1. Chequeo inicial retardado (4 segundos después del montaje para no competir con el login)
  const initialTimer = setTimeout(() => {
    performAutoUpdateCheck();
  }, 4000);

  // 2. Chequeo periódico cada 20 minutos
  const intervalTimer = setInterval(() => {
    performAutoUpdateCheck();
  }, 20 * 60 * 1000);

  // 3. Escuchar retorno a primer plano (appStateChange)
  let appStateHandle: any = null;
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', async ({ isActive }) => {
      if (isActive) {
        console.log('[UpdateService] App volvió a primer plano. Verificando versión activa...');
        // Verificar si la versión activa cambió tras background
        const currentVer = await getCleanWebVersion();
        if (currentVer !== _updateState.activeWebVersion) {
          console.log(`[UpdateService] ¡Actualización aplicada exitosamente! v${_updateState.activeWebVersion} → v${currentVer}`);
          _updateState.activeWebVersion = currentVer;
          _updateState.status = 'idle';
          _updateState.targetWebVersion = null;
          _notifySubscribers();
        } else {
          // Chequeo si hay algo pendiente
          performAutoUpdateCheck();
        }
      }
    }).then(h => { appStateHandle = h; }).catch(() => {});
  }).catch(() => {});

  // 4. Escuchar recuperación de conexión de red
  let networkHandle: any = null;
  import('@capacitor/network').then(({ Network }) => {
    Network.addListener('networkStatusChange', status => {
      if (status.connected) {
        console.log('[UpdateService] Conexión de red restablecida. Comprobando actualizaciones pendientes...');
        setTimeout(() => performAutoUpdateCheck(), 2000);
      }
    }).then(h => { networkHandle = h; }).catch(() => {});
  }).catch(() => {});

  // Cleanup
  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
    if (_retryTimeoutTimer) clearTimeout(_retryTimeoutTimer);
    if (appStateHandle) appStateHandle.remove();
    if (networkHandle) networkHandle.remove();
    _isListenerInitialized = false;
  };
}

/**
 * Función manual tradicional para forzar descarga y recarga inmediata.
 * Se conserva para compatibilidad de transición y fallback de diagnóstico.
 */
export async function downloadAndInstallUpdate(zipUrl: string, version: string): Promise<any> {
  try {
    console.log(`[UpdateService] Manual: Iniciando descarga de versión "${version}" desde: ${zipUrl}`);
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    
    const result = await CapacitorUpdater.download({
      url: zipUrl,
      version: version,
    });
    
    console.log(`[UpdateService] Manual: Versión "${version}" descargada con éxito. ID: ${result.id}`);
    console.log('[UpdateService] Manual: Aplicando versión y recargando WebView...');
    
    const setResult = await CapacitorUpdater.set({ id: result.id });
    await CapacitorUpdater.reload();
    return setResult;
  } catch (error) {
    console.error(`[UpdateService] Manual: Error descargando o aplicando la versión "${version}":`, error);
    throw error;
  }
}
