import React, { useState, useRef, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../store/useAppStore';
import {
    FileText,
    Upload,
    CheckCircle,
    Clock,
    Eye,
    PenTool,
    Search,
    Trash2,
    X,
    Download,
    Loader2,
    Calendar,
    ShieldCheck,
    Info,
    MapPin,
    RotateCw,
    Smartphone,
    ChevronLeft,
    ChevronRight,
    FileCheck
} from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Document, Page, pdfjs } from 'react-pdf';
import axios from 'axios';
import { DigitalDocument } from '../types';

// Configurar worker de react-pdf (Usando el patrón recomendado para Vite)
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

const SIGNATURE_SIZE = 100;
const AUDIT_FONT_SIZE = 8;

const normalizeText = (text: string) => {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
};


const DocumentsPage: React.FC = () => {
    const {
        currentUser,
        employees,
        digitalDocuments,
        addDigitalDocument,
        signDigitalDocument,
        deleteDigitalDocument,
        uploadFile,
        isLoading,
        showNotification
    } = useAppStore();

    const [activeTab, setActiveTab] = useState<'pending' | 'signed'>(currentUser?.role === 'admin' ? 'pending' : 'pending');
    const [searchTerm, setSearchTerm] = useState('');
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [selectedDocToSign, setSelectedDocToSign] = useState<DigitalDocument | null>(null);
    const [isSigning, setIsSigning] = useState(false);
    const [assigneeSearch, setAssigneeSearch] = useState('');
    const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
    const [signingStep, setSigningStep] = useState<'instructions' | 'position' | 'canvas'>('instructions');
    const [isCanvasEmpty, setIsCanvasEmpty] = useState(true);
    const [showRotationOverlay, setShowRotationOverlay] = useState(false);

    // Paginación
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 8; // Trabajadores por página

    // Resetear página al buscar o cambiar tab
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, activeTab]);

    // Estado para posicionamiento de firma
    const [numPages, setNumPages] = useState<number | null>(null);
    const [signaturePosition, setSignaturePosition] = useState<{
        pageIndex: number,
        x: number, // Píxeles en pantalla
        y: number, // Píxeles en pantalla
        screenWidth: number,
        screenHeight: number
    } | null>(null);


    // Filtros
    const filteredDocs = useMemo(() => {
        let docs = digitalDocuments;

        // Si no es admin, solo ve los asignados a él
        if (currentUser?.role !== 'admin') {
            docs = docs.filter(d => d.assignedTo === currentUser?.uid);
        }

        // Filtro por Tab
        docs = docs.filter(d => d.status === (activeTab === 'pending' ? 'pending' : 'signed'));

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

    // Agrupación y Paginación
    const groupedDocs = useMemo(() => {
        const groups: Record<string, DigitalDocument[]> = {};
        
        filteredDocs.forEach(doc => {
            const key = doc.assignedTo;
            if (!groups[key]) groups[key] = [];
            groups[key].push(doc);
        });

        // Ordenar trabajadores por nombre
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

    const { paginatedGroups, totalPages, totalCount } = groupedDocs;

    // FORMULARIO DE CARGA (ADMIN)
    const [uploadForm, setUploadForm] = useState({
        title: '',
        type: 'Contrato',
        assignedTo: '',
        file: null as File | null
    });

    const filteredAssignees = useMemo(() => {
        const term = normalizeText(assigneeSearch);
        return employees.filter(e => {
            if (!e.isActive) return false;
            const fullName = normalizeText(`${e.firstName} ${e.lastNamePaterno} ${e.lastNameMaterno || ''}`);
            const rut = normalizeText(e.rut || '');
            return fullName.includes(term) || rut.includes(term);
        });
    }, [employees, assigneeSearch]);


    const handleUploadSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!uploadForm.file || !uploadForm.assignedTo || !uploadForm.title) {
            showNotification("Por favor completa todos los campos", "warning");
            return;
        }

        try {
            // Subir archivo original
            const fileName = `${Date.now()}_${uploadForm.file.name}`;
            const originalUrl = await uploadFile(uploadForm.file, `original_docs/${fileName}`);

            await addDigitalDocument({
                title: uploadForm.title,
                type: uploadForm.type,
                assignedTo: uploadForm.assignedTo,
                originalUrl
            });

            showNotification("Documento cargado y asignado correctamente", "success");
            setShowUploadModal(false);
            setUploadForm({ title: '', type: 'Contrato', assignedTo: '', file: null });
            setAssigneeSearch('');
            setShowAssigneeDropdown(false);

        } catch (error) {
            console.error(error);
            showNotification("Error al cargar el documento", "error");
        }
    };

    // LOGICA DE FIRMA
    const sigPad = useRef<SignatureCanvas>(null);

    // Bloqueo de orientación landscape al entrar al canvas de firma
    useEffect(() => {
        if (selectedDocToSign && signingStep === 'canvas') {
            const isPortrait = window.innerHeight > window.innerWidth;
            if (isPortrait) {
                setShowRotationOverlay(true);
            }

            // Intentar bloquear orientación landscape (Screen Orientation API)
            const lockLandscape = async () => {
                try {
                    if (screen.orientation && typeof (screen.orientation as any).lock === 'function') {
                        await (screen.orientation as any).lock('landscape');
                    }
                } catch (_) { /* No disponible en todos los navegadores */ }
            };
            lockLandscape();

            const handleOrientationChange = () => {
                const nowLandscape = window.innerWidth > window.innerHeight;
                if (nowLandscape) setShowRotationOverlay(false);
            };
            window.addEventListener('resize', handleOrientationChange);

            return () => {
                window.removeEventListener('resize', handleOrientationChange);
                // Restaurar a portrait al salir
                try {
                    if (screen.orientation && typeof (screen.orientation as any).unlock === 'function') {
                        (screen.orientation as any).unlock();
                    }
                } catch (_) { }
            };
        } else {
            setShowRotationOverlay(false);
        }
    }, [selectedDocToSign, signingStep]);

    // Sincronizar resolución del canvas con su tamaño visual real (fix coordenadas en móvil)
    useEffect(() => {
        let resizeObserver: ResizeObserver | null = null;

        const syncCanvasSize = () => {
            if (selectedDocToSign && signingStep === 'canvas' && sigPad.current) {
                const canvas = sigPad.current.getCanvas();
                if (canvas && canvas.parentElement) {
                    const rect = canvas.parentElement.getBoundingClientRect();
                    const w = Math.floor(rect.width);
                    const h = Math.floor(rect.height);
                    if (canvas.width !== w || canvas.height !== h) {
                        canvas.width = w;
                        canvas.height = h;
                        sigPad.current.clear();
                        setIsCanvasEmpty(true);
                    }
                }
            }
        };

        if (selectedDocToSign && signingStep === 'canvas') {
            // Doble RAF para asegurar que el layout está completo antes de medir
            const timer = setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(syncCanvasSize)), 50);
            const parent = sigPad.current?.getCanvas()?.parentElement;
            if (parent) {
                resizeObserver = new ResizeObserver(() => requestAnimationFrame(syncCanvasSize));
                resizeObserver.observe(parent);
            }
            window.addEventListener('resize', syncCanvasSize);
            window.addEventListener('orientationchange', syncCanvasSize);
            return () => {
                clearTimeout(timer);
                window.removeEventListener('resize', syncCanvasSize);
                window.removeEventListener('orientationchange', syncCanvasSize);
                if (resizeObserver) resizeObserver.disconnect();
            };
        }
    }, [selectedDocToSign, signingStep]);

    // Bloquear scroll del body al firmar — evita el bounce de iOS al tocar bordes
    useEffect(() => {
        if (signingStep === 'canvas' && selectedDocToSign) {
            const htmlElement = document.documentElement;
            const originalHtmlOverflow = htmlElement.style.overflow;
            const originalBodyOverflow = document.body.style.overflow;

            htmlElement.style.overflow = 'hidden';
            document.body.style.overflow = 'hidden';

            return () => {
                htmlElement.style.overflow = originalHtmlOverflow;
                document.body.style.overflow = originalBodyOverflow;
            };
        }
    }, [signingStep, selectedDocToSign]);

    const handlePageClick = (pageIndex: number, e: React.MouseEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setSignaturePosition({
            pageIndex,
            x,
            y,
            screenWidth: rect.width,
            screenHeight: rect.height
        });
    };

    const handleSignDocument = async () => {
        if (!selectedDocToSign || !sigPad.current || sigPad.current.isEmpty() || !signaturePosition) {
            showNotification("Por favor firma y selecciona la ubicación en el documento", "warning");
            return;
        }

        setIsSigning(true);
        try {
            // 1. Obtener IP pública
            let ip = 'Unknown';
            try {
                const ipRes = await axios.get('https://api.ipify.org?format=json');
                ip = ipRes.data.ip;
            } catch (e) { console.error("Could not get IP", e); }

            // 2. Obtener datos de la firma
            const signatureDataUrl = sigPad.current.getCanvas().toDataURL('image/png');


            // 3. Obtener el RUT del usuario actual si es un empleado
            const userEmployee = employees.find(e => e.id === currentUser?.uid);
            const rut = userEmployee?.rut || 'N/A';
            const userName = userEmployee ? `${userEmployee.firstName} ${userEmployee.lastNamePaterno}` : currentUser?.email || 'Usuario';

            // 4. Manipular PDF con pdf-lib
            const existingPdfBytes = await fetch(selectedDocToSign.originalUrl).then(res => res.arrayBuffer());
            const pdfDoc = await PDFDocument.load(existingPdfBytes);
            const pages = pdfDoc.getPages();

            // Obtener página seleccionada
            const selectedPage = pages[signaturePosition.pageIndex];
            const { width: pdfWidth, height: pdfHeight } = selectedPage.getSize();

            // Normalización de Coordenadas (Screen Pixels -> PDF Points 72 DPI)
            const pdfX = (signaturePosition.x / signaturePosition.screenWidth) * pdfWidth;
            // Inversión de eje Y: PDF (0,0) es abajo-izquierda
            const pdfY = pdfHeight - ((signaturePosition.y / signaturePosition.screenHeight) * pdfHeight);

            // Incrustar firma
            const signatureImage = await pdfDoc.embedPng(signatureDataUrl);
            const sigDims = signatureImage.scale(SIGNATURE_SIZE / signatureImage.width);

            // Centrar la firma ligeramente sobre el punto de toque
            selectedPage.drawImage(signatureImage, {
                x: pdfX - (sigDims.width / 2),
                y: pdfY - (sigDims.height / 2),
                width: sigDims.width,
                height: sigDims.height,
            });

            // Incrustar texto de auditoría al pie de la página
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
            const timestamp = new Date().toLocaleString();
            const auditText = `Documento firmado electrónicamente por ${userName} (${rut}) - IP: ${ip} - Fecha: ${timestamp}`;

            selectedPage.drawText(auditText, {
                x: 50, // Alineado a la izquierda con un margen de 50pt
                y: 20, // Al pie de la hoja (20pt desde el borde inferior)
                size: AUDIT_FONT_SIZE,
                font,
                color: rgb(0.4, 0.4, 0.4),
            });

            const pdfBytes = await pdfDoc.save();

            // 5. Subir PDF firmado
            const signedFileName = `signed_${selectedDocToSign.id}.pdf`;
            const signedBlob = new Blob([pdfBytes as any], { type: 'application/pdf' });
            const signedUrl = await uploadFile(signedBlob, `signed_docs/${signedFileName}`);

            // 6. Actualizar Firestore
            await signDigitalDocument(selectedDocToSign.id, signedUrl, {
                ip,
                rut,
                browserInfo: navigator.userAgent
            });

            showNotification("Documento firmado exitosamente", "success");
            setSelectedDocToSign(null);
        } catch (error) {
            console.error(error);
            showNotification("Error al procesar la firma", "error");
        } finally {
            setIsSigning(false);
        }
    };

    return (
        <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
            {/* HEADER */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <ShieldCheck className="text-blue-600" />
                        Gestión de Documentos
                    </h1>
                    <p className="text-slate-500">Contratos, EPP, ODI y Anexos con firma digital</p>
                </div>

                {currentUser?.role === 'admin' && (
                    <button
                        onClick={() => setShowUploadModal(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-200 transition-all active:scale-95"
                    >
                        <Upload size={18} />
                        Cargar Nuevo
                    </button>
                )}
            </div>

            {/* TABS & SEARCH */}
            <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-100 flex flex-col sm:flex-row items-center gap-4">
                <div className="flex p-1 bg-slate-100 rounded-xl w-full sm:w-auto">
                    <button
                        onClick={() => setActiveTab('pending')}
                        className={`flex-1 sm:px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'pending' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Pendientes
                    </button>
                    <button
                        onClick={() => setActiveTab('signed')}
                        className={`flex-1 sm:px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'signed' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Firmados
                    </button>
                </div>

                <div className="relative flex-1 w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por título o tipo..."
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            {/* LISTA DE DOCUMENTOS AGRUPADOS (LISTADO COMPLETO) */}
            <div className="space-y-6">
                {paginatedGroups.length === 0 ? (
                    <div className="py-20 flex flex-col items-center justify-center bg-white rounded-3xl border-2 border-dashed border-slate-200">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-slate-300">
                            <FileText size={32} />
                        </div>
                        <p className="text-slate-400 font-medium text-lg">No hay registros</p>
                        <p className="text-slate-400 text-sm">Prueba con otra búsqueda o sección</p>
                    </div>
                ) : (
                    paginatedGroups.map(([employeeId, docs]) => {
                        const assignee = employees.find(e => e.id === employeeId);
                        const initials = assignee ? `${assignee.firstName[0]}${assignee.lastNamePaterno[0]}` : 'U';

                        return (
                            <div key={employeeId} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                                {/* Header del Grupo (Trabajador) - Más compacto */}
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

                                {/* Listado de Documentos (Filas Simples) */}
                                <div className="divide-y divide-slate-50">
                                    {docs.map((doc) => (
                                        <div key={doc.id} className="p-3 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50 transition-colors">
                                            <div className="flex items-center gap-4">
                                                <div className={`p-2 rounded-lg ${doc.status === 'signed' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                                                    <FileText size={18} />
                                                </div>
                                                <div className="min-w-0">
                                                    <h3 className="font-bold text-slate-700 text-sm truncate">{doc.title}</h3>
                                                    <div className="flex items-center gap-2 text-[10px] font-medium text-slate-400">
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
                                                                setSelectedDocToSign(doc);
                                                                setSigningStep('instructions');
                                                                setSignaturePosition(null);
                                                            }}
                                                            className="flex-1 sm:flex-none px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-black uppercase tracking-widest transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2"
                                                        >
                                                            <PenTool size={14} /> Firmar
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
                                                        {currentUser?.role === 'admin' && (
                                                            <button
                                                                onClick={() => {
                                                                    if (window.confirm("¿Seguro que deseas eliminar este registro?")) deleteDigitalDocument(doc.id);
                                                                }}
                                                                className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-lg transition-all"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* PAGINACIÓN */}
            {totalPages > 1 && (
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

            {/* MODAL DE CARGA (ADMIN) */}
            {showUploadModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-[2rem] w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-blue-50/50 to-transparent">
                            <div>
                                <h2 className="text-xl font-black text-slate-900">Cargar Documento</h2>
                                <p className="text-slate-500 text-sm font-medium">Sube un PDF y asígnalo a un colaborador</p>
                            </div>
                            <button onClick={() => {
                                setShowUploadModal(false);
                                setAssigneeSearch('');
                                setShowAssigneeDropdown(false);
                            }} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                                <X size={24} />
                            </button>

                        </div>

                        <form onSubmit={handleUploadSubmit} className="p-8 space-y-5">
                            <div className="space-y-2">
                                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Título del Documento</label>
                                <input
                                    type="text"
                                    required
                                    placeholder="Ej: Contrato de Trabajo - Juan Pérez"
                                    className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-500/20 focus:bg-white rounded-2xl outline-none transition-all text-sm font-bold"
                                    value={uploadForm.title}
                                    onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Tipo</label>
                                    <select
                                        className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-500/20 focus:bg-white rounded-2xl outline-none transition-all text-sm font-bold appearance-none cursor-pointer"
                                        value={uploadForm.type}
                                        onChange={(e) => setUploadForm({ ...uploadForm, type: e.target.value })}
                                    >
                                        <option value="Contrato">Contrato</option>
                                        <option value="EPP">EPP</option>
                                        <option value="ODI">ODI</option>
                                        <option value="Anexo">Anexo</option>
                                        <option value="Otro">Otro</option>
                                    </select>
                                </div>
                                <div className="space-y-2 relative">
                                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Asignar a</label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            placeholder="Buscar por Nombre o RUT..."
                                            className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent focus:border-blue-500/20 focus:bg-white rounded-2xl outline-none transition-all text-sm font-bold"
                                            value={assigneeSearch}
                                            onChange={(e) => {
                                                setAssigneeSearch(e.target.value);
                                                setShowAssigneeDropdown(true);
                                                if (uploadForm.assignedTo) setUploadForm({ ...uploadForm, assignedTo: '' });
                                            }}
                                            onFocus={() => setShowAssigneeDropdown(true)}
                                            required={!uploadForm.assignedTo}
                                        />
                                        {uploadForm.assignedTo && (
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500">
                                                <CheckCircle size={18} />
                                            </div>
                                        )}
                                    </div>

                                    {showAssigneeDropdown && (
                                        <div className="absolute z-[60] left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-100 max-h-48 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
                                            {filteredAssignees.length === 0 ? (
                                                <div className="p-4 text-center text-slate-400 text-xs font-bold">No se encontraron colaboradores</div>
                                            ) : (
                                                filteredAssignees.map(e => (
                                                    <button
                                                        key={e.id}
                                                        type="button"
                                                        className="w-full px-4 py-3 text-left hover:bg-blue-50 transition-colors border-b border-slate-50 last:border-none flex flex-col"
                                                        onClick={() => {
                                                            setUploadForm({ ...uploadForm, assignedTo: e.id });
                                                            setAssigneeSearch(`${e.firstName} ${e.lastNamePaterno}`);
                                                            setShowAssigneeDropdown(false);
                                                        }}
                                                    >
                                                        <span className="text-sm font-bold text-slate-800">{e.firstName} {e.lastNamePaterno}</span>
                                                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{e.rut} • {e.cargo}</span>
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Archivo PDF</label>
                                <div className="relative group">
                                    <input
                                        type="file"
                                        accept="application/pdf"
                                        required
                                        onChange={(e) => setUploadForm({ ...uploadForm, file: e.target.files?.[0] || null })}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                    />
                                    <div className="w-full px-4 py-8 border-2 border-dashed border-slate-200 group-hover:border-blue-400 rounded-3xl flex flex-col items-center justify-center gap-2 bg-slate-50 group-hover:bg-blue-50/30 transition-all">
                                        <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center text-slate-400 group-hover:text-blue-500 transition-colors">
                                            <Upload size={24} />
                                        </div>
                                        <p className="text-xs font-bold text-slate-500">
                                            {uploadForm.file ? uploadForm.file.name : 'Haz clic o arrastra el archivo aquí'}
                                        </p>
                                        <p className="text-[10px] text-slate-400 uppercase tracking-widest font-black">Máximo 10MB</p>
                                    </div>
                                </div>
                                {/* Ayuda iPhone */}
                                {/iPhone|iPad|iPod/i.test(navigator.userAgent) && (
                                    <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-2xl flex gap-2 items-center">
                                        <Info size={14} className="text-blue-500 shrink-0" />
                                        <p className="text-[9px] font-bold text-blue-700 leading-tight italic">
                                            iPhone: Para recibir notificaciones, usa "Añadir a pantalla de inicio" desde Compartir.
                                        </p>
                                    </div>
                                )}
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-blue-200 transition-all active:scale-95 flex items-center justify-center gap-2"
                            >
                                {isLoading ? <Loader2 size={20} className="animate-spin" /> : <><Upload size={20} /> Subir y Asignar</>}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL DE FIRMA (FLUJO REFORMULADO) */}
            {selectedDocToSign && (
                <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-[100] flex items-center justify-center p-0 md:p-4">
                    <div className="bg-white rounded-none md:rounded-[2.5rem] w-full max-w-5xl h-full md:h-[90vh] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-300 flex flex-col">

                        {/* HEADER DEL MODAL (Oculto en paso canvas para maximizar espacio) */}
                        {signingStep !== 'canvas' && (
                            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                                        <PenTool size={20} />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-black text-slate-900 leading-tight">Proceso de Firma</h2>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none mt-1">
                                            {signingStep === 'instructions' ? '1. Instrucciones' :
                                                signingStep === 'position' ? '2. Ubicación de Firma' : '3. Dibujar Firma'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => {
                                        setSelectedDocToSign(null);
                                        setSigningStep('instructions');
                                        setSignaturePosition(null);
                                    }}
                                    disabled={isSigning}
                                    className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400"
                                >
                                    <X size={24} />
                                </button>
                            </div>
                        )}

                        {/* CONTENIDO SEGÚN EL PASO */}
                        <div className="flex-1 overflow-hidden relative">

                            {/* PASO 1: INSTRUCCIONES */}
                            {signingStep === 'instructions' && (
                                <div className="h-full flex flex-col p-4 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
                                    <div className="flex flex-col items-center justify-center h-full space-y-5">
                                        <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-[1.5rem] flex items-center justify-center shadow-inner">
                                            <Info size={32} />
                                        </div>
                                        <div className="max-w-md space-y-4 w-full">
                                            <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Instrucciones de Firma</h3>
                                            <div className="space-y-3 text-left bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
                                                <div className="flex gap-4 items-start">
                                                    <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">1</div>
                                                    <p className="text-sm font-bold text-slate-600 leading-snug">Toca sobre el documento para ubicar tu firma.</p>
                                                </div>
                                                <div className="flex gap-4 items-start">
                                                    <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">2</div>
                                                    <p className="text-sm font-bold text-slate-600 leading-snug">Gira el celular de forma horizontal si te lo pide.</p>
                                                </div>
                                                <div className="flex gap-4 items-start">
                                                    <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">3</div>
                                                    <p className="text-sm font-bold text-slate-600 leading-snug">Dibuja tu firma y presiona en Confirmar.</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setSigningStep('position')}
                                        className="w-full mt-4 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-blue-200 active:scale-95 transition-all text-sm shrink-0"
                                    >
                                        Entendido, Comenzar
                                    </button>
                                </div>
                            )}

                            {/* PASO 2: SELECCIÓN DE POSICIÓN */}
                            {signingStep === 'position' && (
                                <div className="h-full flex flex-col animate-in fade-in slide-in-from-right-4 duration-500 relative">
                                    <div className="bg-amber-50 p-4 border-b border-amber-100 flex flex-col items-center gap-2 shrink-0 z-10">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center text-white shrink-0">
                                                <MapPin size={18} />
                                            </div>
                                            <p className="text-xs font-bold text-amber-800">Toca el lugar exacto en el documento para firmar.</p>
                                        </div>
                                    </div>

                                    <div className="flex-1 overflow-y-auto bg-slate-100 p-2 md:p-4 pb-24 flex justify-center">
                                        <div className="w-full max-w-3xl">
                                            <Document
                                                file={selectedDocToSign.originalUrl}
                                                onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                                                loading={<div className="flex flex-col items-center gap-4 mt-20"><Loader2 className="animate-spin text-blue-600" size={40} /><p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Cargando PDF...</p></div>}
                                            >
                                                {Array.from(new Array(numPages), (_, index) => (
                                                    <div key={`page_${index}`} className="relative mb-6 shadow-2xl cursor-crosshair transition-all hover:ring-4 ring-blue-500/10 rounded-lg overflow-hidden flex flex-col items-center bg-white" onClick={(e) => handlePageClick(index, e)}>
                                                        <Page
                                                            pageNumber={index + 1}
                                                            width={window.innerWidth < 768 ? window.innerWidth - 20 : 800}
                                                            renderAnnotationLayer={false}
                                                            renderTextLayer={false}
                                                        />
                                                    {signaturePosition?.pageIndex === index && (
                                                        <div
                                                            className="absolute border-2 border-blue-600 bg-blue-100/60 rounded-xl pointer-events-none flex flex-col items-center justify-center shadow-2xl animate-in zoom-in duration-200 backdrop-blur-[2px]"
                                                            style={{
                                                                left: signaturePosition.x - 60,
                                                                top: signaturePosition.y - 35,
                                                                width: '120px',
                                                                height: '70px',
                                                                zIndex: 10
                                                            }}
                                                        >
                                                            <PenTool size={18} className="text-blue-700 mb-1" />
                                                            <span className="text-[10px] font-black text-blue-800 uppercase text-center leading-tight">Tu firma irá<br />Aquí</span>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </Document>
                                        </div>
                                    </div>

                                    {/* Botón Flotante para Continuar */}
                                    <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-white via-white/80 to-transparent pointer-events-none z-20 flex justify-center">
                                        <button
                                            onClick={() => setSigningStep('canvas')}
                                            disabled={!signaturePosition}
                                            className="w-full max-w-md py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:shadow-none text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-blue-200 active:scale-95 transition-all flex items-center justify-center gap-2 pointer-events-auto"
                                        >
                                            {signaturePosition ? 'Continuar' : 'Primero toca el documento'}
                                            {signaturePosition && <ChevronRight size={20} />}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Canvas: renderizado fuera del modal (ver bloque debajo del modal) */}

                        </div>
                    </div>
                </div>
            )}

            {/* ================================================================
                PASO 3: LIENZO DE FIRMA (PORTAL)
                Renderizamos directamente en el <body> para que nada bloquee
                el z-index ni empuje la pantalla (safe-area/transform bugs).
                ================================================================ */}
            {selectedDocToSign && signingStep === 'canvas' && createPortal(
                <div
                    className="fixed inset-0 bg-white z-[9999] flex flex-col"
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        width: '100%',
                        height: '100%',
                        overflow: 'hidden',
                        overscrollBehavior: 'none'
                    }}
                    onTouchMove={(e) => e.preventDefault()}
                >
                    {/* ═══ BARRA SUPERIOR ═══ */}
                    <div
                        className="bg-white border-b border-slate-100 shrink-0 flex items-center justify-between"
                        style={{
                            paddingTop: 'calc(8px + env(safe-area-inset-top, 0px))',
                            paddingBottom: '8px',
                            paddingLeft: 'calc(12px + env(safe-area-inset-left, 0px))',
                            paddingRight: 'calc(12px + env(safe-area-inset-right, 0px))',
                        }}
                    >
                        <button
                            onClick={() => { setSigningStep('position'); setIsCanvasEmpty(true); }}
                            className="w-12 h-12 bg-slate-100 text-slate-500 hover:text-slate-700 rounded-full flex items-center justify-center active:scale-90 transition-all shrink-0 shadow-sm"
                            style={{ touchAction: 'manipulation' }}
                            aria-label="Volver"
                        >
                            <X size={26} />
                        </button>
                        <span className="flex-1 text-xs md:text-sm font-black text-slate-400 uppercase tracking-widest text-center px-2 truncate">
                            Dibuja tu firma
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={() => { sigPad.current?.clear(); setIsCanvasEmpty(true); }}
                                style={{ touchAction: 'manipulation' }}
                                className="h-12 px-4 md:px-6 flex items-center justify-center gap-2 bg-white border-2 border-blue-500 text-blue-600 font-black text-sm uppercase tracking-wider active:scale-95 transition-all rounded-xl hover:bg-blue-50"
                            >
                                <span className="text-lg">🗑</span><span className="hidden sm:inline">Limpiar</span>
                            </button>
                            <button
                                onClick={handleSignDocument}
                                disabled={isSigning || isCanvasEmpty}
                                style={{
                                    touchAction: 'manipulation',
                                    boxShadow: isCanvasEmpty ? 'none' : '0 4px 14px rgba(37,99,235,0.40)'
                                }}
                                className="h-12 px-5 md:px-8 flex items-center justify-center gap-2 bg-blue-600 disabled:bg-slate-300 disabled:opacity-60 text-white font-black text-sm uppercase tracking-wider active:scale-95 transition-all rounded-xl"
                            >
                                {isSigning ? <Loader2 size={24} className="animate-spin" /> : <><CheckCircle size={22} /><span className="hidden sm:inline">Confirmar</span></>}
                            </button>
                        </div>
                    </div>

                    {/* ═══ LIENZO ═══ */}
                    <div
                        className="relative bg-white overflow-hidden"
                        style={{
                            flex: '1 1 0', minHeight: 0,
                            margin: '8px calc(12px + env(safe-area-inset-left, 0px)) calc(12px + env(safe-area-inset-bottom, 0px)) calc(12px + env(safe-area-inset-left, 0px))',
                            borderRadius: '16px',
                            border: '2px solid #e2e8f0',
                            touchAction: 'none'
                        }}
                    >
                        <SignatureCanvas
                            ref={sigPad}
                            penColor="#111827"
                            minWidth={1.5}
                            maxWidth={4}
                            velocityFilterWeight={0.7}
                            canvasProps={{
                                style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', touchAction: 'none', cursor: 'crosshair' }
                            }}
                            onBegin={() => setIsCanvasEmpty(false)}
                        />
                        {isCanvasEmpty && (
                            <>
                                <div className="absolute left-8 right-8 border-b-2 border-dashed border-slate-300 pointer-events-none" style={{ top: '60%' }} />
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
                                    <span className="text-sm md:text-base font-black uppercase tracking-[0.5rem] text-slate-300 bg-white px-4 py-2 rounded-full shadow-sm">Realiza tu firma aquí</span>
                                </div>
                            </>
                        )}
                    </div>

                    {/* ═══ OVERLAY ROTACIÓN ═══ */}
                    {showRotationOverlay && (
                        <div
                            className="absolute inset-0 z-[99999] bg-slate-900/95 flex flex-col items-center justify-center gap-6 text-white"
                            style={{ touchAction: 'none' }}
                            onTouchMove={(e) => e.preventDefault()}
                        >
                            <div className="animate-spin" style={{ animationDuration: '2s' }}>
                                <RotateCw size={80} className="text-blue-400" />
                            </div>
                            <div className="text-center space-y-3 px-4">
                                <p className="text-3xl font-black uppercase tracking-widest leading-none">Gira tu<br />dispositivo</p>
                                <p className="text-lg text-slate-400 font-medium max-w-sm mx-auto">Para firmar necesitas modo horizontal</p>
                            </div>
                        </div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
};

export default DocumentsPage;
