// =====================================================
// firebase-messaging-sw.js
// Firebase Cloud Messaging Service Worker
// GGSS Security — Notificaciones Push
// =====================================================
// IMPORTANTE: Este archivo debe estar en /public y ser servido
// desde la raíz del dominio para que FCM pueda encontrarlo.

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

let messagingInstance = null;
let isInitialized = false;

// ── 1. Escuchar la config enviada desde el cliente ──────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FIREBASE_CONFIG' && !isInitialized) {
    try {
      firebase.initializeApp(event.data.config);
      messagingInstance = firebase.messaging();
      isInitialized = true;
      console.log('[FCM-SW] Firebase inicializado correctamente.');
      setupBackgroundHandler();
    } catch (e) {
      // Si ya está inicializada (segunda llamada), ignorar
      if (e.code !== 'app/duplicate-app') {
        console.error('[FCM-SW] Error inicializando Firebase:', e);
      }
    }
  }
});

// ── 2. Handler para mensajes en background ──────────────────────────────────
function setupBackgroundHandler() {
  if (!messagingInstance) return;

  messagingInstance.onBackgroundMessage((payload) => {
    console.log('[FCM-SW] Mensaje en background recibido:', payload);
    // No llamamos a self.registration.showNotification(title, options) aquí
    // porque Firebase ya muestra automáticamente la notificación si el payload
    // contiene el objeto 'notification'. Llamarlo aquí causaría duplicados.
  });
}

// ── 3. Click en notificación ────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  console.log('[FCM-SW] Click en notificación. Acción:', event.action);
  event.notification.close();

  if (event.action === 'dismiss') return;

  const docId      = event.notification.data?.docId;
  const urlToOpen  = '/';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Intentar enfocar una ventana existente y navegar a documentos
        for (const client of windowClients) {
          if ('focus' in client) {
            client.focus();
            // Notificar al cliente para que navegue a la sección de documentos
            client.postMessage({
              type:  'NAVIGATE_TO_DOCUMENTS',
              docId,
            });
            return;
          }
        }
        // Si no hay ventana abierta, abrir una nueva
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});
