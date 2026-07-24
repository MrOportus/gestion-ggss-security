import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBatch } from '../useContractShadowBatch';
import { ContractBindingService } from '../contractBindingService';
import { ContractEligibilityService } from '../contractEligibilityService';
import { httpsCallable } from 'firebase/functions';

// Mock dependencies
vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => vi.fn(() => Promise.resolve({ data: { success: true } }))),
  getFunctions: vi.fn(() => ({}))
}));

vi.mock('../../lib/firebase', () => ({
  functions: {},
  db: {}
}));

vi.mock('../contractBindingService', () => ({
  ContractBindingService: {
    evaluateTurno: vi.fn()
  }
}));

vi.mock('../contractEligibilityService', () => ({
  ContractEligibilityService: {
    evaluateTurno: vi.fn()
  }
}));

describe('ShadowBatch runBatch logic', () => {
  const dummyFlag: any = {
    mode: 'shadow',
    enabled: true,
    schemaVersion: 1
  };
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no genera diagnostico si ambos motores coinciden y es match exacto', async () => {
    vi.mocked(ContractBindingService.evaluateTurno).mockReturnValue({
      estado: 'compatible',
      reasonCode: 'VALID'
    } as any);
    
    vi.mocked(ContractEligibilityService.evaluateTurno).mockReturnValue({
      eligibilityStatus: 'vigente',
      reasonCode: 'VALID_CONTRACT_FOUND',
      contratoId: 'c1'
    } as any);

    const mockCallable = vi.fn(() => Promise.resolve({ data: { success: true } }));
    vi.mocked(httpsCallable).mockReturnValue(mockCallable);

    const cache = {};
    const sequenceIdRef = { current: 1 };
    
    await runBatch(
      ['emp1'],
      'site1',
      '2026-07-01',
      '2026-07-01',
      [],
      {},
      dummyFlag,
      cache,
      1,
      sequenceIdRef
    );

    // No debe llamar al callable porque isMatch = true y no se loguean en etapa C
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('genera diagnostico con classification mismatch si los estados difieren', async () => {
    vi.mocked(ContractBindingService.evaluateTurno).mockReturnValue({
      estado: 'compatible'
    } as any);
    
    vi.mocked(ContractEligibilityService.evaluateTurno).mockReturnValue({
      eligibilityStatus: 'vencido',
      reasonCode: 'CONTRACT_EXPIRED_FOR_SHIFT_DATE',
      contratoId: 'c1'
    } as any);

    const mockCallable = vi.fn(() => Promise.resolve({ data: { success: true } }));
    vi.mocked(httpsCallable).mockReturnValue(mockCallable);

    const cache = {};
    const sequenceIdRef = { current: 1 };
    
    await runBatch(
      ['emp1'],
      'site1',
      '2026-07-01',
      '2026-07-01',
      [],
      {},
      dummyFlag,
      cache,
      1,
      sequenceIdRef
    );

    expect(mockCallable).toHaveBeenCalledTimes(1);
    const arg = (mockCallable as any).mock.calls[0][0] as any;
    expect(arg.classification).toBe('mismatch');
    expect(arg.reasonCode).toBe('status_mismatch'); // Como se definió en la lógica
    expect(arg.legacyStatus).toBe('compatible');
    expect(arg.canonicalStatus).toBe('vencido');
  });

  it('no ejecuta nada si la sequencia fue cancelada', async () => {
    const mockCallable = vi.fn();
    vi.mocked(httpsCallable).mockReturnValue(mockCallable);

    const sequenceIdRef = { current: 2 }; // The current is newer than the call's seq
    
    await runBatch(
      ['emp1'],
      'site1',
      '2026-07-01',
      '2026-07-01',
      [],
      {},
      dummyFlag,
      {},
      1, // Old sequence
      sequenceIdRef
    );

    expect(ContractBindingService.evaluateTurno).not.toHaveBeenCalled();
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('deduplica requests si la fingerprint ya esta en cache', async () => {
    vi.mocked(ContractBindingService.evaluateTurno).mockReturnValue({ estado: 'compatible' } as any);
    vi.mocked(ContractEligibilityService.evaluateTurno).mockReturnValue({ eligibilityStatus: 'sin_contrato' } as any);

    const mockCallable = vi.fn(() => Promise.resolve({ data: { success: true } }));
    vi.mocked(httpsCallable).mockReturnValue(mockCallable);

    const cache: Record<string, boolean> = {};
    const sequenceIdRef = { current: 1 };
    
    // Call 1
    await runBatch(['emp1'], 'site1', '2026-07-01', '2026-07-01', [], {}, dummyFlag, cache, 1, sequenceIdRef);
    expect(mockCallable).toHaveBeenCalledTimes(1);

    // Call 2 (mismos argumentos, deberia ignorarse porque la cache fue populada)
    await runBatch(['emp1'], 'site1', '2026-07-01', '2026-07-01', [], {}, dummyFlag, cache, 1, sequenceIdRef);
    expect(mockCallable).toHaveBeenCalledTimes(1); // Not increased
  });
});
