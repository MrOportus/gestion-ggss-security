/**
 * components/SharedSignatureBatchModal.tsx
 * 
 * Flujo de Asignación Masiva de Documentos Individuales con Firma Compartida
 * (Especialmente diseñado para Liquidaciones de Sueldo, Anexos, etc.)
 */
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
    X,
    Upload,
    FileText,
    Users,
    CheckCircle2,
    AlertCircle,
    AlertTriangle,
    Search,
    ChevronRight,
    ChevronLeft,
    Trash2,
    PenTool,
    Layers,
    Loader2,
    RefreshCw,
    Sliders,
    ShieldCheck,
    Check,
    HelpCircle,
    UserCheck,
    Clock,
    FileCheck,
    Move,
    Crosshair,
    MousePointerClick,
    ChevronDown,
    ChevronUp
} from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import { Document, Page } from 'react-pdf';
import { useAppStore } from '../store/useAppStore';
import { Employee, SignatureTemplate } from '../types';
import { normalizeText } from '../lib/textUtils';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
}

export type SharedDocType =
    | 'Liquidación de Sueldo'
    | 'Anexo de Contrato'
    | 'Contrato'
    | 'Reglamento Interno'
    | 'EPP'
    | 'ODI'
    | 'Otro';

export interface BatchFileItem {
    id: string;
    file: File;
    name: string;
    size: number;
    assignedEmployeeId: string | null;
    suggestionMethod?: 'rut' | 'name' | 'manual';
    isConfirmed: boolean;
    // Datos de inspección pdf-lib
    inspection?: {
        isValid: boolean;
        pageCount: number;
        targetWidth: number;
        targetHeight: number;
        orientation: 'portrait' | 'landscape';
        error?: string;
    };
    isCompatible: boolean;
    compatibilityReason?: string;
    // Estado de procesamiento
    processStatus?: 'idle' | 'uploading' | 'saving' | 'success' | 'error';
    processError?: string;
    uploadedUrl?: string;
    createdDocId?: string;
}

export interface SharedSignatureConfig {
    page: 'last' | 'specific';
    pageNumber: number;
    posicionX: number; // 0-550
    posicionY: number; // 0-760
}

type WizardStep = 'tipo' | 'archivos' | 'firma' | 'procesamiento';

