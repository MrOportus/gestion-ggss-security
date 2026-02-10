
import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
    Play,
    Square,
    Clock,
    History,
    ArrowLeft,

    Loader2,
    Navigation,
    CheckCircle
} from 'lucide-react';
import { GuardRound } from '../types';
import { getHaversineDistance } from '../lib/gpsUtils';

interface RoundsControlProps {
    onBack: () => void;
}

const RoundsControl: React.FC<RoundsControlProps> = ({ onBack }) => {
    const {
        currentUser,
        guardRounds,
        addGuardRound,
        updateGuardRound,
        sites,
        employees,
        showNotification
    } = useAppStore();

    const [activeRound, setActiveRound] = useState<GuardRound | null>(null);
    const [loading, setLoading] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const gpsIntervalRef = useRef<NodeJS.Timeout | null>(null);


    const employee = employees.find(e => e.id === currentUser?.uid);
    const site = sites.find(s => s.id === employee?.currentSiteId);

    // Filter last 10 rounds for this worker
    const myRounds = guardRounds
        .filter(r => r.workerId === currentUser?.uid)
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
        .slice(0, 10);

    useEffect(() => {
        // Check if there's an in-progress round
        const inProgress = guardRounds.find(r => r.workerId === currentUser?.uid && r.status === 'IN_PROGRESS');
        if (inProgress) {
            setActiveRound(inProgress);
            // Resume timer
            const start = new Date(inProgress.startTime).getTime();
            const now = Date.now();
            setElapsedTime(Math.floor((now - start) / 1000));
        }
    }, [guardRounds, currentUser]);

    useEffect(() => {
        if (activeRound) {
            timerRef.current = setInterval(() => {
                setElapsedTime(prev => prev + 1);
            }, 1000);

            // Use watchPosition for better tracking
            if ('geolocation' in navigator) {
                // Initial immediate capture
                navigator.geolocation.getCurrentPosition(
                    (pos) => handlePositionUpdate(pos),
                    (err) => console.error("Initial GPS Error:", err),
                    { enableHighAccuracy: true }
                );

                // Continuous tracking
                const watchId = navigator.geolocation.watchPosition(
                    (pos) => {
                        // Throttle updates to ~5 seconds to balance detail vs data size
                        // We check the timestamp of the last point in the active round
                        const state = useAppStore.getState();
                        const currentRound = state.guardRounds.find(r => r.id === activeRound.id);

                        if (currentRound) {
                            const lastPoint = currentRound.path && currentRound.path.length > 0
                                ? currentRound.path[currentRound.path.length - 1]
                                : null;

                            const lastTime = lastPoint ? new Date(lastPoint.timestamp).getTime() : 0;
                            const now = Date.now();

                            // Update more frequently for walking (3 seconds)
                            if (now - lastTime > 3000) {
                                handlePositionUpdate(pos);
                            }
                        }
                    },
                    (err) => console.error("Watch GPS Error:", err),
                    {
                        enableHighAccuracy: true,
                        maximumAge: 0,
                        timeout: 10000
                    }
                );

                // Store watchId in a ref to clear it later (we can reuse gpsIntervalRef or create a new one, 
                // but since gpsIntervalRef was for the interval, let's repurpose or cast it)
                // To be clean, we'll cast it to any or just use a new ref variable if we could, 
                // but here we are replacing the effect. 
                // Let's assume gpsIntervalRef can hold the ID (it's NodeJS.Timeout | null usually, but in browser it's number).
                // We will just cast it.
                (gpsIntervalRef.current as any) = watchId;
            }

        } else {
            if (timerRef.current) clearInterval(timerRef.current);
            if (gpsIntervalRef.current) navigator.geolocation.clearWatch(gpsIntervalRef.current as any);
            setElapsedTime(0);
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (gpsIntervalRef.current) navigator.geolocation.clearWatch(gpsIntervalRef.current as any);
        };
    }, [activeRound?.id]); // Only re-run if the active round ID changes (start/stop)

    const handlePositionUpdate = (pos: GeolocationPosition) => {
        // Relaxed accuracy for indoor/walking environments (35 meters)
        if (pos.coords.accuracy > 35) {
            console.warn("GPS Point ignored (Low accuracy):", pos.coords.accuracy);
            return;
        }

        const state = useAppStore.getState();
        if (!activeRound) return;

        const currentRound = state.guardRounds.find(r => r.id === activeRound.id);
        if (currentRound) {
            const lastPoint = currentRound.path && currentRound.path.length > 0
                ? currentRound.path[currentRound.path.length - 1]
                : null;

            const newCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };

            // If we have a last point, calculate distance
            if (lastPoint) {
                const distance = getHaversineDistance(lastPoint, newCoords);
                // If moved less than 1.5 meters, ignore to prevent jittering noise when standing still
                if (distance < 1.5) return;
            }

            const newPoint = {
                ...newCoords,
                timestamp: new Date().toISOString(),
                accuracy: pos.coords.accuracy
            };
            const updatedPath = [...(currentRound.path || []), newPoint];
            state.updateGuardRound(currentRound.id, { path: updatedPath });
        }
    };

    // We keep this solely for specific manual triggers if needed, or remove it.
    // The previous capturePathPoint is replaced by handlePositionUpdate logic inside the watcher.


    const handleStartRound = async () => {
        if (!employee || !site) {
            showNotification("No tienes una sucursal asignada para iniciar ronda.", "error");
            return;
        }

        setLoading(true);
        try {
            navigator.geolocation.getCurrentPosition(async (pos) => {
                const startLocation = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                };
                await addGuardRound({

                    workerId: employee.id,
                    workerName: `${employee.firstName} ${employee.lastNamePaterno}`,
                    siteId: site.id,
                    siteName: site.name,
                    startLocation,
                    path: [{ ...startLocation, timestamp: new Date().toISOString() }]
                });

                showNotification("Ronda iniciada correctamente", "success");
                setLoading(false);
            }, (err) => {
                console.error(err);
                showNotification("Error al obtener ubicación. Activa el GPS.", "error");
                setLoading(false);
            }, { enableHighAccuracy: true });
        } catch (err) {
            console.error(err);
            setLoading(false);
        }
    };

    const handleStopRound = async () => {
        if (!activeRound) return;
        setLoading(true);

        try {
            navigator.geolocation.getCurrentPosition(async (pos) => {
                const endLocation = {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                };
                await updateGuardRound(activeRound.id, {
                    endTime: new Date().toISOString(),
                    endLocation,
                    status: 'COMPLETED'
                });

                setActiveRound(null);
                showNotification("Ronda finalizada correctamente", "success");
                setLoading(false);
                setActiveRound(null);
                setLoading(false);
            }, (err) => {
                console.error(err);
                // Still stop the round even if GPS fails at the end
                updateGuardRound(activeRound.id, {
                    endTime: new Date().toISOString(),
                    status: 'COMPLETED'
                });
                setActiveRound(null);
                setLoading(false);
            }, { enableHighAccuracy: true });
        } catch (err) {
            console.error(err);
            setLoading(false);
        }
    };

    const formatTime = (seconds: number) => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="flex flex-col h-full animate-in fade-in duration-500">
            {/* Header local */}
            <div className="flex items-center gap-4 mb-6">
                <button
                    onClick={onBack}
                    className="p-3 bg-white rounded-2xl shadow-sm border border-slate-100 text-slate-500 active:scale-90 transition-all"
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h2 className="text-xl font-black text-slate-800 tracking-tight">Rondas de Vigilancia</h2>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">{site?.name || 'Cargando...'}</p>
                </div>
            </div>

            {/* Action Card */}
            <div className="bg-white rounded-[2.5rem] p-8 shadow-xl shadow-slate-200/50 border border-slate-50 relative overflow-hidden mb-8 text-center">
                {activeRound ? (
                    <div className="space-y-6">
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-rose-50 text-rose-600 rounded-full text-[10px] font-black uppercase tracking-widest animate-pulse">
                            <div className="w-2 h-2 bg-rose-600 rounded-full"></div>
                            Ronda en curso
                        </div>

                        <div className="text-5xl font-black text-slate-800 tracking-tighter tabular-nums">
                            {formatTime(elapsedTime)}
                        </div>

                        <button
                            onClick={handleStopRound}
                            disabled={loading}
                            className="w-full py-6 bg-rose-500 hover:bg-rose-600 text-white rounded-3xl shadow-xl shadow-rose-200 flex items-center justify-center gap-3 transition-all active:scale-95 border-b-8 border-rose-700 disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="animate-spin" /> : <Square size={24} fill="currentColor" />}
                            <span className="text-xl font-black tracking-widest uppercase">Finalizar Ronda</span>
                        </button>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mx-auto">
                            <Navigation size={40} />
                        </div>

                        <div className="space-y-1">
                            <h3 className="text-2xl font-black text-slate-800">Iniciar Nueva Ronda</h3>
                            <p className="text-sm text-slate-400 font-medium px-4">Inicia el seguimiento GPS de tu recorrido por la sucursal.</p>
                        </div>

                        <button
                            onClick={handleStartRound}
                            disabled={loading}
                            className="w-full py-6 bg-blue-600 hover:bg-blue-700 text-white rounded-3xl shadow-xl shadow-blue-200 flex items-center justify-center gap-3 transition-all active:scale-95 border-b-8 border-blue-800 disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="animate-spin" /> : <Play size={24} fill="currentColor" />}
                            <span className="text-xl font-black tracking-widest uppercase">Iniciar Ronda</span>
                        </button>
                    </div>
                )}
            </div>

            {/* History Area */}
            <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                    <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <History size={16} /> Últimas 10 Rondas
                    </h4>
                </div>

                <div className="space-y-3">
                    {myRounds.length === 0 ? (
                        <div className="bg-white/50 border border-dashed border-slate-200 rounded-[2rem] p-12 text-center">
                            <p className="text-slate-400 text-sm font-medium italic">No hay registros de rondas anteriores.</p>
                        </div>
                    ) : (
                        myRounds.map((round) => (
                            <div key={round.id} className="bg-white p-4 rounded-3xl border border-slate-100 flex items-center gap-4 group">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${round.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                                    {round.status === 'COMPLETED' ? <CheckCircle size={24} /> : <Loader2 size={24} className="animate-spin" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <p className="font-bold text-slate-800">
                                            {new Date(round.startTime).toLocaleDateString()}
                                        </p>
                                        <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-black uppercase">
                                            {round.siteName}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-slate-400 font-medium mt-0.5">
                                        <div className="flex items-center gap-1">
                                            <Clock size={12} />
                                            {new Date(round.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            {round.endTime && ` - ${new Date(round.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] font-black uppercase text-slate-300 tracking-tighter">Estado</p>
                                    <p className={`text-xs font-black uppercase ${round.status === 'COMPLETED' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                        {round.status === 'COMPLETED' ? 'Finalizada' : 'En Curso'}
                                    </p>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default RoundsControl;
