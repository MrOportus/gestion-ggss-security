/**
 * TemplateMassAssignModal.tsx
 * Wizard de asignación masiva: N plantillas -> M trabajadores.
 */
import React, { useState, useMemo } from 'react';
import { X, Search, User, ChevronRight, Loader2, CheckCircle, AlertTriangle, FileText, CheckSquare, Square, Users, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { DocumentTemplate, Employee } from '../../types';
import { CAMPOS_AUTOMATICOS } from './TemplateEditor';
import { generateTemplatePDF, uploadGeneratedPDF, resolveField, WorkerDataForPDF } from './TemplatePDFGenerator';

interface Props {
    onClose: () => void;
}

type Step = 'templates' | 'workers' | 'epp' | 'confirm' | 'processing';

const TemplateMassAssignModal: React.FC<Props> = ({ onClose }) => {
    const { employees, sites, documentTemplates, addDigitalDocument, showNotification } = useAppStore();
    
    const [step, setStep] = useState<Step>('templates');
    const [searchTemplate, setSearchTemplate] = useState('');
    const [searchWorker, setSearchWorker] = useState('');
    
    const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set());
    const [selectedWorkers, setSelectedWorkers] = useState<Set<string>>(new Set());
    
    const [eppSeleccionados, setEppSeleccionados] = useState<Set<number>>(new Set());
    const [dotacionSeleccionados, setDotacionSeleccionados] = useState<Set<number>>(new Set());
    
    const [progress, setProgress] = useState({ current: 0, total: 0, failed: 0 });
    const [done, setDone] = useState(false);

    const activeTemplates = useMemo(() => documentTemplates.filter(t => t.estado === 'activo'), [documentTemplates]);
    const filteredTemplates = useMemo(() => {
        const q = searchTemplate.toLowerCase();
        return activeTemplates.filter(t => t.nombre.toLowerCase().includes(q) || t.tipo.toLowerCase().includes(q));
    }, [activeTemplates, searchTemplate]);

    const selectedTemplatesList = useMemo(() => activeTemplates.filter(t => selectedTemplates.has(t.id)), [activeTemplates, selectedTemplates]);

    const bloqueEpp = useMemo(() => {
        for (const tpl of selectedTemplatesList) {
            const b = tpl.bloques.find(b => b.tipo === 'checklist_2col' && (b.filas_epp?.length ?? 0) > 0);
            if (b) return b;
        }
        return null;
    }, [selectedTemplatesList]);

    const bloqueDotacion = useMemo(() => {
        for (const tpl of selectedTemplatesList) {
            const b = tpl.bloques.find(b => b.tipo === 'dotacion_personal');
            if (b) return b;
        }
        return null;
    }, [selectedTemplatesList]);

    const hasEppStep = !!bloqueEpp || !!bloqueDotacion;

    // 2. Filtrar trabajadores activos (no admin)
    const filteredEmployees = useMemo(() => {
        const q = searchWorker.toLowerCase();
        return employees.filter(e => {
            if ((e as any).role === 'admin' || (e as any).role === 'supervisor') return false;
            const name = `${e.firstName || ''} ${e.lastNamePaterno || ''}`.toLowerCase();
            return !q || name.includes(q) || (e.rut || '').includes(q);
        });
    }, [employees, searchWorker]);

    // Toggle Selection
    const toggleTemplate = (id: string) => {
        const next = new Set(selectedTemplates);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelectedTemplates(next);
    };
    
    const toggleWorker = (id: string) => {
        const next = new Set(selectedWorkers);
        if (next.has(id)) next.delete(id); else next.add(id);
        setSelectedWorkers(next);
    };

    const toggleAllWorkers = () => {
        if (selectedWorkers.size === filteredEmployees.length) {
            setSelectedWorkers(new Set());
        } else {
            setSelectedWorkers(new Set(filteredEmployees.map(e => e.id)));
        }
    };

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

    // Auto-completar campos manuales
    const resolveManualFields = (template: DocumentTemplate, employee: Employee, site: any): Record<string, string> => {
        const camposManuales = template.bloques.filter(b => b.tipo === 'campo_manual' && b.etiquetaCampo);
        const autoFilled: Record<string, string> = {};
        const workerData: WorkerDataForPDF = { employee, site, generatedAt: new Date().toISOString() };
        
        camposManuales.forEach(b => {
            const match = CAMPOS_AUTOMATICOS.find(c => c.label.toLowerCase().includes(b.etiquetaCampo!.toLowerCase()));
            if (match) {
                const val = resolveField(match.key, workerData);
                if (val) autoFilled[b.etiquetaCampo!] = val;
            }
        });
        return autoFilled;
    };

    // Procesar asignación
    const handleProcess = async () => {
        if (selectedTemplates.size === 0 || selectedWorkers.size === 0) return;
        
        setStep('processing');
        const tplList = activeTemplates.filter(t => selectedTemplates.has(t.id));
        const empList = employees.filter(e => selectedWorkers.has(e.id));
        
        const total = tplList.length * empList.length;
        setProgress({ current: 0, total, failed: 0 });
        
        let successCount = 0;
        let failCount = 0;

        for (const emp of empList) {
            const site = sites.find(s => s.id === (emp as any).currentSiteId);
            
            for (const tpl of tplList) {
                try {
                    const templateConEpp: DocumentTemplate = {
                        ...tpl,
                        bloques: tpl.bloques.map(b => {
                            if (b.tipo === 'checklist_2col') return { ...b, eppSeleccionados: Array.from(eppSeleccionados) };
                            if (b.tipo === 'dotacion_personal') return { ...b, dotacionSeleccionados: Array.from(dotacionSeleccionados) };
                            return b;
                        }),
                    };

                    // Auto-resolver manual fields
                    const manualFields = resolveManualFields(templateConEpp, emp, site);
                    
                    const workerData: WorkerDataForPDF = {
                        employee: emp, site, manualFields, generatedAt: new Date().toISOString(),
                    };

                    const { blob, signatureBounds } = await generateTemplatePDF(templateConEpp, workerData);
                    const docId = `doctpl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                    const pdfUrl = await uploadGeneratedPDF(blob, docId);

                    await addDigitalDocument({
                        title: `${tpl.nombre} — ${emp.firstName} ${emp.lastNamePaterno}`,
                        type: tpl.tipo,
                        assignedTo: emp.id,
                        originalUrl: pdfUrl,
                        ...(signatureBounds ? {
                            signatureConfig: {
                                page: signatureBounds.pageIndex,
                                posicionX: signatureBounds.x,
                                posicionY: signatureBounds.y,
                                width: signatureBounds.width,
                                height: signatureBounds.height,
                            }
                        } : (tpl.firmaConfig ? {
                            signatureConfig: {
                                page: tpl.firmaConfig.pageType === 'last' ? -1 : (tpl.firmaConfig.pageNumber || 1) - 1,
                                x: tpl.firmaConfig.posicionX,
                                y: tpl.firmaConfig.posicionY,
                                width: 160,
                                height: 50,
                            }
                        } : {})),
                    } as any);

                    successCount++;
                } catch (err) {
                    console.error(`Error generating ${tpl.nombre} for ${emp.firstName}:`, err);
                    failCount++;
                }
                setProgress(p => ({ ...p, current: p.current + 1, failed: failCount }));
            }
        }
        
        setDone(true);
        if (failCount === 0) {
            showNotification(`Asignación masiva exitosa: ${successCount} documentos generados.`, 'success');
        } else {
            showNotification(`Asignación finalizada. ${successCount} correctos, ${failCount} fallidos.`, 'warning');
        }
    };

    if (done) {
        return (
            <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl p-10 max-w-sm w-full text-center shadow-2xl animate-in zoom-in duration-300">
                    <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 ${progress.failed === 0 ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                        {progress.failed === 0 ? <CheckCircle size={40} className="text-emerald-500" /> : <AlertTriangle size={40} className="text-amber-500" />}
                    </div>
                    <h3 className="text-xl font-black text-slate-800 mb-2">Proceso Finalizado</h3>
                    <p className="text-sm text-slate-500 mb-6">
                        Se han asignado <strong>{progress.total - progress.failed}</strong> documentos correctamente.
                        {progress.failed > 0 && <span className="block mt-2 text-amber-600">Hubo {progress.failed} errores de generación.</span>}
                    </p>
                    <button onClick={onClose} className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-sm uppercase tracking-wider transition-all">
                        Cerrar
                    </button>
                </div>
            </div>
        );
    }

    if (step === 'processing') {
        const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
        return (
            <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl p-10 max-w-md w-full shadow-2xl animate-in zoom-in duration-300">
                    <div className="text-center space-y-6">
                        <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto relative">
                            <Loader2 size={32} className="text-blue-500 animate-spin" />
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-slate-800">Generando Documentos</h3>
                            <p className="text-sm text-slate-500 mt-1">Por favor no cierres esta ventana.</p>
                        </div>
                        
                        <div className="bg-slate-100 h-3 rounded-full overflow-hidden w-full relative">
                            <div className="absolute top-0 left-0 h-full bg-blue-500 transition-all duration-300" style={{ width: `${percent}%` }} />
                        </div>
                        
                        <div className="flex justify-between text-xs font-bold text-slate-400">
                            <span>{percent}%</span>
                            <span>{progress.current} de {progress.total}</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-100">
                    <div>
                        <h3 className="text-lg font-black text-slate-800">Asignación Masiva de Plantillas</h3>
                        <p className="text-xs text-slate-400 mt-0.5 font-medium">Asigna múltiples plantillas a múltiples trabajadores</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400"><X size={20} /></button>
                </div>

                {/* Steps indicator */}
                <div className="flex items-center px-6 py-3 bg-slate-50 border-b border-slate-100 gap-3 overflow-x-auto">
                    {[
                        { key: 'templates' as Step, label: 'Plantillas' },
                        { key: 'workers' as Step, label: 'Trabajadores' },
                        ...(hasEppStep ? [{ key: 'epp' as Step, label: 'Seleccionar EPP' }] : []),
                        { key: 'confirm' as Step, label: 'Confirmar' }
                    ].map((s, i, arr) => {
                        const isActive = step === s.key;
                        const isPast = arr.findIndex(x => x.key === step) > i;
                        return (
                            <React.Fragment key={s.key}>
                                <div className={`flex items-center gap-2 text-xs font-black uppercase tracking-widest whitespace-nowrap ${isActive ? 'text-blue-600' : isPast ? 'text-emerald-600' : 'text-slate-400'}`}>
                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${isActive ? 'bg-blue-600 text-white' : isPast ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'}`}>{i + 1}</span>
                                    {s.label}
                                </div>
                                {i < arr.length - 1 && <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />}
                            </React.Fragment>
                        );
                    })}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">

                    {/* Paso 1: Plantillas */}
                    {step === 'templates' && (
                        <div className="space-y-4">
                            <div className="relative">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchTemplate}
                                    onChange={e => setSearchTemplate(e.target.value)}
                                    placeholder="Buscar plantillas activas..."
                                    className="w-full pl-9 pr-4 py-3 border border-slate-200 rounded-2xl text-sm font-medium outline-none focus:border-blue-400 bg-white"
                                    autoFocus
                                />
                            </div>
                            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                                {filteredTemplates.length === 0 ? (
                                    <div className="text-center py-8 text-slate-400"><FileText size={32} className="mx-auto mb-2" /><p className="text-sm font-medium">No se encontraron plantillas activas</p></div>
                                ) : (
                                    filteredTemplates.map(tpl => (
                                        <div key={tpl.id} onClick={() => toggleTemplate(tpl.id)} className="flex items-center gap-4 p-4 hover:bg-blue-50/50 cursor-pointer transition-colors">
                                            <div className={`text-blue-500 ${selectedTemplates.has(tpl.id) ? 'opacity-100' : 'opacity-30'}`}>
                                                {selectedTemplates.has(tpl.id) ? <CheckSquare size={20} /> : <Square size={20} />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-slate-800">{tpl.nombre}</p>
                                                <p className="text-xs text-slate-500">{tpl.tipo} · v{tpl.version}</p>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}

                    {/* Paso 2: Trabajadores */}
                    {step === 'workers' && (
                        <div className="space-y-4">
                            <div className="flex gap-3">
                                <div className="relative flex-1">
                                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        value={searchWorker}
                                        onChange={e => setSearchWorker(e.target.value)}
                                        placeholder="Buscar trabajadores..."
                                        className="w-full pl-9 pr-4 py-3 border border-slate-200 rounded-2xl text-sm font-medium outline-none focus:border-blue-400 bg-white"
                                        autoFocus
                                    />
                                </div>
                                <button
                                    onClick={toggleAllWorkers}
                                    className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold text-slate-600 hover:bg-slate-50 whitespace-nowrap"
                                >
                                    {selectedWorkers.size === filteredEmployees.length ? 'Desmarcar Todos' : 'Marcar Todos'}
                                </button>
                            </div>
                            
                            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest px-1">
                                {selectedWorkers.size} seleccionados
                            </div>

                            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 max-h-80 overflow-y-auto">
                                {filteredEmployees.length === 0 ? (
                                    <div className="text-center py-8 text-slate-400"><User size={32} className="mx-auto mb-2" /><p className="text-sm font-medium">No se encontraron trabajadores</p></div>
                                ) : (
                                    filteredEmployees.map(emp => (
                                        <div key={emp.id} onClick={() => toggleWorker(emp.id)} className="flex items-center gap-4 p-3 hover:bg-blue-50/50 cursor-pointer transition-colors">
                                            <div className={`text-blue-500 ${selectedWorkers.has(emp.id) ? 'opacity-100' : 'opacity-30'}`}>
                                                {selectedWorkers.has(emp.id) ? <CheckSquare size={20} /> : <Square size={20} />}
                                            </div>
                                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-black text-slate-400 text-xs shrink-0">
                                                {(emp.firstName || 'U')[0]}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-slate-800 text-sm truncate">{emp.firstName} {emp.lastNamePaterno}</p>
                                                <p className="text-xs text-slate-400">{emp.rut} · {emp.cargo}</p>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}

                    {/* Paso 2.5: Selección de EPP (Si aplica) */}
                    {step === 'epp' && (
                        <div className="space-y-6">
                            <div className="bg-cyan-50 border border-cyan-200 rounded-2xl p-4 mb-4">
                                <p className="text-sm text-cyan-800 font-medium">
                                    Las plantillas seleccionadas requieren asignación de elementos.
                                    Esta configuración se aplicará a <strong>todos</strong> los trabajadores seleccionados.
                                </p>
                            </div>
                            <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
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
                                
                                {bloqueDotacion && bloqueEpp && <hr className="border-slate-100" />}

                                {/* Grupo Elementos de Protección Personal */}
                                {bloqueEpp && (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <ShieldCheck size={16} className="text-cyan-600" />
                                                <p className="text-xs font-black text-slate-700 uppercase tracking-widest">Elementos de Protección</p>
                                                <span className="text-[10px] font-black text-cyan-700 bg-cyan-100 px-2 py-0.5 rounded-full">{eppSeleccionados.size} / {bloqueEpp.filas_epp?.length || 0}</span>
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={selectAllEpp} className="text-[11px] font-bold text-cyan-600 hover:text-cyan-800 border border-cyan-200 hover:bg-cyan-50 px-3 py-1 rounded-lg transition-all">Todos</button>
                                                <button onClick={clearAllEpp} className="text-[11px] font-bold text-slate-500 hover:text-slate-700 border border-slate-200 hover:bg-slate-50 px-3 py-1 rounded-lg transition-all">Ninguno</button>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {(bloqueEpp.filas_epp || []).map((item, idx) => {
                                                const checked = eppSeleccionados.has(idx);
                                                return (
                                                    <button key={'epp_'+idx} onClick={() => toggleEpp(idx)}
                                                        className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all active:scale-95 ${checked ? 'border-cyan-400 bg-cyan-50 shadow-sm' : 'border-slate-100 bg-slate-50 hover:border-slate-300'}`}>
                                                        <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border-2 transition-all ${checked ? 'bg-cyan-500 border-cyan-500' : 'bg-white border-slate-300'}`}>
                                                            {checked && (
                                                                <svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4.5L4 7.5L10 1.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                                            )}
                                                        </div>
                                                        <span className={`text-xs leading-tight font-semibold ${checked ? 'text-cyan-800' : 'text-slate-600'}`}>{item.label}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Paso 3: Confirmar */}
                    {step === 'confirm' && (
                        <div className="space-y-5">
                            <div className="bg-white border border-slate-200 rounded-3xl p-6 text-center">
                                <div className="flex justify-center items-center gap-6 mb-6">
                                    <div className="flex flex-col items-center">
                                        <div className="w-14 h-14 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center mb-2">
                                            <FileText size={24} />
                                        </div>
                                        <span className="text-2xl font-black text-slate-800">{selectedTemplates.size}</span>
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Plantillas</span>
                                    </div>
                                    <X size={20} className="text-slate-300" />
                                    <div className="flex flex-col items-center">
                                        <div className="w-14 h-14 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-2">
                                            <Users size={24} />
                                        </div>
                                        <span className="text-2xl font-black text-slate-800">{selectedWorkers.size}</span>
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Trabajadores</span>
                                    </div>
                                </div>
                                
                                <div className="bg-slate-50 rounded-2xl p-4 text-sm font-medium text-slate-600">
                                    Se generarán y asignarán <strong className="text-blue-600 font-black">{selectedTemplates.size * selectedWorkers.size}</strong> documentos en total.
                                </div>
                            </div>

                            <div className="bg-amber-50 border border-amber-200/50 rounded-2xl p-4 flex gap-3">
                                <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                                <div className="text-xs text-amber-800 font-medium leading-relaxed">
                                    <p className="font-bold mb-1">Manejo de Campos Manuales:</p>
                                    <p>El sistema intentará autocompletar la información desde el perfil de cada trabajador. Si un campo no puede ser resuelto, quedará en blanco en el documento generado.</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer acciones */}
                <div className="p-6 border-t border-slate-100 flex items-center justify-between bg-white">
                    <button
                        onClick={() => {
                            if (step === 'confirm') setStep(hasEppStep ? 'epp' : 'workers');
                            else if (step === 'epp') setStep('workers');
                            else if (step === 'workers') setStep('templates');
                            else onClose();
                        }}
                        className="px-5 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all"
                    >
                        {step === 'templates' ? 'Cancelar' : 'Atrás'}
                    </button>

                    {step === 'templates' && (
                        <button
                            onClick={() => setStep('workers')}
                            disabled={selectedTemplates.size === 0}
                            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-black uppercase tracking-wider transition-all disabled:opacity-50"
                        >
                            Siguiente
                        </button>
                    )}

                    {step === 'workers' && (
                        <button
                            onClick={() => setStep(hasEppStep ? 'epp' : 'confirm')}
                            disabled={selectedWorkers.size === 0}
                            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-black uppercase tracking-wider transition-all disabled:opacity-50"
                        >
                            Siguiente
                        </button>
                    )}

                    {step === 'epp' && (
                        <button
                            onClick={() => setStep('confirm')}
                            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-black uppercase tracking-wider transition-all disabled:opacity-50"
                        >
                            Revisar Asignación
                        </button>
                    )}

                    {step === 'confirm' && (
                        <button
                            onClick={handleProcess}
                            className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-black uppercase tracking-wider transition-all shadow-lg shadow-emerald-200"
                        >
                            Iniciar Asignación
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TemplateMassAssignModal;
