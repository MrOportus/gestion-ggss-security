import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

describe('Phase 5B.5 Firestore Rules Tests (20 Escenarios)', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-ggss', // Using the same projectId to share emulator instance if running together, but usually rules run separate
      firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync('firestore.rules', 'utf8') }
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    // Setup initial data with Admin SDK for Supervisor/RRHH tests
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'Colaboradores', 'auth_colab_1'), {
        userId: 'auth_colab_1'
      });
      await setDoc(doc(db, 'Colaboradores', 'auth_colab_2'), {
        userId: 'auth_colab_2'
      });
      await setDoc(doc(db, 'Colaboradores', 'auth_super_1'), {
        role: 'supervisor'
      });
      await setDoc(doc(db, 'AlcancesOperativos', 'auth_super_1'), {
        sucursales: ['site_1']
      });
      await setDoc(doc(db, 'Users', 'auth_rrhh_1'), {
        role: 'rrhh'
      });
    });
  });

  // Helpers to get authenticated contexts
  const getColabDb = () => testEnv.authenticatedContext('auth_colab_1', { role: 'user' }).firestore();
  const getColab2Db = () => testEnv.authenticatedContext('auth_colab_2', { role: 'user' }).firestore();
  const getSuperDb = () => testEnv.authenticatedContext('auth_super_1', { role: 'supervisor' }).firestore();
  const getRrhhDb = () => testEnv.authenticatedContext('auth_rrhh_1', { role: 'rrhh' }).firestore();
  const getUnauthDb = () => testEnv.unauthenticatedContext().firestore();

  it('1. Colaborador crea su check_in legacy sin turnoProgramadoId', async () => {
    const db = getColabDb();
    await expect(setDoc(doc(db, 'Asistencia', 'att_1'), {
      employeeId: 'auth_colab_1', type: 'check_in', siteId: 'site_1'
    })).resolves.toBeUndefined();
  });

  it('2. Cliente crea check_in con turnoProgramadoId falsificado: rechazado', async () => {
    const db = getColabDb();
    await expect(setDoc(doc(db, 'Asistencia', 'att_2'), {
      employeeId: 'auth_colab_1', type: 'check_in', siteId: 'site_1', turnoProgramadoId: 'falso_123'
    })).rejects.toThrow();
  });

  it('3. Cliente agrega turnoProgramadoId por update: rechazado', async () => {
    const db = getColabDb();
    await setDoc(doc(db, 'Asistencia', 'att_3'), { employeeId: 'auth_colab_1', type: 'check_in', siteId: 'site_1' });
    await expect(updateDoc(doc(db, 'Asistencia', 'att_3'), { turnoProgramadoId: 'falso_123' })).rejects.toThrow();
  });

  it('4. Cliente cambia ID agregado por backend: rechazado', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'Asistencia', 'att_4'), { employeeId: 'auth_colab_1', type: 'check_in', siteId: 'site_1', turnoProgramadoId: 'valid_id' });
    });
    const db = getColabDb();
    await expect(updateDoc(doc(db, 'Asistencia', 'att_4'), { turnoProgramadoId: 'hacked_id' })).rejects.toThrow();
  });

  it('5. Cliente elimina ID agregado por backend: rechazado', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'Asistencia', 'att_5'), { employeeId: 'auth_colab_1', type: 'check_in', siteId: 'site_1', turnoProgramadoId: 'valid_id' });
    });
    const db = getColabDb();
    await expect(updateDoc(doc(db, 'Asistencia', 'att_5'), { turnoProgramadoId: null })).rejects.toThrow();
  });

  it('6. Cliente crea AttendanceShadowDiagnostics: rechazado', async () => {
    const db = getColabDb();
    await expect(setDoc(doc(db, 'AttendanceShadowDiagnostics', 'diag_1'), { foo: 'bar' })).rejects.toThrow();
  });

  it('7. Cliente actualiza diagnóstico: rechazado', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'AttendanceShadowDiagnostics', 'diag_7'), { foo: 'bar' });
    });
    const db = getColabDb();
    await expect(updateDoc(doc(db, 'AttendanceShadowDiagnostics', 'diag_7'), { foo: 'baz' })).rejects.toThrow();
  });

  it('8. Cliente elimina diagnóstico: rechazado', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'AttendanceShadowDiagnostics', 'diag_8'), { foo: 'bar' });
    });
    const db = getColabDb();
    await expect(deleteDoc(doc(db, 'AttendanceShadowDiagnostics', 'diag_8'))).rejects.toThrow();
  });

  it('9. Cliente intenta leer diagnóstico: rechazado', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'AttendanceShadowDiagnostics', 'diag_9'), { foo: 'bar' });
    });
    const db = getColabDb();
    await expect(getDoc(doc(db, 'AttendanceShadowDiagnostics', 'diag_9'))).rejects.toThrow();
  });

  it('10. Usuario sin Colaboradores recibe PERMISSION_DENIED seguro', async () => {
    const db = testEnv.authenticatedContext('auth_no_colab', { role: 'user' }).firestore();
    await expect(setDoc(doc(db, 'Asistencia', 'att_10'), { employeeId: 'auth_colab_1', type: 'check_in' })).rejects.toThrow();
  });

  it('11. Colaborador no crea asistencia para otro colaborador', async () => {
    const db = getColabDb();
    await expect(setDoc(doc(db, 'Asistencia', 'att_11'), { employeeId: 'auth_colab_2', type: 'check_in' })).rejects.toThrow();
  });

  it('12. Colaborador no modifica asistencia de otro', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'Asistencia', 'att_12'), { employeeId: 'auth_colab_2', type: 'check_in' });
    });
    const db = getColabDb();
    await expect(updateDoc(doc(db, 'Asistencia', 'att_12'), { status: 'completed' })).rejects.toThrow();
  });

  it('13. Check_out legacy propio continúa permitido', async () => {
    const db = getColabDb();
    await expect(setDoc(doc(db, 'Asistencia', 'att_13'), { employeeId: 'auth_colab_1', type: 'check_out', siteId: 'site_1' })).resolves.toBeUndefined();
  });

  it('14. Cliente no puede alterar employeeId de una asistencia existente', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'Asistencia', 'att_14'), { employeeId: 'auth_colab_1', type: 'check_in' });
    });
    const db = getColabDb();
    await expect(updateDoc(doc(db, 'Asistencia', 'att_14'), { employeeId: 'auth_colab_2' })).rejects.toThrow();
  });

  it('15. Cliente no puede alterar siteId/sucursalId después del inicio', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'Asistencia', 'att_15'), { employeeId: 'auth_colab_1', type: 'check_in', siteId: 'site_1' });
    });
    const db = getColabDb();
    await expect(updateDoc(doc(db, 'Asistencia', 'att_15'), { siteId: 'site_2' })).rejects.toThrow();
  });

  it('16. Cliente no puede alterar shiftId después del inicio', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'Asistencia', 'att_16'), { employeeId: 'auth_colab_1', type: 'check_in', shiftId: 'shift_1' });
    });
    const db = getColabDb();
    await expect(updateDoc(doc(db, 'Asistencia', 'att_16'), { shiftId: 'shift_2' })).rejects.toThrow();
  });

  it('17. Admin SDK puede agregar turnoProgramadoId', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'Asistencia', 'att_17'), { employeeId: 'auth_colab_1', type: 'check_in' });
      await expect(updateDoc(doc(db, 'Asistencia', 'att_17'), { turnoProgramadoId: 't1' })).resolves.toBeUndefined();
    });
  });

  it('18. Admin SDK puede crear diagnóstico', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await expect(setDoc(doc(db, 'AttendanceShadowDiagnostics', 'diag_18'), { resultado: 'ok' })).resolves.toBeUndefined();
    });
  });

  it('19. Supervisor no obtiene acceso fuera de AlcancesOperativos', async () => {
    const db = getSuperDb();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'Asistencia', 'att_19'), { employeeId: 'auth_colab_2', siteId: 'site_outside' });
    });
    await expect(getDoc(doc(db, 'Asistencia', 'att_19'))).rejects.toThrow(); // because they can't read from site_outside
  });

  it('20. RRHH conserva únicamente los permisos actualmente aprobados', async () => {
    const db = getRrhhDb();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'Asistencia', 'att_20'), { employeeId: 'auth_colab_2', siteId: 'site_outside' });
    });
    // RRHH typically can read everything
    await expect(getDoc(doc(db, 'Asistencia', 'att_20'))).resolves.toBeDefined();
  });
});
