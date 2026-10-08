import {
  EstadoCargo,
  ResultadoVisita,
  ResumenCargos,
  VisitaDraft,
  VisitaSupervisorDoc,
  PrioridadNovedad,
} from './visitasTypes';
import { getChecklistParaSucursal } from './checklistConfig';

export const SCHEMA_VERSION = 1;
export const ZONA_HORARIA = 'America/Santiago';

// ─── Etiquetas (única fuente de verdad para UI) ───────────────────────────────

export const RESULTADO_LABEL: Record<ResultadoVisita, string> = {
  sin_novedades: 'Sin novedades',
  con_observaciones: 'Con observaciones',
  con_novedad: 'Con novedad relevante',
};

export const RESULTADO_EMOJI: Record<ResultadoVisita, string> = {
  sin_novedades: '🟢',
  con_observaciones: '🟠',
  con_novedad: '🔴',
};

export const ESTADO_CARGO_LABEL: Record<EstadoCargo, string> = {
  ok: 'OK',
  observacion: 'OBSERVACIÓN',
  faltante: 'FALTANTE',
};

export const ESTADO_CARGO_EMOJI: Record<EstadoCargo, string> = {
  ok: '🟢',
  observacion: '🟠',
  faltante: '🔴',
};

export const PRIORIDAD_LABEL: Record<PrioridadNovedad, string> = {
  informativa: 'Informativa',
  requiere_atencion: 'Requiere atención',
  urgente: 'Urgente',
};

// ─── Utilidades ───────────────────────────────────────────────────────────────

