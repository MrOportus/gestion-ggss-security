import React, { useState, useRef } from 'react';
import {
    ArrowLeft, Mail, Clipboard, Copy, Trash, Trash2,
    CheckCircle, Table as TableIcon, Layout, AlertCircle,
    FileSpreadsheet, RefreshCw, Info
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

interface EmailExtractorProps {
    onBack: () => void;
}

// ─── Tipos internos ───────────────────────────────────────────────────────────
interface ParsedRow {
    id: string;
    supervisorSolicitante: string;
    fechaSolicitud: string;
    motivoSolicitud: string;
    sucursal: string;
    direccionSucursal: string;
    cantDias: string;
    fechaInicioServicio: string;
    fechaTerminoServicio: string;
    horaInicioServicio: string;
    horaTerminoServicio: string;
    dia: string;
    noche: string;
    horasDia: string;
    horasNoche: string;
    calculoHoras: string;
    horasEfectivas: string;
    valorHora: string;
    costoTotal: string;
    rutGuardia: string;
    nombreGuardia: string;
    fechaNacimiento: string;
    sexo: string;
}

// ─── Columnas de salida ───────────────────────────────────────────────────────
const OUTPUT_HEADERS: { key: keyof Omit<ParsedRow, 'id'>; label: string }[] = [
    { key: 'supervisorSolicitante',  label: 'Supervisor Solicitante' },
    { key: 'fechaSolicitud',         label: 'Fecha de solicitud de servicio' },
    { key: 'motivoSolicitud',        label: 'Motivo Solicitud' },
    { key: 'sucursal',               label: 'Sucursal' },
    { key: 'direccionSucursal',      label: 'Dirección Sucursal' },
    { key: 'cantDias',               label: 'Cant Días' },
    { key: 'fechaInicioServicio',    label: 'Fecha Inicio Servicio' },
    { key: 'fechaTerminoServicio',   label: 'Fecha Termino Servicio' },
    { key: 'horaInicioServicio',     label: 'Hora Inicio Servicio' },
    { key: 'horaTerminoServicio',    label: 'Hora Termino Servicio' },
    { key: 'dia',                    label: 'Día' },
    { key: 'noche',                  label: 'Noche' },
    { key: 'horasDia',               label: 'Horas Día' },
    { key: 'horasNoche',             label: 'Horas Noche' },
    { key: 'calculoHoras',           label: 'Cálculo Horas' },
    { key: 'horasEfectivas',         label: 'Horas Efectivas Trabajadas' },
    { key: 'valorHora',              label: 'Valor Hora' },
    { key: 'costoTotal',             label: 'Costo Total Horas' },
    { key: 'rutGuardia',             label: 'Rut Guardia Seguridad' },
    { key: 'nombreGuardia',          label: 'Nombre Guardia Seguridad' },
    { key: 'fechaNacimiento',        label: 'Fecha de Nacimiento' },
    { key: 'sexo',                   label: 'Sexo' },
];

// ─── Normalización de encabezados para mapeo ─────────────────────────────────
const normalizeHeader = (h: string) =>
    h.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 ]/g, '')
        .trim();

/** Mapea un encabezado de entrada a la clave interna correspondiente */
const mapHeaderToKey = (raw: string): keyof Omit<ParsedRow, 'id'> | null => {
    const n = normalizeHeader(raw);

    if (n.includes('supervisor')) return 'supervisorSolicitante';
    if (n.includes('fecha') && n.includes('solicitud')) return 'fechaSolicitud';
    if (n.includes('motivo')) return 'motivoSolicitud';
    if (n.includes('sucursal') && !n.includes('direccion') && !n.includes('dir')) return 'sucursal';
    if (n.includes('direccion') || (n.includes('dir') && n.includes('sucursal'))) return 'direccionSucursal';
    if (n.includes('cant') && n.includes('dia')) return 'cantDias';
    if (n.includes('fecha') && n.includes('inicio')) return 'fechaInicioServicio';
    if (n.includes('fecha') && n.includes('termino')) return 'fechaTerminoServicio';
    if (n.includes('hora') && n.includes('inicio')) return 'horaInicioServicio';
    if (n.includes('hora') && n.includes('termino')) return 'horaTerminoServicio';
    if ((n.includes('rut') || n.includes('rut guardia'))) return 'rutGuardia';
    if (n.includes('nombre') && (n.includes('guardia') || n.includes('guard'))) return 'nombreGuardia';
    if ((n.includes('fecha') && n.includes('nacimiento')) || n === 'fecha de nacimiento') return 'fechaNacimiento';
    if (n === 'sexo' || n === 'genero') return 'sexo';
    // campos que la entrada puede traer pero descartamos (zona, proveedor)
    return null;
};

