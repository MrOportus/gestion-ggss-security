import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccountPath = path.join(__dirname, "../serviceAccountKey.json");

if (!fs.existsSync(serviceAccountPath)) {
  console.error("❌ ERROR: No se encontró 'serviceAccountKey.json' en la raíz del proyecto.");
  console.error("Por favor, asegúrate de colocar las credenciales de la cuenta de servicio en la raíz antes de ejecutar este script.");
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

// Inicializar Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const storage = admin.storage();

// Definir las reglas del ciclo de vida requeridas
// 1. A los 30 días (1 mes), mover de STANDARD a NEARLINE.
// 2. A los 90 días (3 meses), mover de NEARLINE/STANDARD a ARCHIVE.
const lifecycleConfig = {
  rule: [
    {
      action: {
        type: "SetStorageClass",
        storageClass: "NEARLINE"
      },
      condition: {
        age: 30,
        matchesStorageClass: ["STANDARD"]
      }
    },
    {
      action: {
        type: "SetStorageClass",
        storageClass: "ARCHIVE"
      },
      condition: {
        age: 90,
        matchesStorageClass: ["NEARLINE", "STANDARD"]
      }
    }
  ]
};

// Buckets potenciales a configurar
const bucketNames = [
  "gen-lang-client-08607869-461c2.firebasestorage.app",
  "gen-lang-client-08607869-461c2.appspot.com"
];

async function configureBuckets() {
  try {
    for (const name of bucketNames) {
      console.log(`\n--------------------------------------------`);
      console.log(`📦 Verificando bucket: ${name}`);
      
      const bucket = storage.bucket(name);
      
      // Comprobar si el bucket existe y es accesible
      const [exists] = await bucket.exists();
      if (!exists) {
        console.log(`⚠️ El bucket no existe o no es accesible.`);
        continue;
      }

      console.log("   Aplicando políticas de ciclo de vida...");
      await bucket.setMetadata({
        lifecycle: lifecycleConfig
      });
      
      console.log("   ✅ ¡Políticas aplicadas exitosamente!");
      
      // Mostrar confirmación leyendo la metadata actualizada
      const [metadata] = await bucket.getMetadata();
      console.log("   Configuración activa:");
      console.log(JSON.stringify(metadata.lifecycle, null, 2));
    }
    
    console.log(`\n🎉 Proceso finalizado.`);
  } catch (error) {
    console.error("❌ Ocurrió un error al configurar el ciclo de vida en GCP:", error);
  }
}

configureBuckets();
