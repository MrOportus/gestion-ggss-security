export type TipoOperacional = 'contractual' | 'extra' | 'cobertura' | 'emergencia' | 'traslado_temporal';
export type EstadoContratoVinculado = 'compatible' | 'otra_sucursal' | 'sin_contrato' | 'multiples' | 'pendiente_revision' | 'resuelto_manual';
export type FeatureFlagState = 'legacy' | 'shadow' | 'new_model' | 'rollback';

export interface Contrato {
  id: string; // Document ID en Firestore
  colaboradorId: string;
  sucursalId: string; // Referencia a la sucursal donde aplica
  tipo: string;
  estado: 'borrador' | 'pendiente_firma' | 'vigente' | 'vencido' | 'finiquitado' | 'anulado';
  fechaInicio: string; // YYYY-MM-DD
  fechaTermino?: string; // YYYY-MM-DD, opcional si es indefinido
  cargo?: string;
  jornada?: string;
  googleDriveUrl?: string; // Enlace al PDF si existe
  creadoEn: string; // Timestamp ISO
  creadoPor: string;
  modificadoEn?: string;
  modificadoPor?: string;
  estadoAuditoria?: string;
}

export interface AsignacionOperacional {
  id: string; // formato: asignacion_{colaboradorId}_{sucursalId}_{mesYYYYMM}
  colaboradorId: string;
  sucursalId: string;
  mes: string; // YYYY-MM
  estado: 'activa' | 'retirada' | 'suspendida';
  patronJornadaId?: string; // Referencia opcional si hay patrón asignado
  fechaInicioPatron?: string;
  creadoEn: string;
  creadoPor: string;
  modificadoEn?: string;
  modificadoPor?: string;
}

export interface HorarioSnapshot {
  inicio: string; // HH:mm
  termino: string; // HH:mm
  cruzaMedianoche: boolean;
  origen: 'plantilla' | 'fallback' | 'manual';
  inicioCompletoISO?: string; // Opcional: Fecha+Hora exacta precalculada
  terminoCompletoISO?: string;
}

export interface TurnoProgramado {
  id: string; // formato: turno_{asignacionId}_{fechaYYYYMMDD}
  asignacionOperacionalId: string;
  colaboradorId: string;
  sucursalId: string;
  fecha: string; // YYYY-MM-DD
  codigo: string; // 'X', 'N', 'D', 'E', etc.
  horarioSnapshot: HorarioSnapshot;
  tipoOperacional: TipoOperacional;
  estado: 'programado' | 'confirmado' | 'cancelado' | 'asistido' | 'ausente' | 'descanso' | 'trasladado' | 'completado';
  motivoCancelacion?: string; // ej: 'traslado_revertido', libre
  esProductivo: boolean;
  requiereAsistencia: boolean;
  contratoIdAsociado?: string; // ID del contrato evaluado
  estadoContrato: EstadoContratoVinculado;
  plantillaIdUsada?: string; // Si provino de una plantilla
  creadoEn: string;
  creadoPor: string;
  modificadoEn?: string;
  modificadoPor?: string;
  nota?: string;

  // ── Fase 4: Campos de traslado (solo escritos desde Admin SDK / Cloud Functions) ──
  /** ID del TurnoProgramado destino creado al trasladar */
  transferredToShiftId?: string;
  /** ID del TurnoProgramado origen (campo en turno destino) */
  transferredFromShiftId?: string;
  /** sucursalId del turno antes del traslado (campo en turno origen) */
  originBranchId?: string;
  /** sucursalId destino (campo en turno origen trasladado) */
  destinationBranchId?: string;
  /** Motivo registrado al operar el traslado */
  transferReason?: string;
  /** ISO timestamp del traslado */
  transferredAt?: string;
  /** UID del operador que ejecutó el traslado */
  transferredBy?: string;
  /** ID común para todo el lote de la operación de traslado */
  correlationId?: string;

  // ── Fase 4: Vacante en origen ──
  /** true cuando el turno fue trasladado y aún no tiene reemplazo */
  requiereCobertura?: boolean;
  /** ID del TurnoProgramado de reemplazo asignado */
  replacementShiftId?: string;

  // ── Fase 4: Advertencia de descanso insuficiente ──
  /** Horas de descanso calculadas entre este turno y el anterior/siguiente */
  restWarningHours?: number;
  /** UID del operador que confirmó continuar pese a la advertencia */
  restWarningConfirmedBy?: string;
  /** ISO timestamp de la confirmación */
  restWarningConfirmedAt?: string;
}

export interface PlantillaTurno {
  id: string; // Document ID
  sucursalId: string;
  codigo: string; // 'X', 'N', etc.
  nombre: string;
  horaInicio: string; // HH:mm
  horaTermino: string; // HH:mm
  cruzaMedianoche: boolean;
  activo: boolean;
  vigenciaDesde: string; // YYYY-MM-DD
  vigenciaHasta?: string; // YYYY-MM-DD
  creadoEn: string;
  creadoPor: string;
}

export interface PatronJornada {
  id: string; // Document ID
  sucursalId?: string; // Si es null/undefined, es global
  nombre: string; // e.g. "4x4", "7x7"
  diasTrabajo: number;
  diasDescanso: number;
  plantillaDiaId?: string;
  plantillaNocheId?: string;
  activo: boolean;
  creadoEn: string;
  creadoPor: string;
}

export interface AuditoriaAccion {
  id: string;
  accion: 'CREATE' | 'UPDATE' | 'DELETE' | 'VERIFY' | 'LINK';
  entidad: 'Contrato' | 'AsignacionOperacional' | 'TurnoProgramado' | 'PlantillaTurno' | 'PatronJornada' | 'FeatureFlag';
  entidadId: string;
  usuarioId: string;
  fecha: string; // ISO
  estadoAnterior?: any;
  estadoNuevo?: any;
  motivo?: string;
  contextoInfo?: Record<string, any>;
}

export interface FeatureFlagConfig {
  id: string; // formato: flag_{sucursalId}_{mesYYYYMM}
  sucursalId: string;
  mes: string;
  estado: FeatureFlagState;
  creadoEn: string;
  creadoPor: string;
  modificadoEn?: string;
  modificadoPor?: string;
}
