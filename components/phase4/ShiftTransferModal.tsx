/**
 * components/phase4/ShiftTransferModal.tsx
 * Fase 4 — Modal multipaso para traslado de turnos.
 *
 * Pasos:
 *   1. Selección de fechas
 *   2. Preview de conflictos (no autoritativo)
 *   3. Configuración del traslado (destino, tipo, horario)
 *   4. Confirmación y procesamiento
 *
 * El store es local (useState). No se requiere store global.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  X,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Building2,
  Clock,
  Calendar,
  Info,
  ArrowLeft,
  AlertCircle,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { db } from '../../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { transferShifts, generateOperationRequestId } from '../../lib/phase4/transferService';
import { previewMultipleConflicts } from '../../lib/phase4/conflictPreview';
import type { TurnoProgramado } from '../../types/phase1';
import type {
  TransferResult,
  ConflictDetectionResult,
  ModalStep,
  TransferModalState,
} from '../../types/phase4';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface ShiftTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** ID del empleado cuyo turno se va a trasladar */
  colaboradorId: string;
  colaboradorNombre: string;
  colaboradorRut: string;
  /** Sucursal origen (donde está programado actualmente) */
  sucursalOrigenId: string | number;
  sucursalOrigenNombre: string;
  /** Fechas preseleccionadas (formato YYYY-MM-DD) */
  fechasPreseleccionadas?: string[];
  /** Callback cuando el traslado se completa exitosamente */
  onTransferComplete?: (result: TransferResult) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de UI
// ─────────────────────────────────────────────────────────────────────────────

function conflictBadge(type: ConflictDetectionResult['type']) {
  if (type === 'none') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold"><CheckCircle2 size={11} /> Sin conflicto</span>;
  }
  if (type === 'already_transferred') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs font-semibold"><AlertTriangle size={11} /> Ya trasladado</span>;
  }
  if (type === 'insufficient_rest') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full text-xs font-semibold"><AlertCircle size={11} /> Descanso insuficiente</span>;
  }
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-semibold"><AlertTriangle size={11} /> Conflicto {type}</span>;
}

