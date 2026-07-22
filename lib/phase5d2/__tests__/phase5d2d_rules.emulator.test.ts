/**
 * phase5d2d_rules.emulator.test.ts
 *
 * Tests de Firestore Rules para colecciones V2 — backend-only.
 *
 * Verifica que ningún cliente puede leer, listar, crear, modificar ni eliminar
 * documentos de AsistenciasConsolidadas, AttendanceShadowComparisons,
 * AuditoriaAcciones o FeatureFlags directamente.
 *
 * Prerequisitos:
 *   - Firestore Emulator con Rules cargadas (firebase emulators:start --only firestore)
 *   - Auth Emulator en 127.0.0.1:9099
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest';

let testEnv: RulesTestEnvironment;

// Ruta a las rules desde la raíz del proyecto
const RULES_PATH = resolve(__dirname, '../../../../firestore.rules');

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ggss-security-test',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync(RULES_PATH, 'utf8')
    }
  });
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAuthClient(uid: string, role: string) {
  return testEnv.authenticatedContext(uid, { role }).firestore();
}

function getUnauthClient() {
  return testEnv.unauthenticatedContext().firestore();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withAdminSdk(fn: (db: any) => Promise<void>): Promise<void> {
  // withSecurityRulesDisabled provee el Firestore del cliente de testing
  // (no Admin SDK), pero opera sin restricciones de Rules.
  return testEnv.withSecurityRulesDisabled(ctx => fn(ctx.firestore()));
}


// ===========================================================================
// AsistenciasConsolidadas
// ===========================================================================
describe('Rules — AsistenciasConsolidadas (backend-only)', () => {

  test('R1.1 No autenticado — get denegado', async () => {
    const db = getUnauthClient();
    await assertFails(db.collection('AsistenciasConsolidadas').doc('any').get());
  });

  test('R1.2 Worker — get denegado', async () => {
    const db = getAuthClient('worker1', 'worker');
    await assertFails(db.collection('AsistenciasConsolidadas').doc('any').get());
  });

  test('R1.3 Supervisor — get denegado', async () => {
    const db = getAuthClient('sup1', 'supervisor');
    await assertFails(db.collection('AsistenciasConsolidadas').doc('any').get());
  });

  test('R1.4 Jefe operaciones — get denegado', async () => {
    const db = getAuthClient('jefe1', 'jefe_operaciones');
    await assertFails(db.collection('AsistenciasConsolidadas').doc('any').get());
  });

  test('R1.5 RRHH — get denegado', async () => {
    const db = getAuthClient('rrhh1', 'rrhh');
    await assertFails(db.collection('AsistenciasConsolidadas').doc('any').get());
  });

  test('R1.6 Admin — get denegado directamente', async () => {
    const db = getAuthClient('admin1', 'admin');
    await assertFails(db.collection('AsistenciasConsolidadas').doc('any').get());
  });

  test('R1.7 No autenticado — list denegado', async () => {
    const db = getUnauthClient();
    await assertFails(db.collection('AsistenciasConsolidadas').get());
  });

  test('R1.8 Admin — list denegado directamente', async () => {
    const db = getAuthClient('admin1', 'admin');
    await assertFails(db.collection('AsistenciasConsolidadas').get());
  });

  test('R1.9 Ningún cliente puede crear', async () => {
    const db = getAuthClient('admin1', 'admin');
    await assertFails(
      db.collection('AsistenciasConsolidadas').doc('new').set({ test: true })
    );
  });

  test('R1.10 Ningún cliente puede eliminar', async () => {
    // Crear doc con Admin SDK primero
    await withAdminSdk(async (adminDb) => {
      await adminDb.collection('AsistenciasConsolidadas').doc('to_delete').set({ test: true });
    });

    const db = getAuthClient('admin1', 'admin');
    await assertFails(db.collection('AsistenciasConsolidadas').doc('to_delete').delete());
  });

  test('R1.11 Admin SDK puede escribir y leer', async () => {
    await withAdminSdk(async (adminDb) => {
      await assertSucceeds(
        adminDb.collection('AsistenciasConsolidadas').doc('admin_doc').set({
          checkInId: 'test', employeeId: 'emp_01', jornadaDate: '2024-06-01'
        })
      );
      await assertSucceeds(
        adminDb.collection('AsistenciasConsolidadas').doc('admin_doc').get()
      );
    });
  });
});

// ===========================================================================
// AttendanceShadowComparisons
// ===========================================================================
describe('Rules — AttendanceShadowComparisons (backend-only)', () => {

  test('R2.1 No autenticado — get denegado', async () => {
    const db = getUnauthClient();
    await assertFails(db.collection('AttendanceShadowComparisons').doc('any').get());
  });

  test('R2.2 Admin — get denegado directamente', async () => {
    const db = getAuthClient('admin1', 'admin');
    await assertFails(db.collection('AttendanceShadowComparisons').doc('any').get());
  });

  test('R2.3 Worker — get denegado', async () => {
    const db = getAuthClient('worker1', 'worker');
    await assertFails(db.collection('AttendanceShadowComparisons').doc('any').get());
  });

  test('R2.4 Ningún cliente puede crear', async () => {
    const db = getAuthClient('admin1', 'admin');
    await assertFails(
      db.collection('AttendanceShadowComparisons').doc('new').set({ test: true })
    );
  });

  test('R2.5 Ningún cliente puede listar', async () => {
    const db = getAuthClient('admin1', 'admin');
    await assertFails(db.collection('AttendanceShadowComparisons').get());
  });

  test('R2.6 Admin SDK puede escribir', async () => {
    await withAdminSdk(async (adminDb) => {
      await assertSucceeds(
        adminDb.collection('AttendanceShadowComparisons').doc('cmp_test').set({ status: 'exact_match' })
      );
    });
  });
});

// ===========================================================================
// AuditoriaAcciones
// ===========================================================================
describe('Rules — AuditoriaAcciones (backend-only)', () => {

  test('R3.1 No autenticado — get denegado', async () => {
    const db = getUnauthClient();
    await assertFails(db.collection('AuditoriaAcciones').doc('any').get());
  });

  test('R3.2 Admin — get denegado directamente', async () => {
    const db = getAuthClient('admin1', 'admin');
    await assertFails(db.collection('AuditoriaAcciones').doc('any').get());
  });

  test('R3.3 Supervisor — get denegado', async () => {
    const db = getAuthClient('sup1', 'supervisor');
    await assertFails(db.collection('AuditoriaAcciones').doc('any').get());
  });

  test('R3.4 Ningún cliente puede crear ni listar', async () => {
    const db = getAuthClient('admin1', 'admin');
    await assertFails(db.collection('AuditoriaAcciones').doc('new').set({ test: true }));
    await assertFails(db.collection('AuditoriaAcciones').get());
  });

  test('R3.5 Admin SDK puede crear registro de auditoría', async () => {
    await withAdminSdk(async (adminDb) => {
      await assertSucceeds(
        adminDb.collection('AuditoriaAcciones').doc('shadow_read_uid_req').set({
          accion: 'attendance_v2_shadow_read',
          actorId: 'uid',
          requestId: 'req'
        })
      );
    });
  });
});

// ===========================================================================
// FeatureFlags (attendanceV2Read)
// ===========================================================================
describe('Rules — FeatureFlags (backend-only)', () => {

  test('R4.1 No autenticado — get denegado', async () => {
    const db = getUnauthClient();
    await assertFails(db.collection('FeatureFlags').doc('attendanceV2Read').get());
  });

  test('R4.2 Admin — get denegado directamente', async () => {
    const db = getAuthClient('admin1', 'admin');
    await assertFails(db.collection('FeatureFlags').doc('attendanceV2Read').get());
  });

  test('R4.3 Ningún cliente puede modificar el Feature Flag', async () => {
    const db = getAuthClient('admin1', 'admin');
    await assertFails(
      db.collection('FeatureFlags').doc('attendanceV2Read').set({ enabled: true })
    );
  });

  test('R4.4 Admin SDK puede leer y escribir el Feature Flag', async () => {
    await withAdminSdk(async (adminDb) => {
      await assertSucceeds(
        adminDb.collection('FeatureFlags').doc('attendanceV2Read').set({
          enabled: false, shadowReadEnabled: false
        })
      );
      await assertSucceeds(
        adminDb.collection('FeatureFlags').doc('attendanceV2Read').get()
      );
    });
  });
});
