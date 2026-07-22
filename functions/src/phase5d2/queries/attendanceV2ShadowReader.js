'use strict';

/**
 * attendanceV2ShadowReader.js
 *
 * Ejecuta lecturas paralelas (Legacy + V2) y las compara en modo Shadow.
 *
 * Niveles de comparación:
 *
 *   A) Comparación COMPLETA (comparisonScope: "full")
 *      Para: employee_day, branch_day, checkin_id, scheduled_shift
 *      Puede emitir conclusiones globales: missing_legacy, missing_v2,
 *      legacy_overwrite_detected, exact_match, etc.
 *
 *   B) Comparación PAGINADA (comparisonScope: "page")
 *      Para: employee_range, branch_range
 *      Agrupa por (employeeId, jornadaDate).
 *      Solo emite conclusiones sobre grupos COMPLETOS (todos sus docs están en la página).
 *      Grupos parciales → groupsDeferred.
 *      No emite conclusiones globales sobre el rango completo.
 */

const v2Service = require('./attendanceV2QueryService');
const legacyService = require('./legacyAttendanceQueryService');

// ---------------------------------------------------------------------------
// Métricas por grupo de sesiones
// ---------------------------------------------------------------------------

/**
 * Calcula métricas para un array de read models.
 * @param {Array} sessions
 * @returns {Object}
 */
function calculateMetrics(sessions) {
  if (!Array.isArray(sessions)) {
    return {
      numberOfSessions: 0,
      sucursalIds: [],
      attendanceStatuses: [],
      completedSessions: 0,
      workedMinutesTotal: 0
    };
  }

  const validSessions = sessions.filter(
    s => s && s.generationStatus !== 'invalidated'
  );

  const sucursales = new Set();
  const statuses = new Set();
  let completedCount = 0;
  let totalMins = 0;

  for (const s of validSessions) {
    if (s.sucursalId) sucursales.add(s.sucursalId);
    if (s.attendanceStatus) statuses.add(s.attendanceStatus);
    if (s.status === 'closed') completedCount++;
    if (typeof s.workedMinutes === 'number') totalMins += s.workedMinutes;
  }

  return {
    numberOfSessions: validSessions.length,
    sucursalIds: Array.from(sucursales).sort(),
    attendanceStatuses: Array.from(statuses).sort(),
    completedSessions: completedCount,
    workedMinutesTotal: totalMins
  };
}

// ---------------------------------------------------------------------------
// Clasificación de comparación (solo para Nivel A — grupos completos)
// ---------------------------------------------------------------------------

/**
 * Clasifica la comparación entre Legacy y V2.
 * Solo debe llamarse para queryTypes de Nivel A o grupos completos verificados.
 *
 * @param {Object} legacyMetrics
 * @param {Object} v2Metrics
 * @param {number} legacyCount   — total de items legacy (incluyendo posibles inválidos)
 * @param {number} v2Count       — total de items v2
 * @param {boolean} hasV2Invalid — si hubo documentos V2 inválidos excluidos
 * @returns {string} classification status
 */
function classifyComparison(legacyMetrics, v2Metrics, legacyCount, v2Count, hasV2Invalid = false) {
  if (legacyCount === 0 && v2Count === 0) return 'exact_match';
  if (legacyCount > 0 && v2Count === 0) {
    return hasV2Invalid ? 'v2_invalid' : 'missing_v2';
  }
  if (legacyCount === 0 && v2Count > 0) return 'missing_legacy';

  // V2 tiene más de una sesión y Legacy solo tiene una → overwrite
  if (v2Metrics.numberOfSessions > 1 && legacyMetrics.numberOfSessions === 1) {
    return 'legacy_overwrite_detected';
  }

  const sameCount = legacyMetrics.numberOfSessions === v2Metrics.numberOfSessions;
  const sameCompleted = legacyMetrics.completedSessions === v2Metrics.completedSessions;
  const sameMinutes = legacyMetrics.workedMinutesTotal === v2Metrics.workedMinutesTotal;

  if (sameCount && sameCompleted && sameMinutes) return 'exact_match';
  if (sameCount) return 'unexpected_difference';
  if (legacyMetrics.numberOfSessions > 0 && v2Metrics.numberOfSessions > 0) {
    return 'compatible_partial_match';
  }
  return 'unexpected_difference';
}

// ---------------------------------------------------------------------------
// Nivel A: Comparación completa (sin paginación relevante)
// ---------------------------------------------------------------------------

/**
 * Compara Legacy y V2 para queryTypes de Nivel A.
 * Puede emitir conclusiones globales sobre el alcance completo.
 */
