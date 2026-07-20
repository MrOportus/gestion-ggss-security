import { collection, doc, getDoc, getDocs, query, setDoc, where, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Contrato } from '../../types/phase1';

export class ContratosService {
  private collectionName = 'Contratos';

  // Opcional: Para inyectar DB en pruebas
  private firestoreDb = db;
  setDb(testDb: any) {
    this.firestoreDb = testDb;
  }

  async getContratosByColaborador(colaboradorId: string): Promise<Contrato[]> {
    const q = query(
      collection(this.firestoreDb, this.collectionName),
      where('colaboradorId', '==', colaboradorId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data() as Contrato);
  }

  async getContratoById(contratoId: string): Promise<Contrato | null> {
    const docRef = doc(this.firestoreDb, this.collectionName, contratoId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return null;
    return docSnap.data() as Contrato;
  }

  async createContrato(data: Omit<Contrato, 'id' | 'creadoEn' | 'creadoPor'>, userId: string): Promise<string> {
    const newDocRef = doc(collection(this.firestoreDb, this.collectionName));
    const contrato: Contrato = {
      ...data,
      id: newDocRef.id,
      creadoEn: new Date().toISOString(),
      creadoPor: userId,
    };
    await setDoc(newDocRef, contrato);
    return newDocRef.id;
  }

  async updateContrato(contratoId: string, data: Partial<Contrato>, userId: string): Promise<void> {
    const docRef = doc(this.firestoreDb, this.collectionName, contratoId);
    await updateDoc(docRef, {
      ...data,
      modificadoEn: new Date().toISOString(),
      modificadoPor: userId
    });
  }
}

export const contratosService = new ContratosService();
