import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Identificador único de la app (formato: com.empresa.app)
  appId: 'com.ggss.security',

  // Nombre visible de la app en el dispositivo
  appName: 'GGSS Security',

  // Directorio de salida de Vite (build de producción)
  webDir: 'dist',

  // Configuración del servidor (solo para desarrollo — HMR en dispositivo físico)
  // Para activar: descomenta y pon la IP de tu máquina de desarrollo
  // server: {
  //   url: 'http://192.168.1.XXX:3000',
  //   cleartext: true,
  // },

  // Configuración específica por plataforma
  android: {
    // Permite cargar recursos mixtos (http) durante desarrollo si se necesita
    allowMixedContent: true,
    // Habilitar capturas de pantalla (requerido para algunos módulos)
    captureInput: true,
    // WebView en modo oscuro sigue la configuración del sistema
    webContentsDebuggingEnabled: true,
  },

  ios: {
    // Ruta del esquema de contenido para iOS WebKit
    contentInset: 'automatic',
    // Habilitar depuración del WebView desde Safari Dev Tools
    webContentsDebuggingEnabled: true,
  },

  // ─── LIVE UPDATES — Configuración para actualizaciones Over-The-Air (OTA) ───
  // Plugin: @capawesome/capacitor-live-update
  // Documentación: https://capawesome.io/plugins/live-update/
  //
  // Para activar Live Updates:
  //   1. Crea una cuenta en https://capawesome.io
  //   2. Crea una App en Capawesome Cloud
  //   3. Reemplaza los placeholders con tus valores reales
  //   4. Ejecuta: npx capawesome apps:bundles:create --path ./dist
  //
  plugins: {
    LiveUpdate: {
      // Token de la app en Capawesome Cloud (reemplazar con valor real)
      appId: 'PLACEHOLDER_CAPAWESOME_APP_ID',

      // Activar actualizaciones automáticas en background al abrir la app
      autoUpdateMethod: 'background',

      // Estrategia de actualización:
      //   'none'       — solo descarga, el usuario debe reiniciar
      //   'background' — descarga en segundo plano, aplica al siguiente arranque
      //   'always'     — aplica inmediatamente al abrir la app
      resetOnUpdate: false,
    },
    CapacitorUpdater: {
      autoUpdate: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
