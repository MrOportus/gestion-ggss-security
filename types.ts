
export type Role = 'admin' | 'supervisor' | 'worker';

export interface User {
  uid: string;
  email: string | null;
  role: Role;
}

export interface Site {
  id: number;
  name: string; // Corresponde a "Obra o Faena"
  address: string; // Corresponde a "Direccion"
  empresa?: string; // Corresponde a "Empresa"
  rutEmpresa?: string; // Corresponde a "Rut E°"
  active: boolean;
}

export interface Employee {
  id: string; // Ahora es string (Firebase UID)
  firstName: string;
  lastNamePaterno: string;
  lastNameMaterno?: string;
  rut: string;
  email: string; // Obligatorio para Auth
  phone?: string;
  cargo: string;
  role: Role; // Rol para permisos

  // Datos Personales Extendidos
  fechaNacimiento?: string; // ISO Date string
  nacionalidad?: string;
  direccion?: string;
  estadoCivil?: string; // Soltero, Casado, Viudo, Divorciado
  sexo?: string; // Masculino, Femenino
  salud?: string; // Fonasa, Isapre X
  afp?: string; // Modelo, Habitat, etc.

  // Datos Laborales
  sueldoLiquido?: number; // Nuevo campo
  fechaVencimientoOS10?: string; // ISO Date string
  fechaInicioContrato?: string; // ISO Date string
  fechaTerminoContrato?: string; // ISO Date string
  isActive: boolean;
  currentSiteId?: number;

  // Tallas y Equipo (EPP)
  tallePantalon?: string;
  talleCamisa?: string;
  talleChaqueta?: string;
  tallePolar?: string;
  talleGeologo?: string;
  talleCalzado?: string;

  // Otros
  codigo?: string; // Código interno/empresa
  bancoInfo?: string;
  contactoFamiliar?: string;
  tempPasswordLog?: string; // Nuevo campo para auditoría de contraseña temporal
  fcmTokens?: string[]; // Para notificaciones push
}

export interface AttendanceLog {
  id: string;
  employeeId: string;
  employeeName: string;
  rut: string;
  timestamp: string;
  type: 'check_in' | 'check_out';
  locationLat?: number | null;
  locationLng?: number | null;
  siteId?: number | string | null;
  siteName: string;
  photoUrl?: string;
  isManual?: boolean;
  status?: 'active' | 'completed';
  startTime?: string | null;
  endTime?: string | null;
  createdBy?: string;
  systemNote?: string;
  shiftId?: string;
}

export interface Document {
  id: number;
  employeeId: string; // Cambiado a string
  type: 'Contrato' | 'OS10' | 'EPP' | 'Foto' | 'Otro';
  fileName: string;
  uploadDate: string;
}

export interface DigitalDocument {
  id: string;
  title: string;
  type: string;
  assignedTo: string;
  status: 'pending' | 'signed';
  originalUrl: string;
  signedUrl?: string;
  createdAt: string;
  signedAt?: string;
  metadata?: {
    ip?: string;
    rut?: string;
    browserInfo?: string;
  };
}


export interface ComparisonRecord {
  id: number;
  timestamp: string;
  periodo: string;
  data: {
    rut: string;
    name: string;
    inF30: boolean;
  }[];
}

export interface DailyPayment {
  id: string;
  workerName: string;
  workerId?: string;
  amount: number;
  siteId: number | string; // Supporting both for flexibility, though Site uses number
  siteName: string;
  description: string;
  status: 'PENDING' | 'PAID';
  createdAt: string;
  paidAt?: string;
  paidBy?: string; // Admin who marked as paid
  monthPeriod: string; // YYYY-MM format to group reports
  shiftDate?: string; // Fecha del turno (YYYY-MM-DD)
  paymentDate?: string; // Fecha del pago (YYYY-MM-DD)
  isNightShift?: boolean; // Turno nocturno
  createdBy?: string;
  createdByName?: string;
}

export interface AppNotification {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning' | 'coming-soon';
}

