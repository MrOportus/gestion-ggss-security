import React, { useState, useRef, useMemo, useEffect } from 'react';
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
    ChevronLeft,
    ChevronRight,
    FileCheck,
    Info
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
        digitalDocuments,
        addDigitalDocument,
        signDigitalDocument,
        deleteDigitalDocument,
        uploadFile,
        isLoading,
        showNotification
    } = useAppStore();

    const [activeTab, setActiveTab] = useState<'pending' | 'signed'>('pending');
    const [searchTerm, setSearchTerm] = useState('');
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [selectedDocToSign, setSelectedDocToSign] = useState<DigitalDocument | null>(null);
    const [isSigning, setIsSigning] = useState(false);
    const [assigneeSearch, setAssigneeSearch] = useState('');
    const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);

    // Visualizador de PDF
    const [viewingDoc, setViewingDoc] = useState<DigitalDocument | null>(null);
    const [numPages, setNumPages] = useState<number | null>(null);

    // Firma masiva
    const [isBulkSigning, setIsBulkSigning] = useState(false);
    const [bulkSignProgress, setBulkSignProgress] = useState({ current: 0, total: 0 });

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

    // Resetear página al buscar o cambiar tab
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, activeTab]);

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

    // Cantidad de pendientes para la vista worker
    const pendingDocsCount = useMemo(() => {
        return digitalDocuments.filter(d => d.assignedTo === currentUser?.uid && d.status === 'pending').length;
    }, [digitalDocuments, currentUser]);

    // Agrupación y Paginación para Admin
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

    // FORMULARIO DE CARGA (ADMIN)
    const [uploadForm, setUploadForm] = useState({
        title: '',
        type: 'Contrato',
        assignedTo: '',
        file: null as File | null,
        signaturePageType: 'last' as 'last' | 'specific',
        signaturePageNumber: 1,
        signaturePosition: 'center' as 'left' | 'center' | 'right'
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

            const signatureConfig: any = {
                page: uploadForm.signaturePageType,
                position: uploadForm.signaturePosition
            };
            if (uploadForm.signaturePageType === 'specific') {
                signatureConfig.pageNumber = Number(uploadForm.signaturePageNumber);
            }

            await addDigitalDocument({
                title: uploadForm.title,
                type: uploadForm.type,
                assignedTo: uploadForm.assignedTo,
                originalUrl,
                signatureConfig
            });

            showNotification("Documento cargado y asignado correctamente", "success");
            setShowUploadModal(false);
            setUploadForm({
                title: '',
                type: 'Contrato',
                assignedTo: '',
                file: null,
                signaturePageType: 'last',
                signaturePageNumber: 1,
                signaturePosition: 'center'
            });
            setAssigneeSearch('');
            setShowAssigneeDropdown(false);

        } catch (error) {
            console.error(error);
            showNotification("Error al cargar el documento", "error");
        }
    };

    // LOGICA PARA INCRUSTAR FIRMA PRE-REGISTRADA EN EL PDF
    const performSign = async (docToSign: DigitalDocument, worker: any) => {
        // 1. Obtener IP pública
        let ip = 'Unknown';
        try {
            const ipRes = await axios.get('https://api.ipify.org?format=json');
            ip = ipRes.data.ip;
        } catch (e) { console.error("Could not get IP", e); }

        // 2. Cargar PDF original
        const existingPdfBytes = await fetch(docToSign.originalUrl).then(res => res.arrayBuffer());
        const pdfDoc = await PDFDocument.load(existingPdfBytes);
        const pages = pdfDoc.getPages();

        // 3. Determinar página de destino
        let pageIndex = pages.length - 1; // Por defecto: última hoja
        if (docToSign.signatureConfig?.page === 'specific') {
            const specPage = (docToSign.signatureConfig.pageNumber || 1) - 1;
            pageIndex = Math.max(0, Math.min(specPage, pages.length - 1));
        }

        const selectedPage = pages[pageIndex];
        const { width: pdfWidth, height: pdfHeight } = selectedPage.getSize();

        // 4. Determinar posición horizontal (x)
        const sigWidth = 150;
        const sigHeight = 75;
        let x = (pdfWidth - sigWidth) / 2; // Por defecto: Centro
        if (docToSign.signatureConfig?.position === 'left') {
            x = 50;
        } else if (docToSign.signatureConfig?.position === 'right') {
            x = pdfWidth - sigWidth - 50;
        }

        // Altura automática predefinida por el sistema (y) para la firma
        const y = 40;

        // 5. Incrustar imagen de firma registrada
        const signatureImage = await pdfDoc.embedPng(worker.signatureUrl);
        selectedPage.drawImage(signatureImage, {
            x,
            y,
            width: 120,
            height: 50,
        });

        // 6. Texto de auditoría y sello al pie de la página (máximo 2 líneas al final)
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

        // Dibujar Línea 1 (a y = 25)
        selectedPage.drawText(line1, {
            x: 40,
            y: 25,
            size: 6,
            font,
            color: rgb(0.2, 0.2, 0.2),
        });

        // Dibujar Línea 2 (a y = 15)
        selectedPage.drawText(line2, {
            x: 40,
            y: 15,
            size: 6,
            font,
            color: rgb(0.3, 0.3, 0.3),
        });

        // 7. Guardar y subir a Firebase
        const pdfBytes = await pdfDoc.save();
        const signedFileName = `signed_${docToSign.id}.pdf`;
        const signedBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        const signedUrl = await uploadFile(signedBlob, `signed_docs/${signedFileName}`);

        // 8. Actualizar Firestore
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
                onConfirm: () => { }
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
                onConfirm: () => { }
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
                        onClick={() => setShowUploadModal(true)}
                        className="py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl shadow-blue-200 transition-all active:scale-95 flex items-center justify-center gap-2 self-start md:self-auto"
                    >
                        <Upload size={16} /> Cargar Documento
                    </button>
                )}
            </div>

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

            {/* TAB Y BARRA BUSQUEDA */}
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
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold"
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
                                        {docs.map((doc) => (
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
                            }} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400">
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
                                            placeholder="Buscar..."
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

                            {/* CONFIGURACIÓN DE FIRMA */}
                            <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-4">
                                <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                    <PenTool size={14} className="text-blue-600" />
                                    Configuración de Firma
                                </h3>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Página de Firma</label>
                                        <select
                                            className="w-full px-4 py-3 bg-white border border-slate-200 focus:border-blue-500 rounded-xl outline-none transition-all text-xs font-bold appearance-none cursor-pointer"
                                            value={uploadForm.signaturePageType}
                                            onChange={(e) => setUploadForm({ ...uploadForm, signaturePageType: e.target.value as any })}
                                        >
                                            <option value="last">Última hoja</option>
                                            <option value="specific">Página específica</option>
                                        </select>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Posición Horizontal</label>
                                        <select
                                            className="w-full px-4 py-3 bg-white border border-slate-200 focus:border-blue-500 rounded-xl outline-none transition-all text-xs font-bold appearance-none cursor-pointer"
                                            value={uploadForm.signaturePosition}
                                            onChange={(e) => setUploadForm({ ...uploadForm, signaturePosition: e.target.value as any })}
                                        >
                                            <option value="left">Izquierda</option>
                                            <option value="center">Centro</option>
                                            <option value="right">Derecha</option>
                                        </select>
                                    </div>
                                </div>

                                {uploadForm.signaturePageType === 'specific' && (
                                    <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Número de Página</label>
                                        <input
                                            type="number"
                                            min="1"
                                            required
                                            className="w-full px-4 py-3 bg-white border border-slate-200 focus:border-blue-500 rounded-xl outline-none transition-all text-xs font-bold"
                                            value={uploadForm.signaturePageNumber}
                                            onChange={(e) => setUploadForm({ ...uploadForm, signaturePageNumber: Math.max(1, parseInt(e.target.value) || 1) })}
                                        />
                                    </div>
                                )}
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

            {/* DOCUMENT VIEWER MODAL (TRABAJADOR) */}
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

            {/* BULK SIGNING LOADING OVERLAY */}
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
            {/* DIALOGO DE ALERTA/CONFIRMACION PERSONALIZADO */}
            {alertDialog && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
                    <div className="bg-white rounded-[2rem] p-6 max-w-sm w-full text-center space-y-6 shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-100">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto ${alertDialog.type === 'confirm' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'
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
                                className={`px-6 py-3 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg transition-all flex-1 ${alertDialog.type === 'confirm'
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
        </div>
    );
};

export default DocumentsPage;
