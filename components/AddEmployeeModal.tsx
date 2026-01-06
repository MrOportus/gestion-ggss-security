
import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { X, Save, User, MapPin, Heart, Briefcase, Lock, Mail, Loader2, Shield, Sparkles } from 'lucide-react';
import { Employee } from '../types';

interface AddEmployeeModalProps {
  onClose: () => void;
}

const AddEmployeeModal: React.FC<AddEmployeeModalProps> = ({ onClose }) => {
  const { addEmployee, sites, isLoading, showNotification } = useAppStore();
  const [formData, setFormData] = useState<Partial<Employee>>({
    isActive: true,
    nacionalidad: 'Chilena',
    estadoCivil: 'Soltero',
    cargo: 'Guardia',
    role: 'worker'
  });
  const [password, setPassword] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.firstName || !formData.lastNamePaterno || !formData.rut || !formData.email || !password) {
      showNotification("Complete los campos obligatorios (*)", "warning");
      return;
    }

    if (password.length < 6) {
      showNotification("La contraseña debe tener al menos 6 caracteres.", "warning");
      return;
    }

    await addEmployee(formData as Omit<Employee, 'id'>, password);
    onClose();
  };

  const inputClass = "w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-900 shadow-sm";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <User size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Registrar Nuevo Colaborador</h2>
              <p className="text-sm text-slate-500">Creación de ficha y cuenta de acceso</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <X size={24} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

            {/* Sección: Cuenta de Usuario (IMPORTANTE) */}
            <div className="md:col-span-3 bg-yellow-50 p-4 rounded-xl border border-yellow-200">
              <h3 className="text-sm font-bold text-yellow-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Lock size={16} /> Credenciales de Acceso (Obligatorio)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Correo Electrónico (Usuario) *</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 text-slate-400 w-4 h-4" />
                    <input name="email" type="email" required onChange={handleChange} className={`${inputClass} pl-9`} placeholder="guardia@ggss.cl" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Contraseña Inicial *</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 text-slate-400 w-4 h-4" />
                    <input
                      type="text"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`${inputClass} pl-9`}
                      placeholder="Mínimo 6 caracteres"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Sección: Identificación Personal */}
            <div className="md:col-span-3">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <User size={16} /> Identificación
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nombres *</label>
                  <input name="firstName" required onChange={handleChange} className={inputClass} placeholder="Juan Andrés" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Apellido Paterno *</label>
                  <input name="lastNamePaterno" required onChange={handleChange} className={inputClass} placeholder="Pérez" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Apellido Materno</label>
                  <input name="lastNameMaterno" onChange={handleChange} className={inputClass} placeholder="González" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">RUT *</label>
                  <input name="rut" required onChange={handleChange} className={inputClass} placeholder="12.345.678-9" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Fecha Nacimiento</label>
                  <input type="date" name="fechaNacimiento" onChange={handleChange} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nacionalidad</label>
                  <input name="nacionalidad" value={formData.nacionalidad} onChange={handleChange} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Estado Civil</label>
                  <select name="estadoCivil" onChange={handleChange} className={inputClass}>
                    <option value="Soltero">Soltero/a</option>
                    <option value="Casado">Casado/a</option>
                    <option value="Divorciado">Divorciado/a</option>
                    <option value="Viudo">Viudo/a</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Sección: Contacto y Ubicación */}
            <div className="md:col-span-3 border-t border-slate-200 pt-6">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <MapPin size={16} /> Contacto
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Dirección Domicilio</label>
                  <input name="direccion" onChange={handleChange} className={inputClass} placeholder="Av. Principal 123, Comuna" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Teléfono</label>
                  <input name="phone" type="tel" onChange={handleChange} className={inputClass} placeholder="+569..." />
                </div>
              </div>
            </div>

            {/* Sección: Previsional y Salud */}
            <div className="md:col-span-3 border-t border-slate-200 pt-6">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Heart size={16} /> Previsión y Salud
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Sistema de Salud</label>
                  <input name="salud" onChange={handleChange} className={inputClass} placeholder="Fonasa / Isapre X" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">AFP</label>
                  <input name="afp" onChange={handleChange} className={inputClass} placeholder="Modelo, Habitat, etc." />
                </div>
              </div>
            </div>

            {/* Sección: Datos Laborales */}
            <div className="md:col-span-3 border-t border-slate-200 pt-6">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Briefcase size={16} /> Datos Laborales
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Cargo</label>
                  <input name="cargo" value={formData.cargo} onChange={handleChange} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Sucursal Asignada</label>
                  <select name="currentSiteId" onChange={(e) => setFormData(p => ({ ...p, currentSiteId: Number(e.target.value) }))} className={inputClass}>
                    <option value="">Seleccione Sucursal</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Sueldo Líquido</label>
                  <input type="number" name="sueldoLiquido" onChange={handleChange} className={inputClass} placeholder="0" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Vencimiento OS10</label>
                  <input type="date" name="fechaVencimientoOS10" onChange={handleChange} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Término Contrato</label>
                  <input type="date" name="fechaTerminoContrato" onChange={handleChange} className={inputClass} />
                </div>

                {/* Rol de usuario */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Rol Sistema</label>
                  <select name="role" onChange={handleChange} className={inputClass} defaultValue="worker">
                    <option value="worker">Guardia / Operativo</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Sección: Tallas y EPP */}
            <div className="md:col-span-3 border-t border-slate-200 pt-6">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Shield size={16} /> Uniforme y EPP
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Pantalón</label>
                  <input name="tallePantalon" onChange={handleChange} className={inputClass} placeholder="48" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Camisa</label>
                  <input name="talleCamisa" onChange={handleChange} className={inputClass} placeholder="L" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Chaqueta</label>
                  <input name="talleChaqueta" onChange={handleChange} className={inputClass} placeholder="L" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Polar</label>
                  <input name="tallePolar" onChange={handleChange} className={inputClass} placeholder="L" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Geólogo</label>
                  <input name="talleGeologo" onChange={handleChange} className={inputClass} placeholder="L" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Calzado</label>
                  <input name="talleCalzado" onChange={handleChange} className={inputClass} placeholder="42" />
                </div>
              </div>
            </div>

            {/* Sección: Información Extra */}
            <div className="md:col-span-3 border-t border-slate-200 pt-6">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Sparkles size={16} className="text-orange-400" /> Otros Datos
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Información Bancaria</label>
                  <input name="bancoInfo" onChange={handleChange} className={inputClass} placeholder="Banco, Tipo cuenta, Numero" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Contacto Emergencia</label>
                  <input name="contactoFamiliar" onChange={handleChange} className={inputClass} placeholder="Nombre y celular" />
                </div>
              </div>
            </div>

          </div>
        </form>

        {/* Footer Buttons */}
        <div className="p-6 border-t border-slate-200 bg-white flex justify-end gap-3">
          <button onClick={onClose} disabled={isLoading} className="px-6 py-2.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium transition bg-white">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={isLoading} className="px-6 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium flex items-center gap-2 transition shadow-lg shadow-blue-200">
            {isLoading ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
            {isLoading ? 'Creando Usuario...' : 'Guardar Colaborador'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddEmployeeModal;
