import React from 'react';
import {
  X,
  MapPin,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Info,
  Calendar,
  Building,
  User,
  ExternalLink,
  Activity
} from 'lucide-react';
import { AttendanceSessionReadModel } from '../../lib/phase5d2/queries/attendanceReadModels';

interface Props {
  item: AttendanceSessionReadModel;
  onClose: () => void;
  employeeRut?: string;
}

export const ConsolidatedAttendanceDetailModal: React.FC<Props> = ({
  item,
  onClose,
  employeeRut
}) => {
  const formatTime = (isoString?: string | null) => {
    if (!isoString) return '--:--';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoString;
    }
  };

  const formatDateTime = (isoString?: string | null) => {
    if (!isoString) return 'No registrado';
    try {
      const d = new Date(isoString);
      return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    } catch {
      return isoString;
    }
  };

  const getActorBadge = () => {
    const actor = item.closureActor;
    if (actor === 'scheduler') {
      return {
        label: 'Auto-Cierre Scheduler',
        color: 'bg-amber-100 text-amber-800 border-amber-200'
      };
    }
    if (actor === 'admin') {
      return {
        label: 'Cierre por Administrador',
        color: 'bg-purple-100 text-purple-800 border-purple-200'
      };
    }
    if (actor === 'new_entry') {
      return {
        label: 'Auto-Cierre por Nueva Entrada',
        color: 'bg-orange-100 text-orange-800 border-orange-200'
      };
    }
    if (actor === 'worker') {
      return {
        label: 'Marcación de Trabajador (Móvil)',
        color: 'bg-emerald-100 text-emerald-800 border-emerald-200'
      };
    }
    return {
      label: item.closureType || 'Sin cierre',
      color: 'bg-slate-100 text-slate-700 border-slate-200'
    };
  };

  const actorBadge = getActorBadge();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="p-6 bg-slate-50 border-b border-slate-200 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-black shadow-md shadow-blue-200">
              <User size={22} />
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-800">
                {item.employeeName || item.employeeId}
              </h3>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                {employeeRut || 'RUT no disponible'} · {item.jornadaDate}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl transition-all"
            aria-label="Cerrar modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Cuerpo con scroll */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Alertas / Estado de revisión */}
          {item.reviewState === 'pending_review' && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 text-amber-800">
              <AlertTriangle size={20} className="shrink-0 mt-0.5 text-amber-600" />
              <div className="text-xs space-y-1">
                <p className="font-bold">Asistencia con observaciones pendientes de revisión</p>
                {item.reviewReasons && item.reviewReasons.length > 0 && (
                  <ul className="list-disc pl-4 space-y-0.5 text-amber-700">
                    {item.reviewReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Grid de Marcaciones: Ingreso vs Salida */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* INGRESO */}
            <div className="p-4 bg-emerald-50/60 border border-emerald-100 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md">
                  Ingreso
                </span>
                <span className="text-lg font-black text-emerald-900">
                  {formatTime(item.checkInAt)}
                </span>
              </div>
              <div className="text-xs text-slate-600 space-y-1">
                <p className="flex items-center gap-1.5 font-medium">
                  <Clock size={13} className="text-emerald-600" />
                  {formatDateTime(item.checkInAt)}
                </p>
                <div className="pt-2 border-t border-emerald-100/80">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Ubicación GPS Ingreso</p>
                  {item.checkInGps ? (
                    <div className="mt-1 flex items-center justify-between">
                      <span className="font-mono text-slate-700 text-[11px]">
                        {item.checkInGps.lat.toFixed(5)}, {item.checkInGps.lng.toFixed(5)}
                      </span>
                      <a
                        href={`https://www.google.com/maps?q=${item.checkInGps.lat},${item.checkInGps.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 hover:text-emerald-900 underline"
                      >
                        <ExternalLink size={11} /> Ver mapa
                      </a>
                    </div>
                  ) : (
                    <p className="text-slate-400 italic text-[11px] mt-0.5">Ubicación no disponible</p>
                  )}
                </div>
              </div>
            </div>

            {/* SALIDA */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 bg-slate-200 px-2 py-0.5 rounded-md">
                  Salida
                </span>
                <span className="text-lg font-black text-slate-800">
                  {formatTime(item.checkOutAt)}
                </span>
              </div>
              <div className="text-xs text-slate-600 space-y-1">
                <p className="flex items-center gap-1.5 font-medium">
                  <Clock size={13} className="text-slate-500" />
                  {formatDateTime(item.checkOutAt)}
                </p>
                <div className="pt-2 border-t border-slate-200">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Ubicación GPS Salida</p>
                  {item.checkOutGps ? (
                    <div className="mt-1 flex items-center justify-between">
                      <span className="font-mono text-slate-700 text-[11px]">
                        {item.checkOutGps.lat.toFixed(5)}, {item.checkOutGps.lng.toFixed(5)}
                      </span>
                      <a
                        href={`https://www.google.com/maps?q=${item.checkOutGps.lat},${item.checkOutGps.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:text-blue-800 underline"
                      >
                        <ExternalLink size={11} /> Ver mapa
                      </a>
                    </div>
                  ) : item.checkOutGpsUnreliable ? (
                    <div className="mt-1 text-[10px] text-amber-700 bg-amber-50 p-1.5 rounded-lg border border-amber-200">
                      <span>No disponible (coordenada copiada del ingreso por cierre del sistema)</span>
                    </div>
                  ) : (
                    <p className="text-slate-400 italic text-[11px] mt-0.5">Ubicación no disponible</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Resumen Operacional y Cierre */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
            <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-2">
              <Activity size={14} className="text-blue-600" />
              Detalle del Cierre y Duración
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Estado</p>
                <p className="font-bold text-slate-800 capitalize">{item.status === 'closed' ? 'Cerrado' : 'Abierto'}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Duración</p>
                <p className="font-black text-blue-600">
                  {typeof item.workedMinutes === 'number'
                    ? `${Math.floor(item.workedMinutes / 60)}h ${item.workedMinutes % 60}m`
                    : 'No calculable'}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Tipo de Cierre</p>
                <span className={`inline-block px-2.5 py-1 rounded-lg text-[10px] font-black uppercase border mt-0.5 ${actorBadge.color}`}>
                  {actorBadge.label}
                </span>
              </div>
            </div>
            {item.closureReason && (
              <p className="text-xs text-slate-600 italic bg-white p-2.5 rounded-xl border border-slate-200">
                "{item.closureReason}"
              </p>
            )}
          </div>
        </div>

        {/* Pie */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-slate-900 transition-all active:scale-95 shadow-md"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
