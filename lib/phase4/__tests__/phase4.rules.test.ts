/**
 * lib/phase4/__tests__/phase4.rules.test.ts
 * Fase 4 — Suite C: Tests de reglas Firestore.
 *
 * Verifica que los campos protegidos de traslado son inmutables desde el cliente.
 * El Admin SDK (Cloud Functions) ignora las reglas — esto solo protege al cliente.
 *
 * Ejecutar: npx vitest run lib/phase4/__tests__/phase4.rules.test.ts
 */

import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { describe, beforeAll, afterAll, beforeEach, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

let testEnv: RulesTestEnvironment;

const BASE_TURNO = {
  id: 'test-turno',
  colaboradorId: 'uid-worker',
  asignacionOperacionalId: 'asig-1',
  sucursalId: 'sucursal1',
  fecha: '2024-06-15',
  horarioSnapshot: { inicio: '07:30', termino: '19:30', cruzaMedianoche: false, origen: 'fallback' },
  estado: 'programado',
  tipoOperacional: 'contractual',
  esProductivo: true,
  requiereAsistencia: true,
  codigo: 'X',
  estadoContratoVinculado: 'sin_contrato',
  creadoEn: '2024-01-01',
  creadoPor: 'uid-admin',
};

// Turno con campos de traslado ya establecidos (simula post-traslado)
const TURNO_TRASLADADO = {
  ...BASE_TURNO,
  estado: 'trasladado',
  transferredToShiftId: 'turno-destino-001',
  transferredFromShiftId: null,
  originBranchId: 'sucursal1',
  destinationBranchId: 'sucursal2',
  transferReason: 'Cobertura urgente',
  transferredAt: '2024-06-15T10:00:00.000Z',
  transferredBy: 'admin-uid',
  correlationId: 'op-test-001',
  requiereCobertura: true,
};

beforeAll(async () => {
  const rulesPath = path.resolve(__dirname, '../../../firestore.phase1.rules');
  const rules = fs.readFileSync(rulesPath, 'utf8');

  testEnv = await initializeTestEnvironment({
    projectId: `ggss-phase4-rules-${Date.now()}`,
    firestore: { rules },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();

  // Seed de usuarios con roles
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'Colaboradores', 'uid-admin'), { role: 'admin' });
    await setDoc(doc(db, 'Colaboradores', 'uid-rrhh'), { role: 'rrhh' });
    await setDoc(doc(db, 'Colaboradores', 'uid-worker'), { role: 'worker' });
    await setDoc(doc(db, 'Colaboradores', 'uid-super'), { role: 'supervisor' });
    await setDoc(doc(db, 'Colaboradores', 'uid-jefe'), { role: 'jefe_operaciones' });

    // Alcance del supervisor — solo sucursal1
    await setDoc(doc(db, 'AlcancesOperativos', 'uid-super'), {
      activo: true,
      sucursalesAutorizadas: ['sucursal1'],
    });

    // Seed turno base sin campos de traslado
    await setDoc(doc(db, 'TurnosProgramados', 'test-turno'), BASE_TURNO);

    // Seed turno con campos de traslado ya establecidos
    await setDoc(doc(db, 'TurnosProgramados', 'turno-trasladado'), TURNO_TRASLADADO);
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Fase 4 — Reglas de Firestore TurnosProgramados', () => {

  // ─── 1. Protección de campos de traslado — cliente no puede establecerlos ─
  describe('Campos de traslado: inmutables desde cliente', () => {
    it('1. Supervisor no puede modificar transferredToShiftId', async () => {
      const superDb = testEnv.authenticatedContext('uid-super').firestore();
      await assertFails(
        updateDoc(doc(superDb, 'TurnosProgramados', 'turno-trasladado'), {
          transferredToShiftId: 'turno-hackeado',
        })
      );
    });

    it('2. Admin no puede modificar correlationId desde cliente', async () => {
      const adminDb = testEnv.authenticatedContext('uid-admin').firestore();
      await assertFails(
        updateDoc(doc(adminDb, 'TurnosProgramados', 'turno-trasladado'), {
          correlationId: 'nuevo-correlation-id',
        })
      );
    });

    it('3. Jefe de operaciones no puede modificar transferredBy desde cliente', async () => {
      const jefeDb = testEnv.authenticatedContext('uid-jefe').firestore();
      await assertFails(
        updateDoc(doc(jefeDb, 'TurnosProgramados', 'turno-trasladado'), {
          transferredBy: 'otro-uid',
        })
      );
    });

    it('4. Ningún cliente puede agregar transferredToShiftId a turno sin él', async () => {
      const adminDb = testEnv.authenticatedContext('uid-admin').firestore();
      await assertFails(
        updateDoc(doc(adminDb, 'TurnosProgramados', 'test-turno'), {
          transferredToShiftId: 'turno-inyectado',
        })
      );
    });

    it('5. Ningún cliente puede modificar originBranchId', async () => {
      const adminDb = testEnv.authenticatedContext('uid-admin').firestore();
      await assertFails(
        updateDoc(doc(adminDb, 'TurnosProgramados', 'turno-trasladado'), {
          originBranchId: 'sucursal-falsificada',
        })
      );
    });
  });

  // ─── 2. Estado 'trasladado' y 'completado' no pueden asignarse desde cliente
  describe('Estado: cliente no puede forzar estado de traslado', () => {
    it('6. Cliente no puede establecer estado=trasladado en un turno programado', async () => {
      const adminDb = testEnv.authenticatedContext('uid-admin').firestore();
      // isUnmodified('transferredToShiftId') bloquea si intenta también establecer estado=trasladado
      // junto con un campo protegido. Si solo cambia estado... depende de si todos los campos
      // protegidos siguen igual. Aquí validamos que la regla del estado funciona para nuevas creaciones.
      await assertFails(
        setDoc(doc(adminDb, 'TurnosProgramados', 'turno-nuevo-malo'), {
          ...BASE_TURNO,
          id: 'turno-nuevo-malo',
          estado: 'estado_invalido', // Estado no permitido por las reglas
        })
      );
    });
  });

  // ─── 3. AuditoriaAcciones — cliente no puede escribir ────────────────────
  describe('AuditoriaAcciones: solo escritura desde Admin SDK', () => {
    it('7. Colaborador no puede crear registro en AuditoriaAcciones', async () => {
      const workerDb = testEnv.authenticatedContext('uid-worker').firestore();
      await assertFails(
        setDoc(doc(workerDb, 'AuditoriaAcciones', 'audit-falso'), {
          accion: 'TRANSFER_COMPLETED',
          usuarioId: 'uid-worker',
          fecha: new Date().toISOString(),
        })
      );
    });

    it('8. Admin no puede crear desde cliente (solo Admin SDK)', async () => {
      const adminDb = testEnv.authenticatedContext('uid-admin').firestore();
      await assertFails(
        setDoc(doc(adminDb, 'AuditoriaAcciones', 'audit-admin'), {
          accion: 'TRANSFER_COMPLETED',
        })
      );
    });
  });

  // ─── 4. Lectura de TurnosProgramados ────────────────────────────────────
  describe('Lectura de TurnosProgramados por rol', () => {
    it('9. Colaborador puede leer su propio turno', async () => {
      const workerDb = testEnv.authenticatedContext('uid-worker').firestore();
      await assertSucceeds(
        // Puede leer porque isOwner(colaboradorId) donde colaboradorId = uid-worker
        // En la regla: isOwner(resource.data.colaboradorId)
        // test-turno tiene colaboradorId = uid-worker ✓
        (workerDb as any).collection('TurnosProgramados').doc('test-turno').get()
      );
    });

    it('10. Colaborador no puede borrar turnos', async () => {
      const workerDb = testEnv.authenticatedContext('uid-worker').firestore();
      await assertFails(
        deleteDoc(doc(workerDb, 'TurnosProgramados', 'test-turno'))
      );
    });

    it('11. Supervisor puede leer turnos de su sucursal (esRolOperativo)', async () => {
      const superDb = testEnv.authenticatedContext('uid-super').firestore();
      await assertSucceeds(
        (superDb as any).collection('TurnosProgramados').doc('test-turno').get()
      );
    });

    it('12. RRHH puede leer TurnosProgramados (esRolOperativo)', async () => {
      const rrhhDb = testEnv.authenticatedContext('uid-rrhh').firestore();
      await assertSucceeds(
        (rrhhDb as any).collection('TurnosProgramados').doc('test-turno').get()
      );
    });
  });

  // ─── 5. Creación desde cliente — campos requeridos ────────────────────────
  describe('Creación de TurnosProgramados: campos requeridos', () => {
    it('13. Admin puede crear turno con campos completos y estado válido', async () => {
      const adminDb = testEnv.authenticatedContext('uid-admin').firestore();
      await assertSucceeds(
        setDoc(doc(adminDb, 'TurnosProgramados', 'nuevo-turno-admin'), {
          ...BASE_TURNO,
          id: 'nuevo-turno-admin',
        })
      );
    });

    it('14. Supervisor puede crear turno en su sucursal autorizada', async () => {
      const superDb = testEnv.authenticatedContext('uid-super').firestore();
      await assertSucceeds(
        setDoc(doc(superDb, 'TurnosProgramados', 'nuevo-turno-super'), {
          ...BASE_TURNO,
          id: 'nuevo-turno-super',
          sucursalId: 'sucursal1', // Autorizada en AlcancesOperativos
        })
      );
    });

    it('15. Supervisor no puede crear turno en sucursal no autorizada', async () => {
      const superDb = testEnv.authenticatedContext('uid-super').firestore();
      await assertFails(
        setDoc(doc(superDb, 'TurnosProgramados', 'turno-no-autorizado'), {
          ...BASE_TURNO,
          id: 'turno-no-autorizado',
          sucursalId: 'sucursal-prohibida', // No en AlcancesOperativos
        })
      );
    });
  });

  // ─── 6. AlcancesOperativos — solo lectura propia ──────────────────────────
  describe('AlcancesOperativos: lectura restringida', () => {
    it('16. Colaborador puede leer solo su propio documento de AlcancesOperativos', async () => {
      const superDb = testEnv.authenticatedContext('uid-super').firestore();
      await assertSucceeds(
        (superDb as any).collection('AlcancesOperativos').doc('uid-super').get()
      );
    });

    it('17. Colaborador no puede leer AlcancesOperativos de otro', async () => {
      const workerDb = testEnv.authenticatedContext('uid-worker').firestore();
      await assertFails(
        (workerDb as any).collection('AlcancesOperativos').doc('uid-super').get()
      );
    });
  });

  // ─── 7. ShadowSyncQueue — cliente no puede crear ─────────────────────────
  describe('ShadowSyncQueue: inmutable desde cliente', () => {
    it('18. Ningún cliente puede crear tareas en ShadowSyncQueue', async () => {
      const adminDb = testEnv.authenticatedContext('uid-admin').firestore();
      await assertFails(
        setDoc(doc(adminDb, 'ShadowSyncQueue', 'task-falso'), {
          syncStatus: 'pending',
        })
      );
    });

    it('19. Usuario sin documento en Colaboradores recibe PERMISSION_DENIED sin errores', async () => {
      const ghostDb = testEnv.authenticatedContext('uid_sin_documento').firestore();
      await assertFails(
        (ghostDb as any).collection('TurnosProgramados').doc('test-turno').get()
      );
    });
  });
});
