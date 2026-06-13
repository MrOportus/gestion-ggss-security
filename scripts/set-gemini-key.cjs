// ─────────────────────────────────────────────────────────────────────────────
// scripts/set-gemini-key.cjs
//
// Configura una nueva API Key de Gemini localmente en .env.local y en Firestore.
//
// USO:
//   node scripts/set-gemini-key.cjs <nueva-api-key>
// ─────────────────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');
const path  = require('path');
const fs    = require('fs');

const [,, newApiKey] = process.argv;

if (!newApiKey) {
  console.error('\n❌ Error: Debes proporcionar la nueva API Key de Gemini.');
  console.error('   Uso: node scripts/set-gemini-key.cjs <nueva-api-key>\n');
  process.exit(1);
}

const rootDir = path.join(__dirname, '..');
const envPath = path.join(rootDir, '.env.local');
const serviceAccountPath = path.join(rootDir, 'serviceAccountKey.json');

console.log(`\n🚀 Configurando nueva API Key de Gemini...\n`);

try {
  // ── 1. Actualizar .env.local ────────────────────────────────────────────────
  console.log('📝 1. Actualizando .env.local...');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  const apiKeyRegex = /^(VITE_API_KEY\s*=\s*)(.*)$/m;

  if (apiKeyRegex.test(envContent)) {
    envContent = envContent.replace(apiKeyRegex, `$1${newApiKey}`);
  } else {
    // Si no existe la variable, añadirla al final
    envContent += `\nVITE_API_KEY=${newApiKey}\n`;
  }

  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log('   ✅ .env.local actualizado con la nueva clave.');

  // ── 2. Guardar en Firestore ─────────────────────────────────────────────────
  if (fs.existsSync(serviceAccountPath)) {
    console.log('\n🔥 2. Conectando con Firebase para guardar la clave en Firestore (app_config/gemini)...');
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath)
    });

    const db = admin.firestore();
    const docRef = db.collection('app_config').doc('gemini');

    const payload = {
      apiKey:    newApiKey,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    docRef.set(payload, { merge: true })
      .then(() => {
        console.log('   ✅ Clave subida exitosamente a Firestore.');
        console.log('\n🎉 ¡PROCESO FINALIZADO CON ÉXITO! 🎉\n');
        console.log('   La aplicación cargará la nueva API Key dinámicamente en ejecución.');
        process.exit(0);
      })
      .catch((firestoreError) => {
        console.error('\n❌ Error al guardar en Firestore:', firestoreError.message);
        process.exit(1);
      });
  } else {
    console.log('\n⚠️  Advertencia: No se encontró el archivo serviceAccountKey.json.');
    console.log('   La clave solo se guardó de forma local en .env.local.');
    console.log('\n🎉 ¡PROCESO LOCAL FINALIZADO! 🎉\n');
    process.exit(0);
  }

} catch (error) {
  console.error('\n❌ Error durante el proceso de configuración:', error.message);
  process.exit(1);
}
