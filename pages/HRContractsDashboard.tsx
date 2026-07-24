import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { 
  ClipboardList, Users, UserPlus, ShieldAlert, CalendarClock, Palmtree, 
  Search, Eye, XCircle, CheckCircle, Clock, ChevronRight, ChevronDown, FilePlus, AlertCircle, CheckCircle2, FileText
} from 'lucide-react';
import VacationFormModal from '../components/VacationFormModal';
import { RegularizeContractModal } from '../components/RegularizeContractModal';
import { Contrato } from '../types/phase1';
import { normalizeText } from '../lib/textUtils';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, functions } from '../lib/firebase';
import { httpsCallable } from 'firebase/functions';

const HRContractsDashboard: React.FC = () => {
  const { 
    employees, 
    contratos, 
    vacations, 
    sites, 
    updateVacationStatus, 
    setPreselectedEmployeeForDoc,
    currentUser,
    fetchContratos,
    showConfirmation,
    showNotification
  } = useAppStore();

  // ----- ESTADOS EXISTENTES -----
  const [expandedEmpId, setExpandedEmpId] = useState<string | null>(null);
  const [filters, setFilters] = useState({ estado: '', limit: 50 });
  const [resolveModal, setResolveModal] = useState<{
    isOpen: boolean;
    contrato: Contrato | null;
    empId: string;
    fechaInicio: string;
    fechaTermino: string;
    motivo: string;
    isProcessing: boolean;
  }>({
    isOpen: false,
    contrato: null,
    empId: '',
    fechaInicio: new Date().toISOString().split('T')[0],
    fechaTermino: new Date().toISOString().split('T')[0],
    motivo: '',
    isProcessing: false,
  });

  // ----- ESTADOS NUEVOS -----
  const [showVacationModal, setShowVacationModal] = useState(false);
  const [regularizeModalEmp, setRegularizeModalEmp] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'todos' | 'pending' | 'approved' | 'en_curso' | 'completed' | 'cancelled'>('todos');
  const [vacationSearch, setVacationSearch] = useState('');

  // ----- NUEVO ESTADO PARA BUSQUEDA Y PAGINACION DE CONTRATOS -----
  const [searchContractTerm, setSearchContractTerm] = useState('');
  const [currentPageContracts, setCurrentPageContracts] = useState(1);
  const contractsPerPage = 20;

  // ----- EFECTOS -----
  useEffect(() => {
    fetchContratos({ estado: filters.estado || undefined, limit: filters.limit });
  }, [fetchContratos, filters.limit, filters.estado]);

  // ----- LOGICA EXISTENTE DE CONTRATOS -----
  const employeesWithContracts = useMemo(() => {
    return employees.map(emp => {
      const empContracts = contratos.filter(c => c.colaboradorId === emp.id);
      const activeContracts = empContracts.filter(c => c.estado === 'vigente' || c.estado === 'pendiente_firma');
      
      let issueCount = 0;
      if (activeContracts.length > 1) issueCount++; // Múltiples contratos activos
      if (activeContracts.length === 0) issueCount++; // Sin contrato activo
      
      return {
        ...emp,
        contracts: empContracts,
        activeContracts,
        issueCount,
      };
    }).filter(emp => emp.contracts.length > 0 || !filters.estado) // Si hay filtro, mostramos los afectados
      .sort((a, b) => b.issueCount - a.issueCount);
  }, [employees, contratos, filters.estado]);

  // Filtrado de employeesWithContracts (por término de búsqueda)
  const filteredEmployeesWithContracts = useMemo(() => {
    let list = employeesWithContracts;
    
    if (searchContractTerm) {
      const term = normalizeText(searchContractTerm);
      list = list.filter(emp => {
        const fullName = normalizeText(`${emp.firstName} ${emp.lastNamePaterno} ${emp.lastNameMaterno || ''}`);
        return fullName.includes(term);
      });
    }
    
    return list;
  }, [employeesWithContracts, searchContractTerm]);

  // Paginación
  const paginatedEmployeesWithContracts = useMemo(() => {
    const start = (currentPageContracts - 1) * contractsPerPage;
    const end = start + contractsPerPage;
    return filteredEmployeesWithContracts.slice(start, end);
  }, [filteredEmployeesWithContracts, currentPageContracts]);

  const totalContractPages = Math.ceil(filteredEmployeesWithContracts.length / contractsPerPage);

  // Reset page to 1 when search term changes
  useEffect(() => {
    setCurrentPageContracts(1);
  }, [searchContractTerm, filters.estado]);

  const openResolveModal = (contrato: Contrato, empId: string) => {
    setResolveModal({
      isOpen: true,
      contrato,
      empId,
      fechaInicio: contrato.fechaInicio || new Date().toISOString().split('T')[0],
      fechaTermino: contrato.fechaTermino || new Date().toISOString().split('T')[0],
      motivo: '',
      isProcessing: false,
    });
  };

  const handleResolveSubmit = async () => {
    if (!resolveModal.contrato || !resolveModal.motivo.trim()) {
      alert("Debes ingresar un motivo.");
      return;
    }

    setResolveModal(prev => ({ ...prev, isProcessing: true }));

    try {
      const turnosRef = collection(db, 'TurnosProgramados');
      const q = query(
        turnosRef,
        where('colaboradorId', '==', resolveModal.empId),
        where('fecha', '>=', resolveModal.fechaInicio),
        where('fecha', '<=', resolveModal.fechaTermino)
      );
      
      const turnosSnap = await getDocs(q);
      
      if (turnosSnap.empty) {
        alert('No se encontraron turnos programados en el rango de fechas seleccionado.');
        setResolveModal(prev => ({ ...prev, isProcessing: false }));
        return;
      }

      if (!window.confirm(`Se afectarán ${turnosSnap.size} turnos. ¿Deseas continuar?`)) {
        setResolveModal(prev => ({ ...prev, isProcessing: false }));
        return;
      }

      const turnoProgramadoIds = turnosSnap.docs.map(d => d.id);
      const resolveContractBinding = httpsCallable(functions, 'resolveContractBinding');
      const result = await resolveContractBinding({
        turnoProgramadoIds,
        contratoSeleccionadoId: resolveModal.contrato!.id,
        motivo: resolveModal.motivo
      });

      alert(`Resolución aplicada a ${(result.data as any).updates} turnos exitosamente.`);
      setResolveModal(prev => ({ ...prev, isOpen: false }));
    } catch (error: any) {
      console.error("Error al resolver conflictos:", error);
      alert("Ocurrió un error al resolver el conflicto: " + (error.message || ''));
    } finally {
      setResolveModal(prev => ({ ...prev, isProcessing: false }));
    }
  };

  // ----- LOGICA NUEVA DE INDICADORES -----
  const recentHires = useMemo(() => {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    return employees.filter(e => {
      if (!e.isActive) return false;
      if (!e.fechaInicioContrato) return false;
      const d = new Date(e.fechaInicioContrato);
      return d >= tenDaysAgo;
    }).sort((a, b) => new Date(b.fechaInicioContrato!).getTime() - new Date(a.fechaInicioContrato!).getTime());
  }, [employees]);

  const workersWithoutContract = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return employees.filter(e => {
      if (!e.isActive) return false;
      const empContracts = contratos.filter(c => c.colaboradorId === e.id);
      const hasValid = empContracts.some(c => {
        if (c.estado !== 'vigente') return false;
        if (c.fechaInicio > today) return false;
        if (c.fechaTermino && c.fechaTermino < today) return false;
        return true;
      });
      return !hasValid;
    });
  }, [employees, contratos]);

  // ----- LOGICA NUEVA DE VACACIONES -----
  const todayStr = new Date().toISOString().split('T')[0];
  
  const currentVacationsCount = useMemo(() => {
    return vacations.filter(v => v.status === 'approved' && v.startDate <= todayStr && v.endDate >= todayStr).length;
  }, [vacations, todayStr]);

  const pendingVacationsCount = useMemo(() => {
    return vacations.filter(v => v.status === 'pending').length;
  }, [vacations]);

  const filteredVacations = useMemo(() => {
    let list = vacations;
    if (activeTab !== 'todos') {
      if (activeTab === 'en_curso') {
        list = list.filter(v => v.status === 'approved' && v.startDate <= todayStr && v.endDate >= todayStr);
      } else {
        list = list.filter(v => v.status === activeTab);
      }
    }
    if (vacationSearch) {
      const term = normalizeText(vacationSearch);
      list = list.filter(v => {
        const emp = employees.find(e => e.id === v.employeeId);
        const name = emp ? normalizeText(`${emp.firstName} ${emp.lastNamePaterno}`) : '';
        const rut = emp ? normalizeText(emp.rut) : '';
        return name.includes(term) || rut.includes(term);
      });
    }
    return list;
  }, [vacations, activeTab, vacationSearch, employees, todayStr]);

  const handleVacationAction = (id: string, action: 'approve' | 'reject' | 'cancel' | 'complete', currentStatus: string) => {
    const actionMap = {
      approve: { status: 'approved', label: 'Aprobar' },
      reject: { status: 'rejected', label: 'Rechazar' },
      cancel: { status: 'cancelled', label: 'Cancelar' },
      complete: { status: 'completed', label: 'Finalizar' }
    };
    
    showConfirmation({
      title: `${actionMap[action].label} Vacaciones`,
      message: `¿Estás seguro de que deseas ${actionMap[action].label.toLowerCase()} esta solicitud?`,
      type: action === 'reject' || action === 'cancel' ? 'alert' : 'confirm',
      onConfirm: async () => {
        try {
          await updateVacationStatus(id, actionMap[action].status as any, currentUser!.uid);
          showNotification(`Solicitud ${actionMap[action].label.toLowerCase()}da con éxito`, "success");
        } catch (e) {
          showNotification("Ocurrió un error al procesar la solicitud", "error");
        }
      }
    });
  };

  const getSiteName = (id: string | number) => sites.find(s => s.id.toString() === id.toString())?.name || 'Desconocida';
  const getEmpName = (id: string) => {
    const e = employees.find(emp => emp.id === id);
    return e ? `${e.firstName} ${e.lastNamePaterno}` : 'Desconocido';
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 pb-24">
      {/* HEADER NUEVO */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight uppercase flex items-center gap-3">
            <ClipboardList className="text-blue-600" />
            Panel RRHH
          </h1>
          <p className="text-slate-500 text-sm font-medium">Resumen de trabajadores, contratos y vacaciones</p>
        </div>
        <button
          onClick={() => setShowVacationModal(true)}
          className="py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl shadow-blue-200 transition-all active:scale-95 flex items-center justify-center gap-2 self-start md:self-auto"
        >
          <Palmtree size={16} /> Registrar Vacaciones
        </button>
      </div>

      {/* TARJETAS RESUMEN NUEVAS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ingresos Recientes</span>
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl"><UserPlus size={16} /></div>
          </div>
          <div className="text-3xl font-black text-slate-800">{recentHires.length}</div>
          <p className="text-xs font-medium text-slate-500 mt-1">En los últimos 10 días</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sin Contrato</span>
            <div className="p-2 bg-rose-50 text-rose-600 rounded-xl"><ShieldAlert size={16} /></div>
          </div>
          <div className="text-3xl font-black text-rose-600">{workersWithoutContract.length}</div>
          <p className="text-xs font-medium text-slate-500 mt-1">Requieren atención</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">De Vacaciones</span>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl"><Palmtree size={16} /></div>
          </div>
          <div className="text-3xl font-black text-slate-800">{currentVacationsCount}</div>
          <p className="text-xs font-medium text-slate-500 mt-1">Actualmente en curso</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Solicitudes Vac.</span>
            <div className="p-2 bg-amber-50 text-amber-600 rounded-xl"><CalendarClock size={16} /></div>
          </div>
          <div className="text-3xl font-black text-amber-500">{pendingVacationsCount}</div>
          <p className="text-xs font-medium text-slate-500 mt-1">Pendientes de revisión</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ÚLTIMOS INGRESOS */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6 flex flex-col h-96">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
            <UserPlus size={16} className="text-emerald-500" />
            Últimos Ingresos (10 días)
          </h3>
          <div className="flex-1 overflow-y-auto pr-2 space-y-3">
            {recentHires.length === 0 ? (
              <p className="text-slate-400 text-sm font-bold text-center py-10">No existen trabajadores ingresados durante los últimos 10 días.</p>
            ) : (
              recentHires.map(emp => (
                <div key={emp.id} className="flex justify-between items-center bg-slate-50 p-3 rounded-2xl border border-slate-100">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">{emp.firstName} {emp.lastNamePaterno}</h4>
                    <div className="text-[10px] text-slate-500 font-medium flex gap-2 mt-1">
                      <span>{emp.cargo}</span>
                      <span>•</span>
                      <span>Ingreso: {emp.fechaInicioContrato}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* SIN CONTRATO VIGENTE */}
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6 flex flex-col h-96">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
            <ShieldAlert size={16} className="text-rose-500" />
            Sin Contrato Vigente
          </h3>
          <div className="flex-1 overflow-y-auto pr-2 space-y-3">
            {workersWithoutContract.length === 0 ? (
              <p className="text-slate-400 text-sm font-bold text-center py-10">Todos los trabajadores activos tienen contrato vigente.</p>
            ) : (
              workersWithoutContract.map(emp => {
                const empContracts = contratos.filter(c => c.colaboradorId === emp.id);
                const hasAny = empContracts.length > 0;
                return (
                  <div key={emp.id} className="flex flex-col sm:flex-row sm:justify-between sm:items-center bg-rose-50/50 p-3 rounded-2xl border border-rose-100 gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">{emp.firstName} {emp.lastNamePaterno}</h4>
                      <p className="text-[10px] text-slate-500 font-medium mt-1">
                        Motivo: {hasAny ? 'Contrato vencido o futuro' : 'Sin contratos registrados'}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => setPreselectedEmployeeForDoc(emp.id)}
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 justify-center transition"
                        title="Ir a Documentos a generar contrato"
                      >
                        <FilePlus size={12} /> Pdf
                      </button>
                      <button
                        onClick={() => setRegularizeModalEmp(emp)}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 justify-center transition"
                        title="Regularizar manualmente sin PDF"
                      >
                        Regularizar
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* TABLA DE VACACIONES */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-4">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
            <Palmtree size={18} className="text-blue-500" />
            Gestión de Vacaciones
          </h3>
          
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Buscar trabajador..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none"
              value={vacationSearch}
              onChange={(e) => setVacationSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2">
          {[
            { id: 'todos', label: 'Todas' },
            { id: 'pending', label: 'Pendientes' },
            { id: 'approved', label: 'Aprobadas' },
            { id: 'en_curso', label: 'En Curso' },
            { id: 'completed', label: 'Finalizadas' },
            { id: 'cancelled', label: 'Canceladas' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-all ${
                activeTab === tab.id ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] uppercase tracking-widest text-slate-400 font-black">
                <th className="p-3">Trabajador</th>
                <th className="p-3">Sucursal</th>
                <th className="p-3">Periodo</th>
                <th className="p-3 text-center">Días</th>
                <th className="p-3">Estado</th>
                <th className="p-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredVacations.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-slate-400 font-bold text-sm">
                    No se encontraron registros de vacaciones.
                  </td>
                </tr>
              ) : (
                filteredVacations.map(vac => (
                  <tr key={vac.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                    <td className="p-3">
                      <p className="text-xs font-bold text-slate-700">{getEmpName(vac.employeeId)}</p>
                    </td>
                    <td className="p-3">
                      <p className="text-[11px] font-medium text-slate-500">{getSiteName(vac.sucursalId)}</p>
                    </td>
                    <td className="p-3">
                      <p className="text-[11px] font-bold text-slate-700">{vac.startDate}</p>
                      <p className="text-[10px] text-slate-400">al {vac.endDate}</p>
                    </td>
                    <td className="p-3 text-center">
                      <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black">
                        {vac.days}
                      </span>
                    </td>
                    <td className="p-3">
                      {vac.status === 'pending' && <span className="text-[10px] font-black bg-amber-50 text-amber-600 px-2 py-1 rounded-lg uppercase">Pendiente</span>}
                      {vac.status === 'approved' && <span className="text-[10px] font-black bg-blue-50 text-blue-600 px-2 py-1 rounded-lg uppercase">Aprobada</span>}
                      {vac.status === 'completed' && <span className="text-[10px] font-black bg-emerald-50 text-emerald-600 px-2 py-1 rounded-lg uppercase">Finalizada</span>}
                      {vac.status === 'cancelled' && <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-lg uppercase">Cancelada</span>}
                      {vac.status === 'rejected' && <span className="text-[10px] font-black bg-rose-50 text-rose-600 px-2 py-1 rounded-lg uppercase">Rechazada</span>}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        {vac.status === 'pending' && (
                          <>
                            <button onClick={() => handleVacationAction(vac.id, 'approve', vac.status)} className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg transition" title="Aprobar"><CheckCircle size={14}/></button>
                            <button onClick={() => handleVacationAction(vac.id, 'reject', vac.status)} className="p-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg transition" title="Rechazar"><XCircle size={14}/></button>
                          </>
                        )}
                        {vac.status === 'approved' && (
                          <>
                            <button onClick={() => handleVacationAction(vac.id, 'complete', vac.status)} className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg transition" title="Marcar Finalizada"><CheckCircle size={14}/></button>
                            <button onClick={() => handleVacationAction(vac.id, 'cancel', vac.status)} className="p-1.5 bg-slate-100 text-slate-500 hover:bg-slate-200 rounded-lg transition" title="Cancelar"><XCircle size={14}/></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECCIÓN ORIGINAL: RESOLUCIÓN DE CONTRATOS */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mt-6">
        <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-slate-700 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <FileText className="text-slate-400" /> 
            Estado Contractual por Colaborador
          </div>
          <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                placeholder="Buscar por nombre o apellido..."
                className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                value={searchContractTerm}
                onChange={(e) => setSearchContractTerm(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <select 
                value={filters.estado} 
                onChange={e => setFilters(prev => ({...prev, estado: e.target.value}))}
                className="p-1.5 border border-slate-300 rounded text-xs bg-white w-full sm:w-auto"
              >
                <option value="">Todos los Estados</option>
                <option value="vigente">Vigente</option>
                <option value="pendiente_firma">Pendiente de Firma</option>
                <option value="vencido">Vencido</option>
              </select>
              <select 
                value={filters.limit} 
                onChange={e => setFilters(prev => ({...prev, limit: Number(e.target.value)}))}
                className="p-1.5 border border-slate-300 rounded text-xs bg-white w-full sm:w-auto"
                title="Límite de documentos a descargar"
              >
                <option value={25}>Descargar 25</option>
                <option value={50}>Descargar 50</option>
                <option value={100}>Descargar 100</option>
                <option value={500}>Descargar 500</option>
              </select>
            </div>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {paginatedEmployeesWithContracts.map(emp => (
            <div key={emp.id} className="flex flex-col">
              <div 
                className="flex items-center justify-between p-4 hover:bg-slate-50 cursor-pointer transition"
                onClick={() => setExpandedEmpId(expandedEmpId === emp.id ? null : emp.id)}
              >
                <div className="flex items-center gap-4">
                  {expandedEmpId === emp.id ? <ChevronDown size={20} className="text-slate-400" /> : <ChevronRight size={20} className="text-slate-400" />}
                  <div>
                    <div className="font-bold text-slate-800">{emp.firstName} {emp.lastNamePaterno}</div>
                    <div className="text-xs text-slate-500">{emp.rut}</div>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  {emp.issueCount > 0 ? (
                    <div className="flex items-center gap-1 text-red-600 bg-red-50 px-2 py-1 rounded text-xs font-bold">
                      <AlertCircle size={14} /> Requiere Revisión ({emp.issueCount})
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-green-600 bg-green-50 px-2 py-1 rounded text-xs font-bold">
                      <CheckCircle2 size={14} /> Al Día
                    </div>
                  )}
                  <div className="text-xs font-medium text-slate-500 w-24 text-right">
                    {emp.activeContracts.length} activos
                  </div>
                </div>
              </div>

              {expandedEmpId === emp.id && (
                <div className="bg-slate-50 p-4 pl-12 border-t border-slate-100">
                  {emp.contracts.length === 0 ? (
                    <div className="text-sm text-slate-500 italic py-2">No se han encontrado contratos para este colaborador.</div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Historial de Contratos</div>
                      {emp.contracts.map(c => (
                        <div key={c.id} className="flex flex-col md:flex-row md:items-center justify-between bg-white p-3 rounded border border-slate-200">
                          <div className="flex flex-col">
                            <span className="font-semibold text-slate-800 text-sm">
                              {c.tipo} - <span className="text-slate-500 font-normal">{c.cargo || 'Sin Cargo'}</span>
                            </span>
                            <span className="text-xs text-slate-500 mt-1">
                              Inicio: {c.fechaInicio} {c.fechaTermino ? `| Término: ${c.fechaTermino}` : '| Indefinido'}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-3 mt-3 md:mt-0">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${c.estado === 'vigente' ? 'bg-green-100 text-green-700' : c.estado === 'pendiente_firma' ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-100 text-slate-600'}`}>
                              {c.estado.replace('_', ' ').toUpperCase()}
                            </span>
                            
                            {emp.activeContracts.length > 1 && (c.estado === 'vigente' || c.estado === 'pendiente_firma') && (
                              <button 
                                onClick={() => openResolveModal(c, emp.id)}
                                className="px-3 py-1 bg-blue-50 text-blue-600 rounded text-xs font-bold hover:bg-blue-100 transition border border-blue-200"
                              >
                                Resolver Turnos a este contrato
                              </button>
                            )}
                            
                            {c.googleDriveUrl && (
                              <a href={c.googleDriveUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline text-xs">Ver PDF</a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {emp.activeContracts.length === 0 && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded text-sm text-red-700">
                      <strong>Alerta:</strong> Este colaborador no tiene ningún contrato activo registrado en el sistema. Los turnos asignados aparecerán como "Sin Contrato".
                    </div>
                  )}
                  
                  {emp.activeContracts.length > 1 && (
                    <div className="mt-4 p-3 bg-purple-50 border border-purple-100 rounded text-sm text-purple-700">
                      <strong>Alerta Múltiples Contratos:</strong> Este colaborador tiene más de un contrato activo simultáneamente. Resuelve ambigüedades vinculando turnos específicos al contrato correcto.
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {paginatedEmployeesWithContracts.length === 0 && (
            <div className="p-8 text-center text-slate-500 font-medium text-sm">
              No se encontraron colaboradores que coincidan con la búsqueda.
            </div>
          )}
        </div>

        {/* Paginación de Contratos */}
        {totalContractPages > 1 && (
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-3">
            <span className="text-xs text-slate-500 font-medium">
              Mostrando {paginatedEmployeesWithContracts.length} de {filteredEmployeesWithContracts.length} registros
            </span>
            <div className="flex gap-1">
              <button
                disabled={currentPageContracts === 1}
                onClick={() => setCurrentPageContracts(p => Math.max(1, p - 1))}
                className="px-3 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-600 disabled:opacity-50 hover:bg-slate-50 transition"
              >
                Anterior
              </button>
              <div className="px-3 py-1 text-xs font-bold text-slate-600 bg-transparent flex items-center justify-center min-w-[100px]">
                Página {currentPageContracts} de {totalContractPages}
              </div>
              <button
                disabled={currentPageContracts === totalContractPages}
                onClick={() => setCurrentPageContracts(p => Math.min(totalContractPages, p + 1))}
                className="px-3 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-600 disabled:opacity-50 hover:bg-slate-50 transition"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal Resolución Manual */}
      {resolveModal.isOpen && resolveModal.contrato && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-4 bg-blue-600 text-white flex items-center justify-between">
              <h3 className="font-bold">Resolución Manual de Turnos</h3>
              <button onClick={() => setResolveModal(prev => ({...prev, isOpen: false}))} className="text-white/80 hover:text-white">
                <XCircle size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600">
                Selecciona el rango de fechas para el cual los turnos de este colaborador deben quedar forzosamente asociados al siguiente contrato:
              </p>
              
              <div className="p-3 bg-slate-50 border border-slate-200 rounded text-sm font-medium">
                {resolveModal.contrato.tipo} ({resolveModal.contrato.cargo || 'Sin cargo'})
                <div className="text-xs text-slate-500 mt-1">ID: {resolveModal.contrato.id}</div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Fecha Inicio Rango</label>
                  <input 
                    type="date" 
                    value={resolveModal.fechaInicio}
                    onChange={(e) => setResolveModal(prev => ({...prev, fechaInicio: e.target.value}))}
                    className="w-full p-2 border border-slate-300 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Fecha Fin Rango</label>
                  <input 
                    type="date" 
                    value={resolveModal.fechaTermino}
                    onChange={(e) => setResolveModal(prev => ({...prev, fechaTermino: e.target.value}))}
                    className="w-full p-2 border border-slate-300 rounded text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Motivo de Resolución</label>
                <textarea 
                  value={resolveModal.motivo}
                  onChange={(e) => setResolveModal(prev => ({...prev, motivo: e.target.value}))}
                  placeholder="Ej: Empleado trabaja doble turno bajo diferentes razones sociales, se clarifica."
                  className="w-full p-2 border border-slate-300 rounded text-sm resize-none h-20"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button 
                onClick={() => setResolveModal(prev => ({...prev, isOpen: false}))}
                className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded transition"
                disabled={resolveModal.isProcessing}
              >
                Cancelar
              </button>
              <button 
                onClick={handleResolveSubmit}
                disabled={resolveModal.isProcessing || !resolveModal.motivo.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded shadow transition disabled:opacity-50"
              >
                {resolveModal.isProcessing ? 'Resolviendo...' : 'Aplicar Resolución'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showVacationModal && (
        <VacationFormModal 
          onClose={() => setShowVacationModal(false)}
          onSuccess={() => setShowVacationModal(false)}
        />
      )}

      {regularizeModalEmp && (
        <RegularizeContractModal
          isOpen={true}
          onClose={() => setRegularizeModalEmp(null)}
          employee={regularizeModalEmp}
          sites={sites}
        />
      )}
    </div>
  );
};

export default HRContractsDashboard;
