'use strict';
/**
 * functions/src/phase4/conflictService.js
 * Fase 4 — Servicio puro de detección de conflictos horarios.
 *
 * NO depende de Firestore ni de Admin SDK.
 * Recibe arrays de turno en memoria y retorna ConflictDetectionResult.
 *
 * Definición de intervalo: [inicio, fin)
 *   - Un turno que termina a 19:30 y otro que comienza a 19:30 NO se superponen.
 *   - Los cálculos se hacen en timestamps Unix (ms).
 *   - Los turnos nocturnos (cruzaMedianoche = true) tienen su finISO al día siguiente.
 *
 * Zona horaria operacional: America/Santiago.
 * Los parámetros recibidos ya vienen con fecha (YYYY-MM-DD) y hora (HH:mm).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de timestamp
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convierte fecha (YYYY-MM-DD) + hora (HH:mm) en timestamp UTC en ms.
 * Interpreta la hora en zona horaria America/Santiago usando offset estimado.
 * Para el emulador y tests, el offset se aplica sumando la diferencia.
 *
 * En producción (Cloud Functions, us-central1) se usa el mismo cálculo.
 * El offset de Santiago es UTC-3 (verano) o UTC-4 (invierno).
 * Para evitar dependencias externas usamos Date.UTC y el offset calculado
 * dinámicamente a partir de Intl.DateTimeFormat.
 */
function toTimestampMs(fecha, hora, cruzaMedianoche = false, esTermino = false) {
  const [year, month, day] = fecha.split('-').map(Number);
  const [h, m] = hora.split(':').map(Number);

  // Calcular el offset de Santiago para esa fecha usando Intl
  // Esto evita hardcodear UTC-3/UTC-4
  const baseDate = new Date(Date.UTC(year, month - 1, day, h, m));
  const formatter = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = formatter.formatToParts(baseDate);
  const pMap = {};
  parts.forEach(p => { pMap[p.type] = p.value; });
  const localY = Number(pMap.year);
  const localM = Number(pMap.month);
  const localD = Number(pMap.day);
  const localH = Number(pMap.hour);
  const localMin = Number(pMap.minute);
  const localMs = Date.UTC(localY, localM - 1, localD, localH, localMin);
  const offsetMs = localMs - baseDate.getTime();

  // Construir timestamp correcto para fecha+hora en Santiago
  let dayOffset = 0;
  if (cruzaMedianoche && esTermino) {
    // Turno nocturno: el término es al día siguiente
    dayOffset = 24 * 60 * 60 * 1000;
  }
  return Date.UTC(year, month - 1, day, h, m) - offsetMs + dayOffset;
}

/**
 * Convierte un turno al rango [inicioMs, finMs).
 * Si cruzaMedianoche, finMs = fecha siguiente + horaTermino.
 */
