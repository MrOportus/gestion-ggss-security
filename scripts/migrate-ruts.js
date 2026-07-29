import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccountPath = path.join(__dirname, "../serviceAccountKey.json");

if (!fs.existsSync(serviceAccountPath)) {
  console.error("Error: serviceAccountKey.json no encontrado.");
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

function cleanRut(rut) {
  if (!rut) return "";
  return rut.replace(/[\.\-\s]/g, "").toUpperCase();
}

async function migrateRuts() {
  console.log("Iniciando migración de RUTs...");

  const snapshot = await db.collection("Colaboradores").get();
  let batch = db.batch();
  let operationsCount = 0;
  let batchCount = 0;
  
  const MAX_BATCH_SIZE = 400; // Keep under 500 limit

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const rut = data.rut;
    const uid = doc.id;

    if (!rut) {
      console.warn(`[WARN] UID ${uid} no tiene RUT. Se omite.`);
      continue;
    }

    const rutNormalized = cleanRut(rut);
    
    // Update Colaborador document
    const colRef = db.collection("Colaboradores").doc(uid);
    batch.update(colRef, { rutNormalized });
    operationsCount++;

    // Create/Update RutIndex document
    const indexRef = db.collection("RutIndex").doc(rutNormalized);
    batch.set(indexRef, {
      uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }); // Using merge in case it already exists, although duplicates should have been cleared.
    operationsCount++;

    if (operationsCount >= MAX_BATCH_SIZE) {
      console.log(`Ejecutando batch ${++batchCount}...`);
      await batch.commit();
      batch = db.batch(); // Re-initialize batch
      operationsCount = 0;
    }
  }

  if (operationsCount > 0) {
    console.log(`Ejecutando batch final ${++batchCount}...`);
    await batch.commit();
  }

  console.log("Migración completada exitosamente.");
}

migrateRuts().catch(console.error);
