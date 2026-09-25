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

  // Modo: 'ver' | 'agregar' | 'resolver'
  const [modo, setModo] = useState<'ver' | 'agregar' | 'resolver'>('ver');
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
    return () => { mounted = false; };
  }, [novedad.id]);

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
    const textoFinal = mensaje.trim();
    if (!textoFinal || textoFinal.length < 5) {
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
    <div className="fixed inset-0 z-[150] flex flex-col bg-slate-50 animate-in slide-in-from-bottom-4 duration-300 h-[100dvh]">
      {/* Header */}
      <div className="bg-white px-4 py-3 flex items-center gap-3 shadow-sm border-b shrink-0">
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
      <div className="mx-4 mt-3 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm shrink-0">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Novedad original</p>
        <p className="text-sm font-bold text-slate-700 leading-relaxed">{novedad.descripcion}</p>
        <p className="text-[10px] text-slate-400 font-medium mt-1.5">
          Por {novedad.autorNombre}
          {novedad.fechaHoraDispositivo ? ` · ${formatSeguimientoFecha(novedad.fechaHoraDispositivo)}` : ''}
        </p>
      </div>

      {/* MODO: VER hilo */}
      {modo === 'ver' && (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
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
            return (
              <div
                key={seg.id}
                className={`flex flex-col ${esMio ? 'items-end' : 'items-start'}`}
              >
                {/* Burbuja */}
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
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
                      {esMio ? 'Tú' : seg.usuarioNombre}
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
          <div ref={bottomRef} />
        </div>
      )}

      {/* MODO: AGREGAR seguimiento */}
      {modo === 'agregar' && (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
              Mensaje de seguimiento *
            </label>
            <textarea
              value={mensaje}
              onChange={e => setMensaje(e.target.value)}
              rows={5}
              placeholder="Describe el estado actual, acciones realizadas o informacion relevante para el proximo turno."
              autoFocus
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
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleAgregarFoto('camera')}
                  className="p-4 bg-white border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center gap-2 active:scale-95 transition-all hover:border-blue-400 hover:bg-blue-50"
                >
                  <Camera size={20} className="text-slate-400" />
                  <span className="text-xs font-bold text-slate-500">Tomar foto</span>
                </button>
                <button
                  onClick={() => handleAgregarFoto('gallery')}
                  className="p-4 bg-white border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center gap-2 active:scale-95 transition-all hover:border-blue-400 hover:bg-blue-50"
                >
                  <ImageIcon size={20} className="text-slate-400" />
                  <span className="text-xs font-bold text-slate-500">Desde galeria</span>
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

      {/* MODO: RESOLVER novedad */}
      {modo === 'resolver' && (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck size={18} className="text-emerald-600" />
              <p className="text-sm font-black text-emerald-800">Resolver novedad</p>
            </div>
            <p className="text-xs text-emerald-700 font-medium leading-relaxed">
              Al resolver, la novedad se marcara como resuelta y desaparecera del listado de pendientes.
              El historial se conserva permanentemente.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
              Nota de resolucion *
            </label>
            <textarea
              value={mensaje}
              onChange={e => setMensaje(e.target.value)}
              rows={5}
              placeholder="Describe como se resolvio la novedad y que acciones se tomaron."
              autoFocus
              className="w-full px-4 py-3 bg-white border-2 border-emerald-300 rounded-2xl focus:border-emerald-500 outline-none transition-all font-medium text-slate-700 placeholder-slate-400 resize-none text-sm"
            />
            <p className={`text-[10px] font-bold px-1 ${mensaje.trim().length < 5 ? 'text-red-400' : 'text-emerald-500'}`}>
              {mensaje.trim().length} caracteres (minimo 5)
            </p>
          </div>

          {/* Foto opcional */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
              Fotografia de cierre (opcional)
            </label>
            {foto ? (
              <div className="relative inline-block">
                <img src={foto} alt="Preview" className="w-32 h-32 object-cover rounded-2xl border-2 border-emerald-200" />
                <button
                  onClick={() => { setFoto(null); setFotoBlob(null); }}
                  className="absolute -top-2 -right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center shadow active:scale-90 transition-all"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleAgregarFoto('camera')}
                  className="p-4 bg-white border-2 border-dashed border-emerald-200 rounded-2xl flex flex-col items-center gap-2 active:scale-95 transition-all"
                >
                  <Camera size={20} className="text-emerald-400" />
                  <span className="text-xs font-bold text-slate-500">Tomar foto</span>
                </button>
                <button
                  onClick={() => handleAgregarFoto('gallery')}
                  className="p-4 bg-white border-2 border-dashed border-emerald-200 rounded-2xl flex flex-col items-center gap-2 active:scale-95 transition-all"
                >
                  <ImageIcon size={20} className="text-emerald-400" />
                  <span className="text-xs font-bold text-slate-500">Desde galeria</span>
                </button>
              </div>
            )}
          </div>

          {/* Confirmacion previa */}
          {!confirmResolucion && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <p className="text-xs text-amber-700 font-bold">
                Confirma que la novedad fue efectivamente resuelta antes de marcarla como tal.
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3 items-start">
              <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm font-bold text-red-700">{error}</p>
            </div>
          )}
        </div>
      )}

      {/* Barra de acciones */}
      <div className="shrink-0 bg-white border-t border-slate-100 shadow-[0_-8px_20px_-5px_rgba(0,0,0,0.08)] px-4 py-4 space-y-2 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
        {/* VER: botones de accion */}
        {modo === 'ver' && (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => { setMensaje(''); setFoto(null); setFotoBlob(null); setError(null); setModo('agregar'); }}
              className="py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-[1.5rem] font-black text-sm uppercase tracking-widest shadow-lg shadow-blue-200 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <Send size={16} />
              Agregar nota
            </button>
            <button
              onClick={() => { setMensaje(''); setFoto(null); setFotoBlob(null); setError(null); setConfirmResolucion(false); setModo('resolver'); }}
              disabled={novedad.estado === 'resuelta'}
              className="py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-[1.5rem] font-black text-sm uppercase tracking-widest shadow-lg shadow-emerald-200 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <CheckCircle size={16} />
              Resolver
            </button>
          </div>
        )}

        {/* AGREGAR: confirmar seguimiento normal */}
        {modo === 'agregar' && (
          <button
            onClick={() => handleEnviar('seguimiento')}
            disabled={enviando || mensaje.trim().length < 5}
            className="w-full py-5 bg-blue-600 hover:bg-blue-700 text-white rounded-[2rem] font-black text-sm uppercase tracking-widest shadow-xl shadow-blue-200 active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {enviando ? (
              <><Loader2 size={20} className="animate-spin" /> Guardando...</>
            ) : (
              <><Send size={20} /> Guardar como pendiente</>
            )}
          </button>
        )}

        {/* RESOLVER: confirmacion doble */}
        {modo === 'resolver' && (
          <>
            {!confirmResolucion ? (
              <button
                onClick={() => setConfirmResolucion(true)}
                disabled={mensaje.trim().length < 5}
                className="w-full py-5 bg-amber-500 hover:bg-amber-600 text-white rounded-[2rem] font-black text-sm uppercase tracking-widest shadow-xl shadow-amber-200 active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <ShieldCheck size={20} />
                Confirmar resolucion
              </button>
            ) : (
              <button
                onClick={() => handleEnviar('resolucion')}
                disabled={enviando || mensaje.trim().length < 5}
                className="w-full py-5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-[2rem] font-black text-sm uppercase tracking-widest shadow-xl shadow-emerald-200 active:scale-95 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {enviando ? (
                  <><Loader2 size={20} className="animate-spin" /> Resolviendo...</>
                ) : (
                  <><CheckCircle size={20} /> Marcar como resuelta</>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : null;
};

export default NovedadSeguimientoModal;
