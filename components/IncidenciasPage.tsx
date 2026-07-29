import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle,
  ChevronRight,
  Clock,
  FileText,
  Image,
  Loader2,
  MapPin,
  Plus,
  X,
  AlertCircle,
  BookOpen,
  ClipboardCheck,
  Activity,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  RegistroTipo,
  RegistroCategoria,
  RegistroPrioridad,
  RegistroEstado,
  RegistroNovedad,
} from '../types';
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Calcula la fecha operacional respetando turnos nocturnos */
function calcularFechaOperacional(turnoInicio?: string): string {
  const now = new Date();
  // Si hay turno iniciado, usar la fecha del check_in como base operacional
  if (turnoInicio) {
    const inicio = new Date(turnoInicio);
    const d = inicio;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Determina visibilidad automática para el Mandante según categoría y tipo */
function calcularVisibilidadMandante(categoria: RegistroCategoria, tipo: RegistroTipo): boolean {
  const visiblesParaMandante: RegistroCategoria[] = [
    'infraestructura',
    'seguridad',
    'alarma',
    'persona_sospechosa',
    'emergencia',
    'daño_desperfecto',
    'acceso_personas',
    'acceso_vehiculos',
    'entrega_recepcion_turno',
    'objeto_encontrado',
  ];
  if (tipo === 'incidencia') return true;
  return visiblesParaMandante.includes(categoria);
}

// ─── Configuración de Categorías ────────────────────────────────────────────

const CATEGORIAS: { value: RegistroCategoria; label: string; icon: string }[] = [
  { value: 'acceso_personas', label: 'Acceso de personas', icon: '🚶' },
  { value: 'acceso_vehiculos', label: 'Acceso de vehículos', icon: '🚗' },
  { value: 'infraestructura', label: 'Infraestructura', icon: '🏗️' },
  { value: 'seguridad', label: 'Seguridad', icon: '🛡️' },
  { value: 'alarma', label: 'Alarma', icon: '🚨' },
  { value: 'persona_sospechosa', label: 'Persona sospechosa', icon: '👀' },
  { value: 'objeto_encontrado', label: 'Objeto encontrado', icon: '📦' },
  { value: 'daño_desperfecto', label: 'Daño o desperfecto', icon: '⚠️' },
  { value: 'emergencia', label: 'Emergencia', icon: '🆘' },
  { value: 'entrega_recepcion_turno', label: 'Entrega/Recepción de turno', icon: '🔄' },
  { value: 'otro', label: 'Otro', icon: '📝' },
];

const UBICACIONES_INSTALACION = [
  'Acceso principal',
  'Portería',
  'Estacionamiento',
  'Bodega',
  'Perímetro',
  'Sala de servidores',
  'Área de carga',
  'Patio interior',
  'Oficinas',
  'Otro',
];

const PRIORIDAD_CONFIG: Record<RegistroPrioridad, { label: string; color: string; bg: string; border: string }> = {
  informativa: { label: 'Informativa', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  media:       { label: 'Media',       color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200' },
  alta:        { label: 'Alta',        color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
  critica:     { label: 'Crítica',     color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-200' },
};

// ─── Tipos internos del componente ──────────────────────────────────────────

type VistaInterna = 'lista' | 'formulario' | 'confirmar' | 'detalle';

interface FormState {
  tipoRegistro: RegistroTipo;
  categoria: RegistroCategoria | '';
  descripcion: string;
  ubicacionInstalacion: string;
  prioridad: RegistroPrioridad;
  fotos: string[]; // Base64 o URL preview
  fotosBlob: Blob[]; // Para subir
}

interface RegistroListItem {
  id: string;
  tipoRegistro: RegistroTipo;
  categoria: RegistroCategoria;
  descripcion: string;
  estado: RegistroEstado;
  prioridad: RegistroPrioridad;
  fechaHoraDispositivo?: string;
  evidencias?: string[];
  sucursalNombre?: string;
  autorNombre: string;     // Nombre del guardia que lo registró
  autorUid: string;        // Para saber si es registro propio
  ubicacionInstalacion?: string;
}

const PAGE_SIZE = 50;

// ─── Componente Principal ───────────────────────────────────────────────────

interface IncidenciasPageProps {
  onBack: () => void;
  activeLog?: { id: string; timestamp: string; siteId?: string | number; siteName?: string; shiftId?: string };
  currentSite?: { id: number | string; name: string };
  employee: { id: string; firstName: string; lastNamePaterno: string; cargo: string };
}

const IncidenciasPage: React.FC<IncidenciasPageProps> = ({ onBack, activeLog, currentSite, employee }) => {
  const currentUser = useAppStore(state => state.currentUser);
  const addRegistroNovedad = useAppStore(state => state.addRegistroNovedad);
  const uploadFile = useAppStore(state => state.uploadFile);
  const showNotification = useAppStore(state => state.showNotification);

  const [vista, setVista] = useState<VistaInterna>('lista');
  const [registros, setRegistros] = useState<RegistroListItem[]>([]);
  const [loadingRegistros, setLoadingRegistros] = useState(false);
  const [hayMasRegistros, setHayMasRegistros] = useState(false);
  const [lastDocSnapshot, setLastDocSnapshot] = useState<any>(null);
  const [loadingMas, setLoadingMas] = useState(false);
  const [registroDetalle, setRegistroDetalle] = useState<RegistroListItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const [form, setForm] = useState<FormState>({
    tipoRegistro: 'novedad',
    categoria: '',
    descripcion: '',
    ubicacionInstalacion: '',
    prioridad: 'informativa',
    fotos: [],
    fotosBlob: [],
  });

  // Sucursal activa: preferir la del turno activo, sino la asignada
  const sucursalActiva = activeLog?.siteId ?? currentSite?.id;

  // ── Bloqueo estricto sin turno activo ────────────────────────────────────
  const turnoActivo = !!activeLog;

  // ── Helper: parsear un documento Firestore a RegistroListItem ────────────
  const parseDocToItem = (d: any): RegistroListItem | null => {
    const data = d.data ? d.data() : d;
    if (!data.tipoRegistro) return null; // Ignorar registros viejos sin tipoRegistro
    return {
      id: d.id,
      tipoRegistro: data.tipoRegistro,
      categoria: data.categoria,
      descripcion: data.descripcion,
      estado: data.estado || 'registrada',
      prioridad: data.prioridad || 'informativa',
      fechaHoraDispositivo: data.fechaHoraDispositivo,
      evidencias: data.evidencias,
      sucursalNombre: data.sucursalNombre,
      autorNombre: data.autorNombre || 'Guardia',
      autorUid: data.autorUid,
      ubicacionInstalacion: data.ubicacionInstalacion,
    };
  };

  // ── Cargar primera página: registros de la misma sucursal ────────────────
  const cargarRegistros = useCallback(async () => {
    if (!currentUser || !sucursalActiva) return;
    setLoadingRegistros(true);
    try {
      // Pedir PAGE_SIZE + 1 para detectar si hay más páginas
      const q = query(
        collection(db, 'novedades'),
        where('sucursalId', '==', sucursalActiva),
        orderBy('creadoEn', 'desc'),
        limit(PAGE_SIZE + 1)
      );
      const snap = await getDocs(q);
      const docs = snap.docs;
      const hayMas = docs.length > PAGE_SIZE;
      const visibles = hayMas ? docs.slice(0, PAGE_SIZE) : docs;
      const items = visibles.map(parseDocToItem).filter(Boolean) as RegistroListItem[];
      setRegistros(items);
      setHayMasRegistros(hayMas);
      setLastDocSnapshot(visibles.length > 0 ? visibles[visibles.length - 1] : null);
    } catch (err) {
      console.warn('[IncidenciasPage] Error cargando registros:', err);
    } finally {
      setLoadingRegistros(false);
    }
  }, [currentUser, sucursalActiva]);

  // ── Cargar página siguiente ──────────────────────────────────────────────
  const cargarMasRegistros = async () => {
    if (!currentUser || !sucursalActiva || !lastDocSnapshot || loadingMas) return;
    setLoadingMas(true);
    try {
      const { startAfter } = await import('firebase/firestore');
      const q = query(
        collection(db, 'novedades'),
        where('sucursalId', '==', sucursalActiva),
        orderBy('creadoEn', 'desc'),
        startAfter(lastDocSnapshot),
        limit(PAGE_SIZE + 1)
      );
      const snap = await getDocs(q);
      const docs = snap.docs;
      const hayMas = docs.length > PAGE_SIZE;
      const visibles = hayMas ? docs.slice(0, PAGE_SIZE) : docs;
      const items = visibles.map(parseDocToItem).filter(Boolean) as RegistroListItem[];
      setRegistros(prev => [...prev, ...items]);
      setHayMasRegistros(hayMas);
      setLastDocSnapshot(visibles.length > 0 ? visibles[visibles.length - 1] : null);
    } catch (err) {
      console.warn('[IncidenciasPage] Error cargando más registros:', err);
    } finally {
      setLoadingMas(false);
    }
  };

  useEffect(() => {
    cargarRegistros();
  }, [cargarRegistros]);

  // ── Resetear prioridad según tipo ────────────────────────────────────────
  useEffect(() => {
    setForm(f => ({
      ...f,
      prioridad: f.tipoRegistro === 'incidencia' ? 'media' : 'informativa',
    }));
  }, [form.tipoRegistro]);

  // ── Tomar/seleccionar foto ───────────────────────────────────────────────
  const handleAgregarFoto = async (source: 'camera' | 'gallery') => {
    if (form.fotos.length >= 3) {
      showNotification('Máximo 3 fotografías por registro.', 'warning');
      return;
    }
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      if (source === 'camera') input.capture = 'environment';
      input.onchange = (e: any) => {
        const file: File = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string;
          setForm(f => ({
            ...f,
            fotos: [...f.fotos, dataUrl],
            fotosBlob: [...f.fotosBlob, file],
          }));
        };
        reader.readAsDataURL(file);
      };
      input.click();
    } catch (err: any) {
      console.warn('[IncidenciasPage] Error al obtener foto:', err);
      showNotification('No se pudo obtener la fotografía.', 'error');
    }
  };

  const handleEliminarFoto = (idx: number) => {
    setForm(f => ({
      ...f,
      fotos: f.fotos.filter((_, i) => i !== idx),
      fotosBlob: f.fotosBlob.filter((_, i) => i !== idx),
    }));
  };

  // ── Validación del formulario ────────────────────────────────────────────
  const formValido = form.categoria !== '' && form.descripcion.trim().length >= 10;

  // ── Guardar registro ─────────────────────────────────────────────────────
  const handleConfirmarRegistro = async () => {
    if (submitting) return;
    if (!currentUser || !employee) return;
    if (!formValido) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      // 1. Subir fotos
      const evidenciaUrls: string[] = [];
      for (let i = 0; i < form.fotosBlob.length; i++) {
        const blob = form.fotosBlob[i];
        const path = `novedades/${currentUser.uid}/${Date.now()}_${i}.jpg`;
        try {
          const url = await uploadFile(blob, path);
          evidenciaUrls.push(url);
        } catch (uploadErr) {
          console.warn('[IncidenciasPage] Error subiendo foto:', uploadErr);
          // Continuar sin la foto si falla
        }
      }

      // 2. Construir datos del registro
      const categoria = form.categoria as RegistroCategoria;
      const fechaOp = calcularFechaOperacional(activeLog?.timestamp);
      const autorNombre = `${employee.firstName} ${employee.lastNamePaterno}`;

      // Firestore rechaza `undefined` — omitir campos opcionales con spread condicional
      const data: Omit<RegistroNovedad, 'id' | 'creadoEn' | 'fechaHoraServidor'> = {
        // Identificación operacional
        sucursalId: activeLog?.siteId ?? currentSite?.id ?? '',
        sucursalNombre: activeLog?.siteName || currentSite?.name || 'Sin sucursal',
        fechaOperacional: fechaOp,
        // Clasificación
        tipoRegistro: form.tipoRegistro,
        categoria,
        descripcion: form.descripcion.trim(),
        prioridad: form.prioridad,
        // Autor
        autorUid: currentUser.uid,
        colaboradorId: employee.id,
        autorNombre,
        autorRol: currentUser.role,
        // Tiempos
        fechaHoraDispositivo: new Date().toISOString(),
        zonaHoraria: 'America/Santiago',
        // Estado
        estado: 'registrada',
        visibleParaMandante: calcularVisibilidadMandante(categoria, form.tipoRegistro),
        // Campos opcionales — solo se incluyen si tienen valor (undefined rompe Firestore)
        ...(activeLog?.id ? { turnoId: activeLog.id } : {}),
        ...(form.ubicacionInstalacion ? { ubicacionInstalacion: form.ubicacionInstalacion } : {}),
        ...(evidenciaUrls.length > 0 ? { evidencias: evidenciaUrls } : {}),
      };


      await addRegistroNovedad(data);

      // 3. Éxito
      setSubmitSuccess(true);
      showNotification('Registro guardado correctamente.', 'success');

      // Volver a lista después de 2 segundos
      setTimeout(() => {
        setSubmitSuccess(false);
        setForm({
          tipoRegistro: 'novedad',
          categoria: '',
          descripcion: '',
          ubicacionInstalacion: '',
          prioridad: 'informativa',
          fotos: [],
          fotosBlob: [],
        });
        setVista('lista');
        cargarRegistros();
      }, 2000);

    } catch (err: any) {
      console.error('[IncidenciasPage] Error guardando registro:', err);
      setSubmitError('No fue posible guardar el registro. Revisa tu conexión e inténtalo nuevamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleNuevoRegistro = () => {
    setForm({
      tipoRegistro: 'novedad',
      categoria: '',
      descripcion: '',
      ubicacionInstalacion: '',
      prioridad: 'informativa',
      fotos: [],
      fotosBlob: [],
    });
    setSubmitError(null);
    setSubmitSuccess(false);
    setVista('formulario');
  };

  // ─── RENDER: Estado de éxito ──────────────────────────────────────────────
  if (submitSuccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6 p-8 animate-in zoom-in-95 fade-in duration-500">
        <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center shadow-inner">
          <CheckCircle size={56} className="text-emerald-500" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">¡Registrado!</h2>
          <p className="text-slate-500 font-medium">Registro guardado correctamente.</p>
        </div>
        <div className="px-6 py-3 bg-emerald-50 rounded-2xl border border-emerald-100 text-xs font-black uppercase tracking-widest text-emerald-600">
          Volviendo al historial...
        </div>
      </div>
    );
  }

  // ─── RENDER: Sin turno activo (bloqueo estricto) ──────────────────────────
  if (!turnoActivo) {
    return (
      <div className="flex flex-col min-h-screen bg-slate-50">
        <div className="bg-white p-4 flex items-center gap-4 sticky top-0 z-30 shadow-sm border-b">
          <button onClick={onBack} className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-all">
            <ArrowLeft size={24} />
          </button>
          <div>
            <h2 className="font-black text-slate-800 tracking-tight text-lg">Incidencias y Novedades</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Registro de turno</p>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center p-8">
          <div className="bg-white rounded-[2.5rem] p-8 shadow-lg border border-slate-100 text-center space-y-5 max-w-sm w-full">
            <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto">
              <AlertCircle size={32} className="text-amber-500" />
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-800 tracking-tight">Sin turno activo</h3>
              <p className="text-slate-500 font-medium mt-2 leading-relaxed">
                No tienes un turno activo.<br />
                Debes iniciar tu turno antes de registrar una incidencia o novedad.
              </p>
            </div>
            <button
              onClick={onBack}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black uppercase tracking-widest text-sm shadow-lg shadow-blue-200 active:scale-95 transition-all"
            >
              Volver al Inicio
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── RENDER: Detalle de un registro ──────────────────────────────────────
  if (vista === 'detalle' && registroDetalle) {
    const prio = PRIORIDAD_CONFIG[registroDetalle.prioridad];
    const catLabel = CATEGORIAS.find(c => c.value === registroDetalle.categoria)?.label || registroDetalle.categoria;
    const esPropio = registroDetalle.autorUid === currentUser?.uid;
    return (
      <div className="flex flex-col min-h-screen bg-slate-50">
        <div className="bg-white p-4 flex items-center gap-4 sticky top-0 z-30 shadow-sm border-b">
          <button onClick={() => setVista('lista')} className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-all">
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h2 className="font-black text-slate-800 tracking-tight text-lg">Detalle del registro</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
              {esPropio ? 'Tu registro' : `Registrado por ${registroDetalle.autorNombre}`}
            </p>
          </div>
        </div>
        <div className="p-6 space-y-5 max-w-lg mx-auto w-full pb-20">
          {/* Tipo, prioridad y estado */}
          <div className="flex gap-2 flex-wrap">
            <span className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest ${registroDetalle.tipoRegistro === 'incidencia' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
              {registroDetalle.tipoRegistro}
            </span>
            <span className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest ${prio.bg} ${prio.color}`}>
              {prio.label}
            </span>
            <span className="px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest bg-emerald-100 text-emerald-700">
              {registroDetalle.estado}
            </span>
            {esPropio && (
              <span className="px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest bg-blue-600 text-white">
                Mi registro
              </span>
            )}
          </div>


          {/* Categoría y metadatos */}
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm space-y-3 divide-y divide-slate-50">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Categoría</p>
              <p className="font-bold text-slate-800">{catLabel}</p>
            </div>
            {registroDetalle.ubicacionInstalacion && (
              <div className="pt-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Ubicación en instalación</p>
                <p className="font-bold text-slate-800">{registroDetalle.ubicacionInstalacion}</p>
              </div>
            )}
            {registroDetalle.sucursalNombre && (
              <div className="pt-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Sucursal</p>
                <p className="font-bold text-slate-800">{registroDetalle.sucursalNombre}</p>
              </div>
            )}
            <div className="pt-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Guardia</p>
              <p className="font-bold text-slate-800">
                {esPropio ? `${registroDetalle.autorNombre} (Tú)` : registroDetalle.autorNombre}
              </p>
            </div>
            <div className="pt-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Fecha y Hora</p>
              <p className="font-bold text-slate-800">
                {registroDetalle.fechaHoraDispositivo
                  ? new Date(registroDetalle.fechaHoraDispositivo).toLocaleString('es-CL', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                      hour: '2-digit', minute: '2-digit'
                    })
                  : '--'}
              </p>
            </div>
          </div>


          {/* Descripción */}
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Descripción</p>
            <p className="text-slate-700 font-medium leading-relaxed">{registroDetalle.descripcion}</p>
          </div>

          {/* Fotos */}
          {registroDetalle.evidencias && registroDetalle.evidencias.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                Fotografías ({registroDetalle.evidencias.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {registroDetalle.evidencias.map((url, i) => (
                  <img key={i} src={url} alt={`Evidencia ${i + 1}`} className="w-full h-24 object-cover rounded-xl border border-slate-100" />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── RENDER: Confirmación ─────────────────────────────────────────────────
  if (vista === 'confirmar') {
    const prio = PRIORIDAD_CONFIG[form.prioridad];
    const catLabel = CATEGORIAS.find(c => c.value === form.categoria)?.label || '';
    return (
      <div className="flex flex-col min-h-screen bg-slate-50">
        <div className="bg-white p-4 flex items-center gap-4 sticky top-0 z-30 shadow-sm border-b">
          <button onClick={() => setVista('formulario')} className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-all" disabled={submitting}>
            <ArrowLeft size={24} />
          </button>
          <div>
            <h2 className="font-black text-slate-800 tracking-tight text-lg">Confirmar registro</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Revisa antes de guardar</p>
          </div>
        </div>

        <div className="p-6 space-y-5 max-w-lg mx-auto w-full pb-24">
          {/* Resumen */}
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden divide-y divide-slate-100">
            <div className="p-4 flex justify-between items-center">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo</span>
              <span className={`px-3 py-1 rounded-full text-xs font-black uppercase ${form.tipoRegistro === 'incidencia' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                {form.tipoRegistro}
              </span>
            </div>
            <div className="p-4 flex justify-between items-center">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Categoría</span>
              <span className="font-bold text-slate-700 text-sm text-right">{catLabel}</span>
            </div>
            <div className="p-4 flex justify-between items-center">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Prioridad</span>
              <span className={`px-3 py-1 rounded-full text-xs font-black ${prio.bg} ${prio.color}`}>{prio.label}</span>
            </div>
            <div className="p-4 flex justify-between items-center">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sucursal</span>
              <span className="font-bold text-slate-700 text-sm text-right max-w-[55%]">
                {activeLog?.siteName || currentSite?.name || 'Sin sucursal'}
              </span>
            </div>
            {form.ubicacionInstalacion && (
              <div className="p-4 flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ubicación</span>
                <span className="font-bold text-slate-700 text-sm text-right">{form.ubicacionInstalacion}</span>
              </div>
            )}
            <div className="p-4">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Descripción</span>
              <p className="text-slate-700 font-medium text-sm leading-relaxed">{form.descripcion}</p>
            </div>
            {form.fotos.length > 0 && (
              <div className="p-4">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                  Evidencias ({form.fotos.length} fotografía{form.fotos.length > 1 ? 's' : ''})
                </span>
                <div className="flex gap-2">
                  {form.fotos.map((src, i) => (
                    <img key={i} src={src} alt="" className="w-16 h-16 object-cover rounded-xl border border-slate-100" />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Error */}
          {submitError && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex gap-3">
              <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm font-bold text-red-700">{submitError}</p>
            </div>
          )}

          {/* Botones */}
          <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/95 backdrop-blur-sm border-t border-slate-100 flex gap-3">
            <button
              onClick={() => setVista('formulario')}
              disabled={submitting}
              className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-all disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirmarRegistro}
              disabled={submitting}
              className="flex-[2] py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg shadow-emerald-200 active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <><Loader2 size={18} className="animate-spin" /> Guardando...</>
              ) : (
                <><CheckCircle size={18} /> Confirmar y registrar</>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── RENDER: Formulario de registro ──────────────────────────────────────
  if (vista === 'formulario') {
    return (
      <div className="flex flex-col min-h-screen bg-slate-50">
        <div className="bg-white p-4 flex items-center gap-4 sticky top-0 z-30 shadow-sm border-b">
          <button onClick={() => setVista('lista')} className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-all">
            <ArrowLeft size={24} />
          </button>
          <div>
            <h2 className="font-black text-slate-800 tracking-tight text-lg">Nuevo registro</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Incidencias y Novedades</p>
          </div>
        </div>

        <div className="p-6 space-y-6 max-w-lg mx-auto w-full pb-28">

          {/* ── TIPO DE REGISTRO ── */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Tipo de registro *</label>
            <div className="grid grid-cols-2 gap-3">
              {/* Novedad */}
              <button
                onClick={() => setForm(f => ({ ...f, tipoRegistro: 'novedad' }))}
                className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all active:scale-95 ${form.tipoRegistro === 'novedad' ? 'border-blue-500 bg-blue-50 shadow-md shadow-blue-100' : 'border-slate-200 bg-white'}`}
              >
                <BookOpen size={28} className={form.tipoRegistro === 'novedad' ? 'text-blue-600' : 'text-slate-400'} />
                <span className={`text-sm font-black uppercase tracking-wide ${form.tipoRegistro === 'novedad' ? 'text-blue-700' : 'text-slate-500'}`}>Novedad</span>
                <span className="text-[10px] text-slate-400 text-center leading-tight">Informativa o no crítica</span>
              </button>
              {/* Incidencia */}
              <button
                onClick={() => setForm(f => ({ ...f, tipoRegistro: 'incidencia' }))}
                className={`p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all active:scale-95 ${form.tipoRegistro === 'incidencia' ? 'border-red-500 bg-red-50 shadow-md shadow-red-100' : 'border-slate-200 bg-white'}`}
              >
                <AlertTriangle size={28} className={form.tipoRegistro === 'incidencia' ? 'text-red-600' : 'text-slate-400'} />
                <span className={`text-sm font-black uppercase tracking-wide ${form.tipoRegistro === 'incidencia' ? 'text-red-700' : 'text-slate-500'}`}>Incidencia</span>
                <span className="text-[10px] text-slate-400 text-center leading-tight">Requiere atención o seguimiento</span>
              </button>
            </div>
          </div>

          {/* ── CATEGORÍA ── */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Categoría *</label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIAS.map(cat => (
                <button
                  key={cat.value}
                  onClick={() => setForm(f => ({ ...f, categoria: cat.value }))}
                  className={`p-3 rounded-2xl border-2 flex items-center gap-2 transition-all active:scale-95 text-left ${form.categoria === cat.value ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'}`}
                >
                  <span className="text-xl flex-shrink-0">{cat.icon}</span>
                  <span className={`text-xs font-bold leading-tight ${form.categoria === cat.value ? 'text-blue-700' : 'text-slate-600'}`}>{cat.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── DESCRIPCIÓN ── */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Descripción *</label>
            <textarea
              value={form.descripcion}
              onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
              rows={4}
              placeholder="Describe qué ocurrió, dónde ocurrió y cualquier acción realizada."
              className="w-full px-4 py-3 bg-white border-2 border-slate-200 rounded-2xl focus:border-blue-500 outline-none transition-all font-medium text-slate-700 placeholder-slate-400 resize-none text-sm"
            />
            <div className="flex justify-between items-center px-1">
              <p className="text-[10px] text-slate-400 font-medium">Mínimo 10 caracteres</p>
              <p className={`text-[10px] font-bold ${form.descripcion.length < 10 ? 'text-red-400' : 'text-emerald-500'}`}>
                {form.descripcion.length} / 1000
              </p>
            </div>
          </div>

          {/* ── PRIORIDAD ── */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Prioridad</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(PRIORIDAD_CONFIG) as RegistroPrioridad[]).map(p => {
                const cfg = PRIORIDAD_CONFIG[p];
                return (
                  <button
                    key={p}
                    onClick={() => setForm(f => ({ ...f, prioridad: p }))}
                    className={`py-3 px-4 rounded-2xl border-2 font-black text-xs uppercase tracking-widest transition-all active:scale-95 ${form.prioridad === p ? `${cfg.bg} ${cfg.color} border-current` : 'bg-white border-slate-200 text-slate-500'}`}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── UBICACIÓN DENTRO DE LA INSTALACIÓN (opcional) ── */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
              Ubicación en la instalación <span className="text-slate-300 font-normal">(opcional)</span>
            </label>
            <select
              value={form.ubicacionInstalacion}
              onChange={e => setForm(f => ({ ...f, ubicacionInstalacion: e.target.value }))}
              className="w-full px-4 py-3 bg-white border-2 border-slate-200 rounded-2xl focus:border-blue-500 outline-none transition-all font-medium text-slate-700 text-sm"
            >
              <option value="">— Seleccionar —</option>
              {UBICACIONES_INSTALACION.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          {/* ── FOTOGRAFÍAS (opcional) ── */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
              Fotografías <span className="text-slate-300 font-normal">(opcional, máx. 3)</span>
            </label>

            {/* Previews */}
            {form.fotos.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {form.fotos.map((src, i) => (
                  <div key={i} className="relative">
                    <img src={src} alt="" className="w-24 h-24 object-cover rounded-2xl border-2 border-slate-200" />
                    <button
                      onClick={() => handleEliminarFoto(i)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-md active:scale-90 transition-all"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Botones de foto */}
            {form.fotos.length < 3 && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleAgregarFoto('camera')}
                  className="p-4 bg-white border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center gap-2 active:scale-95 transition-all hover:border-blue-400 hover:bg-blue-50"
                >
                  <Camera size={22} className="text-slate-400" />
                  <span className="text-xs font-bold text-slate-500">Tomar foto</span>
                </button>
                <button
                  onClick={() => handleAgregarFoto('gallery')}
                  className="p-4 bg-white border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center gap-2 active:scale-95 transition-all hover:border-blue-400 hover:bg-blue-50"
                >
                  <Image size={22} className="text-slate-400" />
                  <span className="text-xs font-bold text-slate-500">Desde galería</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── BARRA INFERIOR FIJA ── */}
        <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/95 backdrop-blur-sm border-t border-slate-100">
          <button
            onClick={() => setVista('confirmar')}
            disabled={!formValido}
            className="w-full py-5 bg-blue-600 hover:bg-blue-700 text-white rounded-[2rem] font-black uppercase tracking-widest shadow-xl shadow-blue-200 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <ClipboardCheck size={22} />
            Revisar y confirmar
            <ChevronRight size={20} />
          </button>
          {!formValido && (
            <p className="text-center text-[10px] text-slate-400 font-bold mt-2 uppercase tracking-widest">
              {form.categoria === '' ? 'Selecciona una categoría' : 'Descripción mínima: 10 caracteres'}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ─── RENDER: Lista principal (Libro de Novedades de la Sucursal) ─────────
  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white p-4 flex items-center gap-4 sticky top-0 z-30 shadow-sm border-b">
        <button onClick={onBack} className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-all">
          <ArrowLeft size={24} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-black text-slate-800 tracking-tight text-lg leading-tight">Libro de Novedades</h2>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest truncate">
            {activeLog?.siteName || currentSite?.name || 'Mi sucursal'}
          </p>
        </div>
        <button
          onClick={cargarRegistros}
          disabled={loadingRegistros}
          className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl transition-all shrink-0"
        >
          <Activity size={18} className={loadingRegistros ? 'animate-spin text-blue-500' : ''} />
        </button>
      </div>

      {/* Banner informativo de la sucursal */}
      <div className="mx-4 mt-4 bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-4 flex items-center gap-3 shadow-md shadow-blue-100">
        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
          <MapPin size={20} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-black text-blue-200 uppercase tracking-widest">Sucursal activa — registros compartidos</p>
          <p className="font-black text-white text-sm truncate">{activeLog?.siteName || currentSite?.name || 'Sin asignación'}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-black text-blue-200 uppercase tracking-widest">Total</p>
          <p className="font-black text-white text-lg">{registros.length}</p>
        </div>
      </div>

      {/* Botón principal */}
      <div className="px-4 mt-3">
        <button
          onClick={handleNuevoRegistro}
          className="w-full py-5 bg-amber-500 hover:bg-amber-600 text-white rounded-[2rem] shadow-xl shadow-amber-200 flex items-center justify-center gap-3 transition-all active:scale-95 border-b-8 border-amber-700 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-12 -mt-12 blur-xl pointer-events-none" />
          <Plus size={26} />
          <span className="text-lg font-black tracking-wider uppercase">Registrar novedad</span>
        </button>
      </div>

      {/* Lista de registros */}
      <div className="px-4 pb-28 space-y-3 mt-4">
        <div className="flex items-center justify-between px-1 mb-1">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Registros de la sucursal
          </p>
          {registros.length > 0 && (
            <p className="text-[10px] font-bold text-slate-400">{registros.length} mostrados</p>
          )}
        </div>

        {loadingRegistros && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={32} className="text-blue-500 animate-spin" />
          </div>
        )}

        {!loadingRegistros && registros.length === 0 && (
          <div className="bg-white rounded-[2rem] p-10 border border-slate-100 text-center space-y-4 shadow-sm mt-2">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto">
              <FileText size={32} className="text-slate-400" />
            </div>
            <div>
              <p className="font-black text-slate-600 text-base">Sin registros</p>
              <p className="font-medium text-slate-400 text-sm mt-1 leading-relaxed">
                Aún no hay novedades ni incidencias registradas para esta sucursal.
              </p>
            </div>
          </div>
        )}

        {!loadingRegistros && registros.map(reg => {
          const prio = PRIORIDAD_CONFIG[reg.prioridad];
          const catLabel = CATEGORIAS.find(c => c.value === reg.categoria)?.label || reg.categoria;
          const catIcon = CATEGORIAS.find(c => c.value === reg.categoria)?.icon || '📝';
          const esPropio = reg.autorUid === currentUser?.uid;
          const fechaHora = reg.fechaHoraDispositivo ? new Date(reg.fechaHoraDispositivo) : null;

          return (
            <button
              key={reg.id}
              onClick={() => { setRegistroDetalle(reg); setVista('detalle'); }}
              className={`w-full rounded-[1.5rem] p-5 text-left transition-all active:scale-[0.98] space-y-3 shadow-sm hover:shadow-md ${
                esPropio
                  ? 'bg-blue-50 border-2 border-blue-100'
                  : 'bg-white border border-slate-100'
              }`}
            >
              {/* Fila superior: tipo + prioridad + hora */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                    reg.tipoRegistro === 'incidencia' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {reg.tipoRegistro}
                  </span>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${prio.bg} ${prio.color}`}>
                    {prio.label}
                  </span>
                  {esPropio && (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-blue-600 text-white">
                      Mi registro
                    </span>
                  )}
                </div>
                {fechaHora && (
                  <div className="text-right shrink-0">
                    <p className="text-[10px] font-black text-slate-400 flex items-center gap-1 justify-end">
                      <Clock size={11} />
                      {fechaHora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-[10px] text-slate-300 font-bold mt-0.5">
                      {fechaHora.toLocaleDateString([], { day: '2-digit', month: '2-digit' })}
                    </p>
                  </div>
                )}
              </div>

              {/* Categoría y descripción */}
              <div>
                <p className="text-xs font-black text-slate-500 flex items-center gap-1">
                  <span>{catIcon}</span> {catLabel}
                  {reg.ubicacionInstalacion && (
                    <span className="text-slate-300 font-normal"> · {reg.ubicacionInstalacion}</span>
                  )}
                </p>
                <p className="text-sm text-slate-700 font-medium mt-1.5 line-clamp-2 leading-relaxed">{reg.descripcion}</p>
              </div>

              {/* Fila inferior: estado + autor + fotos */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100/70">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest ${
                    reg.estado === 'registrada' ? 'bg-emerald-50 text-emerald-600' :
                    reg.estado === 'en_revision' ? 'bg-yellow-50 text-yellow-600' :
                    reg.estado === 'resuelta' ? 'bg-slate-100 text-slate-500' :
                    'bg-orange-50 text-orange-600'
                  }`}>
                    {reg.estado}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 truncate max-w-[120px]">
                    {esPropio ? 'Tú' : reg.autorNombre}
                  </span>
                </div>
                {reg.evidencias && reg.evidencias.length > 0 && (
                  <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 shrink-0">
                    <Camera size={12} /> {reg.evidencias.length} foto{reg.evidencias.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </button>
          );
        })}

        {/* Botón "Cargar más" */}
        {hayMasRegistros && !loadingRegistros && (
          <button
            onClick={cargarMasRegistros}
            disabled={loadingMas}
            className="w-full py-4 bg-white border-2 border-slate-200 rounded-2xl text-slate-600 font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50 hover:border-blue-300 hover:text-blue-600 mt-2"
          >
            {loadingMas ? (
              <><Loader2 size={18} className="animate-spin" /> Cargando...</>
            ) : (
              <><ChevronRight size={18} className="rotate-90" /> Cargar más registros</>
            )}
          </button>
        )}

        {/* Aviso de pie */}
        {registros.length > 0 && (
          <p className="text-center text-[10px] text-slate-300 font-bold uppercase tracking-widest pt-4 pb-2">
            Libro de Novedades — {activeLog?.siteName || currentSite?.name || 'Sucursal'}
          </p>
        )}
      </div>
    </div>
  );
};

export default IncidenciasPage;

