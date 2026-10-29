import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  X, FileText, CheckCircle2, AlertCircle, Calendar, Building,
  Briefcase, Clock, DollarSign, Send, Download, Search, UserCheck,
  ShieldCheck, Eye, Loader2, ArrowRight, ArrowLeft, Check, FileCode,
  Lock, RefreshCw, ExternalLink, PenTool, Printer, Sparkles, Info, Scale,
  ChevronRight, ChevronLeft, MapPin
} from 'lucide-react';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { Employee, Site } from '../types';
import { Contrato } from '../types/phase1';
import { normalizeText, matchesEmployeeSearch, formatDateDDMMYYYY } from '../lib/textUtils';
import { 
  sueldoMinimoLegalService, 
  formatCLP,
  ValidacionSueldoBaseResult 
} from '../lib/contratos/sueldoMinimoLegalService';
import {
  localContractTemplateService,
  PlantillaContractual
} from '../lib/contratos/localContractTemplateService';
import {
  localContractEmissionsService,
  EmisionLaboratorio,
  ContractSignatureConfig,
  crearSignatureConfigInicial,
  resolverPaginaObjetivoFirma,
  formatearNombreContrato
} from '../lib/contratos/localContractEmissionsService';
import type { SharedSignatureConfig } from './SharedSignatureBatchModal';
import { ContractPdfSignaturePositioner } from './contratos/ContractPdfSignaturePositioner';
import { useAppStore } from '../store/useAppStore';
import { db } from '../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';

export interface ContractEmissionModalV2Props {
  isOpen: boolean;
  onClose: () => void;
  employees: Employee[];
  sites: Site[];
  contratos?: Contrato[];
  preselectedEmployee?: Employee | null;
  contratoAnterior?: Contrato | null;
  onEmitSuccess?: (result: EmissionResult) => void;
  /** Adaptador de emisión inyectable (en prod llama a Cloud Function; en lab/test llama al mock) */
  emissionService?: (payload: EmissionPayload) => Promise<EmissionResult>;
}

export interface EmissionPayload {
  colaboradorId: string;
  plantillaId: string;
  tipo: 'Plazo Fijo' | 'Indefinido' | 'Obra y Faena' | 'Part-Time';
  fechaInicio: string;
  fechaTermino?: string;
  cargo: string;
  sucursalId: string;
  jornada: string;
  horarioA: string;
  horarioB: string;
  sueldoBase: number;
  canalFirma: 'digital_aspro' | 'fisica_manuscrita';
  signatureConfig?: ContractSignatureConfig;
  contratoAnteriorId?: string | null;
  __devBypass?: boolean;
}

export interface EmissionResult {
  status: 'success' | 'idempotent_duplicate';
  contratoId: string;
  localEmisionId?: string;
  documentoId?: string | null;
  canalFirma: 'digital_aspro' | 'fisica_manuscrita';
  signatureConfig?: ContractSignatureConfig;
  pdfSha256: string;
  pageCount: number;
  pageSize?: string;
  pdfUrl?: string;
  docxUrl?: string;
  sueldoBaseUtilizado?: number;
  timings?: {
    totalMs: number;
    substitucionMs?: number;
    conversionMs?: number;
  };
  reused?: boolean;
}

interface PreparedContractDraft {
  draftKey: string;
  colaboradorId: string;
  plantillaId: string;
  docxBuffer: ArrayBuffer;
  pdfBuffer: ArrayBuffer;
  pdfBlobUrl: string;
  pageCount: number;
  emisionRegistradaId?: string;
  firestoreContratoId?: string;
  firestoreDocumentoId?: string;
  pdfStorageUrl?: string;
}

