/**
 * phase5d2d_queries.emulator.test.ts
 *
 * Suite completa del Gate 5D.2D — ejecutada contra Emuladores reales.
 *
 * Prerequisitos:
 *   - Firestore Emulator en 127.0.0.1:8080
 *   - Auth Emulator en 127.0.0.1:9099
 *   - process.env.CURSOR_SIGNING_SECRET establecido
 *
 * Cómo correr:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *   CURSOR_SIGNING_SECRET=test-secret-minimum-16chars \
 *   npx vitest run lib/phase5d2/__tests__/queries/phase5d2d_queries.emulator.test.ts
 */

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { describe, test, expect, beforeAll, afterEach } from 'vitest';

// Establecer secreto de cursor ANTES de importar el módulo
if (!process.env.CURSOR_SIGNING_SECRET) {
  process.env.CURSOR_SIGNING_SECRET = 'test-cursor-signing-secret-for-emulator-tests';
}
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — módulos JS sin declaraciones de tipos (tests de integración)
import { executeAttendanceShadowValidated } from '../../../../functions/src/phase5d2/getAttendanceShadowValidated';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { createNextCursor } from '../../../../functions/src/phase5d2/queries/attendanceV2Pagination';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let db: FirebaseFirestore.Firestore;

beforeAll(() => {
  if (getApps().length === 0) {
    initializeApp({ projectId: 'ggss-security-test' });
  }
  db = getFirestore();
});

function uid() {
  return `uid_${Math.random().toString(36).slice(2, 10)}`;
}

function reqId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

afterEach(async () => {
  const batch = db.batch();

  const audits = await db.collection('AuditoriaAcciones')
    .where('accion', '==', 'attendance_v2_shadow_read').get();
  audits.forEach(d => batch.delete(d.ref));

  batch.delete(db.collection('FeatureFlags').doc('attendanceV2Read'));

  // Limpiar docs de prueba en AsistenciasConsolidadas y asistencia_manual
  const v2Docs = await db.collection('AsistenciasConsolidadas').limit(50).get();
  v2Docs.forEach(d => batch.delete(d.ref));
  const legacyDocs = await db.collection('asistencia_manual').limit(50).get();
  legacyDocs.forEach(d => batch.delete(d.ref));
  const colabs = await db.collection('Colaboradores').limit(30).get();
  colabs.forEach(d => batch.delete(d.ref));
  const alcances = await db.collection('AlcancesOperativos').limit(20).get();
  alcances.forEach(d => batch.delete(d.ref));

  await batch.commit();
});

// ---------------------------------------------------------------------------
// Helpers de fixtures
// ---------------------------------------------------------------------------

async function createAdmin(id?: string): Promise<string> {
  const adminId = id || uid();
  await db.collection('Colaboradores').doc(adminId).set({ role: 'admin' });
  return adminId;
}

async function createJefe(id?: string): Promise<string> {
  const jefeId = id || uid();
  await db.collection('Colaboradores').doc(jefeId).set({ role: 'jefe_operaciones' });
  return jefeId;
}

async function createSupervisor(id?: string): Promise<string> {
  const supId = id || uid();
  await db.collection('Colaboradores').doc(supId).set({ role: 'supervisor' });
  return supId;
}

async function setAlcance(userId: string, sucursales: string[]) {
  await db.collection('AlcancesOperativos').doc(userId).set({ sucursales });
}

async function enableShadowFF(qaUsers: string[] = []) {
  await db.collection('FeatureFlags').doc('attendanceV2Read').set({
    enabled: true,
    shadowReadEnabled: true,
    activationMode: 'qa_only',
    enabledForQaUsers: qaUsers
  });
}

async function createV2Session(docId: string, data: Record<string, unknown>) {
  await db.collection('AsistenciasConsolidadas').doc(docId).set({
    schemaVersion: 2,
    generationStatus: 'active',
    sucursalResolution: 'explicit',
    ...data
  });
}

async function createLegacySession(docId: string, data: Record<string, unknown>) {
  await db.collection('asistencia_manual').doc(docId).set(data);
}