async function fullScopeComparison(db, queryType, params) {
  let legacyPromise, v2Promise;
  const startMs = Date.now();

  switch (queryType) {
    case 'employee_day':
      legacyPromise = legacyService.getLegacySessionsByEmployeeAndDate(
        db, params.employeeId, params.jornadaDate
      );
      v2Promise = v2Service.getAttendanceSessionsByEmployeeAndDate(
        db, params.employeeId, params.jornadaDate, params.includeInvalidated
      );
      break;
    case 'branch_day':
      legacyPromise = legacyService.getLegacySessionsByBranchAndDate(
        db, params.sucursalId, params.jornadaDate, params.limit, params.cursorContext, params.overrideSecret, params
      );
      v2Promise = v2Service.getAttendanceSessionsByBranchAndDate(
        db, params.sucursalId, params.jornadaDate, params.limit, params.cursor, params.includeInvalidated, params.actorUid, params.overrideSecret
      );
      break;
    case 'checkin_id':
      legacyPromise = legacyService.getLegacySessionByCheckInId(db, params.checkInId);
      v2Promise = v2Service.getAttendanceSessionByCheckInId(db, params.checkInId, params.includeInvalidated);
      break;
    case 'scheduled_shift':
      legacyPromise = legacyService.getLegacySessionsByScheduledShift(db, params.turnoProgramadoId);
      v2Promise = v2Service.getAttendanceSessionsByScheduledShift(db, params.turnoProgramadoId, params.includeInvalidated);
      break;
    default:
      throw new Error(`fullScopeComparison: queryType no soportado: ${queryType}`);
  }

  const [legacyResult, v2Result] = await Promise.all([legacyPromise, v2Promise]);
  const durationMs = Date.now() - startMs;

  const legacyItems = Array.isArray(legacyResult)
    ? legacyResult
    : (legacyResult?.items || []);
  const v2Items = Array.isArray(v2Result)
    ? v2Result
    : (v2Result?.items || []);

  // Detectar si hubo documentos V2 inválidos (el servicio los excluye, pero
  // podemos saberlo si el snapshot tenía más docs de los que retornó — esto
  // se registra con warnings en el resultado si el servicio los expone)
  const hasV2Invalid = v2Result?.hasInvalidDocs === true;

  const legacyMetrics = calculateMetrics(legacyItems);
  const v2Metrics = calculateMetrics(v2Items);
  const status = classifyComparison(
    legacyMetrics, v2Metrics, legacyItems.length, v2Items.length, hasV2Invalid
  );

  const comparison = {
    employeeId: params.employeeId || 'multiple',
    jornadaDate: params.jornadaDate || 'single',
    legacy: legacyMetrics,
    v2: v2Metrics,
    status,
    comparisonScope: 'full',
    comparisonComplete: true
  };

  return {
    legacyResult,
    v2Result,
    comparison,
    metrics: {
      durationMs,
      legacyDocsRead: legacyItems.length,
      v2DocsRead: v2Items.length
    }
  };
}

// ---------------------------------------------------------------------------
// Nivel B: Comparación paginada (employee_range, branch_range)
// ---------------------------------------------------------------------------

/**
 * Agrupa los items por (employeeId, jornadaDate).
 * @param {Array} items
 * @returns {Map<string, Array>} clave: "employeeId|jornadaDate"
 */
