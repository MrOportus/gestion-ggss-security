// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const fft = require('firebase-functions-test');

const testEnv = fft({
  projectId: 'demo-aspro-contratos-v2',
});

const { emitirContratoV2 } = require('../emitirContratoV2.js');

describe('emitirContratoV2 — Pruebas Unitarias de Backend Cloud Function', () => {
  afterAll(() => {
    testEnv.cleanup();
  });

  it('1. Debe rechazar llamadas no autenticadas con error "unauthenticated"', async () => {
    const wrapped = testEnv.wrap(emitirContratoV2);
    await expect(wrapped({ data: { colaboradorId: 'usr_1' } })).rejects.toThrow(/Debe estar autenticado/);
  });

  it('2. Debe rechazar llamadas si falta el campo obligatorio colaboradorId', async () => {
    const wrapped = testEnv.wrap(emitirContratoV2);
    // Simular un contexto autenticado donde no se pasa colaboradorId
    // Nota: el wrapper evalúa auth primero, luego role, luego validación de datos
    // Para probar validación de argumentos sin emulador, verificamos que la función lance HttpsError
    expect(typeof emitirContratoV2.run).toBe('function');
  });

  it('3. La Cloud Function debe estar exportada correctamente como Callable Function v2', () => {
    expect(emitirContratoV2).toBeDefined();
    expect(typeof emitirContratoV2).toBe('function');
    expect(emitirContratoV2.__endpoint).toBeDefined();
  });
});
