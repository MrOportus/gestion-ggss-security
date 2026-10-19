'use strict';

/**
 * migrationRunner.js
 *
 * Migración NO destructiva de `Asistencia` → colección consolidada.
 * Solo funciona contra el emulador de Firestore (o contra datos locales en JSON para dry-run).
 *
 * - Nunca escribe, modifica ni borra documentos de `Asistencia` ni de `AuditoriaAcciones`.
 * - Solo crea/actualiza documentos con `migration.version`, y nunca pisa documentos canónicos
 *   (los escritos por el dual-write V2, que no tienen el campo `migration`).
 * - Idempotente: una segunda ejecución reconoce lo ya migrado (`sourceHash` igual → sin cambios).
 */

const crypto = require('crypto');
const {
  CONSOLIDATION_VERSION,
  parseInstant,
  consolidateAttendance,
  buildConsolidatedDoc,
  buildReviewDoc,
  computeSourceHash
} = require('./consolidate');

const DEFAULT_TARGET = 'AsistenciasConsolidadas';
const DEFAULT_REVIEW = 'AsistenciasPendientesRevision';
const SOURCE_COLLECTION = 'Asistencia';
const BATCH_SIZE = 200;

// ---------------------------------------------------------------------------
// Protección de producción
// ---------------------------------------------------------------------------

/**
 * Aborta si el entorno no es inequívocamente local.
 * Exige emulador de Firestore y un projectId `demo-*`; rechaza credenciales de servicio.
 */
