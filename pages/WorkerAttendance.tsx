
import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  CheckCircle,
  MapPin,
  Clock,
  RefreshCw,
  LogOut,
  Loader2,
  AlertCircle,
  ClipboardList,
  Settings,
  User,
  ArrowLeft,
  Phone,
  Home,
  ShieldCheck,
  Menu,
  X,
  Building2,
  FileCheck,
  ChevronRight,
  UserCircle,
  Info,
  Zap,
  Calendar,
  Lock,
  MapPinOff,
  Timer,
  AlertTriangle,
  Play,
  Square
} from 'lucide-react';

import SignatureCanvas from 'react-signature-canvas';
import { PenTool, FileText } from 'lucide-react';
import DocumentsPage from './DocumentsPage';
import { GlobalOverlay } from '../components/GlobalOverlay';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, getDoc, onSnapshot, doc as firestoreDoc, limit, updateDoc, setDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';

import RoundsControl from '../components/RoundsControl';
import MarketTurnos from '../components/MarketTurnos';
import { evaluateNocturnalClosure } from '../lib/phase5/nocturnalClosure';
import MyExtraShifts from '../components/MyExtraShifts';
import MyFixedShifts from '../components/MyFixedShifts';
import AppUpdateBanner, { APP_VERSION } from '../components/AppUpdateBanner';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { toAbsoluteMinutes } from '../lib/phase5/shadowResolver';


// ── Constantes de horarios de turno ───────────────────────────────────────
// Resolver Shadow trasladado al backend en Subfase 5B.3───────────────────────────────────────
const SHIFT_SCHEDULES: Record<string, { inicio: string; termino: string }> = {
  programado: { inicio: '07:30', termino: '19:30' },
  noche:      { inicio: '19:30', termino: '07:30' },
};


