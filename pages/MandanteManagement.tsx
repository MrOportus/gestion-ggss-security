import React, { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { matchesEmployeeSearch } from '../lib/textUtils';
import type { MandanteViewMode } from '../types';
import {
  User,
  Search,
  CheckCircle,
  Square,
  Building2,
  Save,
  Navigation,
  ShieldCheck,
  Sliders,
  DoorOpen,
} from 'lucide-react';

const VIEW_MODE_OPTIONS: {
  id: MandanteViewMode;
  title: string;
  desc: string;
  badgeLabel: string;
  icon: React.ReactNode;
}[] = [
  {
    id: 'auto',
    title: 'Automático (según sucursal)',
    desc: 'Muestra rondas si la instalación las tiene activas; cambia a Control de Acceso en sucursales sin rondas.',
    badgeLabel: 'Vista Automática',
    icon: <Sliders size={18} />,
  },
  {
    id: 'con_rondas',
    title: 'Panel Completo (Con Rondas)',
    desc: 'Incluye resumen de guardias activos, métricas de rondas GPS, duración promedio y novedades.',
    badgeLabel: 'Panel con Rondas',
    icon: <Navigation size={18} />,
  },
  {
    id: 'sin_rondas',
    title: 'Solo Control de Acceso y Novedades',
    desc: 'Oculta el módulo de rondas; muestra accesos de personas/vehículos, cobertura del servicio y novedades.',
    badgeLabel: 'Solo Acceso y Novedades',
    icon: <DoorOpen size={18} />,
  },
];

const getViewModeShortBadge = (mode?: MandanteViewMode) => {
  if (mode === 'sin_rondas') {
    return { label: 'Solo Acceso y Novedades', cls: 'bg-amber-100 text-amber-800 border-amber-200' };
  }
  if (mode === 'con_rondas') {
    return { label: 'Con Rondas', cls: 'bg-blue-100 text-blue-800 border-blue-200' };
  }
  return { label: 'Auto (por sucursal)', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
};

const MandanteManagement: React.FC = () => {
  const { employees, sites, updateEmployee, showNotification } = useAppStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [siteSearchTerm, setSiteSearchTerm] = useState('');
  const [selectedMandante, setSelectedMandante] = useState<string | null>(null);
  const [savingViewMode, setSavingViewMode] = useState(false);

  const selectedEmp = useMemo(
    () => employees.find((e) => e.id === selectedMandante) || null,
    [employees, selectedMandante],
  );

  const activeViewMode: MandanteViewMode = selectedEmp?.mandanteViewMode || 'auto';

  const assignedSitesInfo = useMemo(() => {
    if (!selectedEmp) return { total: 0, withRounds: 0, withoutRounds: 0 };
    const assignedSet = new Set((selectedEmp.assignedSites || []).map((id) => String(id)));
    const assigned = sites.filter((s) => assignedSet.has(String(s.id)));
    const withRounds = assigned.filter((s) => Boolean(s.rondasEnabled)).length;
    return {
      total: assigned.length,
      withRounds,
      withoutRounds: assigned.length - withRounds,
    };
  }, [selectedEmp, sites]);

  const handleChangeViewMode = async (mode: MandanteViewMode) => {
    if (!selectedMandante || savingViewMode || activeViewMode === mode) return;
    setSavingViewMode(true);
    try {
      await updateEmployee(selectedMandante, { mandanteViewMode: mode });
      const opt = VIEW_MODE_OPTIONS.find((o) => o.id === mode);
      showNotification(`Vista actualizada a "${opt?.title || mode}".`, 'success');
    } catch (error) {
      console.error('Error actualizando vista de mandante:', error);
      showNotification('No se pudo actualizar la configuración de vista.', 'error');
    } finally {
      setSavingViewMode(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">
            Gestión Mandantes
          </h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            Asignación de Instalaciones y Tipo de Panel para Clientes
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-500">
        {/* Left Panel: Mandantes List */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">
              Cuentas Mandante
            </h3>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                placeholder="Buscar mandante..."
                className="w-full pl-9 pr-4 py-2 text-xs font-semibold border border-slate-200 bg-slate-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 max-h-[62vh] overflow-y-auto custom-scrollbar pr-1">
              {employees
                .filter((e) => e.role === 'mandante' && matchesEmployeeSearch(searchTerm, e))
                .map((mand) => {
                  const isSelected = selectedMandante === mand.id;
                  const modeBadge = getViewModeShortBadge(mand.mandanteViewMode);
                  return (
                    <button
                      key={mand.id}
                      onClick={() => setSelectedMandante(mand.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-2xl transition-all text-left ${
                        isSelected
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'hover:bg-slate-50 text-slate-700 border border-transparent hover:border-slate-100'
                      }`}
                    >
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs shrink-0 ${
                          isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {(mand.firstName?.[0] || '') + (mand.lastNamePaterno?.[0] || '')}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold truncate">
                          {mand.firstName} {mand.lastNamePaterno}
                        </div>
                        <div
                          className={`text-[10px] font-medium mt-0.5 ${
                            isSelected ? 'text-blue-100' : 'text-slate-400'
                          }`}
                        >
                          {mand.assignedSites?.length || 0} sucursal
                          {(mand.assignedSites?.length || 0) !== 1 ? 'es' : ''} asignada
                          {(mand.assignedSites?.length || 0) !== 1 ? 's' : ''}
                        </div>
                        <span
                          className={`inline-block mt-1 px-2 py-0.5 rounded-md text-[9px] font-bold border ${
                            isSelected
                              ? 'bg-white/15 text-white border-white/25'
                              : modeBadge.cls
                          }`}
                        >
                          {modeBadge.label}
                        </span>
                      </div>
                    </button>
                  );
                })}
              {employees.filter((e) => e.role === 'mandante').length === 0 && (
                <div className="text-center py-8 text-slate-400">
                  <p className="text-sm font-bold">No hay cuentas Mandante.</p>
                  <p className="text-xs mt-1">Crea una desde la pestaña Empleados.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel: View Config + Sites Assignment */}
        <div className="lg:col-span-2">
          {selectedEmp ? (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              {/* 1. Configuración de Vista del Portal Mandante */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={18} className="text-blue-600" />
                      <h3 className="text-base font-black text-slate-900 tracking-tight">
                        Vista del Portal Mandante
                      </h3>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Define qué panel visualiza{' '}
                      <strong className="text-slate-700">
                        {selectedEmp.firstName} {selectedEmp.lastNamePaterno}
                      </strong>{' '}
                      al ingresar a su portal.
                    </p>
                  </div>

                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold border ${
                      getViewModeShortBadge(activeViewMode).cls
                    }`}
                  >
                    {getViewModeShortBadge(activeViewMode).label}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {VIEW_MODE_OPTIONS.map((opt) => {
                    const selected = activeViewMode === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={savingViewMode}
                        onClick={() => handleChangeViewMode(opt.id)}
                        className={`p-4 rounded-2xl border-2 text-left transition-all flex flex-col gap-2 ${
                          selected
                            ? 'border-blue-600 bg-blue-50/70 shadow-sm'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                              selected
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {opt.icon}
                          </span>
                          {selected && (
                            <CheckCircle size={18} className="text-blue-600 shrink-0" />
                          )}
                        </div>
                        <div>
                          <p
                            className={`text-xs font-black ${
                              selected ? 'text-blue-950' : 'text-slate-800'
                            }`}
                          >
                            {opt.title}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                            {opt.desc}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Resumen informativo de comportamiento actual */}
                <div className="px-4 py-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-600 flex items-center justify-between gap-3 flex-wrap">
                  <span>
                    {activeViewMode === 'sin_rondas' ? (
                      <>
                        El cliente verá siempre el panel de{' '}
                        <strong className="text-slate-800">Control de Acceso y Novedades</strong>{' '}
                        (sin métricas de rondas).
                      </>
                    ) : activeViewMode === 'con_rondas' ? (
                      <>
                        El cliente verá siempre el panel{' '}
                        <strong className="text-slate-800">Completo con Rondas</strong>.
                      </>
                    ) : assignedSitesInfo.total === 0 ? (
                      <>Asigne al menos una sucursal para determinar la vista automática.</>
                    ) : assignedSitesInfo.withRounds === 0 ? (
                      <>
                        Ninguna de las sucursales asignadas tiene rondas activas:{' '}
                        <strong className="text-amber-700">
                          se mostrará Solo Control de Acceso y Novedades
                        </strong>
                        .
                      </>
                    ) : assignedSitesInfo.withoutRounds === 0 ? (
                      <>
                        Todas las sucursales asignadas tienen rondas activas:{' '}
                        <strong className="text-blue-700">se mostrará Panel con Rondas</strong>.
                      </>
                    ) : (
                      <>
                        Cuenta mixta ({assignedSitesInfo.withRounds} con rondas,{' '}
                        {assignedSitesInfo.withoutRounds} solo control de acceso):{' '}
                        <strong className="text-slate-800">
                          el panel se adapta automáticamente según la sucursal seleccionada
                        </strong>
                        .
                      </>
                    )}
                  </span>
                </div>
              </div>

              {/* 2. Asignación de Sucursales */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-black text-slate-900 tracking-tight">
                      Sucursales Asignadas
                    </h3>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                      {selectedEmp.firstName} {selectedEmp.lastNamePaterno} ·{' '}
                      {assignedSitesInfo.total} asignadas
                    </p>
                  </div>
                  <Building2 className="text-blue-600 opacity-25" size={32} />
                </div>

                <div className="relative">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    size={14}
                  />
                  <input
                    type="text"
                    placeholder="Filtrar sucursales por nombre o dirección..."
                    className="w-full pl-9 pr-4 py-2 text-xs font-semibold border border-slate-200 bg-slate-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    value={siteSearchTerm}
                    onChange={(e) => setSiteSearchTerm(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto custom-scrollbar pr-1">
                  {sites
                    .filter(
                      (s) =>
                        s.active &&
                        s.name !== 'Administración' &&
                        (s.name.toLowerCase().includes(siteSearchTerm.toLowerCase()) ||
                          s.address.toLowerCase().includes(siteSearchTerm.toLowerCase())),
                    )
                    .sort((a, b) => {
                      const aAssigned = selectedEmp.assignedSites?.some(
                        (id) => String(id) === String(a.id),
                      )
                        ? 1
                        : 0;
                      const bAssigned = selectedEmp.assignedSites?.some(
                        (id) => String(id) === String(b.id),
                      )
                        ? 1
                        : 0;
                      return bAssigned - aAssigned;
                    })
                    .map((site) => {
                      const isAssigned = Boolean(
                        selectedEmp.assignedSites?.some(
                          (id) => String(id) === String(site.id),
                        ),
                      );
                      const hasRounds = Boolean(site.rondasEnabled);

                      return (
                        <button
                          key={site.id}
                          onClick={() => {
                            const currentAssigned = selectedEmp.assignedSites || [];
                            const newAssigned = isAssigned
                              ? currentAssigned.filter((id) => String(id) !== String(site.id))
                              : [...currentAssigned, site.id];
                            updateEmployee(selectedMandante!, { assignedSites: newAssigned });
                          }}
                          className={`flex items-start gap-3 p-3.5 rounded-2xl border transition-all text-left group ${
                            isAssigned
                              ? 'border-blue-200 bg-blue-50/50'
                              : 'border-slate-200/80 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <div
                            className={`mt-0.5 transition-colors shrink-0 ${
                              isAssigned
                                ? 'text-blue-600'
                                : 'text-slate-300 group-hover:text-slate-400'
                            }`}
                          >
                            {isAssigned ? <CheckCircle size={19} /> : <Square size={19} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div
                              className={`text-xs font-black uppercase tracking-tight truncate ${
                                isAssigned ? 'text-blue-950' : 'text-slate-700'
                              }`}
                            >
                              {site.name}
                            </div>
                            <div className="text-[11px] text-slate-400 font-medium truncate mt-0.5">
                              {site.address}
                            </div>
                            <div className="mt-1.5">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                                  hasRounds
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-slate-100 text-slate-600 border-slate-200'
                                }`}
                              >
                                {hasRounds ? (
                                  <>
                                    <Navigation size={10} /> Con Rondas
                                  </>
                                ) : (
                                  <>
                                    <DoorOpen size={10} /> Sin Rondas (Solo Acceso)
                                  </>
                                )}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                </div>

                <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-slate-400">
                  <p className="text-[10px] font-bold uppercase tracking-widest">
                    Los cambios se guardan automáticamente en Firestore
                  </p>
                  <Save size={15} />
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-12 bg-slate-50/50 rounded-3xl border border-dashed border-slate-200 text-slate-400 space-y-4 min-h-[420px]">
              <User size={44} strokeWidth={1.2} />
              <p className="text-sm font-bold uppercase tracking-widest text-center">
                Selecciona una cuenta mandante para gestionar su vista e instalaciones
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MandanteManagement;
