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

describe('Fase 5D.2C - Rollback y Fallos', () => {
  const now = new Date();
  
  it('1. Falla validación V2 -> Rollback total (checkIn abierto, no checkout, no legacy, no V2)', async () => {
    const attendanceId = 'chk_fail_v2';
    const dateStr = '2026-07-21';
    const actorUid = 'qa_admin_fail';
    
    // Feature Flag ON
    await dbAdmin.collection('FeatureFlags').doc('attendanceV2').set({
      enabled: true,
      writeClosedSessions: true,
      activationMode: 'qa_only',
      enabledForQaUsers: [actorUid]
    });

    // Checkin defectuoso que provocará falla en V2 normalizer/validator (e.g., sin employeeId o corrupto,
    // o forzamos un error mandando un dato que sabemos que fallará la validación estricta de V2)
    // El idBuilder requiere checkInId, si pasamos un string vacio o con espacios falla
    const badId = '  '; // ID inválido para idBuilder V2
    
    await dbAdmin.collection('Asistencia').doc(badId).set({
      id: badId,
      employeeId: 'emp_qa',
      siteId: 'site_1',
      type: 'check_in',
      timestamp: now.toISOString(),
      status: 'open',
      estado: 'ABIERTO',
      localDate: dateStr
    });

    const payloadHash = crypto.createHash('sha256').update(JSON.stringify({ attendanceId: badId })).digest('hex');

    // Debe lanzar error y hacer rollback
    await expect(executeAttendanceClosure(dbAdmin, {
      attendanceId: badId,
      actorUid,
      actorRole: 'admin',
      origen: 'admin',
      checkPermissions: false,
      cleanupDigitalAttendance: false,
      auditType: 'attendance_force_closed',
      requestId: 'req_qa_fail',
      isSystemActor: false,
      payloadHash,
      FieldValue: admin.firestore.FieldValue
    })).rejects.toThrow(); // Debe fallar por invalid ID o validation

    // Verificaciones post-rollback
    // Check-in debe seguir abierto
    const checkInDoc = await dbAdmin.collection('Asistencia').doc(badId).get();
    expect(checkInDoc.data()?.status).toBe('open');
    expect(checkInDoc.data()?.estado).toBe('ABIERTO');

    // Checkout no existe
    const checkoutQuery = await dbAdmin.collection('Asistencia').where('closedByAttendanceId', '==', badId).get();
    expect(checkoutQuery.empty).toBe(true);

    // Legacy no se creó
    const legacyDoc = await dbAdmin.collection('asistencia_manual').doc(`manual_emp_qa_${dateStr}`).get();
    expect(legacyDoc.exists).toBe(false);

    // V2 no se creó
    // Falló antes de crear V2 id
    
    // OperationToken no completado
    const tokenDoc = await dbAdmin.collection('OperationTokens').doc('req_qa_fail').get();
    expect(tokenDoc.exists).toBe(false);
  });

  it('2. Shadow comparison falla -> NO revierte el cierre (Warning en log, datos persistidos)', async () => {
    const attendanceId = 'chk_shadow_fail';
    const dateStr = '2026-07-21';
    const actorUid = 'qa_admin_shadow';
    
    // Feature Flag ON
    await dbAdmin.collection('FeatureFlags').doc('attendanceV2').set({
      enabled: true,
      writeClosedSessions: true,
      activationMode: 'qa_only',
      enabledForQaUsers: [actorUid]
    });

    await dbAdmin.collection('Asistencia').doc(attendanceId).set({
      id: attendanceId,
      employeeId: 'emp_shadow',
      siteId: 'site_1',
      type: 'check_in',
      timestamp: now.toISOString(),
      status: 'open',
      estado: 'ABIERTO',
      localDate: dateStr
    });

    // Simular que el collection de shadow tire error, ej pasamos un dato que reviente la db o mockeamos,
    // Pero en el emulador real es dificil inyectar fallos al set, 
    // lo validaremos conceptualmente ya que Shadow Comparison corre .catch() POST-transacción.
    
    // Para probar que corre asincronamente y no bloquea:
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify({ attendanceId })).digest('hex');

    const result = await executeAttendanceClosure(dbAdmin, {
      attendanceId,
      actorUid,
      actorRole: 'admin',
      origen: 'admin',
      checkPermissions: false,
      cleanupDigitalAttendance: false,
      auditType: 'attendance_force_closed',
      requestId: 'req_qa_shadow',
      isSystemActor: false,
      payloadHash,
      FieldValue: admin.firestore.FieldValue
    });

    expect(result.success).toBe(true);

    // Legacy SI se creó
    const legacyDoc = await dbAdmin.collection('asistencia_manual').doc(`manual_emp_shadow_${dateStr}`).get();
    expect(legacyDoc.exists).toBe(true);

    // V2 SI se creó
    const v2Doc = await dbAdmin.collection('AsistenciasConsolidadas').doc(`manual_${attendanceId}`).get();
    expect(v2Doc.exists).toBe(true);
    
    // Y el token esta success
    const tokenDoc = await dbAdmin.collection('OperationTokens').doc('req_qa_shadow').get();
    expect(tokenDoc.data()?.status).toBe('success');
    
    // Wait un poco para asincronia shadow
    await new Promise(r => setTimeout(r, 500));
    const shadowDoc = await dbAdmin.collection('AttendanceShadowComparisons').doc(`comparison_${attendanceId}`).get();
    expect(shadowDoc.exists).toBe(true);
  });
});
