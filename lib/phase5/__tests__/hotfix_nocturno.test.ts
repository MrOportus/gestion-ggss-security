import { describe, it, expect } from 'vitest';
import { evaluateNocturnalClosure } from '../nocturnalClosure';

describe('Phase 5B.5 Hotfix Nocturno - Función Pura', () => {
  it('1. Check-in N recién creado sin ID y refresh inmediato permanece abierto', () => {
    const openData = { timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(), turnoProgramadoStatus: 'noche' }; // 15 mins ago
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const result = evaluateNocturnalClosure(openData, null, null, now.getTime(), '01:00', todayStr);
    expect(result).toBe(false);
  });

  it('2. Turno N vigente a las 06:00 permanece abierto', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}T19:30:00Z`;
    const openData = { timestamp: yesterdayStr, turnoProgramadoStatus: 'noche' };
    
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const result = evaluateNocturnalClosure(openData, null, null, now.getTime(), '06:00', todayStr);
    expect(result).toBe(false);
  });

  it('3. N superó 07:30 + 60 min, debe cerrarse', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}T19:30:00Z`;
    const openData = { timestamp: yesterdayStr, turnoProgramadoStatus: 'noche' };
    
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const result = evaluateNocturnalClosure(openData, null, null, now.getTime(), '08:45', todayStr);
    expect(result).toBe(true);
  });
});
