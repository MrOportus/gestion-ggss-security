import React, { useState, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { normalizeText, matchesEmployeeSearch } from '../lib/textUtils';

import {
    DollarSign, Search, Calendar, Plus, Trash2,
    CheckCircle2, AlertCircle, ChevronRight, Filter,
    CreditCard, History, FileText, Upload, ExternalLink,
    Pencil, X, SlidersHorizontal, MessageSquare
} from 'lucide-react';

import { Loan, LoanInstallment } from '../types';

const LoansPage: React.FC = () => {
    const {
        employees, loans, addLoan, updateLoan, deleteLoan,
        showNotification, showConfirmation, currentUser, uploadLoanPdf
    } = useAppStore();

    const [activeTab, setActiveTab] = useState<'create' | 'active' | 'history'>('active');

    // ── Create Form State ──────────────────────────────────────────────────────
    const [workerSearch, setWorkerSearch] = useState('');
    const [selectedWorkerId, setSelectedWorkerId] = useState('');
    const [loanAmount, setLoanAmount] = useState<number | ''>('');
    const [installmentsCount, setInstallmentsCount] = useState<number>(1);
    const [firstPaymentDate, setFirstPaymentDate] = useState(new Date().toISOString().slice(0, 7));
    const [showWorkerList, setShowWorkerList] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [loanNotes, setLoanNotes] = useState('');
    const [isUploading, setIsUploading] = useState(false);

    // Custom installments (create)
    const [customInstallments, setCustomInstallments] = useState(false);
    const [installmentAmounts, setInstallmentAmounts] = useState<number[]>([]);

    // ── Edit State ─────────────────────────────────────────────────────────────
    const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
    const [editAmount, setEditAmount] = useState<number | ''>('');
    const [editInstallmentsCount, setEditInstallmentsCount] = useState(1);
    const [editFirstPaymentDate, setEditFirstPaymentDate] = useState('');
    const [editNotes, setEditNotes] = useState('');
    const [editUpdateFile, setEditUpdateFile] = useState<File | null>(null);
    const [editCustomInstallments, setEditCustomInstallments] = useState(false);
    const [editInstallmentAmounts, setEditInstallmentAmounts] = useState<number[]>([]);
    const [editInstallmentPaidStatus, setEditInstallmentPaidStatus] = useState<boolean[]>([]);

    // ── Filter State ───────────────────────────────────────────────────────────
    const [searchTerm, setSearchTerm] = useState('');

    // Quick installment preset buttons
    const quickInstallments = [1, 2, 3, 4, 5];

    // ── Workers filtered for search ────────────────────────────────────────────
    const filteredWorkers = useMemo(() => {
        if (!workerSearch) return employees.filter(e => e.isActive).slice(0, 5);
        return employees.filter(e =>
            e.isActive && matchesEmployeeSearch(workerSearch, e)
        ).slice(0, 5);
    }, [employees, workerSearch]);

    // ── Helper: distribute amount evenly across N installments ─────────────────
    const distributeAmounts = (amount: number, count: number): number[] => {
        if (count <= 0) return [];
        const base = Math.round(amount / count);
        const amounts = Array(count).fill(base);
        amounts[count - 1] = amount - base * (count - 1);
        return amounts;
    };

    // ── Helper: format YYYY-MM as short month label ────────────────────────────
    const formatMonth = (monthStr: string) => {
        const [year, month] = monthStr.split('-');
        const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        return `${months[parseInt(month) - 1]} ${year}`;
    };

    // ── Helper: get month label for installment index from a start date ─────────
    const getInstallmentMonth = (startDate: string, index: number) => {
        if (!startDate) return '';
        const [year, month] = startDate.split('-').map(Number);
        const date = new Date(year, (month - 1) + index, 1);
        return formatMonth(date.toISOString().slice(0, 7));
    };

    // ── Toggle custom installments (create) ────────────────────────────────────
    const handleToggleCustomInstallments = (enabled: boolean) => {
        setCustomInstallments(enabled);
        if (enabled) {
            const amount = Number(loanAmount) || 0;
            setInstallmentAmounts(distributeAmounts(amount, installmentsCount));
        }
    };

    // ── Toggle custom installments (edit) ──────────────────────────────────────
    const handleToggleEditCustomInstallments = (enabled: boolean) => {
        setEditCustomInstallments(enabled);
        if (enabled) {
            const amount = Number(editAmount) || 0;
            // Use existing installment amounts if count matches
            if (editingLoan && editInstallmentAmounts.length === editInstallmentsCount) {
                // keep current editInstallmentAmounts
            } else {
                setEditInstallmentAmounts(distributeAmounts(amount, editInstallmentsCount));
            }
        }
    };

    // ── Custom amount change handlers ──────────────────────────────────────────
    const handleInstallmentAmountChange = (idx: number, value: number) => {
        const newAmounts = [...installmentAmounts];
        newAmounts[idx] = value;
        setInstallmentAmounts(newAmounts);
    };

    const handleEditInstallmentAmountChange = (idx: number, value: number) => {
        const newAmounts = [...editInstallmentAmounts];
        newAmounts[idx] = value;
        setEditInstallmentAmounts(newAmounts);
    };

    // ── Totals for validation ──────────────────────────────────────────────────
    const customTotal = installmentAmounts.reduce((s, a) => s + (a || 0), 0);
    const editCustomTotal = editInstallmentAmounts.reduce((s, a) => s + (a || 0), 0);

    // ── Build installments array from amounts + start date ─────────────────────
    const buildInstallments = (
        startDate: string,
        amounts: number[],
        existing: LoanInstallment[] = []
    ): LoanInstallment[] => {
        const [year, month] = startDate.split('-').map(Number);
        return amounts.map((amount, i) => {
            const date = new Date(year, (month - 1) + i, 1);
            const monthKey = date.toISOString().slice(0, 7);
            const prev = existing.find(ins => ins.month === monthKey);
            return {
                month: monthKey,
                amount,
                isPaid: prev?.isPaid || false,
                ...(prev?.paidAt ? { paidAt: prev.paidAt } : {})
            };
        });
    };

    // ── CREATE ─────────────────────────────────────────────────────────────────
    const handleCreateLoan = async () => {
        if (!selectedWorkerId || !loanAmount || installmentsCount < 1 || !firstPaymentDate) {
            showNotification('Por favor complete todos los datos del préstamo', 'warning');
            return;
        }

        if (customInstallments) {
            if (customTotal !== Number(loanAmount)) {
                showNotification(
                    `La suma de cuotas ($${customTotal.toLocaleString()}) debe ser igual al monto total ($${Number(loanAmount).toLocaleString()})`,
                    'warning'
                );
                return;
            }
        }

        setIsUploading(true);
        try {
            const worker = employees.find(e => e.id === selectedWorkerId);
            if (!worker) { showNotification('Trabajador no encontrado', 'error'); return; }

            let pdfUrl = '';
            if (selectedFile) {
                const filename = `loan_${Date.now()}_${selectedFile.name.replace(/\s+/g, '_')}`;
                pdfUrl = await uploadLoanPdf(selectedFile, filename);
            }

            const amounts = customInstallments
                ? installmentAmounts
                : distributeAmounts(Number(loanAmount), installmentsCount);

            const installments = buildInstallments(firstPaymentDate, amounts);

            const loanData: Partial<Loan> & { createdBy: string } = {
                workerId: worker.id,
                workerName: `${worker.firstName} ${worker.lastNamePaterno}`,
                workerRut: worker.rut,
                amount: Number(loanAmount),
                installmentsCount,
                firstPaymentDate,
                installments,
                createdBy: currentUser?.uid || 'admin',
                ...(pdfUrl ? { pdfUrl } : {}),
                ...(loanNotes.trim() ? { notes: loanNotes.trim() } : {}),
            };

            await addLoan(loanData as any);
            showNotification('Préstamo ingresado correctamente', 'success');

            // Reset form
            setWorkerSearch('');
            setSelectedWorkerId('');
            setLoanAmount('');
            setInstallmentsCount(1);
            setSelectedFile(null);
            setLoanNotes('');
            setCustomInstallments(false);
            setInstallmentAmounts([]);
            setActiveTab('active');
        } catch (error) {
            console.error('Error creating loan:', error);
            showNotification('Error al ingresar el préstamo', 'error');
        } finally {
            setIsUploading(false);
        }
    };

    // ── MARK INSTALLMENT AS PAID ───────────────────────────────────────────────
    const handlePayInstallment = (loan: Loan, installmentIndex: number) => {
        const updatedInstallments = [...loan.installments];
        updatedInstallments[installmentIndex] = {
            ...updatedInstallments[installmentIndex],
            isPaid: true,
            paidAt: new Date().toISOString()
        };
        const allPaid = updatedInstallments.every(inst => inst.isPaid);
        updateLoan(loan.id, { installments: updatedInstallments, status: allPaid ? 'PAID' : 'PARTIAL' });
        showNotification('Cuota marcada como pagada', 'success');
    };

    // ── OPEN EDIT PANEL ────────────────────────────────────────────────────────
    const openEditPanel = (loan: Loan) => {
        setEditingLoan(loan);
        setEditAmount(loan.amount);
        setEditInstallmentsCount(loan.installmentsCount);
        setEditFirstPaymentDate(loan.firstPaymentDate);
        setEditNotes(loan.notes || '');
        setEditUpdateFile(null);
        setEditCustomInstallments(false);
        // Pre-populate edit amounts and paid status from existing installments
        setEditInstallmentAmounts(loan.installments.map(i => i.amount));
        setEditInstallmentPaidStatus(loan.installments.map(i => i.isPaid));
    };

    // ── UPDATE LOAN ────────────────────────────────────────────────────────────
    const handleUpdateLoan = async () => {
        if (!editingLoan) return;
        if (!editAmount || editInstallmentsCount < 1 || !editFirstPaymentDate) {
            showNotification('Por favor complete todos los datos del préstamo', 'warning');
            return;
        }

        if (editCustomInstallments && editCustomTotal !== Number(editAmount)) {
            showNotification(
                `La suma de cuotas ($${editCustomTotal.toLocaleString()}) debe ser igual al monto total ($${Number(editAmount).toLocaleString()})`,
                'warning'
            );
            return;
        }

        setIsUploading(true);
        try {
            let pdfUrl = editingLoan.pdfUrl;
            if (editUpdateFile) {
                const filename = `loan_${Date.now()}_${editUpdateFile.name.replace(/\s+/g, '_')}`;
                pdfUrl = await uploadLoanPdf(editUpdateFile, filename);
            }

            const amounts = editCustomInstallments
                ? editInstallmentAmounts
                : distributeAmounts(Number(editAmount), editInstallmentsCount);

            // Build installments using explicit paid status from the edit panel
            const [yr, mo] = editFirstPaymentDate.split('-').map(Number);
            const newInstallments: LoanInstallment[] = amounts.map((amount, i) => {
                const date = new Date(yr, (mo - 1) + i, 1);
                const monthKey = date.toISOString().slice(0, 7);
                const isPaid = editInstallmentPaidStatus[i] ?? false;
                // Preserve original paidAt timestamp if it was already paid
                const originalInst = editingLoan.installments.find(ins => ins.month === monthKey);
                return {
                    month: monthKey,
                    amount,
                    isPaid,
                    ...(isPaid && originalInst?.paidAt ? { paidAt: originalInst.paidAt } : {}),
                    ...(isPaid && !originalInst?.paidAt ? { paidAt: new Date().toISOString() } : {}),
                };
            });

            const allPaid = newInstallments.every(i => i.isPaid);
            const anyPaid = newInstallments.some(i => i.isPaid);

            const updateData: Partial<Loan> = {
                amount: Number(editAmount),
                installmentsCount: editInstallmentsCount,
                firstPaymentDate: editFirstPaymentDate,
                installments: newInstallments,
                status: allPaid ? 'PAID' : anyPaid ? 'PARTIAL' : 'PENDING',
                notes: editNotes.trim() || undefined,
                ...(pdfUrl ? { pdfUrl } : {}),
            };

            await updateLoan(editingLoan.id, updateData as any);
            showNotification('Préstamo actualizado correctamente', 'success');
            setEditingLoan(null);
            setEditUpdateFile(null);
        } catch (error) {
            console.error('Error updating loan:', error);
            showNotification('Error al actualizar el préstamo', 'error');
        } finally {
            setIsUploading(false);
        }
    };

    // ── DELETE ─────────────────────────────────────────────────────────────────
    const handleDeleteLoan = (loanId: string) => {
        showConfirmation({
            title: 'Eliminar Préstamo',
            message: '¿Está seguro que desea eliminar este préstamo? Esta acción no se puede deshacer.',
            onConfirm: () => {
                deleteLoan(loanId);
                showNotification('Préstamo eliminado', 'info');
            }
        });
    };

    // ── Filtered loans ─────────────────────────────────────────────────────────
    const searchWords = normalizeText(searchTerm).split(/\s+/).filter(Boolean);
    const matchesLoanSearch = (name: string, rut: string) => {
        if (searchWords.length === 0) return true;
        const fullText = normalizeText(`${name} ${rut}`);
        return searchWords.every(word => fullText.includes(word));
    };

    const activeLoans = loans.filter(l => l.status !== 'PAID' && matchesLoanSearch(l.workerName, l.workerRut));
    const historyLoans = loans.filter(l => l.status === 'PAID' && matchesLoanSearch(l.workerName, l.workerRut));

    // ── Progress Bar ───────────────────────────────────────────────────────────
    const renderProgressBar = (loan: Loan) => (
        <div className="space-y-2">
            <div className="flex justify-between items-end mb-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Progreso de Pago</span>
                <span className="text-[10px] font-black text-blue-600">
                    {loan.installments.filter(i => i.isPaid).length} / {loan.installmentsCount} Cuotas
                </span>
            </div>
            <div className="flex gap-1 h-3">
                {loan.installments.map((inst, idx) => (
                    <div
                        key={idx}
                        className={`flex-1 rounded-sm transition-all duration-500 ${inst.isPaid
                            ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]'
                            : 'bg-slate-200 border border-slate-300'}`}
                        title={`${inst.month}: $${inst.amount.toLocaleString()}`}
                    />
                ))}
            </div>
            <div className="flex justify-between text-[9px] font-medium text-slate-400 px-0.5">
                <span>Inicia: {loan.installments[0].month}</span>
                <span>Finaliza: {loan.installments[loan.installmentsCount - 1].month}</span>
            </div>
        </div>
    );

    // ── RENDER ─────────────────────────────────────────────────────────────────
    return (
        <div className="p-6 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-700">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <div className="p-2 bg-blue-600 rounded-xl text-white shadow-lg shadow-blue-200">
                            <CreditCard size={28} />
                        </div>
                        Préstamos a Trabajadores
                    </h1>
                    <p className="text-slate-500 font-medium mt-1">Gestión y seguimiento de adelantos y préstamos en cuotas</p>
                </div>

                <nav className="flex bg-white p-1.5 rounded-2xl shadow-sm border border-slate-200">
                    <button onClick={() => setActiveTab('active')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'active' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
                        <CreditCard size={18} /> Activos
                    </button>
                    <button onClick={() => setActiveTab('create')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'create' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
                        <Plus size={18} /> Nuevo
                    </button>
                    <button onClick={() => setActiveTab('history')}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'history' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
                        <History size={18} /> Historial
                    </button>
                </nav>
            </div>

            {/* ── CREATE TAB ── */}
            {activeTab === 'create' && (
                <div className="max-w-2xl mx-auto">
                    <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/60 border border-slate-100 overflow-hidden">
                        <div className="p-8 bg-gradient-to-br from-slate-900 to-slate-800 text-white">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                <Plus className="text-blue-400" /> Nuevo Préstamo
                            </h2>
                            <p className="text-slate-400 text-sm mt-1">Ingrese los detalles para generar la tabla de cuotas</p>
                        </div>

                        <div className="p-8 space-y-6">
                            {/* Worker Search */}
                            <div className="relative">
                                <label className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2 block">Trabajador</label>
                                <div className="relative">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                                    <input
                                        type="text"
                                        placeholder="Buscar por nombre o RUT..."
                                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:bg-white outline-none transition-all font-medium"
                                        value={workerSearch}
                                        onChange={(e) => { setWorkerSearch(e.target.value); setShowWorkerList(true); setSelectedWorkerId(''); }}
                                        onFocus={() => setShowWorkerList(true)}
                                    />
                                    {selectedWorkerId && (
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 bg-blue-600 text-white px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter">
                                            Seleccionado
                                        </div>
                                    )}
                                </div>

                                {showWorkerList && workerSearch && !selectedWorkerId && (
                                    <div className="absolute z-20 w-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl max-h-60 overflow-y-auto animate-in slide-in-from-top-2">
                                        {filteredWorkers.map(emp => (
                                            <button key={emp.id} type="button"
                                                className="w-full px-5 py-4 hover:bg-blue-50 text-left border-b border-slate-50 last:border-0 transition-colors"
                                                onClick={() => { setSelectedWorkerId(emp.id); setWorkerSearch(`${emp.firstName} ${emp.lastNamePaterno}`); setShowWorkerList(false); }}>
                                                <div className="font-bold text-slate-900">{emp.firstName} {emp.lastNamePaterno}</div>
                                                <div className="text-xs text-slate-500 font-medium">RUT: {emp.rut} • {emp.cargo}</div>
                                            </button>
                                        ))}
                                        {filteredWorkers.length === 0 && (
                                            <div className="p-5 text-center text-slate-400 italic text-sm">No se encontraron resultados</div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Amount */}
                                <div className="space-y-2">
                                    <label className="text-xs font-black text-slate-500 uppercase tracking-widest block">Monto Total</label>
                                    <div className="relative">
                                        <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                                        <input
                                            type="number"
                                            placeholder="0"
                                            className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:bg-white outline-none transition-all font-bold text-slate-800"
                                            value={loanAmount}
                                            onChange={(e) => setLoanAmount(Number(e.target.value))}
                                        />
                                    </div>
                                </div>

                                {/* Installments count */}
                                <div className="space-y-2">
                                    <label className="text-xs font-black text-slate-500 uppercase tracking-widest block">Número de Cuotas</label>
                                    <div className="flex bg-slate-50 p-1 rounded-2xl border border-slate-200">
                                        {quickInstallments.map(n => (
                                            <button key={n} type="button"
                                                onClick={() => setInstallmentsCount(n)}
                                                className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${installmentsCount === n ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                                                {n}
                                            </button>
                                        ))}
                                        <input
                                            type="number"
                                            className={`w-16 text-center bg-transparent outline-none font-bold text-sm ${quickInstallments.includes(installmentsCount) ? 'text-slate-400' : 'text-blue-600'}`}
                                            value={installmentsCount}
                                            onChange={(e) => setInstallmentsCount(Math.max(1, Number(e.target.value)))}
                                            min="1"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Start Date */}
                            <div className="space-y-2">
                                <label className="text-xs font-black text-slate-500 uppercase tracking-widest block">Mes del Primer Pago</label>
                                <div className="relative">
                                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                                    <input
                                        type="month"
                                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:bg-white outline-none transition-all font-medium"
                                        value={firstPaymentDate}
                                        onChange={(e) => setFirstPaymentDate(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Custom installments toggle */}
                            {loanAmount && installmentsCount > 1 && (
                                <div className="space-y-4">
                                    <label className="flex items-center gap-3 cursor-pointer select-none group">
                                        <div
                                            onClick={() => handleToggleCustomInstallments(!customInstallments)}
                                            className={`relative w-11 h-6 rounded-full transition-colors ${customInstallments ? 'bg-blue-600' : 'bg-slate-200'}`}
                                        >
                                            <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${customInstallments ? 'translate-x-5' : ''}`} />
                                        </div>
                                        <span className="text-xs font-black text-slate-500 uppercase tracking-widest group-hover:text-slate-700 transition-colors flex items-center gap-2">
                                            <SlidersHorizontal size={14} />
                                            Personalizar monto de cada cuota
                                        </span>
                                    </label>

                                    {customInstallments && (
                                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3 animate-in slide-in-from-top-2">
                                            {Array.from({ length: installmentsCount }, (_, i) => {
                                                const usedBefore = installmentAmounts.slice(0, i).reduce((s, a) => s + (a || 0), 0);
                                                const remaining = Number(loanAmount) - usedBefore;
                                                return (
                                                    <div key={i} className="flex items-center gap-3">
                                                        <span className="text-[11px] font-black text-slate-400 uppercase w-20 shrink-0 leading-tight">
                                                            Cuota {i + 1}<br />
                                                            <span className="text-slate-300 font-medium normal-case">{getInstallmentMonth(firstPaymentDate, i)}</span>
                                                        </span>
                                                        <div className="relative flex-1">
                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">$</span>
                                                            <input
                                                                type="number"
                                                                className="w-full pl-7 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 text-sm outline-none focus:ring-2 focus:ring-blue-100 transition-all"
                                                                value={installmentAmounts[i] || 0}
                                                                onChange={(e) => handleInstallmentAmountChange(i, Number(e.target.value))}
                                                                min="0"
                                                            />
                                                        </div>
                                                        {i === installmentsCount - 1 && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleInstallmentAmountChange(i, Math.max(0, remaining))}
                                                                className="text-[10px] font-black text-blue-500 hover:text-blue-700 uppercase shrink-0 whitespace-nowrap"
                                                                title="Completar con saldo restante"
                                                            >
                                                                ← Saldo
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                            <div className={`flex justify-between items-center pt-2 border-t ${customTotal === Number(loanAmount) ? 'border-green-200' : 'border-rose-200'}`}>
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total asignado:</span>
                                                <span className={`text-sm font-black ${customTotal === Number(loanAmount) ? 'text-green-600' : 'text-rose-500'}`}>
                                                    ${customTotal.toLocaleString()}
                                                    {customTotal !== Number(loanAmount) && (
                                                        <span className="text-[10px] font-medium ml-1 opacity-70">
                                                            (diferencia: ${Math.abs(Number(loanAmount) - customTotal).toLocaleString()})
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Summary Preview (only when not using custom) */}
                            {loanAmount && installmentsCount > 0 && !customInstallments && (
                                <div className="bg-blue-50 border border-blue-100 p-6 rounded-3xl space-y-3">
                                    <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Resumen del Préstamo</h4>
                                    <div className="flex justify-between items-center">
                                        <span className="text-sm font-medium text-slate-600">Valor de cada cuota:</span>
                                        <span className="text-xl font-black text-blue-700">${Math.round(Number(loanAmount) / installmentsCount).toLocaleString()}</span>
                                    </div>
                                    <div className="text-[11px] text-blue-500 font-medium">
                                        Total de {installmentsCount} pagos mensuales finalizando en{' '}
                                        {formatMonth(new Date(
                                            Number(firstPaymentDate.split('-')[0]),
                                            (Number(firstPaymentDate.split('-')[1]) - 1) + (installmentsCount - 1),
                                            1
                                        ).toISOString().slice(0, 7))}
                                    </div>
                                </div>
                            )}

                            {/* Notes */}
                            <div className="space-y-2">
                                <label className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                    <MessageSquare size={12} /> Notas (Opcional)
                                </label>
                                <textarea
                                    placeholder="Observaciones o información adicional del préstamo..."
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:bg-white outline-none transition-all font-medium text-sm resize-none"
                                    rows={3}
                                    value={loanNotes}
                                    onChange={(e) => setLoanNotes(e.target.value)}
                                />
                            </div>

                            {/* File Upload */}
                            <div className="space-y-2">
                                <label className="text-xs font-black text-slate-500 uppercase tracking-widest block">Documento de Respaldo (Opcional - PDF)</label>
                                <div className={`relative border-2 border-dashed rounded-2xl transition-all ${selectedFile ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50/50 hover:border-blue-300'}`}>
                                    <input type="file" accept=".pdf"
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
                                    <div className="p-6 flex flex-col items-center justify-center text-center">
                                        {selectedFile ? (
                                            <>
                                                <FileText className="text-emerald-500 mb-2" size={32} />
                                                <span className="text-sm font-bold text-slate-700 truncate max-w-xs">{selectedFile.name}</span>
                                                <button onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                                                    className="mt-2 text-[10px] font-black uppercase text-rose-500 hover:text-rose-700 z-20">
                                                    Quitar archivo
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <Upload className="text-slate-400 mb-2" size={32} />
                                                <span className="text-sm font-bold text-slate-500">Cargar PDF de respaldo</span>
                                                <span className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest">Click o arrastrar archivo</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={handleCreateLoan}
                                disabled={isUploading}
                                className="w-full py-5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-blue-200 transition-all hover:-translate-y-1 active:scale-95 flex items-center justify-center gap-3">
                                {isUploading ? 'Subiendo datos...' : 'Generar Préstamo y Cuotas'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── ACTIVE / HISTORY TABS ── */}
            {(activeTab === 'active' || activeTab === 'history') && (
                <div className="space-y-6">
                    {/* Filters Bar */}
                    <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
                        <div className="relative w-full md:w-96">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                            <input
                                type="text"
                                placeholder="Buscar por nombre o RUT..."
                                className="w-full pl-12 pr-4 py-3 bg-slate-50 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-100 transition-all"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="flex items-center gap-4 text-slate-400">
                            <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                                <Filter size={14} /> {activeTab === 'active' ? activeLoans.length : historyLoans.length} Registros
                            </span>
                        </div>
                    </div>

                    {/* Loan Cards Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {(activeTab === 'active' ? activeLoans : historyLoans).length === 0 ? (
                            <div className="col-span-full py-20 bg-white rounded-3xl border border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 space-y-4">
                                <AlertCircle size={48} className="opacity-20" />
                                <p className="font-bold uppercase tracking-widest text-sm">No se encontraron préstamos</p>
                            </div>
                        ) : (
                            (activeTab === 'active' ? activeLoans : historyLoans).map(loan => {
                                const nextPendingIdx = loan.installments.findIndex(i => !i.isPaid);
                                const nextPayment = nextPendingIdx !== -1 ? loan.installments[nextPendingIdx] : null;
                                const isEditing = editingLoan?.id === loan.id;

                                return (
                                    <div key={loan.id} className="group bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300 overflow-hidden flex flex-col">
                                        <div className="p-6 space-y-4 flex-1">

                                            {/* Card header */}
                                            <div className="flex justify-between items-start">
                                                <div className="space-y-1">
                                                    <h3 className="font-black text-slate-900 group-hover:text-blue-600 transition-colors uppercase tracking-tight leading-none">{loan.workerName}</h3>
                                                    <p className="text-[10px] font-bold text-slate-400 font-mono">{loan.workerRut}</p>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={() => isEditing ? setEditingLoan(null) : openEditPanel(loan)}
                                                        className={`p-2 rounded-xl transition-all ${isEditing ? 'text-blue-600 bg-blue-50' : 'text-slate-300 hover:text-blue-500 hover:bg-blue-50'}`}
                                                        title="Editar préstamo">
                                                        <Pencil size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteLoan(loan.id)}
                                                        className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                                                        title="Eliminar préstamo">
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Amount + status */}
                                            <div className="bg-slate-50 p-4 rounded-2xl flex justify-between items-center">
                                                <div className="space-y-0.5">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Total Préstamo</span>
                                                    <span className="text-xl font-black text-slate-800">${loan.amount.toLocaleString()}</span>
                                                </div>
                                                <div className="text-right">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Estado</span>
                                                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${loan.status === 'PAID' ? 'bg-green-100 text-green-700' : loan.status === 'PARTIAL' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>
                                                        {loan.status === 'PAID' ? 'Finalizado' : 'Vigente'}
                                                    </span>
                                                </div>
                                            </div>

                                            {renderProgressBar(loan)}

                                            {/* Notes display */}
                                            {loan.notes && (
                                                <div className="bg-amber-50 border border-amber-100 p-3 rounded-xl flex gap-2 items-start">
                                                    <MessageSquare size={13} className="text-amber-500 mt-0.5 shrink-0" />
                                                    <p className="text-[11px] text-amber-800 font-medium leading-relaxed">{loan.notes}</p>
                                                </div>
                                            )}

                                            {/* Next payment */}
                                            {nextPayment && (
                                                <div className="bg-amber-50/50 border border-amber-100 p-4 rounded-2xl flex justify-between items-center animate-pulse-slow">
                                                    <div className="space-y-0.5">
                                                        <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest block">Próximo Pago: {formatMonth(nextPayment.month)}</span>
                                                        <span className="font-bold text-slate-700">${nextPayment.amount.toLocaleString()}</span>
                                                    </div>
                                                    <button
                                                        onClick={() => handlePayInstallment(loan, nextPendingIdx)}
                                                        className="bg-white hover:bg-emerald-600 hover:text-white text-emerald-600 p-2 rounded-xl shadow-sm border border-emerald-100 transition-all active:scale-90 flex items-center gap-2"
                                                        title="Confirmar Pago de Cuota">
                                                        <CheckCircle2 size={18} />
                                                        <span className="text-[10px] font-black uppercase pr-1">Pagar</span>
                                                    </button>
                                                </div>
                                            )}

                                            {!nextPayment && (
                                                <div className="bg-green-50/50 border border-green-100 p-4 rounded-2xl flex items-center gap-3 text-green-700">
                                                    <CheckCircle2 size={20} className="shrink-0" />
                                                    <div className="text-xs font-bold leading-tight uppercase tracking-tight">Préstamo pagado en su totalidad</div>
                                                </div>
                                            )}

                                            {/* PDF link (only when not editing) */}
                                            {loan.pdfUrl && !isEditing && (
                                                <a href={loan.pdfUrl} target="_blank" rel="noopener noreferrer"
                                                    className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 bg-slate-900 border border-slate-800 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all">
                                                    <FileText size={14} className="text-blue-400" />
                                                    Ver Documento PDF
                                                    <ExternalLink size={12} className="opacity-50" />
                                                </a>
                                            )}

                                            {/* ── FULL EDIT PANEL ── */}
                                            {isEditing && (
                                                <div className="mt-2 p-5 bg-blue-50 rounded-2xl border border-blue-100 space-y-4 animate-in slide-in-from-top-2">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[11px] font-black text-blue-700 uppercase tracking-widest">Editar Préstamo</span>
                                                        <button onClick={() => setEditingLoan(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                                                            <X size={14} />
                                                        </button>
                                                    </div>

                                                    {/* Edit: Amount */}
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">Monto Total</label>
                                                        <div className="relative">
                                                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                                            <input
                                                                type="number"
                                                                className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 text-sm outline-none focus:ring-2 focus:ring-blue-200 transition-all"
                                                                value={editAmount}
                                                                onChange={(e) => setEditAmount(Number(e.target.value))}
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Edit: Installments count */}
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">Número de Cuotas</label>
                                                        <div className="flex bg-white p-0.5 rounded-xl border border-slate-200 gap-0.5">
                                                            {quickInstallments.map(n => (
                                                                <button key={n} type="button"
                                                                    onClick={() => setEditInstallmentsCount(n)}
                                                                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${editInstallmentsCount === n ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}>
                                                                    {n}
                                                                </button>
                                                            ))}
                                                            <input
                                                                type="number"
                                                                className={`w-12 text-center bg-transparent outline-none font-bold text-xs ${quickInstallments.includes(editInstallmentsCount) ? 'text-slate-400' : 'text-blue-600'}`}
                                                                value={editInstallmentsCount}
                                                                onChange={(e) => setEditInstallmentsCount(Math.max(1, Number(e.target.value)))}
                                                                min="1"
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Edit: First payment date */}
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">Mes del Primer Pago</label>
                                                        <div className="relative">
                                                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                                                            <input
                                                                type="month"
                                                                className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl font-medium text-sm outline-none focus:ring-2 focus:ring-blue-200 transition-all"
                                                                value={editFirstPaymentDate}
                                                                onChange={(e) => setEditFirstPaymentDate(e.target.value)}
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Edit: Custom installments toggle */}
                                                    {editAmount && editInstallmentsCount > 1 && (
                                                        <div className="space-y-3">
                                                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                                                <div
                                                                    onClick={() => handleToggleEditCustomInstallments(!editCustomInstallments)}
                                                                    className={`relative w-9 h-5 rounded-full transition-colors ${editCustomInstallments ? 'bg-blue-600' : 'bg-slate-300'}`}>
                                                                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${editCustomInstallments ? 'translate-x-4' : ''}`} />
                                                                </div>
                                                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                                                                    <SlidersHorizontal size={11} /> Personalizar cuotas
                                                                </span>
                                                            </label>

                                                            {editCustomInstallments && (
                                                                <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                                                                    {Array.from({ length: editInstallmentsCount }, (_, i) => {
                                                                        const usedBefore = editInstallmentAmounts.slice(0, i).reduce((s, a) => s + (a || 0), 0);
                                                                        const remaining = Number(editAmount) - usedBefore;
                                                                        return (
                                                                            <div key={i} className="flex items-center gap-2">
                                                                                <span className="text-[10px] font-black text-slate-400 uppercase w-16 shrink-0 leading-tight">
                                                                                    Cuota {i + 1}<br />
                                                                                    <span className="text-slate-300 font-medium normal-case text-[9px]">{getInstallmentMonth(editFirstPaymentDate, i)}</span>
                                                                                </span>
                                                                                <div className="relative flex-1">
                                                                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">$</span>
                                                                                    <input
                                                                                        type="number"
                                                                                        className="w-full pl-5 pr-2 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-800 text-xs outline-none focus:ring-2 focus:ring-blue-100 transition-all"
                                                                                        value={editInstallmentAmounts[i] || 0}
                                                                                        onChange={(e) => handleEditInstallmentAmountChange(i, Number(e.target.value))}
                                                                                        min="0"
                                                                                    />
                                                                                </div>
                                                                                {i === editInstallmentsCount - 1 && (
                                                                                    <button type="button"
                                                                                        onClick={() => handleEditInstallmentAmountChange(i, Math.max(0, remaining))}
                                                                                        className="text-[9px] font-black text-blue-500 hover:text-blue-700 uppercase shrink-0">
                                                                                        ← Saldo
                                                                                    </button>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                    <div className={`flex justify-between items-center pt-1 border-t ${editCustomTotal === Number(editAmount) ? 'border-green-200' : 'border-rose-200'}`}>
                                                                        <span className="text-[9px] font-black text-slate-400 uppercase">Total:</span>
                                                                        <span className={`text-xs font-black ${editCustomTotal === Number(editAmount) ? 'text-green-600' : 'text-rose-500'}`}>
                                                                            ${editCustomTotal.toLocaleString()}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Edit: Paid status per installment */}
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                                                            <CheckCircle2 size={10} /> Estado de Cuotas
                                                        </label>
                                                        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                                                            {Array.from({ length: editInstallmentsCount }, (_, i) => {
                                                                const isPaid = editInstallmentPaidStatus[i] ?? false;
                                                                return (
                                                                    <div key={i} className={`flex items-center justify-between px-3 py-2 transition-colors ${isPaid ? 'bg-green-50/60' : 'bg-white'}`}>
                                                                        <div className="leading-tight">
                                                                            <span className="text-[10px] font-black text-slate-500 uppercase">Cuota {i + 1}</span>
                                                                            <span className="text-[9px] text-slate-400 font-medium ml-1.5">{getInstallmentMonth(editFirstPaymentDate, i)}</span>
                                                                        </div>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const next = [...editInstallmentPaidStatus];
                                                                                // Ensure array is long enough
                                                                                while (next.length < editInstallmentsCount) next.push(false);
                                                                                next[i] = !next[i];
                                                                                setEditInstallmentPaidStatus(next);
                                                                            }}
                                                                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-tight transition-all ${
                                                                                isPaid
                                                                                    ? 'bg-green-100 text-green-700 hover:bg-rose-100 hover:text-rose-600'
                                                                                    : 'bg-slate-100 text-slate-400 hover:bg-green-100 hover:text-green-700'
                                                                            }`}
                                                                            title={isPaid ? 'Marcar como no pagada' : 'Marcar como pagada'}
                                                                        >
                                                                            <CheckCircle2 size={11} />
                                                                            {isPaid ? 'Pagada' : 'Pendiente'}
                                                                        </button>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>

                                                    {/* Edit: Notes */}
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                                                            <MessageSquare size={10} /> Notas
                                                        </label>
                                                        <textarea
                                                            placeholder="Observaciones o información adicional..."
                                                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-blue-200 transition-all resize-none"
                                                            rows={2}
                                                            value={editNotes}
                                                            onChange={(e) => setEditNotes(e.target.value)}
                                                        />
                                                    </div>

                                                    {/* Edit: PDF */}
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">Documento PDF</label>
                                                        <div className="relative border-2 border-dashed border-blue-200 rounded-xl bg-white p-3 text-center cursor-pointer hover:border-blue-400 transition-all">
                                                            <input type="file" accept=".pdf"
                                                                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                                                onChange={(e) => setEditUpdateFile(e.target.files?.[0] || null)} />
                                                            {editUpdateFile ? (
                                                                <div className="flex items-center justify-center gap-2">
                                                                    <FileText size={14} className="text-emerald-500" />
                                                                    <span className="text-[11px] font-bold text-slate-700 truncate max-w-[150px]">{editUpdateFile.name}</span>
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center justify-center gap-2 text-slate-400">
                                                                    <Upload size={14} />
                                                                    <span className="text-[11px] font-bold">{loan.pdfUrl ? 'Reemplazar PDF' : 'Subir PDF'}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                        {loan.pdfUrl && !editUpdateFile && (
                                                            <a href={loan.pdfUrl} target="_blank" rel="noopener noreferrer"
                                                                className="text-[10px] text-blue-500 hover:text-blue-700 font-bold flex items-center gap-1 mt-1">
                                                                <ExternalLink size={10} /> Ver PDF actual
                                                            </a>
                                                        )}
                                                    </div>

                                                    <button
                                                        onClick={handleUpdateLoan}
                                                        disabled={isUploading}
                                                        className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-blue-700 disabled:bg-slate-300 transition-all">
                                                        {isUploading ? 'Guardando...' : 'Guardar Cambios'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                            <span>Generado: {new Date(loan.createdAt).toLocaleDateString()}</span>
                                            <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            <style dangerouslySetInnerHTML={{
                __html: `
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.8; }
        }
        .animate-pulse-slow {
          animation: pulse-slow 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}} />
        </div>
    );
};

export default LoansPage;
