/**
 * notificacionesSupervisorService.ts
 *
 * Sistema unificado de Notificaciones e Historial de Mensajes en Tiempo Real
 * para Supervisores y Administración/Jefatura.
 *
 * Fuentes en tiempo real (onSnapshot):
 *  1. `novedades` (novedades críticas/altas, gestiones de supervisor, consultas de Jefatura y seguimientos)
 *  2. `Rondas` (rondas con novedad/sospecha, gestiones de supervisor y consultas de Jefatura)
 *  3. `visitasSupervisor` (seguimientos de visitas de supervisor)
 *  4. `notificaciones_supervisor` (colección dedicada sincronizada con Cloud Functions / cliente)
 *
 * Reglas de negocio:
 *  - SUPERVISOR: recibe notificaciones de (a) nuevas novedades urgentes / rondas con incidente
 *    en sus instalaciones asignadas, (b) consultas/respuestas de Administración, (c) seguimientos
 *    de novedades y (d) seguimientos de visitas. Activa alerta sonora, toast y notificación push/sistema.
 *  - ADMINISTRADOR / JEFATURA: recibe registros en el Centro de Mensajes y etiqueta
 *    "Registro con nuevo mensaje" en las tarjetas cuando un supervisor guarda una gestión o responde,
 *    sin notificaciones push ni alertas sonoras invasivas en PC.
 */

import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  buildSiteIdVariants,
  chunkArray,
  isSiteAllowedForSupervisor,
  normalizeSiteId,
  toSafeISOString,
  toTimestampMs,
} from './gestionIncidenciaService';

export const NOTIFICACIONES_SUPERVISOR_COL = 'notificaciones_supervisor';
const READ_STORAGE_PREFIX = 'aspro_notif_read_v1_';
const INITIALIZED_STORAGE_PREFIX = 'aspro_notif_init_v1_';
export const NOTIFS_UPDATED_EVENT = 'aspro:notifs-updated';

export type TipoNotificacionSupervisor =
  | 'consulta_admin'
  | 'respuesta_supervisor'
  | 'seguimiento_novedad'
  | 'novedad_urgente'
  | 'visita_seguimiento';

export interface NotificacionSupervisor {
  id: string;
  destinatarioUid: string;
  tipo: TipoNotificacionSupervisor;
  titulo: string;
  mensaje: string;
  siteId?: string;
  siteName?: string;
  origenTipo?: 'ronda' | 'novedad' | 'visita';
  origenId?: string;
  /** Vista a la que navega al abrir la notificación */
  vista: 'dashboard' | 'libro_novedades' | 'rounds' | 'visitas_supervisor';
  creadaPorUid: string;
  creadaPorNombre: string;
  leida: boolean;
  creadoEnISO: string;
  creadoEnMs: number;
}

export interface SuscribirNotificacionesContext {
  uid: string;
  role: 'supervisor' | 'admin' | 'jefe_operaciones' | string;
  assignedSites?: (string | number)[];
  siteNameLookup?: (siteId: string) => string;
}

function toMs(val: any, fallbackISO?: string): number {
  if (val) {
    if (typeof val.toMillis === 'function') {
      try {
        return val.toMillis();
      } catch {
        /* ignore */
      }
    }
    if (typeof val.seconds === 'number') return val.seconds * 1000;
    if (typeof val === 'string') {
      const p = Date.parse(val);
      if (!Number.isNaN(p)) return p;
    }
  }
  if (fallbackISO) {
    const p = Date.parse(fallbackISO);
    if (!Number.isNaN(p)) return p;
  }
  return 0;
}

// ─── Persistencia local instantánea + sincronización de estado leído ─────────

