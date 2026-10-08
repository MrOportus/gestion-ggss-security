import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  MapPin,
  RefreshCw,
  Trash2,
  AlertCircle,
  ArrowLeft,
  Send,
  Pencil,
  Plus,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import {
  AmbitoFoto,
  EstadoCargo,
  PrioridadNovedad,
  VisitaDraft,
  FotoVisitaLocal,
} from '../../lib/visitasSupervisor/visitasTypes';
import {
  ESTADO_CARGO_EMOJI,
  ESTADO_CARGO_LABEL,
  PRIORIDAD_LABEL,
  RESULTADO_LABEL,
  calcularResultado,
  resumenCargos,
  validarBorrador,
  ErrorValidacion,
} from '../../lib/visitasSupervisor/visitasLogic';
import { obtenerUbicacionVisita, procesarFotoVisita } from '../../lib/visitasSupervisor/visitasService';
import { ResultadoBadge, SiNoButtons, formatearHora } from './visitasUi';

type DraftUpdater = (fn: (d: VisitaDraft) => VisitaDraft) => void;

interface Props {
  draft: VisitaDraft;
  supervisorNombre: string;
  updateDraft: DraftUpdater;
  onSubmit: () => Promise<void>;
  onExit: () => void; // volver (el borrador queda guardado)
}

// ─── Piezas internas ──────────────────────────────────────────────────────────

const Card: React.FC<{ n: number; title: string; id?: string; error?: boolean; children: React.ReactNode }> = ({ n, title, id, error, children }) => (
  <section id={id} className={`bg-white rounded-3xl border-4 p-4 space-y-4 shadow-sm ${error ? 'border-red-400' : 'border-slate-200'}`}>
    <h2 className="flex items-center gap-3 text-xl font-black text-slate-900 leading-tight">
      <span className="shrink-0 w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center text-base">{n}</span>
      {title}
    </h2>
    {children}
  </section>
);

const Pregunta: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-lg font-bold text-slate-800">{children}</p>
);

const inputClass =
  'w-full rounded-2xl border-4 border-slate-300 focus:border-blue-600 focus:outline-none bg-white px-4 py-3 text-lg font-semibold text-slate-900 placeholder:text-slate-400';

const Campo: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block space-y-1.5">
    <span className="text-base font-black text-slate-700">{label}</span>
    {children}
  </label>
);

/** Abre cámara o galería con el mismo mecanismo (input file) que usa IncidenciasPage */
function seleccionarArchivos(opts: { camara: boolean; multiple: boolean }): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (opts.camara) input.capture = 'environment';
    if (opts.multiple) input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    // Si el usuario cancela, el evento 'cancel' resuelve vacío
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

// ─── Componente principal ─────────────────────────────────────────────────────