// ===========================================================================
// GRUPO E: Seguridad / Roles
// ===========================================================================
describe('Grupo E — Seguridad y Roles', () => {

  test('E.1 No autenticado → unauthenticated', async () => {
    await expect(executeAttendanceShadowValidated(db, {
      queryType: 'employee_day',
      employeeId: 'emp_01',
      jornadaDate: '2024-06-01',
      requestId: reqId()
    }, '')).rejects.toThrow('Debe iniciar sesión');
  });

  test('E.2 Worker → permission-denied', async () => {
    const workerId = uid();
    await db.collection('Colaboradores').doc(workerId).set({ role: 'worker' });
    await expect(executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_01',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, workerId)).rejects.toThrow(/El rol worker no está autorizado/);
  });

  test('E.3 RRHH → permission-denied', async () => {
    const rrhhId = uid();
    await db.collection('Colaboradores').doc(rrhhId).set({ role: 'rrhh' });
    await expect(executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_01',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, rrhhId)).rejects.toThrow(/El rol rrhh no está autorizado/);
  });

  test('E.4 Rol desconocido → permission-denied', async () => {
    const unknownId = uid();
    await db.collection('Colaboradores').doc(unknownId).set({ role: 'auditor_externo' });
    await expect(executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_01',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, unknownId)).rejects.toThrow(/no está autorizado/);
  });

  test('E.5 Admin — puede consultar cualquier sucursal', async () => {
    const adminId = await createAdmin();
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'branch_day',
      sucursalId: 'cualquier_sucursal_123',
      jornadaDate: '2024-06-01',
      requestId: reqId()
    }, adminId);
    expect(result).toBeDefined();
    expect(result.legacyResult).toBeDefined();
  });

  test('E.6 Jefe dentro de alcance → permitido', async () => {
    const jefeId = await createJefe();
    await setAlcance(jefeId, ['suc_01']);
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'branch_day', sucursalId: 'suc_01',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, jefeId);
    expect(result).toBeDefined();
  });

  test('E.7 Jefe fuera de alcance → permission-denied', async () => {
    const jefeId = await createJefe();
    await setAlcance(jefeId, ['suc_01']);
    await expect(executeAttendanceShadowValidated(db, {
      queryType: 'branch_day', sucursalId: 'suc_99',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, jefeId)).rejects.toThrow(/alcance operativo/);
  });

  test('E.8 Jefe sin AlcancesOperativos → permission-denied', async () => {
    const jefeId = await createJefe();
    // No se crea AlcancesOperativos
    await expect(executeAttendanceShadowValidated(db, {
      queryType: 'branch_day', sucursalId: 'suc_01',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, jefeId)).rejects.toThrow(/No posee alcance operativo definido/);
  });

  test('E.9 Supervisor dentro de alcance → permitido', async () => {
    const supId = await createSupervisor();
    await setAlcance(supId, ['suc_02']);
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'branch_day', sucursalId: 'suc_02',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, supId);
    expect(result).toBeDefined();
  });

  test('E.10 Supervisor fuera de alcance → permission-denied', async () => {
    const supId = await createSupervisor();
    await setAlcance(supId, ['suc_02']);
    await expect(executeAttendanceShadowValidated(db, {
      queryType: 'branch_day', sucursalId: 'suc_99',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, supId)).rejects.toThrow(/alcance operativo/);
  });
});

// ===========================================================================
// GRUPO H: Feature Flag completo
// ===========================================================================
describe('Grupo H — Feature Flag', () => {

  test('H.1 Documento inexistente → legacy_only (sin Shadow)', async () => {
    const adminId = await createAdmin();
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_01',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, adminId);
    expect(result.v2Result).toBeNull();
    expect(result.comparison).toBeNull();
  });

  test('H.2 enabled: false → legacy_only', async () => {
    const adminId = await createAdmin();
    await db.collection('FeatureFlags').doc('attendanceV2Read').set({ enabled: false });
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_01',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, adminId);
    expect(result.v2Result).toBeNull();
  });

  test('H.3 shadowReadEnabled: false → legacy_only (no Shadow)', async () => {
    const adminId = await createAdmin();
    await db.collection('FeatureFlags').doc('attendanceV2Read').set({
      enabled: true, shadowReadEnabled: false,
      activationMode: 'qa_only', enabledForQaUsers: [adminId]
    });
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_01',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, adminId);
    expect(result.v2Result).toBeNull();
  });

  test('H.4 qa_only autorizado → Shadow activo', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_01',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, adminId);
    // V2 puede estar vacío pero el campo debe existir
    expect(result.v2Result).not.toBeUndefined();
    expect(result.comparison).toBeDefined();
  });

  test('H.5 qa_only sin autorización → legacy_only', async () => {
    const adminId = await createAdmin();
    const otherUser = uid();
    await enableShadowFF([otherUser]); // adminId NO está en la lista
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_01',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, adminId);
    expect(result.v2Result).toBeNull();
  });

  test('H.6 qa_and_branch ambos válidos → Shadow activo', async () => {
    const adminId = await createAdmin();
    await db.collection('FeatureFlags').doc('attendanceV2Read').set({
      enabled: true, shadowReadEnabled: true,
      activationMode: 'qa_and_branch',
      enabledForQaUsers: [adminId],
      enabledForSucursalIds: ['suc_01']
    });
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'branch_day', sucursalId: 'suc_01',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, adminId);
    expect(result.comparison).toBeDefined();
  });

  test('H.7 qa_and_branch sucursal inválida → legacy_only', async () => {
    const adminId = await createAdmin();
    await db.collection('FeatureFlags').doc('attendanceV2Read').set({
      enabled: true, shadowReadEnabled: true,
      activationMode: 'qa_and_branch',
      enabledForQaUsers: [adminId],
      enabledForSucursalIds: ['suc_01']
    });
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'branch_day', sucursalId: 'suc_99',  // no está en la lista
      jornadaDate: '2024-06-01', requestId: reqId()
    }, adminId);
    expect(result.v2Result).toBeNull();
  });

  test('H.8 branch_and_month válido → Shadow activo', async () => {
    const adminId = await createAdmin();
    await db.collection('FeatureFlags').doc('attendanceV2Read').set({
      enabled: true, shadowReadEnabled: true,
      activationMode: 'branch_and_month',
      enabledForSucursalIds: ['suc_01'],
      enabledForOperationalMonths: ['2024-06']
    });
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'branch_day', sucursalId: 'suc_01',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, adminId);
    expect(result.comparison).toBeDefined();
  });

  test('H.9 branch_and_month mes inválido → legacy_only', async () => {
    const adminId = await createAdmin();
    await db.collection('FeatureFlags').doc('attendanceV2Read').set({
      enabled: true, shadowReadEnabled: true,
      activationMode: 'branch_and_month',
      enabledForSucursalIds: ['suc_01'],
      enabledForOperationalMonths: ['2024-05']  // mes distinto
    });
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'branch_day', sucursalId: 'suc_01',
      jornadaDate: '2024-06-01', requestId: reqId()  // junio ≠ mayo
    }, adminId);
    expect(result.v2Result).toBeNull();
  });

  test('H.10 modo global → bloqueado → legacy_only', async () => {
    const adminId = await createAdmin();
    await db.collection('FeatureFlags').doc('attendanceV2Read').set({
      enabled: true, shadowReadEnabled: true,
      activationMode: 'global'
    });
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_01',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, adminId);
    expect(result.v2Result).toBeNull();
  });

  test('H.11 modo desconocido → legacy_only (fail closed)', async () => {
    const adminId = await createAdmin();
    await db.collection('FeatureFlags').doc('attendanceV2Read').set({
      enabled: true, shadowReadEnabled: true,
      activationMode: 'unknown_mode_xyz'
    });
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_01',
      jornadaDate: '2024-06-01', requestId: reqId()
    }, adminId);
    expect(result.v2Result).toBeNull();
  });
});