const TIPO_OPCIONES = [
  { value: 'traslado_temporal', label: 'Traslado temporal' },
  { value: 'cobertura', label: 'Cobertura' },
  { value: 'extra', label: 'Turno extra' },
  { value: 'emergencia', label: 'Emergencia' },
  { value: 'contractual', label: 'Contractual' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

const ShiftTransferModal: React.FC<ShiftTransferModalProps> = ({
  isOpen,
  onClose,
  colaboradorId,
  colaboradorNombre,
  colaboradorRut,
  sucursalOrigenId,
  sucursalOrigenNombre,
  fechasPreseleccionadas = [],
  onTransferComplete,
}) => {
  const { sites } = useAppStore();

  // Estado local del modal
  const [step, setStep] = useState<ModalStep>('selection');
  const [fechasSeleccionadas, setFechasSeleccionadas] = useState<string[]>(fechasPreseleccionadas);
  const [turnosOrigen, setTurnosOrigen] = useState<TransferModalState['turnosOrigen']>([]);
  const [sucursalDestinoId, setSucursalDestinoId] = useState<string>('');
  const [tipoOperacion, setTipoOperacion] = useState<TransferModalState['tipoOperacion']>('traslado_temporal');
  const [motivo, setMotivo] = useState('');
  const [horarioManual, setHorarioManual] = useState<{ inicio: string; termino: string; cruzaMedianoche: boolean } | undefined>();
  const [useManualHorario, setUseManualHorario] = useState(false);
  const [confirmInsufficientRest, setConfirmInsufficientRest] = useState(false);
  const [restWarningMotivo, setRestWarningMotivo] = useState('');
  const [conflictPreview, setConflictPreview] = useState<TransferModalState['conflictPreview']>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<TransferResult | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Reset al abrir
  useEffect(() => {
    if (isOpen) {
      setStep('selection');
      setFechasSeleccionadas(fechasPreseleccionadas);
      setTurnosOrigen([]);
      setSucursalDestinoId('');
      setTipoOperacion('traslado_temporal');
      setMotivo('');
      setHorarioManual(undefined);
      setUseManualHorario(false);
      setConfirmInsufficientRest(false);
      setRestWarningMotivo('');
      setConflictPreview([]);
      setIsProcessing(false);
      setResult(undefined);
      setError(null);
    }
  }, [isOpen]);

  // Sitios destino disponibles (excluye el origen)
  const sitiosDestino = sites.filter(s => s.id.toString() !== sucursalOrigenId.toString());
  const sitioDestinoSeleccionado = sites.find(s => s.id.toString() === sucursalDestinoId);

  // ── Paso 1 → 2: Buscar turnos origen y cargar preview ────────────────────

  const handleNextToConflictReview = useCallback(async () => {
    if (fechasSeleccionadas.length === 0) {
      setError('Selecciona al menos una fecha.');
      return;
    }
    setError(null);
    setIsLoadingPreview(true);

    try {
      // Buscar TurnosProgramados para las fechas seleccionadas
      const q = query(
        collection(db, 'TurnosProgramados'),
        where('colaboradorId', '==', colaboradorId),
        where('sucursalId', '==', sucursalOrigenId.toString())
      );
      const snap = await getDocs(q);
      const todos = snap.docs.map(d => d.data() as TurnoProgramado);

      const turnosEncontrados: TransferModalState['turnosOrigen'] = fechasSeleccionadas.map(fecha => {
        const turno = todos.find(t => t.fecha === fecha && t.estado === 'programado');
        return turno
          ? {
              fecha,
              turnoId: turno.id,
              estado: turno.estado,
              horario: {
                inicio: turno.horarioSnapshot.inicio,
                termino: turno.horarioSnapshot.termino,
                cruzaMedianoche: turno.horarioSnapshot.cruzaMedianoche ?? false,
              },
            }
          : { fecha, turnoId: '', estado: 'no_encontrado', horario: { inicio: '07:30', termino: '19:30', cruzaMedianoche: false } };
      });

      setTurnosOrigen(turnosEncontrados);
      setStep('conflict_review');
    } catch (err: any) {
      setError('Error buscando turnos. Intenta nuevamente.');
    } finally {
      setIsLoadingPreview(false);
    }
  }, [fechasSeleccionadas, colaboradorId, sucursalOrigenId]);

  // ── Paso 2 → 3: Cargar preview de conflictos en destino ──────────────────

  const handleNextToConfiguration = useCallback(async () => {
    if (!sucursalDestinoId) {
      setError('Selecciona una sucursal destino.');
      return;
    }
    setError(null);
    setIsLoadingPreview(true);

    try {
      const turnosValidos = turnosOrigen.filter(t => t.turnoId !== '');
      const previews = await previewMultipleConflicts(
        turnosValidos.map(t => ({
          colaboradorId,
          fecha: t.fecha,
          horario: t.horario,
        }))
      );
      setConflictPreview(previews.map((p, i) => ({
        fecha: p.fecha,
        turnoId: turnosValidos[i]?.turnoId ?? '',
        conflict: p.conflict,
      })));
      setStep('configuration');
    } catch (err) {
      setStep('configuration'); // Continuar aunque falle el preview
    } finally {
      setIsLoadingPreview(false);
    }
  }, [sucursalDestinoId, turnosOrigen, colaboradorId]);

  // ── Paso 3 → 4: Confirmación ──────────────────────────────────────────────

  const handleNextToConfirmation = useCallback(() => {
    if (!motivo.trim()) {
      setError('El motivo del traslado es requerido.');
      return;
    }
    setError(null);
    setStep('confirmation');
  }, [motivo]);

  // ── Confirmar traslado ────────────────────────────────────────────────────

  const handleConfirm = useCallback(async () => {
    setIsProcessing(true);
    setError(null);

    try {
      const turnosValidos = turnosOrigen.filter(t => t.turnoId !== '');
      if (turnosValidos.length === 0) {
        setError('No hay turnos programados válidos para trasladar.');
        return;
      }

      const operationRequestId = generateOperationRequestId(
        colaboradorId,
        sucursalDestinoId,
        turnosValidos.map(t => t.fecha),
        tipoOperacion
      );

      const payload = {
        turnoProgramadoIds: turnosValidos.map(t => t.turnoId),
        sucursalDestinoId,
        tipoOperacion,
        motivo: motivo.trim(),
        operationRequestId,
        ...(useManualHorario && horarioManual ? { horarioManual } : {}),
        confirmInsufficientRest,
        restWarningMotivo: confirmInsufficientRest ? restWarningMotivo : undefined,
      };

      const transferResult = await transferShifts(payload);
      setResult(transferResult);
      onTransferComplete?.(transferResult);
    } catch (err: any) {
      setError(err?.message ?? 'Error al procesar el traslado. Intenta nuevamente.');
    } finally {
      setIsProcessing(false);
    }
  }, [
    turnosOrigen, colaboradorId, sucursalDestinoId, tipoOperacion, motivo,
    useManualHorario, horarioManual, confirmInsufficientRest, restWarningMotivo, onTransferComplete,
  ]);

  if (!isOpen) return null;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const conflictosBloqueantes = conflictPreview.filter(c =>
    ['partial', 'total', 'identical'].includes(c.conflict.type)
  );
  const advertenciasDescanso = conflictPreview.filter(c => c.conflict.type === 'insufficient_rest');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-orange-500 to-orange-600 text-white shrink-0">
          <div>
            <h2 className="text-lg font-black">Traslado de Turno</h2>
            <p className="text-orange-100 text-sm">{colaboradorNombre} · {colaboradorRut}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/20 transition"
            disabled={isProcessing}
          >
            <X size={20} />
          </button>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-1 px-6 py-3 bg-orange-50 border-b border-orange-100 shrink-0">
          {(['Fechas', 'Sucursal', 'Configurar', 'Confirmar'] as const).map((label, i) => {
            const steps: ModalStep[] = ['selection', 'conflict_review', 'configuration', 'confirmation'];
            const active = step === steps[i];
            const done = steps.indexOf(step) > i || !!result;
            return (
              <React.Fragment key={label}>
                <div className={`flex items-center gap-1.5 text-xs font-bold ${active ? 'text-orange-600' : done ? 'text-green-600' : 'text-slate-400'}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${active ? 'bg-orange-500 text-white' : done ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                    {done && !active ? '✓' : i + 1}
                  </div>
                  <span className="hidden sm:inline">{label}</span>
                </div>
                {i < 3 && <div className="flex-1 h-px bg-slate-200 mx-1" />}
              </React.Fragment>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">

          {/* Header de sucursal origen */}
          <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm">
            <Building2 size={16} className="text-slate-500 shrink-0" />
            <span className="text-slate-600">Sucursal origen:</span>
            <span className="font-bold text-slate-800">{sucursalOrigenNombre}</span>
          </div>

          {/* ── PASO 1: Selección de fechas ────────────────────────────── */}
          {step === 'selection' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Calendar size={16} className="text-orange-500" />
                <h3 className="font-bold text-slate-800">Seleccionar fechas a trasladar</h3>
              </div>
              <p className="text-sm text-slate-500">
                Las fechas ya fueron preseleccionadas. Puedes agregar o quitar fechas.
              </p>
              <div className="flex flex-wrap gap-2">
                {fechasSeleccionadas.map(f => (
                  <div key={f} className="flex items-center gap-1 px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-sm font-semibold">
                    <Calendar size={12} />
                    {f}
                    <button
                      onClick={() => setFechasSeleccionadas(prev => prev.filter(x => x !== f))}
                      className="ml-1 hover:text-red-600"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              {fechasSeleccionadas.length === 0 && (
                <p className="text-sm text-slate-400 italic">No hay fechas seleccionadas. Cierra este modal y selecciona al menos un turno programado.</p>
              )}
            </div>
          )}

          {/* ── PASO 2: Selección de sucursal destino ─────────────────── */}
          {step === 'conflict_review' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Building2 size={16} className="text-orange-500" />
                <h3 className="font-bold text-slate-800">Seleccionar sucursal destino</h3>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Sucursal destino</label>
                <select
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  value={sucursalDestinoId}
                  onChange={e => setSucursalDestinoId(e.target.value)}
                >
                  <option value="">— Seleccionar sucursal —</option>
                  {sitiosDestino.map(s => (
                    <option key={s.id} value={s.id.toString()}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Turnos encontrados */}
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-700">Turnos a trasladar:</p>
                {turnosOrigen.map(t => (
                  <div key={t.fecha} className={`flex items-center justify-between p-2.5 rounded-lg border text-sm ${t.turnoId ? 'bg-white border-slate-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-center gap-2">
                      <Calendar size={12} className="text-slate-400" />
                      <span className="font-semibold">{t.fecha}</span>
                    </div>
                    {t.turnoId
                      ? <span className="text-slate-500 font-mono text-xs">{t.horario.inicio}–{t.horario.termino}</span>
                      : <span className="text-red-500 text-xs font-semibold">Sin turno programado</span>
                    }
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── PASO 3: Configuración ─────────────────────────────────── */}
          {step === 'configuration' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-orange-500" />
                <h3 className="font-bold text-slate-800">Configuración del traslado</h3>
              </div>

              {/* Destino confirmado */}
              <div className="flex items-center gap-2 p-3 bg-orange-50 rounded-xl border border-orange-200 text-sm">
                <ArrowRight size={14} className="text-orange-500" />
                <span className="text-orange-700 font-semibold">Destino: {sitioDestinoSeleccionado?.name}</span>
              </div>

              {/* Preview de conflictos */}
              {conflictPreview.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                    <Info size={12} /> Preview de conflictos (informativo — no autoritativo)
                  </p>
                  {conflictPreview.map(c => (
                    <div key={c.fecha} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100 text-sm">
                      <span className="font-semibold">{c.fecha}</span>
                      {conflictBadge(c.conflict.type)}
                    </div>
                  ))}
                  {conflictosBloqueantes.length > 0 && (
                    <div className="p-3 bg-red-50 rounded-lg border border-red-200 text-sm text-red-700">
                      <p className="font-bold flex items-center gap-1"><AlertTriangle size={14} /> {conflictosBloqueantes.length} conflicto(s) detectado(s)</p>
                      <p className="text-xs mt-1">El backend tomará la decisión final. Puedes continuar para que el sistema procese solo los turnos válidos.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Tipo de operación */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Tipo de operación</label>
                <select
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  value={tipoOperacion}
                  onChange={e => setTipoOperacion(e.target.value as TransferModalState['tipoOperacion'])}
                >
                  {TIPO_OPCIONES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              {/* Motivo */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Motivo del traslado *</label>
                <textarea
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                  rows={3}
                  placeholder="Ej: Refuerzo por baja de personal en sucursal destino"
                  value={motivo}
                  onChange={e => setMotivo(e.target.value)}
                />
              </div>

              {/* Confirmación de descanso insuficiente */}
              {advertenciasDescanso.length > 0 && (
                <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200 space-y-2">
                  <p className="text-sm font-bold text-yellow-700 flex items-center gap-1">
                    <AlertCircle size={14} /> Advertencia de descanso insuficiente
                  </p>
                  <label className="flex items-center gap-2 text-sm text-yellow-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmInsufficientRest}
                      onChange={e => setConfirmInsufficientRest(e.target.checked)}
                    />
                    Confirmo que acepto continuar con el descanso insuficiente
                  </label>
                  {confirmInsufficientRest && (
                    <input
                      type="text"
                      className="w-full border border-yellow-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      placeholder="Motivo para continuar con descanso insuficiente"
                      value={restWarningMotivo}
                      onChange={e => setRestWarningMotivo(e.target.value)}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── PASO 4: Confirmación y resultado ─────────────────────── */}
          {step === 'confirmation' && (
            <div className="space-y-4">
              {!result ? (
                <>
                  <div className="p-4 bg-orange-50 rounded-xl border border-orange-200 space-y-3">
                    <h3 className="font-bold text-orange-800 flex items-center gap-2">
                      <AlertTriangle size={16} /> Confirmar traslado
                    </h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-slate-500 text-xs">Colaborador</p>
                        <p className="font-semibold">{colaboradorNombre}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs">Origen → Destino</p>
                        <p className="font-semibold">{sucursalOrigenNombre} → {sitioDestinoSeleccionado?.name}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs">Fechas</p>
                        <p className="font-semibold">{turnosOrigen.filter(t => t.turnoId).length} turno(s)</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs">Tipo</p>
                        <p className="font-semibold">{TIPO_OPCIONES.find(o => o.value === tipoOperacion)?.label}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs">Motivo</p>
                      <p className="text-sm italic text-slate-700">"{motivo}"</p>
                    </div>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-sm text-blue-700 flex items-start gap-2">
                    <Info size={14} className="mt-0.5 shrink-0" />
                    <p>El backend validará los conflictos finales. La operación es parcial: los turnos sin conflicto se trasladarán aunque otros fallen.</p>
                  </div>
                </>
              ) : (
                // Resultado de la operación
                <div className="space-y-3">
                  <div className={`p-4 rounded-xl border ${result.success ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
                    <h3 className={`font-bold flex items-center gap-2 ${result.success ? 'text-green-700' : 'text-yellow-700'}`}>
                      {result.success ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                      {result.summary.transferred} de {result.summary.total} turno(s) trasladado(s)
                    </h3>
                    <p className="text-sm text-slate-600 mt-1">
                      Conflictos: {result.summary.conflicts} · Errores: {result.summary.errors} · Ya trasladados: {result.summary.alreadyTransferred}
                    </p>
                  </div>

                  {result.results.map(r => (
                    <div key={r.turnoOrigenId} className={`flex items-center justify-between p-2.5 rounded-lg border text-sm ${r.status === 'transferred' || r.status === 'already_exists' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                      <span className="font-mono text-xs text-slate-500">{r.turnoOrigenId.slice(-12)}</span>
                      <span className={`font-bold ${r.status === 'transferred' || r.status === 'already_exists' ? 'text-green-700' : 'text-red-700'}`}>
                        {r.status === 'transferred' ? '✓ Trasladado'
                          : r.status === 'already_exists' ? '✓ Ya existía'
                          : r.status === 'already_transferred' ? '→ Ya estaba trasladado'
                          : r.status === 'conflict_blocked' ? '✗ Conflicto'
                          : r.status === 'not_found' ? '✗ No encontrado'
                          : '✗ Error'}
                      </span>
                    </div>
                  ))}

                  {result.contractAlerts.length > 0 && (
                    <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200 text-sm text-yellow-700">
                      <p className="font-bold">⚠ {result.contractAlerts.length} alerta(s) contractual(es)</p>
                      <p className="text-xs mt-0.5">Los turnos destino tienen estado contractual ≠ compatible. RRHH será notificado vía auditoría.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Error global */}
          {error && (
            <div className="p-3 bg-red-50 rounded-lg border border-red-200 text-sm text-red-700 flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50 shrink-0">
          <button
            onClick={() => {
              if (result) { onClose(); return; }
              if (step === 'selection') onClose();
              else if (step === 'conflict_review') setStep('selection');
              else if (step === 'configuration') setStep('conflict_review');
              else if (step === 'confirmation') setStep('configuration');
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition"
            disabled={isProcessing}
          >
            <ArrowLeft size={14} />
            {result ? 'Cerrar' : step === 'selection' ? 'Cancelar' : 'Atrás'}
          </button>

          {!result && (
            <button
              onClick={() => {
                if (step === 'selection') handleNextToConflictReview();
                else if (step === 'conflict_review') handleNextToConfiguration();
                else if (step === 'configuration') handleNextToConfirmation();
                else if (step === 'confirmation') handleConfirm();
              }}
              disabled={isProcessing || isLoadingPreview || (step === 'confirmation' && isProcessing)}
              className="flex items-center gap-1.5 px-5 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold rounded-lg transition shadow text-sm"
            >
              {(isProcessing || isLoadingPreview) && <Loader2 size={14} className="animate-spin" />}
              {step === 'confirmation' ? 'Confirmar traslado' : 'Siguiente'}
              {!isProcessing && !isLoadingPreview && <ArrowRight size={14} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShiftTransferModal;
