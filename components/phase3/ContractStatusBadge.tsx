import React from 'react';
import { EstadoContratoVinculado } from '../../types/phase1';
import { Contrato } from '../../types/phase1';

interface Props {
  estado: EstadoContratoVinculado;
  contrato?: Contrato; // contrato vigente asociado (para mostrar detalle cuando es compatible)
}

const formatDateShort = (dateStr?: string): string => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  let year = parts[0];
  let monthStr = parts[1];
  let day = parts[2];
  if (parts[0].length === 2 && parts[2].length === 4) {
    day = parts[0];
    monthStr = parts[1];
    year = parts[2];
  }
  const monthName = months[parseInt(monthStr, 10) - 1] || monthStr;
  return `${day.padStart(2, '0')}/${monthName}/${year}`;
};

const getDaysUntil = (dateStr?: string): number | null => {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(dateStr);
  end.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

export const ContractStatusBadge: React.FC<Props> = ({ estado, contrato }) => {
  // ─── COMPATIBLE O CON CONTRATO ACTIVO EN EL MES ──────────────────────────
  if (estado === 'compatible' || contrato) {
    const fechaTermino = contrato?.fechaTermino;
    const daysLeft = getDaysUntil(fechaTermino);
    const isSoonToExpire = daysLeft !== null && daysLeft <= 30 && daysLeft >= 0;

    let subText = 'Indefinido';
    if (fechaTermino) {
      subText = `hasta ${formatDateShort(fechaTermino)}`;
    }

    let badgeClass = 'bg-green-50 text-green-700 border border-green-200';
    let alertText = '';
    
    if (estado === 'sin_contrato') {
      badgeClass = 'bg-red-50 text-red-900 border border-red-300';
      alertText = ' (Faltan turnos)';
    } else if (estado === 'otra_sucursal') {
      badgeClass = 'bg-orange-50 text-orange-900 border border-orange-300';
      alertText = ' (Conflicto sucursal)';
    } else if (estado === 'multiples') {
      badgeClass = 'bg-purple-50 text-purple-900 border border-purple-300';
      alertText = ' (Múltiples)';
    } else if (isSoonToExpire) {
      badgeClass = 'bg-amber-50 text-amber-700 border border-amber-200';
    }

    let label = 'Al día';
    if (contrato) {
      const validModalities = ['Plazo Fijo', 'Indefinido', 'Obra y Faena'];
      if (contrato.tipo && validModalities.some(m => contrato.tipo.toLowerCase().includes(m.toLowerCase()))) {
        label = contrato.tipo;
      } else {
        label = contrato.fechaTermino ? 'Plazo Fijo' : 'Indefinido';
      }
    }

    return (
      <span
        className={`inline-flex flex-col items-end px-2 py-0.5 rounded text-[10px] font-medium leading-tight ${badgeClass}`}
        title={`${label} — ${subText}${isSoonToExpire && daysLeft !== null ? ` · vence en ${daysLeft} días` : ''} ${alertText}`}
      >
        <span className="font-bold">{label}{alertText && <span className="text-[9px] text-red-600 ml-1">{alertText}</span>}</span>
        <span className="opacity-75">{subText}</span>
      </span>
    );
  }

  // ─── OTROS ESTADOS ─────────────────────────────────────────────────────────
  const config: Record<EstadoContratoVinculado, { color: string; text: string; bg: string }> = {
    compatible:        { color: 'text-green-700',  bg: 'bg-green-50 border border-green-200',   text: 'Al día' },
    otra_sucursal:     { color: 'text-orange-700', bg: 'bg-orange-50 border border-orange-200', text: 'Otra Sucursal' },
    sin_contrato:      { color: 'text-red-700',    bg: 'bg-red-50 border border-red-200',       text: 'Sin Contrato' },
    multiples:         { color: 'text-purple-700', bg: 'bg-purple-50 border border-purple-200', text: 'Múltiples' },
    pendiente_revision:{ color: 'text-yellow-700', bg: 'bg-yellow-50 border border-yellow-200', text: 'Revisión' },
    resuelto_manual:   { color: 'text-blue-700',   bg: 'bg-blue-50 border border-blue-200',     text: 'Manual' },
  };

  const { color, bg, text } = config[estado] || config.sin_contrato;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${bg} ${color}`}
      title={`Estado Contractual: ${text}`}
    >
      {text}
    </span>
  );
};
