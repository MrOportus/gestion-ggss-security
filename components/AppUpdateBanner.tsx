import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Download, X, RefreshCw, Smartphone, AlertTriangle } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import {
  APP_VERSION,
  subscribeToUpdateState,
  performAutoUpdateCheck,
  downloadAndInstallUpdate,
  AutoUpdateState,
} from '../lib/UpdateService';

export { APP_VERSION };

const AppUpdateBanner: React.FC = () => {
  const showConfirmation = useAppStore(state => state.showConfirmation);
  const [updateState, setUpdateState] = useState<AutoUpdateState>({
    status: 'idle',
    activeWebVersion: APP_VERSION,
    targetWebVersion: null,
    lastChecked: null,
    lastError: null,
    consecutiveFailures: 0,
    isApkUpdateAvailable: false,
    apkConfig: null,
  });

  const [isDismissed, setIsDismissed] = useState(false);
  const [isManualUpdating, setIsManualUpdating] = useState(false);

  useEffect(() => {
    // Solo operar en la plataforma nativa de Android
    if (Capacitor.getPlatform() !== 'android') {
      return;
    }

    // Suscribirse a los cambios del servicio de actualización automática
    const unsubscribe = subscribeToUpdateState(state => {
      setUpdateState(state);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Si no es Android, no renderizar nada
  if (Capacitor.getPlatform() !== 'android') {
    return null;
  }

  const { isApkUpdateAvailable, apkConfig, status, consecutiveFailures, targetWebVersion, lastError } = updateState;

  // CASO 1: Actualización de APK Nativo requerida (cambios nativos, plugins nuevos, etc.)
  // Este caso SIEMPRE requiere intervención del usuario para descargar el binario APK.
  if (isApkUpdateAvailable && apkConfig && (!isDismissed || apkConfig.mandatory)) {
    const handleDownloadApk = () => {
      if (apkConfig.apkUrl) {
        window.open(apkConfig.apkUrl, '_blank');
      }
    };

    return (
      <div
        className={`fixed bottom-0 left-0 right-0 z-[999] p-4 ${apkConfig.mandatory ? 'pb-6' : ''}`}
        style={{ animation: 'slideUp 0.4s ease-out' }}
      >
        <style>{`
          @keyframes slideUp {
            from { transform: translateY(100%); opacity: 0; }
            to   { transform: translateY(0);    opacity: 1; }
          }
        `}</style>

        <div className="max-w-lg mx-auto bg-gradient-to-br from-blue-900 to-indigo-900 rounded-3xl shadow-2xl border border-blue-700/50 overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400" />
          <div className="p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-blue-500/20 rounded-2xl flex items-center justify-center shrink-0 border border-blue-400/30">
                <Smartphone size={24} className="text-blue-300" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">
                    Nueva Versión Nativa (APK)
                  </span>
                  <span className="px-2 py-0.5 bg-blue-500/30 text-blue-200 text-[10px] font-bold rounded-full border border-blue-400/30">
                    v{apkConfig.version}
                  </span>
                </div>

                <p className="text-sm font-bold text-white leading-tight">
                  {apkConfig.releaseNotes || 'Hay una nueva actualización de la aplicación disponible.'}
                </p>

                <p className="text-[11px] text-blue-300 mt-1 font-medium">
                  Versión actual instalada: <span className="text-blue-200">v{APP_VERSION}</span>
                </p>
              </div>

              {!apkConfig.mandatory && (
                <button
                  onClick={() => setIsDismissed(true)}
                  className="p-1.5 rounded-xl text-blue-400 hover:text-white hover:bg-white/10 transition-all shrink-0"
                  title="Descartar"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <button
              onClick={handleDownloadApk}
              className="mt-4 w-full py-3.5 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-400 hover:to-indigo-400 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg shadow-blue-900/50 flex items-center justify-center gap-2 transition-all active:scale-95 border-b-4 border-blue-700"
            >
              <Download size={18} />
              Descargar Actualización
            </button>

            {apkConfig.mandatory && (
              <p className="text-center text-[10px] text-blue-400 mt-2 font-bold uppercase tracking-wide">
                Esta actualización es requerida para continuar
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // CASO 2: Error Crítico y Persistente en Actualización OTA (Fallback de rescate / diagnóstico)
  // Solo se muestra si han ocurrido múltiples fallas consecutivas para dar al usuario una opción de recuperación manual.
  if (status === 'error' && consecutiveFailures >= 5 && targetWebVersion && !isDismissed) {
    const handleRetryManual = async () => {
      setIsManualUpdating(true);
      try {
        await performAutoUpdateCheck({ force: true });
      } catch (err) {
        showConfirmation({
          title: "Error al actualizar",
          message: "No se pudo completar la actualización automática. Se reintentará en segundo plano.",
          type: 'alert',
          onConfirm: () => {}
        });
      } finally {
        setIsManualUpdating(false);
      }
    };

    return (
      <div className="fixed bottom-0 left-0 right-0 z-[999] p-4" style={{ animation: 'slideUp 0.4s ease-out' }}>
        <div className="max-w-lg mx-auto bg-gradient-to-br from-amber-900 to-rose-950 rounded-3xl shadow-2xl border border-amber-600/40 p-5 text-white">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-amber-500/20 rounded-2xl flex items-center justify-center shrink-0 border border-amber-500/30">
              <AlertTriangle size={20} className="text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-black text-amber-300 uppercase tracking-widest block">
                Reintento de Actualización OTA
              </span>
              <p className="text-xs text-slate-200 mt-1">
                La actualización v{targetWebVersion} tuvo inconvenientes de red. El sistema continuará intentando automáticamente.
              </p>
              {lastError && (
                <p className="text-[10px] text-amber-200/70 mt-1 truncate">
                  Detalle: {lastError}
                </p>
              )}
            </div>
            <button
              onClick={() => setIsDismissed(true)}
              className="p-1 text-slate-400 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
          <button
            onClick={handleRetryManual}
            disabled={isManualUpdating}
            className="mt-3 w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
          >
            {isManualUpdating ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {isManualUpdating ? 'Reintentando...' : 'Reintentar Ahora'}
          </button>
        </div>
      </div>
    );
  }

  // En cualquier otro caso (OTA descargando silenciosamente, OTA lista como 'next', o app al día):
  // CERO INTERRUPCIÓN: No se muestra banner invasivo ni se exige pulsar botones.
  return null;
};

export default AppUpdateBanner;
