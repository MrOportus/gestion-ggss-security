import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { X, Calendar, User, AlignLeft, Info, CheckCircle2 } from 'lucide-react';
import { Employee, Site, Vacation } from '../types';

interface VacationFormModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const VacationFormModal: React.FC<VacationFormModalProps> = ({ onClose, onSuccess }) => {
  const { employees, sites, addVacation, currentUser, showNotification, vacations } = useAppStore();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    employeeId: '',
    sucursalId: '',
    startDate: '',
    endDate: '',
    days: '',
    notes: '',
  });

  const activeEmployees = employees.filter(e => e.isActive);

  // Auto-fill sucursal when employee is selected
  useEffect(() => {
    if (formData.employeeId) {
      const emp = employees.find(e => e.id === formData.employeeId);
      if (emp && emp.currentSiteId) {
        setFormData(prev => ({ ...prev, sucursalId: emp.currentSiteId!.toString() }));
      }
    }
  }, [formData.employeeId, employees]);

  // Suggest days based on dates
  useEffect(() => {
    if (formData.startDate && formData.endDate) {
      const start = new Date(formData.startDate);
      const end = new Date(formData.endDate);
      if (end >= start) {
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // Inclusive
        if (!formData.days || parseInt(formData.days) < 0) {
          setFormData(prev => ({ ...prev, days: diffDays.toString() }));
        }
      }
    }
  }, [formData.startDate, formData.endDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.employeeId || !formData.startDate || !formData.endDate || !formData.days) {
      showNotification("Por favor, completa los campos obligatorios.", "warning");
      return;
    }

    const start = new Date(formData.startDate);
    const end = new Date(formData.endDate);
    
    if (end < start) {
      showNotification("La fecha de término no puede ser anterior a la de inicio.", "warning");
      return;
    }

    const daysCount = parseInt(formData.days);
    if (isNaN(daysCount) || daysCount <= 0) {
      showNotification("La cantidad de días debe ser mayor a cero.", "warning");
      return;
    }

    // Check for overlap
    const hasOverlap = vacations.some(v => {
      if (v.employeeId !== formData.employeeId) return false;
      if (v.status === 'cancelled' || v.status === 'rejected') return false;
      const vStart = new Date(v.startDate);
      const vEnd = new Date(v.endDate);
      return (start <= vEnd && end >= vStart);
    });

    if (hasOverlap) {
      showNotification("El trabajador ya tiene vacaciones registradas que se superponen con este periodo.", "error");
      return;
    }

    setIsSubmitting(true);
    try {
      await addVacation({
        employeeId: formData.employeeId,
        sucursalId: formData.sucursalId,
        startDate: formData.startDate,
        endDate: formData.endDate,
        days: daysCount,
        status: 'pending',
        notes: formData.notes,
        createdBy: currentUser!.uid,
        source: 'rrhh_panel',
        schemaVersion: 2
      });
      showNotification("Vacaciones registradas exitosamente.", "success");
      onSuccess();
    } catch (error) {
      console.error(error);
      showNotification("Error al registrar vacaciones.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-xl">
              <Calendar size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800 tracking-tight">Registrar Vacaciones</h2>
              <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Panel RRHH</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition text-slate-500">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="space-y-4">
            {/* Empleado */}
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-2">
                <User size={14} className="text-blue-500" /> Trabajador
              </label>
              <select
                required
                value={formData.employeeId}
                onChange={e => setFormData({ ...formData, employeeId: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">Selecciona un trabajador...</option>
                {activeEmployees.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastNamePaterno} ({emp.rut})
                  </option>
                ))}
              </select>
            </div>

            {/* Sucursal (Optional, usually auto-filled) */}
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5 block">Sucursal</label>
              <select
                value={formData.sucursalId}
                onChange={e => setFormData({ ...formData, sucursalId: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">(Sin asignar)</option>
                {sites.map(site => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5 block">Fecha Inicio</label>
                <input
                  type="date"
                  required
                  value={formData.startDate}
                  onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5 block">Fecha Término</label>
                <input
                  type="date"
                  required
                  min={formData.startDate}
                  value={formData.endDate}
                  onChange={e => setFormData({ ...formData, endDate: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                <span>Días de Vacaciones</span>
                <span className="text-[10px] text-slate-400 font-normal normal-case flex items-center gap-1">
                  <Info size={12} /> Se sugiere modificar si hay fines de semana
                </span>
              </label>
              <input
                type="number"
                required
                min="1"
                value={formData.days}
                onChange={e => setFormData({ ...formData, days: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-2">
                <AlignLeft size={14} className="text-slate-400" /> Observaciones (Opcional)
              </label>
              <textarea
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none resize-none h-24"
                placeholder="Añade algún comentario..."
              />
            </div>
          </div>

          <div className="pt-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs uppercase tracking-widest rounded-xl transition-all"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-blue-200 flex justify-center items-center gap-2"
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
                  Guardando...
                </span>
              ) : (
                <>
                  <CheckCircle2 size={16} /> Guardar
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default VacationFormModal;
