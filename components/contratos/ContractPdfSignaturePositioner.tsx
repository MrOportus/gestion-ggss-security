/**
 * ASPRO — CONTRATOS V2
 * Componente Reutilizable de Vista Previa PDF y Posicionamiento Interactivo de Firma Digital
 *
 * Reutiliza el modelo de coordenadas (SharedSignatureConfig, SIG_BOX_WIDTH=120, SIG_BOX_HEIGHT=50,
 * origen inferior izquierdo en puntos PDF) y las plantillas de firma (signatureTemplates de useAppStore)
 * del módulo de Asignación Masiva con Firma Compartida (SharedSignatureBatchModal).
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  MousePointerClick,
  Crosshair,
  Sliders,
  ChevronDown,
  ChevronUp,
  Layers,
  Loader2,
  Move,
  ZoomIn,
  ZoomOut,
  CheckCircle2,
  RefreshCw,
  FileText
} from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { useAppStore } from '../../store/useAppStore';
import type { SharedSignatureConfig } from '../SharedSignatureBatchModal';
import {
  SIG_BOX_WIDTH,
  SIG_BOX_HEIGHT,
  calcularCoordenadasPdfDesdeClic,
  calcularCoordenadasPdfDesdeArrastre,
  calcularEstiloCajaFirmaPorcentual,
  resolverPaginaObjetivoFirma
} from '../../lib/contratos/localContractEmissionsService';

// Asegurar que el worker de pdfjs esté configurado incluso si no se ha abierto DocumentsPage antes
if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  } catch {
    // En entornos de test donde import.meta.url no resuelva el worker binario
  }
}

export interface ContractPdfSignaturePositionerProps {
  pdfBlobUrl: string | null;
  pdfBuffer: ArrayBuffer | null;
  documentLabel: string;
  sigConfig: SharedSignatureConfig;
  onChangeSigConfig: React.Dispatch<React.SetStateAction<SharedSignatureConfig>>;
  selectedSigTemplateId: string;
  onSelectSigTemplateId: (tplId: string) => void;
  zoom: number;
  onChangeZoom: (newZoom: number) => void;
  pageDimensions: { width: number; height: number; orientation: 'portrait' | 'landscape' };
  onUpdatePageDimensions: (dims: { width: number; height: number; orientation: 'portrait' | 'landscape' }) => void;
  totalPages: number;
  onUpdateTotalPages: (total: number) => void;
  isGeneratingPreview?: boolean;
  onRegeneratePreview?: () => void;
}

const BASE_PAGE_RENDER_WIDTH = 380;
const ZOOM_LEVELS = [0.75, 1, 1.25, 1.5];

export const ContractPdfSignaturePositioner: React.FC<ContractPdfSignaturePositionerProps> = ({
  pdfBlobUrl,
  pdfBuffer,
  documentLabel,
  sigConfig,
  onChangeSigConfig,
  selectedSigTemplateId,
  onSelectSigTemplateId,
  zoom,
  onChangeZoom,
  pageDimensions,
  onUpdatePageDimensions,
  totalPages,
  onUpdateTotalPages,
  isGeneratingPreview = false,
  onRegeneratePreview
}) => {
  const { signatureTemplates } = useAppStore();

  const pageContainerRef = useRef<HTMLDivElement>(null);
  const [isDraggingSig, setIsDraggingSig] = useState(false);
  const [showFineTuningSliders, setShowFineTuningSliders] = useState(true);
  const dragStartRef = useRef<{ startX: number; startY: number; sigX: number; sigY: number } | null>(null);
  const hasDraggedRef = useRef<boolean>(false);

  const effectivePageNumber = resolverPaginaObjetivoFirma(sigConfig, totalPages);

  // Inspeccionar con pdf-lib las dimensiones reales y orientación de la página objetivo
  useEffect(() => {
    if (!pdfBuffer || pdfBuffer.byteLength < 500) return;
    let cancelled = false;

    (async () => {
      try {
        const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
        if (cancelled) return;

        const count = pdfDoc.getPageCount();
        if (count > 0 && count !== totalPages) {
          onUpdateTotalPages(count);
        }

        const targetIdx =
          sigConfig.page === 'last'
            ? Math.max(0, count - 1)
            : Math.max(0, Math.min((sigConfig.pageNumber || 1) - 1, count - 1));

        const page = pdfDoc.getPage(targetIdx);
        const { width, height } = page.getSize();
        const w = Math.round(width);
        const h = Math.round(height);
        const orientation: 'portrait' | 'landscape' = w > h ? 'landscape' : 'portrait';

        onUpdatePageDimensions({ width: w, height: h, orientation });

        // Ajustar coordenadas dentro de los límites de la página si exceden
        onChangeSigConfig(prev => {
          const clampedX = Math.max(10, Math.min(w - SIG_BOX_WIDTH - 10, prev.posicionX));
          const clampedY = Math.max(10, Math.min(h - SIG_BOX_HEIGHT - 10, prev.posicionY));
          if (clampedX !== prev.posicionX || clampedY !== prev.posicionY) {
            return { ...prev, posicionX: clampedX, posicionY: clampedY };
          }
          return prev;
        });
      } catch (err) {
        console.warn('[ContractPdfSignaturePositioner] Error inspeccionando dimensiones PDF:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfBuffer, sigConfig.page, sigConfig.pageNumber]);

  // Clic directo en la página para posicionar la firma
  const handlePageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (hasDraggedRef.current) return;
    const rect = pageContainerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;

    const { posicionX, posicionY } = calcularCoordenadasPdfDesdeClic({
      clientX: e.clientX,
      clientY: e.clientY,
      rect,
      pdfDimensions: pageDimensions
    });

    onSelectSigTemplateId('');
    onChangeSigConfig(prev => ({ ...prev, posicionX, posicionY }));
  };

  // Arrastre interactivo con ratón o puntero táctil
  const handleSigPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      sigX: sigConfig.posicionX,
      sigY: sigConfig.posicionY
    };
    hasDraggedRef.current = false;
    setIsDraggingSig(true);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  };

  const handleSigPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current || !pageContainerRef.current) return;
    const rect = pageContainerRef.current.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;

    const deltaX = e.clientX - dragStartRef.current.startX;
    const deltaY = e.clientY - dragStartRef.current.startY;
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
      hasDraggedRef.current = true;
    }

    const { posicionX, posicionY } = calcularCoordenadasPdfDesdeArrastre({
      startClientX: dragStartRef.current.startX,
      startClientY: dragStartRef.current.startY,
      currentClientX: e.clientX,
      currentClientY: e.clientY,
      startSigX: dragStartRef.current.sigX,
      startSigY: dragStartRef.current.sigY,
      rect,
      pdfDimensions: pageDimensions
    });

    onSelectSigTemplateId('');
    onChangeSigConfig(prev => ({ ...prev, posicionX, posicionY }));
  };

  const handleSigPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = null;
    setIsDraggingSig(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    setTimeout(() => {
      hasDraggedRef.current = false;
    }, 100);
  };

  // Ubicaciones rápidas de 1 clic (adaptadas a las dimensiones reales de la página)
  const applyQuickPreset = (preset: 'worker_line' | 'left' | 'center' | 'right') => {
    const docW = pageDimensions.width || 595;
    onSelectSigTemplateId('');
    if (preset === 'worker_line') {
      // Ubicación habitual sobre la línea "TRABAJADOR" (columna izquierda en contratos ASPRO)
      onChangeSigConfig(prev => ({
        ...prev,
        posicionX: Math.max(10, Math.min(docW - SIG_BOX_WIDTH - 10, 115)),
        posicionY: 230
      }));
    } else if (preset === 'left') {
      onChangeSigConfig(prev => ({ ...prev, posicionX: 40, posicionY: 40 }));
    } else if (preset === 'center') {
      onChangeSigConfig(prev => ({
        ...prev,
        posicionX: Math.round((docW - SIG_BOX_WIDTH) / 2),
        posicionY: 40
      }));
    } else if (preset === 'right') {
      onChangeSigConfig(prev => ({
        ...prev,
        posicionX: Math.round(docW - SIG_BOX_WIDTH - 40),
        posicionY: 40
      }));
    }
  };

  // Cargar desde una plantilla de posicionamiento existente en ASPRO
  const handleSelectSignatureTemplate = (tplId: string) => {
    onSelectSigTemplateId(tplId);
    const tpl = signatureTemplates.find(t => t.id === tplId);
    if (tpl) {
      const docW = pageDimensions.width || 595;
      const docH = pageDimensions.height || 842;
      onChangeSigConfig({
        page: tpl.pageType,
        pageNumber: tpl.pageNumber || 1,
        posicionX: Math.max(10, Math.min(docW - SIG_BOX_WIDTH - 10, tpl.posicionX ?? 246)),
        posicionY: Math.max(10, Math.min(docH - SIG_BOX_HEIGHT - 10, tpl.posicionY ?? 90))
      });
    }
  };

  const boxPercentStyle = calcularEstiloCajaFirmaPorcentual(sigConfig, pageDimensions);
  const renderedWidth = Math.round(BASE_PAGE_RENDER_WIDTH * zoom);
  const maxX = Math.max(10, (pageDimensions.width || 595) - SIG_BOX_WIDTH - 10);
  const maxY = Math.max(10, (pageDimensions.height || 842) - SIG_BOX_HEIGHT - 10);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 animate-in fade-in duration-200 pt-1">
      {/* Panel Izquierdo: Controles de Página, Coordenadas, Presets y Ajuste Manual */}
      <div className="lg:col-span-5 space-y-3.5">
        {/* Banner instructivo */}
        <div className="bg-blue-50/80 border border-blue-200 rounded-2xl p-3.5 flex items-start gap-3 text-blue-900 shadow-sm">
          <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
            <MousePointerClick size={18} />
          </div>
          <div className="text-xs">
            <p className="font-black text-slate-900 uppercase tracking-wide">
              Posicionamiento de Firma Digital
            </p>
            <p className="text-slate-600 font-medium text-[11px] mt-0.5 leading-snug">
              <strong>Haz clic</strong> sobre el PDF real generado o <strong>arrastra el recuadro</strong> con el ratón para ubicar dónde firmará el trabajador.
            </p>
          </div>
        </div>

        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3.5">
          {/* Selección de Página */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Página de la Firma
              </label>
              <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                Página activa: {effectivePageNumber} de {totalPages}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChangeSigConfig(prev => ({ ...prev, page: 'last' }))}
                className={`py-2 px-3 rounded-xl text-xs font-black border transition ${
                  sigConfig.page === 'last'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Última Hoja (Pág. {totalPages})
              </button>
              <button
                type="button"
                onClick={() =>
                  onChangeSigConfig(prev => ({
                    ...prev,
                    page: 'specific',
                    pageNumber: Math.min(Math.max(1, prev.pageNumber || totalPages), totalPages)
                  }))
                }
                className={`py-2 px-3 rounded-xl text-xs font-black border transition ${
                  sigConfig.page === 'specific'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Página Específica
              </button>
            </div>

            {sigConfig.page === 'specific' && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-600 shrink-0">N° de página:</span>
                  <input
                    type="number"
                    min={1}
                    max={totalPages}
                    value={sigConfig.pageNumber}
                    onChange={e => {
                      const val = Math.max(1, Math.min(totalPages, parseInt(e.target.value, 10) || 1));
                      onChangeSigConfig(prev => ({ ...prev, pageNumber: val }));
                    }}
                    className="w-20 px-2.5 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex flex-wrap gap-1 flex-1 justify-end">
                    {Array.from({ length: totalPages }, (_, idx) => idx + 1).map(pNum => (
                      <button
                        key={pNum}
                        type="button"
                        onClick={() => onChangeSigConfig(prev => ({ ...prev, pageNumber: pNum }))}
                        className={`px-2 py-1 rounded-lg text-[10px] font-black border transition ${
                          sigConfig.pageNumber === pNum
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-blue-400'
                        }`}
                      >
                        Pág. {pNum}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Presets Rápidos de 1 Clic */}
          <div className="space-y-1.5 pt-2 border-t border-slate-200/80">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
              <Crosshair size={12} className="text-blue-600" />
              Ubicaciones Rápidas (1 Clic)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => applyQuickPreset('worker_line')}
                className="py-1.5 px-2 rounded-xl text-[10px] font-black border bg-white text-blue-700 border-blue-200 hover:bg-blue-50 transition shadow-sm active:scale-95"
                title="Ubicar sobre la línea de firma de TRABAJADOR"
              >
                Línea Trabajador
              </button>
              <button
                type="button"
                onClick={() => applyQuickPreset('left')}
                className="py-1.5 px-2 rounded-xl text-[10px] font-black border bg-white text-slate-700 border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition shadow-sm active:scale-95"
              >
                Pie Izq.
              </button>
              <button
                type="button"
                onClick={() => applyQuickPreset('center')}
                className="py-1.5 px-2 rounded-xl text-[10px] font-black border bg-white text-slate-700 border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition shadow-sm active:scale-95"
              >
                Pie Centro
              </button>
              <button
                type="button"
                onClick={() => applyQuickPreset('right')}
                className="py-1.5 px-2 rounded-xl text-[10px] font-black border bg-white text-slate-700 border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition shadow-sm active:scale-95"
              >
                Pie Der.
              </button>
            </div>
          </div>

          {/* Coordenadas activas y dimensiones PDF */}
          <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-600">Coordenadas actuales (PDF):</span>
              <div className="flex gap-1.5">
                <span className="px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-mono font-black border border-blue-200">
                  X: {sigConfig.posicionX} px
                </span>
                <span className="px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-mono font-black border border-indigo-200">
                  Y: {sigConfig.posicionY} px
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold border-t border-slate-100 pt-1.5">
              <span>
                Hoja: {pageDimensions.width} × {pageDimensions.height} pt (
                {pageDimensions.orientation === 'portrait' ? 'Vertical' : 'Horizontal'})
              </span>
              <span className="text-emerald-600 font-bold flex items-center gap-1">
                <CheckCircle2 size={11} /> Vinculada a este contrato
              </span>
            </div>
          </div>

          {/* Selector de Plantilla de Firma Guardada */}
          {signatureTemplates && signatureTemplates.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-slate-200/80">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Cargar Configuración Existente
              </label>
              <select
                value={selectedSigTemplateId}
                onChange={e => handleSelectSignatureTemplate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Configuración manual / interactiva</option>
                {signatureTemplates.map(tpl => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.nombre} ({tpl.docType})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Ajuste Manual Numérico y Sliders */}
          <div className="pt-2 border-t border-slate-200/80">
            <button
              type="button"
              onClick={() => setShowFineTuningSliders(!showFineTuningSliders)}
              className="w-full flex items-center justify-between text-[11px] font-black text-slate-600 hover:text-slate-900 transition py-1"
            >
              <span className="flex items-center gap-1.5">
                <Sliders size={13} className="text-blue-600" />
                Ajuste manual (sliders y valores exactos)
              </span>
              {showFineTuningSliders ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showFineTuningSliders && (
              <div className="space-y-3 pt-2.5 mt-1.5 border-t border-slate-200/60">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-600">Posición Horizontal (X)</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={10}
                        max={maxX}
                        value={sigConfig.posicionX}
                        onChange={e => {
                          const v = Math.max(10, Math.min(maxX, Number(e.target.value) || 10));
                          onSelectSigTemplateId('');
                          onChangeSigConfig(prev => ({ ...prev, posicionX: v }));
                        }}
                        className="w-16 px-2 py-0.5 bg-white border border-slate-300 rounded text-xs font-mono font-bold text-blue-700 text-right"
                      />
                      <span className="text-[10px] text-slate-400 font-mono">px</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={maxX}
                    step={2}
                    value={sigConfig.posicionX}
                    onChange={e => {
                      onSelectSigTemplateId('');
                      onChangeSigConfig(prev => ({ ...prev, posicionX: Number(e.target.value) }));
                    }}
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-600">Posición Vertical (Y desde fondo)</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={10}
                        max={maxY}
                        value={sigConfig.posicionY}
                        onChange={e => {
                          const v = Math.max(10, Math.min(maxY, Number(e.target.value) || 10));
                          onSelectSigTemplateId('');
                          onChangeSigConfig(prev => ({ ...prev, posicionY: v }));
                        }}
                        className="w-16 px-2 py-0.5 bg-white border border-slate-300 rounded text-xs font-mono font-bold text-blue-700 text-right"
                      />
                      <span className="text-[10px] text-slate-400 font-mono">px</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={maxY}
                    step={2}
                    value={sigConfig.posicionY}
                    onChange={e => {
                      onSelectSigTemplateId('');
                      onChangeSigConfig(prev => ({ ...prev, posicionY: Number(e.target.value) }));
                    }}
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Panel Derecho: Visor del PDF Real Generado con Zoom y Caja de Firma Arrastrable */}
      <div className="lg:col-span-7 bg-slate-100 rounded-2xl border border-slate-200 p-4 flex flex-col items-center justify-start min-h-[480px] max-h-[600px] overflow-auto">
        {/* Barra superior del visor: documento, controles de zoom y recarga */}
        <div className="w-full flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 mb-3 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Layers size={14} className="text-blue-600 shrink-0" />
            <span
              className="text-[11px] font-black text-slate-700 uppercase tracking-wider truncate max-w-[200px] sm:max-w-[240px]"
              title={documentLabel}
            >
              {documentLabel}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                const idx = ZOOM_LEVELS.indexOf(zoom);
                if (idx > 0) onChangeZoom(ZOOM_LEVELS[idx - 1]);
              }}
              disabled={zoom <= ZOOM_LEVELS[0]}
              className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition"
              title="Alejar vista previa"
            >
              <ZoomOut size={13} />
            </button>

            <div className="flex items-center bg-white border border-slate-200 rounded-lg p-0.5">
              {ZOOM_LEVELS.map(z => (
                <button
                  key={z}
                  type="button"
                  onClick={() => onChangeZoom(z)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-black transition ${
                    zoom === z
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {Math.round(z * 100)}%
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                const idx = ZOOM_LEVELS.indexOf(zoom);
                if (idx >= 0 && idx < ZOOM_LEVELS.length - 1) onChangeZoom(ZOOM_LEVELS[idx + 1]);
              }}
              disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
              className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition"
              title="Acercar vista previa"
            >
              <ZoomIn size={13} />
            </button>

            {onRegeneratePreview && (
              <button
                type="button"
                onClick={onRegeneratePreview}
                disabled={isGeneratingPreview}
                className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-300 transition"
                title="Regenerar vista previa del PDF"
              >
                <RefreshCw size={13} className={isGeneratingPreview ? 'animate-spin text-blue-600' : ''} />
              </button>
            )}
          </div>
        </div>

        {/* Contenido del Visor PDF */}
        {isGeneratingPreview || !pdfBlobUrl ? (
          <div className="p-8 text-center text-slate-500 flex flex-col items-center gap-2.5 my-auto">
            <Loader2 size={26} className="animate-spin text-blue-600" />
            <p className="text-xs font-bold text-slate-700">
              Generando vista previa del PDF oficial en Gotenberg...
            </p>
            <p className="text-[11px] text-slate-400 max-w-xs">
              El contrato se convierte con los datos reales del colaborador para posicionar la firma con precisión.
            </p>
          </div>
        ) : (
          <div className="relative inline-block my-auto">
            <Document
              file={pdfBlobUrl}
              onLoadSuccess={({ numPages }) => {
                if (numPages > 0) onUpdateTotalPages(numPages);
              }}
              loading={<Loader2 size={24} className="animate-spin text-blue-600 my-10 mx-auto" />}
            >
              <div
                ref={pageContainerRef}
                onClick={handlePageClick}
                className="relative inline-block shadow-2xl rounded-lg bg-white overflow-hidden cursor-crosshair select-none group touch-none"
                title="Haz clic en cualquier punto para mover la firma del trabajador aquí"
              >
                <Page
                  pageNumber={effectivePageNumber}
                  width={renderedWidth}
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                  onLoadSuccess={pageData => {
                    if (pageData?.originalWidth && pageData?.originalHeight) {
                      const w = Math.round(pageData.originalWidth);
                      const h = Math.round(pageData.originalHeight);
                      onUpdatePageDimensions({
                        width: w,
                        height: h,
                        orientation: w > h ? 'landscape' : 'portrait'
                      });
                    }
                  }}
                />

                {/* Tooltip flotante */}
                <div className="absolute top-2 left-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <span className="px-2 py-1 bg-slate-900/80 backdrop-blur-md text-white text-[9px] font-black uppercase tracking-wider rounded-md flex items-center gap-1.5 shadow-md">
                    <MousePointerClick size={10} className="text-blue-400" />
                    Clic o arrastrar para ubicar (Pág. {effectivePageNumber}/{totalPages})
                  </span>
                </div>

                {/* Caja Interactiva Draggable de Ubicación de Firma */}
                <div
                  onPointerDown={handleSigPointerDown}
                  onPointerMove={handleSigPointerMove}
                  onPointerUp={handleSigPointerUp}
                  onPointerCancel={handleSigPointerUp}
                  className={`absolute rounded-xl flex flex-col items-center justify-center p-1 select-none transition-shadow touch-none ${
                    isDraggingSig
                      ? 'cursor-grabbing bg-blue-600/35 border-2 border-blue-600 shadow-2xl ring-4 ring-blue-400/40 z-30 scale-[1.02]'
                      : 'cursor-grab bg-blue-500/20 hover:bg-blue-500/30 border-2 border-blue-600/90 hover:border-blue-700 shadow-lg hover:shadow-xl z-20 group/box'
                  }`}
                  style={boxPercentStyle}
                >
                  {/* Chip de coordenadas sobre la caja */}
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-slate-900/95 text-white text-[9px] font-mono font-black rounded-full whitespace-nowrap shadow-md pointer-events-none flex items-center gap-1">
                    <Move size={9} className="text-blue-400" />
                    <span>
                      X:{sigConfig.posicionX} Y:{sigConfig.posicionY}
                    </span>
                  </div>

                  {/* Contenido visual de la firma */}
                  <div className="w-full h-full border border-dashed border-blue-500/60 rounded-lg flex flex-col items-center justify-center pointer-events-none bg-white/55 backdrop-blur-[1px]">
                    <span className="text-[8px] font-black uppercase text-blue-950 tracking-tighter text-center leading-none">
                      Firma Trabajador
                    </span>
                    <span className="text-[7px] text-blue-800 font-bold tracking-tight mt-0.5 flex items-center gap-0.5">
                      <Move size={7} /> Arrastrar
                    </span>
                  </div>
                </div>
              </div>
            </Document>
          </div>
        )}
      </div>
    </div>
  );
};

export default ContractPdfSignaturePositioner;

