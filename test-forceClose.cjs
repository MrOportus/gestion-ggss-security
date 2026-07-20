// test-forceClose.cjs
const assert = require('assert');

// 1. Mock require for firebase-admin and firebase-functions
const Module = require('module');
const originalRequire = Module.prototype.require;
class HttpsErrorMock extends Error {
  constructor(code, msg) { super(msg); this.code = code; }
}
const functionsMock = {
  onCall: (opts, cb) => cb,
  HttpsError: HttpsErrorMock
};
Module.prototype.require = function() {
  if (arguments[0] === 'firebase-admin') return adminMock;
  if (arguments[0] === 'firebase-functions/v2/https') return functionsMock;
  return originalRequire.apply(this, arguments);
};

// 2. Database Mock
const mockDb = {
  Colaboradores: {
    'admin1': { role: 'admin', email: 'admin@test.com', currentSiteId: 999 },
    'worker1': { role: 'worker', email: 'worker@test.com' },
  },
  Asistencia: {
    'att1': { status: 'open', estado: 'ABIERTO', employeeId: 'worker1', localDate: '2026-07-15', timestamp: new Date().toISOString() },
    'att2': { status: 'completed', estado: 'CERRADO' },
    'att3': { status: 'open', estado: 'ABIERTO', employeeId: 'worker1', turnoProgramadoId: 'tp1', timestamp: new Date().toISOString() }
  },
  TurnosProgramados: {
    'tp1': { sucursalId: 100 }
  },
  programacion: {},
  asistencia_manual: {},
  AuditoriaAcciones: {},
  OperationTokens: {},
  AlcancesOperativos: {
    'sup1': { activo: true, alcanceNacional: false, sucursalesAutorizadas: ['100'] },
    'sup2': { activo: true, alcanceNacional: false, sucursalesAutorizadas: ['999'] },
    'jefe_in': { activo: true, alcanceNacional: false, sucursalesAutorizadas: ['100'] },
    'jefe_out': { activo: true, alcanceNacional: false, sucursalesAutorizadas: ['999'] },
  }
};

const adminMock = {
  firestore: () => ({
    collection: (colName) => {
      let filters = [];
      const qMock = {
        where: (field, op, val) => { filters.push({field, op, val}); return qMock; },
        limit: () => qMock,
        get: async () => {
          let docs = [];
          if (colName === 'Asistencia') {
             docs = Object.keys(mockDb.Asistencia || {}).map(k => mockDb.Asistencia[k]).filter(d => {
                return filters.every(f => {
                  if (f.op === '==') return d[f.field] === f.val;
                  if (f.op === '>') return (d[f.field] || '') > f.val;
                  return true;
                });
             });
          }
          return {
            empty: docs.length === 0,
            forEach: (cb) => docs.forEach(d => cb({ data: () => d }))
          };
        }
      };
      qMock.doc = (docId) => ({
        get: async () => {
          const docData = mockDb[colName] && mockDb[colName][docId];
          return {
            exists: !!docData,
            data: () => docData,
            id: docId
          };
        },
        set: (data) => {
          if (!mockDb[colName]) mockDb[colName] = {};
          mockDb[colName][docId] = data;
        },
        update: (data) => {
          if (!mockDb[colName]) mockDb[colName] = {};
          mockDb[colName][docId] = { ...mockDb[colName][docId], ...data };
        }
      });
      return qMock;
    },
    runTransaction: async (cb) => {
      const transactionMock = {
        get: async (ref) => ref.get(),
        set: (ref, data) => { ref.set(data); },
        update: (ref, data) => { ref.update(data); },
        delete: (ref) => { if (ref.delete) ref.delete(); }
      };
      return cb(transactionMock);
    }
  })
};

adminMock.firestore.Timestamp = { fromDate: (d) => d };
adminMock.firestore.FieldValue = { serverTimestamp: () => 'SERVER_TIME' };

// 3. Load Function
const { forceCloseAttendanceValidated } = require('./functions/src/phase5/forceCloseAttendanceValidated.js');

