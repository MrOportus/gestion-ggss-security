import React, { useState, useEffect } from 'react';
import {
  FileText,
  Upload,
  Trash2,
  X,
  Loader2,
  AlertCircle,
  Download,
  Building
} from 'lucide-react';
import { db, storage } from '../../lib/firebase';
import { collection, query, orderBy, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { CompanyDocument } from '../../types';
import { useAppStore } from '../../store/useAppStore';

const CorporateDocsManager: React.FC = () => {
    const { currentUser } = useAppStore();
    const [documents, setDocuments] = useState<CompanyDocument[]>([]);
    const [loading, setLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const [showUploadModal, setShowUploadModal] = useState(false);
    
    // Upload form
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Fetch documents
    useEffect(() => {
        const q = query(collection(db, 'company_documents'), orderBy('createdAt', 'desc'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const docs: CompanyDocument[] = [];
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                docs.push({
                    id: docSnap.id,
                    name: data.name,
                    description: data.description,
                    url: data.url,
                    uploadedBy: data.uploadedBy,
                    createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString()
                });
            });
            setDocuments(docs);
            setLoading(false);
        }, (err) => {
            console.error("Error fetching company documents:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file || !name.trim()) return;
        
        setIsUploading(true);
        setError(null);
        
        try {
            const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            const storageRef = ref(storage, `company_documents/${fileName}`);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);
            
            await addDoc(collection(db, 'company_documents'), {
                name: name.trim(),
                description: description.trim(),
                url,
                fileName, // Guardado interno para poder borrar del storage
                uploadedBy: currentUser?.role || 'Admin',
                createdAt: serverTimestamp()
            });
            
            setShowUploadModal(false);
            setName('');
            setDescription('');
            setFile(null);
        } catch (err: any) {
            console.error("Error uploading document:", err);
            setError(err.message || 'Error al subir documento');
        } finally {
            setIsUploading(false);
        }
    };

    const handleDelete = async (docId: string, fileName?: string) => {
        if (!window.confirm("¿Seguro que deseas eliminar este documento para todos los guardias?")) return;
        
        try {
            await deleteDoc(doc(db, 'company_documents', docId));
            if (fileName) {
                const storageRef = ref(storage, `company_documents/${fileName}`);
                await deleteObject(storageRef).catch(console.error);
            }
        } catch (err) {
            console.error("Error deleting document:", err);
            alert("Error al eliminar el documento");
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <div>
                    <h3 className="text-lg font-black text-slate-800">Biblioteca Corporativa</h3>
                    <p className="text-xs text-slate-500 mt-1">
                        Sube documentos globales (Reglamento Interno, RIOHS, etc) visibles para todos los guardias en la App.
                    </p>
                </div>
                <button
                    onClick={() => setShowUploadModal(true)}
                    className="py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center gap-2 transition-all shadow-md active:scale-95 text-sm"
                >
                    <Upload size={18} />
                    Cargar Documento
                </button>
            </div>

            {loading ? (
                <div className="py-20 flex flex-col items-center justify-center">
                    <Loader2 size={32} className="text-blue-500 animate-spin mb-4" />
                    <p className="text-slate-500 font-medium">Cargando biblioteca...</p>
                </div>
            ) : documents.length === 0 ? (
                <div className="bg-white rounded-[2rem] border border-slate-100 p-12 text-center shadow-sm">
                    <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <Building size={32} className="text-slate-400" />
                    </div>
                    <h4 className="text-base font-black text-slate-700">Sin Documentos Corporativos</h4>
                    <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
                        Actualmente no hay documentos en la biblioteca corporativa. Los guardias no verán ningún archivo en esta sección.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {documents.map((doc) => (
                        <div key={doc.id} className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col hover:shadow-md transition-shadow">
                            <div className="flex items-start justify-between gap-3 mb-4">
                                <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                                    <FileText size={24} />
                                </div>
                                <button
                                    onClick={() => handleDelete(doc.id, (doc as any).fileName)}
                                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Eliminar documento"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                            <h4 className="font-bold text-slate-800 text-base line-clamp-1">{doc.name}</h4>
                            {doc.description && (
                                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{doc.description}</p>
                            )}
                            <div className="mt-auto pt-4 flex items-center justify-between border-t border-slate-100 mt-4">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pt-2">
                                    Subido por: {doc.uploadedBy}
                                </span>
                                <a
                                    href={doc.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-700 bg-blue-50 p-2 rounded-lg mt-2"
                                >
                                    <Download size={16} />
                                </a>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal de Subida */}
            {showUploadModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
                        <div className="flex items-center justify-between p-6 border-b border-slate-100">
                            <h3 className="text-xl font-black text-slate-800">Cargar Documento</h3>
                            <button
                                onClick={() => !isUploading && setShowUploadModal(false)}
                                className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500"
                                disabled={isUploading}
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleUpload} className="p-6 space-y-5">
                            {error && (
                                <div className="bg-red-50 border border-red-100 p-3 rounded-xl flex items-start gap-2">
                                    <AlertCircle size={16} className="text-red-500 mt-0.5" />
                                    <p className="text-xs font-bold text-red-700">{error}</p>
                                </div>
                            )}

                            <div>
                                <label className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2 block">
                                    Nombre del Documento
                                </label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    placeholder="Ej: Reglamento Interno 2026"
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:bg-white outline-none transition-all font-medium text-slate-700"
                                    required
                                />
                            </div>

                            <div>
                                <label className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2 block">
                                    Descripción (Opcional)
                                </label>
                                <textarea
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    placeholder="Breve descripción del archivo..."
                                    rows={2}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:bg-white outline-none transition-all font-medium text-slate-700 resize-none"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2 block">
                                    Archivo (PDF, DOCX)
                                </label>
                                <input
                                    type="file"
                                    onChange={e => setFile(e.target.files?.[0] || null)}
                                    className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-black file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                                    accept=".pdf,.doc,.docx"
                                    required
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={isUploading || !file || !name.trim()}
                                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-blue-200 flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                            >
                                {isUploading ? (
                                    <><Loader2 size={20} className="animate-spin" /> Subiendo...</>
                                ) : (
                                    <>Confirmar Subida</>
                                )}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CorporateDocsManager;
