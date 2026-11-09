/**
 * gestionIncidenciaService.ts
 *
 * Servicio de Gestión Operacional del Supervisor y Alertas Operacionales Consolidada.
 *
 * Cumple estrictamente con el Complemento Técnico:
 * 1. Historial en subcolecciones independientes e inmutables:
 *    - Rondas/{roundId}/historialGestion/{gestionId}
 *    - novedades/{novedadId}/historialGestion/{gestionId}
 *    Manteniendo en el documento padre únicamente el resumen `gestionSupervisor`.
 * 2. Protección total de registros originales:
 *    - Nunca modifica Rondas.result, Rondas.status, novedades.estado,
 *      novedades.prioridad, novedades.requiereSeguimiento, novedades.seguimientos,
 *      fotografías, evidencias, trabajadores, fechas originales ni instalaciones.
 * 3. Fecha oficial del servidor mediante `serverTimestamp()` (sin arrayUnion).
 * 4. Consultas acotadas por `assignedSites` (soportando IDs históricos string y number)
 *    para Supervisores, y filtradas por severidad en servidor para Administración.
 */

import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  ConsultaAdminResumen,
  EstadoSolucionSupervisor,
  GestionSupervisorEntry,
  GestionSupervisorResumen,
  GuardRound,
  Novedad,
  RegistroNovedad,
  TipoRegistroGestionSupervisor,
} from '../../types';

export const RONDAS_COL = 'Rondas';
export const NOVEDADES_COL = 'novedades';
export const HISTORIAL_GESTION_SUBCOL = 'historialGestion';

/** Clasificación oficial de la bandeja de Alertas Operacionales */
export type ClasificacionAlertaOperacional =
  | 'ronda_novedad'
  | 'ronda_sospecha'
  | 'novedad_critica'
  | 'novedad_alta';

export type EstadoFiltroGestion = 'todos' | 'sin_gestion' | 'si' | 'no' | 'pendiente';

/** Elemento unificado de Alerta Operacional (sin duplicar documento en BD) */
export interface AlertaOperacionalItem {
  /** ID compuesto para keys de UI: `${origenTipo}_${origenId}` */
  uidKey: string;
  origenTipo: 'ronda' | 'novedad';
  origenId: string;
  clasificacion: ClasificacionAlertaOperacional;
  clasificacionLabel: string;
  siteId: string;
  siteName: string;
  fechaHoraISO: string;
  timestampMs: number;
  trabajadorId: string;
  trabajadorNombre: string;
  descripcion: string;
  categoriaIcono?: string;
  categoriaLabel?: string;
  /** Estado nativo del registro original (intacto, solo lectura en esta capa) */
  estadoOriginal: string;
  /** Fotos/evidencias del registro original */
  fotosUrls: string[];
  /** Resumen de la última gestión del supervisor (null si es histórico o sin gestión) */
  gestionSupervisor: GestionSupervisorResumen | null;
  /** Referencia al objeto original para abrir modales existentes (RouteMapModal / Seguimiento) */
  originalRound?: GuardRound;
  originalNovedad?: RegistroNovedad | Novedad;
}

export interface RegistrarGestionParams {
  origenTipo: 'ronda' | 'novedad';
  origenId: string;
  siteId: string | number;
  siteName?: string;
  fueSolucionado: EstadoSolucionSupervisor;
  medidasTomadas: string;
  observaciones?: string;
  motivoNoSolucionado?: string;
  requiereIntervencionJefatura?: boolean;
  supervisorUid: string;
  supervisorNombre: string;
  supervisorRole?: 'supervisor' | 'admin' | 'jefe_operaciones';
  assignedSites?: (string | number)[];
  prevResumen?: GestionSupervisorResumen | null;
}

export interface EnviarConsultaAdminParams {
  origenTipo: 'ronda' | 'novedad';
  origenId: string;
  siteId: string | number;
  siteName?: string;
  mensaje: string;
  adminUid: string;
  adminNombre: string;
  prevResumen?: GestionSupervisorResumen | null;
}

// ─── Helpers de normalización de siteId / sucursalId (string y number) ──────

