import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  ChevronRight,
  CloudOff,
  Loader2,
  Plus,
  PlayCircle,
  Search,
  Trash2,
  WifiOff,
  MessageSquareText,
  Pin,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useAppVersion } from '../../hooks/useAppVersion';
import { VisitaDraft, VisitaSupervisorDoc } from '../../lib/visitasSupervisor/visitasTypes';
import { crearBorrador } from '../../lib/visitasSupervisor/visitasLogic';
import {
  VisitasDraftService,
  VisitaPendienteLocal,
  encolarVisita,
  esperarSincronizacionVisita,
  fetchVisitasSupervisor,
  subscribeVisitasSupervisor,
  listarVisitasPendientesLocales,
} from '../../lib/visitasSupervisor/visitasService';
import { SyncQueueService } from '../../lib/SyncQueueService';
import FormularioVisita from './FormularioVisita';
import VisitaDetalleModal from './VisitaDetalleModal';
import { ResultadoBadge, formatearFecha, formatearHora } from './visitasUi';

type Modo = 'inicio' | 'elegir' | 'visita' | 'fin';
type EstadoEnvio = 'guardada' | 'enviando' | 'sincronizada' | 'pendiente';

const SupervisorVisitas: React.FC = () => {
  const currentUser = useAppStore(s => s.currentUser);
  const sites = useAppStore(s => s.sites);
  const employees = useAppStore(s => s.employees);
  const processSyncQueue = useAppStore(s => s.processSyncQueue);
  const isSyncing = useAppStore(s => s.isSyncing);
  const showConfirmation = useAppStore(s => s.showConfirmation);
  const { connected } = useNetworkStatus();
  const appVersion = useAppVersion();

  const uid = currentUser?.uid ?? '';
  const [modo, setModo] = useState<Modo>('inicio');
  const [draft, setDraft] = useState<VisitaDraft | null>(null);
  const [borradorGuardado, setBorradorGuardado] = useState<VisitaDraft | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [estadoEnvio, setEstadoEnvio] = useState<EstadoEnvio>('guardada');
  const [pendientes, setPendientes] = useState<VisitaPendienteLocal[]>([]);
  const [recientes, setRecientes] = useState<VisitaSupervisorDoc[]>([]);
  const [cargandoRecientes, setCargandoRecientes] = useState(false);
  const [detalle, setDetalle] = useState<{ visita: VisitaSupervisorDoc; openSeguimiento: boolean } | null>(null);
  const [reintentandoId, setReintentandoId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Nombre del supervisor desde la sesión/perfil (no se pregunta). Cache para uso offline. ──
  const supervisorNombre = useMemo(() => {
    const me = employees.find(e => e.id === uid);
    const key = `visitas_nombre_${uid}`;
    if (me) {
      const n = `${me.firstName} ${me.lastNamePaterno}`.trim();
      try { localStorage.setItem(key, n); } catch { /* noop */ }
      return n;
    }
    try {
      const cached = localStorage.getItem(key);
      if (cached) return cached;
    } catch { /* noop */ }
    return currentUser?.email || 'Supervisor';
  }, [employees, uid, currentUser?.email]);

  const assignedSites = useMemo(() => employees.find(e => e.id === uid)?.assignedSites ?? [], [employees, uid]);

  // ── Carga de datos del inicio ───────────────────────────────────────────
  const refrescarPendientes = useCallback(async () => {
    if (!uid) return;
    setPendientes(await listarVisitasPendientesLocales(uid));
  }, [uid]);

  const handleReintentarPendiente = async (visitId: string) => {
    if (!connected || reintentandoId === visitId) return;
    setReintentandoId(visitId);
    try {
      await SyncQueueService.resetRetriesForVisit(visitId);
      await processSyncQueue();
      await refrescarPendientes();
    } finally {
      setReintentandoId(null);
    }
  };

  const ordenarRecientes = useCallback((data: VisitaSupervisorDoc[]) => {
    return [...data].sort((a, b) => {
      // 1. Pinned first (si el admin la fijó, también se ve arriba para el supervisor)
      if (a.fijadaPorAdmin && !b.fijadaPorAdmin) return -1;
      if (!a.fijadaPorAdmin && b.fijadaPorAdmin) return 1;

      // 2. Unread messages for supervisor
      if (a.noLeidosSupervisor && !b.noLeidosSupervisor) return -1;
      if (!a.noLeidosSupervisor && b.noLeidosSupervisor) return 1;

      // 3. Last activity
      const tsA = a.ultimoSeguimientoEn?.toMillis?.() ?? (a.ultimoSeguimientoEn ? new Date(a.ultimoSeguimientoEn).getTime() : new Date(a.inicioEn).getTime());
      const tsB = b.ultimoSeguimientoEn?.toMillis?.() ?? (b.ultimoSeguimientoEn ? new Date(b.ultimoSeguimientoEn).getTime() : new Date(b.inicioEn).getTime());

      return tsB - tsA;
    });
  }, []);

  const refrescarRecientes = useCallback(async () => {
    if (!uid || !connected) return;
    setCargandoRecientes(true);
    try {
      const data = await fetchVisitasSupervisor(uid, 15);
      setRecientes(ordenarRecientes(data));
    } catch (e) {
      console.warn('[Visitas] No se pudieron cargar visitas recientes:', e);
    } finally {
      setCargandoRecientes(false);
    }
  }, [uid, connected, ordenarRecientes]);

  // Al montar: recuperar borrador (cierre/reapertura de la app durante una visita)
  useEffect(() => {
    if (!uid) return;
    VisitasDraftService.load(uid).then(setBorradorGuardado);
  }, [uid]);

  useEffect(() => {
    if (modo === 'inicio') {
      refrescarPendientes();
      refrescarRecientes();
    }
  }, [modo, isSyncing, refrescarPendientes, refrescarRecientes]);

  // Tiempo real: mensajes de seguimiento nuevos y lecturas se reflejan al instante (sin F5)
  useEffect(() => {
    if (!uid || modo !== 'inicio') return;
    const unsubscribe = subscribeVisitasSupervisor(uid, (data) => {
      setRecientes(ordenarRecientes(data.slice(0, 15)));
    });
    return () => unsubscribe();
  }, [uid, modo, ordenarRecientes]);

  // Visita viva para el modal de detalle (evita copia congelada con contadores obsoletos)
  const detalleVivo = useMemo(() => {
    if (!detalle) return null;
    const viva = recientes.find(r => r.id === detalle.visita.id);
    return { ...detalle, visita: viva ?? detalle.visita };
  }, [detalle, recientes]);

  // ── Borrador: autoguardado local (debounce) ─────────────────────────────
  const updateDraft = useCallback((fn: (d: VisitaDraft) => VisitaDraft) => {
    setDraft(prev => {
      if (!prev) return prev;
      const next = fn(prev);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => VisitasDraftService.save(next), 500);
      return next;
    });
  }, []);

  // ── Acciones ────────────────────────────────────────────────────────────
  const iniciarVisita = async (sucursalId: number | string, sucursalNombre: string) => {
    const nuevo = crearBorrador({ supervisorUid: uid, sucursalId, sucursalNombre });
    await VisitasDraftService.save(nuevo);
    setDraft(nuevo);
    setModo('visita');
  };

  const continuarVisita = () => {
    if (!borradorGuardado) return;
    setDraft(borradorGuardado);
    setModo('visita');
  };

  const descartarBorrador = () => {
    showConfirmation({
      title: 'Descartar visita en curso',
      message: 'Se perderá lo que había completado de esa visita. ¿Desea descartarla?',
      type: 'confirm',
      onConfirm: async () => {
        await VisitasDraftService.clear(uid);
        setBorradorGuardado(null);
      },
    });
  };

  const salirDeVisita = async () => {
    // El borrador ya está en disco; recargarlo para mostrar "continuar"
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (draft) await VisitasDraftService.save(draft);
    setBorradorGuardado(await VisitasDraftService.load(uid));
    setDraft(null);
    setModo('inicio');
  };

  const enviarVisita = async () => {
    if (!draft) return;
    // 1. Guardar localmente (no depende de internet). Idempotente.
    await encolarVisita(draft, supervisorNombre);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await VisitasDraftService.clear(uid);
    setBorradorGuardado(null);
    const visitId = draft.visitId;

    // 2. Confirmación inmediata al supervisor
    setEstadoEnvio(connected ? 'enviando' : 'pendiente');
    setModo('fin');
    setDraft(null);

    // 3. Intentar sincronizar en segundo plano (sin bloquear la pantalla)
    if (connected) {
      processSyncQueue().catch(() => {});
      const ok = await esperarSincronizacionVisita(visitId);
      setEstadoEnvio(ok ? 'sincronizada' : 'pendiente');
    }
  };

  // ── Sucursales disponibles ──────────────────────────────────────────────
  const sucursales = useMemo(() => {
    const activas = sites.filter(s => s.active !== false);
    const isAdmin = currentUser?.role === 'admin';
    const permitidas = isAdmin ? activas : activas.filter(s => assignedSites.includes(s.id));
    const q = busqueda.trim().toLowerCase();
    const filtradas = q
      ? permitidas.filter(s => `${s.name} ${s.address ?? ''}`.toLowerCase().includes(q))
      : permitidas;
    const porNombre = [...filtradas].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    return { mias: porNombre, otras: [] as (typeof sites) };
  }, [sites, busqueda, assignedSites, currentUser?.role]);

  // ═════════════ RENDER ═════════════

  if (modo === 'visita' && draft) {
    return (
      <FormularioVisita
        draft={draft}
        supervisorNombre={supervisorNombre}
        updateDraft={updateDraft}
        onSubmit={enviarVisita}
        onExit={salirDeVisita}
      />
    );
  }

  if (modo === 'fin') {
    const cfg = {
      guardada: { icon: <Loader2 className="animate-spin" size={64} />, color: 'bg-blue-100 text-blue-800', titulo: 'Guardando…', sub: '' },
      enviando: { icon: <CheckCircle2 size={72} />, color: 'bg-emerald-100 text-emerald-700', titulo: 'Visita guardada', sub: 'Enviando al sistema…' },
      sincronizada: { icon: <CheckCircle2 size={72} />, color: 'bg-emerald-100 text-emerald-700', titulo: '🟢 Visita registrada correctamente', sub: 'Ya está disponible para la administración.' },
      pendiente: { icon: <CloudOff size={72} />, color: 'bg-amber-100 text-amber-700', titulo: '🟠 Visita guardada', sub: 'Se enviará automáticamente cuando exista conexión.' },
    }[estadoEnvio];
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center gap-6 p-6 text-center animate-in zoom-in-95 fade-in duration-300">
        <div className={`w-32 h-32 rounded-full flex items-center justify-center ${cfg.color}`}>{cfg.icon}</div>
        <div className="space-y-2">
          <h1 className="text-3xl font-black text-slate-900 leading-tight">{cfg.titulo}</h1>
          {cfg.sub && <p className="text-xl font-bold text-slate-600">{cfg.sub}</p>}
          {estadoEnvio === 'enviando' && <Loader2 className="animate-spin mx-auto text-slate-400" size={28} />}
        </div>
        <button
          id="visita-volver-inicio"
          onClick={() => setModo('inicio')}
          className="w-full max-w-sm min-h-[72px] rounded-2xl bg-slate-900 text-white text-xl font-black active:scale-95"
        >
          VOLVER AL INICIO
        </button>
      </div>
    );
  }

  if (modo === 'elegir') {
    const Fila: React.FC<{ s: { id: number; name: string; address?: string } }> = ({ s }) => (
      <button
        onClick={() => iniciarVisita(s.id, s.name)}
        className="w-full min-h-[76px] bg-white rounded-2xl border-4 border-slate-200 hover:border-blue-500 px-4 py-3 flex items-center gap-3 text-left active:scale-[0.98] transition-all"
      >
        <span className="shrink-0 w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center"><Building2 size={26} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-xl font-black text-slate-900 leading-tight">{s.name}</span>
          {s.address && <span className="block text-sm font-semibold text-slate-500 truncate">{s.address}</span>}
        </span>
        <ChevronRight size={26} className="text-slate-400 shrink-0" aria-hidden />
      </button>
    );
    return (
      <div className="min-h-full bg-slate-100 pb-10">
        <header className="sticky top-0 z-30 bg-white border-b-4 border-slate-200 p-3 space-y-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setModo('inicio')} aria-label="Volver" className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center active:scale-95">
              <ArrowLeft size={28} />
            </button>
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Nueva visita</p>
              <h1 className="text-2xl font-black text-slate-900 leading-tight">Sucursal a visitar</h1>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={22} aria-hidden />
            <input
              type="search"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar sucursal…"
              aria-label="Buscar sucursal"
              className="w-full rounded-2xl border-4 border-slate-300 focus:border-blue-600 focus:outline-none pl-12 pr-4 py-3 text-lg font-semibold"
            />
          </div>
        </header>
        <div className="p-4 space-y-3 max-w-2xl mx-auto">
          {sucursales.mias.length > 0 && (
            <>
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-500 pt-1">Mis sucursales</h2>
              {sucursales.mias.map(s => <Fila key={s.id} s={s} />)}
              {sucursales.otras.length > 0 && <h2 className="text-sm font-black uppercase tracking-widest text-slate-500 pt-3">Otras sucursales</h2>}
            </>
          )}
          {sucursales.otras.map(s => <Fila key={s.id} s={s} />)}
          {sucursales.mias.length + sucursales.otras.length === 0 && (
            <p className="text-center text-lg font-bold text-slate-500 py-10">No se encontraron sucursales.</p>
          )}
        </div>
      </div>
    );
  }

  // ── Inicio del módulo ─────────────────────────────────────────────────────
  return (
    <div className="min-h-full bg-slate-100 p-4 pb-24">
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <h1 className="text-3xl font-black text-slate-900 leading-tight">Visitas de Supervisor</h1>
          <div className="flex items-center justify-between">
            <p className="text-base font-semibold text-slate-600">Hola, {supervisorNombre}</p>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">v{appVersion}</span>
          </div>
          {!connected && (
            <p className="mt-2 inline-flex items-center gap-2 text-sm font-black text-amber-900 bg-amber-100 border-2 border-amber-300 rounded-full px-3 py-1">
              <WifiOff size={16} aria-hidden /> Sin conexión: puede trabajar igual, se enviará después.
            </p>
          )}
        </div>

        {borradorGuardado && (
          <div className="bg-amber-50 border-4 border-amber-400 rounded-3xl p-4 space-y-3">
            <p className="text-lg font-black text-amber-900">Tiene una visita en curso</p>
            <p className="text-xl font-black text-slate-900">{borradorGuardado.sucursalNombre}</p>
            <p className="text-sm font-semibold text-slate-600">Iniciada a las {formatearHora(borradorGuardado.inicioEn)}</p>
            <button
              id="visita-continuar"
              onClick={continuarVisita}
              className="w-full min-h-[72px] rounded-2xl bg-amber-500 text-white text-xl font-black flex items-center justify-center gap-3 shadow-lg active:scale-95"
            >
              <PlayCircle size={28} aria-hidden /> CONTINUAR VISITA
            </button>
            <button
              onClick={descartarBorrador}
              className="w-full min-h-[52px] rounded-2xl border-2 border-slate-400 text-slate-700 text-base font-black flex items-center justify-center gap-2 active:scale-95"
            >
              <Trash2 size={18} aria-hidden /> Descartar esta visita
            </button>
          </div>
        )}

        <button
          id="visita-nueva"
          onClick={() => setModo('elegir')}
          className="w-full min-h-[96px] rounded-3xl bg-emerald-600 text-white text-2xl font-black flex items-center justify-center gap-3 shadow-xl active:scale-95 transition-all"
        >
          <Plus size={36} strokeWidth={4} aria-hidden /> NUEVA VISITA
        </button>

        {pendientes.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-black uppercase tracking-widest text-amber-800">Pendientes de envío ({pendientes.length})</h2>
            {pendientes.map(p => (
              <button
                key={p.visitId}
                onClick={() => handleReintentarPendiente(p.visitId)}
                disabled={!connected || reintentandoId === p.visitId}
                className="w-full text-left bg-amber-50 border-4 border-amber-300 rounded-2xl p-3 flex items-center gap-3 transition-colors active:bg-amber-100 disabled:opacity-80 disabled:active:bg-amber-50 relative overflow-hidden"
              >
                {reintentandoId === p.visitId ? (
                  <Loader2 className="text-amber-700 shrink-0 animate-spin" size={26} aria-hidden />
                ) : (
                  <CloudOff className="text-amber-700 shrink-0" size={26} aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-black text-slate-900 truncate">{p.data.sucursalNombre}</p>
                  <p className="text-sm font-semibold text-slate-600">
                    {formatearFecha(p.data.inicioEn)} · {formatearHora(p.data.inicioEn)} · {reintentandoId === p.visitId ? 'Reintentando enviar...' : 'Se enviará al tener conexión'}
                  </p>
                </div>
                {reintentandoId !== p.visitId && <ResultadoBadge resultado={p.data.resultado} prioridadNovedad={p.data.novedadRelevante?.prioridad} />}
              </button>
            ))}
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
            Mis visitas recientes {cargandoRecientes && <Loader2 className="animate-spin" size={14} />}
          </h2>
          {recientes.length === 0 && !cargandoRecientes && (
            <p className="text-base font-semibold text-slate-500 bg-white rounded-2xl border-2 border-slate-200 p-4">
              {connected ? 'Aún no hay visitas registradas.' : 'Conéctese para ver sus visitas anteriores.'}
            </p>
          )}
          {recientes.map(v => (
            <div
              key={v.id}
              className={`w-full bg-white border-4 rounded-2xl flex relative overflow-hidden transition-all ${v.fijadaPorAdmin ? 'border-amber-400 bg-amber-50/30' : 'border-slate-200 shadow-sm hover:border-blue-400'}`}
            >
              {v.fijadaPorAdmin && (
                <div className="absolute top-0 left-0 w-8 h-8 rounded-br-xl flex items-center justify-center bg-amber-100 text-amber-600 z-20 pointer-events-none" title="Fijada por administrador">
                  <Pin size={16} className="fill-amber-600" />
                </div>
              )}

              {/* Botón central (abre detalles de la visita) */}
              <button
                type="button"
                onClick={() => setDetalle({ visita: v, openSeguimiento: false })}
                className="flex-1 flex items-center gap-3 p-4 text-left active:scale-[0.98] outline-none w-full"
              >
                <div className="min-w-0 flex-1 pt-3">
                  <p className="text-lg font-black text-slate-900 truncate">{v.sucursalNombre}</p>
                  <p className="text-sm font-semibold text-slate-600">{formatearFecha(v.inicioEn)} · {formatearHora(v.inicioEn)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <ResultadoBadge resultado={v.resultado} prioridadNovedad={v.novedadRelevante?.prioridad} />
                    {v.noLeidosSupervisor ? (
                      <span className="inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-full border-2 bg-red-100 text-red-700 border-red-300">
                        <MessageSquareText size={12} aria-hidden /> {v.noLeidosSupervisor} mensaje(s)
                      </span>
                    ) : null}
                  </div>
                </div>
                <ChevronRight className="text-slate-400 shrink-0" size={24} aria-hidden />
              </button>

              {v.estado === 'resuelta' && (
                <div className="absolute top-2 right-2 flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 shadow-sm z-20 pointer-events-none">
                  <CheckCircle2 size={14} />
                  <span className="text-[10px] font-black uppercase tracking-wider">Resuelta</span>
                </div>
              )}

              {v.requiereSeguimiento && v.estado !== 'resuelta' && !v.noLeidosSupervisor && (
                <button
                  type="button"
                  onClick={() => setDetalle({ visita: v, openSeguimiento: true })}
                  className="absolute top-2 right-2 flex items-center gap-1 text-blue-700 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-full border border-blue-200 shadow-sm z-20 transition-colors active:scale-95 cursor-pointer"
                >
                  <span className="text-[10px] font-black uppercase tracking-wider underline">Ver Seguimiento</span>
                </button>
              )}
            </div>
          ))}
        </section>

        <div className="pt-6 pb-2 text-center text-[9px] font-black text-slate-400 uppercase tracking-widest">
          ASPRO APP v{appVersion}
        </div>
      </div>

      {detalleVivo && <VisitaDetalleModal visita={detalleVivo.visita} openSeguimientoOnInit={detalleVivo.openSeguimiento} onClose={() => setDetalle(null)} />}
    </div>
  );
};

export default SupervisorVisitas;
