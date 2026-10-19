import React, { useState } from 'react';
import {
  MapPin,
  Clock,
  Eye,
  AlertCircle,
  Building,
  UserCheck
} from 'lucide-react';
import { AttendanceSessionReadModel } from '../../lib/phase5d2/queries/attendanceReadModels';
import { ConsolidatedAttendanceDetailModal } from './ConsolidatedAttendanceDetailModal';
import { useAppStore } from '../../store/useAppStore';

interface Props {
  items: AttendanceSessionReadModel[];
  isLoading?: boolean;
}

export const ConsolidatedAttendanceTable: React.FC<Props> = ({ items, isLoading }) => {
  const { employees, sites } = useAppStore();
  const [selectedSession, setSelectedSession] = useState<AttendanceSessionReadModel | null>(null);

  const getEmployeeRut = (employeeId: string) => {
    const emp = employees.find(e => e.id === employeeId);
    return emp?.rut || '';
  };

  const getEmployeePhoto = (employeeId: string) => {
    const emp = employees.find(e => e.id === employeeId);
    return (emp as any)?.photoUrl || (emp as any)?.photo || null;
  };

  const getSiteName = (siteId: string | null) => {
    if (!siteId) return 'Sin sucursal';
    const site = sites.find(s => String(s.id) === String(siteId));
    return site?.name || siteId;
  };

  const formatTime = (isoString?: string | null) => {
    if (!isoString) return '--:--';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '--:--';
    }
  };

  const formatDuration = (workedMinutes?: number | null) => {
    if (typeof workedMinutes !== 'number' || workedMinutes < 0) return '-';
    const hours = Math.floor(workedMinutes / 60);
    const minutes = workedMinutes % 60;
    return `${hours}h ${minutes}m`;
  };

  const renderClosureBadge = (item: AttendanceSessionReadModel) => {
    const actor = item.closureActor;
    if (actor === 'scheduler') {
      return (
        <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 border border-yellow-200 rounded-lg text-[9px] font-black uppercase tracking-tight">
          Automático (Sistema)
        </span>
      );
    }
    if (actor === 'admin') {
      return (
        <span className="px-2 py-0.5 bg-purple-100 text-purple-800 border border-purple-200 rounded-lg text-[9px] font-black uppercase tracking-tight">
          Cierre por Admin
        </span>
      );
    }
    if (actor === 'new_entry') {
      return (
        <span className="px-2 py-0.5 bg-orange-100 text-orange-800 border border-orange-200 rounded-lg text-[9px] font-black uppercase tracking-tight">
          Auto-Nueva Entrada
        </span>
      );
    }
    if (actor === 'worker') {
      return (
        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-[9px] font-black uppercase tracking-tight">
          Trabajador (Móvil)
        </span>
      );
    }
    if (item.closureType === 'manual_correction') {
      return (
        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 border border-blue-200 rounded-lg text-[9px] font-black uppercase tracking-tight">
          Corrección
        </span>
      );
    }
    if (item.status === 'open') {
      return (
        <span className="px-2 py-0.5 bg-slate-100 text-slate-500 border border-slate-200 rounded-lg text-[9px] font-black uppercase tracking-tight">
          Turno en Curso
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-[9px] font-black uppercase tracking-tight">
        {item.closureType || 'Sin dato'}
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className="p-16 text-center bg-white rounded-3xl border border-slate-100 shadow-sm">
        <div className="inline-block animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mb-3" />
        <p className="text-sm font-bold text-slate-500">Cargando asistencias consolidadas...</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-16 text-center bg-white rounded-3xl border border-slate-100 shadow-sm">
        <Clock size={40} className="mx-auto text-slate-300 mb-4" />
        <h4 className="text-lg font-black text-slate-700">No hay asistencias consolidadas</h4>
        <p className="text-xs text-slate-400 mt-1">No se encontraron registros con los filtros seleccionados.</p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-[2rem] shadow-xl border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" data-testid="consolidated-attendance-table">
            <thead>
              <tr className="bg-slate-50/70 border-b border-slate-100">
                <th className="px-5 py-4 text-[10px] font-black uppercase text-slate-400 tracking-wider">Trabajador</th>
                <th className="px-5 py-4 text-[10px] font-black uppercase text-slate-400 tracking-wider">Fecha</th>
                <th className="px-5 py-4 text-[10px] font-black uppercase text-slate-400 tracking-wider">Ingreso</th>
                <th className="px-5 py-4 text-[10px] font-black uppercase text-slate-400 tracking-wider">Salida</th>
                <th className="px-5 py-4 text-[10px] font-black uppercase text-slate-400 tracking-wider text-center">Estado</th>
                <th className="px-5 py-4 text-[10px] font-black uppercase text-slate-400 tracking-wider">Tipo Cierre</th>
                <th className="px-5 py-4 text-[10px] font-black uppercase text-slate-400 tracking-wider text-center">Duración</th>
                <th className="px-5 py-4 text-[10px] font-black uppercase text-slate-400 tracking-wider text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {items.map((session) => {
                const rut = getEmployeeRut(session.employeeId);
                const photo = getEmployeePhoto(session.employeeId);
                const hasInGps = !!session.checkInGps;
                const hasOutGps = !!session.checkOutGps;
                const isOutGpsUnreliable = !!session.checkOutGpsUnreliable;

                return (
                  <tr
                    key={session.id}
                    className="hover:bg-blue-50/30 transition-colors group cursor-pointer"
                    onClick={() => setSelectedSession(session)}
                  >
                    {/* 1. Trabajador */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center font-black text-slate-500 text-xs overflow-hidden border border-slate-200 shrink-0">
                          {photo ? (
                            <img src={photo} className="w-full h-full object-cover" alt="" />
                          ) : (
                            session.employeeName?.[0] || 'U'
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-black text-slate-800 uppercase truncate">
                            {session.employeeName || session.employeeId}
                          </p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            {rut || 'RUT S/I'}
                          </p>
                          <p className="text-[9px] text-blue-600 font-bold truncate">
                            {session.sucursalNombre || getSiteName(session.sucursalId)}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* 2. Fecha */}
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className="font-bold text-slate-700">{session.jornadaDate}</span>
                    </td>

                    {/* 3. Ingreso + GPS */}
                    <td className="px-5 py-4 whitespace-nowrap">
                      <div className="flex flex-col items-start gap-1">
                        <span className="font-black text-slate-800 text-sm">
                          {formatTime(session.checkInAt)}
                        </span>
                        {hasInGps ? (
                          <a
                            href={`https://www.google.com/maps?q=${session.checkInGps!.lat},${session.checkInGps!.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100 hover:bg-emerald-600 hover:text-white transition-all"
                            title={`Lat: ${session.checkInGps!.lat}, Lng: ${session.checkInGps!.lng}`}
                          >
                            <MapPin size={10} /> GPS OK
                          </a>
                        ) : (
                          <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                            GPS N/D
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 4. Salida + GPS */}
                    <td className="px-5 py-4 whitespace-nowrap">
                      <div className="flex flex-col items-start gap-1">
                        <span className="font-black text-slate-800 text-sm">
                          {formatTime(session.checkOutAt)}
                        </span>
                        {hasOutGps ? (
                          <a
                            href={`https://www.google.com/maps?q=${session.checkOutGps!.lat},${session.checkOutGps!.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-[9px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100 hover:bg-blue-600 hover:text-white transition-all"
                            title={`Lat: ${session.checkOutGps!.lat}, Lng: ${session.checkOutGps!.lng}`}
                          >
                            <MapPin size={10} /> GPS OK
                          </a>
                        ) : isOutGpsUnreliable ? (
                          <span
                            className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200"
                            title="Coordenada no disponible (fue copiada de entrada en el cierre del sistema)"
                          >
                            GPS Heredado
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                            GPS N/D
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 5. Estado */}
                    <td className="px-5 py-4 text-center whitespace-nowrap">
                      <span
                        className={`inline-block px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider ${
                          session.status === 'closed'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {session.status === 'closed' ? 'Cerrado' : 'Abierto'}
                      </span>
                    </td>

                    {/* 6. Tipo Cierre */}
                    <td className="px-5 py-4 whitespace-nowrap">
                      {renderClosureBadge(session)}
                    </td>

                    {/* 7. Duración */}
                    <td className="px-5 py-4 text-center whitespace-nowrap">
                      <span className="font-mono font-bold text-slate-700">
                        {formatDuration(session.workedMinutes)}
                      </span>
                    </td>

                    {/* 8. Acción */}
                    <td className="px-5 py-4 text-right whitespace-nowrap">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedSession(session);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-blue-600 text-slate-600 hover:text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all active:scale-95 border border-slate-200 shadow-sm"
                        title="Ver detalle de la asistencia"
                      >
                        <Eye size={13} />
                        Detalle
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedSession && (
        <ConsolidatedAttendanceDetailModal
          item={selectedSession}
          onClose={() => setSelectedSession(null)}
          employeeRut={getEmployeeRut(selectedSession.employeeId)}
        />
      )}
    </>
  );
};
