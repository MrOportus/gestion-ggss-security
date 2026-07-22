const { decodeCursor, createNextCursor } = require('./attendanceV2Pagination');
const { mapLegacyToSessionReadModel } = require('./attendanceV2ReadModels');

/**
 * Nota: Dado que legacy (asistencia_manual) tiene un ID `manual_employeeId_jornadaDate`, 
 * muchas consultas por fechas implican parsear cursores de manera ad-hoc para legacy si queremos 
 * mantener consistencia. Sin embargo, para no crear índices en producción legacy 
 * que nunca se usaron, intentamos emular la paginación con el documento ID o 
 * usar los mismos queries que se hubieran usado originalmente.
 */

async function getLegacySessionsByEmployeeAndDate(db, employeeId, jornadaDate) {
  const legacyId = `manual_${employeeId}_${jornadaDate}`;
  const doc = await db.collection('asistencia_manual').doc(legacyId).get();
  
  const model = mapLegacyToSessionReadModel(doc);
  return model ? [model] : [];
}

async function getLegacySessionsByEmployeeRange(db, employeeId, fromDate, toDate, limit, cursorStr, overrideSecret = null, filtersCtx = {}) {
  let query = db.collection('asistencia_manual')
    .where('employeeId', '==', employeeId)
    .where('date', '>=', fromDate)
    .where('date', '<=', toDate)
    .orderBy('date', 'asc')
    .orderBy('__name__', 'asc')
    .limit(limit);

  if (cursorStr && typeof cursorStr === 'object') {
    query = query.startAfter(cursorStr.lastJornadaDate, cursorStr.lastDocumentId);
  } else if (cursorStr) {
    const parsed = decodeCursor(cursorStr, 'employee_range', { employeeId }, overrideSecret);
    if (parsed) {
      query = query.startAfter(parsed.lastJornadaDate, parsed.lastDocumentId);
    }
  }

  const snapshot = await query.get();
  
  const results = [];
  snapshot.forEach(doc => {
    const model = mapLegacyToSessionReadModel(doc);
    if (model) results.push(model);
  });

  const lastDoc = snapshot.docs[snapshot.docs.length - 1];
  let nextCursor = null;
  if (lastDoc && snapshot.docs.length === limit) {
    const filters = { employeeId, fromDate, toDate, ...filtersCtx };
    const fakeDoc = {
      id: lastDoc.id,
      exists: true,
      data: () => ({ date: lastDoc.data().date, checkInAt: lastDoc.data().date + 'T00:00:00Z' })
    };
    nextCursor = createNextCursor(fakeDoc, 'employee_range', filters, overrideSecret);
  }

  return {
    items: results,
    nextCursor,
    hasMore: snapshot.docs.length === limit,
    pageSize: limit
  };
}

async function getLegacySessionsByBranchAndDate(db, sucursalId, jornadaDate, limit, cursorStr, overrideSecret = null, filtersCtx = {}) {
  let query = db.collection('asistencia_manual')
    .where('sucursalId', '==', sucursalId)
    .where('fecha', '==', jornadaDate)
    .orderBy('__name__', 'asc')
    .limit(limit);

  if (cursorStr && typeof cursorStr === 'object') {
    query = query.startAfter(cursorStr.lastDocumentId);
  } else if (cursorStr) {
    const parsed = decodeCursor(cursorStr, 'branch_day', { sucursalId }, overrideSecret);
    if (parsed) {
      query = query.startAfter(parsed.lastDocumentId);
    }
  }

  const snapshot = await query.get();
  
  const results = [];
  snapshot.forEach(doc => {
    const model = mapLegacyToSessionReadModel(doc);
    if (model) results.push(model);
  });

  const lastDoc = snapshot.docs[snapshot.docs.length - 1];
  let nextCursor = null;
  if (lastDoc && snapshot.docs.length === limit) {
    const filters = { sucursalId, jornadaDate, ...filtersCtx };
    const fakeDoc = {
      id: lastDoc.id,
      exists: true,
      data: () => ({ jornadaDate: lastDoc.data().fecha, checkInAt: lastDoc.data().fecha + 'T00:00:00Z' })
    };
    nextCursor = createNextCursor(fakeDoc, 'branch_day', filters, overrideSecret);
  }

  return {
    items: results,
    nextCursor,
    hasMore: snapshot.docs.length === limit,
    pageSize: limit
  };
}

async function getLegacySessionsByBranchRange(db, sucursalId, fromDate, toDate, status, tipoOperacion, limit, cursorStr, overrideSecret = null, filtersCtx = {}) {
  let query = db.collection('asistencia_manual')
    .where('sucursalId', '==', sucursalId)
    .where('fecha', '>=', fromDate)
    .where('fecha', '<=', toDate);

  // status map: 'closed' -> checkOutTime existe. No se puede filtrar en firestore sin indice o flag.
  // Ignoramos status en legacy o filtramos en memoria por ser fallback analítico temporal.
  
  query = query.orderBy('fecha', 'asc')
               .orderBy('__name__', 'asc')
               .limit(limit);

  if (cursorStr) {
    const parsed = decodeCursor(cursorStr, 'branch_range', { sucursalId }, overrideSecret);
    if (parsed) {
      query = query.startAfter(parsed.lastJornadaDate, parsed.lastDocumentId);
    }
  }

  const snapshot = await query.get();
  
  let results = [];
  snapshot.forEach(doc => {
    const model = mapLegacyToSessionReadModel(doc);
    if (model) {
      // In-memory filter para properties que no estaban indexadas en legacy
      let match = true;
      if (status && model.status !== status) match = false;
      if (tipoOperacion && model.tipoOperacion !== tipoOperacion) match = false;
      
      if (match) results.push(model);
    }
  });

  const lastDoc = snapshot.docs[snapshot.docs.length - 1];
  let nextCursor = null;
  if (lastDoc && snapshot.docs.length === limit) {
    const filters = { sucursalId, fromDate, toDate, status: status || null, tipoOperacion: tipoOperacion || null, ...filtersCtx };
    const fakeDoc = {
      id: lastDoc.id,
      exists: true,
      data: () => ({ jornadaDate: lastDoc.data().fecha, checkInAt: lastDoc.data().fecha + 'T00:00:00Z' })
    };
    nextCursor = createNextCursor(fakeDoc, 'branch_range', filters, overrideSecret);
  }

  return {
    items: results,
    nextCursor,
    hasMore: snapshot.docs.length === limit,
    pageSize: limit
  };
}

async function getLegacySessionByCheckInId(db, checkInId) {
  // Legacy no indexaba por checkInId nativamente en asistencia_manual en todos los casos
  // Haremos un limit(1)
  const snapshot = await db.collection('asistencia_manual')
    .where('checkInId', '==', checkInId)
    .limit(1)
    .get();

  if (snapshot.empty) return [];
  const model = mapLegacyToSessionReadModel(snapshot.docs[0]);
  return model ? [model] : [];
}

async function getLegacySessionsByScheduledShift(db, turnoProgramadoId) {
  const snapshot = await db.collection('asistencia_manual')
    .where('turnoProgramadoId', '==', turnoProgramadoId)
    .get();

  const results = [];
  snapshot.forEach(doc => {
    const model = mapLegacyToSessionReadModel(doc);
    if (model) results.push(model);
  });
  return results;
}

module.exports = {
  getLegacySessionsByEmployeeAndDate,
  getLegacySessionsByEmployeeRange,
  getLegacySessionsByBranchAndDate,
  getLegacySessionsByBranchRange,
  getLegacySessionByCheckInId,
  getLegacySessionsByScheduledShift
};
