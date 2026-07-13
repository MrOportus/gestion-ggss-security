import React, { useState, useEffect } from 'react';
import { ref, getDownloadURL } from 'firebase/storage';
import { storage } from '../lib/firebase';
import { getThumbnailStoragePath } from '../lib/imageUtils';

/**
 * Cache global en memoria para URLs de thumbnails ya resueltas.
 * Evita llamadas repetidas a getDownloadURL() para la misma imagen.
 * Key: photoUrl original, Value: URL del thumbnail con token válido.
 */
const thumbnailCache = new Map<string, string>();

/**
 * Cache de paths que ya sabemos que NO tienen thumbnail.
 * Evita intentar resolver thumbnails inexistentes repetidamente.
 */
const failedPaths = new Set<string>();

interface ThumbnailImageProps {
    photoUrl: string;
    alt?: string;
    className?: string;
    onClick?: () => void;
    width?: number;
    height?: number;
}

/**
 * Componente que carga la miniatura _200x200.webp de una imagen de Firebase Storage
 * resolviendo la URL con el token de descarga correcto via getDownloadURL().
 * 
 * - Usa un cache en memoria para no repetir resoluciones.
 * - Si el thumbnail no existe en Storage, cae al original.
 * - Muestra un placeholder de carga mientras resuelve la URL.
 */
const ThumbnailImage: React.FC<ThumbnailImageProps> = ({
    photoUrl,
    alt = 'Evidencia',
    className = 'w-full h-full object-cover',
    onClick,
    width,
    height,
}) => {
    const [src, setSrc] = useState<string | null>(null);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
        if (!photoUrl) return;

        // Si es blob URL (offline), usar directamente
        if (photoUrl.startsWith('blob:')) {
            setSrc(photoUrl);
            return;
        }

        // Si ya tenemos en cache, usar inmediatamente
        if (thumbnailCache.has(photoUrl)) {
            setSrc(thumbnailCache.get(photoUrl)!);
            return;
        }

        // Si ya sabemos que este thumbnail no existe, usar original
        if (failedPaths.has(photoUrl)) {
            setSrc(photoUrl);
            return;
        }

        let cancelled = false;

        const resolveThumbnail = async () => {
            const thumbnailPath = getThumbnailStoragePath(photoUrl);
            
            if (!thumbnailPath) {
                // No se pudo parsear la URL, usar original
                if (!cancelled) setSrc(photoUrl);
                return;
            }

            try {
                const storageRef = ref(storage, thumbnailPath);
                const thumbnailUrl = await getDownloadURL(storageRef);
                
                if (!cancelled) {
                    thumbnailCache.set(photoUrl, thumbnailUrl);
                    setSrc(thumbnailUrl);
                }
            } catch {
                // Thumbnail no existe en Storage, usar original
                if (!cancelled) {
                    failedPaths.add(photoUrl);
                    setSrc(photoUrl);
                }
            }
        };

        resolveThumbnail();

        return () => { cancelled = true; };
    }, [photoUrl]);

    // Si hubo error al cargar incluso el fallback, mostrar placeholder
    if (hasError) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-slate-50">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-slate-200">
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                    <circle cx="9" cy="9" r="2"/>
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                </svg>
            </div>
        );
    }

    // Mientras se resuelve la URL, mostrar placeholder animado
    if (!src) {
        return (
            <div className="w-full h-full bg-slate-100 animate-pulse rounded" />
        );
    }

    return (
        <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            className={className}
            width={width}
            height={height}
            onClick={onClick}
            onError={() => {
                // Si la URL resuelta falla (ej: token expirado), intentar con original
                if (src !== photoUrl) {
                    failedPaths.add(photoUrl);
                    thumbnailCache.delete(photoUrl);
                    setSrc(photoUrl);
                } else {
                    setHasError(true);
                }
            }}
        />
    );
};

export default ThumbnailImage;
