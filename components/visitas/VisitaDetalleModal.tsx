import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, MapPin, Clock, User, Building2, Camera, ExternalLink, CloudOff, MessageSquareText, ChevronLeft, ChevronRight } from 'lucide-react';
import { VisitaSupervisorDoc } from '../../lib/visitasSupervisor/visitasTypes';
import { fotosDeVisita, fotosPendientes, PRIORIDAD_LABEL } from '../../lib/visitasSupervisor/visitasLogic';
import { CargoBadge, ResultadoBadge, formatearFecha, formatearHora } from './visitasUi';
import ThumbnailImage from '../ThumbnailImage';
import VisitLocationMap from './VisitLocationMap';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="bg-white border-2 border-slate-200 rounded-2xl p-4">
    <h3 className="text-sm font-black uppercase tracking-wider text-slate-500 mb-3">{title}</h3>
    {children}
  </section>
);

const Row: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-col py-1.5">
    <span className="text-xs font-bold text-slate-500 uppercase">{label}</span>
    <span className="text-base font-semibold text-slate-900 whitespace-pre-wrap break-words">{value || '—'}</span>
  </div>
);

const SiNo: React.FC<{ v: boolean }> = ({ v }) => (
  <span className={`inline-block px-3 py-0.5 rounded-full border-2 text-sm font-black ${v ? 'bg-emerald-100 border-emerald-300 text-emerald-900' : 'bg-slate-100 border-slate-300 text-slate-700'}`}>
    {v ? 'SÍ' : 'NO'}
  </span>
);

const PRIORIDAD_STYLE: Record<string, string> = {
  informativa: 'bg-blue-100 text-blue-900 border-blue-300',
  requiere_atencion: 'bg-amber-100 text-amber-900 border-amber-300',
  urgente: 'bg-red-100 text-red-900 border-red-300',
};

interface Props {
  visita: VisitaSupervisorDoc;
  onClose: () => void;
  openSeguimientoOnInit?: boolean;
}

import { useAppStore } from '../../store/useAppStore';
import VisitaSeguimientoModal from './VisitaSeguimientoModal';

