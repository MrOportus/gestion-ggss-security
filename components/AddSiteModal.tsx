
import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { X, Save, MapPin, Building2, Briefcase, Edit2, Trash2, AlertTriangle, ShieldCheck, Plus, Package, Clock, RotateCcw } from 'lucide-react';
import { Site, DEFAULT_SITE_HORARIO } from '../types';

interface AddSiteModalProps {
  onClose: () => void;
  siteToEdit?: Site | null;
}

const DEFAULT_CARGOS_FIJOS = ['Chaleco Anticorte'];

const AddSiteModal: React.FC<AddSiteModalProps> = ({ onClose, siteToEdit }) => {
  const { addSite, updateSite, deleteSite } = useAppStore();
  
  // Estado inicial depende de si estamos editando o creando
  const [formData, setFormData] = useState<Partial<Site>>({
    active: true,
    cargosFijos: DEFAULT_CARGOS_FIJOS,
    horario: DEFAULT_SITE_HORARIO,
  });

  const [newCargoInput, setNewCargoInput] = useState('');

  // Estado para controlar la vista de confirmación
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (siteToEdit) {
      setFormData({
        ...siteToEdit,
        cargosFijos: (siteToEdit.cargosFijos && siteToEdit.cargosFijos.length > 0)
          ? siteToEdit.cargosFijos
          : DEFAULT_CARGOS_FIJOS,
        horario: {
          inicio: siteToEdit.horario?.inicio || DEFAULT_SITE_HORARIO.inicio,
          termino: siteToEdit.horario?.termino || DEFAULT_SITE_HORARIO.termino,
        },
      });
    } else {
      setFormData({
        active: true,
        cargosFijos: DEFAULT_CARGOS_FIJOS,
        horario: DEFAULT_SITE_HORARIO,
      });
    }
  }, [siteToEdit]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleHorarioChange = (field: 'inicio' | 'termino', val: string) => {
    setFormData(prev => ({
      ...prev,
      horario: {
        inicio: field === 'inicio' ? val : (prev.horario?.inicio || DEFAULT_SITE_HORARIO.inicio),
        termino: field === 'termino' ? val : (prev.horario?.termino || DEFAULT_SITE_HORARIO.termino),
      }
    }));
  };

  const handleResetHorario = () => {
    setFormData(prev => ({
      ...prev,
      horario: { ...DEFAULT_SITE_HORARIO }
    }));
  };

  const handleAddCargoFijo = (itemToAdd?: string) => {
    const raw = itemToAdd !== undefined ? itemToAdd : newCargoInput;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const currentList = formData.cargosFijos || [];
    if (!currentList.some(item => item.toLowerCase() === trimmed.toLowerCase())) {
      setFormData(prev => ({
        ...prev,
        cargosFijos: [...currentList, trimmed],
      }));
    }
    if (itemToAdd === undefined) {
      setNewCargoInput('');
    }
  };

  const handleRemoveCargoFijo = (indexToRemove: number) => {
    setFormData(prev => ({
      ...prev,
      cargosFijos: (prev.cargosFijos || []).filter((_, idx) => idx !== indexToRemove),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.address) return;

    // Asegurar que si la lista quedó vacía, mantenga al menos la base o lo asignado
    const payload = {
      ...formData,
      cargosFijos: (formData.cargosFijos && formData.cargosFijos.length > 0)
        ? formData.cargosFijos
        : DEFAULT_CARGOS_FIJOS,
      horario: {
        inicio: formData.horario?.inicio?.trim() || DEFAULT_SITE_HORARIO.inicio,
        termino: formData.horario?.termino?.trim() || DEFAULT_SITE_HORARIO.termino,
      },
    };

    if (siteToEdit) {
       await updateSite(siteToEdit.id, payload);
    } else {
       await addSite(payload as Omit<Site, 'id'>);
    }
    onClose();
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!siteToEdit) return;
    await deleteSite(siteToEdit.id);
    onClose();
  };

  const inputClass = "w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-900 shadow-sm";

  // VISTA DE CONFIRMACIÓN DE ELIMINACIÓN
  if (showDeleteConfirm) {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4 animate-in zoom-in-95 duration-200 border-2 border-red-100">
                <div className="mx-auto w-14 h-14 bg-red-100 rounded-full flex items-center justify-center text-red-600 mb-2">
                    <AlertTriangle size={28} />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-slate-900 leading-tight">¿Está seguro que desea eliminar este registro?</h3>
                    <p className="text-sm text-slate-500 mt-2 font-medium">No podrá recuperar la información después de esta eliminación.</p>
                </div>
                
                <div className="flex gap-3 pt-4">
                    <button 
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 transition"
                    >
                        Cancelar
                    </button>
                    <button 
                        type="button"
                        onClick={confirmDelete}
                        className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition shadow-lg shadow-red-200 flex items-center justify-center gap-2"
                    >
                        <Trash2 size={18} /> Eliminar
                    </button>
                </div>
            </div>
        </div>
    );
  }

  // VISTA NORMAL DEL FORMULARIO
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white shrink-0">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
               {siteToEdit ? <Edit2 size={24} /> : <Building2 size={24} />}
             </div>
             <div>
               <h2 className="text-xl font-bold text-slate-900">{siteToEdit ? 'Editar Sucursal' : 'Nueva Sucursal'}</h2>
               <p className="text-sm text-slate-500">{siteToEdit ? 'Modificar datos existentes' : 'Registrar obra o instalación'}</p>
             </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <X size={24} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 md:p-8 bg-slate-50/50 space-y-5 overflow-y-auto flex-1">
            
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
                    <Building2 size={14} className="text-slate-400" /> Empresa Cliente
                </label>
                <input name="empresa" value={formData.empresa || ''} onChange={handleChange} className={inputClass} placeholder="Ej: Constructora S.A." />
            </div>

            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
                    <Briefcase size={14} className="text-slate-400" /> RUT Empresa
                </label>
                <input name="rutEmpresa" value={formData.rutEmpresa || ''} onChange={handleChange} className={inputClass} placeholder="76.xxx.xxx-k" />
            </div>

            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
                    <MapPin size={14} className="text-slate-400" /> Nombre Obra / Faena *
                </label>
                <input name="name" value={formData.name || ''} required onChange={handleChange} className={inputClass} placeholder="Ej: Edificio Central" />
            </div>

            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Dirección Completa *</label>
                <input name="address" value={formData.address || ''} required onChange={handleChange} className={inputClass} placeholder="Av. Principal 123, Comuna" />
            </div>

            {/* SECCIÓN HORARIO DE FUNCIONAMIENTO DE LA SUCURSAL */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                    <label className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <Clock size={16} className="text-blue-600" />
                        Horario de Funcionamiento de la Sucursal
                    </label>
                    <span className="text-[11px] font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                        {formData.horario?.inicio || '07:30'} a {formData.horario?.termino || '19:30'}
                    </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                    Jornada horaria propia de la sucursal. Se establece automáticamente de <strong>07:30 a 19:30</strong> como base y sirve de referencia exclusiva para la planificación de turnos.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">
                            Hora Inicio (Apertura / Entrada) *
                        </label>
                        <input
                            type="time"
                            value={formData.horario?.inicio || '07:30'}
                            onChange={(e) => handleHorarioChange('inicio', e.target.value)}
                            required
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">
                            Hora Término (Cierre / Salida) *
                        </label>
                        <input
                            type="time"
                            value={formData.horario?.termino || '19:30'}
                            onChange={(e) => handleHorarioChange('termino', e.target.value)}
                            required
                            className={inputClass}
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <span className="text-[11px] text-slate-400 font-medium">
                        Predeterminado del sistema: 07:30 - 19:30
                    </span>
                    <button
                        type="button"
                        onClick={handleResetHorario}
                        className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition"
                    >
                        <RotateCcw size={12} /> Restablecer (07:30 a 19:30)
                    </button>
                </div>
            </div>

            {/* SECCIÓN CARGOS FIJOS DE LA SUCURSAL */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                    <label className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <Package size={16} className="text-blue-600" />
                        Cargos Fijos Asignados a la Sucursal
                    </label>
                    <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                        {(formData.cargosFijos || []).length} ítem{(formData.cargosFijos || []).length !== 1 ? 's' : ''}
                    </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                    Equipamiento fijo e inventario base de la instalación (usado para entrega de turno del guardia y chequeo del supervisor).
                </p>

                {/* Input para agregar nuevo cargo */}
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newCargoInput}
                        onChange={(e) => setNewCargoInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddCargoFijo();
                            }
                        }}
                        placeholder="Ej: Linterna, Radio transmisor, Botiquín..."
                        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-900"
                    />
                    <button
                        type="button"
                        onClick={() => handleAddCargoFijo()}
                        disabled={!newCargoInput.trim()}
                        className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition disabled:opacity-40 flex items-center gap-1.5 shrink-0 shadow-sm"
                    >
                        <Plus size={14} /> Agregar
                    </button>
                </div>

                {/* Sugerencias Rápidas Comunes */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mr-1">Sugerencias:</span>
                    {['Radio Transmisor', 'Linterna Recargable', 'Libro de Novedades', 'Botiquín de Primeros Auxilios', 'Detector de Metales'].map(sug => {
                        const alreadyHas = (formData.cargosFijos || []).some(c => c.toLowerCase() === sug.toLowerCase());
                        if (alreadyHas) return null;
                        return (
                            <button
                                key={sug}
                                type="button"
                                onClick={() => handleAddCargoFijo(sug)}
                                className="text-[11px] font-medium bg-slate-50 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 text-slate-600 px-2 py-0.5 rounded-md transition flex items-center gap-1 border border-slate-200"
                            >
                                <Plus size={10} /> {sug}
                            </button>
                        );
                    })}
                </div>

                {/* Listado de badges asignados */}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 min-h-[42px] items-center">
                    {(formData.cargosFijos || []).map((cargo, idx) => {
                        const isChaleco = cargo.toLowerCase().includes('chaleco');
                        return (
                            <span
                                key={idx}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                                    isChaleco
                                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200 shadow-sm'
                                        : 'bg-slate-50 text-slate-700 border-slate-200'
                                }`}
                            >
                                <span className={`w-1.5 h-1.5 rounded-full ${isChaleco ? 'bg-emerald-500' : 'bg-blue-500'}`}></span>
                                {cargo}
                                <button
                                    type="button"
                                    onClick={() => handleRemoveCargoFijo(idx)}
                                    className="text-slate-400 hover:text-rose-600 p-0.5 rounded hover:bg-slate-200/50 transition ml-1"
                                    title="Quitar ítem"
                                >
                                    <X size={12} />
                                </button>
                            </span>
                        );
                    })}
                    {(!formData.cargosFijos || formData.cargosFijos.length === 0) && (
                        <span className="text-xs text-slate-400 italic">No hay cargos fijos asignados aún.</span>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2 bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                <input 
                  type="checkbox" 
                  name="rondasEnabled" 
                  id="rondasEnabled"
                  checked={!!formData.rondasEnabled} 
                  onChange={handleChange} 
                  className="w-4 h-4 text-blue-600 rounded cursor-pointer" 
                />
                <label htmlFor="rondasEnabled" className="text-sm font-medium text-slate-700 cursor-pointer flex-1">
                    Habilitar Módulo de Rondas para esta sucursal
                </label>
            </div>

            {/* Footer Buttons */}
            <div className="pt-4 border-t border-slate-200 flex items-center gap-3 shrink-0">
                {siteToEdit && (
                    <button 
                        type="button"
                        onClick={handleDeleteClick}
                        className="mr-auto px-4 py-2.5 rounded-lg border border-red-100 text-red-600 hover:bg-red-50 font-medium transition flex items-center gap-2"
                    >
                        <Trash2 size={18} /> Eliminar
                    </button>
                )}

                <div className={`flex gap-3 ${!siteToEdit ? 'w-full justify-end' : ''}`}>
                    <button type="button" onClick={onClose} className="px-6 py-2.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium transition bg-white">
                        Cancelar
                    </button>
                    <button type="submit" className="px-6 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium flex items-center gap-2 transition shadow-lg shadow-blue-200">
                        <Save size={18} /> {siteToEdit ? 'Guardar Cambios' : 'Crear Sucursal'}
                    </button>
                </div>
            </div>
        </form>
      </div>
    </div>
  );
};

export default AddSiteModal;