// ─── Crear fila vacía ─────────────────────────────────────────────────────────
const emptyRow = (): ParsedRow => ({
    id: Math.random().toString(36).substr(2, 9),
    supervisorSolicitante: '',
    fechaSolicitud: '',
    motivoSolicitud: '',
    sucursal: '',
    direccionSucursal: '',
    cantDias: '',
    fechaInicioServicio: '',
    fechaTerminoServicio: '',
    horaInicioServicio: '',
    horaTerminoServicio: '',
    dia: '',
    noche: '',
    horasDia: '',
    horasNoche: '',
    calculoHoras: '',
    horasEfectivas: '',
    valorHora: '',
    costoTotal: '',
    rutGuardia: '',
    nombreGuardia: '',
    fechaNacimiento: '',
    sexo: '',
});

// ─── Parser principal ─────────────────────────────────────────────────────────
/**
 * Detecta si la entrada es:
 *   - Formato 1: una sola columna con "Etiqueta\nValor" por línea
 *   - Formato 2: tabla horizontal TSV (columnas separadas por TAB)
 * Soporta múltiples filas en ambos formatos.
 */
function parseInput(raw: string): ParsedRow[] {
    const text = raw.trim();
    if (!text) return [];

    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');

    // ── Detectar formato 2 (TSV): si la primera línea tiene TABs, es horizontal
    if (lines[0].includes('\t')) {
        return parseHorizontalFormat(lines);
    }

    // ── Detectar formato 1 vertical: la primera línea NO tiene TAB
    // Se separa en bloques por línea en blanco o se asume etiqueta / valor alternados
    return parseVerticalFormat(lines);
}

/**
 * Formato 2: La primera fila es encabezado (separado por TABs), resto son datos.
 */
function parseHorizontalFormat(lines: string[]): ParsedRow[] {
    const headerLine = lines[0];
    const headers = headerLine.split('\t').map(h => h.trim());
    const results: ParsedRow[] = [];

    for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split('\t').map(c => c.trim());
        if (cells.every(c => c === '')) continue;
        const row = emptyRow();
        headers.forEach((hdr, idx) => {
            const key = mapHeaderToKey(hdr);
            if (key && cells[idx] !== undefined) {
                (row as any)[key] = cells[idx];
            }
        });
        results.push(row);
    }
    return results;
}

/**
 * Formato 1: Bloques verticales etiqueta / valor.
 * Múltiples registros se separan por una línea que vuelve a repetir el primer encabezado
 * ("Supervisor Solicitante") o por líneas en blanco.
 */
function parseVerticalFormat(lines: string[]): ParsedRow[] {
    // Identificar si las líneas están en formato ETIQUETA\nVALOR\nETIQUETA\nVALOR...
    // o bloques ETIQUETA\n\nVALOR (con línea en blanco entre etiqueta y valor)
    // 
    // Estrategia: buscar el índice de la primera ocurrencia del encabezado "supervisor"
    // cada vez que aparezca => inicio de nuevo bloque.

    const supervisorNorm = 'supervisor solicitante';

    // Encontrar todos los índices donde empieza un nuevo registro
    const blockStarts: number[] = [];
    lines.forEach((l, i) => {
        const n = normalizeHeader(l);
        if (n === 'supervisor solicitante' || n === 'supervisor') {
            blockStarts.push(i);
        }
    });

    if (blockStarts.length === 0) {
        // Sin encabezado reconocible → intentar parsear como bloques alternados
        return [parseSingleVerticalBlock(lines)];
    }

    const results: ParsedRow[] = [];

    blockStarts.forEach((start, idx) => {
        const end = blockStarts[idx + 1] ?? lines.length;
        const blockLines = lines.slice(start, end);
        results.push(parseSingleVerticalBlock(blockLines));
    });

    return results;
}

/**
 * Procesa un bloque vertical (etiqueta, valor, etiqueta, valor…)
 * Las etiquetas se reconocen por el mapeo de headers.
 */
function parseSingleVerticalBlock(lines: string[]): ParsedRow {
    const row = emptyRow();
    let i = 0;

    while (i < lines.length) {
        const line = lines[i].trim();
        const key = mapHeaderToKey(line);

        if (key !== null) {
            // El valor es la siguiente línea que no sea un encabezado conocido
            let valueLines: string[] = [];
            i++;
            while (i < lines.length && mapHeaderToKey(lines[i].trim()) === null) {
                const val = lines[i].trim();
                if (val !== '') valueLines.push(val);
                i++;
            }
            (row as any)[key] = valueLines.join(' ').trim();
        } else {
            i++;
        }
    }

    return row;
}

