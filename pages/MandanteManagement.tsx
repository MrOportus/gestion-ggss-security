import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { normalizeText, matchesEmployeeSearch } from '../lib/textUtils';

import {
    User, Search, CheckCircle, Square, Building2, Save
} from 'lucide-react';

const MandanteManagement: React.FC = () => {
    const { employees, sites, updateEmployee } = useAppStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [siteSearchTerm, setSiteSearchTerm] = useState('');
    const [selectedMandante, setSelectedMandante] = useState<string | null>(null);

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex items-center gap-6">
                <div>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                        Gestión Mandantes
                    </h2>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Asignación de Instalaciones a Clientes</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-500">
                {/* Left Panel: Mandantes List */}
                <div className="lg:col-span-1 space-y-4">
                    <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-xl space-y-4">
                        <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest px-2">Cuentas Mandante</h3>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                            <input
                                type="text"
                                placeholder="Buscar mandante..."
                                className="w-full pl-9 pr-4 py-2 text-xs font-bold border border-slate-100 bg-slate-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
                            {employees.filter(e => e.role === 'mandante' && matchesEmployeeSearch(searchTerm, e)).map(mand => (
                                <button
                                    key={mand.id}
                                    onClick={() => setSelectedMandante(mand.id)}
                                    className={`w-full flex items-center gap-3 p-3 rounded-2xl transition-all ${selectedMandante === mand.id ? 'bg-blue-600 text-white shadow-lg scale-[1.02]' : 'hover:bg-slate-50 text-slate-600'}`}
                                >
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-[10px] ${selectedMandante === mand.id ? 'bg-white/20' : 'bg-slate-100 text-slate-400'}`}>
                                        {mand.firstName[0]}{mand.lastNamePaterno[0]}
                                    </div>
                                    <div className="text-left">
                                        <div className="text-xs font-bold truncate">{mand.firstName} {mand.lastNamePaterno}</div>
                                        <div className={`text-[9px] font-medium uppercase tracking-tighter ${selectedMandante === mand.id ? 'text-blue-100' : 'text-slate-400'}`}>
                                            {mand.assignedSites?.length || 0} Sucursales asignadas
                                        </div>
                                    </div>
                                </button>
                            ))}
                            {employees.filter(e => e.role === 'mandante').length === 0 && (
                                <div className="text-center py-8 text-slate-400">
                                    <p className="text-sm font-bold">No hay cuentas Mandante.</p>
                                    <p className="text-xs mt-1">Crea una desde la pestaña Empleados.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Panel: Sites Assignment */}
                <div className="lg:col-span-2">
                    {selectedMandante ? (
                        <div className="bg-white p-8 rounded-[32px] border border-slate-200 shadow-2xl space-y-8 animate-in slide-in-from-right-4 duration-500">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-xl font-black text-slate-900 tracking-tight">Asignar Sucursales</h3>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                                        {employees.find(e => e.id === selectedMandante)?.firstName} {employees.find(e => e.id === selectedMandante)?.lastNamePaterno}
                                    </p>
                                </div>
                                <Building2 className="text-blue-600 opacity-20" size={40} />
                            </div>
                            <div className="space-y-4">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                                    <input
                                        type="text"
                                        placeholder="Filtrar sucursales por nombre o dirección..."
                                        className="w-full pl-9 pr-4 py-2 text-xs font-bold border border-slate-100 bg-slate-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                        value={siteSearchTerm}
                                        onChange={(e) => setSiteSearchTerm(e.target.value)}
                                    />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
                                    {sites.filter(s => 
                                        s.active && 
                                        s.name !== 'Administración' && 
                                        (s.name.toLowerCase().includes(siteSearchTerm.toLowerCase()) || 
                                         s.address.toLowerCase().includes(siteSearchTerm.toLowerCase()))
                                    ).sort((a, b) => {
                                        const mandante = employees.find(e => e.id === selectedMandante);
                                        const aAssigned = mandante?.assignedSites?.includes(a.id) ? 1 : 0;
                                        const bAssigned = mandante?.assignedSites?.includes(b.id) ? 1 : 0;
                                        return bAssigned - aAssigned;
                                    }).map(site => {
                                    const mandante = employees.find(e => e.id === selectedMandante);
                                    const isAssigned = mandante?.assignedSites?.includes(site.id);

                                    return (
                                        <button
                                            key={site.id}
                                            onClick={() => {
                                                const currentAssigned = mandante?.assignedSites || [];
                                                const newAssigned = isAssigned
                                                    ? currentAssigned.filter(id => id !== site.id)
                                                    : [...currentAssigned, site.id];
                                                updateEmployee(selectedMandante, { assignedSites: newAssigned });
                                            }}
                                            className={`flex items-center gap-4 p-4 rounded-2xl border transition-all text-left group ${isAssigned ? 'border-blue-200 bg-blue-50/50' : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'}`}
                                        >
                                            <div className={`transition-colors ${isAssigned ? 'text-blue-600' : 'text-slate-300 group-hover:text-slate-400'}`}>
                                                {isAssigned ? <CheckCircle size={20} /> : <Square size={20} />}
                                            </div>
                                            <div>
                                                <div className={`text-xs font-black uppercase tracking-tight ${isAssigned ? 'text-blue-900' : 'text-slate-700'}`}>{site.name}</div>
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
                        <div className="h-full flex flex-col items-center justify-center p-12 bg-slate-50/50 rounded-[32px] border border-dashed border-slate-200 text-slate-400 space-y-4 min-h-[400px]">
                            <User size={48} strokeWidth={1} />
                            <p className="text-sm font-bold uppercase tracking-widest">Selecciona un mandante para comenzar</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MandanteManagement;
