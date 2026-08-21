/**
 * SignatureModal.tsx
 * Modal de firma digital full-screen optimizado para dispositivos móviles.
 * - Canvas grande con escalado devicePixelRatio correcto (nítido en Retina/HiDPI)
 * - Trazo estilo bolígrafo BIC azul: color #174A9C, grosor variable por velocidad
 * - touch-action: none para evitar scroll mientras se firma
 * - Alerta "¿Salir sin guardar?" si el usuario intenta cancelar con trazos
 * - Validación mínima (evita guardar canvas vacío o tap accidental)
 * - Compatible con el flujo actual: devuelve PNG base64 idéntico al actual
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { X, Trash2, Check, PenTool, AlertTriangle } from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface SignatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Se llama solo cuando el usuario pulsa "Guardar Firma" con una firma válida */
  onSave: (dataUrl: string) => Promise<void>;
  existingSignature?: string | null;
}

// ─── Constantes de estilo de tinta ────────────────────────────────────────────

const INK_COLOR = '#174A9C';       // Azul BIC oscuro y natural
const MIN_WIDTH = 0.8;             // Trazo fino en movimientos rápidos
const MAX_WIDTH = 2.3;             // Trazo ligeramente más grueso en movimientos lentos
const VELOCITY_WEIGHT = 0.7;       // Suavizado de velocidad (0=rígido, 1=suavísimo)
const DOT_SIZE = 1.0;              // Tamaño del punto al tocar sin mover

// ─── Helper: recorte manual del canvas (sin trim-canvas dep) ─────────────────
/**
 * Recorta el canvas al bounding box de los píxeles con opacidad > 0.
 * Devuelve un nuevo HTMLCanvasElement con solo la zona con tinta,
 * más un pequeño padding para que la firma no quede pegada al borde.
 */
function trimCanvas(sourceCanvas: HTMLCanvasElement, padding = 16): HTMLCanvasElement {
  const ctx = sourceCanvas.getContext('2d');
  if (!ctx) return sourceCanvas;

  const { width, height } = sourceCanvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  let top = height, bottom = 0, left = width, right = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 10) { // umbral para ignorar anti-aliasing marginal
        if (y < top)    top    = y;
        if (y > bottom) bottom = y;
        if (x < left)   left   = x;
        if (x > right)  right  = x;
      }
    }
  }

  // Si no hay tinta, devolver el canvas original
  if (top >= bottom || left >= right) return sourceCanvas;

  const cropX = Math.max(0, left - padding);
  const cropY = Math.max(0, top  - padding);
  const cropW = Math.min(width,  right  + padding) - cropX;
  const cropH = Math.min(height, bottom + padding) - cropY;

  const trimmed = document.createElement('canvas');
  trimmed.width  = cropW;
  trimmed.height = cropH;
  const tCtx = trimmed.getContext('2d')!;
  tCtx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return trimmed;
}

// ─── Componente ───────────────────────────────────────────────────────────────

