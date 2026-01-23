
import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  Users, FileCheck, MapPin, Search, Eye, Calendar, AlertCircle, ShieldAlert, FileWarning
} from 'lucide-react';
import EmployeeModal from '../components/EmployeeModal';

type DashboardFilter = 'active_total' | 'os10_all' | 'contracts_all';

const AdminDashboard: React.FC = () => {
  const { employees, attendanceLogs, sites } = useAppStore();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<DashboardFilter>('active_total');
  const [searchTerm, setSearchTerm] = useState('');

  // --- 1. Lógica de Fechas y Filtros ---
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const thirtyDaysFromNow = new Date(today);
  thirtyDaysFromNow.setDate(today.getDate() + 30);

  const sixtyDaysFromNow = new Date(today);
  sixtyDaysFromNow.setDate(today.getDate() + 60);

  const ninetyDaysFromNow = new Date(today);
  ninetyDaysFromNow.setDate(today.getDate() + 90);

  // Helper para comparar fechas sin horas
  const isBetween = (dateStr: string | undefined, start: Date, end: Date) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    return d >= start && d <= end;
  };

  const isBefore = (dateStr: string | undefined, date: Date) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    return d < date;
  };

  // Listas de Empleados según criterio
  const activeEmployees = employees.filter(e => e.isActive);

  const expiringOS10_30 = activeEmployees.filter(e => isBetween(e.fechaVencimientoOS10, today, thirtyDaysFromNow));
  const expiringOS10_60 = activeEmployees.filter(e => {
    if (!e.fechaVencimientoOS10) return false;
    const d = new Date(e.fechaVencimientoOS10);
    d.setHours(0, 0, 0, 0);
    return d > thirtyDaysFromNow && d <= sixtyDaysFromNow;
  });
  const expiringOS10_90 = activeEmployees.filter(e => {
    if (!e.fechaVencimientoOS10) return false;
    const d = new Date(e.fechaVencimientoOS10);
    d.setHours(0, 0, 0, 0);
    return d > sixtyDaysFromNow && d <= ninetyDaysFromNow;
  });

  const expiredOS10List = activeEmployees.filter(e => isBefore(e.fechaVencimientoOS10, today));

  const expiredContractsList = activeEmployees.filter(e => isBefore(e.fechaTerminoContrato, today));
  const expiringContracts_30 = activeEmployees.filter(e => isBetween(e.fechaTerminoContrato, today, thirtyDaysFromNow));
  const expiringContracts_60 = activeEmployees.filter(e => {
    if (!e.fechaTerminoContrato) return false;
    const d = new Date(e.fechaTerminoContrato);
    d.setHours(0, 0, 0, 0);
    return d > thirtyDaysFromNow && d <= sixtyDaysFromNow;
  });
  const expiringContracts_90 = activeEmployees.filter(e => {
    if (!e.fechaTerminoContrato) return false;
    const d = new Date(e.fechaTerminoContrato);
    d.setHours(0, 0, 0, 0);
    return d > sixtyDaysFromNow && d <= ninetyDaysFromNow;
  });

  // --- 2. Selección de Datos para la Vista Principal ---
  let currentList: typeof employees = [];
  let viewTitle = "";
  let viewDescription = "";
  let dateColumnHeader = ""; // Columna dinámica según contexto

  switch (activeFilter) {
    case 'os10_all':
      currentList = [
        ...expiredOS10List,
        ...expiringOS10_30,
        ...expiringOS10_60,
        ...expiringOS10_90
      ];
      viewTitle = "Gestión de Cursos OS10";
      viewDescription = "Consolidado de personal con curso vencido o por vencer en los próximos 90 días.";
      dateColumnHeader = "Vencimiento OS10";
      break;
    case 'contracts_all':
      currentList = [
        ...expiredContractsList,
        ...expiringContracts_30,
        ...expiringContracts_60,
        ...expiringContracts_90
      ];
      viewTitle = "Gestión de Contratos";
      viewDescription = "Consolidado de personal con contrato vencido o por vencer en los próximos 90 días.";
      dateColumnHeader = "Término Contrato";
      break;
    case 'active_total':
    default:
      currentList = activeEmployees;
      viewTitle = "Dotación Activa Total";
      viewDescription = "Listado completo del personal actualmente vigente en el sistema.";
      dateColumnHeader = "";
      break;
  }

  // Filtrado por buscador local (sobre la lista seleccionada)
  const filteredList = currentList.filter(e =>
    (e.firstName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (e.lastNamePaterno || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (e.rut || '').includes(searchTerm)
  );

  // --- 3. Lógica Monitor en Vivo ---
  const liveStatusEmployees = activeEmployees.map(emp => {
    const empLogs = attendanceLogs.filter(log => log.employeeId === emp.id);
    if (empLogs.length === 0) return null;
    const sortedLogs = empLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const lastLog = sortedLogs[0];

    if (lastLog.type === 'check_in') {
      const site = sites.find(s => s.id === lastLog.siteId);
      return {
        ...emp,
        siteName: site ? site.name : 'Ubicación Desconocida',
        lastCheckIn: lastLog.timestamp
      };
    }
    return null;
  }).filter((e): e is NonNullable<typeof e> => e !== null);

  const selectedEmployee = selectedEmployeeId ? employees.find(e => e.id === selectedEmployeeId) : null;

  // Helper para renderizar la fecha relevante en la tabla
  const renderDateCell = (emp: typeof employees[0]) => {
    if (activeFilter === 'os10_all') {
      const isExpired = isBefore(emp.fechaVencimientoOS10, today);
      const is30D = isBetween(emp.fechaVencimientoOS10, today, thirtyDaysFromNow);
      const date = emp.fechaVencimientoOS10 ? new Date(emp.fechaVencimientoOS10).toLocaleDateString() : 'N/A';

      let textColor = "text-slate-600";
      if (isExpired) textColor = "text-red-600";
      else if (is30D) textColor = "text-orange-600";

      return <span className={`font-bold ${textColor}`}>{date}</span>;
    }
    if (activeFilter === 'contracts_all') {
      const isExpired = isBefore(emp.fechaTerminoContrato, today);
      const is30D = isBetween(emp.fechaTerminoContrato, today, thirtyDaysFromNow);
      const date = emp.fechaTerminoContrato ? new Date(emp.fechaTerminoContrato).toLocaleDateString() : 'N/A';

      let textColor = "text-slate-600";
      if (isExpired) textColor = "text-red-600";
      else if (is30D) textColor = "text-orange-600";

      return <span className={`font-bold ${textColor}`}>{date}</span>;
    }
    return null;
  };

  const totalOS10Alerts = expiredOS10List.length + expiringOS10_30.length + expiringOS10_60.length + expiringOS10_90.length;
  const totalContractAlerts = expiredContractsList.length + expiringContracts_30.length + expiringContracts_60.length + expiringContracts_90.length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Panel de Control</h1>
        <p className="text-slate-500">Seleccione una tarjeta para filtrar la información detallada.</p>
      </div>

      {/* KPI Cards Interactivas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

        {/* Card 1: Estatus de Curso OS10 */}
        <button
          onClick={() => setActiveFilter('os10_all')}
          className={`bg-white p-5 rounded-xl shadow-sm border text-left transition-all hover:shadow-md relative overflow-hidden group ${activeFilter === 'os10_all' ? 'border-orange-500 ring-1 ring-orange-500 bg-orange-50' : 'border-slate-100'}`}
        >
          <div className="flex items-center gap-4 relative z-10">
            <div className={`p-3 rounded-lg ${activeFilter === 'os10_all' ? 'bg-orange-200 text-orange-700' : 'bg-orange-100 text-orange-600'}`}>
              <ShieldAlert size={24} />
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Alertas de Curso OS10</p>
              <div className="flex items-baseline gap-2">
                <h3 className="text-2xl font-bold text-slate-800">{totalOS10Alerts}</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Cursos Críticos</p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex gap-1 h-1.5 rounded-full overflow-hidden bg-slate-100 relative z-10">
            <div className="bg-red-500 h-full" style={{ width: `${totalOS10Alerts > 0 ? (expiredOS10List.length / totalOS10Alerts) * 100 : 0}%` }}></div>
            <div className="bg-orange-500 h-full" style={{ width: `${totalOS10Alerts > 0 ? (expiringOS10_30.length / totalOS10Alerts) * 100 : 0}%` }}></div>
            <div className="bg-yellow-400 h-full flex-1"></div>
          </div>
          {activeFilter === 'os10_all' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-orange-500"></div>}
        </button>

        {/* Card 2: Estatus de Contratos */}
        <button
          onClick={() => setActiveFilter('contracts_all')}
          className={`bg-white p-5 rounded-xl shadow-sm border text-left transition-all hover:shadow-md relative overflow-hidden group ${activeFilter === 'contracts_all' ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50' : 'border-slate-100'}`}
        >
          <div className="flex items-center gap-4 relative z-10">
            <div className={`p-3 rounded-lg ${activeFilter === 'contracts_all' ? 'bg-blue-200 text-blue-700' : 'bg-blue-100 text-blue-600'}`}>
              <FileWarning size={24} />
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Alertas de Contratos</p>
              <div className="flex items-baseline gap-2">
                <h3 className="text-2xl font-bold text-slate-800">{totalContractAlerts}</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Términos</p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex gap-1 h-1.5 rounded-full overflow-hidden bg-slate-100 relative z-10">
            <div className="bg-red-500 h-full" style={{ width: `${totalContractAlerts > 0 ? (expiredContractsList.length / totalContractAlerts) * 100 : 0}%` }}></div>
            <div className="bg-orange-500 h-full" style={{ width: `${totalContractAlerts > 0 ? (expiringContracts_30.length / totalContractAlerts) * 100 : 0}%` }}></div>
            <div className="bg-blue-400 h-full flex-1"></div>
          </div>
          {activeFilter === 'contracts_all' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-blue-500"></div>}
        </button>

        {/* Card 4: Dotación Total */}
        <button
          onClick={() => setActiveFilter('active_total')}
          className={`bg-white p-5 rounded-xl shadow-sm border text-left transition-all hover:shadow-md relative overflow-hidden group ${activeFilter === 'active_total' ? 'border-green-500 ring-1 ring-green-500 bg-green-50' : 'border-slate-100'}`}
        >
          <div className="flex items-center gap-4 relative z-10">
            <div className={`p-3 rounded-lg ${activeFilter === 'active_total' ? 'bg-green-200 text-green-700' : 'bg-green-100 text-green-600'}`}>
              <Users size={24} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Dotación Activa</p>
              <h3 className="text-2xl font-bold text-slate-800">{activeEmployees.length}</h3>
            </div>
          </div>
          {activeFilter === 'active_total' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-green-500"></div>}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Main Contextual Table */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-100 flex flex-col h-[600px]">
          <div className="p-5 border-b border-slate-100 flex justify-between items-center flex-wrap gap-4 bg-slate-50/50">
            <div>
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                {viewTitle}
                <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{filteredList.length}</span>
              </h2>
              <p className="text-xs text-slate-500 mt-1">{viewDescription}</p>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Filtrar esta lista..."
                className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm w-48 focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-900"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="overflow-auto flex-1">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-slate-700 font-bold sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-6 py-3">Nombre Colaborador</th>
                  <th className="px-6 py-3">RUT</th>
                  {dateColumnHeader && <th className="px-6 py-3 text-center">{dateColumnHeader}</th>}
                  <th className="px-6 py-3">Cargo / Sucursal</th>
                  <th className="px-6 py-3 text-right">Ficha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeFilter === 'os10_all' ? (
                  <>
                    {[
                      { label: 'CRÍTICO: YA VENCIDOS', list: filteredList.filter(e => isBefore(e.fechaVencimientoOS10, today)), color: 'text-red-600', bg: 'bg-red-50/50', icon: AlertCircle },
                      { label: 'URGENTE: VENCE < 30 DÍAS', list: filteredList.filter(e => isBetween(e.fechaVencimientoOS10, today, thirtyDaysFromNow)), color: 'text-orange-600', bg: 'bg-orange-50/50', icon: ShieldAlert },
                      {
                        label: 'AVISO: VENCE 30-60 DÍAS', list: filteredList.filter(e => {
                          if (!e.fechaVencimientoOS10) return false;
                          const d = new Date(e.fechaVencimientoOS10);
                          d.setHours(0, 0, 0, 0);
                          return d > thirtyDaysFromNow && d <= sixtyDaysFromNow;
                        }), color: 'text-orange-400', bg: 'bg-slate-50/30', icon: ShieldAlert
                      },
                      {
                        label: 'PLANIFICACIÓN: VENCE 60-90 DÍAS', list: filteredList.filter(e => {
                          if (!e.fechaVencimientoOS10) return false;
                          const d = new Date(e.fechaVencimientoOS10);
                          d.setHours(0, 0, 0, 0);
                          return d > sixtyDaysFromNow && d <= ninetyDaysFromNow;
                        }), color: 'text-yellow-600', bg: 'bg-slate-50/10', icon: ShieldAlert
                      },
                    ].map((group, gIdx) => (
                      group.list.length > 0 && (
                        <React.Fragment key={gIdx}>
                          <tr className={`${group.bg} border-y border-slate-100`}>
                            <td colSpan={5} className="px-6 py-2">
                              <div className={`flex items-center gap-2 text-[10px] font-black tracking-widest ${group.color}`}>
                                <group.icon size={12} />
                                {group.label} ({group.list.length})
                              </div>
                            </td>
                          </tr>
                          {group.list.map((emp) => {
                            const siteName = sites.find(s => s.id === emp.currentSiteId)?.name || 'Sin Asignar';
                            return (
                              <tr key={emp.id} className="hover:bg-blue-50/50 transition-colors group">
                                <td className="px-6 py-3">
                                  <div className="font-bold text-slate-900">{emp.firstName}</div>
                                  <div className="text-xs text-slate-500 uppercase">{emp.lastNamePaterno} {emp.lastNameMaterno}</div>
                                </td>
                                <td className="px-6 py-3 font-mono text-xs">{emp.rut}</td>
                                {dateColumnHeader && (
                                  <td className="px-6 py-3 text-center">
                                    {renderDateCell(emp)}
                                  </td>
                                )}
                                <td className="px-6 py-3">
                                  <div className="text-xs font-bold text-slate-700">{emp.cargo}</div>
                                  <div className="text-[10px] text-slate-400 flex items-center gap-1">
                                    <MapPin size={10} /> {siteName}
                                  </div>
                                </td>
                                <td className="px-6 py-3 text-right">
                                  <button
                                    onClick={() => setSelectedEmployeeId(emp.id)}
                                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-100 rounded-lg transition"
                                    title="Ver Ficha Completa"
                                  >
                                    <Eye size={18} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      )
                    ))}
                    {filteredList.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center flex flex-col items-center justify-center">
                          <div className="p-3 bg-slate-50 rounded-full mb-3">
                            <ShieldAlert className="text-slate-300" size={32} />
                          </div>
                          <p className="text-slate-500 font-medium">No hay alertas de OS10.</p>
                        </td>
                      </tr>
                    )}
                  </>
                ) : activeFilter === 'contracts_all' ? (
                  <>
                    {[
                      { label: 'CRÍTICO: CONTRATO VENCIDO', list: filteredList.filter(e => isBefore(e.fechaTerminoContrato, today)), color: 'text-red-600', bg: 'bg-red-50/50', icon: AlertCircle },
                      { label: 'URGENTE: VENCE < 30 DÍAS', list: filteredList.filter(e => isBetween(e.fechaTerminoContrato, today, thirtyDaysFromNow)), color: 'text-orange-600', bg: 'bg-orange-50/50', icon: FileWarning },
                      {
                        label: 'AVISO: VENCE 30-60 DÍAS', list: filteredList.filter(e => {
                          if (!e.fechaTerminoContrato) return false;
                          const d = new Date(e.fechaTerminoContrato);
                          d.setHours(0, 0, 0, 0);
                          return d > thirtyDaysFromNow && d <= sixtyDaysFromNow;
                        }), color: 'text-blue-600', bg: 'bg-blue-50/30', icon: FileCheck
                      },
                      {
                        label: 'PLANIFICACIÓN: VENCE 60-90 DÍAS', list: filteredList.filter(e => {
                          if (!e.fechaTerminoContrato) return false;
                          const d = new Date(e.fechaTerminoContrato);
                          d.setHours(0, 0, 0, 0);
                          return d > sixtyDaysFromNow && d <= ninetyDaysFromNow;
                        }), color: 'text-slate-600', bg: 'bg-slate-50/10', icon: FileCheck
                      },
                    ].map((group, gIdx) => (
                      group.list.length > 0 && (
                        <React.Fragment key={gIdx}>
                          <tr className={`${group.bg} border-y border-slate-100`}>
                            <td colSpan={5} className="px-6 py-2">
                              <div className={`flex items-center gap-2 text-[10px] font-black tracking-widest ${group.color}`}>
                                <group.icon size={12} />
                                {group.label} ({group.list.length})
                              </div>
                            </td>
                          </tr>
                          {group.list.map((emp) => {
                            const siteName = sites.find(s => s.id === emp.currentSiteId)?.name || 'Sin Asignar';
                            return (
                              <tr key={emp.id} className="hover:bg-blue-50/50 transition-colors group">
                                <td className="px-6 py-3">
                                  <div className="font-bold text-slate-900">{emp.firstName}</div>
                                  <div className="text-xs text-slate-500 uppercase">{emp.lastNamePaterno} {emp.lastNameMaterno}</div>
                                </td>
                                <td className="px-6 py-3 font-mono text-xs">{emp.rut}</td>
                                {dateColumnHeader && (
                                  <td className="px-6 py-3 text-center">
                                    {renderDateCell(emp)}
                                  </td>
                                )}
                                <td className="px-6 py-3">
                                  <div className="text-xs font-bold text-slate-700">{emp.cargo}</div>
                                  <div className="text-[10px] text-slate-400 flex items-center gap-1">
                                    <MapPin size={10} /> {siteName}
                                  </div>
                                </td>
                                <td className="px-6 py-3 text-right">
                                  <button
                                    onClick={() => setSelectedEmployeeId(emp.id)}
                                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-100 rounded-lg transition"
                                    title="Ver Ficha Completa"
                                  >
                                    <Eye size={18} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      )
                    ))}
                    {filteredList.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center flex flex-col items-center justify-center">
                          <div className="p-3 bg-slate-50 rounded-full mb-3">
                            <FileCheck className="text-slate-300" size={32} />
                          </div>
                          <p className="text-slate-500 font-medium">No hay alertas de contratos.</p>
                        </td>
                      </tr>
                    )}
                  </>
                ) : (
                  filteredList.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center flex flex-col items-center justify-center">
                        <div className="p-3 bg-slate-50 rounded-full mb-3">
                          <FileCheck className="text-slate-300" size={32} />
                        </div>
                        <p className="text-slate-500 font-medium">No hay registros para este criterio.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredList.map((emp) => {
                      const siteName = sites.find(s => s.id === emp.currentSiteId)?.name || 'Sin Asignar';
                      return (
                        <tr key={emp.id} className="hover:bg-blue-50/50 transition-colors group">
                          <td className="px-6 py-3">
                            <div className="font-bold text-slate-900">{emp.firstName}</div>
                            <div className="text-xs text-slate-500 uppercase">{emp.lastNamePaterno} {emp.lastNameMaterno}</div>
                          </td>
                          <td className="px-6 py-3 font-mono text-xs">{emp.rut}</td>
                          {dateColumnHeader && (
                            <td className="px-6 py-3 text-center">
                              {renderDateCell(emp)}
                            </td>
                          )}
                          <td className="px-6 py-3">
                            <div className="text-xs font-bold text-slate-700">{emp.cargo}</div>
                            <div className="text-[10px] text-slate-400 flex items-center gap-1">
                              <MapPin size={10} /> {siteName}
                            </div>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <button
                              onClick={() => setSelectedEmployeeId(emp.id)}
                              className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-100 rounded-lg transition"
                              title="Ver Ficha Completa"
                            >
                              <Eye size={18} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Monitor Sidebar */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex flex-col h-[600px]">
          <div className="flex items-center gap-2 mb-4 border-b border-slate-100 pb-4">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
            <h2 className="text-lg font-bold text-slate-800">Turno en Vivo</h2>
            <span className="ml-auto text-xs font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{liveStatusEmployees.length}</span>
          </div>

          <div className="space-y-3 overflow-y-auto flex-1 pr-1 custom-scrollbar">
            {liveStatusEmployees.length === 0 ? (
              <div className="text-center py-10 space-y-2">
                <div className="bg-slate-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto text-slate-300">
                  <Users size={20} />
                </div>
                <p className="text-xs text-slate-400 font-medium">No hay personal activo reportando turno en este momento.</p>
              </div>
            ) : (
              liveStatusEmployees.map((emp, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100 hover:border-blue-200 transition-colors">
                  <div className="w-8 h-8 bg-white rounded-full shadow-sm text-blue-600 flex items-center justify-center shrink-0 font-bold text-xs border border-slate-100">
                    {emp.firstName[0]}{emp.lastNamePaterno[0]}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 truncate">{emp.firstName} {emp.lastNamePaterno}</p>
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-1 truncate">
                      <MapPin size={10} className="text-blue-400" />
                      <span className="truncate">{emp.siteName}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-green-600 mt-1 font-medium bg-green-50 inline-block px-1.5 rounded">
                      <Calendar size={10} />
                      Entrada: {new Date(emp.lastCheckIn || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {selectedEmployee && (
        <EmployeeModal
          employee={selectedEmployee}
          onClose={() => setSelectedEmployeeId(null)}
        />
      )}
    </div>
  );
};

export default AdminDashboard;
