// ─────────────────────────────────────────────────────────────────────────────
// scripts/publish-version.js
//
// USO:
//   node scripts/publish-version.js <nueva-version> <url-del-apk> [notas]
//
// EJEMPLOS:
//   node scripts/publish-version.js 1.0.1 "https://storage.googleapis.com/ggss-xxxx/ggss-1.0.1.apk"
//   node scripts/publish-version.js 1.1.0 "https://storage.googleapis.com/..." "Corrección de GPS y mejoras de rendimiento"
//
// REQUISITOS:
//   - npm install firebase-admin  (ya está en package.json)
//   - El archivo serviceAccountKey.json debe existir en la raíz del proyecto
// ─────────────────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');
const path  = require('path');

// ── Argumentos ────────────────────────────────────────────────────────────────
const [,, newVersion, apkUrl, releaseNotes] = process.argv;

if (!newVersion || !apkUrl) {
  console.error('\n❌ Error: Debes proporcionar la versión y la URL del APK.\n');
  console.error('   Uso: node scripts/publish-version.js <version> <url-apk> [notas]\n');
  process.exit(1);
}

// Validar formato semver básico
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error(`\n❌ Error: Versión inválida "${newVersion}". Usa formato X.Y.Z (ej: 1.2.3)\n`);
  process.exit(1);
}

// ── Inicializar Firebase Admin ─────────────────────────────────────────────────
const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath),
});

const db = admin.firestore();

// ── Publicar versión ──────────────────────────────────────────────────────────
async function publishVersion() {
  const docRef = db.collection('app_config').doc('version');

  // Leer versión actual
  const currentSnap = await docRef.get();
  const currentVersion = currentSnap.exists ? currentSnap.data().version : '(ninguna)';

  const payload = {
    version:      newVersion,
    apkUrl:       apkUrl,
    releaseNotes: releaseNotes || `Actualización v${newVersion}`,
    mandatory:    false,         // Cambiar a true para forzar la actualización
    publishedAt:  admin.firestore.FieldValue.serverTimestamp(),
  };

  await docRef.set(payload, { merge: true });

  console.log('\n✅ Versión publicada exitosamente en Firestore!\n');
  console.log(`   Versión anterior : ${currentVersion}`);
  console.log(`   Nueva versión    : ${newVersion}`);
  console.log(`   URL del APK      : ${apkUrl}`);
  console.log(`   Notas de versión : ${payload.releaseNotes}`);
  console.log('\n📱 Los dispositivos recibirán la notificación de actualización la próxima');
  console.log('   vez que abran la aplicación o en el próximo ciclo de 30 minutos.\n');

  // ─── RECORDATORIO: Actualizar APP_VERSION en el código fuente ───────────────
  console.log(`⚠️  IMPORTANTE: Recuerda actualizar también el valor APP_VERSION`);
  console.log(`   en components/AppUpdateBanner.tsx a "${newVersion}"`);
  console.log(`   para que el NUEVO APK ya no muestre la notificación de actualización.\n`);

  process.exit(0);
}

publishVersion().catch((err) => {
  console.error('\n❌ Error publicando versión:', err.message, '\n');
  process.exit(1);
});
