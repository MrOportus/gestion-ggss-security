/**
 * TemplateList.tsx
 * Lista de plantillas documentales con acciones: Nueva, Editar, Duplicar, Asignar.
 * Carga plantillas desde Firestore via useAppStore.
 */
import React, { useState, useEffect } from 'react';
import {
    Plus, Edit3, Copy, Send, Trash2, Search, FileText, CheckCircle,
    Clock, Archive, Loader2, AlertTriangle, Download
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { DocumentTemplate } from '../../types';
import TemplateEditor from './TemplateEditor';
import TemplateAssignModal from './TemplateAssignModal';
import { PLANTILLAS_PREBUILT } from './TemplatePrebuilt';

const ESTADO_CONFIG = {
    activo: { label: 'Activo', icon: <CheckCircle size={11} />, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    borrador: { label: 'Borrador', icon: <Clock size={11} />, cls: 'text-amber-700 bg-amber-50 border-amber-200' },
    archivado: { label: 'Archivado', icon: <Archive size={11} />, cls: 'text-slate-600 bg-slate-100 border-slate-200' },
};

const TIPO_COLOR: Record<string, string> = {
    Contrato: 'bg-blue-50 text-blue-700',
    EPP: 'bg-orange-50 text-orange-700',
    ODI: 'bg-purple-50 text-purple-700',
    Reglamento: 'bg-indigo-50 text-indigo-700',
    Otro: 'bg-slate-100 text-slate-600',
};

const TemplateList: React.FC = () => {
    const {
        documentTemplates, fetchDocumentTemplates, addDocumentTemplate,
        deleteDocumentTemplate, updateDocumentTemplate, showNotification, currentUser,
    } = useAppStore();

    const [search, setSearch] = useState('');
    const [filterEstado, setFilterEstado] = useState<string>('all');
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<DocumentTemplate | null>(null);
    const [assignTemplate, setAssignTemplate] = useState<DocumentTemplate | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);

    useEffect(() => {
        if (!hasLoaded) {
            setIsLoading(true);
            fetchDocumentTemplates().finally(() => { setIsLoading(false); setHasLoaded(true); });
        }
    }, [fetchDocumentTemplates, hasLoaded]);

    const filtered = documentTemplates.filter(t => {
        const q = search.toLowerCase();
        const matchQ = !q || t.nombre.toLowerCase().includes(q) || t.tipo.toLowerCase().includes(q);
        const matchE = filterEstado === 'all' || t.estado === filterEstado;
        return matchQ && matchE;
    });

    const handleDuplicate = async (t: DocumentTemplate) => {
        try {
            const payload: Omit<DocumentTemplate, 'id' | 'creadoEn'> = {
                ...t,
                nombre: t.nombre + ' (copia)',
                estado: 'borrador',
                version: 1,
                creadoPor: currentUser?.uid || '',
            };
            await addDocumentTemplate(payload);
            showNotification('Plantilla duplicada como borrador', 'success');
        } catch {
            showNotification('Error al duplicar la plantilla', 'error');
        }
    };

    const handleDelete = async (t: DocumentTemplate) => {
        if (!window.confirm(`¿Eliminar la plantilla "${t.nombre}"? Esta acción no se puede deshacer.`)) return;
        try {
            await deleteDocumentTemplate(t.id);
            showNotification('Plantilla eliminada', 'success');
        } catch {
            showNotification('Error al eliminar la plantilla', 'error');
        }
    };

    const handleLoadPrebuilt = async (idx: number) => {
        const prebuilt = PLANTILLAS_PREBUILT[idx];
        if (!prebuilt) return;
        try {
            await addDocumentTemplate({ ...prebuilt, creadoPor: currentUser?.uid || '' });
            showNotification(`Plantilla "${prebuilt.nombre}" cargada correctamente`, 'success');
        } catch {
            showNotification('Error al cargar la plantilla predefinida', 'error');
        }
    };

    if (editorOpen) {
        return <TemplateEditor template={editingTemplate} onClose={() => { setEditorOpen(false); setEditingTemplate(null); }} onSaved={() => fetchDocumentTemplates()} />;
    }

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-black text-slate-800">Plantillas Documentales</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Crea y administra plantillas reutilizables para asignar a trabajadores.</p>
                </div>
                <div className="flex items-center gap-2">
                    {!isLoading && (
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleLoadPrebuilt(0)}
                                className="flex items-center gap-1.5 px-3 py-2 border border-indigo-200 text-indigo-600 hover:bg-indigo-50 rounded-xl text-xs font-bold transition-all"
                                title="Cargar plantilla predefinida: Reglamento Interno"
                            >
                                <Download size={13} />
                                Reglamento
                            </button>
                            <button
                                onClick={() => handleLoadPrebuilt(1)}
                                className="flex items-center gap-1.5 px-3 py-2 border border-orange-200 text-orange-600 hover:bg-orange-50 rounded-xl text-xs font-bold transition-all"
                                title="Cargar plantilla predefinida: Entrega EPP"
                            >
                                <Download size={13} />
                                EPP
                            </button>
                            <button
                                onClick={() => handleLoadPrebuilt(2)}
                                className="flex items-center gap-1.5 px-3 py-2 border border-amber-200 text-amber-700 hover:bg-amber-50 rounded-xl text-xs font-bold transition-all"
                                title="Cargar plantilla predefinida: EPP Oficial SG-SST"
                            >
                                <Download size={13} />
                                EPP Oficial
                            </button>
                        </div>
                    )}
                    <button
                        onClick={() => { setEditingTemplate(null); setEditorOpen(true); }}
                        className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-blue-200 active:scale-95"
                    >
                        <Plus size={15} />
                        Nueva Plantilla
                    </button>
                </div>
            </div>

            {/* Filtros */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar plantilla..."
                        className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:border-blue-400 bg-slate-50"
                    />
                </div>
                <div className="flex p-0.5 bg-slate-100 rounded-xl">
                    {(['all', 'activo', 'borrador', 'archivado'] as const).map(e => (
                        <button key={e} onClick={() => setFilterEstado(e)} className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all capitalize ${filterEstado === e ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}>
                            {e === 'all' ? 'Todos' : e.charAt(0).toUpperCase() + e.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {/* Lista */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-16">
                    <Loader2 size={28} className="text-blue-500 animate-spin mb-3" />
                    <p className="text-sm text-slate-500 font-medium">Cargando plantillas...</p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="bg-white rounded-3xl border border-slate-100 p-12 text-center shadow-sm">
                    <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <FileText size={32} className="text-slate-300" />
                    </div>
                    <h4 className="text-base font-black text-slate-600">
                        {documentTemplates.length === 0 ? 'Sin plantillas creadas' : 'Sin resultados'}
                    </h4>
                    <p className="text-sm text-slate-400 mt-2 max-w-md mx-auto">
                        {documentTemplates.length === 0
                            ? 'Crea tu primera plantilla o carga una predefinida para comenzar.'
                            : 'No hay plantillas que coincidan con los filtros.'}
                    </p>
                    {documentTemplates.length === 0 && (
                        <div className="flex gap-3 justify-center mt-6">
                            <button onClick={() => handleLoadPrebuilt(0)} className="flex items-center gap-2 px-4 py-2.5 border border-indigo-200 text-indigo-600 hover:bg-indigo-50 rounded-xl text-xs font-black transition-all">
                                <Download size={14} /> Reglamento Interno
                            </button>
                            <button onClick={() => handleLoadPrebuilt(1)} className="flex items-center gap-2 px-4 py-2.5 border border-orange-200 text-orange-600 hover:bg-orange-50 rounded-xl text-xs font-black transition-all">
                                <Download size={14} /> Entrega EPP
                            </button>
                            <button onClick={() => handleLoadPrebuilt(2)} className="flex items-center gap-2 px-4 py-2.5 border border-amber-200 text-amber-700 hover:bg-amber-50 rounded-xl text-xs font-black transition-all">
                                <Download size={14} /> EPP Oficial SG-SST
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map(template => {
                        const estadoCfg = ESTADO_CONFIG[template.estado] || ESTADO_CONFIG.borrador;
                        const tipoCls = TIPO_COLOR[template.tipo] || TIPO_COLOR.Otro;
                        return (
                            <div key={template.id} className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-all group flex flex-col">
                                {/* Cabecera */}
                                <div className="flex items-start justify-between gap-3 mb-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg ${tipoCls}`}>{template.tipo}</span>
                                            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg border flex items-center gap-1 ${estadoCfg.cls}`}>
                                                {estadoCfg.icon}{estadoCfg.label}
                                            </span>
                                            <span className="text-[10px] font-bold text-slate-400">v{template.version}</span>
                                        </div>
                                        <h4 className="font-black text-slate-800 text-sm leading-snug">{template.nombre}</h4>
                                    </div>
                                </div>

                                {/* Info */}
                                <div className="text-xs text-slate-400 mb-4 mt-auto">
                                    <p>{template.bloques.length} bloques</p>
                                    <p>Creado: {new Date(template.creadoEn).toLocaleDateString('es-CL')}</p>
                                </div>

                                {/* Acciones */}
                                <div className="flex items-center gap-1.5 pt-3 border-t border-slate-100">
                                    {template.estado === 'activo' && (
                                        <button
                                            onClick={() => setAssignTemplate(template)}
                                            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[11px] font-black uppercase tracking-wider transition-all active:scale-95"
                                        >
                                            <Send size={12} />Asignar
                                        </button>
                                    )}
                                    <button
                                        onClick={() => { setEditingTemplate(template); setEditorOpen(true); }}
                                        className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-[11px] font-bold transition-all"
                                        title="Editar"
                                    >
                                        <Edit3 size={13} />
                                    </button>
                                    <button
                                        onClick={() => handleDuplicate(template)}
                                        className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-[11px] font-bold transition-all"
                                        title="Duplicar"
                                    >
                                        <Copy size={13} />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(template)}
                                        className="flex items-center gap-1.5 px-3 py-2 border border-red-100 text-red-400 hover:bg-red-50 rounded-xl text-[11px] font-bold transition-all"
                                        title="Eliminar"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Modal de Asignación */}
            {assignTemplate && (
                <TemplateAssignModal
                    template={assignTemplate}
                    onClose={() => setAssignTemplate(null)}
                />
            )}
        </div>
    );
};

export default TemplateList;
