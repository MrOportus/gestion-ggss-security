
import React, { useState, useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import Login from './components/Login';
import AdminDashboard from './pages/AdminDashboard';
import EmployeesPage from './pages/EmployeesPage';
import TasksPage from './pages/TasksPage';
import SitesPage from './pages/SitesPage';
import WorkerAttendance from './pages/WorkerAttendance';
import { LogOut, LayoutDashboard, Users, Clock, MapPin, ClipboardList, RefreshCw, Menu, X, ChevronRight, Loader2 } from 'lucide-react';

const App: React.FC = () => {
  const { currentUser, logout, fetchInitialData, isLoading, initializeAuthListener } = useAppStore();
  const [currentView, setCurrentView] = useState<'dashboard' | 'employees' | 'tasks' | 'sites'>('dashboard');
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
              <div className="flex flex-col items-center gap-3">
                  <Loader2 className="animate-spin text-blue-600" size={40} />
                  <p className="text-slate-500 font-medium text-sm">Cargando sistema...</p>
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
    `w-full flex items-center justify-between px-6 py-4 border-b border-slate-100 text-sm font-bold transition-colors ${
      currentView === view ? 'bg-blue-50 text-blue-700 border-l-4 border-l-blue-600' : 'text-slate-600 hover:bg-slate-50'
    }`;

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans overflow-hidden">
      {/* SIDEBAR DESKTOP */}
      <aside className="w-64 bg-white hidden md:flex flex-col shadow-xl z-20 border-r border-slate-200 h-screen">
        <div className="p-6 border-b border-slate-100">
          <h1 className="text-xl font-bold tracking-wider text-blue-600">GGSS SECURITY</h1>
          <p className="text-xs text-slate-500 mt-1">Sistema de Gestión</p>
        </div>
        
        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          <button onClick={() => setCurrentView('dashboard')} className={navItemClass('dashboard')}>
             <LayoutDashboard size={20} />
             <span className="font-medium">Dashboard</span>
          </button>
          
          <button onClick={() => setCurrentView('employees')} className={navItemClass('employees')}>
             <Users size={20} />
             <span className="font-medium">Empleados</span>
          </button>

          <button onClick={() => setCurrentView('sites')} className={navItemClass('sites')}>
             <MapPin size={20} />
             <span className="font-medium">Sucursales</span>
          </button>

          <button onClick={() => setCurrentView('tasks')} className={navItemClass('tasks')}>
             <ClipboardList size={20} />
             <span className="font-medium">Tareas Recurrentes</span>
          </button>
          
          <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-all cursor-not-allowed opacity-60">
             <Clock size={20} />
             <span className="font-medium">Asistencia</span>
          </button>
        </nav>

        <div className="p-4 border-t border-slate-100 bg-slate-50/50 space-y-2 mt-auto">
           <div className="flex items-center gap-3 mb-2 px-2">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-white shadow-lg">A</div>
              <div>
                <p className="text-sm font-medium text-slate-800">Administrador</p>
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
          <div className="flex flex-col">
            <span className="font-black text-blue-600 text-lg tracking-tight">GGSS SECURITY</span>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{currentView === 'dashboard' ? 'Panel General' : currentView}</span>
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
                    <button onClick={() => handleNavChange('employees')} className={mobileNavItemClass('employees')}>
                        <div className="flex items-center gap-3"><Users size={20} /> Empleados</div>
                        <ChevronRight size={16} className="text-slate-300" />
                    </button>
                    <button onClick={() => handleNavChange('sites')} className={mobileNavItemClass('sites')}>
                        <div className="flex items-center gap-3"><MapPin size={20} /> Sucursales</div>
                        <ChevronRight size={16} className="text-slate-300" />
                    </button>
                    <button onClick={() => handleNavChange('tasks')} className={mobileNavItemClass('tasks')}>
                        <div className="flex items-center gap-3"><ClipboardList size={20} /> Tareas Recurrentes</div>
                        <ChevronRight size={16} className="text-slate-300" />
                    </button>
                    
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
                {currentView === 'employees' && <EmployeesPage />}
                {currentView === 'tasks' && <TasksPage />}
                {currentView === 'sites' && <SitesPage />}
            </div>
        </div>
      </main>
    </div>
  );
};

export default App;
