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

function getArg(prefix) {
  const arg = args.find(a => a.startsWith(prefix));
  return arg ? arg.split('=')[1] : null;
}

const branchesArg = getArg('--branches=');
const monthArg = getArg('--month=');
const operatorArg = getArg('--operator=');
const requestIdArg = getArg('--request-id=');

async function main() {
  console.log(`\n=== DESACTIVAR CONTRACT SHADOW V2 (Project: ${PROJECT_ID}) ===\n`);
  
  if (isDryRun) console.log(">> MODO DRY-RUN ACTIVO. No se escribirán cambios en Firestore.\n");

  if (!branchesArg) { console.error("ERROR: --branches no está presente"); process.exit(1); }
  const canaryBranches = branchesArg.split(',').map(v => v.trim()).filter(Boolean);
  
  const flagRef = db.collection('FeatureFlags').doc('contractEligibilityV2');
  const auditRef = db.collection('AuditoriaAcciones').doc();
  const requestId = requestIdArg || crypto.randomUUID();

  // Validate state
  const flagSnap = await flagRef.get();
  const prevState = flagSnap.exists ? flagSnap.data() : null;
  
  if (!prevState || prevState.enabled === false) {
    console.error("ERROR: El Shadow Mode ya se encuentra desactivado o no existe.");
    process.exit(1);
  }

  if (prevState.mode !== 'shadow') { console.error("ERROR: mode no es shadow."); process.exit(1); }
  if (prevState.engineVersion !== 1) { console.error("ERROR: engineVersion no es 1."); process.exit(1); }
  if (!prevState.canaryMonths || !prevState.canaryMonths.includes(monthArg)) { console.error("ERROR: canaryMonths no coincide."); process.exit(1); }
  
  const stateBranches = [...(prevState.canaryBranches || [])].sort();
  const expectedBranches = [...canaryBranches].sort();
  if (JSON.stringify(stateBranches) !== JSON.stringify(expectedBranches)) {
    console.error("ERROR: canaryBranches no coincide con el alcance esperado.");
    process.exit(1);
  }

  const newConfig = {
    enabled: false,
    mode: "disabled",
    canaryBranches: [],
    canaryMonths: [],
    engineVersion: 1,
    expiresAt: null,
    schemaVersion: 1
  };

  rl.question(`\n¿Confirma desactivar Shadow Mode? (Escriba 'CONFIRMAR' para continuar): `, async (answer) => {
    if (answer !== 'CONFIRMAR') {
      console.log('Operación abortada por el usuario.');
      process.exit(0);
    }
    try {
      await db.runTransaction(async (transaction) => {
        if (!isDryRun) {
          transaction.set(flagRef, newConfig);
          transaction.set(auditRef, {
            actionType: 'DEACTIVATE_CONTRACT_SHADOW',
            actorUid: operatorArg || 'cli_admin_script',
            targetId: 'contractEligibilityV2',
            payload: { previousState: prevState, newState: newConfig, requestId },
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      });
      if (isDryRun) {
        console.log("\nEscrituras: 0\nAuditorías: 0\nEstado final real: disabled");
      } else {
        console.log(`\n✅ Contract Shadow desactivado correctamente (Request ID: ${requestId})`);
      }
      process.exit(0);
    } catch (e) {
      console.error('\n❌ Error durante la transacción:', e.message);
      process.exit(1);
    }
  });
}
main().catch(console.error);
