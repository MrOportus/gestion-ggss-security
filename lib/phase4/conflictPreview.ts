/**
 * lib/phase4/conflictPreview.ts
 * Fase 4 — Preview de conflictos en el frontend.
 *
 * IMPORTANTE: Este servicio NO es autoritativo.
 * La decisión final sobre conflictos la toma el backend (callable).
 * Este módulo ofrece una previsualización informativa y de bloqueo en el modal.
 *
 * Hotfix 5C.1: Detección cross-branch — consulta TODAS las sucursales del colaborador,
 * incluyendo fechas adyacentes para turnos nocturnos que cruzan la medianoche.
 * También consulta la colección `programacion` legacy.
 */

import { db } from '../firebase';
import {
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import type { TurnoProgramado } from '../../types/phase1';
import type {
  ConflictDetectionResult,
  ConflictType,
  InsufficientRestWarning,
} from '../../types/phase4';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de timestamp (misma lógica que conflictService.js)
// ─────────────────────────────────────────────────────────────────────────────

function toTimestampMs(
  fecha: string,
  hora: string,
  cruzaMedianoche = false,
  esTermino = false
): number {
  const [year, month, day] = fecha.split('-').map(Number);
  const [h, m] = hora.split(':').map(Number);

  const baseDate = new Date(Date.UTC(year, month - 1, day, h, m));
  const formatter = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(baseDate);
  const pMap: Record<string, string> = {};
  parts.forEach(p => { pMap[p.type] = p.value; });
  const localMs = Date.UTC(
    Number(pMap.year),
    Number(pMap.month) - 1,
    Number(pMap.day),
    Number(pMap.hour),
    Number(pMap.minute)
  );
  const offsetMs = localMs - baseDate.getTime();
  const dayOffsetMs = cruzaMedianoche && esTermino ? 24 * 60 * 60 * 1000 : 0;

  return Date.UTC(year, month - 1, day, h, m) - offsetMs + dayOffsetMs;
}

function toRange(
  fecha: string,
  horario: { inicio: string; termino: string; cruzaMedianoche?: boolean }
): { inicioMs: number; finMs: number } {
  const cruza = horario.cruzaMedianoche ?? false;
  return {
    inicioMs: toTimestampMs(fecha, horario.inicio, false, false),
    finMs: toTimestampMs(fecha, horario.termino, cruza, cruza),
  };
}

function getOverlapType(
  a1: number,
  a2: number,
  b1: number,
  b2: number
): ConflictType {
  if (!(a1 < b2 && b1 < a2)) return 'none';
  if (a1 === b1 && a2 === b2) return 'identical';
  if ((b1 >= a1 && b2 <= a2) || (a1 >= b1 && a2 <= b2)) return 'total';
  return 'partial';
}

/** Suma N días a una fecha YYYY-MM-DD */
function addDays(fecha: string, n: number): string {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export interface ConflictPreviewInput {
  colaboradorId: string;
  fecha: string;           // YYYY-MM-DD (fecha operacional del turno candidato)
  horario: {
    inicio: string;
    termino: string;
    cruzaMedianoche: boolean;
  };
  excludeShiftId?: string; // ID del turno siendo editado (excluir de la comparación)
  codigoTurno?: string;    // Para excluir descanso 'D'
}

/** Resultado extendido con detalle de la sucursal conflictiva */
export interface ConflictPreviewResult extends ConflictDetectionResult {
  sucursalConflictiva?: string | number;
  codigoConflicto?: string;
  fechaConflicto?: string;
  inicioConflicto?: string;
  terminoConflicto?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalizador de turno desde programacion legacy
// ─────────────────────────────────────────────────────────────────────────────

/** Mapea un doc de `programacion` a la interfaz mínima de TurnoProgramado */
function normalizeLegacyDoc(id: string, data: Record<string, any>): TurnoProgramado & { id: string } {
  // La colección `programacion` usa status en vez de estado
  const status = data.status as string | undefined;
  const cruzaMedianoche = status === 'noche';
  return {
    id,
    colaboradorId: data.employeeId || data.colaboradorId || '',
    fecha: data.date || data.fecha || '',
    sucursalId: data.siteId,
    codigo: cruzaMedianoche ? 'N' : 'X',
    estado: status === 'programado' || status === 'noche' ? 'programado' : (status || 'programado'),
    horarioSnapshot: {
      inicio: data.inicio || '07:30',
      termino: data.termino || (cruzaMedianoche ? '07:30' : '19:30'),
      cruzaMedianoche,
    },
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Consulta TurnosProgramados Y programacion legacy del colaborador en la fecha dada
 * y en las fechas adyacentes (para cubrir turnos N que cruzan medianoche).
 * Detecta conflictos cruzando TODAS las sucursales.
 *
 * No considera estados 'cancelado', 'descanso' ni 'trasladado' (origen) como activos.
 * Incluye destinos de traslado y turnos extra/cobertura.
 */
export async function previewConflict(
  input: ConflictPreviewInput
): Promise<ConflictPreviewResult> {
  const { colaboradorId, fecha, horario, excludeShiftId, codigoTurno } = input;

  // Código D (descanso) no produce conflicto productivo
  if (codigoTurno === 'D' || codigoTurno === 'descanso') {
    return { type: 'none', message: 'Turno de descanso no genera conflicto.' };
  }

  // Recopilar turnos existentes en fecha, fecha-1 y fecha+1 (para cubre nocturnos)
  const fechasAConsultar = [addDays(fecha, -1), fecha, addDays(fecha, 1)];
  const allExisting: Array<TurnoProgramado & { id: string }> = [];

  // ── 1. Consultar TurnosProgramados (canónico) ──────────────────────────────
  for (const f of fechasAConsultar) {
    const q = query(
      collection(db, 'TurnosProgramados'),
      where('colaboradorId', '==', colaboradorId),
      where('fecha', '==', f)
    );
    const snap = await getDocs(q);
    snap.docs.forEach(d => allExisting.push({ id: d.id, ...d.data() } as any));
  }

  // ── 2. Consultar programacion legacy ──────────────────────────────────────
  for (const f of fechasAConsultar) {
    const q = query(
      collection(db, 'programacion'),
      where('employeeId', '==', colaboradorId),
      where('date', '==', f)
    );
    const snap = await getDocs(q);
    snap.docs.forEach(d => allExisting.push(normalizeLegacyDoc(d.id, d.data())));
  }

  const { inicioMs: cStart, finMs: cEnd } = toRange(fecha, horario);

  for (const existing of allExisting) {
    // Excluir el mismo turno siendo editado
    if (excludeShiftId && existing.id === excludeShiftId) continue;

    // Ignorar estados inactivos
    if (!existing.horarioSnapshot) continue;
    const estado = (existing.estado || '').toLowerCase();
    if (estado === 'cancelado') continue;
    if (estado === 'descanso') continue;
    if (existing.codigo === 'D') continue;

    // El origen de un traslado NO genera conflicto (ya fue cedido)
    if (estado === 'trasladado') continue;

    const existingFecha = existing.fecha || fecha;
    const { inicioMs: eStart, finMs: eEnd } = toRange(existingFecha, {
      inicio: existing.horarioSnapshot.inicio,
      termino: existing.horarioSnapshot.termino,
      cruzaMedianoche: existing.horarioSnapshot.cruzaMedianoche ?? false,
    });

    const type = getOverlapType(cStart, cEnd, eStart, eEnd);
    if (type !== 'none') {
      return {
        type,
        message: `Superposición ${type} con turno existente ${existing.horarioSnapshot.inicio}–${existing.horarioSnapshot.termino}.`,
        conflictingShiftId: existing.id,
        sucursalConflictiva: existing.sucursalId,
        codigoConflicto: existing.codigo,
        fechaConflicto: existingFecha,
        inicioConflicto: existing.horarioSnapshot.inicio,
        terminoConflicto: existing.horarioSnapshot.termino,
      };
    }
  }

  return { type: 'none', message: 'Sin conflictos detectados.' };
}

/**
 * Calcula advertencia de descanso insuficiente entre dos turnos.
 * Informativo — no autoritativo.
 */
export function previewInsufficientRest(
  turnoAnterior: { fecha: string; horario: { inicio: string; termino: string; cruzaMedianoche: boolean } },
  turnoSiguiente: { fecha: string; horario: { inicio: string; termino: string; cruzaMedianoche: boolean } },
  minRestHours = 8
): InsufficientRestWarning | null {
  const { finMs: aEnd } = toRange(turnoAnterior.fecha, turnoAnterior.horario);
  const { inicioMs: bStart } = toRange(turnoSiguiente.fecha, turnoSiguiente.horario);

  const restMs = bStart - aEnd;
  const restHours = Math.round((restMs / (1000 * 60 * 60)) * 10) / 10;

  if (restHours >= 0 && restHours < minRestHours) {
    return {
      turnoId: '',
      colaboradorId: '',
      restHours,
      thresholdHours: minRestHours,
      prevShiftEnd: new Date(aEnd).toISOString(),
      nextShiftStart: new Date(bStart).toISOString(),
    };
  }
  return null;
}

/**
 * Ejecuta preview de conflicto para múltiples fechas/turnos.
 */
export async function previewMultipleConflicts(
  inputs: ConflictPreviewInput[]
): Promise<{ fecha: string; conflict: ConflictPreviewResult }[]> {
  const results = await Promise.all(
    inputs.map(async input => ({
      fecha: input.fecha,
      conflict: await previewConflict(input),
    }))
  );
  return results;
}
