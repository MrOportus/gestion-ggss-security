import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { SolicitudTurno } from '../types';
import { MapPin, Clock, AlertCircle, CheckCircle, Calendar, Zap, Layers, ChevronRight } from 'lucide-react';

// ─── Tipos internos ────────────────────────────────────────────────────────────

interface DiaExpandido {
  /** ID único para la key de React */
  key: string;
  /** Fecha de este día específico */
  fecha: Date;
  /** Número de día dentro del período (1-based) */
  diaNumero: number;
  /** Total de días del período */
  totalDias: number;
  /** Hora de entrada (string "HH:mm") */
  horaEntrada: string;
  /** Hora de salida (string "HH:mm") */
  horaSalida: string;
  /** Monto por día */
  monto: number;
  /** Referencia al turno original */
  turno: SolicitudTurno;
}

// ─── Helper: expandir un turno en días individuales ────────────────────────────

function expandirTurno(turno: SolicitudTurno): DiaExpandido[] {
  const inicio = new Date(turno.horario_inicio.split('T')[0] + 'T00:00:00');
  const fin    = new Date(turno.horario_fin.split('T')[0]   + 'T00:00:00');

  const horaEntrada = turno.hora_entrada || turno.horario_inicio.split('T')[1]?.slice(0, 5) || '—';
  const horaSalida  = turno.hora_salida  || turno.horario_fin.split('T')[1]?.slice(0, 5)   || '—';

  const dias: DiaExpandido[] = [];
  const cursor = new Date(inicio);
  let diaNumero = 1;

  while (cursor <= fin) {
    dias.push({
      key: `${turno.id}-${cursor.toISOString().split('T')[0]}`,
      fecha: new Date(cursor),
      diaNumero,
      totalDias: 0, // se rellena abajo
      horaEntrada,
      horaSalida,
      monto: turno.monto,
      turno,
    });
    cursor.setDate(cursor.getDate() + 1);
    diaNumero++;
  }

  // Rellenar totalDias ahora que lo conocemos
  const total = dias.length;
  dias.forEach(d => (d.totalDias = total));

  return dias;
}

// ─── Componente ────────────────────────────────────────────────────────────────