function groupByEmployeeJornada(items) {
  const groups = new Map();
  for (const item of items) {
    const key = `${item.employeeId || 'unknown'}|${item.jornadaDate || 'unknown'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

/**
 * Compara Legacy y V2 para queryTypes de Nivel B (range).
 * Agrupa por (employeeId, jornadaDate) y solo compara grupos completos.
 * Declara comparisonScope: "page" y no emite conclusiones globales.
 */
async function pagedScopeComparison(db, queryType, params) {
  let legacyPromise, v2Promise;
  const startMs = Date.now();

  switch (queryType) {
    case 'employee_range':
      legacyPromise = legacyService.getLegacySessionsByEmployeeRange(
        db, params.employeeId, params.fromDate, params.toDate, params.limit, params.cursorContext, params.overrideSecret, params
      );
      v2Promise = v2Service.getAttendanceSessionsByEmployeeRange(
        db, params.employeeId, params.fromDate, params.toDate, params.limit, params.cursor, params.includeInvalidated, params.actorUid, params.overrideSecret
      );
      break;
    case 'branch_range':
      legacyPromise = legacyService.getLegacySessionsByBranchRange(
        db, params.sucursalId, params.fromDate, params.toDate,
        params.status, params.tipoOperacion, params.limit, params.cursorContext, params.overrideSecret, params
      );
      v2Promise = v2Service.getAttendanceSessionsByBranchRange(
        db, params.sucursalId, params.fromDate, params.toDate,
        params.status, params.tipoOperacion, params.limit, params.cursor, params.includeInvalidated, params.actorUid, params.overrideSecret
      );
      break;
    default:
      throw new Error(`pagedScopeComparison: queryType no soportado: ${queryType}`);
  }

  const [legacyResult, v2Result] = await Promise.all([legacyPromise, v2Promise]);
  const durationMs = Date.now() - startMs;

  const legacyItems = Array.isArray(legacyResult)
    ? legacyResult
    : (legacyResult?.items || []);
  const v2Items = Array.isArray(v2Result)
    ? v2Result
    : (v2Result?.items || []);

  // Agrupar por (employeeId, jornadaDate)
  const legacyGroups = groupByEmployeeJornada(legacyItems);
  const v2Groups = groupByEmployeeJornada(v2Items);

  // Determinar todos los grupos en la página
  const allGroupKeys = new Set([...legacyGroups.keys(), ...v2Groups.keys()]);

  // Un grupo se considera "completo" solo si ambas colecciones (legacy y v2)
  // no tienen más documentos fuera de la página para ese grupo.
  // En una comparación paginada, solo podemos saber que el grupo está completo
  // si NINGUNA de las colecciones truncó en ese (employeeId, jornadaDate).
  // Por simplicidad conservadora: si hay paginación activa (hasMore === true),
  // todos los grupos del borde del cursor se marcan como deferred.

  const hasMoreLegacy = legacyResult?.hasMore === true;
  const hasMoreV2 = v2Result?.hasMore === true;

  // El último grupo en lexicographic order puede estar incompleto si hay más páginas
  let deferredKeys = new Set();
  if (hasMoreLegacy || hasMoreV2) {
    // El último grupo visible puede estar partido entre páginas; lo diferimos
    const sortedKeys = Array.from(allGroupKeys).sort();
    if (sortedKeys.length > 0) {
      deferredKeys.add(sortedKeys[sortedKeys.length - 1]);
    }
  }

  const groupComparisons = [];
  let groupsDeferred = deferredKeys.size;

  for (const key of allGroupKeys) {
    if (deferredKeys.has(key)) continue;

    const [employeeId, jornadaDate] = key.split('|');
    const lItems = legacyGroups.get(key) || [];
    const vItems = v2Groups.get(key) || [];

    const lMetrics = calculateMetrics(lItems);
    const vMetrics = calculateMetrics(vItems);
    const groupStatus = classifyComparison(lMetrics, vMetrics, lItems.length, vItems.length);

    groupComparisons.push({
      employeeId,
      jornadaDate,
      legacy: lMetrics,
      v2: vMetrics,
      status: groupStatus
    });
  }

  const groupsCompared = groupComparisons.length;

  const comparison = {
    comparisonScope: 'page',
    comparisonComplete: false,
    comparisonCoverage: `${groupsCompared}/${groupsCompared + groupsDeferred} groups compared`,
    groupsCompared,
    groupsDeferred,
    groupDetails: groupComparisons,
    // Advertencia explícita: no emitir conclusiones globales sobre el rango
    note: 'Partial page comparison. Do not interpret as definitive for the full date range.'
  };

  return {
    legacyResult,
    v2Result,
    comparison,
    metrics: {
      durationMs,
      legacyDocsRead: legacyItems.length,
      v2DocsRead: v2Items.length
    }
  };
}

// ---------------------------------------------------------------------------
// Dispatcher principal
// ---------------------------------------------------------------------------

/** Querytype que requiere comparación completa */
const FULL_SCOPE_TYPES = new Set(['employee_day', 'branch_day', 'checkin_id', 'scheduled_shift']);

/** Querytype que requiere comparación paginada */
const PAGED_SCOPE_TYPES = new Set(['employee_range', 'branch_range']);

/**
 * Punto de entrada para el Shadow Reader.
 * Despacha al nivel de comparación apropiado según queryType.
 */
async function getAttendanceShadowComparison(db, queryType, params) {
  if (FULL_SCOPE_TYPES.has(queryType)) {
    return fullScopeComparison(db, queryType, params);
  }
  if (PAGED_SCOPE_TYPES.has(queryType)) {
    return pagedScopeComparison(db, queryType, params);
  }
  throw new Error(`getAttendanceShadowComparison: queryType desconocido: ${queryType}`);
}

module.exports = {
  getAttendanceShadowComparison,
  calculateMetrics,
  classifyComparison
};