export const ContractEmissionModalV2: React.FC<ContractEmissionModalV2Props> = ({
  isOpen,
  onClose,
  employees,
  sites,
  contratos = [],
  preselectedEmployee = null,
  contratoAnterior = null,
  onEmitSuccess,
  emissionService
}) => {
  const uploadFile = useAppStore(state => state.uploadFile);
  const addDigitalDocument = useAppStore(state => state.addDigitalDocument);
  const createContrato = useAppStore(state => state.createContrato);
  const renewContrato = useAppStore(state => state.renewContrato);
  const updateContrato = useAppStore(state => state.updateContrato);
  const currentUser = useAppStore(state => state.currentUser);
  const storeContratos = useAppStore(state => state.contratos);
  // Pasos del Wizard: 1: Trabajador & Plantilla, 2: Cláusulas & Sueldo Base, 3: Canal & Revisión, 4: Éxito
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // Plantillas dinámicas de IndexedDB
  const [plantillas, setPlantillas] = useState<PlantillaContractual[]>([]);
  const [cargandoPlantillas, setCargandoPlantillas] = useState<boolean>(true);

  // Paso 1: Selección
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>(preselectedEmployee?.id || '');
  const [workerSearchTerm, setWorkerSearchTerm] = useState<string>('');
  const [showInactiveWorkers, setShowInactiveWorkers] = useState<boolean>(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('tpl_sintetica_plazo_fijo_v2');

  // Paso 2: Datos Contractuales (el tipoContrato proviene directamente de la plantilla seleccionada en el Paso 1)
  const [tipoContrato, setTipoContrato] = useState<'Plazo Fijo' | 'Indefinido' | 'Obra y Faena' | 'Part-Time'>('Plazo Fijo');
  const [fechaInicio, setFechaInicio] = useState<string>(new Date().toISOString().split('T')[0]);
  const [fechaTermino, setFechaTermino] = useState<string>('');
  const [cargo, setCargo] = useState<string>('Guardia de Seguridad');
  const [sucursalId, setSucursalId] = useState<string>('0');
  const [horarioA, setHorarioA] = useState<string>('08:30 AM a 18:30 PM');
  const [horarioB, setHorarioB] = useState<string>('18:00 PM a 09:00 AM');

  // Buscador amigable de Sucursal / Instalación
  const [siteSearchTerm, setSiteSearchTerm] = useState<string>('');
  const [showSiteDropdown, setShowSiteDropdown] = useState<boolean>(false);
  const siteDropdownRef = useRef<HTMLDivElement>(null);

  // Datos editables de respaldo del colaborador y sucursal para completar si faltan en ficha
  const [workerFechaNacimiento, setWorkerFechaNacimiento] = useState<string>('');
  const [workerNacionalidad, setWorkerNacionalidad] = useState<string>('Chilena');
  const [workerDireccion, setWorkerDireccion] = useState<string>('');
  const [workerEstadoCivil, setWorkerEstadoCivil] = useState<string>('Soltero(a)');
  const [workerTelefono, setWorkerTelefono] = useState<string>('');
  const [workerSalud, setWorkerSalud] = useState<string>('Fonasa');
  const [workerAfp, setWorkerAfp] = useState<string>('Modelo');
  const [workerCodigoInterno, setWorkerCodigoInterno] = useState<string>('10');
  const [siteEmpresa, setSiteEmpresa] = useState<string>('ASPRO SPA');
  const [siteDireccion, setSiteDireccion] = useState<string>('');

  // Sueldo Base Contractual: siempre precargado desde el Sueldo Base Preconfigurado permanente
  const [sueldoBase, setSueldoBase] = useState<number>(() =>
    sueldoMinimoLegalService.obtenerSueldoBasePreconfigurado()
  );
  const [sueldoBaseModificadoManualmente, setSueldoBaseModificadoManualmente] = useState<boolean>(false);

  // Paso 3: Canal de Firma y Posicionamiento de Firma Digital
  const [canalFirma, setCanalFirma] = useState<'digital_aspro' | 'fisica_manuscrita'>('digital_aspro');
  const [sigConfig, setSigConfig] = useState<SharedSignatureConfig>(() => crearSignatureConfigInicial());
  const [selectedSigTemplateId, setSelectedSigTemplateId] = useState<string>('');
  const [sigZoom, setSigZoom] = useState<number>(1);
  const [pdfPageDimensions, setPdfPageDimensions] = useState<{
    width: number;
    height: number;
    orientation: 'portrait' | 'landscape';
  }>({ width: 595, height: 842, orientation: 'portrait' });
  const [pdfTotalPages, setPdfTotalPages] = useState<number>(4);
  const [preparedDraft, setPreparedDraft] = useState<PreparedContractDraft | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState<boolean>(false);
  const prevSelectionRef = useRef<{ workerId: string; templateId: string }>({
    workerId: preselectedEmployee?.id || '',
    templateId: 'tpl_sintetica_plazo_fijo_v2'
  });

  // Estados de Proceso y Errores
  const [isEmitting, setIsEmitting] = useState<boolean>(false);
  const [emissionProgressText, setEmissionProgressText] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [emissionResult, setEmissionResult] = useState<EmissionResult | null>(null);

  // Limpiar URL temporal del PDF al desmontar
  useEffect(() => {
    return () => {
      if (preparedDraft?.pdfBlobUrl) {
        URL.revokeObjectURL(preparedDraft.pdfBlobUrl);
      }
    };
  }, [preparedDraft?.pdfBlobUrl]);

  // Evitar que la posición de firma de un contrato anterior se reutilice al cambiar de colaborador o plantilla
  useEffect(() => {
    const prev = prevSelectionRef.current;
    if (
      (prev.workerId && prev.workerId !== selectedWorkerId) ||
      (prev.templateId && prev.templateId !== selectedTemplateId)
    ) {
      setSigConfig(crearSignatureConfigInicial());
      setSelectedSigTemplateId('');
      setSigZoom(1);
      setEmissionResult(null);
      setPreparedDraft(old => {
        if (old?.pdfBlobUrl) URL.revokeObjectURL(old.pdfBlobUrl);
        return null;
      });
    }
    prevSelectionRef.current = { workerId: selectedWorkerId, templateId: selectedTemplateId };
  }, [selectedWorkerId, selectedTemplateId]);

  // Cerrar dropdown de sucursal al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (siteDropdownRef.current && !siteDropdownRef.current.contains(e.target as Node)) {
        setShowSiteDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cargar plantillas desde IndexedDB y sueldo base preconfigurado al abrir el modal
  useEffect(() => {
    let isMounted = true;
    async function loadPlantillas() {
      try {
        setCargandoPlantillas(true);
        await localContractTemplateService.inicializar();
        const list = await localContractTemplateService.listarPlantillas();
        if (isMounted) {
          setPlantillas(list);
          if (list.length > 0) {
            const activaUsuario = list.find(p => !p.esEjemploSintetico && p.activa && p.erroresValidacion.length === 0);
            const activaCualquiera = list.find(p => p.activa && p.erroresValidacion.length === 0) || list[0];
            const elegida = activaUsuario || activaCualquiera;
            setSelectedTemplateId(elegida.id);
            setTipoContrato(elegida.tipoContrato);
          }
        }
      } catch (err) {
        console.warn('Error cargando plantillas de contratos:', err);
      } finally {
        if (isMounted) setCargandoPlantillas(false);
      }
    }
    if (isOpen) {
      loadPlantillas();
      const preconfigurado = sueldoMinimoLegalService.obtenerSueldoBasePreconfigurado();
      if (!sueldoBaseModificadoManualmente) {
        setSueldoBase(preconfigurado);
      }
    }
    return () => { isMounted = false; };
  }, [isOpen]);

  // Colaborador seleccionado
  const selectedWorker = useMemo(() => {
    return employees.find(e => e.id === selectedWorkerId) || null;
  }, [employees, selectedWorkerId]);

  // Sincronizar campos del trabajador cuando cambia selectedWorker
  useEffect(() => {
    if (!selectedWorker) return;
    if (selectedWorker.cargo) setCargo(selectedWorker.cargo);
    if (selectedWorker.currentSiteId) {
      const autofillSite = sites.find(s => String(s.id) === String(selectedWorker.currentSiteId));
      setSucursalId(String(selectedWorker.currentSiteId));
      if (autofillSite) {
        setSiteSearchTerm(autofillSite.name);
      }
    }
    setWorkerFechaNacimiento(selectedWorker.fechaNacimiento || '');
    setWorkerNacionalidad(selectedWorker.nacionalidad || 'Chilena');
    setWorkerDireccion(selectedWorker.direccion || '');
    setWorkerEstadoCivil(selectedWorker.estadoCivil || 'Soltero(a)');
    setWorkerTelefono(selectedWorker.phone || '');
    setWorkerSalud(selectedWorker.salud || 'Fonasa');
    setWorkerAfp(selectedWorker.afp || 'Modelo');
    setWorkerCodigoInterno(selectedWorker.codigo || '10');
  }, [selectedWorker, sites]);

  // Sincronizar datos de la sucursal seleccionada
  useEffect(() => {
    const s = sites.find(site => String(site.id) === String(sucursalId));
    if (s) {
      setSiteEmpresa(s.empresa || 'ASPRO SPA');
      setSiteDireccion(s.address || '');
      if (!showSiteDropdown) {
        setSiteSearchTerm(s.name);
      }
    } else {
      setSiteEmpresa('ASPRO SPA');
      setSiteDireccion('Calle Recreo N° 118, oficina 9, Rancagua');
      if (!showSiteDropdown && sucursalId === '0') {
        setSiteSearchTerm('Multisitio / General GGSS');
      }
    }
  }, [sucursalId, sites]);

  // Precarga del sueldo base: usa siempre el Sueldo Base Preconfigurado por defecto (o el de un contrato anterior si es renovación explícita)
  useEffect(() => {
    if (sueldoBaseModificadoManualmente) return;

    const sueldoPreconfigurado = sueldoMinimoLegalService.obtenerSueldoBasePreconfigurado();

    if (contratoAnterior && typeof contratoAnterior.sueldoBase === 'number' && contratoAnterior.sueldoBase > 0) {
      setSueldoBase(contratoAnterior.sueldoBase);
    } else {
      setSueldoBase(sueldoPreconfigurado);
    }
  }, [selectedWorkerId, contratoAnterior, sueldoBaseModificadoManualmente]);

  // Validación frente a la referencia legal centralizada desacoplada
  const validacionLegal: ValidacionSueldoBaseResult = useMemo(() => {
    const jornadaEvaluacion = tipoContrato === 'Part-Time' ? 'Part-Time' : '45 horas semanales';
    return sueldoMinimoLegalService.validarSueldoBaseContractual(sueldoBase, fechaInicio, jornadaEvaluacion);
  }, [sueldoBase, fechaInicio, tipoContrato]);

  // Sincronizar preselección de colaborador
  useEffect(() => {
    if (preselectedEmployee) {
      setSelectedWorkerId(preselectedEmployee.id);
      if (preselectedEmployee.cargo) setCargo(preselectedEmployee.cargo);
      if (preselectedEmployee.currentSiteId) {
        setSucursalId(String(preselectedEmployee.currentSiteId));
        const s = sites.find(site => String(site.id) === String(preselectedEmployee.currentSiteId));
        if (s) setSiteSearchTerm(s.name);
      }
      if (preselectedEmployee.fechaInicioContrato) {
        setFechaInicio(preselectedEmployee.fechaInicioContrato.split('T')[0]);
      }
      if (preselectedEmployee.fechaTerminoContrato) {
        setFechaTermino(preselectedEmployee.fechaTerminoContrato.split('T')[0]);
      }
    }
  }, [preselectedEmployee, sites]);

  // Plantilla seleccionada
  const selectedTemplate = useMemo(() => {
    return plantillas.find(p => p.id === selectedTemplateId) || null;
  }, [plantillas, selectedTemplateId]);

  // Nomenclatura oficial del documento: "Contrato + 1er nombre + 1er apellido + DDMM"
  const nombreContratoGenerado = useMemo(() => {
    if (!selectedWorker) return 'Contrato';
    return formatearNombreContrato({
      primerNombre: selectedWorker.firstName,
      primerApellido: selectedWorker.lastNamePaterno,
      colaboradorNombre: `${selectedWorker.firstName || ''} ${selectedWorker.lastNamePaterno || ''}`.trim(),
      fechaInicio
    });
  }, [selectedWorker, fechaInicio]);

  // Sincronizar automáticamente tipoContrato desde la plantilla seleccionada
  useEffect(() => {
    if (selectedTemplate) {
      setTipoContrato(selectedTemplate.tipoContrato);
    }
  }, [selectedTemplate]);

  // Colaboradores filtrados en el buscador
  const filteredWorkers = useMemo(() => {
    return employees
      .filter(e => {
        const matchesStatus = showInactiveWorkers ? true : e.isActive;
        const matchesQuery = !workerSearchTerm || matchesEmployeeSearch(workerSearchTerm, e);
        return matchesStatus && matchesQuery;
      })
      .slice(0, 40);
  }, [employees, workerSearchTerm, showInactiveWorkers]);

  // Sucursales filtradas escribiendo texto (ej: "demo" -> "Condominio demo 1")
  const filteredSites = useMemo(() => {
    const query = normalizeText(siteSearchTerm);
    if (!query || query === normalizeText('Multisitio / General GGSS')) {
      return sites;
    }
    return sites.filter(s =>
      normalizeText(s.name).includes(query) ||
      normalizeText(s.address || '').includes(query) ||
      normalizeText(s.empresa || '').includes(query)
    );
  }, [sites, siteSearchTerm]);

  // Huella única de los datos del contrato actual para asociar el PDF generado y la firma
  const currentDraftKey = useMemo(() => {
    return JSON.stringify({
      selectedWorkerId,
      selectedTemplateId,
      fechaInicio,
      fechaTermino,
      cargo,
      sucursalId,
      horarioA,
      horarioB,
      sueldoBase,
      workerFechaNacimiento,
      workerNacionalidad,
      workerDireccion,
      workerEstadoCivil,
      workerTelefono,
      workerSalud,
      workerAfp,
      workerCodigoInterno,
      siteEmpresa,
      siteDireccion
    });
  }, [
    selectedWorkerId,
    selectedTemplateId,
    fechaInicio,
    fechaTermino,
    cargo,
    sucursalId,
    horarioA,
    horarioB,
    sueldoBase,
    workerFechaNacimiento,
    workerNacionalidad,
    workerDireccion,
    workerEstadoCivil,
    workerTelefono,
    workerSalud,
    workerAfp,
    workerCodigoInterno,
    siteEmpresa,
    siteDireccion
  ]);

  // Generar el DOCX rellenado y convertirlo a PDF real en Gotenberg para la vista previa y emisión
  const generarDocumentosBorradorActual = async (): Promise<PreparedContractDraft> => {
    if (!selectedWorker) {
      throw new Error('Debe seleccionar un colaborador válido.');
    }
    if (!selectedTemplate) {
      throw new Error('Debe seleccionar una plantilla contractual válida.');
    }

    const modalidadPlantilla = selectedTemplate.tipoContrato;
    const jornadaDerivada = modalidadPlantilla === 'Part-Time' ? 'Part-Time' : '45 horas semanales';
    const workerFullName = `${selectedWorker.firstName} ${selectedWorker.lastNamePaterno} ${selectedWorker.lastNameMaterno || ''}`.trim();
    const sucursalObj = sites.find(s => String(s.id) === String(sucursalId));

    const payloadSustitucion = localContractTemplateService.generarPayloadSustitucion({
      trabajador: {
        nombre: workerFullName,
        rut: selectedWorker.rut,
        cargo,
        fechaNacimiento: workerFechaNacimiento || selectedWorker.fechaNacimiento,
        nacionalidad: workerNacionalidad || selectedWorker.nacionalidad,
        estadoCivil: workerEstadoCivil || selectedWorker.estadoCivil,
        direccion: workerDireccion || selectedWorker.direccion,
        email: selectedWorker.email,
        telefono: workerTelefono || selectedWorker.phone || '',
        afp: workerAfp || selectedWorker.afp,
        salud: workerSalud || selectedWorker.salud,
        codigoInterno: workerCodigoInterno || selectedWorker.codigo || '10'
      },
      contrato: {
        tipo: modalidadPlantilla,
        fechaInicio,
        fechaTermino: fechaTermino || undefined,
        cargo,
        jornada: jornadaDerivada,
        horarioA,
        horarioB,
        sueldoBase
      },
      sucursal: {
        id: sucursalId,
        nombre: sucursalObj?.name || 'MULTISITIO GGSS',
        direccion: siteDireccion || sucursalObj?.address || 'Dirección de Faena',
        comuna: 'Rancagua',
        empresa: siteEmpresa || sucursalObj?.empresa || 'ASPRO SPA'
      }
    });

    const validacionVariables = localContractTemplateService.validarVariablesParaEmision(
      selectedTemplate,
      payloadSustitucion
    );

    if (!validacionVariables.valida) {
      throw new Error(
        `Emisión bloqueada. No se pudo resolver la totalidad de variables exigidas:\n• ` +
          validacionVariables.errores.join('\n• ')
      );
    }

    const templateBuffer = await localContractTemplateService.obtenerBinarioPlantilla(selectedTemplate.id);
    if (!templateBuffer || templateBuffer.byteLength < 500) {
      throw new Error(
        `El archivo binario DOCX para la plantilla "${selectedTemplate.nombre}" no está disponible o está vacío.`
      );
    }

    let zip: PizZip;
    try {
      zip = new PizZip(templateBuffer);
    } catch (zipErr: any) {
      throw new Error(`El archivo de plantilla no tiene una estructura DOCX válida: ${zipErr.message}`);
    }

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
      parser: tag => ({
        get: scope => {
          if (!tag) return '';
          const val = localContractTemplateService.resolverValorVariable(tag, scope);
          return val !== undefined && val !== null ? val : '';
        }
      })
    });

    try {
      doc.render(payloadSustitucion);
    } catch (renderErr: any) {
      throw new Error(`Error en el motor de plantillas al sustituir variables: ${renderErr.message}`);
    }

    const docxRellenadoBuffer = doc.getZip().generate({
      type: 'arraybuffer',
      compression: 'DEFLATE'
    });

    const formData = new FormData();
    const docxBlob = new Blob([docxRellenadoBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    formData.append('files', docxBlob, 'contrato_rellenado.docx');

    let respGotenberg: Response;
    try {
      respGotenberg = await fetch('/api/gotenberg/forms/libreoffice/convert', {
        method: 'POST',
        body: formData
      });
    } catch (fetchErr: any) {
      throw new Error(
        `No fue posible conectar con el conversor Gotenberg (http://localhost:3005). Verifique que el contenedor Docker esté iniciado (docker start gotenberg_lab). Detalle: ${fetchErr.message}`
      );
    }

    if (!respGotenberg.ok) {
      const errDetail = await respGotenberg.text().catch(() => '');
      throw new Error(
        `El conversor Gotenberg falló con código HTTP ${respGotenberg.status} (${respGotenberg.statusText}): ${errDetail || 'Error desconocido'}`
      );
    }

    const pdfBuffer = await respGotenberg.arrayBuffer();

    if (!pdfBuffer || pdfBuffer.byteLength < 500) {
      throw new Error('El archivo PDF retornado por Gotenberg está vacío o incompleto (menos de 500 bytes).');
    }

    const headerBytes = new Uint8Array(pdfBuffer.slice(0, 5));
    const headerMagic = String.fromCharCode(...headerBytes);
    if (!headerMagic.startsWith('%PDF')) {
      throw new Error('El archivo generado por Gotenberg no contiene la cabecera estándar de documento PDF.');
    }

    const pdfTextLatin1 = new TextDecoder('latin1').decode(new Uint8Array(pdfBuffer));
    const pageMatches = pdfTextLatin1.match(/\/Type\s*\/Page\b(?!s)/g);
    const realPageCount = pageMatches && pageMatches.length > 0 ? pageMatches.length : 1;

    const pdfBlobUrl = URL.createObjectURL(new Blob([pdfBuffer], { type: 'application/pdf' }));

    const nuevoBorrador: PreparedContractDraft = {
      draftKey: currentDraftKey,
      colaboradorId: selectedWorker.id,
      plantillaId: selectedTemplate.id,
      docxBuffer: docxRellenadoBuffer,
      pdfBuffer,
      pdfBlobUrl,
      pageCount: realPageCount
    };

    setPdfTotalPages(realPageCount);
    setPreparedDraft(old => {
      if (old?.pdfBlobUrl && old.pdfBlobUrl !== pdfBlobUrl) {
        URL.revokeObjectURL(old.pdfBlobUrl);
      }
      return nuevoBorrador;
    });

    return nuevoBorrador;
  };

  // Al entrar al Paso 3 con Firma Digital ASPRO, preparar automáticamente la vista previa del PDF real
  useEffect(() => {
    if (!isOpen || currentStep !== 3 || canalFirma !== 'digital_aspro' || emissionService) return;
    if (preparedDraft && preparedDraft.draftKey === currentDraftKey) return;

    let active = true;
    setIsGeneratingPreview(true);
    setErrorMsg(null);

    generarDocumentosBorradorActual()
      .catch((err: any) => {
        if (active) {
          setErrorMsg(err.message || 'No se pudo generar la vista previa del PDF.');
        }
      })
      .finally(() => {
        if (active) {
          setIsGeneratingPreview(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isOpen, currentStep, canalFirma, currentDraftKey, emissionService]);

  if (!isOpen) return null;

  // Manejador del avance de pasos con validación estricta
  const handleNextStep = () => {
    setErrorMsg(null);

    if (currentStep === 1) {
      if (!selectedWorkerId) {
        setErrorMsg('Debe seleccionar un colaborador para continuar.');
        return;
      }
      if (!selectedTemplateId) {
        setErrorMsg('Debe seleccionar una plantilla contractual maestra.');
        return;
      }
      if (selectedTemplate && selectedTemplate.erroresValidacion.length > 0) {
        setErrorMsg('La plantilla seleccionada contiene errores estructurales que impiden su uso.');
        return;
      }
      setCurrentStep(2);
    } else if (currentStep === 2) {
      if (!fechaInicio) {
        setErrorMsg('La fecha de inicio contractual es obligatoria.');
        return;
      }
      if (tipoContrato === 'Plazo Fijo' && fechaTermino && fechaInicio > fechaTermino) {
        setErrorMsg('La fecha de inicio no puede ser posterior a la fecha de término.');
        return;
      }
      if (sueldoBase <= 0) {
        setErrorMsg('Debe ingresar un sueldo base contractual pactado válido (mayor a $0 CLP).');
        return;
      }
      setCurrentStep(3);
    }
  };

  // Permite retroceder entre pasos (incluyendo volver del Paso 4 de confirmación al Paso 3 sin perder la configuración)
  const handlePrevStep = () => {
    setErrorMsg(null);
    if (currentStep === 2) setCurrentStep(1);
    if (currentStep === 3) setCurrentStep(2);
    if (currentStep === 4) setCurrentStep(3);
  };

  // Descarga bajo demanda con revocación segura de URLs temporales
  const handleDescargar = async (tipo: 'docx' | 'pdf') => {
    if (!emissionResult) return;
    try {
      const targetLocalId = emissionResult.localEmisionId || emissionResult.contratoId;
      const { url, nombreArchivo, revocar } = await localContractEmissionsService.crearDescarga(
        targetLocalId,
        tipo
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = nombreArchivo;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(revocar, 4000);
    } catch (err: any) {
      alert(`Error al descargar ${tipo.toUpperCase()}: ${err.message}`);
    }
  };

  // Ejecución de la Emisión Real de Laboratorio
  const handleExecuteEmission = async () => {
    setIsEmitting(true);
    setErrorMsg(null);
    setEmissionProgressText('1/3 Validando variables y preparando documento...');

    try {
      if (!selectedWorker) {
        throw new Error('Debe seleccionar un colaborador válido.');
      }
      if (!selectedTemplate) {
        throw new Error('Debe seleccionar una plantilla contractual válida.');
      }

      const modalidadPlantilla = selectedTemplate.tipoContrato;
      const jornadaDerivada = modalidadPlantilla === 'Part-Time' ? 'Part-Time' : '45 horas semanales';

      const targetPage = resolverPaginaObjetivoFirma(sigConfig, pdfTotalPages);
      const resolvedSignatureConfig: ContractSignatureConfig | undefined =
        canalFirma === 'digital_aspro'
          ? {
              page: sigConfig.page,
              pageNumber: targetPage,
              posicionX: sigConfig.posicionX,
              posicionY: sigConfig.posicionY,
              targetPageResolved: targetPage,
              pageWidth: pdfPageDimensions.width,
              pageHeight: pdfPageDimensions.height,
              orientation: pdfPageDimensions.orientation
            }
          : undefined;

      const payload: EmissionPayload = {
        colaboradorId: selectedWorkerId,
        plantillaId: selectedTemplateId,
        tipo: modalidadPlantilla,
        fechaInicio,
        fechaTermino: fechaTermino || undefined,
        cargo,
        sucursalId,
        jornada: jornadaDerivada,
        horarioA,
        horarioB,
        sueldoBase,
        canalFirma,
        signatureConfig: resolvedSignatureConfig,
        contratoAnteriorId: contratoAnterior ? contratoAnterior.id : undefined
      };

      let result: EmissionResult;

      if (emissionService) {
        setEmissionProgressText('2/3 Ejecutando conversión mediante adaptador inyectado...');
        result = await emissionService(payload);
        if (resolvedSignatureConfig && !result.signatureConfig) {
          result = { ...result, signatureConfig: resolvedSignatureConfig };
        }
        setEmissionProgressText('3/3 Registrando resultado de emisión...');
      } else {
        const workerFullName = `${selectedWorker.firstName} ${selectedWorker.lastNamePaterno} ${selectedWorker.lastNameMaterno || ''}`.trim();

        // Reutilizar el borrador ya convertido en Gotenberg si corresponde al mismo contrato actual
        let draft = preparedDraft;
        if (!draft || draft.draftKey !== currentDraftKey) {
          setEmissionProgressText('2/4 Convirtiendo DOCX a PDF en Gotenberg...');
          draft = await generarDocumentosBorradorActual();
        }

        const effectiveTargetPage = resolverPaginaObjetivoFirma(sigConfig, draft.pageCount);
        const finalSigConfig: ContractSignatureConfig | undefined =
          canalFirma === 'digital_aspro'
            ? {
                page: sigConfig.page,
                pageNumber: effectiveTargetPage,
                posicionX: sigConfig.posicionX,
                posicionY: sigConfig.posicionY,
                targetPageResolved: effectiveTargetPage,
                pageWidth: pdfPageDimensions.width,
                pageHeight: pdfPageDimensions.height,
                orientation: pdfPageDimensions.orientation
              }
            : undefined;

        setEmissionProgressText('3/4 Guardando respaldo local en IndexedDB...');

        let registro: EmisionLaboratorio | null = null;
        if (draft.emisionRegistradaId) {
          registro = await localContractEmissionsService.actualizarSignatureConfigEmision(
            draft.emisionRegistradaId,
            canalFirma,
            finalSigConfig
          );
        }

        if (!registro) {
          registro = await localContractEmissionsService.registrarEmision({
            colaboradorId: selectedWorker.id,
            colaboradorNombre: workerFullName,
            colaboradorPrimerNombre: selectedWorker.firstName,
            colaboradorPrimerApellido: selectedWorker.lastNamePaterno,
            colaboradorRut: selectedWorker.rut,
            fechaInicio,
            plantillaId: selectedTemplate.id,
            plantillaNombre: selectedTemplate.nombre,
            plantillaVersion: selectedTemplate.version,
            sueldoBase,
            tipoContrato: modalidadPlantilla,
            canalFirma,
            signatureConfig: finalSigConfig,
            docxBuffer: draft.docxBuffer,
            pdfBuffer: draft.pdfBuffer,
            pageCount: draft.pageCount
          });
        }

        // 4/4 Subir PDF a Firebase Storage, crear Documento Digital pendiente y registrar/renovar Contrato en Firestore
        let pdfStorageUrl = draft.pdfStorageUrl;
        let firestoreDocumentoId = draft.firestoreDocumentoId;
        let firestoreContratoId = draft.firestoreContratoId;

        if (currentUser && typeof uploadFile === 'function' && typeof createContrato === 'function') {
          setEmissionProgressText('4/4 Registrando contrato en ficha del colaborador y enviando a firma...');

          if (!pdfStorageUrl) {
            const pdfBlob = new Blob([draft.pdfBuffer], { type: 'application/pdf' });
            const safeFileName = nombreContratoGenerado
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^a-zA-Z0-9_-]/g, '_');
            const storagePath = `original_docs/${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${safeFileName}.pdf`;
            pdfStorageUrl = await uploadFile(pdfBlob, storagePath);
          }

          if (canalFirma === 'digital_aspro' && finalSigConfig && pdfStorageUrl) {
            const sigConfigPayload = {
              page: finalSigConfig.page,
              ...(finalSigConfig.page === 'specific' ? { pageNumber: finalSigConfig.pageNumber } : {}),
              posicionX: finalSigConfig.posicionX,
              posicionY: finalSigConfig.posicionY,
              boxWidth: 120,
              targetPageResolved: finalSigConfig.targetPageResolved
            };

            if (firestoreDocumentoId) {
              await updateDoc(doc(db, 'documents', firestoreDocumentoId), {
                signatureConfig: sigConfigPayload
              });
            } else {
              firestoreDocumentoId = await addDigitalDocument({
                title: nombreContratoGenerado,
                type: 'Contrato',
                assignedTo: selectedWorker.id,
                originalUrl: pdfStorageUrl,
                signatureConfig: sigConfigPayload as any
              });
            }
          }

          const baseContratoPayload: Omit<Contrato, 'id'> = {
            colaboradorId: selectedWorker.id,
            sucursalId: sucursalId || '0',
            tipo: modalidadPlantilla,
            fechaInicio,
            ...(fechaTermino ? { fechaTermino } : {}),
            cargo: cargo || 'Guardia de Seguridad',
            jornada: jornadaDerivada,
            horarioA,
            horarioB,
            sueldoBase: Number(sueldoBase),
            estado: 'vigente',
            estadoDocumental: canalFirma === 'digital_aspro' ? 'pendiente_firma' : 'no_adjunto',
            ...(firestoreDocumentoId ? { documentoId: firestoreDocumentoId } : {}),
            ...(pdfStorageUrl ? { googleDriveUrl: pdfStorageUrl } : {}),
            origenRegistro: 'emision_sistema',
            estadoConciliacion: 'verificado',
            creadoEn: new Date().toISOString(),
            creadoPor: currentUser?.uid || 'admin'
          };

          if (firestoreContratoId) {
            await updateContrato(firestoreContratoId, baseContratoPayload);
          } else {
            const allContratos = contratos.length > 0 ? contratos : storeContratos;
            const sameDatesContract = allContratos.find(c =>
              c.colaboradorId === selectedWorker.id &&
              c.fechaInicio === fechaInicio &&
              (c.fechaTermino || null) === (fechaTermino || null) &&
              c.estado !== 'anulado'
            );

            if (sameDatesContract) {
              await updateContrato(sameDatesContract.id, baseContratoPayload);
              firestoreContratoId = sameDatesContract.id;
            } else {
              const prevActiveContract =
                contratoAnterior ||
                allContratos
                  .filter(c =>
                    c.colaboradorId === selectedWorker.id &&
                    (c.estado === 'vigente' || c.estado === 'pendiente_firma')
                  )
                  .sort((a, b) => (b.fechaTermino || '9999-99-99').localeCompare(a.fechaTermino || '9999-99-99'))[0] ||
                null;

              if (prevActiveContract) {
                firestoreContratoId = await renewContrato(prevActiveContract.id, baseContratoPayload);
              } else {
                firestoreContratoId = await createContrato(baseContratoPayload);
              }
            }
          }
        }

        setPreparedDraft(prev =>
          prev && prev.draftKey === draft!.draftKey
            ? {
                ...prev,
                emisionRegistradaId: registro!.id,
                firestoreContratoId,
                firestoreDocumentoId,
                pdfStorageUrl
              }
            : prev
        );

        result = {
          status: 'success',
          contratoId: firestoreContratoId || registro.id,
          localEmisionId: registro.id,
          documentoId: firestoreDocumentoId || (canalFirma === 'digital_aspro' ? `doc_lab_${registro.id}` : null),
          canalFirma,
          signatureConfig: registro.signatureConfig,
          pdfSha256: registro.pdfSha256,
          pageCount: registro.pageCount,
          pageSize: `${pdfPageDimensions.width} x ${pdfPageDimensions.height} pt`,
          pdfUrl: pdfStorageUrl,
          sueldoBaseUtilizado: sueldoBase,
          timings: { totalMs: 980 }
        };
      }

      setEmissionResult(result);
      setCurrentStep(4);
      if (onEmitSuccess) onEmitSuccess(result);
    } catch (err: any) {
      console.error('Error al emitir contrato V2:', err);
      setErrorMsg(err.message || 'Ocurrió un error inesperado durante la emisión.');
    } finally {
      setIsEmitting(false);
      setEmissionProgressText('');
    }
  };

  const handleResetAndClose = () => {
    setCurrentStep(1);
    setEmissionResult(null);
    setErrorMsg(null);
    setSueldoBaseModificadoManualmente(false);
    setSigConfig(crearSignatureConfigInicial());
    setSelectedSigTemplateId('');
    setSigZoom(1);
    setPreparedDraft(old => {
      if (old?.pdfBlobUrl) URL.revokeObjectURL(old.pdfBlobUrl);
      return null;
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={`bg-white border border-slate-100 rounded-3xl w-full ${
          currentStep === 3 && canalFirma === 'digital_aspro' ? 'max-w-5xl' : 'max-w-4xl'
        } shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-slate-800 transition-all duration-200`}
      >
        
        {/* HEADER MODAL (ESTILO ASPRO LIMPIO: BLANCO + AZUL) */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 bg-blue-600 text-white rounded-2xl shadow-lg shadow-blue-200 flex items-center justify-center shrink-0">
              <FileText size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-base md:text-lg font-black text-slate-900 tracking-tight uppercase">
                  Emisión de Contrato V2
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
                  DOCX + Gotenberg v8
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium">
                Sueldo base contractual y referencia legal centralizada
              </p>
            </div>
          </div>
          <button
            onClick={handleResetAndClose}
            className="p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* STEPPER DE NAVEGACIÓN (PÍLDORAS ESTILO ASPRO) */}
        <div className="px-6 py-3.5 bg-white border-b border-slate-100 flex items-center justify-between overflow-x-auto gap-2">
          {[
            { num: 1, label: '1. Colaborador y Plantilla' },
            { num: 2, label: '2. Cláusulas y Sueldo Base' },
            { num: 3, label: '3. Canal y Revisión' },
            { num: 4, label: '4. Confirmación' }
          ].map((s, idx) => (
            <React.Fragment key={s.num}>
              <div
                className={`px-3.5 py-1.5 rounded-full text-xs whitespace-nowrap transition-all flex items-center gap-1.5 ${
                  currentStep === s.num
                    ? 'bg-blue-600 text-white font-black shadow-sm shadow-blue-200'
                    : currentStep > s.num
                    ? 'bg-emerald-100 text-emerald-700 font-black'
                    : 'bg-slate-100 text-slate-400 font-bold'
                }`}
              >
                {currentStep > s.num && <Check size={12} className="stroke-[3]" />}
                <span>{s.label}</span>
              </div>
              {idx < 3 && (
                <ChevronRight size={14} className="text-slate-300 shrink-0 hidden sm:block" />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* ALERTA DE ERROR */}
        {errorMsg && (
          <div className="mx-6 mt-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-3 text-rose-700 text-xs font-medium animate-in fade-in duration-150">
            <AlertCircle size={16} className="text-rose-600 shrink-0" />
            <span className="whitespace-pre-line">{errorMsg}</span>
          </div>
        )}

        {/* CUERPO DEL ASISTENTE */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white">

          {/* PASO 1: SELECCIÓN DE COLABORADOR Y PLANTILLA */}
          {currentStep === 1 && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Buscador de Colaboradores */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-700">
                    1. Seleccionar Colaborador Titular *
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowInactiveWorkers(!showInactiveWorkers)}
                    className={`text-[10px] px-2.5 py-1 rounded-lg font-bold transition border ${
                      showInactiveWorkers
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                  >
                    {showInactiveWorkers ? 'Viendo Todos' : 'Solo Activos'}
                  </button>
                </div>
                <div className="relative mb-3">
                  <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar por nombre o RUT..."
                    value={workerSearchTerm}
                    onChange={(e) => setWorkerSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 border border-slate-200 rounded-2xl bg-slate-50/60">
                  {filteredWorkers.map(w => {
                    const isSelected = selectedWorkerId === w.id;
                    return (
                      <div
                        key={w.id}
                        onClick={() => {
                          setSelectedWorkerId(w.id);
                          setSueldoBaseModificadoManualmente(false);
                        }}
                        className={`p-3 rounded-xl border text-xs cursor-pointer transition flex items-center justify-between ${
                          isSelected
                            ? 'bg-blue-50/90 border-blue-600 text-slate-900 ring-1 ring-blue-600 shadow-sm'
                            : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="truncate">
                          <p className="font-bold text-slate-800 truncate">
                            {w.firstName} {w.lastNamePaterno} {w.lastNameMaterno || ''}
                            {!w.isActive && (
                              <span className="ml-1.5 text-[9px] text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded uppercase font-black">
                                Inactivo
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                            {w.rut} · {w.cargo || 'Sin cargo'}
                          </p>
                        </div>
                        {isSelected && <CheckCircle2 size={16} className="text-blue-600 shrink-0 ml-2" />}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Ficha Resumen del Colaborador */}
              {selectedWorker && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-center gap-3.5">
                  <div className="p-2.5 bg-blue-100 text-blue-700 rounded-xl shrink-0">
                    <UserCheck size={18} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs flex-1">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">RUT</span>
                      <span className="font-bold text-slate-800 font-mono">{selectedWorker.rut}</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Dirección</span>
                      <span className="font-semibold text-slate-700 truncate block">{selectedWorker.direccion || 'Sin registrar'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Salud / AFP</span>
                      <span className="font-semibold text-slate-700">{selectedWorker.salud || 'Fonasa'} / {selectedWorker.afp || 'Modelo'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Código Interno</span>
                      <span className="font-semibold text-slate-700">{selectedWorker.codigo || '10'}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Selección de Plantilla Maestra */}
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-2">
                  2. Seleccionar Plantilla Maestra DOCX *
                </label>
                <div className="space-y-2.5">
                  {cargandoPlantillas ? (
                    <div className="p-6 text-center text-slate-500 flex items-center justify-center gap-2 bg-slate-50 rounded-2xl border border-slate-200">
                      <Loader2 size={16} className="animate-spin text-blue-600" />
                      <span className="text-xs font-medium">Cargando plantillas desde IndexedDB...</span>
                    </div>
                  ) : plantillas.length === 0 ? (
                    <div className="p-5 bg-slate-50 border border-slate-200 rounded-2xl text-center text-xs text-slate-500">
                      No se encontraron plantillas. Vaya a la pestaña <strong className="text-blue-600">"Plantillas Word V2"</strong> para subir una.
                    </div>
                  ) : (
                    plantillas.map(tpl => {
                      const isSelected = selectedTemplateId === tpl.id;
                      const tieneErrores = tpl.erroresValidacion.length > 0;
                      return (
                        <div
                          key={tpl.id}
                          onClick={() => {
                            if (!tpl.activa || tieneErrores) return;
                            setSelectedTemplateId(tpl.id);
                            setTipoContrato(tpl.tipoContrato);
                          }}
                          className={`p-4 rounded-2xl border text-xs transition flex items-start justify-between ${
                            !tpl.activa || tieneErrores
                              ? 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
                              : isSelected
                              ? 'bg-blue-50/70 border-blue-600 text-slate-900 ring-1 ring-blue-600 shadow-sm cursor-pointer'
                              : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-slate-50/50 cursor-pointer'
                          }`}
                        >
                          <div className="space-y-1.5 flex-1 pr-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-black text-sm text-slate-900">{tpl.nombre}</span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-slate-100 text-slate-600 border border-slate-200">
                                v{tpl.version}
                              </span>
                              {tpl.esEjemploSintetico ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-50 text-amber-700 border border-amber-200">
                                  Ejemplo Sintético
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  Plantilla Propia RR.HH.
                                </span>
                              )}
                              {!tpl.activa && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-50 text-rose-700 border border-rose-200">
                                  Inactiva
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-slate-500">
                              <span>Modalidad definida en plantilla: <strong className="text-blue-700">{tpl.tipoContrato}</strong></span>
                              <span>•</span>
                              <span>{tpl.variablesDetectadas.length} variables detectadas</span>
                            </div>
                            {tpl.descripcion && (
                              <p className="text-slate-500 text-xs">{tpl.descripcion}</p>
                            )}
                            {tieneErrores && (
                              <p className="text-rose-600 text-[11px] font-bold">
                                ⚠ Errores: {tpl.erroresValidacion.join('; ')}
                              </p>
                            )}
                          </div>
                          {isSelected && <CheckCircle2 size={18} className="text-blue-600 shrink-0 ml-3" />}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* PASO 2: INSTALACIÓN, FECHAS, HORARIOS Y SUELDO BASE */}
          {currentStep === 2 && (
            <div className="space-y-5 animate-in fade-in duration-150">
              {/* Resumen informativo de la Plantilla y Modalidad ya elegida en Paso 1 */}
              {selectedTemplate && (
                <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-2xl flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5 truncate">
                    <FileText size={16} className="text-blue-600 shrink-0" />
                    <span className="font-bold text-slate-800 truncate">{selectedTemplate.nombre}</span>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-[10px] font-black uppercase tracking-wider shrink-0">
                    Modalidad: {selectedTemplate.tipoContrato}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Buscador Amigable de Sucursal / Instalación */}
                <div className="relative" ref={siteDropdownRef}>
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                    Sucursal / Instalación ({"{{Sucursal}}"}) *
                  </label>
                  <div className="relative">
                    <MapPin size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder='Escribe para filtrar (ej: "demo")...'
                      value={siteSearchTerm}
                      onFocus={() => {
                        setSiteSearchTerm('');
                        setShowSiteDropdown(true);
                      }}
                      onClick={() => {
                        setShowSiteDropdown(true);
                      }}
                      onChange={(e) => {
                        setSiteSearchTerm(e.target.value);
                        setShowSiteDropdown(true);
                      }}
                      className="w-full pl-9 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                    {siteSearchTerm && (
                      <button
                        type="button"
                        onClick={() => {
                          setSiteSearchTerm('');
                          setShowSiteDropdown(true);
                        }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                        title="Limpiar filtro de sucursal"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  {showSiteDropdown && (
                    <div className="absolute top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-56 overflow-y-auto z-50 divide-y divide-slate-100">
                      <div
                        onClick={() => {
                          setSucursalId('0');
                          setSiteSearchTerm('Multisitio / General GGSS');
                          setShowSiteDropdown(false);
                        }}
                        className={`px-3.5 py-2.5 cursor-pointer text-xs hover:bg-blue-50 transition flex items-center justify-between ${
                          sucursalId === '0' ? 'bg-blue-50/70 font-bold text-blue-700' : 'text-slate-700 font-medium'
                        }`}
                      >
                        <span>Multisitio / General GGSS</span>
                        {sucursalId === '0' && <Check size={13} className="text-blue-600" />}
                      </div>

                      {filteredSites.map(s => {
                        const isSelected = String(sucursalId) === String(s.id);
                        return (
                          <div
                            key={s.id}
                            onClick={() => {
                              setSucursalId(String(s.id));
                              setSiteSearchTerm(s.name);
                              setShowSiteDropdown(false);
                            }}
                            className={`px-3.5 py-2.5 cursor-pointer text-xs hover:bg-blue-50 transition flex items-center justify-between ${
                              isSelected ? 'bg-blue-50/70 font-bold text-blue-700' : 'text-slate-800'
                            }`}
                          >
                            <div className="truncate pr-2">
                              <div className="font-bold truncate">
                                {s.name}
                                {!s.active && (
                                  <span className="ml-1.5 text-[9px] text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded uppercase font-black">
                                    Inactiva
                                  </span>
                                )}
                              </div>
                              {s.address && (
                                <div className="text-[10px] text-slate-400 truncate">{s.address}</div>
                              )}
                            </div>
                            {isSelected && <Check size={13} className="text-blue-600 shrink-0" />}
                          </div>
                        );
                      })}

                      {filteredSites.length === 0 && (
                        <div className="p-3.5 text-center text-xs text-slate-400 italic">
                          No se encontraron sucursales para "{siteSearchTerm}"
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Cargo Contractual */}
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Cargo Contractual</label>
                  <input
                    type="text"
                    value={cargo}
                    onChange={(e) => setCargo(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                {/* Fechas */}
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Fecha Inicio *</label>
                  <input
                    type="date"
                    value={fechaInicio}
                    onChange={(e) => setFechaInicio(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                    Fecha Término (Opcional)
                  </label>
                  <input
                    type="date"
                    value={fechaTermino}
                    onChange={(e) => setFechaTermino(e.target.value)}
                    disabled={tipoContrato === 'Indefinido'}
                    className={`w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 ${
                      tipoContrato === 'Indefinido' ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  />
                </div>

                {/* Horario A y Horario B */}
                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Horario A (Diurno) — {"{{Horario_A}}"}</label>
                  <input
                    type="text"
                    value={horarioA}
                    onChange={(e) => setHorarioA(e.target.value)}
                    placeholder="08:30 AM a 18:30 PM"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Horario B (Nocturno) — {"{{Horario_B}}"}</label>
                  <input
                    type="text"
                    value={horarioB}
                    onChange={(e) => setHorarioB(e.target.value)}
                    placeholder="18:00 PM a 09:00 AM"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* DATOS PERSONALES Y DE SUCURSAL AUTOCOMPLETADOS PARA EL CONTRATO */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-700">
                    Variables Autocompletadas del Colaborador y Sucursal (Editables si faltan en ficha)
                  </span>
                  <span className="text-[10px] text-blue-600 font-bold font-mono">
                    {"{{nombre}}, {{rut}}, {{Sucursal}}, etc."}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Fecha Nacimiento ({"{{fecha_nacimiento}}"})</label>
                    <input
                      type="text"
                      value={workerFechaNacimiento}
                      onChange={e => setWorkerFechaNacimiento(e.target.value)}
                      placeholder="DD/MM/AAAA"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Nacionalidad ({"{{nacionalidad}}"})</label>
                    <input
                      type="text"
                      value={workerNacionalidad}
                      onChange={e => setWorkerNacionalidad(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Estado Civil ({"{{estado_civil}}"})</label>
                    <input
                      type="text"
                      value={workerEstadoCivil}
                      onChange={e => setWorkerEstadoCivil(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Teléfono ({"{{telefono}}"})</label>
                    <input
                      type="text"
                      value={workerTelefono}
                      onChange={e => setWorkerTelefono(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Domicilio Particular ({"{{direccion}}"})</label>
                    <input
                      type="text"
                      value={workerDireccion}
                      onChange={e => setWorkerDireccion(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Sistema Salud ({"{{salud}}"})</label>
                    <input
                      type="text"
                      value={workerSalud}
                      onChange={e => setWorkerSalud(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">AFP ({"{{afp}}"})</label>
                    <input
                      type="text"
                      value={workerAfp}
                      onChange={e => setWorkerAfp(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Código Interno ({"{{codigo_interno}}"})</label>
                    <input
                      type="text"
                      value={workerCodigoInterno}
                      onChange={e => setWorkerCodigoInterno(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Empresa Instalación ({"{{empresa}}"})</label>
                    <input
                      type="text"
                      value={siteEmpresa}
                      onChange={e => setSiteEmpresa(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Dirección Sucursal ({"{{direccion_sucursal}}"})</label>
                    <input
                      type="text"
                      value={siteDireccion}
                      onChange={e => setSiteDireccion(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* SECCIÓN ESPECÍFICA: SUELDO BASE CONTRACTUAL Y REFERENCIA PRECONFIGURADA */}
              <div className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-4">
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <DollarSign size={16} className="text-blue-600" />
                    <span className="text-xs font-black uppercase tracking-wider text-slate-800">
                      Sueldo Base Contractual ({"{{sueldo}}"})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-semibold">
                    <Scale size={13} className="text-blue-600" />
                    <span>Valor Preconfigurado en Plantillas Word V2</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                  {/* Campo de Sueldo Base (precargado y modificable) */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Sueldo Base para este Contrato (CLP) *
                    </label>
                    <input
                      type="number"
                      placeholder="Ej: 539000"
                      value={sueldoBase || ''}
                      onChange={(e) => {
                        setSueldoBase(Number(e.target.value));
                        setSueldoBaseModificadoManualmente(true);
                      }}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                    <p className="text-[11px] text-slate-500 mt-1.5">
                      Monto formateado en contrato: <span className="text-blue-600 font-bold font-mono">{formatCLP(sueldoBase)} CLP</span>
                    </p>
                  </div>

                  {/* Panel de Referencia del Sueldo Base Preconfigurado */}
                  <div className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-2 text-xs shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase font-bold text-slate-400">Sueldo Base Preconfigurado</span>
                      <span className="text-[10px] text-blue-600 font-bold">
                        Permanente
                      </span>
                    </div>

                    <div className="text-sm font-black font-mono text-slate-800">
                      {formatCLP(sueldoMinimoLegalService.obtenerSueldoBasePreconfigurado())} CLP
                    </div>

                    <p className="text-[10px] text-slate-500">
                      Se precarga automáticamente al abrir el generador. Puedes modificarlo de forma permanente en la pestaña <strong>Plantillas Word V2</strong>.
                    </p>

                    {/* Estado de Validación */}
                    <div className="pt-1">
                      {sueldoBase >= sueldoMinimoLegalService.obtenerSueldoBasePreconfigurado() ? (
                        <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-medium flex items-center gap-1.5">
                          <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
                          <span>Monto igual o superior al sueldo base preconfigurado.</span>
                        </div>
                      ) : (
                        <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2">
                          <AlertCircle size={15} className="shrink-0 text-amber-600 mt-0.5" />
                          <div className="space-y-0.5">
                            <span className="font-bold block">Monto modificado bajo el valor preconfigurado</span>
                            <span className="text-[10px] leading-tight block text-amber-800">
                              El monto ingresado ({formatCLP(sueldoBase)}) es menor al preconfigurado ({formatCLP(sueldoMinimoLegalService.obtenerSueldoBasePreconfigurado())}). Si es intencional (ej. Part-Time o Faena), puede continuar normalmente.
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PASO 3: CANAL DE FIRMA Y REVISIÓN PREVIA */}
          {currentStep === 3 && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-2">
                Seleccione el Canal de Firma Documental *
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {/* Opción Digital */}
                <div
                  onClick={() => setCanalFirma('digital_aspro')}
                  className={`p-4 rounded-2xl border text-xs cursor-pointer transition space-y-2 ${
                    canalFirma === 'digital_aspro'
                      ? 'bg-blue-50/70 border-blue-600 text-slate-900 ring-1 ring-blue-600 shadow-sm'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-black text-slate-900">
                      <PenTool size={16} className="text-blue-600" />
                      <span>Firma Digital ASPRO (Recomendado)</span>
                    </div>
                    {canalFirma === 'digital_aspro' && <CheckCircle2 size={16} className="text-blue-600" />}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    El documento se prepara para firma manuscrita en app móvil/web del guardia, con validación criptográfica SHA-256.
                  </p>
                </div>

                {/* Opción Física */}
                <div
                  onClick={() => setCanalFirma('fisica_manuscrita')}
                  className={`p-4 rounded-2xl border text-xs cursor-pointer transition space-y-2 ${
                    canalFirma === 'fisica_manuscrita'
                      ? 'bg-blue-50/70 border-blue-600 text-slate-900 ring-1 ring-blue-600 shadow-sm'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-black text-slate-900">
                      <Printer size={16} className="text-blue-600" />
                      <span>Firma Física / Manuscrita</span>
                    </div>
                    {canalFirma === 'fisica_manuscrita' && <CheckCircle2 size={16} className="text-blue-600" />}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Emite el PDF oficial para su descarga e impresión en papel.
                  </p>
                </div>
              </div>

              {/* Ficha Resumen de Emisión */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 text-xs">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="font-black text-slate-700 uppercase tracking-wider text-[11px]">Resumen de la Emisión Inmutable</p>
                  <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg font-mono font-bold text-[11px] text-blue-700">
                    {nombreContratoGenerado}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <span className="text-slate-400 font-bold uppercase block text-[10px]">Colaborador</span>
                    <span className="font-bold text-slate-800">{selectedWorker?.firstName} {selectedWorker?.lastNamePaterno}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-bold uppercase block text-[10px]">Plantilla ({selectedTemplate?.tipoContrato})</span>
                    <span className="font-bold text-slate-800 truncate block">{selectedTemplate?.nombre}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-bold uppercase block text-[10px]">Período</span>
                    <span className="font-bold text-slate-800">{fechaInicio} al {fechaTermino || 'Indefinido'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-bold uppercase block text-[10px]">Sueldo Base Contractual</span>
                    <span className="font-black text-blue-600 font-mono">{formatCLP(sueldoBase)} CLP</span>
                  </div>
                </div>
              </div>

              {/* VISOR Y POSICIONADOR VISUAL DE FIRMA DIGITAL (REUTILIZADO DE ASIGNACIÓN MASIVA) */}
              {canalFirma === 'digital_aspro' && (
                <ContractPdfSignaturePositioner
                  pdfBlobUrl={preparedDraft?.pdfBlobUrl || null}
                  pdfBuffer={preparedDraft?.pdfBuffer || null}
                  documentLabel={nombreContratoGenerado}
                  isGeneratingPreview={isGeneratingPreview}
                  onRegeneratePreview={() => {
                    setIsGeneratingPreview(true);
                    setErrorMsg(null);
                    generarDocumentosBorradorActual()
                      .catch((err: any) => {
                        setErrorMsg(
                          err?.message ||
                            'No se pudo regenerar la vista previa del PDF. Verifique que Gotenberg v8 esté activo.'
                        );
                      })
                      .finally(() => {
                        setIsGeneratingPreview(false);
                      });
                  }}
                  sigConfig={sigConfig}
                  onChangeSigConfig={setSigConfig}
                  selectedSigTemplateId={selectedSigTemplateId}
                  onSelectSigTemplateId={setSelectedSigTemplateId}
                  zoom={sigZoom}
                  onChangeZoom={setSigZoom}
                  pageDimensions={pdfPageDimensions}
                  onUpdatePageDimensions={setPdfPageDimensions}
                  totalPages={pdfTotalPages}
                  onUpdateTotalPages={setPdfTotalPages}
                />
              )}

              {/* Indicador de Proceso */}
              {isEmitting && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl flex items-center gap-3">
                  <Loader2 size={18} className="animate-spin text-blue-600" />
                  <span className="text-xs text-blue-800 font-bold">{emissionProgressText}</span>
                </div>
              )}
            </div>
          )}

          {/* PASO 4: ÉXITO Y DESCARGA */}
          {currentStep === 4 && emissionResult && (
            <div className="space-y-6 text-center py-4 animate-in fade-in duration-200">
              <div className="w-14 h-14 bg-emerald-100 border border-emerald-200 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 size={32} />
              </div>

              <div className="space-y-1">
                <h3 className="text-lg font-black text-slate-900">
                  {emissionResult.status === 'idempotent_duplicate' ? 'Contrato Verificado (Registro Existente)' : 'Contrato Emitido Exitosamente'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {canalFirma === 'digital_aspro'
                    ? 'Documento generado y validado con hash criptográfico SHA-256 y coordenadas de firma digital.'
                    : 'PDF listo para descarga, impresión y posterior adjunto del escaneado firmado.'}
                </p>
              </div>

              {/* Tarjeta de Metadatos Criptográficos */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-left text-xs max-w-lg mx-auto space-y-2">
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="text-slate-500 font-semibold">Nombre del Contrato:</span>
                  <span className="font-mono font-black text-slate-900">{nombreContratoGenerado}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="text-slate-500 font-semibold">ID del Contrato:</span>
                  <span className="font-mono font-bold text-blue-600">{emissionResult.contratoId}</span>
                </div>
                {emissionResult.documentoId && (
                  <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                    <span className="text-slate-500 font-semibold">ID Documento Digital:</span>
                    <span className="font-mono text-slate-700 font-semibold">{emissionResult.documentoId}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="text-slate-500 font-semibold">Sueldo Base Almacenado:</span>
                  <span className="font-mono text-slate-900 font-black">{formatCLP(sueldoBase)} CLP</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="text-slate-500 font-semibold">Páginas Generadas:</span>
                  <span className="text-slate-700 font-bold">{emissionResult.pageCount} página(s) ({emissionResult.pageSize})</span>
                </div>
                {emissionResult.signatureConfig && (
                  <div className="p-2.5 bg-blue-50/80 border border-blue-200 rounded-xl space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-wider text-blue-800 flex items-center gap-1">
                        <PenTool size={12} className="text-blue-600" /> Posición de Firma del Trabajador
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-white border border-blue-200 text-[10px] font-black text-blue-700">
                        {emissionResult.signatureConfig.page === 'last'
                          ? `Última Hoja (Pág. ${emissionResult.signatureConfig.targetPageResolved})`
                          : `Página Específica (${emissionResult.signatureConfig.pageNumber} de ${emissionResult.pageCount})`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-700 pt-0.5">
                      <span>
                        Coordenadas PDF: <strong className="text-blue-700">X = {emissionResult.signatureConfig.posicionX} pt</strong> ·{' '}
                        <strong className="text-blue-700">Y = {emissionResult.signatureConfig.posicionY} pt</strong>
                      </span>
                      <span className="text-[10px] text-slate-500">
                        Lienzo: {emissionResult.signatureConfig.pageWidth}×{emissionResult.signatureConfig.pageHeight} pt
                      </span>
                    </div>
                  </div>
                )}
                <div className="pt-1">
                  <span className="text-slate-500 font-bold block text-[10px] uppercase mb-1">Hash Criptográfico SHA-256:</span>
                  <span className="font-mono text-[10px] text-emerald-700 break-all block bg-white p-2 rounded-lg border border-slate-200">
                    {emissionResult.pdfSha256}
                  </span>
                </div>
              </div>

              {/* Botones de Descarga Inmediata */}
              <div className="max-w-lg mx-auto flex flex-col sm:flex-row gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => handleDescargar('docx')}
                  className="flex-1 py-3 px-4 bg-white hover:bg-slate-50 text-slate-800 rounded-xl text-xs font-black uppercase tracking-wider transition flex items-center justify-center gap-2 border border-slate-300 shadow-sm active:scale-95"
                >
                  <FileText size={16} className="text-blue-600" />
                  <span>Descargar DOCX Rellenado</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDescargar('pdf')}
                  className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition flex items-center justify-center gap-2 shadow-md shadow-blue-200 active:scale-95"
                >
                  <Download size={16} />
                  <span>Descargar PDF Real</span>
                </button>
              </div>

              {/* Confirmación de Persistencia */}
              <div className="max-w-lg mx-auto p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-left text-xs text-blue-900 flex items-start gap-2.5">
                <ShieldCheck size={16} className="text-blue-600 shrink-0 mt-0.5" />
                <span>
                  {canalFirma === 'digital_aspro' ? (
                    <>
                      <strong>Contrato registrado en la ficha del trabajador y enviado a Documentos Pendientes:</strong> El nuevo contrato ya figura como vigente en el perfil del colaborador y fue enviado a su bandeja de <em>Documentos Pendientes de Firma</em> en la App del Trabajador.
                    </>
                  ) : (
                    <>
                      <strong>Contrato registrado en la ficha del trabajador:</strong> El nuevo contrato ya figura como vigente en el perfil del colaborador con su respaldo PDF disponible.
                    </>
                  )}
                </span>
              </div>
            </div>
          )}

        </div>

        {/* FOOTER ACCIONES (BLANCO CON BOTONES ESTILO ASPRO) */}
        <div className="px-6 py-4 bg-white border-t border-slate-100 flex items-center justify-between">
          {currentStep > 1 ? (
            <button
              onClick={handlePrevStep}
              disabled={isEmitting || isGeneratingPreview}
              className="px-5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-black uppercase tracking-wider transition flex items-center gap-1.5 shadow-sm"
            >
              <ChevronLeft size={15} /> {currentStep === 4 ? 'Volver a Revisión y Firma' : 'Anterior'}
            </button>
          ) : <div />}

          <div className="flex items-center gap-2">
            {currentStep < 3 && (
              <button
                onClick={handleNextStep}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition flex items-center gap-1.5 shadow-md shadow-blue-200 active:scale-95"
              >
                Siguiente <ChevronRight size={15} />
              </button>
            )}

            {currentStep === 3 && (
              <button
                onClick={handleExecuteEmission}
                disabled={isEmitting || isGeneratingPreview}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-xs font-black uppercase tracking-wider transition flex items-center gap-2 shadow-md shadow-blue-200 active:scale-95"
              >
                {isEmitting ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    <span>Emitiendo...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={15} />
                    <span>Confirmar y Emitir Contrato V2</span>
                  </>
                )}
              </button>
            )}

            {currentStep === 4 && (
              <button
                onClick={handleResetAndClose}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition shadow-md shadow-blue-200"
              >
                Finalizar y Cerrar
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default ContractEmissionModalV2;
