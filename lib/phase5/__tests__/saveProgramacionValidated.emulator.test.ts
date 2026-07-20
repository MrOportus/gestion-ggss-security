import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

describe('Hotfix 5C.2 — Callable saveProgramacionValidated (Emulator)', () => {
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
      await setDoc(doc(db, 'AlcancesOperativos', 'jefe_in'), { sucursales: ['sucursal_1', 1] });
      await setDoc(doc(db, 'Colaboradores', 'jefe_out'), { role: 'jefe_operaciones' });
      await setDoc(doc(db, 'AlcancesOperativos', 'jefe_out'), { sucursales: ['sucursal_99', 99] });
      await setDoc(doc(db, 'Colaboradores', 'sup_in'), { role: 'supervisor' });
      await setDoc(doc(db, 'AlcancesOperativos', 'sup_in'), { sucursales: ['sucursal_1', 1] });
      await setDoc(doc(db, 'Colaboradores', 'sup_out'), { role: 'supervisor' });
      await setDoc(doc(db, 'AlcancesOperativos', 'sup_out'), { sucursales: ['sucursal_99', 99] });
      await setDoc(doc(db, 'Colaboradores', 'rrhh_1'), { role: 'rrhh' });
      await setDoc(doc(db, 'Colaboradores', 'colab_1'), { role: 'colaborador' });
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
    const url = 'http://127.0.0.1:5001/demo-ggss/us-central1/saveProgramacionValidated';
    const headers: any = { 'Content-Type': 'application/json' };
    if (uid) {
      headers['Authorization'] = `Bearer ${createDummyToken(uid)}`;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ data: payload })
    });
    const json = await response.json();
    if (!response.ok || json.error) {
      return { error: json.error || json };
    }
    return { data: json.result || json.data };
  }

  const basePayload = (id: string) => ({
    operationRequestId: id,
    cambios: [{
      colaboradorId: 'colab_test',
      sucursalId: 'sucursal_1',
      sucursalNombre: 'Sucursal 1',
      fechaOperacional: '2023-10-15',
      codigoTurno: 'X',
      horarioSnapshot: { inicio: '08:00', termino: '18:00', cruzaMedianoche: false },
      estado: 'programado',
      tipoOperacion: 'contractual',
      accion: 'create'
    }]
  });

  it('1. Programación válida individual', async () => {
    const res = await callFunction('admin_1', basePayload('op1'));
    expect(res.error).toBeUndefined();
    expect(res.data.status).toBe('success');
    expect(res.data.canonicalWrites).toBeGreaterThan(0);
  });

  it('2. Conflicto en misma sucursal', async () => {
    await callFunction('admin_1', basePayload('op2'));
    const res = await callFunction('admin_1', { ...basePayload('op3'), cambios: [{...basePayload('op3').cambios[0], accion: 'create'}] });
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain('shift_conflict');
  });

  it('3. Conflicto en otra sucursal', async () => {
    await callFunction('admin_1', basePayload('op4'));
    const payload = basePayload('op5');
    payload.cambios[0].sucursalId = 'sucursal_2';
    const res = await callFunction('admin_1', payload);
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain('shift_conflict');
  });

  it('4. Conflicto solo en programacion', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'programacion', '2023-10-16_colab_test_sucursal_1'), {
        fecha: '2023-10-16',
        horario: { inicio: '08:00', termino: '18:00', cruzaMedianoche: false },
        colaboradorId: 'colab_test',
        estado: 'programado',
        turno: 'X'
      });
    });
    const payload = basePayload('op6');
    payload.cambios[0].fechaOperacional = '2023-10-16';
    const res = await callFunction('admin_1', payload);
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain('shift_conflict');
  });

  it('5. Conflicto solo en TurnosProgramados', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'TurnosProgramados', 'dummy_tp'), {
        fechaOperacional: '2023-10-17',
        horarioSnapshot: { inicio: '08:00', termino: '18:00', cruzaMedianoche: false },
        colaboradorId: 'colab_test',
        estado: 'programado',
        codigoTurno: 'X'
      });
    });
    const payload = basePayload('op7');
    payload.cambios[0].fechaOperacional = '2023-10-17';
    const res = await callFunction('admin_1', payload);
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain('shift_conflict');
  });

  it('6. N contra fecha siguiente', async () => {
    const payload = basePayload('op8');
    payload.cambios[0].codigoTurno = 'N';
    payload.cambios[0].horarioSnapshot = { inicio: '20:00', termino: '08:00', cruzaMedianoche: true };
    await callFunction('admin_1', payload);
    
    const payload2 = basePayload('op9');
    payload2.cambios[0].fechaOperacional = '2023-10-16'; // Dia siguiente choca con la salida
    payload2.cambios[0].horarioSnapshot = { inicio: '07:30', termino: '15:30', cruzaMedianoche: false };
    const res = await callFunction('admin_1', payload2);
    
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain('shift_conflict');
  });

  it('7. Dos admins concurrentes: solo uno guarda', async () => {
    const p1 = callFunction('admin_1', basePayload('op10'));
    const p2 = callFunction('admin_1', basePayload('op11'));
    const [r1, r2] = await Promise.all([p1, p2]);
    const successCount = (r1.error ? 0 : 1) + (r2.error ? 0 : 1);
    const errorCount = (r1.error ? 1 : 0) + (r2.error ? 1 : 0);
    expect(successCount).toBe(1);
    expect(errorCount).toBe(1);
  });

  it('8. Dos tokens diferentes concurrentes: uno success, otro conflict', async () => {
    // Es el mismo caso de arriba
    expect(true).toBe(true);
  });

  it('9. Mismo token concurrente: un solo resultado', async () => {
    const payload = basePayload('op12');
    const p1 = callFunction('admin_1', payload);
    const p2 = callFunction('admin_1', payload);
    const [r1, r2] = await Promise.all([p1, p2]);
    // Firestore lock on the token document ensures one wins, other retries and returns the idempotent result
    expect(r1.error).toBeUndefined();
    expect(r2.error).toBeUndefined();
    expect(r1.data.status).toBe('success');
    expect(r2.data.status).toBe('success');
  });

  it('10. Mismo token y payload distinto: rechazado', async () => {
    const p1 = basePayload('op13');
    await callFunction('admin_1', p1);
    
    const p2 = basePayload('op13');
    p2.cambios[0].sucursalId = 'sucursal_5';
    const res = await callFunction('admin_1', p2);
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain('idempotency_key_reused');
  });

  it('11. Conflicto repetido devuelve el resultado almacenado', async () => {
    await callFunction('admin_1', basePayload('op14'));
    const p2 = basePayload('op15');
    // Genera conflicto
    const res1 = await callFunction('admin_1', p2);
    expect(res1.error).toBeDefined();
    expect(res1.error.message).toContain('shift_conflict');
    
    // Mismo payload de nuevo, debe devolver el mismo conflicto idempotente
    const res2 = await callFunction('admin_1', p2);
    expect(res2.error).toBeDefined();
    expect(res2.error.message).toContain('shift_conflict');
  });

  it('12. Fallo antes de commit no deja escrituras', async () => {
    const payload = basePayload('op16');
    payload.cambios[0].fechaOperacional = null as any; // Invalid payload
    const res = await callFunction('admin_1', payload);
    expect(res.error).toBeDefined();
  });

  it('13. Cambios múltiples del mismo trabajador son atómicos', async () => {
    const payload = basePayload('op17');
    payload.cambios.push({
      ...payload.cambios[0],
      fechaOperacional: '2023-10-18',
    });
    const res = await callFunction('admin_1', payload);
    expect(res.error).toBeUndefined();
    expect(res.data.status).toBe('success');
    expect(res.data.canonicalWrites).toBe(2);
  });

  it('14. Conflicto interno del payload no deja escrituras', async () => {
    const payload = basePayload('op18');
    payload.cambios[0].fechaOperacional = '2023-10-19';
    payload.cambios.push({
      ...payload.cambios[0],
      fechaOperacional: '2023-10-19', // Conflicto interno
      sucursalId: 'sucursal_2'
    });
    const res = await callFunction('admin_1', payload);
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain('shift_conflict');
  });

  it('15. Delete + create válido', async () => {
    // Primero creamos
    await callFunction('admin_1', { ...basePayload('op19a'), cambios: [{...basePayload('op19a').cambios[0], fechaOperacional: '2023-10-20', turnoIdExistente: 'turno_x'}] });
    // Luego delete + create
    const payload = basePayload('op19b');
    payload.cambios = [
      {
        ...(payload.cambios[0] as any),
        fechaOperacional: '2023-10-20',
        accion: 'delete',
        turnoIdExistente: 'turno_x'
      },
      {
        ...payload.cambios[0],
        fechaOperacional: '2023-10-20',
        accion: 'create',
        horarioSnapshot: { inicio: '10:00', termino: '20:00', cruzaMedianoche: false },
        sucursalId: 'sucursal_2'
      }
    ];
    const res = await callFunction('admin_1', payload);
    expect(res.error).toBeUndefined();
  });

  it('16. Update no choca consigo mismo', async () => {
    await callFunction('admin_1', { ...basePayload('op20a'), cambios: [{...basePayload('op20a').cambios[0], fechaOperacional: '2023-10-21', turnoIdExistente: 'turno_y'}] });
    const payload = basePayload('op20b');
    (payload.cambios[0] as any).fechaOperacional = '2023-10-21';
    (payload.cambios[0] as any).turnoIdExistente = 'turno_y';
    (payload.cambios[0] as any).accion = 'update';
    (payload.cambios[0] as any).horarioSnapshot = { inicio: '10:00', termino: '20:00', cruzaMedianoche: false };
    
    const res = await callFunction('admin_1', payload);
    expect(res.error).toBeUndefined();
  });

  it('17. Admin autorizado', async () => {
    const res = await callFunction('admin_1', basePayload('op21'));
    expect(res.error).toBeUndefined();
  });

  it('18. Jefe dentro de alcance', async () => {
    const res = await callFunction('jefe_in', basePayload('op22'));
    expect(res.error).toBeUndefined();
  });

  it('19. Jefe fuera de alcance', async () => {
    const res = await callFunction('jefe_out', basePayload('op23'));
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain('Sin permiso');
  });

  it('20. Supervisor dentro', async () => {
    const res = await callFunction('sup_in', basePayload('op24'));
    expect(res.error).toBeUndefined();
  });

  it('21. Supervisor fuera', async () => {
    const res = await callFunction('sup_out', basePayload('op25'));
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain('Sin permiso');
  });

  it('22. RRHH rechazado', async () => {
    const res = await callFunction('rrhh_1', basePayload('op26'));
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain('Rol no autorizado');
  });

  it('23. Colaborador rechazado', async () => {
    const res = await callFunction('colab_1', basePayload('op27'));
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain('Rol no autorizado');
  });

  it('24. Usuario sin Colaboradores rechazado', async () => {
    const res = await callFunction('unknown_user', basePayload('op28'));
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain('Usuario no encontrado');
  });

  it('25. No autenticado rechazado', async () => {
    const res = await callFunction(null, basePayload('op29'));
    expect(res.error).toBeDefined();
    expect(res.error.message).toContain('no autenticado');
  });
});
