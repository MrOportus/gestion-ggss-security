import React, { useState, useCallback } from 'react';
import {
    X, Save, Plus, Trash2, GripVertical, ArrowLeft, AlertTriangle, Loader2,
    ChevronDown, ChevronUp, Copy, Settings, Zap, PenTool,
    AlignLeft, Type, Calendar, CheckSquare, Minus, Scissors, Table, Image, Heading1, Heading2, ArrowDownUp
} from 'lucide-react';
import { DocumentTemplate, TemplateBloque, TipoBloqueTemplate } from '../../types';
import { useAppStore } from '../../store/useAppStore';

// ─── Utilidades ───────────────────────────────────────────────────────────────
const genId = () => `blk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

export const CAMPOS_AUTOMATICOS = [
    { key: 'trabajador.nombre', label: 'Nombre Completo' },
    { key: 'trabajador.rut', label: 'RUT' },
    { key: 'trabajador.cargo', label: 'Cargo' },
    { key: 'trabajador.email', label: 'Correo Electrónico' },
    { key: 'trabajador.sucursal', label: 'Sucursal / Faena' },
    { key: 'trabajador.empresa', label: 'Empresa' },
    { key: 'trabajador.talleCalzado', label: 'Talle Calzado' },
    { key: 'trabajador.tallePantalon', label: 'Talle Pantalón' },
    { key: 'trabajador.talleCamisa', label: 'Talle Camisa' },
    { key: 'trabajador.talleChaqueta', label: 'Talle Chaqueta' },
    { key: 'trabajador.tallePolar', label: 'Talle Polar' },
    { key: 'trabajador.talleGeologo', label: 'Talle Geólogo' },
    { key: 'documento.fecha', label: 'Fecha del Documento' },
];

const TIPO_META: Record<TipoBloqueTemplate, { label: string; color: string }> = {
    encabezado_iso:   { label: 'Encabezado ISO',    color: 'text-indigo-600 bg-indigo-50' },
    corte:            { label: 'Línea de Corte',    color: 'text-red-500 bg-red-50' },
    titulo:           { label: 'Título',             color: 'text-indigo-600 bg-indigo-50' },
    subtitulo:        { label: 'Subtítulo',          color: 'text-blue-600 bg-blue-50' },
    texto:            { label: 'Texto',              color: 'text-slate-600 bg-slate-100' },
    imagen:           { label: 'Imagen/Logo',        color: 'text-green-600 bg-green-50' },
    campo_automatico: { label: 'Campo Auto',         color: 'text-amber-600 bg-amber-50' },
    campo_manual:     { label: 'Campo Manual',       color: 'text-purple-600 bg-purple-50' },
    fecha:            { label: 'Fecha',              color: 'text-teal-600 bg-teal-50' },
    tabla:            { label: 'Tabla',              color: 'text-orange-600 bg-orange-50' },
    checkbox:         { label: 'Checkbox',           color: 'text-pink-600 bg-pink-50' },
    firma:            { label: 'Firma',              color: 'text-blue-700 bg-blue-100' },
    linea:            { label: 'Línea',              color: 'text-slate-500 bg-slate-50' },
    espaciador:       { label: 'Espaciador',         color: 'text-slate-400 bg-slate-50' },
    checklist_2col:   { label: 'Checklist 2 Col.',   color: 'text-cyan-700 bg-cyan-50' },
    dotacion_personal:{ label: 'Dotación Personal',  color: 'text-emerald-700 bg-emerald-50' },
};


const BLOQUES_DISPONIBLES: TipoBloqueTemplate[] = [
    'encabezado_iso', 'titulo', 'subtitulo', 'texto', 'imagen',
    'campo_automatico', 'campo_manual', 'fecha',
    'tabla', 'checkbox', 'checklist_2col', 'dotacion_personal', 'firma', 'linea', 'corte', 'espaciador',
];

// ─── Render de bloque en canvas A4 ───────────────────────────────────────────
const BloqueCanvas: React.FC<{
    bloque: TemplateBloque;
    isSelected: boolean;
    isDragging: boolean;
    onSelect: () => void;
    onDelete: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
}> = ({ bloque, isSelected, isDragging, onSelect, onDelete, onMoveUp, onMoveDown }) => {
    const meta = TIPO_META[bloque.tipo];
    const align = (bloque.alineacion || 'left') as React.CSSProperties['textAlign'];
    const fw = bloque.negrita ? 'bold' : 'normal';
    const fi = bloque.cursiva ? 'italic' : 'normal';
    const fs = bloque.fontSize ? `${bloque.fontSize}px` : undefined;

    const ptToPx = (pt?: number, def = 12) => `${Math.round((pt || def) * 1.666)}px`;

    const renderContenido = () => {
        switch (bloque.tipo) {
            case 'encabezado_iso':
                return (
                    <div className="w-full border border-black text-[10px] sm:text-xs">
                        <div className="flex border-b border-black">
                            <div className="w-1/4 flex items-center justify-center border-r border-black p-2">
                                <img src={bloque.imageUrl || '/logo.png'} alt="Logo" style={{ width: ptToPx(bloque.imageWidth, 80) }} className="object-contain" />
                            </div>
                            <div className="w-2/4 flex flex-col items-center justify-center border-r border-black p-2 text-center">
                                <div className="font-bold mb-1">{bloque.tituloSistema || 'SGSST'}</div>
                                <div className="font-bold">{bloque.tituloDocumento || 'REGLAMENTO INTERNO DE ORDEN HIGIENE Y SEGURIDAD'}</div>
                            </div>
                            <div className="w-1/4 flex flex-col">
                                <div className="flex border-b border-black">
                                    <div className="w-1/2 p-1 border-r border-black">Código</div>
                                    <div className="w-1/2 p-1">{bloque.codigoDocumento || 'SGST-RE-'}</div>
                                </div>
                                <div className="flex border-b border-black">
                                    <div className="w-1/2 p-1 border-r border-black">Página</div>
                                    <div className="w-1/2 p-1">Página 1</div>
                                </div>
                                <div className="flex border-b border-black">
                                    <div className="w-1/2 p-1 border-r border-black">Fecha</div>
                                    <div className="w-1/2 p-1 flex items-center gap-1 text-[10px] text-blue-500"><Zap size={10}/>{'DD/MM/YYYY'}</div>
                                </div>
                                <div className="flex">
                                    <div className="w-1/2 p-1 border-r border-black">Versión</div>
                                    <div className="w-1/2 p-1">{bloque.versionDocumento || '01'}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'corte':
                return (
                    <div className="relative flex w-full items-center py-2">
                        <Scissors size={16} className="text-slate-500 absolute left-0" />
                        <hr className="w-full border-t-2 border-dashed border-slate-400 ml-6" />
                    </div>
                );
            case 'titulo':
                return <p style={{ textAlign: align, fontWeight: 'bold', fontSize: ptToPx(bloque.fontSize, 18), fontStyle: fi }} className="text-slate-800 py-1 w-full">{bloque.contenido || '✏️ Título del documento'}</p>;
            case 'subtitulo':
                return <p style={{ textAlign: align, fontWeight: fw, fontSize: ptToPx(bloque.fontSize, 14), fontStyle: fi }} className="text-slate-700 py-0.5 w-full">{bloque.contenido || '✏️ Subtítulo'}</p>;
            case 'texto':
                return <p style={{ textAlign: align, fontWeight: fw, fontSize: ptToPx(bloque.fontSize, 11), fontStyle: fi }} className="text-slate-600 py-0.5 w-full whitespace-pre-wrap leading-[1.6]">{bloque.contenido || '✏️ Texto del documento...'}</p>;
            case 'imagen':
                const url = bloque.imageUrl || '/logo.png';
                return url
                    ? <div style={{ textAlign: align }} className="w-full py-1"><img src={url} alt="Logo" className="object-contain inline-block" style={{ width: ptToPx(bloque.imageWidth, 120) }} /></div>
                    : <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center text-slate-400 text-xs">Imagen / Logo (URL en propiedades)</div>;
            case 'campo_automatico': {
                const campo = CAMPOS_AUTOMATICOS.find(c => c.key === bloque.contenido);
                return (
                    <div className="flex items-center w-full py-1">
                        <span className="text-[13px] text-slate-700 w-48 shrink-0">{bloque.label || campo?.label || 'Campo'}</span>
                        <div className="flex-1 border-b border-blue-400 pb-0.5">
                            <span className="text-[13px] text-blue-600 font-medium flex items-center gap-1">
                                <Zap size={12} />{`{{${bloque.contenido || 'campo'}}}`}
                            </span>
                        </div>
                    </div>
                );
            }
            case 'campo_manual':
                return (
                    <div className="flex items-center gap-2 py-1">
                        <span className="text-xs font-bold text-slate-600">{bloque.etiquetaCampo || 'Campo'}:</span>
                        <span className="border border-slate-300 rounded px-2 py-0.5 text-xs text-slate-400">[ editable ]</span>
                        {bloque.requerido && <span className="text-red-500 text-xs">*</span>}
                    </div>
                );
            case 'fecha':
                return (
                    <div className="flex items-center gap-2 py-1">
                        <span className="text-xs font-bold text-slate-600">{bloque.label || 'Fecha'}:</span>
                        <span className="px-2 py-0.5 bg-teal-50 text-teal-700 rounded text-xs font-mono">{`{{fecha_actual}}`}</span>
                    </div>
                );
            case 'tabla':
                return (
                    <div className="py-1 overflow-x-auto">
                        <table className="w-full border-collapse text-xs">
                            <thead><tr>{(bloque.columnas || ['Col 1', 'Col 2']).map((col, i) => <th key={i} className="border border-slate-300 p-1 bg-slate-50 text-left font-bold text-slate-700">{col}</th>)}</tr></thead>
                            <tbody>{(bloque.filas || [['', '']]).map((fila, i) => <tr key={i}>{fila.map((celda, j) => <td key={j} className="border border-slate-300 p-1 text-slate-500">{celda || '...'}</td>)}</tr>)}</tbody>
                        </table>
                    </div>
                );
            case 'checkbox':
                return <div className="flex items-center gap-2 py-1"><div className="w-4 h-4 border-2 border-slate-400 rounded flex-shrink-0" /><span className="text-xs text-slate-600">{bloque.contenido || '✏️ Texto del checkbox'}</span></div>;
            case 'firma':
                return (
                    <div className="py-1 flex items-center gap-4">
                        <span className="text-[13px] text-slate-700 w-32 shrink-0">{bloque.label || 'Firma del Trabajador'}</span>
                        <div className="flex-1 border-b border-blue-400 relative h-4">
                            {/* Opcional: mostrar un indicador sutil de donde va la firma */}
                            <div className="absolute inset-0 flex items-center justify-center opacity-30">
                                <PenTool size={14} className="text-blue-500" />
                            </div>
                        </div>
                    </div>
                );
            case 'checklist_2col':
                return (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 py-1 px-4 border border-dashed border-cyan-200 rounded-md bg-cyan-50/10">
                        {(bloque.filas_epp || [{label: 'Ejemplo EPP 1'}, {label: 'Ejemplo EPP 2'}]).map((item, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <div className="w-3 h-3 border border-slate-400 rounded-sm" />
                                <span className="text-xs text-slate-600 truncate">{item.label}</span>
                            </div>
                        ))}
                    </div>
                );
            case 'dotacion_personal':
                return (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 py-1 px-4 border border-dashed border-emerald-200 rounded-md bg-emerald-50/10">
                        {(bloque.filas_dotacion || [{label: 'Zapato', claveTalla: 'talla'}]).map((item, i) => (
                            <div key={i} className="flex items-center gap-4 text-xs text-slate-600">
                                <span>{item.label}</span>
                                <div className="flex-1 border-b border-slate-300 relative h-3">
                                    <span className="absolute -top-1 right-0 text-[9px] text-slate-400">Talla</span>
                                </div>
                            </div>
                        ))}
                    </div>
                );
            case 'linea': return <hr className="border-slate-300 my-2" />;
            case 'espaciador': return <div style={{ height: `${bloque.altura || 24}px` }} />;
            default: return null;
        }
    };

    return (
        <div
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
            className={`relative group rounded-lg transition-all cursor-pointer py-1 ${isSelected ? 'ring-2 ring-blue-500 bg-blue-50/30' : 'hover:bg-slate-50 hover:ring-1 hover:ring-slate-200'} ${isDragging ? 'opacity-40' : ''}`}
        >
            <div className={`absolute -top-2.5 left-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${isSelected ? 'opacity-100' : ''}`}>
                <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${meta.color}`}>{meta.label}</span>
                <button onClick={e => { e.stopPropagation(); onMoveUp(); }} className="p-0.5 bg-white border border-slate-200 rounded hover:bg-slate-50 text-slate-500"><ChevronUp size={10} /></button>
                <button onClick={e => { e.stopPropagation(); onMoveDown(); }} className="p-0.5 bg-white border border-slate-200 rounded hover:bg-slate-50 text-slate-500"><ChevronDown size={10} /></button>
                <button onClick={e => { e.stopPropagation(); onDelete(); }} className="p-0.5 bg-white border border-red-200 rounded hover:bg-red-50 text-red-400"><Trash2 size={10} /></button>
            </div>
            <div className="absolute left-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-40 cursor-grab px-0.5"><GripVertical size={14} className="text-slate-400" /></div>
            {renderContenido()}
        </div>
    );
};