const VisitaDetalleModal: React.FC<Props> = ({ visita: v, onClose, openSeguimientoOnInit = false }) => {
  const currentUser = useAppStore(s => s.currentUser);
  const getEmployeeByUserId = useAppStore(s => s.getEmployeeByUserId);
  const isSupervisor = currentUser?.role === 'supervisor';
  
  const currentEmployee = currentUser ? getEmployeeByUserId(currentUser.uid) : null;
  const currentUserName = currentEmployee ? `${currentEmployee.firstName} ${currentEmployee.lastNamePaterno}` : 'Usuario';

  const [fotoIndex, setFotoIndex] = useState<number | null>(null);
  const [showSeguimiento, setShowSeguimiento] = useState(openSeguimientoOnInit);
  const fotos = fotosDeVisita(v);
  
  const todasLasFotos = useMemo(() => {
    return Object.entries(v.fotos ?? {})
      .map(([id, f]) => ({ id, ...f }))
      .sort((a, b) => a.orden - b.orden);
  }, [v.fotos]);

  const pendientes = fotosPendientes(v);
  const u = v.ubicacion;
  const tieneGps = u?.estado === 'verificada' && typeof u.lat === 'number' && typeof u.lng === 'number';

  // Keyboard navigation for gallery
  useEffect(() => {
    if (fotoIndex === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFotoIndex(null);
      } else if (e.key === 'ArrowLeft' && fotoIndex > 0) {
        setFotoIndex(fotoIndex - 1);
      } else if (e.key === 'ArrowRight' && fotoIndex < todasLasFotos.length - 1) {
        setFotoIndex(fotoIndex + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fotoIndex, todasLasFotos.length]);

  const Galeria: React.FC<{ items: ReturnType<typeof fotosDeVisita>['visita'] }> = ({ items }) => (
    <div className="grid grid-cols-3 gap-2">
      {items.map(f => {
        const globalIdx = todasLasFotos.findIndex(tf => tf.id === f.id);
        return (
          <button key={f.id} type="button" onClick={() => setFotoIndex(globalIdx)} className="aspect-square rounded-xl overflow-hidden border-2 border-slate-200 active:scale-95">
            <ThumbnailImage photoUrl={f.url} alt="Fotografía de la visita" />
          </button>
        );
      })}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-black/60 p-0 md:p-6" role="dialog" aria-modal="true" aria-label="Detalle de visita">
      <div className="bg-slate-50 w-full md:max-w-2xl max-h-[95vh] md:rounded-3xl rounded-t-3xl flex flex-col shadow-2xl animate-in slide-in-from-bottom-10 duration-200">
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-3 p-4 border-b-2 border-slate-200 bg-white rounded-t-3xl">
          <div className="min-w-0">
            <h2 className="text-xl font-black text-slate-900 leading-tight truncate">{v.sucursalNombre}</h2>
            <p className="text-sm font-semibold text-slate-600">
              {formatearFecha(v.inicioEn)} · {formatearHora(v.inicioEn)}
            </p>
            <div className="mt-2"><ResultadoBadge resultado={v.resultado} prioridadNovedad={v.novedadRelevante?.prioridad} large /></div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button 
              onClick={() => setShowSeguimiento(true)} 
              className="h-12 px-4 rounded-2xl bg-blue-100 hover:bg-blue-200 text-blue-700 text-sm font-black flex items-center justify-center gap-2 active:scale-95 transition-colors relative"
            >
              <MessageSquareText size={20} />
              <span className="hidden sm:inline">SEGUIMIENTO</span>
              {(() => {
                const noLeidos = isSupervisor ? v.noLeidosSupervisor : v.noLeidosAdmin;
                return noLeidos ? (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow-md z-10 border-2 border-white">
                    {noLeidos}
                  </span>
                ) : null;
              })()}
            </button>
            <button onClick={onClose} aria-label="Cerrar" className="shrink-0 w-12 h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center active:scale-95 transition-colors">
              <X size={26} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          <Section title="Información general">
            <div className="grid grid-cols-2 gap-x-4">
              <Row label="Supervisor" value={<span className="inline-flex items-center gap-1"><User size={14} />{v.supervisorNombre}</span>} />
              <Row label="Sucursal" value={<span className="inline-flex items-center gap-1"><Building2 size={14} />{v.sucursalNombre}</span>} />
              <Row label="Fecha" value={formatearFecha(v.inicioEn)} />
              <Row label="Hora inicio" value={<span className="inline-flex items-center gap-1"><Clock size={14} />{formatearHora(v.inicioEn)}</span>} />
              <Row label="Hora término" value={formatearHora(v.terminoEn)} />
              <Row label="Duración" value={typeof v.duracionMin === 'number' ? `${v.duracionMin} min` : undefined} />
            </div>
            
            <div className="mt-4 pt-4 border-t-2 border-slate-100 space-y-3">
              <Row label="Motivo de visita" value={v.motivo || '—'} />
              <Row label="Guardia(s) de turno" value={v.guardiasDeTurno || '—'} />
              <div>
                <span className="text-xs font-bold text-slate-500 uppercase">EPP Completo</span>
                <div className="mt-1">
                  {v.epp?.completo ? (
                    <span className="inline-block px-3 py-0.5 rounded-full border-2 bg-emerald-100 border-emerald-300 text-emerald-900 text-sm font-black">
                      SÍ
                    </span>
                  ) : (
                    <div className="space-y-1">
                      <span className="inline-block px-3 py-0.5 rounded-full border-2 bg-red-100 border-red-300 text-red-900 text-sm font-black">
                        NO
                      </span>
                      {v.epp?.detalleFaltante && (
                        <p className="text-sm text-slate-700 bg-red-50 p-2 rounded-lg border border-red-200 mt-2">
                          <strong>Falta:</strong> {v.epp.detalleFaltante}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Section>

          {!isSupervisor && (
            <Section title="Ubicación">
              {tieneGps ? (
                <div className="space-y-2">
                  <p className="text-base font-bold text-emerald-800">🟢 Ubicación verificada</p>
                  <VisitLocationMap lat={u.lat!} lng={u.lng!} />
                  <p className="text-xs text-slate-500 font-medium">
                    {u.lat!.toFixed(5)}, {u.lng!.toFixed(5)}
                    {u.accuracy ? ` · precisión ±${Math.round(u.accuracy)} m` : ''}
                  </p>
                  <a
                    href={`https://www.google.com/maps?q=${u.lat},${u.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 underline"
                  >
                    <ExternalLink size={14} /> Abrir en Google Maps
                  </a>
                </div>
              ) : (
                <p className="text-base font-bold text-amber-800 flex items-center gap-2">
                  <MapPin size={18} /> 🟠 No fue posible verificar ubicación
                </p>
              )}
            </Section>
          )}

          <Section title={`Fotografías (${fotos.total}${v.fotosTotal ? ` de ${v.fotosTotal}` : ''})`}>
            {fotos.visita.length > 0 ? <Galeria items={fotos.visita} /> : <p className="text-base text-slate-500 font-medium">Sin fotografías.</p>}
            {pendientes > 0 && (
              <p className="mt-3 flex items-center gap-2 text-sm font-bold text-amber-800 bg-amber-50 border-2 border-amber-200 rounded-xl px-3 py-2">
                <CloudOff size={16} /> {pendientes} fotografía(s) aún pendiente(s) de sincronizar desde el teléfono.
              </p>
            )}
          </Section>

          <Section title="Cargos fijos">
            <ul className="divide-y divide-slate-100">
              {v.checklist?.items?.map(it => (
                <li key={it.id} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-bold text-slate-900">{it.label}</span>
                    <CargoBadge estado={it.estado} />
                  </div>
                  {it.nota && <p className="text-sm text-slate-600 mt-1">“{it.nota}”</p>}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Entrevista con mandante">
            <div className="mb-1"><SiNo v={!!v.entrevistaMandante?.realizada} /></div>
            {v.entrevistaMandante?.realizada && (
              <>
                <Row label="Nombre del mandante" value={v.entrevistaMandante.nombre} />
                <Row label="Puntos tratados" value={v.entrevistaMandante.resumen} />
                <Row label="Compromiso / acuerdo" value={v.entrevistaMandante.compromiso?.hay ? v.entrevistaMandante.compromiso.texto : 'Sin compromisos'} />
              </>
            )}
          </Section>

          <Section title="Observaciones">
            <div className="mb-1"><SiNo v={!!v.observaciones?.hay} /></div>
            {v.observaciones?.hay && (
              <>
                <Row label="Observación" value={v.observaciones.texto} />
                {fotos.observacion.length > 0 && <Galeria items={fotos.observacion} />}
              </>
            )}
          </Section>

          <Section title="Novedad relevante">
            <div className="mb-1"><SiNo v={!!v.novedadRelevante?.hay} /></div>
            {v.novedadRelevante?.hay && (
              <>
                <Row label="Descripción" value={v.novedadRelevante.descripcion} />
                {v.novedadRelevante.prioridad && (
                  <span className={`inline-block mt-1 px-3 py-1 rounded-full border-2 text-sm font-black ${PRIORIDAD_STYLE[v.novedadRelevante.prioridad]}`}>
                    Prioridad: {PRIORIDAD_LABEL[v.novedadRelevante.prioridad]}
                  </span>
                )}
              </>
            )}
          </Section>

          <Section title="Resumen Ejecutivo de Visita">
            <p className="text-base text-slate-900 whitespace-pre-wrap break-words">{v.nota || 'Sin resumen ejecutivo.'}</p>
          </Section>

          <button onClick={onClose} className="w-full min-h-[60px] rounded-2xl bg-slate-800 text-white text-lg font-black active:scale-95">
            CERRAR
          </button>
        </div>
      </div>

      {showSeguimiento && currentUser && (
        <VisitaSeguimientoModal
          visita={v}
          usuario={{ uid: currentUser.uid, nombre: currentUserName, rol: currentUser.role }}
          onClose={() => setShowSeguimiento(false)}
        />
      )}

      {fotoIndex !== null && todasLasFotos[fotoIndex] && (
        <div className="fixed inset-0 z-[110] bg-black/95 flex items-center justify-center p-4" onClick={() => setFotoIndex(null)}>
          <img 
            src={todasLasFotos[fotoIndex].url} 
            alt="Fotografía ampliada" 
            className="max-w-full max-h-full rounded-xl object-contain" 
            onClick={e => e.stopPropagation()}
          />
          
          <button className="absolute top-4 right-4 w-12 h-12 rounded-full bg-white/90 flex items-center justify-center hover:bg-white active:scale-95 transition-all" aria-label="Cerrar foto">
            <X size={26} className="text-slate-900" />
          </button>

          {fotoIndex > 0 && (
            <button 
              className="absolute left-4 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white backdrop-blur-sm transition-all"
              onClick={(e) => { e.stopPropagation(); setFotoIndex(fotoIndex - 1); }}
            >
              <ChevronLeft size={36} />
            </button>
          )}

          {fotoIndex < todasLasFotos.length - 1 && (
            <button 
              className="absolute right-4 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white backdrop-blur-sm transition-all"
              onClick={(e) => { e.stopPropagation(); setFotoIndex(fotoIndex + 1); }}
            >
              <ChevronRight size={36} />
            </button>
          )}

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/50 text-white px-4 py-2 rounded-full text-sm font-bold backdrop-blur-sm">
            {fotoIndex + 1} / {todasLasFotos.length}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default VisitaDetalleModal;
