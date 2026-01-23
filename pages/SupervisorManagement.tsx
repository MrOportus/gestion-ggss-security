
import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
    ClipboardList, Plus, Trash2, Clock,
    User, MapPin, ListPlus, X,
    RefreshCw, CheckSquare, FileText,
    Calendar, ArrowLeft, MoreVertical
} from 'lucide-react';
import { SupervisorTask, ChecklistTemplate } from '../types';

const SupervisorManagement: React.FC = () => {
    const {
        currentUser, employees, sites, supervisorTasks, checklistTemplates,
        addSupervisorTask, deleteSupervisorTask, addChecklistTemplate, deleteChecklistTemplate,
        resignationRequests, updateResignationRequestStatus, deleteResignationRequest,
        recurringSupervisorTasks, addRecurringTask, deleteRecurringTask, toggleRecurringTask,
        supervisorSubTasks, addSupervisorSubTask, deleteSupervisorSubTask,
        showNotification
    } = useAppStore();

    const [view, setView] = useState<'menu' | 'assignments' | 'subtasks' | 'recurring' | 'resignations' | 'templates'>('menu');
    const [showNewTask, setShowNewTask] = useState(false);
    const [showNewTemplate, setShowNewTemplate] = useState(false);
    const [showNewRecurring, setShowNewRecurring] = useState(false);
    const [showNewSubTask, setShowNewSubTask] = useState(false);

    // Form States
    const [selectedSupervisor, setSelectedSupervisor] = useState('');
    const [selectedSite, setSelectedSite] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState('');
    const [templateTitle, setTemplateTitle] = useState('');
    const [templateItems, setTemplateItems] = useState<string[]>(['']);
    const [recurringFreq, setRecurringFreq] = useState<'DIARIO' | 'SEMANAL' | 'MENSUAL'>('DIARIO');
    const [subTaskTitle, setSubTaskTitle] = useState('');
    const [subTaskDesc, setSubTaskDesc] = useState('');
    const [subTaskDue, setSubTaskDue] = useState('');

    const supervisors = employees.filter(e => e.role === 'supervisor' || e.role === 'admin');

    const sendPushNotification = async (supervisorId: string, title: string, body: string) => {
        const supervisor = employees.find(e => e.id === supervisorId);
        if (!supervisor || !supervisor.fcmTokens || supervisor.fcmTokens.length === 0) return;

        // Nota: En producción esto debería hacerse vía Cloud Functions por seguridad.
        // Aquí implementamos la llamada directa para demostración.
        for (const token of supervisor.fcmTokens) {
            try {
                // FCM Legacy API (requiere Server Key) o FCM v1 (requiere OAuth2)
                // Usaremos un log para demostrar la intención y la lógica de envío.
                console.log(`Enviando notificación a ${supervisor.firstName}: "${title} - ${body}" al token ${token}`);

                // Opcional: Llamada a un webhook o Cloud Function
                /*
                await fetch('https://your-api.com/send-notification', {
                    method: 'POST',
                    body: JSON.stringify({ token, title, body })
                });
                */
            } catch (error) {
                console.error("Error al enviar notificación push:", error);
            }
        }
    };

    const handleCreateTask = async () => {
        if (!selectedSupervisor || !selectedSite || !selectedTemplate) {
            showNotification("Complete todos los campos", "warning");
            return;
        }
        const s = employees.find(e => e.id === selectedSupervisor);
        const st = sites.find(site => String(site.id) === selectedSite);
        const t = checklistTemplates.find(temp => temp.id === selectedTemplate);
        if (!s || !st || !t) return;

        await addSupervisorTask({
            supervisorId: s.id,
            supervisorName: `${s.firstName} ${s.lastNamePaterno}`,
            siteId: st.id,
            siteName: st.name,
            checklistType: t.title,
            items: t.items.map(i => ({ ...i, value: null })),
            createdBy: currentUser?.uid || 'admin'
        });

        // Disparar Notificación
        await sendPushNotification(
            s.id,
            "Nueva Tarea Asignada",
            `Se te ha asignado una supervision en ${st.name}`
        );

        showNotification("Tarea asignada", "success");
        setShowNewTask(false);
    };

    const handleCreateTemplate = async () => {
        if (!templateTitle || templateItems.some(i => !i.trim())) {
            showNotification("Título y preguntas son obligatorias", "warning");
            return;
        }
        await addChecklistTemplate({
            title: templateTitle,
            items: templateItems.map((q, idx) => ({ id: `q_${idx}_${Date.now()}`, question: q, type: 'binary' }))
        });
        showNotification("Plantilla creada", "success");
        setShowNewTemplate(false);
        setTemplateTitle(''); setTemplateItems(['']);
    };

    const handleCreateRecurring = async () => {
        if (!selectedSupervisor || !selectedSite || !selectedTemplate) {
            showNotification("Complete todos los campos", "warning");
            return;
        }
        const s = employees.find(e => e.id === selectedSupervisor);
        const st = sites.find(site => String(site.id) === selectedSite);
        const t = checklistTemplates.find(temp => temp.id === selectedTemplate);
        if (!s || !st || !t) return;

        await addRecurringTask({
            supervisorId: s.id,
            supervisorName: `${s.firstName} ${s.lastNamePaterno}`,
            siteId: st.id,
            siteName: st.name,
            checklistType: t.title,
            frequency: recurringFreq,
            active: true
        });
        showNotification("Tarea recurrente programada", "success");
        setShowNewRecurring(false);
    };

    const handleCreateSubTask = async () => {
        if (!selectedSupervisor || !subTaskTitle) {
            showNotification("Supervisor y título obligatorios", "warning");
            return;
        }
        const s = employees.find(e => e.id === selectedSupervisor);
        if (!s) return;

        await addSupervisorSubTask({
            supervisorId: s.id,
            supervisorName: `${s.firstName} ${s.lastNamePaterno}`,
            title: subTaskTitle,
            description: subTaskDesc,
            status: 'NOT_DONE',
            dueDate: subTaskDue
        });
        showNotification("Sub-tarea creada", "success");
        setShowNewSubTask(false);
        setSubTaskTitle(''); setSubTaskDesc(''); setSubTaskDue('');
    };

    const menuItems = [
        {
            id: 'assignments',
            title: 'Supervisión de Sucursal',
            desc: 'Checklists de supervisión asignados por administración.',
            icon: <ClipboardList size={22} />,
            color: 'text-blue-500',
            bg: 'bg-blue-50'
        },
        {
            id: 'resignations',
            title: 'Informar Renuncia',
            desc: 'Reportar renuncia de un trabajador con documentos adjuntos.',
            icon: <X size={22} />,
            color: 'text-rose-500',
            bg: 'bg-rose-50'
        },
        {
            id: 'subtasks',
            title: 'Sub Tareas',
            desc: 'Requerimientos específicos y pendientes para supervisores.',
            icon: <CheckSquare size={22} />,
            color: 'text-emerald-500',
            bg: 'bg-emerald-50'
        },
        {
            id: 'recurring',
            title: 'Tareas Recurrentes',
            desc: 'Automatización y programación de checklists periódicos.',
            icon: <RefreshCw size={22} />,
            color: 'text-amber-500',
            bg: 'bg-amber-50'
        },
        {
            id: 'templates',
            title: 'Plantillas Checklist',
            desc: 'Diseño y edición de formularios de control.',
            icon: <ListPlus size={22} />,
            color: 'text-indigo-500',
            bg: 'bg-indigo-50'
        },
        {
            id: 'coming_soon_1',
            title: 'Responder Solicitud',
            desc: 'Próximamente...',
            icon: <MoreVertical size={22} />,
            color: 'text-slate-300',
            bg: 'bg-slate-50',
            disabled: true
        },
        {
            id: 'coming_soon_2',
            title: 'Bitácora Diaria',
            desc: 'Próximamente...',
            icon: <Clock size={22} />,
            color: 'text-slate-300',
            bg: 'bg-slate-50',
            disabled: true
        }
    ];

    if (view === 'menu') {
        return (
            <div className="p-12 max-w-7xl mx-auto space-y-12 animate-in fade-in duration-700">
                <div className="space-y-2">
                    <h1 className="text-4xl font-black text-slate-900 tracking-tight">Gestión de Supervisores</h1>
                    <p className="text-slate-500 text-lg font-medium">Panel de administración y control operativo</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {menuItems.map((item) => (
                        <button
                            key={item.id}
                            disabled={item.disabled}
                            onClick={() => setView(item.id as any)}
                            className={`flex flex-col text-left p-8 bg-white rounded-[32px] border border-slate-100 shadow-sm transition-all duration-300 ${item.disabled ? 'opacity-60 grayscale cursor-not-allowed' : 'hover:shadow-2xl hover:-translate-y-1 hover:border-blue-200 group'}`}
                        >
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 shadow-sm transition-transform group-hover:scale-110 ${item.bg} ${item.color}`}>
                                {item.icon}
                            </div>
                            <h3 className="text-lg font-black text-slate-800 mb-2 leading-tight">
                                {item.title}
                            </h3>
                            <p className="text-xs text-slate-400 font-bold leading-relaxed line-clamp-2">
                                {item.desc}
                            </p>
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-500">
            {/* Header with Back Button */}
            <div className="flex items-center gap-6">
                <button
                    onClick={() => setView('menu')}
                    className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                        {menuItems.find(i => i.id === view)?.title}
                    </h2>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Gestión Supervisores</p>
                </div>
            </div>

            {/* SECTIONS CONTENT */}
            {view === 'assignments' && (
                <div className="space-y-8">
                    <div className="flex justify-between items-center">
                        <div className="max-w-md">
                            <p className="text-slate-500 font-medium">Supervisiones activas y controles programados en tiempo real.</p>
                        </div>
                        <button onClick={() => setShowNewTask(true)} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-blue-100 hover:bg-blue-700 transition">
                            <Plus size={18} /> Nueva Asignación
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {supervisorTasks.map(task => (
                            <div key={task.id} className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl flex flex-col justify-between group">
                                <div className="flex justify-between items-start mb-6">
                                    <div className={`p-4 rounded-2xl ${task.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600 animate-pulse'}`}>
                                        <ClipboardList size={24} />
                                    </div>
                                    <div className="flex flex-col items-end gap-2">
                                        <button onClick={() => deleteSupervisorTask(task.id)} className="text-slate-300 hover:text-rose-500 transition">
                                            <Trash2 size={16} />
                                        </button>
                                        <div className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${task.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                                            {task.status === 'COMPLETED' ? 'Finalizada' : 'Activa'}
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <h3 className="text-lg font-black text-slate-800 tracking-tight leading-tight">{task.checklistType}</h3>
                                    <div className="flex flex-wrap gap-2 font-bold text-[10px] uppercase tracking-widest">
                                        <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg flex items-center gap-1.5"><MapPin size={10} /> {task.siteName}</span>
                                        <span className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg flex items-center gap-1.5"><Calendar size={10} /> {new Date(task.createdAt).toLocaleDateString()}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-slate-500 font-bold"><User size={14} /> {task.supervisorName}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {view === 'resignations' && (
                <div className="bg-white rounded-[32px] border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in duration-500">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50/50 border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                <tr>
                                    <th className="px-8 py-6">Colaborador</th>
                                    <th className="px-8 py-6">Fechas Clave</th>
                                    <th className="px-8 py-6">Plazo Límite</th>
                                    <th className="px-8 py-6">Estado Gestión</th>
                                    <th className="px-8 py-6 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {resignationRequests.map(req => {
                                    const resignationDate = new Date(req.resignationDate);
                                    const today = new Date();
                                    const diffDays = Math.floor((today.getTime() - resignationDate.getTime()) / (1000 * 60 * 60 * 24));
                                    const daysRemaining = 10 - diffDays;
                                    const isUrgent = daysRemaining <= 1;

                                    const statusMap: Record<string, { bg: string, text: string, label: string }> = {
                                        'NEW': { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Nueva' },
                                        'REQUESTED_TO_ACCOUNTANT': { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Contadora' },
                                        'ENTERED_TO_DT': { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Ingresado DT' },
                                        'REJECTED_BY_DT': { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Rechazado DT' }
                                    };
                                    const st = statusMap[req.status] || statusMap['NEW'];

                                    return (
                                        <tr key={req.id} className="hover:bg-slate-50/50 transition group">
                                            <td className="px-8 py-6">
                                                <div className="font-bold text-slate-800 text-sm">{req.workerName}</div>
                                                <div className="text-[10px] text-slate-400 font-bold uppercase mt-1 flex items-center gap-1"><User size={10} /> {req.supervisorName}</div>
                                            </td>
                                            <td className="px-8 py-6 text-xs font-medium space-y-1">
                                                <div className="flex items-center gap-2"><Calendar size={12} className="text-slate-400" /> {new Date(req.resignationDate).toLocaleDateString()} (Aviso)</div>
                                                <div className="flex items-center gap-2"><Clock size={12} className="text-slate-400" /> {new Date(req.effectiveDate).toLocaleDateString()} (Fin)</div>
                                            </td>
                                            <td className="px-8 py-6">
                                                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{daysRemaining > 0 ? `${daysRemaining} días` : 'Vencido'}</div>
                                                <div className="w-24 bg-slate-100 h-1 rounded-full overflow-hidden"><div className={`h-full ${isUrgent ? 'bg-rose-500' : 'bg-blue-500'}`} style={{ width: `${Math.max(0, Math.min(100, (diffDays / 10) * 100))}%` }} /></div>
                                            </td>
                                            <td className="px-8 py-6">
                                                <select className={`text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl border-none ring-1 ring-slate-100 focus:ring-2 focus:ring-blue-500 ${st.bg} ${st.text}`} value={req.status} onChange={(e) => updateResignationRequestStatus(req.id, e.target.value as any)}>
                                                    <option value="NEW">Nueva</option>
                                                    <option value="REQUESTED_TO_ACCOUNTANT">Solicitado Contadora</option>
                                                    <option value="ENTERED_TO_DT">Ingresado DT</option>
                                                    <option value="REJECTED_BY_DT">Rechazado DT</option>
                                                </select>
                                            </td>
                                            <td className="px-8 py-6 text-right">
                                                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {req.attachments && req.attachments.length > 0 && (
                                                        <button onClick={() => req.attachments?.forEach(u => window.open(u, '_blank'))} className="p-2 bg-blue-50 text-blue-500 rounded-xl"><ListPlus size={16} /></button>
                                                    )}
                                                    <button onClick={() => deleteResignationRequest(req.id)} className="p-2 bg-rose-50 text-rose-500 rounded-xl"><Trash2 size={16} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {view === 'subtasks' && (
                <div className="space-y-8 animate-in fade-in duration-500">
                    <div className="flex justify-between items-center">
                        <div>
                            <p className="text-slate-500 font-medium">Tareas puntuales y requerimientos de insumos o personal.</p>
                        </div>
                        <button onClick={() => setShowNewSubTask(true)} className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition">
                            <Plus size={18} /> Crear Sub-Tarea
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {supervisorSubTasks.map(sub => (
                            <div key={sub.id} className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl relative overflow-hidden group">
                                <div className={`absolute top-0 right-0 w-1.5 h-full ${sub.status === 'DONE' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                <div className="flex justify-between items-start mb-4">
                                    <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-600"><CheckSquare size={20} /></div>
                                    <button onClick={() => deleteSupervisorSubTask(sub.id)} className="text-slate-300 hover:text-rose-500 transition"><Trash2 size={16} /></button>
                                </div>
                                <h3 className="font-bold text-slate-800">{sub.title}</h3>
                                <p className="text-xs text-slate-500 mt-1">{sub.description}</p>
                                <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400 mt-4"><User size={10} /> {sub.supervisorName}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {view === 'recurring' && (
                <div className="space-y-8 animate-in fade-in duration-500">
                    <div className="flex justify-between items-center">
                        <div>
                            <p className="text-slate-500 font-medium">Programación automática de checklists diarios, semanales o mensuales.</p>
                        </div>
                        <button onClick={() => setShowNewRecurring(true)} className="flex items-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-amber-100 hover:bg-amber-700 transition">
                            <RefreshCw size={18} /> Programar Tarea
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {recurringSupervisorTasks.map(rec => (
                            <div key={rec.id} className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl group">
                                <div className="flex justify-between items-start mb-6">
                                    <div className="p-3 bg-amber-50 rounded-2xl text-amber-600"><RefreshCw size={24} className={rec.active ? 'animate-spin-slow' : ''} /></div>
                                    <div className="flex flex-col items-end gap-2">
                                        <button onClick={() => deleteRecurringTask(rec.id)} className="text-slate-300 hover:text-rose-500 transition"><Trash2 size={16} /></button>
                                        <input type="checkbox" checked={rec.active} onChange={(e) => toggleRecurringTask(rec.id, e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-amber-600" />
                                    </div>
                                </div>
                                <h3 className="text-lg font-black text-slate-800 tracking-tight leading-tight mb-4">{rec.checklistType}</h3>
                                <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase">
                                    <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg">{rec.frequency}</span>
                                    <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded-lg">{rec.siteName}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {view === 'templates' && (
                <div className="space-y-8 animate-in fade-in duration-500">
                    <div className="flex justify-between items-center">
                        <div>
                            <p className="text-slate-500 font-medium">Configuración de formularios y puntos de control operativos.</p>
                        </div>
                        <button onClick={() => setShowNewTemplate(true)} className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition">
                            <ListPlus size={18} /> Nueva Plantilla
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {checklistTemplates.map(t => (
                            <div key={t.id} className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl flex flex-col group">
                                <div className="flex justify-between items-start mb-6">
                                    <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-600"><FileText size={24} /></div>
                                    <button onClick={() => deleteChecklistTemplate(t.id)} className="text-slate-300 hover:text-rose-500 transition"><Trash2 size={16} /></button>
                                </div>
                                <h3 className="text-lg font-black text-slate-800 mb-4 tracking-tight leading-tight">{t.title}</h3>
                                <div className="space-y-2 flex-1">
                                    {t.items.map((it, idx) => (
                                        <div key={it.id} className="text-xs text-slate-500 font-medium flex gap-2"><span className="text-indigo-300">0{idx + 1}</span> {it.question}</div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* MODALS (Keep existing logic but apply new grid card styles if needed, though they were mostly functional) */}
            {showNewTask && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-300">
                    <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
                        <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                            <h3 className="text-xl font-black text-slate-800 tracking-tight uppercase">Nueva Asignación</h3>
                            <button onClick={() => setShowNewTask(false)} className="p-2 hover:bg-slate-100 rounded-xl transition"><X size={24} className="text-slate-400" /></button>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Supervisor</label>
                                <select className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-blue-50 transition-all font-bold" value={selectedSupervisor} onChange={(e) => setSelectedSupervisor(e.target.value)}>
                                    <option value="">Seleccionar...</option>
                                    {supervisors.map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastNamePaterno}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Sucursal</label>
                                <select className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-blue-50 transition-all font-bold" value={selectedSite} onChange={(e) => setSelectedSite(e.target.value)}>
                                    <option value="">Seleccionar...</option>
                                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Plantilla Checklist</label>
                                <select className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-blue-50 transition-all font-bold" value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)}>
                                    <option value="">Seleccionar...</option>
                                    {checklistTemplates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
                            <button onClick={handleCreateTask} className="flex-1 py-4 bg-blue-600 text-white font-black uppercase text-xs tracking-widest rounded-3xl shadow-xl shadow-blue-100 hover:bg-blue-700 transition active:scale-95">Confirmar Tarea</button>
                        </div>
                    </div>
                </div>
            )}

            {showNewTemplate && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                            <h3 className="text-xl font-black text-slate-800 tracking-tight uppercase">Diseño de Checklist</h3>
                            <button onClick={() => setShowNewTemplate(false)}><X size={24} className="text-slate-400" /></button>
                        </div>
                        <div className="p-8 space-y-8 overflow-y-auto">
                            <div className="space-y-4">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Título de la plantilla</label>
                                <input type="text" className="w-full p-5 bg-slate-50 border border-slate-200 rounded-3xl outline-none focus:ring-4 focus:ring-indigo-50 font-bold" value={templateTitle} onChange={(e) => setTemplateTitle(e.target.value)} />
                            </div>
                            <div className="space-y-4">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Items de Control</label>
                                {templateItems.map((q, idx) => (
                                    <div key={idx} className="flex gap-3 items-center group">
                                        <input type="text" className="flex-1 p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-indigo-50 font-medium" value={q} onChange={(e) => { const n = [...templateItems]; n[idx] = e.target.value; setTemplateItems(n); }} placeholder={`Punto de control ${idx + 1}`} />
                                        <button onClick={() => setTemplateItems(templateItems.filter((_, i) => i !== idx))} className="p-3 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={18} /></button>
                                    </div>
                                ))}
                                <button onClick={() => setTemplateItems([...templateItems, ''])} className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-indigo-500 hover:text-indigo-700 transition"><Plus size={16} /> Agregar Item</button>
                            </div>
                        </div>
                        <div className="p-8 bg-slate-50 border-t border-slate-100">
                            <button onClick={handleCreateTemplate} className="w-full py-4 bg-indigo-600 text-white font-black uppercase text-xs tracking-widest rounded-3xl shadow-xl shadow-indigo-100">Guardar Plantilla Maestra</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Other modals (SubTask, Recurring) would follow the same pattern... simplified here to save file space but logic remains */}
            {showNewSubTask && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-lg overflow-hidden">
                        <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                            <h3 className="text-xl font-black text-slate-800 tracking-tight uppercase">Nueva Sub-Tarea</h3>
                            <button onClick={() => setShowNewSubTask(false)}><X size={24} className="text-slate-400" /></button>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Responsable</label>
                                <select className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4" value={selectedSupervisor} onChange={(e) => setSelectedSupervisor(e.target.value)}>
                                    <option value="">Seleccionar...</option>
                                    {supervisors.map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastNamePaterno}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Título</label>
                                <input type="text" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none" value={subTaskTitle} onChange={(e) => setSubTaskTitle(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Descripción</label>
                                <textarea className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none h-24" value={subTaskDesc} onChange={(e) => setSubTaskDesc(e.target.value)} />
                            </div>
                        </div>
                        <div className="p-8 bg-slate-50 border-t flex gap-4">
                            <button onClick={handleCreateSubTask} className="flex-1 py-4 bg-emerald-600 text-white font-black uppercase text-xs tracking-widest rounded-3xl shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition">Crear Tarea</button>
                        </div>
                    </div>
                </div>
            )}

            {showNewRecurring && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-lg overflow-hidden">
                        <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                            <h3 className="text-xl font-black text-slate-800 tracking-tight uppercase">Programar Recurrencia</h3>
                            <button onClick={() => setShowNewRecurring(false)}><X size={24} className="text-slate-400" /></button>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Frecuencia</label>
                                <select className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none" value={recurringFreq} onChange={(e) => setRecurringFreq(e.target.value as any)}>
                                    <option value="DIARIO">Diario</option>
                                    <option value="SEMANAL">Semanal</option>
                                    <option value="MENSUAL">Mensual</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Supervisor</label>
                                <select className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none" value={selectedSupervisor} onChange={(e) => setSelectedSupervisor(e.target.value)}>
                                    <option value="">Seleccionar...</option>
                                    {supervisors.map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastNamePaterno}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Instalación</label>
                                <select className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none" value={selectedSite} onChange={(e) => setSelectedSite(e.target.value)}>
                                    <option value="">Seleccionar...</option>
                                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Plantilla</label>
                                <select className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none" value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)}>
                                    <option value="">Seleccionar...</option>
                                    {checklistTemplates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="p-8 bg-slate-50 border-t">
                            <button onClick={handleCreateRecurring} className="w-full py-4 bg-amber-600 text-white font-black uppercase text-xs tracking-widest rounded-3xl shadow-xl shadow-amber-100 hover:bg-amber-700 transition">Activar Programa</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SupervisorManagement;
