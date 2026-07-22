import { renderHook, act } from '@testing-library/react';
import { useAttendanceShadow } from '../useAttendanceShadow';
import { AttendanceShadowService } from '../../services/attendanceShadowService';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/attendanceShadowService', () => ({
  AttendanceShadowService: {
    execute: vi.fn(),
    generateRequestId: vi.fn(() => 'req-' + Math.random().toString(36).substr(2, 9))
  }
}));

describe('useAttendanceShadow Hook Concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Consulta A y B comienzan juntas, B finaliza primero, A finaliza después: La respuesta B permanece', async () => {
    let resolveA: any, resolveB: any;
    
    // Configuramos el mock para controlar manualmente las resoluciones
    const executeMock = vi.mocked(AttendanceShadowService.execute);
    
    executeMock.mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }));
    executeMock.mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));

    const { result } = renderHook(() => useAttendanceShadow());

    // Iniciar A
    act(() => {
      result.current.execute({ queryType: 'branch_day', sucursalId: 's1', jornadaDate: '2026-07-22' });
    });
    
    // Iniciar B en el mismo milisegundo (o casi, simulado en el event loop local)
    act(() => {
      result.current.execute({ queryType: 'branch_day', sucursalId: 's2', jornadaDate: '2026-07-22' });
    });

    // B finaliza primero
    await act(async () => {
      resolveB({ legacyResult: { items: [{ id: 'fromB' }], hasMore: false }, v2Result: { items: [], hasMore: false }, comparison: { groupsCompared: 0, groupsDeferred: 0, differencesDetected: false, comparisonStatus: 'partial', comparisonScope: 'day' } });
    });

    // Wait for state updates
    await new Promise(r => setTimeout(r, 0));
    
    expect(result.current.loading).toBe(false);
    expect(result.current.response?.legacyResult.items[0].id).toBe('fromB');

    // A finaliza después
    await act(async () => {
      resolveA({ legacyResult: { items: [{ id: 'fromA' }], hasMore: false }, v2Result: { items: [], hasMore: false }, comparison: { groupsCompared: 0, groupsDeferred: 0, differencesDetected: false, comparisonStatus: 'partial', comparisonScope: 'day' } });
    });

    // La respuesta B debe permanecer, A no cambia resultados ni loading
    expect(result.current.loading).toBe(false);
    expect(result.current.response?.legacyResult.items[0].id).toBe('fromB');
  });

  it('Desmontaje durante una consulta no lanza warnings de actualización de estado', async () => {
    const consoleSpy = vi.spyOn(console, 'error');
    let resolveQuery: any;
    const executeMock = vi.mocked(AttendanceShadowService.execute);
    executeMock.mockImplementationOnce(() => new Promise((resolve) => { resolveQuery = resolve; }));

    const { result, unmount } = renderHook(() => useAttendanceShadow());

    act(() => {
      result.current.execute({ queryType: 'branch_day', sucursalId: 's1', jornadaDate: '2026-07-22' });
    });

    // Desmontar el componente ANTES de que termine la consulta
    unmount();

    // Finalizar la consulta
    await act(async () => {
      resolveQuery({ legacyResult: { items: [], hasMore: false }, v2Result: { items: [], hasMore: false }, comparison: { groupsCompared: 0, groupsDeferred: 0, differencesDetected: false, comparisonStatus: 'partial', comparisonScope: 'day' } });
    });

    // No deberían haber errores de "Can't perform a React state update on an unmounted component"
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('Reset durante una consulta cancela la actualización', async () => {
    let resolveQuery: any;
    const executeMock = vi.mocked(AttendanceShadowService.execute);
    executeMock.mockImplementationOnce(() => new Promise((resolve) => { resolveQuery = resolve; }));

    const { result } = renderHook(() => useAttendanceShadow());

    act(() => {
      result.current.execute({ queryType: 'branch_day', sucursalId: 's1', jornadaDate: '2026-07-22' });
    });

    act(() => {
      result.current.reset();
    });

    await act(async () => {
      resolveQuery({ legacyResult: { items: [{ id: 'fromA' }], hasMore: false }, v2Result: { items: [], hasMore: false }, comparison: { groupsCompared: 0, groupsDeferred: 0, differencesDetected: false, comparisonStatus: 'partial', comparisonScope: 'day' } });
    });

    expect(result.current.response).toBeNull();
  });

  it('Cambio de filtros (nueva query) cancela la actualización de la primera', async () => {
    let resolveA: any, resolveB: any;
    const executeMock = vi.mocked(AttendanceShadowService.execute);
    executeMock.mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }));
    executeMock.mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));

    const { result } = renderHook(() => useAttendanceShadow());

    act(() => {
      result.current.execute({ queryType: 'branch_day', sucursalId: 's1', jornadaDate: '2026-07-22' });
    });

    act(() => {
      // Cambio de filtros
      result.current.execute({ queryType: 'branch_day', sucursalId: 's2', jornadaDate: '2026-07-22' });
    });

    // Termina la nueva primero o la vieja, da igual. Hacemos terminar la nueva primero.
    await act(async () => {
      resolveB({ legacyResult: { items: [{ id: 'fromNew' }], hasMore: false }, v2Result: { items: [], hasMore: false }, comparison: { groupsCompared: 0, groupsDeferred: 0, differencesDetected: false, comparisonStatus: 'partial', comparisonScope: 'day' } });
    });

    await act(async () => {
      resolveA({ legacyResult: { items: [{ id: 'fromOld' }], hasMore: false }, v2Result: { items: [], hasMore: false }, comparison: { groupsCompared: 0, groupsDeferred: 0, differencesDetected: false, comparisonStatus: 'partial', comparisonScope: 'day' } });
    });

    // Debe quedar la nueva
    expect(result.current.response?.legacyResult.items[0].id).toBe('fromNew');
  });
});
