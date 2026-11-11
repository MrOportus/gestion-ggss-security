import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  BookOpen,
  Camera,
  Clock,
  DoorOpen,
  MapPin,
  Search,
  User,
  X,
} from 'lucide-react';
import ThumbnailImage from '../ThumbnailImage';
import PhotoGalleryModal from '../PhotoGalleryModal';
import type { NormalizedMandanteNovedad } from '../../lib/mandante/mandanteMetricsService';
import {
  PRIORITY_STYLE,
  formatExecutiveDateTime,
  getMandanteCategoriaMeta,
} from './mandanteUiConstants';

interface NovedadesResumenModalProps {
  isOpen: boolean;
  onClose: () => void;
  novedades: NormalizedMandanteNovedad[];
  siteLabel: string;
  periodLabel: string;
  onOpenFullBook?: () => void;
  highlightedId?: string | null;
  variant?: 'novedades' | 'accesos';
}

type ModalFilter = 'todas' | 'relevantes' | 'informativas' | 'acceso_personas' | 'acceso_vehiculos';

export const NovedadesResumenModal: React.FC<NovedadesResumenModalProps> = ({
  isOpen,
  onClose,
  novedades,
  siteLabel,
  periodLabel,
  onOpenFullBook,
  highlightedId = null,
  variant = 'novedades',
}) => {
  const [filter, setFilter] = useState<ModalFilter>('todas');
  const [searchText, setSearchText] = useState('');
  const [gallery, setGallery] = useState<{ photos: string[]; index: number; title: string } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setFilter('todas');
      setSearchText('');
      setGallery(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || gallery) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, gallery, onClose]);

  const counts = useMemo(() => {
    const relevantes = novedades.filter((n) => n.prioridad === 'critica' || n.prioridad === 'alta').length;
    const informativas = novedades.filter((n) => n.prioridad === 'informativa').length;
    const personas = novedades.filter((n) => n.categoria === 'acceso_personas').length;
    const vehiculos = novedades.filter((n) => n.categoria === 'acceso_vehiculos').length;
    return { todas: novedades.length, relevantes, informativas, personas, vehiculos };
  }, [novedades]);

  const filteredNovedades = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return novedades.filter((n) => {
      if (filter === 'relevantes' && n.prioridad !== 'critica' && n.prioridad !== 'alta') return false;
      if (filter === 'informativas' && n.prioridad !== 'informativa') return false;
      if (filter === 'acceso_personas' && n.categoria !== 'acceso_personas') return false;
      if (filter === 'acceso_vehiculos' && n.categoria !== 'acceso_vehiculos') return false;
      if (!q) return true;
      const cat = getMandanteCategoriaMeta(n.categoria);
      return [
        n.descripcion,
        n.guardName,
        n.siteName,
        n.ubicacionInstalacion,
        cat.label,
        n.prioridad,
      ].some((v) => v && v.toLowerCase().includes(q));
    });
  }, [novedades, filter, searchText]);

  if (!isOpen) return null;

  const isAccesosVariant = variant === 'accesos';
  const tabs: { id: ModalFilter; label: string }[] = isAccesosVariant
    ? [
        { id: 'todas', label: `Todos (${counts.todas})` },
        { id: 'acceso_personas', label: `Personas (${counts.personas})` },
        { id: 'acceso_vehiculos', label: `Vehículos (${counts.vehiculos})` },
      ]
    : [
        { id: 'todas', label: `Todas (${counts.todas})` },
        { id: 'relevantes', label: `Críticas / Altas (${counts.relevantes})` },
        { id: 'informativas', label: `Informativas (${counts.informativas})` },
      ];

  const content = (
    <div
      className="fixed inset-0 z-[220] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mandante-novedades-modal-title"
    >
      <div
        className="bg-white w-full max-w-3xl max-h-[88vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header formal */}
        <div className="px-5 py-4 sm:px-6 bg-slate-900 text-white flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${
                isAccesosVariant
                  ? 'bg-blue-500/20 border-blue-400/30 text-blue-300'
                  : 'bg-rose-500/20 border-rose-400/30 text-rose-300'
              }`}
            >
              {isAccesosVariant ? <DoorOpen size={20} /> : <AlertTriangle size={20} />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 id="mandante-novedades-modal-title" className="text-base sm:text-lg font-bold tracking-tight">
                  {isAccesosVariant ? 'Registros de Acceso' : 'Detalle de Novedades'} ({novedades.length})
                </h3>
                <span className="text-[11px] font-semibold bg-white/10 text-slate-200 px-2.5 py-0.5 rounded-full">
                  {periodLabel}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5 truncate">{siteLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            aria-label="Cerrar detalle"
          >
            <X size={20} />
          </button>
        </div>

        {/* Barra de filtros y búsqueda */}
        <div className="px-5 py-3.5 sm:px-6 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  filter === tab.id
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative sm:w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Buscar detalle..."
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>

        {/* Listado scrolleable */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 bg-slate-50/40">
          {filteredNovedades.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-10 text-center">
              <AlertTriangle size={32} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-600">
                No se registran novedades bajo el filtro seleccionado
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Pruebe cambiando el filtro o limpiando la búsqueda.
              </p>
            </div>
          ) : (
            filteredNovedades.map((n) => {
              const prio = PRIORITY_STYLE[n.prioridad];
              const cat = getMandanteCategoriaMeta(n.categoria);
              const isHighlighted = highlightedId && n.id === highlightedId;

              return (
                <article
                  key={n.id}
                  className={`bg-white rounded-xl border p-4 shadow-sm transition-all ${
                    isHighlighted
                      ? 'border-blue-400 ring-2 ring-blue-100'
                      : 'border-slate-200/80 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${prio.pillClass}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${prio.dotClass}`} />
                        {prio.label}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${cat.badgeClass}`}
                      >
                        <span>{cat.icon}</span>
                        <span>{cat.label}</span>
                      </span>
                    </div>
                  </div>

                  <p className="text-sm text-slate-800 font-medium leading-relaxed mt-2.5 whitespace-pre-line">
                    {n.descripcion}
                  </p>

                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                        <MapPin size={12} className="text-slate-400" />
                        {n.siteName}
                        {n.ubicacionInstalacion ? ` · ${n.ubicacionInstalacion}` : ''}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <User size={12} className="text-slate-400" />
                        {n.guardName}
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 font-medium text-slate-500">
                      <Clock size={12} className="text-slate-400" />
                      {formatExecutiveDateTime(n.timestamp)}
                    </span>
                  </div>

                  {n.evidencias.length > 0 && (
                    <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
                      {n.evidencias.map((url, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() =>
                            setGallery({
                              photos: n.evidencias,
                              index: idx,
                              title: `${cat.label} · ${n.siteName}`,
                            })
                          }
                          className="relative group shrink-0 w-16 h-16 rounded-lg border border-slate-200 overflow-hidden hover:border-blue-400 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
                          title="Ampliar fotografía"
                        >
                          <ThumbnailImage
                            photoUrl={url}
                            alt={`Evidencia ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <span className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/20 flex items-center justify-center transition-colors">
                            <Camera size={14} className="text-white opacity-0 group-hover:opacity-100" />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 sm:px-6 bg-white border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <span className="text-xs text-slate-500">
            Mostrando <strong className="text-slate-700">{filteredNovedades.length}</strong> de{' '}
            <strong className="text-slate-700">{novedades.length}</strong> registro{novedades.length !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            {onOpenFullBook && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenFullBook();
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors"
              >
                <BookOpen size={14} />
                Ver Libro de Novedades
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>

      {gallery && (
        <PhotoGalleryModal
          photos={gallery.photos}
          initialIndex={gallery.index}
          title={gallery.title}
          onClose={() => setGallery(null)}
        />
      )}
    </div>
  );

  return createPortal(content, document.body);
};

export default NovedadesResumenModal;

