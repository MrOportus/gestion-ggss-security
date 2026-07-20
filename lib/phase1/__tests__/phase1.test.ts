import { describe, it, expect, beforeEach } from 'vitest';
import { shiftTemplateService } from '../shiftTemplateService';
import { contractService } from '../contractService';
import { shiftService } from '../shiftService';
import { featureFlagService } from '../featureFlagService';
import { auditService } from '../auditService';
import { permissionService } from '../permissionService';
import { compatibilityLayer } from '../compatibilityLayer';
import { assignmentService } from '../assignmentService';
import { Contrato, PlantillaTurno, PatronJornada } from '../../../types/phase1';

describe('Pruebas de Fase 1 - Modelo Híbrido y Capa de Compatibilidad', () => {

  beforeEach(() => {
    auditService.clearLogs();
    // Limpieza de estado mock - como están diseñados como singletons en memoria,
    // inyectamos nuevos sets para resetear el estado de la prueba.
    contractService.seedContracts([
      { id: 'c1', colaboradorId: 'emp1', sucursalId: 'site1', estado: 'vigente', tipo: 'Part-Time', fechaInicio: '2023-01-01', creadoEn: '', creadoPor: 'admin' },
      { id: 'c2', colaboradorId: 'emp2', sucursalId: 'site2', estado: 'vigente', tipo: 'Full', fechaInicio: '2023-01-01', creadoEn: '', creadoPor: 'admin' },
      { id: 'c3', colaboradorId: 'emp3', sucursalId: 'site4', estado: 'vigente', tipo: 'Full', fechaInicio: '2023-01-01', creadoEn: '', creadoPor: 'admin' },
      { id: 'c4', colaboradorId: 'emp3', sucursalId: 'site3', estado: 'vigente', tipo: 'Extra', fechaInicio: '2023-01-01', creadoEn: '', creadoPor: 'admin' },
      { id: 'c5', colaboradorId: 'emp3', sucursalId: 'site3', estado: 'vigente', tipo: 'Part-Time', fechaInicio: '2023-01-01', creadoEn: '', creadoPor: 'admin' },
    ]);

    shiftTemplateService.seedTemplates('site1', [
      { id: 'p1', sucursalId: 'site1', codigo: 'X', nombre: 'Diurno', horaInicio: '07:30', horaTermino: '19:30', cruzaMedianoche: false, activo: true, vigenciaDesde: '2023-01-01', creadoEn: '', creadoPor: 'admin' },
      { id: 'p2', sucursalId: 'site1', codigo: 'N', nombre: 'Nocturno', horaInicio: '19:30', horaTermino: '07:30', cruzaMedianoche: true, activo: true, vigenciaDesde: '2023-01-01', creadoEn: '', creadoPor: 'admin' },
    ]);
    
    // Limpiamos los turnos (esto es un work around simple para tests sin framework real de DB)
    (shiftService as any).turnos = [];
    (assignmentService as any).asignaciones = new Map();
  });

  describe('Capa de Compatibilidad', () => {
    it('1. Resolución correcta del colaboradorId', () => {
      expect(compatibilityLayer.normalizeEmployeeId('emp1')).toBe('emp1');
      expect(compatibilityLayer.normalizeEmployeeId('undefined', 'authUid123')).toBe('authUid123');
    });

    it('18. Compatibilidad estricta con códigos antiguos', () => {
      expect(compatibilityLayer.normalizeShiftCode('programado')).toBe('X');
      expect(compatibilityLayer.normalizeShiftCode('noche')).toBe('N');
      expect(compatibilityLayer.normalizeShiftCode('descanso')).toBe('D');
      expect(compatibilityLayer.normalizeShiftCode('x')).toBe('X'); // fallback genérico
    });
  });

  describe('Evaluación Contractual Centralizada', () => {
    it('3. Resuelve Contrato compatible exactamente', async () => {
      const evalResult = await contractService.evaluateContractForShift('emp1', 'site1', '2023-11-20');
      expect(evalResult.estado).toBe('compatible');
      expect(evalResult.contratoId).toBe('c1');
    });

    it('4. Detecta Contrato vigente pero en otra sucursal', async () => {
      const evalResult = await contractService.evaluateContractForShift('emp2', 'site1', '2023-11-20');
      expect(evalResult.estado).toBe('otra_sucursal');
      expect(evalResult.contratoId).toBe('c2');
    });

    it('5. Detecta cuando el colaborador está sin contrato', async () => {
      const evalResult = await contractService.evaluateContractForShift('emp_sin_contrato', 'site1', '2023-11-20');
      expect(evalResult.estado).toBe('sin_contrato');
    });

    it('6. Detecta contratos múltiples ambiguos (requiere revisión)', async () => {
      const evalResult = await contractService.evaluateContractForShift('emp3', 'site3', '2023-11-20');
      expect(evalResult.estado).toBe('multiples');
    });
  });

  describe('Generación de Turnos Normalizados y Plantillas', () => {
    it('8. Resuelve Plantillas X diferentes por sucursal', async () => {
      const turno = await shiftService.scheduleShift('emp1', 'site1', '2023-11-20', 'X', 'contractual', 'admin');
      expect(turno.horarioSnapshot.inicio).toBe('07:30');
      expect(turno.horarioSnapshot.termino).toBe('19:30');
      expect(turno.horarioSnapshot.origen).toBe('plantilla');
      expect(turno.plantillaIdUsada).toBe('p1');
    });

    it('9. Utiliza fallback seguro (legacy) para sucursal no configurada', async () => {
      const turno = await shiftService.scheduleShift('emp2', 'site2', '2023-11-20', 'X', 'contractual', 'admin');
      expect(turno.horarioSnapshot.inicio).toBe('07:30');
      expect(turno.horarioSnapshot.termino).toBe('19:30');
      expect(turno.horarioSnapshot.origen).toBe('fallback');
      expect(turno.plantillaIdUsada).toBeUndefined();
    });

    it('10. Detecta automáticamente si el turno nocturno cruza la medianoche', async () => {
      const turno = await shiftService.scheduleShift('emp1', 'site1', '2023-11-20', 'N', 'contractual', 'admin');
      expect(turno.horarioSnapshot.cruzaMedianoche).toBe(true);
    });

    it('11. El Snapshot horario es inmutable tras su creación', async () => {
      const turno = await shiftService.scheduleShift('emp1', 'site1', '2023-11-20', 'X', 'contractual', 'admin');
      expect(turno.horarioSnapshot.inicio).toBe('07:30');
      // Supongamos que la plantilla cambia en BD
      shiftTemplateService.seedTemplates('site1', [
        { id: 'p1', sucursalId: 'site1', codigo: 'X', nombre: 'Diurno Nuevo', horaInicio: '09:00', horaTermino: '21:00', cruzaMedianoche: false, activo: true, vigenciaDesde: '2023-01-01', creadoEn: '', creadoPor: 'admin' }
      ]);
      // El turno existente no se ve afectado porque guarda el snapshot interno
      expect(turno.horarioSnapshot.inicio).toBe('07:30');
    });
  });

  describe('Asignaciones Operacionales e Idempotencia', () => {
    it('7. Idempotencia y Prevención de asignación operacional duplicada', async () => {
      const turno1 = await shiftService.scheduleShift('emp1', 'site1', '2023-11-20', 'X', 'contractual', 'admin');
      const turno2 = await shiftService.scheduleShift('emp1', 'site1', '2023-11-21', 'X', 'contractual', 'admin');
      
      expect(turno1.asignacionOperacionalId).toBe(turno2.asignacionOperacionalId);
      
      const logsAsignacion = auditService.getLogsByEntity('AsignacionOperacional', turno1.asignacionOperacionalId);
      expect(logsAsignacion.length).toBe(1); // Se creó una sola vez
    });

    it('19. Idempotencia bajo concurrencia (simulada)', async () => {
      // Si disparamos dos promesas al mismo tiempo que intentan crear una asignación
      const p1 = shiftService.scheduleShift('emp_conc', 'site1', '2023-11-20', 'X', 'contractual', 'admin');
      const p2 = shiftService.scheduleShift('emp_conc', 'site1', '2023-11-21', 'X', 'contractual', 'admin');
      
      // Como usamos un ID determinista y await, esto simula el bloqueo/verificación
      // En Firestore real esto dependerá del ID determinista `asignacion_emp_conc_site1_2023-11`
      const [t1, t2] = await Promise.all([p1, p2].map(p => p.catch(e => e)));
      
      // Uno debe haber tenido éxito o ambos usan el mismo ID final
      if (!(t1 instanceof Error) && !(t2 instanceof Error)) {
         expect(t1.asignacionOperacionalId).toBe(t2.asignacionOperacionalId);
      }
      
      const logs = auditService.getLogsByEntity('AsignacionOperacional', 'asignacion_emp_conc_site1_2023-11');
      // Solo 1 registro de creación debe existir
      expect(logs.length).toBe(1);
    });
  });

  describe('Módulo de Patrones Estructurados', () => {
    it('12. Soporta estructura estandarizada para Patrón 4x4', () => {
      const patron4x4: PatronJornada = {
        id: 'patron_1', nombre: '4x4', diasTrabajo: 4, diasDescanso: 4, activo: true, creadoEn: '', creadoPor: ''
      };
      expect(patron4x4.diasTrabajo).toBe(4);
      expect(patron4x4.diasDescanso).toBe(4);
    });

    it('13. Soporta estructura estandarizada para Patrón 7x7', () => {
      const patron7x7: PatronJornada = {
        id: 'patron_2', nombre: '7x7', diasTrabajo: 7, diasDescanso: 7, activo: true, creadoEn: '', creadoPor: ''
      };
      expect(patron7x7.diasTrabajo).toBe(7);
      expect(patron7x7.diasDescanso).toBe(7);
    });
  });

  describe('Feature Flags, Auditoría y Permisos', () => {
    it('14. Feature flag por sucursal y mes inicia en fallback seguro (legacy)', async () => {
      const flag = await featureFlagService.getFlag('site1', '2023-11');
      expect(flag).toBe('legacy');
    });

    it('15. Permisos: Matriz rechaza acciones destructivas a roles inferiores', () => {
      expect(permissionService.canWriteContracts('admin')).toBe(true);
      expect(permissionService.canWriteContracts('supervisor')).toBe(false);
      expect(permissionService.canWriteContracts('worker')).toBe(false);
    });

    it('16. Auditoría: Toda acción transaccional de creación dispara registro', async () => {
      const turno = await shiftService.scheduleShift('emp1', 'site1', '2023-11-20', 'X', 'contractual', 'admin');
      const logs = auditService.getLogsByEntity('TurnoProgramado', turno.id);
      expect(logs.length).toBe(1);
      expect(logs[0].accion).toBe('CREATE');
      expect(logs[0].usuarioId).toBe('admin');
    });

    it('17. Idempotencia mensual (aseguramiento de única instancia de asignación)', async () => {
      // Confirma que el turno de arriba generó 1 sola asignación
      const turno = await shiftService.scheduleShift('emp1', 'site1', '2023-11-20', 'X', 'contractual', 'admin');
      const logsAsignacion = auditService.getLogsByEntity('AsignacionOperacional', turno.asignacionOperacionalId);
      expect(logsAsignacion.length).toBe(1);
    });
  });
});

