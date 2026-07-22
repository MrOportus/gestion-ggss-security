import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
import crypto from 'crypto';
// @ts-ignore
import { processAutoCloseShifts } from '../../../functions/autoCloseHelper';
// @ts-ignore
import { executeAttendanceClosure } from '../../../functions/src/phase5/attendanceClosureCore';

describe('Phase 5D.1C Gate Correctivo - Concurrency Tests', () => {
  let dbAdmin: FirebaseFirestore.Firestore;

  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: 'demo-ggss' });
    }
    dbAdmin = admin.firestore();
  });

  const now = new Date();
  const hrsAgo = (hours: number) => new Date(now.getTime() - (hours * 60 * 60 * 1000));

  it('1. Execute AutoClose y ForceClose concurrentemente: Solo uno gana', async () => {
    const attendanceId = 'concurrent_1';
    const docRef = dbAdmin.collection('Asistencia').doc(attendanceId);
    
    // Check-in abierto de hace 15 horas (elegible para auto_close)
    await docRef.set({
      employeeId: 'emp_c1',
      siteId: 'site_1',
      type: 'check_in',
      estado: 'ABIERTO',
      timestamp: hrsAgo(15).toISOString(),
    });

    const payload = { attendanceId, note: 'Admin test' };
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    // Lanzar ambas operaciones concurrentemente
    const [autoRes, forceRes] = await Promise.all([
      // AutoClose
      processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue),
      
      // ForceClose manual desde Admin
      executeAttendanceClosure(dbAdmin, {
        attendanceId,
        actorUid: 'admin_1',
        actorEmail: 'admin@test.com',
        actorRole: 'admin',
        origen: 'admin_dashboard',
        motivo: 'Admin test',
        checkPermissions: true,
        cleanupDigitalAttendance: false,
        auditType: 'attendance_force_closed',
        requestId: 'req_admin_concurrent_1',
        isSystemActor: false,
        payloadHash,
        FieldValue: admin.firestore.FieldValue
      }).catch((e: any) => ({ success: false, error: e }))
    ]);

    // Verificar en Asistencia (solo un checkout creado)
    const checkoutsSnap = await dbAdmin.collection('Asistencia')
      .where('type', '==', 'check_out')
      .where('closedByAttendanceId', '==', attendanceId)
      .get();
    
    expect(checkoutsSnap.size).toBe(1);

    const checkInDoc = await docRef.get();
    expect(checkInDoc.data()?.estado).toBe('CERRADO');

    // Verificar auditoría (solo una generada)
    const auditSnap = await dbAdmin.collection('AuditoriaAcciones')
      .where('attendanceId', '==', attendanceId)
      .get();
    
    expect(auditSnap.size).toBe(1);

    const checkOutId = checkoutsSnap.docs[0].id;
    // Si fue admin, se llama forced_checkout_. Si fue system, auto_checkout_.
    expect(checkOutId.startsWith('forced_checkout_') || checkOutId.startsWith('auto_checkout_')).toBe(true);
  });

  it('2. ForceClose preserva digitalAttendance (cleanupDigitalAttendance: false)', async () => {
    const attendanceId = 'force_2';
    const docRef = dbAdmin.collection('Asistencia').doc(attendanceId);
    const dateStr = '2026-07-20';
    
    await docRef.set({
      employeeId: 'emp_f2',
      siteId: 'site_2',
      type: 'check_in',
      estado: 'ABIERTO',
      timestamp: now.toISOString(),
      localDate: dateStr
    });

    // Crear digital_attendance simulado
    const digId = `site_2_emp_f2_${dateStr}`;
    await dbAdmin.collection('asistencia_digital').doc(digId).set({
      employeeId: 'emp_f2',
      siteId: 'site_2',
      date: dateStr
    });
    const payload = { attendanceId, note: 'Cierre admin' };
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    await executeAttendanceClosure(dbAdmin, {
        attendanceId,
        actorUid: 'admin_2',
        actorEmail: 'admin2@test.com',
        actorRole: 'admin',
        origen: 'admin_dashboard',
        motivo: 'Cierre admin',
        checkPermissions: true,
        cleanupDigitalAttendance: false, // FLAG ESTRICTO: false
        auditType: 'attendance_force_closed',
        requestId: 'req_admin_force_2',
        isSystemActor: false,
        payloadHash,
        FieldValue: admin.firestore.FieldValue
      });

    const checkInDoc = await docRef.get();
    expect(checkInDoc.data()?.estado).toBe('CERRADO');

    // Debe preservar la asistencia_digital
    const digDoc = await dbAdmin.collection('asistencia_digital').doc(digId).get();
    expect(digDoc.exists).toBe(true);
  });

  it('3. AutoClose elimina digitalAttendance (cleanupDigitalAttendance: true)', async () => {
    const attendanceId = 'auto_3';
    const docRef = dbAdmin.collection('Asistencia').doc(attendanceId);
    const dateStr = '2026-07-19'; // Ayer
    
    await docRef.set({
      employeeId: 'emp_a3',
      siteId: 'site_3',
      type: 'check_in',
      estado: 'ABIERTO',
      timestamp: hrsAgo(15).toISOString(),
      localDate: dateStr
    });

    // Crear digital_attendance simulado
    const digId = `site_3_emp_a3_${dateStr}`;
    await dbAdmin.collection('asistencia_digital').doc(digId).set({
      employeeId: 'emp_a3',
      siteId: 'site_3',
      date: dateStr
    });

    // AutoClose (que usa processAutoCloseShifts -> core config)
    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);

    const checkInDoc = await docRef.get();
    expect(checkInDoc.data()?.estado).toBe('CERRADO');

    // Debe ELIMINAR la asistencia_digital
    const digDoc = await dbAdmin.collection('asistencia_digital').doc(digId).get();
    expect(digDoc.exists).toBe(false);
  });

  it('4. AutoClose es idempotente con UUID determinístico', async () => {
    const attendanceId = 'auto_4';
    const docRef = dbAdmin.collection('Asistencia').doc(attendanceId);
    
    await docRef.set({
      employeeId: 'emp_a4',
      siteId: 'site_4',
      type: 'check_in',
      estado: 'ABIERTO',
      timestamp: hrsAgo(15).toISOString(),
    });

    // Doble AutoClose
    await Promise.all([
      processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue),
      processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue)
    ]);

    const auditSnap = await dbAdmin.collection('AuditoriaAcciones')
      .where('attendanceId', '==', attendanceId)
      .where('accion', '==', 'auto_close')
      .get();
    
    // Solo se debe registrar una acción
    expect(auditSnap.size).toBe(1);

    const tokenDoc = await dbAdmin.collection('OperationTokens').doc(`auto_close_${attendanceId}`).get();
    expect(tokenDoc.exists).toBe(true);
  });
});
