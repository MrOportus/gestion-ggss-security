import { Contrato, EstadoContratoVinculado, TurnoProgramado } from '../../types/phase1';

export class ContractBindingService {
  /**
   * Evalúa el estado contractual de un turno contra la lista de contratos vigentes o relevantes del empleado.
   * 
   * Casos:
   * A. COMPATIBLE: Existe exactamente un contrato que pertenece al colaborador, misma sucursal, cubre la fecha, estado vigente.
   * B. OTRA_SUCURSAL: Existe contrato vigente para la fecha, pero para otra sucursal.
   * C. SIN_CONTRATO: No existe contrato que cubra la fecha.
   * D. MULTIPLES: Existen múltiples contratos que cubren la fecha y sucursal.
   * E. RESOLUCION MANUAL: (Manejado en backend o por estado previo, si ya está resuelto_manual no se sobreescribe a menos que se fuerce).
   */
  static evaluateTurno(
    colaboradorId: string,
    sucursalId: string,
    fecha: string, // YYYY-MM-DD
    contratosDelColaborador: Contrato[],
    estadoActual?: EstadoContratoVinculado,
    contratoIdAsociado?: string
  ): { estado: EstadoContratoVinculado; contratoId?: string } {
    
    if (estadoActual === 'resuelto_manual') {
      // Retornamos lo mismo si está resuelto manualmente, a menos que se requiera reevaluar forzadamente.
      // Asumimos que la lógica de backend manejará el mantener el contratoId.
      return { estado: 'resuelto_manual', contratoId: contratoIdAsociado };
    }

    // Filtrar contratos vigentes para la fecha específica
    const contratosEnFecha = contratosDelColaborador.filter(c => {
      // Estados válidos para ser considerados como cobertura contractual en una fecha.
      // Borrador, anulado, finiquitado antes de la fecha, etc no cubren.
      const estadosValidos = ['vigente', 'pendiente_firma'];
      if (!estadosValidos.includes(c.estado)) return false;

      // Evaluar rango de fechas
      if (fecha < c.fechaInicio) return false;
      if (c.fechaTermino && fecha > c.fechaTermino) return false;

      return true;
    });

    if (contratosEnFecha.length === 0) {
      return { estado: 'sin_contrato' };
    }

    // Buscar en la misma sucursal
    const contratosMismaSucursal = contratosEnFecha.filter(c => c.sucursalId.toString() === sucursalId.toString());

    if (contratosMismaSucursal.length === 0) {
      // Hay contratos en la fecha pero en otras sucursales
      return { estado: 'otra_sucursal' };
    }

    if (contratosMismaSucursal.length === 1) {
      return { estado: 'compatible', contratoId: contratosMismaSucursal[0].id };
    }

    // Existen múltiples contratos para la misma fecha y sucursal
    return { estado: 'multiples' };
  }
}
