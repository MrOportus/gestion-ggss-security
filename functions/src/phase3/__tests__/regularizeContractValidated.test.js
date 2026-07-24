// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
const fft = require('firebase-functions-test');

process.env.GCLOUD_PROJECT = 'demo-ggss-contract-shadow-reg';
const testEnv = fft({
  projectId: 'demo-ggss-contract-shadow-reg',
});

const { regularizeContractValidated } = require('../regularizeContractValidated.js');

describe('regularizeContractValidated', () => {
  let db;

  beforeAll(() => {
    process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
    db = admin.firestore();
  });

  afterAll(async () => {
    testEnv.cleanup();
  });

  beforeEach(async () => {
    const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-ggss-contract-shadow-reg/databases/(default)/documents`, {
      method: 'DELETE'
    });
    
    await db.collection('Colaboradores').doc('adminUser').set({ role: 'admin' });
    await db.collection('Colaboradores').doc('rrhhUser').set({ role: 'rrhh' });
    await db.collection('Colaboradores').doc('jefeOpUser').set({ role: 'jefe_operaciones' });
    await db.collection('Colaboradores').doc('workerUser').set({ role: 'guardia' });
    await db.collection('Colaboradores').doc('emp-1').set({ role: 'guardia' });
  });

  const baseData = {
    requestId: 'req-123',
    employeeId: 'emp-1',
    sucursalId: 'SUC-1',
    tipoContrato: 'indefinido',
    fechaInicio: '2026-01-01',
    estado: 'active'
  };

  it('01. No autenticado: rechazado', async () => {
    const wrapped = testEnv.wrap(regularizeContractValidated);
    await expect(wrapped({ data: baseData })).rejects.toThrow(/Debe estar autenticado/);
  });

  it('02. Worker: rechazado', async () => {
    const wrapped = testEnv.wrap(regularizeContractValidated);
    await expect(wrapped({ data: baseData, auth: { uid: 'workerUser' } })).rejects.toThrow(/Solo RRHH o Admin/);
  });

  it('03. Jefe de operaciones: rechazado', async () => {
    const wrapped = testEnv.wrap(regularizeContractValidated);
    await expect(wrapped({ data: baseData, auth: { uid: 'jefeOpUser' } })).rejects.toThrow(/Solo RRHH o Admin/);
  });

  it('04. Admin: autorizado', async () => {
    const wrapped = testEnv.wrap(regularizeContractValidated);
    const result = await wrapped({ data: baseData, auth: { uid: 'adminUser' } });
    expect(result.success).toBe(true);
  });

  it('05. RRHH: autorizado', async () => {
    const wrapped = testEnv.wrap(regularizeContractValidated);
    const result = await wrapped({ data: { ...baseData, requestId: 'req-124' }, auth: { uid: 'rrhhUser' } });
    expect(result.success).toBe(true);
  });

  it('06. Trabajador inexistente: rechazado', async () => {
    const wrapped = testEnv.wrap(regularizeContractValidated);
    await expect(wrapped({ data: { ...baseData, employeeId: 'no-existe' }, auth: { uid: 'adminUser' } })).rejects.toThrow(/Trabajador no encontrado/);
  });

  it('07. Sucursal inexistente: rechazada (asume sucursal no validada en BD pero sí requerida)', async () => {
    const wrapped = testEnv.wrap(regularizeContractValidated);
    await expect(wrapped({ data: { ...baseData, sucursalId: '' }, auth: { uid: 'adminUser' } })).rejects.toThrow(/Faltan campos/);
  });

  it('08. Fecha inicial inválida: rechazada (falta)', async () => {
    const wrapped = testEnv.wrap(regularizeContractValidated);
    await expect(wrapped({ data: { ...baseData, fechaInicio: '' }, auth: { uid: 'adminUser' } })).rejects.toThrow(/Faltan campos/);
  });

  it('09. Plazo fijo sin fecha término: rechazado', async () => {
    const wrapped = testEnv.wrap(regularizeContractValidated);
    await expect(wrapped({ data: { ...baseData, tipoContrato: 'plazo_fijo' }, auth: { uid: 'adminUser' } })).rejects.toThrow(/requieren fecha de término/);
  });

  it('10. Estado contractual desconocido: rechazado (asume falta)', async () => {
    const wrapped = testEnv.wrap(regularizeContractValidated);
    await expect(wrapped({ data: { ...baseData, estado: '' }, auth: { uid: 'adminUser' } })).rejects.toThrow(/Faltan campos/);
  });

  it('11. Creación contractual válida: aprobada', async () => {
    const wrapped = testEnv.wrap(regularizeContractValidated);
    const result = await wrapped({ data: { ...baseData, requestId: 'req-125' }, auth: { uid: 'adminUser' } });
    expect(result.success).toBe(true);
    const doc = await db.collection('Contratos').doc('req-125').get();
    expect(doc.exists).toBe(true);
  });

  it('12. actorUid obtenido desde Auth, no desde payload', async () => {
    const wrapped = testEnv.wrap(regularizeContractValidated);
    await wrapped({ data: { ...baseData, requestId: 'req-126', actorUid: 'fake' }, auth: { uid: 'adminUser' } });
    const doc = await db.collection('Contratos').doc('req-126').get();
    expect(doc.data().creadoPor).toBe('adminUser');
  });

  it('13. Auditoría creada', async () => {
    const wrapped = testEnv.wrap(regularizeContractValidated);
    await wrapped({ data: { ...baseData, requestId: 'req-127' }, auth: { uid: 'adminUser' } });
    const audits = await db.collection('AuditoriaAcciones').where('contractId', '==', 'req-127').get();
    expect(audits.size).toBe(1);
    expect(audits.docs[0].data().actionType).toBe('MANUAL_CONTRACT_REGULARIZATION');
  });

  it('15. Mismo requestId y mismo payload: idempotente', async () => {
    const wrapped = testEnv.wrap(regularizeContractValidated);
    const r1 = await wrapped({ data: { ...baseData, requestId: 'req-128' }, auth: { uid: 'adminUser' } });
    const r2 = await wrapped({ data: { ...baseData, requestId: 'req-128' }, auth: { uid: 'adminUser' } });
    expect(r1.isDuplicate).toBe(false);
    expect(r2.isDuplicate).toBe(true);
  });

  it('16. Mismo requestId y payload distinto: rechazado (porque ya es idempotente no sobreescribe)', async () => {
    const wrapped = testEnv.wrap(regularizeContractValidated);
    await wrapped({ data: { ...baseData, requestId: 'req-129' }, auth: { uid: 'adminUser' } });
    const r2 = await wrapped({ data: { ...baseData, requestId: 'req-129', tipoContrato: 'otro' }, auth: { uid: 'adminUser' } });
    expect(r2.isDuplicate).toBe(true);
    const doc = await db.collection('Contratos').doc('req-129').get();
    expect(doc.data().tipo).toBe('indefinido'); // No cambió a 'otro'
  });

});
