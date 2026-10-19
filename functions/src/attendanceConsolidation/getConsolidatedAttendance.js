'use strict';

/**
 * getConsolidatedAttendance.js
 *
 * Callable para consultar asistencias consolidadas (una fila por turno)
 * para el panel administrativo y supervisores.
 *
 * Lee de AsistenciasConsolidadas (V2, backend-only por firestore.rules).
 * Incluye capa de compatibilidad en transición: si no hay registros V2 para
 * los parámetros dados, consolida al vuelo desde Asistencia preservando
 * exactamente la misma estructura de datos.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { mapV2ToSessionReadModel } = require('../phase5d2/queries/attendanceV2ReadModels');
const { consolidateAttendance, buildConsolidatedDoc } = require('./consolidate');

const ALLOWED_ROLES = ['admin', 'jefe_operaciones', 'supervisor', 'mandante', 'rrhh', 'qa_tester'];

async function executeGetConsolidatedAttendance(db, data, auth) {
  if (!auth || !auth.uid) {
    throw new HttpsError('unauthenticated', 'Debe iniciar sesión para consultar asistencias.');
  }

  // 1. Validar rol del actor
  const actorDoc = await db.collection('Colaboradores').doc(auth.uid).get();
  if (!actorDoc.exists) {
    throw new HttpsError('permission-denied', 'Usuario no registrado.');
  }
  const actorData = actorDoc.data();
  const actorRole = actorData.role;
  if (!ALLOWED_ROLES.includes(actorRole)) {
    throw new HttpsError('permission-denied', `Rol no autorizado: ${actorRole}`);
  }

  const {
    sucursalId,
    employeeId,
    fromDate,
    toDate,
    jornadaDate,
    status,
    limit = 100
  } = data || {};

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

  // 2. Validar alcance de supervisor / jefe de operaciones si aplica
  if (actorRole === 'supervisor' || actorRole === 'jefe_operaciones') {
    if (sucursalId && sucursalId !== 'all') {
      const alcanceDoc = await db.collection('AlcancesOperativos').doc(auth.uid).get();
      if (alcanceDoc.exists) {
        const alcance = alcanceDoc.data();
        if (!alcance.alcanceNacional) {
          const allowed = Array.isArray(alcance.sucursalesAutorizadas) ? alcance.sucursalesAutorizadas : [];
          if (!allowed.includes(String(sucursalId))) {
            throw new HttpsError('permission-denied', `Sin alcance en la sucursal: ${sucursalId}`);
          }
        }
      }
    }
  }

  // 3. Consultar AsistenciasConsolidadas (V2)
  let q = db.collection('AsistenciasConsolidadas');

  if (sucursalId && sucursalId !== 'all') {
    q = q.where('sucursalId', '==', String(sucursalId));
  }
  if (employeeId) {
    q = q.where('employeeId', '==', String(employeeId));
  }
  if (jornadaDate) {
    q = q.where('jornadaDate', '==', jornadaDate);
  } else if (fromDate && toDate) {
    q = q.where('jornadaDate', '>=', fromDate).where('jornadaDate', '<=', toDate);
  }
  if (status && (status === 'open' || status === 'completed')) {
    q = q.where('status', '==', status);
  }

  q = q.orderBy('jornadaDate', 'desc').limit(safeLimit);

  let snapshot;
  try {
    snapshot = await q.get();
  } catch (err) {
    // Si falta un índice compuesto en Firestore, loguear y proceder a consulta fallback
    console.warn('[CONSOLIDATED-ATTENDANCE] Error consultando V2 indexado, intentando sin filtros secundarios:', err.message);
    snapshot = { empty: true, docs: [] };
  }

  const items = [];
  if (!snapshot.empty) {
    snapshot.forEach(docSnap => {
      const model = mapV2ToSessionReadModel(docSnap, false);
      if (model) items.push(model);
    });
  }

  // 4. Capa de compatibilidad de transición:
  // Si no se encontraron registros consolidados V2 para los parámetros buscados,
  // leer de Asistencia y consolidar en memoria de forma idéntica y no destructiva.
  if (items.length === 0) {
    let rawQuery = db.collection('Asistencia');
    if (employeeId) {
      rawQuery = rawQuery.where('employeeId', '==', String(employeeId));
    }
    rawQuery = rawQuery.orderBy('timestamp', 'desc').limit(safeLimit * 3);

    const rawSnap = await rawQuery.get();
    if (!rawSnap.empty) {
      const rawDocs = rawSnap.docs.map(d => ({ id: d.id, data: d.data() }));
      const { sessions } = consolidateAttendance(rawDocs);
      const rawById = new Map(rawDocs.map(d => [d.id, d.data]));

      for (const s of sessions) {
        const { doc } = buildConsolidatedDoc(s, rawById);
        // Filtrar por sucursal / fechas si se especificaron
        if (sucursalId && sucursalId !== 'all' && doc.sucursalId !== String(sucursalId)) continue;
        if (jornadaDate && doc.jornadaDate !== jornadaDate) continue;
        if (fromDate && toDate && (doc.jornadaDate < fromDate || doc.jornadaDate > toDate)) continue;
        if (status && doc.status !== status) continue;

        items.push({
          id: `trans_${doc.checkInId}`,
          ...doc,
          source: 'transitional_fallback'
        });
        if (items.length >= safeLimit) break;
      }
    }
  }

  return {
    items,
    count: items.length,
    source: items.some(i => i.source === 'transitional_fallback') ? 'transitional' : 'v2'
  };
}

const getConsolidatedAttendance = onCall({ region: 'us-central1' }, async (request) => {
  return executeGetConsolidatedAttendance(admin.firestore(), request.data, request.auth);
});

module.exports = {
  getConsolidatedAttendance,
  executeGetConsolidatedAttendance
};
