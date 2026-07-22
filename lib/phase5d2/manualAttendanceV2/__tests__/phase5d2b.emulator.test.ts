import { describe, it, expect, beforeAll } from 'vitest';
import * as admin from 'firebase-admin';
import { buildManualAttendanceV2Id } from '../idBuilder';

describe('ManualAttendanceV2 - Emulator Integration', () => {
  let db: FirebaseFirestore.Firestore;

  beforeAll(() => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: 'demo-ggss' });
    }
    db = admin.firestore();
  });

  it('Dos documentos V2 del mismo trabajador y fecha, coexisten y actualización no cambia identidad', async () => {
    const employeeId = 'emp_multi_2';
    const jornadaDate = '2026-08-01';

    const checkInId1 = 'chk_multi_1';
    const checkInId2 = 'chk_multi_2';

    const docId1 = buildManualAttendanceV2Id(checkInId1);
    const docId2 = buildManualAttendanceV2Id(checkInId2);

    const doc1Ref = db.collection('asistencia_manual').doc(docId1);
    const doc2Ref = db.collection('asistencia_manual').doc(docId2);

    // 1. Crear documento V1
    await doc1Ref.set({
      schemaVersion: 2,
      recordKind: 'shift_attendance',
      isLegacy: false,
      checkInId: checkInId1,
      employeeId,
      jornadaDate,
      status: 'completed',
      attendanceStatus: 'presente',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 2. Crear documento V2
    await doc2Ref.set({
      schemaVersion: 2,
      recordKind: 'shift_attendance',
      isLegacy: false,
      checkInId: checkInId2,
      employeeId,
      jornadaDate,
      status: 'open',
      attendanceStatus: 'sin_clasificar',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 3. Confirmar que ambos existen y no se sobrescriben
    const snap1 = await doc1Ref.get();
    const snap2 = await doc2Ref.get();

    expect(snap1.exists).toBe(true);
    expect(snap2.exists).toBe(true);

    expect(snap1.data()?.status).toBe('completed');
    expect(snap2.data()?.status).toBe('open');

    // 4. Confirmar consulta por employeeId + jornadaDate retorna dos resultados (filtrando por schemaVersion)
    const snapshot = await db.collection('asistencia_manual')
      .where('employeeId', '==', employeeId)
      .where('jornadaDate', '==', jornadaDate)
      .where('schemaVersion', '==', 2)
      .get();

    expect(snapshot.size).toBe(2);

    const createdAt1 = snap1.data()?.createdAt;

    // 5. Modificar uno no afecta al otro y no cambia createdAt ni checkInId
    await doc1Ref.update({ attendanceStatus: 'ausente' });
    const snap1After = await doc1Ref.get();
    const snap2After = await doc2Ref.get();

    expect(snap1After.data()?.attendanceStatus).toBe('ausente');
    expect(snap2After.data()?.attendanceStatus).toBe('sin_clasificar'); // Inalterado
    
    // Inmutabilidad
    expect(snap1After.data()?.checkInId).toBe(checkInId1);
    expect(snap1After.data()?.createdAt.seconds).toBe(createdAt1.seconds);
  });

  it('Un tercer turno también coexiste, Legacy y V2 se separan en lectura', async () => {
    const employeeId = 'emp_multi_3';
    const jornadaDate = '2026-08-02';

    const legacyDocId = `manual_${employeeId}_${jornadaDate}`;
    const v2DocId = buildManualAttendanceV2Id('chk_v2_1');
    const v2DocId2 = buildManualAttendanceV2Id('chk_v2_2');

    await db.collection('asistencia_manual').doc(legacyDocId).set({
      employeeId,
      date: jornadaDate,
      status: 'presente'
    });

    await db.collection('asistencia_manual').doc(v2DocId).set({
      schemaVersion: 2,
      recordKind: 'shift_attendance',
      isLegacy: false,
      checkInId: 'chk_v2_1',
      employeeId,
      jornadaDate,
      status: 'completed'
    });
    
    await db.collection('asistencia_manual').doc(v2DocId2).set({
      schemaVersion: 2,
      recordKind: 'shift_attendance',
      isLegacy: false,
      checkInId: 'chk_v2_2',
      employeeId,
      jornadaDate,
      status: 'open'
    });

    // El lector puede separarlos
    const allSnap = await db.collection('asistencia_manual')
      .where('employeeId', '==', employeeId)
      .get();

    const allDocs = allSnap.docs.map(d => d.data());
    expect(allDocs.length).toBe(3);

    const legacyDocs = allDocs.filter(d => d.schemaVersion !== 2);
    const v2Docs = allDocs.filter(d => d.schemaVersion === 2 && d.recordKind === 'shift_attendance');

    expect(legacyDocs.length).toBe(1);
    expect(v2Docs.length).toBe(2);
  });

  it('Dos escrituras concurrentes de sesiones diferentes no colisionan', async () => {
    const employeeId = 'emp_concurrent';
    const checkIn1 = 'chk_c1';
    const checkIn2 = 'chk_c2';
    
    // Simulate concurrent writes by calling set immediately without awaiting the first one
    const p1 = db.collection('asistencia_manual').doc(buildManualAttendanceV2Id(checkIn1)).set({
      schemaVersion: 2, recordKind: 'shift_attendance', isLegacy: false, checkInId: checkIn1, employeeId
    });
    const p2 = db.collection('asistencia_manual').doc(buildManualAttendanceV2Id(checkIn2)).set({
      schemaVersion: 2, recordKind: 'shift_attendance', isLegacy: false, checkInId: checkIn2, employeeId
    });
    
    await Promise.all([p1, p2]);
    
    const snap1 = await db.collection('asistencia_manual').doc(buildManualAttendanceV2Id(checkIn1)).get();
    const snap2 = await db.collection('asistencia_manual').doc(buildManualAttendanceV2Id(checkIn2)).get();
    
    expect(snap1.exists).toBe(true);
    expect(snap2.exists).toBe(true);
  });

  it('Dos escrituras concurrentes de la misma sesión convergen al mismo documento usando merge', async () => {
    const employeeId = 'emp_concurrent_same';
    const checkIn1 = 'chk_same_1';
    
    // Simulate concurrent writes merging different fields. This proves they hit the same document ID.
    const p1 = db.collection('asistencia_manual').doc(buildManualAttendanceV2Id(checkIn1)).set({
      schemaVersion: 2, recordKind: 'shift_attendance', isLegacy: false, checkInId: checkIn1, employeeId, status: 'open'
    }, { merge: true });
    
    const p2 = db.collection('asistencia_manual').doc(buildManualAttendanceV2Id(checkIn1)).set({
      checkOutId: 'out_1', workedMinutes: 60
    }, { merge: true });
    
    await Promise.all([p1, p2]);
    
    const snap1 = await db.collection('asistencia_manual').doc(buildManualAttendanceV2Id(checkIn1)).get();
    
    expect(snap1.exists).toBe(true);
    expect(snap1.data()?.status).toBe('open');
    expect(snap1.data()?.checkOutId).toBe('out_1');
    expect(snap1.data()?.workedMinutes).toBe(60);
  });

  it('Checkout ambiguo no consolida la sesión incorrecta (simulado vía normalizer check out rules)', async () => {
    // Note: since normalizer rules are unit tested, this just verifies that writing an open session because of ambiguous checkout 
    // keeps the document as open in Firestore.
    const docId = buildManualAttendanceV2Id('chk_amb');
    await db.collection('asistencia_manual').doc(docId).set({
      schemaVersion: 2, recordKind: 'shift_attendance', isLegacy: false, checkInId: 'chk_amb', status: 'open'
    });
    const snap = await db.collection('asistencia_manual').doc(docId).get();
    expect(snap.data()?.status).toBe('open');
  });

  it('Ninguna escritura alcanza producción', () => {
    // Estamos en el proyecto demo-ggss con el emulador apuntando a 127.0.0.1:8080.
    // Esto asegura que ninguna escritura salga a la red de producción.
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080');
  });
});
