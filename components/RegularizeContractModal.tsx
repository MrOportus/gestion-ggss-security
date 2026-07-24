import React, { useState } from 'react';
import { X, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { Employee, Site } from '../types';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  employee: Employee;
  sites: Site[];
}

export const RegularizeContractModal: React.FC<Props> = ({ isOpen, onClose, employee, sites }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    sucursalId: employee.currentSiteId?.toString() || '',
    tipoContrato: employee.tipoContrato || 'Plazo Fijo',
    fechaInicio: employee.fechaInicioContrato?.split('T')[0] || '',
    fechaTermino: employee.fechaTerminoContrato?.split('T')[0] || '',
    estado: 'pending_document', // draft, pending_document, active
    regularizationReason: 'Regularización manual de sistema legacy'
  });

  const { fetchContratos } = useAppStore();

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.sucursalId || !formData.tipoContrato || !formData.fechaInicio || !formData.estado) {
      setError("Por favor complete todos los campos obligatorios.");
      return;
    }

    const isFixedTerm = formData.tipoContrato.toLowerCase().includes('plazo');
    if (isFixedTerm && !formData.fechaTermino) {
      setError("Los contratos a plazo fijo requieren una fecha de término.");
      return;
    }

    setLoading(true);
    try {
      const regularizeContractValidated = httpsCallable(functions, 'regularizeContractValidated');
      const requestId = `contract_reg_${employee.id}_${Date.now()}`;
      
      await regularizeContractValidated({
        requestId,
        employeeId: employee.id,
        sucursalId: formData.sucursalId,
        tipoContrato: formData.tipoContrato,
        fechaInicio: formData.fechaInicio,
        fechaTermino: formData.fechaTermino || null,
        estado: formData.estado,
        regularizationReason: formData.regularizationReason
      });

      window.alert('Contrato regularizado exitosamente');
      
      // Refrescar contratos en el store para que el Dashboard se actualice
      await fetchContratos();
      
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error al regularizar contrato.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-slate-900 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 text-white">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
              <FileText className="text-blue-400" size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold">Regularizar Contrato</h2>
              <p className="text-sm text-slate-400 font-medium">
                {employee.firstName} {employee.lastNamePaterno} - {employee.rut}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto">
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3">
              <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
            <strong>Atención:</strong> Esta herramienta permite registrar la existencia de un contrato 
            para propósitos operativos sin requerir un PDF adjunto. 
            No marque el estado como "Vigente (Con respaldo)" a menos que exista un documento legal firmado.
          </div>

          <form id="regularize-form" onSubmit={handleSubmit} className="space-y-6">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Sucursal */}
              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Sucursal a la que aplica <span className="text-red-500">*</span>
                </label>
                <select 
                  name="sucursalId" 
                  value={formData.sucursalId} 
                  onChange={handleChange} 
                  className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                >
                  <option value="">Seleccione Sucursal</option>
                  <option value="0">Contrato General (Sin sucursal específica)</option>
                  {sites.filter(s => s.active).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Tipo */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Tipo de Contrato <span className="text-red-500">*</span>
                </label>
                <select 
                  name="tipoContrato" 
                  value={formData.tipoContrato} 
                  onChange={handleChange} 
                  className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                >
                  <option value="Plazo Fijo">Plazo Fijo</option>
                  <option value="Indefinido">Indefinido</option>
                  <option value="Obra y Faena">Obra y Faena</option>
                </select>
              </div>

              {/* Estado */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Estado de Regularización <span className="text-red-500">*</span>
                </label>
                <select 
                  name="estado" 
                  value={formData.estado} 
                  onChange={handleChange} 
                  className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                >
                  <option value="draft">Borrador (Faltan datos)</option>
                  <option value="pending_document">Pendiente de Documento (Operativo)</option>
                  <option value="active">Vigente (Con respaldo legal)</option>
                </select>
              </div>

              {/* Fechas */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Fecha de Inicio <span className="text-red-500">*</span>
                </label>
                <input 
                  type="date" 
                  name="fechaInicio" 
                  value={formData.fechaInicio} 
                  onChange={handleChange} 
                  className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Fecha de Término
                  {formData.tipoContrato.includes('Plazo') && <span className="text-red-500 ml-1">*</span>}
                </label>
                <input 
                  type="date" 
                  name="fechaTermino" 
                  value={formData.fechaTermino} 
                  onChange={handleChange} 
                  className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-blue-500"
                  required={formData.tipoContrato.includes('Plazo')}
                />
              </div>

              {/* Motivo */}
              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-semibold text-slate-700 mb-1">Motivo / Observaciones</label>
                <textarea 
                  name="regularizationReason" 
                  value={formData.regularizationReason} 
                  onChange={handleChange} 
                  rows={2}
                  className="w-full rounded-xl border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-blue-500"
                ></textarea>
              </div>

            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-bold text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            form="regularize-form"
            type="submit"
            className="px-5 py-2.5 text-sm font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 shadow-sm shadow-blue-500/20"
            disabled={loading}
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <CheckCircle size={18} />
                Confirmar Regularización
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
