import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import ThumbnailImage from '../components/ThumbnailImage';
import RouteMapModal from '../components/RouteMapModal';
import {
    Navigation, Search, MapPin, ExternalLink, Loader2, Camera,
    ShieldCheck, AlertCircle, ShieldAlert, LogOut, RefreshCw,
    LayoutDashboard, BookOpen, FileText, BarChart3, Building2,
    Activity, TrendingUp, Download, ChevronRight, AlertTriangle, Info,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
type MandanteSection = 'estado' | 'novedades' | 'rondas' | 'reportes';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// ─── Subcomponents ────────────────────────────────────────────────────────────
const ResultBadge = ({ result }: { result: string }) => {
    const cfg: Record<string, { bg: string; text: string; ring: string; icon: React.ReactNode; label: string }> = {
        SIN_NOVEDAD: { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-600/20', icon: <ShieldCheck size={10} />, label: 'Sin Novedad' },
        CON_NOVEDAD: { bg: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-600/20', icon: <ShieldAlert size={10} />, label: 'Con Novedad' },
        SOSPECHA: { bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-600/20', icon: <AlertCircle size={10} />, label: 'Sospecha' },
    };
    const c = cfg[result] || { bg: 'bg-slate-50', text: 'text-slate-500', ring: 'ring-slate-200', icon: null, label: result };
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase ring-1 ring-inset ${c.bg} ${c.text} ${c.ring}`}>
            {c.icon}{c.label}
        </span>
    );
};

const KPICard = ({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string }) => (
    <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
        <div className={`absolute inset-0 opacity-0 group-hover:opacity-5 transition-opacity ${color}`} />
        <div className="flex items-start justify-between">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color} text-white shadow-sm`}>{icon}</div>
            <ChevronRight size={16} className="text-slate-300 group-hover:text-slate-400 transition-colors" />
        </div>
        <div className="mt-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
            <p className="text-3xl font-black text-slate-800 mt-1 leading-none">{value}</p>
            {sub && <p className="text-xs text-slate-400 mt-1 font-medium">{sub}</p>}
        </div>
    </div>
);

// ─── Estado del Servicio ──────────────────────────────────────────────────────
const EstadoServicio = ({ allowedSites, guardRounds, novedades, selectedSiteId, setSelectedSiteId, fetchNovedades }: any) => {
    const today = new Date().toISOString().split('T')[0];
    const filteredRounds = guardRounds.filter((r: any) => {
        const inSite = allowedSites.some((s: any) => String(s.id) === String(r.siteId));
        const siteMatch = selectedSiteId === 'all' || String(r.siteId) === selectedSiteId;
        return inSite && siteMatch;
    });
    const todayRounds = filteredRounds.filter((r: any) => r.startTime.startsWith(today));
    const conNovedad = filteredRounds.filter((r: any) => r.result === 'CON_NOVEDAD' || r.result === 'SOSPECHA');
    const lastRound = [...filteredRounds].sort((a: any, b: any) => b.startTime.localeCompare(a.startTime))[0];
    const activeRounds = filteredRounds.filter((r: any) => !r.endTime);
    const filteredNovedades = novedades.filter((n: any) => {
        const inSite = allowedSites.some((s: any) => String(s.id) === String(n.siteId));
        const siteMatch = selectedSiteId === 'all' || String(n.siteId) === selectedSiteId;
        return inSite && siteMatch;
    });
    const todayNovedades = filteredNovedades.filter((n: any) => n.timestamp.startsWith(today));
    const novedadesAlerta = filteredNovedades.filter((n: any) => n.resultado === 'CON_NOVEDAD' || n.resultado === 'SOSPECHA' || n.tipo === 'incidente' || n.tipo === 'alerta');

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h3 className="text-xl font-black text-slate-800">Estado del Servicio</h3>
                    <p className="text-sm text-slate-400 mt-0.5">Resumen ejecutivo actualizado en tiempo real</p>
                </div>
                <div className="flex items-center gap-3">
                    <select value={selectedSiteId} onChange={(e) => setSelectedSiteId(e.target.value)}
                        className="pl-3 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm">
                        <option value="all">Todas mis instalaciones</option>
                        {allowedSites.map((s: any) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                    </select>
                    <button onClick={() => fetchNovedades(allowedSites.map((s: any) => String(s.id)))}
                        className="p-2 bg-white border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50 transition shadow-sm" title="Actualizar">
                        <RefreshCw size={16} />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard icon={<Activity size={20} />} label="Rondas Hoy" value={todayRounds.length}
                    sub={activeRounds.length > 0 ? `${activeRounds.length} en curso` : 'Todas completadas'} color="bg-blue-500" />
                <KPICard icon={<ShieldCheck size={20} />} label="Sin Novedad"
                    value={filteredRounds.filter((r: any) => r.result === 'SIN_NOVEDAD').length} sub="Total historial" color="bg-emerald-500" />
                <KPICard icon={<AlertTriangle size={20} />} label="Con Novedad" value={conNovedad.length} sub="Requieren atención" color="bg-rose-500" />
                <KPICard icon={<BookOpen size={20} />} label="Novedades Hoy" value={todayNovedades.length}
                    sub={`${novedadesAlerta.length} alertas activas`} color="bg-amber-500" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <Navigation size={16} className="text-blue-500" />
                        <h4 className="font-bold text-slate-700 text-sm">Última Ronda Registrada</h4>
                    </div>
                    {lastRound ? (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="font-black text-slate-800">{lastRound.workerName}</p>
                                    <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                                        <MapPin size={10} className="text-blue-400" />{lastRound.siteName}
                                    </p>
                                </div>
                                <ResultBadge result={lastRound.result} />
                            </div>
                            <div className="flex items-center gap-4 pt-3 border-t border-slate-50">
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase">Inicio</p>
                                    <p className="text-sm font-bold text-slate-700">{fmtDateTime(lastRound.startTime)}</p>
                                </div>
                                {lastRound.endTime ? (
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Fin</p>
                                        <p className="text-sm font-bold text-slate-700">{fmtTime(lastRound.endTime)}</p>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-1.5 text-rose-500 text-xs font-bold">
                                        <Loader2 size={12} className="animate-spin" /> En Curso
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-6 text-slate-300">
                            <Navigation size={32} className="mb-2" />
                            <p className="text-sm font-bold">Sin rondas registradas</p>
                        </div>
                    )}
                </div>

                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <Building2 size={16} className="text-indigo-500" />
                        <h4 className="font-bold text-slate-700 text-sm">Mis Instalaciones ({allowedSites.length})</h4>
                    </div>
                    <div className="space-y-2 max-h-44 overflow-y-auto">
                        {allowedSites.length === 0 ? (
                            <p className="text-sm text-slate-400 text-center py-4">Sin instalaciones asignadas</p>
                        ) : allowedSites.map((site: any) => {
                            const siteRoundsToday = todayRounds.filter((r: any) => String(r.siteId) === String(site.id));
                            const hasActive = siteRoundsToday.some((r: any) => !r.endTime);
                            return (
                                <div key={site.id} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 transition">
                                    <div className="flex items-center gap-2.5">
                                        <div className={`w-2 h-2 rounded-full ${hasActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-200'}`} />
                                        <div>
                                            <p className="text-sm font-bold text-slate-700">{site.name}</p>
                                            <p className="text-[10px] text-slate-400">{site.address || 'Sin dirección'}</p>
                                        </div>
                                    </div>
                                    <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                                        {siteRoundsToday.length} rondas hoy
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {todayNovedades.length > 0 && (
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <AlertTriangle size={16} className="text-amber-500" />
                        <h4 className="font-bold text-amber-800 text-sm">Novedades del Día ({todayNovedades.length})</h4>
                    </div>
                    <div className="space-y-2">
                        {todayNovedades.slice(0, 5).map((n: any) => (
                            <div key={n.id} className="bg-white rounded-xl p-3 flex items-start gap-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-2 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-xs font-bold text-slate-700">{n.guardName}</span>
                                        <span className="text-[10px] text-slate-400">·</span>
                                        <span className="text-[10px] text-slate-400">{fmtTime(n.timestamp)}</span>
                                    </div>
                                    <p className="text-xs text-slate-600 mt-0.5 truncate">{n.descripcion}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex items-center justify-end gap-1.5 text-[10px] text-slate-400">
                <Info size={11} />
                Última actualización: {new Date().toLocaleTimeString('es-CL')}
            </div>
        </div>
    );
};

// ─── Libro de Novedades ───────────────────────────────────────────────────────
const LibroNovedades = ({ allowedSites, guardRounds, novedades }: any) => {
    const [startDate, setStartDate] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [tipoFilter, setTipoFilter] = useState('all');
    const [siteFilter, setSiteFilter] = useState('all');

    const timelineItems = useMemo(() => {
        const roundItems = guardRounds
            .filter((r: any) => allowedSites.some((s: any) => String(s.id) === String(r.siteId)))
            .map((r: any) => ({
                id: `ronda_${r.id}`,
                siteId: String(r.siteId),
                sucursalName: r.siteName,
                tipo: 'ronda',
                descripcion: r.notes || 'Ronda completada sin observaciones.',
                guardName: r.workerName,
                timestamp: r.startTime,
                resultado: r.result,
                estado: r.endTime ? 'resuelto' : 'activo',
            }));

        const novedadItems = novedades
            .filter((n: any) => allowedSites.some((s: any) => String(s.id) === String(n.siteId)))
            .map((n: any) => ({ ...n }));

        return [...roundItems, ...novedadItems].sort((a: any, b: any) => b.timestamp.localeCompare(a.timestamp));
    }, [guardRounds, novedades, allowedSites]);

    const filtered = timelineItems.filter((item: any) => {
        const dateStr = item.timestamp.substring(0, 10);
        const matchDate = dateStr >= startDate && dateStr <= endDate;
        const matchTipo = tipoFilter === 'all' || item.tipo === tipoFilter;
        const matchSite = siteFilter === 'all' || item.siteId === siteFilter;
        return matchDate && matchTipo && matchSite;
    });

    const tipoIcon: Record<string, React.ReactNode> = {
        ronda: <Navigation size={13} />, incidente: <AlertTriangle size={13} />,
        alerta: <AlertCircle size={13} />, novedad: <Info size={13} />, otro: <FileText size={13} />,
    };
    const tipoColor: Record<string, string> = {
        ronda: 'bg-blue-100 text-blue-700', incidente: 'bg-rose-100 text-rose-700',
        alerta: 'bg-amber-100 text-amber-700', novedad: 'bg-indigo-100 text-indigo-700', otro: 'bg-slate-100 text-slate-600',
    };

    return (
        <div className="space-y-5">
            <div>
                <h3 className="text-xl font-black text-slate-800">Libro de Novedades</h3>
                <p className="text-sm text-slate-400 mt-0.5">Registro cronológico de rondas y eventos operacionales</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex flex-wrap gap-3 items-end">
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Desde</label>
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Hasta</label>
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Tipo</label>
                    <select value={tipoFilter} onChange={e => setTipoFilter(e.target.value)}
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none">
                        <option value="all">Todos los tipos</option>
                        <option value="ronda">Ronda</option>
                        <option value="incidente">Incidente</option>
                        <option value="alerta">Alerta</option>
                        <option value="novedad">Novedad</option>
                        <option value="otro">Otro</option>
                    </select>
                </div>
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Instalación</label>
                    <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)}
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none">
                        <option value="all">Todas</option>
                        {allowedSites.map((s: any) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                    </select>
                </div>
                <div className="ml-auto text-[10px] font-bold text-slate-400 self-center pt-4">{filtered.length} registros</div>
            </div>

            {filtered.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-16 text-center">
                    <BookOpen size={40} className="text-slate-200 mx-auto mb-3" />
                    <p className="font-bold text-slate-400">Sin registros en el período seleccionado</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {filtered.map((item: any, idx: number) => {
                        const prevDate = idx > 0 ? filtered[idx - 1].timestamp.substring(0, 10) : null;
                        const currDate = item.timestamp.substring(0, 10);
                        const showSep = prevDate !== currDate;
                        const dotColor = item.resultado === 'SIN_NOVEDAD' ? 'bg-emerald-400 border-emerald-300'
                            : (item.resultado === 'CON_NOVEDAD' || item.tipo === 'incidente') ? 'bg-rose-400 border-rose-300'
                            : item.tipo === 'alerta' ? 'bg-amber-400 border-amber-300' : 'bg-blue-400 border-blue-300';
                        return (
                            <React.Fragment key={item.id}>
                                {showSep && (
                                    <div className="flex items-center gap-3 py-2">
                                        <div className="flex-1 h-px bg-slate-100" />
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                            {new Date(currDate + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: '2-digit', month: 'long' })}
                                        </span>
                                        <div className="flex-1 h-px bg-slate-100" />
                                    </div>
                                )}
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 hover:shadow-md transition-all flex items-start gap-4">
                                    <div className="text-right shrink-0 w-14">
                                        <p className="text-sm font-black text-slate-800">{fmtTime(item.timestamp)}</p>
                                    </div>
                                    <div className="flex flex-col items-center shrink-0 pt-1.5">
                                        <div className={`w-3 h-3 rounded-full border-2 ${dotColor}`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase ${tipoColor[item.tipo] || tipoColor.otro}`}>
                                                {tipoIcon[item.tipo] || tipoIcon.otro}{item.tipo}
                                            </span>
                                            {item.resultado && <ResultBadge result={item.resultado} />}
                                            <span className="text-xs text-slate-400">·</span>
                                            <span className="text-xs font-bold text-slate-600">{item.guardName}</span>
                                            <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                                <MapPin size={9} />{item.sucursalName}
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-600 mt-1 leading-relaxed">{item.descripcion}</p>
                                    </div>
                                </div>
                            </React.Fragment>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// ─── Registro de Rondas ───────────────────────────────────────────────────────
const RegistroRondas = ({ allowedSites, guardRounds, showConfirmation }: any) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [resultFilter, setResultFilter] = useState('all');
    const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; });
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [siteFilter, setSiteFilter] = useState('all');
    const [selectedRound, setSelectedRound] = useState<any | null>(null);

    const filtered = guardRounds.filter((r: any) => {
        const inSite = allowedSites.some((s: any) => String(s.id) === String(r.siteId));
        if (!inSite) return false;
        const matchSearch = r.workerName.toLowerCase().includes(searchTerm.toLowerCase()) || r.siteName.toLowerCase().includes(searchTerm.toLowerCase());
        const matchResult = resultFilter === 'all' || r.result === resultFilter;
        const matchSite = siteFilter === 'all' || String(r.siteId) === siteFilter;
        const roundDate = r.startTime.substring(0, 10);
        const matchDate = roundDate >= startDate && roundDate <= endDate;
        return matchSearch && matchResult && matchSite && matchDate;
    }).sort((a: any, b: any) => b.startTime.localeCompare(a.startTime));

    return (
        <div className="space-y-5">
            <div>
                <h3 className="text-xl font-black text-slate-800">Registro de Rondas</h3>
                <p className="text-sm text-slate-400 mt-0.5">{filtered.length} rondas encontradas</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex flex-wrap gap-3">
                <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="text" placeholder="Buscar guardia o instalación..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                        className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none w-52" />
                </div>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" />
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" />
                <select value={resultFilter} onChange={e => setResultFilter(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="all">Todos los resultados</option>
                    <option value="SIN_NOVEDAD">Sin Novedad</option>
                    <option value="CON_NOVEDAD">Con Novedad</option>
                    <option value="SOSPECHA">Sospecha</option>
                </select>
                <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="all">Todas las instalaciones</option>
                    {allowedSites.map((s: any) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                </select>
            </div>

            {filtered.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-16 text-center">
                    <Navigation size={40} className="text-slate-200 mx-auto mb-3" />
                    <p className="font-bold text-slate-400">No se encontraron rondas</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map((round: any) => {
                        const duration = round.endTime
                            ? Math.floor((new Date(round.endTime).getTime() - new Date(round.startTime).getTime()) / 60000)
                            : null;
                        return (
                            <div key={round.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 hover:shadow-md transition-all group">
                                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                                    <div className="flex items-start gap-3 flex-1 min-w-0">
                                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-400 shrink-0">
                                            <Navigation size={20} />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h4 className="font-black text-slate-800">{round.workerName}</h4>
                                                {round.result && <ResultBadge result={round.result} />}
                                            </div>
                                            <div className="flex items-center gap-1 text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                                                <MapPin size={10} className="text-blue-400" />{round.siteName}
                                            </div>
                                        </div>
                                    </div>
                                    {round.notes && (
                                        <div className="flex-1 bg-amber-50 border border-amber-100 rounded-xl p-3">
                                            <p className="text-[9px] font-black text-amber-700 uppercase mb-1">Nota de Ronda</p>
                                            <p className="text-xs text-amber-900 font-medium leading-relaxed">
                                                "{round.notes.length > 100 ? round.notes.substring(0, 100) + '...' : round.notes}"
                                                {round.notes.length > 100 && (
                                                    <button onClick={() => showConfirmation({ title: 'Nota Completa', message: round.notes, type: 'alert', onConfirm: () => {} })}
                                                        className="ml-1 text-amber-700 underline">Ver más</button>
                                                )}
                                            </p>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-6 shrink-0">
                                        <div>
                                            <p className="text-[10px] font-black text-slate-400 uppercase">Inicio</p>
                                            <p className="font-bold text-slate-700 text-sm">{fmtTime(round.startTime)}</p>
                                            <p className="text-[10px] text-slate-400">{fmtDate(round.startTime)}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-black text-slate-400 uppercase">Fin</p>
                                            {round.endTime ? (
                                                <div>
                                                    <p className="font-bold text-slate-700 text-sm">{fmtTime(round.endTime)}</p>
                                                    <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">{duration} min</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1 text-rose-500 text-xs font-bold">
                                                    <Loader2 size={12} className="animate-spin" /> En Curso
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="text-right">
                                                <p className="text-[10px] font-black text-slate-300 uppercase">GPS</p>
                                                <p className="font-black text-slate-700">{round.path?.length || 0}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[10px] font-black text-slate-300 uppercase">Fotos</p>
                                                <p className={`font-black ${(round.evidences?.length || 0) > 0 ? 'text-amber-500' : 'text-slate-300'}`}>
                                                    {round.evidences?.length || 0}
                                                </p>
                                            </div>
                                        </div>
                                        <button onClick={() => setSelectedRound(round)}
                                            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wide transition-all active:scale-95 shadow-sm">
                                            <ExternalLink size={13} /> Recorrido
                                        </button>
                                    </div>
                                </div>
                                {round.evidences && round.evidences.length > 0 && (
                                    <div className="mt-4 pt-4 border-t border-slate-50 flex gap-2 overflow-x-auto">
                                        {round.evidences.slice(0, 5).map((evi: any, idx: number) => (
                                            <div key={idx} onClick={() => setSelectedRound(round)} className="shrink-0 w-14 h-14 rounded-xl border border-slate-100 overflow-hidden cursor-pointer hover:border-blue-300 transition">
                                                <ThumbnailImage photoUrl={evi.photoUrl} alt="Evi" width={56} height={56} className="w-full h-full object-cover" />
                                            </div>
                                        ))}
                                        {round.evidences.length > 5 && (
                                            <button onClick={() => setSelectedRound(round)} className="shrink-0 w-14 h-14 rounded-xl bg-slate-50 border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400 text-xs font-black hover:bg-slate-100 transition">
                                                +{round.evidences.length - 5}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            {selectedRound && <RouteMapModal round={selectedRound} onClose={() => setSelectedRound(null)} />}
        </div>
    );
};

// ─── Reportes ─────────────────────────────────────────────────────────────────
const Reportes = ({ allowedSites }: any) => {
    const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split('T')[0]; });
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [tipoReporte, setTipoReporte] = useState('resumen_ejecutivo');
    const [siteFilter, setSiteFilter] = useState('all');

    return (
        <div className="space-y-5">
            <div>
                <h3 className="text-xl font-black text-slate-800">Reportes</h3>
                <p className="text-sm text-slate-400 mt-0.5">Generación y descarga de informes del servicio</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 max-w-2xl">
                <h4 className="font-bold text-slate-700 mb-5 flex items-center gap-2">
                    <FileText size={16} className="text-blue-500" /> Configurar Reporte
                </h4>
                <div className="space-y-4">
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-2">Instalación</label>
                        <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)}
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none">
                            <option value="all">Todas mis instalaciones</option>
                            {allowedSites.map((s: any) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-2">Desde</label>
                            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-2">Hasta</label>
                            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-2">Tipo de Reporte</label>
                        <div className="grid grid-cols-2 gap-3">
                            {[
                                { id: 'resumen_ejecutivo', label: 'Resumen Ejecutivo', icon: <BarChart3 size={18} />, desc: 'KPIs, estadísticas y resumen del período' },
                                { id: 'libro_novedades', label: 'Libro de Novedades', icon: <BookOpen size={18} />, desc: 'Registro cronológico de todos los eventos' },
                            ].map(opt => (
                                <button key={opt.id} onClick={() => setTipoReporte(opt.id)}
                                    className={`p-4 rounded-xl border-2 text-left transition-all ${tipoReporte === opt.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}>
                                    <div className={`mb-2 ${tipoReporte === opt.id ? 'text-blue-600' : 'text-slate-400'}`}>{opt.icon}</div>
                                    <p className={`text-sm font-black ${tipoReporte === opt.id ? 'text-blue-700' : 'text-slate-700'}`}>{opt.label}</p>
                                    <p className="text-[11px] text-slate-400 mt-0.5">{opt.desc}</p>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="mt-6 pt-5 border-t border-slate-100">
                    <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-100 rounded-xl mb-4">
                        <Info size={14} className="text-amber-500 shrink-0" />
                        <p className="text-xs text-amber-700">La descarga de PDF estará disponible en la próxima versión.</p>
                    </div>
                    <button disabled className="w-full flex items-center justify-center gap-3 py-3.5 bg-slate-200 text-slate-400 rounded-xl font-black text-sm uppercase tracking-widest cursor-not-allowed">
                        <Download size={18} /> Descargar PDF (Próximamente)
                    </button>
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
                {[
                    { label: 'KPIs Mensuales', icon: <TrendingUp size={20} /> },
                    { label: 'Evidencias Fotográficas', icon: <Camera size={20} /> },
                    { label: 'Comparativas', icon: <BarChart3 size={20} /> },
                ].map(f => (
                    <div key={f.label} className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-4 text-center opacity-60">
                        <div className="text-slate-300 flex justify-center mb-2">{f.icon}</div>
                        <p className="text-xs font-bold text-slate-500">{f.label}</p>
                        <span className="text-[10px] bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full font-bold">Próximamente</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ─── Main Component ───────────────────────────────────────────────────────────
const MandanteView: React.FC = () => {
    const { guardRounds, sites, currentUser, employees, logout, fetchInitialData, showConfirmation, novedades, fetchNovedades } = useAppStore();
    const [activeSection, setActiveSection] = useState<MandanteSection>('estado');
    const [selectedSiteId, setSelectedSiteId] = useState<string>('all');

    const currentEmp = employees.find(e => e.id === currentUser?.uid);
    const assignedSites = (currentEmp?.assignedSites || []).map(id => String(id));
    const allowedSites = sites.filter(s => assignedSites.includes(String(s.id)));
    const assignedKey = assignedSites.join(',');

    useEffect(() => {
        if (assignedSites.length > 0) {
            fetchNovedades(assignedSites);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [assignedKey]);

    const navItems: { id: MandanteSection; label: string; icon: React.ReactNode }[] = [
        { id: 'estado', label: 'Estado del Servicio', icon: <LayoutDashboard size={18} /> },
        { id: 'novedades', label: 'Libro de Novedades', icon: <BookOpen size={18} /> },
        { id: 'rondas', label: 'Registro de Rondas', icon: <Navigation size={18} /> },
        { id: 'reportes', label: 'Reportes', icon: <FileText size={18} /> },
    ];

    const handleRefresh = () => {
        fetchInitialData(true);
        if (assignedSites.length > 0) fetchNovedades(assignedSites);
    };

    return (
        <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
            {/* Sidebar Desktop */}
            <aside className="hidden lg:flex flex-col w-64 bg-slate-900 text-white shrink-0">
                <div className="px-6 py-6 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-blue-500 rounded-xl flex items-center justify-center shadow-lg">
                            <ShieldCheck size={20} />
                        </div>
                        <div>
                            <p className="font-black text-sm leading-none">GGSS Security</p>
                            <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-widest">Portal Cliente</p>
                        </div>
                    </div>
                </div>
                <div className="px-4 py-4 border-b border-slate-800">
                    <div className="bg-slate-800 rounded-xl p-3">
                        <p className="text-[10px] text-slate-400 uppercase font-bold">Sesión activa</p>
                        <p className="text-xs font-bold text-slate-200 truncate mt-0.5">{currentEmp?.firstName} {currentEmp?.lastNamePaterno}</p>
                        <p className="text-[10px] text-slate-500 truncate">{currentUser?.email}</p>
                    </div>
                </div>
                <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest px-3 mb-2">Módulos</p>
                    {navItems.map(item => (
                        <button key={item.id} onClick={() => setActiveSection(item.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${activeSection === item.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
                            {item.icon}{item.label}
                        </button>
                    ))}
                </nav>
                <div className="px-3 py-4 border-t border-slate-800 space-y-1">
                    <button onClick={handleRefresh}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition">
                        <RefreshCw size={16} /> Actualizar Datos
                    </button>
                    <button onClick={() => logout()}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-rose-400 hover:text-rose-300 hover:bg-rose-900/20 transition">
                        <LogOut size={16} /> Cerrar Sesión
                    </button>
                </div>
            </aside>

            {/* Main */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Mobile top bar */}
                <header className="lg:hidden bg-slate-900 text-white px-4 py-3 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 bg-blue-500 rounded-lg flex items-center justify-center">
                            <ShieldCheck size={15} />
                        </div>
                        <p className="font-black text-sm">GGSS Security</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={handleRefresh} className="p-1.5 text-slate-400 hover:text-white transition"><RefreshCw size={16} /></button>
                        <button onClick={() => logout()} className="p-1.5 text-rose-400 hover:text-rose-300 transition"><LogOut size={16} /></button>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto">
                    <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 pb-28 lg:pb-6">
                        {activeSection === 'estado' && (
                            <EstadoServicio allowedSites={allowedSites} guardRounds={guardRounds} novedades={novedades}
                                selectedSiteId={selectedSiteId} setSelectedSiteId={setSelectedSiteId} fetchNovedades={fetchNovedades} />
                        )}
                        {activeSection === 'novedades' && (
                            <LibroNovedades allowedSites={allowedSites} guardRounds={guardRounds} novedades={novedades} />
                        )}
                        {activeSection === 'rondas' && (
                            <RegistroRondas allowedSites={allowedSites} guardRounds={guardRounds} showConfirmation={showConfirmation} />
                        )}
                        {activeSection === 'reportes' && (
                            <Reportes allowedSites={allowedSites} />
                        )}
                    </div>
                </main>

                {/* Mobile bottom nav */}
                <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 shadow-2xl z-40">
                    <div className="flex">
                        {navItems.map(item => (
                            <button key={item.id} onClick={() => setActiveSection(item.id)}
                                className={`flex-1 flex flex-col items-center gap-1 py-2.5 px-1 transition-all ${activeSection === item.id ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
                                {item.icon}
                                <span className="text-[9px] font-bold leading-none text-center">{item.label.split(' ')[0]}</span>
                                {activeSection === item.id && <div className="w-1 h-1 rounded-full bg-blue-600" />}
                            </button>
                        ))}
                    </div>
                </nav>
            </div>
        </div>
    );
};

export default MandanteView;
