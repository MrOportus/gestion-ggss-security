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
import type { SeguimientoNovedad } from '../../types';

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

  const seguimientoDoc: SeguimientoNovedad = {
    id: nuevoSeguimientoRef.id,
    autorUid: usuarioId,
    autorNombre: usuarioNombre,
    autorRol: rol,
    fechaHora: serverTimestamp(),
    mensaje: mensaje.trim(),
    ...(fotoUrl ? { fotoUrl } : {}),
    ...(fotoPath ? { fotoPath } : {}),
    tipo: 'comentario',
  };

  batch.set(nuevoSeguimientoRef, seguimientoDoc);

  const snippet = mensaje.trim().substring(0, SNIPPET_MAX_LEN) + (mensaje.trim().length > SNIPPET_MAX_LEN ? '...' : '');
  const isResuelto = false;

  const updatePayload: any = {
    estado: 'en_revision',
    requiereSeguimiento: true,
    ultimoSeguimientoEn: serverTimestamp(),
    ultimoSeguimientoMsg: fotoUrl && !mensaje.trim() ? '📷 [Fotografía adjunta]' : snippet,
    ultimoSeguimientoAutor: usuarioNombre,
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

  const seguimientoDoc: SeguimientoNovedad = {
    id: nuevoSeguimientoRef.id,
    autorUid,
    autorNombre,
    autorRol,
    fechaHora: serverTimestamp(),
    mensaje: 'Visita resuelta',
    tipo: 'resolucion',
  };

  batch.set(nuevoSeguimientoRef, seguimientoDoc);
  batch.update(visitaRef, {
    estado: 'resuelta',
    requiereSeguimiento: false,
    ultimoSeguimientoEn: serverTimestamp(),
    ultimoSeguimientoMsg: 'Visita marcada como resuelta.',
    ultimoSeguimientoAutor: autorNombre,
  });

  await batch.commit();
}

export async function getSeguimientos(visitaId: string): Promise<SeguimientoNovedad[]> {
  const seguimientosRef = collection(db, VISITAS_COL, visitaId, SEGUIMIENTOS_SUBCOL);
  const q = query(seguimientosRef, orderBy('fechaHora', 'asc'));
  const snap = await getDocs(q);
  
  return snap.docs.map(doc => {
    const data = doc.data();
    return {
      ...data,
      id: doc.id,
      fechaHora: data.fechaHora?.toDate()?.toISOString() || new Date().toISOString(),
    } as SeguimientoNovedad;
  });
}

export async function markSeguimientoAsRead(visitaId: string, userRole: string): Promise<void> {
  const isAdminOrSuper = ['admin', 'jefe_operaciones', 'rrhh'].includes(userRole);
  const visitaRef = doc(db, VISITAS_COL, visitaId);
  const batch = writeBatch(db);

  if (isAdminOrSuper) {
    batch.update(visitaRef, { noLeidosAdmin: 0 });
  } else {
    batch.update(visitaRef, { noLeidosSupervisor: 0 });
  }

  try {
    await batch.commit();
  } catch (err) {
    console.error('[VisitasSeguimiento] Error marcando como leído:', err);
  }
}
