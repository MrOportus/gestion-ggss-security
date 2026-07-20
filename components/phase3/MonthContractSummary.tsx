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
    <div className="bg-white p-3 rounded shadow-sm border border-gray-200 flex items-center justify-between mt-2 mb-4 text-sm">
      <div className="flex items-center gap-4">
        <div className="font-semibold text-gray-700">Resumen Contractual del Mes</div>
        <div className="flex gap-3">
          <span className="text-green-600 font-medium">{okCount} OK</span>
          {sinContrato > 0 && <span className="text-red-600 font-medium">{sinContrato} Sin Contrato</span>}
          {otraSucursal > 0 && <span className="text-orange-600 font-medium">{otraSucursal} Otra Sucursal</span>}
          {multiples > 0 && <span className="text-purple-600 font-medium">{multiples} Múltiples</span>}
        </div>
      </div>
      {issuesCount > 0 && (
        <div className="text-xs text-red-500">
          * Existen turnos con posibles problemas contractuales
        </div>
      )}
    </div>
  );
};
