// test-autoClose.cjs
const assert = require('assert');

// 1. Mock require for firebase-admin and firebase-functions
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function() {
  if (arguments[0] === 'firebase-admin') return adminMock;
  if (arguments[0] === 'firebase-admin/firestore') return { FieldValue: adminMock.firestore.FieldValue };
  if (arguments[0] === 'firebase-functions/v2/https') return { 
    onCall: (opts, cb) => cb,
    HttpsError: class extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    }
  };
  return originalRequire.apply(this, arguments);
};

// 2. Database Mock
const mockDb = {
  Colaboradores: {
    'admin1': { role: 'admin', email: 'admin@test.com', currentSiteId: 999 },
    'worker1': { role: 'worker', email: 'worker@test.com' },
    'worker_old': { role: 'worker' }
  },
  Asistencia: {
    'att_expired': { 
        type: 'check_in', estado: 'ABIERTO', employeeId: 'worker1', 
        timestamp: new Date(Date.now() - (15 * 60 * 60 * 1000)).toISOString() // 15 hours ago, so expired 
    },
    'att_not_expired': { 
        type: 'check_in', estado: 'ABIERTO', employeeId: 'worker1', 
        timestamp: new Date(Date.now() - (1 * 60 * 60 * 1000)).toISOString() // 1 hour ago, not expired
    },
    'att_closed': { 
        type: 'check_in', estado: 'CERRADO', status: 'completed', employeeId: 'worker1', 
        timestamp: new Date(Date.now() - (15 * 60 * 60 * 1000)).toISOString() 
    },
    'att_old_posterior': { 
        type: 'check_in', estado: 'ABIERTO', employeeId: 'worker_old', 
        timestamp: new Date(Date.now() - (20 * 60 * 60 * 1000)).toISOString() 
    },
    'att_new_posterior': { 
        type: 'check_in', estado: 'ABIERTO', employeeId: 'worker_old', 
        timestamp: new Date(Date.now() - (1 * 60 * 60 * 1000)).toISOString() 
    }
  },
  TurnosProgramados: {},
  programacion: {},
  asistencia_manual: {},
  asistencia_digital: {
      'sin_sucursal_worker1_2026-07-20': {} // Mocking a digital attendance to be deleted
  },
  AuditoriaAcciones: {},
  OperationTokens: {},
  AlcancesOperativos: {}
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
          const colData = mockDb[colName] || {};
          docs = Object.keys(colData).map(k => ({ id: k, ...colData[k] })).filter(d => {
            return filters.every(f => {
              if (f.op === '==') return d[f.field] === f.val;
              if (f.op === '>') return (d[f.field] || '') > f.val;
              return true;
            });
          });
          return {
            empty: docs.length === 0,
            size: docs.length,
            docs: docs.map(d => ({ data: () => d, id: d.id })),
            forEach: (cb) => docs.forEach(d => cb({ data: () => d, id: d.id, ref: qMock.doc(d.id) }))
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
        },
        delete: () => {
          if (mockDb[colName] && mockDb[colName][docId]) {
              delete mockDb[colName][docId];
          }
        }
      });
      return qMock;
    },
    runTransaction: async (cb) => {
      const transactionMock = {
        get: async (ref) => ref.get(),
        set: (ref, data) => { ref.set(data); },
        update: (ref, data) => { ref.update(data); },
        delete: (ref) => { ref.delete(); }
      };
      return cb(transactionMock);
    }
  })
};

adminMock.firestore.Timestamp = { fromDate: (d) => d };
adminMock.firestore.FieldValue = { serverTimestamp: () => 'SERVER_TIME', arrayRemove: () => {} };

// 3. Load Functions
const { processAutoCloseShifts } = require('./functions/autoCloseHelper.js');
const { executeAttendanceClosure } = require('./functions/src/phase5/attendanceClosureCore.js');
const { forceCloseAttendanceValidated } = require('./functions/src/phase5/forceCloseAttendanceValidated.js');

