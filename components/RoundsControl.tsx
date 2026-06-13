
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../store/useAppStore';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { SyncQueueService } from '../lib/SyncQueueService';
import {
    Play,
    Square,
    Clock,
    History,
    ArrowLeft,
    Loader2,
    Navigation,
    CheckCircle,
    Camera,
    Trash2,
    UploadCloud,
    AlertCircle,
    ShieldAlert,
    ShieldCheck,
    WifiOff,
    RefreshCw,
    X
} from 'lucide-react';
import { GuardRound, RoundEvidence } from '../types';
import { noSleep } from '../lib/noSleep';
import { compressImage } from '../lib/imageUtils';
import { roundsDB } from '../lib/roundsDB';
import { Capacitor } from '@capacitor/core';
import { Camera as CapacitorCamera } from '@capacitor/camera';
import { useSecurityGeolocation } from '../hooks/useSecurityGeolocation';
import { isValidLocation, GpsPoint } from '../lib/gpsUtils';


// --- CONFIGURACIÓN DE API EXTERNA ---

interface RoundsControlProps {
    onBack: () => void;
}

const RoundsControl: React.FC<RoundsControlProps> = ({ onBack }) => {
    const currentUser = useAppStore(state => state.currentUser);
    const guardRounds = useAppStore(state => state.guardRounds);
    const addGuardRound = useAppStore(state => state.addGuardRound);
    const updateGuardRound = useAppStore(state => state.updateGuardRound);
    const uploadFile = useAppStore(state => state.uploadFile);
    const sites = useAppStore(state => state.sites);
    const employees = useAppStore(state => state.employees);
    const showNotification = useAppStore(state => state.showNotification);
    const isSyncing = useAppStore(state => state.isSyncing);
    const { connected } = useNetworkStatus();

    const [activeRound, setActiveRound] = useState<GuardRound | null>(null);
    const [loading, setLoading] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);
    const [currentPos, setCurrentPos] = useState<GeolocationPosition | null>(null);
    const [isCapturing, setIsCapturing] = useState(false);
    const [capturedPhoto, setCapturedPhoto] = useState<Blob | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [showResultModal, setShowResultModal] = useState(false);
    const [roundNotes, setRoundNotes] = useState('');
    const [tempEndLocation, setTempEndLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
    const [gpsStatus, setGpsStatus] = useState<'OK' | 'SABOTEADO' | 'PERDIDA_SENAL'>('OK');

    const timerRef = useRef<NodeJS.Timeout | null>(null);
    // gpsIntervalRef is kept for the web error-path retryGPS call only
    const gpsIntervalRef = useRef<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Tracks the last GpsPoint accepted by the Bouncer — used for anti-jump filter
    const lastSavedPointRef = useRef<GpsPoint | null>(null);


    const employee = employees.find(e => e.id === currentUser?.uid);
    const site = sites.find(s => s.id === employee?.currentSiteId);

    // Filter last 10 rounds for this worker
    const myRounds = React.useMemo(() =>
        guardRounds
            .filter(r => r.workerId === currentUser?.uid)
            .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
            .slice(0, 10)
        , [guardRounds, currentUser?.uid]);

    useEffect(() => {
        // Check if there's an in-progress round
        const inProgress = guardRounds.find(r => r.workerId === currentUser?.uid && r.status === 'IN_PROGRESS');
        
        if (inProgress) {
            setActiveRound(inProgress);
            // Resume timer
            const start = new Date(inProgress.startTime).getTime();
            const now = Date.now();
            setElapsedTime(Math.floor((now - start) / 1000));
            // Reactivar WakeLock si se recarga la página
            noSleep.enable();
        } else {
            // Si no hay ronda en curso en el store, nos aseguramos de limpiar el estado local
            setActiveRound(null);
        }
    }, [guardRounds, currentUser?.uid]);

    // ── GPS position callback — called by useSecurityGeolocation with normalized points ──
    const handleGpsLocation = React.useCallback((point: GpsPoint) => {
        // Build a synthetic GeolocationPosition-like object for setCurrentPos display
        setGpsStatus('OK');
        setCurrentPos({
            coords: {
                latitude: point.lat,
                longitude: point.lng,
                accuracy: point.accuracy,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
            },
            timestamp: new Date(point.timestamp).getTime(),
        } as GeolocationPosition);

        // ── Bouncer filter ────────────────────────────────────────────────────
        const lastPoint = lastSavedPointRef.current;
        if (!isValidLocation(point, lastPoint)) return;
        // Point passed — update ref and persist
        lastSavedPointRef.current = point;
        handlePositionUpdate(point);
    // handlePositionUpdate is stable (defined below), deps intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── GPS error callback ────────────────────────────────────────────────────
    const handleGpsError = React.useCallback((code: number, _message: string) => {
        const syntheticErr = { code, message: _message } as GeolocationPositionError;
        handleWatchError(syntheticErr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Activate the hybrid GPS hook while a round is in progress ─────────────
    useSecurityGeolocation(
        !!activeRound,
        handleGpsLocation,
        handleGpsError
    );

    useEffect(() => {
        if (activeRound) {
            timerRef.current = setInterval(() => {
                setElapsedTime(prev => prev + 1);
            }, 1000);
        } else {
            if (timerRef.current) clearInterval(timerRef.current);
            setElapsedTime(0);
            // Reset the Bouncer's last-point memory when the round ends
            lastSavedPointRef.current = null;
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [activeRound?.id]);

    const handleWatchError = async (err: GeolocationPositionError) => {
        if (!activeRound) return;
        const state = useAppStore.getState();
        const currentRound = state.guardRounds.find(r => r.id === activeRound.id);
        if (!currentRound) return;

        if (err.code === 1) { // PERMISSION_DENIED
            setGpsStatus('SABOTEADO');
            const newPoint = {
                lat: null,
                lng: null,
                timestamp: new Date().toISOString(),
                location_source: 'GPS_SABOTEADO' as const
            };
            const updatedPath = [...(currentRound.path || []), newPoint];
            await state.updateGuardRound(currentRound.id, { path: updatedPath });
        } else { // POSITION_UNAVAILABLE or TIMEOUT
            setGpsStatus('PERDIDA_SENAL');
            const newPoint = {
                lat: null,
                lng: null,
                timestamp: new Date().toISOString(),
                location_source: 'GPS_SIGNAL_LOST_TECHNICAL' as const
            };
            const lastPoint = currentRound.path && currentRound.path.length > 0
                ? currentRound.path[currentRound.path.length - 1]
                : null;
            const lastTime = lastPoint ? new Date(lastPoint.timestamp).getTime() : 0;
            
            // Logear pérdida técnica máximo cada 5 segundos para no inundar el arreglo
            if (Date.now() - lastTime > 5000) {
                const updatedPath = [...(currentRound.path || []), newPoint];
                await state.updateGuardRound(currentRound.id, { path: updatedPath });
            }
        }
    };

    const retryGPS = () => {
        setLoading(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setGpsStatus('OK');
                setLoading(false);
            },
            (err) => {
                setLoading(false);
                handleWatchError(err);
            },
            { enableHighAccuracy: true, timeout: 5000 }
        );
    };

    /**
     * handlePositionUpdate
     *
     * Receives a GpsPoint that has ALREADY passed the Bouncer filter.
     * Responsibility: persist the point to the round's path (state → Firestore),
     * or fall back to IndexedDB when offline.
     *
     * The time-throttle and accuracy checks previously here are now handled
     * upstream by isValidLocation — this function trusts its input.
     */
    const handlePositionUpdate = async (point: GpsPoint) => {
        const state = useAppStore.getState();
        if (!activeRound) return;

        const currentRound = state.guardRounds.find(r => r.id === activeRound.id);
        if (!currentRound) return;

        const newPoint = {
            lat: point.lat,
            lng: point.lng,
            timestamp: point.timestamp,
            accuracy: point.accuracy,
            location_source: 'GPS_OK' as const
        };

        try {
            const updatedPath = [...(currentRound.path || []), newPoint];
            await state.updateGuardRound(currentRound.id, { path: updatedPath });
        } catch (err) {
            // Offline fallback — persist in IndexedDB, sync later
            console.warn('[RoundsControl] Offline: guardando punto en IndexedDB');
            await roundsDB.savePoint({ roundId: currentRound.id, ...newPoint });
        }
    };

    const handleStartRound = async () => {
        console.log("Iniciando ronda...", { employee, site });
        if (!employee || !site) {
            const errorMsg = !employee ? "No se encontró ficha de empleado." : "No tienes una sucursal asignada.";
            console.error("Error al iniciar ronda:", errorMsg);
            showNotification(errorMsg, "error");
            return;
        }

        setLoading(true);
        try {
            console.log("Activando WakeLock...");
            await noSleep.enable();

            console.log("Solicitando ubicación inicial con validación de accuracy...");

            /**
             * Intentar obtener el punto de inicio con accuracy aceptable (≤ 50m).
             * Android entrega el último fix cacheado primero (puede estar a 50-200m de error).
             * Reintentamos hasta MAX_ATTEMPTS veces esperando que el GPS caliente.
             */
            const MAX_ATTEMPTS = 3;
            const ACCURACY_THRESHOLD_M = 50; // Si accuracy > 50m, reintentar
            const RETRY_DELAY_MS = 2500;

            const getPos = (timeout = 15000) => new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout,
                    maximumAge: 0
                });
            });

            let pos: GeolocationPosition | null = null;
            let lastError: any = null;

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                    const candidate = await getPos(attempt === 1 ? 15000 : 8000);
                    const accuracy = candidate.coords.accuracy;
                    console.log(`[GPS inicio] Intento ${attempt}: accuracy=${accuracy.toFixed(1)}m`);

                    if (accuracy <= ACCURACY_THRESHOLD_M || attempt === MAX_ATTEMPTS) {
                        pos = candidate;
                        break;
                    }

                    // accuracy inaceptable — esperar y reintentar
                    showNotification(`Mejorando señal GPS... (${accuracy.toFixed(0)}m)`, 'info');
                    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                } catch (err) {
                    lastError = err;
                    console.warn(`[GPS inicio] Intento ${attempt} falló:`, err);
                    if (attempt === MAX_ATTEMPTS) break;
                    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                }
            }

            if (!pos) {
                const err = lastError as any;
                let msg = "Error GPS: ";
                if (err?.code === 1) msg += "Permiso denegado. Activa el GPS.";
                else if (err?.code === 2) msg += "Ubicación no disponible.";
                else if (err?.code === 3) msg += "Tiempo de espera agotado.";
                else msg += err?.message ?? "No se pudo obtener ubicación.";
                showNotification(msg, "error");
                return;
            }

            console.log("Ubicación obtenida:", pos.coords);

            const startLocation = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy
            };

            console.log("Llamando a addGuardRound...");
            await addGuardRound({
                workerId: employee.id,
                workerName: `${employee.firstName} ${employee.lastNamePaterno}`,
                siteId: site.id,
                siteName: site.name,
                startLocation,
                path: [{ ...startLocation, timestamp: new Date().toISOString(), location_source: 'GPS_OK' }]
            });

            showNotification("Ronda iniciada (GPS Activo)", "success");
        } catch (err: any) {
            console.error("Error general al iniciar ronda:", err);
            showNotification("Error al procesar: " + err.message, "error");
        } finally {
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
                setTempEndLocation(endLocation);
                setShowResultModal(true);
                setLoading(false);
            }, (_) => {
                setShowResultModal(true);
                setLoading(false);
            }, { enableHighAccuracy: true, timeout: 5000 });
        } catch (err) {
            setLoading(false);
        }
    };

    const confirmStopRound = async (result: 'SIN_NOVEDAD' | 'CON_NOVEDAD' | 'SOSPECHA') => {
        if (!activeRound) return;
        setLoading(true);
        try {
            await updateGuardRound(activeRound.id, {
                endTime: new Date().toISOString(),
                endLocation: tempEndLocation || undefined,
                status: 'COMPLETED',
                result,
                notes: roundNotes.trim() || undefined
            });

            setActiveRound(null);
            setShowResultModal(false);
            setRoundNotes('');
            setTempEndLocation(null);
            await noSleep.disable();
            showNotification("Ronda finalizada con éxito", "success");
            syncOfflineData();
        } catch (error) {
            showNotification("Error al cerrar ronda", "error");
        } finally {
            setLoading(false);
        }
    };

    const syncOfflineData = async () => {
        const points = await roundsDB.getAllPoints();
        if (points.length === 0) return;

        console.log(`Intentando sincronizar ${points.length} puntos offline...`);
        // Aquí iría la lógica para enviar estos puntos al backend cuando haya red
    };

    const handlePhotoClick = async () => {
        if (Capacitor.isNativePlatform()) {
            try {
                const permStatus = await CapacitorCamera.requestPermissions({
                    permissions: ['camera', 'photos']
                });
                if (permStatus.camera !== 'granted') {
                    showNotification("Se requiere permiso de cámara para tomar evidencias.", "error");
                    return;
                }
            } catch (err) {
                console.error("Error solicitando permisos de cámara nativa:", err);
            }
        }
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setLoading(true);
        try {
            // --- PREPARAR DATOS DE MARCA DE AGUA ---
            const now = new Date();
            const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            const dateStr = now.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/\./g, '');
            const dayStr = now.toLocaleDateString('es-CL', { weekday: 'short' }).replace(/\./g, '');
            
            // Ubicación: Usamos el nombre de la sucursal y las coordenadas GPS
            const locationName = site?.name || "Ubicación Protegida";
            const coordsStr = currentPos 
                ? `${currentPos.coords.latitude.toFixed(7)}, ${currentPos.coords.longitude.toFixed(7)}`
                : "GPS No disponible";
            
            // Código de verificación único para esta captura
            const verifyCode = `${activeRound?.id.slice(-4).toUpperCase() || 'RND'}${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

            // Comprimir imagen y aplicar marca de agua
            // Barrera 1: maxWidth 1024px (no necesitamos 4K para auditoría)
            // Barrera 2: quality 0.7 + JPEG
            const compressedBlob = await compressImage(file, 0.7, 1024, {
                time: timeStr,
                date: dateStr,
                day: dayStr.charAt(0).toUpperCase() + dayStr.slice(1),
                location: locationName,
                coords: coordsStr,
                verifyCode: verifyCode
            });

            setCapturedPhoto(compressedBlob);
            setPhotoPreview(URL.createObjectURL(compressedBlob));
            setIsCapturing(true);
        } catch (err) {
            console.error("Error al procesar foto con marca de agua:", err);
            showNotification("Error al procesar foto", "error");
        } finally {
            setLoading(false);
        }
    };

    const handleUploadEvidence = async () => {
        console.log("Iniciando handleUploadEvidence", { hasPhoto: !!capturedPhoto, hasRound: !!activeRound, hasPos: !!currentPos });

        if (!capturedPhoto || !activeRound) {
            showNotification("Datos insuficientes para subir foto", "error");
            return;
        }

        setLoading(true);
        try {
            let photoPos = currentPos;

            // Si no tenemos posición del watch, intentamos una rápida
            if (!photoPos) {
                console.log("currentPos es null, intentando obtener ubicación rápida...");
                try {
                    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject, {
                            enableHighAccuracy: true,
                            timeout: 5000
                        });
                    });
                    photoPos = pos;
                } catch (err) {
                    console.warn("No se pudo obtener ubicación para la foto, usando 0,0", err);
                }
            }

            const base64Photo = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(capturedPhoto);
            });

            const evidencePayload = {
                roundId: activeRound.id,
                photoBase64: base64Photo,
                lat: photoPos?.coords.latitude || 0,
                lng: photoPos?.coords.longitude || 0,
                timestamp: new Date().toISOString()
            };

            await SyncQueueService.enqueue('UPLOAD_EVIDENCE', evidencePayload);

            const localUrl = URL.createObjectURL(capturedPhoto);
            const newEvidence: RoundEvidence = {
                photoUrl: localUrl,
                lat: photoPos?.coords.latitude || 0,
                lng: photoPos?.coords.longitude || 0,
                timestamp: evidencePayload.timestamp
            };

            const updatedEvidences = [...(activeRound.evidences || []), newEvidence];
            
            // Actualizar SOLO el estado local de React para mostrar la foto inmediatamente.
            // NO llamar a updateGuardRound aquí ya que encola un UPDATE_ROUND con una blob URL
            // que expira y sobreescribe la evidencia real cuando se sincroniza.
            // El UPLOAD_EVIDENCE en la cola es el único responsable de escribir en Firestore.
            setActiveRound(prev => prev ? { ...prev, evidences: updatedEvidences } : null);

            showNotification("Evidencia guardada localmente", "success");
            setCapturedPhoto(null);
            setPhotoPreview(null);
            setIsCapturing(false);

        } catch (err) {
            console.error("Error al guardar evidencia:", err);
            showNotification("Error al procesar foto", "error");
        } finally {
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
        <div className="flex flex-col h-full bg-slate-50 relative pb-20 md:pb-0">
            {/* Header/Banner Offline */}
            {!connected && (
                <div className="bg-slate-800 text-amber-400 px-4 py-2 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest sticky top-0 z-50 animate-in slide-in-from-top-2">
                    <WifiOff size={14} />
                    Modo Offline: Guardando en dispositivo
                </div>
            )}
            {isSyncing && connected && (
                <div className="bg-blue-600 text-white px-4 py-2 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest sticky top-0 z-50 animate-in slide-in-from-top-2">
                    <RefreshCw size={14} className="animate-spin" />
                    Sincronizando registros...
                </div>
            )}

            <div className="bg-white/80 backdrop-blur-md rounded-[2rem] p-4 mb-8 flex items-center gap-4 border border-white shadow-sm ring-1 ring-slate-100">
                <button
                    onClick={onBack}
                    className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-200 text-white active:scale-90 transition-all flex items-center justify-center shrink-0"
                >
                    <ArrowLeft size={20} />
                </button>
                <div className="min-w-0">
                    <h2 className="text-lg font-black text-slate-800 tracking-tight leading-none mb-1">Rondas de Vigilancia</h2>
                    <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest truncate opacity-60">{site?.name || 'Cargando...'}</p>
                </div>
            </div>

            {/* Action Card */}
            <div className="bg-white rounded-[2.5rem] p-8 shadow-xl shadow-slate-200/50 border border-slate-50 relative overflow-hidden mb-8 text-center">
                {activeRound ? (
                    <div className="space-y-6">
                        {gpsStatus === 'PERDIDA_SENAL' && (
                            <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4">
                                <AlertCircle size={20} className="shrink-0" />
                                <p className="text-xs font-bold text-left">Buscando señal GPS... Siga la ronda</p>
                            </div>
                        )}
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-rose-50 text-rose-600 rounded-full text-[10px] font-black uppercase tracking-widest animate-pulse">
                            <div className="w-2 h-2 bg-rose-600 rounded-full"></div>
                            Ronda en curso - GPS Persistente
                        </div>

                        <div className="text-5xl font-black text-slate-800 tracking-tighter tabular-nums">
                            {formatTime(elapsedTime)}
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={handlePhotoClick}
                                disabled={loading}
                                className="py-4 bg-blue-50 text-blue-600 rounded-2xl flex flex-col items-center justify-center gap-2 transition-all active:scale-95 border border-blue-100"
                            >
                                <Camera size={24} />
                                <span className="text-[10px] font-black uppercase">Capturar Foto</span>
                            </button>
                            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" capture="environment" onChange={handleFileChange} />

                            <button
                                onClick={handleStopRound}
                                disabled={loading}
                                className="py-4 bg-rose-500 text-white rounded-2xl shadow-lg shadow-rose-200 flex flex-col items-center justify-center gap-2 transition-all active:scale-95"
                            >
                                {loading ? <Loader2 className="animate-spin" /> : <Square size={24} fill="currentColor" />}
                                <span className="text-[10px] font-black uppercase">Finalizar</span>
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mx-auto">
                            <Navigation size={40} />
                        </div>

                        <div className="space-y-1">
                            <h3 className="text-2xl font-black text-slate-800">Iniciar Nueva Ronda</h3>
                            <p className="text-sm text-slate-400 font-medium px-4">El GPS se mantendrá activo incluso con la pantalla apagada.</p>
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

            {/* Evidence Preview Modal */}
            {isCapturing && photoPreview && createPortal(
                <div 
                    className="fixed inset-0 bg-[#0f172a] z-[100] flex flex-col"
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        width: '100%',
                        height: '100%',
                        overflow: 'hidden',
                        overscrollBehavior: 'none'
                    }}
                >
                    {/* Top bar */}
                    <div 
                        className="px-6 flex items-center justify-between shrink-0"
                        style={{
                            paddingTop: 'calc(16px + env(safe-area-inset-top, 0px))',
                            paddingBottom: '16px'
                        }}
                    >
                        <p className="text-white text-xs font-black uppercase tracking-widest opacity-70">Vista previa</p>
                        <button
                            onClick={() => { setIsCapturing(false); setCapturedPhoto(null); setPhotoPreview(null); }}
                            className="text-white/70 hover:text-white transition-colors p-2 -mr-2"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Photo Container */}
                    <div className="flex-1 px-8 min-h-0 flex flex-col justify-start pt-6 items-center">
                        <div className="w-full max-w-sm aspect-[3/4] max-h-[55vh] rounded-[2rem] overflow-hidden relative shadow-2xl bg-slate-800/50">
                            <img
                                src={photoPreview}
                                className="absolute inset-0 w-full h-full object-cover"
                                alt="Preview"
                            />
                        </div>
                    </div>

                    {/* Action buttons */}
                    <div 
                        className="px-6 flex gap-4 shrink-0"
                        style={{
                            paddingTop: '8px',
                            paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))'
                        }}
                    >
                        <button
                            onClick={() => { setIsCapturing(false); setCapturedPhoto(null); setPhotoPreview(null); }}
                            className="flex-[1] py-4 bg-slate-800 text-slate-300 rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-2 active:scale-95 transition-all"
                        >
                            <Trash2 size={16} /> Descartar
                        </button>
                        <button
                            onClick={handleUploadEvidence}
                            disabled={loading}
                            className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-900/50 active:scale-95 transition-all disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="animate-spin" size={16} /> : <UploadCloud size={16} />} Subir Evidencia
                        </button>
                    </div>
                </div>,
                document.body
            )}

            {/* History Area */}
            <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                    <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <History size={16} /> Últimas Rondas
                    </h4>
                </div>

                <div className="space-y-3">
                    {myRounds.length === 0 ? (
                        <div className="bg-white/50 border border-dashed border-slate-200 rounded-[2rem] p-12 text-center">
                            <p className="text-slate-400 text-sm font-medium italic">No hay registros de rondas.</p>
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
                                            {round.evidences && ` | ${round.evidences.length} Fotos`}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] font-black uppercase text-slate-300 tracking-tighter">Estado</p>
                                    <div className="flex flex-col items-end">
                                        <p className={`text-xs font-black uppercase ${round.status === 'COMPLETED' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                            {round.status === 'COMPLETED' ? 'Finalizada' : 'En Curso'}
                                        </p>
                                        {round.result && (
                                            <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md mt-1 ${round.result === 'SIN_NOVEDAD' ? 'bg-emerald-100 text-emerald-700' :
                                                round.result === 'CON_NOVEDAD' ? 'bg-rose-100 text-rose-700' :
                                                    'bg-amber-100 text-amber-700'
                                                }`}>
                                                {round.result.replace('_', ' ')}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Stop Round Result Modal - centrado, tamaño justo al contenido */}
            {showResultModal && createPortal(
                <div 
                    className="fixed inset-0 bg-black/70 z-[110] flex items-center justify-center px-5 animate-in fade-in duration-200"
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        width: '100%',
                        height: '100%',
                        overflow: 'hidden'
                    }}
                >
                    <div className="w-full max-w-xs bg-white rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
                        {/* Header compacto */}
                        <div className="pt-5 px-5 pb-3 text-center border-b border-slate-100">
                            <h3 className="text-lg font-black text-slate-800 leading-none">Finalizar Ronda</h3>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Selecciona el resultado</p>
                        </div>

                        {/* Textarea notas compacto */}
                        <div className="px-5 pt-3 pb-2">
                            <textarea
                                value={roundNotes}
                                onChange={(e) => setRoundNotes(e.target.value)}
                                placeholder="Notas opcionales..."
                                className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none h-16 placeholder:text-slate-300 font-medium"
                            />
                        </div>

                        {/* Botones resultado - compactos */}
                        <div className="px-5 pb-2 flex flex-col gap-2">
                            <button
                                onClick={() => confirmStopRound('SIN_NOVEDAD')}
                                disabled={loading}
                                className="flex items-center gap-3 px-4 py-3 bg-emerald-50 text-emerald-700 rounded-xl active:scale-95 transition-all border border-emerald-100"
                            >
                                <ShieldCheck size={20} className="shrink-0" />
                                <div className="text-left">
                                    <p className="font-black uppercase text-xs leading-none">Sin Novedad</p>
                                    <p className="text-[10px] opacity-60 mt-0.5">Todo en orden en la sucursal.</p>
                                </div>
                            </button>

                            <button
                                onClick={() => confirmStopRound('SOSPECHA')}
                                disabled={loading}
                                className="flex items-center gap-3 px-4 py-3 bg-amber-50 text-amber-700 rounded-xl active:scale-95 transition-all border border-amber-100"
                            >
                                <AlertCircle size={20} className="shrink-0" />
                                <div className="text-left">
                                    <p className="font-black uppercase text-xs leading-none">Con Sospecha</p>
                                    <p className="text-[10px] opacity-60 mt-0.5">Situaciones irregulares leves.</p>
                                </div>
                            </button>

                            <button
                                onClick={() => confirmStopRound('CON_NOVEDAD')}
                                disabled={loading}
                                className="flex items-center gap-3 px-4 py-3 bg-rose-50 text-rose-700 rounded-xl active:scale-95 transition-all border border-rose-100"
                            >
                                <ShieldAlert size={20} className="shrink-0" />
                                <div className="text-left">
                                    <p className="font-black uppercase text-xs leading-none">Con Novedad</p>
                                    <p className="text-[10px] opacity-60 mt-0.5">Incidentes graves o directos.</p>
                                </div>
                            </button>
                        </div>

                        {/* Cancelar */}
                        <button
                            onClick={() => setShowResultModal(false)}
                            className="w-full py-3.5 text-slate-400 text-[10px] font-black uppercase tracking-widest border-t border-slate-100"
                        >
                            Cancelar
                        </button>
                    </div>
                </div>,
                document.body
            )}


            {/* GPS Sabotage Blocker Modal */}
            {activeRound && gpsStatus === 'SABOTEADO' && createPortal(
                <div 
                    className="fixed inset-0 bg-rose-900/95 backdrop-blur-md z-[9999] p-6 flex flex-col items-center justify-center animate-in fade-in duration-300"
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        width: '100%',
                        height: '100%',
                        overflow: 'hidden'
                    }}
                >
                    <div className="w-full max-w-sm bg-white rounded-[3rem] p-8 shadow-2xl space-y-8 text-center">
                        <div className="w-24 h-24 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
                            <ShieldAlert size={48} />
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-slate-800 tracking-tight leading-none mb-2">GPS Desactivado</h3>
                            <p className="text-sm text-slate-500 font-medium">La Ronda se ha detenido. Reactive el GPS para continuar trabajando.</p>
                        </div>
                        <button
                            onClick={retryGPS}
                            disabled={loading}
                            className="w-full py-5 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl shadow-lg shadow-rose-200 flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw size={20} />}
                            <span className="font-black uppercase tracking-widest text-sm">Reintentar GPS</span>
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default RoundsControl;
