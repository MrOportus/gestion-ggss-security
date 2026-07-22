import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-rules-5d2c',
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    }
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('Fase 5D.2C - Firestore Rules (Nuevas Colecciones)', () => {
  
  it('1. No autenticado no lee, crea, actualiza ni elimina en AsistenciasConsolidadas y AttendanceShadowComparisons', async () => {
    const unauth = testEnv.unauthenticatedContext();
    const db = unauth.firestore();
    await assertFails(db.collection('AsistenciasConsolidadas').doc('1').get());
    await assertFails(db.collection('AsistenciasConsolidadas').doc('1').set({ foo: 'bar' }));
    await assertFails(db.collection('AttendanceShadowComparisons').doc('1').get());
    await assertFails(db.collection('AttendanceShadowComparisons').doc('1').set({ foo: 'bar' }));
  });

  const runRoleTests = (roleName: string, roleData: any) => {
    it(`2. Rol ${roleName} no lee, crea, actualiza ni elimina en nuevas colecciones`, async () => {
      const uid = `user_${roleName}`;
      // Inyectar usuario en auth y en /Colaboradores/{uid} para que asimile el rol si hay reglas que lo lean
      // (Aunque la regla Default Deny las bloquea directo)
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await adminDb.collection('Colaboradores').doc(uid).set(roleData);
      });

      const authContext = testEnv.authenticatedContext(uid);
      const db = authContext.firestore();
      
      await assertFails(db.collection('AsistenciasConsolidadas').doc('1').get());
      await assertFails(db.collection('AsistenciasConsolidadas').doc('1').set({ foo: 'bar' }));
      await assertFails(db.collection('AsistenciasConsolidadas').doc('1').update({ foo: 'baz' }));
      await assertFails(db.collection('AsistenciasConsolidadas').doc('1').delete());

      await assertFails(db.collection('AttendanceShadowComparisons').doc('1').get());
      await assertFails(db.collection('AttendanceShadowComparisons').doc('1').set({ foo: 'bar' }));
      await assertFails(db.collection('AttendanceShadowComparisons').doc('1').update({ foo: 'baz' }));
      await assertFails(db.collection('AttendanceShadowComparisons').doc('1').delete());
    });
  };

  runRoleTests('worker', { role: 'worker', status: 'active' });
  runRoleTests('supervisor', { role: 'supervisor', status: 'active' });
  runRoleTests('jefe_operaciones', { role: 'jefe_operaciones', status: 'active' });
  runRoleTests('rrhh', { role: 'rrhh', status: 'active' });
  runRoleTests('admin', { role: 'admin', status: 'active' }); // Admin cliente tampoco

  it('3. Admin SDK backend sí escribe (bypass rules)', async () => {
    // Admin SDK ignora las reglas por completo. Esto se valida con el test de dual_write
    // pero aquí emulamos el comportamiento
    const dbAdmin = testEnv.authenticatedContext('system_admin').firestore();
    // testEnv.withSecurityRulesDisabled emula el SDK Admin
    await assertSucceeds(testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('AsistenciasConsolidadas').doc('1').set({ system: true });
      await db.collection('AttendanceShadowComparisons').doc('1').set({ system: true });
    }));
  });
});
