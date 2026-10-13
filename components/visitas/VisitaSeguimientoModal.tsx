import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ArrowLeft,
  CheckCircle,
  Loader2,
  Camera,
  Image as ImageIcon,
  AlertCircle,
  Send,
  CheckCheck,
  Check,
} from 'lucide-react';
import {
  addSeguimiento,
  markSeguimientoAsRead,
  marcarSeguimientosLeidosPorSupervisor,
  subscribeSeguimientos,
  resolverVisita,
  SeguimientoBaseParams,
} from '../../lib/visitasSupervisor/seguimientoVisitasService';
import { useAppStore } from '../../store/useAppStore';
import type { VisitaSupervisorDoc, SeguimientoVisita } from '../../lib/visitasSupervisor/visitasTypes';

const ROL_LABEL: Record<string, string> = {
  worker:           'Guardia',
  admin:            'Admin',
  supervisor:       'Supervisor',
  jefe_operaciones: 'Jefe Ops.',
  rrhh:             'RRHH',
};

interface VisitaSeguimientoModalProps {
  visita: VisitaSupervisorDoc;
  usuario: { uid: string; nombre: string; rol: string };
  onClose: (resolto?: boolean) => void;
}

const formatearHoraMensaje = (fecha: any): string => {
  if (!fecha) return '';
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha.toDate ? fecha.toDate() : new Date(fecha);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
};

const formatearHoraVisto = (fecha: any): string => {
  if (!fecha) return '';
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha.toDate ? fecha.toDate() : new Date(fecha);
  if (isNaN(d.getTime())) return '';
  
  const ahora = new Date();
  const esMismoDia = d.getDate() === ahora.getDate() &&
                     d.getMonth() === ahora.getMonth() &&
                     d.getFullYear() === ahora.getFullYear();
  
  const horaStr = d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (esMismoDia) {
    return `a las ${horaStr}`;
  }
  const diaMesStr = d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
  return `el ${diaMesStr} a las ${horaStr}`;
};

