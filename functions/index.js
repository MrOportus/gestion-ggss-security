console.log("=== INDEX.JS LOADED ===");
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const crypto = require('crypto');
const functionsV1 = require('firebase-functions/v1');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const axios = require('axios');

if (!admin.apps.length) {
  admin.initializeApp();
}
const { resolveShadowShift, toAbsoluteMinutes } = require('./shadowResolver');
const { processAutoCloseShifts } = require('./autoCloseHelper');
const { saveProgramacionValidated } = require('./src/phase5/saveProgramacionValidated');
const { forceCloseAttendanceValidated } = require('./src/phase5/forceCloseAttendanceValidated');
const { checkProgramacionConflicts } = require('./src/phase5/checkProgramacionConflicts');
const { getAttendanceShadowValidated } = require('./src/phase5d2/getAttendanceShadowValidated');
const { regularizeContractValidated } = require('./src/phase3/regularizeContractValidated');
const { logContractShadowDiagnostic } = require('./src/phase3/logContractShadowDiagnostic');

exports.saveProgramacionValidated = saveProgramacionValidated;
exports.forceCloseAttendanceValidated = forceCloseAttendanceValidated;
exports.checkProgramacionConflicts = checkProgramacionConflicts;
exports.getAttendanceShadowValidated = getAttendanceShadowValidated;
exports.regularizeContractValidated = regularizeContractValidated;
exports.logContractShadowDiagnostic = logContractShadowDiagnostic;

const { loginWithRut } = require('./src/auth/loginWithRut');
exports.loginWithRut = loginWithRut;

const { generateBunnyUploadUrl } = require('./src/bunny/generateBunnyUploadUrl');
exports.generateBunnyUploadUrl = generateBunnyUploadUrl;

// Función para generar contratos (vía Apps Script)
exports.generarContrato = onRequest(
    { 
        region: 'us-central1',
        cors: true
    },
    async (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }

        // 1. Verificar autenticación via Bearer token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'No autorizado. Token requerido.' });
            return;
        }

        let userEmail = '';
        let userId = '';
        try {
            const idToken = authHeader.split('Bearer ')[1];
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            userEmail = decodedToken.email || '';
            userId = decodedToken.uid;
        } catch (authError) {
            console.error('Error verificando token:', authError);
            res.status(401).json({ error: 'Token inválido o expirado.' });
            return;
        }

        const { 
            colaboradorId, templateId, tipoContrato,
            nombre, rut, fecha_inicio, fecha_termino,
            fecha_nacimiento, nacionalidad, direccion,
            estado_civil, telefono, salud, afp,
            sucursal_name, sucursal_address, empresa, horarioA, horarioB, sueldo,
            codigo_interno
        } = req.body;

        if (!colaboradorId || !nombre || !rut) {
            res.status(400).json({ error: 'Faltan campos obligatorios.' });
            return;
        }

        const appsScriptUrl = 'https://script.google.com/macros/s/AKfycbyEyoCNuml3GRb6V6Rr7L8_lX4nYsgW2pfjWbQssAQ8MCc_1a7N76EUin9Shs8cas-R0A/exec';

        try {
            const response = await axios({
                method: 'post',
                url: appsScriptUrl,
                data: {
                    templateId, nombre, rut,
                    fecha_inicio, fecha_termino, fecha_nacimiento,
                    nacionalidad, direccion, estado_civil,
                    telefono, salud, afp,
                    sucursal_name, sucursal_address, empresa, horarioA, horarioB, sueldo,
                    codigo_interno
                },
                headers: { 'Content-Type': 'application/json' },
                maxRedirects: 5,
                validateStatus: (status) => status < 500
            });

            const result = response.data;
            console.log('Apps Script response:', JSON.stringify(result));

            if (result.status === 'success') {
                const pdfUrl = result.pdfUrl || result.url || '';
                const downloadUrl = result.downloadUrl || '';

                const contratoRef = admin.firestore()
                    .collection('trabajadores')
                    .doc(colaboradorId)
                    .collection('contratos')
                    .doc();

                await contratoRef.set({
                    url: pdfUrl,
                    downloadUrl: downloadUrl,
                    tipoContrato: tipoContrato || 'Desconocido',
                    fecha_creacion: admin.firestore.FieldValue.serverTimestamp(),
                    generado_por: userEmail || userId
                });

                res.status(200).json({ 
                    success: true, 
                    url: pdfUrl,
                    downloadUrl: downloadUrl
                });
            } else {
                console.error('Apps Script Error:', result);
                res.status(500).json({ error: result.message || 'Error en Apps Script.' });
            }

        } catch (error) {
            console.error('Error en generarContrato:', error.message);
            res.status(500).json({ error: 'Error al procesar: ' + error.message });
        }
    }
);

