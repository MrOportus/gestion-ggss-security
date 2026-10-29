import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  FileText,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Building,
  Briefcase,
  Clock,
  Link2,
  CalendarClock,
  Search,
  User
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { Contrato, EstadoContrato, EstadoDocumental, OrigenRegistroContrato } from '../types/phase1';
import { Employee } from '../types';
import { deleteField } from 'firebase/firestore';
import { formatDateDDMMYYYY, normalizeText } from '../lib/textUtils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  mode?: 'create' | 'renew' | 'edit' | 'link_doc';
  preselectedEmployee?: Employee | null;
  contratoAnterior?: Contrato | null;
  contratoToEdit?: Contrato | null;
  onSuccess?: (contratoId: string) => void;
}

const DEFAULT_CARGO = 'Guardia de Seguridad';
const VALID_CONTRACT_TYPES = ['Plazo Fijo', 'Part-Time', 'Obra y Faena', 'Indefinido'];

function normalizeContractType(raw?: string): string {
  if (!raw) return 'Plazo Fijo';
  if (VALID_CONTRACT_TYPES.includes(raw)) return raw;
  const lower = raw.toLowerCase();
  if (lower.includes('part')) return 'Part-Time';
  if (lower.includes('faena') || lower.includes('obra')) return 'Obra y Faena';
  if (lower.includes('indefinido')) return 'Indefinido';
  return 'Plazo Fijo';
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
    contratos,
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
  const [workerSearch, setWorkerSearch] = useState('');
  const [siteSearch, setSiteSearch] = useState('');

  const isRegularizationMode = mode === 'create' || mode === 'renew';

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

  // Form State — cargo siempre mantiene por defecto "Guardia de Seguridad"
  const [formData, setFormData] = useState({
    sucursalId: '0',
    tipo: 'Plazo Fijo',
    fechaInicio: new Date().toISOString().split('T')[0],
    fechaTermino: '',
    cargo: DEFAULT_CARGO,
    jornada: '45 horas semanales',
    estado: 'vigente' as EstadoContrato,
    estadoDocumental: 'no_adjunto' as EstadoDocumental,
    documentoId: '',
    googleDriveUrl: '',
    origenRegistro: 'manual_aspro' as OrigenRegistroContrato,
    observacionesDocumento: '',
    observacionesConciliacion: '',
    fechaFirmaReal: '',
    permiteMultisucursal: false
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
        cargo: contratoToEdit.cargo || DEFAULT_CARGO,
        jornada: contratoToEdit.jornada || '45 horas semanales',
        estado: contratoToEdit.estado || 'vigente',
        estadoDocumental:
          contratoToEdit.estadoDocumental || (contratoToEdit.documentoId ? 'firmado_digital' : 'no_adjunto'),
        documentoId: contratoToEdit.documentoId || '',
        googleDriveUrl: contratoToEdit.googleDriveUrl || '',
        origenRegistro: contratoToEdit.origenRegistro || 'manual_aspro',
        observacionesDocumento: contratoToEdit.observacionesDocumento || '',
        observacionesConciliacion: contratoToEdit.observacionesConciliacion || '',
        fechaFirmaReal: contratoToEdit.fechaFirmaReal || '',
        permiteMultisucursal: !!contratoToEdit.permiteMultisucursal
      });
    } else if (preselectedEmployee || contratoAnterior) {
      const empId = preselectedEmployee?.id || contratoAnterior?.colaboradorId || '';
      setSelectedEmpId(empId);

      const resolvedSite =
        (contratoAnterior?.sucursalId && contratoAnterior.sucursalId !== '0'
          ? String(contratoAnterior.sucursalId)
          : preselectedEmployee?.currentSiteId
          ? String(preselectedEmployee.currentSiteId)
          : '0');

      const resolvedStart =
        contratoAnterior?.fechaInicio ||
        preselectedEmployee?.fechaInicioContrato?.split('T')[0] ||
        new Date().toISOString().split('T')[0];

      const resolvedEnd =
        contratoAnterior?.fechaTermino ||
        preselectedEmployee?.fechaTerminoContrato?.split('T')[0] ||
        '';

      const resolvedTipo = normalizeContractType(
        contratoAnterior?.tipo || preselectedEmployee?.tipoContrato
      );

      setFormData({
        sucursalId: resolvedSite,
        tipo: resolvedTipo,
        fechaInicio: resolvedStart,
        fechaTermino: resolvedEnd,
        cargo: DEFAULT_CARGO,
        jornada: contratoAnterior?.jornada || '45 horas semanales',
        estado: 'vigente',
        estadoDocumental: 'no_adjunto',
        documentoId: '',
        googleDriveUrl: '',
        origenRegistro: 'manual_aspro',
        observacionesDocumento: '',
        observacionesConciliacion: '',
        fechaFirmaReal: '',
        permiteMultisucursal: !!contratoAnterior?.permiteMultisucursal
      });
    } else {
      setSelectedEmpId('');
      setFormData({
        sucursalId: '0',
        tipo: 'Plazo Fijo',
        fechaInicio: new Date().toISOString().split('T')[0],
        fechaTermino: '',
        cargo: DEFAULT_CARGO,
        jornada: '45 horas semanales',
        estado: 'vigente',
        estadoDocumental: 'no_adjunto',
        documentoId: '',
        googleDriveUrl: '',
        origenRegistro: 'manual_aspro',
        observacionesDocumento: '',
        observacionesConciliacion: '',
        fechaFirmaReal: '',
        permiteMultisucursal: false
      });
    }
  }, [mode, contratoToEdit, contratoAnterior, preselectedEmployee]);

  // Al seleccionar un trabajador desde el buscador (cuando se abre desde el botón superior), precargar su sucursal y fechas si existen
  const handleSelectEmployee = (empId: string) => {
    setSelectedEmpId(empId);
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;

    const existingContracts = (contratos || []).filter(
      c => c.colaboradorId === empId && c.estado !== 'anulado'
    );
    const latestContract = existingContracts[0] || null;

    setFormData(prev => ({
      ...prev,
      sucursalId:
        latestContract?.sucursalId && latestContract.sucursalId !== '0'
          ? String(latestContract.sucursalId)
          : emp.currentSiteId
          ? String(emp.currentSiteId)
          : prev.sucursalId || '0',
      tipo: normalizeContractType(latestContract?.tipo || emp.tipoContrato || prev.tipo),
      fechaInicio:
        latestContract?.fechaInicio ||
        emp.fechaInicioContrato?.split('T')[0] ||
        prev.fechaInicio,
      fechaTermino:
        latestContract?.fechaTermino ||
        emp.fechaTerminoContrato?.split('T')[0] ||
        prev.fechaTermino,
      cargo: DEFAULT_CARGO
    }));
  };

  // Filtrado de trabajadores para el selector rápido
  const filteredEmployees = useMemo(() => {
    const term = normalizeText(workerSearch);
    const base = employees;
    if (!term) return base;
    return base.filter(emp => {
      const fullName = normalizeText(
        `${emp.firstName || ''} ${emp.lastNamePaterno || ''} ${emp.lastNameMaterno || ''}`
      );
      const rut = normalizeText(emp.rut || '');
      return fullName.includes(term) || rut.includes(term);
    });
  }, [employees, workerSearch]);

  // Filtrado de sucursales por texto
  const filteredSites = useMemo(() => {
    const activeSites = sites.filter(s => s.active);
    const term = normalizeText(siteSearch);
    if (!term) return activeSites;
    return activeSites.filter(s => normalizeText(s.name || '').includes(term));
  }, [sites, siteSearch]);

  // Documentos digitales disponibles para el trabajador seleccionado (solo usado en modo edit / link_doc)
  const workerDigitalDocs = useMemo(() => {
    if (!selectedEmpId) return [];
    return digitalDocuments.filter(d => d.assignedTo === selectedEmpId);
  }, [digitalDocuments, selectedEmpId]);

  if (!isOpen) return null;

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
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
      setError('Debes seleccionar el colaborador a regularizar.');
      return;
    }

    if (!formData.fechaInicio) {
      setError('La fecha de inicio del contrato es obligatoria.');
      return;
    }

    const isIndefinido = formData.tipo.toLowerCase().includes('indefinido');
    if (!isIndefinido && !formData.fechaTermino) {
      setError('Debes indicar la fecha de término del contrato para visualizar su vencimiento en el dashboard.');
      return;
    }

    if (formData.fechaTermino && formData.fechaInicio > formData.fechaTermino) {
      setError('La fecha de inicio no puede ser posterior a la fecha de término.');
      return;
    }

    setLoading(true);

    try {
      const actorId = currentUser?.uid || 'admin_user';
      const cargoFinal = formData.cargo?.trim() || DEFAULT_CARGO;

      if (mode === 'edit' && contratoToEdit) {
        const editPayload: any = {
          sucursalId: formData.sucursalId || '0',
          tipo: formData.tipo,
          fechaInicio: formData.fechaInicio,
          cargo: cargoFinal,
          jornada: formData.jornada?.trim() || '45 horas semanales',
          estado: formData.estado,
          estadoDocumental: formData.estadoDocumental,
          permiteMultisucursal: !!formData.permiteMultisucursal
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
        // MODO REGULARIZAR (rápido, sin exigir documento digital)
        const matchingSameDates = (contratos || []).find(
          c =>
            c.colaboradorId === selectedEmpId &&
            c.fechaInicio === formData.fechaInicio &&
            (c.fechaTermino || '') === (formData.fechaTermino || '') &&
            c.estado !== 'anulado'
        );

        if (matchingSameDates) {
          const updateExistingPayload: any = {
            sucursalId: formData.sucursalId || '0',
            tipo: formData.tipo,
            fechaInicio: formData.fechaInicio,
            cargo: cargoFinal,
            estado: 'vigente' as EstadoContrato
          };
          if (formData.fechaTermino) {
            updateExistingPayload.fechaTermino = formData.fechaTermino;
          } else {
            updateExistingPayload.fechaTermino = deleteField();
          }
          await updateContrato(matchingSameDates.id, updateExistingPayload);
          showNotification('Contrato regularizado exitosamente', 'success');
          if (onSuccess) onSuccess(matchingSameDates.id);
        } else {
          // Buscar si el colaborador tenía un contrato vigente anterior para transicionarlo a 'renovado'
          const prevVigente =
            (contratoAnterior && contratoAnterior.estado === 'vigente' ? contratoAnterior : null) ||
            (contratos || []).find(
              c => c.colaboradorId === selectedEmpId && c.estado === 'vigente'
            ) ||
            null;

          const basePayload: any = {
            colaboradorId: selectedEmpId,
            sucursalId: formData.sucursalId || '0',
            tipo: formData.tipo,
            fechaInicio: formData.fechaInicio,
            cargo: cargoFinal,
            jornada: '45 horas semanales',
            estado: 'vigente' as EstadoContrato,
            estadoDocumental: 'no_adjunto' as EstadoDocumental,
            origenRegistro: 'manual_aspro' as OrigenRegistroContrato,
            permiteMultisucursal: false,
            creadoEn: new Date().toISOString(),
            creadoPor: actorId
          };

          if (formData.fechaTermino) {
            basePayload.fechaTermino = formData.fechaTermino;
          }

          let newId: string;
          if (prevVigente) {
            newId = await renewContrato(prevVigente.id, basePayload);
          } else {
            newId = await createContrato(basePayload);
          }

          showNotification('Contrato regularizado exitosamente', 'success');
          if (onSuccess) onSuccess(newId);
        }
      }

      onClose();
    } catch (err: any) {
      console.error('Error saving contract:', err);
      setError(err.message || 'Error al regularizar el contrato.');
    } finally {
      setLoading(false);
    }
  };

  const getTitle = () => {
    switch (mode) {
      case 'edit':
        return 'Editar Registro Contractual';
      case 'link_doc':
        return 'Vincular Documento a Contrato';
      default:
        return 'Regularizar Contrato';
    }
  };

  const getSubtitle = () => {
    if (selectedEmployee) {
      return `${selectedEmployee.firstName} ${selectedEmployee.lastNamePaterno} • ${selectedEmployee.rut}`;
    }
    return 'Registro rápido de fechas vigentes, sucursal y cargo';
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-white border border-slate-100 rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header limpio estilo ASPRO */}
        <div className="bg-white border-b border-slate-100 px-6 py-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200 flex items-center justify-center shrink-0">
              {isRegularizationMode ? <CalendarClock size={20} /> : <FileText size={20} />}
            </div>
            <div>
              <h2 className="text-base md:text-lg font-black text-slate-900 tracking-tight uppercase">
                {getTitle()}
              </h2>
              <p className="text-xs text-slate-400 font-medium">{getSubtitle()}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 transition-colors p-2 rounded-xl hover:bg-slate-100"
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

          <form id="contract-form" onSubmit={handleSubmit} className="space-y-4">
            {/* Ficha del Colaborador si viene preseleccionado desde la fila */}
            {preselectedEmployee ? (
              <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-2xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-600/10 text-blue-600 flex items-center justify-center font-black text-xs">
                    <User size={16} />
                  </div>
                  <div>
                    <p className="text-xs font-black text-slate-900">
                      {preselectedEmployee.firstName} {preselectedEmployee.lastNamePaterno}{' '}
                      {preselectedEmployee.lastNameMaterno || ''}
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono">
                      RUT: {preselectedEmployee.rut || '---'}
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-white border border-blue-200 text-[10px] font-black text-blue-700 uppercase tracking-wider">
                  Regularización Rápida
                </span>
              </div>
            ) : (
              mode !== 'edit' && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Colaborador <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Search
                      size={14}
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      type="text"
                      value={workerSearch}
                      onChange={e => setWorkerSearch(e.target.value)}
                      placeholder="Buscar colaborador por nombre o RUT..."
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none mb-1.5"
                    />
                  </div>
                  <select
                    value={selectedEmpId}
                    onChange={e => handleSelectEmployee(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:outline-none"
                    required
                  >
                    <option value="">-- Seleccionar Trabajador ({filteredEmployees.length}) --</option>
                    {filteredEmployees.map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.firstName} {emp.lastNamePaterno} {emp.lastNameMaterno || ''} ({emp.rut})
                      </option>
                    ))}
                  </select>
                </div>
              )
            )}

            {/* Sucursal / Instalación con buscador rápido */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1">
                <Building size={13} className="text-blue-600" />
                Sucursal / Instalación <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  value={siteSearch}
                  onChange={e => {
                    const val = e.target.value;
                    setSiteSearch(val);
                    const term = normalizeText(val);
                    if (term) {
                      const firstMatch = sites
                        .filter(s => s.active)
                        .find(s => normalizeText(s.name || '').includes(term));
                      if (firstMatch) {
                        setFormData(prev => ({ ...prev, sucursalId: String(firstMatch.id) }));
                      }
                    }
                  }}
                  placeholder="Filtrar sucursal escribiendo el nombre (ej. demo, banco)..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none"
                />
              </div>
              <select
                name="sucursalId"
                value={formData.sucursalId}
                onChange={handleChange}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:outline-none"
                required
              >
                <option value="0">Contrato General / Multisitio (Sin sucursal exclusiva)</option>
                {filteredSites.map(site => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Fechas de Vigencia del Contrato */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Fecha Inicio */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Calendar size={13} className="text-blue-600" />
                  Fecha de Inicio <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  name="fechaInicio"
                  value={formData.fechaInicio}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none"
                  required
                />
              </div>

              {/* Fecha Término */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Calendar size={13} className="text-blue-600" />
                  Fecha de Término
                  {!formData.tipo.toLowerCase().includes('indefinido') ? (
                    <span className="text-red-500 font-bold">*</span>
                  ) : (
                    <span className="text-slate-400 font-normal text-[10px]">(Opcional)</span>
                  )}
                </label>
                <input
                  type="date"
                  name="fechaTermino"
                  value={formData.fechaTermino}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none"
                  required={!formData.tipo.toLowerCase().includes('indefinido')}
                />
              </div>
            </div>

            {/* Tipo de Contrato y Cargo (por defecto siempre "Guardia de Seguridad") */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Modalidad / Tipo
                </label>
                <select
                  name="tipo"
                  value={formData.tipo}
                  onChange={handleChange}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none"
                  required
                >
                  <option value="Plazo Fijo">Plazo Fijo</option>
                  <option value="Part-Time">Part-Time</option>
                  <option value="Obra y Faena">Obra y Faena</option>
                  <option value="Indefinido">Indefinido</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Briefcase size={13} className="text-blue-600" />
                  Cargo
                </label>
                <input
                  type="text"
                  name="cargo"
                  value={formData.cargo}
                  onChange={handleChange}
                  placeholder="Guardia de Seguridad"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            {/* Campos adicionales solo cuando se edita un contrato desde la ficha detallada */}
            {(mode === 'edit' || mode === 'link_doc') && (
              <div className="pt-3 border-t border-slate-200 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                      placeholder="45 horas semanales"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none"
                    />
                  </div>

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
                </div>

                <div className="pt-2 border-t border-slate-200">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Link2 size={14} className="text-blue-600" />
                    Respaldo Documental (Opcional)
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Vincular Documento Digital
                      </label>
                      <select
                        value={formData.documentoId}
                        onChange={handleDocumentSelect}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none"
                      >
                        <option value="">-- Sin documento digital vinculado --</option>
                        {workerDigitalDocs.map(doc => (
                          <option key={doc.id} value={doc.id}>
                            {doc.title} ({doc.status === 'signed' ? 'Firmado' : 'Pendiente'}) -{' '}
                            {formatDateDDMMYYYY(doc.createdAt)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Estado Documental
                      </label>
                      <select
                        name="estadoDocumental"
                        value={formData.estadoDocumental}
                        onChange={handleChange}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium focus:border-blue-500 focus:bg-white focus:outline-none"
                      >
                        <option value="no_adjunto">Físico / Sin digitalizar</option>
                        <option value="firmado_digital">Firmado Digitalmente (ASPRO)</option>
                        <option value="firmado_externo">Firmado Externamente (Papel)</option>
                        <option value="generado_drive">Generado en Google Drive</option>
                        <option value="pendiente_firma">Pendiente de Firma</option>
                        <option value="archivado_externo">Archivado en Expediente Físico</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Footer */}
        <div className="bg-white px-6 py-4 border-t border-slate-100 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-50 transition"
          >
            Cancelar
          </button>
          <button
            form="contract-form"
            type="submit"
            disabled={loading}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-md shadow-blue-200 transition disabled:opacity-50"
          >
            {loading ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <CheckCircle2 size={16} />
                {mode === 'edit' ? 'Guardar Cambios' : 'Regularizar'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
