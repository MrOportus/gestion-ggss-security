import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Building2,
  Calendar,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  DoorOpen,
  Download,
  ExternalLink,
  FileText,
  Info,
  LayoutDashboard,
  Loader2,
  LogOut,
  MapPin,
  Navigation,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import {
  buildAccessControlRecords,
  calculateAverageRoundDuration,
  computeActiveGuards,
  computeDailyRoundSeries,
  computeGuardRoundStats,
  computeNovedadesBreakdown,
  computeServiceCoverage,
  filterAccesoNovedades,
  getPeriodDateRange,
  getRoundDurationMin,
  normalizeMandanteNovedad,
  resolveIsRondasViewActive,
  toLocalDateStr,
  type MandantePeriod,
  type NormalizedMandanteNovedad,
} from '../lib/mandante/mandanteMetricsService';
import {
  DEFAULT_SITE_HORARIO,
  type AttendanceLog,
  type Employee,
  type GuardRound,
  type MandanteViewMode,
  type Site,
} from '../types';
import ThumbnailImage from '../components/ThumbnailImage';
import RouteMapModal from '../components/RouteMapModal';
import PhotoGalleryModal from '../components/PhotoGalleryModal';
import NovedadesResumenModal from '../components/mandante/NovedadesResumenModal';
import RendimientoRondasCard from '../components/mandante/RendimientoRondasCard';
import MandanteReportes, { generateMandantePDF } from '../components/mandante/MandanteReportes';
import {
  PRIORITY_STYLE,
  formatExecutiveDateTime,
  getMandanteCategoriaMeta,
} from '../components/mandante/mandanteUiConstants';

// ─── Types ────────────────────────────────────────────────────────────────────
type MandanteSection = 'estado' | 'rondas' | 'novedades' | 'reportes';

const PERIOD_LABELS: Record<MandantePeriod, string> = {
  hoy: 'Hoy',
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
};

const fmtTime = (iso: string) =>
  iso ? new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

