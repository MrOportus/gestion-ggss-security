import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { 
  ClipboardList, Users, ShieldAlert, CalendarClock, Palmtree, 
  Search, Eye, XCircle, CheckCircle, Clock, ChevronRight, ChevronDown, 
  FilePlus, AlertCircle, CheckCircle2, FileText, Plus, RefreshCw, 
  ExternalLink, Building, Filter, Calendar, ShieldCheck, FileCheck, Edit2,
  Briefcase, UserX, AlertTriangle, Shield
} from 'lucide-react';
import VacationFormModal from '../components/VacationFormModal';
import { ContractManagementModal } from '../components/ContractManagementModal';
import EmployeeModal from '../components/EmployeeModal';
import { Contrato, EstadoContrato, EstadoDocumental } from '../types/phase1';
import { Employee, EstadoOperativoColaborador } from '../types';
import { normalizeText, matchesEmployeeSearch, formatDateDDMMYYYY } from '../lib/textUtils';
import { resolveEmployeeOperationalStatus } from '../lib/phase3/contratosService';

interface EnrichedDirectoryWorker {
  id: string;
  employee: Employee;
  workerName: string;
  workerRut: string;
  cargo: string;
  operationalStatus: EstadoOperativoColaborador;
  resolvedSiteId: string;
  resolvedSiteName: string;
  isFalabella: boolean;
  
  // Información contractual
  activeContract: Contrato | null;
  historyCount: number;
  contractType: string;
  contractDates: string;
  computedContractStatus: 'vigente' | 'por_vencer' | 'termino_cumplido' | 'pendiente_firma' | 'sin_contrato' | 'renovado' | 'borrador';
  diffDays: number | null;
  docStatus: string;
  docUrl?: string;
  dropboxUrl?: string;
  isLegacy: boolean;
}

