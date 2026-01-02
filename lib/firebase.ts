
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBJ-1CfRG63DvsD5Enp2Eys-WvGrenMljE",
  authDomain: "gen-lang-client-08607869-461c2.firebaseapp.com",
  projectId: "gen-lang-client-08607869-461c2",
  storageBucket: "gen-lang-client-08607869-461c2.firebasestorage.app",
  messagingSenderId: "1058074609900",
  appId: "1:1058074609900:web:a31516306067f7b55ffdc9",
  measurementId: "G-0WBLMDBZW2"
};

// 1. Inicializar App Principal
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// 2. Inicializar App Secundaria (Para crear usuarios sin cerrar sesión del Admin)
// Esto es necesario en aplicaciones puramente frontend para evitar que al crear un usuario
// nuevo, el SDK cierre la sesión del administrador actual.
const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
export const secondaryAuth = getAuth(secondaryApp);
