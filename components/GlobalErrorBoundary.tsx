import React from 'react';
import { AlertTriangle, RefreshCw, LogOut } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class GlobalErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[GlobalErrorBoundary] Error no capturado en la aplicación:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleLogout = async () => {
    try {
      await useAppStore.getState().logout();
    } catch (e) {
      console.warn('Error al cerrar sesión desde ErrorBoundary:', e);
    }
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
          <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-md w-full border border-slate-100 text-center space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="relative mx-auto w-24 h-24 flex items-center justify-center">
              <img src="/logo-transparencia.png" alt="Sistema Aspro" className="w-20 h-20 object-contain" />
              <div className="absolute -bottom-1 -right-1 bg-amber-500 text-white p-2 rounded-full shadow-lg">
                <AlertTriangle size={18} />
              </div>
            </div>

            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Ocurrió un problema al cargar</h2>
              <p className="text-slate-500 text-sm mt-1">
                La aplicación encontró una interrupción inesperada al renderizar esta pantalla.
              </p>
            </div>

            {this.state.error?.message && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-left">
                <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wider mb-1">Detalle del error:</p>
                <p className="text-xs text-amber-900 font-mono break-words line-clamp-3">
                  {this.state.error.message}
                </p>
              </div>
            )}

            <div className="space-y-3 pt-2">
              <button
                onClick={this.handleReload}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-blue-500/20 active:scale-[0.98] transition text-sm"
              >
                <RefreshCw size={16} />
                Recargar Aplicación
              </button>

              <button
                onClick={this.handleLogout}
                className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 px-4 rounded-xl active:scale-[0.98] transition text-sm"
              >
                <LogOut size={16} />
                Cerrar Sesión e Ir al Login
              </button>
            </div>

            <p className="text-[10px] text-slate-400 font-medium">
              Sistema Aspro © {new Date().getFullYear()} — Seguridad GGSS
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
