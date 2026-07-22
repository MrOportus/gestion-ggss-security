'use strict';

/**
 * attendanceV2Pagination.js
 *
 * Cursores FIRMADOS con HMAC-SHA256 para paginación segura de lecturas V2.
 *
 * Formato del cursor: base64url(payloadJson) + "." + base64url(hmacSignature)
 *
 * El secreto se obtiene de la variable de entorno CURSOR_SIGNING_SECRET.
 * NUNCA debe estar hardcodeado, en Firestore, ni en logs.
 *
 * Errores estructurados:
 *   invalid_cursor           — estructura incorrecta
 *   cursor_signature_invalid — HMAC no coincide
 *   cursor_expired           — expiresAt vencido
 *   cursor_actor_mismatch    — actorUid distinto
 *   cursor_query_mismatch    — queryType distinto
 *   cursor_filter_mismatch   — filtros manipulados
 */

const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');

const CURSOR_VERSION = 1;

/** Tiempo de vida del cursor: 30 minutos */
const CURSOR_TTL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers de Base64url (RFC 4648 §5 — sin padding)
// ---------------------------------------------------------------------------

function toBase64url(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function fromBase64url(str) {
  // Restaurar padding estándar antes de decodificar
  const pad = (4 - (str.length % 4)) % 4;
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  return Buffer.from(b64, 'base64');
}

// ---------------------------------------------------------------------------
// Secreto de firma
// ---------------------------------------------------------------------------

function getSigningSecret(overrideSecret = null) {
  const secret = overrideSecret || process.env.CURSOR_SIGNING_SECRET;
  if (!secret || secret.trim().length < 16) {
    // Fallo cerrado: sin secreto no se puede firmar/verificar ningún cursor
    throw new HttpsError(
      'internal',
      'Configuración de seguridad de cursores incompleta.'
    );
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Firma / Verificación
// ---------------------------------------------------------------------------

function signPayload(payloadBase64url, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(payloadBase64url)
    .digest();
}

function verifyCursorSignature(payloadBase64url, signatureBase64url, secret) {
  const expectedSig = signPayload(payloadBase64url, secret);
  const actualSig = fromBase64url(signatureBase64url);

  // Comparación en tiempo constante para evitar timing attacks
  if (expectedSig.length !== actualSig.length) return false;
  return crypto.timingSafeEqual(expectedSig, actualSig);
}

// ---------------------------------------------------------------------------
// Codificación (crear cursor)
// ---------------------------------------------------------------------------

/**
 * Construye un cursor firmado a partir del último documento de una página.
 *
 * @param {FirebaseFirestore.DocumentSnapshot} lastDoc
 * @param {string} queryType
 * @param {Object} filters  { sucursalId?, employeeId?, status?, tipoOperacion?,
 *                            fromDate?, toDate?, jornadaDate?, includeInvalidated?,
 *                            actorUid, readCutoffAt? }
 * @returns {string|null}
 */
function createNextCursor(lastDoc, queryType, filters = {}) {
  if (!lastDoc || !lastDoc.exists) return null;

  try {
    const secret = getSigningSecret(filters.overrideSecret);
    const data = lastDoc.data();
    const now = Date.now();

    const payload = {
      version: CURSOR_VERSION,
      queryType,
      actorUid: filters.actorUid || null,
      employeeId: filters.employeeId || null,
      sucursalId: filters.sucursalId || null,
      fromDate: filters.fromDate || null,
      toDate: filters.toDate || null,
      jornadaDate: filters.jornadaDate || null,
      status: filters.status || null,
      tipoOperacion: filters.tipoOperacion || null,
      includeInvalidated: filters.includeInvalidated || false,

      // Campos de posición para .startAfter()
      lastJornadaDate: data.jornadaDate || null,
      lastCheckInAt: data.checkInAt || null,
      lastDocumentId: lastDoc.id,

      // Ventana de corte opcional (no snapshot isolation real, pero reduce la ventana)
      readCutoffAt: filters.readCutoffAt || null,

      issuedAt: now,
      expiresAt: now + CURSOR_TTL_MS
    };

    const payloadJson = JSON.stringify(payload);
    const payloadBase64url = toBase64url(Buffer.from(payloadJson, 'utf8'));
    const signature = signPayload(payloadBase64url, secret);
    const signatureBase64url = toBase64url(signature);

    return `${payloadBase64url}.${signatureBase64url}`;
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error('[PAGINATION] Error creando cursor firmado:', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Decodificación / Validación (verificar cursor recibido)
// ---------------------------------------------------------------------------

/**
 * Valida y decodifica un cursor firmado recibido del cliente.
 *
 * @param {string} cursorStr       — Cursor recibido
 * @param {string} expectedQueryType
 * @param {Object} expectedContext — { actorUid, employeeId?, sucursalId?,
 *                                    status?, tipoOperacion?, fromDate?, toDate?,
 *                                    jornadaDate?, includeInvalidated? }
 * @param {string} overrideSecret  — (Opcional) secreto provisto por caller
 * @returns {Object} payload decodificado y validado
 */
function decodeCursor(cursorStr, expectedQueryType, expectedContext = {}, overrideSecret = null) {
  if (!cursorStr) return null;

  // 1. Estructura: debe tener exactamente un punto separador
  const parts = cursorStr.split('.');
  if (parts.length !== 2) {
    throw new HttpsError('invalid-argument', 'invalid_cursor');
  }

  const [payloadBase64url, signatureBase64url] = parts;

  // 2. Decodificar payload
  let payload;
  try {
    const payloadJson = fromBase64url(payloadBase64url).toString('utf8');
    payload = JSON.parse(payloadJson);
  } catch {
    throw new HttpsError('invalid-argument', 'invalid_cursor');
  }

  // 3. Validar versión
  if (payload.version !== CURSOR_VERSION) {
    throw new HttpsError('invalid-argument', 'invalid_cursor');
  }

  // 4. Verificar firma HMAC
  let secret;
  try {
    secret = getSigningSecret(overrideSecret);
  } catch {
    throw new HttpsError('internal', 'Configuración de seguridad de cursores incompleta.');
  }

  if (!verifyCursorSignature(payloadBase64url, signatureBase64url, secret)) {
    throw new HttpsError('permission-denied', 'cursor_signature_invalid');
  }

  // 5. Validar expiración
  if (!payload.expiresAt || Date.now() > payload.expiresAt) {
    throw new HttpsError('invalid-argument', 'cursor_expired');
  }

  // 6. Validar actorUid
  if (expectedContext.actorUid && payload.actorUid !== expectedContext.actorUid) {
    throw new HttpsError('permission-denied', 'cursor_actor_mismatch');
  }

  // 7. Validar queryType
  if (payload.queryType !== expectedQueryType) {
    throw new HttpsError('invalid-argument', 'cursor_query_mismatch');
  }

  // 8. Validar filtros (todos los que fueron firmados deben coincidir)
  const filterFields = [
    'employeeId', 'sucursalId', 'fromDate', 'toDate',
    'jornadaDate', 'status', 'tipoOperacion', 'includeInvalidated'
  ];

  for (const field of filterFields) {
    let expected = expectedContext[field] !== undefined ? expectedContext[field] : null;
    let inCursor = payload[field] !== undefined ? payload[field] : null;

    if (field === 'includeInvalidated') {
      expected = expected || false;
      inCursor = inCursor || false;
    }

    // Normalizar: undefined y null son equivalentes
    const normalizedExpected = expected === undefined ? null : expected;
    const normalizedInCursor = inCursor === undefined ? null : inCursor;

    if (normalizedExpected !== normalizedInCursor) {
      console.error(`[DECODE CURSOR MISMATCH] Field: ${field} | Expected: ${normalizedExpected} | InCursor: ${normalizedInCursor} | QueryType: ${expectedQueryType} | Payload:`, payload);
      throw new HttpsError('permission-denied', `cursor_filter_mismatch:${field}`);
    }
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Extracción del payload normalizado del cursor (para payloadHash)
// No incluye issuedAt/expiresAt ni la firma completa
// ---------------------------------------------------------------------------

/**
 * Extrae el payload normalizable del cursor para incluirlo en el payloadHash
 * de la auditoría idempotente. NO incluye issuedAt, expiresAt ni la firma.
 *
 * @param {string} cursorStr
 * @returns {Object|null}
 */
function extractCursorPayloadForHash(cursorStr) {
  if (!cursorStr) return null;
  try {
    const parts = cursorStr.split('.');
    if (parts.length !== 2) return null;
    const payloadJson = fromBase64url(parts[0]).toString('utf8');
    const payload = JSON.parse(payloadJson);
    // Devolver solo los campos estables (sin issuedAt/expiresAt)
    return {
      version: payload.version,
      queryType: payload.queryType,
      actorUid: payload.actorUid,
      employeeId: payload.employeeId,
      sucursalId: payload.sucursalId,
      fromDate: payload.fromDate,
      toDate: payload.toDate,
      jornadaDate: payload.jornadaDate,
      status: payload.status,
      tipoOperacion: payload.tipoOperacion,
      includeInvalidated: payload.includeInvalidated,
      lastJornadaDate: payload.lastJornadaDate,
      lastCheckInAt: payload.lastCheckInAt,
      lastDocumentId: payload.lastDocumentId,
      readCutoffAt: payload.readCutoffAt
    };
  } catch {
    return null;
  }
}

module.exports = {
  createNextCursor,
  decodeCursor,
  extractCursorPayloadForHash
};