const WorkerAttendance: React.FC = () => {
  const currentUser = useAppStore(state => state.currentUser);
  const fetchAttendanceLogs = useAppStore(state => state.fetchAttendanceLogs);
  const guardRounds = useAppStore(state => state.guardRounds);
  const fetchGuardRounds = useAppStore(state => state.fetchGuardRounds);
  const isLoading = useAppStore(state => state.isLoading);
  const employees = useAppStore(state => state.employees);
  const addAttendanceLog = useAppStore(state => state.addAttendanceLog);
  const logout = useAppStore(state => state.logout);
  const sites = useAppStore(state => state.sites);
  const updateEmployee = useAppStore(state => state.updateEmployee);
  const fetchInitialData = useAppStore(state => state.fetchInitialData);
  const registerFCMToken = useAppStore(state => state.registerFCMToken);
  const showNotification = useAppStore(state => state.showNotification);
  const showConfirmation = useAppStore(state => state.showConfirmation);
  const digitalDocuments = useAppStore(state => state.digitalDocuments);
  const employee = useAppStore(state =>
    state.currentUser ? state.employees.find(e => e.id === state.currentUser?.uid) : undefined
  );

  const pendingDocsCount = React.useMemo(() => {
    return digitalDocuments.filter(d => d.assignedTo === currentUser?.uid && d.status === 'pending').length;
  }, [digitalDocuments, currentUser]);

  const [step, setStep] = useState<'status' | 'success' | 'rounds' | 'settings' | 'documents' | 'company_docs' | 'market' | 'my_extra_shifts' | 'my_fixed_shifts'>('status');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [lastAction, setLastAction] = useState<'check_in' | 'check_out' | null>(null);

  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number, lng: number } | null>(null);

  // ── NUEVO: estados para modal de confirmación y validaciones ─────────
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showCloseConfirmModal, setShowCloseConfirmModal] = useState(false);
  const [validationStep, setValidationStep] = useState<'idle' | 'gps' | 'turno' | 'abierto' | 'done'>('idle');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationErrorType, setValidationErrorType] = useState<'gps' | 'no_turno' | 'turno_abierto' | null>(null);
  
  // ── SUCURSAL ASIGNADA DEL DÍA ────────────────────────────────────────
  const [assignedSiteId, setAssignedSiteId] = useState<string | null>(null);

  useEffect(() => {
    if (!employee) return;
    const fetchAssignedSite = async () => {
      try {
        const now = new Date();
        const isEarlyMorning = now.getHours() < 12;
        if (isEarlyMorning) {
          now.setHours(now.getHours() - 12); // Consider yesterday for night shifts if early morning
        }
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        
        const q = query(
          collection(db, 'TurnosProgramados'),
          where('employeeId', '==', employee.id),
          where('fecha', '==', dateStr),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          setAssignedSiteId(snap.docs[0].data().sucursalId || null);
        } else {
          setAssignedSiteId(null);
        }
      } catch (e) {
        console.warn("Error fetching assigned site:", e);
      }
    };
    fetchAssignedSite();
  }, [employee]);
  // ── Contador de tiempo transcurrido ──────────────────────────────────
  const [elapsedTime, setElapsedTime] = useState('00h 00m');
  const elapsedIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Profile Edit State
  const [editData, setEditData] = useState({
    firstName: '',
    lastNamePaterno: '',
    rut: '',
    direccion: '',
    phone: '',
    fechaNacimiento: ''
  });

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isSigEmpty, setIsSigEmpty] = useState(true);
  const sigCanvasRef = useRef<SignatureCanvas | null>(null);

  const handleSaveSignature = async () => {
    if (!sigCanvasRef.current || sigCanvasRef.current.isEmpty()) {
      showNotification("Por favor, dibuja tu firma antes de guardar.", "warning");
      return;
    }

    try {
      const dataUrl = sigCanvasRef.current.getCanvas().toDataURL('image/png');
      await updateEmployee(currentUser!.uid, {
        signatureUrl: dataUrl,
        signatureUpdatedAt: new Date().toISOString()
      });
      showNotification("Firma registrada con éxito.", "success");
      setIsSigEmpty(true);
    } catch (e) {
      console.error("Error saving signature:", e);
      showNotification("Error al guardar la firma.", "error");
    }
  };

  // Sincronizar resolución del canvas de "Mi Firma" con su tamaño visual real para fijar los ejes X e Y
  useEffect(() => {
    let resizeObserver: ResizeObserver | null = null;

    const syncCanvasSize = () => {
      if (step === 'settings' && sigCanvasRef.current) {
        const canvas = sigCanvasRef.current.getCanvas();
        if (canvas && canvas.parentElement) {
          const rect = canvas.parentElement.getBoundingClientRect();
          const w = Math.floor(rect.width);
          const h = Math.floor(rect.height);
          // Solo actualizar si las dimensiones difieren y son válidas
          if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
            canvas.width = w;
            canvas.height = h;
            sigCanvasRef.current.clear();
            setIsSigEmpty(true);
          }
        }
      }
    };

    if (step === 'settings') {
      const timer = setTimeout(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(syncCanvasSize);
        });
      }, 100);

      const parent = sigCanvasRef.current?.getCanvas()?.parentElement;
      if (parent) {
        resizeObserver = new ResizeObserver(() => requestAnimationFrame(syncCanvasSize));
        resizeObserver.observe(parent);
      }

      window.addEventListener('resize', syncCanvasSize);
      window.addEventListener('orientationchange', syncCanvasSize);

      return () => {
        clearTimeout(timer);
        window.removeEventListener('resize', syncCanvasSize);
        window.removeEventListener('orientationchange', syncCanvasSize);
        if (resizeObserver) resizeObserver.disconnect();
      };
    }
  }, [step, employee?.signatureUrl]);

  useEffect(() => {
    if (employee) {
      setEditData({
        firstName: employee.firstName || '',
        lastNamePaterno: employee.lastNamePaterno || '',
        rut: employee.rut || '',
        direccion: employee.direccion || '',
        phone: employee.phone || '',
        fechaNacimiento: employee.fechaNacimiento || ''
      });
    }
  }, [employee]);

  // ── Determinar si hay turno abierto (usando el nuevo campo estado) ──
  const activeAttendance = useAppStore(state => {
    const empId = state.currentUser?.uid;
    if (!empId) return undefined;
    return state.attendanceLogs.find(
      l => l.employeeId === empId && l.type === 'check_in' && l.estado === 'ABIERTO'
    );
  });

  // Fallback: si no hay 'estado' (registros antiguos), usar la lógica previa
  const lastLog = useAppStore(state => {
    const empId = state.currentUser?.uid;
    if (!empId) return undefined;
    return state.attendanceLogs
      .filter(l => l.employeeId === empId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
  });

  const isCheckedIn = activeAttendance !== undefined || (lastLog?.type === 'check_in' && lastLog?.estado !== 'CERRADO' && lastLog?.status !== 'completed');

  const activeLog = activeAttendance || (isCheckedIn ? lastLog : undefined);

  // ── Contador de tiempo transcurrido en vivo ─────────────────────────
  useEffect(() => {
    if (isCheckedIn && activeLog) {
      const updateElapsed = () => {
        const start = new Date(activeLog.timestamp).getTime();
        const now = Date.now();
        const diffMs = now - start;
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        setElapsedTime(`${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`);
      };
      updateElapsed();
      elapsedIntervalRef.current = setInterval(updateElapsed, 60000); // Actualizar cada minuto
      return () => {
        if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
      };
    } else {
      setElapsedTime('00h 00m');
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    }
  }, [isCheckedIn, activeLog?.timestamp]);

  // ── Ubicación ───────────────────────────────────────────────────────
  const requestLocation = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const permStatus = await Geolocation.requestPermissions();
        if (permStatus.location !== 'granted') {
          const msg = "Debes permitir el acceso a la ubicación en tu dispositivo para registrar asistencia.";
          throw new Error(msg);
        }

        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15000
        });
        const newCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(newCoords);
        return newCoords;
      } catch (err: any) {
        let msg = "Error al obtener ubicación nativa del dispositivo. Activa tu GPS.";
        if (err.message) msg = err.message;
        throw new Error(msg);
      }
    } else {
      return new Promise<{ lat: number; lng: number }>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("Tu navegador no soporta geolocalización."));
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const newCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setCoords(newCoords);
            resolve(newCoords);
          },
          (err) => {
            let msg = "Error al obtener ubicación.";
            if (err.code === 1) msg = "Debes activar el GPS y permitir el acceso a la ubicación para registrar asistencia.";
            else if (err.code === 2) msg = "Ubicación no disponible. Verifica tu señal de GPS.";
            else if (err.code === 3) msg = "Tiempo de espera agotado al obtener ubicación.";
            reject(new Error(msg));
          },
          { timeout: 10000, enableHighAccuracy: true }
        );
      });
    }
  };

  useEffect(() => {
    // Solo cargamos logs al montar para tener el historial inicial
    fetchAttendanceLogs();
    fetchGuardRounds();

    // Intentar obtener ubicación inicial sin bloquear
    requestLocation().catch(() => {
      console.log("Ubicación inicial no obtenida. Se solicitará al confirmar.");
    });

    // LISTENER PARA CIERRE FORZADO DE SESIÓN
    if (currentUser?.uid) {
      let isInitialSnapshot = true;
      const unsub = onSnapshot(firestoreDoc(db, 'Colaboradores', currentUser.uid), (snapshot) => {
        if (isInitialSnapshot) {
          isInitialSnapshot = false;
          return;
        }
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data.forceLogout === true) {
            console.log("Sesión finalizada por el administrador.");
            logout();
          }
        }
      });
      return () => unsub();
    }
  }, [currentUser?.uid]);

  // ── MANEJO DE NOTIFICACIONES (Navegación unificada) ────────────────
  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const customEvent = event as CustomEvent;
      const type = customEvent.detail?.type;
      if (type === 'new_doc') {
        setStep('documents');
      } else if (type === 'market_turno') {
        setStep('market');
      }
    };

    window.addEventListener('app-navigate', handleNavigate);
    return () => window.removeEventListener('app-navigate', handleNavigate);
  }, []);

  // ── Obtener fecha local como YYYY-MM-DD ─────────────────────────────
  const getTodayDateStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // ══════════════════════════════════════════════════════════════════════
  // NUEVO FLUJO: INICIAR TURNO
  // ══════════════════════════════════════════════════════════════════════

  const handleIniciarTurnoPress = () => {
    setError(null);
    setValidationError(null);
    setValidationErrorType(null);
    setShowConfirmModal(true);
  };

  const handleConfirmInicio = async () => {
    setShowConfirmModal(false);
    setLoading(true);
    setValidationStep('gps');
    setValidationError(null);
    setValidationErrorType(null);

    // ── VALIDACIÓN 1: GPS ───────────────────────────────────────────
    let finalCoords = coords;
    try {
      finalCoords = await requestLocation();
    } catch (err: any) {
      setLoading(false);
      setValidationStep('idle');
      setValidationError("Debe activar la ubicación para iniciar turno.");
      setValidationErrorType('gps');
      return;
    }

    // ── VALIDACIÓN 2: TURNO PROGRAMADO ──────────────────────────────
    setValidationStep('turno');
    const dateStr = getTodayDateStr();
    let validatedShiftDoc: any = null;
    try {
      const q = query(
        collection(db, 'programacion'),
        where('employeeId', '==', employee!.id),
        where('date', '==', dateStr)
      );
      const progSnapshot = await getDocs(q);
      
      if (progSnapshot.empty) {
        setLoading(false);
        setValidationStep('idle');
        setValidationError("No existe un turno programado para hoy.\nContacte a su supervisor.");
        setValidationErrorType('no_turno');
        return;
      }

      const shiftDoc = progSnapshot.docs[0].data();
      if (shiftDoc.status === 'descanso') {
        setLoading(false);
        setValidationStep('idle');
        setValidationError("Hoy tienes programado un día de descanso.\nContacte a su supervisor si necesita trabajar.");
        setValidationErrorType('no_turno');
        return;
      }
      
      if (!shiftDoc.siteId) {
        setLoading(false);
        setValidationStep('idle');
        setValidationError("El turno programado no tiene una sucursal válida asignada.\nContacte a su supervisor.");
        setValidationErrorType('no_turno');
        return;
      }
      
      validatedShiftDoc = shiftDoc;
    } catch (err) {
      console.error("Error verificando turno programado:", err);
      setLoading(false);
      setValidationStep('idle');
      setValidationError("Error al verificar turno programado. Intente nuevamente.");
      setValidationErrorType(null);
      return;
    }

    // ── VALIDACIÓN 3: SIN TURNO ABIERTO ─────────────────────────────
    setValidationStep('abierto');
    try {
      // Buscar turnos abiertos de este empleado
      const qOpen = query(
        collection(db, 'Asistencia'),
        where('employeeId', '==', employee!.id),
        where('type', '==', 'check_in'),
        where('estado', '==', 'ABIERTO'),
        limit(5)
      );
      const openSnapshot = await getDocs(qOpen);

      if (!openSnapshot.empty) {
        // Verificar si es del mismo día o de otro día
        const openDoc = openSnapshot.docs[0];
        const openData = openDoc.data();
        const openDate = new Date(openData.timestamp);
        const openDateStr = `${openDate.getFullYear()}-${String(openDate.getMonth() + 1).padStart(2, '0')}-${String(openDate.getDate()).padStart(2, '0')}`;

        if (openDateStr === dateStr) {
          // Mismo día — no permitir
          setLoading(false);
          setValidationStep('idle');
          setValidationError("Ya existe un turno abierto.");
          setValidationErrorType('turno_abierto');
          return;
        } else {
          // 🌚 HOTFIX NOCTURNO (Fase 5B.5) 🌚
          let turnoProgramadoData = null;
          let legacyProgramacionData = null;

          if (openData.turnoProgramadoId) {
            try {
              const tpSnap = await getDoc(firestoreDoc(db, 'TurnosProgramados', openData.turnoProgramadoId));
              if (tpSnap.exists()) {
                turnoProgramadoData = tpSnap.data();
              }
            } catch (e) {
              console.warn("Error resolviendo Hotfix Nocturno (TurnosProgramados):", e);
            }
          } else if (openData.shiftId) {
            // Si todavía no tiene turnoProgramadoId resuelto, buscamos la programación legacy
            try {
              const progSnap = await getDoc(firestoreDoc(db, 'programacion', openData.shiftId));
              if (progSnap.exists()) {
                legacyProgramacionData = progSnap.data();
              }
            } catch (e) {
              console.warn("Error resolviendo Hotfix Nocturno (programacion legacy):", e);
            }
          }
          
          const now = new Date();
          const nowTimeStr = now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
          
          const hasOpenShiftDifferentDay = evaluateNocturnalClosure(
            openData,
            turnoProgramadoData,
            legacyProgramacionData,
            now.getTime(),
            nowTimeStr,
            dateStr
          );
          
          if (hasOpenShiftDifferentDay) {
            console.log("[SEGURIDAD] Cerrando turno anterior de otro día:", openDoc.id);
            const nowIso = now.toISOString();
          
          // Cerrar todos los turnos abiertos de otros días
          for (const docSnap of openSnapshot.docs) {
            const data = docSnap.data();
            const docRef = firestoreDoc(db, 'Asistencia', docSnap.id);
            
            // Usar updateDoc estático
            
            await updateDoc(docRef, {
              estado: 'CERRADO',
              tipoCierre: 'AUTOMATICO_POR_NUEVA_ENTRADA',
              horaSalidaReal: nowIso,
              status: 'completed',
              endTime: nowIso,
              detalle: 'cierre forzado',
            });

            // Crear check_out automático
            const checkOutId = `att_auto_new_${Date.now()}_${docSnap.id}`;
            await setDoc(firestoreDoc(db, 'Asistencia', checkOutId), {
              ...data,
              id: checkOutId,
              type: 'check_out',
              timestamp: nowIso,
              status: 'completed',
              isManual: false,
              systemNote: 'Cierre automático por nueva entrada en otro día',
              tipoCierre: 'AUTOMATICO_POR_NUEVA_ENTRADA',
              estado: 'CERRADO',
              horaSalidaReal: now,
              detalle: 'cierre forzado',
            });

            // Sincronizar asistencia_manual
            let prevDateStr = data.localDate || '';
            if (data.shiftId && typeof data.shiftId === 'string' && data.shiftId.includes('_')) {
              const parts = data.shiftId.split('_');
              const datePart = parts[parts.length - 1];
              if (datePart.match(/^\d{4}-\d{2}-\d{2}$/)) {
                prevDateStr = datePart;
              }
            }
            if (!prevDateStr) {
              const startObj = new Date(data.timestamp);
              prevDateStr = `${startObj.getFullYear()}-${String(startObj.getMonth() + 1).padStart(2, '0')}-${String(startObj.getDate()).padStart(2, '0')}`;
            }
            const siteId = data.siteId || 'sin_sucursal';
            const digId = `${siteId}_${data.employeeId}_${prevDateStr}`;
            try { await deleteDoc(firestoreDoc(db, 'asistencia_digital', digId)); } catch (e) {}
            
            const manualDocId = `manual_${data.employeeId}_${prevDateStr}`;
            await setDoc(firestoreDoc(db, 'asistencia_manual', manualDocId), {
              employeeId: data.employeeId,
              date: prevDateStr,
              status: 'presente',
              type: 'auto_checkout_new_entry',
              updatedAt: Timestamp.fromDate(new Date()),
            }, { merge: true });
          }
          
          showNotification("Turno anterior cerrado automáticamente.", "info");
          } // Cierra if (hasOpenShiftDifferentDay)
        }
      }
    } catch (err) {
      console.error("Error verificando turno abierto:", err);
      // Continuar igualmente — no bloquear por error de lectura
    }

    // ── REGISTRAR ASISTENCIA ────────────────────────────────────────
    setValidationStep('done');
    try {
      const now = new Date();
      const dateStr = getTodayDateStr();
      const actionTimestamp = now.toISOString();
      
      const shiftStatus = validatedShiftDoc?.status || 'programado';
      const schedule = SHIFT_SCHEDULES[shiftStatus] || SHIFT_SCHEDULES.programado;
      
      const shiftSiteId = validatedShiftDoc?.siteId ? String(validatedShiftDoc.siteId) : null;
      if (!shiftSiteId) {
        throw new Error("No se pudo determinar la sucursal del turno programado.");
      }

      const shiftId = `prog_${shiftSiteId}_${employee!.id}_${dateStr}`;

      await addAttendanceLog({
        employeeId: employee!.id,
        employeeName: `${employee!.firstName} ${employee!.lastNamePaterno}`,
        rut: employee!.rut,
        type: 'check_in',
        timestamp: actionTimestamp,
        locationLat: finalCoords!.lat,
        locationLng: finalCoords!.lng,
        siteId: isNaN(Number(shiftSiteId)) ? shiftSiteId : Number(shiftSiteId),
        siteName: sites.find(s => s.id.toString() === shiftSiteId)?.name || 'Sin Sucursal',
        shiftId: shiftId,
        localDate: dateStr,
        // Nuevos campos
        turnoProgramadoInicio: schedule.inicio,
        turnoProgramadoTermino: schedule.termino,
        turnoProgramadoStatus: shiftStatus,
        estado: 'ABIERTO',
        detalle: 'APP MOVIL',
      } as any);

      setLastAction('check_in');
      setStep('success');
      setLoading(false);
      setValidationStep('idle');

      // Refrescar logs
      fetchAttendanceLogs();

      setTimeout(() => {
        setStep('status');
      }, 3000);

    } catch (err: any) {
      console.error("Error en submitAttendance:", err);
      setError("Error al guardar registro. " + (err.message || ''));
      setLoading(false);
      setValidationStep('idle');
    }
  };

  // ══════════════════════════════════════════════════════════════════════
  // CIERRE MANUAL
  // ══════════════════════════════════════════════════════════════════════

  const handleCerrarTurnoPress = () => {
    setShowCloseConfirmModal(true);
  };

  const handleConfirmCierre = async () => {
    setShowCloseConfirmModal(false);
    if (!employee || !activeLog) return;
    setLoading(true);
    setError(null);

    let finalCoords = coords;
    if (!finalCoords) {
      try {
        finalCoords = await requestLocation();
      } catch (err: any) {
        setLoading(false);
        setError("Debe activar la ubicación para cerrar turno.");
        return;
      }
    }

    try {
      const now = new Date();
      const dateStr = getTodayDateStr();
      const actionTimestamp = now.toISOString();

      await addAttendanceLog({
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastNamePaterno}`,
        rut: employee.rut,
        type: 'check_out',
        timestamp: actionTimestamp,
        locationLat: finalCoords!.lat,
        locationLng: finalCoords!.lng,
        siteId: employee.currentSiteId ?? null,
        siteName: sites.find(s => s.id === employee.currentSiteId)?.name || 'Sin Sucursal',
        shiftId: activeLog.shiftId || null,
        localDate: dateStr,
        // Campos de cierre
        horaSalidaReal: actionTimestamp,
        tipoCierre: 'MANUAL',
        estado: 'CERRADO',
        detalle: 'APP MOVIL',
      } as any);

      // Actualizar el check_in original como CERRADO
      try {
        await updateDoc(firestoreDoc(db, 'Asistencia', activeLog.id), {
          estado: 'CERRADO',
          tipoCierre: 'MANUAL',
          horaSalidaReal: actionTimestamp,
          status: 'completed',
          endTime: actionTimestamp,
        });
      } catch (e) {
        console.warn("No se pudo actualizar check_in previo:", e);
      }

      setLastAction('check_out');
      setStep('success');
      setLoading(false);

      fetchAttendanceLogs();

      setTimeout(() => {
        setStep('status');
      }, 3000);

    } catch (err: any) {
      console.error("Error en cierre manual:", err);
      setError("Error al cerrar turno. " + (err.message || ''));
      setLoading(false);
    }
  };

  // ── Profile ─────────────────────────────────────────────────────────
  const handleUpdateProfile = async () => {
    if (!employee) return;
    setLoading(true);
    try {
      await updateEmployee(employee.id, {
        firstName: editData.firstName,
        lastNamePaterno: editData.lastNamePaterno,
        rut: editData.rut,
        direccion: editData.direccion,
        phone: editData.phone,
        fechaNacimiento: editData.fechaNacimiento
      });
      setIsEditing(false);
      setError(null);
    } catch (err) {
      console.error("Error al actualizar perfil:", err);
      setError("Error al actualizar perfil.");
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      setError("Por favor completa todos los campos de contraseña.");
      return;
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setError("Las contraseñas nuevas no coinciden.");
      return;
    }
    if (passwordData.newPassword.length < 6) {
      setError("La nueva contraseña debe tener al menos 6 caracteres.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user || !user.email) {
        throw new Error("No hay usuario autenticado.");
      }
      const credential = EmailAuthProvider.credential(user.email, passwordData.currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, passwordData.newPassword);

      // Actualizar la contraseña en la base de datos para que el administrador la vea
      if (employee) {
        await updateEmployee(employee.id, { tempPasswordLog: passwordData.newPassword });
      }

      showNotification("Contraseña actualizada exitosamente", "success");
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setIsChangingPassword(false);
    } catch (err: any) {
      console.error("Error al cambiar contraseña:", err);
      if (err.code === 'auth/invalid-credential') {
        setError("La contraseña actual es incorrecta.");
      } else {
        setError("Error al actualizar la contraseña: " + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Loading guard ───────────────────────────────────────────────────
  if (!employee && (isLoading || employees.length === 0)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={48} className="text-blue-600 animate-spin" />
          <p className="text-slate-400 font-bold animate-pulse">Cargando perfil...</p>
        </div>
      </div>
    );
  }

  if (!employee) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white p-8 rounded-3xl shadow-xl text-center">
        <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-800">Error de Perfil</h2>
        <p className="text-slate-500">No se encontró tu ficha de empleado. Contacta a soporte.</p>
        <button onClick={logout} className="mt-6 text-blue-600 font-bold">Cerrar Sesión</button>
      </div>
    </div>
  );

  const resolvedSiteId = activeLog?.siteId || assignedSiteId || employee?.currentSiteId;
  const currentSite = sites.find(s => s.id === resolvedSiteId);
  const displayShortName = employee ? `${employee.firstName} ${employee.lastNamePaterno.charAt(0).toUpperCase()}.` : '';

  // Horario del turno activo
  const activeShiftSchedule = activeLog?.turnoProgramadoStatus
    ? SHIFT_SCHEDULES[activeLog.turnoProgramadoStatus] || SHIFT_SCHEDULES.programado
    : null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">

      {/* ══ HEADER SECTION ══════════════════════════════════════════════ */}
      {step !== 'settings' && (
        <div className={`bg-gradient-to-br from-blue-700 to-blue-900 text-white relative overflow-hidden transition-all duration-200 ease-out will-change-transform transform-gpu shadow-2xl ${step === 'rounds' || step === 'market' ? 'p-3 rounded-b-[1.5rem]' : 'p-6 pb-12 rounded-b-[3rem]'}`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl pointer-events-none"></div>
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-blue-400/10 rounded-full -ml-12 -mb-12 blur-xl pointer-events-none"></div>

          <div className={`flex justify-between items-start relative z-10 transition-all duration-200 ease-out will-change-[transform,opacity] ${step === 'rounds' || step === 'market' ? 'opacity-0 scale-95 pointer-events-none absolute h-0 overflow-hidden' : 'opacity-100 scale-100'}`}>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="w-12 h-12 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center transition-all active:scale-95 relative"
              >
                <Menu size={24} />
                {pendingDocsCount > 0 && (
                  <span className="absolute top-2 right-2 w-3 h-3 bg-amber-500 border-2 border-blue-800 rounded-full animate-ping"></span>
                )}
              </button>
              <div>
                <h1 className="text-sm font-black tracking-tighter opacity-70">GGSS SECURITY</h1>
                <p className="text-xl font-bold leading-tight">{employee.firstName}</p>
              </div>
            </div>

            <div className="w-14 h-14">
              <img src="/logo-transparencia.png" alt="GGSS" className="w-full h-full object-contain" width="56" height="56" />
            </div>
          </div>

          <div className={`bg-blue-950/40 p-4 rounded-2xl flex items-center gap-4 backdrop-blur-sm border border-white/10 transition-all duration-200 ease-out will-change-[transform,opacity] ${step === 'rounds' || step === 'market' ? 'opacity-0 scale-90 invisible pointer-events-none absolute h-0 overflow-hidden' : 'opacity-100 scale-100 visible mt-8'}`}>
            <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center text-blue-300">
              <MapPin size={22} />
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-blue-300 uppercase font-black tracking-widest leading-none mb-1">Sucursal Asignada</p>
              <p className="font-bold text-sm line-clamp-1">{currentSite?.name || 'SIN ASIGNACIÓN'}</p>
            </div>
          </div>

          {/* Mini version for Rounds/Market */}
          {(step === 'rounds' || step === 'market') && (
            <div className="flex items-center justify-center py-1 mt-1 animate-in fade-in duration-200 zoom-in-95 will-change-transform">
              <div className="w-10 h-10 bg-amber-400/20 rounded-xl flex items-center justify-center text-amber-400 border border-amber-400/30">
                {step === 'market' ? <Zap size={24} /> : <ShieldCheck size={24} />}
              </div>
              <h1 className="ml-3 text-sm font-black tracking-widest opacity-90 uppercase">
                {step === 'market' ? 'Solicitudes Turnos Extra' : 'Monitoreo Activo'}
              </h1>
            </div>
          )}
        </div>
      )}

      {/* ══ MAIN ACTION AREA ════════════════════════════════════════════ */}
      <div className={`flex-1 transition-all duration-200 ease-out will-change-transform ${step === 'rounds' || step === 'market' ? 'mt-2' : (step === 'settings' ? 'mt-0' : '-mt-6')} px-6 relative z-20 overflow-y-auto pb-10`}>

        {step === 'status' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-500 h-full flex flex-col items-center justify-center min-h-[400px] w-full">
            {pendingDocsCount > 0 && (
              <button
                onClick={() => setStep('documents')}
                className="w-full max-w-sm p-4 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-[2rem] text-left flex items-center gap-4 transition-all active:scale-95 shadow-sm animate-bounce"
              >
                <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center shrink-0">
                  <FileText size={24} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">Firma Pendiente</p>
                  <p className="text-sm font-black text-amber-900 mt-0.5">
                    Tiene {pendingDocsCount} {pendingDocsCount === 1 ? 'documento pendiente' : 'documentos pendientes'} de firma.
                  </p>
                </div>
                <ChevronRight className="text-amber-500" size={20} />
              </button>
            )}

            {!isCheckedIn ? (
              /* ══ INICIAR TURNO VIEW ══ */
              <div className="w-full max-w-sm space-y-4">
                <div className="text-center mb-6">
                  <div className="px-4 py-1.5 rounded-full inline-block text-[10px] font-black tracking-widest uppercase mb-2 bg-slate-200 text-slate-500">
                    Turno cerrado
                  </div>
                  <h2 className="text-4xl font-black text-slate-800 tracking-tighter uppercase">Inicia tu Jornada</h2>
                </div>

                {/* Error de validación */}
                {validationError && (
                  <div className="bg-red-50 p-5 rounded-3xl border border-red-100 animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className="flex items-start gap-3">
                      {validationErrorType === 'gps' ? (
                        <MapPinOff size={24} className="text-red-500 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle size={24} className="text-red-500 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <p className="text-sm font-bold text-red-700 whitespace-pre-line">{validationError}</p>
                        {validationErrorType === 'gps' && (
                          <button
                            onClick={async () => {
                              setValidationError(null);
                              setValidationErrorType(null);
                              try {
                                await requestLocation();
                                showNotification("Ubicación obtenida correctamente", "success");
                              } catch (e) {
                                setValidationError("Debe activar la ubicación para iniciar turno.");
                                setValidationErrorType('gps');
                              }
                            }}
                            className="mt-3 px-4 py-2 bg-red-600 text-white rounded-xl font-bold text-xs uppercase tracking-widest active:scale-95 transition-all"
                          >
                            Activar ubicación
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Indicador de validación en progreso */}
                {loading && validationStep !== 'idle' && (
                  <div className="bg-blue-50 p-5 rounded-3xl border border-blue-100 animate-in fade-in duration-300">
                    <div className="flex items-center gap-3">
                      <Loader2 size={24} className="text-blue-600 animate-spin" />
                      <p className="text-sm font-bold text-blue-700">
                        {validationStep === 'gps' && 'Verificando ubicación...'}
                        {validationStep === 'turno' && 'Verificando turno programado...'}
                        {validationStep === 'abierto' && 'Verificando turnos activos...'}
                        {validationStep === 'done' && 'Registrando asistencia...'}
                      </p>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleIniciarTurnoPress}
                  disabled={loading}
                  className="w-full py-8 bg-emerald-500 hover:bg-emerald-600 text-white rounded-[2rem] shadow-xl shadow-emerald-200 flex flex-col items-center justify-center gap-2 transition-all active:scale-95 group border-b-8 border-emerald-700 disabled:opacity-50 disabled:pointer-events-none"
                >
                  <Play size={48} className="group-hover:scale-110 transition-transform" />
                  <span className="text-2xl font-black tracking-widest">INICIAR TURNO</span>
                </button>

                <button
                  onClick={() => setStep('market')}
                  className="w-full py-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[2rem] shadow-xl shadow-indigo-200 flex flex-col items-center justify-center gap-2 transition-all active:scale-95 group border-b-8 border-indigo-800 relative mt-4 overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-xl pointer-events-none"></div>
                  <Zap size={32} className="text-yellow-400 group-hover:scale-110 transition-transform drop-shadow-md" />
                  <span className="text-lg font-black tracking-widest">TURNOS EXTRA</span>
                  <div className="px-3 py-1 bg-white/20 rounded-full text-[10px] font-bold uppercase tracking-widest mt-1">Ver Solicitudes</div>
                </button>
              </div>
            ) : (
              /* ══ TURNO EN CURSO VIEW ══ */
              <div className="w-full max-w-sm space-y-5">
                {/* ── Tarjeta Informativa del Turno Activo ── */}
                <div className="bg-white rounded-[2rem] p-6 shadow-lg border border-slate-100 space-y-4 animate-in fade-in zoom-in-95 duration-300">
                  <div className="flex items-center justify-between">
                    <div className="px-3 py-1.5 rounded-full text-[10px] font-black tracking-widest uppercase bg-emerald-100 text-emerald-600 flex items-center gap-1.5">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                      Turno en curso
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tiempo</p>
                      <p className="text-lg font-black text-slate-800 tracking-tight tabular-nums">{elapsedTime}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Sucursal</p>
                      <p className="text-xs font-bold text-slate-700 line-clamp-2">{currentSite?.name || 'Sin asignación'}</p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Turno</p>
                      <p className="text-xs font-bold text-slate-700">
                        {activeShiftSchedule ? `${activeShiftSchedule.inicio} - ${activeShiftSchedule.termino}` : '--:-- - --:--'}
                      </p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Inicio</p>
                      <p className="text-xs font-bold text-slate-700">
                        {activeLog ? new Date(activeLog.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                      </p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Estado</p>
                      <p className="text-xs font-bold text-emerald-600">En servicio</p>
                    </div>
                  </div>
                </div>

                {/* ── Botones de Acción ── */}
                <div className="grid grid-cols-1 gap-4">
                  {currentSite?.rondasEnabled && (
                    <button
                      onClick={() => setStep('rounds')}
                      className="w-full py-6 bg-blue-600 hover:bg-blue-700 text-white rounded-[2rem] shadow-xl shadow-blue-200 flex items-center justify-center gap-3 transition-all active:scale-95 border-b-8 border-blue-800 relative"
                    >
                      <ClipboardList size={28} />
                      <span className="text-xl font-black tracking-wider text-center uppercase">MIS RONDAS </span>
                      {guardRounds.some(r => r.workerId === currentUser?.uid && r.status === 'IN_PROGRESS') && (
                        <div className="absolute top-4 right-4 w-3 h-3 bg-rose-500 rounded-full animate-ping"></div>
                      )}
                    </button>
                  )}

                  {/* Incidentes — Próximamente */}
                  <button
                    disabled
                    className="w-full py-6 bg-amber-500/60 text-white rounded-[2rem] shadow-lg flex items-center justify-center gap-3 border-b-8 border-amber-700/40 relative opacity-60 cursor-not-allowed"
                  >
                    <AlertTriangle size={28} />
                    <span className="text-xl font-black tracking-wider uppercase">INCIDENTES</span>
                    <div className="absolute top-3 right-3 px-2 py-0.5 bg-white/30 rounded-full text-[8px] font-black uppercase tracking-widest">Próximamente</div>
                  </button>

                  <button
                    onClick={() => setStep('market')}
                    className="w-full py-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[2rem] shadow-xl shadow-indigo-200 flex items-center justify-center gap-3 transition-all active:scale-95 border-b-8 border-indigo-800"
                  >
                    <Zap size={28} className="text-yellow-400" />
                    <span className="text-xl font-black tracking-wider uppercase">TURNOS EXTRA</span>
                  </button>

                  <button
                    onClick={() => setStep('documents')}
                    className="w-full py-6 bg-slate-800 hover:bg-slate-900 text-white rounded-[2rem] shadow-xl shadow-slate-200 flex items-center justify-center gap-3 transition-all active:scale-95 border-b-8 border-slate-950"
                  >
                    <ShieldCheck size={28} />
                    <span className="text-xl font-black tracking-wider uppercase">MIS DOCUMENTOS</span>
                  </button>

                  <button
                    onClick={handleCerrarTurnoPress}
                    disabled={loading}
                    className="w-full py-6 bg-red-500 hover:bg-red-600 text-white rounded-[2rem] shadow-xl shadow-red-200 flex items-center justify-center gap-3 transition-all active:scale-95 border-b-8 border-red-700 disabled:opacity-50"
                  >
                    {loading ? <Loader2 size={28} className="animate-spin" /> : <Square size={28} />}
                    <span className="text-xl font-black tracking-wider">CERRAR TURNO</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'rounds' && (
          <RoundsControl onBack={() => setStep('status')} />
        )}

        {step === 'market' && (
          <div className="bg-slate-50 min-h-screen pb-20 -mx-6">
            <div className="bg-white p-4 flex items-center gap-4 sticky top-0 z-30 shadow-sm border-b mb-4">
              <button
                onClick={() => setStep('status')}
                className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-all"
              >
                <ArrowLeft size={24} />
              </button>
              <h2 className="font-black text-slate-800 tracking-tight text-lg">Solicitudes Turnos Extra</h2>
            </div>
            <MarketTurnos />
          </div>
        )}

        {step === 'my_extra_shifts' && (
          <div className="bg-slate-50 min-h-screen pb-20 -mx-6">
            <div className="bg-white p-4 flex items-center gap-4 sticky top-0 z-30 shadow-sm border-b mb-4">
              <button
                onClick={() => setStep('status')}
                className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-all"
              >
                <ArrowLeft size={24} />
              </button>
              <h2 className="font-black text-slate-800 tracking-tight text-lg">Mis Turnos Extra</h2>
            </div>
            <MyExtraShifts />
          </div>
        )}

        {step === 'my_fixed_shifts' && (
          <div className="bg-slate-50 min-h-screen pb-20 -mx-6">
            <div className="bg-white p-4 flex items-center gap-4 sticky top-0 z-30 shadow-sm border-b mb-4">
              <button
                onClick={() => setStep('status')}
                className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-all"
              >
                <ArrowLeft size={24} />
              </button>
              <h2 className="font-black text-slate-800 tracking-tight text-lg">Mis Turnos Fijos</h2>
            </div>
            <MyFixedShifts />
          </div>
        )}

        {step === 'documents' && (
          <div className="bg-slate-50 min-h-screen pb-20 -mx-6">
            <div className="bg-white p-4 flex items-center gap-4 sticky top-0 z-30 shadow-sm border-b mb-4">
              <button
                onClick={() => setStep('status')}
                className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-all"
              >
                <ArrowLeft size={24} />
              </button>
              <h2 className="font-black text-slate-800 tracking-tight text-lg">Mis Documentos</h2>
            </div>
            <DocumentsPage />
          </div>
        )}

        {step === 'company_docs' && (
          <div className="bg-slate-50 min-h-screen pb-20 -mx-6">
            <div className="bg-white p-4 flex items-center gap-4 sticky top-0 z-30 shadow-sm border-b mb-6">
              <button
                onClick={() => setStep('status')}
                className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl transition-all"
              >
                <ArrowLeft size={24} />
              </button>
              <h2 className="font-black text-slate-800 tracking-tight text-lg">Documentos Empresa</h2>
            </div>

            <div className="px-6 space-y-6">
              <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 text-center space-y-4 shadow-sm">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto">
                  <Building2 size={32} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Biblioteca Corporativa</h3>
                  <p className="text-slate-500 font-medium">Próximamente encontrarás aquí:</p>
                </div>
                <div className="grid grid-cols-1 gap-2 pt-2">
                  <div className="p-4 bg-slate-50 rounded-2xl flex items-center gap-3 text-left">
                    <FileCheck size={20} className="text-blue-500" />
                    <span className="text-xs font-bold text-slate-600">Reglamento Interno</span>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-2xl flex items-center gap-3 text-left">
                    <ShieldCheck size={20} className="text-blue-500" />
                    <span className="text-xs font-bold text-slate-600">Directivas de Funcionamiento</span>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-2xl flex items-center gap-3 text-left">
                    <Info size={20} className="text-blue-500" />
                    <span className="text-xs font-bold text-slate-600">Manuales de Procedimiento</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="h-full flex flex-col items-center justify-center space-y-6 py-20 animate-in zoom-in-95 duration-500">
            <div className="w-32 h-32 bg-emerald-100 rounded-full flex items-center justify-center shadow-inner">
              <CheckCircle size={64} className="text-emerald-500" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-black text-slate-800 tracking-tighter uppercase leading-tight">
                {lastAction === 'check_in' ? (
                  <>¡Bienvenido <br /> <span className="text-blue-600">{displayShortName}</span>!</>
                ) : (
                  <>¡Hasta luego <br /> <span className="text-blue-600">{displayShortName}</span>!</>
                )}
              </h2>
              <p className="text-slate-400 font-bold">Tu registro se ha realizado con éxito.</p>
            </div>
            <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
              {lastAction === 'check_in' ? 'Iniciando turno...' : 'Finalizando turno...'}
            </div>
          </div>
        )}

        {step === 'settings' && (
          <div className="min-h-screen bg-slate-50 fixed inset-0 z-[100] overflow-y-auto animate-in fade-in slide-in-from-right-10 duration-500 font-sans">
            {/* Settings Header */}
            <div className="bg-white p-6 flex items-center justify-between sticky top-0 z-30 shadow-sm border-b">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => {
                    setStep('status');
                    setIsEditing(false);
                    setIsChangingPassword(false);
                    setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
                    setError(null);
                  }}
                  className="p-2 text-slate-500 hover:bg-slate-100 rounded-full transition-all"
                >
                  <ArrowLeft size={24} />
                </button>
                <div>
                  <h2 className="text-xl font-black text-slate-800 tracking-tight">Mi Perfil</h2>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none">Ajustes de Cuenta</p>
                </div>
              </div>
              {!isEditing ? (
                <button
                  onClick={() => setIsEditing(true)}
                  className="px-6 py-2 bg-blue-600 text-white rounded-full font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 active:scale-95 transition-all"
                >
                  Modificar
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-6 py-2 bg-slate-100 text-slate-500 rounded-full font-black text-xs uppercase tracking-widest active:scale-95 transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleUpdateProfile}
                    disabled={loading}
                    className="px-6 py-2 bg-emerald-500 text-white rounded-full font-black text-xs uppercase tracking-widest shadow-lg shadow-emerald-200 active:scale-95 transition-all flex items-center gap-2"
                  >
                    {loading && <Loader2 size={14} className="animate-spin" />}
                    Guardar
                  </button>
                </div>
              )}
            </div>

            <div className="p-6 pb-20 max-w-2xl mx-auto space-y-8">
              {/* Profile Card Summary */}
              <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-[2.5rem] p-8 text-white relative overflow-hidden shadow-xl shadow-blue-200">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl"></div>
                <div className="flex flex-col items-center text-center relative z-10">
                  <div className="w-24 h-24 bg-white/20 backdrop-blur-md rounded-full border-4 border-white/30 flex items-center justify-center mb-4">
                    <User size={48} className="text-white" />
                  </div>
                  <h3 className="text-2xl font-black">{employee.firstName} {employee.lastNamePaterno}</h3>
                  <p className="text-blue-100 font-bold uppercase tracking-[0.2em] text-xs opacity-80">{employee.cargo}</p>
                </div>
              </div>

              {/* Information Sections */}
              <div className="space-y-6">
                <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 space-y-6">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b pb-2">Información Personal</h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Nombre</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editData.firstName}
                          onChange={(e) => setEditData({ ...editData, firstName: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-blue-500 outline-none transition-all font-bold text-slate-700"
                        />
                      ) : (
                        <p className="px-4 py-3 bg-slate-100/50 rounded-xl font-bold text-slate-700">{employee.firstName}</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Apellido</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editData.lastNamePaterno}
                          onChange={(e) => setEditData({ ...editData, lastNamePaterno: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-blue-500 outline-none transition-all font-bold text-slate-700"
                        />
                      ) : (
                        <p className="px-4 py-3 bg-slate-100/50 rounded-xl font-bold text-slate-700">{employee.lastNamePaterno}</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">RUT</label>
                      <p className="px-4 py-3 bg-slate-100/50 rounded-xl font-bold text-slate-400">{employee.rut}</p>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Fecha de Nacimiento</label>
                      {isEditing ? (
                        <input
                          type="date"
                          value={editData.fechaNacimiento}
                          onChange={(e) => setEditData({ ...editData, fechaNacimiento: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-blue-500 outline-none transition-all font-bold text-slate-700"
                        />
                      ) : (
                        <p className="px-4 py-3 bg-slate-100/50 rounded-xl font-bold text-slate-700">
                          {employee.fechaNacimiento ? new Date(employee.fechaNacimiento).toLocaleDateString() : 'No registrada'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 space-y-6">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b pb-2">Contacto y Domicilio</h4>

                  <div className="space-y-6">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Teléfono Móvil</label>
                      {isEditing ? (
                        <div className="relative">
                          <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="tel"
                            value={editData.phone}
                            onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                            className="w-full pl-11 pr-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-blue-500 outline-none transition-all font-bold text-slate-700"
                            placeholder="+56 9..."
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 px-4 py-3 bg-slate-100/50 rounded-xl">
                          <Phone size={16} className="text-slate-400" />
                          <p className="font-bold text-slate-700">{employee.phone || 'Sin teléfono'}</p>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Dirección Particular</label>
                      {isEditing ? (
                        <div className="relative">
                          <Home size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="text"
                            value={editData.direccion}
                            onChange={(e) => setEditData({ ...editData, direccion: e.target.value })}
                            className="w-full pl-11 pr-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-blue-500 outline-none transition-all font-bold text-slate-700"
                            placeholder="Calle, Número, Comuna"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 px-4 py-3 bg-slate-100/50 rounded-xl">
                          <Home size={16} className="text-slate-400" />
                          <p className="font-bold text-slate-700">{employee.direccion || 'Sin dirección'}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* MI FIRMA SECTION */}
                <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 space-y-6">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b pb-2 flex items-center gap-2">
                    <PenTool size={14} className="text-slate-400" />
                    Mi Firma
                  </h4>

                  {employee.signatureUrl ? (
                    <div className="space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-black text-emerald-600 uppercase tracking-wider flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            Firma Registrada
                          </p>
                          {employee.signatureUpdatedAt && (
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              Última actualización: {new Date(employee.signatureUpdatedAt).toLocaleDateString()} a las {new Date(employee.signatureUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            showConfirmation({
                              title: "Actualizar Firma",
                              message: "¿Seguro que deseas actualizar tu firma? Se eliminará la firma actual y deberás dibujar una nueva.",
                              onConfirm: async () => {
                                await updateEmployee(currentUser!.uid, { signatureUrl: null, signatureUpdatedAt: null });
                                showNotification("Firma limpiada. Dibuja tu nueva firma.", "info");
                              }
                            });
                          }}
                          className="px-4 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-full font-black text-[10px] uppercase tracking-wider transition-all"
                        >
                          Actualizar Firma
                        </button>
                      </div>

                      <div className="border border-slate-100 bg-slate-50/50 rounded-2xl p-4 flex items-center justify-center">
                        <img
                          src={employee.signatureUrl}
                          alt="Mi Firma"
                          className="max-h-32 object-contain"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="bg-blue-50/50 border border-blue-100 text-blue-800 p-4 rounded-2xl flex gap-3 items-start">
                        <Info size={18} className="shrink-0 text-blue-600 mt-0.5" />
                        <p className="text-xs font-bold leading-snug">
                          Debes registrar tu firma una sola vez. Esta firma se utilizará automáticamente para firmar digitalmente todos tus contratos, anexos y documentos asignados sin tener que volver a dibujarla.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Dibuja tu firma en el recuadro:</label>
                        <div className="border-2 border-dashed border-slate-200 hover:border-slate-300 bg-slate-50 rounded-2xl overflow-hidden relative aspect-[4/3] max-w-sm mx-auto">
                          <SignatureCanvas
                            ref={sigCanvasRef}
                            canvasProps={{
                              className: 'w-full h-full cursor-crosshair'
                            }}
                            onBegin={() => setIsSigEmpty(false)}
                          />
                          {isSigEmpty && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none opacity-40">
                              <span className="text-xs font-black uppercase tracking-widest text-slate-400">Dibuja tu firma aquí</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-3 justify-end">
                        <button
                          onClick={() => {
                            if (sigCanvasRef.current) {
                              sigCanvasRef.current.clear();
                              setIsSigEmpty(true);
                            }
                          }}
                          disabled={isSigEmpty}
                          className="px-6 py-2 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-slate-600 rounded-full font-black text-xs uppercase tracking-widest active:scale-95 transition-all"
                        >
                          Limpiar
                        </button>
                        <button
                          onClick={handleSaveSignature}
                          disabled={isSigEmpty || loading}
                          className="px-6 py-2 bg-blue-600 text-white font-black text-xs uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50 rounded-full shadow-lg shadow-blue-200 active:scale-95 transition-all flex items-center gap-2"
                        >
                          {loading && <Loader2 size={14} className="animate-spin" />}
                          Guardar Firma
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 space-y-6">
                  <div className="flex justify-between items-center border-b pb-2">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                      <Lock size={14} className="text-slate-400" />
                      Seguridad
                    </h4>
                    {!isChangingPassword ? (
                      <button
                        onClick={() => setIsChangingPassword(true)}
                        className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:text-blue-700 transition-colors"
                      >
                        Cambiar Contraseña
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setIsChangingPassword(false);
                          setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
                          setError(null);
                        }}
                        className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Correo Electrónico</label>
                    <p className="px-4 py-3 bg-slate-100/50 rounded-xl font-bold text-slate-400">{employee.email || 'No registrado'}</p>
                  </div>

                  {isChangingPassword && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Contraseña Actual</label>
                        <input
                          type="password"
                          value={passwordData.currentPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-blue-500 outline-none transition-all font-bold text-slate-700"
                          placeholder="Ingresa tu contraseña actual"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Nueva Contraseña</label>
                        <input
                          type="password"
                          value={passwordData.newPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-blue-500 outline-none transition-all font-bold text-slate-700"
                          placeholder="Mínimo 6 caracteres"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Confirmar Nueva Contraseña</label>
                        <input
                          type="password"
                          value={passwordData.confirmPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-blue-500 outline-none transition-all font-bold text-slate-700"
                          placeholder="Repite la nueva contraseña"
                        />
                      </div>
                      <button
                        onClick={handleChangePassword}
                        disabled={loading}
                        className="w-full py-3 mt-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {loading && <Loader2 size={16} className="animate-spin" />}
                        Actualizar Contraseña
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <div className="bg-red-50 p-4 rounded-2xl flex items-center gap-3 text-red-600 animate-bounce">
                  <AlertCircle size={20} />
                  <span className="text-sm font-bold">{error}</span>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      <div className={`p-6 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest transition-all duration-500 ${step === 'documents' || step === 'company_docs' || step === 'market' || step === 'my_extra_shifts' || step === 'my_fixed_shifts' ? 'opacity-0 h-0 p-0 overflow-hidden' : 'opacity-50'}`}>
        GGSS Security · Aspro SPA · v{APP_VERSION}
      </div>

      {/* ══ MODAL DE CONFIRMACIÓN — INICIAR TURNO ══════════════════════ */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setShowConfirmModal(false)}></div>
          <div className="relative bg-white rounded-[2.5rem] p-8 shadow-2xl max-w-sm w-full animate-in zoom-in-95 fade-in duration-300 space-y-6">
            {/* Header */}
            <div className="text-center">
              <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Play size={32} className="text-emerald-600" />
              </div>
              <h3 className="text-xl font-black text-slate-800 tracking-tight">Confirmar Inicio de Turno</h3>
            </div>

            {/* Datos del guardia */}
            <div className="space-y-3 bg-slate-50 rounded-2xl p-5">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nombre</span>
                <span className="text-sm font-bold text-slate-700">{employee.firstName} {employee.lastNamePaterno}</span>
              </div>
              <div className="h-px bg-slate-200"></div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">RUT</span>
                <span className="text-sm font-bold text-slate-700">{employee.rut}</span>
              </div>
              <div className="h-px bg-slate-200"></div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Instalación</span>
                <span className="text-sm font-bold text-slate-700 text-right max-w-[60%]">{currentSite?.name || 'Sin asignación'}</span>
              </div>
              <div className="h-px bg-slate-200"></div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Turno</span>
                <span className="text-sm font-bold text-slate-700">
                  {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>

            {/* Mensaje */}
            <p className="text-center text-sm text-slate-600 font-medium leading-relaxed">
              <span className="font-bold text-slate-800">{employee.firstName}</span>, ¿estás seguro(a) que deseas iniciar el turno de hoy en <span className="font-bold text-blue-600">{currentSite?.name || 'tu sucursal'}</span>?
            </p>

            {/* Botones */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmInicio}
                className="flex-[2] py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg shadow-emerald-200 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle size={18} />
                Confirmar Inicio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL DE CONFIRMACIÓN — CERRAR TURNO ═══════════════════════ */}
      {showCloseConfirmModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setShowCloseConfirmModal(false)}></div>
          <div className="relative bg-white rounded-[2.5rem] p-8 shadow-2xl max-w-sm w-full animate-in zoom-in-95 fade-in duration-300 space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Square size={32} className="text-red-600" />
              </div>
              <h3 className="text-xl font-black text-slate-800 tracking-tight">Cerrar Turno</h3>
            </div>

            {activeLog && (
              <div className="space-y-3 bg-slate-50 rounded-2xl p-5">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Inicio</span>
                  <span className="text-sm font-bold text-slate-700">{new Date(activeLog.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="h-px bg-slate-200"></div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tiempo</span>
                  <span className="text-sm font-bold text-slate-700">{elapsedTime}</span>
                </div>
                <div className="h-px bg-slate-200"></div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sucursal</span>
                  <span className="text-sm font-bold text-slate-700">{activeLog.siteName}</span>
                </div>
              </div>
            )}

            <p className="text-center text-sm text-slate-600 font-medium">
              ¿Estás seguro(a) que deseas <span className="font-bold text-red-600">cerrar el turno</span>?
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowCloseConfirmModal(false)}
                className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmCierre}
                className="flex-[2] py-4 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg shadow-red-200 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Square size={18} />
                Cerrar Turno
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ SIDEBAR HAMBURGER MENU ══════════════════════════════════════ */}
      <div
        className={`fixed inset-0 z-[200] transition-all duration-500 ${isSidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'}`}
      >
        {/* Overlay */}
        <div
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
          onClick={() => setIsSidebarOpen(false)}
        ></div>

        {/* Menu Content */}
        <div
          className={`absolute inset-y-0 left-0 w-[85%] max-w-sm bg-white shadow-2xl transition-transform duration-500 ease-out flex flex-col ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          {/* Menu Header */}
          <div className="p-8 bg-gradient-to-br from-blue-700 to-blue-900 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl"></div>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-all z-50 cursor-pointer"
              title="Cerrar menú"
            >
              <X size={20} />
            </button>

            <div className="flex flex-col gap-4 relative z-10">
              <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center p-3 border border-white/20">
                <UserCircle size={40} />
              </div>
              <div>
                <h3 className="text-xl font-black tracking-tight">{employee.firstName} {employee.lastNamePaterno}</h3>
                <p className="text-blue-200 text-xs font-bold uppercase tracking-widest">{employee.cargo}</p>
              </div>
            </div>
          </div>

          {/* Menu Items */}
          <div className="flex-1 overflow-y-auto p-6 space-y-2">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 ml-2">Menú Principal</p>

            <button
              onClick={() => { setStep('my_fixed_shifts'); setIsSidebarOpen(false); }}
              className={`w-full p-4 rounded-2xl flex items-center justify-between transition-all ${step === 'my_fixed_shifts' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <div className="flex items-center gap-3">
                <Calendar size={22} className={step === 'my_fixed_shifts' ? 'text-blue-600' : 'text-slate-400'} />
                <span className="font-bold">Mis Turnos Fijos</span>
              </div>
              <ChevronRight size={16} className="opacity-30" />
            </button>

            <button
              onClick={() => { setStep('my_extra_shifts'); setIsSidebarOpen(false); }}
              className={`w-full p-4 rounded-2xl flex items-center justify-between transition-all ${step === 'my_extra_shifts' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <div className="flex items-center gap-3">
                <Zap size={22} className={step === 'my_extra_shifts' ? 'text-blue-600' : 'text-slate-400'} />
                <span className="font-bold">Mis Turnos Extra</span>
              </div>
              <ChevronRight size={16} className="opacity-30" />
            </button>

            <button
              onClick={() => { setStep('documents'); setIsSidebarOpen(false); }}
              className={`w-full p-4 rounded-2xl flex items-center justify-between transition-all ${step === 'documents' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <div className="flex items-center gap-3">
                <ShieldCheck size={22} className={step === 'documents' ? 'text-blue-600' : 'text-slate-400'} />
                <span className="font-bold">Mis Documentos</span>
                {pendingDocsCount > 0 && (
                  <span className="bg-amber-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
                    {pendingDocsCount}
                  </span>
                )}
              </div>
              <ChevronRight size={16} className="opacity-30" />
            </button>

            <button
              onClick={() => { setStep('company_docs'); setIsSidebarOpen(false); }}
              className={`w-full p-4 rounded-2xl flex items-center justify-between transition-all ${step === 'company_docs' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <div className="flex items-center gap-3">
                <Building2 size={22} className={step === 'company_docs' ? 'text-blue-600' : 'text-slate-400'} />
                <span className="font-bold">Documentos Empresa</span>
              </div>
              <ChevronRight size={16} className="opacity-30" />
            </button>

            <div className="h-px bg-slate-100 my-4"></div>

            <button
              onClick={() => { setStep('settings'); setIsSidebarOpen(false); }}
              className={`w-full p-4 rounded-2xl flex items-center justify-between transition-all ${step === 'settings' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <div className="flex items-center gap-3">
                <Settings size={22} className={step === 'settings' ? 'text-blue-600' : 'text-slate-400'} />
                <span className="font-bold">Mi Perfil</span>
              </div>
              <ChevronRight size={16} className="opacity-30" />
            </button>
          </div>

          {/* Menu Footer */}
          <div className="p-6 border-t border-slate-100">
            <button
              onClick={() => fetchInitialData(true)}
              disabled={isLoading}
              className="w-full p-4 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center gap-3 transition-all font-black text-sm uppercase tracking-widest mb-2 disabled:opacity-50"
            >
              <RefreshCw size={20} className={isLoading ? "animate-spin" : ""} />
              {isLoading ? 'Sincronizando...' : 'Recargar Datos'}
            </button>

            <button
              onClick={logout}
              className="w-full p-4 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center gap-3 transition-all font-black text-sm uppercase tracking-widest"
            >
              <LogOut size={20} />
              Cerrar Sesión
            </button>
            <p className="text-center text-[8px] font-black text-slate-300 mt-4 uppercase tracking-[0.2em]">GGSS Security v{APP_VERSION}</p>
          </div>
        </div>
      </div>
      {/* Banner de actualización APK */}
      <AppUpdateBanner />
      <GlobalOverlay />
    </div>
  );
};

export default WorkerAttendance;
