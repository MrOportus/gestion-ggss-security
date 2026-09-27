const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('../serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function run() {
  const snap = await db.collection('novedades').orderBy('creadoEn', 'desc').limit(5).get();
  console.log(`Found ${snap.size} records`);
  snap.forEach(doc => {
    const data = doc.data();
    console.log(`- ID: ${doc.id}`);
    console.log(`  sucursalId: ${data.sucursalId} (type: ${typeof data.sucursalId})`);
    console.log(`  siteId: ${data.siteId} (type: ${typeof data.siteId})`);
    console.log(`  autorNombre: ${data.autorNombre}`);
    console.log(`  descripcion: ${data.descripcion}`);
  });
}

run().catch(console.error);
