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

/** Ventana operativa: notificaciones leídas/vistas se retienen hasta 24 horas */
export const NOTIF_MAX_AGE_LEIDA_MS = 24 * 60 * 60 * 1000;
/** Ventana operativa: notificaciones no vistas/pendientes se retienen hasta 36 horas */
export const NOTIF_MAX_AGE_NO_VISTA_MS = 36 * 60 * 60 * 1000;

/**
 * Valida si una notificación pertenece a la ventana operativa permitida:
 *  - Nuevas / vistas: dentro de las últimas 24 horas.
 *  - No vistas / pendientes: dentro de un máximo de 36 horas.
 * Cualquier registro anterior a 36 horas (o visto hace más de 24 horas) se descarta
 * para evitar la llegada de notificaciones antiguas o de meses anteriores.
 */
export function isNotificationWithinOperationalWindow(
  item: { creadoEnMs: number; leida: boolean },
  nowMs: number = Date.now(),
): boolean {
  if (!item.creadoEnMs || item.creadoEnMs <= 0) return false;
  const ageMs = nowMs - item.creadoEnMs;
  if (ageMs < 0) {
    // Timestamp en el futuro o leve desfase de reloj -> tratar como reciente
    return true;
  }
  if (!item.leida) {
    // No vista: máximo 36 horas
    return ageMs <= NOTIF_MAX_AGE_NO_VISTA_MS;
  }
  // Ya vista / leída: nuevas dentro de las últimas 24 horas
  return ageMs <= NOTIF_MAX_AGE_LEIDA_MS;
}

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

// ─── Helpers de resolución y claves canónicas para deduplicación ─────────

/**
 * Resuelve con certeza el tipo de origen ('novedad' | 'ronda' | 'visita')
 * normalizando datos antiguos, campos vacíos o prefijos de IDs conocidos.
 */
export function resolveOrigenTipo(item: {
  id?: string;
  tipo?: TipoNotificacionSupervisor | string;
  origenTipo?: 'ronda' | 'novedad' | 'visita' | string;
  vista?: string;
}): 'novedad' | 'ronda' | 'visita' {
  if (item.origenTipo === 'ronda' || item.origenTipo === 'novedad' || item.origenTipo === 'visita') {
    return item.origenTipo;
  }
  const id = item.id || '';
  if (
    item.tipo === 'visita_seguimiento' ||
    id.startsWith('sv_') ||
    id.startsWith('drv_vis_') ||
    item.vista === 'visitas_supervisor'
  ) {
    return 'visita';
  }
  if (id.startsWith('drv_rnd_') || item.vista === 'rounds') {
    return 'ronda';
  }
  return 'novedad';
}

/**
 * Genera la clave canónica única de un evento de notificación.
 * Permite emparejar y deduplicar registros oficiales de `notificaciones_supervisor`
 * con registros sintéticos derivados de `novedades`/`Rondas`/`visitas`.
 */
export function getNotificationCanonicalKey(item: NotificacionSupervisor): string {
  const ot = resolveOrigenTipo(item);
  const origenId = item.origenId ? String(item.origenId) : '';

  if (origenId && item.tipo) {
    // 1) Novedad urgente (crítica / alta / sospecha en ronda):
    // Solo existe un evento base por incidente. El documento oficial y el derivado
    // comparten exactamente la misma clave canónica.
    if (item.tipo === 'novedad_urgente') {
      return `${ot}:${origenId}:novedad_urgente`;
    }

    // 2) Notificaciones derivadas sintéticas (prefijo 'drv_'):
    // Representan el estado activo del registro padre, por lo que su clave canónica
    // mapea al tipo de evento en esa entidad para no duplicar documentos oficiales.
    if (item.id.startsWith('drv_')) {
      return `${ot}:${origenId}:${item.tipo}`;
    }
  }

  // 3) Documentos oficiales directos de `notificaciones_supervisor`:
  // Cada consulta, respuesta o seguimiento individual de Firestore mantiene su propio ID único.
  return item.id;
}

/**
 * Extrae todas las claves canónicas y alias asociados a un ID (ej. para lectura unificada).
 */
