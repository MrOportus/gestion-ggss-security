const { onRequest } = require('firebase-functions/v2/https');
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
            sucursal_name, sucursal_address, empresa, horarioA, horarioB, sueldo
        } = req.body;

        if (!colaboradorId || !nombre || !rut) {
            res.status(400).json({ error: 'Faltan campos obligatorios.' });
            return;
        }

        const appsScriptUrl = 'https://script.google.com/macros/s/AKfycbxp8NI4Swow7fhAHaI5n0ymOrqFl3S4zKw6afKRY06WObJ89722gHIaS2uaOdHWOsSckQ/exec';

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
                    sucursal_name, sucursal_address, empresa, horarioA, horarioB, sueldo
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