// Función para notificar nuevo documento asignado
exports.notificarNuevoDocumento = onDocumentCreated(
    { 
        document: 'documents/{docId}',
        region: 'us-central1'
    },
    async (event) => {
        const snapshot = event.data;
        if (!snapshot) return;

        const docData = snapshot.data();
        const workerId = docData.assignedTo;
        const docTitle = docData.title || 'nuevo documento';

        if (!workerId) return;

        try {
            const workerSnapshot = await admin.firestore().collection('Colaboradores').doc(workerId).get();
            if (!workerSnapshot.exists) {
                console.log(`Trabajador ${workerId} no encontrado.`);
                return;
            }

            const workerData = workerSnapshot.data();
            const rawTokens = workerData.fcmTokens || [];
            
            // Filtrar tokens duplicados
            const tokens = [...new Set(rawTokens)];

            console.log(`[FCM-LOG] Procesando ${rawTokens.length} tokens totales. Únicos: ${tokens.length} para el usuario ${workerId}`);

            if (tokens.length === 0) {
                console.log(`El trabajador ${workerId} no tiene tokens FCM registrados.`);
                return;
            }

            // 2. Preparar el mensaje
            const message = {
                notification: {
                    title: 'Nuevo documento disponible',
                    body: 'Tienes un nuevo documento para firmar disponible. Favor de firmarlo lo antes posible. Gracias.'
                },
                android: {
                    notification: {
                        channelId: 'ggss_notifications',
                        sound: 'notificacion_ggss.mp3'
                    }
                },
                apns: {
                    payload: {
                        aps: {
                            sound: 'notificacion_ggss.mp3'
                        }
                    }
                },
                data: {
                    type: 'new_doc',
                    docId: event.params.docId
                },
                tokens: tokens,
            };

            // 3. Enviar notificaciones
            const response = await admin.messaging().sendEachForMulticast(message);
            console.log(`[FCM-LOG] Resultado: ${response.successCount} éxito, ${response.failureCount} error para doc: ${docTitle}`);

            // LIMPIEZA DE TOKENS INVÁLIDOS
            if (response.failureCount > 0) {
                const tokensToRemove = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        const error = resp.error;
                        if (error.code === 'messaging/registration-token-not-registered' ||
                            error.code === 'messaging/invalid-argument') {
                            tokensToRemove.push(tokens[idx]);
                        }
                    }
                });

                if (tokensToRemove.length > 0) {
                    await admin.firestore().collection('Colaboradores').doc(workerId).update({
                        fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokensToRemove)
                    });
                    console.log(`Se eliminaron ${tokensToRemove.length} tokens inválidos para ${workerId}`);
                }
            }
        } catch (error) {
            console.error('Error en notificarNuevoDocumento:', error);
        }
    }
);