export function extractCanonicalKeysFromId(id: string): string[] {
  const keys: string[] = [id];
  if (!id) return keys;

  // nu_${novedadId}_${uid} o nua_${novedadId}_${uid}
  const matchNu = id.match(/^nua?_(.+)_[^_]+$/);
  if (matchNu) {
    const novId = matchNu[1];
    keys.push(`novedad:${novId}:novedad_urgente`);
    keys.push(`drv_nov_urg_${novId}`);
  }
  // drv_nov_urg_${novId}
  const matchDrvNov = id.match(/^drv_nov_urg_(.+)$/);
  if (matchDrvNov) {
    const novId = matchDrvNov[1];
    keys.push(`novedad:${novId}:novedad_urgente`);
  }
  // drv_rnd_urg_${roundId}
  const matchDrvRnd = id.match(/^drv_rnd_urg_(.+)$/);
  if (matchDrvRnd) {
    const rndId = matchDrvRnd[1];
    keys.push(`ronda:${rndId}:novedad_urgente`);
  }
  // drv_cons_nov_${novId}_...
  const matchDrvConsNov = id.match(/^drv_cons_nov_(.+)_[^_]+$/);
  if (matchDrvConsNov) {
    keys.push(`novedad:${matchDrvConsNov[1]}:consulta_admin`);
  }
  // drv_cons_rnd_${roundId}_...
  const matchDrvConsRnd = id.match(/^drv_cons_rnd_(.+)_[^_]+$/);
  if (matchDrvConsRnd) {
    keys.push(`ronda:${matchDrvConsRnd[1]}:consulta_admin`);
  }
  // drv_resp_nov_${novId}_...
  const matchDrvRespNov = id.match(/^drv_resp_nov_(.+)_[^_]+$/);
  if (matchDrvRespNov) {
    keys.push(`novedad:${matchDrvRespNov[1]}:respuesta_supervisor`);
  }
  // drv_resp_rnd_${roundId}_...
  const matchDrvRespRnd = id.match(/^drv_resp_rnd_(.+)_[^_]+$/);
  if (matchDrvRespRnd) {
    keys.push(`ronda:${matchDrvRespRnd[1]}:respuesta_supervisor`);
  }
  // drv_seg_nov_${novId}_...
  const matchDrvSegNov = id.match(/^drv_seg_nov_(.+)_[^_]+$/);
  if (matchDrvSegNov) {
    keys.push(`novedad:${matchDrvSegNov[1]}:seguimiento_novedad`);
  }
  // drv_vis_${visitaId}_...
  const matchDrvVis = id.match(/^drv_vis_(.+)_[^_]+$/);
  if (matchDrvVis) {
    keys.push(`visita:${matchDrvVis[1]}:visita_seguimiento`);
  }

  return keys;
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

export function isNotifRead(
  uid: string,
  itemOrId: NotificacionSupervisor | string,
  firestoreLeidaOrReadSet?: boolean | Set<string>,
): boolean {
  if (typeof itemOrId === 'string') {
    const id = itemOrId;
    const firestoreLeida =
      typeof firestoreLeidaOrReadSet === 'boolean' ? firestoreLeidaOrReadSet : false;
    if (firestoreLeida) return true;
    const readSet = getReadNotifIds(uid);
    if (readSet.has(id)) return true;
    const related = extractCanonicalKeysFromId(id);
    return related.some((k) => readSet.has(k));
  }

  const item = itemOrId;
  if (item.leida) return true;
  const readSet =
    firestoreLeidaOrReadSet instanceof Set ? firestoreLeidaOrReadSet : getReadNotifIds(uid);
  if (readSet.has(item.id)) return true;

  const canonKey = getNotificationCanonicalKey(item);
  if (readSet.has(canonKey)) return true;

  const related = extractCanonicalKeysFromId(item.id);
  if (related.some((k) => readSet.has(k))) return true;

  if (item.origenId && item.tipo) {
    const eventKey = `${resolveOrigenTipo(item)}:${item.origenId}:${item.tipo}`;
    if (readSet.has(eventKey)) return true;
  }
  return false;
}

/**
 * Si es la primera vez que el usuario abre este navegador, pre-marca como leídos
 * los registros que exceden la ventana máxima de 36 horas para que el contador
 * muestre solo actividad reciente.
 */
function ensureInitialReadWatermark(uid: string, items: NotificacionSupervisor[]): Set<string> {
  const readSet = getReadNotifIds(uid);
  if (typeof window === 'undefined' || !uid) return readSet;

  const initKey = `${INITIALIZED_STORAGE_PREFIX}${uid}`;
  if (!localStorage.getItem(initKey) && items.length > 0) {
    const cutoffMs = Date.now() - NOTIF_MAX_AGE_NO_VISTA_MS;
    let changed = false;
    items.forEach((item) => {
      if (item.creadoEnMs > 0 && item.creadoEnMs < cutoffMs) {
        readSet.add(item.id);
        const canonKey = getNotificationCanonicalKey(item);
        readSet.add(canonKey);
        extractCanonicalKeysFromId(item.id).forEach((k) => readSet.add(k));
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
    const related = extractCanonicalKeysFromId(id);
    let changed = false;
    related.forEach((k) => {
      if (!set.has(k)) {
        set.add(k);
        changed = true;
      }
    });
    if (changed) {
      saveReadNotifIds(uid, set);
    }
  }
  try {
    if (!id.startsWith('drv_')) {
      await updateDoc(doc(db, NOTIFICACIONES_SUPERVISOR_COL, id), {
        leida: true,
        leidaEn: serverTimestamp(),
      });
    }
  } catch {
    /* Si no existe doc en notificaciones_supervisor (o derivado), no falla */
  }
}

export async function marcarTodasLeidas(ids: string[], uid?: string): Promise<void> {
  if (ids.length === 0) return;
  if (uid) {
    const set = getReadNotifIds(uid);
    ids.forEach((id) => {
      extractCanonicalKeysFromId(id).forEach((k) => set.add(k));
    });
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
    .filter(
      (n) =>
        resolveOrigenTipo(n) === origenTipo &&
        String(n.origenId) === String(origenId) &&
        !n.leida,
    )
    .map((n) => n.id);

  const set = getReadNotifIds(uid);
  set.add(`${origenTipo}:${origenId}:novedad_urgente`);
  set.add(`${origenTipo}:${origenId}:consulta_admin`);
  set.add(`${origenTipo}:${origenId}:respuesta_supervisor`);
  set.add(`${origenTipo}:${origenId}:seguimiento_novedad`);
  if (origenTipo === 'ronda') {
    set.add(`drv_rnd_urg_${origenId}`);
  } else if (origenTipo === 'novedad') {
    set.add(`drv_nov_urg_${origenId}`);
  }
  saveReadNotifIds(uid, set);

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
  coveredDirectKeys?: Set<string>,
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
    const canonKey = `novedad:${novId}:novedad_urgente`;
    // Suprimir derivación si ya existe documento oficial en notificaciones_supervisor
    if (!coveredDirectKeys?.has(canonKey)) {
      const eventMs =
        toTimestampMs(
          raw.fechaHoraEvento || raw.creadoEn || raw.createdAt,
          raw.fechaEvento,
          raw.horaEvento,
        ) ||
        toMs(raw.creadoEn) ||
        toMs(raw.createdAt) ||
        0;
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
        leida: tieneGestionPropia || readSet.has(id) || readSet.has(canonKey),
        creadoEnISO: eventMs ? new Date(eventMs).toISOString() : '',
        creadoEnMs: eventMs,
      });
    }
  }

  // 2) Consulta de Administración / Jefatura -> notifica al Supervisor asignado
  if (isSupervisor && g?.consultaAdmin?.mensaje) {
    const canonKey = `novedad:${novId}:consulta_admin`;
    if (!coveredDirectKeys?.has(canonKey)) {
      const c = g.consultaAdmin;
      const cMs =
        toMs(c.fechaISO) ||
        toMs(g.fechaGestion) ||
        toMs(raw.fechaHoraEvento || raw.creadoEn || raw.createdAt) ||
        0;
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
        leida: !c.pendienteRespuesta || readSet.has(id) || readSet.has(canonKey),
        creadoEnISO: cMs ? new Date(cMs).toISOString() : '',
        creadoEnMs: cMs,
      });
    }
  }

  // 3) Gestión / Respuesta del Supervisor -> registro y aviso en Centro de Mensajes para Admin
  if (isAdmin && g && g.tipoRegistro !== 'consulta_admin' && g.medidasTomadas) {
    const canonKey = `novedad:${novId}:respuesta_supervisor`;
    if (!coveredDirectKeys?.has(canonKey)) {
      const supNombre = g.ultimoSupervisorNombre || g.supervisorNombre || 'Supervisor';
      const gMs =
        toMs(g.fechaUltimaGestionSupervisorISO) ||
        toMs(g.fechaGestion, g.fechaGestionISO) ||
        toMs(raw.fechaHoraEvento || raw.creadoEn || raw.createdAt) ||
        0;
      const id = `drv_resp_nov_${novId}_${g.ultimaGestionId || gMs}`;
      const estadoLabel =
        g.fueSolucionado === 'si'
          ? 'Solucionado'
          : g.fueSolucionado === 'no'
          ? 'No Solucionado'
          : 'Pendiente de Gestión';
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
        leida: readSet.has(id) || readSet.has(canonKey),
        creadoEnISO: gMs ? new Date(gMs).toISOString() : '',
        creadoEnMs: gMs,
      });
    }
  }

  // 4) Seguimiento en hilo del Libro de Novedades -> notifica al Supervisor (o Admin si responde guardia/sup)
  if (raw.ultimoSeguimientoMsg && raw.ultimoSeguimientoEn) {
    const canonKey = `novedad:${novId}:seguimiento_novedad`;
    if (!coveredDirectKeys?.has(canonKey)) {
      const segMs = toMs(raw.ultimoSeguimientoEn) || toMs(raw.creadoEn) || 0;
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
          leida: readSet.has(id) || readSet.has(canonKey),
          creadoEnISO: segMs ? new Date(segMs).toISOString() : '',
          creadoEnMs: segMs,
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
          leida:
            Number(raw.unreadAdminCount || 0) === 0 ||
            readSet.has(id) ||
            readSet.has(canonKey),
          creadoEnISO: segMs ? new Date(segMs).toISOString() : '',
          creadoEnMs: segMs,
        });
      }
    }
  }

  return result;
}

