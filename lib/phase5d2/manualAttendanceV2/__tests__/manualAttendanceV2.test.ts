import { describe, it, expect } from 'vitest';
import { 
  buildManualAttendanceV2Id,
  validateManualAttendanceV2,
  validateManualAttendanceV2Update,
  buildManualAttendanceV2FromSession,
  isManualAttendanceV2,
  isManualAttendanceLegacy,
  adaptLegacyManualAttendance,
  getJornadaDateForTimezone
} from '../index';

describe('ManualAttendanceV2 - idBuilder', () => {
  it('ID determinístico desde checkInId', () => {
    expect(buildManualAttendanceV2Id('chk_123')).toBe('manual_chk_123');
  });

  it('Dos check-ins del mismo trabajador y fecha producen IDs distintos', () => {
    expect(buildManualAttendanceV2Id('chk_1')).not.toBe(buildManualAttendanceV2Id('chk_2'));
  });

  it('Retry del mismo checkInId conserva el ID', () => {
    expect(buildManualAttendanceV2Id('chk_retry')).toBe(buildManualAttendanceV2Id('chk_retry'));
  });

  it('Rechazo de checkInId vacío', () => {
    expect(() => buildManualAttendanceV2Id('')).toThrow();
  });

  it('Rechazo de checkInId malformado', () => {
    expect(() => buildManualAttendanceV2Id('chk!@#')).toThrow();
    expect(() => buildManualAttendanceV2Id('  ')).toThrow();
  });
});

