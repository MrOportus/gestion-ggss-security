/**
 * seguimientoService.ts
 *
 * Servicio de seguimiento de novedades por sucursal.
 *
 * OPERA ÚNICAMENTE sobre el esquema nuevo RegistroNovedad
 * (documentos con campo `tipoRegistro`).
 *
 * NO modifica ni lee documentos del esquema legacy Novedad.
 * NO crea colecciones globales de seguimiento.
 *
 * Estructura Firestore:
 *   novedades/{novedadId}/seguimientos/{seguimientoId}
 *
 * El documento padre (novedades/{novedadId}) se actualiza
 * atómicamente en la misma operación batch para mantener
 * consistencia entre hilo y metadatos.
 */

import { db } from '../firebase';
import {
  collection,
  doc,
  writeBatch,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  increment,
  Timestamp,
} from 'firebase/firestore';
import type { SeguimientoNovedad, SeguimientoTipo } from '../../types';

// ─── Constantes ───────────────────────────────────────────────────────────────

const NOVEDADES_COL = 'novedades';
const SEGUIMIENTOS_SUBCOL = 'seguimientos';

/** Máxima longitud del snippet de preview almacenado en el doc padre */
const SNIPPET_MAX_LEN = 120;

// ─── Tipos del servicio ───────────────────────────────────────────────────────

/** Parámetros comunes para cualquier tipo de seguimiento */
export interface SeguimientoBaseParams {
  novedadId: string;
  usuarioId: string;
  usuarioNombre: string;
  rol: string;
  mensaje: string;
  fotoUrl?: string;
  fotoPath?: string;
}

