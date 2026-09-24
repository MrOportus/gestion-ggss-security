/**
 * TemplateAssignModal.tsx
 * Wizard de asignación: seleccionar trabajador → [si hay checklist_2col] seleccionar EPP →
 * campos manuales → confirmar → addDigitalDocument().
 */
import React, { useState, useMemo, useEffect } from 'react';
import { X, Search, User, ChevronRight, Loader2, CheckCircle, AlertTriangle, Zap, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { DocumentTemplate, Employee } from '../../types';
import { CAMPOS_AUTOMATICOS } from './TemplateEditor';
import { generateTemplatePDF, uploadGeneratedPDF, resolveField, WorkerDataForPDF } from './TemplatePDFGenerator';

interface TemplateAssignModalProps {
    template: DocumentTemplate;
    onClose: () => void;
}

type Step = 'worker' | 'epp' | 'fields' | 'confirm';

const TemplateAssignModal: React.FC<TemplateAssignModalProps> = ({ template, onClose }) => {
    const { employees, sites, addDigitalDocument, showNotification } = useAppStore();
    const [step, setStep] = useState<Step>('worker');
    const [searchWorker, setSearchWorker] = useState('');
    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
    const [manualFields, setManualFields] = useState<Record<string, string>>({});
    const [eppSeleccionados, setEppSeleccionados] = useState<Set<number>>(new Set());
    const [dotacionSeleccionados, setDotacionSeleccionados] = useState<Set<number>>(new Set());
    const [isGenerating, setIsGenerating] = useState(false);
    const [done, setDone] = useState(false);

    // Filtrar empleados activos (excluir admin/supervisor)
    const filteredEmployees = useMemo(() => {
        const q = searchWorker.toLowerCase();
        return employees.filter(e => {
            if ((e as any).role === 'admin' || (e as any).role === 'supervisor') return false;
            const name = `${e.firstName || ''} ${e.lastNamePaterno || ''}`.toLowerCase();
            return !q || name.includes(q) || (e.rut || '').includes(q);
        });
    }, [employees, searchWorker]);

    // Campos manuales que requiere la plantilla
    const camposManuales = useMemo(() => {
        return template.bloques.filter(b => b.tipo === 'campo_manual');
    }, [template.bloques]);

    // Bloque checklist_2col — si existe, mostrar paso EPP
    const bloqueEpp = useMemo(() =>
        template.bloques.find(b => b.tipo === 'checklist_2col' && (b.filas_epp?.length ?? 0) > 0) ?? null,
        [template.bloques]
    );
    const bloqueDotacion = useMemo(() =>
        template.bloques.find(b => b.tipo === 'dotacion_personal') ?? null,
        [template.bloques]
    );
    const hasEppStep = !!bloqueEpp || !!bloqueDotacion;

    // Navegación dinámica entre pasos
    const getNextStep = (current: Step): Step => {
        if (current === 'worker') return hasEppStep ? 'epp' : (camposManuales.length > 0 ? 'fields' : 'confirm');
        if (current === 'epp')    return camposManuales.length > 0 ? 'fields' : 'confirm';
        if (current === 'fields') return 'confirm';
        return 'confirm';
    };
    const getPrevStep = (current: Step): Step => {
        if (current === 'confirm') return camposManuales.length > 0 ? 'fields' : (hasEppStep ? 'epp' : 'worker');
        if (current === 'fields')  return hasEppStep ? 'epp' : 'worker';
        if (current === 'epp')     return 'worker';
        return 'worker';
    };

    // Pasos dinámicos según la plantilla
    const stepsConfig: { key: Step; label: string }[] = [
        { key: 'worker', label: 'Trabajador' },
        ...(hasEppStep ? [{ key: 'epp' as Step, label: 'Seleccionar EPP' }] : []),
        ...(camposManuales.length > 0 ? [{ key: 'fields' as Step, label: 'Campos' }] : []),
        { key: 'confirm', label: 'Confirmar' },
    ];

    // Helpers de selección EPP y Dotación
    const toggleEpp = (idx: number) => setEppSeleccionados(prev => {
        const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n;
    });
    const selectAllEpp = () => { if (bloqueEpp?.filas_epp) setEppSeleccionados(new Set(bloqueEpp.filas_epp.map((_, i) => i))); };
    const clearAllEpp  = () => setEppSeleccionados(new Set());

    const dotacionItems = bloqueDotacion?.filas_dotacion || [];
    const toggleDotacion = (idx: number) => setDotacionSeleccionados(prev => {
        const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n;
    });
    const selectAllDotacion = () => setDotacionSeleccionados(new Set(dotacionItems.map((_, i) => i)));
    const clearAllDotacion = () => setDotacionSeleccionados(new Set());

    // Auto-completar campos manuales desde el perfil del trabajador al seleccionar trabajador
    useEffect(() => {
        if (!selectedEmployee) return;
        const site = sites.find(s => s.id === (selectedEmployee as any).currentSiteId);
        const workerData: WorkerDataForPDF = { employee: selectedEmployee, site, generatedAt: new Date().toISOString() };
        const autoFilled: Record<string, string> = {};
        camposManuales.forEach(b => {
            if (!b.etiquetaCampo) return;
            // Intentar encontrar un campo automático con nombre similar
            const match = CAMPOS_AUTOMATICOS.find(c => c.label.toLowerCase().includes(b.etiquetaCampo!.toLowerCase()));
            if (match) {
                const val = resolveField(match.key, workerData);
                if (val) autoFilled[b.etiquetaCampo] = val;
            }
        });
        setManualFields(autoFilled);
    }, [selectedEmployee, sites, camposManuales]);

    const handleConfirm = async () => {
        if (!selectedEmployee) return;
        setIsGenerating(true);
        try {
            const site = sites.find(s => s.id === (selectedEmployee as any).currentSiteId);
            const workerData: WorkerDataForPDF = {
                employee: selectedEmployee, site, manualFields, generatedAt: new Date().toISOString(),
            };

            // Inyectar eppSeleccionados y dotacionSeleccionados en copia local del template
            const templateConEpp: DocumentTemplate = {
                ...template,
                bloques: template.bloques.map(b => {
                    if (b.tipo === 'checklist_2col') return { ...b, eppSeleccionados: Array.from(eppSeleccionados) };
                    if (b.tipo === 'dotacion_personal') return { ...b, dotacionSeleccionados: Array.from(dotacionSeleccionados) };
                    return b;
                }),
            };

            // 1. Generar PDF con pdf-lib
            const { blob, signatureBounds } = await generateTemplatePDF(templateConEpp, workerData);

            // 2. Subir a Firebase Storage en generated_docs/
            const docId = `doctpl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const pdfUrl = await uploadGeneratedPDF(blob, docId);

            // 3. Insertar en colección 'documents' — FLUJO EXISTENTE INTOCABLE
            await addDigitalDocument({
                title: `${template.nombre} — ${selectedEmployee.firstName} ${selectedEmployee.lastNamePaterno}`,
                type: template.tipo,
                assignedTo: selectedEmployee.id,
                originalUrl: pdfUrl,
                // Campos opcionales para tracking (no rompen schema existente)
                ...(signatureBounds ? {
                    signatureConfig: {
                        page: signatureBounds.pageIndex,
                        posicionX: signatureBounds.x,
                        posicionY: signatureBounds.y,
                        width: signatureBounds.width,
                        height: signatureBounds.height,
                    }
                } : (template.firmaConfig ? {
                    signatureConfig: {
                        page: template.firmaConfig.pageType === 'last' ? -1 : (template.firmaConfig.pageNumber || 1) - 1,
                        x: template.firmaConfig.posicionX,
                        y: template.firmaConfig.posicionY,
                        width: 160,
                        height: 50,
                    }
                } : {})),
            } as any);

            setDone(true);
            showNotification(`Documento asignado a ${selectedEmployee.firstName} ${selectedEmployee.lastNamePaterno}`, 'success');
        } catch (err: any) {
            console.error('Error generando PDF:', err);
            showNotification('Error al generar el documento: ' + (err.message || 'Error desconocido'), 'error');
        } finally {
            setIsGenerating(false);
        }
    };

    if (done) {
        return (
            <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl p-10 max-w-sm w-full text-center shadow-2xl animate-in zoom-in duration-300">
                    <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5">
                        <CheckCircle size={40} className="text-emerald-500" />
                    </div>
                    <h3 className="text-xl font-black text-slate-800 mb-2">¡Documento Asignado!</h3>
                    <p className="text-sm text-slate-500 mb-6">
                        El documento ya está disponible para <strong>{selectedEmployee?.firstName} {selectedEmployee?.lastNamePaterno}</strong> en la sección Documentos.
                    </p>
                    <button onClick={onClose} className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-sm uppercase tracking-wider transition-all">
                        Cerrar
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-100">
                    <div>
                        <h3 className="text-lg font-black text-slate-800">Asignar Plantilla</h3>
                        <p className="text-xs text-slate-400 mt-0.5 font-medium">{template.nombre} · v{template.version}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400"><X size={20} /></button>
                </div>

                {/* Steps indicator — dinámico */}
                <div className="flex items-center px-6 py-3 bg-slate-50 border-b border-slate-100 gap-2 overflow-x-auto">
                    {stepsConfig.map((s, i) => {
                        const isActive = step === s.key;
                        const isPast = stepsConfig.findIndex(x => x.key === step) > i;
                        return (
                            <React.Fragment key={s.key}>
                                <div className={`flex items-center gap-1.5 text-xs font-black uppercase tracking-widest whitespace-nowrap ${isActive ? 'text-blue-600' : isPast ? 'text-emerald-600' : 'text-slate-400'}`}>
                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${isActive ? 'bg-blue-600 text-white' : isPast ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'}`}>{i + 1}</span>
                                    {s.label}
                                </div>
                                {i < stepsConfig.length - 1 && <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />}
                            </React.Fragment>
                        );
                    })}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6">

                    {/* Paso: Seleccionar trabajador */}
                    {step === 'worker' && (
                        <div className="space-y-4">
                            <div className="relative">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchWorker}
                                    onChange={e => setSearchWorker(e.target.value)}
                                    placeholder="Buscar por nombre o RUT..."
                                    className="w-full pl-9 pr-4 py-3 border border-slate-200 rounded-2xl text-sm font-medium outline-none focus:border-blue-400 bg-slate-50"
                                    autoFocus
                                />
                            </div>
                            <div className="space-y-2 max-h-80 overflow-y-auto">
                                {filteredEmployees.length === 0 ? (
                                    <div className="text-center py-8 text-slate-400"><User size={32} className="mx-auto mb-2" /><p className="text-sm font-medium">No se encontraron trabajadores</p></div>
                                ) : (
                                    filteredEmployees.map(emp => (
                                        <button
                                            key={emp.id}
                                            onClick={() => { setSelectedEmployee(emp); setStep(getNextStep('worker')); }}
                                            className="w-full flex items-center gap-4 p-4 rounded-2xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50 transition-all text-left"
                                        >
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-black text-white text-sm uppercase shrink-0">
                                                {(emp.firstName || 'U')[0]}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-slate-800 truncate">{emp.firstName} {emp.lastNamePaterno}</p>
                                                <p className="text-xs text-slate-400">{emp.rut} · {emp.cargo}</p>
                                            </div>
                                            <ChevronRight size={16} className="text-slate-300" />
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    )}

                    {/* Paso: Seleccionar Dotación y EPP a entregar */}
                    {step === 'epp' && selectedEmployee && (bloqueEpp?.filas_epp || bloqueDotacion) && (
                        <div className="space-y-6">
                            <div className="bg-blue-50 rounded-2xl p-4 flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-black text-white text-xs shrink-0">{(selectedEmployee.firstName || 'U')[0]}</div>
                                <div>
                                    <p className="font-bold text-blue-800 text-sm">{selectedEmployee.firstName} {selectedEmployee.lastNamePaterno}</p>
                                    <p className="text-xs text-blue-500">{selectedEmployee.rut} · {selectedEmployee.cargo}</p>
                                </div>
                            </div>
                            
                            <div className="max-h-72 overflow-y-auto pr-2 space-y-6">
                                {/* Grupo Dotación Personal */}
                                {bloqueDotacion && (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <ShieldCheck size={16} className="text-emerald-600" />
                                                <p className="text-xs font-black text-slate-700 uppercase tracking-widest">Dotación Personal</p>
                                                <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">{dotacionSeleccionados.size} / {dotacionItems.length}</span>
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={selectAllDotacion} className="text-[11px] font-bold text-emerald-600 hover:text-emerald-800 border border-emerald-200 hover:bg-emerald-50 px-3 py-1 rounded-lg transition-all">Todos</button>
                                                <button onClick={clearAllDotacion} className="text-[11px] font-bold text-slate-500 hover:text-slate-700 border border-slate-200 hover:bg-slate-50 px-3 py-1 rounded-lg transition-all">Ninguno</button>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {dotacionItems.map((item, idx) => {
                                                const checked = dotacionSeleccionados.has(idx);
                                                return (
                                                    <button key={'dot_'+idx} onClick={() => toggleDotacion(idx)}
                                                        className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all active:scale-95 ${checked ? 'border-emerald-400 bg-emerald-50 shadow-sm' : 'border-slate-100 bg-slate-50 hover:border-slate-300'}`}>
                                                        <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border-2 transition-all ${checked ? 'bg-emerald-500 border-emerald-500' : 'bg-white border-slate-300'}`}>
                                                            {checked && (
                                                                <svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4.5L4 7.5L10 1.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                            )}
                                                        </div>
                                                        <span className={`text-xs leading-tight font-semibold ${checked ? 'text-emerald-800' : 'text-slate-600'}`}>{item.label}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Grupo EPP */}
                                {bloqueEpp?.filas_epp && (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <ShieldCheck size={16} className="text-emerald-600" />
                                                <p className="text-xs font-black text-slate-700 uppercase tracking-widest">Elementos de Protección</p>
                                                <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">{eppSeleccionados.size} / {bloqueEpp.filas_epp.length}</span>
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={selectAllEpp} className="text-[11px] font-bold text-emerald-600 hover:text-emerald-800 border border-emerald-200 hover:bg-emerald-50 px-3 py-1 rounded-lg transition-all">Todos</button>
                                                <button onClick={clearAllEpp} className="text-[11px] font-bold text-slate-500 hover:text-slate-700 border border-slate-200 hover:bg-slate-50 px-3 py-1 rounded-lg transition-all">Ninguno</button>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {bloqueEpp.filas_epp.map((item, idx) => {
                                                const checked = eppSeleccionados.has(idx);
                                                return (
                                                    <button key={'epp_'+idx} onClick={() => toggleEpp(idx)}
                                                        className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all active:scale-95 ${checked ? 'border-emerald-400 bg-emerald-50 shadow-sm' : 'border-slate-100 bg-slate-50 hover:border-slate-300'}`}>
                                                        <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border-2 transition-all ${checked ? 'bg-emerald-500 border-emerald-500' : 'bg-white border-slate-300'}`}>
                                                            {checked && (
                                                                <svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4.5L4 7.5L10 1.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                            )}
                                                        </div>
                                                        <span className={`text-xs leading-tight font-semibold ${checked ? 'text-emerald-800' : 'text-slate-600'}`}>{item.label}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <p className="text-[11px] text-slate-400 text-center">Solo los ítems seleccionados aparecerán marcados en el PDF</p>
                        </div>
                    )}

                    {/* Paso 2: Completar campos manuales */}
                    {step === 'fields' && selectedEmployee && (
                        <div className="space-y-5">
                            <div className="bg-blue-50 rounded-2xl p-4 flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-black text-white text-xs shrink-0">
                                    {(selectedEmployee.firstName || 'U')[0]}
                                </div>
                                <div>
                                    <p className="font-bold text-blue-800 text-sm">{selectedEmployee.firstName} {selectedEmployee.lastNamePaterno}</p>
                                    <p className="text-xs text-blue-500">{selectedEmployee.rut} · {selectedEmployee.cargo}</p>
                                </div>
                            </div>

                            {camposManuales.length === 0 ? (
                                <p className="text-sm text-slate-500 text-center py-4">Esta plantilla no tiene campos manuales.</p>
                            ) : (
                                <>
                                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Campos a completar</p>
                                    {camposManuales.map(campo => (
                                        <div key={campo.id}>
                                            <label className="text-xs font-bold text-slate-600 block mb-1.5">
                                                {campo.etiquetaCampo}
                                                {campo.requerido && <span className="text-red-500 ml-1">*</span>}
                                                {manualFields[campo.etiquetaCampo || ''] && (
                                                    <span className="ml-2 text-[9px] font-black text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full uppercase tracking-widest">
                                                        <Zap size={8} className="inline mr-0.5" />Auto
                                                    </span>
                                                )}
                                            </label>
                                            <input
                                                type="text"
                                                value={manualFields[campo.etiquetaCampo || ''] || ''}
                                                onChange={e => setManualFields(prev => ({ ...prev, [campo.etiquetaCampo || '']: e.target.value }))}
                                                placeholder={`Ingresar ${campo.etiquetaCampo}...`}
                                                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:border-blue-400 bg-slate-50 focus:bg-white transition-colors"
                                            />
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    )}

                    {/* Paso 3: Confirmar */}
                    {step === 'confirm' && selectedEmployee && (
                        <div className="space-y-5">
                            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-5">
                                <h4 className="font-black text-slate-800 text-sm mb-3">Resumen de asignación</h4>
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Plantilla:</span>
                                        <span className="font-bold text-slate-800">{template.nombre}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Tipo:</span>
                                        <span className="font-bold text-slate-700">{template.tipo}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Trabajador:</span>
                                        <span className="font-bold text-slate-800">{selectedEmployee.firstName} {selectedEmployee.lastNamePaterno}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">RUT:</span>
                                        <span className="font-bold text-slate-700">{selectedEmployee.rut}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Cargo:</span>
                                        <span className="font-bold text-slate-700">{selectedEmployee.cargo}</span>
                                    </div>
                                    {hasEppStep && (
                                        <div className="flex justify-between">
                                            <span className="text-slate-500">Ítems marcados:</span>
                                            <div className="text-right">
                                                {bloqueDotacion && <span className="block font-bold text-emerald-700">{dotacionSeleccionados.size} ropa con ✓</span>}
                                                {bloqueEpp && <span className="block font-bold text-emerald-700">{eppSeleccionados.size} EPP con ✓</span>}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex gap-3">
                                <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                                <p className="text-xs text-amber-700 font-medium leading-relaxed">
                                    Se generará un PDF y se asignará al trabajador. El documento aparecerá inmediatamente en su lista de documentos pendientes de firma.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer acciones */}
                <div className="p-6 border-t border-slate-100 flex items-center justify-between">
                    <button
                        onClick={() => { if (step === 'worker') onClose(); else setStep(getPrevStep(step)); }}
                        className="px-5 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all"
                    >
                        {step === 'worker' ? 'Cancelar' : 'Atrás'}
                    </button>

                    {(step === 'epp' || step === 'fields') && (
                        <button
                            onClick={() => setStep(getNextStep(step))}
                            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-black uppercase tracking-wider transition-all"
                        >
                            Continuar
                        </button>
                    )}

                    {step === 'confirm' && (
                        <button
                            onClick={handleConfirm}
                            disabled={isGenerating}
                            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-black uppercase tracking-wider transition-all disabled:opacity-60 shadow-lg shadow-emerald-200"
                        >
                            {isGenerating ? <><Loader2 size={14} className="animate-spin" /> Generando PDF...</> : 'Generar y Asignar'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TemplateAssignModal;