// Función para notificar nueva oferta de turno
exports.notificarNuevaOfertaTurno = onDocumentCreated(
    { 
        document: 'solicitudes_turnos/{docId}',
        region: 'us-central1'
    },
    async (event) => {
        const snapshot = event.data;
        if (!snapshot) return;

        const docData = snapshot.data();
        if (docData.estado !== 'disponible') return;

        const guardiasPermitidos = docData.guardias_permitidos || [];
        const sucursalNombre = docData.sucursal_nombre || 'una sucursal';
        const monto = docData.monto || 0;

        // ── Construir texto del rango de fechas ──────────────────────────────
        const horarioInicio = docData.horario_inicio || '';
        const horarioFin    = docData.horario_fin    || '';

        let rangoTexto = '';
        let diasCount  = 1;

        if (horarioInicio && horarioFin) {
            const fechaIni = new Date(horarioInicio.split('T')[0] + 'T00:00:00');
            const fechaFin = new Date(horarioFin.split('T')[0]   + 'T00:00:00');
            diasCount = Math.round((fechaFin - fechaIni) / 86400000) + 1;

            const opts = { day: '2-digit', month: '2-digit' };
            const strIni = fechaIni.toLocaleDateString('es-CL', opts);
            const strFin = fechaFin.toLocaleDateString('es-CL', opts);

            if (diasCount > 1) {
                rangoTexto = `Del ${strIni} al ${strFin} (${diasCount} días)`;
            } else {
                rangoTexto = `El ${strIni}`;
            }
        }

        const notifBody = diasCount > 1
            ? `${rangoTexto} en ${sucursalNombre} · $${monto.toLocaleString('es-CL')}/día · Total: $${(monto * diasCount).toLocaleString('es-CL')}`
            : `${rangoTexto && rangoTexto + ' '}en ${sucursalNombre} por $${monto.toLocaleString('es-CL')}`;

        let targetTokens = [];
        
        try {
            if (guardiasPermitidos.length > 0) {
                // Notificar a los guardias seleccionados
                for (const workerId of guardiasPermitidos) {
                    const workerDoc = await admin.firestore().collection('Colaboradores').doc(workerId).get();
                    if (workerDoc.exists) {
                        const tokens = workerDoc.data().fcmTokens || [];
                        targetTokens = targetTokens.concat(tokens);
                    }
                }
            } else {
                // Notificar a TODOS los guardias (oferta masiva)
                const workersSnapshot = await admin.firestore().collection('Colaboradores').where('role', '==', 'worker').get();
                workersSnapshot.forEach(doc => {
                    const tokens = doc.data().fcmTokens || [];
                    targetTokens = targetTokens.concat(tokens);
                });
            }

            // Deduplicar tokens
            targetTokens = [...new Set(targetTokens)];

            if (targetTokens.length === 0) {
                console.log('No hay tokens FCM para notificar la oferta de turno.');
                return;
            }

            console.log(`[FCM-TURNOS] Enviando notificación a ${targetTokens.length} tokens.`);

            // Firebase multicast limit is 500 tokens per request
            const chunkSize = 500;
            let successCount = 0;
            let failureCount = 0;

            for (let i = 0; i < targetTokens.length; i += chunkSize) {
                const chunk = targetTokens.slice(i, i + chunkSize);
                const message = {
                    notification: {
                        title: '[GGSS] ¡Nuevo Turno Extra! 💰',
                        body: notifBody
                    },
                    android: {
                        notification: {
                            channelId: 'ggss_notifications',
                            sound: 'notificacion_ggss.mp3'
                        }
                    },
                    apns: {
                        payload: {
                            aps: {
                                sound: 'notificacion_ggss.mp3'
                            }
                        }
                    },
                    data: {
                        type: 'market_turno',
                        docId: event.params.docId,
                        url: '/worker-attendance'
                    },
                    tokens: chunk,
                };

                const response = await admin.messaging().sendEachForMulticast(message);
                successCount += response.successCount;
                failureCount += response.failureCount;
                
                if (response.failureCount > 0) {
                    const tokensToRemove = [];
                    response.responses.forEach((resp, idx) => {
                        if (!resp.success && (resp.error.code === 'messaging/registration-token-not-registered')) {
                            tokensToRemove.push(chunk[idx]);
                        }
                    });
                    if (tokensToRemove.length > 0) {
                        console.log(`[FCM-TURNOS] Detectados ${tokensToRemove.length} tokens inválidos.`);
                    }
                }
            }

            console.log(`[FCM-TURNOS] Proceso completado: ${successCount} éxito, ${failureCount} fallo.`);
        } catch (error) {
            console.error('Error en notificarNuevaOfertaTurno:', error);
        }
    }
);

