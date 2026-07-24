import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const serviceAccountPath = resolve(process.cwd(), 'serviceAccountKey.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function run() {
  const argv = process.argv.slice(2);
  const sucursalId = argv.find(a => a.startsWith('--sucursal='))?.split('=')[1];
  const mes = argv.find(a => a.startsWith('--mes='))?.split('=')[1];

  if (!sucursalId || !mes) {
    console.error('Uso: node phase5d2f_observability.js --sucursal=SUC-ID --mes=YYYY-MM');
    process.exit(1);
  }

  console.log(`--- MÉTRICAS PILOTO 5D.2F ---`);
  console.log(`Sucursal: ${sucursalId} | Mes: ${mes}`);
  console.log('Analizando datos...\n');

  try {
    // 1. AsistenciasConsolidadas (V2)
    const v2Snap = await db.collection('AsistenciasConsolidadas')
      .where('sucursalId', '==', sucursalId)
      // En una implementación real, se filtraría por jornadaDate startsWith mes
      .get();
    
    let v2Count = 0;
    v2Snap.forEach(doc => {
      const data = doc.data();
      if (data.jornadaDate && data.jornadaDate.startsWith(mes)) {
        v2Count++;
      }
    });

    // 2. AttendanceShadowComparisons
    const shadowSnap = await db.collection('AttendanceShadowComparisons')
      .where('sucursalId', '==', sucursalId)
      .get();

    const classifications = {
      exact_match: 0,
      compatible_partial_match: 0,
      expected_legacy_limitation: 0,
      legacy_overwrite_detected: 0,
      unexpected_difference: 0,
      missing_legacy: 0,
      missing_v2: 0,
      v2_invalid: 0
    };
    
    let comparisonsCount = 0;
    let errorsCount = 0;

    shadowSnap.forEach(doc => {
      const data = doc.data();
      // Filtrar por mes
      if (data.jornadaDate && data.jornadaDate.startsWith(mes)) {
        comparisonsCount++;
        if (data.classification && classifications[data.classification] !== undefined) {
          classifications[data.classification]++;
        } else if (data.classification) {
           // Otros estados
           classifications.unexpected_difference++;
        }
        
        if (data.error) {
           errorsCount++;
        }
      }
    });

    // 3. AuditoriaAcciones
    // Contar auditorías de lectura y cierre en el periodo (aproximación)
    const auditSnap = await db.collection('AuditoriaAcciones')
      .where('sucursal', '==', sucursalId)
      .where('mes', '==', mes)
      .get();
    
    let auditWrite = 0;
    let auditRead = 0;

    auditSnap.forEach(doc => {
      const data = doc.data();
      if (data.action === 'attendance_v2_dual_write') auditWrite++;
      if (data.action === 'attendance_v2_shadow_read') auditRead++;
    });

    console.log(`[V2 Generados]: ${v2Count}`);
    console.log(`[Auditorías Dual Write]: ${auditWrite}`);
    console.log(`[Auditorías Shadow Read]: ${auditRead}`);
    console.log(`[Comparaciones Procesadas]: ${comparisonsCount}`);
    console.log(`[Errores de Shadow Reader]: ${errorsCount}`);
    
    console.log(`\n[Desglose de Clasificaciones Shadow]:`);
    for (const [key, value] of Object.entries(classifications)) {
      console.log(`  - ${key}: ${value}`);
    }

    // Criterios de éxito Hard Switch (Alertas)
    console.log(`\n[Evaluación de Criterios Hard Switch]:`);
    if (classifications.unexpected_difference > 0) {
      console.log(`  ❌ FAIL: Hay ${classifications.unexpected_difference} diferencias inesperadas que investigar.`);
    } else {
      console.log(`  ✅ OK: Sin diferencias inesperadas (0).`);
    }

    if (classifications.v2_invalid > 0) {
      console.log(`  ❌ FAIL: Hay ${classifications.v2_invalid} documentos V2 inválidos.`);
    } else {
      console.log(`  ✅ OK: Sin documentos V2 inválidos (0).`);
    }

    if (classifications.missing_v2 > 0) {
      console.log(`  ❌ FAIL: Hay ${classifications.missing_v2} registros con V2 faltante (estado parcial o rollback fallido).`);
    } else {
      console.log(`  ✅ OK: Sin estados parciales detectados por missing_v2 (0).`);
    }

    if (errorsCount > 0) {
      console.log(`  ❌ FAIL: Ocurrieron ${errorsCount} errores internos en las comparaciones.`);
    } else {
      console.log(`  ✅ OK: Sin errores internos en comparaciones.`);
    }
    
    // NOTA: Para verificar 0 duplicaciones y 0 cierres fuera de scope se requieren queries globales
    // que se deben cruzar con las auditorías, aquí solo evaluamos la sucursal piloto.

  } catch (err) {
    console.error('Error recopilando métricas:', err);
  }
}

run().catch(console.error).finally(() => process.exit(0));
