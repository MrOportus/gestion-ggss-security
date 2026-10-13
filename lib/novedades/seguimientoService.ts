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
  onSnapshot,
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

  const isAdmin = ['admin', 'supervisor', 'jefe_operaciones', 'rrhh'].includes(rol);

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
    // Si lo envía admin/supervisor/jefe, nace no visto por el guardia
    ...(isAdmin ? {
      leidoPorGuardia: false,
      leidoEn: null,
    } : {
      // Si lo envía el guardia, nace conocido por el guardia
      leidoPorGuardia: true,
      leidoEn: serverTimestamp(),
      leidoPorNombre: usuarioNombre,
      leidoPorUid: usuarioId,
    }),
  };
  if (fotoUrl) seguimientoDoc.fotoUrl = fotoUrl;
  if (fotoPath) seguimientoDoc.fotoPath = fotoPath;

  // ── Metadatos base (siempre se actualizan en el doc padre) ────────────────
  const metadatosBase: Record<string, unknown> = {
    ultimoSeguimientoEn: serverTimestamp(),
    ultimoSeguimientoMsg: snippet,
    ultimoSeguimientoPor: usuarioNombre,
    ultimoSeguimientoRol: rol,
    cantidadSeguimientos: increment(1),
    actualizadoEn: serverTimestamp(),
  };

  // Contadores de lectura
  if (isAdmin) {
    metadatosBase.unreadWorkerCount = increment(1);
    metadatosBase.readByAdminEn = serverTimestamp();
    metadatosBase.readByAdminPor = usuarioNombre;
    metadatosBase.unreadAdminCount = 0; // Se asume leído por admin al escribir
  } else {
    metadatosBase.unreadAdminCount = increment(1);
    metadatosBase.unreadWorkerCount = 0; // Se asume leído por worker al escribir
    metadatosBase.readByWorkerEn = serverTimestamp();
    metadatosBase.readByWorkerPor = usuarioNombre;
  }

  // ── Metadatos de estado según tipo ────────────────────────────────────────
  let metadatosEstado: Record<string, unknown>;

  if (tipo === 'resolucion') {
    metadatosEstado = {
      estado: 'resuelta',
      requiereSeguimiento: false,
      fechaResolucion: ahoraISO,
      resueltoPorNombre: usuarioNombre,
      notaResolucion: snippet,
    };
  } else {
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

// ─── Helpers de parseo ────────────────────────────────────────────────────────

function parseSeguimientoDoc(d: any, novedadIdFallback: string): SeguimientoNovedad {
  const data = d.data();
  const seg: SeguimientoNovedad = {
    id: d.id,
    novedadId: data.novedadId ?? novedadIdFallback,
    usuarioId: data.usuarioId,
    usuarioNombre: data.usuarioNombre,
    rol: data.rol,
    mensaje: data.mensaje,
    tipo: data.tipo as SeguimientoTipo,
    fecha: data.fecha,
    fechaStr: data.fechaStr ?? '',
    fotoUrl: data.fotoUrl,
    fotoPath: data.fotoPath,
    leidoPorGuardia: Boolean(data.leidoPorGuardia),
    leidoEn: data.leidoEn?.toDate ? data.leidoEn.toDate().toISOString() : data.leidoEn || null,
    leidoPorNombre: data.leidoPorNombre,
    leidoPorUid: data.leidoPorUid,
  };
  return seg;
}

// ─── getSeguimientos ──────────────────────────────────────────────────────────

export async function getSeguimientos(novedadId: string): Promise<SeguimientoNovedad[]> {
  const q = query(
    collection(db, NOVEDADES_COL, novedadId, SEGUIMIENTOS_SUBCOL),
    orderBy('fecha', 'asc'),
  );

  const snap = await getDocs(q);
  return snap.docs.map((d) => parseSeguimientoDoc(d, novedadId));
}

// ─── subscribeSeguimientos (Tiempo real) ──────────────────────────────────────

export function subscribeSeguimientos(
  novedadId: string,
  onUpdate: (seguimientos: SeguimientoNovedad[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(
    collection(db, NOVEDADES_COL, novedadId, SEGUIMIENTOS_SUBCOL),
    orderBy('fecha', 'asc'),
  );

  return onSnapshot(
    q,
    (snap) => {
      const msgs = snap.docs.map((d) => parseSeguimientoDoc(d, novedadId));
      onUpdate(msgs);
    },
    (err) => {
      console.error('[NovedadesSeguimiento] Error en suscripción a seguimientos:', err);
      if (onError) onError(err);
    }
  );
}

// ─── marcarSeguimientosLeidosPorGuardia ───────────────────────────────────────

/**
 * Marca como leídos por el guardia los mensajes que fueron enviados por administración/supervisión
 */
export async function marcarSeguimientosLeidosPorGuardia(
  novedadId: string,
  guardiaUid: string,
  guardiaNombre: string
): Promise<void> {
  try {
    const seguimientosRef = collection(db, NOVEDADES_COL, novedadId, SEGUIMIENTOS_SUBCOL);
    const snap = await getDocs(seguimientosRef);

    const batch = writeBatch(db);
    let cambios = 0;

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      // Si el autor NO es este guardia y aún no figura como leído por el guardia
      if (data.usuarioId !== guardiaUid && !data.leidoPorGuardia) {
        batch.update(docSnap.ref, {
          leidoPorGuardia: true,
          leidoEn: serverTimestamp(),
          leidoPorNombre: guardiaNombre,
          leidoPorUid: guardiaUid,
        });
        cambios++;
      }
    });

    const novedadRef = doc(db, NOVEDADES_COL, novedadId);
    batch.update(novedadRef, {
      unreadWorkerCount: 0,
      readByWorkerEn: serverTimestamp(),
      readByWorkerPor: guardiaNombre,
    });

    await batch.commit();
    if (cambios > 0) {
      console.log(`[NovedadesSeguimiento] ${cambios} mensaje(s) marcados como leídos por guardia ${guardiaNombre}`);
    }
  } catch (err) {
    console.error('[NovedadesSeguimiento] Error marcando mensajes como leídos por guardia:', err);
  }
}

// ─── Helpers de formato (reutilizables en componentes) ───────────────────────

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

export function esEsquemaNuevo(novedad: Record<string, unknown>): boolean {
  return typeof novedad.tipoRegistro === 'string';
}

// ─── markSeguimientoAsRead ───────────────────────────────────────────────────

export async function markSeguimientoAsRead(
  novedadId: string,
  rol: string,
  usuarioNombre: string,
  usuarioUid?: string
): Promise<void> {
  const novedadRef = doc(db, NOVEDADES_COL, novedadId);
  const isAdmin = ['admin', 'supervisor', 'jefe_operaciones', 'rrhh'].includes(rol);

  try {
    if (isAdmin) {
      const batch = writeBatch(db);
      batch.update(novedadRef, {
        unreadAdminCount: 0,
        readByAdminEn: serverTimestamp(),
        readByAdminPor: usuarioNombre,
      });
      await batch.commit();
    } else {
      if (usuarioUid) {
        await marcarSeguimientosLeidosPorGuardia(novedadId, usuarioUid, usuarioNombre);
      } else {
        const batch = writeBatch(db);
        batch.update(novedadRef, {
          unreadWorkerCount: 0,
          readByWorkerEn: serverTimestamp(),
          readByWorkerPor: usuarioNombre,
        });
        await batch.commit();
      }
    }
  } catch (err) {
    console.error('[NovedadesSeguimiento] Error marcando como leído:', err);
  }
}

