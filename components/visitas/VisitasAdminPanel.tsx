import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  ClipboardCheck,
  Filter,
  Loader2,
  MessageSquareText,
  RefreshCw,
  AlertTriangle,
  UserCheck,
  Users,
  Camera,
  CloudOff,
  ChevronRight,
  X,
  CheckCircle2,
  Pin,
  Search,
  CheckCircle,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { VisitaSupervisorDoc } from '../../lib/visitasSupervisor/visitasTypes';
import {
  FILTROS_VACIOS,
  FiltrosVisitas,
  filtrosInicialesVisitas,
  calcularEstadisticas,
  filtrarVisitas,
  fotosPendientes,
} from '../../lib/visitasSupervisor/visitasLogic';
import {
  contarReportesTotales,
  subscribeVisitasAdmin,
  VISITAS_COLLECTION,
} from '../../lib/visitasSupervisor/visitasService';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { ResultadoBadge, formatearFecha, formatearHora } from './visitasUi';
import VisitaDetalleModal from './VisitaDetalleModal';

const selectClass =
  'w-full rounded-xl border-2 border-slate-300 focus:border-blue-600 focus:outline-none bg-white px-3 py-2 text-sm font-semibold text-slate-900 transition-colors';

interface StatProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone: string;
  subtext?: React.ReactNode;
  badge?: React.ReactNode;
}

