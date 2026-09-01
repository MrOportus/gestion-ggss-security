const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

exports.generateBunnyUploadUrl = onCall(
    { region: 'us-central1' },
    async (request) => {
        // 1. Validar autenticación
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Debe estar autenticado para subir archivos.');
        }

        // 2. Extraer metadatos
        const fileName = request.data.fileName || `foto_${crypto.randomUUID()}.jpg`;
        const folder = request.data.folder || 'rondas';
        const contentType = request.data.contentType || 'image/jpeg';
        
        const safeFileName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const objectKey = `${folder}/${safeFileName}`;

        // 3. Cargar variables de entorno
        const endpoint = process.env.BUNNY_STORAGE_ENDPOINT;
        const region = process.env.BUNNY_STORAGE_REGION || 'ny';
        const accessKey = process.env.BUNNY_ACCESS_KEY; // En Bunny, este es el nombre del Storage Zone (bucket)
        const secretKey = process.env.BUNNY_SECRET_KEY; // En Bunny, este es el Password / API Key
        const pullZoneUrl = process.env.BUNNY_PULL_ZONE_URL;

        if (!endpoint || !accessKey || !secretKey || !pullZoneUrl) {
            console.error("Faltan variables de entorno para Bunny.net", { endpoint: !!endpoint, accessKey: !!accessKey, secretKey: !!secretKey, pullZoneUrl: !!pullZoneUrl });
            throw new HttpsError('internal', 'Servicio de almacenamiento mal configurado.');
        }

        try {
            const endpointUrl = endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;

            const s3Client = new S3Client({
                region: region,
                endpoint: endpointUrl,
                credentials: {
                    accessKeyId: accessKey,
                    secretAccessKey: secretKey,
                },
                // Bunny.net requiere forcePathStyle para S3
                forcePathStyle: true
            });

            const command = new PutObjectCommand({
                Bucket: accessKey, // Bunny usa el nombre del Storage Zone como nombre de Bucket
                Key: objectKey,
                ContentType: contentType,
            });

            // Generar URL prefirmada (válida por 15 minutos)
            const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

            // Construir la URL final de la CDN
            const finalUrl = `${pullZoneUrl.replace(/\/$/, '')}/${objectKey}`;

            return {
                uploadUrl: signedUrl,
                finalUrl: finalUrl,
                objectKey: objectKey
            };

        } catch (error) {
            console.error("Error generando Bunny URL:", error);
            throw new HttpsError('internal', 'Error al generar enlace de subida seguro.');
        }
    }
);
