import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useAttendanceShadow } from '../hooks/useAttendanceShadow';
import { AttendanceShadowRequest } from '../types/phase5d2';
import { 
  AlertTriangle, 
  Search, 
  RefreshCw, 
  ChevronLeft, 
  ChevronRight,
  ShieldAlert,
  Clock,
  Info,
  CheckCircle2,
  XCircle,
  FileQuestion,
  Users
} from 'lucide-react';

export default function AttendanceShadowQA() {
  const { employees, sites } = useAppStore();
  const { 
    response, 
    loading, 
    error, 
    execute, 
    nextPage, 
    previousPage, 
    hasNextPage, 
    hasPreviousPage,
    reset
  } = useAttendanceShadow();

  // Filter state
  const [queryType, setQueryType] = useState<AttendanceShadowRequest['queryType']>('branch_day');
  const [employeeId, setEmployeeId] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [jornadaDate, setJornadaDate] = useState(new Date().toISOString().split('T')[0]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const handleSearch = () => {
    // Basic validation
    if (queryType.startsWith('employee') && !employeeId) {
      alert('Debe seleccionar un trabajador.');
      return;
    }
    if (queryType.startsWith('branch') && !sucursalId) {
      alert('Debe seleccionar una sucursal.');
      return;
    }

    const params: Omit<AttendanceShadowRequest, 'requestId' | 'cursor'> = {
      queryType,
      limit: 10
    };

    if (queryType === 'employee_day' || queryType === 'branch_day') {
      params.jornadaDate = jornadaDate;
    }
    if (queryType === 'employee_range' || queryType === 'branch_range') {
      params.fromDate = fromDate;
      params.toDate = toDate;
    }
    
    if (queryType.startsWith('employee')) params.employeeId = employeeId;
    if (queryType.startsWith('branch')) params.sucursalId = sucursalId;

    execute(params);
  };

  const handleFilterChange = () => {
    reset(); // Reset cursor stack and results when filters change
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="shadow-qa-container">
      {/* HEADER */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
            <ShieldAlert className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Asistencia Multiturno — Vista Shadow QA</h1>
            <p className="text-sm text-slate-500 mt-1">
              Vista de validación aislada. Muestra comparaciones paginadas entre el modelo Legacy actual y el nuevo motor Multiturno V2.
            </p>
            <div className="inline-flex items-center gap-2 mt-3 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-md text-xs font-medium border border-amber-200">
              <AlertTriangle className="w-4 h-4" />
              Esta vista es estrictamente de diagnóstico. No reemplaza los registros operacionales actuales.
            </div>
          </div>
        </div>
      </div>

      {/* FILTERS (Area A) */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <Search className="w-5 h-5 text-slate-400" />
          Parámetros de Consulta
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label htmlFor="queryType" className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Tipo de Consulta
            </label>
            <select 
              id="queryType"
              value={queryType}
              onChange={(e) => {
                setQueryType(e.target.value as any);
                handleFilterChange();
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
            >
              <option value="employee_day">Trabajador por día</option>
              <option value="employee_range">Trabajador por rango</option>
              <option value="branch_day">Sucursal por día</option>
              <option value="branch_range">Sucursal por rango</option>
            </select>
          </div>

          {queryType.startsWith('employee') && (
            <div>
              <label htmlFor="employeeId" className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Trabajador
              </label>
              <select 
                id="employeeId"
                value={employeeId}
                onChange={(e) => { setEmployeeId(e.target.value); handleFilterChange(); }}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
              >
                <option value="">Seleccione trabajador...</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastNamePaterno}</option>
                ))}
              </select>
            </div>
          )}

          {queryType.startsWith('branch') && (
            <div>
              <label htmlFor="sucursalId" className="block text-xs font-bold text-slate-500 uppercase mb-1">
                Sucursal
              </label>
              <select 
                id="sucursalId"
                value={sucursalId}
                onChange={(e) => { setSucursalId(e.target.value); handleFilterChange(); }}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
              >
                <option value="">Seleccione sucursal...</option>
                {sites.map(site => (
                  <option key={site.id} value={site.id}>{site.name}</option>
                ))}
              </select>
            </div>
          )}

          {queryType.endsWith('day') ? (
            <div>
              <label htmlFor="jornadaDate" className="block text-xs font-bold text-slate-500 uppercase mb-1">Fecha</label>
              <input 
                id="jornadaDate"
                type="date" 
                value={jornadaDate}
                onChange={(e) => { setJornadaDate(e.target.value); handleFilterChange(); }}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
              />
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="fromDate" className="block text-xs font-bold text-slate-500 uppercase mb-1">Desde</label>
                <input 
                  id="fromDate"
                  type="date" 
                  value={fromDate}
                  onChange={(e) => { setFromDate(e.target.value); handleFilterChange(); }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div>
                <label htmlFor="toDate" className="block text-xs font-bold text-slate-500 uppercase mb-1">Hasta</label>
                <input 
                  id="toDate"
                  type="date" 
                  value={toDate}
                  onChange={(e) => { setToDate(e.target.value); handleFilterChange(); }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"
                />
              </div>
            </>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSearch}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 transition-colors"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? 'Consultando...' : 'Consultar Shadow'}
          </button>
        </div>
        
        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div>
              <strong>Error en la consulta:</strong>
              <p>{error}</p>
            </div>
          </div>
        )}
      </div>

      {/* RESULTS AREA */}
      {response && (
        <div className="space-y-6 animate-fade-in">
          {/* COMPARISON SCOPE WARNING */}
          {response.comparison?.comparisonScope === 'page' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
              <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-amber-800">Comparación parcial paginada</h3>
                <p className="text-sm text-amber-700 mt-1">
                  Los resultados de comparación mostrados corresponden únicamente a esta página. 
                  (Grupos comparados: {response.comparison.groupsCompared}, Diferidos: {response.comparison.groupsDeferred})
                </p>
              </div>
            </div>
          )}

          {response.comparison?.comparisonScope === 'full' && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-emerald-800">Comparación completa</h3>
                <p className="text-sm text-emerald-700 mt-1">
                  El alcance consultado fue analizado en su totalidad.
                </p>
              </div>
            </div>
          )}

          {/* COMPARISON RESULTS */}
          {response.comparison && (
            <div className={`border rounded-xl shadow-sm p-5 bg-white ${
              response.comparison.status === 'exact_match' ? 'border-emerald-200' :
              response.comparison.status === 'expected_legacy_limitation' ? 'border-blue-200' :
              response.comparison.status === 'legacy_overwrite_detected' ? 'border-amber-200' :
              'border-rose-200'
            }`}>
              <div className="flex items-center gap-3 mb-4">
                {response.comparison.status === 'exact_match' ? <CheckCircle2 className="w-6 h-6 text-emerald-500" /> :
                 response.comparison.status === 'expected_legacy_limitation' ? <Info className="w-6 h-6 text-blue-500" /> :
                 response.comparison.status === 'legacy_overwrite_detected' ? <AlertTriangle className="w-6 h-6 text-amber-500" /> :
                 <XCircle className="w-6 h-6 text-rose-500" />}
                
                <h3 className="text-lg font-bold text-slate-800">
                  {response.comparison.status === 'exact_match' ? 'Coincidencia Exacta' :
                   response.comparison.status === 'expected_legacy_limitation' ? 'Limitación Legacy Esperada' :
                   response.comparison.status === 'legacy_overwrite_detected' ? 'Posible Sobrescritura Legacy' :
                   response.comparison.status === 'missing_legacy' ? 'Sin Registro Legacy' :
                   response.comparison.status === 'missing_v2' ? 'Sin Registro V2' :
                   response.comparison.status === 'v2_invalid' ? 'Documento V2 Inválido Excluido' :
                   'Diferencia Inesperada'}
                </h3>
              </div>

              {response.comparison.differences && response.comparison.differences.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-bold text-slate-500 uppercase mb-2">Diferencias Detectadas</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left border border-slate-200 rounded-lg overflow-hidden">
                      <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                        <tr>
                          <th className="px-4 py-2 border-b border-slate-200">Campo</th>
                          <th className="px-4 py-2 border-b border-slate-200">Valor Legacy</th>
                          <th className="px-4 py-2 border-b border-slate-200">Valor V2</th>
                          <th className="px-4 py-2 border-b border-slate-200 text-center">Severidad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {response.comparison.differences.map((diff, idx) => (
                          <tr key={idx} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                            <td className="px-4 py-2 font-medium text-slate-700">{diff.field}</td>
                            <td className="px-4 py-2 text-slate-600 break-all">{JSON.stringify(diff.legacyValue)}</td>
                            <td className="px-4 py-2 text-slate-600 break-all">{JSON.stringify(diff.v2Value)}</td>
                            <td className="px-4 py-2 text-center">
                              <span className={`px-2 py-1 text-[10px] font-bold uppercase rounded-md ${
                                diff.severity === 'high' ? 'bg-rose-100 text-rose-700' :
                                diff.severity === 'medium' ? 'bg-amber-100 text-amber-700' :
                                'bg-blue-100 text-blue-700'
                              }`}>
                                {diff.severity}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MAIN CONTENT AREA */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            
            {/* LEGACY PANEL */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 border-b border-slate-200 p-4">
                <h3 className="font-bold text-slate-800">Modelo actual — Legacy</h3>
              </div>
              <div className="p-4 space-y-4">
                {response.legacyResult.items.length === 0 ? (
                  <p className="text-sm text-slate-500 italic">No hay registros Legacy en esta página.</p>
                ) : (
                  response.legacyResult.items.map(legacy => (
                    <div key={legacy.id} className="border border-slate-200 rounded-lg p-4 bg-slate-50 relative">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-bold text-sm text-slate-800">{legacy.employeeName || legacy.employeeId}</p>
                          <p className="text-xs text-slate-500">{legacy.jornadaDate}</p>
                        </div>
                        <span className={`px-2 py-1 text-[10px] font-bold uppercase rounded-md ${legacy.status === 'closed' ? 'bg-slate-200 text-slate-700' : 'bg-green-100 text-green-700'}`}>
                          {legacy.status === 'closed' ? 'Cerrado' : 'Abierto'}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                        <div>
                          <span className="text-slate-400 block uppercase font-bold text-[9px]">Entrada</span>
                          <span className="text-slate-700 font-medium">{legacy.checkInAt ? new Date(legacy.checkInAt).toLocaleTimeString() : '---'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block uppercase font-bold text-[9px]">Salida</span>
                          <span className="text-slate-700 font-medium">{legacy.checkOutAt ? new Date(legacy.checkOutAt).toLocaleTimeString() : '---'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block uppercase font-bold text-[9px]">Sucursal</span>
                          <span className="text-slate-700 font-medium truncate" title={legacy.sucursalNombre || legacy.sucursalId || ''}>{legacy.sucursalNombre || legacy.sucursalId || '---'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block uppercase font-bold text-[9px]">Minutos</span>
                          <span className="text-slate-700 font-medium">{legacy.workedMinutes !== null ? legacy.workedMinutes : '---'}</span>
                        </div>
                      </div>

                      {legacy.limitations && legacy.limitations.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-200">
                          <p className="text-[10px] font-bold text-amber-600 uppercase mb-1">Limitaciones Legacy</p>
                          <div className="flex flex-wrap gap-1">
                            {legacy.limitations.map(lim => (
                              <span key={lim} className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded text-[9px] border border-amber-200">
                                {lim}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* V2 PANEL */}
            <div className="bg-white rounded-xl shadow-sm border border-indigo-200 overflow-hidden">
              <div className="bg-indigo-50 border-b border-indigo-200 p-4">
                <h3 className="font-bold text-indigo-900">Modelo multiturno — V2</h3>
              </div>
              <div className="p-4 space-y-4">
                {(!response.v2Result || !response.v2Result.items || response.v2Result.items.length === 0) ? (
                  <p className="text-sm text-slate-500 italic">No hay registros V2 para estos parámetros.</p>
                ) : (
                  response.v2Result.items.map((v2: any) => (
                    <div key={v2.id} className="border border-indigo-100 rounded-lg p-4 bg-white shadow-sm relative">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-bold text-sm text-slate-800">{v2.employeeName || v2.employeeId}</p>
                          <p className="text-xs text-slate-500">{v2.jornadaDate} • <span className="text-indigo-600 font-medium">{v2.tipoOperacion}</span></p>
                        </div>
                        <div className="flex gap-2">
                          <span className={`px-2 py-1 text-[10px] font-bold uppercase rounded-md ${v2.status === 'closed' ? 'bg-slate-200 text-slate-700' : 'bg-green-100 text-green-700'}`}>
                            {v2.status === 'closed' ? 'Cerrado' : 'Abierto'}
                          </span>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                        <div>
                          <span className="text-slate-400 block uppercase font-bold text-[9px]">Entrada</span>
                          <span className="text-slate-700 font-medium">{v2.checkInAt ? new Date(v2.checkInAt).toLocaleTimeString() : '---'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block uppercase font-bold text-[9px]">Salida</span>
                          <span className="text-slate-700 font-medium">{v2.checkOutAt ? new Date(v2.checkOutAt).toLocaleTimeString() : '---'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block uppercase font-bold text-[9px]">Sucursal (Resolución: {v2.sucursalResolution})</span>
                          <span className="text-slate-700 font-medium truncate" title={v2.sucursalNombre || v2.sucursalId || ''}>{v2.sucursalNombre || v2.sucursalId || '---'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block uppercase font-bold text-[9px]">Minutos (Cierre: {v2.closureType})</span>
                          <span className="text-slate-700 font-medium">{v2.workedMinutes !== null ? v2.workedMinutes : '---'}</span>
                        </div>
                      </div>

                      {v2.warnings && v2.warnings.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-100">
                          <p className="text-[10px] font-bold text-amber-600 uppercase mb-1">Advertencias</p>
                          <div className="flex flex-wrap gap-1">
                            {v2.warnings.map((w: string) => (
                              <span key={w} className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded text-[9px] border border-amber-200">
                                {w}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

          {/* PAGINATION CONTROLS */}
          <div className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <button
              onClick={previousPage}
              disabled={!hasPreviousPage || loading}
              className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 font-medium hover:bg-slate-100 disabled:opacity-50"
            >
              <ChevronLeft className="w-4 h-4" />
              Anterior
            </button>
            <span className="text-sm text-slate-500 font-medium">Paginación gestionada por cursores seguros</span>
            <button
              onClick={nextPage}
              disabled={!hasNextPage || loading}
              className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 font-medium hover:bg-slate-100 disabled:opacity-50"
            >
              Siguiente
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
