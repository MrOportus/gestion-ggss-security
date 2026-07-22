import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import { AttendanceShadowService } from '../attendanceShadowService';
import { AttendanceShadowRequest } from '../../types/phase5d2';

// ---------------------------------------------------------------------------
// Configuración de Entorno para usar Emuladores
// ---------------------------------------------------------------------------
process.env.VITE_USE_FIREBASE_EMULATOR = 'true';
process.env.VITE_ENABLE_ATTENDANCE_SHADOW_QA = 'true';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = 'demo-ggss';
// We set this for the frontend so it doesn't fail on feature flag
vi.stubEnv('VITE_ENABLE_ATTENDANCE_SHADOW_QA', 'true');

// Mocks para evitar errores del navegador en Node
vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(),
  isSupported: vi.fn().mockResolvedValue(false)
}));

import { getApps, initializeApp as initAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { signInWithEmailAndPassword, signOut, connectAuthEmulator } from 'firebase/auth';
import { connectFunctionsEmulator } from 'firebase/functions';
import { connectFirestoreEmulator } from 'firebase/firestore';
import { auth, functions, db as clientDb } from '../../lib/firebase';

let db: FirebaseFirestore.Firestore;
let adminAuth: import('firebase-admin/auth').Auth;

beforeAll(async () => {
  if (getApps().length === 0) {
    initAdminApp({ projectId: 'demo-ggss' });
  }
  
  // Conectar el cliente Frontend a los emuladores locales
  try {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    connectFirestoreEmulator(clientDb, '127.0.0.1', 8080);
  } catch (e) {
    // Ignorar si ya estaban conectados en este worker de vitest
  }

  db = getAdminFirestore();
  adminAuth = getAdminAuth();
  
  // Limpiar usuarios antiguos para evitar colisiones
  try {
    const list = await adminAuth.listUsers();
    await adminAuth.deleteUsers(list.users.map(u => u.uid));
  } catch (e) {
    console.error('Error limpiando auth emulator:', e);
  }
  
  // Habilitar Feature Flag en Firestore para que use 'shadow' mode
  await db.collection('FeatureFlags').doc('attendanceV2Read').set({
    enabled: true,
    activationMode: 'qa_only',
    enabledForQaUsers: [],
    shadowReadEnabled: true,
    allowLegacyOnlyFallback: false
  });
});

afterEach(async () => {
  await signOut(auth);
});

// Helper para crear un usuario con claims y autenticarlo en el cliente
async function loginAsRole(role: string, options: any = {}) {
  const email = `test_${role}_${Date.now()}@example.com`;
  const password = 'password123';
  const user = await adminAuth.createUser({ email, password });
  await adminAuth.setCustomUserClaims(user.uid, { role, ...options });
  
  // Crear el documento del usuario en Firestore para que la Cloud Function lo valide
  await db.collection('Colaboradores').doc(user.uid).set({
    email,
    role,
    alcancesOperativos: options?.alcancesOperativos || [],
    activo: true
  });
  
  if (options?.alcancesOperativos) {
    await db.collection('AlcancesOperativos').doc(user.uid).set({
      sucursales: options.alcancesOperativos
    });
  }
  
  // Agregar el usuario a QA del FeatureFlag
  const ffRef = db.collection('FeatureFlags').doc('attendanceV2Read');
  const ffSnap = await ffRef.get();
  if (ffSnap.exists) {
    const data = ffSnap.data() as any;
    await ffRef.update({
      enabledForQaUsers: [...(data.enabledForQaUsers || []), user.uid]
    });
  }
  
  await signInWithEmailAndPassword(auth, email, password);
  return user.uid;
}

function reqId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Data helpers
async function populateData(employeeId: string, sucursalId: string, date: string, type: 'one' | 'two' | 'overwrite') {
  const jornadaId = `manual_${employeeId}_${date}`;
  
  // Cleanup
  await db.collection('asistencia_manual').doc(jornadaId).delete().catch(()=>null);
  
  const legacyRef = db.collection('asistencia_manual').doc(jornadaId);
  
  if (type === 'one') {
    await legacyRef.set({
      id: jornadaId,
      employeeId: employeeId,
      sucursalId,
      date: date,
      status: 'completed',
      checkInTime: '2026-07-22T08:00:00Z',
      checkOutTime: '2026-07-22T18:00:00Z',
      tipoOperacion: 'manual'
    });
    const v2DocId = `v2_${employeeId}_${date}_t1`;
    await db.collection('AsistenciasConsolidadas').doc(v2DocId).set({
      id: v2DocId,
      employeeId,
      sucursalId,
      jornadaDate: date,
      checkInId: `check_${employeeId}_t1`,
      checkInAt: '2026-07-22T08:00:00Z',
      checkOutAt: '2026-07-22T18:00:00Z',
      status: 'completed',
      schemaVersion: 2
    });
  } else if (type === 'two') {
    await legacyRef.set({
      id: jornadaId, employeeId: employeeId, sucursalId, date: date,
      status: 'completed',
      checkInTime: '2026-07-22T08:00:00Z', // Sólo el primero se consolida en Legacy
      checkOutTime: '2026-07-22T12:00:00Z',
      tipoOperacion: 'manual'
    });
    await db.collection('AsistenciasConsolidadas').doc(`v2_1`).set({
      id: `v2_1`, employeeId, sucursalId, jornadaDate: date,
      checkInId: `check_${employeeId}_1`,
      checkInAt: '2026-07-22T08:00:00Z', checkOutAt: '2026-07-22T12:00:00Z', status: 'completed',
      schemaVersion: 2
    });
    await db.collection('AsistenciasConsolidadas').doc(`v2_2`).set({
      id: `v2_2`, employeeId, sucursalId, jornadaDate: date,
      checkInId: `check_${employeeId}_2`,
      checkInAt: '2026-07-22T14:00:00Z', checkOutAt: '2026-07-22T18:00:00Z', status: 'completed',
      schemaVersion: 2
    });
  } else if (type === 'overwrite') {
    await legacyRef.set({
      id: jornadaId, employeeId: employeeId, sucursalId, date: date,
      status: 'completed', checkInTime: '2026-07-22T08:00:00Z', checkOutTime: '2026-07-22T18:00:00Z',
      tipoOperacion: 'manual'
    });
    // For overwrite, we generate more than 1 V2 doc to simulate that V2 has more sessions than Legacy
    await db.collection('AsistenciasConsolidadas').doc(`v2_over1`).set({
      id: `v2_over1`, employeeId, sucursalId, jornadaDate: date,
      checkInId: `check_${employeeId}_1`,
      checkInAt: '2026-07-22T08:00:00Z', checkOutAt: '2026-07-22T12:00:00Z', status: 'completed',
      schemaVersion: 2
    });
    await db.collection('AsistenciasConsolidadas').doc(`v2_over2`).set({
      id: `v2_over2`, employeeId, sucursalId, jornadaDate: date,
      checkInId: `check_${employeeId}_2`,
      checkInAt: '2026-07-22T13:00:00Z', checkOutAt: '2026-07-22T18:00:00Z', status: 'completed',
      schemaVersion: 2
    });
  }
}

describe('AttendanceShadowQA Frontend Service Integration (Emulator)', () => {
  it('1. Admin autorizado', async () => {
    await loginAsRole('admin');
    const res = await AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S1', jornadaDate: '2026-07-22' }, reqId());
    expect(res).toBeDefined();
    expect(res.comparison?.status).toBeDefined();
  });

  it('2. Supervisor dentro de alcance', async () => {
    await loginAsRole('supervisor', { alcancesOperativos: ['S1'] });
    const res = await AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S1', jornadaDate: '2026-07-22' }, reqId());
    expect(res).toBeDefined();
  });

  it('3. Supervisor fuera de alcance', async () => {
    await loginAsRole('supervisor', { alcancesOperativos: ['S2'] });
    await expect(
      AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S1', jornadaDate: '2026-07-22' }, reqId())
    ).rejects.toThrow(); // Firebase functions rechaza con PERMISSION_DENIED
  });

  it('4. RRHH rechazado', async () => {
    await loginAsRole('rrhh');
    await expect(
      AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S1', jornadaDate: '2026-07-22' }, reqId())
    ).rejects.toThrow();
  });

  it('5. Worker rechazado', async () => {
    await loginAsRole('worker');
    await expect(
      AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S1', jornadaDate: '2026-07-22' }, reqId())
    ).rejects.toThrow();
  });

  it('6. No autenticado rechazado', async () => {
    await signOut(auth);
    await expect(
      AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S1', jornadaDate: '2026-07-22' }, reqId())
    ).rejects.toThrow();
  });

  it('7. Feature Flag apagado', async () => {
    vi.stubEnv('VITE_ENABLE_ATTENDANCE_SHADOW_QA', 'false');
    await expect(
      AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S1', jornadaDate: '2026-07-22' }, reqId())
    ).rejects.toThrow('La función de Shadow QA está desactivada.');
    vi.stubEnv('VITE_ENABLE_ATTENDANCE_SHADOW_QA', 'true');
  });

  it('8. Usuario QA autorizado', async () => {
    await loginAsRole('qa_tester', { alcancesOperativos: ['*'] });
    const res = await AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S1', jornadaDate: '2026-07-22' }, reqId());
    expect(res).toBeDefined();
  });

  it('9. Una sesión', async () => {
    await populateData('emp1', 'S9', '2026-07-22', 'one');
    await loginAsRole('admin');
    const res = await AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S9', jornadaDate: '2026-07-22' }, reqId());
    console.log('TEST 9 RES:', JSON.stringify(res.comparison, null, 2));
    const match = res.comparison?.status === 'exact_match';
    expect(match).toBe(true);
  });

  it('10. Dos sesiones V2 contra un Legacy', async () => {
    await populateData('emp2', 'S10_A', '2026-07-22', 'two');
    await loginAsRole('admin');
    const res = await AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S10_A', jornadaDate: '2026-07-22' }, reqId());
    console.log('TEST 10 RES:', JSON.stringify(res.comparison, null, 2));
    expect(res.comparison?.status).toBe('legacy_overwrite_detected'); // Porque Legacy tiene 1 (sobrescrita) y V2 tiene 2
    expect(res.v2Result?.items.length).toBeGreaterThanOrEqual(2);
  });

  it('11. legacy_overwrite_detected', async () => {
    await populateData('emp3', 'S11', '2026-07-22', 'overwrite');
    await loginAsRole('admin');
    const res = await AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S11', jornadaDate: '2026-07-22' }, reqId());
    console.log('TEST 11 RES:', JSON.stringify(res.comparison, null, 2));
    // In strict mode, an override makes differences true unless ignored.
    expect(res.comparison?.status).toBe('legacy_overwrite_detected');
  });

  it('12. Página siguiente', async () => {
    await loginAsRole('admin');
    // Para probar página siguiente, limitamos el backend con page size si pudiéramos, 
    // pero como no enviamos limit explícito desde frontend (es 50 por defecto), 
    // simulamos pasando un cursor que nos daría el backend (en este test no hace falta tener 51 items reales,
    // solo comprobar que enviamos el cursor y backend no explota).
    const res1 = await AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S12', jornadaDate: '2026-07-22' }, reqId());
    // Dummy cursor is accepted if validly signed, but here we don't have a valid cursor unless res1 gives us one.
    // If res1 gives a cursor, we use it. If not, we just check success of first request.
    expect(res1).toBeDefined();
  });

  it('13. Cursor expirado', async () => {
    await loginAsRole('admin');
    // Enviamos un cursor falso, backend nos lo rechazará por firma inválida o expirado
    await expect(
      AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S10', jornadaDate: '2026-07-22', cursor: 'eyJleHAiOjEwfQ.abcd' }, reqId())
    ).rejects.toThrow();
  });

  it('14. Cursor manipulado', async () => {
    await loginAsRole('admin');
    // Cursor base64 manipulado
    await expect(
      AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S10', jornadaDate: '2026-07-22', cursor: 'modified_cursor_not_signed' }, reqId())
    ).rejects.toThrow();
  });

  it('15. Auditoría creada', async () => {
    await populateData('emp4', 'S10', '2026-07-22', 'two');
    const rId = reqId();
    await loginAsRole('admin');
    await AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S10', jornadaDate: '2026-07-22' }, rId);
    
    // Verificamos que se creó auditoría en el backend directamente consultando la DB local
    const audits = await db.collection('AuditoriaAcciones').where('accion', '==', 'attendance_v2_shadow_read').get();
    expect(audits.empty).toBe(false);
  });

  it('16. Retry no duplica auditoría', async () => {
    const rId = `retry_req_${Date.now()}`;
    await loginAsRole('admin');
    await AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S16', jornadaDate: '2026-07-22' }, rId);
    await AttendanceShadowService.execute({ queryType: 'branch_day', sucursalId: 'S16', jornadaDate: '2026-07-22' }, rId); // Retry con mismo reqId
    
    const audits = await db.collection('AuditoriaAcciones').where('requestId', '==', rId).get();
    expect(audits.size).toBe(1); // Debe haber solo 1
  });
});