export interface AppConfirmation {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

export interface ContractRecord {
  id: number;
  timestamp: string;
  workerName: string;
  siteName: string;
  downloadUrl: string;
}

export interface Advance {
  id: string;
  workerId: string;
  workerName: string;
  amount: number;
  siteId: number | string;
  siteName: string;
  status: 'PENDING' | 'PAID';
  createdAt: string;
  createdBy: string; // UID
  createdByName: string; // Nombre del responsable
  paymentDate: string; // Siempre el 15 del mes
  monthPeriod: string; // YYYY-MM
}

export interface ChecklistItem {
  id: string;
  question: string;
  type: 'binary' | 'text' | 'photo'; // Sí/No, Comentario, Foto
  value?: any;
}

export interface SupervisorTask {
  id: string;
  supervisorId: string;
  supervisorName: string;
  siteId: string | number;
  siteName: string;
  checklistType: string;
  items: ChecklistItem[];
  status: 'PENDING' | 'COMPLETED';
  createdAt: string;
  completedAt?: string;
  observations?: string;
  createdBy: string;
}

export interface ChecklistTemplate {
  id: string;
  title: string;
  items: Omit<ChecklistItem, 'value'>[];
  createdAt: string;
}

export interface ResignationRequest {
  id: string;
  workerId: string;
  workerName: string;
  resignationDate: string; // Fecha en que el trabajador presenta su renuncia
  effectiveDate: string; // Fecha motivo
  reason: string;
  observations?: string;
  attachments?: string[]; // URLs o String Base64
  status: 'NEW' | 'REQUESTED_TO_ACCOUNTANT' | 'ENTERED_TO_DT' | 'REJECTED_BY_DT';
  createdAt: string;
  supervisorId: string;
  supervisorName: string;
}

export interface RecurringSupervisorTask {
  id: string;
  supervisorId: string;
  supervisorName: string;
  siteId: string | number;
  siteName: string;
  checklistType: string; // Template title
  frequency: 'DIARIO' | 'SEMANAL' | 'MENSUAL';
  active: boolean;
  createdAt: string;
  lastGeneratedAt?: string;
}

export interface SupervisorSubTask {
  id: string;
  supervisorId: string;
  supervisorName: string;
  title: string;
  description?: string;
  status: 'DONE' | 'NOT_DONE';
  createdAt: string;
  dueDate?: string;
}

export interface BoardNote {
  id: string;
  title: string;
  content: string;
  checklist: { id: string; text: string; completed: boolean }[];
  color?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByName: string;
}

export interface RoundEvidence {
  timestamp: string;
  lat: number;
  lng: number;
  photoUrl: string;
}

export interface GuardRound {
  id: string;
  workerId: string;
  workerName: string;
  siteId: string | number;
  siteName: string;
  startTime: string;
  endTime?: string;
  startLocation: { lat: number; lng: number; accuracy?: number };
  endLocation?: { lat: number; lng: number; accuracy?: number };
  status: 'IN_PROGRESS' | 'COMPLETED';
  path?: { lat: number; lng: number; timestamp: string; accuracy?: number }[];
  evidences?: RoundEvidence[];
  result?: 'SIN_NOVEDAD' | 'CON_NOVEDAD' | 'SOSPECHA';
}

export interface LoanInstallment {
  month: string; // YYYY-MM
  amount: number;
  isPaid: boolean;
  paidAt?: string;
}

export interface Loan {
  id: string;
  workerId: string;
  workerName: string;
  workerRut: string;
  amount: number;
  installmentsCount: number;
  firstPaymentDate: string; // ISO date string (YYYY-MM-DD)
  status: 'PENDING' | 'PAID' | 'PARTIAL';
  installments: LoanInstallment[];
  pdfUrl?: string;
  createdAt: string;
  createdBy: string;
}

export interface Reminder {
  id: string;
  text: string;
  dueDate: any; // Firestore Timestamp
  completed: boolean;
  userId: string;
  createdAt: any; // Firestore Timestamp
}