const Stat: React.FC<StatProps> = ({ icon, label, value, tone, subtext, badge }) => (
  <div className="bg-white border-2 border-slate-200 rounded-2xl p-4 flex items-center gap-3.5 shadow-sm hover:border-slate-300 transition-all">
    <div className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center ${tone}`}>{icon}</div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-1">
        <p className="text-2xl lg:text-3xl font-black text-slate-900 leading-none truncate">{value}</p>
        {badge}
      </div>
      <p className="text-xs lg:text-sm font-bold text-slate-600 mt-1 leading-tight">{label}</p>
      {subtext && <p className="text-[11px] font-semibold text-slate-400 mt-0.5 truncate">{subtext}</p>}
    </div>
  </div>
);

const SiNoTag: React.FC<{ si: boolean; label: string }> = ({ si, label }) => (
  <span className={`inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-full border-2 ${si ? 'bg-slate-800 text-white border-slate-900' : 'bg-slate-100 text-slate-600 border-slate-300'}`}>
    {label}: {si ? 'Sí' : 'No'}
  </span>
);

const VisitasAdminPanel: React.FC = () => {
  const sites = useAppStore(s => s.sites);
  const employees = useAppStore(s => s.employees);

  const [visitas, setVisitas] = useState<VisitaSupervisorDoc[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalHistorico, setTotalHistorico] = useState<number | null>(null);
  // Inicialmente siempre en los últimos 15 días
  const [filtros, setFiltros] = useState<FiltrosVisitas>(() => filtrosInicialesVisitas());
  // Cargar desde ventana amplia inicial (2024-01-01) para tener el historial completo disponible
  const [desdeCargado, setDesdeCargado] = useState<string>('2024-01-01');
  const [detalle, setDetalle] = useState<{ visita: VisitaSupervisorDoc; openSeguimiento: boolean } | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const cargar = useCallback(async (desde: string) => {
    setCargando(true);
    setError(null);
    try {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      unsubscribeRef.current = subscribeVisitasAdmin(desde, (data) => {
        setVisitas(data);
        setCargando(false);
      });
      const total = await contarReportesTotales();
      setDesdeCargado(desde);
      setTotalHistorico(total);
    } catch (e: any) {
      console.error('[Visitas] Error cargando visitas:', e);
      setError('No se pudieron cargar las visitas. Revise su conexión e intente de nuevo.');
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, []);

  useEffect(() => {
    cargar(desdeCargado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si el filtro "Desde" es anterior a lo ya cargado, ampliar la consulta
  useEffect(() => {
    if (filtros.desde && filtros.desde < desdeCargado) cargar(filtros.desde);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros.desde]);

  // Supervisores disponibles combinando catálogo y visitas registradas
  const supervisores = useMemo(() => {
    const mapa = new Map<string, string>();
    employees
      .filter(e => e.role === 'supervisor')
      .forEach(e => mapa.set(e.id, `${e.firstName} ${e.lastNamePaterno}`.trim()));
    visitas.forEach(v => {
      if (v.supervisorUid && !mapa.has(v.supervisorUid)) {
        mapa.set(v.supervisorUid, v.supervisorNombre);
      }
    });
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [employees, visitas]);

  const sucursales = useMemo(
    () => [...sites].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [sites]
  );

  // Lista filtrada en tiempo real
  const lista = useMemo(() => {
    const filtradas = filtrarVisitas(visitas, filtros);
    return filtradas.sort((a, b) => {
      // 1. Pinned first
      if (a.fijadaPorAdmin && !b.fijadaPorAdmin) return -1;
      if (!a.fijadaPorAdmin && b.fijadaPorAdmin) return 1;

      // 2. Mensajes no leídos de admin
      if (a.noLeidosAdmin && !b.noLeidosAdmin) return -1;
      if (!a.noLeidosAdmin && b.noLeidosAdmin) return 1;

      // 3. Última actividad
      const tsA = a.ultimoSeguimientoEn?.toMillis?.() ?? (a.ultimoSeguimientoEn ? new Date(a.ultimoSeguimientoEn).getTime() : new Date(a.inicioEn).getTime());
      const tsB = b.ultimoSeguimientoEn?.toMillis?.() ?? (b.ultimoSeguimientoEn ? new Date(b.ultimoSeguimientoEn).getTime() : new Date(b.inicioEn).getTime());
      
      return tsB - tsA;
    });
  }, [visitas, filtros]);

  // Estadísticas generales vs Estadísticas de la selección filtrada (100% reactivas)
  const statsGenerales = useMemo(() => calcularEstadisticas(visitas), [visitas]);
  const statsFiltradas = useMemo(() => calcularEstadisticas(lista), [lista]);

  const hayFiltros = useMemo(() => {
    return Boolean(
      filtros.desde ||
      filtros.hasta ||
      filtros.sucursalId ||
      filtros.supervisorUid ||
      filtros.resultado ||
      (filtros.busqueda && filtros.busqueda.trim())
    );
  }, [filtros]);

  const set = <K extends keyof FiltrosVisitas>(k: K, v: FiltrosVisitas[K]) => setFiltros(f => ({ ...f, [k]: v }));

  const togglePin = async (e: React.MouseEvent, v: VisitaSupervisorDoc) => {
    e.stopPropagation();
    try {
      await updateDoc(doc(db, VISITAS_COLLECTION, v.id), {
        fijadaPorAdmin: !v.fijadaPorAdmin
      });
      setVisitas(prev => prev.map(vis => vis.id === v.id ? { ...vis, fijadaPorAdmin: !v.fijadaPorAdmin } : vis));
    } catch (err) {
      console.error('[VisitasAdminPanel] Error al fijar visita:', err);
    }
  };

  const nombreSupervisorSeleccionado = useMemo(() => {
    if (!filtros.supervisorUid) return null;
    return supervisores.find(([id]) => id === filtros.supervisorUid)?.[1] ||
           visitas.find(v => v.supervisorUid === filtros.supervisorUid)?.supervisorNombre ||
           'Supervisor';
  }, [filtros.supervisorUid, supervisores, visitas]);

  const nombreSucursalSeleccionada = useMemo(() => {
    if (!filtros.sucursalId) return null;
    return sucursales.find(s => String(s.id) === filtros.sucursalId)?.name || 'Sucursal';
  }, [filtros.sucursalId, sucursales]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 flex items-center gap-3">
            <ClipboardCheck className="text-blue-600" size={30} aria-hidden /> Visitas de Supervisor
          </h1>
          <p className="text-sm font-semibold text-slate-500">Reportes registrados por los supervisores en terreno.</p>
        </div>
        <button
          onClick={() => cargar(desdeCargado)}
          disabled={cargando}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border-2 border-slate-300 text-slate-700 font-bold hover:bg-slate-50 active:scale-95 disabled:opacity-60 transition-all shadow-sm"
        >
          <RefreshCw size={18} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
        </button>
      </div>

      {/* Mini dashboard 100% reactivo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" id="visitas-dashboard">
        <Stat
          icon={<CalendarDays size={24} />}
          label={
            filtros.supervisorUid
              ? `Visitas de ${nombreSupervisorSeleccionado}`
              : (filtros.desde || filtros.hasta)
                ? 'Visitas en el período'
                : hayFiltros
                  ? 'Visitas filtradas'
                  : 'Visitas este mes'
          }
          value={
            hayFiltros
              ? statsFiltradas.total
              : statsGenerales.visitasMes
          }
          subtext={
            hayFiltros
              ? `${statsFiltradas.total} de ${statsGenerales.total} reportes (${Math.round((statsFiltradas.total / (statsGenerales.total || 1)) * 100)}%)`
              : `${statsGenerales.total} registradas en total`
          }
          tone="bg-blue-100 text-blue-700"
          badge={
            hayFiltros ? (
              <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                Filtro
              </span>
            ) : null
          }
        />

        <Stat
          icon={<ClipboardCheck size={24} />}
          label={hayFiltros ? 'Reportes filtrados' : 'Reportes registrados'}
          value={hayFiltros ? statsFiltradas.total : (totalHistorico ?? statsGenerales.total)}
          subtext={
            hayFiltros
              ? `Mostrando ${statsFiltradas.total} de ${totalHistorico ?? statsGenerales.total}`
              : `Total en base de datos`
          }
          tone="bg-indigo-100 text-indigo-700"
        />

        <Stat
          icon={<UserCheck size={24} />}
          label={
            filtros.supervisorUid
              ? 'Supervisor seleccionado'
              : hayFiltros
                ? 'Supervisores en filtro'
                : 'Supervisores con visitas'
          }
          value={
            filtros.supervisorUid
              ? '1'
              : statsFiltradas.supervisoresConVisitas
          }
          subtext={
            filtros.supervisorUid
              ? `${statsFiltradas.total} visita(s) realizadas`
              : `${statsFiltradas.supervisoresConVisitas} de ${supervisores.length} supervisores`
          }
          tone="bg-emerald-100 text-emerald-700"
        />

        <Stat
          icon={<AlertTriangle size={24} />}
          label={hayFiltros ? 'Novedades en selección' : 'Visitas con novedades'}
          value={statsFiltradas.visitasConNovedad}
          subtext={`${statsFiltradas.visitasConObservacion} con obs · ${statsFiltradas.visitasSinNovedad} sin novedad`}
          tone="bg-red-100 text-red-700"
          badge={
            statsFiltradas.visitasConNovedad > 0 ? (
              <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                Atención
              </span>
            ) : null
          }
        />
      </div>



      {/* Filtros avanzados */}
      <section className="bg-white border-2 border-slate-200 rounded-2xl p-4 space-y-4 shadow-sm" aria-label="Filtros">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-slate-700">
              <Filter size={16} aria-hidden /> Filtros de búsqueda
            </h2>
            {hayFiltros && (
              <span className="text-xs font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                {lista.length} de {visitas.length}
              </span>
            )}
          </div>
          {hayFiltros && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFiltros(filtrosInicialesVisitas())}
                className="inline-flex items-center gap-1 text-xs font-black text-blue-600 hover:text-blue-800 uppercase tracking-wider"
                title="Volver al período por defecto de los últimos 15 días"
              >
                Últimos 15 días
              </button>
              <span className="text-slate-300">·</span>
              <button
                type="button"
                onClick={() => setFiltros(FILTROS_VACIOS)}
                className="inline-flex items-center gap-1 text-xs font-black text-red-600 hover:text-red-800 uppercase tracking-wider"
                title="Quitar todos los filtros y ver todo el historial"
              >
                <X size={14} aria-hidden /> Ver todo el historial
              </button>
            </div>
          )}
        </div>

        {/* Input de búsqueda rápida general */}
        <div className="relative">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Búsqueda rápida por sucursal, supervisor, guardia, motivo o texto de novedad..."
            value={filtros.busqueda || ''}
            onChange={e => set('busqueda', e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border-2 border-slate-200 focus:border-blue-600 focus:outline-none text-sm font-semibold text-slate-800 placeholder-slate-400 bg-slate-50/60 transition-colors"
          />
          {filtros.busqueda && (
            <button
              type="button"
              onClick={() => set('busqueda', '')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Píldoras rápidas de resultado */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs font-black text-slate-500 uppercase mr-1">Resultado:</span>
          <button
            type="button"
            onClick={() => set('resultado', '')}
            className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all ${
              !filtros.resultado
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Todos ({visitas.length})
          </button>
          <button
            type="button"
            onClick={() => set('resultado', filtros.resultado === 'sin_novedades' ? '' : 'sin_novedades')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all ${
              filtros.resultado === 'sin_novedades'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
            }`}
          >
            🟢 Sin novedades ({statsGenerales.visitasSinNovedad})
          </button>
          <button
            type="button"
            onClick={() => set('resultado', filtros.resultado === 'con_observaciones' ? '' : 'con_observaciones')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all ${
              filtros.resultado === 'con_observaciones'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
            }`}
          >
            🟠 Con observaciones ({statsGenerales.visitasConObservacion})
          </button>
          <button
            type="button"
            onClick={() => set('resultado', filtros.resultado === 'con_novedad' ? '' : 'con_novedad')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black uppercase transition-all ${
              filtros.resultado === 'con_novedad'
                ? 'bg-red-600 text-white shadow-sm'
                : 'bg-red-50 text-red-900 border border-red-200 hover:bg-red-100'
            }`}
          >
            🔴 Con novedad relevante ({statsGenerales.visitasConNovedad})
          </button>
        </div>

        {/* Campos detallados */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 pt-1 border-t border-slate-100">
          <label className="space-y-1">
            <span className="text-xs font-black text-slate-600 uppercase">Desde</span>
            <input
              id="filtro-desde"
              type="date"
              value={filtros.desde}
              max={filtros.hasta || undefined}
              onChange={e => set('desde', e.target.value)}
              className={selectClass}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-black text-slate-600 uppercase">Hasta</span>
            <input
              id="filtro-hasta"
              type="date"
              value={filtros.hasta}
              min={filtros.desde || undefined}
              onChange={e => set('hasta', e.target.value)}
              className={selectClass}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-black text-slate-600 uppercase">Sucursal</span>
            <select
              id="filtro-sucursal"
              value={filtros.sucursalId}
              onChange={e => set('sucursalId', e.target.value)}
              className={selectClass}
            >
              <option value="">Todas las sucursales</option>
              {sucursales.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-black text-slate-600 uppercase">Supervisor</span>
            <select
              id="filtro-supervisor"
              value={filtros.supervisorUid}
              onChange={e => set('supervisorUid', e.target.value)}
              className={selectClass}
            >
              <option value="">Todos los supervisores</option>
              {supervisores.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
            </select>
          </label>
          <label className="space-y-1 col-span-2 lg:col-span-1">
            <span className="text-xs font-black text-slate-600 uppercase">Estado</span>
            <select
              id="filtro-resultado"
              value={filtros.resultado}
              onChange={e => set('resultado', e.target.value as FiltrosVisitas['resultado'])}
              className={selectClass}
            >
              <option value="">Todos</option>
              <option value="sin_novedades">🟢 Sin novedades</option>
              <option value="con_observaciones">🟠 Con observaciones</option>
              <option value="con_novedad">🔴 Con novedad relevante</option>
            </select>
          </label>
        </div>

        {/* Resumen de filtros aplicados */}
        {hayFiltros && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100 text-xs">
            <span className="font-bold text-slate-400 mr-1">Filtros activos:</span>
            {filtros.busqueda && (
              <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full font-bold">
                Texto: "{filtros.busqueda}"
                <button type="button" onClick={() => set('busqueda', '')}><X size={12} /></button>
              </span>
            )}
            {filtros.desde && (
              <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full font-bold">
                Desde: {filtros.desde}
                <button type="button" onClick={() => set('desde', '')}><X size={12} /></button>
              </span>
            )}
            {filtros.hasta && (
              <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full font-bold">
                Hasta: {filtros.hasta}
                <button type="button" onClick={() => set('hasta', '')}><X size={12} /></button>
              </span>
            )}
            {filtros.sucursalId && (
              <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full font-bold">
                Sucursal: {nombreSucursalSeleccionada}
                <button type="button" onClick={() => set('sucursalId', '')}><X size={12} /></button>
              </span>
            )}
            {filtros.supervisorUid && (
              <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full font-bold">
                Supervisor: {nombreSupervisorSeleccionado}
                <button type="button" onClick={() => set('supervisorUid', '')}><X size={12} /></button>
              </span>
            )}
            {filtros.resultado && (
              <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full font-bold">
                Resultado: {filtros.resultado}
                <button type="button" onClick={() => set('resultado', '')}><X size={12} /></button>
              </span>
            )}
          </div>
        )}
      </section>

      {/* Listado de visitas */}
      <section aria-label="Listado de visitas" className="space-y-3">
        <div className="flex items-center justify-between text-sm font-bold text-slate-500">
          <p>
            {cargando ? 'Cargando reportes…' : `Mostrando ${lista.length} visita${lista.length === 1 ? '' : 's'}${hayFiltros ? ` (de ${visitas.length} totales)` : ''}`}
          </p>
        </div>

        {error && <div role="alert" className="bg-red-50 border-2 border-red-300 text-red-800 font-bold rounded-2xl p-4">{error}</div>}

        {cargando && visitas.length === 0 && (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-600" size={36} /></div>
        )}

        {!cargando && !error && lista.length === 0 && (
          <div className="bg-white border-2 border-dashed border-slate-300 rounded-2xl p-10 text-center space-y-2">
            <p className="text-lg font-bold text-slate-600">No hay visitas que coincidan con los filtros seleccionados.</p>
            {hayFiltros && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFiltros(filtrosInicialesVisitas())}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 active:scale-95 transition-all shadow-md shadow-blue-600/20"
                >
                  Restablecer a últimos 15 días
                </button>
                <button
                  type="button"
                  onClick={() => setFiltros(FILTROS_VACIOS)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-300 active:scale-95 transition-all"
                >
                  <X size={16} /> Ver todo el historial
                </button>
              </div>
            )}
          </div>
        )}

        {lista.map(v => {
          const pend = fotosPendientes(v);
          const sinSync = pend > 0;
          return (
            <div
              key={v.id}
              className={`w-full bg-white border-2 rounded-2xl flex relative overflow-hidden transition-all ${v.fijadaPorAdmin ? 'border-amber-400 bg-amber-50/30' : 'border-slate-200 hover:border-blue-400 shadow-sm'}`}
            >
              {/* Contenedor principal clickeable (abre detalle) */}
              <button
                type="button"
                onClick={() => setDetalle({ visita: v, openSeguimiento: false })}
                className="flex-1 flex items-center gap-4 p-4 text-left active:scale-[0.99] outline-none w-full"
              >
                <div className="shrink-0 text-center w-20 pt-3">
                  <p className="text-lg font-black text-slate-900 leading-none">{formatearFecha(v.inicioEn).slice(0, 5)}</p>
                  <p className="text-xs font-bold text-slate-500">{formatearFecha(v.inicioEn).slice(6)}</p>
                  <p className="text-base font-black text-blue-700 mt-1">{formatearHora(v.inicioEn)}</p>
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <p className="text-lg font-black text-slate-900 truncate">{v.sucursalNombre}</p>
                    <p className="text-sm font-semibold text-slate-600 flex items-center gap-1"><Users size={14} aria-hidden /> {v.supervisorNombre}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ResultadoBadge resultado={v.resultado} prioridadNovedad={v.novedadRelevante?.prioridad} />
                    <SiNoTag si={!!v.entrevistaMandante?.realizada} label="Mandante" />
                    <SiNoTag si={!!v.novedadRelevante?.hay} label="Novedad" />
                    {v.fotosTotal > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-full border-2 bg-slate-100 text-slate-700 border-slate-300">
                        <Camera size={12} aria-hidden /> {v.fotosTotal - pend}/{v.fotosTotal}
                      </span>
                    )}
                    {sinSync ? (
                      <span className="inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-full border-2 bg-amber-100 text-amber-900 border-amber-300">
                        <CloudOff size={12} aria-hidden /> Fotos pendientes
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-full border-2 bg-emerald-50 text-emerald-800 border-emerald-300">
                        <CheckCircle size={12} aria-hidden /> Sincronizada
                      </span>
                    )}
                    {v.noLeidosAdmin ? (
                      <span className="inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-full border-2 bg-red-100 text-red-700 border-red-300">
                        <MessageSquareText size={12} aria-hidden /> {v.noLeidosAdmin} mensaje(s) nuevo(s)
                      </span>
                    ) : null}
                  </div>
                </div>
                <ChevronRight className="shrink-0 text-slate-400" size={24} aria-hidden />
              </button>

              {/* Botones de acción directos por encima del botón principal */}
              <button 
                type="button"
                onClick={(e) => togglePin(e, v)}
                className={`absolute top-0 left-0 w-8 h-8 rounded-br-xl flex items-center justify-center transition-colors z-20 ${v.fijadaPorAdmin ? 'bg-amber-100 text-amber-600 hover:bg-amber-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'}`}
                title={v.fijadaPorAdmin ? 'Desfijar' : 'Fijar visita'}
              >
                <Pin size={16} className={v.fijadaPorAdmin ? 'fill-amber-600' : ''} />
              </button>

              {v.estado === 'resuelta' && (
                <div className="absolute top-2 right-2 flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 shadow-sm z-20 pointer-events-none">
                  <CheckCircle2 size={14} />
                  <span className="text-[10px] font-black uppercase tracking-wider">Resuelta</span>
                </div>
              )}
              {v.requiereSeguimiento && v.estado !== 'resuelta' && !v.noLeidosAdmin && (
                <button
                  type="button"
                  onClick={() => setDetalle({ visita: v, openSeguimiento: true })}
                  className="absolute top-2 right-2 flex items-center gap-1 text-blue-700 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-full border border-blue-200 shadow-sm z-20 transition-colors active:scale-95 cursor-pointer"
                >
                  <span className="text-[10px] font-black uppercase tracking-wider underline">Ver Seguimiento</span>
                </button>
              )}
            </div>
          );
        })}
      </section>

      {detalle && (() => {
        const viva = visitas.find(x => x.id === detalle.visita.id) ?? detalle.visita;
        return <VisitaDetalleModal visita={viva} openSeguimientoOnInit={detalle.openSeguimiento} onClose={() => setDetalle(null)} />;
      })()}
    </div>
  );
};

export default VisitasAdminPanel;
