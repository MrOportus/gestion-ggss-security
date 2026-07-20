import React, { useState, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, FileText, XCircle } from 'lucide-react';
import { Contrato } from '../types/phase1';
import { collection, query, where, getDocs, doc } from 'firebase/firestore';
import { db, functions } from '../lib/firebase';
import { httpsCallable } from 'firebase/functions';

const HRContractsDashboard: React.FC = () => {
  const { contratos, employees, currentUser, fetchContratos } = useAppStore();
  const [expandedEmpId, setExpandedEmpId] = useState<string | null>(null);

  const [filters, setFilters] = useState({ estado: '', limit: 50 });

  React.useEffect(() => {
    fetchContratos({ estado: filters.estado || undefined, limit: filters.limit });
  }, [fetchContratos, filters.limit, filters.estado]);

  // Modal State para Resolución Manual
  const [resolveModal, setResolveModal] = useState<{
    isOpen: boolean;
    contrato: Contrato | null;
    empId: string;
    fechaInicio: string;
    fechaTermino: string;
    motivo: string;
    isProcessing: boolean;
  }>({
    isOpen: false,
    contrato: null,
    empId: '',
    fechaInicio: new Date().toISOString().split('T')[0],
    fechaTermino: new Date().toISOString().split('T')[0],
    motivo: '',
    isProcessing: false,
  });

  // Agrupar contratos por empleado
  const employeesWithContracts = useMemo(() => {
    return employees.map(emp => {
      const empContracts = contratos.filter(c => c.colaboradorId === emp.id);
      const activeContracts = empContracts.filter(c => c.estado === 'vigente' || c.estado === 'pendiente_firma');
      
      let issueCount = 0;
      if (activeContracts.length > 1) issueCount++; // Múltiples contratos activos
      if (activeContracts.length === 0) issueCount++; // Sin contrato activo
      
      return {
        ...emp,
        contracts: empContracts,
        activeContracts,
        issueCount,
      };
    }).filter(emp => emp.contracts.length > 0 || !filters.estado) // Si hay filtro, mostramos los afectados
      .sort((a, b) => b.issueCount - a.issueCount);
  }, [employees, contratos, filters.estado]);

  const openResolveModal = (contrato: Contrato, empId: string) => {
    setResolveModal({
      isOpen: true,
      contrato,
      empId,
      fechaInicio: contrato.fechaInicio || new Date().toISOString().split('T')[0],
      fechaTermino: contrato.fechaTermino || new Date().toISOString().split('T')[0],
      motivo: '',
      isProcessing: false,
    });
  };

  const handleResolveSubmit = async () => {
    if (!resolveModal.contrato || !resolveModal.motivo.trim()) {
      alert("Debes ingresar un motivo.");
      return;
    }

    setResolveModal(prev => ({ ...prev, isProcessing: true }));

    try {
      // 1. Obtener TurnosProgramados en el rango para este colaborador
      const turnosRef = collection(db, 'TurnosProgramados');
      const q = query(
        turnosRef,
        where('colaboradorId', '==', resolveModal.empId),
        where('fecha', '>=', resolveModal.fechaInicio),
        where('fecha', '<=', resolveModal.fechaTermino)
      );
      
      const turnosSnap = await getDocs(q);
      
      if (turnosSnap.empty) {
        alert('No se encontraron turnos programados en el rango de fechas seleccionado.');
        setResolveModal(prev => ({ ...prev, isProcessing: false }));
        return;
      }

      if (!window.confirm(`Se afectarán ${turnosSnap.size} turnos. ¿Deseas continuar?`)) {
        setResolveModal(prev => ({ ...prev, isProcessing: false }));
        return;
      }

      const turnoProgramadoIds = turnosSnap.docs.map(d => d.id);

      const resolveContractBinding = httpsCallable(functions, 'resolveContractBinding');
      const result = await resolveContractBinding({
        turnoProgramadoIds,
        contratoSeleccionadoId: resolveModal.contrato!.id,
        motivo: resolveModal.motivo
      });

      alert(`Resolución aplicada a ${(result.data as any).updates} turnos exitosamente.`);
      setResolveModal(prev => ({ ...prev, isOpen: false }));

    } catch (error: any) {
      console.error("Error al resolver conflictos:", error);
      alert("Ocurrió un error al resolver el conflicto: " + (error.message || ''));
    } finally {
      setResolveModal(prev => ({ ...prev, isProcessing: false }));
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
          <FileText className="text-blue-500" />
          PANEL DE RRHH - CONTRATOS
        </h1>
        <p className="text-slate-500 mt-2">Gestión y resolución de alertas contractuales de la dotación.</p>
      </div>

      <div className="flex gap-4 mb-4">
        <select 
          value={filters.estado} 
          onChange={e => setFilters(prev => ({...prev, estado: e.target.value}))}
          className="p-2 border border-slate-300 rounded text-sm bg-white"
        >
          <option value="">Todos los Estados</option>
          <option value="vigente">Vigente</option>
          <option value="pendiente_firma">Pendiente de Firma</option>
          <option value="vencido">Vencido</option>
        </select>
        <select 
          value={filters.limit} 
          onChange={e => setFilters(prev => ({...prev, limit: Number(e.target.value)}))}
          className="p-2 border border-slate-300 rounded text-sm bg-white"
        >
          <option value={25}>25 Contratos</option>
          <option value={50}>50 Contratos</option>
          <option value={100}>100 Contratos</option>
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-slate-700">
          Estado Contractual por Colaborador
        </div>
        <div className="divide-y divide-slate-100">
          {employeesWithContracts.map(emp => (
            <div key={emp.id} className="flex flex-col">
              <div 
                className="flex items-center justify-between p-4 hover:bg-slate-50 cursor-pointer transition"
                onClick={() => setExpandedEmpId(expandedEmpId === emp.id ? null : emp.id)}
              >
                <div className="flex items-center gap-4">
                  {expandedEmpId === emp.id ? <ChevronDown size={20} className="text-slate-400" /> : <ChevronRight size={20} className="text-slate-400" />}
                  <div>
                    <div className="font-bold text-slate-800">{emp.firstName} {emp.lastNamePaterno}</div>
                    <div className="text-xs text-slate-500">{emp.rut}</div>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  {emp.issueCount > 0 ? (
                    <div className="flex items-center gap-1 text-red-600 bg-red-50 px-2 py-1 rounded text-xs font-bold">
                      <AlertCircle size={14} /> Requiere Revisión ({emp.issueCount})
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-green-600 bg-green-50 px-2 py-1 rounded text-xs font-bold">
                      <CheckCircle2 size={14} /> Al Día
                    </div>
                  )}
                  <div className="text-xs font-medium text-slate-500 w-24 text-right">
                    {emp.activeContracts.length} activos
                  </div>
                </div>
              </div>

              {expandedEmpId === emp.id && (
                <div className="bg-slate-50 p-4 pl-12 border-t border-slate-100">
                  {emp.contracts.length === 0 ? (
                    <div className="text-sm text-slate-500 italic py-2">No se han encontrado contratos para este colaborador.</div>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Historial de Contratos</div>
                      {emp.contracts.map(c => (
                        <div key={c.id} className="flex flex-col md:flex-row md:items-center justify-between bg-white p-3 rounded border border-slate-200">
                          <div className="flex flex-col">
                            <span className="font-semibold text-slate-800 text-sm">
                              {c.tipo} - <span className="text-slate-500 font-normal">{c.cargo || 'Sin Cargo'}</span>
                            </span>
                            <span className="text-xs text-slate-500 mt-1">
                              Inicio: {c.fechaInicio} {c.fechaTermino ? `| Término: ${c.fechaTermino}` : '| Indefinido'}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-3 mt-3 md:mt-0">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${c.estado === 'vigente' ? 'bg-green-100 text-green-700' : c.estado === 'pendiente_firma' ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-100 text-slate-600'}`}>
                              {c.estado.replace('_', ' ').toUpperCase()}
                            </span>
                            
                            {emp.activeContracts.length > 1 && (c.estado === 'vigente' || c.estado === 'pendiente_firma') && (
                              <button 
                                onClick={() => openResolveModal(c, emp.id)}
                                className="px-3 py-1 bg-blue-50 text-blue-600 rounded text-xs font-bold hover:bg-blue-100 transition border border-blue-200"
                              >
                                Resolver Turnos a este contrato
                              </button>
                            )}
                            
                            {c.googleDriveUrl && (
                              <a href={c.googleDriveUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline text-xs">Ver PDF</a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {emp.activeContracts.length === 0 && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded text-sm text-red-700">
                      <strong>Alerta:</strong> Este colaborador no tiene ningún contrato activo registrado en el sistema. Los turnos asignados aparecerán como "Sin Contrato".
                    </div>
                  )}
                  
                  {emp.activeContracts.length > 1 && (
                    <div className="mt-4 p-3 bg-purple-50 border border-purple-100 rounded text-sm text-purple-700">
                      <strong>Alerta Múltiples Contratos:</strong> Este colaborador tiene más de un contrato activo simultáneamente. Resuelve ambigüedades vinculando turnos específicos al contrato correcto.
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Modal Resolución Manual */}
      {resolveModal.isOpen && resolveModal.contrato && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-4 bg-blue-600 text-white flex items-center justify-between">
              <h3 className="font-bold">Resolución Manual de Turnos</h3>
              <button onClick={() => setResolveModal(prev => ({...prev, isOpen: false}))} className="text-white/80 hover:text-white">
                <XCircle size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600">
                Selecciona el rango de fechas para el cual los turnos de este colaborador deben quedar forzosamente asociados al siguiente contrato:
              </p>
              
              <div className="p-3 bg-slate-50 border border-slate-200 rounded text-sm font-medium">
                {resolveModal.contrato.tipo} ({resolveModal.contrato.cargo || 'Sin cargo'})
                <div className="text-xs text-slate-500 mt-1">ID: {resolveModal.contrato.id}</div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Fecha Inicio Rango</label>
                  <input 
                    type="date" 
                    value={resolveModal.fechaInicio}
                    onChange={(e) => setResolveModal(prev => ({...prev, fechaInicio: e.target.value}))}
                    className="w-full p-2 border border-slate-300 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Fecha Fin Rango</label>
                  <input 
                    type="date" 
                    value={resolveModal.fechaTermino}
                    onChange={(e) => setResolveModal(prev => ({...prev, fechaTermino: e.target.value}))}
                    className="w-full p-2 border border-slate-300 rounded text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Motivo de Resolución</label>
                <textarea 
                  value={resolveModal.motivo}
                  onChange={(e) => setResolveModal(prev => ({...prev, motivo: e.target.value}))}
                  placeholder="Ej: Empleado trabaja doble turno bajo diferentes razones sociales, se clarifica."
                  className="w-full p-2 border border-slate-300 rounded text-sm resize-none h-20"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button 
                onClick={() => setResolveModal(prev => ({...prev, isOpen: false}))}
                className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded transition"
                disabled={resolveModal.isProcessing}
              >
                Cancelar
              </button>
              <button 
                onClick={handleResolveSubmit}
                disabled={resolveModal.isProcessing || !resolveModal.motivo.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded shadow transition disabled:opacity-50"
              >
                {resolveModal.isProcessing ? 'Resolviendo...' : 'Aplicar Resolución'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default HRContractsDashboard;