// ────────────────────────────────────────────────────────────────────────────────
// Cloud Function: Resetear contraseña de un usuario en Firebase Authentication
// Solo puede ser invocada por un administrador autenticado.
// Usa admin.auth().updateUser() para cambiar la contraseña real de login.
// ────────────────────────────────────────────────────────────────────────────────
exports.resetUserPassword = onCall(
    {
        region: 'us-central1',
    },
    async (request) => {
        // 1. Verificar que el llamador está autenticado
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Debe iniciar sesión para realizar esta acción.');
        }

        const callerUid = request.auth.uid;

        // 2. Verificar que el llamador es un admin
        try {
            const callerDoc = await admin.firestore().collection('Colaboradores').doc(callerUid).get();
            if (!callerDoc.exists || callerDoc.data().role !== 'admin') {
                throw new HttpsError('permission-denied', 'Solo los administradores pueden resetear contraseñas.');
            }
        } catch (error) {
            if (error instanceof HttpsError) throw error;
            console.error('Error verificando permisos del admin:', error);
            throw new HttpsError('internal', 'Error verificando permisos.');
        }

        const { employeeId, newPassword } = request.data;

        // 3. Validar datos de entrada
        if (!employeeId || !newPassword) {
            throw new HttpsError('invalid-argument', 'Se requiere employeeId y newPassword.');
        }

        if (newPassword.length < 6) {
            throw new HttpsError('invalid-argument', 'La contraseña debe tener al menos 6 caracteres.');
        }

        // 4. Verificar que el empleado existe en Firestore
        const employeeDoc = await admin.firestore().collection('Colaboradores').doc(employeeId).get();
        if (!employeeDoc.exists) {
            throw new HttpsError('not-found', 'Empleado no encontrado en la base de datos.');
        }

        const employeeData = employeeDoc.data();
        const employeeEmail = employeeData.email;

        // 5. Verificar si el empleado es un usuario "bulk" (sin cuenta Auth)
        const isBulkUser = employeeId.startsWith('bulk-');

        if (isBulkUser) {
            // Usuarios bulk no tienen cuenta Auth — necesitamos crear una
            if (!employeeEmail) {
                throw new HttpsError('failed-precondition', 'El empleado no tiene email registrado. No se puede crear cuenta.');
            }

            try {
                // Intentar crear el usuario en Auth
                const newUser = await admin.auth().createUser({
                    email: employeeEmail,
                    password: newPassword,
                    displayName: `${employeeData.firstName || ''} ${employeeData.lastNamePaterno || ''}`.trim(),
                });

                // Actualizar el documento en Firestore con el nuevo UID real
                // Crear documento con el UID real y eliminar el bulk
                const newUid = newUser.uid;
                const updatedData = {
                    ...employeeData,
                    id: newUid,
                    tempPasswordLog: newPassword,
                };

                await admin.firestore().collection('Colaboradores').doc(newUid).set(updatedData);
                await admin.firestore().collection('Colaboradores').doc(employeeId).delete();

                console.log(`[RESET-PWD] Usuario bulk ${employeeId} migrado a Auth con UID: ${newUid}`);

                return {
                    success: true,
                    message: `Cuenta creada exitosamente para ${employeeData.firstName}. Nueva contraseña asignada.`,
                    newUid: newUid,
                    migrated: true,
                };
            } catch (createError) {
                if (createError.code === 'auth/email-already-exists') {
                    // El email ya existe en Auth — buscar el usuario y actualizar su contraseña
                    try {
                        const existingUser = await admin.auth().getUserByEmail(employeeEmail);
                        await admin.auth().updateUser(existingUser.uid, { password: newPassword });
                        
                        // Actualizar tempPasswordLog en Firestore
                        await admin.firestore().collection('Colaboradores').doc(employeeId).update({
                            tempPasswordLog: newPassword,
                        });

                        console.log(`[RESET-PWD] Contraseña actualizada para usuario bulk con email existente: ${employeeEmail}`);

                        return {
                            success: true,
                            message: `Contraseña actualizada exitosamente para ${employeeData.firstName}.`,
                            migrated: false,
                        };
                    } catch (updateError) {
                        console.error('[RESET-PWD] Error actualizando usuario existente:', updateError);
                        throw new HttpsError('internal', 'Error al actualizar la contraseña del usuario existente.');
                    }
                }
                console.error('[RESET-PWD] Error creando usuario:', createError);
                throw new HttpsError('internal', 'Error al crear la cuenta: ' + createError.message);
            }
        }

        // 6. Usuario normal (tiene UID de Auth) — actualizar contraseña directamente
        try {
            await admin.auth().updateUser(employeeId, { password: newPassword });

            // Actualizar tempPasswordLog en Firestore
            await admin.firestore().collection('Colaboradores').doc(employeeId).update({
                tempPasswordLog: newPassword,
            });

            console.log(`[RESET-PWD] Contraseña actualizada para usuario: ${employeeId} (${employeeData.firstName} ${employeeData.lastNamePaterno})`);

            return {
                success: true,
                message: `Contraseña actualizada exitosamente para ${employeeData.firstName} ${employeeData.lastNamePaterno}.`,
                migrated: false,
            };
        } catch (authError) {
            console.error('[RESET-PWD] Error actualizando contraseña en Auth:', authError);
            
            if (authError.code === 'auth/user-not-found') {
                // El UID no corresponde a un usuario Auth — crear la cuenta
                try {
                    if (!employeeEmail) {
                        throw new HttpsError('failed-precondition', 'El empleado no tiene email. No se puede crear cuenta Auth.');
                    }
                    
                    await admin.auth().createUser({
                        uid: employeeId,
                        email: employeeEmail,
                        password: newPassword,
                        displayName: `${employeeData.firstName || ''} ${employeeData.lastNamePaterno || ''}`.trim(),
                    });

                    await admin.firestore().collection('Colaboradores').doc(employeeId).update({
                        tempPasswordLog: newPassword,
                    });

                    console.log(`[RESET-PWD] Cuenta Auth creada para usuario existente sin Auth: ${employeeId}`);

                    return {
                        success: true,
                        message: `Cuenta creada y contraseña asignada para ${employeeData.firstName} ${employeeData.lastNamePaterno}.`,
                        migrated: false,
                    };
                } catch (createErr) {
                    console.error('[RESET-PWD] Error creando cuenta Auth para usuario existente:', createErr);
                    throw new HttpsError('internal', 'Error al crear la cuenta Auth: ' + createErr.message);
                }
            }

            throw new HttpsError('internal', 'Error al actualizar la contraseña: ' + authError.message);
        }
    }
);

