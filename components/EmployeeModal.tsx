
import React, { useState } from 'react';
import { Employee, Document } from '../types';
import { useAppStore } from '../store/useAppStore';
import { X, FileText, Edit2, Save, MapPin, User, Shield, Briefcase, Heart, AlertCircle, Trash2, AlertTriangle } from 'lucide-react';

interface EmployeeModalProps {
  employee: Employee;
  onClose: () => void;
}

const EmployeeModal: React.FC<EmployeeModalProps> = ({ employee, onClose }) => {
  const { documents, uploadDocument, updateEmployee, deleteEmployee, sites } = useAppStore();
  const [docType, setDocType] = useState<Document['type']>('Otro');
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Employee>(employee);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const empDocuments = documents.filter(d => d.employeeId === employee.id);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    uploadDocument({
      employeeId: employee.id,
      type: docType,
      fileName: file.name
    });
  };

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

  // Helper para renderizar campos
  const DataField = ({ label, value, name, type = "text", options = null, prefix = "" }: { label: string, value: any, name: string, type?: string, options?: any, prefix?: string }) => {

    // Lógica inteligente para mostrar el texto de la opción en lugar del ID (valor) cuando estamos en modo lectura
    const displayValue = options
      ? options.find((opt: any) => String(opt.val) === String(value))?.label || '---'
      : value || '---';

    return (
      <div className="flex flex-col space-y-1">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>
        {isEditing ? (
          options ? (
            <select
              name={name}
              value={value || ''}
              onChange={handleInputChange}
              className="w-full bg-blue-50/50 border-b-2 border-blue-200 p-1.5 text-sm font-medium focus:border-blue-500 outline-none transition-colors"
            >
              {options.map((opt: any) => <option key={opt.val} value={opt.val}>{opt.label}</option>)}
            </select>
          ) : (
            <div className="relative">
              {prefix && <span className="absolute left-2 top-1.5 text-slate-500 text-sm font-bold">{prefix}</span>}
              <input
                type={type}
                name={name}
                value={value || ''}
                onChange={handleInputChange}
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
                <DataField label="Nombres" value={editData.firstName} name="firstName" />
                <DataField label="Apellido Paterno" value={editData.lastNamePaterno} name="lastNamePaterno" />
                <DataField label="Apellido Materno" value={editData.lastNameMaterno} name="lastNameMaterno" />
                <DataField label="RUT / ID" value={editData.rut} name="rut" />
                <DataField label="Nacimiento" value={isEditing ? editData.fechaNacimiento?.split('T')[0] : (editData.fechaNacimiento ? new Date(editData.fechaNacimiento).toLocaleDateString() : 'N/A')} name="fechaNacimiento" type="date" />
                <DataField label="Nacionalidad" value={editData.nacionalidad} name="nacionalidad" />
              </div>
            </div>

            {/* SECCIÓN: CONTACTO */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <h3 className="flex items-center gap-2 text-xs font-black text-indigo-600 uppercase tracking-widest mb-6 pb-2 border-b border-indigo-50">
                <MapPin size={14} /> Contacto y Residencia
              </h3>
              <div className="space-y-5">
                <DataField label="Dirección Particular" value={editData.direccion} name="direccion" />
                <div className="grid grid-cols-2 gap-6">
                  <DataField label="Teléfono" value={editData.phone} name="phone" />
                  <DataField label="Correo Electrónico" value={editData.email} name="email" />
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
                  options={[
                    { val: 'Soltero', label: 'Soltero/a' },
                    { val: 'Casado', label: 'Casado/a' },
                    { val: 'Divorciado', label: 'Divorciado/a' },
                    { val: 'Viudo', label: 'Viudo/a' }
                  ]}
                />
                <DataField label="Sistema Salud" value={editData.salud} name="salud" />
                <DataField label="AFP / Previsión" value={editData.afp} name="afp" />
                <div className="flex flex-col space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Edad Actual</span>
                  <span className="text-slate-900 font-semibold text-sm">{calculateAge(employee.fechaNacimiento)}</span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-50 space-y-4">
                <DataField label="Información Bancaria" value={editData.bancoInfo} name="bancoInfo" />
                <DataField label="Contacto Emergencia" value={editData.contactoFamiliar} name="contactoFamiliar" />
              </div>
            </div>

            {/* SECCIÓN: UNIFORME Y EPP */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <h3 className="flex items-center gap-2 text-xs font-black text-orange-600 uppercase tracking-widest mb-6 pb-2 border-b border-orange-50">
                <Shield size={14} /> Uniforme y EPP (Tallas)
              </h3>
              <div className="grid grid-cols-3 gap-x-4 gap-y-5">
                <DataField label="Pantalón" value={editData.tallePantalon} name="tallePantalon" />
                <DataField label="Camisa" value={editData.talleCamisa} name="talleCamisa" />
                <DataField label="Chaqueta" value={editData.talleChaqueta} name="talleChaqueta" />
                <DataField label="Polar" value={editData.tallePolar} name="tallePolar" />
                <DataField label="Geólogo" value={editData.talleGeologo} name="talleGeologo" />
                <DataField label="Calzado" value={editData.talleCalzado} name="talleCalzado" />
              </div>
            </div>

            {/* SECCIÓN: LABORAL Y DOCUMENTOS */}
            <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <h3 className="flex items-center gap-2 text-xs font-black text-emerald-600 uppercase tracking-widest mb-6 pb-2 border-b border-emerald-50">
                <Briefcase size={14} /> Información Laboral
              </h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 mb-6">
                <DataField label="Cargo Actual" value={editData.cargo} name="cargo" />
                <DataField
                  label="Sucursal Asignada"
                  value={editData.currentSiteId}
                  name="currentSiteId"
                  options={[{ val: '', label: 'Sin Asignar' }, ...sites.map(s => ({ val: s.id, label: s.name }))]}
                />

                {/* Fechas con validación visual */}
                <div className="flex flex-col space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vencimiento OS10</span>
                  {isEditing ? (
                    <input type="date" name="fechaVencimientoOS10" value={editData.fechaVencimientoOS10?.split('T')[0]} onChange={handleInputChange} className="bg-blue-50/50 border-b-2 border-blue-200 p-1.5 text-sm font-medium focus:border-blue-500 outline-none transition-colors" />
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold ${editData.fechaVencimientoOS10 && new Date(editData.fechaVencimientoOS10) < new Date() ? 'text-red-600' : 'text-slate-900'}`}>
                        {editData.fechaVencimientoOS10 ? new Date(editData.fechaVencimientoOS10).toLocaleDateString() : 'Pendiente'}
                      </span>
                      {editData.fechaVencimientoOS10 && new Date(editData.fechaVencimientoOS10) < new Date() && <AlertCircle size={14} className="text-red-500" />}
                    </div>
                  )}
                </div>

                <div className="flex flex-col space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Término Contrato</span>
                  {isEditing ? (
                    <input type="date" name="fechaTerminoContrato" value={editData.fechaTerminoContrato?.split('T')[0]} onChange={handleInputChange} className="bg-blue-50/50 border-b-2 border-blue-200 p-1.5 text-sm font-medium focus:border-blue-500 outline-none transition-colors" />
                  ) : (
                    <span className="text-slate-900 font-bold text-sm">
                      {editData.fechaTerminoContrato ? new Date(editData.fechaTerminoContrato).toLocaleDateString() : 'Indefinido'}
                    </span>
                  )}
                </div>

                {/* SUELDO LIQUIDO */}
                <div className="flex flex-col space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sueldo Líquido</span>
                  {isEditing ? (
                    <input type="number" name="sueldoLiquido" value={editData.sueldoLiquido || ''} onChange={handleInputChange} className="bg-blue-50/50 border-b-2 border-blue-200 p-1.5 text-sm font-medium focus:border-blue-500 outline-none transition-colors" placeholder="0" />
                  ) : (
                    <span className="text-slate-900 font-bold text-sm flex items-center gap-1">
                      {editData.sueldoLiquido ? formatCurrency(editData.sueldoLiquido) : '---'}
                    </span>
                  )}
                </div>

              </div>
            </div>

          </div>

          {/* ÁREA DE DOCUMENTOS - ESTILO LISTA LIMPIA */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
              <h3 className="flex items-center gap-2 text-xs font-black text-slate-800 uppercase tracking-widest">
                <FileText size={16} className="text-blue-600" /> Historial Documental
              </h3>

              {!isEditing && (
                <div className="flex gap-2 w-full md:w-auto">
                  <select
                    className="flex-1 md:w-40 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
                    value={docType}
                    onChange={(e) => setDocType(e.target.value as any)}
                  >
                    <option value="Contrato">Contrato</option>
                    <option value="OS10">Curso OS10</option>
                    <option value="EPP">Registro EPP</option>
                    <option value="Foto">Fotografía</option>
                    <option value="Otro">Otro Doc.</option>
                  </select>
                  <label className="cursor-pointer bg-blue-600 text-white hover:bg-blue-700 text-xs font-bold py-2 px-6 rounded-xl flex items-center gap-2 transition shadow-md shadow-blue-100">
                    <FileText size={14} /> Subir Archivo
                    <input type="file" className="hidden" onChange={handleFileUpload} />
                  </label>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {empDocuments.length === 0 ? (
                <div className="col-span-full py-12 flex flex-col items-center justify-center bg-white rounded-xl border-2 border-dashed border-slate-200">
                  <FileText size={40} className="text-slate-200 mb-2" />
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Sin documentos adjuntos</p>
                </div>
              ) : (
                empDocuments.map(doc => (
                  <div key={doc.id} className="flex items-center gap-3 p-3 bg-white border border-slate-100 rounded-xl hover:border-blue-300 transition-all shadow-sm">
                    <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                      <FileText size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">{doc.fileName}</p>
                      <p className="text-[9px] text-slate-400 font-black uppercase">{doc.type} • {new Date(doc.uploadDate).toLocaleDateString()}</p>
                    </div>
                  </div>
                ))
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
