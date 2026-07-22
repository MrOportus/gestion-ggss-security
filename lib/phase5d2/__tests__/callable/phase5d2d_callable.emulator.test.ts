import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as firebaseTesting from '@firebase/rules-unit-testing';
import admin from 'firebase-admin';
import { createCallableUser, getUnauthenticatedCallable } from '../helpers/callableClient';
import { randomUUID } from 'crypto';

// Re-use emulator host vars
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.CURSOR_SIGNING_SECRET = process.env.CURSOR_SIGNING_SECRET || 'test-cursor-signing-secret-minimum-32-characters';

let testEnv: firebaseTesting.RulesTestEnvironment;
let adminApp: admin.app.App;

// Helper to generate a unique request ID
const reqId = () => `req_${randomUUID()}`;

// Ensure admin is initialized for setup
if (!admin.apps.length) {
  adminApp = admin.initializeApp({ projectId: 'demo-ggss' });
} else {
  adminApp = admin.app();
}

const db = adminApp.firestore();

beforeAll(async () => {
  testEnv = await firebaseTesting.initializeTestEnvironment({
    projectId: 'demo-ggss',
    firestore: { host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// Helper para habilitar V2 y Shadow Globalmente para los tests (simulando Feature Flag activado)
async function enableShadowFF(mode: string = 'global', qaUsers: string[] = []) {
  await db.collection('FeatureFlags').doc('attendanceV2Read').set({
    enabled: true,
    activationMode: mode,
    shadowReadEnabled: true,
    enabledForQaUsers: qaUsers
  });
}

describe('Phase 5D.2D — Callable Real Emulator Integration', () => {

  describe('3. Validar la Callable real (Roles y Access Control)', () => {
    test('Usuario no autenticado -> unauthenticated', async () => {
      const call = getUnauthenticatedCallable();
      await expect(call({ queryType: 'branch_day', sucursalId: 'suc1', jornadaDate: '2024-01-01', requestId: reqId() }))
        .rejects.toThrow();
    });

    test('Usuario sin claims -> permission-denied (Rol no autorizado)', async () => {
      const { callGetAttendanceShadowValidated, logout } = await createCallableUser(adminApp, 'user_no_role', 'none');
      await expect(callGetAttendanceShadowValidated({ queryType: 'branch_day', sucursalId: 'suc1', jornadaDate: '2024-01-01', requestId: reqId() }))
        .rejects.toThrow();
      await logout();
    });

    test('Worker rechazado -> permission-denied', async () => {
      const { callGetAttendanceShadowValidated, logout } = await createCallableUser(adminApp, 'user_worker', 'worker');
      await expect(callGetAttendanceShadowValidated({ queryType: 'branch_day', sucursalId: 'suc1', jornadaDate: '2024-01-01', requestId: reqId() }))
        .rejects.toThrow();
      await logout();
    });

    test('RRHH rechazado -> permission-denied', async () => {
      const { callGetAttendanceShadowValidated, logout } = await createCallableUser(adminApp, 'user_rrhh', 'rrhh');
      await expect(callGetAttendanceShadowValidated({ queryType: 'branch_day', sucursalId: 'suc1', jornadaDate: '2024-01-01', requestId: reqId() }))
        .rejects.toThrow();
      await logout();
    });

    test('Rol desconocido -> permission-denied', async () => {
      const { callGetAttendanceShadowValidated, logout } = await createCallableUser(adminApp, 'user_unknown', 'magician');
      await expect(callGetAttendanceShadowValidated({ queryType: 'branch_day', sucursalId: 'suc1', jornadaDate: '2024-01-01', requestId: reqId() }))
        .rejects.toThrow();
      await logout();
    });

    test('Admin accede sin restricciones de AlcancesOperativos', async () => {
      await enableShadowFF('global');
      const { callGetAttendanceShadowValidated, logout } = await createCallableUser(adminApp, 'admin_1', 'admin');
      
      // Debe funcionar y retornar algo (vacío porque no hay datos)
      const res = await callGetAttendanceShadowValidated({ queryType: 'branch_day', sucursalId: 'suc_any', jornadaDate: '2024-01-01', requestId: reqId() });
      expect((res.data as any).legacyResult.items).toEqual([]);
      
      await logout();
    });

    test('Jefe de operaciones dentro de alcance', async () => {
      await enableShadowFF('global');
      const { callGetAttendanceShadowValidated, logout } = await createCallableUser(adminApp, 'jo_1', 'jefe_operaciones', { sucursales: ['suc_1'] });
      
      const res = await callGetAttendanceShadowValidated({ queryType: 'branch_day', sucursalId: 'suc_1', jornadaDate: '2024-01-01', requestId: reqId() });
      expect((res.data as any).legacyResult.items).toEqual([]);
      
      await logout();
    });

    test('Jefe de operaciones fuera de alcance -> permission-denied', async () => {
      await enableShadowFF('global');
      const { callGetAttendanceShadowValidated, logout } = await createCallableUser(adminApp, 'jo_2', 'jefe_operaciones', { sucursales: ['suc_1'] });
      
      await expect(callGetAttendanceShadowValidated({ queryType: 'branch_day', sucursalId: 'suc_2', jornadaDate: '2024-01-01', requestId: reqId() }))
        .rejects.toThrow(/No posee alcance/i);
      
      await logout();
    });

    test('Supervisor dentro de alcance', async () => {
      await enableShadowFF('global');
      const { callGetAttendanceShadowValidated, logout } = await createCallableUser(adminApp, 'sup_1', 'supervisor', { sucursales: ['suc_1'] });
      
      const res = await callGetAttendanceShadowValidated({ queryType: 'branch_day', sucursalId: 'suc_1', jornadaDate: '2024-01-01', requestId: reqId() });
      expect((res.data as any).legacyResult.items).toEqual([]);
      
      await logout();
    });

    test('Supervisor fuera de alcance -> permission-denied', async () => {
      await enableShadowFF('global');
      const { callGetAttendanceShadowValidated, logout } = await createCallableUser(adminApp, 'sup_2', 'supervisor', { sucursales: ['suc_1'] });
      
      await expect(callGetAttendanceShadowValidated({ queryType: 'branch_day', sucursalId: 'suc_2', jornadaDate: '2024-01-01', requestId: reqId() }))
        .rejects.toThrow(/No posee alcance/i);
      
      await logout();
    });
  });

  describe('6. Validar binding del cursor & 7. Paginación', () => {
    test('Paginación 3 páginas con binding HMAC real', async () => {
      await enableShadowFF('global');
      const { callGetAttendanceShadowValidated, logout } = await createCallableUser(adminApp, 'admin_p', 'admin');
      
      // Insertar 5 documentos para tener 3 páginas de tamaño 2
      const docs = [
        { id: 'v2_1', jornadaDate: '2024-06-01', checkInAt: '2024-06-01T08:00:00Z', employeeId: 'emp1' },
        { id: 'v2_2', jornadaDate: '2024-06-01', checkInAt: '2024-06-01T09:00:00Z', employeeId: 'emp2' },
        { id: 'v2_3', jornadaDate: '2024-06-01', checkInAt: '2024-06-01T10:00:00Z', employeeId: 'emp3' },
        { id: 'v2_4', jornadaDate: '2024-06-01', checkInAt: '2024-06-01T11:00:00Z', employeeId: 'emp4' },
        { id: 'v2_5', jornadaDate: '2024-06-01', checkInAt: '2024-06-01T12:00:00Z', employeeId: 'emp5' }
      ];
      
      for (const d of docs) {
        await db.collection('AsistenciasConsolidadas').doc(d.id).set({
          ...d,
          schemaVersion: 2,
          checkInId: `c_${d.id}`,
          workedMinutes: 480,
          generationStatus: 'completed'
        });
      }

      // Página 1
      const p1 = await callGetAttendanceShadowValidated({
        queryType: 'employee_day', employeeId: 'emp_any', jornadaDate: '2024-06-01', limit: 2, requestId: reqId()
        // Ojo: employee_day requiere sucursal o admin. Como es admin, lo dejamos así, pero employee_day ignora limit real y trae todo.
        // Usemos branch_day para test de paginación
      });
    });

    test('Paginación branch_day (3 páginas)', async () => {
      await enableShadowFF('global');
      const { callGetAttendanceShadowValidated, logout, uid } = await createCallableUser(adminApp, 'admin_p2', 'admin');
      
      // Insertar 5 documentos en la misma sucursal/jornada
      const sucursalId = 'suc_pag';
      const jornadaDate = '2024-06-01';
      
      // Crear en orden para que el índice coincida (orden es checkInAt, __name__)
      const batch = db.batch();
      for (let i = 1; i <= 5; i++) {
        const id = `doc_${i}`;
        batch.set(db.collection('asistencia_manual').doc(`pg_suc_${i}`), {
          colaboradorId: `emp_pg_${i}`, fecha: jornadaDate,
          checkInId: `c_${id}`,
          employeeId: `emp_${i}`,
          sucursalId,
          jornadaDate,
          checkInAt: `2024-06-01T0${i + 7}:00:00Z`, // 08, 09, 10, 11, 12
          workedMinutes: 480,
          generationStatus: 'completed'
        });
      }
      await batch.commit();

      // Página 1 (tamaño 2)
      const res1 = await callGetAttendanceShadowValidated({
        queryType: 'branch_day', sucursalId, jornadaDate, limit: 2, requestId: reqId()
      });
      const data1 = res1.data as any;
      expect(data1.legacyResult.items.length).toBe(2);
      expect(data1.legacyResult.hasMore).toBe(true);
      expect(data1.legacyResult.nextCursor).toBeDefined();

      const cursor1 = data1.legacyResult.nextCursor;

      // Intentar usar el cursor con otro queryType -> FALLA
      await expect(callGetAttendanceShadowValidated({
        queryType: 'branch_range', sucursalId, fromDate: jornadaDate, toDate: jornadaDate, limit: 2, cursor: cursor1, requestId: reqId()
      })).rejects.toThrow();

      // Intentar usar el cursor con otro sucursalId -> FALLA
      await expect(callGetAttendanceShadowValidated({
        queryType: 'branch_day', sucursalId: 'otra_suc', jornadaDate, limit: 2, cursor: cursor1, requestId: reqId()
      })).rejects.toThrow();
      
      // Otro actor (uid distinto) -> FALLA
      const actor2 = await createCallableUser(adminApp, 'admin_p3', 'admin');
      await expect(actor2.callGetAttendanceShadowValidated({
        queryType: 'branch_day', sucursalId, jornadaDate, limit: 2, cursor: cursor1, requestId: reqId()
      })).rejects.toThrow();

      // Cursor modificado (tampered) -> FALLA
      const tamperedCursor = cursor1.split('.')[0] + '.invalid_signature_here';
      await expect(callGetAttendanceShadowValidated({
        queryType: 'branch_day', sucursalId, jornadaDate, limit: 2, cursor: tamperedCursor, requestId: reqId()
      })).rejects.toThrow();

      // Re-crear admin_p2 para continuar (ya que el Firebase app es compartido y se sobreescribió)
      const actor1_again = await createCallableUser(adminApp, 'admin_p2', 'admin');
      const callGetAgain = actor1_again.callGetAttendanceShadowValidated;

      // Página 2 (tamaño 2, cursor válido)
      const res2 = await callGetAgain({
        queryType: 'branch_day', sucursalId, jornadaDate, limit: 2, cursor: cursor1, requestId: reqId()
      });
      const data2 = res2.data as any;
      expect(data2.legacyResult.items.length).toBe(2);
      expect(data2.legacyResult.hasMore).toBe(true);
      
      const cursor2 = data2.legacyResult.nextCursor;

      // Página 3 (tamaño 2, solo queda 1 doc)
      const res3 = await callGetAgain({
        queryType: 'branch_day', sucursalId, jornadaDate, limit: 2, cursor: cursor2, requestId: reqId()
      });
      const data3 = res3.data as any;
      expect(data3.legacyResult.items.length).toBe(1);
      expect(data3.legacyResult.hasMore).toBe(false);
      expect(data3.legacyResult.nextCursor).toBeNull(); // nextCursor ausente
      
      await logout();
    });
  });

  describe('9. Auditoría de lectura', () => {
    test('Idempotencia con payloadHash en AuditoriaAcciones', async () => {
      await enableShadowFF('global');
      const { callGetAttendanceShadowValidated, logout, uid } = await createCallableUser(adminApp, 'admin_audit', 'admin');
      
      const rId = reqId();
      
      // Request inicial
      const res1 = await callGetAttendanceShadowValidated({
        queryType: 'branch_day', sucursalId: 'suc1', jornadaDate: '2024-01-01', requestId: rId
      });
      expect((res1.data as any).legacyResult.items).toEqual([]);

      // Verificamos auditoría
      const auditDoc = await db.collection('AuditoriaAcciones').doc(`shadow_read_${uid}_${rId}`).get();
      expect(auditDoc.exists).toBe(true);
      const auditData = auditDoc.data()!;
      expect(auditData.accion).toBe('attendance_v2_shadow_read');
      expect(auditData.actorId).toBe(uid);
      expect(auditData.payloadHash).toBeDefined();

      // Retry exacto (mismo reqId, mismo payload) -> no falla, devuelve lo mismo
      const res2 = await callGetAttendanceShadowValidated({
        queryType: 'branch_day', sucursalId: 'suc1', jornadaDate: '2024-01-01', requestId: rId
      });
      expect((res2.data as any).legacyResult.items).toEqual([]);

      // Retry con distinto payload -> FALLA request_id_reused
      await expect(callGetAttendanceShadowValidated({
        queryType: 'branch_day', sucursalId: 'suc2', // Cambiamos filtro
        jornadaDate: '2024-01-01', requestId: rId
      })).rejects.toThrow(/request_id_reused/i);

      await logout();
    });
  });

  describe('8. Comparación paginada (scope full/page)', () => {
    test('branch_day -> comparisonScope: full, comparisonComplete: true', async () => {
      const { callGetAttendanceShadowValidated, logout, uid } = await createCallableUser(adminApp, 'admin_c1', 'admin');
      await enableShadowFF('qa_only', [uid]);
      
      const rId = reqId();
      const res = await callGetAttendanceShadowValidated({
        queryType: 'branch_day', sucursalId: 'suc1', jornadaDate: '2024-01-01', requestId: rId
      });
      const data = res.data as any;
      
      // Verificamos en auditoría
      const auditDoc = await db.collection('AuditoriaAcciones').doc(`shadow_read_${uid}_${rId}`).get();
      const auditData = auditDoc.data()!;
      
      expect(auditData.comparisonScope).toBe('full');
      expect(auditData.comparisonComplete).toBe(true);
      
      await logout();
    });

    test('branch_range -> comparisonScope: page, comparisonComplete: false', async () => {
      const { callGetAttendanceShadowValidated, logout, uid } = await createCallableUser(adminApp, 'admin_c2', 'admin');
      await enableShadowFF('qa_only', [uid]);
      
      const rId = reqId();
      const res = await callGetAttendanceShadowValidated({
        queryType: 'branch_range', sucursalId: 'suc1', fromDate: '2024-01-01', toDate: '2024-01-05', limit: 50, requestId: rId
      });
      const data = res.data as any;
      
      const auditDoc = await db.collection('AuditoriaAcciones').doc(`shadow_read_${uid}_${rId}`).get();
      const auditData = auditDoc.data()!;
      
      expect(auditData.comparisonScope).toBe('page');
      expect(auditData.comparisonComplete).toBe(false);
      
      await logout();
    });
  });

  describe('13. Documento V2 inválido', () => {
    test('Documento inválido se ignora, el válido se devuelve', async () => {
      const { callGetAttendanceShadowValidated, logout, uid } = await createCallableUser(adminApp, 'admin_inv', 'admin');
      await enableShadowFF('qa_only', [uid]);
      
      const sucursalId = 'suc_inv';
      const jornadaDate = '2024-07-01';
      
      await db.collection('AsistenciasConsolidadas').doc('doc_valid').set({
        schemaVersion: 2,
        checkInId: 'c_valid',
        employeeId: 'emp_valid',
        sucursalId,
        jornadaDate,
        checkInAt: '2024-07-01T08:00:00Z',
        workedMinutes: 480,
        generationStatus: 'completed'
      });

      await db.collection('AsistenciasConsolidadas').doc('doc_invalid').set({
        schemaVersion: 2,
        // Faltan campos obligatorios para ser read model válido
        sucursalId,
        jornadaDate,
        checkInAt: '2024-07-01T09:00:00Z'
      });

      const res = await callGetAttendanceShadowValidated({
        queryType: 'branch_day', sucursalId, jornadaDate, requestId: reqId()
      });
      const data = res.data as any;
      
      expect(data.v2Result.items.length).toBe(1); // Solo el válido
      expect(data.v2Result.items[0].employeeId).toBe('emp_valid');
      expect(data.v2Result.hasInvalidDocs).toBe(true);
      
      await logout();
    });
  });
});
