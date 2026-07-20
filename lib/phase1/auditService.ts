import { AuditoriaAccion } from '../../types/phase1';

/**
 * Servicio de auditoría para la Fase 1.
 * En producción esto normalmente interactúa con Firestore.
 * Para la Fase 1 se implementa en memoria o como inyección para pruebas.
 */
export class AuditService {
  private logs: AuditoriaAccion[] = [];

  async logAction(
    accion: AuditoriaAccion['accion'],
    entidad: AuditoriaAccion['entidad'],
    entidadId: string,
    usuarioId: string,
    estadoAnterior?: any,
    estadoNuevo?: any,
    motivo?: string,
    contextoInfo?: Record<string, any>
  ): Promise<AuditoriaAccion> {
    const newLog: AuditoriaAccion = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      accion,
      entidad,
      entidadId,
      usuarioId,
      fecha: new Date().toISOString(),
      estadoAnterior,
      estadoNuevo,
      motivo,
      contextoInfo
    };

    this.logs.push(newLog);
    // TODO: persistir en base de datos real
    return newLog;
  }

  getLogsByEntity(entidad: AuditoriaAccion['entidad'], entidadId: string): AuditoriaAccion[] {
    return this.logs.filter(l => l.entidad === entidad && l.entidadId === entidadId);
  }

  // Helper para limpieza en tests
  clearLogs() {
    this.logs = [];
  }
}

export const auditService = new AuditService();
