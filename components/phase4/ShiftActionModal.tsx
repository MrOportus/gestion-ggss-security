import React from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { ArrowRightLeft, Plus, Users, RotateCcw, X, CheckCircle2 } from 'lucide-react';

interface ShiftActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  shiftStatus: string;
  requiereCobertura: boolean;
  colaboradorNombre: string;
  fecha: string;
  isConflict?: boolean;
  onAction: (action: 'transfer' | 'additional' | 'coverage' | 'revert' | 'delete' | 'force_assign') => void;
  role?: string;
}

const ShiftActionModal: React.FC<ShiftActionModalProps> = ({
  isOpen,
  onClose,
  shiftStatus,
  requiereCobertura,
  colaboradorNombre,
  fecha,
  isConflict,
  onAction,
  role
}) => {
  if (!isOpen) return null;

  return (
    <Transition show={isOpen} as={React.Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="mx-auto max-w-sm w-full bg-white rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <Dialog.Title className="text-lg font-bold text-slate-800">
                Acciones del Turno
              </Dialog.Title>
              <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-4 bg-slate-50 border-b border-slate-200">
              <p className="text-sm font-medium text-slate-600">
                <span className="text-slate-800 font-bold">{colaboradorNombre}</span>
                <br/>
                Fecha: {fecha}
              </p>
            </div>

            <div className="p-2 space-y-1">
              {isConflict ? (
                <>
                  <button
                    onClick={() => { onAction('delete'); onClose(); }}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-red-50 rounded-lg transition"
                  >
                    <div className="p-2 bg-red-100 text-red-600 rounded-lg">
                      <X size={18} />
                    </div>
                    <div>
                      <div className="font-bold text-slate-700">Eliminar este turno</div>
                      <div className="text-xs text-slate-500">Quitar el turno de esta sucursal</div>
                    </div>
                  </button>

                  <button
                    onClick={() => { onAction('force_assign'); onClose(); }}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-emerald-50 rounded-lg transition"
                  >
                    <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                      <CheckCircle2 size={18} />
                    </div>
                    <div>
                      <div className="font-bold text-slate-700">Asignar Forzado</div>
                      <div className="text-xs text-slate-500">EliminarForzado: elimina el otro turno programado de la otra sucursal</div>
                    </div>
                  </button>
                </>
              ) : (
                <>
                  {(shiftStatus === 'programado' || shiftStatus === 'noche' || shiftStatus === 'descanso') && role !== 'rrhh' && (
                <button
                  onClick={() => { onAction('transfer'); onClose(); }}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50 rounded-lg transition"
                >
                  <div className="p-2 bg-orange-100 text-orange-600 rounded-lg">
                    <ArrowRightLeft size={18} />
                  </div>
                  <div>
                    <div className="font-bold text-slate-700">Trasladar Turno</div>
                    <div className="text-xs text-slate-500">Mover a otra sucursal temporalmente</div>
                  </div>
                </button>
              )}

              {role !== 'rrhh' && (
                <button
                  onClick={() => { onAction('additional'); onClose(); }}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50 rounded-lg transition"
                >
                  <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                    <Plus size={18} />
                  </div>
                  <div>
                    <div className="font-bold text-slate-700">Crear Turno Adicional</div>
                    <div className="text-xs text-slate-500">Horas extra, reemplazos o coberturas</div>
                  </div>
                </button>
              )}

              {shiftStatus === 'trasladado' && requiereCobertura && role !== 'rrhh' && (
                <button
                  onClick={() => { onAction('coverage'); onClose(); }}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50 rounded-lg transition"
                >
                  <div className="p-2 bg-purple-100 text-purple-600 rounded-lg">
                    <Users size={18} />
                  </div>
                  <div>
                    <div className="font-bold text-slate-700">Asignar Reemplazo</div>
                    <div className="text-xs text-slate-500">Cubrir vacante dejada por traslado</div>
                  </div>
                </button>
              )}

              {shiftStatus === 'trasladado' && role !== 'rrhh' && (
                <button
                  onClick={() => { onAction('revert'); onClose(); }}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50 rounded-lg transition"
                >
                  <div className="p-2 bg-slate-100 text-slate-600 rounded-lg">
                    <RotateCcw size={18} />
                  </div>
                  <div>
                    <div className="font-bold text-slate-700">Revertir Traslado</div>
                    <div className="text-xs text-slate-500">Cancelar destino y reactivar origen</div>
                  </div>
                </button>
              )}
              </>
              )}
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </Transition>
  );
};

export default ShiftActionModal;
