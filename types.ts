
export type Role = 'admin' | 'worker';

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
  salud?: string; // Fonasa, Isapre X
  afp?: string; // Modelo, Habitat, etc.

  // Datos Laborales
  sueldoLiquido?: number; // Nuevo campo
  fechaVencimientoOS10?: string; // ISO Date string
  fechaTerminoContrato?: string; // ISO Date string
  isActive: boolean;
  currentSiteId?: number;
}

export interface AttendanceLog {
  id: number;
  employeeId: string; // Cambiado a string para coincidir con UID
  timestamp: string;
  type: 'check_in' | 'check_out';
  locationLat?: number;
  locationLng?: number;
  siteId?: number;
}

export interface Document {
  id: number;
  employeeId: string; // Cambiado a string
  type: 'Contrato' | 'OS10' | 'EPP' | 'Foto' | 'Otro';
  fileName: string;
  uploadDate: string;
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
}