/** ID único de la visita. Se genera UNA vez al iniciar y se mantiene en reintentos. */
export function generarVisitId(): string {
  return `vis_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/** YYYY-MM-DD en hora local del dispositivo */
export function fechaLocalISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function crearBorrador(params: {
  supervisorUid: string;
  sucursalId: number | string;
  sucursalNombre: string;
  now?: Date;
}): VisitaDraft {
  const now = params.now ?? new Date();
  return {
    visitId: generarVisitId(),
    supervisorUid: params.supervisorUid,
    sucursalId: params.sucursalId,
    sucursalNombre: params.sucursalNombre,
    inicioEn: now.toISOString(),
    ubicacion: null,
    motivo: '',
    guardiasDeTurno: '',
    epp: { completo: null, detalleFaltante: '' },
    fotos: [],
    checklist: getChecklistParaSucursal(params.sucursalId),
    entrevista: { realizada: null, nombre: '', resumen: '', compromiso: null, compromisoTexto: '' },
    observaciones: { hay: null, texto: '' },
    novedad: { hay: null, descripcion: '', prioridad: 'informativa' },
    nota: '',
  };
}

// ─── Resultado y resúmenes ────────────────────────────────────────────────────

export function resumenCargos(draft: Pick<VisitaDraft, 'checklist'>): ResumenCargos {
  const r: ResumenCargos = { ok: 0, observacion: 0, faltante: 0, sinResponder: 0 };
  for (const it of draft.checklist.items) {
    if (it.estado === 'ok') r.ok++;
    else if (it.estado === 'observacion') r.observacion++;
    else if (it.estado === 'faltante') r.faltante++;
    else r.sinResponder++;
  }
  return r;
}

/**
 * Resultado automático:
 *  - Novedad relevante = SÍ                         → con_novedad
 *  - Observaciones = SÍ o algún cargo no está OK    → con_observaciones
 *  - En otro caso                                   → sin_novedades
 */
export function calcularResultado(
  draft: Pick<VisitaDraft, 'checklist' | 'observaciones' | 'novedad'>
): ResultadoVisita {
  if (draft.novedad.hay === true) return 'con_novedad';
  const c = resumenCargos(draft);
  if (draft.observaciones.hay === true || c.observacion > 0 || c.faltante > 0) return 'con_observaciones';
  return 'sin_novedades';
}

// ─── Validación ───────────────────────────────────────────────────────────────

export interface ErrorValidacion {
  seccion: 'cargos' | 'mandante' | 'observaciones' | 'novedad';
  mensaje: string;
}

/** Mensajes simples, sin terminología técnica. Solo exige lo mínimo para que el reporte tenga sentido. */
export function validarBorrador(draft: VisitaDraft): ErrorValidacion[] {
  const errores: ErrorValidacion[] = [];

  const sinResponder = draft.checklist.items.filter(i => i.estado === null);
  if (sinResponder.length > 0) {
    errores.push({
      seccion: 'cargos',
      mensaje: `Falta marcar: ${sinResponder.map(i => i.label).join(', ')}.`,
    });
  }

  if (!draft.motivo) {
    errores.push({ seccion: 'cargos', mensaje: 'Seleccione el motivo de la visita.' });
  } else if (draft.motivo === 'Otro' && !draft.motivoOtro?.trim()) {
    errores.push({ seccion: 'cargos', mensaje: 'Escriba el motivo de la visita.' });
  }

  if (!draft.guardiasDeTurno.trim()) {
    errores.push({ seccion: 'cargos', mensaje: 'Escriba los guardias de turno.' });
  }

  if (draft.epp.completo === null) {
    errores.push({ seccion: 'cargos', mensaje: 'Indique si el EPP de los guardias está completo.' });
  } else if (!draft.epp.completo && !draft.epp.detalleFaltante.trim()) {
    errores.push({ seccion: 'cargos', mensaje: 'Indique qué EPP falta y por qué.' });
  }

  const e = draft.entrevista;
  if (e.realizada === null) {
    errores.push({ seccion: 'mandante', mensaje: 'Responda si se entrevistó con el mandante.' });
  } else if (e.realizada) {
    if (!e.nombre.trim()) errores.push({ seccion: 'mandante', mensaje: 'Escriba el nombre del mandante.' });
    if (e.compromiso === null) {
      errores.push({ seccion: 'mandante', mensaje: 'Responda si quedó algún compromiso o acuerdo.' });
    } else if (e.compromiso && !e.compromisoTexto.trim()) {
      errores.push({ seccion: 'mandante', mensaje: 'Escriba el compromiso o acuerdo.' });
    }
  }

  if (draft.observaciones.hay === null) {
    errores.push({ seccion: 'observaciones', mensaje: 'Responda si hay observaciones.' });
  } else if (draft.observaciones.hay && !draft.observaciones.texto.trim()) {
    errores.push({ seccion: 'observaciones', mensaje: 'Escriba la observación.' });
  }

  if (draft.novedad.hay === null) {
    errores.push({ seccion: 'novedad', mensaje: 'Responda si existe una novedad relevante.' });
  } else if (draft.novedad.hay && !draft.novedad.descripcion.trim()) {
    errores.push({ seccion: 'novedad', mensaje: 'Describa la novedad.' });
  }

  if (!draft.nota.trim()) {
    errores.push({ seccion: 'nota' as any, mensaje: 'El Resumen Ejecutivo de Visita es obligatorio.' });
  }

  return errores;
}

// ─── Construcción del documento ───────────────────────────────────────────────

/** Convierte el borrador validado en el documento a guardar (sin fotos: se suben por separado). */
export function construirDocumentoVisita(
  draft: VisitaDraft,
  supervisorNombre: string,
  terminoEn: Date = new Date()
): VisitaSupervisorDoc {
  const inicio = new Date(draft.inicioEn);
  const duracionMin = Math.max(0, Math.round((terminoEn.getTime() - inicio.getTime()) / 60000));
  const e = draft.entrevista;

  const doc: VisitaSupervisorDoc = {
    id: draft.visitId,
    schemaVersion: SCHEMA_VERSION,
    supervisorUid: draft.supervisorUid,
    supervisorNombre,
    sucursalId: draft.sucursalId,
    sucursalNombre: draft.sucursalNombre,
    fechaOperacional: fechaLocalISO(inicio),
    inicioEn: draft.inicioEn,
    terminoEn: terminoEn.toISOString(),
    duracionMin,
    zonaHoraria: ZONA_HORARIA,
    ubicacion: draft.ubicacion ?? { estado: 'no_disponible', motivo: 'no_disponible' },
    motivo: draft.motivo === 'Otro' && draft.motivoOtro ? draft.motivoOtro.trim() : draft.motivo,
    guardiasDeTurno: draft.guardiasDeTurno.trim(),
    epp: {
      completo: draft.epp.completo === true,
      ...(draft.epp.completo === false ? { detalleFaltante: draft.epp.detalleFaltante.trim() } : {}),
    },
    checklist: {
      ...draft.checklist,
      items: draft.checklist.items.map(i => ({
        id: i.id,
        label: i.label,
        estado: i.estado,
        ...(i.estado !== 'ok' && i.nota?.trim() ? { nota: i.nota.trim() } : {}),
        ...(i.obligatorio !== undefined ? { obligatorio: i.obligatorio } : {}),
      })),
    },
    entrevistaMandante: e.realizada
      ? {
          realizada: true,
          nombre: e.nombre.trim(),
          ...(e.resumen.trim() ? { resumen: e.resumen.trim() } : {}),
          compromiso: e.compromiso
            ? { hay: true, texto: e.compromisoTexto.trim() }
            : { hay: false },
        }
      : { realizada: false },
    observaciones: draft.observaciones.hay
      ? { hay: true, texto: draft.observaciones.texto.trim() }
      : { hay: false },
    novedadRelevante: draft.novedad.hay
      ? { hay: true, descripcion: draft.novedad.descripcion.trim(), prioridad: draft.novedad.prioridad }
      : { hay: false },
    resultado: calcularResultado(draft),
    fotosTotal: draft.fotos.length,
    creadoEn: new Date().toISOString(),
    estado: 'registrada',
  };

  if (draft.nota.trim()) doc.nota = draft.nota.trim();
  return doc;
}

// ─── Consulta (admin) ─────────────────────────────────────────────────────────

export interface FiltrosVisitas {
  desde: string; // YYYY-MM-DD o ''
  hasta: string; // YYYY-MM-DD o ''
  sucursalId: string; // '' = todas
  supervisorUid: string; // '' = todos
  resultado: '' | ResultadoVisita;
}

export const FILTROS_VACIOS: FiltrosVisitas = {
  desde: '',
  hasta: '',
  sucursalId: '',
  supervisorUid: '',
  resultado: '',
};

/** Los filtros se combinan (AND). */
export function filtrarVisitas(visitas: VisitaSupervisorDoc[], f: FiltrosVisitas): VisitaSupervisorDoc[] {
  return visitas.filter(v => {
    if (f.desde && v.fechaOperacional < f.desde) return false;
    if (f.hasta && v.fechaOperacional > f.hasta) return false;
    if (f.sucursalId && String(v.sucursalId) !== f.sucursalId) return false;
    if (f.supervisorUid && v.supervisorUid !== f.supervisorUid) return false;
    if (f.resultado && v.resultado !== f.resultado) return false;
    return true;
  });
}

export interface EstadisticasVisitas {
  visitasMes: number;
  supervisoresConVisitas: number;
  visitasConNovedad: number;
}

export function calcularEstadisticas(visitas: VisitaSupervisorDoc[], hoy: Date = new Date()): EstadisticasVisitas {
  const mes = fechaLocalISO(hoy).substring(0, 7); // YYYY-MM
  const delMes = visitas.filter(v => v.fechaOperacional.startsWith(mes));
  return {
    visitasMes: delMes.length,
    supervisoresConVisitas: new Set(visitas.map(v => v.supervisorUid)).size,
    visitasConNovedad: visitas.filter(v => v.novedadRelevante?.hay === true).length,
  };
}

/** Fotos ordenadas, separadas por ámbito */
export function fotosDeVisita(v: VisitaSupervisorDoc) {
  const todas = Object.entries(v.fotos ?? {})
    .map(([id, f]) => ({ id, ...f }))
    .sort((a, b) => a.orden - b.orden);
  return {
    visita: todas.filter(f => f.ambito === 'visita'),
    observacion: todas.filter(f => f.ambito === 'observacion'),
    total: todas.length,
  };
}

/** true si aún faltan fotos por llegar a la nube */
export function fotosPendientes(v: VisitaSupervisorDoc): number {
  return Math.max(0, (v.fotosTotal ?? 0) - Object.keys(v.fotos ?? {}).length);
}
