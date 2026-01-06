
import React, { useState, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Search, Plus, UserCheck, UserX, Eye, FileSpreadsheet, Loader2, Building2, Sparkles } from 'lucide-react';
import EmployeeModal from '../components/EmployeeModal';
import AddEmployeeModal from '../components/AddEmployeeModal';
import { AIEmployeeModal } from '../components/AIEmployeeModal';
import * as XLSX from 'xlsx';

const EmployeesPage: React.FC = () => {
  const { employees, sites, toggleEmployeeStatus, bulkAddEmployees, isLoading, showNotification } = useAppStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [filterCompany, setFilterCompany] = useState<string>(''); // Nuevo estado para filtro empresa
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Obtener lista única de empresas desde las sucursales
  const uniqueCompanies = Array.from(new Set(
    sites.map(s => s.empresa).filter(e => e && e.trim() !== '')
  )).sort();

  // Filtrado
  const filteredEmployees = employees.filter(e => {
    const term = searchTerm.toLowerCase();
    // Convertir a string y minúsculas para búsqueda segura
    const fName = String(e.firstName || '').toLowerCase();
    const lName = String(e.lastNamePaterno || '').toLowerCase();
    const rut = String(e.rut || '').toLowerCase();

    // 1. Filtro Texto
    const matchesSearch =
      fName.includes(term) ||
      lName.includes(term) ||
      rut.includes(term);

    // 2. Filtro Estado
    const matchesStatus =
      filterStatus === 'all' ? true :
        filterStatus === 'active' ? e.isActive :
          !e.isActive;

    // 3. Filtro Empresa (Derivado de la sucursal asignada)
    const matchesCompany = filterCompany === '' ? true : (() => {
      if (!e.currentSiteId) return false; // Si no tiene sucursal, no pertenece a la empresa filtrada
      const assignedSite = sites.find(s => s.id === e.currentSiteId);
      return assignedSite?.empresa === filterCompany;
    })();

    return matchesSearch && matchesStatus && matchesCompany;
  });

  // Utilidad para parsear fechas de Excel (serial o string)
  const parseExcelDate = (val: any): string | undefined => {
    if (!val) return undefined;
    // Serial de Excel (ej: 44500)
    if (typeof val === 'number') {
      const date = new Date(Math.round((val - 25569) * 86400 * 1000));
      return date.toISOString().split('T')[0];
    }
    // String formato dd/mm/aa o dd/mm/yyyy
    if (typeof val === 'string') {
      const parts = val.trim().split('/');
      if (parts.length === 3) {
        let day = parseInt(parts[0]);
        let month = parseInt(parts[1]);
        let year = parseInt(parts[2]);
        // Ajustar año corto (ej: 85 -> 1985, 20 -> 2020)
        if (year < 100) {
          year = year < 50 ? 2000 + year : 1900 + year;
        }
        const date = new Date(year, month - 1, day);
        if (!isNaN(date.getTime())) {
          // Retornar formato ISO YYYY-MM-DD
          return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }
    }
    return undefined;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];

        // Leer como JSON array de arrays para manejar headers complejos
        const data: any[] = XLSX.utils.sheet_to_json(ws);

        if (data.length === 0) {
          showNotification("El archivo parece estar vacío.", "warning");
          return;
        }

        console.log("Datos crudos Excel (primeras filas):", data.slice(0, 3));

        // Función auxiliar para encontrar columnas con nombres flexibles
        const getValue = (row: any, possibleKeys: string[]): any => {
          const rowKeys = Object.keys(row);
          // Buscar coincidencia insensible a mayúsculas, acentos y saltos de línea (\r\n)
          const foundKey = rowKeys.find(k => {
            // Normalizar key del excel: quitar saltos de linea, espacios extra, minusculas
            const normalizedK = k.toLowerCase().replace(/[\r\n]+/g, ' ').trim();
            return possibleKeys.some(pk => {
              const normalizedPK = pk.toLowerCase().replace(/[\r\n]+/g, ' ').trim();
              return normalizedK.includes(normalizedPK); // Includes para mayor flexibilidad
            });
          });
          return foundKey ? row[foundKey] : undefined;
        };

        // Mapeo de columnas Excel -> App Model
        const newEmployees = data.map(row => {
          // 1. RUT y Nombres (Obligatorios)
          const rut = getValue(row, ['RUT', 'DNI']);
          const nombres = getValue(row, ['NOMBRES', 'Nombres', 'Nombre']);

          if (!rut || !nombres) {
            return null;
          }

          // 2. Estado (Servicio On/OFF)
          const servicioStr = String(getValue(row, ['Servicio On/OFF', 'Servicio', 'Estado Servicio']) || '').toLowerCase().trim();
          let isActive = true; // Default
          if (servicioStr) {
            if (servicioStr.includes('vigente') || servicioStr === 'on' || servicioStr === 'activo') {
              isActive = true;
            } else if (servicioStr.includes('desactivado') || servicioStr === 'off' || servicioStr === 'inactivo') {
              isActive = false;
            }
          }

          // 3. Sueldo Liquido (Parsear moneda)
          let sueldoVal = getValue(row, ['SUELDO LIQUIDO', 'Sueldo Líquido']);
          let sueldoNumber = 0;
          if (typeof sueldoVal === 'number') {
            sueldoNumber = sueldoVal;
          } else if (typeof sueldoVal === 'string') {
            // Limpiar "$", ".", ","
            sueldoNumber = parseInt(sueldoVal.replace(/[^0-9]/g, ''), 10) || 0;
          }

          // 4. Lógica de Asignación de Sitio/Empresa
          // Buscamos columnas como "Obra", "Sucursal", "Faena" o "Empresa", "Cliente"
          const excelSiteName = getValue(row, ['Obra', 'Faena', 'Sucursal', 'Instalación', 'Ubicación']);
          const excelCompanyName = getValue(row, ['Empresa', 'Cliente', 'Mandante']);

          let matchedSiteId = undefined;

          // Prioridad 1: Coincidencia por Nombre de Sucursal
          if (excelSiteName) {
            const foundSite = sites.find(s =>
              s.name.toLowerCase().trim() === String(excelSiteName).toLowerCase().trim()
            );
            if (foundSite) matchedSiteId = foundSite.id;
          }

          // Prioridad 2: Si no hay sucursal, intentar por Empresa (Asigna a la primera sucursal de esa empresa)
          if (!matchedSiteId && excelCompanyName) {
            const foundSiteByCompany = sites.find(s =>
              s.empresa?.toLowerCase().trim() === String(excelCompanyName).toLowerCase().trim()
            );
            if (foundSiteByCompany) matchedSiteId = foundSiteByCompany.id;
          }

          return {
            firstName: String(nombres).trim(),
            lastNamePaterno: String(getValue(row, ['APELLIDO PATERNO', 'Paterno']) || '').trim(),
            lastNameMaterno: String(getValue(row, ['APELLIDO MATERNO', 'Materno']) || '').trim(),
            rut: String(rut).trim(),
            cargo: String(getValue(row, ['CARGO', 'Puesto']) || 'Guardia').trim(),
            email: String(getValue(row, ['E-MAIL', 'Email', 'Correo']) || '').trim(),
            phone: String(getValue(row, ['TELEFONO CONTACTO', 'Telefono']) || '').replace(/[\r\n]/g, ''),

            nacionalidad: getValue(row, ['NACIONALIDAD', 'País']),
            fechaNacimiento: parseExcelDate(getValue(row, ['FECHA DE NACIMIENTO FORMATO', 'FECHA DE NACIMIENTO', 'Nacimiento'])),
            estadoCivil: getValue(row, ['ESTADO CIVIL', 'Civil']),
            direccion: getValue(row, ['DOMICILIO', 'Direccion']),
            salud: getValue(row, ['SALUD', 'Isapre']),
            afp: getValue(row, ['AFP', 'Prevision']),
            sueldoLiquido: sueldoNumber,

            // Fechas laborales específicas
            fechaVencimientoOS10: parseExcelDate(getValue(row, ['curso o.s.10', 'Vencimiento OS10'])),
            fechaTerminoContrato: parseExcelDate(getValue(row, ['TERMINO', 'Fin Contrato', 'Termino Contrato'])),

            isActive: isActive,
            currentSiteId: matchedSiteId, // Asignación automática
          };
        }).filter(item => item !== null);

        if (newEmployees.length > 0) {
          await bulkAddEmployees(newEmployees);
          showNotification(`Se procesaron ${newEmployees.length} registros.`, "success");
        } else {
          showNotification("No se pudieron procesar filas válidas.", "error");
        }

      } catch (error) {
        console.error("Error parsing Excel", error);
        showNotification("Hubo un error al procesar el archivo.", "error");
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  // Helper to safely get selected employee
  const selectedEmployee = selectedEmployeeId ? employees.find(e => e.id === selectedEmployeeId) : null;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gestión de Personal</h1>
          <p className="text-slate-500">Administración de expedientes y colaboradores</p>
        </div>
        <div className="flex gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx, .xls"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            title="Soporta columnas: 'Empresa', 'Sucursal' u 'Obra' para asignación automática"
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-lg font-medium flex items-center gap-2 shadow-lg shadow-green-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? <Loader2 size={20} className="animate-spin" /> : <FileSpreadsheet size={20} />}
            {isLoading ? 'Cargando...' : 'Importar Excel'}
          </button>
          <button
            onClick={() => setShowAIModal(true)}
            className="bg-slate-900 hover:bg-black text-white px-4 py-2.5 rounded-lg font-medium flex items-center gap-2 shadow-lg transition"
          >
            <Sparkles size={20} className="text-orange-400" /> Alta por IA
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg font-medium flex items-center gap-2 shadow-lg shadow-blue-200 transition"
          >
            <Plus size={20} /> Nuevo Empleado
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex flex-col xl:flex-row gap-4 items-center justify-between">

        <div className="flex flex-col md:flex-row gap-4 w-full xl:w-auto">
          {/* Filtro Estado */}
          <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg border border-slate-200 shrink-0">
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${filterStatus === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Todos
            </button>
            <button
              onClick={() => setFilterStatus('active')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition flex items-center gap-1 ${filterStatus === 'active' ? 'bg-white text-green-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <UserCheck size={14} /> Activos
            </button>
            <button
              onClick={() => setFilterStatus('inactive')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition flex items-center gap-1 ${filterStatus === 'inactive' ? 'bg-white text-red-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <UserX size={14} /> Inactivos
            </button>
          </div>

          {/* Filtro Empresa */}
          <div className="relative w-full md:w-64">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <select
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
              className="w-full pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-900 appearance-none cursor-pointer"
            >
              <option value="">Todas las Empresas</option>
              {uniqueCompanies.map((company, idx) => (
                <option key={idx} value={company}>{company}</option>
              ))}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
          </div>
        </div>

        {/* Buscador Texto */}
        <div className="relative w-full xl:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Buscar por RUT o Nombre..."
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-900"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                <th className="px-6 py-4">Colaborador</th>
                <th className="px-6 py-4">RUT</th>
                <th className="px-6 py-4">Cargo / Empresa</th>
                <th className="px-6 py-4">Contacto</th>
                <th className="px-6 py-4 text-center">Estado</th>
                <th className="px-6 py-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    No se encontraron colaboradores con los filtros actuales.
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => {
                  const assignedSite = sites.find(s => s.id === emp.currentSiteId);
                  const companyName = assignedSite?.empresa || 'Sin Empresa Asignada';

                  return (
                    <tr key={emp.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-900">{emp.firstName}</div>
                        <div className="text-xs text-slate-500">{emp.lastNamePaterno} {emp.lastNameMaterno}</div>
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-500">{emp.rut}</td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                          {emp.cargo}
                        </span>
                        <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                          <Building2 size={10} /> {companyName}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs">{emp.email || '-'}</div>
                        <div className="text-xs text-slate-400">{emp.phone || '-'}</div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => toggleEmployeeStatus(emp.id)}
                          className={`transition-all duration-200 px-3 py-1 rounded-full text-xs font-semibold border ${emp.isActive ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'}`}
                        >
                          {emp.isActive ? 'Activo' : 'Inactivo'}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => setSelectedEmployeeId(emp.id)}
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="Ver Ficha"
                        >
                          <Eye size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedEmployee && (
        <EmployeeModal
          employee={selectedEmployee}
          onClose={() => setSelectedEmployeeId(null)}
        />
      )}

      {showAIModal && (
        <AIEmployeeModal onClose={() => setShowAIModal(false)} />
      )}

      {showAddModal && (
        <AddEmployeeModal onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
};

export default EmployeesPage;
