
import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import ThumbnailImage from '../components/ThumbnailImage';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs, doc, deleteDoc } from 'firebase/firestore';
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
    ShieldAlert,
    Trash2,
    X,
    ChevronLeft,
    ChevronRight
} from 'lucide-react';
import RouteMapModal from '../components/RouteMapModal';

const RoundsAdminPage: React.FC = () => {
    const { guardRounds, sites, showConfirmation, employees, fetchGuardRounds, showNotification } = useAppStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [notesSearch, setNotesSearch] = useState('');
    const [resultFilter, setResultFilter] = useState<'all' | 'SIN_NOVEDAD' | 'CON_NOVEDAD' | 'SOSPECHA'>('all');
    const [startDateFilter, setStartDateFilter] = useState('');
    const [endDateFilter, setEndDateFilter] = useState('');
    const [selectedSiteId, setSelectedSiteId] = useState<string | 'all'>('all');
    const [selectedRound, setSelectedRound] = useState<any | null>(null);

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(20);

    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, notesSearch, resultFilter, startDateFilter, endDateFilter, selectedSiteId, itemsPerPage]);

    // Test mode state
    const [showTestModal, setShowTestModal] = useState(false);
    const [selectedWorkerId, setSelectedWorkerId] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDeleteUserRounds = async () => {
        if (!selectedWorkerId) return;

        const worker = employees.find(e => e.id === selectedWorkerId);
        const workerName = worker ? `${worker.firstName} ${worker.lastNamePaterno}` : "este usuario";

        showConfirmation({
            title: "Eliminar Rondas (Pruebas)",
            message: `¿Seguro que deseas eliminar permanentemente TODAS las rondas de ${workerName}? Esta acción borrará todos los registros de rondas de la base de datos y no aparecerán en el monitoreo.`,
            onConfirm: async () => {
                setIsDeleting(true);
                try {
                    const q = query(collection(db, "Rondas"), where("workerId", "==", selectedWorkerId));
                    const snapshot = await getDocs(q);
                    
                    if (snapshot.empty) {
                        showNotification("No se encontraron rondas para este colaborador.", "info");
                        setIsDeleting(false);
                        setShowTestModal(false);
                        return;
                    }

                    // Borrar cada documento
                    const deletePromises = snapshot.docs.map(docSnap => deleteDoc(doc(db, "Rondas", docSnap.id)));
                    await Promise.all(deletePromises);

                    showNotification(`Se eliminaron correctamente ${snapshot.size} rondas de ${workerName}.`, "success");
                    await fetchGuardRounds();
                } catch (error) {
                    console.error("Error deleting user rounds:", error);
                    showNotification("Error al eliminar las rondas.", "error");
                } finally {
                    setIsDeleting(false);
                    setShowTestModal(false);
                    setSelectedWorkerId('');
                }
            }
        });
    };

    // Filter logic
    const filteredRounds = guardRounds.filter(round => {
        const matchesSearch =
            round.workerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            round.siteName.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesNotes = !notesSearch || (round.notes && round.notes.toLowerCase().includes(notesSearch.toLowerCase()));

        const matchesResult = resultFilter === 'all' || round.result === resultFilter;

        let matchesDate = true;
        const roundDate = round.startTime.substring(0, 10);
        if (startDateFilter) {
            matchesDate = matchesDate && roundDate >= startDateFilter;
        }
        if (endDateFilter) {
            matchesDate = matchesDate && roundDate <= endDateFilter;
        }

        const matchesSite = selectedSiteId === 'all' || round.siteId.toString() === selectedSiteId;

        return matchesSearch && matchesNotes && matchesResult && matchesDate && matchesSite;
    });

    const totalPages = Math.ceil(filteredRounds.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedRounds = filteredRounds.slice(startIndex, startIndex + itemsPerPage);

    return (
        <div className="flex flex-col h-full bg-slate-50 min-h-screen relative">
            {/* HEADER */}
            <header className="bg-white border-b border-slate-200 px-4 md:px-6 py-6 sticky top-0 z-30">
                <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div>
                        <div className="flex flex-wrap items-center gap-3">
                            <h2 className="text-2xl md:text-3xl font-black text-slate-800 tracking-tighter">Monitoreo de Rondas</h2>
                            <button
                                onClick={() => setShowTestModal(true)}
                                className="px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-widest rounded-full transition-all border border-amber-200"
                            >
                                Uso exclusivo para pruebas
                            </button>
                        </div>
                        <p className="text-[10px] md:text-sm text-slate-500 font-bold uppercase tracking-widest mt-1 opacity-70">Seguimiento GPS de vigilancia por sucursal</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex items-center gap-3 w-full lg:w-auto">
                        <div className="relative w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar guardia..."
                                className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none w-full lg:w-44"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>

                        <div className="relative w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                type="text"
                                placeholder="Buscar en notas..."
                                className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none w-full lg:w-44"
                                value={notesSearch}
                                onChange={(e) => setNotesSearch(e.target.value)}
                            />
                        </div>

                        <div className="flex gap-2 w-full lg:w-auto">
                            <div className="relative w-full">
                                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                <input
                                    type="date"
                                    className="pl-9 pr-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] md:text-sm focus:ring-2 focus:ring-blue-500 outline-none text-slate-700 font-bold w-full"
                                    value={startDateFilter}
                                    onChange={(e) => setStartDateFilter(e.target.value)}
                                    title="Fecha Desde"
                                />
                            </div>
                            <div className="relative w-full">
                                <input
                                    type="date"
                                    className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] md:text-sm focus:ring-2 focus:ring-blue-500 outline-none text-slate-700 font-bold w-full"
                                    value={endDateFilter}
                                    onChange={(e) => setEndDateFilter(e.target.value)}
                                    title="Fecha Hasta"
                                />
                            </div>
                        </div>

                        <select
                            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700 w-full lg:w-44"
                            value={resultFilter}
                            onChange={(e) => setResultFilter(e.target.value as any)}
                        >
                            <option value="all">Todos los resultados</option>
                            <option value="SIN_NOVEDAD">Sin Novedad</option>
                            <option value="CON_NOVEDAD">Con Novedad</option>
                            <option value="SOSPECHA">Sospecha</option>
                        </select>

                        <select
                            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700 w-full sm:col-span-2 lg:col-span-1 lg:w-44"
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
                        {paginatedRounds.map((round) => {
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

                                        {/* Round Notes - Swapped to middle */}
                                        {round.notes ? (
                                            <div className="flex-1 min-w-0">
                                                <div className="bg-amber-100/70 border border-amber-200 p-3 rounded-xl relative group/note">
                                                    <p className="text-[9px] font-black text-amber-800 uppercase tracking-tighter mb-1 select-none">Nota de Ronda:</p>
                                                    <div className="text-[11px] text-amber-900 font-bold leading-relaxed">
                                                        <span className="italic">"{round.notes.length > 120 ? round.notes.substring(0, 120) + '...' : round.notes}"</span>
                                                        {round.notes.length > 120 && (
                                                            <button 
                                                                onClick={() => {
                                                                    const fullNote = round.notes;
                                                                    showConfirmation({
                                                                        title: "Nota Completa de Ronda",
                                                                        message: fullNote || '',
                                                                        type: 'alert',
                                                                        onConfirm: () => {}
                                                                    });
                                                                }}
                                                                className="ml-1 text-amber-700 hover:text-amber-900 underline cursor-pointer"
                                                            >
                                                                Ver Más
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex-1 hidden lg:block"></div>
                                        )}

                                        {/* Time Info - Swapped to right-middle */}
                                        <div className="grid grid-cols-2 lg:flex items-center gap-4 sm:gap-6 bg-slate-50/50 lg:bg-transparent p-4 lg:p-0 rounded-2xl shrink-0">
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
                                        <div className="flex flex-row items-center gap-3 w-full lg:w-auto shrink-0 pr-2">
                                            <button
                                                onClick={() => setSelectedRound(round)}
                                                className="flex-1 lg:flex-none inline-flex items-center justify-center gap-2 px-6 py-4 lg:py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-blue-100 shrink-0"
                                            >
                                                <ExternalLink size={14} /> Ver Recorrido
                                            </button>

                                            <div className="hidden xl:block h-10 w-px bg-slate-100 mx-1"></div>

                                            <div className="flex gap-4 shrink-0">
                                                <div className="flex flex-col items-end min-w-[35px]">
                                                    <p className="text-[10px] font-black text-slate-300 uppercase">GPS</p>
                                                    <p className="text-sm md:text-base font-black text-slate-800 leading-none">{(round.path?.length || 0)}</p>
                                                </div>
                                                <div className="flex flex-col items-end min-w-[45px]">
                                                    <p className="text-[10px] font-black text-slate-300 uppercase">Fotos</p>
                                                    <div className="flex items-center gap-1">
                                                        <Camera size={14} className={(round.evidences?.length || 0) > 0 ? "text-amber-500" : "text-slate-300"} />
                                                        <p className={`text-sm md:text-base font-black leading-none ${(round.evidences?.length || 0) > 0 ? "text-slate-800" : "text-slate-300"}`}>
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
                                                        <div className="w-16 h-16 rounded-xl border-2 border-slate-100 flex items-center justify-center bg-slate-50 overflow-hidden relative group-hover/photo:border-blue-400 transition-colors">
                                                            <ThumbnailImage
                                                                photoUrl={evi.photoUrl}
                                                                alt="Evi"
                                                                className="w-full h-full object-cover"
                                                            />
                                                        </div>
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

                {/* Pagination Controls */}
                {filteredRounds.length > 0 && (
                    <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-500">Mostrar:</span>
                            <select
                                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700"
                                value={itemsPerPage}
                                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                            >
                                <option value={20}>20</option>
                                <option value={50}>50</option>
                            </select>
                            <span className="text-[10px] sm:text-xs font-bold text-slate-500 ml-2">
                                {startIndex + 1} - {Math.min(startIndex + itemsPerPage, filteredRounds.length)} de {filteredRounds.length}
                            </span>
                        </div>
                        
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                <ChevronLeft size={18} />
                            </button>
                            
                            <div className="flex items-center gap-1">
                                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                    let pageNum = currentPage;
                                    if (totalPages <= 5) {
                                        pageNum = i + 1;
                                    } else if (currentPage <= 3) {
                                        pageNum = i + 1;
                                    } else if (currentPage >= totalPages - 2) {
                                        pageNum = totalPages - 4 + i;
                                    } else {
                                        pageNum = currentPage - 2 + i;
                                    }
                                    
                                    return (
                                        <button
                                            key={pageNum}
                                            onClick={() => setCurrentPage(pageNum)}
                                            className={`w-8 h-8 rounded-lg text-sm font-bold transition-colors ${
                                                currentPage === pageNum 
                                                    ? 'bg-blue-600 text-white shadow-md shadow-blue-200' 
                                                    : 'bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100'
                                            }`}
                                        >
                                            {pageNum}
                                        </button>
                                    );
                                })}
                            </div>

                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                <ChevronRight size={18} />
                            </button>
                        </div>
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

            {/* Modal de Pruebas: Eliminar Rondas */}
            {showTestModal && (
                <div className="fixed inset-0 z-[10002] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
                                    <ShieldAlert size={20} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Zona de Pruebas</h3>
                                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none mt-1">Uso exclusivo de desarrollo</p>
                                </div>
                            </div>
                            <button
                                onClick={() => { setShowTestModal(false); setSelectedWorkerId(''); }}
                                className="p-1.5 hover:bg-slate-200 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-6 space-y-4">
                            <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl flex gap-2.5 items-start">
                                <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                                <p className="text-[11px] font-bold text-amber-800 leading-snug">
                                    Esta herramienta permite eliminar permanentemente todas las rondas registradas de un colaborador específico. Útil para limpiar datos de prueba.
                                </p>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Seleccionar Colaborador:</label>
                                <select
                                    value={selectedWorkerId}
                                    onChange={(e) => setSelectedWorkerId(e.target.value)}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="">-- Selecciona un colaborador --</option>
                                    {employees
                                        .sort((a, b) => a.firstName.localeCompare(b.firstName))
                                        .map((emp) => (
                                            <option key={emp.id} value={emp.id}>
                                                {emp.firstName} {emp.lastNamePaterno} ({emp.rut})
                                            </option>
                                        ))
                                    }
                                </select>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
                            <button
                                onClick={() => { setShowTestModal(false); setSelectedWorkerId(''); }}
                                className="flex-1 py-3 px-4 rounded-2xl text-slate-500 font-bold hover:bg-slate-100 transition text-xs uppercase tracking-wider"
                                disabled={isDeleting}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleDeleteUserRounds}
                                disabled={!selectedWorkerId || isDeleting}
                                className="flex-1 py-3 px-4 rounded-2xl bg-rose-600 text-white font-bold shadow-lg shadow-rose-100 hover:bg-rose-700 transition active:scale-95 text-xs uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-1.5"
                            >
                                {isDeleting ? (
                                    <>
                                        <Loader2 size={14} className="animate-spin" /> Eliminando...
                                    </>
                                ) : (
                                    <>
                                        <Trash2 size={14} /> Eliminar Rondas
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RoundsAdminPage;

const CheckCircle = ({ size, className }: { size: number, className: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
);
