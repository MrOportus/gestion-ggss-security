
import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
    Users, Trash2, Send, Search, Building2,
    DollarSign, CheckCircle, Clock, FileText, Download, Calendar
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface AdvancePayrollProps {
    onBack: () => void;
}

const AdvancePayroll: React.FC<AdvancePayrollProps> = ({ onBack }) => {
    const {
        currentUser, employees, sites, advances,
        fetchAdvances, addAdvances, showNotification,
        deleteAdvance, markAdvanceAsPaid, bulkMarkAdvancesAsPaid
    } = useAppStore();

    const [activeTab, setActiveTab] = useState<'create' | 'list'>('create');
    const [selectedSiteId, setSelectedSiteId] = useState<string>('');
    const [siteSearch, setSiteSearch] = useState('');
    const [showSiteList, setShowSiteList] = useState(false);

    const [workerSearch, setWorkerSearch] = useState('');
    const [showWorkerList, setShowWorkerList] = useState(false);

    const [selectedPeriod, setSelectedPeriod] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM

    const [currentNomina, setCurrentNomina] = useState<{
        workerId: string;
        workerName: string;
        amount: number;
        amountType: '50000' | '100000' | 'manual';
        manualAmount: string;
    }[]>([]);

    useEffect(() => {
        fetchAdvances();
    }, [fetchAdvances]);

    const selectedSite = sites.find(s => String(s.id) === selectedSiteId);

    const filteredSites = useMemo(() => {
        const lower = siteSearch.toLowerCase();
        return sites.filter(s => s.active && s.name.toLowerCase().includes(lower));
    }, [sites, siteSearch]);

    const filteredWorkers = useMemo(() => {
        const lower = workerSearch.toLowerCase();
        return employees.filter(e =>
            e.isActive &&
            (e.firstName.toLowerCase().includes(lower) || e.lastNamePaterno.toLowerCase().includes(lower) || e.rut.toLowerCase().includes(lower))
        );
    }, [employees, workerSearch]);

    const handleAddWorkerToNomina = (worker: typeof employees[0]) => {
        if (currentNomina.some(n => n.workerId === worker.id)) {
            showNotification("Este trabajador ya está en la nómina actual.", "warning");
            return;
        }
        setCurrentNomina([...currentNomina, {
            workerId: worker.id,
            workerName: `${worker.firstName} ${worker.lastNamePaterno}`,
            amount: 50000,
            amountType: '50000',
            manualAmount: ''
        }]);
        setWorkerSearch('');
        setShowWorkerList(false);
    };

    const updateNominaAmount = (index: number, type: '50000' | '100000' | 'manual', manualVal?: string) => {
        const newNomina = [...currentNomina];
        newNomina[index].amountType = type;
        if (type === '50000') newNomina[index].amount = 50000;
        else if (type === '100000') newNomina[index].amount = 100000;
        else if (manualVal !== undefined) {
            newNomina[index].manualAmount = manualVal;
            newNomina[index].amount = Number(manualVal) || 0;
        }
        setCurrentNomina(newNomina);
    };

    const removeFromNomina = (index: number) => {
        setCurrentNomina(currentNomina.filter((_, i) => i !== index));
    };

    const handleSaveNomina = async () => {
        if (!selectedSiteId || currentNomina.length === 0) {
            showNotification("Debe seleccionar una sucursal y agregar al menos un trabajador.", "warning");
            return;
        }

        if (currentNomina.some(n => n.amount <= 0)) {
            showNotification("Todos los montos deben ser mayores a cero.", "warning");
            return;
        }

        try {
            const now = new Date();
            const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
            const paymentDate = `15 de ${monthNames[now.getMonth()]} ${now.getFullYear()}`;
            const monthPeriod = now.toISOString().slice(0, 7);

            const payload = currentNomina.map(n => ({
                workerId: n.workerId,
                workerName: n.workerName,
                amount: n.amount,
                siteId: selectedSiteId,
                siteName: selectedSite?.name || 'Desconocida',
                createdBy: currentUser?.uid || 'unknown',
                createdByName: currentUser?.email || 'Admin',
                paymentDate,
                monthPeriod
            }));

            await addAdvances(payload);
            showNotification("Nómina de anticipos guardada exitosamente.", "success");
            setCurrentNomina([]);
            setActiveTab('list');
        } catch (error) {
            showNotification("Error al guardar la nómina.", "error");
        }
    };

    const filteredAdvances = useMemo(() => {
        let base = advances;
        if (currentUser?.role !== 'admin') {
            base = base.filter(a => a.createdBy === currentUser?.uid);
        }
        return base.filter(a => a.monthPeriod === selectedPeriod);
    }, [advances, currentUser, selectedPeriod]);

    const handlePayAll = async () => {
        const pendingIds = filteredAdvances.filter(a => a.status === 'PENDING').map(a => a.id);
        if (pendingIds.length === 0) {
            showNotification("No hay anticipos pendientes en este periodo.", "info");
            return;
        }

        if (window.confirm(`¿Marcar ${pendingIds.length} anticipos como pagados?`)) {
            try {
                await bulkMarkAdvancesAsPaid(pendingIds);
                showNotification("Todos los anticipos fueron marcados como pagados.", "success");
            } catch (error) {
                showNotification("Error al procesar el pago masivo.", "error");
            }
        }
    };

    const handleExportExcel = () => {
        if (filteredAdvances.length === 0) {
            showNotification("No hay datos para exportar en el periodo seleccionado.", "warning");
            return;
        }

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
    };

    const periods = useMemo(() => {
        const p = new Set<string>();
        p.add(new Date().toISOString().slice(0, 7));
        advances.forEach(a => p.add(a.monthPeriod));
        return Array.from(p).sort().reverse().slice(0, 12);
    }, [advances]);

    const totalNomina = currentNomina.reduce((acc, curr) => acc + curr.amount, 0);

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button onClick={onBack} className="text-sm font-bold text-blue-600 hover:text-blue-800">
                        ← Volver
                    </button>
                    <h2 className="text-xl font-bold text-slate-800">Nómina de Anticipos</h2>
                </div>

                <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button
                        onClick={() => setActiveTab('create')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'create' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
                    >
                        Nueva Nómina
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
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                <Building2 size={18} className="text-blue-500" />
                                Ubicación
                            </h3>
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Buscar sucursal/obra..."
                                    className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={siteSearch || (selectedSite?.name || '')}
                                    onChange={(e) => { setSiteSearch(e.target.value); setShowSiteList(true); }}
                                    onFocus={() => setShowSiteList(true)}
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
                        </div>

                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                <Users size={18} className="text-blue-500" />
                                Agregar Trabajador
                            </h3>
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Buscar por nombre o RUT..."
                                    className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={workerSearch}
                                    onChange={(e) => { setWorkerSearch(e.target.value); setShowWorkerList(true); }}
                                    onFocus={() => setShowWorkerList(true)}
                                />
                                <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                                {showWorkerList && workerSearch.length > 0 && (
                                    <div className="absolute top-full left-0 w-full mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-60 overflow-auto">
                                        {filteredWorkers.map(e => (
                                            <button
                                                key={e.id}
                                                className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-slate-50 last:border-0"
                                                onClick={() => handleAddWorkerToNomina(e)}
                                            >
                                                <div className="text-sm font-bold text-slate-700">{e.firstName} {e.lastNamePaterno}</div>
                                                <div className="text-[10px] text-slate-400 font-mono">{e.rut}</div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="bg-blue-600 p-6 rounded-2xl text-white shadow-lg shadow-blue-200">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-blue-100 text-sm">Resumen Nómina</span>
                                <DollarSign size={20} />
                            </div>
                            <div className="text-3xl font-black">
                                ${totalNomina.toLocaleString('es-CL')}
                            </div>
                            <p className="text-blue-100 text-[10px] mt-2 font-medium uppercase tracking-wider">
                                Total para el día 15
                            </p>
                            <button
                                onClick={handleSaveNomina}
                                disabled={currentNomina.length === 0}
                                className="w-full mt-6 bg-white text-blue-600 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-blue-50 transition-colors disabled:opacity-50"
                            >
                                <Send size={18} />
                                Enviar Nómina
                            </button>
                        </div>
                    </div>

                    <div className="lg:col-span-2">
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full min-h-[500px]">
                            <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                                <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wider">Detalle de la Nómina</h3>
                                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold">
                                    {currentNomina.length} REGISTROS
                                </span>
                            </div>
                            <div className="flex-1 overflow-auto">
                                {currentNomina.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400 p-12 space-y-4">
                                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                                            <Users size={32} strokeWidth={1.5} />
                                        </div>
                                        <p className="text-sm font-medium">No se han agregado trabajadores.</p>
                                    </div>
                                ) : (
                                    <table className="w-full text-left border-collapse">
                                        <thead className="sticky top-0 bg-white z-10 border-b border-slate-100">
                                            <tr className="text-[10px] font-bold text-slate-500 uppercase">
                                                <th className="px-6 py-3">Trabajador</th>
                                                <th className="px-6 py-3">Monto Anticipio</th>
                                                <th className="px-6 py-3 text-right">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {currentNomina.map((item, index) => (
                                                <tr key={item.workerId} className="hover:bg-slate-50 group">
                                                    <td className="px-6 py-4">
                                                        <div className="font-bold text-slate-800 text-sm">{item.workerName}</div>
                                                        <div className="text-[10px] text-slate-400 font-mono">ID: {item.workerId.slice(-6)}</div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex flex-wrap gap-2">
                                                            <button
                                                                onClick={() => updateNominaAmount(index, '50000')}
                                                                className={`px-3 py-1 text-[11px] font-bold rounded-lg border transition-all ${item.amountType === '50000' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'}`}
                                                            >
                                                                $50.000
                                                            </button>
                                                            <button
                                                                onClick={() => updateNominaAmount(index, '100000')}
                                                                className={`px-3 py-1 text-[11px] font-bold rounded-lg border transition-all ${item.amountType === '100000' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'}`}
                                                            >
                                                                $100.000
                                                            </button>
                                                            <div className="relative">
                                                                <DollarSign size={12} className="absolute left-2 top-2 text-slate-400" />
                                                                <input
                                                                    type="number"
                                                                    placeholder="Manual..."
                                                                    className={`pl-6 pr-2 py-1 text-[11px] font-bold rounded-lg border outline-none w-28 ${item.amountType === 'manual' ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'}`}
                                                                    value={item.amountType === 'manual' ? item.manualAmount : ''}
                                                                    onChange={(e) => updateNominaAmount(index, 'manual', e.target.value)}
                                                                />
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <button
                                                            onClick={() => removeFromNomina(index)}
                                                            className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
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
                                    {periods.map(p => (
                                        <option key={p} value={p}>{p}</option>
                                    ))}
                                </select>
                            </div>
                            {currentUser?.role === 'admin' && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleExportExcel}
                                        className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-colors shadow-sm"
                                    >
                                        <Download size={14} /> Exportar Excel
                                    </button>
                                    <button
                                        onClick={handlePayAll}
                                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors shadow-sm"
                                    >
                                        <DollarSign size={14} /> Pagar Todo
                                    </button>
                                </div>
                            )}
                            <div className="flex gap-2 border-l border-slate-200 pl-4">
                                <span className="flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-amber-600 uppercase">
                                    <Clock size={14} /> Pendientes
                                </span>
                                <span className="flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-emerald-600 uppercase">
                                    <CheckCircle size={14} /> Pagados
                                </span>
                            </div>
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
                                        <th className="px-6 py-3">Responsable</th>
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
                                                <div className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full inline-block font-bold">
                                                    {adv.createdByName.split('@')[0].toUpperCase()}
                                                </div>
                                            </td>
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
                                                                title="Marcar como pagado"
                                                            >
                                                                <CheckCircle size={16} />
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => { if (window.confirm('¿Eliminar este registro?')) deleteAdvance(adv.id); }}
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
        </div>
    );
};

export default AdvancePayroll;
