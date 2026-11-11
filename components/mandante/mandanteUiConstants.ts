export interface CategoriaMetaItem {
  icon: string;
  label: string;
  badgeClass: string;
}

export const MANDANTE_CATEGORIA_META: Record<string, CategoriaMetaItem> = {
  acceso_personas: { icon: '🧍🏽', label: 'Acceso Personas', badgeClass: 'bg-sky-50 border-sky-200/80 text-sky-800' },
  acceso_vehiculos: { icon: '🚗', label: 'Acceso Vehículos', badgeClass: 'bg-indigo-50 border-indigo-200/80 text-indigo-800' },
  'daño_desperfecto': { icon: '🚧', label: 'Falla o Daños', badgeClass: 'bg-amber-50 border-amber-200/80 text-amber-800' },
  infraestructura: { icon: '🚧', label: 'Infraestructura', badgeClass: 'bg-amber-50 border-amber-200/80 text-amber-800' },
  alarma: { icon: '🚨', label: 'Alarmas', badgeClass: 'bg-rose-50 border-rose-200/80 text-rose-800' },
  emergencia: { icon: '🆘', label: 'SOS Emergencia', badgeClass: 'bg-red-50 border-red-200/80 text-red-800' },
  objeto_encontrado: { icon: '📦', label: 'Objeto Encontrado', badgeClass: 'bg-emerald-50 border-emerald-200/80 text-emerald-800' },
  requiere_seguimiento: { icon: '👁️', label: 'Seguimiento', badgeClass: 'bg-purple-50 border-purple-200/80 text-purple-800' },
  seguridad: { icon: '🛡️', label: 'Seguridad', badgeClass: 'bg-blue-50 border-blue-200/80 text-blue-800' },
  persona_sospechosa: { icon: '🕵️', label: 'Persona Sospechosa', badgeClass: 'bg-orange-50 border-orange-200/80 text-orange-800' },
  entrega_recepcion_turno: { icon: '🔄', label: 'Entrega de Turno', badgeClass: 'bg-teal-50 border-teal-200/80 text-teal-800' },
  otro: { icon: '📝', label: 'Otro', badgeClass: 'bg-slate-50 border-slate-200/80 text-slate-700' },
};

export const getMandanteCategoriaMeta = (categoria?: string): CategoriaMetaItem =>
  (categoria && MANDANTE_CATEGORIA_META[categoria]) || MANDANTE_CATEGORIA_META.otro;

export const PRIORITY_STYLE: Record<
  'critica' | 'alta' | 'media' | 'informativa',
  { label: string; pillClass: string; dotClass: string }
> = {
  critica: {
    label: 'Crítica',
    pillClass: 'bg-rose-50 text-rose-700 border border-rose-200',
    dotClass: 'bg-rose-500',
  },
  alta: {
    label: 'Alta',
    pillClass: 'bg-orange-50 text-orange-700 border border-orange-200',
    dotClass: 'bg-orange-500',
  },
  media: {
    label: 'Media',
    pillClass: 'bg-amber-50 text-amber-700 border border-amber-200',
    dotClass: 'bg-amber-500',
  },
  informativa: {
    label: 'Informativa',
    pillClass: 'bg-sky-50 text-sky-700 border border-sky-200',
    dotClass: 'bg-sky-500',
  },
};

export const ESTADO_STYLE: Record<
  'pendiente' | 'revision' | 'resuelta',
  { pillClass: string }
> = {
  pendiente: { pillClass: 'bg-rose-50 text-rose-700 border border-rose-200/80' },
  revision: { pillClass: 'bg-amber-50 text-amber-700 border border-amber-200/80' },
  resuelta: { pillClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80' },
};

/** Formatea fecha amigable ejecutiva: "Hoy, 12:40 p. m.", "Ayer, 09:15 a. m." o "10/11/2026, 09:15 a. m." */
export function formatExecutiveDateTime(iso: string, now: Date = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const timeStr = d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  if (sameDay(d, now)) return `Hoy, ${timeStr}`;
  if (sameDay(d, yesterday)) return `Ayer, ${timeStr}`;
  const dateStr = d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${dateStr}, ${timeStr}`;
}

