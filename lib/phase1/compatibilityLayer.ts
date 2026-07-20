/**
 * Capa de compatibilidad para leer datos legacy (de Phase 0 y anteriores)
 * y mapearlos al modelo conceptual de Phase 1 para diagnóstico y pruebas.
 */

export class CompatibilityLayer {
  
  /**
   * Normaliza los códigos de programación antiguos a formato estándar
   */
  normalizeShiftCode(legacyStatus: string): string {
    if (legacyStatus === 'programado') return 'X';
    if (legacyStatus === 'noche') return 'N';
    if (legacyStatus === 'descanso') return 'D';
    return legacyStatus.toUpperCase();
  }

  /**
   * Resuelve los id de colaboradores (que a veces venían erróneos o inconsistentes)
   */
  normalizeEmployeeId(legacyEmployeeDocId: string, currentUid?: string): string {
    if (!legacyEmployeeDocId || legacyEmployeeDocId === 'undefined') {
      return currentUid || 'UNKNOWN';
    }
    return legacyEmployeeDocId;
  }

  /**
   * Resuelve problemas con fechas (como mes base-0 en JS antiguo vs YYYY-MM-DD estándar)
   */
  normalizeDate(legacyDateStr: string): string {
    // Si viene como DD-MM-YYYY, cambiar a YYYY-MM-DD
    const parts = legacyDateStr.split('-');
    if (parts.length === 3 && parts[0].length === 2) {
      return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return legacyDateStr; // Asumir que ya es correcto
  }
}

export const compatibilityLayer = new CompatibilityLayer();
