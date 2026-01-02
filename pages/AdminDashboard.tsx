
import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { 
  Users, AlertTriangle, FileCheck, MapPin, 
  Search, Eye, Calendar, AlertCircle
} from 'lucide-react';
import EmployeeModal from '../components/EmployeeModal';

type DashboardFilter = 'active_total' | 'expiring_os10' | 'expired_os10' | 'expiring_contracts';

const AdminDashboard: React.FC = () => {
  const { employees, attendanceLogs, sites, toggleEmployeeStatus } = useAppStore();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<DashboardFilter>('active_total');
  const [searchTerm, setSearchTerm] = useState('');

  // --- 1. Lógica de Fechas y Filtros ---
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const thirtyDaysFromNow = new Date(today);
  thirtyDaysFromNow.setDate(today.getDate() + 30);

  // Helper para comparar fechas sin horas
  const isBetween = (dateStr: string | undefined, start: Date, end: Date) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    d.setHours(0,0,0,0);
    return d >= start && d <= end;
  };

  const isBefore = (dateStr: string | undefined, date: Date) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    d.setHours(0,0,0,0);
    return d < date;
  };

  // Listas de Empleados según criterio
  const activeEmployees = employees.filter(e => e.isActive);
  
  const expiringOS10List = activeEmployees.filter(e => isBetween(e.fechaVencimientoOS10, today, thirtyDaysFromNow));
  const expiredOS10List = activeEmployees.filter(e => isBefore(e.fechaVencimientoOS10, today));
  const expiringContractsList = activeEmployees.filter(e => isBetween(e.fechaTerminoContrato, today, thirtyDaysFromNow));

  // --- 2. Selección de Datos para la Vista Principal ---
  let currentList = [];
  let viewTitle = "";
  let viewDescription = "";
  let dateColumnHeader = ""; // Columna dinámica según contexto

  switch (activeFilter) {
    case 'expiring_os10':
      currentList = expiringOS10List;
      viewTitle = "Alertas: OS10 Por Vencer";
      viewDescription = "Personal con curso OS10 próximo a caducar (30 días). Gestionar renovación.";
      dateColumnHeader = "Vencimiento OS10";
      break;
    case 'expired_os10':
      currentList = expiredOS10List;
      viewTitle = "Crítico: OS10 Vencidos";
      viewDescription = "Personal con curso OS10 ya vencido. Requiere acción inmediata.";
      dateColumnHeader = "Vencimiento OS10";
      break;
    case 'expiring_contracts':
      currentList = expiringContractsList;
      viewTitle = "Alertas: Contratos por Terminar";
      viewDescription = "Personal con fecha de término de contrato próxima (30 días).";
      dateColumnHeader = "Término Contrato";
      break;
    case 'active_total':
    default:
      currentList = activeEmployees;
      viewTitle = "Dotación Activa Total";
      viewDescription = "Listado completo del personal actualmente vigente en el sistema.";
      dateColumnHeader = ""; // No mostrar columna específica extra
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
    if (activeFilter === 'expiring_os10' || activeFilter === 'expired_os10') {
      const date = emp.fechaVencimientoOS10 ? new Date(emp.fechaVencimientoOS10).toLocaleDateString() : 'N/A';
      return <span className={`font-bold ${activeFilter === 'expired_os10' ? 'text-red-600' : 'text-orange-600'}`}>{date}</span>;
    }
    if (activeFilter === 'expiring_contracts') {
      return <span className="font-bold text-blue-600">{emp.fechaTerminoContrato ? new Date(emp.fechaTerminoContrato).toLocaleDateString() : 'N/A'}</span>;
    }
    return null;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Panel de Control</h1>
        <p className="text-slate-500">Seleccione una tarjeta para filtrar la información detallada.</p>
      </div>

      {/* KPI Cards Interactivas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: OS10 Por Vencer */}
        <button 
          onClick={() => setActiveFilter('expiring_os10')}
          className={`bg-white p-5 rounded-xl shadow-sm border text-left transition-all hover:shadow-md relative overflow-hidden group ${activeFilter === 'expiring_os10' ? 'border-orange-500 ring-1 ring-orange-500 bg-orange-50' : 'border-slate-100'}`}
        >
          <div className="flex items-center gap-4 relative z-10">
            <div className={`p-3 rounded-lg ${activeFilter === 'expiring_os10' ? 'bg-orange-200 text-orange-700' : 'bg-orange-100 text-orange-600'}`}>
              <AlertTriangle size={24} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">OS10 Por Vencer (30d)</p>
              <h3 className="text-2xl font-bold text-slate-800">{expiringOS10List.length}</h3>
            </div>
          </div>
          {activeFilter === 'expiring_os10' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-orange-500"></div>}
        </button>

        {/* Card 2: OS10 Vencidos */}
        <button 
          onClick={() => setActiveFilter('expired_os10')}
          className={`bg-white p-5 rounded-xl shadow-sm border text-left transition-all hover:shadow-md relative overflow-hidden group ${activeFilter === 'expired_os10' ? 'border-red-500 ring-1 ring-red-500 bg-red-50' : 'border-slate-100'}`}
        >
          <div className="flex items-center gap-4 relative z-10">
            <div className={`p-3 rounded-lg ${activeFilter === 'expired_os10' ? 'bg-red-200 text-red-700' : 'bg-red-100 text-red-600'}`}>
              <AlertCircle size={24} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">OS10 Vencidos</p>
              <h3 className="text-2xl font-bold text-slate-800">{expiredOS10List.length}</h3>
            </div>
          </div>
          {activeFilter === 'expired_os10' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-red-500"></div>}
        </button>

        {/* Card 3: Contratos por Vencer */}
        <button 
          onClick={() => setActiveFilter('expiring_contracts')}
          className={`bg-white p-5 rounded-xl shadow-sm border text-left transition-all hover:shadow-md relative overflow-hidden group ${activeFilter === 'expiring_contracts' ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50' : 'border-slate-100'}`}
        >
          <div className="flex items-center gap-4 relative z-10">
            <div className={`p-3 rounded-lg ${activeFilter === 'expiring_contracts' ? 'bg-blue-200 text-blue-700' : 'bg-blue-100 text-blue-600'}`}>
              <FileCheck size={24} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Contratos (30d)</p>
              <h3 className="text-2xl font-bold text-slate-800">{expiringContractsList.length}</h3>
            </div>
          </div>
          {activeFilter === 'expiring_contracts' && <div className="absolute right-0 top-0 bottom-0 w-1 bg-blue-500"></div>}
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
                {filteredList.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center flex flex-col items-center justify-center">
                      <div className="p-3 bg-slate-50 rounded-full mb-3">
                         <FileCheck className="text-slate-300" size={32} />
                      </div>
                      <p className="text-slate-500 font-medium">No hay registros para este criterio.</p>
                      <p className="text-xs text-slate-400">¡Todo parece estar en orden!</p>
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
                         Entrada: {new Date(emp.lastCheckIn || '').toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
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
