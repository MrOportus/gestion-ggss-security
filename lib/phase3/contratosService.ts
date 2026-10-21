import { collection, doc, getDoc, getDocs, query, setDoc, where, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Contrato } from '../../types/phase1';
import { Employee, EstadoOperativoColaborador } from '../../types';

export function cleanFirestorePayload<T extends Record<string, any>>(obj: T): Partial<T> {
  const result: any = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}

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
    // Validaciones básicas de integridad
    if (!data.colaboradorId || !data.tipo || !data.fechaInicio) {
      throw new Error('Faltan campos obligatorios para el contrato (colaborador, tipo, fecha de inicio).');
    }
    const isPlazoFijo = data.tipo.toLowerCase().includes('plazo');
    if (isPlazoFijo && !data.fechaTermino) {
      throw new Error('Los contratos a plazo fijo requieren obligatoriamente una fecha de término.');
    }
    if (data.fechaTermino && data.fechaInicio > data.fechaTermino) {
      throw new Error('La fecha de inicio no puede ser posterior a la fecha de término.');
    }

    const newDocRef = doc(collection(this.firestoreDb, this.collectionName));
    const now = new Date().toISOString();
    const contrato: Contrato = {
      ...data,
      id: newDocRef.id,
      estadoDocumental: data.estadoDocumental || (data.documentoId ? 'firmado_digital' : 'no_adjunto'),
      origenRegistro: data.origenRegistro || 'manual_aspro' as any,
      estadoConciliacion: data.estadoConciliacion || 'verificado',
      creadoEn: now,
      creadoPor: userId,
      modificadoEn: now,
      modificadoPor: userId,
    };
    await setDoc(newDocRef, cleanFirestorePayload(contrato));
    return newDocRef.id;
  }

  async updateContrato(contratoId: string, data: Partial<Contrato>, userId: string): Promise<void> {
    const isPlazoFijo = data.tipo && data.tipo.toLowerCase().includes('plazo');
    if (isPlazoFijo && data.fechaTermino === '') {
      throw new Error('Los contratos a plazo fijo requieren una fecha de término válida.');
    }
    if (data.fechaInicio && data.fechaTermino && data.fechaInicio > data.fechaTermino) {
      throw new Error('La fecha de inicio no puede ser posterior a la fecha de término.');
    }

    const docRef = doc(this.firestoreDb, this.collectionName, contratoId);
    await updateDoc(docRef, cleanFirestorePayload({
      ...data,
      modificadoEn: new Date().toISOString(),
      modificadoPor: userId
    }));
  }

  /**
   * Renueva un contrato existente de forma atómica:
   * 1. Marca el contrato anterior como 'renovado' y enlaza contratoSiguienteId.
   * 2. Crea el nuevo contrato con contratoAnteriorId y numeroRenovacion incrementado.
   */
  async renewContrato(
    contratoAnteriorId: string,
    nuevoContratoData: Omit<Contrato, 'id' | 'creadoEn' | 'creadoPor' | 'contratoAnteriorId' | 'numeroRenovacion'>,
    userId: string
  ): Promise<string> {
    const contratoAnterior = await this.getContratoById(contratoAnteriorId);
    if (!contratoAnterior) {
      throw new Error(`Contrato anterior con ID ${contratoAnteriorId} no fue encontrado.`);
    }

    const isPlazoFijo = nuevoContratoData.tipo.toLowerCase().includes('plazo');
    if (isPlazoFijo && !nuevoContratoData.fechaTermino) {
      throw new Error('La renovación a plazo fijo requiere una fecha de término válida.');
    }
    if (nuevoContratoData.fechaTermino && nuevoContratoData.fechaInicio > nuevoContratoData.fechaTermino) {
      throw new Error('La fecha de inicio de la renovación no puede ser posterior a la de término.');
    }

    const newDocRef = doc(collection(this.firestoreDb, this.collectionName));
    const now = new Date().toISOString();
    const numeroRenovacion = (contratoAnterior.numeroRenovacion || 1) + 1;

    const nuevoContrato: Contrato = {
      ...nuevoContratoData,
      id: newDocRef.id,
      contratoAnteriorId: contratoAnteriorId,
      numeroRenovacion,
      estado: nuevoContratoData.estado || 'vigente',
      estadoDocumental: nuevoContratoData.estadoDocumental || (nuevoContratoData.documentoId ? 'firmado_digital' : 'no_adjunto'),
      origenRegistro: nuevoContratoData.origenRegistro || 'manual_aspro' as any,
      estadoConciliacion: nuevoContratoData.estadoConciliacion || 'verificado',
      creadoEn: now,
      creadoPor: userId,
      modificadoEn: now,
      modificadoPor: userId,
    };

    // 1. Guardar nuevo contrato
    await setDoc(newDocRef, cleanFirestorePayload(nuevoContrato));

    // 2. Actualizar contrato anterior como 'renovado'
    const docAnteriorRef = doc(this.firestoreDb, this.collectionName, contratoAnteriorId);
    await updateDoc(docAnteriorRef, {
      estado: 'renovado',
      contratoSiguienteId: newDocRef.id,
      modificadoEn: now,
      modificadoPor: userId
    });

    return newDocRef.id;
  }

  /**
   * Vincula un documento digital existente (`documents/{docId}`) al contrato.
   */
  async linkDocument(
    contratoId: string, 
    documentoId: string, 
    estadoDocumental: Contrato['estadoDocumental'] = 'firmado_digital',
    userId: string,
    observaciones?: string
  ): Promise<void> {
    const docRef = doc(this.firestoreDb, this.collectionName, contratoId);
    const updatePayload: Partial<Contrato> = {
      documentoId,
      estadoDocumental,
      modificadoEn: new Date().toISOString(),
      modificadoPor: userId,
    };
    if (observaciones) {
      updatePayload.observacionesDocumento = observaciones;
    }
    await updateDoc(docRef, cleanFirestorePayload(updatePayload));
  }
}

