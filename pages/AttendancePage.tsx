import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
    Map as MapIcon,
    MapPin,
    Clock,
    Search,
    Camera,
    XCircle,
    Calendar,
    FileSpreadsheet,
    ChevronDown,
    Filter
} from 'lucide-react';
import * as XLSX from 'xlsx';

const AttendancePage: React.FC = () => {
    const { attendanceLogs, sites } = useAppStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSiteId, setSelectedSiteId] = useState<string | number | 'all'>('all');
    const [filterType, setFilterType] = useState<'all' | 'day' | 'week' | 'month' | 'range'>('day');
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

    // Helpers for Date logic
    const isInSameWeek = (date1: Date, date2: Date) => {
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        d1.setHours(0, 0, 0, 0);
        d2.setHours(0, 0, 0, 0);
        const start1 = new Date(d1);
        start1.setDate(d1.getDate() - d1.getDay());
        const start2 = new Date(d2);
        start2.setDate(d2.getDate() - d2.getDay());
        return start1.getTime() === start2.getTime();
    };

    const handleFilterTypeChange = (type: 'all' | 'day' | 'week' | 'month' | 'range') => {
        setFilterType(type);
    };

    // Helper to calculate duration for Check Out events
    const getShiftDuration = (currentLog: any) => {
        if (currentLog.type !== 'check_out') return null;

        // Find logs for same employee, BEFORE current log
        // attendanceLogs is from store, assuming it contains history
        // We sort descending to find the closest previous check_in
        const relevantLogs = attendanceLogs
            .filter(l =>
                l.employeeId === currentLog.employeeId &&
                new Date(l.timestamp).getTime() < new Date(currentLog.timestamp).getTime() &&
                l.type === 'check_in'
            )
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        const lastCheckIn = relevantLogs[0];

        if (!lastCheckIn) return null;

        const diff = new Date(currentLog.timestamp).getTime() - new Date(lastCheckIn.timestamp).getTime();
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        return `${hours}h ${minutes}m`;
    };

    // Filtered logs logic
    const filteredLogs = attendanceLogs.filter(log => {
        const matchesSearch =
            log.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.rut.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesSite = selectedSiteId === 'all' || log.siteId?.toString() === selectedSiteId.toString();

        const logDate = new Date(log.timestamp);
        let matchesDate = true;

        if (filterType === 'day') {
            const filterDate = new Date(startDate + 'T00:00:00');
            matchesDate = logDate.toDateString() === filterDate.toDateString();
        } else if (filterType === 'week') {
            const filterDate = new Date(startDate + 'T00:00:00');
            matchesDate = isInSameWeek(logDate, filterDate);
        } else if (filterType === 'month') {
            const [y, m] = startDate.split('-').map(Number);
            matchesDate = logDate.getFullYear() === y && (logDate.getMonth() + 1) === m;
        } else if (filterType === 'range') {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            matchesDate = logDate >= start && logDate <= end;
        }

        return matchesSearch && matchesSite && matchesDate;
    });

    const logsBySite = filteredLogs.reduce((acc, log) => {
        const siteKey = log.siteId?.toString() || 'unknown';
        if (!acc[siteKey]) {
            acc[siteKey] = { name: log.siteName || 'Sucursal Desconocida', logs: [] };
        }
        acc[siteKey].logs.push(log);
        return acc;
    }, {} as Record<string, { name: string, logs: any[] }>);

    const exportToExcel = () => {
        const dataToExport = filteredLogs.map(log => {
            const duration = getShiftDuration(log);
            return {
                'Fecha': new Date(log.timestamp).toLocaleDateString(),
                'Hora': new Date(log.timestamp).toLocaleTimeString(),
                'Trabajador': log.employeeName,
                'RUT': log.rut,
                'Sucursal': log.siteName,
                'Tipo Evento': log.type === 'check_in' ? 'Entrada' : 'Salida',
                'Duración Turno': duration || '-',
                'Coordenadas': log.locationLat ? `${log.locationLat}, ${log.locationLng}` : 'N/A'
            };
        });
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Asistencia");
        XLSX.writeFile(wb, `asistencia_${filterType}.xlsx`);
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 min-h-screen">
            <header className="bg-white border-b border-slate-200 px-6 py-6 sticky top-0 z-30">
                <div className="max-w-7xl mx-auto space-y-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h2 className="text-3xl font-black text-slate-800 tracking-tighter">Control de Asistencia</h2>
                            <p className="text-sm text-slate-500 font-bold uppercase tracking-widest mt-1 opacity-70">Monitoreo con filtros avanzados</p>
                        </div>
                        <button onClick={exportToExcel} disabled={filteredLogs.length === 0}
                            className="flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-sm font-black uppercase shadow-xl shadow-emerald-200 disabled:opacity-50 transition-all active:scale-95"
                        >
                            <FileSpreadsheet size={18} /> Exportar Excel
                        </button>
                    </div>

                    <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-4 bg-slate-50 p-3 md:p-4 rounded-3xl border border-slate-100">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input type="text" placeholder="Nombre o RUT..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-blue-500 font-medium" />
                        </div>

                        <div className="relative w-full lg:w-64">
                            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <select value={selectedSiteId} onChange={(e) => setSelectedSiteId(e.target.value)}
                                className="w-full pl-10 pr-10 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm appearance-none outline-none font-bold text-slate-700">
                                <option value="all">Todas las Sedes</option>
                                {sites.filter(s => s.active).map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={16} />
                        </div>

                        <div className="flex p-1 bg-white border border-slate-200 rounded-2xl overflow-x-auto no-scrollbar">
                            {(['all', 'day', 'week', 'month', 'range'] as const).map((type) => (
                                <button key={type} onClick={() => handleFilterTypeChange(type)}
                                    className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${filterType === type ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}>
                                    {type === 'all' ? 'Todo' : type === 'day' ? 'Día' : type === 'week' ? 'Semana' : type === 'month' ? 'Mes' : 'Rango'}
                                </button>
                            ))}
                        </div>

                        {filterType !== 'all' && (
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                <div className="relative">
                                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                    <input type={filterType === 'month' ? "month" : "date"} value={startDate} onChange={(e) => setStartDate(e.target.value)}
                                        className="w-full sm:w-auto pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-700" />
                                </div>
                                {filterType === 'range' && (
                                    <>
                                        <span className="text-slate-400 font-bold text-center">-</span>
                                        <div className="relative">
                                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                                                className="w-full sm:w-auto pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-700" />
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </header>

            <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full">
                {Object.keys(logsBySite).length === 0 ? (
                    <div className="bg-white rounded-[2.5rem] p-16 text-center shadow-sm border border-slate-100 mt-10">
                        <Clock size={40} className="text-slate-300 mx-auto mb-6" />
                        <h3 className="text-2xl font-black text-slate-800 tracking-tight">No hay registros</h3>
                        <p className="text-slate-500 mt-2 font-medium">Prueba ajustando los filtros de fecha o búsqueda.</p>
                    </div>
                ) : (
                    <div className="space-y-12">
                        {Object.keys(logsBySite).map(siteId => (
                            <section key={siteId} className="space-y-4">
                                <div className="flex items-center gap-4 px-2">
                                    <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
                                        <MapIcon size={24} />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-slate-800 tracking-tight uppercase">{logsBySite[siteId].name}</h3>
                                        <p className="text-xs font-black text-blue-600 uppercase tracking-[0.2em]">{logsBySite[siteId].logs.length} Marcaciones</p>
                                    </div>
                                </div>
                                <div className="bg-white rounded-[2.5rem] shadow-xl border border-slate-100 overflow-hidden">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="bg-slate-50/50 border-b border-slate-100">
                                                    <th className="px-6 py-5 text-[10px] font-black uppercase text-slate-400">Trabajador</th>
                                                    <th className="px-6 py-5 text-[10px] font-black uppercase text-slate-400">Evento</th>
                                                    <th className="px-6 py-5 text-[10px] font-black uppercase text-slate-400">Fecha y Hora</th>
                                                    <th className="px-6 py-5 text-[10px] font-black uppercase text-slate-400">Ubicación</th>
                                                    <th className="px-6 py-5 text-[10px] font-black uppercase text-slate-400 text-right">Detalle</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {logsBySite[siteId].logs.map((log) => {
                                                    const duration = getShiftDuration(log);
                                                    return (
                                                        <tr key={log.id} className="hover:bg-blue-50/30 transition-colors group">
                                                            <td className="px-6 py-5">
                                                                <div className="flex items-center gap-3">
                                                                    <div className="w-11 h-11 rounded-2xl bg-slate-100 flex items-center justify-center font-black text-slate-500 text-xs overflow-hidden border border-slate-100">
                                                                        {log.photoUrl ? <img src={log.photoUrl} className="w-full h-full object-cover" alt="" /> : log.employeeName[0]}
                                                                    </div>
                                                                    <div>
                                                                        <p className="font-black text-slate-800 uppercase text-sm">{log.employeeName}</p>
                                                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{log.rut}</p>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-5">
                                                                <div className="flex flex-col items-start gap-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase ${log.type === 'check_in' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-rose-50 text-rose-600 border border-rose-100'}`}>
                                                                            {log.type === 'check_in' ? 'Entrada' : 'Salida'}
                                                                        </span>
                                                                        {log.isManual && (
                                                                            <span className="px-2 py-1 bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-[8px] font-black uppercase tracking-tighter">
                                                                                Manual
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    {duration && (
                                                                        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                                                                            ⏱ {duration}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-5">
                                                                <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                                                                    <Clock size={14} className="text-blue-400" />
                                                                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                </div>
                                                                <p className="text-[10px] text-slate-400 font-black uppercase ml-5">{new Date(log.timestamp).toLocaleDateString()}</p>
                                                            </td>
                                                            <td className="px-6 py-5">
                                                                {log.locationLat ? (
                                                                    <a href={`https://www.google.com/maps?q=${log.locationLat},${log.locationLng}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all">
                                                                        <MapPin size={12} /> Mapa
                                                                    </a>
                                                                ) : <span className="text-slate-300 text-[10px] font-black uppercase italic">N/A</span>}
                                                            </td>
                                                            <td className="px-6 py-5 text-right">
                                                                {log.photoUrl && <button onClick={() => setSelectedPhoto(log.photoUrl)} className="p-2.5 bg-slate-50 hover:bg-blue-600 text-slate-400 hover:text-white rounded-xl transition-all border border-slate-100"><Camera size={18} /></button>}
                                                            </td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </main>

            {selectedPhoto && (
                <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in transition-all" onClick={() => setSelectedPhoto(null)}>
                    <div className="relative max-w-2xl w-full bg-white rounded-[3.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 transition-all">
                        <button className="absolute top-8 right-8 p-4 bg-white/20 hover:bg-white/40 backdrop-blur-xl text-white rounded-[1.5rem] z-20" onClick={() => setSelectedPhoto(null)}><XCircle size={28} /></button>
                        <img src={selectedPhoto} className="w-full aspect-square object-cover" alt="Control de Acceso" />
                        <div className="p-10 text-center bg-white">
                            <h4 className="text-2xl font-black text-slate-800 uppercase mb-2">Verificación de Identidad</h4>
                            <p className="text-slate-400 font-bold text-sm">Respaldo fotográfico del registro de asistencia.</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AttendancePage;
