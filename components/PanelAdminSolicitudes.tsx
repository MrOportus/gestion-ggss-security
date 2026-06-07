import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { normalizeText, matchesEmployeeSearch } from '../lib/textUtils';
import { db } from '../lib/firebase';

import { collection, query, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { SolicitudTurno } from '../types';
import { Calendar, DollarSign, MapPin, Clock, Plus, Trash2, Search, X, Info, Layers } from 'lucide-react';

const PanelAdminSolicitudes: React.FC = () => {
  const { sites, currentUser, employees, showNotification } = useAppStore();
  const [solicitudes, setSolicitudes] = useState<SolicitudTurno[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Form State
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [horaInicio, setHoraInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [horaFin, setHoraFin] = useState('');
  const [monto, setMonto] = useState('');
  const [notas, setNotas] = useState('');
  const [selectedGuards, setSelectedGuards] = useState<string[]>([]);

  // Search State
  const [siteSearch, setSiteSearch] = useState('');
  const [showSiteList, setShowSiteList] = useState(false);
  const siteRef = useRef<HTMLDivElement>(null);

  const [guardSearch, setGuardSearch] = useState('');
  const [showGuardList, setShowGuardList] = useState(false);
  const guardRef = useRef<HTMLDivElement>(null);

  const workers = employees.filter(e => e.role === 'worker');

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (siteRef.current && !siteRef.current.contains(event.target as Node)) setShowSiteList(false);
      if (guardRef.current && !guardRef.current.contains(event.target as Node)) setShowGuardList(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredSites = useMemo(() => {
    const lower = siteSearch.toLowerCase();
    return sites.filter(s => s.name.toLowerCase().includes(lower));
  }, [sites, siteSearch]);

  const filteredGuards = useMemo(() => {
    return workers.filter(w => 
      !selectedGuards.includes(w.id) &&
      matchesEmployeeSearch(guardSearch, w)
    );
  }, [workers, guardSearch, selectedGuards]);

  useEffect(() => {
    const q = query(collection(db, 'solicitudes_turnos'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: SolicitudTurno[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as SolicitudTurno);
      });
      // Sort by turno date descending so multi-day ranges appear grouped
      data.sort((a, b) => new Date(b.horario_inicio).getTime() - new Date(a.horario_inicio).getTime());
      setSolicitudes(data);
    });

    return () => unsubscribe();
  }, []);

  const handleCreateSolicitud = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSiteId || !fechaInicio || !horaInicio || !fechaFin || !horaFin || !monto) {
      showNotification("Por favor, completa todos los campos.", "error");
      return;
    }

    const start = new Date(`${fechaInicio}T00:00:00`);
    const end = new Date(`${fechaFin}T00:00:00`);

    if (end < start) {
      showNotification("La fecha de fin no puede ser anterior a la fecha de inicio.", "error");
      return;
    }

    setIsLoading(true);
    try {
      const sucursal = sites.find(s => s.id.toString() === selectedSiteId);
      const newRef = doc(collection(db, 'solicitudes_turnos'));

      const newSolicitud: SolicitudTurno = {
        id: newRef.id,
        id_sucursal: selectedSiteId,
        sucursal_nombre: sucursal?.name || 'Sucursal Desconocida',
        horario_inicio: `${fechaInicio}T${horaInicio}`,
        horario_fin: `${fechaFin}T${horaFin}`,
        hora_entrada: horaInicio,
        hora_salida: horaFin,
        monto: Number(monto),
        estado: 'disponible',
        guardias_permitidos: selectedGuards,
        notas: notas,
        creado_por: currentUser?.uid || 'admin',
        fecha_creacion: new Date().toISOString()
      };

      await setDoc(newRef, newSolicitud);

      showNotification('Turno publicado correctamente.', 'success');

      // Reset form
      setFechaInicio('');
      setHoraInicio('');
      setFechaFin('');
      setHoraFin('');
      setMonto('');
      setSelectedGuards([]);
      setNotas('');
      setSiteSearch('');
      setSelectedSiteId('');
    } catch (error) {
      console.error("Error creating solicitud:", error);
      showNotification("Hubo un error al crear la oferta de turno.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (sol: SolicitudTurno) => {
    const isCancelada = sol.estado === 'cancelado';
    const confirmMsg = isCancelada 
      ? "¿Deseas eliminar permanentemente esta solicitud de la base de datos?" 
      : sol.estado === 'disponible'
      ? "¿Seguro que deseas cancelar esta solicitud? Los guardias verán el aviso de cancelación durante 24 horas."
      : "¿Seguro que deseas eliminar esta solicitud de la base de datos?";

    if (window.confirm(confirmMsg)) {
      try {
        const solRef = doc(db, 'solicitudes_turnos', sol.id);
        if (sol.estado === 'disponible') {
          await setDoc(solRef, {
            estado: 'cancelado',
            fecha_cancelacion: new Date().toISOString()
          }, { merge: true });
        } else {
          await deleteDoc(solRef);
        }
      } catch (error) {
        console.error("Error handling delete/cancel:", error);
      }
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center justify-between bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div>
          <h1 className="text-2xl font-black text-slate-800 flex items-center gap-3">
            <DollarSign className="text-emerald-500" size={32} />
            OFERTAS DE TURNOS
          </h1>
          <p className="text-slate-500 font-medium">Crea turnos por demanda y permite que los guardias los tomen al instante.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* CREATE FORM */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 lg:col-span-1 h-fit">
          <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
            <Plus className="text-blue-500" />
            Nueva Solicitud
          </h2>
          <form onSubmit={handleCreateSolicitud} className="space-y-4">
            
            <div className="space-y-1 relative" ref={siteRef} style={{ zIndex: showSiteList ? 100 : 1 }}>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Sucursal</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="text"
                  placeholder="Buscar sucursal..."
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold text-slate-700 cursor-pointer"
                  value={siteSearch}
                  onFocus={() => {
                    setSiteSearch('');
                    setShowSiteList(true);
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      if (!siteSearch && selectedSiteId) {
                        const s = sites.find(site => String(site.id) === selectedSiteId);
                        if (s) setSiteSearch(s.name);
                      }
                      setShowSiteList(false);
                    }, 200);
                  }}
                  onClick={() => { setShowSiteList(true); setSiteSearch(''); }}
                  onChange={(e) => { setSiteSearch(e.target.value); setShowSiteList(true); }}
                  required={!selectedSiteId}
                />
              </div>
              {showSiteList && (
                <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-2xl max-h-60 overflow-auto z-[110]">
                  {filteredSites.map(s => (
                    <div
                      key={s.id}
                      className="px-4 py-3 hover:bg-blue-50 cursor-pointer text-sm border-b border-slate-50 font-bold text-slate-700"
                      onClick={() => {
                        setSelectedSiteId(String(s.id));
                        setSiteSearch(s.name);
                        setShowSiteList(false);
                      }}
                    >
                      {s.name}
                    </div>
                  ))}
                  {filteredSites.length === 0 && <div className="p-4 text-xs text-slate-400 italic text-center">No se encontraron resultados</div>}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Desde (Fecha Inicio)</label>
                <input
                  type="date"
                  value={fechaInicio}
                  onChange={(e) => setFechaInicio(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold text-slate-700"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Hora Entrada</label>
                <input
                  type="time"
                  value={horaInicio}
                  onChange={(e) => setHoraInicio(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold text-slate-700"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Hasta (Fecha Fin)</label>
                <input
                  type="date"
                  value={fechaFin}
                  onChange={(e) => setFechaFin(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold text-slate-700"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Hora Salida</label>
                <input
                  type="time"
                  value={horaFin}
                  onChange={(e) => setHoraFin(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold text-slate-700"
                  required
                />
              </div>
            </div>

            {/* Indicador de período a crear */}
            {fechaInicio && fechaFin && (() => {
              const start = new Date(`${fechaInicio}T00:00:00`);
              const end = new Date(`${fechaFin}T00:00:00`);
              if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return null;
              const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
              if (diffDays <= 1) return null;
              const montoTotal = monto ? Number(monto) * diffDays : null;
              return (
                <div className="flex items-start gap-2 p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-700">
                  <Layers size={16} className="text-indigo-500 shrink-0 mt-0.5" />
                  <div className="text-xs font-bold space-y-0.5">
                    <p>Período de <span className="text-indigo-900 font-black">{diffDays} días</span> — se enviará <span className="text-indigo-900 font-black">1 sola notificación</span> al guardia.</p>
                    <p className="text-indigo-400 font-medium">El guardia aceptará el período completo y verá cada día por separado en "Mis Turnos Extra".</p>
                    {montoTotal && <p className="text-emerald-700 font-black">Monto total del período: ${montoTotal.toLocaleString()}</p>}
                  </div>
                </div>
              );
            })()}

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Monto a Pagar ($)</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500" size={18} />
                <input
                  type="number"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="Ej: 35000"
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-emerald-500 outline-none font-black text-slate-800"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Comentario / Nota Adicional (Opcional)</label>
              <textarea
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Ej: Se requiere uniforme de gala, o instrucciones específicas..."
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-medium text-slate-700 min-h-[100px] resize-none"
              />
            </div>

            <div className="space-y-3 pt-4 border-t border-slate-100" ref={guardRef} style={{ position: 'relative', zIndex: showGuardList ? 200 : 1 }}>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex justify-between items-center">
                  <span>Selección de Guardias (Opcional)</span>
                  <span className="text-[10px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">{selectedGuards.length} seleccionados</span>
                </label>
                <p className="text-[10px] text-slate-400 font-bold leading-tight mt-1">Si no seleccionas ninguno, la oferta será visible para TODOS los guardias.</p>
              </div>
              
              {/* Chips de Guardias Seleccionados */}
              {selectedGuards.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {selectedGuards.map(id => {
                    const w = workers.find(w => w.id === id);
                    if (!w) return null;
                    return (
                      <div key={id} className="flex items-center gap-1 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg border border-blue-100 text-xs font-bold animate-in zoom-in duration-200">
                        <span>{w.firstName} {w.lastNamePaterno}</span>
                        <button type="button" onClick={() => setSelectedGuards(prev => prev.filter(gid => gid !== id))} className="text-blue-400 hover:text-blue-600 ml-1 transition-colors">
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="text"
                  placeholder="Buscar y agregar guardias..."
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold text-slate-700 cursor-pointer"
                  value={guardSearch}
                  onFocus={() => setShowGuardList(true)}
                  onChange={(e) => { setGuardSearch(e.target.value); setShowGuardList(true); }}
                  onBlur={() => setTimeout(() => setShowGuardList(false), 150)}
                />
                {showGuardList && (
                  <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-2xl max-h-60 overflow-auto z-[300] mt-1">
                    {filteredGuards.length === 0 ? (
                      <div className="p-4 text-xs text-slate-400 italic text-center">No se encontraron guardias o todos ya fueron seleccionados</div>
                    ) : (
                      filteredGuards.map(w => (
                        <div
                          key={w.id}
                          className="px-4 py-3 hover:bg-blue-50 cursor-pointer border-b border-slate-50 flex items-center justify-between transition-colors select-none"
                          onMouseDown={(e) => {
                            // Prevent document mousedown handler from closing dropdown
                            // and prevent blur from firing before selection is registered
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedGuards(prev => [...prev, w.id]);
                            setGuardSearch('');
                            setShowGuardList(true); // keep open to add more guards
                          }}
                        >
                          <div>
                            <p className="text-sm font-bold text-slate-700">{w.firstName} {w.lastNamePaterno}</p>
                            <p className="text-[10px] text-slate-400 font-mono">{w.rut}</p>
                          </div>
                          <Plus size={16} className="text-blue-500" />
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black uppercase tracking-widest shadow-lg shadow-blue-200 active:scale-95 transition-all mt-4"
            >
              {isLoading ? 'PUBLICANDO...' : 'PUBLICAR OFERTA'}
            </button>
          </form>
        </div>

        {/* LIST OF SOLICITUDES */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 lg:col-span-2 space-y-4">
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Calendar className="text-blue-500" />
            Solicitudes Activas
          </h2>

          {solicitudes.length === 0 ? (
            <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
              <DollarSign className="mx-auto text-slate-300 mb-3" size={48} />
              <p className="text-slate-500 font-bold">No hay solicitudes de turno publicadas.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Header for the "table" - only visible on large screens */}
              <div className="hidden lg:grid grid-cols-12 gap-4 px-5 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                <div className="col-span-3">Sucursal</div>
                <div className="col-span-3">Horario</div>
                <div className="col-span-2 text-right">Monto</div>
                <div className="col-span-3">Estado / Asignado</div>
                <div className="col-span-1 text-center">Acción</div>
              </div>

              {solicitudes.map(sol => (
                <div key={sol.id} className={`p-3 lg:p-4 rounded-xl border transition-all ${sol.estado === 'disponible' ? 'bg-white border-slate-100 hover:border-blue-200 shadow-sm' : 'bg-slate-50/50 border-slate-100 opacity-90'}`}>
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                    {/* Sucursal */}
                    <div className="lg:col-span-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center text-blue-500 shrink-0">
                          <MapPin size={16} />
                        </div>
                        <span className="font-bold text-slate-700 truncate">{sol.sucursal_nombre}</span>
                      </div>
                    </div>

                    {/* Horario — muestra rango multi-día si corresponde */}
                    <div className="lg:col-span-3">
                      {(() => {
                        const inicio = new Date(sol.horario_inicio);
                        const fin = new Date(sol.horario_fin);
                        const mismoDia = inicio.toDateString() === fin.toDateString();
                        const diffMs = fin.setHours(0,0,0,0) - inicio.setHours(0,0,0,0);
                        const dias = Math.round(diffMs / 86400000) + 1;
                        const horaE = sol.hora_entrada || new Date(sol.horario_inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
                        const horaS = sol.hora_salida || new Date(sol.horario_fin).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
                        return (
                          <div className="flex flex-col gap-0.5">
                            {mismoDia ? (
                              <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                                <Calendar size={12} className="text-slate-400" />
                                {new Date(sol.horario_inicio).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                              </span>
                            ) : (
                              <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                                <Layers size={12} className="text-indigo-400" />
                                {new Date(sol.horario_inicio).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })}
                                {' → '}
                                {new Date(sol.horario_fin).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })}
                                <span className="ml-1 bg-indigo-100 text-indigo-600 text-[9px] font-black px-1.5 py-0.5 rounded-full">{dias}d</span>
                              </span>
                            )}
                            <span className="text-[10px] font-medium text-slate-400">{horaE} – {horaS}</span>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Monto — muestra por día y total si es multi-día */}
                    <div className="lg:col-span-2 text-left lg:text-right">
                      {(() => {
                        const inicio = new Date(sol.horario_inicio);
                        const fin = new Date(sol.horario_fin);
                        const diff = Math.round((new Date(sol.horario_fin.split('T')[0]).getTime() - new Date(sol.horario_inicio.split('T')[0]).getTime()) / 86400000) + 1;
                        const multi = diff > 1;
                        return (
                          <div>
                            <div className="text-sm font-black text-emerald-600">${sol.monto.toLocaleString()}<span className="text-[9px] font-bold text-slate-400">/día</span></div>
                            {multi && <div className="text-[9px] font-bold text-indigo-500">${(sol.monto * diff).toLocaleString()} total</div>}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Estado / Asignado */}
                    <div className="lg:col-span-3">
                      <div className="flex items-center gap-2">
                        <div className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${
                          sol.estado === 'disponible' ? 'bg-amber-100 text-amber-600' : 
                          sol.estado === 'cancelado' ? 'bg-rose-100 text-rose-600' : 
                          'bg-emerald-100 text-emerald-600'
                        }`}>
                          {sol.estado === 'disponible' ? 'Pendiente' : 
                           sol.estado === 'cancelado' ? 'Cancelado' : 'Asignado'}
                        </div>
                        {sol.estado === 'asignado' && (
                          <span className="text-xs font-bold text-slate-500 truncate" title={sol.nombre_colaborador_asignado}>
                             {sol.nombre_colaborador_asignado}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Acciones */}
                    <div className="lg:col-span-1 flex justify-end lg:justify-center border-t lg:border-t-0 pt-2 lg:pt-0 border-slate-50">
                      <button
                        onClick={() => handleDelete(sol)}
                        className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                        title={sol.estado === 'cancelado' ? 'Eliminar Permanentemente' : 'Cancelar/Eliminar Solicitud'}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {sol.notas && (
                    <div className="mt-2 text-[10px] text-slate-400 bg-slate-50/50 p-2 rounded-lg border border-slate-100/50 italic flex items-start gap-2">
                      <span className="not-italic font-black text-[9px] uppercase text-slate-300 tracking-tighter">Nota:</span>
                      {sol.notas}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PanelAdminSolicitudes;
