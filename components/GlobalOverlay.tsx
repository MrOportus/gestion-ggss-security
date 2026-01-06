import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle, Clock } from 'lucide-react';

export const GlobalOverlay: React.FC = () => {
    const { notifications, hideNotification, confirmation, hideConfirmation } = useAppStore();

    return (
        <>
            {/* NOTIFICATIONS (Toasts) */}
            <div className="fixed top-20 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
                {notifications.map((notif) => (
                    <div
                        key={notif.id}
                        className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border min-w-[300px] animate-in slide-in-from-right-5 duration-300 ${notif.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-800' :
                            notif.type === 'error' ? 'bg-rose-50 border-rose-100 text-rose-800' :
                                notif.type === 'warning' ? 'bg-amber-50 border-amber-100 text-amber-800' :
                                    notif.type === 'coming-soon' ? 'bg-slate-900 border-slate-800 text-white' :
                                        'bg-blue-50 border-blue-100 text-blue-800'
                            }`}
                    >
                        {notif.type === 'success' && <CheckCircle size={20} className="text-emerald-500" />}
                        {notif.type === 'error' && <AlertCircle size={20} className="text-rose-500" />}
                        {notif.type === 'warning' && <AlertTriangle size={20} className="text-amber-500" />}
                        {notif.type === 'info' && <Info size={20} className="text-blue-500" />}
                        {notif.type === 'coming-soon' && <Clock size={20} className="text-slate-400" />}

                        <div className="flex-1 text-sm font-bold">{notif.message}</div>

                        <button
                            onClick={() => hideNotification(notif.id)}
                            className={`p-1 rounded-lg transition ${notif.type === 'coming-soon' ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/5'}`}
                        >
                            <X size={16} />
                        </button>
                    </div>
                ))}
            </div>

            {/* CONFIRMATION MODAL */}
            {confirmation && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-slate-100 flex items-center gap-4 bg-slate-50">
                            <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600">
                                <AlertCircle size={24} />
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">{confirmation.title}</h3>
                                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Confirmación del Sistema</p>
                            </div>
                        </div>

                        <div className="p-8">
                            <p className="text-slate-600 font-medium whitespace-pre-wrap">{confirmation.message}</p>
                        </div>

                        <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
                            <button
                                onClick={() => {
                                    confirmation.onCancel?.();
                                    hideConfirmation();
                                }}
                                className="flex-1 py-3 px-4 rounded-xl text-slate-500 font-bold hover:bg-slate-100 transition"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    confirmation.onConfirm();
                                    hideConfirmation();
                                }}
                                className="flex-1 py-3 px-4 rounded-xl bg-blue-600 text-white font-bold shadow-lg shadow-blue-100 hover:bg-blue-700 transition active:scale-95"
                            >
                                Aceptar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
