import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  Copy, CheckCircle, UserPlus, Calendar, Search, MapPin, ArrowLeft
} from 'lucide-react';

interface InfoReemplazoProps {
  onBack: () => void;
}

const InfoReemplazo: React.FC<InfoReemplazoProps> = ({ onBack }) => {
  const { employees, sites } = useAppStore();

  // --- ESTADOS INFO REEMPLAZO ---
  const [reemplazoData, setReemplazoData] = useState({
    empleadoActualId: '',
    empleadoReemplazoId: '',
    diaReemplazo: '',
    motivo: '',
    sucursalId: ''
  });
  const [siteSearch, setSiteSearch] = useState('');
  const [actualSearch, setActualSearch] = useState('');
  const [replacementSearch, setReplacementSearch] = useState('');
  const [showSiteList, setShowSiteList] = useState(false);
  const [showActualList, setShowActualList] = useState(false);
  const [showReplacementList, setShowReplacementList] = useState(false);
  const [showInactive, setShowInactive] = useState(true);
  const [copied, setCopied] = useState(false);

  // Refs para cierre al hacer click fuera
  const siteRef = useRef<HTMLDivElement>(null);
  const actualRef = useRef<HTMLDivElement>(null);
  const replacementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (siteRef.current && !siteRef.current.contains(event.target as Node)) setShowSiteList(false);
      if (actualRef.current && !actualRef.current.contains(event.target as Node)) setShowActualList(false);
      if (replacementRef.current && !replacementRef.current.contains(event.target as Node)) setShowReplacementList(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // --- LOGICA INFO REEMPLAZO ---
  const currentEmp = employees.find(e => String(e.id) === reemplazoData.empleadoActualId);
  const replacementEmp = employees.find(e => String(e.id) === reemplazoData.empleadoReemplazoId);
  const sucursal = sites.find(s => String(s.id) === reemplazoData.sucursalId);

  const filteredSitesTasks = useMemo(() => {
    const lower = siteSearch.toLowerCase();
    return sites.filter(s => s.name.toLowerCase().includes(lower));
  }, [sites, siteSearch]);

  const filteredActual = useMemo(() => {
    const lower = actualSearch.toLowerCase();
    return employees.filter(e =>
      e.isActive && (e.firstName.toLowerCase().includes(lower) || e.lastNamePaterno.toLowerCase().includes(lower) || e.rut.toLowerCase().includes(lower))
    );
  }, [employees, actualSearch]);

  const filteredReplacement = useMemo(() => {
    const lower = replacementSearch.toLowerCase();
    return employees.filter(e => {
      const matchesSearch = e.firstName.toLowerCase().includes(lower) || e.lastNamePaterno.toLowerCase().includes(lower) || e.rut.toLowerCase().includes(lower);
      const matchesStatus = showInactive ? true : e.isActive;
      return matchesSearch && matchesStatus;
    });
  }, [employees, replacementSearch, showInactive]);

  const formatDateForText = (dateStr: string) => {
    if (!dateStr) return '[Día ingresado]';
    const [year, month, day] = dateStr.split('-');
    return `${day}-${month}-${year}`;
  };

  const generatedReemplazoText = `Estimados.
Banco Falabella
PRESENTE

Junto con saludar y según requerimiento, solicito autorización para reemplazar al gg.ss el ${formatDateForText(reemplazoData.diaReemplazo)}, motivo: ${reemplazoData.motivo || '[Motivo Ingresado]'}.

Sucursal ${sucursal?.name || '[Sucursal Ingresada]'}

Actualmente:  
${currentEmp ? `${currentEmp.firstName} ${currentEmp.lastNamePaterno}` : '[Nombre colaborador 1]'}
Rut: ${currentEmp?.rut || '[Rut_colaborador 1]'}

Concurre en su reemplazo: 
${replacementEmp ? `${replacementEmp.firstName} ${replacementEmp.lastNamePaterno}` : '[Nombre colaborador 2]'}  
Rut: ${replacementEmp?.rut || '[Rut_colaborador 2]'}

Documentos que se adjuntan.

1.- Contrato de Trabajo.
2.- Sol. Credencial.
3.- Seguro de Vida.
4.- Cédula de identidad.`;

  return (
    <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6">
      <div className="flex items-center gap-4 border-b border-slate-200 pb-4">
        <button
          onClick={onBack}
          className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
        >
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-xl font-bold text-slate-800">Generador: Info Reemplazo</h2>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-4">Parámetros del Reemplazo</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* SUCURSAL */}
            <div className="flex flex-col space-y-1 relative" ref={siteRef} style={{ zIndex: showSiteList ? 100 : 1 }}>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sucursal / Instalación</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-2.5 text-slate-400" size={14} />
                <input
                  type="text"
                  placeholder="Buscar sucursal..."
                  className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-t-lg transition-colors cursor-pointer"
                  value={siteSearch}
                  onFocus={() => {
                    setSiteSearch('');
                    setShowSiteList(true);
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      if (!siteSearch && reemplazoData.sucursalId) {
                        const s = sites.find(site => String(site.id) === reemplazoData.sucursalId);
                        if (s) setSiteSearch(s.name);
                      }
                      setShowSiteList(false);
                    }, 200);
                  }}
                  onClick={() => { setShowSiteList(true); setSiteSearch(''); }}
                  onChange={(e) => { setSiteSearch(e.target.value); setShowSiteList(true); }}
                />
              </div>
              {showSiteList && (
                <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-2xl max-h-60 overflow-auto z-[110]">
                  {filteredSitesTasks.map(s => (
                    <div
                      key={s.id}
                      className="px-4 py-2 hover:bg-blue-50 cursor-pointer text-sm border-b border-slate-50 font-medium text-slate-700"
                      onClick={() => {
                        setReemplazoData({ ...reemplazoData, sucursalId: String(s.id) });
                        setSiteSearch(s.name);
                        setShowSiteList(false);
                      }}
                    >
                      {s.name}
                    </div>
                  ))}
                  {filteredSitesTasks.length === 0 && <div className="p-4 text-xs text-slate-400 italic text-center">No se encontraron resultados</div>}
                </div>
              )}
            </div>

            <div className="flex flex-col space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <Calendar size={12} className="text-blue-500" /> Día del Reemplazo
              </label>
              <input
                type="date"
                className="w-full border-b-2 border-slate-100 focus:border-blue-500 p-2 text-sm outline-none bg-slate-50 rounded-t-lg transition-colors cursor-pointer"
                value={reemplazoData.diaReemplazo}
                onClick={(e) => {
                  try {
                    e.currentTarget.showPicker?.();
                  } catch (err) { }
                }}
                onChange={(e) => setReemplazoData({ ...reemplazoData, diaReemplazo: e.target.value })}
              />
            </div>

            {/* COLABORADOR ACTUAL */}
            <div className="flex flex-col space-y-1 relative" ref={actualRef} style={{ zIndex: showActualList ? 100 : 1 }}>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Colaborador Actual (GG.SS)</label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                <input
                  type="text"
                  placeholder="Buscar por nombre o RUT..."
                  className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-t-lg transition-colors cursor-pointer"
                  value={actualSearch}
                  onFocus={() => {
                    setActualSearch('');
                    setShowActualList(true);
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      if (!actualSearch && reemplazoData.empleadoActualId) {
                        const emp = employees.find(e => String(e.id) === reemplazoData.empleadoActualId);
                        if (emp) setActualSearch(`${emp.firstName} ${emp.lastNamePaterno}`);
                      }
                      setShowActualList(false);
                    }, 200);
                  }}
                  onClick={() => { setShowActualList(true); setActualSearch(''); }}
                  onChange={(e) => { setActualSearch(e.target.value); setShowActualList(true); }}
                />
              </div>
              {showActualList && (
                <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-2xl max-h-60 overflow-auto z-[110]">
                  {filteredActual.map(e => (
                    <div
                      key={e.id}
                      className="px-4 py-2 hover:bg-blue-50 cursor-pointer border-b border-slate-50"
                      onClick={() => {
                        setReemplazoData({ ...reemplazoData, empleadoActualId: String(e.id) });
                        setActualSearch(`${e.firstName} ${e.lastNamePaterno}`);
                        setShowActualList(false);
                      }}
                    >
                      <div className="text-sm font-bold text-slate-700">{e.firstName} {e.lastNamePaterno}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{e.rut}</div>
                    </div>
                  ))}
                  {filteredActual.length === 0 && <div className="p-4 text-xs text-slate-400 italic text-center">No se encontraron resultados</div>}
                </div>
              )}
            </div>

            {/* COLABORADOR REEMPLAZO */}
            <div className="flex flex-col space-y-1 relative" ref={replacementRef} style={{ zIndex: showReplacementList ? 100 : 1 }}>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex justify-between items-center">
                Colaborador Reemplazo
                <button
                  onClick={() => setShowInactive(!showInactive)}
                  className={`text-[9px] px-1.5 py-0.5 rounded transition ${showInactive ? 'bg-blue-100 text-blue-700 font-bold' : 'bg-slate-100 text-slate-500'}`}
                >
                  {showInactive ? 'Viendo Todos' : 'Viendo Activos'}
                </button>
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                <input
                  type="text"
                  placeholder="Buscar por nombre o RUT..."
                  className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-t-lg transition-colors cursor-pointer"
                  value={replacementSearch}
                  onFocus={() => {
                    setReplacementSearch('');
                    setShowReplacementList(true);
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      if (!replacementSearch && reemplazoData.empleadoReemplazoId) {
                        const emp = employees.find(e => String(e.id) === reemplazoData.empleadoReemplazoId);
                        if (emp) setReplacementSearch(`${emp.firstName} ${emp.lastNamePaterno}`);
                      }
                      setShowReplacementList(false);
                    }, 200);
                  }}
                  onClick={() => { setShowReplacementList(true); setReplacementSearch(''); }}
                  onChange={(e) => { setReplacementSearch(e.target.value); setShowReplacementList(true); }}
                />
              </div>
              {showReplacementList && (
                <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-2xl max-h-60 overflow-auto z-[110]">
                  {filteredReplacement.map(e => (
                    <div
                      key={e.id}
                      className="px-4 py-2 hover:bg-blue-50 cursor-pointer border-b border-slate-50"
                      onClick={() => {
                        setReemplazoData({ ...reemplazoData, empleadoReemplazoId: String(e.id) });
                        setReplacementSearch(`${e.firstName} ${e.lastNamePaterno}`);
                        setShowReplacementList(false);
                      }}
                    >
                      <div className="text-sm font-bold text-slate-700">
                        {e.firstName} {e.lastNamePaterno}
                        {!e.isActive && <span className="ml-2 text-[9px] text-rose-500 uppercase font-black">Inactivo</span>}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">{e.rut}</div>
                    </div>
                  ))}
                  {filteredReplacement.length === 0 && <div className="p-4 text-xs text-slate-400 italic text-center">No se encontraron resultados</div>}
                </div>
              )}
            </div>

            <div className="flex flex-col space-y-1 md:col-span-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Motivo del Reemplazo</label>
              <div className="flex flex-wrap gap-2 mb-3">
                {['Mejora Servicio', 'Condiciones de salud', 'Motivos Personales', 'Licencia'].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setReemplazoData({ ...reemplazoData, motivo: m })}
                    className={`px-3 py-1 rounded-full text-[10px] font-bold border transition ${reemplazoData.motivo === m ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <input
                placeholder="O escriba otro motivo..."
                className="w-full border-b-2 border-slate-100 focus:border-blue-500 p-2.5 text-sm outline-none bg-slate-50 rounded-t-lg transition-colors"
                value={reemplazoData.motivo}
                onChange={(e) => setReemplazoData({ ...reemplazoData, motivo: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col space-y-4">
          <button
            onClick={() => {
              navigator.clipboard.writeText(generatedReemplazoText);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000)
            }}
            className={`w-full flex items-center justify-center gap-2 py-4 rounded-xl font-black uppercase tracking-widest text-sm transition shadow-lg ${copied ? 'bg-green-600 text-white shadow-green-100 scale-[0.98]' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-100 active:scale-95'}`}
          >
            {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
            {copied ? '¡Texto Copiado!' : 'Copiar Texto para Solicitud'}
          </button>

          <div className="flex-1 bg-slate-900 text-blue-400 p-8 rounded-2xl font-mono text-xs whitespace-pre-wrap overflow-y-auto max-h-[500px] border border-slate-800 shadow-inner relative">
            <div className="absolute top-4 right-4 px-2 py-1 bg-slate-800 rounded text-[9px] font-bold text-slate-500 uppercase tracking-widest">Vista Previa</div>
            {generatedReemplazoText}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InfoReemplazo;
