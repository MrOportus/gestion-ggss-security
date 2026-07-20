import { db as defaultDb } from '../../lib/firebase';
import { doc, getDoc, Firestore } from 'firebase/firestore';
import { FeatureFlagState } from '../../types/phase1';

export class FeatureFlagService {
  private db: Firestore = defaultDb;

  setDb(dbInstance: Firestore) {
    this.db = dbInstance;
  }

  /**
   * Obtiene el modo de operación para una sucursal en un mes dado.
   * El fallback seguro siempre será 'legacy'.
   */
  async getOperationMode(siteId: string | number, monthKey: string): Promise<FeatureFlagState> {
    const siteStr = siteId.toString();
    const flagId = `flag_${siteStr}_${monthKey}`;
    
    try {
      const docRef = doc(this.db, 'FeatureFlags', flagId);
      const snap = await getDoc(docRef);
      
      if (snap.exists()) {
        const estado = snap.data().estado as FeatureFlagState;
        
        // GUARD OBLIGATORIO: Si está new_model, bloquemos por seguridad en Fase 2.
        if (estado === 'new_model') {
          console.warn(`[GUARD] Sucursal ${siteStr} tiene new_model activado. Forzando legacy temporalmente por seguridad en Fase 2.`);
          return 'legacy';
        }
        
        return estado;
      }
      return 'legacy';
    } catch (error) {
      console.error('[FeatureFlagService] Error al obtener flag, fallback a legacy', error);
      return 'legacy'; // Failsafe
    }
  }
}

export const featureFlagService = new FeatureFlagService();
