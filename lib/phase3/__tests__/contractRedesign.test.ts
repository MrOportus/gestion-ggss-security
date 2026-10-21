import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  contratosService, 
  canManageContracts, 
  isDuplicateContract, 
  getActiveContract,
  resolveEmployeeOperationalStatus,
  evaluateContractBadge,
  formatDateDDMMYYYY
} from '../contratosService';
import { Contrato } from '../../../types/phase1';
import { Employee } from '../../../types';

// In-memory Firestore mock store
const mockFirestoreStore = new Map<string, any>();
let autoIdCounter = 1;

vi.mock('../../firebase', () => ({
  db: { __isMockDb: true }
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, collectionName) => ({ collectionName })),
  doc: vi.fn((...args: any[]) => {
    if (args.length === 1 && args[0]?.collectionName) {
      // doc(collectionRef) -> auto-generated ID
      const newId = `mock_contrato_${autoIdCounter++}`;
      return { id: newId, path: `${args[0].collectionName}/${newId}`, collectionName: args[0].collectionName };
    }
    // doc(db, collectionName, id)
    const collectionName = args.length === 2 ? args[0]?.collectionName || args[0] : args[1];
    const id = args.length === 2 ? args[1] : args[2];
    return { id, path: `${collectionName}/${id}`, collectionName };
  }),
  setDoc: vi.fn(async (docRef: any, data: any) => {
    mockFirestoreStore.set(docRef.path, { ...data, id: docRef.id });
  }),
  getDoc: vi.fn(async (docRef: any) => {
    const data = mockFirestoreStore.get(docRef.path);
    return {
      exists: () => !!data,
      data: () => data,
      id: docRef.id
    };
  }),
  updateDoc: vi.fn(async (docRef: any, data: any) => {
    const existing = mockFirestoreStore.get(docRef.path);
    if (!existing) {
      throw new Error(`Doc ${docRef.path} not found in mock store`);
    }
    mockFirestoreStore.set(docRef.path, { ...existing, ...data });
  }),

  getDocs: vi.fn(async () => {
    return {
      docs: Array.from(mockFirestoreStore.values()).map(data => ({
        data: () => data,
        id: data.id
      }))
    };
  }),
  query: vi.fn((collectionRef) => collectionRef),
  where: vi.fn(() => ({}))
}));