/** Resultado devuelto al crear un seguimiento */
export interface SeguimientoResult {
  seguimientoId: string;
  novedadId: string;
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

/** Genera un ID estable para documentos de seguimiento */
function generarSeguimientoId(): string {
  return `seg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

/** Recorta el mensaje para usarlo como snippet de preview en el doc padre */
function toSnippet(mensaje: string): string {
  const m = mensaje.trim();
  return m.length <= SNIPPET_MAX_LEN ? m : `${m.substring(0, SNIPPET_MAX_LEN - 1)}\u2026`;
}

// ─── addSeguimiento ───────────────────────────────────────────────────────────

/**
 * Agrega un mensaje al hilo de seguimiento de una novedad.
 *
 * `tipo` determina el rol del mensaje:
 *   - 'inicio'      → abre el hilo (admin/supervisor crea el primer mensaje)
 *   - 'seguimiento' → actualización intermedia del hilo
 *   - 'resolucion'  → cierre explícito (marca la novedad como 'resuelta')
 *
 * La resolución es una acción deliberada del llamador:
 * NO se marca 'resuelta' simplemente por agregar un mensaje.
 *
 * Usa WriteBatch atómico:
 *   1. set  → crea el documento en novedades/{id}/seguimientos/{segId}
 *   2. update → actualiza metadatos en novedades/{id}
 *
 * El campo `cantidadSeguimientos` usa increment(1) para
 * consistencia sin depender de conteos locales.
 */
export async function addSeguimiento(
  params: SeguimientoBaseParams,
  tipo: SeguimientoTipo,
): Promise<SeguimientoResult> {
  const { novedadId, usuarioId, usuarioNombre, rol, mensaje, fotoUrl, fotoPath } = params;

  const seguimientoId = generarSeguimientoId();
  const ahoraISO = new Date().toISOString();
  const snippet = toSnippet(mensaje);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const novedadRef = doc(db, NOVEDADES_COL, novedadId);
  const seguimientoRef = doc(
    collection(db, NOVEDADES_COL, novedadId, SEGUIMIENTOS_SUBCOL),
    seguimientoId,
  );

  // ── Documento del seguimiento ─────────────────────────────────────────────
  const seguimientoDoc: Record<string, unknown> = {
    id: seguimientoId,
    novedadId,
    usuarioId,
    usuarioNombre,
    rol,
    mensaje,
    tipo,
    fecha: serverTimestamp(),   // Timestamp Firestore — fuente de verdad
    fechaStr: ahoraISO,         // ISO auxiliar para auditoría offline
  };
  if (fotoUrl) seguimientoDoc.fotoUrl = fotoUrl;
  if (fotoPath) seguimientoDoc.fotoPath = fotoPath;

  // ── Metadatos base (siempre se actualizan en el doc padre) ────────────────
  const metadatosBase: Record<string, unknown> = {
    ultimoSeguimientoEn: serverTimestamp(),
    ultimoSeguimientoMsg: snippet,
    ultimoSeguimientoPor: usuarioNombre,
    cantidadSeguimientos: increment(1),
    actualizadoEn: serverTimestamp(),
  };

  // ── Metadatos de estado según tipo ────────────────────────────────────────
  let metadatosEstado: Record<string, unknown>;

  if (tipo === 'resolucion') {
    // Cierre explícito — acción deliberada del llamador
    metadatosEstado = {
      estado: 'resuelta',
      requiereSeguimiento: false,
      fechaResolucion: ahoraISO,
      resueltoPorNombre: usuarioNombre,
      notaResolucion: snippet,
    };
  } else {
    // 'inicio' o 'seguimiento' → hilo activo sin cierre
    metadatosEstado = {
      estado: 'en_revision',
      requiereSeguimiento: true,
    };
  }

  // ── Batch atómico (subcol + doc padre en una sola operación) ─────────────
  const batch = writeBatch(db);
  batch.set(seguimientoRef, seguimientoDoc);
  batch.update(novedadRef, { ...metadatosBase, ...metadatosEstado });
  await batch.commit();

  return { seguimientoId, novedadId };
}

// ─── getSeguimientos ──────────────────────────────────────────────────────────

/**
 * Obtiene todos los seguimientos de una novedad en orden cronológico.
 *
 * El historial es append-only y de solo lectura desde este servicio.
 * Devuelve [] si la novedad todavía no tiene seguimientos.
 */
export async function getSeguimientos(novedadId: string): Promise<SeguimientoNovedad[]> {
  const q = query(
    collection(db, NOVEDADES_COL, novedadId, SEGUIMIENTOS_SUBCOL),
    orderBy('fecha', 'asc'),
  );

  const snap = await getDocs(q);

  return snap.docs.map((d) => {
    const data = d.data();
    const seg: SeguimientoNovedad = {
      id: d.id,
      novedadId: data.novedadId ?? novedadId,
      usuarioId: data.usuarioId,
      usuarioNombre: data.usuarioNombre,
      rol: data.rol,
      mensaje: data.mensaje,
      tipo: data.tipo as SeguimientoTipo,
      fecha: data.fecha,
      fechaStr: data.fechaStr ?? '',
    };
    if (data.fotoUrl) seg.fotoUrl = data.fotoUrl;
    if (data.fotoPath) seg.fotoPath = data.fotoPath;
    return seg;
  });
}

// ─── Helpers de formato (reutilizables en componentes) ───────────────────────

/**
 * Formatea un Timestamp de Firestore o un ISO string a hora local (es-CL).
 * Devuelve '--' si el valor es nulo o inválido.
 */
export function formatSeguimientoFecha(
  fecha: Timestamp | string | null | undefined,
): string {
  if (!fecha) return '--';
  try {
    const date = fecha instanceof Timestamp ? fecha.toDate() : new Date(fecha as string);
    return date.toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '--';
  }
}

/**
 * Devuelve true si un documento de novedad pertenece al esquema nuevo
 * (tiene campo `tipoRegistro`).
 *
 * Guard de seguridad para que el servicio NO opere accidentalmente
 * sobre documentos del esquema legacy.
 */
export function esEsquemaNuevo(novedad: Record<string, unknown>): boolean {
  return typeof novedad.tipoRegistro === 'string';
}
