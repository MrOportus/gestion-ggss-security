import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  FileText, Send, Clock, MapPin, Briefcase, DollarSign, Download, ArrowLeft, Search, Calendar, UserCheck, UserX, Eye, Loader2, History
} from 'lucide-react';
import { auth as firebaseAuth } from '../lib/firebase';

interface GenerarContratoProps {
  onBack: () => void;
}

const GenerarContrato: React.FC<GenerarContratoProps> = ({ onBack }) => {
  const {
    employees, sites, contractHistory,
    saveContractRecord, showNotification
  } = useAppStore();

  const [isProcessing, setIsProcessing] = useState(false);
  const [contratoData, setContratoData] = useState({
    empleadoId: '',
    sucursalId: '',
    fechaInicio: '',
    fechaTermino: '',
    horarioA: '08:30 AM a 18:30 PM',
    horarioB: '18:00 PM a 09:00 AM',
    tipoContrato: 'Falabella Part-Time',
    sueldo: '539000'
  });
  const [contratoEmpSearch, setContratoEmpSearch] = useState('');
  const [contratoSiteSearch, setContratoSiteSearch] = useState('');
  const [showContratoEmpList, setShowContratoEmpList] = useState(false);
  const [showContratoSiteList, setShowContratoSiteList] = useState(false);
  const [showInactiveContrato, setShowInactiveContrato] = useState(true);

  const contratoEmpRef = useRef<HTMLDivElement>(null);
  const contratoSiteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contratoEmpRef.current && !contratoEmpRef.current.contains(event.target as Node)) setShowContratoEmpList(false);
      if (contratoSiteRef.current && !contratoSiteRef.current.contains(event.target as Node)) setShowContratoSiteList(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredContratoEmp = useMemo(() => {
    const lower = contratoEmpSearch.toLowerCase();
    return employees.filter(e => {
      const matchesSearch = e.firstName.toLowerCase().includes(lower) || e.lastNamePaterno.toLowerCase().includes(lower) || e.rut.toLowerCase().includes(lower);
      const matchesStatus = showInactiveContrato ? true : e.isActive;
      return matchesSearch && matchesStatus;
    });
  }, [employees, contratoEmpSearch, showInactiveContrato]);

  const filteredContratoSites = useMemo(() => {
    const lower = contratoSiteSearch.toLowerCase();
    return sites.filter(s => s.name.toLowerCase().includes(lower));
  }, [sites, contratoSiteSearch]);

  const contratoEmp = employees.find(e => String(e.id) === contratoData.empleadoId);
  const contratoSite = sites.find(s => String(s.id) === contratoData.sucursalId);

  const CONTRACT_TEMPLATES: Record<string, string> = {
    'Falabella Part-Time': '1w7CcoD-upGn7LoNH35KJ5bo-N4vmucG3H01bF_no4IQ'
  };

  const handleGenerateContract = async () => {
    if (!contratoEmp || !contratoSite || !contratoData.fechaInicio) {
      showNotification("Por favor seleccione un colaborador, una sucursal y la fecha de inicio.", "warning");
      return;
    }

    setIsProcessing(true);
    try {
      const templateId = CONTRACT_TEMPLATES[contratoData.tipoContrato];

      const payload = {
        colaboradorId: contratoEmp.id,
        templateId: templateId || '1Y0U_ID_H3R3',
        tipoContrato: contratoData.tipoContrato,
        nombre: `${contratoEmp.firstName} ${contratoEmp.lastNamePaterno} ${contratoEmp.lastNameMaterno || ''}`.trim(),
        rut: contratoEmp.rut,
        fecha_inicio: contratoData.fechaInicio,
        fecha_termino: contratoData.fechaTermino || 'Indefinido',
        fecha_nacimiento: contratoEmp.fechaNacimiento || '',
        nacionalidad: contratoEmp.nacionalidad || 'Chilena',
        direccion: contratoEmp.direccion || '',
        estado_civil: contratoEmp.estadoCivil || 'Soltero',
        telefono: contratoEmp.phone || '',
        salud: contratoEmp.salud || '',
        afp: contratoEmp.afp || '',
        sucursal_name: contratoSite.name,
        sucursal_address: contratoSite.address,
        empresa: contratoSite.empresa || 'GGSS Security',
        horarioA: contratoData.horarioA,
        horarioB: contratoData.horarioB,
        sueldo: contratoData.sueldo || contratoEmp.sueldoLiquido || 0,
        codigo_interno: contratoEmp.codigo || '10'
      };

      const user = firebaseAuth.currentUser;
      if (!user) {
        showNotification("Sesión expirada. Inicie sesión nuevamente.", "error");
        return;
      }
      const idToken = await user.getIdToken();

      const CF_URL = import.meta.env.VITE_CF_GENERATE_CONTRACT_URL;
      if (!CF_URL) {
        showNotification("Error: URL de automatización no configurada.", "error");
        return;
      }

      const response = await fetch(CF_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Error del servidor');
      }

      if (result.url) {
        saveContractRecord({
          workerName: `${contratoEmp.firstName} ${contratoEmp.lastNamePaterno}`,
          siteName: contratoSite.name,
          downloadUrl: result.url,
          fechaInicio: contratoData.fechaInicio,
          fechaTermino: contratoData.fechaTermino || 'Indefinido'
        });
        showNotification("¡Contrato generado exitosamente!", "success");
        const fileIdMatch = result.url.match(/[\w-]{33,}/);
        const directDownloadUrl = fileIdMatch ? `https://drive.google.com/uc?export=download&id=${fileIdMatch[0]}` : result.url;
        const a = document.createElement('a');
        a.href = directDownloadUrl;
        a.target = '_blank';
        a.download = `Contrato_${contratoEmp.firstName}_${contratoEmp.lastNamePaterno}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        showNotification("No se recibió enlace de descarga.", "warning");
      }
    } catch (error: any) {
      console.error("Error generating contract:", error);
      showNotification(error.message || "Error al generar contrato.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const formatDateForText = (dateStr: string) => {
    if (!dateStr) return '[Día ingresado]';
    const [year, month, day] = dateStr.split('-');
    return `${day}-${month}-${year}`;
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
        <h2 className="text-xl font-bold text-slate-800">Tarea: Generar Contrato</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Formulario (Col. Izquierda/Centro) */}
        <div className="lg:col-span-2 bg-white p-8 rounded-2xl border border-slate-200 shadow-sm space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

            {/* BUSQUEDA COLABORADOR */}
          <div className="flex flex-col space-y-1 relative" ref={contratoEmpRef} style={{ zIndex: showContratoEmpList ? 100 : 1 }}>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex justify-between items-center">
              Colaborador
              <button
                onClick={() => setShowInactiveContrato(!showInactiveContrato)}
                className={`text-[9px] px-1.5 py-0.5 rounded transition ${showInactiveContrato ? 'bg-violet-100 text-violet-700 font-bold' : 'bg-slate-100 text-slate-500'}`}
              >
                {showInactiveContrato ? 'Viendo Todos' : 'Viendo Activos'}
              </button>
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
              <input
                type="text"
                placeholder="Buscar por nombre o RUT..."
                className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-violet-500 outline-none bg-slate-50 rounded-t-lg transition-colors cursor-pointer"
                value={contratoEmpSearch}
                onFocus={() => {
                  setContratoEmpSearch('');
                  setShowContratoEmpList(true);
                }}
                onBlur={() => {
                  setTimeout(() => {
                    if (!contratoEmpSearch && contratoData.empleadoId) {
                      const emp = employees.find(e => String(e.id) === contratoData.empleadoId);
                      if (emp) setContratoEmpSearch(`${emp.firstName} ${emp.lastNamePaterno}`);
                    }
                    setShowContratoEmpList(false);
                  }, 200);
                }}
                onClick={() => { setShowContratoEmpList(true); setContratoEmpSearch(''); }}
                onChange={(e) => { setContratoEmpSearch(e.target.value); setShowContratoEmpList(true); }}
              />
            </div>
            {showContratoEmpList && (
              <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-2xl max-h-60 overflow-auto z-[110]">
                {filteredContratoEmp.map(e => (
                  <div
                    key={e.id}
                    className="px-4 py-2 hover:bg-violet-50 cursor-pointer border-b border-slate-50"
                    onClick={() => {
                      const autofillSite = e.currentSiteId ? sites.find(s => s.id === e.currentSiteId) : null;
                      setContratoData({ 
                        ...contratoData, 
                        empleadoId: String(e.id), 
                        sueldo: String(e.sueldoLiquido || '539000'),
                        sucursalId: autofillSite ? String(autofillSite.id) : contratoData.sucursalId
                      });
                      setContratoEmpSearch(`${e.firstName} ${e.lastNamePaterno}`);
                      if (autofillSite) {
                        setContratoSiteSearch(autofillSite.name);
                      }
                      setShowContratoEmpList(false);
                    }}
                  >
                    <div className="text-sm font-bold text-slate-700">
                      {e.firstName} {e.lastNamePaterno}
                      {!e.isActive && <span className="ml-2 text-[9px] text-rose-500 uppercase font-black">Inactivo</span>}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">{e.rut}</div>
                  </div>
                ))}
                {filteredContratoEmp.length === 0 && <div className="p-4 text-xs text-slate-400 italic text-center">No se encontraron resultados</div>}
              </div>
            )}
          </div>

          {/* BUSQUEDA SUCURSAL */}
          <div className="flex flex-col space-y-1 relative" ref={contratoSiteRef} style={{ zIndex: showContratoSiteList ? 100 : 1 }}>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sucursal / Instalación</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-2.5 text-slate-400" size={14} />
              <input
                type="text"
                placeholder="Buscar sucursal..."
                className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-violet-500 outline-none bg-slate-50 rounded-t-lg transition-colors cursor-pointer"
                value={contratoSiteSearch}
                onFocus={() => {
                  setContratoSiteSearch('');
                  setShowContratoSiteList(true);
                }}
                onBlur={() => {
                  setTimeout(() => {
                    if (!contratoSiteSearch && contratoData.sucursalId) {
                      const s = sites.find(site => String(site.id) === contratoData.sucursalId);
                      if (s) setContratoSiteSearch(s.name);
                    }
                    setShowContratoSiteList(false);
                  }, 200);
                }}
                onClick={() => { setShowContratoSiteList(true); setContratoSiteSearch(''); }}
                onChange={(e) => { setContratoSiteSearch(e.target.value); setShowContratoSiteList(true); }}
              />
            </div>
            {showContratoSiteList && (
              <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-2xl max-h-60 overflow-auto z-[110]">
                {filteredContratoSites.map(s => (
                  <div
                    key={s.id}
                    className="px-4 py-2 hover:bg-violet-50 cursor-pointer text-sm border-b border-slate-50 font-medium text-slate-700"
                    onClick={() => {
                      setContratoData({ ...contratoData, sucursalId: String(s.id) });
                      setContratoSiteSearch(s.name);
                      setShowContratoSiteList(false);
                    }}
                  >
                    {s.name}
                  </div>
                ))}
                {filteredContratoSites.length === 0 && <div className="p-4 text-xs text-slate-400 italic text-center">No se encontraron resultados</div>}
              </div>
            )}
          </div>

          {/* TIPO CONTRATO */}
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tipo de Contrato</label>
            <div className="relative">
              <Briefcase className="absolute left-3 top-2.5 text-slate-400" size={14} />
              <select
                className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-violet-500 outline-none bg-slate-50 rounded-t-lg transition-colors appearance-none"
                value={contratoData.tipoContrato}
                onChange={(e) => setContratoData({ ...contratoData, tipoContrato: e.target.value })}
              >
                <option value="Falabella Part-Time">Falabella Part-Time</option>
              </select>
            </div>
          </div>

          {/* FECHAS */}
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fecha Inicio</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-2.5 text-slate-400" size={14} />
              <input
                type="date"
                className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-violet-500 outline-none bg-slate-50 rounded-t-lg transition-colors"
                value={contratoData.fechaInicio}
                onChange={(e) => setContratoData({ ...contratoData, fechaInicio: e.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fecha Término (Opcional)</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-2.5 text-slate-400" size={14} />
              <input
                type="date"
                className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-violet-500 outline-none bg-slate-50 rounded-t-lg transition-colors"
                value={contratoData.fechaTermino}
                onChange={(e) => setContratoData({ ...contratoData, fechaTermino: e.target.value })}
              />
            </div>
          </div>

          {/* SUELDO */}
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sueldo Base</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-2.5 text-slate-400" size={14} />
              <input
                type="number"
                placeholder="Monto líquido..."
                className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-violet-500 outline-none bg-slate-50 rounded-t-lg transition-colors"
                value={contratoData.sueldo}
                onChange={(e) => setContratoData({ ...contratoData, sueldo: e.target.value })}
              />
            </div>
          </div>

          {/* HORARIOS */}
          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Horario A (Diurno)</label>
            <div className="relative">
              <Clock className="absolute left-3 top-2.5 text-slate-400" size={14} />
              <input
                type="text"
                className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-violet-500 outline-none bg-slate-50 rounded-t-lg transition-colors"
                value={contratoData.horarioA}
                onChange={(e) => setContratoData({ ...contratoData, horarioA: e.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-col space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Horario B (Nocturno)</label>
            <div className="relative">
              <Clock className="absolute left-3 top-2.5 text-slate-400" size={14} />
              <input
                type="text"
                className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-violet-500 outline-none bg-slate-50 rounded-t-lg transition-colors"
                value={contratoData.horarioB}
                onChange={(e) => setContratoData({ ...contratoData, horarioB: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <button
            disabled={isProcessing}
            onClick={handleGenerateContract}
            className="flex items-center gap-3 px-12 py-4 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-black uppercase tracking-widest text-sm transition shadow-xl shadow-violet-100 disabled:opacity-50 active:scale-95"
          >
            {isProcessing ? <Loader2 className="animate-spin" /> : <Send size={18} />}
            {isProcessing ? 'Enviando...' : 'Generar y Enviar Contrato'}
          </button>
        </div>
      </div>

      {/* Panel Informativo de Trabajador (Col. Derecha) */}
      <div className="lg:col-span-1">
        {contratoEmp ? (
          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 sticky top-6 shadow-sm overflow-hidden relative">
            <div className="absolute top-0 left-0 w-1 h-full bg-violet-500"></div>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-6 flex items-center gap-2">
              <UserCheck size={16} className="text-violet-500" />
              Trabajador Seleccionado
            </h3>
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nombre Completo</p>
                <p className="text-sm font-bold text-slate-700 truncate">{contratoEmp.firstName} {contratoEmp.lastNamePaterno}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">RUT</p>
                <p className="text-sm font-mono text-slate-600">{contratoEmp.rut}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Dirección</p>
                <p className="text-sm text-slate-600 truncate">{contratoEmp.direccion || 'Sin registro'}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Última / Actual Sucursal</p>
                <p className="text-sm text-slate-600 font-medium">
                  {contratoEmp.currentSiteId ? (sites.find(s => s.id === contratoEmp.currentSiteId)?.name || 'Desconocida') : 'No asignado'}
                </p>
              </div>
              <div className="pt-2 border-t border-slate-200">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Certificado OS10</p>
                 {(() => {
                    const hasDate = Boolean(contratoEmp.fechaVencimientoOS10);
                    let isExpired = false;
                    let formattedDate = '';
                    if (hasDate) {
                      const parts = contratoEmp.fechaVencimientoOS10!.split('-');
                      const dateOs10 = parts[0].length === 4 ? new Date(contratoEmp.fechaVencimientoOS10!) : new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
                      isExpired = dateOs10 < new Date();
                      formattedDate = parts[0].length === 4 ? `${parts[2]}-${parts[1]}-${parts[0]}` : contratoEmp.fechaVencimientoOS10!;
                    }
                    if (!hasDate) {
                      return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200"><UserX size={12}/> Sin Información</span>;
                    }
                    return isExpired ? 
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200">Vencido ({formattedDate})</span> : 
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700 border border-green-200">Vigente ({formattedDate})</span>;
                  })()}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 text-center flex flex-col items-center justify-center h-full min-h-[300px] text-slate-400 sticky top-6 shadow-sm">
            <UserX size={48} className="mb-4 opacity-30" />
            <p className="text-sm font-medium">Seleccione un trabajador para validar sus datos de contrato</p>
          </div>
        )}
      </div>
    </div>

      {/* HISTORIAL DE CONTRATOS */}
      <div className="space-y-6">
        <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
          <History className="text-slate-400" />
          <h2 className="text-xl font-bold text-slate-800">Últimos Contratos Generados (Máx 12)</h2>
        </div>

        {contractHistory.length === 0 ? (
          <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
            <FileText size={48} className="text-slate-200 mx-auto mb-4" />
            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Aún no hay contratos registrados</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {contractHistory.map((record) => (
              <div
                key={record.id}
                className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm hover:border-violet-300 transition-all group flex flex-col"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="p-2 bg-violet-50 rounded-lg group-hover:bg-violet-100 transition-colors">
                    <FileText size={20} className="text-violet-600" />
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-full uppercase">ID #{record.id.toString().slice(-4)}</span>
                </div>

                <h4 className="font-bold text-slate-800 mb-1 line-clamp-1">{record.workerName}</h4>
                <p className="text-sm text-slate-600 font-medium mb-4 flex items-center gap-1.5">
                  <MapPin size={14} className="text-slate-400" /> {record.siteName}
                </p>

                <div className="space-y-2 mt-auto">
                  <div className="flex flex-col gap-1.5 mb-2">
                    <div className="flex items-center gap-2 text-xs text-slate-700 font-bold">
                      <span className="text-slate-400 uppercase font-black text-[10px]">Desde:</span>
                      {record.fechaInicio ? formatDateForText(record.fechaInicio) : 'N/R'}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-700 font-bold">
                      <span className="text-slate-400 uppercase font-black text-[10px]">Hasta:</span>
                      {record.fechaTermino ? (record.fechaTermino === 'Indefinido' ? 'Indefinido' : formatDateForText(record.fechaTermino)) : 'N/R'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 italic">
                    <Clock size={12} />
                    Generado: {new Date(record.timestamp).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-50 flex items-center justify-between">
                  <a
                    href={(() => {
                       const fileIdMatch = record.downloadUrl.match(/[\w-]{33,}/);
                       return fileIdMatch ? `https://drive.google.com/uc?export=download&id=${fileIdMatch[0]}` : record.downloadUrl;
                    })()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-violet-600 font-bold text-xs uppercase tracking-widest hover:text-violet-800 transition-colors"
                  >
                    Descargar PDF <Download size={14} />
                  </a>
                  <a
                    href={record.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-indigo-900 font-bold text-xs uppercase tracking-widest hover:text-violet-800 transition-colors"
                  >
                    <Eye size={16} /> ver&gt;
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default GenerarContrato;
