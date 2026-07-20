const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { detectConflict } = require('../phase4/conflictService');
const logger = require('firebase-functions/logger');
const crypto = require('crypto');

// Asegurar inicialización
if (!admin.apps.length) {
  admin.initializeApp();
}

function addDaysToDateString(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function getAffectedDates(fechaOperacional, cruzaMedianoche) {
  const dates = [
    addDaysToDateString(fechaOperacional, -1),
    fechaOperacional,
    addDaysToDateString(fechaOperacional, 1),
  ];
  if (cruzaMedianoche) {
    dates.push(addDaysToDateString(fechaOperacional, 2));
  }
  return [...new Set(dates)].sort();
}

async function validatePermissions(db, uid, sucursalIds) {
  if (!uid) throw new HttpsError('unauthenticated', 'Usuario no autenticado.');
  const userDoc = await db.collection('Colaboradores').doc(uid).get();
  if (!userDoc.exists) throw new HttpsError('permission-denied', 'Usuario no encontrado en Colaboradores.');
  const role = userDoc.data().role;

  if (role === 'admin') return true;
  if (role === 'jefe_operaciones' || role === 'supervisor') {
    const scopesDoc = await db.collection('AlcancesOperativos').doc(uid).get();
    if (!scopesDoc.exists) throw new HttpsError('permission-denied', 'Sin alcance operativo definido.');
    const data = scopesDoc.data();
    const authorized = Array.isArray(data.sucursales) ? data.sucursales : [];
    // Convertir todo a string para comparar
    const isAuthorized = sucursalIds.every(id => authorized.some(authId => String(authId) === String(id)));
    if (!isAuthorized) throw new HttpsError('permission-denied', 'Sin permiso sobre algunas sucursales solicitadas.');
    return true;
  }
  throw new HttpsError('permission-denied', 'Rol no autorizado para programar.');
}

function isShiftActiveForConflict(shiftData) {
  const { codigoTurno, estado, tipoOperacion } = shiftData;
  if (codigoTurno === 'D' || estado === 'descanso') return false;
  if (estado === 'cancelado') return false;
  if (estado === 'trasladado' && tipoOperacion !== 'traslado') return false;
  return true;
}

exports.saveProgramacionValidated = onCall(
  {
    region: 'us-central1',
    cors: true,
  },
  async (request) => {
    const { operationRequestId, cambios, overrideConflicts } = request.data;
    const uid = request.auth?.uid;
    const db = admin.firestore();

    if (!operationRequestId || !cambios || !Array.isArray(cambios) || cambios.length === 0) {
      throw new HttpsError('invalid-argument', 'Payload inválido o vacío.');
    }
    if (cambios.length > 50) {
      throw new HttpsError('out-of-range', 'Demasiados cambios en una sola operación.');
    }

    const colaboradorId = cambios[0].colaboradorId;
    if (!cambios.every(c => c.colaboradorId === colaboradorId)) {
      throw new HttpsError('invalid-argument', 'Todos los cambios deben ser del mismo colaborador.');
    }

    const sucursalesInvolucradas = [...new Set(cambios.map(c => c.sucursalId))];
    await validatePermissions(db, uid, sucursalesInvolucradas);

    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(cambios)).digest('hex');
    const tokenId = `${uid}_${operationRequestId}`;
    const tokenRef = db.collection('OperationTokens').doc(tokenId);

    const result = await db.runTransaction(async (t) => {
      // 1. LECTURAS
      const tokenDoc = await t.get(tokenRef);
      
      let allDates = new Set();
      for (const c of cambios) {
        if (!c.fechaOperacional) throw new HttpsError('invalid-argument', 'Falta fechaOperacional.');
        const cruza = c.horarioSnapshot?.cruzaMedianoche || false;
        const affected = getAffectedDates(c.fechaOperacional, cruza);
        affected.forEach(d => allDates.add(d));
      }
      
      const lockIds = Array.from(allDates).map(date => `${colaboradorId}_${date}`).sort();
      const lockRefs = lockIds.map(id => db.collection('ProgramacionLocks').doc(id));
      const lockDocs = await t.getAll(...lockRefs);
      
      const datesArray = Array.from(allDates);
      if (datesArray.length > 10) throw new HttpsError('out-of-range', 'Rango de fechas demasiado amplio.');

      const shadowQuery = db.collection('TurnosProgramados')
        .where('colaboradorId', '==', colaboradorId)
        .where('fechaOperacional', 'in', datesArray);
      const shadowSnap = await t.get(shadowQuery);
      
      const legacyQuery = db.collection('programacion')
        .where('colaboradorId', '==', colaboradorId)
        .where('fecha', 'in', datesArray);
      const legacySnap = await t.get(legacyQuery);

      // 2. EVALUACIÓN DE IDEMPOTENCIA
      if (tokenDoc.exists) {
        const tokenData = tokenDoc.data();
        if (tokenData.payloadHash !== payloadHash) {
          throw new HttpsError('already-exists', 'idempotency_key_reused');
        }
        if (tokenData.status === 'success') {
          return { status: 'success', processed: tokenData.processed, idempotent: true, legacyWrites: tokenData.legacyWrites, canonicalWrites: tokenData.canonicalWrites };
        }
        if (tokenData.status === 'conflict') {
          return { status: 'conflict', conflictData: tokenData.resultado, idempotent: true };
        }
        // Si no tiene status, asumimos colisión o error previo corrupto. Lo reescribimos.
      }

      // 3. PROCESAMIENTO Y VALIDACIÓN
      const existingShifts = [];
      shadowSnap.forEach(doc => {
        const data = doc.data();
        if (isShiftActiveForConflict(data)) {
          existingShifts.push({ id: doc.id, collection: 'TurnosProgramados', ...data, fecha: data.fechaOperacional, horario: data.horarioSnapshot });
        }
      });
      legacySnap.forEach(doc => {
        const data = doc.data();
        if (isShiftActiveForConflict(data)) {
          existingShifts.push({ id: doc.id, collection: 'programacion', ...data, fecha: data.fecha, horario: data.horario });
        }
      });

      // Vista en memoria de los turnos después de aplicar updates/deletes del propio payload
      const finalShiftsView = existingShifts.filter(ex => {
        return !cambios.some(c => c.turnoIdExistente && (c.turnoIdExistente === ex.id || c.turnoIdExistente === ex.idLegacy || c.turnoIdExistente === ex.shadowId));
      });

      const globalOverriddenShifts = [];

      for (const cambio of cambios) {
        if (cambio.accion === 'delete') continue;

        // Normalización de valores legacy
        if (cambio.estado === 'noche' || cambio.codigoTurno === 'N') {
          cambio.codigoTurno = 'N';
          cambio.estado = 'programado';
        } else if (cambio.codigoTurno === 'D' || cambio.estado === 'descanso') {
          cambio.codigoTurno = 'D';
          cambio.estado = 'descanso';
        } else if (cambio.codigoTurno === 'X' || (!cambio.codigoTurno && cambio.estado === 'programado')) {
          cambio.codigoTurno = 'X';
          cambio.estado = 'programado';
        }

        if (!isShiftActiveForConflict(cambio)) continue;
        if (!cambio.horarioSnapshot) continue;

        const candidate = {
          fecha: cambio.fechaOperacional,
          horario: cambio.horarioSnapshot,
          id: cambio.turnoIdExistente,
          sucursalId: cambio.sucursalId
        };

        let hasConflict = false;
        let conflictDataToReturn = null;
        const currentOverrides = [];

        for (let i = 0; i < finalShiftsView.length; i++) {
          const existing = finalShiftsView[i];
          if (!existing.horario || !existing.fecha) continue;
          
          const conflictResult = detectConflict(candidate, existing);
          if (conflictResult.type !== 'none') {
            if (overrideConflicts && existing.collection) {
              currentOverrides.push({ index: i, shift: existing });
            } else {
              hasConflict = true;
              conflictDataToReturn = {
                code: "shift_conflict",
                colaboradorId: colaboradorId,
                conflictShiftId: existing.id || 'unknown',
                sucursalId: existing.sucursalId || existing.siteId || 'unknown',
                sucursalNombre: existing.sucursalNombre || existing.siteName || "Otra Sucursal",
                fechaOperacional: existing.fecha || 'unknown',
                inicio: existing.horario.inicio || '00:00',
                termino: existing.horario.termino || '00:00',
                codigoTurno: existing.codigoTurno || existing.turno || 'X',
                tipoOperacion: existing.tipoOperacion || 'contractual'
              };
              break;
            }
          }
        }

        if (hasConflict) {
          // Grabamos status de conflicto y no guardamos programación
          t.set(tokenRef, { 
            uid, 
            operationRequestId, 
            colaboradorId, 
            payloadHash, 
            status: 'conflict', 
            resultado: conflictDataToReturn, 
            createdAt: (tokenDoc.exists && tokenDoc.data().createdAt) ? tokenDoc.data().createdAt : FieldValue.serverTimestamp(),
            completedAt: FieldValue.serverTimestamp()
          });

          return { status: 'conflict', conflictData: conflictDataToReturn };
        }

        // Aplicamos los overrides locales
        for (let i = currentOverrides.length - 1; i >= 0; i--) {
          finalShiftsView.splice(currentOverrides[i].index, 1);
          globalOverriddenShifts.push(currentOverrides[i].shift);
        }

        finalShiftsView.push({ ...candidate, ...cambio, sucursalId: cambio.sucursalId, sucursalNombre: cambio.sucursalNombre });
      }

      // 4. ESCRITURAS
      lockRefs.forEach((ref, index) => {
        const currentLock = lockDocs[index].data();
        t.set(ref, { 
          version: FieldValue.increment(1),
          operationRequestId,
          actorUid: uid,
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      });

      let legacyWrites = 0;
      let canonicalWrites = 0;

      for (const cambio of cambios) {
        const shadowId = cambio.turnoIdExistente || db.collection('TurnosProgramados').doc().id;
        const legacyId = `${cambio.fechaOperacional}_${colaboradorId}_${cambio.sucursalId}`;
        
        const shadowRef = db.collection('TurnosProgramados').doc(shadowId);
        const legacyRef = db.collection('programacion').doc(legacyId);

        if (cambio.accion === 'delete') {
          t.delete(shadowRef);
          t.delete(legacyRef);
          canonicalWrites++;
          legacyWrites++;
        } else if (cambio.accion === 'create' || cambio.accion === 'update') {
          t.set(shadowRef, {
            colaboradorId: cambio.colaboradorId,
            sucursalId: cambio.sucursalId,
            sucursalNombre: cambio.sucursalNombre || "",
            fechaOperacional: cambio.fechaOperacional,
            codigoTurno: cambio.codigoTurno,
            horarioSnapshot: cambio.horarioSnapshot || null,
            estado: cambio.estado || 'programado',
            tipoOperacion: cambio.tipoOperacion || 'contractual',
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: uid
          }, { merge: true });
          canonicalWrites++;

          t.set(legacyRef, {
            colaboradorId: cambio.colaboradorId,
            employeeId: cambio.colaboradorId,
            siteId: cambio.sucursalId,
            fecha: cambio.fechaOperacional,
            date: cambio.fechaOperacional,
            turno: cambio.codigoTurno,
            horario: cambio.horarioSnapshot || null,
            estado: cambio.estado || 'programado',
            status: cambio.estado || 'programado',
            updatedAt: FieldValue.serverTimestamp(),
            shadowId: shadowRef.id
          }, { merge: true });
          legacyWrites++;
        }
      }

      // Procesar eliminaciones forzadas (overrides)
      const pathsToDelete = new Set();
      for (const shift of globalOverriddenShifts) {
        if (shift.collection === 'TurnosProgramados') pathsToDelete.add(`TurnosProgramados/${shift.id}`);
        if (shift.collection === 'programacion') {
          pathsToDelete.add(`programacion/${shift.id}`);
          if (shift.shadowId) pathsToDelete.add(`TurnosProgramados/${shift.shadowId}`);
        }
      }
      for (const path of pathsToDelete) {
        t.delete(db.doc(path));
        if (path.startsWith('TurnosProgramados')) canonicalWrites++;
        else legacyWrites++;
      }

      t.set(tokenRef, { 
        uid, 
        operationRequestId, 
        colaboradorId, 
        payloadHash, 
        status: 'success', 
        processed: cambios.length,
        legacyWrites,
        canonicalWrites,
        createdAt: tokenDoc.exists ? tokenDoc.data().createdAt : FieldValue.serverTimestamp(),
        completedAt: FieldValue.serverTimestamp()
      });

      return { status: 'success', processed: cambios.length, legacyWrites, canonicalWrites, colaboradorId, operationRequestId };
    });

    // 5. RESPUESTA POST-TRANSACCIÓN
    if (result.status === 'conflict') {
      throw new HttpsError('aborted', JSON.stringify(result.conflictData));
    }

    return result;
  }
);
