import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Camera } from 'lucide-react';
import ThumbnailImage from './ThumbnailImage';

export interface PhotoGalleryModalProps {
  photos: string[];
  initialIndex?: number;
  onClose: () => void;
  title?: string;
}

export const PhotoGalleryModal: React.FC<PhotoGalleryModalProps> = ({
  photos,
  initialIndex = 0,
  onClose,
  title,
}) => {
  const [currentIndex, setCurrentIndex] = useState(
    Math.max(0, Math.min(initialIndex, photos.length - 1))
  );

  useEffect(() => {
    setCurrentIndex(Math.max(0, Math.min(initialIndex, photos.length - 1)));
  }, [initialIndex, photos]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        setCurrentIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1));
      } else if (e.key === 'ArrowRight') {
        setCurrentIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [photos.length, onClose]);

  if (!photos || photos.length === 0) return null;

  const currentPhoto = photos[currentIndex];

  const content = (
    <div
      className="fixed inset-0 z-[300] bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-between p-3 sm:p-6 animate-in fade-in duration-150 select-none"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Barra Superior */}
      <div
        className="w-full max-w-5xl flex items-center justify-between text-white pb-2 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Camera className="w-5 h-5 text-amber-400 shrink-0" />
          <span className="text-sm font-bold truncate">
            {title || 'Galería de Fotografías de la Novedad'}
          </span>
          <span className="text-xs font-black bg-white/20 px-2.5 py-0.5 rounded-full shrink-0">
            {currentIndex + 1} de {photos.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
          title="Cerrar visor (Esc)"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Imagen Principal */}
      <div
        className="relative flex-1 w-full max-w-5xl flex items-center justify-center min-h-0 py-2"
        onClick={(e) => e.stopPropagation()}
      >
        {photos.length > 1 && (
          <button
            type="button"
            onClick={() =>
              setCurrentIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1))
            }
            className="absolute left-1 sm:left-3 z-10 w-11 h-11 sm:w-13 sm:h-13 rounded-full bg-slate-900/80 hover:bg-slate-900 text-white flex items-center justify-center backdrop-blur-sm border border-white/20 shadow-xl transition-all hover:scale-105 cursor-pointer"
            title="Fotografía anterior (Flecha izquierda)"
          >
            <ChevronLeft className="w-7 h-7" />
          </button>
        )}

        <div className="max-w-full max-h-full flex items-center justify-center p-1">
          <ThumbnailImage
            photoUrl={currentPhoto}
            alt={`Fotografía ${currentIndex + 1} de ${photos.length}`}
            className="max-w-full max-h-[76vh] object-contain rounded-2xl shadow-2xl border border-white/10"
          />
        </div>

        {photos.length > 1 && (
          <button
            type="button"
            onClick={() =>
              setCurrentIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0))
            }
            className="absolute right-1 sm:right-3 z-10 w-11 h-11 sm:w-13 sm:h-13 rounded-full bg-slate-900/80 hover:bg-slate-900 text-white flex items-center justify-center backdrop-blur-sm border border-white/20 shadow-xl transition-all hover:scale-105 cursor-pointer"
            title="Fotografía siguiente (Flecha derecha)"
          >
            <ChevronRight className="w-7 h-7" />
          </button>
        )}
      </div>

      {/* Tira inferior de miniaturas */}
      {photos.length > 1 && (
        <div
          className="w-full max-w-3xl flex items-center justify-center gap-2 overflow-x-auto py-2 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {photos.map((url, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentIndex(idx)}
              className={`w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden border-2 transition-all shrink-0 cursor-pointer ${
                idx === currentIndex
                  ? 'border-amber-400 scale-105 ring-2 ring-amber-400/50'
                  : 'border-white/30 opacity-60 hover:opacity-100 hover:border-white/70'
              }`}
            >
              <ThumbnailImage
                photoUrl={url}
                alt={`Miniatura ${idx + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : null;
};

export default PhotoGalleryModal;

