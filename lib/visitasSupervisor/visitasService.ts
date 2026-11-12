/**
 * Servicio del módulo "Visitas de Supervisor".
 *
 * Reutiliza (sin duplicar):
 *  - SyncQueueService  → cola offline-first existente (localforage) con operationId idempotente.
 *  - useAppStore.processSyncQueue / uploadBase64 → procesamiento y subida de fotos existentes.
 *  - compressImage     → compresión de fotos existente (lib/imageUtils).
 *  - Capacitor Geolocation → misma fuente de GPS que usa WorkerAttendance.
 *
 * Garantías de no-duplicación:
 *  - El ID del documento Firestore = visitId (se genera una sola vez al iniciar).
 *  - Cada item de cola usa operationId determinista (`visita_<id>`, `visitafoto_<fotoId>`),
 *    y encolar es idempotente: si ya existe un item con ese operationId, no se vuelve a crear.
 *  - Las fotos se guardan en un mapa `fotos.<fotoId>` (clave = id) → reintentos sobrescriben, no duplican.
 */
import localforage from 'localforage';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { SyncQueueService, QueueItem } from '../SyncQueueService';
import { compressImage, blobToDataUrl, dataUrlToBlob } from '../imageUtils';
import { construirDocumentoVisita, fechaLocalISO } from './visitasLogic';
import {
  AmbitoFoto,
  FotoVisitaLocal,
  UbicacionVisita,
  VisitaDraft,
  VisitaSupervisorDoc,
} from './visitasTypes';

export const VISITAS_COLLECTION = 'visitasSupervisor';
export const ACTION_ADD_VISITA = 'ADD_VISITA_SUPERVISOR' as const;
export const ACTION_UPLOAD_FOTO_VISITA = 'UPLOAD_VISITA_PHOTO' as const;

// ─── Borrador local (sobrevive a cierre de la app) ───────────────────────────
// DB propia: evita conflictos de versión con la DB offline existente (GGSS_Offline_DB).
const draftStore = localforage.createInstance({ name: 'GGSS_Visitas_DB', storeName: 'visit_drafts' });
const draftKey = (uid: string) => `draft_${uid}`;

export const VisitasDraftService = {
  async load(uid: string): Promise<VisitaDraft | null> {
    try {
      return (await draftStore.getItem<VisitaDraft>(draftKey(uid))) ?? null;
    } catch {
      return null;
    }
  },
  async save(draft: VisitaDraft): Promise<void> {
    try {
      await draftStore.setItem(draftKey(draft.supervisorUid), draft);
    } catch (e) {
      console.warn('[Visitas] No se pudo guardar el borrador local:', e);
    }
  },
  async clear(uid: string): Promise<void> {
    try {
      await draftStore.removeItem(draftKey(uid));
    } catch { /* noop */ }
  },
};

// ─── Ubicación ───────────────────────────────────────────────────────────────

/** Nunca lanza: devuelve `no_disponible` con motivo para no bloquear la visita. */
export async function obtenerUbicacionVisita(timeoutMs = 12000): Promise<UbicacionVisita> {
  const fallo = (motivo: UbicacionVisita['motivo']): UbicacionVisita => ({ estado: 'no_disponible', motivo });
  const conTimeout = <T,>(p: Promise<T>) =>
    Promise.race<T>([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs + 2000))]);

  try {
    if (Capacitor.isNativePlatform()) {
      let perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted') perm = await Geolocation.requestPermissions();
      if (perm.location !== 'granted') return fallo('permiso_denegado');

      const pos = await conTimeout(
        Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 })
      );
      return {
        estado: 'verificada',
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        capturadaEn: new Date().toISOString(),
      };
    }

    if (!navigator.geolocation) return fallo('no_disponible');
    return await new Promise<UbicacionVisita>(resolve => {
      navigator.geolocation.getCurrentPosition(
        pos =>
          resolve({
            estado: 'verificada',
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            capturadaEn: new Date().toISOString(),
          }),
        err => resolve(fallo(err.code === 1 ? 'permiso_denegado' : err.code === 3 ? 'timeout' : 'no_disponible')),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
      );
    });
  } catch (err: any) {
    const msg = String(err?.message || err).toLowerCase();
    if (msg.includes('denied') || msg.includes('permission')) return fallo('permiso_denegado');
    if (msg.includes('timeout')) return fallo('timeout');
    return fallo('no_disponible');
  }
}

// ─── Fotos ───────────────────────────────────────────────────────────────────

/** Envuelve un Blob ya comprimido (Camera/Gallery) en el modelo local del borrador. */
export async function crearFotoVisitaDesdeBlob(
  compressedBlob: Blob,
  visitId: string,
  ambito: AmbitoFoto
): Promise<FotoVisitaLocal> {
  const id = `${visitId}_f${Date.now()}${Math.random().toString(36).substring(2, 5)}`;
  const capturadoEn = new Date().toISOString();
  if (SyncQueueService.supportsBlobPayloads()) {
    return {
      id,
      blob: compressedBlob,
      ambito,
      capturadoEn,
    };
  }
  return {
    id,
    dataUrl: await blobToDataUrl(compressedBlob),
    ambito,
    capturadoEn,
  };
}