function deriveFromRound(
  raw: any,
  ctx: SuscribirNotificacionesContext,
  readSet: Set<string>,
  coveredDirectKeys?: Set<string>,
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
    const canonKey = `ronda:${roundId}:novedad_urgente`;
    if (!coveredDirectKeys?.has(canonKey)) {
      const rawTime = raw.endTime || raw.startTime || raw.finishedAt || raw.startedAt;
      const rMs = toTimestampMs(rawTime) || toMs(rawTime) || 0;
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
        leida: tieneGestionPropia || readSet.has(id) || readSet.has(canonKey),
        creadoEnISO: toSafeISOString(rawTime) || (rMs ? new Date(rMs).toISOString() : ''),
        creadoEnMs: rMs,
      });
    }
  }

  // 2) Consulta de Administración sobre Ronda -> notifica al Supervisor
  if (isSupervisor && g?.consultaAdmin?.mensaje) {
    const canonKey = `ronda:${roundId}:consulta_admin`;
    if (!coveredDirectKeys?.has(canonKey)) {
      const c = g.consultaAdmin;
      const cMs =
        toMs(c.fechaISO) ||
        toMs(g.fechaGestion) ||
        toTimestampMs(raw.endTime || raw.startTime) ||
        toMs(raw.endTime || raw.startTime) ||
        0;
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
        leida: !c.pendienteRespuesta || readSet.has(id) || readSet.has(canonKey),
        creadoEnISO: cMs ? new Date(cMs).toISOString() : '',
        creadoEnMs: cMs,
      });
    }
  }

  // 3) Gestión del Supervisor sobre Ronda -> registro para Admin
  if (isAdmin && g && g.tipoRegistro !== 'consulta_admin' && g.medidasTomadas) {
    const canonKey = `ronda:${roundId}:respuesta_supervisor`;
    if (!coveredDirectKeys?.has(canonKey)) {
      const supNombre = g.ultimoSupervisorNombre || g.supervisorNombre || 'Supervisor';
      const gMs =
        toMs(g.fechaUltimaGestionSupervisorISO) ||
        toMs(g.fechaGestion, g.fechaGestionISO) ||
        toTimestampMs(raw.endTime || raw.startTime) ||
        toMs(raw.endTime || raw.startTime) ||
        0;
      const id = `drv_resp_rnd_${roundId}_${g.ultimaGestionId || gMs}`;
      const estadoLabel =
        g.fueSolucionado === 'si'
          ? 'Solucionado'
          : g.fueSolucionado === 'no'
          ? 'No Solucionado'
          : 'Pendiente de Gestión';
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
        leida: readSet.has(id) || readSet.has(canonKey),
        creadoEnISO: gMs ? new Date(gMs).toISOString() : '',
        creadoEnMs: gMs,
      });
    }
  }

  return result;
}

