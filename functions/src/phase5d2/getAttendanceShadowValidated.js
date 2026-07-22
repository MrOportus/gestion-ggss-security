'use strict';

/**
 * getAttendanceShadowValidated.js
 *
 * Callable de Firebase Functions para consultas de asistencia Legacy/V2
 * con soporte de Shadow Read.
 *
 * Orden de ejecución:
 *   1. Autenticar (uid presente)
 *   2. Validar rol base
 *   3. Validar Feature Flag → determinar readMode
 *   4. Validar alcance de sucursal
 *   5. Validar payload (queryType, fechas, parámetros)
 *   6. Verificar cursor firmado si existe
 *   7. Calcular payloadHash (SHA256 normalizado, sin cursor completo)
 *   8. Verificar idempotencia (auditRef existente)
 *   9. Ejecutar consulta
 *  10. Construir resultado
 *  11. Persistir auditoría
 *  12. Retornar resultado
 *
 * Política de auditoría:
 *   - Retry idéntico (mismo actorUid + requestId + payloadHash): re-ejecutar consulta,
 *     no duplicar auditoría, retornar datos actuales.
 *   - Retry con payloadHash distinto: rechazar con request_id_reused.
 *   - Si la persistencia de auditoría falla en primera llamada: rechazar (fail closed).
 *
 * Datos personales:
 *   - employeeRut NUNCA se incluye en la respuesta ni en la auditoría.
 *   - La auditoría registra conteos, duración y comparisonScope, no resultados completos.
 */

const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');

// 1. Declarar el secreto de Secret Manager (asegura su disponibilidad en Cloud Functions)
const cursorSecret = defineSecret('CURSOR_SIGNING_SECRET');

const {
  validateQueryType,
  validateLimit,
  validateDateOnly,
  validateDateRange,
  validateRequiredParam
} = require('./queries/attendanceV2QueryValidators');

const {
  validateBranchAccess,
  evaluateReadFeatureFlag,
  validateBaseRole
} = require('./queries/attendanceV2AccessControl');

const { getAttendanceShadowComparison } = require('./queries/attendanceV2ShadowReader');
const legacyService = require('./queries/legacyAttendanceQueryService');
const v2Service = require('./queries/attendanceV2QueryService');
const { decodeCursor, extractCursorPayloadForHash } = require('./queries/attendanceV2Pagination');

// ---------------------------------------------------------------------------
// payloadHash — SHA256 del payload normalizado
// ---------------------------------------------------------------------------

/**
 * Calcula el hash SHA256 del payload normalizado para idempotencia.
 * No incluye el cursor firmado completo (tiene issuedAt variable);
 * incluye el payload del cursor normalizado (sin issuedAt/expiresAt).
 *
 * @param {Object} params
 * @param {string} readMode
 * @param {string|null} cursorStr  — cursor original para extraer payload normalizado
 * @returns {string}  hex digest
 */