/** Comprime obligatoriamente (sin fallback sin comprimir) y devuelve la foto lista para el borrador. */
export async function procesarFotoVisita(file: File, visitId: string, ambito: AmbitoFoto): Promise<FotoVisitaLocal> {
  const compressedBlob = await compressImage(file, 0.6, 1024);
  return crearFotoVisitaDesdeBlob(compressedBlob, visitId, ambito);
}

// ─── Envío offline-first ─────────────────────────────────────────────────────

async function operationIdsEnCola(): Promise<Set<string>> {
  const all = await SyncQueueService.getAllItems();
  return new Set(all.map(i => i.operationId));
}

/**
 * Guarda la visita localmente (cola persistente) — NO requiere internet.
 * Idempotente: se puede llamar varias veces con el mismo borrador sin duplicar.
 */
export async function encolarVisita(draft: VisitaDraft, supervisorNombre: string): Promise<VisitaSupervisorDoc> {
  const data = construirDocumentoVisita(draft, supervisorNombre);
  const existentes = await operationIdsEnCola();

  const opVisita = `visita_${draft.visitId}`;
  if (!existentes.has(opVisita)) {
    await SyncQueueService.enqueue(
      ACTION_ADD_VISITA as any,
      { visitId: draft.visitId, data },
      draft.supervisorUid,
      opVisita
    );
  }

  // Fotos DESPUÉS del documento (la cola se procesa en orden cronológico)
  const useBlobPayload = SyncQueueService.supportsBlobPayloads();
  for (let i = 0; i < draft.fotos.length; i++) {
    const f = draft.fotos[i];
    const opFoto = `visitafoto_${f.id}`;
    if (existentes.has(opFoto)) continue;
    const basePayload = {
      visitId: draft.visitId,
      fotoId: f.id,
      ambito: f.ambito,
      orden: i,
      capturadoEn: f.capturadoEn,
    };
    let mediaPayload: Record<string, any>;
    if (f.blob instanceof Blob) {
      mediaPayload = useBlobPayload
        ? { photoBlob: f.blob }
        : { photoBase64: await blobToDataUrl(f.blob) };
    } else if (f.dataUrl) {
      mediaPayload = useBlobPayload
        ? { photoBlob: await dataUrlToBlob(f.dataUrl) }
        : { photoBase64: f.dataUrl };
    } else {
      console.warn(`[Visitas] Foto ${f.id} sin datos binarios ni dataUrl. Omitiendo.`);
      continue;
    }
    await SyncQueueService.enqueue(
      ACTION_UPLOAD_FOTO_VISITA as any,
      { ...basePayload, ...mediaPayload },
      draft.supervisorUid,
      opFoto
    );
  }
  return data;
}

/** Items de cola (visita + fotos) que aún no se sincronizan para una visita */
export async function itemsPendientesDeVisita(visitId: string): Promise<QueueItem[]> {
  const all = await SyncQueueService.getAllItems();
  return all.filter(i => i.payload?.visitId === visitId);
}

/** Espera (sin bloquear la UI) hasta que la visita quede sincronizada o venza el tiempo. */
export async function esperarSincronizacionVisita(visitId: string, maxMs = 25000): Promise<boolean> {
  const fin = Date.now() + maxMs;
  while (Date.now() < fin) {
    if ((await itemsPendientesDeVisita(visitId)).length === 0) return true;
    await new Promise(r => setTimeout(r, 1500));
  }
  return (await itemsPendientesDeVisita(visitId)).length === 0;
}

export interface VisitaPendienteLocal {
  visitId: string;
  data: VisitaSupervisorDoc;
  fotosPendientes: number;
}

/** Visitas guardadas en este teléfono que aún no llegan a la nube */
export async function listarVisitasPendientesLocales(uid: string): Promise<VisitaPendienteLocal[]> {
  const all = await SyncQueueService.getAllItems();
  const mias = all.filter(i => i.userId === uid);
  return mias
    .filter(i => i.actionType === (ACTION_ADD_VISITA as any))
    .map(i => ({
      visitId: i.payload.visitId as string,
      data: i.payload.data as VisitaSupervisorDoc,
      fotosPendientes: mias.filter(
        f => f.actionType === (ACTION_UPLOAD_FOTO_VISITA as any) && f.payload?.visitId === i.payload.visitId
      ).length,
    }))
    .sort((a, b) => (b.data.inicioEn || '').localeCompare(a.data.inicioEn || ''));
}

// ─── Handlers que usa processSyncQueue (store) ────────────────────────────────