export function getReadNotifIds(uid: string): Set<string> {
  if (typeof window === 'undefined' || !uid) return new Set();
  try {
    const raw = localStorage.getItem(`${READ_STORAGE_PREFIX}${uid}`);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

function saveReadNotifIds(uid: string, set: Set<string>): void {
  if (typeof window === 'undefined' || !uid) return;
  try {
    // Conservar los últimos 600 IDs para no crecer indefinidamente
    const arr = Array.from(set).slice(-600);
    localStorage.setItem(`${READ_STORAGE_PREFIX}${uid}`, JSON.stringify(arr));
    window.dispatchEvent(new CustomEvent(NOTIFS_UPDATED_EVENT));
  } catch {
    /* ignore */
  }
}

export function isNotifRead(uid: string, notifId: string, firestoreLeida?: boolean): boolean {
  if (firestoreLeida) return true;
  return getReadNotifIds(uid).has(notifId);
}

/**
 * Si es la primera vez que el usuario abre este navegador, pre-marca como leídos
 * los registros antiguos (> 24 horas) para que el contador muestre solo actividad reciente,
 * manteniendo los antiguos disponibles en la pestaña "Historial".
 */
function ensureInitialReadWatermark(uid: string, items: NotificacionSupervisor[]): Set<string> {
  const readSet = getReadNotifIds(uid);
  if (typeof window === 'undefined' || !uid) return readSet;

  const initKey = `${INITIALIZED_STORAGE_PREFIX}${uid}`;
  if (!localStorage.getItem(initKey) && items.length > 0) {
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    let changed = false;
    items.forEach((item) => {
      if (item.creadoEnMs > 0 && item.creadoEnMs < cutoffMs) {
        readSet.add(item.id);
        changed = true;
      }
    });
    localStorage.setItem(initKey, '1');
    if (changed) {
      saveReadNotifIds(uid, readSet);
    }
  }
  return readSet;
}

export async function marcarNotificacionLeida(id: string, uid?: string): Promise<void> {
  if (uid) {
    const set = getReadNotifIds(uid);
    if (!set.has(id)) {
      set.add(id);
      saveReadNotifIds(uid, set);
    }
  }
  try {
    await updateDoc(doc(db, NOTIFICACIONES_SUPERVISOR_COL, id), {
      leida: true,
      leidaEn: serverTimestamp(),
    });
  } catch {
    /* Si es una notificación derivada de Rondas/novedades/visitas, no existe doc en notificaciones_supervisor */
  }
}

export async function marcarTodasLeidas(ids: string[], uid?: string): Promise<void> {
  if (ids.length === 0) return;
  if (uid) {
    const set = getReadNotifIds(uid);
    ids.forEach((id) => set.add(id));
    saveReadNotifIds(uid, set);
  }
  try {
    const firestoreIds = ids.filter((id) => !id.startsWith('drv_'));
    for (let i = 0; i < firestoreIds.length; i += 400) {
      const batch = writeBatch(db);
      firestoreIds.slice(i, i + 400).forEach((id) =>
        batch.update(doc(db, NOTIFICACIONES_SUPERVISOR_COL, id), {
          leida: true,
          leidaEn: serverTimestamp(),
        }),
      );
      await batch.commit();
    }
  } catch {
    /* ignore */
  }
}

/**
 * Marca como leídas todas las notificaciones asociadas a una alerta específica
 * (ej. cuando el Admin o Supervisor abre el modal de esa novedad o ronda).
 */
export function marcarAlertaComoLeida(
  uid: string,
  origenTipo: 'ronda' | 'novedad' | 'visita',
  origenId: string,
  currentItems: NotificacionSupervisor[],
): void {
  if (!uid || !origenId) return;
  const matchingIds = currentItems
    .filter((n) => n.origenTipo === origenTipo && n.origenId === origenId && !n.leida)
    .map((n) => n.id);
  if (matchingIds.length > 0) {
    void marcarTodasLeidas(matchingIds, uid);
  }
}

/** Uids de supervisores que tienen asignada la instalación (string/number compatible). */
export function resolverSupervisoresDeInstalacion(
  employees: Array<{ id: string; role?: string; assignedSites?: (string | number)[] }>,
  siteId: string | number | undefined | null,
): string[] {
  const target = normalizeSiteId(siteId);
  if (!target) return [];
  return employees
    .filter(
      (e) =>
        e.role === 'supervisor' &&
        Array.isArray(e.assignedSites) &&
        e.assignedSites.some((s) => normalizeSiteId(s) === target),
    )
    .map((e) => e.id);
}

/**
 * Crea opcionalmente documentos en `notificaciones_supervisor` (best-effort)
 * para respaldo cruzado entre dispositivos cuando las reglas están activas.
 */
export async function emitirNotificacionBestEffort(params: {
  id: string;
  destinatariosUids: string[];
  tipo: TipoNotificacionSupervisor;
  titulo: string;
  mensaje: string;
  siteId?: string | number;
  siteName?: string;
  origenTipo?: 'ronda' | 'novedad' | 'visita';
  origenId?: string;
  vista: NotificacionSupervisor['vista'];
  creadaPorUid: string;
  creadaPorNombre: string;
}): Promise<void> {
  const targets = Array.from(new Set(params.destinatariosUids)).filter(
    (u) => u && u !== params.creadaPorUid,
  );
  if (targets.length === 0) return;

  await Promise.all(
    targets.map(async (destUid) => {
      try {
        const docId = `${params.id}_${destUid}`;
        await setDoc(doc(db, NOTIFICACIONES_SUPERVISOR_COL, docId), {
          id: docId,
          destinatarioUid: destUid,
          tipo: params.tipo,
          titulo: params.titulo,
          mensaje: params.mensaje.slice(0, 240),
          siteId: normalizeSiteId(params.siteId),
          siteName: params.siteName || '',
          origenTipo: params.origenTipo || '',
          origenId: params.origenId || '',
          vista: params.vista,
          creadaPorUid: params.creadaPorUid,
          creadaPorNombre: params.creadaPorNombre,
          leida: false,
          leidaEn: null,
          creadoEn: serverTimestamp(),
        });
      } catch {
        /* best effort */
      }
    }),
  );
}

// ─── Derivación de notificaciones desde documentos vivos de Rondas / Novedades / Visitas ──

function deriveFromNovedad(
  raw: any,
  ctx: SuscribirNotificacionesContext,
  readSet: Set<string>,
): NotificacionSupervisor[] {
  const result: NotificacionSupervisor[] = [];
  const isSupervisor = ctx.role === 'supervisor';
  const isAdmin = ctx.role === 'admin' || ctx.role === 'jefe_operaciones';
  const siteId = normalizeSiteId(raw.sucursalId ?? raw.siteId);
  if (isSupervisor && !isSiteAllowedForSupervisor(siteId, ctx.assignedSites)) {
    return result;
  }

  const siteName =
    raw.sucursalNombre ||
    raw.siteName ||
    (ctx.siteNameLookup ? ctx.siteNameLookup(siteId) : '') ||
    `Instalación #${siteId}`;
  const novId = String(raw.id);
  const prioridad = String(raw.prioridad || '').toLowerCase();
  const esUrgente = prioridad === 'critica' || prioridad === 'alta';
  const g = raw.gestionSupervisor;

  // 1) Nueva novedad urgente (Crítica / Alta) -> notifica al Supervisor asignado
  if (isSupervisor && esUrgente) {
    const eventMs = toTimestampMs(
      raw.fechaHoraEvento || raw.creadoEn || raw.createdAt,
      raw.fechaEvento,
      raw.horaEvento,
    );
    const id = `drv_nov_urg_${novId}`;
    const tieneGestionPropia = Boolean(g && g.tipoRegistro !== 'consulta_admin');
    result.push({
      id,
      destinatarioUid: ctx.uid,
      tipo: 'novedad_urgente',
      titulo: `${prioridad === 'critica' ? '🆘 Novedad Crítica' : '⚠️ Prioridad Alta'} · ${siteName}`,
      mensaje: `${raw.autorNombre || raw.colaboradorNombre || 'Guardia'}: ${String(
        raw.descripcion || raw.titulo || 'Sin descripción',
      ).slice(0, 180)}`,
      siteId,
      siteName,
      origenTipo: 'novedad',
      origenId: novId,
      vista: 'dashboard',
      creadaPorUid: String(raw.autorUid || raw.colaboradorId || ''),
      creadaPorNombre: String(raw.autorNombre || raw.colaboradorNombre || 'Guardia'),
      // Si el supervisor ya la gestionó, se considera atendida/leída
      leida: tieneGestionPropia || readSet.has(id),
      creadoEnISO: eventMs ? new Date(eventMs).toISOString() : new Date().toISOString(),
      creadoEnMs: eventMs || Date.now(),
    });
  }

  // 2) Consulta de Administración / Jefatura -> notifica al Supervisor asignado
  if (isSupervisor && g?.consultaAdmin?.mensaje) {
    const c = g.consultaAdmin;
    const cMs = toMs(c.fechaISO) || toMs(g.fechaGestion) || Date.now();
    const id = `drv_cons_nov_${novId}_${c.fechaISO || g.ultimaGestionId || '1'}`;
    result.push({
      id,
      destinatarioUid: ctx.uid,
      tipo: 'consulta_admin',
      titulo: `📣 Consulta de Jefatura · ${siteName}`,
      mensaje: `${c.adminNombre || 'Administración'}: ${c.mensaje}`,
      siteId,
      siteName,
      origenTipo: 'novedad',
      origenId: novId,
      vista: 'dashboard',
      creadaPorUid: String(c.adminUid || ''),
      creadaPorNombre: String(c.adminNombre || 'Administración'),
      leida: !c.pendienteRespuesta || readSet.has(id),
      creadoEnISO: new Date(cMs).toISOString(),
      creadoEnMs: cMs,
    });
  }

  // 3) Gestión / Respuesta del Supervisor -> registro y aviso en Centro de Mensajes para Admin
  if (isAdmin && g && g.tipoRegistro !== 'consulta_admin' && g.medidasTomadas) {
    const supNombre = g.ultimoSupervisorNombre || g.supervisorNombre || 'Supervisor';
    const gMs =
      toMs(g.fechaUltimaGestionSupervisorISO) ||
      toMs(g.fechaGestion, g.fechaGestionISO) ||
      Date.now();
    const id = `drv_resp_nov_${novId}_${g.ultimaGestionId || gMs}`;
    const estadoLabel =
      g.fueSolucionado === 'si'
        ? 'Solucionado'
        : g.fueSolucionado === 'no'
        ? 'No Solucionado'
        : 'Pendiente de Decisión';
    result.push({
      id,
      destinatarioUid: ctx.uid,
      tipo: 'respuesta_supervisor',
      titulo: `Gestión de ${supNombre} · ${siteName}`,
      mensaje: `[${estadoLabel}] ${g.medidasTomadas}${
        g.observaciones ? ` — Obs: ${g.observaciones}` : ''
      }`,
      siteId,
      siteName,
      origenTipo: 'novedad',
      origenId: novId,
      vista: 'dashboard',
      creadaPorUid: String(g.ultimoSupervisorUid || g.supervisorUid || ''),
      creadaPorNombre: supNombre,
      leida: readSet.has(id),
      creadoEnISO: new Date(gMs).toISOString(),
      creadoEnMs: gMs,
    });
  }

  // 4) Seguimiento en hilo del Libro de Novedades -> notifica al Supervisor (o Admin si responde guardia/sup)
  if (raw.ultimoSeguimientoMsg && raw.ultimoSeguimientoEn) {
    const segMs = toMs(raw.ultimoSeguimientoEn);
    const segRol = String(raw.ultimoSeguimientoRol || '');
    const segPor = String(raw.ultimoSeguimientoPor || 'Usuario');
    const id = `drv_seg_nov_${novId}_${segMs || raw.cantidadSeguimientos || 1}`;

    if (isSupervisor && ['admin', 'jefe_operaciones', 'rrhh'].includes(segRol)) {
      result.push({
        id,
        destinatarioUid: ctx.uid,
        tipo: 'seguimiento_novedad',
        titulo: `💬 Seguimiento de Novedad · ${siteName}`,
        mensaje: `${segPor}: ${raw.ultimoSeguimientoMsg}`,
        siteId,
        siteName,
        origenTipo: 'novedad',
        origenId: novId,
        vista: esUrgente ? 'dashboard' : 'libro_novedades',
        creadaPorUid: '',
        creadaPorNombre: segPor,
        leida: readSet.has(id),
        creadoEnISO: new Date(segMs || Date.now()).toISOString(),
        creadoEnMs: segMs || Date.now(),
      });
    } else if (isAdmin && segRol !== 'admin' && segRol !== 'jefe_operaciones') {
      result.push({
        id,
        destinatarioUid: ctx.uid,
        tipo: 'seguimiento_novedad',
        titulo: `💬 Nuevo Seguimiento · ${siteName}`,
        mensaje: `${segPor}: ${raw.ultimoSeguimientoMsg}`,
        siteId,
        siteName,
        origenTipo: 'novedad',
        origenId: novId,
        vista: esUrgente ? 'dashboard' : 'libro_novedades',
        creadaPorUid: '',
        creadaPorNombre: segPor,
        leida: Number(raw.unreadAdminCount || 0) === 0 || readSet.has(id),
        creadoEnISO: new Date(segMs || Date.now()).toISOString(),
        creadoEnMs: segMs || Date.now(),
      });
    }
  }

  return result;
}

function deriveFromRound(
  raw: any,
  ctx: SuscribirNotificacionesContext,
  readSet: Set<string>,
): NotificacionSupervisor[] {
  const result: NotificacionSupervisor[] = [];
  if (raw.result !== 'CON_NOVEDAD' && raw.result !== 'SOSPECHA') return result;

  const isSupervisor = ctx.role === 'supervisor';
  const isAdmin = ctx.role === 'admin' || ctx.role === 'jefe_operaciones';
  const siteId = normalizeSiteId(raw.siteId);
  if (isSupervisor && !isSiteAllowedForSupervisor(siteId, ctx.assignedSites)) {
    return result;
  }

  const siteName =
    raw.siteName ||
    (ctx.siteNameLookup ? ctx.siteNameLookup(siteId) : '') ||
    `Instalación #${siteId}`;
  const roundId = String(raw.id);
  const g = raw.gestionSupervisor;

  // 1) Ronda con sospecha/novedad -> notifica al Supervisor
  if (isSupervisor) {
    const rawTime = raw.endTime || raw.startTime || raw.finishedAt || raw.startedAt;
    const rMs = toTimestampMs(rawTime);
    const id = `drv_rnd_urg_${roundId}`;
    const tieneGestionPropia = Boolean(g && g.tipoRegistro !== 'consulta_admin');
    result.push({
      id,
      destinatarioUid: ctx.uid,
      tipo: 'novedad_urgente',
      titulo: `${raw.result === 'SOSPECHA' ? '🚨 Ronda con Sospecha' : '🛰️ Ronda con Novedad'} · ${siteName}`,
      mensaje: `${raw.workerName || 'Guardia'}: ${String(
        raw.notes || raw.observations || 'Incidencia reportada en ronda.',
      ).slice(0, 180)}`,
      siteId,
      siteName,
      origenTipo: 'ronda',
      origenId: roundId,
      vista: 'dashboard',
      creadaPorUid: String(raw.workerId || ''),
      creadaPorNombre: String(raw.workerName || 'Guardia'),
      leida: tieneGestionPropia || readSet.has(id),
      creadoEnISO: toSafeISOString(rawTime) || new Date(rMs || Date.now()).toISOString(),
      creadoEnMs: rMs || Date.now(),
    });
  }

  // 2) Consulta de Administración sobre Ronda -> notifica al Supervisor
  if (isSupervisor && g?.consultaAdmin?.mensaje) {
    const c = g.consultaAdmin;
    const cMs = toMs(c.fechaISO) || toMs(g.fechaGestion) || Date.now();
    const id = `drv_cons_rnd_${roundId}_${c.fechaISO || g.ultimaGestionId || '1'}`;
    result.push({
      id,
      destinatarioUid: ctx.uid,
      tipo: 'consulta_admin',
      titulo: `📣 Consulta de Jefatura (Ronda) · ${siteName}`,
      mensaje: `${c.adminNombre || 'Administración'}: ${c.mensaje}`,
      siteId,
      siteName,
      origenTipo: 'ronda',
      origenId: roundId,
      vista: 'dashboard',
      creadaPorUid: String(c.adminUid || ''),
      creadaPorNombre: String(c.adminNombre || 'Administración'),
      leida: !c.pendienteRespuesta || readSet.has(id),
      creadoEnISO: new Date(cMs).toISOString(),
      creadoEnMs: cMs,
    });
  }

  // 3) Gestión del Supervisor sobre Ronda -> registro para Admin
  if (isAdmin && g && g.tipoRegistro !== 'consulta_admin' && g.medidasTomadas) {
    const supNombre = g.ultimoSupervisorNombre || g.supervisorNombre || 'Supervisor';
    const gMs =
      toMs(g.fechaUltimaGestionSupervisorISO) ||
      toMs(g.fechaGestion, g.fechaGestionISO) ||
      Date.now();
    const id = `drv_resp_rnd_${roundId}_${g.ultimaGestionId || gMs}`;
    const estadoLabel =
      g.fueSolucionado === 'si'
        ? 'Solucionado'
        : g.fueSolucionado === 'no'
        ? 'No Solucionado'
        : 'Pendiente de Decisión';
    result.push({
      id,
      destinatarioUid: ctx.uid,
      tipo: 'respuesta_supervisor',
      titulo: `Gestión en Ronda (${supNombre}) · ${siteName}`,
      mensaje: `[${estadoLabel}] ${g.medidasTomadas}`,
      siteId,
      siteName,
      origenTipo: 'ronda',
      origenId: roundId,
      vista: 'dashboard',
      creadaPorUid: String(g.ultimoSupervisorUid || g.supervisorUid || ''),
      creadaPorNombre: supNombre,
      leida: readSet.has(id),
      creadoEnISO: new Date(gMs).toISOString(),
      creadoEnMs: gMs,
    });
  }

  return result;
}

function deriveFromVisita(
  raw: any,
  ctx: SuscribirNotificacionesContext,
  readSet: Set<string>,
): NotificacionSupervisor[] {
  const result: NotificacionSupervisor[] = [];
  if (!raw.ultimoSeguimientoMsg || !raw.ultimoSeguimientoEn) return result;

  const isSupervisor = ctx.role === 'supervisor';
  const isAdmin = ctx.role === 'admin' || ctx.role === 'jefe_operaciones';
  const visitaId = String(raw.id);
  const siteName = String(raw.sucursalNombre || 'Sucursal');
  const segMs = toMs(raw.ultimoSeguimientoEn);
  const segPor = String(raw.ultimoSeguimientoPor || 'Administración');
  const segRol = String(raw.ultimoSeguimientoRol || '');
  const id = `drv_vis_${visitaId}_${segMs || raw.cantidadSeguimientos || 1}`;

  if (isSupervisor && raw.supervisorUid === ctx.uid && segRol !== 'supervisor') {
    const unreadSup = Number(raw.unreadSupervisorCount || 0) > 0;
    result.push({
      id,
      destinatarioUid: ctx.uid,
      tipo: 'visita_seguimiento',
      titulo: `📋 Seguimiento de Visita · ${siteName}`,
      mensaje: `${segPor}: ${raw.ultimoSeguimientoMsg}`,
      siteId: normalizeSiteId(raw.sucursalId),
      siteName,
      origenTipo: 'visita',
      origenId: visitaId,
      vista: 'visitas_supervisor',
      creadaPorUid: '',
      creadaPorNombre: segPor,
      leida: !unreadSup || readSet.has(id),
      creadoEnISO: new Date(segMs || Date.now()).toISOString(),
      creadoEnMs: segMs || Date.now(),
    });
  } else if (isAdmin && segRol === 'supervisor') {
    const unreadAdm = Number(raw.unreadAdminCount || 0) > 0;
    result.push({
      id,
      destinatarioUid: ctx.uid,
      tipo: 'visita_seguimiento',
      titulo: `📋 Respuesta en Visita (${segPor}) · ${siteName}`,
      mensaje: `${segPor}: ${raw.ultimoSeguimientoMsg}`,
      siteId: normalizeSiteId(raw.sucursalId),
      siteName,
      origenTipo: 'visita',
      origenId: visitaId,
      vista: 'visitas_supervisor',
      creadaPorUid: String(raw.supervisorUid || ''),
      creadaPorNombre: segPor,
      leida: !unreadAdm || readSet.has(id),
      creadoEnISO: new Date(segMs || Date.now()).toISOString(),
      creadoEnMs: segMs || Date.now(),
    });
  }

  return result;
}

/**
 * Suscripción unificada en tiempo real a todas las notificaciones y mensajes del usuario.
 * Combina datos en vivo de `novedades`, `Rondas`, `visitasSupervisor` y `notificaciones_supervisor`.
 */
export function subscribeNotificacionesSupervisor(
  ctxOrUid: SuscribirNotificacionesContext | string,
  onChange: (all: NotificacionSupervisor[], nuevas: NotificacionSupervisor[]) => void,
  onError?: (err: unknown) => void,
): () => void {
  const ctx: SuscribirNotificacionesContext =
    typeof ctxOrUid === 'string'
      ? { uid: ctxOrUid, role: 'supervisor', assignedSites: [] }
      : ctxOrUid;

  const { uid, role, assignedSites = [] } = ctx;
  if (!uid) {
    onChange([], []);
    return () => undefined;
  }

  const isAdmin = role === 'admin' || role === 'jefe_operaciones';
  const LIVE_OPTS = { serverTimestamps: 'estimate' } as const;

  const novedadesBySource = new Map<string, Map<string, any>>();
  const rondasBySource = new Map<string, Map<string, any>>();
  const visitasMap = new Map<string, any>();
  const directNotifsMap = new Map<string, NotificacionSupervisor>();

  let knownUnreadIds = new Set<string>();
  let initialSourcesSettled = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    initialSourcesSettled = true;
  }, 2200);

  let disposed = false;
  const unsubs: Array<() => void> = [];

  const recompute = (allowEmitNew: boolean) => {
    if (disposed) return;

    const mergedNov = new Map<string, any>();
    novedadesBySource.forEach((m) => m.forEach((v, k) => mergedNov.set(k, v)));

    const mergedRounds = new Map<string, any>();
    rondasBySource.forEach((m) => m.forEach((v, k) => mergedRounds.set(k, v)));

    const provisionalReadSet = getReadNotifIds(uid);
    const derived: NotificacionSupervisor[] = [];

    mergedNov.forEach((nov) => {
      derived.push(...deriveFromNovedad(nov, ctx, provisionalReadSet));
    });
    mergedRounds.forEach((rnd) => {
      derived.push(...deriveFromRound(rnd, ctx, provisionalReadSet));
    });
    visitasMap.forEach((vis) => {
      derived.push(...deriveFromVisita(vis, ctx, provisionalReadSet));
    });
    directNotifsMap.forEach((n) => {
      derived.push({
        ...n,
        leida: isNotifRead(uid, n.id, n.leida),
      });
    });

    // Asegurar marca de agua inicial para no saturar con registros históricos (> 24h)
    const finalReadSet = ensureInitialReadWatermark(uid, derived);

    // Deduplicar y aplicar estado leído actualizado
    const byId = new Map<string, NotificacionSupervisor>();
    derived.forEach((item) => {
      byId.set(item.id, {
        ...item,
        leida: item.leida || finalReadSet.has(item.id),
      });
    });

    const all = Array.from(byId.values()).sort((a, b) => b.creadoEnMs - a.creadoEnMs);

    const nuevas: NotificacionSupervisor[] = [];
    if (initialSourcesSettled && allowEmitNew) {
      all.forEach((item) => {
        if (!item.leida && !knownUnreadIds.has(item.id) && item.creadaPorUid !== uid) {
          nuevas.push(item);
        }
      });
    }

    // Actualizar conjunto de IDs ya conocidos para futuros cambios en vivo
    all.forEach((item) => {
      knownUnreadIds.add(item.id);
    });

    onChange(all, nuevas);
  };

  // Listener a cambios de lectura locales (cuando se abre un modal o se marca como leído)
  const handleLocalReadEvent = () => recompute(false);
  if (typeof window !== 'undefined') {
    window.addEventListener(NOTIFS_UPDATED_EVENT, handleLocalReadEvent);
  }

  // 1. Suscripción a Rondas y Novedades
  const listenRondas = (key: string, q: any) => {
    unsubs.push(
      onSnapshot(
        q,
        (snap: any) => {
          const m = new Map<string, any>();
          snap.docs.forEach((d: any) => {
            const data = d.data(LIVE_OPTS);
            if (data.result === 'CON_NOVEDAD' || data.result === 'SOSPECHA') {
              m.set(d.id, { id: d.id, ...data });
            }
          });
          rondasBySource.set(key, m);
          recompute(true);
        },
        (err: unknown) => onError?.(err),
      ),
    );
  };

  const listenNovedades = (key: string, q: any) => {
    unsubs.push(
      onSnapshot(
        q,
        (snap: any) => {
          const m = new Map<string, any>();
          snap.docs.forEach((d: any) => {
            const data = d.data(LIVE_OPTS);
            const prio = String(data.prioridad || '').toLowerCase();
            if (
              prio === 'critica' ||
              prio === 'alta' ||
              data.requiereSeguimiento ||
              data.ultimoSeguimientoMsg
            ) {
              m.set(d.id, { id: d.id, ...data });
            }
          });
          novedadesBySource.set(key, m);
          recompute(true);
        },
        (err: unknown) => onError?.(err),
      ),
    );
  };

  if (isAdmin) {
    listenRondas(
      'adm_r',
      query(
        collection(db, 'Rondas'),
        where('result', 'in', ['CON_NOVEDAD', 'SOSPECHA']),
        limit(120),
      ),
    );
    listenNovedades(
      'adm_n',
      query(
        collection(db, 'novedades'),
        where('prioridad', 'in', ['critica', 'alta']),
        limit(120),
      ),
    );
  } else {
    const chunks = chunkArray(buildSiteIdVariants(assignedSites), 30);
    chunks.forEach((chunk, idx) => {
      listenRondas(
        `sup_r_${idx}`,
        query(collection(db, 'Rondas'), where('siteId', 'in', chunk), limit(100)),
      );
      listenNovedades(
        `sup_ns_${idx}`,
        query(collection(db, 'novedades'), where('sucursalId', 'in', chunk), limit(100)),
      );
      listenNovedades(
        `sup_nx_${idx}`,
        query(collection(db, 'novedades'), where('siteId', 'in', chunk), limit(100)),
      );
    });
  }

  // 2. Suscripción a Visitas de Supervisor (seguimientos de visitas)
  const qVisitas = isAdmin
    ? query(collection(db, 'visitasSupervisor'), where('requiereSeguimiento', '==', true), limit(80))
    : query(collection(db, 'visitasSupervisor'), where('supervisorUid', '==', uid), limit(80));

  unsubs.push(
    onSnapshot(
      qVisitas,
      (snap) => {
        visitasMap.clear();
        snap.docs.forEach((d) => {
          visitasMap.set(d.id, { id: d.id, ...d.data(LIVE_OPTS) });
        });
        recompute(true);
      },
      () => {
        /* ignorar si no tiene permisos sobre visitas */
      },
    ),
  );

  // 3. Suscripción opcional a colección dedicada `notificaciones_supervisor`
  const qDirect = query(
    collection(db, NOTIFICACIONES_SUPERVISOR_COL),
    where('destinatarioUid', '==', uid),
    limit(100),
  );

  unsubs.push(
    onSnapshot(
      qDirect,
      (snap) => {
        directNotifsMap.clear();
        snap.docs.forEach((d) => {
          const data: any = d.data(LIVE_OPTS);
          const ms = toMs(data.creadoEn);
          directNotifsMap.set(d.id, {
            id: d.id,
            destinatarioUid: String(data.destinatarioUid || ''),
            tipo: data.tipo as TipoNotificacionSupervisor,
            titulo: String(data.titulo || 'Notificación'),
            mensaje: String(data.mensaje || ''),
            siteId: data.siteId ? String(data.siteId) : undefined,
            siteName: data.siteName || undefined,
            origenTipo: data.origenTipo || undefined,
            origenId: data.origenId || undefined,
            vista: (data.vista || 'dashboard') as NotificacionSupervisor['vista'],
            creadaPorUid: String(data.creadaPorUid || ''),
            creadaPorNombre: String(data.creadaPorNombre || ''),
            leida: Boolean(data.leida),
            creadoEnISO: new Date(ms || Date.now()).toISOString(),
            creadoEnMs: ms || Date.now(),
          });
        });
        recompute(true);
      },
      () => {
        /* Funciona 100% con la derivación en vivo incluso si notificaciones_supervisor no está desplegada */
      },
    ),
  );

  return () => {
    disposed = true;
    if (settleTimer) clearTimeout(settleTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener(NOTIFS_UPDATED_EVENT, handleLocalReadEvent);
    }
    unsubs.forEach((u) => u());
  };
}
