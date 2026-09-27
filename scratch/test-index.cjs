const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('../serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function run() {
  try {
    // We will query sucursalId = 1779916252752
    const snap = await db.collection('novedades')
      .where('sucursalId', '==', 1779916252752)
      .orderBy('creadoEn', 'desc')
      .limit(5)
      .get();
      
    console.log(`Found ${snap.size} records via EXACT query!`);
  } catch (err) {
    console.error("Query failed:", err.message);
  }
}

run().catch(console.error);
