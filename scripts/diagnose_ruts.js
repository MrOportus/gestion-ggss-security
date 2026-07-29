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

// Use emulators if running locally
// process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
// process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id
});

const db = admin.firestore();

function cleanRut(rut) {
  if (!rut) return "";
  return rut.replace(/[\.\-\s]/g, "").toUpperCase();
}

function validateRut(rut) {
  if (!rut || typeof rut !== 'string') return false;
  const cleaned = cleanRut(rut);
  if (cleaned.length < 8 || cleaned.length > 9) return false;
  
  const dv = cleaned.slice(-1);
  const body = cleaned.slice(0, -1);
  
  if (!/^\d+$/.test(body)) return false;
  if (!/^[0-9K]$/.test(dv)) return false;
  
  // Calculate check digit
  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  
  const expectedDv = 11 - (sum % 11);
  const expectedDvStr = expectedDv === 11 ? '0' : expectedDv === 10 ? 'K' : expectedDv.toString();
  
  return dv === expectedDvStr;
}

async function runDiagnosis() {
  console.log("Iniciando diagnóstico avanzado de RUTs y Auth...");
  
  const snapshot = await db.collection("Colaboradores").get();
  
  let total = 0;
  let empty = [];
  let invalid = [];
  let formats = new Set();
  
  const rutMap = new Map();
  
  const authErrors = [];

  for (const doc of snapshot.docs) {
    total++;
    const data = doc.data();
    const rut = data.rut;
    const uid = doc.id;
    
    // Auth Check
    try {
      const userRecord = await admin.auth().getUser(uid);
      if (!userRecord.email) {
        authErrors.push({ uid, issue: "No email" });
      }
      if (userRecord.disabled) {
        authErrors.push({ uid, issue: "Account disabled" });
      }
      const hasPasswordProvider = userRecord.providerData.some(p => p.providerId === 'password');
      if (!hasPasswordProvider) {
        authErrors.push({ uid, issue: "No password provider" });
      }
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        authErrors.push({ uid, issue: "User not found in Auth (Orphan document)" });
      } else {
        authErrors.push({ uid, issue: `Auth Error: ${error.message}` });
      }
    }

    if (!rut) {
      empty.push(uid);
      continue;
    }
    
    // Check format
    if (rut.includes('.')) formats.add("with_dots");
    if (rut.includes('-')) formats.add("with_dash");
    if (rut.includes(' ')) formats.add("with_spaces");
    if (!rut.includes('.') && !rut.includes('-') && !rut.includes(' ')) formats.add("raw_string");
    
    const normalized = cleanRut(rut);
    
    if (!validateRut(rut)) {
      invalid.push({ uid, rut, normalized });
    }
    
    if (!rutMap.has(normalized)) {
      rutMap.set(normalized, []);
    }
    rutMap.get(normalized).push({ uid, original: rut });
  }
  
  console.log(`Total de colaboradores evaluados: ${total}`);
  
  console.log("\n--- Problemas de Firebase Auth ---");
  console.log(`Cantidad: ${authErrors.length}`);
  if (authErrors.length > 0) {
    authErrors.forEach(err => console.log(`- UID: ${err.uid}, Problema: ${err.issue}`));
  }

  console.log("\n--- RUTs Vacíos ---");
  console.log(`Cantidad: ${empty.length}`);
  if (empty.length > 0) {
    console.log(`UIDs: ${empty.join(", ")}`);
  }
  
  console.log("\n--- RUTs Inválidos (Formato o Dígito Verificador incorrecto) ---");
  console.log(`Cantidad: ${invalid.length}`);
  if (invalid.length > 0) {
    invalid.forEach(item => {
      console.log(`- UID: ${item.uid}, Original: "${item.rut}", Normalizado: "${item.normalized}"`);
    });
  }
  
  const duplicates = [];
  rutMap.forEach((users, rut) => {
    if (users.length > 1) {
      duplicates.push({ rut, users });
    }
  });
  
  console.log("\n--- RUTs Duplicados ---");
  console.log(`Cantidad de RUTs con más de un usuario: ${duplicates.length}`);
  if (duplicates.length > 0) {
    duplicates.forEach(item => {
      console.log(`RUT Normalizado: ${item.rut}`);
      item.users.forEach(u => {
        console.log(`  - UID: ${u.uid}, Original: "${u.original}"`);
      });
    });
  }
  
  console.log("\nDiagnóstico finalizado.");
}

runDiagnosis().catch(console.error);