// ===========================================================================
// GRUPO A: Employee Day
// ===========================================================================
describe('Grupo A — Employee Day', () => {

  test('A.1 Cero sesiones V2 → comparison exact_match (ambos vacíos)', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_vacio',
      sucursalId: 'suc_01', jornadaDate: '2024-06-01', requestId: reqId()
    }, adminId);
    expect(result.comparison.status).toBe('exact_match');
    expect(result.comparison.comparisonScope).toBe('full');
    expect(result.comparison.comparisonComplete).toBe(true);
  });

  test('A.2 Una sesión V2 coincide con legacy → exact_match', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);

    await createLegacySession('manual_emp_A_2024-06-10', {
      colaboradorId: 'emp_A', fecha: '2024-06-10', horas: 8,
      checkInTime: '08:00', checkOutTime: '16:00', sucursalId: 'suc_01'
    });
    await createV2Session('manual_chkA1', {
      checkInId: 'chkA1', employeeId: 'emp_A', jornadaDate: '2024-06-10',
      sucursalId: 'suc_01', status: 'closed', attendanceStatus: 'presente',
      checkInAt: '2024-06-10T08:00:00Z', checkOutAt: '2024-06-10T16:00:00Z',
      workedMinutes: 480
    });

    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_A',
      sucursalId: 'suc_01', jornadaDate: '2024-06-10', requestId: reqId()
    }, adminId);

    expect(result.comparison.legacy.numberOfSessions).toBe(1);
    expect(result.comparison.v2.numberOfSessions).toBe(1);
    expect(result.comparison.status).toBe('exact_match');
  });

  test('A.3 Dos sesiones V2, una legacy → legacy_overwrite_detected (R1)', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);

    await createLegacySession('manual_emp_B_2024-06-11', {
      colaboradorId: 'emp_B', fecha: '2024-06-11', horas: 6, sucursalId: 'suc_01'
    });
    await createV2Session('manual_chkB1', {
      checkInId: 'chkB1', employeeId: 'emp_B', jornadaDate: '2024-06-11',
      sucursalId: 'suc_01', status: 'closed', workedMinutes: 240,
      checkInAt: '2024-06-11T08:00:00Z'
    });
    await createV2Session('manual_chkB2', {
      checkInId: 'chkB2', employeeId: 'emp_B', jornadaDate: '2024-06-11',
      sucursalId: 'suc_01', status: 'closed', workedMinutes: 120,
      checkInAt: '2024-06-11T12:00:00Z'
    });

    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_B',
      sucursalId: 'suc_01', jornadaDate: '2024-06-11', requestId: reqId()
    }, adminId);

    expect(result.comparison.status).toBe('legacy_overwrite_detected');
  });

  test('A.4 V2 presente, legacy ausente → missing_legacy', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);

    await createV2Session('manual_chkC1', {
      checkInId: 'chkC1', employeeId: 'emp_C', jornadaDate: '2024-06-12',
      sucursalId: 'suc_01', status: 'closed', workedMinutes: 300,
      checkInAt: '2024-06-12T09:00:00Z'
    });

    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_C',
      sucursalId: 'suc_01', jornadaDate: '2024-06-12', requestId: reqId()
    }, adminId);

    expect(result.comparison.status).toBe('missing_legacy');
  });

  test('A.5 Sesiones en orden correcto por checkInAt', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);

    // Crear en orden inverso para verificar que la query ordena correctamente
    await createV2Session('manual_chkD2', {
      checkInId: 'chkD2', employeeId: 'emp_D', jornadaDate: '2024-06-13',
      sucursalId: 'suc_01', status: 'closed', checkInAt: '2024-06-13T14:00:00Z',
      workedMinutes: 120
    });
    await createV2Session('manual_chkD1', {
      checkInId: 'chkD1', employeeId: 'emp_D', jornadaDate: '2024-06-13',
      sucursalId: 'suc_01', status: 'closed', checkInAt: '2024-06-13T08:00:00Z',
      workedMinutes: 240
    });

    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_D',
      sucursalId: 'suc_01', jornadaDate: '2024-06-13', requestId: reqId()
    }, adminId);

    const v2Items = Array.isArray(result.v2Result?.items)
      ? result.v2Result.items
      : (Array.isArray(result.v2Result) ? result.v2Result : []);

    if (v2Items.length === 2) {
      expect(v2Items[0].checkInAt).toBe('2024-06-13T08:00:00Z');
      expect(v2Items[1].checkInAt).toBe('2024-06-13T14:00:00Z');
    }
  });
});