// ─── Componente ──────────────────────────────────────────────────────────────
const EmailExtractor: React.FC<EmailExtractorProps> = ({ onBack }) => {
    const { showNotification } = useAppStore();
    const [inputText, setInputText] = useState('');
    const [results, setResults] = useState<ParsedRow[]>([]);
    const [copied, setCopied] = useState(false);
    const [parseError, setParseError] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // ── Procesamiento ────────────────────────────────────────────────────────
    const handleProcess = () => {
        setParseError('');
        if (!inputText.trim()) {
            showNotification('Por favor pegue el contenido del correo.', 'warning');
            return;
        }
        try {
            const parsed = parseInput(inputText);
            if (parsed.length === 0) {
                setParseError('No se pudo reconocer ningún dato. Verifique el formato de entrada.');
                return;
            }
            setResults(prev => [...parsed, ...prev]);
            showNotification(`${parsed.length} fila(s) extraída(s) correctamente.`, 'success');
            setInputText('');
        } catch (err) {
            console.error('EmailExtractor parse error:', err);
            setParseError('Ocurrió un error al procesar la entrada. Verifique el formato.');
        }
    };

    const handleDeleteRow = (id: string) => setResults(prev => prev.filter(r => r.id !== id));
    const handleClearAll = () => { setResults([]); setParseError(''); };
    const handleClearInput = () => { setInputText(''); setParseError(''); };

    // ── Copiar para Excel (TSV) ──────────────────────────────────────────────
    const handleCopyTable = async () => {
        if (results.length === 0) return;
        const rows = results.map(r =>
            OUTPUT_HEADERS.map(h => (r as any)[h.key] ?? '')
        );
        const tsv = rows.map(row => row.join('\t')).join('\n');
        try {
            await navigator.clipboard.writeText(tsv);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
            showNotification('Tabla copiada al portapapeles (formato Excel).', 'success');
        } catch {
            showNotification('Error al copiar. Intente nuevamente.', 'error');
        }
    };

    // ── Pegar desde portapapeles ─────────────────────────────────────────────
    const handlePasteFromClipboard = async () => {
        try {
            const text = await navigator.clipboard.readText();
            setInputText(text);
            textareaRef.current?.focus();
        } catch {
            showNotification('No se pudo leer el portapapeles. Pegue el texto manualmente.', 'warning');
        }
    };

    return (
        <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6 max-w-[1600px] mx-auto">

            {/* ── Header ─────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                            <Mail size={22} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">Extractor de Correos a Planilla</h2>
                            <p className="text-sm text-slate-500">Convierte tablas de correo Gmail al formato Excel</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                {/* ── Panel Izquierdo: Entrada ────────────────────────────── */}
                <div className="lg:col-span-4 space-y-4">
                    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-xl shadow-slate-200/50">
                        <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-2">
                                <Clipboard className="text-indigo-500" size={18} />
                                <h3 className="font-bold text-slate-800">Datos de Entrada</h3>
                            </div>
                            <button
                                onClick={handleClearInput}
                                className="text-xs font-medium text-slate-400 hover:text-indigo-500 transition"
                            >
                                Limpiar
                            </button>
                        </div>

                        {/* Formatos soportados */}
                        <div className="mb-4 p-3 bg-indigo-50 rounded-2xl border border-indigo-100">
                            <div className="flex items-start gap-2">
                                <Info size={15} className="text-indigo-400 mt-0.5 shrink-0" />
                                <div className="text-xs text-indigo-600 font-medium leading-relaxed">
                                    <p className="font-bold mb-1">Formatos soportados:</p>
                                    <p>• <strong>Vertical:</strong> Etiqueta sobre valor (correo Gmail vista vertical)</p>
                                    <p>• <strong>Horizontal:</strong> Tabla con encabezados separados por Tab</p>
                                    <p className="mt-1 text-indigo-500">Soporta 1 o múltiples registros.</p>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                    Pegar contenido del correo
                                </label>
                                <textarea
                                    ref={textareaRef}
                                    value={inputText}
                                    onChange={e => { setInputText(e.target.value); setParseError(''); }}
                                    placeholder={"Pegue aquí la tabla del correo Gmail...\n\nFormato 1 (vertical):\nSupervisor Solicitante\nJuan Pérez\nFecha de solicitud de servicio\n12/06/2026\n...\n\nFormato 2 (horizontal con TABs):\nSupervisor\tFecha...\nJuan Pérez\t12/06/2026..."}
                                    className="w-full h-72 p-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition text-slate-700 font-mono text-xs resize-none leading-relaxed"
                                />
                            </div>

                            {parseError && (
                                <div className="flex items-start gap-2 p-3 bg-red-50 rounded-xl border border-red-100">
                                    <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                                    <p className="text-xs text-red-600 font-medium">{parseError}</p>
                                </div>
                            )}

                            <button
                                onClick={handlePasteFromClipboard}
                                className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 rounded-xl font-medium text-sm transition"
                            >
                                <Clipboard size={16} />
                                Pegar desde portapapeles
                            </button>

                            <button
                                onClick={handleProcess}
                                disabled={!inputText.trim()}
                                className="w-full flex items-center justify-center gap-2 py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-200 disabled:cursor-not-allowed text-white rounded-2xl font-bold shadow-lg shadow-indigo-200 transition-all transform active:scale-[0.98]"
                            >
                                <FileSpreadsheet size={20} />
                                <span>Extraer a Planilla</span>
                            </button>
                        </div>
                    </div>

                    {/* Info de columnas de salida */}
                    <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xl shadow-slate-200/50">
                        <div className="flex items-center gap-2 mb-3">
                            <TableIcon size={16} className="text-slate-400" />
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Columnas de salida</h3>
                        </div>
                        <div className="space-y-1">
                            {OUTPUT_HEADERS.map((h, i) => (
                                <div key={h.key} className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-slate-300 w-5 text-right">{i + 1}</span>
                                    <span className="text-xs text-slate-500 truncate">{h.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ── Panel Derecho: Resultados ───────────────────────────── */}
                <div className="lg:col-span-8">
                    <div className="bg-white rounded-3xl border border-slate-100 shadow-xl shadow-slate-200/50 overflow-hidden flex flex-col min-h-[600px]">

                        {/* Header resultados */}
                        <div className="p-5 border-b border-slate-50 bg-white/80 backdrop-blur-md flex items-center justify-between sticky top-0 z-10">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                                    <TableIcon size={20} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-800">Tabla para Excel</h3>
                                    <p className="text-xs text-slate-500">
                                        {results.length === 0 ? 'Sin registros aún' : `${results.length} fila${results.length > 1 ? 's' : ''} listas`}
                                    </p>
                                </div>
                            </div>

                            {results.length > 0 && (
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleClearAll}
                                        className="flex items-center gap-2 px-3 py-2 text-red-500 hover:bg-red-50 rounded-xl font-bold text-xs transition border border-transparent hover:border-red-100"
                                    >
                                        <Trash size={14} />
                                        Borrar Todo
                                    </button>
                                    <button
                                        onClick={handleCopyTable}
                                        className={`flex items-center gap-2 px-5 py-2 ${copied ? 'bg-emerald-600' : 'bg-slate-900'} text-white rounded-xl font-bold text-sm shadow-md transition-all active:scale-95`}
                                    >
                                        {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
                                        {copied ? '¡Copiado!' : 'Copiar para Excel'}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Tabla / Estado vacío */}
                        <div className="flex-1 overflow-auto">
                            {results.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-center p-12 min-h-[400px]">
                                    <div className="w-28 h-28 bg-slate-50 rounded-full flex items-center justify-center mb-5">
                                        <Layout className="text-slate-200" size={44} />
                                    </div>
                                    <h4 className="text-lg font-bold text-slate-400 mb-2">Sin datos procesados</h4>
                                    <p className="text-slate-400 max-w-xs text-sm leading-relaxed">
                                        Pegue el contenido de la tabla del correo Gmail y presione <strong>"Extraer a Planilla"</strong> para generar las filas.
                                    </p>
                                </div>
                            ) : (
                                <div className="min-w-full inline-block align-middle">
                                    <table className="min-w-full divide-y divide-slate-100">
                                        <thead>
                                            <tr className="bg-slate-50/80">
                                                {OUTPUT_HEADERS.map(h => (
                                                    <th
                                                        key={h.key}
                                                        className="px-4 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap"
                                                    >
                                                        {h.label}
                                                    </th>
                                                ))}
                                                <th className="px-4 py-3 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                                    ×
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 bg-white">
                                            {results.map((row, rowIdx) => (
                                                <tr
                                                    key={row.id}
                                                    className={`hover:bg-indigo-50/30 transition-colors group ${rowIdx % 2 === 1 ? 'bg-slate-50/40' : ''}`}
                                                >
                                                    {OUTPUT_HEADERS.map(h => {
                                                        const val = (row as any)[h.key] as string;
                                                        const isEmpty = !val;
                                                        return (
                                                            <td
                                                                key={h.key}
                                                                className={`px-4 py-3 whitespace-nowrap text-sm ${isEmpty ? 'text-slate-300 italic' : 'text-slate-700 font-medium'}`}
                                                            >
                                                                {isEmpty ? '—' : val}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="px-4 py-3 whitespace-nowrap text-center">
                                                        <button
                                                            onClick={() => handleDeleteRow(row.id)}
                                                            className="p-1.5 text-slate-300 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 opacity-0 group-hover:opacity-100"
                                                        >
                                                            <Trash2 size={15} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        <div className="h-2 bg-slate-50/50" />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EmailExtractor;