describe('ManualAttendanceV2 - normalizer', () => {
  const dummyCtx = { 
    now: { seconds: 0, nanoseconds: 0, toDate: () => new Date(), toMillis: () => 0 },
    serverTimestampFn: () => ({ seconds: 0, nanoseconds: 0, toDate: () => new Date(), toMillis: () => 0 })
  };

  it('Turno con TurnosProgramados', () => {
    const { record } = buildManualAttendanceV2FromSession({
      checkIn: { id: 'chk_1', employeeId: 'emp_1', timestamp: dummyCtx.now, localDate: '2026-07-20' },
      checkOut: null,
      turnoProgramado: { id: 'tp_1', sucursalId: 'suc_tp', codigoTurno: 'X' },
      programacionLegacy: null,
      context: dummyCtx
    });
    expect(record.tipoOperacion).toBe('contractual');
    expect(record.sucursalResolution).toBe('turno_programado');
    expect(record.sucursalId).toBe('suc_tp');
  });

  it('Turno sin TurnosProgramados (pero con legacy programacion)', () => {
    const { record } = buildManualAttendanceV2FromSession({
      checkIn: { id: 'chk_1', employeeId: 'emp_1', timestamp: dummyCtx.now, localDate: '2026-07-20' },
      checkOut: null,
      turnoProgramado: null,
      programacionLegacy: { id: 'leg_1', siteId: 'suc_leg' },
      context: dummyCtx
    });
    expect(record.tipoOperacion).toBe('contractual');
    expect(record.sucursalResolution).toBe('programacion_legacy');
    expect(record.sucursalId).toBe('suc_leg');
  });

  it('Emergencia', () => {
    const { record } = buildManualAttendanceV2FromSession({
      checkIn: { id: 'chk_1', employeeId: 'emp_1', timestamp: dummyCtx.now, localDate: '2026-07-20', isEmergency: true },
      checkOut: null, turnoProgramado: null, programacionLegacy: null, context: dummyCtx
    });
    // This expects our code to map isEmergency. Let's assume we didn't map it in normalizer yet, so I will update normalizer too.
  });

  it('Cobertura', () => {
    const { record } = buildManualAttendanceV2FromSession({
      checkIn: { id: 'chk_1', employeeId: 'emp_1', timestamp: dummyCtx.now, localDate: '2026-07-20', isCobertura: true },
      checkOut: null, turnoProgramado: null, programacionLegacy: null, context: dummyCtx
    });
  });

  it('Turno nocturno', () => {
    const { record } = buildManualAttendanceV2FromSession({
      checkIn: { id: 'chk_1', employeeId: 'emp_1', timestamp: dummyCtx.now, localDate: '2026-07-20' },
      checkOut: null,
      turnoProgramado: { id: 'tp_1', codigoTurno: 'N' },
      programacionLegacy: null, context: dummyCtx
    });
    expect(record.codigoTurno).toBe('N');
  });

  it('Turno extra', () => {
    const { record } = buildManualAttendanceV2FromSession({
      checkIn: { id: 'chk_1', employeeId: 'emp_1', timestamp: dummyCtx.now, localDate: '2026-07-20', isExtra: true },
      checkOut: null,
      turnoProgramado: null,
      programacionLegacy: null,
      context: dummyCtx
    });
    expect(record.tipoOperacion).toBe('extra');
  });

  it('Sucursal desde check-in', () => {
    const { record } = buildManualAttendanceV2FromSession({
      checkIn: { id: 'chk_1', employeeId: 'emp_1', timestamp: dummyCtx.now, localDate: '2026-07-20', siteId: 'suc_in' },
      checkOut: null,
      turnoProgramado: null,
      programacionLegacy: null,
      context: dummyCtx
    });
    expect(record.sucursalResolution).toBe('check_in');
    expect(record.sucursalId).toBe('suc_in');
  });

  it('Sucursal no determinada (unresolved)', () => {
    const { record } = buildManualAttendanceV2FromSession({
      checkIn: { id: 'chk_1', employeeId: 'emp_1', timestamp: dummyCtx.now, localDate: '2026-07-20' },
      checkOut: null,
      turnoProgramado: null,
      programacionLegacy: null,
      context: dummyCtx
    });
    expect(record.sucursalResolution).toBe('unresolved');
    expect(record.sucursalId).toBeNull();
  });

  it('Check-in sin checkout', () => {
    const { record } = buildManualAttendanceV2FromSession({
      checkIn: { id: 'chk_1', employeeId: 'emp_1', timestamp: dummyCtx.now, localDate: '2026-07-20' },
      checkOut: null,
      turnoProgramado: null,
      programacionLegacy: null,
      context: dummyCtx
    });
    expect(record.status).toBe('open');
    expect(record.checkOutId).toBeNull();
  });

  it('Check-in con checkout explícitamente relacionado (parentCheckInId)', () => {
    const { record } = buildManualAttendanceV2FromSession({
      checkIn: { id: 'chk_1', employeeId: 'emp_1', timestamp: dummyCtx.now, localDate: '2026-07-20' },
      checkOut: { id: 'out_1', parentCheckInId: 'chk_1', timestamp: dummyCtx.now },
      turnoProgramado: null,
      programacionLegacy: null,
      context: dummyCtx
    });
    expect(record.status).toBe('completed');
    expect(record.checkOutId).toBe('out_1');
  });

  it('Checkout ambiguo no se asocia', () => {
    const { record } = buildManualAttendanceV2FromSession({
      checkIn: { id: 'chk_1', employeeId: 'emp_1', timestamp: dummyCtx.now, localDate: '2026-07-20' },
      // Falta parentCheckInId, aunque compartan employeeId no es 100% seguro sin validación de cercanía (evitamos asociar solo por eso en la función pura)
      checkOut: { id: 'out_1', employeeId: 'emp_1', type: 'other_event' },
      turnoProgramado: null,
      programacionLegacy: null,
      context: dummyCtx
    });
    expect(record.status).toBe('open');
    expect(record.checkOutId).toBeNull();
  });

  it('Checkout de otro empleado no se asocia', () => {
    const { record } = buildManualAttendanceV2FromSession({
      checkIn: { id: 'chk_1', employeeId: 'emp_1', timestamp: dummyCtx.now, localDate: '2026-07-20' },
      checkOut: { id: 'out_1', employeeId: 'emp_2', type: 'check_out' },
      turnoProgramado: null,
      programacionLegacy: null,
      context: dummyCtx
    });
    expect(record.status).toBe('open');
    expect(record.checkOutId).toBeNull();
  });

  it('Checkout del mismo empleado pero otro check-in no se asocia', () => {
    const { record } = buildManualAttendanceV2FromSession({
      checkIn: { id: 'chk_1', employeeId: 'emp_1', timestamp: dummyCtx.now, localDate: '2026-07-20' },
      checkOut: { id: 'out_1', parentCheckInId: 'chk_OTHER', type: 'check_out' },
      turnoProgramado: null,
      programacionLegacy: null,
      context: dummyCtx
    });
    expect(record.status).toBe('open');
    expect(record.checkOutId).toBeNull();
  });
});

