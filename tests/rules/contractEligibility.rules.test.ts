// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  initializeTestEnvironment,
  RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import { setDoc, doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

describe('Firestore Rules - contractEligibilityV2 & ContractShadowDiagnostics', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    // 1. Cargar firestore.rules
    const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');

    // 2. Inicializar entorno de pruebas apuntando al emulador local
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-ggss-contract-shadow',
      firestore: {
        rules: rules,
        host: '127.0.0.1',
        port: 8080, // Puerto por defecto del emulador
      }
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    
    // Configurar roles en DB usando contexto admin (sin reglas)
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'Colaboradores', 'adminUser'), { role: 'admin' });
      await setDoc(doc(db, 'Colaboradores', 'rrhhUser'), { role: 'rrhh' });
      await setDoc(doc(db, 'Colaboradores', 'jefeOpUser'), { role: 'jefe_operaciones' });
      await setDoc(doc(db, 'Colaboradores', 'supervisorUser'), { role: 'supervisor' });
      await setDoc(doc(db, 'Colaboradores', 'workerUser'), { role: 'guardia' });

      // Crear el feature flag
      await setDoc(doc(db, 'FeatureFlags', 'contractEligibilityV2'), { enabled: true });
      await setDoc(doc(db, 'ContractShadowDiagnostics', 'diag-1'), { classification: 'mismatch' });
    });
  });

  // FeatureFlags/contractEligibilityV2

  it('01. Admin puede hacer get del flag exacto', async () => {
    const db = testEnv.authenticatedContext('adminUser').firestore();
    await expect(getDoc(doc(db, 'FeatureFlags', 'contractEligibilityV2'))).resolves.not.toThrow();
  });

  it('02. RRHH puede hacer get del flag exacto', async () => {
    const db = testEnv.authenticatedContext('rrhhUser').firestore();
    await expect(getDoc(doc(db, 'FeatureFlags', 'contractEligibilityV2'))).resolves.not.toThrow();
  });

  it('03. Jefe de operaciones puede hacer get del flag exacto', async () => {
    const db = testEnv.authenticatedContext('jefeOpUser').firestore();
    await expect(getDoc(doc(db, 'FeatureFlags', 'contractEligibilityV2'))).resolves.not.toThrow();
  });

  it('04. Supervisor puede hacer get del flag exacto', async () => {
    const db = testEnv.authenticatedContext('supervisorUser').firestore();
    await expect(getDoc(doc(db, 'FeatureFlags', 'contractEligibilityV2'))).resolves.not.toThrow();
  });

  it('05. Worker no puede leer el flag', async () => {
    const db = testEnv.authenticatedContext('workerUser').firestore();
    await expect(getDoc(doc(db, 'FeatureFlags', 'contractEligibilityV2'))).rejects.toThrow(/false for 'get'/);
  });

  it('06. No autenticado no puede leer el flag', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await expect(getDoc(doc(db, 'FeatureFlags', 'contractEligibilityV2'))).rejects.toThrow(/false for 'get'/);
  });

  it('08. Ningún cliente puede crear el flag', async () => {
    const db = testEnv.authenticatedContext('adminUser').firestore();
    await expect(setDoc(doc(db, 'FeatureFlags', 'contractEligibilityV2'), {})).rejects.toThrow(/false for 'create'/);
  });

  it('09. Ningún cliente puede actualizar el flag', async () => {
    const db = testEnv.authenticatedContext('adminUser').firestore();
    await expect(updateDoc(doc(db, 'FeatureFlags', 'contractEligibilityV2'), { enabled: false })).rejects.toThrow(/false for 'update'/);
  });

  it('10. Ningún cliente puede eliminar el flag', async () => {
    const db = testEnv.authenticatedContext('adminUser').firestore();
    await expect(deleteDoc(doc(db, 'FeatureFlags', 'contractEligibilityV2'))).rejects.toThrow(/false for 'delete'/);
  });

  // ContractShadowDiagnostics

  it('11. Admin no puede leer ContractShadowDiagnostics desde cliente', async () => {
    const db = testEnv.authenticatedContext('adminUser').firestore();
    await expect(getDoc(doc(db, 'ContractShadowDiagnostics', 'diag-1'))).rejects.toThrow(/false for 'get'/);
  });

  it('12. RRHH no puede leer ContractShadowDiagnostics', async () => {
    const db = testEnv.authenticatedContext('rrhhUser').firestore();
    await expect(getDoc(doc(db, 'ContractShadowDiagnostics', 'diag-1'))).rejects.toThrow(/false for 'get'/);
  });

  it('13. Ningún cliente puede escribir ContractShadowDiagnostics', async () => {
    const db = testEnv.authenticatedContext('adminUser').firestore();
    await expect(setDoc(doc(db, 'ContractShadowDiagnostics', 'diag-2'), {})).rejects.toThrow(/false for 'create'/);
  });

});
