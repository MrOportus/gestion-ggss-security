
import React, { useState, useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import Login from './components/Login';
import AdminDashboard from './pages/AdminDashboard';
import EmployeesPage from './pages/EmployeesPage';
import TasksPage from './pages/TasksPage';
import SitesPage from './pages/SitesPage';
import WorkerAttendance from './pages/WorkerAttendance';
import { LogOut, LayoutDashboard, Users, Clock, MapPin, ClipboardList, RefreshCw, Menu, X, ChevronRight, Loader2, DollarSign } from 'lucide-react';
import { DailyShiftPayment } from './components/DailyShiftPayment';
import { GlobalOverlay } from './components/GlobalOverlay';
import SupervisorManagement from './pages/SupervisorManagement';
import NotesPage from './pages/NotesPage';
import AttendancePage from './pages/AttendancePage';
import RoundsAdminPage from './pages/RoundsAdminPage';
import ShiftManagement from './pages/ShiftManagement';
import LoansPage from './pages/LoansPage';
import { StickyNote, Navigation, CalendarDays, Receipt } from 'lucide-react';



const App: React.FC = () => {
  const { currentUser, logout, fetchInitialData, isLoading, initializeAuthListener } = useAppStore();
  const [currentView, setCurrentView] = useState<'dashboard' | 'employees' | 'tasks' | 'sites' | 'payments' | 'supervisor_mgmt' | 'notes' | 'attendance' | 'rounds' | 'shift_management' | 'loans'>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [authInitialized, setAuthInitialized] = useState(false);

  // Inicializar Auth Listener una sola vez
  useEffect(() => {
    initializeAuthListener();
    // Simulamos un pequeño delay para dar tiempo a Firebase de recuperar la sesión
    const timer = setTimeout(() => setAuthInitialized(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  // Pantalla de carga inicial mientras Firebase verifica la sesión
  if (!authInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <img src="/logo.png" alt="GGSS Logo" className="w-16 h-16 object-contain animate-pulse" />
            <Loader2 className="animate-spin text-blue-600 absolute -bottom-2 -right-2 bg-white rounded-full p-0.5" size={24} />
          </div>
          <div className="text-center">
            <h2 className="text-lg font-bold text-slate-800 tracking-tight">GGSS SECURITY</h2>
            <p className="text-slate-500 font-medium text-[10px] uppercase tracking-widest">Iniciando sistema...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <Login />;
  }

  if (currentUser.role === 'worker') {
    return <WorkerAttendance />;
  }

  const handleNavChange = (view: typeof currentView) => {
    setCurrentView(view);
    setIsMobileMenuOpen(false);
  };

  const navItemClass = (view: string) =>
    `w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${currentView === view ? 'bg-blue-50 text-blue-600 shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`;

  const mobileNavItemClass = (view: string) =>
    `w-full flex items-center justify-between px-6 py-4 border-b border-slate-100 text-sm font-bold transition-colors ${currentView === view ? 'bg-blue-50 text-blue-700 border-l-4 border-l-blue-600' : 'text-slate-600 hover:bg-slate-50'
    }`;

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans overflow-hidden">
      {/* SIDEBAR DESKTOP */}
      <aside className="w-64 bg-white hidden md:flex flex-col shadow-xl z-20 border-r border-slate-200 h-screen">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <img src="/logo.png" alt="GGSS Logo" className="w-10 h-10 object-contain" />
          <div>
            <h1 className="text-lg font-black tracking-tighter text-slate-900 leading-none">GGSS</h1>
            <h1 className="text-lg font-black tracking-tighter text-blue-600 leading-none">SECURITY</h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Gestión</p>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          <button onClick={() => setCurrentView('dashboard')} className={navItemClass('dashboard')}>
            <LayoutDashboard size={20} />
            <span className="font-medium">Dashboard</span>
          </button>

          {currentUser.role === 'admin' && (
            <button onClick={() => setCurrentView('employees')} className={navItemClass('employees')}>
              <Users size={20} />
              <span className="font-medium">Empleados</span>
            </button>
          )}

          <button onClick={() => setCurrentView('sites')} className={navItemClass('sites')}>
            <MapPin size={20} />
            <span className="font-medium">Sucursales</span>
          </button>

          <button onClick={() => setCurrentView('tasks')} className={navItemClass('tasks')}>
            <ClipboardList size={20} />
            <span className="font-medium">Tareas Recurrentes</span>
          </button>

          <button onClick={() => setCurrentView('shift_management')} className={navItemClass('shift_management')}>
            <CalendarDays size={20} />
            <span className="font-medium">Gestión de Turnos</span>
          </button>

          <button onClick={() => setCurrentView('payments')} className={navItemClass('payments')}>
            <DollarSign size={20} />
            <span className="font-medium">Pago de Turnos</span>
          </button>

          <button onClick={() => setCurrentView('loans')} className={navItemClass('loans')}>
            <Receipt size={20} />
            <span className="font-medium">Préstamos</span>
          </button>


          <button onClick={() => setCurrentView('notes')} className={navItemClass('notes')}>
            <StickyNote size={20} />
            <span className="font-medium">Notas y Tareas</span>
          </button>

          <button onClick={() => setCurrentView('attendance')} className={navItemClass('attendance')}>
            <Clock size={20} />
            <span className="font-medium">Asistencia</span>
          </button>

          {currentUser.role === 'admin' && (
            <button onClick={() => setCurrentView('rounds')} className={navItemClass('rounds')}>
              <Navigation size={20} />
              <span className="font-medium">Monitoreo Rondas</span>
            </button>
          )}


          {currentUser.role === 'admin' && (
            <>
              <div className="mx-4 my-4 border-t border-slate-100 flex items-center justify-center">
                <span className="bg-white px-2 -mt-3 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Gestión Supervisores</span>
              </div>

              <button onClick={() => setCurrentView('supervisor_mgmt')} className={navItemClass('supervisor_mgmt')}>
                <ClipboardList size={20} />
                <span className="font-medium">Gestión Supervisores</span>
              </button>
            </>
          )}
        </nav>

        <div className="p-4 border-t border-slate-100 bg-slate-50/50 space-y-2 mt-auto">
          <div className="flex items-center gap-3 mb-2 px-2">
            <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${currentUser.role === 'admin' ? 'from-blue-500 to-indigo-600' : 'from-emerald-500 to-teal-600'} flex items-center justify-center font-bold text-white shadow-lg uppercase`}>
              {currentUser.role[0]}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800">
                {currentUser.role === 'admin' ? 'Administrador' : currentUser.role === 'supervisor' ? 'Supervisor' : 'Colaborador'}
              </p>
              <p className="text-xs text-slate-400 truncate w-32">{currentUser.email}</p>
            </div>
          </div>

          <button
            onClick={() => fetchInitialData()}
            disabled={isLoading}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition font-medium disabled:opacity-50"
          >
            <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
            {isLoading ? 'Sincronizando...' : 'Recargar Datos'}
          </button>

          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition font-medium"
          >
            <LogOut size={16} /> Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col h-screen relative bg-slate-50">

        {/* HEADER MÓVIL */}
        <div className="md:hidden bg-white text-slate-800 p-4 flex justify-between items-center shadow-sm border-b border-slate-200 z-30 shrink-0 relative">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="GGSS Logo" className="w-8 h-8 object-contain" />
            <div className="flex flex-col">
              <div className="flex items-baseline gap-1">
                <span className="font-black text-slate-900 text-sm leading-none tracking-tight">GGSS</span>
                <span className="font-black text-blue-600 text-sm leading-none tracking-tight">SECURITY</span>
              </div>
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none mt-1">
                {currentView === 'dashboard' ? 'Panel General' :
                  currentView === 'employees' ? 'Empleados' :
                    currentView === 'tasks' ? 'Tareas Recurrentes' :
                      currentView === 'sites' ? 'Sucursales' :
                        currentView === 'payments' ? 'Pago de Turnos' :
                          currentView === 'notes' ? 'Notas y Tareas' :
                            currentView === 'attendance' ? 'Asistencia' :
                              currentView === 'rounds' ? 'Monitoreo Rondas' :
                                currentView === 'shift_management' ? 'Gestión de Turnos' :
                                  currentView === 'loans' ? 'Préstamos' : currentView}


              </span>
            </div>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 text-slate-600 bg-slate-50 rounded-lg hover:bg-slate-100 active:bg-slate-200 transition"
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* MENÚ DESPLEGABLE MÓVIL */}
        {isMobileMenuOpen && (
          <div className="md:hidden absolute top-[70px] left-0 right-0 bottom-0 bg-white/95 backdrop-blur-sm z-40 animate-in slide-in-from-top-5 duration-200 flex flex-col">
            <nav className="flex-1 overflow-y-auto">
              <button onClick={() => handleNavChange('dashboard')} className={mobileNavItemClass('dashboard')}>
                <div className="flex items-center gap-3"><LayoutDashboard size={20} /> Dashboard</div>
                <ChevronRight size={16} className="text-slate-300" />
              </button>
              {currentUser.role === 'admin' && (
                <button onClick={() => handleNavChange('employees')} className={mobileNavItemClass('employees')}>
                  <div className="flex items-center gap-3"><Users size={20} /> Empleados</div>
                  <ChevronRight size={16} className="text-slate-300" />
                </button>
              )}
              <button onClick={() => handleNavChange('sites')} className={mobileNavItemClass('sites')}>
                <div className="flex items-center gap-3"><MapPin size={20} /> Sucursales</div>
                <ChevronRight size={16} className="text-slate-300" />
              </button>
              <button onClick={() => handleNavChange('tasks')} className={mobileNavItemClass('tasks')}>
                <div className="flex items-center gap-3"><ClipboardList size={20} /> Tareas Recurrentes</div>
                <ChevronRight size={16} className="text-slate-300" />
              </button>
              <button onClick={() => handleNavChange('shift_management')} className={mobileNavItemClass('shift_management')}>
                <div className="flex items-center gap-3"><CalendarDays size={20} /> Gestión de Turnos</div>
                <ChevronRight size={16} className="text-slate-300" />
              </button>
              <button onClick={() => handleNavChange('payments')} className={mobileNavItemClass('payments')}>
                <div className="flex items-center gap-3"><DollarSign size={20} /> Pago de Turnos</div>
                <ChevronRight size={16} className="text-slate-300" />
              </button>
              <button onClick={() => handleNavChange('loans')} className={mobileNavItemClass('loans')}>
                <div className="flex items-center gap-3"><Receipt size={20} /> Préstamos</div>
                <ChevronRight size={16} className="text-slate-300" />
              </button>

              <button onClick={() => handleNavChange('notes')} className={mobileNavItemClass('notes')}>
                <div className="flex items-center gap-3"><StickyNote size={20} /> Notas y Tareas</div>
                <ChevronRight size={16} className="text-slate-300" />
              </button>
              <button onClick={() => handleNavChange('attendance')} className={mobileNavItemClass('attendance')}>
                <div className="flex items-center gap-3"><Clock size={20} /> Asistencia</div>
                <ChevronRight size={16} className="text-slate-300" />
              </button>

              {currentUser.role === 'admin' && (
                <button onClick={() => handleNavChange('rounds')} className={mobileNavItemClass('rounds')}>
                  <div className="flex items-center gap-3"><Navigation size={20} /> Monitoreo Rondas</div>
                  <ChevronRight size={16} className="text-slate-300" />
                </button>
              )}


              {currentUser.role === 'admin' && (
                <button onClick={() => handleNavChange('supervisor_mgmt')} className={mobileNavItemClass('supervisor_mgmt')}>
                  <div className="flex items-center gap-3"><ClipboardList size={20} /> Gestión Supervisores</div>
                  <ChevronRight size={16} className="text-slate-300" />
                </button>
              )}

              {/* Botones de Acción Móvil */}
              <div className="p-6 grid grid-cols-2 gap-4 mt-4 bg-slate-50/50 border-t border-slate-100">
                <button
                  onClick={() => { fetchInitialData(); setIsMobileMenuOpen(false); }}
                  className="flex flex-col items-center justify-center p-4 bg-white border border-slate-200 rounded-2xl shadow-sm active:scale-95 transition"
                >
                  <RefreshCw size={24} className={`text-blue-500 mb-2 ${isLoading ? 'animate-spin' : ''}`} />
                  <span className="text-xs font-bold text-slate-700">Recargar</span>
                </button>
                <button
                  onClick={logout}
                  className="flex flex-col items-center justify-center p-4 bg-white border border-slate-200 rounded-2xl shadow-sm active:scale-95 transition"
                >
                  <LogOut size={24} className="text-red-500 mb-2" />
                  <span className="text-xs font-bold text-slate-700">Salir</span>
                </button>
              </div>
            </nav>
          </div>
        )}

        {/* CONTENIDO SCROLLABLE */}
        <div className="flex-1 overflow-y-auto">
          <div className="animate-fade-in pb-24 md:pb-0">
            {currentView === 'dashboard' && <AdminDashboard />}
            {currentView === 'employees' && currentUser.role === 'admin' && <EmployeesPage />}
            {currentView === 'tasks' && <TasksPage />}
            {currentView === 'sites' && <SitesPage />}
            {currentView === 'payments' && (
              <div className="p-6 max-w-7xl mx-auto">
                <DailyShiftPayment />
              </div>
            )}
            {currentView === 'notes' && <NotesPage />}
            {currentView === 'attendance' && <AttendancePage />}
            {currentView === 'rounds' && currentUser.role === 'admin' && <RoundsAdminPage />}
            {currentView === 'supervisor_mgmt' && currentUser.role === 'admin' && <SupervisorManagement />}
            {currentView === 'shift_management' && <ShiftManagement />}
            {currentView === 'loans' && <LoansPage />}


          </div>
        </div>
      </main>
      <GlobalOverlay />
    </div>
  );
};

export default App;
