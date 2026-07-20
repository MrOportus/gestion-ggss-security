import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';

/**
 * Hotfix 5C.1 — Rules: app_config/feature_flags
 * Se ejecuta en aislamiento con un projectId único para evitar conflictos de Firestore.
 * Se usan SOLAMENTE ctx.firestore() de @firebase/rules-unit-testing, nunca lib/firebase.
 */
describe('Hotfix 5C.1 — Rules: app_config/feature_flags', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-ggss-rules-5c1',
      firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync('firestore.rules', 'utf8') },
    });

    // Seed via Admin SDK (sin restricciones de Rules)
    await testEnv.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'app_config', 'feature_flags'), {
        attendanceShadowEnabled: true,
        attendanceShadowAllBranches: true,
        sucursalesHabilitadas: [],
        resolverVersion: '5B.5',
        autoCloseCanonicalEnabled: false,
      });
      await setDoc(doc(db, 'app_config', 'version'), {
        apkVersion: '1.0.0',
      });
      // Mock un Admin para probar
      await setDoc(doc(db, 'Colaboradores', 'admin_1'), {
        role: 'admin'
      });
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  // 1. Colaborador autenticado puede hacer get de feature_flags.
  it('1. Colaborador autenticado puede leer feature_flags (get)', async () => {
    const ctx = testEnv.authenticatedContext('user_auth_1');
    const db = ctx.firestore();
    const snap = await getDoc(doc(db, 'app_config', 'feature_flags'));
    expect(snap.exists()).toBe(true);
  });

  // 2. Admin cliente puede hacer get.
  it('2. Admin cliente puede leer feature_flags (get)', async () => {
    const ctx = testEnv.authenticatedContext('admin_1');
    const db = ctx.firestore();
    const snap = await getDoc(doc(db, 'app_config', 'feature_flags'));
    expect(snap.exists()).toBe(true);
  });

  // 3. Colaborador no puede actualizar.
  it('3. Colaborador no puede actualizar feature_flags', async () => {
    const ctx = testEnv.authenticatedContext('user_auth_1');
    const db = ctx.firestore();
    await expect(
      setDoc(doc(db, 'app_config', 'feature_flags'), { attendanceShadowEnabled: false }, { merge: true })
    ).rejects.toThrow();
  });

  // 4. Admin cliente tampoco puede actualizar feature_flags.
  it('4. Admin cliente tampoco puede actualizar feature_flags', async () => {
    const ctx = testEnv.authenticatedContext('admin_1');
    const db = ctx.firestore();
    await expect(
      setDoc(doc(db, 'app_config', 'feature_flags'), { attendanceShadowEnabled: false }, { merge: true })
    ).rejects.toThrow();
  });

  // 5 y 6. Restricciones combinadas para SDK cliente
  it('5-6a. Restricciones de escritura en app_config desde SDK cliente (Colaborador)', async () => {
    const ctx = testEnv.authenticatedContext('user_auth_1');
    const db = ctx.firestore();

    await expect(setDoc(doc(db, 'app_config', 'feature_flags'), {})).rejects.toThrow();

    const snap = await getDoc(doc(db, 'app_config', 'version'));
    expect(snap.exists()).toBe(true);

    await expect(
      setDoc(doc(db, 'app_config', 'version'), { apkVersion: '1.2.0' }, { merge: true })
    ).rejects.toThrow();
  });

  it('5-6b. Restricciones de escritura en app_config desde SDK cliente (Admin)', async () => {
    const ctx = testEnv.authenticatedContext('admin_1');
    const db = ctx.firestore();

    await expect(setDoc(doc(db, 'app_config', 'feature_flags'), {})).rejects.toThrow();

    await expect(
      setDoc(doc(db, 'app_config', 'version'), { apkVersion: '1.1.0' }, { merge: true })
    ).resolves.toBeUndefined();
  });

  // 7. Admin SDK puede administrar feature_flags.
  it('7. Admin SDK (Backend) puede administrar feature_flags', async () => {
    await testEnv.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      // Update
      await expect(
        setDoc(doc(db, 'app_config', 'feature_flags'), { resolverVersion: '5C.2' }, { merge: true })
      ).resolves.toBeUndefined();
      
      // Delete
      await expect(
        deleteDoc(doc(db, 'app_config', 'feature_flags'))
      ).resolves.toBeUndefined();
      
      // Create
      await expect(
        setDoc(doc(db, 'app_config', 'feature_flags'), { createdByAdminSdk: true })
      ).resolves.toBeUndefined();
    });
  });

  // 8. Cliente no puede crear, borrar ni actualizar campos operacionales en TurnosProgramados
  it('8. Cliente (incluso Admin) no puede crear en TurnosProgramados', async () => {
    const ctx = testEnv.authenticatedContext('admin_1');
    const db = ctx.firestore();
    await expect(
      setDoc(doc(db, 'TurnosProgramados', 'test_tp'), {
        colaboradorId: 'emp_1',
        fechaOperacional: '2023-10-15',
        codigoTurno: 'X'
      })
    ).rejects.toThrow();
  });

  // 9. Cliente no puede crear en programacion
  it('9. Cliente (incluso Admin) no puede crear en programacion', async () => {
    const ctx = testEnv.authenticatedContext('admin_1');
    const db = ctx.firestore();
    await expect(
      setDoc(doc(db, 'programacion', 'test_prog'), {
        colaboradorId: 'emp_1',
        fecha: '2023-10-15',
        turno: 'X'
      })
    ).rejects.toThrow();
  });

  // 10. Cliente no puede leer ni escribir OperationTokens
  it('10. Cliente no puede acceder a OperationTokens', async () => {
    const ctx = testEnv.authenticatedContext('admin_1');
    const db = ctx.firestore();
    await expect(
      getDoc(doc(db, 'OperationTokens', 'some_token'))
    ).rejects.toThrow();
    
    await expect(
      setDoc(doc(db, 'OperationTokens', 'some_token'), { status: 'success' })
    ).rejects.toThrow();
  });
});
