/**
 * scripts/test-concurrency-4b.cjs
 * Prueba la concurrencia de createAdditionalShift y assignVacancyReplacement 
 * directamente contra el Firebase Emulator.
 *
 * Para ejecutar (requiere emulator corriendo localmente):
 * node scripts/test-concurrency-4b.cjs
 */

const admin = require('../functions/node_modules/firebase-admin');

// Set FIRESTORE_EMULATOR_HOST before initializing
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

admin.initializeApp({
  projectId: 'demo-ggss'
});

const db = admin.firestore();

// Importar handlers directamente para simular concurrencia a nivel de servidor
// (en un escenario real serían invocaciones HTTP simultáneas)
const { createAdditionalShiftHandler } = require('../functions/src/phase4/createAdditionalShift');
const { assignVacancyReplacementHandler } = require('../functions/src/phase4/assignVacancyReplacement');

async function testConcurrency() {
  console.log('--- Iniciando Tests de Concurrencia Subfase 4B ---');
  
  await db.collection('Colaboradores').doc('admin_user').set({ role: 'admin', isActive: true, email: 'admin@test.com', firstName: 'A', lastNamePaterno: 'B', rut: '1-9' });

  
  const adminContext = {
    auth: { uid: 'admin_user', token: { role: 'admin' } },
  };

  try {
    console.log('\n1. Test Concurrencia: createAdditionalShift con mismo operationRequestId');
    const additionalPayload = {
      data: {
        colaboradorId: 'emp_concurrent_1',
        sucursalId: 1,
        fecha: '2024-07-10',
        horario: { inicio: '07:30', termino: '15:30', cruzaMedianoche: false, origen: 'manual' },
        tipoOperacion: 'extra',
        motivo: 'Test Concurrencia Adicional',
        operationRequestId: 'op_concurrency_req_001'
      },
      auth: adminContext.auth
    };

    // Lanzar 5 llamadas concurrentes con el mismo ID de solicitud
    const createPromises = [];
    for (let i = 0; i < 5; i++) {
      createPromises.push(createAdditionalShiftHandler(additionalPayload));
    }

    const createResults = await Promise.allSettled(createPromises);
    
    // Todas deberían retornar success (idempotencia)
    let successCountAdd = 0;
    let turnosIds = new Set();
    
    createResults.forEach((res, i) => {
      if (res.status === 'fulfilled' && res.value.success) {
        successCountAdd++;
        turnosIds.add(res.value.turnoId);
      } else {
        console.error(`Error en promesa ${i}:`, res.reason || res.value);
      }
    });

    console.log(`- Solicitudes enviadas: 5`);
    console.log(`- Solicitudes exitosas devueltas: ${successCountAdd}`);
    console.log(`- Turnos únicos creados: ${turnosIds.size}`);
    
    if (turnosIds.size === 1) {
      console.log('✅ PASS: Concurrencia idempotente mantenida para createAdditionalShift.');
    } else {
      console.log('❌ FAIL: Se crearon múltiples turnos o ninguno.');
    }

    console.log('\n2. Test Concurrencia: assignVacancyReplacement a la misma vacante');
    
    // Seed vacante inicial
    const vacancyId = 'vacancy_concurrent_1';
    await db.collection('TurnosProgramados').doc(vacancyId).set({
      id: vacancyId,
      colaboradorId: 'emp_trasladado',
      sucursalId: '2',
      fecha: '2024-07-11',
      estado: 'trasladado',
      requiereCobertura: true,
      creadoPor: 'admin',
      horarioSnapshot: { inicio: '08:00', termino: '16:00', cruzaMedianoche: false, origen: 'manual' }
    });

    // Intentar cubrir la vacante por 3 usuarios simultáneamente
    const assignPromises = [
      assignVacancyReplacementHandler({
        data: { turnoOrigenTrasladadoId: vacancyId, colaboradorReemplazanteId: 'replacerA', tipoOperacion: 'cobertura', operationRequestId: 'op_assign_c_1', motivo: 'Cob A' },
        auth: adminContext.auth
      }),
      assignVacancyReplacementHandler({
        data: { turnoOrigenTrasladadoId: vacancyId, colaboradorReemplazanteId: 'replacerB', tipoOperacion: 'cobertura', operationRequestId: 'op_assign_c_2', motivo: 'Cob B' },
        auth: adminContext.auth
      }),
      assignVacancyReplacementHandler({
        data: { turnoOrigenTrasladadoId: vacancyId, colaboradorReemplazanteId: 'replacerC', tipoOperacion: 'cobertura', operationRequestId: 'op_assign_c_3', motivo: 'Cob C' },
        auth: adminContext.auth
      }),
    ];

    const assignResults = await Promise.allSettled(assignPromises);

    let successCountAssign = 0;
    let errorCountAssign = 0;

    assignResults.forEach((res, i) => {
      if (res.status === 'fulfilled') {
        if (res.value.success) successCountAssign++;
        else {
          errorCountAssign++;
          console.error(`Error esperado en promesa assign ${i}:`, res.value);
        }
      } else {
        errorCountAssign++;
        console.error(`Excepción en promesa assign ${i}:`, res.reason);
      }
    });

    console.log(`- Asignaciones concurrentes enviadas: 3`);
    console.log(`- Asignaciones exitosas: ${successCountAssign}`);
    console.log(`- Asignaciones rechazadas: ${errorCountAssign}`);

    // Verificar estado final en BD
    const docSnap = await db.collection('TurnosProgramados').doc(vacancyId).get();
    const data = docSnap.data();

    if (successCountAssign === 1 && data.requiereCobertura === false && data.replacementShiftId) {
      console.log('✅ PASS: Concurrencia transaccional mantenida para assignVacancyReplacement. Solo un reemplazante fue aceptado.');
    } else {
      console.log('❌ FAIL: Condición de carrera explotada. Más de una asignación permitida o estado inconsistente.');
    }

  } catch (error) {
    console.error('Error durante ejecución:', error);
  }

  process.exit(0);
}

testConcurrency();
