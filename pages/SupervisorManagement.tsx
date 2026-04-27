
import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
    Trash2, Clock, User, ListPlus, X,
    Calendar, ArrowLeft, Building2, Save, Search, CheckCircle, Square
} from 'lucide-react';

const SupervisorManagement: React.FC = () => {
    const {
        resignationRequests, updateResignationRequestStatus, deleteResignationRequest,
        employees, sites, updateEmployee, currentUser
    } = useAppStore();
    const [view, setView] = useState<'menu' | 'resignations' | 'assign_sites'>('menu');
    const [searchTerm, setSearchTerm] = useState('');
    const [siteSearchTerm, setSiteSearchTerm] = useState('');
    const [selectedSupervisor, setSelectedSupervisor] = useState<string | null>(null);

    const menuItems = [
        {
            id: 'resignations',
            title: 'Informar Renuncia',
            desc: 'Reportar renuncia de un trabajador con documentos adjuntos.',
            icon: <X size={22} />,
            color: 'text-rose-500',
            bg: 'bg-rose-50'
        },
        {
            id: 'assign_sites',
            title: 'Asignar Sucursales',
            desc: 'Definir qué sucursales puede visualizar y gestionar cada supervisor.',
            icon: <Building2 size={22} />,
            color: 'text-indigo-500',
            bg: 'bg-indigo-50',
            adminOnly: true
        }
    ].filter(i => !i.adminOnly || currentUser?.role === 'admin');

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
                            onClick={() => setView(item.id as any)}
                            className="flex flex-col text-left p-8 bg-white rounded-[32px] border border-slate-100 shadow-sm transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 hover:border-blue-200 group"
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

            {view === 'assign_sites' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-500">
                    {/* Left Panel: Supervisors List */}
                    <div className="lg:col-span-1 space-y-4">
                        <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-xl space-y-4">
                            <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest px-2">Supervisores</h3>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                                <input
                                    type="text"
                                    placeholder="Buscar supervisor..."
                                    className="w-full pl-9 pr-4 py-2 text-xs font-bold border border-slate-100 bg-slate-50 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
                                {employees.filter(e => e.role === 'supervisor' && (e.firstName + ' ' + e.lastNamePaterno).toLowerCase().includes(searchTerm.toLowerCase())).map(sup => (
                                    <button
                                        key={sup.id}
                                        onClick={() => setSelectedSupervisor(sup.id)}
                                        className={`w-full flex items-center gap-3 p-3 rounded-2xl transition-all ${selectedSupervisor === sup.id ? 'bg-indigo-600 text-white shadow-lg scale-[1.02]' : 'hover:bg-slate-50 text-slate-600'}`}
                                    >
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-[10px] ${selectedSupervisor === sup.id ? 'bg-white/20' : 'bg-slate-100 text-slate-400'}`}>
                                            {sup.firstName[0]}{sup.lastNamePaterno[0]}
                                        </div>
                                        <div className="text-left">
                                            <div className="text-xs font-bold truncate">{sup.firstName} {sup.lastNamePaterno}</div>
                                            <div className={`text-[9px] font-medium uppercase tracking-tighter ${selectedSupervisor === sup.id ? 'text-indigo-100' : 'text-slate-400'}`}>
                                                {sup.assignedSites?.length || 0} Sucursales asignadas
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Right Panel: Sites Assignment */}
                    <div className="lg:col-span-2">
                        {selectedSupervisor ? (
                            <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-2xl space-y-8 animate-in slide-in-from-right-4 duration-500">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-xl font-black text-slate-900 tracking-tight">Asignar Sucursales</h3>
                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                                            {employees.find(e => e.id === selectedSupervisor)?.firstName} {employees.find(e => e.id === selectedSupervisor)?.lastNamePaterno}
                                        </p>
                                    </div>
                                    <Building2 className="text-indigo-600 opacity-20" size={40} />
                                </div>
                                <div className="space-y-4">
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                                        <input
                                            type="text"
                                            placeholder="Filtrar sucursales por nombre o dirección..."
                                            className="w-full pl-9 pr-4 py-2 text-xs font-bold border border-slate-100 bg-slate-50 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                                            value={siteSearchTerm}
                                            onChange={(e) => setSiteSearchTerm(e.target.value)}
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
                                        {sites.filter(s => 
                                            s.active && 
                                            s.name !== 'Administración' && 
                                            (s.name.toLowerCase().includes(siteSearchTerm.toLowerCase()) || 
                                             s.address.toLowerCase().includes(siteSearchTerm.toLowerCase()))
                                        ).sort((a, b) => {
                                            const supervisor = employees.find(e => e.id === selectedSupervisor);
                                            const aAssigned = supervisor?.assignedSites?.includes(a.id) ? 1 : 0;
                                            const bAssigned = supervisor?.assignedSites?.includes(b.id) ? 1 : 0;
                                            return bAssigned - aAssigned;
                                        }).map(site => {
                                        const supervisor = employees.find(e => e.id === selectedSupervisor);
                                        const isAssigned = supervisor?.assignedSites?.includes(site.id);

                                        return (
                                            <button
                                                key={site.id}
                                                onClick={() => {
                                                    const currentAssigned = supervisor?.assignedSites || [];
                                                    const newAssigned = isAssigned
                                                        ? currentAssigned.filter(id => id !== site.id)
                                                        : [...currentAssigned, site.id];
                                                    updateEmployee(selectedSupervisor, { assignedSites: newAssigned });
                                                }}
                                                className={`flex items-center gap-4 p-4 rounded-2xl border transition-all text-left group ${isAssigned ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'}`}
                                            >
                                                <div className={`transition-colors ${isAssigned ? 'text-indigo-600' : 'text-slate-300 group-hover:text-slate-400'}`}>
                                                    {isAssigned ? <CheckCircle size={20} /> : <Square size={20} />}
                                                </div>
                                                <div>
                                                    <div className={`text-xs font-black uppercase tracking-tight ${isAssigned ? 'text-indigo-900' : 'text-slate-700'}`}>{site.name}</div>
                                                    <div className="text-[10px] text-slate-400 font-medium truncate">{site.address}</div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                    </div>
                                </div>

                                <div className="pt-6 border-t border-slate-100 flex items-center justify-between text-slate-400">
                                    <p className="text-[10px] font-bold uppercase tracking-widest">Los cambios se guardan automáticamente</p>
                                    <Save size={16} />
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center p-12 bg-slate-50/50 rounded-[32px] border border-dashed border-slate-200 text-slate-400 space-y-4">
                                <User size={48} strokeWidth={1} />
                                <p className="text-sm font-bold uppercase tracking-widest">Selecciona un supervisor para comenzar</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SupervisorManagement;
