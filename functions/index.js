const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const axios = require('axios');

admin.initializeApp();

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
