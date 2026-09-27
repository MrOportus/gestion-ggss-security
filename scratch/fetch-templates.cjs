const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('../serviceAccountKey.json');
const fs = require('fs');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function run() {
  try {
    const snap = await db.collection('document_templates').get();
    let templates = [];
    snap.forEach(doc => {
      templates.push({ id: doc.id, ...doc.data() });
    });
    fs.writeFileSync('scratch/templates.json', JSON.stringify(templates, null, 2));
    console.log(`Saved ${templates.length} templates to scratch/templates.json`);
  } catch (err) {
    console.error("Query failed:", err);
  }
}

run().catch(console.error);
