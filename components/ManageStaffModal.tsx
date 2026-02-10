import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { User, X, Search, Check } from 'lucide-react';

interface ManageStaffModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentSiteId: string | number;
    onSave: (selectedEmployeeIds: string[]) => void;
}

const ManageStaffModal: React.FC<ManageStaffModalProps> = ({ isOpen, onClose, currentSiteId, onSave }) => {
    const { employees, sites } = useAppStore();
    const [searchTerm, setSearchTerm] = useState('');

    // Initial state logic should be handled by parent or derived, but for simple selection we can do this:
    // We want to select employees who are CURRENTLY assigned to this site.
    // However, the parent might want to pass the current set.
    // For now, let's derive it from the store's currentSiteId.

    // We maintain a local set of IDs that we want to be part of the site.
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Sync selectedIds with current assignments whenever modal opens or site changes
    React.useEffect(() => {
        if (isOpen) {
            const initial = new Set<string>();
            employees.forEach(emp => {
                if (emp.currentSiteId == currentSiteId) {
                    initial.add(emp.id);
                }
            });
            setSelectedIds(initial);
        }
    }, [isOpen, currentSiteId, employees]);

    const currentSiteName = sites.find(s => s.id == currentSiteId)?.name || 'la sucursal';

    const filteredEmployees = employees.filter(emp => {
        const full = `${emp.firstName} ${emp.lastNamePaterno} ${emp.rut}`.toLowerCase();
        return full.includes(searchTerm.toLowerCase());
    });

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    const handleSave = () => {
        onSave(Array.from(selectedIds));
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div>
                        <h2 className="text-lg font-bold text-slate-900">Gestionar Dotación</h2>
                        <p className="text-sm text-slate-500">Selecciona el personal fijo para {currentSiteName}.</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 border-b border-slate-100 bg-white">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                        <input
                            type="text"
                            placeholder="Buscar por nombre o RUT..."
                            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                    <div className="space-y-1">
                        {filteredEmployees.map(emp => {
                            const isSelected = selectedIds.has(emp.id);
                            return (
                                <div
                                    key={emp.id}
                                    onClick={() => toggleSelection(emp.id)}
                                    className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border ${isSelected ? 'bg-blue-50 border-blue-200 shadow-sm' : 'bg-white border-transparent hover:bg-slate-50'}`}
                                >
                                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-blue-500 border-blue-500 text-white' : 'border-slate-300 bg-white'}`}>
                                        {isSelected && <Check size={12} strokeWidth={4} />}
                                    </div>
                                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-blue-600 shrink-0">
                                        {emp.firstName[0]}{emp.lastNamePaterno[0]}
                                    </div>
                                    <div className="flex-1">
                                        <p className={`text-sm font-bold ${isSelected ? 'text-blue-900' : 'text-slate-700'}`}>{emp.firstName} {emp.lastNamePaterno}</p>
                                        <p className="text-xs text-slate-400 font-mono">{emp.rut}</p>
                                    </div>
                                    {emp.currentSiteId && emp.currentSiteId != currentSiteId && (
                                        <div className="text-[10px] bg-slate-100 text-slate-500 px-2 py-1 rounded">
                                            En otra sucursal
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {filteredEmployees.length === 0 && (
                            <div className="text-center py-10 text-slate-400">
                                No se encontraron colaboradores.
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-500">
                        {selectedIds.size} seleccionados
                    </span>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg transition text-sm">
                            Cancelar
                        </button>
                        <button onClick={handleSave} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition text-sm shadow-lg shadow-blue-200">
                            Actualizar Dotación
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ManageStaffModal;
