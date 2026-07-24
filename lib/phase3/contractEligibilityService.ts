import { Contrato } from '../../types/phase1';

export type CanonicalContractStatus = 'active' | 'pending' | 'expired' | 'terminated' | 'cancelled' | 'draft';

export type EligibilityStatus = 
  | 'vigente'
  | 'por_vencer'
  | 'vencido'
  | 'sin_contrato'
  | 'datos_incompletos'
  | 'sucursal_no_coincide'
  | 'contratos_superpuestos'
  | 'pendiente_inicio';

export type ReasonCode = 
  | 'VALID_CONTRACT_FOUND'
  | 'NO_CONTRACT_FOUND'
  | 'CONTRACT_EXPIRED_FOR_SHIFT_DATE'
  | 'SITE_MISMATCH'
  | 'FIXED_TERM_END_DATE_MISSING'
  | 'MULTIPLE_APPLICABLE_CONTRACTS'
  | 'FUTURE_START_DATE'
  | 'NOT_ACTIVE_STATUS';

export interface ContractEligibilityResult {
  eligibilityStatus: EligibilityStatus;
  reasonCode: ReasonCode;
  contratoId: string | null;
  contrato?: Contrato;
  conflictingContracts?: Contrato[];
}

export class ContractEligibilityService {
  /**
   * Mapea los estados textuales de la BD a un estado canónico.
   */
  public static mapToCanonicalStatus(legacyStatus: string): CanonicalContractStatus {
    switch (legacyStatus.toLowerCase()) {
      case 'vigente': return 'active';
      case 'pendiente_firma': return 'pending';
      case 'borrador': return 'draft';
      case 'vencido': return 'expired';
      case 'finiquitado': return 'terminated';
      case 'anulado': return 'cancelled';
      default: return 'draft';
    }
  }

