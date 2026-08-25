import React from 'react';
import { Dialog, Transition } from '@headlessui/react';
import {
  X,
  User,
  Calendar,
  MapPin,
  Clock,
  Briefcase,
  Moon,
  Coffee,
  ArrowRightLeft,
  CheckCircle2,
  AlertTriangle,
  BadgeInfo
} from 'lucide-react';

interface ShiftInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Nombre completo del colaborador */
  colaboradorNombre: string;
  /** RUT del colaborador */
  colaboradorRut?: string;
  /** Cargo/posición del colaborador */
  colaboradorCargo?: string;
  /** Email del colaborador */
  colaboradorEmail?: string;
  /** Fecha del turno (YYYY-MM-DD) */
  fecha: string;
  /** Tipo de turno */
  shiftStatus: 'programado' | 'noche' | 'descanso' | 'trasladado';
  /** Nombre de la sucursal */
  sucursalNombre?: string;
  /** ¿Hay conflicto de turno en este día? */
  isConflict?: boolean;
  /** Datos extra del documento de programación */
  shiftDetails?: Record<string, any>;
}

const STATUS_CONFIG = {
  programado: {
    label: 'Turno Programado',
    color: 'bg-blue-600',
    textColor: 'text-blue-700',
    bgLight: 'bg-blue-50',
    border: 'border-blue-200',
    icon: <Briefcase size={20} />,
    badge: 'bg-blue-100 text-blue-700',
  },
  noche: {
    label: 'Turno Noche',
    color: 'bg-indigo-700',
    textColor: 'text-indigo-700',
    bgLight: 'bg-indigo-50',
    border: 'border-indigo-200',
    icon: <Moon size={20} />,
    badge: 'bg-indigo-100 text-indigo-700',
  },
  descanso: {
    label: 'Día de Descanso',
    color: 'bg-emerald-600',
    textColor: 'text-emerald-700',
    bgLight: 'bg-emerald-50',
    border: 'border-emerald-200',
    icon: <Coffee size={20} />,
    badge: 'bg-emerald-100 text-emerald-700',
  },
  trasladado: {
    label: 'Turno Trasladado',
    color: 'bg-orange-500',
    textColor: 'text-orange-700',
    bgLight: 'bg-orange-50',
    border: 'border-orange-200',
    icon: <ArrowRightLeft size={20} />,
    badge: 'bg-orange-100 text-orange-700',
  },
} as const;

const formatFecha = (fecha: string): string => {
  try {
    // fecha = YYYY-MM-DD, forzar UTC para evitar off-by-one
    const [y, m, d] = fecha.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.toLocaleDateString('es-CL', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return fecha;
  }
};

const ShiftInfoModal: React.FC<ShiftInfoModalProps> = ({
  isOpen,
  onClose,
  colaboradorNombre,
  colaboradorRut,
  colaboradorCargo,
  colaboradorEmail,
  fecha,
  shiftStatus,
  sucursalNombre,
  isConflict,
  shiftDetails,
}) => {
  if (!isOpen) return null;

  const cfg = STATUS_CONFIG[shiftStatus] ?? STATUS_CONFIG.programado;
  const initials = colaboradorNombre
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

  return (
    <Transition show={isOpen} as={React.Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        {/* Backdrop */}
        <Transition.Child
          as={React.Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" aria-hidden="true" />
        </Transition.Child>

        {/* Panel */}
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            as={React.Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="mx-auto max-w-sm w-full bg-white rounded-2xl shadow-2xl overflow-hidden">

              {/* Header con avatar */}
              <div className={`${cfg.color} p-6 relative flex flex-col items-center text-white`}>
                <button
                  onClick={onClose}
                  className="absolute top-4 right-4 p-1 hover:bg-white/20 rounded-full transition"
                  aria-label="Cerrar"
                >
                  <X size={20} />
                </button>

                {/* Avatar con iniciales */}
                <div className="w-16 h-16 rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center mb-3 text-2xl font-black shadow-lg">
                  {initials}
                </div>

                <Dialog.Title className="text-lg font-bold text-center leading-tight">
                  {colaboradorNombre}
                </Dialog.Title>

                {colaboradorCargo && (
                  <p className="text-xs text-white/80 mt-1 font-medium uppercase tracking-wide">
                    {colaboradorCargo}
                  </p>
                )}

                {/* Badge de tipo de turno */}
                <div className="mt-3 flex items-center gap-2 bg-white/20 px-3 py-1.5 rounded-full text-sm font-semibold">
                  {cfg.icon}
                  {cfg.label}
                </div>
              </div>

              {/* Contenido informativo */}
              <div className="p-5 space-y-3">

                {/* Alerta de conflicto */}
                {isConflict && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5 text-red-500 animate-pulse" />
                    <span className="font-semibold">Conflicto de turno detectado con otra sucursal.</span>
                  </div>
                )}

                {/* Fecha */}
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${cfg.bgLight} ${cfg.textColor}`}>
                    <Calendar size={16} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fecha</p>
                    <p className="text-sm font-semibold text-slate-800 capitalize">{formatFecha(fecha)}</p>
                  </div>
                </div>

                {/* Sucursal */}
                {sucursalNombre && (
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${cfg.bgLight} ${cfg.textColor}`}>
                      <MapPin size={16} />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sucursal</p>
                      <p className="text-sm font-semibold text-slate-800">{sucursalNombre}</p>
                    </div>
                  </div>
                )}

                {/* RUT */}
                {colaboradorRut && (
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${cfg.bgLight} ${cfg.textColor}`}>
                      <BadgeInfo size={16} />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">RUT</p>
                      <p className="text-sm font-mono font-semibold text-slate-800">{colaboradorRut}</p>
                    </div>
                  </div>
                )}

                {/* Email */}
                {colaboradorEmail && (
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${cfg.bgLight} ${cfg.textColor}`}>
                      <User size={16} />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email</p>
                      <p className="text-sm font-medium text-slate-600 break-all">{colaboradorEmail}</p>
                    </div>
                  </div>
                )}

                {/* Hora de entrada/salida si existe */}
                {(shiftDetails?.horaInicio || shiftDetails?.horaFin) && (
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${cfg.bgLight} ${cfg.textColor}`}>
                      <Clock size={16} />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horario</p>
                      <p className="text-sm font-semibold text-slate-800">
                        {shiftDetails.horaInicio || '--:--'} – {shiftDetails.horaFin || '--:--'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Estado del turno si fue trasladado */}
                {shiftStatus === 'trasladado' && (
                  <div className={`flex items-center gap-2 ${cfg.bgLight} border ${cfg.border} rounded-xl p-3 text-sm ${cfg.textColor}`}>
                    <ArrowRightLeft size={14} className="shrink-0" />
                    <span className="font-medium">Este turno fue trasladado temporalmente a otra sucursal.</span>
                  </div>
                )}

                {shiftStatus === 'descanso' && (
                  <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700">
                    <CheckCircle2 size={14} className="shrink-0" />
                    <span className="font-medium">Jornada de descanso programada.</span>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 pb-5">
                <button
                  onClick={onClose}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition text-sm"
                >
                  Cerrar
                </button>
              </div>

            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
};

export default ShiftInfoModal;
