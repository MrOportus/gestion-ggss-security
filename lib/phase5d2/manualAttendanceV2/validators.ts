import { ManualAttendanceV2 } from './types';

export interface ValidationError {
  field: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export function validateManualAttendanceV2(record: any): ValidationResult {
  const errors: ValidationError[] = [];

  if (record.schemaVersion !== 2) errors.push({ field: 'schemaVersion', code: 'INVALID_VALUE', message: 'schemaVersion must be 2' });
  if (record.recordKind !== 'shift_attendance') errors.push({ field: 'recordKind', code: 'INVALID_VALUE', message: 'recordKind must be shift_attendance' });
  if (record.isLegacy !== false) errors.push({ field: 'isLegacy', code: 'INVALID_VALUE', message: 'isLegacy must be false' });
  if (!record.checkInId || typeof record.checkInId !== 'string') errors.push({ field: 'checkInId', code: 'REQUIRED', message: 'checkInId is required' });
  if (!record.employeeId || typeof record.employeeId !== 'string') errors.push({ field: 'employeeId', code: 'REQUIRED', message: 'employeeId is required' });
  if (!record.jornadaDate || !/^\d{4}-\d{2}-\d{2}$/.test(record.jornadaDate)) errors.push({ field: 'jornadaDate', code: 'INVALID_FORMAT', message: 'jornadaDate must be in YYYY-MM-DD format' });
  if (record.timezone !== 'America/Santiago') errors.push({ field: 'timezone', code: 'INVALID_VALUE', message: 'timezone must be America/Santiago' });
  if (record.checkOutId === null && record.checkOutAt !== null) errors.push({ field: 'checkOutAt', code: 'INCONSISTENT', message: 'checkOutAt must be null if checkOutId is null' });
  if (record.status === 'completed' && (!record.checkOutId || !record.checkOutAt)) errors.push({ field: 'status', code: 'INCONSISTENT', message: 'completed status normally requires checkOutId and checkOutAt' });
  if (typeof record.workedMinutes === 'number' && record.workedMinutes < 0) errors.push({ field: 'workedMinutes', code: 'INVALID_VALUE', message: 'workedMinutes cannot be negative' });
  if (record.sucursalResolution === 'unresolved' && record.sucursalId !== null) errors.push({ field: 'sucursalId', code: 'INCONSISTENT', message: 'sucursalId must be null if sucursalResolution is unresolved' });
  if (record.closureType === 'auto_close' && record.closureOrigin !== 'scheduler') errors.push({ field: 'closureOrigin', code: 'INCONSISTENT', message: 'auto_close closureType requires scheduler closureOrigin' });
  if (record.closureType === 'force_close' && record.closureOrigin !== 'admin') errors.push({ field: 'closureOrigin', code: 'INCONSISTENT', message: 'force_close closureType requires admin closureOrigin' });

  return { valid: errors.length === 0, errors };
}

export function validateManualAttendanceV2Update(previous: any, next: any): ValidationResult {
  const errors: ValidationError[] = [];

  // Re-validar el modelo completo
  const baseValidation = validateManualAttendanceV2(next);
  if (!baseValidation.valid) {
    errors.push(...baseValidation.errors);
  }

  // Inmutabilidad estricta
  if (previous.schemaVersion !== next.schemaVersion) errors.push({ field: 'schemaVersion', code: 'IMMUTABLE', message: 'schemaVersion cannot be changed' });
  if (previous.recordKind !== next.recordKind) errors.push({ field: 'recordKind', code: 'IMMUTABLE', message: 'recordKind cannot be changed' });
  if (previous.isLegacy !== next.isLegacy) errors.push({ field: 'isLegacy', code: 'IMMUTABLE', message: 'isLegacy cannot be changed' });
  if (previous.checkInId !== next.checkInId) errors.push({ field: 'checkInId', code: 'IMMUTABLE', message: 'checkInId cannot be changed' });
  if (previous.employeeId !== next.employeeId) errors.push({ field: 'employeeId', code: 'IMMUTABLE', message: 'employeeId cannot be changed' });
  if (previous.createdAt && next.createdAt && previous.createdAt !== next.createdAt && previous.createdAt.seconds !== next.createdAt.seconds) {
    errors.push({ field: 'createdAt', code: 'IMMUTABLE', message: 'createdAt cannot be changed' });
  }
  
  // Dependiendo de las políticas operativas, jornadaDate y turnoProgramadoId pueden ser inmutables
  // porque cambiar la fecha o el turno en una sesión que ya arrancó implica probablemente un error humano.
  // Es mejor cancelar la sesión e iniciar otra.
  if (previous.jornadaDate !== next.jornadaDate) errors.push({ field: 'jornadaDate', code: 'IMMUTABLE', message: 'jornadaDate cannot be changed once the session is started' });
  if (previous.turnoProgramadoId !== next.turnoProgramadoId) errors.push({ field: 'turnoProgramadoId', code: 'IMMUTABLE', message: 'turnoProgramadoId cannot be changed' });
  if (previous.asignacionOperacionalId !== next.asignacionOperacionalId) errors.push({ field: 'asignacionOperacionalId', code: 'IMMUTABLE', message: 'asignacionOperacionalId cannot be changed' });

  return { valid: errors.length === 0, errors };
}
