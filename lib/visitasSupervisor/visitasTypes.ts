/**
 * Tipos del módulo "Visitas de Supervisor".
 *
 * Colección Firestore: `visitasSupervisor` (nueva, aislada; no modifica colecciones existentes).
 * ID del documento = `visitId` (generado al iniciar la visita) → escritura idempotente.
 */

export type EstadoCargo = 'ok' | 'observacion' | 'faltante';
export type ResultadoVisita = 'sin_novedades' | 'con_observaciones' | 'con_novedad';
export type PrioridadNovedad = 'informativa' | 'requiere_atencion' | 'urgente';
export type AmbitoFoto = 'visita' | 'observacion';

// ─── Checklist (preparado para checklist por sucursal en fases futuras) ───────

export interface ItemChecklistVisita {
  id: string;
  label: string;
  /** null = aún sin responder (solo en borrador) */
  estado: EstadoCargo | null;
  /** Comentario opcional (solo cuando estado != ok) */
  nota?: string;
  /** Reservado: ítems obligatorios por sucursal (fase futura) */
  obligatorio?: boolean;
}

export interface ChecklistVisita {
  /** Identificador de la plantilla usada. Hoy: 'cargos_fijos_base'. Futuro: id de plantilla por sucursal. */
  plantillaId: string;
  /** 'global' = plantilla base; 'sucursal' = checklist específico (fase futura) */
  origen: 'global' | 'sucursal';
  version: number;
  items: ItemChecklistVisita[];
}

// ─── Ubicación ────────────────────────────────────────────────────────────────

export type MotivoSinUbicacion = 'permiso_denegado' | 'timeout' | 'no_disponible';

export interface UbicacionVisita {
  estado: 'verificada' | 'no_disponible';
  lat?: number;
  lng?: number;
  accuracy?: number;
  capturadaEn?: string; // ISO
  motivo?: MotivoSinUbicacion;
}

// ─── Fotos ────────────────────────────────────────────────────────────────────

export interface FotoVisitaLocal {
  id: string;
  dataUrl: string; // base64 comprimido
  ambito: AmbitoFoto;
  capturadoEn: string; // ISO
}

export interface FotoVisitaRemota {
  url: string;
  ambito: AmbitoFoto;
  orden: number;
  capturadoEn: string;
}

// ─── Respuestas ───────────────────────────────────────────────────────────────

export interface EntrevistaMandanteDraft {
  realizada: boolean | null;
  nombre: string;
  resumen: string;
  compromiso: boolean | null;
  compromisoTexto: string;
}

export interface ObservacionesDraft {
  hay: boolean | null;
  texto: string;
}

export interface NovedadDraft {
  hay: boolean | null;
  descripcion: string;
  prioridad: PrioridadNovedad;
}

export type MotivoVisita = 'Visita No Programada' | 'Visita Programada' | 'Otro';

export interface EppGuardiasDraft {
  completo: boolean | null;
  detalleFaltante: string;
}

/** Borrador local persistido (localforage) mientras el supervisor llena la visita. */
export interface VisitaDraft {
  visitId: string;
  supervisorUid: string;
  sucursalId: number | string;
  sucursalNombre: string;
  inicioEn: string; // ISO
  ubicacion: UbicacionVisita | null; // null = verificando
  
  motivo: MotivoVisita | '';
  motivoOtro?: string;
  guardiasDeTurno: string;
  epp: EppGuardiasDraft;

  fotos: FotoVisitaLocal[];
  checklist: ChecklistVisita;
  entrevista: EntrevistaMandanteDraft;
  observaciones: ObservacionesDraft;
  novedad: NovedadDraft;
  nota: string;
}

// ─── Documento Firestore ──────────────────────────────────────────────────────

export interface VisitaSupervisorDoc {
  id: string;
  schemaVersion: number;

  supervisorUid: string;
  supervisorNombre: string;
  sucursalId: number | string;
  sucursalNombre: string;

  fechaOperacional: string; // YYYY-MM-DD (fecha de inicio)
  inicioEn: string; // ISO dispositivo
  terminoEn: string; // ISO dispositivo
  duracionMin: number;
  zonaHoraria: string;

  ubicacion: UbicacionVisita;
  
  motivo: string;
  guardiasDeTurno: string;
  epp: {
    completo: boolean;
    detalleFaltante?: string;
  };

  checklist: ChecklistVisita;

  entrevistaMandante: {
    realizada: boolean;
    nombre?: string;
    resumen?: string;
    compromiso?: { hay: boolean; texto?: string };
  };
  observaciones: { hay: boolean; texto?: string };
  novedadRelevante: { hay: boolean; descripcion?: string; prioridad?: PrioridadNovedad };
  nota?: string;

  resultado: ResultadoVisita;

  /** Cantidad de fotos esperadas (para saber si faltan por sincronizar) */
  fotosTotal: number;
  /** Mapa photoId → foto. Se completa a medida que se suben (clave = idempotencia). */
  fotos?: Record<string, FotoVisitaRemota>;

  creadoEn: string; // ISO dispositivo al enviar
  sincronizadoEn?: any; // serverTimestamp()

  // ─── Seguimiento de la visita ───
  estado?: 'registrada' | 'en_revision' | 'resuelta'; // Opcional por retrocompatibilidad
  requiereSeguimiento?: boolean;
  ultimoSeguimientoEn?: any;
  ultimoSeguimientoMsg?: string;
  ultimoSeguimientoAutor?: string;
  noLeidosAdmin?: number;
  noLeidosSupervisor?: number;
  fijadaPorAdmin?: boolean;
}

export interface ResumenCargos {
  ok: number;
  observacion: number;
  faltante: number;
  sinResponder: number;
}
