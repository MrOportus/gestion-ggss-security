export interface AttendanceSessionReadModel {
  id: string;
  checkInId: string;
  checkOutId: string | null;
  employeeId: string;
  employeeName: string | null;
  jornadaDate: string;
  timezone: string;
  turnoProgramadoId: string | null;
  asignacionOperacionalId: string | null;
  codigoTurno: string;
  tipoOperacion: string;
  sucursalId: string | null;
  sucursalNombre: string | null;
  sucursalResolution: string;
  status: 'open' | 'closed';
  attendanceStatus: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  workedMinutes: number | null;
  closureType: string;
  closureOrigin: string;
  source: 'v2' | 'legacy';
  generationStatus: string;
  schemaVersion: number;
  warnings: string[];
  limitations?: string[]; // Solo presente en source: 'legacy'
}

export interface AttendanceDaySummaryReadModel {
  employeeId: string;
  jornadaDate: string;
  sessionCount: number;
  sessionsCompleted: number;
  sessionsOpen: number;
  workedMinutesTotal: number;
  sucursales: string[];
  hasMultipleSessions: boolean;
  warnings: string[];
  sessions: AttendanceSessionReadModel[];
}

export interface AttendanceBranchDaySummaryReadModel {
  sucursalId: string;
  jornadaDate: string;
  uniqueEmployees: number;
  sessionCount: number;
  sessionsCompleted: number;
  sessionsOpen: number;
  workedMinutesTotal: number;
  employeesWithMultipleSessions: number;
  warnings: string[];
  sessions: AttendanceSessionReadModel[];
}

export interface AttendanceComparisonReadModel {
  queryType: string;
  employeeId: string | null;
  sucursalId: string | null;
  jornadaDate: string | null;
  status: 'exact_match' | 'compatible_partial_match' | 'expected_legacy_limitation' | 'legacy_overwrite_detected' | 'unexpected_difference' | 'missing_legacy' | 'missing_v2' | 'v2_invalid';
  differences: Array<{ field: string; legacyValue: any; v2Value: any; severity: string }>;
  limitationsEncountered: string[];
  comparisonScope: 'full' | 'page';
  comparisonComplete: boolean;
  groupsCompared: number;
  groupsDeferred: number;
  comparisonCoverage: number; // Porcentaje 0-100
}

export interface AttendanceShadowRequest {
  queryType: 'employee_day' | 'employee_range' | 'branch_day' | 'branch_range' | 'checkin_id' | 'scheduled_shift';
  employeeId?: string;
  sucursalId?: string;
  jornadaDate?: string;
  fromDate?: string;
  toDate?: string;
  status?: string;
  tipoOperacion?: string;
  checkInId?: string;
  turnoProgramadoId?: string;
  limit?: number;
  includeInvalidated?: boolean;
  cursor?: string;
  requestId: string;
}

export interface AttendanceShadowResponse {
  mode: 'shadow' | 'legacy_only' | 'v2_only';
  legacyResult: {
    items: AttendanceSessionReadModel[];
    hasMore: boolean;
    nextCursor: string | null;
  };
  v2Result?: {
    items: AttendanceSessionReadModel[];
    hasMore: boolean;
    nextCursor: string | null;
  };
  comparison?: AttendanceComparisonReadModel;
  auditData?: {
    requestId: string;
    actorUid: string;
    timestamp: string;
  };
}