const SignatureModal: React.FC<SignatureModalProps> = ({
  isOpen,
  onClose,
  onSave,
  existingSignature,
}) => {
  const sigCanvasRef = useRef<SignatureCanvas | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isEmpty, setIsEmpty] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showExitAlert, setShowExitAlert] = useState(false);

  // ─── Escalar canvas con devicePixelRatio ──────────────────────────────────

  const applyDPRScaling = useCallback(() => {
    if (!sigCanvasRef.current || !containerRef.current) return;

    const canvas = sigCanvasRef.current.getCanvas();
    if (!canvas) return;

    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const cssW = Math.floor(rect.width);
    const cssH = Math.floor(rect.height);

    // Solo re-escalar si las dimensiones han cambiado realmente
    if (canvas.width === cssW * ratio && canvas.height === cssH * ratio) return;

    canvas.width = cssW * ratio;
    canvas.height = cssH * ratio;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(ratio, ratio);
    }

    // Limpiar tras redimensionar (SignaturePad requiere esto)
    sigCanvasRef.current.clear();
    setIsEmpty(true);
  }, []);

  // ─── Inicializar y observar cambios de tamaño ─────────────────────────────

  useEffect(() => {
    if (!isOpen) return;

    // Pequeño delay para que el DOM esté completamente montado
    const timer = setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(applyDPRScaling);
      });
    }, 80);

    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(applyDPRScaling);
      });
      resizeObserver.observe(containerRef.current);
    }

    const handleResize = () => requestAnimationFrame(applyDPRScaling);
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [isOpen, applyDPRScaling]);

  // ─── Resetear estado al abrir/cerrar ──────────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      setIsEmpty(true);
      setIsSaving(false);
      setShowExitAlert(false);
      // El canvas se limpia vía applyDPRScaling al montar
    }
  }, [isOpen]);

  // ─── Prevenir scroll del body mientras el modal está abierto ──────────────

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    };
  }, [isOpen]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleBeginStroke = useCallback(() => {
    setIsEmpty(false);
  }, []);

  const handleClear = useCallback(() => {
    if (sigCanvasRef.current) {
      sigCanvasRef.current.clear();
      setIsEmpty(true);
    }
  }, []);

  const handleCancelRequest = useCallback(() => {
    if (!isEmpty) {
      // El usuario tiene trazos sin guardar → confirmar antes de cerrar
      setShowExitAlert(true);
    } else {
      onClose();
    }
  }, [isEmpty, onClose]);

  const handleConfirmExit = useCallback(() => {
    setShowExitAlert(false);
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (!sigCanvasRef.current) return;

    // Verificar que no esté vacío
    if (sigCanvasRef.current.isEmpty()) {
      return;
    }

    // Validación mínima: verificar que hay suficientes puntos para ser una firma real
    const points = sigCanvasRef.current.toData();
    const totalPoints = points.reduce((acc, stroke) => acc + stroke.length, 0);
    if (totalPoints < 3) {
      // Solo un tap accidental, no es firma válida
      return;
    }

    setIsSaving(true);
    try {
      // Recortar el canvas al bounding box de los trazos (sin espacio en blanco),
      // para que el preview en el perfil muestre la firma a tamaño legible.
      const rawCanvas = sigCanvasRef.current.getCanvas();
      const croppedCanvas = trimCanvas(rawCanvas);
      const dataUrl = croppedCanvas.toDataURL('image/png');
      await onSave(dataUrl);
    } finally {
      setIsSaving(false);
    }
  }, [onSave]);

  // ─── No renderizar si está cerrado ────────────────────────────────────────

  if (!isOpen) return null;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-white"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      {/* ── Barra superior ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-white shrink-0">
        <button
          onClick={handleCancelRequest}
          className="flex items-center gap-1.5 text-slate-500 font-bold text-sm active:opacity-60 transition-opacity py-2 pr-3"
          aria-label="Cancelar"
        >
          <X size={18} />
          Cancelar
        </button>

        <div className="flex items-center gap-2">
          <PenTool size={14} className="text-blue-600" />
          <span className="text-xs font-black text-slate-700 uppercase tracking-[0.18em]">
            Mi Firma
          </span>
        </div>

        <button
          onClick={handleClear}
          disabled={isEmpty}
          className="flex items-center gap-1.5 text-slate-400 font-bold text-sm active:opacity-60 disabled:opacity-30 transition-opacity py-2 pl-3"
          aria-label="Limpiar firma"
        >
          <Trash2 size={16} />
          Limpiar
        </button>
      </div>

      {/* ── Área principal: instrucción + canvas ───────────────────────────── */}
      <div className="flex-1 flex flex-col px-4 pt-4 pb-2 gap-3 min-h-0">
        {/* Instrucción */}
        <p className="text-[11px] font-semibold text-slate-400 text-center tracking-wide shrink-0">
          Firma dentro del recuadro usando tu dedo
        </p>

        {/* Canvas container — toma todo el espacio disponible */}
        <div
          ref={containerRef}
          className="flex-1 relative rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-inner min-h-0"
          style={{
            /* Altura mínima garantizada en teléfonos muy pequeños */
            minHeight: 'clamp(155px, 28vh, 295px)',
          }}
        >
          <SignatureCanvas
            ref={sigCanvasRef}
            onBegin={handleBeginStroke}
            penColor={INK_COLOR}
            minWidth={MIN_WIDTH}
            maxWidth={MAX_WIDTH}
            velocityFilterWeight={VELOCITY_WEIGHT}
            dotSize={DOT_SIZE}
            canvasProps={{
              className: 'absolute inset-0 w-full h-full',
              style: {
                touchAction: 'none',
                cursor: 'crosshair',
                display: 'block',
              },
            }}
          />

          {/* Guía visual cuando el canvas está vacío */}
          {isEmpty && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none"
              aria-hidden="true"
            >
              {/* Línea guía de firma */}
              <div className="w-3/4 border-b-2 border-dashed border-slate-200 mb-3" />
              <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest">
                Firma aquí
              </span>
            </div>
          )}
        </div>

        {/* Nota informativa */}
        <p className="text-[10px] text-slate-400 text-center shrink-0 leading-snug">
          Tu firma se utilizará para firmar digitalmente tus contratos y documentos.
        </p>
      </div>

      {/* ── Barra de botones inferior ──────────────────────────────────────── */}
      <div className="px-4 pb-4 pt-2 shrink-0 border-t border-slate-100">
        <button
          onClick={handleSave}
          disabled={isEmpty || isSaving}
          className="w-full py-4 rounded-2xl bg-blue-600 text-white font-black text-sm uppercase tracking-widest
                     shadow-lg shadow-blue-200 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none
                     transition-all duration-150 flex items-center justify-center gap-2"
          aria-label="Guardar firma"
        >
          {isSaving ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Guardando...
            </>
          ) : (
            <>
              <Check size={16} />
              Guardar Firma
            </>
          )}
        </button>
      </div>

      {/* ── Alert: ¿Salir sin guardar? ─────────────────────────────────────── */}
      {showExitAlert && (
        <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/40 backdrop-blur-sm">
          <div
            className="w-full max-w-sm mx-4 mb-6 bg-white rounded-3xl p-6 shadow-2xl"
            style={{ marginBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-amber-600" />
              </div>
              <div>
                <p className="font-black text-slate-800 text-base">¿Salir sin guardar?</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                  Tu firma no se guardará si cierras ahora.
                </p>
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowExitAlert(false)}
                className="flex-1 py-3 rounded-xl border-2 border-slate-200 font-black text-xs uppercase tracking-widest text-slate-600 active:bg-slate-50 transition-colors"
              >
                Continuar Firmando
              </button>
              <button
                onClick={handleConfirmExit}
                className="flex-1 py-3 rounded-xl bg-slate-700 font-black text-xs uppercase tracking-widest text-white active:bg-slate-800 transition-colors"
              >
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SignatureModal;
