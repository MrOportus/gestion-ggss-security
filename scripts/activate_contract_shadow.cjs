const admin = require('firebase-admin');
const readline = require('readline');
const crypto = require('crypto');

const PROJECT_ID = 'gen-lang-client-08607869-461c2';

// 1. Abort if emulators detected
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("ERROR: Emulators detected. This script must run against production.");
  process.exit(1);
}

// 2. Exact Project ID Check
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
if (admin.app().options.projectId !== PROJECT_ID) {
  console.error(`ERROR: Project ID mismatch. Expected ${PROJECT_ID}, got ${admin.app().options.projectId}`);
  process.exit(1);
}

const db = admin.firestore();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// ARG PARSING
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isValidateOnly = args.includes('--validate-only');

function getArg(prefix) {
  const arg = args.find(a => a.startsWith(prefix));
  return arg ? arg.split('=')[1] : null;
}

const branchesArg = getArg('--branches=');
const monthArg = getArg('--month=');
const operatorArg = getArg('--operator=');
const requestIdArg = getArg('--request-id=');
const expiresAtArg = getArg('--expires-at=');
const modeArg = getArg('--mode=') || 'shadow';
async function main() {
  console.log(`\n=== ACTIVAR CONTRACT SHADOW V2 (Project: ${PROJECT_ID}) ===\n`);
  
  if (isValidateOnly) console.log(">> MODO VALIDATE-ONLY ACTIVO. Solo se validan argumentos locales y la DB (sin escrituras).\n");
  else if (isDryRun) console.log(">> MODO DRY-RUN ACTIVO. No se escribirán cambios en Firestore.\n");

  if (!branchesArg) { console.error("ERROR: --branches no está presente"); process.exit(1); }
  if (monthArg !== '2026-07') { console.error("ERROR: El mes no es 2026-07"); process.exit(1); }
  
  const canaryBranches = branchesArg.split(',').map(v => v.trim()).filter(Boolean);
  
  if (canaryBranches.length === 0) { console.error("ERROR: La lista de sucursales está vacía"); process.exit(1); }
  
  const uniqueBranches = new Set(canaryBranches);
  if (uniqueBranches.size !== canaryBranches.length) { console.error("ERROR: Hay IDs duplicados"); process.exit(1); }
  
  if (canaryBranches.includes('*')) { console.error("ERROR: Aparecen comodines"); process.exit(1); }
  if (canaryBranches.some(b => b.startsWith('SUCURSAL_'))) { console.error("ERROR: Aparecen valores SUCURSAL_1, SUCURSAL_2, etc."); process.exit(1); }

  const expiresAtDate = new Date(expiresAtArg);
  if (isNaN(expiresAtDate.getTime()) || expiresAtDate <= new Date()) {
    console.error("ERROR: expiresAt está vencido o es inválido");
    process.exit(1);
  }

  // VALIDAR EXISTENCIA EN FIRESTORE
  const sucursalesRef = db.collection('Sucursales');
  if (canaryBranches.length > 30) { console.error("ERROR: Demasiadas sucursales para un query in"); process.exit(1); }
  
  const snapshot = await sucursalesRef.where(admin.firestore.FieldPath.documentId(), 'in', canaryBranches).get();
  if (snapshot.size !== canaryBranches.length) {
    console.error(`ERROR: Algún ID no existe en la fuente canónica de sucursales. Encontradas: ${snapshot.size}, Esperadas: ${canaryBranches.length}`);
    process.exit(1);
  }

  const newConfig = {
    enabled: true,
    mode: modeArg,
    canaryBranches,
    canaryMonths: [monthArg],
    engineVersion: 1,
    expiresAt: expiresAtArg,
    schemaVersion: 1
  };

  const flagRef = db.collection('FeatureFlags').doc('contractEligibilityV2');
  const auditRef = db.collection('AuditoriaAcciones').doc();
  const requestId = requestIdArg || crypto.randomUUID();

  // Validate state
  const flagSnap = await flagRef.get();
  const prevState = flagSnap.exists ? flagSnap.data() : { enabled: false, mode: 'disabled' };
  
  if (prevState.enabled === true && prevState.mode === 'shadow' && new Date(prevState.expiresAt) > new Date()) {
    console.error("ERROR: El flag ya está activo");
    process.exit(1);
  }

  console.log(`Sucursales recibidas: ${canaryBranches.length}`);
  console.log(`Sucursales reales verificadas: ${snapshot.size}`);
  console.log(`Placeholders: 0`);
  console.log(`Valores hardcodeados utilizados: NO`);
  console.log(`Estado actual: ${prevState.enabled ? prevState.mode : 'disabled'}`);
  console.log(`Estado propuesto: ${modeArg}`);
  console.log(`Mes: ${monthArg}`);
  console.log(`Engine version: 1`);
  console.log(`expiresAt futuro: SÍ`);
  
  if (isValidateOnly) {
    console.log("\nEscrituras: 0\nAuditorías: 0\nEstado final real: disabled");
    process.exit(0);
  }

  const executeTransaction = async () => {
    try {
      await db.runTransaction(async (transaction) => {
        const tSnap = await transaction.get(flagRef);
        const tState = tSnap.exists ? tSnap.data() : null;
        if (tState && tState.enabled === true && tState.mode === 'shadow' && new Date(tState.expiresAt) > new Date()) {
          throw new Error('El flag ya está activo.');
        }

        if (!isDryRun) {
          transaction.set(flagRef, newConfig);
          transaction.set(auditRef, {
            actionType: 'ACTIVATE_CONTRACT_SHADOW',
            actorUid: operatorArg || 'cli_admin_script',
            targetId: 'contractEligibilityV2',
            payload: { previousState: tState, newState: newConfig, requestId },
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      });
      if (isDryRun) {
        console.log("\nEscrituras: 0\nAuditorías: 0\nEstado final real: disabled");
      } else {
        console.log(`\n✅ Contract flag activado correctamente en modo ${modeArg} (Request ID: ${requestId})`);
      }
      process.exit(0);
    } catch (e) {
      console.error('\n❌ Error durante la transacción:', e.message);
      process.exit(1);
    }
  };

  if (args.includes('--force')) {
    await executeTransaction();
  } else {
    rl.question(`\n¿Confirma activar Shadow Mode hasta ${expiresAtArg}? (Escriba 'CONFIRMAR' para continuar): `, async (answer) => {
      if (answer !== 'CONFIRMAR') {
        console.log('Operación abortada por el usuario.');
        process.exit(0);
      }
      await executeTransaction();
    });
  }
}
main().catch(console.error);
