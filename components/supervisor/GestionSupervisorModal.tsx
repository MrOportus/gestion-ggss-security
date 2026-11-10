import React, { useEffect, useState } from 'react';
import {
  Building2,
  Calendar,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  ExternalLink,
  History,
  Loader2,
  MessageSquarePlus,
  Send,
  ShieldAlert,
  User,
  X,
  XCircle,
} from 'lucide-react';
import type { EstadoSolucionSupervisor, GestionSupervisorEntry } from '../../types';
import {
  type AlertaOperacionalItem,
  enviarConsultaASupervisor,
  registrarGestionSupervisor,
  resolverAlertaComoAdmin,
  subscribeHistorialGestion,
} from '../../lib/supervisor/gestionIncidenciaService';
import { useAppStore } from '../../store/useAppStore';
import PhotoGalleryModal from '../PhotoGalleryModal';

const ADMIN_QUICK_PROMPTS = [
  '¿Esto fue resuelto?',
  '¿Cuál es el estado de esta novedad?',
  'Indicar detalles al respecto.',
] as const;

export interface SupervisorActor {
  id: string;
  name: string;
  role: string;
  assignedSites?: (string | number)[];
}

interface GestionSupervisorModalProps {
  isOpen: boolean;
  alerta: AlertaOperacionalItem | null;
  currentUser: SupervisorActor;
  onClose: () => void;
  onSaved: (alertaActualizada: AlertaOperacionalItem) => void;
  onOpenOriginalRecord?: (alerta: AlertaOperacionalItem) => void;
}

