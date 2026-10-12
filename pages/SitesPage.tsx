
import React, { useState, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Search, Plus, MapPin, Building2, FileSpreadsheet, Edit2, Clock } from 'lucide-react';
import AddSiteModal from '../components/AddSiteModal';
import * as XLSX from 'xlsx';
import { Site, DEFAULT_SITE_HORARIO } from '../types';

const SitesPage: React.FC = () => {
  const { sites, bulkAddSites, toggleSiteStatus, showNotification, currentUser, employees } = useAppStore();
  const isAdmin = currentUser?.role === 'admin';
  const currentEmp = employees.find(e => e.id === currentUser?.uid);

  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredSites = sites.filter(s => {
    const cargosStr = (s.cargosFijos || ['Chaleco Anticorte']).join(' ').toLowerCase();
    const horarioStr = `${s.horario?.inicio || DEFAULT_SITE_HORARIO.inicio} ${s.horario?.termino || DEFAULT_SITE_HORARIO.termino}`.toLowerCase();
    const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.empresa && s.empresa.toLowerCase().includes(searchTerm.toLowerCase())) ||
      cargosStr.includes(searchTerm.toLowerCase()) ||
      horarioStr.includes(searchTerm.toLowerCase());
    
    if (currentUser?.role === 'supervisor') {
      return matchesSearch && currentEmp?.assignedSites?.includes(s.id);
    }
    return matchesSearch;
  });

  const handleOpenAdd = () => {
    setEditingSite(null);
    setShowModal(true);
  };

  const handleOpenEdit = (site: Site) => {
    setEditingSite(site);
    setShowModal(true);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    // Usar ArrayBuffer para mejor manejo de codificación
    reader.onload = async (evt) => {
      try {
        const data = evt.target?.result;
        const wb = XLSX.read(data, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];

        // Obtener JSON crudo
        const jsonData: any[] = XLSX.utils.sheet_to_json(ws);

        if (jsonData.length === 0) {
          showNotification("El archivo está vacío.", "warning");
          return;
        }

        console.log("Datos Excel Raw:", jsonData);

        // Función auxiliar para encontrar columnas con nombres flexibles
        const getValue = (row: any, possibleKeys: string[]): string => {
          const rowKeys = Object.keys(row);
          // Buscar coincidencia insensible a mayúsculas/acentos
          const foundKey = rowKeys.find(k => {
            const normalizedK = k.toLowerCase().trim();
            return possibleKeys.some(pk => normalizedK === pk.toLowerCase().trim());
          });

          return foundKey ? String(row[foundKey]).trim() : '';
        };

        const newSites = jsonData.map(row => {
          // Mapeo flexible
          const empresa = getValue(row, ['Empresa', 'Cliente', 'Nombre Empresa']);
          const rutEmpresa = getValue(row, ['Rut E°', 'Rut E', 'Rut Empresa', 'Rut Cliente']);
          const name = getValue(row, ['Obra o Faena', 'Obra', 'Faena', 'Sucursal', 'Instalación', 'Nombre']);
          const address = getValue(row, ['Direccion', 'Dirección', 'Ubicación', 'Domicilio']);

          // Validar campos mínimos
          if (!name || !address) return null;

          return {
            empresa: empresa,
            rutEmpresa: rutEmpresa,
            name: name,
            address: address,
            cargosFijos: ['Chaleco Anticorte'],
            horario: { ...DEFAULT_SITE_HORARIO },
            active: true
          };
        }).filter(item => item !== null);

        if (newSites.length > 0) {
          await bulkAddSites(newSites);
          showNotification(`Importación exitosa: ${newSites.length} sucursales añadidas.`, "success");
        } else {
          showNotification("No se encontraron filas válidas.", "error");
        }

      } catch (error) {
        console.error("Error importando Excel", error);
        showNotification("Error al procesar el archivo Excel.", "error");
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gestión de Sucursales</h1>
          <p className="text-slate-500">Administración de obras e instalaciones</p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".xlsx, .xls"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg font-medium flex-1 sm:flex-none flex items-center justify-center gap-2 shadow-lg transition"
            >
              <FileSpreadsheet size={18} />
              <span className="text-sm">Importar</span>
            </button>
            <button
              onClick={handleOpenAdd}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg font-medium flex-1 sm:flex-none flex items-center justify-center gap-2 shadow-lg transition"
            >
              <Plus size={18} />
              <span className="text-sm">Nueva</span>
            </button>
          </div>
        )}
      </div>

      {/* Buscador */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Buscar por Nombre, Dirección, Empresa o Cargo Fijo..."
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-900"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Tabla de Sucursales */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[1050px] w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-4 py-3.5 whitespace-nowrap">Empresa / Cliente</th>
                <th className="px-4 py-3.5 whitespace-nowrap">RUT E°</th>
                <th className="px-4 py-3.5 whitespace-nowrap">Obra / Faena</th>
                <th className="px-4 py-3.5 whitespace-nowrap">Dirección</th>
                <th className="px-4 py-3.5 whitespace-nowrap">Horario</th>
                <th className="px-4 py-3.5 whitespace-nowrap">Cargos Fijos</th>
                <th className="px-4 py-3.5 text-center whitespace-nowrap">Estado</th>
                <th className="px-4 py-3.5 text-center whitespace-nowrap min-w-[90px]">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSites.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 flex flex-col items-center justify-center text-center">
                    <Building2 size={48} className="text-slate-200 mb-4" />
                    <p className="text-slate-400 font-medium">No se encontraron sucursales registradas.</p>
                  </td>
                </tr>
              ) : (
                filteredSites.map(site => {
                  const cargos = (site.cargosFijos && site.cargosFijos.length > 0)
                    ? site.cargosFijos
                    : ['Chaleco Anticorte'];
                  const horarioInicio = site.horario?.inicio || DEFAULT_SITE_HORARIO.inicio;
                  const horarioTermino = site.horario?.termino || DEFAULT_SITE_HORARIO.termino;

                  return (
                    <tr key={site.id} className={`hover:bg-slate-50 transition-colors ${!site.active ? 'bg-red-50/20' : ''}`}>
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-slate-800 whitespace-nowrap">{site.empresa || '-'}</div>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-slate-500 whitespace-nowrap">{site.rutEmpresa || '-'}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-blue-50 text-blue-600 rounded shrink-0">
                            <Building2 size={14} />
                          </div>
                          <span className="font-medium text-slate-900 truncate max-w-[200px]" title={site.name}>
                            {site.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2 text-slate-500">
                          <MapPin size={14} className="shrink-0 text-slate-400" />
                          <span className="truncate max-w-[220px]" title={site.address}>{site.address}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold whitespace-nowrap shadow-sm">
                          <Clock size={13} className="text-blue-500 shrink-0" />
                          <span>{horarioInicio} - {horarioTermino}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap gap-1 max-w-[240px]">
                          {cargos.map((cargo, i) => {
                            const isChaleco = cargo.toLowerCase().includes('chaleco');
                            return (
                              <span
                                key={i}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-md border whitespace-nowrap ${
                                  isChaleco
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    : 'bg-slate-50 text-slate-700 border-slate-200'
                                }`}
                              >
                                {cargo}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center whitespace-nowrap">
                        <button
                          onClick={() => isAdmin && toggleSiteStatus(site.id)}
                          disabled={!isAdmin}
                          className={`text-xs font-bold px-3 py-1 rounded-full border transition-all ${site.active ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'} ${!isAdmin ? 'cursor-default' : ''}`}
                        >
                          {site.active ? 'OPERATIVA' : 'INACTIVA'}
                        </button>
                      </td>
                      <td className="px-4 py-3.5 text-center whitespace-nowrap">
                        {isAdmin && (
                          <button
                            onClick={() => handleOpenEdit(site)}
                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition inline-flex items-center justify-center"
                            title="Modificar Datos"
                          >
                            <Edit2 size={18} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <AddSiteModal
          onClose={() => setShowModal(false)}
          siteToEdit={editingSite}
        />
      )}
    </div>
  );
};

export default SitesPage;
