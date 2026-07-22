'use strict';

/**
 * attendanceV2QueryService.js
 *
 * Consultas a AsistenciasConsolidadas (colección V2).
 *
 * Orden de paginación estable:
 *   jornadaDate ASC → checkInAt ASC → __name__ ASC (FieldPath.documentId())
 *
 * Nota: `lastDocumentId` en el cursor es el ID real del documento Firestore,
 * usado con orderBy('__name__', 'asc') y .startAfter(). No existe un campo
 * `id` dentro del documento; no se usa.
 *
 * Limitaciones de snapshot isolation:
 *   La paginación NO garantiza snapshot isolation entre páginas.
 *   Si un documento es creado o eliminado entre páginas, puede aparecer
 *   o desaparecer del conjunto de resultados. El campo `readCutoffAt`
 *   del cursor reduce la ventana pero no elimina la inconsistencia.
 *
 * Combinaciones soportadas en branch_range:
 *   1. Sin filtros opcionales          → Índice: sucursalId, jornadaDate, checkInAt
 *   2. Solo `status`                   → Índice: sucursalId, status, jornadaDate, checkInAt
 *   3. Solo `tipoOperacion`            → Índice: sucursalId, tipoOperacion, jornadaDate, checkInAt
 *   4. status + tipoOperacion juntos   → PROHIBIDO en 5D.2D (rechazado con invalid-argument)
 */


const { HttpsError } = require('firebase-functions/v2/https');
const { decodeCursor, createNextCursor } = require('./attendanceV2Pagination');
const { mapV2ToSessionReadModel } = require('./attendanceV2ReadModels');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Construye el resultado paginado estándar.
 * @param {FirebaseFirestore.QuerySnapshot} snapshot
 * @param {number} limit
 * @param {string} queryType
 * @param {Object} filters  — filtros para el próximo cursor (debe incluir actorUid)
 * @param {boolean} includeInvalidated
 * @param {string} [overrideSecret]
 * @returns {Object}
 */
function buildPagedResult(snapshot, limit, queryType, filters, includeInvalidated, overrideSecret) {
  const results = [];
  let hasInvalidDocs = false;

  snapshot.forEach(doc => {
    const model = mapV2ToSessionReadModel(doc, includeInvalidated);
    if (model) {
      results.push(model);
    } else if (doc.exists) {
      // El documento existe pero es inválido (mapV2ToSessionReadModel retornó null)
      // El log ya fue emitido dentro del mapper
      hasInvalidDocs = true;
    }
  });

  const lastDoc = snapshot.docs[snapshot.docs.length - 1];
  const nextCursor = createNextCursor(lastDoc, queryType, filters, overrideSecret);

  return {
    items: results,
    nextCursor,
    hasMore: snapshot.docs.length === limit,
    pageSize: limit,
    hasInvalidDocs
  };
}

// ---------------------------------------------------------------------------
// employee_day
// ---------------------------------------------------------------------------

async function getAttendanceSessionsByEmployeeAndDate(db, employeeId, jornadaDate, includeInvalidated = false) {
  const snapshot = await db.collection('AsistenciasConsolidadas')
    .where('employeeId', '==', employeeId)
    .where('jornadaDate', '==', jornadaDate)
    .orderBy('checkInAt', 'asc')
    .orderBy('__name__', 'asc')
    .get();

  const results = [];
  let hasInvalidDocs = false;
  snapshot.forEach(doc => {
    const model = mapV2ToSessionReadModel(doc, includeInvalidated);
    if (model) results.push(model);
    else if (doc.exists) hasInvalidDocs = true;
  });

  return { items: results, hasInvalidDocs };
}

// ---------------------------------------------------------------------------
// employee_range
// ---------------------------------------------------------------------------

async function getAttendanceSessionsByEmployeeRange(
  db, employeeId, fromDate, toDate, limit, cursorStr, includeInvalidated = false, actorUid = null, overrideSecret = null
) {
  let query = db.collection('AsistenciasConsolidadas')
    .where('employeeId', '==', employeeId)
    .where('jornadaDate', '>=', fromDate)
    .where('jornadaDate', '<=', toDate)
    .orderBy('jornadaDate', 'asc')
    .orderBy('checkInAt', 'asc')
    .orderBy('__name__', 'asc')
    .limit(limit);

  if (cursorStr) {
    const ctx = { actorUid, employeeId, fromDate, toDate, includeInvalidated: includeInvalidated || false };
    const parsed = decodeCursor(cursorStr, 'employee_range', ctx, overrideSecret);
    if (parsed) {
      query = query.startAfter(
        parsed.lastJornadaDate,
        parsed.lastCheckInAt,
        parsed.lastDocumentId
      );
    }
  }

  const snapshot = await query.get();
  const filters = { actorUid, employeeId, fromDate, toDate, includeInvalidated };
  console.log('[V2_QUERY_SERVICE] employee_range filters:', filters);
  return buildPagedResult(snapshot, limit, 'employee_range', filters, includeInvalidated, overrideSecret);
}

