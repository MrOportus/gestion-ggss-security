export type AttendanceSource = 'legacy' | 'v2';

export interface AttendanceSessionReadModel {
  id: string; // Deterministic ID: manual_{checkInId} for V2 or legacy_{id}
  checkInId: string;
  checkOutId: string | null;
  employeeId: string;
  employeeName?: string;
  employeeRut?: string;
  jornadaDate: string;
  timezone: string;

  turnoProgramadoId: string | null;
  asignacionOperacionalId: string | null;
  codigoTurno: string;
  tipoOperacion: string;

  sucursalId: string;
  sucursalNombre?: string;
  sucursalResolution: string;

  status: 'open' | 'closed';
  attendanceStatus: 'presente' | 'ausente' | 'licencia' | 'vacaciones'; // Add others as needed

  checkInAt: string; // ISO String
  checkOutAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  workedMinutes: number | null;

  closureType: 'manual' | 'auto' | 'force' | 'none';
  closureOrigin: 'worker' | 'admin' | 'scheduler' | 'none';

  source: AttendanceSource;
  generationStatus: 'active' | 'invalidated' | 'disabled';
  schemaVersion: number;

  warnings: string[];
  limitations?: string[]; // Specifically for legacy
}

export interface AttendanceDaySummaryReadModel {
  employeeId: string;
  employeeName?: string;
  jornadaDate: string;
  sessions: AttendanceSessionReadModel[];
  sessionCount: number;
  completedCount: number;
  openCount: number;
  workedMinutesTotal: number;
  sucursalIds: string[];
  hasMultipleSessions: boolean;
  hasConflicts: boolean;
  hasWarnings: boolean;
}

export interface AttendanceBranchDaySummaryReadModel {
  sucursalId: string;
  sucursalNombre?: string;
  jornadaDate: string;
  uniqueEmployees: number; // Disctinct employeeIds
  totalSessions: number;   // Total sessions
  completedSessions: number;
  openSessions: number;
  workedMinutesTotal: number;
  multipleSessionEmployees: number; // Count of employees with > 1 session
  warningsCount: number;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  pageSize: number;
}

export interface ShadowComparisonResult {
  employeeId: string;
  jornadaDate: string;
  
  legacy: {
    numberOfSessions: number;
    sucursalIds: string[];
    attendanceStatuses: string[];
    completedSessions: number;
    workedMinutesTotal: number;
  };
  
  v2: {
    numberOfSessions: number;
    sucursalIds: string[];
    attendanceStatuses: string[];
    completedSessions: number;
    workedMinutesTotal: number;
  };
  
  status: 
    | 'exact_match' 
    | 'compatible_partial_match' 
    | 'expected_legacy_limitation' 
    | 'unexpected_difference' 
    | 'legacy_overwrite_detected' 
    | 'missing_legacy' 
    | 'missing_v2' 
    | 'v2_invalid';
}

export interface ShadowReadResponse {
  legacyResult: PaginatedResult<AttendanceSessionReadModel> | AttendanceSessionReadModel[] | null;
  v2Result: PaginatedResult<AttendanceSessionReadModel> | AttendanceSessionReadModel[] | null;
  comparison?: ShadowComparisonResult | ShadowComparisonResult[];
}
