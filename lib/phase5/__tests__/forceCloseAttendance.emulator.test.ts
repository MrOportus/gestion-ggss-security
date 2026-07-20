import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';

describe('Gate Final 5D.1B — forceCloseAttendanceValidated (Emulator)', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-ggss',
      firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync('firestore.rules', 'utf8') }
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'Colaboradores', 'admin_1'), { role: 'admin' });
      await setDoc(doc(db, 'Colaboradores', 'jefe_in'), { role: 'jefe_operaciones' });
      await setDoc(doc(db, 'AlcancesOperativos', 'jefe_in'), { activo: true, sucursalesAutorizadas: ['suc_1'], alcanceNacional: false });
      await setDoc(doc(db, 'Colaboradores', 'jefe_out'), { role: 'jefe_operaciones' });
      await setDoc(doc(db, 'AlcancesOperativos', 'jefe_out'), { activo: true, sucursalesAutorizadas: ['suc_99'], alcanceNacional: false });
      await setDoc(doc(db, 'Colaboradores', 'sup_in'), { role: 'supervisor' });
      await setDoc(doc(db, 'AlcancesOperativos', 'sup_in'), { activo: true, sucursalesAutorizadas: ['suc_1'], alcanceNacional: false });
      await setDoc(doc(db, 'Colaboradores', 'sup_out'), { role: 'supervisor' });
      await setDoc(doc(db, 'AlcancesOperativos', 'sup_out'), { activo: true, sucursalesAutorizadas: ['suc_99'], alcanceNacional: false });
      await setDoc(doc(db, 'Colaboradores', 'rrhh_1'), { role: 'rrhh' });
      await setDoc(doc(db, 'Colaboradores', 'guardia_1'), { role: 'worker' });
      await setDoc(doc(db, 'Colaboradores', 'colab_x'), { role: 'worker' });

      // Preparar asistencias base
      await setDoc(doc(db, 'TurnosProgramados', 'tp_1'), { sucursalId: 'suc_1' });
      await setDoc(doc(db, 'Asistencia', 'att_1'), { 
        employeeId: 'colab_x', 
        type: 'check_in', 
        status: 'open', 
        estado: 'ABIERTO', 
        turnoProgramadoId: 'tp_1', 
        timestamp: '2026-07-20T10:00:00Z',
        localDate: '2026-07-20'
      });
      await setDoc(doc(db, 'Asistencia', 'att_no_site'), {
        employeeId: 'colab_x',
        type: 'check_in',
        status: 'open',
        estado: 'ABIERTO',
        timestamp: '2026-07-20T10:00:00Z'
      });
      await setDoc(doc(db, 'programacion', 'prog_1'), { siteId: 'suc_2' });
      await setDoc(doc(db, 'Asistencia', 'att_prog'), {
        employeeId: 'colab_x',
        type: 'check_in',
        status: 'open',
        estado: 'ABIERTO',
        shiftId: 'prog_1',
        timestamp: '2026-07-20T10:00:00Z'
      });
      // Sesión posterior
      await setDoc(doc(db, 'Asistencia', 'att_old'), {
        employeeId: 'colab_x',
        type: 'check_in',
        status: 'open',
        estado: 'ABIERTO',
        timestamp: '2026-07-19T10:00:00Z'
      });
      // Ya tiene una sesion abierta posterior que es att_1 (que tiene fecha 20)
    });
  });

  function createDummyToken(uid: string) {
    const header = Buffer.from(JSON.stringify({ alg: 'none', type: 'JWT' })).toString('base64');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://securetoken.google.com/demo-ggss',
      aud: 'demo-ggss',
      auth_time: Math.floor(Date.now() / 1000),
      user_id: uid,
      sub: uid,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { identities: {}, sign_in_provider: 'custom' }
    })).toString('base64');
    return `${header}.${payload}.`;
  }

  async function callFunction(uid: string | null, payload: any) {
    const url = 'http://127.0.0.1:5001/demo-ggss/us-central1/forceCloseAttendanceValidated';
    const headers: any = { 'Content-Type': 'application/json' };
    if (uid) {
      headers['Authorization'] = `Bearer ${createDummyToken(uid)}`;
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: payload })
      });
      return await response.json();
    } catch (e: any) {
      return { error: { message: e.message } };
    }
  }

  it('1. Admin cierra correctamente', async () => {
    const res = await callFunction('admin_1', { attendanceId: 'att_1', requestId: 'req_1' });
    expect(res.error).toBeUndefined();
    expect(res.result.success).toBe(true);

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const attOut = await getDoc(doc(db, 'Asistencia', res.result.checkOutId));
      expect(attOut.exists()).toBe(true);
      expect(attOut.data()?.type).toBe('check_out');

      const auditId = `attendance_force_closed_att_1`;
      const auditOut = await getDoc(doc(db, 'AuditoriaAcciones', auditId));
      expect(auditOut.exists()).toBe(true);
      expect(auditOut.data()?.actorId).toBe('admin_1');
      expect(auditOut.data()?.sucursalResolution).toBe('TurnosProgramados');

      const tokenId = `forceClose_admin_1_req_1`;
      const tokenOut = await getDoc(doc(db, 'OperationTokens', tokenId));
      expect(tokenOut.exists()).toBe(true);
      expect(tokenOut.data()?.status).toBe('success');
    });
  });

  it('2. Jefe de operaciones dentro de alcance', async () => {
    const res = await callFunction('jefe_in', { attendanceId: 'att_1', requestId: 'req_2' });
    expect(res.error).toBeUndefined();
  });

  it('3. Jefe de operaciones fuera de alcance', async () => {
    const res = await callFunction('jefe_out', { attendanceId: 'att_1', requestId: 'req_3' });
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain('Sin alcance');
  });

  it('4. Supervisor dentro de alcance', async () => {
    const res = await callFunction('sup_in', { attendanceId: 'att_1', requestId: 'req_4' });
    expect(res.error).toBeUndefined();
  });

  it('5. Supervisor fuera de alcance', async () => {
    const res = await callFunction('sup_out', { attendanceId: 'att_1', requestId: 'req_5' });
    expect(res.error).toBeDefined();
    expect(res.error.status).toBe('PERMISSION_DENIED');
  });

  it('6. RRHH y Guardia rechazados', async () => {
    const res1 = await callFunction('rrhh_1', { attendanceId: 'att_1', requestId: 'req_6a' });
    expect(res1.error).toBeDefined();
    expect(res1.error.status).toBe('PERMISSION_DENIED');
    const res2 = await callFunction('guardia_1', { attendanceId: 'att_1', requestId: 'req_6b' });
    expect(res2.error).toBeDefined();
  });

  it('7. No autenticado', async () => {
    const res = await callFunction(null, { attendanceId: 'att_1', requestId: 'req_7' });
    expect(res.error.status).toBe('UNAUTHENTICATED');
  });

  it('8. Asistencia inexistente', async () => {
    const res = await callFunction('admin_1', { attendanceId: 'att_none', requestId: 'req_8' });
    expect(res.error.status).toBe('NOT_FOUND');
  });

  it('9. Idempotencia: Repetir el mismo requestId', async () => {
    const res1 = await callFunction('admin_1', { attendanceId: 'att_1', requestId: 'req_idem_1', note: 'test' });
    expect(res1.error).toBeUndefined();
    const checkOutId = res1.result.checkOutId;

    const res2 = await callFunction('admin_1', { attendanceId: 'att_1', requestId: 'req_idem_1', note: 'test' });
    expect(res2.error).toBeUndefined();
    expect(res2.result.checkOutId).toBe(checkOutId);
  });

  it('10. Idempotencia: Repetir requestId con payload diferente falla', async () => {
    const res1 = await callFunction('admin_1', { attendanceId: 'att_1', requestId: 'req_idem_2', note: 'test' });
    const res2 = await callFunction('admin_1', { attendanceId: 'att_1', requestId: 'req_idem_2', note: 'different' });
    expect(res2.error).toBeDefined();
    expect(res2.error.message).toBe('request_id_reused');
  });

  it('11. Resolución desde programacion', async () => {
    const res = await callFunction('admin_1', { attendanceId: 'att_prog', requestId: 'req_prog_1' });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const audit = await getDoc(doc(db, 'AuditoriaAcciones', 'attendance_force_closed_att_prog'));
      expect(audit.data()?.sucursalResolution).toBe('programacion');
      expect(audit.data()?.sucursalId).toBe('suc_2');
    });
  });

  it('12. Sucursal no determinada rechaza no-globales', async () => {
    const res = await callFunction('sup_in', { attendanceId: 'att_no_site', requestId: 'req_nosite_1' });
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain('sin sucursal determinada');
  });

  it('13. Sucursal no determinada permite admin', async () => {
    const res = await callFunction('admin_1', { attendanceId: 'att_no_site', requestId: 'req_nosite_2' });
    expect(res.error).toBeUndefined();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const audit = await getDoc(doc(db, 'AuditoriaAcciones', 'attendance_force_closed_att_no_site'));
      expect(audit.data()?.sucursalResolution).toBe('unresolved');
      expect(audit.data()?.sucursalId).toBeNull();
    });
  });

  it('14. forceLogout omitido si hay sesión posterior activa', async () => {
    // att_old es de ayer, pero hoy tiene att_1 abierta.
    const res = await callFunction('admin_1', { attendanceId: 'att_old', requestId: 'req_old_1' });
    expect(res.error).toBeUndefined();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const colab = await getDoc(doc(db, 'Colaboradores', 'colab_x'));
      // No debería tener forceLogout = true recién seteado
      expect(colab.data()?.forceLogout).not.toBe(true);
    });
  });

  it('15. forceLogout aplicado si no hay sesión posterior', async () => {
    // att_1 es la más reciente. La cerramos.
    const res = await callFunction('admin_1', { attendanceId: 'att_1', requestId: 'req_latest_1' });
    expect(res.error).toBeUndefined();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const colab = await getDoc(doc(db, 'Colaboradores', 'colab_x'));
      expect(colab.data()?.forceLogout).toBe(true);
    });
  });
});
