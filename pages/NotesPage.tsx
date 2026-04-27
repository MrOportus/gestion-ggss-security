
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
    Plus,
    Trash2,
    CheckSquare,
    Square,
    Search,
    LayoutGrid,
    List as ListIcon,
    X,
    Type as TypeIcon,
    StickyNote,
    Pin,
    Bell,
    GripVertical,
    Save,
    Settings
} from 'lucide-react';
import { BoardNote } from '../types';

/* ──────────────────────────────────────────
   Helpers
────────────────────────────────────────── */
function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

type ChecklistItem = { id: string; text: string; completed: boolean };

/* ──────────────────────────────────────────
   Rich-text Format Bar
────────────────────────────────────────── */
const FormatBar: React.FC = () => {
    const exec = (cmd: string, val?: string) => document.execCommand(cmd, false, val);
    return (
        <div className="flex items-center gap-0.5 px-1.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl w-fit animate-in slide-in-from-top-1 duration-150">
            <button onMouseDown={e => { e.preventDefault(); exec('formatBlock', 'h1'); exec('bold'); }}
                className="px-2.5 py-1 text-[12px] font-black text-slate-600 hover:bg-slate-200 rounded-lg" title="Título H1">H1</button>
            <button onMouseDown={e => { e.preventDefault(); exec('formatBlock', 'h2'); exec('bold'); }}
                className="px-2.5 py-1 text-[12px] font-black text-slate-600 hover:bg-slate-200 rounded-lg" title="Subtítulo H2">H2</button>
            <div className="w-px h-4 bg-slate-300 mx-1" />
            <button onMouseDown={e => { e.preventDefault(); exec('bold'); }}
                className="px-2 py-1 text-[12px] font-bold text-slate-600 hover:bg-slate-200 rounded-lg" title="Negrita">B</button>
            <button onMouseDown={e => { e.preventDefault(); exec('italic'); }}
                className="px-2 py-1 text-[12px] italic text-slate-600 hover:bg-slate-200 rounded-lg" title="Cursiva">/</button>
            <button onMouseDown={e => { e.preventDefault(); exec('underline'); }}
                className="px-2 py-1 text-[12px] underline text-slate-600 hover:bg-slate-200 rounded-lg" title="Subrayado">U</button>
            <div className="w-px h-4 bg-slate-300 mx-1" />
            <button onMouseDown={e => { e.preventDefault(); exec('foreColor', '#000000'); }}
                className="w-5 h-5 rounded-full bg-black border-2 border-white ring-1 ring-slate-300 hover:scale-110 transition-transform" title="Negro" />
            <button onMouseDown={e => { e.preventDefault(); exec('foreColor', '#ef4444'); }}
                className="w-5 h-5 rounded-full bg-red-500 border-2 border-white ring-1 ring-slate-300 hover:scale-110 transition-transform" title="Rojo" />
            <button onMouseDown={e => { e.preventDefault(); exec('foreColor', '#3b82f6'); }}
                className="w-5 h-5 rounded-full bg-blue-500 border-2 border-white ring-1 ring-slate-300 hover:scale-110 transition-transform" title="Azul" />
            <div className="w-px h-4 bg-slate-300 mx-1" />
            <button onMouseDown={e => { e.preventDefault(); exec('removeFormat'); exec('formatBlock', 'p'); }}
                className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg" title="Limpiar formato">
                <X size={12} />
            </button>
        </div>
    );
};

/* ──────────────────────────────────────────
   Checklist section inside a note
────────────────────────────────────────── */
interface ChecklistEditorProps {
    items: ChecklistItem[];
    onChange: (items: ChecklistItem[]) => void;
    autoFocusLast?: boolean;
}

