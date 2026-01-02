/**
 * SCRIPT DE MIGRACIÓN: FIRESTORE → FIREBASE AUTH
 * ------------------------------------------------------------
 * Uso: node scripts/migrate-users.js
 * Requisitos:
 * 1. serviceAccountKey.json en la raíz del proyecto
 * 2. npm install firebase-admin
 * ------------------------------------------------------------
 */

import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Necesario en ES Modules para emular __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------------------------------------------------
// 1. CONFIGURACIÓN E INICIALIZACIÓN
// ------------------------------------------------------------
const serviceAccountPath = path.join(__dirname, "../serviceAccountKey.json");

if (!fs.existsSync(serviceAccountPath)) {
  console.error("❌ ERROR CRÍTICO: No se encontró 'serviceAccountKey.json'");
  console.error("Descárgalo desde Firebase Console > Configuración > Cuentas de servicio");
  process.exit(1);
}

const serviceAccount = JSON.parse(
  fs.readFileSync(serviceAccountPath, "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const auth = admin.auth();

const COLLECTION_NAME = "Colaboradores";

// ------------------------------------------------------------
// UTILIDADES
// ------------------------------------------------------------
const generateRandomPassword = () =>
  Math.random().toString(36).slice(-8) +
  Math.random().toString(36).slice(-8) +
  "Aa1!";

// ------------------------------------------------------------
// MIGRACIÓN PRINCIPAL
// ------------------------------------------------------------
async function migrateUsers() {
  console.log("🚀 Iniciando migración de colaboradores...\n");

  const snapshot = await db.collection(COLLECTION_NAME).get();

  if (snapshot.empty) {
    console.log("⚠️ No se encontraron colaboradores.");
    return;
  }

  console.log(`📄 Total documentos encontrados: ${snapshot.size}`);

  const stats = {
    processed: 0,
    created: 0,
    linked: 0,
    migrated_ids: 0,
    errors: 0,
  };

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const oldId = doc.id;

    const email = data.email?.trim().toLowerCase();
    const rut = data.rut || "SIN_RUT";
    const name = `${data.firstName || ""} ${data.lastNamePaterno || ""}`.trim();

    stats.processed++;
    console.log(`\n[${stats.processed}/${snapshot.size}] ${name} (${rut})`);

    if (!email) {
      console.warn(`⚠️  SIN EMAIL → SKIP (${oldId})`);
      stats.errors++;
      continue;
    }

    let uid;
    let isNewUser = false;
    let tempPassword = null;

    // --------------------------------------------------------
    // AUTH: obtener o crear usuario
    // --------------------------------------------------------
    try {
      const userRecord = await auth.getUserByEmail(email);
      uid = userRecord.uid;
      stats.linked++;
      console.log(`✅ Auth existente → UID: ${uid}`);
    } catch (err) {
      if (err.code === "auth/user-not-found") {
        try {
          tempPassword = generateRandomPassword();
          const newUser = await auth.createUser({
            email,
            password: tempPassword,
            displayName: name,
            emailVerified: false,
            disabled: false,
          });

          uid = newUser.uid;
          isNewUser = true;
          stats.created++;

          console.log(`✨ Auth creado → UID: ${uid}`);
          console.log(`🔑 Password temporal: ${tempPassword}`);
        } catch (createErr) {
          console.error(`❌ Error creando Auth: ${createErr.message}`);
          stats.errors++;
          continue;
        }
      } else {
        console.error(`❌ Error Auth: ${err.message}`);
        stats.errors++;
        continue;
      }
    }

    // --------------------------------------------------------
    // FIRESTORE: sincronizar UID
    // --------------------------------------------------------
    try {
      if (oldId !== uid) {
        const newRef = db.collection(COLLECTION_NAME).doc(uid);

        const newData = {
          ...data,
          id: uid,
          email,
          role: data.role || "worker",
          isActive: data.isActive ?? true,
          migratedAt: admin.firestore.FieldValue.serverTimestamp(),
          tempPasswordLog: isNewUser ? tempPassword : null,
        };

        await db.runTransaction(async (t) => {
          t.set(newRef, newData);
          t.delete(doc.ref);
        });

        stats.migrated_ids++;
        console.log(`🔄 Documento migrado: ${oldId} → ${uid}`);
      } else {
        await doc.ref.update({
          id: uid,
          email,
          role: data.role || "worker",
        });
        console.log("🆗 Documento ya sincronizado");
      }
    } catch (dbErr) {
      console.error(`❌ Error Firestore: ${dbErr.message}`);
      stats.errors++;
    }

    // --------------------------------------------------------
    // Reset password link (NO envía correo)
    // --------------------------------------------------------
    if (isNewUser) {
      try {
        const link = await auth.generatePasswordResetLink(email);
        console.log(`📩 Reset link generado (manual): ${link}`);
      } catch {
        console.warn("⚠️ No se pudo generar reset link");
      }
    }
  }

  // --------------------------------------------------------
  // RESUMEN
  // --------------------------------------------------------
  console.log("\n=========================================");
  console.log("RESUMEN MIGRACIÓN");
  console.log("=========================================");
  console.log(`Procesados:        ${stats.processed}`);
  console.log(`Auth creados:      ${stats.created}`);
  console.log(`Auth vinculados:   ${stats.linked}`);
  console.log(`IDs migrados:      ${stats.migrated_ids}`);
  console.log(`Errores:           ${stats.errors}`);
  console.log("=========================================");
  console.log("✔ No se enviaron correos automáticamente");
  console.log("✔ Usuarios deben usar 'Recuperar contraseña'");
}

migrateUsers()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ Error fatal:", e);
    process.exit(1);
  });
