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

describe('Fase 5D.2C - Dual Write Controlado', () => {
  
  const now = new Date();
  
  it('1. NO escribe V2 si Feature Flag está ausente o apagado', async () => {
    const attendanceId = 'chk_no_v2';
    const dateStr = '2026-07-21';
    await dbAdmin.collection('Asistencia').doc(attendanceId).set({
      id: attendanceId,
      employeeId: 'emp_no_v2',
      siteId: 'site_1',
      type: 'check_in',
      timestamp: now.toISOString(),
      status: 'open',
      estado: 'ABIERTO',
      localDate: dateStr
    });

    const payloadHash = crypto.createHash('sha256').update(JSON.stringify({ attendanceId })).digest('hex');

    await executeAttendanceClosure(dbAdmin, {
      attendanceId,
      actorUid: 'admin_1',
      actorRole: 'admin',
      origen: 'admin',
      checkPermissions: false,
      cleanupDigitalAttendance: false,
      auditType: 'attendance_force_closed',
      requestId: 'req_no_v2',
      isSystemActor: false,
      payloadHash,
      FieldValue: admin.firestore.FieldValue
    });

    // Check Legacy
    const legacyDoc = await dbAdmin.collection('asistencia_manual').doc(`manual_emp_no_v2_${dateStr}`).get();
    expect(legacyDoc.exists).toBe(true);

    const v2Doc = await dbAdmin.collection('AsistenciasConsolidadas').doc(`manual_${attendanceId}`).get();
    expect(v2Doc.exists).toBe(false); // NO escrito

    const shadowDoc = await dbAdmin.collection('AttendanceShadowComparisons').doc(`comparison_${attendanceId}`).get();
    expect(shadowDoc.exists).toBe(false);
  });

  it('1b. AutoClose NO escribe V2 si Flag apagado', async () => {
    const attendanceId = 'chk_no_v2_auto';
    const dateStr = '2026-07-21';
    await dbAdmin.collection('Asistencia').doc(attendanceId).set({
      id: attendanceId,
      employeeId: 'emp_no_v2',
      siteId: 'site_1',
      type: 'check_in',
      timestamp: now.toISOString(),
      status: 'open',
      estado: 'ABIERTO',
      localDate: dateStr
    });

    await executeAttendanceClosure(dbAdmin, {
      attendanceId,
      actorUid: 'system',
      actorRole: 'system',
      origen: 'scheduler',
      checkPermissions: false,
      cleanupDigitalAttendance: true,
      auditType: 'auto_close',
      requestId: 'req_no_v2_auto',
      isSystemActor: true,
      FieldValue: admin.firestore.FieldValue
    });

    const v2Doc = await dbAdmin.collection('AsistenciasConsolidadas').doc(`manual_${attendanceId}`).get();
    expect(v2Doc.exists).toBe(false);
  });

  it('2. Escribe V2 y Shadow si QA User está habilitado en Feature Flag', async () => {
    const attendanceId = 'chk_qa';
    const dateStr = '2026-07-21';
    const actorUid = 'qa_admin_99';
    
    // Configurar Feature Flag
    await dbAdmin.collection('FeatureFlags').doc('attendanceV2').set({
      enabled: true,
      writeClosedSessions: true,
      enabledForQaUsers: [actorUid]
    });

    await dbAdmin.collection('Asistencia').doc(attendanceId).set({
      id: attendanceId,
      employeeId: 'emp_qa',
      siteId: 'site_1',
      type: 'check_in',
      timestamp: now.toISOString(),
      status: 'open',
      estado: 'ABIERTO',
      localDate: dateStr
    });

    const payloadHash = crypto.createHash('sha256').update(JSON.stringify({ attendanceId })).digest('hex');

    await executeAttendanceClosure(dbAdmin, {
      attendanceId,
      actorUid,
      actorRole: 'admin',
      origen: 'admin',
      checkPermissions: false,
      cleanupDigitalAttendance: false,
      auditType: 'attendance_force_closed',
      requestId: 'req_qa_1',
      isSystemActor: false,
      payloadHash,
      FieldValue: admin.firestore.FieldValue
    });

    // Check Legacy
    const legacyDoc = await dbAdmin.collection('asistencia_manual').doc(`manual_emp_qa_${dateStr}`).get();
    expect(legacyDoc.exists).toBe(true);

    // Check V2
    const v2Doc = await dbAdmin.collection('AsistenciasConsolidadas').doc(`manual_${attendanceId}`).get();
    expect(v2Doc.exists).toBe(true);
    expect(v2Doc.data()?.status).toBe('completed');
    expect(v2Doc.data()?.employeeId).toBe('emp_qa');

    // Check Shadow
    const shadowDoc = await dbAdmin.collection('AttendanceShadowComparisons').doc(`comparison_${attendanceId}`).get();
    expect(shadowDoc.exists).toBe(true);
    expect(shadowDoc.data()?.comparisonStatus).toBe('expected_legacy_limitation'); // Porque type != tipoOperacion etc
    
    // Check Audit
    const auditV2Doc = await dbAdmin.collection('AuditoriaAcciones').doc(`attendance_v2_snapshot_written_${attendanceId}`).get();
    expect(auditV2Doc.exists).toBe(true);
    expect(auditV2Doc.data()?.accion).toBe('attendance_v2_snapshot_written');
    expect(auditV2Doc.data()?.operationTokenId).toBe('req_qa_1');
  });

  it('2b. AutoClose con sucursal y mes autorizados escribe V2', async () => {
    const attendanceId = 'chk_auto_ok';
    const dateStr = '2026-07-21';
    
    await dbAdmin.collection('FeatureFlags').doc('attendanceV2').set({
      enabled: true,
      writeClosedSessions: true,
      activationMode: 'branch_and_month',
      enabledForSucursalIds: ['site_auto'],
      enabledForOperationalMonths: ['2026-07']
    });

    await dbAdmin.collection('Asistencia').doc(attendanceId).set({
      id: attendanceId,
      employeeId: 'emp_auto',
      siteId: 'site_auto',
      type: 'check_in',
      timestamp: now.toISOString(),
      status: 'open',
      estado: 'ABIERTO',
      localDate: dateStr
    });

    await executeAttendanceClosure(dbAdmin, {
      attendanceId,
      actorUid: 'system',
      actorRole: 'system',
      origen: 'scheduler',
      checkPermissions: false,
      cleanupDigitalAttendance: true,
      auditType: 'auto_close',
      requestId: 'req_auto_ok',
      isSystemActor: true,
      FieldValue: admin.firestore.FieldValue
    });

    const v2Doc = await dbAdmin.collection('AsistenciasConsolidadas').doc(`manual_${attendanceId}`).get();
    expect(v2Doc.exists).toBe(true);
    expect(v2Doc.data()?.closureOrigin).toBe('scheduler');
    
    const auditV2Doc = await dbAdmin.collection('AuditoriaAcciones').doc(`attendance_v2_snapshot_written_${attendanceId}`).get();
    expect(auditV2Doc.exists).toBe(true);
    expect(auditV2Doc.data()?.sourceOperation).toBe('auto_close');
  });

  it('3. Idempotencia y conservación de createdAt en V2', async () => {
    const attendanceId = 'chk_idem';
    const dateStr = '2026-07-21';
    
    // Habilitar para todos los sucursales para simplificar
    await dbAdmin.collection('FeatureFlags').doc('attendanceV2').set({
      enabled: true,
      writeClosedSessions: true,
      activationMode: 'branch_and_month',
      enabledForSucursalIds: ['site_idem'],
      enabledForOperationalMonths: ['2026-07']
    });

    await dbAdmin.collection('Asistencia').doc(attendanceId).set({
      id: attendanceId,
      employeeId: 'emp_idem',
      siteId: 'site_idem',
      type: 'check_in',
      timestamp: now.toISOString(),
      status: 'open',
      estado: 'ABIERTO',
      localDate: dateStr
    });

    // Primer cierre (System Actor, como AutoClose)
    await executeAttendanceClosure(dbAdmin, {
      attendanceId,
      actorUid: 'system',
      actorRole: 'system',
      origen: 'scheduler',
      checkPermissions: false,
      cleanupDigitalAttendance: true,
      auditType: 'auto_close',
      requestId: 'req_idem_1',
      isSystemActor: true,
      FieldValue: admin.firestore.FieldValue
    });

    const v2Doc1 = await dbAdmin.collection('AsistenciasConsolidadas').doc(`manual_${attendanceId}`).get();
    const createdAt1 = v2Doc1.data()?.createdAt;
    expect(createdAt1).toBeDefined();

    // Simular que el estado vuelve a estar abierto y se vuelve a cerrar (reprocesamiento)
    await dbAdmin.collection('Asistencia').doc(attendanceId).update({ status: 'open', estado: 'ABIERTO' });

    await executeAttendanceClosure(dbAdmin, {
      attendanceId,
      actorUid: 'system',
      actorRole: 'system',
      origen: 'scheduler',
      checkPermissions: false,
      cleanupDigitalAttendance: true,
      auditType: 'auto_close',
      requestId: 'req_idem_2',
      isSystemActor: true,
      FieldValue: admin.firestore.FieldValue
    });

    const v2Doc2 = await dbAdmin.collection('AsistenciasConsolidadas').doc(`manual_${attendanceId}`).get();
    const createdAt2 = v2Doc2.data()?.createdAt;
    
    // createdAt debe conservarse (Firebase Timestamp equals)
    expect(createdAt1.isEqual(createdAt2)).toBe(true);
  });

  it('4. Dos turnos del mismo trabajador misma fecha (R1)', async () => {
    // Feature Flag general
    await dbAdmin.collection('FeatureFlags').doc('attendanceV2').set({
      enabled: true, writeClosedSessions: true, activationMode: 'global'
    });

    const dateStr = '2026-08-01';
    const empId = 'emp_multi';
    
    // Turno 1
    await dbAdmin.collection('Asistencia').doc('chk_m1').set({ id: 'chk_m1', employeeId: empId, siteId: 's1', type: 'check_in', timestamp: now.toISOString(), status: 'open', estado: 'ABIERTO', localDate: dateStr });
    // Turno 2
    await dbAdmin.collection('Asistencia').doc('chk_m2').set({ id: 'chk_m2', employeeId: empId, siteId: 's1', type: 'check_in', timestamp: now.toISOString(), status: 'open', estado: 'ABIERTO', localDate: dateStr });

    await executeAttendanceClosure(dbAdmin, { attendanceId: 'chk_m1', actorUid: 'a', origen: 'test', checkPermissions: false, auditType: 'attendance_force_closed', requestId: 'r1', isSystemActor: false, FieldValue: admin.firestore.FieldValue });
    await executeAttendanceClosure(dbAdmin, { attendanceId: 'chk_m2', actorUid: 'a', origen: 'test', checkPermissions: false, auditType: 'attendance_force_closed', requestId: 'r2', isSystemActor: false, FieldValue: admin.firestore.FieldValue });

    // En V2 deben existir los 2 independientes
    const v2_1 = await dbAdmin.collection('AsistenciasConsolidadas').doc('manual_chk_m1').get();
    const v2_2 = await dbAdmin.collection('AsistenciasConsolidadas').doc('manual_chk_m2').get();
    expect(v2_1.exists).toBe(true);
    expect(v2_2.exists).toBe(true);

    // En Legacy solo existe el último (se sobrescribió R1)
    const leg1 = await dbAdmin.collection('AuditoriaAcciones').where('attendanceId', '==', 'chk_m1').get(); 
    // ^ Wait, legacy table
    const legacyDoc = await dbAdmin.collection('asistencia_manual').doc(`manual_${empId}_${dateStr}`).get();
    expect(legacyDoc.exists).toBe(true); // Está ahí pero solo puede alojar a uno
  });

  it('5. V2 existente incompatible produce rollback', async () => {
    await dbAdmin.collection('FeatureFlags').doc('attendanceV2').set({ enabled: true, writeClosedSessions: true, activationMode: 'global' });
    const attendanceId = 'chk_incompat';
    await dbAdmin.collection('Asistencia').doc(attendanceId).set({ id: attendanceId, employeeId: 'emp_i', siteId: 's', type: 'check_in', status: 'open', estado: 'ABIERTO' });
    
    // Inyectamos un documento con un checkInId diferente en el ID destino para simular incompatibilidad estructural o employeeId
    await dbAdmin.collection('AsistenciasConsolidadas').doc(`manual_${attendanceId}`).set({ employeeId: 'emp_DIFFERENT', checkInId: attendanceId });

    await expect(executeAttendanceClosure(dbAdmin, { attendanceId, actorUid: 'a', origen: 'test', checkPermissions: false, auditType: 'attendance_force_closed', requestId: 'r_incompat', isSystemActor: false, FieldValue: admin.firestore.FieldValue })).rejects.toThrow();

    // Verificamos que el checkin siga abierto (Rollback total)
    const chk = await dbAdmin.collection('Asistencia').doc(attendanceId).get();
    expect(chk.data()?.status).toBe('open');
  });
});
