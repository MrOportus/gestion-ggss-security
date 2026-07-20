const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { toTimestampMs } = require('../phase4/conflictService');

// ────────────────────────────────────────────────────────────────────────────────
// Callable: forceCloseAttendanceValidated
// Fase 5D.1B — Cierre forzado autoritativo de asistencia manual
// ────────────────────────────────────────────────────────────────────────────────
exports.forceCloseAttendanceValidated = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: false // Ajustar según configuración real de App Check
  },
  async (request) => {
    // 1. Validar Autenticación
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debe iniciar sesión para realizar esta acción.');
    }

    const { attendanceId, requestId, note } = request.data;
    if (!attendanceId || !requestId) {
      throw new HttpsError('invalid-argument', 'Faltan parámetros obligatorios (attendanceId, requestId).');
    }

    const actorUid = request.auth.uid;
    const db = admin.firestore();

    try {
      // 2. Validar Roles (Solo admin, supervisor o jefe_operaciones)
      const actorDoc = await db.collection('Colaboradores').doc(actorUid).get();
      if (!actorDoc.exists) {
        throw new HttpsError('permission-denied', 'Usuario no registrado.');
      }
      
      const actorData = actorDoc.data();
      const role = actorData.role;
      const actorEmail = request.auth.token.email || actorData.email || actorUid;

      const ROLES_PERMITIDOS = ['admin', 'supervisor', 'jefe_operaciones'];
      if (!ROLES_PERMITIDOS.includes(role)) {
        throw new HttpsError('permission-denied', 'No tiene permisos para forzar el cierre.');
      }

      const payload = { attendanceId, note: (note || '').trim() };
      const payloadString = JSON.stringify(payload, Object.keys(payload).sort());
      const payloadHash = crypto.createHash('sha256').update(payloadString).digest('hex');
      const tokenId = `forceClose_${actorUid}_${requestId}`;
      const tokenRef = db.collection('OperationTokens').doc(tokenId);

      // 3. Ejecutar transacción
      const result = await db.runTransaction(async (transaction) => {
        // --- 3A. TODAS LAS LECTURAS PRIMERO ---
        const tokenDoc = await transaction.get(tokenRef);
        const checkInRef = db.collection('Asistencia').doc(attendanceId);
        const checkInSnap = await transaction.get(checkInRef);

        if (!checkInSnap.exists) {
          throw new HttpsError('not-found', 'Registro de asistencia no encontrado.');
        }
        const checkInData = checkInSnap.data();

        // Resolución de sucursal
        let tpSnap = null;
        let shiftSnap = null;
        if (checkInData.turnoProgramadoId) {
          tpSnap = await transaction.get(db.collection('TurnosProgramados').doc(checkInData.turnoProgramadoId));
        } else if (checkInData.shiftId && typeof checkInData.shiftId === 'string' && !checkInData.shiftId.startsWith('manual_')) {
          shiftSnap = await transaction.get(db.collection('programacion').doc(checkInData.shiftId));
        }

        // Alcances Operativos
        let alcanceSnap = null;
        if (role === 'supervisor' || role === 'jefe_operaciones') {
          alcanceSnap = await transaction.get(db.collection('AlcancesOperativos').doc(actorUid));
        }

        // Búsqueda de sesión posterior (para forceLogout condicional)
        const posteriorQuery = db.collection('Asistencia')
          .where('employeeId', '==', checkInData.employeeId)
          .where('type', '==', 'check_in')
          .where('estado', '==', 'ABIERTO')
          .where('timestamp', '>', checkInData.timestamp);
        const posteriorSnap = await transaction.get(posteriorQuery);

        // --- 3B. VALIDACIONES E IDEMPOTENCIA ---
        if (tokenDoc.exists) {
          const tData = tokenDoc.data();
          if (tData.payloadHash !== payloadHash) {
            throw new HttpsError('already-exists', 'request_id_reused');
          }
          if (tData.status === 'success') {
            return tData.result;
          }
        }

        const hasActivePosteriorSession = !posteriorSnap.empty;

        if (checkInData.status === 'completed' || checkInData.estado === 'CERRADO') {
          return { success: true, message: 'La asistencia ya estaba cerrada.', checkOutId: null };
        }

        // Resolver sucursal autoritativa
        let resolvedSiteId = null;
        let resolvedSiteName = null;
        let sucursalResolution = 'unresolved';

        if (tpSnap && tpSnap.exists && tpSnap.data().sucursalId) {
          resolvedSiteId = tpSnap.data().sucursalId;
          sucursalResolution = 'TurnosProgramados';
        } else if (shiftSnap && shiftSnap.exists && shiftSnap.data().siteId) {
          resolvedSiteId = shiftSnap.data().siteId;
          sucursalResolution = 'programacion';
        } else if (checkInData.siteId) {
          resolvedSiteId = checkInData.siteId;
          resolvedSiteName = checkInData.siteName;
          sucursalResolution = 'Asistencia';
        } else {
          resolvedSiteId = 'sucursal_no_determinada';
          sucursalResolution = 'unresolved';
        }

        if (!resolvedSiteName && resolvedSiteId) {
           resolvedSiteName = resolvedSiteId.toString();
        }

        // Validar Alcances Operativos
        if (role === 'supervisor' || role === 'jefe_operaciones') {
          if (resolvedSiteId === 'sucursal_no_determinada') {
             throw new HttpsError('permission-denied', 'No se puede forzar el cierre de un turno sin sucursal determinada siendo usuario no global.');
          }
          if (!alcanceSnap || !alcanceSnap.exists || !alcanceSnap.data().activo) {
             throw new HttpsError('permission-denied', 'No tiene alcance operativo activo.');
          }
          const dataAlcance = alcanceSnap.data();
          if (dataAlcance.alcanceNacional !== true) {
             const sucursales = dataAlcance.sucursalesAutorizadas || [];
             if (!sucursales.includes(resolvedSiteId.toString())) {
               throw new HttpsError('permission-denied', `Sin alcance en sucursal del turno: ${resolvedSiteId}.`);
             }
          }
        }

        // Corregir fecha operacional (jornadaDate) usando utilidad America/Santiago
        let jornadaDate = checkInData.localDate || '';
        if (!jornadaDate) {
          const startObj = new Date(checkInData.timestamp);
          const formatter = new Intl.DateTimeFormat('es-CL', {
            timeZone: 'America/Santiago',
            year: 'numeric', month: '2-digit', day: '2-digit',
          });
          const parts = formatter.formatToParts(startObj);
          const pMap = {};
          parts.forEach(p => { pMap[p.type] = p.value; });
          jornadaDate = `${pMap.year}-${pMap.month}-${pMap.day}`;
        }

        const now = new Date();
        const endTimestamp = now.toISOString();
        let detectedClosureType = 'cierre por Admin';
        if (note && note.toLowerCase().includes('automático')) {
          detectedClosureType = 'cierre forzado';
        }

        const checkOutId = `forced_checkout_${attendanceId}`;
        const finalResult = { success: true, checkOutId };

        // --- 3C. ESCRITURAS ---
        transaction.update(checkInRef, {
          status: 'completed',
          endTime: endTimestamp,
          estado: 'CERRADO',
          tipoCierre: detectedClosureType === 'cierre forzado' ? 'AUTOMATICO' : 'MANUAL',
          horaSalidaReal: endTimestamp,
          detalle: detectedClosureType,
        });

        const checkOutRef = db.collection('Asistencia').doc(checkOutId);
        const checkOutLog = {
          ...checkInData,
          id: checkOutId,
          type: 'check_out',
          timestamp: endTimestamp,
          status: 'completed',
          isManual: detectedClosureType !== 'cierre forzado',
          systemNote: note || (detectedClosureType === 'cierre forzado' ? "Cierre automático de sesión" : "Cierre forzado por administrador"),
          tipoCierre: detectedClosureType === 'cierre forzado' ? 'AUTOMATICO' : 'MANUAL',
          estado: 'CERRADO',
          horaSalidaReal: endTimestamp,
          detalle: detectedClosureType,
        };
        transaction.set(checkOutRef, checkOutLog);

        if (!hasActivePosteriorSession) {
          const empRef = db.collection('Colaboradores').doc(checkInData.employeeId);
          transaction.update(empRef, {
            forceLogout: true,
            lastForceLogout: endTimestamp
          });
        }

        const manualDocId = `manual_${checkInData.employeeId}_${jornadaDate}`;
        const manualRef = db.collection('asistencia_manual').doc(manualDocId);
        transaction.set(manualRef, {
          employeeId: checkInData.employeeId,
          date: jornadaDate,
          status: 'presente',
          type: detectedClosureType === 'cierre forzado' ? 'forced_checkout_auto' : 'forced_checkout',
          siteId: resolvedSiteId !== 'sucursal_no_determinada' ? resolvedSiteId : 'all',
          updatedAt: now.toISOString()
        }, { merge: true });

        const auditId = `attendance_force_closed_${attendanceId}`;
        const auditRef = db.collection('AuditoriaAcciones').doc(auditId);
        transaction.set(auditRef, {
          accion: "attendance_force_closed",
          actorId: actorUid,
          actorEmail,
          actorRol: role,
          colaboradorId: checkInData.employeeId,
          attendanceId,
          checkOutId,
          turnoProgramadoId: checkInData.turnoProgramadoId || null,
          shiftId: checkInData.shiftId || null,
          sucursalId: resolvedSiteId !== 'sucursal_no_determinada' ? resolvedSiteId : null,
          sucursalResolution,
          fechaOperacional: jornadaDate,
          estadoAnterior: checkInData.status || 'open',
          estadoNuevo: 'completed',
          tipoCierre: detectedClosureType,
          motivo: note || null,
          requestId,
          createdAt: now.toISOString(),
          origen: "admin_dashboard"
        });

        transaction.set(tokenRef, {
          operationType: 'force_close',
          actorUid,
          requestId,
          attendanceId,
          payloadHash,
          status: 'success',
          result: finalResult,
          createdAt: now.toISOString(),
          completedAt: now.toISOString()
        });

        return finalResult;
      });

      return result;

    } catch (error) {
      console.error('[FORCE_CLOSE] Error:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError('internal', error.message || 'Error interno del servidor');
    }
  }
);
