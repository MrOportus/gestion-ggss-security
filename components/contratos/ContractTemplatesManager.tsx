/**
 * ASPRO — CONTRATOS V2 — FASE 5.2
 * Administrador de Plantillas Contractuales DOCX
 * 
 * Permite:
 * - Cargar archivos DOCX propios desde el ordenador
 * - Inspeccionar variables {{...}} en tiempo real (cuerpo, tablas, encabezados, pies)
 * - Clasificar por tipo de documento y modalidad contractual
 * - Versionar plantillas inmutablemente
 * - Activar/desactivar plantillas con validación previa
 * - Descargar plantilla original
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  FileText, Upload, Plus, CheckCircle2, AlertTriangle, AlertCircle,
  Copy, Download, Trash2, Eye, RefreshCw, Sparkles, FileCode, Check, X,
  Layers, Tag, Info, ArrowUpRight, DollarSign
} from 'lucide-react';
import {
  localContractTemplateService,
  PlantillaContractual,
  ValidacionVariablesResult
} from '../../lib/contratos/localContractTemplateService';
import {
  sueldoMinimoLegalService,
  formatCLP
} from '../../lib/contratos/sueldoMinimoLegalService';

export const ContractTemplatesManager: React.FC = () => {
  const [plantillas, setPlantillas] = useState<PlantillaContractual[]>([]);
  const [cargando, setCargando] = useState<boolean>(true);
  const [modalSubidaAbierto, setModalSubidaAbierto] = useState<boolean>(false);
  const [plantillaSeleccionadaParaVer, setPlantillaSeleccionadaParaVer] = useState<PlantillaContractual | null>(null);

  // Estado de Configuración Permanente de Sueldo Base
  const [sueldoBaseConfig, setSueldoBaseConfig] = useState<number>(() =>
    sueldoMinimoLegalService.obtenerSueldoBasePreconfigurado()
  );
  const [sueldoGuardadoOk, setSueldoGuardadoOk] = useState<boolean>(false);

  const handleGuardarSueldoBase = () => {
    try {
      const nuevo = sueldoMinimoLegalService.guardarSueldoBasePreconfigurado(sueldoBaseConfig);
      setSueldoBaseConfig(nuevo);
      setSueldoGuardadoOk(true);
      setTimeout(() => setSueldoGuardadoOk(false), 3000);
    } catch (err: any) {
      alert(err.message || 'Ingrese un monto de sueldo base válido mayor a $0.');
    }
  };

  // Estados del Formulario de Carga
  const [archivoSeleccionado, setArchivoSeleccionado] = useState<File | null>(null);
  const [nombrePlantilla, setNombrePlantilla] = useState<string>('');
  const [tipoDocumento, setTipoDocumento] = useState<'Contrato' | 'Anexo'>('Contrato');
  const [tipoContrato, setTipoContrato] = useState<'Plazo Fijo' | 'Indefinido' | 'Obra y Faena' | 'Part-Time'>('Plazo Fijo');
  const [descripcion, setDescripcion] = useState<string>('');
  const [plantillaBaseId, setPlantillaBaseId] = useState<string | undefined>(undefined);

  // Estados de Validación en Vivo
  const [analizandoArchivo, setAnalizandoArchivo] = useState<boolean>(false);
  const [resultadoValidacion, setResultadoValidacion] = useState<ValidacionVariablesResult | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cargar lista de plantillas al montar
  const cargarPlantillas = async () => {
    setCargando(true);
    try {
      await localContractTemplateService.inicializar();
      const listado = await localContractTemplateService.listarPlantillas();
      setPlantillas(listado);
    } catch (err: any) {
      console.error('Error al listar plantillas:', err);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarPlantillas();
  }, []);

  // Manejador de selección de archivo DOCX
  const handleSeleccionarArchivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorCarga(null);
    setResultadoValidacion(null);
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setErrorCarga('El archivo debe tener extensión .docx (Microsoft Word).');
      return;
    }

    setArchivoSeleccionado(file);
    if (!nombrePlantilla) {
      // Sugerir nombre legible basado en el archivo
      setNombrePlantilla(file.name.replace(/\.docx$/i, '').replace(/[_-]/g, ' '));
    }

    // Inspección en tiempo real de variables
    setAnalizandoArchivo(true);
    try {
      const buffer = await file.arrayBuffer();
      const validacion = await localContractTemplateService.inspeccionarYValidarDOCX(buffer);
      setResultadoValidacion(validacion);
    } catch (err: any) {
      setErrorCarga(err.message || 'Error al inspeccionar estructura del DOCX.');
    } finally {
      setAnalizandoArchivo(false);
    }
  };

  // Guardar nueva plantilla en IndexedDB
  const handleGuardarPlantilla = async () => {
    if (!archivoSeleccionado) {
      setErrorCarga('Debe seleccionar un archivo DOCX.');
      return;
    }
    if (!nombrePlantilla.trim()) {
      setErrorCarga('El nombre de la plantilla es obligatorio.');
      return;
    }

    setGuardando(true);
    setErrorCarga(null);

    try {
      const buffer = await archivoSeleccionado.arrayBuffer();
      await localContractTemplateService.guardarPlantillaDOCX({
        nombre: nombrePlantilla,
        tipoDocumento,
        tipoContrato,
        archivoNombre: archivoSeleccionado.name,
        archivoBuffer: buffer,
        descripcion,
        plantillaBaseId
      });

      // Limpiar y cerrar modal
      setModalSubidaAbierto(false);
      setArchivoSeleccionado(null);
      setNombrePlantilla('');
      setDescripcion('');
      setPlantillaBaseId(undefined);
      setResultadoValidacion(null);
      await cargarPlantillas();
    } catch (err: any) {
      setErrorCarga(err.message || 'Error guardando plantilla en IndexedDB.');
    } finally {
      setGuardando(false);
    }
  };

  // Alternar estado activo/inactivo
  const handleToggleActiva = async (p: PlantillaContractual) => {
    try {
      await localContractTemplateService.cambiarEstadoPlantilla(p.id, !p.activa);
      await cargarPlantillas();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Descargar plantilla original
  const handleDescargar = async (p: PlantillaContractual) => {
    try {
      const { url, nombreArchivo, revocar } = await localContractTemplateService.crearDescargaPlantilla(p.id);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombreArchivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revocar de inmediato para evitar memory leaks
      setTimeout(revocar, 2000);
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Duplicar como nueva versión
  const handleCrearNuevaVersion = (p: PlantillaContractual) => {
    setPlantillaBaseId(p.id);
    setNombrePlantilla(`${p.nombre} (v${p.version + 1})`);
    setTipoDocumento(p.tipoDocumento);
    setTipoContrato(p.tipoContrato);
    setDescripcion(`Nueva versión derivada de #${p.id} (v${p.version}).`);
    setArchivoSeleccionado(null);
    setResultadoValidacion(null);
    setErrorCarga(null);
    setModalSubidaAbierto(true);
  };

  // Eliminar plantilla
  const handleEliminar = async (p: PlantillaContractual) => {
    if (confirm(`¿Confirma eliminar la plantilla "${p.nombre}"?`)) {
      await localContractTemplateService.eliminarPlantilla(p.id);
      await cargarPlantillas();
    }
  };

  return (
    <div className="space-y-6">
      {/* HEADER DE LA SECCIÓN */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-slate-800">Plantillas Contractuales DOCX</h2>
            <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-black uppercase rounded-full tracking-wider">
              Contratos V2
            </span>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Gestión de plantillas maestras en Microsoft Word. Sube documentos con variables <code className="text-blue-600 font-bold font-mono">{"{{...}}"}</code>, valida su estructura y úsalas en el modal de emisión.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={cargarPlantillas}
            disabled={cargando}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition"
            title="Recargar plantillas"
          >
            <RefreshCw size={16} className={cargando ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => {
              setArchivoSeleccionado(null);
              setNombrePlantilla('');
              setDescripcion('');
              setPlantillaBaseId(undefined);
              setResultadoValidacion(null);
              setErrorCarga(null);
              setModalSubidaAbierto(true);
            }}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-md shadow-blue-200 flex items-center gap-2 transition active:scale-95"
          >
            <Upload size={16} /> Subir Plantilla DOCX
          </button>
        </div>
      </div>

      {/* PANEL DE CONFIGURACIÓN PERMANENTE DE SUELDO BASE POR DEFECTO */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
            <DollarSign size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">
                Sueldo Base Preconfigurado (Valor Permanente)
              </h3>
              <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-md font-mono">
                Actual: {formatCLP(sueldoMinimoLegalService.obtenerSueldoBasePreconfigurado())} CLP
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Este valor se precargará automáticamente cada vez que generes un contrato en <strong>Emitir Contrato V2</strong> (y podrás modificarlo en el momento si un contrato particular lo requiere).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">$</span>
            <input
              type="number"
              value={sueldoBaseConfig || ''}
              onChange={(e) => setSueldoBaseConfig(Number(e.target.value))}
              placeholder="Ej: 539000"
              className="w-40 pl-7 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
          <button
            type="button"
            onClick={handleGuardarSueldoBase}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-sm transition active:scale-95 flex items-center gap-1.5"
          >
            <Check size={14} />
            <span>{sueldoGuardadoOk ? 'Guardado' : 'Guardar Sueldo Base'}</span>
          </button>
        </div>
      </div>

      {/* LISTADO DE PLANTILLAS */}
      {cargando ? (
        <div className="bg-white p-12 text-center rounded-2xl border border-slate-200">
          <RefreshCw size={24} className="animate-spin mx-auto text-blue-600 mb-2" />
          <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Cargando plantillas desde IndexedDB...</p>
        </div>
      ) : plantillas.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-2xl border border-dashed border-slate-300 space-y-3">
          <FileText size={48} className="mx-auto text-slate-300" />
          <h3 className="text-base font-bold text-slate-700">No hay plantillas registradas</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Sube tu primer contrato o anexo en formato Microsoft Word (.docx) para comenzar a emitir contratos personalizados.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {plantillas.map(p => (
            <div
              key={p.id}
              className={`bg-white rounded-2xl border transition-all shadow-sm flex flex-col justify-between overflow-hidden ${
                p.activa ? 'border-slate-200 hover:border-blue-300' : 'border-slate-200 opacity-75 bg-slate-50/50'
              }`}
            >
              <div className="p-5 space-y-3">
                {/* Encabezado de la tarjeta */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold shrink-0">
                      <FileText size={18} />
                    </div>
                    <div>
                      <span className="text-[10px] font-black uppercase text-blue-600 tracking-wider">
                        {p.tipoDocumento} · {p.tipoContrato}
                      </span>
                      <h4 className="text-sm font-bold text-slate-800 line-clamp-1" title={p.nombre}>
                        {p.nombre}
                      </h4>
                    </div>
                  </div>

                  <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-lg shrink-0">
                    v{p.version}
                  </span>
                </div>

                {/* Etiquetas de Estado */}
                <div className="flex flex-wrap items-center gap-2">
                  {p.esEjemploSintetico ? (
                    <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[9px] font-bold uppercase tracking-wider flex items-center gap-1">
                      <Sparkles size={10} /> Ejemplo Sintético
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[9px] font-bold uppercase tracking-wider flex items-center gap-1">
                      <CheckCircle2 size={10} /> Plantilla de Usuario
                    </span>
                  )}

                  <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                    p.activa ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {p.activa ? 'Activa' : 'Inactiva'}
                  </span>

                  {p.erroresValidacion.length > 0 && (
                    <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded text-[9px] font-bold uppercase tracking-wider flex items-center gap-1">
                      <AlertTriangle size={10} /> {p.erroresValidacion.length} error(es)
                    </span>
                  )}
                </div>

                {p.descripcion && (
                  <p className="text-xs text-slate-500 line-clamp-2">{p.descripcion}</p>
                )}

                {/* Resumen de Variables */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                  <span className="text-[11px] font-medium text-slate-400">Variables detectadas:</span>
                  <button
                    onClick={() => setPlantillaSeleccionadaParaVer(p)}
                    className="font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  >
                    <span>{p.variablesDetectadas.length} variables</span>
                    <Eye size={12} />
                  </button>
                </div>
              </div>

              {/* Barra de Acciones */}
              <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-1">
                <button
                  onClick={() => handleToggleActiva(p)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                    p.activa
                      ? 'bg-amber-100 hover:bg-amber-200 text-amber-800'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                  title={p.activa ? 'Desactivar para emisión' : 'Activar para emisión'}
                >
                  {p.activa ? 'Desactivar' : 'Activar'}
                </button>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleDescargar(p)}
                    className="p-1.5 hover:bg-slate-200 text-slate-600 rounded-lg transition"
                    title="Descargar archivo DOCX original"
                  >
                    <Download size={15} />
                  </button>
                  <button
                    onClick={() => handleCrearNuevaVersion(p)}
                    className="p-1.5 hover:bg-slate-200 text-blue-600 rounded-lg transition"
                    title="Crear nueva versión a partir de esta plantilla"
                  >
                    <Copy size={15} />
                  </button>
                  {!p.esEjemploSintetico && (
                    <button
                      onClick={() => handleEliminar(p)}
                      className="p-1.5 hover:bg-rose-100 text-rose-600 rounded-lg transition"
                      title="Eliminar plantilla"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODAL DE CARGA DE PLANTILLA DOCX */}
      {modalSubidaAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header del Modal */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200 flex items-center justify-center font-bold">
                  <Upload size={18} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">
                    {plantillaBaseId ? 'Subir Nueva Versión de Plantilla' : 'Subir Nueva Plantilla DOCX'}
                  </h3>
                  <p className="text-xs text-slate-400 font-medium">Microsoft Word (.docx) con etiquetas de sustitución</p>
                </div>
              </div>
              <button
                onClick={() => setModalSubidaAbierto(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Cuerpo del Formulario */}
            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              {/* Zona de Arrastre / Selección de Archivo */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition ${
                  archivoSeleccionado
                    ? 'border-blue-400 bg-blue-50/40'
                    : 'border-slate-300 hover:border-blue-400 bg-slate-50'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleSeleccionarArchivo}
                  className="hidden"
                />
                <FileText size={36} className={`mx-auto mb-2 ${archivoSeleccionado ? 'text-blue-600' : 'text-slate-400'}`} />
                {archivoSeleccionado ? (
                  <div>
                    <p className="text-sm font-bold text-slate-800">{archivoSeleccionado.name}</p>
                    <p className="text-xs text-slate-500 font-medium">
                      {(archivoSeleccionado.size / 1024).toFixed(1)} KB · Clic para cambiar archivo
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Haz clic para seleccionar o arrastra un archivo DOCX
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">Límite máximo 10 MB</p>
                  </div>
                )}
              </div>

              {/* Resultado del Análisis en Vivo */}
              {analizandoArchivo && (
                <div className="p-4 bg-slate-50 rounded-2xl flex items-center justify-center gap-2 text-xs text-blue-600 font-bold">
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Inspeccionando documento, tablas y encabezados...</span>
                </div>
              )}

              {resultadoValidacion && (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase text-slate-700 tracking-wider">
                      Variables Detectadas ({resultadoValidacion.variablesDetectadas.length})
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      resultadoValidacion.validaParaEmision ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'
                    }`}>
                      {resultadoValidacion.validaParaEmision ? 'Estructura Válida' : 'Requiere Corrección'}
                    </span>
                  </div>

                  {/* Listado de variables detectadas */}
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
                    {resultadoValidacion.variablesDetectadas.map(v => (
                      <span
                        key={v.nombre}
                        className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold flex items-center gap-1 ${
                          v.existeEnAspro
                            ? 'bg-white border border-slate-200 text-slate-700'
                            : 'bg-rose-50 border border-rose-200 text-rose-700'
                        }`}
                        title={v.descripcion}
                      >
                        {v.existeEnAspro ? <Check size={10} className="text-emerald-500" /> : <X size={10} />}
                        <span>{"{{" + v.nombre + "}}"}</span>
                      </span>
                    ))}
                  </div>

                  {/* Errores o advertencias de sintaxis */}
                  {resultadoValidacion.erroresSintaxis.length > 0 && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1 text-xs text-rose-700">
                      <p className="font-bold flex items-center gap-1">
                        <AlertTriangle size={13} /> Errores en etiquetas Word:
                      </p>
                      <ul className="list-disc list-inside text-[11px] space-y-0.5">
                        {resultadoValidacion.erroresSintaxis.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {resultadoValidacion.variablesNoReconocidas.length > 0 && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1 text-xs text-amber-800">
                      <p className="font-bold flex items-center gap-1">
                        <AlertTriangle size={13} /> Variables no soportadas por ASPRO:
                      </p>
                      <p className="text-[11px]">
                        Las siguientes variables no existen en la base de datos de ASPRO y no podrán resolverse: {resultadoValidacion.variablesNoReconocidas.join(', ')}.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Campos de Metadatos */}
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block mb-1">
                    Nombre Descriptivo de la Plantilla
                  </label>
                  <input
                    type="text"
                    value={nombrePlantilla}
                    onChange={e => setNombrePlantilla(e.target.value)}
                    placeholder="Ej. Contrato Plazo Fijo Guardias Turno 4x4 2026"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block mb-1">
                      Tipo de Documento
                    </label>
                    <select
                      value={tipoDocumento}
                      onChange={e => setTipoDocumento(e.target.value as any)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    >
                      <option value="Contrato">Contrato Individual</option>
                      <option value="Anexo">Anexo Modificatorio</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block mb-1">
                      Modalidad Contractual
                    </label>
                    <select
                      value={tipoContrato}
                      onChange={e => setTipoContrato(e.target.value as any)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    >
                      <option value="Plazo Fijo">Plazo Fijo</option>
                      <option value="Indefinido">Indefinido</option>
                      <option value="Obra y Faena">Obra y Faena</option>
                      <option value="Part-Time">Part-Time</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block mb-1">
                    Descripción / Observaciones
                  </label>
                  <textarea
                    rows={2}
                    value={descripcion}
                    onChange={e => setDescripcion(e.target.value)}
                    placeholder="Instrucciones internas, versión o vigencia normativa..."
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                  />
                </div>
              </div>

              {errorCarga && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl flex items-center gap-2">
                  <AlertCircle size={16} />
                  <span>{errorCarga}</span>
                </div>
              )}
            </div>

            {/* Footer con Acciones */}
            <div className="p-6 border-t border-slate-100 bg-white flex items-center justify-end gap-3">
              <button
                onClick={() => setModalSubidaAbierto(false)}
                className="px-4 py-2.5 text-xs font-black uppercase tracking-wider text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleGuardarPlantilla}
                disabled={guardando || !archivoSeleccionado || !nombrePlantilla.trim()}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs font-black uppercase tracking-wider rounded-xl transition active:scale-95 shadow-md shadow-blue-200 flex items-center gap-2"
              >
                {guardando ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    <span>Guardar en Almacén Local</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DETALLES DE VARIABLES DE UNA PLANTILLA */}
      {plantillaSeleccionadaParaVer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white">
              <div>
                <h3 className="text-base font-black text-slate-900">{plantillaSeleccionadaParaVer.nombre}</h3>
                <p className="text-xs text-slate-400">
                  Variables detectadas en documento, tablas, encabezados y pies (v{plantillaSeleccionadaParaVer.version})
                </p>
              </div>
              <button
                onClick={() => setPlantillaSeleccionadaParaVer(null)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div className="grid grid-cols-1 gap-2">
                {plantillaSeleccionadaParaVer.variablesDetectadas.map(v => (
                  <div
                    key={v.nombre}
                    className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-bold text-blue-700 font-mono">
                          {"{{" + v.nombre + "}}"}
                        </code>
                        <span className="px-1.5 py-0.5 bg-slate-200 text-slate-700 text-[9px] font-bold rounded uppercase">
                          {v.fuente}
                        </span>
                        {v.obligatoria && (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[9px] font-bold rounded">
                            Obligatoria
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">{v.descripcion}</p>
                    </div>

                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                      v.existeEnAspro ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'
                    }`}>
                      {v.existeEnAspro ? 'Soportada' : 'No Soportada'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-white flex items-center justify-end">
              <button
                onClick={() => setPlantillaSeleccionadaParaVer(null)}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContractTemplatesManager;
