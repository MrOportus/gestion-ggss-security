const { toTimestampMs } = require('./functions/src/phase4/conflictService');
const assert = require('assert');

function runTimezoneTests() {
  console.log('--- STARTING TIMEZONE TESTS ---');

  // Verano: 15 de Enero 2026 (America/Santiago = UTC-3)
  // 19:30 en Chile (UTC-3) -> 22:30 UTC
  // 15 de Enero 2026 a las 19:30 = Timestamp en ms para esa hora UTC
  const veranoMs = toTimestampMs('2026-01-15', '19:30');
  const veranoDate = new Date(veranoMs);
  assert.strictEqual(veranoDate.toISOString(), '2026-01-15T22:30:00.000Z', 'Fallo en test de Verano');
  console.log('✓ Test Verano (UTC-3) pasado');

  // Invierno: 15 de Julio 2026 (America/Santiago = UTC-4)
  // 19:30 en Chile (UTC-4) -> 23:30 UTC
  const inviernoMs = toTimestampMs('2026-07-15', '19:30');
  const inviernoDate = new Date(inviernoMs);
  assert.strictEqual(inviernoDate.toISOString(), '2026-07-15T23:30:00.000Z', 'Fallo en test de Invierno');
  console.log('✓ Test Invierno (UTC-4) pasado');

  // Turno nocturno cruce medianoche (verano)
  // Inicio 19:30 (22:30 UTC), Termino 07:30 (10:30 UTC del día siguiente)
  const nocturnoFinMs = toTimestampMs('2026-01-15', '07:30', true, true);
  const nocturnoFinDate = new Date(nocturnoFinMs);
  assert.strictEqual(nocturnoFinDate.toISOString(), '2026-01-16T10:30:00.000Z', 'Fallo en test nocturno');
  console.log('✓ Test Turno Nocturno pasado');

  // Timestamp cercano a medianoche (Invierno)
  // 23:59 -> 03:59 del día siguiente en UTC
  const medianocheMs = toTimestampMs('2026-07-15', '23:59');
  const medianocheDate = new Date(medianocheMs);
  assert.strictEqual(medianocheDate.toISOString(), '2026-07-16T03:59:00.000Z', 'Fallo en test cercano a medianoche');
  console.log('✓ Test Cercano a Medianoche pasado');

  console.log('--- TIMEZONE TESTS PASSED ---');
}

runTimezoneTests();