const VisitaSeguimientoModal: React.FC<VisitaSeguimientoModalProps> = ({ visita, usuario, onClose }) => {
  const uploadBase64 = useAppStore(state => state.uploadBase64);
  const showNotification = useAppStore(state => state.showNotification);

  const [seguimientos, setSeguimientos] = useState<SeguimientoVisita[]>([]);
  const [loadingHilo, setLoadingHilo] = useState(true);

  const esAdmin = ['admin', 'jefe_operaciones', 'rrhh'].includes(usuario.rol);
  const esSupervisor = usuario.rol === 'supervisor' || usuario.uid === visita.supervisorUid;

  // Modo: 'ver' | 'resolver'
  const [modo, setModo] = useState<'ver' | 'resolver'>('ver');
  const [mensaje, setMensaje] = useState('');
  const [foto, setFoto] = useState<string | null>(null);       // preview base64
  const [fotoBlob, setFotoBlob] = useState<File | null>(null); // para subir
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoadingHilo(true);

    // Subscripción en tiempo real a los seguimientos
    const unsubscribe = subscribeSeguimientos(
      visita.id,
      (mensajes) => {
        setSeguimientos(mensajes);
        setLoadingHilo(false);

        // Si quien abre el hilo es el supervisor, marcar mensajes de admin como leídos
        if (esSupervisor) {
          const hayNoLeidos = mensajes.some(m => m.autorUid !== usuario.uid && !m.leidoPorSupervisor);
          if (hayNoLeidos) {
            marcarSeguimientosLeidosPorSupervisor(visita.id, usuario.uid, usuario.nombre).catch(err => {
              console.error('[SeguimientoVisitaModal] Error marcando leídos en tiempo real:', err);
            });
          }
        }
      },
      (err) => {
        console.error('[SeguimientoVisitaModal] Error en suscripción:', err);
        setLoadingHilo(false);
      }
    );

    // Al montar: marcar como leído según corresponda
    if (esAdmin) {
      markSeguimientoAsRead(visita.id, usuario.rol).catch(e => {
        console.error('[SeguimientoVisitaModal] Error al marcar como leído admin:', e);
      });
    } else if (esSupervisor) {
      marcarSeguimientosLeidosPorSupervisor(visita.id, usuario.uid, usuario.nombre).catch(e => {
        console.error('[SeguimientoVisitaModal] Error al marcar como leído supervisor:', e);
      });
    }

    return () => {
      unsubscribe();
    };
  }, [visita.id, usuario.uid, usuario.nombre, usuario.rol, esAdmin, esSupervisor]);

  useEffect(() => {
    if (!loadingHilo) {
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [seguimientos, loadingHilo]);

  const handleAgregarFoto = (source: 'camera' | 'gallery') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (source === 'camera') input.capture = 'environment';
    input.onchange = (e: any) => {
      const file: File = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        setFoto(ev.target?.result as string);
        setFotoBlob(file);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleEnviar = async (tipo: 'comentario' | 'resolucion') => {
    let textoFinal = mensaje.trim();
    if (tipo === 'resolucion' && !textoFinal) {
      textoFinal = 'Resuelto';
    } else if (tipo !== 'resolucion' && (!textoFinal && !fotoBlob)) {
      setError('El mensaje debe tener texto o una fotografía.');
      return;
    }
    if (enviando) return;
    setEnviando(true);
    setError(null);

    try {
      if (tipo === 'resolucion') {
        await resolverVisita(visita.id, usuario.uid, usuario.nombre, usuario.rol);
        showNotification('Seguimiento marcado como resuelto.', 'success');
        onClose(true);
      } else {
        let fotoUrl: string | undefined;
        let fotoPath: string | undefined;

        if (foto && fotoBlob) {
          const ext = fotoBlob.type.includes('webp') ? 'webp' : 'jpg';
          fotoPath = `visitas_seguimientos/${visita.id}/${Date.now()}_${usuario.uid}.${ext}`;
          fotoUrl = await uploadBase64(foto, fotoPath);
        }

        const params: SeguimientoBaseParams = {
          visitaId: visita.id,
          usuarioId: usuario.uid,
          usuarioNombre: usuario.nombre,
          rol: usuario.rol,
          mensaje: textoFinal,
          ...(fotoUrl ? { fotoUrl } : {}),
          ...(fotoPath ? { fotoPath } : {}),
        };

        await addSeguimiento(params);
        showNotification('Seguimiento agregado.', 'success');
      }

      setMensaje('');
      setFoto(null);
      setFotoBlob(null);
      setModo('ver');

    } catch (err: any) {
      console.error('[SeguimientoVisitaModal] Error enviando:', err);
      setError('Error al guardar. Verifica tu conexión e intenta nuevamente.');
    } finally {
      setEnviando(false);
    }
  };

  const content = (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 md:p-6 animate-in fade-in duration-200">
      <div className="flex flex-col bg-slate-50 w-full h-[100dvh] md:h-[90vh] md:max-w-4xl md:rounded-[2rem] md:shadow-2xl md:border md:border-white/20 overflow-hidden animate-in slide-in-from-bottom-8 duration-300">
        
        {/* Header */}
        <div className="bg-white px-4 py-3 md:py-4 md:px-6 flex items-center gap-3 shadow-sm border-b shrink-0">
          <button
            onClick={() => modo !== 'ver' ? setModo('ver') : onClose()}
            className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-all"
          >
            {modo !== 'ver' ? <ArrowLeft size={22} /> : <X size={22} />}
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-slate-800 text-base leading-tight truncate">
              {modo === 'resolver' ? 'Resolver visita' : 'Seguimiento de visita'}
            </h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest truncate">
              {visita.sucursalNombre || 'Sucursal'}
            </p>
          </div>
          <span className={`px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shrink-0 ${visita.estado === 'resuelta' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {visita.estado === 'resuelta' ? 'Resuelta' : 'Abierta'}
          </span>
        </div>

        {/* Descripcion de la novedad / visita */}
        <div className="mx-4 md:mx-8 mt-3 md:mt-6 bg-white border border-slate-100 rounded-2xl p-4 md:p-6 shadow-sm shrink-0">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 md:mb-2 md:text-xs">
            Visita de supervisor
          </p>
          <p className="text-sm md:text-base font-bold text-slate-700 leading-relaxed">
            {visita.novedadRelevante?.hay ? `Novedad: ${visita.novedadRelevante.descripcion}` : 'Sin novedad relevante. Motivo: ' + visita.motivo}
          </p>
          <p className="text-[10px] md:text-xs text-slate-400 font-medium mt-1.5 md:mt-2">
            Por {visita.supervisorNombre}
          </p>
        </div>

        {/* HISTORIAL Y FORMULARIO */}
        <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 md:py-6 space-y-4 md:space-y-6">
          {loadingHilo && (
            <div className="flex items-center justify-center py-12 gap-3 text-slate-400">
              <Loader2 size={22} className="animate-spin" />
              <span className="text-sm font-bold">Cargando historial...</span>
            </div>
          )}
          {!loadingHilo && seguimientos.length === 0 && (
            <div className="text-center py-10 text-slate-400">
              <p className="text-sm font-bold">Sin actualizaciones aún</p>
              <p className="text-xs mt-1">Usa los botones de abajo para agregar una.</p>
            </div>
          )}
          {!loadingHilo && seguimientos.map((seg) => {
            const esMio = seg.autorUid === usuario.uid;
            const esResolucion = seg.tipo === 'resolucion';
            const esMsgDeAdmin = ['admin', 'jefe_operaciones', 'rrhh'].includes(seg.autorRol);
            const horaEnvio = formatearHoraMensaje(seg.fechaHora);
            
            return (
              <div key={seg.id} className={`flex flex-col ${esMio ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-3 md:px-5 md:py-4 shadow-sm ${
                  esResolucion
                    ? 'bg-emerald-100 border border-emerald-200'
                    : esMio
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-slate-100'
                }`}>
                  <div className={`flex items-center gap-2 mb-1 ${esMio && !esResolucion ? 'flex-row-reverse' : ''}`}>
                    <p className={`text-[10px] font-black uppercase tracking-widest ${
                      esResolucion ? 'text-emerald-700' : esMio ? 'text-blue-200' : 'text-slate-500'
                    }`}>
                      {esMio ? 'Tú' : seg.autorNombre}
                    </p>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                      esResolucion ? 'bg-emerald-200 text-emerald-800' : esMio ? 'bg-blue-500 text-blue-100' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {ROL_LABEL[seg.autorRol] ?? seg.autorRol}
                    </span>
                    {esResolucion && (
                      <span className="flex items-center gap-1 text-[9px] font-black text-emerald-700">
                        <CheckCircle size={10} /> RESUELTO
                      </span>
                    )}
                  </div>
                  {seg.mensaje && (
                    <p className={`text-sm md:text-base leading-snug whitespace-pre-wrap ${
                      esResolucion ? 'text-emerald-900 font-bold' : esMio ? 'text-white' : 'text-slate-800'
                    }`}>
                      {seg.mensaje}
                    </p>
                  )}
                  {seg.fotoUrl && (
                    <div className="mt-2 rounded-xl overflow-hidden cursor-pointer active:scale-95 transition-transform" onClick={() => setFullScreenImage(seg.fotoUrl!)}>
                      <img src={seg.fotoUrl} alt="Adjunto" className="w-full max-h-48 object-cover bg-black/10" />
                    </div>
                  )}

                  {/* Footer del mensaje: hora de envío y confirmación de lectura SOLO para el Admin */}
                  <div className={`mt-2 pt-1 border-t flex flex-wrap items-center gap-1.5 text-[10px] font-semibold ${
                    esResolucion
                      ? 'border-emerald-200/60 text-emerald-700 justify-start'
                      : esMio
                        ? 'border-blue-500/40 text-blue-200 justify-end'
                        : 'border-slate-100 text-slate-400 justify-start'
                  }`}>
                    {horaEnvio && <span>{horaEnvio}</span>}

                    {/* VISTO / NO VISTO: Estrictamente visible solo para el Admin sobre mensajes enviados por la administración */}
                    {esAdmin && esMsgDeAdmin && (
                      <>
                        <span className="opacity-50">·</span>
                        {seg.leidoPorSupervisor ? (
                          <span
                            className={`inline-flex items-center gap-1 font-bold ${
                              esMio ? 'text-sky-200' : 'text-blue-600'
                            }`}
                            title={seg.leidoPorNombre ? `Visto por ${seg.leidoPorNombre}` : 'Visto por el supervisor'}
                          >
                            <CheckCheck size={13} className={esMio ? 'text-sky-300' : 'text-blue-600'} />
                            <span>Visto {formatearHoraVisto(seg.leidoEn)}</span>
                          </span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 font-medium ${
                              esMio ? 'text-blue-200/80' : 'text-slate-400'
                            }`}
                            title="El supervisor aún no ha abierto este mensaje"
                          >
                            <Check size={12} className={esMio ? 'opacity-80' : 'text-slate-400'} />
                            <span>No visto aún</span>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Panel Inferior (Formulario / Acciones) */}
        {visita.estado !== 'resuelta' && (
          <div className="bg-white border-t p-3 md:p-6 shrink-0 z-10 shadow-[0_-4px_20px_rgba(0,0,0,0.02)]">
            {modo === 'ver' ? (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={mensaje}
                    onChange={(e) => setMensaje(e.target.value)}
                    placeholder="Escribe un mensaje..."
                    className="flex-1 bg-slate-100 rounded-2xl px-4 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none h-12 md:h-14 transition-shadow"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleEnviar('comentario');
                      }
                    }}
                  />
                  <button
                    onClick={() => handleAgregarFoto('camera')}
                    className="h-12 w-12 md:h-14 md:w-14 shrink-0 flex items-center justify-center bg-slate-100 text-slate-600 rounded-2xl hover:bg-slate-200 active:scale-95 transition-all"
                  >
                    <Camera size={20} />
                  </button>
                  <button
                    onClick={() => handleAgregarFoto('gallery')}
                    className="h-12 w-12 md:h-14 md:w-14 shrink-0 flex items-center justify-center bg-slate-100 text-slate-600 rounded-2xl hover:bg-slate-200 active:scale-95 transition-all"
                  >
                    <ImageIcon size={20} />
                  </button>
                  <button
                    onClick={() => handleEnviar('comentario')}
                    disabled={enviando || (!mensaje.trim() && !fotoBlob)}
                    className="h-12 w-12 md:h-14 md:w-14 shrink-0 flex items-center justify-center bg-blue-600 text-white rounded-2xl hover:bg-blue-700 active:scale-95 disabled:opacity-50 transition-all shadow-md shadow-blue-600/20"
                  >
                    {enviando ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} className="-ml-1 mt-0.5" />}
                  </button>
                </div>
                {foto && (
                  <div className="relative inline-block mt-2">
                    <img src={foto} alt="Preview" className="h-20 w-20 object-cover rounded-xl border-2 border-slate-200" />
                    <button onClick={() => { setFoto(null); setFotoBlob(null); }} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md">
                      <X size={14} />
                    </button>
                  </div>
                )}
                {error && <p className="text-red-500 text-xs font-bold px-1 mt-1 flex items-center gap-1"><AlertCircle size={12} /> {error}</p>}
                
                <div className="flex gap-2 mt-2">
                  <button onClick={() => setModo('resolver')} className="flex-1 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform">
                    <CheckCircle size={16} /> RESOLVER
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 animate-in slide-in-from-bottom-2">
                <p className="text-sm font-bold text-slate-800 text-center">¿Estás seguro de resolver esta visita?</p>
                <div className="flex gap-2">
                  <button onClick={() => setModo('ver')} className="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold text-sm active:scale-[0.98]">
                    CANCELAR
                  </button>
                  <button onClick={() => handleEnviar('resolucion')} disabled={enviando} className="flex-1 py-3 rounded-2xl bg-emerald-600 text-white font-black text-sm flex items-center justify-center gap-2 active:scale-[0.98] shadow-lg shadow-emerald-600/20 disabled:opacity-50">
                    {enviando ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />} CONFIRMAR
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Visor imagen fullscreen */}
      {fullScreenImage && (
        <div className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setFullScreenImage(null)}>
          <img src={fullScreenImage} className="max-w-full max-h-full rounded-2xl object-contain animate-in zoom-in-95 duration-200" alt="Vista completa" />
          <button className="absolute top-4 right-4 md:top-8 md:right-8 bg-white/10 text-white p-3 rounded-full hover:bg-white/20 transition-colors backdrop-blur-md">
            <X size={24} />
          </button>
        </div>
      )}
    </div>
  );

  return createPortal(content, document.body);
};

export default VisitaSeguimientoModal;
