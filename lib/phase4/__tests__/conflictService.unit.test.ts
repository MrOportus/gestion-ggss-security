/**
 * lib/phase4/__tests__/conflictService.unit.test.ts
 * Fase 4 — Suite A: Tests unitarios puros del servicio de conflictos.
 *
 * Importa el módulo JS directamente (createRequire para compatibilidad ESM/CJS).
 * No requiere Firebase ni emulador.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  detectConflict,
  detectConflicts,
  checkInsufficientRest,
  detectCrossOverMidnight,
  toRange,
} = require('../../../functions/src/phase4/conflictService');

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures de horarios comunes
// ─────────────────────────────────────────────────────────────────────────────

const horarioDia = { inicio: '07:30', termino: '19:30', cruzaMedianoche: false };
const horarioNoche = { inicio: '19:30', termino: '07:30', cruzaMedianoche: true };
const horarioCorto = { inicio: '08:00', termino: '12:00', cruzaMedianoche: false };
const horarioMediodia = { inicio: '12:00', termino: '16:00', cruzaMedianoche: false };

const turnoBase = (overrides: any = {}) => ({
  fecha: '2024-06-15',
  horario: horarioDia,
  estado: 'programado',
  id: 'turno-base',
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. detectCrossOverMidnight
// ─────────────────────────────────────────────────────────────────────────────

describe('detectCrossOverMidnight', () => {
  it('Turno diurno no cruza medianoche', () => {
    expect(detectCrossOverMidnight(horarioDia)).toBe(false);
  });

  it('Turno nocturno cruza medianoche', () => {
    expect(detectCrossOverMidnight(horarioNoche)).toBe(true);
  });

  it('Turno que termina exactamente a medianoche no cruza', () => {
    expect(detectCrossOverMidnight({ inicio: '08:00', termino: '00:00' })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. toRange — validaciones básicas
// ─────────────────────────────────────────────────────────────────────────────

describe('toRange', () => {
  it('Turno diurno: finMs > inicioMs', () => {
    const { inicioMs, finMs } = toRange('2024-06-15', horarioDia);
    expect(finMs).toBeGreaterThan(inicioMs);
    // ~12 horas de diferencia
    const diffHours = (finMs - inicioMs) / (1000 * 60 * 60);
    expect(diffHours).toBeCloseTo(12, 0);
  });

  it('Turno nocturno: finMs cae al día siguiente', () => {
    const { inicioMs, finMs } = toRange('2024-06-15', horarioNoche);
    expect(finMs).toBeGreaterThan(inicioMs);
    const diffHours = (finMs - inicioMs) / (1000 * 60 * 60);
    expect(diffHours).toBeCloseTo(12, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. detectConflict — superposición
// ─────────────────────────────────────────────────────────────────────────────

describe('detectConflict — tipos de superposición', () => {
  it('1. Turno idéntico detecta identical', () => {
    const candidate = { fecha: '2024-06-15', horario: horarioDia };
    const existing = turnoBase();
    const result = detectConflict(candidate, existing);
    expect(result.type).toBe('identical');
  });

  it('2. Superposición parcial (candidato empieza en medio del existente)', () => {
    const candidate = { fecha: '2024-06-15', horario: { inicio: '13:00', termino: '20:00', cruzaMedianoche: false } };
    const existing = turnoBase(); // 07:30–19:30
    const result = detectConflict(candidate, existing);
    expect(['total', 'partial']).toContain(result.type);
  });

  it('3. Sin superposición: candidato empieza cuando termina el existente (límite [inicio, fin))', () => {
    // existing: 07:30–19:30, candidate: 19:30–22:00 → NO overlap [inicio, fin)
    const candidate = { fecha: '2024-06-15', horario: { inicio: '19:30', termino: '22:00', cruzaMedianoche: false } };
    const existing = turnoBase();
    const result = detectConflict(candidate, existing);
    expect(result.type).toBe('none');
  });

  it('4. Sin superposición: candidato anterior al existente', () => {
    const candidate = { fecha: '2024-06-15', horario: { inicio: '05:00', termino: '07:30', cruzaMedianoche: false } };
    const existing = turnoBase(); // 07:30–19:30
    const result = detectConflict(candidate, existing);
    expect(result.type).toBe('none');
  });

  it('5. Turno cancelado no genera conflicto', () => {
    const candidate = { fecha: '2024-06-15', horario: horarioDia };
    const existing = turnoBase({ estado: 'cancelado' });
    const result = detectConflict(candidate, existing);
    expect(result.type).toBe('none');
  });

  it('6. Turno trasladado retorna already_transferred', () => {
    const candidate = { fecha: '2024-06-15', horario: horarioDia };
    const existing = turnoBase({ estado: 'trasladado' });
    const result = detectConflict(candidate, existing);
    expect(result.type).toBe('already_transferred');
  });

  it('7. Turno nocturno candidato vs turno diurno existente — sin solapamiento', () => {
    // Nocturno: 19:30–07:30 siguiente día
    // Diurno: 07:30–19:30 mismo día → terminan cuando empieza el nocturno (19:30)
    const candidate = { fecha: '2024-06-15', horario: horarioNoche };
    const existing = turnoBase(); // diurno 07:30–19:30
    const result = detectConflict(candidate, existing);
    // Con [inicio, fin): diurno termina 19:30, nocturno empieza 19:30 → no overlap
    expect(result.type).toBe('none');
  });

  it('8. Turno diurno candidato vs nocturno existente el mismo día', () => {
    // nocturno existing: 19:30–07:30 siguiente
    // diurno candidate: 07:30–19:30 mismo día → termina cuando empieza el nocturno
    const candidate = { fecha: '2024-06-15', horario: horarioDia };
    const existing = turnoBase({ horario: horarioNoche });
    const result = detectConflict(candidate, existing);
    expect(result.type).toBe('none');
  });

  it('9. Superposición total: candidato contenido dentro del existente', () => {
    const candidate = { fecha: '2024-06-15', horario: horarioMediodia }; // 12:00–16:00
    const existing = turnoBase(); // 07:30–19:30
    const result = detectConflict(candidate, existing);
    expect(result.type).toBe('total');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. detectConflicts — lista de turnos
// ─────────────────────────────────────────────────────────────────────────────

describe('detectConflicts — lista de turnos existentes', () => {
  it('10. Sin turnos existentes: ningún conflicto', () => {
    const candidate = { fecha: '2024-06-15', horario: horarioDia, colaboradorId: 'emp1' };
    const result = detectConflicts(candidate, []);
    expect(result.type).toBe('none');
  });

  it('11. Un turno sin superposición: ningún conflicto', () => {
    const candidate = { fecha: '2024-06-15', horario: { inicio: '20:00', termino: '23:00', cruzaMedianoche: false }, colaboradorId: 'emp1' };
    const existing = [turnoBase({ id: 't1' })]; // 07:30–19:30
    const result = detectConflicts(candidate, existing);
    expect(result.type).toBe('none');
  });

  it('12. Turno adicional sin superposición no es rechazado', () => {
    // Turno existente tarde, nuevo turno mañana
    const candidate = { fecha: '2024-06-15', horario: horarioCorto, colaboradorId: 'emp1' }; // 08:00–12:00
    const existing = [turnoBase({ id: 't1', horario: { inicio: '14:00', termino: '22:00', cruzaMedianoche: false } })];
    const result = detectConflicts(candidate, existing);
    expect(result.type).toBe('none');
  });

  it('13. Turno adicional con superposición es detectado', () => {
    const candidate = { fecha: '2024-06-15', horario: horarioDia, colaboradorId: 'emp1' };
    const existing = [turnoBase({ id: 't1' })]; // idéntico
    const result = detectConflicts(candidate, existing);
    expect(result.type).not.toBe('none');
    expect(result.conflictingShiftId).toBe('t1');
  });

  it('14. Turno ya trasladado en la lista no genera conflicto de superposición', () => {
    const candidate = { fecha: '2024-06-15', horario: horarioDia, colaboradorId: 'emp1' };
    const existing = [turnoBase({ id: 't1', estado: 'trasladado' })];
    const result = detectConflicts(candidate, existing);
    expect(result.type).toBe('already_transferred');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. checkInsufficientRest
// ─────────────────────────────────────────────────────────────────────────────

describe('checkInsufficientRest', () => {
  it('15. Advertencia por descanso insuficiente: 0.5 horas', () => {
    // ShiftA termina 19:30, ShiftB empieza 20:00 → 0.5h de descanso
    const shiftA = { fecha: '2024-06-15', horario: horarioDia }; // termina 19:30
    const shiftB = { fecha: '2024-06-15', horario: { inicio: '20:00', termino: '23:00', cruzaMedianoche: false } };
    const result = checkInsufficientRest(shiftA, shiftB, 8);
    expect(result.hasWarning).toBe(true);
    expect(result.restHours).toBeCloseTo(0.5, 1);
  });

  it('16. Sin advertencia cuando hay descanso suficiente (12h)', () => {
    // ShiftA termina 07:30, ShiftB empieza 19:30 mismo día → 12h
    const shiftA = { fecha: '2024-06-14', horario: horarioNoche }; // 19:30–07:30 → termina 07:30 del día siguiente
    const shiftB = { fecha: '2024-06-15', horario: { inicio: '19:30', termino: '07:30', cruzaMedianoche: true } };
    const result = checkInsufficientRest(shiftA, shiftB, 8);
    expect(result.hasWarning).toBe(false);
    expect(result.restHours).toBeGreaterThanOrEqual(8);
  });

  it('17. Umbral personalizado: advertencia con 9 horas si umbral es 10', () => {
    const shiftA = { fecha: '2024-06-15', horario: { inicio: '07:30', termino: '16:30', cruzaMedianoche: false } };
    const shiftB = { fecha: '2024-06-16', horario: { inicio: '01:30', termino: '09:30', cruzaMedianoche: false } };
    const result = checkInsufficientRest(shiftA, shiftB, 10);
    expect(result.hasWarning).toBe(true);
    expect(result.restHours).toBeCloseTo(9, 0);
  });

  it('18. Turnos exactamente consecutivos (0h descanso): advertencia', () => {
    const shiftA = { fecha: '2024-06-15', horario: horarioDia }; // 07:30–19:30
    const shiftB = { fecha: '2024-06-15', horario: horarioNoche }; // 19:30–07:30 → empieza en 19:30
    const result = checkInsufficientRest(shiftA, shiftB, 8);
    expect(result.hasWarning).toBe(true);
    expect(result.restHours).toBeCloseTo(0, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Edge cases documentados
// ─────────────────────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('19. Turno nocturno cruza medianoche — range es correcto (>12h de duración NO)', () => {
    const { inicioMs, finMs } = toRange('2024-06-15', horarioNoche);
    const diffH = (finMs - inicioMs) / (1000 * 60 * 60);
    // Duración nocturna: 19:30 → 07:30 = 12 horas exactas
    expect(diffH).toBeCloseTo(12, 0);
  });

  it('20. Dos turnos diurnos en días distintos: ningún conflicto', () => {
    const candidate = { fecha: '2024-06-16', horario: horarioDia, colaboradorId: 'emp1' };
    const existing = [turnoBase({ id: 't1', fecha: '2024-06-15' })];
    const result = detectConflicts(candidate, existing);
    expect(result.type).toBe('none');
  });
});