export async function sincronizarDocumentoVisita(item: QueueItem): Promise<void> {
  const { visitId, data } = item.payload as { visitId: string; data: VisitaSupervisorDoc };
  const ref = doc(db, VISITAS_COLLECTION, visitId);
  // Si ya existe (reintento tras éxito parcial) NO se reescribe: protege las fotos ya subidas.
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { ...data, sincronizadoEn: serverTimestamp() });
  }
}

/** Devuelve true si la foto se procesó (o se descartó por corrupta) y el item puede marcarse completado. */
export async function sincronizarFotoVisita(
  item: QueueItem,
  uploadBase64: (data: string | Blob, path: string) => Promise<string>,
  fallbackUid: string
): Promise<void> {
  const { visitId, fotoId, photoBase64, photoBlob, ambito, orden, capturadoEn } = item.payload;
  const mediaData: string | Blob | null =
    photoBlob instanceof Blob && photoBlob.size >= 50
      ? photoBlob
      : typeof photoBase64 === 'string' && photoBase64.length >= 100
        ? photoBase64
        : null;
  if (!mediaData) {
    console.error(`[Visitas] Foto ${fotoId} corrupta. Descartando.`);
    return;
  }
  const owner = item.userId || fallbackUid;
  const ext =
    mediaData instanceof Blob
      ? (mediaData.type.includes('webp') ? 'webp' : 'jpg')
      : (mediaData.startsWith('data:image/webp') ? 'webp' : 'jpg');
  // Ruta bajo evidencias/{uid}/ → ya permitida por storage.rules (no requiere cambios)
  const path = `evidencias/${owner}/visitas/${visitId}/${fotoId}.${ext}`;
  const url = await uploadBase64(mediaData, path);
  await updateDoc(doc(db, VISITAS_COLLECTION, visitId), {
    [`fotos.${fotoId}`]: { url, ambito, orden, capturadoEn },
  });
}

// ─── Consultas ───────────────────────────────────────────────────────────────

function mapDocs(snap: Awaited<ReturnType<typeof getDocs>>): VisitaSupervisorDoc[] {
  return snap.docs.map(d => ({ ...(d.data() as VisitaSupervisorDoc), id: d.id }));
}

/** Admin: visitas desde una fecha (YYYY-MM-DD). Rango simple sobre un solo campo → sin índice compuesto. */
export async function fetchVisitasAdmin(desde: string, maxDocs = 1000): Promise<VisitaSupervisorDoc[]> {
  const q = query(
    collection(db, VISITAS_COLLECTION),
    where('fechaOperacional', '>=', desde),
    orderBy('fechaOperacional', 'desc'),
    limit(maxDocs)
  );
  const visitas = mapDocs(await getDocs(q));
  return visitas.sort((a, b) => b.inicioEn.localeCompare(a.inicioEn));
}

export function subscribeVisitasAdmin(desde: string, onUpdate: (visitas: VisitaSupervisorDoc[]) => void, maxDocs = 1000): () => void {
  const q = query(
    collection(db, VISITAS_COLLECTION),
    where('fechaOperacional', '>=', desde),
    orderBy('fechaOperacional', 'desc'),
    limit(maxDocs)
  );
  return onSnapshot(q, (snap) => {
    const visitas = mapDocs(snap);
    onUpdate(visitas.sort((a, b) => b.inicioEn.localeCompare(a.inicioEn)));
  });
}

/** Supervisor: solo sus visitas (igualdad simple → sin índice compuesto; se ordena en cliente). */
export async function fetchVisitasSupervisor(uid: string, maxDocs = 60): Promise<VisitaSupervisorDoc[]> {
  const q = query(collection(db, VISITAS_COLLECTION), where('supervisorUid', '==', uid), limit(300));
  const visitas = mapDocs(await getDocs(q));
  return visitas.sort((a, b) => b.inicioEn.localeCompare(a.inicioEn)).slice(0, maxDocs);
}

/** Supervisor: suscripción en tiempo real a sus visitas (contadores de mensajes no leídos instantáneos). */
export function subscribeVisitasSupervisor(
  uid: string,
  onUpdate: (visitas: VisitaSupervisorDoc[]) => void,
  maxDocs = 60,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, VISITAS_COLLECTION), where('supervisorUid', '==', uid), limit(300));
  return onSnapshot(
    q,
    (snap) => {
      const visitas = mapDocs(snap);
      onUpdate(visitas.sort((a, b) => b.inicioEn.localeCompare(a.inicioEn)).slice(0, maxDocs));
    },
    (err) => {
      console.error('[Visitas] Error en suscripción del supervisor:', err);
      if (onError) onError(err);
    }
  );
}

/** Total histórico de reportes (consulta de conteo, no descarga documentos). */
export async function contarReportesTotales(): Promise<number | null> {
  try {
    const snap = await getCountFromServer(collection(db, VISITAS_COLLECTION));
    return snap.data().count;
  } catch {
    return null;
  }
}

/** Primer día del mes anterior (ventana por defecto del panel admin) */
export function ventanaPorDefectoAdmin(hoy: Date = new Date()): string {
  return fechaLocalISO(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1));
}
