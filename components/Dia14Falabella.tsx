import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  Upload, Loader2, Sparkles, FileText, CheckCircle, UserPlus, ChevronRight, ArrowLeft
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface Dia14FalabellaProps {
  onBack: () => void;
}

const Dia14Falabella: React.FC<Dia14FalabellaProps> = ({ onBack }) => {
  const { showNotification } = useAppStore();

  const [isProcessing, setIsProcessing] = useState(false);
  const [falabellaFiles, setFalabellaFiles] = useState<{ active?: File, platform?: File }>({});
  const [falabellaResults, setFalabellaResults] = useState<{
    matches: { rut: string, name: string, matchType: string }[],
    onlyActive: { rut: string, name: string }[],
    onlyPlatform: { rut: string, name: string }[],
    manualReview: { active: { rut: string, name: string }, platform: { rut: string, name: string }, reason: string }[]
  } | null>(null);

  const cleanRut = (rut: any) => {
    if (!rut) return '';
    return String(rut).toLowerCase().replace(/[^0-9k]/g, '');
  };

  const cleanName = (name: any) => {
    if (!name) return '';
    return String(name).toUpperCase()
      .normalize("NFD").replace(/[u0300-u036f]/g, "")
      .replace(/[^A-Z0-9s]/g, '')
      .trim().replace(/s+/g, ' ');
  };

  const handleFalabellaFileChange = (type: 'active' | 'platform', e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFalabellaFiles(prev => ({ ...prev, [type]: e.target.files![0] }));
    }
  };

  const processFalabellaComparison = async () => {
    if (!falabellaFiles.active || !falabellaFiles.platform) {
      showNotification("Por favor suba ambos archivos Excel.", "warning");
      return;
    }

    setIsProcessing(true);
    try {
      const readExcel = (file: File): Promise<any[]> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              const data = e.target?.result;
              const workbook = XLSX.read(data, { type: 'binary' });
              const sheetName = workbook.SheetNames[0];
              const sheet = workbook.Sheets[sheetName];
              const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
              resolve(json as any[]);
            } catch (err) {
              reject(err);
            }
          };
          reader.onerror = reject;
          reader.readAsBinaryString(file);
        });
      };

      const [activeData, platformData] = await Promise.all([
        readExcel(falabellaFiles.active!),
        readExcel(falabellaFiles.platform!)
      ]);

      const formatDisplayRut = (body: string, dv: string) => {
        const b = body.trim();
        const d = dv.trim();
        if (!d) return b;
        if (b.includes('-')) return b;
        return `${b}-${d}`;
      };

      const rawActive = activeData.slice(1).map(row => {
        if (!row[0]) return null;
        const pBody = String(row[0]).trim();
        const pDv = String(row[1] || '').trim();
        const pName = String(row[2] || '').trim();
        if (pBody.toLowerCase().includes('rut')) return null;

        const displayRut = formatDisplayRut(pBody, pDv);
        return {
          rut: displayRut,
          cleanRut: cleanRut(displayRut),
          name: pName,
          cleanName: cleanName(pName),
          raw: row
        };
      }).filter((item): item is any => item !== null && item.cleanRut.length > 4);

      const rawPlatform = platformData.slice(1).map((row, idx) => {
        if (!row[0]) return null;
        const pRut = String(row[0]).trim();
        const pName = String(row[1] || '').trim();
        if (pRut.toLowerCase().includes('rut')) return null;

        return {
          id: `plat-${idx}`,
          rut: pRut,
          cleanRut: cleanRut(pRut),
          name: pName,
          cleanName: cleanName(pName),
          raw: row
        };
      }).filter((item): item is any => item !== null && item.cleanRut.length > 4);

      const activeList: any[] = [];
      const activeSeen = new Set();
      rawActive.forEach(item => {
        if (!activeSeen.has(item.cleanRut)) {
          activeList.push(item);
          activeSeen.add(item.cleanRut);
        }
      });

      const platformList: any[] = [];
      const platformSeen = new Set();
      rawPlatform.forEach(item => {
        if (!platformSeen.has(item.cleanRut)) {
          platformList.push(item);
          platformSeen.add(item.cleanRut);
        }
      });

      const matches: any[] = [];
      const pendingActive: any[] = [];
      const matchedPlatformIds = new Set<string>();
      const matchedActiveRuts = new Set<string>();

      activeList.forEach(activeItem => {
        const matchIndex = platformList.findIndex(p => !matchedPlatformIds.has(p.id) && p.cleanRut === activeItem.cleanRut);
        if (matchIndex !== -1) {
          const match = platformList[matchIndex];
          matches.push({ rut: activeItem.rut, name: activeItem.name, matchType: 'RUT' });
          matchedPlatformIds.add(match.id);
          matchedActiveRuts.add(activeItem.cleanRut);
        }
      });

      activeList.forEach(activeItem => {
        if (matchedActiveRuts.has(activeItem.cleanRut)) return;
        const matchIndex = platformList.findIndex(p => !matchedPlatformIds.has(p.id) && p.cleanName === activeItem.cleanName);
        if (matchIndex !== -1) {
          const match = platformList[matchIndex];
          matches.push({ rut: activeItem.rut, name: activeItem.name, matchType: 'NOMBRE' });
          matchedPlatformIds.add(match.id);
          matchedActiveRuts.add(activeItem.cleanRut);
        } else {
          pendingActive.push(activeItem);
        }
      });

      const manualReview: any[] = [];
      const onlyActive: any[] = [];
      const getRutBase = (r: string) => r.replace(/[^0-9]/g, '');
      const getWords = (n: string) => n.split(' ').filter(w => w.length > 2);

      pendingActive.forEach(a => {
        const aBase = getRutBase(a.cleanRut);
        const aWords = getWords(a.cleanName);

        const simIndex = platformList.findIndex(p => {
          if (matchedPlatformIds.has(p.id)) return false;

          const pBase = getRutBase(p.cleanRut);
          const pWords = getWords(p.cleanName);

          if (aBase === pBase && aBase.length > 5) return true;
          const commonWords = aWords.filter(w => pWords.includes(w));
          if (commonWords.length >= 2) return true;

          return false;
        });

        if (simIndex !== -1) {
          const p = platformList[simIndex];
          manualReview.push({
            active: { rut: a.rut, name: a.name },
            platform: { rut: p.rut, name: p.name },
            reason: getRutBase(a.cleanRut) === getRutBase(p.cleanRut) ? 'RUT Similar' : 'Nombre Similar'
          });
          matchedPlatformIds.add(p.id);
        } else {
          onlyActive.push({ rut: a.rut, name: a.name });
        }
      });

      const onlyPlatform = platformList
        .filter(p => !matchedPlatformIds.has(p.id))
        .map(p => ({ rut: p.rut, name: p.name }));

      setFalabellaResults({ matches, onlyActive, onlyPlatform, manualReview });
      showNotification("Cruce completado. Revise 'Revisión Manual' para posibles aciertos.", "success");
    } catch (error) {
      console.error("Error processing Falabella comparison:", error);
      showNotification("Error al procesar los archivos. Verifique formato.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const exportFalabellaToExcel = () => {
    if (!falabellaResults) return;

    const wb = XLSX.utils.book_new();

    const matchesWS = XLSX.utils.json_to_sheet(falabellaResults.matches.map(m => ({
      'RUT': m.rut,
      'Nombre': m.name,
      'Tipo Match': m.matchType
    })));
    XLSX.utils.book_append_sheet(wb, matchesWS, "COINCIDENCIAS");

    const onlyActiveWS = XLSX.utils.json_to_sheet(falabellaResults.onlyActive.map(m => ({
      'RUT': m.rut,
      'Nombre': m.name
    })));
    XLSX.utils.book_append_sheet(wb, onlyActiveWS, "SOLO EN ACTIVOS PLATAFORMA");

    const onlyPlatformWS = XLSX.utils.json_to_sheet(falabellaResults.onlyPlatform.map(m => ({
      'RUT': m.rut,
      'Nombre': m.name
    })));
    XLSX.utils.book_append_sheet(wb, onlyPlatformWS, "SOLO EN PLANILLA COBROS");

    if (falabellaResults.manualReview.length > 0) {
      const manualWS = XLSX.utils.json_to_sheet(falabellaResults.manualReview.map(m => ({
        'Nombre Activos': m.active.name,
        'RUT Activos': m.active.rut,
        'Nombre Planilla': m.platform.name,
        'RUT Planilla': m.platform.rut,
        'Motivo Duda': m.reason
      })));
      XLSX.utils.book_append_sheet(wb, manualWS, "REVISION MANUAL");
    }

    XLSX.writeFile(wb, `Dia14_Falabella_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  return (
    <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6">
      <div className="flex items-center gap-4 border-b border-slate-200 pb-4">
        <button
          onClick={onBack}
          className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-xl font-bold text-slate-800">Dia 14 Falabella</h2>
      </div>

      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-black text-slate-700 uppercase tracking-widest">1. Lista de Activos en plataforma</label>
              <span className="text-[10px] text-slate-400 font-bold">A, B (RUT) + C (Nombre)</span>
            </div>
            <div
              className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all group ${falabellaFiles.active ? 'border-emerald-400 bg-emerald-50/50' : 'border-slate-200 hover:border-blue-400 hover:bg-slate-50'}`}
            >
              <input
                type="file"
                accept=".xlsx, .xls"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                onChange={(e) => handleFalabellaFileChange('active', e)}
              />
              <div className="flex flex-col items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${falabellaFiles.active ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400 group-hover:bg-blue-100 group-hover:text-blue-500'}`}>
                  <Upload size={24} />
                </div>
                {falabellaFiles.active ? (
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-emerald-700 line-clamp-1">{falabellaFiles.active.name}</p>
                    <p className="text-[10px] text-emerald-500 font-medium">Archivo listo para procesar</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-600">Suelte la lista de activos en plataforma</p>
                    <p className="text-xs text-slate-400">Formato .xlsx o .xls</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-black text-slate-700 uppercase tracking-widest">2. nombres Planilla cobros</label>
              <span className="text-[10px] text-slate-400 font-bold">A (RUT) + B (Nombre)</span>
            </div>
            <div
              className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all group ${falabellaFiles.platform ? 'border-emerald-400 bg-emerald-50/50' : 'border-slate-200 hover:border-blue-400 hover:bg-slate-50'}`}
            >
              <input
                type="file"
                accept=".xlsx, .xls"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                onChange={(e) => handleFalabellaFileChange('platform', e)}
              />
              <div className="flex flex-col items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${falabellaFiles.platform ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400 group-hover:bg-blue-100 group-hover:text-blue-500'}`}>
                  <Upload size={24} />
                </div>
                {falabellaFiles.platform ? (
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-emerald-700 line-clamp-1">{falabellaFiles.platform.name}</p>
                    <p className="text-[10px] text-emerald-500 font-medium">Archivo listo para procesar</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-600">Suelte nombres Planilla cobros</p>
                    <p className="text-xs text-slate-400">Formato .xlsx o .xls</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-4 pt-4">
          <button
            onClick={processFalabellaComparison}
            disabled={isProcessing || !falabellaFiles.active || !falabellaFiles.platform}
            className="flex items-center gap-4 px-16 py-4 bg-slate-900 hover:bg-black text-white rounded-2xl font-black uppercase tracking-widest text-sm transition-all shadow-xl disabled:opacity-30 disabled:cursor-not-allowed group"
          >
            {isProcessing ? <Loader2 className="animate-spin" /> : <Sparkles className="group-hover:rotate-12 transition-transform" size={20} />}
            {isProcessing ? 'Procesando Datos...' : 'Iniciar Cruce Inteligente'}
          </button>

          {falabellaResults && (
            <button
              onClick={exportFalabellaToExcel}
              className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-widest hover:text-emerald-700 transition-colors"
            >
              <FileText size={16} /> Exportar Resultado a Excel
            </button>
          )}
        </div>
      </div>

      {falabellaResults && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[600px] animate-in fade-in slide-in-from-bottom-2">
            <div className="bg-emerald-500 p-4 border-b border-emerald-600">
              <div className="flex justify-between items-center text-white">
                <h3 className="font-black uppercase tracking-widest text-xs flex items-center gap-2">
                  <CheckCircle size={16} /> Coincidencias ({falabellaResults.matches.length})
                </h3>
              </div>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0 z-20">
                  <tr>
                    <th className="p-3 text-left text-slate-500 font-bold uppercase tracking-wider">Colaborador</th>
                    <th className="p-3 text-right text-slate-500 font-bold uppercase tracking-wider">Tipo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {falabellaResults.matches.map((m, i) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3">
                        <div className="font-bold text-slate-800">{m.name}</div>
                        <div className="font-mono text-[10px] text-slate-400">{m.rut}</div>
                      </td>
                      <td className="p-3 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter ${m.matchType === 'RUT' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                          {m.matchType}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[600px] animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-rose-500 p-4 border-b border-rose-600">
              <h3 className="text-white font-black uppercase tracking-widest text-xs flex items-center gap-2">
                <UserPlus size={16} /> Solo en Activos ({falabellaResults.onlyActive.length})
              </h3>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0 z-20">
                  <tr>
                    <th className="p-3 text-left text-slate-500 font-bold uppercase tracking-wider">Desactivar de plataforma</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {falabellaResults.onlyActive.map((m, i) => (
                    <tr key={i} className="hover:bg-rose-50/30 transition-colors">
                      <td className="p-3">
                        <div className="font-bold text-slate-800">{m.name}</div>
                        <div className="font-mono text-[10px] text-slate-400">{m.rut}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[600px] animate-in fade-in slide-in-from-bottom-6">
            <div className="bg-blue-500 p-4 border-b border-blue-600">
              <h3 className="font-black uppercase tracking-widest text-xs flex items-center gap-2">
                <FileText size={16} /> Solo en Planilla ({falabellaResults.onlyPlatform.length})
              </h3>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0 z-20">
                  <tr>
                    <th className="p-3 text-left text-slate-500 font-bold uppercase tracking-wider">Activar o Agregar en Plataforma</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {falabellaResults.onlyPlatform.map((m, i) => (
                    <tr key={i} className="hover:bg-blue-50/30 transition-colors">
                      <td className="p-3">
                        <div className="font-bold text-slate-800">{m.name}</div>
                        <div className="font-mono text-[10px] text-slate-400">{m.rut}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {falabellaResults && falabellaResults.manualReview.length > 0 && (
        <div className="animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl overflow-hidden shadow-xl">
            <div className="bg-amber-500 p-4 flex justify-between items-center text-white">
              <h3 className="font-black uppercase tracking-widest text-xs flex items-center gap-2">
                <Sparkles size={16} /> Revisión Manual ({falabellaResults.manualReview.length})
              </h3>
              <span className="text-[10px] font-bold bg-amber-600 px-2 py-1 rounded-lg">POSIBLES COINCIDENCIAS</span>
            </div>
            <div className="p-1">
              <table className="w-full text-xs">
                <thead className="bg-amber-100/50 text-amber-900 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="p-3 text-left">Datos en Activos</th>
                    <th className="p-3 text-center">→</th>
                    <th className="p-3 text-left">Datos en Planilla</th>
                    <th className="p-3 text-right">Razón</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-100">
                  {falabellaResults.manualReview.map((item, i) => (
                    <tr key={i} className="hover:bg-white/50 transition-colors">
                      <td className="p-3">
                        <div className="font-bold text-slate-800">{item.active.name}</div>
                        <div className="font-mono text-[10px] text-slate-500">{item.active.rut}</div>
                      </td>
                      <td className="p-3 text-center text-amber-400 font-black">
                        <ChevronRight size={14} />
                      </td>
                      <td className="p-3 text-left">
                        <div className="font-bold text-slate-800">{item.platform.name}</div>
                        <div className="font-mono text-[10px] text-slate-500">{item.platform.rut}</div>
                      </td>
                      <td className="p-3 text-right">
                        <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-md font-black text-[9px] uppercase">
                          {item.reason}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dia14Falabella;