function deriveFromVisita(
  raw: any,
  ctx: SuscribirNotificacionesContext,
  readSet: Set<string>,
  coveredDirectKeys?: Set<string>,
): NotificacionSupervisor[] {
  const result: NotificacionSupervisor[] = [];
  if (!raw.ultimoSeguimientoMsg || !raw.ultimoSeguimientoEn) return result;

  const isSupervisor = ctx.role === 'supervisor';
  const isAdmin = ctx.role === 'admin' || ctx.role === 'jefe_operaciones';
  const visitaId = String(raw.id);
  const canonKey = `visita:${visitaId}:visita_seguimiento`;
  if (coveredDirectKeys?.has(canonKey)) {
    return result;
  }

  const siteName = String(raw.sucursalNombre || 'Sucursal');
  const segMs =
    toMs(raw.ultimoSeguimientoEn) ||
    toMs(raw.creadoEn) ||
    toMs(raw.fechaVisita) ||
    0;
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
      leida: !unreadSup || readSet.has(id) || readSet.has(canonKey),
      creadoEnISO: segMs ? new Date(segMs).toISOString() : '',
      creadoEnMs: segMs,
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
      leida: !unreadAdm || readSet.has(id) || readSet.has(canonKey),
      creadoEnISO: segMs ? new Date(segMs).toISOString() : '',
      creadoEnMs: segMs,
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

  const knownUnreadIds = new Set<string>();
  const knownUnreadAlertKeys = new Set<string>();
  let initialSourcesSettled = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    initialSourcesSettled = true;
  }, 2200);

  let disposed = false;
  const unsubs: Array<() => void> = [];

  const recompute = (allowEmitNew: boolean) => {
    if (disposed) return;

    // 1. Recopilar claves canónicas cubiertas por documentos directos de notificaciones_supervisor
    const coveredDirectKeys = new Set<string>();
    directNotifsMap.forEach((n) => {
      const ot = resolveOrigenTipo(n);
      if (n.origenId && n.tipo) {
        coveredDirectKeys.add(`${ot}:${n.origenId}:${n.tipo}`);
      }
    });

    const mergedNov = new Map<string, any>();
    novedadesBySource.forEach((m) => m.forEach((v, k) => mergedNov.set(k, v)));

    const mergedRounds = new Map<string, any>();
    rondasBySource.forEach((m) => m.forEach((v, k) => mergedRounds.set(k, v)));

    const provisionalReadSet = getReadNotifIds(uid);

    // 2. Derivar notificaciones sintéticas únicamente para eventos no cubiertos por Firestore directos
    const derived: NotificacionSupervisor[] = [];
    mergedNov.forEach((nov) => {
      derived.push(...deriveFromNovedad(nov, ctx, provisionalReadSet, coveredDirectKeys));
    });
    mergedRounds.forEach((rnd) => {
      derived.push(...deriveFromRound(rnd, ctx, provisionalReadSet, coveredDirectKeys));
    });
    visitasMap.forEach((vis) => {
      derived.push(...deriveFromVisita(vis, ctx, provisionalReadSet, coveredDirectKeys));
    });

    // 3. Preparar lista combinada sin duplicados
    const combined: NotificacionSupervisor[] = [];

    // Agregar las derivadas válidas (filtrando por si acaso alguna coincide con coveredDirectKeys)
    derived.forEach((d) => {
      const ot = resolveOrigenTipo(d);
      const canonKey = d.origenId && d.tipo ? `${ot}:${d.origenId}:${d.tipo}` : '';
      if (!canonKey || !coveredDirectKeys.has(canonKey)) {
        combined.push(d);
      }
    });

    // Agregar todas las directas (fuente de verdad oficial)
    directNotifsMap.forEach((n) => {
      combined.push(n);
    });

    // Asegurar marca de agua inicial para no saturar con registros históricos (> 24h)
    const finalReadSet = ensureInitialReadWatermark(uid, combined);

    // 4. Deduplicación canónica estricta
    // Para 'novedad_urgente', la clave canónica es `${ot}:${origenId}:novedad_urgente`.
    // Las directas de notificaciones_supervisor tienen precedencia sobre las derivadas.
    const byKey = new Map<string, NotificacionSupervisor>();

    combined.forEach((item) => {
      const canonKey = getNotificationCanonicalKey(item);
      const existing = byKey.get(canonKey);

      // Si no existe, agregarla.
      // Si ya existe y el nuevo item es directo (no empieza con 'drv_'), sobrescribe al sintético.
      if (!existing || (existing.id.startsWith('drv_') && !item.id.startsWith('drv_'))) {
        byKey.set(canonKey, {
          ...item,
          leida: isNotifRead(uid, item, finalReadSet),
        });
      }
    });

    // Filtrar estrictamente por la ventana operativa requerida:
    // - Nuevas / vistas: dentro de las últimas 24 horas.
    // - No vistas / pendientes: dentro de un máximo de 36 horas.
    // Los eventos que excedan estas ventanas (o de meses anteriores) se excluyen de la operativa.
    const now = Date.now();
    const all = Array.from(byKey.values())
      .filter((item) => isNotificationWithinOperationalWindow(item, now))
      .sort((a, b) => b.creadoEnMs - a.creadoEnMs);

    // 5. Detección de nuevas notificaciones para emitir alerta sonora/toast sin duplicados
    const nuevas: NotificacionSupervisor[] = [];
    if (initialSourcesSettled && allowEmitNew) {
      all.forEach((item) => {
        const canonKey = getNotificationCanonicalKey(item);
        const ot = resolveOrigenTipo(item);
        const eventKey = item.origenId && item.tipo ? `${ot}:${item.origenId}:${item.tipo}` : '';

        const isAlreadyKnown =
          knownUnreadIds.has(item.id) ||
          knownUnreadAlertKeys.has(canonKey) ||
          (eventKey ? knownUnreadAlertKeys.has(eventKey) : false);

        if (!item.leida && !isAlreadyKnown && item.creadaPorUid !== uid) {
          nuevas.push(item);
        }
      });
    }

    // Actualizar conjunto de IDs y claves canónicas ya conocidos para evitar re-alertas
    all.forEach((item) => {
      knownUnreadIds.add(item.id);
      knownUnreadAlertKeys.add(getNotificationCanonicalKey(item));
      if (item.origenId && item.tipo) {
        knownUnreadAlertKeys.add(`${resolveOrigenTipo(item)}:${item.origenId}:${item.tipo}`);
      }
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
          const ms = toMs(data.creadoEn) || toMs(data.createdAt) || 0;
          const tipo = data.tipo as TipoNotificacionSupervisor;
          const origenTipo = resolveOrigenTipo({
            id: d.id,
            tipo,
            origenTipo: data.origenTipo || undefined,
            vista: data.vista,
          });
          directNotifsMap.set(d.id, {
            id: d.id,
            destinatarioUid: String(data.destinatarioUid || ''),
            tipo,
            titulo: String(data.titulo || 'Notificación'),
            mensaje: String(data.mensaje || ''),
            siteId: data.siteId ? String(data.siteId) : undefined,
            siteName: data.siteName || undefined,
            origenTipo,
            origenId: data.origenId || undefined,
            vista: (data.vista || 'dashboard') as NotificacionSupervisor['vista'],
            creadaPorUid: String(data.creadaPorUid || ''),
            creadaPorNombre: String(data.creadaPorNombre || ''),
            leida: Boolean(data.leida),
            creadoEnISO: ms ? new Date(ms).toISOString() : '',
            creadoEnMs: ms,
          });
        });
        recompute(true);
      },
      () => {
        /* Funciona 100% con la derivación en vivo incluso si notificaciones_supervisor no está desplegada */
      },
    ),
  );

  // Reevalúa periódicamente la ventana operativa (cada 60s) para descartar eventos que expiren
  const windowInterval = setInterval(() => {
    recompute(false);
  }, 60 * 1000);

  return () => {
    disposed = true;
    if (settleTimer) clearTimeout(settleTimer);
    clearInterval(windowInterval);
    if (typeof window !== 'undefined') {
      window.removeEventListener(NOTIFS_UPDATED_EVENT, handleLocalReadEvent);
    }
    unsubs.forEach((u) => u());
  };
}
