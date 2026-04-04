const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const axios = require('axios');

admin.initializeApp();

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
            // POST a Google Apps Script
            // followAllRedirects + maxRedirects para manejar el 302 de Apps Script
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
                // Apps Script devuelve: pdfUrl, pdfId, downloadUrl
                const pdfUrl = result.pdfUrl || result.url || '';
                const downloadUrl = result.downloadUrl || '';

                // Registrar en Firestore
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

                // Devolver la URL de visualización al frontend
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
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response data:', JSON.stringify(error.response.data));
            }
            res.status(500).json({ error: 'Error al procesar: ' + error.message });
        }
    }
);

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
            // 1. Obtener tokens FCM del trabajador desde la colección Colaboradores
            const workerSnapshot = await admin.firestore().collection('Colaboradores').doc(workerId).get();
            if (!workerSnapshot.exists) {
                console.log(`Trabajador ${workerId} no encontrado.`);
                return;
            }

            const workerData = workerSnapshot.data();
            const tokens = workerData.fcmTokens || [];

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
                    docId: event.params.docId,
                    click_action: 'FLUTTER_NOTIFICATION_CLICK' // Opcional según plataforma
                },
                tokens: tokens,
            };

            // 3. Enviar notificaciones
            const response = await admin.messaging().sendEachForMulticast(message);
            console.log(`Notificaciones enviadas (${response.successCount} éxito, ${response.failureCount} error) para doc: ${docTitle}`);

            // Limpieza opcional de tokens fallidos si es necesario
            if (response.failureCount > 0) {
                const failedTokens = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        failedTokens.push(tokens[idx]);
                    }
                });
                console.log('Tokens fallidos:', failedTokens);
            }

        } catch (error) {
            console.error('Error en notificarNuevoDocumento:', error);
        }
    }
);
