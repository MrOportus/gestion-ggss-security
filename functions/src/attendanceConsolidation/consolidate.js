'use strict';

/**
 * consolidate.js
 *
 * Núcleo PURO (sin acceso a Firebase) para consolidar marcaciones de la colección
 * `Asistencia` (documentos `check_in` / `check_out`) en una asistencia por turno.
 *
 * Principios (ver docs/attendance-consolidation.md):
 *  - Nunca modifica ni descarta los documentos de entrada: solo los lee.
 *  - Nunca inventa horas, ubicaciones ni vínculos. Si no hay evidencia verificable,
 *    el registro queda como huérfano / ambiguo / pendiente de revisión.
 *  - Cada pareo automático lleva su método, confianza y evidencia.
 *  - Resultado determinista: mismas entradas => mismas salidas (incluye `sourceHash`).
 */

const crypto = require('crypto');

const CONSOLIDATION_VERSION = 'attendance-consolidation-v1';
const TIMEZONE = 'America/Santiago';
const DEFAULT_STALE_OPEN_HOURS = 36;
const MAX_REASONABLE_SHIFT_MINUTES = 24 * 60;

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

/**
 * Interpreta un instante en cualquiera de los formatos históricos encontrados.
 * Devuelve { ms, iso, format } o null si no es un instante interpretable con seguridad.
 * NO adivina: un número ambiguo (p.ej. segundos vs. milisegundos) devuelve null.
 */
function parseInstant(value) {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'string') {
    // Solo fecha (YYYY-MM-DD) no es un instante.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) return null;
    return { ms, iso: value, format: 'iso_string' };
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) return null;
    return { ms, iso: value.toISOString(), format: 'date_object' };
  }
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') {
      const ms = value.toMillis();
      if (Number.isFinite(ms)) return { ms, iso: new Date(ms).toISOString(), format: 'firestore_timestamp' };
    }
    const seconds = value.seconds ?? value._seconds;
    if (typeof seconds === 'number') {
      const nanos = value.nanoseconds ?? value._nanoseconds ?? 0;
      const ms = seconds * 1000 + Math.floor(nanos / 1e6);
      return { ms, iso: new Date(ms).toISOString(), format: 'seconds_object' };
    }
    return null;
  }
  if (typeof value === 'number') {
    // Solo aceptamos epoch en milisegundos inequívoco (>= 2001-09-09).
    if (value >= 1e12) return { ms: value, iso: new Date(value).toISOString(), format: 'epoch_ms' };
    return null;
  }
  return null;
}