// ─── Panel de Propiedades ─────────────────────────────────────────────────────
const PropiedadesPanel: React.FC<{ bloque: TemplateBloque; onChange: (c: Partial<TemplateBloque>) => void }> = ({ bloque, onChange }) => {
    const inp = "w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:border-blue-400 focus:bg-white outline-none";
    const lbl = "text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1";

    return (
        <div className="space-y-4 p-4">
            <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest">Propiedades — {TIPO_META[bloque.tipo].label}</h4>
            {['titulo', 'subtitulo', 'texto', 'checkbox'].includes(bloque.tipo) && (
                <div><label className={lbl}>Contenido</label><textarea className={`${inp} resize-none`} rows={bloque.tipo === 'texto' ? 5 : 2} value={bloque.contenido || ''} onChange={e => onChange({ contenido: e.target.value })} placeholder="Escribe el contenido..." /></div>
            )}
            {bloque.tipo === 'campo_automatico' && (<>
                <div><label className={lbl}>Campo de datos</label>
                    <select className={inp} value={bloque.contenido || ''} onChange={e => { const c = CAMPOS_AUTOMATICOS.find(x => x.key === e.target.value); onChange({ contenido: e.target.value, label: c?.label }); }}>
                        <option value="">Seleccionar campo...</option>
                        {CAMPOS_AUTOMATICOS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                </div>
                <div><label className={lbl}>Etiqueta visible</label><input className={inp} value={bloque.label || ''} onChange={e => onChange({ label: e.target.value })} placeholder="Ej: Nombre del Trabajador" /></div>
            </>)}
            {bloque.tipo === 'campo_manual' && (<>
                <div><label className={lbl}>Nombre del campo</label><input className={inp} value={bloque.etiquetaCampo || ''} onChange={e => onChange({ etiquetaCampo: e.target.value })} placeholder="Ej: Talla Zapato" /></div>
                <div className="flex items-center gap-2"><input type="checkbox" id="req" checked={!!bloque.requerido} onChange={e => onChange({ requerido: e.target.checked })} /><label htmlFor="req" className="text-xs font-medium text-slate-600">Campo obligatorio</label></div>
            </>)}
            {bloque.tipo === 'imagen' && (<>
                <div><label className={lbl}>URL de imagen (vacío para usar Logo de App)</label><input className={inp} value={bloque.imageUrl || ''} onChange={e => onChange({ imageUrl: e.target.value })} placeholder="https://..." /></div>
                <div><label className={lbl}>Ancho de la Imagen (pt)</label><input type="number" className={inp} value={bloque.imageWidth || 120} onChange={e => onChange({ imageWidth: Number(e.target.value) })} min={20} max={400} /></div>
            </>)}
            {(bloque.tipo === 'firma' || bloque.tipo === 'fecha') && <div><label className={lbl}>Etiqueta</label><input className={inp} value={bloque.label || ''} onChange={e => onChange({ label: e.target.value })} placeholder={bloque.tipo === 'firma' ? 'Firma del Trabajador' : 'Fecha de entrega'} /></div>}
            {bloque.tipo === 'tabla' && (<>
                <div><label className={lbl}>Columnas (separadas por coma)</label>
                    <input className={inp} value={(bloque.columnas || []).join(', ')} onChange={e => { const cols = e.target.value.split(',').map((s: string) => s.trim()); onChange({ columnas: cols, filas: (bloque.filas || [['']]).map((f: string[]) => { while (f.length < cols.length) f.push(''); return f.slice(0, cols.length); }) }); }} placeholder="Col 1, Col 2" />
                </div>
                <div><label className={lbl}>Filas (una/línea, celdas por |)</label>
                    <textarea className={`${inp} resize-none`} rows={4} value={(bloque.filas || []).map((f: string[]) => f.join(' | ')).join('\n')} onChange={e => { onChange({ filas: e.target.value.split('\n').map((l: string) => l.split('|').map((s: string) => s.trim())) }); }} placeholder="dato1 | dato2" />
                </div>
            </>)}
            {bloque.tipo === 'checklist_2col' && (
                <div>
                    <label className={lbl}>Elementos (uno por línea, opcionalmente separados por | para la clave de talla)</label>
                    <textarea 
                        className={`${inp} resize-none`} 
                        rows={10} 
                        value={(bloque.filas_epp || []).map((f: any) => f.claveTalla ? `${f.label} | ${f.claveTalla}` : f.label).join('\n')} 
                        onChange={e => {
                            const lines = e.target.value.split('\n').filter(l => l.trim() !== '');
                            const newFilas = lines.map(l => {
                                const parts = l.split('|').map(s => s.trim());
                                return { label: parts[0], claveTalla: parts[1] || undefined };
                            });
                            onChange({ filas_epp: newFilas });
                        }} 
                        placeholder="Casco de seguridad\nZapato | trabajador.talleCalzado" 
                    />
                    <p className="text-[10px] text-slate-500 mt-1">Si necesitas vincular una talla, usa el formato: <br/><b>Nombre del elemento | trabajador.talleCalzado</b></p>
                </div>
            )}
            {bloque.tipo === 'dotacion_personal' && (
                <div>
                    <label className={lbl}>Elementos (uno por línea, formato: Nombre | clave de talla)</label>
                    <textarea 
                        className={`${inp} resize-none`} 
                        rows={6} 
                        value={(bloque.filas_dotacion || []).map((f: any) => `${f.label} | ${f.claveTalla || ''}`).join('\n')} 
                        onChange={e => {
                            const lines = e.target.value.split('\n').filter(l => l.trim() !== '');
                            const newFilas = lines.map(l => {
                                const parts = l.split('|').map(s => s.trim());
                                return { label: parts[0], claveTalla: parts[1] || undefined };
                            });
                            onChange({ filas_dotacion: newFilas });
                        }} 
                        placeholder="Zapato | trabajador.talleCalzado\nChaqueta | trabajador.talleChaqueta" 
                    />
                </div>
            )}
            {bloque.tipo === 'espaciador' && <div><label className={lbl}>Altura (px)</label><input type="number" className={inp} value={bloque.altura || 24} min={4} max={200} onChange={e => onChange({ altura: Number(e.target.value) })} /></div>}
            {bloque.tipo === 'encabezado_iso' && (
                <div className="space-y-3">
                    <div><label className={lbl}>Título del Sistema</label><input className={inp} value={bloque.tituloSistema || ''} onChange={e => onChange({ tituloSistema: e.target.value })} placeholder="Ej: SGSST" /></div>
                    <div><label className={lbl}>Título del Documento</label><input className={inp} value={bloque.tituloDocumento || ''} onChange={e => onChange({ tituloDocumento: e.target.value })} placeholder="Ej: REGLAMENTO INTERNO..." /></div>
                    <div><label className={lbl}>Código del Documento</label><input className={inp} value={bloque.codigoDocumento || ''} onChange={e => onChange({ codigoDocumento: e.target.value })} placeholder="Ej: SGST-RE-" /></div>
                    <div><label className={lbl}>Versión</label><input className={inp} value={bloque.versionDocumento || ''} onChange={e => onChange({ versionDocumento: e.target.value })} placeholder="Ej: 01" /></div>
                    <div className="border-t border-slate-100 pt-3 mt-3">
                        <p className={lbl}>Logo</p>
                        <div><label className={lbl}>URL de imagen (vacío para Logo App)</label><input className={inp} value={bloque.imageUrl || ''} onChange={e => onChange({ imageUrl: e.target.value })} placeholder="https://..." /></div>
                        <div><label className={lbl}>Ancho de la Imagen (pt)</label><input type="number" className={inp} value={bloque.imageWidth || 80} onChange={e => onChange({ imageWidth: Number(e.target.value) })} min={20} max={200} /></div>
                    </div>
                </div>
            )}
            {['titulo', 'subtitulo', 'texto', 'imagen'].includes(bloque.tipo) && (
                <div className="space-y-3 border-t border-slate-100 pt-3">
                    <p className={lbl}>{bloque.tipo === 'imagen' ? 'Alineación de la imagen' : 'Estilo de texto'}</p>
                    {bloque.tipo !== 'imagen' && <div><label className={lbl}>Tamaño (px)</label><input type="number" className={inp} value={bloque.fontSize || (bloque.tipo === 'titulo' ? 18 : bloque.tipo === 'subtitulo' ? 14 : 12)} min={8} max={48} onChange={e => onChange({ fontSize: Number(e.target.value) })} /></div>}
                    <div><label className={lbl}>Alineación</label>
                        <select className={inp} value={bloque.alineacion || (bloque.tipo === 'titulo' ? 'center' : 'left')} onChange={e => onChange({ alineacion: e.target.value as any })}>
                            <option value="left">Izquierda</option><option value="center">Centro</option><option value="right">Derecha</option>{bloque.tipo !== 'imagen' && <option value="justify">Justificado</option>}
                        </select>
                    </div>
                    {bloque.tipo !== 'imagen' && <div className="flex gap-4">
                        <label className="flex items-center gap-2 text-xs font-medium text-slate-600"><input type="checkbox" checked={!!bloque.negrita} onChange={e => onChange({ negrita: e.target.checked })} />Negrita</label>
                        <label className="flex items-center gap-2 text-xs font-medium text-slate-600"><input type="checkbox" checked={!!bloque.cursiva} onChange={e => onChange({ cursiva: e.target.checked })} />Cursiva</label>
                    </div>}
                </div>
            )}
        </div>
    );
};

// ─── Componente Principal ─────────────────────────────────────────────────────
interface TemplateEditorProps {
    template?: DocumentTemplate | null;
    onClose: () => void;
    onSaved?: (id: string) => void;
}

const TemplateEditor: React.FC<TemplateEditorProps> = ({ template, onClose, onSaved }) => {
    const { currentUser, addDocumentTemplate, updateDocumentTemplate, showNotification } = useAppStore();
    const [nombre, setNombre] = useState(template?.nombre || '');
    const [tipo, setTipo] = useState(template?.tipo || 'Contrato');
    const [estado, setEstado] = useState<DocumentTemplate['estado']>(template?.estado || 'borrador');
    const [version, setVersion] = useState(template?.version || 1);
    const [bloques, setBloques] = useState<TemplateBloque[]>(template?.bloques || []);
    const [selectedBloqueId, setSelectedBloqueId] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);

    const selectedBloque = bloques.find(b => b.id === selectedBloqueId) || null;

    const agregarBloque = useCallback((t: TipoBloqueTemplate) => {
        const n: TemplateBloque = {
            id: genId(), tipo: t, orden: bloques.length, contenido: '',
            alineacion: t === 'titulo' ? 'center' : 'left',
            negrita: t === 'titulo',
            fontSize: t === 'titulo' ? 18 : t === 'subtitulo' ? 14 : 12,
        };
        if (t === 'checklist_2col') {
            n.filas_epp = [{ label: 'Elemento 1' }, { label: 'Elemento 2' }];
        }
        if (t === 'dotacion_personal') {
            n.filas_dotacion = [{ label: 'Zapato', claveTalla: 'trabajador.talleCalzado' }];
        }
        setBloques(prev => [...prev, n]);
        setSelectedBloqueId(n.id);
    }, [bloques.length]);

    const actualizarBloque = useCallback((id: string, c: Partial<TemplateBloque>) => {
        setBloques(prev => prev.map(b => b.id === id ? { ...b, ...c } : b));
    }, []);

    const eliminarBloque = useCallback((id: string) => {
        setBloques(prev => prev.filter(b => b.id !== id));
        setSelectedBloqueId(prev => prev === id ? null : prev);
    }, []);

    const moverBloque = useCallback((id: string, dir: 'up' | 'down') => {
        setBloques(prev => {
            const idx = prev.findIndex(b => b.id === id);
            if (dir === 'up' && idx === 0) return prev;
            if (dir === 'down' && idx === prev.length - 1) return prev;
            const arr = [...prev];
            const si = dir === 'up' ? idx - 1 : idx + 1;
            [arr[idx], arr[si]] = [arr[si], arr[idx]];
            return arr.map((b, i) => ({ ...b, orden: i }));
        });
    }, []);

    const duplicarBloque = useCallback((id: string) => {
        const b = bloques.find(x => x.id === id);
        if (!b) return;
        const idx = bloques.findIndex(x => x.id === id);
        const copia = { ...b, id: genId(), orden: bloques.length };
        setBloques(prev => { const arr = [...prev]; arr.splice(idx + 1, 0, copia); return arr.map((x, i) => ({ ...x, orden: i })); });
    }, [bloques]);

    const handleDragStart = (e: React.DragEvent, id: string) => { e.dataTransfer.setData('text/plain', id); setDraggingId(id); };
    const handleDragOver = (e: React.DragEvent, index: number) => { e.preventDefault(); setDragOverIndex(index); };
    const handleDrop = (e: React.DragEvent, ti: number) => {
        e.preventDefault();
        const sid = e.dataTransfer.getData('text/plain');
        const si = bloques.findIndex(b => b.id === sid);
        if (si === -1 || si === ti) return;
        setBloques(prev => { const arr = [...prev]; const [m] = arr.splice(si, 1); arr.splice(ti, 0, m); return arr.map((b, i) => ({ ...b, orden: i })); });
        setDraggingId(null); setDragOverIndex(null);
    };

    const handleSave = async () => {
        if (!nombre.trim()) { showNotification('El nombre de la plantilla es obligatorio', 'warning'); return; }
        if (bloques.length === 0) { showNotification('Agrega al menos un bloque al documento', 'warning'); return; }
        setIsSaving(true);
        try {
            const payload: Omit<DocumentTemplate, 'id' | 'creadoEn'> = {
                nombre: nombre.trim(), tipo, estado,
                version: version,
                bloques: bloques.map((b, i) => ({ ...b, orden: i })),
                actualizadoEn: new Date().toISOString(),
                creadoPor: currentUser?.uid || '',
            };
            let id: string;
            if (template) {
                await updateDocumentTemplate(template.id, payload);
                id = template.id;
                showNotification('Plantilla actualizada', 'success');
            } else {
                id = await addDocumentTemplate(payload);
                showNotification('Plantilla creada', 'success');
            }
            onSaved?.(id); onClose();
        } catch (err) {
            console.error(err);
            showNotification('Error al guardar la plantilla', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0 shadow-sm">
                <div className="flex items-center gap-3">
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl text-slate-500"><ArrowLeft size={18} /></button>
                    <div>
                        <h2 className="text-base font-black text-slate-800">{template ? 'Editar: ' + template.nombre : 'Nueva Plantilla'}</h2>
                        <p className="text-xs text-slate-400">{template ? `v${template.version} · ${bloques.length} bloques` : 'Editor de plantillas documentales'}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex p-0.5 bg-slate-100 rounded-xl">
                    </div>
                    <select value={estado} onChange={e => setEstado(e.target.value as any)} className="text-xs font-bold border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 outline-none">
                        <option value="borrador">Borrador</option><option value="activo">Activo</option><option value="archivado">Archivado</option>
                    </select>
                    <button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md disabled:opacity-60 active:scale-95">
                        {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        {isSaving ? 'Guardando...' : 'Guardar'}
                    </button>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400"><X size={18} /></button>
                </div>
            </div>
            {/* Metadata Row */}
            <div className="bg-white border-b border-slate-100 px-6 py-2 flex items-center gap-6 shrink-0">
                <div className="flex items-center gap-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nombre</label>
                    <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Reglamento Interno v2026" className="px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:border-blue-400 w-72" />
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo</label>
                    <select value={tipo} onChange={e => setTipo(e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:border-blue-400 bg-white">
                        <option value="Contrato">Contrato</option><option value="EPP">EPP</option>
                        <option value="ODI">ODI</option><option value="Reglamento">Reglamento</option><option value="Otro">Otro</option>
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Versión</label>
                    <input type="number" min="1" value={version} onChange={e => setVersion(Number(e.target.value))} className="px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:border-blue-400 w-20" />
                </div>
            </div>
            {/* Main */}
            <div className="flex-1 flex overflow-hidden">

                    {/* Panel izquierdo — componentes */}
                    <aside className="w-52 bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-y-auto">
                        <div className="p-3 border-b border-slate-100">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Componentes</p>
                            <p className="text-[9px] text-slate-400 mt-0.5">Click para añadir al documento</p>
                        </div>
                        <div className="p-2 space-y-1">
                            {BLOQUES_DISPONIBLES.map(t => {
                                const m = TIPO_META[t];
                                return (
                                    <button key={t} onClick={() => agregarBloque(t)} className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-95 border border-transparent hover:border-slate-200 ${m.color}`}>
                                        {m.label}
                                    </button>
                                );
                            })}
                        </div>
                    </aside>
                    {/* Canvas Carta */}
                    <main className="flex-1 overflow-y-auto bg-slate-200 flex justify-center py-8 px-4">
                        <div
                            className="bg-white shadow-xl rounded-sm"
                            style={{ width: '1020px', minHeight: '1320px', padding: '120px' }}
                            onClick={() => setSelectedBloqueId(null)}
                        >
                            {bloques.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-slate-200 rounded-xl text-slate-300">
                                    <Plus size={32} className="mb-2" />
                                    <p className="text-sm font-bold">Agrega componentes desde el panel izquierdo</p>
                                    <p className="text-xs mt-1">El documento se construye bloque a bloque</p>
                                </div>
                            ) : (
                                <div className="space-y-0.5">
                                    {bloques.map((bloque, index) => (
                                        <div
                                            key={bloque.id}
                                            draggable
                                            onDragStart={e => handleDragStart(e, bloque.id)}
                                            onDragOver={e => handleDragOver(e, index)}
                                            onDrop={e => handleDrop(e, index)}
                                            onDragEnd={() => { setDraggingId(null); setDragOverIndex(null); }}
                                            className={`transition-all ${dragOverIndex === index && draggingId !== bloque.id ? 'border-t-2 border-blue-400' : ''}`}
                                        >
                                            <BloqueCanvas
                                                bloque={bloque}
                                                isSelected={selectedBloqueId === bloque.id}
                                                isDragging={draggingId === bloque.id}
                                                onSelect={() => setSelectedBloqueId(bloque.id)}
                                                onDelete={() => eliminarBloque(bloque.id)}
                                                onMoveUp={() => moverBloque(bloque.id, 'up')}
                                                onMoveDown={() => moverBloque(bloque.id, 'down')}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </main>
                    {/* Panel derecho — propiedades */}
                    <aside className="w-64 bg-white border-l border-slate-200 flex flex-col shrink-0 overflow-y-auto">
                        {selectedBloque ? (<>
                            <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Propiedades</p>
                                <div className="flex gap-1">
                                    <button onClick={() => duplicarBloque(selectedBloque.id)} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400" title="Duplicar"><Copy size={13} /></button>
                                    <button onClick={() => eliminarBloque(selectedBloque.id)} className="p-1 hover:bg-red-50 rounded-lg text-red-400" title="Eliminar"><Trash2 size={13} /></button>
                                </div>
                            </div>
                            <div className="overflow-y-auto flex-1">
                                <PropiedadesPanel bloque={selectedBloque} onChange={c => actualizarBloque(selectedBloque.id, c)} />
                            </div>
                        </>) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                                <Settings size={32} className="mb-4 text-slate-300" />
                                <p className="text-sm font-medium">Selecciona un bloque</p>
                                <p className="text-xs mt-1">Haz clic en cualquier elemento del documento para editar sus propiedades</p>
                            </div>
                        )}
                    </aside>
                </div>
        </div>
    );
};

export default TemplateEditor;
