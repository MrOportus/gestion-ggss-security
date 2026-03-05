
import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
    Navigation,
    Search,
    Clock,
    MapPin,
    ExternalLink,
    Loader2,
    Calendar,
    Camera,
    ShieldCheck,
    AlertCircle,
    ShieldAlert
} from 'lucide-react';
import RouteMapModal from '../components/RouteMapModal';

const RoundsAdminPage: React.FC = () => {
    const { guardRounds, sites } = useAppStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [dateFilter, setDateFilter] = useState('');
    const [selectedSiteId, setSelectedSiteId] = useState<string | 'all'>('all');
    const [selectedRound, setSelectedRound] = useState<any | null>(null);

    // Filter logic
    const filteredRounds = guardRounds.filter(round => {
        const matchesSearch =
            round.workerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            round.siteName.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesDate = !dateFilter || round.startTime.startsWith(dateFilter);
        const matchesSite = selectedSiteId === 'all' || round.siteId.toString() === selectedSiteId;

        return matchesSearch && matchesDate && matchesSite;
    });

    return (
        <div className="flex flex-col h-full bg-slate-50 min-h-screen relative">
            {/* HEADER */}
            <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-6 sticky top-0 z-30">
                <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div>
                        <h2 className="text-2xl md:text-3xl font-black text-slate-800 tracking-tighter">Monitoreo de Rondas</h2>
                        <p className="text-[10px] md:text-sm text-slate-500 font-bold uppercase tracking-widest mt-1 opacity-70">Seguimiento GPS de vigilancia por sucursal</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex items-center gap-3 w-full lg:w-auto">
                        <div className="relative w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar guardia..."
                                className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none w-full lg:w-48"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>

                        <div className="relative w-full">
                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input
                                type="date"
                                className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none text-slate-700 font-bold w-full"
                                value={dateFilter}
                                onChange={(e) => setDateFilter(e.target.value)}
                            />
                        </div>

                        <select
                            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700 w-full sm:col-span-2 lg:col-span-1 lg:w-auto"
                            value={selectedSiteId}
                            onChange={(e) => setSelectedSiteId(e.target.value)}
                        >
                            <option value="all">Todas las sedes</option>
                            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                </div>
            </header>

            {/* CONTENT */}
            <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full">
                {filteredRounds.length === 0 ? (
                    <div className="bg-white rounded-[2.5rem] p-8 md:p-16 text-center shadow-sm border border-slate-100 mt-10">
                        <Navigation size={48} className="text-slate-200 mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-800">No se encontraron rondas</h3>
                        <p className="text-slate-400">Ajusta los filtros para ver otros resultados.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        {filteredRounds.map((round) => {
                            const duration = round.endTime
                                ? Math.floor((new Date(round.endTime).getTime() - new Date(round.startTime).getTime()) / 60000)
                                : null;

                            return (
                                <div key={round.id} className="bg-white rounded-[2rem] p-5 md:p-6 shadow-sm border border-slate-100 hover:shadow-md transition-all group overflow-hidden">
                                    <div className="flex flex-col lg:flex-row lg:items-center gap-6 flex-1">
                                        {/* Worker Info & Result Tag */}
                                        <div className="flex items-start gap-4 flex-1">
                                            <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 shrink-0 border border-slate-100">
                                                <Navigation size={24} />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <h3 className="font-black text-slate-800 text-base truncate">{round.workerName}</h3>
                                                    {round.result && (
                                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase ring-1 ring-inset ${round.result === 'SIN_NOVEDAD' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' :
                                                                round.result === 'CON_NOVEDAD' ? 'bg-rose-50 text-rose-700 ring-rose-600/20' :
                                                                    'bg-amber-50 text-amber-700 ring-amber-600/20'
                                                            }`}>
                                                            {round.result === 'SIN_NOVEDAD' ? <ShieldCheck size={10} /> :
                                                                round.result === 'CON_NOVEDAD' ? <ShieldAlert size={10} /> :
                                                                    <AlertCircle size={10} />}
                                                            {round.result.replace('_', ' ')}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1.5 text-slate-400 font-bold text-[10px] uppercase tracking-wider mt-0.5">
                                                    <MapPin size={12} className="text-blue-500" />
                                                    {round.siteName}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Time Info */}
                                        <div className="grid grid-cols-2 lg:flex items-center gap-4 sm:gap-8 bg-slate-50/50 p-4 rounded-2xl lg:bg-transparent lg:p-0">
                                            <div className="space-y-1">
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Inicio</p>
                                                <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                                                    <Clock size={14} className="text-slate-300" />
                                                    {new Date(round.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                                <p className="text-[10px] text-slate-400 font-medium">{new Date(round.startTime).toLocaleDateString()}</p>
                                            </div>

                                            <div className="space-y-1">
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fin / Duración</p>
                                                <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                                                    {round.endTime ? (
                                                        <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                                                            <CheckCircle size={14} className="text-emerald-500" />
                                                            <span>{new Date(round.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">
                                                                {duration} min
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-2">
                                                            <Loader2 size={14} className="animate-spin text-rose-500" />
                                                            <span className="text-rose-500 text-xs text-nowrap">En Curso</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex flex-row items-center gap-3 w-full lg:w-auto">
                                            <button
                                                onClick={() => setSelectedRound(round)}
                                                className="flex-1 lg:flex-none inline-flex items-center justify-center gap-2 px-6 py-4 lg:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-blue-100 shrink-0"
                                            >
                                                <ExternalLink size={14} /> Ver Recorrido
                                            </button>

                                            <div className="hidden xl:block h-10 w-px bg-slate-100 mx-2"></div>

                                            <div className="flex gap-6 shrink-0">
                                                <div className="flex flex-col items-end">
                                                    <p className="text-[10px] font-black text-slate-300 uppercase">GPS</p>
                                                    <p className="text-base md:text-lg font-black text-slate-800 leading-none">{(round.path?.length || 0)}</p>
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    <p className="text-[10px] font-black text-slate-300 uppercase">Fotos</p>
                                                    <div className="flex items-center gap-1">
                                                        <Camera size={14} className={(round.evidences?.length || 0) > 0 ? "text-amber-500" : "text-slate-300"} />
                                                        <p className={`text-base md:text-lg font-black leading-none ${(round.evidences?.length || 0) > 0 ? "text-slate-800" : "text-slate-300"}`}>
                                                            {(round.evidences?.length || 0)}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Quick Evidence Preview */}
                                    {round.evidences && round.evidences.length > 0 && (
                                        <div className="mt-4 pt-4 border-t border-slate-50">
                                            <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none">
                                                {round.evidences.map((evi, idx) => (
                                                    <div key={idx} className="shrink-0 group/photo relative cursor-pointer" onClick={() => setSelectedRound(round)}>
                                                        <img
                                                            src={evi.photoUrl}
                                                            alt="Evi"
                                                            className="w-16 h-16 rounded-xl object-cover border-2 border-slate-100 group-hover/photo:border-blue-400 transition-colors"
                                                        />
                                                        <div className="absolute inset-0 bg-blue-600/0 group-hover/photo:bg-blue-600/10 rounded-xl transition-all"></div>
                                                    </div>
                                                ))}
                                                {round.evidences.length > 5 && (
                                                    <button
                                                        onClick={() => setSelectedRound(round)}
                                                        className="shrink-0 w-16 h-16 rounded-xl bg-slate-50 border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors"
                                                    >
                                                        <span className="text-[10px] font-black">+{round.evidences.length - 5}</span>
                                                        <span className="text-[8px] font-bold uppercase">Ver más</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>


            {/* Modal de Mapa */}
            {selectedRound && (
                <RouteMapModal
                    round={selectedRound}
                    onClose={() => setSelectedRound(null)}
                />
            )}
        </div>
    );
};

export default RoundsAdminPage;

const CheckCircle = ({ size, className }: { size: number, className: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
);
