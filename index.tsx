import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

const root = createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// ── Service Worker Registration ─────────────────────────────────────────────
// Registramos firebase-messaging-sw.js como service worker principal.
// Este SW maneja tanto el caching (PWA) como las notificaciones push en background (FCM).
// NOTA: En entornos nativos Capacitor (Android/iOS), los Service Workers no están soportados
//       por el WebView. Detectamos el contexto nativo y saltamos el registro.
const isCapacitorNative = !!(window as any).Capacitor?.isNativePlatform?.();

if ('serviceWorker' in navigator && !isCapacitorNative) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      console.log('[SW] Registrado correctamente:', registration.scope);

      // Enviar la config Firebase al SW para que pueda inicializar FCM
      // Las env vars no están disponibles en el SW, así que se las pasamos por postMessage.
      const sendConfigToSW = (sw: ServiceWorker) => {
        sw.postMessage({
          type: 'FIREBASE_CONFIG',
          config: {
            apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
            authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
            storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
            appId:             import.meta.env.VITE_FIREBASE_APP_ID,
          },
        });
      };

      // Enviar config al SW activo (si existe)
      if (registration.active) {
        sendConfigToSW(registration.active);
      }

      // Cuando el SW se instala o activa por primera vez
      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (installingWorker) {
          installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'activated') {
              sendConfigToSW(installingWorker);
              if (navigator.serviceWorker.controller) {
                window.location.reload();
              }
            }
          });
        }
      });

      // Si un nuevo SW toma el control, enviarle la config también
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        const controller = navigator.serviceWorker.controller;
        if (controller) {
          sendConfigToSW(controller);
        }
      });

    } catch (err) {
      console.error('[SW] Error en registro:', err);
    }
  });
} else if (isCapacitorNative) {
  console.log('[SW] Registro de Service Worker omitido — entorno nativo Capacitor detectado.');
}