import { describe, it, expect } from 'vitest';
import { resolveShadowShift, toAbsoluteMinutes, ShadowCandidate } from '../shadowResolver';

describe('Shadow Resolver Subfase 5B.3 (Backend-only)', () => {

  const baseCandidate: ShadowCandidate = {
    id: 'turno_valido',
    estado: 'programado',
    codigo: 'X',
    sucursalId: 'site_1',
    fecha: '2023-10-15',
    horarioSnapshot: { inicio: '08:00', termino: '16:00' }
  };

  it('1. Check-in único recibe turnoProgramadoId dentro de la ventana (-120m a +120m)', () => {
    // Current time: 08:30 (dentro de ventana)
    const currentMins = toAbsoluteMinutes('2023-10-15', '08:30');
    const result = resolveShadowShift([baseCandidate], 'site_1', 'programado', currentMins);
    expect(result.turnoProgramadoId).toBe('turno_valido');
    expect(result.diagnostico).toBe('unico');
  });

  it('2. Sin candidatos válidos por sucursal distinta', () => {
    const currentMins = toAbsoluteMinutes('2023-10-15', '08:30');
    const result = resolveShadowShift([{...baseCandidate, sucursalId: 'site_2'}], 'site_1', 'programado', currentMins);
    expect(result.turnoProgramadoId).toBeNull();
    expect(result.diagnostico).toBe('sucursal_incompatible');
  });

  it('3. Check-in fuera de ventana temprana (>120m antes)', () => {
    // Current time: 05:00 (3 horas antes de las 08:00)
    const currentMins = toAbsoluteMinutes('2023-10-15', '05:00');
    const result = resolveShadowShift([baseCandidate], 'site_1', 'programado', currentMins);
    expect(result.turnoProgramadoId).toBeNull();
    expect(result.diagnostico).toBe('horario_incompatible');
  });

  it('4. Check-in fuera de ventana tardía (>120m después)', () => {
    // Current time: 10:30 (2.5 horas después de las 08:00)
    const currentMins = toAbsoluteMinutes('2023-10-15', '10:30');
    const result = resolveShadowShift([baseCandidate], 'site_1', 'programado', currentMins);
    expect(result.turnoProgramadoId).toBeNull();
    expect(result.diagnostico).toBe('horario_incompatible');
  });

  it('5. Fallback estricto (coincidencia determinista por ventana única)', () => {
    const currentMins = toAbsoluteMinutes('2023-10-15', '08:30');
    // baseCandidate is X. Legacy legacyCode is 'programado' (which translates to 'X' usually).
    const result = resolveShadowShift([baseCandidate], 'site_1', 'programado', currentMins);
    expect(result.turnoProgramadoId).toBe('turno_valido');
  });

  it('6. Múltiples candidatos omite ID', () => {
    const cand2: ShadowCandidate = { ...baseCandidate, id: 'turno_valido_2' };
    const currentMins = toAbsoluteMinutes('2023-10-15', '08:30');
    const result = resolveShadowShift([baseCandidate, cand2], 'site_1', 'programado', currentMins);
    expect(result.turnoProgramadoId).toBeNull();
    expect(result.diagnostico).toBe('multiple_candidates');
  });

  it('7. Cruce de medianoche para turno nocturno (N)', () => {
    // Turno inicia 19:30 del 15 de Oct, legacy asume N.
    const candN: ShadowCandidate = {
      id: 'turno_N',
      estado: 'programado',
      codigo: 'N',
      sucursalId: 'site_1',
      fecha: '2023-10-15',
      horarioSnapshot: { inicio: '19:30', termino: '07:30' }
    };
    // Check in a las 20:00 (mismo dia)
    const currentMinsSameDay = toAbsoluteMinutes('2023-10-15', '20:00', false);
    const result1 = resolveShadowShift([candN], 'site_1', 'noche', currentMinsSameDay);
    expect(result1.turnoProgramadoId).toBe('turno_N');

    // Check in a las 18:00 (fuera de la ventana temprana)
    const currentMinsEarly = toAbsoluteMinutes('2023-10-15', '17:00', false);
    const result2 = resolveShadowShift([candN], 'site_1', 'noche', currentMinsEarly);
    expect(result2.turnoProgramadoId).toBeNull();
  });
  
  it('8. Descarte de estados inválidos (cancelado, descanso)', () => {
    const currentMins = toAbsoluteMinutes('2023-10-15', '08:30');
    const candInvalid: ShadowCandidate = { ...baseCandidate, estado: 'cancelado' };
    const result = resolveShadowShift([candInvalid], 'site_1', 'programado', currentMins);
    expect(result.turnoProgramadoId).toBeNull();
    expect(result.diagnostico).toBe('sin_candidatos');
  });

});