function toRange(fecha, horario) {
  const inicioMs = toTimestampMs(fecha, horario.inicio, false, false);
  const finMs = toTimestampMs(fecha, horario.termino, horario.cruzaMedianoche, horario.cruzaMedianoche);
  return { inicioMs, finMs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lógica de superposición [inicio, fin)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifica si dos rangos [a1, a2) y [b1, b2) se superponen.
 * Con la definición [inicio, fin), el fin es exclusivo.
 * Superposición existe si y solo si a1 < b2 && b1 < a2.
 */
function rangesOverlap(a1, a2, b1, b2) {
  return a1 < b2 && b1 < a2;
}

/**
 * Determina el tipo de superposición.
 */
function getOverlapType(a1, a2, b1, b2) {
  if (!rangesOverlap(a1, a2, b1, b2)) return 'none';
  if (a1 === b1 && a2 === b2) return 'identical';
  // B contenido en A
  if (b1 >= a1 && b2 <= a2) return 'total';
  // A contenido en B
  if (a1 >= b1 && a2 <= b2) return 'total';
  return 'partial';
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detecta conflicto entre un turno candidato (a crear) y un turno existente.
 *
 * @param {object} candidate - { fecha: string, horario: { inicio, termino, cruzaMedianoche } }
 * @param {object} existing  - { fecha: string, horario: { inicio, termino, cruzaMedianoche }, estado: string }
 * @returns {{ type: string, message: string, restHours?: number }}
 */
function detectConflict(candidate, existing) {
  // Verificar estados que descartan el turno existente de la detección
  if (existing.estado === 'cancelado') {
    return { type: 'none', message: 'Turno existente cancelado, sin conflicto.' };
  }

  if (existing.estado === 'trasladado') {
    // El turno origen ya fue trasladado: no es un activo real
    return { type: 'already_transferred', message: 'El turno ya fue trasladado a otra sucursal.' };
  }

  if (!candidate.horario || !existing.horario) {
    console.error('MISSING HORARIO IN DETECTCONFLICT:', { candidate, existing });
  }
  const { inicioMs: cStart, finMs: cEnd } = toRange(candidate.fecha, candidate.horario);
  const { inicioMs: eStart, finMs: eEnd } = toRange(existing.fecha, existing.horario);

  const overlapType = getOverlapType(cStart, cEnd, eStart, eEnd);

  if (overlapType !== 'none') {
    return {
      type: overlapType,
      message: `Superposición ${overlapType} detectada entre ${candidate.horario.inicio}-${candidate.horario.termino} y ${existing.horario.inicio}-${existing.horario.termino}.`,
    };
  }

  return { type: 'none', message: 'Sin superposición.' };
}

/**
 * Verifica si existe descanso insuficiente entre dos turnos consecutivos.
 * No requiere que haya superposición.
 *
 * @param {object} shiftA - turno anterior: { fecha, horario: { inicio, termino, cruzaMedianoche } }
 * @param {object} shiftB - turno siguiente: { fecha, horario: { inicio, termino, cruzaMedianoche } }
 * @param {number} minRestHours - umbral en horas (default 8)
 * @returns {{ hasWarning: boolean, restHours: number }}
 */
function checkInsufficientRest(shiftA, shiftB, minRestHours = 8) {
  if (!shiftA.horario || !shiftB.horario) {
    console.error('MISSING HORARIO IN SHIFTA OR SHIFTB:', { shiftA, shiftB });
  }
  const { finMs: aEnd } = toRange(shiftA.fecha, shiftA.horario);
  const { inicioMs: bStart } = toRange(shiftB.fecha, shiftB.horario);

  const restMs = bStart - aEnd;
  const restHours = restMs / (1000 * 60 * 60);

  return {
    hasWarning: restHours < minRestHours && restHours >= 0,
    restHours: Math.round(restHours * 10) / 10, // redondear a 1 decimal
  };
}

/**
 * Verifica si existe descanso insuficiente entre un turno candidato y una lista de turnos.
 *
 * @param {object} candidate - turno candidato: { fecha, horario: { inicio, termino, cruzaMedianoche } }
 * @param {object[]} existingShifts - lista de turnos existentes
 * @param {number} minRestHours - umbral en horas (default 8)
 * @returns {{ hasWarning: boolean, restHours?: number, conflictingShiftId?: string }}
 */
function checkInsufficientRestForList(candidate, existingShifts, minRestHours = 8) {
  for (const existing of existingShifts) {
    if (!existing.horario || !existing.fecha) {
      console.warn('Skipping shift because missing horario or fecha:', existing);
      continue;
    }
    // Check candidate AFTER existing
    const resAfter = checkInsufficientRest(existing, candidate, minRestHours);
    if (resAfter.hasWarning) {
      return { ...resAfter, conflictingShiftId: existing.id };
    }
    // Check candidate BEFORE existing
    const resBefore = checkInsufficientRest(candidate, existing, minRestHours);
    if (resBefore.hasWarning) {
      return { ...resBefore, conflictingShiftId: existing.id };
    }
  }
  return { hasWarning: false };
}

/**
 * Detecta conflictos de un turno candidato contra una lista de turnos existentes.
 * Retorna el primer conflicto no-'none', o 'none' si todos pasan.
 *
 * @param {object} candidate - { fecha, horario, colaboradorId }
 * @param {object[]} existingShifts - lista de turnos existentes del mismo colaborador
 * @returns {{ type: string, message: string, conflictingShiftId?: string }}
 */
function detectConflicts(candidate, existingShifts) {
  for (const existing of existingShifts) {
    if (!existing.horario || !existing.fecha) continue;
    const result = detectConflict(candidate, existing);
    if (result.type !== 'none') {
      return { ...result, conflictingShiftId: existing.id };
    }
  }
  return { type: 'none', message: 'Sin conflictos detectados.' };
}

/**
 * Detecta si un turno cruza medianoche.
 * @param {object} horario - { inicio: string, termino: string }
 * @returns {boolean}
 */
function detectCrossOverMidnight(horario) {
  const [startH, startM] = horario.inicio.split(':').map(Number);
  const [endH, endM] = horario.termino.split(':').map(Number);
  const startTotal = startH * 60 + startM;
  const endTotal = endH * 60 + endM;
  // Si la hora de término es menor que la de inicio, cruza medianoche
  return endTotal < startTotal;
}

module.exports = {
  detectConflict,
  detectConflicts,
  checkInsufficientRest,
  checkInsufficientRestForList,
  detectCrossOverMidnight,
  toRange,
  toTimestampMs,
};
