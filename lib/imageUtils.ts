/**
 * Compresses an image file using Canvas and optionally adds a watermark.
 * 
 * Barrera de compresión:
 * - Decodificación mediante ObjectURL (evita cargar el original completo como Base64 en RAM).
 * - Resolución máxima limitada a maxWidth (default 1024px) para evitar fotos 4K innecesarias.
 * - Exportación en formato JPEG (calidad 0.6-0.7) para máxima compatibilidad y menor huella local.
 */

import { Capacitor } from '@capacitor/core';
import { Camera as CapacitorCamera, CameraResultType, CameraSource } from '@capacitor/camera';

const OUTPUT_FORMAT = 'image/jpeg';

export interface ImageWatermarkData {
    time: string;
    date: string;
    day: string;
    location: string;
    coords: string;
    verifyCode: string;
}

export const blobToDataUrl = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error || new Error('Failed to read blob as DataURL'));
        reader.readAsDataURL(blob);
    });
};

export const dataUrlToBlob = (dataUrl: string): Blob => {
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) {
        throw new Error('DataURL inválido');
    }
    const header = dataUrl.slice(0, commaIdx);
    const mimeMatch = header.match(/data:([^;]+)/i);
    const mimeType = mimeMatch ? mimeMatch[1] : OUTPUT_FORMAT;
    const base64 = dataUrl.slice(commaIdx + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
};

export const isCameraCancelError = (err: unknown): boolean => {
    const msg = String((err as any)?.message || err || '').toLowerCase();
    return (
        msg.includes('cancel') ||
        msg.includes('no image picked') ||
        msg.includes('did not return')
    );
};

export const compressImage = (
    file: File | Blob, 
    quality = 0.6, 
    maxWidth = 1024, 
    watermarkData?: ImageWatermarkData
): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        if (!file || file.size === 0) {
            return reject(new Error('Archivo de imagen vacío o inválido'));
        }

        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        const cleanup = () => {
            try {
                URL.revokeObjectURL(objectUrl);
            } catch {
                // ignore revoke errors
            }
        };

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                let width = img.naturalWidth || img.width;
                let height = img.naturalHeight || img.height;

                if (width <= 0 || height <= 0) {
                    cleanup();
                    return reject(new Error('Dimensiones de imagen inválidas'));
                }

                if (width > maxWidth) {
                    height = (maxWidth / width) * height;
                    width = maxWidth;
                }

                canvas.width = Math.max(1, Math.round(width));
                canvas.height = Math.max(1, Math.round(height));

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    cleanup();
                    return reject(new Error('Failed to get context'));
                }

                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                if (watermarkData) {
                    // --- WATERMARK LOGIC ---
                    const w = canvas.width;
                    const h = canvas.height;
                    const padding = w * 0.05;
                    const bottomY = h - padding;
                    
                    // Shadow for text readability
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
                    ctx.shadowBlur = 4;
                    ctx.shadowOffsetX = 1;
                    ctx.shadowOffsetY = 1;
                    
                    // 1. Time (Main)
                    const timeFontSize = Math.floor(w * 0.065);
                    ctx.font = `bold ${timeFontSize}px Inter, Roboto, Arial`;
                    ctx.fillStyle = 'white';
                    ctx.textAlign = 'left';
                    const timeWidth = ctx.measureText(watermarkData.time).width;
                    const mainRowY = bottomY - (w * 0.11);
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
                    const secondaryFontSize = Math.floor(w * 0.03);
                    ctx.font = `bold ${secondaryFontSize}px Inter, Roboto, Arial`;
                    ctx.fillText(watermarkData.date, lineX + 10, lineY1 + (secondaryFontSize * 0.9));
                    ctx.font = `normal ${secondaryFontSize}px Inter, Roboto, Arial`;
                    ctx.fillText(watermarkData.day, lineX + 10, lineY2);

                    // 4. Address and Coords (Below time row)
                    const infoFontSize = Math.floor(w * 0.028);
                    ctx.font = `bold ${infoFontSize}px Inter, Roboto, Arial`;
                    ctx.fillText(watermarkData.location, padding, mainRowY + (w * 0.045));
                    ctx.font = `normal ${infoFontSize}px Inter, Roboto, Arial`;
                    ctx.fillText(watermarkData.coords, padding, mainRowY + (w * 0.075));

                    // 5. Verification Code (Bottom)
                    const verifyFontSize = Math.floor(w * 0.024);
                    ctx.font = `bold ${verifyFontSize}px Inter, Roboto, Arial`;
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                    ctx.fillText(`🛡️ Código de Foto: ${watermarkData.verifyCode}`, padding, mainRowY + (w * 0.105));
                }

                // --- Exportación JPEG ---
                canvas.toBlob(
                    (jpegBlob) => {
                        cleanup();
                        if (jpegBlob && jpegBlob.size > 0) {
                            console.log(`[compressImage] JPEG: ${(jpegBlob.size / 1024).toFixed(1)} KB`);
                            resolve(jpegBlob);
                        } else {
                            reject(new Error('Canvas toBlob failed (JPEG)'));
                        }
                    },
                    OUTPUT_FORMAT,
                    quality
                );
            } catch (err) {
                cleanup();
                reject(err);
            }
        };

        img.onerror = () => {
            cleanup();
            reject(new Error('No se pudo decodificar la imagen seleccionada'));
        };

        img.src = objectUrl;
    });
};

