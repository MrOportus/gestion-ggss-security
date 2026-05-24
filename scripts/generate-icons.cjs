// scripts/generate-icons.js
// Genera todos los íconos de Android en los tamaños correctos a partir del logo principal.
//
// USO:
//   node scripts/generate-icons.js
//
// REQUISITOS:
//   npm install --save-dev sharp

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

const SOURCE_LOGO = path.join(__dirname, '..', 'public', 'logo-transparencia.png');
const RES_DIR     = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

// Especificaciones de íconos de Android
// Cada densidad necesita ic_launcher (normal), ic_launcher_round (redondo) y ic_launcher_foreground
const DENSITIES = [
  { folder: 'mipmap-mdpi',    size: 48,  sizeFg: 108 },
  { folder: 'mipmap-hdpi',    size: 72,  sizeFg: 162 },
  { folder: 'mipmap-xhdpi',   size: 96,  sizeFg: 216 },
  { folder: 'mipmap-xxhdpi',  size: 144, sizeFg: 324 },
  { folder: 'mipmap-xxxhdpi', size: 192, sizeFg: 432 },
];

// Color de fondo para el ícono en fondo negro (igual que el logo)
const BG_COLOR = { r: 0, g: 0, b: 0, alpha: 1 };

async function generateIcons() {
  if (!fs.existsSync(SOURCE_LOGO)) {
    console.error(`❌ No se encontró el logo en: ${SOURCE_LOGO}`);
    process.exit(1);
  }

  console.log(`\n🎨 Generando íconos de Android desde: ${SOURCE_LOGO}\n`);

  for (const density of DENSITIES) {
    const destDir = path.join(RES_DIR, density.folder);

    // --- ic_launcher.png (fondo negro + logo centrado con padding) ---
    const launcherPath = path.join(destDir, 'ic_launcher.png');
    const padding = Math.round(density.size * 0.12); // 12% de padding
    const innerSize = density.size - padding * 2;

    await sharp(SOURCE_LOGO)
      .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extend({
        top: padding, bottom: padding, left: padding, right: padding,
        background: BG_COLOR,
      })
      .png()
      .toFile(launcherPath);

    // --- ic_launcher_round.png (circular con fondo negro) ---
    const roundPath = path.join(destDir, 'ic_launcher_round.png');
    const circleSize = density.size;
    const circlePadding = Math.round(circleSize * 0.15);
    const circleInner = circleSize - circlePadding * 2;

    // Crear máscara circular SVG
    const circleMask = Buffer.from(
      `<svg><circle cx="${circleSize / 2}" cy="${circleSize / 2}" r="${circleSize / 2}" fill="white"/></svg>`
    );

    const logoResized = await sharp(SOURCE_LOGO)
      .resize(circleInner, circleInner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extend({
        top: circlePadding, bottom: circlePadding, left: circlePadding, right: circlePadding,
        background: BG_COLOR,
      })
      .png()
      .toBuffer();

    await sharp({ create: { width: circleSize, height: circleSize, channels: 4, background: BG_COLOR } })
      .composite([
        { input: logoResized, blend: 'over' },
        { input: circleMask, blend: 'dest-in' },
      ])
      .png()
      .toFile(roundPath);

    // --- ic_launcher_foreground.png (para Adaptive Icons Android 8+) ---
    const fgPath = path.join(destDir, 'ic_launcher_foreground.png');
    const fgSize = density.sizeFg;
    const fgPadding = Math.round(fgSize * 0.2); // 20% de padding (safe zone)
    const fgInner = fgSize - fgPadding * 2;

    await sharp(SOURCE_LOGO)
      .resize(fgInner, fgInner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extend({
        top: fgPadding, bottom: fgPadding, left: fgPadding, right: fgPadding,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(fgPath);

    console.log(`  ✅ ${density.folder}: ${density.size}px launcher, ${density.size}px round, ${fgSize}px foreground`);
  }

  console.log('\n🎉 ¡Todos los íconos generados correctamente!\n');
  console.log('   Próximos pasos:');
  console.log('   1. Abre Android Studio');
  console.log('   2. Haz Sync Project with Gradle Files');
  console.log('   3. Compila y despliega la app en el dispositivo\n');
}

generateIcons().catch(err => {
  console.error('❌ Error generando íconos:', err.message);
  process.exit(1);
});
