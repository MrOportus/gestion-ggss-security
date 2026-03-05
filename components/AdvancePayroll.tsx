
import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import {
    Users, Trash2, Send, Search, Building2,
    DollarSign, CheckCircle, Clock, FileText, Download, Calendar, ArrowLeft,
    Filter, Info, AlertCircle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Employee } from '../types';

interface AdvancePayrollProps {
    onBack: () => void;
}

interface WorkerEntry {
    workerId: string;
    workerName: string;
    workerRut: string;
    amount: number;
    amountType: '50000' | '100000' | 'manual';
    manualAmount: string;
    siteId: string | number;
    siteName: string;
}

const AdvancePayroll: React.FC<AdvancePayrollProps> = ({ onBack }) => {
    const {
        currentUser, employees: storeEmployees, sites, advances,
        fetchAdvances, addAdvances, showNotification,
        deleteAdvance, markAdvanceAsPaid, bulkMarkAdvancesAsPaid
    } = useAppStore();

    const [activeTab, setActiveTab] = useState<'create' | 'list'>('create');
    const [selectedSiteId, setSelectedSiteId] = useState<string>('');
    const [siteSearch, setSiteSearch] = useState('');
    const [showSiteList, setShowSiteList] = useState(false);

    const [workerFilter, setWorkerFilter] = useState('');
    const [isLoadingWorkers, setIsLoadingWorkers] = useState(false);
    const [workersFromShifts, setWorkersFromShifts] = useState<Employee[]>([]);
    const [workerSiteMap, setWorkerSiteMap] = useState<Record<string, { siteId: string | number, siteName: string }>>({});

    const [selectedPeriod, setSelectedPeriod] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [currentNomina, setCurrentNomina] = useState<Record<string, WorkerEntry>>({});

    const [showConfirmModal, setShowConfirmModal] = useState(false);

    useEffect(() => {
        fetchAdvances();
    }, [fetchAdvances]);

    const selectedSite = sites.find(s => String(s.id) === selectedSiteId);

    const filteredSites = useMemo(() => {
        const lower = siteSearch.toLowerCase();
        return sites.filter(s => s.active && s.name.toLowerCase().includes(lower));
    }, [sites, siteSearch]);

    // LÓGICA DE FILTRADO POR TURNOS (BACKEND/QUERY)
    useEffect(() => {
        const fetchWorkers = async () => {
            if (!selectedSiteId || !selectedSite) {
                setWorkersFromShifts([]);
                return;
            }

            setIsLoadingWorkers(true);
            try {
                // Identificar sitios a consultar (Excepción Falabella)
                let siteIdsToQuery: (string | number)[] = [selectedSite.id];
                const isFalabella = selectedSite.name.toLowerCase().includes('falabella');

                if (isFalabella) {
                    const falabellaSites = sites.filter(s =>
                        s.name.toLowerCase().includes('falabella') ||
                        (selectedSite.rutEmpresa && s.rutEmpresa === selectedSite.rutEmpresa)
                    );
                    siteIdsToQuery = falabellaSites.map(s => s.id);
                }

                // Obtener periodo actual (mes en curso)
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
                const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

                // Consultar colección "programacion" (gestion_turnos)
                // Ajuste: Filtramos por fecha y luego localmente por sitio para evitar error de índice compuesto
                const q = query(
                    collection(db, 'programacion'),
                    where('date', '>=', startOfMonth),
                    where('date', '<=', endOfMonth)
                );

                // 1. Obtener IDs únicos de trabajadores con turnos programados
                const querySnapshot = await getDocs(q);
                const uniqueWorkerIds = new Set<string>();
                const tempWorkerSiteMap: Record<string, { siteId: string | number, siteName: string }> = {};

                querySnapshot.forEach(doc => {
                    const data = doc.data();

                    // Filtrado local por sitio (evita necesidad de índice compuesto en Firebase)
                    if (siteIdsToQuery.some(sid => String(sid) === String(data.siteId))) {
                        uniqueWorkerIds.add(data.employeeId);
                        if (!tempWorkerSiteMap[data.employeeId]) {
                            const s = sites.find(site => String(site.id) === String(data.siteId));
                            tempWorkerSiteMap[data.employeeId] = {
                                siteId: data.siteId,
                                siteName: s?.name || 'Desconocida'
                            };
                        }
                    }
                });

                // 2. FALLBACK/COMPLEMENTO: Incluir trabajadores asignados estáticamente a la sucursal
                // Buscamos en la lista de 'Colaboradores' por el campo currentSiteId
                storeEmployees.forEach(emp => {
                    if (emp.isActive && emp.currentSiteId && siteIdsToQuery.some(sid => String(sid) === String(emp.currentSiteId))) {
                        uniqueWorkerIds.add(emp.id);
                        if (!tempWorkerSiteMap[emp.id]) {
                            const s = sites.find(site => String(site.id) === String(emp.currentSiteId));
                            tempWorkerSiteMap[emp.id] = {
                                siteId: emp.currentSiteId,
                                siteName: s?.name || 'Asignación Directa'
                            };
                        }
                    }
                });

                setWorkerSiteMap(tempWorkerSiteMap);

                // Mapear IDs a perfiles completos (usando storeEmployees que vienen de la colección Colaboradores)
                const filtered = storeEmployees.filter(e => uniqueWorkerIds.has(e.id) && e.isActive);
                setWorkersFromShifts(filtered);

            } catch (error) {
                console.error("Error fetching workers from shifts:", error);
                showNotification("Error al cargar trabajadores de turnos.", "error");
            } finally {
                setIsLoadingWorkers(false);
            }
        };

        fetchWorkers();
    }, [selectedSiteId, selectedSite, sites, storeEmployees]);

    const handleUpdateWorkerAmount = (worker: Employee, type: '50000' | '100000' | 'manual', manualVal?: string) => {
        const siteInfo = workerSiteMap[worker.id] || { siteId: selectedSite?.id || '', siteName: selectedSite?.name || '' };

        setCurrentNomina(prev => {
            const newNomina = { ...prev };

            let amount = 0;
            if (type === '50000') amount = 50000;
            else if (type === '100000') amount = 100000;
            else if (manualVal !== undefined) amount = Number(manualVal) || 0;

            if (amount === 0 && type !== 'manual') {
                delete newNomina[worker.id];
            } else {
                newNomina[worker.id] = {
                    workerId: worker.id,
                    workerName: `${worker.firstName} ${worker.lastNamePaterno}`,
                    workerRut: worker.rut,
                    amount: amount,
                    amountType: type,
                    manualAmount: manualVal || '',
                    siteId: siteInfo.siteId,
                    siteName: siteInfo.siteName
                };
            }
            return newNomina;
        });
    };

    const handleSaveNomina = async () => {
        const nominaList = Object.values(currentNomina).filter(n => n.amount > 0);
        if (nominaList.length === 0) {
            showNotification("Debe asignar montos a al menos un trabajador.", "warning");
            return;
        }

        try {
            const now = new Date();
            const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

            // Periodo actual: el mes que estamos cursando
            const monthPeriod = now.toISOString().slice(0, 7);
            const currentMonthName = monthNames[now.getMonth()];
            const paymentDateLabel = `15 de ${currentMonthName} ${now.getFullYear()}`;

            const payload = nominaList.map(n => ({
                workerId: n.workerId,
                workerName: n.workerName,
                amount: n.amount,
                siteId: n.siteId,
                siteName: n.siteName,
                createdBy: currentUser?.uid || 'unknown',
                createdByName: currentUser?.email || 'Admin',
                paymentDate: paymentDateLabel,
                monthPeriod
            }));

            await addAdvances(payload);
            showNotification("Nómina de anticipos guardada exitosamente.", "success");
            setCurrentNomina({});
            setWorkersFromShifts([]);
            setSelectedSiteId('');
            setSiteSearch('');
            setShowConfirmModal(false);
            setActiveTab('list');
        } catch (error) {
            showNotification("Error al guardar la nómina.", "error");
        }
    };

    const filteredWorkersDisplay = useMemo(() => {
        const lower = workerFilter.toLowerCase();
        return workersFromShifts.filter(w =>
            w.firstName.toLowerCase().includes(lower) ||
            w.lastNamePaterno.toLowerCase().includes(lower) ||
            w.rut.toLowerCase().includes(lower)
        );
    }, [workersFromShifts, workerFilter]);

    const totalNominaAmount = useMemo(() => {
        return Object.values(currentNomina).reduce((acc, curr) => acc + curr.amount, 0);
    }, [currentNomina]);

    const totalNominaWorkers = useMemo(() => {
        return Object.values(currentNomina).filter(n => n.amount > 0).length;
    }, [currentNomina]);

    const advancesGroupedBySite = useMemo(() => {
        const groups: Record<string, { count: number, total: number }> = {};
        Object.values(currentNomina).forEach(n => {
            if (n.amount > 0) {
                if (!groups[n.siteName]) groups[n.siteName] = { count: 0, total: 0 };
                groups[n.siteName].count += 1;
                groups[n.siteName].total += n.amount;
            }
        });
        return groups;
    }, [currentNomina]);

    const filteredAdvances = useMemo(() => {
        let base = advances;
        if (currentUser?.role !== 'admin') {
            base = base.filter(a => a.createdBy === currentUser?.uid);
        }
        return base.filter(a => a.monthPeriod === selectedPeriod);
    }, [advances, currentUser, selectedPeriod]);


    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <h2 className="text-xl font-bold text-slate-800">Nómina de Anticipos</h2>
                </div>

                <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button
                        onClick={() => setActiveTab('create')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'create' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
                    >
                        Generar Nueva
                    </button>
                    <button
                        onClick={() => setActiveTab('list')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
                    >
                        Historial
                    </button>
                </div>
            </div>

            {activeTab === 'create' ? (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* Sidebar: Site Selection & Resumen */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                <Building2 size={18} className="text-blue-500" />
                                Sucursal
                            </h3>
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Buscar sucursal..."
                                    className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={siteSearch}
                                    onChange={(e) => { setSiteSearch(e.target.value); setShowSiteList(true); }}
                                    onFocus={() => {
                                        setSiteSearch('');
                                        setShowSiteList(true);
                                    }}
                                    onBlur={() => {
                                        // Delay para permitir que el click en la lista funcione
                                        setTimeout(() => {
                                            if (!siteSearch && selectedSite) setSiteSearch(selectedSite.name);
                                            setShowSiteList(false);
                                        }, 200);
                                    }}
                                />
                                <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                                {showSiteList && (
                                    <div className="absolute top-full left-0 w-full mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-48 overflow-auto">
                                        {filteredSites.map(s => (
                                            <button
                                                key={s.id}
                                                className="w-full text-left px-4 py-2 text-sm hover:bg-blue-50 border-b border-slate-50 last:border-0"
                                                onClick={() => {
                                                    setSelectedSiteId(String(s.id));
                                                    setSiteSearch(s.name);
                                                    setShowSiteList(false);
                                                }}
                                            >
                                                {s.name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            {selectedSite && selectedSite.name.toLowerCase().includes('falabella') && (
                                <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl flex items-start gap-2">
                                    <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
                                    <p className="text-[10px] text-amber-700 font-medium leading-tight">
                                        Modo Falabella Activo: Cargando trabajadores de todas las sucursales vinculadas.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* RESUMEN DE NÓMINA EN TIEMPO REAL */}
                        <div className="bg-slate-900 p-6 rounded-2xl text-white shadow-lg sticky top-6">
                            <div className="flex justify-between items-center mb-6">
                                <div className="space-y-1">
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Resumen de Carga</h3>
                                    <div className="text-2xl font-black text-white">
                                        ${totalNominaAmount.toLocaleString('es-CL')}
                                    </div>
                                </div>
                                <div className="w-12 h-12 bg-blue-500/20 rounded-2xl flex items-center justify-center text-blue-400">
                                    <DollarSign size={24} />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex justify-between items-center py-2 border-b border-slate-800">
                                    <span className="text-xs text-slate-400">Trabajadores seleccionados</span>
                                    <span className="text-sm font-bold text-white">{totalNominaWorkers}</span>
                                </div>
                                <div className="flex justify-between items-center py-2 border-b border-slate-800">
                                    <span className="text-xs text-slate-400">Periodo</span>
                                    <span className="text-sm font-bold text-white text-right">
                                        {new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric' }).format(new Date()).toUpperCase()}
                                    </span>
                                </div>
                            </div>

                            <button
                                onClick={() => setShowConfirmModal(true)}
                                disabled={totalNominaWorkers === 0}
                                className="w-full mt-8 bg-blue-600 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-lg shadow-blue-900/40 disabled:opacity-50 disabled:shadow-none hover:scale-[1.02] active:scale-[0.98]"
                            >
                                <Send size={18} />
                                Enviar Nómina
                            </button>
                        </div>
                    </div>

                    {/* Main Content: Worker List Table */}
                    <div className="lg:col-span-3">
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full min-h-[600px]">
                            {/* Table Toolbar */}
                            <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                <div>
                                    <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wider">Carga Masiva Contextual</h3>
                                    <p className="text-[10px] text-slate-400 font-medium">Listado basado en programacion de turnos vigente</p>
                                </div>

                                <div className="relative w-full md:w-64">
                                    <input
                                        type="text"
                                        placeholder="Filtrar por nombre o RUT..."
                                        className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={workerFilter}
                                        onChange={(e) => setWorkerFilter(e.target.value)}
                                    />
                                    <Filter className="absolute left-3 top-2.5 text-slate-400" size={14} />
                                </div>
                            </div>

                            <div className="flex-1 overflow-auto">
                                {!selectedSiteId ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400 p-12 space-y-4">
                                        <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center">
                                            <Building2 size={40} strokeWidth={1.5} className="text-slate-300" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-sm font-bold text-slate-600">Seleccione una sucursal</p>
                                            <p className="text-xs">Para cargar automáticamente a los trabajadores con turnos.</p>
                                        </div>
                                    </div>
                                ) : isLoadingWorkers ? (
                                    <div className="h-full flex flex-col items-center justify-center p-12 space-y-4">
                                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                                        <p className="text-xs text-slate-500 font-medium italic">Consultando turnos en Firebase...</p>
                                    </div>
                                ) : filteredWorkersDisplay.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400 p-12 space-y-4">
                                        <Users size={48} strokeWidth={1} />
                                        <p className="text-sm">No se encontraron trabajadores programados en esta sucursal.</p>
                                    </div>
                                ) : (
                                    <table className="w-full text-left border-collapse">
                                        <thead className="sticky top-0 bg-white z-10 border-b border-slate-100 shadow-sm">
                                            <tr className="text-[10px] font-bold text-slate-500 uppercase">
                                                <th className="px-6 py-4">Identificación</th>
                                                <th className="px-6 py-4">Sucursal Asignada</th>
                                                <th className="px-6 py-4">Selector de Monto (Acción Rápida)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {filteredWorkersDisplay.map((worker) => {
                                                const entry = currentNomina[worker.id];
                                                return (
                                                    <tr key={worker.id} className={`hover:bg-slate-50 transition-colors ${entry?.amount > 0 ? 'bg-blue-50/30' : ''}`}>
                                                        <td className="px-6 py-4">
                                                            <div className="font-bold text-slate-800 text-sm">{worker.firstName} {worker.lastNamePaterno}</div>
                                                            <div className="text-[10px] text-slate-400 font-mono">{worker.rut}</div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 rounded text-[9px] font-bold text-slate-600">
                                                                <Building2 size={10} />
                                                                {workerSiteMap[worker.id]?.siteName || 'Cargando...'}
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    onClick={() => handleUpdateWorkerAmount(worker, '50000')}
                                                                    className={`px-4 py-2 text-xs font-bold rounded-xl border transition-all ${entry?.amountType === '50000' ? 'bg-blue-600 text-white border-blue-600 shadow-md scale-105' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'}`}
                                                                >
                                                                    $50.000
                                                                </button>
                                                                <button
                                                                    onClick={() => handleUpdateWorkerAmount(worker, '100000')}
                                                                    className={`px-4 py-2 text-xs font-bold rounded-xl border transition-all ${entry?.amountType === '100000' ? 'bg-blue-600 text-white border-blue-600 shadow-md scale-105' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'}`}
                                                                >
                                                                    $100.000
                                                                </button>

                                                                <div className="relative group/input">
                                                                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all ${entry?.amountType === 'manual' ? 'border-blue-500 ring-2 ring-blue-50 shadow-sm' : 'border-slate-200'}`}>
                                                                        <span className="text-slate-400 text-xs font-bold">$</span>
                                                                        <input
                                                                            type="number"
                                                                            placeholder="Otro..."
                                                                            className="w-20 text-xs font-bold outline-none bg-transparent"
                                                                            value={entry?.amountType === 'manual' ? entry.manualAmount : ''}
                                                                            onChange={(e) => handleUpdateWorkerAmount(worker, 'manual', e.target.value)}
                                                                        />
                                                                    </div>
                                                                </div>

                                                                {entry?.amount > 0 && (
                                                                    <button
                                                                        onClick={() => handleUpdateWorkerAmount(worker, 'manual', '0')}
                                                                        className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                                                                    >
                                                                        <Trash2 size={16} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                /* HISTORIAL DE ANTICIPOS (TAB 2) */
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden min-h-[600px] flex flex-col">
                    <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                        <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wider">Historial de Anticipos</h3>
                        <div className="flex flex-wrap items-center gap-4">
                            <div className="flex items-center gap-2 bg-white border border-slate-200 px-3 py-1.5 rounded-xl">
                                <Calendar size={14} className="text-slate-400" />
                                <select
                                    value={selectedPeriod}
                                    onChange={(e) => setSelectedPeriod(e.target.value)}
                                    className="text-xs font-bold text-slate-700 outline-none bg-transparent"
                                >
                                    {[...new Set([new Date().toISOString().slice(0, 7), ...advances.map(a => a.monthPeriod)])].sort().reverse().map(p => (
                                        <option key={p} value={p}>{p}</option>
                                    ))}
                                </select>
                            </div>
                            {currentUser?.role === 'admin' && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => {
                                            const wb = XLSX.utils.book_new();
                                            const wsData = filteredAdvances.map(a => ({
                                                'FECHA INGRESO': new Date(a.createdAt).toLocaleDateString('es-CL'),
                                                'HORA': new Date(a.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
                                                'TRABAJADOR': a.workerName,
                                                'SUCURSAL': a.siteName,
                                                'MONTO': a.amount,
                                                'RESPONSABLE': a.createdByName,
                                                'ESTADO': a.status === 'PAID' ? 'PAGADO' : 'PENDIENTE',
                                                'FECHA PAGO EST.': a.paymentDate
                                            }));
                                            const ws = XLSX.utils.json_to_sheet(wsData);
                                            XLSX.utils.book_append_sheet(wb, ws, `Anticipos_${selectedPeriod}`);
                                            XLSX.writeFile(wb, `Nomina_Anticipos_${selectedPeriod}.xlsx`);
                                        }}
                                        className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-colors shadow-sm"
                                    >
                                        <Download size={14} /> Exportar
                                    </button>
                                    <button
                                        onClick={async () => {
                                            const pendingIds = filteredAdvances.filter(a => a.status === 'PENDING').map(a => a.id);
                                            if (pendingIds.length > 0 && window.confirm('¿Pagar todos los pendientes?')) {
                                                await bulkMarkAdvancesAsPaid(pendingIds);
                                            }
                                        }}
                                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors shadow-sm"
                                    >
                                        <DollarSign size={14} /> Pagar Todo
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto">
                        {filteredAdvances.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 p-20 space-y-4">
                                <FileText size={48} strokeWidth={1.2} />
                                <p className="text-sm">No hay registros de anticipos para mostrar.</p>
                            </div>
                        ) : (
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="text-[10px] font-bold text-slate-500 uppercase border-b border-slate-100">
                                        <th className="px-6 py-3">Fecha Ingreso</th>
                                        <th className="px-6 py-3">Trabajador</th>
                                        <th className="px-6 py-3">Sucursal</th>
                                        <th className="px-6 py-3">Monto</th>
                                        <th className="px-6 py-3">Estado</th>
                                        {currentUser?.role === 'admin' && <th className="px-6 py-3 text-right">Acciones</th>}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {filteredAdvances.map((adv) => (
                                        <tr key={adv.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="text-xs font-medium text-slate-800">
                                                    {new Date(adv.createdAt).toLocaleDateString('es-CL')}
                                                </div>
                                                <div className="text-[10px] text-slate-400">
                                                    {new Date(adv.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 font-bold text-slate-800 text-sm">{adv.workerName}</td>
                                            <td className="px-6 py-4 text-xs font-medium text-slate-600">{adv.siteName}</td>
                                            <td className="px-6 py-4 font-black text-slate-900">${adv.amount.toLocaleString('es-CL')}</td>
                                            <td className="px-6 py-4">
                                                {adv.status === 'PAID' ? (
                                                    <span className="flex items-center gap-1.5 text-emerald-600 font-bold text-[10px] uppercase">
                                                        <CheckCircle size={14} /> Pagado
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center gap-1.5 text-amber-600 font-bold text-[10px] uppercase">
                                                        <Clock size={14} /> Pendiente
                                                    </span>
                                                )}
                                                <div className="text-[9px] text-slate-400 mt-0.5 font-medium">Pago: {adv.paymentDate}</div>
                                            </td>
                                            {currentUser?.role === 'admin' && (
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex justify-end gap-1">
                                                        {adv.status === 'PENDING' && (
                                                            <button
                                                                onClick={() => markAdvanceAsPaid(adv.id)}
                                                                className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                                            >
                                                                <CheckCircle size={16} />
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => { if (window.confirm('¿Eliminar registro?')) deleteAdvance(adv.id); }}
                                                            className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {/* MODAL DE CONFIRMACIÓN (REQUERIMIENTO 4) */}
            {showConfirmModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="bg-blue-600 p-8 text-white">
                            <h3 className="text-2xl font-black mb-1">Confirmar Generación</h3>
                            <p className="text-blue-100/80 text-sm">Verifique el resumen antes de procesar el envío masivo.</p>
                        </div>

                        <div className="p-8 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total de Dinero</p>
                                    <p className="text-2xl font-black text-slate-900">${totalNominaAmount.toLocaleString('es-CL')}</p>
                                </div>
                                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Trabajadores</p>
                                    <p className="text-2xl font-black text-slate-900">{totalNominaWorkers} Personas</p>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                    <Building2 size={14} />
                                    Desglose por Sucursal
                                </h4>
                                <div className="max-h-48 overflow-auto border border-slate-100 rounded-2xl divide-y divide-slate-100">
                                    {Object.entries(advancesGroupedBySite).map(([siteName, stats]) => (
                                        <div key={siteName} className="p-4 flex justify-between items-center hover:bg-slate-50 transition-colors">
                                            <div className="space-y-0.5">
                                                <p className="text-sm font-bold text-slate-800">{siteName}</p>
                                                <p className="text-[10px] text-slate-400">{stats.count} colaboradores asignados</p>
                                            </div>
                                            <p className="text-sm font-black text-blue-600">${stats.total.toLocaleString('es-CL')}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                                <AlertCircle className="text-blue-600 shrink-0" size={20} />
                                <p className="text-[10px] text-blue-700 font-medium">
                                    Al confirmar, se guardarán {totalNominaWorkers} registros individuales en la base de datos de anticipos. Asegúrese que los montos sean correctos.
                                </p>
                            </div>
                        </div>

                        <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-4">
                            <button
                                onClick={() => setShowConfirmModal(false)}
                                className="flex-1 px-6 py-4 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleSaveNomina}
                                className="flex-1 px-6 py-4 bg-blue-600 text-white rounded-xl font-black shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all"
                            >
                                CONFIRMAR Y ENVIAR
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdvancePayroll;
