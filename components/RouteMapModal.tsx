
import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { X, Navigation, MapPin } from 'lucide-react';
import { cleanGpsPath, LatLng } from '../lib/gpsUtils';


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
                map.fitBounds(bounds, { padding: [50, 50] });
            }, 500); // Wait for modal animation to settle
            return () => clearTimeout(timer);
        }
    }, [bounds, map]);
    return null;
};

const RouteMapModal: React.FC<RouteMapModalProps> = ({ round, onClose }) => {
    if (!round) return null;

    // Filter valid points only
    const rawPath: LatLng[] = (round.path || [])
        .filter((p: any) => p && typeof p.lat === 'number' && typeof p.lng === 'number' && !isNaN(p.lat) && !isNaN(p.lng))
        .map((p: any) => ({ lat: p.lat, lng: p.lng } as LatLng));

    // Clean path using Douglas-Peucker and Moving Average
    // epsilon: 0.00001 (~1-1.5 meters) - Mejor para rutas caminando
    // windowSize: 3 - Suavizado ligero
    const cleanedPath = cleanGpsPath(rawPath, 0.00001, 3);

    const pathPoints: [number, number][] = cleanedPath.map(p => [p.lat, p.lng]);

    // Fallback logic for basic points
    const finalPoints = [...pathPoints];
    if (finalPoints.length === 0 && round.startLocation?.lat && !isNaN(round.startLocation.lat)) {
        finalPoints.push([round.startLocation.lat, round.startLocation.lng]);
    }
    if (round.endLocation?.lat && !isNaN(round.endLocation.lat)) {
        // Only push if it's not already the last point
        const last = finalPoints[finalPoints.length - 1];
        if (!last || last[0] !== round.endLocation.lat || last[1] !== round.endLocation.lng) {
            finalPoints.push([round.endLocation.lat, round.endLocation.lng]);
        }
    }

    const hasPoints = finalPoints.length > 0;
    const bounds = hasPoints ? L.latLngBounds(finalPoints) : null;
    const defaultCenter: [number, number] = hasPoints ? finalPoints[0] : [-33.4489, -70.6693];

    const duration = round.endTime
        ? Math.floor((new Date(round.endTime).getTime() - new Date(round.startTime).getTime()) / 60000)
        : null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-5xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-[85vh] animate-in zoom-in-95 duration-300">

                {/* Header Section */}
                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white relative z-10">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg">
                            <Navigation size={24} />
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-slate-800 tracking-tight">Recorrido de Vigilancia</h3>
                            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">{round.workerName} • {round.siteName}</p>
                        </div>
                    </div>

                    <div className="hidden md:flex items-center gap-6 px-6 border-x border-slate-100 mx-6">
                        <div className="text-center">
                            <p className="text-[10px] font-black text-slate-300 uppercase">Tiempo</p>
                            <p className="font-bold text-slate-700">{duration || '--'} min</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[10px] font-black text-slate-300 uppercase">Puntos</p>
                            <p className="font-bold text-slate-700">{finalPoints.length}</p>
                        </div>
                        <div className={`px-3 py-1 rounded-full text-[10px] font-black ${round.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                            {round.status === 'COMPLETED' ? 'FINALIZADA' : 'EN VIVO'}
                        </div>
                    </div>

                    <button onClick={onClose} className="p-3 hover:bg-slate-100 rounded-2xl text-slate-400 transition-all">
                        <X size={24} />
                    </button>
                </div>

                {/* Map Area */}
                <div className="flex-1 relative bg-slate-50">
                    {hasPoints && (
                        <MapContainer
                            center={defaultCenter}
                            zoom={15}
                            style={{ height: '100%', width: '100%' }}
                        // Note: react-leaflet 4.x sometimes has issues with dynamic bounds
                        >
                            <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />

                            {bounds && <ChangeView bounds={bounds} />}

                            {finalPoints.length > 1 && (
                                <Polyline
                                    positions={finalPoints}
                                    pathOptions={{
                                        color: '#2563eb',
                                        weight: 6,
                                        opacity: 0.8,
                                        lineJoin: 'round',
                                        lineCap: 'round'
                                    }}
                                />
                            )}

                            {round.startLocation?.lat && (
                                <Marker position={[round.startLocation.lat, round.startLocation.lng]}>
                                    <Popup>
                                        <div className="p-1">
                                            <p className="font-black text-blue-600 text-[10px] uppercase">Inicio</p>
                                            <p className="font-bold text-xs">{new Date(round.startTime).toLocaleTimeString()}</p>
                                        </div>
                                    </Popup>
                                </Marker>
                            )}

                            {round.endLocation?.lat && (
                                <Marker position={[round.endLocation.lat, round.endLocation.lng]}>
                                    <Popup>
                                        <div className="p-1">
                                            <p className="font-black text-emerald-600 text-[10px] uppercase">Fin</p>
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
