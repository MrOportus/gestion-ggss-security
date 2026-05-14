const { onRequest } = require('firebase-functions/v2/https');
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
                        title: '¡Nuevo Turno Extra Disponible! 💰',
                        body: `Se ha publicado un turno en ${sucursalNombre} por $${monto}. Entra al Mercado de Turnos y tómalo rápido.`
                    },
                    data: {
                        type: 'market_turno',
                        docId: event.params.docId,
                        url: '/worker-attendance' // Opcional, para manejar la navegación en frontend si existe un handler
                    },
                    tokens: chunk,
                };

                const response = await admin.messaging().sendEachForMulticast(message);
                successCount += response.successCount;
                failureCount += response.failureCount;
            }

            console.log(`[FCM-TURNOS] Notificaciones de turno finalizadas: ${successCount} éxito, ${failureCount} errores.`);

        } catch (error) {
            console.error('Error en notificarNuevaOfertaTurno:', error);
        }
    }
);