const FormularioVisita: React.FC<Props> = ({ draft, supervisorNombre, updateDraft, onSubmit, onExit }) => {
  const showConfirmation = useAppStore(s => s.showConfirmation);
  const showNotification = useAppStore(s => s.showNotification);

  const [verificandoGps, setVerificandoGps] = useState(false);
  const [procesandoFoto, setProcesandoFoto] = useState(false);
  const [errores, setErrores] = useState<ErrorValidacion[]>([]);
  const [verResumen, setVerResumen] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [nuevoCargo, setNuevoCargo] = useState('');
  const gpsEnCurso = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);

  // ── Ubicación: se verifica al iniciar; no bloquea nunca ─────────────────
  const verificarUbicacion = useCallback(async () => {
    if (gpsEnCurso.current) return;
    gpsEnCurso.current = true;
    setVerificandoGps(true);
    updateDraft(d => ({ ...d, ubicacion: null }));
    const ubic = await obtenerUbicacionVisita();
    updateDraft(d => ({ ...d, ubicacion: ubic }));
    setVerificandoGps(false);
    gpsEnCurso.current = false;
  }, [updateDraft]);

  useEffect(() => {
    if (draft.ubicacion === null) verificarUbicacion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fotos ───────────────────────────────────────────────────────────────
  const agregarFotos = async (ambito: AmbitoFoto, camara: boolean) => {
    if (procesandoFoto) return;
    try {
      const archivos = await seleccionarArchivos({ camara, multiple: !camara });
      if (archivos.length === 0) return;
      setProcesandoFoto(true);
      const nuevas: FotoVisitaLocal[] = [];
      for (const f of archivos) nuevas.push(await procesarFotoVisita(f, draft.visitId, ambito));
      updateDraft(d => ({ ...d, fotos: [...d.fotos, ...nuevas] }));
    } catch (e) {
      console.warn('[Visitas] Error con fotografía:', e);
      showNotification('No se pudo obtener la fotografía. Intente de nuevo.', 'error');
    } finally {
      setProcesandoFoto(false);
    }
  };

  const quitarFoto = (id: string) => {
    showConfirmation({
      title: 'Quitar fotografía',
      message: '¿Desea quitar esta fotografía? Podrá tomar otra.',
      type: 'confirm',
      onConfirm: () => updateDraft(d => ({ ...d, fotos: d.fotos.filter(f => f.id !== id) })),
    });
  };

  // ── Checklist ───────────────────────────────────────────────────────────
  const setEstado = (id: string, estado: EstadoCargo) =>
    updateDraft(d => ({
      ...d,
      checklist: { ...d.checklist, items: d.checklist.items.map(i => (i.id === id ? { ...i, estado } : i)) },
    }));
  const setNota = (id: string, nota: string) =>
    updateDraft(d => ({
      ...d,
      checklist: { ...d.checklist, items: d.checklist.items.map(i => (i.id === id ? { ...i, nota } : i)) },
    }));
  const todoOk = () =>
    updateDraft(d => ({
      ...d,
      checklist: { ...d.checklist, items: d.checklist.items.map(i => ({ ...i, estado: i.estado ?? 'ok' })) },
    }));

  const agregarCargoPersonalizado = () => {
    if (!nuevoCargo.trim()) return;
    updateDraft(d => ({
      ...d,
      checklist: {
        ...d.checklist,
        items: [
          ...d.checklist.items,
          { id: `custom_${Date.now()}`, label: nuevoCargo.trim(), estado: null }
        ]
      }
    }));
    setNuevoCargo('');
  };

  // ── Envío ───────────────────────────────────────────────────────────────
  const revisar = () => {
    const errs = validarBorrador(draft);
    setErrores(errs);
    if (errs.length > 0) {
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setVerResumen(true);
  };

  const confirmarEnvio = async () => {
    if (enviando) return;
    setEnviando(true);
    try {
      await onSubmit();
    } catch (e) {
      console.error('[Visitas] Error guardando visita:', e);
      showNotification('No se pudo guardar la visita. Intente nuevamente.', 'error');
      setEnviando(false);
    }
  };

  const cancelar = () => {
    showConfirmation({
      title: 'Salir de la visita',
      message: 'Lo que ya completó queda guardado en este teléfono. Podrá continuar después desde el inicio.',
      type: 'confirm',
      onConfirm: onExit,
    });
  };

  const resultado = calcularResultado(draft);
  const cargos = resumenCargos(draft);
  const fotosVisita = draft.fotos.filter(f => f.ambito === 'visita');
  const fotosObs = draft.fotos.filter(f => f.ambito === 'observacion');
  const errSec = (s: ErrorValidacion['seccion']) => errores.some(e => e.seccion === s);
  const e = draft.entrevista;

  const BotonFoto: React.FC<{ ambito: AmbitoFoto; texto: string; principal?: boolean }> = ({ ambito, texto, principal }) => (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => agregarFotos(ambito, true)}
        disabled={procesandoFoto}
        className={`w-full rounded-2xl font-black flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-60 ${
          principal ? 'min-h-[76px] text-xl bg-blue-700 text-white shadow-lg' : 'min-h-[64px] text-lg bg-blue-50 border-4 border-blue-700 text-blue-900'
        }`}
      >
        {procesandoFoto ? <Loader2 className="animate-spin" size={28} /> : <Camera size={30} aria-hidden />}
        {procesandoFoto ? 'PROCESANDO…' : texto}
      </button>
      <button
        type="button"
        onClick={() => agregarFotos(ambito, false)}
        disabled={procesandoFoto}
        className="w-full min-h-[52px] rounded-2xl border-2 border-slate-300 text-base font-bold text-slate-700 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-60"
      >
        <ImageIcon size={20} aria-hidden /> Elegir de la galería
      </button>
    </div>
  );

  const Miniaturas: React.FC<{ fotos: typeof draft.fotos }> = ({ fotos }) =>
    fotos.length === 0 ? null : (
      <div className="grid grid-cols-3 gap-3">
        {fotos.map(f => (
          <div key={f.id} className="space-y-1">
            <div className="aspect-square rounded-xl overflow-hidden border-2 border-slate-300 bg-slate-100">
              <img src={f.dataUrl} alt="Miniatura de fotografía" className="w-full h-full object-cover" />
            </div>
            <button
              type="button"
              onClick={() => quitarFoto(f.id)}
              className="w-full min-h-[44px] rounded-xl bg-red-50 border-2 border-red-300 text-red-800 text-sm font-black flex items-center justify-center gap-1 active:scale-95"
            >
              <Trash2 size={16} aria-hidden /> QUITAR
            </button>
          </div>
        ))}
      </div>
    );

  return (
    <div className="min-h-full bg-slate-100 pb-40">
      <div ref={topRef} />

      {/* Encabezado */}
      <header className="sticky top-0 z-30 bg-white border-b-4 border-slate-200 px-4 py-3 flex items-center gap-3">
        <button onClick={cancelar} aria-label="Volver" className="shrink-0 w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center active:scale-95">
          <ArrowLeft size={28} />
        </button>
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-slate-500">Nueva visita</p>
          <h1 className="text-xl font-black text-slate-900 leading-tight truncate">{draft.sucursalNombre}</h1>
          <p className="text-sm font-semibold text-slate-600">Inicio {formatearHora(draft.inicioEn)}</p>
        </div>
      </header>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* Errores de validación */}
        {errores.length > 0 && (
          <div role="alert" className="bg-red-50 border-4 border-red-400 rounded-3xl p-4 space-y-2">
            <p className="flex items-center gap-2 text-lg font-black text-red-900"><AlertCircle size={24} /> Falta completar:</p>
            <ul className="list-disc pl-6 space-y-1 text-base font-bold text-red-900">
              {errores.map((er, i) => <li key={i}>{er.mensaje}</li>)}
            </ul>
          </div>
        )}

        {/* Estado de ubicación */}
        {verificandoGps || draft.ubicacion === null ? (
          <div className="flex items-center gap-3 rounded-3xl border-4 border-blue-300 bg-blue-50 p-4 text-lg font-black text-blue-900">
            <Loader2 className="animate-spin shrink-0" size={28} /> Verificando ubicación...
          </div>
        ) : draft.ubicacion.estado === 'verificada' ? (
          <div className="flex items-center gap-3 rounded-3xl border-4 border-emerald-400 bg-emerald-50 p-4 text-lg font-black text-emerald-900">
            <CheckCircle2 className="shrink-0" size={28} /> <span>🟢 Ubicación verificada</span>
          </div>
        ) : (
          <div className="rounded-3xl border-4 border-amber-400 bg-amber-50 p-4 space-y-3">
            <p className="flex items-center gap-3 text-lg font-black text-amber-900">
              <MapPin className="shrink-0" size={28} /> <span>🟠 No fue posible verificar ubicación</span>
            </p>
            <p className="text-base font-semibold text-amber-900">
              {draft.ubicacion.motivo === 'permiso_denegado'
                ? 'Active el permiso de ubicación del teléfono. Puede continuar la visita igualmente.'
                : 'Revise que el GPS esté encendido. Puede continuar la visita igualmente.'}
            </p>
            <button onClick={verificarUbicacion} className="w-full min-h-[56px] rounded-2xl bg-amber-500 text-white text-lg font-black flex items-center justify-center gap-2 active:scale-95">
              <RefreshCw size={22} /> REINTENTAR UBICACIÓN
            </button>
          </div>
        )}

        {/* 1. Datos iniciales */}
        <Card n={1} title="Datos de la visita" error={errSec('cargos')}>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="motivoVisita" className="block text-lg font-black text-slate-900">1. Motivo de visita</label>
              <select
                id="motivoVisita"
                value={draft.motivo}
                onChange={e => updateDraft(d => ({ ...d, motivo: e.target.value as any }))}
                className="w-full min-h-[56px] px-4 rounded-xl border-4 border-slate-300 text-lg font-semibold bg-white"
              >
                <option value="">Seleccione un motivo...</option>
                <option value="Visita No Programada">Visita No Programada</option>
                <option value="Visita Programada">Visita Programada</option>
                <option value="Otro">Otro</option>
              </select>
              {draft.motivo === 'Otro' && (
                <input
                  type="text"
                  placeholder="Especifique el motivo..."
                  value={draft.motivoOtro || ''}
                  onChange={e => updateDraft(d => ({ ...d, motivoOtro: e.target.value }))}
                  className="w-full min-h-[56px] px-4 rounded-xl border-4 border-slate-300 text-lg font-semibold"
                />
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="guardiasDeTurno" className="block text-lg font-black text-slate-900">2. Guardia(s) de turno</label>
              <input
                id="guardiasDeTurno"
                type="text"
                placeholder="Escriba el o los nombres..."
                value={draft.guardiasDeTurno}
                onChange={e => updateDraft(d => ({ ...d, guardiasDeTurno: e.target.value }))}
                className="w-full min-h-[56px] px-4 rounded-xl border-4 border-slate-300 text-lg font-semibold"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-lg font-black text-slate-900">3. Estado de Guardia(s): ¿EPP completo?</label>
              <SiNoButtons
                value={draft.epp.completo}
                onChange={v => updateDraft(d => ({ ...d, epp: { ...d.epp, completo: v } }))}
                idPrefix="epp-comp"
              />
              {draft.epp.completo === false && (
                <textarea
                  placeholder="Indique qué le falta y por qué..."
                  value={draft.epp.detalleFaltante}
                  onChange={e => updateDraft(d => ({ ...d, epp: { ...d.epp, detalleFaltante: e.target.value } }))}
                  rows={2}
                  className="w-full p-4 rounded-xl border-4 border-slate-300 text-lg font-semibold mt-2"
                />
              )}
            </div>
          </div>
        </Card>

        {/* 2. Fotografías */}
        <Card n={2} title="Fotografías de la visita">
          <BotonFoto ambito="visita" texto="📷 AGREGAR FOTOGRAFÍAS" principal />
          <p className="text-xl font-black text-slate-900">Fotografías: {fotosVisita.length}</p>
          <Miniaturas fotos={fotosVisita} />
        </Card>

        {/* 3. Cargos fijos */}
        <Card n={3} title="Cargos fijos" id="sec-cargos" error={errSec('cargos')}>
          <button
            type="button"
            onClick={todoOk}
            className="w-full min-h-[60px] rounded-2xl bg-emerald-600 text-white text-lg font-black flex items-center justify-center gap-2 active:scale-95 shadow"
          >
            <CheckCircle2 size={26} aria-hidden /> 🟢 MARCAR TODO OK
          </button>
          <p className="text-sm font-semibold text-slate-600 -mt-1">Luego cambie solo los que tengan problema.</p>
          <ul className="space-y-4">
            {draft.checklist.items.map(item => (
              <li key={item.id} className={`rounded-2xl border-4 p-3 space-y-3 ${item.estado === null && errSec('cargos') ? 'border-red-400' : 'border-slate-200'}`}>
                <p className="text-xl font-black text-slate-900">{item.label}</p>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={item.label}>
                  {(['ok', 'observacion', 'faltante'] as EstadoCargo[]).map(est => {
                    const activo = item.estado === est;
                    const colores =
                      est === 'ok'
                        ? 'bg-emerald-600 border-emerald-800'
                        : est === 'observacion'
                        ? 'bg-amber-500 border-amber-700'
                        : 'bg-red-600 border-red-800';
                    return (
                      <button
                        key={est}
                        type="button"
                        role="radio"
                        aria-checked={activo}
                        id={`cargo-${item.id}-${est}`}
                        onClick={() => setEstado(item.id, est)}
                        className={`min-h-[72px] rounded-2xl border-4 px-1 flex flex-col items-center justify-center gap-0.5 text-[13px] sm:text-sm font-black leading-tight active:scale-95 transition-all ${
                          activo ? `${colores} text-white shadow-lg` : 'bg-white border-slate-300 text-slate-700'
                        }`}
                      >
                        <span className="text-2xl" aria-hidden>{ESTADO_CARGO_EMOJI[est]}</span>
                        {ESTADO_CARGO_LABEL[est]}
                      </button>
                    );
                  })}
                </div>
                {(item.estado === 'observacion' || item.estado === 'faltante') && (
                  <input
                    type="text"
                    value={item.nota ?? ''}
                    onChange={ev => setNota(item.id, ev.target.value)}
                    placeholder="Detalle (opcional)"
                    className={inputClass}
                    aria-label={`Detalle de ${item.label}`}
                  />
                )}
              </li>
            ))}
          </ul>
          <div className="flex gap-2 items-center mt-2">
            <input
              type="text"
              value={nuevoCargo}
              onChange={e => setNuevoCargo(e.target.value)}
              placeholder="Otro cargo (ej. Extintores)"
              className={`${inputClass} !py-2`}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  agregarCargoPersonalizado();
                }
              }}
            />
            <button
              type="button"
              onClick={agregarCargoPersonalizado}
              disabled={!nuevoCargo.trim()}
              className="bg-blue-600 text-white font-bold h-[48px] px-4 rounded-xl disabled:opacity-50 flex items-center justify-center shrink-0 active:scale-95 transition-all"
            >
              <Plus size={20} />
            </button>
          </div>
        </Card>

        {/* 4. Mandante */}
        <Card n={4} title="Entrevista con mandante" id="sec-mandante" error={errSec('mandante')}>
          <Pregunta>¿Se entrevistó con el mandante?</Pregunta>
          <SiNoButtons
            idPrefix="mandante"
            value={e.realizada}
            labelSi="SÍ, SE ENTREVISTÓ"
            labelNo="NO SE ENTREVISTÓ"
            onChange={v => updateDraft(d => ({ ...d, entrevista: { ...d.entrevista, realizada: v } }))}
          />
          {e.realizada === true && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <Campo label="Nombre del mandante">
                <input
                  type="text"
                  value={e.nombre}
                  onChange={ev => updateDraft(d => ({ ...d, entrevista: { ...d.entrevista, nombre: ev.target.value } }))}
                  className={inputClass}
                  autoComplete="off"
                />
              </Campo>
              <Campo label="Resumen de los puntos tratados">
                <textarea
                  rows={4}
                  value={e.resumen}
                  onChange={ev => updateDraft(d => ({ ...d, entrevista: { ...d.entrevista, resumen: ev.target.value } }))}
                  className={inputClass}
                />
              </Campo>
              <Pregunta>¿Quedó algún compromiso o acuerdo?</Pregunta>
              <SiNoButtons
                idPrefix="compromiso"
                value={e.compromiso}
                onChange={v => updateDraft(d => ({ ...d, entrevista: { ...d.entrevista, compromiso: v } }))}
              />
              {e.compromiso === true && (
                <Campo label="Compromiso / acuerdo">
                  <textarea
                    rows={3}
                    value={e.compromisoTexto}
                    onChange={ev => updateDraft(d => ({ ...d, entrevista: { ...d.entrevista, compromisoTexto: ev.target.value } }))}
                    className={inputClass}
                  />
                </Campo>
              )}
            </div>
          )}
        </Card>

        {/* 5. Observaciones */}
        <Card n={5} title="Observaciones" id="sec-observaciones" error={errSec('observaciones')}>
          <Pregunta>¿Hay observaciones?</Pregunta>
          <SiNoButtons
            idPrefix="obs"
            value={draft.observaciones.hay}
            onChange={v => updateDraft(d => ({ ...d, observaciones: { ...d.observaciones, hay: v } }))}
          />
          {draft.observaciones.hay === true && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <Campo label="Observación">
                <textarea
                  rows={4}
                  value={draft.observaciones.texto}
                  onChange={ev => updateDraft(d => ({ ...d, observaciones: { ...d.observaciones, texto: ev.target.value } }))}
                  className={inputClass}
                />
              </Campo>
              <BotonFoto ambito="observacion" texto="📷 Agregar fotografía" />
              {fotosObs.length > 0 && <p className="text-lg font-black text-slate-900">Fotografías de la observación: {fotosObs.length}</p>}
              <Miniaturas fotos={fotosObs} />
            </div>
          )}
        </Card>

        {/* 6. Novedad relevante */}
        <Card n={6} title="Novedad relevante" id="sec-novedad" error={errSec('novedad')}>
          <Pregunta>¿Existe una novedad relevante que mencionar?</Pregunta>
          <SiNoButtons
            idPrefix="novedad"
            value={draft.novedad.hay}
            onChange={v => updateDraft(d => ({ ...d, novedad: { ...d.novedad, hay: v } }))}
          />
          {draft.novedad.hay === true && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <Campo label="Descripción de la novedad">
                <textarea
                  rows={4}
                  value={draft.novedad.descripcion}
                  onChange={ev => updateDraft(d => ({ ...d, novedad: { ...d.novedad, descripcion: ev.target.value } }))}
                  className={inputClass}
                />
              </Campo>
              <p className="text-base font-black text-slate-700">Prioridad</p>
              <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label="Prioridad">
                {(['informativa', 'requiere_atencion', 'urgente'] as PrioridadNovedad[]).map(p => {
                  const activo = draft.novedad.prioridad === p;
                  const cfg =
                    p === 'informativa'
                      ? { emoji: '🔵', on: 'bg-blue-600 border-blue-800' }
                      : p === 'requiere_atencion'
                      ? { emoji: '🟠', on: 'bg-amber-500 border-amber-700' }
                      : { emoji: '🔴', on: 'bg-red-600 border-red-800' };
                  return (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={activo}
                      id={`prioridad-${p}`}
                      onClick={() => updateDraft(d => ({ ...d, novedad: { ...d.novedad, prioridad: p } }))}
                      className={`min-h-[64px] rounded-2xl border-4 px-4 flex items-center gap-3 text-lg font-black active:scale-95 transition-all ${
                        activo ? `${cfg.on} text-white shadow-lg` : 'bg-white border-slate-300 text-slate-700'
                      }`}
                    >
                      <span className="text-2xl" aria-hidden>{cfg.emoji}</span>
                      {PRIORIDAD_LABEL[p]}
                      {activo && <CheckCircle2 className="ml-auto" size={26} aria-hidden />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        {/* 7. Resumen Ejecutivo de Visita */}
        <Card n={7} title="Resumen Ejecutivo de Visita" id="sec-nota" error={errSec('nota' as any)}>
          <Campo label="Obligatorio">
            <textarea
              rows={4}
              value={draft.nota}
              onChange={ev => updateDraft(d => ({ ...d, nota: ev.target.value }))}
              placeholder="Escriba un resumen de su visita.."
              className={inputClass}
            />
          </Campo>
        </Card>
      </div>

      {/* Barra inferior fija */}
      <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t-4 border-slate-200 p-3 space-y-2 md:left-64">
        <div className="max-w-2xl mx-auto space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-black uppercase text-slate-500">Resultado</span>
            <ResultadoBadge resultado={resultado} prioridadNovedad={draft.novedad?.prioridad} />
          </div>
          <button
            id="visita-revisar"
            onClick={revisar}
            className="w-full min-h-[72px] rounded-2xl bg-emerald-600 text-white text-xl font-black flex items-center justify-center gap-3 shadow-xl active:scale-95"
          >
            <Send size={26} aria-hidden /> REVISAR Y ENVIAR
          </button>
        </div>
      </div>

      {/* Resumen antes de enviar */}
      {verResumen && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-end md:items-center justify-center" role="dialog" aria-modal="true" aria-label="Resumen de visita">
          <div className="bg-white w-full md:max-w-lg max-h-[96vh] rounded-t-3xl md:rounded-3xl flex flex-col shadow-2xl animate-in slide-in-from-bottom-10 duration-200">
            <div className="p-4 border-b-4 border-slate-200">
              <h2 className="text-2xl font-black text-slate-900">Resumen de visita</h2>
            </div>
            <dl className="overflow-y-auto p-4 space-y-3">
              {[
                ['Sucursal', draft.sucursalNombre],
                ['Supervisor', supervisorNombre],
                ['Hora', formatearHora(draft.inicioEn)],
                ['Motivo de visita', draft.motivo === 'Otro' ? draft.motivoOtro : draft.motivo],
                ['Guardia(s) de turno', draft.guardiasDeTurno],
                ['EPP completo', draft.epp.completo ? 'Sí' : 'No'],
                ['Fotografías', `${draft.fotos.length} fotografías`],
                ['Cargos fijos', `${cargos.ok} OK / ${cargos.observacion} con observación / ${cargos.faltante} faltantes`],
                ['Entrevista con mandante', e.realizada ? 'Sí' : 'No'],
                ['Observaciones', draft.observaciones.hay ? 'Sí' : 'No'],
                ['Novedad relevante', draft.novedad.hay ? 'Sí' : 'No'],
                ['Resumen Ejecutivo', draft.nota || '—'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-slate-50 border-2 border-slate-200 px-4 py-2">
                  <dt className="text-xs font-black uppercase tracking-wider text-slate-500">{k}:</dt>
                  <dd className="text-lg font-black text-slate-900">{v}</dd>
                </div>
              ))}
              <div className="rounded-2xl bg-slate-50 border-2 border-slate-200 px-4 py-3">
                <dt className="text-xs font-black uppercase tracking-wider text-slate-500 mb-1">Resultado:</dt>
                <dd><ResultadoBadge resultado={resultado} prioridadNovedad={draft.novedad?.prioridad} large /></dd>
                <span className="sr-only">{RESULTADO_LABEL[resultado]}</span>
              </div>
              {draft.ubicacion?.estado !== 'verificada' && (
                <p className="text-sm font-bold text-amber-800 bg-amber-50 border-2 border-amber-300 rounded-2xl px-4 py-2">
                  🟠 Esta visita se enviará sin ubicación verificada.
                </p>
              )}
            </dl>
            <div className="p-4 border-t-4 border-slate-200 space-y-3">
              <button
                id="visita-enviar"
                onClick={confirmarEnvio}
                disabled={enviando}
                className="w-full min-h-[76px] rounded-2xl bg-emerald-600 text-white text-xl font-black leading-tight flex items-center justify-center gap-3 shadow-xl active:scale-95 disabled:opacity-60"
              >
                {enviando ? <Loader2 className="animate-spin" size={28} /> : <Send size={26} aria-hidden />}
                {enviando ? 'GUARDANDO…' : 'ENVIAR RESUMEN DE VISITA'}
              </button>
              <button
                onClick={() => setVerResumen(false)}
                disabled={enviando}
                className="w-full min-h-[60px] rounded-2xl border-4 border-slate-400 text-slate-800 text-lg font-black flex items-center justify-center gap-2 active:scale-95 disabled:opacity-60"
              >
                <Pencil size={22} aria-hidden /> VOLVER Y EDITAR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FormularioVisita;
