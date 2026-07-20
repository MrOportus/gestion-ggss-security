import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';

describe('Global Shadow Resolver Emulator Tests', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-ggss',
      firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync('firestore.rules', 'utf8') }
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  const now = new Date();
  const santiagoToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false });
  const shiftInicio = formatter.format(now);

  const waitForDiagnostic = async (db: any, attendanceId: string, maxWaitMs = 5000): Promise<any> => {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const diagDoc = await getDoc(doc(db, 'AttendanceShadowDiagnostics', attendanceId));
      if (diagDoc.exists()) {
        return diagDoc.data();
      }
      await new Promise(r => setTimeout(r, 500));
    }
    return null;
  };

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  const setConfig = async (db: any, config: any) => {
    await setDoc(doc(db, 'app_config', 'feature_flags'), config);
  };

  const setupTurno = async (db: any, tId: string, siteId: string) => {
    await setDoc(doc(db, 'TurnosProgramados', tId), {
      colaboradorId: 'user_1', fecha: santiagoToday, sucursalId: siteId, codigo: 'X', estado: 'programado',
      horarioSnapshot: { inicio: shiftInicio, termino: '16:00' }
    });
  };

  const createAttendance = async (db: any, aId: string, siteId: any) => {
    await setDoc(doc(db, 'Asistencia', aId), {
      employeeId: 'user_1', type: 'check_in', siteId: siteId, localDate: santiagoToday,
      turnoProgramadoStatus: 'programado', timestamp: new Date().toISOString()
    });
  };

  it('1. Global activo procesa sucursal A', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setConfig(db, { attendanceShadowEnabled: true, attendanceShadowAllBranches: true, sucursalesHabilitadas: [] });
      await setupTurno(db, 't1', 'sucA');
      await createAttendance(db, 'a1', 'sucA');
      const diag = await waitForDiagnostic(db, 'a1');
      expect(diag).not.toBeNull();
      const asis = await getDoc(doc(db, 'Asistencia', 'a1'));
      expect(asis.data()?.turnoProgramadoId).toBe('t1');
    });
  }, 10000);

  it('2. Global activo procesa sucursal B', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setConfig(db, { attendanceShadowEnabled: true, attendanceShadowAllBranches: true, sucursalesHabilitadas: [] });
      await setupTurno(db, 't2', 'sucB');
      await createAttendance(db, 'a2', 'sucB');
      const diag = await waitForDiagnostic(db, 'a2');
      expect(diag).not.toBeNull();
      const asis = await getDoc(doc(db, 'Asistencia', 'a2'));
      expect(asis.data()?.turnoProgramadoId).toBe('t2');
    });
  }, 10000);

  it('3. Global activo procesa una sucursal nueva no incluida en el array', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setConfig(db, { attendanceShadowEnabled: true, attendanceShadowAllBranches: true, sucursalesHabilitadas: ['sucA'] });
      await setupTurno(db, 't3', 'sucNUEVA');
      await createAttendance(db, 'a3', 'sucNUEVA');
      const diag = await waitForDiagnostic(db, 'a3');
      expect(diag).not.toBeNull();
      const asis = await getDoc(doc(db, 'Asistencia', 'a3'));
      expect(asis.data()?.turnoProgramadoId).toBe('t3');
    });
  }, 10000);

  it('4. Global apagado y array con A procesa solo A', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setConfig(db, { attendanceShadowEnabled: true, attendanceShadowAllBranches: false, sucursalesHabilitadas: ['sucA'] });
      await setupTurno(db, 't4a', 'sucA');
      await createAttendance(db, 'a4a', 'sucA');
      const diagA = await waitForDiagnostic(db, 'a4a');
      expect(diagA).not.toBeNull();

      await setupTurno(db, 't4b', 'sucB');
      await createAttendance(db, 'a4b', 'sucB');
      const diagB = await waitForDiagnostic(db, 'a4b', 3000);
      expect(diagB).toBeNull();
    });
  }, 15000);

  it('5. Global apagado y array vacio no procesa ninguna', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setConfig(db, { attendanceShadowEnabled: true, attendanceShadowAllBranches: false, sucursalesHabilitadas: [] });
      await setupTurno(db, 't5', 'sucA');
      await createAttendance(db, 'a5', 'sucA');
      const diag = await waitForDiagnostic(db, 'a5', 3000);
      expect(diag).toBeNull();
    });
  }, 10000);

  it('6. attendanceShadowEnabled false no procesa', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setConfig(db, { attendanceShadowEnabled: false, attendanceShadowAllBranches: true, sucursalesHabilitadas: ['sucA'] });
      await setupTurno(db, 't6', 'sucA');
      await createAttendance(db, 'a6', 'sucA');
      const diag = await waitForDiagnostic(db, 'a6', 3000);
      expect(diag).toBeNull();
    });
  }, 10000);

  it('7. Documento de config inexistente aplica fail-closed', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      // Ensure config does not exist
      await deleteDoc(doc(db, 'app_config', 'feature_flags'));
      await setupTurno(db, 't7', 'sucA');
      await createAttendance(db, 'a7', 'sucA');
      const diag = await waitForDiagnostic(db, 'a7', 3000);
      expect(diag).toBeNull();
    });
  }, 10000);

  it('8. ID de sucursal number se conserva como number', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setConfig(db, { attendanceShadowEnabled: true, attendanceShadowAllBranches: true, sucursalesHabilitadas: [] });
      await setupTurno(db, 't8', 999 as any);
      await createAttendance(db, 'a8', 999);
      const diag = await waitForDiagnostic(db, 'a8');
      expect(diag).not.toBeNull();
      const asis = await getDoc(doc(db, 'Asistencia', 'a8'));
      expect(asis.data()?.siteId).toBe(999);
      expect(typeof asis.data()?.siteId).toBe('number');
    });
  }, 10000);

  it('9. ID de sucursal string se conserva como string', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setConfig(db, { attendanceShadowEnabled: true, attendanceShadowAllBranches: true, sucursalesHabilitadas: [] });
      await setupTurno(db, 't9', '999');
      await createAttendance(db, 'a9', '999');
      const diag = await waitForDiagnostic(db, 'a9');
      expect(diag).not.toBeNull();
      const asis = await getDoc(doc(db, 'Asistencia', 'a9'));
      expect(asis.data()?.siteId).toBe('999');
      expect(typeof asis.data()?.siteId).toBe('string');
    });
  }, 10000);

  it('10. El modo global no permite vincular un turno de otra sucursal', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setConfig(db, { attendanceShadowEnabled: true, attendanceShadowAllBranches: true, sucursalesHabilitadas: [] });
      await setupTurno(db, 't10', 'sucA');
      // Create attendance in a different branch
      await createAttendance(db, 'a10', 'sucB');
      const diag = await waitForDiagnostic(db, 'a10');
      expect(diag).not.toBeNull();
      expect(diag.resultado).toBe('sucursal_incompatible'); // it should reject due to branch mismatch
      const asis = await getDoc(doc(db, 'Asistencia', 'a10'));
      expect(asis.data()?.turnoProgramadoId).toBeUndefined();
    });
  }, 10000);

});
