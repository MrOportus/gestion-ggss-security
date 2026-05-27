/**
 * Compresses an image file using Canvas and optionally adds a watermark.
 * 
 * Barrera de compresión:
 * - Resolución máxima limitada a maxWidth (default 1024px) para evitar fotos 4K innecesarias.
 * - Exportación en formato WebP (calidad 0.6) para reducir peso drásticamente (~50-80KB).
 * - Fallback automático a JPEG si el navegador no soporta WebP.
 */

const PREFERRED_FORMAT = 'image/webp';
const FALLBACK_FORMAT = 'image/jpeg';

export const compressImage = (
    file: File, 
    quality = 0.6, 
    maxWidth = 1024, 
    watermarkData?: { 
        time: string; 
        date: string; 
        day: string; 
        location: string; 
        coords: string; 
        verifyCode: string; 
    }
): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = (maxWidth / width) * height;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error('Failed to get context'));

                ctx.drawImage(img, 0, 0, width, height);

                if (watermarkData) {
                    // --- WATERMARK LOGIC ---
                    const padding = width * 0.05;
                    const bottomY = height - padding;
                    
                    // Shadow for text readability
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
                    ctx.shadowBlur = 4;
                    ctx.shadowOffsetX = 1;
                    ctx.shadowOffsetY = 1;
                    
                    // 1. Time (Main) - Adjusted to be smaller (approx 0.06 of width)
                    const timeFontSize = Math.floor(width * 0.065);
                    ctx.font = `bold ${timeFontSize}px Inter, Roboto, Arial`;
                    ctx.fillStyle = 'white';
                    ctx.textAlign = 'left';
                    const timeWidth = ctx.measureText(watermarkData.time).width;
                    const mainRowY = bottomY - (width * 0.11); // Elevated to leave space for location/verify
                    ctx.fillText(watermarkData.time, padding, mainRowY);

                    // 2. Vertical Line
                    const lineX = padding + timeWidth + 10;
                    const lineY1 = mainRowY - (timeFontSize * 0.85);
                    const lineY2 = mainRowY + 2;
                    ctx.strokeStyle = '#facc15'; // Yellow-400
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(lineX, lineY1);
                    ctx.lineTo(lineX, lineY2);
                    ctx.stroke();

                    // 3. Date and Day (Stacked next to time)
                    const secondaryFontSize = Math.floor(width * 0.03);
                    ctx.font = `bold ${secondaryFontSize}px Inter, Roboto, Arial`;
                    ctx.fillText(watermarkData.date, lineX + 10, lineY1 + (secondaryFontSize * 0.9));
                    ctx.font = `normal ${secondaryFontSize}px Inter, Roboto, Arial`;
                    ctx.fillText(watermarkData.day, lineX + 10, lineY2);

                    // 4. Address and Coords (Below time row)
                    const infoFontSize = Math.floor(width * 0.028);
                    ctx.font = `bold ${infoFontSize}px Inter, Roboto, Arial`;
                    ctx.fillText(watermarkData.location, padding, mainRowY + (width * 0.045));
                    ctx.font = `normal ${infoFontSize}px Inter, Roboto, Arial`;
                    ctx.fillText(watermarkData.coords, padding, mainRowY + (width * 0.075));

                    // 5. Verification Code (Bottom)
                    const verifyFontSize = Math.floor(width * 0.024);
                    ctx.font = `bold ${verifyFontSize}px Inter, Roboto, Arial`;
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                    ctx.fillText(`🛡️ Código de Foto: ${watermarkData.verifyCode}`, padding, mainRowY + (width * 0.105));
                }

                // --- BARRERA 2: Exportación WebP con fallback a JPEG ---
                // Intentar WebP primero (compresión ~40% superior a JPEG a calidad visual similar)
                canvas.toBlob(
                    (webpBlob) => {
                        // Si el navegador soporta WebP y generó un blob válido, usarlo
                        if (webpBlob && webpBlob.size > 0 && webpBlob.type === PREFERRED_FORMAT) {
                            console.log(`[compressImage] WebP OK: ${(webpBlob.size / 1024).toFixed(1)} KB`);
                            resolve(webpBlob);
                        } else {
                            // Fallback a JPEG si WebP no es soportado
                            console.warn('[compressImage] WebP no soportado, fallback a JPEG');
                            canvas.toBlob(
                                (jpegBlob) => {
                                    if (jpegBlob) {
                                        console.log(`[compressImage] JPEG fallback: ${(jpegBlob.size / 1024).toFixed(1)} KB`);
                                        resolve(jpegBlob);
                                    } else {
                                        reject(new Error('Canvas toBlob failed (JPEG fallback)'));
                                    }
                                },
                                FALLBACK_FORMAT,
                                quality
                            );
                        }
                    },
                    PREFERRED_FORMAT,
                    quality
                );
            };
        };
        reader.onerror = (error) => reject(error);
    });
};

/**
 * Metadatos estándar de caché para Firebase Storage.
 * Todas las subidas de imágenes deben usar estos metadatos para:
 * - Forzar caché en CDN Edge de Google (1 año, inmutable)
 * - Eliminar tráfico Egress de visitas repetidas
 */
export const STORAGE_CACHE_METADATA = {
    cacheControl: 'public, max-age=31536000, immutable',
};

/**
 * Transforma una URL de Firebase Storage original en la URL de su miniatura
 * generada por la extensión "Resize Images" de Firebase.
 * 
 * La extensión genera copias con sufijo _200x200 en la misma ruta.
 * Ejemplo:
 *   Original:  .../foto_123.webp?token=...
 *   Thumbnail: .../foto_123_200x200.webp?token=...
 * 
 * Compatible con URLs que tienen query params (token de Firebase) y
 * con nombres de archivo codificados en URL (%2F).
 * 
 * Si la URL es una blob URL local (offline), se retorna sin modificar.
 */
export const getThumbnailUrl = (originalUrl: string): string => {
    if (!originalUrl || originalUrl.startsWith('blob:')) return originalUrl;

    try {
        // Las URLs de Firebase Storage tienen el path codificado antes de ?alt=media&token=...
        // Formato: https://firebasestorage.googleapis.com/v0/b/BUCKET/o/PATH?alt=media&token=TOKEN
        // El PATH está URL-encoded (/ -> %2F)
        
        // Buscar la última extensión de imagen en el path (antes de query params)
        // Soporta: .webp, .jpg, .jpeg, .png
        const extensionRegex = /(\.(webp|jpg|jpeg|png))/i;
        
        // Separar path de query string
        const queryIndex = originalUrl.indexOf('?');
        const basePart = queryIndex !== -1 ? originalUrl.substring(0, queryIndex) : originalUrl;
        const queryPart = queryIndex !== -1 ? originalUrl.substring(queryIndex) : '';

        // Insertar _200x200 antes de la extensión
        const match = basePart.match(extensionRegex);
        if (match && match.index !== undefined) {
            const beforeExt = basePart.substring(0, match.index);
            const ext = match[1];
            return `${beforeExt}_200x200${ext}${queryPart}`;
        }

        // Si no se puede parsear, retornar original
        return originalUrl;
    } catch {
        return originalUrl;
    }
};
