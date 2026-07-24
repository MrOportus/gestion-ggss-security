import { describe, it, expect } from 'vitest';
import { ContractEligibilityService } from '../contractEligibilityService';
import { Contrato } from '../../../types/phase1';

describe('ContractEligibilityService', () => {
  const baseContract: Contrato = {
    id: 'c1',
    colaboradorId: 'emp1',
    sucursalId: 'site1',
    tipo: 'Indefinido',
    estado: 'vigente',
    fechaInicio: '2026-01-01',
    creadoEn: '2026-01-01T10:00:00Z',
    creadoPor: 'admin'
  };

  it('debe devolver vigencia correcta para contrato indefinido en fecha posterior', () => {
    const result = ContractEligibilityService.evaluateTurno([baseContract], 'emp1', 'site1', '2026-07-23');
    expect(result.eligibilityStatus).toBe('vigente');
    expect(result.reasonCode).toBe('VALID_CONTRACT_FOUND');
    expect(result.contratoId).toBe('c1');
  });

  it('debe devolver pendiente_inicio si el turno es antes de la fechaInicio', () => {
    const result = ContractEligibilityService.evaluateTurno([baseContract], 'emp1', 'site1', '2025-12-31');
    expect(result.eligibilityStatus).toBe('pendiente_inicio');
    expect(result.reasonCode).toBe('FUTURE_START_DATE');
  });

  it('debe devolver sin_contrato si el colaborador no tiene contratos', () => {
    const result = ContractEligibilityService.evaluateTurno([], 'emp1', 'site1', '2026-07-23');
    expect(result.eligibilityStatus).toBe('sin_contrato');
    expect(result.reasonCode).toBe('NO_CONTRACT_FOUND');
  });

  it('debe marcar Plazo Fijo sin fechaTermino como datos_incompletos', () => {
    const fixedTerm: Contrato = { ...baseContract, tipo: 'Plazo Fijo', fechaTermino: undefined };
    const result = ContractEligibilityService.evaluateTurno([fixedTerm], 'emp1', 'site1', '2026-07-23');
    expect(result.eligibilityStatus).toBe('datos_incompletos');
    expect(result.reasonCode).toBe('FIXED_TERM_END_DATE_MISSING');
  });

  it('debe devolver vencido si la fecha del turno es posterior a fechaTermino', () => {
    const expiredContract: Contrato = { ...baseContract, fechaTermino: '2026-06-30' };
    const result = ContractEligibilityService.evaluateTurno([expiredContract], 'emp1', 'site1', '2026-07-01');
    expect(result.eligibilityStatus).toBe('vencido');
    expect(result.reasonCode).toBe('CONTRACT_EXPIRED_FOR_SHIFT_DATE');
  });

  it('debe devolver por_vencer si vence dentro de los proximos 30 dias', () => {
    const closeExpiring: Contrato = { ...baseContract, fechaTermino: '2026-07-31' };
    const result = ContractEligibilityService.evaluateTurno([closeExpiring], 'emp1', 'site1', '2026-07-01');
    expect(result.eligibilityStatus).toBe('por_vencer');
  });

  it('debe priorizar sucursal exacta por sobre general', () => {
    const generalContract: Contrato = { ...baseContract, id: 'c2', sucursalId: '0', fechaInicio: '2025-01-01' };
    const exactContract: Contrato = { ...baseContract, id: 'c3', sucursalId: 'site1', fechaInicio: '2026-01-01' };
    
    const result = ContractEligibilityService.evaluateTurno([generalContract, exactContract], 'emp1', 'site1', '2026-07-23');
    expect(result.eligibilityStatus).toBe('vigente');
    expect(result.contratoId).toBe('c3'); // Prioriza site1 sobre 0
  });

  it('debe devolver sucursal_no_coincide si solo tiene contrato en otra sucursal', () => {
    const otherSiteContract: Contrato = { ...baseContract, sucursalId: 'site2' };
    const result = ContractEligibilityService.evaluateTurno([otherSiteContract], 'emp1', 'site1', '2026-07-23');
    expect(result.eligibilityStatus).toBe('sucursal_no_coincide');
    expect(result.reasonCode).toBe('SITE_MISMATCH');
  });

  it('debe detectar contratos superpuestos aplicables simultaneamente', () => {
    const c1: Contrato = { ...baseContract, id: 'c1', fechaInicio: '2026-01-01' };
    const c2: Contrato = { ...baseContract, id: 'c2', fechaInicio: '2026-01-01' };
    
    const result = ContractEligibilityService.evaluateTurno([c1, c2], 'emp1', 'site1', '2026-07-23');
    expect(result.eligibilityStatus).toBe('contratos_superpuestos');
    expect(result.reasonCode).toBe('MULTIPLE_APPLICABLE_CONTRACTS');
    expect(result.conflictingContracts?.length).toBe(2);
  });
});
