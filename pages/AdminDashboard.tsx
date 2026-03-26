
import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Employee, Reminder } from '../types';
import {
  Users, FileCheck, MapPin, Search, Eye, AlertCircle, ShieldAlert, FileWarning, LogOut, Bell, Clock, Calendar
} from 'lucide-react';
import EmployeeModal from '../components/EmployeeModal';

type DashboardFilter = 'active_total' | 'os10_all' | 'contracts_all' | 'reminders_all';

const AdminDashboard: React.FC = () => {
  const { employees, attendanceLogs, sites, forceCloseAttendance } = useAppStore();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<DashboardFilter>('active_total');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState<string | number>('all');

  const [programming, setProgramming] = React.useState<{ employeeId: string; siteId: string | number; isManualPresent?: boolean }[]>([]);
  const [localAttendanceLogs, setLocalAttendanceLogs] = React.useState(attendanceLogs);
  const [reminders, setReminders] = useState<Reminder[]>([]);

  const [closingLogInfo, setClosingLogInfo] = useState<{ id: string; name: string; timestamp: string } | null>(null);
  const [exitTime, setExitTime] = useState('');

  // --- 1. Lógica de Fechas y Filtros ---
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const y = today.getFullYear();
  const m = (today.getMonth() + 1).toString().padStart(2, '0');
  const d = today.getDate().toString().padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;

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
    case 'reminders_all':
      viewTitle = "Gestión de Recordatorios";
      viewDescription = "Consolidado de todas las tareas pendientes con fecha de vencimiento.";
      dateColumnHeader = "Vencimiento";
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
    // Usamos localAttendanceLogs que contiene todos los logs (sin limite de 200)
    const empLogs = localAttendanceLogs.filter(log => log.employeeId === emp.id);
    if (empLogs.length === 0) return null;
    
    // El onSnapshot ya nos da los logs ordenados por timestamp desc, 
    // pero nos aseguramos por si acaso
    const sortedLogs = [...empLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const lastLog = sortedLogs[0];

    // IMPORTANTE: Consideramos "En Turno" si el ultimo log es check_in y no esta completado
    // Independiente de si fue hoy, ayer o hace una semana (Fantasmas)
    if (lastLog.type === 'check_in' && lastLog.status !== 'completed') {
      const site = sites.find(s => s.id === lastLog.siteId);
      return {
        ...emp,
        siteName: site ? site.name : lastLog.siteName || 'Ubicación Desconocida',
        lastCheckIn: lastLog.timestamp,
        activeLogId: lastLog.id
      };
    }
    return null;
  }).filter((e): e is NonNullable<typeof e> => e !== null);

  const selectedEmployee = selectedEmployeeId ? employees.find(e => e.id === selectedEmployeeId) : null;

  // --- 4. Lógica de Sincronización con Programación (Gestión de Turnos) ---
  React.useEffect(() => {
    // 1. Sincronizar logs de asistencia en tiempo real
    const qLogs = query(collection(db, 'Asistencia'));
    const unsubLogs = onSnapshot(qLogs, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as any[];
      logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setLocalAttendanceLogs(logs);
    });

    // 1. Query para Programación (X)
    const qProg = query(
      collection(db, 'programacion'),
      where('date', '==', todayStr)
    );

    // 2. Query para Asistencia Manual (✓)
    const qManual = query(
      collection(db, 'asistencia_manual'),
      where('date', '==', todayStr)
    );

    const unsubProg = onSnapshot(qProg, (snapshotProg) => {
      const progs = snapshotProg.docs.map(doc => {
        const data = doc.data();
        return {
          employeeId: data.employeeId,
          siteId: data.siteId,
          status: data.status,
          isManualPresent: false
        };
      }).filter(p => p.status !== 'descanso'); // Omitir descansos del Monitor en Vivo

      setProgramming(current => {
        const manuals = current.filter(p => p.isManualPresent);
        return [...manuals, ...progs];
      });
    });

    const unsubManual = onSnapshot(qManual, (snapshotMan) => {
      const manuals = snapshotMan.docs.map(doc => {
        const data = doc.data();
        // Intentar encontrar su sucursal actual desde los empleados si no está en el doc manual
        const emp = employees.find(e => e.id === data.employeeId);
        return {
          employeeId: data.employeeId,
          siteId: emp?.currentSiteId || 'all',
          isManualPresent: data.status === 'presente'
        };
      });

      setProgramming(current => {
        const progs = current.filter(p => !p.isManualPresent);
        return [...progs, ...manuals];
      });
    });

    // 3. Recordatorios
    const qReminders = query(
      collection(db, 'reminders'),
      where('completed', '==', false),
      orderBy('dueDate', 'asc')
    );
    const unsubReminders = onSnapshot(qReminders, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })) as Reminder[];
      setReminders(list);
    }, (error) => {
      console.error("Error fetching reminders for dashboard:", error);
    });

    return () => {
      unsubLogs();
      unsubProg();
      unsubManual();
      unsubReminders();
    };
  }, [employees]);

  const activeSites = sites.filter(s =>
    s.active &&
    s.name !== 'Administración' &&
    (selectedSiteId === 'all' || s.id === selectedSiteId)
  );

  const liveBySite = activeSites.reduce((acc, site) => {
    // 1. Encontrar empleados programados o con asistencia manual hoy en esta sucursal
    const programmedForSiteIds = new Set(programming
      .filter(p => 
        String(p.siteId) === String(site.id) || 
        (p.siteId === 'all' && employees.find(e => e.id === p.employeeId)?.currentSiteId === site.id)
      )
      .map(p => p.employeeId)
    );

    // 2. Encontrar empleados que están "Live" en esta sucursal (según liveStatusEmployees calculado arriba)
    const liveHereIds = new Set(
      liveStatusEmployees
        .filter(le => le.siteName === site.name)
        .map(le => le.id)
    );

    // Unimos ambos conjuntos para tener a todos los relevantes
    const allRelevantIds = new Set([...programmedForSiteIds, ...liveHereIds]);
    const assignedEmps = activeEmployees.filter(emp => allRelevantIds.has(emp.id));

    // 3. Determinar estado de cada uno (En Turno vs Espera)
    const empsWithStatus = assignedEmps.map(emp => {
      // Buscamos el log más reciente (en todos los logs disponibles)
      const empLogs = localAttendanceLogs.filter(log => log.employeeId === emp.id);
      const sortedLogs = [...empLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const lastLog = sortedLogs[0];

      // Un empleado está "En Turno" si su último log es check_in Y no está marcado como completed
      const isLive = lastLog ? (lastLog.type === 'check_in' && lastLog.status !== 'completed') : false;

      return {
        ...emp,
        isLive,
        isManual: lastLog?.isManual || false,
        lastCheckIn: lastLog?.timestamp || null,
        activeLogId: isLive ? lastLog.id : null
      };
    });

    // 3. Aplicar filtro de búsqueda
    const filteredEmps = empsWithStatus.filter(emp =>
      (emp.firstName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emp.lastNamePaterno || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const siteMatchesSearch = (site.name || '').toLowerCase().includes(searchTerm.toLowerCase());

    if (siteMatchesSearch || filteredEmps.length > 0) {
      // Ordenar empleados: Activos (isLive) primero
      acc[site.name] = filteredEmps.sort((a, b) => {
        if (a.isLive && !b.isLive) return -1;
        if (!a.isLive && b.isLive) return 1;
        return 0;
      });
    }
    return acc;
  }, {} as Record<string, (Employee & { isLive: boolean; lastCheckIn: string | null; isManual?: boolean; activeLogId?: string | null })[]>);

  // Ordenar las sucursales: poner arriba las que tienen personal activo (isLive)
  const sortedLiveBySite = Object.entries(liveBySite).sort((a, b) => {
    const liveA = a[1].some(e => e.isLive) ? 1 : 0;
    const liveB = b[1].some(e => e.isLive) ? 1 : 0;
    return liveB - liveA;
  });



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
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 md:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Panel de Control</h1>
        <p className="text-slate-500">Seleccione una tarjeta para filtrar la información detallada.</p>
      </div>

      {/* KPI Cards Interactivas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">

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

        {/* Card 3: Recordatorios */}
        <button
          onClick={() => setActiveFilter('reminders_all')}
          className={`bg-white p-5 rounded-xl shadow-sm border text-left transition-all hover:shadow-md relative overflow-hidden group ${activeFilter === 'reminders_all' ? 'border-amber-500 ring-1 ring-amber-500 bg-amber-50' : 'border-slate-100'}`}
        >
          <div className="flex items-center gap-4 relative z-10">
            <div className={`p-3 rounded-lg ${activeFilter === 'reminders_all' ? 'bg-amber-200 text-amber-700' : 'bg-amber-100 text-amber-600'}`}>
              <Bell size={24} />
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Recordatorios</p>
              <div className="flex items-baseline gap-2">
                <h3 className="text-2xl font-bold text-slate-800">{reminders.length}</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Pendientes</p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex gap-1 h-1.5 rounded-full overflow-hidden bg-slate-100 relative z-10">
            <div className="bg-amber-500 h-full w-full"></div>
          </div>
          {activeFilter === 'reminders_all' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-amber-500"></div>}
        </button>

        {/* Card 4: Turnos en Vivo */}
        <button
          onClick={() => setActiveFilter('active_total')}
          className={`bg-white p-5 rounded-xl shadow-sm border text-left transition-all hover:shadow-md relative overflow-hidden group ${activeFilter === 'active_total' ? 'border-emerald-500 ring-1 ring-emerald-500 bg-emerald-50' : 'border-slate-100'}`}
        >
          <div className="flex items-center gap-4 relative z-10">
            <div className={`p-3 rounded-lg ${activeFilter === 'active_total' ? 'bg-emerald-200 text-emerald-700' : 'bg-emerald-100 text-emerald-600'}`}>
              <div className="w-5 h-5 rounded-full bg-emerald-500 animate-pulse border-4 border-emerald-100"></div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Turnos en Vivo</p>
              <h3 className="text-2xl font-bold text-slate-800">{liveStatusEmployees.length}</h3>
            </div>
          </div>
          {activeFilter === 'active_total' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-emerald-500"></div>}
        </button>
      </div>

      <div className="space-y-6">
        {activeFilter === 'active_total' ? (
          /* VISTA: TURNOS EN VIVO POR SUCURSAL */
          <div className="space-y-4">
            {/* FILTROS ESPECÍFICOS VISTA EN VIVO */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-white p-3 md:p-4 rounded-2xl border border-slate-100 shadow-sm">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 md:gap-4 flex-1">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Buscar guardia o sucursal..."
                    className="pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm w-full focus:ring-2 focus:ring-emerald-500 outline-none bg-slate-50 text-slate-900 transition-all font-medium"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>

                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                  <MapPin size={14} className="text-slate-400 shrink-0" />
                  <select
                    className="bg-transparent text-sm font-bold text-slate-700 outline-none w-full cursor-pointer"
                    value={selectedSiteId}
                    onChange={(e) => setSelectedSiteId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  >
                    <option value="all">Todas las sucursales</option>
                    {sites.filter(s => s.active && s.name !== 'Administración').map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-3 py-1.5 rounded-full border border-slate-100 text-center shrink-0">
                  Total Operativos: <span className="text-emerald-600 font-black">{liveStatusEmployees.length}</span>
                </div>
              </div>
            </div>

            {/* TABLA DE TURNOS EN VIVO ESTILO EXCEL */}
            <div className="w-full bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr className="hidden md:table-row">
                      <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Colaborador</th>
                      <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Estado y Registro</th>
                      <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Cargo</th>
                      <th className="px-6 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLiveBySite.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-20 text-center">
                          <Users size={48} className="mx-auto text-slate-200 mb-4" />
                          <p className="text-slate-400 font-bold italic">No se encontraron turnos activos en este momento.</p>
                        </td>
                      </tr>
                    ) : (
                      sortedLiveBySite.map(([siteName, emps]) => {
                        const hasNoStaff = emps.length === 0;
                        return (
                          <React.Fragment key={siteName}>
                            {/* Fila de Título de Sucursal - Estilo Excel Negro (Gris con opacidad si no hay asignados) */}
                            <tr className={`border-b transition-all ${hasNoStaff
                              ? 'bg-slate-400/50 grayscale opacity-50 border-slate-300'
                              : 'bg-slate-900 border-slate-800'}`}>
                              <td colSpan={4} className="px-6 py-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${hasNoStaff ? 'bg-slate-200 text-slate-500' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                      <MapPin size={16} />
                                    </div>
                                    <div>
                                      <h3 className={`font-black text-xs uppercase tracking-widest ${hasNoStaff ? 'text-slate-600' : 'text-white'}`}>{siteName}</h3>
                                      <p className={`text-[9px] font-bold uppercase tracking-tighter ${hasNoStaff ? 'text-slate-500' : 'text-slate-400'}`}>
                                        {hasNoStaff ? 'Sin Programación Hoy' : 'Sucursal Operativa'}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-4">
                                    {!hasNoStaff && (
                                      <div className="flex items-center gap-2 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                                        <span className="text-emerald-400 font-black text-[10px] uppercase tracking-widest">
                                          {emps.filter(e => e.isLive).length} Usuarios Activos
                                        </span>
                                      </div>
                                    )}
                                    <span className={`hidden sm:inline font-black text-[10px] uppercase ${hasNoStaff ? 'text-slate-500' : 'text-slate-500'}`}>
                                      {emps.length} Asignados
                                    </span>
                                  </div>
                                </div>
                              </td>
                            </tr>

                            {/* Filas de Trabajadores */}
                            {hasNoStaff ? (
                              <tr className="border-b border-slate-100 bg-slate-50/30 opacity-50">
                                <td colSpan={4} className="px-6 py-8 text-center text-slate-400 text-[10px] font-black uppercase tracking-widest italic">
                                  No hay personal programado ni asistencias registradas para esta sede en el día de hoy
                                </td>
                              </tr>
                            ) : (
                              emps.map(emp => {
                                const d = emp.lastCheckIn ? new Date(emp.lastCheckIn) : null;
                                const time = d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                                const date = d ? `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}` : '';

                                return (
                                  <tr key={emp.id} className={`group border-b border-slate-50 transition-colors hover:bg-slate-50/80 ${emp.isLive ? 'bg-emerald-50/20' : ''}`}>
                                    <td className="px-6 py-4">
                                      <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs shadow-sm transition-transform group-hover:scale-110 ${emp.isLive ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400"
                                          }`}>
                                          {emp.firstName[0]}{emp.lastNamePaterno[0]}
                                        </div>
                                        <div className="min-w-0">
                                          <p className={`text-sm font-bold flex items-center gap-2 ${emp.isLive ? "text-slate-900" : "text-slate-500"}`}>
                                            {emp.firstName} {emp.lastNamePaterno}
                                            {emp.isLive && <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.4)]"></span>}
                                          </p>
                                          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-tighter italic">
                                            {emp.rut}
                                          </p>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-6 py-4">
                                      <div className="flex flex-col gap-1">
                                        {emp.isLive ? (
                                          <>
                                            <div className="flex items-center gap-2">
                                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 py-0.5 bg-emerald-100/50 text-emerald-700 rounded-md">EN TURNO</span>
                                            </div>
                                            <p className="text-[10px] text-slate-500 font-medium">
                                              {time ? (
                                                <>Entrada: <span className="text-emerald-700 font-black">{time}</span> | Fecha: <span className="text-emerald-700 font-black">{date}</span></>
                                              ) : (
                                                <span className="italic text-slate-400">Sin hora de registro</span>
                                              )}
                                            </p>
                                          </>
                                        ) : (
                                          <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2">
                                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md">STAND-BY</span>
                                            </div>
                                            <p className="text-[10px] text-slate-400 font-black uppercase tracking-tight italic">
                                              esperando inicio de turno
                                            </p>
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-6 py-4 hidden md:table-cell">
                                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider bg-slate-100 px-2 py-1 rounded-lg">
                                        {emp.cargo || 'GUARDIA'}
                                      </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                      <button
                                        onClick={() => setSelectedEmployeeId(emp.id)}
                                        className="inline-flex items-center justify-center p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all border border-transparent hover:border-emerald-100"
                                        title="Ver Ficha"
                                      >
                                        <Eye size={18} />
                                      </button>
                                      {emp.isLive && emp.activeLogId && (
                                        <button
                                          onClick={() => {
                                            const log = attendanceLogs.find(l => l.id === emp.activeLogId);
                                            setClosingLogInfo({
                                              id: emp.activeLogId!,
                                              name: `${emp.firstName} ${emp.lastNamePaterno}`,
                                              timestamp: log?.timestamp || new Date().toISOString()
                                            });
                                            setExitTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
                                          }}
                                          className="inline-flex items-center justify-center p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all border border-transparent hover:border-rose-100"
                                          title="Forzar Cierre"
                                        >
                                          <LogOut size={18} />
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        ) : activeFilter === 'reminders_all' ? (
          /* VISTA: TABLA DE RECORDATORIOS */
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 flex flex-col min-h-[600px]">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  {viewTitle}
                  <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{reminders.length}</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">{viewDescription}</p>
              </div>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 text-slate-700 font-bold sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Colaborador / Tarea</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Descripción</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Vencimiento</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reminders.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-20 text-center text-slate-400">
                        <Bell size={48} className="mx-auto mb-4 opacity-20" />
                        <p>No hay recordatorios pendientes.</p>
                      </td>
                    </tr>
                  ) : (
                    (() => {
                        const now = new Date();
                        now.setHours(0, 0, 0, 0);
                        
                        const endOfWeek = new Date(now);
                        endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
                        endOfWeek.setHours(23, 59, 59, 999);
                        
                        const endOfNextWeek = new Date(endOfWeek);
                        endOfNextWeek.setDate(endOfNextWeek.getDate() + 7);
                        
                        const grouped = reminders.reduce((acc, rem) => {
                            const date = rem.dueDate.toDate();
                            if (date < now) acc.overdue.push(rem);
                            else if (date <= endOfWeek) acc.thisWeek.push(rem);
                            else if (date <= endOfNextWeek) acc.nextWeek.push(rem);
                            else acc.later.push(rem);
                            return acc;
                        }, { overdue: [] as Reminder[], thisWeek: [] as Reminder[], nextWeek: [] as Reminder[], later: [] as Reminder[] });

                        return [
                            { label: 'TAREAS VENCIDAS', list: grouped.overdue, color: 'text-rose-600', bg: 'bg-rose-50/50', icon: AlertCircle },
                            { label: 'TAREAS PARA ESTA SEMANA', list: grouped.thisWeek, color: 'text-red-600', bg: 'bg-red-50/50', icon: Clock },
                            { label: 'TAREAS PRÓXIMA SEMANA', list: grouped.nextWeek, color: 'text-orange-600', bg: 'bg-orange-50/50', icon: Calendar },
                            { label: 'RESTO DE TAREAS PENDIENTES', list: grouped.later, color: 'text-slate-500', bg: 'bg-slate-50/50', icon: Bell }
                        ].map((group, groupIdx) => (
                            group.list.length > 0 && (
                                <React.Fragment key={groupIdx}>
                                    <tr className={`${group.bg} border-y border-slate-100`}>
                                        <td colSpan={4} className="px-6 py-2">
                                            <div className={`flex items-center gap-2 text-[10px] font-black tracking-widest ${group.color}`}>
                                                <group.icon size={12} />
                                                {group.label} ({group.list.length})
                                            </div>
                                        </td>
                                    </tr>
                                    {group.list.map(reminder => (
                                        <tr key={reminder.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-6 py-4">
                                                <p className="font-bold text-slate-900 leading-tight">{reminder.text}</p>
                                                <p className="text-[10px] text-slate-400 font-medium mt-1">Recordatorio Interno</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-xs text-slate-600 italic line-clamp-2">{reminder.description || 'Sin descripción adicional'}</p>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <div className="inline-flex items-center gap-2 text-slate-700 bg-slate-100 px-3 py-1 rounded-lg">
                                                    <Clock size={12} className="text-slate-400" />
                                                    <span className="font-bold text-xs">{reminder.dueDate?.toDate()?.toLocaleDateString() || 'N/A'}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                {reminder.dueDate?.toDate() < now ? (
                                                    <span className="px-2 py-1 bg-red-100 text-red-700 text-[10px] font-bold rounded-full uppercase">Tarea Vencida</span>
                                                ) : (
                                                    <span className="px-2 py-1 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full uppercase">Pendiente</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </React.Fragment>
                            )
                        ));
                    })()
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* VISTA: TABLAS DE ALERTAS (Contratos / OS10) */
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 flex flex-col min-h-[600px]">
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
                    /* ... FILTRO OS10 ... */
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
                    </>
                  ) : activeFilter === 'contracts_all' ? (
                    /* ... FILTRO CONTRATOS ... */
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
                    </>
                  ) : (
                    /* ... OTROS FILTROS ... */
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
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {selectedEmployee && (
        <EmployeeModal
          employee={selectedEmployee}
          onClose={() => setSelectedEmployeeId(null)}
        />
      )}

      {/* Modal de Forzar Cierre */}
      {closingLogInfo && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
            <div className="p-8 space-y-6">
              <div className="text-center">
                <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <LogOut size={32} />
                </div>
                <h3 className="text-xl font-black text-slate-800 tracking-tight">Forzar Cierre de Turno</h3>
                <p className="text-slate-500 text-sm mt-2">
                  Vas a registrar la salida manual para <span className="font-bold text-slate-700">{closingLogInfo.name}</span>.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Hora de Salida</label>
                <input
                  type="time"
                  value={exitTime}
                  onChange={(e) => setExitTime(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-rose-500 outline-none transition-all font-black text-2xl text-center text-slate-700"
                />
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => setClosingLogInfo(null)}
                  className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black uppercase tracking-widest text-xs"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    try {
                      const [h, m] = exitTime.split(':');
                      const date = new Date(closingLogInfo.timestamp);
                      date.setHours(parseInt(h), parseInt(m));
                      await forceCloseAttendance(closingLogInfo.id, date.toISOString(), "Cierre forzado por administrador");
                      setClosingLogInfo(null);
                    } catch (e) {
                      alert("Error al cerrar turno");
                    }
                  }}
                  className="flex-[2] py-4 bg-rose-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg shadow-rose-200"
                >
                  Confirmar Salida
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
