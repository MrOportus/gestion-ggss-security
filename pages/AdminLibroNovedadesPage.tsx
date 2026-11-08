import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../lib/firebase';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { useAppStore } from '../store/useAppStore';
import { normalizeText } from '../lib/textUtils';
import ThumbnailImage from '../components/ThumbnailImage';
import {
    Navigation, Search, MapPin, BookOpen, AlertTriangle, AlertCircle, Info, FileText, X, Clock, PlayCircle
} from 'lucide-react';
import { AdminNovedadesSeguimiento } from '../components/novedades/AdminNovedadesSeguimiento';
import { IniciarSeguimientoModal } from '../components/novedades/IniciarSeguimientoModal';
import NovedadSeguimientoModal from '../components/novedades/NovedadSeguimientoModal';
import { esEsquemaNuevo } from '../lib/novedades/seguimientoService';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

const CATEGORIA_META: Record<string, { icon: string; label: string; badgeClass: string }> = {
    acceso_personas: { icon: '🧍🏽', label: 'Acceso Personas', badgeClass: 'bg-sky-50 border-sky-200/80' },
    acceso_vehiculos: { icon: '🚗', label: 'Acceso Vehículos', badgeClass: 'bg-indigo-50 border-indigo-200/80' },
    daño_desperfecto: { icon: '🚧', label: 'Falla o Daños', badgeClass: 'bg-amber-50 border-amber-200/80' },
    infraestructura: { icon: '🚧', label: 'Infraestructura', badgeClass: 'bg-amber-50 border-amber-200/80' },
    alarma: { icon: '🚨', label: 'Alarmas', badgeClass: 'bg-rose-50 border-rose-200/80' },
    emergencia: { icon: '🆘', label: 'SOS Emergencia', badgeClass: 'bg-red-50 border-red-200/80' },
    objeto_encontrado: { icon: '📦', label: 'Objeto Encontrado', badgeClass: 'bg-emerald-50 border-emerald-200/80' },
    requiere_seguimiento: { icon: '👁️', label: 'Requiere Seguimiento', badgeClass: 'bg-purple-50 border-purple-200/80' },
    seguridad: { icon: '🛡️', label: 'Seguridad', badgeClass: 'bg-blue-50 border-blue-200/80' },
    persona_sospechosa: { icon: '🕵️', label: 'Persona Sospechosa', badgeClass: 'bg-orange-50 border-orange-200/80' },
    entrega_recepcion_turno: { icon: '🔄', label: 'Entrega de Turno', badgeClass: 'bg-teal-50 border-teal-200/80' },
    otro: { icon: '📝', label: 'Otro', badgeClass: 'bg-slate-50 border-slate-200/80' },
};

const getCategoriaMeta = (categoria?: string) =>
    (categoria && CATEGORIA_META[categoria]) || CATEGORIA_META.otro;

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