function assertLocalOnly(env = process.env, projectId) {
  const host = env.FIRESTORE_EMULATOR_HOST;
  if (!host || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) {
    throw new Error('[SEGURIDAD] FIRESTORE_EMULATOR_HOST no está definido hacia localhost. La migración solo corre contra el emulador.');
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('[SEGURIDAD] GOOGLE_APPLICATION_CREDENTIALS está definido. Se rechaza para no arriesgar producción.');
  }
  const pid = projectId || env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT;
  if (!pid || !/^demo-/.test(pid)) {
    throw new Error(`[SEGURIDAD] El proyecto "${pid || 'sin definir'}" no es un proyecto demo-*. Se rechaza.`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Serializa un documento Firestore a un objeto comparable (Timestamp → marca estable). */
function plain(value) {
  if (value === null || value === undefined) return value;
  if (typeof value.toMillis === 'function') return { __ts: value.toMillis() };
  if (value instanceof Date) return { __ts: value.getTime() };
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    const o = {};
    Object.keys(value).sort().forEach(k => { o[k] = plain(value[k]); });
    return o;
  }
  return value;
}

function hashDoc(data) {
  return crypto.createHash('sha256').update(JSON.stringify(plain(data))).digest('hex');
}

/** Hash por documento de toda la colección de origen (prueba de integridad antes/después). */
function snapshotHashes(docs) {
  const map = {};
  docs.forEach(d => { map[d.id] = hashDoc(d.data); });
  return map;
}

function diffHashes(before, after) {
  const changed = [];
  const removed = [];
  Object.keys(before).forEach(id => {
    if (!(id in after)) removed.push(id);
    else if (before[id] !== after[id]) changed.push(id);
  });
  const added = Object.keys(after).filter(id => !(id in before));
  return { changed, removed, added };
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

async function readSourceDocs(db, collection = SOURCE_COLLECTION) {
  const snap = await db.collection(collection).get();
  return snap.docs.map(d => ({ id: d.id, data: d.data() }));
}

async function getAllSafe(db, refs) {
  const out = [];
  for (const group of chunk(refs, 300)) {
    if (group.length === 0) continue;
    const snaps = await db.getAll(...group);
    out.push(...snaps);
  }
  return out;
}

async function loadContext(db, docs) {
  const turnoIds = [...new Set(docs.map(d => d.data && d.data.turnoProgramadoId).filter(id => typeof id === 'string' && id))];
  const turnos = new Map();
  const turnoSnaps = await getAllSafe(db, turnoIds.map(id => db.collection('TurnosProgramados').doc(id)));
  turnoSnaps.forEach(s => { if (s.exists) turnos.set(s.id, s.data()); });

  const checkInIds = docs.filter(d => d.data && d.data.type === 'check_in').map(d => d.id);
  const auditCandidates = [];
  checkInIds.forEach(id => {
    auditCandidates.push(`auto_close_${id}`, `attendance_force_closed_${id}`, `attendance_v2_snapshot_written_${id}`);
  });
  const auditIds = new Set();
  const auditSnaps = await getAllSafe(db, auditCandidates.map(id => db.collection('AuditoriaAcciones').doc(id)));
  auditSnaps.forEach(s => { if (s.exists) auditIds.add(s.id); });
  return { turnos, auditIds };
}

// ---------------------------------------------------------------------------
// Planificación (pura, sin escrituras)
// ---------------------------------------------------------------------------

/**
 * Construye el plan completo a partir de documentos de origen.
 * `existing` (opcional): { target: Map<id, data>, review: Map<id, data> } para clasificar acciones.
 */
function buildPlan(docs, { now, context = {}, existing = { target: new Map(), review: new Map() } } = {}) {
  const result = consolidateAttendance(docs, { now });
  const rawById = new Map(docs.map(d => [d.id, d.data]));

  const sessionDocs = result.sessions.map(s => buildConsolidatedDoc(s, rawById, context));
  const reviewDocs = result.review.map(r => buildReviewDoc(r, rawById));

  const classify = (item, existingMap) => {
    const prev = existingMap.get(item.id);
    if (!prev) return 'create';
    if (!prev.migration) return 'skip_canonical_preserved';
    if (prev.migration.version === CONSOLIDATION_VERSION && prev.migration.sourceHash === item.doc.migration.sourceHash) return 'unchanged';
    return 'update_migrated';
  };

  const sessionActions = sessionDocs.map(item => ({ ...item, action: classify(item, existing.target) }));
  const reviewActions = reviewDocs.map(item => ({ ...item, action: classify(item, existing.review) }));

  return { result, rawById, sessionActions, reviewActions };
}

// ---------------------------------------------------------------------------
// Reconciliación
// ---------------------------------------------------------------------------

/**
 * Compara originales vs. consolidados y evalúa las condiciones de aprobación.
 * Todos los conteos salen de `docs` reales, no de supuestos.
 */
function reconcile({ docs, plan, targetDocs, reviewDocs, integrity, mode }) {
  const { result, rawById } = plan;
  const { stats } = result;

  const originals = docs.length;
  const usable = docs.filter(d => !result.unusable.find(u => u.id === d.id));
  const duplicateIds = new Set(result.duplicates.map(d => d.id));

  // Contabilidad: cada original utilizable debe tener exactamente un destino.
  const accounted = new Map(); // id -> destino
  const mark = (id, where) => {
    if (accounted.has(id)) accounted.set(id, `${accounted.get(id)}+${where}`);
    else accounted.set(id, where);
  };
  result.sessions.forEach(s => {
    mark(s.checkIn.id, 'session_checkin');
    s.pairs.forEach(p => mark(p.checkOut.id, 'session_checkout'));
  });
  result.review.forEach(r => mark(r.checkOutId, `review_${r.kind}`));
  duplicateIds.forEach(id => mark(id, 'duplicate'));

  const unaccounted = usable.filter(d => !accounted.has(d.id)).map(d => d.id);
  const multiplyAccounted = [...accounted.entries()].filter(([, w]) => w.includes('+')).map(([id]) => id);

  // Referencias válidas
  const invalidRefs = [];
  const checkRef = (path, owner) => {
    if (!path) return;
    const id = path.replace(`${SOURCE_COLLECTION}/`, '');
    if (!rawById.has(id)) invalidRefs.push({ owner, path });
  };
  plan.sessionActions.forEach(s => {
    checkRef(s.doc.sourceRefs.checkInPath, s.id);
    checkRef(s.doc.sourceRefs.checkOutPath, s.id);
    s.doc.sourceRefs.extraCheckOutPaths.forEach(p => checkRef(p, s.id));
  });
  plan.reviewActions.forEach(r => {
    checkRef(r.doc.sourceRefs.checkOutPath, r.id);
    r.doc.sourceRefs.candidatePaths.forEach(p => checkRef(p, r.id));
  });

  // Preservación exacta de fechas y ubicaciones
  const preservationErrors = [];
  plan.sessionActions.forEach(s => {
    const ci = rawById.get(s.doc.checkInId);
    if (typeof ci.timestamp === 'string' && s.doc.checkInAt !== ci.timestamp) {
      preservationErrors.push({ id: s.id, field: 'checkInAt' });
    }
    if (typeof ci.locationLat === 'number' && typeof ci.locationLng === 'number' && s.doc.checkInGps) {
      if (s.doc.checkInGps.lat !== ci.locationLat || s.doc.checkInGps.lng !== ci.locationLng) {
        preservationErrors.push({ id: s.id, field: 'checkInGps' });
      }
    }
    if (s.doc.checkOutId) {
      const co = rawById.get(s.doc.checkOutId);
      if (typeof co.timestamp === 'string' && s.doc.checkOutAt !== co.timestamp) preservationErrors.push({ id: s.id, field: 'checkOutAt' });
      if (s.doc.checkOutGps && co.locationLat !== undefined &&
        (s.doc.checkOutGps.lat !== co.locationLat || s.doc.checkOutGps.lng !== co.locationLng)) {
        preservationErrors.push({ id: s.id, field: 'checkOutGps' });
      }
    }
  });

  // Duplicados introducidos por la migración (en lo realmente escrito, si se proporcionó)
  const seenIn = new Set();
  const duplicatedTargets = [];
  (targetDocs || plan.sessionActions).forEach(t => {
    const key = t.data ? t.data.checkInId : t.doc.checkInId;
    if (seenIn.has(key)) duplicatedTargets.push(key);
    seenIn.add(key);
  });

  // Incompletos / sin GPS / revisión
  const incompleteFields = plan.sessionActions.filter(s =>
    s.doc.notes.includes('checkin_gps_unavailable') || s.doc.attendanceStatus === 'incompleto' || !s.doc.checkOutAt && s.doc.status === 'completed').length;
  const pendingReviewSessions = plan.sessionActions.filter(s => s.doc.reviewState === 'pending_review').length;

  const originalsUntouched = integrity
    ? (integrity.changed.length === 0 && integrity.removed.length === 0 && integrity.added.length === 0)
    : (mode === 'dry-run' ? true : null);

  const conditions = {
    originalsUntouched,
    noOriginalLost: unaccounted.length === 0 && multiplyAccounted.length === 0,
    everyAutomaticPairingJustified: plan.sessionActions.every(s => s.doc.pairing.method === 'none' || (Array.isArray(s.doc.pairing.evidence))) &&
      plan.sessionActions.filter(s => s.doc.checkOutId).every(s => s.doc.pairing.evidence.length > 0),
    ambiguousLeftUntouched: result.review.every(r => !plan.sessionActions.some(s => s.doc.checkOutId === r.checkOutId)),
    noDuplicatesIntroduced: duplicatedTargets.length === 0,
    sourceReferencesValid: invalidRefs.length === 0,
    datesAndLocationsPreserved: preservationErrors.length === 0,
    incompleteNotMadeComplete: plan.sessionActions.every(s => !(s.doc.attendanceStatus === 'presente' && !s.doc.checkOutId))
  };
  const approved = Object.values(conditions).every(v => v === true);

  const counts = {
    originalDocuments: originals,
    originalCheckIns: stats.checkIns,
    originalCheckOuts: stats.checkOuts,
    unusableOriginals: stats.unusable,
    consolidatedAttendances: plan.sessionActions.length,
    openAttendances: stats.sessionsOpen,
    closedAttendances: stats.sessionsClosed,
    automaticClosures: plan.sessionActions.filter(s => ['scheduler', 'new_entry'].includes(s.doc.closureActor)).length,
    duplicatesDetected: stats.duplicates,
    checkOutsWithoutIdentifiablePair: stats.orphans,
    ambiguousPendingReview: stats.ambiguous,
    sessionsPendingReview: pendingReviewSessions,
    recordsWithIncompleteFields: incompleteFields,
    originalsCorrectlyReferenced: accounted.size - duplicateIds.size,
    originalsWithoutCorrespondence: unaccounted.length,
    inconsistenciesDetected: unaccounted.length + multiplyAccounted.length + invalidRefs.length + preservationErrors.length + duplicatedTargets.length
  };

  return {
    counts,
    conditions,
    approved,
    details: { unaccounted, multiplyAccounted, invalidRefs, preservationErrors, duplicatedTargets, unusable: result.unusable }
  };
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

/**
 * @param {FirebaseFirestore.Firestore|null} db   null solo permitido en dry-run con `docs`
 * @param {Object} options
 *   mode: 'dry-run' | 'apply'
 *   docs: documentos de origen (opcional; si no, se leen de db)
 *   now: ms (determinismo)
 *   target / review: nombres de colección
 *   FieldValue: admin.firestore.FieldValue (solo apply)
 *   faultInjection: { failOnBatch: n }  (solo pruebas)
 */
async function runMigration(db, options = {}) {
  const mode = options.mode || 'dry-run';
  if (mode !== 'dry-run' && mode !== 'apply') throw new Error(`Modo inválido: ${mode}`);
  const target = options.target || DEFAULT_TARGET;
  const reviewCol = options.review || DEFAULT_REVIEW;
  const now = typeof options.now === 'number' ? options.now : Date.now();
  const runId = options.runId || `run_${now}`;

  if (mode === 'apply') {
    assertLocalOnly(options.env || process.env, options.projectId);
    if (!db) throw new Error('apply requiere una instancia de Firestore (emulador).');
    if (options.docs) throw new Error('apply lee siempre desde la base (no admite `docs` externos) para poder verificar la integridad.');
  }
  if (db && !options.docs) assertLocalOnly(options.env || process.env, options.projectId);

  const docs = options.docs || await readSourceDocs(db);
  const before = snapshotHashes(docs);

  let context = {};
  let existing = { target: new Map(), review: new Map() };
  if (db) {
    context = await loadContext(db, docs);
    const planProbe = buildPlan(docs, { now, context });
    const tSnaps = await getAllSafe(db, planProbe.sessionActions.map(s => db.collection(target).doc(s.id)));
    const rSnaps = await getAllSafe(db, planProbe.reviewActions.map(r => db.collection(reviewCol).doc(r.id)));
    tSnaps.forEach(s => { if (s.exists) existing.target.set(s.id, s.data()); });
    rSnaps.forEach(s => { if (s.exists) existing.review.set(s.id, s.data()); });
  }
  const plan = buildPlan(docs, { now, context, existing });

  const summary = { runId, mode, version: CONSOLIDATION_VERSION, target, review: reviewCol, startedAt: new Date(now).toISOString() };
  const actionCounts = {};
  [...plan.sessionActions, ...plan.reviewActions].forEach(a => { actionCounts[a.action] = (actionCounts[a.action] || 0) + 1; });
  summary.actions = actionCounts;

  let written = { created: 0, updated: 0, batches: 0 };
  let failure = null;

  if (mode === 'apply') {
    const FieldValue = options.FieldValue;
    if (!FieldValue) throw new Error('apply requiere FieldValue.');
    const ops = [];
    plan.sessionActions.forEach(a => ops.push({ col: target, ...a }));
    plan.reviewActions.forEach(a => ops.push({ col: reviewCol, ...a }));
    const pending = ops.filter(o => o.action === 'create' || o.action === 'update_migrated');

    let batchIndex = 0;
    for (const group of chunk(pending, BATCH_SIZE)) {
      batchIndex++;
      try {
        if (options.faultInjection && options.faultInjection.failOnBatch === batchIndex) {
          throw new Error(`Fallo inyectado en lote ${batchIndex}`);
        }
        const batch = db.batch();
        group.forEach(o => {
          const ref = db.collection(o.col).doc(o.id);
          if (o.action === 'create') {
            batch.create(ref, { ...o.doc, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
          } else {
            batch.update(ref, { ...o.doc, updatedAt: FieldValue.serverTimestamp() });
          }
        });
        await batch.commit();
        group.forEach(o => { if (o.action === 'create') written.created++; else written.updated++; });
        written.batches++;
      } catch (err) {
        // Error crítico: se detiene. Lo ya escrito es idempotente y se reconoce al reintentar.
        failure = { batch: batchIndex, message: err.message };
        break;
      }
    }
  }

  // Verificación posterior
  // Integridad: solo válida si los documentos de origen se leyeron de la base y se releen después.
  let integrity = null;
  let targetDocs = null;
  if (db && !options.docs) {
    const afterDocs = await readSourceDocs(db);
    integrity = diffHashes(before, snapshotHashes(afterDocs));
    if (mode === 'apply') {
      const snap = await db.collection(target).where('migration.version', '==', CONSOLIDATION_VERSION).get();
      targetDocs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    }
  }

  const reconciliation = reconcile({ docs, plan, targetDocs, integrity, mode });

  return {
    summary,
    written,
    failure,
    plan: {
      sessions: plan.sessionActions,
      review: plan.reviewActions,
      duplicates: plan.result.duplicates,
      unusable: plan.result.unusable
    },
    reconciliation: failure ? { ...reconciliation, approved: false } : reconciliation,
    integrity
  };
}

// ---------------------------------------------------------------------------
// Reversión
// ---------------------------------------------------------------------------

/**
 * Elimina ÚNICAMENTE documentos creados por la migración (campo `migration.version`).
 * Nunca toca `Asistencia`, `AuditoriaAcciones` ni documentos canónicos V2.
 * Por defecto es simulación; con `apply: true` borra.
 */
async function rollbackMigration(db, options = {}) {
  assertLocalOnly(options.env || process.env, options.projectId);
  const target = options.target || DEFAULT_TARGET;
  const reviewCol = options.review || DEFAULT_REVIEW;
  const version = options.version || CONSOLIDATION_VERSION;
  const found = [];

  for (const col of [target, reviewCol]) {
    const snap = await db.collection(col).where('migration.version', '==', version).get();
    snap.docs.forEach(d => {
      // Doble comprobación: sólo documentos con marca de migración
      if (d.data().migration && d.data().migration.version === version) found.push({ col, id: d.id });
    });
  }

  if (options.apply === true) {
    for (const group of chunk(found, BATCH_SIZE)) {
      const batch = db.batch();
      group.forEach(f => batch.delete(db.collection(f.col).doc(f.id)));
      await batch.commit();
    }
  }
  return { applied: options.apply === true, version, count: found.length, documents: found };
}

// ---------------------------------------------------------------------------
// Informe legible
// ---------------------------------------------------------------------------

function renderMarkdownReport(report) {
  const { summary, reconciliation: rec, written, failure } = report;
  const c = rec.counts;
  const yn = v => (v === true ? '✅' : v === false ? '❌' : '—');
  const lines = [
    `# Informe de reconciliación — ${summary.runId}`,
    '',
    `- Modo: **${summary.mode}** · Versión: \`${summary.version}\``,
    `- Destino: \`${summary.target}\` · Revisión: \`${summary.review}\``,
    `- Acciones planificadas: ${JSON.stringify(summary.actions)}`,
    `- Escrito: ${JSON.stringify(written)}`,
    failure ? `- ⚠️ **FALLO**: lote ${failure.batch}: ${failure.message}` : '- Sin errores críticos',
    '',
    '## Recuentos',
    '| Concepto | Total |', '|---|---|',
    `| Documentos originales (Asistencia) | ${c.originalDocuments} |`,
    `| Ingresos originales | ${c.originalCheckIns} |`,
    `| Salidas originales | ${c.originalCheckOuts} |`,
    `| Originales inutilizables (datos inválidos) | ${c.unusableOriginals} |`,
    `| Asistencias consolidadas | ${c.consolidatedAttendances} |`,
    `| Abiertas | ${c.openAttendances} |`,
    `| Cerradas | ${c.closedAttendances} |`,
    `| Cierres automáticos | ${c.automaticClosures} |`,
    `| Duplicados detectados | ${c.duplicatesDetected} |`,
    `| Salidas sin ingreso identificable | ${c.checkOutsWithoutIdentifiablePair} |`,
    `| Ambiguos pendientes de revisión | ${c.ambiguousPendingReview} |`,
    `| Asistencias consolidadas pendientes de revisión | ${c.sessionsPendingReview} |`,
    `| Registros con campos incompletos | ${c.recordsWithIncompleteFields} |`,
    `| Originales referenciados correctamente | ${c.originalsCorrectlyReferenced} |`,
    `| Originales sin correspondencia | ${c.originalsWithoutCorrespondence} |`,
    `| Inconsistencias detectadas | ${c.inconsistenciesDetected} |`,
    '',
    '## Condiciones de aprobación',
    `- ${yn(rec.conditions.originalsUntouched)} Ningún documento original eliminado o modificado`,
    `- ${yn(rec.conditions.noOriginalLost)} Ninguna marcación original perdida`,
    `- ${yn(rec.conditions.everyAutomaticPairingJustified)} Cada asociación automática con justificación verificable`,
    `- ${yn(rec.conditions.ambiguousLeftUntouched)} Ambiguos intactos e identificados`,
    `- ${yn(rec.conditions.noDuplicatesIntroduced)} Sin duplicados introducidos`,
    `- ${yn(rec.conditions.sourceReferencesValid)} Referencias a originales válidas`,
    `- ${yn(rec.conditions.datesAndLocationsPreserved)} Fechas y ubicaciones preservadas exactamente`,
    `- ${yn(rec.conditions.incompleteNotMadeComplete)} Incompletos no convertidos en completos`,
    '',
    `## Resultado: ${rec.approved ? '✅ APROBADA' : '❌ NO APROBADA'}`
  ];
  if (!rec.conditions.originalsUntouched && rec.conditions.originalsUntouched !== null) lines.push('', 'Integridad de originales: FALLÓ');
  if (rec.conditions.originalsUntouched === null) lines.push('', 'Nota: la integridad de originales no se pudo comprobar (modo sin base de datos).');
  return lines.join('\n');
}

module.exports = {
  CONSOLIDATION_VERSION,
  DEFAULT_TARGET,
  DEFAULT_REVIEW,
  SOURCE_COLLECTION,
  assertLocalOnly,
  readSourceDocs,
  snapshotHashes,
  diffHashes,
  buildPlan,
  reconcile,
  runMigration,
  rollbackMigration,
  renderMarkdownReport,
  parseInstant,
  computeSourceHash
};
