import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellRing,
  BookOpen,
  CheckCheck,
  ClipboardCheck,
  MessageSquareWarning,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { normalizeSiteId } from '../../lib/supervisor/gestionIncidenciaService';
import {
  type NotificacionSupervisor,
  marcarNotificacionLeida,
  marcarTodasLeidas,
  resolveOrigenTipo,
  subscribeNotificacionesSupervisor,
} from '../../lib/supervisor/notificacionesSupervisorService';

interface Props {
  /** Navegación de la app (handleNavChange) */
  onNavigate: (view: any) => void;
  /** Clase de posición vertical (para esquivar la barra inferior móvil) */
  bottomClassName?: string;
}

const formatRelative = (ms: number) => {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(ms).toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const playSound = () => {
  try {
    const audio = new Audio('/Notificacion-GGSS.mp3');
    audio.volume = 0.85;
    void audio.play().catch(() => undefined);
  } catch {
    /* sin audio disponible */
  }
};

/**
 * Emite una notificación nativa del sistema / PWA exclusivamente para el perfil SUPERVISOR.
 */
const triggerSupervisorSystemPush = async (notif: NotificacionSupervisor) => {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  try {
    if (Notification.permission !== 'granted') return;
    const options: NotificationOptions = {
      body: notif.mensaje,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      tag: notif.id,
      data: {
        type: 'supervisor_inbox',
        vista: notif.vista,
        origenTipo: notif.origenTipo,
        origenId: notif.origenId,
      },
    };
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(notif.titulo, options);
        return;
      }
    }
    new Notification(notif.titulo, options);
  } catch {
    /* ignorar si el navegador restringe Notification directa */
  }
};

/**
 * Centro de Notificaciones en tiempo real (Supervisor / Administración / Jefatura).
 * - Supervisor: recibe alertas en tiempo real, sonido, vibración, notificación push y contador flotante.
 * - Administración / Jefatura: recibe únicamente el registro en el Centro de Mensajes y contador flotante
 *   (sin notificaciones push ni interrupciones sonoras en PC).
 */
