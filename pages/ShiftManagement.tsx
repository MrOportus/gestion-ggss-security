import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { normalizeText } from '../lib/textUtils';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, Timestamp, getDocs, deleteDoc as firestoreDeleteDoc } from 'firebase/firestore';
import {
    Calendar as CalendarIcon,
    MapPin,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    ChevronDown,
    Save,
    Edit3,
    CheckCircle2,
    XCircle,
    MoreHorizontal,
    Eraser,
    Users,
    Plus,
    UserMinus,
    Circle,
    AlertTriangle,
    AlertCircle
} from 'lucide-react';
import ManageStaffModal from '../components/ManageStaffModal';
import { useShiftManagementFacade } from '../lib/phase2/useShiftManagementFacade';

import { ContractStatusBadge } from '../components/phase3/ContractStatusBadge';
import { MonthContractSummary } from '../components/phase3/MonthContractSummary';
import { ContractBindingService } from '../lib/phase3/contractBindingService';
import { useContractShadowBatch } from '../lib/phase3/useContractShadowBatch';
import ShiftTransferModal from '../components/phase4/ShiftTransferModal';
import ShiftActionModal from '../components/phase4/ShiftActionModal';
import AdditionalShiftModal from '../components/phase4/AdditionalShiftModal';
import VacancyCoverageModal from '../components/phase4/VacancyCoverageModal';
import ShiftInfoModal from '../components/phase4/ShiftInfoModal';
import { ArrowRightLeft } from 'lucide-react';

// --- Types ---

type ShiftStatus = 'programado' | 'asistio_manual' | 'asistio_manual_completed' | 'ausente' | 'noche' | 'descanso' | 'trasladado' | null;

interface ProgramacionDoc {
    id?: string;
    employeeId: string;
    siteId: string | number; // Support both
    date: string; // YYYY-MM-DD
    status: 'programado' | 'noche' | 'descanso' | 'trasladado';
}


interface AsistenciaDigitalDoc {
    id?: string;
    employeeId: string;
    siteId: string | number;
    timestamp: Timestamp;
    photoUrl?: string;
    gpsLocation?: { lat: number, lng: number };
    isValidated: boolean;
}

interface AsistenciaManualDoc {
    id?: string;
    employeeId: string;
    date: string; // YYYY-MM-DD
    status: 'presente' | 'ausente';
    editorId?: string;
    updatedAt?: Timestamp;
    siteId?: string | number;
}

