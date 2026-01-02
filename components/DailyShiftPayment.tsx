import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
    User, Calendar, DollarSign, MapPin, FileText, CheckCircle, Clock,
    Plus, Search, Filter, Download
} from 'lucide-react';
import * as XLSX from 'xlsx';

export const DailyShiftPayment = () => {
    const {
        currentUser, employees, sites, dailyPayments,
        fetchDailyPayments, addDailyPayment, markPaymentAsPaid, updateDailyPayment
    } = useAppStore();

    const [activeTab, setActiveTab] = useState<'create' | 'list' | 'reports'>('create'); // Default to create per spec? Or list? Spec says "Turnos Diarios" is creation.

    // Form State
    const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
    const [manualWorkerName, setManualWorkerName] = useState('');
    const [amount, setAmount] = useState<number | ''>('');
    const [siteId, setSiteId] = useState<string>('');
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Filter State
    const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        fetchDailyPayments();
    }, []);

    // --- COMPUTED DATA ---
    const filteredPayments = useMemo(() => {
        return dailyPayments.filter(p => {
            const matchesMonth = p.monthPeriod === filterMonth;
            const matchesSearch = p.workerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                p.siteName.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesMonth && matchesSearch;
        });
    }, [dailyPayments, filterMonth, searchTerm]);

    const reportData = useMemo(() => {
        // Prepare data for export/report view
        // Group by Month is handled by filterMonth already for the view
        return filteredPayments.filter(p => p.status === 'PAID');
    }, [filteredPayments]);


    // --- HANDLERS ---
    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if ((!selectedWorkerId && !manualWorkerName) || !amount || !siteId) {
            alert("Complete los campos obligatorios");
            return;
        }

        setIsSubmitting(true);
        try {
            const workerName = selectedWorkerId
                ? (() => {
                    const emp = employees.find(e => e.id === selectedWorkerId);
                    return emp ? `${emp.firstName} ${emp.lastNamePaterno} ${emp.lastNameMaterno || ''}` : 'Desconocido';
                })()
                : manualWorkerName;

            const siteName = sites.find(s => String(s.id) === siteId)?.name || 'Desconocida';

            await addDailyPayment({
                workerName,
                workerId: selectedWorkerId || undefined,
                amount: Number(amount),
                siteId,
                siteName,
                description,
                monthPeriod: new Date().toISOString().slice(0, 7)
            });

            // Reset Form and Switch Tab
            setSelectedWorkerId('');
            setManualWorkerName('');
            setAmount('');
            setSiteId('');
            setDescription('');
            setActiveTab('list'); // "Pasa automáticamente a la sección Pagar Turnos Extra"

        } catch (error) {
            alert("Error al crear el pago");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleExport = () => {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(reportData.map(p => ({
            Fecha: new Date(p.createdAt).toLocaleDateString(),
            Trabajador: p.workerName,
            Monto: p.amount,
            Sucursal: p.siteName,
            Detalle: p.description,
            Estado: p.status,
            PagadoEl: p.paidAt ? new Date(p.paidAt).toLocaleDateString() : '-',
            PagadoPor: p.paidBy || '-'
        })));
        XLSX.utils.book_append_sheet(wb, ws, "Pagos");
        XLSX.writeFile(wb, `Reporte_Pagos_${filterMonth}.xlsx`);
    };

    if (currentUser?.role !== 'admin') {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <div className="bg-slate-100 p-4 rounded-full mb-3">
                    <User size={32} />
                </div>
                <p className="font-medium">Acceso restringido a Administradores</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* --- HEADER & TABS --- */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-4">
                <div>
                    <h2 className="text-xl font-bold text-slate-800">Control de Turnos Diarios</h2>
                    <p className="text-sm text-slate-500">Gestión de pagos extraordinarios y turnos diarios</p>
                </div>

                <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button
                        onClick={() => setActiveTab('create')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'create' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Ingreso Turno
                    </button>
                    <button
                        onClick={() => setActiveTab('list')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Pagar Turnos
                    </button>
                    <button
                        onClick={() => setActiveTab('reports')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'reports' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Reportes
                    </button>
                </div>
            </div>

            {/* --- CONTENT CREATE --- */}
            {activeTab === 'create' && (
                <div className="max-w-2xl mx-auto bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                        <Plus className="text-blue-500" size={20} />
                        Nuevo Registro de Pago
                    </h3>

                    <form onSubmit={handleCreate} className="space-y-5">
                        {/* Selector de Trabajador */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">Trabajador</label>
                            <div className="flex gap-2">
                                <select
                                    className="flex-1 p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-slate-50"
                                    value={selectedWorkerId}
                                    onChange={(e) => { setSelectedWorkerId(e.target.value); setManualWorkerName(''); }}
                                    disabled={!!manualWorkerName}
                                >
                                    <option value="">-- Seleccionar de la lista --</option>
                                    {employees.filter(e => e.isActive).map(emp => (
                                        <option key={emp.id} value={emp.id}>
                                            {emp.firstName} {emp.lastNamePaterno} {emp.lastNameMaterno} - {emp.rut}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-slate-200"></div>
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-white px-2 text-slate-400">O ingresar manualmente</span>
                                </div>
                            </div>

                            <input
                                type="text"
                                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-100 disabled:text-slate-400"
                                placeholder="Nombre completo (si no está en lista)"
                                value={manualWorkerName}
                                onChange={(e) => { setManualWorkerName(e.target.value); setSelectedWorkerId(''); }}
                                disabled={!!selectedWorkerId}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-700">Monto ($)</label>
                                <input
                                    type="number"
                                    className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="Ej: 25000"
                                    value={amount}
                                    onChange={(e) => setAmount(Number(e.target.value))}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-700">Sucursal</label>
                                <select
                                    className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={siteId}
                                    onChange={(e) => setSiteId(e.target.value)}
                                    required
                                >
                                    <option value="">-- Seleccionar --</option>
                                    {sites.filter(s => s.active).map(site => (
                                        <option key={site.id} value={site.id}>{site.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">Descripción / Motivo</label>
                            <textarea
                                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none"
                                placeholder="Detalles del turno realizado..."
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full py-3 bg-blue-600 text-white font-bold rounded-lg shadow-md hover:bg-blue-700 transition disabled:opacity-50"
                        >
                            {isSubmitting ? 'Guardando...' : 'Guardar y Pendiente de Pago'}
                        </button>
                    </form>
                </div>
            )}

            {/* --- CONTENT LIST & REPORTS --- */}
            {(activeTab === 'list' || activeTab === 'reports') && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    {/* Toolbar */}
                    <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-wrap gap-4 justify-between items-center">
                        <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-3 py-2 w-full md:w-auto">
                            <Search size={16} className="text-slate-400" />
                            <input
                                type="text"
                                placeholder="Buscar trabajador o sucursal..."
                                className="text-sm outline-none w-full md:w-64"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                                <Filter size={16} className="text-slate-400" />
                                <input
                                    type="month"
                                    className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 outline-none"
                                    value={filterMonth}
                                    onChange={(e) => setFilterMonth(e.target.value)}
                                />
                            </div>

                            {activeTab === 'reports' && (
                                <button
                                    onClick={handleExport}
                                    className="flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition"
                                >
                                    <Download size={14} /> Exportar Excel
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-100">
                                    <th className="px-6 py-4 font-semibold">Fecha</th>
                                    <th className="px-6 py-4 font-semibold">Trabajador</th>
                                    <th className="px-6 py-4 font-semibold">Sucursal</th>
                                    <th className="px-6 py-4 font-semibold">Monto</th>
                                    <th className="px-6 py-4 font-semibold">Descripción</th>
                                    <th className="px-6 py-4 font-semibold text-center">Estado</th>
                                    <th className="px-6 py-4 font-semibold text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredPayments.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-12 text-center text-slate-400 text-sm">
                                            No se encontraron pagos para este periodo/búsqueda.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredPayments.map((payment) => (
                                        <tr key={payment.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-6 py-4 text-xs text-slate-500">
                                                {new Date(payment.createdAt).toLocaleDateString()}
                                                <div className="text-[10px] text-slate-400">{new Date(payment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-sm font-medium text-slate-800">{payment.workerName}</div>
                                                {payment.workerId && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100">Registrado</span>}
                                                {!payment.workerId && <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded border border-amber-100">Manual</span>}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-600">{payment.siteName}</td>
                                            <td className="px-6 py-4 font-mono text-sm font-bold text-slate-700">
                                                ${payment.amount.toLocaleString()}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-slate-500 max-w-xs truncate" title={payment.description}>
                                                {payment.description}
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${payment.status === 'PAID'
                                                        ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                                        : 'bg-yellow-50 text-yellow-600 border-yellow-100'
                                                    }`}>
                                                    {payment.status === 'PAID' ? <CheckCircle size={12} /> : <Clock size={12} />}
                                                    {payment.status === 'PAID' ? 'PAGADO' : 'PENDIENTE'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                {payment.status === 'PENDING' && (
                                                    <button
                                                        onClick={() => markPaymentAsPaid(payment.id, currentUser?.email || 'admin')}
                                                        className="text-xs bg-slate-800 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700 transition shadow-sm font-medium"
                                                    >
                                                        Pagar
                                                    </button>
                                                )}
                                                {payment.status === 'PAID' && (
                                                    <div className="text-[10px] text-slate-400 text-right">
                                                        <div>{new Date(payment.paidAt!).toLocaleDateString()}</div>
                                                        <div className="truncate max-w-[80px]">{payment.paidBy}</div>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
