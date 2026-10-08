import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Check, X } from 'lucide-react';
import { ResultadoVisita, EstadoCargo, PrioridadNovedad } from '../../lib/visitasSupervisor/visitasTypes';
import { RESULTADO_LABEL, RESULTADO_EMOJI, ESTADO_CARGO_LABEL, ESTADO_CARGO_EMOJI } from '../../lib/visitasSupervisor/visitasLogic';

/**
 * Piezas visuales compartidas (supervisor + admin).
 * Regla de accesibilidad: el estado NUNCA se comunica solo con color: siempre icono + texto.
 */

// ─── Insignia de resultado ───────────────────────────────────────────────────
const RESULTADO_STYLE: Record<ResultadoVisita, string> = {
  sin_novedades: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  con_observaciones: 'bg-amber-100 text-amber-900 border-amber-300',
  con_novedad: 'bg-red-100 text-red-900 border-red-300',
};

export const ResultadoBadge: React.FC<{ resultado: ResultadoVisita; prioridadNovedad?: PrioridadNovedad; large?: boolean }> = ({ resultado, prioridadNovedad, large }) => {
  let style = RESULTADO_STYLE[resultado];
  let label = RESULTADO_LABEL[resultado];
  let emoji = RESULTADO_EMOJI[resultado];

  if (resultado === 'con_novedad' && prioridadNovedad) {
    if (prioridadNovedad === 'informativa') {
      label = 'Novedad Informativa';
      style = 'bg-blue-100 text-blue-900 border-blue-300';
      emoji = '🔵';
    } else if (prioridadNovedad === 'requiere_atencion') {
      label = 'Novedad Requiere atención';
      style = 'bg-yellow-100 text-yellow-900 border-yellow-400';
      emoji = '🟡';
    } else if (prioridadNovedad === 'urgente') {
      label = 'Novedad Urgente';
      style = 'bg-red-100 text-red-900 border-red-300';
      emoji = '🔴';
    }
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 border-2 rounded-full font-black ${style} ${
        large ? 'px-4 py-2 text-base' : 'px-3 py-1 text-xs'
      }`}
    >
      <span aria-hidden>{emoji}</span>
      {label}
    </span>
  );
};

// ─── Insignia de cargo ───────────────────────────────────────────────────────
const CARGO_STYLE: Record<EstadoCargo, string> = {
  ok: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  observacion: 'bg-amber-100 text-amber-900 border-amber-300',
  faltante: 'bg-red-100 text-red-900 border-red-300',
};

export const CargoBadge: React.FC<{ estado: EstadoCargo | null }> = ({ estado }) =>
  estado ? (
    <span className={`inline-flex items-center gap-1.5 border-2 rounded-full px-3 py-1 text-sm font-black ${CARGO_STYLE[estado]}`}>
      <span aria-hidden>{ESTADO_CARGO_EMOJI[estado]}</span>
      {ESTADO_CARGO_LABEL[estado]}
    </span>
  ) : (
    <span className="inline-flex items-center border-2 border-slate-300 bg-slate-100 text-slate-700 rounded-full px-3 py-1 text-sm font-black">
      SIN MARCAR
    </span>
  );

// ─── Botones SÍ / NO grandes ─────────────────────────────────────────────────
interface SiNoProps {
  value: boolean | null;
  onChange: (v: boolean) => void;
  labelSi?: string;
  labelNo?: string;
  idPrefix: string;
}

export const SiNoButtons: React.FC<SiNoProps> = ({ value, onChange, labelSi = 'SÍ', labelNo = 'NO', idPrefix }) => (
  <div className="grid grid-cols-2 gap-3" role="radiogroup">
    <button
      type="button"
      id={`${idPrefix}-si`}
      role="radio"
      aria-checked={value === true}
      onClick={() => onChange(true)}
      className={`min-h-[68px] rounded-2xl border-4 px-3 flex items-center justify-center gap-2 text-lg font-black leading-tight active:scale-95 transition-all ${
        value === true
          ? 'bg-emerald-600 border-emerald-800 text-white shadow-lg'
          : 'bg-white border-slate-300 text-slate-700'
      }`}
    >
      <Check size={28} strokeWidth={4} aria-hidden />
      <span>{labelSi}</span>
    </button>
    <button
      type="button"
      id={`${idPrefix}-no`}
      role="radio"
      aria-checked={value === false}
      onClick={() => onChange(false)}
      className={`min-h-[68px] rounded-2xl border-4 px-3 flex items-center justify-center gap-2 text-lg font-black leading-tight active:scale-95 transition-all ${
        value === false
          ? 'bg-slate-700 border-slate-900 text-white shadow-lg'
          : 'bg-white border-slate-300 text-slate-700'
      }`}
    >
      <X size={28} strokeWidth={4} aria-hidden />
      <span>{labelNo}</span>
    </button>
  </div>
);

// ─── Iconos de estado reutilizables ──────────────────────────────────────────
export const IconoCargo: React.FC<{ estado: EstadoCargo; size?: number }> = ({ estado, size = 22 }) =>
  estado === 'ok' ? (
    <CheckCircle2 size={size} className="text-emerald-600" aria-hidden />
  ) : estado === 'observacion' ? (
    <AlertTriangle size={size} className="text-amber-600" aria-hidden />
  ) : (
    <XCircle size={size} className="text-red-600" aria-hidden />
  );

/** Formatea fecha/hora ISO a hora de Chile para mostrar */
export function formatearFecha(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Santiago' });
}
export function formatearHora(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Santiago' });
}
