import { AsignacionOperacional } from '../../types/phase1';
import { auditService } from './auditService';

export class AssignmentService {
  private asignaciones: Map<string, AsignacionOperacional> = new Map();

  async findAssignment(colaboradorId: string, sucursalId: string, mes: string): Promise<AsignacionOperacional | undefined> {
    const id = `asignacion_${colaboradorId}_${sucursalId}_${mes}`;
    const a = this.asignaciones.get(id);
    if (a && a.estado === 'activa') return a;
    return undefined;
  }

  async createAssignment(
    colaboradorId: string, 
    sucursalId: string, 
    mes: string, 
    usuarioId: string,
    patronJornadaId?: string,
    fechaInicioPatron?: string
  ): Promise<AsignacionOperacional> {
    
    const id = `asignacion_${colaboradorId}_${sucursalId}_${mes}`;
    
    if (this.asignaciones.has(id) && this.asignaciones.get(id)!.estado === 'activa') {
      throw new Error('Asignación operacional duplicada');
    }

    const newAssignment: AsignacionOperacional = {
      id,
      colaboradorId,
      sucursalId,
      mes,
      estado: 'activa',
      patronJornadaId,
      fechaInicioPatron,
      creadoEn: new Date().toISOString(),
      creadoPor: usuarioId
    };

    this.asignaciones.set(id, newAssignment);

    await auditService.logAction('CREATE', 'AsignacionOperacional', newAssignment.id, usuarioId, null, newAssignment);

    return newAssignment;
  }
}

export const assignmentService = new AssignmentService();
