import { TurnoProgramado, TipoOperacional } from '../../types/phase1';
import { shiftTemplateService } from './shiftTemplateService';
import { contractService } from './contractService';
import { assignmentService } from './assignmentService';
import { auditService } from './auditService';

export class ShiftService {
  private turnos: TurnoProgramado[] = [];

  async scheduleShift(
    colaboradorId: string,
    sucursalId: string,
    fecha: string, // YYYY-MM-DD
    codigo: string,
    tipoOperacional: TipoOperacional,
    usuarioId: string
  ): Promise<TurnoProgramado> {
    
    // 1. Obtener/Crear Asignación Operacional (Mes)
    const mes = fecha.substring(0, 7); // Extraer YYYY-MM
    let asignacion = await assignmentService.findAssignment(colaboradorId, sucursalId, mes);
    if (!asignacion) {
      asignacion = await assignmentService.createAssignment(colaboradorId, sucursalId, mes, usuarioId);
    }

    // 2. Resolver el horario inmutable (Snapshot)
    const { snapshot, plantillaId } = await shiftTemplateService.resolveHorario(sucursalId, codigo, fecha);

    // 3. Evaluar contrato
    const { estado: estadoContrato, contratoId } = await contractService.evaluateContractForShift(colaboradorId, sucursalId, fecha);

    // 4. Crear turno normalizado
    const newShift: TurnoProgramado = {
      id: `turno_${asignacion.id}_${fecha}_${Math.random().toString(36).substring(2, 6)}`,
      asignacionOperacionalId: asignacion.id,
      colaboradorId,
      sucursalId,
      fecha,
      codigo,
      horarioSnapshot: snapshot,
      tipoOperacional,
      estado: 'programado',
      contratoIdAsociado: contratoId,
      estadoContrato,
      plantillaIdUsada: plantillaId,
      creadoEn: new Date().toISOString(),
      creadoPor: usuarioId
    } as TurnoProgramado;

    this.turnos.push(newShift);

    await auditService.logAction('CREATE', 'TurnoProgramado', newShift.id, usuarioId, null, newShift);

    return newShift;
  }
}

export const shiftService = new ShiftService();
