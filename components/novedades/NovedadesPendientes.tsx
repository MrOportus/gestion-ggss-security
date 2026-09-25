/**
 * NovedadesPendientes.tsx
 *
 * Lista las novedades del esquema nuevo (tipoRegistro existente) que
 * tienen requiereSeguimiento=true y estado != 'resuelta' para la
 * sucursal del turno activo del guardia.
 *
 * FASE 4 — solo componentes. No integra cierre de turno ni admin view.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  MessageCircle,
  RefreshCw,
  CheckCircle2,
  Clock,
  ChevronRight,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { esEsquemaNuevo, formatSeguimientoFecha } from '../../lib/novedades/seguimientoService';
import type { RegistroNovedad } from '../../types';
import NovedadSeguimientoModal from './NovedadSeguimientoModal';

// ─── Configuración visual de prioridades ─────────────────────────────────────

const PRIORIDAD_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  informativa: { label: 'Informativa', color: 'text-blue-700',   bg: 'bg-blue-50'   },
  media:       { label: 'Media',       color: 'text-yellow-700', bg: 'bg-yellow-50' },
  alta:        { label: 'Alta',        color: 'text-orange-700', bg: 'bg-orange-50' },
  critica:     { label: 'Critica',     color: 'text-red-700',    bg: 'bg-red-50'    },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface NovedadesPendientesProps {
  sucursalId: string | number | undefined;
  sucursalNombre?: string;
  usuario: {
    uid: string;
    nombre: string;
    rol: string;
  };
  onTodasResueltas?: () => void;
}

// ─── Componente ───────────────────────────────────────────────────────────────

const NovedadesPendientes: React.FC<NovedadesPendientesProps> = ({
  sucursalId,
  sucursalNombre,
  usuario,
  onTodasResueltas,
}) => {
  const [novedades, setNovedades] = useState<RegistroNovedad[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [novedadAbierta, setNovedadAbierta] = useState<RegistroNovedad | null>(null);

  const cargarPendientes = useCallback(async () => {
    if (!sucursalId) { setNovedades([]); return; }
    setLoading(true);
    setError(null);
    try {
      const q = query(
        collection(db, 'novedades'),
        where('sucursalId', '==', sucursalId),
        orderBy('creadoEn', 'desc') // Usa el índice existente
      );
      const snap = await getDocs(q);
      const items: RegistroNovedad[] = [];
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        if (!esEsquemaNuevo(data)) return;
        if (data.requiereSeguimiento !== true) return;
        if (data.estado === 'resuelta') return;
        items.push({ ...data, id: d.id } as RegistroNovedad);
      });
      // Ordenamiento en cliente por ultimoSeguimientoEn (o fecha fallback)
      items.sort((a, b) => {
        const tsA = a.ultimoSeguimientoEn?.toMillis?.() ?? (a.fechaHoraDispositivo ? new Date(a.fechaHoraDispositivo).getTime() : 0);
        const tsB = b.ultimoSeguimientoEn?.toMillis?.() ?? (b.fechaHoraDispositivo ? new Date(b.fechaHoraDispositivo).getTime() : 0);
        return tsB - tsA;
      });
      setNovedades(items);
      if (items.length === 0 && onTodasResueltas) onTodasResueltas();
    } catch (err: any) {
      console.error('[NovedadesPendientes] Error:', err);
      setError('No se pudieron cargar las novedades pendientes.');
    } finally {
      setLoading(false);
    }
  }, [sucursalId, onTodasResueltas]);

  useEffect(() => { cargarPendientes(); }, [cargarPendientes]);

  const handleCerrarModal = (resolto?: boolean) => {
    const idResuelto = novedadAbierta?.id;
    setNovedadAbierta(null);
    if (resolto && idResuelto) {
      setNovedades(prev => prev.filter(n => n.id !== idResuelto));
    } else {
      cargarPendientes();
    }
  };

  if (!sucursalId) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 gap-3 text-slate-400">
        <RefreshCw size={20} className="animate-spin" />
        <span className="text-sm font-bold">Cargando novedades...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-4 mt-3 bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3 items-start">
        <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-bold text-red-700">{error}</p>
          <button onClick={cargarPendientes} className="mt-2 text-xs font-black text-red-600 underline">Reintentar</button>
        </div>
      </div>
    );
  }

  if (novedades.length === 0) {
    return (
      <div className="mx-4 mt-3 bg-emerald-50 border border-emerald-100 rounded-2xl p-5 flex gap-3 items-center">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
          <CheckCircle2 size={20} className="text-emerald-600" />
        </div>
        <div>
          <p className="text-sm font-black text-emerald-800">Sin novedades pendientes</p>
          <p className="text-xs text-emerald-600 font-medium mt-0.5">
            {sucursalNombre ? `Todo al dia en ${sucursalNombre}` : 'Todo al dia en esta sucursal'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="px-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-amber-100 rounded-lg flex items-center justify-center">
              <AlertTriangle size={14} className="text-amber-600" />
            </div>
            <p className="text-[11px] font-black text-slate-600 uppercase tracking-widest">
              Novedades pendientes
            </p>
            <span className="px-2 py-0.5 bg-amber-500 text-white rounded-full text-[10px] font-black">
              {novedades.length}
            </span>
          </div>
          <button onClick={cargarPendientes} disabled={loading} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-all" title="Actualizar">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="space-y-2">
          {novedades.map((nov) => {
            const prio = PRIORIDAD_BADGE[nov.prioridad] ?? PRIORIDAD_BADGE.informativa;
            const count = nov.cantidadSeguimientos ?? 0;
            const ultimaFecha = nov.ultimoSeguimientoEn
              ? formatSeguimientoFecha(nov.ultimoSeguimientoEn)
              : nov.fechaHoraDispositivo
                ? formatSeguimientoFecha(nov.fechaHoraDispositivo)
                : '--';

            return (
              <button
                key={nov.id}
                onClick={() => setNovedadAbierta(nov)}
                className="w-full text-left bg-white border-2 border-amber-100 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-amber-300 active:scale-[0.98] transition-all"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${prio.bg} ${prio.color}`}>
                    {prio.label}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-700">
                    en revision
                  </span>
                </div>

                <p className="font-bold text-slate-800 text-sm leading-snug line-clamp-2 mb-2">
                  {nov.descripcion}
                </p>

                {nov.ultimoSeguimientoMsg && (
                  <div className="bg-slate-50 rounded-xl px-3 py-2 mb-2">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Ultima actualizacion</p>
                    <p className="text-xs text-slate-600 font-medium line-clamp-2">"{nov.ultimoSeguimientoMsg}"</p>
                    {nov.ultimoSeguimientoPor && (
                      <p className="text-[10px] text-slate-400 font-bold mt-0.5">- {nov.ultimoSeguimientoPor}</p>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between mt-1">
                  <div className="flex items-center gap-3">
                    {count > 0 && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                        <MessageCircle size={11} />
                        {count} {count === 1 ? 'actualizacion' : 'actualizaciones'}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                      <Clock size={11} />
                      {ultimaFecha}
                    </span>
                  </div>
                  <span className="flex items-center gap-1 text-[10px] font-black text-blue-600">
                    Ver seguimiento <ChevronRight size={12} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {novedadAbierta && (
        <NovedadSeguimientoModal
          novedad={novedadAbierta}
          usuario={usuario}
          onClose={handleCerrarModal}
        />
      )}
    </>
  );
};

export default NovedadesPendientes;