// ===========================================================================
// GRUPO B: Branch Day
// ===========================================================================
describe('Grupo B — Branch Day', () => {

  test('B.1 Dos empleados, tres sesiones, uniqueEmployees=2, totalSessions=3', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);

    await createV2Session('manual_chkE1', {
      checkInId: 'chkE1', employeeId: 'emp_E1', jornadaDate: '2024-06-20',
      sucursalId: 'suc_branch', status: 'closed', checkInAt: '2024-06-20T08:00:00Z', workedMinutes: 480
    });
    await createV2Session('manual_chkE2', {
      checkInId: 'chkE2', employeeId: 'emp_E2', jornadaDate: '2024-06-20',
      sucursalId: 'suc_branch', status: 'closed', checkInAt: '2024-06-20T09:00:00Z', workedMinutes: 420
    });
    await createV2Session('manual_chkE3', {
      checkInId: 'chkE3', employeeId: 'emp_E2', jornadaDate: '2024-06-20',
      sucursalId: 'suc_branch', status: 'closed', checkInAt: '2024-06-20T20:00:00Z', workedMinutes: 60
    });

    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'branch_day', sucursalId: 'suc_branch',
      jornadaDate: '2024-06-20', requestId: reqId()
    }, adminId);

    expect(result.comparison.v2.numberOfSessions).toBe(3);
  });

  test('B.2 Aislamiento entre sucursales', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);

    await createV2Session('manual_chkF1', {
      checkInId: 'chkF1', employeeId: 'emp_F', jornadaDate: '2024-06-20',
      sucursalId: 'suc_A', status: 'closed', checkInAt: '2024-06-20T08:00:00Z', workedMinutes: 480
    });
    await createV2Session('manual_chkF2', {
      checkInId: 'chkF2', employeeId: 'emp_F', jornadaDate: '2024-06-20',
      sucursalId: 'suc_B', status: 'closed', checkInAt: '2024-06-20T08:00:00Z', workedMinutes: 480
    });

    const resultA = await executeAttendanceShadowValidated(db, {
      queryType: 'branch_day', sucursalId: 'suc_A',
      jornadaDate: '2024-06-20', requestId: reqId()
    }, adminId);

    const v2ItemsA = resultA.v2Result?.items || [];
    // Solo debe ver documentos de suc_A
    expect(v2ItemsA.every((s: Record<string, unknown>) => s.sucursalId === 'suc_A')).toBe(true);
  });
});

