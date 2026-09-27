/**
 * NovedadSeguimientoModal.tsx
 *
 * Modal principal del seguimiento de una novedad.
 * Muestra el historial completo y permite al guardia agregar
 * actualizaciones o resolver la novedad.
 *
 * FASE 4: componente del guardia. No toca admin view ni reglas.
 */

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
  ShieldCheck,
} from 'lucide-react';
import {
  addSeguimiento,
  getSeguimientos,
  formatSeguimientoFecha,
  SeguimientoBaseParams,
  markSeguimientoAsRead,
} from '../../lib/novedades/seguimientoService';
import { useAppStore } from '../../store/useAppStore';
import type { RegistroNovedad, SeguimientoNovedad, SeguimientoTipo } from '../../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRIORIDAD_COLOR: Record<string, string> = {
  informativa: 'bg-blue-100 text-blue-700',
  media:       'bg-yellow-100 text-yellow-700',
  alta:        'bg-orange-100 text-orange-700',
  critica:     'bg-red-100 text-red-700',
};

const ROL_LABEL: Record<string, string> = {
  worker:           'Guardia',
  admin:            'Admin',
  supervisor:       'Supervisor',
  jefe_operaciones: 'Jefe Ops.',
  rrhh:             'RRHH',
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface NovedadSeguimientoModalProps {
  novedad: RegistroNovedad;
  usuario: { uid: string; nombre: string; rol: string };
  onClose: (resolto?: boolean) => void;
}

// ─── Componente ───────────────────────────────────────────────────────────────

const NovedadSeguimientoModal: React.FC<NovedadSeguimientoModalProps> = ({
  novedad,
  usuario,
  onClose,
}) => {
  const uploadBase64 = useAppStore(state => state.uploadBase64);
  const showNotification = useAppStore(state => state.showNotification);

  const [seguimientos, setSeguimientos] = useState<SeguimientoNovedad[]>([]);
  const [loadingHilo, setLoadingHilo] = useState(true);

  // Modo: 'ver' | 'resolver'
  const [modo, setModo] = useState<'ver' | 'resolver'>('ver');
  const [mensaje, setMensaje] = useState('');
  const [foto, setFoto] = useState<string | null>(null);       // preview base64
  const [fotoBlob, setFotoBlob] = useState<File | null>(null); // para subir
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Confirmacion de resolucion
  const [confirmResolucion, setConfirmResolucion] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Cargar historial de seguimiento al abrir ──────────────────────────────
  useEffect(() => {
    let mounted = true;
    const cargar = async () => {
      setLoadingHilo(true);
      try {
        const result = await getSeguimientos(novedad.id);
        if (mounted) setSeguimientos(result);
      } catch (e) {
        console.error('[SeguimientoModal] Error cargando hilo:', e);
      } finally {
        if (mounted) setLoadingHilo(false);
      }
    };
    cargar();

    // Marcar como leído al abrir
    if (novedad.id && usuario.rol) {
      markSeguimientoAsRead(novedad.id, usuario.rol, usuario.nombre).catch(e => {
        console.error('[SeguimientoModal] Error al marcar como leido:', e);
      });
    }

    return () => { mounted = false; };
  }, [novedad.id, usuario.rol, usuario.nombre]);

  // Scroll al final cuando llegan nuevos mensajes
  useEffect(() => {
    if (!loadingHilo) {
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [seguimientos, loadingHilo]);

  // ── Seleccionar foto ──────────────────────────────────────────────────────
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

  // ── Enviar seguimiento (normal o resolucion) ──────────────────────────────
  const handleEnviar = async (tipo: SeguimientoTipo) => {
    let textoFinal = mensaje.trim();
    if (tipo === 'resolucion' && !textoFinal) {
      textoFinal = 'Resuelto';
    } else if (!textoFinal || textoFinal.length < 5) {
      setError('El mensaje debe tener al menos 5 caracteres.');
      return;
    }
    if (enviando) return;
    setEnviando(true);
    setError(null);

    try {
      let fotoUrl: string | undefined;
      let fotoPath: string | undefined;

      // Subir foto si existe
      if (foto && fotoBlob) {
        const ext = fotoBlob.type.includes('webp') ? 'webp' : 'jpg';
        fotoPath = `seguimientos/${novedad.id}/${Date.now()}_${usuario.uid}.${ext}`;
        fotoUrl = await uploadBase64(foto, fotoPath);
      }

      const params: SeguimientoBaseParams = {
        novedadId: novedad.id,
        usuarioId: usuario.uid,
        usuarioNombre: usuario.nombre,
        rol: usuario.rol,
        mensaje: textoFinal,
        ...(fotoUrl ? { fotoUrl } : {}),
        ...(fotoPath ? { fotoPath } : {}),
      };

      await addSeguimiento(params, tipo);

      // Agregar al hilo local para feedback inmediato
      const nuevoMensaje: SeguimientoNovedad = {
        id: `local_${Date.now()}`,
        novedadId: novedad.id,
        usuarioId: usuario.uid,
        usuarioNombre: usuario.nombre,
        rol: usuario.rol,
        mensaje: textoFinal,
        tipo,
        fecha: null,
        fechaStr: new Date().toISOString(),
        ...(fotoUrl ? { fotoUrl } : {}),
      };
      setSeguimientos(prev => [...prev, nuevoMensaje]);

      setMensaje('');
      setFoto(null);
      setFotoBlob(null);
      setModo('ver');
      setConfirmResolucion(false);

      if (tipo === 'resolucion') {
        showNotification('Novedad marcada como resuelta.', 'success');
        onClose(true); // true = fue resuelta
      } else {
        showNotification('Seguimiento agregado.', 'success');
      }
    } catch (err: any) {
      console.error('[SeguimientoModal] Error enviando:', err);
      setError('Error al guardar. Verifica tu conexion e intenta nuevamente.');
    } finally {
      setEnviando(false);
    }
  };

  // ── Contenido del modal ───────────────────────────────────────────────────
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
            {modo === 'resolver' ? 'Resolver novedad' : 'Seguimiento'}
          </h2>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest truncate">
            {novedad.sucursalNombre || 'Sucursal'}
          </p>
        </div>
        {/* Badge prioridad */}
        <span className={`px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest shrink-0 ${PRIORIDAD_COLOR[novedad.prioridad] ?? 'bg-slate-100 text-slate-600'}`}>
          {novedad.prioridad}
        </span>
      </div>

      {/* Descripcion de la novedad */}
      <div className="mx-4 md:mx-8 mt-3 md:mt-6 bg-white border border-slate-100 rounded-2xl p-4 md:p-6 shadow-sm shrink-0">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 md:mb-2 md:text-xs">Novedad original</p>
        <p className="text-sm md:text-base font-bold text-slate-700 leading-relaxed">{novedad.descripcion}</p>
        <p className="text-[10px] md:text-xs text-slate-400 font-medium mt-1.5 md:mt-2">
          Por {novedad.autorNombre}
          {novedad.fechaHoraDispositivo ? ` · ${formatSeguimientoFecha(novedad.fechaHoraDispositivo)}` : ''}
        </p>
      </div>

      {/* HISTORIAL Y FORMULARIO (Siempre visible en el fondo) */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 md:py-6 space-y-4 md:space-y-6">
          {loadingHilo && (
            <div className="flex items-center justify-center py-12 gap-3 text-slate-400">
              <Loader2 size={22} className="animate-spin" />
              <span className="text-sm font-bold">Cargando historial...</span>
            </div>
          )}
          {!loadingHilo && seguimientos.length === 0 && (
            <div className="text-center py-10 text-slate-400">
              <p className="text-sm font-bold">Sin actualizaciones aun</p>
              <p className="text-xs mt-1">Usa los botones de abajo para agregar una.</p>
            </div>
          )}
          {!loadingHilo && seguimientos.map((seg) => {
            const esMio = seg.usuarioId === usuario.uid;
            const esResolucion = seg.tipo === 'resolucion';
            const isAdminMsg = ['admin', 'supervisor', 'jefe_operaciones'].includes(seg.rol);
            const isCurrentUserAdmin = ['admin', 'supervisor', 'jefe_operaciones'].includes(usuario.rol);
            
            // Si el mensaje es de un admin y el que lee NO es admin, ocultamos su nombre.
            const displayNombre = (isAdminMsg && !isCurrentUserAdmin) 
              ? 'Admin-Aspro' 
              : (esMio ? 'Tú' : seg.usuarioNombre);

            return (
              <div
                key={seg.id}
                className={`flex flex-col ${esMio ? 'items-end' : 'items-start'}`}
              >
                {/* Burbuja */}
                <div className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-3 md:px-5 md:py-4 shadow-sm ${
                  esResolucion
                    ? 'bg-emerald-100 border border-emerald-200'
                    : esMio
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-slate-100'
                }`}>
                  {/* Autor + rol */}
                  <div className={`flex items-center gap-2 mb-1 ${esMio && !esResolucion ? 'flex-row-reverse' : ''}`}>
                    <p className={`text-[10px] font-black uppercase tracking-widest ${
                      esResolucion ? 'text-emerald-700' : esMio ? 'text-blue-200' : 'text-slate-500'
                    }`}>
                      {displayNombre}
                    </p>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                      esResolucion ? 'bg-emerald-200 text-emerald-800' : esMio ? 'bg-blue-500 text-blue-100' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {ROL_LABEL[seg.rol] ?? seg.rol}
                    </span>
                    {esResolucion && (
                      <span className="flex items-center gap-1 text-[9px] font-black text-emerald-700">
                        <CheckCircle size={10} /> Resuelta
                      </span>
                    )}
                  </div>

                  {/* Mensaje */}
                  <p className={`text-sm font-medium leading-relaxed ${
                    esResolucion ? 'text-emerald-900' : esMio ? 'text-white' : 'text-slate-700'
                  }`}>
                    {seg.mensaje}
                  </p>

                  {/* Foto del seguimiento */}
                  {seg.fotoUrl && (
                    <img
                      src={seg.fotoUrl}
                      alt="Evidencia"
                      className="mt-2 w-full max-h-48 object-cover rounded-xl border border-white/20"
                    />
                  )}

                  {/* Fecha */}
                  <p className={`text-[9px] mt-1.5 font-bold ${
                    esResolucion ? 'text-emerald-600' : esMio ? 'text-blue-200' : 'text-slate-400'
                  }`}>
                    {formatSeguimientoFecha(seg.fecha ?? seg.fechaStr)}
                  </p>
                </div>
              </div>
            );
          })}
          
          {/* Indicador de lectura (solo admin lo ve, indicando si el guardia lo leyó) */}
          {['admin', 'supervisor', 'jefe_operaciones'].includes(usuario.rol) && novedad.readByWorkerEn && seguimientos.length > 0 && (
            <div className="flex justify-end pr-1 mt-1">
              <p className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                <CheckCircle size={10} className="text-blue-500" />
                Visto por {novedad.readByWorkerPor || 'Guardia'} a las {formatSeguimientoFecha(novedad.readByWorkerEn)}
              </p>
            </div>
          )}

          <div ref={bottomRef} />

          {novedad.estado !== 'resuelta' && (
            <div className="pt-4 border-t border-slate-100 mt-6 space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                  Mensaje de seguimiento *
                </label>
                <textarea
                  value={mensaje}
                  onChange={e => setMensaje(e.target.value)}
                  rows={4}
                  placeholder="Describe el estado actual, acciones realizadas o informacion relevante para el proximo turno."
                  className="w-full px-4 py-3 bg-white border-2 border-slate-200 rounded-2xl focus:border-blue-500 outline-none transition-all font-medium text-slate-700 placeholder-slate-400 resize-none text-sm"
                />
                <p className={`text-[10px] font-bold px-1 ${mensaje.trim().length < 5 ? 'text-red-400' : 'text-emerald-500'}`}>
                  {mensaje.trim().length} caracteres (minimo 5)
                </p>
              </div>

              {/* Foto opcional */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                  Fotografia opcional
                </label>
                {foto ? (
                  <div className="relative inline-block">
                    <img src={foto} alt="Preview" className="w-32 h-32 object-cover rounded-2xl border-2 border-slate-200" />
                    <button
                      onClick={() => { setFoto(null); setFotoBlob(null); }}
                      className="absolute -top-2 -right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center shadow active:scale-90 transition-all"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleAgregarFoto('camera')}
                      className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2 active:scale-95 transition-all hover:bg-slate-100 text-slate-600"
                    >
                      <Camera size={16} />
                      <span className="text-xs font-bold">Camara</span>
                    </button>
                    <button
                      onClick={() => handleAgregarFoto('gallery')}
                      className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2 active:scale-95 transition-all hover:bg-slate-100 text-slate-600"
                    >
                      <ImageIcon size={16} />
                      <span className="text-xs font-bold">Galeria</span>
                    </button>
                  </div>
                )}
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3 items-start">
                  <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm font-bold text-red-700">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

      {/* OVERLAY: MODAL DE RESOLUCIÓN */}
      {modo === 'resolver' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200 p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-200">
            
            <div className="flex items-center gap-3 text-emerald-600">
              <ShieldCheck size={28} />
              <h3 className="text-lg font-black text-slate-800">¿Marcar resuelto?</h3>
            </div>
            
            <p className="text-sm text-slate-600 font-medium">
              Esta acción cerrará la novedad y la quitará de pendientes.
            </p>

            <div className="space-y-2 mt-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                Nota de cierre (Opcional)
              </label>
              <textarea
                value={mensaje}
                onChange={e => setMensaje(e.target.value)}
                rows={3}
                placeholder="Si lo dejas vacío, se registrará como 'Resuelto'."
                autoFocus
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:border-emerald-500 outline-none transition-all font-medium text-slate-700 placeholder-slate-400 resize-none text-sm"
              />
            </div>

            {/* Foto opcional */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                Evidencia (Opcional)
              </label>
              {foto ? (
                <div className="relative inline-block">
                  <img src={foto} alt="Preview" className="w-24 h-24 object-cover rounded-2xl border-2 border-emerald-200" />
                  <button
                    onClick={() => { setFoto(null); setFotoBlob(null); }}
                    className="absolute -top-2 -right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center shadow active:scale-90 transition-all"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAgregarFoto('camera')}
                    className="flex-1 py-2 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-emerald-50 hover:text-emerald-700 text-slate-600"
                  >
                    <Camera size={16} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Cámara</span>
                  </button>
                  <button
                    onClick={() => handleAgregarFoto('gallery')}
                    className="flex-1 py-2 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-emerald-50 hover:text-emerald-700 text-slate-600"
                  >
                    <ImageIcon size={16} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Galería</span>
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-3 flex gap-3 items-start">
                <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs font-bold text-red-700">{error}</p>
              </div>
            )}

            <div className="flex gap-3 mt-4">
              <button
                onClick={() => { setModo('ver'); setError(null); }}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-black text-xs uppercase tracking-widest active:scale-95 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleEnviar('resolucion')}
                disabled={enviando}
                className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-emerald-200 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
              >
                {enviando ? <Loader2 size={16} className="animate-spin" /> : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barra de acciones PRINCIPAL */}
      <div className="shrink-0 bg-white border-t border-slate-100 shadow-[0_-8px_20px_-5px_rgba(0,0,0,0.08)] px-4 py-4 md:px-8 md:py-6 space-y-2 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] relative z-0">
        <div className="grid grid-cols-2 gap-3 md:gap-6">
            <button
              onClick={() => handleEnviar('seguimiento')}
              disabled={enviando || mensaje.trim().length < 5 || novedad.estado === 'resuelta'}
              className="py-4 md:py-5 bg-blue-600 hover:bg-blue-700 text-white rounded-[1.5rem] md:rounded-[2rem] font-black text-sm md:text-base uppercase tracking-widest shadow-lg shadow-blue-200 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {enviando ? (
                <><Loader2 size={18} className="animate-spin" /> Enviando...</>
              ) : (
                <><Send size={18} /> Enviar Nota</>
              )}
            </button>
            <button
              onClick={() => { setError(null); setConfirmResolucion(false); setModo('resolver'); }}
              disabled={novedad.estado === 'resuelta'}
              className="py-4 md:py-5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-[1.5rem] md:rounded-[2rem] font-black text-sm md:text-base uppercase tracking-widest shadow-lg shadow-emerald-200 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <CheckCircle size={18} />
              Resolver
            </button>
        </div>
      </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : null;
};

export default NovedadSeguimientoModal;
