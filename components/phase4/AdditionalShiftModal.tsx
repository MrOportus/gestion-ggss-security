import React, { useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X, Save, AlertCircle, CheckCircle2 } from 'lucide-react';

interface AdditionalShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  colaboradorId: string;
  colaboradorNombre: string;
  fecha: string; // YYYY-MM-DD
  onSuccess?: () => void;
}

const AdditionalShiftModal: React.FC<AdditionalShiftModalProps> = ({
  isOpen,
  onClose,
  colaboradorId,
  colaboradorNombre,
  fecha,
  onSuccess
}) => {
  const [sucursalId, setSucursalId] = useState('');
  const [estado, setEstado] = useState<'programado' | 'noche'>('programado');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [motivo, setMotivo] = useState('');

  // En la aplicación real esto vendría del store. Por ahora usamos un input para simplificar el MVP
  // o se lo podemos pasar como prop desde ShiftManagement.

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sucursalId) {
      setError('Debe indicar el ID de la sucursal.');
      return;
    }
    if (!motivo.trim() || motivo.trim().length < 5) {
      setError('Debe proporcionar un motivo válido (mínimo 5 caracteres).');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Usar getFunctions si importamos desde 'firebase/functions'
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      const fns = getFunctions();
      const createAdditionalShift = httpsCallable(fns, 'createAdditionalShift');
      
      const result = await createAdditionalShift({
        colaboradorId,
        sucursalId: parseInt(sucursalId, 10),
        fecha,
        estado,
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
                Crear Turno Adicional
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
                <h3 className="text-xl font-bold text-slate-800">Turno Creado</h3>
                <p className="text-slate-500">El turno adicional se ha registrado exitosamente.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 mb-4 text-sm text-blue-800">
                  <p><strong>Colaborador:</strong> {colaboradorNombre}</p>
                  <p><strong>Fecha:</strong> {fecha}</p>
                </div>

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-red-700 text-sm">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">ID Sucursal Destino</label>
                  <input
                    type="number"
                    value={sucursalId}
                    onChange={(e) => setSucursalId(e.target.value)}
                    disabled={loading}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Ej: 3"
                    required
                  />
                  <p className="text-xs text-slate-500 mt-1">Ingrese el ID numérico de la instalación.</p>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Tipo de Turno</label>
                  <select
                    value={estado}
                    onChange={(e) => setEstado(e.target.value as any)}
                    disabled={loading}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="programado">Turno Día (programado)</option>
                    <option value="noche">Turno Noche</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Motivo</label>
                  <textarea
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    disabled={loading}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none"
                    rows={3}
                    placeholder="Escriba la justificación para este turno adicional..."
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
                    className="flex-1 flex justify-center items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-sm transition disabled:opacity-50"
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

export default AdditionalShiftModal;
