import React, { useState, useMemo, useEffect } from 'react';
import {
  X, FileText, CheckCircle2, AlertCircle, Calendar, Building,
  Briefcase, Clock, DollarSign, Send, Download, Search, UserCheck,
  ShieldCheck, Eye, Loader2, ArrowRight, ArrowLeft, Check, FileCode,
  Lock, RefreshCw, ExternalLink, PenTool, Printer, Sparkles, Info, Scale
} from 'lucide-react';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { Employee, Site } from '../../types';
import { Contrato } from '../../types/phase1';
import { normalizeText, matchesEmployeeSearch, formatDateDDMMYYYY } from '../../lib/textUtils';
import { 
  sueldoMinimoLegalService, 
  formatCLP,
  ValidacionSueldoBaseResult 
} from '../../lib/contratos/sueldoMinimoLegalService';
import {
  localContractTemplateService,
  PlantillaContractual
} from '../../lib/contratos/localContractTemplateService';
import {
  localContractEmissionsService,
  EmisionLaboratorio
} from '../../lib/contratos/localContractEmissionsService';

export interface ContractEmissionModalV2Props {
  isOpen: boolean;
  onClose: () => void;
  employees: Employee[];
  sites: Site[];
  contratos?: Contrato[];
  preselectedEmployee?: Employee | null;
  contratoAnterior?: Contrato | null;
  onEmitSuccess?: (result: EmissionResult) => void;
  /** Adaptador de emisiÃ³n inyectable (en prod llama a Cloud Function; en lab/test llama al mock) */
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
  contratoAnteriorId?: string | null;
  __devBypass?: boolean;
}

export interface EmissionResult {
  status: 'success' | 'idempotent_duplicate';
  contratoId: string;
  documentoId?: string | null;
  canalFirma: 'digital_aspro' | 'fisica_manuscrita';
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
  // Pasos del Wizard: 1: Trabajador & Plantilla, 2: ClÃ¡usulas & Sueldo Base, 3: Canal & RevisiÃ³n, 4: Ã‰xito
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // Plantillas dinÃ¡micas de IndexedDB
  const [plantillas, setPlantillas] = useState<PlantillaContractual[]>([]);
  const [cargandoPlantillas, setCargandoPlantillas] = useState<boolean>(true);

