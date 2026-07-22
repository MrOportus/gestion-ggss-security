export interface FirebaseTimestamp {
  seconds: number;
  nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
}

export interface ManualAttendanceV2 {
  // Identidad y versión
  schemaVersion: 2;
  recordKind: 'shift_attendance';
  isLegacy: false;

  // Referencias
  checkInId: string;
  checkOutId: string | null;
  employeeId: string;
  turnoProgramadoId: string | null;
  asignacionOperacionalId: string | null;
  legacyShiftId: string | null;

  // Fecha operacional
  jornadaDate: string;
  timezone: 'America/Santiago';

  // Turno
  codigoTurno: 'X' | 'N' | 'D' | null;
  tipoOperacion: 'contractual' | 'extra' | 'cobertura' | 'emergencia' | 'traslado_temporal' | 'sin_clasificar';

  // Sucursal
  sucursalId: string | null;
  sucursalResolution: 'turno_programado' | 'programacion_legacy' | 'check_in' | 'manual' | 'unresolved';

  // Estado consolidado
  status: 'open' | 'completed' | 'corrected' | 'cancelled';
  attendanceStatus: 'presente' | 'ausente' | 'incompleto' | 'sin_clasificar';

  // Marcaciones
  checkInAt: FirebaseTimestamp;
  checkOutAt: FirebaseTimestamp | null;
  scheduledStartAt: FirebaseTimestamp | null;
  scheduledEndAt: FirebaseTimestamp | null;

  // Cierre
  closureType: 'normal' | 'force_close' | 'auto_close' | 'auto_close_new_entry' | 'manual_correction' | null;
  closureOrigin: 'mobile' | 'admin' | 'scheduler' | 'rrhh_correction' | 'migration' | null;

  // Duración
  workedMinutes: number | null;

  // Trazabilidad
  source: 'canonical' | 'legacy_reconstructed' | 'migration';
  createdAt: FirebaseTimestamp;
  updatedAt: FirebaseTimestamp;
  createdBy: string;
  updatedBy: string;
  requestId: string | null;
  operationTokenId: string | null;

  // Compatibilidad temporal
  legacyDocumentId: string | null;
  legacyDate: string | null;
  legacyType: string | null;
}

export interface ManualAttendanceLegacy {
  employeeId?: string;
  date?: string;
  status?: string;
  type?: string;
  siteId?: string;
  updatedAt?: any;
  [key: string]: any;
}
