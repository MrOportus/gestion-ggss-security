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
  // ─── COMPATIBLE ────────────────────────────────────────────────────────────
  if (estado === 'compatible') {
    const fechaTermino = contrato?.fechaTermino;
    const daysLeft = getDaysUntil(fechaTermino);
    const isSoonToExpire = daysLeft !== null && daysLeft <= 30 && daysLeft >= 0;

    let subText = 'Indefinido';
    if (fechaTermino) {
      subText = `hasta ${formatDateShort(fechaTermino)}`;
    }

    // Color según urgencia
    const badgeClass = isSoonToExpire
      ? 'bg-amber-50 text-amber-700 border border-amber-200'
      : 'bg-green-50 text-green-700 border border-green-200';

    const label = contrato?.tipo ? contrato.tipo : 'Contrato';

    return (
      <span
        className={`inline-flex flex-col items-end px-2 py-0.5 rounded text-[10px] font-medium leading-tight ${badgeClass}`}
        title={`${label} — ${subText}${isSoonToExpire && daysLeft !== null ? ` · vence en ${daysLeft} días` : ''}`}
      >
        <span className="font-bold">Al día</span>
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
