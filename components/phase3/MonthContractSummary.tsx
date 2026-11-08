import React from 'react';

interface SummaryProps {
  totalTurnos: number;
  sinContrato: number;
  otraSucursal: number;
  multiples: number;
}

export const MonthContractSummary: React.FC<SummaryProps> = ({
  totalTurnos, sinContrato, otraSucursal, multiples
}) => {
  const issuesCount = sinContrato + otraSucursal + multiples;
  const okCount = totalTurnos - issuesCount;
  
  if (totalTurnos === 0) return null;

  return (
    <div className="bg-white p-2.5 sm:p-3 rounded-lg shadow-sm border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4 text-xs sm:text-sm shrink-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="font-semibold text-gray-700">Resumen Contractual del Mes</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-green-600 font-semibold whitespace-nowrap">{okCount} OK</span>
          {sinContrato > 0 && <span className="text-red-600 font-semibold whitespace-nowrap">{sinContrato} Sin Contrato</span>}
          {otraSucursal > 0 && <span className="text-orange-600 font-semibold whitespace-nowrap">{otraSucursal} Otra Sucursal</span>}
          {multiples > 0 && <span className="text-purple-600 font-semibold whitespace-nowrap">{multiples} Múltiples</span>}
        </div>
      </div>
      {issuesCount > 0 && (
        <div className="text-[11px] sm:text-xs text-red-500 leading-snug">
          * Existen turnos con posibles problemas contractuales
        </div>
      )}
    </div>
  );
};
