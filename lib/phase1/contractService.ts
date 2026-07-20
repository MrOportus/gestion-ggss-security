import { Contrato, EstadoContratoVinculado } from '../../types/phase1';

export class ContractService {
  private contratos: Contrato[] = [];

  // Inyectar contratos para test
  seedContracts(contratos: Contrato[]) {
    this.contratos = contratos;
  }

  async evaluateContractForShift(
    colaboradorId: string, 
    sucursalId: string, 
    fechaTurno: string
  ): Promise<{ estado: EstadoContratoVinculado, contratoId?: string }> {
    
    // Obtener contratos vigentes en la fecha del turno para el colaborador
    const contratosVigentes = this.contratos.filter(c => 
      c.colaboradorId === colaboradorId &&
      c.estado === 'vigente' &&
      c.fechaInicio <= fechaTurno &&
      (!c.fechaTermino || c.fechaTermino >= fechaTurno)
    );

    if (contratosVigentes.length === 0) {
      return { estado: 'sin_contrato' };
    }

    // Filtrar los que aplican a la sucursal del turno
    const contratosSucursal = contratosVigentes.filter(c => c.sucursalId === sucursalId);

    if (contratosSucursal.length === 1) {
      return { estado: 'compatible', contratoId: contratosSucursal[0].id };
    }

    if (contratosSucursal.length > 1) {
      // Múltiples contratos vigentes en la misma sucursal
      return { estado: 'multiples' };
    }

    // Hay contratos vigentes, pero ninguno en esta sucursal
    if (contratosVigentes.length === 1) {
      return { estado: 'otra_sucursal', contratoId: contratosVigentes[0].id };
    }

    return { estado: 'multiples' };
  }
}

export const contractService = new ContractService();
