
import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
    Plus,
    Trash2,
    CheckSquare,
    Square,
    Search,
    ChevronLeft,
    LayoutGrid,
    List,
    Check,
    X,
    Type,
    PlusCircle,
    StickyNote
} from 'lucide-react';
import { BoardNote } from '../types';

const NotesPage: React.FC = () => {
    const { boardNotes, addBoardNote, updateBoardNote, deleteBoardNote, currentUser } = useAppStore();
    const [isEditing, setIsEditing] = useState<string | null>(null); // ID of the note being edited or 'new'
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

    // Local state for editing
    const [editTitle, setEditTitle] = useState('');
    const [editContent, setEditContent] = useState('');
    const [editChecklist, setEditChecklist] = useState<{ id: string; text: string; completed: boolean }[]>([]);

    const startNewNote = () => {
        setEditTitle('');
        setEditContent('');
        setEditChecklist([]);
        setIsEditing('new');
    };

    const startEditNote = (note: BoardNote) => {
        setEditTitle(note.title);
        setEditContent(note.content);
        setEditChecklist(note.checklist || []);
        setIsEditing(note.id);
    };

    const handleSave = async () => {
        if (!currentUser) return;

        const noteData = {
            title: editTitle || 'Sin título',
            content: editContent,
            checklist: editChecklist,
            createdBy: currentUser.uid,
            createdByName: currentUser.email || 'Usuario',
            color: 'white'
        };

        if (isEditing === 'new') {
            await addBoardNote(noteData);
        } else if (isEditing) {
            await updateBoardNote(isEditing, noteData);
        }
        setIsEditing(null);
    };

    const addChecklistItem = () => {
        setEditChecklist([...editChecklist, { id: Date.now().toString(), text: '', completed: false }]);
    };

    const updateChecklistItem = (id: string, text: string) => {
        setEditChecklist(editChecklist.map(item => item.id === id ? { ...item, text } : item));
    };

    const toggleChecklistItem = (id: string) => {
        setEditChecklist(editChecklist.map(item => item.id === id ? { ...item, completed: !item.completed } : item));
    };

    const removeChecklistItem = (id: string) => {
        setEditChecklist(editChecklist.filter(item => item.id !== id));
    };

    const filteredNotes = boardNotes.filter(note =>
        note.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        note.content.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="flex flex-col h-full bg-slate-50 min-h-screen">
            {/* HEADER */}
            <header className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-10">
                <div>
                    <h2 className="text-2xl font-black text-slate-800 tracking-tight">Notas y Tareas</h2>
                    <p className="text-sm text-slate-500 font-medium tracking-wide">Gestiona tus recordatorios y checklists</p>
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar notas..."
                            className="w-full pl-10 pr-4 py-2 bg-slate-100 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-500 transition-all"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <button
                        onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                        className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors hidden md:block"
                    >
                        {viewMode === 'grid' ? <List size={20} /> : <LayoutGrid size={20} />}
                    </button>

                    <button
                        onClick={startNewNote}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-bold shadow-lg shadow-blue-200 transition-all active:scale-95"
                    >
                        <Plus size={20} />
                        <span>Nueva Nota</span>
                    </button>
                </div>
            </header>

            {/* CONTENT */}
            <div className="flex-1 p-6">
                {filteredNotes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                            <StickyNote size={40} />
                        </div>
                        <p className="text-lg font-bold">No hay notas todavía</p>
                        <p className="text-sm">Crea tu primera nota para empezar</p>
                        <button
                            onClick={startNewNote}
                            className="mt-4 text-blue-600 font-bold hover:underline"
                        >
                            Crear nota ahora
                        </button>
                    </div>
                ) : (
                    <div className={viewMode === 'grid'
                        ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
                        : "flex flex-col gap-4 max-w-4xl mx-auto"
                    }>
                        {filteredNotes.map(note => (
                            <div
                                key={note.id}
                                onClick={() => startEditNote(note)}
                                className="group bg-white border border-slate-200 rounded-2xl p-5 hover:border-blue-300 hover:shadow-xl hover:shadow-blue-500/10 transition-all cursor-pointer relative flex flex-col h-full"
                            >
                                <div className="flex justify-between items-start mb-3">
                                    <h3 className="font-bold text-slate-800 text-lg line-clamp-2">{note.title}</h3>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (confirm('¿Estás seguro de eliminar esta nota?')) {
                                                deleteBoardNote(note.id);
                                            }
                                        }}
                                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>

                                <p className="text-slate-600 text-sm mb-4 line-clamp-3 leading-relaxed">
                                    {note.content}
                                </p>

                                {note.checklist && note.checklist.length > 0 && (
                                    <div className="space-y-1.5 mt-auto">
                                        {note.checklist.slice(0, 3).map(item => (
                                            <div key={item.id} className="flex items-center gap-2 text-[13px] text-slate-500">
                                                {item.completed ? (
                                                    <CheckSquare size={14} className="text-emerald-500" />
                                                ) : (
                                                    <Square size={14} className="text-slate-300" />
                                                )}
                                                <span className={item.completed ? 'line-through opacity-50' : ''}>{item.text || '...'}</span>
                                            </div>
                                        ))}
                                        {note.checklist.length > 3 && (
                                            <p className="text-[11px] font-bold text-slate-400 mt-1">
                                                +{note.checklist.length - 3} tareas más
                                            </p>
                                        )}
                                    </div>
                                )}

                                <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                                        {new Date(note.createdAt).toLocaleDateString()}
                                    </span>
                                    <div className="flex -space-x-2">
                                        <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-[10px] font-black text-blue-600 border-2 border-white uppercase">
                                            {note.createdByName[0]}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* MODAL EDITOR (Full screen on mobile, centered on PC) */}
            {isEditing && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-0 md:p-6 animate-in fade-in duration-200">
                    <div className="bg-white w-full h-full md:h-auto md:max-h-[90vh] md:max-w-2xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-5 duration-300">
                        {/* Header Modal */}
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                            <button
                                onClick={() => setIsEditing(null)}
                                className="p-2 -ml-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                            >
                                <ChevronLeft size={24} />
                            </button>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setIsEditing(null)}
                                    className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSave}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl font-bold shadow-lg shadow-blue-200 transition-all active:scale-95 flex items-center gap-2"
                                >
                                    <Check size={18} />
                                    <span>Guardar</span>
                                </button>
                            </div>
                        </div>

                        {/* Scrollable Content Editor */}
                        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 custom-scrollbar">
                            {/* Title Section */}
                            <input
                                type="text"
                                placeholder="Título de la nota..."
                                className="w-full text-3xl md:text-4xl font-black text-slate-800 placeholder:text-slate-200 focus:outline-none border-none p-0 bg-transparent"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                autoFocus
                            />

                            {/* Text Content Section */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 text-slate-400">
                                    <Type size={18} />
                                    <span className="text-xs font-black uppercase tracking-widest">Descripción</span>
                                </div>
                                <textarea
                                    placeholder="Escribe algo aquí... (tipo Notion)"
                                    className="w-full min-h-[150px] text-slate-600 placeholder:text-slate-300 focus:outline-none border-none p-0 bg-transparent text-lg leading-relaxed resize-none"
                                    value={editContent}
                                    onChange={(e) => setEditContent(e.target.value)}
                                />
                            </div>

                            {/* Checklist Section */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-slate-400">
                                        <CheckSquare size={18} />
                                        <span className="text-xs font-black uppercase tracking-widest">Checklist / Tareas</span>
                                    </div>
                                    <button
                                        onClick={addChecklistItem}
                                        className="flex items-center gap-1.5 text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg text-sm font-bold transition-all"
                                    >
                                        <PlusCircle size={16} />
                                        <span>Agregar item</span>
                                    </button>
                                </div>

                                <div className="space-y-2">
                                    {editChecklist.length === 0 ? (
                                        <div
                                            onClick={addChecklistItem}
                                            className="border-2 border-dashed border-slate-100 rounded-2xl p-6 text-center text-slate-400 hover:border-blue-200 hover:text-blue-400 cursor-pointer transition-all"
                                        >
                                            <p className="text-sm font-medium">No hay tareas. Haz clic para agregar una.</p>
                                        </div>
                                    ) : (
                                        editChecklist.map((item) => (
                                            <div key={item.id} className="group flex items-center gap-3 animate-in slide-in-from-left-2 duration-200">
                                                <button
                                                    onClick={() => toggleChecklistItem(item.id)}
                                                    className={`p-1 rounded-lg transition-all ${item.completed ? 'text-emerald-500 bg-emerald-50' : 'text-slate-300 hover:text-slate-400 hover:bg-slate-50'}`}
                                                >
                                                    {item.completed ? <CheckSquare size={22} /> : <Square size={22} />}
                                                </button>
                                                <input
                                                    type="text"
                                                    placeholder="Nueva tarea..."
                                                    className={`flex-1 bg-transparent border-none focus:outline-none text-slate-700 py-2 transition-all ${item.completed ? 'line-through text-slate-400' : ''}`}
                                                    value={item.text}
                                                    onChange={(e) => updateChecklistItem(item.id, e.target.value)}
                                                />
                                                <button
                                                    onClick={() => removeChecklistItem(item.id)}
                                                    className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                                >
                                                    <X size={18} />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Footer Modal Info */}
                        <div className="px-8 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
                                Edición en tiempo real
                            </div>
                            <div>
                                GGSS Security Notes
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};


export default NotesPage;