// ────────────────────────────────────────────────────────────────────────────────
// Cloud Function: Cierre automático de turnos programados
// Se ejecuta cada 5 minutos y cierra turnos que han superado su hora de término
// + margen de gracia configurable.
// ────────────────────────────────────────────────────────────────────────────────

// Helper functions for Santiago, Chile Timezone
function getChileParts(date) {
  const formatter = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const map = new Map(parts.map(p => [p.type, p.value]));
  return {
    year: Number(map.get('year')),
    month: Number(map.get('month')),
    day: Number(map.get('day')),
    hour: Number(map.get('hour')),
    minute: Number(map.get('minute')),
    second: Number(map.get('second'))
  };
}

function chileLocalToUtc(year, month, day, hour, minute) {
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = getChileParts(d);
  const diffMs = d.getTime() - Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return new Date(d.getTime() + diffMs);
}

const AUTO_CLOSE_GRACE_MINUTES = 15;

// Mapeo de horarios por tipo de turno
const SHIFT_SCHEDULES = {
  'programado': { inicio: '07:30', termino: '19:30' },
  'noche':      { inicio: '19:30', termino: '07:30' },
};





exports.autoCloseShifts = onSchedule(
  {
    schedule: 'every 30 minutes',
    region: 'us-central1',
    timeZone: 'America/Santiago',
    memory: '256MiB',
  },
  async (event) => {
    const now = new Date();
    await processAutoCloseShifts(admin.firestore(), now);
  }
);


