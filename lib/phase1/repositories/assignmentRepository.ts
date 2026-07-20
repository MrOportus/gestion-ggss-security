import { doc, getDoc, runTransaction, getFirestore, Firestore } from 'firebase/firestore';
import { AsignacionOperacional } from '../../../types/phase1';

export class AssignmentRepository {
  private db: Firestore;

  constructor(db?: Firestore) {
    // Para emulador inyectamos la db, en prod usaríamos getFirestore()
    this.db = db || getFirestore();
  }

  /**
   * Crea una asignación mensual de manera atómica mediante transacción 
   * previniendo race conditions en Firestore.
   */
  async createAssignmentAtomically(
    colaboradorId: string, 
    sucursalId: string, 
    mes: string, 
    usuarioId: string
  ): Promise<AsignacionOperacional> {
    
    // ID Determinista exigido por la Fase 1C
    const id = `assignment_${colaboradorId}_${sucursalId}_${mes}`;
    const docRef = doc(this.db, 'AsignacionesOperacionales', id);

    return await runTransaction(this.db, async (transaction) => {
      const sfDoc = await transaction.get(docRef);
      if (sfDoc.exists()) {
        throw new Error('Asignacion duplicada bajo concurrencia determinista');
      }

      const newAssignment: AsignacionOperacional = {
        id,
        colaboradorId,
        sucursalId,
        mes,
        estado: 'activa',
        creadoEn: new Date().toISOString(),
        creadoPor: usuarioId
      };

      transaction.set(docRef, newAssignment);
      return newAssignment;
    });
  }

  async getOrCreateAssignmentAtomically(
    colaboradorId: string, 
    sucursalId: string, 
    mes: string, 
    usuarioId: string
  ): Promise<AsignacionOperacional> {
    const id = `assignment_${colaboradorId}_${sucursalId}_${mes}`;
    const docRef = doc(this.db, 'AsignacionesOperacionales', id);
    
    return await runTransaction(this.db, async (transaction) => {
      const sfDoc = await transaction.get(docRef);
      if (sfDoc.exists()) {
        return sfDoc.data() as AsignacionOperacional;
      }
      
      const newAssignment: AsignacionOperacional = {
        id,
        colaboradorId,
        sucursalId,
        mes,
        estado: 'activa',
        creadoEn: new Date().toISOString(),
        creadoPor: usuarioId
      };

      transaction.set(docRef, newAssignment);
      return newAssignment;
    });
  }
}