function computePayloadHash(params, readMode, cursorStr) {
  const normalized = {
    queryType: params.queryType || null,
    employeeId: params.employeeId || null,
    sucursalId: params.sucursalId || null,
    jornadaDate: params.jornadaDate || null,
    fromDate: params.fromDate || null,
    toDate: params.toDate || null,
    status: params.status || null,
    tipoOperacion: params.tipoOperacion || null,
    limit: params.safeLimit || null,
    includeInvalidated: params.safeIncludeInvalidated || false,
    checkInId: params.checkInId || null,
    turnoProgramadoId: params.turnoProgramadoId || null,
    readMode,
    // Payload del cursor normalizado (sin issuedAt/expiresAt/firma)
    cursorPayload: cursorStr
      ? extractCursorPayloadForHash(cursorStr)
      : null
  };

  const stableJson = JSON.stringify(normalized, Object.keys(normalized).sort());
  return crypto.createHash('sha256').update(stableJson, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Core de la Callable (separado para testing con emulador)
// ---------------------------------------------------------------------------

/**
 * Lógica core de getAttendanceShadowValidated.
 * Recibe (db, requestData, actorUid) para ser testeable directamente.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} requestData  — equivale a request.data de la Callable
 * @param {string} actorUid     — equivale a request.auth.uid
 */
async function executeAttendanceShadowValidated(db, requestData, actorUid) {

  // 1. Autenticar
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para consultar asistencias.');
  }

  // 2. Validar rol base
  const actorDoc = await db.collection('Colaboradores').doc(actorUid).get();
  if (!actorDoc.exists) {
    throw new HttpsError('permission-denied', 'Usuario no encontrado en la base de datos.');
  }
  const actorRole = actorDoc.data().role;
  validateBaseRole(actorRole);

  // Extraer parámetros del requestData (no de request.data directamente)
  const {
    queryType,
    employeeId,
    sucursalId,
    jornadaDate,
    fromDate,
    toDate,
    status,
    tipoOperacion,
    limit,
    cursor,
    requestId,
    checkInId,
    turnoProgramadoId,
    includeInvalidated
  } = requestData;

  // 5a. Validar requestId obligatorio
  validateRequiredParam('requestId', requestId);

  // 5b. Validar queryType
  validateQueryType(queryType);

  // 5c. Límites
  const safeLimit = validateLimit(limit);
  let safeIncludeInvalidated = false;
  if (includeInvalidated === true) {
    if (actorRole === 'admin') {
      safeIncludeInvalidated = true;
    } else {
      throw new HttpsError('permission-denied', 'Solo los administradores pueden consultar registros invalidados.');
    }
  }

  // 3. Feature Flag → readMode
  const mode = await evaluateReadFeatureFlag(db, actorUid, sucursalId, jornadaDate || fromDate);

  // 4. Validar alcance + 5d. Validar parámetros según queryType
  if (['branch_day', 'branch_range'].includes(queryType)) {
    validateRequiredParam('sucursalId', sucursalId);
    await validateBranchAccess(db, actorUid, actorRole, sucursalId);
    if (queryType === 'branch_day') {
      validateDateOnly(jornadaDate);
    } else {
      validateDateRange(fromDate, toDate);
      if (status && tipoOperacion) {
        throw new HttpsError('invalid-argument', 'No se permite filtrar por status y tipoOperacion simultáneamente.');
      }
    }
  } else if (['employee_day', 'employee_range'].includes(queryType)) {
    validateRequiredParam('employeeId', employeeId);
    if (actorRole !== 'admin') {
      validateRequiredParam('sucursalId', sucursalId);
      await validateBranchAccess(db, actorUid, actorRole, sucursalId);
    }
    if (queryType === 'employee_day') {
      validateDateOnly(jornadaDate);
    } else {
      validateDateRange(fromDate, toDate);
    }
  } else if (queryType === 'checkin_id') {
    validateRequiredParam('checkInId', checkInId);
  } else if (queryType === 'scheduled_shift') {
    validateRequiredParam('turnoProgramadoId', turnoProgramadoId);
  }

  // Requerir el secreto desde Secret Manager o Fallback (emulador)
  const secretKey = process.env.FUNCTIONS_EMULATOR === "true" 
      ? process.env.CURSOR_SIGNING_SECRET 
      : cursorSecret.value();

  if (!secretKey || secretKey.length < 32) {
    logger.error('[GATE 5D.2D] ERROR CRITICO: CURSOR_SIGNING_SECRET ausente o muy corto (min 32 chars). Fail closed.');
    throw new HttpsError('internal', 'Internal server configuration error.');
  }

  // 6. Verificar cursor firmado si existe (vinculado al actor y filtros)
  let decodedCursor = null;
  if (cursor) {
    const cursorContext = { actorUid, includeInvalidated: safeIncludeInvalidated };
    
    if (queryType === 'employee_day') {
      cursorContext.employeeId = employeeId;
      cursorContext.jornadaDate = jornadaDate;
    } else if (queryType === 'employee_range') {
      cursorContext.employeeId = employeeId;
      cursorContext.fromDate = fromDate;
      cursorContext.toDate = toDate;
    } else if (queryType === 'branch_day') {
      cursorContext.sucursalId = sucursalId;
      cursorContext.jornadaDate = jornadaDate;
    } else if (queryType === 'branch_range') {
      cursorContext.sucursalId = sucursalId;
      cursorContext.fromDate = fromDate;
      cursorContext.toDate = toDate;
      cursorContext.status = status;
      cursorContext.tipoOperacion = tipoOperacion;
    } else if (queryType === 'checkin_id') {
      cursorContext.checkInId = checkInId;
    } else if (queryType === 'scheduled_shift') {
      cursorContext.turnoProgramadoId = turnoProgramadoId;
    }
    decodedCursor = decodeCursor(cursor, queryType, cursorContext, secretKey);
  }

  // 7. Calcular payloadHash
  const payloadHashParams = {
    queryType, employeeId, sucursalId, jornadaDate, fromDate, toDate,
    status, tipoOperacion, safeLimit, safeIncludeInvalidated,
    checkInId, turnoProgramadoId
  };
  const payloadHash = computePayloadHash(payloadHashParams, mode, cursor || null);

  // 8. Verificar idempotencia
  const auditId = `shadow_read_${actorUid}_${requestId}`;
  const auditRef = db.collection('AuditoriaAcciones').doc(auditId);
  const auditSnap = await auditRef.get();
  const isRetry = auditSnap.exists;

  if (isRetry) {
    const existingHash = auditSnap.data()?.payloadHash;
    if (existingHash !== payloadHash) {
      // Mismo requestId, payload distinto → rechazar
      throw new HttpsError('already-exists', 'request_id_reused');
    }
    // Retry idéntico → re-ejecutar consulta (datos pueden haber cambiado)
    // No duplicar auditoría
  }

  // 9. Ejecutar consulta
  const startMs = Date.now();

  const queryParams = {
    queryType, employeeId, sucursalId, jornadaDate, fromDate, toDate,
    status: status || null,
    tipoOperacion: tipoOperacion || null,
    limit: safeLimit,
    includeInvalidated: safeIncludeInvalidated,
    checkInId, turnoProgramadoId,
    cursorContext: decodedCursor || null,
    cursor: cursor || null,
    overrideSecret: secretKey,
    actorUid
  };

  let result;
  let legacyCount = 0;
  let v2Count = 0;
  let comparisonStatus = null;
  let comparisonScope = null;
  let comparisonComplete = null;

  if (mode === 'legacy_only') {
    let legacyResult;

    if (queryType === 'employee_day') {
      legacyResult = await legacyService.getLegacySessionsByEmployeeAndDate(db, employeeId, jornadaDate);
    } else if (queryType === 'employee_range') {
      legacyResult = await legacyService.getLegacySessionsByEmployeeRange(db, employeeId, fromDate, toDate, safeLimit, decodedCursor, secretKey, queryParams);
    } else if (queryType === 'branch_day') {
      legacyResult = await legacyService.getLegacySessionsByBranchAndDate(db, sucursalId, jornadaDate, safeLimit, decodedCursor, secretKey, queryParams);
    } else if (queryType === 'branch_range') {
      legacyResult = await legacyService.getLegacySessionsByBranchRange(db, sucursalId, fromDate, toDate, status, tipoOperacion, safeLimit, decodedCursor, secretKey, queryParams);
    } else if (queryType === 'checkin_id') {
      legacyResult = await legacyService.getLegacySessionByCheckInId(db, checkInId);
    } else if (queryType === 'scheduled_shift') {
      legacyResult = await legacyService.getLegacySessionsByScheduledShift(db, turnoProgramadoId);
    }

    const items = Array.isArray(legacyResult)
      ? legacyResult
      : (legacyResult?.items || []);
    legacyCount = items.length;

    result = {
      legacyResult,
      v2Result: null,
      comparison: null,
      metrics: { durationMs: Date.now() - startMs, legacyDocsRead: legacyCount, v2DocsRead: 0 }
    };

  } else if (mode === 'shadow') {
    result = await getAttendanceShadowComparison(db, queryType, queryParams);
    legacyCount = result.metrics.legacyDocsRead;
    v2Count = result.metrics.v2DocsRead;
    comparisonStatus = result.comparison?.status || null;
    comparisonScope = result.comparison?.comparisonScope || null;
    comparisonComplete = result.comparison?.comparisonComplete ?? null;

  } else if (mode === 'v2_only') {
    throw new HttpsError('failed-precondition', 'Modo v2_only no habilitado en esta fase.');
  }

  const durationMs = Date.now() - startMs;

  // 10. Construir resultado — el resultado ya está en `result`

  // 11. Persistir auditoría (solo en primera llamada; retry idéntico no duplica)
  if (!isRetry) {
    // Snapshot mínimo del Feature Flag (sin datos completos del documento)
    const ffSnap = await db.collection('FeatureFlags').doc('attendanceV2Read').get().catch(() => null);
    const ffData = ffSnap?.exists ? ffSnap.data() : null;
    const featureFlagSnapshot = ffData ? {
      enabled: ffData.enabled ?? null,
      activationMode: ffData.activationMode ?? null,
      shadowReadEnabled: ffData.shadowReadEnabled ?? null
    } : null;

    try {
      await auditRef.set({
        accion: 'attendance_v2_shadow_read',
        actorId: actorUid,
        actorRole,
        queryType,
        employeeId: employeeId || null,
        sucursalId: sucursalId || null,
        fromDate: fromDate || jornadaDate || null,
        toDate: toDate || jornadaDate || null,
        resultCountLegacy: legacyCount,
        resultCountV2: v2Count,
        comparisonStatus,
        comparisonScope,
        comparisonComplete,
        requestId,
        payloadHash,
        durationMs,
        featureFlagSnapshot,
        readMode: mode,
        // NO se incluye: employeeRut, nombres, cursor firmado completo, resultados
        createdAt: new Date()
      });
    } catch (auditErr) {
      // Política fail-closed: sin auditoría confirmada, no devolver resultados
      console.error('[SHADOW-READ] Fallo persistiendo auditoría:', auditErr.message);
      throw new HttpsError('internal', 'No se pudo registrar la auditoría de la consulta.');
    }
  }

  // 12. Retornar resultado
  return result;
}

// ---------------------------------------------------------------------------
// Exportar para testing directo (sin Callable wrapper)
// ---------------------------------------------------------------------------
exports.executeAttendanceShadowValidated = executeAttendanceShadowValidated;

// ---------------------------------------------------------------------------
// Callable de Firebase Functions
// ---------------------------------------------------------------------------
// Exportar la Callable v2 asociada al secreto
exports.getAttendanceShadowValidated = onCall(
  {
    region: 'us-central1',
    secrets: [cursorSecret], // Inyectar el secreto en el entorno de ejecución
    memory: '256MiB'
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError('unauthenticated', 'Debe iniciar sesión para consultar asistencias.');
    }
    return executeAttendanceShadowValidated(
      admin.firestore(),
      request.data,
      request.auth.uid
    );
  }
);