async function runTests() {
  console.log('--- STARTING NODE MOCK TESTS ---');

  // Helpers
  const adminContext = { auth: { uid: 'admin1', token: { email: 'admin@test.com' } } };
  const jefeInContext = { auth: { uid: 'jefe_in', token: { email: 'jefe@test.com' } } };
  const jefeOutContext = { auth: { uid: 'jefe_out', token: { email: 'jefe@test.com' } } };
  const supInContext = { auth: { uid: 'sup1', token: { email: 'sup@test.com' } } };
  const supOutContext = { auth: { uid: 'sup2', token: { email: 'sup@test.com' } } };
  const rrhhContext = { auth: { uid: 'rrhh_1', token: { email: 'rrhh@test.com' } } };
  
  mockDb.Colaboradores['jefe_in'] = { role: 'jefe_operaciones' };
  mockDb.Colaboradores['jefe_out'] = { role: 'jefe_operaciones' };
  mockDb.Colaboradores['sup1'] = { role: 'supervisor' };
  mockDb.Colaboradores['sup2'] = { role: 'supervisor' };
  mockDb.Colaboradores['rrhh_1'] = { role: 'rrhh' };

  // Test 1: Admin permite todo
  const resAdmin = await forceCloseAttendanceValidated({ ...adminContext, data: { attendanceId: 'att3', requestId: 'r1' } });
  assert.strictEqual(resAdmin.success, true);
  console.log('✓ 1. Admin cierra correctamente');

  // Test 2: Jefe de operaciones dentro de alcance
  mockDb.Asistencia['att_jefe'] = { status: 'open', employeeId: 'worker1', turnoProgramadoId: 'tp1', timestamp: '2026' };
  const resJefeIn = await forceCloseAttendanceValidated({ ...jefeInContext, data: { attendanceId: 'att_jefe', requestId: 'r2' } });
  assert.strictEqual(resJefeIn.success, true);
  console.log('✓ 2. Jefe de operaciones dentro de alcance');

  // Test 3: Jefe de operaciones fuera de alcance
  try {
    mockDb.Asistencia['att_jefe_out'] = { status: 'open', employeeId: 'worker1', turnoProgramadoId: 'tp1', timestamp: '2026' };
    await forceCloseAttendanceValidated({ ...jefeOutContext, data: { attendanceId: 'att_jefe_out', requestId: 'r3' } });
    assert.fail('Debió fallar');
  } catch (e) {
    assert.strictEqual(e.code, 'permission-denied');
    console.log('✓ 3. Jefe de operaciones fuera de alcance');
  }

  // Test 4: Supervisor dentro de alcance
  mockDb.Asistencia['att_sup_in'] = { status: 'open', employeeId: 'worker1', turnoProgramadoId: 'tp1', timestamp: '2026' };
  const resSupIn = await forceCloseAttendanceValidated({ ...supInContext, data: { attendanceId: 'att_sup_in', requestId: 'r4' } });
  assert.strictEqual(resSupIn.success, true);
  console.log('✓ 4. Supervisor dentro de alcance');

  // Test 5: Supervisor fuera de alcance
  try {
    mockDb.Asistencia['att_sup_out'] = { status: 'open', employeeId: 'worker1', turnoProgramadoId: 'tp1', timestamp: '2026' };
    await forceCloseAttendanceValidated({ ...supOutContext, data: { attendanceId: 'att_sup_out', requestId: 'r5' } });
    assert.fail('Debió fallar');
  } catch (e) {
    assert.strictEqual(e.code, 'permission-denied');
    console.log('✓ 5. Supervisor fuera de alcance');
  }

  // Test 6: RRHH y Guardia rechazados
  try {
    await forceCloseAttendanceValidated({ ...rrhhContext, data: { attendanceId: 'att3', requestId: 'r6' } });
    assert.fail('Debió fallar rrhh');
  } catch (e) {
    assert.strictEqual(e.code, 'permission-denied');
    console.log('✓ 6. RRHH y Guardia rechazados');
  }

  // Test 7: No autenticado
  try {
    await forceCloseAttendanceValidated({ data: { attendanceId: 'att3', requestId: 'r7' } });
    assert.fail('Debió fallar');
  } catch (e) {
    assert.strictEqual(e.code, 'unauthenticated');
    console.log('✓ 7. No autenticado');
  }

  // Test 8: Asistencia inexistente
  try {
    await forceCloseAttendanceValidated({ ...adminContext, data: { attendanceId: 'att_fake', requestId: 'r8' } });
    assert.fail('Debió fallar');
  } catch (e) {
    assert.strictEqual(e.code, 'not-found');
    console.log('✓ 8. Asistencia inexistente');
  }

  // Test 9: Idempotencia válida
  mockDb.Asistencia['att_idem'] = { status: 'open', employeeId: 'worker1', turnoProgramadoId: 'tp1', timestamp: '2026' };
  const resIdem1 = await forceCloseAttendanceValidated({ ...adminContext, data: { attendanceId: 'att_idem', requestId: 'r9' } });
  const resIdem2 = await forceCloseAttendanceValidated({ ...adminContext, data: { attendanceId: 'att_idem', requestId: 'r9' } });
  assert.strictEqual(resIdem2.checkOutId, resIdem1.checkOutId);
  console.log('✓ 9. Idempotencia válida (misma petición devuelve mismo resultado)');

  // Test 10: requestId reutilizado
  try {
    await forceCloseAttendanceValidated({ ...adminContext, data: { attendanceId: 'att_idem', requestId: 'r9', note: 'dif' } });
    assert.fail('Debió fallar por payloadHash');
  } catch(e) {
    if (e.code !== 'already-exists') {
      console.error("Test 10 Failed with different error:", e);
    }
    assert.strictEqual(e.code, 'already-exists');
    console.log('✓ 10. requestId reutilizado con payload diferente');
  }

  // Test 11: Sucursal no determinada
  mockDb.Asistencia['att_nosite'] = { status: 'open', employeeId: 'worker1', timestamp: '2026' };
  try {
    await forceCloseAttendanceValidated({ ...supInContext, data: { attendanceId: 'att_nosite', requestId: 'r11' } });
    assert.fail('Debió fallar');
  } catch(e) {
    assert.strictEqual(e.code, 'permission-denied');
  }
  const resNositeAdmin = await forceCloseAttendanceValidated({ ...adminContext, data: { attendanceId: 'att_nosite', requestId: 'r11_admin' } });
  assert.strictEqual(resNositeAdmin.success, true);
  console.log('✓ 11. Sucursal no determinada manejada correctamente');

  // Test 12: Sesión posterior activa evita forceLogout
  mockDb.Asistencia['att_old'] = { status: 'open', estado: 'ABIERTO', employeeId: 'worker_old', timestamp: '2026-07-19T00:00:00Z' };
  mockDb.Asistencia['att_new'] = { status: 'open', estado: 'ABIERTO', employeeId: 'worker_old', type: 'check_in', timestamp: '2026-07-20T00:00:00Z' };
  mockDb.Colaboradores['worker_old'] = { role: 'worker' };
  await forceCloseAttendanceValidated({ ...adminContext, data: { attendanceId: 'att_old', requestId: 'r12' } });
  assert.strictEqual(mockDb.Colaboradores['worker_old'].forceLogout, undefined);
  console.log('✓ 12. Sesión posterior activa evita forceLogout');

  // Test 13: Sesión posterior cerrada NO lo evita
  mockDb.Asistencia['att_old2'] = { status: 'open', employeeId: 'worker_old2', timestamp: '2026-07-19T00:00:00Z' };
  mockDb.Asistencia['att_new2'] = { status: 'completed', employeeId: 'worker_old2', type: 'check_in', timestamp: '2026-07-20T00:00:00Z' };
  mockDb.Colaboradores['worker_old2'] = { role: 'worker' };
  await forceCloseAttendanceValidated({ ...adminContext, data: { attendanceId: 'att_old2', requestId: 'r13' } });
  assert.strictEqual(mockDb.Colaboradores['worker_old2'].forceLogout, true);
  console.log('✓ 13. Sesión posterior cerrada NO evita forceLogout');

  console.log('--- ALL NODE MOCK TESTS PASSED ---');
}

runTests().catch(console.error);
