import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import readline from 'readline';

const EXPECTED_PROJECT_ID = 'gen-lang-client-08607869-461c2';

const args = process.argv.slice(2);
const requestId = args.find(a => a.startsWith('--request-id='))?.split('=')[1];
const operator = args.find(a => a.startsWith('--operator='))?.split('=')[1];
const projectArg = args.find(a => a.startsWith('--project='))?.split('=')[1];
const isDryRun = args.includes('--dry-run');

if (!requestId || !operator || !projectArg) {
  console.error('[ERROR] Falta uno de los parámetros obligatorios.');
  console.error('Uso: node deactivate_attendance_v2_qa.js --project=<PROJECT_ID> --request-id=<REQ_ID> --operator=<OPERATOR> [--dry-run]');
  process.exit(1);
}

if (projectArg !== EXPECTED_PROJECT_ID) {
  console.error(`[ERROR] ProjectId incorrecto. Esperado: ${EXPECTED_PROJECT_ID}`);
  process.exit(1);
}

if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('[ERROR] FIRESTORE_EMULATOR_HOST detectado. Este script opera sobre PRODUCCIÓN.');
  process.exit(1);
}

const serviceAccountPath = resolve(process.cwd(), 'serviceAccountKey.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

initializeApp({ credential: cert(serviceAccount), projectId: EXPECTED_PROJECT_ID });
const db = getFirestore();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function execute() {
  console.log('====================================================');
  console.log(' DESACTIVACIÓN QA PARA DUAL WRITE Y SHADOW READING  ');
  console.log('====================================================');
  
  if (isDryRun) {
    console.log('*** MODO DRY-RUN: No se escribirán datos ***');
  }

  const flags = ['attendanceV2', 'attendanceV2Read'];
  const stateBefore = {};
  for (const flag of flags) {
    const doc = await db.collection('FeatureFlags').doc(flag).get();
    stateBefore[flag] = doc.data();
  }

  console.log('\n--- Estado Previo ---');
  console.log(JSON.stringify(stateBefore, null, 2));

  console.log('\n--- Operación de Desactivación ---');
  console.log(`- Projecto:      ${projectArg}`);
  console.log(`- Ticket/Reg:    ${requestId}`);
  console.log(`- Operador:      ${operator}`);
  
  const confirmationString = `APAGAR ${projectArg}`;
  
  rl.question(`\nPara proceder, escribe exactamente:\n${confirmationString}\n> `, async (answer) => {
    if (answer !== confirmationString) {
      console.log('Operación abortada. Confirmación incorrecta.');
      process.exit(0);
    }

    if (isDryRun) {
      console.log('[DRY-RUN] Simulación exitosa. Terminando.');
      process.exit(0);
    }

    try {
      await db.runTransaction(async (transaction) => {
        const auditRef = db.collection('AuditoriaAcciones').doc(`qa-deactivation-${Date.now()}`);
        
        transaction.set(auditRef, {
          action: 'DEACTIVATE_QA_V2',
          requestId,
          operator,
          projectId: projectArg,
          previousState: stateBefore,
          newState: {
            enabled: false
          },
          timestamp: FieldValue.serverTimestamp()
        });

        for (const flag of flags) {
          const ref = db.collection('FeatureFlags').doc(flag);
          // Modifica exclusivamente enabled: false, preservando arreglos y mesQA para evidencia
          transaction.update(ref, {
            enabled: false,
            lastDeactivatedByReq: requestId,
            updatedAt: FieldValue.serverTimestamp()
          });
        }
      });

      console.log('\n[SUCCESS] Feature Flags DESACTIVADOS y auditoría registrada.');
      
      // Nueva lectura para comprobación
      console.log('\n--- Estado Resultante ---');
      for (const flag of flags) {
        const doc = await db.collection('FeatureFlags').doc(flag).get();
        console.log(`[${flag}]`, doc.data());
      }
      
    } catch (error) {
      console.error('[FATAL] Error en la transacción de desactivación:', error);
      process.exit(1);
    }
    process.exit(0);
  });
}

execute();
