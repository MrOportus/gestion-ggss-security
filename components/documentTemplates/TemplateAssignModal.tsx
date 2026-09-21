/**
 * TemplateAssignModal.tsx
 * Wizard de asignación: seleccionar plantilla → seleccionar trabajador →
 * auto-completar campos → campos manuales → confirmar → addDigitalDocument().
 */
import React, { useState, useMemo, useEffect } from 'react';
import { X, Search, User, ChevronRight, Loader2, CheckCircle, AlertTriangle, Zap } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { DocumentTemplate, Employee } from '../../types';
import { CAMPOS_AUTOMATICOS } from './TemplateEditor';
import { generateTemplatePDF, uploadGeneratedPDF, resolveField, WorkerDataForPDF } from './TemplatePDFGenerator';

interface TemplateAssignModalProps {
    template: DocumentTemplate;
    onClose: () => void;
}

type Step = 'worker' | 'fields' | 'confirm';

const TemplateAssignModal: React.FC<TemplateAssignModalProps> = ({ template, onClose }) => {
    const { employees, sites, addDigitalDocument, showNotification } = useAppStore();
    const [step, setStep] = useState<Step>('worker');
    const [searchWorker, setSearchWorker] = useState('');
    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
    const [manualFields, setManualFields] = useState<Record<string, string>>({});
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

            // 1. Generar PDF con pdf-lib
            const { blob, signatureBounds } = await generateTemplatePDF(template, workerData);

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

                {/* Steps indicator */}
                <div className="flex items-center px-6 py-3 bg-slate-50 border-b border-slate-100 gap-3">
                    {(['worker', 'fields', 'confirm'] as Step[]).map((s, i) => {
                        const labels = ['Seleccionar Trabajador', 'Completar Campos', 'Confirmar'];
                        const isActive = step === s;
                        const isPast = ['worker', 'fields', 'confirm'].indexOf(step) > i;
                        return (
                            <React.Fragment key={s}>
                                <div className={`flex items-center gap-2 text-xs font-black uppercase tracking-widest ${isActive ? 'text-blue-600' : isPast ? 'text-emerald-600' : 'text-slate-400'}`}>
                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${isActive ? 'bg-blue-600 text-white' : isPast ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'}`}>{i + 1}</span>
                                    {labels[i]}
                                </div>
                                {i < 2 && <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />}
                            </React.Fragment>
                        );
                    })}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6">

                    {/* Paso 1: Seleccionar trabajador */}
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
                                            onClick={() => { setSelectedEmployee(emp); setStep(camposManuales.length > 0 ? 'fields' : 'confirm'); }}
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
                        onClick={() => {
                            if (step === 'confirm') setStep(camposManuales.length > 0 ? 'fields' : 'worker');
                            else if (step === 'fields') setStep('worker');
                            else onClose();
                        }}
                        className="px-5 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all"
                    >
                        {step === 'worker' ? 'Cancelar' : 'Atrás'}
                    </button>

                    {step === 'fields' && (
                        <button
                            onClick={() => setStep('confirm')}
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