function selectFilesFromInput(opts: { camera: boolean; multiple?: boolean }): Promise<File[]> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        if (opts.camera) input.capture = 'environment';
        if (opts.multiple) input.multiple = true;
        let settled = false;
        const finish = (files: File[]) => {
            if (settled) return;
            settled = true;
            resolve(files);
        };
        input.onchange = () => finish(Array.from(input.files ?? []));
        input.addEventListener('cancel', () => finish([]));
        input.click();
    });
}

/**
 * Captura o selecciona fotografías usando @capacitor/camera en Android nativo.
 *
 * Usar resultType: CameraResultType.DataUrl + saveToGallery: false hace que
 * LegacyCameraFlow elimine el archivo temporal en /Android/data/.../files/Pictures/
 * inmediatamente después de devolver la imagen redimensionada (evita fuga nativa).
 * Siempre comprime antes de retornar; nunca hace fallback a imagen original sin comprimir.
 */
export async function captureAndCompressPhotos(options: {
    source: 'camera' | 'gallery';
    quality?: number;
    maxWidth?: number;
    multiple?: boolean;
    getWatermarkData?: () => ImageWatermarkData;
}): Promise<Blob[]> {
    const quality = options.quality ?? 0.7;
    const maxWidth = options.maxWidth ?? 1024;

    if (Capacitor.isNativePlatform() && (options.source === 'camera' || !options.multiple)) {
        try {
            const photo = await CapacitorCamera.getPhoto({
                quality: Math.min(95, Math.max(40, Math.round(quality * 100))),
                allowEditing: false,
                resultType: CameraResultType.DataUrl,
                source: options.source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
                width: maxWidth,
                height: maxWidth,
                correctOrientation: true,
                saveToGallery: false,
            });

            if (!photo.dataUrl) {
                throw new Error('La cámara no devolvió imagen');
            }

            const rawBlob = dataUrlToBlob(photo.dataUrl);
            const watermarkData = options.getWatermarkData ? options.getWatermarkData() : undefined;
            const compressed = await compressImage(rawBlob, quality, maxWidth, watermarkData);
            return [compressed];
        } catch (err: any) {
            if (isCameraCancelError(err)) {
                return [];
            }
            const msg = String(err?.message || err || '').toLowerCase();
            if (msg.includes('permission') || msg.includes('denied')) {
                throw err;
            }
            console.warn('[captureAndCompressPhotos] Fallback a input Web tras error nativo:', err);
        }
    }

    const files = await selectFilesFromInput({
        camera: options.source === 'camera',
        multiple: options.source === 'gallery' && !!options.multiple,
    });
    if (files.length === 0) return [];

    const results: Blob[] = [];
    for (const file of files) {
        const watermarkData = options.getWatermarkData ? options.getWatermarkData() : undefined;
        const compressed = await compressImage(file, quality, maxWidth, watermarkData);
        results.push(compressed);
    }
    return results;
}

export async function captureAndCompressPhoto(options: {
    source: 'camera' | 'gallery';
    quality?: number;
    maxWidth?: number;
    getWatermarkData?: () => ImageWatermarkData;
}): Promise<Blob | null> {
    const blobs = await captureAndCompressPhotos({ ...options, multiple: false });
    return blobs[0] ?? null;
}

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
 * Extrae el path de Firebase Storage desde una URL de descarga y construye
 * el path del thumbnail generado por la extensión "Resize Images".
 * 
 * Las URLs de Firebase Storage tienen el formato:
 *   https://firebasestorage.googleapis.com/v0/b/BUCKET/o/PATH_ENCODED?alt=media&token=TOKEN
 * 
 * El PATH_ENCODED usa %2F en lugar de /. Esta función:
 * 1. Extrae el path encoded (entre /o/ y ?)
 * 2. Lo decodifica (ej: evidencias%2Fuser%2Ffoto.jpg -> evidencias/user/foto.jpg)
 * 3. Reemplaza la extensión por _200x200.webp
 * 
 * Retorna null si la URL no se puede parsear o es un blob URL.
 */
export const getThumbnailStoragePath = (originalUrl: string): string | null => {
    if (!originalUrl || originalUrl.startsWith('blob:')) return null;

    try {
        // Extraer el path encoded de la URL de Firebase Storage
        // Formato: .../o/PATH_ENCODED?alt=media&token=...
        const oIndex = originalUrl.indexOf('/o/');
        if (oIndex === -1) return null;

        const afterO = originalUrl.substring(oIndex + 3); // después de /o/
        const queryIndex = afterO.indexOf('?');
        const encodedPath = queryIndex !== -1 ? afterO.substring(0, queryIndex) : afterO;

        // Decodificar el path (ej: evidencias%2Fuser%2Ffoto.jpg -> evidencias/user/foto.jpg)
        const decodedPath = decodeURIComponent(encodedPath);

        // Reemplazar la extensión por _200x200.webp
        const extensionRegex = /\.(webp|jpg|jpeg|png)$/i;
        const match = decodedPath.match(extensionRegex);
        if (!match) return null;

        const beforeExt = decodedPath.substring(0, decodedPath.length - match[0].length);
        return `${beforeExt}_200x200.webp`;
    } catch {
        return null;
    }
};