export const SharedSignatureBatchModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
    const {
        employees,
        uploadFile,
        addDigitalDocument,
        signatureTemplates,
        showNotification
    } = useAppStore();

    // ── Estado General del Wizard ──
    const [currentStep, setCurrentStep] = useState<WizardStep>('tipo');
    const [docType, setDocType] = useState<SharedDocType>('Liquidación de Sueldo');
    const [customTitlePrefix, setCustomTitlePrefix] = useState('');
    const [filesList, setFilesList] = useState<BatchFileItem[]>([]);

    // ── Configuración Compartida de Firma ──
    const [sigConfig, setSigConfig] = useState<SharedSignatureConfig>({
        page: 'last',
        pageNumber: 1,
        posicionX: 246,
        posicionY: 90
    });
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
    const [representativeFileId, setRepresentativeFileId] = useState<string | null>(null);

    // ── Dimensiones reales y arrastre interactivo de firma ──
    const [pagePdfDimensions, setPagePdfDimensions] = useState<{ width: number; height: number }>({ width: 612, height: 792 });
    const pageContainerRef = useRef<HTMLDivElement>(null);
    const [isDraggingSig, setIsDraggingSig] = useState(false);
    const [showFineTuningSliders, setShowFineTuningSliders] = useState(false);
    const dragStartRef = useRef<{ startX: number; startY: number; sigX: number; sigY: number } | null>(null);
    const hasDraggedRef = useRef<boolean>(false);

    // ── Previsualización del PDF representativo ──
    const [repBlobUrl, setRepBlobUrl] = useState<string | null>(null);
    const [repTotalPages, setRepTotalPages] = useState<number>(1);
    const [isLoadingPdfPreview, setIsLoadingPdfPreview] = useState(false);

    // ── Búsqueda de Trabajador para Asignación Manual ──
    const [activeAssigningFileId, setActiveAssigningFileId] = useState<string | null>(null);
    const [employeeSearchTerm, setEmployeeSearchTerm] = useState('');

    // ── Estado de Procesamiento ──
    const [isProcessing, setIsProcessing] = useState(false);
    const [processedCount, setProcessedCount] = useState(0);

    // Filtrar trabajadores activos
    const activeEmployees = useMemo(() => {
        return employees.filter(e => e.isActive && e.role !== 'admin');
    }, [employees]);

    // Limpieza de URL temporal al desmontar
    useEffect(() => {
        return () => {
            if (repBlobUrl) URL.revokeObjectURL(repBlobUrl);
        };
    }, [repBlobUrl]);

    // ─────────────────────────────────────────────────────────────────────────
    // Detección Inteligente de Trabajador por RUT y Nombre
    // ─────────────────────────────────────────────────────────────────────────
    const normalizeRutDigits = (rut: string): string => {
        return (rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
    };

    const detectEmployeeForFile = (fileName: string): { empId: string; method: 'rut' | 'name' } | null => {
        const cleanName = fileName.replace(/\.pdf$/i, '');
        const normFileName = normalizeText(cleanName).toLowerCase();
        const rawDigits = cleanName.replace(/[^0-9kK]/gi, '').toUpperCase();

        // 1. Coincidencia por RUT
        for (const emp of activeEmployees) {
            if (!emp.rut) continue;
            const empDigits = normalizeRutDigits(emp.rut);
            if (empDigits.length >= 7 && rawDigits.includes(empDigits)) {
                return { empId: emp.id, method: 'rut' };
            }
        }

        // 2. Coincidencia por Nombre y Apellido
        const tokens = normFileName
            .replace(/[_\-.,]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length >= 3 && !['liquidacion', 'liquidaciones', 'sueldo', 'anexo', 'contrato', 'remuneracion', 'mes', 'periodo', 'pdf', 'de', 'del', 'los', 'las'].includes(t));

        let bestMatch: Employee | null = null;
        let maxPoints = 0;

        for (const emp of activeEmployees) {
            const first = normalizeText(emp.firstName || '').toLowerCase();
            const lastP = normalizeText(emp.lastNamePaterno || '').toLowerCase();
            const lastM = normalizeText(emp.lastNameMaterno || '').toLowerCase();

            let points = 0;
            const hasFirst = tokens.some(t => first.includes(t) || t.includes(first));
            const hasLastP = tokens.some(t => lastP.includes(t) || t.includes(lastP));
            const hasLastM = lastM && tokens.some(t => lastM.includes(t) || t.includes(lastM));

            if (hasFirst && hasLastP) points += 4;
            if (hasFirst && hasLastM) points += 2;
            if (hasLastP && hasLastM) points += 2;

            if (points > maxPoints) {
                maxPoints = points;
                bestMatch = emp;
            }
        }

        if (bestMatch && maxPoints >= 4) {
            return { empId: bestMatch.id, method: 'name' };
        }

        return null;
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Carga de Múltiples Archivos
    // ─────────────────────────────────────────────────────────────────────────
    const handleFilesAdded = (rawFiles: FileList | File[]) => {
        const newFiles = Array.from(rawFiles).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
        if (newFiles.length === 0) {
            showNotification('Selecciona archivos en formato PDF.', 'warning');
            return;
        }

        const mapped: BatchFileItem[] = newFiles.map(file => {
            const detection = detectEmployeeForFile(file.name);
            return {
                id: `batch_file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                file,
                name: file.name,
                size: file.size,
                assignedEmployeeId: detection ? detection.empId : null,
                suggestionMethod: detection ? detection.method : undefined,
                isConfirmed: false,
                isCompatible: true,
                processStatus: 'idle'
            };
        });

        setFilesList(prev => [...prev, ...mapped]);
    };

    const handleRemoveFile = (id: string) => {
        setFilesList(prev => prev.filter(f => f.id !== id));
        if (representativeFileId === id) {
            setRepresentativeFileId(null);
            if (repBlobUrl) {
                URL.revokeObjectURL(repBlobUrl);
                setRepBlobUrl(null);
            }
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Configuración del Documento Representativo y Previsualización
    // ─────────────────────────────────────────────────────────────────────────
    useEffect(() => {
        // Seleccionar automáticamente el primer archivo disponible si no hay representativo
        if (filesList.length > 0 && !representativeFileId) {
            const first = filesList[0];
            setRepresentativeFileId(first.id);
        }
    }, [filesList, representativeFileId]);

    useEffect(() => {
        const repItem = filesList.find(f => f.id === representativeFileId);
        if (repItem && currentStep === 'firma') {
            setIsLoadingPdfPreview(true);
            if (repBlobUrl) URL.revokeObjectURL(repBlobUrl);
            const url = URL.createObjectURL(repItem.file);
            setRepBlobUrl(url);

            (async () => {
                try {
                    const bytes = await repItem.file.arrayBuffer();
                    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
                    const totalP = pdfDoc.getPageCount();
                    setRepTotalPages(totalP);
                    const targetIdx = sigConfig.page === 'last' ? totalP - 1 : Math.min(sigConfig.pageNumber - 1, totalP - 1);
                    const page = pdfDoc.getPage(Math.max(0, targetIdx));
                    const { width, height } = page.getSize();
                    setPagePdfDimensions({ width: Math.round(width), height: Math.round(height) });
                } catch (e) {
                    console.error('Error calculando dimensiones de PDF representativo:', e);
                } finally {
                    setIsLoadingPdfPreview(false);
                }
            })();
        }
    }, [representativeFileId, currentStep, sigConfig.page, sigConfig.pageNumber]);

    // Constantes de dimensión de la firma (coinciden con stamp de la app)
    const SIG_BOX_WIDTH = 120;
    const SIG_BOX_HEIGHT = 50;

    // Posicionamiento instantáneo al hacer clic en cualquier parte del PDF
    const handlePageClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (hasDraggedRef.current) return;
        const rect = pageContainerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        const ratioX = Math.max(0, Math.min(1, clickX / rect.width));
        const ratioY = Math.max(0, Math.min(1, clickY / rect.height));

        const docW = pagePdfDimensions.width || 612;
        const docH = pagePdfDimensions.height || 792;

        let newX = Math.round((ratioX * docW) - (SIG_BOX_WIDTH / 2));
        let newY = Math.round(((1 - ratioY) * docH) - (SIG_BOX_HEIGHT / 2));

        newX = Math.max(10, Math.min(docW - SIG_BOX_WIDTH - 10, newX));
        newY = Math.max(10, Math.min(docH - SIG_BOX_HEIGHT - 10, newY));

        setSigConfig(prev => ({ ...prev, posicionX: newX, posicionY: newY }));
    };

    // Arrastre suave con el ratón o táctil
    const handleSigPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        e.stopPropagation();
        e.preventDefault();
        dragStartRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            sigX: sigConfig.posicionX,
            sigY: sigConfig.posicionY
        };
        hasDraggedRef.current = false;
        setIsDraggingSig(true);
        try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {}
    };

    const handleSigPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragStartRef.current || !pageContainerRef.current) return;
        const rect = pageContainerRef.current.getBoundingClientRect();
        if (!rect) return;

        const deltaX = e.clientX - dragStartRef.current.startX;
        const deltaY = e.clientY - dragStartRef.current.startY;

        if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
            hasDraggedRef.current = true;
        }

        const docW = pagePdfDimensions.width || 612;
        const docH = pagePdfDimensions.height || 792;

        const scaleX = docW / rect.width;
        const scaleY = docH / rect.height;

        const deltaPdfX = deltaX * scaleX;
        const deltaPdfY = -deltaY * scaleY;

        let newX = Math.round(dragStartRef.current.sigX + deltaPdfX);
        let newY = Math.round(dragStartRef.current.sigY + deltaPdfY);

        newX = Math.max(10, Math.min(docW - SIG_BOX_WIDTH - 10, newX));
        newY = Math.max(10, Math.min(docH - SIG_BOX_HEIGHT - 10, newY));

        setSigConfig(prev => ({ ...prev, posicionX: newX, posicionY: newY }));
    };

    const handleSigPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        dragStartRef.current = null;
        setIsDraggingSig(false);
        try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {}
        setTimeout(() => {
            hasDraggedRef.current = false;
        }, 100);
    };

    const applyQuickPreset = (preset: 'left' | 'center' | 'right' | 'middle') => {
        const docW = pagePdfDimensions.width || 612;
        const docH = pagePdfDimensions.height || 792;
        if (preset === 'left') {
            setSigConfig(prev => ({ ...prev, posicionX: 40, posicionY: 40 }));
        } else if (preset === 'center') {
            setSigConfig(prev => ({ ...prev, posicionX: Math.round((docW - SIG_BOX_WIDTH) / 2), posicionY: 40 }));
        } else if (preset === 'right') {
            setSigConfig(prev => ({ ...prev, posicionX: Math.round(docW - SIG_BOX_WIDTH - 40), posicionY: 40 }));
        } else if (preset === 'middle') {
            setSigConfig(prev => ({
                ...prev,
                posicionX: Math.round((docW - SIG_BOX_WIDTH) / 2),
                posicionY: Math.round((docH - SIG_BOX_HEIGHT) / 2)
            }));
        }
    };

    // Aplicar plantilla de firma si se selecciona
    const handleSelectSignatureTemplate = (tplId: string) => {
        setSelectedTemplateId(tplId);
        const tpl = signatureTemplates.find(t => t.id === tplId);
        if (tpl) {
            setSigConfig({
                page: tpl.pageType,
                pageNumber: tpl.pageNumber || 1,
                posicionX: tpl.posicionX ?? 246,
                posicionY: tpl.posicionY ?? 90
            });
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Procesamiento Masivo con Reintentos y Manejo Granular de Errores
    // ─────────────────────────────────────────────────────────────────────────
    const handleExecuteBatchProcessing = async () => {
        const toProcess = filesList.filter(f => f.assignedEmployeeId && f.processStatus !== 'success');
        if (toProcess.length === 0) {
            showNotification('No hay archivos pendientes para procesar.', 'warning');
            return;
        }

        setIsProcessing(true);
        setCurrentStep('procesamiento');

        let successCount = 0;

        for (const item of toProcess) {
            // Actualizar estado a subiendo
            setFilesList(prev => prev.map(f => f.id === item.id ? { ...f, processStatus: 'uploading' } : f));

            try {
                // 1. Subir archivo a Storage
                const cleanFileName = item.name.replace(/\.pdf$/i, '');
                const uniqueStorageName = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${item.name}`;
                const originalUrl = await uploadFile(item.file, `original_docs/${uniqueStorageName}`);

                // 2. Título personalizado o limpio
                const finalTitle = customTitlePrefix.trim()
                    ? `${customTitlePrefix.trim()} - ${cleanFileName}`
                    : cleanFileName;

                // 3. Registrar documento en Firestore
                setFilesList(prev => prev.map(f => f.id === item.id ? { ...f, processStatus: 'saving', uploadedUrl: originalUrl } : f));

                const createdId = await addDigitalDocument({
                    title: finalTitle,
                    type: docType,
                    assignedTo: item.assignedEmployeeId!,
                    originalUrl,
                    signatureConfig: {
                        page: sigConfig.page,
                        ...(sigConfig.page === 'specific' ? { pageNumber: sigConfig.pageNumber } : {}),
                        posicionX: sigConfig.posicionX,
                        posicionY: sigConfig.posicionY
                    } as any
                });

                // Éxito
                successCount++;
                setProcessedCount(prev => prev + 1);
                setFilesList(prev => prev.map(f => f.id === item.id ? { ...f, processStatus: 'success', createdDocId: createdId } : f));
            } catch (err: any) {
                console.error(`Error procesando archivo ${item.name}:`, err);
                setFilesList(prev => prev.map(f => f.id === item.id ? {
                    ...f,
                    processStatus: 'error',
                    processError: err.message || 'Error de conexión durante el registro'
                } : f));
            }
        }

        setIsProcessing(false);
        if (successCount > 0) {
            showNotification(`Se procesaron ${successCount} documento${successCount > 1 ? 's' : ''} exitosamente.`, 'success');
            if (onSuccess) onSuccess();
        }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Validaciones de Transición entre Pasos
    // ─────────────────────────────────────────────────────────────────────────
    const unassignedCount = useMemo(() => {
        return filesList.filter(f => !f.assignedEmployeeId).length;
    }, [filesList]);

    const incompatibleCount = useMemo(() => {
        return filesList.filter(f => !f.isCompatible).length;
    }, [filesList]);

    const uniqueAssignedEmployeesCount = useMemo(() => {
        const ids = new Set(filesList.map(f => f.assignedEmployeeId).filter(Boolean));
        return ids.size;
    }, [filesList]);

    const canProceedFromStep = (step: WizardStep): boolean => {
        switch (step) {
            case 'tipo':
                return !!docType;
            case 'archivos':
                return filesList.length > 0 && unassignedCount === 0;
            case 'firma':
                return !!representativeFileId && filesList.length > 0;
            default:
                return true;
        }
    };

    const handleNextStep = () => {
        if (currentStep === 'tipo') {
            setCurrentStep('archivos');
        } else if (currentStep === 'archivos') {
            setCurrentStep('firma');
        }
    };

    const handlePrevStep = () => {
        if (currentStep === 'archivos') setCurrentStep('tipo');
        else if (currentStep === 'firma') setCurrentStep('archivos');
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-3 md:p-6 overflow-hidden select-none">
            <div className="bg-white rounded-3xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col h-[92vh] max-h-[900px] animate-in zoom-in-95 duration-200 border border-slate-100">
                
                {/* ══ HEADER ══ */}
                <div className="p-5 md:px-8 md:py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/70 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-200">
                            <Layers size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg md:text-xl font-black text-slate-800 tracking-tight uppercase">
                                Asignación Masiva con Firma Compartida
                            </h2>
                            <p className="text-slate-400 text-xs font-bold mt-0.5">
                                Carga individual por trabajador · Plantilla y firma unificadas ({docType})
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isProcessing}
                        className="p-2 hover:bg-slate-200 text-slate-400 hover:text-slate-700 rounded-full transition-colors disabled:opacity-40"
                    >
                        <X size={22} />
                    </button>
                </div>

                {/* ══ INDICADOR DE PASOS ══ */}
                <div className="px-6 py-3 bg-white border-b border-slate-100 shrink-0 overflow-x-auto">
                    <div className="flex items-center justify-between min-w-[450px] text-xs font-bold">
                        {[
                            { id: 'tipo', label: '1. Tipo' },
                            { id: 'archivos', label: `2. Archivos y Trabajadores (${filesList.length})` },
                            { id: 'firma', label: '3. Posición de Firma' },
                            { id: 'procesamiento', label: '4. Procesar' }
                        ].map((s, idx) => {
                            const stepList = ['tipo', 'archivos', 'firma', 'procesamiento'];
                            const isCurrent = currentStep === s.id;
                            const isPassed = stepList.indexOf(currentStep) > idx;
                            return (
                                <div key={s.id} className="flex items-center gap-2">
                                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-black transition-all ${
                                        isCurrent ? 'bg-blue-600 text-white shadow-sm' :
                                        isPassed ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
                                    }`}>
                                        {s.label}
                                    </span>
                                    {idx < 3 && <ChevronRight size={14} className="text-slate-300" />}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* ══ CONTENIDO DINÁMICO DEL WIZARD ══ */}
                <div className="flex-1 overflow-y-auto p-5 md:p-8 space-y-6">

                    {/* ── PASO 1: TIPO DE DOCUMENTO ── */}
                    {currentStep === 'tipo' && (
                        <div className="max-w-2xl mx-auto space-y-6 py-4 animate-in fade-in duration-200">
                            <div className="text-center space-y-1">
                                <h3 className="text-xl font-black text-slate-800">Selecciona el tipo de documento a cargar</h3>
                                <p className="text-sm font-medium text-slate-500">
                                    Todos los documentos de esta tanda compartirán la misma categoría y posición de firma.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                                {[
                                    { type: 'Liquidación de Sueldo', desc: 'Liquidaciones individuales con firma y huella en el pie.', badge: 'Recomendado' },
                                    { type: 'Anexo de Contrato', desc: 'Anexos de jornada, turnos o condiciones laborales.' },
                                    { type: 'Contrato', desc: 'Contratos individuales de trabajo estandarizados.' },
                                    { type: 'Reglamento Interno', desc: 'Comprobantes de entrega y recepción de reglamento.' },
                                    { type: 'EPP', desc: 'Entrega y recepción de elementos de protección personal.' },
                                    { type: 'ODI', desc: 'Obligación de Informar los Riesgos Laborales.' },
                                    { type: 'Otro', desc: 'Cualquier otro documento estandarizado por trabajador.' }
                                ].map(item => (
                                    <button
                                        key={item.type}
                                        type="button"
                                        onClick={() => setDocType(item.type as SharedDocType)}
                                        className={`p-4 rounded-2xl border-2 text-left transition-all flex flex-col justify-between ${
                                            docType === item.type
                                                ? 'border-blue-600 bg-blue-50/50 shadow-md shadow-blue-100'
                                                : 'border-slate-100 hover:border-slate-200 bg-white hover:bg-slate-50/50'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between">
                                            <span className="font-black text-sm text-slate-800">{item.type}</span>
                                            {item.badge && (
                                                <span className="text-[10px] font-black uppercase bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                                                    {item.badge}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-400 mt-2 font-medium">{item.desc}</p>
                                    </button>
                                ))}
                            </div>

                            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60 space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                    Prefijo de título (Opcional)
                                </label>
                                <input
                                    type="text"
                                    placeholder="Ej: Liquidación Octubre 2026 (se antepondrá al nombre del archivo)"
                                    value={customTitlePrefix}
                                    onChange={(e) => setCustomTitlePrefix(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>
                    )}

                    {/* ── PASO 2: ARCHIVOS Y ASIGNACIÓN INMEDIATA DE TRABAJADORES ── */}
                    {currentStep === 'archivos' && (
                        <div className="space-y-5 animate-in fade-in duration-200">
                            {/* Si no hay archivos, dropzone principal grande */}
                            {filesList.length === 0 ? (
                                <div className="relative group border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-3xl p-10 bg-slate-50 hover:bg-blue-50/30 transition-all text-center flex flex-col items-center justify-center cursor-pointer">
                                    <input
                                        type="file"
                                        accept="application/pdf"
                                        multiple
                                        onChange={(e) => {
                                            if (e.target.files) handleFilesAdded(e.target.files);
                                        }}
                                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                    />
                                    <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center text-blue-600 mb-3 group-hover:scale-110 transition-transform">
                                        <Upload size={30} />
                                    </div>
                                    <h4 className="text-base font-black text-slate-800">
                                        Arrastra o selecciona múltiples archivos PDF
                                    </h4>
                                    <p className="text-xs font-medium text-slate-500 max-w-md mt-1 leading-relaxed">
                                        Ej: <code>Liquidacion_12345678-9.pdf</code> o <code>Liquidacion_Juan_Perez.pdf</code>.
                                        El sistema asociará automáticamente a cada trabajador por RUT o Nombre y podrás verificar o cambiar la asignación inmediatamente.
                                    </p>
                                    <span className="mt-4 px-5 py-2.5 bg-blue-600 group-hover:bg-blue-700 text-white rounded-xl text-xs font-black shadow-md shadow-blue-200 transition">
                                        Seleccionar Archivos PDF
                                    </span>
                                </div>
                            ) : (
                                <>
                                    {/* Barra superior compacta para agregar más y métricas */}
                                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 md:p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                                        <div className="relative group border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-3 bg-white hover:bg-blue-50/20 transition-all flex items-center gap-3 cursor-pointer flex-1">
                                            <input
                                                type="file"
                                                accept="application/pdf"
                                                multiple
                                                onChange={(e) => {
                                                    if (e.target.files) handleFilesAdded(e.target.files);
                                                }}
                                                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                                            />
                                            <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                                                <Upload size={18} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-black text-slate-800">Agregar más archivos PDF</p>
                                                <p className="text-[11px] text-slate-400 font-medium truncate">Arrastra más archivos aquí o haz clic para añadirlos a la tanda</p>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                                            <span className="px-3 py-1.5 bg-white text-slate-700 rounded-xl border border-slate-200 text-xs font-bold shadow-2xs">
                                                Total: {filesList.length} docs
                                            </span>
                                            <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-200 text-xs font-bold shadow-2xs flex items-center gap-1">
                                                <Check size={12} /> {filesList.length - unassignedCount} asignados
                                            </span>
                                            {unassignedCount > 0 ? (
                                                <span className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-xl border border-amber-200 text-xs font-bold shadow-2xs flex items-center gap-1 animate-pulse">
                                                    <AlertTriangle size={12} /> {unassignedCount} pendientes
                                                </span>
                                            ) : (
                                                <span className="px-3 py-1.5 bg-emerald-100 text-emerald-800 rounded-xl border border-emerald-300 text-xs font-bold shadow-2xs flex items-center gap-1">
                                                    <CheckCircle2 size={12} /> Todo asignado
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => setFilesList([])}
                                                className="px-3 py-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold transition flex items-center gap-1"
                                                title="Quitar todos los archivos"
                                            >
                                                <Trash2 size={13} /> Limpiar
                                            </button>
                                        </div>
                                    </div>

                                    {/* Alerta contextual si hay archivos sin asignar */}
                                    {unassignedCount > 0 && (
                                        <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-3 px-4 flex items-center gap-2.5 text-amber-800 text-xs font-bold">
                                            <AlertTriangle size={16} className="text-amber-600 shrink-0" />
                                            <span>
                                                Hay <strong>{unassignedCount} archivo{unassignedCount > 1 ? 's' : ''}</strong> sin trabajador asignado. Pulsa <strong>"Asignar"</strong> para seleccionar al trabajador antes de pasar al paso de firma.
                                            </span>
                                        </div>
                                    )}

                                    {/* Tabla unificada de Archivos y Trabajadores */}
                                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                                        <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
                                            <table className="w-full text-left text-xs">
                                                <thead className="bg-slate-50 text-slate-600 font-black uppercase text-[10px] tracking-wider border-b border-slate-200 sticky top-0 z-10 shadow-2xs">
                                                    <tr>
                                                        <th className="px-4 py-3 w-10 text-center">#</th>
                                                        <th className="px-4 py-3">Archivo PDF</th>
                                                        <th className="px-4 py-3">Trabajador Asignado</th>
                                                        <th className="px-4 py-3 text-center">Detección</th>
                                                        <th className="px-4 py-3 text-right">Acción</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {filesList.map((item, idx) => {
                                                        const assignedEmp = activeEmployees.find(e => e.id === item.assignedEmployeeId);

                                                        return (
                                                            <tr key={item.id} className={`hover:bg-slate-50/70 transition-colors ${!item.assignedEmployeeId ? 'bg-amber-50/30' : ''}`}>
                                                                <td className="px-4 py-3 font-mono text-slate-400 text-center text-[11px]">
                                                                    {idx + 1}
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    <div className="flex items-center gap-2.5 min-w-0">
                                                                        <FileText size={18} className="text-blue-500 shrink-0" />
                                                                        <div className="min-w-0">
                                                                            <p className="font-bold text-slate-800 truncate max-w-xs md:max-w-sm" title={item.name}>
                                                                                {item.name}
                                                                            </p>
                                                                            <p className="text-[10px] text-slate-400">
                                                                                {(item.size / 1024).toFixed(1)} KB
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    {assignedEmp ? (
                                                                        <div className="flex items-center gap-2">
                                                                            <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-black text-[11px] shrink-0">
                                                                                {assignedEmp.firstName.charAt(0)}
                                                                            </div>
                                                                            <div>
                                                                                <span className="font-bold text-slate-900 block leading-tight">
                                                                                    {assignedEmp.firstName} {assignedEmp.lastNamePaterno} {assignedEmp.lastNameMaterno || ''}
                                                                                </span>
                                                                                <span className="font-mono text-[10px] text-slate-400">
                                                                                    RUT: {assignedEmp.rut} · {assignedEmp.cargo || 'Guardia'}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <span className="inline-flex items-center gap-1 font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg text-[11px]">
                                                                            <AlertCircle size={13} /> Sin trabajador asignado
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td className="px-4 py-3 text-center">
                                                                    {assignedEmp ? (
                                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                                            <Check size={11} />
                                                                            {item.suggestionMethod === 'rut' ? 'Por RUT' :
                                                                             item.suggestionMethod === 'name' ? 'Por Nombre' : 'Manual'}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                                                            Pendiente
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td className="px-4 py-3 text-right">
                                                                    <div className="flex items-center justify-end gap-1.5">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setActiveAssigningFileId(item.id);
                                                                                setEmployeeSearchTerm('');
                                                                            }}
                                                                            className={`px-3 py-1.5 rounded-xl font-bold text-[11px] transition flex items-center gap-1 shadow-2xs ${
                                                                                assignedEmp
                                                                                    ? 'bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-700'
                                                                                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200'
                                                                            }`}
                                                                        >
                                                                            {assignedEmp ? 'Cambiar' : 'Asignar'}
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleRemoveFile(item.id)}
                                                                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                                                                            title="Eliminar archivo de la tanda"
                                                                        >
                                                                            <Trash2 size={15} />
                                                                        </button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* Modal Flotante de Selección Inmediata de Trabajador */}
                            {activeAssigningFileId && (
                                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
                                    <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-slate-100 p-6 space-y-4 animate-in zoom-in-95 duration-150">
                                        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                                            <div className="min-w-0 pr-3">
                                                <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">
                                                    Asignar Trabajador
                                                </h4>
                                                <p className="text-xs text-slate-500 font-bold truncate mt-0.5" title={filesList.find(f => f.id === activeAssigningFileId)?.name}>
                                                    Archivo: {filesList.find(f => f.id === activeAssigningFileId)?.name}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => setActiveAssigningFileId(null)}
                                                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition"
                                            >
                                                <X size={18} />
                                            </button>
                                        </div>

                                        <div className="relative">
                                            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <input
                                                type="text"
                                                placeholder="Buscar por Nombre, Apellido o RUT..."
                                                value={employeeSearchTerm}
                                                onChange={(e) => setEmployeeSearchTerm(e.target.value)}
                                                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
                                                autoFocus
                                            />
                                        </div>

                                        <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-2xl">
                                            {activeEmployees
                                                .filter(emp => {
                                                    const q = normalizeText(employeeSearchTerm).toLowerCase();
                                                    const full = normalizeText(`${emp.firstName} ${emp.lastNamePaterno} ${emp.lastNameMaterno || ''}`).toLowerCase();
                                                    const rut = normalizeText(emp.rut || '').toLowerCase();
                                                    return full.includes(q) || rut.includes(q);
                                                })
                                                .slice(0, 30)
                                                .map(emp => (
                                                    <button
                                                        key={emp.id}
                                                        type="button"
                                                        onClick={() => {
                                                            setFilesList(prev => prev.map(f => f.id === activeAssigningFileId ? {
                                                                ...f,
                                                                assignedEmployeeId: emp.id,
                                                                suggestionMethod: 'manual',
                                                                isConfirmed: true
                                                            } : f));
                                                            setActiveAssigningFileId(null);
                                                        }}
                                                        className="w-full text-left p-3 px-3.5 hover:bg-blue-50 flex items-center justify-between transition group"
                                                    >
                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-black text-xs shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                                                {emp.firstName.charAt(0)}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="font-bold text-xs text-slate-800 truncate">
                                                                    {emp.firstName} {emp.lastNamePaterno} {emp.lastNameMaterno || ''}
                                                                </p>
                                                                <p className="text-[10px] text-slate-400 font-mono">
                                                                    RUT: {emp.rut} · {emp.cargo || 'Guardia'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <span className="text-xs text-blue-600 font-bold px-2.5 py-1 bg-blue-50 group-hover:bg-blue-600 group-hover:text-white rounded-lg transition shrink-0">
                                                            Asignar
                                                        </span>
                                                    </button>
                                                ))}
                                            {activeEmployees.filter(emp => {
                                                const q = normalizeText(employeeSearchTerm).toLowerCase();
                                                const full = normalizeText(`${emp.firstName} ${emp.lastNamePaterno} ${emp.lastNameMaterno || ''}`).toLowerCase();
                                                const rut = normalizeText(emp.rut || '').toLowerCase();
                                                return full.includes(q) || rut.includes(q);
                                            }).length === 0 && (
                                                <div className="p-6 text-center text-xs text-slate-400 font-bold">
                                                    No se encontraron trabajadores que coincidan con la búsqueda.
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex justify-end pt-1">
                                            <button
                                                type="button"
                                                onClick={() => setActiveAssigningFileId(null)}
                                                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
                                            >
                                                Cerrar
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── PASO 3: CONFIGURAR LA FIRMA UNA SOLA VEZ ── */}
                    {currentStep === 'firma' && (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-200">
                            {/* Panel Izquierdo: Controles de Configuración y Ubicación Rápida */}
                            <div className="lg:col-span-5 space-y-4">
                                {/* Banner interactivo moderno */}
                                <div className="bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border border-blue-200 rounded-2xl p-3.5 flex items-start gap-3 text-blue-900 shadow-sm">
                                    <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-blue-200 mt-0.5">
                                        <MousePointerClick size={18} />
                                    </div>
                                    <div className="text-xs">
                                        <p className="font-black text-blue-950 uppercase tracking-wide">Posicionamiento con el Ratón</p>
                                        <p className="text-blue-700 font-medium text-[11px] mt-0.5 leading-snug">
                                            <strong>Haz clic</strong> en cualquier punto de la hoja para mover la firma, o <strong>arrástrala directamente</strong> con el cursor hasta la posición deseada.
                                        </p>
                                    </div>
                                </div>

                                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/70 space-y-4">
                                    {/* Presets Rápidos de 1 Clic */}
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                                            <Crosshair size={12} className="text-blue-600" />
                                            Ubicaciones Rápidas (1 Clic)
                                        </label>
                                        <div className="grid grid-cols-3 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => applyQuickPreset('left')}
                                                className="py-2 px-2 rounded-xl text-[11px] font-black border bg-white text-slate-700 border-slate-200 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 transition shadow-sm active:scale-95"
                                            >
                                                Pie Izq.
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => applyQuickPreset('center')}
                                                className="py-2 px-2 rounded-xl text-[11px] font-black border bg-white text-slate-700 border-slate-200 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 transition shadow-sm active:scale-95"
                                            >
                                                Pie Centro
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => applyQuickPreset('right')}
                                                className="py-2 px-2 rounded-xl text-[11px] font-black border bg-white text-slate-700 border-slate-200 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 transition shadow-sm active:scale-95"
                                            >
                                                Pie Der.
                                            </button>
                                        </div>
                                    </div>

                                    {/* Coordenadas activas */}
                                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 flex items-center justify-between">
                                        <span className="text-[11px] font-bold text-slate-500">Coordenadas actuales:</span>
                                        <div className="flex gap-2">
                                            <span className="px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-mono font-black border border-blue-100">
                                                X: {sigConfig.posicionX} px
                                            </span>
                                            <span className="px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-mono font-black border border-indigo-100">
                                                Y: {sigConfig.posicionY} px
                                            </span>
                                        </div>
                                    </div>

                                    {/* Selector de Plantilla Guardada */}
                                    {signatureTemplates.length > 0 && (
                                        <div className="space-y-1.5 pt-1 border-t border-slate-200/60">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                                Cargar desde Plantilla Existente
                                            </label>
                                            <select
                                                value={selectedTemplateId}
                                                onChange={(e) => handleSelectSignatureTemplate(e.target.value)}
                                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                                            >
                                                <option value="">Configuración manual / interactiva</option>
                                                {signatureTemplates.map(tpl => (
                                                    <option key={tpl.id} value={tpl.id}>
                                                        {tpl.nombre} ({tpl.docType})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    {/* Selección de Página */}
                                    <div className="space-y-2 pt-1 border-t border-slate-200/60">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                            Página de la Firma
                                        </label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setSigConfig(prev => ({ ...prev, page: 'last' }))}
                                                className={`py-2 px-3 rounded-xl text-xs font-black border transition ${
                                                    sigConfig.page === 'last'
                                                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                                                }`}
                                            >
                                                Última Hoja
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setSigConfig(prev => ({ ...prev, page: 'specific' }))}
                                                className={`py-2 px-3 rounded-xl text-xs font-black border transition ${
                                                    sigConfig.page === 'specific'
                                                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                                                }`}
                                            >
                                                Página Específica
                                            </button>
                                        </div>
                                        {sigConfig.page === 'specific' && (
                                            <div className="pt-1">
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={sigConfig.pageNumber}
                                                    onChange={(e) => setSigConfig(prev => ({ ...prev, pageNumber: Math.max(1, parseInt(e.target.value) || 1) }))}
                                                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                                                    placeholder="Número de página (Ej: 1)"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {/* Acordeón para Ajuste Milimétrico Manual (Opcional) */}
                                    <div className="pt-2 border-t border-slate-200/60">
                                        <button
                                            type="button"
                                            onClick={() => setShowFineTuningSliders(!showFineTuningSliders)}
                                            className="w-full flex items-center justify-between text-[11px] font-black text-slate-500 hover:text-slate-800 transition py-1"
                                        >
                                            <span className="flex items-center gap-1.5">
                                                <Sliders size={13} />
                                                Ajuste manual numérico (sliders)
                                            </span>
                                            {showFineTuningSliders ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                        </button>

                                        {showFineTuningSliders && (
                                            <div className="space-y-4 pt-3 mt-2 border-t border-slate-200/60 animate-in fade-in duration-150">
                                                <div className="space-y-1.5">
                                                    <div className="flex justify-between text-xs font-black">
                                                        <span className="text-slate-600">Posición Horizontal (X)</span>
                                                        <span className="text-blue-600 font-mono">{sigConfig.posicionX} px</span>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        min="10"
                                                        max={pagePdfDimensions.width - SIG_BOX_WIDTH - 10}
                                                        step="2"
                                                        value={sigConfig.posicionX}
                                                        onChange={(e) => setSigConfig(prev => ({ ...prev, posicionX: Number(e.target.value) }))}
                                                        className="w-full accent-blue-600 cursor-pointer"
                                                    />
                                                </div>

                                                <div className="space-y-1.5">
                                                    <div className="flex justify-between text-xs font-black">
                                                        <span className="text-slate-600">Posición Vertical (Y desde fondo)</span>
                                                        <span className="text-blue-600 font-mono">{sigConfig.posicionY} px</span>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        min="10"
                                                        max={pagePdfDimensions.height - SIG_BOX_HEIGHT - 10}
                                                        step="2"
                                                        value={sigConfig.posicionY}
                                                        onChange={(e) => setSigConfig(prev => ({ ...prev, posicionY: Number(e.target.value) }))}
                                                        className="w-full accent-blue-600 cursor-pointer"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Panel Derecho: Visor de PDF con Caja de Firma Reactiva y Arrastrable */}
                            <div className="lg:col-span-7 bg-slate-100 rounded-2xl border border-slate-200 p-4 flex flex-col items-center justify-start min-h-[460px] max-h-[560px] overflow-y-auto">
                                <div className="w-full flex items-center justify-between pb-3 border-b border-slate-200 mb-3 shrink-0">
                                    <div className="flex items-center gap-1.5">
                                        <Layers size={14} className="text-blue-600" />
                                        <span className="text-[11px] font-black text-slate-700 uppercase tracking-wider truncate max-w-[200px] sm:max-w-xs">
                                            {filesList.find(f => f.id === representativeFileId)?.name}
                                        </span>
                                    </div>
                                    {filesList.length > 1 && (
                                        <select
                                            value={representativeFileId || ''}
                                            onChange={(e) => setRepresentativeFileId(e.target.value)}
                                            className="text-[11px] font-bold bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none text-slate-700 cursor-pointer"
                                        >
                                            {filesList.map(f => (
                                                <option key={f.id} value={f.id}>Ver: {f.name}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>

                                {isLoadingPdfPreview || !repBlobUrl ? (
                                    <div className="p-8 text-center text-slate-400 flex flex-col items-center gap-2 my-auto">
                                        <Loader2 size={24} className="animate-spin text-blue-600" />
                                        <p className="text-xs font-bold">Cargando vista previa del documento...</p>
                                    </div>
                                ) : (
                                    <div className="relative inline-block my-auto">
                                        <Document
                                            file={repBlobUrl}
                                            onLoadSuccess={({ numPages }) => setRepTotalPages(numPages)}
                                            loading={<Loader2 size={24} className="animate-spin text-blue-600 my-10 mx-auto" />}
                                        >
                                            <div
                                                ref={pageContainerRef}
                                                onClick={handlePageClick}
                                                className="relative inline-block shadow-2xl rounded-lg bg-white overflow-hidden cursor-crosshair select-none group touch-none"
                                                title="Haz clic en cualquier punto para mover la firma aquí"
                                            >
                                                <Page
                                                    pageNumber={sigConfig.page === 'last' ? repTotalPages : Math.min(sigConfig.pageNumber, repTotalPages)}
                                                    width={370}
                                                    renderAnnotationLayer={false}
                                                    renderTextLayer={false}
                                                    onLoadSuccess={(pageData) => {
                                                        if (pageData?.originalWidth && pageData?.originalHeight) {
                                                            setPagePdfDimensions({
                                                                width: Math.round(pageData.originalWidth),
                                                                height: Math.round(pageData.originalHeight)
                                                            });
                                                        }
                                                    }}
                                                />

                                                {/* Tooltip de guía flotante al pasar el mouse por la hoja */}
                                                <div className="absolute top-2 left-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                                    <span className="px-2 py-1 bg-slate-900/80 backdrop-blur-md text-white text-[9px] font-black uppercase tracking-wider rounded-md flex items-center gap-1.5 shadow-md">
                                                        <MousePointerClick size={10} className="text-blue-400" />
                                                        Clic para ubicar
                                                    </span>
                                                </div>

                                                {/* Caja Interactiva Draggable de Ubicación de Firma */}
                                                <div
                                                    onPointerDown={handleSigPointerDown}
                                                    onPointerMove={handleSigPointerMove}
                                                    onPointerUp={handleSigPointerUp}
                                                    onPointerCancel={handleSigPointerUp}
                                                    className={`absolute rounded-xl flex flex-col items-center justify-center p-1 select-none transition-shadow touch-none ${
                                                        isDraggingSig
                                                            ? 'cursor-grabbing bg-blue-600/35 border-2 border-blue-600 shadow-2xl ring-4 ring-blue-400/40 z-30 scale-[1.02]'
                                                            : 'cursor-grab bg-blue-500/20 hover:bg-blue-500/30 border-2 border-blue-600/90 hover:border-blue-700 shadow-lg hover:shadow-xl z-20 group/box'
                                                    }`}
                                                    style={{
                                                        width: `${(SIG_BOX_WIDTH / (pagePdfDimensions.width || 612)) * 100}%`,
                                                        height: `${(SIG_BOX_HEIGHT / (pagePdfDimensions.height || 792)) * 100}%`,
                                                        bottom: `${(sigConfig.posicionY / (pagePdfDimensions.height || 792)) * 100}%`,
                                                        left: `${(sigConfig.posicionX / (pagePdfDimensions.width || 612)) * 100}%`,
                                                    }}
                                                >
                                                    {/* Chip de coordenadas sobre la caja */}
                                                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-slate-900/95 text-white text-[9px] font-mono font-black rounded-full whitespace-nowrap shadow-md pointer-events-none flex items-center gap-1">
                                                        <Move size={9} className="text-blue-400" />
                                                        <span>X:{sigConfig.posicionX} Y:{sigConfig.posicionY}</span>
                                                    </div>

                                                    {/* Contenido visual de la firma */}
                                                    <div className="w-full h-full border border-dashed border-blue-500/60 rounded-lg flex flex-col items-center justify-center pointer-events-none bg-white/50 backdrop-blur-[1px]">
                                                        <span className="text-[8px] font-black uppercase text-blue-950 tracking-tighter text-center leading-none">
                                                            Firma y Huella
                                                        </span>
                                                        <span className="text-[7px] text-blue-800 font-bold tracking-tight mt-0.5 flex items-center gap-0.5">
                                                            <Move size={7} /> Arrastrar
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </Document>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── PASO 4: PROCESAMIENTO Y RESULTADOS ── */}
                    {currentStep === 'procesamiento' && (
                        <div className="max-w-2xl mx-auto space-y-6 py-4 animate-in fade-in duration-200">
                            <div className="text-center space-y-2">
                                <h3 className="text-xl font-black text-slate-800">
                                    {isProcessing ? 'Procesando Tanda de Documentos...' : 'Procesamiento Finalizado'}
                                </h3>
                                <p className="text-xs font-medium text-slate-500">
                                    {isProcessing
                                        ? `Subiendo archivos a Storage y registrando asignaciones individuales (${processedCount} de ${filesList.length}).`
                                        : 'Revisa el resultado de la carga a continuación.'}
                                </p>
                            </div>

                            {/* Barra de Progreso */}
                            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200">
                                <div
                                    className={`h-full transition-all duration-300 ${isProcessing ? 'bg-blue-600 animate-pulse' : 'bg-emerald-500'}`}
                                    style={{
                                        width: `${Math.round((processedCount / Math.max(1, filesList.length)) * 100)}%`
                                    }}
                                />
                            </div>

                            {/* Tabla de Resultados por Archivo */}
                            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                                    {filesList.map((item, idx) => {
                                        const emp = activeEmployees.find(e => e.id === item.assignedEmployeeId);

                                        return (
                                            <div key={item.id} className="p-3 px-4 flex items-center justify-between text-xs">
                                                <div className="min-w-0 flex items-center gap-2">
                                                    <span className="font-mono text-slate-400">#{idx + 1}</span>
                                                    <div>
                                                        <p className="font-bold text-slate-800 truncate max-w-sm">{item.name}</p>
                                                        <p className="text-[10px] text-slate-400">
                                                            Destinatario: {emp ? `${emp.firstName} ${emp.lastNamePaterno}` : 'Sin asignar'}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="shrink-0">
                                                    {item.processStatus === 'uploading' && (
                                                        <span className="text-[11px] font-bold text-blue-600 flex items-center gap-1">
                                                            <Loader2 size={12} className="animate-spin" /> Subiendo...
                                                        </span>
                                                    )}
                                                    {item.processStatus === 'saving' && (
                                                        <span className="text-[11px] font-bold text-indigo-600 flex items-center gap-1">
                                                            <Loader2 size={12} className="animate-spin" /> Registrando...
                                                        </span>
                                                    )}
                                                    {item.processStatus === 'success' && (
                                                        <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                                            <CheckCircle2 size={12} /> Asignado
                                                        </span>
                                                    )}
                                                    {item.processStatus === 'error' && (
                                                        <span className="text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-0.5 rounded-full flex items-center gap-1" title={item.processError}>
                                                            <AlertCircle size={12} /> Error
                                                        </span>
                                                    )}
                                                    {item.processStatus === 'idle' && (
                                                        <span className="text-[11px] font-bold text-slate-400">Pendiente</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Acciones Finales / Reintento */}
                            {!isProcessing && (
                                <div className="flex justify-end gap-3 pt-2">
                                    {filesList.some(f => f.processStatus === 'error') && (
                                        <button
                                            type="button"
                                            onClick={handleExecuteBatchProcessing}
                                            className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-sm transition"
                                        >
                                            <RefreshCw size={14} /> Reintentar fallidos
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={onClose}
                                        className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-md transition"
                                    >
                                        Finalizar y Cerrar
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                </div>

                {/* ══ FOOTER CON BOTONES DE NAVEGACIÓN ══ */}
                {currentStep !== 'procesamiento' && (
                    <div className="p-4 md:px-8 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between shrink-0">
                        {currentStep !== 'tipo' ? (
                            <button
                                type="button"
                                onClick={handlePrevStep}
                                className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 text-xs font-black uppercase tracking-wider transition flex items-center gap-1.5"
                            >
                                <ChevronLeft size={16} /> Anterior
                            </button>
                        ) : <div />}

                        <div className="flex items-center gap-3">
                            {currentStep === 'archivos' && unassignedCount > 0 && filesList.length > 0 && (
                                <span className="hidden sm:flex text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl items-center gap-1.5">
                                    <AlertTriangle size={13} className="shrink-0" />
                                    {unassignedCount} archivo{unassignedCount > 1 ? 's' : ''} pendiente{unassignedCount > 1 ? 's' : ''} de asignación
                                </span>
                            )}

                            {currentStep === 'firma' ? (
                                <button
                                    type="button"
                                    onClick={handleExecuteBatchProcessing}
                                    disabled={!canProceedFromStep('firma')}
                                    className="px-7 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider shadow-lg shadow-emerald-200 transition flex items-center gap-2 disabled:opacity-40"
                                >
                                    <CheckCircle2 size={16} /> Asignar y Procesar ({filesList.length})
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={handleNextStep}
                                    disabled={!canProceedFromStep(currentStep)}
                                    className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-wider shadow-md shadow-blue-200 transition flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    Siguiente <ChevronRight size={16} />
                                </button>
                            )}
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};

export default SharedSignatureBatchModal;
