import { ChecklistVisita, ItemChecklistVisita } from './visitasTypes';

/**
 * Cargos fijos base de la visita.
 * (No existía una lista reutilizable en el flujo de entrega/recepción de turno,
 *  por eso se define aquí como configuración global.)
 */
export const CARGOS_FIJOS_BASE: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'radio', label: 'Radio' },
  { id: 'celular_corporativo', label: 'Celular corporativo' },
  { id: 'linterna', label: 'Linterna' },
  { id: 'chaleco_anticorte', label: 'Chaleco anticorte' },
  { id: 'cargadores', label: 'Cargadores' },
];

export const CHECKLIST_BASE_ID = 'cargos_fijos_base';
export const CHECKLIST_BASE_VERSION = 1;

/**
 * PUNTO DE EXTENSIÓN (fase futura): checklist específico por sucursal.
 *
 * Hoy devuelve siempre la plantilla global. Más adelante esta función podrá leer
 * (con caché offline) un documento `ChecklistsSucursal/{sucursalId}` con la forma:
 *   { plantillaId, version, items: [{ id, label, obligatorio }] }
 * y devolver `origen: 'sucursal'`. El documento de la visita ya guarda un *snapshot*
 * del checklist (id/label/estado), por lo que cambiar la plantilla en el futuro
 * no altera visitas históricas ni obliga a migrar datos.
 */
export function getChecklistParaSucursal(_sucursalId: number | string): ChecklistVisita {
  const items: ItemChecklistVisita[] = CARGOS_FIJOS_BASE.map(c => ({
    id: c.id,
    label: c.label,
    estado: null,
    obligatorio: true,
  }));
  return {
    plantillaId: CHECKLIST_BASE_ID,
    origen: 'global',
    version: CHECKLIST_BASE_VERSION,
    items,
  };
}
