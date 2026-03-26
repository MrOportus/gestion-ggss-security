import React, { useState } from 'react';
import {
    Sparkles,
    Terminal,
    CheckCircle,
    Eraser,
    User,
    Calendar,
    Hash,
    Loader2,
    Search,
    Users,
    ArrowLeft
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { useAppStore } from '../store/useAppStore';

interface ExtractedData {
    nombre: string;
    rut: string;
    edad: string;
    fechaNacimiento: string;
    sexo: string;
}

const SmartAutofill: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const { employees, sites } = useAppStore();
    const [activeTab, setActiveTab] = useState<'search' | 'text'>('search');
    const [searchTerm, setSearchTerm] = useState('');
    const [inputText, setInputText] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [extractedData, setExtractedData] = useState<ExtractedData>({
        nombre: '',
        rut: '',
        edad: '',
        fechaNacimiento: '',
        sexo: ''
    });
    const [os10Info, setOs10Info] = useState<string>('Sin Información');
    const [os10Date, setOs10Date] = useState<string | null>(null);
    const [siteInfo, setSiteInfo] = useState<string>('Sin sucursal asignada');
    const [scriptCopied, setScriptCopied] = useState(false);

    // Use env var or manual input
    const envApiKey = (import.meta as any).env?.VITE_API_KEY;
    const [manualApiKey, setManualApiKey] = useState('');
    const finalApiKey = envApiKey || manualApiKey;

    // --- SEARCH LOGIC ---
    const filteredEmployees = employees.filter(e => {
        if (!searchTerm) return false;
        const term = searchTerm.toLowerCase();
        const fullName = `${e.firstName} ${e.lastNamePaterno} ${e.lastNameMaterno || ''}`.toLowerCase();
        return fullName.includes(term) || e.rut.toLowerCase().includes(term);
    });

    const handleEmployeeSelect = (emp: typeof employees[0]) => {
        const calculateAge = (birthDate: string) => {
            if (!birthDate) return '';
            const birthYear = new Date(birthDate).getFullYear();
            const currentYear = 2025; // Fixed ref year
            return (currentYear - birthYear).toString() + ' años';
        };

        const formatDate = (dateStr?: string) => {
            console.log("Raw date received:", dateStr); // DEBUG
            if (!dateStr) return '';
            try {
                // Determine format
                const date = new Date(dateStr);

                // Use local time methods (getDate, getMonth) to properly apply timezone shift 
                // (e.g., 2028-02-01 UTC -> 2028-01-31 Local in Chile)
                const day = String(date.getDate()).padStart(2, '0');
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const year = date.getFullYear();

                return `${day}/${month}/${year}`;
            } catch {
                return '';
            }
        };

        setExtractedData({
            nombre: `${emp.firstName} ${emp.lastNamePaterno} ${emp.lastNameMaterno || ''}`.trim(),
            rut: emp.rut,
            edad: calculateAge(emp.fechaNacimiento || ''),
            fechaNacimiento: formatDate(emp.fechaNacimiento),
            sexo: '' // Not in DB typically, user selects
        });

        // OS10 Logic
        if (emp.fechaVencimientoOS10) {
            setOs10Info(formatDate(emp.fechaVencimientoOS10));
            setOs10Date(emp.fechaVencimientoOS10);
        } else {
            setOs10Info('Sin Registrar');
            setOs10Date(null);
        }

        // Site Logic
        const site = sites.find(s => s.id === emp.currentSiteId);
        setSiteInfo(site ? site.name : 'Sin sucursal asignada');

        setSearchTerm(''); // Clear search on select or keep? Let's clear for cleaner UI
    };

    // --- AI EXTRACTION LOGIC ---
    const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement> | React.ChangeEvent<HTMLTextAreaElement>) => {
        const text = (e as React.ClipboardEvent).clipboardData
            ? (e as React.ClipboardEvent).clipboardData.getData('text')
            : (e.target as HTMLTextAreaElement).value;

        setInputText(text);

        // Si el texto es muy corto, no procesar
        if (text.length < 10) return;

        setIsProcessing(true);

        try {
            if (!finalApiKey) {
                alert("Falta la API KEY. Por favor configúrela en .env o ingrésela manualmente.");
                setIsProcessing(false);
                return;
            }

            const ai = new GoogleGenAI({ apiKey: finalApiKey });

            const prompt = `
        Analiza el siguiente texto y devuelve un JSON. Fecha de referencia actual: Marzo 2025.
        Texto: "${text}"
        
        Reglas:
        RUT: Normalizar a XX.XXX.XXX-X.
        Edad: Si el texto menciona un año de nacimiento, calcula la edad restándolo de 2025 (ej: 2003 = 22 años).
        Fecha Nacimiento: Formato estricto DD/MM/YYYY.
        Sexo: Clasificar como 'Masculino' o 'Femenino'.
        
        Response Schema:
        {
          "nombre": "string",
          "rut": "string",
          "edad": "string",
          "fechaNacimiento": "string",
          "sexo": "string"
        }
      `;

            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: [{ text: prompt }],
                config: {
                    responseMimeType: 'application/json',
                    systemInstruction: "Actúa como un asistente administrativo experto en salud. Tu objetivo es normalizar datos personales de pacientes."
                }
            });

            const result = JSON.parse(response.text || "{}");
            setExtractedData(result);
            setOs10Info('Sin Información'); // Reset for non-DB data
            setOs10Date(null);
            setSiteInfo('Sin sucursal asignada');

        } catch (error) {
            console.error("Error extracting data:", error);
            alert("Error al procesar el texto.");
        } finally {
            setIsProcessing(false);
        }
    };

    // --- SCRIPT GENERATION LOGIC ---
    const generateScript = () => {
        // Prepare data safe for injection
        const safeData = {
            nombre: extractedData.nombre || '',
            rut: extractedData.rut || '',
            edad: (extractedData.edad || '').replace(/\D/g, ''), // Extract number
            fecha: extractedData.fechaNacimiento || '',
            sexoValue: (extractedData.sexo || '').toLowerCase() === 'masculino' ? 'male' :
                (extractedData.sexo || '').toLowerCase() === 'femenino' ? 'female' : ''
        };

        const script = `
(function() {
  const data = ${JSON.stringify(safeData)};

  const findAndFill = (keywords, value) => {
    if (!value) return false;
    // Intentar primero por ID exacto si el keyword parece un ID
    for (const kw of keywords) {
      const el = document.getElementById(kw);
      if (el) {
        if (el.type === 'radio' || el.type === 'checkbox') {
          el.checked = true;
        } else {
          el.value = value;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }

    // Si no funcionó por ID, buscar por atributos
    const inputs = document.querySelectorAll('input:not([type="hidden"]), select, textarea');
    for (const input of inputs) {
      const name = (input.name || '').toLowerCase();
      const id = (input.id || '').toLowerCase();
      const placeholder = (input.placeholder || '').toLowerCase();
      const labelText = (input.labels?.[0]?.innerText || '').toLowerCase();
      
      if (keywords.some(k => name.includes(k) || id.includes(k) || placeholder.includes(k) || labelText.includes(k))) {
        if (input.type === 'radio' || input.type === 'checkbox') {
           if (input.value.toLowerCase().includes(value.toLowerCase()) || labelText.includes(value.toLowerCase())) {
             input.checked = true;
           }
        } else {
          input.value = value;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  };

  console.log('Smart Fill: Procesando campos...');

  // Llenado de cada campo de forma independiente
  findAndFill(['service_request_response_name', 'nombre', 'name', 'completo'], data.nombre);
  findAndFill(['service_request_response_national_identification', 'rut', 'identification', 'documento'], data.rut);
  findAndFill(['service_request_response_age', 'edad', 'age', 'años'], data.edad);
  findAndFill(['service_request_response_birth_date', 'fecha', 'birth', 'nacimiento', 'fec_nac'], data.fecha);
  
  if (data.sexoValue === 'male') {
    findAndFill(['service_request_response_gender_male', 'gender_male', 'sexo_masculino'], 'male');
  } else if (data.sexoValue === 'female') {
    findAndFill(['service_request_response_gender_female', 'gender_female', 'sexo_femenino'], 'female');
  }

  alert('¡Auto-llenado finalizado! Revisa los campos de Edad y Fecha.');
})();
    `;

        navigator.clipboard.writeText(script);
        setScriptCopied(true);
        setTimeout(() => setScriptCopied(false), 2000);
    };

    return (
        <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6">
            {/* HEADER */}
            <div className="flex items-center gap-4 border-b border-slate-200 pb-4">
                <button
                    onClick={onBack}
                    className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
                >
                    <ArrowLeft size={20} />
                </button>
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <Sparkles className="text-amber-500" /> Modulo de Auto-llenado
                </h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* LEFT COLUMN - SOURCE SELECTION */}
                <div className="space-y-6">
                    {!envApiKey && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col gap-2">
                            <h3 className="text-xs font-bold text-amber-800 uppercase tracking-widest">Configuración Faltante</h3>
                            <p className="text-xs text-amber-700">No se detectó VITE_API_KEY en .env. Puede ingresarla temporalmente aquí:</p>
                            <input
                                type="password"
                                placeholder="Pegue su API Key de Gemini aquí..."
                                value={manualApiKey}
                                onChange={(e) => setManualApiKey(e.target.value)}
                                className="w-full p-2 text-sm border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
                            />
                        </div>
                    )}

                    {/* TABS */}
                    <div className="bg-slate-100 p-1 rounded-xl flex">
                        <button
                            onClick={() => setActiveTab('search')}
                            className={`flex-1 py-2 text-xs font-bold uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'search' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            <User size={14} /> Buscar Colaborador
                        </button>
                        <button
                            onClick={() => setActiveTab('text')}
                            className={`flex-1 py-2 text-xs font-bold uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'text' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            <Sparkles size={14} /> Texto desde Contrato
                        </button>
                    </div>

                    {activeTab === 'search' ? (
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[400px]">
                            <div className="relative mb-4">
                                <Search className="absolute left-3 top-3 text-slate-400" size={18} />
                                <input
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-100 outline-none transition"
                                    placeholder="Buscar por Nombre o RUT..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    onFocus={() => setSearchTerm('')}
                                    autoFocus
                                />
                            </div>

                            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                                {searchTerm.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-300">
                                        <Users size={48} className="mb-2" opacity={0.5} />
                                        <p className="text-xs font-bold uppercase">Empiece a escribir para buscar</p>
                                    </div>
                                ) : filteredEmployees.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-300">
                                        <p className="text-xs font-bold uppercase">No se encontraron resultados</p>
                                    </div>
                                ) : (
                                    filteredEmployees.map(emp => (
                                        <button
                                            key={emp.id}
                                            onClick={() => handleEmployeeSelect(emp)}
                                            className="w-full text-left p-3 rounded-xl hover:bg-blue-50 border border-transparent hover:border-blue-100 transition-all group"
                                        >
                                            <p className="text-sm font-bold text-slate-700 group-hover:text-blue-700">{emp.firstName} {emp.lastNamePaterno}</p>
                                            <p className="text-[10px] text-slate-400 font-mono">{emp.rut}</p>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 h-[400px]">
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                <Sparkles size={14} /> Texto desde Contrato
                            </h3>
                            <div className="relative group h-full pb-8">
                                <textarea
                                    value={inputText}
                                    onChange={(e) => setInputText(e.target.value)}
                                    onPaste={handlePaste}
                                    placeholder="Copia y pega la informacion del trabajador directamente desde su contrato."
                                    className="w-full h-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition resize-none"
                                />
                                <div className="absolute bottom-10 right-4 flex gap-2">
                                    {inputText && (
                                        <button
                                            onClick={() => {
                                                setInputText('');
                                                setExtractedData({ nombre: '', rut: '', edad: '', fechaNacimiento: '', sexo: '' });
                                                setOs10Info('Sin Información');
                                                setOs10Date(null);
                                                setSiteInfo('Sin sucursal asignada');
                                            }}
                                            className="p-2 bg-white text-slate-400 hover:text-rose-500 rounded-lg shadow-sm border border-slate-200 transition"
                                            title="Limpiar"
                                        >
                                            <Eraser size={16} />
                                        </button>
                                    )}
                                </div>
                                {isProcessing && (
                                    <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-xl z-10">
                                        <Loader2 className="animate-spin text-blue-600 mb-2" size={32} />
                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest animate-pulse">Analizando Texto con Gemini IA...</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <button
                        onClick={generateScript}
                        disabled={!extractedData.rut}
                        className={`w-full py-4 rounded-xl font-black uppercase tracking-widest transition shadow-xl flex items-center justify-center gap-3 ${!extractedData.rut
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            : scriptCopied
                                ? 'bg-green-600 text-white shadow-green-200 scale-[0.98]'
                                : 'bg-slate-900 text-white hover:bg-black shadow-slate-200 hover:-translate-y-1'
                            }`}
                    >
                        {scriptCopied ? <CheckCircle size={20} /> : <Terminal size={20} />}
                        {scriptCopied ? '¡Script Copiado al Portapapeles!' : 'Copiar Script'}
                    </button>

                    <div className="mt-4 p-3 bg-blue-50/50 rounded-xl border border-blue-100/50">
                        <p className="text-xs text-center text-slate-500 font-medium leading-relaxed">
                            <span className="font-bold text-blue-600 block mb-1">Instrucciones de Uso:</span>
                            Una vez copiado el script debes ir a la página web donde quieras completar el formulario, luego presionar <span className="font-mono bg-slate-100 px-1 rounded text-slate-600">F12</span>, buscar la pestaña <span className="font-bold">Consola</span>, pegar el script y presionar<span className="font-mono bg-slate-100 px-1 rounded text-slate-600">Enter</span>.
                        </p>
                    </div>
                </div>

                {/* RIGHT COLUMN - PREVIEW */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
                    <div className="p-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                        <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">2. Verificación de Datos</h3>
                        {extractedData.rut && <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold uppercase">Datos Listos</span>}
                    </div>

                    <div className="p-6 flex-1 space-y-6">
                        {/* Highlighted Status Section for High Readability */}
                        <div className="grid grid-cols-2 gap-3">
                            {/* OS10 BOX */}
                            {(() => {
                                let bgColor = 'bg-slate-900';
                                let borderColor = 'border-slate-700';
                                let textColor = 'text-amber-500';

                                if (os10Date) {
                                    const expiry = new Date(os10Date);
                                    const today = new Date();
                                    today.setHours(0, 0, 0, 0);

                                    const twoMonthsLater = new Date(today);
                                    twoMonthsLater.setMonth(today.getMonth() + 2);

                                    if (expiry < today) {
                                        bgColor = 'bg-rose-600';
                                        borderColor = 'border-rose-700';
                                        textColor = 'text-rose-100';
                                    } else if (expiry < twoMonthsLater) {
                                        bgColor = 'bg-amber-500';
                                        borderColor = 'border-amber-600';
                                        textColor = 'text-amber-950';
                                    } else {
                                        bgColor = 'bg-emerald-600';
                                        borderColor = 'border-emerald-700';
                                        textColor = 'text-emerald-100';
                                    }
                                }

                                return (
                                    <div className={`${bgColor} text-white p-4 rounded-2xl shadow-lg border-b-4 ${borderColor} animate-in zoom-in-95 duration-500 flex flex-col justify-center`}>
                                        <p className={`text-[9px] font-black ${textColor} uppercase tracking-wider mb-0.5`}>Vigencia OS10</p>
                                        <p className="text-xl font-black">{os10Info}</p>
                                    </div>
                                );
                            })()}

                            {/* SITE BOX */}
                            <div className="bg-blue-600 text-white p-4 rounded-2xl shadow-lg border-b-4 border-blue-800 animate-in zoom-in-95 duration-500 delay-100 flex flex-col justify-center">
                                <p className="text-[9px] font-black text-blue-200 uppercase tracking-wider mb-0.5">Sucursal Contrato</p>
                                <p className="text-sm font-black uppercase leading-tight line-clamp-2">{siteInfo}</p>
                            </div>
                        </div>

                        {/* Nombre */}
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                <User size={12} /> Nombre Completo
                            </label>
                            <input
                                value={extractedData.nombre}
                                onChange={(e) => setExtractedData({ ...extractedData, nombre: e.target.value })}
                                className="w-full border-b-2 border-slate-100 focus:border-blue-500 p-2 font-bold text-slate-800 outline-none transition-colors"
                                placeholder="Esperando datos..."
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            {/* RUT */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                    <Hash size={12} /> RUT
                                </label>
                                <input
                                    value={extractedData.rut}
                                    onChange={(e) => setExtractedData({ ...extractedData, rut: e.target.value })}
                                    className="w-full border-b-2 border-slate-100 focus:border-blue-500 p-2 font-mono text-slate-600 outline-none transition-colors"
                                    placeholder="XX.XXX.XXX-X"
                                />
                            </div>
                            {/* Edad */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                    <Hash size={12} /> Edad
                                </label>
                                <input
                                    value={extractedData.edad}
                                    onChange={(e) => setExtractedData({ ...extractedData, edad: e.target.value })}
                                    className="w-full border-b-2 border-slate-100 focus:border-blue-500 p-2 text-slate-600 outline-none transition-colors"
                                    placeholder="-- años"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            {/* Fecha Nac */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                    <Calendar size={12} /> Fecha Nacimiento
                                </label>
                                <input
                                    value={extractedData.fechaNacimiento}
                                    onChange={(e) => setExtractedData({ ...extractedData, fechaNacimiento: e.target.value })}
                                    className="w-full border-b-2 border-slate-100 focus:border-blue-500 p-2 text-slate-600 outline-none transition-colors"
                                    placeholder="DD/MM/YYYY"
                                />
                            </div>
                            {/* Sexo Toggle */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                    <User size={12} /> Sexo
                                </label>
                                <div className="flex gap-2 pt-1">
                                    <button
                                        onClick={() => setExtractedData({ ...extractedData, sexo: 'Masculino' })}
                                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition ${extractedData.sexo === 'Masculino' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-400 border-slate-200 hover:border-blue-300'}`}
                                    >
                                        Masculino
                                    </button>
                                    <button
                                        onClick={() => setExtractedData({ ...extractedData, sexo: 'Femenino' })}
                                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition ${extractedData.sexo === 'Femenino' ? 'bg-rose-500 text-white border-rose-500' : 'bg-white text-slate-400 border-slate-200 hover:border-rose-300'}`}
                                    >
                                        Femenino
                                    </button>
                                </div>
                            </div>
                        </div>

                        {!extractedData.rut && (
                            <div className="mt-8 p-4 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-3">
                                <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                                    <Sparkles size={16} />
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-blue-800 mb-1">Módulo listo para usar</p>
                                    <p className="text-[10px] text-blue-600 leading-relaxed">
                                        Busque un colaborador o pegue texto desordenado para generar el script de llenado automático.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default SmartAutofill;