async function runTests() {
  console.log('--- STARTING AUTOCLOSE AND FORCECLOSE TESTS ---');
  let failures = 0;
  
  function testAssert(condition, message) {
      if (!condition) {
          console.error(`❌ FAIL: ${message}`);
          failures++;
      } else {
          console.log(`✓ PASS: ${message}`);
      }
  }

  const now = new Date();
  const db = adminMock.firestore();

  // Test 1: Ejecutar AutoClose Helper
  const res = await processAutoCloseShifts(db, now, adminMock.firestore.FieldValue);
  
  // Expirado (att_expired, att_old_posterior) -> Se deben cerrar 2
  // att_closed -> Ignorado (ya cerrado, pero el query principal solo trae ABIERTO)
  // att_not_expired -> Ignorado por no expirar
  testAssert(res.cerrados === 2, `Cerrados esperados: 2, actual: ${res.cerrados}`);

  // Verificar estado de att_expired
  const attExpired = mockDb.Asistencia['att_expired'];
  testAssert(attExpired.estado === 'CERRADO' && attExpired.tipoCierre === 'AUTOMATICO', "att_expired debió cerrarse como AUTOMATICO");

  // Verificar check-out generado
  const checkOutExpired = mockDb.Asistencia['auto_checkout_att_expired'];
  testAssert(!!checkOutExpired, "Check-out de att_expired debió generarse");
  testAssert(checkOutExpired.tipoCierre === 'AUTOMATICO' && checkOutExpired.isManual === false, "Check-out properties correctas");

  // Verificar forceLogout en worker1 (att_expired tiene sesión posterior att_not_expired)
  testAssert(mockDb.Colaboradores['worker1'].forceLogout === undefined, "worker1 NO debió recibir forceLogout (tiene sesión posterior)");

  // Verificar forceLogout en worker_old (att_old_posterior tiene sesion posterior att_new_posterior que está abierta)
  testAssert(mockDb.Colaboradores['worker_old'].forceLogout === undefined, "worker_old NO debió recibir forceLogout (tiene sesión posterior)");

  // Verificar AuditoriaAcciones
  const auditExpired = mockDb.AuditoriaAcciones['auto_close_att_expired'];
  testAssert(!!auditExpired, "Auditoría de att_expired debió generarse");
  testAssert(auditExpired.accion === 'auto_close' && auditExpired.origen === 'scheduler', "Auditoría properties correctas");

  // Test 2: Idempotencia - Ejecutar AutoClose de nuevo
  const res2 = await processAutoCloseShifts(db, now, adminMock.firestore.FieldValue);
  testAssert(res2.cerrados === 0, `Idempotencia falló. Cerrados esperados: 0, actual: ${res2.cerrados}`);

  // Test 3: Cierre Forzado Manual sobre el que no está expirado
  const adminContext = { auth: { uid: 'admin1', token: { email: 'admin@test.com' } } };
  const forceRes = await forceCloseAttendanceValidated({ ...adminContext, data: { attendanceId: 'att_not_expired', requestId: 'manual_r1', note: 'Manual' } });
  testAssert(forceRes.success === true, "ForceClose manual debió tener éxito");

  const checkOutManual = mockDb.Asistencia['forced_checkout_att_not_expired'];
  testAssert(!!checkOutManual, "Check-out manual debió generarse");
  testAssert(checkOutManual.tipoCierre === 'MANUAL' && checkOutManual.isManual === true, "Check-out manual properties correctas");
  
  const auditManual = mockDb.AuditoriaAcciones['attendance_force_closed_att_not_expired'];
  testAssert(!!auditManual, "Auditoría manual debió generarse");
  testAssert(auditManual.accion === 'attendance_force_closed' && auditManual.origen === 'admin_dashboard', "Auditoría manual properties correctas");

  if (failures > 0) {
      console.error(`\n❌ ${failures} tests failed.`);
      process.exit(1);
  } else {
      console.log('\n✓ ALL TESTS PASSED SUCCESSFULLY.');
      process.exit(0);
  }
}

runTests().catch(console.error);