// ---------------------------------------------------------------------------
// branch_day
// ---------------------------------------------------------------------------

async function getAttendanceSessionsByBranchAndDate(
  db, sucursalId, jornadaDate, limit, cursorStr, includeInvalidated = false, actorUid = null, overrideSecret = null
) {
  let query = db.collection('AsistenciasConsolidadas')
    .where('sucursalId', '==', sucursalId)
    .where('jornadaDate', '==', jornadaDate)
    .orderBy('checkInAt', 'asc')
    .orderBy('__name__', 'asc')
    .limit(limit);

  if (cursorStr) {
    const ctx = { actorUid, sucursalId, jornadaDate, includeInvalidated: includeInvalidated || false };
    const parsed = decodeCursor(cursorStr, 'branch_day', ctx, overrideSecret);
    if (parsed) {
      query = query.startAfter(
        parsed.lastCheckInAt,
        parsed.lastDocumentId
      );
    }
  }

  const snapshot = await query.get();
  const filters = { actorUid, sucursalId, jornadaDate, includeInvalidated };
  return buildPagedResult(snapshot, limit, 'branch_day', filters, includeInvalidated, overrideSecret);
}

// ---------------------------------------------------------------------------
// branch_range
// Combinaciones soportadas: sin filtros | solo status | solo tipoOperacion
// Prohibido: status + tipoOperacion simultáneamente (no hay índice en 5D.2D)
// ---------------------------------------------------------------------------

async function getAttendanceSessionsByBranchRange(
  db, sucursalId, fromDate, toDate, status, tipoOperacion,
  limit, cursorStr, includeInvalidated = false, actorUid = null, overrideSecret = null
) {
  // Validar combinación prohibida
  if (status && tipoOperacion) {
    throw new HttpsError(
      'invalid-argument',
      'La combinación simultánea de status y tipoOperacion no está soportada en esta fase. Use solo uno de los dos filtros.'
    );
  }

  let query = db.collection('AsistenciasConsolidadas')
    .where('sucursalId', '==', sucursalId)
    .where('jornadaDate', '>=', fromDate)
    .where('jornadaDate', '<=', toDate);

  if (status) {
    query = query.where('status', '==', status);
  } else if (tipoOperacion) {
    query = query.where('tipoOperacion', '==', tipoOperacion);
  }

  query = query
    .orderBy('jornadaDate', 'asc')
    .orderBy('checkInAt', 'asc')
    .orderBy('__name__', 'asc')
    .limit(limit);

  if (cursorStr) {
    const ctx = { actorUid, sucursalId, fromDate, toDate, status: status || null, tipoOperacion: tipoOperacion || null, includeInvalidated: includeInvalidated || false };
    const parsed = decodeCursor(cursorStr, 'branch_range', ctx, overrideSecret);
    if (parsed) {
      query = query.startAfter(
        parsed.lastJornadaDate,
        parsed.lastCheckInAt,
        parsed.lastDocumentId
      );
    }
  }

  const snapshot = await query.get();
  const filters = {
    actorUid,
    sucursalId,
    fromDate,
    toDate,
    status: status || null,
    tipoOperacion: tipoOperacion || null,
    includeInvalidated
  };
  return buildPagedResult(snapshot, limit, 'branch_range', filters, includeInvalidated, overrideSecret);
}

// ---------------------------------------------------------------------------
// checkin_id
// ---------------------------------------------------------------------------

async function getAttendanceSessionByCheckInId(db, checkInId, includeInvalidated = false) {
  // ID canónico V2: manual_{checkInId}
  const v2Id = `manual_${checkInId}`;
  const doc = await db.collection('AsistenciasConsolidadas').doc(v2Id).get();

  const model = mapV2ToSessionReadModel(doc, includeInvalidated);
  const hasInvalidDocs = doc.exists && !model;

  return {
    items: model ? [model] : [],
    hasInvalidDocs,
    nextCursor: null,
    hasMore: false,
    pageSize: 1
  };
}

// ---------------------------------------------------------------------------
// scheduled_shift
// ---------------------------------------------------------------------------

async function getAttendanceSessionsByScheduledShift(db, turnoProgramadoId, includeInvalidated = false) {
  const snapshot = await db.collection('AsistenciasConsolidadas')
    .where('turnoProgramadoId', '==', turnoProgramadoId)
    .orderBy('checkInAt', 'asc')
    .orderBy('__name__', 'asc')
    .get();

  const results = [];
  let hasInvalidDocs = false;
  snapshot.forEach(doc => {
    const model = mapV2ToSessionReadModel(doc, includeInvalidated);
    if (model) results.push(model);
    else if (doc.exists) hasInvalidDocs = true;
  });

  return { items: results, hasInvalidDocs };
}

module.exports = {
  getAttendanceSessionsByEmployeeAndDate,
  getAttendanceSessionsByEmployeeRange,
  getAttendanceSessionsByBranchAndDate,
  getAttendanceSessionsByBranchRange,
  getAttendanceSessionByCheckInId,
  getAttendanceSessionsByScheduledShift
};
