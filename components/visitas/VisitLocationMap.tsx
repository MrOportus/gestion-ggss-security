import React from 'react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Mismo ajuste de icono por CDN que usa RouteMapModal (Leaflet + bundlers)
const VisitIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

/** Mapa de un solo punto (ubicación de la visita). Misma librería que el monitoreo de rondas. */
const VisitLocationMap: React.FC<{ lat: number; lng: number }> = ({ lat, lng }) => (
  <MapContainer
    center={[lat, lng]}
    zoom={17}
    scrollWheelZoom={false}
    style={{ height: 90, width: '100%', borderRadius: 16, zIndex: 0 }}
  >
    <TileLayer
      attribution='&copy; OpenStreetMap'
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    />
    <Marker position={[lat, lng]} icon={VisitIcon} />
  </MapContainer>
);

export default VisitLocationMap;