const ChecklistEditor: React.FC<ChecklistEditorProps> = ({ items, onChange, autoFocusLast }) => {
    const refs = useRef<(HTMLInputElement | null)[]>([]);
    const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);

    // Manejar el foco cuando cambian los ítems o se requiere un foco específico
    useEffect(() => {
        if (pendingFocusIndex !== null) {
            refs.current[pendingFocusIndex]?.focus();
            setPendingFocusIndex(null);
        } else if (autoFocusLast && items.length > 0) {
            refs.current[items.length - 1]?.focus();
        }
    }, [items, pendingFocusIndex, autoFocusLast]);

    const update = (id: string, text: string) => onChange(items.map(i => i.id === id ? { ...i, text } : i));
    const toggle = (id: string) => onChange(items.map(i => i.id === id ? { ...i, completed: !i.completed } : i));
    const remove = (id: string) => onChange(items.filter(i => i.id !== id));

    const onKeyDown = (e: React.KeyboardEvent, index: number) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const newItem: ChecklistItem = { id: genId(), text: '', completed: false };
            const next = [...items];
            next.splice(index + 1, 0, newItem);
            onChange(next);
            setPendingFocusIndex(index + 1);
        } else if (e.key === 'Backspace' && items[index].text === '' && items.length > 1) {
            e.preventDefault();
            const targetId = items[index].id;
            const newIndex = Math.max(0, index - 1);
            onChange(items.filter(i => i.id !== targetId));
            setPendingFocusIndex(newIndex);
        }
    };

    return (
        <div className="space-y-0.5 mt-2 border-t border-slate-100 pt-3">
            <p className="text-[10px] font-black uppercase text-slate-300 tracking-widest mb-2">Lista de tareas</p>
            {items.map((item, idx) => (
                <div key={item.id} className="group flex items-center gap-1.5">
                    <div className="opacity-0 group-hover:opacity-100 cursor-grab transition-opacity">
                        <GripVertical size={14} className="text-slate-300" />
                    </div>
                    <button
                        onMouseDown={e => { e.preventDefault(); toggle(item.id); }}
                        className={`flex-shrink-0 transition-colors ${item.completed ? 'text-blue-500' : 'text-slate-300 hover:text-slate-500'}`}
                    >
                        {item.completed ? <CheckSquare size={18} /> : <Square size={18} />}
                    </button>
                    <input
                        ref={el => { refs.current[idx] = el; }}
                        type="text"
                        placeholder="Tarea"
                        className={`flex-1 bg-transparent border-none focus:outline-none text-[14px] py-1.5 placeholder:text-slate-300 ${item.completed ? 'line-through text-slate-400' : 'text-slate-700'}`}
                        value={item.text}
                        onChange={e => update(item.id, e.target.value)}
                        onKeyDown={e => onKeyDown(e, idx)}
                    />
                    <button
                        onMouseDown={e => { e.preventDefault(); remove(item.id); }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-rose-500 rounded-full transition-all"
                    >
                        <X size={14} />
                    </button>
                </div>
            ))}
            <button
                type="button"
                onClick={() => onChange([...items, { id: genId(), text: '', completed: false }])}
                className="flex items-center gap-2 mt-1 pl-5 py-1 text-[13px] text-slate-400 hover:text-slate-600 transition-colors"
            >
                <Plus size={14} />
                <span>Añadir elemento</span>
            </button>
        </div>
    );
};

/* ──────────────────────────────────────────
   Note Card
────────────────────────────────────────── */
interface NoteCardProps {
    note: BoardNote;
    onEdit: () => void;
    onDelete: () => void;
    onTogglePin: () => void;
}

