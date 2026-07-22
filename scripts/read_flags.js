import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const serviceAccountPath = resolve(process.cwd(), 'serviceAccountKey.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function run() {
  const flags = ['attendanceV2', 'attendanceV2Read'];
  console.log('--- ESTADO DE FEATURE FLAGS ---');
  for (const flag of flags) {
    const doc = await db.collection('FeatureFlags').doc(flag).get();
    if (doc.exists) {
      const data = doc.data();
      console.log(`[${flag}]`);
      console.log(`  enabled: ${data.enabled}`);
      console.log(`  activationMode: ${data.activationMode || 'No definido (sucursales especificas)'}`);
      console.log(`  QA users count: ${(data.allowedUsers || []).length}`);
      console.log(`  sucursales count: ${(data.allowedSites || []).length}`);
      console.log(`  mes QA: ${data.mesQA || 'No definido'}`);
      console.log(`  updatedAt: ${data.updatedAt?.toDate()?.toISOString() || 'Desconocido'}`);
    } else {
      console.log(`[${flag}] NO EXISTE`);
    }
  }
}

run().catch(console.error).finally(() => process.exit(0));