// ─── Badges compartidos ───────────────────────────────────────────────────────
const ResultBadge: React.FC<{ result?: string }> = ({ result }) => {
  if (!result) return null;
  const cfg: Record<
    string,
    { bg: string; text: string; ring: string; icon: React.ReactNode; label: string }
  > = {
    SIN_NOVEDAD: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      ring: 'ring-emerald-600/20',
      icon: <ShieldCheck size={11} />,
      label: 'Sin Novedad',
    },
    CON_NOVEDAD: {
      bg: 'bg-rose-50',
      text: 'text-rose-700',
      ring: 'ring-rose-600/20',
      icon: <ShieldAlert size={11} />,
      label: 'Con Novedad',
    },
    SOSPECHA: {
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      ring: 'ring-amber-600/20',
      icon: <AlertCircle size={11} />,
      label: 'Sospecha',
    },
  };
  const c = cfg[result] || {
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    ring: 'ring-slate-200',
    icon: null,
    label: result.replace(/_/g, ' '),
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ring-1 ring-inset ${c.bg} ${c.text} ${c.ring}`}
    >
      {c.icon}
      {c.label}
    </span>
  );
};

// ─── Libro de Novedades completo ──────────────────────────────────────────────
const LibroNovedades: React.FC<{
  allowedSites: Site[];
  guardRounds: GuardRound[];
  novedades: any[];
  isRondasActive: boolean;
  initialPeriod: MandantePeriod;
  initialSiteId: string;
  initialCategoryFilter?: 'all' | 'solo_accesos' | 'acceso_personas' | 'acceso_vehiculos';
}> = ({
  allowedSites,
  guardRounds,
  novedades,
  isRondasActive,
  initialPeriod,
  initialSiteId,
  initialCategoryFilter = 'all',
}) => {
  const defaultRange = useMemo(() => getPeriodDateRange(initialPeriod), [initialPeriod]);
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [tipoFilter, setTipoFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState<string>(initialCategoryFilter);
  const [siteFilter, setSiteFilter] = useState(initialSiteId);
  const [prioridadFilter, setPrioridadFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [gallery, setGallery] = useState<{ photos: string[]; index: number; title: string } | null>(null);
  const [page, setPage] = useState(1);
  const itemsPerPage = 20;

  useEffect(() => {
    setCategoryFilter(initialCategoryFilter);
  }, [initialCategoryFilter]);

  useEffect(() => {
    setPage(1);
  }, [startDate, endDate, tipoFilter, categoryFilter, siteFilter, prioridadFilter, searchText]);

  const timelineItems = useMemo(() => {
    const roundItems = isRondasActive
      ? guardRounds
          .filter((r) => allowedSites.some((s) => String(s.id) === String(r.siteId)))
          .map((r) => ({
            id: `ronda_${r.id}`,
            kind: 'ronda' as const,
            siteId: String(r.siteId),
            sucursalName: r.siteName || 'Instalación',
            tipo: 'ronda',
            categoria: '',
            descripcion: r.notes || 'Ronda completada sin observaciones.',
            guardName: r.workerName || 'Guardia',
            timestamp: r.startTime,
            localDate: toLocalDateStr(r.startTime),
            resultado: r.result,
            prioridad: undefined as NormalizedMandanteNovedad['prioridad'] | undefined,
            evidencias: (r.evidences || []).map((e) => e.photoUrl).filter(Boolean),
          }))
      : [];

    const novedadItems = novedades
      .filter((n) => {
        const sid = String(n.siteId ?? n.sucursalId ?? '');
        return allowedSites.some((s) => String(s.id) === sid);
      })
      .map((raw) => {
        const norm = normalizeMandanteNovedad(raw, allowedSites);
        return {
          id: norm.id,
          kind: 'novedad' as const,
          siteId: norm.siteId,
          sucursalName: norm.siteName,
          tipo: norm.tipo,
          categoria: norm.categoria,
          descripcion: norm.descripcion,
          guardName: norm.guardName,
          timestamp: norm.timestamp,
          localDate: norm.localDate,
          resultado: undefined,
          prioridad: norm.prioridad,
          evidencias: norm.evidencias,
        };
      });

    return [...roundItems, ...novedadItems].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp),
    );
  }, [guardRounds, novedades, allowedSites, isRondasActive]);

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return timelineItems.filter((item) => {
      const matchDate =
        item.localDate >= startDate && item.localDate <= endDate;
      const matchTipo = tipoFilter === 'all' || item.tipo === tipoFilter;
      const matchCategoria =
        categoryFilter === 'all' ||
        (categoryFilter === 'solo_accesos' &&
          (item.categoria === 'acceso_personas' || item.categoria === 'acceso_vehiculos')) ||
        item.categoria === categoryFilter;
      const matchSite = siteFilter === 'all' || item.siteId === siteFilter;
      const matchPrioridad =
        prioridadFilter === 'all' || item.prioridad === prioridadFilter;
      const catMeta = item.kind === 'novedad' ? getMandanteCategoriaMeta(item.categoria) : null;
      const matchSearch =
        !q ||
        [
          item.descripcion,
          item.guardName,
          item.sucursalName,
          item.tipo,
          catMeta?.label,
        ].some((v) => v && v.toLowerCase().includes(q));

      return (
        matchDate &&
        matchTipo &&
        matchCategoria &&
        matchSite &&
        matchPrioridad &&
        matchSearch
      );
    });
  }, [timelineItems, startDate, endDate, tipoFilter, categoryFilter, siteFilter, prioridadFilter, searchText]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginatedItems = filtered.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-black text-slate-900 tracking-tight">
          Libro de Novedades
        </h3>
        <p className="text-sm text-slate-500 mt-0.5">
          {isRondasActive
            ? 'Registro cronológico de novedades, incidencias y rondas'
            : 'Registro cronológico de novedades e incidencias de la instalación'}
        </p>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
        <div className="relative">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="text"
            placeholder="Buscar por descripción, guardia, categoría o instalación..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full pl-9 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 outline-none"
          />
          {searchText && (
            <button
              type="button"
              onClick={() => setSearchText('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-lg leading-none"
              title="Limpiar búsqueda"
            >
              &times;
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
              Desde
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
              Hasta
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
              Tipo
            </label>
            <select
              value={tipoFilter}
              onChange={(e) => setTipoFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="all">Todos</option>
              <option value="novedad">Novedades</option>
              <option value="incidencia">Incidencias</option>
              {isRondasActive && <option value="ronda">Rondas</option>}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
              Categoría
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="all">Todas</option>
              <option value="solo_accesos">Accesos (Personas y Vehículos)</option>
              <option value="acceso_personas">Acceso Personas</option>
              <option value="acceso_vehiculos">Acceso Vehículos</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
              Prioridad
            </label>
            <select
              value={prioridadFilter}
              onChange={(e) => setPrioridadFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="all">Todas</option>
              <option value="critica">Crítica</option>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="informativa">Informativa</option>
            </select>
          </div>
          {allowedSites.length > 1 && (
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                Instalación
              </label>
              <select
                value={siteFilter}
                onChange={(e) => setSiteFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="all">Todas</option>
                {allowedSites.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <span className="ml-auto text-xs font-semibold text-slate-400 self-end pb-1">
            {filtered.length} registro{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-14 text-center">
          <BookOpen size={38} className="text-slate-200 mx-auto mb-3" />
          <p className="font-semibold text-slate-500">
            No existen registros en el período seleccionado
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {paginatedItems.map((item, idx) => {
            const globalIndex = (page - 1) * itemsPerPage + idx;
            const prevDate = globalIndex > 0 ? filtered[globalIndex - 1].localDate : null;
            const showSep = prevDate !== item.localDate;
            const catMeta = item.kind === 'novedad' ? getMandanteCategoriaMeta(item.categoria) : null;
            const prioStyle = item.prioridad ? PRIORITY_STYLE[item.prioridad] : null;

            return (
              <React.Fragment key={item.id}>
                {showSep && (
                  <div className="flex items-center gap-3 py-2">
                    <div className="flex-1 h-px bg-slate-200/70" />
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      {new Date(item.localDate + 'T12:00:00').toLocaleDateString('es-CL', {
                        weekday: 'long',
                        day: '2-digit',
                        month: 'long',
                      })}
                    </span>
                    <div className="flex-1 h-px bg-slate-200/70" />
                  </div>
                )}

                <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 hover:border-slate-300 transition-all flex items-start gap-4">
                  <div className="text-right shrink-0 w-14">
                    <p className="text-sm font-black text-slate-800">{fmtTime(item.timestamp)}</p>
                  </div>

                  <div className="pt-1.5 shrink-0">
                    <div
                      className={`w-2.5 h-2.5 rounded-full ${
                        prioStyle
                          ? prioStyle.dotClass
                          : item.resultado === 'CON_NOVEDAD'
                          ? 'bg-rose-500'
                          : 'bg-emerald-500'
                      }`}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        {item.kind === 'ronda' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold uppercase">
                            <Navigation size={10} />
                            Ronda
                          </span>
                        ) : (
                          catMeta && (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${catMeta.badgeClass}`}
                            >
                              <span>{catMeta.icon}</span>
                              <span>{catMeta.label}</span>
                            </span>
                          )
                        )}

                        {prioStyle && (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${prioStyle.pillClass}`}>
                            {prioStyle.label}
                          </span>
                        )}

                        {item.resultado && <ResultBadge result={item.resultado} />}

                        <span className="text-xs font-bold text-slate-700">{item.guardName}</span>
                        <span className="text-xs text-slate-400 inline-flex items-center gap-1">
                          <MapPin size={10} />
                          {item.sucursalName}
                        </span>
                      </div>
                    </div>

                    <p className="text-sm text-slate-700 mt-1.5 leading-relaxed whitespace-pre-line">
                      {item.descripcion}
                    </p>

                    {item.evidencias && item.evidencias.length > 0 && (
                      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                        {item.evidencias.map((url, eIdx) => (
                          <button
                            key={eIdx}
                            type="button"
                            onClick={() =>
                              setGallery({
                                photos: item.evidencias,
                                index: eIdx,
                                title: `${catMeta?.label || 'Ronda'} · ${item.sucursalName}`,
                              })
                            }
                            className="shrink-0 w-16 h-16 rounded-xl border border-slate-200 overflow-hidden cursor-pointer hover:border-blue-400 transition"
                          >
                            <ThumbnailImage
                              photoUrl={url}
                              alt={`Evidencia ${eIdx + 1}`}
                              className="w-full h-full object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 bg-slate-50 text-slate-600 rounded-xl disabled:opacity-50 font-semibold text-sm hover:bg-slate-100 transition-colors"
          >
            Anterior
          </button>
          <span className="text-sm font-semibold text-slate-500">
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 bg-slate-50 text-slate-600 rounded-xl disabled:opacity-50 font-semibold text-sm hover:bg-slate-100 transition-colors"
          >
            Siguiente
          </button>
        </div>
      )}

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
};

// ─── Registro de Rondas completo ──────────────────────────────────────────────
const RegistroRondas: React.FC<{
  allowedSites: Site[];
  guardRounds: GuardRound[];
  initialPeriod: MandantePeriod;
  initialSiteId: string;
}> = ({ allowedSites, guardRounds, initialPeriod, initialSiteId }) => {
  const defaultRange = useMemo(() => getPeriodDateRange(initialPeriod), [initialPeriod]);
  const [searchTerm, setSearchTerm] = useState('');
  const [resultFilter, setResultFilter] = useState('all');
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [siteFilter, setSiteFilter] = useState(initialSiteId);
  const [selectedRound, setSelectedRound] = useState<GuardRound | null>(null);
  const [noteRound, setNoteRound] = useState<GuardRound | null>(null);
  const [page, setPage] = useState(1);
  const itemsPerPage = 20;

  useEffect(() => {
    setPage(1);
  }, [searchTerm, resultFilter, startDate, endDate, siteFilter]);

  useEffect(() => {
    if (!noteRound) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNoteRound(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [noteRound]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return guardRounds
      .filter((r) => {
        const inSite = allowedSites.some((s) => String(s.id) === String(r.siteId));
        if (!inSite) return false;
        const matchSearch =
          !q ||
          (r.workerName || '').toLowerCase().includes(q) ||
          (r.siteName || '').toLowerCase().includes(q);
        const matchResult = resultFilter === 'all' || r.result === resultFilter;
        const matchSite = siteFilter === 'all' || String(r.siteId) === siteFilter;
        const roundDate = toLocalDateStr(r.startTime);
        const matchDate = roundDate >= startDate && roundDate <= endDate;
        return matchSearch && matchResult && matchSite && matchDate;
      })
      .sort((a, b) => b.startTime.localeCompare(a.startTime));
  }, [guardRounds, allowedSites, searchTerm, resultFilter, siteFilter, startDate, endDate]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginatedItems = filtered.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-black text-slate-900 tracking-tight">
          Rondas y Registros
        </h3>
        <p className="text-sm text-slate-500 mt-0.5">
          {filtered.length} ronda{filtered.length !== 1 ? 's' : ''} encontrada
          {filtered.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm flex flex-wrap gap-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar guardia o instalación..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none w-56"
          />
        </div>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <select
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value)}
          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="all">Todos los resultados</option>
          <option value="SIN_NOVEDAD">Sin Novedad</option>
          <option value="CON_NOVEDAD">Con Novedad</option>
          <option value="SOSPECHA">Sospecha</option>
        </select>
        {allowedSites.length > 1 && (
          <select
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="all">Todas las instalaciones</option>
            {allowedSites.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-14 text-center">
          <Navigation size={38} className="text-slate-200 mx-auto mb-3" />
          <p className="font-semibold text-slate-500">No se encontraron rondas</p>
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedItems.map((round) => {
            const rawDuration = getRoundDurationMin(round);
            const durationRounded = rawDuration !== null ? Math.round(rawDuration) : null;

            return (
              <div
                key={round.id}
                className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 hover:border-slate-300 transition-all"
              >
                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 shrink-0">
                      <Navigation size={19} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-slate-800">{round.workerName}</h4>
                        <ResultBadge result={round.result} />
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-slate-500 font-semibold mt-0.5">
                        <MapPin size={11} className="text-blue-500" />
                        {round.siteName}
                      </div>
                    </div>
                  </div>

                  {round.notes && (
                    <div className="flex-1 bg-amber-50 border border-amber-100 rounded-xl p-3">
                      <p className="text-[10px] font-bold text-amber-700 uppercase mb-0.5">
                        Observación
                      </p>
                      <p className="text-xs text-amber-900 font-medium leading-relaxed">
                        &ldquo;{round.notes.length > 100 ? round.notes.substring(0, 100) + '...' : round.notes}&rdquo;
                        {round.notes.length > 100 && (
                          <button
                            type="button"
                            onClick={() => setNoteRound(round)}
                            className="ml-1.5 text-amber-800 hover:text-amber-950 font-bold underline cursor-pointer"
                          >
                            Ver completa
                          </button>
                        )}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-5 shrink-0 flex-wrap">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Inicio</p>
                      <p className="font-bold text-slate-700 text-sm">{fmtTime(round.startTime)}</p>
                      <p className="text-[10px] text-slate-400">{fmtDate(round.startTime)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Término</p>
                      {round.endTime ? (
                        <div>
                          <p className="font-bold text-slate-700 text-sm">{fmtTime(round.endTime)}</p>
                          <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                            {durationRounded} min
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-rose-500 text-xs font-bold">
                          <Loader2 size={12} className="animate-spin" /> En Curso
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">GPS</p>
                        <p className="font-black text-slate-700">{round.path?.length || 0}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Fotos</p>
                        <p
                          className={`font-black ${
                            (round.evidences?.length || 0) > 0 ? 'text-amber-600' : 'text-slate-300'
                          }`}
                        >
                          {round.evidences?.length || 0}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedRound(round)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm"
                    >
                      <ExternalLink size={13} />
                      Recorrido
                    </button>
                  </div>
                </div>

                {round.evidences && round.evidences.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-100 flex gap-2 overflow-x-auto">
                    {round.evidences.slice(0, 5).map((evi, idx) => (
                      <div
                        key={idx}
                        onClick={() => setSelectedRound(round)}
                        className="shrink-0 w-14 h-14 rounded-xl border border-slate-200 overflow-hidden cursor-pointer hover:border-blue-400 transition"
                      >
                        <ThumbnailImage
                          photoUrl={evi.photoUrl}
                          alt="Evidencia"
                          width={56}
                          height={56}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                    {round.evidences.length > 5 && (
                      <button
                        type="button"
                        onClick={() => setSelectedRound(round)}
                        className="shrink-0 w-14 h-14 rounded-xl bg-slate-50 border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400 text-xs font-black hover:bg-slate-100 transition"
                      >
                        +{round.evidences.length - 5}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 bg-slate-50 text-slate-600 rounded-xl disabled:opacity-50 font-semibold text-sm hover:bg-slate-100 transition-colors"
          >
            Anterior
          </button>
          <span className="text-sm font-semibold text-slate-500">
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 bg-slate-50 text-slate-600 rounded-xl disabled:opacity-50 font-semibold text-sm hover:bg-slate-100 transition-colors"
          >
            Siguiente
          </button>
        </div>
      )}

      {selectedRound && (
        <RouteMapModal round={selectedRound} onClose={() => setSelectedRound(null)} />
      )}

      {noteRound &&
        createPortal(
          <div
            className="fixed inset-0 z-[230] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
            onClick={() => setNoteRound(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mandante-round-note-title"
          >
            <div
              className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 bg-slate-900 text-white flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 id="mandante-round-note-title" className="text-base font-bold tracking-tight">
                    Observación de Ronda
                  </h3>
                  <p className="text-xs text-slate-300 mt-0.5 truncate">
                    {noteRound.workerName || 'Guardia'} · {noteRound.siteName || 'Instalación'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setNoteRound(null)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                  aria-label="Cerrar observación"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
                <ResultBadge result={noteRound.result} />
                <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
                  <Clock size={12} className="text-slate-400" />
                  {formatExecutiveDateTime(noteRound.startTime)}
                </span>
              </div>

              <div className="p-5 sm:p-6 max-h-[55vh] overflow-y-auto">
                <p className="text-sm sm:text-base text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                  {noteRound.notes}
                </p>
              </div>

              <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end">
                <button
                  type="button"
                  onClick={() => setNoteRound(null)}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

// ─── Resumen del Servicio (Vista Ejecutiva Dual) ──────────────────────────────
const ResumenServicio: React.FC<{
  allowedSites: Site[];
  guardRounds: GuardRound[];
  novedades: any[];
  attendanceLogs: AttendanceLog[];
  manualAttendances: any[];
  selectedSiteId: string;
  setSelectedSiteId: (id: string) => void;
  period: MandantePeriod;
  setPeriod: (p: MandantePeriod) => void;
  isRondasActive: boolean;
  lastUpdated: Date;
  isRefreshing: boolean;
  onRefresh: () => void;
  onNavigate: (sec: MandanteSection, opts?: { categoryPreset?: 'all' | 'solo_accesos' }) => void;
  showConfirmation: (cfg: any) => void;
}> = ({
  allowedSites,
  guardRounds,
  novedades,
  attendanceLogs,
  manualAttendances,
  selectedSiteId,
  setSelectedSiteId,
  period,
  setPeriod,
  isRondasActive,
  lastUpdated,
  isRefreshing,
  onRefresh,
  onNavigate,
  showConfirmation,
}) => {
  const [novedadesModalOpen, setNovedadesModalOpen] = useState(false);
  const [modalVariant, setModalVariant] = useState<'novedades' | 'accesos'>('novedades');
  const [highlightedNovedadId, setHighlightedNovedadId] = useState<string | null>(null);
  const [gallery, setGallery] = useState<{ photos: string[]; index: number; title: string } | null>(null);
  const [selectedRound, setSelectedRound] = useState<GuardRound | null>(null);

  const range = useMemo(() => getPeriodDateRange(period), [period]);
  const todayStr = toLocalDateStr();

  const selectedSiteObj = useMemo(
    () =>
      selectedSiteId === 'all'
        ? null
        : allowedSites.find((s) => String(s.id) === selectedSiteId) || null,
    [allowedSites, selectedSiteId],
  );

  const selectedSiteLabel =
    selectedSiteId === 'all'
      ? allowedSites.length === 1
        ? allowedSites[0].name
        : 'Todas mis instalaciones'
      : selectedSiteObj?.name || 'Instalación seleccionada';

  const siteScheduleLabel = useMemo(() => {
    const targetSites = selectedSiteObj ? [selectedSiteObj] : allowedSites;
    if (targetSites.length === 0) return null;
    const schedules = targetSites.map((s) => {
      const inicio = s.horario?.inicio?.trim() || DEFAULT_SITE_HORARIO.inicio;
      const termino = s.horario?.termino?.trim() || DEFAULT_SITE_HORARIO.termino;
      return `${inicio} a ${termino}`;
    });
    const unique = Array.from(new Set(schedules));
    return unique.length === 1 ? unique[0] : null;
  }, [selectedSiteObj, allowedSites]);

  // Filtrar Rondas por sucursal permitida y seleccionada
  const siteRounds = useMemo(
    () =>
      guardRounds.filter((r) => {
        const sid = String(r.siteId);
        const inAllowed = allowedSites.some((s) => String(s.id) === sid);
        const siteMatch = selectedSiteId === 'all' || sid === selectedSiteId;
        return inAllowed && siteMatch;
      }),
    [guardRounds, allowedSites, selectedSiteId],
  );

  const periodRounds = useMemo(
    () =>
      siteRounds.filter((r) => {
        const d = toLocalDateStr(r.startTime);
        return d >= range.startDate && d <= range.endDate;
      }),
    [siteRounds, range],
  );

  const prevPeriodRoundsCount = useMemo(
    () =>
      siteRounds.filter((r) => {
        const d = toLocalDateStr(r.startTime);
        return d >= range.prevStartDate && d <= range.prevEndDate;
      }).length,
    [siteRounds, range],
  );

  const todayRoundsCount = useMemo(
    () => siteRounds.filter((r) => toLocalDateStr(r.startTime) === todayStr).length,
    [siteRounds, todayStr],
  );
  const activeRoundsCount = useMemo(
    () => periodRounds.filter((r) => !r.endTime).length,
    [periodRounds],
  );

  // Regla crítica: duración promedio excluyendo rondas > 25 min
  const avgDuration = useMemo(
    () => calculateAverageRoundDuration(periodRounds),
    [periodRounds],
  );

  const guardStats = useMemo(
    () => computeGuardRoundStats(periodRounds),
    [periodRounds],
  );

  // Para tendencia diaria: cuando es 'hoy', mostramos últimos 7 días para dar contexto gráfico limpio
  const chartRange = useMemo(
    () => (period === 'hoy' ? getPeriodDateRange('7d') : range),
    [period, range],
  );
  const chartRounds = useMemo(
    () =>
      siteRounds.filter((r) => {
        const d = toLocalDateStr(r.startTime);
        return d >= chartRange.startDate && d <= chartRange.endDate;
      }),
    [siteRounds, chartRange],
  );
  const dailySeries = useMemo(
    () => computeDailyRoundSeries(chartRounds, chartRange.startDate, chartRange.endDate),
    [chartRounds, chartRange],
  );

  // Guardias en turno actualmente
  const activeGuards = useMemo(
    () =>
      computeActiveGuards({
        attendanceLogs,
        allowedSites,
        selectedSiteId,
        roundsInPeriod: periodRounds,
      }),
    [attendanceLogs, allowedSites, selectedSiteId, periodRounds],
  );

  // Novedades normalizadas del período y sucursal seleccionados (la tarjeta KPI y el modal usan EXACTAMENTE esta lista)
  const periodNovedades = useMemo(() => {
    return novedades
      .filter((raw) => {
        const sid = String(raw.siteId ?? raw.sucursalId ?? '');
        const inAllowed = allowedSites.some((s) => String(s.id) === sid);
        const siteMatch = selectedSiteId === 'all' || sid === selectedSiteId;
        if (!inAllowed || !siteMatch) return false;
        const ts = raw.fechaHoraDispositivo || raw.timestamp || raw.createdAt;
        const d = toLocalDateStr(ts);
        return d >= range.startDate && d <= range.endDate;
      })
      .map((raw) => normalizeMandanteNovedad(raw, allowedSites))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [novedades, allowedSites, selectedSiteId, range]);

  const novBreakdown = useMemo(
    () => computeNovedadesBreakdown(periodNovedades),
    [periodNovedades],
  );

  // Registros de acceso reales ingresados por los guardias en Novedades (Acceso Personas / Acceso Vehículos)
  const accesoBreakdown = useMemo(
    () => filterAccesoNovedades(periodNovedades),
    [periodNovedades],
  );

  // Control de Acceso y Cobertura (especialmente clave en modo Sin Rondas y PDF)
  const periodAccessRecords = useMemo(
    () =>
      buildAccessControlRecords({
        attendanceLogs,
        allowedSites,
        selectedSiteId,
        startDate: range.startDate,
        endDate: range.endDate,
      }),
    [attendanceLogs, allowedSites, selectedSiteId, range],
  );

  const coverage = useMemo(
    () =>
      computeServiceCoverage({
        accessRecords: periodAccessRecords,
        allAllowedAccessLogs: attendanceLogs,
        manualAttendances,
        allowedSites,
        selectedSiteId,
        startDate: range.startDate,
        endDate: range.endDate,
        hasActiveGuardNow: activeGuards.length > 0,
      }),
    [
      periodAccessRecords,
      attendanceLogs,
      manualAttendances,
      allowedSites,
      selectedSiteId,
      range,
      activeGuards.length,
    ],
  );

  // Timeline unificado "Actividad en Tiempo Real" (Rondas + Novedades en modo con rondas)
  const realtimeFeed = useMemo(() => {
    const rEvents = periodRounds.map((r) => ({
      id: `round_${r.id}`,
      kind: 'ronda' as const,
      ts: r.startTime,
      title: r.endTime ? 'Ronda completada' : 'Ronda en curso',
      subtitle: `${r.siteName || 'Instalación'} · ${r.workerName || 'Guardia'}`,
      tone: (r.result === 'CON_NOVEDAD'
        ? 'danger'
        : r.result === 'SOSPECHA'
        ? 'warning'
        : 'success') as 'success' | 'danger' | 'warning' | 'info',
      photoUrl: r.evidences?.[0]?.photoUrl || null,
      allPhotos: (r.evidences || []).map((e) => e.photoUrl).filter(Boolean),
      round: r,
      novedadId: null as string | null,
    }));

    const nEvents = periodNovedades.map((n) => ({
      id: `nov_${n.id}`,
      kind: 'novedad' as const,
      ts: n.timestamp,
      title: `Novedad (${PRIORITY_STYLE[n.prioridad].label})`,
      subtitle: `${n.descripcion.length > 48 ? n.descripcion.substring(0, 48) + '...' : n.descripcion} · ${n.guardName}`,
      tone: (n.prioridad === 'critica'
        ? 'danger'
        : n.prioridad === 'alta' || n.prioridad === 'media'
        ? 'warning'
        : 'info') as 'success' | 'danger' | 'warning' | 'info',
      photoUrl: n.evidencias[0] || null,
      allPhotos: n.evidencias,
      round: null as GuardRound | null,
      novedadId: n.id,
    }));

    return [...rEvents, ...nEvents]
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, 5);
  }, [periodRounds, periodNovedades]);

  const roundDeltaPct = useMemo(() => {
    if (period !== '7d' || prevPeriodRoundsCount <= 0) return null;
    return Math.round(
      ((periodRounds.length - prevPeriodRoundsCount) / prevPeriodRoundsCount) * 100,
    );
  }, [period, periodRounds.length, prevPeriodRoundsCount]);

  const handleOpenNovedadesModal = (focusId?: string | null) => {
    setModalVariant('novedades');
    setHighlightedNovedadId(focusId || null);
    setNovedadesModalOpen(true);
  };

  const handleOpenAccesosModal = (focusId?: string | null) => {
    setModalVariant('accesos');
    setHighlightedNovedadId(focusId || null);
    setNovedadesModalOpen(true);
  };

  const handleExportQuickPDF = () => {
    generateMandantePDF({
      tipo: 'resumen_ejecutivo',
      isRondasActive,
      rounds: periodRounds,
      novedades: periodNovedades,
      accessRecords: periodAccessRecords,
      coveragePct: coverage.percentage,
      coveredDays: coverage.coveredDaysCount,
      totalDays: coverage.totalDaysCount,
      siteName: selectedSiteLabel,
      startDate: range.startDate,
      endDate: range.endDate,
      onPopupBlocked: () =>
        showConfirmation({
          title: 'Ventana emergente bloqueada',
          message:
            'Permite las ventanas emergentes en tu navegador para generar e imprimir el reporte PDF.',
          type: 'alert',
          onConfirm: () => {},
        }),
    });
  };

  // ── Encabezado Ejecutivo Compartido ──
  const renderHeaderControls = () => (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">
            {isRondasActive ? 'Resumen del Servicio' : 'Estado de Instalación'}
          </h2>
          {!isRondasActive && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold">
              <DoorOpen size={13} />
              Sin Rondas Autorizadas
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500 mt-0.5">
          {selectedSiteLabel} · Vista Mandante
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <Calendar
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as MandantePeriod)}
            aria-label="Período del reporte"
            className="pl-8 pr-7 py-2 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm cursor-pointer"
          >
            <option value="hoy">Hoy</option>
            <option value="7d">Últimos 7 días</option>
            <option value="30d">Últimos 30 días</option>
          </select>
        </div>

        {allowedSites.length > 1 && (
          <div className="relative">
            <Building2
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            />
            <select
              value={selectedSiteId}
              onChange={(e) => setSelectedSiteId(e.target.value)}
              aria-label="Seleccionar instalación"
              className="pl-8 pr-7 py-2 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm cursor-pointer max-w-[230px]"
            >
              <option value="all">Todas mis instalaciones</option>
              {allowedSites.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                  {!s.rondasEnabled ? ' (Solo Acceso)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="button"
          onClick={handleExportQuickPDF}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs sm:text-sm font-semibold shadow-sm transition-colors"
        >
          <Download size={14} className="text-slate-500" />
          <span className="hidden sm:inline">Exportar Reporte</span>
          <span className="sm:hidden">PDF</span>
        </button>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-2 bg-white border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50 hover:text-blue-600 transition shadow-sm"
          title="Actualizar datos"
        >
          <RefreshCw size={16} className={isRefreshing ? 'animate-spin text-blue-600' : ''} />
        </button>
      </div>
    </div>
  );

  // ── Tarjeta Novedades Recientes (compartida por ambas vistas) ──
  const renderNovedadesRecientesCard = () => (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <AlertTriangle size={16} />
          </div>
          <h4 className="font-bold text-slate-800 text-sm">Novedades Recientes</h4>
        </div>
        <button
          type="button"
          onClick={() => handleOpenNovedadesModal(null)}
          className="text-xs font-bold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 transition-colors"
        >
          Ver todas <ChevronRight size={14} />
        </button>
      </div>

      <div className="p-4 flex-1">
        {periodNovedades.length === 0 ? (
          <div className="h-full min-h-[160px] flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <ShieldCheck size={30} className="text-emerald-300 mb-2" />
            <p className="text-sm font-semibold text-slate-600">Sin novedades en el período</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Operación normal sin incidencias registradas.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {periodNovedades.slice(0, 4).map((n) => {
              const prio = PRIORITY_STYLE[n.prioridad];
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleOpenNovedadesModal(n.id)}
                  className="w-full text-left p-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50/70 transition-all flex items-center gap-3 group"
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${prio.dotClass}`} />
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 ${prio.pillClass}`}
                  >
                    {prio.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm font-semibold text-slate-800 truncate group-hover:text-blue-700 transition-colors">
                      {n.descripcion}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                      {formatExecutiveDateTime(n.timestamp)} · {n.siteName}
                    </p>
                  </div>
                  {n.evidencias[0] && (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setGallery({
                          photos: n.evidencias,
                          index: 0,
                          title: `${getMandanteCategoriaMeta(n.categoria).label} · ${n.siteName}`,
                        });
                      }}
                      className="w-11 h-9 rounded-lg border border-slate-200 overflow-hidden shrink-0 hover:border-blue-400 transition"
                    >
                      <ThumbnailImage
                        photoUrl={n.evidencias[0]}
                        alt="Evidencia"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {renderHeaderControls()}

      {isRondasActive ? (
        /* ═══════════════════════════════════════════════════════════════════════
         * VISTA 1: PANEL COMPLETO CON RONDAS (Referencia Imagen 1)
         * ═══════════════════════════════════════════════════════════════════════ */
        <>
          {/* Banner Superior Estado Operativo */}
          <div
            className={`rounded-2xl border px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              activeGuards.length > 0
                ? 'bg-emerald-50/70 border-emerald-200/80'
                : 'bg-slate-100/80 border-slate-200'
            }`}
          >
            <div className="flex items-center gap-3.5">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  activeGuards.length > 0
                    ? 'bg-emerald-500 text-white shadow-sm'
                    : 'bg-slate-300 text-white'
                }`}
              >
                {activeGuards.length > 0 ? <CheckCircle2 size={22} /> : <Clock size={20} />}
              </div>
              <div>
                <h3
                  className={`text-base sm:text-lg font-black leading-tight ${
                    activeGuards.length > 0 ? 'text-emerald-900' : 'text-slate-700'
                  }`}
                >
                  {activeGuards.length > 0 ? 'Servicio Operativo' : 'Sin Guardias en Turno'}
                </h3>
                <p
                  className={`text-xs font-semibold mt-0.5 ${
                    activeGuards.length > 0 ? 'text-emerald-700' : 'text-slate-500'
                  }`}
                >
                  {activeGuards.length > 0
                    ? `${activeGuards.length} guardia${activeGuards.length !== 1 ? 's' : ''} activo${activeGuards.length !== 1 ? 's' : ''} · Instalación con cobertura${siteScheduleLabel ? ` · Horario: ${siteScheduleLabel}` : ''}`
                    : `No se registran turnos iniciados en este momento en la instalación${siteScheduleLabel ? ` · Horario: ${siteScheduleLabel}` : ''}`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 shrink-0">
              <span
                className={`w-2 h-2 rounded-full ${
                  activeGuards.length > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                }`}
              />
              <span>Actualizado: {formatExecutiveDateTime(lastUpdated.toISOString())}</span>
            </div>
          </div>

          {/* 4 KPI Cards Ejecutivas */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Guardias Activos */}
            <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
                <UserCheck size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-2xl sm:text-3xl font-black text-slate-900 leading-none">
                  {activeGuards.length}
                </p>
                <p className="text-xs font-bold text-slate-700 mt-1 truncate">Guardias Activos</p>
                <p className="text-[11px] text-slate-400 font-medium truncate">
                  En servicio actual
                </p>
              </div>
            </div>

            {/* 2. Rondas Realizadas */}
            <button
              type="button"
              onClick={() => onNavigate('rondas')}
              className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm hover:border-blue-300 hover:shadow-md transition-all flex items-center gap-3.5 text-left"
            >
              <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shrink-0">
                <Navigation size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-2xl sm:text-3xl font-black text-slate-900 leading-none">
                  {periodRounds.length}
                </p>
                <p className="text-xs font-bold text-slate-700 mt-1 truncate">
                  Rondas Realizadas
                </p>
                <p className="text-[11px] font-medium truncate mt-0.5">
                  {roundDeltaPct !== null ? (
                    <span className={roundDeltaPct >= 0 ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                      {roundDeltaPct >= 0 ? `+${roundDeltaPct}%` : `${roundDeltaPct}%`} vs. semana ant.
                    </span>
                  ) : (
                    <span className="text-slate-400">
                      {todayRoundsCount} hoy{activeRoundsCount > 0 ? ` · ${activeRoundsCount} en curso` : ''}
                    </span>
                  )}
                </p>
              </div>
            </button>

            {/* 3. Duración Promedio */}
            <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-600 border border-slate-200/80 flex items-center justify-center shrink-0">
                <Clock size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-2xl sm:text-3xl font-black text-slate-900 leading-none">
                  {avgDuration.avgMin !== null ? (
                    <>
                      {avgDuration.avgMin}{' '}
                      <span className="text-base font-bold text-slate-500">min</span>
                    </>
                  ) : (
                    '—'
                  )}
                </p>
                <p className="text-xs font-bold text-slate-700 mt-1 truncate">
                  Duración Promedio
                </p>
                <p className="text-[11px] text-slate-400 font-medium truncate">
                  por ronda
                </p>
              </div>
            </div>

            {/* 4. Novedades (Clicable -> Abre modal con las N novedades) */}
            <button
              type="button"
              onClick={() => handleOpenNovedadesModal(null)}
              className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm hover:border-rose-300 hover:shadow-md transition-all flex items-center gap-3.5 text-left group cursor-pointer"
              title="Haz clic para ver el detalle de todas las novedades del período"
            >
              <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-2xl sm:text-3xl font-black text-rose-600 leading-none">
                  {novBreakdown.total}
                </p>
                <p className="text-xs font-bold text-slate-700 mt-1 truncate">Novedades</p>
                <p className="text-[11px] text-slate-500 font-medium truncate">
                  {novBreakdown.summaryText}
                </p>
              </div>
              <ChevronRight
                size={17}
                className="text-slate-300 group-hover:text-rose-500 group-hover:translate-x-0.5 transition-all shrink-0"
              />
            </button>
          </div>

          {/* Fila Media: Guardias en Servicio + Actividad en Tiempo Real */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Guardias en Servicio */}
            <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Users size={16} />
                  </div>
                  <h4 className="font-bold text-slate-800 text-sm">Guardias en Servicio</h4>
                </div>
                <span className="text-xs font-bold text-slate-400">
                  {activeGuards.length} activo{activeGuards.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="p-4 flex-1">
                {activeGuards.length === 0 ? (
                  <div className="h-full min-h-[160px] flex flex-col items-center justify-center text-center p-6 text-slate-400">
                    <Users size={30} className="text-slate-200 mb-2" />
                    <p className="text-sm font-semibold text-slate-500">
                      Sin guardias en servicio actualmente
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeGuards.map((g) => (
                      <div
                        key={g.id}
                        className="rounded-xl border border-slate-200/80 p-3.5 hover:border-blue-200 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 font-black text-xs flex items-center justify-center shrink-0">
                            {g.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-800 text-sm truncate">{g.name}</p>
                            <div className="flex items-center gap-2 flex-wrap mt-0.5">
                              <span className="text-[11px] text-slate-400 font-medium">
                                Guardia de Seguridad
                              </span>
                              {allowedSites.length > 1 && selectedSiteId === 'all' && (
                                <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                  {g.siteName}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 text-xs shrink-0 flex-wrap">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-200/80">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            En turno
                          </span>
                          <div>
                            <p className="text-[10px] text-slate-400 font-semibold uppercase">
                              Ingreso
                            </p>
                            <p className="font-bold text-slate-700">{g.checkInTime}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400 font-semibold uppercase">
                              Rondas
                            </p>
                            <p className="font-black text-slate-800">{g.roundsInPeriod}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Actividad en Tiempo Real */}
            <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <Radio size={16} />
                  </div>
                  <h4 className="font-bold text-slate-800 text-sm">Actividad en Tiempo Real</h4>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('novedades')}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 transition-colors"
                >
                  Ver todas <ChevronRight size={14} />
                </button>
              </div>

              <div className="p-4 flex-1">
                {realtimeFeed.length === 0 ? (
                  <div className="h-full min-h-[160px] flex flex-col items-center justify-center text-center p-6 text-slate-400">
                    <Radio size={28} className="text-slate-200 mb-2" />
                    <p className="text-sm font-semibold text-slate-500">
                      Sin actividad registrada en el período
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {realtimeFeed.map((ev) => (
                      <div
                        key={ev.id}
                        onClick={() => {
                          if (ev.round) setSelectedRound(ev.round);
                          else if (ev.novedadId) handleOpenNovedadesModal(ev.novedadId);
                        }}
                        className="py-2.5 first:pt-0 last:pb-0 flex items-center gap-3 cursor-pointer hover:bg-slate-50/80 rounded-xl px-2 -mx-2 transition-colors"
                      >
                        <span className="text-[11px] font-bold text-slate-500 w-16 shrink-0">
                          {fmtTime(ev.ts)}
                        </span>

                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                            ev.tone === 'success'
                              ? 'bg-emerald-50 text-emerald-600'
                              : ev.tone === 'danger'
                              ? 'bg-rose-50 text-rose-600'
                              : ev.tone === 'warning'
                              ? 'bg-amber-50 text-amber-600'
                              : 'bg-blue-50 text-blue-600'
                          }`}
                        >
                          {ev.kind === 'ronda' ? (
                            ev.round && !ev.round.endTime ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={14} />
                            )
                          ) : (
                            <AlertCircle size={14} />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-xs font-bold truncate ${
                              ev.tone === 'danger' ? 'text-rose-700' : 'text-slate-800'
                            }`}
                          >
                            {ev.title}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">{ev.subtitle}</p>
                        </div>

                        {ev.photoUrl && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setGallery({
                                photos: ev.allPhotos,
                                index: 0,
                                title: ev.title,
                              });
                            }}
                            className="w-16 h-11 rounded-lg border border-slate-200 overflow-hidden shrink-0 hover:border-blue-400 transition relative group"
                            title="Ampliar evidencia"
                          >
                            <ThumbnailImage
                              photoUrl={ev.photoUrl}
                              alt={ev.title}
                              className="w-full h-full object-cover"
                            />
                            <span className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/20 flex items-center justify-center transition-colors">
                              <Camera
                                size={13}
                                className="text-white opacity-0 group-hover:opacity-100"
                              />
                            </span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Fila Inferior: Rendimiento de Rondas + Novedades Recientes */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-7">
              <RendimientoRondasCard
                series={dailySeries}
                guardStats={guardStats}
                periodLabel={period === 'hoy' ? 'Últimos 7 días (contexto)' : PERIOD_LABELS[period]}
              />
            </div>
            <div className="lg:col-span-5">{renderNovedadesRecientesCard()}</div>
          </div>
        </>
      ) : (
        /* ═══════════════════════════════════════════════════════════════════════
         * VISTA 2: SOLO CONTROL DE ACCESO Y NOVEDADES (Referencia Imagen 2)
         * ═══════════════════════════════════════════════════════════════════════ */
        <>
          {/* Cabecera Informativa de la Instalación (Sin Rondas) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 text-white flex items-center justify-center shrink-0 shadow-sm">
                <Building2 size={28} />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-black text-slate-900 truncate">
                  {selectedSiteLabel}
                </h3>
                <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5 truncate">
                  <MapPin size={12} className="text-slate-400 shrink-0" />
                  {selectedSiteObj?.address || `${allowedSites.length} sucursal(es) asignada(s)`}
                </p>
                <div className="mt-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-bold">
                    <DoorOpen size={12} className="text-blue-600" />
                    Control de Acceso y Novedades
                  </span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 bg-blue-50/70 rounded-2xl border border-blue-200/80 p-5 flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-xl bg-white border border-blue-200 text-blue-600 flex items-center justify-center shrink-0">
                <Info size={18} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-800">
                  Información de la Instalación
                </h4>
                <p className="text-xs sm:text-sm text-slate-600 mt-1 leading-relaxed">
                  En esta instalación no se realizan rondas de seguridad. El servicio se supervisa
                  mediante registro de accesos, cobertura horaria y reporte de novedades.
                </p>
              </div>
            </div>
          </div>

          {/* 4 KPI Cards Ejecutivas */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Estado del Servicio */}
            <div
              className={`rounded-2xl p-4 sm:p-5 border shadow-sm flex items-center gap-3.5 ${
                activeGuards.length > 0
                  ? 'bg-emerald-50/80 border-emerald-200/80'
                  : 'bg-white border-slate-200/80'
              }`}
            >
              <div
                className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                  activeGuards.length > 0
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                <UserCheck size={20} />
              </div>
              <div className="min-w-0">
                <p
                  className={`text-base sm:text-lg font-black leading-tight ${
                    activeGuards.length > 0 ? 'text-emerald-900' : 'text-slate-700'
                  }`}
                >
                  {activeGuards.length > 0 ? 'Servicio Activo' : 'Sin Turno Activo'}
                </p>
                <p
                  className={`text-xs font-semibold mt-1 truncate ${
                    activeGuards.length > 0 ? 'text-emerald-700' : 'text-slate-500'
                  }`}
                >
                  {activeGuards.length > 0
                    ? `Con cobertura · ${activeGuards.length} en turno`
                    : 'Sin marcaje vigente'}
                </p>
              </div>
            </div>

            {/* 2. Registros de Acceso (Acceso Personas y Acceso Vehículos desde Novedades) */}
            <button
              type="button"
              onClick={() => handleOpenAccesosModal(null)}
              className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm hover:border-blue-300 hover:shadow-md transition-all flex items-center gap-3.5 text-left group cursor-pointer"
              title="Haz clic para ver los registros de acceso de personas y vehículos"
            >
              <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
                <DoorOpen size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-2xl sm:text-3xl font-black text-slate-900 leading-none">
                  {accesoBreakdown.total}
                </p>
                <p className="text-xs font-bold text-slate-700 mt-1 truncate">
                  Registros de Acceso
                </p>
                <p className="text-[11px] text-slate-500 font-medium truncate">
                  {accesoBreakdown.summaryText}
                </p>
              </div>
              <ChevronRight
                size={17}
                className="text-slate-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all shrink-0"
              />
            </button>

            {/* 3. Novedades (Clicable -> Abre modal con las N novedades) */}
            <button
              type="button"
              onClick={() => handleOpenNovedadesModal(null)}
              className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm hover:border-rose-300 hover:shadow-md transition-all flex items-center gap-3.5 text-left group cursor-pointer"
              title="Haz clic para ver el detalle de todas las novedades del período"
            >
              <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-2xl sm:text-3xl font-black text-rose-600 leading-none">
                  {novBreakdown.total}
                </p>
                <p className="text-xs font-bold text-slate-700 mt-1 truncate">Novedades</p>
                <p className="text-[11px] text-slate-500 font-medium truncate">
                  {novBreakdown.summaryText}
                </p>
              </div>
              <ChevronRight
                size={17}
                className="text-slate-300 group-hover:text-rose-500 group-hover:translate-x-0.5 transition-all shrink-0"
              />
            </button>

            {/* 4. Cobertura del Servicio */}
            <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center shrink-0">
                <Calendar size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-2xl sm:text-3xl font-black text-slate-900 leading-none">
                  {coverage.percentage}%
                </p>
                <p className="text-xs font-bold text-slate-700 mt-1 truncate">
                  Cobertura del Servicio
                </p>
                <p className="text-[11px] text-slate-400 font-medium truncate">
                  {coverage.coveredDaysCount} de {coverage.totalDaysCount} día
                  {coverage.totalDaysCount !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </div>

          {/* Fila Media: Registros de Acceso (Personas y Vehículos desde Novedades) + Novedades Recientes */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Registros de Acceso */}
            <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                    <DoorOpen size={16} />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm inline">
                      Registros de Acceso
                    </h4>{' '}
                    <span className="text-xs text-slate-400 font-medium">(Personas y Vehículos)</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('novedades', { categoryPreset: 'solo_accesos' })}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 transition-colors"
                >
                  Ver todos <ChevronRight size={14} />
                </button>
              </div>

              <div className="flex-1 overflow-x-auto">
                {accesoBreakdown.records.length === 0 ? (
                  <div className="p-10 text-center text-slate-400">
                    <DoorOpen size={30} className="mx-auto mb-2 text-slate-200" />
                    <p className="text-sm font-semibold text-slate-500">
                      Sin registros de acceso de personas o vehículos en este período
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                        <th className="text-left px-4 py-2.5">Fecha y Hora</th>
                        <th className="text-left px-3 py-2.5">Categoría</th>
                        <th className="text-left px-3 py-2.5">Detalle</th>
                        <th className="text-left px-4 py-2.5">Registrado por</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {accesoBreakdown.records.slice(0, 6).map((rec) => {
                        const catMeta = getMandanteCategoriaMeta(rec.categoria);
                        return (
                          <tr
                            key={rec.id}
                            onClick={() => handleOpenAccesosModal(rec.id)}
                            className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                          >
                            <td className="px-4 py-2.5 text-xs font-medium text-slate-600 whitespace-nowrap">
                              {formatExecutiveDateTime(rec.timestamp)}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${catMeta.badgeClass}`}
                              >
                                <span>{catMeta.icon}</span>
                                <span>{catMeta.label}</span>
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-xs text-slate-700 font-medium max-w-[260px]">
                              <div className="flex items-center gap-2">
                                <span className="truncate">{rec.descripcion}</span>
                                {rec.evidencias.length > 0 && (
                                  <span
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold shrink-0"
                                    title="Incluye fotografía"
                                  >
                                    <Camera size={10} />
                                    {rec.evidencias.length}
                                  </span>
                                )}
                              </div>
                              {allowedSites.length > 1 && selectedSiteId === 'all' && (
                                <p className="text-[10px] text-slate-400 truncate">{rec.siteName}</p>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                              {rec.guardName}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Novedades Recientes */}
            <div className="lg:col-span-5">{renderNovedadesRecientesCard()}</div>
          </div>

          {/* Fila Inferior: Cobertura Semanal del Servicio */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
                <Calendar size={16} />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-sm leading-tight">
                  Cobertura del Servicio
                </h4>
                <p className="text-[11px] text-slate-400 font-medium">Últimos 7 días</p>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
              <div className="grid grid-cols-7 gap-2 flex-1">
                {coverage.weeklyDays.map((day) => (
                  <div
                    key={day.date}
                    className={`rounded-xl border px-2 py-3 text-center transition-colors ${
                      day.covered
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                        : 'bg-slate-50 border-slate-200/80 text-slate-500'
                    }`}
                  >
                    <p className="text-xs font-bold">{day.weekdayShort}</p>
                    <p className="text-[10px] text-slate-400 mb-1.5">{day.dayLabel}</p>
                    <p
                      className={`text-[11px] font-bold flex items-center justify-center gap-1 ${
                        day.covered ? 'text-emerald-700' : 'text-slate-400'
                      }`}
                    >
                      {day.covered ? (
                        <>
                          <CheckCircle2 size={12} className="shrink-0" />
                          <span className="hidden sm:inline">Cubierto</span>
                        </>
                      ) : (
                        <span className="text-[10px]">Sin reg.</span>
                      )}
                    </p>
                  </div>
                ))}
              </div>

              {/* Anillo porcentual */}
              <div className="flex items-center gap-4 lg:pl-6 lg:border-l border-slate-100 shrink-0">
                <div className="relative w-16 h-16 flex items-center justify-center">
                  <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
                    <circle
                      cx="32"
                      cy="32"
                      r="26"
                      fill="none"
                      stroke="#e2e8f0"
                      strokeWidth="7"
                    />
                    <circle
                      cx="32"
                      cy="32"
                      r="26"
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="7"
                      strokeLinecap="round"
                      strokeDasharray={`${(coverage.weeklyPercentage / 100) * 163.36} 163.36`}
                    />
                  </svg>
                  <span className="absolute text-sm font-black text-slate-900">
                    {coverage.weeklyPercentage}%
                  </span>
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">Cobertura Semanal</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {coverage.weeklyCoveredCount} de 7 días con servicio
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Modal aparte para ver todas las N novedades o accesos al hacer click en tarjetas / registros */}
      <NovedadesResumenModal
        isOpen={novedadesModalOpen}
        onClose={() => {
          setNovedadesModalOpen(false);
          setHighlightedNovedadId(null);
        }}
        variant={modalVariant}
        novedades={modalVariant === 'accesos' ? accesoBreakdown.records : periodNovedades}
        siteLabel={selectedSiteLabel}
        periodLabel={PERIOD_LABELS[period]}
        highlightedId={highlightedNovedadId}
        onOpenFullBook={() =>
          onNavigate('novedades', {
            categoryPreset: modalVariant === 'accesos' ? 'solo_accesos' : 'all',
          })
        }
      />

      {gallery && (
        <PhotoGalleryModal
          photos={gallery.photos}
          initialIndex={gallery.index}
          title={gallery.title}
          onClose={() => setGallery(null)}
        />
      )}

      {selectedRound && (
        <RouteMapModal round={selectedRound} onClose={() => setSelectedRound(null)} />
      )}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
const MandanteView: React.FC = () => {
  const {
    guardRounds,
    sites,
    currentUser,
    employees,
    logout,
    fetchInitialData,
    showConfirmation,
    novedades,
    fetchNovedades,
    attendanceLogs,
  } = useAppStore();

  const [activeSection, setActiveSection] = useState<MandanteSection>('estado');
  const [novedadesCategoryPreset, setNovedadesCategoryPreset] = useState<'all' | 'solo_accesos'>('all');
  const [selectedSiteId, setSelectedSiteId] = useState<string>('all');
  const [period, setPeriod] = useState<MandantePeriod>('7d');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());

  // Estado en tiempo real directo de Firestore para el portal Mandante
  const [liveEmployeeDoc, setLiveEmployeeDoc] = useState<Employee | null>(null);
  const [liveAttendance, setLiveAttendance] = useState<AttendanceLog[] | null>(null);
  const [liveRounds, setLiveRounds] = useState<GuardRound[] | null>(null);
  const [liveNovedades, setLiveNovedades] = useState<any[] | null>(null);
  const [liveManualAttendances, setLiveManualAttendances] = useState<any[]>([]);

  const storeEmp = useMemo(
    () => employees.find((e) => e.id === currentUser?.uid) || null,
    [employees, currentUser?.uid],
  );
  const currentEmp = liveEmployeeDoc || storeEmp;

  const assignedSiteIds = useMemo(
    () => (currentEmp?.assignedSites || []).map((id) => String(id)),
    [currentEmp?.assignedSites],
  );
  const assignedKey = assignedSiteIds.join(',');

  const allowedSites = useMemo(
    () => sites.filter((s) => assignedSiteIds.includes(String(s.id))),
    [sites, assignedSiteIds],
  );

  // Resolver vista activa (Con Rondas vs Solo Control de Acceso y Novedades)
  const mandanteViewMode: MandanteViewMode = currentEmp?.mandanteViewMode || 'auto';
  const isRondasActive = useMemo(
    () =>
      resolveIsRondasViewActive({
        mandanteViewMode,
        selectedSiteId,
        allowedSites,
      }),
    [mandanteViewMode, selectedSiteId, allowedSites],
  );

  // Asegurar que activeSection no quede apuntando a una vista oculta al cambiar de sucursal o modo
  useEffect(() => {
    if (!isRondasActive && activeSection === 'rondas') {
      setActiveSection('estado');
    }
  }, [isRondasActive, activeSection]);

  // Listener sobre la ficha del Mandante (para reflejar cambios en assignedSites o mandanteViewMode al instante)
  useEffect(() => {
    if (!currentUser?.uid) return;
    const unsub = onSnapshot(
      doc(db, 'Colaboradores', currentUser.uid),
      (snap) => {
        if (snap.exists()) {
          setLiveEmployeeDoc({ ...(snap.data() as Employee), id: snap.id });
        }
      },
      (err) => console.warn('[MandanteView] Error en snapshot de perfil:', err),
    );
    return () => unsub();
  }, [currentUser?.uid]);

  // Listeners en tiempo real de Asistencia (30d), Rondas (30d), Novedades y Manuales (30d)
  useEffect(() => {
    if (assignedSiteIds.length === 0) return;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 31);
    const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();
    const thirtyDaysAgoDateStr = toLocalDateStr(thirtyDaysAgo);
    const allowedSet = new Set(assignedSiteIds);

    // 1. Asistencia (últimos 31 días, sin índice compuesto)
    const qAtt = query(
      collection(db, 'Asistencia'),
      where('timestamp', '>=', thirtyDaysAgoIso),
      orderBy('timestamp', 'desc'),
      limit(1000),
    );
    const unsubAtt = onSnapshot(
      qAtt,
      (snap) => {
        const logs: AttendanceLog[] = [];
        snap.forEach((d) => logs.push({ ...(d.data() as AttendanceLog), id: d.id }));
        setLiveAttendance(logs);
        setLastUpdated(new Date());
      },
      (err) => console.warn('[MandanteView] Error en snapshot Asistencia:', err),
    );

    // 2. Asistencia Manual (últimos 31 días para cobertura)
    const qMan = query(
      collection(db, 'asistencia_manual'),
      where('date', '>=', thirtyDaysAgoDateStr),
    );
    const unsubMan = onSnapshot(
      qMan,
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => list.push({ ...d.data(), id: d.id }));
        setLiveManualAttendances(list);
      },
      (err) => console.warn('[MandanteView] Error en snapshot asistencia_manual:', err),
    );

    // 3. Rondas (últimos 31 días)
    const qRounds = query(
      collection(db, 'Rondas'),
      where('startTime', '>=', thirtyDaysAgoIso),
      orderBy('startTime', 'desc'),
      limit(1000),
    );
    const unsubRounds = onSnapshot(
      qRounds,
      (snap) => {
        const list: GuardRound[] = [];
        snap.forEach((d) => list.push({ ...(d.data() as GuardRound), id: d.id }));
        setLiveRounds(list);
        setLastUpdated(new Date());
      },
      (err) => console.warn('[MandanteView] Error en snapshot Rondas:', err),
    );

    // 4. Novedades (últimas 300 filtradas por sucursales permitidas)
    const qNov = query(collection(db, 'novedades'), orderBy('timestamp', 'desc'), limit(300));
    const unsubNov = onSnapshot(
      qNov,
      (snap) => {
        const filtered: any[] = [];
        snap.forEach((d) => {
          const data = d.data();
          const sid = String(data.siteId ?? data.sucursalId ?? '');
          if (allowedSet.has(sid)) {
            filtered.push({ ...data, id: d.id });
          }
        });
        setLiveNovedades(filtered);
        setLastUpdated(new Date());
      },
      (err) => console.warn('[MandanteView] Error en snapshot novedades:', err),
    );

    return () => {
      unsubAtt();
      unsubMan();
      unsubRounds();
      unsubNov();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedKey]);

  useEffect(() => {
    if (assignedSiteIds.length > 0) {
      fetchNovedades(assignedSiteIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedKey]);

  const effectiveAttendance = liveAttendance ?? attendanceLogs;
  const effectiveRounds = liveRounds ?? guardRounds;
  const effectiveNovedades = liveNovedades ?? novedades;

  // Contador badge lateral de novedades del período e instalación seleccionada (coincidente con la tarjeta KPI)
  const periodNovedadesBadgeCount = useMemo(() => {
    const { startDate, endDate } = getPeriodDateRange(period);
    return effectiveNovedades.filter((raw) => {
      const sid = String(raw.siteId ?? raw.sucursalId ?? '');
      if (!assignedSiteIds.includes(sid)) return false;
      if (selectedSiteId !== 'all' && sid !== selectedSiteId) return false;
      const norm = normalizeMandanteNovedad(raw, allowedSites);
      return norm.localDate >= startDate && norm.localDate <= endDate;
    }).length;
  }, [effectiveNovedades, assignedSiteIds, selectedSiteId, period, allowedSites]);

  const navItems: {
    id: MandanteSection;
    label: string;
    mobileLabel: string;
    icon: React.ReactNode;
    badge?: number;
  }[] = useMemo(() => {
    const items: {
      id: MandanteSection;
      label: string;
      mobileLabel: string;
      icon: React.ReactNode;
      badge?: number;
    }[] = [
      {
        id: 'estado',
        label: 'Resumen del Servicio',
        mobileLabel: 'Resumen',
        icon: <LayoutDashboard size={18} />,
      },
    ];

    if (isRondasActive) {
      items.push({
        id: 'rondas',
        label: 'Rondas y Registros',
        mobileLabel: 'Rondas',
        icon: <Navigation size={18} />,
      });
    }

    items.push(
      {
        id: 'novedades',
        label: 'Novedades',
        mobileLabel: 'Novedades',
        icon: <BookOpen size={18} />,
        badge: periodNovedadesBadgeCount > 0 ? periodNovedadesBadgeCount : undefined,
      },
      {
        id: 'reportes',
        label: 'Reportes',
        mobileLabel: 'Reportes',
        icon: <FileText size={18} />,
      },
    );

    return items;
  }, [isRondasActive, periodNovedadesBadgeCount]);

  const handleResumenNavigate = (
    sec: MandanteSection,
    opts?: { categoryPreset?: 'all' | 'solo_accesos' },
  ) => {
    setNovedadesCategoryPreset(opts?.categoryPreset ?? 'all');
    setActiveSection(sec);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchInitialData(true);
      if (assignedSiteIds.length > 0) await fetchNovedades(assignedSiteIds);
      setLastUpdated(new Date());
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex flex-col w-64 bg-slate-900 text-white shrink-0">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <img
              src="/logo-transparencia.png"
              alt="Logo ASPRO"
              className="w-11 h-11 object-contain shrink-0 drop-shadow"
            />
            <div>
              <p className="font-black text-sm leading-none tracking-tight">ASPRO APP</p>
              <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest">
                Portal Mandante
              </p>
            </div>
          </div>
        </div>

        <div className="px-4 py-4 border-b border-slate-800">
          <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-3">
            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
              Mandante
            </p>
            <p className="text-xs font-bold text-white truncate mt-0.5">
              {currentEmp?.firstName} {currentEmp?.lastNamePaterno}
            </p>
            <p className="text-[10px] text-slate-400 truncate mt-0.5">
              {allowedSites.length === 1
                ? allowedSites[0].name
                : `${allowedSites.length} instalaciones asignadas`}
            </p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest px-3 mb-2">
            Módulos
          </p>
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setNovedadesCategoryPreset('all');
                setActiveSection(item.id);
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                activeSection === item.id
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                {item.icon}
                <span className="truncate">{item.label}</span>
              </span>
              {item.badge !== undefined && (
                <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-black leading-none shrink-0">
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-slate-800 space-y-1">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            Actualizar Datos
          </button>
          <button
            type="button"
            onClick={() => logout()}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-900/20 transition"
          >
            <LogOut size={16} />
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="lg:hidden bg-slate-900 text-white px-4 py-2.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo-transparencia.png"
              alt="Logo ASPRO"
              className="w-9 h-9 object-contain shrink-0 drop-shadow"
            />
            <div>
              <p className="font-black text-sm leading-none">ASPRO APP</p>
              <p className="text-[9px] text-slate-400 uppercase tracking-wider mt-0.5">
                Portal Mandante
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              className="p-1.5 text-slate-300 hover:text-white transition"
              aria-label="Actualizar"
            >
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => logout()}
              className="p-1.5 text-rose-400 hover:text-rose-300 transition"
              aria-label="Cerrar sesión"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 pb-28 lg:pb-8">
            {allowedSites.length === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-sm max-w-lg mx-auto mt-10">
                <Building2 size={44} className="text-slate-300 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-slate-800">
                  Sin instalaciones asignadas
                </h3>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  Su cuenta aún no tiene sucursales vinculadas. Contacte a su supervisor o
                  administrador de ASPRO para habilitar la visualización.
                </p>
              </div>
            ) : (
              <>
                {activeSection === 'estado' && (
                  <ResumenServicio
                    allowedSites={allowedSites}
                    guardRounds={effectiveRounds}
                    novedades={effectiveNovedades}
                    attendanceLogs={effectiveAttendance}
                    manualAttendances={liveManualAttendances}
                    selectedSiteId={selectedSiteId}
                    setSelectedSiteId={setSelectedSiteId}
                    period={period}
                    setPeriod={setPeriod}
                    isRondasActive={isRondasActive}
                    lastUpdated={lastUpdated}
                    isRefreshing={isRefreshing}
                    onRefresh={handleRefresh}
                    onNavigate={handleResumenNavigate}
                    showConfirmation={showConfirmation}
                  />
                )}

                {activeSection === 'rondas' && isRondasActive && (
                  <RegistroRondas
                    allowedSites={allowedSites}
                    guardRounds={effectiveRounds}
                    initialPeriod={period}
                    initialSiteId={selectedSiteId}
                  />
                )}

                {activeSection === 'novedades' && (
                  <LibroNovedades
                    allowedSites={allowedSites}
                    guardRounds={effectiveRounds}
                    novedades={effectiveNovedades}
                    isRondasActive={isRondasActive}
                    initialPeriod={period}
                    initialSiteId={selectedSiteId}
                    initialCategoryFilter={novedadesCategoryPreset}
                  />
                )}

                {activeSection === 'reportes' && (
                  <MandanteReportes
                    allowedSites={allowedSites}
                    guardRounds={effectiveRounds}
                    novedades={effectiveNovedades}
                    attendanceLogs={effectiveAttendance}
                    manualAttendances={liveManualAttendances}
                    isRondasActive={isRondasActive}
                    initialPeriod={period}
                    initialSiteId={selectedSiteId}
                    showConfirmation={showConfirmation}
                  />
                )}
              </>
            )}
          </div>
        </main>

        {/* Mobile bottom nav */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-2xl z-40">
          <div className="flex">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setNovedadesCategoryPreset('all');
                  setActiveSection(item.id);
                }}
                className={`relative flex-1 flex flex-col items-center gap-1 py-2.5 px-1 transition-all ${
                  activeSection === item.id
                    ? 'text-blue-600'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <div className="relative">
                  {item.icon}
                  {item.badge !== undefined && (
                    <span className="absolute -top-1.5 -right-2 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[9px] font-black leading-none">
                      {item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-bold leading-none text-center">
                  {item.mobileLabel}
                </span>
                {activeSection === item.id && (
                  <div className="w-1 h-1 rounded-full bg-blue-600" />
                )}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
};

export default MandanteView;
