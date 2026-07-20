const CHECK_IN_MINUTES_BEFORE = 120;
const CHECK_IN_MINUTES_AFTER = 120;

function toAbsoluteMinutes(dateStr, timeStr, isNextDay = false) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, min] = timeStr.split(':').map(Number);
  const d = new Date(year, month - 1, day, hour, min, 0, 0);
  if (isNextDay) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime() / 60000;
}

function resolveShadowShift(
  candidates,
  legacySiteId,
  legacyCode,
  currentAbsMins
) {
  try {
    if (!candidates || candidates.length === 0) {
      return { turnoProgramadoId: null, diagnostico: 'sin_candidatos' };
    }

    const validStateCandidates = candidates.filter(c => {
      if (c.estado === 'cancelado') return false;
      if (c.estado === 'descanso') return false;
      if (c.estado === 'trasladado') return false;
      if (c.codigo === 'D') return false;
      return true;
    });

    if (validStateCandidates.length === 0) {
      return { turnoProgramadoId: null, diagnostico: 'sin_candidatos' };
    }

    const validSiteCandidates = validStateCandidates.filter(c => String(c.sucursalId) === String(legacySiteId));
    if (validSiteCandidates.length === 0) {
      return { turnoProgramadoId: null, diagnostico: 'sucursal_incompatible' };
    }

    // 3. Evaluar código legacy. Si el sistema entregó 'noche', asumimos 'N'. Si no, 'X'.
    // Si no hay candidatos con ese código, el resolver legacy fallaba y pasaba a todos, lo cual es inseguro.
    // Ahora: Si no coinciden códigos, SOLO avanzamos si hay candidatos por sucursal y evaluamos el horario,
    // dejando que la ventana de tiempo decida, y exigiendo que quede UN ÚNICO candidato.
    const expectedCode = legacyCode === 'noche' ? 'N' : 'X';
    const validCodeCandidates = validSiteCandidates.filter(c => c.codigo === expectedCode);
    const candidatesToEvaluate = validCodeCandidates.length > 0 ? validCodeCandidates : validSiteCandidates;

    const eligibleCandidates = candidatesToEvaluate.filter(c => {
      if (!c.horarioSnapshot || !c.horarioSnapshot.inicio) return false;
      
      const startAbsMins = toAbsoluteMinutes(c.fecha, c.horarioSnapshot.inicio, false);
      const diff = currentAbsMins - startAbsMins;
      
      if (diff >= -CHECK_IN_MINUTES_BEFORE && diff <= CHECK_IN_MINUTES_AFTER) {
        return true;
      }
      return false;
    });

    if (eligibleCandidates.length === 0) {
      return { turnoProgramadoId: null, diagnostico: 'horario_incompatible' };
    }

    if (eligibleCandidates.length === 1) {
      return { turnoProgramadoId: eligibleCandidates[0].id, diagnostico: 'unico' };
    }

    return { turnoProgramadoId: null, diagnostico: 'multiple_candidates' };

  } catch (err) {
    return { turnoProgramadoId: null, diagnostico: 'error_tecnico' };
  }
}

module.exports = {
  toAbsoluteMinutes,
  resolveShadowShift
};