// ─── Página Admin / Supervisor: Libro de Novedades ────────────────────────────
const AdminLibroNovedadesPage: React.FC = () => {
    const { sites, guardRounds, novedades, currentUser, employees, fetchGuardRounds } = useAppStore();
    const [activeTab, setActiveTab] = useState<'historial' | 'seguimiento'>('historial');
    const [novedadToInit, setNovedadToInit] = useState<any>(null);
    const [novedadAbierta, setNovedadAbierta] = useState<any>(null);

    const isSupervisor = currentUser?.role === 'supervisor';

    const supervisorAssignedSiteIds = useMemo(() => {
        if (!isSupervisor) return null;
        const emp = employees.find(
            e => e.id === currentUser?.uid || (currentUser?.email && e.email?.toLowerCase() === currentUser.email.toLowerCase())
        );
        return new Set((emp?.assignedSites || []).map(id => String(id)));
    }, [isSupervisor, employees, currentUser?.uid, currentUser?.email]);

    const adminUser = useMemo(() => {
        const emp = employees.find(
            e => e.id === currentUser?.uid || (currentUser?.email && e.email?.toLowerCase() === currentUser.email.toLowerCase())
        );
        const fallbackName = isSupervisor ? 'Supervisor' : 'Administrador';
        return {
            uid: currentUser?.uid || '',
            nombre: emp ? `${emp.firstName} ${emp.lastNamePaterno}` : fallbackName,
            rol: currentUser?.role || 'admin'
        };
    }, [currentUser, employees, isSupervisor]);

    useEffect(() => {
        fetchGuardRounds();
    }, [fetchGuardRounds]);

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

    // Cerrar dropdown al hacer clic/toque fuera
    useEffect(() => {
        const handleClickOutside = (e: PointerEvent) => {
            if (siteSearchRef.current && !siteSearchRef.current.contains(e.target as Node)) {
                setShowSiteList(false);
                // Si el input quedó vacío o no coincide con ninguna sucursal, restaurar a "Todas"
                if (!siteInputValue) {
                    setSiteFilter('all');
                }
            }
        };
        document.addEventListener('pointerdown', handleClickOutside);
        return () => document.removeEventListener('pointerdown', handleClickOutside);
    }, [siteInputValue]);

    // IDs de sucursales Falabella — igual que ShiftManagement: detecta por empresa (cliente) o nombre
    const isFalabellaSite = (s: any) =>
        normalizeText(s.empresa || '').includes('falabella') ||
        normalizeText(s.name || '').includes('falabella');

    const falabellaSiteIds = useMemo(() =>
        new Set(sites.filter((s: any) => s.active !== false && isFalabellaSite(s)).map((s: any) => String(s.id)))
    , [sites]);

    // Sucursales visibles en el dropdown:
    // - Supervisor: exclusivamente las sucursales asignadas por el administrador
    // - Admin: solo activas, por defecto sin Falabella; con check, incluye Falabella
    const sitesForSelector = useMemo(() => {
        return sites.filter((s: any) => {
            if (s.active === false) return false; // excluir inactivas
            if (isSupervisor) {
                return supervisorAssignedSiteIds?.has(String(s.id)) ?? false;
            }
            const isFalabella = isFalabellaSite(s);
            return includeFalabella ? true : !isFalabella;
        });
    }, [sites, includeFalabella, isSupervisor, supervisorAssignedSiteIds]);

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
            // Campos derivados para UI (mantiene compatibilidad legacy)
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

            // Campos del modelo de dominio real preservados para lógica de negocio
            tipoRegistro: n.tipoRegistro,
            estado: n.estado,
            categoria: n.categoria,
            requiereSeguimiento: n.requiereSeguimiento,
            unreadAdminCount: n.unreadAdminCount,
            unreadWorkerCount: n.unreadWorkerCount,
            cantidadSeguimientos: n.cantidadSeguimientos,
        }));

        return [...roundItems, ...novedadItems].sort((a: any, b: any) =>
            b.timestamp.localeCompare(a.timestamp)
        );
    }, [guardRounds, localNovedades]);

    const filtered = timelineItems.filter((item: any) => {
        if (isSupervisor) {
            if (!supervisorAssignedSiteIds || !supervisorAssignedSiteIds.has(String(item.siteId))) {
                return false;
            }
        } else {
            // Excluir Falabella del contenido si el check no está activo (solo admin)
            const isFalabellaItem = falabellaSiteIds.has(item.siteId);
            if (!includeFalabella && isFalabellaItem) return false;
        }
        const dateStr = (item.timestamp || '').substring(0, 10);
        const matchDate = (!startDate || dateStr >= startDate) && (!endDate || dateStr <= endDate);
        const matchTipo = tipoFilter === 'all' || item.tipo === tipoFilter;
        const matchSite = siteFilter === 'all' || item.siteId === siteFilter;
        const matchPrioridad = prioridadFilter === 'all' || item.prioridad === prioridadFilter;
        const q = searchText.trim().toLowerCase();
        const catMetaForSearch = item.tipo !== 'ronda' ? getCategoriaMeta(item.categoria) : null;
        const matchSearch = !q || [
            item.descripcion,
            item.guardName,
            item.sucursalName,
            item.tipo,
            item.categoria,
            catMetaForSearch?.label,
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
        <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-5">
            {/* Encabezado */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                    <h3 className="text-lg sm:text-xl font-black text-slate-800">Libro de Novedades</h3>
                    <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                        {isSupervisor
                            ? 'Novedades operacionales y seguimiento de tus sucursales asignadas'
                            : 'Gestión de novedades operacionales y seguimiento de instalaciones'}
                    </p>
                </div>
                {isSupervisor && (
                    <span className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100 text-[11px] font-bold">
                        <MapPin size={12} />
                        {sitesForSelector.length} {sitesForSelector.length === 1 ? 'sucursal asignada' : 'sucursales asignadas'}
                    </span>
                )}
            </div>

            {isSupervisor && supervisorAssignedSiteIds && supervisorAssignedSiteIds.size === 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
                    <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs sm:text-sm font-bold text-amber-800">
                        No tienes sucursales asignadas actualmente. Solicita al administrador la asignación de sucursales para consultar sus novedades.
                    </p>
                </div>
            )}

            {/* TABS */}
            <div className="flex gap-2 sm:gap-4 border-b border-slate-200 overflow-x-auto scrollbar-none">
                <button
                    onClick={() => setActiveTab('historial')}
                    className={`pb-3 font-bold text-xs sm:text-sm px-2 border-b-2 transition-all flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${
                        activeTab === 'historial' 
                        ? 'border-blue-600 text-blue-600' 
                        : 'border-transparent text-slate-400 hover:text-slate-600'
                    }`}
                >
                    <BookOpen size={16} /> Historial General
                </button>
                <button
                    onClick={() => setActiveTab('seguimiento')}
                    className={`pb-3 font-bold text-xs sm:text-sm px-2 border-b-2 transition-all flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${
                        activeTab === 'seguimiento' 
                        ? 'border-blue-600 text-blue-600' 
                        : 'border-transparent text-slate-400 hover:text-slate-600'
                    }`}
                >
                    <Clock size={16} /> Novedades con seguimiento
                </button>
            </div>

            {activeTab === 'historial' ? (
              <>
            {/* Panel de filtros */}
            <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-4 shadow-sm flex flex-col gap-3">
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
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2.5 sm:gap-3 items-end">
                    {/* Fechas */}
                    <div className="w-full sm:w-auto">
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Desde</label>
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                            className="w-full px-2.5 sm:px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div className="w-full sm:w-auto">
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Hasta</label>
                        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                            className="w-full px-2.5 sm:px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>

                    {/* Tipo */}
                    <div className="w-full sm:w-auto">
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Tipo</label>
                        <select value={tipoFilter} onChange={e => setTipoFilter(e.target.value)}
                            className="w-full px-2.5 sm:px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none">
                            <option value="all">Todos los tipos</option>
                            <option value="ronda">Ronda</option>
                            <option value="incidente">Incidente</option>
                            <option value="alerta">Alerta</option>
                            <option value="novedad">Novedad</option>
                            <option value="otro">Otro</option>
                        </select>
                    </div>

                    {/* Prioridad */}
                    <div className="w-full sm:w-auto">
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Prioridad</label>
                        <select value={prioridadFilter} onChange={e => setPrioridadFilter(e.target.value)}
                            className="w-full px-2.5 sm:px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none">
                            <option value="all">Todas</option>
                            <option value="informativa">Informativa</option>
                            <option value="media">Media</option>
                            <option value="alta">Alta</option>
                            <option value="critica">Crítica</option>
                        </select>
                    </div>

                    {/* ── Selector de Instalación con buscador ─────────────────── */}
                    <div className="col-span-2 sm:col-span-1 flex flex-col gap-1.5 w-full sm:w-auto">
                        <label className="text-[10px] font-bold text-slate-400 uppercase block">Instalación</label>

                        {/* Combobox */}
                        <div className="relative" ref={siteSearchRef}>
                            <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 z-10 pointer-events-none" />
                            <input
                                type="text"
                                placeholder={isSupervisor ? "Filtrar mis sucursales..." : "Buscar sucursal..."}
                                className="pl-8 pr-8 py-2 border border-slate-200 rounded-xl text-sm w-full sm:w-64 focus:ring-2 focus:ring-blue-500 outline-none bg-slate-50 text-slate-800 font-medium"
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
                                <div className="absolute top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-64 sm:max-h-[400px] overflow-y-auto z-[120]">
                                    <div
                                        className={`px-4 py-2.5 hover:bg-blue-50 cursor-pointer border-b border-slate-100 text-xs font-black uppercase tracking-wider text-blue-600 ${siteFilter === 'all' ? 'bg-blue-50/60' : ''}`}
                                        onClick={() => {
                                            setSiteFilter('all');
                                            setSiteInputValue('');
                                            setShowSiteList(false);
                                        }}
                                    >
                                        {isSupervisor ? 'Todas mis sucursales asignadas' : 'Todas las instalaciones'}
                                    </div>
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

                        {/* Checkbox Falabella (solo admin) */}
                        {!isSupervisor && (
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
                        )}
                    </div>

                    {/* Contador de resultados */}
                    <div className="col-span-2 sm:col-span-1 sm:ml-auto flex flex-wrap items-center justify-end gap-2 self-end pb-0.5">
                        {selectedSiteName && (
                            <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg flex items-center gap-1 max-w-full truncate">
                                <MapPin size={9} className="shrink-0" />
                                <span className="truncate">{selectedSiteName}</span>
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
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 sm:p-16 text-center">
                    <BookOpen size={40} className="text-slate-200 mx-auto mb-3" />
                    <p className="font-bold text-slate-400 text-sm sm:text-base">Sin registros en el período seleccionado</p>
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
                        const catMeta = item.tipo !== 'ronda' ? getCategoriaMeta(item.categoria) : null;
                        return (
                            <React.Fragment key={item.id}>
                                {showSep && (
                                    <div className="flex items-center gap-3 py-2">
                                        <div className="flex-1 h-px bg-slate-100" />
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">
                                            {new Date(currDate + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: '2-digit', month: 'long' })}
                                        </span>
                                        <div className="flex-1 h-px bg-slate-100" />
                                    </div>
                                )}
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 sm:p-4 hover:shadow-md transition-all flex items-start gap-2.5 sm:gap-4">
                                    <div className="text-right shrink-0 w-11 sm:w-14">
                                        <p className="text-xs sm:text-sm font-black text-slate-800">{fmtTime(item.timestamp)}</p>
                                    </div>
                                    <div className="flex flex-col items-center shrink-0 pt-1.5">
                                        <div className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full border-2 ${dotColor}`} />
                                    </div>
                                    <div className="flex-1 min-w-0 relative">
                                        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                                            {catMeta && (
                                                <span
                                                    title={`Categoría: ${catMeta.label}`}
                                                    aria-label={catMeta.label}
                                                    className={`inline-flex items-center justify-center w-6 h-6 rounded-lg border text-sm leading-none shrink-0 select-none ${catMeta.badgeClass}`}
                                                >
                                                    {catMeta.icon}
                                                </span>
                                            )}
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
                                        <p className="text-xs sm:text-sm text-slate-600 mt-1 leading-relaxed break-words">{item.descripcion}</p>
                                        {item.evidencias && item.evidencias.length > 0 && (
                                            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                                                {item.evidencias.map((url: string, eIdx: number) => (
                                                    <div key={eIdx} onClick={() => setSelectedImage(url)} className="shrink-0 w-16 h-16 rounded-xl border border-slate-200 overflow-hidden cursor-pointer hover:border-blue-400 hover:shadow-sm transition">
                                                        <ThumbnailImage photoUrl={url} alt={`Evidencia ${eIdx + 1}`} className="w-full h-full object-cover" />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {/* Acciones */}
                                        {esEsquemaNuevo(item) && (
                                            <div className="mt-3 flex justify-end">
                                                {item.requiereSeguimiento === true || item.estado === 'resuelta' ? (
                                                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                                                        {item.unreadAdminCount ? (
                                                            <div className="bg-red-500 text-white text-[10px] font-black rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center shadow-sm animate-bounce">
                                                                {item.unreadAdminCount}
                                                            </div>
                                                        ) : null}
                                                        <button
                                                            onClick={() => setNovedadAbierta(item)}
                                                            className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-100 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5"
                                                        >
                                                            <BookOpen size={14} />
                                                            Mostrar Seguimiento
                                                        </button>
                                                    </div>
                                                ) : (item.estado === 'registrada' || item.estado === 'en_revision') && item.requiereSeguimiento !== true ? (
                                                    <button
                                                        onClick={() => setNovedadToInit(item)}
                                                        className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-100 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5"
                                                    >
                                                        <PlayCircle size={14} />
                                                        Dar seguimiento
                                                    </button>
                                                ) : null}
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
                <div className="flex justify-between items-center bg-white p-3 sm:p-4 rounded-2xl border border-slate-100 shadow-sm mt-4">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-3 sm:px-4 py-2 bg-slate-50 text-slate-600 rounded-xl disabled:opacity-50 font-bold text-xs sm:text-sm hover:bg-slate-100 transition-colors"
                    >
                        Anterior
                    </button>
                    <span className="text-xs sm:text-sm font-bold text-slate-500">Página {page} de {totalPages}</span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="px-3 sm:px-4 py-2 bg-slate-50 text-slate-600 rounded-xl disabled:opacity-50 font-bold text-xs sm:text-sm hover:bg-slate-100 transition-colors"
                    >
                        Siguiente
                    </button>
                </div>
            )}

            {/* Lightbox de evidencias */}
            {selectedImage && (
                <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedImage(null)}>
                    <button onClick={() => setSelectedImage(null)} className="fixed top-4 right-4 z-[110] w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full text-white flex items-center justify-center text-2xl font-bold leading-none">
                        &times;
                    </button>
                    <div className="relative max-w-4xl max-h-[85vh] w-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                        <ThumbnailImage photoUrl={selectedImage} alt="Fullscreen Evidence" className="max-w-full max-h-[85vh] object-contain rounded-xl" />
                    </div>
                </div>
            )}

            {/* Modal para iniciar seguimiento */}
            {novedadToInit && (
                <IniciarSeguimientoModal
                    novedad={novedadToInit}
                    onClose={() => setNovedadToInit(null)}
                    onSuccess={() => {
                        setNovedadToInit(null);
                    }}
                />
            )}

            {/* Modal para mostrar seguimiento */}
            {novedadAbierta && (
                <NovedadSeguimientoModal
                    novedad={novedadAbierta}
                    usuario={adminUser}
                    onClose={() => setNovedadAbierta(null)}
                />
            )}
            </>
            ) : (
                <AdminNovedadesSeguimiento />
            )}
        </div>
    );
};

export default AdminLibroNovedadesPage;
