import { db } from '../../lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { TurnoProgramado } from '../../types/phase1';

export interface ComparisonResult {
  sucursalId: string;
  monthKey: string;
  legacyCount: number;
  shadowCount: number;
  matchCount: number;
  differences: DifferenceDetail[];
  compatibilityPercent: string;
  errors: number;
}

export interface DifferenceDetail {
  colaboradorId: string;
  fecha: string;
  legacyCode: string;
  shadowCode: string;
  motivo: string;
}

export class ShadowComparator {
  
  async compareMonth(siteId: string | number, monthKey: string): Promise<ComparisonResult> {
    const siteStr = siteId.toString();
    const firstDay = `${monthKey}-01`;
    // Calculamos el último día
    const [y, m] = monthKey.split('-');
    const lastDayObj = new Date(parseInt(y), parseInt(m), 0);
    const lastDayStr = `${monthKey}-${lastDayObj.getDate().toString().padStart(2, '0')}`;

    // 1. Fetch Legacy
    const legacyQ = query(
      collection(db, 'programacion'),
      where('siteId', 'in', [siteStr, Number(siteStr)]), // A veces es numérico
      where('date', '>=', firstDay),
      where('date', '<=', lastDayStr)
    );
    const legacySnap = await getDocs(legacyQ);
    const legacyMap: Record<string, string> = {};
    legacySnap.docs.forEach(d => {
      const data = d.data();
      const key = `${data.employeeId}_${data.date}`;
      legacyMap[key] = data.status === 'programado' ? 'X' : (data.status === 'noche' ? 'N' : 'D');
    });

    // 2. Fetch Shadow (TurnosProgramados)
    const shadowQ = query(
      collection(db, 'TurnosProgramados'),
      where('sucursalId', '==', siteStr),
      where('fecha', '>=', firstDay),
      where('fecha', '<=', lastDayStr)
    );
    const shadowSnap = await getDocs(shadowQ);
    const shadowMap: Record<string, TurnoProgramado> = {};
    shadowSnap.docs.forEach(d => {
      const data = d.data() as TurnoProgramado;
      // No incluimos cancelados si en legacy era "null" / borrado. 
      // En legacy cuando se borra, el doc desaparece. En shadow queda como cancelado.
      if (data.estado !== 'cancelado') {
        const key = `${data.colaboradorId}_${data.fecha}`;
        shadowMap[key] = data;
      }
    });

    // 3. Compare
    let matchCount = 0;
    const differences: DifferenceDetail[] = [];
    const allKeys = new Set([...Object.keys(legacyMap), ...Object.keys(shadowMap)]);

    allKeys.forEach(key => {
      const legacyVal = legacyMap[key];
      const shadowVal = shadowMap[key];
      const [colab, fecha] = key.split('_');

      if (legacyVal && shadowVal) {
        if (legacyVal === shadowVal.codigo) {
          matchCount++;
        } else {
          differences.push({
            colaboradorId: colab,
            fecha,
            legacyCode: legacyVal,
            shadowCode: shadowVal.codigo,
            motivo: 'Diferencia de código (X/N/D)'
          });
        }
      } else if (legacyVal && !shadowVal) {
        differences.push({
          colaboradorId: colab,
          fecha,
          legacyCode: legacyVal,
          shadowCode: 'FALTANTE',
          motivo: 'Falta registro sombra'
        });
      } else if (!legacyVal && shadowVal) {
        differences.push({
          colaboradorId: colab,
          fecha,
          legacyCode: 'FALTANTE',
          shadowCode: shadowVal.codigo,
          motivo: 'Registro sombra sobrante o legacy eliminado físicamente'
        });
      }
    });

    const total = allKeys.size;
    const compatibility = total === 0 ? '100.0' : ((matchCount / total) * 100).toFixed(1);

    return {
      sucursalId: siteStr,
      monthKey,
      legacyCount: Object.keys(legacyMap).length,
      shadowCount: Object.keys(shadowMap).length,
      matchCount,
      differences,
      compatibilityPercent: compatibility,
      errors: differences.length // simplificado
    };
  }
}

export const shadowComparator = new ShadowComparator();
