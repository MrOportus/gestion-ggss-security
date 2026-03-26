
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Plugin que genera firebase-messaging-sw.js dinámicamente
 * inyectando las variables de entorno VITE_FIREBASE_* en tiempo de build/dev.
 * Esto evita tener credenciales hardcodeadas en archivos estáticos.
 */
function generateFirebaseMessagingSW(): Plugin {
  const buildSWContent = (env: Record<string, string>) => `
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "${env.VITE_FIREBASE_API_KEY || ''}",
    authDomain: "${env.VITE_FIREBASE_AUTH_DOMAIN || ''}",
    projectId: "${env.VITE_FIREBASE_PROJECT_ID || ''}",
    storageBucket: "${env.VITE_FIREBASE_STORAGE_BUCKET || ''}",
    messagingSenderId: "${env.VITE_FIREBASE_MESSAGING_SENDER_ID || ''}",
    appId: "${env.VITE_FIREBASE_APP_ID || ''}",
    measurementId: "${env.VITE_FIREBASE_MEASUREMENT_ID || ''}"
});

var messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    var notificationTitle = payload.notification.title;
    var notificationOptions = {
        body: payload.notification.body,
        icon: '/logo.png'
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});
`.trimStart();

  let resolvedEnv: Record<string, string> = {};

  return {
    name: 'generate-firebase-messaging-sw',
    configResolved(config) {
      resolvedEnv = config.env;
    },
    // DEV: Servir el SW dinámicamente mediante middleware
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/firebase-messaging-sw.js') {
          res.setHeader('Content-Type', 'application/javascript');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(buildSWContent(resolvedEnv));
          return;
        }
        next();
      });
    },
    // BUILD: Emitir el SW como asset en la carpeta de salida (dist/)
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'firebase-messaging-sw.js',
        source: buildSWContent(resolvedEnv)
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), generateFirebaseMessagingSW()],
  server: {
    host: '0.0.0.0',
    port: 3000,
  }
});
