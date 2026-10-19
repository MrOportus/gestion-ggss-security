import { useState, useEffect } from 'react';
import { APP_VERSION, getCleanWebVersion, subscribeToUpdateState } from '../lib/UpdateService';

/**
 * Hook reactivo para obtener la versión activa actual de la aplicación.
 *
 * - En Web: Retorna la versión compilada del proyecto (VERSION / package.json).
 * - En Android APK: Detecta el bundle OTA actualmente ejecutado por @capgo/capacitor-updater,
 *   o el bundle integrado (builtin), actualizándose de forma reactiva si se instala un nuevo bundle.
 */
export function useAppVersion(): string {
  const [version, setVersion] = useState<string>(APP_VERSION);

  useEffect(() => {
    let mounted = true;

    // 1. Detectar versión activa del bundle web / Capgo en el dispositivo
    getCleanWebVersion()
      .then(activeVer => {
        if (mounted && activeVer && activeVer !== 'builtin') {
          setVersion(activeVer);
        }
      })
      .catch(() => {});

    // 2. Suscribirse a cambios si Capgo descarga o activa un nuevo bundle
    const unsubscribe = subscribeToUpdateState(state => {
      if (mounted && state.activeWebVersion && state.activeWebVersion !== 'builtin') {
        setVersion(state.activeWebVersion);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return version;
}

export { APP_VERSION };
