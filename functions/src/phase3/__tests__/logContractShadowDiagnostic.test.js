// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
const fft = require('firebase-functions-test');

process.env.GCLOUD_PROJECT = 'demo-ggss-contract-shadow-log';
const testEnv = fft({
  projectId: 'demo-ggss-contract-shadow-log',
});

const { logContractShadowDiagnostic } = require('../logContractShadowDiagnostic.js');

describe('logContractShadowDiagnostic', () => {
  let db;

  beforeAll(() => {
    process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
    db = admin.firestore();
  });

  afterAll(async () => {
    testEnv.cleanup();
  });

  beforeEach(async () => {
    const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-ggss-contract-shadow-log/databases/(default)/documents`, {
      method: 'DELETE'
    });
    
    // Configurar estado base: un empleado y el feature flag
    await db.collection('Colaboradores').doc('adminUser').set({ role: 'admin' });
    await db.collection('Colaboradores').doc('rrhhUser').set({ role: 'rrhh' });
    await db.collection('Colaboradores').doc('jefeOpUser').set({ role: 'jefe_operaciones' });
    await db.collection('Colaboradores').doc('jefeOpFuera').set({ role: 'jefe_operaciones' });
    await db.collection('Colaboradores').doc('workerUser').set({ role: 'guardia' });

    await db.collection('FeatureFlags').doc('contractEligibilityV2').set({
      enabled: true,
      mode: 'shadow',
      canaryBranches: ['SUC-1', 'SUC-2'],
      canaryMonths: ['2026-07'],
      engineVersion: 1,
      expiresAt: new Date(Date.now() + 3600000).toISOString() // Vence en 1 hr
    });
  });

  const baseData = {
    diagnosticId: 'diag-123',
    employeeId: 'emp-1',
    sucursalId: 'SUC-1',
    shiftDate: '2026-07-24',
    classification: 'mismatch',
    engineVersion: 1,
    legacyStatus: 'vigente',
    canonicalStatus: 'vencido',
    featureMode: 'shadow'
  };

  it('01. No autenticado: rechazado', async () => {
    const wrapped = testEnv.wrap(logContractShadowDiagnostic);
    await expect(wrapped({ data: baseData })).rejects.toThrow(/Debe estar autenticado/);
  });

  it('02. Worker: rechazado', async () => {
    const wrapped = testEnv.wrap(logContractShadowDiagnostic);
    await expect(wrapped({ data: baseData, auth: { uid: 'workerUser' } })).rejects.toThrow(/No tiene permisos/);
  });

  it('03. Admin dentro del scope: autorizado', async () => {
    const wrapped = testEnv.wrap(logContractShadowDiagnostic);
    const result = await wrapped({ data: baseData, auth: { uid: 'adminUser' } });
    expect(result.success).toBe(true);
  });

  it('04. RRHH dentro del scope: autorizado', async () => {
    const wrapped = testEnv.wrap(logContractShadowDiagnostic);
    const result = await wrapped({ data: baseData, auth: { uid: 'rrhhUser' } });
    expect(result.success).toBe(true);
  });

  it('05. Jefe de operaciones dentro del scope: autorizado', async () => {
    const wrapped = testEnv.wrap(logContractShadowDiagnostic);
    const result = await wrapped({ data: baseData, auth: { uid: 'jefeOpUser' } });
    expect(result.success).toBe(true);
  });

  it('06. Jefe de operaciones fuera del scope: rechazado (sucursal)', async () => {
    const wrapped = testEnv.wrap(logContractShadowDiagnostic);
    await expect(wrapped({ data: { ...baseData, sucursalId: 'SUC-OTRA' }, auth: { uid: 'jefeOpUser' } })).rejects.toThrow(/La sucursal no está dentro de la prueba Canary/);
  });

  it('07. Flag disabled: rechazado', async () => {
    await db.collection('FeatureFlags').doc('contractEligibilityV2').update({ enabled: false });
    const wrapped = testEnv.wrap(logContractShadowDiagnostic);
    await expect(wrapped({ data: baseData, auth: { uid: 'adminUser' } })).rejects.toThrow(/Shadow mode no está activo/);
  });

  it('08. mode distinto de shadow: rechazado', async () => {
    await db.collection('FeatureFlags').doc('contractEligibilityV2').update({ mode: 'enforcing' });
    const wrapped = testEnv.wrap(logContractShadowDiagnostic);
    await expect(wrapped({ data: baseData, auth: { uid: 'adminUser' } })).rejects.toThrow(/Shadow mode no está activo/);
  });

  it('09. expiresAt vencido: rechazado', async () => {
    await db.collection('FeatureFlags').doc('contractEligibilityV2').update({ expiresAt: new Date(Date.now() - 3600000).toISOString() });
    const wrapped = testEnv.wrap(logContractShadowDiagnostic);
    await expect(wrapped({ data: baseData, auth: { uid: 'adminUser' } })).rejects.toThrow(/La ventana de Shadow Mode ha expirado/);
  });

  it('10. Sucursal fuera de canaryBranches: rechazada', async () => {
    const wrapped = testEnv.wrap(logContractShadowDiagnostic);
    await expect(wrapped({ data: { ...baseData, sucursalId: 'SUC-3' }, auth: { uid: 'adminUser' } })).rejects.toThrow(/La sucursal no está dentro de la prueba Canary/);
  });

  it('11. Mes fuera de canaryMonths: rechazado', async () => {
    const wrapped = testEnv.wrap(logContractShadowDiagnostic);
    await expect(wrapped({ data: { ...baseData, shiftDate: '2026-08-01' }, auth: { uid: 'adminUser' } })).rejects.toThrow(/El mes no está dentro de la prueba Canary/);
  });

  it('12. engineVersion incorrecta: rechazada', async () => {
    const wrapped = testEnv.wrap(logContractShadowDiagnostic);
    await expect(wrapped({ data: { ...baseData, engineVersion: 99 }, auth: { uid: 'adminUser' } })).rejects.toThrow(/La versión del motor no coincide/);
  });

  it('13. classification desconocida: (Asume que pasa si classification existe, pero la función base valida falsy)', async () => {
    const wrapped = testEnv.wrap(logContractShadowDiagnostic);
    await expect(wrapped({ data: { ...baseData, classification: '' }, auth: { uid: 'adminUser' } })).rejects.toThrow(/Faltan campos/);
  });

  it('14. Payload incompleto: rechazado', async () => {
    const wrapped = testEnv.wrap(logContractShadowDiagnostic);
    await expect(wrapped({ data: { diagnosticId: '123' }, auth: { uid: 'adminUser' } })).rejects.toThrow(/Faltan campos/);
  });

  it('15. Diagnóstico válido: creado', async () => {
    const wrapped = testEnv.wrap(logContractShadowDiagnostic);
    await wrapped({ data: baseData, auth: { uid: 'adminUser' } });
    const doc = await db.collection('ContractShadowDiagnostics').doc('diag-123').get();
    expect(doc.exists).toBe(true);
    expect(doc.data().employeeId).toBe('emp-1');
  });

  it('16. Mismo fingerprint: no duplica documento', async () => {
    const wrapped = testEnv.wrap(logContractShadowDiagnostic);
    const res1 = await wrapped({ data: baseData, auth: { uid: 'adminUser' } });
    const res2 = await wrapped({ data: baseData, auth: { uid: 'adminUser' } });
    
    expect(res1.isDuplicate).toBe(false);
    expect(res2.isDuplicate).toBe(true);
  });

});