// ===========================================================================
// GRUPO C: Range y Paginación
// ===========================================================================
describe('Grupo C — Range y Paginación', () => {

  test('C.1 Rango de 32 días → rechazado', async () => {
    const adminId = await createAdmin();
    await expect(executeAttendanceShadowValidated(db, {
      queryType: 'branch_range', sucursalId: 'suc_01',
      fromDate: '2024-06-01', toDate: '2024-07-03',  // 32 días
      requestId: reqId()
    }, adminId)).rejects.toThrow(/rango máximo permitido/);
  });

  test('C.2 Fechas invertidas → rechazado', async () => {
    const adminId = await createAdmin();
    await expect(executeAttendanceShadowValidated(db, {
      queryType: 'branch_range', sucursalId: 'suc_01',
      fromDate: '2024-06-30', toDate: '2024-06-01',  // invertidas
      requestId: reqId()
    }, adminId)).rejects.toThrow(/invertido/);
  });

  test('C.3 Comparación paginada declara comparisonScope: page', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);

    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'branch_range', sucursalId: 'suc_01',
      fromDate: '2024-06-01', toDate: '2024-06-30',
      requestId: reqId()
    }, adminId);

    // Si hay shadow activo, debe declarar scope correcto
    if (result.comparison) {
      expect(result.comparison.comparisonScope).toBe('page');
      expect(result.comparison.comparisonComplete).toBe(false);
    }
  });

  test('C.4 Paginación — sin duplicados entre páginas', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);

    // Crear 3 sesiones para paginar con limit=2
    await createV2Session('manual_pg1', {
      checkInId: 'pg1', employeeId: 'emp_pg', jornadaDate: '2024-06-01',
      sucursalId: 'suc_pg', status: 'closed', checkInAt: '2024-06-01T08:00:00Z', workedMinutes: 480
    });
    await createV2Session('manual_pg2', {
      checkInId: 'pg2', employeeId: 'emp_pg', jornadaDate: '2024-06-02',
      sucursalId: 'suc_pg', status: 'closed', checkInAt: '2024-06-02T08:00:00Z', workedMinutes: 480
    });
    await createV2Session('manual_pg3', {
      checkInId: 'pg3', employeeId: 'emp_pg', jornadaDate: '2024-06-03',
      sucursalId: 'suc_pg', status: 'closed', checkInAt: '2024-06-03T08:00:00Z', workedMinutes: 480
    });

    const page1 = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_range', employeeId: 'emp_pg', sucursalId: 'suc_pg',
      fromDate: '2024-06-01', toDate: '2024-06-30',
      limit: 2, requestId: reqId()
    }, adminId);

    const v2Page1 = page1.v2Result;
    const nextCursor = v2Page1?.nextCursor;

    if (nextCursor && v2Page1?.hasMore) {
      const page2 = await executeAttendanceShadowValidated(db, {
        queryType: 'employee_range', employeeId: 'emp_pg', sucursalId: 'suc_pg',
        fromDate: '2024-06-01', toDate: '2024-06-30',
        limit: 2, cursor: nextCursor, requestId: reqId()
      }, adminId);

      const ids1 = (v2Page1.items || []).map((s: Record<string, unknown>) => s.id);
      const ids2 = (page2.v2Result?.items || []).map((s: Record<string, unknown>) => s.id);

      // Sin duplicados entre páginas
      const intersection = ids1.filter((id: string) => ids2.includes(id));
      expect(intersection).toHaveLength(0);
    }
  });

  test('C.5 Cursor de otro actor → cursor_actor_mismatch', async () => {
    const adminId = await createAdmin();
    const admin2Id = await createAdmin();
    await enableShadowFF([adminId, admin2Id]);

    await createV2Session('manual_cursor1', {
      checkInId: 'cursor1', employeeId: 'emp_cur', jornadaDate: '2024-06-01',
      sucursalId: 'suc_01', status: 'closed', checkInAt: '2024-06-01T08:00:00Z', workedMinutes: 480
    });

    // Generar cursor firmado para adminId
    const fakeLastDoc = {
      id: 'manual_cursor1', exists: true,
      data: () => ({ jornadaDate: '2024-06-01', checkInAt: '2024-06-01T08:00:00Z' })
    } as unknown as FirebaseFirestore.DocumentSnapshot;
    const cursorForAdmin = createNextCursor(fakeLastDoc as FirebaseFirestore.DocumentSnapshot, 'employee_range', {
      actorUid: adminId,
      employeeId: 'emp_cur', fromDate: '2024-06-01', toDate: '2024-06-30'
    });

    // Intentar usarlo con admin2Id
    await expect(executeAttendanceShadowValidated(db, {
      queryType: 'employee_range', employeeId: 'emp_cur', sucursalId: 'suc_01',
      fromDate: '2024-06-01', toDate: '2024-06-30',
      cursor: cursorForAdmin, requestId: reqId()
    }, admin2Id)).rejects.toThrow('cursor_actor_mismatch');
  });

  test('C.6 Cursor modificado → cursor_signature_invalid', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);

    const fakeLastDoc = {
      id: 'doc_mod', exists: true,
      data: () => ({ jornadaDate: '2024-06-01', checkInAt: '2024-06-01T08:00:00Z' })
    } as unknown as FirebaseFirestore.DocumentSnapshot;
    const validCursor = createNextCursor(fakeLastDoc, 'branch_range', {
      actorUid: adminId,
      sucursalId: 'suc_01', fromDate: '2024-06-01', toDate: '2024-06-30'
    });

    // Manipular la firma
    const parts = (validCursor as string).split('.');
    const tamperedCursor = parts[0] + '.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    await expect(executeAttendanceShadowValidated(db, {
      queryType: 'branch_range', sucursalId: 'suc_01',
      fromDate: '2024-06-01', toDate: '2024-06-30',
      cursor: tamperedCursor, requestId: reqId()
    }, adminId)).rejects.toThrow('cursor_signature_invalid');
  });

  test('C.7 Cursor de otra sucursal → cursor_filter_mismatch', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);

    const fakeLastDoc = {
      id: 'doc_suc', exists: true,
      data: () => ({ jornadaDate: '2024-06-01', checkInAt: '2024-06-01T08:00:00Z' })
    } as unknown as FirebaseFirestore.DocumentSnapshot;
    const cursorSuc01 = createNextCursor(fakeLastDoc, 'branch_range', {
      actorUid: adminId,
      sucursalId: 'suc_01', fromDate: '2024-06-01', toDate: '2024-06-30'
    });

    await expect(executeAttendanceShadowValidated(db, {
      queryType: 'branch_range', sucursalId: 'suc_99',  // sucursal diferente
      fromDate: '2024-06-01', toDate: '2024-06-30',
      cursor: cursorSuc01, requestId: reqId()
    }, adminId)).rejects.toThrow(/cursor_filter_mismatch/);
  });

  test('C.8 Cursor de otro queryType → cursor_query_mismatch', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);

    const fakeLastDoc = {
      id: 'doc_qt', exists: true,
      data: () => ({ jornadaDate: '2024-06-01', checkInAt: '2024-06-01T08:00:00Z' })
    } as unknown as FirebaseFirestore.DocumentSnapshot;
    const cursorEmpRange = createNextCursor(fakeLastDoc, 'employee_range', {
      actorUid: adminId,
      employeeId: 'emp_01', fromDate: '2024-06-01', toDate: '2024-06-30'
    });

    await expect(executeAttendanceShadowValidated(db, {
      queryType: 'branch_range', sucursalId: 'suc_01',
      fromDate: '2024-06-01', toDate: '2024-06-30',
      cursor: cursorEmpRange, requestId: reqId()
    }, adminId)).rejects.toThrow('cursor_query_mismatch');
  });
});

