'use strict';

/**
 * attendanceV2ReadModels.js
 *
 * Funciones de mapeo para convertir documentos Firestore crudos al modelo de lectura.
 *
 * Política de datos personales:
 *   - employeeRut: NUNCA se incluye en la respuesta (minimización de datos).
 *   - employeeName: se incluye como nombre operacional (no sensible a este nivel).
 *
 * Validaciones de documentos V2 inválidos:
 *   - schemaVersion !== 2 → excluido + log estructurado
 *   - checkInId ausente → excluido
 *   - employeeId ausente → excluido
 *   - jornadaDate formato inválido → excluido
 *   - workedMinutes < 0 → normalizado a null + warning
 *   - generationStatus: 'invalidated' → excluido (a menos que includeInvalidated)
 *   - sucursalResolution: 'unresolved' con sucursalId informado → warning (no excluido)
 *   - Documento corrupto NO se revela al cliente; solo log estructurado con documentId
 */

const JORNADA_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Registra un documento V2 inválido. No revela datos del documento al cliente.
 * @param {string} docId
 * @param {string} reason
 */
function logInvalidV2Doc(docId, reason) {
  console.warn(JSON.stringify({
    severity: 'WARNING',
    event: 'v2_invalid_document',
    documentId: docId,
    reason
    // No se incluyen datos del documento
  }));
}

/**
 * Normaliza un documento V2 de AsistenciasConsolidadas al AttendanceSessionReadModel.
 * Retorna null si el documento es inválido (y lo registra).
 *
 * @param {FirebaseFirestore.DocumentSnapshot} doc
 * @param {boolean} includeInvalidated
 * @returns {Object|null}
 */
function mapV2ToSessionReadModel(doc, includeInvalidated = false) {
  if (!doc.exists) return null;

  const data = doc.data();
  const docId = doc.id;

  // --- Validaciones estructurales (documento inválido → excluir) ---

  if (!data.checkInId) {
    logInvalidV2Doc(docId, 'missing_checkInId');
    return null;
  }

  if (!data.employeeId) {
    logInvalidV2Doc(docId, 'missing_employeeId');
    return null;
  }

  if (!data.jornadaDate || !JORNADA_DATE_RE.test(data.jornadaDate)) {
    logInvalidV2Doc(docId, 'invalid_jornadaDate');
    return null;
  }

  if (typeof data.schemaVersion !== 'number' || data.schemaVersion !== 2) {
    logInvalidV2Doc(docId, `invalid_schemaVersion:${data.schemaVersion}`);
    return null;
  }

  // --- Validar generationStatus ---
  const genStatus = data.generationStatus || 'active';
  if (genStatus === 'invalidated' && !includeInvalidated) {
    return null; // Excluir silenciosamente; no es un documento corrupto
  }

  const warnings = [];

  if (genStatus === 'disabled') {
    warnings.push('record_disabled');
  }

  // --- Validar workedMinutes ---
  let workedMinutes = null;
  if (typeof data.workedMinutes === 'number') {
    if (data.workedMinutes < 0) {
      warnings.push('negative_workedMinutes_normalized');
      workedMinutes = null;
    } else {
      workedMinutes = data.workedMinutes;
    }
  }

  // --- Validar sucursalResolution ---
  const sucursalResolution = data.sucursalResolution || 'explicit';
  if (sucursalResolution === 'unresolved' && data.sucursalId) {
    warnings.push('sucursal_resolution_unresolved');
  }

  // --- Construir Read Model (sin employeeRut) ---
  return {
    id: docId,
    checkInId: data.checkInId,
    checkOutId: data.checkOutId || null,
    employeeId: data.employeeId,
    employeeName: data.employeeName || null,
    // employeeRut: OMITIDO POR POLÍTICA DE MINIMIZACIÓN
    jornadaDate: data.jornadaDate,
    timezone: data.timezone || 'America/Santiago',

    turnoProgramadoId: data.turnoProgramadoId || null,
    asignacionOperacionalId: data.asignacionOperacionalId || null,
    codigoTurno: data.codigoTurno || 'desconocido',
    tipoOperacion: data.tipoOperacion || 'desconocida',

    sucursalId: data.sucursalId || null,
    sucursalNombre: data.sucursalNombre || null,
    sucursalResolution,

    status: (data.status === 'completed' || data.status === 'closed') ? 'closed' : 'open',
    attendanceStatus: data.attendanceStatus || 'presente',

    checkInAt: data.checkInAt || null,
    checkOutAt: data.checkOutAt || null,
    scheduledStartAt: data.scheduledStartAt || null,
    scheduledEndAt: data.scheduledEndAt || null,
    workedMinutes,

    closureType: data.closureType || 'none',
    closureOrigin: data.closureOrigin || 'none',

    source: 'v2',
    generationStatus: genStatus,
    schemaVersion: 2,

    warnings
  };
}

