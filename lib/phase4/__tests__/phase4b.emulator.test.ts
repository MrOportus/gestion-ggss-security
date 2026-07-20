import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'fs';
import * as path from 'path';
import { doc, getDoc } from 'firebase/firestore';

/**
 * NOTA SOBRE LA CANTIDAD DE TESTS:
 * Esta suite contiene exactamente 11 tests ejecutados.
 * Los nombres de los tests pueden utilizar numeración hasta el 14 (ej. "Test 14...").
 * Los números omitidos corresponden a escenarios que fueron fusionados, eliminados 
 * o cubiertos de forma combinada mediante múltiples aserciones dentro de un mismo test.
 * La cantidad real de escenarios validados es de 11.
 */

async function adminSetDoc(coll: string, id: string, data: any) {
  const admin = require('../../../functions/node_modules/firebase-admin');
  await admin.firestore().collection(coll).doc(id).set(data);
}

let testEnv: RulesTestEnvironment;

async function seedTurnoProgramado(turnoId: string, overrides: any = {}) {
  await adminSetDoc('TurnosProgramados', turnoId, {
    id: turnoId,
    asignacionOperacionalId: `assignment_${overrides.colaboradorId || 'emp'}_1_2024-06`,
    sucursalId: '1',
    codigo: 'X',
    esProductivo: true,
    requiereAsistencia: true,
    creadoPor: 'admin_test_user',
    creadoEn: '2024-06-20T00:00:00Z',
    ...overrides
  });
}

// @ts-ignore
import { createAdditionalShiftHandler } from '../../../functions/src/phase4/createAdditionalShift';
// @ts-ignore
import { assignVacancyReplacementHandler } from '../../../functions/src/phase4/assignVacancyReplacement';
// @ts-ignore
import { revertShiftTransferHandler } from '../../../functions/src/phase4/revertShiftTransfer';

