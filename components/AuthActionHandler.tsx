import React, { useState, useEffect } from 'react';
import { Mail, Lock, CheckCircle, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth';
import { auth } from '../lib/firebase';

interface AuthActionHandlerProps {
  mode: string;
  oobCode: string;
}

const AuthActionHandler: React.FC<AuthActionHandlerProps> = ({ mode, oobCode }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [codeValid, setCodeValid] = useState(false);

  useEffect(() => {
    const verifyCode = async () => {
      if (mode !== 'resetPassword') {
        setError('Esta acción de seguridad no está soportada o es inválida.');
        setVerifying(false);
        return;
      }

      try {
        const userEmail = await verifyPasswordResetCode(auth, oobCode);
        setEmail(userEmail);
        setCodeValid(true);
      } catch (err: any) {
        console.error('Error verifying code:', err);
        setError('El enlace de seguridad ha expirado, es inválido o ya ha sido utilizado.');
      } finally {
        setVerifying(false);
      }
    };

    verifyCode();
  }, [mode, oobCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas ingresadas no coinciden.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await confirmPasswordReset(auth, oobCode, password);
      setSuccess(true);
    } catch (err: any) {
      console.error('Error resetting password:', err);
      setError('Ocurrió un error al guardar la nueva contraseña. Inténtelo más tarde.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoToLogin = () => {
    // Clear URL query parameters to return to clean login page
    window.history.replaceState({}, document.title, window.location.pathname);
    window.location.reload();
  };

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 font-sans">
        <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md text-center space-y-4 border border-slate-100">
          <div className="w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <img src="/logo-transparencia.png" alt="GGSS Logo" className="w-full h-full object-contain animate-pulse" />
          </div>
          <Loader2 className="animate-spin text-yellow-500 w-8 h-8 mx-auto" />
          <p className="text-slate-600 font-semibold text-sm">Verificando enlace de seguridad...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 font-sans">
      <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md space-y-6 border border-slate-100 animate-in fade-in duration-300">
        
        {/* Header */}
        <div className="text-center">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <img src="/logo-transparencia.png" alt="GGSS Logo" className="w-full h-full object-contain" />
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">GGSS Security</h2>
          <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mt-1">
            Restablecer Contraseña
          </p>
        </div>

        {error && !success && (
          <div className="bg-red-50 border border-red-150 p-4 rounded-xl flex items-start gap-3">
            <AlertCircle className="text-red-500 shrink-0 w-5 h-5 mt-0.5" />
            <div className="text-left">
              <h4 className="font-bold text-red-800 text-sm">Error en la Solicitud</h4>
              <p className="text-xs text-red-700 mt-1 leading-relaxed font-semibold">
                {error}
              </p>
            </div>
          </div>
        )}

        {success ? (
          <div className="space-y-6 animate-in zoom-in-95 duration-200">
            <div className="bg-emerald-50 border border-emerald-250 p-6 rounded-xl flex flex-col items-center text-center space-y-3">
              <CheckCircle className="text-emerald-500 w-12 h-12 animate-bounce" />
              <h3 className="font-bold text-emerald-800 text-base">¡Contraseña Actualizada!</h3>
              <p className="text-xs text-emerald-700 font-semibold leading-relaxed">
                Tu contraseña ha sido restablecida con éxito. Ya puedes iniciar sesión de forma segura con tu nueva credencial de acceso.
              </p>
            </div>

            <button
              onClick={handleGoToLogin}
              className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3.5 rounded-xl transition duration-200 shadow-md flex items-center justify-center gap-2 text-sm uppercase tracking-wide"
            >
              Ir al Inicio de Sesión
            </button>
          </div>
        ) : codeValid ? (
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Info */}
            <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-xl flex items-center gap-3">
              <Mail className="text-slate-400 w-5 h-5 shrink-0" />
              <div className="text-left min-w-0">
                <span className="text-[10px] text-slate-400 uppercase font-black tracking-widest block leading-none">Restablecer para</span>
                <span className="text-sm font-bold text-slate-700 block mt-1 truncate">{email}</span>
              </div>
            </div>

            {/* Password field */}
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Nueva Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  className="w-full pl-10 pr-10 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:ring-4 focus:ring-yellow-100 focus:border-yellow-400 outline-none transition font-medium"
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Confirm Password field */}
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Confirmar Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  required
                  className="w-full pl-10 pr-10 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:ring-4 focus:ring-yellow-100 focus:border-yellow-400 outline-none transition font-medium"
                  placeholder="Repite tu contraseña"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold py-4 rounded-xl transition duration-200 shadow-lg shadow-yellow-100 disabled:opacity-70 disabled:cursor-not-allowed transform active:scale-[0.98] uppercase tracking-wide text-sm flex justify-center items-center gap-2"
            >
              {submitting && <Loader2 className="animate-spin w-5 h-5" />}
              {submitting ? 'Guardando...' : 'GUARDAR NUEVA CONTRASEÑA'}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <button
              onClick={handleGoToLogin}
              className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3.5 rounded-xl transition duration-200 shadow-md flex items-center justify-center gap-2 text-sm uppercase tracking-wide"
            >
              Volver al Login
            </button>
          </div>
        )}

        <div className="text-center text-xs text-slate-400 mt-6 pt-4 border-t border-slate-100">
          <p className="font-medium">Solo personal autorizado</p>
          <p>GGSS Security Services © {new Date().getFullYear()}</p>
        </div>

      </div>
    </div>
  );
};

export default AuthActionHandler;
