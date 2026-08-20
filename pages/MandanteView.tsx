import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import ThumbnailImage from '../components/ThumbnailImage';
import RouteMapModal from '../components/RouteMapModal';
import {
    Navigation, Search, MapPin, ExternalLink, Loader2, Camera,
    ShieldCheck, AlertCircle, ShieldAlert, LogOut, RefreshCw,
    LayoutDashboard, BookOpen, FileText, BarChart3, Building2,
    Activity, TrendingUp, Download, ChevronRight, AlertTriangle, Info, Users, Clock, Award,
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

const ActiveGuardBanner = ({ attendanceLogs, employees, weekRounds, selectedSiteId, allowedSites, fetchInitialData }: any) => {
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastUpdate, setLastUpdate] = useState(new Date());

    const handleRefresh = async () => {
        setIsRefreshing(true);
        if (fetchInitialData) await fetchInitialData(true);
        setLastUpdate(new Date());
        setIsRefreshing(false);
    };

    const activeGuards = useMemo(() => {
        if (!attendanceLogs) return [];
        const logsByUser: Record<string, any[]> = {};
        attendanceLogs.forEach((log: any) => {
            if (!logsByUser[log.employeeId]) logsByUser[log.employeeId] = [];
            logsByUser[log.employeeId].push(log);
        });

        const active: any[] = [];
        Object.values(logsByUser).forEach(logs => {
            logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            const latest = logs[0];
            
            const isLive = latest.type === 'check_in' && latest.status !== 'completed';
            
            if (isLive) {
                let sid = latest.siteId ? String(latest.siteId) : null;
                // Fallback to employee's current site if log doesn't have it (same as AdminDashboard)
                if (!sid && employees) {
                    const emp = employees.find((e: any) => e.id === latest.employeeId);
                    if (emp && emp.currentSiteId) {
                        sid = String(emp.currentSiteId);
                    }
                }
                
                if (sid) {
                    const isSelected = selectedSiteId === 'all' 
                        ? allowedSites.some((s:any) => String(s.id) === sid)
                        : sid === selectedSiteId;
                    
                    if (isSelected) {
                        const roundsThisWeek = weekRounds.filter((r: any) => (r.workerId || r.workerName) === (latest.employeeId || latest.employeeName) && String(r.siteId) === sid).length;
                        
                        active.push({
                            id: latest.employeeId,
                            name: latest.employeeName,
                            siteName: latest.siteName || allowedSites.find((s:any) => String(s.id) === sid)?.name || 'Instalación',
                            checkInTime: new Date(latest.timestamp).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
                            scheduledEnd: latest.turnoProgramadoTermino || '--:--',
                            roundsThisWeek
                        });
                    }
                }
            }
        });
        
        return active.sort((a, b) => a.name.localeCompare(b.name));
    }, [attendanceLogs, employees, selectedSiteId, allowedSites, weekRounds]);

    const siteName = selectedSiteId === 'all' 
        ? 'Todas mis instalaciones' 
        : allowedSites.find((s:any) => String(s.id) === selectedSiteId)?.name || 'Instalación seleccionada';

    return (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mb-6 relative">
            {isRefreshing && (
                <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center">
                    <div className="flex items-center gap-2 text-blue-600 font-bold bg-white px-4 py-2 rounded-full shadow-lg">
                        <RefreshCw size={16} className="animate-spin" />
                        <span>Consultando estado actual...</span>
                    </div>
                </div>
            )}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 border-b border-slate-100 bg-slate-50/50">
                <div className="flex items-center gap-3">
                    {activeGuards.length > 0 ? (
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100">
                            <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />
                        </div>
                    ) : (
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100">
                            <div className="w-3 h-3 bg-slate-400 rounded-full" />
                        </div>
                    )}
                    <div>
                        <h3 className="font-black text-slate-800 text-lg leading-tight uppercase tracking-tight">
                            {activeGuards.length > 0 ? 'Servicio Operativo' : 'Sin servicio activo'}
                        </h3>
                        <p className="text-xs font-bold text-slate-500 mt-0.5">{siteName}</p>
                    </div>
                </div>
                
                <div className="flex items-center justify-between md:justify-end gap-4 text-xs font-bold text-slate-400">
                    <p>Última actualización: {lastUpdate.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</p>
                    <button onClick={handleRefresh} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors shadow-sm active:scale-95">
                        Actualizar
                    </button>
                </div>
            </div>

            {activeGuards.length > 0 ? (
                <div className="p-5">
                    {activeGuards.length > 1 && (
                        <p className="text-sm font-black text-blue-600 mb-4 bg-blue-50 px-3 py-1.5 rounded-lg inline-block">
                            {activeGuards.length} guardias activos
                        </p>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {activeGuards.map((guard, i) => (
                            <div key={guard.id + i} className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm hover:border-blue-200 transition-colors">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 font-black shrink-0">
                                        {guard.name.substring(0, 2).toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-black text-slate-800 truncate">{guard.name}</p>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Guardia de Seguridad</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-2 bg-slate-50 rounded-lg p-3">
                                    <div>
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Ingreso</p>
                                        <p className="font-bold text-slate-700">{guard.checkInTime}</p>
                                    </div>
                                    <div className="border-l border-slate-200 pl-2">
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Salida</p>
                                        <p className="font-bold text-slate-700">{guard.scheduledEnd}</p>
                                    </div>
                                    <div className="border-l border-slate-200 pl-2">
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5" title="Rondas esta semana">Rondas (Sem)</p>
                                        <p className="font-bold text-slate-700">{guard.roundsThisWeek}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="p-8 text-center bg-slate-50/30">
                    <p className="text-sm font-bold text-slate-500">No hay guardias prestando servicio en este momento en esta instalación.</p>
                </div>
            )}
        </div>
    );
};

// ─── Estado del Servicio ──────────────────────────────────────────────────────
const EstadoServicio = ({ allowedSites, guardRounds, novedades, attendanceLogs, employees, selectedSiteId, setSelectedSiteId, fetchNovedades, fetchInitialData }: any) => {
    const today = new Date().toISOString().split('T')[0];
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weekStart = sevenDaysAgo.toISOString().split('T')[0];

    const filteredRounds = guardRounds.filter((r: any) => {
        const inSite = allowedSites.some((s: any) => String(s.id) === String(r.siteId));
        const siteMatch = selectedSiteId === 'all' || String(r.siteId) === selectedSiteId;
        return inSite && siteMatch;
    });
    const weekRounds = filteredRounds.filter((r: any) => r.startTime.substring(0, 10) >= weekStart);
    const todayRounds = filteredRounds.filter((r: any) => r.startTime.startsWith(today));
    const lastRound = [...filteredRounds].sort((a: any, b: any) => b.startTime.localeCompare(a.startTime))[0];
    const activeRounds = filteredRounds.filter((r: any) => !r.endTime);
    const filteredNovedades = novedades.filter((n: any) => {
        const sid = n.siteId || n.sucursalId;
        const inSite = allowedSites.some((s: any) => String(s.id) === String(sid));
        const siteMatch = selectedSiteId === 'all' || String(sid) === selectedSiteId;
        return inSite && siteMatch;
    });
    const todayNovedades = filteredNovedades.filter((n: any) => (n.timestamp || n.fechaHoraDispositivo || '').startsWith(today));

    // Calcular métricas por guardia (últimos 7 días)
    const guardStats = useMemo(() => {
        const map: Record<string, { name: string; total: number; sinNovedad: number; conNovedad: number; totalDurMin: number; completadas: number; lastRound: string }> = {};
        weekRounds.forEach((r: any) => {
            const key = r.workerId || r.workerName;
            if (!map[key]) map[key] = { name: r.workerName, total: 0, sinNovedad: 0, conNovedad: 0, totalDurMin: 0, completadas: 0, lastRound: r.startTime };
            map[key].total++;
            if (r.result === 'SIN_NOVEDAD') map[key].sinNovedad++;
            if (r.result === 'CON_NOVEDAD' || r.result === 'SOSPECHA') map[key].conNovedad++;
            if (r.endTime) {
                map[key].totalDurMin += (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000;
                map[key].completadas++;
            }
            if (r.startTime > map[key].lastRound) map[key].lastRound = r.startTime;
        });
        return Object.values(map).sort((a, b) => b.total - a.total);
    }, [weekRounds]);

    const avgDurMin = guardStats.filter(g => g.completadas > 0).length > 0
        ? Math.round(guardStats.filter(g => g.completadas > 0).reduce((acc, g) => acc + g.totalDurMin / g.completadas, 0) / guardStats.filter(g => g.completadas > 0).length) || 0
        : 0;

    return (
        <div className="space-y-6">
            {/* Header + filtros */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h3 className="text-xl font-black text-slate-800">Estado del Servicio</h3>
                    <p className="text-sm text-slate-400 mt-0.5">Métricas operacionales — últimos 7 días</p>
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

            <ActiveGuardBanner 
                attendanceLogs={attendanceLogs} 
                employees={employees}
                weekRounds={weekRounds} 
                selectedSiteId={selectedSiteId} 
                allowedSites={allowedSites} 
                fetchInitialData={fetchInitialData} 
            />

            {/* Resumen rápido - 3 mini stats */}
            <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm text-center">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Rondas Esta Semana</p>
                    <p className="text-4xl font-black text-slate-800 mt-1 leading-none">{weekRounds.length}</p>
                    <p className="text-xs text-slate-400 mt-2">{todayRounds.length} hoy {activeRounds.length > 0 ? `· ${activeRounds.length} en curso` : ''}</p>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm text-center">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Duración Promedio</p>
                    <p className="text-4xl font-black text-slate-800 mt-1 leading-none">{avgDurMin}<span className="text-xl font-bold text-slate-400"> min</span></p>
                    <p className="text-xs text-slate-400 mt-2">por ronda completada</p>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm text-center">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Incidencias Semana</p>
                    <p className="text-4xl font-black text-rose-600 mt-1 leading-none">{weekRounds.filter((r: any) => r.result === 'CON_NOVEDAD' || r.result === 'SOSPECHA').length}</p>
                    <p className="text-xs text-slate-400 mt-2">{todayNovedades.length} novedades hoy</p>
                </div>
            </div>

            {/* Tabla rendimiento por guardia */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
                    <Users size={16} className="text-blue-500" />
                    <h4 className="font-bold text-slate-700 text-sm">Rendimiento por Guardia — Últimos 7 días</h4>
                    <span className="ml-auto text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{guardStats.length} guardias</span>
                </div>
                {guardStats.length === 0 ? (
                    <div className="p-10 text-center text-slate-300">
                        <Users size={32} className="mx-auto mb-2" />
                        <p className="font-bold text-sm">Sin datos de rondas en la última semana</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                    <th className="text-left px-5 py-3">Guardia</th>
                                    <th className="text-center px-4 py-3">Rondas</th>
                                    <th className="text-center px-4 py-3">Dur. Prom.</th>
                                    <th className="text-center px-4 py-3">Sin Novedad</th>
                                    <th className="text-center px-4 py-3">Con Novedad</th>
                                    <th className="text-left px-5 py-3">Última Ronda</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {guardStats.map((g, idx) => {
                                    const avgDur = g.completadas > 0 ? Math.round(g.totalDurMin / g.completadas) : null;
                                    const pctOk = g.total > 0 ? Math.round((g.sinNovedad / g.total) * 100) : 0;
                                    return (
                                        <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                                            <td className="px-5 py-3">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500">
                                                        <Users size={13} />
                                                    </div>
                                                    <span className="font-bold text-slate-800 text-sm">{g.name}</span>
                                                    {idx === 0 && <Award size={13} className="text-amber-400" title="Mayor actividad" />}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className="text-xl font-black text-slate-800">{g.total}</span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {avgDur != null
                                                    ? <span className="inline-flex items-center gap-1 text-slate-700 font-bold"><Clock size={11} className="text-slate-400" />{avgDur} min</span>
                                                    : <span className="text-slate-300 text-xs">—</span>}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="inline-flex flex-col items-center gap-0.5">
                                                    <span className="font-black text-emerald-600">{g.sinNovedad}</span>
                                                    <div className="w-16 bg-slate-100 rounded-full h-1">
                                                        <div className="bg-emerald-400 h-1 rounded-full" style={{ width: pctOk + '%' }} />
                                                    </div>
                                                    <span className="text-[9px] text-slate-400">{pctOk}%</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`font-black ${g.conNovedad > 0 ? 'text-rose-500' : 'text-slate-300'}`}>{g.conNovedad}</span>
                                            </td>
                                            <td className="px-5 py-3">
                                                <p className="text-xs font-bold text-slate-600">{fmtDate(g.lastRound)}</p>
                                                <p className="text-[10px] text-slate-400">{fmtTime(g.lastRound)}</p>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Última ronda */}
            {lastRound && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-4">
                    <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                        <Navigation size={18} className="text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Última ronda registrada</p>
                        <p className="font-black text-slate-800">{lastRound.workerName}</p>
                        <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                            <MapPin size={9} className="text-blue-400" />{lastRound.siteName} · {fmtDateTime(lastRound.startTime)}
                        </p>
                    </div>
                    <ResultBadge result={lastRound.result} />
                    {!lastRound.endTime && (
                        <div className="flex items-center gap-1 text-rose-500 text-xs font-bold">
                            <Loader2 size={12} className="animate-spin" /> En Curso
                        </div>
                    )}
                </div>
            )}

            {todayNovedades.length > 0 && (
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <AlertTriangle size={16} className="text-amber-500" />
                        <h4 className="font-bold text-amber-800 text-sm">Novedades del Día ({todayNovedades.length})</h4>
                    </div>
                    <div className="space-y-2">
                        {todayNovedades.slice(0, 5).map((n: any) => {
                            const dotColor = n.prioridad === 'critica' ? 'bg-red-500'
                                : n.prioridad === 'alta' ? 'bg-orange-500'
                                : n.prioridad === 'media' ? 'bg-amber-500'
                                : n.prioridad === 'informativa' ? 'bg-blue-500'
                                : 'bg-amber-400';
                            return (
                                <div key={n.id} className="bg-white rounded-xl p-3 flex items-start gap-3 border border-slate-100 shadow-sm">
                                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                            {n.prioridad && (
                                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                                                    n.prioridad === 'critica' ? 'bg-red-100 text-red-700' :
                                                    n.prioridad === 'alta' ? 'bg-orange-100 text-orange-700' :
                                                    n.prioridad === 'media' ? 'bg-amber-100 text-amber-700' :
                                                    'bg-blue-100 text-blue-700'
                                                }`}>
                                                    {n.prioridad}
                                                </span>
                                            )}
                                            <span className="text-xs font-bold text-slate-700">{n.guardName || n.autorNombre}</span>
                                            <span className="text-[10px] text-slate-400">·</span>
                                            <span className="text-[10px] text-slate-400">{fmtTime(n.timestamp || n.fechaHoraDispositivo)}</span>
                                        </div>
                                        <p className="text-xs text-slate-600 line-clamp-2">{n.descripcion}</p>
                                    </div>
                                </div>
                            );
                        })}
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
    const [prioridadFilter, setPrioridadFilter] = useState('all');
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const itemsPerPage = 20;

    useEffect(() => {
        setPage(1);
    }, [startDate, endDate, tipoFilter, siteFilter, prioridadFilter]);

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
            .filter((n: any) => allowedSites.some((s: any) => String(s.id) === String(n.siteId || n.sucursalId)))
            .map((n: any) => ({
                id: n.id,
                siteId: String(n.siteId || n.sucursalId),
                sucursalName: n.siteName || n.sucursalNombre,
                tipo: n.tipoRegistro || n.tipo,
                descripcion: n.descripcion,
                guardName: n.autorNombre || n.guardName,
                timestamp: n.fechaHoraDispositivo || n.timestamp || n.createdAt || '',
                resultado: n.estado || n.resultado,
                prioridad: n.prioridad,
                evidencias: n.evidencias || (n.evidenciaUrl ? [n.evidenciaUrl] : []),
                original: n // Guardar referencia al doc original por si acaso
            }));

        return [...roundItems, ...novedadItems].sort((a: any, b: any) => b.timestamp.localeCompare(a.timestamp));
    }, [guardRounds, novedades, allowedSites]);

    const filtered = timelineItems.filter((item: any) => {
        const dateStr = item.timestamp.substring(0, 10);
        const matchDate = dateStr >= startDate && dateStr <= endDate;
        const matchTipo = tipoFilter === 'all' || item.tipo === tipoFilter;
        const matchSite = siteFilter === 'all' || item.siteId === siteFilter;
        const matchPrioridad = prioridadFilter === 'all' || item.prioridad === prioridadFilter;
        return matchDate && matchTipo && matchSite && matchPrioridad;
    });

    const tipoIcon: Record<string, React.ReactNode> = {
        ronda: <Navigation size={13} />, incidente: <AlertTriangle size={13} />,
        alerta: <AlertCircle size={13} />, novedad: <Info size={13} />, otro: <FileText size={13} />,
    };
    const tipoColor: Record<string, string> = {
        ronda: 'bg-blue-100 text-blue-700', incidente: 'bg-rose-100 text-rose-700',
        alerta: 'bg-amber-100 text-amber-700', novedad: 'bg-indigo-100 text-indigo-700', otro: 'bg-slate-100 text-slate-600',
    };

    const totalPages = Math.ceil(filtered.length / itemsPerPage);
    const paginatedItems = filtered.slice((page - 1) * itemsPerPage, page * itemsPerPage);

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
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Prioridad</label>
                    <select value={prioridadFilter} onChange={e => setPrioridadFilter(e.target.value)}
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none">
                        <option value="all">Todas</option>
                        <option value="informativa">Informativa</option>
                        <option value="media">Media</option>
                        <option value="alta">Alta</option>
                        <option value="critica">Crítica</option>
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
                    {paginatedItems.map((item: any, idx: number) => {
                        const prevDate = idx > 0 ? filtered[idx - 1].timestamp.substring(0, 10) : null;
                        const currDate = item.timestamp.substring(0, 10);
                        const showSep = prevDate !== currDate;
                        const dotColor = item.prioridad === 'critica' ? 'bg-red-500 border-red-300'
                            : item.prioridad === 'alta' ? 'bg-orange-500 border-orange-300'
                            : item.prioridad === 'media' ? 'bg-amber-500 border-amber-300'
                            : item.prioridad === 'informativa' ? 'bg-blue-500 border-blue-300'
                            : item.resultado === 'SIN_NOVEDAD' ? 'bg-emerald-400 border-emerald-300'
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
                                            {item.prioridad && (
                                                <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase ${
                                                    item.prioridad === 'critica' ? 'bg-red-100 text-red-700' :
                                                    item.prioridad === 'alta' ? 'bg-orange-100 text-orange-700' :
                                                    item.prioridad === 'media' ? 'bg-amber-100 text-amber-700' :
                                                    'bg-blue-100 text-blue-700'
                                                }`}>
                                                    {item.prioridad}
                                                </span>
                                            )}
                                            {item.resultado && <ResultBadge result={item.resultado} />}
                                            <span className="text-xs text-slate-400">·</span>
                                            <span className="text-xs font-bold text-slate-600">{item.guardName}</span>
                                            <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                                <MapPin size={9} />{item.sucursalName}
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-600 mt-1 leading-relaxed">{item.descripcion}</p>
                                        {item.evidencias && item.evidencias.length > 0 && (
                                            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                                                {item.evidencias.map((url: string, eIdx: number) => (
                                                    <div key={eIdx} onClick={() => setSelectedImage(url)} className="shrink-0 w-16 h-16 rounded-xl border border-slate-200 overflow-hidden cursor-pointer hover:border-blue-400 hover:shadow-sm transition">
                                                        <ThumbnailImage photoUrl={url} alt={`Evidencia ${eIdx + 1}`} className="w-full h-full object-cover" />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </React.Fragment>
                        );
                    })}
                </div>
            )}

            {totalPages > 1 && (
                <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm mt-4">
                    <button 
                        onClick={() => setPage(p => Math.max(1, p - 1))} 
                        disabled={page === 1}
                        className="px-4 py-2 bg-slate-50 text-slate-600 rounded-xl disabled:opacity-50 font-bold text-sm hover:bg-slate-100 transition-colors"
                    >
                        Anterior
                    </button>
                    <span className="text-sm font-bold text-slate-500">Página {page} de {totalPages}</span>
                    <button 
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))} 
                        disabled={page === totalPages}
                        className="px-4 py-2 bg-slate-50 text-slate-600 rounded-xl disabled:opacity-50 font-bold text-sm hover:bg-slate-100 transition-colors"
                    >
                        Siguiente
                    </button>
                </div>
            )}

            {selectedImage && (
                <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="relative max-w-4xl max-h-[90vh] w-full flex items-center justify-center">
                        <button onClick={() => setSelectedImage(null)} className="absolute -top-12 right-0 text-white hover:text-slate-200 text-3xl font-bold leading-none">
                            &times;
                        </button>
                        <ThumbnailImage photoUrl={selectedImage} alt="Fullscreen Evidence" className="max-w-full max-h-[90vh] object-contain rounded-xl" />
                    </div>
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
    const [page, setPage] = useState(1);
    const itemsPerPage = 20;

    useEffect(() => {
        setPage(1);
    }, [searchTerm, resultFilter, startDate, endDate, siteFilter]);

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

    const totalPages = Math.ceil(filtered.length / itemsPerPage);
    const paginatedItems = filtered.slice((page - 1) * itemsPerPage, page * itemsPerPage);

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
                    {paginatedItems.map((round: any) => {
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

            {totalPages > 1 && (
                <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm mt-4">
                    <button 
                        onClick={() => setPage(p => Math.max(1, p - 1))} 
                        disabled={page === 1}
                        className="px-4 py-2 bg-slate-50 text-slate-600 rounded-xl disabled:opacity-50 font-bold text-sm hover:bg-slate-100 transition-colors"
                    >
                        Anterior
                    </button>
                    <span className="text-sm font-bold text-slate-500">Página {page} de {totalPages}</span>
                    <button 
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))} 
                        disabled={page === totalPages}
                        className="px-4 py-2 bg-slate-50 text-slate-600 rounded-xl disabled:opacity-50 font-bold text-sm hover:bg-slate-100 transition-colors"
                    >
                        Siguiente
                    </button>
                </div>
            )}
            {selectedRound && <RouteMapModal round={selectedRound} onClose={() => setSelectedRound(null)} />}
        </div>
    );
};

// ─── PDF Generator ────────────────────────────────────────────────────────────
const generatePDF = (tipo: string, rounds: any[], novedades: any[], siteName: string, startDate: string, endDate: string) => {
    const fD = (iso: string) => new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const fT = (iso: string) => new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    const now = new Date().toLocaleString('es-CL');

    const guardMap: Record<string, any> = {};
    rounds.forEach((r: any) => {
        const k = r.workerId || r.workerName;
        if (!guardMap[k]) guardMap[k] = { name: r.workerName, total: 0, sinNovedad: 0, conNovedad: 0, totalMin: 0, completadas: 0 };
        guardMap[k].total++;
        if (r.result === 'SIN_NOVEDAD') guardMap[k].sinNovedad++;
        if (r.result === 'CON_NOVEDAD' || r.result === 'SOSPECHA') guardMap[k].conNovedad++;
        if (r.endTime) { guardMap[k].totalMin += (new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000; guardMap[k].completadas++; }
    });
    const gStats = Object.values(guardMap).sort((a: any, b: any) => b.total - a.total);
    const totalCN = rounds.filter((r: any) => r.result !== 'SIN_NOVEDAD').length;
    const avgMin = gStats.filter((g: any) => g.completadas > 0).length > 0
        ? Math.round(gStats.filter((g: any) => g.completadas > 0).reduce((acc: any, g: any) => acc + g.totalMin / g.completadas, 0) / gStats.filter((g: any) => g.completadas > 0).length) : 0;

    const timeline = [
        ...rounds.map((r: any) => ({ ts: r.startTime, tipo: 'Ronda', guard: r.workerName, site: r.siteName, desc: r.notes || 'Sin observaciones.', res: r.result })),
        ...novedades.map((n: any) => ({ 
            ts: n.fechaHoraDispositivo || n.timestamp || n.createdAt || '', 
            tipo: n.tipoRegistro || n.tipo || 'N/A', 
            guard: n.autorNombre || n.guardName || 'Sistema', 
            site: n.siteName || n.sucursalNombre || n.sucursalName || 'Instalación', 
            desc: n.descripcion || n.detalles || 'Sin descripción', 
            res: n.estado || n.resultado || '' 
        }))
    ].sort((a, b) => b.ts.localeCompare(a.ts));

    const css = `@page{size:A4;margin:20mm 15mm}*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;color:#1e293b}.hdr{background:#1e3a5f;color:#fff;padding:20px 24px;border-radius:8px;margin-bottom:20px;display:flex;justify-content:space-between}.hdr h1{font-size:20px;font-weight:900}.hdr p{font-size:10px;opacity:.7;margin-top:2px}.hdr .meta{text-align:right;font-size:10px;opacity:.8;line-height:1.6}.stitle{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#64748b;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:20px 0 12px}.sg{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}.sb{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}.sb .n{font-size:28px;font-weight:900;color:#1e293b;line-height:1}.sb .l{font-size:9px;font-weight:700;text-transform:uppercase;color:#94a3b8;margin-top:4px}.sb.g .n{color:#16a34a}.sb.r .n{color:#dc2626}.sb.b .n{color:#2563eb}table{width:100%;border-collapse:collapse;font-size:10px}th{background:#f1f5f9;font-weight:900;text-transform:uppercase;font-size:9px;color:#64748b;padding:8px 10px;text-align:left}td{padding:7px 10px;border-bottom:1px solid #f1f5f9}tr:nth-child(even) td{background:#fafafa}.badge{display:inline-block;padding:2px 6px;border-radius:4px;font-size:8px;font-weight:900;text-transform:uppercase}.sin{background:#dcfce7;color:#15803d}.con{background:#fee2e2;color:#dc2626}.sos{background:#fef3c7;color:#d97706}.rnd{background:#dbeafe;color:#1d4ed8}.otr{background:#f1f5f9;color:#64748b}.ti{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9}.td{width:80px;font-weight:700;color:#64748b;font-size:9px}.dot{width:8px;height:8px;border-radius:50%;background:#3b82f6;margin-top:4px;flex-shrink:0}.dot.r{background:#ef4444}.dot.g{background:#22c55e}.dot.a{background:#f59e0b}.ftr{margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;

    let body = '';
    if (tipo === 'resumen_ejecutivo') {
        const incidenciasTimeline = timeline.filter((item: any) => item.res !== 'SIN_NOVEDAD' && item.res !== 'RESUELTO').slice(0, 25);
        body = `<div class="sg"><div class="sb b"><div class="n">${rounds.length}</div><div class="l">Total Rondas</div></div><div class="sb g"><div class="n">${rounds.length - totalCN}</div><div class="l">Sin Novedad</div></div><div class="sb r"><div class="n">${totalCN + novedades.length}</div><div class="l">Con Novedad</div></div><div class="sb"><div class="n">${avgMin}</div><div class="l">Min. Promedio</div></div></div><div class="stitle">Rendimiento por Guardia</div><table><thead><tr><th>Guardia</th><th style="text-align:center">Rondas</th><th style="text-align:center">Sin Nov.</th><th style="text-align:center">Con Nov.</th><th style="text-align:center">Prom. Duración</th></tr></thead><tbody>${gStats.map((g: any) => `<tr><td><strong>${g.name}</strong></td><td style="text-align:center"><strong>${g.total}</strong></td><td style="text-align:center"><span class="badge sin">${g.sinNovedad}</span></td><td style="text-align:center"><span class="badge con">${g.conNovedad}</span></td><td style="text-align:center">${g.completadas > 0 ? Math.round(g.totalMin / g.completadas) + ' min' : '—'}</td></tr>`).join('')}</tbody></table><div class="stitle" style="margin-top:24px">Últimas Incidencias y Novedades</div><table><thead><tr><th>Fecha / Hora</th><th>Guardia</th><th>Instalación</th><th>Resultado / Tipo</th><th>Observación</th></tr></thead><tbody>${incidenciasTimeline.map((item: any) => `<tr><td>${fD(item.ts)} ${fT(item.ts)}</td><td>${item.guard}</td><td>${item.site}</td><td><span class="badge ${item.res === 'CON_NOVEDAD' || !item.res ? 'con' : 'sos'}">${item.res ? item.res.replace('_', ' ') : item.tipo}</span></td><td>${(item.desc || '—').substring(0, 55)}</td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:#94a3b8">Sin incidencias</td></tr>'}</tbody></table>`;
    } else {
        body = `<div class="stitle">Registro Cronológico (${timeline.length} eventos)</div>${timeline.map((item: any) => { const dc = item.res === 'SIN_NOVEDAD' ? 'g' : item.res === 'CON_NOVEDAD' ? 'r' : item.tipo !== 'ronda' && item.tipo !== 'Ronda' ? 'a' : ''; const bc = item.tipo === 'Ronda' || item.tipo === 'ronda' ? 'rnd' : item.res === 'CON_NOVEDAD' ? 'con' : item.res === 'SIN_NOVEDAD' ? 'sin' : 'otr'; return `<div class="ti"><div class="td">${fD(item.ts)}<br/>${fT(item.ts)}</div><div class="dot ${dc}"></div><div style="flex:1"><div style="display:flex;gap:6px;align-items:center;margin-bottom:2px"><span class="badge ${bc}">${item.tipo}</span><strong style="font-size:10px">${item.guard}</strong><span style="color:#94a3b8;font-size:9px">· ${item.site}</span>${item.res ? `<span class="badge ${item.res === 'SIN_NOVEDAD' ? 'sin' : item.res === 'CON_NOVEDAD' ? 'con' : 'sos'}">${item.res.replace('_', ' ')}</span>` : ''}</div><div style="color:#475569;font-size:10px">${item.desc}</div></div></div>`; }).join('')}`;
    }

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Reporte Aspro - ${fD(new Date().toISOString())}</title><style>${css}</style></head><body><div class="hdr"><div><h1>REPORTE ASPRO</h1><p>${tipo === 'resumen_ejecutivo' ? 'Métricas de Rondas, incidencias y estadísticas' : 'Libro de Novedades'}</p><p style="margin-top:6px;font-size:11px;opacity:.9">${siteName}</p></div><div class="meta"><div>Período: ${fD(startDate + 'T12:00')} — ${fD(endDate + 'T12:00')}</div><div>Generado: ${now}</div><div>Total eventos incluidos: ${timeline.length}</div></div></div>${body}<div class="ftr"><span>Reporte Aspro</span><span>Generado automáticamente · ${now}</span></div></body></html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { alert('Permite ventanas emergentes para generar el PDF'); return; }
    win.document.write(html);
    win.document.close();
    win.document.title = `Reporte Aspro - ${fD(new Date().toISOString())}`;
    setTimeout(() => win.print(), 600);
};

// ─── Reportes ─────────────────────────────────────────────────────────────────
const Reportes = ({ allowedSites, guardRounds, novedades }: any) => {
    const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; });
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [tipoReporte, setTipoReporte] = useState('resumen_ejecutivo');
    const [siteFilter, setSiteFilter] = useState('all');

    const filteredRounds = useMemo(() => guardRounds.filter((r: any) => {
        const inSite = allowedSites.some((s: any) => String(s.id) === String(r.siteId));
        const siteMatch = siteFilter === 'all' || String(r.siteId) === siteFilter;
        const d = r.startTime.substring(0, 10);
        return inSite && siteMatch && d >= startDate && d <= endDate;
    }), [guardRounds, allowedSites, siteFilter, startDate, endDate]);

    const filteredNovedades = useMemo(() => novedades.filter((n: any) => {
        const inSite = allowedSites.some((s: any) => String(s.id) === String(n.siteId));
        const siteMatch = siteFilter === 'all' || String(n.siteId) === siteFilter;
        const d = n.timestamp.substring(0, 10);
        return inSite && siteMatch && d >= startDate && d <= endDate;
    }), [novedades, allowedSites, siteFilter, startDate, endDate]);

    const siteName = siteFilter === 'all' ? 'Todas las instalaciones'
        : (allowedSites.find((s: any) => String(s.id) === siteFilter)?.name || 'Instalación');

    return (
        <div className="space-y-5">
            <div>
                <h3 className="text-xl font-black text-slate-800">Reportes</h3>
                <p className="text-sm text-slate-400 mt-0.5">Generación y descarga de informes del servicio en PDF</p>
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
                                { id: 'resumen_ejecutivo', label: 'Resumen Ejecutivo', icon: <BarChart3 size={18} />, desc: 'Métricas por guardia, incidencias y estadísticas del período' },
                                { id: 'libro_novedades', label: 'Libro de Novedades', icon: <BookOpen size={18} />, desc: 'Registro cronológico completo de rondas y novedades' },
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
                <div className="mt-5 p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-3">
                    <Activity size={14} className="text-slate-400 shrink-0" />
                    <p className="text-xs text-slate-600">
                        <span className="font-bold">{filteredRounds.length} rondas</span> y <span className="font-bold">{filteredNovedades.length} novedades</span> incluidas en el reporte.
                    </p>
                </div>
                <div className="mt-5 pt-5 border-t border-slate-100">
                    <button
                        onClick={() => generatePDF(tipoReporte, filteredRounds, filteredNovedades, siteName, startDate, endDate)}
                        disabled={filteredRounds.length === 0 && filteredNovedades.length === 0}
                        className="w-full flex items-center justify-center gap-3 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-xl font-black text-sm uppercase tracking-widest transition-all active:scale-[0.98] shadow-lg shadow-blue-100"
                    >
                        <Download size={18} /> Generar y Descargar PDF
                    </button>
                    <p className="text-center text-[10px] text-slate-400 mt-2">Se abrirá el diálogo de impresión — selecciona "Guardar como PDF"</p>
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
                {[
                    { label: 'Evidencias Fotográficas', icon: <Camera size={20} /> },
                    { label: 'KPIs Mensuales Comparativos', icon: <TrendingUp size={20} /> },
                    { label: 'Mapa de Rondas', icon: <MapPin size={20} /> },
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
    const { guardRounds, sites, currentUser, employees, logout, fetchInitialData, showConfirmation, novedades, fetchNovedades, attendanceLogs } = useAppStore();
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
                        {activeSection === 'estado' && <EstadoServicio
                                allowedSites={allowedSites}
                                guardRounds={guardRounds}
                                novedades={novedades}
                                attendanceLogs={attendanceLogs}
                                employees={employees}
                                selectedSiteId={selectedSiteId}
                                setSelectedSiteId={setSelectedSiteId}
                                fetchNovedades={fetchNovedades}
                                fetchInitialData={fetchInitialData}
                            />}
                        {activeSection === 'novedades' && (
                            <LibroNovedades allowedSites={allowedSites} guardRounds={guardRounds} novedades={novedades} />
                        )}
                        {activeSection === 'rondas' && (
                            <RegistroRondas allowedSites={allowedSites} guardRounds={guardRounds} showConfirmation={showConfirmation} />
                        )}
                        {activeSection === 'reportes' && (
                            <Reportes allowedSites={allowedSites} guardRounds={guardRounds} novedades={novedades} />
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
