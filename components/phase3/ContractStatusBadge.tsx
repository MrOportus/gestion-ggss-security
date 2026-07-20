import React from 'react';
import { EstadoContratoVinculado } from '../../types/phase1';

interface Props {
  estado: EstadoContratoVinculado;
}

export const ContractStatusBadge: React.FC<Props> = ({ estado }) => {
  if (estado === 'compatible') return null; // No mostramos nada si está OK, o se podría mostrar un check verde sutil

  const config: Record<EstadoContratoVinculado, { color: string; text: string; bg: string }> = {
    compatible: { color: 'text-green-700', bg: 'bg-green-100', text: 'OK' },
    otra_sucursal: { color: 'text-orange-700', bg: 'bg-orange-100', text: 'Otra Sucursal' },
    sin_contrato: { color: 'text-red-700', bg: 'bg-red-100', text: 'Sin Contrato' },
    multiples: { color: 'text-purple-700', bg: 'bg-purple-100', text: 'Múltiples' },
    pendiente_revision: { color: 'text-yellow-700', bg: 'bg-yellow-100', text: 'Revisión' },
    resuelto_manual: { color: 'text-blue-700', bg: 'bg-blue-100', text: 'Manual' },
  };

  const { color, bg, text } = config[estado] || config.sin_contrato;

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${bg} ${color}`} title={`Estado Contractual: ${text}`}>
      {text}
    </span>
  );
};
