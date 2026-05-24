import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Mail, Lock, ArrowLeft, CheckCircle } from 'lucide-react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../lib/firebase';

const Login: React.FC = () => {
  const { login } = useAppStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Password recovery states
  const [view, setView] = useState<'login' | 'reset'>('login');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoverySuccess, setRecoverySuccess] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');

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

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryLoading(true);
    setRecoveryError('');
    setRecoverySuccess(false);

    try {
      await sendPasswordResetEmail(auth, recoveryEmail);
      setRecoverySuccess(true);
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/invalid-email') {
        setRecoveryError('El correo electrónico no es válido.');
      } else if (err.code === 'auth/user-not-found') {
        setRecoveryError('No existe un usuario registrado con este correo electrónico.');
      } else if (err.code === 'auth/missing-email') {
        setRecoveryError('Por favor ingresa un correo electrónico.');
      } else {
        setRecoveryError('Error al enviar el enlace. Intente más tarde.');
      }
    } finally {
      setRecoveryLoading(false);
    }
  };

  if (view === 'reset') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 font-sans">
        <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md space-y-6 border border-slate-100 animate-in fade-in duration-300">
          <div className="text-center">
            <div className="w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <img src="/logo-transparencia.png" alt="GGSS Logo" className="w-full h-full object-contain" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Restablecer Contraseña</h2>
            <p className="text-slate-500 mt-2 text-sm font-medium">
              Ingresa tu correo registrado para recuperar el acceso.
            </p>
          </div>

          {recoverySuccess ? (
            <div className="space-y-6 animate-in zoom-in-95 duration-200">
              <div className="bg-green-50 border border-green-200 p-6 rounded-xl flex flex-col items-center text-center space-y-3">
                <CheckCircle className="text-green-500 w-12 h-12 animate-bounce" />
                <h3 className="font-bold text-green-800 text-base">¡Enlace Enviado!</h3>
                <p className="text-xs text-green-700 font-medium leading-relaxed">
                  Hemos enviado un correo a <span className="font-bold">{recoveryEmail}</span> con instrucciones para restablecer tu contraseña. Revisa también tu bandeja de spam.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setView('login');
                  setRecoverySuccess(false);
                  setRecoveryEmail('');
                }}
                className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3.5 rounded-xl transition duration-200 shadow-md flex justify-center items-center gap-2 text-sm uppercase tracking-wide"
              >
                <ArrowLeft size={16} /> Volver al Inicio
              </button>
            </div>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Correo Electrónico</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                  <input
                    type="email"
                    required
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:ring-4 focus:ring-yellow-100 focus:border-yellow-400 outline-none transition font-medium"
                    placeholder="usuario@ggss.cl"
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                  />
                </div>
              </div>

              {recoveryError && (
                <p className="text-red-500 text-sm text-center font-bold bg-red-50 py-3 rounded-lg border border-red-100 flex items-center justify-center gap-2 animate-pulse">
                  ⚠️ {recoveryError}
                </p>
              )}

              <div className="space-y-3">
                <button
                  type="submit"
                  disabled={recoveryLoading}
                  className="w-full bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold py-4 rounded-xl transition duration-200 shadow-lg shadow-yellow-100 disabled:opacity-70 disabled:cursor-not-allowed transform active:scale-[0.98] uppercase tracking-wide text-sm flex justify-center items-center gap-2"
                >
                  {recoveryLoading && <span className="w-5 h-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></span>}
                  {recoveryLoading ? 'Enviando...' : 'ENVIAR ENLACE'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setView('login');
                    setRecoveryError('');
                  }}
                  className="w-full py-3 text-slate-500 hover:text-slate-800 text-sm font-bold transition flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={16} /> Cancelar y Volver
                </button>
              </div>
            </form>
          )}

          <div className="text-center text-xs text-slate-400 mt-8 pt-6 border-t border-slate-100">
            <p className="font-medium">Solo personal autorizado</p>
            <p>GGSS Security Services © {new Date().getFullYear()}</p>
          </div>
        </div>
      </div>
    );
  }

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
            <div className="flex justify-end mt-2.5">
              <button
                type="button"
                onClick={() => {
                  setView('reset');
                  setRecoveryEmail(email);
                  setRecoveryError('');
                  setRecoverySuccess(false);
                }}
                className="text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline transition duration-150 outline-none"
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>
          </div>

          {error && <p className="text-red-500 text-sm text-center font-bold bg-red-50 py-3 rounded-lg border border-red-100 flex items-center justify-center gap-2">⚠️ {error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold py-4 rounded-xl transition duration-200 shadow-lg shadow-yellow-100 disabled:opacity-70 disabled:cursor-not-allowed transform active:scale-[0.98] uppercase tracking-wide text-sm flex justify-center items-center gap-2"
          >
            {loading && <span className="w-5 h-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></span>}
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
