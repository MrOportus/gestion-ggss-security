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
    Calendar,
    ShieldCheck,
    Info
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

        // Filtro por búsqueda
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            docs = docs.filter(d =>
                d.title.toLowerCase().includes(term) ||
                d.type.toLowerCase().includes(term)
            );
        }

        return docs;
    }, [digitalDocuments, currentUser, activeTab, searchTerm]);

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

    // Corregir bug de detección de trazos al abrir el modal (esperar a que termine la animación)
    useEffect(() => {
        if (selectedDocToSign) {
            setSignaturePosition(null); // Resetear posición al abrir nuevo doc
            const timer = setTimeout(() => {
                if (sigPad.current) {
                    const canvas = sigPad.current.getCanvas();
                    if (canvas && canvas.parentElement) {
                        const { offsetWidth, offsetHeight } = canvas.parentElement;
                        canvas.width = offsetWidth;
                        canvas.height = offsetHeight;
                        sigPad.current.clear(); // Refresca el contexto
                    }
                }
            }, 250); // Tiempo para que termine la transición de Tailwind
            return () => clearTimeout(timer);
        }
    }, [selectedDocToSign]);

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

            {/* LISTA DE DOCUMENTOS */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredDocs.length === 0 ? (
                    <div className="col-span-full py-20 flex flex-col items-center justify-center bg-white rounded-3xl border-2 border-dashed border-slate-200">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-slate-300">
                            <FileText size={32} />
                        </div>
                        <p className="text-slate-400 font-medium text-lg">No hay documentos en esta sección</p>
                        <p className="text-slate-400 text-sm">Todo está al día por aquí</p>
                    </div>
                ) : (
                    filteredDocs.map((doc) => {
                        const assignee = employees.find(e => e.id === doc.assignedTo);

                        return (
                            <div key={doc.id} className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 hover:shadow-xl hover:shadow-slate-200/50 transition-all group">
                                <div className="flex items-start justify-between mb-4">
                                    <div className={`p-3 rounded-2xl ${doc.status === 'signed' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                                        <FileText size={24} />
                                    </div>
                                    {doc.status === 'signed' ? (
                                        <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
                                            <CheckCircle size={12} /> Firmado
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">
                                            <Clock size={12} /> Pendiente
                                        </span>
                                    )}
                                </div>

                                <div className="space-y-2 mb-6">
                                    <h3 className="font-bold text-slate-800 text-lg leading-tight group-hover:text-blue-600 transition-colors">
                                        {doc.title}
                                    </h3>
                                    <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                                        <span className="px-2 py-0.5 bg-slate-100 rounded-md">{doc.type}</span>
                                        <span>•</span>
                                        <span className="flex items-center gap-1">
                                            <Calendar size={12} /> {new Date(doc.createdAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>

                                {currentUser?.role === 'admin' && (
                                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl mb-6 border border-slate-100">
                                        <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-xs">
                                            {assignee?.firstName?.[0] || 'U'}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold text-slate-700 truncate">
                                                {assignee ? `${assignee.firstName} ${assignee.lastNamePaterno}` : 'Usuario desconocido'}
                                            </p>
                                            <p className="text-[10px] text-slate-400 font-medium">Asignado a</p>
                                        </div>
                                    </div>
                                )}

                                <div className="flex gap-2">
                                    {doc.status === 'pending' ? (
                                        <>
                                            <a
                                                href={doc.originalUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-bold transition-all"
                                            >
                                                <Eye size={16} /> Revisar
                                            </a>
                                            <button
                                                onClick={() => setSelectedDocToSign(doc)}
                                                className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-blue-100"
                                            >
                                                <PenTool size={16} /> Firmar
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <a
                                                href={doc.signedUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-emerald-100"
                                            >
                                                <Download size={16} /> Descargar Firmado
                                            </a>
                                            {currentUser?.role === 'admin' && (
                                                <button
                                                    onClick={() => {
                                                        if (window.confirm("¿Seguro que deseas eliminar este registro?")) deleteDigitalDocument(doc.id);
                                                    }}
                                                    className="p-3 bg-red-50 hover:bg-red-100 text-red-500 rounded-xl transition-all"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

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
                                    {/* Close dropdown when clicking outside (simple version using translucent overlay if needed, or just leave as is for now as it's inside a modal) */}
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

            {/* MODAL DE FIRMA */}
            {selectedDocToSign && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-[2rem] w-full max-w-4xl max-h-[90vh] shadow-2xl overflow-hidden animate-in fade-in duration-300 flex flex-col">
                        <div className="p-8 border-b border-slate-100 flex justify-between items-center shrink-0">
                            <div>
                                <h2 className="text-xl font-black text-slate-900">Firmar Documento</h2>
                                <p className="text-slate-500 text-sm font-medium">{selectedDocToSign.title}</p>
                            </div>
                            <button
                                onClick={() => setSelectedDocToSign(null)}
                                disabled={isSigning}
                                className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                            >
                                <X size={24} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* SECCIÓN 1: FIRMA */}
                                <div className="space-y-6">
                                    <div className="bg-blue-50 p-6 rounded-3xl border border-blue-100 flex gap-4">
                                        <div className="w-10 h-10 bg-white rounded-2xl flex items-center justify-center text-blue-600 shadow-sm shrink-0">
                                            <Info size={20} />
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-sm font-bold text-blue-900">Pasos para firmar</p>
                                            <ul className="text-xs text-blue-700 leading-relaxed font-medium list-disc ml-4">
                                                <li>Dibuja tu firma en el recuadro.</li>
                                                <li>Busca la ubicación en el PDF de la derecha y haz clic/tap.</li>
                                                <li>Confirma la firma una vez posicionado.</li>
                                            </ul>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex justify-between items-end">
                                            <label className="text-xs font-black text-slate-400 uppercase tracking-widest">1. Tu Firma</label>
                                            <button
                                                onClick={() => sigPad.current?.clear()}
                                                className="text-[10px] font-black text-red-500 uppercase tracking-widest hover:text-red-600 transition-colors"
                                            >
                                                Limpiar
                                            </button>
                                        </div>
                                        <div className="border-2 border-slate-100 rounded-3xl bg-slate-50 overflow-hidden touch-none w-full h-48">
                                            <SignatureCanvas
                                                ref={sigPad}
                                                penColor='black'
                                                canvasProps={{
                                                    className: 'w-full h-full cursor-crosshair'
                                                }}
                                            />
                                        </div>
                                    </div>

                                    <div className="pt-4">
                                        <button
                                            onClick={handleSignDocument}
                                            disabled={isSigning || !signaturePosition}
                                            className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-blue-200 transition-all active:scale-95 flex items-center justify-center gap-2"
                                        >
                                            {isSigning ? <Loader2 size={20} className="animate-spin" /> : <><CheckCircle size={20} /> Procesar Documento</>}
                                        </button>
                                        {!signaturePosition && !isSigning && (
                                            <p className="text-[10px] text-center text-amber-600 font-bold uppercase mt-2">
                                                * Debes marcar la posición en el PDF
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* SECCIÓN 2: UBICACIÓN EN PDF */}
                                <div className="space-y-2">
                                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">2. Ubicación en PDF (Toca para marcar)</label>
                                    <div className="border-2 border-slate-100 rounded-3xl bg-slate-100 h-[500px] overflow-y-auto flex justify-center p-4">
                                        <Document
                                            file={selectedDocToSign.originalUrl}
                                            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                                            loading={<Loader2 className="animate-spin text-blue-600 m-auto" />}
                                        >
                                            {Array.from(new Array(numPages), (_, index) => (
                                                <div key={`page_${index}`} className="relative mb-4 shadow-lg cursor-crosshair transition-transform hover:scale-[1.01]" onClick={(e) => handlePageClick(index, e)}>
                                                    <Page
                                                        pageNumber={index + 1}
                                                        width={350}
                                                        renderAnnotationLayer={false}
                                                        renderTextLayer={false}
                                                    />
                                                    {signaturePosition?.pageIndex === index && (
                                                        <div
                                                            className="absolute border-2 border-blue-600 bg-blue-100/60 rounded-xl pointer-events-none flex flex-col items-center justify-center shadow-xl animate-in zoom-in duration-200 backdrop-blur-[2px]"
                                                            style={{
                                                                left: signaturePosition.x - 60,
                                                                top: signaturePosition.y - 35,
                                                                width: '120px',
                                                                height: '70px',
                                                                zIndex: 10
                                                            }}
                                                        >
                                                            <PenTool size={18} className="text-blue-700 mb-1" />
                                                            <span className="text-[10px] font-black text-blue-800 uppercase text-center leading-tight">
                                                                Su firma irá<br />Aquí
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </Document>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DocumentsPage;
