import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { describe, beforeAll, afterAll, beforeEach, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const rulesPath = path.resolve(__dirname, '../../../firestore.phase1.rules');
  const rules = fs.readFileSync(rulesPath, 'utf8');

  testEnv = await initializeTestEnvironment({
    projectId: `ggss-test-${Date.now()}`,
    firestore: { rules }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'Colaboradores', 'uid-admin'), { role: 'admin' });
    await setDoc(doc(db, 'Colaboradores', 'uid-rrhh'), { role: 'rrhh' });
    await setDoc(doc(db, 'Colaboradores', 'uid-worker'), { role: 'worker' });
    await setDoc(doc(db, 'Colaboradores', 'uid-super'), { role: 'supervisor' });
    
    await setDoc(doc(db, 'AlcancesOperativos', 'uid-super'), {
      activo: true,
      sucursalesAutorizadas: { 'sucursal1': true }
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Firestore Rules - Fase 1C', () => {

  describe('Autenticación y Lectura Básica', () => {
    it('1. Usuario no autenticado no puede leer contratos', async () => {
      const unauthedDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(unauthedDb, 'Contratos', 'c1')));
    });

    it('2 & 3. Colaborador puede consultar únicamente sus contratos autorizados', async () => {
      const adminDb = testEnv.authenticatedContext('uid-admin').firestore();
      await setDoc(doc(adminDb, 'Contratos', 'c-worker'), { colaboradorId: 'uid-worker', sucursalId: 's1', fechaInicio: '1', estado: 'vigente', creadoPor: 'a', creadoEn: '1' });
      await setDoc(doc(adminDb, 'Contratos', 'c-other'), { colaboradorId: 'uid-other', sucursalId: 's1', fechaInicio: '1', estado: 'vigente', creadoPor: 'a', creadoEn: '1' });
      
      const workerDb = testEnv.authenticatedContext('uid-worker').firestore();
      await assertSucceeds(getDoc(doc(workerDb, 'Contratos', 'c-worker')));
      await assertFails(getDoc(doc(workerDb, 'Contratos', 'c-other')));
    });
  });

  describe('Creación y Modificación de Contratos', () => {
    it('4. Supervisor no puede crear contratos', async () => {
      const superDb = testEnv.authenticatedContext('uid-super').firestore();
      await assertFails(setDoc(doc(superDb, 'Contratos', 'new-c'), {
        colaboradorId: 'emp1', sucursalId: 's1', fechaInicio: '2023-01-01', estado: 'vigente', creadoPor: 'uid-super', creadoEn: 'now'
      }));
    });

    it('5. RRHH puede crear contratos válidos', async () => {
      const rrhhDb = testEnv.authenticatedContext('uid-rrhh').firestore();
      await assertSucceeds(setDoc(doc(rrhhDb, 'Contratos', 'new-c'), {
        colaboradorId: 'emp1', sucursalId: 's1', fechaInicio: '2023-01-01', estado: 'vigente', creadoPor: 'uid-rrhh', creadoEn: 'now'
      }));
    });

    it('16. Documento con campos incompletos es rechazado', async () => {
      const adminDb = testEnv.authenticatedContext('uid-admin').firestore();
      await assertFails(setDoc(doc(adminDb, 'Contratos', 'bad-c'), {
        colaboradorId: 'emp1'
      }));
    });

    it('6. RRHH no puede cambiar colaboradorId mediante update (Inmutabilidad)', async () => {
      const rrhhDb = testEnv.authenticatedContext('uid-rrhh').firestore();
      await setDoc(doc(rrhhDb, 'Contratos', 'c1'), {
        colaboradorId: 'emp1', sucursalId: 's1', fechaInicio: '2023-01-01', estado: 'vigente', creadoPor: 'uid-rrhh', creadoEn: 'now'
      });

      await assertSucceeds(updateDoc(doc(rrhhDb, 'Contratos', 'c1'), { estado: 'vencido' }));
      await assertFails(updateDoc(doc(rrhhDb, 'Contratos', 'c1'), { colaboradorId: 'emp2' }));
    });
  });

  describe('Turnos y Alcance Operativo', () => {
    it('7. Supervisor autorizado puede crear turnos en su sucursal', async () => {
      const superDb = testEnv.authenticatedContext('uid-super').firestore();
      await assertSucceeds(setDoc(doc(superDb, 'TurnosProgramados', 't1'), {
        colaboradorId: 'emp1', asignacionOperacionalId: 'a1', sucursalId: 'sucursal1', fecha: '2023', horarioSnapshot: '8-20', estado: 'programado', creadoPor: 'uid-super', creadoEn: 'now'
      }));
    });

    it('8. Supervisor NO autorizado no puede crear turnos en otra sucursal', async () => {
      const superDb = testEnv.authenticatedContext('uid-super').firestore();
      await assertFails(setDoc(doc(superDb, 'TurnosProgramados', 't2'), {
        colaboradorId: 'emp1', asignacionOperacionalId: 'a1', sucursalId: 'sucursal2', fecha: '2023', horarioSnapshot: '8-20', estado: 'programado', creadoPor: 'uid-super', creadoEn: 'now'
      }));
    });
    
    it('14. horarioSnapshot no puede modificarse en update', async () => {
      const superDb = testEnv.authenticatedContext('uid-super').firestore();
      await setDoc(doc(superDb, 'TurnosProgramados', 't1'), {
        colaboradorId: 'emp1', asignacionOperacionalId: 'a1', sucursalId: 'sucursal1', fecha: '2023', horarioSnapshot: '8-20', estado: 'programado', creadoPor: 'uid-super', creadoEn: 'now'
      });
      await assertFails(updateDoc(doc(superDb, 'TurnosProgramados', 't1'), { horarioSnapshot: '10-22' }));
    });
  });

  describe('Prohibición de Eliminaciones Físicas y Auditoría', () => {
    it('12 & 13. Cliente (incluso Admin) no puede borrar contratos ni turnos', async () => {
      const adminDb = testEnv.authenticatedContext('uid-admin').firestore();
      await setDoc(doc(adminDb, 'Contratos', 'del-c'), { colaboradorId: 'u', sucursalId: 's', fechaInicio: '1', estado: 'vigente', creadoPor: 'a', creadoEn: '1' });
      await setDoc(doc(adminDb, 'TurnosProgramados', 'del-t'), { colaboradorId: 'u', asignacionOperacionalId: 'a', sucursalId: 'sucursal1', fecha: '1', horarioSnapshot: '1', estado: 'programado', creadoPor: 'a', creadoEn: '1' });

      await assertFails(deleteDoc(doc(adminDb, 'Contratos', 'del-c')));
      await assertFails(deleteDoc(doc(adminDb, 'TurnosProgramados', 'del-t')));
    });

    it('11. Cliente no puede crear AuditoriaAcciones directamente', async () => {
      const adminDb = testEnv.authenticatedContext('uid-admin').firestore();
      await assertFails(setDoc(doc(adminDb, 'AuditoriaAcciones', 'log1'), { data: 'fake' }));
    });
  });

});