export const GestionSupervisorModal: React.FC<GestionSupervisorModalProps> = ({
  isOpen,
  alerta,
  currentUser,
  onClose,
  onSaved,
  onOpenOriginalRecord,
}) => {
  const showNotification = useAppStore((state) => state.showNotification);

  // Estado formulario Supervisor ("Guardar Gestión")
  const [fueSolucionado, setFueSolucionado] = useState<EstadoSolucionSupervisor>('si');
  const [medidasTomadas, setMedidasTomadas] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [motivoNoSolucionado, setMotivoNoSolucionado] = useState('');
  const [requiereIntervencionJefatura, setRequiereIntervencionJefatura] = useState(false);

  // Estado formulario Administrador / Jefatura ("Enviar a Supervisor" y "Resolver")
  const [selectedPrompts, setSelectedPrompts] = useState<string[]>([]);
  const [consultaTextoLibre, setConsultaTextoLibre] = useState('');
  const [showAdminResolver, setShowAdminResolver] = useState(false);
  const [medidasResolucionAdmin, setMedidasResolucionAdmin] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [historial, setHistorial] = useState<GestionSupervisorEntry[]>([]);
  const [loadingHistorial, setLoadingHistorial] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen || !alerta) return;

    // Pre-cargar estado desde la última gestión de supervisor si existe
    if (alerta.gestionSupervisor && alerta.gestionSupervisor.tipoRegistro !== 'consulta_admin') {
      setFueSolucionado(alerta.gestionSupervisor.fueSolucionado);
      setRequiereIntervencionJefatura(
        Boolean(alerta.gestionSupervisor.requiereIntervencionJefatura),
      );
    } else {
      setFueSolucionado('si');
      setRequiereIntervencionJefatura(false);
    }
    setMedidasTomadas('');
    setObservaciones('');
    setMotivoNoSolucionado('');
    setSelectedPrompts([]);
    setConsultaTextoLibre('');
    setShowAdminResolver(false);
    setMedidasResolucionAdmin('');

    let active = true;
    setLoadingHistorial(true);

    const fallbackEntry: GestionSupervisorEntry[] = alerta.gestionSupervisor
      ? [
          {
            id: alerta.gestionSupervisor.ultimaGestionId || `res_${alerta.origenId}`,
            origenTipo: alerta.origenTipo,
            origenId: alerta.origenId,
            siteId: alerta.siteId,
            siteName: alerta.siteName,
            tipoRegistro: alerta.gestionSupervisor.tipoRegistro || 'gestion_supervisor',
            fueSolucionado: alerta.gestionSupervisor.fueSolucionado,
            medidasTomadas: alerta.gestionSupervisor.medidasTomadas,
            observaciones: alerta.gestionSupervisor.observaciones,
            motivoNoSolucionado: alerta.gestionSupervisor.motivoNoSolucionado,
            requiereIntervencionJefatura: alerta.gestionSupervisor.requiereIntervencionJefatura,
            supervisorUid: alerta.gestionSupervisor.supervisorUid,
            supervisorNombre: alerta.gestionSupervisor.supervisorNombre,
            fechaGestion: alerta.gestionSupervisor.fechaGestion,
            fechaGestionISO: alerta.gestionSupervisor.fechaGestionISO,
          },
        ]
      : [];

    // Historial en TIEMPO REAL: lo que envía el otro lado aparece al instante
    const unsubscribe = subscribeHistorialGestion(
      alerta.origenTipo,
      alerta.origenId,
      (entries) => {
        if (!active) return;
        setHistorial(entries.length > 0 ? entries : fallbackEntry);
        setLoadingHistorial(false);
      },
      () => {
        if (!active) return;
        setHistorial(fallbackEntry);
        setLoadingHistorial(false);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
    // Se re-suscribe solo al abrir/cambiar de registro (no en cada actualización en vivo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, alerta?.uidKey]);

  if (!isOpen || !alerta) return null;

  const isAdminView =
    currentUser.role === 'admin' || currentUser.role === 'jefe_operaciones';
  const isSupervisorView = currentUser.role === 'supervisor';
  const isAlertaSolucionada =
    alerta.gestionSupervisor?.fueSolucionado === 'si' ||
    alerta.estadoOriginal?.toLowerCase() === 'resuelta';

  const toggleQuickPrompt = (promptText: string) => {
    setSelectedPrompts((prev) =>
      prev.includes(promptText)
        ? prev.filter((p) => p !== promptText)
        : [...prev, promptText],
    );
  };

  const composedAdminMessage = [
    selectedPrompts.join(' '),
    consultaTextoLibre.trim(),
  ]
    .filter(Boolean)
    .join(' — ');

  // --- Handler exclusivo para Supervisor ("Guardar Gestión") -----------------
  const handleSupervisorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!medidasTomadas.trim()) {
      showNotification('Debe registrar las medidas tomadas.', 'warning');
      return;
    }
    if (fueSolucionado === 'no' && !motivoNoSolucionado.trim()) {
      showNotification('Indique el motivo por el cual no fue solucionada la incidencia.', 'warning');
      return;
    }

    setIsSaving(true);
    try {
      const { gestionId } = await registrarGestionSupervisor({
        origenTipo: alerta.origenTipo,
        origenId: alerta.origenId,
        siteId: alerta.siteId,
        siteName: alerta.siteName,
        fueSolucionado,
        medidasTomadas: medidasTomadas.trim(),
        observaciones: observaciones.trim(),
        motivoNoSolucionado: fueSolucionado === 'no' ? motivoNoSolucionado.trim() : undefined,
        requiereIntervencionJefatura:
          fueSolucionado === 'no' ? requiereIntervencionJefatura : false,
        supervisorUid: currentUser.id,
        supervisorNombre: currentUser.name,
        supervisorRole: currentUser.role as 'supervisor' | 'admin' | 'jefe_operaciones',
        assignedSites: currentUser.assignedSites || [],
        prevResumen: alerta.gestionSupervisor,
      });

      const nowISO = new Date().toISOString();
      const nuevoResumen = {
        ultimaGestionId: gestionId,
        tipoRegistro: 'gestion_supervisor' as const,
        fueSolucionado,
        medidasTomadas: medidasTomadas.trim(),
        observaciones: observaciones.trim() || undefined,
        motivoNoSolucionado:
          fueSolucionado === 'no' ? motivoNoSolucionado.trim() : undefined,
        requiereIntervencionJefatura:
          fueSolucionado === 'no' ? requiereIntervencionJefatura : false,
        supervisorUid: currentUser.id,
        supervisorNombre: currentUser.name,
        ultimoSupervisorUid: currentUser.id,
        ultimoSupervisorNombre: currentUser.name,
        fechaGestion: nowISO,
        fechaGestionISO: nowISO,
        fechaUltimaGestionSupervisorISO: nowISO,
        consultaAdmin: alerta.gestionSupervisor?.consultaAdmin
          ? {
              ...alerta.gestionSupervisor.consultaAdmin,
              pendienteRespuesta: false,
            }
          : null,
      };

      setMedidasTomadas('');
      setObservaciones('');
      setMotivoNoSolucionado('');

      // Las notificaciones (push al supervisor / registro a Administración) las genera
      // el servidor al crearse el registro en historialGestion (functions/src/supervisorInbox).

      showNotification('Gestión operacional registrada correctamente.', 'success');
      onSaved({
        ...alerta,
        gestionSupervisor: nuevoResumen,
      });
    } catch (err: any) {
      showNotification(
        err?.message || 'Error al registrar la gestión del supervisor.',
        'error',
      );
    } finally {
      setIsSaving(false);
    }
  };

  // --- Handler exclusivo para Admin / Jefatura ("Enviar a Supervisor") --------
  const handleAdminConsultaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composedAdminMessage.trim()) {
      showNotification(
        'Seleccione una consulta rápida o escriba un mensaje para enviar al supervisor.',
        'warning',
      );
      return;
    }

    setIsSaving(true);
    try {
      const { nuevoResumen } = await enviarConsultaASupervisor({
        origenTipo: alerta.origenTipo,
        origenId: alerta.origenId,
        siteId: alerta.siteId,
        siteName: alerta.siteName,
        mensaje: composedAdminMessage,
        adminUid: currentUser.id,
        adminNombre: currentUser.name,
        prevResumen: alerta.gestionSupervisor,
      });

      // Push al supervisor asignado: lo envía el servidor al crearse la consulta.
      setSelectedPrompts([]);
      setConsultaTextoLibre('');

      showNotification('Consulta enviada al supervisor asignado.', 'success');
      onSaved({
        ...alerta,
        gestionSupervisor: nuevoResumen,
      });
    } catch (err: any) {
      showNotification(
        err?.message || 'Error al enviar la consulta al supervisor.',
        'error',
      );
    } finally {
      setIsSaving(false);
    }
  };

  // --- Handler para marcar como resuelta directamente por Administrador ---
  const handleAdminResolverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!medidasResolucionAdmin.trim()) {
      showNotification('Debe ingresar las medidas o justificación de resolución.', 'warning');
      return;
    }
    setIsSaving(true);
    try {
      await resolverAlertaComoAdmin({
        origenTipo: alerta.origenTipo,
        origenId: alerta.origenId,
        siteId: alerta.siteId,
        siteName: alerta.siteName,
        adminUid: currentUser.id,
        adminNombre: currentUser.name,
        adminRole: currentUser.role,
        medidasTomadas: medidasResolucionAdmin.trim(),
        prevResumen: alerta.gestionSupervisor,
      });

      showNotification('Novedad/Alerta marcada como resuelta exitosamente.', 'success');
      setShowAdminResolver(false);
      setMedidasResolucionAdmin('');
      const nowISO = new Date().toISOString();
      onSaved({
        ...alerta,
        estadoOriginal: alerta.origenTipo === 'novedad' ? 'resuelta' : alerta.estadoOriginal,
        gestionSupervisor: {
          ultimaGestionId: `gest_${Date.now()}`,
          tipoRegistro: 'gestion_supervisor',
          fueSolucionado: 'si',
          medidasTomadas: medidasResolucionAdmin.trim(),
          requiereIntervencionJefatura: false,
          supervisorUid: currentUser.id,
          supervisorNombre: currentUser.name,
          ultimoSupervisorUid: currentUser.id,
          ultimoSupervisorNombre: currentUser.name,
          fechaGestion: nowISO,
          fechaGestionISO: nowISO,
          fechaUltimaGestionSupervisorISO: nowISO,
        },
      });
      onClose();
    } catch (err: any) {
      showNotification(err?.message || 'Error al resolver la alerta.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const formatDateTime = (iso?: string) => {
    if (!iso) return 'Fecha no disponible';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderBadgeSolucion = (estado: EstadoSolucionSupervisor, reqJefatura?: boolean) => {
    if (estado === 'si') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">
          <CheckCircle2 className="w-3 h-3" /> Solucionado
        </span>
      );
    }
    if (estado === 'no') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-red-100 text-red-800 border border-red-200">
          <XCircle className="w-3 h-3" /> No Solucionado
          {reqJefatura && ' • Escalar a Jefatura'}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-200">
        <Clock className="w-3 h-3" /> Pendiente de Gestión
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 shrink-0">
              {isAdminView ? (
                <MessageSquarePlus className="w-5 h-5" />
              ) : (
                <ClipboardCheck className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300 block">
                {isAdminView
                  ? 'Actividad y Consulta a Supervisor'
                  : 'Gestión Operativa del Supervisor'}
              </span>
              <h3 className="text-base font-black truncate">{alerta.clasificacionLabel}</h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {/* Resumen del Registro Original */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-black text-slate-800">
                <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
                <span>{alerta.siteName}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-slate-200 text-slate-700">
                  Estado Original: {alerta.estadoOriginal}
                </span>
                {onOpenOriginalRecord && (
                  <button
                    type="button"
                    onClick={() => onOpenOriginalRecord(alerta)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-wider transition-colors shadow-xs"
                    title="Abrir registro original para dar seguimiento directo al guardia de turno"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Registro Original (Guardia)
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600">
              <div className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="font-bold text-slate-700">Reportó:</span>
                <span className="truncate">{alerta.trabajadorNombre}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="font-bold text-slate-700">Fecha/Hora:</span>
                <span>{formatDateTime(alerta.fechaHoraISO)}</span>
              </div>
            </div>

            {/* Zona de Novedad: Estilo Post-it amarillo con miniaturas y acceso a galería */}
            <div className="bg-amber-50/90 border border-amber-200/90 rounded-2xl p-3.5 text-xs text-amber-950 shadow-xs space-y-2.5">
              <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-amber-800/90">
                <span className="flex items-center gap-1.5">
                  <span>📌</span> Descripción de la Novedad
                </span>
                {alerta.fotosUrls.length > 0 && (
                  <span className="text-[10px] font-bold text-amber-800 bg-amber-100/90 px-2 py-0.5 rounded-full border border-amber-300/70">
                    📷 {alerta.fotosUrls.length} {alerta.fotosUrls.length === 1 ? 'fotografía' : 'fotografías'}
                  </span>
                )}
              </div>

              <div className="leading-relaxed whitespace-pre-wrap font-medium">
                {alerta.descripcion}
              </div>

              {alerta.fotosUrls.length > 0 && (
                <div className="pt-2 border-t border-amber-200/70">
                  <p className="text-[10px] font-black uppercase tracking-wider text-amber-800/80 mb-2 flex items-center gap-1">
                    <Camera className="w-3.5 h-3.5 text-amber-700" />
                    Miniaturas (clic para abrir galería completa):
                  </p>
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {alerta.fotosUrls.map((url, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setGalleryIndex(idx)}
                        className="w-14 h-14 rounded-xl overflow-hidden border border-amber-300 shrink-0 hover:ring-2 hover:ring-amber-500 transition-all cursor-pointer group bg-amber-100 shadow-xs"
                        title="Clic para ver en la galería de fotos"
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
          </div>

          {/* Aviso de Consulta de Jefatura / Administración (Visible especialmente para el Supervisor) */}
          {alerta.gestionSupervisor?.consultaAdmin && (
            <div
              className={`rounded-2xl p-4 border space-y-1.5 ${
                alerta.gestionSupervisor.consultaAdmin.pendienteRespuesta
                  ? 'bg-amber-50 border-amber-300'
                  : 'bg-indigo-50/70 border-indigo-200'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={`text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 ${
                    alerta.gestionSupervisor.consultaAdmin.pendienteRespuesta
                      ? 'text-amber-900'
                      : 'text-indigo-900'
                  }`}
                >
                  <MessageSquarePlus className="w-4 h-4 shrink-0" />
                  Consulta de Administración / Jefatura (
                  {alerta.gestionSupervisor.consultaAdmin.adminNombre})
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-white/80 border border-amber-200 text-amber-800">
                  {alerta.gestionSupervisor.consultaAdmin.pendienteRespuesta
                    ? 'Pendiente respuesta de supervisor'
                    : 'Respondida por supervisor'}
                </span>
              </div>
              <p className="text-xs font-bold text-slate-800 bg-white/90 rounded-xl p-2.5 border border-amber-200/70">
                {alerta.gestionSupervisor.consultaAdmin.mensaje}
              </p>
            </div>
          )}

          {/* --- VISTA ADMINISTRACIÓN / JEFATURA: Resolución Directa y Consulta a Supervisor --- */}
          {isAdminView && (
            <>
              {isAlertaSolucionada ? (
                <div className="flex items-center gap-2 p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900 text-xs font-bold shadow-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Esta alerta/novedad ya se encuentra marcada como solucionada.</span>
                </div>
              ) : (
                <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 shadow-xs space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h5 className="text-xs font-black text-emerald-950 uppercase tracking-wide flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        Resolución Administrativa
                      </h5>
                      <p className="text-[11px] text-emerald-800 font-medium">
                        ¿Esta situación ya fue subsanada? Puede marcarla como resuelta directamente.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAdminResolver((v) => !v)}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-sm transition-all shrink-0"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {showAdminResolver ? 'Cancelar' : 'Marcar Resuelta'}
                    </button>
                  </div>

                  {showAdminResolver && (
                    <form onSubmit={handleAdminResolverSubmit} className="pt-2 border-t border-emerald-200/80 space-y-3">
                      <div>
                        <label className="block text-[11px] font-black uppercase tracking-wider text-emerald-950 mb-1">
                          Medidas adoptadas / Justificación de la resolución *
                        </label>
                        <textarea
                          required
                          rows={2}
                          value={medidasResolucionAdmin}
                          onChange={(e) => setMedidasResolucionAdmin(e.target.value)}
                          placeholder="Indique las medidas adoptadas o justificación para dar por resuelta esta alerta..."
                          className="w-full px-3 py-2 rounded-xl border border-emerald-300 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
                        />
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => setShowAdminResolver(false)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          disabled={isSaving || !medidasResolucionAdmin.trim()}
                          className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black uppercase flex items-center gap-1.5 shadow-sm"
                        >
                          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                          Confirmar y Marcar Resuelta
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              <form
                onSubmit={handleAdminConsultaSubmit}
                className="space-y-4 bg-white rounded-2xl border border-indigo-200 p-4 sm:p-5 shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-indigo-950 flex items-center gap-1.5">
                      <MessageSquarePlus className="w-4 h-4 text-indigo-600" />
                      Consultar o Requerir Estado al Supervisor Asignado
                    </h4>
                    <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                      Seleccione una consulta rápida y/o escriba indicaciones para que sean leídas por el supervisor de <strong className="text-slate-700">{alerta.siteName}</strong>.
                    </p>
                  </div>
                </div>

                {/* Botones rápidos de consulta */}
                <div>
                  <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 mb-2">
                    Consultas Rápidas (clic para agregar)
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {ADMIN_QUICK_PROMPTS.map((promptText) => {
                      const isSelected = selectedPrompts.includes(promptText);
                      return (
                        <button
                          key={promptText}
                          type="button"
                          onClick={() => toggleQuickPrompt(promptText)}
                          className={`px-3 py-2 rounded-xl text-xs font-black border transition-all flex items-center gap-1.5 ${
                            isSelected
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-600/20'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-indigo-50 hover:border-indigo-200'
                          }`}
                        >
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                          {promptText}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Campo de texto libre */}
                <div>
                  <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 mb-1">
                    Detalle o consulta adicional (Campo de texto libre)
                  </label>
                  <textarea
                    rows={3}
                    value={consultaTextoLibre}
                    onChange={(e) => setConsultaTextoLibre(e.target.value)}
                    placeholder="Escriba aquí instrucciones o detalles adicionales para el supervisor asignado..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Vista previa del mensaje compuesto */}
                {composedAdminMessage && (
                  <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-100 text-xs text-indigo-950">
                    <span className="font-black uppercase text-[10px] text-indigo-600 block mb-0.5">
                      Mensaje que recibirá el supervisor:
                    </span>
                    {composedAdminMessage}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <span className="text-[10px] font-bold text-slate-400">
                    * Quedará visible en la bandeja del supervisor asignado y en el historial auditable.
                  </span>
                  <button
                    type="submit"
                    disabled={isSaving || !composedAdminMessage.trim()}
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Enviar a Supervisor
                      </>
                    )}
                  </button>
                </div>
              </form>
            </>
          )}

          {/* --- VISTA SUPERVISOR: Registrar Intervención de Supervisor ("Guardar Gestión") --- */}
          {isSupervisorView && (
            <form
              onSubmit={handleSupervisorSubmit}
              className="space-y-4 bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                    Registrar Intervención de Supervisor
                  </h4>
                  <p className="text-[11px] text-slate-500 font-medium">
                    Responsable: <strong className="text-slate-700">{currentUser.name}</strong> • Fecha oficial asignada por servidor
                  </p>
                </div>
              </div>

              {/* ¿Fue solucionado? */}
              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 mb-2">
                  ¿Fue solucionado? *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setFueSolucionado('si')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-black uppercase border flex items-center justify-center gap-1.5 transition-all ${
                      fueSolucionado === 'si'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/20'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    Sí
                  </button>
                  <button
                    type="button"
                    onClick={() => setFueSolucionado('no')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-black uppercase border flex items-center justify-center gap-1.5 transition-all ${
                      fueSolucionado === 'no'
                        ? 'bg-red-600 text-white border-red-600 shadow-md shadow-red-600/20'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <XCircle className="w-4 h-4 shrink-0" />
                    No
                  </button>
                  <button
                    type="button"
                    onClick={() => setFueSolucionado('pendiente')}
                    className={`py-2.5 px-2 rounded-xl text-[11px] font-black uppercase border flex items-center justify-center gap-1 transition-all ${
                      fueSolucionado === 'pendiente'
                        ? 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/20'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    Pendiente
                  </button>
                </div>
              </div>

              {/* Si NO fue solucionado: motivo + escalamiento a Jefatura */}
              {fueSolucionado === 'no' && (
                <div className="p-3.5 rounded-2xl bg-red-50/70 border border-red-200 space-y-3 animate-in fade-in duration-150">
                  <div>
                    <label className="block text-[11px] font-black uppercase tracking-wider text-red-800 mb-1">
                      Motivo por el cual no fue solucionado *
                    </label>
                    <input
                      type="text"
                      required
                      value={motivoNoSolucionado}
                      onChange={(e) => setMotivoNoSolucionado(e.target.value)}
                      placeholder="Ej: Requiere repuesto externo / autorización del mandante..."
                      className="w-full px-3 py-2 rounded-xl border border-red-200 bg-white text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={requiereIntervencionJefatura}
                      onChange={(e) => setRequiereIntervencionJefatura(e.target.checked)}
                      className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500"
                    />
                    <span className="text-xs font-black text-red-900 flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
                      Requiere intervención de Jefatura de Operaciones
                    </span>
                  </label>
                </div>
              )}

              {/* Medidas tomadas (Obligatorio) */}
              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 mb-1">
                  Medidas tomadas (Obligatorio) *
                </label>
                <textarea
                  rows={3}
                  required
                  value={medidasTomadas}
                  onChange={(e) => setMedidasTomadas(e.target.value)}
                  placeholder="Describa las acciones concretas realizadas por supervisión..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Observaciones (Opcional) */}
              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600 mb-1">
                  Observaciones complementarias (Opcional)
                </label>
                <textarea
                  rows={2}
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Antecedentes adicionales o recomendaciones..."
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[10px] font-bold text-slate-400">
                  * Este registro no altera el estado original del reporte del guardia.
                </span>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-lg transition-all"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <ClipboardCheck className="w-4 h-4" />
                      Guardar Gestión
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Historial Auditable Inmutable */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <History className="w-4 h-4 text-indigo-600" />
                Historial Auditable de Gestiones ({historial.length})
              </h4>
              <span className="text-[10px] font-bold text-slate-400 uppercase">
                Subcolección Inmutable
              </span>
            </div>

            {loadingHistorial ? (
              <div className="py-6 flex items-center justify-center gap-2 text-xs font-bold text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Cargando historial...
              </div>
            ) : historial.length === 0 ? (
              <div className="p-4 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs font-bold text-slate-400">
                Aún no existen gestiones ni consultas registradas para esta incidencia.
              </div>
            ) : (
              <div className="space-y-2.5">
                {historial.map((item) => {
                  const isConsultaAdmin = item.tipoRegistro === 'consulta_admin';
                  return (
                    <div
                      key={item.id}
                      className={`p-3.5 rounded-2xl border space-y-2 ${
                        isConsultaAdmin
                          ? 'bg-indigo-50/50 border-indigo-200/80'
                          : 'bg-slate-50 border-slate-200/80'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {isConsultaAdmin ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-indigo-100 text-indigo-800 border border-indigo-200">
                              <MessageSquarePlus className="w-3 h-3" /> Consulta a Supervisor
                            </span>
                          ) : (
                            renderBadgeSolucion(
                              item.fueSolucionado,
                              item.requiereIntervencionJefatura,
                            )
                          )}
                          <span className="text-xs font-black text-slate-800">
                            {item.supervisorNombre}
                          </span>
                        </div>
                        <span className="text-[11px] font-bold text-slate-400">
                          {formatDateTime(item.fechaGestionISO)}
                        </span>
                      </div>

                      <div className="text-xs text-slate-700">
                        <span className="font-black text-slate-900">
                          {isConsultaAdmin ? 'Consulta / Requerimiento: ' : 'Medidas tomadas: '}
                        </span>
                        {item.medidasTomadas}
                      </div>

                      {!isConsultaAdmin &&
                        item.fueSolucionado === 'no' &&
                        item.motivoNoSolucionado && (
                          <div className="text-xs text-red-700 bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-100">
                            <span className="font-black">Motivo no solución: </span>
                            {item.motivoNoSolucionado}
                          </div>
                        )}

                      {item.observaciones && (
                        <div className="text-xs text-slate-600 italic">
                          <span className="font-bold not-italic text-slate-700">
                            Observaciones:{' '}
                          </span>
                          {item.observaciones}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Galería completa para evidencias fotográficas */}
      {galleryIndex !== null && alerta.fotosUrls.length > 0 && (
        <PhotoGalleryModal
          photos={alerta.fotosUrls}
          initialIndex={galleryIndex}
          onClose={() => setGalleryIndex(null)}
          title={`Evidencias · ${alerta.siteName}`}
        />
      )}
    </div>
  );
};
