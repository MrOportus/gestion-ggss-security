import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Identificador único de la app (formato: com.empresa.app)
  appId: 'com.ggss.security',

  // Nombre visible de la app en el dispositivo
  appName: 'Sistema Aspro',

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

  plugins: {
    CapacitorUpdater: {
      autoUpdate: false,
      resetWhenUpdate: false
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
