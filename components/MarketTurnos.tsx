import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot, doc, runTransaction } from 'firebase/firestore';
import { SolicitudTurno } from '../types';
import { DollarSign, MapPin, Clock, AlertCircle, CheckCircle, Zap } from 'lucide-react';

const MarketTurnos: React.FC = () => {
  const { currentUser, employees, showNotification } = useAppStore();
  const [ofertas, setOfertas] = useState<SolicitudTurno[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState<SolicitudTurno | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Estado para las solicitudes descartadas visualmente por el usuario
  const [dismissedShifts, setDismissedShifts] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('dismissed_shifts') || '[]');
    } catch (e) {
      return [];
    }
  });

  const currentEmployee = employees.find(e => e.id === currentUser?.uid);

  const handleDismissShift = (id: string) => {
    const updated = [...dismissedShifts, id];
    setDismissedShifts(updated);
    localStorage.setItem('dismissed_shifts', JSON.stringify(updated));
    showNotification("Solicitud eliminada de la pantalla.", "info");
  };

  useEffect(() => {
    // Escuchar todas las ofertas
    const q = query(
      collection(db, 'solicitudes_turnos'),
      where('estado', 'in', ['disponible', 'asignado', 'completado', 'cancelado'])
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: SolicitudTurno[] = [];
      const now = new Date();

      snapshot.forEach((doc) => {
        const turno = { id: doc.id, ...doc.data() } as SolicitudTurno;

        // 1. Si está asignado a MÍ, NO mostrar en esta sección (se mostrará en Mis Turnos Extras)
        if (turno.id_colaborador_asignado === currentUser?.uid) {
          return;
        }

        // 2. Si está disponible, mostrar si el guardia está en los permitidos
        if (turno.estado === 'disponible') {
          if (!turno.guardias_permitidos || turno.guardias_permitidos.length === 0 || turno.guardias_permitidos.includes(currentUser?.uid || '')) {
            data.push(turno);
          }
        } 
        // 3. Si no fue seleccionado (asignado o completado a otro compañero)
        else if (turno.estado === 'asignado' || turno.estado === 'completado') {
          const assignDate = turno.fecha_asignacion ? new Date(turno.fecha_asignacion) : new Date(turno.fecha_creacion);
          const hoursDiff = (now.getTime() - assignDate.getTime()) / (1000 * 60 * 60);
          if (hoursDiff <= 2) {
            data.push(turno);
          }
        }
        // 4. Si fue cancelada la solicitud
        else if (turno.estado === 'cancelado') {
          const cancelDate = turno.fecha_cancelacion ? new Date(turno.fecha_cancelacion) : new Date(turno.fecha_creacion);
          const hoursDiff = (now.getTime() - cancelDate.getTime()) / (1000 * 60 * 60);
          if (hoursDiff <= 2) {
            data.push(turno);
          }
        }
      });

      // Ordenar: Disponibles primero, luego por fecha de creación descendente
      data.sort((a, b) => {
        if (a.estado === 'disponible' && b.estado !== 'disponible') return -1;
        if (a.estado !== 'disponible' && b.estado === 'disponible') return 1;
        return new Date(b.fecha_creacion).getTime() - new Date(a.fecha_creacion).getTime();
      });

      setOfertas(data);
    });

    return () => unsubscribe();
  }, [currentUser?.uid]);

  const handleAceptarTurno = async (solicitud: SolicitudTurno) => {
    if (!currentUser || !currentEmployee) return;
    
    setProcessingId(solicitud.id);
    setShowConfirmModal(null);
    
    try {
      const turnoRef = doc(db, 'solicitudes_turnos', solicitud.id);
      
      await runTransaction(db, async (transaction) => {
        const turnoDoc = await transaction.get(turnoRef);
        
        if (!turnoDoc.exists()) {
          throw new Error("El turno ya no existe.");
        }
        
        const data = turnoDoc.data() as SolicitudTurno;
        
        if (data.estado !== 'disponible') {
          throw new Error("Lo sentimos, este turno ya fue tomado por otro compañero.");
        }
        
        // El turno está disponible, lo asignamos atómicamente agregando fecha_asignacion
        transaction.update(turnoRef, {
          estado: 'asignado',
          id_colaborador_asignado: currentUser.uid,
          nombre_colaborador_asignado: `${currentEmployee.firstName} ${currentEmployee.lastNamePaterno}`,
          fecha_asignacion: new Date().toISOString()
        });
      });

      showNotification("¡Felicidades! Fuiste aceptado para este turno.", "success");
      
    } catch (error: any) {
      console.error("Transaction failed: ", error);
      showNotification(error.message || "Error al aceptar el turno.", "error");
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 animate-fade-in pb-24">
      <div className="bg-gradient-to-br from-indigo-600 to-blue-800 p-8 rounded-[2rem] shadow-xl text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full -mr-24 -mt-24 blur-3xl"></div>
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/30 rounded-full text-indigo-100 text-xs font-black uppercase tracking-widest mb-3 border border-indigo-400/30">
              <Zap size={14} className="text-yellow-400" />
              Solicitudes Turnos Extra
            </div>
            <h1 className="text-3xl font-black tracking-tight">Postulación a Turnos</h1>
            <p className="text-indigo-100 font-medium mt-2 max-w-md">Revisa las solicitudes disponibles y postúlate. El primero en confirmar se queda con el turno.</p>
          </div>
          <div className="w-24 h-24 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-sm border-4 border-white/20">
            <DollarSign size={40} className="text-yellow-400" />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="font-black text-slate-800 uppercase tracking-widest text-sm flex items-center gap-2">
          <Clock className="text-blue-500" size={18} />
          Ofertas Disponibles en Tiempo Real
        </h2>

        {ofertas.filter(o => !dismissedShifts.includes(o.id)).length === 0 ? (
          <div className="bg-white p-10 rounded-3xl shadow-sm border border-slate-200 text-center">
            <AlertCircle size={48} className="text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-slate-800">No hay turnos extra por el momento</h3>
            <p className="text-slate-500 mt-2">Mantente atento, las ofertas pueden aparecer en cualquier momento.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {ofertas
              .filter(o => !dismissedShifts.includes(o.id))
              .filter(o => new Date(o.horario_inicio) > currentTime)
              .slice(0, 10)
              .map(oferta => {
                const isProcessing = processingId === oferta.id;
                const isPast = new Date(oferta.horario_inicio) < new Date();
                const isCanceled = oferta.estado === 'cancelado';

                return (
                  <div
                    key={oferta.id}
                    className={`p-6 rounded-3xl shadow-lg border transition-all duration-300 ${
                      isCanceled
                        ? 'bg-rose-500/5 border-rose-200 shadow-none opacity-80'
                        : oferta.estado !== 'disponible'
                        ? 'bg-slate-50/50 border-slate-100 opacity-60 grayscale-[0.3]'
                        : 'bg-white border-slate-100 hover:border-blue-300 hover:shadow-blue-100'
                    }`}
                  >
                    <div className="flex flex-col md:flex-row justify-between md:items-center gap-6">
                      <div className="space-y-3 flex-1">
                        <div className="flex items-center gap-2">
                          <MapPin size={20} className={isCanceled ? "text-rose-400" : "text-blue-500"} />
                          <h3 className={`text-xl font-black ${isCanceled ? 'text-rose-950/80' : 'text-slate-800'}`}>{oferta.sucursal_nombre}</h3>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 text-sm font-bold text-slate-600">
                          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${isCanceled ? 'bg-rose-500/5 border-rose-500/10 text-rose-800/80' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                            <Clock size={16} className={isCanceled ? "text-rose-400/80" : "text-slate-400"} />
                            {new Date(oferta.horario_inicio).toLocaleString('es-CL', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute:'2-digit' })}
                            {' - '}
                            {new Date(oferta.horario_fin).toLocaleString('es-CL', { hour: '2-digit', minute:'2-digit' })}
                          </div>
                        </div>

                        {oferta.notas && (
                          <div className={`mt-2 p-3 rounded-2xl border text-sm font-medium italic ${isCanceled ? 'bg-rose-500/5 border-rose-500/10 text-rose-800/80' : 'bg-blue-50/50 border-blue-100/50 text-blue-800'}`}>
                            <span className={`text-[10px] font-black uppercase block not-italic mb-1 ${isCanceled ? 'text-rose-400/80' : 'text-blue-400'}`}>Nota del Administrador:</span>
                            "{oferta.notas}"
                          </div>
                        )}
                      </div>

                      <div className={`flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center gap-4 border-t md:border-t-0 md:border-l pt-4 md:pt-0 md:pl-6 ${isCanceled ? 'border-rose-500/10' : 'border-slate-100'}`}>
                        <div className="text-left md:text-right">
                          <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${isCanceled ? 'text-rose-400/80' : 'text-slate-400'}`}>Monto Líquido</p>
                          <div className={`text-3xl font-black ${isCanceled ? 'text-rose-500/80' : 'text-emerald-500'}`}>${oferta.monto.toLocaleString()}</div>
                        </div>

                        {oferta.estado === 'disponible' ? (
                          <button
                            onClick={() => setShowConfirmModal(oferta)}
                            disabled={isProcessing}
                            className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg shadow-blue-200 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center min-w-[160px]"
                          >
                            {isProcessing ? 'PROCESANDO...' : 'ACEPTAR TURNO'}
                          </button>
                        ) : (
                          <div className="flex flex-col items-stretch sm:items-end gap-2 w-full min-w-[160px]">
                            <div className={`px-4 py-2 rounded-xl font-black text-[10px] border uppercase tracking-widest text-center ${
                              isCanceled 
                                ? 'bg-rose-50 text-rose-500 border-rose-100' 
                                : 'bg-slate-100 text-slate-400 border-slate-200'
                            }`}>
                              {isCanceled ? 'Solicitud cancelada' : 'No seleccionado'}
                            </div>
                            
                            <button
                              onClick={() => handleDismissShift(oferta.id)}
                              className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 hover:text-slate-700 text-slate-400 border border-slate-200 rounded-xl font-bold text-[9px] uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-1 mx-auto sm:mr-0"
                              title="Limpiar de la pantalla"
                            >
                              Limpiar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl p-8 text-center animate-in zoom-in-95 duration-200">
            <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle size={40} className="text-blue-500" />
            </div>
            <h3 className="text-2xl font-black text-slate-800 leading-tight mb-2">¿Confirmar Turno?</h3>
            <p className="text-slate-500 font-medium mb-8">¿Estás seguro de poder asistir al turno en <span className="text-slate-800 font-bold">{showConfirmModal.sucursal_nombre}</span>?</p>
            
            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleAceptarTurno(showConfirmModal)}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-lg shadow-emerald-100 active:scale-95 transition-all"
              >
                SÍ, CONFIRMAR
              </button>
              <button
                onClick={() => setShowConfirmModal(null)}
                className="w-full py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all"
              >
                CANCELAR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarketTurnos;
