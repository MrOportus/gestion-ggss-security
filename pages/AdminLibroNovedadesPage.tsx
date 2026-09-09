import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../lib/firebase';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { useAppStore } from '../store/useAppStore';
import { normalizeText } from '../lib/textUtils';
import ThumbnailImage from '../components/ThumbnailImage';
import {
    Navigation, Search, MapPin, BookOpen, AlertTriangle, AlertCircle, Info, FileText, X,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

const ResultBadge = ({ result }: { result: string }) => {
    const cfg: Record<string, { bg: string; text: string; ring: string; label: string }> = {
        SIN_NOVEDAD: { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-600/20', label: 'Sin Novedad' },
        CON_NOVEDAD: { bg: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-600/20', label: 'Con Novedad' },
        SOSPECHA: { bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-600/20', label: 'Sospecha' },
    };
    const c = cfg[result] || { bg: 'bg-slate-50', text: 'text-slate-500', ring: 'ring-slate-200', label: result };
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase ring-1 ring-inset ${c.bg} ${c.text} ${c.ring}`}>
            {c.label}
        </span>
    );
};

// ─── Página Admin: Libro de Novedades ─────────────────────────────────────────
const AdminLibroNovedadesPage: React.FC = () => {
    const { sites, guardRounds, novedades } = useAppStore();

    // ── Filtros ──────────────────────────────────────────────────────────────
    const [startDate, setStartDate] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [tipoFilter, setTipoFilter] = useState('all');
    const [prioridadFilter, setPrioridadFilter] = useState('all');
    const [searchText, setSearchText] = useState('');
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const itemsPerPage = 20;

    // ── Filtro de sucursal con buscador (estilo ShiftManagement) ─────────────
    const [siteFilter, setSiteFilter] = useState('all');          // 'all' o siteId (string)
    const [siteInputValue, setSiteInputValue] = useState('');     // texto visible en el input
    const [showSiteList, setShowSiteList] = useState(false);
    // Por defecto Falabella está excluida; el check la habilita
    const [includeFalabella, setIncludeFalabella] = useState(false);
    const siteSearchRef = useRef<HTMLDivElement>(null);

    // Cerrar dropdown al hacer clic fuera
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (siteSearchRef.current && !siteSearchRef.current.contains(e.target as Node)) {
                setShowSiteList(false);
                // Si el input quedó vacío o no coincide con ninguna sucursal, restaurar a "Todas"
                if (!siteInputValue) {
                    setSiteFilter('all');
                }
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [siteInputValue]);

    // IDs de sucursales Falabella — igual que ShiftManagement: detecta por empresa (cliente) o nombre
    const isFalabellaSite = (s: any) =>
        normalizeText(s.empresa || '').includes('falabella') ||
        normalizeText(s.name || '').includes('falabella');

    const falabellaSiteIds = useMemo(() =>
        new Set(sites.filter((s: any) => s.active !== false && isFalabellaSite(s)).map((s: any) => String(s.id)))
    , [sites]);

    // Sucursales visibles en el dropdown: solo activas, por defecto sin Falabella; con check, incluye Falabella
    const sitesForSelector = useMemo(() => {
        return sites.filter((s: any) => {
            if (s.active === false) return false; // excluir inactivas
            const isFalabella = isFalabellaSite(s);
            return includeFalabella ? true : !isFalabella;
        });
    }, [sites, includeFalabella]);

    // Sucursales mostradas en el dropdown (búsqueda por texto)
    const siteDropdownOptions = useMemo(() => {
        const q = normalizeText(siteInputValue);
        return sitesForSelector.filter((s: any) => normalizeText(s.name).includes(q));
    }, [sitesForSelector, siteInputValue]);

    // ── Novedades en tiempo real via onSnapshot ───────────────────────────────
    const [localNovedades, setLocalNovedades] = useState<any[]>(novedades);

    useEffect(() => {
        setPage(1);
    }, [startDate, endDate, tipoFilter, siteFilter, prioridadFilter, searchText]);

    // Listener en tiempo real — sin filtro where para evitar índice compuesto
    useEffect(() => {
        const q = query(
            collection(db, 'novedades'),
            orderBy('timestamp', 'desc'),
            limit(500) // Límite más amplio para admin (ve todo)
        );

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const all: any[] = [];
                snapshot.forEach(d => all.push({ ...d.data(), id: d.id }));
                setLocalNovedades(all);
            },
            (error) => {
                console.error('[AdminLibroNovedades] onSnapshot error:', error);
            }
        );

        return () => { unsubscribe(); };
    }, []); // Solo una vez al montar — admin ve todas las novedades

    // ── Timeline combinada: rondas + novedades ────────────────────────────────
    const timelineItems = useMemo(() => {
        const roundItems = guardRounds.map((r: any) => ({
            id: `ronda_${r.id}`,
            siteId: String(r.siteId),
            sucursalName: r.siteName,
            tipo: 'ronda',
            descripcion: r.notes || 'Ronda completada sin observaciones.',
            guardName: r.workerName,
            timestamp: r.startTime,
            resultado: r.result,
            estado: r.endTime ? 'resuelto' : 'activo',
        }));

        const novedadItems = localNovedades.map((n: any) => ({
            id: n.id,
            siteId: String(n.siteId || n.sucursalId),
            sucursalName: n.siteName || n.sucursalNombre,
            tipo: n.tipoRegistro || n.tipo,
            descripcion: n.descripcion,
            guardName: n.autorNombre || n.guardName,
            timestamp: n.fechaHoraDispositivo || n.timestamp || n.createdAt || '',
            resultado: n.estado || n.resultado,
            prioridad: n.prioridad,
            evidencias: n.evidencias || (n.evidenciaUrl ? [n.evidenciaUrl] : []),
        }));

        return [...roundItems, ...novedadItems].sort((a: any, b: any) =>
            b.timestamp.localeCompare(a.timestamp)
        );
    }, [guardRounds, localNovedades]);

    const filtered = timelineItems.filter((item: any) => {
        const dateStr = item.timestamp.substring(0, 10);
        const matchDate = dateStr >= startDate && dateStr <= endDate;
        const matchTipo = tipoFilter === 'all' || item.tipo === tipoFilter;
        // Excluir Falabella del contenido si el check no está activo
        const isFalabellaItem = falabellaSiteIds.has(item.siteId);
        if (!includeFalabella && isFalabellaItem) return false;
        const matchSite = siteFilter === 'all' || item.siteId === siteFilter;
        const matchPrioridad = prioridadFilter === 'all' || item.prioridad === prioridadFilter;
        const q = searchText.trim().toLowerCase();
        const matchSearch = !q || [
            item.descripcion,
            item.guardName,
            item.sucursalName,
            item.tipo,
            item.timestamp,
        ].some(v => v && v.toString().toLowerCase().includes(q));
        return matchDate && matchTipo && matchSite && matchPrioridad && matchSearch;
    });

    const tipoIcon: Record<string, React.ReactNode> = {
        ronda: <Navigation size={13} />, incidente: <AlertTriangle size={13} />,
        alerta: <AlertCircle size={13} />, novedad: <Info size={13} />, otro: <FileText size={13} />,
    };
    const tipoColor: Record<string, string> = {
        ronda: 'bg-blue-100 text-blue-700', incidente: 'bg-rose-100 text-rose-700',
        alerta: 'bg-amber-100 text-amber-700', novedad: 'bg-indigo-100 text-indigo-700', otro: 'bg-slate-100 text-slate-600',
    };

    const totalPages = Math.ceil(filtered.length / itemsPerPage);
    const paginatedItems = filtered.slice((page - 1) * itemsPerPage, page * itemsPerPage);

    // Nombre de la sucursal seleccionada (para el badge)
    const selectedSiteName = siteFilter !== 'all'
        ? sites.find((s: any) => String(s.id) === siteFilter)?.name ?? ''
        : '';

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-5">
            {/* Encabezado */}
            <div>
                <h3 className="text-xl font-black text-slate-800">Libro de Novedades</h3>
                <p className="text-sm text-slate-400 mt-0.5">Registro cronológico de rondas y eventos operacionales — todas las instalaciones</p>
            </div>

            {/* Panel de filtros */}
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
                {/* Búsqueda de texto libre */}
                <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                        type="text"
                        placeholder="Buscar por patente, descripción, guardia, instalación..."
                        value={searchText}
                        onChange={e => setSearchText(e.target.value)}
                        className="w-full pl-9 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-400 outline-none transition-all"
                    />
                    {searchText && (
                        <button
                            onClick={() => setSearchText('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors text-lg leading-none"
                            title="Limpiar búsqueda"
                        >
                            &times;
                        </button>
                    )}
                </div>

                {/* Filtros secundarios */}
                <div className="flex flex-wrap gap-3 items-end">
                    {/* Fechas */}
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Desde</label>
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Hasta</label>
                        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>

                    {/* Tipo */}
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Tipo</label>
                        <select value={tipoFilter} onChange={e => setTipoFilter(e.target.value)}
                            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none">
                            <option value="all">Todos los tipos</option>
                            <option value="ronda">Ronda</option>
                            <option value="incidente">Incidente</option>
                            <option value="alerta">Alerta</option>
                            <option value="novedad">Novedad</option>
                            <option value="otro">Otro</option>
                        </select>
                    </div>

                    {/* Prioridad */}
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Prioridad</label>
                        <select value={prioridadFilter} onChange={e => setPrioridadFilter(e.target.value)}
                            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none">
                            <option value="all">Todas</option>
                            <option value="informativa">Informativa</option>
                            <option value="media">Media</option>
                            <option value="alta">Alta</option>
                            <option value="critica">Crítica</option>
                        </select>
                    </div>

                    {/* ── Selector de Instalación con buscador ─────────────────── */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase block">Instalación</label>

                        {/* Combobox */}
                        <div className="relative" ref={siteSearchRef}>
                            <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Buscar sucursal..."
                                className="pl-8 pr-8 py-2 border border-slate-200 rounded-xl text-sm w-64 focus:ring-2 focus:ring-blue-500 outline-none bg-slate-50 text-slate-800 font-medium"
                                value={siteInputValue}
                                onFocus={() => {
                                    setSiteInputValue('');
                                    setShowSiteList(true);
                                }}
                                onChange={(e) => {
                                    setSiteInputValue(e.target.value);
                                    setShowSiteList(true);
                                    // Si el texto coincide exactamente con una sucursal, seleccionarla
                                    const exact = sitesForSelector.find(s => s.name === e.target.value);
                                    if (exact) setSiteFilter(String(exact.id));
                                }}
                            />
                            {/* Botón limpiar selección */}
                            {siteFilter !== 'all' && (
                                <button
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                                    title="Mostrar todas las instalaciones"
                                    onClick={() => {
                                        setSiteFilter('all');
                                        setSiteInputValue('');
                                        setShowSiteList(false);
                                    }}
                                >
                                    <X size={13} />
                                </button>
                            )}

                            {/* Dropdown de opciones */}
                            {showSiteList && (
                                <div className="absolute top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-[500px] overflow-y-auto z-[120]">
                                    {/* Lista filtrada */}
                                    {siteDropdownOptions.map((site: any) => (
                                        <div
                                            key={site.id}
                                            className={`px-4 py-2.5 hover:bg-blue-50 cursor-pointer border-b border-slate-50 last:border-0 ${String(site.id) === siteFilter ? 'bg-blue-50' : ''}`}
                                            onClick={() => {
                                                setSiteFilter(String(site.id));
                                                setSiteInputValue(site.name);
                                                setShowSiteList(false);
                                            }}
                                        >
                                            <div className="text-sm font-bold text-slate-700">{site.name}</div>
                                            {site.address && (
                                                <div className="text-[10px] text-slate-400 leading-tight mt-0.5">{site.address}</div>
                                            )}
                                        </div>
                                    ))}

                                    {siteDropdownOptions.length === 0 && (
                                        <div className="p-4 text-xs text-slate-400 italic text-center">
                                            No hay sucursales que coincidan
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Checkbox Falabella */}
                        <div className="flex items-center gap-2 px-1 text-xs text-slate-600 font-medium">
                            <label className="flex items-center gap-1.5 cursor-pointer hover:text-blue-600 transition-colors select-none">
                                <input
                                    type="checkbox"
                                    className="rounded text-blue-600 focus:ring-blue-500 accent-blue-600"
                                    checked={includeFalabella}
                                    onChange={(e) => {
                                        setIncludeFalabella(e.target.checked);
                                        // Si se desmarca, resetear si la selección activa era Falabella
                                        if (!e.target.checked && siteFilter !== 'all' && falabellaSiteIds.has(siteFilter)) {
                                            setSiteFilter('all');
                                            setSiteInputValue('');
                                        }
                                    }}
                                />
                                Incluir Falabella
                            </label>
                        </div>
                    </div>

                    {/* Contador de resultados */}
                    <div className="ml-auto flex items-center gap-2 self-end pb-0.5">
                        {selectedSiteName && (
                            <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg flex items-center gap-1">
                                <MapPin size={9} />{selectedSiteName}
                            </span>
                        )}
                        {searchText && (
                            <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">
                                &ldquo;{searchText}&rdquo;
                            </span>
                        )}
                        <span className="text-[10px] font-bold text-slate-400">{filtered.length} registros</span>
                    </div>
                </div>
            </div>

            {/* Timeline */}
            {filtered.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-16 text-center">
                    <BookOpen size={40} className="text-slate-200 mx-auto mb-3" />
                    <p className="font-bold text-slate-400">Sin registros en el período seleccionado</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {paginatedItems.map((item: any, idx: number) => {
                        const prevDate = idx > 0 ? filtered[(page - 1) * itemsPerPage + idx - 1]?.timestamp.substring(0, 10) : null;
                        const currDate = item.timestamp.substring(0, 10);
                        const showSep = prevDate !== currDate;
                        const dotColor = item.prioridad === 'critica' ? 'bg-red-500 border-red-300'
                            : item.prioridad === 'alta' ? 'bg-orange-500 border-orange-300'
                            : item.prioridad === 'media' ? 'bg-amber-500 border-amber-300'
                            : item.prioridad === 'informativa' ? 'bg-blue-500 border-blue-300'
                            : item.resultado === 'SIN_NOVEDAD' ? 'bg-emerald-400 border-emerald-300'
                            : (item.resultado === 'CON_NOVEDAD' || item.tipo === 'incidente') ? 'bg-rose-400 border-rose-300'
                            : item.tipo === 'alerta' ? 'bg-amber-400 border-amber-300' : 'bg-blue-400 border-blue-300';
                        return (
                            <React.Fragment key={item.id}>
                                {showSep && (
                                    <div className="flex items-center gap-3 py-2">
                                        <div className="flex-1 h-px bg-slate-100" />
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                            {new Date(currDate + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: '2-digit', month: 'long' })}
                                        </span>
                                        <div className="flex-1 h-px bg-slate-100" />
                                    </div>
                                )}
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 hover:shadow-md transition-all flex items-start gap-4">
                                    <div className="text-right shrink-0 w-14">
                                        <p className="text-sm font-black text-slate-800">{fmtTime(item.timestamp)}</p>
                                    </div>
                                    <div className="flex flex-col items-center shrink-0 pt-1.5">
                                        <div className={`w-3 h-3 rounded-full border-2 ${dotColor}`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase ${tipoColor[item.tipo] || tipoColor.otro}`}>
                                                {tipoIcon[item.tipo] || tipoIcon.otro}{item.tipo}
                                            </span>
                                            {item.prioridad && (
                                                <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase ${
                                                    item.prioridad === 'critica' ? 'bg-red-100 text-red-700' :
                                                    item.prioridad === 'alta' ? 'bg-orange-100 text-orange-700' :
                                                    item.prioridad === 'media' ? 'bg-amber-100 text-amber-700' :
                                                    'bg-blue-100 text-blue-700'
                                                }`}>
                                                    {item.prioridad}
                                                </span>
                                            )}
                                            {item.resultado && <ResultBadge result={item.resultado} />}
                                            <span className="text-xs text-slate-400">·</span>
                                            <span className="text-xs font-bold text-slate-600">{item.guardName}</span>
                                            <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                                <MapPin size={9} />{item.sucursalName}
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-600 mt-1 leading-relaxed">{item.descripcion}</p>
                                        {item.evidencias && item.evidencias.length > 0 && (
                                            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                                                {item.evidencias.map((url: string, eIdx: number) => (
                                                    <div key={eIdx} onClick={() => setSelectedImage(url)} className="shrink-0 w-16 h-16 rounded-xl border border-slate-200 overflow-hidden cursor-pointer hover:border-blue-400 hover:shadow-sm transition">
                                                        <ThumbnailImage photoUrl={url} alt={`Evidencia ${eIdx + 1}`} className="w-full h-full object-cover" />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </React.Fragment>
                        );
                    })}
                </div>
            )}

            {/* Paginación */}
            {totalPages > 1 && (
                <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm mt-4">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-4 py-2 bg-slate-50 text-slate-600 rounded-xl disabled:opacity-50 font-bold text-sm hover:bg-slate-100 transition-colors"
                    >
                        Anterior
                    </button>
                    <span className="text-sm font-bold text-slate-500">Página {page} de {totalPages}</span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="px-4 py-2 bg-slate-50 text-slate-600 rounded-xl disabled:opacity-50 font-bold text-sm hover:bg-slate-100 transition-colors"
                    >
                        Siguiente
                    </button>
                </div>
            )}

            {/* Lightbox de evidencias */}
            {selectedImage && (
                <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="relative max-w-4xl max-h-[90vh] w-full flex items-center justify-center">
                        <button onClick={() => setSelectedImage(null)} className="absolute -top-12 right-0 text-white hover:text-slate-200 text-3xl font-bold leading-none">
                            &times;
                        </button>
                        <ThumbnailImage photoUrl={selectedImage} alt="Fullscreen Evidence" className="max-w-full max-h-[90vh] object-contain rounded-xl" />
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminLibroNovedadesPage;
