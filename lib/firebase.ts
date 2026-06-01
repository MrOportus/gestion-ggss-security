
import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getAuth, indexedDBLocalPersistence, initializeAuth } from "firebase/auth";
import { getMessaging, isSupported as isMessagingSupported } from "firebase/messaging";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";
import { Capacitor } from '@capacitor/core';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// 1. Inicializar App Principal con Caché Persistente (IndexedDB)
//    - persistentLocalCache: Almacena datos en disco para evitar re-lecturas al servidor
//    - persistentMultipleTabManager: Sincroniza el caché entre múltiples pestañas/WebViews
//    - Reduce drásticamente las lecturas de Firestore en cada recarga de la app
const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

// 2. Auth con persistencia indexedDB — compatible con WebViews de Capacitor (Android/iOS)
//    indexedDBLocalPersistence evita problemas de sesión en entornos sin localStorage completo
export const auth = initializeAuth(app, {
  persistence: indexedDBLocalPersistence,
});

export const storage = getStorage(app);
export const functions = getFunctions(app, "us-central1");

// 3. Messaging — solo inicializar en contexto Web (navegador con Service Worker)
//    En nativo, Capacitor usa su propio plugin (@capacitor/push-notifications)
//    y NO debe inicializarse el SDK web de Firebase Messaging
let messagingInstance: ReturnType<typeof getMessaging> | null = null;

if (!Capacitor.isNativePlatform()) {
  isMessagingSupported().then((supported) => {
    if (supported) {
      messagingInstance = getMessaging(app);
    }
  }).catch(() => {
    // Silencioso: entorno web sin soporte de messaging
  });
}

export const getMessagingInstance = () => messagingInstance;

// Exportar messaging para compatibilidad con código existente
// NUNCA se inicializa en nativo — protegido por Capacitor.isNativePlatform()
export const messaging = (() => {
  if (Capacitor.isNativePlatform()) return null as any;
  try {
    return getMessaging(app);
  } catch {
    return null as any;
  }
})();

// 4. Inicializar App Secundaria (Para crear usuarios sin cerrar sesión del Admin)
// Esto es necesario en aplicaciones puramente frontend para evitar que al crear un usuario
// nuevo, el SDK cierre la sesión del administrador actual.
const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
export const secondaryAuth = getAuth(secondaryApp);
