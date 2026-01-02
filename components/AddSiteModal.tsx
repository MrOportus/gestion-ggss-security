
import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { X, Save, MapPin, Building2, Briefcase, Edit2, Trash2, AlertTriangle } from 'lucide-react';
import { Site } from '../types';

interface AddSiteModalProps {
  onClose: () => void;
  siteToEdit?: Site | null;
}

const AddSiteModal: React.FC<AddSiteModalProps> = ({ onClose, siteToEdit }) => {
  const { addSite, updateSite, deleteSite } = useAppStore();
  
  // Estado inicial depende de si estamos editando o creando
  const [formData, setFormData] = useState<Partial<Site>>({
    active: true,
  });

  // Estado para controlar la vista de confirmación
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (siteToEdit) {
      setFormData(siteToEdit);
    }
  }, [siteToEdit]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.address) return;

    if (siteToEdit) {
       await updateSite(siteToEdit.id, formData);
    } else {
       await addSite(formData as Omit<Site, 'id'>);
    }
    onClose();
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Activar la vista de confirmación en lugar de usar window.confirm
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
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white">
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
        <form onSubmit={handleSubmit} className="p-8 bg-slate-50/50 space-y-6">
            
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

            {/* Footer Buttons */}
            <div className="pt-6 border-t border-slate-200 flex items-center gap-3">
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
