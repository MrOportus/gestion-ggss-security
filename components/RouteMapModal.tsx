
import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { X, Navigation, MapPin } from 'lucide-react';
import { getHaversineDistance, movingAverage } from '../lib/gpsUtils';


// Fix for Leaflet default icon issues in React using CDN URLs
const DefaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

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
    if (!round) return null;

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
            <div className="bg-white w-full max-w-5xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-[85vh] animate-in zoom-in-95 duration-300">

                {/* Header Section */}
                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white relative z-10">
                    <div className="flex items-center gap-4">
                        <div className="border-4 border-slate-50 w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl">
                            <Navigation size={28} />
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-slate-800 tracking-tight leading-none mb-1">Monitoreo de Ronda HD</h3>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none">{round.workerName} • {round.siteName}</p>
                        </div>
                    </div>

                    <div className="hidden lg:flex items-center gap-6 px-6 border-x border-slate-100 mx-6">
                        <div className="text-center">
                            <p className="text-[10px] font-black text-slate-300 uppercase leading-none mb-1">Intervalo</p>
                            <p className="font-bold text-slate-700 text-sm">2 seg</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[10px] font-black text-slate-300 uppercase leading-none mb-1">Duración</p>
                            <p className="font-bold text-slate-700 text-sm">{duration || '--'} min</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[10px] font-black text-slate-300 uppercase leading-none mb-1">Precisión</p>
                            <p className="font-bold text-emerald-600 text-sm">FUSED</p>
                        </div>
                    </div>

                    <button onClick={onClose} className="p-3 hover:bg-slate-100 rounded-2xl text-slate-400 transition-all active:scale-90">
                        <X size={24} />
                    </button>
                </div>

                {/* Map Area */}
                <div className="flex-1 relative bg-slate-50">
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
                                <Marker position={[round.startLocation.lat, round.startLocation.lng]}>
                                    <Popup>
                                        <div className="p-1">
                                            <p className="font-black text-blue-600 text-[10px] uppercase">Punto de Partida</p>
                                            <p className="font-bold text-xs">{new Date(round.startTime).toLocaleTimeString()}</p>
                                        </div>
                                    </Popup>
                                </Marker>
                            )}

                            {round.endLocation?.lat && (
                                <Marker position={[round.endLocation.lat, round.endLocation.lng]}>
                                    <Popup>
                                        <div className="p-1">
                                            <p className="font-black text-emerald-600 text-[10px] uppercase">Punto de Cierre</p>
                                            <p className="font-bold text-xs">{new Date(round.endTime).toLocaleTimeString()}</p>
                                        </div>
                                    </Popup>
                                </Marker>
                            )}
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

                    {/* Stats Floating Panel */}
                    <div className="absolute bottom-6 left-6 z-[1000] bg-white/90 backdrop-blur-md p-5 rounded-[2rem] shadow-2xl border border-white/20">
                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-1 bg-blue-600 rounded-full"></div>
                                <span className="text-[10px] font-black text-slate-600 uppercase">Trazado Real</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="w-3 h-3 border-2 border-blue-600 rounded-full bg-white"></div>
                                <span className="text-[10px] font-black text-slate-600 uppercase">Marcadores</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer / Summary Mobile */}
                <div className="md:hidden p-6 bg-slate-50 border-t border-slate-100 grid grid-cols-3 gap-4">
                    <div className="text-center">
                        <p className="text-[10px] font-black text-slate-300 uppercase mb-1">Tiempo</p>
                        <p className="font-bold text-slate-700 text-sm">{duration || '--'}m</p>
                    </div>
                    <div className="text-center">
                        <p className="text-[10px] font-black text-slate-300 uppercase mb-1">Puntos</p>
                        <p className="font-bold text-slate-700 text-sm">{finalPoints.length}</p>
                    </div>
                    <div className="text-center">
                        <p className="text-[10px] font-black text-slate-300 uppercase mb-1">Estado</p>
                        <p className={`font-black text-[9px] ${round.status === 'COMPLETED' ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {round.status === 'COMPLETED' ? 'OK' : 'LIVE'}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RouteMapModal;
