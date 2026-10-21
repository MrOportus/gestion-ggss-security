import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, FileText, CheckCircle2, AlertCircle, Calendar, Building, 
  Briefcase, Clock, Link2, ShieldAlert, RefreshCw, FileCheck
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { Contrato, EstadoContrato, EstadoDocumental, OrigenRegistroContrato } from '../types/phase1';
import { Employee } from '../types';
import { deleteField } from 'firebase/firestore';
import { formatDateDDMMYYYY } from '../lib/textUtils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  mode?: 'create' | 'renew' | 'edit' | 'link_doc';
  preselectedEmployee?: Employee | null;
  contratoAnterior?: Contrato | null;
  contratoToEdit?: Contrato | null;
  onSuccess?: (contratoId: string) => void;
}

export const ContractManagementModal: React.FC<Props> = ({
  isOpen,
  onClose,
  mode = 'create',
  preselectedEmployee = null,
  contratoAnterior = null,
  contratoToEdit = null,
  onSuccess
}) => {
  const { 
    employees, 
    sites, 
    digitalDocuments, 
    createContrato, 
    updateContrato, 
    renewContrato, 
    linkDocumentToContract,
    showNotification,
    currentUser
  } = useAppStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determinar empleado inicial
  const initialEmpId = useMemo(() => {
    if (preselectedEmployee?.id) return preselectedEmployee.id;
    if (contratoAnterior?.colaboradorId) return contratoAnterior.colaboradorId;
    if (contratoToEdit?.colaboradorId) return contratoToEdit.colaboradorId;
    return '';
  }, [preselectedEmployee, contratoAnterior, contratoToEdit]);

  const [selectedEmpId, setSelectedEmpId] = useState(initialEmpId);

  const selectedEmployee = useMemo(() => {
    return employees.find(e => e.id === selectedEmpId) || null;
  }, [employees, selectedEmpId]);

  // Form State
  const [formData, setFormData] = useState({
    sucursalId: '',
    tipo: 'Plazo Fijo',
    fechaInicio: new Date().toISOString().split('T')[0],
    fechaTermino: '',
    cargo: '',
    jornada: '45 horas semanales',
    estado: 'vigente' as EstadoContrato,
    estadoDocumental: 'no_adjunto' as EstadoDocumental,
    documentoId: '',
    googleDriveUrl: '',
    origenRegistro: (mode === 'renew' ? 'emision_sistema' : 'manual_aspro') as OrigenRegistroContrato,
    observacionesDocumento: '',
    observacionesConciliacion: '',
    fechaFirmaReal: '',
    permiteMultisucursal: false,
  });

  // Inicialización de valores según modo
  useEffect(() => {
    if (mode === 'edit' && contratoToEdit) {
      setSelectedEmpId(contratoToEdit.colaboradorId);
      setFormData({
        sucursalId: contratoToEdit.sucursalId || '0',
        tipo: contratoToEdit.tipo || 'Plazo Fijo',
        fechaInicio: contratoToEdit.fechaInicio || '',
        fechaTermino: contratoToEdit.fechaTermino || '',
        cargo: contratoToEdit.cargo || '',
        jornada: contratoToEdit.jornada || '',
        estado: contratoToEdit.estado || 'vigente',
        estadoDocumental: contratoToEdit.estadoDocumental || (contratoToEdit.documentoId ? 'firmado_digital' : 'no_adjunto'),
        documentoId: contratoToEdit.documentoId || '',
        googleDriveUrl: contratoToEdit.googleDriveUrl || '',
        origenRegistro: contratoToEdit.origenRegistro || 'manual_aspro',
        observacionesDocumento: contratoToEdit.observacionesDocumento || '',
        observacionesConciliacion: contratoToEdit.observacionesConciliacion || '',
        fechaFirmaReal: contratoToEdit.fechaFirmaReal || '',
        permiteMultisucursal: !!contratoToEdit.permiteMultisucursal,
      });
    } else if (mode === 'renew' && contratoAnterior) {
      setSelectedEmpId(contratoAnterior.colaboradorId);
      // Sugerir fecha de inicio un día después del término del anterior si existe
      let defaultStart = new Date().toISOString().split('T')[0];
      if (contratoAnterior.fechaTermino) {
        const d = new Date(contratoAnterior.fechaTermino + 'T00:00:00');
        d.setDate(d.getDate() + 1);
        defaultStart = d.toISOString().split('T')[0];
      }
      setFormData({
        sucursalId: contratoAnterior.sucursalId || '0',
        tipo: contratoAnterior.tipo === 'Plazo Fijo' ? 'Indefinido' : contratoAnterior.tipo,
        fechaInicio: defaultStart,
        fechaTermino: '',
        cargo: contratoAnterior.cargo || selectedEmployee?.cargo || '',
        jornada: contratoAnterior.jornada || '45 horas semanales',
        estado: 'vigente',
        estadoDocumental: 'no_adjunto',
        documentoId: '',
        googleDriveUrl: '',
        origenRegistro: 'emision_sistema',
        observacionesDocumento: `Renovación de contrato #${contratoAnterior.id}`,
        observacionesConciliacion: '',
        fechaFirmaReal: '',
        permiteMultisucursal: !!contratoAnterior.permiteMultisucursal,
      });
    } else if (preselectedEmployee) {
      setSelectedEmpId(preselectedEmployee.id);
      setFormData(prev => ({
        ...prev,
        sucursalId: preselectedEmployee.currentSiteId?.toString() || '0',
        cargo: preselectedEmployee.cargo || 'Guardia de Seguridad',
        tipo: preselectedEmployee.tipoContrato || 'Plazo Fijo',
        fechaInicio: preselectedEmployee.fechaInicioContrato?.split('T')[0] || new Date().toISOString().split('T')[0],
        fechaTermino: preselectedEmployee.fechaTerminoContrato?.split('T')[0] || '',
      }));
    }
  }, [mode, contratoToEdit, contratoAnterior, preselectedEmployee]);

  // Documentos digitales disponibles para el trabajador seleccionado
  const workerDigitalDocs = useMemo(() => {
    if (!selectedEmpId) return [];
    return digitalDocuments.filter(d => d.assignedTo === selectedEmpId);
  }, [digitalDocuments, selectedEmpId]);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData(prev => ({ ...prev, [name]: checked }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleDocumentSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const docId = e.target.value;
    if (!docId) {
      setFormData(prev => ({
        ...prev,
        documentoId: '',
        estadoDocumental: 'no_adjunto'
      }));
      return;
    }

    const docObj = workerDigitalDocs.find(d => d.id === docId);
    setFormData(prev => ({
      ...prev,
      documentoId: docId,
      estadoDocumental: docObj?.status === 'signed' ? 'firmado_digital' : 'pendiente_firma',
      googleDriveUrl: docObj?.signedUrl || docObj?.originalUrl || prev.googleDriveUrl
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedEmpId) {
      setError('Debes seleccionar o confirmar el colaborador.');
      return;
    }

    if (!formData.tipo || !formData.fechaInicio) {
      setError('Tipo de contrato y fecha de inicio son obligatorios.');
      return;
    }

    const isPlazoFijo = formData.tipo.toLowerCase().includes('plazo');
    if (isPlazoFijo && !formData.fechaTermino) {
      setError('Los contratos a plazo fijo requieren obligatoriamente una fecha de término.');
      return;
    }

    if (formData.fechaTermino && formData.fechaInicio > formData.fechaTermino) {
      setError('La fecha de inicio no puede ser posterior a la fecha de término.');
      return;
    }

    setLoading(true);

    try {
      const actorId = currentUser?.uid || 'admin_user';

      if (mode === 'edit' && contratoToEdit) {
        const editPayload: any = {
          sucursalId: formData.sucursalId || '0',
          tipo: formData.tipo,
          fechaInicio: formData.fechaInicio,
          cargo: formData.cargo?.trim() || '',
          jornada: formData.jornada?.trim() || '',
          estado: formData.estado,
          estadoDocumental: formData.estadoDocumental,
          permiteMultisucursal: !!formData.permiteMultisucursal,
        };

        if (formData.fechaTermino) {
          editPayload.fechaTermino = formData.fechaTermino;
        } else {
          editPayload.fechaTermino = deleteField();
        }

        if (formData.documentoId) {
          editPayload.documentoId = formData.documentoId;
        } else {
          editPayload.documentoId = deleteField();
        }

        if (formData.googleDriveUrl) {
          editPayload.googleDriveUrl = formData.googleDriveUrl;
        } else {
          editPayload.googleDriveUrl = deleteField();
        }

        if (formData.origenRegistro) {
          editPayload.origenRegistro = formData.origenRegistro;
        }

        if (formData.observacionesDocumento && formData.observacionesDocumento.trim()) {
          editPayload.observacionesDocumento = formData.observacionesDocumento.trim();
        } else {
          editPayload.observacionesDocumento = deleteField();
        }

        if (formData.observacionesConciliacion && formData.observacionesConciliacion.trim()) {
          editPayload.observacionesConciliacion = formData.observacionesConciliacion.trim();
        } else {
          editPayload.observacionesConciliacion = deleteField();
        }

        if (formData.fechaFirmaReal) {
          editPayload.fechaFirmaReal = formData.fechaFirmaReal;
        } else {
          editPayload.fechaFirmaReal = deleteField();
        }

        await updateContrato(contratoToEdit.id, editPayload);
        showNotification('Contrato actualizado exitosamente', 'success');
        if (onSuccess) onSuccess(contratoToEdit.id);
      } else if (mode === 'renew' && contratoAnterior) {
        const renewPayload: any = {
          colaboradorId: selectedEmpId,
          sucursalId: formData.sucursalId || '0',
          tipo: formData.tipo,
          fechaInicio: formData.fechaInicio,
          cargo: formData.cargo?.trim() || '',
          jornada: formData.jornada?.trim() || '',
          estado: formData.estado,
          estadoDocumental: formData.estadoDocumental,
          origenRegistro: formData.origenRegistro || 'manual_aspro',
          permiteMultisucursal: !!formData.permiteMultisucursal,
          creadoEn: new Date().toISOString(),
          creadoPor: actorId,
        };

        if (formData.fechaTermino) renewPayload.fechaTermino = formData.fechaTermino;
        if (formData.documentoId) renewPayload.documentoId = formData.documentoId;
        if (formData.googleDriveUrl) renewPayload.googleDriveUrl = formData.googleDriveUrl;
        if (formData.observacionesDocumento && formData.observacionesDocumento.trim()) {
          renewPayload.observacionesDocumento = formData.observacionesDocumento.trim();
        }
        if (formData.observacionesConciliacion && formData.observacionesConciliacion.trim()) {
          renewPayload.observacionesConciliacion = formData.observacionesConciliacion.trim();
        }
        if (formData.fechaFirmaReal) renewPayload.fechaFirmaReal = formData.fechaFirmaReal;

        const newId = await renewContrato(contratoAnterior.id, renewPayload);
        showNotification('Renovación registrada exitosamente. El contrato anterior fue archivado como Renovado.', 'success');
        if (onSuccess) onSuccess(newId);
      } else if (mode === 'link_doc' && contratoToEdit) {
        await linkDocumentToContract(
          contratoToEdit.id,
          formData.documentoId,
          formData.estadoDocumental,
          formData.observacionesDocumento?.trim() || undefined
        );
        showNotification('Documento vinculado exitosamente', 'success');
        if (onSuccess) onSuccess(contratoToEdit.id);
      } else {
        // Crear nuevo contrato
        const createPayload: any = {
          colaboradorId: selectedEmpId,
          sucursalId: formData.sucursalId || '0',
          tipo: formData.tipo,
          fechaInicio: formData.fechaInicio,
          cargo: formData.cargo?.trim() || '',
          jornada: formData.jornada?.trim() || '',
          estado: formData.estado,
          estadoDocumental: formData.estadoDocumental,
          origenRegistro: formData.origenRegistro || 'manual_aspro',
          permiteMultisucursal: !!formData.permiteMultisucursal,
          creadoEn: new Date().toISOString(),
          creadoPor: actorId,
        };

        if (formData.fechaTermino) createPayload.fechaTermino = formData.fechaTermino;
        if (formData.documentoId) createPayload.documentoId = formData.documentoId;
        if (formData.googleDriveUrl) createPayload.googleDriveUrl = formData.googleDriveUrl;
        if (formData.observacionesDocumento && formData.observacionesDocumento.trim()) {
          createPayload.observacionesDocumento = formData.observacionesDocumento.trim();
        }
        if (formData.observacionesConciliacion && formData.observacionesConciliacion.trim()) {
          createPayload.observacionesConciliacion = formData.observacionesConciliacion.trim();
        }
        if (formData.fechaFirmaReal) createPayload.fechaFirmaReal = formData.fechaFirmaReal;

        const newId = await createContrato(createPayload);
        showNotification('Contrato registrado exitosamente', 'success');
        if (onSuccess) onSuccess(newId);
      }

      onClose();
    } catch (err: any) {
      console.error('Error saving contract:', err);
      setError(err.message || 'Error al guardar el contrato.');
    } finally {
      setLoading(false);
    }
  };

  const getTitle = () => {
    switch (mode) {
      case 'renew': return 'Renovar Contrato de Trabajo';
      case 'edit': return 'Editar Registro Contractual';
      case 'link_doc': return 'Vincular Documento a Contrato';
      default: return 'Nuevo Registro Contractual';
    }
  };

  const getSubtitle = () => {
    if (selectedEmployee) {
      return `${selectedEmployee.firstName} ${selectedEmployee.lastNamePaterno} • ${selectedEmployee.rut}`;
    }
    return 'Complete la información contractual estructurada';
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="bg-slate-900 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 text-white">
            <div className="w-10 h-10 rounded-xl bg-blue-600/30 flex items-center justify-center text-blue-400">
              {mode === 'renew' ? <RefreshCw size={20} /> : <FileText size={20} />}
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">{getTitle()}</h2>
              <p className="text-xs text-slate-400 font-medium">{getSubtitle()}</p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-800"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-700">
              <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Banner de Referencia en Renovación */}
          {mode === 'renew' && contratoAnterior && (
            <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 text-xs text-blue-900 space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-blue-950">
                <FileCheck size={16} className="text-blue-600" />
                Contrato Previo a Renovar: #{contratoAnterior.id.slice(0, 14)}...
              </div>
              <p className="text-slate-600">
                Tipo: <strong className="text-slate-800">{contratoAnterior.tipo}</strong> • 
                Periodo: {formatDateDDMMYYYY(contratoAnterior.fechaInicio)} al {contratoAnterior.fechaTermino ? formatDateDDMMYYYY(contratoAnterior.fechaTermino) : 'Indefinido'} •
                Renovación actual: #{contratoAnterior.numeroRenovacion || 1}
              </p>
              <p className="text-[11px] text-blue-700 italic">
                Al confirmar, el contrato anterior quedará registrado en el historial como <strong>"Renovado"</strong> y el nuevo contrato tomará vigencia inmediata.
              </p>
            </div>
          )}

          {/* Banner Informativo de Ausencia Documental */}
          {!formData.documentoId && !formData.googleDriveUrl && formData.estadoDocumental === 'no_adjunto' && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2.5">
              <ShieldAlert className="text-amber-600 shrink-0 mt-0.5" size={16} />
              <div>
                <strong>Registro sin respaldo digital adjunto:</strong> Se guardará la existencia y fechas del contrato para propósitos de gestión. No se marcará como verificado documentalmente hasta adjuntar o vincular el PDF firmado.
              </div>
            </div>
          )}

          <form id="contract-form" onSubmit={handleSubmit} className="space-y-4">
            
            {/* Selector de Colaborador (solo si no viene preseleccionado) */}
            {!preselectedEmployee && mode !== 'edit' && mode !== 'renew' && (
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Colaborador <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedEmpId}
                  onChange={(e) => setSelectedEmpId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none"
                  required
                >
                  <option value="">-- Seleccionar Trabajador --</option>
                  {employees.filter(e => e.isActive).map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.firstName} {emp.lastNamePaterno} {emp.lastNameMaterno || ''} ({emp.rut})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Tipo de Contrato */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Tipo de Contrato <span className="text-red-500">*</span>
                </label>
                <select
                  name="tipo"
                  value={formData.tipo}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none"
                  required
                >
                  <option value="Plazo Fijo">Plazo Fijo</option>
                  <option value="Indefinido">Indefinido</option>
                  <option value="Obra y Faena">Obra y Faena</option>
                </select>
              </div>

              {/* Sucursal Asignada / Convenida */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Sucursal de Referencia <span className="text-red-500">*</span>
                </label>
                <select
                  name="sucursalId"
                  value={formData.sucursalId}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none"
                  required
                >
                  <option value="0">Contrato General / Multisitio (Sin sucursal exclusiva)</option>
                  {sites.filter(s => s.active).map(site => (
                    <option key={site.id} value={site.id}>{site.name}</option>
                  ))}
                </select>
              </div>

              {/* Fecha Inicio */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Calendar size={13} className="text-slate-400" />
                  Fecha de Inicio <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  name="fechaInicio"
                  value={formData.fechaInicio}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none"
                  required
                />
              </div>

              {/* Fecha Término */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Calendar size={13} className="text-slate-400" />
                  Fecha de Término
                  {formData.tipo.includes('Plazo') && <span className="text-red-500 font-bold">*</span>}
                  {!formData.tipo.includes('Plazo') && <span className="text-slate-400 font-normal text-[10px]">(Opcional)</span>}
                </label>
                <input
                  type="date"
                  name="fechaTermino"
                  value={formData.fechaTermino}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none"
                  required={formData.tipo.includes('Plazo')}
                />
              </div>

              {/* Cargo */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Briefcase size={13} className="text-slate-400" />
                  Cargo
                </label>
                <input
                  type="text"
                  name="cargo"
                  value={formData.cargo}
                  onChange={handleChange}
                  placeholder="Ej: Guardia de Seguridad OS-10"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none"
                />
              </div>

              {/* Jornada */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Clock size={13} className="text-slate-400" />
                  Jornada / Horario
                </label>
                <input
                  type="text"
                  name="jornada"
                  value={formData.jornada}
                  onChange={handleChange}
                  placeholder="Ej: 45 horas semanales / 4x4"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none"
                />
              </div>

              {/* Estado Contractual */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Estado Contractual
                </label>
                <select
                  name="estado"
                  value={formData.estado}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none"
                >
                  <option value="vigente">Vigente</option>
                  <option value="pendiente_firma">Pendiente de Firma</option>
                  <option value="borrador">Borrador / Datos Incompletos</option>
                  <option value="vencido">Vencido (Histórico)</option>
                  <option value="finiquitado">Finiquitado</option>
                </select>
              </div>

              {/* Origen del Registro */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Origen del Registro
                </label>
                <select
                  name="origenRegistro"
                  value={formData.origenRegistro}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none"
                >
                  <option value="manual_aspro">Ingreso Manual ASPRO</option>
                  <option value="externo_firmado">Firmado Externamente</option>
                  <option value="emision_sistema">Generado en Sistema (Apps Script/Drive)</option>
                  <option value="historico_legacy">Histórico / Regularización Legacy</option>
                  <option value="importacion_documental">Importación Documental</option>
                </select>
              </div>

            </div>

            {/* SECCIÓN DOCUMENTAL: VINCULAR PDF */}
            <div className="pt-2 border-t border-slate-200">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Link2 size={14} className="text-blue-600" />
                Respaldo Documental
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Selector de Documento Digital Existente */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Vincular Documento Digital (Firma Electrónica)
                  </label>
                  <select
                    value={formData.documentoId}
                    onChange={handleDocumentSelect}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none"
                  >
                    <option value="">-- Sin documento digital vinculado --</option>
                    {workerDigitalDocs.map(doc => (
                      <option key={doc.id} value={doc.id}>
                        {doc.title} ({doc.status === 'signed' ? 'Firmado' : 'Pendiente'}) - {formatDateDDMMYYYY(doc.createdAt)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Estado Documental */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Estado Documental Legal
                  </label>
                  <select
                    name="estadoDocumental"
                    value={formData.estadoDocumental}
                    onChange={handleChange}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none"
                  >
                    <option value="no_adjunto">No Adjunto / Físico sin digitalizar</option>
                    <option value="firmado_digital">Firmado Digitalmente (ASPRO)</option>
                    <option value="firmado_externo">Firmado Externamente (Papel / Notaría)</option>
                    <option value="generado_drive">Generado en Google Drive</option>
                    <option value="pendiente_firma">Pendiente de Firma</option>
                    <option value="archivado_externo">Archivado en Expediente Físico</option>
                    <option value="pendiente_verificacion">Pendiente de Verificación</option>
                  </select>
                </div>

                {/* URL Externa / Drive si aplica */}
                <div className="col-span-1 md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Enlace de Descarga / URL Externa de Respaldo (Opcional)
                  </label>
                  <input
                    type="url"
                    name="googleDriveUrl"
                    value={formData.googleDriveUrl}
                    onChange={handleChange}
                    placeholder="https://drive.google.com/... o enlace al repositorio"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Checkbox Multisucursal */}
            <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <input
                type="checkbox"
                id="permiteMultisucursal"
                name="permiteMultisucursal"
                checked={formData.permiteMultisucursal}
                onChange={handleChange}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
              />
              <label htmlFor="permiteMultisucursal" className="text-xs text-slate-700 cursor-pointer">
                <strong>Habilitado para coberturas multisucursal:</strong> El trabajador puede cubrir turnos extraordinarios o servicios bajo demanda (ej. Falabella) sin reportar conflicto de sucursal.
              </label>
            </div>

            {/* Observaciones */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Observaciones Administrativas / Conciliación
              </label>
              <textarea
                name="observacionesDocumento"
                value={formData.observacionesDocumento}
                onChange={handleChange}
                rows={2}
                placeholder="Indique ubicación del documento físico, antecedentes de la firma o notas de RR. HH."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none resize-none"
              />
            </div>

          </form>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 transition"
          >
            Cancelar
          </button>
          <button
            form="contract-form"
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition disabled:opacity-50"
          >
            {loading ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <CheckCircle2 size={16} />
                {mode === 'renew' ? 'Confirmar Renovación' : mode === 'edit' ? 'Guardar Cambios' : 'Registrar Contrato'}
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
