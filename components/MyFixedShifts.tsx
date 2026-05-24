import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { DollarSign, MapPin, Clock, AlertCircle, CheckCircle, Calendar, Shield } from 'lucide-react';

interface ProgramacionDoc {
  id?: string;
  employeeId: string;
  siteId: string | number;
  date: string; // YYYY-MM-DD
  status: 'programado' | 'noche' | 'descanso';
}

const MyFixedShifts: React.FC = () => {
  const { currentUser, sites } = useAppStore();
  const [turnos, setTurnos] = useState<ProgramacionDoc[]>([]);
  const [activeTab, setActiveTab] = useState<'proximos' | 'historial'>('proximos');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser?.uid) return;

    // Escuchar la programación planificada de este colaborador
    const q = query(
      collection(db, 'programacion'),
      where('employeeId', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: ProgramacionDoc[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as ProgramacionDoc);
      });

      // Ordenar por fecha del turno (más cercanos primero para próximos, más recientes primero para historial)
      data.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      setTurnos(data);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching my fixed shifts:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser?.uid]);

  // Obtener fecha de hoy formateada localmente YYYY-MM-DD
  const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local format

  // Filtrar próximos vs pasados
  // Consideramos de hoy en adelante como Próximos
  const proximosTurnos = turnos.filter(t => t.date >= todayStr && t.status !== 'descanso');
  const historialTurnos = turnos.filter(t => t.date < todayStr && t.status !== 'descanso');

  // Ordenar historial de más reciente a más antiguo
  historialTurnos.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const displayedTurnos = activeTab === 'proximos' ? proximosTurnos : historialTurnos;

  const getShiftTypeDetails = (status: 'programado' | 'noche' | 'descanso') => {
    switch (status) {
      case 'noche':
        return {
          label: 'TURNO NOCHE',
          color: 'bg-indigo-50 text-indigo-700 border-indigo-100',
          hours: '19:30 - 07:30'
        };
      case 'descanso':
        return {
          label: 'DESCANSO',
          color: 'bg-slate-50 text-slate-500 border-slate-200',
          hours: 'Libre'
        };
      case 'programado':
      default:
        return {
          label: 'TURNO DÍA',
          color: 'bg-blue-50 text-blue-700 border-blue-100',
          hours: '07:30 - 19:30'
        };
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 animate-fade-in pb-24">
      {/* Banner */}
      <div className="bg-gradient-to-br from-blue-700 to-indigo-800 p-8 rounded-[2rem] shadow-xl text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full -mr-24 -mt-24 blur-3xl"></div>
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/30 rounded-full text-blue-100 text-xs font-black uppercase tracking-widest mb-3 border border-blue-400/30">
              <Shield size={14} className="text-yellow-400" />
              Rol de Guardia Principal
            </div>
            <h1 className="text-3xl font-black tracking-tight">Mis Turnos Fijos</h1>
            <p className="text-blue-100 font-medium mt-2 max-w-md">Consulta tu programación planificada asignada por la administración en tu sucursal habitual.</p>
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
              ? 'bg-white text-blue-700 shadow-sm border border-slate-200/50'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Próximos ({proximosTurnos.length})
        </button>
        <button
          onClick={() => setActiveTab('historial')}
          className={`flex-1 py-3 text-sm font-black uppercase tracking-wider rounded-xl transition-all ${
            activeTab === 'historial'
              ? 'bg-white text-blue-700 shadow-sm border border-slate-200/50'
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
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-slate-500 font-bold">Cargando tu programación...</p>
          </div>
        ) : displayedTurnos.length === 0 ? (
          <div className="bg-white p-12 rounded-[2rem] border border-slate-200 text-center space-y-4 shadow-sm">
            <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto text-slate-400 border border-slate-100">
              <Calendar size={28} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">
                {activeTab === 'proximos' ? 'No tienes próximos turnos fijos' : 'No tienes historial de turnos fijos'}
              </h3>
              <p className="text-slate-500 text-sm max-w-sm mx-auto mt-1">
                Comunícate con tu supervisor si consideras que deberías tener turnos planificados en el cuadrante.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {displayedTurnos.map(turno => {
              const sucursal = sites.find(s => s.id.toString() === turno.siteId.toString())?.name || 'Sucursal Principal';
              const details = getShiftTypeDetails(turno.status);
              
              // Formatear la fecha localmente de manera legible
              // date es YYYY-MM-DD
              const dateObj = new Date(turno.date + 'T00:00:00');
              const formattedDate = dateObj.toLocaleDateString('es-CL', {
                weekday: 'long',
                day: '2-digit',
                month: 'long',
                year: 'numeric'
              });

              return (
                <div
                  key={turno.id}
                  className={`bg-white p-6 rounded-3xl shadow-lg border transition-all duration-300 ${
                    activeTab === 'proximos'
                      ? 'border-blue-500/30 hover:border-blue-500'
                      : 'border-slate-100 opacity-75'
                  }`}
                >
                  <div className="flex flex-col md:flex-row justify-between md:items-center gap-6">
                    <div className="space-y-3 flex-1">
                      <div className="flex items-center gap-2">
                        <MapPin size={20} className="text-blue-500" />
                        <h3 className="text-xl font-black text-slate-800">{sucursal}</h3>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-4 text-sm font-bold text-slate-600">
                        <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                          <Clock size={16} className="text-slate-400" />
                          <span className="capitalize">{formattedDate}</span>
                        </div>
                        <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-500">
                          Horario estimado: {details.hours}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center gap-4 border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6 min-w-[150px]">
                      <div className={`px-4 py-2 rounded-xl font-black text-xs border uppercase tracking-wider text-center w-full ${details.color}`}>
                        {details.label}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyFixedShifts;
