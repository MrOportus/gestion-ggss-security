const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const crypto = require('crypto');

// Asegurar inicialización
if (!admin.apps.length) {
  admin.initializeApp();
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
    const isAuthorized = sucursalIds.every(id => authorized.some(authId => String(authId) === String(id)));
    if (!isAuthorized) throw new HttpsError('permission-denied', 'Sin permiso sobre algunas sucursales solicitadas.');
    return true;
  }
  throw new HttpsError('permission-denied', 'Rol no autorizado para programar.');
}

exports.saveProgramacionValidated = onCall(
  {
    region: 'us-central1',
    cors: true,
    timeoutSeconds: 120,
  },
  async (request) => {
    const { operationRequestId, cambios } = request.data;
    const uid = request.auth?.uid;
    const db = admin.firestore();

    // ── Validaciones de entrada ────────────────────────────────────────────────
    if (!operationRequestId || !cambios || !Array.isArray(cambios) || cambios.length === 0) {
      throw new HttpsError('invalid-argument', 'Payload inválido o vacío.');
    }
    if (cambios.length > 200) {
      throw new HttpsError('out-of-range', 'Demasiados cambios en una sola operación (máx. 200).');
    }

    const colaboradorId = cambios[0].colaboradorId;
    if (!cambios.every(c => c.colaboradorId === colaboradorId)) {
      throw new HttpsError('invalid-argument', 'Todos los cambios deben ser del mismo colaborador.');
    }
    for (const c of cambios) {
      if (!c.fechaOperacional) throw new HttpsError('invalid-argument', 'Falta fechaOperacional en algún cambio.');
    }

    const sucursalesInvolucradas = [...new Set(cambios.map(c => c.sucursalId))];
    await validatePermissions(db, uid, sucursalesInvolucradas);

    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(cambios)).digest('hex');
    const tokenId = `${uid}_${operationRequestId}`;
    const tokenRef = db.collection('OperationTokens').doc(tokenId);

    // ── Lock simplificado: un solo doc por colaborador-mes ────────────────────
    // Determinar el mes operacional (puede haber varios meses en el lote)
    const mesesSet = new Set(cambios.map(c => c.fechaOperacional.substring(0, 7)));
    const lockRefs = Array.from(mesesSet).sort().map(mes =>
      db.collection('ProgramacionLocks').doc(`${colaboradorId}_${mes}`)
    );

    const result = await db.runTransaction(async (t) => {
      // ── 1. LECTURAS ──────────────────────────────────────────────────────────
      const tokenDoc = await t.get(tokenRef);
      const lockDocs = await t.getAll(...lockRefs);

      // ── 2. IDEMPOTENCIA ───────────────────────────────────────────────────────
      if (tokenDoc.exists) {
        const tokenData = tokenDoc.data();
        if (tokenData.payloadHash !== payloadHash) {
          throw new HttpsError('already-exists', 'idempotency_key_reused');
        }
        if (tokenData.status === 'success') {
          return {
            status: 'success',
            processed: tokenData.processed,
            idempotent: true,
            legacyWrites: tokenData.legacyWrites,
            canonicalWrites: tokenData.canonicalWrites
          };
        }
      }

      // ── 3. ESCRITURAS ─────────────────────────────────────────────────────────
      // Actualizar locks por mes
      lockRefs.forEach(ref => {
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
        // Normalización de codigoTurno/estado
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
            sucursalNombre: cambio.sucursalNombre || '',
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

      // Token de operación
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

    // ── 4. ENCOLAR VERIFICACIÓN ASÍNCRONA DE CONFLICTOS ───────────────────────
    // Se ejecuta FUERA de la transacción para no bloquear el retorno al cliente.
    // La Cloud Function checkProgramacionConflicts procesará esto en segundo plano.
    if (result.status === 'success') {
      try {
        const fechasActivas = cambios
          .filter(c => c.accion !== 'delete' && c.codigoTurno !== 'D' && c.horarioSnapshot)
          .map(c => c.fechaOperacional);

        if (fechasActivas.length > 0) {
          await db.collection('ProgramacionConflictQueue').add({
            colaboradorId,
            fechas: fechasActivas,
            sucursalIds: sucursalesInvolucradas,
            requestedBy: uid,
            operationRequestId,
            status: 'pending',
            createdAt: FieldValue.serverTimestamp()
          });
        }
      } catch (queueErr) {
        // No bloquear el éxito del guardado si falla el encolamiento
        logger.warn('[saveProgramacion] Error al encolar verificación de conflictos:', queueErr);
      }
    }

    return result;
  }
);