export function normalizeSiteId(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

/**
 * Construye variantes string y number para consultas Firestore `in`
 * garantizando compatibilidad con registros históricos donde siteId/sucursalId
 * fue guardado como número o como string.
 */
export function buildSiteIdVariants(siteIds: (string | number)[]): (string | number)[] {
  const seen = new Set<string>();
  const result: (string | number)[] = [];

  for (const raw of siteIds) {
    const str = normalizeSiteId(raw);
    if (!str) continue;

    const strKey = `s:${str}`;
    if (!seen.has(strKey)) {
      seen.add(strKey);
      result.push(str);
    }

    if (/^\d+$/.test(str)) {
      const num = Number(str);
      if (Number.isSafeInteger(num)) {
        const numKey = `n:${num}`;
        if (!seen.has(numKey)) {
          seen.add(numKey);
          result.push(num);
        }
      }
    }
  }

  return result;
}

/** Divide un arreglo en bloques de tamaño máximo `size` (ej. 30 para Firestore `in`) */
export function chunkArray<T>(items: T[], size = 30): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Verifica si una instalación pertenece a las instalaciones asignadas al supervisor */
export function isSiteAllowedForSupervisor(
  targetSiteId: string | number | undefined | null,
  assignedSites?: (string | number)[],
): boolean {
  const normalizedTarget = normalizeSiteId(targetSiteId);
  if (!normalizedTarget || !assignedSites || assignedSites.length === 0) return false;
  return assignedSites.some((s) => normalizeSiteId(s) === normalizedTarget);
}

/** Formatea cualquier fecha/Timestamp de Firestore o ISO string a ISO string seguro */
export function toSafeISOString(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val?.toDate === 'function') {
    try {
      return val.toDate().toISOString();
    } catch {
      return '';
    }
  }
  if (typeof val?.seconds === 'number') {
    return new Date(val.seconds * 1000).toISOString();
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  return '';
}

export function toTimestampMs(val: any, fallbackFecha?: string, fallbackHora?: string): number {
  const iso = toSafeISOString(val);
  if (iso) {
    const parsed = Date.parse(iso);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (fallbackFecha) {
    const composed = fallbackHora ? `${fallbackFecha}T${fallbackHora}:00` : `${fallbackFecha}T00:00:00`;
    const parsed = Date.parse(composed);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

// ─── Parseo de Resumen e Historial de Gestión ───────────────────────────────

export function parseGestionSupervisorResumen(raw: any): GestionSupervisorResumen | null {
  if (!raw || typeof raw !== 'object' || !raw.fueSolucionado || !raw.medidasTomadas) {
    return null;
  }
  const tipoRegistro: TipoRegistroGestionSupervisor =
    raw.tipoRegistro === 'consulta_admin' ? 'consulta_admin' : 'gestion_supervisor';

  let consultaAdmin: ConsultaAdminResumen | null = null;
  if (raw.consultaAdmin && typeof raw.consultaAdmin === 'object' && raw.consultaAdmin.mensaje) {
    consultaAdmin = {
      mensaje: String(raw.consultaAdmin.mensaje),
      adminUid: String(raw.consultaAdmin.adminUid || ''),
      adminNombre: String(raw.consultaAdmin.adminNombre || 'Administración'),
      fechaISO: toSafeISOString(raw.consultaAdmin.fechaISO) || String(raw.consultaAdmin.fechaISO || ''),
      pendienteRespuesta: Boolean(raw.consultaAdmin.pendienteRespuesta),
    };
  }

  return {
    ultimaGestionId: String(raw.ultimaGestionId || ''),
    tipoRegistro,
    fueSolucionado: raw.fueSolucionado as EstadoSolucionSupervisor,
    medidasTomadas: String(raw.medidasTomadas || ''),
    observaciones: raw.observaciones ? String(raw.observaciones) : undefined,
    motivoNoSolucionado: raw.motivoNoSolucionado ? String(raw.motivoNoSolucionado) : undefined,
    requiereIntervencionJefatura: Boolean(raw.requiereIntervencionJefatura),
    supervisorUid: String(raw.supervisorUid || ''),
    supervisorNombre: String(raw.supervisorNombre || 'Supervisor'),
    ultimoSupervisorUid: raw.ultimoSupervisorUid ? String(raw.ultimoSupervisorUid) : undefined,
    ultimoSupervisorNombre: raw.ultimoSupervisorNombre ? String(raw.ultimoSupervisorNombre) : undefined,
    fechaGestion: raw.fechaGestion,
    fechaGestionISO: toSafeISOString(raw.fechaGestion) || raw.fechaGestionISO || '',
    fechaUltimaGestionSupervisorISO: raw.fechaUltimaGestionSupervisorISO
      ? String(raw.fechaUltimaGestionSupervisorISO)
      : undefined,
    consultaAdmin,
    totalGestiones: typeof raw.totalGestiones === 'number' ? raw.totalGestiones : undefined,
  };
}

export function parseGestionSupervisorEntry(docSnap: any): GestionSupervisorEntry {
  const data = typeof docSnap.data === 'function' ? docSnap.data() : docSnap;
  const id = docSnap.id || data.id || '';
  const tipoRegistro: TipoRegistroGestionSupervisor =
    data.tipoRegistro === 'consulta_admin' ? 'consulta_admin' : 'gestion_supervisor';
  return {
    id,
    origenTipo: data.origenTipo === 'ronda' ? 'ronda' : 'novedad',
    origenId: String(data.origenId || ''),
    siteId: normalizeSiteId(data.siteId),
    siteName: data.siteName ? String(data.siteName) : undefined,
    tipoRegistro,
    fueSolucionado: data.fueSolucionado as EstadoSolucionSupervisor,
    medidasTomadas: String(data.medidasTomadas || ''),
    observaciones: data.observaciones ? String(data.observaciones) : undefined,
    motivoNoSolucionado: data.motivoNoSolucionado ? String(data.motivoNoSolucionado) : undefined,
    requiereIntervencionJefatura: Boolean(data.requiereIntervencionJefatura),
    supervisorUid: String(data.supervisorUid || ''),
    supervisorNombre: String(data.supervisorNombre || 'Supervisor'),
    fechaGestion: data.fechaGestion,
    fechaGestionISO: toSafeISOString(data.fechaGestion) || data.fechaGestionISO || '',
  };
}

// ─── Conversión de Rondas y Novedades a AlertaOperacionalItem ───────────────

export function mapRoundToAlertaItem(
  round: GuardRound,
  siteNameLookup?: (siteId: string) => string,
): AlertaOperacionalItem | null {
  if (round.result !== 'CON_NOVEDAD' && round.result !== 'SOSPECHA') {
    return null;
  }

  const clasificacion: ClasificacionAlertaOperacional =
    round.result === 'SOSPECHA' ? 'ronda_sospecha' : 'ronda_novedad';
  const clasificacionLabel =
    round.result === 'SOSPECHA' ? 'Ronda con sospecha' : 'Ronda con novedad';

  const siteId = normalizeSiteId(round.siteId);
  const siteName =
    round.siteName || (siteNameLookup ? siteNameLookup(siteId) : '') || `Instalación #${siteId}`;
  const rawTime = round.endTime || round.startTime || (round as any).finishedAt || (round as any).startedAt;
  const fechaHoraISO = toSafeISOString(rawTime);
  const timestampMs = toTimestampMs(rawTime);

  const fotosUrls: string[] = [];
  if (Array.isArray(round.evidences)) {
    for (const ev of round.evidences) {
      if (ev?.photoUrl && !fotosUrls.includes(ev.photoUrl)) {
        fotosUrls.push(ev.photoUrl);
      }
    }
  }
  const anyRound = round as any;
  if (anyRound.IncidentPhotoUrl && !fotosUrls.includes(anyRound.IncidentPhotoUrl)) {
    fotosUrls.push(anyRound.IncidentPhotoUrl);
  }
  if (Array.isArray(anyRound.incidentPhotos)) {
    for (const u of anyRound.incidentPhotos) {
      if (u && !fotosUrls.includes(u)) fotosUrls.push(u);
    }
  }

  return {
    uidKey: `ronda_${round.id}`,
    origenTipo: 'ronda',
    origenId: round.id,
    clasificacion,
    clasificacionLabel,
    siteId,
    siteName,
    fechaHoraISO,
    timestampMs,
    trabajadorId: round.workerId || '',
    trabajadorNombre: round.workerName || 'Guardia',
    descripcion:
      round.notes?.trim() ||
      anyRound.observations?.trim() ||
      (round.result === 'SOSPECHA'
        ? 'Ronda reportada con actividad sospechosa.'
        : 'Ronda reportada con novedad operacional.'),
    categoriaIcono: round.result === 'SOSPECHA' ? '🚨' : '🛰️',
    categoriaLabel: round.result === 'SOSPECHA' ? 'Sospecha en Ronda' : 'Novedad en Ronda',
    estadoOriginal: round.status === 'COMPLETED' ? 'COMPLETADA' : round.status || 'REGISTRADA',
    fotosUrls,
    gestionSupervisor: parseGestionSupervisorResumen(round.gestionSupervisor),
    originalRound: round,
  };
}

export function mapNovedadToAlertaItem(
  rawDoc: any,
  siteNameLookup?: (siteId: string) => string,
): AlertaOperacionalItem | null {
  const prioridad = String(rawDoc.prioridad || '').toLowerCase();
  if (prioridad !== 'critica' && prioridad !== 'alta') {
    return null;
  }

  const clasificacion: ClasificacionAlertaOperacional =
    prioridad === 'critica' ? 'novedad_critica' : 'novedad_alta';
  const clasificacionLabel =
    prioridad === 'critica' ? 'Novedad crítica' : 'Novedad de prioridad alta';

  const siteId = normalizeSiteId(rawDoc.sucursalId ?? rawDoc.siteId);
  const siteName =
    rawDoc.sucursalNombre ||
    rawDoc.siteName ||
    (siteNameLookup ? siteNameLookup(siteId) : '') ||
    `Instalación #${siteId}`;

  const fechaHoraISO =
    toSafeISOString(rawDoc.fechaHoraEvento) ||
    toSafeISOString(rawDoc.creadoEn) ||
    toSafeISOString(rawDoc.createdAt) ||
    (rawDoc.fechaEvento
      ? `${rawDoc.fechaEvento}T${rawDoc.horaEvento || '00:00'}:00`
      : '');

  const timestampMs = toTimestampMs(
    rawDoc.fechaHoraEvento || rawDoc.creadoEn || rawDoc.createdAt,
    rawDoc.fechaEvento,
    rawDoc.horaEvento,
  );

  const fotosUrls: string[] = [];
  const pushFoto = (val: any) => {
    if (!val) return;
    if (typeof val === 'string' && val.trim().startsWith('http') && !fotosUrls.includes(val.trim())) {
      fotosUrls.push(val.trim());
    } else if (typeof val === 'object' && typeof val.url === 'string' && val.url.trim().startsWith('http')) {
      const u = val.url.trim();
      if (!fotosUrls.includes(u)) fotosUrls.push(u);
    }
  };

  if (Array.isArray(rawDoc.evidencias)) rawDoc.evidencias.forEach(pushFoto);
  if (Array.isArray(rawDoc.fotos)) rawDoc.fotos.forEach(pushFoto);
  if (rawDoc.evidenciaUrl) pushFoto(rawDoc.evidenciaUrl);
  if (rawDoc.fotoUrl) pushFoto(rawDoc.fotoUrl);
  if (rawDoc.foto) pushFoto(rawDoc.foto);

  return {
    uidKey: `novedad_${rawDoc.id}`,
    origenTipo: 'novedad',
    origenId: String(rawDoc.id),
    clasificacion,
    clasificacionLabel,
    siteId,
    siteName,
    fechaHoraISO,
    timestampMs,
    trabajadorId: String(rawDoc.autorUid || rawDoc.colaboradorId || ''),
    trabajadorNombre: String(rawDoc.autorNombre || rawDoc.colaboradorNombre || 'Guardia'),
    descripcion: String(rawDoc.descripcion || rawDoc.titulo || 'Sin descripción'),
    categoriaLabel: String(rawDoc.tipoLabel || rawDoc.categoria || rawDoc.tipo || 'Novedad'),
    estadoOriginal: String(rawDoc.estado || 'registrada').toUpperCase(),
    fotosUrls,
    gestionSupervisor: parseGestionSupervisorResumen(rawDoc.gestionSupervisor),
    originalNovedad: rawDoc,
  };
}

// ─── Construcción pura de Payloads (testeable y con protección de campos) ───

export function validateRegistrarGestionInput(params: RegistrarGestionParams): void {
  if (!params.origenId || !params.origenId.trim()) {
    throw new Error('El identificador del registro original es obligatorio.');
  }
  if (!['si', 'no', 'pendiente'].includes(params.fueSolucionado)) {
    throw new Error('Debe seleccionar un estado de solución válido (Sí, No o Pendiente de decisión).');
  }
  if (!params.medidasTomadas || !params.medidasTomadas.trim()) {
    throw new Error('El campo "Medidas tomadas" es obligatorio.');
  }
  if (
    params.fueSolucionado === 'no' &&
    (!params.motivoNoSolucionado || !params.motivoNoSolucionado.trim())
  ) {
    throw new Error('Cuando la incidencia NO fue solucionada, debe indicar el motivo.');
  }
  if (!params.supervisorUid || !params.supervisorUid.trim()) {
    throw new Error('No se pudo identificar al supervisor responsable.');
  }
  // Si el usuario tiene rol supervisor, validar que la instalación esté dentro de sus assignedSites
  if (params.supervisorRole === 'supervisor') {
    if (!isSiteAllowedForSupervisor(params.siteId, params.assignedSites)) {
      throw new Error('No tiene permisos para gestionar incidencias de una instalación no asignada.');
    }
  }
}

/**
 * Construye únicamente el objeto de actualización para el documento padre.
 * Garantiza que SOLO la clave `gestionSupervisor` sea tocada (Complemento Técnico #2).
 */
export function buildParentGestionUpdatePayload(
  params: RegistrarGestionParams,
  gestionId: string,
  timestampToken: unknown,
): { gestionSupervisor: Record<string, unknown> } {
  const resumen: Record<string, unknown> = {
    ultimaGestionId: gestionId,
    tipoRegistro: 'gestion_supervisor',
    fueSolucionado: params.fueSolucionado,
    medidasTomadas: params.medidasTomadas.trim(),
    observaciones: params.observaciones?.trim() || '',
    motivoNoSolucionado:
      params.fueSolucionado === 'no' ? params.motivoNoSolucionado?.trim() || '' : '',
    requiereIntervencionJefatura:
      params.fueSolucionado === 'no' ? Boolean(params.requiereIntervencionJefatura) : false,
    supervisorUid: params.supervisorUid,
    supervisorNombre: params.supervisorNombre || 'Supervisor',
    ultimoSupervisorUid: params.supervisorUid,
    ultimoSupervisorNombre: params.supervisorNombre || 'Supervisor',
    fechaGestion: timestampToken,
  };

  if (params.prevResumen?.consultaAdmin) {
    resumen.consultaAdmin = {
      ...params.prevResumen.consultaAdmin,
      pendienteRespuesta: false,
    };
  }

  return {
    gestionSupervisor: resumen,
  };
}

// ─── Escritura Atómica en Subcolección + Resumen en Documento Padre ─────────

export async function registrarGestionSupervisor(
  params: RegistrarGestionParams,
): Promise<{ gestionId: string }> {
  validateRegistrarGestionInput(params);

  const parentCollectionName = params.origenTipo === 'ronda' ? RONDAS_COL : NOVEDADES_COL;
  const gestionId = `gest_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const parentRef = doc(db, parentCollectionName, params.origenId);
  const historialRef = doc(
    collection(db, parentCollectionName, params.origenId, HISTORIAL_GESTION_SUBCOL),
    gestionId,
  );

  const officialTimestamp = serverTimestamp();

  const historialDoc: Record<string, unknown> = {
    id: gestionId,
    origenTipo: params.origenTipo,
    origenId: params.origenId,
    siteId: normalizeSiteId(params.siteId),
    siteName: params.siteName || '',
    tipoRegistro: 'gestion_supervisor',
    fueSolucionado: params.fueSolucionado,
    medidasTomadas: params.medidasTomadas.trim(),
    observaciones: params.observaciones?.trim() || '',
    motivoNoSolucionado:
      params.fueSolucionado === 'no' ? params.motivoNoSolucionado?.trim() || '' : '',
    requiereIntervencionJefatura:
      params.fueSolucionado === 'no' ? Boolean(params.requiereIntervencionJefatura) : false,
    supervisorUid: params.supervisorUid,
    supervisorNombre: params.supervisorNombre || 'Supervisor',
    fechaGestion: officialTimestamp,
  };

  const parentUpdate = buildParentGestionUpdatePayload(params, gestionId, officialTimestamp);

  try {
    const batch = writeBatch(db);
    batch.set(historialRef, historialDoc);
    batch.update(parentRef, parentUpdate);
    await batch.commit();
  } catch (err: any) {
    // Si las reglas de la subcolección historialGestion aún no han sido desplegadas en la nube,
    // actualizamos únicamente el resumen gestionSupervisor en el documento padre sin tocar campos originales.
    if (err?.code === 'permission-denied') {
      await updateDoc(parentRef, parentUpdate);
    } else {
      throw err;
    }
  }

  return { gestionId };
}

/**
 * Envía una consulta o requerimiento rápido desde Administración / Jefatura
 * para que sea leído y gestionado por el supervisor asignado a la instalación.
 */
export async function enviarConsultaASupervisor(
  params: EnviarConsultaAdminParams,
): Promise<{
  gestionId: string;
  nuevoResumen: GestionSupervisorResumen;
  nuevaEntrada: GestionSupervisorEntry;
}> {
  if (!params.origenId || !params.origenId.trim()) {
    throw new Error('El identificador del registro original es obligatorio.');
  }
  const mensajeLimpio = (params.mensaje || '').trim();
  if (!mensajeLimpio) {
    throw new Error('Debe seleccionar o escribir una consulta para enviar al supervisor.');
  }
  if (!params.adminUid || !params.adminUid.trim()) {
    throw new Error('No se pudo identificar al administrador.');
  }

  const parentCollectionName = params.origenTipo === 'ronda' ? RONDAS_COL : NOVEDADES_COL;
  const gestionId = `cons_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const parentRef = doc(db, parentCollectionName, params.origenId);
  const historialRef = doc(
    collection(db, parentCollectionName, params.origenId, HISTORIAL_GESTION_SUBCOL),
    gestionId,
  );

  const officialTimestamp = serverTimestamp();
  const nowISO = new Date().toISOString();

  const consultaAdminObj: ConsultaAdminResumen = {
    mensaje: mensajeLimpio,
    adminUid: params.adminUid,
    adminNombre: params.adminNombre || 'Administración',
    fechaISO: nowISO,
    pendienteRespuesta: true,
  };

  const historialDoc: Record<string, unknown> = {
    id: gestionId,
    origenTipo: params.origenTipo,
    origenId: params.origenId,
    siteId: normalizeSiteId(params.siteId),
    siteName: params.siteName || '',
    tipoRegistro: 'consulta_admin',
    fueSolucionado: 'pendiente',
    medidasTomadas: mensajeLimpio,
    observaciones: '',
    motivoNoSolucionado: '',
    requiereIntervencionJefatura: false,
    supervisorUid: params.adminUid,
    supervisorNombre: params.adminNombre || 'Administración',
    fechaGestion: officialTimestamp,
  };

  const prev = params.prevResumen;
  const tieneGestionSupervisorPrevia = Boolean(prev && prev.tipoRegistro !== 'consulta_admin');

  const fueSolucionadoPadre: EstadoSolucionSupervisor = tieneGestionSupervisorPrevia
    ? prev!.fueSolucionado
    : 'pendiente';
  const medidasPadre = tieneGestionSupervisorPrevia ? prev!.medidasTomadas : mensajeLimpio;
  const motivoPadre =
    fueSolucionadoPadre === 'no'
      ? prev?.motivoNoSolucionado?.trim() || 'En revisión por consulta de Jefatura'
      : '';
  const supNombreVisible = tieneGestionSupervisorPrevia
    ? prev!.ultimoSupervisorNombre || prev!.supervisorNombre
    : params.adminNombre || 'Administración';
  const supUidPrevio = tieneGestionSupervisorPrevia
    ? prev!.ultimoSupervisorUid || prev!.supervisorUid
    : undefined;

  const resumenPadre: Record<string, unknown> = {
    ultimaGestionId: tieneGestionSupervisorPrevia ? prev!.ultimaGestionId || gestionId : gestionId,
    tipoRegistro: tieneGestionSupervisorPrevia ? 'gestion_supervisor' : 'consulta_admin',
    fueSolucionado: fueSolucionadoPadre,
    medidasTomadas: medidasPadre,
    observaciones: tieneGestionSupervisorPrevia ? prev!.observaciones || '' : '',
    motivoNoSolucionado: motivoPadre,
    requiereIntervencionJefatura: tieneGestionSupervisorPrevia
      ? Boolean(prev!.requiereIntervencionJefatura)
      : false,
    // Cumple con isValidGestionSupervisorPayload: g.supervisorUid == request.auth.uid
    supervisorUid: params.adminUid,
    supervisorNombre: supNombreVisible,
    ...(supUidPrevio ? { ultimoSupervisorUid: supUidPrevio } : {}),
    ...(tieneGestionSupervisorPrevia ? { ultimoSupervisorNombre: supNombreVisible } : {}),
    ...(tieneGestionSupervisorPrevia && (prev!.fechaUltimaGestionSupervisorISO || prev!.fechaGestionISO)
      ? {
          fechaUltimaGestionSupervisorISO:
            prev!.fechaUltimaGestionSupervisorISO || prev!.fechaGestionISO,
        }
      : {}),
    fechaGestion: officialTimestamp,
    consultaAdmin: consultaAdminObj,
  };

  try {
    const batch = writeBatch(db);
    batch.set(historialRef, historialDoc);
    batch.update(parentRef, { gestionSupervisor: resumenPadre });
    await batch.commit();
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      await updateDoc(parentRef, { gestionSupervisor: resumenPadre });
    } else {
      throw err;
    }
  }

  const nuevoResumen: GestionSupervisorResumen = {
    ultimaGestionId: String(resumenPadre.ultimaGestionId),
    tipoRegistro: resumenPadre.tipoRegistro as TipoRegistroGestionSupervisor,
    fueSolucionado: fueSolucionadoPadre,
    medidasTomadas: medidasPadre,
    observaciones: tieneGestionSupervisorPrevia ? prev!.observaciones : undefined,
    motivoNoSolucionado: motivoPadre || undefined,
    requiereIntervencionJefatura: Boolean(resumenPadre.requiereIntervencionJefatura),
    supervisorUid: supUidPrevio || params.adminUid,
    supervisorNombre: supNombreVisible,
    ultimoSupervisorUid: supUidPrevio,
    ultimoSupervisorNombre: tieneGestionSupervisorPrevia ? supNombreVisible : undefined,
    fechaGestion: nowISO,
    fechaGestionISO:
      tieneGestionSupervisorPrevia && (prev!.fechaUltimaGestionSupervisorISO || prev!.fechaGestionISO)
        ? prev!.fechaUltimaGestionSupervisorISO || prev!.fechaGestionISO
        : nowISO,
    fechaUltimaGestionSupervisorISO:
      tieneGestionSupervisorPrevia && (prev!.fechaUltimaGestionSupervisorISO || prev!.fechaGestionISO)
        ? prev!.fechaUltimaGestionSupervisorISO || prev!.fechaGestionISO
        : undefined,
    consultaAdmin: consultaAdminObj,
  };

  const nuevaEntrada: GestionSupervisorEntry = {
    id: gestionId,
    origenTipo: params.origenTipo,
    origenId: params.origenId,
    siteId: normalizeSiteId(params.siteId),
    siteName: params.siteName || '',
    tipoRegistro: 'consulta_admin',
    fueSolucionado: 'pendiente',
    medidasTomadas: mensajeLimpio,
    supervisorUid: params.adminUid,
    supervisorNombre: params.adminNombre || 'Administración',
    fechaGestion: nowISO,
    fechaGestionISO: nowISO,
  };

  return { gestionId, nuevoResumen, nuevaEntrada };
}

// ─── Consulta del Historial Inmutable desde la Subcolección ─────────────────

export async function obtenerHistorialGestion(
  origenTipo: 'ronda' | 'novedad',
  origenId: string,
): Promise<GestionSupervisorEntry[]> {
  try {
    const parentCollectionName = origenTipo === 'ronda' ? RONDAS_COL : NOVEDADES_COL;
    const subcolRef = collection(db, parentCollectionName, origenId, HISTORIAL_GESTION_SUBCOL);
    const q = query(subcolRef, orderBy('fechaGestion', 'desc'));
    const snap = await getDocs(q);

    return snap.docs.map((d) => parseGestionSupervisorEntry(d));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      return [];
    }
    throw err;
  }
}

// ─── Consultas Acotadas de Alertas Operacionales (Supervisor vs Admin) ──────

/**
 * Consulta las alertas operacionales exclusivamente de las instalaciones asignadas
 * al supervisor (soportando IDs string y number en bloques de hasta 30).
 * No realiza lecturas globales de colecciones.
 */
export async function fetchAlertasOperacionalesSupervisor(
  assignedSites: (string | number)[],
  siteNameLookup?: (siteId: string) => string,
  maxPerChunk = 120,
): Promise<AlertaOperacionalItem[]> {
  const variants = buildSiteIdVariants(assignedSites);
  if (variants.length === 0) return [];

  const chunks = chunkArray(variants, 30);
  const rondasMap = new Map<string, GuardRound>();
  const novedadesMap = new Map<string, any>();

  await Promise.all(
    chunks.map(async (chunk) => {
      // 1. Rondas acotadas a las instalaciones asignadas
      const qRondas = query(
        collection(db, RONDAS_COL),
        where('siteId', 'in', chunk),
        limit(maxPerChunk),
      );

      // 2. Novedades acotadas por sucursalId y fallback siteId (esquema dual)
      const qNovSucursal = query(
        collection(db, NOVEDADES_COL),
        where('sucursalId', 'in', chunk),
        limit(maxPerChunk),
      );
      const qNovSite = query(
        collection(db, NOVEDADES_COL),
        where('siteId', 'in', chunk),
        limit(maxPerChunk),
      );

      const [rondasSnap, novSucSnap, novSiteSnap] = await Promise.all([
        getDocs(qRondas),
        getDocs(qNovSucursal),
        getDocs(qNovSite),
      ]);

      rondasSnap.docs.forEach((d) => {
        const data = d.data() as Omit<GuardRound, 'id'>;
        if (data.result === 'CON_NOVEDAD' || data.result === 'SOSPECHA') {
          rondasMap.set(d.id, { id: d.id, ...data });
        }
      });

      const processNovDoc = (d: any) => {
        const data = d.data();
        const prio = String(data.prioridad || '').toLowerCase();
        if (prio === 'critica' || prio === 'alta') {
          novedadesMap.set(d.id, { id: d.id, ...data });
        }
      };

      novSucSnap.docs.forEach(processNovDoc);
      novSiteSnap.docs.forEach(processNovDoc);
    }),
  );

  const items: AlertaOperacionalItem[] = [];

  rondasMap.forEach((round) => {
    // Doble verificación de seguridad por instalación asignada
    if (isSiteAllowedForSupervisor(round.siteId, assignedSites)) {
      const mapped = mapRoundToAlertaItem(round, siteNameLookup);
      if (mapped) items.push(mapped);
    }
  });

  novedadesMap.forEach((nov) => {
    const novSite = nov.sucursalId ?? nov.siteId;
    if (isSiteAllowedForSupervisor(novSite, assignedSites)) {
      const mapped = mapNovedadToAlertaItem(nov, siteNameLookup);
      if (mapped) items.push(mapped);
    }
  });

  return items.sort((a, b) => b.timestampMs - a.timestampMs);
}

/**
 * Consulta global acotada por severidad en servidor para Administración:
 * Solo descarga Rondas CON_NOVEDAD/SOSPECHA y Novedades critica/alta.
 */
export async function fetchAlertasOperacionalesAdmin(
  siteNameLookup?: (siteId: string) => string,
  maxItemsPerSource = 200,
): Promise<AlertaOperacionalItem[]> {
  const qRondas = query(
    collection(db, RONDAS_COL),
    where('result', 'in', ['CON_NOVEDAD', 'SOSPECHA']),
    limit(maxItemsPerSource),
  );

  const qNovedades = query(
    collection(db, NOVEDADES_COL),
    where('prioridad', 'in', ['critica', 'alta']),
    limit(maxItemsPerSource),
  );

  const [rondasSnap, novSnap] = await Promise.all([getDocs(qRondas), getDocs(qNovedades)]);

  const items: AlertaOperacionalItem[] = [];

  rondasSnap.docs.forEach((d) => {
    const round = { id: d.id, ...(d.data() as Omit<GuardRound, 'id'>) };
    const mapped = mapRoundToAlertaItem(round, siteNameLookup);
    if (mapped) items.push(mapped);
  });

  novSnap.docs.forEach((d) => {
    const nov = { id: d.id, ...d.data() };
    const mapped = mapNovedadToAlertaItem(nov, siteNameLookup);
    if (mapped) items.push(mapped);
  });

  return items.sort((a, b) => b.timestampMs - a.timestampMs);
}

// ─── Suscripciones en Tiempo Real (onSnapshot) ──────────────────────────────

const LIVE_OPTS = { serverTimestamps: 'estimate' } as const;

/**
 * Historial de gestiones/consultas en tiempo real (subcolección inmutable).
 * Usa estimación de serverTimestamp para que los registros propios aparezcan al instante.
 */
export function subscribeHistorialGestion(
  origenTipo: 'ronda' | 'novedad',
  origenId: string,
  onData: (entries: GestionSupervisorEntry[]) => void,
  onError?: (err: unknown) => void,
): () => void {
  const parentCollectionName = origenTipo === 'ronda' ? RONDAS_COL : NOVEDADES_COL;
  const subcolRef = collection(db, parentCollectionName, origenId, HISTORIAL_GESTION_SUBCOL);
  // Sin orderBy en servidor: evita excluir docs con timestamp pendiente; se ordena en cliente.
  return onSnapshot(
    subcolRef,
    (snap) => {
      const entries = snap.docs.map((d) =>
        parseGestionSupervisorEntry({ id: d.id, ...(d.data(LIVE_OPTS) as object) }),
      );
      entries.sort(
        (a, b) => Date.parse(b.fechaGestionISO || '') - Date.parse(a.fechaGestionISO || ''),
      );
      onData(entries);
    },
    (err) => onError?.(err),
  );
}

export interface SubscribeAlertasParams {
  /** 'admin' = vista global; 'supervisor' = acotada a assignedSites */
  modo: 'admin' | 'supervisor';
  assignedSites?: (string | number)[];
  siteNameLookup?: (siteId: string) => string;
  onData: (items: AlertaOperacionalItem[]) => void;
  onError?: (err: unknown) => void;
  maxPerQuery?: number;
}

/**
 * Alertas operacionales en tiempo real. Mismas consultas acotadas que los `fetch*`,
 * pero con listeners: cualquier cambio (gestión, consulta de Jefatura, nueva ronda/novedad)
 * se refleja de inmediato sin recargar.
 */
export function subscribeAlertasOperacionales(params: SubscribeAlertasParams): () => void {
  const { modo, assignedSites = [], siteNameLookup, onData, onError, maxPerQuery = 150 } = params;

  const rondasBySource = new Map<string, Map<string, GuardRound>>();
  const novedadesBySource = new Map<string, Map<string, any>>();
  const unsubs: Array<() => void> = [];
  let disposed = false;

  const emit = () => {
    if (disposed) return;
    const rondas = new Map<string, GuardRound>();
    rondasBySource.forEach((m) => m.forEach((v, k) => rondas.set(k, v)));
    const novedades = new Map<string, any>();
    novedadesBySource.forEach((m) => m.forEach((v, k) => novedades.set(k, v)));

    const items: AlertaOperacionalItem[] = [];
    rondas.forEach((round) => {
      if (modo === 'supervisor' && !isSiteAllowedForSupervisor(round.siteId, assignedSites)) return;
      const mapped = mapRoundToAlertaItem(round, siteNameLookup);
      if (mapped) items.push(mapped);
    });
    novedades.forEach((nov) => {
      const novSite = nov.sucursalId ?? nov.siteId;
      if (modo === 'supervisor' && !isSiteAllowedForSupervisor(novSite, assignedSites)) return;
      const mapped = mapNovedadToAlertaItem(nov, siteNameLookup);
      if (mapped) items.push(mapped);
    });
    onData(items.sort((a, b) => b.timestampMs - a.timestampMs));
  };

  const listenRondas = (key: string, q: any) => {
    unsubs.push(
      onSnapshot(
        q,
        (snap: any) => {
          const m = new Map<string, GuardRound>();
          snap.docs.forEach((d: any) => {
            const data = d.data(LIVE_OPTS) as Omit<GuardRound, 'id'>;
            if (data.result === 'CON_NOVEDAD' || data.result === 'SOSPECHA') {
              m.set(d.id, { id: d.id, ...data });
            }
          });
          rondasBySource.set(key, m);
          emit();
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
            if (prio === 'critica' || prio === 'alta') m.set(d.id, { id: d.id, ...data });
          });
          novedadesBySource.set(key, m);
          emit();
        },
        (err: unknown) => onError?.(err),
      ),
    );
  };

  if (modo === 'admin') {
    listenRondas(
      'admin',
      query(collection(db, RONDAS_COL), where('result', 'in', ['CON_NOVEDAD', 'SOSPECHA']), limit(maxPerQuery)),
    );
    listenNovedades(
      'admin',
      query(collection(db, NOVEDADES_COL), where('prioridad', 'in', ['critica', 'alta']), limit(maxPerQuery)),
    );
  } else {
    const chunks = chunkArray(buildSiteIdVariants(assignedSites), 30);
    if (chunks.length === 0) {
      onData([]);
    }
    chunks.forEach((chunk, i) => {
      listenRondas(`r${i}`, query(collection(db, RONDAS_COL), where('siteId', 'in', chunk), limit(maxPerQuery)));
      listenNovedades(`ns${i}`, query(collection(db, NOVEDADES_COL), where('sucursalId', 'in', chunk), limit(maxPerQuery)));
      listenNovedades(`nx${i}`, query(collection(db, NOVEDADES_COL), where('siteId', 'in', chunk), limit(maxPerQuery)));
    });
  }

  return () => {
    disposed = true;
    unsubs.forEach((u) => u());
  };
}