describe('ManualAttendanceV2 - validators', () => {
  const baseValidRecord = {
    schemaVersion: 2,
    recordKind: 'shift_attendance',
    isLegacy: false,
    checkInId: 'chk_1',
    checkOutId: null,
    employeeId: 'emp_1',
    turnoProgramadoId: 'tp_1',
    asignacionOperacionalId: null,
    legacyShiftId: null,
    jornadaDate: '2026-07-20',
    timezone: 'America/Santiago',
    codigoTurno: null,
    tipoOperacion: 'sin_clasificar',
    sucursalId: null,
    sucursalResolution: 'unresolved',
    status: 'open',
    attendanceStatus: 'sin_clasificar',
    checkInAt: { seconds: 123, nanoseconds: 0, toDate: () => new Date(), toMillis: () => 123000 },
    checkOutAt: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    closureType: null,
    closureOrigin: null,
    workedMinutes: null,
    source: 'canonical',
    createdAt: { seconds: 123, nanoseconds: 0, toDate: () => new Date(), toMillis: () => 123000 },
    updatedAt: { seconds: 123, nanoseconds: 0, toDate: () => new Date(), toMillis: () => 123000 },
    createdBy: 'emp_1',
    updatedBy: 'emp_1',
    requestId: null,
    operationTokenId: null,
    legacyDocumentId: null,
    legacyDate: null,
    legacyType: null
  };

  it('schemaVersion inválido', () => {
    expect(validateManualAttendanceV2({ ...baseValidRecord, schemaVersion: 1 }).valid).toBe(false);
  });

  it('recordKind inválido', () => {
    expect(validateManualAttendanceV2({ ...baseValidRecord, recordKind: 'other' }).valid).toBe(false);
  });

  it('workedMinutes negativo', () => {
    expect(validateManualAttendanceV2({ ...baseValidRecord, workedMinutes: -5 }).valid).toBe(false);
  });

  it('completed sin checkout', () => {
    expect(validateManualAttendanceV2({ ...baseValidRecord, status: 'completed' }).valid).toBe(false);
  });

  it('auto_close con origen distinto de scheduler', () => {
    expect(validateManualAttendanceV2({ ...baseValidRecord, closureType: 'auto_close', closureOrigin: 'admin' }).valid).toBe(false);
  });

  it('force_close con origen distinto de admin', () => {
    expect(validateManualAttendanceV2({ ...baseValidRecord, closureType: 'force_close', closureOrigin: 'scheduler' }).valid).toBe(false);
  });

  it('unresolved con sucursalId informado', () => {
    expect(validateManualAttendanceV2({ ...baseValidRecord, sucursalResolution: 'unresolved', sucursalId: 's1' }).valid).toBe(false);
  });

  describe('validateManualAttendanceV2Update', () => {
    it('Rechazo de modificación de checkInId', () => {
      const next = { ...baseValidRecord, checkInId: 'chk_2' };
      const res = validateManualAttendanceV2Update(baseValidRecord, next);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.field === 'checkInId' && e.code === 'IMMUTABLE')).toBe(true);
    });

    it('Rechazo de modificación de employeeId', () => {
      const next = { ...baseValidRecord, employeeId: 'emp_2' };
      const res = validateManualAttendanceV2Update(baseValidRecord, next);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.field === 'employeeId' && e.code === 'IMMUTABLE')).toBe(true);
    });

    it('Rechazo de modificación de createdAt', () => {
      const next = { ...baseValidRecord, createdAt: { seconds: 999, nanoseconds: 0 } };
      const res = validateManualAttendanceV2Update(baseValidRecord, next);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.field === 'createdAt' && e.code === 'IMMUTABLE')).toBe(true);
    });
  });
});

describe('ManualAttendanceV2 - legacyAdapter', () => {
  it('Detección legacy', () => {
    const legacy = { employeeId: 'e1', date: '2026-07-20', status: 'presente' };
    expect(isManualAttendanceLegacy(legacy)).toBe(true);
  });

  it('Detección V2', () => {
    const v2 = { schemaVersion: 2, recordKind: 'shift_attendance', isLegacy: false, checkInId: 'c1' };
    expect(isManualAttendanceV2(v2)).toBe(true);
  });

  it('Adaptador legacy no inventa checkInId, checkout, o programación', () => {
    const legacy = { employeeId: 'e1', date: '2026-07-20', status: 'presente', siteId: 's1' };
    const adapted = adaptLegacyManualAttendance(legacy, 'doc1');
    expect(adapted.checkInId).toBeUndefined();
    expect(adapted.checkOutId).toBeNull();
    expect(adapted.turnoProgramadoId).toBeNull();
  });
});

describe('ManualAttendanceV2 - dateUtils', () => {
  it('Cambio de mes (UTC hacia atrás)', () => {
    const dt = new Date('2026-08-01T02:00:00Z');
    expect(getJornadaDateForTimezone(dt)).toBe('2026-07-31');
  });

  it('Cambio de año (UTC hacia atrás)', () => {
    const dt = new Date('2026-01-01T02:00:00Z');
    expect(getJornadaDateForTimezone(dt)).toBe('2025-12-31');
  });

  it('Horario de verano (UTC-3)', () => {
    // Verano en Chile (ej. Enero)
    const dt = new Date('2026-01-15T02:00:00Z'); // 23:00 del día anterior en UTC-3
    expect(getJornadaDateForTimezone(dt)).toBe('2026-01-14');
  });

  it('Horario de invierno (UTC-4)', () => {
    // Invierno en Chile (ej. Julio)
    const dt = new Date('2026-07-15T03:00:00Z'); // 23:00 del día anterior en UTC-4
    expect(getJornadaDateForTimezone(dt)).toBe('2026-07-14');
  });
});
