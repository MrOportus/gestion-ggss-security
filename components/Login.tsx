
import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Mail, Lock } from 'lucide-react';

const Login: React.FC = () => {
  const { login } = useAppStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await login(email, password);
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/invalid-email') setError('El correo electrónico no es válido.');
      else if (err.code === 'auth/user-not-found') setError('Usuario no encontrado.');
      else if (err.code === 'auth/wrong-password') setError('Contraseña incorrecta.');
      else if (err.code === 'auth/too-many-requests') setError('Cuenta bloqueada temporalmente. Intente más tarde.');
      else setError('Error al iniciar sesión. Verifique sus credenciales.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 font-sans">
      <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md space-y-8 border border-slate-100 animate-in fade-in duration-500">
        <div className="text-center">
          <div className="w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-6 transition-all duration-300">
            <img src="/logo-transparencia.png" alt="GGSS Logo" className="w-full h-full object-contain" />
          </div>
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Acceso GGSS</h2>
          <p className="text-slate-500 mt-2 text-sm font-medium">Sistema de Gestión de Seguridad</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Correo Electrónico</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input
                type="email"
                required
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:ring-4 focus:ring-yellow-100 focus:border-yellow-400 outline-none transition font-medium"
                placeholder="usuario@ggss.cl"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Contraseña</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input
                type="password"
                required
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:ring-4 focus:ring-yellow-100 focus:border-yellow-400 outline-none transition font-medium"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-red-500 text-sm text-center font-bold bg-red-50 py-3 rounded-lg border border-red-100 flex items-center justify-center gap-2">⚠️ {error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold py-4 rounded-xl transition duration-200 shadow-lg shadow-yellow-100 disabled:opacity-70 disabled:cursor-not-allowed transform active:scale-[0.98] uppercase tracking-wide text-sm flex justify-center items-center gap-2"
          >
            {loading ? <span className="w-5 h-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></span> : null}
            {loading ? 'Validando...' : 'INGRESAR AL SISTEMA'}
          </button>
        </form>

        <div className="text-center text-xs text-slate-400 mt-8 pt-6 border-t border-slate-100">
          <p className="font-medium">Solo personal autorizado</p>
          <p>GGSS Security Services © {new Date().getFullYear()}</p>
        </div>
      </div>
    </div>
  );
};

export default Login;
