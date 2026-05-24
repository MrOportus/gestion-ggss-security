import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { SolicitudTurno } from '../types';
import { DollarSign, MapPin, Clock, AlertCircle, CheckCircle, Calendar, Zap } from 'lucide-react';

const MyExtraShifts: React.FC = () => {
  const { currentUser } = useAppStore();
  const [turnos, setTurnos] = useState<SolicitudTurno[]>([]);
  const [activeTab, setActiveTab] = useState<'proximos' | 'historial'>('proximos');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser?.uid) return;

    // Escuchar los turnos asignados a este colaborador
    const q = query(
      collection(db, 'solicitudes_turnos'),
      where('id_colaborador_asignado', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: SolicitudTurno[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as SolicitudTurno);
      });

      // Ordenar por fecha del turno (más cercanos primero para próximos, más recientes primero para historial)
      data.sort((a, b) => new Date(a.horario_inicio).getTime() - new Date(b.horario_inicio).getTime());

      setTurnos(data);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching my extra shifts:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser?.uid]);

  const now = new Date();

  // Filtrar próximos vs pasados
  const proximosTurnos = turnos.filter(t => new Date(t.horario_inicio) >= now || new Date(t.horario_fin) >= now);
  const historialTurnos = turnos.filter(t => new Date(t.horario_fin) < now && new Date(t.horario_inicio) < now);

  // Ordenar historial de más reciente a más antiguo
  historialTurnos.sort((a, b) => new Date(b.horario_inicio).getTime() - new Date(a.horario_inicio).getTime());

  const displayedTurnos = activeTab === 'proximos' ? proximosTurnos : historialTurnos;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 animate-fade-in pb-24">
      {/* Banner */}
      <div className="bg-gradient-to-br from-indigo-600 to-indigo-900 p-8 rounded-[2rem] shadow-xl text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full -mr-24 -mt-24 blur-3xl"></div>
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/30 rounded-full text-indigo-100 text-xs font-black uppercase tracking-widest mb-3 border border-indigo-400/30">
              <CheckCircle size={14} className="text-emerald-400" />
              Asignaciones Confirmadas
            </div>
            <h1 className="text-3xl font-black tracking-tight">Mis Turnos Extra</h1>
            <p className="text-indigo-100 font-medium mt-2 max-w-md">Consulta la programación y detalles de los turnos adicionales que tienes asignados.</p>
          </div>
          <div className="w-24 h-24 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-sm border-4 border-white/20">
            <Calendar size={40} className="text-yellow-400" />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
        <button
          onClick={() => setActiveTab('proximos')}
          className={`flex-1 py-3 text-sm font-black uppercase tracking-wider rounded-xl transition-all ${
            activeTab === 'proximos'
              ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/50'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Próximos ({proximosTurnos.length})
        </button>
        <button
          onClick={() => setActiveTab('historial')}
          className={`flex-1 py-3 text-sm font-black uppercase tracking-wider rounded-xl transition-all ${
            activeTab === 'historial'
              ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/50'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Historial ({historialTurnos.length})
        </button>
      </div>

      {/* Content */}
      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-slate-500 font-bold">Cargando tus turnos...</p>
          </div>
        ) : displayedTurnos.length === 0 ? (
          <div className="bg-white p-12 rounded-[2rem] border border-slate-200 text-center space-y-4 shadow-sm">
            <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto text-slate-400 border border-slate-100">
              <Zap size={28} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">
                {activeTab === 'proximos' ? 'No tienes próximos turnos extra' : 'No tienes historial de turnos extra'}
              </h3>
              <p className="text-slate-500 text-sm max-w-sm mx-auto mt-1">
                {activeTab === 'proximos'
                  ? 'Puedes postularte a las ofertas disponibles en el apartado de Solicitudes Turnos Extra.'
                  : 'Los turnos extra que realices y finalicen se registrarán aquí.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {displayedTurnos.map(turno => (
              <div
                key={turno.id}
                className={`bg-white p-6 rounded-3xl shadow-lg border transition-all duration-300 ${
                  activeTab === 'proximos'
                    ? 'border-emerald-500/30 hover:border-emerald-500'
                    : 'border-slate-100 opacity-75'
                }`}
              >
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-6">
                  <div className="space-y-3 flex-1">
                    <div className="flex items-center gap-2">
                      <MapPin size={20} className="text-indigo-500" />
                      <h3 className="text-xl font-black text-slate-800">{turno.sucursal_nombre}</h3>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-4 text-sm font-bold text-slate-600">
                      <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                        <Clock size={16} className="text-slate-400" />
                        {new Date(turno.horario_inicio).toLocaleString('es-CL', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute:'2-digit' })}
                        {' - '}
                        {new Date(turno.horario_fin).toLocaleString('es-CL', { hour: '2-digit', minute:'2-digit' })}
                      </div>
                    </div>

                    {turno.notas && (
                      <div className="mt-2 p-3 bg-blue-50/50 rounded-2xl border border-blue-100/50 text-sm text-blue-800 font-medium italic">
                        <span className="text-[10px] font-black uppercase text-blue-400 block not-italic mb-1">Nota del Administrador:</span>
                        "{turno.notas}"
                      </div>
                    )}
                  </div>

                  <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center gap-4 border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6">
                    <div className="text-left md:text-right">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Monto Líquido</p>
                      <div className="text-3xl font-black text-emerald-500">${turno.monto.toLocaleString()}</div>
                    </div>

                    <div className={`flex items-center gap-2 px-4 py-2 rounded-xl font-black text-xs border uppercase tracking-wider ${
                      activeTab === 'proximos'
                        ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                        : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}>
                      <CheckCircle size={16} />
                      {activeTab === 'proximos' ? 'ASIGNADO' : 'REALIZADO'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyExtraShifts;