const NoteCard: React.FC<NoteCardProps> = ({ note, onEdit, onDelete, onTogglePin }) => (
        <div
            onClick={onEdit}
            className={`group border border-slate-200 rounded-xl p-4 bg-white hover:shadow-md hover:border-slate-300 transition-all cursor-pointer relative flex flex-col ${note.completed ? 'opacity-60 grayscale-[0.5]' : ''}`}
        >
            {note.title && (
                <h3 className="font-bold text-slate-800 text-[15px] leading-snug mb-2 pr-8">{note.title}</h3>
            )}

            {/* Rich text content */}
            {note.content && (
                <div
                    className="note-content text-slate-600 text-[13px] leading-relaxed mb-2 line-clamp-[10] overflow-hidden"
                    dangerouslySetInnerHTML={{ __html: note.content }}
                />
            )}

        {/* Checklist preview */}
        {note.checklist && note.checklist.length > 0 && (
            <div className={`space-y-1.5 ${note.content ? 'mt-2 pt-2 border-t border-slate-100' : ''}`}>
                {note.checklist.slice(0, 8).map(item => (
                    <div key={item.id} className="flex items-center gap-2 text-[13px]">
                        {item.completed
                            ? <CheckSquare size={14} className="text-blue-500 flex-shrink-0" />
                            : <Square size={14} className="text-slate-300 flex-shrink-0" />}
                        <span className={item.completed ? 'line-through text-slate-400' : 'text-slate-600'}>
                            {item.text}
                        </span>
                    </div>
                ))}
                {note.checklist.length > 8 && (
                    <p className="text-[11px] text-slate-400 pl-5">+{note.checklist.length - 8} más</p>
                )}
            </div>
        )}

        {/* Due Date preview */}
        {note.dueDate && (
            <div className="mt-2 inline-flex items-center gap-1 px-2 py-1.5 rounded-full bg-amber-50 border border-amber-100 text-amber-700 text-[11px] font-bold w-fit">
                <Bell size={12} />
                {new Date(note.dueDate).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
            </div>
        )}

        {/* Pin button */}
        <button
            onClick={e => { e.stopPropagation(); onTogglePin(); }}
            className={`absolute top-3 right-3 p-1.5 rounded-full transition-all ${note.pinned
                ? 'opacity-100 text-slate-700'
                : 'opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700'}`}
            title={note.pinned ? 'Desanclar' : 'Anclar'}
        >
            <Pin size={16} className={note.pinned ? 'fill-slate-700' : ''} />
        </button>

        {/* Hover actions */}
        <div className="mt-auto opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 pt-3">
            <button className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"><Bell size={14} /></button>
            <button
                onClick={e => { e.stopPropagation(); if (confirm('¿Eliminar nota?')) onDelete(); }}
                className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-full transition-colors"
            >
                <Trash2 size={14} />
            </button>
        </div>
    </div>
);

/* ──────────────────────────────────────────
   Main Page
────────────────────────────────────────── */
const NotesPage: React.FC = () => {
    const { boardNotes, addBoardNote, updateBoardNote, deleteBoardNote, currentUser } = useAppStore();
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [searchTerm, setSearchTerm] = useState('');
    const [saving, setSaving] = useState(false);

    /* ── Inline bar ── */
    const [isExpanding, setIsExpanding] = useState(false);
    const [inlineTitle, setInlineTitle] = useState('');
    const [inlineChecklist, setInlineChecklist] = useState<ChecklistItem[]>([]);
    const [inlineShowChecklist, setInlineShowChecklist] = useState(false);
    const [inlineShowFormat, setInlineShowFormat] = useState(false);
    const [inlineIsPinned, setInlineIsPinned] = useState(false);
    const [inlineDueDate, setInlineDueDate] = useState('');
    const [inlineShowDueDate, setInlineShowDueDate] = useState(false);
    const inlineContentRef = useRef<HTMLDivElement>(null);
    const takeNoteWrapRef = useRef<HTMLDivElement>(null);

    /* ── Modal ── */
    const [editingNote, setEditingNote] = useState<BoardNote | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editChecklist, setEditChecklist] = useState<ChecklistItem[]>([]);
    const [editShowChecklist, setEditShowChecklist] = useState(false);
    const [editShowFormat, setEditShowFormat] = useState(false);
    const [editIsPinned, setEditIsPinned] = useState(false);
    const [editDueDate, setEditDueDate] = useState('');
    const [editShowDueDate, setEditShowDueDate] = useState(false);
    const editContentRef = useRef<HTMLDivElement>(null);

    /* populate modal on open */
    useEffect(() => {
        if (editingNote && editContentRef.current) {
            editContentRef.current.innerHTML = editingNote.content || '';
        }
    }, [editingNote?.id]);

    /* ESC closes modal (DISABLED to avoid accidental loss, user must click buttons) */
    useEffect(() => {
        // const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && editingNote) setEditingNote(null); };
        // window.addEventListener('keydown', h);
        // return () => window.removeEventListener('keydown', h);
    }, [editingNote]);

    /* ── Save inline note ── */
    const handleInlineSave = async (explicit: boolean) => {
        const content = inlineContentRef.current?.innerHTML || '';
        const hasText = inlineTitle.trim() || content.replace(/<[^>]+>/g, '').trim();
        const hasChecklist = inlineShowChecklist && inlineChecklist.some(i => i.text.trim());

        if ((hasText || hasChecklist) && currentUser) {
            if (explicit) setSaving(true);
            await addBoardNote({
                title: inlineTitle.trim(),
                content,
                checklist: inlineShowChecklist ? inlineChecklist : [],
                createdBy: currentUser.uid,
                createdByName: currentUser.email || 'Usuario',
                color: 'white',
                pinned: inlineIsPinned,
                dueDate: inlineDueDate,
            });
            if (explicit) setSaving(false);
        }
        setIsExpanding(false);
        setInlineTitle('');
        setInlineChecklist([]);
        setInlineShowChecklist(false);
        setInlineShowFormat(false);
        setInlineIsPinned(false);
        setInlineDueDate('');
        setInlineShowDueDate(false);
        if (inlineContentRef.current) inlineContentRef.current.innerHTML = '';
    };

    /* ── Open modal ── */
    const openEdit = (note: BoardNote) => {
        setEditingNote(note);
        setEditTitle(note.title);
        setEditChecklist(note.checklist?.length ? note.checklist : []);
        setEditShowChecklist(!!(note.checklist && note.checklist.length > 0));
        setEditIsPinned(!!note.pinned);
        setEditShowFormat(false);
        setEditDueDate(note.dueDate || '');
        setEditShowDueDate(false);
    };

    /* ── Save modal ── */
    const saveModal = async () => {
        if (!editingNote) return;
        const content = editContentRef.current?.innerHTML || '';
        setSaving(true);
        await updateBoardNote(editingNote.id, {
            title: editTitle.trim(),
            content,
            checklist: editShowChecklist ? editChecklist : [],
            color: 'white',
            pinned: editIsPinned,
            dueDate: editDueDate,
        });
        setSaving(false);
        setEditingNote(null);
    };

    /* ── Toggle pin from card ── */
    const togglePin = (note: BoardNote) =>
        updateBoardNote(note.id, { pinned: !note.pinned });

    /* ── Toggle checklist section inline ── */
    const toggleInlineChecklist = () => {
        if (!inlineShowChecklist && inlineChecklist.length === 0) {
            setInlineChecklist([{ id: genId(), text: '', completed: false }]);
        }
        setInlineShowChecklist(v => !v);
    };

    /* ── Toggle checklist section modal ── */
    const toggleEditChecklist = () => {
        if (!editShowChecklist && editChecklist.length === 0) {
            setEditChecklist([{ id: genId(), text: '', completed: false }]);
        }
        setEditShowChecklist(v => !v);
    };

    /* ── Filtered notes ── */
    const q = searchTerm.toLowerCase();
    const match = (n: BoardNote) =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.checklist?.some(i => i.text.toLowerCase().includes(q));

    const filtered = boardNotes.filter(match);
    const pinned = filtered.filter(n => n.pinned);
    const unpinned = filtered.filter(n => !n.pinned);

    const gridClass = viewMode === 'grid'
        ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
        : 'flex flex-col gap-3 max-w-2xl mx-auto';

    return (
        <div className="flex flex-col h-full bg-white min-h-screen font-sans">
            <style>{`
                .note-content h1, [contenteditable] h1 {
                    font-size: 16px !important;
                    font-weight: 800 !important;
                    margin: 0.5rem 0 !important;
                    display: block !important;
                }
                .note-content h2, [contenteditable] h2 {
                    font-size: 14px !important;
                    font-weight: 700 !important;
                    margin: 0.3rem 0 !important;
                    display: block !important;
                }
                .note-content b, .note-content strong, [contenteditable] b, [contenteditable] strong {
                    font-weight: 800 !important;
                }
                [contenteditable]:empty:before {
                    content: attr(placeholder);
                    color: #cbd5e1;
                }
            `}</style>

            {/* ── HEADER ── */}
            <header className="px-5 py-3 flex items-center gap-4 bg-white border-b border-slate-200 sticky top-0 z-30">
                <div className="flex-1 max-w-3xl relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                        <Search size={18} />
                    </div>
                    <input
                        type="text"
                        placeholder="Buscar notas"
                        className="w-full bg-slate-100 border border-transparent focus:bg-white focus:border-slate-300 focus:shadow-sm rounded-xl py-2.5 pl-11 pr-4 outline-none text-[14px] transition-all"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="flex items-center gap-1 ml-auto">
                    <button
                        onClick={() => setViewMode(v => v === 'grid' ? 'list' : 'grid')}
                        className="p-2.5 text-slate-500 hover:bg-slate-100 rounded-full transition-colors"
                    >
                        {viewMode === 'grid' ? <LayoutGrid size={20} /> : <ListIcon size={20} />}
                    </button>
                    <button className="p-2.5 hover:bg-slate-100 rounded-full text-slate-500"><Settings size={20} /></button>
                    <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-sm ml-2 cursor-pointer">
                        {currentUser?.email?.[0].toUpperCase() || 'U'}
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto custom-scrollbar pt-8 pb-24">

                {/* ── TAKE A NOTE BAR ── */}
                <div className="max-w-2xl mx-auto px-4 mb-12">
                    <div
                        ref={takeNoteWrapRef}
                        className={`bg-white border rounded-2xl transition-all duration-200 ${isExpanding ? 'border-slate-200 shadow-lg' : 'border-slate-300 shadow-sm hover:shadow'}`}
                    >
                        {/* Collapsed */}
                        {!isExpanding && (
                            <div className="flex items-center p-3 gap-2">
                                <div
                                    className="flex-1 text-[15px] text-slate-400 px-2 cursor-text py-1"
                                    onClick={() => setIsExpanding(true)}
                                >
                                    Añade una nota...
                                </div>
                                <button
                                    onClick={() => { setIsExpanding(true); setInlineShowChecklist(true); setInlineChecklist([{ id: genId(), text: '', completed: false }]); }}
                                    className="p-2 hover:bg-slate-100 rounded-full text-slate-400" title="Nueva lista"
                                >
                                    <CheckSquare size={19} />
                                </button>
                            </div>
                        )}

                        {/* Expanded */}
                        {isExpanding && (
                            <div className="p-4">
                                {/* Title + pin */}
                                <div className="flex items-center justify-between gap-2 mb-3">
                                    <input
                                        type="text"
                                        placeholder="Título"
                                        autoFocus
                                        className="flex-1 bg-transparent text-[16px] font-bold text-slate-700 placeholder:text-slate-300 focus:outline-none"
                                        value={inlineTitle}
                                        onChange={e => setInlineTitle(e.target.value)}
                                    />
                                    <button
                                        onClick={() => setInlineIsPinned(v => !v)}
                                        className={`p-1.5 rounded-full flex-shrink-0 transition-all ${inlineIsPinned ? 'text-slate-800' : 'text-slate-300 hover:text-slate-600'}`}
                                    >
                                        <Pin size={17} className={inlineIsPinned ? 'fill-slate-800' : ''} />
                                    </button>
                                </div>

                                {/* Rich text */}
                                <div
                                    ref={inlineContentRef}
                                    contentEditable
                                    placeholder="Escribe algo..."
                                    className="note-content min-h-[72px] text-[14px] text-slate-600 focus:outline-none leading-relaxed"
                                />

                                {/* Checklist section (hybrid) */}
                                {inlineShowChecklist && (
                                    <ChecklistEditor
                                        items={inlineChecklist}
                                        onChange={setInlineChecklist}
                                        autoFocusLast
                                    />
                                )}

                                {inlineShowFormat && <div className="mt-3"><FormatBar /></div>}

                                {/* Footer */}
                                <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                                    <div className="flex items-center gap-0.5">
                                        <button
                                            onClick={() => setInlineShowFormat(v => !v)}
                                            className={`p-2 rounded-full transition-colors ${inlineShowFormat ? 'bg-slate-200 text-slate-800' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
                                            title="Formato de texto"
                                        >
                                            <TypeIcon size={18} />
                                        </button>
                                        <div className="relative flex items-center">
                                            <button 
                                                onClick={() => {
                                                    const next = !inlineShowDueDate;
                                                    setInlineShowDueDate(next);
                                                    if (next && !inlineDueDate) {
                                                        const d = new Date();
                                                        const dateStr = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
                                                        setInlineDueDate(`${dateStr}T08:00`);
                                                    }
                                                }}
                                                className={`p-2 rounded-full transition-colors ${inlineDueDate ? 'bg-amber-100 text-amber-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`} 
                                                title="Recordatorio"
                                            >
                                                <Bell size={18} />
                                            </button>
                                            {inlineShowDueDate && (
                                                <div className="absolute top-full mt-1 left-0 bg-white border border-slate-200 rounded-xl shadow-lg p-2 z-[100] flex flex-col gap-2">
                                                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Fecha y hora</label>
                                                    <input 
                                                        type="datetime-local" 
                                                        className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-indigo-500"
                                                        value={inlineDueDate}
                                                        onChange={(e) => setInlineDueDate(e.target.value)}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            onClick={toggleInlineChecklist}
                                            className={`p-2 rounded-full transition-colors ${inlineShowChecklist ? 'bg-slate-200 text-slate-800' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
                                            title="Lista de tareas"
                                        >
                                            <CheckSquare size={18} />
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => { setIsExpanding(false); setInlineTitle(''); setInlineChecklist([]); setInlineShowChecklist(false); setInlineShowFormat(false); setInlineIsPinned(false); if (inlineContentRef.current) inlineContentRef.current.innerHTML = ''; }}
                                            className="px-4 py-1.5 text-[13px] text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            onClick={() => handleInlineSave(true)}
                                            disabled={saving}
                                            className="flex items-center gap-1.5 px-5 py-1.5 text-[13px] font-bold bg-slate-900 text-white rounded-xl hover:bg-slate-700 transition-colors disabled:opacity-60"
                                        >
                                            {saving ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Save size={14} />}
                                            Guardar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── NOTES GRID ── */}
                <div className="px-4 max-w-7xl mx-auto space-y-8">

                    {pinned.length > 0 && (
                        <section>
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 mb-3 px-1">Fijadas</p>
                            <div className={gridClass}>
                                {pinned.map(note => (
                                    <NoteCard key={note.id} note={note}
                                        onEdit={() => openEdit(note)}
                                        onDelete={() => deleteBoardNote(note.id)}
                                        onTogglePin={() => togglePin(note)}
                                    />
                                ))}
                            </div>
                        </section>
                    )}

                    {unpinned.length > 0 && (
                        <section>
                            {pinned.length > 0 && <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 mb-3 px-1">Otras</p>}
                            <div className={gridClass}>
                                {unpinned.map(note => (
                                    <NoteCard key={note.id} note={note}
                                        onEdit={() => openEdit(note)}
                                        onDelete={() => deleteBoardNote(note.id)}
                                        onTogglePin={() => togglePin(note)}
                                    />
                                ))}
                            </div>
                        </section>
                    )}

                    {filtered.length === 0 && !isExpanding && (
                        <div className="flex flex-col items-center justify-center py-40 select-none">
                            <div className="w-28 h-28 bg-slate-50 rounded-full flex items-center justify-center mb-5">
                                <StickyNote size={90} strokeWidth={1} className="text-slate-200" />
                            </div>
                            <p className="text-[18px] font-semibold text-slate-300">Aquí aparecerán las notas</p>
                        </div>
                    )}
                </div>
            </main>

            {/* ── MODAL EDITOR ── */}
            {editingNote && (
                <div
                    className="fixed inset-0 bg-black/10 backdrop-blur-[2px] z-[200] flex items-center justify-center p-6 animate-in fade-in duration-150"
                    // Eliminado el onClick para evitar cierres accidentales al hacer clic fuera
                >
                    <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col animate-in zoom-in-95 duration-150">
                        <div className="p-5 pb-3 space-y-3">
                            {/* Title + pin */}
                            <div className="flex items-center justify-between gap-2">
                                <input
                                    type="text"
                                    placeholder="Título"
                                    autoFocus
                                    className="flex-1 bg-transparent text-[17px] font-bold text-slate-800 placeholder:text-slate-300 focus:outline-none"
                                    value={editTitle}
                                    onChange={e => setEditTitle(e.target.value)}
                                />
                                <button
                                    onClick={() => setEditIsPinned(v => !v)}
                                    className={`p-1.5 rounded-full flex-shrink-0 transition-all ${editIsPinned ? 'text-slate-800' : 'text-slate-300 hover:text-slate-600'}`}
                                >
                                    <Pin size={18} className={editIsPinned ? 'fill-slate-800' : ''} />
                                </button>
                            </div>

                            {/* Rich text editor */}
                            <div
                                ref={editContentRef}
                                contentEditable
                                placeholder="Escribe algo..."
                                className="note-content min-h-[120px] max-h-[40vh] overflow-y-auto text-[14px] text-slate-700 focus:outline-none leading-relaxed custom-scrollbar"
                            />

                            {/* Checklist section (hybrid) */}
                            {editShowChecklist && (
                                <ChecklistEditor
                                    items={editChecklist}
                                    onChange={setEditChecklist}
                                    autoFocusLast={false}
                                />
                            )}

                            {editShowFormat && <FormatBar />}
                        </div>

                        {/* Footer */}
                        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-0.5">
                                <button
                                    onClick={() => setEditShowFormat(v => !v)}
                                    className={`p-2 rounded-full transition-colors ${editShowFormat ? 'bg-slate-200 text-slate-800' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
                                    title="Formato"
                                >
                                    <TypeIcon size={17} />
                                </button>
                                <div className="relative flex items-center">
                                            <button 
                                                onClick={() => {
                                                    const next = !editShowDueDate;
                                                    setEditShowDueDate(next);
                                                    if (next && !editDueDate) {
                                                        const d = new Date();
                                                        const dateStr = d.toLocaleDateString('en-CA');
                                                        setEditDueDate(`${dateStr}T08:00`);
                                                    }
                                                }}
                                                className={`p-2 rounded-full transition-colors ${editDueDate ? 'bg-amber-100 text-amber-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`} 
                                                title="Recordatorio"
                                            >
                                                <Bell size={17} />
                                            </button>
                                            {editShowDueDate && (
                                                <div className="absolute bottom-full mb-1 left-0 bg-white border border-slate-200 rounded-xl shadow-lg p-2 z-[100] flex flex-col gap-2">
                                                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Fecha y hora</label>
                                                    <input 
                                                        type="datetime-local" 
                                                        className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-indigo-500"
                                                        value={editDueDate}
                                                        onChange={(e) => setEditDueDate(e.target.value)}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                <button
                                    onClick={toggleEditChecklist}
                                    className={`p-2 rounded-full transition-colors ${editShowChecklist ? 'bg-slate-200 text-slate-800' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
                                    title="Lista de tareas"
                                >
                                    <CheckSquare size={17} />
                                </button>
                            </div>

                            {/* Save + Close */}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setEditingNote(null)}
                                    className="px-4 py-1.5 text-[13px] text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"
                                >
                                    Cerrar
                                </button>
                                <button
                                    onClick={saveModal}
                                    disabled={saving}
                                    className="flex items-center gap-1.5 px-5 py-1.5 text-[13px] font-bold bg-slate-900 text-white rounded-xl hover:bg-slate-700 transition-colors disabled:opacity-60"
                                >
                                    {saving
                                        ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                        : <Save size={14} />}
                                    Guardar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotesPage;
