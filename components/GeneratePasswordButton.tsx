
import React, { useState } from 'react';
import { Employee } from '../types';
import { useAppStore } from '../store/useAppStore';
import { functions, auth } from '../lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { KeyRound, Copy, Check, RefreshCw, AlertTriangle } from 'lucide-react';

interface GeneratePasswordButtonProps {
  employee: Employee;
}

/**
 * Genera una contraseña aleatoria con formato: Letra + 6 dígitos + Letra
 * Ejemplo: A665544B, K123456Z, M000001X
 */
const generatePassword = (): string => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const randomLetter = () => letters[Math.floor(Math.random() * letters.length)];
  const randomDigits = () => {
    let digits = '';
    for (let i = 0; i < 6; i++) {
      digits += Math.floor(Math.random() * 10).toString();
    }
    return digits;
  };
  return randomLetter() + randomDigits() + randomLetter();
};

const GeneratePasswordButton: React.FC<GeneratePasswordButtonProps> = ({ employee }) => {
  const { showNotification } = useAppStore();
  const [isLoading, setIsLoading] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleGenerate = async () => {
    setIsLoading(true);

    const password = generatePassword();

    try {
      // Llamar a la Cloud Function que usa Admin SDK para cambiar 
      // la contraseña REAL en Firebase Authentication + Firestore
      const resetUserPassword = httpsCallable(functions, 'resetUserPassword');
      const result = await resetUserPassword({
        employeeId: employee.id,
        newPassword: password,
      });

      const data = result.data as any;

      setGeneratedPassword(password);
      setShowConfirm(false);

      showNotification(
        `✅ ${data.message || 'Contraseña actualizada exitosamente.'}`,
        'success'
      );

      // Si el usuario fue migrado de bulk a Auth, recargar datos
      if (data.migrated) {
        showNotification(
          `🔄 El usuario fue migrado a una cuenta real. Recarga la página para ver los cambios.`,
          'info'
        );
      }
    } catch (err: any) {
      console.error('Error generando contraseña:', err);

      // Extraer mensaje legible del error de Cloud Functions
      const errorMessage = err?.message || 'Error desconocido al generar la contraseña';
      showNotification('❌ ' + errorMessage, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showNotification('📋 Contraseña copiada al portapapeles', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback para entornos sin clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // --- Vista de confirmación inline ---
  if (showConfirm) {
    return (
      <div className="flex items-center gap-2 animate-in fade-in duration-200">
        <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5">
          <AlertTriangle size={14} className="text-amber-500 shrink-0" />
          <span className="text-[11px] font-bold text-amber-700">¿Generar nueva contraseña?</span>
        </div>
        <button
          onClick={handleGenerate}
          disabled={isLoading}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-[11px] font-bold hover:bg-blue-700 transition shadow-sm disabled:opacity-50"
        >
          {isLoading ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            'Confirmar'
          )}
        </button>
        <button
          onClick={() => setShowConfirm(false)}
          className="px-3 py-1.5 text-slate-500 text-[11px] font-bold hover:text-slate-800 transition"
        >
          Cancelar
        </button>
      </div>
    );
  }

  // --- Si ya se generó una contraseña en esta sesión ---
  if (generatedPassword) {
    return (
      <div className="flex items-center gap-2 animate-in fade-in duration-200">
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-1.5">
          <KeyRound size={14} className="text-emerald-600 shrink-0" />
          <span className="font-mono font-black text-emerald-800 text-sm tracking-widest">
            {generatedPassword}
          </span>
          <button
            onClick={() => handleCopy(generatedPassword)}
            className="p-1 rounded-lg hover:bg-emerald-100 transition"
            title="Copiar contraseña"
          >
            {copied ? (
              <Check size={14} className="text-emerald-600" />
            ) : (
              <Copy size={14} className="text-emerald-500" />
            )}
          </button>
        </div>
        <button
          onClick={() => setShowConfirm(true)}
          className="p-1.5 rounded-lg hover:bg-slate-100 transition text-slate-400 hover:text-slate-600"
          title="Generar otra contraseña"
        >
          <RefreshCw size={14} />
        </button>
      </div>
    );
  }

  // --- Si ya tiene contraseña temporal previamente guardada ---
  if (employee.tempPasswordLog) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-1.5">
          <KeyRound size={14} className="text-yellow-600 shrink-0" />
          <span className="font-mono font-bold text-yellow-800 text-xs tracking-wider">
            {employee.tempPasswordLog}
          </span>
          <button
            onClick={() => handleCopy(employee.tempPasswordLog!)}
            className="p-1 rounded-lg hover:bg-yellow-100 transition"
            title="Copiar contraseña"
          >
            {copied ? (
              <Check size={14} className="text-yellow-600" />
            ) : (
              <Copy size={14} className="text-yellow-500" />
            )}
          </button>
        </div>
        <button
          onClick={() => setShowConfirm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition shadow-sm text-[11px] font-bold"
          title="Generar nueva contraseña"
        >
          <RefreshCw size={13} />
          Regenerar
        </button>
      </div>
    );
  }

  // --- Botón principal: Sin contraseña aún ---
  return (
    <button
      onClick={() => setShowConfirm(true)}
      disabled={isLoading}
      className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl hover:from-violet-700 hover:to-indigo-700 transition-all shadow-lg shadow-violet-200 text-xs font-bold disabled:opacity-50 active:scale-95"
    >
      {isLoading ? (
        <RefreshCw size={15} className="animate-spin" />
      ) : (
        <KeyRound size={15} />
      )}
      Generar Contraseña
    </button>
  );
};

export default GeneratePasswordButton;