// ──────────────────────────────────────────────────────────────────────
// FASE 5B.4: Shadow Resolver Backend
// ──────────────────────────────────────────────────────────────────────
exports.shadowAttendanceResolver = functionsV1.firestore.document('Asistencia/{attendanceId}').onCreate(async (snapshot, context) => {
  try {
    const attendanceId = context.params.attendanceId;
    const data = snapshot.data();
    if (!data || data.type !== 'check_in') {
      return;
    }

    const db = admin.firestore();
  
    const { employeeId, siteId, localDate, timestamp } = data;
    
    // Validaciones
    if (!employeeId || !siteId || !localDate || !timestamp) return;

    // Feature Flag Check (Phase 5C Canary & Staging)
    const featureFlagSnap = await db.collection('app_config').doc('feature_flags').get();
    const flags = featureFlagSnap.data() || {};
    const attendanceShadowEnabled = flags.attendanceShadowEnabled === true;
    const attendanceShadowAllBranches = flags.attendanceShadowAllBranches === true;
    const sucursalesHabilitadas = Array.isArray(flags.sucursalesHabilitadas) ? flags.sucursalesHabilitadas : [];
    
    const shadowActivo = attendanceShadowEnabled && (attendanceShadowAllBranches || sucursalesHabilitadas.includes(siteId));
    
    if (!shadowActivo) {
      console.log(`[SHADOW RESOLVER] Abortado por Feature Flag o Sucursal no habilitada (Site: ${siteId}).`);
      return;
    }

    // Use the event timestamp (trigger execution time) explicitly, guarding against spoofed offline timestamps.
    const baseDate = context.timestamp ? new Date(context.timestamp) : new Date(timestamp);
    
    // IANA Timezone conversion robust implementation
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23' // 0-23 hours
    });
    const parts = formatter.formatToParts(baseDate);
    const dateMap = new Map(parts.map(p => [p.type, p.value]));
    
    const santiagoYear = dateMap.get('year');
    const santiagoMonth = dateMap.get('month').padStart(2, '0');
    const santiagoDay = dateMap.get('day').padStart(2, '0');
    const santiagoHour = dateMap.get('hour').padStart(2, '0');
    const santiagoMinute = dateMap.get('minute').padStart(2, '0');
    
    const dateStr = `${santiagoYear}-${santiagoMonth}-${santiagoDay}`;
    const timeStr = `${santiagoHour}:${santiagoMinute}`;
    const isNextDay = dateStr !== localDate;
    
    const currentAbsMins = toAbsoluteMinutes(localDate, timeStr, isNextDay);
    
    await db.runTransaction(async (transaction) => {
      const diagRef = db.collection('AttendanceShadowDiagnostics').doc(attendanceId);
      const diagDoc = await transaction.get(diagRef);
      
      const attendanceRef = snapshot.ref;
      const currentAttendanceDoc = await transaction.get(attendanceRef);
      if (!currentAttendanceDoc.exists) return;
      
      const currentAttendanceData = currentAttendanceDoc.data();
      const currentId = currentAttendanceData.turnoProgramadoId;

      if (diagDoc.exists) {
        const diagData = diagDoc.data();
        if (diagData.resultado === 'unico' && diagData.turnoProgramadoId && !currentId) {
          logger.info(`[SHADOW RESOLVER] Reparando asistencia ${attendanceId} (falta ID) según diagnóstico previo.`);
          transaction.update(attendanceRef, { turnoProgramadoId: diagData.turnoProgramadoId });
          return;
        }
        logger.info(`[SHADOW RESOLVER] Asistencia ${attendanceId} ya diagnosticada. Ignorando.`);
        return;
      }
      
      const candidatesSnap = await transaction.get(
        db.collection('TurnosProgramados')
          .where('colaboradorId', '==', employeeId)
          .where('fecha', 'in', [localDate, dateStr])
      );
        
      const candidates = [];
      candidatesSnap.forEach(doc => {
        candidates.push({ id: doc.id, ...doc.data() });
      });

      const legacyCode = data.turnoProgramadoStatus || 'programado'; // ej 'noche' o 'programado'
      const result = resolveShadowShift(candidates, siteId, legacyCode, currentAbsMins);

      // Si Asistencia YA tiene ID asignado manual o por otro medio
      if (currentId) {
        if (currentId === result.turnoProgramadoId) {
          logger.info(`[SHADOW RESOLVER] Asistencia ya tiene el ID correcto (${currentId}). Solo confirmando diagnóstico.`);
        } else {
          logger.info(`[SHADOW RESOLVER] Conflicto: Asistencia tiene ID ${currentId} pero resolución entregó ${result.turnoProgramadoId || 'ninguno'}.`);
          result.diagnostico = 'conflicto_tecnico';
        }
      } else {
        if (result.turnoProgramadoId) {
          transaction.update(attendanceRef, { turnoProgramadoId: result.turnoProgramadoId });
        }
      }

      transaction.set(diagRef, {
        attendanceId,
        turnoProgramadoId: result.turnoProgramadoId || null,
        resultado: result.diagnostico,
        cantidadCandidatos: candidates.length,
        sucursalId: siteId,
        fechaOperacional: localDate,
        resolverVersion: '1.0.1',
        createdAt: FieldValue.serverTimestamp(),
        errorCode: (result.diagnostico !== 'unico' && result.diagnostico !== 'conflicto_tecnico') ? result.diagnostico : null
      });
    });
  } catch (error) {
    logger.error(`[SHADOW RESOLVER] Error final (${context.params.attendanceId}):`, error);
    try {
      await admin.firestore().collection('AttendanceShadowDiagnostics').doc(context.params?.attendanceId || 'unknown').set({
        attendanceId: context.params?.attendanceId || 'unknown',
        resultado: 'error_tecnico',
        createdAt: FieldValue.serverTimestamp(),
        errorCode: 'exception'
      }, { merge: true });
    } catch (e2) {
      logger.error(`[SHADOW RESOLVER] Catch secondary:`, e2);
    }
  }
});


