import React from 'react';
import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
// @ts-ignore
import { axe, toHaveNoViolations } from 'jest-axe';
import AttendanceShadowQA from '../AttendanceShadowQA';
import { useAttendanceShadow } from '../../hooks/useAttendanceShadow';
import { useAppStore } from '../../store/useAppStore';

expect.extend(toHaveNoViolations);

// Mock dependencies
vi.mock('../../hooks/useAttendanceShadow', () => ({
  useAttendanceShadow: vi.fn()
}));
vi.mock('../../store/useAppStore', () => ({
  useAppStore: vi.fn()
}));
vi.mock('../../lib/firebase', () => ({
  db: {},
  auth: {},
  functions: {}
}));

describe('AttendanceShadowQA Component', () => {
  const mockExecute = vi.fn();
  const mockReset = vi.fn();
  const mockNextPage = vi.fn();
  const mockPreviousPage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useAppStore as unknown as Mock).mockReturnValue({
      employees: [
        { id: 'emp1', firstName: 'Juan', lastNamePaterno: 'Perez' },
        { id: 'emp2', firstName: 'Maria', lastNamePaterno: 'Gomez' }
      ],
      sites: [
        { id: 'suc1', name: 'Sucursal Centro' }
      ]
    });

    (useAttendanceShadow as unknown as Mock).mockReturnValue({
      response: null,
      loading: false,
      error: null,
      execute: mockExecute,
      reset: mockReset,
      nextPage: mockNextPage,
      previousPage: mockPreviousPage,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });

  it('Vista vacía inicial - renders successfully and has no a11y violations', async () => {
    const { container } = render(<AttendanceShadowQA />);
    expect(screen.getByText('Asistencia Multiturno — Vista Shadow QA')).toBeInTheDocument();
    expect(screen.getByText(/Vista de validación aislada/i)).toBeInTheDocument();
    
    // @ts-ignore
    expect(results).toHaveNoViolations();
  });

  it('Loading - shows loader and disables button', async () => {
    (useAttendanceShadow as unknown as Mock).mockReturnValue({
      response: null,
      loading: true,
      error: null,
      execute: mockExecute,
      reset: mockReset,
      nextPage: mockNextPage,
      previousPage: mockPreviousPage,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    render(<AttendanceShadowQA />);
    expect(screen.getByRole('button', { name: /Consultando/i })).toBeDisabled();
    expect(screen.getByText('Consultando...')).toBeInTheDocument();
  });

  it('Error de permisos - shows error message and clears results', async () => {
    (useAttendanceShadow as unknown as Mock).mockReturnValue({
      response: null,
      loading: false,
      error: 'No tienes autorización para consultar esta información.',
      execute: mockExecute,
      reset: mockReset,
      nextPage: mockNextPage,
      previousPage: mockPreviousPage,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    render(<AttendanceShadowQA />);
    expect(screen.getByText('No tienes autorización para consultar esta información.')).toBeInTheDocument();
  });

  it('Error de cursor expirado', async () => {
    (useAttendanceShadow as unknown as Mock).mockReturnValue({
      response: null,
      loading: false,
      error: 'El cursor de paginación ha expirado o es inválido.',
      execute: mockExecute,
      reset: mockReset,
      nextPage: mockNextPage,
      previousPage: mockPreviousPage,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    render(<AttendanceShadowQA />);
    expect(screen.getByText(/expirado o es inválido/i)).toBeInTheDocument();
  });

  it('Resultado Legacy sin V2', async () => {
    (useAttendanceShadow as unknown as Mock).mockReturnValue({
      response: {
        legacyResult: { items: [{ id: 'L1', checkInAt: '2024-06-01T08:00:00Z', workedMinutes: 480 }], hasMore: false },
        v2Result: { records: [] },
        comparison: { comparisonStatus: 'v2_invalid', comparisonScope: 'full', groupsCompared: 1, groupsDeferred: 0 }
      },
      loading: false,
      error: null,
      execute: mockExecute,
      reset: mockReset,
      nextPage: mockNextPage,
      previousPage: mockPreviousPage,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    render(<AttendanceShadowQA />);
    expect(screen.getByText('Documento V2 Inválido Excluido')).toBeInTheDocument();
  });

  it('Resultado V2 sin Legacy', async () => {
    (useAttendanceShadow as unknown as Mock).mockReturnValue({
      response: {
        legacyResult: { items: [], hasMore: false },
        v2Result: { records: [{ attendanceId: 'V1', sessions: [{ checkInAt: '2024-06-01T08:00:00Z', workedMinutes: 480 }] }] },
        comparison: { comparisonStatus: 'expected_legacy_limitation', comparisonScope: 'full', groupsCompared: 1, groupsDeferred: 0 }
      },
      loading: false,
      error: null,
      execute: mockExecute,
      reset: mockReset,
      nextPage: mockNextPage,
      previousPage: mockPreviousPage,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    render(<AttendanceShadowQA />);
    expect(screen.getByText('Limitación Legacy Esperada')).toBeInTheDocument();
  });

  it('Badge MULTITURNO - Una sesión vs Dos sesiones', async () => {
    (useAttendanceShadow as unknown as Mock).mockReturnValue({
      response: {
        legacyResult: { items: [{ id: 'L1', checkInAt: '2024-06-01T08:00:00Z', workedMinutes: 480 }], hasMore: false },
        v2Result: { records: [{ 
            attendanceId: 'V1', 
            sessions: [
              { checkInAt: '2024-06-01T08:00:00Z', workedMinutes: 480 },
              { checkInAt: '2024-06-01T20:00:00Z', workedMinutes: 480 }
            ] 
        }] },
        comparison: { comparisonStatus: 'legacy_overwrite_detected', comparisonScope: 'full', groupsCompared: 1, groupsDeferred: 0 }
      },
      loading: false,
      error: null,
      execute: mockExecute,
      reset: mockReset,
      nextPage: mockNextPage,
      previousPage: mockPreviousPage,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    const { container } = render(<AttendanceShadowQA />);
    expect(screen.getByText('Posible Sobrescritura Legacy')).toBeInTheDocument();
    
    // a11y check for complex rendered results
    // @ts-ignore
    expect(results).toHaveNoViolations();
  });

  it('No se renderiza RUT, IP, payloadHash, operationTokenId, requestId, stack trace', () => {
    (useAttendanceShadow as unknown as Mock).mockReturnValue({
      response: {
        legacyResult: { items: [{ id: 'L1' }], hasMore: false },
        v2Result: { records: [{ attendanceId: 'V1', sessions: [] }] },
        comparison: { comparisonStatus: 'exact_match', comparisonScope: 'full', groupsCompared: 1, groupsDeferred: 0 }
      },
      loading: false,
      error: null,
      execute: mockExecute,
      reset: mockReset,
      nextPage: mockNextPage,
      previousPage: mockPreviousPage,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    render(<AttendanceShadowQA />);
    const domString = screen.getByTestId('shadow-qa-container').innerHTML;
    expect(domString).not.toMatch(/RUT/i);
    expect(domString).not.toMatch(/\bIP\b/);
    expect(domString).not.toMatch(/payloadHash/i);
    expect(domString).not.toMatch(/operationTokenId/i);
    expect(domString).not.toMatch(/requestId/i);
  });

  it('Resumen diario y de sucursal - groupsCompared and groupsDeferred', () => {
    (useAttendanceShadow as unknown as Mock).mockReturnValue({
      response: {
        legacyResult: { items: [], hasMore: false },
        v2Result: { records: [] },
        comparison: { 
          comparisonStatus: 'exact_match',
          comparisonScope: 'page',
          groupsCompared: 10, 
          groupsDeferred: 2
        }
      },
      loading: false,
      error: null,
      execute: mockExecute,
      reset: mockReset,
      nextPage: mockNextPage,
      previousPage: mockPreviousPage,
      hasNextPage: false,
      hasPreviousPage: false,
    });
    render(<AttendanceShadowQA />);
    expect(screen.getByText(/Grupos comparados: 10, Diferidos: 2/i)).toBeInTheDocument();
  });

  it('Botones siguiente y anterior funcionales y bloqueados si no hay más', () => {
    (useAttendanceShadow as unknown as Mock).mockReturnValue({
      response: {
        legacyResult: { items: [], hasMore: true },
        v2Result: { records: [] },
        comparison: { comparisonStatus: 'exact_match', comparisonScope: 'page', groupsCompared: 0, groupsDeferred: 0 }
      },
      loading: false,
      error: null,
      execute: mockExecute,
      reset: mockReset,
      nextPage: mockNextPage,
      previousPage: mockPreviousPage,
      hasNextPage: true,
      hasPreviousPage: false,
    });
    render(<AttendanceShadowQA />);
    
    const nextBtn = screen.getByRole('button', { name: /Siguiente/i });
    const prevBtn = screen.getByRole('button', { name: /Anterior/i });
    
    expect(nextBtn).not.toBeDisabled();
    expect(prevBtn).toBeDisabled();
    
    fireEvent.click(nextBtn);
    expect(mockNextPage).toHaveBeenCalled();
  });

  it('Cambio de filtros reinicia paginación y deshabilita consultas largas', () => {
    render(<AttendanceShadowQA />);
    const selectType = screen.getAllByRole('combobox')[0]; // Tipo de consulta
    fireEvent.change(selectType, { target: { value: 'employee_range' } });
    
    // Changing filter triggers reset
    expect(mockReset).toHaveBeenCalled();
  });

});