  /**
   * Extrae la fecha civil YYYY-MM-DD de cualquier input de fecha.
   */
  public static normalizeToCivilDate(dateInput: string): string {
    if (!dateInput) return '';
    // Si ya es YYYY-MM-DD, lo devolvemos tal cual para evitar desfases de UTC
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
      return dateInput.trim();
    }
    // Si trae hora (ISO) cortamos
    if (dateInput.includes('T')) {
      return dateInput.split('T')[0];
    }
    // Fallback intentando parsear
    try {
      const d = new Date(dateInput);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    } catch (e) {}
    return dateInput.trim();
  }

  /**
   * Evalúa la elegibilidad de un empleado para un turno específico, según las reglas aprobadas.
   */
  public static evaluateTurno(
    contratos: Contrato[],
    employeeId: string,
    siteId: string | number,
    fechaTurnoInput: string // Esperado YYYY-MM-DD
  ): ContractEligibilityResult {
    
    const fechaTurno = this.normalizeToCivilDate(fechaTurnoInput);
    if (!fechaTurno) {
      return {
        eligibilityStatus: 'datos_incompletos',
        reasonCode: 'FIXED_TERM_END_DATE_MISSING',
        contratoId: null
      };
    }

    const employeeContracts = contratos.filter(c => c.colaboradorId === employeeId);
    if (employeeContracts.length === 0) {
      return {
        eligibilityStatus: 'sin_contrato',
        reasonCode: 'NO_CONTRACT_FOUND',
        contratoId: null
      };
    }

    // Clasificar contratos
    let applicableContracts: Contrato[] = [];
    let fallbackStatus: EligibilityStatus = 'sin_contrato';
    let fallbackReason: ReasonCode = 'NO_CONTRACT_FOUND';
    let closestContract: Contrato | undefined;

    for (const c of employeeContracts) {
      const inicio = this.normalizeToCivilDate(c.fechaInicio);
      const termino = c.fechaTermino ? this.normalizeToCivilDate(c.fechaTermino) : null;
      const canonicalStatus = this.mapToCanonicalStatus(c.estado);
      const isFixedTerm = c.tipo === 'Plazo Fijo' || c.tipo?.toLowerCase().includes('plazo');

      // Regla: Plazo fijo sin fecha de término = datos_incompletos
      if (isFixedTerm && !termino) {
        if (applicableContracts.length === 0) {
          fallbackStatus = 'datos_incompletos';
          fallbackReason = 'FIXED_TERM_END_DATE_MISSING';
          closestContract = c;
        }
        continue;
      }

      // Regla: Estado debe ser compatible con vigencia (active o pending)
      if (canonicalStatus !== 'active' && canonicalStatus !== 'pending') {
        if (applicableContracts.length === 0) {
          fallbackStatus = 'sin_contrato';
          fallbackReason = 'NOT_ACTIVE_STATUS';
          closestContract = c;
        }
        continue;
      }

      // Comparación de fechas civiles lexicográficamente seguras en formato YYYY-MM-DD
      const started = inicio <= fechaTurno;
      const notEnded = termino === null || termino >= fechaTurno;

      if (!started) {
        if (applicableContracts.length === 0) {
          fallbackStatus = 'pendiente_inicio';
          fallbackReason = 'FUTURE_START_DATE';
          closestContract = c;
        }
        continue;
      }

      if (!notEnded) {
        if (applicableContracts.length === 0) {
          fallbackStatus = 'vencido';
          fallbackReason = 'CONTRACT_EXPIRED_FOR_SHIFT_DATE';
          closestContract = c;
        }
        continue;
      }

      // El contrato cubre la fecha y está en estado válido.
      applicableContracts.push(c);
    }

    if (applicableContracts.length === 0) {
      return {
        eligibilityStatus: fallbackStatus,
        reasonCode: fallbackReason,
        contratoId: closestContract?.id || null,
        contrato: closestContract
      };
    }

    // Filtrar y ordenar según prioridades estrictas:
    // 1. Mismo employeeId (ya aplicado al inicio)
    // 2. Datos interpretables (ya aplicado en el loop)
    // 3. Sucursal exacta (específico antes que general)
    // 4. Fecha cubierta (ya aplicado)
    // 5. Estado canónico (ya aplicado)
    // 6. Específico de sucursal vs General
    // 7. fechaInicio más reciente
    // 8. updatedAt/modificadoEn/creadoEn como desempate

    const exactSiteContracts = applicableContracts.filter(c => c.sucursalId.toString() === siteId.toString());
    
    // Si no hay ninguno exacto, veamos si hay contratos "generales" (ej. sucursal '0' o vacía)
    if (exactSiteContracts.length === 0) {
      const generalContracts = applicableContracts.filter(c => !c.sucursalId || c.sucursalId.toString() === '0');
      if (generalContracts.length > 0) {
        applicableContracts = generalContracts;
      } else {
        // Ninguno coincide con la sucursal
        return {
          eligibilityStatus: 'sucursal_no_coincide',
          reasonCode: 'SITE_MISMATCH',
          contratoId: applicableContracts[0].id,
          contrato: applicableContracts[0]
        };
      }
    } else {
      applicableContracts = exactSiteContracts;
    }

    // Ordenamiento por fechaInicio más reciente (descendente) y desempate por fecha de modificación/creación
    applicableContracts.sort((a, b) => {
      const inicioA = this.normalizeToCivilDate(a.fechaInicio);
      const inicioB = this.normalizeToCivilDate(b.fechaInicio);
      if (inicioA !== inicioB) {
        return inicioB.localeCompare(inicioA); // Más reciente primero
      }
      const updatedA = a.modificadoEn || a.creadoEn || '';
      const updatedB = b.modificadoEn || b.creadoEn || '';
      return updatedB.localeCompare(updatedA); // Más reciente primero
    });

    // Si después de todo el ordenamiento tenemos más de 1 contrato en el top que podrían ser aplicables simultáneamente
    if (applicableContracts.length > 1) {
      return {
        eligibilityStatus: 'contratos_superpuestos',
        reasonCode: 'MULTIPLE_APPLICABLE_CONTRACTS',
        contratoId: applicableContracts[0].id,
        contrato: applicableContracts[0],
        conflictingContracts: applicableContracts
      };
    }

    // Caso de éxito absoluto
    const selectedContract = applicableContracts[0];
    
    // Calcular 'por_vencer' (<= 30 días)
    let finalStatus: EligibilityStatus = 'vigente';
    if (selectedContract.fechaTermino) {
      const fTermino = new Date(this.normalizeToCivilDate(selectedContract.fechaTermino) + 'T00:00:00');
      const fTurnoObj = new Date(fechaTurno + 'T00:00:00');
      const diffTime = fTermino.getTime() - fTurnoObj.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays <= 30 && diffDays >= 0) {
        finalStatus = 'por_vencer';
      }
    }

    return {
      eligibilityStatus: finalStatus,
      reasonCode: 'VALID_CONTRACT_FOUND',
      contratoId: selectedContract.id,
      contrato: selectedContract
    };
  }
}