describe('Fase 4B - Emulator Tests', () => {
  let adminDb: any;

  beforeAll(async () => {
    const admin = require('../../../functions/node_modules/firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: 'demo-ggss' });
    }
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-ggss',
      firestore: {
        host: '127.0.0.1',
        port: 8080,
        rules: fs.readFileSync(path.resolve(__dirname, '../../../firestore.phase1.rules'), 'utf8'),
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    
    await adminSetDoc('Colaboradores', 'admin_user', { role: 'admin', isActive: true, email: 'admin@test.com', firstName: 'A', lastNamePaterno: 'B', rut: '1-9' });
    await adminSetDoc('Colaboradores', 'sup_user', { role: 'supervisor', isActive: true, email: 'sup@test.com', firstName: 'S', lastNamePaterno: 'B', rut: '2-7' });
    await adminSetDoc('Colaboradores', 'emp1', { role: 'guardia', isActive: true });
    await adminSetDoc('AlcancesOperativos', 'sup_user', { activo: true, sucursalesAutorizadas: [1] });

    const adminCtx = testEnv.authenticatedContext('admin_user', { role: 'admin' });
    adminDb = adminCtx.firestore();
  });

  const adminContext = { auth: { uid: 'admin_user', token: { role: 'admin' } } };
  const rrhhContext = { auth: { uid: 'rrhh_user', token: { role: 'rrhh' } } };
  const supervisorContext = { auth: { uid: 'sup_user', token: { role: 'supervisor' } } };

  describe('createAdditionalShift', () => {
    it('1. Crea turno adicional correctamente', async () => {
      const res = await createAdditionalShiftHandler({
        data: {
          colaboradorId: 'emp1',
          sucursalId: 1,
          fecha: '2024-06-20',
          horario: { inicio: '07:30', termino: '15:30', cruzaMedianoche: false, origen: 'manual' },
          tipoOperacion: 'extra',
          motivo: 'Falta de personal por licencias médicas',
          operationRequestId: 'op_test_1'
        },
        auth: adminContext.auth
      });

      expect(res.success).toBe(true);
      expect(res.turnoId).toBeDefined();

      const docSnap = await getDoc(doc(adminDb, 'TurnosProgramados', res.turnoId));
      expect(docSnap.exists()).toBe(true);
      expect(docSnap.data()!.colaboradorId).toBe('emp1');
      expect(docSnap.data()!.estado).toBe('programado');
      expect(docSnap.data()!.tipoOperacional).toBe('extra');
    });

    it('2. Rechaza solicitud si genera superposición', async () => {
      await adminSetDoc('Colaboradores', 'emp2', { role: 'guardia', isActive: true });
      await adminSetDoc('TurnosProgramados', 't_emp2', {
        colaboradorId: 'emp2', fecha: '2024-06-21', sucursalId: 1, horarioSnapshot: { inicio: '07:30', termino: '19:30', cruzaMedianoche: false, origen: 'plantilla' }, estado: 'programado'
      });
      const res = await createAdditionalShiftHandler({
        data: {
          colaboradorId: 'emp2',
          sucursalId: 1,
          fecha: '2024-06-21',
          horario: { inicio: '07:30', termino: '19:30', cruzaMedianoche: false, origen: 'manual' },
          tipoOperacion: 'extra',
          motivo: 'Doble turno',
          operationRequestId: 'op_test_2'
        },
        auth: adminContext.auth
      });

      expect(res.status).toBe('conflict_blocked');
      expect(res.overlap).toBeDefined();
    });

    it('3. Rechaza o advierte descanso insuficiente', async () => {
      await adminSetDoc('Colaboradores', 'emp3', { role: 'guardia', isActive: true });
      await adminSetDoc('TurnosProgramados', 't_emp3', {
        colaboradorId: 'emp3', fecha: '2024-06-22', horarioSnapshot: { inicio: '00:00', termino: '04:00', cruzaMedianoche: false, origen: 'plantilla' }, estado: 'programado'
      });
      const res = await createAdditionalShiftHandler({
        data: {
          colaboradorId: 'emp3',
          sucursalId: 1,
          fecha: '2024-06-22',
          horario: { inicio: '07:30', termino: '15:30', cruzaMedianoche: false, origen: 'manual' },
          tipoOperacion: 'extra',
          motivo: 'Sin descanso',
          operationRequestId: 'op_test_3'
        },
        auth: adminContext.auth
      });

      expect(res.status).toBe('insufficient_rest_blocked');
      expect(res.restWarning).toBeDefined();
    });

    it('4. Es idempotente ante reintentos', async () => {
      const payload = {
        data: {
          colaboradorId: 'emp4',
          sucursalId: 1,
          fecha: '2024-06-23',
          horario: { inicio: '07:30', termino: '15:30', cruzaMedianoche: false, origen: 'manual' },
          tipoOperacion: 'extra',
          motivo: 'Test',
          operationRequestId: 'op_idempotency_123'
        },
        auth: adminContext.auth
      };

      const res1 = await createAdditionalShiftHandler(payload);
      expect(res1.success).toBe(true);

      const res2 = await createAdditionalShiftHandler(payload);
      expect(res2.status).toBe('already_exists'); 
      expect(res2.turnoId).toBe(res1.turnoId);
    });

    it('5. Supervisor requiere alcance', async () => {
      await expect(createAdditionalShiftHandler({
        data: {
          colaboradorId: 'emp1',
          sucursalId: 10,
          fecha: '2024-06-24',
          horario: { inicio: '07:30', termino: '15:30', cruzaMedianoche: false, origen: 'manual' },
          tipoOperacion: 'extra',
          motivo: 'Test',
          operationRequestId: 'op_test_4'
        },
        auth: supervisorContext.auth
      })).rejects.toThrow('Sin alcance en sucursal destino: 10.');
    });

    it('6. RRHH es rechazado', async () => {
      await expect(createAdditionalShiftHandler({
        data: {
          colaboradorId: 'emp1',
          sucursalId: 1,
          fecha: '2024-06-24',
          horario: { inicio: '07:30', termino: '15:30', cruzaMedianoche: false, origen: 'manual' },
          tipoOperacion: 'extra',
          motivo: 'Test',
          operationRequestId: 'op_test_5'
        },
        auth: rrhhContext.auth
      })).rejects.toThrow('Usuario no encontrado.');
    });
  });

  describe('assignVacancyReplacement', () => {
    beforeEach(async () => {
      await adminSetDoc('TurnosProgramados', 'vacancy1', {
        id: 'vacancy1',
        colaboradorId: 'emp1',
        fecha: '2024-06-25',
        estado: 'trasladado',
        requiereCobertura: true,
        sucursalId: 1,
        horarioSnapshot: { inicio: '07:30', termino: '19:30', cruzaMedianoche: false }
      });
    });

    it('7. Crea turno de reemplazo y vincula', async () => {
      const res = await assignVacancyReplacementHandler({
        data: {
          turnoOrigenTrasladadoId: 'vacancy1',
          colaboradorReemplazanteId: 'emp_replacer1',
          tipoOperacion: 'cobertura',
          motivo: 'Reemplazo programado',
          operationRequestId: 'op_repl_1'
        },
        auth: adminContext.auth
      });

      expect(res.success).toBe(true);
      expect(res.replacementShiftId).toBeDefined();

      const replDoc = await getDoc(doc(adminDb, 'TurnosProgramados', res.replacementShiftId));
      expect(replDoc.exists()).toBe(true);
      expect(replDoc.data()!.tipoOperacional).toBe('cobertura');
      expect(replDoc.data()!.replacesShiftId).toBe('vacancy1');

      const vacDoc = await getDoc(doc(adminDb, 'TurnosProgramados', 'vacancy1'));
      expect(vacDoc.data()!.replacementShiftId).toBe(res.replacementShiftId);
      expect(vacDoc.data()!.requiereCobertura).toBe(false);
    });

    it('11. Rechaza vacante inexistente o ya cubierta', async () => {
      await adminSetDoc('TurnosProgramados', 'vacancy2', {
        id: 'vacancy2',
        colaboradorId: 'emp1',
        fecha: '2024-06-25',
        estado: 'trasladado',
        requiereCobertura: false,
        replacementShiftId: 'other_repl',
        sucursalId: 1
      });

      await expect(assignVacancyReplacementHandler({
        data: {
          turnoOrigenTrasladadoId: 'vacancy2',
          colaboradorReemplazanteId: 'emp_replacer1',
          tipoOperacion: 'cobertura',
          motivo: 'Test', correlationId: 'audit_test',
          operationRequestId: 'op_repl_11'
        },
        auth: adminContext.auth
      })).rejects.toThrow('El turno no requiere cobertura o ya fue cubierto.');
    });

    it('12. Rechaza reemplazante con conflicto', async () => {
      await seedTurnoProgramado('conflict_replacer', {
        colaboradorId: 'replacer3',
        fecha: '2024-06-25',
        estado: 'programado',
        horarioSnapshot: { inicio: '07:30', termino: '19:30', cruzaMedianoche: false }
      });
      const res = await assignVacancyReplacementHandler({
        data: {
          turnoOrigenTrasladadoId: 'vacancy1',
          colaboradorReemplazanteId: 'replacer3',
          tipoOperacion: 'cobertura',
          motivo: 'Test', correlationId: 'audit_test',
          operationRequestId: 'op_repl_12'
        },
        auth: adminContext.auth
      });

      expect(res.status).toBe('conflict_blocked');
      expect(res.overlap).toBeDefined();
    });
  });

  describe('revertShiftTransfer with coverage', () => {
    it('13. Reversión cancela reemplazo sin asistencia', async () => {
      await seedTurnoProgramado('origen_r', {
        estado: 'trasladado',
        transferredToShiftId: 'destino_r',
        replacementShiftId: 'cobertura_r',
        colaboradorId: 'empO',
        fecha: '2024-06-30'
      });
      await seedTurnoProgramado('destino_r', {
        estado: 'programado',
        transferredFromShiftId: 'origen_r',
        colaboradorId: 'empO',
        fecha: '2024-06-30'
      });
      await seedTurnoProgramado('cobertura_r', {
        estado: 'programado',
        replacesShiftId: 'origen_r',
        colaboradorId: 'empRepl',
        fecha: '2024-06-30'
      });
      const res = await revertShiftTransferHandler({
        data: {
          turnoOrigenId: 'origen_r',
          motivo: 'Cancelar traslado'
        },
        auth: adminContext.auth
      });

      expect(res.success).toBe(true);

      const covSnap = await getDoc(doc(adminDb, 'TurnosProgramados', 'cobertura_r'));
      expect(covSnap.data()!.estado).toBe('cancelado');
      expect(covSnap.data()!.motivoCancelacion).toBe('vacante_revertida');

      const oriSnap = await getDoc(doc(adminDb, 'TurnosProgramados', 'origen_r'));
      expect(oriSnap.data()!.estado).toBe('programado');
      expect(oriSnap.data()!.replacementShiftId).toBeNull();
    });

    it('14. Reversión bloqueada si reemplazo tiene asistencia manual', async () => {
      await adminSetDoc('TurnosProgramados', 'origen_r2', {
          id: 'origen_r2', estado: 'trasladado', transferredToShiftId: 'destino_r2', replacementShiftId: 'cobertura_r2', sucursalId: 'siteA', colaboradorId: 'empO2', fecha: '2024-07-01'
      });
      await adminSetDoc('TurnosProgramados', 'destino_r2', {
          id: 'destino_r2', estado: 'programado', transferredFromShiftId: 'origen_r2', sucursalId: 'siteB', colaboradorId: 'empO2', fecha: '2024-07-01'
      });
      await adminSetDoc('TurnosProgramados', 'cobertura_r2', {
          id: 'cobertura_r2', estado: 'programado', replacesShiftId: 'origen_r2', sucursalId: 'siteA', colaboradorId: 'empRepl2', fecha: '2024-07-01'
      });
      await adminSetDoc('asistencia_manual', 'manual_empRepl2_2024-07-01', {
          status: 'presente'
      });
      const res = await revertShiftTransferHandler({
        data: {
          turnoOrigenId: 'origen_r2',
          motivo: 'Cancelar traslado',
          correlationId: 'audit_test_14'
        },
        auth: adminContext.auth
      });

      expect(res.success).toBe(false);
      expect(res.blocked).toBe(true);
      expect(res.blockReason).toBe('existing_replacement_attendance');
    });
  });
});