/**
 * Valida si un rol de usuario tiene permisos para administrar contratos (crear, editar, renovar).
 */
export function canManageContracts(role?: string): boolean {
  return role === 'admin' || role === 'rrhh';
}

/**
 * Detecta si un contrato candidato ya existe para el mismo colaborador, tipo y fechas,
 * evitando duplicación por reintentos de red, clicks dobles o sincronizaciones automáticas.
 */
export function isDuplicateContract(
  existingContratos: Contrato[],
  candidate: { colaboradorId: string; tipo: string; fechaInicio: string; fechaTermino?: string }
): boolean {
  return existingContratos.some(c => 
    c.colaboradorId === candidate.colaboradorId &&
    c.tipo === candidate.tipo &&
    c.fechaInicio === candidate.fechaInicio &&
    (c.fechaTermino || null) === (candidate.fechaTermino || null) &&
    c.estado !== 'anulado'
  );
}

/**
 * Obtiene el contrato principal vigente de una lista de contratos de un colaborador.
 * Prioriza: 'vigente' no caducado > 'pendiente_firma' > último registrado.
 */
export function getActiveContract(contratos: Contrato[], referenceDate?: string): Contrato | null {
  if (!contratos || contratos.length === 0) return null;
  const today = referenceDate || new Date().toISOString().split('T')[0];
  const valid = contratos.filter(c => c.estado !== 'anulado');
  if (valid.length === 0) return null;

  // 1. Contrato vigente que no haya caducado por fecha
  const vigenteNoCaducado = valid.find(c => 
    c.estado === 'vigente' && (!c.fechaTermino || c.fechaTermino >= today)
  );
  if (vigenteNoCaducado) return vigenteNoCaducado;

  // 2. Contrato pendiente de firma
  const pendiente = valid.find(c => c.estado === 'pendiente_firma');
  if (pendiente) return pendiente;

  // 3. Si todos caducaron o están vencidos, retorna el más reciente por fechaInicio / fechaTermino
  const sorted = [...valid].sort((a, b) => {
    const aTerm = a.fechaTermino || '9999-99-99';
    const bTerm = b.fechaTermino || '9999-99-99';
    if (aTerm !== bTerm) return bTerm.localeCompare(aTerm);
    return (b.fechaInicio || '').localeCompare(a.fechaInicio || '');
  });
  return sorted[0] || null;
}