// ─── Integridad Documental ────────────────────────────────────────────────────

/**
 * calcularHashDocumentoFirmado
 * Trigger: se activa cuando un documento de la colección 'documents' es actualizado.
 * Condición: el campo 'status' pasa de cualquier valor a 'signed' y aún no tiene hash.
 * Acción: descarga el PDF firmado desde Storage, calcula SHA-256, guarda el hash
 * y un validationId único en Firestore. Nunca lo ejecuta el cliente.
 */
exports.calcularHashDocumentoFirmado = onDocumentUpdated(
    { document: 'documents/{docId}', region: 'us-central1' },
    async (event) => {
        const before = event.data.before.data();
        const after  = event.data.after.data();

        // Solo actuar cuando el documento pasa a 'signed' por primera vez
        if (before.status === 'signed' || after.status !== 'signed') return;
        // Evitar recalcular si ya tiene hash (idempotencia)
        if (after.integridad && after.integridad.hash) {
            logger.info(`[IntegridadDoc] docId=${event.params.docId} ya tiene hash. Omitiendo.`);
            return;
        }

        const storagePath = after.signedStoragePath;
        if (!storagePath) {
            logger.error(`[IntegridadDoc] docId=${event.params.docId}: falta signedStoragePath. No se puede calcular hash.`);
            return;
        }

        try {
            logger.info(`[IntegridadDoc] Calculando SHA-256 para docId=${event.params.docId}, path=${storagePath}`);

            // Descargar el PDF firmado desde Firebase Storage usando el Admin SDK
            const [fileBuffer] = await admin.storage().bucket().file(storagePath).download();

            // Calcular SHA-256 (nunca MD5 ni SHA-1)
            const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

            // Generar un validationId único e impredecible (o usar el que viene del PDF)
            const sigIdFromClient = (after.metadata && after.metadata.sigId) ? after.metadata.sigId : null;
            const validationId = sigIdFromClient || ('ASP-' + crypto.randomBytes(10).toString('hex').toUpperCase());

            await event.data.after.ref.update({
                validationId,
                integridad: {
                    algoritmo: 'SHA-256',
                    hash,
                    hashGeneradoAt: admin.firestore.FieldValue.serverTimestamp(),
                    estado: 'VALIDO'
                }
            });

            logger.info(`[IntegridadDoc] Hash SHA-256 registrado para docId=${event.params.docId}. validationId=${validationId}`);
        } catch (err) {
            logger.error('[IntegridadDoc] Error calculando hash:', err);
        }
    }
);