const HRContractsDashboard: React.FC = () => {
  const { 
    employees, 
    contratos, 
    vacations, 
    sites, 
    updateVacationStatus, 
    currentUser,
    fetchContratos,
    showConfirmation,
    showNotification
  } = useAppStore();

  // ----- PESTAÑA PRINCIPAL DEL MÓDULO -----
  const [mainTab, setMainTab] = useState<'directorio' | 'vacaciones'>('directorio');

  // ----- VISTAS DEL DIRECTORIO (ESTADO OPERATIVO) -----
  const [operationalTab, setOperationalTab] = useState<'todos' | 'en_servicio' | 'reserva' | 'inactivo' | 'por_revisar'>('todos');

  // ----- ESTADOS DE MODALES -----
  const [contractModalState, setContractModalState] = useState<{
    isOpen: boolean;
    mode: 'create' | 'renew' | 'edit' | 'link_doc';
    preselectedEmployee?: Employee | null;
    contratoAnterior?: Contrato | null;
    contratoToEdit?: Contrato | null;
  }>({
    isOpen: false,
    mode: 'create',
    preselectedEmployee: null,
    contratoAnterior: null,
    contratoToEdit: null
  });

  const [showVacationModal, setShowVacationModal] = useState(false);
  const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null);

  // ----- FILTROS DEL DIRECTORIO -----
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterContractStatus, setFilterContractStatus] = useState('');
  const [excludeFalabella, setExcludeFalabella] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // ----- ESTADOS DE VACACIONES -----
  const [activeVacationTab, setActiveVacationTab] = useState<'todos' | 'pending' | 'approved' | 'en_curso' | 'completed' | 'cancelled'>('todos');
  const [vacationSearch, setVacationSearch] = useState('');

  // Cargar todos los contratos al montar sin límite artificial
  useEffect(() => {
    fetchContratos();
  }, [fetchContratos]);

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  // Mapa de sucursales para búsqueda rápida O(1)
  const siteMap = useMemo(() => {
    const map = new Map<string, string>();
    sites.forEach(s => map.set(String(s.id), s.name));
    return map;
  }, [sites]);

  // Identificador de sucursales asociadas a Falabella
  const isFalabellaSite = useMemo(() => {
    return (s: any) => {
      if (!s) return false;
      const name = normalizeText(s.name || '');
      const empresa = normalizeText(s.empresa || '');
      return name.includes('falabella') || empresa.includes('falabella');
    };
  }, []);

  const falabellaSiteIds = useMemo(() => {
    return new Set(sites.filter(isFalabellaSite).map(s => String(s.id)));
  }, [sites, isFalabellaSite]);

  // Si se activa excluir Falabella y había una sucursal Falabella seleccionada, se resetea el filtro de sucursal
  useEffect(() => {
    if (excludeFalabella && filterBranch && falabellaSiteIds.has(String(filterBranch))) {
      setFilterBranch('');
    }
  }, [excludeFalabella, filterBranch, falabellaSiteIds]);

  // =========================================================================
  // 1. ENRIQUECIMIENTO CENTRALIZADO DE TODOS LOS TRABAJADORES (DIRECTORIO)
  // =========================================================================
  const enrichedWorkers = useMemo<EnrichedDirectoryWorker[]>(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayObj = new Date(today + 'T00:00:00');

    // Indexar contratos válidos por colaboradorId
    const contractsByWorker = new Map<string, Contrato[]>();
    (contratos || []).forEach(c => {
      const arr = contractsByWorker.get(c.colaboradorId) || [];
      arr.push(c);
      contractsByWorker.set(c.colaboradorId, arr);
    });

    return employees.map(emp => {
      const workerName = `${emp.firstName || ''} ${emp.lastNamePaterno || ''} ${emp.lastNameMaterno || ''}`.trim() || 'Sin Nombre';
      const workerRut = emp.rut || '---';
      const cargo = emp.cargo || 'Sin cargo asignado';
      const operationalStatus = resolveEmployeeOperationalStatus(emp);

      // Contratos de este colaborador
      const userContracts = contractsByWorker.get(emp.id) || [];
      const validContracts = userContracts.filter(c => c.estado !== 'anulado');

      // Ordenar contratos: Vigente primero > fecha término desc > fecha inicio desc > creado desc
      const sortedContracts = [...validContracts].sort((a, b) => {
        const aIsVig = a.estado === 'vigente' && (!a.fechaTermino || a.fechaTermino >= today) ? 1 : 0;
        const bIsVig = b.estado === 'vigente' && (!b.fechaTermino || b.fechaTermino >= today) ? 1 : 0;
        if (aIsVig !== bIsVig) return bIsVig - aIsVig;
        const aTerm = a.fechaTermino || '9999-99-99';
        const bTerm = b.fechaTermino || '9999-99-99';
        if (aTerm !== bTerm) return bTerm.localeCompare(aTerm);
        const aIni = a.fechaInicio || '';
        const bIni = b.fechaInicio || '';
        if (aIni !== bIni) return bIni.localeCompare(aIni);
        return (b.creadoEn || '').localeCompare(a.creadoEn || '');
      });

      const activeContract = sortedContracts[0] || null;
      const historyCount = validContracts.length;

      let computedContractStatus: 'vigente' | 'por_vencer' | 'termino_cumplido' | 'pendiente_firma' | 'sin_contrato' | 'renovado' | 'borrador' = 'sin_contrato';
      let contractType = 'Sin Registro';
      let contractDates = 'Sin contrato';
      let diffDays: number | null = null;
      let docStatus = 'no_adjunto';
      let docUrl: string | undefined = undefined;
      let isLegacy = false;

      if (activeContract) {
        contractType = activeContract.tipo;
        contractDates = `${formatDateDDMMYYYY(activeContract.fechaInicio)} al ${activeContract.fechaTermino ? formatDateDDMMYYYY(activeContract.fechaTermino) : 'Indefinido'}`;
        docStatus = activeContract.estadoDocumental || 'no_adjunto';
        docUrl = activeContract.googleDriveUrl;

        if (activeContract.estado === 'pendiente_firma') {
          computedContractStatus = 'pendiente_firma';
        } else if (activeContract.estado === 'borrador') {
          computedContractStatus = 'borrador';
        } else if (activeContract.estado === 'renovado') {
          computedContractStatus = 'renovado';
        } else if (activeContract.fechaTermino) {
          const termObj = new Date(activeContract.fechaTermino + 'T00:00:00');
          diffDays = Math.ceil((termObj.getTime() - todayObj.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays < 0) {
            computedContractStatus = 'termino_cumplido';
          } else if (diffDays <= 30) {
            computedContractStatus = 'por_vencer';
          } else {
            computedContractStatus = 'vigente';
          }
        } else {
          computedContractStatus = activeContract.estado === 'vigente' ? 'vigente' : 'termino_cumplido';
        }
      } else if (emp.fechaInicioContrato) {
        // Datos contractuales heredados / legacy en la ficha de empleado
        isLegacy = true;
        contractType = emp.tipoContrato || 'Plazo Fijo';
        docStatus = 'no_adjunto';
        if (emp.fechaTerminoContrato) {
          contractDates = `${formatDateDDMMYYYY(emp.fechaInicioContrato)} al ${formatDateDDMMYYYY(emp.fechaTerminoContrato)}`;
          const termObj = new Date(emp.fechaTerminoContrato + 'T00:00:00');
          diffDays = Math.ceil((termObj.getTime() - todayObj.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays < 0) {
            computedContractStatus = 'termino_cumplido';
          } else if (diffDays <= 30) {
            computedContractStatus = 'por_vencer';
          } else {
            computedContractStatus = 'vigente';
          }
        } else {
          contractDates = `${formatDateDDMMYYYY(emp.fechaInicioContrato)} al Indefinido`;
          computedContractStatus = 'vigente';
        }
      }

      // Resolución de Sucursal de Referencia / Asignada
      let resolvedSiteId = '0';
      if (emp.currentSiteId && Number(emp.currentSiteId) > 0) {
        resolvedSiteId = String(emp.currentSiteId);
      } else if (activeContract?.sucursalId && activeContract.sucursalId !== '0') {
        resolvedSiteId = String(activeContract.sucursalId);
      }

      const resolvedSiteName = resolvedSiteId === '0' || !resolvedSiteId
        ? 'Sin Asignar / Multisitio'
        : (siteMap.get(resolvedSiteId) || `Sucursal ${resolvedSiteId}`);

      // Detección de Falabella para este colaborador
      const isFalabella = 
        falabellaSiteIds.has(String(emp.currentSiteId)) ||
        falabellaSiteIds.has(String(resolvedSiteId)) ||
        normalizeText(resolvedSiteName).includes('falabella') ||
        (activeContract?.sucursalId ? falabellaSiteIds.has(String(activeContract.sucursalId)) : false);

      return {
        id: emp.id,
        employee: emp,
        workerName,
        workerRut,
        cargo,
        operationalStatus,
        resolvedSiteId,
        resolvedSiteName,
        isFalabella,
        activeContract,
        historyCount: historyCount > 0 ? historyCount : (isLegacy ? 1 : 0),
        contractType,
        contractDates,
        computedContractStatus,
        diffDays,
        docStatus,
        docUrl,
        dropboxUrl: emp.dropboxUrl,
        isLegacy
      };
    });
  }, [employees, contratos, siteMap, falabellaSiteIds]);

  // Cantidad total de trabajadores vinculados a Falabella
  const falabellaWorkersCount = useMemo(() => {
    return enrichedWorkers.filter(w => w.isFalabella).length;
  }, [enrichedWorkers]);

  // Conjunto base respetando la exclusión voluntaria de Falabella
  const baseWorkers = useMemo(() => {
    if (excludeFalabella) {
      return enrichedWorkers.filter(w => !w.isFalabella);
    }
    return enrichedWorkers;
  }, [enrichedWorkers, excludeFalabella]);

  // =========================================================================
  // 2. INDICADORES PRINCIPALES DEL DIRECTORIO (FASE 4)
  // =========================================================================
  const directoryMetrics = useMemo(() => {
    const total = baseWorkers.length;
    const enServicio = baseWorkers.filter(w => w.operationalStatus === 'en_servicio').length;
    const reservas = baseWorkers.filter(w => w.operationalStatus === 'reserva').length;
    const inactivos = baseWorkers.filter(w => w.operationalStatus === 'inactivo').length;
    const porRevisar = baseWorkers.filter(w => w.operationalStatus === 'por_revisar' || w.computedContractStatus === 'sin_contrato').length;
    const vencimientos = baseWorkers.filter(w => w.computedContractStatus === 'por_vencer' || w.computedContractStatus === 'termino_cumplido').length;

    return {
      total,
      enServicio,
      reservas,
      inactivos,
      porRevisar,
      vencimientos
    };
  }, [baseWorkers]);

  // =========================================================================
  // 3. FILTRADO REACTIVO DEL DIRECTORIO
  // =========================================================================
  const filteredWorkers = useMemo(() => {
    let list = baseWorkers;

    // 1. Pestaña de Estado Operativo
    if (operationalTab !== 'todos') {
      if (operationalTab === 'por_revisar') {
        list = list.filter(w => w.operationalStatus === 'por_revisar' || w.computedContractStatus === 'sin_contrato');
      } else {
        list = list.filter(w => w.operationalStatus === operationalTab);
      }
    }

    // 2. Búsqueda por texto (nombre, RUT, código)
    if (searchTerm.trim()) {
      list = list.filter(w => matchesEmployeeSearch(searchTerm, w.employee));
    }

    // 3. Filtro por Sucursal
    if (filterBranch) {
      list = list.filter(w => String(w.resolvedSiteId) === String(filterBranch));
    }

    // 4. Filtro por Tipo de Contrato
    if (filterType) {
      list = list.filter(w => w.contractType.toLowerCase() === filterType.toLowerCase());
    }

    // 5. Filtro por Estado Contractual
    if (filterContractStatus) {
      if (filterContractStatus === 'vigente') {
        list = list.filter(w => w.computedContractStatus === 'vigente' || w.computedContractStatus === 'por_vencer');
      } else {
        list = list.filter(w => w.computedContractStatus === filterContractStatus);
      }
    }

    // Ordenamiento: En servicio primero, luego reservas, por revisar e inactivos al final
    return list.sort((a, b) => {
      const orderMap = { en_servicio: 0, reserva: 1, por_revisar: 2, inactivo: 3 };
      const aOrder = orderMap[a.operationalStatus] ?? 2;
      const bOrder = orderMap[b.operationalStatus] ?? 2;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.workerName.localeCompare(b.workerName);
    });
  }, [baseWorkers, operationalTab, searchTerm, filterBranch, filterType, filterContractStatus]);

  // Paginación de colaboradores
  const paginatedWorkers = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredWorkers.slice(start, start + itemsPerPage);
  }, [filteredWorkers, currentPage]);

  const totalPages = Math.ceil(filteredWorkers.length / itemsPerPage) || 1;

  // Reset de página al cambiar filtros
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterBranch, filterType, filterContractStatus, operationalTab, excludeFalabella]);

  // Identificador de filtros activos para botón Limpiar
  const hasActiveFilters = Boolean(
    searchTerm ||
    filterBranch ||
    filterType ||
    filterContractStatus ||
    operationalTab !== 'todos' ||
    excludeFalabella
  );

  const handleClearFilters = () => {
    setSearchTerm('');
    setFilterBranch('');
    setFilterType('');
    setFilterContractStatus('');
    setOperationalTab('todos');
    setExcludeFalabella(false);
    setCurrentPage(1);
  };

  // =========================================================================
  // 4. LÓGICA DE VACACIONES (PRESERVADA)
  // =========================================================================
  const currentVacationsCount = useMemo(() => {
    return vacations.filter(v => v.status === 'approved' && v.startDate <= todayStr && v.endDate >= todayStr).length;
  }, [vacations, todayStr]);

  const pendingVacationsCount = useMemo(() => {
    return vacations.filter(v => v.status === 'pending').length;
  }, [vacations]);

  const filteredVacations = useMemo(() => {
    let list = vacations;
    if (excludeFalabella) {
      list = list.filter(v => {
        const emp = employees.find(e => e.id === v.employeeId);
        if (emp?.currentSiteId && falabellaSiteIds.has(String(emp.currentSiteId))) return false;
        const userContracts = (contratos || []).filter(c => c.colaboradorId === v.employeeId && c.estado !== 'anulado');
        if (userContracts.some(c => falabellaSiteIds.has(String(c.sucursalId)))) return false;
        return true;
      });
    }
    if (activeVacationTab !== 'todos') {
      if (activeVacationTab === 'en_curso') {
        list = list.filter(v => v.status === 'approved' && v.startDate <= todayStr && v.endDate >= todayStr);
      } else {
        list = list.filter(v => v.status === activeVacationTab);
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
  }, [vacations, activeVacationTab, vacationSearch, employees, todayStr, excludeFalabella, falabellaSiteIds, contratos]);

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

  const getSiteNameById = (id: string | number) => siteMap.get(String(id)) || 'Desconocida';
  const getEmpNameById = (id: string) => {
    const e = employees.find(emp => emp.id === id);
    return e ? `${e.firstName} ${e.lastNamePaterno}` : 'Desconocido';
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 pb-24 animate-in fade-in duration-300">
      
      {/* HEADER PRINCIPAL */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight uppercase flex items-center gap-3">
            <ClipboardList className="text-blue-600" />
            Directorio RR. HH. y Gestión Contractual
          </h1>
          <p className="text-slate-500 text-sm font-medium">
            Control integral del personal, situación operativa, trazabilidad de contratos y coberturas
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {(currentUser?.role === 'admin' || currentUser?.role === 'rrhh') && (
            <button
              onClick={() => setContractModalState({
                isOpen: true,
                mode: 'create',
                preselectedEmployee: null,
                contratoAnterior: null
              })}
              className="py-2.5 px-5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-md shadow-blue-200 transition-all active:scale-95 flex items-center gap-2"
            >
              <Plus size={16} /> Emitir Contrato
            </button>
          )}

          <button
            onClick={() => setShowVacationModal(true)}
            className="py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-md shadow-emerald-200 transition-all active:scale-95 flex items-center gap-2"
          >
            <Palmtree size={16} /> Registrar Vacaciones
          </button>
        </div>
      </div>

      {/* SELECTOR DE PESTAÑA PRINCIPAL */}
      <div className="flex border-b border-slate-200 gap-4">
        <button
          onClick={() => setMainTab('directorio')}
          className={`pb-3 text-xs font-black uppercase tracking-wider flex items-center gap-2 border-b-2 transition ${
            mainTab === 'directorio' 
              ? 'border-blue-600 text-blue-600' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Users size={16} /> Directorio de Colaboradores ({baseWorkers.length})
        </button>
        <button
          onClick={() => setMainTab('vacaciones')}
          className={`pb-3 text-xs font-black uppercase tracking-wider flex items-center gap-2 border-b-2 transition ${
            mainTab === 'vacaciones' 
              ? 'border-blue-600 text-blue-600' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Palmtree size={16} /> Gestión de Vacaciones ({vacations.length})
        </button>
      </div>

      {/* ========================================================================= */}
      {/* VISTA 1: DIRECTORIO COMPLETO DE COLABORADORES */}
      {/* ========================================================================= */}
      {mainTab === 'directorio' && (
        <div className="space-y-5">
          
          {/* TARJETAS DE INDICADORES PRINCIPALES (FASE 4) */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            
            {/* Total Colaboradores */}
            <div 
              onClick={() => { setOperationalTab('todos'); setFilterContractStatus(''); }}
              className={`p-4 rounded-2xl border transition cursor-pointer shadow-sm ${
                operationalTab === 'todos' && !filterContractStatus
                  ? 'bg-blue-50/50 border-blue-400 ring-2 ring-blue-200' 
                  : 'bg-white border-slate-200 hover:border-blue-300'
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Personal</span>
                <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg"><Users size={14} /></div>
              </div>
              <div className="text-2xl font-black text-slate-800">{directoryMetrics.total}</div>
              <p className="text-[10px] font-medium text-slate-500 mt-0.5">Registrados en BD</p>
            </div>

            {/* En Servicio */}
            <div 
              onClick={() => { setOperationalTab('en_servicio'); setFilterContractStatus(''); }}
              className={`p-4 rounded-2xl border transition cursor-pointer shadow-sm ${
                operationalTab === 'en_servicio' 
                  ? 'bg-emerald-50/50 border-emerald-400 ring-2 ring-emerald-200' 
                  : 'bg-white border-slate-200 hover:border-emerald-300'
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">En Servicio</span>
                <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg"><CheckCircle2 size={14} /></div>
              </div>
              <div className="text-2xl font-black text-emerald-600">{directoryMetrics.enServicio}</div>
              <p className="text-[10px] font-medium text-emerald-600 mt-0.5">Asignados a puestos</p>
            </div>

            {/* Reservas para Coberturas */}
            <div 
              onClick={() => { setOperationalTab('reserva'); setFilterContractStatus(''); }}
              className={`p-4 rounded-2xl border transition cursor-pointer shadow-sm ${
                operationalTab === 'reserva' 
                  ? 'bg-blue-50/50 border-blue-400 ring-2 ring-blue-200' 
                  : 'bg-white border-slate-200 hover:border-blue-300'
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="text-[10px] font-black text-blue-700 uppercase tracking-widest">Reservas</span>
                <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg"><CalendarClock size={14} /></div>
              </div>
              <div className="text-2xl font-black text-blue-600">{directoryMetrics.reservas}</div>
              <p className="text-[10px] font-medium text-blue-700 mt-0.5">Disponibles cobertura</p>
            </div>

            {/* Casos por Revisar */}
            <div 
              onClick={() => { setOperationalTab('por_revisar'); }}
              className={`p-4 rounded-2xl border transition cursor-pointer shadow-sm ${
                operationalTab === 'por_revisar' 
                  ? 'bg-amber-50/50 border-amber-400 ring-2 ring-amber-200' 
                  : 'bg-white border-amber-200 bg-amber-50/20 hover:border-amber-400'
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">Por Revisar</span>
                <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg"><AlertCircle size={14} /></div>
              </div>
              <div className="text-2xl font-black text-amber-600">{directoryMetrics.porRevisar}</div>
              <p className="text-[10px] font-medium text-amber-700 mt-0.5">Sin sucursal o contrato</p>
            </div>

            {/* Inactivos */}
            <div 
              onClick={() => { setOperationalTab('inactivo'); setFilterContractStatus(''); }}
              className={`p-4 rounded-2xl border transition cursor-pointer shadow-sm ${
                operationalTab === 'inactivo' 
                  ? 'bg-rose-50/50 border-rose-400 ring-2 ring-rose-200' 
                  : 'bg-white border-slate-200 hover:border-rose-300'
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Inactivos</span>
                <div className="p-1.5 bg-rose-50 text-rose-600 rounded-lg"><UserX size={14} /></div>
              </div>
              <div className="text-2xl font-black text-slate-700">{directoryMetrics.inactivos}</div>
              <p className="text-[10px] font-medium text-rose-600 mt-0.5">Baja / Históricos</p>
            </div>

            {/* Vencimientos Contractuales */}
            <div 
              onClick={() => { setFilterContractStatus('por_vencer'); }}
              className={`p-4 rounded-2xl border transition cursor-pointer shadow-sm ${
                filterContractStatus === 'por_vencer' 
                  ? 'bg-purple-50/50 border-purple-400 ring-2 ring-purple-200' 
                  : 'bg-white border-slate-200 hover:border-purple-300'
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="text-[10px] font-black text-purple-700 uppercase tracking-widest">Vencimientos</span>
                <div className="p-1.5 bg-purple-50 text-purple-600 rounded-lg"><Clock size={14} /></div>
              </div>
              <div className="text-2xl font-black text-purple-600">{directoryMetrics.vencimientos}</div>
              <p className="text-[10px] font-medium text-purple-700 mt-0.5">Por renovar (≤ 30d)</p>
            </div>

          </div>

          {/* CONTENEDOR PRINCIPAL DE LA TABLA Y FILTROS */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden space-y-4">
            
            {/* VISTAS DE ESTADO OPERATIVO (PESTAÑAS SECUNDARIAS) */}
            <div className="px-4 pt-3 border-b border-slate-200 flex gap-2 overflow-x-auto bg-slate-50/50">
              {[
                { id: 'todos', label: 'Todos', count: directoryMetrics.total },
                { id: 'en_servicio', label: 'En Servicio', count: directoryMetrics.enServicio },
                { id: 'reserva', label: 'Reservas para Coberturas', count: directoryMetrics.reservas },
                { id: 'inactivo', label: 'Inactivos', count: directoryMetrics.inactivos },
                { id: 'por_revisar', label: 'Por Revisar', count: directoryMetrics.porRevisar }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setOperationalTab(tab.id as any)}
                  className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 flex items-center gap-1.5 whitespace-nowrap ${
                    operationalTab === tab.id
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${
                    operationalTab === tab.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* BARRA DE FILTROS DEL DIRECTORIO */}
            <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
              
              {/* Buscador de Colaborador */}
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                <input
                  type="text"
                  placeholder="Buscar por trabajador, RUT o código..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                {searchTerm && (
                  <button 
                    onClick={() => setSearchTerm('')} 
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <XCircle size={14} />
                  </button>
                )}
              </div>

              {/* Selectores de Filtro */}
              <div className="flex flex-wrap items-center gap-2">
                
                {/* Sucursal */}
                <select
                  value={filterBranch}
                  onChange={(e) => setFilterBranch(e.target.value)}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="">Todas las Sucursales</option>
                  <option value="0">Sin Asignar / Multisitio</option>
                  {sites
                    .filter(s => s.active && (!excludeFalabella || !falabellaSiteIds.has(String(s.id))))
                    .map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>

                {/* Tipo de Contrato */}
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="">Todos los Tipos</option>
                  <option value="Plazo Fijo">Plazo Fijo</option>
                  <option value="Indefinido">Indefinido</option>
                  <option value="Obra y Faena">Obra y Faena</option>
                </select>

                {/* Estado Contractual */}
                <select
                  value={filterContractStatus}
                  onChange={(e) => setFilterContractStatus(e.target.value)}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="">Todos los Contratos</option>
                  <option value="vigente">Vigente (Al Día)</option>
                  <option value="por_vencer">Próximo a Vencer (≤ 30d)</option>
                  <option value="termino_cumplido">Caducado / Término Cumplido</option>
                  <option value="pendiente_firma">Pendiente de Firma</option>
                  <option value="sin_contrato">Sin Contrato Registrado</option>
                </select>

                {/* Checkbox Excluir Falabella (REGLA ESPECÍFICA: CONSERVADO) */}
                <label 
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold cursor-pointer transition select-none border ${
                    excludeFalabella 
                      ? 'bg-amber-50 border-amber-300 text-amber-900 shadow-sm' 
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                  title="Oculta colaboradores y contratos asociados a sucursales de Falabella para facilitar la revisión del resto de la dotación"
                >
                  <input
                    type="checkbox"
                    checked={excludeFalabella}
                    onChange={(e) => setExcludeFalabella(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer accent-blue-600"
                  />
                  <span className="flex items-center gap-1.5">
                    <span>Excluir Falabella</span>
                    {falabellaWorkersCount > 0 && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${
                        excludeFalabella ? 'bg-amber-200 text-amber-800' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {falabellaWorkersCount}
                      </span>
                    )}
                  </span>
                </label>

                {hasActiveFilters && (
                  <button
                    onClick={handleClearFilters}
                    className="px-3 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
                    title="Restablecer todos los filtros"
                  >
                    Limpiar
                  </button>
                )}

              </div>
            </div>

            {/* BANNER NOTICIA CUANDO EXCLUIR FALABELLA ESTÁ ACTIVO */}
            {excludeFalabella && (
              <div className="mx-4 mt-3 px-3.5 py-2 bg-amber-50/90 border border-amber-200 rounded-xl text-xs font-medium text-amber-800 flex items-center justify-between animate-in fade-in duration-200">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  <span>
                    Filtro activo: <strong>Excluyendo personal y contratos de Falabella</strong> ({falabellaWorkersCount} colaboradores de Falabella ocultos temporalmente).
                  </span>
                </span>
                <button 
                  onClick={() => setExcludeFalabella(false)}
                  className="text-[11px] font-bold text-amber-700 hover:text-amber-900 underline ml-2"
                >
                  Mostrar todos
                </button>
              </div>
            )}

            {/* TABLA DEL DIRECTORIO COMPLETO */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] uppercase tracking-widest text-slate-400 font-black bg-slate-50">
                    <th className="p-3.5">Trabajador / RUT</th>
                    <th className="p-3.5 text-center">Estado Operativo</th>
                    <th className="p-3.5">Sucursal Referencia</th>
                    <th className="p-3.5">Situación Contractual</th>
                    <th className="p-3.5">Vigencia Contractual</th>
                    <th className="p-3.5 text-center">Respaldo</th>
                    <th className="p-3.5 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {paginatedWorkers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-slate-400 font-bold">
                        No se encontraron colaboradores que coincidan con los filtros aplicados.
                      </td>
                    </tr>
                  ) : (
                    paginatedWorkers.map(w => {
                      const isVigente = w.computedContractStatus === 'vigente';
                      const isPorVencer = w.computedContractStatus === 'por_vencer';
                      const isTerminoCumplido = w.computedContractStatus === 'termino_cumplido';
                      const isPendienteFirma = w.computedContractStatus === 'pendiente_firma';
                      const isSinContrato = w.computedContractStatus === 'sin_contrato';

                      return (
                        <tr key={w.id} className="hover:bg-slate-50/70 transition">
                          
                          {/* Trabajador / RUT */}
                          <td className="p-3.5">
                            <div 
                              onClick={() => setViewingEmployee(w.employee)}
                              className="cursor-pointer group"
                              title="Click para ver ficha completa e historial de contratos"
                            >
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-bold text-slate-800 group-hover:text-blue-600 transition">
                                  {w.workerName}
                                </p>
                                {w.historyCount > 1 && (
                                  <span 
                                    className="text-[10px] px-2 py-0.5 bg-slate-100 group-hover:bg-blue-50 text-slate-600 group-hover:text-blue-700 border border-slate-200 rounded-full font-bold transition flex items-center gap-1"
                                    title={`Tiene ${w.historyCount} contratos registrados. Haz clic para ver el historial completo.`}
                                  >
                                    <Clock size={10} />
                                    <span>{w.historyCount} contratos</span>
                                  </span>
                                )}
                                {isSinContrato && (
                                  <span className="text-[10px] px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-full font-bold">
                                    Sin Contrato
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                                <span className="font-mono">{w.workerRut}</span>
                                <span>•</span>
                                <span>{w.cargo}</span>
                              </div>
                            </div>
                          </td>

                          {/* Estado Operativo */}
                          <td className="p-3.5 text-center">
                            <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border ${
                              w.operationalStatus === 'en_servicio' ? 'bg-emerald-50 text-emerald-700 border-emerald-300' :
                              w.operationalStatus === 'reserva' ? 'bg-blue-50 text-blue-700 border-blue-300' :
                              w.operationalStatus === 'por_revisar' ? 'bg-amber-50 text-amber-700 border-amber-300' :
                              'bg-rose-50 text-rose-700 border-rose-300'
                            }`}>
                              {w.operationalStatus === 'en_servicio' ? 'En servicio' :
                               w.operationalStatus === 'reserva' ? 'Reserva cobertura' :
                               w.operationalStatus === 'por_revisar' ? 'Por revisar' : 'Inactivo'}
                            </span>
                          </td>

                          {/* Sucursal Referencia */}
                          <td className="p-3.5">
                            <div className="flex items-center gap-1.5 text-slate-700">
                              <Building size={13} className="text-slate-400 shrink-0" />
                              <span className="font-medium truncate max-w-[170px]" title={w.resolvedSiteName}>
                                {w.resolvedSiteName}
                              </span>
                            </div>
                          </td>

                          {/* Situación Contractual */}
                          <td className="p-3.5">
                            <div className="space-y-0.5">
                              <p className="font-semibold text-slate-800">{w.contractType}</p>
                              <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-bold uppercase border ${
                                isVigente ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                isPorVencer ? 'bg-amber-50 text-amber-700 border-amber-300 animate-pulse' :
                                isTerminoCumplido ? 'bg-rose-50 text-rose-700 border-rose-300' :
                                isPendienteFirma ? 'bg-purple-50 text-purple-700 border-purple-200' :
                                isSinContrato ? 'bg-slate-100 text-slate-500 border-slate-200' :
                                'bg-slate-50 text-slate-600 border-slate-200'
                              }`}>
                                {isTerminoCumplido ? 'Caducado' : w.computedContractStatus === 'por_vencer' ? 'Por Vencer' : w.computedContractStatus.replace('_', ' ')}
                              </span>
                            </div>
                          </td>

                          {/* Vigencia Contractual */}
                          <td className="p-3.5">
                            <div className="space-y-0.5">
                              <span className="font-medium text-slate-800">
                                {w.contractDates}
                              </span>
                              {w.diffDays !== null && (
                                <p className={`text-[10px] font-bold ${
                                  w.diffDays < 0 ? 'text-rose-600' :
                                  w.diffDays <= 30 ? 'text-amber-600' : 'text-slate-400'
                                }`}>
                                  {w.diffDays < 0 
                                    ? `Expiró hace ${Math.abs(w.diffDays)} días` 
                                    : `${w.diffDays} días restantes`}
                                </p>
                              )}
                            </div>
                          </td>

                          {/* Respaldo Documental */}
                          <td className="p-3.5 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                                w.docStatus === 'firmado_digital' ? 'bg-teal-50 text-teal-700' :
                                w.docStatus === 'firmado_externo' ? 'bg-blue-50 text-blue-700' :
                                w.docStatus === 'generado_drive' ? 'bg-indigo-50 text-indigo-700' :
                                'bg-slate-100 text-slate-500'
                              }`}>
                                {w.docStatus.replace('_', ' ')}
                              </span>
                              <div className="flex items-center gap-1.5">
                                {w.docUrl && (
                                  <a
                                    href={w.docUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-blue-600 hover:text-blue-800 font-bold underline flex items-center gap-0.5"
                                    title="Ver PDF en Google Drive"
                                  >
                                    <ExternalLink size={10} /> PDF
                                  </a>
                                )}
                                {w.dropboxUrl && (
                                  <a
                                    href={w.dropboxUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold underline flex items-center gap-0.5"
                                    title="Abrir carpeta en Dropbox"
                                  >
                                    <ExternalLink size={10} /> Dropbox
                                  </a>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Acciones */}
                          <td className="p-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              
                              {/* Ver Ficha */}
                              <button
                                onClick={() => setViewingEmployee(w.employee)}
                                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition flex items-center gap-1"
                                title="Ver ficha completa e historial"
                              >
                                <Eye size={12} /> Ficha
                              </button>

                              {/* Acciones de gestión para Admin / RRHH */}
                              {(currentUser?.role === 'admin' || currentUser?.role === 'rrhh') && (
                                <>
                                  {w.activeContract && isVigente && (
                                    <button
                                      onClick={() => setContractModalState({
                                        isOpen: true,
                                        mode: 'renew',
                                        contratoAnterior: w.activeContract,
                                        preselectedEmployee: w.employee
                                      })}
                                      className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-lg text-xs font-bold transition flex items-center gap-1"
                                      title="Renovar contrato"
                                    >
                                      <RefreshCw size={11} /> Renovar
                                    </button>
                                  )}

                                  {isSinContrato && (
                                    <button
                                      onClick={() => setContractModalState({
                                        isOpen: true,
                                        mode: 'create',
                                        preselectedEmployee: w.employee
                                      })}
                                      className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-300 rounded-lg text-xs font-bold transition flex items-center gap-1"
                                      title="Regularizar y emitir contrato"
                                    >
                                      <Plus size={11} /> Contrato
                                    </button>
                                  )}
                                </>
                              )}

                            </div>
                          </td>

                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Paginación Confiable y Contadores */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-3">
              <span className="text-xs text-slate-500 font-medium">
                Mostrando <strong>{paginatedWorkers.length}</strong> de <strong>{filteredWorkers.length}</strong> colaboradores filtrados 
                <span className="text-slate-400 ml-1">(Total registrados en el sistema: {employees.length})</span>
              </span>
              
              {totalPages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-600 disabled:opacity-50 hover:bg-slate-50 transition"
                  >
                    Anterior
                  </button>
                  <div className="px-3 py-1.5 text-xs font-bold text-slate-600 flex items-center">
                    Página {currentPage} de {totalPages}
                  </div>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-600 disabled:opacity-50 hover:bg-slate-50 transition"
                  >
                    Siguiente
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VISTA 2: GESTIÓN DE VACACIONES (PRESERVADA) */}
      {/* ========================================================================= */}
      {mainTab === 'vacaciones' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Palmtree size={18} className="text-emerald-500" />
                Control y Aprobación de Vacaciones
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {currentVacationsCount} trabajadores actualmente de vacaciones • {pendingVacationsCount} solicitudes pendientes
              </p>
            </div>
            
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                placeholder="Buscar trabajador..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-emerald-500 outline-none"
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
                onClick={() => setActiveVacationTab(tab.id as any)}
                className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-all ${
                  activeVacationTab === tab.id 
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200' 
                    : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
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
                        <p className="text-xs font-bold text-slate-700">{getEmpNameById(vac.employeeId)}</p>
                      </td>
                      <td className="p-3">
                        <p className="text-[11px] font-medium text-slate-500">{getSiteNameById(vac.sucursalId)}</p>
                      </td>
                      <td className="p-3">
                        <p className="text-[11px] font-bold text-slate-700">{formatDateDDMMYYYY(vac.startDate)}</p>
                        <p className="text-[10px] text-slate-400">al {formatDateDDMMYYYY(vac.endDate)}</p>
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
      )}

      {/* MODAL DE GESTIÓN CONTRACTUAL */}
      {contractModalState.isOpen && (
        <ContractManagementModal
          isOpen={true}
          onClose={() => setContractModalState({ isOpen: false, mode: 'create' })}
          mode={contractModalState.mode}
          preselectedEmployee={contractModalState.preselectedEmployee}
          contratoAnterior={contractModalState.contratoAnterior}
          contratoToEdit={contractModalState.contratoToEdit}
          onSuccess={() => fetchContratos()}
        />
      )}

      {/* MODAL DE FICHA DEL EMPLEADO */}
      {viewingEmployee && (
        <EmployeeModal
          employee={viewingEmployee}
          onClose={() => setViewingEmployee(null)}
        />
      )}

      {/* MODAL DE REGISTRO DE VACACIONES */}
      {showVacationModal && (
        <VacationFormModal 
          onClose={() => setShowVacationModal(false)}
          onSuccess={() => setShowVacationModal(false)}
        />
      )}

    </div>
  );
};

export default HRContractsDashboard;
