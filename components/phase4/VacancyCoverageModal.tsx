import React, { useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X, Save, AlertCircle, CheckCircle2 } from 'lucide-react';

interface VacancyCoverageModalProps {
  isOpen: boolean;
  onClose: () => void;
  vacanteTurnoId: string;
  sucursalId: string | number;
  fecha: string;
  onSuccess?: () => void;
}

const VacancyCoverageModal: React.FC<VacancyCoverageModalProps> = ({
  isOpen,
  onClose,
  vacanteTurnoId,
  sucursalId,
  fecha,
  onSuccess
}) => {
  const [replacementColaboradorId, setReplacementColaboradorId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [motivo, setMotivo] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replacementColaboradorId) {
      setError('Debe indicar el ID del colaborador reemplazante.');
      return;
    }
    if (!motivo.trim() || motivo.trim().length < 5) {
      setError('Debe proporcionar un motivo válido (mínimo 5 caracteres).');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      const fns = getFunctions();
      const assignVacancyReplacement = httpsCallable(fns, 'assignVacancyReplacement');
      
      const result = await assignVacancyReplacement({
        vacancyShiftId: vacanteTurnoId,
        replacementColaboradorId,
        motivo
      });

      const data = result.data as any;
      if (data.success) {
        setSuccess(true);
        setTimeout(() => {
          onClose();
          if (onSuccess) onSuccess();
        }, 2000);
      } else {
        setError(data.errorMessage || 'Error desconocido.');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error de conexión.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Transition show={isOpen} as={React.Fragment}>
      <Dialog as="div" className="relative z-50" onClose={() => !loading && onClose()}>
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="mx-auto max-w-md w-full bg-white rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <Dialog.Title className="text-lg font-bold text-slate-800">
                Asignar Reemplazo a Vacante
              </Dialog.Title>
              <button disabled={loading} onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded">
                <X size={20} />
              </button>
            </div>

            {success ? (
              <div className="p-8 text-center space-y-4">
                <div className="w-16 h-16 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 size={32} />
                </div>
                <h3 className="text-xl font-bold text-slate-800">Reemplazo Asignado</h3>
                <p className="text-slate-500">El turno de cobertura ha sido creado exitosamente.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div className="p-4 bg-purple-50 rounded-lg border border-purple-100 mb-4 text-sm text-purple-800">
                  <p><strong>Fecha Vacante:</strong> {fecha}</p>
                  <p><strong>Sucursal:</strong> {sucursalId}</p>
                  <p className="mt-2 text-xs">Asignar un colaborador para cubrir esta posición requerida por traslado.</p>
                </div>

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-red-700 text-sm">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">ID Colaborador Reemplazante</label>
                  <input
                    type="text"
                    value={replacementColaboradorId}
                    onChange={(e) => setReplacementColaboradorId(e.target.value)}
                    disabled={loading}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    placeholder="UID del colaborador..."
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Motivo</label>
                  <textarea
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    disabled={loading}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 resize-none"
                    rows={3}
                    placeholder="Justificación del reemplazo..."
                    required
                    minLength={5}
                  />
                </div>

                <div className="pt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={loading}
                    className="flex-1 px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 flex justify-center items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold shadow-sm transition disabled:opacity-50"
                  >
                    {loading ? (
                      <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                    ) : (
                      <>
                        <Save size={18} /> Confirmar
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </Dialog.Panel>
        </div>
      </Dialog>
    </Transition>
  );
};

export default VacancyCoverageModal;