// Helper to format date YYYY-MM-DD
const formatDateKey = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const ShiftManagement: React.FC = () => {
    const { sites, employees, currentUser, fetchInitialData, showConfirmation, contratos, fetchContratos } = useAppStore();

    const filteredSitesForUser = useMemo(() => {
        if (currentUser?.role === 'supervisor') {
            const currentEmp = employees.find(e => e.id === currentUser?.uid);
            return sites.filter(s => currentEmp?.assignedSites?.includes(s.id));
        }
        return sites;
    }, [sites, currentUser, employees]);

    // --- State ---
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedSiteId, setSelectedSiteId] = useState<string | number>('');
    const [siteInputValue, setSiteInputValue] = useState('');
    const [showSiteList, setShowSiteList] = useState(false);
    const siteSearchRef = useRef<HTMLDivElement>(null);
    const [isEditMode, setIsEditMode] = useState(false);
    const [isManageStaffOpen, setIsManageStaffOpen] = useState(false);

    // Click and Drag State
    const [isDragging, setIsDragging] = useState(false);
    const [dragEmployeeId, setDragEmployeeId] = useState<string | null>(null);
    const [activeTool, setActiveTool] = useState<'programado' | 'noche' | 'descanso' | 'asistio_manual' | 'ausente' | 'eraser'>('programado');

    // Data State
    const [programmingMap, setProgrammingMap] = useState<Record<string, ProgramacionDoc>>({});
    const [digitalAttendanceMap, setDigitalAttendanceMap] = useState<Record<string, AsistenciaDigitalDoc>>({});
    const [manualAttendanceMap, setManualAttendanceMap] = useState<Record<string, AsistenciaManualDoc>>({});

    // Local Changes for Edit Mode (before save)
    const [pendingChanges, setPendingChanges] = useState<Record<string, ShiftStatus>>({});
    const [conflictError, setConflictError] = useState<string | null>(null);

    // Modal State
    const [detailModal, setDetailModal] = useState<{
        isOpen: boolean;
        data: AsistenciaDigitalDoc | null;
        employeeName: string;
    }>({ isOpen: false, data: null, employeeName: '' });

    const [manualEntryPrompt, setManualEntryPrompt] = useState<{
        empId: string;
        day: Date;
        key: string;
    } | null>(null);

    const [transferModal, setTransferModal] = useState<{
        isOpen: boolean;
        colaboradorId: string;
        colaboradorNombre: string;
        colaboradorRut: string;
        sucursalOrigenId: string | number;
        sucursalOrigenNombre: string;
        fecha: string;
    } | null>(null);

    const [actionModal, setActionModal] = useState<{
        isOpen: boolean;
        empId: string;
        fecha: string;
        shiftStatus: string;
        requiereCobertura: boolean;
        shiftId?: string;
        isConflict?: boolean;
    } | null>(null);

    const [additionalModal, setAdditionalModal] = useState<{
        isOpen: boolean;
        colaboradorId: string;
        colaboradorNombre: string;
        fecha: string;
    } | null>(null);

    const [coverageModal, setCoverageModal] = useState<{
        isOpen: boolean;
        vacanteTurnoId: string;
        sucursalId: string | number;
        fecha: string;
    } | null>(null);

    // Info modal (solo lectura — se abre al hacer clic en modo vista)
    const [infoModal, setInfoModal] = useState<{
        isOpen: boolean;
        empId: string;
        fecha: string;
        shiftStatus: 'programado' | 'noche' | 'descanso' | 'trasladado';
        shiftDetails?: Record<string, any>;
        isConflict?: boolean;
    } | null>(null);

    // Init default site
    useEffect(() => {
        if (filteredSitesForUser.length > 0 && !selectedSiteId) {
            setSelectedSiteId(filteredSitesForUser[0].id);
        }
    }, [filteredSitesForUser, selectedSiteId]);

    useEffect(() => {
        if (selectedSiteId) {
            const site = sites.find(s => String(s.id) === String(selectedSiteId));
            if (site) setSiteInputValue(site.name);
        }
    }, [selectedSiteId, sites]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (siteSearchRef.current && !siteSearchRef.current.contains(event.target as Node)) {
                setShowSiteList(false);
                if (selectedSiteId) {
                    const site = filteredSitesForUser.find(s => String(s.id) === String(selectedSiteId));
                    if (site) setSiteInputValue(site.name);
                }
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [selectedSiteId, filteredSitesForUser]);

    // --- Global Mouse Up Listener for Dragging ---
    useEffect(() => {
        const handleGlobalMouseUp = () => {
            setIsDragging(false);
            setDragEmployeeId(null);
        };
        window.addEventListener('mouseup', handleGlobalMouseUp);
        return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }, []);

    // --- Firebase Listeners ---
    // OPTIMIZACIÓN: Filtrar por rango de fechas del mes visible + sitio seleccionado
    // Antes: descargaba las 3 colecciones COMPLETAS sin filtro (fuga masiva)
    const firstDay = formatDateKey(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
    const lastDay = formatDateKey(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0));

    useEffect(() => {
        if (!selectedSiteId) return;

        // 1. Listen to Programming — filtrado por mes visible
        const progQuery = query(
            collection(db, 'programacion'),
            where('date', '>=', firstDay),
            where('date', '<=', lastDay)
        );
        const unsubProg = onSnapshot(progQuery, (snapshot) => {
            const map: Record<string, ProgramacionDoc> = {};
            snapshot.docs.forEach(doc => {
                const data = doc.data() as ProgramacionDoc;
                const key = `${data.siteId}_${data.employeeId}_${data.date}`;
                map[key] = { ...data, id: doc.id };
            });
            setProgrammingMap(map);
        });

        // 2. Listen to Digital Attendance — filtrado por mes visible
        const digQuery = query(
            collection(db, 'asistencia_digital'),
            where('date', '>=', firstDay),
            where('date', '<=', lastDay)
        );
        const unsubDig = onSnapshot(digQuery, (snapshot) => {
            const map: Record<string, AsistenciaDigitalDoc> = {};
            snapshot.docs.forEach(doc => {
                const data = doc.data() as any;
                const dateStr = data.date || formatDateKey(data.timestamp.toDate());
                const key = `${data.siteId}_${data.employeeId}_${dateStr}`;
                map[key] = { ...data, id: doc.id };
            });
            setDigitalAttendanceMap(map);
        });

        // 3. Listen to Manual Attendance — filtrado por mes visible
        const manQuery = query(
            collection(db, 'asistencia_manual'),
            where('date', '>=', firstDay),
            where('date', '<=', lastDay)
        );
        const unsubMan = onSnapshot(manQuery, (snapshot) => {
            const map: Record<string, AsistenciaManualDoc> = {};
            snapshot.docs.forEach(doc => {
                const data = doc.data() as AsistenciaManualDoc;
                // Soporte para registros antiguos sin siteId, y nuevos con siteId
                const sitePart = data.siteId ? `${data.siteId}_` : '';
                const key = `${sitePart}${data.employeeId}_${data.date}`;
                map[key] = { ...data, id: doc.id };
            });
            setManualAttendanceMap(map);
        });

        return () => {
            unsubProg();
            unsubDig();
            unsubMan();
        };
    }, [firstDay, lastDay, selectedSiteId]);

    // Refrescar contratos al cambiar de mes o sucursal para que el badge contractual sea preciso
    useEffect(() => {
        fetchContratos({ limit: 500 });
    }, [firstDay, fetchContratos]);

    // --- Helpers ---
    const getDaysInMonth = (date: Date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        const days = new Date(year, month + 1, 0).getDate();
        const daysArray = [];
        for (let i = 1; i <= days; i++) {
            daysArray.push(new Date(year, month, i));
        }
        return daysArray;
    };

    const days = getDaysInMonth(currentDate);

    const handlePrevMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    };
    const handleNextMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    };

    const getCellKey = (empId: string, day: Date) => {
        return `${selectedSiteId}_${empId}_${formatDateKey(day)}`;
    };

    const getCellStatus = (empId: string, day: Date): {
        type: 'empty' | 'programado' | 'noche' | 'descanso' | 'digital' | 'manual_present' | 'manual_absent' | 'trasladado',
        details?: any,
        completed?: boolean,
        programmedStatus?: 'programado' | 'noche' | 'descanso' | 'trasladado'
    } => {
        const dateKey = formatDateKey(day);
        const key = getCellKey(empId, day);
        const progStatus = programmingMap[key]?.status;

        if (pendingChanges[key] !== undefined) {
            if (pendingChanges[key] === 'programado') return { type: 'programado' };
            if (pendingChanges[key] === 'noche') return { type: 'noche' };
            if (pendingChanges[key] === 'descanso') return { type: 'descanso' };
            if (pendingChanges[key] === 'asistio_manual') return { type: 'manual_present', programmedStatus: progStatus };
            if (pendingChanges[key] === 'asistio_manual_completed') return { type: 'manual_present', completed: true, programmedStatus: progStatus };
            if (pendingChanges[key] === 'ausente') return { type: 'manual_absent' };
            if (pendingChanges[key] === null) return { type: 'empty' };
        }

        const manualKeyFull = `${selectedSiteId}_${empId}_${dateKey}`;
        const manualDoc = manualAttendanceMap[manualKeyFull];
        const manualStatus = manualDoc?.status;

        if (manualStatus === 'presente') {
            return { type: 'manual_present', details: manualDoc, programmedStatus: progStatus };
        }
        if (manualStatus === 'ausente') return { type: 'manual_absent', details: manualDoc };

        if (digitalAttendanceMap[key]) {
            return { type: 'digital', details: digitalAttendanceMap[key], programmedStatus: progStatus };
        }

        if (programmingMap[key]) {
            const prog = programmingMap[key] as any;
            const status = prog.status;
            const turno = String(prog.turno || prog.codigoTurno || '').trim().toUpperCase();

            if (status === 'noche' || turno === 'N' || turno === 'NOCHE') return { type: 'noche', details: prog };
            if (status === 'descanso' || turno === 'D' || turno === 'DESCANSO') return { type: 'descanso', details: prog };
            if (status === 'trasladado') return { type: 'trasladado', details: prog };
            return { type: 'programado', details: prog };
        }

        return { type: 'empty' };
    };

    // --- Cell Interaction Handlers ---

    const handlePaintCell = useCallback((empId: string, day: Date) => {
        const key = getCellKey(empId, day);
        let nextStatus: ShiftStatus = 'programado';

        if (activeTool === 'noche') nextStatus = 'noche';
        else if (activeTool === 'descanso') nextStatus = 'descanso';
        else if (activeTool === 'asistio_manual') nextStatus = 'asistio_manual';
        else if (activeTool === 'ausente') nextStatus = 'ausente';
        else if (activeTool === 'eraser') nextStatus = null;

        setPendingChanges(prev => ({
            ...prev,
            [key]: nextStatus
        }));
    }, [selectedSiteId, activeTool]);

    const handleCellMouseDown = (empId: string, day: Date, currentStatus: string) => {
        if (!isEditMode) return;

        setIsDragging(true);
        setDragEmployeeId(empId);

        // Initial Cycle logic on first click
        const key = getCellKey(empId, day);
        let nextState: ShiftStatus = 'programado';

        if (activeTool === 'eraser') {
            nextState = null;
        } else {
            nextState = activeTool as ShiftStatus;

            // Si el estado actual ya coincide con la herramienta, borramos (toggle)
            if (currentStatus === 'programado' && activeTool === 'programado') nextState = null;
            else if (currentStatus === 'noche' && activeTool === 'noche') nextState = null;
            else if (currentStatus === 'descanso' && activeTool === 'descanso') nextState = null;
            else if (currentStatus === 'manual_present' && activeTool === 'asistio_manual') {
                nextState = null;
            }
            else if (currentStatus === 'manual_absent' && activeTool === 'ausente') nextState = null;

            // Add step for manual attendance
            if (activeTool === 'asistio_manual' && nextState !== null) {
                setManualEntryPrompt({ empId, day, key });
                return;
            }
        }

        setPendingChanges(prev => ({
            ...prev,
            [key]: nextState
        }));
    };

    const handleCellMouseEnter = (empId: string, day: Date) => {
        if (isEditMode && isDragging && empId === dragEmployeeId) {
            handlePaintCell(empId, day);
        }
    };

    const handleCellClick = (empId: string, day: Date) => {
        if (!isEditMode) {
            const status = getCellStatus(empId, day);
            if (status.type === 'digital' && status.details) {
                const emp = employees.find(e => e.id === empId);
                setDetailModal({
                    isOpen: true,
                    data: status.details,
                    employeeName: emp ? `${emp.firstName} ${emp.lastNamePaterno}` : 'Desconocido'
                });
            } else if ((status.type === 'programado' || status.type === 'noche' || status.type === 'descanso' || status.type === 'trasladado') && status.details) {
                const emp = employees.find(e => e.id === empId);
                if (emp) {
                    // Siempre mostrar modal informativo (solo lectura)
                    setInfoModal({
                        isOpen: true,
                        empId: emp.id,
                        fecha: formatDateKey(day),
                        shiftStatus: status.type as 'programado' | 'noche' | 'descanso' | 'trasladado',
                        shiftDetails: status.details,
                        isConflict: conflictingCells.has(`${emp.id}_${formatDateKey(day)}`)
                    });
                }
            }
        }
        // If isEditMode, MouseDown handled it
    };

    const { saveChanges: facadeSaveChanges, isSaving } = useShiftManagementFacade();

    const [summaryModalState, setSummaryModalState] = useState<{
        isOpen: boolean;
        result?: import('../lib/phase2/useShiftManagementFacade').SaveChangesResult;
        contractAlerts?: string[];
        conflictCheckPending?: boolean;
    }>({ isOpen: false });
    const [savedTokens, setSavedTokens] = useState<Record<string, string>>({});

    // ── ConflictWarnings: listener en tiempo real ─────────────────────────────
    const [conflictWarnings, setConflictWarnings] = useState<any[]>([]);
    const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(new Set());

    useEffect(() => {
        const mesStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

        const warningsQuery = query(
            collection(db, 'ConflictWarnings'),
            where('mes', '==', mesStr)
        );
        const unsub = onSnapshot(warningsQuery, (snap) => {
            const warnings: any[] = [];
            snap.docs.forEach(d => {
                const data = d.data();
                if (data.acknowledged !== true) {
                    warnings.push({ id: d.id, ...data });
                }
            });
            setConflictWarnings(warnings);
        });
        return () => unsub();
    }, [currentDate]);

    const dismissWarning = (id: string) => {
        setDismissedWarnings(prev => {
            const next = new Set(prev);
            next.add(id);
            return next;
        });
        const ref = doc(db, 'ConflictWarnings', id);
        updateDoc(ref, { acknowledged: true }).catch(console.error);
    };

    // Elimina una fecha específica del ConflictWarning de un colaborador.
    // Si no quedan conflictos en ese mes, marca el doc como acknowledged.
    const clearConflictForDate = async (empId: string, fecha: string) => {
        const warningDoc = conflictWarnings.find(w => w.colaboradorId === empId);
        if (!warningDoc) return;
        const remaining = (warningDoc.conflictos || []).filter((c: any) => c.fecha !== fecha);
        const ref = doc(db, 'ConflictWarnings', warningDoc.id);
        if (remaining.length === 0) {
            await updateDoc(ref, { acknowledged: true, conflictos: [], totalConflictos: 0 }).catch(console.error);
        } else {
            await updateDoc(ref, { conflictos: remaining, totalConflictos: remaining.length }).catch(console.error);
        }
    };

    const saveChanges = async (overrideConflicts: boolean = false) => {
        setConflictError(null);

        // ------------------------------------------------------------------
        // FASE D (CANARY): VALIDACIÓN DE CONTRATOS PRE-GUARDADO
        // ------------------------------------------------------------------
        let currentContractAlerts: string[] = [];
        if (featureFlag?.mode === 'canary' && featureFlag?.enabled && !overrideConflicts) {
            // Validar solo los "nuevos" turnos a asignar
            Object.keys(pendingChanges).forEach(key => {
                const parts = key.split('_');
                const empId = parts.slice(1, -1).join('_');
                const dateKey = parts[parts.length - 1];
                const newStatus = pendingChanges[key];
                
                if (newStatus && ['programado', 'noche', 'digital', 'descanso'].includes(newStatus)) {
                    const evalResult = employeeContractEvaluations[empId]?.[dateKey];
                    if (evalResult && evalResult.estado !== 'compatible') {
                        const emp = employees.find(e => e.id === empId);
                        const empName = emp ? `${emp.firstName} ${emp.lastNamePaterno}` : empId;
                        let reason = 'Sin contrato que cubra esta fecha';
                        if (evalResult.estado === 'otra_sucursal') reason = 'Contrato vigente pertenece a otra sucursal';
                        else if (evalResult.estado === 'multiples') reason = 'Existen múltiples contratos vigentes';
                        
                        currentContractAlerts.push(`${empName} el día ${dateKey}: ${reason}`);
                    }
                }
            });

            if (currentContractAlerts.length > 0) {
                // Interceptamos el guardado para mostrar las alertas contractuales
                setSummaryModalState({
                    isOpen: true,
                    result: { success: 0, conflicts: [], technicalErrors: [], newTokens: {}, failedColabIds: [], conflictCheckPending: false },
                    contractAlerts: currentContractAlerts
                });
                return;
            }
        }

        const result = await facadeSaveChanges({
            pendingChanges,
            programmingMap,
            sites,
            employees,
            currentUser,
            previousTokens: savedTokens,
            overrideConflicts,
        });

        setSavedTokens(result.newTokens);

        // Limpiar de pendingChanges aquellos que fueron exitosos
        const newPending = { ...pendingChanges };
        const failedIds = result.failedColabIds;
        Object.keys(newPending).forEach(key => {
            const empId = key.split('_').slice(1, -1).join('_');
            if (!failedIds.includes(empId)) {
                delete newPending[key];
            }
        });
        setPendingChanges(newPending);

        if (result.technicalErrors.length > 0 || (result.conflicts && result.conflicts.length > 0)) {
            // Solo errores técnicos o conflictos bloquean con modal
            setSummaryModalState({ isOpen: true, result, contractAlerts: [], conflictCheckPending: result.conflictCheckPending });
        } else {
            // Guardado exitoso: limpiar conflictos de celdas borradas
            const cleanupPromises: Promise<void>[] = [];
            Object.entries(pendingChanges).forEach(([key, status]) => {
                if (status === null) {
                    // key = {siteId}_{empId}_{fecha}
                    const parts = key.split('_');
                    const fecha = parts[parts.length - 1];
                    const empId = parts.slice(1, -1).join('_');
                    // Si esa celda tenía un conflicto activo, limpiar el warning
                    if (conflictingCells.has(`${empId}_${fecha}`)) {
                        cleanupPromises.push(clearConflictForDate(empId, fecha));
                    }
                }
            });
            if (cleanupPromises.length > 0) {
                await Promise.allSettled(cleanupPromises);
            }
            // Salir de modo edición
            setIsEditMode(false);
            setConflictError(null);
            setSavedTokens({});
        }
    };

    const handleForceConflicts = async () => {
        setSummaryModalState({ isOpen: false });
        try {
            const result = await facadeSaveChanges({
                pendingChanges,
                programmingMap,
                sites,
                employees,
                currentUser,
                previousTokens: {},  // Forzar nuevos tokens para evitar idempotencia
                overrideConflicts: true,
            });
            // Limpiar todos los pending tras guardar forzado
            setPendingChanges({});
            setSavedTokens({});
            setIsEditMode(false);
            setConflictError(null);
            if (result.technicalErrors.length > 0) {
                setSummaryModalState({ isOpen: true, result, contractAlerts: [], conflictCheckPending: false });
            }
        } catch (e) {
            console.error("Error al forzar guardado:", e);
        }
    };

    const handleRetryTechnical = async () => {
        if (!summaryModalState.result) return;
        const failedIds = summaryModalState.result.failedColabIds;
        
        // Filtramos pendingChanges para dejar solo los de los trabajadores que fallaron técnicamente
        // (y que no están en conflictos, porque los conflictos no se reintentan así)
        // En realidad, failedColabIds incluye conflictos y technical errors. 
        // Mejor limpiamos los conflictos de pendingChanges y dejamos que el usuario decida.
        // Por ahora cerramos el modal e invocamos saveChanges de nuevo.
        setSummaryModalState({ isOpen: false });
        await saveChanges();
    };

    const discardChanges = () => {
        setPendingChanges({});
        setIsEditMode(false);
        setSavedTokens({});
    };

    const handleUpdateStaff = async (selectedIds: string[]) => {
        try {
            const batchPromises = [];
            const currentSiteEmployees = employees.filter(e => e.currentSiteId == selectedSiteId);

            for (const emp of currentSiteEmployees) {
                if (!selectedIds.includes(emp.id)) {
                    const ref = doc(db, 'Colaboradores', emp.id);
                    batchPromises.push(updateDoc(ref, { currentSiteId: 0 }));
                }
            }

            for (const id of selectedIds) {
                const emp = employees.find(e => e.id === id);
                if (emp && emp.currentSiteId != selectedSiteId) {
                    const ref = doc(db, 'Colaboradores', id);
                    batchPromises.push(updateDoc(ref, { currentSiteId: Number(selectedSiteId) }));
                }
            }

            await Promise.all(batchPromises);
            await fetchInitialData(true);

        } catch (e) {
            console.error("Error updating staff:", e);
        }
    };

    const handleRemoveEmployeeFromSite = (empId: string) => {
        showConfirmation({
            title: "Quitar Colaborador",
            message: "¿Seguro que deseas quitar a este colaborador de esta sucursal?",
            onConfirm: async () => {
                try {
                    const ref = doc(db, 'Colaboradores', empId);
                    await updateDoc(ref, { currentSiteId: 0 });
                    await fetchInitialData(true);
                } catch (e) {
                    console.error("Error removing employee:", e);
                }
            }
        });
    };

    // --- FILTERED LIST FOR DISPLAY ---
    const extraEmployeeIds = new Set<string>();
    Object.values(programmingMap).forEach(doc => {
        if (doc.siteId == selectedSiteId) {
            extraEmployeeIds.add(doc.employeeId);
        }
    });

    const finalVisibleEmployees = employees.filter(emp => {
        return (emp.currentSiteId == selectedSiteId) || extraEmployeeIds.has(emp.id);
    });

    const shadowEmployeeIds = useMemo(() => finalVisibleEmployees.map(e => e.id), [finalVisibleEmployees]);
    
    const activeConflictWarnings = useMemo(() => {
        return conflictWarnings.filter(w => {
            if (dismissedWarnings.has(w.id)) return false;
            return shadowEmployeeIds.includes(w.colaboradorId);
        });
    }, [conflictWarnings, dismissedWarnings, shadowEmployeeIds]);

    const conflictingCells = useMemo(() => {
        const cells = new Set<string>();
        activeConflictWarnings.forEach(w => {
            w.conflictos.forEach((c: any) => {
                cells.add(`${w.colaboradorId}_${c.fecha}`);
            });
        });
        return cells;
    }, [activeConflictWarnings]);

    const { featureFlag } = useContractShadowBatch({
        employeeIds: shadowEmployeeIds,
        selectedSiteId,
        firstDay,
        lastDay,
        contratos,
        programmingMap
    });

    // --- PHASE 3: EVALUACION CONTRACTUAL MENSUAL OPTIMIZADA ---
    // 1. Precalcular el estado contractual de cada empleado para cada día del mes (independiente de si tiene turno o no)
    const employeeContractEvaluations = useMemo(() => {
        const evals: Record<string, Record<string, { estado: string, contratoId?: string }>> = {};
        finalVisibleEmployees.forEach(emp => {
            const empContracts = contratos.filter(c => c.colaboradorId === emp.id);
            evals[emp.id] = {};
            days.forEach(day => {
                const dateKey = formatDateKey(day);
                evals[emp.id][dateKey] = ContractBindingService.evaluateTurno(
                    emp.id,
                    String(selectedSiteId),
                    dateKey,
                    empContracts
                );
            });
        });
        return evals;
    }, [finalVisibleEmployees, days, contratos, selectedSiteId]);

    // 2. Calcular resumen mensual usando los turnos actuales y la evaluación precalculada
    const monthSummary = useMemo(() => {
        const summary = { totalTurnos: 0, sinContrato: 0, otraSucursal: 0, multiples: 0 };

        finalVisibleEmployees.forEach(emp => {
            const evals = employeeContractEvaluations[emp.id];
            days.forEach(day => {
                const status = getCellStatus(emp.id, day);
                if (status.type === 'programado' || status.type === 'noche' || status.type === 'digital' || status.type === 'manual_present') {
                    summary.totalTurnos++;
                    const evalRes = evals[formatDateKey(day)];
                    if (evalRes?.estado === 'sin_contrato') summary.sinContrato++;
                    else if (evalRes?.estado === 'otra_sucursal') summary.otraSucursal++;
                    else if (evalRes?.estado === 'multiples') summary.multiples++;
                }
            });
        });
        return summary;
    }, [finalVisibleEmployees, days, getCellStatus, employeeContractEvaluations]);

    // 3. Obtener el contrato activo de un empleado para la sucursal en el mes visible (para mostrar detalle en el badge)
    const getEmployeeActiveContrato = useCallback((empId: string) => {
        const empContracts = contratos.filter(c => c.colaboradorId === empId);
        if (empContracts.length === 0) return undefined;
        
        // Buscar contratos aplicables dentro de los días del mes visible
        const validContracts = empContracts.filter(c => {
            return days.some(day => {
                const dateKey = formatDateKey(day);
                return (c.estado === 'vigente' || c.estado === 'pendiente_firma') &&
                       dateKey >= c.fechaInicio &&
                       (!c.fechaTermino || dateKey <= c.fechaTermino) &&
                       c.sucursalId.toString() === selectedSiteId.toString();
            });
        });

        if (validContracts.length === 0) return undefined;
        // Retornar el contrato que tenga la fecha de término más lejana (el "último")
        return validContracts.sort((a, b) => {
            if (!a.fechaTermino) return -1; // indefinido gana
            if (!b.fechaTermino) return 1;
            return b.fechaTermino.localeCompare(a.fechaTermino); // más futuro primero
        })[0];
    }, [contratos, selectedSiteId, days]);

    // 4. Obtener el peor estado contractual de un empleado en el mes visible
    const getEmployeeWorstContractState = useCallback((empId: string) => {
        const evals = employeeContractEvaluations[empId];
        if (!evals) return 'sin_contrato';
        
        let lastShiftDate = '';
        let hasOtraSucursal = false;

        // Determinar el último día con turno y si hay conflictos con otras sucursales
        for (const day of days) {
            const status = getCellStatus(empId, day);
            if (status.type === 'programado' || status.type === 'noche' || status.type === 'digital' || status.type === 'manual_present') {
                lastShiftDate = formatDateKey(day);
                const evalRes = evals[lastShiftDate];
                if (evalRes?.estado === 'otra_sucursal') hasOtraSucursal = true;
            }
        }

        if (!lastShiftDate) return 'compatible'; // Sin turnos, todo OK.

        const ultimoContrato = getEmployeeActiveContrato(empId);
        
        // Regla simplificada de RRHH: Si el último contrato del mes tiene una fecha de término
        // mayor o igual a la del último turno trabajado, entonces está "Al día" (compatible)
        if (ultimoContrato) {
            if (!ultimoContrato.fechaTermino || ultimoContrato.fechaTermino >= lastShiftDate) {
                return 'compatible';
            } else {
                return 'sin_contrato';
            }
        }

        if (hasOtraSucursal) return 'otra_sucursal';
        return 'sin_contrato';
    }, [employeeContractEvaluations, days, getCellStatus, getEmployeeActiveContrato]);

    const handlePrevSite = () => {
        if (!selectedSiteId || filteredSitesForUser.length === 0) return;
        const currentIndex = filteredSitesForUser.findIndex(s => s.id === selectedSiteId);
        if (currentIndex > 0) {
            setSelectedSiteId(filteredSitesForUser[currentIndex - 1].id);
        } else {
            setSelectedSiteId(filteredSitesForUser[filteredSitesForUser.length - 1].id);
        }
    };

    const handleNextSite = () => {
        if (!selectedSiteId || filteredSitesForUser.length === 0) return;
        const currentIndex = filteredSitesForUser.findIndex(s => s.id === selectedSiteId);
        if (currentIndex < filteredSitesForUser.length - 1) {
            setSelectedSiteId(filteredSitesForUser[currentIndex + 1].id);
        } else {
            setSelectedSiteId(filteredSitesForUser[0].id);
        }
    };

    return (
        <div className="p-6 max-w-[100vw] overflow-x-hidden space-y-6 h-screen flex flex-col bg-slate-50 select-none">
            
            {isSaving && (
                <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-[100] flex items-center justify-center pointer-events-none">
                    <div className="bg-white p-6 rounded-2xl shadow-2xl border border-slate-100 flex flex-col items-center max-w-xs text-center pointer-events-auto">
                        <div className="w-12 h-12 border-4 border-slate-100 border-t-blue-600 rounded-full animate-spin mb-4"></div>
                        <h3 className="text-lg font-black text-slate-800 mb-1">Guardando...</h3>
                        <p className="text-sm font-medium text-slate-500">Procesando y validando los turnos. Esto puede tardar unos segundos.</p>
                    </div>
                </div>
            )}

            {/* Header & Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200 shrink-0">
                <div className="flex items-start gap-4">
                    <div>
                        <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
                            <CalendarIcon className="text-yellow-400" />
                            GESTIÓN DE TURNOS
                        </h1>
                        <p className="text-slate-500 text-sm font-medium">
                            {filteredSitesForUser.find(s => String(s.id) === String(selectedSiteId))?.name || 'Cargando sucursal...'}
                        </p>
                    </div>

                    {/* Conflictos (Área solicitada por usuario) */}
                    {activeConflictWarnings.length > 0 && (
                        <div className="bg-red-50 text-red-700 px-3 py-2 rounded-lg border border-red-200 text-sm font-bold flex flex-col gap-1 shadow-sm max-w-xs">
                            <div className="flex items-center gap-2">
                                <AlertTriangle size={16} className="text-red-500 animate-pulse" />
                                <span>{activeConflictWarnings.reduce((acc, w) => acc + w.totalConflictos, 0)} Conflictos de turno</span>
                            </div>
                            <button 
                                onClick={() => setSummaryModalState({ 
                                    isOpen: true, 
                                    result: { 
                                        success: 0, 
                                        conflicts: activeConflictWarnings.flatMap(w => {
                                            const emp = employees.find(e => e.id === w.colaboradorId);
                                            const name = emp ? `${emp.firstName} ${emp.lastNamePaterno}` : 'Colaborador';
                                            return w.conflictos.map((c: any) => `Conflicto: ${name} en: ${c.sucursalNombreA} y ${c.sucursalNombreB} (${c.fecha})`);
                                        }), 
                                        technicalErrors: [], 
                                        newTokens: {}, 
                                        failedColabIds: [], 
                                        conflictCheckPending: false 
                                    } 
                                })}
                                className="text-xs text-red-600 underline hover:text-red-800 text-left"
                            >
                                Ver detalles
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-4 flex-wrap">
                    {/* Save / Edit Controls */}
                    {isEditMode ? (
                        <>
                        <div className="flex items-center gap-2">
                            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 mr-2">
                                <button
                                    onClick={() => setActiveTool('programado')}
                                    className={`px-3 py-2 rounded-lg text-xs font-black transition-all ${activeTool === 'programado' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-200'}`}
                                    title="Turno Normal (X)"
                                >
                                    X
                                </button>
                                <button
                                    onClick={() => setActiveTool('noche')}
                                    className={`px-3 py-2 rounded-lg text-xs font-black transition-all ${activeTool === 'noche' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-200'}`}
                                    title="Turno Noche (N)"
                                >
                                    N
                                </button>
                                <button
                                    onClick={() => setActiveTool('descanso')}
                                    className={`px-3 py-2 rounded-lg text-xs font-black transition-all ${activeTool === 'descanso' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-200'}`}
                                    title="Descanso (D)"
                                >
                                    D
                                </button>
                                <div className="w-px h-6 bg-slate-300 mx-1 self-center"></div>
                                <button
                                    onClick={() => setActiveTool('asistio_manual')}
                                    className={`px-3 py-2 rounded-lg text-xs font-black transition-all ${activeTool === 'asistio_manual' ? 'bg-green-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-200'}`}
                                    title="Asistencia Manual (✓)"
                                >
                                    ✓
                                </button>
                                <button
                                    onClick={() => setActiveTool('ausente')}
                                    className={`px-3 py-2 rounded-lg text-xs font-black transition-all ${activeTool === 'ausente' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-200'}`}
                                    title="Ausente (A)"
                                >
                                    A
                                </button>
                                <button
                                    onClick={() => setActiveTool('eraser')}
                                    className={`px-2 py-2 rounded-lg text-xs font-black transition-all ${activeTool === 'eraser' ? 'bg-slate-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-200'}`}
                                    title="Borrador"
                                >
                                    <Eraser size={14} />
                                </button>
                            </div>

                            <button
                                onClick={discardChanges}
                                className="flex items-center gap-2 px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold transition"
                            >
                                <XCircle size={18} /> Cancelar
                            </button>
                            <button
                                onClick={() => saveChanges(false)}
                                disabled={isSaving}
                                className={`flex items-center gap-2 px-6 py-2 rounded-lg font-bold transition ${isSaving ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-green-500 hover:bg-green-600 text-white shadow-lg shadow-green-200 animate-pulse-once'}`}
                            >
                                {isSaving ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin"></div>
                                        GUARDANDO...
                                    </>
                                ) : (
                                    <>
                                        <Save size={18} /> GUARDAR CAMBIOS
                                    </>
                                )}
                            </button>
                        </div>
                        {conflictError && (
                            <div className="mt-2 px-4 py-3 bg-red-50 border border-red-300 text-red-700 rounded-lg text-sm font-medium flex items-start gap-2">
                                <XCircle size={16} className="mt-0.5 shrink-0 text-red-500" />
                                <span>{conflictError}</span>
                            </div>
                        )}
                        </>
                    ) : (
                        <button
                            onClick={() => setIsEditMode(true)}
                            className="flex items-center gap-2 px-6 py-2 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 rounded-lg shadow-lg shadow-yellow-100 font-bold transition"
                        >
                            <Edit3 size={18} /> PROGRAMAR / EDITAR
                        </button>
                    )}

                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
                        <button
                            onClick={handlePrevSite}
                            className="p-1 hover:bg-white hover:text-blue-600 rounded text-slate-600 transition shadow-sm"
                            title="Sucursal Anterior"
                        >
                            <ChevronUp size={18} />
                        </button>
                        <button
                            onClick={handleNextSite}
                            className="p-1 hover:bg-white hover:text-blue-600 rounded text-slate-600 transition shadow-sm"
                            title="Sucursal Siguiente"
                        >
                            <ChevronDown size={18} />
                        </button>
                    </div>

                    <div className="h-10 w-px bg-slate-200 mx-2 hidden md:block"></div>

                    <div className="relative flex items-center" ref={siteSearchRef}>
                        <MapPin className="absolute left-3 text-slate-400 w-4 h-4 z-10" />
                        <input
                            type="text"
                            className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm w-64 focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-800 font-medium cursor-pointer"
                            placeholder="Buscar sucursal..."
                            value={siteInputValue}
                            onFocus={() => {
                                setSiteInputValue('');
                                setShowSiteList(true);
                            }}
                            onChange={(e) => {
                                setSiteInputValue(e.target.value);
                                setShowSiteList(true);
                                const selectedSite = filteredSitesForUser.find(s => s.name === e.target.value);
                                if (selectedSite) {
                                    setSelectedSiteId(selectedSite.id);
                                }
                            }}
                        />
                        {showSiteList && (
                            <div className="absolute top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-2xl max-h-[400px] overflow-y-auto z-[120]">
                                {filteredSitesForUser
                                    .filter(s => normalizeText(s.name).includes(normalizeText(siteInputValue)))
                                    .map(site => (
                                    <div
                                        key={site.id}
                                        className="px-4 py-2 hover:bg-blue-50 cursor-pointer border-b border-slate-50 last:border-0"
                                        onClick={() => {
                                            setSelectedSiteId(site.id);
                                            setSiteInputValue(site.name);
                                            setShowSiteList(false);
                                        }}
                                    >
                                        <div className="text-sm font-bold text-slate-700">{site.name}</div>
                                        <div className="text-[10px] text-slate-400">{site.address}</div>
                                    </div>
                                ))}
                                {filteredSitesForUser.filter(s => normalizeText(s.name).includes(normalizeText(siteInputValue))).length === 0 && (
                                    <div className="p-4 text-xs text-slate-400 italic text-center">
                                        No hay sucursales que coincidan
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center bg-white border border-slate-200 rounded-lg p-1">
                        <button onClick={handlePrevMonth} className="p-1 hover:bg-slate-100 rounded text-slate-500">
                            <ChevronLeft size={20} />
                        </button>
                        <span className="px-4 text-sm font-bold text-slate-800 w-32 text-center uppercase">
                            {currentDate.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })}
                        </span>
                        <button onClick={handleNextMonth} className="p-1 hover:bg-slate-100 rounded text-slate-500">
                            <ChevronRight size={20} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Fase 3: Resumen Mensual */}
            <MonthContractSummary
                totalTurnos={monthSummary.totalTurnos}
                sinContrato={monthSummary.sinContrato}
                otraSucursal={monthSummary.otraSucursal}
                multiples={monthSummary.multiples}
            />

            {/* Main Table */}
            <div className="flex-1 overflow-hidden bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col">
                <div className="overflow-auto flex-1 custom-scrollbar">
                    <table className="w-full border-collapse">
                        <thead className="sticky top-0 z-30 bg-white shadow-sm">
                            <tr>
                                <th className="sticky left-0 z-40 bg-slate-50 border-b border-r border-slate-200 p-4 text-left min-w-[250px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                    <span className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">Personal</span>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-[10px] font-bold text-slate-300">📋 LISTA MAESTRA</span>
                                        <button
                                            onClick={() => setIsManageStaffOpen(true)}
                                            className="p-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition"
                                            title="Gestionar Dotación"
                                        >
                                            <Users size={14} />
                                        </button>
                                    </div>
                                </th>
                                {days.map(day => {
                                    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                                    return (
                                        <th key={day.toISOString()} className={`min-w-[40px] px-1 py-1 text-center border-b border-slate-100 ${isWeekend ? 'bg-red-50 text-red-600' : 'bg-white text-slate-600'}`}>
                                            <div className="text-[10px] uppercase font-bold">{day.toLocaleDateString('es-CL', { weekday: 'narrow' })}</div>
                                            <div className="text-sm font-black">{day.getDate()}</div>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {finalVisibleEmployees.map(emp => (
                                <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="sticky left-0 z-20 bg-white border-r border-slate-100 p-3 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                                        <div className="flex items-center justify-between gap-2 group">
                                            <div className="flex flex-col min-w-0">
                                                <span className="text-sm font-bold text-slate-800 truncate">{emp.firstName} {emp.lastNamePaterno}</span>
                                                <span className="text-[10px] font-mono text-slate-400">{emp.rut}</span>
                                            </div>
                                            <div className="flex flex-col items-end gap-1 shrink-0">
                                                {isEditMode && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleRemoveEmployeeFromSite(emp.id); }}
                                                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition shrink-0"
                                                        title="Quitar de esta sucursal"
                                                    >
                                                        <UserMinus size={16} />
                                                    </button>
                                                )}
                                                <ContractStatusBadge
                                                    estado={getEmployeeWorstContractState(emp.id)}
                                                    contrato={getEmployeeActiveContrato(emp.id)}
                                                />
                                            </div>
                                        </div>
                                    </td>
                                    {days.map(day => {
                                        const status = getCellStatus(emp.id, day);
                                        const dateStr = formatDateKey(day);
                                        const isConflict = conflictingCells.has(`${emp.id}_${dateStr}`);
                                        const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                                        return (
                                            <td
                                                key={day.toISOString()}
                                                onMouseDown={() => handleCellMouseDown(emp.id, day, status.type)}
                                                onMouseEnter={() => handleCellMouseEnter(emp.id, day)}
                                                onClick={() => handleCellClick(emp.id, day)}
                                                className={`
                                            p-1 text-center border-r border-slate-50 cursor-pointer transition-all duration-200
                                            ${isEditMode ? 'hover:bg-blue-50 cursor-crosshair' : 'hover:bg-slate-100'}
                                            ${isWeekend && status.type === 'empty' ? 'bg-red-50/30' : ''}
                                        `}
                                            >
                                                <div className={`w-full h-10 flex items-center justify-center rounded-lg relative group pointer-events-none ${isConflict ? 'ring-2 ring-red-500 bg-red-50' : ''}`}>
                                                    {isConflict && (
                                                        <div className="absolute -top-1 -right-1 z-10 text-red-500 bg-white rounded-full p-px shadow-sm" title="Conflicto de turno detectado con otra instalación">
                                                            <AlertTriangle size={12} className="fill-red-100" />
                                                        </div>
                                                    )}
                                                    {status.type === 'programado' && (
                                                        <div className="w-8 h-8 flex items-center justify-center bg-blue-100 text-blue-600 rounded font-black text-sm">
                                                            X
                                                        </div>
                                                    )}
                                                    {status.type === 'noche' && (
                                                        <div className="w-8 h-8 flex items-center justify-center bg-blue-50 text-blue-700 rounded font-black text-sm border border-blue-200">
                                                            N
                                                        </div>
                                                    )}
                                                    {status.type === 'descanso' && (
                                                        <div className="w-8 h-8 flex items-center justify-center bg-emerald-50 text-emerald-700 rounded font-black text-sm border border-emerald-100 shadow-sm">
                                                            D
                                                        </div>
                                                    )}
                                                    {status.type === 'trasladado' && (
                                                        <div className="w-8 h-8 flex items-center justify-center bg-orange-50 text-orange-600 rounded font-black text-sm border border-orange-100 shadow-sm relative overflow-hidden" title="Trasladado a otra sucursal">
                                                            <ArrowRightLeft size={16} />
                                                        </div>
                                                    )}
                                                    {status.type === 'digital' && (
                                                        <div className={`w-8 h-8 flex items-center justify-center rounded border shadow-sm relative overflow-hidden ${status.programmedStatus === 'noche' ? 'bg-blue-600 border-blue-700' : 'bg-green-50 border-green-200'}`}>
                                                            <div className={`absolute top-0 right-0 w-2 h-2 rounded-full animate-pulse ${status.programmedStatus === 'noche' ? 'bg-green-400' : 'bg-green-500'}`}></div>
                                                            <Circle size={16} className={`${status.programmedStatus === 'noche' ? 'text-green-400' : 'text-green-500'}`} fill="currentColor" />
                                                        </div>
                                                    )}
                                                    {status.type === 'manual_present' && (
                                                        <div className={`w-8 h-8 flex items-center justify-center rounded border shadow-sm ${status.programmedStatus === 'noche' ? 'bg-blue-600 border-blue-700' : 'bg-green-100 border-green-300'}`}>
                                                            <CheckCircle2 size={18} className={`${status.programmedStatus === 'noche' ? 'text-green-300' : 'text-green-600'}`} />
                                                        </div>
                                                    )}
                                                    {status.type === 'manual_absent' && (
                                                        <div className="w-8 h-8 flex items-center justify-center bg-red-100 text-red-600 rounded font-black text-sm">
                                                            A
                                                        </div>
                                                    )}
                                                    {status.type === 'empty' && isEditMode && (
                                                        <div className="opacity-0 group-hover:opacity-100 text-slate-300">
                                                            <MoreHorizontal size={14} />
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}

                            {/* Agregar Colaborador Row */}
                            {selectedSiteId && (
                                <tr className="bg-slate-50/30">
                                    <td className="sticky left-0 z-20 bg-slate-50 border-r border-slate-100 p-3">
                                        <button
                                            onClick={() => setIsManageStaffOpen(true)}
                                            className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-black text-xs uppercase tracking-tighter transition group"
                                        >
                                            <div className="p-1 bg-blue-100 text-blue-600 rounded group-hover:bg-blue-600 group-hover:text-white transition">
                                                <Plus size={14} />
                                            </div>
                                            Agregar nuevo colaborador
                                        </button>
                                    </td>
                                    {days.map(day => (
                                        <td key={day.toISOString()} className="border-r border-slate-50 bg-slate-50/20"></td>
                                    ))}
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Legend / Footer Instructions */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col md:flex-row items-start md:items-center gap-6 shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-20">
                <div className="flex flex-col">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest italic">Instrucciones de Programación:</h3>
                    <p className="text-[10px] text-blue-500 font-bold uppercase mt-1 animate-pulse">💡 ¡NUEVO! Mantén el clic y arrastra para marcar varios días.</p>
                </div>

                <div className="flex items-center gap-4 text-xs font-bold text-slate-600">
                    <div className="flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100">
                        <span className="w-5 h-5 flex items-center justify-center bg-blue-100 text-blue-700 rounded text-[10px] font-black">X</span>
                        <span>Programado</span>
                    </div>
                    <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100">
                        <span className="w-5 h-5 flex items-center justify-center bg-indigo-100 text-indigo-700 rounded text-[10px] font-black">N</span>
                        <span>Turno Noche</span>
                    </div>
                    <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100">
                        <span className="w-5 h-5 flex items-center justify-center bg-emerald-100 text-emerald-700 rounded text-[10px] font-black">D</span>
                        <span>Descanso</span>
                    </div>
                    <div className="flex items-center gap-2 bg-green-50 px-3 py-1.5 rounded-lg border border-green-100">
                        <span className="w-5 h-5 flex items-center justify-center bg-green-100 text-green-700 rounded text-[10px] font-black">✓</span>
                        <span className="text-green-700">Asistió (Manual)</span>
                    </div>
                    <div className="flex items-center gap-2 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100">
                        <span className="w-5 h-5 flex items-center justify-center bg-red-100 text-red-600 rounded text-[10px] font-black">A</span>
                        <span className="text-red-700">3 Clicks: Ausente</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 text-slate-400">
                        <Eraser size={14} />
                        <span>4 Clicks: Limpiar</span>
                    </div>
                </div>

                <div className="ml-auto flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                    <span className="text-[10px] font-black text-slate-400 uppercase">Planta: {sites.find(s => s.id == selectedSiteId)?.name || '...'}</span>
                    <button
                        onClick={() => setIsManageStaffOpen(true)}
                        className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded transition"
                        title="Gestionar Dotación"
                    >
                        <Users size={16} />
                    </button>
                </div>
            </div>

            {/* Detail Modal (Read Mode) */}
            {detailModal.isOpen && detailModal.data && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative">
                        <div className="bg-blue-600 p-6 flex flex-col items-center text-white relative">
                            <button
                                onClick={() => setDetailModal(prev => ({ ...prev, isOpen: false }))}
                                className="absolute top-4 right-4 p-1 hover:bg-white/20 rounded-full transition"
                            >
                                <XCircle size={24} />
                            </button>
                            <div className="w-20 h-20 bg-white rounded-full p-1 shadow-lg mb-3">
                                <img
                                    src={detailModal.data.photoUrl || 'https://via.placeholder.com/150'}
                                    alt="Evidence"
                                    className="w-full h-full object-cover rounded-full bg-slate-200"
                                />
                            </div>
                            <h3 className="text-xl font-bold text-center">{detailModal.employeeName}</h3>
                            <div className="flex items-center gap-2 mt-2 bg-blue-700/50 px-3 py-1 rounded-full text-xs font-medium">
                                <CheckCircle2 size={14} className="text-green-300" />
                                Asistencia Digital Validada
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="flex items-start gap-3">
                                <div className="p-2 bg-slate-100 rounded-lg text-slate-500">
                                    <CalendarIcon size={20} />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400 uppercase font-bold">Fecha y Hora</p>
                                    <p className="text-slate-800 font-medium">
                                        {detailModal.data.timestamp.toDate().toLocaleDateString('es-CL', {
                                            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                                        })}
                                    </p>
                                    <p className="text-2xl font-black text-blue-600">
                                        {detailModal.data.timestamp.toDate().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3">
                                <div className="p-2 bg-slate-100 rounded-lg text-slate-500">
                                    <MapPin size={20} />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400 uppercase font-bold">Geolocalización</p>
                                    {detailModal.data.gpsLocation ? (
                                        <>
                                            <p className="text-slate-800 font-medium text-sm">Lat: {detailModal.data.gpsLocation.lat}</p>
                                            <p className="text-slate-800 font-medium text-sm">Lng: {detailModal.data.gpsLocation.lng}</p>
                                            <a
                                                href={`https://www.google.com/maps/search/?api=1&query=${detailModal.data.gpsLocation.lat},${detailModal.data.gpsLocation.lng}`}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-xs text-blue-500 hover:underline mt-1 block"
                                            >
                                                Ver en Mapa
                                            </a>
                                        </>
                                    ) : (
                                        <p className="text-slate-500 italic text-sm">No disponible</p>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
                            <button
                                onClick={() => setDetailModal(prev => ({ ...prev, isOpen: false }))}
                                className="text-sm font-bold text-slate-500 hover:text-slate-800 transition"
                            >
                                Cerrar Detalles
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Manage Staff Modal */}
            <ManageStaffModal
                isOpen={isManageStaffOpen}
                onClose={() => setIsManageStaffOpen(false)}
                currentSiteId={selectedSiteId}
                onSave={handleUpdateStaff}
            />

            {/* Modal de Entrada Manual */}
            {manualEntryPrompt && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
                        <div className="p-8 space-y-6">
                            <div className="text-center">
                                <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <CheckCircle2 size={32} />
                                </div>
                                <h3 className="text-xl font-black text-slate-800 tracking-tight">Asistencia Manual</h3>
                                <p className="text-slate-500 text-sm mt-2">
                                    Selecciona el estado del turno para esta jornada.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 gap-4">
                                <button
                                    onClick={() => {
                                        setPendingChanges(prev => ({ ...prev, [manualEntryPrompt.key]: 'asistio_manual' }));
                                        setManualEntryPrompt(null);
                                    }}
                                    className="p-6 bg-slate-50 hover:bg-emerald-50 border-2 border-slate-100 hover:border-emerald-200 rounded-2xl transition-all group text-left"
                                >
                                    <p className="font-black text-slate-700 group-hover:text-emerald-700">Turno Activo</p>
                                    <p className="text-xs text-slate-400 font-bold mt-1">El trabajador acaba de ingresar o está trabajando.</p>
                                </button>

                                <button
                                    onClick={() => {
                                        setPendingChanges(prev => ({ ...prev, [manualEntryPrompt.key]: 'asistio_manual_completed' }));
                                        setManualEntryPrompt(null);
                                    }}
                                    className="p-6 bg-slate-50 hover:bg-blue-50 border-2 border-slate-100 hover:border-blue-200 rounded-2xl transition-all group text-left"
                                >
                                    <p className="font-black text-slate-700 group-hover:text-blue-700">Turno Terminado</p>
                                    <p className="text-xs text-slate-400 font-bold mt-1">El turno ya finalizó y se registrará como completado.</p>
                                </button>
                            </div>

                            <button
                                onClick={() => setManualEntryPrompt(null)}
                                className="w-full py-4 text-slate-400 font-black uppercase tracking-widest text-xs hover:text-slate-600 transition-colors"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Fase 4: Modal de Traslado */}
            {transferModal && (
                <ShiftTransferModal
                    isOpen={transferModal.isOpen}
                    onClose={() => setTransferModal(null)}
                    colaboradorId={transferModal.colaboradorId}
                    colaboradorNombre={transferModal.colaboradorNombre}
                    colaboradorRut={transferModal.colaboradorRut}
                    sucursalOrigenId={transferModal.sucursalOrigenId}
                    sucursalOrigenNombre={transferModal.sucursalOrigenNombre}
                    fechasPreseleccionadas={[transferModal.fecha]}
                    onTransferComplete={(res) => {
                        console.log('Traslado completado:', res);
                        // El modal se cierra manualmente o se puede forzar:
                        // setTransferModal(null);
                    }}
                />
            )}
            {/* Fase 4: Modal de Acciones */}
            {actionModal && (
                <ShiftActionModal
                    isOpen={actionModal.isOpen}
                    onClose={() => setActionModal(null)}
                    shiftStatus={actionModal.shiftStatus}
                    requiereCobertura={actionModal.requiereCobertura}
                    colaboradorNombre={
                        employees.find(e => e.id === actionModal.empId)
                            ? `${employees.find(e => e.id === actionModal.empId)?.firstName} ${employees.find(e => e.id === actionModal.empId)?.lastNamePaterno}`
                            : 'Desconocido'
                    }
                    fecha={actionModal.fecha}
                    isConflict={actionModal.isConflict}
                    role={currentUser?.role}
                    onAction={async (action) => {
                        const emp = employees.find(e => e.id === actionModal.empId);
                        const site = sites.find(s => s.id == selectedSiteId);
                        if (!emp || !site) return;

                        if (action === 'delete') {
                            showConfirmation({
                                title: "Eliminar Turno",
                                message: "¿Está seguro que desea eliminar este turno? Esta acción no se puede deshacer.",
                                onConfirm: async () => {
                                    try {
                                        // ID en TurnosProgramados: prog_{siteId}_{empId}_{fecha}
                                        const turnosProgramadosId = `prog_${selectedSiteId}_${actionModal.empId}_${actionModal.fecha}`;
                                        // ID en programacion (legado): {fecha}_{empId}_{siteId}
                                        const programacionId = `${actionModal.fecha}_${actionModal.empId}_${selectedSiteId}`;
                                        await firestoreDeleteDoc(doc(db, 'TurnosProgramados', turnosProgramadosId)).catch(() => {});
                                        await firestoreDeleteDoc(doc(db, 'programacion', programacionId)).catch(() => {});
                                        // Fallback: si el shiftId guardado tiene un formato diferente
                                        if (actionModal.shiftId && actionModal.shiftId !== turnosProgramadosId && actionModal.shiftId !== programacionId) {
                                            await firestoreDeleteDoc(doc(db, 'programacion', actionModal.shiftId)).catch(() => {});
                                            await firestoreDeleteDoc(doc(db, 'TurnosProgramados', actionModal.shiftId)).catch(() => {});
                                        }
                                        // Limpiar el warning de conflicto para esta fecha
                                        await clearConflictForDate(actionModal.empId, actionModal.fecha);
                                        setActionModal(null);
                                    } catch (e) {
                                        console.error("Error al eliminar el turno:", e);
                                    }
                                }
                            });
                        } else if (action === 'force_assign') {
                            // turnoIdA/B en ConflictWarnings son IDs de TurnosProgramados con formato: prog_{sucursalId}_{empId}_{fecha}
                            const conflictInfo = activeConflictWarnings
                                .flatMap(w => w.conflictos)
                                .find((c: any) => c.fecha === actionModal.fecha);
                            
                            if (conflictInfo) {
                                // Determinar cuál turno pertenece a la OTRA sucursal usando sucursalIdA/B
                                const currentSiteStr = String(selectedSiteId);
                                let otherShiftId = '';
                                let otherSucursalNombre = '';
                                if (String(conflictInfo.sucursalIdA) !== currentSiteStr) {
                                    otherShiftId = conflictInfo.turnoIdA;
                                    otherSucursalNombre = conflictInfo.sucursalNombreA || '';
                                } else {
                                    otherShiftId = conflictInfo.turnoIdB;
                                    otherSucursalNombre = conflictInfo.sucursalNombreB || '';
                                }

                                if (otherShiftId) {
                                    showConfirmation({
                                        title: "Asignación Forzada",
                                        message: `Se eliminará el turno en "${otherSucursalNombre || 'la otra sucursal'}" y se conservará el turno actual. ¿Desea continuar?`,
                                        onConfirm: async () => {
                                            try {
                                                // otherShiftId es el ID de TurnosProgramados: prog_{siteId}_{empId}_{fecha}
                                                // El ID en programacion (legado) es: {fecha}_{empId}_{siteId}
                                                const parts = otherShiftId.replace(/^prog_/, '').split('_');
                                                // parts = [siteId, ...empIdParts, fecha] — la fecha está al final YYYY-MM-DD
                                                const otherFecha = parts[parts.length - 1];
                                                const otherSiteIdFromId = parts[0];
                                                const otherEmpIdFromId = parts.slice(1, -1).join('_');
                                                const otherLegacyId = `${otherFecha}_${otherEmpIdFromId}_${otherSiteIdFromId}`;
                                                await firestoreDeleteDoc(doc(db, 'TurnosProgramados', otherShiftId)).catch(() => {});
                                                await firestoreDeleteDoc(doc(db, 'programacion', otherLegacyId)).catch(() => {});
                                                // Limpiar el warning de conflicto para esta fecha
                                                await clearConflictForDate(actionModal.empId, actionModal.fecha);
                                                setActionModal(null);
                                            } catch (e) {
                                                console.error("Error al forzar la asignación:", e);
                                            }
                                        }
                                    });
                                } else {
                                    alert("No se pudo localizar el turno de la otra sucursal.");
                                }
                            } else {
                                alert("No se encontró información de conflicto para esta fecha. Intente recargar la página.");
                            }
                        } else if (action === 'transfer') {
                            setTransferModal({
                                isOpen: true,
                                colaboradorId: emp.id,
                                colaboradorNombre: `${emp.firstName} ${emp.lastNamePaterno}`,
                                colaboradorRut: emp.rut,
                                sucursalOrigenId: site.id,
                                sucursalOrigenNombre: site.name,
                                fecha: actionModal.fecha,
                            });
                        } else if (action === 'additional') {
                            setAdditionalModal({
                                isOpen: true,
                                colaboradorId: emp.id,
                                colaboradorNombre: `${emp.firstName} ${emp.lastNamePaterno}`,
                                fecha: actionModal.fecha
                            });
                        } else if (action === 'coverage') {
                            if (actionModal.shiftId) {
                                setCoverageModal({
                                    isOpen: true,
                                    vacanteTurnoId: actionModal.shiftId,
                                    sucursalId: site.id,
                                    fecha: actionModal.fecha
                                });
                            }
                        } else if (action === 'revert') {
                            if (actionModal.shiftId) {
                                showConfirmation({
                                    title: "Revertir Traslado",
                                    message: "¿Seguro que desea revertir este traslado? Esta acción intentará cancelar el turno destino y restaurar el turno origen.",
                                    onConfirm: async () => {
                                        try {
                                            const { getFunctions, httpsCallable } = await import('firebase/functions');
                                            const fns = getFunctions();
                                            const revertShiftTransfer = httpsCallable(fns, 'revertShiftTransfer');
                                            const res = await revertShiftTransfer({
                                                turnoOrigenId: actionModal.shiftId,
                                                motivo: 'Reversión solicitada desde UI'
                                            });
                                            const data = res.data as any;
                                            if (data.success) {
                                                console.log("Traslado revertido con éxito.");
                                            } else {
                                                alert(data.errorMessage || "Error al revertir.");
                                            }
                                        } catch (e: any) {
                                            console.error(e);
                                            alert(e.message || "Error de red.");
                                        }
                                    }
                                });
                            }
                        }
                    }}
                />
            )}

            {additionalModal && (
                <AdditionalShiftModal
                    isOpen={additionalModal.isOpen}
                    onClose={() => setAdditionalModal(null)}
                    colaboradorId={additionalModal.colaboradorId}
                    colaboradorNombre={additionalModal.colaboradorNombre}
                    fecha={additionalModal.fecha}
                />
            )}

            {/* Modal Informativo de Turno (solo lectura) */}
            {infoModal && (() => {
                const emp = employees.find(e => e.id === infoModal.empId);
                const site = sites.find(s => s.id == selectedSiteId);
                return (
                    <ShiftInfoModal
                        isOpen={infoModal.isOpen}
                        onClose={() => setInfoModal(null)}
                        colaboradorNombre={emp ? `${emp.firstName} ${emp.lastNamePaterno}` : 'Desconocido'}
                        colaboradorRut={emp?.rut}
                        colaboradorCargo={emp?.cargo}
                        colaboradorEmail={emp?.email}
                        fecha={infoModal.fecha}
                        shiftStatus={infoModal.shiftStatus}
                        sucursalNombre={site?.name}
                        isConflict={infoModal.isConflict}
                        shiftDetails={infoModal.shiftDetails}
                    />
                );
            })()}

            {coverageModal && (
                <VacancyCoverageModal
                    isOpen={coverageModal.isOpen}
                    onClose={() => setCoverageModal(null)}
                    vacanteTurnoId={coverageModal.vacanteTurnoId}
                    sucursalId={coverageModal.sucursalId}
                    fecha={coverageModal.fecha}
                />
            )}

            {summaryModalState.isOpen && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-2xl">
                            <h2 className="text-xl font-black text-slate-800">Resumen de Guardado</h2>
                            <button onClick={() => setSummaryModalState({ isOpen: false })} className="text-slate-400 hover:text-slate-600">
                                <XCircle size={24} />
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
                            <div className="grid grid-cols-3 gap-4">
                                <div className="bg-green-50 rounded-xl p-4 border border-green-100 text-center">
                                    <div className="text-3xl font-black text-green-600">{summaryModalState.result?.success || 0}</div>
                                    <div className="text-xs font-bold text-green-700 uppercase mt-1">Exitosos</div>
                                </div>
                                <div className="bg-orange-50 rounded-xl p-4 border border-orange-100 text-center">
                                    <div className="text-3xl font-black text-orange-600">
                                        {(summaryModalState.result?.conflicts.length || 0) + (summaryModalState.contractAlerts?.length || 0)}
                                    </div>
                                    <div className="text-xs font-bold text-orange-700 uppercase mt-1">Conflictos</div>
                                </div>
                                <div className="bg-red-50 rounded-xl p-4 border border-red-100 text-center">
                                    <div className="text-3xl font-black text-red-600">{summaryModalState.result?.technicalErrors.length || 0}</div>
                                    <div className="text-xs font-bold text-red-700 uppercase mt-1">Errores Técnicos</div>
                                </div>
                            </div>

                            {summaryModalState.conflictCheckPending && (
                                <div className="bg-blue-50 text-blue-800 text-sm p-4 rounded-xl border border-blue-200 shadow-sm flex flex-col items-center justify-center">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                        <h3 className="font-black uppercase text-blue-900">Guardado exitoso, verificando...</h3>
                                    </div>
                                    <p className="text-center mt-1">La planificación se ha guardado correctamente. El sistema está verificando posibles conflictos de solapamiento en segundo plano. Si se detectan, aparecerán como advertencias en la parte superior.</p>
                                </div>
                            )}

                            {(summaryModalState.contractAlerts && summaryModalState.contractAlerts.length > 0) && (
                                <div>
                                    <h3 className="text-sm font-black text-slate-800 uppercase mb-3 flex items-center gap-2">
                                        <AlertTriangle size={16} className="text-yellow-500" /> Alertas Contractuales (Canary)
                                    </h3>
                                    <ul className="space-y-2">
                                        {summaryModalState.contractAlerts.map((msg: string, idx: number) => (
                                            <li key={idx} className="bg-yellow-50/50 text-yellow-800 text-sm p-3 rounded-lg border border-yellow-200 font-medium shadow-sm">
                                                {msg}
                                            </li>
                                        ))}
                                    </ul>
                                    <p className="mt-3 text-xs text-slate-500 bg-slate-100 p-2 rounded-lg">
                                        En la etapa actual (Canary) puedes programar de todas formas. RRHH será notificado a través de la bitácora de excepciones de fase Shadow.
                                    </p>
                                </div>
                            )}

                            {summaryModalState.result && summaryModalState.result.conflicts.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-black text-slate-800 uppercase mb-3 flex items-center gap-2">
                                        <AlertTriangle size={16} className="text-orange-500" /> Conflictos de Programación
                                    </h3>
                                    <ul className="space-y-2">
                                        {summaryModalState.result.conflicts.map((msg: string, idx: number) => (
                                            <li key={idx} className="bg-orange-50/50 text-orange-800 text-sm p-3 rounded-lg border border-orange-100">{msg}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {summaryModalState.result && summaryModalState.result.technicalErrors.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-black text-slate-800 uppercase mb-3 flex items-center gap-2">
                                        <AlertCircle size={16} className="text-red-500" /> Errores Técnicos
                                    </h3>
                                    <ul className="space-y-2">
                                        {summaryModalState.result.technicalErrors.map((msg: string, idx: number) => (
                                            <li key={idx} className="bg-red-50/50 text-red-800 text-sm p-3 rounded-lg border border-red-100">{msg}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-end">
                            <button
                                onClick={() => setSummaryModalState({ isOpen: false })}
                                className="px-6 py-2 bg-slate-700 text-white hover:bg-slate-800 font-bold rounded-lg transition-colors shadow-sm"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ShiftManagement;
