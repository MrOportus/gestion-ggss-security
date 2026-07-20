import React, { useState } from 'react';
import { shadowComparator, ComparisonResult } from '../lib/phase2/shadowComparator';
import { RefreshCcw, AlertTriangle, CheckCircle, Info } from 'lucide-react';

interface Props {
  siteId: string | number;
  monthKey: string; // YYYY-MM
}

const ShadowDiagnosticPanel: React.FC<Props> = ({ siteId, monthKey }) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleValidate = async () => {
    if (!siteId) return;
    
    // Doble check de seguridad en frontend
    const userRole = localStorage.getItem('userRole') || 'operador';
    if (userRole !== 'admin') {
      setError('PERMISO DENEGADO: Solo administradores pueden ejecutar diagnósticos shadow.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await shadowComparator.compareMonth(siteId, monthKey);
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-50 bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-mono shadow-lg hover:bg-slate-800 transition flex items-center gap-2"
      >
        <Info size={14} /> DIAGNÓSTICO SHADOW
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[400px] bg-slate-900 rounded-xl shadow-2xl border border-slate-700 text-slate-300 font-mono text-xs overflow-hidden flex flex-col max-h-[80vh]">
      <div className="bg-slate-800 p-3 flex items-center justify-between border-b border-slate-700">
        <h3 className="text-white font-bold flex items-center gap-2">
          <AlertTriangle size={16} className="text-yellow-500" />
          Shadow Mode: {monthKey}
        </h3>
        <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white">✕</button>
      </div>
      
      <div className="p-4 flex-1 overflow-auto custom-scrollbar">
        <div className="mb-4">
          <p className="text-slate-400">Sucursal ID: <span className="text-white">{siteId}</span></p>
          <button 
            onClick={handleValidate} 
            disabled={loading || !siteId}
            className="mt-2 w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg transition disabled:opacity-50"
          >
            {loading ? <RefreshCcw size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
            {loading ? 'Validando...' : 'Ejecutar Comparador'}
          </button>
        </div>

        {error && (
          <div className="bg-red-900/50 text-red-200 p-3 rounded border border-red-800 mb-4">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-800 p-2 rounded">
                <div className="text-slate-500">Legacy Rows</div>
                <div className="text-xl text-white">{result.legacyCount}</div>
              </div>
              <div className="bg-slate-800 p-2 rounded">
                <div className="text-slate-500">Shadow Rows</div>
                <div className="text-xl text-white">{result.shadowCount}</div>
              </div>
              <div className="bg-slate-800 p-2 rounded">
                <div className="text-slate-500">Coincidencias</div>
                <div className="text-xl text-green-400">{result.matchCount}</div>
              </div>
              <div className="bg-slate-800 p-2 rounded">
                <div className="text-slate-500">Compatibilidad</div>
                <div className="text-xl text-white">{result.compatibilityPercent}%</div>
              </div>
            </div>

            {result.differences.length > 0 && (
              <div>
                <h4 className="text-yellow-500 mb-2 font-bold uppercase">Diferencias ({result.errors})</h4>
                <div className="space-y-2">
                  {result.differences.map((diff, i) => (
                    <div key={i} className="bg-slate-800 p-2 rounded text-[10px]">
                      <div className="text-white font-bold">{diff.fecha} - Emp: {diff.colaboradorId}</div>
                      <div className="flex gap-4 mt-1">
                        <span className="text-red-400">Legacy: {diff.legacyCode}</span>
                        <span className="text-emerald-400">Shadow: {diff.shadowCode}</span>
                      </div>
                      <div className="text-slate-500 mt-1">{diff.motivo}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result.differences.length === 0 && result.legacyCount > 0 && (
              <div className="flex items-center gap-2 text-green-400 bg-green-900/20 p-3 rounded border border-green-800/50">
                <CheckCircle size={16} /> ¡Perfecta coincidencia!
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ShadowDiagnosticPanel;
