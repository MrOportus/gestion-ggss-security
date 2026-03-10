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
    Inbox
} from 'lucide-react';

interface RemindersModuleProps {
    onBack: () => void;
}

const RemindersModule: React.FC<RemindersModuleProps> = ({ onBack }) => {
    const { currentUser, showNotification } = useAppStore();
    const [reminders, setReminders] = useState<Reminder[]>([]);
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form states
    const [text, setText] = useState('');
    const [dueDate, setDueDate] = useState('');

    useEffect(() => {
        if (!currentUser) return;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const next14Days = new Date();
        next14Days.setDate(today.getDate() + 14);
        next14Days.setHours(23, 59, 59, 999);

        // Query for reminders in the next 14 days
        const q = query(
            collection(db, 'reminders'),
            where('userId', '==', currentUser.uid),
            where('completed', '==', false),
            where('dueDate', '>=', Timestamp.fromDate(today)),
            where('dueDate', '<=', Timestamp.fromDate(next14Days)),
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
            const expiryDate = new Date(year, month - 1, day, 12, 0, 0); // Noon to avoid timezone issues

            await addDoc(collection(db, 'reminders'), {
                text,
                dueDate: Timestamp.fromDate(expiryDate),
                completed: false,
                userId: currentUser.uid,
                createdAt: Timestamp.now()
            });

            setText('');
            setDueDate('');
            showNotification("Recordatorio guardado correctamente.", "success");
        } catch (error) {
            console.error("Error adding reminder:", error);
            showNotification("Error al guardar el recordatorio.", "error");
        } finally {
            setIsSubmitting(false);
        }
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

        if (diffDays < 7) {
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
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                            <Plus size={18} />
                        </div>
                        <h3 className="font-semibold text-slate-800">Nueva Tarea</h3>
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
                            className="w-full py-3 bg-slate-900 hover:bg-black text-white rounded-xl font-semibold shadow-lg shadow-slate-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={18} />}
                            Guardar Recordatorio
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
                            <h3 className="font-semibold text-slate-800">Próximos Vencimientos</h3>
                        </div>
                        <span className="text-xs font-medium px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full">
                            Próximas 2 semanas
                        </span>
                    </div>

                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                            <Loader2 className="animate-spin mb-2" size={32} />
                            <p className="text-sm">Cargando...</p>
                        </div>
                    ) : reminders.length > 0 ? (
                        <div className="space-y-3">
                            {reminders.map((reminder) => (
                                <div
                                    key={reminder.id}
                                    className={`p-4 rounded-xl border flex items-center justify-between group transition-all hover:translate-x-1 ${getUrgencyStyles(reminder.dueDate)}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => toggleComplete(reminder)}
                                            className="p-1.5 rounded-full hover:bg-white/50 transition-colors"
                                        >
                                            <CheckCircle2 size={20} className="text-current opacity-40 group-hover:opacity-100 transition-opacity" />
                                        </button>
                                        <div>
                                            <p className="font-medium leading-tight">{reminder.text}</p>
                                            <div className="flex items-center gap-1.5 mt-1 opacity-70">
                                                <Clock size={12} />
                                                <span className="text-xs">Vence el {formatDate(reminder.dueDate)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-700">
                            <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mb-4">
                                <Inbox size={32} />
                            </div>
                            <h4 className="text-slate-800 font-bold">Todo bajo control</h4>
                            <p className="text-sm text-slate-500 mt-1 max-w-[200px]">
                                No hay tareas pendientes por las próximas 2 semanas.
                            </p>
                            <div className="mt-4 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold">
                                ¡Paz mental total! ✨
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};

export default RemindersModule;
