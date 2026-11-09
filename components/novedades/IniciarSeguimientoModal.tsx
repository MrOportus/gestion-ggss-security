import React, { useState, useMemo } from 'react';
import { X, PlayCircle, Loader2, Camera, Smartphone } from 'lucide-react';
import { addSeguimiento } from '../../lib/novedades/seguimientoService';
import { useAppStore } from '../../store/useAppStore';
import PhotoGalleryModal from '../PhotoGalleryModal';

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
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);

  // Extracción exhaustiva de fotos adjuntas a la novedad original
  const fotos = useMemo(() => {
    const list: string[] = [];
    const pushVal = (val: any) => {
      if (!val) return;
      if (typeof val === 'string' && val.trim().startsWith('http') && !list.includes(val.trim())) {
        list.push(val.trim());
      } else if (typeof val === 'object' && typeof val.url === 'string' && val.url.trim().startsWith('http')) {
        const u = val.url.trim();
        if (!list.includes(u)) list.push(u);
      }
    };

    if (Array.isArray(novedad?.evidencias)) novedad.evidencias.forEach(pushVal);
    if (Array.isArray(novedad?.fotos)) novedad.fotos.forEach(pushVal);
    if (Array.isArray(novedad?.fotosUrls)) novedad.fotosUrls.forEach(pushVal);
    if (novedad?.evidenciaUrl) pushVal(novedad.evidenciaUrl);
    if (novedad?.fotoUrl) pushVal(novedad.fotoUrl);
    if (novedad?.foto) pushVal(novedad.foto);
    return list;
  }, [novedad]);

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
    <>
      <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden flex flex-col">
          {/* Header */}
          <div className="bg-slate-50 border-b border-slate-100 px-5 py-4 flex justify-between items-center">
            <div>
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <PlayCircle size={18} className="text-blue-600" />
                Dar seguimiento a novedad
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">
                Envío de indicación directa al guardia de turno
              </p>
            </div>
            <button onClick={onClose} disabled={loading} className="text-slate-400 hover:text-slate-600 transition-colors">
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
            {/* Aviso explícito de destino: guardia de turno */}
            <div className="bg-blue-50/90 border border-blue-200/90 rounded-xl p-3 flex items-start gap-2.5 text-xs text-blue-900 shadow-xs">
              <Smartphone size={16} className="text-blue-600 shrink-0 mt-0.5" />
              <div className="leading-snug">
                <span className="font-bold block text-blue-950">Destinatario: Guardia de turno</span>
                Este mensaje e indicación le llegará de forma directa a la aplicación móvil del guardia en{' '}
                <strong>{novedad.sucursalName || novedad.sucursalNombre || 'la instalación'}</strong>.
              </div>
            </div>

            {/* Zona de Novedad original con estilo Post-It amarillo y miniaturas */}
            <div className="bg-amber-50/90 border border-amber-200/90 rounded-2xl p-3.5 text-xs text-amber-950 shadow-xs space-y-2">
              <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-amber-800/90">
                <span>📌 Descripción de la Novedad</span>
                {fotos.length > 0 && (
                  <span className="text-[10px] font-bold text-amber-800 bg-amber-100/90 px-2 py-0.5 rounded-full border border-amber-300/70">
                    📷 {fotos.length} {fotos.length === 1 ? 'foto' : 'fotos'}
                  </span>
                )}
              </div>

              <p className="font-medium text-amber-950 leading-relaxed whitespace-pre-wrap" title={novedad.descripcion}>
                {novedad.descripcion}
              </p>

              <div className="flex gap-2 text-[11px] text-amber-800/80 mt-1 flex-wrap font-medium">
                <span>{novedad.sucursalName || novedad.sucursalNombre}</span>
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

              {/* Galería de Fotografías Originales de la Novedad */}
              {fotos.length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-amber-200/70">
                  <p className="text-[10px] font-black uppercase tracking-wider text-amber-800/80 mb-1.5 flex items-center gap-1">
                    <Camera size={13} className="text-amber-700" />
                    Fotografías adjuntas (clic para ampliar):
                  </p>
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {fotos.map((url, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setGalleryIndex(idx)}
                        className="w-14 h-14 rounded-xl overflow-hidden border border-amber-300 shrink-0 hover:ring-2 hover:ring-amber-500 transition-all cursor-pointer group relative bg-amber-100 shadow-xs"
                        title="Clic para ampliar fotografía en galería"
                      >
                        <img
                          src={url}
                          alt={`Fotografía ${idx + 1}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-800">
                Indicación directa para el guardia de turno <span className="text-red-500">*</span>
              </label>
              <textarea
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                placeholder="Escriba aquí la instrucción u orientación que recibirá el guardia en su teléfono..."
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
                className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold text-sm rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading || !mensaje.trim()}
                className="flex-1 py-2.5 bg-blue-600 text-white font-bold text-sm rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 flex justify-center items-center gap-2 cursor-pointer shadow-xs"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : 'Enviar indicación al guardia'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Galería completa para evidencias fotográficas */}
      {galleryIndex !== null && fotos.length > 0 && (
        <PhotoGalleryModal
          photos={fotos}
          initialIndex={galleryIndex}
          onClose={() => setGalleryIndex(null)}
          title={`Fotografías · ${novedad.sucursalName || novedad.sucursalNombre || 'Novedad'}`}
        />
      )}
    </>
  );
};
