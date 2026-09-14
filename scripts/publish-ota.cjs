// ─────────────────────────────────────────────────────────────────────────────
// scripts/publish-ota.cjs
//
// Automatización para compilar, comprimir y publicar una actualización Live (OTA).
// Sube el dist.zip a Firebase Storage y actualiza los campos webVersion y webUrl en Firestore.
//
// USO:
//   node scripts/publish-ota.cjs <nueva-version-web> [notas]
//
// EJEMPLO:
//   node scripts/publish-ota.cjs 1.0.3 "Corrección de colores en el botón"
// ─────────────────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');
const path  = require('path');
const fs    = require('fs');
const { execSync } = require('child_process');

// ── 1. Argumentos y Validación ───────────────────────────────────────────────
const [,, newVersion, releaseNotes] = process.argv;

if (!newVersion) {
  console.error('\n❌ Error: Debes proporcionar la nueva versión web (OTA).');
  console.error('   Uso: node scripts/publish-ota.cjs <version> [notas]\n');
  process.exit(1);
}

// Validar formato semver básico (X.Y.Z)
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error(`\n❌ Error: Versión inválida "${newVersion}". Usa formato X.Y.Z (ej: 1.0.3)\n`);
  process.exit(1);
}

const rootDir = path.join(__dirname, '..');
const serviceAccountPath = path.join(rootDir, 'serviceAccountKey.json');
const zipPath = path.join(rootDir, 'dist.zip');

// Verificar archivo de credenciales de Firebase
if (!fs.existsSync(serviceAccountPath)) {
  console.error(`\n❌ Error: No se encontró el archivo de credenciales de Firebase en: ${serviceAccountPath}\n`);
  process.exit(1);
}

console.log(`\n🚀 Iniciando automatización para publicar actualización OTA v${newVersion}...\n`);

try {
  // ── 2. Compilar y empaquetar bundle Web (ZIP) ──────────────────────────────
  console.log('📦 1. Compilando assets Web y generando dist.zip...');
  // Ejecutamos el script que ya tienes configurado en package.json
  execSync('npm run build:update', { stdio: 'inherit', cwd: rootDir });
  
  if (!fs.existsSync(zipPath)) {
    throw new Error(`No se encontró el archivo ZIP generado en: ${zipPath}`);
  }
  console.log('   ✅ Empaquetado ZIP completado.');

  // ── 3. Subir ZIP a Firebase Storage ────────────────────────────────────────
  console.log('\n☁️  2. Subiendo actualización OTA a Firebase Storage...');
  
  // Inicializar Firebase Admin
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
    storageBucket: 'gen-lang-client-08607869-461c2.firebasestorage.app'
  });

  const bucket = admin.storage().bucket();
  const versionUnderscores = newVersion.replace(/\./g, '_');
  const now = new Date();
  const buildTag = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  
  const filename = `ggs_security_ota_v_${versionUnderscores}_build_${buildTag}.zip`;
  const destination = `ota_updates/${filename}`;

  console.log(`   Subiendo a bucket: ${bucket.name}`);
  console.log(`   Ruta destino: ${destination}`);

  bucket.upload(zipPath, {
    destination: destination,
    metadata: {
      contentType: 'application/zip',
    }
  }).then(async ([file]) => {
    console.log('   Haciendo archivo público...');
    await file.makePublic();
    
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
    console.log(`   ✅ ZIP subido. URL pública: ${publicUrl}`);

    // ── 4. Publicar versión en Firestore ─────────────────────────────────────
    console.log('\n🔥 3. Actualizando configuración OTA en Firestore (app_config/version)...');
    const db = admin.firestore();
    const docRef = db.collection('app_config').doc('version');

    const payload = {
      webVersion:   newVersion,
      webUrl:       publicUrl,
      releaseNotes: releaseNotes || `Actualización menor (OTA) v${newVersion}`,
      // No tocamos version, apkUrl, ni mandatory nativo
    };

    await docRef.set(payload, { merge: true });
    
    console.log('\n🎉 ¡ACTUALIZACIÓN OTA PUBLICADA CON ÉXITO! 🎉\n');
    console.log(`   ⚡ Nueva versión web     : v${newVersion}`);
    console.log(`   🔗 Enlace del ZIP        : ${publicUrl}`);
    console.log(`   📝 Notas de versión      : ${payload.releaseNotes}\n`);
    console.log('   Los usuarios recibirán la actualización (sin reinstalar la app) la próxima vez que la abran.');
    process.exit(0);
  }).catch((uploadError) => {
    console.error('\n❌ Error durante la subida del ZIP o guardado en Firebase:', uploadError);
    process.exit(1);
  });

} catch (error) {
  console.error('\n❌ Error en el proceso de publicación OTA:', error.message);
  process.exit(1);
}