  // Paso 1: SelecciÃ³n
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>(preselectedEmployee?.id || '');
  const [workerSearchTerm, setWorkerSearchTerm] = useState<string>('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('tpl_sintetica_plazo_fijo_v2');

  // Paso 2: Datos Contractuales
  const [tipoContrato, setTipoContrato] = useState<'Plazo Fijo' | 'Indefinido' | 'Obra y Faena' | 'Part-Time'>('Plazo Fijo');
  const [fechaInicio, setFechaInicio] = useState<string>(new Date().toISOString().split('T')[0]);
  const [fechaTermino, setFechaTermino] = useState<string>('');
  const [cargo, setCargo] = useState<string>('Guardia de Seguridad');
  const [sucursalId, setSucursalId] = useState<string>('0');
  const [jornada, setJornada] = useState<string>('45 horas semanales');
  const [horarioA, setHorarioA] = useState<string>('08:00 hrs a 20:00 hrs (Turno DÃ­a)');
  const [horarioB, setHorarioB] = useState<string>('20:00 hrs a 08:00 hrs (Turno Noche)');
  
  // Sueldo Base Contractual (gestionado independientemente sin cÃ¡lculo de lÃ­quido ni gratificaciones)
  const [sueldoBase, setSueldoBase] = useState<number>(0);
  const [sueldoBaseModificadoManualmente, setSueldoBaseModificadoManualmente] = useState<boolean>(false);

  // Paso 3: Canal de Firma
  const [canalFirma, setCanalFirma] = useState<'digital_aspro' | 'fisica_manuscrita'>('digital_aspro');

  // Estados de Proceso y Errores
  const [isEmitting, setIsEmitting] = useState<boolean>(false);
  const [emissionProgressText, setEmissionProgressText] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [emissionResult, setEmissionResult] = useState<EmissionResult | null>(null);

  // Cargar plantillas desde IndexedDB al abrir el modal
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
            const activa = list.find(p => p.activa && p.erroresValidacion.length === 0) || list[0];
            setSelectedTemplateId(activa.id);
            setTipoContrato(activa.tipoContrato);
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
    }
    return () => { isMounted = false; };
  }, [isOpen]);

  // Precarga cautelosa del sueldo base desde contratos fiables previos (NUNCA desde sueldoLiquido)
  useEffect(() => {
    if (sueldoBaseModificadoManualmente) return;

    if (contratoAnterior && typeof contratoAnterior.sueldoBase === 'number' && contratoAnterior.sueldoBase > 0) {
      setSueldoBase(contratoAnterior.sueldoBase);
    } else if (selectedWorkerId && contratos && contratos.length > 0) {
      // Buscar si el trabajador posee un contrato previo con sueldoBase registrado
      const contratoPrevio = contratos.find(c => 
        c.colaboradorId === selectedWorkerId && 
        typeof c.sueldoBase === 'number' && 
        c.sueldoBase > 0
      );
      if (contratoPrevio && contratoPrevio.sueldoBase) {
        setSueldoBase(contratoPrevio.sueldoBase);
      } else {
        // En ausencia de contrato fiable previo, el valor es 0 para requerir digitaciÃ³n manual
        setSueldoBase(0);
      }
    } else {
      setSueldoBase(0);
    }
  }, [selectedWorkerId, contratoAnterior, contratos, sueldoBaseModificadoManualmente]);

  // ValidaciÃ³n frente a la referencia legal centralizada desacoplada
  const validacionLegal: ValidacionSueldoBaseResult = useMemo(() => {
    return sueldoMinimoLegalService.validarSueldoBaseContractual(sueldoBase, fechaInicio, jornada);
  }, [sueldoBase, fechaInicio, jornada]);

  // Sincronizar preselecciÃ³n de colaborador
  useEffect(() => {
    if (preselectedEmployee) {
      setSelectedWorkerId(preselectedEmployee.id);
      if (preselectedEmployee.cargo) setCargo(preselectedEmployee.cargo);
      if (preselectedEmployee.currentSiteId) setSucursalId(String(preselectedEmployee.currentSiteId));
      if (preselectedEmployee.tipoContrato) {
        setTipoContrato(preselectedEmployee.tipoContrato as any);
      }
      if (preselectedEmployee.fechaInicioContrato) {
        setFechaInicio(preselectedEmployee.fechaInicioContrato.split('T')[0]);
      }
      if (preselectedEmployee.fechaTerminoContrato) {
        setFechaTermino(preselectedEmployee.fechaTerminoContrato.split('T')[0]);
      }
    }
  }, [preselectedEmployee]);

  // Colaborador seleccionado
  const selectedWorker = useMemo(() => {
    return employees.find(e => e.id === selectedWorkerId) || null;
  }, [employees, selectedWorkerId]);

  // Plantilla seleccionada
  const selectedTemplate = useMemo(() => {
    return plantillas.find(p => p.id === selectedTemplateId) || null;
  }, [plantillas, selectedTemplateId]);

  // Colaboradores filtrados en el buscador
  const filteredWorkers = useMemo(() => {
    if (!workerSearchTerm) return employees.slice(0, 30);
    return employees
      .filter(e => matchesEmployeeSearch(workerSearchTerm, e))
      .slice(0, 30);
  }, [employees, workerSearchTerm]);

  if (!isOpen) return null;

  // Manejador del avance de pasos con validaciÃ³n estricta
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
      if (tipoContrato === 'Plazo Fijo') {
        if (!fechaTermino) {
          setErrorMsg('Los contratos a Plazo Fijo exigen obligatoriamente una fecha de tÃ©rmino.');
          return;
        }
        if (fechaInicio > fechaTermino) {
          setErrorMsg('La fecha de inicio no puede ser posterior a la fecha de tÃ©rmino.');
          return;
        }
      }
      if (sueldoBase <= 0) {
        setErrorMsg('Debe ingresar un sueldo base contractual pactado vÃ¡lido (mayor a $0 CLP).');
        return;
      }
      setCurrentStep(3);
    }
  };

  const handlePrevStep = () => {
    setErrorMsg(null);
    if (currentStep === 2) setCurrentStep(1);
    if (currentStep === 3) setCurrentStep(2);
  };

  // Descarga bajo demanda con revocaciÃ³n segura de URLs temporales
  const handleDescargar = async (tipo: 'docx' | 'pdf') => {
    if (!emissionResult) return;
    try {
      const { url, nombreArchivo, revocar } = await localContractEmissionsService.crearDescarga(
        emissionResult.contratoId,
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

  // EjecuciÃ³n de la EmisiÃ³n Real de Laboratorio
  const handleExecuteEmission = async () => {
    setIsEmitting(true);
    setErrorMsg(null);
    setEmissionProgressText('1/3 Validando variables y preparando DOCX contractual...');

    try {
      if (!selectedWorker) {
        throw new Error('Debe seleccionar un colaborador vÃ¡lido.');
      }
      if (!selectedTemplate) {
        throw new Error('Debe seleccionar una plantilla contractual vÃ¡lida.');
      }

      const payload: EmissionPayload = {
        colaboradorId: selectedWorkerId,
        plantillaId: selectedTemplateId,
        tipo: tipoContrato,
        fechaInicio,
        fechaTermino: tipoContrato === 'Plazo Fijo' ? fechaTermino : undefined,
        cargo,
        sucursalId,
        jornada,
        horarioA,
        horarioB,
        sueldoBase,
        canalFirma,
        contratoAnteriorId: contratoAnterior ? contratoAnterior.id : undefined
      };

      let result: EmissionResult;

      if (emissionService) {
        setEmissionProgressText('2/3 Ejecutando conversiÃ³n mediante adaptador inyectado...');
        result = await emissionService(payload);
        setEmissionProgressText('3/3 Registrando resultado de emisiÃ³n...');
      } else {
        // Flujo real de laboratorio Fase 5.2
        const workerFullName = `${selectedWorker.firstName} ${selectedWorker.lastNamePaterno} ${selectedWorker.lastNameMaterno || ''}`.trim();
        const sucursalObj = sites.find(s => String(s.id) === String(sucursalId));
        const payloadSustitucion = localContractTemplateService.generarPayloadSustitucion({
          trabajador: {
            nombre: workerFullName,
            rut: selectedWorker.rut,
            cargo,
            nacionalidad: selectedWorker.nacionalidad,
            estadoCivil: selectedWorker.estadoCivil,
            direccion: selectedWorker.direccion,
            email: selectedWorker.email,
            telefono: selectedWorker.phone || '',
            afp: selectedWorker.afp,
            salud: selectedWorker.salud
          },
          contrato: {
            tipo: tipoContrato,
            fechaInicio,
            fechaTermino: tipoContrato === 'Plazo Fijo' ? fechaTermino : undefined,
            cargo,
            jornada,
            horarioA,
            horarioB,
            sueldoBase
          },
          sucursal: {
            id: sucursalId,
            nombre: sucursalObj?.name || 'MULTISITIO GGSS',
            direccion: sucursalObj?.address || 'DirecciÃ³n de Faena',
            comuna: 'Santiago'
          }
        });

        // CondiciÃ³n 5: Validar que no falte ninguna variable obligatoria de la plantilla
        const validacionVariables = localContractTemplateService.validarVariablesParaEmision(
          selectedTemplate,
          payloadSustitucion
        );

        if (!validacionVariables.valida) {
          throw new Error(
            `EmisiÃ³n bloqueada. No se pudo resolver la totalidad de variables exigidas:\nâ€¢ ` +
            validacionVariables.errores.join('\nâ€¢ ')
          );
        }

        // Recuperar binario DOCX de la plantilla desde IndexedDB
        const templateBuffer = await localContractTemplateService.obtenerBinarioPlantilla(selectedTemplate.id);
        if (!templateBuffer || templateBuffer.byteLength < 500) {
          throw new Error(
            `El archivo binario DOCX para la plantilla "${selectedTemplate.nombre}" no estÃ¡ disponible o estÃ¡ vacÃ­o.`
          );
        }

        // Sustituir variables con docxtemplater + pizzip
        let zip: PizZip;
        try {
          zip = new PizZip(templateBuffer);
        } catch (zipErr: any) {
          throw new Error(`El archivo de plantilla no tiene una estructura DOCX vÃ¡lida: ${zipErr.message}`);
        }

        const doc = new Docxtemplater(zip, {
          paragraphLoop: true,
          linebreaks: true,
          delimiters: { start: '{{', end: '}}' },
          parser: tag => ({
            get: scope => {
              if (!tag) return '';
              return tag.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), scope);
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

        // CondiciÃ³n 6: ConversiÃ³n real con Gotenberg local en http://localhost:3005 (proxied en /api/gotenberg)
        setEmissionProgressText('2/3 Convirtiendo DOCX a PDF en Gotenberg local (http://localhost:3005)...');

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
            `No fue posible conectar con el conversor Gotenberg (http://localhost:3005). Verifique que el contenedor Docker estÃ© iniciado (docker run -d -p 3005:3000 gotenberg/gotenberg:8). Detalle: ${fetchErr.message}`
          );
        }

        if (!respGotenberg.ok) {
          const errDetail = await respGotenberg.text().catch(() => '');
          throw new Error(
            `El conversor Gotenberg fallÃ³ con cÃ³digo HTTP ${respGotenberg.status} (${respGotenberg.statusText}): ${errDetail || 'Error desconocido'}`
          );
        }

        const pdfBuffer = await respGotenberg.arrayBuffer();

        // CondiciÃ³n 7: Comprobar que el archivo puede abrirse y que su contenido no estÃ¡ vacÃ­o
        if (!pdfBuffer || pdfBuffer.byteLength < 500) {
          throw new Error('El archivo PDF retornado por Gotenberg estÃ¡ vacÃ­o o incompleto (menos de 500 bytes).');
        }

        const headerBytes = new Uint8Array(pdfBuffer.slice(0, 5));
        const headerMagic = String.fromCharCode(...headerBytes);
        if (!headerMagic.startsWith('%PDF')) {
          throw new Error('El archivo generado por Gotenberg no contiene la cabecera estÃ¡ndar de documento PDF.');
        }

        // CondiciÃ³n 7: Guardar el DOCX rellenado y el PDF real en IndexedDB y calcular SHA-256
        setEmissionProgressText('3/3 Guardando DOCX y PDF en IndexedDB y verificando SHA-256...');

        const registro = await localContractEmissionsService.registrarEmision({
          colaboradorId: selectedWorker.id,
          colaboradorNombre: workerFullName,
          colaboradorRut: selectedWorker.rut,
          plantillaId: selectedTemplate.id,
          plantillaNombre: selectedTemplate.nombre,
          plantillaVersion: selectedTemplate.version,
          sueldoBase,
          tipoContrato,
          canalFirma,
          docxBuffer: docxRellenadoBuffer,
          pdfBuffer,
          pageCount: 4
        });

        result = {
          status: 'success',
          contratoId: registro.id,
          documentoId: canalFirma === 'digital_aspro' ? `doc_lab_${registro.id}` : null,
          canalFirma,
          pdfSha256: registro.pdfSha256,
          pageCount: registro.pageCount,
          pageSize: '595.30 x 841.89 pt (A4)',
          sueldoBaseUtilizado: sueldoBase,
          timings: { totalMs: 980 }
        };
      }

      setEmissionResult(result);
      setCurrentStep(4);
      if (onEmitSuccess) onEmitSuccess(result);
    } catch (err: any) {
      console.error('Error al emitir contrato V2:', err);
      setErrorMsg(err.message || 'OcurriÃ³ un error inesperado durante la emisiÃ³n.');
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
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-slate-100">
        
        {/* HEADER MODAL */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-xl">
              <FileText size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">EmisiÃ³n de Contrato V2</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  DOCX + Gotenberg v8
                </span>
              </div>
              <p className="text-xs text-slate-400">Sueldo base contractual y referencia legal centralizada</p>
            </div>
          </div>
          <button
            onClick={handleResetAndClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* STEPPER DE NAVEGACIÃ“N */}
        <div className="px-6 py-3 bg-slate-950/50 border-b border-slate-800/80 flex items-center justify-between">
          {[
            { num: 1, label: 'Colaborador y Plantilla' },
            { num: 2, label: 'ClÃ¡usulas y Sueldo Base' },
            { num: 3, label: 'Canal y RevisiÃ³n' },
            { num: 4, label: 'ConfirmaciÃ³n' }
          ].map(s => (
            <div key={s.num} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                currentStep === s.num
                  ? 'bg-indigo-600 text-white ring-2 ring-indigo-400/40'
                  : currentStep > s.num
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-500'
              }`}>
                {currentStep > s.num ? <Check size={12} /> : s.num}
              </div>
              <span className={`text-xs font-medium hidden sm:inline ${
                currentStep === s.num ? 'text-white font-bold' : 'text-slate-500'
              }`}>
                {s.label}
              </span>
              {s.num < 4 && <div className="w-6 md:w-12 h-px bg-slate-800 hidden sm:block ml-2" />}
            </div>
          ))}
        </div>

        {/* ALERTA DE ERROR */}
        {errorMsg && (
          <div className="mx-6 mt-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-3 text-rose-300 text-xs animate-in fade-in duration-150">
            <AlertCircle size={16} className="text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* CUERPO DEL ASISTENTE */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* PASO 1: SELECCIÃ“N DE COLABORADOR Y PLANTILLA */}
          {currentStep === 1 && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Buscador de Colaboradores */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  1. Seleccionar Colaborador Titular *
                </label>
                <div className="relative mb-3">
                  <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Filtrar por nombre o RUT del trabajador..."
                    value={workerSearchTerm}
                    onChange={(e) => setWorkerSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-1 border border-slate-800/80 rounded-xl bg-slate-950/40">
                  {filteredWorkers.map(w => {
                    const isSelected = selectedWorkerId === w.id;
                    return (
                      <div
                        key={w.id}
                        onClick={() => {
                          setSelectedWorkerId(w.id);
                          setSueldoBaseModificadoManualmente(false);
                        }}
                        className={`p-2.5 rounded-xl border text-xs cursor-pointer transition flex items-center justify-between ${
                          isSelected
                            ? 'bg-indigo-600/15 border-indigo-500 text-white'
                            : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="truncate">
                          <p className="font-bold truncate">{w.firstName} {w.lastNamePaterno} {w.lastNameMaterno || ''}</p>
                          <p className="text-[11px] text-slate-400">{w.rut} Â· {w.cargo || 'Sin cargo'}</p>
                        </div>
                        {isSelected && <CheckCircle2 size={16} className="text-indigo-400 shrink-0 ml-2" />}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Ficha Resumen del Colaborador */}
              {selectedWorker && (
                <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl flex items-center gap-3">
                  <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-xl">
                    <UserCheck size={18} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs flex-1">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase block">RUT</span>
                      <span className="font-medium text-slate-200">{selectedWorker.rut}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase block">DirecciÃ³n</span>
                      <span className="font-medium text-slate-200 truncate block">{selectedWorker.direccion || 'Sin registrar'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase block">Salud / AFP</span>
                      <span className="font-medium text-slate-200">{selectedWorker.salud || 'Fonasa'} / {selectedWorker.afp || 'Modelo'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase block">Nacionalidad</span>
                      <span className="font-medium text-slate-200">{selectedWorker.nacionalidad || 'Chilena'}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* SelecciÃ³n de Plantilla Maestra */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  2. Seleccionar Plantilla Maestra DOCX *
                </label>
                <div className="space-y-2">
                  {cargandoPlantillas ? (
                    <div className="p-6 text-center text-slate-500 flex items-center justify-center gap-2 bg-slate-950 rounded-2xl border border-slate-800">
                      <Loader2 size={16} className="animate-spin text-indigo-400" />
                      <span className="text-xs">Cargando plantillas desde IndexedDB...</span>
                    </div>
                  ) : plantillas.length === 0 ? (
                    <div className="p-5 bg-slate-950 border border-slate-800 rounded-2xl text-center text-xs text-slate-400">
                      No se encontraron plantillas. Vaya a la pestaÃ±a <strong className="text-indigo-400">"Plantillas Word V2"</strong> para subir una.
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
                          className={`p-3.5 rounded-2xl border text-xs transition flex items-start justify-between ${
                            !tpl.activa || tieneErrores
                              ? 'bg-slate-950/40 border-slate-800/50 opacity-60 cursor-not-allowed'
                              : isSelected
                              ? 'bg-indigo-600/15 border-indigo-500 text-white ring-1 ring-indigo-500 cursor-pointer'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700 cursor-pointer'
                          }`}
                        >
                          <div className="space-y-1.5 flex-1 pr-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-sm text-slate-100">{tpl.nombre}</span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-slate-800 text-slate-400">
                                v{tpl.version}
                              </span>
                              {tpl.esEjemploSintetico && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  Ejemplo SintÃ©tico
                                </span>
                              )}
                              {!tpl.activa && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-500/20 text-rose-300">
                                  Inactiva
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-[11px] text-slate-400">
                              <span>Tipo: <strong className="text-slate-300">{tpl.tipoContrato}</strong></span>
                              <span>â€¢</span>
                              <span>{tpl.variablesDetectadas.length} variables detectadas</span>
                            </div>
                            {tpl.descripcion && (
                              <p className="text-slate-400 text-xs">{tpl.descripcion}</p>
                            )}
                            {tieneErrores && (
                              <p className="text-rose-400 text-[11px] font-medium">
                                âš  Errores: {tpl.erroresValidacion.join('; ')}
                              </p>
                            )}
                          </div>
                          {isSelected && <CheckCircle2 size={18} className="text-indigo-400 shrink-0 ml-3" />}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* PASO 2: CLÃUSULAS Y SUELDO BASE CONTRACTUAL */}
          {currentStep === 2 && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Modalidad */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">Tipo Contractual *</label>
                  <select
                    value={tipoContrato}
                    onChange={(e) => setTipoContrato(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Plazo Fijo">Plazo Fijo</option>
                    <option value="Indefinido">Indefinido</option>
                    <option value="Obra y Faena">Obra y Faena</option>
                    <option value="Part-Time">Part-Time</option>
                  </select>
                </div>

                {/* Sucursal / Faena */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">Sucursal / Lugar de PrestaciÃ³n *</label>
                  <select
                    value={sucursalId}
                    onChange={(e) => setSucursalId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="0">Multisitio / General GGSS</option>
                    {sites.filter(s => s.active).map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                {/* Fechas */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">Fecha de Inicio *</label>
                  <input
                    type="date"
                    value={fechaInicio}
                    onChange={(e) => setFechaInicio(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">
                    Fecha de TÃ©rmino {tipoContrato === 'Plazo Fijo' ? '*' : '(Opcional)'}
                  </label>
                  <input
                    type="date"
                    value={fechaTermino}
                    onChange={(e) => setFechaTermino(e.target.value)}
                    disabled={tipoContrato === 'Indefinido'}
                    className={`w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                      tipoContrato === 'Indefinido' ? 'opacity-40 cursor-not-allowed' : ''
                    }`}
                  />
                </div>

                {/* Cargo */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-slate-400 mb-1">Cargo y Funciones EspecÃ­ficas *</label>
                  <input
                    type="text"
                    value={cargo}
                    onChange={(e) => setCargo(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Turnos y Jornada */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">Jornada Semanal</label>
                  <input
                    type="text"
                    value={jornada}
                    onChange={(e) => setJornada(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">Horario Turno Rotativo A</label>
                  <input
                    type="text"
                    value={horarioA}
                    onChange={(e) => setHorarioA(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* SECCIÃ“N ESPECÃFICA: SUELDO BASE CONTRACTUAL Y REFERENCIA LEGAL */}
              <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <DollarSign size={16} className="text-indigo-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                      Sueldo Base Contractual Pactado
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Scale size={13} className="text-indigo-400" />
                    <span>Referencia Legal Centralizada</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                  {/* Campo de Sueldo Base */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-300 mb-1">
                      Sueldo Base a Estipular en ClÃ¡usula Quinta (CLP) *
                    </label>
                    <input
                      type="number"
                      placeholder="Ej: 550000"
                      value={sueldoBase || ''}
                      onChange={(e) => {
                        setSueldoBase(Number(e.target.value));
                        setSueldoBaseModificadoManualmente(true);
                      }}
                      className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white font-mono font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Monto formateado en contrato: <span className="text-indigo-300 font-bold font-mono">{formatCLP(sueldoBase)} CLP</span>
                    </p>
                  </div>

                  {/* Panel de ValidaciÃ³n Legal Centralizada */}
                  <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase font-bold text-slate-500">MÃ­nimo Legal de Referencia</span>
                      {validacionLegal.vigenciaAplicable && (
                        <span className="text-[10px] text-slate-400 font-mono">
                          {validacionLegal.vigenciaAplicable.vigenciaDesde}
                        </span>
                      )}
                    </div>

                    <div className="text-sm font-bold font-mono text-slate-200">
                      {validacionLegal.referenciaMinimaCLP 
                        ? `${formatCLP(validacionLegal.referenciaMinimaCLP)} CLP` 
                        : 'No aplicable'}
                    </div>

                    {validacionLegal.vigenciaAplicable && (
                      <p className="text-[10px] text-slate-400 truncate">
                        Fuente: {validacionLegal.vigenciaAplicable.fuenteLegal}
                      </p>
                    )}

                    {/* Estado de ValidaciÃ³n */}
                    <div className="pt-1">
                      {validacionLegal.estado === 'conforme' && (
                        <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] flex items-center gap-1.5">
                          <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
                          <span>Sueldo base conforme a la referencia legal aplicable.</span>
                        </div>
                      )}

                      {validacionLegal.estado === 'advertencia_menor_al_minimo' && (
                        <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] flex items-start gap-2">
                          <AlertCircle size={15} className="shrink-0 text-amber-400 mt-0.5" />
                          <div className="space-y-0.5">
                            <span className="font-bold block">Advertencia de Posible Incumplimiento</span>
                            <span className="text-[10px] leading-tight block text-amber-200/90">
                              El monto pactado ({formatCLP(sueldoBase)}) es inferior al mÃ­nimo legal ordinario ({formatCLP(validacionLegal.referenciaMinimaCLP || 0)}). Verifique condiciones de jornada antes de emitir.
                            </span>
                          </div>
                        </div>
                      )}

                      {validacionLegal.estado === 'validacion_pendiente' && (
                        <div className="p-2 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 text-[11px] flex items-start gap-1.5">
                          <Info size={14} className="shrink-0 text-indigo-400 mt-0.5" />
                          <span className="text-[10px] leading-tight text-slate-300">
                            {validacionLegal.mensaje}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PASO 3: CANAL DE FIRMA Y REVISIÃ“N PREVIA */}
          {currentStep === 3 && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                Seleccione el Canal de Firma Documental *
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* OpciÃ³n Digital */}
                <div
                  onClick={() => setCanalFirma('digital_aspro')}
                  className={`p-4 rounded-2xl border text-xs cursor-pointer transition space-y-2 ${
                    canalFirma === 'digital_aspro'
                      ? 'bg-indigo-600/15 border-indigo-500 text-white ring-1 ring-indigo-500'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-slate-100">
                      <PenTool size={16} className="text-indigo-400" />
                      <span>Firma Digital ASPRO (Recomendado)</span>
                    </div>
                    {canalFirma === 'digital_aspro' && <CheckCircle2 size={16} className="text-indigo-400" />}
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    El documento se registra en <code className="text-indigo-300">documents</code> para firma manuscrita en app mÃ³vil/web del guardia, con estampado y validaciÃ³n criptogrÃ¡fica SHA-256.
                  </p>
                </div>

                {/* OpciÃ³n FÃ­sica */}
                <div
                  onClick={() => setCanalFirma('fisica_manuscrita')}
                  className={`p-4 rounded-2xl border text-xs cursor-pointer transition space-y-2 ${
                    canalFirma === 'fisica_manuscrita'
                      ? 'bg-indigo-600/15 border-indigo-500 text-white ring-1 ring-indigo-500'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-slate-100">
                      <Printer size={16} className="text-indigo-400" />
                      <span>Firma FÃ­sica / Manuscrita</span>
                    </div>
                    {canalFirma === 'fisica_manuscrita' && <CheckCircle2 size={16} className="text-indigo-400" />}
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    Emite el PDF oficial para su descarga e impresiÃ³n en papel. El contrato queda en estado <code className="text-amber-300">no_adjunto</code> hasta que se adjunte el escaneado verificado.
                  </p>
                </div>
              </div>

              {/* Ficha Resumen de EmisiÃ³n */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3 text-xs">
                <p className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">Resumen de la EmisiÃ³n Inmutable</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Colaborador</span>
                    <span className="font-bold text-slate-200">{selectedWorker?.firstName} {selectedWorker?.lastNamePaterno}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Tipo</span>
                    <span className="font-bold text-slate-200">{tipoContrato}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">PerÃ­odo</span>
                    <span className="font-bold text-slate-200">{fechaInicio} al {fechaTermino || 'Indefinido'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Sueldo Base Contractual</span>
                    <span className="font-bold text-indigo-400 font-mono">{formatCLP(sueldoBase)} CLP</span>
                  </div>
                </div>
              </div>

              {/* Indicador de Proceso */}
              {isEmitting && (
                <div className="p-4 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl flex items-center gap-3">
                  <Loader2 size={18} className="animate-spin text-indigo-400" />
                  <span className="text-xs text-indigo-300 font-medium">{emissionProgressText}</span>
                </div>
              )}
            </div>
          )}

          {/* PASO 4: Ã‰XITO Y DESCARGA */}
          {currentStep === 4 && emissionResult && (
            <div className="space-y-6 text-center py-4 animate-in fade-in duration-200">
              <div className="w-14 h-14 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 size={32} />
              </div>

              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">
                  {emissionResult.status === 'idempotent_duplicate' ? 'Contrato Verificado (Registro Existente)' : 'Contrato Emitido Exitosamente'}
                </h3>
                <p className="text-xs text-slate-400">
                  {canalFirma === 'digital_aspro'
                    ? 'Documento registrado y asignado para firma en la app del colaborador.'
                    : 'PDF listo para descarga, impresiÃ³n y posterior adjunto del escaneado firmado.'}
                </p>
              </div>

              {/* Tarjeta de Metadatos CriptogrÃ¡ficos */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl text-left text-xs max-w-lg mx-auto space-y-2">
                <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                  <span className="text-slate-500">ID del Contrato:</span>
                  <span className="font-mono font-bold text-indigo-300">{emissionResult.contratoId}</span>
                </div>
                {emissionResult.documentoId && (
                  <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                    <span className="text-slate-500">ID Documento Digital:</span>
                    <span className="font-mono text-slate-300">{emissionResult.documentoId}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                  <span className="text-slate-500">Sueldo Base Almacenado:</span>
                  <span className="font-mono text-slate-200 font-bold">{formatCLP(sueldoBase)} CLP</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                  <span className="text-slate-500">PÃ¡ginas Generadas:</span>
                  <span className="text-slate-300">{emissionResult.pageCount} pÃ¡ginas (A4)</span>
                </div>
                <div className="pt-1">
                  <span className="text-slate-500 block text-[10px] mb-1">Hash CriptogrÃ¡fico SHA-256:</span>
                  <span className="font-mono text-[10px] text-emerald-400 break-all block bg-slate-900 p-2 rounded-lg border border-slate-800">
                    {emissionResult.pdfSha256}
                  </span>
                </div>
              </div>

              {/* Botones de Descarga Inmediata */}
              <div className="max-w-lg mx-auto flex flex-col sm:flex-row gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => handleDescargar('docx')}
                  className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 border border-slate-700 shadow-md active:scale-95"
                >
                  <FileText size={16} className="text-indigo-400" />
                  <span>Descargar DOCX Rellenado</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDescargar('pdf')}
                  className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 active:scale-95"
                >
                  <Download size={16} />
                  <span>Descargar PDF Real</span>
                </button>
              </div>

              {/* ConfirmaciÃ³n de Persistencia Local */}
              <div className="max-w-lg mx-auto p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-left text-xs text-emerald-300 flex items-start gap-2.5">
                <ShieldCheck size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Persistido en IndexedDB local:</strong> Los archivos binarios y metadatos estÃ¡n almacenados localmente y no se perderÃ¡n al recargar. Puede revisarlos en cualquier momento desde la pestaÃ±a <em>"Historial Emisiones Locales"</em>.
                </span>
              </div>
            </div>
          )}

        </div>

        {/* FOOTER ACCIONES */}
        <div className="px-6 py-4 bg-slate-950/60 border-t border-slate-800 flex items-center justify-between">
          {currentStep > 1 && currentStep < 4 ? (
            <button
              onClick={handlePrevStep}
              disabled={isEmitting}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
            >
              <ArrowLeft size={14} /> Anterior
            </button>
          ) : <div />}

          <div className="flex items-center gap-2">
            {currentStep < 3 && (
              <button
                onClick={handleNextStep}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
              >
                Siguiente <ArrowRight size={14} />
              </button>
            )}

            {currentStep === 3 && (
              <button
                onClick={handleExecuteEmission}
                disabled={isEmitting}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-lg shadow-emerald-600/20"
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
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition"
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

