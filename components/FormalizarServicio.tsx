import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Search, MapPin, ArrowLeft, Copy, X, Table as TableIcon } from 'lucide-react';

interface FormalizarServicioProps {
  onBack: () => void;
}

const FormalizarServicio: React.FC<FormalizarServicioProps> = ({ onBack }) => {
  const { employees, sites, showNotification } = useAppStore();

  const [formalizarData, setFormalizarData] = useState({
    supervisor: 'Andres Castro',
    proveedor: 'Aspro',
    sucursalId: '',
    motivo: '',
    fechaInicio: '',
    fechaTermino: '',
    horaInicio: '08:00',
    horaTermino: '20:00',
    empleadoId: ''
  });
  const [formalizarSiteSearch, setFormalizarSiteSearch] = useState('');
  const [formalizarEmpSearch, setFormalizarEmpSearch] = useState('');
  const [showFormalizarSiteList, setShowFormalizarSiteList] = useState(false);
  const [showFormalizarEmpList, setShowFormalizarEmpList] = useState(false);
  const formalizarSiteRef = useRef<HTMLDivElement>(null);
  const formalizarEmpRef = useRef<HTMLDivElement>(null);
  const [formalizarRows, setFormalizarRows] = useState<any[]>([]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (formalizarSiteRef.current && !formalizarSiteRef.current.contains(event.target as Node)) setShowFormalizarSiteList(false);
      if (formalizarEmpRef.current && !formalizarEmpRef.current.contains(event.target as Node)) setShowFormalizarEmpList(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredFormalizarSites = useMemo(() => {
    const lower = formalizarSiteSearch.toLowerCase();
    return sites.filter(s =>
      s.empresa?.toLowerCase().includes('falabella') &&
      s.name.toLowerCase().includes(lower)
    );
  }, [sites, formalizarSiteSearch]);

  const filteredFormalizarEmp = useMemo(() => {
    const lower = formalizarEmpSearch.toLowerCase();
    return employees.filter(e =>
      e.isActive && (e.firstName.toLowerCase().includes(lower) || e.lastNamePaterno.toLowerCase().includes(lower) || e.rut.toLowerCase().includes(lower))
    );
  }, [employees, formalizarEmpSearch]);

  const formalizarEmp = employees.find(e => String(e.id) === formalizarData.empleadoId);
  const formalizarSite = sites.find(s => String(s.id) === formalizarData.sucursalId);

  const formatDateForText = (dateStr: string) => {
    if (!dateStr) return '[Día ingresado]';
    const [year, month, day] = dateStr.split('-');
    return `${day}-${month}-${year}`;
  };

  return (
    <div className="animate-in slide-in-from-bottom-4 duration-300 space-y-6">
      <div className="flex items-center justify-between border-b border-slate-200 pb-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-3 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 text-slate-500 transition-all hover:scale-105"
          >
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-xl font-bold text-slate-800">Formalizar Servicio Falabella</h2>
        </div>
        {formalizarRows.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFormalizarRows([])}
              className="px-4 py-2 border border-slate-200 text-slate-500 rounded-lg font-bold text-sm hover:bg-slate-50 transition"
            >
              Limpiar Lista
            </button>
            <button
              onClick={async () => {
                const header = ["Supervisor", "Fecha de solicitud de servicio", "Proveedor", "Motivo Solicitud", "Sucursal", "Dirección Sucursal", "Cant. Días", "Fecha Inicio servicio", "Fecha Termino Servicio", "Hora Inicio servicio", "Hora Termino Servicio", "Rut Guardia Seguridad", "Nombre de Guardia", "Fecha de Nacimiento", "Sexo", "Teléfono"];

                const rowsHtml = formalizarRows.map(row => `
                  <tr style="height: auto;">
                    <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; white-space: nowrap;">${row.supervisor}</td>
                    <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.fechaSolicitud}</td>
                    <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; white-space: nowrap;">${row.proveedor}</td>
                    <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle;">${row.motivo}</td>
                    <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; white-space: nowrap;">${row.sucursal}</td>
                    <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; line-height: 1.1;">${row.direccion}</td>
                    <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle;"></td>
                    <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.fechaInicio}</td>
                    <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.fechaTermino}</td>
                    <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.horaInicio}</td>
                    <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.horaTermino}</td>
                    <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.rut}</td>
                    <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; font-weight: bold; white-space: nowrap;">${row.nombre}</td>
                    <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.fechaNacimiento}</td>
                    <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.sexo}</td>
                    <td style="padding: 1px 4px; border: 1px solid #000; vertical-align: middle; text-align: center; white-space: nowrap;">${row.telefono}</td>
                  </tr>
                `).join('');

                const tableHtml = `
                  <table border="1" style="border-collapse: collapse; font-family: Calibri, sans-serif; font-size: 10pt; width: max-content; line-height: 1.1;">
                    <tr style="background-color: #92d050; text-align: left;">
                      ${header.map(h => {
                  let style = "padding: 2px 4px; border: 1px solid #000; font-weight: bold; text-decoration: underline; vertical-align: middle; white-space: nowrap;";
                  if (h === "Dirección Sucursal") style = style.replace('white-space: nowrap;', '') + " width: 250pt;";
                  else if (h === "Nombre de Guardia") style += " width: 110pt;";
                  return `<th style="${style}">${h}</th>`;
                }).join('')}
                    </tr>
                    ${rowsHtml}
                  </table>
                `;

                const plainText = header.join('\t') + '\n' +
                  formalizarRows.map(row => [
                    row.supervisor, row.fechaSolicitud, row.proveedor, row.motivo, row.sucursal, row.direccion, "",
                    row.fechaInicio, row.fechaTermino, row.horaInicio, row.horaTermino, row.rut, row.nombre,
                    row.fechaNacimiento, row.sexo, row.telefono
                  ].join('\t')).join('\n');

                try {
                  const blobHtml = new Blob([tableHtml], { type: 'text/html' });
                  const blobText = new Blob([plainText], { type: 'text/plain' });
                  const data = [new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })];
                  await navigator.clipboard.write(data);
                  showNotification(`¡Copiadas ${formalizarRows.length} filas al portapapeles!`, "success");
                } catch (err) {
                  navigator.clipboard.writeText(plainText);
                  showNotification("Copiado como texto plano.", "info");
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-sm hover:bg-blue-700 transition shadow-lg shadow-blue-100"
            >
              <Copy size={16} /> Copiar {formalizarRows.length} {formalizarRows.length === 1 ? 'Fila' : 'Filas'} para Excel
            </button>
          </div>
        )}
      </div>

      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">

          {/* Supervisor y Proveedor */}
          <div className="space-y-4">
            <div className="flex flex-col space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Supervisor</label>
              <select
                className="w-full px-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-t-lg transition-colors"
                value={formalizarData.supervisor}
                onChange={(e) => setFormalizarData({ ...formalizarData, supervisor: e.target.value })}
              >
                <option value="Andres Castro">Andres Castro</option>
                <option value="Patricia Yevenes">Patricia Yevenes</option>
              </select>
            </div>
            <div className="flex flex-col space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Proveedor</label>
              <input
                type="text"
                readOnly
                className="w-full px-4 py-2 text-sm border-b-2 border-slate-100 bg-slate-100 text-slate-500 rounded-t-lg outline-none"
                value={formalizarData.proveedor}
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Motivo Solicitud</label>
              <input
                type="text"
                placeholder="Ej: Refuerzo por evento"
                className="w-full px-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-t-lg transition-colors"
                value={formalizarData.motivo}
                onChange={(e) => setFormalizarData({ ...formalizarData, motivo: e.target.value })}
              />
            </div>
          </div>

          {/* Sucursal y Horarios */}
          <div className="space-y-4">
            <div className="flex flex-col space-y-1 relative" ref={formalizarSiteRef}>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sucursal (Falabella)</label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                <input
                  type="text"
                  placeholder="Buscar sucursal..."
                  className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-t-lg transition-colors cursor-pointer"
                  value={formalizarSiteSearch}
                  onFocus={() => {
                    setFormalizarSiteSearch('');
                    setShowFormalizarSiteList(true);
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      if (!formalizarSiteSearch && formalizarData.sucursalId) {
                        const s = sites.find(site => String(site.id) === formalizarData.sucursalId);
                        if (s) setFormalizarSiteSearch(s.name);
                      }
                      setShowFormalizarSiteList(false);
                    }, 200);
                  }}
                  onChange={(e) => { setFormalizarSiteSearch(e.target.value); setShowFormalizarSiteList(true); }}
                />
              </div>
              {showFormalizarSiteList && (
                <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-2xl max-h-60 overflow-auto z-[110]">
                  {filteredFormalizarSites.map(s => (
                    <div
                      key={s.id}
                      className="px-4 py-2 hover:bg-blue-50 cursor-pointer border-b border-slate-50"
                      onClick={() => {
                        setFormalizarData({ ...formalizarData, sucursalId: String(s.id) });
                        setFormalizarSiteSearch(s.name);
                        setShowFormalizarSiteList(false);
                      }}
                    >
                      <div className="text-sm font-bold text-slate-700">{s.name}</div>
                      <div className="text-[10px] text-slate-400">{s.address}</div>
                    </div>
                  ))}
                  {filteredFormalizarSites.length === 0 && <div className="p-4 text-xs text-slate-400 italic text-center">No hay sucursales Falabella</div>}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Hora Inicio</label>
                <input
                  type="time"
                  className="w-full px-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-lg"
                  value={formalizarData.horaInicio}
                  onChange={(e) => setFormalizarData({ ...formalizarData, horaInicio: e.target.value })}
                />
              </div>
              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Hora Término</label>
                <input
                  type="time"
                  className="w-full px-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-lg"
                  value={formalizarData.horaTermino}
                  onChange={(e) => setFormalizarData({ ...formalizarData, horaTermino: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fecha Inicio</label>
                <input
                  type="date"
                  className="w-full px-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-lg"
                  value={formalizarData.fechaInicio}
                  onChange={(e) => setFormalizarData({ ...formalizarData, fechaInicio: e.target.value })}
                />
              </div>
              <div className="flex flex-col space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Fecha Término</label>
                <input
                  type="date"
                  className="w-full px-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-lg"
                  value={formalizarData.fechaTermino}
                  onChange={(e) => setFormalizarData({ ...formalizarData, fechaTermino: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Colaborador */}
          <div className="space-y-4">
            <div className="flex flex-col space-y-1 relative" ref={formalizarEmpRef}>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nombre Guardia</label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                <input
                  type="text"
                  placeholder="Filtrar por nombre o RUT..."
                  className="w-full pl-9 pr-4 py-2 text-sm border-b-2 border-slate-100 focus:border-blue-500 outline-none bg-slate-50 rounded-t-lg transition-colors cursor-pointer"
                  value={formalizarEmpSearch}
                  onFocus={() => {
                    setFormalizarEmpSearch('');
                    setShowFormalizarEmpList(true);
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      if (!formalizarEmpSearch && formalizarData.empleadoId) {
                        const emp = employees.find(e => String(e.id) === formalizarData.empleadoId);
                        if (emp) setFormalizarEmpSearch(`${emp.firstName} ${emp.lastNamePaterno}`);
                      }
                      setShowFormalizarEmpList(false);
                    }, 200);
                  }}
                  onChange={(e) => { setFormalizarEmpSearch(e.target.value); setShowFormalizarEmpList(true); }}
                />
              </div>
              {showFormalizarEmpList && (
                <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-2xl max-h-60 overflow-auto z-[110]">
                  {filteredFormalizarEmp.map(e => (
                    <div
                      key={e.id}
                      className="px-4 py-2 hover:bg-blue-50 cursor-pointer border-b border-slate-50"
                      onClick={() => {
                        setFormalizarData({ ...formalizarData, empleadoId: String(e.id) });
                        setFormalizarEmpSearch(`${e.firstName} ${e.lastNamePaterno}`);
                        setShowFormalizarEmpList(false);
                      }}
                    >
                      <div className="text-sm font-bold text-slate-700">{e.firstName} {e.lastNamePaterno}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{e.rut}</div>
                    </div>
                  ))}
                  {filteredFormalizarEmp.length === 0 && <div className="p-4 text-xs text-slate-400 italic text-center">No se encontraron resultados</div>}
                </div>
              )}
            </div>

            <button
              disabled={!formalizarEmp || !formalizarSite || !formalizarData.fechaInicio}
              onClick={() => {
                if (!formalizarEmp || !formalizarSite) return;
                const newRow = {
                  id: Date.now(),
                  supervisor: formalizarData.supervisor,
                  fechaSolicitud: new Date().toLocaleDateString('es-CL'),
                  proveedor: formalizarData.proveedor,
                  motivo: formalizarData.motivo,
                  sucursal: formalizarSite.name,
                  direccion: formalizarSite.address,
                  fechaInicio: formatDateForText(formalizarData.fechaInicio),
                  fechaTermino: formatDateForText(formalizarData.fechaTermino),
                  horaInicio: formalizarData.horaInicio,
                  horaTermino: formalizarData.horaTermino,
                  rut: formalizarEmp.rut,
                  nombre: `${formalizarEmp.firstName} ${formalizarEmp.lastNamePaterno} ${formalizarEmp.lastNameMaterno || ''}`.trim(),
                  fechaNacimiento: formatDateForText(formalizarEmp.fechaNacimiento || ''),
                  sexo: formalizarEmp.sexo || '',
                  telefono: formalizarEmp.phone || ''
                };
                setFormalizarRows([...formalizarRows, newRow]);
                // Limpiar solo los campos variables
                setFormalizarData({
                  ...formalizarData,
                  motivo: '',
                  empleadoId: ''
                });
                setFormalizarEmpSearch('');
                showNotification("Fila agregada a la lista", "success");
              }}
              className="flex items-center gap-2 px-12 py-3 bg-emerald-600 text-white rounded-xl font-black uppercase text-xs tracking-widest hover:bg-emerald-700 transition shadow-lg shadow-emerald-100 disabled:opacity-50 disabled:grayscale w-full justify-center mt-6"
            >
              <TableIcon size={18} /> Agregar Fila a la Lista
            </button>
          </div>
        </div>

        {/* Vista Previa de la Tabla */}
        {formalizarRows.length > 0 && (
          <div className="space-y-4 pt-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Lista de Servicios a Formalizar ({formalizarRows.length})</h3>
            </div>
            <div className="overflow-x-auto border border-slate-100 rounded-xl">
              <table className="w-full text-left text-[10px]">
                <thead className="bg-slate-50 text-slate-500 font-bold">
                  <tr>
                    <th className="px-3 py-2 border-r border-slate-100">Supervisor</th>
                    <th className="px-3 py-2 border-r border-slate-100">Motivo</th>
                    <th className="px-3 py-2 border-r border-slate-100">Sucursal</th>
                    <th className="px-3 py-2 border-r border-slate-100">Inicio</th>
                    <th className="px-3 py-2 border-r border-slate-100">Fin</th>
                    <th className="px-3 py-2 border-r border-slate-100">Horario</th>
                    <th className="px-3 py-2 border-r border-slate-100">RUT</th>
                    <th className="px-3 py-2 border-r border-slate-100">Nombre</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {formalizarRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2 border-r border-slate-100">{row.supervisor}</td>
                      <td className="px-3 py-2 border-r border-slate-100">{row.motivo}</td>
                      <td className="px-3 py-2 border-r border-slate-100 text-blue-600 font-bold">{row.sucursal}</td>
                      <td className="px-3 py-2 border-r border-slate-100">{row.fechaInicio}</td>
                      <td className="px-3 py-2 border-r border-slate-100">{row.fechaTermino}</td>
                      <td className="px-3 py-2 border-r border-slate-100">{row.horaInicio} - {row.horaTermino}</td>
                      <td className="px-3 py-2 border-r border-slate-100 font-mono">{row.rut}</td>
                      <td className="px-3 py-2 border-r border-slate-100 font-bold">{row.nombre}</td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => setFormalizarRows(formalizarRows.filter(r => r.id !== row.id))}
                          className="text-red-400 hover:text-red-600 p-1"
                        >
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FormalizarServicio;
