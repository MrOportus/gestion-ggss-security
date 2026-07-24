const admin = require('firebase-admin');

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'demo-project' });
}

async function seed() {
  const db = admin.firestore();
  
  const flagRef = db.collection('FeatureFlags').doc('contractEligibilityV2');
  
  await flagRef.set({
    mode: 'disabled',
    enabled: false,
    canaryBranches: [],
    canaryMonths: [],
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
    schemaVersion: 1
  });
  
  console.log('Feature flag contractEligibilityV2 seeded successfully as disabled.');
}

seed().catch(console.error);
