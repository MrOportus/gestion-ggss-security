import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';

const app = initializeApp({
  projectId: "demo-local",
  apiKey: "fake-api-key"
});

const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);

const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099');

const functions = getFunctions(app, 'us-central1');
connectFunctionsEmulator(functions, '127.0.0.1', 5001);

const transferScheduledShifts = httpsCallable(functions, 'transferScheduledShifts');

async function setup() {
  console.log("Configurando datos de prueba...");
  
  // Crear usuario jefe_operaciones
  try {
    await createUserWithEmailAndPassword(auth, 'jefe@test.com', 'password123');
  } catch(e) {
    if(e.code !== 'auth/email-already-in-use') console.error(e);
  }
  const user = await signInWithEmailAndPassword(auth, 'jefe@test.com', 'password123');
  const uid = user.user.uid;

  await setDoc(doc(db, 'Colaboradores', uid), {
    id: uid,
    role: 'jefe_operaciones',
    isActive: true
  });
  
  await setDoc(doc(db, 'AlcancesOperativos', uid), {
    colaboradorId: uid,
    activo: true,
    alcanceNacional: true
  });

  // Crear turno origen
  await setDoc(doc(db, 'TurnosProgramados', 'turno_conc_1'), {
    id: 'turno_conc_1',
    colaboradorId: 'emp_conc',
    sucursalId: 'site_A',
    fecha: '2024-07-01',
    estado: 'programado',
    codigo: 'X',
    horarioSnapshot: { inicio: '07:30', termino: '19:30', cruzaMedianoche: false },
    tipoOperacional: 'contractual'
  });

  return uid;
}

async function testConcurrency() {
  console.log("\n--- TEST 9: CONCURRENCIA ---");
  const payload1 = {
    turnoProgramadoIds: ['turno_conc_1'],
    sucursalDestinoId: 'site_B',
    tipoOperacion: 'traslado_temporal',
    motivo: 'Concurrencia A',
    operationRequestId: 'req-conc-1'
  };
  
  const payload2 = {
    turnoProgramadoIds: ['turno_conc_1'],
    sucursalDestinoId: 'site_B',
    tipoOperacion: 'traslado_temporal',
    motivo: 'Concurrencia B',
    operationRequestId: 'req-conc-2'
  };

  console.log("Enviando dos llamadas concurrentes para el mismo turno...");
  const p1 = transferScheduledShifts(payload1);
  const p2 = transferScheduledShifts(payload2);

  const results = await Promise.allSettled([p1, p2]);
  
  console.log("Resultado llamada 1:", results[0].status === 'fulfilled' ? JSON.stringify(results[0].value.data) : results[0].reason?.message);
  console.log("Resultado llamada 2:", results[1].status === 'fulfilled' ? JSON.stringify(results[1].value.data) : results[1].reason?.message);

  const docSnap = await getDoc(doc(db, 'TurnosProgramados', 'turno_conc_1'));
  console.log("Estado final de turno_conc_1:", docSnap.data().estado);
  console.log("transferredToShiftId de turno_conc_1:", docSnap.data().transferredToShiftId);
}

async function main() {
  try {
    await setup();
    await testConcurrency();
    console.log("DONE");
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

main();
