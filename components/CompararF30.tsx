import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  ClipboardList, Copy, CheckCircle, FileText,
  Clock, FileSearch, Upload, Loader2, Table as TableIcon,
  History, Calendar, Users as UsersIcon, ChevronRight, X, Download, ArrowLeft
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import * as XLSX from 'xlsx';
import { ComparisonRecord } from '../types';

interface CompararF30Props {
  onBack: () => void;
}

const CompararF30: React.FC<CompararF30Props> = ({ onBack }) => {
  const { f30History, saveF30Comparison, showNotification } = useAppStore();
  const [isProcessing, setIsProcessing] = useState(false);
  const [f30FileBase64, setF30FileBase64] = useState<string | null>(null);
  const [f30FileName, setF30FileName] = useState<string>('');
  const [rawPlanillaText, setRawPlanillaText] = useState('');
  const [finalComparison, setFinalComparison] = useState<{ rut: string, name: string, inF30: boolean }[]>([]);
  const [periodo, setPeriodo] = useState('');
  const [viewingRecord, setViewingRecord] = useState<ComparisonRecord | null>(null);
  const [copied, setCopied] = useState(false);

  const handleF30Upload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setF30FileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      setF30FileBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const normalizeRut = (rut: string) => rut.replace(/\./g, '').toLowerCase().trim();

  const processF30Comparison = async () => {
    if (!f30FileBase64 || !rawPlanillaText) {
      showNotification("Por favor suba el archivo F30 y pegue el listado de la planilla.", "warning");
      return;
    }

    setIsProcessing(true);
    try {
      const apiKey = (import.meta as any).env?.VITE_API_KEY;

      if (!apiKey) {
        showNotification("Falta la API KEY de Gemini.", "error");
        setIsProcessing(false);
        return;
      }

      const ai = new GoogleGenAI({ apiKey: apiKey });

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            inlineData: {
              data: f30FileBase64,
              mimeType: 'application/pdf'
            }
          },
          {
            text: "Extrae de este documento F30-1 todos los RUTs y Nombres de los trabajadores listados. Devuelve únicamente un array JSON con objetos {rut: string, name: string}. Ignora encabezados o datos de la empresa, solo la lista de empleados."
          }
        ],
        config: { responseMimeType: 'application/json' }
      });

      const f30Workers = JSON.parse(response.text || "[]") as { rut: string, name: string }[];

      const lines = rawPlanillaText.split('\n').filter(l => l.trim() !== '');
      const uniquePlanilla: { rut: string, name: string }[] = [];
      const seenRuts = new Set();

      lines.forEach(line => {
        const parts = line.split('\t').length > 1 ? line.split('\t') : line.split(/ {2,}/);
        if (parts.length >= 2) {
          const rawRut = parts[0].trim();
          const name = parts[1].trim();
          const normRut = normalizeRut(rawRut);

          if (!seenRuts.has(normRut)) {
            uniquePlanilla.push({ rut: rawRut, name: name });
            seenRuts.add(normRut);
          }
        }
      });

      const comparison = uniquePlanilla.map(p => {
        const normPRut = normalizeRut(p.rut);
        const found = f30Workers.some(f => normalizeRut(f.rut) === normPRut || normalizeRut(f.name).toLowerCase().includes(normalizeRut(p.name).split(' ')[0]));
        return {
          rut: p.rut,
          name: p.name,
          inF30: found
        };
      });

      setFinalComparison(comparison);

      saveF30Comparison({
        periodo: periodo || 'Sin Periodo',
        data: comparison
      });

    } catch (error) {
      console.error("Error procesando comparación:", error);
      showNotification("Error al procesar el documento.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const copyAsExcelTable = async (dataToCopy: ComparisonRecord['data'], customPeriodo?: string) => {
    const title = `REMITE ANT. COLABORADORES PERIODO ${(customPeriodo || periodo).toUpperCase() || '__________'}`;

    const tableHtml = `
      <table border="1" style="border-collapse: collapse; font-family: sans-serif; width: 100%;">
        <thead>
          <tr>
            <th colspan="4" style="background-color: #1e293b; color: white; padding: 10px; text-align: left;">${title}</th>
          </tr>
          <tr style="background-color: #f1f5f9;">
            <th style="padding: 8px; border: 1px solid #cbd5e1;">RUT</th>
            <th style="padding: 8px; border: 1px solid #cbd5e1;">NOMBRE</th>
            <th style="padding: 8px; border: 1px solid #cbd5e1;">CONTRATO</th>
            <th style="padding: 8px; border: 1px solid #cbd5e1;">F-30 1</th>
          </tr>
        </thead>
        <tbody>
          ${dataToCopy.map(item => `
            <tr>
              <td style="padding: 8px; border: 1px solid #cbd5e1;">${item.rut}</td>
              <td style="padding: 8px; border: 1px solid #cbd5e1;">${item.name}</td>
              <td style="padding: 8px; border: 1px solid #cbd5e1;"></td>
              <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; color: ${item.inF30 ? '#059669' : '#dc2626'}">${item.inF30 ? 'SÍ' : 'NO'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    const plainText = `${title}\n\nRUT\tNOMBRE\tCONTRATO\tF-30 1\n` +
      dataToCopy.map(i => `${i.rut}\t${i.name}\t\t${i.inF30 ? 'SÍ' : 'NO'}`).join('\n');

    try {
      const blobHtml = new Blob([tableHtml], { type: 'text/html' });
      const blobText = new Blob([plainText], { type: 'text/plain' });

      const data = [new ClipboardItem({
        'text/html': blobHtml,
        'text/plain': blobText
      })];

      await navigator.clipboard.write(data);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Error copying to clipboard:", err);
      navigator.clipboard.writeText(plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const exportF30ComparisonToExcel = (data: any[], periodoTitle: string) => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data.map(item => ({
      'RUT': item.rut,
      'Nombre': item.name,
      'En F30': item.inF30 ? 'SÍ' : 'NO'
    })));
    XLSX.utils.book_append_sheet(wb, ws, "Resultado Cruce");
    XLSX.writeFile(wb, `Cruce_F30_${periodoTitle || 'SinPeríodo'}.xlsx`);
  };

  return (
    <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-12">
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
            >
              <ArrowLeft size={20} />
            </button>
            <h2 className="text-xl font-bold text-slate-800">Cruce F30-1 vs Planilla</h2>
          </div>
          {finalComparison.length > 0 && (
            <button onClick={() => { setFinalComparison([]); setF30FileBase64(null); setF30FileName(''); setRawPlanillaText(''); }} className="text-xs font-bold text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-100 transition">Reiniciar Comparación</button>
          )}
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">1</div>
            <p className="text-xs text-blue-800 font-medium leading-relaxed">Subir Archivo <span className="font-bold">F30-1 (PDF)</span> para analizar los trabajadores registrados.</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">2</div>
            <p className="text-xs text-blue-800 font-medium leading-relaxed">Pegar <span className="font-bold">Listado de Planilla</span> (RUT y Nombre) desde Excel en el recuadro.</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">3</div>
            <p className="text-xs text-blue-800 font-medium leading-relaxed">Generar <span className="font-bold">Entregable</span> para copiar como tabla a Excel.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Upload size={14} /> 1. Carga del F30-1
              </h3>
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors group">
                {f30FileName ? (
                  <div className="flex flex-col items-center">
                    <FileText className="text-emerald-500 mb-2" size={32} />
                    <span className="text-xs font-bold text-slate-700">{f30FileName}</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <Upload className="text-slate-300 group-hover:text-blue-500 transition-colors mb-2" size={32} />
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Haz clic para subir PDF</span>
                  </div>
                )}
                <input type="file" className="hidden" accept=".pdf" onChange={handleF30Upload} />
              </label>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <TableIcon size={14} /> 2. Pegar Planilla (Excel)
              </h3>
              <textarea
                placeholder="Pegue aquí el listado de RUT y Nombres desde Excel..."
                className="w-full h-48 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs font-mono focus:ring-2 focus:ring-blue-50 outline-none transition"
                value={rawPlanillaText}
                onChange={(e) => setRawPlanillaText(e.target.value)}
              />
            </div>

            <button
              disabled={isProcessing || !f30FileBase64 || !rawPlanillaText}
              onClick={processF30Comparison}
              className="w-full py-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest transition shadow-xl shadow-blue-100 disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {isProcessing ? <><Loader2 className="animate-spin" /> Procesando con IA...</> : "Ejecutar Comparación Masiva"}
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">3. Tabla de Resultados Actual</h3>
            </div>

            <div className="flex-1 overflow-auto max-h-[600px]">
              {finalComparison.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-12 text-center space-y-4">
                  <FileSearch size={48} className="text-slate-200" />
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest max-w-[200px]">Los resultados aparecerán aquí tras ejecutar la comparación</p>
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 sticky top-0 font-bold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3">RUT</th>
                      <th className="px-4 py-3">NOMBRE</th>
                      <th className="px-4 py-3 text-center">CONTRATO</th>
                      <th className="px-4 py-3 text-center">F-30 1</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {finalComparison.map((item, idx) => (
                      <tr key={idx} className="hover:bg-blue-50 transition-colors">
                        <td className="px-4 py-3 font-mono text-slate-500">{item.rut}</td>
                        <td className="px-4 py-3 font-bold text-slate-800">{item.name}</td>
                        <td className="px-4 py-3 text-center"></td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase ${item.inF30 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                            {item.inF30 ? 'SÍ' : 'NO'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {finalComparison.length > 0 && (
          <div className="animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="bg-white p-6 rounded-2xl border-2 border-blue-100 shadow-xl space-y-6">
              <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                <div className="flex-1 space-y-2">
                  <h3 className="text-lg font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                    <ClipboardList className="text-blue-600" /> Entregable Final para Excel
                  </h3>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block tracking-wider">Período de Informe</label>
                      <input
                        placeholder="Ej: FEBRERO 2025"
                        className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-4 focus:ring-blue-50 outline-none transition-all font-bold"
                        value={periodo}
                        onChange={(e) => setPeriodo(e.target.value)}
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        onClick={() => copyAsExcelTable(finalComparison)}
                        className={`flex items-center gap-3 px-8 py-3 rounded-xl font-black uppercase text-sm tracking-widest transition transform active:scale-95 shadow-2xl ${copied ? 'bg-green-600 text-white shadow-green-200' : 'bg-slate-900 text-white hover:bg-black shadow-slate-200'}`}
                      >
                        {copied ? <CheckCircle size={20} /> : <Copy size={20} />}
                        {copied ? '¡Copiado como Tabla!' : 'Copiar Formato para Excel'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
          <History className="text-slate-400" />
          <h2 className="text-xl font-bold text-slate-800">Historial de Cruces (Últimos 12)</h2>
        </div>

        {f30History.length === 0 ? (
          <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
            <Clock size={48} className="text-slate-200 mx-auto mb-4" />
            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Aún no hay registros de comparaciones</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {f30History.map((record) => (
              <button
                key={record.id}
                onClick={() => setViewingRecord(record)}
                className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm text-left hover:border-blue-300 transition-all hover:shadow-md group flex flex-col"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="p-2 bg-slate-50 rounded-lg group-hover:bg-blue-50 transition-colors">
                    <FileText size={20} className="text-slate-400 group-hover:text-blue-600" />
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-full uppercase">ID #{record.id.toString().slice(-4)}</span>
                </div>

                <h4 className="font-bold text-slate-800 mb-1 line-clamp-1">{record.periodo || 'Sin Periodo'}</h4>

                <div className="space-y-2 mt-auto">
                  <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                    <Calendar size={14} className="text-slate-400" />
                    {new Date(record.timestamp).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                    <UsersIcon size={14} className="text-slate-400" />
                    {record.data.length} Trabajadores Analizados
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-50 flex items-center justify-between text-blue-600 font-bold text-xs uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                  Ver Detalle <ChevronRight size={14} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {viewingRecord && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 z-[60] animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-100">
                  <History size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Historial: {viewingRecord.periodo}</h3>
                  <p className="text-xs text-slate-500 font-medium">{new Date(viewingRecord.timestamp).toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'short' })}</p>
                </div>
              </div>
              <button onClick={() => setViewingRecord(null)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition">
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 border border-slate-100 rounded-xl overflow-hidden bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 font-bold text-slate-700">
                    <tr>
                      <th className="px-4 py-3">RUT</th>
                      <th className="px-4 py-3">NOMBRE</th>
                      <th className="px-4 py-3 text-center">F-30 1</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {viewingRecord.data.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-mono text-slate-500">{item.rut}</td>
                        <td className="px-4 py-3 font-bold text-slate-800">{item.name}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${item.inF30 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                            {item.inF30 ? 'SÍ' : 'NO'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-6">
                <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                  <h4 className="text-xs font-black text-blue-800 uppercase tracking-widest mb-4">Acciones Disponibles</h4>
                  <button
                    onClick={() => copyAsExcelTable(viewingRecord.data, viewingRecord.periodo)}
                    className={`w-full flex items-center justify-center gap-3 py-4 rounded-xl font-black uppercase text-xs tracking-widest transition transform active:scale-95 shadow-xl ${copied ? 'bg-green-600 text-white shadow-green-200' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200'}`}
                  >
                    {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
                    {copied ? '¡Copiado!' : 'Copiar como Tabla'}
                  </button>
                  <button
                    onClick={() => exportF30ComparisonToExcel(viewingRecord.data, viewingRecord.periodo)}
                    className="w-full flex items-center justify-center gap-3 py-4 mt-3 rounded-xl font-black uppercase text-xs tracking-widest transition transform active:scale-95 shadow-xl bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-200"
                  >
                    <Download size={18} /> Exportar a Excel
                  </button>
                </div>

                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Resumen de Auditoría</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 font-medium">Total Trabajadores:</span>
                      <span className="font-bold text-slate-800">{viewingRecord.data.length}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 font-medium">En F30 (SÍ):</span>
                      <span className="font-bold text-emerald-600">{viewingRecord.data.filter(i => i.inF30).length}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 font-medium">Faltantes (NO):</span>
                      <span className="font-bold text-rose-600">{viewingRecord.data.filter(i => !i.inF30).length}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">Esta vista corresponde a una captura estática realizada el {new Date(viewingRecord.timestamp).toLocaleDateString()}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompararF30;
