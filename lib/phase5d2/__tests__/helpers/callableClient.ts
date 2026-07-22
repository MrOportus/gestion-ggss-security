import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import admin from 'firebase-admin';

// Re-use test environment if possible, or connect directly via client SDK
// We need the client SDK to get a real ID token.

const firebaseConfig = {
  apiKey: "fake-api-key",
  authDomain: "demo-ggss.firebaseapp.com",
  projectId: "demo-ggss",
};

let app;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`, { disableWarnings: true });
  
  const functions = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
} else {
  app = getApp();
}

const auth = getAuth(app);
const functions = getFunctions(app, 'us-central1');

/**
 * Creates a user in the auth emulator and ensures the claims are set via admin SDK,
 * then signs in to get the real ID Token and callable context.
 */
export async function createCallableUser(
  adminApp: admin.app.App, 
  uid: string, 
  role: string, 
  alcances?: { sucursales?: string[] }
) {
  const email = `${uid}@test.local`;
  const password = `password_${uid}`;
  
  // 1. Ensure user exists in Auth Emulator via Admin SDK (or create via client)
  try {
    await adminApp.auth().getUser(uid);
    // Delete and recreate to ensure clean state
    await adminApp.auth().deleteUser(uid);
  } catch (e) {
    // Doesn't exist, proceed
  }

  await adminApp.auth().createUser({
    uid,
    email,
    password,
  });

  // 2. Set role claim if needed (though our app mostly uses the Colaboradores doc)
  // Let's set the document in Firestore so validateBranchAccess works
  const db = adminApp.firestore();
  
  // Clean up previous test state
  await db.collection('Colaboradores').doc(uid).set({
    role,
    email
  });

  if (alcances && (role === 'jefe_operaciones' || role === 'supervisor')) {
    await db.collection('AlcancesOperativos').doc(uid).set(alcances);
  } else {
    // Delete just in case
    await db.collection('AlcancesOperativos').doc(uid).delete().catch(()=>null);
  }

  // 3. Sign in on the client to get the ID token
  await signInWithEmailAndPassword(auth, email, password);

  // Return a helper to call the specific function
  return {
    uid,
    callGetAttendanceShadowValidated: async (data: any) => {
      const getAttendanceShadowValidated = httpsCallable(functions, 'getAttendanceShadowValidated');
      return getAttendanceShadowValidated(data);
    },
    logout: async () => {
      await auth.signOut();
    }
  };
}

/**
 * Gets a callable wrapper for unauthenticated testing
 */
export function getUnauthenticatedCallable() {
  return async (data: any) => {
    // Sign out to ensure unauthenticated state
    await auth.signOut();
    const getAttendanceShadowValidated = httpsCallable(functions, 'getAttendanceShadowValidated');
    return getAttendanceShadowValidated(data);
  };
}
