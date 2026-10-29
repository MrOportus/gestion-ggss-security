/**
 * ASPRO — CONTRATOS V2 — FASE 5.2
 * Historial Local de Emisiones de Laboratorio
 * 
 * Permite:
 * - Consultar todas las emisiones realizadas en modo de prueba/laboratorio
 * - Recuperar y descargar los archivos binarios DOCX y PDF persistidos en IndexedDB
 * - Verificar el hash SHA-256 y metadatos de trazabilidad
 * - Identificar claramente que son emisiones de laboratorio (sin escrituras en producción)
 */

import React, { useState, useEffect } from 'react';
import {
  FileText, Download, Trash2, RefreshCw, ExternalLink, ShieldCheck,
  Calendar, User, DollarSign, Clock, Layers, Sparkles, AlertCircle, FileCode
} from 'lucide-react';
import {
  localContractEmissionsService,
  EmisionLaboratorio,
  formatearNombreContrato
} from '../../lib/contratos/localContractEmissionsService';
import { formatCLP } from '../../lib/contratos/sueldoMinimoLegalService';

export const ContractEmissionsHistory: React.FC = () => {
  const [emisiones, setEmisiones] = useState<EmisionLaboratorio[]>([]);
  const [cargando, setCargando] = useState<boolean>(true);
  const [descargandoId, setDescargandoId] = useState<string | null>(null);

  const cargarEmisiones = async () => {
    setCargando(true);
    try {
      const listado = await localContractEmissionsService.listarEmisiones();
      setEmisiones(listado);
    } catch (err) {
      console.error('Error al cargar historial de emisiones:', err);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarEmisiones();
  }, []);

  // Descargar archivo binario DOCX o PDF con revocación de URL
  const handleDescargar = async (emisionId: string, tipo: 'docx' | 'pdf') => {
    setDescargandoId(`${emisionId}_${tipo}`);
    try {
      const { url, nombreArchivo, revocar } = await localContractEmissionsService.crearDescarga(emisionId, tipo);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombreArchivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revocar de inmediato tras iniciar descarga para prevenir fugas de memoria
      setTimeout(revocar, 2000);
    } catch (err: any) {
      alert(err.message || 'Error al descargar el archivo.');
    } finally {
      setDescargandoId(null);
    }
  };

  // Abrir PDF en nueva pestaña
  const handleAbrirPdf = async (emisionId: string) => {
    setDescargandoId(`${emisionId}_open`);
    try {
      const { url, revocar } = await localContractEmissionsService.crearDescarga(emisionId, 'pdf');
      window.open(url, '_blank');
      // Revocar después de un tiempo prudente
      setTimeout(revocar, 15000);
    } catch (err: any) {
      alert(err.message || 'Error al abrir el PDF.');
    } finally {
      setDescargandoId(null);
    }
  };

  // Eliminar registro individual
  const handleEliminar = async (emisionId: string) => {
    if (confirm(`¿Confirma eliminar la emisión #${emisionId} y sus archivos asociados de IndexedDB?`)) {
      await localContractEmissionsService.eliminarEmision(emisionId);
      await cargarEmisiones();
    }
  };

  // Limpiar todo el historial
  const handleLimpiarTodo = async () => {
    if (confirm('¿Confirma que desea borrar TODO el historial de emisiones locales y sus archivos binarios?')) {
      await localContractEmissionsService.limpiarHistorial();
      await cargarEmisiones();
    }
  };

  return (
    <div className="space-y-6">
      {/* HEADER DE LA SECCIÓN */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-slate-800">Historial de Emisiones Locales</h2>
            <span className="px-2.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-black uppercase rounded-full tracking-wider">
              Modo Laboratorio
            </span>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Registro persistente en IndexedDB de documentos generados durante pruebas. Los archivos DOCX y PDF reales se conservan localmente y pueden ser descargados o revisados en cualquier momento.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={cargarEmisiones}
            disabled={cargando}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition"
            title="Recargar historial"
          >
            <RefreshCw size={16} className={cargando ? 'animate-spin' : ''} />
          </button>
          {emisiones.length > 0 && (
            <button
              onClick={handleLimpiarTodo}
              className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold uppercase tracking-wider transition"
            >
              Limpiar Historial
            </button>
          )}
        </div>
      </div>

      {/* AVISO DE AISLAMIENTO */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-3">
        <ShieldCheck size={20} className="text-blue-600 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-900 leading-relaxed">
          <span className="font-bold">Aislamiento de Seguridad Garantizado:</span> Este historial almacena copias de prueba de forma completamente local en el navegador (IndexedDB). No se escriben documentos en Firestore de producción ni en Firebase Storage, y ningún contrato mostrado aquí ha sido enviado a la plataforma real de firma digital de ASPRO.
        </div>
      </div>

      {/* LISTADO DE EMISIONES */}
      {cargando ? (
        <div className="bg-white p-12 text-center rounded-2xl border border-slate-200">
          <RefreshCw size={24} className="animate-spin mx-auto text-blue-600 mb-2" />
          <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Recuperando emisiones locales...</p>
        </div>
      ) : emisiones.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-2xl border border-dashed border-slate-300 space-y-3">
          <FileText size={48} className="mx-auto text-slate-300" />
          <h3 className="text-base font-bold text-slate-700">Sin emisiones registradas</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Aún no has generado contratos de prueba. Abre el modal de emisión V2 y confirma una emisión para verla reflejada aquí con sus archivos descargables.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-400 uppercase font-black text-[10px] tracking-wider">
                  <th className="p-4">Fecha y Hora</th>
                  <th className="p-4">Colaborador</th>
                  <th className="p-4">Plantilla / Versión</th>
                  <th className="p-4">Sueldo Base</th>
                  <th className="p-4">Canal</th>
                  <th className="p-4">Hash SHA-256</th>
                  <th className="p-4 text-right">Archivos / Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {emisiones.map(e => (
                  <tr key={e.id} className="hover:bg-slate-50/70 transition">
                    {/* Fecha y Hora */}
                    <td className="p-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-slate-700 font-semibold">
                        <Calendar size={13} className="text-slate-400" />
                        <span>{new Date(e.fechaHora).toLocaleDateString('es-CL')}</span>
                        <span className="text-slate-400 font-normal">
                          {new Date(e.fechaHora).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                        {e.id}
                      </span>
                    </td>

                    {/* Colaborador y Nombre de Archivo */}
                    <td className="p-4">
                      <div className="font-bold text-slate-800">{e.colaboradorNombre}</div>
                      <span className="text-[10px] font-mono text-slate-400 block">{e.colaboradorRut}</span>
                      <span className="inline-block mt-1 px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-100 rounded text-[10px] font-mono font-bold">
                        {e.nombreContrato ||
                          formatearNombreContrato({
                            primerNombre: e.colaboradorPrimerNombre,
                            primerApellido: e.colaboradorPrimerApellido,
                            colaboradorNombre: e.colaboradorNombre,
                            fechaInicio: e.fechaInicio,
                            fechaHoraFallback: e.fechaHora
                          })}
                      </span>
                    </td>

                    {/* Plantilla y Versión */}
                    <td className="p-4">
                      <div className="font-semibold text-slate-700 line-clamp-1" title={e.plantillaNombre}>
                        {e.plantillaNombre}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[9px] font-bold">
                          v{e.plantillaVersion}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {e.tipoContrato}
                        </span>
                      </div>
                    </td>

                    {/* Sueldo Base */}
                    <td className="p-4 whitespace-nowrap font-black text-slate-800">
                      {formatCLP(e.sueldoBase)}
                    </td>

                    {/* Canal y Posición de Firma */}
                    <td className="p-4 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        e.canalFirma === 'digital_aspro' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {e.canalFirma === 'digital_aspro' ? 'Digital' : 'Físico'}
                      </span>
                      {e.signatureConfig && (
                        <span
                          className="block text-[10px] font-mono text-slate-500 mt-1"
                          title={`Modo: ${e.signatureConfig.page === 'last' ? 'Última Hoja' : 'Página Específica'} · Lienzo: ${e.signatureConfig.pageWidth}x${e.signatureConfig.pageHeight} pt`}
                        >
                          Pág. {e.signatureConfig.targetPageResolved} · X:{e.signatureConfig.posicionX}, Y:{e.signatureConfig.posicionY} pt
                        </span>
                      )}
                    </td>

                    {/* SHA-256 */}
                    <td className="p-4 font-mono text-[10px] text-slate-500">
                      <span className="bg-slate-100 px-2 py-1 rounded" title={e.pdfSha256}>
                        {e.pdfSha256.substring(0, 12)}...{e.pdfSha256.substring(e.pdfSha256.length - 6)}
                      </span>
                    </td>

                    {/* Acciones */}
                    <td className="p-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Descargar DOCX rellenado */}
                        <button
                          onClick={() => handleDescargar(e.id, 'docx')}
                          disabled={descargandoId === `${e.id}_docx`}
                          className="px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold transition flex items-center gap-1"
                          title={`Descargar DOCX rellenado (${(e.tamanoDocxBytes / 1024).toFixed(1)} KB)`}
                        >
                          <Download size={12} className="text-blue-600" />
                          <span>DOCX</span>
                        </button>

                        {/* Ver / Descargar PDF generado */}
                        <button
                          onClick={() => handleAbrirPdf(e.id)}
                          disabled={descargandoId === `${e.id}_open`}
                          className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-sm"
                          title={`Abrir PDF oficial (${e.pageCount} páginas, ${(e.tamanoPdfBytes / 1024).toFixed(1)} KB)`}
                        >
                          <ExternalLink size={12} />
                          <span>PDF</span>
                        </button>

                        {/* Eliminar */}
                        <button
                          onClick={() => handleEliminar(e.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                          title="Eliminar de historial local"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContractEmissionsHistory;