const MyExtraShifts: React.FC = () => {
  const { currentUser } = useAppStore();
  const [turnos, setTurnos] = useState<SolicitudTurno[]>([]);
  const [activeTab, setActiveTab] = useState<'proximos' | 'historial'>('proximos');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser?.uid) return;

    const q = query(
      collection(db, 'solicitudes_turnos'),
      where('id_colaborador_asignado', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: SolicitudTurno[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as SolicitudTurno);
      });
      setTurnos(data);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching my extra shifts:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser?.uid]);

  // ── Expandir todos los turnos en días individuales ──────────────────────────
  const diasExpandidos = useMemo<DiaExpandido[]>(() => {
    const todos = turnos.flatMap(expandirTurno);
    // Ordenar por fecha ascendente
    todos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
    return todos;
  }, [turnos]);

  const now = new Date();
  now.setHours(0, 0, 0, 0); // comparar por día, no por hora exacta

  // Próximos: días de hoy en adelante
  const proximosDias = diasExpandidos.filter(d => {
    const dFecha = new Date(d.fecha);
    dFecha.setHours(0, 0, 0, 0);
    return dFecha >= now;
  });

  // Historial: días anteriores a hoy
  const historialDias = diasExpandidos
    .filter(d => {
      const dFecha = new Date(d.fecha);
      dFecha.setHours(0, 0, 0, 0);
      return dFecha < now;
    })
    .sort((a, b) => b.fecha.getTime() - a.fecha.getTime())
    .slice(0, 30);

  const displayedDias = activeTab === 'proximos' ? proximosDias : historialDias;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 animate-fade-in pb-24">
      {/* Banner */}
      <div className="bg-gradient-to-br from-indigo-600 to-indigo-900 p-8 rounded-[2rem] shadow-xl text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full -mr-24 -mt-24 blur-3xl" />
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/30 rounded-full text-indigo-100 text-xs font-black uppercase tracking-widest mb-3 border border-indigo-400/30">
              <CheckCircle size={14} className="text-emerald-400" />
              Asignaciones Confirmadas
            </div>
            <h1 className="text-3xl font-black tracking-tight">Mis Turnos Extra</h1>
            <p className="text-indigo-100 font-medium mt-2 max-w-md">
              Revisa el detalle día a día de tus turnos adicionales asignados.
            </p>
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
          Próximos ({proximosDias.length})
        </button>
        <button
          onClick={() => setActiveTab('historial')}
          className={`flex-1 py-3 text-sm font-black uppercase tracking-wider rounded-xl transition-all ${
            activeTab === 'historial'
              ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/50'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Historial ({historialDias.length})
        </button>
      </div>

      {/* Content */}
      <div className="space-y-3">
        {loading ? (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-500 font-bold">Cargando tus turnos...</p>
          </div>
        ) : displayedDias.length === 0 ? (
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
          <div className="grid gap-3">
            {displayedDias.map(dia => {
              const isMultiDay = dia.totalDias > 1;
              const isHoy = (() => {
                const d = new Date(dia.fecha);
                d.setHours(0,0,0,0);
                const h = new Date();
                h.setHours(0,0,0,0);
                return d.getTime() === h.getTime();
              })();

              return (
                <div
                  key={dia.key}
                  className={`bg-white rounded-2xl shadow border transition-all duration-300 overflow-hidden ${
                    activeTab === 'proximos'
                      ? isHoy
                        ? 'border-yellow-300 ring-2 ring-yellow-100'
                        : 'border-emerald-200 hover:border-emerald-400'
                      : 'border-slate-100 opacity-70'
                  }`}
                >
                  {/* Cabecera de período multi-día */}
                  {isMultiDay && (
                    <div className={`px-4 py-2 flex items-center gap-2 text-xs font-black ${
                      activeTab === 'proximos' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50 text-slate-400'
                    }`}>
                      <Layers size={12} />
                      <span>Período {dia.diaNumero}/{dia.totalDias}</span>
                      <ChevronRight size={12} className="opacity-40" />
                      <span className="font-medium opacity-70">{dia.turno.sucursal_nombre}</span>
                    </div>
                  )}

                  <div className="p-5 flex flex-col md:flex-row justify-between md:items-center gap-4">
                    {/* Fecha y detalles */}
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2">
                        <MapPin size={18} className={activeTab === 'proximos' ? 'text-indigo-500' : 'text-slate-400'} />
                        <h3 className="text-lg font-black text-slate-800">{dia.turno.sucursal_nombre}</h3>
                        {isHoy && (
                          <span className="ml-1 bg-yellow-100 text-yellow-700 text-[9px] font-black px-2 py-0.5 rounded-full border border-yellow-200 uppercase tracking-wider">
                            HOY
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-sm font-bold text-slate-600">
                        {/* Fecha del día */}
                        <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                          <Calendar size={14} className="text-slate-400" />
                          <span className="capitalize">
                            {dia.fecha.toLocaleDateString('es-CL', {
                              weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
                            })}
                          </span>
                        </div>

                        {/* Horario */}
                        <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                          <Clock size={14} className="text-slate-400" />
                          {dia.horaEntrada} – {dia.horaSalida}
                        </div>
                      </div>

                      {/* Nota del administrador */}
                      {dia.turno.notas && (
                        <div className="mt-1 p-2.5 bg-blue-50/50 rounded-xl border border-blue-100/50 text-xs text-blue-800 font-medium italic">
                          <span className="text-[9px] font-black uppercase text-blue-400 block not-italic mb-0.5">Nota:</span>
                          "{dia.turno.notas}"
                        </div>
                      )}
                    </div>

                    {/* Monto y estado */}
                    <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center gap-3 border-t md:border-t-0 md:border-l border-slate-100 pt-3 md:pt-0 md:pl-5">
                      <div className="text-left md:text-right">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Monto del día</p>
                        <div className="text-2xl font-black text-emerald-500">${dia.monto.toLocaleString()}</div>
                        {isMultiDay && (
                          <p className="text-[9px] font-bold text-indigo-400">
                            Total período: ${(dia.monto * dia.totalDias).toLocaleString()}
                          </p>
                        )}
                      </div>

                      <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-black text-xs border uppercase tracking-wider ${
                        activeTab === 'proximos'
                          ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                          : 'bg-slate-50 text-slate-400 border-slate-200'
                      }`}>
                        <CheckCircle size={14} />
                        {activeTab === 'proximos' ? 'ASIGNADO' : 'REALIZADO'}
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

export default MyExtraShifts;
