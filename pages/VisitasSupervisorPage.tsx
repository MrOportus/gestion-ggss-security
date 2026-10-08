import React from 'react';
import { useAppStore } from '../store/useAppStore';
import SupervisorVisitas from '../components/visitas/SupervisorVisitas';
import VisitasAdminPanel from '../components/visitas/VisitasAdminPanel';

/**
 * Módulo "Visitas de Supervisor".
 *  - supervisor → flujo de campo (Nueva visita)
 *  - admin      → dashboard, filtros, listado y detalle
 * Se integra en la navegación existente (App.tsx) como una vista más.
 */
const VisitasSupervisorPage: React.FC = () => {
  const role = useAppStore(s => s.currentUser?.role);
  if (role === 'supervisor') return <SupervisorVisitas />;
  if (role === 'admin') return <VisitasAdminPanel />;
  return <div className="p-8 text-center text-red-500 font-bold text-lg">Acceso no autorizado</div>;
};

export default VisitasSupervisorPage;
