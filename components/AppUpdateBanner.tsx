
import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Download, X, RefreshCw, Smartphone, Zap } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { downloadAndInstallUpdate, notifyAppReady } from '../lib/UpdateService';

// ────────────────────────────────────────────────────────────────
// VERSIÓN ACTUAL DE LA APP (APK NATIVO)
// Este valor debe actualizarse manualmente (o con el script
// scripts/publish-version.js) cada vez que generes un nuevo APK.
// ────────────────────────────────────────────────────────────────
export const APP_VERSION = '2.0.0';

interface AppVersionConfig {
  version: string; // Versión del APK
  apkUrl: string; // URL del APK
  releaseNotes?: string;
  mandatory?: boolean; // Si es true, no se puede descartar el banner
  webVersion?: string; // Versión web (OTA)
  webUrl?: string; // URL del ZIP de actualización web (OTA)
}

const AppUpdateBanner: React.FC = () => {
  const [updateInfo, setUpdateInfo] = useState<AppVersionConfig | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  
  // Estados para actualizaciones OTA
  const [localWebVersion, setLocalWebVersion] = useState<string>(APP_VERSION);
  const [isApkUpdate, setIsApkUpdate] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);

  // Comparar versiones semánticas: "1.2.3" → [1, 2, 3]
  const isNewerVersion = (remote: string, local: string): boolean => {
    const parse = (v: string) => {
      const clean = v.replace(/^v/, '').split('-')[0];
      return clean.split('.').map(Number);
    };
    const [rMaj = 0, rMin = 0, rPatch = 0] = parse(remote);
    const [lMaj = 0, lMin = 0, lPatch = 0] = parse(local);
    if (rMaj !== lMaj) return rMaj > lMaj;
    if (rMin !== lMin) return rMin > lMin;
    return rPatch > lPatch;
  };

  // Obtiene la versión del bundle web actual
  const getCleanWebVersion = async (): Promise<string> => {
    if (!Capacitor.isNativePlatform()) return APP_VERSION;
    try {
      const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
      const currentBundle = await CapacitorUpdater.current();
      if (currentBundle && currentBundle.version && currentBundle.version !== 'builtin') {
        return currentBundle.version;
      }
    } catch (error) {
      console.warn('[UPDATE] Error obteniendo versión activa del bundle:', error);
    }
    return APP_VERSION;
  };

  const checkForUpdate = async () => {
    setIsChecking(true);
    try {
      const activeWebVer = await getCleanWebVersion();
      setLocalWebVersion(activeWebVer);

      const versionDoc = await getDoc(doc(db, 'app_config', 'version'));
      if (versionDoc.exists()) {
        const remoteConfig = versionDoc.data() as AppVersionConfig;
        
        // 1. Prioridad: Actualización de APK Nativo (cambios nativos requeridos)
        if (isNewerVersion(remoteConfig.version, APP_VERSION)) {
          setUpdateInfo(remoteConfig);
          setIsApkUpdate(true);
          setIsDismissed(false); // Mostrar de nuevo si hay actualización crítica de APK
        }
        // 2. Si no hay APK más nuevo, verificar si hay actualización web OTA (solo en celular nativo)
        else if (
          Capacitor.isNativePlatform() &&
          remoteConfig.webVersion &&
          remoteConfig.webUrl &&
          isNewerVersion(remoteConfig.webVersion, activeWebVer)
        ) {
          setUpdateInfo(remoteConfig);
          setIsApkUpdate(false);
          setIsDismissed(false);
        } else {
          setUpdateInfo(null);
        }
      }
    } catch (error) {
      console.warn('[UPDATE] Error verificando actualización:', error);
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    // Solo verificar si es la plataforma nativa de Android
    if (Capacitor.getPlatform() !== 'android') {
      return;
    }

    // Notificar al plugin que la app web cargó correctamente (evita rollback)
    notifyAppReady();

    // Chequear al montar
    checkForUpdate();

    // Re-chequear cada 30 minutos si la app sigue abierta
    const interval = setInterval(checkForUpdate, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Si no es Android o no hay actualización disponible, no renderizar
  if (Capacitor.getPlatform() !== 'android' || !updateInfo || (isDismissed && !updateInfo.mandatory)) {
    return null;
  }

  const handleAction = async () => {
    if (isApkUpdate) {
      // Abrir la URL del APK — el navegador/sistema descargará el archivo
      window.open(updateInfo.apkUrl, '_blank');
    } else {
      // Es una actualización OTA de assets web
      if (updateInfo.webUrl && updateInfo.webVersion) {
        setIsUpdating(true);
        try {
          await downloadAndInstallUpdate(updateInfo.webUrl, updateInfo.webVersion);
          // Nota: downloadAndInstallUpdate reinicia automáticamente la aplicación
        } catch (error) {
          console.error('[UPDATE] Error al aplicar actualización OTA:', error);
          alert('No se pudo aplicar la actualización web. Por favor, intenta de nuevo.');
        } finally {
          setIsUpdating(false);
        }
      }
    }
  };

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-[999] p-4 ${updateInfo.mandatory ? 'pb-6' : ''}`}
      style={{ animation: 'slideUp 0.4s ease-out' }}
    >
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>

      <div className="max-w-lg mx-auto bg-gradient-to-br from-blue-900 to-indigo-900 rounded-3xl shadow-2xl border border-blue-700/50 overflow-hidden">
        {/* Barra de acento superior */}
        <div className="h-1 bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400" />

        <div className="p-5">
          <div className="flex items-start gap-4">
            {/* Ícono */}
            <div className="w-12 h-12 bg-blue-500/20 rounded-2xl flex items-center justify-center shrink-0 border border-blue-400/30">
              {isApkUpdate ? (
                <Smartphone size={24} className="text-blue-300" />
              ) : (
                <Zap size={24} className="text-yellow-300 animate-pulse" />
              )}
            </div>

            {/* Contenido */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">
                  {isApkUpdate ? 'Nueva Versión Disponible' : 'Actualización de Sistema'}
                </span>
                <span className="px-2 py-0.5 bg-blue-500/30 text-blue-200 text-[10px] font-bold rounded-full border border-blue-400/30">
                  v{isApkUpdate ? updateInfo.version : updateInfo.webVersion}
                </span>
              </div>

              <p className="text-sm font-bold text-white leading-tight">
                {updateInfo.releaseNotes || (isApkUpdate ? 'Hay mejoras y correcciones disponibles para GGSS Security.' : 'Nueva actualización de características en vivo.')}
              </p>

              <p className="text-[11px] text-blue-300 mt-1 font-medium">
                Versión actual: <span className="text-blue-200">v{isApkUpdate ? APP_VERSION : localWebVersion}</span>
              </p>
            </div>

            {/* Botón cerrar (solo si no es obligatorio y no está actualizando) */}
            {!updateInfo.mandatory && !isUpdating && (
              <button
                onClick={() => setIsDismissed(true)}
                className="p-1.5 rounded-xl text-blue-400 hover:text-white hover:bg-white/10 transition-all shrink-0"
                title="Descartar"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Botón de actualización */}
          <button
            onClick={handleAction}
            disabled={isUpdating}
            className="mt-4 w-full py-3.5 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-400 hover:to-indigo-400 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg shadow-blue-900/50 flex items-center justify-center gap-2 transition-all active:scale-95 border-b-4 border-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUpdating ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                Instalando actualización...
              </>
            ) : (
              <>
                {isApkUpdate ? <Download size={18} /> : <RefreshCw size={18} />}
                {isApkUpdate ? 'Descargar Actualización' : 'Aplicar Actualización'}
              </>
            )}
          </button>

          {updateInfo.mandatory && (
            <p className="text-center text-[10px] text-blue-400 mt-2 font-bold uppercase tracking-wide">
              Esta actualización es requerida para continuar
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AppUpdateBanner;
