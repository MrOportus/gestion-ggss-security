import { CapacitorUpdater } from '@capgo/capacitor-updater';

/**
 * Descarga e instala una actualización OTA (Live Update) en el dispositivo nativo.
 * 
 * @param zipUrl URL del archivo ZIP conteniendo los assets actualizados (ej. Firebase Storage).
 * @param version Identificador o número de versión (ej. "1.0.1").
 * @returns El resultado de aplicar la actualización.
 */
export async function downloadAndInstallUpdate(zipUrl: string, version: string): Promise<any> {
  try {
    console.log(`[UpdateService] Iniciando descarga de versión "${version}" desde: ${zipUrl}`);
    
    // Descarga el bundle del servidor
    const result = await CapacitorUpdater.download({
      url: zipUrl,
      version: version
    });
    
    console.log(`[UpdateService] Versión "${version}" descargada con éxito. ID del bundle: ${result.id}`);
    
    // Aplica la versión y recarga el WebView
    console.log('[UpdateService] Aplicando actualización y reiniciando app...');
    const setResult = await CapacitorUpdater.set({ id: result.id });
    
    return setResult;
  } catch (error) {
    console.error(`[UpdateService] Error descargando o aplicando la versión "${version}":`, error);
    throw error;
  }
}

/**
 * Notifica al plugin que la app web se ha cargado correctamente.
 * Es crucial llamar a esta función durante el inicio de la aplicación para evitar
 * que el plugin realice un rollback automático (reversión de versión) por considerar
 * que la nueva versión es inestable.
 */
export async function notifyAppReady(): Promise<void> {
  try {
    await CapacitorUpdater.notifyAppReady();
    console.log('[UpdateService] App notificada como lista (notifyAppReady).');
  } catch (error) {
    console.error('[UpdateService] Error al notificar App lista:', error);
  }
}
