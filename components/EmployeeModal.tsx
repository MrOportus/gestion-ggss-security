
import React, { useState } from 'react';
import { Employee, Document } from '../types';
import { useAppStore } from '../store/useAppStore';
import { X, FileText, Edit2, Save, MapPin, User, Shield, Briefcase, Heart, AlertCircle, Trash2, AlertTriangle, Download } from 'lucide-react';
import GeneratePasswordButton from './GeneratePasswordButton';

interface EmployeeModalProps {
  employee: Employee;
  onClose: () => void;
}

// Helper para renderizar campos - Movido fuera del componente para evitar recreación y pérdida de foco
const DataField = ({ label, value, name, type = "text", options = null, searchable = false, prefix = "", isEditing, onChange, displayValue: customDisplayValue }: {
  label: string,
  value: any,
  name: string,
  type?: string,
  options?: any,
  searchable?: boolean,
  prefix?: string,
  isEditing: boolean,
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void,
  displayValue?: string
}) => {

  // Lógica inteligente para mostrar el texto de la opción en lugar del ID (valor) cuando estamos en modo lectura
  const displayValue = customDisplayValue || (options
    ? options.find((opt: any) => String(opt.val) === String(value))?.label || '---'
    : value || '---');

  return (
    <div className="flex flex-col space-y-1">
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>
      {isEditing ? (
        options && !searchable ? (
          <select
            name={name}
            value={value || ''}
            onChange={onChange}
            className="w-full bg-blue-50/50 border-b-2 border-blue-200 p-1.5 text-sm font-medium focus:border-blue-500 outline-none transition-colors"
          >
            {options.map((opt: any) => <option key={opt.val} value={opt.val}>{opt.label}</option>)}
          </select>
        ) : options && searchable ? (
          <div className="relative">
            <input
              list={`list-${name}`}
              name={name}
              defaultValue={options.find((o: any) => String(o.val) === String(value))?.label || ''}
              onChange={(e) => {
                const matched = options.find((o: any) => o.label === e.target.value);
                if (matched) {
                  onChange({ target: { name, value: matched.val } } as any);
                } else {
                  onChange({ target: { name, value: '' } } as any);
                }
              }}
              className="w-full bg-blue-50/50 border-b-2 border-blue-200 p-1.5 text-sm font-medium focus:border-blue-500 outline-none transition-colors"
            />
            <datalist id={`list-${name}`}>
              {options.map((opt: any) => <option key={opt.val} value={opt.label} />)}
            </datalist>
          </div>
        ) : (
          <div className="relative">
            {prefix && <span className="absolute left-2 top-1.5 text-slate-500 text-sm font-bold">{prefix}</span>}
            <input
              type={type}
              name={name}
              value={value || ''}
              onChange={onChange}
              className={`w-full bg-blue-50/50 border-b-2 border-blue-200 p-1.5 text-sm font-medium focus:border-blue-500 outline-none transition-colors ${prefix ? 'pl-6' : ''}`}
            />
          </div>
        )
      ) : (
        <span className="text-slate-900 font-semibold text-sm border-b border-transparent">
          {prefix}{displayValue}
        </span>
      )}
    </div>
  );
};

