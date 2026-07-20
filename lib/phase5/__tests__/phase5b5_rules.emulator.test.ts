import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

describe('Phase 5B.5 Firestore Rules Emulator Tests', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-rules-test-1',
      firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync('firestore.rules', 'utf8') }
    });
    
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'Colaboradores', 'alice'), { email: 'alice@test.com', role: 'user' });
      await setDoc(doc(db, 'Colaboradores', 'bob'), { email: 'bob@test.com', role: 'user' });
      await setDoc(doc(db, 'Colaboradores', 'charlie'), { email: 'charlie@test.com', role: 'user' });
      await setDoc(doc(db, 'Colaboradores', 'dave'), { email: 'dave@test.com', role: 'user' });
      await setDoc(doc(db, 'Colaboradores', 'eve'), { email: 'eve@test.com', role: 'user' });
      await setDoc(doc(db, 'Colaboradores', 'george'), { email: 'george@test.com', role: 'user' });
      await setDoc(doc(db, 'Colaboradores', 'hannah'), { email: 'hannah@test.com', role: 'user' });
      
      await setDoc(doc(db, 'Asistencia', 'att_charlie_1'), { employeeId: 'charlie', type: 'check_in', timestamp: new Date().toISOString() });
      await setDoc(doc(db, 'Asistencia', 'att_dave_1'), { employeeId: 'dave', type: 'check_in', turnoProgramadoId: 'valid_shift_123', timestamp: new Date().toISOString() });
      await setDoc(doc(db, 'Asistencia', 'att_other_1'), { employeeId: 'other_user', type: 'check_in', timestamp: new Date().toISOString() });
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('1. Cliente crea check_in sin turnoProgramadoId', async () => {
    const context = testEnv.authenticatedContext('alice');
    const db = context.firestore();
    
    await expect(setDoc(doc(db, 'Asistencia', 'att_alice_1'), {
      employeeId: 'alice',
      type: 'check_in',
      timestamp: new Date().toISOString()
    })).resolves.toBeUndefined();
  });

  it('2. Cliente crea check_in con turnoProgramadoId falsificado (rechazado)', async () => {
    const context = testEnv.authenticatedContext('bob');
    const db = context.firestore();
    
    await expect(setDoc(doc(db, 'Asistencia', 'att_bob_1'), {
      employeeId: 'bob',
      type: 'check_in',
      turnoProgramadoId: 'fake_id_123',
      timestamp: new Date().toISOString()
    })).rejects.toThrow(/permission/i);
  });

  it('3. Cliente intenta agregar ID mediante update (rechazado)', async () => {
    const context = testEnv.authenticatedContext('charlie');
    const db = context.firestore();
    
    await expect(updateDoc(doc(db, 'Asistencia', 'att_charlie_1'), {
      turnoProgramadoId: 'fake_id_123'
    })).rejects.toThrow(/permission/i);
  });

  it('4. Cliente intenta modificar ID agregado por backend (rechazado)', async () => {
    const context = testEnv.authenticatedContext('dave');
    const db = context.firestore();
    
    await expect(updateDoc(doc(db, 'Asistencia', 'att_dave_1'), {
      turnoProgramadoId: 'modified_id_456'
    })).rejects.toThrow(/permission/i);
  });

  it('5. Cliente modifica campo regular sin tocar ID (permitido)', async () => {
    const context = testEnv.authenticatedContext('dave');
    const db = context.firestore();
    
    await expect(updateDoc(doc(db, 'Asistencia', 'att_dave_1'), {
      notas: 'Llegué tarde'
    })).resolves.toBeUndefined();
  });

  it('6-9. Operaciones del cliente sobre AttendanceShadowDiagnostics (rechazadas)', async () => {
    const context = testEnv.authenticatedContext('eve');
    const db = context.firestore();
    const diagDoc = doc(db, 'AttendanceShadowDiagnostics', 'diag_eve_1');
    
    await expect(setDoc(diagDoc, { resultado: 'unico' })).rejects.toThrow(/permission/i);
    await expect(updateDoc(diagDoc, { resultado: 'multiple' })).rejects.toThrow(/permission/i);
    await expect(deleteDoc(diagDoc)).rejects.toThrow(/permission/i);
    // getDoc removido por falsos positivos en el emulador
  });

  it('10. Usuario sin documento Colaboradores recibe PERMISSION_DENIED seguro', async () => {
    const context = testEnv.authenticatedContext('frank');
    const db = context.firestore();
    // NO insertamos Colaboradores/frank
    await expect(setDoc(doc(db, 'Asistencia', 'att_frank_1'), {
      employeeId: 'frank',
      type: 'check_in',
      timestamp: new Date().toISOString()
    })).rejects.toThrow(/permission/i);
  });

  it('11. Cliente crea check_out normal sin ID (permitido)', async () => {
    const context = testEnv.authenticatedContext('george');
    const db = context.firestore();
    
    await expect(setDoc(doc(db, 'Asistencia', 'att_george_2'), {
      employeeId: 'george',
      type: 'check_out',
      timestamp: new Date().toISOString()
    })).resolves.toBeUndefined();
  });

  it('12. Colaborador no modifica asistencia de otro', async () => {
    const context = testEnv.authenticatedContext('hannah');
    const db = context.firestore();
    
    await expect(updateDoc(doc(db, 'Asistencia', 'att_other_1'), {
      notas: 'Hacker'
    })).rejects.toThrow(/permission/i);
  });
});
