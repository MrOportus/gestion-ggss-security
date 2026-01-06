import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { MapPin, Clock, LogOut } from 'lucide-react';

const WorkerAttendance: React.FC = () => {
  const { currentUser, getEmployeeByUserId, attendanceLogs, addAttendanceLog, logout, sites } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const employee = currentUser ? getEmployeeByUserId(currentUser.uid) : undefined;

  // Determine current status based on last log
  const lastLog = attendanceLogs
    .filter(l => l.employeeId === employee?.id)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

  const isCheckedIn = lastLog?.type === 'check_in';

  const handleAttendance = () => {
    if (!employee) return;
    setLoading(true);
    setLocationError(null);

    if (!navigator.geolocation) {
      processAttendance(null, null); // Fallback if not supported
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        processAttendance(position.coords.latitude, position.coords.longitude);
      },
      (error) => {
        console.error(error);
        setLocationError("No pudimos obtener tu ubicación exacta. Se registrará sin coordenadas.");
        processAttendance(null, null); // Allow check-in even if geo fails for MVP
      }
    );
  };

  const processAttendance = (lat: number | null, lng: number | null) => {
    if (!employee) return;

    // Simulate API delay
    setTimeout(() => {
      addAttendanceLog({
        employeeId: employee.id,
        type: isCheckedIn ? 'check_out' : 'check_in',
        locationLat: lat || undefined,
        locationLng: lng || undefined,
        siteId: employee.currentSiteId // Mock linking to current site
      });
      setLoading(false);
    }, 1000);
  };

  if (!employee) return <div className="p-4 text-center">Error: Perfil de empleado no encontrado. Contacte a RRHH.</div>;

  const currentSiteName = sites.find(s => s.id === employee.currentSiteId)?.name || 'Sin Asignación';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="bg-blue-600 text-white p-6 shadow-md rounded-b-3xl z-10">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="GGSS Logo" className="w-12 h-12 object-contain brightness-0 invert" />
            <div>
              <h1 className="text-xl font-bold">Hola, {employee.firstName}</h1>
              <p className="text-blue-100 text-sm">RUT: {employee.rut}</p>
            </div>
          </div>
          <button onClick={logout} className="p-2 bg-blue-700 rounded-full hover:bg-blue-800 transition">
            <LogOut size={18} />
          </button>
        </div>

        <div className="bg-blue-800/50 p-3 rounded-lg flex items-center gap-3 backdrop-blur-sm">
          <MapPin size={20} className="text-blue-200" />
          <div>
            <p className="text-xs text-blue-200 uppercase font-semibold">Ubicación Asignada</p>
            <p className="font-medium">{currentSiteName}</p>
          </div>
        </div>
      </div>

      {/* Main Action Area */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 space-y-8">

        <div className="text-center space-y-2">
          <p className="text-slate-500 font-medium">Estado Actual</p>
          <div className={`text-3xl font-bold ${isCheckedIn ? 'text-green-600' : 'text-slate-400'}`}>
            {isCheckedIn ? 'EN TURNO' : 'FUERA DE TURNO'}
          </div>
          {isCheckedIn && lastLog && (
            <p className="text-sm text-slate-400">
              Desde: {new Date(lastLog.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>

        <button
          onClick={handleAttendance}
          disabled={loading}
          className={`
            w-64 h-64 rounded-full shadow-xl flex flex-col items-center justify-center gap-2
            transform transition-all active:scale-95 duration-200 border-8
            ${isCheckedIn
              ? 'bg-red-500 border-red-200 hover:bg-red-600 shadow-red-200'
              : 'bg-green-500 border-green-200 hover:bg-green-600 shadow-green-200'
            }
          `}
        >
          {loading ? (
            <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <Clock size={48} className="text-white opacity-90" />
              <span className="text-2xl font-bold text-white tracking-wider">
                {isCheckedIn ? 'MARCAR SALIDA' : 'MARCAR ENTRADA'}
              </span>
            </>
          )}
        </button>

        {locationError && (
          <div className="text-xs text-orange-600 bg-orange-100 p-2 rounded text-center max-w-xs">
            {locationError}
          </div>
        )}
      </div>

      <div className="p-4 text-center text-xs text-slate-400 pb-8">
        Gestión GGSS App v1.0.0
      </div>
    </div>
  );
};

export default WorkerAttendance;
