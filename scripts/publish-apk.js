// ─────────────────────────────────────────────────────────────────────────────
// scripts/publish-apk.js
//
// Automatización de compilación, subida a Firebase Storage y publicación en Firestore
// de una nueva versión del APK para GGSS Security.
//
// USO:
//   node scripts/publish-apk.js <nueva-version> [notas]
//
// EJEMPLO:
//   node scripts/publish-apk.js 1.0.2 "Arreglado el diagnóstico de notificaciones y optimizado el inicio"
// ─────────────────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');
const path  = require('path');
const fs    = require('fs');
const { execSync } = require('child_process');

// ── 1. Argumentos y Validación ───────────────────────────────────────────────
const [,, newVersion, releaseNotes] = process.argv;

if (!newVersion) {
  console.error('\n❌ Error: Debes proporcionar la nueva versión.');
  console.error('   Uso: node scripts/publish-apk.js <version> [notas]\n');
  process.exit(1);
}

// Validar formato semver básico (X.Y.Z)
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error(`\n❌ Error: Versión inválida "${newVersion}". Usa formato X.Y.Z (ej: 1.0.2)\n`);
  process.exit(1);
}

const rootDir = path.join(__dirname, '..');
const bannerPath = path.join(rootDir, 'components', 'AppUpdateBanner.tsx');
const serviceAccountPath = path.join(rootDir, 'serviceAccountKey.json');

// Verificar archivo de credenciales de Firebase
if (!fs.existsSync(serviceAccountPath)) {
  console.error(`\n❌ Error: No se encontró el archivo de credenciales de Firebase en: ${serviceAccountPath}\n`);
  process.exit(1);
}

console.log(`\n🚀 Iniciando automatización para publicar la versión v${newVersion}...\n`);

try {
  // ── 2. Actualizar APP_VERSION en AppUpdateBanner.tsx ────────────────────────
  console.log('📝 1. Actualizando APP_VERSION en AppUpdateBanner.tsx...');
  if (!fs.existsSync(bannerPath)) {
    throw new Error(`No se encontró el archivo de banner en: ${bannerPath}`);
  }
  let bannerContent = fs.readFileSync(bannerPath, 'utf8');
  
  // Expresión regular para buscar: export const APP_VERSION = '...';
  const versionRegex = /(export\s+const\s+APP_VERSION\s*=\s*['"])([^'"]+)(['"])/;
  if (!versionRegex.test(bannerContent)) {
    throw new Error('No se pudo encontrar la declaración de export const APP_VERSION en AppUpdateBanner.tsx');
  }
  
  bannerContent = bannerContent.replace(versionRegex, `$1${newVersion}$3`);
  fs.writeFileSync(bannerPath, bannerContent, 'utf8');
  console.log(`   ✅ Versión actualizada localmente a v${newVersion}`);

  // ── 3. Compilar bundle Web ──────────────────────────────────────────────────
  console.log('\n📦 2. Compilando assets Web (Vite build)...');
  execSync('npm run build', { stdio: 'inherit', cwd: rootDir });
  console.log('   ✅ Compilación web completada.');

  // ── 4. Sincronizar con Capacitor ────────────────────────────────────────────
  console.log('\n🔄 3. Sincronizando assets con plataforma nativa de Capacitor...');
  execSync('npx cap sync android', { stdio: 'inherit', cwd: rootDir });
  console.log('   ✅ Sincronización de Capacitor completada.');

  // ── 5. Compilar APK Nativo ──────────────────────────────────────────────────
  console.log('\n🤖 4. Compilando APK Nativo (Gradle)...');
  const isWindows = process.platform === 'win32';
  const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';
  const androidDir = path.join(rootDir, 'android');
  
  console.log(`   Ejecutando ${gradleCmd} assembleDebug...`);
  execSync(`${gradleCmd} assembleDebug`, { stdio: 'inherit', cwd: androidDir });
  
  const apkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (!fs.existsSync(apkPath)) {
    throw new Error(`No se encontró el APK generado en: ${apkPath}`);
  }
  console.log('   ✅ APK compilado con éxito.');

  // ── 6. Subir APK a Firebase Storage ────────────────────────────────────────
  console.log('\n☁️  5. Subiendo APK a Firebase Storage...');
  
  // Inicializar Firebase Admin
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
    storageBucket: 'gen-lang-client-08607869-461c2.firebasestorage.app'
  });

  const bucket = admin.storage().bucket();
  const destination = `apks/ggss-security-${newVersion}.apk`;

  console.log(`   Subiendo a bucket: ${bucket.name}`);
  console.log(`   Ruta destino: ${destination}`);

  bucket.upload(apkPath, {
    destination: destination,
    metadata: {
      contentType: 'application/vnd.android.package-archive',
    }
  }).then(async ([file]) => {
    console.log('   Haciendo archivo público...');
    await file.makePublic();
    
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
    console.log(`   ✅ APK subido. URL pública: ${publicUrl}`);

    // ── 7. Publicar versión en Firestore ─────────────────────────────────────
    console.log('\n🔥 6. Publicando nueva versión en Firestore (app_config/version)...');
    const db = admin.firestore();
    const docRef = db.collection('app_config').doc('version');

    const payload = {
      version:      newVersion,
      apkUrl:       publicUrl,
      releaseNotes: releaseNotes || `Actualización v${newVersion}`,
      mandatory:    false, // Cambiar manualmente a true si se quiere forzar la actualización
      publishedAt:  admin.firestore.FieldValue.serverTimestamp(),
    };

    await docRef.set(payload, { merge: true });
    
    console.log('\n🎉 ¡PROCESO FINALIZADO CON ÉXITO! 🎉\n');
    console.log(`   📱 Nueva versión publicada : v${newVersion}`);
    console.log(`   🔗 Enlace de descarga      : ${publicUrl}`);
    console.log(`   📝 Notas de versión        : ${payload.releaseNotes}\n`);
    console.log('   Los usuarios recibirán la notificación de actualización cuando abran la aplicación.');
    process.exit(0);
  }).catch((uploadError) => {
    console.error('\n❌ Error durante la subida o guardado en Firebase:', uploadError);
    process.exit(1);
  });

} catch (error) {
  console.error('\n❌ Error en el proceso de publicación automática:', error.message);
  process.exit(1);
}
