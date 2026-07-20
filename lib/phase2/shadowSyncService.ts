import { Firestore } from 'firebase/firestore';
import { app as defaultApp, db as defaultDb } from '../firebase';
import { getFunctions, httpsCallable, Functions } from 'firebase/functions';
import { FirebaseApp } from 'firebase/app';
import { legacyAdapter } from './legacyAdapter';

export interface ShadowSyncTask {
  id: string; // sync_{empId}_{siteId}_{dateStr}
  employeeId: string;
  siteId: string | number;
  dateStr: string;
  statusLegacy: 'programado' | 'noche' | 'descanso' | null;
  currentUserUid: string;
  syncStatus: 'pending' | 'processing' | 'success' | 'failed' | 'dead_letter' | 'cancelled';
  attempts: number;
  maxIntentos: number;
  nextRetryAt?: string;
  errorCode?: string;
  lastErrorMessageSanitized?: string;
  correlationId?: string;
  createdAt: string;
  updatedAt: string;
  processedAt?: string;
}

export class ShadowSyncService {
  private db: Firestore = defaultDb;
  private app: FirebaseApp = defaultApp;
  private functions?: Functions;

  setDb(dbInstance: Firestore) {
    this.db = dbInstance;
  }

  setApp(appInstance: FirebaseApp) {
    this.app = appInstance;
  }

  setFunctions(functionsInstance: Functions) {
    this.functions = functionsInstance;
  }

  /**
   * Encola una tarea de sincronización de manera controlada y lanza el procesamiento asíncrono.
   * No detiene el flujo legacy.
   */
  async enqueue(
    employeeId: string, 
    siteId: string | number, 
    dateStr: string, 
    statusLegacy: 'programado' | 'noche' | 'descanso' | null,
    currentUserUid: string,
    correlationId?: string
  ) {
    try {
      // 1. Invocar a la Cloud Function `enqueueShadowTask`
      const functionsInstance = this.functions || getFunctions(this.app);
      const enqueueCallable = httpsCallable(functionsInstance, 'enqueueShadowTask');

      await enqueueCallable({
        employeeId,
        siteId,
        dateStr,
        statusLegacy,
        correlationId
      });
      // El backend ahora es responsable de setear intentos y estado pending.
    } catch (e) {
      console.error('[ShadowSyncService] No se pudo encolar la tarea shadow', e);
    }
  }
}

export const shadowSyncService = new ShadowSyncService();
