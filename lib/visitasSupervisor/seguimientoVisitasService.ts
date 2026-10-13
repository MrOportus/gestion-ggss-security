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
  onSnapshot,
} from 'firebase/firestore';
import type { SeguimientoVisita } from './visitasTypes';

export const VISITAS_COL = 'visitasSupervisor';
const SEGUIMIENTOS_SUBCOL = 'seguimientos';
const SNIPPET_MAX_LEN = 120;

export interface SeguimientoBaseParams {
  visitaId: string;
  usuarioId: string;
  usuarioNombre: string;
  rol: string;
  mensaje: string;
  fotoUrl?: string;
  fotoPath?: string;
}

export interface SeguimientoResult {
  seguimientoId: string;
  visitaId: string;
}

export async function addSeguimiento(params: SeguimientoBaseParams): Promise<SeguimientoResult> {
  const { visitaId, usuarioId, usuarioNombre, rol, mensaje, fotoUrl, fotoPath } = params;
  if (!mensaje.trim() && !fotoUrl) {
    throw new Error('El seguimiento debe tener un mensaje o una fotografía.');
  }

  const batch = writeBatch(db);
  const visitaRef = doc(db, VISITAS_COL, visitaId);
  const seguimientosRef = collection(visitaRef, SEGUIMIENTOS_SUBCOL);
  const nuevoSeguimientoRef = doc(seguimientosRef);

  const isAdminOrSuper = ['admin', 'jefe_operaciones', 'rrhh'].includes(rol);

  const seguimientoDoc: any = {
    id: nuevoSeguimientoRef.id,
    autorUid: usuarioId,
    autorNombre: usuarioNombre,
    autorRol: rol,
    fechaHora: serverTimestamp(),
    mensaje: mensaje.trim(),
    ...(fotoUrl ? { fotoUrl } : {}),
    ...(fotoPath ? { fotoPath } : {}),
    tipo: 'comentario',
    // Si lo envía admin/jefe/rrhh, nace no visto por el supervisor
    ...(isAdminOrSuper ? {
      leidoPorSupervisor: false,
      leidoEn: null,
    } : {
      // Si lo envía el propio supervisor
      leidoPorSupervisor: true,
      leidoEn: serverTimestamp(),
      leidoPorNombre: usuarioNombre,
      leidoPorUid: usuarioId,
    }),
  };

  batch.set(nuevoSeguimientoRef, seguimientoDoc);

  const snippet = mensaje.trim().substring(0, SNIPPET_MAX_LEN) + (mensaje.trim().length > SNIPPET_MAX_LEN ? '...' : '');

  const updatePayload: any = {
    estado: 'en_revision',
    requiereSeguimiento: true,
    ultimoSeguimientoEn: serverTimestamp(),
    ultimoSeguimientoMsg: fotoUrl && !mensaje.trim() ? '📷 [Fotografía adjunta]' : snippet,
    ultimoSeguimientoAutor: isAdminOrSuper ? 'Admin' : usuarioNombre,
  };

  if (isAdminOrSuper) {
    updatePayload.noLeidosSupervisor = increment(1);
  } else {
    updatePayload.noLeidosAdmin = increment(1);
  }

  batch.update(visitaRef, updatePayload);
  await batch.commit();

  return { seguimientoId: nuevoSeguimientoRef.id, visitaId };
}

export async function resolverVisita(visitaId: string, autorUid: string, autorNombre: string, autorRol: string): Promise<void> {
  const batch = writeBatch(db);
  const visitaRef = doc(db, VISITAS_COL, visitaId);
  const seguimientosRef = collection(visitaRef, SEGUIMIENTOS_SUBCOL);
  const nuevoSeguimientoRef = doc(seguimientosRef);

  const isAdminOrSuper = ['admin', 'jefe_operaciones', 'rrhh'].includes(autorRol);

  const seguimientoDoc: any = {
    id: nuevoSeguimientoRef.id,
    autorUid,
    autorNombre,
    autorRol,
    fechaHora: serverTimestamp(),
    mensaje: 'Visita resuelta',
    tipo: 'resolucion',
    leidoPorSupervisor: !isAdminOrSuper,
    leidoEn: isAdminOrSuper ? null : serverTimestamp(),
  };

  batch.set(nuevoSeguimientoRef, seguimientoDoc);
  batch.update(visitaRef, {
    estado: 'resuelta',
    requiereSeguimiento: false,
    ultimoSeguimientoEn: serverTimestamp(),
    ultimoSeguimientoMsg: 'Visita marcada como resuelta.',
    ultimoSeguimientoAutor: isAdminOrSuper ? 'Admin' : autorNombre,
  });

  await batch.commit();
}

