import React, { useState, useEffect } from 'react';
import {
    collection,
    addDoc,
    query,
    where,
    onSnapshot,
    orderBy,
    Timestamp,
    updateDoc,
    deleteDoc,
    doc
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { Reminder } from '../types';
import {
    Bell,
    Calendar,
    CheckCircle2,
    Plus,
    Clock,
    ArrowLeft,
    Loader2,
    Inbox,
    Pencil,
    Trash2,
    X,
    AlertCircle
} from 'lucide-react';

interface RemindersModuleProps {
    onBack: () => void;
}

const RemindersModule: React.FC<RemindersModuleProps> = ({ onBack }) => {
    const { currentUser, showNotification } = useAppStore();
    const [reminders, setReminders] = useState<Reminder[]>([]);
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    // Form states
    const [text, setText] = useState('');
    const [description, setDescription] = useState('');
    const [dueDate, setDueDate] = useState('');

    useEffect(() => {
        if (!currentUser) return;

        // Query for all pending reminders for this user
        const q = query(
            collection(db, 'reminders'),
            where('userId', '==', currentUser.uid),
            where('completed', '==', false),
            orderBy('dueDate', 'asc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const docs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Reminder[];
            setReminders(docs);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching reminders:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [currentUser]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!text || !dueDate || !currentUser) {
            showNotification("Por favor completa todos los campos.", "warning");
            return;
        }

        setIsSubmitting(true);
        try {
            // Create date from string (YYYY-MM-DD)
            const [year, month, day] = dueDate.split('-').map(Number);
            const expiryDate = new Date(year, month - 1, day, 12, 0, 0); // Noon

            if (editingId) {
                await updateDoc(doc(db, 'reminders', editingId), {
                    text,
                    description,
                    dueDate: Timestamp.fromDate(expiryDate)
                });
                showNotification("Recordatorio actualizado.", "success");
            } else {
                await addDoc(collection(db, 'reminders'), {
                    text,
                    description,
                    dueDate: Timestamp.fromDate(expiryDate),
                    completed: false,
                    userId: currentUser.uid,
                    createdAt: Timestamp.now()
                });
                showNotification("Recordatorio guardado.", "success");
            }

            setText('');
            setDescription('');
            setDueDate('');
            setEditingId(null);
        } catch (error) {
            console.error("Error saving reminder:", error);
            showNotification("Error al guardar.", "error");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleEdit = (reminder: Reminder) => {
        setEditingId(reminder.id);
        setText(reminder.text);
        setDescription(reminder.description || '');
        // Format date for input: YYYY-MM-DD
        const date = reminder.dueDate.toDate();
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        setDueDate(`${y}-${m}-${d}`);
        // Scroll to form on mobile
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (id: string) => {
        if (!confirm('¿Estás seguro de eliminar este recordatorio?')) return;
        try {
            await deleteDoc(doc(db, 'reminders', id));
            showNotification("Recordatorio eliminado.", "info");
        } catch (error) {
            console.error("Error deleting reminder:", error);
            showNotification("Error al eliminar.", "error");
        }
    };

    const cancelEdit = () => {
        setEditingId(null);
        setText('');
        setDescription('');
        setDueDate('');
    };

    const toggleComplete = async (reminder: Reminder) => {
        try {
            await updateDoc(doc(db, 'reminders', reminder.id), {
                completed: true
            });
            showNotification("Tarea completada.", "info");
        } catch (error) {
            console.error("Error updating reminder:", error);
        }
    };

    const getUrgencyStyles = (timestamp: any) => {
        if (!timestamp) return 'bg-slate-50 border-slate-200';

        const date = timestamp.toDate();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const diffTime = date.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
            return 'bg-rose-50 border-rose-100 text-rose-700'; // Overdue
        } else if (diffDays <= 7) {
            return 'bg-red-50 border-red-100 text-red-700';
        } else if (diffDays <= 14) {
            return 'bg-amber-50 border-amber-100 text-amber-700';
        }
        return 'bg-slate-50 border-slate-200 text-slate-700';
    };

    const formatDate = (timestamp: any) => {
        if (!timestamp) return '';
        const date = timestamp.toDate();
        return new Intl.DateTimeFormat('es-CL', {
            day: 'numeric',
            month: 'long'
        }).format(date);
    };

    return (
        <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-8 max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-4">
                <button
                    onClick={onBack}
                    className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h2 className="text-xl font-bold text-slate-800">Tareas con Recordatorio</h2>
                    <p className="text-sm text-slate-500">Gestión simple de pendientes con vencimiento</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* Formulario de Registro */}
                <section className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4 h-fit">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                                {editingId ? <Pencil size={18} /> : <Plus size={18} />}
                            </div>
                            <h3 className="font-semibold text-slate-800">
                                {editingId ? 'Editar Tarea' : 'Nueva Tarea'}
                            </h3>
                        </div>
                        {editingId && (
                            <button
                                onClick={cancelEdit}
                                className="text-xs font-bold text-slate-400 hover:text-rose-500 flex items-center gap-1"
                            >
                                <X size={14} /> Cancelar edición
                            </button>
                        )}
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">
                                ¿Qué hay que hacer?
                            </label>
                            <input
                                type="text"
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                placeholder="Ej: Renovar credencial OS10..."
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                required
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">
                                Descripción (Opcional)
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Detalles adicionales de la tarea..."
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all resize-none h-24"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">
                                Fecha de Vencimiento
                            </label>
                            <div className="relative">
                                <Calendar className="absolute left-4 top-3.5 text-slate-400" size={18} />
                                <input
                                    type="date"
                                    value={dueDate}
                                    onChange={(e) => setDueDate(e.target.value)}
                                    className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                    required
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className={`w-full py-3 ${editingId ? 'bg-blue-600' : 'bg-slate-900'} hover:opacity-90 text-white rounded-xl font-semibold shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50`}
                        >
                            {isSubmitting ? (
                                <Loader2 className="animate-spin" size={20} />
                            ) : (
                                editingId ? <CheckCircle2 size={18} /> : <Plus size={18} />
                            )}
                            {editingId ? 'Actualizar Cambios' : 'Guardar Recordatorio'}
                        </button>
                    </form>
                </section>

                {/* Dashboard de Alertas */}
                <section className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4 min-h-[400px]">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-amber-50 rounded-lg text-amber-600">
                                <Bell size={18} />
                            </div>
                            <h3 className="font-semibold text-slate-800">Tareas Pendientes</h3>
                        </div>
                        <span className="text-xs font-medium px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full">
                            {reminders.length} Pendientes
                        </span>
                    </div>

                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                            <Loader2 className="animate-spin mb-2" size={32} />
                            <p className="text-sm">Cargando...</p>
                        </div>
                    ) : reminders.length > 0 ? (
                        <div className="space-y-8 h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                            {(() => {
                                const now = new Date();
                                now.setHours(0, 0, 0, 0);
                                const endOfWeek = new Date(now);
                                endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
                                endOfWeek.setHours(23, 59, 59, 999);
                                const endOfNextWeek = new Date(endOfWeek);
                                endOfNextWeek.setDate(endOfNextWeek.getDate() + 7);

                                const groups = reminders.reduce((acc, rem) => {
                                    const date = rem.dueDate.toDate();
                                    if (date < now) acc.overdue.push(rem);
                                    else if (date <= endOfWeek) acc.thisWeek.push(rem);
                                    else if (date <= endOfNextWeek) acc.nextWeek.push(rem);
                                    else acc.later.push(rem);
                                    return acc;
                                }, { overdue: [] as Reminder[], thisWeek: [] as Reminder[], nextWeek: [] as Reminder[], later: [] as Reminder[] });

                                return [
                                    { label: 'TAREAS VENCIDAS', list: groups.overdue, color: 'text-rose-600', icon: AlertCircle },
                                    { label: 'ESTA SEMANA', list: groups.thisWeek, color: 'text-red-600', icon: Clock },
                                    { label: 'PRÓXIMA SEMANA', list: groups.nextWeek, color: 'text-orange-600', icon: Calendar },
                                    { label: 'MÁS ADELANTE', list: groups.later, color: 'text-slate-500', icon: Bell }
                                ].map((group) => group.list.length > 0 && (
                                    <div key={group.label} className="space-y-3">
                                        <h4 className={`text-[10px] font-black uppercase tracking-[0.2em] ${group.color} flex items-center gap-2`}>
                                            <group.icon size={12} />
                                            {group.label}
                                        </h4>
                                        {group.list.map((reminder) => (
                                            <div
                                                key={reminder.id}
                                                className={`p-4 rounded-xl border flex items-center justify-between group transition-all hover:translate-x-1 ${getUrgencyStyles(reminder.dueDate)}`}
                                            >
                                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                                    <button
                                                        onClick={() => toggleComplete(reminder)}
                                                        className="p-1.5 rounded-full hover:bg-white/50 transition-colors shrink-0"
                                                        title="Completar"
                                                    >
                                                        <CheckCircle2 size={20} className="text-current opacity-40 group-hover:opacity-100 transition-opacity" />
                                                    </button>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="font-bold leading-tight truncate">{reminder.text}</p>
                                                        {reminder.description && (
                                                            <p className="text-[11px] mt-1 opacity-80 line-clamp-2">{reminder.description}</p>
                                                        )}
                                                        <div className="flex items-center gap-1.5 mt-2 opacity-70">
                                                            <Clock size={12} />
                                                            <span className="text-[10px] font-bold uppercase tracking-tighter">Vence el {formatDate(reminder.dueDate)}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => handleEdit(reminder)}
                                                        className="p-2 text-slate-500 hover:text-blue-600 hover:bg-white/80 rounded-lg transition-all"
                                                        title="Editar"
                                                    >
                                                        <Pencil size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(reminder.id)}
                                                        className="p-2 text-slate-500 hover:text-rose-600 hover:bg-white/80 rounded-lg transition-all"
                                                        title="Eliminar"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ));
                            })()}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-700">
                            <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mb-4">
                                <Inbox size={32} />
                            </div>
                            <h4 className="text-slate-800 font-bold">Todo bajo control</h4>
                            <p className="text-sm text-slate-500 mt-1 max-w-[200px]">
                                No hay tareas pendientes en este momento.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};

export default RemindersModule;