/**
 * validateSignedDocument
 * Callable: accesible desde la página pública /validar/{validationId}.
 * Recibe: { validationId: string }
 * Acción: busca el documento, descarga el PDF actual desde Storage, recalcula
 * el SHA-256 y lo compara con el hash registrado. Determina si el doc está íntegro.
 * Nunca confía en información del cliente para determinar el resultado.
 */
exports.validateSignedDocument = onCall(
    { region: 'us-central1', allowInvalidAppCheckToken: true },
    async (request) => {
        const { validationId } = request.data || {};

        if (!validationId || typeof validationId !== 'string' || validationId.length < 5) {
            throw new HttpsError('invalid-argument', 'validationId inválido o faltante.');
        }

        // Buscar el documento por validationId (campo indexado)
        const snap = await admin.firestore()
            .collection('documents')
            .where('validationId', '==', validationId)
            .limit(1)
            .get();

        if (snap.empty) {
            throw new HttpsError('not-found', 'No se encontró ningún documento con ese ID de validación.');
        }

        const docSnap = snap.docs[0];
        const docData = docSnap.data();

        // Verificar que el documento tiene datos de integridad
        if (!docData.integridad || !docData.integridad.hash || !docData.signedStoragePath) {
            logger.warn(`[ValidateDoc] validationId=${validationId}: sin datos de integridad aún.`);
            return {
                valid: false,
                status: 'PENDING_INTEGRITY',
                validationId,
                message: 'El registro de integridad aún está siendo procesado. Intente nuevamente en unos segundos.'
            };
        }

        try {
            // Descargar el archivo ACTUAL desde Storage y recalcular hash
            const [fileBuffer] = await admin.storage().bucket().file(docData.signedStoragePath).download();
            const currentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
            const registeredHash = docData.integridad.hash;
            const valid = currentHash === registeredHash;

            logger.info(`[ValidateDoc] validationId=${validationId}: ${valid ? 'VÁLIDO' : 'ALTERADO'}`);

            // Auditoría de la validación (opcional, no bloquea la respuesta)
            try {
                await admin.firestore().collection('validacionesDocumentos').add({
                    validationId,
                    documentoId: docSnap.id,
                    resultado: valid ? 'VALIDO' : 'ALTERADO',
                    fecha: admin.firestore.FieldValue.serverTimestamp(),
                    userAgent: (request.rawRequest && request.rawRequest.headers
                        ? (request.rawRequest.headers['user-agent'] || 'unknown')
                        : 'unknown').substring(0, 200)
                });
            } catch (auditErr) {
                logger.warn('[ValidateDoc] Error registrando auditoría (no crítico):', auditErr);
            }

            // Enmascarar parcialmente el RUT para privacidad (mostrar solo últimos 4 chars)
            const rawRut = docData.metadata && docData.metadata.rut ? docData.metadata.rut : '';
            const maskedRut = rawRut.length > 4
                ? rawRut.slice(0, -4).replace(/\d/g, 'X') + rawRut.slice(-4)
                : rawRut;

            // Generar Signed URL de lectura si es válido (expira en 30 minutos)
            let downloadUrl = null;
            if (valid) {
                const [url] = await admin.storage().bucket().file(docData.signedStoragePath).getSignedUrl({
                    action: 'read',
                    expires: Date.now() + 30 * 60 * 1000 // 30 minutos
                });
                downloadUrl = url;
            }

            return {
                valid,
                status: valid ? 'VALID' : 'ALTERED',
                algorithm: 'SHA-256',
                validationId,
                documentTitle: docData.title || 'Documento',
                signerName:    (docData.metadata && docData.metadata.signerName) ? docData.metadata.signerName : '',
                signerRut:     maskedRut,
                signedAt:      docData.signedAt || '',
                integrityStatus: valid ? 'DOCUMENTO ÍNTEGRO' : 'POSIBLE ALTERACIÓN DETECTADA',
                ...(valid ? {} : { reason: 'HASH_MISMATCH' }),
                ...(downloadUrl ? { downloadUrl } : {})
            };
        } catch (err) {
            logger.error('[ValidateDoc] Error en validación:', err);
            throw new HttpsError('internal', 'Error al validar el documento.');
        }
    }
);
