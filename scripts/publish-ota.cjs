// ─────────────────────────────────────────────────────────────────────────────
// scripts/publish-ota.cjs
//
// Automatización para compilar, comprimir y publicar una actualización Live (OTA).
// Sube el dist.zip a Firebase Storage y actualiza los campos webVersion y webUrl en Firestore.
//
// FUENTE DE VERDAD DE VERSIÓN: archivo VERSION en la raíz del proyecto.
//
// USO:
//   node scripts/publish-ota.cjs [nueva-version-web] [notas]
//
//   - Sin versión: lee VERSION e incrementa patch automáticamente (+1)
//   - Con versión: valida que sea estrictamente mayor a la actual antes de publicar
//
// EJEMPLOS:
//   node scripts/publish-ota.cjs                          → v6.0.5 → v6.0.6 automático
//   node scripts/publish-ota.cjs 6.1.0 "Nuevo módulo"    → publica v6.1.0
// ─────────────────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');
const path  = require('path');
const fs    = require('fs');
const { execSync } = require('child_process');

const rootDir            = path.join(__dirname, '..');
const versionFilePath    = path.join(rootDir, 'VERSION');
const packageJsonPath    = path.join(rootDir, 'package.json');
const serviceAccountPath = path.join(rootDir, 'serviceAccountKey.json');
const zipPath            = path.join(rootDir, 'dist.zip');

// ── Helpers de semver ─────────────────────────────────────────────────────────
function parseSemver(v) {
  const parts = v.trim().split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}

function semverGt(a, b) {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch > b.patch;
}

function bumpPatch(v) {
  return `${v.major}.${v.minor}.${v.patch + 1}`;
}

// ── 1. Leer versión actual del archivo VERSION ────────────────────────────────
if (!fs.existsSync(versionFilePath)) {
  console.error('\n❌ Error: No se encontró el archivo VERSION en la raíz del proyecto.');
  console.error('   Crea el archivo VERSION con el contenido: X.Y.Z\n');
  process.exit(1);
}

const currentVersionRaw = fs.readFileSync(versionFilePath, 'utf8').trim();
const currentVersion    = parseSemver(currentVersionRaw);

if (!currentVersion) {
  console.error(`\n❌ Error: El archivo VERSION contiene un valor inválido: "${currentVersionRaw}"`);
  console.error('   Debe tener formato X.Y.Z (ej: 6.0.5)\n');
  process.exit(1);
}

// ── 2. Determinar versión a publicar ─────────────────────────────────────────
const [,, argVersion, releaseNotes] = process.argv;

let newVersionStr;

if (!argVersion) {
  // Sin argumento → incrementar patch automáticamente
  newVersionStr = bumpPatch(currentVersion);
  console.log(`\nℹ️  Sin versión especificada. Incrementando patch: v${currentVersionRaw} → v${newVersionStr}`);
} else {
  if (!/^\d+\.\d+\.\d+$/.test(argVersion)) {
    console.error(`\n❌ Error: Versión inválida "${argVersion}". Usa formato X.Y.Z (ej: 6.0.5)\n`);
    process.exit(1);
  }

  const newVersion = parseSemver(argVersion);

  if (!semverGt(newVersion, currentVersion)) {
    console.error(`\n❌ Error de versión: v${argVersion} debe ser MAYOR a la versión actual v${currentVersionRaw}.`);
    console.error(`   Publicar una versión igual o menor causaría un loop de actualizaciones en los dispositivos.`);
    console.error(`   Próxima versión válida sugerida: v${bumpPatch(currentVersion)}\n`);
    process.exit(1);
  }

  newVersionStr = argVersion;
}

// ── Verificaciones de entorno ─────────────────────────────────────────────────
if (!fs.existsSync(serviceAccountPath)) {
  console.error(`\n❌ Error: No se encontró serviceAccountKey.json en: ${serviceAccountPath}\n`);
  process.exit(1);
}

console.log(`\n🚀 Publicando OTA...`);
console.log(`   Versión anterior : v${currentVersionRaw}`);
console.log(`   Versión nueva    : v${newVersionStr}\n`);

try {
  // ── 3. Build + ZIP ────────────────────────────────────────────────────────
  console.log('📦 1. Compilando assets Web y generando dist.zip...');
  execSync('npm run build:update', { stdio: 'inherit', cwd: rootDir });

  if (!fs.existsSync(zipPath)) {
    throw new Error(`No se encontró el archivo ZIP generado en: ${zipPath}`);
  }
  console.log('   ✅ Empaquetado ZIP completado.');

  // ── 4. Upload a Firebase Storage ─────────────────────────────────────────
  console.log('\n☁️  2. Subiendo actualización OTA a Firebase Storage...');

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
    storageBucket: 'gen-lang-client-08607869-461c2.firebasestorage.app'
  });

  const bucket = admin.storage().bucket();
  const versionUnderscores = newVersionStr.replace(/\./g, '_');
  const now = new Date();
  const buildTag = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

  const filename    = `ggs_security_ota_v_${versionUnderscores}_build_${buildTag}.zip`;
  const destination = `ota_updates/${filename}`;

  console.log(`   Bucket  : ${bucket.name}`);
  console.log(`   Destino : ${destination}`);

  bucket.upload(zipPath, {
    destination,
    metadata: { contentType: 'application/zip' }
  }).then(async ([file]) => {
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
    console.log(`   ✅ ZIP subido. URL: ${publicUrl}`);

    // ── 5. Actualizar Firestore ────────────────────────────────────────────
    console.log('\n🔥 3. Actualizando Firestore (app_config/version)...');
    const db     = admin.firestore();
    const docRef = db.collection('app_config').doc('version');
    const payload = {
      webVersion:   newVersionStr,
      webUrl:       publicUrl,
      releaseNotes: releaseNotes || `Actualización OTA v${newVersionStr}`,
    };
    await docRef.set(payload, { merge: true });

    // ── 6. Actualizar VERSION + package.json ──────────────────────────────
    console.log('\n📝 4. Actualizando archivo VERSION y package.json...');
    fs.writeFileSync(versionFilePath, newVersionStr, 'utf8');

    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    pkg.version = newVersionStr;
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

    console.log(`   ✅ VERSION: ${currentVersionRaw} → ${newVersionStr}`);
    console.log(`   ✅ package.json version: ${newVersionStr}`);

    console.log('\n🎉 ¡ACTUALIZACIÓN OTA PUBLICADA CON ÉXITO! 🎉\n');
    console.log(`   ⚡ Versión publicada  : v${newVersionStr}`);
    console.log(`   🔗 URL del bundle     : ${publicUrl}`);
    console.log(`   📝 Notas             : ${payload.releaseNotes}\n`);
    console.log('   Los dispositivos recibirán la actualización al abrir la app.');
    process.exit(0);

  }).catch((err) => {
    console.error('\n❌ Error en upload o Firestore:', err);
    process.exit(1);
  });

} catch (error) {
  console.error('\n❌ Error en el proceso de publicación OTA:', error.message);
  process.exit(1);
}
