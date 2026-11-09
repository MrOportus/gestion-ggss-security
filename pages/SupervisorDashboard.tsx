import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import {
  Activity,
  AlertTriangle,
  Building2,
  Calendar,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardCheck,
  Clock,
  ExternalLink,
  Filter,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users,
  UserX,
  XCircle,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { resolveEmployeeOperationalStatus } from '../lib/phase3/contratosService';
import {
  type AlertaOperacionalItem,
  type ClasificacionAlertaOperacional,
  type EstadoFiltroGestion,
  fetchAlertasOperacionalesAdmin,
  fetchAlertasOperacionalesSupervisor,
  isSiteAllowedForSupervisor,
  normalizeSiteId,
  subscribeAlertasOperacionales,
} from '../lib/supervisor/gestionIncidenciaService';
import { GestionSupervisorModal } from '../components/supervisor/GestionSupervisorModal';
import PhotoGalleryModal from '../components/PhotoGalleryModal';
import {
  type NotificacionSupervisor,
  marcarNotificacionLeida,
  resolveOrigenTipo,
  subscribeNotificacionesSupervisor,
} from '../lib/supervisor/notificacionesSupervisorService';
import RouteMapModal from '../components/RouteMapModal';
import NovedadSeguimientoModal from '../components/novedades/NovedadSeguimientoModal';
import { IniciarSeguimientoModal } from '../components/novedades/IniciarSeguimientoModal';
import { esEsquemaNuevo } from '../lib/novedades/seguimientoService';
import { DEFAULT_SITE_HORARIO, type Employee } from '../types';

const PAGE_SIZE = 10;

const getEmployeeFullName = (emp?: Pick<Employee, 'firstName' | 'lastNamePaterno' | 'lastNameMaterno'> | null) => {
  if (!emp) return 'Colaborador';
  return `${emp.firstName || ''} ${emp.lastNamePaterno || ''} ${emp.lastNameMaterno || ''}`.trim() || 'Colaborador';
};

const getLocalDateStr = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

interface LiveGuardInfo {
  id: string;
  name: string;
  rut: string;
  isLive: boolean;
  isManual: boolean;
  checkInISO: string | null;
  checkInFormatted: string;
  scheduledExitFormatted: string;
  shiftName: string;
}

interface SiteOperationalCard {
  siteId: string;
  siteName: string;
  shiftScheduleLabel: string;
  guardsInService: LiveGuardInfo[];
  absencesDetected: LiveGuardInfo[];
  uncoveredShiftsCount: number;
  operationalState: 'operativo' | 'parcial' | 'sin_cobertura' | 'sin_programacion';
}

const SupervisorDashboard: React.FC = () => {
  const { currentUser, employees, sites, attendanceLogs } = useAppStore();

  const isSupervisor = currentUser?.role === 'supervisor';
  const isAdminOrJefe =
    currentUser?.role === 'admin' || currentUser?.role === 'jefe_operaciones';

  // Obtener registro completo del colaborador actual para conocer sus assignedSites actualizados
  const currentEmp = useMemo(() => {
    if (!currentUser) return null;
    return employees.find((e) => e.id === currentUser.uid) || null;
  }, [currentUser, employees]);

  const currentActorName = useMemo(() => {
    if (currentEmp) return getEmployeeFullName(currentEmp);
    return currentUser?.email || 'Supervisor';
  }, [currentEmp, currentUser]);

  const assignedSitesList = useMemo(() => {
    if (isAdminOrJefe) {
      return sites
        .filter((s) => s.active && s.name !== 'Administración')
        .map((s) => s.id);
    }
    return currentEmp?.assignedSites || [];
  }, [isAdminOrJefe, sites, currentEmp]);

  const visibleSites = useMemo(() => {
    return sites.filter((s) => {
      if (!s.active || s.name === 'Administración') return false;
      if (isAdminOrJefe) return true;
      return isSiteAllowedForSupervisor(s.id, assignedSitesList);
    });
  }, [sites, isAdminOrJefe, assignedSitesList]);

  const siteNameLookup = useCallback(
    (siteId: string) => {
      const found = sites.find((s) => normalizeSiteId(s.id) === normalizeSiteId(siteId));
      return found?.name || '';
    },
    [sites],
  );

  // ─── ÁREA A: TURNOS EN VIVO (Reutilizando la lógica de AdminDashboard) ────────
  const todayStr = useMemo(() => getLocalDateStr(), []);
  const [localAttendanceLogs, setLocalAttendanceLogs] = useState<any[]>(attendanceLogs);
  const [programming, setProgramming] = useState<
    {
      employeeId: string;
      siteId: string | number;
      status?: string;
      shiftId?: string;
      horario?: string | { inicio?: string; termino?: string } | null;
      isManualPresent?: boolean;
    }[]
  >([]);

  useEffect(() => {
    //En vista Administrativa (Fiscalización Operacional de Supervisores) no se muestra Turnos en Vivo
    if (isAdminOrJefe) return;

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const qLogs = query(
      collection(db, 'Asistencia'),
      where('timestamp', '>=', twentyFourHoursAgo),
      orderBy('timestamp', 'desc'),
    );

    const unsubLogs = onSnapshot(qLogs, (snapshot) => {
      const logs = snapshot.docs.map((d) => ({ ...d.data(), id: d.id })) as any[];
      logs.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      setLocalAttendanceLogs(logs);
    });

    const qProg = query(collection(db, 'programacion'), where('date', '==', todayStr));
    const qManual = query(
      collection(db, 'asistencia_manual'),
      where('date', '==', todayStr),
    );

    const unsubProg = onSnapshot(qProg, (snapshotProg) => {
      const progs = snapshotProg.docs
        .map((d) => {
          const data = d.data();
          return {
            employeeId: data.employeeId,
            siteId: data.siteId,
            status: data.status,
            shiftId: data.shiftId,
            horario: data.horario || data.turno,
            isManualPresent: false,
          };
        })
        .filter((p) => p.status !== 'descanso');

      setProgramming((current) => {
        const manuals = current.filter((p) => p.isManualPresent);
        return [...manuals, ...progs];
      });
    });

    const unsubManual = onSnapshot(qManual, (snapshotMan) => {
      const manuals = snapshotMan.docs.map((d) => {
        const data = d.data();
        return {
          employeeId: data.employeeId,
          siteId: data.siteId ? String(data.siteId) : 'all',
          status: data.status,
          isManualPresent: data.status === 'presente',
        };
      });

      setProgramming((current) => {
        const progs = current.filter((p) => !p.isManualPresent);
        return [...progs, ...manuals];
      });
    });

    return () => {
      unsubLogs();
      unsubProg();
      unsubManual();
    };
  }, [todayStr]);

  const activeEmployees = useMemo(() => {
    return employees.filter((e) => resolveEmployeeOperationalStatus(e) !== 'inactivo');
  }, [employees]);

  const resolveScheduledExit = useCallback(
    (
      siteObj: (typeof sites)[0],
      checkInISO: string | null,
      _shiftId?: string,
      progHorario?: unknown,
      progStatus?: string,
      logTermino?: string,
    ): { exitTime: string; shiftLabel: string } => {
      if (typeof logTermino === 'string' && logTermino.trim()) {
        return { exitTime: logTermino.trim(), shiftLabel: `Salida prog. ${logTermino.trim()}` };
      }

      if (typeof progHorario === 'string' && progHorario.includes('-')) {
        const parts = progHorario.split('-').map((s) => s.trim());
        if (parts[1]) {
          return { exitTime: parts[1], shiftLabel: progHorario };
        }
      }

      if (progHorario && typeof progHorario === 'object') {
        const hObj = progHorario as { inicio?: unknown; termino?: unknown };
        const hIni = typeof hObj.inicio === 'string' ? hObj.inicio.trim() : '';
        const hTerm = typeof hObj.termino === 'string' ? hObj.termino.trim() : '';
        if (hIni && hTerm) {
          if (progStatus === 'noche') {
            return {
              exitTime: hIni,
              shiftLabel: `Turno Noche (${hTerm} - ${hIni})`,
            };
          }
          return {
            exitTime: hTerm,
            shiftLabel: `Turno (${hIni} - ${hTerm})`,
          };
        }
      }

      const rawSiteHorario = siteObj?.horario as any;
      const inicioDia =
        typeof rawSiteHorario?.inicio === 'string' && rawSiteHorario.inicio.trim()
          ? rawSiteHorario.inicio.trim()
          : DEFAULT_SITE_HORARIO.inicio;
      const terminoDia =
        typeof rawSiteHorario?.termino === 'string' && rawSiteHorario.termino.trim()
          ? rawSiteHorario.termino.trim()
          : DEFAULT_SITE_HORARIO.termino;

      if (progStatus === 'noche') {
        return {
          exitTime: inicioDia,
          shiftLabel: `Turno Noche (${terminoDia} - ${inicioDia})`,
        };
      }

      if (checkInISO) {
        const checkInDate = new Date(checkInISO);
        const checkInHour = checkInDate.getHours();
        const isNight = checkInHour >= 17 || checkInHour < 5;
        if (isNight) {
          return {
            exitTime: inicioDia,
            shiftLabel: `Turno Noche (${terminoDia} - ${inicioDia})`,
          };
        }
      }

      return {
        exitTime: terminoDia,
        shiftLabel: `Turno Día (${inicioDia} - ${terminoDia})`,
      };
    },
    [],
  );

  const siteOperationalCards: SiteOperationalCard[] = useMemo(() => {
    // 1. Identificar todos los empleados actualmente "En Turno" (último log check_in no completado)
    const liveByEmpId = new Map<
      string,
      {
        siteId: string;
        siteName: string;
        timestamp: string;
        isManual: boolean;
        shiftId?: string;
        turnoProgramadoTermino?: string;
      }
    >();

    activeEmployees.forEach((emp) => {
      const empLogs = localAttendanceLogs.filter((l) => l.employeeId === emp.id);
      if (empLogs.length === 0) return;
      const sorted = [...empLogs].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      const last = sorted[0];
      if (last.type === 'check_in' && last.status !== 'completed') {
        liveByEmpId.set(emp.id, {
          siteId: normalizeSiteId(last.siteId),
          siteName: last.siteName || '',
          timestamp: last.timestamp,
          isManual: Boolean(last.isManual),
          shiftId: last.shiftId,
          turnoProgramadoTermino: last.turnoProgramadoTermino,
        });
      }
    });

    return visibleSites.map((site) => {
      const siteIdStr = normalizeSiteId(site.id);

      const siteProgs = programming.filter(
        (p) => normalizeSiteId(p.siteId) === siteIdStr,
      );
      const programmedEmpIds = new Set(siteProgs.map((p) => p.employeeId));

      const liveHereEmpIds = new Set<string>();
      liveByEmpId.forEach((info, empId) => {
        if (info.siteId === siteIdStr || (info.siteName && info.siteName === site.name)) {
          liveHereEmpIds.add(empId);
        }
      });

      const allRelevantIds = new Set([...programmedEmpIds, ...liveHereEmpIds]);
      const guardsInService: LiveGuardInfo[] = [];
      const absencesDetected: LiveGuardInfo[] = [];

      allRelevantIds.forEach((empId) => {
        const emp = activeEmployees.find((e) => e.id === empId);
        if (!emp) return;

        const liveInfo = liveByEmpId.get(empId);
        const progInfo = siteProgs.find((p) => p.employeeId === empId);
        const isLiveHere =
          Boolean(liveInfo) &&
          (liveInfo?.siteId === siteIdStr || liveInfo?.siteName === site.name);
        const isManualPresent = Boolean(progInfo?.isManualPresent);

        const inService = isLiveHere || isManualPresent;
        const checkInISO = liveInfo?.timestamp || null;
        const checkInFormatted = checkInISO
          ? new Date(checkInISO).toLocaleTimeString('es-CL', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : isManualPresent
          ? 'Asist. Manual'
          : 'Sin marcaje';

        const { exitTime, shiftLabel } = resolveScheduledExit(
          site,
          checkInISO,
          liveInfo?.shiftId || progInfo?.shiftId,
          progInfo?.horario,
          progInfo?.status,
          liveInfo?.turnoProgramadoTermino,
        );

        const guardEntry: LiveGuardInfo = {
          id: emp.id,
          name: getEmployeeFullName(emp),
          rut: emp.rut,
          isLive: inService,
          isManual: isManualPresent || Boolean(liveInfo?.isManual),
          checkInISO,
          checkInFormatted,
          scheduledExitFormatted: exitTime,
          shiftName: shiftLabel,
        };

        if (inService) {
          guardsInService.push(guardEntry);
        } else {
          absencesDetected.push(guardEntry);
        }
      });

      const uncoveredShiftsCount = absencesDetected.length;
      let operationalState: SiteOperationalCard['operationalState'] = 'operativo';

      if (guardsInService.length === 0 && absencesDetected.length > 0) {
        operationalState = 'sin_cobertura';
      } else if (guardsInService.length > 0 && absencesDetected.length > 0) {
        operationalState = 'parcial';
      } else if (guardsInService.length === 0 && absencesDetected.length === 0) {
        operationalState = 'sin_programacion';
      }

      const rawHorario = site.horario as any;
      const shiftScheduleLabel =
        typeof rawHorario === 'string' && rawHorario.trim()
          ? rawHorario.trim()
          : `${rawHorario?.inicio || DEFAULT_SITE_HORARIO.inicio} a ${
              rawHorario?.termino || DEFAULT_SITE_HORARIO.termino
            }`;

      return {
        siteId: siteIdStr,
        siteName: site.name,
        shiftScheduleLabel,
        guardsInService,
        absencesDetected,
        uncoveredShiftsCount,
        operationalState,
      };
    });
  }, [visibleSites, activeEmployees, localAttendanceLogs, programming, resolveScheduledExit]);

  // ─── ÁREA B: ALERTAS OPERACIONALES Y FISCALIZACIÓN ────────────────────────────
  const [alertas, setAlertas] = useState<AlertaOperacionalItem[]>([]);
  const [loadingAlertas, setLoadingAlertas] = useState(false);

  // Filtros
  const [siteFilter, setSiteFilter] = useState<string>('all');
  const [clasificacionFilter, setClasificacionFilter] = useState<
    'all' | ClasificacionAlertaOperacional
  >('all');
  const [estadoGestionFilter, setEstadoGestionFilter] =
    useState<EstadoFiltroGestion>('todos');
  const [supervisorFilter, setSupervisorFilter] = useState<string>('all');
  const [onlyJefaturaFilter, setOnlyJefaturaFilter] = useState<boolean>(false);
  const [startDateFilter, setStartDateFilter] = useState<string>('');
  const [endDateFilter, setEndDateFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [page, setPage] = useState<number>(1);

  // Colapso/expansión de Área A: Turnos en Vivo (persiste preferencia local para mayor espacio)
  const [isTurnosCollapsed, setIsTurnosCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('aspro_supervisor_turnos_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleTurnosCollapsed = useCallback(() => {
    setIsTurnosCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('aspro_supervisor_turnos_collapsed', String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Modales de Gestión y Acceso al Registro Original
  const [selectedAlertaForGestion, setSelectedAlertaForGestion] =
    useState<AlertaOperacionalItem | null>(null);
  const [selectedOriginalRound, setSelectedOriginalRound] = useState<any | null>(null);
  const [selectedOriginalNovedad, setSelectedOriginalNovedad] = useState<any | null>(null);
  const [novedadToInit, setNovedadToInit] = useState<any | null>(null);
  const [galleryState, setGalleryState] = useState<{
    photos: string[];
    index: number;
    title?: string;
  } | null>(null);

  const setLightboxPhoto = (url: string | null) => {
    if (url) {
      setGalleryState({ photos: [url], index: 0 });
    } else {
      setGalleryState(null);
    }
  };

  const cargarAlertas = useCallback(async () => {
    if (!currentUser) return;
    setLoadingAlertas(true);
    try {
      if (isAdminOrJefe) {
        const items = await fetchAlertasOperacionalesAdmin(siteNameLookup);
        setAlertas(items);
      } else {
        const items = await fetchAlertasOperacionalesSupervisor(
          assignedSitesList,
          siteNameLookup,
        );
        setAlertas(items);
      }
    } catch (err) {
      console.error('[SupervisorDashboard] Error cargando alertas operacionales:', err);
    } finally {
      setLoadingAlertas(false);
    }
  }, [currentUser, isAdminOrJefe, assignedSitesList, siteNameLookup]);

  // TIEMPO REAL: las alertas, gestiones y consultas de Jefatura se reflejan al instante
  // (sin recargar) mediante listeners de Firestore acotados a las instalaciones visibles.
  const assignedSitesKey = JSON.stringify(assignedSitesList.map(String).sort());
  useEffect(() => {
    if (!currentUser) return;
    if (!isAdminOrJefe && assignedSitesList.length === 0) {
      setAlertas([]);
      return;
    }
    setLoadingAlertas(true);
    const unsubscribe = subscribeAlertasOperacionales({
      modo: isAdminOrJefe ? 'admin' : 'supervisor',
      assignedSites: assignedSitesList,
      siteNameLookup,
      onData: (items) => {
        setAlertas(items);
        setLoadingAlertas(false);
      },
      onError: (err) => {
        console.error('[SupervisorDashboard] Error en alertas en tiempo real:', err);
        setLoadingAlertas(false);
      },
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, isAdminOrJefe, assignedSitesKey, siteNameLookup]);

  // Alerta abierta en el modal, siempre sincronizada con la última versión en vivo
  const liveSelectedAlerta = useMemo(() => {
    if (!selectedAlertaForGestion) return null;
    return (
      alertas.find((a) => a.uidKey === selectedAlertaForGestion.uidKey) ||
      selectedAlertaForGestion
    );
  }, [alertas, selectedAlertaForGestion]);

  // Mensajes sin leer por registro ("Registro con nuevo mensaje"), en tiempo real
  const [unreadNotifs, setUnreadNotifs] = useState<NotificacionSupervisor[]>([]);
  useEffect(() => {
    if (!currentUser?.uid) return;
    return subscribeNotificacionesSupervisor(
      {
        uid: currentUser.uid,
        role: currentUser.role,
        assignedSites: assignedSitesList,
        siteNameLookup,
      },
      (all) => setUnreadNotifs(all.filter((n) => !n.leida)),
      () => setUnreadNotifs([]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, currentUser?.role, assignedSitesKey, siteNameLookup]);

  const unreadByAlerta = useMemo(() => {
    const map = new Map<string, number>();
    unreadNotifs.forEach((n) => {
      if (!n.origenTipo || !n.origenId) return;
      const key = `${n.origenTipo}_${n.origenId}`;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [unreadNotifs]);

  // Al abrir un registro, sus mensajes pendientes pasan a leídos inmediatamente
  const openedKey = selectedAlertaForGestion?.uidKey;
  useEffect(() => {
    if (!openedKey || !currentUser?.uid) return;
    unreadNotifs
      .filter((n) => `${resolveOrigenTipo(n)}_${n.origenId}` === openedKey)
      .forEach((n) => void marcarNotificacionLeida(n.id, currentUser.uid));
  }, [openedKey, unreadNotifs, currentUser?.uid]);

  // Apertura directa desde el Centro de Notificaciones (evento o clave pendiente)
  useEffect(() => {
    const tryOpenPending = () => {
      const pending = sessionStorage.getItem('aspro_open_alerta');
      if (!pending) return;
      const found = alertas.find((a) => a.uidKey === pending);
      if (found) {
        sessionStorage.removeItem('aspro_open_alerta');
        setSelectedAlertaForGestion(found);
      }
    };
    tryOpenPending();
    window.addEventListener('aspro:abrir-alerta', tryOpenPending);
    return () => window.removeEventListener('aspro:abrir-alerta', tryOpenPending);
  }, [alertas]);

  // Supervisores disponibles para el filtro de Administración
  const supervisorsForFilter = useMemo(() => {
    const map = new Map<string, string>();
    employees
      .filter((e) => e.role === 'supervisor')
      .forEach((e) => map.set(e.id, getEmployeeFullName(e)));
    alertas.forEach((a) => {
      if (a.gestionSupervisor?.supervisorUid) {
        map.set(
          a.gestionSupervisor.supervisorUid,
          a.gestionSupervisor.supervisorNombre || 'Supervisor',
        );
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [employees, alertas]);

  // Filtrado combinado
  const filteredAlertas = useMemo(() => {
    return alertas.filter((item) => {
      // Seguridad adicional en cliente para supervisor
      if (isSupervisor && !isSiteAllowedForSupervisor(item.siteId, assignedSitesList)) {
        return false;
      }

      if (siteFilter !== 'all' && normalizeSiteId(item.siteId) !== normalizeSiteId(siteFilter)) {
        return false;
      }

      if (clasificacionFilter !== 'all' && item.clasificacion !== clasificacionFilter) {
        return false;
      }

      const tieneGestionSup = Boolean(
        item.gestionSupervisor && item.gestionSupervisor.tipoRegistro !== 'consulta_admin',
      );
      const estSolucion = tieneGestionSup
        ? item.gestionSupervisor!.fueSolucionado
        : 'sin_gestion';
      if (estadoGestionFilter !== 'todos' && estSolucion !== estadoGestionFilter) {
        return false;
      }

      const supUid =
        item.gestionSupervisor?.ultimoSupervisorUid || item.gestionSupervisor?.supervisorUid;
      if (
        isAdminOrJefe &&
        supervisorFilter !== 'all' &&
        (!tieneGestionSup || supUid !== supervisorFilter)
      ) {
        return false;
      }

      if (
        onlyJefaturaFilter &&
        !item.gestionSupervisor?.requiereIntervencionJefatura
      ) {
        return false;
      }

      if (startDateFilter || endDateFilter) {
        const itemDateStr = item.fechaHoraISO ? item.fechaHoraISO.substring(0, 10) : '';
        if (startDateFilter && (!itemDateStr || itemDateStr < startDateFilter)) {
          return false;
        }
        if (endDateFilter && (!itemDateStr || itemDateStr > endDateFilter)) {
          return false;
        }
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchText =
          item.descripcion.toLowerCase().includes(q) ||
          item.trabajadorNombre.toLowerCase().includes(q) ||
          item.siteName.toLowerCase().includes(q) ||
          (item.gestionSupervisor?.supervisorNombre || '').toLowerCase().includes(q) ||
          (item.gestionSupervisor?.medidasTomadas || '').toLowerCase().includes(q);
        if (!matchText) return false;
      }

      return true;
    });
  }, [
    alertas,
    isSupervisor,
    assignedSitesList,
    siteFilter,
    clasificacionFilter,
    estadoGestionFilter,
    isAdminOrJefe,
    supervisorFilter,
    onlyJefaturaFilter,
    startDateFilter,
    endDateFilter,
    searchQuery,
  ]);

  useEffect(() => {
    setPage(1);
  }, [
    siteFilter,
    clasificacionFilter,
    estadoGestionFilter,
    supervisorFilter,
    onlyJefaturaFilter,
    startDateFilter,
    endDateFilter,
    searchQuery,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredAlertas.length / PAGE_SIZE));
  const paginatedAlertas = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredAlertas.slice(start, start + PAGE_SIZE);
  }, [filteredAlertas, page]);

  // KPIs rápidos
  const stats = useMemo(() => {
    const totalGuardiasEnServicio = siteOperationalCards.reduce(
      (acc, c) => acc + c.guardsInService.length,
      0,
    );
    const totalAusencias = siteOperationalCards.reduce(
      (acc, c) => acc + c.absencesDetected.length,
      0,
    );
    const sinGestion = alertas.filter(
      (a) => !a.gestionSupervisor || a.gestionSupervisor.tipoRegistro === 'consulta_admin',
    ).length;
    const pendientesDecision = alertas.filter(
      (a) =>
        a.gestionSupervisor &&
        a.gestionSupervisor.tipoRegistro !== 'consulta_admin' &&
        a.gestionSupervisor.fueSolucionado === 'pendiente',
    ).length;
    const escaladasJefatura = alertas.filter(
      (a) => a.gestionSupervisor?.requiereIntervencionJefatura,
    ).length;

    return {
      totalGuardiasEnServicio,
      totalAusencias,
      sinGestion,
      pendientesDecision,
      escaladasJefatura,
    };
  }, [siteOperationalCards, alertas]);

  // Resumen compacto para cuando el Área A de Turnos en Vivo esté colapsada
  const turnosSummary = useMemo(() => {
    let operativos = 0;
    let parciales = 0;
    let sinCobertura = 0;
    let sinProg = 0;

    siteOperationalCards.forEach((c) => {
      if (c.operationalState === 'operativo') operativos++;
      else if (c.operationalState === 'parcial') parciales++;
      else if (c.operationalState === 'sin_cobertura') sinCobertura++;
      else sinProg++;
    });

    return {
      operativos,
      parciales,
      sinCobertura,
      sinProg,
      totalSites: siteOperationalCards.length,
    };
  }, [siteOperationalCards]);

  const handleOpenOriginalRecord = (item: AlertaOperacionalItem) => {
    if (item.origenTipo === 'ronda' && item.originalRound) {
      setSelectedOriginalRound(item.originalRound);
      return;
    }
    if (item.origenTipo === 'novedad' && item.originalNovedad) {
      const nov: any = item.originalNovedad;
      // Inyectar fotosUrls normalizadas para que cualquier modal tenga la lista completa de evidencias
      const mergedNov = {
        ...nov,
        fotosUrls: item.fotosUrls,
        evidencias:
          Array.isArray(nov.evidencias) && nov.evidencias.length > 0
            ? nov.evidencias
            : item.fotosUrls,
        fotos:
          Array.isArray(nov.fotos) && nov.fotos.length > 0
            ? nov.fotos
            : item.fotosUrls,
      };
      if (esEsquemaNuevo(nov)) {
        if (
          nov.requiereSeguimiento ||
          (nov.cantidadSeguimientos && nov.cantidadSeguimientos > 0) ||
          nov.estado === 'en_revision' ||
          nov.estado === 'resuelta'
        ) {
          setSelectedOriginalNovedad(mergedNov);
        } else {
          setNovedadToInit(mergedNov);
        }
      } else if (item.fotosUrls.length > 0) {
        setLightboxPhoto(item.fotosUrls[0]);
      } else {
        setSelectedAlertaForGestion(item);
      }
    }
  };

  const renderClasificacionBadge = (clasificacion: ClasificacionAlertaOperacional) => {
    switch (clasificacion) {
      case 'ronda_sospecha':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-300">
            🚨 Ronda con Sospecha
          </span>
        );
      case 'ronda_novedad':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase bg-rose-100 text-rose-800 border border-rose-200">
            🛰️ Ronda con Novedad
          </span>
        );
      case 'novedad_critica':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase bg-red-600 text-white shadow-sm">
            🆘 Novedad Crítica
          </span>
        );
      case 'novedad_alta':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase bg-orange-100 text-orange-800 border border-orange-200">
            ⚠️ Prioridad Alta
          </span>
        );
    }
  };

  const renderEstadoGestionBadge = (item: AlertaOperacionalItem) => {
    const g = item.gestionSupervisor;
    const tieneGestionSup = Boolean(g && g.tipoRegistro !== 'consulta_admin');
    const supNombre = g?.ultimoSupervisorNombre || g?.supervisorNombre || 'Supervisor';

    if (!tieneGestionSup) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase bg-slate-100 text-slate-600 border border-slate-200">
          Sin Gestión Supervisor
        </span>
      );
    }
    if (g!.fueSolucionado === 'si') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">
          <CheckCircle2 className="w-3 h-3" /> Solucionado ({supNombre})
        </span>
      );
    }
    if (g!.fueSolucionado === 'no') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase bg-red-100 text-red-800 border border-red-200">
          <XCircle className="w-3 h-3" /> No Solucionado
          {g!.requiereIntervencionJefatura ? ' • Escalar Jefatura' : ''}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-200">
        <Clock className="w-3 h-3" /> Pendiente de Gestión
      </span>
    );
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Cabecera Compacta */}
      <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-indigo-100 text-indigo-700">
              {isAdminOrJefe ? 'Vista Global de Actividad' : 'Panel Operacional en Vivo'}
            </span>
            <span className="text-[11px] font-bold text-slate-400">
              {visibleSites.length}{' '}
              {visibleSites.length === 1 ? 'instalación asignada' : 'instalaciones asignadas'}
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-1">
            {isAdminOrJefe
              ? 'Actividad de Supervisores'
              : 'Dashboard Operacional del Supervisor'}
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Monitoreo en tiempo real de turnos activos y gestión auditable de rondas y novedades críticas.
          </p>
        </div>

        <button
          type="button"
          onClick={cargarAlertas}
          disabled={loadingAlertas}
          className="self-start sm:self-auto inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-wider shadow-sm transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loadingAlertas ? 'animate-spin' : ''}`} />
          Actualizar Alertas
        </button>
      </div>

      {/* Tarjetas Resumen Compactas */}
      <div
        className={`grid grid-cols-2 ${
          isAdminOrJefe ? 'lg:grid-cols-3' : 'lg:grid-cols-4'
        } gap-3`}
      >
        {!isAdminOrJefe && (
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm">
            <div className="flex items-center justify-between text-emerald-600 mb-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                En Servicio Hoy
              </span>
              <UserCheck className="w-4 h-4" />
            </div>
            <p className="text-2xl font-black text-slate-900">
              {stats.totalGuardiasEnServicio}
            </p>
            <span className="text-[10px] font-bold text-emerald-600">
              Guardias activos
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setPage(1);
            setEstadoGestionFilter((curr) =>
              curr === 'sin_gestion' ? 'todos' : 'sin_gestion',
            );
            setOnlyJefaturaFilter(false);
          }}
          className={`text-left p-3.5 rounded-2xl border transition-all cursor-pointer ${
            estadoGestionFilter === 'sin_gestion'
              ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-400/50 shadow-md'
              : 'bg-white border-slate-200/80 hover:border-amber-200 shadow-sm'
          }`}
          title="Clic para filtrar alertas sin gestión"
        >
          <div className="flex items-center justify-between text-amber-600 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Alertas Sin Gestión
            </span>
            <AlertTriangle className="w-4 h-4" />
          </div>
          <p className="text-2xl font-black text-slate-900">{stats.sinGestion}</p>
          <span className="text-[10px] font-bold text-amber-600">
            {estadoGestionFilter === 'sin_gestion' ? 'Filtro activo (clic para quitar)' : 'Requieren revisión'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setPage(1);
            setEstadoGestionFilter((curr) =>
              curr === 'pendiente' ? 'todos' : 'pendiente',
            );
            setOnlyJefaturaFilter(false);
          }}
          className={`text-left p-3.5 rounded-2xl border transition-all cursor-pointer ${
            estadoGestionFilter === 'pendiente'
              ? 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-400/50 shadow-md'
              : 'bg-white border-slate-200/80 hover:border-indigo-200 shadow-sm'
          }`}
          title="Clic para filtrar alertas pendientes de gestión"
        >
          <div className="flex items-center justify-between text-indigo-600 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Pendiente de Gestión
            </span>
            <Clock className="w-4 h-4" />
          </div>
          <p className="text-2xl font-black text-slate-900">{stats.pendientesDecision}</p>
          <span className="text-[10px] font-bold text-indigo-600">
            {estadoGestionFilter === 'pendiente' ? 'Filtro activo (clic para quitar)' : 'En seguimiento'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setPage(1);
            setOnlyJefaturaFilter((v) => !v);
            setEstadoGestionFilter('todos');
          }}
          className={`text-left p-3.5 rounded-2xl border transition-all cursor-pointer ${
            onlyJefaturaFilter
              ? 'bg-red-50 border-red-300 ring-2 ring-red-400/50 shadow-md'
              : 'bg-white border-red-200/80 hover:border-red-300 shadow-sm'
          }`}
          title="Clic para filtrar alertas escaladas a jefatura"
        >
          <div className="flex items-center justify-between text-red-600 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-red-500">
              Intervención Jefatura
            </span>
            <ShieldAlert className="w-4 h-4" />
          </div>
          <p className="text-2xl font-black text-red-700">{stats.escaladasJefatura}</p>
          <span className="text-[10px] font-bold text-red-600">
            {onlyJefaturaFilter ? 'Filtro activo (clic para quitar)' : 'Escaladas a Operaciones'}
          </span>
        </button>
      </div>

      {/* ─── ÁREA A: TURNOS EN VIVO (Solo vista Supervisor) ────────────────────── */}
      {!isAdminOrJefe && (
        <section className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden transition-all">
          {/* Cabecera Clickeable para Colapsar/Expandir la Sección */}
          <div
            role="button"
            tabIndex={0}
            onClick={toggleTurnosCollapsed}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleTurnosCollapsed();
              }
            }}
            className="w-full px-4 sm:px-6 py-4 bg-slate-900 hover:bg-slate-800 text-white flex flex-wrap items-center justify-between gap-3 text-left transition-colors cursor-pointer select-none group"
            aria-expanded={!isTurnosCollapsed}
            title={
              isTurnosCollapsed
                ? 'Clic para expandir detalle completo de turnos'
                : 'Clic para minimizar y resumir sección'
            }
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm sm:text-base font-black uppercase tracking-wider">
                    A. Turnos en Vivo por Instalación
                  </h2>
                  {isTurnosCollapsed && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                      Resumido ({visibleSites.length} inst.)
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 truncate">
                  Sincronizado en tiempo real con Asistencia y Programación de Turnos ({todayStr})
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Badges rápidos en cabecera */}
              <div className="hidden sm:flex items-center gap-1.5 text-xs font-bold text-slate-300">
                <span className="px-2.5 py-1 rounded-lg bg-slate-800/90 border border-slate-700/80 text-[11px] flex items-center gap-1">
                  <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                  {stats.totalGuardiasEnServicio} activos
                </span>
                {stats.totalAusencias > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[11px] flex items-center gap-1">
                    <UserX className="w-3.5 h-3.5 text-rose-400" />
                    {stats.totalAusencias} sin ingreso
                  </span>
                )}
              </div>

              {/* Botón visual de acción */}
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 group-hover:bg-slate-700 border border-slate-700 text-xs font-black uppercase tracking-wider text-slate-200 transition-colors shadow-xs">
                {isTurnosCollapsed ? (
                  <>
                    <span>Expandir</span>
                    <ChevronDown className="w-4 h-4 text-emerald-400" />
                  </>
                ) : (
                  <>
                    <span>Minimizar</span>
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  </>
                )}
              </span>
            </div>
          </div>

          {/* CUERPO: Modo Resumido o Modo Detallado */}
          {isTurnosCollapsed ? (
            /* Vista Minimizada / Resumida para dar espacio a las siguientes secciones */
            <div
              onClick={toggleTurnosCollapsed}
              className="p-3.5 sm:p-4 bg-slate-50/90 hover:bg-slate-100/90 cursor-pointer border-t border-slate-200/80 transition-colors flex flex-wrap items-center justify-between gap-3 text-xs"
              title="Clic para expandir detalle completo de instalaciones"
            >
              <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white border border-slate-200 shadow-xs font-bold text-slate-700">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  <span>{visibleSites.length} instalaciones</span>
                </div>

                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>{turnosSummary.operativos} operativas</span>
                </div>

                {turnosSummary.parciales > 0 && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 font-bold">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    <span>{turnosSummary.parciales} cobertura parcial</span>
                  </div>
                )}

                {turnosSummary.sinCobertura > 0 && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-bold animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                    <span>{turnosSummary.sinCobertura} sin cobertura</span>
                  </div>
                )}

                {turnosSummary.sinProg > 0 && (
                  <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 font-medium">
                    <span>{turnosSummary.sinProg} sin turno programado</span>
                  </div>
                )}

                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 font-bold">
                  <UserCheck className="w-3.5 h-3.5 text-blue-600" />
                  <span>{stats.totalGuardiasEnServicio} guardias en servicio</span>
                </div>

                {stats.totalAusencias > 0 && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-bold">
                    <UserX className="w-3.5 h-3.5 text-rose-600" />
                    <span>{stats.totalAusencias} ausencias hoy</span>
                  </div>
                )}
              </div>

              <div className="text-[11px] font-bold text-slate-400 group-hover:text-slate-600 flex items-center gap-1 ml-auto shrink-0">
                <span>Ver detalle completo</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </div>
            </div>
          ) : (
            /* Vista Completa de Tarjetas */
            <div className="p-4 sm:p-6">
              {visibleSites.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <Building2 className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm font-black text-slate-700">
                    No tiene instalaciones asignadas actualmente
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Solicite al Administrador la asignación de sucursales en Gestión de Supervisores.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {siteOperationalCards.map((card) => {
                    const stateBadge =
                      card.operationalState === 'operativo' ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">
                          Operativo ({card.guardsInService.length})
                        </span>
                      ) : card.operationalState === 'parcial' ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-200">
                          Cobertura Parcial ({card.guardsInService.length}/
                          {card.guardsInService.length + card.uncoveredShiftsCount})
                        </span>
                      ) : card.operationalState === 'sin_cobertura' ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-red-100 text-red-800 border border-red-200 animate-pulse">
                          Sin Cobertura ({card.uncoveredShiftsCount} ausencias)
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-slate-100 text-slate-600 border border-slate-200">
                          Sin Turno Programado
                        </span>
                      );

                    return (
                      <div
                        key={card.siteId}
                        className={`rounded-2xl border p-4 flex flex-col justify-between transition-all ${
                          card.operationalState === 'sin_cobertura'
                            ? 'bg-red-50/40 border-red-200'
                            : card.operationalState === 'parcial'
                            ? 'bg-amber-50/30 border-amber-200'
                            : 'bg-slate-50/60 border-slate-200/80'
                        }`}
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="text-sm font-black text-slate-900 truncate flex items-center gap-1.5">
                                <MapPin className="w-4 h-4 text-blue-600 shrink-0" />
                                {card.siteName}
                              </h3>
                              <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                                Turnos instalación: {card.shiftScheduleLabel}
                              </p>
                            </div>
                            {stateBadge}
                          </div>

                          {/* Guardias en servicio */}
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                              Guardias en servicio ({card.guardsInService.length})
                            </p>
                            {card.guardsInService.length === 0 ? (
                              <div className="text-xs text-slate-400 italic bg-white/80 rounded-xl px-3 py-2 border border-slate-200/60">
                                Ningún guardia activo en este momento.
                              </div>
                            ) : (
                              card.guardsInService.map((g) => (
                                <div
                                  key={g.id}
                                  className="bg-white rounded-xl p-2.5 border border-emerald-200/80 flex items-center justify-between gap-2 shadow-xs"
                                >
                                  <div className="min-w-0">
                                    <p className="text-xs font-black text-slate-800 truncate flex items-center gap-1.5">
                                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                      {g.name}
                                    </p>
                                    <p className="text-[10px] text-slate-500 font-medium truncate">
                                      {g.shiftName}
                                    </p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <span className="block text-[10px] font-black text-emerald-700">
                                      Ingreso: {g.checkInFormatted}
                                    </span>
                                    <span className="block text-[10px] font-bold text-slate-500">
                                      Salida prog.: {g.scheduledExitFormatted}
                                    </span>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>

                          {/* Ausencias detectadas / Turnos sin cobertura */}
                          {card.absencesDetected.length > 0 && (
                            <div className="space-y-1.5 pt-1">
                              <p className="text-[10px] font-black uppercase tracking-wider text-rose-600">
                                Ausencias / Sin marcaje ({card.absencesDetected.length})
                              </p>
                              {card.absencesDetected.map((abs) => (
                                <div
                                  key={abs.id}
                                  className="bg-white rounded-xl p-2 border border-rose-200 flex items-center justify-between gap-2"
                                >
                                  <span className="text-xs font-bold text-slate-700 truncate">
                                    {abs.name}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-rose-100 text-rose-700 shrink-0">
                                    Sin ingreso
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ─── ÁREA B: BANDEJA CONSOLIDADA DE ALERTAS OPERACIONALES ─────────────── */}
      <section className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-rose-600" />
              {isAdminOrJefe
                ? 'Alertas Operacionales y Actividad de Supervisores'
                : 'B. Alertas Operacionales y Gestión del Supervisor'}
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              Rondas con novedad, rondas con sospecha, novedades críticas y de prioridad alta ({filteredAlertas.length} registros)
            </p>
          </div>

          <button
            type="button"
            onClick={() => setOnlyJefaturaFilter((v) => !v)}
            className={`px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider border flex items-center gap-1.5 transition-all ${
              onlyJefaturaFilter
                ? 'bg-red-600 text-white border-red-600 shadow-sm'
                : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Requiere Jefatura ({stats.escaladasJefatura})
          </button>
        </div>

        {/* Barra de Filtros */}
        <div className="p-4 sm:px-6 bg-slate-50 border-b border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
          {/* Buscador */}
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por trabajador, descripción, medida..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Instalación */}
          <select
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Todas las instalaciones ({visibleSites.length})</option>
            {visibleSites.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Clasificación / Criticidad */}
          <select
            value={clasificacionFilter}
            onChange={(e) => setClasificacionFilter(e.target.value as any)}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Todas las clasificaciones</option>
            <option value="ronda_novedad">1. Rondas con novedad</option>
            <option value="ronda_sospecha">2. Rondas con sospecha</option>
            <option value="novedad_critica">3. Novedades críticas</option>
            <option value="novedad_alta">4. Novedades prioridad alta</option>
          </select>

          {/* Estado de Gestión / Solución */}
          <select
            value={estadoGestionFilter}
            onChange={(e) => setEstadoGestionFilter(e.target.value as EstadoFiltroGestion)}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="todos">Estado gestión: Todos</option>
            <option value="sin_gestion">Sin gestión registrada</option>
            <option value="pendiente">Pendiente de gestión</option>
            <option value="no">No solucionado</option>
            <option value="si">Solucionado</option>
          </select>

          {/* Filtro por Supervisor (Exclusivo Vista Administrativa) o Fecha */}
          {isAdminOrJefe ? (
            <select
              value={supervisorFilter}
              onChange={(e) => setSupervisorFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Todos los supervisores</option>
              {supervisorsForFilter.map((sup) => (
                <option key={sup.id} value={sup.id}>
                  {sup.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="date"
              value={startDateFilter}
              onChange={(e) => setStartDateFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              title="Filtrar desde fecha"
            />
          )}
        </div>

        {/* Rango de fechas adicional para Admin */}
        {isAdminOrJefe && (
          <div className="px-4 sm:px-6 py-2.5 bg-slate-50/60 border-b border-slate-200/70 flex flex-wrap items-center gap-3 text-xs">
            <span className="font-black text-slate-500 uppercase text-[10px]">
              Rango de fecha incidente:
            </span>
            <input
              type="date"
              value={startDateFilter}
              onChange={(e) => setStartDateFilter(e.target.value)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700"
            />
            <span className="text-slate-400">a</span>
            <input
              type="date"
              value={endDateFilter}
              onChange={(e) => setEndDateFilter(e.target.value)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700"
            />
            {(startDateFilter || endDateFilter) && (
              <button
                type="button"
                onClick={() => {
                  setStartDateFilter('');
                  setEndDateFilter('');
                }}
                className="text-[11px] font-black text-blue-600 hover:underline"
              >
                Limpiar fechas
              </button>
            )}
          </div>
        )}

        {/* Listado Paginado de Alertas */}
        <div className="p-4 sm:p-6 space-y-3">
          {loadingAlertas ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400">
              <Loader2 className="w-7 h-7 animate-spin text-blue-600" />
              <span className="text-xs font-bold">Consultando alertas operacionales...</span>
            </div>
          ) : paginatedAlertas.length === 0 ? (
            <div className="py-12 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-black text-slate-700">
                No se encontraron alertas operacionales con los filtros seleccionados
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Las rondas con novedad/sospecha y novedades críticas o altas aparecerán aquí automáticamente.
              </p>
            </div>
          ) : (
            paginatedAlertas.map((item) => {
              const g = item.gestionSupervisor;
              const tieneGestionSupervisor = Boolean(
                g && g.tipoRegistro !== 'consulta_admin',
              );
              const fechaSupISO =
                g?.fechaUltimaGestionSupervisorISO || g?.fechaGestionISO;
              return (
                <div
                  key={item.uidKey}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedAlertaForGestion(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target === e.currentTarget) {
                      setSelectedAlertaForGestion(item);
                    }
                  }}
                  className={`rounded-2xl border bg-white hover:border-indigo-300 hover:shadow-md p-4 transition-all shadow-xs space-y-3 cursor-pointer ${
                    (unreadByAlerta.get(item.uidKey) || 0) > 0
                      ? 'border-indigo-400 ring-2 ring-indigo-200/80'
                      : g?.consultaAdmin?.pendienteRespuesta && isSupervisor
                      ? 'border-amber-300 ring-1 ring-amber-200'
                      : 'border-slate-200/90'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {renderClasificacionBadge(item.clasificacion)}
                      {renderEstadoGestionBadge(item)}
                      {(unreadByAlerta.get(item.uidKey) || 0) > 0 && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase bg-red-600 text-white animate-pulse shadow-sm">
                          {isAdminOrJefe
                            ? `💬 Registro con nuevo mensaje (${unreadByAlerta.get(item.uidKey)})`
                            : `💬 Nuevo mensaje por revisar (${unreadByAlerta.get(item.uidKey)})`}
                        </span>
                      )}
                      {g?.consultaAdmin?.pendienteRespuesta && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase bg-indigo-100 text-indigo-800 border border-indigo-200">
                          📣 Consulta Jefatura Pendiente
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-slate-100 text-slate-500">
                        Estado Original: {item.estadoOriginal}
                      </span>
                    </div>

                    <span className="text-xs font-bold text-slate-400 flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {item.fechaHoraISO
                        ? new Date(item.fechaHoraISO).toLocaleString('es-CL', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Sin fecha'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="font-black text-slate-800 flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
                      <span>{item.siteName}</span>
                    </div>
                    <div className="text-slate-600 font-medium">
                      Reportado por:{' '}
                      <strong className="text-slate-800">{item.trabajadorNombre}</strong>
                    </div>
                  </div>

                  {/* Zona de Novedad: Post-It Amarillo con miniaturas y acceso directo a galería */}
                  <div className="bg-amber-50/90 border border-amber-200/90 rounded-2xl p-3.5 text-xs text-amber-950 shadow-xs space-y-2">
                    <p className="font-medium text-amber-950 leading-relaxed whitespace-pre-wrap line-clamp-4">
                      {item.descripcion}
                    </p>

                    {item.fotosUrls.length > 0 && (
                      <div className="pt-2 border-t border-amber-200/70" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-black uppercase tracking-wider text-amber-800/90 flex items-center gap-1">
                            <Camera className="w-3.5 h-3.5 text-amber-700" />
                            {item.fotosUrls.length} {item.fotosUrls.length === 1 ? 'fotografía adjunta' : 'fotografías adjuntas'}
                          </span>
                          <span className="text-[9px] font-bold text-amber-700">clic para galería</span>
                        </div>
                        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                          {item.fotosUrls.map((url, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setGalleryState({
                                  photos: item.fotosUrls,
                                  index: idx,
                                  title: `${item.siteName} · Fotografías de Novedad`,
                                });
                              }}
                              className="w-12 h-12 rounded-xl overflow-hidden border border-amber-300 shrink-0 hover:ring-2 hover:ring-amber-500 transition-all cursor-pointer group bg-amber-100 shadow-xs"
                              title="Clic para ver fotografía ampliada en galería"
                            >
                              <img
                                src={url}
                                alt={`Evidencia ${idx + 1}`}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Consulta de Administración / Jefatura hacia el Supervisor */}
                  {g?.consultaAdmin && (
                    <div
                      className={`p-3 rounded-xl border text-xs space-y-1 ${
                        g.consultaAdmin.pendienteRespuesta
                          ? 'bg-amber-50/80 border-amber-200'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-black text-amber-950">
                          📣 Consulta de Jefatura / Administración: {g.consultaAdmin.adminNombre}
                        </span>
                        <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-white border border-amber-200 text-amber-800">
                          {g.consultaAdmin.pendienteRespuesta
                            ? 'Pendiente respuesta supervisor'
                            : 'Respondida por supervisor'}
                        </span>
                      </div>
                      <p className="text-slate-800 font-semibold">{g.consultaAdmin.mensaje}</p>
                    </div>
                  )}

                  {/* Si existe gestión registrada por el supervisor, mostrar resumen auditable */}
                  {tieneGestionSupervisor && g && (
                    <div className="p-3 rounded-xl bg-indigo-50/60 border border-indigo-100 text-xs space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-black text-indigo-950">
                          Última Gestión Supervisor:{' '}
                          {g.ultimoSupervisorNombre || g.supervisorNombre}
                        </span>
                        {fechaSupISO && (
                          <span className="text-[11px] font-bold text-indigo-600">
                            {new Date(fechaSupISO).toLocaleString('es-CL', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                      <p className="text-slate-700">
                        <strong className="text-slate-900">Medidas tomadas:</strong>{' '}
                        {g.medidasTomadas}
                      </p>
                      {g.fueSolucionado === 'no' && g.motivoNoSolucionado && (
                        <p className="text-red-700 font-medium">
                          <strong>Motivo no solución:</strong> {g.motivoNoSolucionado}
                        </p>
                      )}
                      {g.observaciones && (
                        <p className="text-slate-600">
                          <strong>Observaciones:</strong> {g.observaciones}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Acciones: Ver Registro Original y Consultar/Gestionar */}
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 pt-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-2">
                      {item.fotosUrls.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setLightboxPhoto(item.fotosUrls[0])}
                          className="text-[11px] font-black text-blue-600 hover:underline"
                        >
                          📷 {item.fotosUrls.length}{' '}
                          {item.fotosUrls.length === 1 ? 'evidencia' : 'evidencias'}
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenOriginalRecord(item)}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-black flex items-center gap-1.5 transition-colors"
                        title="Abrir seguimiento y comunicar instrucciones al guardia de turno"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-blue-600" />
                        Registro Original (Guardia)
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelectedAlertaForGestion(item)}
                        className={`px-3.5 py-1.5 rounded-xl text-white text-xs font-black flex items-center gap-1.5 shadow-xs transition-colors ${
                          isAdminOrJefe
                            ? 'bg-indigo-600 hover:bg-indigo-700'
                            : 'bg-slate-900 hover:bg-slate-800'
                        }`}
                      >
                        <ClipboardCheck className="w-3.5 h-3.5 text-indigo-200" />
                        {isAdminOrJefe
                          ? 'Consultar a Supervisor / Historial'
                          : tieneGestionSupervisor
                          ? 'Gestionar / Historial'
                          : 'Registrar Gestión'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="pt-4 flex items-center justify-between border-t border-slate-100">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 text-xs font-black text-slate-700 flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" /> Anterior
              </button>
              <span className="text-xs font-black text-slate-500">
                Página {page} de {totalPages}
              </span>
              <button
                type="button"
                disabled={page === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 text-xs font-black text-slate-700 flex items-center gap-1"
              >
                Siguiente <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Modal de Gestión del Supervisor e Historial Auditable */}
      {currentUser && (
        <GestionSupervisorModal
          isOpen={Boolean(liveSelectedAlerta)}
          alerta={liveSelectedAlerta}
          currentUser={{
            id: currentUser.uid,
            name: currentActorName,
            role: currentUser.role,
            assignedSites: assignedSitesList,
          }}
          onClose={() => setSelectedAlertaForGestion(null)}
          onSaved={(updated) => {
            setAlertas((prev) =>
              prev.map((a) => (a.uidKey === updated.uidKey ? updated : a)),
            );
            setSelectedAlertaForGestion(updated);
          }}
          onOpenOriginalRecord={(alerta) => {
            setSelectedAlertaForGestion(null);
            handleOpenOriginalRecord(alerta);
          }}
        />
      )}

      {/* Acceso directo al Registro Original de Ronda (Mapa GPS + Fotos) */}
      {selectedOriginalRound && (
        <RouteMapModal
          round={selectedOriginalRound}
          onClose={() => setSelectedOriginalRound(null)}
        />
      )}

      {/* Acceso directo al Registro Original de Novedad (Hilo de Seguimiento) */}
      {selectedOriginalNovedad && currentUser && (
        <NovedadSeguimientoModal
          novedad={selectedOriginalNovedad}
          usuario={{
            uid: currentUser.uid,
            nombre: currentActorName,
            rol: currentUser.role,
          }}
          onClose={() => setSelectedOriginalNovedad(null)}
        />
      )}

      {novedadToInit && (
        <IniciarSeguimientoModal
          novedad={novedadToInit}
          onClose={() => setNovedadToInit(null)}
          onSuccess={() => setNovedadToInit(null)}
        />
      )}

      {/* Galería Fotográfica de Novedades y Rondas */}
      {galleryState && galleryState.photos.length > 0 && (
        <PhotoGalleryModal
          photos={galleryState.photos}
          initialIndex={galleryState.index}
          onClose={() => setGalleryState(null)}
          title={galleryState.title}
        />
      )}
    </div>
  );
};

export default SupervisorDashboard;
