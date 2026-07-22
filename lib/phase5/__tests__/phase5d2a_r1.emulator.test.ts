import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';

// @ts-ignore
import { executeAttendanceClosure } from '../../../functions/src/phase5/attendanceClosureCore';

describe('Fase 5D.2A - Auditoria R1 Reproduccion', () => {
  let dbAdmin: FirebaseFirestore.Firestore;

  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: 'demo-ggss' });
    }
    dbAdmin = admin.firestore();
  });

  const now = new Date();

  it('R1: Sobrescritura en asistencia_manual con múltiples turnos en misma fecha', async () => {
    const employeeId = 'emp_multi_1';
    const dateStr = '2026-07-20';

    // 1. Turno 1 (Mañana) - Inicia y se cierra.
    const attId1 = 'att_morning_1';
    await dbAdmin.collection('Asistencia').doc(attId1).set({
      employeeId,
      siteId: 'site_1',
      type: 'check_in',
      estado: 'ABIERTO',
      shiftId: 'shift_m_1',
      timestamp: '2026-07-20T08:00:00Z',
      localDate: dateStr
    });

    // Cierre del Turno 1
    await executeAttendanceClosure(dbAdmin, {
      attendanceId: attId1,
      actorUid: 'admin_1',
      actorEmail: 'admin@test.com',
      actorRole: 'admin',
      origen: 'admin',
      motivo: 'Cierre mañana',
      checkPermissions: false,
      cleanupDigitalAttendance: true,
      auditType: 'attendance_force_closed',
      requestId: 'req_1',
      isSystemActor: false,
      payloadHash: null,
      FieldValue: admin.firestore.FieldValue
    });

    const manualRef = dbAdmin.collection('asistencia_manual').doc(`manual_${employeeId}_${dateStr}`);
    let manualSnap = await manualRef.get();
    
    // Verificamos estado después del turno 1
    expect(manualSnap.exists).toBe(true);
    let manualData = manualSnap.data();
    expect(manualData?.siteId).toBe('site_1');
    expect(manualData?.type).toBe('forced_checkout');

    // 2. Turno 2 (Tarde/Noche Extra) - En la misma fecha operacional
    const attId2 = 'att_evening_1';
    await dbAdmin.collection('Asistencia').doc(attId2).set({
      employeeId,
      siteId: 'site_2', // Difiere
      type: 'check_in',
      estado: 'ABIERTO',
      shiftId: 'shift_e_1',
      timestamp: '2026-07-20T20:00:00Z',
      localDate: dateStr
    });

    // Cierre del Turno 2
    await executeAttendanceClosure(dbAdmin, {
      attendanceId: attId2,
      actorUid: 'system',
      actorEmail: 'system',
      actorRole: 'system',
      origen: 'scheduler',
      motivo: 'AutoClose tarde',
      checkPermissions: false,
      cleanupDigitalAttendance: true,
      auditType: 'auto_close',
      requestId: 'req_2',
      isSystemActor: true,
      payloadHash: null,
      FieldValue: admin.firestore.FieldValue
    });

    manualSnap = await manualRef.get();
    manualData = manualSnap.data();

    // R1 COMPROBADO: El documento se sobrescribió
    expect(manualData?.siteId).toBe('site_2'); // Perdimos la referencia a site_1
    expect(manualData?.type).toBe('auto_checkout'); // Perdimos forced_checkout
    
    // Esto demuestra que asistencia_manual tal como existe hoy (llave manual_emp_date)
    // NO puede representar múltiples turnos independientes. Actúa como un aggregate que 
    // se machaca con el último evento.
  });
});
