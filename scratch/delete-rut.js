const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath),
});

const db = admin.firestore();

async function deleteRutIndex() {
  const rut = '130930723';
  try {
    await db.collection('RutIndex').doc(rut).delete();
    console.log(`Documento RutIndex para el RUT ${rut} eliminado exitosamente.`);
  } catch (error) {
    console.error('Error eliminando RutIndex:', error);
  }
  process.exit(0);
}

deleteRutIndex();