function parseSeguimientoDoc(docSnap: any): SeguimientoVisita {
  const data = docSnap.data();
  return {
    ...data,
    id: docSnap.id,
    autorUid: data.autorUid || '',
    autorNombre: data.autorNombre || '',
    autorRol: data.autorRol || '',
    mensaje: data.mensaje || '',
    tipo: data.tipo || 'comentario',
    fechaHora: data.fechaHora?.toDate ? data.fechaHora.toDate().toISOString() : data.fechaHora || new Date().toISOString(),
    fotoUrl: data.fotoUrl,
    fotoPath: data.fotoPath,
    leidoPorSupervisor: Boolean(data.leidoPorSupervisor),
    leidoEn: data.leidoEn?.toDate ? data.leidoEn.toDate().toISOString() : data.leidoEn || null,
    leidoPorNombre: data.leidoPorNombre,
    leidoPorUid: data.leidoPorUid,
  } as SeguimientoVisita;
}

export async function getSeguimientos(visitaId: string): Promise<SeguimientoVisita[]> {
  const seguimientosRef = collection(db, VISITAS_COL, visitaId, SEGUIMIENTOS_SUBCOL);
  const q = query(seguimientosRef, orderBy('fechaHora', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(parseSeguimientoDoc);
}

export function subscribeSeguimientos(
  visitaId: string,
  onUpdate: (seguimientos: SeguimientoVisita[]) => void,
  onError?: (err: Error) => void
): () => void {
  const seguimientosRef = collection(db, VISITAS_COL, visitaId, SEGUIMIENTOS_SUBCOL);
  const q = query(seguimientosRef, orderBy('fechaHora', 'asc'));

  return onSnapshot(
    q,
    (snap) => {
      const msgs = snap.docs.map(parseSeguimientoDoc);
      onUpdate(msgs);
    },
    (err) => {
      console.error('[VisitasSeguimiento] Error en suscripción a seguimientos:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Marca como leídos por el supervisor los mensajes que fueron enviados por administración
 */
export async function marcarSeguimientosLeidosPorSupervisor(
  visitaId: string,
  supervisorUid: string,
  supervisorNombre: string
): Promise<void> {
  try {
    const seguimientosRef = collection(db, VISITAS_COL, visitaId, SEGUIMIENTOS_SUBCOL);
    const snap = await getDocs(seguimientosRef);

    const batch = writeBatch(db);
    let cambios = 0;

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      // Si el autor NO es este supervisor y aún no figura como leído por el supervisor
      if (data.autorUid !== supervisorUid && !data.leidoPorSupervisor) {
        batch.update(docSnap.ref, {
          leidoPorSupervisor: true,
          leidoEn: serverTimestamp(),
          leidoPorNombre: supervisorNombre,
          leidoPorUid: supervisorUid,
        });
        cambios++;
      }
    });

    const visitaRef = doc(db, VISITAS_COL, visitaId);
    batch.update(visitaRef, { noLeidosSupervisor: 0 });

    await batch.commit();
    if (cambios > 0) {
      console.log(`[VisitasSeguimiento] ${cambios} mensaje(s) marcados como leídos por supervisor ${supervisorNombre}`);
    }
  } catch (err) {
    console.error('[VisitasSeguimiento] Error marcando mensajes como leídos por supervisor:', err);
  }
}

export async function markSeguimientoAsRead(
  visitaId: string,
  userRole: string,
  supervisorData?: { uid: string; nombre: string }
): Promise<void> {
  const isAdminOrSuper = ['admin', 'jefe_operaciones', 'rrhh'].includes(userRole);
  const visitaRef = doc(db, VISITAS_COL, visitaId);

  try {
    if (isAdminOrSuper) {
      await writeBatch(db).update(visitaRef, { noLeidosAdmin: 0 }).commit();
    } else {
      if (supervisorData) {
        await marcarSeguimientosLeidosPorSupervisor(visitaId, supervisorData.uid, supervisorData.nombre);
      } else {
        await writeBatch(db).update(visitaRef, { noLeidosSupervisor: 0 }).commit();
      }
    }
  } catch (err) {
    console.error('[VisitasSeguimiento] Error marcando como leído:', err);
  }
}

