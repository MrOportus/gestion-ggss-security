const admin = require('firebase-admin');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
admin.initializeApp({ projectId: 'demo-local' });
const db = admin.firestore();

// Use the actual backend handler
const { transferScheduledShiftsHandler } = require('../functions/src/phase4/transferScheduledShifts');

async function setup() {
  await db.collection('Colaboradores').doc('admin_user').set({
    id: 'admin_user',
    role: 'admin',
    isActive: true
  });
  
  await db.collection('TurnosProgramados').doc('turno_concurrencia').set({
    id: 'turno_concurrencia',
    colaboradorId: 'emp1',
    sucursalId: 'site1',
    fecha: '2024-08-01',
    estado: 'programado',
    codigo: 'X',
    esProductivo: true,
    requiereAsistencia: true,
    horarioSnapshot: { inicio: '07:00', termino: '15:00', cruzaMedianoche: false }
  });
}

async function testConcurrency() {
  console.log('Iniciando prueba de concurrencia...');
  const req1 = {
    auth: { uid: 'admin_user' },
    data: {
      turnoProgramadoIds: ['turno_concurrencia'],
      sucursalDestinoId: 'site2',
      tipoOperacion: 'traslado_temporal',
      motivo: 'req1',
      operationRequestId: 'req-001'
    }
  };
  const req2 = {
    auth: { uid: 'admin_user' },
    data: {
      turnoProgramadoIds: ['turno_concurrencia'],
      sucursalDestinoId: 'site2',
      tipoOperacion: 'traslado_temporal',
      motivo: 'req2',
      operationRequestId: 'req-002' // Diferente ID
    }
  };

  const p1 = transferScheduledShiftsHandler(req1).catch(e => e);
  const p2 = transferScheduledShiftsHandler(req2).catch(e => e);

  const results = await Promise.all([p1, p2]);
  
  console.log('Result 1:', results[0].message || results[0].results);
  console.log('Result 2:', results[1].message || results[1].results);
}

async function testIdempotency() {
  console.log('\nIniciando prueba de idempotencia...');
  // Restablecer
  await db.collection('TurnosProgramados').doc('turno_idempotencia').set({
    id: 'turno_idempotencia', colaboradorId: 'emp2', sucursalId: 'site1', fecha: '2024-08-02', estado: 'programado', codigo: 'X', esProductivo: true, requiereAsistencia: true, horarioSnapshot: { inicio: '07:00', termino: '15:00', cruzaMedianoche: false }
  });

  const req = {
    auth: { uid: 'admin_user' },
    data: { turnoProgramadoIds: ['turno_idempotencia'], sucursalDestinoId: 'site3', tipoOperacion: 'traslado_temporal', motivo: 'idem', operationRequestId: 'req-idem' }
  };

  const p1 = transferScheduledShiftsHandler(req).catch(e => e);
  const p2 = transferScheduledShiftsHandler(req).catch(e => e);
  
  const results = await Promise.all([p1, p2]);
  console.log('Idem Result 1:', results[0].results);
  console.log('Idem Result 2:', results[1].results);
}

async function main() {
  await setup();
  await testConcurrency();
  await testIdempotency();
  console.log('Hecho.');
  process.exit(0);
}
main();
