import zip from 'bestzip';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const destination = path.join(__dirname, '..', 'dist.zip');
const cwd = path.join(__dirname, '..', 'dist');

// Verificar que el directorio dist exista
if (!fs.existsSync(cwd)) {
  console.error('\n❌ Error: El directorio "dist" no existe. Asegúrate de ejecutar "npm run build" primero.\n');
  process.exit(1);
}

// Eliminar un dist.zip existente si existe
if (fs.existsSync(destination)) {
  try {
    fs.unlinkSync(destination);
    console.log('🗑️  Archivo dist.zip existente eliminado.');
  } catch (err) {
    console.warn('⚠️  No se pudo eliminar el archivo dist.zip existente:', err.message);
  }
}

console.log('📦 Comprimiendo el contenido de la carpeta "dist" en "dist.zip"...');

zip({
  source: '*',
  destination: destination,
  cwd: cwd
})
  .then(() => {
    console.log('✅ Carpeta "dist" comprimida correctamente en "dist.zip"!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error comprimiendo la carpeta "dist":', err);
    process.exit(1);
  });
