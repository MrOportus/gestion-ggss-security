import React, { useState, useMemo } from 'react';
import { X, PlayCircle, Loader2 } from 'lucide-react';
import { addSeguimiento } from '../../lib/novedades/seguimientoService';
import { useAppStore } from '../../store/useAppStore';

interface IniciarSeguimientoModalProps {
  novedad: any;
  onClose: () => void;
  onSuccess: () => void;
}

export const IniciarSeguimientoModal: React.FC<IniciarSeguimientoModalProps> = ({ novedad, onClose, onSuccess }) => {
  const { currentUser, employees } = useAppStore();
  const [mensaje, setMensaje] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adminEmployee = useMemo(() => {
    return employees.find(e => e.id === currentUser?.uid);
  }, [employees, currentUser]);

  const usuarioNombre = adminEmployee 
    ? `${adminEmployee.firstName} ${adminEmployee.lastNamePaterno || ''}`.trim()
    : currentUser?.email?.split('@')[0] || 'Administrador';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mensaje.trim()) {
      setError('El mensaje de seguimiento es obligatorio.');
      return;
    }

    if (!currentUser) {
      setError('Usuario no autenticado.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await addSeguimiento({
        novedadId: novedad.id,
        usuarioId: currentUser.uid,
        usuarioNombre: usuarioNombre,
        rol: currentUser.role,
        mensaje: mensaje.trim()
      }, 'inicio');

      onSuccess();
    } catch (err: any) {
      console.error('Error al iniciar seguimiento:', err);
      setError('Error al iniciar seguimiento: ' + err.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-slate-50 border-b border-slate-100 px-5 py-4 flex justify-between items-center">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <PlayCircle size={18} className="text-blue-600" />
            Dar seguimiento a novedad
          </h3>
          <button onClick={onClose} disabled={loading} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          <div className="text-sm text-slate-600 bg-blue-50/50 p-3 rounded-xl border border-blue-100">
            <p className="font-semibold text-slate-700 line-clamp-2" title={novedad.descripcion}>{novedad.descripcion}</p>
            <div className="flex gap-2 text-xs text-slate-500 mt-1 flex-wrap">
              <span>{novedad.sucursalName}</span>
              {novedad.tipo && (
                <>
                  <span>•</span>
                  <span className="uppercase">{novedad.tipo}</span>
                </>
              )}
              {novedad.prioridad && (
                <>
                  <span>•</span>
                  <span className="uppercase">{novedad.prioridad}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-bold text-slate-700">Indicación de seguimiento <span className="text-red-500">*</span></label>
            <textarea
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              placeholder="Ej.: Dar seguimiento con prevención o taller."
              className="w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none h-24"
              disabled={loading}
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-medium border border-red-100">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold text-sm rounded-xl hover:bg-slate-200 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !mensaje.trim()}
              className="flex-1 py-2.5 bg-blue-600 text-white font-bold text-sm rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : 'Confirmar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