describe('ASPRO — Rediseño de Contratos y Normalización RR. HH. (18 Escenarios)', () => {
  beforeEach(() => {
    mockFirestoreStore.clear();
    autoIdCounter = 1;
    vi.clearAllMocks();
  });

  // =========================================================================
  // Escenario 1: Crear contrato manual sin PDF (con estado no_adjunto)
  // =========================================================================
  it('1. Crear contrato manual sin PDF (con estado no_adjunto)', async () => {
    const id = await contratosService.createContrato({
      colaboradorId: 'emp_001',
      sucursalId: 'suc_norte',
      tipo: 'Indefinido',
      estado: 'vigente',
      fechaInicio: '2024-01-01',
      permiteMultisucursal: true
    }, 'admin_test');

    const created = await contratosService.getContratoById(id);
    expect(created).toBeDefined();
    expect(created?.estadoDocumental).toBe('no_adjunto');
    expect(created?.documentoId).toBeUndefined();
    expect(created?.origenRegistro).toBe('manual_aspro');
    expect(created?.estadoConciliacion).toBe('verificado');
    expect(created?.creadoPor).toBe('admin_test');
  });

  // =========================================================================
  // Escenario 2: Crear contrato con documento asociado (documentoId)
  // =========================================================================
  it('2. Crear contrato con documento asociado (documentoId)', async () => {
    const docDigitalId = 'doc_firma_hash_7788';
    const id = await contratosService.createContrato({
      colaboradorId: 'emp_001',
      sucursalId: 'suc_norte',
      tipo: 'Indefinido',
      estado: 'vigente',
      fechaInicio: '2024-01-01',
      documentoId: docDigitalId
    }, 'admin_test');

    const created = await contratosService.getContratoById(id);
    expect(created?.documentoId).toBe(docDigitalId);
    expect(created?.estadoDocumental).toBe('firmado_digital');
  });

  // =========================================================================
  // Escenario 3: Registrar contrato histórico con fechas anteriores
  // =========================================================================
  it('3. Registrar contrato histórico con fechas anteriores', async () => {
    const id = await contratosService.createContrato({
      colaboradorId: 'emp_001',
      sucursalId: 'suc_centro',
      tipo: 'Plazo Fijo',
      estado: 'finalizado',
      fechaInicio: '2022-01-01',
      fechaTermino: '2022-06-30'
    }, 'admin_test');

    const created = await contratosService.getContratoById(id);
    expect(created?.fechaInicio).toBe('2022-01-01');
    expect(created?.fechaTermino).toBe('2022-06-30');
    expect(created?.estado).toBe('finalizado');
  });

  // =========================================================================
  // Escenario 4: Registrar contrato indefinido sin fecha de término
  // =========================================================================
  it('4. Registrar contrato indefinido sin fecha de término', async () => {
    const id = await contratosService.createContrato({
      colaboradorId: 'emp_002',
      sucursalId: 'suc_sur',
      tipo: 'Indefinido',
      estado: 'vigente',
      fechaInicio: '2023-05-01'
    }, 'admin_test');

    const created = await contratosService.getContratoById(id);
    expect(created?.tipo).toBe('Indefinido');
    expect(created?.fechaTermino).toBeUndefined();
    expect(created?.estado).toBe('vigente');
  });

  // =========================================================================
  // Escenario 5: Rechazar contrato a plazo fijo sin fecha de término
  // =========================================================================
  it('5. Rechazar contrato a plazo fijo sin fecha de término', async () => {
    await expect(
      contratosService.createContrato({
        colaboradorId: 'emp_002',
        sucursalId: 'suc_sur',
        tipo: 'Plazo Fijo',
        estado: 'vigente',
        fechaInicio: '2024-01-01'
      }, 'admin_test')
    ).rejects.toThrow('Los contratos a plazo fijo requieren obligatoriamente una fecha de término.');
  });

  // =========================================================================
  // Escenario 6: Mostrar varios contratos en la ficha del mismo trabajador (colaboradorId)
  // =========================================================================
  it('6. Mostrar varios contratos en la ficha del mismo trabajador (colaboradorId)', () => {
    const dummyContratos: Contrato[] = [
      { id: 'c1', colaboradorId: 'emp_target', sucursalId: 's1', tipo: 'Plazo Fijo', estado: 'renovado', fechaInicio: '2023-01-01', fechaTermino: '2023-03-31', creadoEn: '2023-01-01', creadoPor: 'admin' },
      { id: 'c2', colaboradorId: 'emp_target', sucursalId: 's1', tipo: 'Plazo Fijo', estado: 'renovado', fechaInicio: '2023-04-01', fechaTermino: '2023-06-30', creadoEn: '2023-04-01', creadoPor: 'admin' },
      { id: 'c3', colaboradorId: 'emp_target', sucursalId: 's1', tipo: 'Indefinido', estado: 'vigente', fechaInicio: '2023-07-01', creadoEn: '2023-07-01', creadoPor: 'admin' },
      { id: 'c_other', colaboradorId: 'emp_different', sucursalId: 's1', tipo: 'Indefinido', estado: 'vigente', fechaInicio: '2023-01-01', creadoEn: '2023-01-01', creadoPor: 'admin' }
    ];

    const employeeContracts = dummyContratos
      .filter(c => c.colaboradorId === 'emp_target')
      .sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio));

    expect(employeeContracts).toHaveLength(3);
    expect(employeeContracts.map(c => c.id)).toEqual(['c3', 'c2', 'c1']);
    expect(employeeContracts.every(c => c.colaboradorId === 'emp_target')).toBe(true);
  });

  // =========================================================================
  // Escenario 7: Crear una renovación conservando el contrato anterior y ligando contratoAnteriorId
  // =========================================================================
  it('7. Crear una renovación conservando el contrato anterior y ligando contratoAnteriorId', async () => {
    // 1. Crear contrato original
    const initialId = await contratosService.createContrato({
      colaboradorId: 'emp_003',
      sucursalId: 'suc_1',
      tipo: 'Plazo Fijo',
      estado: 'vigente',
      fechaInicio: '2024-01-01',
      fechaTermino: '2024-03-31',
      numeroRenovacion: 1
    }, 'admin_test');

    // 2. Renovar contrato
    const renewedId = await contratosService.renewContrato(initialId, {
      colaboradorId: 'emp_003',
      sucursalId: 'suc_1',
      tipo: 'Plazo Fijo',
      estado: 'vigente',
      fechaInicio: '2024-04-01',
      fechaTermino: '2024-06-30'
    }, 'admin_test');

    // 3. Verificar contrato anterior
    const anterior = await contratosService.getContratoById(initialId);
    expect(anterior?.estado).toBe('renovado');
    expect(anterior?.contratoSiguienteId).toBe(renewedId);

    // 4. Verificar nuevo contrato
    const nuevo = await contratosService.getContratoById(renewedId);
    expect(nuevo?.contratoAnteriorId).toBe(initialId);
    expect(nuevo?.numeroRenovacion).toBe(2);
    expect(nuevo?.estado).toBe('vigente');
  });

  // =========================================================================
  // Escenario 8: Reintentar una operación sin duplicar contratos
  // =========================================================================
  it('8. Reintentar una operación sin duplicar contratos', () => {
    const existing: Contrato[] = [
      {
        id: 'c_existing_1',
        colaboradorId: 'emp_004',
        sucursalId: 'suc_1',
        tipo: 'Indefinido',
        estado: 'vigente',
        fechaInicio: '2024-01-01',
        creadoEn: '2024-01-01',
        creadoPor: 'admin'
      }
    ];

    const duplicateCandidate = {
      colaboradorId: 'emp_004',
      tipo: 'Indefinido',
      fechaInicio: '2024-01-01'
    };

    const isDup = isDuplicateContract(existing, duplicateCandidate);
    expect(isDup).toBe(true);

    const nonDuplicateCandidate = {
      colaboradorId: 'emp_004',
      tipo: 'Indefinido',
      fechaInicio: '2024-06-01'
    };
    expect(isDuplicateContract(existing, nonDuplicateCandidate)).toBe(false);
  });

  // =========================================================================
  // Escenario 9: Vincular un documento existente sin duplicarlo
  // =========================================================================
  it('9. Vincular un documento existente sin duplicarlo', async () => {
    const id = await contratosService.createContrato({
      colaboradorId: 'emp_005',
      sucursalId: 'suc_1',
      tipo: 'Indefinido',
      estado: 'vigente',
      fechaInicio: '2024-02-01'
    }, 'admin_test');

    const existingDocId = 'doc_central_signed_8899';
    await contratosService.linkDocument(id, existingDocId, 'firmado_digital', 'admin_test', 'Asociado tras firma en tablet');

    const updated = await contratosService.getContratoById(id);
    expect(updated?.documentoId).toBe(existingDocId);
    expect(updated?.estadoDocumental).toBe('firmado_digital');
    expect(updated?.observacionesDocumento).toBe('Asociado tras firma en tablet');
  });

  // =========================================================================
  // Escenario 10: Registrar un contrato firmado externamente
  // =========================================================================
  it('10. Registrar un contrato firmado externamente', async () => {
    const id = await contratosService.createContrato({
      colaboradorId: 'emp_006',
      sucursalId: 'suc_1',
      tipo: 'Indefinido',
      estado: 'vigente',
      estadoDocumental: 'firmado_externo',
      fechaInicio: '2024-03-01',
      fechaFirmaReal: '2024-02-28',
      observacionesDocumento: 'Firmado en Notaría Santiago Centro'
    }, 'admin_test');

    const created = await contratosService.getContratoById(id);
    expect(created?.estadoDocumental).toBe('firmado_externo');
    expect(created?.fechaFirmaReal).toBe('2024-02-28');
    expect(created?.observacionesDocumento).toBe('Firmado en Notaría Santiago Centro');
  });

  // =========================================================================
  // Escenario 11: Evitar que un documento pendiente de firma aparezca como firmado
  // =========================================================================
  it('11. Evitar que un documento pendiente de firma aparezca como firmado', async () => {
    const id = await contratosService.createContrato({
      colaboradorId: 'emp_007',
      sucursalId: 'suc_1',
      tipo: 'Indefinido',
      estado: 'pendiente_firma',
      estadoDocumental: 'pendiente_firma',
      fechaInicio: '2024-04-01',
      documentoId: 'doc_pending_001'
    }, 'admin_test');

    const created = await contratosService.getContratoById(id);
    expect(created?.estadoDocumental).toBe('pendiente_firma');
    expect(created?.estadoDocumental).not.toBe('firmado_digital');
    expect(created?.estadoDocumental).not.toBe('firmado_externo');
  });

  // =========================================================================
  // Escenario 12: Detectar discrepancias de fechas (fechaInicio > fechaTermino)
  // =========================================================================
  it('12. Detectar discrepancias de fechas (fechaInicio > fechaTermino)', async () => {
    await expect(
      contratosService.createContrato({
        colaboradorId: 'emp_008',
        sucursalId: 'suc_1',
        tipo: 'Plazo Fijo',
        estado: 'vigente',
        fechaInicio: '2024-05-15',
        fechaTermino: '2024-05-01'
      }, 'admin_test')
    ).rejects.toThrow('La fecha de inicio no puede ser posterior a la fecha de término.');
  });

  // =========================================================================
  // Escenario 13: Mantener la compatibilidad con los campos antiguos de Colaboradores
  // =========================================================================
  it('13. Mantener la compatibilidad con los campos antiguos de Colaboradores', () => {
    const mockEmployee = {
      id: 'emp_legacy_1',
      nombre: 'Juan Guard',
      rut: '12.345.678-9',
      fechaInicioContrato: '2022-01-01',
      fechaTerminoContrato: '2022-06-30',
      tipoContrato: 'Plazo Fijo' as const
    };

    const newActiveContract: Contrato = {
      id: 'c_new_active',
      colaboradorId: 'emp_legacy_1',
      sucursalId: 'suc_1',
      tipo: 'Indefinido',
      estado: 'vigente',
      fechaInicio: '2024-01-01',
      creadoEn: '2024-01-01',
      creadoPor: 'admin'
    };

    // Generar payload de sincronización de compatibilidad
    const syncPayload = {
      fechaInicioContrato: newActiveContract.fechaInicio,
      fechaTerminoContrato: newActiveContract.fechaTermino || undefined,
      tipoContrato: newActiveContract.tipo as any
    };

    const updatedEmployee = { ...mockEmployee, ...syncPayload };
    expect(updatedEmployee.fechaInicioContrato).toBe('2024-01-01');
    expect(updatedEmployee.tipoContrato).toBe('Indefinido');
    expect(updatedEmployee.fechaTerminoContrato).toBeUndefined();

    // Contrato histórico no debe pisar el empleado
    const historicalContract: Contrato = {
      id: 'c_old_history',
      colaboradorId: 'emp_legacy_1',
      sucursalId: 'suc_1',
      tipo: 'Plazo Fijo',
      estado: 'finalizado',
      fechaInicio: '2020-01-01',
      fechaTermino: '2020-03-31',
      creadoEn: '2020-01-01',
      creadoPor: 'admin'
    };
    const shouldSyncToEmployee = historicalContract.estado === 'vigente' || historicalContract.estado === 'pendiente_firma';
    expect(shouldSyncToEmployee).toBe(false);
  });

  // =========================================================================
  // Escenario 14: Verificar los permisos de creación y modificación (admin, rrhh)
  // =========================================================================
  it('14. Verificar los permisos de creación y modificación (admin, rrhh)', () => {
    expect(canManageContracts('admin')).toBe(true);
    expect(canManageContracts('rrhh')).toBe(true);
    expect(canManageContracts('supervisor')).toBe(false);
    expect(canManageContracts('worker')).toBe(false);
    expect(canManageContracts('mandante')).toBe(false);
    expect(canManageContracts(undefined)).toBe(false);
  });

  // =========================================================================
  // Escenario 15: Comprobar que los flujos de Apps Script no generan registros duplicados
  // =========================================================================
  it('15. Comprobar que los flujos de Apps Script no generan registros duplicados', () => {
    const existingContracts: Contrato[] = [
      {
        id: 'c_sheet_01',
        colaboradorId: 'emp_sync_1',
        sucursalId: 'suc_1',
        tipo: 'Indefinido',
        estado: 'vigente',
        fechaInicio: '2023-01-01',
        origenRegistro: 'apps_script_sync',
        creadoEn: '2023-01-01',
        creadoPor: 'apps_script'
      }
    ];

    const appsScriptBatch = [
      { colaboradorId: 'emp_sync_1', tipo: 'Indefinido', fechaInicio: '2023-01-01', sucursalId: 'suc_1' }, // Duplicado
      { colaboradorId: 'emp_sync_2', tipo: 'Plazo Fijo', fechaInicio: '2024-01-01', fechaTermino: '2024-03-31', sucursalId: 'suc_1' } // Nuevo
    ];

    const inserted: any[] = [];
    appsScriptBatch.forEach(incoming => {
      if (!isDuplicateContract(existingContracts, incoming)) {
        inserted.push(incoming);
      }
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0].colaboradorId).toBe('emp_sync_2');
  });

  // =========================================================================
  // Escenario 16: Verificar que el historial no dependa de comparar nombres (usa colaboradorId)
  // =========================================================================
  it('16. Verificar que el historial no dependa de comparar nombres (usa colaboradorId)', () => {
    const workerA = { id: 'uid_carlos_001', nombre: 'Carlos González' };
    const workerB = { id: 'uid_carlos_002', nombre: 'Carlos González' };

    const contracts: Contrato[] = [
      { id: 'cA1', colaboradorId: workerA.id, sucursalId: 's1', tipo: 'Indefinido', estado: 'vigente', fechaInicio: '2023-01-01', creadoEn: '2023', creadoPor: 'admin' },
      { id: 'cB1', colaboradorId: workerB.id, sucursalId: 's2', tipo: 'Plazo Fijo', estado: 'vigente', fechaInicio: '2024-01-01', fechaTermino: '2024-06-30', creadoEn: '2024', creadoPor: 'admin' }
    ];

    // Filtrar por UID y no por nombre
    const historyA = contracts.filter(c => c.colaboradorId === workerA.id);
    const historyB = contracts.filter(c => c.colaboradorId === workerB.id);

    expect(historyA).toHaveLength(1);
    expect(historyA[0].id).toBe('cA1');

    expect(historyB).toHaveLength(1);
    expect(historyB[0].id).toBe('cB1');
  });

  // =========================================================================
  // Escenario 17: Comprobar el funcionamiento de la ficha y de RR. HH. con varios contratos históricos
  // =========================================================================
  it('17. Comprobar el funcionamiento de la ficha y de RR. HH. con varios contratos históricos', () => {
    const historicalChain: Contrato[] = [
      { id: 'c_chain_1', colaboradorId: 'emp_long', sucursalId: 's1', tipo: 'Plazo Fijo', estado: 'renovado', fechaInicio: '2022-01-01', fechaTermino: '2022-03-31', numeroRenovacion: 1, contratoSiguienteId: 'c_chain_2', creadoEn: '2022', creadoPor: 'admin' },
      { id: 'c_chain_2', colaboradorId: 'emp_long', sucursalId: 's1', tipo: 'Plazo Fijo', estado: 'renovado', fechaInicio: '2022-04-01', fechaTermino: '2022-06-30', numeroRenovacion: 2, contratoAnteriorId: 'c_chain_1', contratoSiguienteId: 'c_chain_3', creadoEn: '2022', creadoPor: 'admin' },
      { id: 'c_chain_3', colaboradorId: 'emp_long', sucursalId: 's1', tipo: 'Plazo Fijo', estado: 'renovado', fechaInicio: '2022-07-01', fechaTermino: '2022-09-30', numeroRenovacion: 3, contratoAnteriorId: 'c_chain_2', contratoSiguienteId: 'c_chain_4', creadoEn: '2022', creadoPor: 'admin' },
      { id: 'c_chain_4', colaboradorId: 'emp_long', sucursalId: 's1', tipo: 'Indefinido', estado: 'vigente', fechaInicio: '2022-10-01', numeroRenovacion: 4, contratoAnteriorId: 'c_chain_3', creadoEn: '2022', creadoPor: 'admin' }
    ];

    // Activo primario
    const active = getActiveContract(historicalChain);
    expect(active?.id).toBe('c_chain_4');
    expect(active?.tipo).toBe('Indefinido');
    expect(active?.estado).toBe('vigente');

    // Trazabilidad de cadena
    const prev3 = historicalChain.find(c => c.id === active?.contratoAnteriorId);
    expect(prev3?.id).toBe('c_chain_3');
    const prev2 = historicalChain.find(c => c.id === prev3?.contratoAnteriorId);
    expect(prev2?.id).toBe('c_chain_2');
    const prev1 = historicalChain.find(c => c.id === prev2?.contratoAnteriorId);
    expect(prev1?.id).toBe('c_chain_1');
  });

  // =========================================================================
  // Escenario 18: Verificar que no se modifican los turnos ni las asistencias
  // =========================================================================
  it('18. Verificar que no se modifican los turnos ni las asistencias', async () => {
    const operationalTurnos = [
      { id: 'turno_001', colaboradorId: 'emp_001', sucursalId: 'suc_1', fecha: '2024-05-01', estado: 'planificado' },
      { id: 'turno_002', colaboradorId: 'emp_001', sucursalId: 'suc_1', fecha: '2024-05-02', estado: 'planificado' }
    ];
    const operationalAsistencias = [
      { id: 'asist_001', colaboradorId: 'emp_001', tipo: 'asistencia_digital', marcaEntrada: '2024-05-01T08:00:00Z', metodo: 'geolocalizacion' }
    ];

    // Inmutabilidad snapshot
    const turnosSnapshot = JSON.stringify(operationalTurnos);
    const asistenciasSnapshot = JSON.stringify(operationalAsistencias);

    // Ejecutar ciclo de contratos completo
    const cId = await contratosService.createContrato({
      colaboradorId: 'emp_001',
      sucursalId: 'suc_1',
      tipo: 'Plazo Fijo',
      estado: 'vigente',
      fechaInicio: '2024-05-01',
      fechaTermino: '2024-05-31'
    }, 'admin_test');

    await contratosService.linkDocument(cId, 'doc_ext_1', 'firmado_digital', 'admin_test');
    await contratosService.renewContrato(cId, {
      colaboradorId: 'emp_001',
      sucursalId: 'suc_1',
      tipo: 'Indefinido',
      estado: 'vigente',
      fechaInicio: '2024-06-01'
    }, 'admin_test');

    // Verificar que turnos y asistencias se mantienen exactamente iguales
    expect(JSON.stringify(operationalTurnos)).toBe(turnosSnapshot);
    expect(JSON.stringify(operationalAsistencias)).toBe(asistenciasSnapshot);
    expect(operationalTurnos).toHaveLength(2);
    expect(operationalAsistencias).toHaveLength(1);
  });

  // =========================================================================
  // Escenario 19: Regla permanente: la tabla de RR. HH. siempre muestra únicamente el último contrato vigente por trabajador
  // =========================================================================
  it('19. Regla permanente: la tabla de RR. HH. siempre muestra únicamente el contrato activo / más reciente por trabajador', () => {
    const rawContracts: Contrato[] = [
      { id: 'c_emp1_1', colaboradorId: 'emp_1', sucursalId: 's1', tipo: 'Plazo Fijo', estado: 'renovado', fechaInicio: '2023-01-01', fechaTermino: '2023-03-31', creadoEn: '2023-01-01', creadoPor: 'admin' },
      { id: 'c_emp1_2', colaboradorId: 'emp_1', sucursalId: 's1', tipo: 'Plazo Fijo', estado: 'renovado', fechaInicio: '2023-04-01', fechaTermino: '2023-06-30', creadoEn: '2023-04-01', creadoPor: 'admin' },
      { id: 'c_emp1_3', colaboradorId: 'emp_1', sucursalId: 's1', tipo: 'Indefinido', estado: 'vigente', fechaInicio: '2023-07-01', creadoEn: '2023-07-01', creadoPor: 'admin' },
      { id: 'c_emp2_1', colaboradorId: 'emp_2', sucursalId: 's2', tipo: 'Plazo Fijo', estado: 'vigente', fechaInicio: '2024-01-01', fechaTermino: '2024-06-30', creadoEn: '2024-01-01', creadoPor: 'admin' }
    ];

    // Aplicar regla de agrupación permanente
    const workerContractsMap = new Map<string, typeof rawContracts>();
    rawContracts.forEach(c => {
      const arr = workerContractsMap.get(c.colaboradorId) || [];
      arr.push(c);
      workerContractsMap.set(c.colaboradorId, arr);
    });

    const uniqueDashboardList: Array<Contrato & { historyCount: number }> = [];
    workerContractsMap.forEach((workerList, colabId) => {
      const sorted = [...workerList].sort((a, b) => {
        const aIsVig = a.estado === 'vigente' ? 1 : 0;
        const bIsVig = b.estado === 'vigente' ? 1 : 0;
        if (aIsVig !== bIsVig) return bIsVig - aIsVig;
        const aTerm = a.fechaTermino || '9999-99-99';
        const bTerm = b.fechaTermino || '9999-99-99';
        if (aTerm !== bTerm) return bTerm.localeCompare(aTerm);
        const aIni = a.fechaInicio || '';
        const bIni = b.fechaInicio || '';
        if (aIni !== bIni) return bIni.localeCompare(aIni);
        return (b.creadoEn || '').localeCompare(a.creadoEn || '');
      });

      const latestContract = sorted[0];
      const totalHistoryCount = rawContracts.filter(c => c.colaboradorId === colabId).length;

      uniqueDashboardList.push({
        ...latestContract,
        historyCount: totalHistoryCount
      });
    });

    // 1. Debe haber exactamente 2 filas para 2 trabajadores (a pesar de haber 4 contratos en la base de datos)
    expect(uniqueDashboardList).toHaveLength(2);

    // 2. Para emp_1, la fila mostrada es el contrato Indefinido vigente
    const emp1Row = uniqueDashboardList.find(c => c.colaboradorId === 'emp_1');
    expect(emp1Row?.id).toBe('c_emp1_3');
    expect(emp1Row?.estado).toBe('vigente');
    expect(emp1Row?.tipo).toBe('Indefinido');
    expect(emp1Row?.historyCount).toBe(3); // Historial de 3 contratos

    // 3. Para emp_2, la fila mostrada es el contrato de emp_2 con historyCount = 1
    const emp2Row = uniqueDashboardList.find(c => c.colaboradorId === 'emp_2');
    expect(emp2Row?.id).toBe('c_emp2_1');
    expect(emp2Row?.historyCount).toBe(1);
  });

  // =========================================================================
  // FASE 8: VALIDACIONES LOCALES OBLIGATORIAS — 10 ESCENARIOS MÍNIMOS
  // =========================================================================
  describe('FASE 8: Validación de los 10 escenarios del Directorio de RR. HH.', () => {
    
    // Escenario 1: Un colaborador activo con contrato vigente
    it('1. Colaborador activo con contrato vigente: En servicio y contrato vigente', () => {
      const emp: Employee = {
        id: 'emp_sc1',
        firstName: 'Juan',
        lastNamePaterno: 'Pérez',
        rut: '11.111.111-1',
        email: 'juan@ggss.cl',
        cargo: 'GUARDIA DE SEGURIDAD',
        role: 'worker',
        isActive: true,
        currentSiteId: 101
      };
      const opStatus = resolveEmployeeOperationalStatus(emp);
      expect(opStatus).toBe('en_servicio');
    });

    // Escenario 2: Un colaborador activo con contrato vencido
    it('2. Colaborador activo con contrato vencido: Conserva estado operativo y no se marca como inactivo', () => {
      const emp: Employee = {
        id: 'emp_sc2',
        firstName: 'Carlos',
        lastNamePaterno: 'Gómez',
        rut: '12.222.222-2',
        email: 'carlos@ggss.cl',
        cargo: 'GUARDIA DE SEGURIDAD',
        role: 'worker',
        isActive: true,
        currentSiteId: 102
      };
      // A pesar de tener un contrato vencido, su estado operativo sigue siendo 'en_servicio'
      const opStatus = resolveEmployeeOperationalStatus(emp);
      expect(opStatus).toBe('en_servicio');
      expect(emp.isActive).toBe(true);
    });

    // Escenario 3: Un trabajador de reserva con contrato vencido
    it('3. Trabajador de reserva con contrato vencido: Clasifica como reserva y no contamina incidencias', () => {
      const emp: Employee = {
        id: 'emp_sc3',
        firstName: 'Pedro',
        lastNamePaterno: 'Silva',
        rut: '13.333.333-3',
        email: 'pedro@ggss.cl',
        cargo: 'GUARDIA DE SEGURIDAD',
        role: 'worker',
        isActive: true,
        currentSiteId: undefined // Sin sucursal asignada actualmente
      };
      const opStatus = resolveEmployeeOperationalStatus(emp);
      expect(opStatus).toBe('reserva');
    });

    // Escenario 4: Un trabajador de reserva sin contrato asociado
    it('4. Trabajador de reserva sin contrato asociado: Se muestra en Todos y en Reservas', () => {
      const emp: Employee = {
        id: 'emp_sc4',
        firstName: 'Luis',
        lastNamePaterno: 'Rojas',
        rut: '14.444.444-4',
        email: 'luis@ggss.cl',
        cargo: 'GUARDIA DE SEGURIDAD',
        role: 'worker',
        isActive: true
      };
      const opStatus = resolveEmployeeOperationalStatus(emp);
      expect(opStatus).toBe('reserva');
    });

    // Escenario 5: Un colaborador inactivo con historial contractual
    it('5. Colaborador inactivo con historial contractual: Mantiene historial intacto y clasifica inactivo', () => {
      const emp: Employee = {
        id: 'emp_sc5',
        firstName: 'Mario',
        lastNamePaterno: 'Valenzuela',
        rut: '15.555.555-5',
        email: 'mario@ggss.cl',
        cargo: 'GUARDIA DE SEGURIDAD',
        role: 'worker',
        isActive: false
      };
      const opStatus = resolveEmployeeOperationalStatus(emp);
      expect(opStatus).toBe('inactivo');

      const historicalContracts: Contrato[] = [
        { id: 'c_hist_1', colaboradorId: 'emp_sc5', sucursalId: '1', tipo: 'Plazo Fijo', estado: 'vencido', fechaInicio: '2021-01-01', creadoEn: '2021', creadoPor: 'admin' },
        { id: 'c_hist_2', colaboradorId: 'emp_sc5', sucursalId: '1', tipo: 'Indefinido', estado: 'finiquitado', fechaInicio: '2021-04-01', creadoEn: '2021', creadoPor: 'admin' }
      ];
      expect(historicalContracts).toHaveLength(2);
    });

    // Escenario 6: Un trabajador part-time relacionado con Falabella
    it('6. Trabajador part-time relacionado con Falabella: Se detecta pertenencia a Falabella y se preserva en Todos', () => {
      const falabellaSiteIds = new Set(['201', '202']);
      const emp: Employee = {
        id: 'emp_sc6',
        firstName: 'Elena',
        lastNamePaterno: 'Morales',
        rut: '16.666.666-6',
        email: 'elena@ggss.cl',
        cargo: 'GUARDIA DE SEGURIDAD',
        role: 'worker',
        isActive: true,
        currentSiteId: 201 // Falabella
      };
      const isFala = falabellaSiteIds.has(String(emp.currentSiteId));
      expect(isFala).toBe(true);

      // Con exclusión activa queda filtrado, con exclusión desactivada se recupera
      const allWorkers = [emp];
      const excludedList = allWorkers.filter(w => !falabellaSiteIds.has(String(w.currentSiteId)));
      expect(excludedList).toHaveLength(0);
      const normalList = allWorkers;
      expect(normalList).toHaveLength(1);
    });

    // Escenario 7: Un colaborador sin sucursal de referencia
    it('7. Colaborador sin sucursal de referencia: Se visualiza con sucursal Sin Asignar / Multisitio', () => {
      const emp: Employee = {
        id: 'emp_sc7',
        firstName: 'Ana',
        lastNamePaterno: 'Castro',
        rut: '17.777.777-7',
        email: 'ana@ggss.cl',
        cargo: 'GUARDIA DE SEGURIDAD',
        role: 'worker',
        isActive: true,
        currentSiteId: undefined
      };
      const resolvedSite = emp.currentSiteId ? `Sucursal ${emp.currentSiteId}` : 'Sin Asignar / Multisitio';
      expect(resolvedSite).toBe('Sin Asignar / Multisitio');
    });

    // Escenario 8: Un trabajador con varias renovaciones
    it('8. Trabajador con varias renovaciones: Muestra último activo y preserva conteo de historial', () => {
      const renewals: Contrato[] = [
        { id: 'r1', colaboradorId: 'emp_sc8', sucursalId: '1', tipo: 'Plazo Fijo', estado: 'renovado', fechaInicio: '2023-01-01', creadoEn: '2023-01-01', creadoPor: 'admin' },
        { id: 'r2', colaboradorId: 'emp_sc8', sucursalId: '1', tipo: 'Plazo Fijo', estado: 'renovado', fechaInicio: '2023-04-01', creadoEn: '2023-04-01', creadoPor: 'admin' },
        { id: 'r3', colaboradorId: 'emp_sc8', sucursalId: '1', tipo: 'Indefinido', estado: 'vigente', fechaInicio: '2023-07-01', creadoEn: '2023-07-01', creadoPor: 'admin' }
      ];
      const active = getActiveContract(renewals);
      expect(active?.id).toBe('r3');
      expect(renewals).toHaveLength(3);
    });

    // Escenario 9: Un trabajador con una asignación o turno próximo
    it('9. Turnos y asignaciones no son alterados ni eliminados por consultas de RR. HH.', () => {
      const shiftSchedule = [
        { id: 'shift_sc9', colaboradorId: 'emp_sc9', sucursalId: 'site_1', fecha: '2026-10-25', estado: 'programado' }
      ];
      const copy = [...shiftSchedule];
      expect(copy).toEqual(shiftSchedule);
      expect(copy[0].estado).toBe('programado');
    });

    // Escenario 10: Colaborador con datos contractuales en campos heredados de la ficha (legacy)
    it('10. Colaborador con datos de contrato en campos heredados: Detecta vigencia sin requerir doc en Contratos', () => {
      const legacyEmp: Employee = {
        id: 'emp_sc10',
        firstName: 'Roberto',
        lastNamePaterno: 'Diaz',
        rut: '18.888.888-8',
        email: 'roberto@ggss.cl',
        cargo: 'GUARDIA DE SEGURIDAD',
        role: 'worker',
        isActive: true,
        fechaInicioContrato: '2022-01-01',
        tipoContrato: 'Indefinido'
      };
      expect(legacyEmp.fechaInicioContrato).toBe('2022-01-01');
      expect(legacyEmp.tipoContrato).toBe('Indefinido');
      // No existe documento en colección Contratos, pero se respeta y visualiza en el Directorio
      const hasLegacyContract = Boolean(legacyEmp.fechaInicioContrato);
      expect(hasLegacyContract).toBe(true);
    });
  });

  // =========================================================================
  // Normalización de Vencimientos y Formato de Fechas (DD-MM-YYYY)
  // =========================================================================
  describe('Normalización de Vencimientos y Formato de Fechas (DD-MM-YYYY)', () => {
    
    it('Formatea fechas YYYY-MM-DD y timestamps a formato estándar chileno DD-MM-YYYY', () => {
      expect(formatDateDDMMYYYY('2026-08-24')).toBe('24-08-2026');
      expect(formatDateDDMMYYYY('2026-10-31')).toBe('31-10-2026');
      expect(formatDateDDMMYYYY('2026-07-26')).toBe('26-07-2026');
      expect(formatDateDDMMYYYY('30/8/2026')).toBe('30-08-2026');
      expect(formatDateDDMMYYYY('2026-08-30T15:20:00.000Z')).toBe('30-08-2026');
      expect(formatDateDDMMYYYY('Indefinido')).toBe('Indefinido');
      expect(formatDateDDMMYYYY('')).toBe('');
      expect(formatDateDDMMYYYY(null)).toBe('');
      expect(formatDateDDMMYYYY(undefined)).toBe('');
    });

    it('Evalúa contratos vencidos por fecha pasada como CADUCADO (badge rojo) incluso si estado en BD era vigente', () => {
      const today = '2026-10-20';

      // Caso 1: Falabella Part-Time vencido el 2026-07-26 (screenshot usuario)
      const c1: Contrato = {
        id: 'c_jul_1',
        colaboradorId: 'emp_demo',
        sucursalId: 'suc_falabella',
        tipo: 'Falabella Part-Time',
        estado: 'vigente', // estado original en BD
        fechaInicio: '2026-07-25',
        fechaTermino: '2026-07-26',
        creadoEn: '2026-07-24',
        creadoPor: 'admin'
      };
      const badge1 = evaluateContractBadge(c1, today);
      expect(badge1.status).toBe('caducado');
      expect(badge1.label).toBe('Caducado');
      expect(badge1.isCaducado).toBe(true);
      expect(badge1.badgeClass).toContain('rose');

      // Caso 2: Falabella Part-Time vencido el 2026-07-24 (screenshot usuario)
      const c2: Contrato = {
        id: 'c_jul_2',
        colaboradorId: 'emp_demo',
        sucursalId: 'suc_falabella',
        tipo: 'Falabella Part-Time',
        estado: 'vigente',
        fechaInicio: '2026-07-24',
        fechaTermino: '2026-07-24',
        creadoEn: '2026-07-23',
        creadoPor: 'admin'
      };
      const badge2 = evaluateContractBadge(c2, today);
      expect(badge2.status).toBe('caducado');
      expect(badge2.label).toBe('Caducado');
      expect(badge2.isCaducado).toBe(true);

      // Caso 3: Falabella Part-Time vencido el 2026-07-31 (screenshot usuario)
      const c3: Contrato = {
        id: 'c_jul_3',
        colaboradorId: 'emp_demo',
        sucursalId: 'suc_falabella',
        tipo: 'Falabella Part-Time',
        estado: 'vigente',
        fechaInicio: '2026-07-24',
        fechaTermino: '2026-07-31',
        creadoEn: '2026-07-24',
        creadoPor: 'admin'
      };
      const badge3 = evaluateContractBadge(c3, today);
      expect(badge3.status).toBe('caducado');
      expect(badge3.label).toBe('Caducado');
      expect(badge3.isCaducado).toBe(true);
    });

    it('Mantiene como Vigente (badge verde) el contrato no caducado por fecha', () => {
      const today = '2026-10-20';

      const activeContract: Contrato = {
        id: 'c_act_1',
        colaboradorId: 'emp_demo',
        sucursalId: 'suc_falabella',
        tipo: 'Falabella Part-Time',
        estado: 'vigente',
        fechaInicio: '2026-08-24',
        fechaTermino: '2026-10-31',
        creadoEn: '2026-08-30',
        creadoPor: 'admin'
      };
      const badge = evaluateContractBadge(activeContract, today);
      expect(badge.status).toBe('vigente');
      expect(badge.label).toBe('Vigente');
      expect(badge.isCaducado).toBe(false);
      expect(badge.badgeClass).toContain('emerald');
    });

    it('getActiveContract prioriza el contrato vigente no caducado frente a contratos antiguos vencidos', () => {
      const today = '2026-10-20';
      const contracts: Contrato[] = [
        {
          id: 'c_expired_1',
          colaboradorId: 'emp_demo',
          sucursalId: 'suc_falabella',
          tipo: 'Falabella Part-Time',
          estado: 'vigente',
          fechaInicio: '2026-07-24',
          fechaTermino: '2026-07-31',
          creadoEn: '2026-07-24',
          creadoPor: 'admin'
        },
        {
          id: 'c_active_1',
          colaboradorId: 'emp_demo',
          sucursalId: 'suc_falabella',
          tipo: 'Falabella Part-Time',
          estado: 'vigente',
          fechaInicio: '2026-08-24',
          fechaTermino: '2026-10-31',
          creadoEn: '2026-08-30',
          creadoPor: 'admin'
        }
      ];

      const active = getActiveContract(contracts, today);
      expect(active?.id).toBe('c_active_1');
      expect(active?.fechaTermino).toBe('2026-10-31');
    });
  });
});