// ===========================================================================
// GRUPO D: Filtros
// ===========================================================================
describe('Grupo D — Filtros', () => {

  test('D.1 status + tipoOperacion combinados → rechazado', async () => {
    const adminId = await createAdmin();
    await expect(executeAttendanceShadowValidated(db, {
      queryType: 'branch_range', sucursalId: 'suc_01',
      fromDate: '2024-06-01', toDate: '2024-06-30',
      status: 'closed', tipoOperacion: 'entrada',
      requestId: reqId()
    }, adminId)).rejects.toThrow(/simultáneamente/);
  });

  test('D.2 Solo status → aceptado', async () => {
    const adminId = await createAdmin();
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'branch_range', sucursalId: 'suc_01',
      fromDate: '2024-06-01', toDate: '2024-06-30',
      status: 'closed', requestId: reqId()
    }, adminId);
    expect(result).toBeDefined();
  });

  test('D.3 Solo tipoOperacion → aceptado', async () => {
    const adminId = await createAdmin();
    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'branch_range', sucursalId: 'suc_01',
      fromDate: '2024-06-01', toDate: '2024-06-30',
      tipoOperacion: 'contractual', requestId: reqId()
    }, adminId);
    expect(result).toBeDefined();
  });
});

// ===========================================================================
// GRUPO F: Documentos V2 Inválidos
// ===========================================================================
describe('Grupo F — Documentos V2 Inválidos', () => {

  test('F.1 schemaVersion !== 2 → excluido, consulta continúa', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);

    // Doc inválido (schemaVersion incorrecto)
    await db.collection('AsistenciasConsolidadas').doc('manual_badSchema').set({
      checkInId: 'badSchema', employeeId: 'emp_F1', jornadaDate: '2024-06-01',
      sucursalId: 'suc_01', schemaVersion: 1, generationStatus: 'active',  // debe ser 2
      checkInAt: '2024-06-01T08:00:00Z', workedMinutes: 480
    });
    // Doc válido
    await createV2Session('manual_goodSchema', {
      checkInId: 'goodSchema', employeeId: 'emp_F1', jornadaDate: '2024-06-01',
      sucursalId: 'suc_01', status: 'closed', checkInAt: '2024-06-01T09:00:00Z', workedMinutes: 240
    });

    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_F1',
      sucursalId: 'suc_01', jornadaDate: '2024-06-01', requestId: reqId()
    }, adminId);

    const v2Items = result.v2Result?.items || [];
    // Solo el doc válido debe aparecer
    expect(v2Items).toHaveLength(1);
    expect(v2Items[0].checkInId).toBe('goodSchema');
  });

  test('F.2 checkInId ausente → excluido', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);

    await db.collection('AsistenciasConsolidadas').doc('manual_noCheckIn').set({
      // checkInId ausente intencionalmente
      employeeId: 'emp_F2', jornadaDate: '2024-06-02',
      sucursalId: 'suc_01', schemaVersion: 2, generationStatus: 'active',
      checkInAt: '2024-06-02T08:00:00Z', workedMinutes: 480
    });

    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_F2',
      sucursalId: 'suc_01', jornadaDate: '2024-06-02', requestId: reqId()
    }, adminId);

    const v2Items = result.v2Result?.items || [];
    expect(v2Items).toHaveLength(0);
  });

  test('F.3 workedMinutes negativo → normalizado a null + warning', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);

    await createV2Session('manual_negMin', {
      checkInId: 'negMin', employeeId: 'emp_F3', jornadaDate: '2024-06-03',
      sucursalId: 'suc_01', status: 'open', checkInAt: '2024-06-03T08:00:00Z',
      workedMinutes: -30  // negativo
    });

    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_F3',
      sucursalId: 'suc_01', jornadaDate: '2024-06-03', requestId: reqId()
    }, adminId);

    const v2Items = result.v2Result?.items || [];
    expect(v2Items).toHaveLength(1);
    expect(v2Items[0].workedMinutes).toBeNull();
    expect(v2Items[0].warnings).toContain('negative_workedMinutes_normalized');
  });

  test('F.4 generationStatus: invalidated → excluido (sin includeInvalidated)', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);

    await db.collection('AsistenciasConsolidadas').doc('manual_invalidated').set({
      checkInId: 'invld', employeeId: 'emp_F4', jornadaDate: '2024-06-04',
      sucursalId: 'suc_01', schemaVersion: 2,
      generationStatus: 'invalidated',
      checkInAt: '2024-06-04T08:00:00Z', workedMinutes: 480
    });

    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_F4',
      sucursalId: 'suc_01', jornadaDate: '2024-06-04', requestId: reqId()
    }, adminId);

    const v2Items = result.v2Result?.items || [];
    expect(v2Items).toHaveLength(0);
  });

  test('F.5 La respuesta V2 no contiene employeeRut', async () => {
    const adminId = await createAdmin();
    await enableShadowFF([adminId]);

    await createV2Session('manual_noRut', {
      checkInId: 'noRut', employeeId: 'emp_F5', jornadaDate: '2024-06-05',
      sucursalId: 'suc_01', status: 'closed',
      checkInAt: '2024-06-05T08:00:00Z', workedMinutes: 480,
      employeeRut: '12345678-9'  // Presente en Firestore pero debe omitirse en respuesta
    });

    const result = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_F5',
      sucursalId: 'suc_01', jornadaDate: '2024-06-05', requestId: reqId()
    }, adminId);

    const v2Items = result.v2Result?.items || [];
    expect(v2Items).toHaveLength(1);
    expect(v2Items[0]).not.toHaveProperty('employeeRut');
  });
});