/**
 * Determina el estado operativo de un colaborador respetando las reglas de ASPRO:
 * 1. Si está explícitamente configurado en la ficha (por acción de RR.HH. / Admin), se respeta ese valor.
 * 2. Si isActive === false, corresponde a 'inactivo'.
 * 3. Si isActive === true y tiene sucursal asignada activa (> 0), corresponde a 'en_servicio'.
 * 4. Si isActive === true y no tiene sucursal asignada:
 *    - Si carece de cargo registrado o datos mínimos, corresponde a 'por_revisar' (pendiente de confirmar).
 *    - Si tiene cargo u oficio operativo, corresponde a 'reserva' (personal disponible para coberturas).
 * Nota: El vencimiento de un contrato NO altera automáticamente el estado operativo del trabajador.
 */
export function resolveEmployeeOperationalStatus(emp: Employee): EstadoOperativoColaborador {
  if (emp.estadoOperativo) {
    return emp.estadoOperativo;
  }
  if (emp.isActive === false) {
    return 'inactivo';
  }
  if (emp.currentSiteId && Number(emp.currentSiteId) > 0) {
    return 'en_servicio';
  }
  if (!emp.cargo || emp.cargo.trim() === '') {
    return 'por_revisar';
  }
  return 'reserva';
}

export { formatDateDDMMYYYY } from '../textUtils';

export type EvaluatedContractBadgeStatus = 'vigente' | 'por_vencer' | 'caducado' | 'renovado' | 'pendiente_firma' | 'borrador' | 'anulado';

export interface EvaluatedContractBadge {
  status: EvaluatedContractBadgeStatus;
  label: string;
  badgeClass: string;
  isCaducado: boolean;
  diffDays: number | null;
}

/**
 * Evalúa dinámicamente el estado y badge de un contrato individual:
 * Si un contrato tiene fecha de término anterior a hoy, se evalúa como CADUCADO
 * (badge rojo/rose), independientemente de que su estado previo en BD fuera 'vigente'.
 */
export function evaluateContractBadge(contract: Contrato, referenceDate?: string): EvaluatedContractBadge {
  const today = referenceDate || new Date().toISOString().split('T')[0];

  if (contract.estado === 'anulado') {
    return {
      status: 'anulado',
      label: 'Anulado',
      badgeClass: 'bg-slate-100 text-slate-500 border border-slate-200',
      isCaducado: false,
      diffDays: null
    };
  }

  if (contract.estado === 'renovado') {
    return {
      status: 'renovado',
      label: 'Renovado',
      badgeClass: 'bg-slate-100 text-slate-600 border border-slate-200',
      isCaducado: false,
      diffDays: null
    };
  }

  if (contract.estado === 'borrador') {
    return {
      status: 'borrador',
      label: 'Borrador',
      badgeClass: 'bg-slate-100 text-slate-600 border border-slate-200',
      isCaducado: false,
      diffDays: null
    };
  }

  if (contract.estado === 'pendiente_firma') {
    return {
      status: 'pendiente_firma',
      label: 'Pendiente Firma',
      badgeClass: 'bg-purple-50 text-purple-700 border border-purple-200',
      isCaducado: false,
      diffDays: null
    };
  }

  // Si tiene fecha de término y ya pasó con respecto a hoy -> CADUCADO
  const isExpiredDate = Boolean(contract.fechaTermino && contract.fechaTermino < today);
  if (isExpiredDate || contract.estado === 'vencido') {
    let diffDays: number | null = null;
    if (contract.fechaTermino) {
      const termObj = new Date(contract.fechaTermino + 'T00:00:00');
      const todayObj = new Date(today + 'T00:00:00');
      diffDays = Math.ceil((termObj.getTime() - todayObj.getTime()) / (1000 * 60 * 60 * 24));
    }
    return {
      status: 'caducado',
      label: 'Caducado',
      badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200',
      isCaducado: true,
      diffDays
    };
  }

  // Tiene fecha de término futura o actual con estado vigente
  if (contract.estado === 'vigente') {
    return {
      status: 'vigente',
      label: 'Vigente',
      badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
      isCaducado: false,
      diffDays: null
    };
  }

  // Otros estados no caducados
  return {
    status: (contract.estado as any) || 'vigente',
    label: contract.estado ? contract.estado.replace('_', ' ') : 'Vigente',
    badgeClass: 'bg-slate-50 text-slate-700 border border-slate-200',
    isCaducado: false,
    diffDays: null
  };
}

export const contratosService = new ContratosService();

