
import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  CheckCircle,
  MapPin,
  Clock,
  RefreshCw,
  LogOut,
  Delete,
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
  Info
} from 'lucide-react';

import DocumentsPage from './DocumentsPage';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

import RoundsControl from '../components/RoundsControl';


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

  const [step, setStep] = useState<'status' | 'keypad' | 'success' | 'rounds' | 'settings' | 'documents' | 'company_docs'>('status');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [lastAction, setLastAction] = useState<'check_in' | 'check_out' | null>(null);

  const [rutInput, setRutInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number, lng: number } | null>(null);

  // Profile Edit State
  const [editData, setEditData] = useState({
    firstName: '',
    lastNamePaterno: '',
    rut: '',
    direccion: '',
    phone: '',
    fechaNacimiento: ''
  });

  const employee = useAppStore(state =>
    state.currentUser ? state.employees.find(e => e.id === state.currentUser?.uid) : undefined
  );

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

  // Last log for this specific employee
  const lastLog = useAppStore(state => {
    const empId = state.currentUser?.uid;
    if (!empId) return undefined;
    return state.attendanceLogs
      .filter(l => l.employeeId === empId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
  });

  const isCheckedIn = lastLog?.type === 'check_in';

  const requestLocation = () => {
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

          setError(msg);
          reject(new Error(msg));
        },
        { timeout: 10000, enableHighAccuracy: true }
      );
    });
  };

  useEffect(() => {
    // Solo cargamos logs al montar para tener el historial inicial
    fetchAttendanceLogs();
    fetchGuardRounds();

    // Intentar obtener ubicación inicial sin bloquear
    requestLocation().catch(() => {
      console.log("Ubicación inicial no obtenida. Se solicitará al confirmar.");
    });
  }, []);


  // Format RUT helpers
  const formatRut = (rut: string) => {
    const clean = rut.replace(/[^0-9kK]/g, '');
    if (clean.length <= 1) return clean;

    let result = '';
    const body = clean.slice(0, -1);
    const dv = clean.slice(-1).toUpperCase();

    let count = 0;
    for (let i = body.length - 1; i >= 0; i--) {
      result = body.charAt(i) + result;
      count++;
      if (count === 3 && i !== 0) {
        result = '.' + result;
        count = 0;
      }
    }

    return result + '-' + dv;
  };

  const handleKeyPress = React.useCallback((num: string) => {
    setRutInput(prev => {
      if (prev.length < 9) return prev + num;
      return prev;
    });
  }, []);

  const handleBackspace = React.useCallback(() => {
    setRutInput(prev => prev.slice(0, -1));
  }, []);

  const validateRut = () => {
    if (!employee) return;
    const cleanInput = rutInput.replace(/\./g, '').replace(/-/g, '').toLowerCase();
    const cleanEmployeeRut = employee.rut.replace(/\./g, '').replace(/-/g, '').toLowerCase();

    if (cleanInput === cleanEmployeeRut) {
      setError(null);
      submitAttendance();
    } else {
      setError("RUT no coincide con el trabajador activo.");
    }
  };

  const submitAttendance = async () => {
    if (!employee) return;
    setLoading(true);
    setError(null);

    let finalCoords = coords;

    // Si no hay coordenadas, intentar obtenerlas ahora obligatoriamente
    if (!finalCoords) {
      try {
        finalCoords = await requestLocation();
      } catch (err: any) {
        setLoading(false);
        // El error ya fue seteado por requestLocation
        return;
      }
    }

    const actionType = isCheckedIn ? 'check_out' : 'check_in';

    try {
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];

      // Intentar obtener la programación de hoy para este trabajador
      const q = query(
        collection(db, 'programacion'),
        where('employeeId', '==', employee.id),
        where('date', '==', dateStr)
      );
      const progSnapshot = await getDocs(q);
      const shiftDoc = progSnapshot.docs[0];
      const shiftId = shiftDoc ? `prog_${employee.currentSiteId}_${employee.id}_${dateStr}` : null;

      await addAttendanceLog({
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastNamePaterno}`,
        rut: employee.rut,
        type: actionType,
        locationLat: finalCoords.lat,
        locationLng: finalCoords.lng,
        siteId: employee.currentSiteId ?? null,
        siteName: sites.find(s => s.id === employee.currentSiteId)?.name || 'Sin Sucursal',
        shiftId: shiftId
      } as any);

      setLastAction(actionType);
      setStep('success');

      setTimeout(() => {
        setStep('status');
        setRutInput('');
        setLoading(false);
      }, 3000);

    } catch (err: any) {
      console.error("Error en submitAttendance:", err);
      setError("Error al guardar registro. " + (err.message || ''));
      setLoading(false);
    }
  };

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

  // Show loading while fetching initial data or if employees list is still empty (bootstrapping)
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

  const currentSite = sites.find(s => s.id === employee.currentSiteId);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">

      {/* HEADER SECTION */}
      {step !== 'settings' && (
        <div className={`bg-gradient-to-br from-blue-700 to-blue-900 text-white p-6 ${step === 'keypad' ? 'pb-4 rounded-b-[2rem]' : 'pb-12 rounded-b-[3rem]'} shadow-2xl relative overflow-hidden transition-all duration-500 ease-in-out`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl"></div>
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-blue-400/10 rounded-full -ml-12 -mb-12 blur-xl"></div>

          <div className={`flex justify-between items-start relative z-10 transition-all duration-500 ${step === 'keypad' ? 'opacity-0 -translate-y-10 h-0 pointer-events-none' : 'opacity-100 translate-y-0'}`}>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="w-12 h-12 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center transition-all active:scale-95"
              >
                <Menu size={24} />
              </button>
              <div>
                <h1 className="text-sm font-black tracking-tighter opacity-70">GGSS SECURITY</h1>
                <p className="text-xl font-bold leading-tight">{employee.firstName}</p>
              </div>
            </div>

            <div className="w-14 h-14">
              <img src="/logo-transparencia.png" alt="GGSS" className="w-full h-full object-contain" />
            </div>
          </div>

          <div className={`bg-blue-950/40 p-4 rounded-2xl flex items-center gap-4 backdrop-blur-sm border border-white/10 transition-all duration-500 ${step === 'keypad' ? 'opacity-0 scale-95 -mt-16 h-0 overflow-hidden pointer-events-none' : 'opacity-100 scale-100 mt-8'}`}>
            <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center text-blue-300">
              <MapPin size={22} />
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-blue-300 uppercase font-black tracking-widest leading-none mb-1">Sucursal Asignada</p>
              <p className="font-bold text-sm line-clamp-1">{currentSite?.name || 'SIN ASIGNACIÓN'}</p>
            </div>
          </div>

          {/* Mini version for identification step */}
          {step === 'keypad' && (
            <div className="flex items-center justify-center pt-2 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="w-12 h-12">
                <img src="/logo-transparencia.png" alt="GGSS" className="w-full h-full object-contain" />
              </div>
              <h1 className="ml-3 text-sm font-black tracking-widest opacity-90 uppercase">Validación de Turno</h1>
            </div>
          )}
        </div>
      )}

      {/* MAIN ACTION AREA */}
      <div className={`flex-1 transition-all duration-500 ${step === 'keypad' ? 'mt-2' : (step === 'settings' ? 'mt-0' : '-mt-6')} px-6 relative z-20 overflow-y-auto pb-10`}>

        {step === 'status' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-500 h-full flex flex-col items-center justify-center min-h-[400px]">

            {!isCheckedIn ? (
              /* INICIAR TURNO VIEW */
              <div className="w-full max-w-sm space-y-4">
                <div className="text-center mb-6">
                  <div className="px-4 py-1.5 rounded-full inline-block text-[10px] font-black tracking-widest uppercase mb-2 bg-slate-200 text-slate-500">
                    Turno cerrado
                  </div>
                  <h2 className="text-4xl font-black text-slate-800 tracking-tighter uppercase">Inicia tu Jornada</h2>
                </div>

                <button
                  onClick={() => setStep('keypad')}
                  className="w-full py-8 bg-emerald-500 hover:bg-emerald-600 text-white rounded-[2rem] shadow-xl shadow-emerald-200 flex flex-col items-center justify-center gap-2 transition-all active:scale-95 group border-b-8 border-emerald-700"
                >
                  <Clock size={48} className="group-hover:scale-110 transition-transform" />
                  <span className="text-2xl font-black tracking-widest">INICIAR TURNO</span>
                </button>
              </div>
            ) : (
              /* TURNO EN CURSO VIEW */
              <div className="w-full max-w-sm space-y-6">
                <div className="text-center mb-4">
                  <div className="px-4 py-1.5 rounded-full inline-block text-[10px] font-black tracking-widest uppercase mb-2 bg-emerald-100 text-emerald-600">
                    Turno en curso
                  </div>
                  <h2 className="text-3xl font-black text-slate-800 tracking-tighter uppercase">Gestión de Turno</h2>
                  {lastLog && (
                    <p className="text-slate-400 font-bold mt-1">
                      Iniciado a las {new Date(lastLog.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <button
                    onClick={() => setStep('rounds')}
                    className="w-full py-6 bg-blue-600 hover:bg-blue-700 text-white rounded-[2rem] shadow-xl shadow-blue-200 flex items-center justify-center gap-3 transition-all active:scale-95 border-b-8 border-blue-800 relative"
                  >
                    <ClipboardList size={28} />
                    <span className="text-xl font-black tracking-wider text-center uppercase">RONDAS ASIGNADAS</span>
                    {guardRounds.some(r => r.workerId === currentUser?.uid && r.status === 'IN_PROGRESS') && (
                      <div className="absolute top-4 right-4 w-3 h-3 bg-rose-500 rounded-full animate-ping"></div>
                    )}
                  </button>


                  <button
                    onClick={() => setStep('documents')}
                    className="w-full py-6 bg-slate-800 hover:bg-slate-900 text-white rounded-[2rem] shadow-xl shadow-slate-200 flex items-center justify-center gap-3 transition-all active:scale-95 border-b-8 border-slate-950"
                  >
                    <ShieldCheck size={28} />
                    <span className="text-xl font-black tracking-wider uppercase">MIS DOCUMENTOS</span>
                  </button>

                  <button
                    onClick={() => setStep('keypad')}
                    className="w-full py-6 bg-red-500 hover:bg-red-600 text-white rounded-[2rem] shadow-xl shadow-red-200 flex items-center justify-center gap-3 transition-all active:scale-95 border-b-8 border-red-700"
                  >
                    <LogOut size={28} />
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


        {step === 'keypad' && (
          <div className="bg-white rounded-[3rem] p-8 shadow-xl space-y-8 animate-in zoom-in-95 duration-300 max-w-sm mx-auto mt-4">
            <div className="text-center">
              <h3 className="text-2xl font-black text-slate-800 tracking-tight">Identificación</h3>
              <p className="text-slate-400 font-medium text-xs">Ingresa tu RUT para verificar</p>
            </div>

            <div className="bg-slate-50 p-6 rounded-3xl text-center ring-2 ring-slate-100">
              <span className="text-3xl font-black text-slate-700 tracking-tight">
                {rutInput ? formatRut(rutInput) : 'XX.XXX.XXX-X'}
              </span>
            </div>

            {error && (
              <div className="bg-red-50 p-4 rounded-2xl flex items-center gap-3 text-red-600 animate-bounce">
                <AlertCircle size={20} />
                <span className="text-sm font-bold">{error}</span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 'K', 0].map((num) => (
                <KeypadButton
                  key={num}
                  value={num.toString()}
                  onClick={handleKeyPress}
                />
              ))}
              <button
                onClick={handleBackspace}
                className="h-16 bg-slate-50 hover:bg-red-50 hover:text-red-500 rounded-2xl flex items-center justify-center shadow-sm transition-colors active:scale-95"
              >
                <Delete size={24} />
              </button>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setStep('status')}
                className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-3xl font-black uppercase tracking-widest active:scale-95 transition-all text-xs"
              >
                Cancelar
              </button>
              <button
                onClick={validateRut}
                disabled={rutInput.length < 7 || loading}
                className="flex-[2] py-4 bg-blue-600 text-white rounded-3xl font-black uppercase tracking-widest shadow-lg shadow-blue-200 active:scale-95 transition-all disabled:opacity-50 text-xs flex items-center justify-center gap-2"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                {isCheckedIn ? 'Finalizar' : 'Confirmar'}
              </button>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="h-full flex flex-col items-center justify-center space-y-6 py-20 animate-in zoom-in-95 duration-500">
            <div className="w-32 h-32 bg-emerald-100 rounded-full flex items-center justify-center shadow-inner">
              <CheckCircle size={64} className="text-emerald-500" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-3xl font-black text-slate-800 tracking-tighter uppercase">¡Registro Exitoso!</h2>
              <p className="text-slate-400 font-bold">Tu asistencia ha sido guardada correctamente.</p>
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

      <div className={`p-6 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest opacity-50 transition-all duration-500 ${step === 'keypad' || step === 'documents' || step === 'company_docs' ? 'opacity-0 h-0 p-0 overflow-hidden' : 'opacity-50'}`}>
        GGSS Security • Attendance Control v3.0
      </div>

      {/* SIDEBAR HAMBURGER MENU */}
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
              onClick={() => { setStep('documents'); setIsSidebarOpen(false); }}
              className={`w-full p-4 rounded-2xl flex items-center justify-between transition-all ${step === 'documents' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <div className="flex items-center gap-3">
                <ShieldCheck size={22} className={step === 'documents' ? 'text-blue-600' : 'text-slate-400'} />
                <span className="font-bold">Mis Documentos</span>
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
              onClick={() => fetchInitialData()}
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
            <p className="text-center text-[8px] font-black text-slate-300 mt-4 uppercase tracking-[0.2em]">GGSS Security v3.0</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper Components for optimization
const KeypadButton = React.memo(({ value, onClick }: { value: string, onClick: (v: string) => void }) => {
  return (
    <button
      onClick={() => onClick(value)}
      className="h-16 bg-slate-50 hover:bg-slate-100 active:bg-blue-50 active:text-blue-600 rounded-2xl text-2xl font-black text-slate-600 shadow-sm transition-all"
    >
      {value}
    </button>
  );
});

export default WorkerAttendance;