const EmployeeModal: React.FC<EmployeeModalProps> = ({ employee, onClose }) => {
  const { updateEmployee, deleteEmployee, sites, contractHistory } = useAppStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Employee>(employee);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const employeeFullName = `${employee.firstName} ${employee.lastNamePaterno}`;
  const employeeContracts = (contractHistory || [])
    .filter(c => c.workerName.toLowerCase() === employeeFullName.toLowerCase())
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10);

  const calculateAge = (dateString?: string) => {
    if (!dateString) return 'N/A';
    const today = new Date();
    const birthDate = new Date(dateString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age + ' años';
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setEditData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    await updateEmployee(employee.id, editData);
    setIsEditing(false);
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    await deleteEmployee(employee.id);
    onClose();
  };

  // Formateador de moneda
  const formatCurrency = (amount?: number) => {
    if (!amount) return '';
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
  };

  // VISTA DE CONFIRMACIÓN
  if (showDeleteConfirm) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 z-[60] animate-in fade-in duration-200">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 text-center space-y-6 animate-in zoom-in-95 duration-200 border-2 border-red-100">
          <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-600 shadow-sm">
            <AlertTriangle size={32} />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900 leading-tight">¿Está seguro que desea eliminar a este colaborador?</h3>
            <p className="text-slate-500 mt-3 font-medium text-sm leading-relaxed">
              Esta acción eliminará permanentemente la ficha de <span className="font-bold text-slate-800">{employee.firstName} {employee.lastNamePaterno}</span>. No podrá recuperar la información después de esta eliminación.
            </p>
          </div>

          <div className="flex gap-4 pt-4">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 px-4 py-3 border border-slate-300 rounded-xl text-slate-700 font-bold hover:bg-slate-50 transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              className="flex-1 px-4 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition shadow-lg shadow-red-200 flex items-center justify-center gap-2"
            >
              <Trash2 size={20} /> Eliminar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // VISTA NORMAL
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-300">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col border border-slate-200">

        {/* Cabecera Estilo Perfil */}
        <div className="relative bg-slate-50 border-b border-slate-100 p-6">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white text-3xl font-bold shadow-lg shadow-blue-200">
              {employee.firstName[0]}{employee.lastNamePaterno[0]}
            </div>

            <div className="flex-1 text-center md:text-left">
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
                <h2 className="text-2xl font-black text-slate-900 uppercase">
                  {employee.firstName} {employee.lastNamePaterno} {employee.lastNameMaterno}
                </h2>
                <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${employee.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {employee.isActive ? 'Personal Activo' : 'Personal Inactivo'}
                </span>
              </div>
              <p className="text-slate-500 font-medium flex items-center justify-center md:justify-start gap-2 mt-1">
                <Shield size={14} className="text-blue-500" /> {employee.cargo} • ID: {employee.rut}
              </p>
              <div className="mt-2">
                <GeneratePasswordButton employee={employee} />
              </div>
            </div>

            <div className="flex gap-2">
              {!isEditing ? (
                <button onClick={() => setIsEditing(true)} className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition shadow-sm font-bold text-sm">
                  <Edit2 size={16} className="text-blue-600" /> Editar Ficha
                </button>
              ) : (
                <>
                  <button onClick={() => setIsEditing(false)} className="px-5 py-2.5 text-slate-500 font-bold text-sm hover:text-slate-800 transition">Cancelar</button>
                  <button onClick={handleSave} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-200 font-bold text-sm">
                    <Save size={16} /> Guardar Cambios
                  </button>
                </>
              )}
              <button onClick={onClose} className="p-2.5 text-slate-400 hover:text-slate-900 transition bg-white border border-slate-200 rounded-xl ml-2"><X /></button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-white space-y-8">

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* SECCIÓN: IDENTIFICACIÓN */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <h3 className="flex items-center gap-2 text-xs font-black text-blue-600 uppercase tracking-widest mb-6 pb-2 border-b border-blue-50">
                <User size={14} /> Datos de Identidad
              </h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                <DataField label="Nombres" value={editData.firstName} name="firstName" isEditing={isEditing} onChange={handleInputChange} />
                <DataField label="Apellido Paterno" value={editData.lastNamePaterno} name="lastNamePaterno" isEditing={isEditing} onChange={handleInputChange} />
                <DataField label="Apellido Materno" value={editData.lastNameMaterno} name="lastNameMaterno" isEditing={isEditing} onChange={handleInputChange} />
                <DataField label="RUT / ID" value={editData.rut} name="rut" isEditing={isEditing} onChange={handleInputChange} />
                <DataField label="Código Interno" value={editData.codigo} name="codigo" isEditing={isEditing} onChange={handleInputChange} />
                <DataField label="Nacimiento" value={editData.fechaNacimiento?.split('T')[0]} displayValue={editData.fechaNacimiento ? editData.fechaNacimiento.split('T')[0].split('-').reverse().join('/') : 'N/A'} name="fechaNacimiento" type="date" isEditing={isEditing} onChange={handleInputChange} />
                <DataField label="Nacionalidad" value={editData.nacionalidad} name="nacionalidad" isEditing={isEditing} onChange={handleInputChange} />

              </div>
            </div>

            {/* SECCIÓN: CONTACTO */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <h3 className="flex items-center gap-2 text-xs font-black text-indigo-600 uppercase tracking-widest mb-6 pb-2 border-b border-indigo-50">
                <MapPin size={14} /> Contacto y Residencia
              </h3>
              <div className="space-y-5">
                <DataField label="Dirección Particular" value={editData.direccion} name="direccion" isEditing={isEditing} onChange={handleInputChange} />
                <div className="grid grid-cols-2 gap-6">
                  <DataField label="Teléfono" value={editData.phone} name="phone" isEditing={isEditing} onChange={handleInputChange} />
                  <DataField label="Correo Electrónico" value={editData.email} name="email" isEditing={isEditing} onChange={handleInputChange} />
                </div>
              </div>
            </div>

            {/* SECCIÓN: PREVISIÓN Y BIENESTAR */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <h3 className="flex items-center gap-2 text-xs font-black text-rose-600 uppercase tracking-widest mb-6 pb-2 border-b border-rose-50">
                <Heart size={14} /> Previsión y Bienestar
              </h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                <DataField
                  label="Estado Civil"
                  value={editData.estadoCivil}
                  name="estadoCivil"
                  isEditing={isEditing}
                  onChange={handleInputChange}
                  options={[
                    { val: 'Soltero', label: 'Soltero/a' },
                    { val: 'Casado', label: 'Casado/a' },
                    { val: 'Divorciado', label: 'Divorciado/a' },
                    { val: 'Viudo', label: 'Viudo/a' }
                  ]}
                />
                <DataField label="Sistema Salud" value={editData.salud} name="salud" isEditing={isEditing} onChange={handleInputChange} />
                <DataField label="AFP / Previsión" value={editData.afp} name="afp" isEditing={isEditing} onChange={handleInputChange} />
                <div className="flex flex-col space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Edad Actual</span>
                  <span className="text-slate-900 font-semibold text-sm">{calculateAge(employee.fechaNacimiento)}</span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-50 space-y-4">
                <DataField label="Información Bancaria" value={editData.bancoInfo} name="bancoInfo" isEditing={isEditing} onChange={handleInputChange} />
                <DataField label="Contacto Emergencia" value={editData.contactoFamiliar} name="contactoFamiliar" isEditing={isEditing} onChange={handleInputChange} />
              </div>
            </div>

            {/* SECCIÓN: UNIFORME Y EPP */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <h3 className="flex items-center gap-2 text-xs font-black text-orange-600 uppercase tracking-widest mb-6 pb-2 border-b border-orange-50">
                <Shield size={14} /> Uniforme y EPP (Tallas)
              </h3>
              <div className="grid grid-cols-3 gap-x-4 gap-y-5">
                <DataField label="Pantalón" value={editData.tallePantalon} name="tallePantalon" isEditing={isEditing} onChange={handleInputChange} />
                <DataField label="Camisa" value={editData.talleCamisa} name="talleCamisa" isEditing={isEditing} onChange={handleInputChange} />
                <DataField label="Chaqueta" value={editData.talleChaqueta} name="talleChaqueta" isEditing={isEditing} onChange={handleInputChange} />
                <DataField label="Polar" value={editData.tallePolar} name="tallePolar" isEditing={isEditing} onChange={handleInputChange} />
                <DataField label="Geólogo" value={editData.talleGeologo} name="talleGeologo" isEditing={isEditing} onChange={handleInputChange} />
                <DataField label="Calzado" value={editData.talleCalzado} name="talleCalzado" isEditing={isEditing} onChange={handleInputChange} />
              </div>
            </div>

            {/* SECCIÓN: LABORAL Y DOCUMENTOS */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <h3 className="flex items-center gap-2 text-xs font-black text-emerald-600 uppercase tracking-widest mb-6 pb-2 border-b border-emerald-50">
                <Briefcase size={14} /> Información Laboral
              </h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 mb-6">
                <DataField
                  label="Cargo Actual"
                  value={editData.cargo}
                  name="cargo"
                  isEditing={isEditing}
                  onChange={handleInputChange}
                  options={[
                    { val: 'Admin', label: 'Admin' },
                    { val: 'Supervisor', label: 'Supervisor' },
                    { val: 'GUARDIA DE SEGURIDAD', label: 'GUARDIA DE SEGURIDAD' }
                  ]}
                />
                <DataField
                  label="Sucursal Asignada"
                  value={editData.currentSiteId}
                  name="currentSiteId"
                  isEditing={isEditing}
                  searchable={true}
                  onChange={handleInputChange}
                  options={[{ val: '', label: 'Sin Asignar' }, ...sites.map(s => ({ val: s.id, label: s.name }))]}
                />

                <DataField
                  label="Rol de Sistema"
                  value={editData.role}
                  name="role"
                  isEditing={isEditing}
                  onChange={handleInputChange}
                  options={[
                    { val: 'worker', label: 'Guardia / Operativo' },
                    { val: 'supervisor', label: 'Supervisor' },
                    { val: 'admin', label: 'Administrador' },
                    { val: 'mandante', label: 'Mandante / Cliente' }
                  ]}
                />

                <DataField
                  label="Vencimiento OS10"
                  value={editData.fechaVencimientoOS10?.split('T')[0]}
                  displayValue={editData.fechaVencimientoOS10 ? new Date(editData.fechaVencimientoOS10).toLocaleDateString() : 'Pendiente'}
                  name="fechaVencimientoOS10"
                  type="date"
                  isEditing={isEditing}
                  onChange={handleInputChange}
                />

                <DataField
                  label="Inicio Contrato"
                  value={editData.fechaInicioContrato?.split('T')[0]}
                  displayValue={editData.fechaInicioContrato ? new Date(editData.fechaInicioContrato).toLocaleDateString() : 'No registrada'}
                  name="fechaInicioContrato"
                  type="date"
                  isEditing={isEditing}
                  onChange={handleInputChange}
                />

                <DataField
                  label="Tipo de Contrato"
                  value={editData.tipoContrato || 'Plazo Fijo'}
                  name="tipoContrato"
                  isEditing={isEditing}
                  onChange={handleInputChange}
                  options={[
                    { val: 'Plazo Fijo', label: 'Plazo Fijo' },
                    { val: 'Indefinido', label: 'Indefinido' },
                    { val: 'Obra y Faena', label: 'Obra y Faena' }
                  ]}
                />

                {(!editData.tipoContrato || editData.tipoContrato === 'Plazo Fijo') && (
                  <DataField
                    label="Término Contrato"
                    value={editData.fechaTerminoContrato?.split('T')[0]}
                    displayValue={editData.fechaTerminoContrato ? new Date(editData.fechaTerminoContrato).toLocaleDateString() : 'No registrada'}
                    name="fechaTerminoContrato"
                    type="date"
                    isEditing={isEditing}
                    onChange={handleInputChange}
                  />
                )}

                <DataField
                  label="Sueldo Líquido"
                  value={editData.sueldoLiquido}
                  displayValue={editData.sueldoLiquido ? formatCurrency(editData.sueldoLiquido) : '---'}
                  name="sueldoLiquido"
                  type="number"
                  isEditing={isEditing}
                  onChange={handleInputChange}
                />

              </div>
            </div>

          </div>

          {/* ÁREA DE DOCUMENTOS - ÚLTIMOS CONTRATOS */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 flex flex-col items-center">
            <div className="w-full lg:w-4/5">
              <h3 className="flex items-center gap-2 text-xs font-black text-slate-800 uppercase tracking-widest mb-6">
                <FileText size={16} className="text-blue-600" /> Registro de Contratos Previos
              </h3>
              
              {employeeContracts.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center bg-white rounded-xl border-2 border-dashed border-slate-200">
                  <FileText size={40} className="text-slate-200 mb-2" />
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Sin contratos generados</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {employeeContracts.map(contract => {
                    const fileIdMatch = contract.downloadUrl.match(/[\w-]{33,}/);
                    const directDownloadUrl = fileIdMatch ? `https://drive.google.com/uc?export=download&id=${fileIdMatch[0]}` : contract.downloadUrl;
                    
                    return (
                      <div key={contract.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-white border border-slate-100 rounded-xl hover:border-blue-300 transition-all shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                            <FileText size={20} />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-800">{contract.siteName}</p>
                            <p className="text-[10px] text-slate-500 font-bold uppercase mt-0.5">
                              Generado: {new Date(contract.timestamp).toLocaleDateString()} 
                              {contract.fechaInicio && ` • Inicio: ${new Date(contract.fechaInicio).toLocaleDateString()}`}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex w-full sm:w-auto items-center gap-2 shrink-0">
                          <a 
                            href={contract.downloadUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold text-xs transition-colors"
                          >
                            <FileText size={14} /> Ver
                          </a>
                          <a 
                            href={directDownloadUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            download={`Contrato_${employee.firstName}_${employee.lastNamePaterno}.pdf`}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs transition-colors shadow-sm"
                          >
                            <Download size={14} /> Descargar
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ZONA DE PELIGRO - ELIMINAR */}
          {isEditing && (
            <div className="mt-8 border-t-2 border-red-100 pt-6">
              <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                  <h4 className="text-red-700 font-bold flex items-center gap-2 mb-1">
                    <AlertCircle size={18} /> Zona de Peligro
                  </h4>
                  <p className="text-red-600 text-xs">
                    Eliminar a este colaborador borrará todos sus datos y registros de asistencia permanentemente.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  className="bg-white border-2 border-red-200 text-red-600 hover:bg-red-600 hover:text-white hover:border-red-600 px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm flex items-center gap-2 whitespace-nowrap"
                >
                  <Trash2 size={16} /> Eliminar Colaborador
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Footer de Estado de Sincronización */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 text-center">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sincronizado con base de datos en tiempo real • GGSS Security v1.2</p>
        </div>
      </div>
    </div>
  );
};

export default EmployeeModal;
