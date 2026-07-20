/**
 * types/phase4.ts
 * Fase 4 — Payloads de callables, resultados, modelos de UI.
 * NO redefine TurnoProgramado ni colecciones canónicas.
 * Todos los tipos de documentos Firestore siguen en types/phase1.ts.
 */

import { TipoOperacional } from './phase1';

// ─────────────────────────────────────────────────────────────────────────────
// Detección de conflictos
// ─────────────────────────────────────────────────────────────────────────────

export type ConflictType =
  | 'none'
  | 'identical'
  | 'total'
  | 'partial'
  | 'insufficient_rest'
  | 'already_transferred'
  | 'cancelled'
  | 'destination_conflict';

export interface ConflictDetectionResult {
  type: ConflictType;
  /** Horas de descanso calculadas (solo para insufficient_rest) */
  restHours?: number;
  /** ID del turno en destino que genera el conflicto (para destination_conflict) */
  conflictingShiftId?: string;
  /** Descripción legible para UI */
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Advertencia de descanso insuficiente
// ─────────────────────────────────────────────────────────────────────────────

export interface InsufficientRestWarning {
  turnoId: string;
  colaboradorId: string;
  restHours: number;
  thresholdHours: number;
  prevShiftEnd: string;   // ISO timestamp
  nextShiftStart: string; // ISO timestamp
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload de la callable transferScheduledShifts
// ─────────────────────────────────────────────────────────────────────────────

export interface TransferRequest {
  /** IDs de los TurnosProgramados origen a trasladar */
  turnoProgramadoIds: string[];
  /** ID de la sucursal destino */
  sucursalDestinoId: string;
  /** Tipo operacional explícito del turno destino */
  tipoOperacion: TipoOperacional;
  /** Motivo del traslado */
  motivo: string;
  /**
   * ID estable de la operación generado por el cliente.
   * Usado para idempotencia: si la callable se llama dos veces
   * con el mismo operationRequestId, el segundo retorno es idempotente.
   */
  operationRequestId: string;
  /** ID de plantilla horaria en destino (opcional) */
  plantillaDestinoId?: string;
  /** Horario manual para el turno destino (opcional, si no hay plantilla) */
  horarioManual?: {
    inicio: string;   // HH:mm
    termino: string;  // HH:mm
    cruzaMedianoche: boolean;
  };
  /**
   * Umbral de descanso en horas (default: 8).
   * Si no se envía, el backend usa 8.
   */
  minRestHours?: number;
  /**
   * Si true, procesa incluso los turnos con insufficient_rest warning.
   * Requiere restWarningMotivo.
   */
  confirmInsufficientRest?: boolean;
  restWarningMotivo?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resultado individual por turno
// ─────────────────────────────────────────────────────────────────────────────

export type TransferItemStatus =
  | 'transferred'
  | 'already_transferred'
  | 'conflict_blocked'
  | 'insufficient_rest_blocked'
  | 'already_exists'   // idempotencia: ya existía el turno destino
  | 'not_found'
  | 'error';

export interface TransferItemResult {
  turnoOrigenId: string;
  status: TransferItemStatus;
  turnoDestinoId?: string;
  conflict?: ConflictDetectionResult;
  restWarning?: InsufficientRestWarning;
  errorMessage?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resultado completo de la callable transferScheduledShifts
// ─────────────────────────────────────────────────────────────────────────────

export interface TransferResult {
  success: boolean;
  correlationId: string;
  operationRequestId: string;
  results: TransferItemResult[];
  /** Contadores de resumen */
  summary: {
    transferred: number;
    conflicts: number;
    alreadyTransferred: number;
    errors: number;
    total: number;
  };
  /** Alertas contractuales detectadas (si estadoContratoVinculado != compatible) */
  contractAlerts: {
    turnoDestinoId: string;
    estadoContratoVinculado: string;
  }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload de la callable revertShiftTransfer
// ─────────────────────────────────────────────────────────────────────────────

export interface RevertTransferRequest {
  /** ID del turno origen (cuyo estado es 'trasladado') */
  turnoOrigenId: string;
  /** Motivo de la reversión */
  motivo: string;
}

export interface RevertTransferResult {
  success: boolean;
  turnoOrigenId: string;
  turnoDestinoId: string;
  /** Si true, la reversión fue bloqueada por existencia de asistencia */
  blocked?: boolean;
  blockReason?: 'existing_attendance' | 'no_relation' | 'origin_not_transferred';
  errorMessage?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Modelo de UI para el modal de traslado
// ─────────────────────────────────────────────────────────────────────────────

export type ModalStep = 'selection' | 'conflict_review' | 'configuration' | 'confirmation';

export interface TransferModalState {
  step: ModalStep;
  colaboradorId: string;
  colaboradorNombre: string;
  colaboradorRut: string;
  sucursalOrigenId: string | number;
  sucursalOrigenNombre: string;
  /** Fechas seleccionadas en formato YYYY-MM-DD */
  fechasSeleccionadas: string[];
  /** Turno origen encontrado por fecha */
  turnosOrigen: {
    fecha: string;
    turnoId: string;
    estado: string;
    horario: { inicio: string; termino: string; cruzaMedianoche: boolean };
  }[];
  sucursalDestinoId: string | number;
  sucursalDestinoNombre: string;
  tipoOperacion: TipoOperacional;
  motivo: string;
  plantillaDestinoId?: string;
  horarioManual?: { inicio: string; termino: string; cruzaMedianoche: boolean };
  confirmInsufficientRest: boolean;
  restWarningMotivo: string;
  /** Preview de conflictos (no autoritativo) */
  conflictPreview: {
    fecha: string;
    turnoId: string;
    conflict: ConflictDetectionResult;
  }[];
  isProcessing: boolean;
  result?: TransferResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reevaluación contractual
// ─────────────────────────────────────────────────────────────────────────────

export type ContractReevalEstado =
  | 'compatible'
  | 'otra_sucursal'
  | 'sin_contrato'
  | 'multiples'
  | 'pendiente_revision';

export interface ContractReevalResult {
  colaboradorId: string;
  sucursalId: string;
  fecha: string;
  estado: ContractReevalEstado;
  contratoIdAsociado?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auditoría — acciones de Fase 4
// ─────────────────────────────────────────────────────────────────────────────

export type Phase4AuditAction =
  | 'TRANSFER_REQUESTED'
  | 'TRANSFER_COMPLETED'
  | 'TRANSFER_REJECTED'
  | 'TRANSFER_REVERTED'
  | 'EXTRA_SHIFT_CREATED'
  | 'CONFLICT_DETECTED'
  | 'CONFLICT_CONFIRMED'
  | 'INSUFFICIENT_REST_WARNING'
  | 'ORIGIN_VACANCY_CREATED'
  | 'REPLACEMENT_ASSIGNED'
  | 'TRANSFER_CONTRACT_ALERT';

export interface Phase4AuditEvent {
  accion: Phase4AuditAction;
  correlationId: string;
  colaboradorId: string;
  turnoOrigenId?: string;
  turnoDestinoId?: string;
  sucursalOrigenId?: string;
  sucursalDestinoId?: string;
  fecha?: string;
  motivo?: string;
  usuarioId: string;
  timestamp: string;
  estadoAnterior?: Record<string, unknown>;
  estadoNuevo?: Record<string, unknown>;
  contextoExtra?: Record<string, unknown>;
}
