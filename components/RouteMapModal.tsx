
import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { X, Navigation, MapPin, Camera, Image, Clock as ClockIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { getHaversineDistance, movingAverage } from '../lib/gpsUtils';

// Fix for Leaflet default icon issues in React using CDN URLs
const DefaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

// Custom icons for Start and End
const StartIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const EndIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

// Custom icon for Photos
const PhotoIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

interface RouteMapModalProps {
    round: any;
    onClose: () => void;
}

// Component to auto-fit bounds when path changes
const ChangeView = ({ bounds }: { bounds: L.LatLngBoundsExpression }) => {
    const map = useMap();
    useEffect(() => {
        if (bounds) {
            // Leaflet needs to recalculate size if initialized in a hidden/animated container
            const timer = setTimeout(() => {
                map.invalidateSize();
                map.fitBounds(bounds, { padding: [50, 50], maxZoom: 19 });
            }, 500); // Wait for modal animation to settle
            return () => clearTimeout(timer);
        }
    }, [bounds, map]);
    return null;
};

const RouteMapModal: React.FC<RouteMapModalProps> = ({ round, onClose }) => {
    const [selectedPhotoIndex, setSelectedPhotoIndex] = React.useState<number | null>(null);
    const [isZoomed, setIsZoomed] = React.useState(false);
    const [zoomOrigin, setZoomOrigin] = React.useState({ x: 50, y: 50 });

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (selectedPhotoIndex === null) return;
            if (e.key === 'ArrowLeft') handlePrevPhoto();
            if (e.key === 'ArrowRight') handleNextPhoto();
            if (e.key === 'Escape') setSelectedPhotoIndex(null);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedPhotoIndex]);

    if (!round) return null;

    const evidences = round.evidences || [];

    const handlePrevPhoto = () => {
        if (selectedPhotoIndex === null || evidences.length === 0) return;
        setSelectedPhotoIndex((prev) => (prev! - 1 + evidences.length) % evidences.length);
        setIsZoomed(false);
    };

    const handleNextPhoto = () => {
        if (selectedPhotoIndex === null || evidences.length === 0) return;
        setSelectedPhotoIndex((prev) => (prev! + 1) % evidences.length);
        setIsZoomed(false);
        setZoomOrigin({ x: 50, y: 50 });
    };

    const calculateOrigin = (clientX: number, clientY: number, currentTarget: HTMLElement) => {
        const { left, top, width, height } = currentTarget.getBoundingClientRect();
        const x = Math.max(0, Math.min(100, ((clientX - left) / width) * 100));
        const y = Math.max(0, Math.min(100, ((clientY - top) / height) * 100));
        return { x, y };
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isZoomed) return;
        setZoomOrigin(calculateOrigin(e.clientX, e.clientY, e.currentTarget));
    };

    const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
        if (!isZoomed) return;
        const touch = e.touches[0];
        setZoomOrigin(calculateOrigin(touch.clientX, touch.clientY, e.currentTarget));
    };

    const handlePhotoClick = (e: React.MouseEvent<HTMLImageElement>) => {
        if (!isZoomed) {
            setZoomOrigin(calculateOrigin(e.clientX, e.clientY, e.currentTarget));
        }
        setIsZoomed(!isZoomed);
    };

    const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
        if (!isZoomed) {
            const touch = e.touches[0];
            setZoomOrigin(calculateOrigin(touch.clientX, touch.clientY, e.currentTarget));
        }
    };

    // For the coloring logic and smoothing, we need the raw points with timestamps
    const rawPoints = (round.path || [])
        .filter((p: any) => p && typeof p.lat === 'number' && typeof p.lng === 'number' && p.timestamp);

    // Apply moving average smoothing (window size 3) to raw points to fulfill "suavizado" requirement
    // but preserving every point for stay detection logic.
    const fullPathPoints = movingAverage(rawPoints, 3);

    // Zoom and bounds calculations
    const finalPoints: [number, number][] = fullPathPoints.map((p: any) => [p.lat, p.lng]);
    if (finalPoints.length === 0 && round.startLocation?.lat && !isNaN(round.startLocation.lat)) {
        finalPoints.push([round.startLocation.lat, round.startLocation.lng]);
    }

    const hasPoints = finalPoints.length > 0;
    const bounds = hasPoints ? L.latLngBounds(finalPoints) : null;
    const defaultCenter: [number, number] = hasPoints ? finalPoints[0] : [-33.4489, -70.6693];

    const duration = round.endTime
        ? Math.floor((new Date(round.endTime).getTime() - new Date(round.startTime).getTime()) / 60000)
        : null;

    // Helper to determine color of a segment
    const getSegmentColor = (p1: any, p2: any, index: number, total: number) => {
        const t1 = new Date(p1.timestamp).getTime();
        const t2 = new Date(p2.timestamp).getTime();
        const dt = (t2 - t1) / 1000; // seconds
        const dist = getHaversineDistance(p1, p2);

        // Stay detection
        if (dist < 2) {
            if (dt > 120) return '#b91c1c'; // Rojo intenso (Deep Red) - > 2 min
            if (dt > 30) return '#ef4444'; // Rojo (Soft Red) - > 30 sec
        }

        // Progress coloring
        const progress = index / total;
        if (progress < 0.1) return '#22c55e'; // Verde (Inicia)
        if (progress > 0.9) return '#3b82f6'; // Azul (Termina)
        return '#f97316'; // Ámbar/Naranja (Cuerpo central - más visible que amarillo puro)
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-6xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-[90vh] animate-in zoom-in-95 duration-300">

                {/* Header Section */}
                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white relative z-10">
                    <div className="flex items-center gap-4">
                        <div className="border-4 border-slate-50 w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl">
                            <Navigation size={28} />
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-slate-800 tracking-tight leading-none mb-1">Detalle de Ronda</h3>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none">{round.workerName} • {round.siteName}</p>
                        </div>
                    </div>

                    <div className="hidden lg:flex items-center gap-6 px-6 border-x border-slate-100 mx-6">
                        <div className="text-center">
                            <p className="text-[10px] font-black text-slate-300 uppercase leading-none mb-1">Duración</p>
                            <p className="font-bold text-slate-700 text-sm">{duration || '--'} min</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[10px] font-black text-slate-300 uppercase leading-none mb-1">Evidencias</p>
                            <p className="font-bold text-amber-600 text-sm flex items-center gap-1">
                                <Camera size={14} />
                                {round.evidences?.length || 0}
                            </p>
                        </div>
                        <div className="text-center">
                            <p className="text-[10px] font-black text-slate-300 uppercase leading-none mb-1">Estado</p>
                            <p className={`font-black text-xs uppercase ${round.status === 'COMPLETED' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {round.status === 'COMPLETED' ? 'Completada' : 'En Curso'}
                            </p>
                        </div>
                    </div>

                    <button onClick={onClose} className="p-3 hover:bg-slate-100 rounded-2xl text-slate-400 transition-all active:scale-90">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
                    {/* Map Area */}
                    <div className="flex-1 relative bg-slate-50 min-h-[300px]">
                        {hasPoints && (
                            <MapContainer
                                center={defaultCenter}
                                zoom={19}
                                maxZoom={22}
                                style={{ height: '100%', width: '100%' }}
                            >
                                <TileLayer
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                    maxZoom={22}
                                    maxNativeZoom={19}
                                />

                                {bounds && <ChangeView bounds={bounds} />}

                                {/* Dynamic Path Segments */}
                                {fullPathPoints.length > 1 && fullPathPoints.map((point: any, idx: number) => {
                                    if (idx === 0) return null;
                                    const prevPoint = fullPathPoints[idx - 1];
                                    const color = getSegmentColor(prevPoint, point, idx, fullPathPoints.length);

                                    return (
                                        <Polyline
                                            key={`seg-${idx}`}
                                            positions={[
                                                [prevPoint.lat, prevPoint.lng],
                                                [point.lat, point.lng]
                                            ]}
                                            pathOptions={{
                                                color: color,
                                                weight: 6,
                                                opacity: 0.9,
                                                lineJoin: 'round',
                                                lineCap: 'round'
                                            }}
                                        />
                                    );
                                })}

                                {round.startLocation?.lat && (
                                    <Marker position={[round.startLocation.lat, round.startLocation.lng]} icon={StartIcon}>
                                        <Popup>
                                            <div className="p-1 text-center">
                                                <p className="font-black text-blue-600 text-[10px] uppercase">Punto de Partida</p>
                                                <p className="font-bold text-xs">{new Date(round.startTime).toLocaleTimeString()}</p>
                                            </div>
                                        </Popup>
                                    </Marker>
                                )}

                                {round.endLocation?.lat && (
                                    <Marker position={[round.endLocation.lat, round.endLocation.lng]} icon={EndIcon}>
                                        <Popup>
                                            <div className="p-1 text-center">
                                                <p className="font-black text-emerald-600 text-[10px] uppercase">Punto de Cierre</p>
                                                <p className="font-bold text-xs">{new Date(round.endTime).toLocaleTimeString()}</p>
                                            </div>
                                        </Popup>
                                    </Marker>
                                )}

                                {/* Evidence Markers */}
                                {round.evidences?.map((evidence: any, idx: number) => (
                                    <Marker
                                        key={`evidence-${idx}`}
                                        position={[evidence.lat, evidence.lng]}
                                        icon={PhotoIcon}
                                    >
                                        <Popup>
                                            <div className="w-48 overflow-hidden rounded-lg">
                                                <img
                                                    src={evidence.photoUrl}
                                                    alt="Evidencia"
                                                    className="w-full aspect-square object-cover mb-2 cursor-pointer"
                                                    onClick={() => setSelectedPhotoIndex(idx)}
                                                />
                                                <div className="p-1 text-center">
                                                    <p className="font-black text-amber-600 text-[10px] uppercase">Evidencia Fotográfica</p>
                                                    <p className="font-bold text-xs">{new Date(evidence.timestamp).toLocaleTimeString()}</p>
                                                </div>
                                            </div>
                                        </Popup>
                                    </Marker>
                                ))}
                            </MapContainer>
                        )}

                        {!hasPoints && (
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-slate-400">
                                <div className="text-center">
                                    <MapPin size={48} className="mx-auto mb-4 opacity-20" />
                                    <p className="font-bold">Sin datos GPS disponibles para esta ronda</p>
                                </div>
                            </div>
                        )}

                        {/* Legends Panel */}
                        <div className="absolute top-6 left-6 z-[1000] bg-white/90 backdrop-blur-md p-4 rounded-3xl shadow-2xl border border-white/20 sm:flex flex-col gap-3 hidden">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-1 bg-blue-600 rounded-full"></div>
                                <span className="text-[10px] font-black text-slate-600 uppercase">Trazado</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="w-3 h-3 bg-amber-400 rounded-full ring-2 ring-white"></div>
                                <span className="text-[10px] font-black text-slate-600 uppercase">Fotos</span>
                            </div>
                        </div>
                    </div>

                    {/* Evidence Sidebar / Right Gallery */}
                    <div className="w-full md:w-80 bg-slate-50 border-l border-slate-100 flex flex-col p-6 overflow-y-auto">
                        <div className="flex items-center justify-between mb-6">
                            <h4 className="font-black text-slate-800 flex items-center gap-2">
                                <Image size={20} className="text-blue-600" />
                                Galería de Evidencias
                            </h4>
                            <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded-lg text-[10px] font-black">
                                {round.evidences?.length || 0}
                            </span>
                        </div>

                        {(!round.evidences || round.evidences.length === 0) ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-white rounded-3xl border border-dashed border-slate-200">
                                <Camera size={32} className="text-slate-200 mb-2" />
                                <p className="text-xs text-slate-400 font-medium italic">No se registraron imágenes en esta ronda.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                {round.evidences.map((evidence: any, idx: number) => (
                                    <div
                                        key={idx}
                                        className="group relative bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer border border-slate-100"
                                        onClick={() => setSelectedPhotoIndex(idx)}
                                    >
                                        <div className="aspect-[4/3] relative bg-slate-100 flex items-center justify-center">
                                            <img
                                                src={evidence.photoUrl}
                                                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                                alt={`Evidencia ${idx}`}
                                                onError={(e) => {
                                                    const target = e.target as HTMLImageElement;
                                                    target.style.display = 'none';
                                                    const parent = target.parentElement;
                                                    if (parent) {
                                                        const placeholder = document.createElement('div');
                                                        placeholder.className = "flex flex-col items-center justify-center text-slate-300 gap-1";
                                                        placeholder.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg><span class="text-[8px] font-black uppercase">Falla</span>`;
                                                        parent.appendChild(placeholder);
                                                    }
                                                }}
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-white opacity-0 group-hover:opacity-100 transition-opacity">
                                                <div className="flex items-center gap-1">
                                                    <ClockIcon size={10} />
                                                    <span className="text-[9px] font-bold">{new Date(evidence.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                </div>
                                                <MapPin size={10} />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="mt-8 p-4 bg-blue-600 rounded-3xl text-white">
                            <h5 className="text-[10px] font-black uppercase tracking-widest opacity-70 mb-2">Resumen de Seguimiento</h5>
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-medium">Distancia estim.</span>
                                    <span className="text-xs font-black">~{Math.round((round.path?.length || 0) * 0.05)} km</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-medium">Puntos GPS</span>
                                    <span className="text-xs font-black">{round.path?.length || 0}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Lightbox Photo View */}
                {selectedPhotoIndex !== null && evidences.length > 0 && (
                    <div
                        className="fixed inset-0 z-[9999] bg-slate-900/98 flex items-center justify-center p-4 md:p-10 animate-in fade-in duration-200 backdrop-blur-xl"
                        onClick={() => setSelectedPhotoIndex(null)}
                    >
                        {/* Close Button */}
                        <button
                            className="absolute top-6 right-6 p-4 bg-white/10 text-white rounded-full hover:bg-white/20 transition-all z-[10000] active:scale-90"
                            onClick={() => setSelectedPhotoIndex(null)}
                        >
                            <X size={32} />
                        </button>

                        {/* Navigation Buttons */}
                        {evidences.length > 1 && (
                            <>
                                <button
                                    className="absolute left-6 top-1/2 -translate-y-1/2 p-5 bg-white/10 text-white rounded-3xl hover:bg-white/20 transition-all z-[10000] active:scale-95 group"
                                    onClick={(e) => { e.stopPropagation(); handlePrevPhoto(); }}
                                >
                                    <ChevronLeft size={48} className="group-hover:-translate-x-1 transition-transform" />
                                </button>
                                <button
                                    className="absolute right-6 top-1/2 -translate-y-1/2 p-5 bg-white/10 text-white rounded-3xl hover:bg-white/20 transition-all z-[10000] active:scale-95 group"
                                    onClick={(e) => { e.stopPropagation(); handleNextPhoto(); }}
                                >
                                    <ChevronRight size={48} className="group-hover:translate-x-1 transition-transform" />
                                </button>
                            </>
                        )}

                        {/* Main Image Container */}
                        <div className="relative flex flex-col items-center gap-6 max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
                            <div
                                className={`relative group/image overflow-hidden rounded-[2rem] shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-white/10 ${isZoomed ? 'touch-none' : 'touch-auto'}`}
                                onMouseMove={handleMouseMove}
                                onTouchMove={handleTouchMove}
                                onTouchStart={handleTouchStart}
                            >
                                <img
                                    src={evidences[selectedPhotoIndex].photoUrl}
                                    className={`max-w-full max-h-[75vh] transition-transform duration-300 ease-out object-contain cursor-zoom-in ${isZoomed ? 'scale-[2.5] cursor-zoom-out' : 'scale-100'}`}
                                    style={{ transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%` }}
                                    alt="Visualización HD"
                                    onClick={handlePhotoClick}
                                />
                                {!isZoomed && (
                                    <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover/image:opacity-100 transition-opacity pointer-events-none text-center">
                                        <p className="text-white text-[10px] font-black uppercase tracking-[0.2em] drop-shadow-md">Haz clic para Inspección Detallada</p>
                                    </div>
                                )}
                                {isZoomed && (
                                    <div className="absolute top-4 right-4 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full text-[9px] font-black text-white uppercase border border-white/10 pointer-events-none">
                                        Exploración Libre • Mueve el cursor
                                    </div>
                                )}
                            </div>

                            {/* Photo Info / Counter Overlay */}
                            <div className="bg-[#1c1c1c] px-8 py-4 rounded-3xl border border-white/10 flex items-center gap-6 text-white shadow-2xl">
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-400 mb-0.5">Evidencia Fotográfica</span>
                                    <span className="text-sm font-bold">Foto {selectedPhotoIndex + 1} de {evidences.length}</span>
                                </div>
                                <div className="w-px h-8 bg-white/10"></div>
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-0.5">Captura</span>
                                    <div className="flex items-center gap-2">
                                        <ClockIcon size={14} className="text-slate-400" />
                                        <span className="text-sm font-black">{new Date(evidences[selectedPhotoIndex].timestamp).toLocaleTimeString()}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default RouteMapModal;