export const NotificacionesSupervisorCenter: React.FC<Props> = ({
  onNavigate,
  bottomClassName = 'bottom-6',
}) => {
  const currentUser = useAppStore((s) => s.currentUser);
  const employees = useAppStore((s) => s.employees);
  const sites = useAppStore((s) => s.sites);
  const showNotification = useAppStore((s) => s.showNotification);

  const [items, setItems] = useState<NotificacionSupervisor[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'todas' | 'pendientes'>('pendientes');
  const [ringing, setRinging] = useState(false);
  const ringTimer = useRef<number | null>(null);

  const role = currentUser?.role;
  const enabled = role === 'supervisor' || role === 'admin' || role === 'jefe_operaciones';
  const uid = currentUser?.uid;

  const assignedSites = useMemo(() => {
    if (!uid) return [];
    if (role === 'admin' || role === 'jefe_operaciones') {
      return sites.filter((s) => s.active && s.name !== 'Administración').map((s) => s.id);
    }
    const emp = employees.find((e) => e.id === uid);
    return emp?.assignedSites || [];
  }, [uid, role, employees, sites]);

  const assignedSitesKey = useMemo(
    () => JSON.stringify(assignedSites.map(String).sort()),
    [assignedSites],
  );

  const siteNameLookup = useCallback(
    (siteId: string) => {
      const found = sites.find((s) => normalizeSiteId(s.id) === normalizeSiteId(siteId));
      return found?.name || '';
    },
    [sites],
  );

  useEffect(() => {
    if (!enabled || !uid) {
      setItems([]);
      return;
    }
    const unsub = subscribeNotificacionesSupervisor(
      {
        uid,
        role: role || 'supervisor',
        assignedSites,
        siteNameLookup,
      },
      (all, nuevas) => {
        setItems(all);
        // Notificaciones push/sonoras EXCLUSIVAMENTE para el perfil SUPERVISOR.
        // Al Administrador solo le quedan registradas en el Centro de Mensajes y en las tarjetas.
        if (nuevas.length > 0 && role === 'supervisor') {
          playSound();
          setRinging(true);
          if (ringTimer.current) window.clearTimeout(ringTimer.current);
          ringTimer.current = window.setTimeout(() => setRinging(false), 4500);

          const last = nuevas[0];
          showNotification(
            nuevas.length > 1
              ? `🔔 ${nuevas.length} mensajes nuevos: ${last.titulo}`
              : `🔔 ${last.titulo}: ${last.mensaje}`,
            'info',
          );
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([140, 70, 140]);
          }
          void triggerSupervisorSystemPush(last);
        }
      },
    );
    return () => {
      unsub();
      if (ringTimer.current) window.clearTimeout(ringTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, uid, role, assignedSitesKey, siteNameLookup, showNotification]);

  const unread = useMemo(() => items.filter((n) => !n.leida), [items]);
  const visible = filter === 'pendientes' ? unread : items;

  if (!enabled || !uid) return null;

  const handleOpenItem = (n: NotificacionSupervisor) => {
    if (!n.leida) {
      void marcarNotificacionLeida(n.id, uid);
    }
    setOpen(false);
    const origenTipo = resolveOrigenTipo(n);
    if (n.vista === 'dashboard' && origenTipo && n.origenId) {
      sessionStorage.setItem('aspro_open_alerta', `${origenTipo}_${n.origenId}`);
      onNavigate(role === 'supervisor' ? 'dashboard' : 'supervisor_dashboard');
      window.setTimeout(() => window.dispatchEvent(new Event('aspro:abrir-alerta')), 150);
    } else {
      onNavigate(n.vista);
    }
  };

  const iconFor = (tipo: NotificacionSupervisor['tipo']) => {
    if (tipo === 'novedad_urgente') return <ShieldAlert className="w-4 h-4" />;
    if (tipo === 'seguimiento_novedad' || tipo === 'visita_seguimiento') {
      return <BookOpen className="w-4 h-4" />;
    }
    if (tipo === 'respuesta_supervisor') return <ClipboardCheck className="w-4 h-4" />;
    return <MessageSquareWarning className="w-4 h-4" />;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Centro de Notificaciones"
        title={
          unread.length > 0
            ? `${unread.length} mensaje(s) pendiente(s) por revisar`
            : 'Centro de Mensajes y Notificaciones'
        }
        className={`fixed right-4 ${bottomClassName} z-40 w-13 h-13 rounded-full bg-slate-900 hover:bg-slate-800 text-white shadow-2xl border-2 border-white flex items-center justify-center active:scale-95 transition-all ${
          ringing ? 'animate-bounce ring-4 ring-red-500/40' : ''
        }`}
      >
        {unread.length > 0 ? (
          <BellRing className="w-5 h-5 text-amber-300" />
        ) : (
          <Bell className="w-5 h-5" />
        )}
        {unread.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[23px] h-[23px] px-1 rounded-full bg-red-600 text-white text-[11px] font-black flex items-center justify-center border-2 border-white shadow-md animate-pulse">
            {unread.length > 99 ? '99+' : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-slate-900/40 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white w-full sm:w-[420px] max-h-[86vh] sm:max-h-none sm:h-full rounded-t-3xl sm:rounded-none shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between rounded-t-3xl sm:rounded-none">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300">
                  Centro de Mensajes
                </p>
                <h3 className="text-base font-black">
                  Notificaciones {unread.length > 0 ? `(${unread.length} pendientes)` : ''}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="flex gap-1.5">
                {(['pendientes', 'todas'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1 rounded-lg text-[11px] font-black uppercase transition-colors ${
                      filter === f
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {f === 'pendientes'
                      ? `Pendientes (${unread.length})`
                      : `Historial (${items.length})`}
                  </button>
                ))}
              </div>
              {unread.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    void marcarTodasLeidas(
                      unread.map((n) => n.id),
                      uid,
                    )
                  }
                  className="text-[11px] font-black text-indigo-600 flex items-center gap-1 hover:underline"
                >
                  <CheckCheck className="w-3.5 h-3.5" /> Marcar todas
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {visible.length === 0 ? (
                <div className="py-12 text-center text-xs font-bold text-slate-400">
                  {filter === 'pendientes'
                    ? 'No tienes mensajes pendientes por revisar.'
                    : 'Aún no hay notificaciones registradas.'}
                </div>
              ) : (
                visible.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleOpenItem(n)}
                    className={`w-full text-left p-3.5 rounded-2xl border flex gap-3 transition-all ${
                      n.leida
                        ? 'bg-white border-slate-200 hover:bg-slate-50'
                        : 'bg-indigo-50/80 border-indigo-300 hover:bg-indigo-100/70 shadow-xs'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center ${
                        n.leida
                          ? 'bg-slate-100 text-slate-500'
                          : n.tipo === 'novedad_urgente'
                          ? 'bg-red-600 text-white'
                          : 'bg-indigo-600 text-white'
                      }`}
                    >
                      {iconFor(n.tipo)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={`text-xs ${
                            n.leida ? 'font-bold text-slate-700' : 'font-black text-slate-900'
                          }`}
                        >
                          {n.titulo}
                        </p>
                        {!n.leida && (
                          <span className="px-1.5 py-0.5 rounded-md bg-red-600 text-white text-[9px] font-black uppercase shrink-0">
                            Nuevo
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-700 line-clamp-3 mt-0.5">{n.mensaje}</p>
                      <p className="text-[10px] font-bold text-slate-400 mt-1">
                        {n.creadaPorNombre ? `${n.creadaPorNombre} • ` : ''}
                        {formatRelative(n.creadoEnMs)}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default NotificacionesSupervisorCenter;