/** Fecha local (YYYY-MM-DD) en America/Santiago para un instante en ms. */
function localDateSantiago(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(ms));
  const m = {};
  parts.forEach(p => { m[p.type] = p.value; });
  return `${m.year}-${m.month}-${m.day}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Normalización de marcaciones
// ---------------------------------------------------------------------------

function toFiniteNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

/** Extrae un GPS solo si es válido; devuelve { gps, problem }. */
function extractGps(raw) {
  const lat = toFiniteNumber(raw.locationLat);
  const lng = toFiniteNumber(raw.locationLng);
  if (lat === null && lng === null) return { gps: null, problem: null };
  if (lat === null || lng === null) return { gps: null, problem: 'gps_incomplete' };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { gps: null, problem: 'gps_out_of_range' };
  const accuracy = toFiniteNumber(raw.locationAccuracy ?? raw.accuracy);
  return { gps: { lat, lng, accuracy }, problem: null };
}

/**
 * Normaliza un documento crudo de `Asistencia`. No altera `raw`.
 * Devuelve siempre un objeto; `problems` indica por qué sería inutilizable.
 */
function normalizeLog(id, raw) {
  const problems = [];
  const type = raw && (raw.type === 'check_in' || raw.type === 'check_out') ? raw.type : null;
  if (!type) problems.push('invalid_or_missing_type');

  const employeeId = raw && typeof raw.employeeId === 'string' && raw.employeeId ? raw.employeeId : null;
  if (!employeeId) problems.push('missing_employeeId');

  const instant = parseInstant(raw && raw.timestamp);
  if (!instant) problems.push('invalid_or_missing_timestamp');

  const endInstant = parseInstant(raw && (raw.endTime ?? raw.horaSalidaReal));
  const horaSalidaInstant = parseInstant(raw && raw.horaSalidaReal);
  const { gps, problem: gpsProblem } = raw ? extractGps(raw) : { gps: null, problem: null };

  return {
    id,
    type,
    employeeId,
    employeeName: raw && raw.employeeName ? String(raw.employeeName) : null,
    ms: instant ? instant.ms : null,
    iso: instant ? instant.iso : null,
    timestampFormat: instant ? instant.format : null,
    endMs: endInstant ? endInstant.ms : null,
    endIso: endInstant ? endInstant.iso : null,
    horaSalidaMs: horaSalidaInstant ? horaSalidaInstant.ms : null,
    gps,
    gpsProblem,
    siteId: raw && raw.siteId !== undefined ? raw.siteId : null,
    siteName: raw && raw.siteName ? String(raw.siteName) : null,
    shiftId: raw && typeof raw.shiftId === 'string' && raw.shiftId ? raw.shiftId : null,
    localDate: raw && typeof raw.localDate === 'string' && DATE_RE.test(raw.localDate) ? raw.localDate : null,
    estado: raw && raw.estado ? String(raw.estado) : null,
    status: raw && raw.status ? String(raw.status) : null,
    tipoCierre: raw && raw.tipoCierre ? String(raw.tipoCierre) : null,
    detalle: raw && raw.detalle ? String(raw.detalle) : null,
    systemNote: raw && raw.systemNote ? String(raw.systemNote) : null,
    isManual: !!(raw && raw.isManual === true),
    closedByAttendanceId: raw && typeof raw.closedByAttendanceId === 'string' ? raw.closedByAttendanceId : null,
    parentCheckInId: raw && typeof raw.parentCheckInId === 'string' ? raw.parentCheckInId : null,
    turnoProgramadoId: raw && typeof raw.turnoProgramadoId === 'string' ? raw.turnoProgramadoId : null,
    photoUrl: raw && raw.photoUrl ? String(raw.photoUrl) : null,
    problems,
    usable: problems.length === 0
  };
}

// ---------------------------------------------------------------------------
// Clasificación del cierre
// ---------------------------------------------------------------------------

/**
 * Determina quién generó una salida. El código real usa estos patrones:
 *  - forced_checkout_{checkInId}  → cierre forzado por administrador (backend)
 *  - auto_checkout_{checkInId}    → auto-cierre del scheduler (backend)
 *  - att_auto_new_{ms}_{checkIn}  → cierre automático por nueva entrada (cliente)
 *  - att_{ms} con detalle APP MOVIL / tipoCierre MANUAL sin isManual → salida del trabajador
 */
function classifyCheckOut(log) {
  const id = log.id || '';
  let actor = 'unknown';
  if (id.startsWith('forced_checkout_') || log.detalle === 'cierre por Admin' || (log.isManual && log.closedByAttendanceId)) {
    actor = 'admin';
  } else if (id.startsWith('auto_checkout_') || log.tipoCierre === 'AUTOMATICO') {
    actor = 'scheduler';
  } else if (id.startsWith('att_auto_new_') || log.tipoCierre === 'AUTOMATICO_POR_NUEVA_ENTRADA') {
    actor = 'new_entry';
  } else if (log.tipoCierre === 'MANUAL' && !log.isManual && (log.detalle === 'APP MOVIL' || log.detalle === null)) {
    actor = 'worker';
  } else if (log.detalle === 'APP MOVIL') {
    actor = 'worker';
  }

  const map = {
    worker: { closureType: 'normal', closureOrigin: 'mobile', checkOutAtSource: 'worker_device', hasOwnGps: true },
    admin: { closureType: 'force_close', closureOrigin: 'admin', checkOutAtSource: 'admin_action', hasOwnGps: false },
    scheduler: { closureType: 'auto_close', closureOrigin: 'scheduler', checkOutAtSource: 'system_execution', hasOwnGps: false },
    new_entry: { closureType: 'auto_close_new_entry', closureOrigin: 'mobile', checkOutAtSource: 'system_execution', hasOwnGps: false },
    unknown: { closureType: null, closureOrigin: null, checkOutAtSource: 'unknown', hasOwnGps: false }
  };
  return { actor, ...map[actor] };
}

/** Vínculo EXPLÍCITO de una salida con su ingreso (campo o ID embebido). */
function explicitCheckInLink(checkOut) {
  if (checkOut.closedByAttendanceId) return { checkInId: checkOut.closedByAttendanceId, method: 'explicit_closedByAttendanceId' };
  if (checkOut.parentCheckInId) return { checkInId: checkOut.parentCheckInId, method: 'explicit_parentCheckInId' };
  const id = checkOut.id || '';
  let m = id.match(/^forced_checkout_(.+)$/);
  if (m) return { checkInId: m[1], method: 'explicit_id_forced_checkout' };
  m = id.match(/^auto_checkout_(.+)$/);
  if (m) return { checkInId: m[1], method: 'explicit_id_auto_checkout' };
  m = id.match(/^att_auto_new_\d+_(.+)$/);
  if (m) return { checkInId: m[1], method: 'explicit_id_auto_new_entry' };
  return null;
}

// ---------------------------------------------------------------------------
// Consolidación
// ---------------------------------------------------------------------------

function isClosedCheckIn(ci) {
  return ci.estado === 'CERRADO' || ci.status === 'completed';
}

function byMsThenId(a, b) {
  if (a.ms !== b.ms) return a.ms - b.ms;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Consolida un conjunto de documentos de Asistencia.
 *
 * @param {Array<{id:string, data:Object}>} docs
 * @param {{now?: number, staleOpenHours?: number}} [opts]
 * @returns {{sessions:Array, review:Array, duplicates:Array, unusable:Array, stats:Object}}
 */
function consolidateAttendance(docs, opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const staleMs = (opts.staleOpenHours ?? DEFAULT_STALE_OPEN_HOURS) * 3600 * 1000;

  const normalized = docs.map(d => normalizeLog(d.id, d.data || {}));
  const unusable = normalized.filter(l => !l.usable).map(l => ({ id: l.id, problems: l.problems }));
  const usable = normalized.filter(l => l.usable).sort(byMsThenId);

  // 1) Duplicados exactos (mismo tipo, trabajador, instante y sucursal). Se informan, NO se borran.
  const seen = new Map();
  const primaries = [];
  const duplicates = [];
  for (const log of usable) {
    const key = [log.type, log.employeeId, log.ms, String(log.siteId)].join('|');
    if (seen.has(key)) {
      duplicates.push({ id: log.id, duplicateOf: seen.get(key), type: log.type, employeeId: log.employeeId });
    } else {
      seen.set(key, log.id);
      primaries.push(log);
    }
  }

  const checkIns = primaries.filter(l => l.type === 'check_in');
  const checkOuts = primaries.filter(l => l.type === 'check_out');
  const ciById = new Map(checkIns.map(c => [c.id, c]));

  // 2) Pareo
  const pairsByCheckIn = new Map(); // checkInId -> [{checkOut, method, confidence, evidence}]
  const review = []; // huérfanos y ambiguos (NO se convierten en asistencias)
  const claimedByEvidence = new Set();

  const addPair = (ci, co, method, confidence, evidence) => {
    if (!pairsByCheckIn.has(ci.id)) pairsByCheckIn.set(ci.id, []);
    pairsByCheckIn.get(ci.id).push({ checkOut: co, method, confidence, evidence });
  };

  for (const co of checkOuts) {
    const link = explicitCheckInLink(co);
    if (link) {
      const ci = ciById.get(link.checkInId);
      if (!ci) {
        review.push({ kind: 'orphan', reason: 'explicit_link_target_missing', checkOutId: co.id, employeeId: co.employeeId, candidates: [], details: { linkedCheckInId: link.checkInId, method: link.method } });
      } else if (ci.employeeId !== co.employeeId) {
        review.push({ kind: 'ambiguous', reason: 'explicit_link_employee_mismatch', checkOutId: co.id, employeeId: co.employeeId, candidates: [ci.id], details: { linkedCheckInId: ci.id, method: link.method } });
      } else {
        addPair(ci, co, link.method, 'high', [`${link.method}:${link.checkInId}`]);
      }
      continue;
    }

    // Sin vínculo explícito: SOLO evidencia verificable (endTime del check-in == timestamp de la salida)
    const candidates = checkIns.filter(ci =>
      ci.employeeId === co.employeeId &&
      !claimedByEvidence.has(ci.id) &&
      !(pairsByCheckIn.get(ci.id) || []).length &&
      isClosedCheckIn(ci) &&
      ci.ms <= co.ms &&
      ci.endMs !== null && ci.endMs === co.ms
    );
    const sameShift = candidates.filter(ci => ci.shiftId !== null && ci.shiftId === co.shiftId);

    if (sameShift.length === 1) {
      const ci = sameShift[0];
      claimedByEvidence.add(ci.id);
      addPair(ci, co, 'evidence_endTime_match', 'medium', [
        `employeeId=${co.employeeId}`, `shiftId=${co.shiftId}`, `checkIn.endTime==checkOut.timestamp(${co.iso})`
      ]);
    } else if (sameShift.length > 1) {
      review.push({ kind: 'ambiguous', reason: 'multiple_candidate_checkins', checkOutId: co.id, employeeId: co.employeeId, candidates: sameShift.map(c => c.id), details: { evidence: 'endTime_match' } });
    } else if (candidates.length > 0) {
      review.push({ kind: 'ambiguous', reason: 'low_confidence_candidate_different_shift', checkOutId: co.id, employeeId: co.employeeId, candidates: candidates.map(c => c.id), details: { evidence: 'endTime_match_without_same_shiftId' } });
    } else {
      review.push({ kind: 'orphan', reason: 'no_identifiable_checkin', checkOutId: co.id, employeeId: co.employeeId, candidates: [], details: {} });
    }
  }

  // 3) Construir sesiones (una por ingreso)
  const sessions = checkIns.map(ci => {
    const pairs = (pairsByCheckIn.get(ci.id) || []).slice().sort((a, b) => byMsThenId(a.checkOut, b.checkOut));
    const reasons = [];
    let status;
    let attendanceStatus;
    let primary = null;

    if (pairs.length > 0) {
      primary = pairs[0];
      status = 'completed';
      attendanceStatus = 'presente';
      if (pairs.length > 1) reasons.push('multiple_checkouts_for_checkin');
      if (primary.checkOut.ms < ci.ms) reasons.push('checkout_before_checkin');
    } else if (isClosedCheckIn(ci)) {
      status = 'completed';
      attendanceStatus = 'incompleto';
      reasons.push('closed_without_checkout_record');
    } else if (ci.estado === 'ABIERTO' || ci.status === 'active') {
      status = 'open';
      attendanceStatus = 'sin_clasificar';
      if (now - ci.ms > staleMs) reasons.push('stale_open_checkin');
    } else {
      status = 'open';
      attendanceStatus = 'sin_clasificar';
      reasons.push('unknown_checkin_state');
    }
    if (ci.gpsProblem) reasons.push(`checkin_${ci.gpsProblem}`);
    if (primary && primary.checkOut.gpsProblem) reasons.push(`checkout_${primary.checkOut.gpsProblem}`);

    return { checkIn: ci, pairs, primary, status, attendanceStatus, reasons };
  });

  const stats = {
    totalDocs: docs.length,
    unusable: unusable.length,
    checkIns: checkIns.length,
    checkOuts: checkOuts.length,
    duplicates: duplicates.length,
    sessions: sessions.length,
    sessionsOpen: sessions.filter(s => s.status === 'open').length,
    sessionsClosed: sessions.filter(s => s.status === 'completed').length,
    orphans: review.filter(r => r.kind === 'orphan').length,
    ambiguous: review.filter(r => r.kind === 'ambiguous').length
  };

  return { sessions, review, duplicates, unusable, stats };
}

// ---------------------------------------------------------------------------
// Documento consolidado
// ---------------------------------------------------------------------------

/** ID determinista compatible con idBuilder de V2 (`manual_{checkInId}`). */
function consolidatedDocId(checkInId) {
  if (typeof checkInId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(checkInId)) return `manual_${checkInId}`;
  const h = crypto.createHash('sha1').update(String(checkInId)).digest('hex').slice(0, 24);
  return `mig_${h}`;
}

function reviewDocId(checkOutId, kind) {
  const h = crypto.createHash('sha1').update(`${kind}|${checkOutId}`).digest('hex').slice(0, 24);
  return `${kind}_${h}`;
}

function resolveJornadaDate(ci, turno) {
  if (ci.localDate) return { value: ci.localDate, source: 'check_in.localDate' };
  if (ci.shiftId) {
    const part = ci.shiftId.split('_').pop();
    if (DATE_RE.test(part)) return { value: part, source: 'shiftId' };
  }
  if (turno && typeof turno.fecha === 'string' && DATE_RE.test(turno.fecha)) return { value: turno.fecha, source: 'turno_programado' };
  return { value: localDateSantiago(ci.ms), source: 'derived_from_timestamp' };
}

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Hash determinista de los documentos de origen (para idempotencia / detección de cambios). */
function computeSourceHash(sourceDocs) {
  return crypto.createHash('sha256').update(stableStringify(sourceDocs)).digest('hex');
}

/**
 * Construye el documento consolidado de una sesión.
 *
 * @param {Object} session  elemento de `consolidateAttendance().sessions`
 * @param {Object} rawById  Map<string, Object> con los documentos originales (para el hash)
 * @param {Object} [context] { turnos?: Map<string,Object>, auditIds?: Set<string> }
 * @returns {{id:string, doc:Object}}  (sin createdAt/updatedAt: los pone quien escribe)
 */
function buildConsolidatedDoc(session, rawById, context = {}) {
  const { checkIn: ci, primary } = session;
  const co = primary ? primary.checkOut : null;
  const closure = co ? classifyCheckOut(co) : null;
  const turno = ci.turnoProgramadoId && context.turnos ? context.turnos.get(ci.turnoProgramadoId) || null : null;
  const jornada = resolveJornadaDate(ci, turno);

  // --- Hora de salida: solo datos originales, nunca inventados ---
  let checkOutAt = null;
  let checkOutAtSource = null;
  if (co) {
    checkOutAt = co.iso;
    checkOutAtSource = closure.checkOutAtSource;
  } else if (ci.endMs !== null && isClosedCheckIn(ci)) {
    checkOutAt = ci.endIso;
    checkOutAtSource = 'checkin_embedded_endTime';
  }

  // --- GPS ---
  const checkInGps = ci.gps;
  let checkOutGps = null;
  let checkOutGpsUnreliable = null;
  if (co && co.gps) {
    if (closure.hasOwnGps) {
      checkOutGps = co.gps;
    } else {
      // Cierres forzados/automáticos copian el GPS del ingreso (`...checkInData`): no es GPS de salida.
      checkOutGpsUnreliable = { lat: co.gps.lat, lng: co.gps.lng, reason: 'copied_from_check_in_by_system_closure' };
    }
  }

  // --- Duración: calculada tanto para marcación de trabajador como para cierres automáticos / del sistema ---
  let workedMinutes = null;
  let workedMinutesBasis = 'not_computable';
  const outMs = co ? co.ms : (ci.endMs !== null && isClosedCheckIn(ci) ? ci.endMs : null);
  if (outMs !== null) {
    const diff = Math.floor((outMs - ci.ms) / 60000);
    if (diff >= 0 && diff <= MAX_REASONABLE_SHIFT_MINUTES) {
      workedMinutes = diff;
      workedMinutesBasis = closure && closure.actor === 'worker'
        ? 'worker_check_in_to_check_out'
        : (closure && closure.actor === 'scheduler' ? 'auto_checkout_scheduler' : 'auto_or_system_checkout');
    } else {
      workedMinutesBasis = 'out_of_range';
    }
  }

  const reasons = session.reasons.slice();
  if (closure && closure.actor === 'unknown') reasons.push('unknown_closure_actor');
  if (workedMinutesBasis === 'out_of_range') reasons.push('worked_minutes_out_of_range');
  if (!checkInGps) reasons.push('checkin_gps_unavailable');
  if (jornada.source === 'derived_from_timestamp') reasons.push('jornadaDate_derived');

  const blocking = ['multiple_checkouts_for_checkin', 'checkout_before_checkin', 'closed_without_checkout_record',
    'stale_open_checkin', 'unknown_checkin_state', 'unknown_closure_actor', 'worked_minutes_out_of_range'];
  const reviewReasons = reasons.filter(r => blocking.includes(r));
  const reviewState = reviewReasons.length ? 'pending_review' : 'ok';

  const sourceRefs = {
    checkInPath: `Asistencia/${ci.id}`,
    checkOutPath: co ? `Asistencia/${co.id}` : null,
    extraCheckOutPaths: session.pairs.slice(1).map(p => `Asistencia/${p.checkOut.id}`)
  };
  const sourceIds = [ci.id, ...session.pairs.map(p => p.checkOut.id)];
  const sourceHash = computeSourceHash(sourceIds.map(sid => ({ id: sid, data: rawById.get(sid) || null })));

  const auditRefs = [];
  if (context.auditIds) {
    for (const aid of [`auto_close_${ci.id}`, `attendance_force_closed_${ci.id}`, `attendance_v2_snapshot_written_${ci.id}`]) {
      if (context.auditIds.has(aid)) auditRefs.push(aid);
    }
  }

  const doc = {
    schemaVersion: 2,
    recordKind: 'shift_attendance',
    isLegacy: false,
    generationStatus: 'active',

    checkInId: ci.id,
    checkOutId: co ? co.id : null,
    employeeId: ci.employeeId,
    employeeName: ci.employeeName,
    turnoProgramadoId: ci.turnoProgramadoId,
    asignacionOperacionalId: turno && turno.asignacionOperacionalId ? turno.asignacionOperacionalId : null,
    legacyShiftId: ci.shiftId,

    jornadaDate: jornada.value,
    jornadaDateSource: jornada.source,
    timezone: TIMEZONE,

    sucursalId: ci.siteId === null || ci.siteId === undefined ? null : String(ci.siteId),
    sucursalNombre: ci.siteName,
    sucursalResolution: ci.siteId === null || ci.siteId === undefined ? 'unresolved' : 'check_in',

    status: session.status,
    attendanceStatus: session.attendanceStatus,

    checkInAt: ci.iso,
    checkInGps,
    checkOutAt,
    checkOutAtSource,
    checkOutGps,
    checkOutGpsUnreliable,

    closureType: closure ? closure.closureType : (checkOutAt ? 'manual_correction' : null),
    closureOrigin: closure ? closure.closureOrigin : (checkOutAt ? 'admin' : null),
    closureActor: closure ? closure.actor : (checkOutAt ? 'unknown' : null),
    closureReason: co && co.systemNote ? co.systemNote : null,

    workedMinutes,
    workedMinutesBasis,

    pairing: primary
      ? { method: primary.method, confidence: primary.confidence, evidence: primary.evidence }
      : { method: checkOutAt ? 'embedded_in_checkin' : 'none', confidence: checkOutAt ? 'low' : 'none', evidence: [] },
    sourceRefs,
    auditRefs,

    reviewState,
    reviewReasons,
    notes: reasons.filter(r => !reviewReasons.includes(r)),

    source: 'migration',
    migration: { version: CONSOLIDATION_VERSION, sourceHash }
  };

  return { id: consolidatedDocId(ci.id), doc };
}

/** Documento de revisión (huérfano / ambiguo). Va a otra colección: no contamina la lectura V2. */
function buildReviewDoc(entry, rawById) {
  const co = rawById.get(entry.checkOutId) || null;
  const instant = co ? parseInstant(co.timestamp) : null;
  const sourceIds = [entry.checkOutId, ...entry.candidates];
  return {
    id: reviewDocId(entry.checkOutId, entry.kind),
    doc: {
      kind: entry.kind,
      reason: entry.reason,
      checkOutId: entry.checkOutId,
      employeeId: entry.employeeId,
      checkOutAt: instant ? instant.iso : null,
      candidateCheckInIds: entry.candidates,
      details: entry.details || {},
      reviewState: 'pending_review',
      sourceRefs: { checkOutPath: `Asistencia/${entry.checkOutId}`, candidatePaths: entry.candidates.map(c => `Asistencia/${c}`) },
      source: 'migration',
      migration: {
        version: CONSOLIDATION_VERSION,
        sourceHash: computeSourceHash(sourceIds.map(sid => ({ id: sid, data: rawById.get(sid) || null })))
      }
    }
  };
}

module.exports = {
  CONSOLIDATION_VERSION,
  TIMEZONE,
  parseInstant,
  localDateSantiago,
  normalizeLog,
  classifyCheckOut,
  explicitCheckInLink,
  consolidateAttendance,
  consolidatedDocId,
  buildConsolidatedDoc,
  buildReviewDoc,
  computeSourceHash,
  stableStringify
};
