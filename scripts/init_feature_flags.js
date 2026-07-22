import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// Cargar service account key
const serviceAccountPath = resolve(process.cwd(), 'serviceAccountKey.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function initFeatureFlags() {
  const flags = ['attendanceV2', 'attendanceV2Read'];

  for (const flag of flags) {
    const ref = db.collection('FeatureFlags').doc(flag);
    const doc = await ref.get();
    
    if (!doc.exists) {
      console.log(`[INIT] Creando FeatureFlag: ${flag}`);
      await ref.set({
        enabled: false,
        allowedUsers: [],
        allowedSites: [],
        updatedAt: new Date()
      });
    } else {
      console.log(`[INIT] Asegurando que FeatureFlag: ${flag} está APAGADO.`);
      await ref.update({
        enabled: false,
        updatedAt: new Date()
      });
    }
  }
  
  console.log('[INIT] Proceso completado exitosamente.');
  process.exit(0);
}

initFeatureFlags().catch(err => {
  console.error('[INIT] Error inicializando Feature Flags:', err);
  process.exit(1);
});