/**
 * Normaliza un documento de asistencia_manual al AttendanceSessionReadModel.
 * Retorna null si el documento es inválido.
 *
 * @param {FirebaseFirestore.DocumentSnapshot} doc
 * @returns {Object|null}
 */
function mapLegacyToSessionReadModel(doc) {
  if (!doc.exists) return null;

  const data = doc.data();
  const docId = doc.id;

  if (!data.employeeId || !data.date) {
    console.warn(JSON.stringify({
      severity: 'WARNING',
      event: 'legacy_invalid_document',
      documentId: docId,
      reason: 'missing_employeeId_or_date'
    }));
    return null;
  }

  const limitations = [
    'single_daily_record',
    'missing_checkin_reference',
    'missing_checkout_reference'
  ];

  let workedMinutes = null;
  if (typeof data.horas === 'number' && data.horas >= 0) {
    workedMinutes = data.horas * 60;
  } else if (typeof data.horas === 'number') {
    limitations.push('negative_horas_normalized');
  } else {
    limitations.push('missing_worked_minutes');
  }

  let checkInAt = null;
  if (data.checkInTime) {
    checkInAt = `${data.date}T${data.checkInTime}:00Z`;
  }

  let checkOutAt = null;
  if (data.checkOutTime) {
    checkOutAt = `${data.date}T${data.checkOutTime}:00Z`;
  }

  return {
    id: docId,
    checkInId: data.checkInId || `legacy_chk_${docId}`,
    checkOutId: data.checkOutId || null,
    employeeId: data.employeeId,
    employeeName: data.colaboradorNombre || null,
    // employeeRut: OMITIDO POR POLÍTICA DE MINIMIZACIÓN
    jornadaDate: data.date,
    timezone: 'America/Santiago',

    turnoProgramadoId: data.turnoProgramadoId || null,
    asignacionOperacionalId: null,
    codigoTurno: data.codigoTurno || 'desconocido',
    tipoOperacion: 'desconocida',

    sucursalId: data.sucursalId || 'desconocida',
    sucursalNombre: data.sucursalNombre || null,
    sucursalResolution: 'legacy',

    status: data.checkOutTime ? 'closed' : 'open',
    attendanceStatus: data.estadoAsistencia
      ? data.estadoAsistencia.toLowerCase()
      : 'presente',

    checkInAt,
    checkOutAt,
    scheduledStartAt: null,
    scheduledEndAt: null,
    workedMinutes,

    closureType: data.isAutoClosed
      ? 'auto'
      : data.checkOutTime
        ? 'manual'
        : 'none',
    closureOrigin: 'none',

    source: 'legacy',
    generationStatus: 'active',
    schemaVersion: 1,

    warnings: ['legacy_document_incomplete_data'],
    limitations
  };
}

/**
 * Construye un AttendanceDaySummaryReadModel para un empleado en una jornada.
 * sessions siempre es arreglo; workedMinutesTotal no suma null.
 *
 * @param {string} employeeId
 * @param {string} jornadaDate
 * @param {Array} sessions  — AttendanceSessionReadModel[]
 * @returns {Object}
 */
function buildDaySummary(employeeId, jornadaDate, sessions) {
  const arr = Array.isArray(sessions) ? sessions : [];
  const sessionCount = arr.length;
  const workedMinutesTotal = arr.reduce((acc, s) => {
    return acc + (typeof s.workedMinutes === 'number' ? s.workedMinutes : 0);
  }, 0);
  const sucursalIds = [...new Set(arr.map(s => s.sucursalId).filter(Boolean))];

  return {
    employeeId,
    jornadaDate,
    sessions: arr,
    sessionCount,
    hasMultipleSessions: sessionCount > 1,
    workedMinutesTotal,
    sucursalIds
  };
}

/**
 * Construye un AttendanceBranchDaySummaryReadModel para una sucursal en una jornada.
 *
 * @param {string} sucursalId
 * @param {string} jornadaDate
 * @param {Array} sessions — AttendanceSessionReadModel[]
 * @returns {Object}
 */
function buildBranchDaySummary(sucursalId, jornadaDate, sessions) {
  const arr = Array.isArray(sessions) ? sessions : [];
  const uniqueEmployees = new Set(arr.map(s => s.employeeId).filter(Boolean)).size;

  return {
    sucursalId,
    jornadaDate,
    sessions: arr,
    totalSessions: arr.length,
    sessionCount: arr.length,
    uniqueEmployees
  };
}

module.exports = {
  mapV2ToSessionReadModel,
  mapLegacyToSessionReadModel,
  buildDaySummary,
  buildBranchDaySummary
};
