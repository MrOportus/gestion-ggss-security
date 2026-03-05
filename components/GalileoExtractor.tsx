import React, { useState, useMemo } from 'react';
import {
    ArrowLeft, Brain, Trash2, Copy, Trash,
    Layout, Calendar, FileText, Send,
    Loader2, Table as TableIcon, CheckCircle, ClipboardList,
    Search, ChevronDown, Users
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { useAppStore } from '../store/useAppStore';

interface GalileoExtractorProps {
    onBack: () => void;
}

interface ExtractedData {
    sucursal: string;
    motivo: string;
    dias: string;
    hora_inicio: string;
    hora_termino: string;
    fecha_inicio: string;
    fecha_termino: string;
}

interface ResultRow {
    id: string;
    fHoy: string;
    fSolicitud: string;
    motivo: string;
    workerRut: string;
    workerName: string;
    workerBirthDate: string;
    sucursal: string;
    dirSucursal: string;
    cantDias: number;
    fInicio: string;
    fTermino: string;
    hInicio: string;
    hTermino: string;
}

const GalileoExtractor: React.FC<GalileoExtractorProps> = ({ onBack }) => {
    const { showNotification, employees } = useAppStore();
    const [requestDate, setRequestDate] = useState(new Date().toISOString().split('T')[0]);
    const [notificationText, setNotificationText] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [results, setResults] = useState<ResultRow[]>([]);
    const [copied, setCopied] = useState(false);

    // --- ESTADOS TRABAJADOR ---
    const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
    const [workerSearch, setWorkerSearch] = useState('');
    const [showWorkerList, setShowWorkerList] = useState(false);

    const filteredWorkers = useMemo(() => {
        if (!workerSearch) return employees.filter(e => e.isActive).slice(0, 10);
        const lower = workerSearch.toLowerCase();
        return employees.filter(e =>
            e.isActive && (
                e.firstName.toLowerCase().includes(lower) ||
                e.lastNamePaterno.toLowerCase().includes(lower) ||
                e.rut.toLowerCase().includes(lower)
            )
        ).slice(0, 10);
    }, [employees, workerSearch]);

    const handleClearInputs = () => {
        setRequestDate(new Date().toISOString().split('T')[0]);
        setNotificationText('');
        setSelectedWorkerId('');
        setWorkerSearch('');
    };

    const parseDate = (dateStr: string) => {
        const [day, month, year] = dateStr.split('/');
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    };

    const formatDate = (date: Date) => {
        const d = date.getDate().toString().padStart(2, '0');
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const y = date.getFullYear();
        return `${d}/${m}/${y}`;
    };

    const formatDateInput = (dateStr: string) => {
        const [y, m, d] = dateStr.split('-');
        return `${d}/${m}/${y}`;
    };

    const formatDateToDDMMYYYY = (isoDate?: string) => {
        if (!isoDate) return 'N/A';
        const [y, m, d] = isoDate.split('-');
        return `${d}/${m}/${y}`;
    };

    const normalizeDays = (days: string) => {
        return days.toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z, ]/g, "");
    };

    const hasFullWeekPattern = (days: string) => {
        const normalized = normalizeDays(days);
        const pattern = ["lunes", "martes", "miercoles", "jueves", "viernes"];
        return pattern.every(day => normalized.includes(day));
    };

    const processExtraction = async () => {
        if (!notificationText.trim()) {
            showNotification("Por favor pegue el texto de la notificación.", "warning");
            return;
        }

        const worker = employees.find(e => e.id === selectedWorkerId);
        if (!worker) {
            showNotification("Por favor seleccione un colaborador de la lista.", "warning");
            return;
        }

        setIsProcessing(true);
        try {
            const apiKey = (import.meta as any).env?.VITE_API_KEY;
            if (!apiKey) {
                showNotification("No se encontró la API KEY de Gemini.", "error");
                setIsProcessing(false);
                return;
            }

            const ai = new GoogleGenAI({ apiKey });

            const prompt = `Actúa como un extractor de datos de turnos laborales. 
Del siguiente texto de notificación, extrae los siguientes datos en un formato JSON estricto:
- sucursal: Nombre de la sucursal (Si menciona "CHILLÁN TIENDA", extráelo textualmente).
- motivo: Razón del turno (ej: Reemplazo, Vacaciones, etc).
- dias: Lista de días mencionados (ej: "Lunes, Martes, Miércoles, Jueves, Viernes").
- hora_inicio: Hora de inicio en formato HH:MM.
- hora_termino: Hora de término en formato HH:MM.
- fecha_inicio: Fecha de inicio del rango en formato DD/MM/YYYY.
- fecha_termino: Fecha de término del rango en formato DD/MM/YYYY.

Texto:
${notificationText}

Responde ÚNICAMENTE el JSON sin markdown.`;

            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: [{ text: prompt }],
                config: { responseMimeType: 'application/json' }
            });

            const extracted = JSON.parse(response.text || "{}") as ExtractedData;

            const today = formatDate(new Date());
            const fSolStr = formatDateInput(requestDate);

            const workerRut = worker.rut;
            const workerName = `${worker.firstName} ${worker.lastNamePaterno}`.toUpperCase();
            const workerBirthDate = formatDateToDDMMYYYY(worker.fechaNacimiento);

            let newRows: ResultRow[] = [];

            const normalizedDaysStr = normalizeDays(extracted.dias);
            const requestedDayNames = normalizedDaysStr.split(',').map(s => s.trim());
            const dayMap: { [key: string]: number } = {
                "domingo": 0, "lunes": 1, "martes": 2, "miercoles": 3, "jueves": 4, "viernes": 5, "sabado": 6
            };
            const activeDayNumbers = requestedDayNames.map(name => dayMap[name]).filter(n => n !== undefined);
            const includesSat = requestedDayNames.includes("sabado");
            const includesSun = requestedDayNames.includes("domingo");

            const startDate = parseDate(extracted.fecha_inicio);
            const endDate = parseDate(extracted.fecha_termino);

            const createRow = (start: Date, end: Date, count: number): ResultRow => ({
                id: Math.random().toString(36).substr(2, 9),
                fHoy: today,
                fSolicitud: fSolStr,
                motivo: extracted.motivo,
                workerRut,
                workerName,
                workerBirthDate,
                sucursal: extracted.sucursal,
                dirSucursal: 'vacío',
                cantDias: count,
                fInicio: formatDate(start),
                fTermino: formatDate(end),
                hInicio: extracted.hora_inicio,
                hTermino: extracted.hora_termino
            });

            if (hasFullWeekPattern(extracted.dias)) {
                // Algoritmo de desglose por bloques semanales (Lunes a Viernes)
                let currentBlock: Date[] = [];
                let tempDate = new Date(startDate);

                while (tempDate <= endDate) {
                    const dow = tempDate.getDay();
                    if (dow >= 1 && dow <= 5) {
                        currentBlock.push(new Date(tempDate));
                    } else {
                        if (currentBlock.length > 0) {
                            newRows.push(createRow(currentBlock[0], currentBlock[currentBlock.length - 1], currentBlock.length));
                            currentBlock = [];
                        }
                    }
                    tempDate.setDate(tempDate.getDate() + 1);
                }

                if (currentBlock.length > 0) {
                    newRows.push(createRow(currentBlock[0], currentBlock[currentBlock.length - 1], currentBlock.length));
                }
            } else {
                // Nuevo algoritmo: Desglose por días, con agrupación especial Sábado+Domingo
                let tempDate = new Date(startDate);
                while (tempDate <= endDate) {
                    const dow = tempDate.getDay();

                    if (activeDayNumbers.includes(dow)) {
                        let fInicio = new Date(tempDate);
                        let fTermino = new Date(tempDate);
                        let cantDias = 1;

                        // Agrupación Sábado + Domingo: Si hoy es Sábado y se solicitan ambos
                        if (dow === 6 && includesSat && includesSun) {
                            const nextDay = new Date(tempDate);
                            nextDay.setDate(nextDay.getDate() + 1);
                            if (nextDay <= endDate) {
                                fTermino = nextDay;
                                cantDias = 2;
                                tempDate.setDate(tempDate.getDate() + 1); // Saltar el domingo
                            }
                        }

                        newRows.push(createRow(fInicio, fTermino, cantDias));
                    }
                    tempDate.setDate(tempDate.getDate() + 1);
                }
            }

            // Agregar al principio (LIFO)
            setResults(prev => [...newRows, ...prev]);
            showNotification("Datos extraídos correctamente.", "success");
        } catch (error) {
            console.error("Error extraction:", error);
            showNotification("Error al procesar con IA. Verifique el formato del texto.", "error");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDeleteRow = (id: string) => {
        setResults(prev => prev.filter(r => r.id !== id));
    };

    const handleClearAll = () => {
        setResults([]);
    };

    const handleCopyTable = async () => {
        if (results.length === 0) return;

        const headers = ["FECHA HOY", "F. SOLICITUD", "MOTIVO SOLICITUD", "SUCURSAL", "DIR. SUCURSAL", "F. INICIO", "F. TERMINO", "H. INICIO", "H. TERMINO", "RUT", "NOMBRE DE GUARDIA", "FECHA DE NACIMIENTO"];
        const rows = results.map(r => [
            r.fHoy, r.fSolicitud, r.motivo, r.sucursal, r.dirSucursal, r.fInicio, r.fTermino, r.hInicio, r.hTermino, r.workerRut, r.workerName, r.workerBirthDate
        ]);

        const tsvContent = [
            headers.join('\t'),
            ...rows.map(row => row.join('\t'))
        ].join('\n');

        try {
            await navigator.clipboard.writeText(tsvContent);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            showNotification("Tabla copiada al portapapeles (Formato Excel).", "success");
        } catch (err) {
            console.error("Error copy:", err);
            showNotification("Error al copiar la tabla.", "error");
        }
    };

    return (
        <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6 max-w-[1400px] mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center text-white shadow-lg shadow-blue-200">
                            <ClipboardList size={22} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">Extractor de Turnos Galileo</h2>
                            <p className="text-sm text-slate-500">Procesamiento inteligente para Excel</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Panel Izquierdo: Inputs */}
                <div className="lg:col-span-4 space-y-6">
                    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-xl shadow-slate-200/50">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-2">
                                <FileText className="text-blue-500" size={18} />
                                <h3 className="font-bold text-slate-800">Datos de la Solicitud</h3>
                            </div>
                            <button
                                onClick={handleClearInputs}
                                className="text-xs font-medium text-slate-400 hover:text-blue-500 transition"
                            >
                                Limpiar
                            </button>
                        </div>

                        <div className="space-y-4">
                            {/* Colaborador Selection */}
                            <div className="relative">
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                    Seleccionar Colaborador
                                </label>
                                <div className="relative">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        type="text"
                                        className="w-full pl-11 pr-10 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition text-slate-700 font-medium"
                                        placeholder="Buscar por nombre o RUT..."
                                        value={workerSearch}
                                        onChange={(e) => {
                                            setWorkerSearch(e.target.value);
                                            setShowWorkerList(true);
                                            setSelectedWorkerId('');
                                        }}
                                        onFocus={() => {
                                            setWorkerSearch('');
                                            setShowWorkerList(true);
                                        }}
                                        onBlur={() => {
                                            setTimeout(() => {
                                                if (!workerSearch && selectedWorkerId) {
                                                    const w = employees.find(e => e.id === selectedWorkerId);
                                                    if (w) setWorkerSearch(`${w.firstName} ${w.lastNamePaterno}`);
                                                }
                                                setShowWorkerList(false);
                                            }, 200);
                                        }}
                                    />
                                    <button
                                        type="button"
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-blue-500 transition"
                                        onClick={() => setShowWorkerList(!showWorkerList)}
                                    >
                                        <ChevronDown size={18} />
                                    </button>
                                </div>

                                {showWorkerList && (
                                    <div className="absolute z-30 w-full mt-2 bg-white border border-slate-100 rounded-2xl shadow-2xl max-h-60 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
                                        {filteredWorkers.map(emp => (
                                            <button
                                                key={emp.id}
                                                className="w-full px-5 py-3 hover:bg-blue-50 text-left border-b border-slate-50 last:border-0 transition-colors flex items-center gap-3"
                                                onClick={() => {
                                                    setSelectedWorkerId(emp.id);
                                                    setWorkerSearch(`${emp.firstName} ${emp.lastNamePaterno}`);
                                                    setShowWorkerList(false);
                                                }}
                                            >
                                                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                                                    <Users size={16} />
                                                </div>
                                                <div>
                                                    <div className="text-sm font-bold text-slate-700">{emp.firstName} {emp.lastNamePaterno}</div>
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{emp.rut} • {emp.cargo}</div>
                                                </div>
                                            </button>
                                        ))}
                                        {filteredWorkers.length === 0 && (
                                            <div className="px-5 py-4 text-xs text-slate-400 italic text-center">No se encontraron colaboradores activos</div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                    Fecha de Solicitud de Servicio
                                </label>
                                <div className="relative">
                                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        type="date"
                                        value={requestDate}
                                        onChange={(e) => setRequestDate(e.target.value)}
                                        className="w-full pl-11 pr-4 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition text-slate-700 font-medium"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                    Texto de la Notificación
                                </label>
                                <textarea
                                    value={notificationText}
                                    onChange={(e) => setNotificationText(e.target.value)}
                                    placeholder="Pegue aquí el contenido del correo o notificación..."
                                    className="w-full h-80 p-5 bg-slate-50 border border-slate-100 rounded-3xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition text-slate-700 font-medium resize-none leading-relaxed"
                                />
                            </div>

                            <button
                                onClick={processExtraction}
                                disabled={isProcessing}
                                className="w-full flex items-center justify-center gap-2 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-2xl font-bold shadow-lg shadow-blue-200 transition-all transform active:scale-[0.98]"
                            >
                                {isProcessing ? (
                                    <>
                                        <Loader2 className="animate-spin" size={20} />
                                        <span>Procesando...</span>
                                    </>
                                ) : (
                                    <>
                                        <Send size={20} />
                                        <span>Extraer Datos</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Panel Derecho: Resultados */}
                <div className="lg:col-span-8">
                    <div className="bg-white rounded-3xl border border-slate-100 shadow-xl shadow-slate-200/50 overflow-hidden flex flex-col h-full min-h-[600px]">
                        {/* Header de Resultados */}
                        <div className="p-6 border-b border-slate-50 bg-white/80 backdrop-blur-md flex items-center justify-between sticky top-0 z-10">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center text-green-600">
                                    <TableIcon size={20} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-800">Tabla para Excel</h3>
                                    <p className="text-xs text-slate-500">{results.length} registros listos</p>
                                </div>
                            </div>

                            {results.length > 0 && (
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={handleClearAll}
                                        type="button"
                                        className="flex items-center gap-2 px-4 py-2.5 text-red-500 hover:bg-red-50 rounded-xl font-bold text-sm transition-colors border border-transparent hover:border-red-100"
                                    >
                                        <Trash size={16} />
                                        Borrar Todo
                                    </button>
                                    <button
                                        onClick={handleCopyTable}
                                        className={`flex items-center gap-2 px-6 py-2.5 ${copied ? 'bg-green-600' : 'bg-slate-900'} text-white rounded-xl font-bold text-sm shadow-md transition-all active:scale-95`}
                                    >
                                        {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
                                        {copied ? '¡Copiado!' : 'Copiar'}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Contenido / Tabla */}
                        <div className="flex-1 overflow-auto">
                            {results.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-center p-12">
                                    <div className="w-32 h-32 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                                        <Layout className="text-slate-200" size={48} />
                                    </div>
                                    <h4 className="text-lg font-bold text-slate-400 mb-2">No hay datos procesados</h4>
                                    <p className="text-slate-400 max-w-xs text-sm">
                                        Seleccione un colaborador, pegue una notificación y presione "Extraer Datos" para comenzar.
                                    </p>
                                </div>
                            ) : (
                                <div className="min-w-full inline-block align-middle">
                                    <table className="min-w-full divide-y divide-slate-100">
                                        <thead>
                                            <tr className="bg-slate-50/50">
                                                <th className="px-5 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Fecha Hoy</th>
                                                <th className="px-5 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">F. Solicitud</th>
                                                <th className="px-5 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Motivo</th>
                                                <th className="px-5 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Sucursal</th>
                                                <th className="px-5 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Dirección</th>
                                                <th className="px-5 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">F. Inicio</th>
                                                <th className="px-5 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">F. Término</th>
                                                <th className="px-5 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">H. Inicio</th>
                                                <th className="px-5 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">H. Término</th>
                                                <th className="px-5 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Rut guardia</th>
                                                <th className="px-5 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Nombre guardia</th>
                                                <th className="px-5 py-4 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Fecha nacimiento</th>
                                                <th className="px-5 py-4 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 bg-white">
                                            {results.map((row) => (
                                                <tr key={row.id} className="hover:bg-blue-50/30 transition-colors group">
                                                    <td className="px-5 py-4 whitespace-nowrap text-sm font-medium text-slate-600">{row.fHoy}</td>
                                                    <td className="px-5 py-4 whitespace-nowrap text-sm font-medium text-slate-600">{row.fSolicitud}</td>
                                                    <td className="px-5 py-4 whitespace-nowrap text-sm font-medium text-slate-700">{row.motivo}</td>
                                                    <td className="px-5 py-4 whitespace-nowrap text-sm font-bold text-blue-600">{row.sucursal}</td>
                                                    <td className="px-5 py-4 whitespace-nowrap text-sm text-slate-400 italic">vacío</td>
                                                    <td className="px-5 py-4 whitespace-nowrap text-sm font-medium text-slate-600">{row.fInicio}</td>
                                                    <td className="px-5 py-4 whitespace-nowrap text-sm font-medium text-slate-600">{row.fTermino}</td>
                                                    <td className="px-5 py-4 whitespace-nowrap text-sm font-medium text-slate-600">{row.hInicio}</td>
                                                    <td className="px-5 py-4 whitespace-nowrap text-sm font-medium text-slate-600">{row.hTermino}</td>
                                                    <td className="px-5 py-4 whitespace-nowrap text-sm font-bold text-slate-600">{row.workerRut}</td>
                                                    <td className="px-5 py-4 whitespace-nowrap text-sm font-bold text-slate-800">{row.workerName}</td>
                                                    <td className="px-5 py-4 whitespace-nowrap text-sm text-slate-600">{row.workerBirthDate}</td>
                                                    <td className="px-5 py-4 whitespace-nowrap text-center">
                                                        <button
                                                            onClick={() => handleDeleteRow(row.id)}
                                                            className="p-2 text-slate-300 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 opacity-0 group-hover:opacity-100"
                                                        >
                                                            <Trash2 size={18} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* Pie de tabla para scroll horizontal si fuera necesario */}
                        <div className="h-2 bg-slate-50/50"></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GalileoExtractor;
