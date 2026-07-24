import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
    FileText,
    Upload,
    CheckCircle,
    Eye,
    PenTool,
    Search,
    Trash2,
    X,
    Download,
    Loader2,
    ChevronLeft,
    ChevronRight,
    FileCheck,
    Info,
    AlertTriangle,
    Building,
    Users,
    Layers,
    Clock,
    Plus
} from 'lucide-react';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Document, Page, pdfjs } from 'react-pdf';
import axios from 'axios';
import { DigitalDocument } from '../types';
import { normalizeText } from '../lib/textUtils';

// Configurar worker de react-pdf (Usando el patrón recomendado para Vite)
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

const DocumentsPage: React.FC = () => {
    const {
        currentUser,
        employees,
        sites,
        digitalDocuments,
        addDigitalDocument,
        signDigitalDocument,
        deleteDigitalDocument,
        uploadFile,
        isLoading,
        showNotification,
        preselectedEmployeeForDoc,
        setPreselectedEmployeeForDoc
    } = useAppStore();

    const [activeTab, setActiveTab] = useState<'pending' | 'signed' | 'all'>('pending');
    const [searchTerm, setSearchTerm] = useState('');
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [selectedDocToSign, setSelectedDocToSign] = useState<DigitalDocument | null>(null);
    const [isSigning, setIsSigning] = useState(false);

    // Visualizador de PDF
    const [viewingDoc, setViewingDoc] = useState<DigitalDocument | null>(null);
    const [numPages, setNumPages] = useState<number | null>(null);

    // Firma masiva (Worker)
    const [isBulkSigning, setIsBulkSigning] = useState(false);
    const [bulkSignProgress, setBulkSignProgress] = useState({ current: 0, total: 0 });

    // Paginación interna de documentos por trabajador
    const [employeeDocsPages, setEmployeeDocsPages] = useState<Record<string, number>>({});

    // Diálogo de alerta/confirmación personalizado
    const [alertDialog, setAlertDialog] = useState<{
        title: string;
        message: string;
        type: 'info' | 'confirm' | 'warning';
        onConfirm: () => void;
        onCancel?: () => void;
    } | null>(null);

    // Paginación (Admin)
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 8;

    // Resetear página al cambiar filtros
    useEffect(() => {
        setCurrentPage(1);
        setEmployeeDocsPages({});
    }, [searchTerm, activeTab]);

    // Interceptar pre-selección para asignar contrato (desde Panel RRHH)
    useEffect(() => {
        if (preselectedEmployeeForDoc) {
            setShowUploadModal(true);
            setWizardStep('docs');
            setAssigneeType('colaboradores');
            setSelectedEmployees([preselectedEmployeeForDoc]);
            setPreselectedEmployeeForDoc(null);
        }
    }, [preselectedEmployeeForDoc, setPreselectedEmployeeForDoc]);

    // Opciones del Asistente Masivo (Wizard)
    const [wizardStep, setWizardStep] = useState<'docs' | 'destinatarios' | 'confirmacion' | 'resultado'>('docs');
    const [wizardMode, setWizardMode] = useState<'upload' | 'templates'>('upload');
    
    // Archivos Nuevos
    const [wizardFiles, setWizardFiles] = useState<File[]>([]);
    const [wizardDocTitle, setWizardDocTitle] = useState('');
    const [wizardDocType, setWizardDocType] = useState('Contrato');
    
    // Configuración de firmas
    const [sigPageType, setSigPageType] = useState<'last' | 'specific'>('last');
    const [sigPageNumber, setSigPageNumber] = useState(1);
    const [sigPosition, setSigPosition] = useState<'left' | 'center' | 'right'>('center');

    // Selección de plantillas existentes
    const [selectedTemplates, setSelectedTemplates] = useState<{ title: string; type: string; originalUrl: string }[]>([]);

    // Selección de Destinatarios
    const [assigneeType, setAssigneeType] = useState<'all' | 'sucursal' | 'colaboradores'>('colaboradores');
    const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
    const [selectedSites, setSelectedSites] = useState<number[]>([]);
    const [conflictBehavior, setConflictBehavior] = useState<'omit' | 'overwrite'>('omit');
    const [employeeSearchText, setEmployeeSearchText] = useState('');

    // Resultado de Asignación Masiva
    const [bulkResult, setBulkResult] = useState<{
        docsCount: number;
        workersCount: number;
        generatedCount: number;
        skippedCount: number;
    } | null>(null);

    // Obtener plantillas únicas ya subidas
    const uniqueTemplates = useMemo(() => {
        const seen = new Set<string>();
        const list: { title: string; type: string; originalUrl: string }[] = [];
        digitalDocuments.forEach(d => {
            const key = `${d.title}::${d.originalUrl}`;
            if (!seen.has(key)) {
                seen.add(key);
                list.push({ title: d.title, type: d.type, originalUrl: d.originalUrl });
            }
        });
        return list.sort((a, b) => a.title.localeCompare(b.title));
    }, [digitalDocuments]);

    // METRICAS DEL DASHBOARD (ADMIN)
    const stats = useMemo(() => {
        const total = digitalDocuments.length;
        const pending = digitalDocuments.filter(d => d.status === 'pending').length;
        const signed = digitalDocuments.filter(d => d.status === 'signed').length;
        const compliance = total > 0 ? Math.round((signed / total) * 100) : 0;
        return { total, pending, signed, compliance };
    }, [digitalDocuments]);

    // Top Documentos con más Incumplimiento
    const topIncumplidos = useMemo(() => {
        const counts: Record<string, number> = {};
        digitalDocuments.forEach(d => {
            if (d.status === 'pending') {
                counts[d.title] = (counts[d.title] || 0) + 1;
            }
        });
        return Object.entries(counts)
            .map(([title, count]) => ({ title, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 3);
    }, [digitalDocuments]);

    // Cumplimiento por Sucursal (Site)
    const siteCompliance = useMemo(() => {
        return sites.map(site => {
            const siteEmployees = employees.filter(e => e.currentSiteId === site.id);
            const employeeIds = siteEmployees.map(e => e.id);
            const siteDocs = digitalDocuments.filter(d => employeeIds.includes(d.assignedTo));
            const total = siteDocs.length;
            const signed = siteDocs.filter(d => d.status === 'signed').length;
            const rate = total > 0 ? Math.round((signed / total) * 100) : 100;
            return {
                id: site.id,
                name: site.name,
                total,
                rate
            };
        }).sort((a, b) => a.rate - b.rate); // Ordenar de menor cumplimiento a mayor cumplimiento
    }, [sites, employees, digitalDocuments]);

    // Filtro principal de documentos según pestañas y búsqueda
    const filteredDocs = useMemo(() => {
        let docs = digitalDocuments;

        // Si no es admin, solo ve los asignados a él
        if (currentUser?.role !== 'admin') {
            docs = docs.filter(d => d.assignedTo === currentUser?.uid);
        }

        // Filtro por Tab de firma
        if (activeTab !== 'all') {
            docs = docs.filter(d => d.status === activeTab);
        }

        // Filtro por búsqueda (Título, Tipo o Nombre del Colaborador)
        if (searchTerm) {
            const term = normalizeText(searchTerm);
            docs = docs.filter(d => {
                const docMatches = normalizeText(d.title).includes(term) || normalizeText(d.type).includes(term);
                const assignee = employees.find(e => e.id === d.assignedTo);
                const nameMatches = assignee ? normalizeText(`${assignee.firstName} ${assignee.lastNamePaterno}`).includes(term) : false;
                const rutMatches = assignee ? normalizeText(assignee.rut).includes(term) : false;
                return docMatches || nameMatches || rutMatches;
            });
        }

        return docs;
    }, [digitalDocuments, currentUser, activeTab, searchTerm, employees]);

    // Cantidad de pendientes para la vista de guardia
    const pendingDocsCount = useMemo(() => {
        return digitalDocuments.filter(d => d.assignedTo === currentUser?.uid && d.status === 'pending').length;
    }, [digitalDocuments, currentUser]);

    // Agrupación y Paginación para Administradores
    const groupedDocs = useMemo(() => {
        const groups: Record<string, DigitalDocument[]> = {};

        filteredDocs.forEach(doc => {
            const key = doc.assignedTo;
            if (!groups[key]) groups[key] = [];
            groups[key].push(doc);
        });

        const allGroups = Object.entries(groups).sort((a, b) => {
            const empA = employees.find(e => e.id === a[0]);
            const empB = employees.find(e => e.id === b[0]);
            const nameA = empA ? `${empA.firstName} ${empA.lastNamePaterno}` : 'ZZZ';
            const nameB = empB ? `${empB.firstName} ${empB.lastNamePaterno}` : 'ZZZ';
            return nameA.localeCompare(nameB);
        });

        const totalPages = Math.ceil(allGroups.length / itemsPerPage);
        const paginatedGroups = allGroups.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

        return { paginatedGroups, totalPages, totalCount: allGroups.length };
    }, [filteredDocs, employees, currentPage, itemsPerPage]);

    const { paginatedGroups, totalPages } = groupedDocs;

    // Colaboradores activos filtrados para el asistente masivo
    const wizardFilteredEmployees = useMemo(() => {
        const term = normalizeText(employeeSearchText);
        return employees.filter(e => {
            if (!e.isActive) return false;
            const fullName = normalizeText(`${e.firstName} ${e.lastNamePaterno} ${e.lastNameMaterno || ''}`);
            const rut = normalizeText(e.rut || '');
            return fullName.includes(term) || rut.includes(term);
        });
    }, [employees, employeeSearchText]);

    // EJECUTAR ASIGNACIÓN MASIVA
    const handleExecuteBulkAssignment = async () => {
        try {
            // 1. Obtener los documentos a asignar
            let docsToAssign: { title: string; type: string; originalUrl: string }[] = [];

            if (wizardMode === 'upload') {
                if (wizardFiles.length === 0) {
                    showNotification("Sube al menos un archivo PDF", "warning");
                    return;
                }
                setIsSigning(true);
                // Subir cada archivo nuevo a Firebase Storage
                const uploadPromises = wizardFiles.map(async (file) => {
                    const fileName = `${Date.now()}_${file.name}`;
                    const originalUrl = await uploadFile(file, `original_docs/${fileName}`);
                    return {
                        title: wizardFiles.length === 1 ? wizardDocTitle || file.name.replace('.pdf', '') : file.name.replace('.pdf', ''),
                        type: wizardDocType,
                        originalUrl
                    };
                });
                docsToAssign = await Promise.all(uploadPromises);
            } else {
                if (selectedTemplates.length === 0) {
                    showNotification("Selecciona al menos un documento", "warning");
                    return;
                }
                docsToAssign = [...selectedTemplates];
            }

            // 2. Obtener los trabajadores destinatarios
            let targetWorkers: typeof employees = [];
            if (assigneeType === 'all') {
                targetWorkers = employees.filter(e => e.isActive);
            } else if (assigneeType === 'sucursal') {
                targetWorkers = employees.filter(e => e.isActive && e.currentSiteId && selectedSites.includes(e.currentSiteId));
            } else {
                targetWorkers = employees.filter(e => e.isActive && selectedEmployees.includes(e.id));
            }

            if (targetWorkers.length === 0) {
                showNotification("No hay destinatarios seleccionados", "warning");
                setIsSigning(false);
                return;
            }

            // 3. Procesar asignaciones aplicando reglas
            let generatedCount = 0;
            let skippedCount = 0;

            const signatureConfig: any = {
                page: sigPageType,
                position: sigPosition
            };
            if (sigPageType === 'specific') {
                signatureConfig.pageNumber = Number(sigPageNumber);
            }

            const creationPromises: Promise<any>[] = [];

            for (const doc of docsToAssign) {
                for (const worker of targetWorkers) {
                    // Verificar si ya tiene el mismo documento pendiente
                    const hasPending = digitalDocuments.some(
                        d => d.assignedTo === worker.id && d.title === doc.title && d.status === 'pending'
                    );

                    if (hasPending) {
                        skippedCount++;
                        continue;
                    }

                    // Verificar si ya tiene el mismo documento firmado
                    const hasSigned = digitalDocuments.some(
                        d => d.assignedTo === worker.id && d.title === doc.title && d.status === 'signed'
                    );

                    if (hasSigned && conflictBehavior === 'omit') {
                        skippedCount++;
                        continue;
                    }

                    // Crear la asignación
                    creationPromises.push(
                        addDigitalDocument({
                            title: doc.title,
                            type: doc.type,
                            assignedTo: worker.id,
                            originalUrl: doc.originalUrl,
                            signatureConfig
                        })
                    );
                    generatedCount++;
                }
            }

            if (creationPromises.length > 0) {
                await Promise.all(creationPromises);
            }

            setBulkResult({
                docsCount: docsToAssign.length,
                workersCount: targetWorkers.length,
                generatedCount,
                skippedCount
            });
            setWizardStep('resultado');

        } catch (error) {
            console.error("Error in bulk assignment:", error);
            showNotification("Error al procesar la asignación masiva", "error");
        } finally {
            setIsSigning(false);
        }
    };

    // Cerrar y resetear el asistente
    const resetWizard = () => {
        setShowUploadModal(false);
        setWizardStep('docs');
        setWizardFiles([]);
        setWizardDocTitle('');
        setWizardDocType('Contrato');
        setSelectedTemplates([]);
        setSelectedEmployees([]);
        setSelectedSites([]);
        setEmployeeSearchText('');
        setBulkResult(null);
    };

    // LOGICA DE AUTO-FIRMA EN EL PDF (WORKER)
    const performSign = async (docToSign: DigitalDocument, worker: any) => {
        let ip = 'Unknown';
        try {
            const ipRes = await axios.get('https://api.ipify.org?format=json');
            ip = ipRes.data.ip;
        } catch (e) { console.error("Could not get IP", e); }

        const existingPdfBytes = await fetch(docToSign.originalUrl).then(res => res.arrayBuffer());
        const pdfDoc = await PDFDocument.load(existingPdfBytes);
        const pages = pdfDoc.getPages();

        let pageIndex = pages.length - 1;
        if (docToSign.signatureConfig?.page === 'specific') {
            const specPage = (docToSign.signatureConfig.pageNumber || 1) - 1;
            pageIndex = Math.max(0, Math.min(specPage, pages.length - 1));
        }

        const selectedPage = pages[pageIndex];
        const { width: pdfWidth } = selectedPage.getSize();

        let x = (pdfWidth - 120) / 2;
        if (docToSign.signatureConfig?.position === 'left') {
            x = 50;
        } else if (docToSign.signatureConfig?.position === 'right') {
            x = pdfWidth - 120 - 50;
        }

        const y = 40;

        const signatureImage = await pdfDoc.embedPng(worker.signatureUrl);
        selectedPage.drawImage(signatureImage, {
            x,
            y,
            width: 120,
            height: 50,
        });

        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const timestamp = new Date().toLocaleString();
        const userName = `${worker.firstName} ${worker.lastNamePaterno}`;
        const rut = worker.rut;
        const email = worker.email || 'N/A';
        const uniqueSigId = `SIG-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
        const appVersion = '3.0.6';
        const deviceId = navigator.userAgent.substring(0, 60);

        const line1 = `Firmado digitalmente por: ${userName} (${rut}) | Email: ${email} | Fecha: ${timestamp}`;
        const line2 = `ID Firma: ${uniqueSigId} | IP: ${ip} | App: v${appVersion} | Dispositivo: ${deviceId}`;

        selectedPage.drawText(line1, {
            x: 40,
            y: 25,
            size: 6,
            font,
            color: rgb(0.2, 0.2, 0.2),
        });

        selectedPage.drawText(line2, {
            x: 40,
            y: 15,
            size: 6,
            font,
            color: rgb(0.3, 0.3, 0.3),
        });

        const pdfBytes = await pdfDoc.save();
        const signedFileName = `signed_${docToSign.id}.pdf`;
        const signedBlob = new Blob([pdfBytes as any], { type: 'application/pdf' });
        const signedUrl = await uploadFile(signedBlob, `signed_docs/${signedFileName}`);

        await signDigitalDocument(docToSign.id, signedUrl, {
            ip,
            rut,
            browserInfo: navigator.userAgent
        });
    };

    const handleSignIndividual = async (docToSign: DigitalDocument) => {
        const workerEmployee = employees.find(e => e.id === currentUser?.uid);
        if (!workerEmployee?.signatureUrl) {
            setAlertDialog({
                title: "Firma no registrada",
                message: "No tienes una firma registrada. Por favor, ve a 'Mi Perfil' para registrar tu firma antes de continuar.",
                type: 'warning',
                onConfirm: () => {}
            });
            return;
        }

        setAlertDialog({
            title: "Confirmar Firma",
            message: "¿Deseas firmar este documento utilizando tu firma registrada?",
            type: 'confirm',
            onConfirm: async () => {
                setSelectedDocToSign(docToSign);
                setIsSigning(true);
                try {
                    await performSign(docToSign, workerEmployee);
                    showNotification("Documento firmado correctamente", "success");
                } catch (error) {
                    console.error("Error al firmar documento:", error);
                    showNotification("Error al firmar el documento", "error");
                } finally {
                    setIsSigning(false);
                    setSelectedDocToSign(null);
                }
            }
        });
    };

    const handleBulkSign = async () => {
        const workerEmployee = employees.find(e => e.id === currentUser?.uid);
        if (!workerEmployee?.signatureUrl) {
            setAlertDialog({
                title: "Firma no registrada",
                message: "No tienes una firma registrada. Por favor, ve a 'Mi Perfil' para registrar tu firma antes de continuar.",
                type: 'warning',
                onConfirm: () => {}
            });
            return;
        }

        const pendingDocs = filteredDocs.filter(d => d.status === 'pending');
        if (pendingDocs.length === 0) {
            showNotification("No tienes documentos pendientes de firma", "warning");
            return;
        }

        setAlertDialog({
            title: "Firma Masiva",
            message: `Firmarás ${pendingDocs.length} documentos utilizando tu firma registrada. ¿Deseas continuar?`,
            type: 'confirm',
            onConfirm: async () => {
                setIsBulkSigning(true);
                setBulkSignProgress({ current: 0, total: pendingDocs.length });

                try {
                    for (let i = 0; i < pendingDocs.length; i++) {
                        const docToSign = pendingDocs[i];
                        setBulkSignProgress({ current: i + 1, total: pendingDocs.length });
                        await performSign(docToSign, workerEmployee);
                    }
                    showNotification(`Se firmaron los ${pendingDocs.length} documentos correctamente.`, "success");
                } catch (error) {
                    console.error("Error en firma masiva:", error);
                    showNotification("Hubo un error al firmar algunos documentos", "error");
                } finally {
                    setIsBulkSigning(false);
                }
            }
        });
    };

    return (
        <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
            
            {/* HEADER */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 tracking-tight uppercase">Firma de Documentos</h1>
                    <p className="text-slate-500 text-sm font-medium">Contratos, EPP, ODI y Anexos con firma digital</p>
                </div>

                {currentUser?.role === 'admin' && (
                    <button
                        onClick={() => {
                            setWizardStep('docs');
                            setShowUploadModal(true);
                        }}
                        className="py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl shadow-blue-200 transition-all active:scale-95 flex items-center justify-center gap-2 self-start md:self-auto"
                    >
                        <Plus size={16} /> Asignación Masiva / Cargar
                    </button>
                )}
            </div>

            {/* MINI DASHBOARD DOCUMENTAL (Solo Administradores) */}
            {currentUser?.role === 'admin' && (
                <div className="space-y-6">
                    {/* Contadores / Métricas */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Documentos Activos</span>
                            <span className="text-3xl font-black text-slate-800 mt-2">{stats.total}</span>
                        </div>
                        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pendientes de Firma</span>
                            <div className="flex items-baseline gap-2 mt-2">
                                <span className="text-3xl font-black text-amber-500">{stats.pending}</span>
                                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
                            </div>
                        </div>
                        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Firmados</span>
                            <div className="flex items-baseline gap-2 mt-2">
                                <span className="text-3xl font-black text-emerald-500">{stats.signed}</span>
                                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                            </div>
                        </div>
                        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cumplimiento</span>
                            <span className="text-3xl font-black text-blue-600 mt-2">{stats.compliance}%</span>
                        </div>
                    </div>

                    {/* Banner de alerta si hay pendientes */}
                    {stats.pending > 0 && (
                        <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-center justify-between gap-4 animate-in fade-in duration-300">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-amber-100 text-amber-800 rounded-xl">
                                    <AlertTriangle size={20} />
                                </div>
                                <span className="text-sm font-bold text-amber-900">
                                    Hay {stats.pending} documentos pendientes de firma.
                                </span>
                            </div>
                            <button
                                onClick={() => {
                                    setActiveTab('pending');
                                }}
                                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-[11px] font-black uppercase tracking-wider transition-all"
                            >
                                Ver Pendientes
                            </button>
                        </div>
                    )}

                    {/* Columnas del Dashboard */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Top Documentos con más Incumplimiento */}
                        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-4">
                            <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                                <Clock size={16} className="text-red-500" />
                                Mayor Incumplimiento
                            </h3>
                            {topIncumplidos.length === 0 ? (
                                <p className="text-slate-400 text-xs font-bold py-4 text-center">¡Todos los documentos al día!</p>
                            ) : (
                                <div className="space-y-3">
                                    {topIncumplidos.map((doc, idx) => (
                                        <div key={idx} className="flex justify-between items-center bg-slate-50 p-3 rounded-2xl">
                                            <span className="text-xs font-bold text-slate-700 truncate max-w-xs">{doc.title}</span>
                                            <span className="text-xs font-black text-rose-500 bg-rose-50 px-2 py-0.5 rounded-lg">
                                                {doc.count} pendientes
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Cumplimiento por Sucursal */}
                        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm space-y-4">
                            <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                                <Building size={16} className="text-blue-500" />
                                Cumplimiento por Sucursal
                            </h3>
                            {siteCompliance.length === 0 ? (
                                <p className="text-slate-400 text-xs font-bold py-4 text-center">No hay sucursales registradas</p>
                            ) : (
                                <div className="grid grid-cols-2 gap-3 max-h-[140px] overflow-y-auto pr-1">
                                    {siteCompliance.map((site) => (
                                        <div key={site.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-2xl">
                                            <span className="text-[11px] font-bold text-slate-700 truncate max-w-[100px]">{site.name}</span>
                                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${
                                                site.rate >= 90 ? 'bg-emerald-50 text-emerald-600' :
                                                site.rate >= 70 ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'
                                            }`}>
                                                {site.rate}%
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* AVISO PENDIENTES DE TRABAJADOR */}
            {currentUser?.role !== 'admin' && activeTab === 'pending' && (
                <div className="bg-amber-50 border border-amber-200 p-5 rounded-3xl flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-top-4 duration-300">
                    <div>
                        <h2 className="text-base font-black text-amber-900 tracking-tight">Firma Digital</h2>
                        <p className="text-xs font-bold text-amber-700 mt-1">
                            {pendingDocsCount === 0 
                                ? 'No tienes documentos pendientes de firma.' 
                                : `Tienes ${pendingDocsCount} ${pendingDocsCount === 1 ? 'documento pendiente' : 'documentos pendientes'} de firma.`}
                        </p>
                    </div>
                    {pendingDocsCount > 1 && (
                        <button
                            onClick={handleBulkSign}
                            disabled={isSigning || isBulkSigning}
                            className="w-full sm:w-auto px-6 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg shadow-emerald-100 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            <PenTool size={14} /> Firmar Todos ({pendingDocsCount})
                        </button>
                    )}
                </div>
            )}

            {/* BARRA BUSQUEDA Y FILTROS */}
            <div className="bg-white p-3 rounded-3xl shadow-sm border border-slate-100 flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    {/* Pestañas de estado (Pendientes / Firmados / Todos) */}
                    <div className="flex p-1 bg-slate-100 rounded-2xl w-full sm:w-auto">
                        <button
                            onClick={() => setActiveTab('pending')}
                            className={`flex-1 sm:px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${activeTab === 'pending' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Pendientes
                        </button>
                        <button
                            onClick={() => setActiveTab('signed')}
                            className={`flex-1 sm:px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${activeTab === 'signed' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Firmados
                        </button>
                        <button
                            onClick={() => setActiveTab('all')}
                            className={`flex-1 sm:px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${activeTab === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Todos
                        </button>
                    </div>
                </div>

                <div className="relative w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por título, tipo o colaborador..."
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border-none rounded-2xl text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            {/* VISTA DE DOCUMENTOS */}
            {currentUser?.role !== 'admin' ? (
                /* VISTA FLAT DIRECTA PARA TRABAJADORES */
                <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden p-6 space-y-4">
                    {filteredDocs.length === 0 ? (
                        <div className="py-20 flex flex-col items-center justify-center">
                            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-slate-300">
                                <FileCheck size={32} />
                            </div>
                            <p className="text-slate-400 font-black text-lg">Sin documentos</p>
                            <p className="text-slate-400 text-sm">No tienes documentos en esta sección.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {filteredDocs.map((doc) => (
                                <div key={doc.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 first:pt-0 last:pb-0">
                                    <div className="flex items-center gap-4">
                                        <div className={`p-2.5 rounded-2xl ${doc.status === 'signed' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                                            <FileText size={20} />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="font-bold text-slate-700 text-sm truncate">{doc.title}</h3>
                                            <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 mt-1">
                                                <span className="bg-slate-100 px-2 py-0.5 rounded-lg uppercase tracking-wider">{doc.type}</span>
                                                <span>•</span>
                                                <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 sm:justify-end">
                                        {doc.status === 'pending' ? (
                                            <div className="flex gap-2 w-full sm:w-auto">
                                                <button
                                                    onClick={() => setViewingDoc(doc)}
                                                    className="flex-1 sm:flex-none px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-all flex items-center justify-center gap-1.5 text-[11px] font-black uppercase tracking-wider"
                                                >
                                                    <Eye size={14} /> Revisar
                                                </button>
                                                <button
                                                    onClick={() => handleSignIndividual(doc)}
                                                    disabled={isSigning}
                                                    className="flex-1 sm:flex-none px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[11px] font-black uppercase tracking-widest transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-1.5 disabled:opacity-50"
                                                >
                                                    {isSigning && selectedDocToSign?.id === doc.id ? (
                                                        <Loader2 size={12} className="animate-spin" />
                                                    ) : (
                                                        <PenTool size={12} />
                                                    )}
                                                    Firmar
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex gap-2 w-full sm:w-auto">
                                                <a
                                                    href={doc.signedUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex-1 sm:flex-none px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[11px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-100 flex items-center justify-center gap-1.5"
                                                >
                                                    <Download size={12} /> Descargar
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                /* VISTA AGRUPADA POR TRABAJADOR PARA ADMINISTRADOR */
                <div className="space-y-6">
                    {paginatedGroups.length === 0 ? (
                        <div className="py-20 flex flex-col items-center justify-center bg-white rounded-3xl border-2 border-dashed border-slate-200">
                            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-slate-300">
                                <FileText size={32} />
                            </div>
                            <p className="text-slate-400 font-black text-lg">No hay registros</p>
                            <p className="text-slate-400 text-sm">Prueba con otra búsqueda o sección</p>
                        </div>
                    ) : (
                        paginatedGroups.map(([employeeId, docs]) => {
                            const assignee = employees.find(e => e.id === employeeId);
                            const initials = assignee ? `${assignee.firstName[0]}${assignee.lastNamePaterno[0]}` : 'U';

                            const sortedDocs = [...docs].sort((a, b) => {
                                const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                                const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                                return dateB - dateA;
                            });

                            const docsPerPage = 3;
                            const empPage = employeeDocsPages[employeeId] || 1;
                            const totalEmpPages = Math.ceil(sortedDocs.length / docsPerPage);
                            const displayedDocs = sortedDocs.slice((empPage - 1) * docsPerPage, empPage * docsPerPage);

                            return (
                                <div key={employeeId} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                                    <div className="p-4 bg-slate-50/50 flex items-center justify-between border-b border-slate-100">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white font-black text-sm shadow-md shadow-blue-100">
                                                {initials}
                                            </div>
                                            <div>
                                                <h2 className="text-sm font-black text-slate-800 leading-tight">
                                                    {assignee ? `${assignee.firstName} ${assignee.lastNamePaterno}` : 'Usuario Desconocido'}
                                                </h2>
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{assignee?.rut || 'RUT N/R'}</p>
                                            </div>
                                        </div>
                                        <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-100/50 px-2 py-1 rounded-lg">
                                            {docs.length} {docs.length === 1 ? 'Doc' : 'Docs'}
                                        </span>
                                    </div>

                                    <div className="divide-y divide-slate-50">
                                        {displayedDocs.map((doc) => (
                                            <div key={doc.id} className="p-3 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 transition-colors">
                                                <div className="flex items-center gap-4">
                                                    <div className={`p-2 rounded-lg ${doc.status === 'signed' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                                                        <FileText size={18} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <h3 className="font-bold text-slate-700 text-sm truncate">{doc.title}</h3>
                                                        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 mt-1">
                                                            <span className="bg-slate-100 px-1.5 py-0.5 rounded uppercase tracking-tighter">{doc.type}</span>
                                                            <span>•</span>
                                                            <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2 sm:justify-end">
                                                    {doc.status === 'pending' ? (
                                                        <div className="flex gap-2 w-full sm:w-auto">
                                                            <a
                                                                href={doc.originalUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="flex-1 sm:flex-none p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-all"
                                                                title="Ver Original"
                                                            >
                                                                <Eye size={16} />
                                                            </a>
                                                            <button
                                                                onClick={() => {
                                                                    setAlertDialog({
                                                                        title: "Eliminar Registro",
                                                                        message: "¿Seguro que deseas eliminar este registro?",
                                                                        type: 'confirm',
                                                                        onConfirm: () => deleteDigitalDocument(doc.id)
                                                                    });
                                                                }}
                                                                className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-lg transition-all"
                                                                title="Eliminar Registro"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex gap-2 w-full sm:w-auto">
                                                            <a
                                                                href={doc.signedUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="flex-1 sm:flex-none px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-100 flex items-center justify-center gap-2"
                                                            >
                                                                <Download size={14} /> Descargar
                                                            </a>
                                                            <button
                                                                onClick={() => {
                                                                    setAlertDialog({
                                                                        title: "Eliminar Registro",
                                                                        message: "¿Seguro que deseas eliminar este registro?",
                                                                        type: 'confirm',
                                                                        onConfirm: () => deleteDigitalDocument(doc.id)
                                                                    });
                                                                }}
                                                                className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-lg transition-all"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {totalEmpPages > 1 && (
                                        <div className="p-3 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold text-slate-500">
                                            <span>
                                                Pág. {empPage} de {totalEmpPages}
                                            </span>
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={() => setEmployeeDocsPages(prev => ({
                                                        ...prev,
                                                        [employeeId]: Math.max(1, empPage - 1)
                                                    }))}
                                                    disabled={empPage === 1}
                                                    className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-slate-600 disabled:opacity-40 transition-all flex items-center justify-center"
                                                    title="Anterior"
                                                >
                                                    <ChevronLeft size={14} />
                                                </button>
                                                <button
                                                    onClick={() => setEmployeeDocsPages(prev => ({
                                                        ...prev,
                                                        [employeeId]: Math.min(totalEmpPages, empPage + 1)
                                                    }))}
                                                    disabled={empPage === totalEmpPages}
                                                    className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-slate-600 disabled:opacity-40 transition-all flex items-center justify-center"
                                                    title="Siguiente"
                                                >
                                                    <ChevronRight size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {/* PAGINACIÓN (ADMIN) */}
            {currentUser?.role === 'admin' && totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 mt-8 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm w-fit mx-auto">
                    <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="p-2 text-slate-400 hover:text-blue-600 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
                    >
                        <ChevronLeft size={24} />
                    </button>

                    <div className="flex items-center gap-2">
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                            <button
                                key={page}
                                onClick={() => setCurrentPage(page)}
                                className={`w-8 h-8 rounded-lg text-xs font-black transition-all ${currentPage === page ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'text-slate-400 hover:bg-slate-50'}`}
                            >
                                {page}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="p-2 text-slate-400 hover:text-blue-600 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
                    >
                        <ChevronRight size={24} />
                    </button>
                </div>
            )}

            {/* MODAL / ASISTENTE DE ASIGNACIÓN MASIVA (WIZARD) */}
            {showUploadModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-[2rem] w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col h-[90vh] md:h-auto max-h-[850px] animate-in zoom-in-95 duration-200">
                        {/* Header del Wizard */}
                        <div className="p-6 md:p-8 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-blue-50/30 to-transparent shrink-0">
                            <div>
                                <h2 className="text-xl font-black text-slate-900 uppercase">Asignador Documental Masivo</h2>
                                <p className="text-slate-400 text-xs font-black uppercase tracking-widest leading-none mt-1.5">
                                    {wizardStep === 'docs' ? 'Paso 1: Documentos' :
                                     wizardStep === 'destinatarios' ? 'Paso 2: Destinatarios' :
                                     wizardStep === 'confirmacion' ? 'Paso 3: Confirmación' : 'Paso 4: Resultado'}
                                </p>
                            </div>
                            <button onClick={resetWizard} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400">
                                <X size={24} />
                            </button>
                        </div>

                        {/* Contenido según el paso del Wizard (Scrollable) */}
                        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">

                            {/* PASO 1: SELECCIONAR DOCUMENTOS */}
                            {wizardStep === 'docs' && (
                                <div className="space-y-6 animate-in fade-in duration-200">
                                    {/* Selector de Modo */}
                                    <div className="flex p-1 bg-slate-100 rounded-2xl w-fit">
                                        <button
                                            type="button"
                                            onClick={() => setWizardMode('upload')}
                                            className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                                                wizardMode === 'upload' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'
                                            }`}
                                        >
                                            Subir Archivos Nuevos
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setWizardMode('templates')}
                                            className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                                                wizardMode === 'templates' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'
                                            }`}
                                        >
                                            Seleccionar Existentes
                                        </button>
                                    </div>

                                    {/* Modo: Cargar Nuevos Archivos */}
                                    {wizardMode === 'upload' ? (
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Título base (Para un solo archivo)</label>
                                                    <input
                                                        type="text"
                                                        placeholder="Ej: Reglamento Interno 2026"
                                                        className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-500/20 focus:bg-white rounded-2xl outline-none transition-all text-xs font-bold"
                                                        value={wizardDocTitle}
                                                        onChange={(e) => setWizardDocTitle(e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Tipo de Documento</label>
                                                    <select
                                                        className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-500/20 focus:bg-white rounded-2xl outline-none transition-all text-xs font-bold appearance-none cursor-pointer"
                                                        value={wizardDocType}
                                                        onChange={(e) => setWizardDocType(e.target.value)}
                                                    >
                                                        <option value="Contrato">Contrato</option>
                                                        <option value="EPP">EPP</option>
                                                        <option value="ODI">ODI</option>
                                                        <option value="Anexo">Anexo</option>
                                                        <option value="Otro">Otro</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Subir archivos PDF (Uno o varios)</label>
                                                <div className="relative group">
                                                    <input
                                                        type="file"
                                                        accept="application/pdf"
                                                        multiple
                                                        onChange={(e) => {
                                                            const files = Array.from(e.target.files || []);
                                                            setWizardFiles(prev => [...prev, ...files]);
                                                        }}
                                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                                    />
                                                    <div className="w-full px-4 py-8 border-2 border-dashed border-slate-200 group-hover:border-blue-400 rounded-3xl flex flex-col items-center justify-center gap-2 bg-slate-50 group-hover:bg-blue-50/30 transition-all">
                                                        <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center text-slate-400 group-hover:text-blue-500 transition-colors">
                                                            <Upload size={24} />
                                                        </div>
                                                        <p className="text-xs font-bold text-slate-500 text-center">
                                                            Haz clic o arrastra uno o más archivos PDF aquí
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Listado de archivos agregados para lote */}
                                            {wizardFiles.length > 0 && (
                                                <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Archivos en cola ({wizardFiles.length})</p>
                                                    {wizardFiles.map((file, idx) => (
                                                        <div key={idx} className="flex items-center justify-between p-2 bg-blue-50/40 rounded-xl border border-blue-100 text-xs font-bold text-slate-700">
                                                            <span className="truncate max-w-md">{file.name}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => setWizardFiles(prev => prev.filter((_, i) => i !== idx))}
                                                                className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        /* Modo: Seleccionar de Plantillas/Existentes */
                                        <div className="space-y-4">
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Selecciona uno o más documentos de la biblioteca ({uniqueTemplates.length})</p>
                                            {uniqueTemplates.length === 0 ? (
                                                <p className="text-slate-400 text-xs font-bold py-6 text-center">No hay documentos cargados previamente en el sistema.</p>
                                            ) : (
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-1">
                                                    {uniqueTemplates.map((tpl, idx) => {
                                                        const isSelected = selectedTemplates.some(t => t.originalUrl === tpl.originalUrl && t.title === tpl.title);
                                                        return (
                                                            <button
                                                                key={idx}
                                                                type="button"
                                                                onClick={() => {
                                                                    if (isSelected) {
                                                                        setSelectedTemplates(prev => prev.filter(t => t.originalUrl !== tpl.originalUrl || t.title !== tpl.title));
                                                                    } else {
                                                                        setSelectedTemplates(prev => [...prev, tpl]);
                                                                    }
                                                                }}
                                                                className={`p-4 border rounded-3xl text-left flex items-start gap-3 transition-all ${
                                                                    isSelected ? 'border-blue-500 bg-blue-50/30' : 'border-slate-100 hover:border-slate-300 bg-slate-50/50'
                                                                }`}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isSelected}
                                                                    readOnly
                                                                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 mt-1 pointer-events-none"
                                                                />
                                                                <div className="min-w-0">
                                                                    <p className="text-xs font-bold text-slate-800 truncate">{tpl.title}</p>
                                                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider mt-0.5 bg-slate-100 px-1.5 py-0.5 rounded w-fit">{tpl.type}</p>
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Configuración de Firma Compartida para el lote */}
                                    <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 space-y-4">
                                        <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                            <PenTool size={14} className="text-blue-600" />
                                            Configuración de Firma (Común para el lote)
                                        </h3>
                                        
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Página de Firma</label>
                                                <select
                                                    className="w-full px-4 py-3 bg-white border border-slate-200 focus:border-blue-500 rounded-xl outline-none transition-all text-xs font-bold appearance-none cursor-pointer"
                                                    value={sigPageType}
                                                    onChange={(e) => setSigPageType(e.target.value as any)}
                                                >
                                                    <option value="last">Última hoja</option>
                                                    <option value="specific">Página específica</option>
                                                </select>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Posición Horizontal</label>
                                                <select
                                                    className="w-full px-4 py-3 bg-white border border-slate-200 focus:border-blue-500 rounded-xl outline-none transition-all text-xs font-bold appearance-none cursor-pointer"
                                                    value={sigPosition}
                                                    onChange={(e) => setSigPosition(e.target.value as any)}
                                                >
                                                    <option value="left">Izquierda</option>
                                                    <option value="center">Centro</option>
                                                    <option value="right">Derecha</option>
                                                </select>
                                            </div>
                                        </div>

                                        {sigPageType === 'specific' && (
                                            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Número de Página</label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    required
                                                    className="w-full px-4 py-3 bg-white border border-slate-200 focus:border-blue-500 rounded-xl outline-none transition-all text-xs font-bold"
                                                    value={sigPageNumber}
                                                    onChange={(e) => setSigPageNumber(Math.max(1, parseInt(e.target.value) || 1))}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* PASO 2: DESTINATARIOS */}
                            {wizardStep === 'destinatarios' && (
                                <div className="space-y-6 animate-in fade-in duration-200">
                                    <div className="space-y-3">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Define el grupo de alcance de la asignación</p>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setAssigneeType('all')}
                                                className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                                                    assigneeType === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                }`}
                                            >
                                                <Users size={14} /> Todos los Colaboradores
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setAssigneeType('sucursal')}
                                                className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                                                    assigneeType === 'sucursal' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                }`}
                                            >
                                                <Building size={14} /> Por Sucursal (Instalación)
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setAssigneeType('colaboradores')}
                                                className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                                                    assigneeType === 'colaboradores' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                }`}
                                            >
                                                <Users size={14} /> Colaboradores Específicos
                                            </button>
                                        </div>
                                    </div>

                                    {/* Sub-Paneles según Destinatarios */}
                                    {assigneeType === 'all' && (
                                        <div className="p-6 bg-blue-50/50 border border-blue-100 rounded-3xl text-blue-900 flex gap-3 items-start">
                                            <Info size={20} className="shrink-0 text-blue-600 mt-0.5" />
                                            <div>
                                                <p className="text-xs font-bold">Asignación Universal</p>
                                                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                                                    El documento se asignará automáticamente a todos los guardias y colaboradores activos registrados en la plataforma.
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    {assigneeType === 'sucursal' && (
                                        <div className="space-y-3">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Selecciona una o más sucursales ({sites.length})</label>
                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                                {sites.map((site) => {
                                                    const isSelected = selectedSites.includes(site.id);
                                                    const workersInSite = employees.filter(e => e.isActive && e.currentSiteId === site.id).length;
                                                    return (
                                                        <button
                                                            key={site.id}
                                                            type="button"
                                                            onClick={() => {
                                                                if (isSelected) {
                                                                    setSelectedSites(prev => prev.filter(id => id !== site.id));
                                                                } else {
                                                                    setSelectedSites(prev => [...prev, site.id]);
                                                                }
                                                            }}
                                                            className={`p-4 border rounded-3xl text-left flex flex-col justify-between h-24 transition-all ${
                                                                isSelected ? 'border-blue-500 bg-blue-50/30' : 'border-slate-100 hover:border-slate-300 bg-slate-50/50'
                                                            }`}
                                                        >
                                                            <span className="text-xs font-black text-slate-700 truncate w-full">{site.name}</span>
                                                            <span className="text-[9px] font-bold text-slate-400 mt-2 bg-slate-100 px-2 py-0.5 rounded-lg w-fit">
                                                                {workersInSite} {workersInSite === 1 ? 'guardia' : 'guardias'}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {assigneeType === 'colaboradores' && (
                                        <div className="space-y-4">
                                            <div className="relative">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                                <input
                                                    type="text"
                                                    placeholder="Buscar colaborador por nombre o RUT..."
                                                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-none rounded-xl text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                                                    value={employeeSearchText}
                                                    onChange={(e) => setEmployeeSearchText(e.target.value)}
                                                />
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-56 overflow-y-auto pr-1">
                                                {wizardFilteredEmployees.map((emp) => {
                                                    const isSelected = selectedEmployees.includes(emp.id);
                                                    return (
                                                        <button
                                                            key={emp.id}
                                                            type="button"
                                                            onClick={() => {
                                                                if (isSelected) {
                                                                    setSelectedEmployees(prev => prev.filter(id => id !== emp.id));
                                                                } else {
                                                                    setSelectedEmployees(prev => [...prev, emp.id]);
                                                                }
                                                            }}
                                                            className={`p-3 border rounded-2xl text-left flex items-center gap-3 transition-all ${
                                                                isSelected ? 'border-blue-500 bg-blue-50/30' : 'border-slate-100 hover:border-slate-300 bg-slate-50/50'
                                                            }`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                readOnly
                                                                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 pointer-events-none"
                                                            />
                                                            <div className="min-w-0">
                                                                <p className="text-xs font-bold text-slate-800 truncate">{emp.firstName} {emp.lastNamePaterno}</p>
                                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-0.5">{emp.rut} • {emp.cargo || 'Guardia'}</p>
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Reglas de Conflictos / Duplicados */}
                                    <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 space-y-4">
                                        <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                            <Layers size={14} className="text-blue-600" />
                                            Reglas de Coincidencia de Asignación
                                        </h3>
                                        <div className="space-y-3">
                                            <p className="text-[10px] text-slate-400 font-bold leading-normal">
                                                * Si el colaborador ya tiene el documento en estado **Pendiente**, no se duplicará en ningún caso.
                                            </p>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Si el colaborador ya tiene el documento **Firmado**:</label>
                                                <select
                                                    className="w-full px-4 py-3 bg-white border border-slate-200 focus:border-blue-500 rounded-xl outline-none transition-all text-xs font-bold appearance-none cursor-pointer"
                                                    value={conflictBehavior}
                                                    onChange={(e) => setConflictBehavior(e.target.value as any)}
                                                >
                                                    <option value="omit">Omitir asignación (Mantener versión firmada actual)</option>
                                                    <option value="overwrite">Nueva Asignación (Exigir nueva firma de este lote)</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* PASO 3: CONFIRMACION */}
                            {wizardStep === 'confirmacion' && (
                                <div className="h-full flex flex-col justify-center items-center p-4 animate-in fade-in duration-200">
                                    <div className="w-full max-w-md flex flex-col items-center text-center space-y-6">
                                        <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shadow-inner shrink-0">
                                            <Info size={32} />
                                        </div>
                                        <div className="w-full space-y-4">
                                            <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Resumen de Asignación</h3>
                                            <div className="space-y-3 text-left bg-slate-50 p-6 rounded-3xl border border-slate-100 shadow-sm">
                                                <div className="flex justify-between items-center py-2 border-b border-slate-200/50">
                                                    <span className="text-xs font-bold text-slate-500">Documentos seleccionados:</span>
                                                    <span className="text-xs font-black text-slate-800">
                                                        {wizardMode === 'upload' ? wizardFiles.length : selectedTemplates.length}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between items-center py-2 border-b border-slate-200/50">
                                                    <span className="text-xs font-bold text-slate-500">Tipo de destinatarios:</span>
                                                    <span className="text-xs font-black text-slate-800 uppercase tracking-wide">
                                                        {assigneeType === 'all' ? 'Todos los colaboradores' :
                                                         assigneeType === 'sucursal' ? `${selectedSites.length} sucursales` :
                                                         `${selectedEmployees.length} colaboradores`}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between items-center py-2">
                                                    <span className="text-xs font-bold text-slate-500">Acción al existir firmas:</span>
                                                    <span className="text-xs font-black text-slate-800">
                                                        {conflictBehavior === 'omit' ? 'Omitir asignación' : 'Forzar nueva firma'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <p className="text-xs font-medium text-slate-400 max-w-sm">
                                            Al confirmar, el sistema resolverá de forma inteligente la lista de colaboradores y cargará los documentos correspondientes en segundo plano.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* PASO 4: RESULTADO */}
                            {wizardStep === 'resultado' && bulkResult && (
                                <div className="h-full flex flex-col justify-center items-center p-4 animate-in zoom-in-95 duration-300">
                                    <div className="w-full max-w-md flex flex-col items-center text-center space-y-6">
                                        <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shadow-inner shrink-0 animate-bounce">
                                            <CheckCircle size={32} />
                                        </div>
                                        <div className="w-full space-y-4">
                                            <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">¡Asignación Completada!</h3>
                                            <div className="space-y-3 text-left bg-slate-50 p-6 rounded-3xl border border-slate-100 shadow-sm">
                                                <div className="flex justify-between items-center py-2 border-b border-slate-200/50">
                                                    <span className="text-xs font-bold text-slate-500">Documentos procesados:</span>
                                                    <span className="text-xs font-black text-slate-800">{bulkResult.docsCount}</span>
                                                </div>
                                                <div className="flex justify-between items-center py-2 border-b border-slate-200/50">
                                                    <span className="text-xs font-bold text-slate-500">Trabajadores seleccionados:</span>
                                                    <span className="text-xs font-black text-slate-800">{bulkResult.workersCount}</span>
                                                </div>
                                                <div className="flex justify-between items-center py-2 border-b border-slate-200/50">
                                                    <span className="text-xs font-bold text-slate-500">Asignaciones creadas:</span>
                                                    <span className="text-xs font-black text-emerald-600">{bulkResult.generatedCount}</span>
                                                </div>
                                                <div className="flex justify-between items-center py-2">
                                                    <span className="text-xs font-bold text-slate-500">Omitidos por duplicados:</span>
                                                    <span className="text-xs font-black text-amber-500">{bulkResult.skippedCount}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Footer con controles de Wizard */}
                        <div className="p-6 border-t border-slate-100 bg-white flex justify-between shrink-0">
                            {wizardStep !== 'resultado' ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={resetWizard}
                                        className="px-6 py-3 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-2xl text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                                    >
                                        Cancelar
                                    </button>

                                    <div className="flex gap-2">
                                        {wizardStep === 'destinatarios' && (
                                            <button
                                                type="button"
                                                onClick={() => setWizardStep('docs')}
                                                className="px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                                            >
                                                Atrás
                                            </button>
                                        )}
                                        {wizardStep === 'confirmacion' && (
                                            <button
                                                type="button"
                                                onClick={() => setWizardStep('destinatarios')}
                                                className="px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                                            >
                                                Atrás
                                            </button>
                                        )}

                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (wizardStep === 'docs') {
                                                    // Validaciones Paso 1
                                                    if (wizardMode === 'upload' && wizardFiles.length === 0) {
                                                        showNotification("Sube al menos un archivo PDF", "warning");
                                                        return;
                                                    }
                                                    if (wizardMode === 'templates' && selectedTemplates.length === 0) {
                                                        showNotification("Selecciona al menos un documento", "warning");
                                                        return;
                                                    }
                                                    setWizardStep('destinatarios');
                                                } else if (wizardStep === 'destinatarios') {
                                                    // Validaciones Paso 2
                                                    if (assigneeType === 'sucursal' && selectedSites.length === 0) {
                                                        showNotification("Selecciona al menos una sucursal", "warning");
                                                        return;
                                                    }
                                                    if (assigneeType === 'colaboradores' && selectedEmployees.length === 0) {
                                                        showNotification("Selecciona al menos un colaborador", "warning");
                                                        return;
                                                    }
                                                    setWizardStep('confirmacion');
                                                } else if (wizardStep === 'confirmacion') {
                                                    handleExecuteBulkAssignment();
                                                }
                                            }}
                                            disabled={isLoading || isSigning}
                                            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl shadow-blue-200 active:scale-95 transition-all flex items-center gap-2"
                                        >
                                            {isSigning ? (
                                                <Loader2 size={16} className="animate-spin" />
                                            ) : (
                                                wizardStep === 'confirmacion' ? 'Confirmar Asignación' : 'Siguiente'
                                            )}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    onClick={resetWizard}
                                    className="w-full py-4 bg-slate-800 hover:bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-all text-center"
                                >
                                    Cerrar Asistente
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* VISOR DE DOCUMENTO (TRABAJADOR) */}
            {viewingDoc && (
                <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-[100] flex items-center justify-center p-0 md:p-4 animate-in fade-in duration-300">
                    <div className="bg-white rounded-none md:rounded-[2.5rem] w-full max-w-4xl h-full md:h-[90vh] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
                        {/* Header */}
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
                            <div>
                                <h2 className="text-base font-black text-slate-800 tracking-tight truncate max-w-md">{viewingDoc.title}</h2>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none mt-1">Revisión de Documento</p>
                            </div>
                            <button
                                onClick={() => { setViewingDoc(null); setNumPages(null); }}
                                className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400"
                            >
                                <X size={24} />
                            </button>
                        </div>

                        {/* PDF Viewer Scrollable */}
                        <div className="flex-1 overflow-y-auto bg-slate-100 p-4 flex justify-center">
                            <div className="w-full max-w-2xl">
                                <Document
                                    file={viewingDoc.originalUrl}
                                    onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                                    loading={
                                        <div className="flex flex-col items-center gap-4 mt-20">
                                            <Loader2 className="animate-spin text-blue-600" size={40} />
                                            <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Cargando PDF...</p>
                                        </div>
                                    }
                                >
                                    {Array.from(new Array(numPages), (_, index) => (
                                        <div key={`viewpage_${index}`} className="relative mb-6 shadow-lg rounded-lg overflow-hidden flex flex-col items-center bg-white">
                                            <Page
                                                pageNumber={index + 1}
                                                width={window.innerWidth < 768 ? window.innerWidth - 32 : 700}
                                                renderAnnotationLayer={false}
                                                renderTextLayer={false}
                                            />
                                        </div>
                                    ))}
                                </Document>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-6 border-t border-slate-100 bg-white flex flex-col sm:flex-row justify-end gap-3 shrink-0">
                            <button
                                onClick={() => { setViewingDoc(null); setNumPages(null); }}
                                className="px-6 py-3 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-2xl font-black text-xs uppercase tracking-widest active:scale-95 transition-all"
                            >
                                Cerrar
                            </button>
                            {viewingDoc.status === 'pending' && (
                                <button
                                    onClick={() => {
                                        setViewingDoc(null);
                                        setNumPages(null);
                                        handleSignIndividual(viewingDoc);
                                    }}
                                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-200 active:scale-95 transition-all flex items-center justify-center gap-2"
                                >
                                    <PenTool size={14} /> Firmar Documento
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* DIALOGO DE ALERTA/CONFIRMACION PERSONALIZADO */}
            {alertDialog && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
                    <div className="bg-white rounded-[2rem] p-6 max-w-sm w-full text-center space-y-6 shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-100">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto ${
                            alertDialog.type === 'confirm' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'
                        }`}>
                            {alertDialog.type === 'confirm' ? <PenTool size={28} /> : <Info size={28} />}
                        </div>
                        <div className="space-y-2">
                            <h3 className="text-lg font-black text-slate-800 tracking-tight">{alertDialog.title}</h3>
                            <p className="text-sm font-bold text-slate-500 leading-snug">{alertDialog.message}</p>
                        </div>
                        <div className="flex gap-3 justify-center">
                            {alertDialog.type === 'confirm' && (
                                <button
                                    onClick={() => {
                                        if (alertDialog.onCancel) alertDialog.onCancel();
                                        setAlertDialog(null);
                                    }}
                                    className="flex-1 px-4 py-3 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-2xl text-xs font-black uppercase tracking-widest transition-all"
                                >
                                    Cancelar
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    alertDialog.onConfirm();
                                    setAlertDialog(null);
                                }}
                                className={`px-6 py-3 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg transition-all flex-1 ${
                                    alertDialog.type === 'confirm' 
                                        ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-100' 
                                        : 'bg-amber-500 hover:bg-amber-600 shadow-amber-100'
                                }`}
                            >
                                Aceptar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* CARGA DE FIRMA MASIVA (TRABAJADOR) */}
            {isBulkSigning && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
                    <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full text-center space-y-6 shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto animate-pulse">
                            <Loader2 className="animate-spin text-blue-600" size={32} />
                        </div>
                        <div className="space-y-2">
                            <h3 className="text-lg font-black text-slate-800">Firmando Documentos</h3>
                            <p className="text-sm font-bold text-slate-500">Procesando {bulkSignProgress.current} de {bulkSignProgress.total}...</p>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                            <div 
                                className="bg-blue-600 h-full transition-all duration-300"
                                style={{ width: `${(bulkSignProgress.current / bulkSignProgress.total) * 100}%` }}
                            ></div>
                        </div>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Por favor, no cierres la aplicación</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DocumentsPage;
