const { toTimestampMs, toRange, rangesOverlap, getOverlapType } = require('./functions/src/phase4/conflictService');
function detectConflict(candidate, existing) {
  if (existing.estado === 'cancelado') return { type: 'none' };
  if (existing.estado === 'trasladado') return { type: 'none' };
  const { inicioMs: cStart, finMs: cEnd } = toRange(candidate.fecha, candidate.horario);
  const { inicioMs: eStart, finMs: eEnd } = toRange(existing.fecha, existing.horario);
  const overlapType = getOverlapType(cStart, cEnd, eStart, eEnd);
  if (overlapType !== 'none') return { type: overlapType };
  return { type: 'none' };
}
const candidate = {
  fecha: '2023-10-15',
  horario: { inicio: '08:00', termino: '18:00', cruzaMedianoche: false },
};
const existing = {
  fecha: '2023-10-15',
  horario: { inicio: '08:00', termino: '18:00', cruzaMedianoche: false },
  estado: 'programado',
};
console.log('detectConflict:', detectConflict(candidate, existing));