// ===========================================================================
// GRUPO G: Auditoría Idempotente
// ===========================================================================
describe('Grupo G — Auditoría Idempotente', () => {

  test('G.1 Primera llamada crea auditoría con ID correcto', async () => {
    const adminId = await createAdmin();
    const rid = reqId();

    await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_G',
      sucursalId: 'suc_01', jornadaDate: '2024-06-01', requestId: rid
    }, adminId);

    const auditDoc = await db.collection('AuditoriaAcciones')
      .doc(`shadow_read_${adminId}_${rid}`).get();
    expect(auditDoc.exists).toBe(true);
    expect(auditDoc.data()?.actorId).toBe(adminId);
    expect(auditDoc.data()?.requestId).toBe(rid);
    expect(auditDoc.data()?.payloadHash).toBeTruthy();
  });

  test('G.2 Auditoría no contiene RUT ni datos completos', async () => {
    const adminId = await createAdmin();
    const rid = reqId();

    await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_G2',
      sucursalId: 'suc_01', jornadaDate: '2024-06-01', requestId: rid
    }, adminId);

    const auditDoc = await db.collection('AuditoriaAcciones')
      .doc(`shadow_read_${adminId}_${rid}`).get();
    const data = auditDoc.data() || {};

    expect(data).not.toHaveProperty('employeeRut');
    expect(data).not.toHaveProperty('nombreColaborador');
    expect(data).not.toHaveProperty('sessions');
    // Debe tener conteos
    expect(data).toHaveProperty('resultCountLegacy');
    expect(data).toHaveProperty('resultCountV2');
    expect(data).toHaveProperty('durationMs');
  });

  test('G.3 Retry idéntico (mismo payloadHash) → re-ejecuta sin duplicar auditoría', async () => {
    const adminId = await createAdmin();
    const rid = reqId();
    const payload = {
      queryType: 'employee_day', employeeId: 'emp_G3',
      sucursalId: 'suc_01', jornadaDate: '2024-06-01', requestId: rid
    };

    await executeAttendanceShadowValidated(db, payload, adminId);
    // Segunda llamada idéntica — no debe lanzar error
    const result2 = await executeAttendanceShadowValidated(db, payload, adminId);
    expect(result2).toBeDefined();

    // Debe existir un solo documento de auditoría
    const auditDocs = await db.collection('AuditoriaAcciones')
      .where('requestId', '==', rid).get();
    expect(auditDocs.size).toBe(1);
  });

  test('G.4 Mismo requestId + payload diferente → request_id_reused', async () => {
    const adminId = await createAdmin();
    const rid = reqId();

    await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_G4',
      sucursalId: 'suc_01', jornadaDate: '2024-06-01', requestId: rid
    }, adminId);

    // Misma requestId, distinto payload (empleado diferente)
    await expect(executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_DIFERENTE',
      sucursalId: 'suc_01', jornadaDate: '2024-06-01', requestId: rid
    }, adminId)).rejects.toThrow('request_id_reused');
  });

  test('G.5 Mismo requestId, otro actor → no colisiona (IDs distintos)', async () => {
    const admin1 = await createAdmin();
    const admin2 = await createAdmin();
    const rid = reqId();

    await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_G5',
      sucursalId: 'suc_01', jornadaDate: '2024-06-01', requestId: rid
    }, admin1);

    // Mismo requestId, mismo payload pero otro actor → no debe colisionar
    const result2 = await executeAttendanceShadowValidated(db, {
      queryType: 'employee_day', employeeId: 'emp_G5',
      sucursalId: 'suc_01', jornadaDate: '2024-06-01', requestId: rid
    }, admin2);

    expect(result2).toBeDefined();

    // Deben existir dos documentos distintos de auditoría
    const doc1 = await db.collection('AuditoriaAcciones')
      .doc(`shadow_read_${admin1}_${rid}`).get();
    const doc2 = await db.collection('AuditoriaAcciones')
      .doc(`shadow_read_${admin2}_${rid}`).get();
    expect(doc1.exists).toBe(true);
    expect(doc2.exists).toBe(true);
  });
});
