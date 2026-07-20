import { describe, it, expect } from 'vitest';
import { resolveShadowShift as resolveTs, toAbsoluteMinutes } from '../shadowResolver';
// @ts-ignore
import { resolveShadowShift as resolveJs } from '../../../functions/shadowResolver';

describe('Phase 5B.5 Parity Test between TypeScript and JavaScript Resolver', () => {
  const testCases = [
    {
      name: 'Candidato único coincide',
      candidates: [{ id: 't1', codigo: 'X', sucursalId: 's1', fecha: '2023-10-15', horarioSnapshot: { inicio: '08:00', termino: '16:00' } }],
      siteId: 's1', legacyCode: 'X', nowTime: '09:00',
      expectedDiag: 'unico'
    },
    {
      name: 'Sin candidatos',
      candidates: [],
      siteId: 's1', legacyCode: 'X', nowTime: '09:00',
      expectedDiag: 'sin_candidatos'
    },
    {
      name: 'Múltiples candidatos',
      candidates: [
        { id: 't1', codigo: 'X', sucursalId: 's1', fecha: '2023-10-15', horarioSnapshot: { inicio: '08:00', termino: '16:00' } },
        { id: 't2', codigo: 'X', sucursalId: 's1', fecha: '2023-10-15', horarioSnapshot: { inicio: '09:00', termino: '17:00' } }
      ],
      siteId: 's1', legacyCode: 'X', nowTime: '09:00',
      expectedDiag: 'multiple_candidates'
    },
    {
      name: 'Candidato cancelado o en descanso es ignorado',
      candidates: [
        { id: 't1', codigo: 'X', sucursalId: 's1', estado: 'cancelado', fecha: '2023-10-15', horarioSnapshot: { inicio: '08:00', termino: '16:00' } },
        { id: 't2', codigo: 'X', sucursalId: 's1', estado: 'descanso', fecha: '2023-10-15', horarioSnapshot: { inicio: '09:00', termino: '17:00' } }
      ],
      siteId: 's1', legacyCode: 'X', nowTime: '09:00',
      expectedDiag: 'sin_candidatos'
    },
    {
      name: 'Sucursal incompatible',
      candidates: [{ id: 't1', codigo: 'X', sucursalId: 's2', fecha: '2023-10-15', horarioSnapshot: { inicio: '08:00', termino: '16:00' } }],
      siteId: 's1', legacyCode: 'X', nowTime: '09:00',
      expectedDiag: 'sucursal_incompatible'
    },
    {
      name: 'Horario incompatible',
      candidates: [{ id: 't1', codigo: 'X', sucursalId: 's1', fecha: '2023-10-15', horarioSnapshot: { inicio: '15:00', termino: '23:00' } }],
      siteId: 's1', legacyCode: 'X', nowTime: '09:00',
      expectedDiag: 'horario_incompatible'
    }
  ];

  testCases.forEach(tc => {
    it(`Paridad: ${tc.name}`, () => {
      const nowAbs = toAbsoluteMinutes('2023-10-15', tc.nowTime, false);
      const resTs = resolveTs(tc.candidates as any, tc.siteId, tc.legacyCode, nowAbs);
      const resJs = resolveJs(tc.candidates, tc.siteId, tc.legacyCode, nowAbs);
      expect(resTs).toStrictEqual(resJs);
      expect(resTs.diagnostico).toBe(tc.expectedDiag);
    });
  });
});
