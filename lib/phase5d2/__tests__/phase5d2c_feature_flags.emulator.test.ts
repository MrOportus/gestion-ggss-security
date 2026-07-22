import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import crypto from 'crypto';

// @ts-ignore
import { executeAttendanceClosure } from '../../../functions/src/phase5/attendanceClosureCore';

const projectId = 'demo-ggss';
let app: admin.app.App;
let dbAdmin: admin.firestore.Firestore;

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId });
  dbAdmin = app.firestore();
});

afterAll(async () => {
  await app.delete();
});

beforeEach(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
});

describe('Fase 5D.2C - Feature Flags Exhaustivo', () => {
  
  const now = new Date();
  const dateStr = '2026-07-21';
  
  const baseCheckIn = {
    employeeId: 'emp_ff',
    siteId: 'site_1',
    type: 'check_in',
    timestamp: now.toISOString(),
    status: 'open',
    estado: 'ABIERTO',
    localDate: dateStr
  };

  async function runClosure(attendanceId: string, actorUid: string, isSystem = false) {
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify({ attendanceId })).digest('hex');
    await executeAttendanceClosure(dbAdmin, {
      attendanceId,
      actorUid,
      actorRole: 'admin',
      origen: 'admin',
      checkPermissions: false,
      cleanupDigitalAttendance: false,
      auditType: 'attendance_force_closed',
      requestId: `req_${attendanceId}`,
      isSystemActor: isSystem,
      payloadHash,
      FieldValue: admin.firestore.FieldValue
    });
    const v2Doc = await dbAdmin.collection('AsistenciasConsolidadas').doc(`manual_${attendanceId}`).get();
    return v2Doc.exists;
  }

  const cases = [
    { desc: 'Documento inexistente', ff: null, expected: false },
    { desc: 'enabled: false', ff: { enabled: false, writeClosedSessions: true }, expected: false },
    { desc: 'enabled: true sin activationMode (fallback defensivo qa_only rechaza si no es QA)', ff: { enabled: true, writeClosedSessions: true }, actor: 'user1', expected: false },
    { desc: 'qa_only con QA permitido', ff: { enabled: true, writeClosedSessions: true, activationMode: 'qa_only', enabledForQaUsers: ['qa1'] }, actor: 'qa1', expected: true },
    { desc: 'qa_only con usuario no permitido', ff: { enabled: true, writeClosedSessions: true, activationMode: 'qa_only', enabledForQaUsers: ['qa1'] }, actor: 'no_qa', expected: false },
    { desc: 'qa_and_branch con ambos permitidos', ff: { enabled: true, writeClosedSessions: true, activationMode: 'qa_and_branch', enabledForQaUsers: ['qa1'], enabledForSucursalIds: ['site_1'] }, actor: 'qa1', expected: true },
    { desc: 'qa_and_branch con QA permitido y sucursal rechazada', ff: { enabled: true, writeClosedSessions: true, activationMode: 'qa_and_branch', enabledForQaUsers: ['qa1'], enabledForSucursalIds: ['site_other'] }, actor: 'qa1', expected: false },
    { desc: 'qa_and_branch con sucursal permitida y usuario no QA', ff: { enabled: true, writeClosedSessions: true, activationMode: 'qa_and_branch', enabledForQaUsers: ['qa_other'], enabledForSucursalIds: ['site_1'] }, actor: 'no_qa', expected: false },
    { desc: 'branch_and_month con ambos permitidos', ff: { enabled: true, writeClosedSessions: true, activationMode: 'branch_and_month', enabledForSucursalIds: ['site_1'], enabledForOperationalMonths: ['2026-07'] }, actor: 'qa1', expected: true },
    { desc: 'branch_and_month con sucursal rechazada', ff: { enabled: true, writeClosedSessions: true, activationMode: 'branch_and_month', enabledForSucursalIds: ['site_other'], enabledForOperationalMonths: ['2026-07'] }, actor: 'qa1', expected: false },
    { desc: 'branch_and_month con mes rechazado', ff: { enabled: true, writeClosedSessions: true, activationMode: 'branch_and_month', enabledForSucursalIds: ['site_1'], enabledForOperationalMonths: ['2026-08'] }, actor: 'qa1', expected: false },
    { desc: 'global aceptado pero desaconsejado', ff: { enabled: true, writeClosedSessions: true, activationMode: 'global' }, actor: 'any', expected: true },
    { desc: 'activationMode desconocido rechazado', ff: { enabled: true, writeClosedSessions: true, activationMode: 'unknown_mode' }, actor: 'any', expected: false },
    { desc: 'writeClosedSessions: false', ff: { enabled: true, writeClosedSessions: false, activationMode: 'global' }, actor: 'any', expected: false },
    { desc: 'writeClosedSessions: true', ff: { enabled: true, writeClosedSessions: true, activationMode: 'global' }, actor: 'any', expected: true },
  ];

  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i];
    it(`FF: ${testCase.desc}`, async () => {
      const attendanceId = `chk_ff_${i}`;
      await dbAdmin.collection('Asistencia').doc(attendanceId).set({ ...baseCheckIn, id: attendanceId });
      
      if (testCase.ff !== null) {
        await dbAdmin.collection('FeatureFlags').doc('attendanceV2').set(testCase.ff);
      } else {
        await dbAdmin.collection('FeatureFlags').doc('attendanceV2').delete();
      }

      const written = await runClosure(attendanceId, testCase.actor || 'any_actor');
      expect(written).toBe(testCase.expected);
    });
  }
});
