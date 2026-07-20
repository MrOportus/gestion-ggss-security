import { toAbsoluteMinutes } from './shadowResolver';

export type ShiftSchedule = { inicio: string; termino: string };
export const LEGACY_SHIFT_SCHEDULES: Record<string, ShiftSchedule> = {
  programado: { inicio: '07:30', termino: '19:30' },
  noche:      { inicio: '19:30', termino: '07:30' },
};

/**
 * Evalúa si una asistencia abierta de un día anterior debe cerrarse forzosamente
 * o si corresponde mantenerla abierta por ser un turno nocturno vigente.
 * 
 * @param openData Datos del documento de Asistencia abierto
 * @param turnoProgramadoData (Opcional) Datos del TurnoProgramado (si existe turnoProgramadoId y fue consultado)
 * @param nowMs Timestamp actual en milisegundos (ej. Date.now())
 * @param nowTimeStr Hora actual en HH:MM
 * @param todayDateStr Fecha de hoy en YYYY-MM-DD
 * @returns boolean - true si debe cerrarse, false si debe mantenerse abierto
 */
export function evaluateNocturnalClosure(
  openData: any,
  turnoProgramadoData: any | null,
  legacyProgramacionData: any | null,
  nowMs: number,
  nowTimeStr: string,
  todayDateStr: string
): boolean {
  // A. Si posee turnoProgramadoId y pudimos consultar el TurnoProgramado real
  if (turnoProgramadoData) {
    if (turnoProgramadoData.codigo === 'N' && turnoProgramadoData.horarioSnapshot?.termino) {
      const nowMins = toAbsoluteMinutes(todayDateStr, nowTimeStr, false);
      const terminoAbs = toAbsoluteMinutes(turnoProgramadoData.fecha, turnoProgramadoData.horarioSnapshot.termino, true);
      // Holgura de 60 mins
      if (nowMins <= terminoAbs + 60) {
        return false; // Mantener abierto
      }
    }
    return true; // Si no es N, o ya excedió, cerrar
  }

  // B. Si no posee turnoProgramadoId, usar fallback legacy con la programación
  if (legacyProgramacionData) {
    const legacyStatus = legacyProgramacionData.status || 'programado'; // ej 'noche'
    
    if (legacyStatus === 'noche' || legacyProgramacionData.codigo === 'N') {
      const openDate = new Date(openData.timestamp);
      const openDateStr = `${openDate.getFullYear()}-${String(openDate.getMonth() + 1).padStart(2, '0')}-${String(openDate.getDate()).padStart(2, '0')}`;
      
      const termino = legacyProgramacionData.horarioB || LEGACY_SHIFT_SCHEDULES['noche'].termino;
      
      const nowMins = toAbsoluteMinutes(todayDateStr, nowTimeStr, false);
      const terminoAbs = toAbsoluteMinutes(openDateStr, termino, true); // asume que termina el día siguiente
      
      // Holgura de 60 mins
      if (nowMins <= terminoAbs + 60) {
        return false; // Mantener abierto
      }
    }
  } else {
    // Si la programación legacy tampoco se entregó, intentamos inferir por openData
    const fallbackStatus = openData.turnoProgramadoStatus || 'programado';
    if (fallbackStatus === 'noche') {
      const openDate = new Date(openData.timestamp);
      const openDateStr = `${openDate.getFullYear()}-${String(openDate.getMonth() + 1).padStart(2, '0')}-${String(openDate.getDate()).padStart(2, '0')}`;
      const nowMins = toAbsoluteMinutes(todayDateStr, nowTimeStr, false);
      const terminoAbs = toAbsoluteMinutes(openDateStr, LEGACY_SHIFT_SCHEDULES['noche'].termino, true);
      
      if (nowMins <= terminoAbs + 60) {
        return false;
      }
    }
  }

  // C. Fallback conservador (legacy 13 horas)
  const openTimeMs = new Date(openData.timestamp).getTime();
  const diffHours = (nowMs - openTimeMs) / (1000 * 60 * 60);
  if (diffHours < 13) {
    // Si ha pasado menos de 13 horas y es otro día, podría ser un turno de noche genérico, pero si 
    // no decía 'noche' en status, ¿cerramos? El flujo legacy lo cerraba al cambiar de día inmediatamente.
    // Como el requerimiento pide: "C. Solo si no puede recuperarse ni el turno canónico ni la programación legacy: aplicar el fallback legacy conservador"
    // El fallback legacy era: "Si es otro día, CIERRA SIEMPRE". 
    // Entonces retornamos true.
    return true;
  }

  return true; 
}
