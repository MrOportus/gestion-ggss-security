import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, where, or, onSnapshot } from 'firebase/firestore';
import { esEsquemaNuevo, formatSeguimientoFecha } from '../../lib/novedades/seguimientoService';
import type { RegistroNovedad } from '../../types';
import NovedadSeguimientoModal from './NovedadSeguimientoModal';
import { useAppStore } from '../../store/useAppStore';
import { Search, MapPin, AlertCircle, Clock, CheckCircle2, MessageCircle, FileText, ChevronRight, RefreshCw } from 'lucide-react';
import { normalizeText } from '../../lib/textUtils';

const PRIORIDAD_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  informativa: { label: 'Informativa', color: 'text-blue-700', bg: 'bg-blue-50' },
  media:       { label: 'Media',       color: 'text-yellow-700', bg: 'bg-yellow-50' },
  alta:        { label: 'Alta',        color: 'text-orange-700', bg: 'bg-orange-50' },
  critica:     { label: 'Crítica',     color: 'text-red-700', bg: 'bg-red-50' },
};

export const AdminNovedadesSeguimiento: React.FC = () => {
  const { sites, currentUser, employees } = useAppStore();
  const [pendientes, setPendientes] = useState<RegistroNovedad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [siteFilter, setSiteFilter] = useState('all');
  const [prioridadFilter, setPrioridadFilter] = useState('all');
  const [estadoFilter, setEstadoFilter] = useState('activos');
  const [searchText, setSearchText] = useState('');

  // Modal de seguimiento
  const [novedadAbierta, setNovedadAbierta] = useState<RegistroNovedad | null>(null);

  // Obtener nombre del admin
  const adminEmployee = useMemo(() => {
    return employees.find(e => e.id === currentUser?.uid);
  }, [employees, currentUser]);

  const adminUser = useMemo(() => ({
    uid: currentUser?.uid || '',
    nombre: adminEmployee ? `${adminEmployee.firstName} ${adminEmployee.lastNamePaterno}` : 'Administrador',
    rol: currentUser?.role || 'admin'
  }), [currentUser, adminEmployee]);

  // Cargar novedades que requieren seguimiento
  useEffect(() => {
    setLoading(true);
    // Consultamos novedades que requieren seguimiento O que ya fueron resueltas
    const q = query(
      collection(db, 'novedades'),
      or(
        where('requiereSeguimiento', '==', true),
        where('estado', '==', 'resuelta')
      )
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const items: RegistroNovedad[] = [];
      snap.forEach(d => {
        const data = d.data() as Record<string, unknown>;
        if (!esEsquemaNuevo(data)) return;
        items.push({ ...data, id: d.id } as RegistroNovedad);
      });

      // Ordenar en memoria
      items.sort((a, b) => {
        const tsA = a.ultimoSeguimientoEn?.toMillis?.() ?? (a.fechaHoraDispositivo ? new Date(a.fechaHoraDispositivo).getTime() : 0);
        const tsB = b.ultimoSeguimientoEn?.toMillis?.() ?? (b.fechaHoraDispositivo ? new Date(b.fechaHoraDispositivo).getTime() : 0);
        return tsB - tsA;
      });

      setPendientes(items);
      setLoading(false);
      setError(null);
    }, (err) => {
      console.error('Error fetching pendientes:', err);
      setError('Error al cargar las novedades pendientes.');
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Filtrar en memoria
  const filtered = useMemo(() => {
    return pendientes.filter(item => {
      const matchSite = siteFilter === 'all' || String(item.sucursalId) === siteFilter;
      const matchPrioridad = prioridadFilter === 'all' || item.prioridad === prioridadFilter;
      const matchEstado = estadoFilter === 'all'
        ? true
        : estadoFilter === 'activos'
          ? (item.estado === 'registrada' || item.estado === 'en_revision')
          : item.estado === estadoFilter;
      
      const q = normalizeText(searchText);
      const matchSearch = !q || [
        item.descripcion,
        item.sucursalNombre,
        item.autorNombre,
        item.ultimoSeguimientoMsg
      ].some(v => v && normalizeText(v.toString()).includes(q));

      return matchSite && matchPrioridad && matchEstado && matchSearch;
    });
  }, [pendientes, siteFilter, prioridadFilter, estadoFilter, searchText]);

  const handleCerrarModal = () => {
    setNovedadAbierta(null);
  };

  return (
    <div className="space-y-4">
      {/* Panel de Filtros */}
      <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por descripción, sucursal, guardia o nota..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            className="w-full pl-9 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
          />
        </div>
        
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[150px]">
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Sucursal</label>
            <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="all">Todas las sucursales</option>
              {sites.filter(s => s.active !== false).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          
          <div className="w-32">
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Prioridad</label>
            <select value={prioridadFilter} onChange={e => setPrioridadFilter(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="all">Todas</option>
              <option value="informativa">Informativa</option>
              <option value="media">Media</option>
              <option value="alta">Alta</option>
              <option value="critica">Crítica</option>
            </select>
          </div>

          <div className="w-36">
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Estado</label>
            <select value={estadoFilter} onChange={e => setEstadoFilter(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="activos">Todos (activos)</option>
              <option value="all">Historial completo</option>
              <option value="registrada">Registrada</option>
              <option value="en_revision">En revisión</option>
              <option value="resuelta">Resuelta</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stats/Header */}
      <div className="flex items-center justify-between px-2">
        <h4 className="text-sm font-black text-slate-700 uppercase tracking-widest">
          {filtered.length} novedades pendientes
        </h4>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-10"><div className="animate-spin text-blue-500"><RefreshCw size={24} /></div></div>
      ) : error ? (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm font-bold text-center border border-red-200">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-emerald-50 text-emerald-700 p-10 rounded-2xl border border-emerald-100 flex flex-col items-center justify-center gap-3">
          <CheckCircle2 size={40} className="text-emerald-500" />
          <div className="text-center">
            <p className="font-black text-lg">Todo al día</p>
            <p className="text-sm font-medium mt-1 text-emerald-600">No hay novedades que requieran seguimiento con estos filtros.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(nov => {
            const prio = PRIORIDAD_BADGE[nov.prioridad] ?? PRIORIDAD_BADGE.informativa;
            const count = nov.cantidadSeguimientos ?? 0;
            const ultimaFecha = nov.ultimoSeguimientoEn 
              ? formatSeguimientoFecha(nov.ultimoSeguimientoEn) 
              : nov.fechaHoraDispositivo 
                ? formatSeguimientoFecha(nov.fechaHoraDispositivo) 
                : 'No registrado';
            const catLabel = nov.categoria?.replace('_', ' ') || 'No registrado';

            return (
              <button
                key={nov.id}
                onClick={() => setNovedadAbierta(nov)}
                className="text-left bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-blue-300 transition-all active:scale-[0.99] flex flex-col h-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest ${prio.bg} ${prio.color}`}>
                    {prio.label}
                  </span>
                  <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest 
                    ${nov.estado === 'resuelta' 
                      ? 'bg-emerald-100 text-emerald-700' 
                      : nov.estado === 'en_revision' 
                        ? 'bg-amber-100 text-amber-700' 
                        : 'bg-blue-100 text-blue-700'}`}>
                    {nov.estado === 'resuelta' 
                      ? 'Resuelta' 
                      : nov.estado === 'en_revision' 
                        ? 'En revisión' 
                        : 'Registrada'}
                  </span>
                </div>

                <div className="flex-1 mb-4">
                  <p className="text-[10px] font-bold text-slate-400 flex items-center gap-1 mb-1 truncate uppercase tracking-wider">
                    <MapPin size={10} /> {nov.sucursalNombre || 'No registrado'}
                  </p>
                  <p className="font-bold text-slate-800 text-sm leading-snug line-clamp-2">
                    {nov.descripcion}
                  </p>
                  <p className="text-[10px] text-slate-500 font-medium mt-2 capitalize">
                    {nov.tipoRegistro} • {catLabel}
                  </p>
                </div>

                <div className="bg-slate-50 rounded-xl p-3 mb-3 border border-slate-100">
                  <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Último movimiento</p>
                  {nov.ultimoSeguimientoMsg ? (
                    <>
                      <p className="text-xs text-slate-600 font-medium line-clamp-2 italic">"{nov.ultimoSeguimientoMsg}"</p>
                      <p className="text-[10px] text-slate-400 font-bold mt-1">— {nov.ultimoSeguimientoPor || 'No registrado'}</p>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400 italic">Esperando gestión...</p>
                  )}
                </div>

                <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-3">
                    {count > 0 && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                        <MessageCircle size={12} /> {count}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                      <Clock size={12} /> {ultimaFecha}
                    </span>
                  </div>
                  <span className="text-blue-600 bg-blue-50 p-1.5 rounded-lg flex items-center justify-center">
                    <ChevronRight size={14} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {novedadAbierta && (
        <NovedadSeguimientoModal
          novedad={novedadAbierta}
          usuario={adminUser}
          onClose={handleCerrarModal}
        />
      )}
    </div>
  );
};
