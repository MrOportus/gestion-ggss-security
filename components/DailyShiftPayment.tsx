import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
    DollarSign, MapPin, FileText, CheckCircle,
    Plus, Search, Download, Trash2, Moon, Sun, ChevronDown, Pencil, X as CloseIcon, Save, Calendar
} from 'lucide-react';

import * as XLSX from 'xlsx';
import { DailyPayment } from '../types';

export const DailyShiftPayment = () => {
    const {
        currentUser, employees, sites, dailyPayments,
        fetchDailyPayments, addDailyPayment, markPaymentAsPaid, updateDailyPayment, deleteDailyPayment, bulkMarkAsPaid,
        showNotification, showConfirmation
    } = useAppStore();

    const [activeTab, setActiveTab] = useState<'create' | 'list' | 'reports'>('create');

    // --- STAGED PAYMENTS STATE (For Preview) ---
    const [stagedPayments, setStagedPayments] = useState<Omit<DailyPayment, 'id' | 'createdAt' | 'status'>[]>([]);

    // --- FORM STATE ---
    const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
    const [manualWorkerName, setManualWorkerName] = useState('');
    const [amount, setAmount] = useState<number | ''>('');
    const [siteId, setSiteId] = useState<string>('');
    const [description] = useState('');
    const [shiftDate, setShiftDate] = useState(new Date().toISOString().slice(0, 10)); // Default Today
    const [paymentDate, setPaymentDate] = useState<string>(''); // Optional, defaults to shiftDate
    const [isNightShift, setIsNightShift] = useState(false);

    const [isSubmitting, setIsSubmitting] = useState(false);

    // --- EDIT STATE ---
    const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
    const [editAmount, setEditAmount] = useState<number>(0);
    const [editDescription, setEditDescription] = useState<string>('');
    const [editShiftDate, setEditShiftDate] = useState<string>('');
    const [editPaymentDate, setEditPaymentDate] = useState<string>('');

    // --- SEARCH STATE ---
    const [workerSearch, setWorkerSearch] = useState('');
    const [siteSearch, setSiteSearch] = useState('');
    const [showWorkerList, setShowWorkerList] = useState(false);
    const [showSiteList, setShowSiteList] = useState(false);

    // --- LIST FILTER STATE ---
    const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [filterDay, setFilterDay] = useState(''); // YYYY-MM-DD
    const [listSearchTerm, setListSearchTerm] = useState('');


    const todayStr = new Date().toISOString().slice(0, 10);

    useEffect(() => {
        fetchDailyPayments();
    }, []);

    // --- COMPUTED HELPERS ---
    const filteredWorkers = useMemo(() => {
        if (!workerSearch) return employees.filter(e => e.isActive).slice(0, 10);
        const lower = workerSearch.toLowerCase();
        return employees.filter(e =>
            e.isActive && (
                e.firstName.toLowerCase().includes(lower) ||
                e.lastNamePaterno.toLowerCase().includes(lower) ||
                e.rut.toLowerCase().includes(lower)
            )
        ).slice(0, 10);
    }, [employees, workerSearch]);

    const filteredSites = useMemo(() => {
        if (!siteSearch) return sites.filter(s => s.active);
        const lower = siteSearch.toLowerCase();
        return sites.filter(s => s.active && s.name.toLowerCase().includes(lower));
    }, [sites, siteSearch]);

    const quickAmounts = [35000, 40000, 45000, 50000];

    // --- HANDLERS ---

    const handleStagePayment = () => {
        if ((!selectedWorkerId && !manualWorkerName) || !amount || !siteId) {
            showNotification("Complete Trabajador, Monto y Sucursal", "warning");
            return;
        }

        const workerName = selectedWorkerId
            ? (() => {
                const emp = employees.find(e => e.id === selectedWorkerId);
                return emp ? `${emp.firstName} ${emp.lastNamePaterno}` : 'Desconocido';
            })()
            : manualWorkerName;

        const siteName = sites.find(s => String(s.id) === siteId)?.name || 'Desconocida';

        const newStaged: Omit<DailyPayment, 'id' | 'createdAt' | 'status'> = {
            workerName,
            workerId: selectedWorkerId || undefined,
            amount: Number(amount),
            siteId,
            siteName,
            description,
            monthPeriod: new Date().toISOString().slice(0, 7), // Just fallback, usage logic might override
            shiftDate,
            paymentDate: paymentDate || shiftDate, // Apply default logic
            isNightShift
        };

        setStagedPayments([...stagedPayments, newStaged]);

        // Reset fields for next entry, KEEP SITE and DATE usually same for bulk
        setSelectedWorkerId('');
        setManualWorkerName('');
        setWorkerSearch('');
    };

    const handleRemoveStaged = (index: number) => {
        const temp = [...stagedPayments];
        temp.splice(index, 1);
        setStagedPayments(temp);
    };

    const handleSaveAll = async () => {
        if (stagedPayments.length === 0) return;
        setIsSubmitting(true);
        try {
            // Process sequentially
            for (const payment of stagedPayments) {
                const period = payment.shiftDate ? payment.shiftDate.slice(0, 7) : new Date().toISOString().slice(0, 7);

                await addDailyPayment({
                    ...payment,
                    monthPeriod: period
                });
            }
            setStagedPayments([]);
            setActiveTab('list');
            showNotification("Turnos guardados correctamente", "success");
        } catch (error) {
            console.error(error);
            showNotification("Error al guardar algunos turnos", "error");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        showConfirmation({
            title: "Eliminar Registro",
            message: "¿Seguro que desea eliminar este registro de pago?",
            onConfirm: async () => {
                try {
                    await deleteDailyPayment(id);
                    showNotification("Registro eliminado", "success");
                } catch (error) {
                    showNotification("Error al eliminar", "error");
                }
            }
        });
    };

    const startEditing = (payment: DailyPayment) => {
        setEditingPaymentId(payment.id);
        setEditAmount(payment.amount);
        setEditDescription(payment.description || '');
        setEditShiftDate(payment.shiftDate || '');
        setEditPaymentDate(payment.paymentDate || payment.shiftDate || '');
    };

    const cancelEditing = () => {
        setEditingPaymentId(null);
    };

    const saveEdit = async (id: string) => {
        try {
            await updateDailyPayment(id, {
                amount: editAmount,
                description: editDescription,
                shiftDate: editShiftDate,
                paymentDate: editPaymentDate,
                monthPeriod: editShiftDate.slice(0, 7) // Also update month period if date changes
            });
            setEditingPaymentId(null);
            showNotification("Registro actualizado", "success");
        } catch (error) {
            showNotification("Error al actualizar", "error");
        }
    };

    const handleBulkPayToday = async (isNight: boolean) => {
        const todayPayments = dailyPayments.filter(p =>
            p.shiftDate === todayStr &&
            p.status === 'PENDING' &&
            p.isNightShift === isNight
        );

        if (todayPayments.length === 0) {
            showNotification(`No hay turnos de ${isNight ? 'NOCHE' : 'DÍA'} pendientes para hoy`, "info");
            return;
        }

        const summary = todayPayments
            .map(p => `• ${p.workerName} - ${p.siteName}`)
            .join('\n');

        showConfirmation({
            title: "Pago Masivo",
            message: `¿Marcar como PAGADOS ${todayPayments.length} turnos de ${isNight ? 'NOCHE' : 'DÍA'} de hoy?\n\nResumen:\n${summary}`,
            onConfirm: async () => {
                try {
                    await bulkMarkAsPaid(todayPayments.map(p => p.id), currentUser?.email || 'admin');
                    showNotification(`${todayPayments.length} turnos pagados correctamente`, "success");
                } catch (error) {
                    showNotification("Error al procesar el pago masivo", "error");
                }
            }
        });
    };

    // --- FILTERED PAYMENTS LIST ---
    const filteredPayments = useMemo(() => {
        return dailyPayments.filter(p => {
            const matchesMonth = filterDay !== '' ? true : p.monthPeriod === filterMonth;
            const matchesDay = filterDay === '' || (p.paymentDate || p.shiftDate) === filterDay;
            const matchesSearch = p.workerName.toLowerCase().includes(listSearchTerm.toLowerCase()) ||
                p.siteName.toLowerCase().includes(listSearchTerm.toLowerCase());

            // Filtro por rol
            if (currentUser?.role === 'supervisor') {
                return matchesMonth && matchesDay && matchesSearch && p.createdBy === currentUser.uid;
            }

            return matchesMonth && matchesDay && matchesSearch;
        });
    }, [dailyPayments, filterMonth, filterDay, listSearchTerm, currentUser]);



    const reportData = useMemo(() => filteredPayments.filter(p => p.status === 'PAID'), [filteredPayments]);

    // --- HELPERS ---
    const formatDateForDisplay = (dateString?: string) => {
        if (!dateString) return '-';
        if (dateString.includes('T')) return new Date(dateString).toLocaleDateString();

        const [year, month, day] = dateString.split('-');
        return `${day}/${month}/${year}`;
    };

    const handleExport = () => {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(reportData.map(p => ({
            FechaTurno: formatDateForDisplay(p.shiftDate) || new Date(p.createdAt).toLocaleDateString(),
            FechaPago: formatDateForDisplay(p.paymentDate || p.shiftDate),
            Tipo: p.isNightShift ? 'NOCHE' : 'DIA',
            Trabajador: p.workerName,
            Monto: p.amount,
            Sucursal: p.siteName,
            Detalle: p.description,
            Estado: p.status,
        })));
        XLSX.utils.book_append_sheet(wb, ws, "Pagos");
        XLSX.writeFile(wb, `Reporte_Pagos_${filterMonth}.xlsx`);
    };

    // --- RENDER HELPERS ---
    const renderWorkerInput = () => (
        <div className="relative">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">Trabajador</label>
            <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                <input
                    type="text"
                    className="w-full pl-9 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Buscar por nombre o RUT..."
                    value={workerSearch}
                    onChange={(e) => { setWorkerSearch(e.target.value); setShowWorkerList(true); setSelectedWorkerId(''); setManualWorkerName(e.target.value); }}
                    onFocus={() => {
                        setWorkerSearch('');
                        setShowWorkerList(true);
                    }}
                    onBlur={() => {
                        setTimeout(() => {
                            if (!workerSearch && selectedWorkerId) {
                                const emp = employees.find(e => e.id === selectedWorkerId);
                                if (emp) setWorkerSearch(`${emp.firstName} ${emp.lastNamePaterno}`);
                            }
                            setShowWorkerList(false);
                        }, 200);
                    }}
                />
                {selectedWorkerId && (
                    <div className="absolute right-2 top-2 bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded font-bold">
                        Seleccionado
                    </div>
                )}
            </div>

            {showWorkerList && workerSearch && !selectedWorkerId && (
                <div className="absolute z-10 w-full bg-white border border-slate-200 mt-1 rounded-lg shadow-xl max-h-48 overflow-auto">
                    {filteredWorkers.map(emp => (
                        <div
                            key={emp.id}
                            className="px-4 py-2 hover:bg-blue-50 cursor-pointer text-sm border-b border-slate-50"
                            onClick={() => {
                                setSelectedWorkerId(emp.id);
                                setWorkerSearch(`${emp.firstName} ${emp.lastNamePaterno}`);
                                setManualWorkerName(`${emp.firstName} ${emp.lastNamePaterno}`);
                                setShowWorkerList(false);
                            }}
                        >
                            <div className="font-bold text-slate-700">{emp.firstName} {emp.lastNamePaterno}</div>
                            <div className="text-xs text-slate-400">{emp.rut} - {emp.cargo}</div>
                        </div>
                    ))}
                    {filteredWorkers.length === 0 && (
                        <div className="px-4 py-2 text-xs text-slate-400 italic">No encontrado. Se usará el nombre ingresado como manual.</div>
                    )}
                </div>
            )}
        </div>
    );

    const renderSiteInput = () => (
        <div className="relative">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 block">Sucursal / Obra</label>
            <div className="relative">
                <MapPin className="absolute left-3 top-2.5 text-slate-400" size={16} />
                <input
                    type="text"
                    className="w-full pl-9 pr-8 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
                    placeholder="Seleccionar sucursal..."
                    value={siteSearch}
                    onChange={(e) => { setSiteSearch(e.target.value); setShowSiteList(true); setSiteId(''); }}
                    onFocus={() => {
                        setSiteSearch('');
                        setShowSiteList(true);
                    }}
                    onBlur={() => {
                        setTimeout(() => {
                            if (!siteSearch && siteId) {
                                const s = sites.find(site => String(site.id) === siteId);
                                if (s) setSiteSearch(s.name);
                            }
                            setShowSiteList(false);
                        }, 200);
                    }}
                />
                <ChevronDown className="absolute right-3 top-3 text-slate-400" size={14} />
            </div>

            {showSiteList && (
                <div className="absolute z-10 w-full bg-white border border-slate-200 mt-1 rounded-lg shadow-xl max-h-48 overflow-auto">
                    {filteredSites.map(site => (
                        <div
                            key={site.id}
                            className="px-4 py-2 hover:bg-blue-50 cursor-pointer text-sm border-b border-slate-50"
                            onClick={() => {
                                setSiteId(String(site.id));
                                setSiteSearch(site.name);
                                setShowSiteList(false);
                            }}
                        >
                            <div className="font-bold text-slate-700">{site.name}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    if (currentUser?.role !== 'admin' && currentUser?.role !== 'supervisor') return <div className="p-8 text-center text-slate-400">Acceso Restringido</div>;

    return (
        <div className="space-y-6">
            {/* TABS */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-4">
                <div>
                    <h2 className="text-xl font-bold text-slate-800">Control de Turnos Diarios</h2>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                    {['create', 'list', 'reports'].filter(tab => {
                        if (tab === 'reports') return currentUser?.role === 'admin';
                        return true;
                    }).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab as any)}
                            className={`px-4 py-2 rounded-md text-xs font-bold uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            {tab === 'create' ? 'Ingreso Masivo' : tab === 'list' ? 'Historial/Pagos' : 'Reportes'}
                        </button>
                    ))}
                </div>
            </div>

            {/* CREATE / RECORD PAYMENTS */}
            {activeTab === 'create' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* FORM */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
                            <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2 mb-4">
                                <Plus className="text-blue-500" size={16} /> Agregar Turno
                            </h3>

                            {renderWorkerInput()}
                            {renderSiteInput()}

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block">Monto a Pagar</label>
                                <div className="flex flex-wrap gap-2 mb-2">
                                    {quickAmounts.map(amt => (
                                        <button
                                            key={amt}
                                            type="button"
                                            onClick={() => setAmount(amt)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${amount === amt ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-blue-300'}`}
                                        >
                                            ${amt / 1000}k
                                        </button>
                                    ))}
                                </div>
                                <div className="relative">
                                    <DollarSign className="absolute left-3 top-2.5 text-slate-400" size={16} />
                                    <input
                                        type="number"
                                        className="w-full pl-9 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-700"
                                        placeholder="Otro monto..."
                                        value={amount}
                                        onChange={(e) => setAmount(Number(e.target.value))}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block">Fecha Turno</label>
                                    <input
                                        type="date"
                                        className="w-full p-2 border border-slate-300 rounded-lg text-sm outline-none"
                                        value={shiftDate}
                                        onChange={(e) => setShiftDate(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block">Fecha Pago</label>
                                    <input
                                        type="date"
                                        className="w-full p-2 border border-slate-300 rounded-lg text-sm outline-none"
                                        value={paymentDate}
                                        onChange={(e) => setPaymentDate(e.target.value)}
                                        placeholder="Mismo día si vacío"
                                    />
                                </div>
                                <div className="space-y-1 pt-6 col-span-2">
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition ${isNightShift ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300 text-transparent'}`}>
                                            <CheckCircle size={14} className="text-white" />
                                        </div>
                                        <input type="checkbox" className="hidden" checked={isNightShift} onChange={(e) => setIsNightShift(e.target.checked)} />
                                        <span className={`text-xs font-bold uppercase tracking-wider ${isNightShift ? 'text-indigo-600' : 'text-slate-500 group-hover:text-indigo-400'}`}>
                                            Turno Noche {isNightShift && <Moon size={12} className="inline ml-1" />}
                                        </span>
                                    </label>
                                </div>
                            </div>

                            <button
                                onClick={handleStagePayment}
                                className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl shadow-lg hover:bg-black transition-transform active:scale-95"
                            >
                                Agregar a la Lista
                            </button>
                        </div>
                    </div>

                    {/* PREVIEW LIST */}
                    <div className="lg:col-span-2 flex flex-col h-full bg-slate-50/50 rounded-xl border border-slate-200 overflow-hidden">
                        <div className="p-4 border-b border-slate-200 bg-white flex justify-between items-center">
                            <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">
                                Pre-visualización ({stagedPayments.length})
                            </h3>
                            {stagedPayments.length > 0 && (
                                <div className="text-right">
                                    <span className="text-xs text-slate-500 mr-2">Total:</span>
                                    <span className="text-lg font-black text-emerald-600">
                                        ${stagedPayments.reduce((acc, curr) => acc + curr.amount, 0).toLocaleString()}
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="flex-1 overflow-auto p-4 space-y-3">
                            {stagedPayments.length === 0 ? (
                                <div className="h-48 flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-xl m-4">
                                    <FileText size={48} className="mb-2" />
                                    <p className="text-xs font-bold uppercase">Lista Vacía</p>
                                </div>
                            ) : (
                                stagedPayments.map((p, idx) => (
                                    <div key={idx} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col sm:flex-row sm:items-center gap-3 group hover:border-blue-200 transition relative">
                                        <div className="flex items-center gap-4">
                                            <div className="w-8 h-8 shrink-0 rounded-full bg-slate-100 flex items-center justify-center text-xs font-black text-slate-500">
                                                {idx + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-black text-slate-900 truncate uppercase tracking-tight text-sm">{p.workerName}</div>
                                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{p.siteName}</div>
                                            </div>
                                            <button
                                                onClick={() => handleRemoveStaged(idx)}
                                                className="sm:hidden p-2 text-rose-500 bg-rose-50 rounded-lg"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2 sm:flex-1 sm:justify-center">
                                            <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 rounded-lg text-[10px] font-bold text-slate-500">
                                                <Calendar size={12} /> {formatDateForDisplay(p.shiftDate)}
                                            </div>
                                            <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 rounded-lg text-[10px] font-black text-emerald-600 uppercase">
                                                <DollarSign size={12} /> Pago: {formatDateForDisplay(p.paymentDate)}
                                            </div>
                                            {p.isNightShift && (
                                                <div className="flex items-center gap-1.5 px-2 py-1 bg-indigo-50 rounded-lg text-[10px] font-black text-indigo-700 uppercase">
                                                    <Moon size={12} /> Noche
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center justify-between sm:justify-end gap-4 mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-0 border-slate-50">
                                            <div className="font-mono font-black text-lg text-slate-900">${p.amount.toLocaleString()}</div>
                                            <button
                                                onClick={() => handleRemoveStaged(idx)}
                                                className="hidden sm:block p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}

                        </div>

                        <div className="p-4 bg-white border-t border-slate-200">
                            <button
                                onClick={handleSaveAll}
                                disabled={stagedPayments.length === 0 || isSubmitting}
                                className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black uppercase tracking-widest rounded-xl shadow-xl shadow-emerald-100 transition-all active:scale-[0.98]"
                            >
                                {isSubmitting ? 'Procesando...' : `Confirmar y Cargar ${stagedPayments.length} Turnos`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* LIST & REPORTS */}
            {(activeTab === 'list' || (activeTab === 'reports' && currentUser?.role === 'admin')) && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    {/* Toolbar */}
                    <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-col space-y-4">
                        <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 w-full shadow-sm">
                            <Search size={18} className="text-slate-400" />
                            <input
                                type="text"
                                placeholder="Buscar por nombre o sucursal..."
                                className="text-sm outline-none w-full font-medium"
                                value={listSearchTerm}
                                onChange={(e) => setListSearchTerm(e.target.value)}
                            />
                        </div>


                        <div className="flex flex-wrap items-center gap-3">
                            <div className="flex flex-col">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter ml-1 mb-0.5">Filtrar Mes</span>
                                <input
                                    type="month"
                                    className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none font-medium text-slate-600"
                                    value={filterMonth}
                                    onChange={(e) => setFilterMonth(e.target.value)}
                                />
                            </div>
                            <div className="flex flex-col relative">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter ml-1 mb-0.5">Filtrar Día Pago</span>
                                <input
                                    type="date"
                                    className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none font-medium text-slate-600"
                                    value={filterDay}
                                    onChange={(e) => setFilterDay(e.target.value)}
                                />
                                {filterDay && (
                                    <button
                                        onClick={() => setFilterDay('')}
                                        className="absolute right-2 bottom-1.5 text-slate-400 hover:text-rose-500"
                                    >
                                        <CloseIcon size={14} />
                                    </button>
                                )}

                            </div>

                            {activeTab === 'list' && currentUser?.role === 'admin' && (
                                <>
                                    <button
                                        onClick={() => handleBulkPayToday(false)}
                                        className="flex items-center gap-2 px-3 py-2 bg-amber-500 text-white text-[10px] font-black uppercase tracking-wider rounded-lg hover:bg-amber-600 transition shadow-sm"
                                    >
                                        <Sun size={14} /> Pagar Día Hoy
                                    </button>
                                    <button
                                        onClick={() => handleBulkPayToday(true)}
                                        className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-wider rounded-lg hover:bg-indigo-700 transition shadow-sm"
                                    >
                                        <Moon size={14} /> Pagar Noche Hoy
                                    </button>
                                </>
                            )}
                            {activeTab === 'reports' && (
                                <button
                                    onClick={handleExport}
                                    className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-emerald-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-emerald-700 transition shadow-lg shadow-emerald-100"
                                >
                                    <Download size={14} /> Exportar Reporte
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Mobile Card List */}
                    <div className="block lg:hidden p-4 space-y-4 bg-slate-50/50">
                        {filteredPayments.map((payment) => {
                            const isPaid = payment.status === 'PAID';
                            const isPaymentToday = (payment.paymentDate || payment.shiftDate) === todayStr;

                            return (
                                <div key={payment.id} className={`bg-white p-5 rounded-3xl shadow-sm border ${isPaid ? 'border-emerald-100 bg-emerald-50/20' : isPaymentToday ? 'border-amber-200' : 'border-slate-100'} space-y-4`}>
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-1">
                                            <div className="text-sm font-black text-slate-800 uppercase tracking-tight">{payment.workerName}</div>
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{payment.siteName}</div>
                                        </div>
                                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter ${isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {isPaid ? 'PAGADO' : 'PENDIENTE'}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="p-3 bg-slate-50 rounded-2xl space-y-1 text-center">
                                            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Fecha Pago</div>
                                            <div className="text-[11px] font-black text-slate-700">{formatDateForDisplay(payment.paymentDate || payment.shiftDate)}</div>
                                        </div>
                                        <div className="p-3 bg-slate-50 rounded-2xl space-y-1 text-center">
                                            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Monto</div>
                                            <div className="text-[13px] font-black text-blue-600">${payment.amount.toLocaleString()}</div>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                                        <div className="flex gap-2">
                                            {payment.isNightShift ? <Moon size={14} className="text-indigo-600" /> : <Sun size={14} className="text-amber-500" />}
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Turno {payment.isNightShift ? 'Noche' : 'Día'}</span>
                                        </div>
                                        <div className="flex gap-2">
                                            {!isPaid && currentUser?.role === 'admin' && (
                                                <button onClick={() => markPaymentAsPaid(payment.id, currentUser?.email || 'admin')} className="text-[10px] font-black bg-slate-900 text-white px-3 py-1.5 rounded-xl uppercase tracking-widest">Pagar</button>
                                            )}
                                            <button onClick={() => startEditing(payment)} className="p-2 text-blue-500 bg-blue-50 rounded-xl"><Pencil size={14} /></button>
                                            {currentUser?.role === 'admin' && (
                                                <button onClick={() => handleDelete(payment.id)} className="p-2 text-rose-500 bg-rose-50 rounded-xl"><Trash2 size={14} /></button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="hidden lg:block overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                                    <th className="px-6 py-5">Fecha Turno</th>
                                    <th className="px-6 py-5">Fecha Pago</th>
                                    <th className="px-6 py-5 text-center">Tipo</th>
                                    <th className="px-6 py-5">Trabajador</th>
                                    <th className="px-6 py-5">Sucursal</th>
                                    <th className="px-6 py-5 text-right">Monto</th>
                                    <th className="px-6 py-5 text-center">Estado</th>
                                    {currentUser?.role === 'admin' && <th className="px-6 py-5">Responsable</th>}
                                    <th className="px-6 py-5 text-right">Acciones</th>
                                </tr>
                            </thead>

                            <tbody className="divide-y divide-slate-100">
                                {filteredPayments.map((payment) => {
                                    const isEditing = editingPaymentId === payment.id;
                                    const isPaid = payment.status === 'PAID';
                                    const isPaymentToday = (payment.paymentDate || payment.shiftDate) === todayStr;

                                    let rowStyle = {};
                                    if (isPaid) {
                                        rowStyle = { backgroundColor: 'rgba(16, 185, 129, 0.05)' }; // Emerald-50/50 approach
                                    } else if (isPaymentToday) {
                                        rowStyle = { backgroundColor: '#eaca70' };
                                    } else {
                                        rowStyle = { backgroundColor: '#becffa' };
                                    }

                                    return (
                                        <tr key={payment.id} style={rowStyle} className="hover:bg-opacity-80 transition-colors border-b border-white/20">
                                            <td className="px-6 py-4 text-xs font-bold text-slate-600">
                                                {isEditing ? (
                                                    <input
                                                        type="date"
                                                        className="w-full p-1 border border-blue-500 rounded text-xs outline-none"
                                                        value={editShiftDate}
                                                        onChange={(e) => setEditShiftDate(e.target.value)}
                                                    />
                                                ) : (
                                                    formatDateForDisplay(payment.shiftDate) || new Date(payment.createdAt).toLocaleDateString()
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-xs font-bold text-slate-600">
                                                {isEditing ? (
                                                    <input
                                                        type="date"
                                                        className="w-full p-1 border border-blue-500 rounded text-xs outline-none"
                                                        value={editPaymentDate}
                                                        onChange={(e) => setEditPaymentDate(e.target.value)}
                                                    />
                                                ) : (
                                                    formatDateForDisplay(payment.paymentDate || payment.shiftDate)
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                {payment.isNightShift ? (
                                                    <Moon size={14} className="text-indigo-600 inline" />
                                                ) : (
                                                    <Sun size={14} className="text-amber-500 inline" />
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-sm font-medium text-slate-800">{payment.workerName}</div>
                                                {!payment.workerId && <span className="text-[10px] text-amber-500 italic">Manual</span>}
                                            </td>
                                            <td className="px-6 py-4 text-xs text-slate-500">{payment.siteName}</td>
                                            <td className="px-6 py-4 text-right font-mono text-sm font-bold text-slate-700">
                                                {isEditing ? (
                                                    <input
                                                        type="number"
                                                        className="w-24 p-1 border border-blue-500 rounded text-right outline-none"
                                                        value={editAmount}
                                                        onChange={(e) => setEditAmount(Number(e.target.value))}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    `$${payment.amount.toLocaleString()}`
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${payment.status === 'PAID'
                                                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                                    : 'bg-yellow-100 text-yellow-700 border border-yellow-200'
                                                    }`}>
                                                    {payment.status === 'PAID' ? 'Pagado' : 'Pendiente'}
                                                </span>
                                            </td>
                                            {currentUser?.role === 'admin' && (
                                                <td className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase">
                                                    {payment.createdByName?.split('@')[0] || 'Admin'}
                                                </td>
                                            )}
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    {isEditing ? (
                                                        <>
                                                            <button onClick={() => saveEdit(payment.id)} className="p-1.5 text-emerald-600 hover:bg-emerald-100 rounded-lg transition" title="Guardar">
                                                                <Save size={16} />
                                                            </button>
                                                            <button onClick={cancelEditing} className="p-1.5 text-slate-400 hover:bg-slate-200 rounded-lg transition" title="Cancelar">
                                                                <CloseIcon size={16} />
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            {!isPaid && currentUser?.role === 'admin' && (
                                                                <button
                                                                    onClick={() => markPaymentAsPaid(payment.id, currentUser?.email || 'admin')}
                                                                    className="text-[10px] bg-slate-800 text-white px-2 py-1 rounded hover:bg-slate-700 shadow-sm transition-all font-bold"
                                                                >
                                                                    PAGAR
                                                                </button>
                                                            )}
                                                            <button onClick={() => startEditing(payment)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition" title="Editar">
                                                                <Pencil size={16} />
                                                            </button>
                                                            {currentUser?.role === 'admin' && (
                                                                <button onClick={() => handleDelete(payment.id)} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition" title="Eliminar">
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};
