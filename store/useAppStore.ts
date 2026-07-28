
import { SyncQueueService } from '../lib/SyncQueueService';
import { STORAGE_CACHE_METADATA } from '../lib/imageUtils';
import { Network } from '@capacitor/network';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { User, Employee, Site, AttendanceLog, Document, DigitalDocument, ComparisonRecord, DailyPayment, AppNotification, AppConfirmation, ContractRecord, Advance, SupervisorTask, ChecklistTemplate, ResignationRequest, RecurringSupervisorTask, SupervisorSubTask, BoardNote, GuardRound, Loan, Vacation, Novedad } from '../types';
import { Contrato } from '../types/phase1';
import { db, auth, secondaryAuth, storage, functions } from '../lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL, uploadString } from 'firebase/storage';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword
} from 'firebase/auth';
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  setDoc,
  writeBatch,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
  QuerySnapshot,
  DocumentData,
  arrayUnion
} from 'firebase/firestore';

interface AppState {
  currentUser: User | null;
  employees: Employee[];
  sites: Site[];
  attendanceLogs: AttendanceLog[];
  documents: Document[];
  f30History: ComparisonRecord[];
  contractHistory: ContractRecord[];
  contratos: Contrato[]; // Fase 3
  dailyPayments: DailyPayment[]; // NEW
  advances: Advance[];
  notifications: AppNotification[];
  confirmation: AppConfirmation | null;
  isLoading: boolean;
  lastFetchTimestamp: number | null;
  authInitialized: boolean;
  supervisorTasks: SupervisorTask[];
  checklistTemplates: ChecklistTemplate[];
  resignationRequests: ResignationRequest[];
  recurringSupervisorTasks: RecurringSupervisorTask[];
  supervisorSubTasks: SupervisorSubTask[];
  boardNotes: BoardNote[];
  loans: Loan[];
  digitalDocuments: DigitalDocument[];
  vacations: Vacation[];
  novedades: Novedad[];
  preselectedEmployeeForDoc: string | null;
  setPreselectedEmployeeForDoc: (id: string | null) => void;
  // Auth Actions
  login: (email: string, pass: string) => Promise<void>;
  logout: () => void;
  initializeAuthListener: () => void; // Para persistencia de sesión

  // Data Actions
  fetchInitialData: (force?: boolean) => Promise<void>;
  toggleEmployeeStatus: (id: string) => Promise<void>;
  updateEmployee: (id: string, data: Partial<Employee>) => Promise<void>;
  deleteEmployee: (id: string) => Promise<void>;

  // Special Action: Create User + Employee Doc
  addEmployee: (employeeData: Omit<Employee, 'id'>, password: string) => Promise<void>;

  addAttendanceLog: (log: Omit<AttendanceLog, 'id' | 'timestamp'>) => Promise<void>;
  getEmployeeByUserId: (uid: string) => Employee | undefined;
  uploadDocument: (doc: Omit<Document, 'id' | 'uploadDate'>) => Promise<void>;

  bulkAddEmployees: (employees: any[]) => Promise<void>; // Actualizado tipo
  saveF30Comparison: (record: Omit<ComparisonRecord, 'id' | 'timestamp'>) => void;
  saveContractRecord: (record: Omit<ContractRecord, 'id' | 'timestamp'>) => Promise<void>;
  fetchContractHistory: () => Promise<void>;
  fetchContratos: (filtros?: { colaboradorId?: string; estado?: string; limit?: number }) => Promise<void>;
  createContrato: (contrato: Omit<Contrato, 'id'>) => Promise<string>;

  // Site Actions
  addSite: (site: Omit<Site, 'id'>) => Promise<void>;
  updateSite: (id: number, site: Partial<Site>) => Promise<void>;
  deleteSite: (id: number) => Promise<void>;
  bulkAddSites: (sites: Omit<Site, 'id'>[]) => Promise<void>;
  toggleSiteStatus: (id: number) => Promise<void>;

  // Daily Payments Actions
  fetchDailyPayments: () => Promise<void>;
  addDailyPayment: (payment: Omit<DailyPayment, 'id' | 'createdAt' | 'status'>) => Promise<void>;
  updateDailyPayment: (id: string, data: Partial<DailyPayment>) => Promise<void>;
  markPaymentAsPaid: (id: string, paidBy: string) => Promise<void>;
  deleteDailyPayment: (id: string) => Promise<void>;
  bulkMarkAsPaid: (ids: string[], paidBy: string) => Promise<void>;

  bulkMarkAdvancesAsPaid: (ids: string[]) => Promise<void>;

  fetchAdvances: () => Promise<void>;
  addAdvances: (advancesArr: Omit<Advance, 'id' | 'createdAt' | 'status'>[]) => Promise<void>;
  deleteAdvance: (id: string) => Promise<void>;
  markAdvanceAsPaid: (id: string) => Promise<void>;

  // UI Actions
  showNotification: (message: string, type: AppNotification['type']) => void;
  hideNotification: (id: string) => void;
  showConfirmation: (config: AppConfirmation) => void;
  hideConfirmation: () => void;
  uploadFile: (file: File | Blob, path: string) => Promise<string>;

  // Notification Push Actions
  registerFCMToken: (employeeId: string, token: string) => Promise<void>;

  // Supervisor Management Actions
  fetchSupervisorTasks: () => Promise<void>;
  addSupervisorTask: (task: Omit<SupervisorTask, 'id' | 'createdAt' | 'status'>) => Promise<void>;
  updateSupervisorTask: (id: string, data: Partial<SupervisorTask>) => Promise<void>;
  deleteSupervisorTask: (id: string) => Promise<void>;

  // Checklist Template Actions
  fetchChecklistTemplates: () => Promise<void>;
  addChecklistTemplate: (template: Omit<ChecklistTemplate, 'id' | 'createdAt'>) => Promise<void>;
  deleteChecklistTemplate: (id: string) => Promise<void>;

  // Resignation Actions
  fetchResignationRequests: () => Promise<void>;
  addResignationRequest: (request: Omit<ResignationRequest, 'id' | 'createdAt' | 'status'>) => Promise<void>;
  updateResignationRequestStatus: (id: string, status: ResignationRequest['status']) => Promise<void>;
  deleteResignationRequest: (id: string) => Promise<void>;

  fetchRecurringTasks: () => Promise<void>;
  fetchSubTasks: () => Promise<void>;

  // Recurring Tasks Actions
  addRecurringTask: (task: Omit<RecurringSupervisorTask, 'id' | 'createdAt' | 'lastGeneratedAt'>) => Promise<void>;
  deleteRecurringTask: (id: string) => Promise<void>;
  toggleRecurringTask: (id: string, active: boolean) => Promise<void>;

  // SubTasks Actions
  addSupervisorSubTask: (task: Omit<SupervisorSubTask, 'id' | 'createdAt'>) => Promise<void>;
  updateSupervisorSubTask: (id: string, status: SupervisorSubTask['status']) => Promise<void>;
  deleteSupervisorSubTask: (id: string) => Promise<void>;

  // Board Note Actions
  fetchBoardNotes: () => Promise<void>;
  addBoardNote: (note: Omit<BoardNote, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateBoardNote: (id: string, data: Partial<BoardNote>) => Promise<void>;
  deleteBoardNote: (id: string) => Promise<void>;

  fetchAttendanceLogs: () => Promise<void>;
  uploadAttendancePhoto: (file: Blob, filename: string) => Promise<string>;
  forceCloseAttendance: (logId: string, endTimestamp: string, note?: string, closureType?: 'cierre forzado' | 'cierre por Admin') => Promise<void>;
  checkAndCloseStaleShifts: () => Promise<void>;

  // Round Actions
  guardRounds: GuardRound[];
  fetchGuardRounds: () => Promise<void>;
  addGuardRound: (round: Omit<GuardRound, 'id' | 'startTime' | 'status'>) => Promise<string>;
  updateGuardRound: (id: string, data: Partial<GuardRound>) => Promise<void>;
  isSyncing: boolean;
  processSyncQueue: () => Promise<void>;

  // Loan Actions
  fetchLoans: () => Promise<void>;
  addLoan: (loan: Omit<Loan, 'id' | 'createdAt' | 'status'>) => Promise<void>;
  updateLoan: (id: string, data: Partial<Loan>) => Promise<void>;
  deleteLoan: (id: string) => Promise<void>;
  uploadLoanPdf: (file: File, filename: string) => Promise<string>;
  uploadBase64: (base64String: string, path: string) => Promise<string>;
  // Digital Document Actions
  fetchDigitalDocuments: () => Promise<void>;
  addDigitalDocument: (doc: Omit<DigitalDocument, 'id' | 'createdAt' | 'status'>) => Promise<void>;
  signDigitalDocument: (id: string, signedUrl: string, metadata: DigitalDocument['metadata']) => Promise<void>;
  deleteDigitalDocument: (id: string) => Promise<void>;
  unsubDigitalDocuments: () => void;
  // Vacation Actions
  fetchVacations: () => Promise<void>;
  addVacation: (vacation: Omit<Vacation, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateVacationStatus: (id: string, newStatus: Vacation['status'], actorUid: string) => Promise<void>;
  // Novedades Actions
  fetchNovedades: (siteIds?: string[]) => Promise<void>;
  addNovedad: (novedad: Omit<Novedad, 'id' | 'createdAt'>) => Promise<string>;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      employees: [],
      sites: [],
      attendanceLogs: [],
      documents: [],

      f30History: [],
      contractHistory: [],
      contratos: [],
      dailyPayments: [],
      advances: [],
      supervisorTasks: [],
      checklistTemplates: [],
      resignationRequests: [],
      recurringSupervisorTasks: [],
      supervisorSubTasks: [],
      boardNotes: [],
      guardRounds: [],
      loans: [],
      digitalDocuments: [],
      vacations: [],
      novedades: [],
      notifications: [],
      preselectedEmployeeForDoc: null,
      setPreselectedEmployeeForDoc: (id) => set({ preselectedEmployeeForDoc: id }),

      confirmation: null,
      isLoading: false,
      lastFetchTimestamp: null,
      authInitialized: false,
      isSyncing: false,
      unsubDigitalDocuments: () => { },

      processSyncQueue: async () => {
        const { isSyncing } = get();
        if (isSyncing) return;

        const status = await Network.getStatus();
        if (!status.connected) return;

        set({ isSyncing: true });

        try {
          const pending = await SyncQueueService.getPending();
          console.log(`[SyncQueue] Procesando ${pending.length} elementos pendientes...`);

          for (const item of pending) {
            try {
              if (item.actionType === 'ADD_ROUND') {
                // La ronda base debe sincronizarse antes que sus actualizaciones.
                // Si falla, hacemos break para mantener el orden cronológico.
                await setDoc(doc(db, "Rondas", item.payload.id), item.payload);
                await SyncQueueService.markCompleted(item.id);
                console.log(`[SyncQueue] ADD_ROUND ${item.payload.id} sincronizado.`);

              } else if (item.actionType === 'UPDATE_ROUND') {
                await updateDoc(doc(db, "Rondas", item.payload.id), item.payload.data);
                await SyncQueueService.markCompleted(item.id);
                console.log(`[SyncQueue] UPDATE_ROUND ${item.payload.id} sincronizado.`);

              } else if (item.actionType === 'UPLOAD_EVIDENCE') {
                const { roundId, photoBase64, lat, lng, timestamp } = item.payload;

                // Validar que el dato base64 llegó intacto desde localforage
                if (!photoBase64 || typeof photoBase64 !== 'string' || photoBase64.length < 100) {
                  console.error(`[SyncQueue] UPLOAD_EVIDENCE ${item.id}: payload base64 corrupto o vacío. Descartando.`, { len: photoBase64?.length });
                  await SyncQueueService.markCompleted(item.id); // Descartar elemento corrupto
                  continue;
                }

                console.log(`[SyncQueue] Subiendo foto para ronda ${roundId}, base64 len: ${photoBase64.length}`);
                // Detectar extensión del formato (WebP o JPEG fallback)
                const isWebP = photoBase64.startsWith('data:image/webp');
                const ext = isWebP ? 'webp' : 'jpg';
                const fileName = `evidencias/${get().currentUser?.uid || 'offline'}/${roundId}/foto_${Date.now()}.${ext}`;
                const downloadUrl = await get().uploadBase64(photoBase64, fileName);

                await updateDoc(doc(db, "Rondas", roundId), {
                  evidences: arrayUnion({ photoUrl: downloadUrl, lat, lng, timestamp })
                });
                await SyncQueueService.markCompleted(item.id);
                console.log(`[SyncQueue] UPLOAD_EVIDENCE ${item.id} sincronizado. URL: ${downloadUrl}`);
              }

            } catch (err: any) {
              console.error(`[SyncQueue] Error procesando item ${item.id} (${item.actionType}):`, err);
              await SyncQueueService.incrementRetry(item);

              // Solo detenemos el proceso para ADD_ROUND ya que los UPDATE/UPLOAD
              // son independientes y no deben bloquearse entre sí.
              if (item.actionType === 'ADD_ROUND') {
                break;
              }
              // Para UPDATE_ROUND y UPLOAD_EVIDENCE: continuar con los demás.
            }
          }
        } finally {
          set({ isSyncing: false });
        }
      },

      initializeAuthListener: () => {
        onAuthStateChanged(auth, async (firebaseUser) => {
          if (firebaseUser) {
            // Usuario logueado, intentamos obtener su rol desde la colección Colaboradores
            try {
              const docRef = doc(db, "Colaboradores", firebaseUser.uid);
              const docSnap = await getDoc(docRef);

              if (docSnap.exists()) {
                const empData = docSnap.data() as Employee;
                
                // IMPORTANTE: Limpiar forceLogout ANTES de setear currentUser
                // para evitar que el listener de WorkerAttendance dispare logout() inmediatamente
                if (empData.forceLogout === true) {
                  try {
                    await updateDoc(docRef, { forceLogout: false });
                    console.log("[AUTH] forceLogout limpiado antes de setear usuario");
                  } catch (e) {
                    console.error("[AUTH] Error limpiando forceLogout:", e);
                  }
                }
                
                set({
                  currentUser: {
                    uid: firebaseUser.uid,
                    email: firebaseUser.email,
                    role: empData.role || 'worker'
                  }
                });
              } else {
                // Ocurre la primera vez. Asumimos rol admin si no existe ficha pero entró.
                // (Idealmente se crea la ficha manualmente en la consola de Firebase)
                set({ currentUser: { uid: firebaseUser.uid, email: firebaseUser.email, role: 'worker' } });
              }
              // Cargar datos iniciales para cualquier rol
              await get().fetchInitialData();
            } catch (e) {
              console.error("Error fetching user profile", e);
            } finally {
              set({ authInitialized: true });
            }
          } else {
            set({ currentUser: null, employees: [], authInitialized: true });
          }
        });
      },

      login: async (email, pass) => {
        set({ isLoading: true });
        try {
          const userCredential = await signInWithEmailAndPassword(auth, email, pass);
          const uid = userCredential.user.uid;
          
          // Limpiar flag de forceLogout si existe al iniciar sesión
          try {
            const docRef = doc(db, "Colaboradores", uid);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists() && docSnap.data().forceLogout) {
              await updateDoc(docRef, { forceLogout: false });
            }
          } catch (e) {
            console.error("Error clearing forceLogout flag:", e);
          }
          
          // El listener onAuthStateChanged manejará el resto del estado
        } catch (error: any) {
          console.error("Login error:", error);
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      logout: async () => {
        try {
          await signOut(auth);
          get().unsubDigitalDocuments();
          get().hideConfirmation();
          set({ currentUser: null, employees: [] });
        } catch (error) {
          console.error("Logout error:", error);
        }
      },

      fetchInitialData: async (force = false) => {
        const { currentUser, lastFetchTimestamp } = get();
        if (!currentUser) return;

        // Debounce: No hacer fetch si el último fue hace menos de 60 segundos
        // A menos que sea un "force" reload (ej: clic manual en botón Recargar)
        const now = Date.now();
        if (!force && lastFetchTimestamp && (now - lastFetchTimestamp < 60000)) {
          console.log("Fetch skipped: datos cacheados recientemente (<60s)");
          return;
        }

        set({ isLoading: true });
        try {
          // 1. Cargar Colaboradores (Admin: Todos, Worker: Solo él mismo)
          const empCol = collection(db, "Colaboradores");
          let loadedEmployees: Employee[] = [];

          if (currentUser.role === 'admin' || currentUser.role === 'supervisor') {
            const empSnapshot = await getDocs(empCol);
            empSnapshot.forEach((doc) => {
              loadedEmployees.push({ ...doc.data(), id: doc.id } as Employee);
            });
          } else {
            // Un Worker solo ve su propia ficha por eficiencia
            // Intentamos obtener el documento directo por UID
            const docRef = doc(db, "Colaboradores", currentUser.uid);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
              loadedEmployees.push({ ...docSnap.data(), id: docSnap.id } as Employee);
            } else {
              // Fallback: intentar por campo 'id' si el UID no es el nombre del doc
              const q = query(empCol, where("id", "==", currentUser.uid));
              const qSnapshot = await getDocs(q);
              qSnapshot.forEach((doc) => {
                loadedEmployees.push({ ...doc.data(), id: doc.id } as Employee);
              });
            }
          }

          // 2. Cargar Sucursales (Necesario para todos para saber donde marcan)
          const siteSnapshot = await getDocs(collection(db, "Sucursales"));
          const loadedSites: Site[] = [];
          siteSnapshot.forEach((doc) => {
            loadedSites.push(doc.data() as Site);
          });

          // 3. Cargar Tareas de Supervisores (Solo Admin/Supervisor)
          let loadedTasks: SupervisorTask[] = [];
          if (currentUser.role === 'admin' || currentUser.role === 'supervisor') {
            const taskSnapshot = await getDocs(collection(db, "SupervisorTasks"));
            taskSnapshot.forEach((doc) => {
              loadedTasks.push({ ...doc.data(), id: doc.id } as SupervisorTask);
            });
          }

          // 4. Cargar Plantillas (Solo Admin/Supervisor)
          let loadedTemplates: ChecklistTemplate[] = [];
          if (currentUser.role === 'admin' || currentUser.role === 'supervisor') {
            const templateSnapshot = await getDocs(collection(db, "ChecklistTemplates"));
            templateSnapshot.forEach((doc) => {
              loadedTemplates.push({ ...doc.data(), id: doc.id } as ChecklistTemplate);
            });
          }

          set({
            employees: loadedEmployees,
            sites: loadedSites,
            supervisorTasks: loadedTasks,
            checklistTemplates: loadedTemplates
          });

          // Llamadas "Smart" a otras colecciones - Esperar a que terminen para que los datos estén listos
          await Promise.all([
            get().fetchAttendanceLogs(),
            get().fetchGuardRounds(),
            get().fetchLoans(),
            get().fetchDigitalDocuments(),
            ...(currentUser.role === 'admin' || currentUser.role === 'supervisor' ? [
              get().fetchResignationRequests(),
              get().fetchRecurringTasks(),
              get().fetchSubTasks(),
              get().fetchBoardNotes(),
              get().fetchDailyPayments(),
              get().fetchAdvances(),
              get().fetchContractHistory()
            ] : []),
            ...(currentUser.role === 'admin' || currentUser.role === 'rrhh' ? [
              get().fetchVacations()
            ] : [])
          ]);
          
          set({ lastFetchTimestamp: Date.now() });

        } catch (error) {
          console.error("Error cargando datos:", error);
        } finally {
          set({ isLoading: false });
        }
      },

      addEmployee: async (employeeData, password) => {
        set({ isLoading: true });
        try {
          // 1. Crear usuario en Firebase Auth usando la instancia secundaria
          // Esto evita que se cierre la sesión del administrador actual
          const userCredential = await createUserWithEmailAndPassword(secondaryAuth, employeeData.email, password);
          const newUid = userCredential.user.uid;

          // 2. Preparar datos del empleado con el UID como ID
          const newEmployee: Employee = {
            ...employeeData,
            id: newUid,
            tempPasswordLog: password // Guardar la contraseña temporal ingresada
          };

          // 3. Guardar en Firestore usando el UID como ID del documento
          await setDoc(doc(db, "Colaboradores", newUid), newEmployee);

          // 4. Actualizar estado local
          set(state => ({ employees: [...state.employees, newEmployee] }));

          // 5. Opcional: Desconectar la sesión secundaria para limpiar
          await signOut(secondaryAuth);

          console.log("Empleado creado exitosamente con UID:", newUid);

        } catch (error: any) {
          console.error("Error creando empleado:", error);
          if (error.code === 'auth/email-already-in-use') {
            get().showNotification("El correo electrónico ya está registrado.", "warning");
          } else {
            get().showNotification("Error al crear el usuario: " + error.message, "error");
          }
        } finally {
          set({ isLoading: false });
        }
      },

      toggleEmployeeStatus: async (id) => {
        const emp = get().employees.find(e => e.id === id);
        if (!emp) return;
        const newStatus = !emp.isActive;

        set((state) => ({
          employees: state.employees.map(e => e.id === id ? { ...e, isActive: newStatus } : e)
        }));

        try {
          const docRef = doc(db, 'Colaboradores', id);
          await updateDoc(docRef, { isActive: newStatus });
        } catch (error) {
          console.error("Error updating status:", error);
        }
      },

      updateEmployee: async (id, data) => {
        try {
          const docRef = doc(db, 'Colaboradores', id);
          // @ts-ignore
          await updateDoc(docRef, data);

          set((state) => ({
            employees: state.employees.map(e => e.id === id ? { ...e, ...data } : e)
          }));
        } catch (error) {
          console.error("Error updating employee:", error);
          throw error;
        }
      },

      deleteEmployee: async (id) => {
        set((state) => ({ employees: state.employees.filter(e => e.id !== id) }));
        try {
          await deleteDoc(doc(db, 'Colaboradores', id));
          // Nota: El usuario de Auth sigue existiendo. Firebase Client SDK no permite borrar usuarios
          // fácilmente sin re-autenticación. En un entorno real, se usaría Cloud Functions.
        } catch (error) {
          console.error("Error deleting from DB:", error);
        }
      },

      addAttendanceLog: async (log) => {
        const id = "att_" + Date.now();
        const timestamp = (log as any).timestamp || new Date().toISOString();
        const newLogEntry: AttendanceLog = {
          ...log,
          id,
          timestamp,
        };

        // Sanitizar el objeto para eliminar campos con valor 'undefined'
        Object.keys(newLogEntry).forEach(key => {
          if (newLogEntry[key as keyof AttendanceLog] === undefined) {
            delete newLogEntry[key as keyof AttendanceLog];
          }
        });

        try {
          await setDoc(doc(db, 'Asistencia', id), newLogEntry);
          
          // SINCRONIZACIÓN CON GESTIÓN DE TURNOS
          
          // DETERMINAR FECHA DE LA JORNADA:
          // 1. Usar localDate explícita si viene (fecha local del cliente)
          // 2. Usar fecha del shiftId si existe (prog_site_emp_YYYY-MM-DD)
          // 3. Calcular fecha local como fallback (NO usar timestamp.split('T')[0] que es UTC)
          let jornadaDate = (log as any).localDate || '';
          
          // Si no hay localDate, calcular desde componentes locales de Date
          if (!jornadaDate) {
            const localNow = new Date();
            jornadaDate = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;
          }
          
          if (log.shiftId && typeof log.shiftId === 'string' && log.shiftId.includes('_')) {
            const parts = log.shiftId.split('_');
            const datePart = parts[parts.length - 1]; 
            if (datePart.match(/^\d{4}-\d{2}-\d{2}$/)) {
              jornadaDate = datePart;
            }
          }

          const siteId = log.siteId || 'sin_sucursal';
          const digId = `${siteId}_${log.employeeId}_${jornadaDate}`;

          console.log("[SYNC TURNOS] Tipo:", log.type, "| digId:", digId, "| jornadaDate:", jornadaDate, "| siteId:", siteId, "| shiftId:", log.shiftId);

          if (log.type === 'check_in') {
            try {
              await setDoc(doc(db, 'asistencia_digital', digId), {
                employeeId: log.employeeId,
                siteId: siteId,
                timestamp: Timestamp.fromDate(new Date()),
                isValidated: true,
                type: 'check_in',
                date: jornadaDate
              });
              console.log("[SYNC TURNOS] ✅ asistencia_digital creado con éxito:", digId);
            } catch (syncError) {
              console.error("[SYNC TURNOS] ❌ Error escribiendo asistencia_digital:", digId, syncError);
            }
          } else if (log.type === 'check_out') {
            try {
              // 1. Marcar el check_in previo como 'completed' para que desaparezca de Turnos en Vivo
              const qCheckIn = query(
                collection(db, "Asistencia"),
                where("employeeId", "==", log.employeeId),
                orderBy("timestamp", "desc"),
                limit(10)
              );
              const snapshotCheckIn = await getDocs(qCheckIn);
              const activeCheckIn = snapshotCheckIn.docs.find(d => d.data().type === 'check_in' && d.data().status !== 'completed');
              if (activeCheckIn) {
                try {
                  await updateDoc(doc(db, 'Asistencia', activeCheckIn.id), {
                    status: 'completed',
                    endTime: timestamp
                  });
                  console.log("[SYNC TURNOS] ✅ check_in previo marcado como completado:", activeCheckIn.id);
                } catch (updateErr) {
                  console.error("[SYNC TURNOS] ⚠️ Error actualizando check_in previo (puede ser falta de permisos):", updateErr);
                }
              }

              // 2. Eliminar pulso y marcar ticket en el día que corresponde a la jornada
              await deleteDoc(doc(db, 'asistencia_digital', digId));
              console.log("[SYNC TURNOS] ✅ asistencia_digital eliminado:", digId);
              
              const manualDocId = `manual_${log.employeeId}_${jornadaDate}`;
              await setDoc(doc(db, 'asistencia_manual', manualDocId), {
                employeeId: log.employeeId,
                date: jornadaDate,
                status: 'presente',
                type: 'digital_checkout',
                updatedAt: Timestamp.fromDate(new Date())
              }, { merge: true });
              console.log("[SYNC TURNOS] ✅ asistencia_manual creado con éxito:", manualDocId);
            } catch (syncError) {
              console.error("[SYNC TURNOS] ❌ Error en sincronización check_out:", digId, syncError);
            }
          }

          set((state) => ({ attendanceLogs: [newLogEntry, ...state.attendanceLogs] }));
        } catch (error) {
          console.error("Error saving attendance:", error);
          throw error;
        }
      },

      fetchAttendanceLogs: async () => {
        const { currentUser } = get();
        if (!currentUser) return;

        try {
          let q;
          if (currentUser.role === 'admin' || currentUser.role === 'supervisor') {
            // Admin: Últimos 200 logs globales
            q = query(collection(db, "Asistencia"), orderBy("timestamp", "desc"), limit(200));
          } else {
            // Worker: Solo sus propios logs, últimos 50
            q = query(
              collection(db, "Asistencia"),
              where("employeeId", "==", currentUser.uid),
              orderBy("timestamp", "desc"),
              limit(50)
            );
          }
          const snapshot = await getDocs(q);
          const logs: AttendanceLog[] = [];
          snapshot.forEach(doc => logs.push({ ...doc.data(), id: doc.id } as AttendanceLog));
          set({ attendanceLogs: logs });

          // Ejecutar limpieza de turnos antiguos (>24h) de manera asíncrona
          if (currentUser.role === 'admin' || currentUser.role === 'supervisor') {
            get().checkAndCloseStaleShifts();
          }
        } catch (error) { console.error("Error fetching attendance logs:", error); }
      },

      checkAndCloseStaleShifts: async () => {
        try {
          // OPTIMIZACIÓN: Solo buscar check_in no completados, limitado a 50
          // Antes: descargaba TODOS los check_in históricos sin límite
          const q = query(
            collection(db, "Asistencia"), 
            where("type", "==", "check_in"),
            where("status", "!=", "completed"),
            limit(50)
          );
          const snapshot = await getDocs(q);
          const now = new Date();
          const staleThreshold = 13 * 60 * 60 * 1000; // 13 horas (12h + 60m) en ms

          for (const docSnap of snapshot.docs) {
            const data = docSnap.data() as AttendanceLog;
            
            // Solo procesar si NO está completado
            if (data.status === 'completed') continue;

            const startTime = new Date(data.timestamp).getTime();
            
            if (now.getTime() - startTime > staleThreshold) {
              console.log(`Auto-cerrando turno stale para: ${data.employeeName || 'Usuario'}`);
              
              // 13 horas después del inicio como fin teórico (12h + 60m)
              const autoEndTime = new Date(startTime + staleThreshold).toISOString();
              
              await get().forceCloseAttendance(
                docSnap.id, 
                autoEndTime, 
                "Cierre automático: turno excedió 12 horas + 60 minutos de gracia",
                "cierre forzado"
              );
            }
          }
        } catch (e) {
          console.error("Error in checkAndCloseStaleShifts:", e);
        }
      },

      uploadAttendancePhoto: async (file, filename) => {
        const storageRef = ref(storage, `attendance/${filename}`);
        const metadata = {
          contentType: file.type || 'image/webp',
          ...STORAGE_CACHE_METADATA
        };
        await uploadBytes(storageRef, file, metadata);
        return await getDownloadURL(storageRef);
      },

      forceCloseAttendance: async (logId, endTimestamp, note, closureType) => {
        try {
          const forceCloseAttendanceValidated = httpsCallable(functions, 'forceCloseAttendanceValidated');
          const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
          
          await forceCloseAttendanceValidated({
            attendanceId: logId,
            requestId,
            note: note || ''
          });

          // Actualizar estado local (optimista/después del éxito)
          set(state => {
            const checkOutId = "att_out_" + Date.now(); // Aproximado para la UI, será sobreescrito en el próximo fetch real
            const originalLog = state.attendanceLogs.find(l => l.id === logId);
            const checkOutLog = originalLog ? {
              ...originalLog,
              id: checkOutId,
              type: 'check_out' as const,
              timestamp: endTimestamp,
              status: 'completed' as const,
            } : null;

            return {
              attendanceLogs: [
                ...(checkOutLog ? [checkOutLog] : []),
                ...state.attendanceLogs.map(log =>
                  log.id === logId ? { ...log, status: 'completed' as const, endTime: endTimestamp } : log
                )
              ]
            };
          });

        } catch (error: any) {
          console.error("Error force closing attendance:", error);
          throw new Error(error.message || "Error al forzar el cierre de asistencia.");
        }
      },



      getEmployeeByUserId: (uid) => get().employees.find(e => e.id === uid),

      uploadDocument: async (docData) => {
        const tempId = Date.now();
        const newDocEntry: Document = {
          id: tempId,
          employeeId: docData.employeeId,
          type: docData.type,
          fileName: docData.fileName,
          uploadDate: new Date().toISOString()
        };
        set((state) => ({ documents: [...state.documents, newDocEntry] }));
      },

      bulkAddEmployees: async (newEmployeesData) => {
        set({ isLoading: true });
        const batch = writeBatch(db);
        const { employees: existingEmployees } = get();

        const updatedEmployees = [...existingEmployees];
        let addedCount = 0;
        let updatedCount = 0;

        newEmployeesData.forEach((newData, idx) => {
          // Buscar si ya existe por RUT
          const existingIdx = updatedEmployees.findIndex(e => e.rut === newData.rut);

          if (existingIdx !== -1) {
            // ACTUALIZAR EXISTENTE
            const existingEmp = updatedEmployees[existingIdx];
            const updatedEmp = {
              ...existingEmp,
              // Campos solicitados específicamente para actualizar
              fechaInicioContrato: newData.fechaInicioContrato || existingEmp.fechaInicioContrato,
              fechaTerminoContrato: newData.fechaTerminoContrato || existingEmp.fechaTerminoContrato,
              fechaVencimientoOS10: newData.fechaVencimientoOS10 || existingEmp.fechaVencimientoOS10,
              codigo: newData.codigo || existingEmp.codigo,
              isActive: newData.isActive,
              // Opcional: actualizar otros campos si vienen en el excel y son relevantes
              cargo: newData.cargo || existingEmp.cargo,
              currentSiteId: newData.currentSiteId || existingEmp.currentSiteId,
            };

            updatedEmployees[existingIdx] = updatedEmp;
            const docRef = doc(db, 'Colaboradores', existingEmp.id);
            batch.update(docRef, {
              fechaInicioContrato: updatedEmp.fechaInicioContrato || null,
              fechaTerminoContrato: updatedEmp.fechaTerminoContrato || null,
              fechaVencimientoOS10: updatedEmp.fechaVencimientoOS10 || null,
              codigo: updatedEmp.codigo || null,
              isActive: updatedEmp.isActive,
              cargo: updatedEmp.cargo,
              currentSiteId: updatedEmp.currentSiteId || null
            });
            updatedCount++;
          } else {
            // AGREGAR NUEVO
            const tempId = "bulk-" + Date.now() + "-" + idx;
            const newEmp: Employee = {
              ...newData,
              id: tempId,
              role: 'worker',
              email: newData.email || `temp_${tempId}@ggss.cl`,
              isActive: newData.isActive
            };
            updatedEmployees.push(newEmp);
            const docRef = doc(db, 'Colaboradores', tempId);
            batch.set(docRef, newEmp);
            addedCount++;
          }
        });

        try {
          await batch.commit();
          set({ employees: updatedEmployees });
          get().showConfirmation({
            title: "Carga Masiva Completada",
            message: `Carga completada:\n- ${addedCount} nuevos colaboradores agregados.\n- ${updatedCount} colaboradores existentes actualizados.`,
            type: 'alert',
            onConfirm: () => {}
          });
        } catch (error) {
          console.error("Error bulk upsert:", error);
          get().showConfirmation({
            title: "Error",
            message: "Error en la carga masiva.",
            type: 'alert',
            onConfirm: () => {}
          });
        } finally {
          set({ isLoading: false });
        }
      },


      saveF30Comparison: (record) => {
        const newRecord = { ...record, id: Date.now(), timestamp: new Date().toISOString() };
        set(state => ({ f30History: [newRecord, ...state.f30History].slice(0, 12) }));
      },

      saveContractRecord: async (record) => {
        const id = "contract_" + Date.now();
        const newRecord: ContractRecord = { 
          ...record, 
          id, 
          timestamp: new Date().toISOString() 
        };
        try {
          await setDoc(doc(db, "HistoricoContratos", id), newRecord);
          set(state => ({ contractHistory: [newRecord, ...state.contractHistory].slice(0, 12) }));
        } catch (error) {
          console.error("Error saving contract record:", error);
        }
      },

      fetchContractHistory: async () => {
        try {
          const q = query(
            collection(db, "HistoricoContratos"), 
            orderBy("timestamp", "desc"), 
            limit(12)
          );
          const snapshot = await getDocs(q);
          const history: ContractRecord[] = [];
          snapshot.forEach(doc => {
            history.push({ ...doc.data(), id: doc.id } as ContractRecord);
          });
          set({ contractHistory: history });
        } catch (error) {
          console.error("Error fetching contract history:", error);
        }
      },

      createContrato: async (contratoData: Omit<Contrato, 'id'>) => {
        const id = `contrato_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const contrato: Contrato = { ...contratoData, id };
        try {
          await setDoc(doc(db, 'Contratos', id), contrato);
          // Actualizar estado local del store
          set(state => ({ contratos: [contrato, ...state.contratos] }));
          console.log('[createContrato] Contrato creado en Firestore:', id);
          return id;
        } catch (error) {
          console.error('[createContrato] Error al crear contrato operativo:', error);
          throw error;
        }
      },

      fetchContratos: async (filtros?: { colaboradorId?: string; estado?: string; limit?: number }) => {
        try {
          let q: any = collection(db, "Contratos");
          if (filtros?.colaboradorId) {
            q = query(q, where('colaboradorId', '==', filtros.colaboradorId));
          }
          if (filtros?.estado) {
            q = query(q, where('estado', '==', filtros.estado));
          }
          if (filtros?.limit) {
            q = query(q, limit(filtros.limit));
          }
          // Para RRHH, cargamos solo los contratos requeridos en el dashboard
          const snapshot = await getDocs(q);
          const contratos: Contrato[] = [];
          snapshot.forEach(doc => {
            contratos.push({ ...(doc.data() as any), id: doc.id } as Contrato);
          });
          set({ contratos });
        } catch (error) {
          console.error("Error fetching contratos:", error);
        }
      },

      // --- SITE ACTIONS (Igual que antes pero con v9) ---
      addSite: async (site) => {
        const tempId = Date.now();
        const newSite: Site = { id: tempId, ...site };
        set(state => ({ sites: [...state.sites, newSite] }));
        try {
          await setDoc(doc(db, 'Sucursales', String(tempId)), newSite);
        } catch (error) {
          console.error("Error adding site:", error);
        }
      },

      updateSite: async (id, siteData) => {
        set(state => ({
          sites: state.sites.map(s => s.id === id ? { ...s, ...siteData } : s)
        }));
        try {
          const docRef = doc(db, 'Sucursales', String(id));
          // @ts-ignore
          await updateDoc(docRef, siteData);
        } catch (error) {
          console.error("Error updating site:", error);
        }
      },

      deleteSite: async (id) => {
        set((state) => ({ sites: state.sites.filter(s => s.id !== id) }));
        try {
          await deleteDoc(doc(db, 'Sucursales', String(id)));
        } catch (error) {
          console.error("Error deleting site from DB:", error);
        }
      },

      bulkAddSites: async (newSites) => {
        set({ isLoading: true });
        const batch = writeBatch(db);
        const sitesToAdd: Site[] = [];

        newSites.forEach((s, idx) => {
          const tempId = Date.now() + idx;
          const site = { id: tempId, ...s };
          sitesToAdd.push(site);
          const docRef = doc(db, 'Sucursales', String(tempId));
          batch.set(docRef, site);
        });

        try {
          await batch.commit();
          set(state => ({ sites: [...state.sites, ...sitesToAdd] }));
        } catch (error) {
          console.error("Error bulk adding sites:", error);
        } finally {
          set({ isLoading: false });
        }
      },

      toggleSiteStatus: async (id) => {
        const site = get().sites.find(s => s.id === id);
        if (!site) return;
        const newStatus = !site.active;

        set((state) => ({
          sites: state.sites.map(s => s.id === id ? { ...s, active: newStatus } : s)
        }));

        try {
          const docRef = doc(db, 'Sucursales', String(id));
          await updateDoc(docRef, { active: newStatus });
        } catch (error) {
          console.error("Error updating site status:", error);
        }
      },

      // --- DAILY PAYMENTS ACTIONS ---
      fetchDailyPayments: async () => {
        set({ isLoading: true });
        try {
          // OPTIMIZACIÓN: Limitar a 200 registros más recientes
          const q = query(collection(db, "TurnosDiarios"), orderBy("createdAt", "desc"), limit(200));
          const snapshot = await getDocs(q);
          const payments: DailyPayment[] = [];
          snapshot.forEach(doc => {
            payments.push({ ...doc.data(), id: doc.id } as DailyPayment);
          });
          payments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

          set({ dailyPayments: payments });
        } catch (error) {
          console.error("Error fetching daily payments:", error);
        } finally {
          set({ isLoading: false });
        }
      },

      addDailyPayment: async (paymentData) => {
        set({ isLoading: true });
        try {
          const { currentUser } = get();
          const newPayment: DailyPayment = {
            id: "dp_" + Date.now(),
            status: 'PENDING',
            ...paymentData,
            createdAt: new Date().toISOString(),
            createdBy: currentUser?.uid || 'unknown',
            createdByName: currentUser?.email || 'Admin'
          };

          if (!newPayment.monthPeriod) {
            newPayment.monthPeriod = new Date().toISOString().slice(0, 7);
          }

          // Sanitizar para evitar errores de Firebase con 'undefined'
          Object.keys(newPayment).forEach(key => {
            if ((newPayment as any)[key] === undefined) {
              delete (newPayment as any)[key];
            }
          });

          const docRef = doc(db, "TurnosDiarios", newPayment.id);
          await setDoc(docRef, newPayment);

          set(state => ({ dailyPayments: [newPayment, ...state.dailyPayments] }));
        } catch (error) {
          console.error("Error adding daily payment:", error);
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      updateDailyPayment: async (id: string, data: Partial<DailyPayment>) => {
        set(state => ({
          dailyPayments: state.dailyPayments.map(p => p.id === id ? { ...p, ...data } : p)
        }));
        try {
          const docRef = doc(db, "TurnosDiarios", id);
          // @ts-ignore
          await updateDoc(docRef, data);
        } catch (error) {
          console.error("Error updating daily payment:", error);
        }
      },

      markPaymentAsPaid: async (id, paidBy) => {
        const paidAt = new Date().toISOString();
        set(state => ({
          dailyPayments: state.dailyPayments.map(p => p.id === id ? { ...p, status: 'PAID', paidAt, paidBy } : p)
        }));
        try {
          const docRef = doc(db, "TurnosDiarios", id);
          await updateDoc(docRef, { status: 'PAID', paidAt, paidBy });
        } catch (error) {
          console.error("Error marking payment as paid:", error);
        }
      },

      deleteDailyPayment: async (id) => {
        set(state => ({
          dailyPayments: state.dailyPayments.filter(p => p.id !== id)
        }));
        try {
          const docRef = doc(db, "TurnosDiarios", id);
          await deleteDoc(docRef);
        } catch (error) {
          console.error("Error deleting daily payment:", error);
        }
      },

      bulkMarkAsPaid: async (ids, paidBy) => {
        const paidAt = new Date().toISOString();
        const batch = writeBatch(db);

        set(state => ({
          dailyPayments: state.dailyPayments.map(p =>
            ids.includes(p.id) ? { ...p, status: 'PAID', paidAt, paidBy } : p
          )
        }));

        try {
          ids.forEach(id => {
            const docRef = doc(db, "TurnosDiarios", id);
            batch.update(docRef, { status: 'PAID', paidAt, paidBy });
          });
          await batch.commit();
        } catch (error) {
          console.error("Error in bulk marking as paid:", error);
          throw error;
        }
      },

      // --- ADVANCES ACTIONS ---
      fetchAdvances: async () => {
        set({ isLoading: true });
        try {
          // OPTIMIZACIÓN: Limitar a 200 registros más recientes
          const q = query(collection(db, "Anticipos"), orderBy("createdAt", "desc"), limit(200));
          const snapshot = await getDocs(q);
          const advances: Advance[] = [];
          snapshot.forEach(doc => {
            advances.push({ ...doc.data(), id: doc.id } as Advance);
          });
          advances.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          set({ advances });
        } catch (error) {
          console.error("Error fetching advances:", error);
        } finally {
          set({ isLoading: false });
        }
      },

      addAdvances: async (advancesArr: Omit<Advance, 'id' | 'createdAt' | 'status'>[]) => {
        set({ isLoading: true });
        const batch = writeBatch(db);
        const createdAt = new Date().toISOString();
        const newAdvances: Advance[] = [];

        advancesArr.forEach((adv: Omit<Advance, 'id' | 'createdAt' | 'status'>) => {
          const id = "adv_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
          const newAdv: Advance = {
            id,
            ...adv,
            status: 'PENDING',
            createdAt,
          };
          newAdvances.push(newAdv);

          // Sanitizar para evitar errores de Firebase con 'undefined'
          Object.keys(newAdv).forEach(key => {
            if ((newAdv as any)[key] === undefined) {
              delete (newAdv as any)[key];
            }
          });
          const docRef = doc(db, "Anticipos", id);
          batch.set(docRef, newAdv);
        });

        try {
          await batch.commit();
          set(state => ({ advances: [...newAdvances, ...state.advances] }));
        } catch (error) {
          console.error("Error adding advances:", error);
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      deleteAdvance: async (id: string) => {
        set(state => ({ advances: state.advances.filter(a => a.id !== id) }));
        try {
          await deleteDoc(doc(db, "Anticipos", id));
        } catch (error) {
          console.error("Error deleting advance:", error);
        }
      },

      markAdvanceAsPaid: async (id: string) => {
        set(state => ({
          advances: state.advances.map(a => a.id === id ? { ...a, status: 'PAID' } : a)
        }));
        try {
          const docRef = doc(db, "Anticipos", id);
          await updateDoc(docRef, { status: 'PAID' });
        } catch (error) {
          console.error("Error marking advance as paid:", error);
        }
      },

      bulkMarkAdvancesAsPaid: async (ids: string[]) => {
        const batch = writeBatch(db);
        set(state => ({
          advances: state.advances.map(a => ids.includes(a.id) ? { ...a, status: 'PAID' } : a)
        }));
        try {
          ids.forEach(id => {
            const docRef = doc(db, "Anticipos", id);
            batch.update(docRef, { status: 'PAID' });
          });
          await batch.commit();
        } catch (error) {
          console.error("Error bulk marking advances as paid:", error);
          throw error;
        }
      },

      // --- SUPERVISOR MANAGEMENT ACTIONS ---
      fetchSupervisorTasks: async () => {
        const { currentUser } = get();
        if (!currentUser) return;

        try {
          let q;
          if (currentUser.role === 'admin') {
            // Admins can see all tasks to manage them
            // OPTIMIZACIÓN: Limitar a 100 tareas para admin
            q = query(collection(db, "SupervisorTasks"), limit(100));
          } else {
            // Supervisors only see tasks assigned to them
            q = query(collection(db, "SupervisorTasks"), where("supervisorId", "==", currentUser.uid));
          }
          const snapshot = await getDocs(q);
          const tasks: SupervisorTask[] = [];
          snapshot.forEach(doc => tasks.push({ ...doc.data(), id: doc.id } as SupervisorTask));
          set({ supervisorTasks: tasks });
        } catch (error) { console.error("Error fetching supervisor tasks:", error); }
      },

      addSupervisorTask: async (task) => {
        const id = "task_" + Date.now();
        const newTask: SupervisorTask = {
          ...task,
          id,
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        };
        try {
          await setDoc(doc(db, "SupervisorTasks", id), newTask);
          set(state => ({ supervisorTasks: [newTask, ...state.supervisorTasks] }));
        } catch (error) { console.error(error); }
      },

      updateSupervisorTask: async (id, data) => {
        try {
          const docRef = doc(db, "SupervisorTasks", id);
          await updateDoc(docRef, data);
          set(state => ({
            supervisorTasks: state.supervisorTasks.map(t => t.id === id ? { ...t, ...data } : t)
          }));
        } catch (error) { console.error(error); }
      },

      deleteSupervisorTask: async (id) => {
        try {
          await deleteDoc(doc(db, "SupervisorTasks", id));
          set(state => ({
            supervisorTasks: state.supervisorTasks.filter(t => t.id !== id)
          }));
        } catch (error) { console.error(error); }
      },

      fetchChecklistTemplates: async () => {
        try {
          // OPTIMIZACIÓN: Limitar a 50 templates
          const snapshot = await getDocs(query(collection(db, "ChecklistTemplates"), limit(50)));
          const templates: ChecklistTemplate[] = [];
          snapshot.forEach(doc => templates.push({ ...doc.data(), id: doc.id } as ChecklistTemplate));
          set({ checklistTemplates: templates });
        } catch (error) { console.error(error); }
      },

      addChecklistTemplate: async (template) => {
        const id = "temp_" + Date.now();
        const newTemplate: ChecklistTemplate = {
          ...template,
          id,
          createdAt: new Date().toISOString(),
        };
        try {
          await setDoc(doc(db, "ChecklistTemplates", id), newTemplate);
          set(state => ({ checklistTemplates: [newTemplate, ...state.checklistTemplates] }));
        } catch (error) { console.error(error); }
      },

      deleteChecklistTemplate: async (id) => {
        try {
          await deleteDoc(doc(db, "ChecklistTemplates", id));
          set(state => ({
            checklistTemplates: state.checklistTemplates.filter(t => t.id !== id)
          }));
        } catch (error) { console.error(error); }
      },

      fetchResignationRequests: async () => {
        const { currentUser } = get();
        if (!currentUser) return;

        try {
          let q;
          if (currentUser.role === 'admin') {
            // OPTIMIZACIÓN: Limitar a 50 solicitudes para admin
            q = query(collection(db, "ResignationRequests"), orderBy("createdAt", "desc"), limit(50));
          } else {
            q = query(
              collection(db, "ResignationRequests"),
              where("supervisorId", "==", currentUser.uid),
              orderBy("createdAt", "desc")
            );
          }
          const snapshot = await getDocs(q);
          const requests: ResignationRequest[] = [];
          snapshot.forEach(doc => requests.push({ ...doc.data(), id: doc.id } as ResignationRequest));
          set({ resignationRequests: requests });
        } catch (error) { console.error("Error fetching resignation requests:", error); }
      },

      addResignationRequest: async (requestData) => {
        const id = "res_" + Date.now();
        const newRequest: ResignationRequest = {
          ...requestData,
          id,
          status: 'NEW',
          createdAt: new Date().toISOString(),
        };
        try {
          await setDoc(doc(db, "ResignationRequests", id), newRequest);
          set(state => ({ resignationRequests: [newRequest, ...state.resignationRequests] }));
        } catch (error) { console.error(error); }
      },

      updateResignationRequestStatus: async (id, status) => {
        try {
          const docRef = doc(db, "ResignationRequests", id);
          await updateDoc(docRef, { status });
          set(state => ({
            resignationRequests: state.resignationRequests.map(r => r.id === id ? { ...r, status } : r)
          }));
        } catch (error) { console.error(error); }
      },

      deleteResignationRequest: async (id) => {
        try {
          await deleteDoc(doc(db, "ResignationRequests", id));
          set(state => ({
            resignationRequests: state.resignationRequests.filter(r => r.id !== id)
          }));
        } catch (error) { console.error(error); }
      },

      fetchRecurringTasks: async () => {
        const { currentUser } = get();
        if (!currentUser) return;

        try {
          let q;
          if (currentUser.role === 'admin') {
            // OPTIMIZACIÓN: Limitar a 50 tareas recurrentes para admin
            q = query(collection(db, "RecurringSupervisorTasks"), limit(50));
          } else {
            q = query(collection(db, "RecurringSupervisorTasks"), where("supervisorId", "==", currentUser.uid));
          }
          const snapshot = await getDocs(q);
          const tasks: RecurringSupervisorTask[] = [];
          snapshot.forEach(doc => tasks.push({ ...doc.data(), id: doc.id } as RecurringSupervisorTask));
          set({ recurringSupervisorTasks: tasks });
        } catch (error) { console.error(error); }
      },

      fetchSubTasks: async () => {
        const { currentUser } = get();
        if (!currentUser) return;

        try {
          let q;
          if (currentUser.role === 'admin') {
            // OPTIMIZACIÓN: Limitar a 100 subtareas para admin
            q = query(collection(db, "SupervisorSubTasks"), limit(100));
          } else {
            q = query(collection(db, "SupervisorSubTasks"), where("supervisorId", "==", currentUser.uid));
          }
          const snapshot = await getDocs(q);
          const tasks: SupervisorSubTask[] = [];
          snapshot.forEach(doc => tasks.push({ ...doc.data(), id: doc.id } as SupervisorSubTask));
          set({ supervisorSubTasks: tasks });
        } catch (error) { console.error(error); }
      },

      addRecurringTask: async (taskData) => {
        const id = "rec_" + Date.now();
        const newTask: RecurringSupervisorTask = { ...taskData, id, createdAt: new Date().toISOString() };
        try {
          await setDoc(doc(db, "RecurringSupervisorTasks", id), newTask);
          set(state => ({ recurringSupervisorTasks: [newTask, ...state.recurringSupervisorTasks] }));
        } catch (error) { console.error(error); }
      },

      deleteRecurringTask: async (id) => {
        try {
          await deleteDoc(doc(db, "RecurringSupervisorTasks", id));
          set(state => ({ recurringSupervisorTasks: state.recurringSupervisorTasks.filter(t => t.id !== id) }));
        } catch (error) { console.error(error); }
      },

      toggleRecurringTask: async (id, active) => {
        try {
          await updateDoc(doc(db, "RecurringSupervisorTasks", id), { active });
          set(state => ({
            recurringSupervisorTasks: state.recurringSupervisorTasks.map(t => t.id === id ? { ...t, active } : t)
          }));
        } catch (error) { console.error(error); }
      },

      addSupervisorSubTask: async (taskData) => {
        const id = "sub_" + Date.now();
        const newTask: SupervisorSubTask = { ...taskData, id, createdAt: new Date().toISOString() };
        try {
          await setDoc(doc(db, "SupervisorSubTasks", id), newTask);
          set(state => ({ supervisorSubTasks: [newTask, ...state.supervisorSubTasks] }));
        } catch (error) { console.error(error); }
      },

      updateSupervisorSubTask: async (id, status) => {
        try {
          await updateDoc(doc(db, "SupervisorSubTasks", id), { status });
          set(state => ({
            supervisorSubTasks: state.supervisorSubTasks.map(t => t.id === id ? { ...t, status } : t)
          }));
        } catch (error) { console.error(error); }
      },

      deleteSupervisorSubTask: async (id) => {
        try {
          await deleteDoc(doc(db, "SupervisorSubTasks", id));
          set(state => ({ supervisorSubTasks: state.supervisorSubTasks.filter(t => t.id !== id) }));
        } catch (error) { console.error(error); }
      },

      // --- BOARD NOTE ACTIONS ---
      fetchBoardNotes: async () => {
        const { currentUser } = get();
        if (!currentUser) return;

        try {
          // Las notas son privadas para cada cuenta (Admin o Supervisor)
          // OPTIMIZACIÓN: Limitar a 50 notas
          const q = query(collection(db, "BoardNotes"), where("createdBy", "==", currentUser.uid), limit(50));
          const snapshot = await getDocs(q);
          const notes: BoardNote[] = [];
          snapshot.forEach(doc => notes.push({ ...doc.data(), id: doc.id } as BoardNote));
          notes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          set({ boardNotes: notes });
        } catch (error) { console.error("Error fetching board notes:", error); }
      },

      addBoardNote: async (noteData) => {
        const id = "note_" + Date.now();
        const now = new Date().toISOString();
        const newNote: BoardNote = {
          ...noteData,
          id,
          createdAt: now,
          updatedAt: now,
        };
        try {
          await setDoc(doc(db, "BoardNotes", id), newNote);
          set(state => ({ boardNotes: [newNote, ...state.boardNotes] }));
        } catch (error) { console.error("Error adding board note:", error); }
      },

      updateBoardNote: async (id, data) => {
        const now = new Date().toISOString();
        const updateData = { ...data, updatedAt: now };
        try {
          const docRef = doc(db, "BoardNotes", id);
          await updateDoc(docRef, updateData);
          set(state => ({
            boardNotes: state.boardNotes.map(n => n.id === id ? { ...n, ...updateData } : n)
          }));
        } catch (error) { console.error("Error updating board note:", error); }
      },

      deleteBoardNote: async (id) => {
        try {
          await deleteDoc(doc(db, "BoardNotes", id));
          set(state => ({ boardNotes: state.boardNotes.filter(n => n.id !== id) }));
        } catch (error) { console.error("Error deleting board note:", error); }
      },

      // --- UI ACTIONS ---
      showNotification: (message, type) => {
        const id = "notif_" + Date.now();
        set(state => ({
          notifications: [...state.notifications, { id, message, type }]
        }));
        setTimeout(() => {
          get().hideNotification(id);
        }, 4000);
      },

      hideNotification: (id) => {
        set(state => ({
          notifications: state.notifications.filter(n => n.id !== id)
        }));
      },

      showConfirmation: (config) => {
        set({ confirmation: config });
      },

      hideConfirmation: () => {
        set({ confirmation: null });
      },

      registerFCMToken: async (employeeId, token) => {
        try {
          const docRef = doc(db, "Colaboradores", employeeId);
          const docSnap = await getDoc(docRef);
          
          if (!docSnap.exists()) return;

          const empData = docSnap.data();
          const currentTokens = empData.fcmTokens || [];
          
          if (!currentTokens.includes(token)) {
            const updatedTokens = [...currentTokens, token];
            await updateDoc(docRef, { fcmTokens: updatedTokens });
            set(state => ({
              employees: state.employees.map(e => e.id === employeeId ? { ...e, fcmTokens: updatedTokens } : e)
            }));
          }

        } catch (error) { console.error("Error registering token:", error); }
      },

      fetchGuardRounds: async () => {
        const { currentUser } = get();
        if (!currentUser) return;

        try {
          let q;
          if (currentUser.role === 'admin' || currentUser.role === 'supervisor' || currentUser.role === 'mandante') {
            q = query(collection(db, "Rondas"), orderBy("startTime", "desc"), limit(200));
          } else {
            q = query(
              collection(db, "Rondas"),
              where("workerId", "==", currentUser.uid),
              orderBy("startTime", "desc"),
              limit(30)
            );
          }
          const snapshot = await getDocs(q);
          const rounds: GuardRound[] = [];
          snapshot.forEach(doc => rounds.push({ ...doc.data(), id: doc.id } as GuardRound));
          set({ guardRounds: rounds });
        } catch (error) { console.error("Error fetching rounds:", error); }
      },

      addGuardRound: async (roundData) => {
        console.log("addGuardRound: Intentando guardar ronda en Firestore...", roundData);
        if (!roundData.workerId || !roundData.siteId) {
          console.error("addGuardRound: Datos insuficientes", roundData);
          throw new Error("Datos de trabajador o sucursal faltantes.");
        }

        const id = "round_" + Date.now();
        const newRound: GuardRound = {
          ...roundData,
          id,
          startTime: new Date().toISOString(),
          status: 'IN_PROGRESS',
        };
        try {
          // Sanitización preventiva para evitar errores de 'undefined' en Firebase
          Object.keys(newRound).forEach(key => {
            if ((newRound as any)[key] === undefined) {
              delete (newRound as any)[key];
            }
          });

          // Offline-First: Siempre encolar
          await SyncQueueService.enqueue('ADD_ROUND', newRound);
          console.log("addGuardRound: Ronda guardada en cola local con ID:", id);
          
          set(state => ({ guardRounds: [newRound, ...state.guardRounds] }));
          
          // Intentar procesar la cola si hay red
          get().processSyncQueue();
          
          return id;
        } catch (error: any) {
          console.error("addGuardRound: Error crítico al guardar en Firestore:", error);
          throw error;
        }
      },
      updateGuardRound: async (id, data) => {
        try {
          // Sanitizar datos para evitar errores de Firebase con 'undefined'
          const cleanData = { ...data };
          Object.keys(cleanData).forEach(key => {
            if ((cleanData as any)[key] === undefined) {
              delete (cleanData as any)[key];
            }
          });

          // Offline-First: Siempre encolar
          await SyncQueueService.enqueue('UPDATE_ROUND', { id, data: cleanData });

          set(state => ({
            guardRounds: state.guardRounds.map(r => r.id === id ? { ...r, ...cleanData } : r)
          }));

          // Intentar procesar la cola
          get().processSyncQueue();
        } catch (error) { console.error("Error updating round:", error); }
      },

      // --- LOAN ACTIONS ---
      fetchLoans: async () => {
        const { currentUser } = get();
        if (!currentUser) return;

        try {
          let q;
          if (currentUser.role === 'admin' || currentUser.role === 'supervisor') {
            // OPTIMIZACIÓN: Limitar a 100 préstamos para admin
            q = query(collection(db, "Prestamos"), orderBy("createdAt", "desc"), limit(100));
          } else {
            q = query(
              collection(db, "Prestamos"),
              where("employeeId", "==", currentUser.uid),
              orderBy("createdAt", "desc")
            );
          }
          const snapshot = await getDocs(q);
          const loans: Loan[] = [];
          snapshot.forEach(doc => loans.push({ ...doc.data(), id: doc.id } as Loan));
          set({ loans });
        } catch (error) { console.error("Error fetching loans:", error); }
      },

      addLoan: async (loanData) => {
        const id = "loan_" + Date.now();
        const newLoan: Loan = {
          ...loanData,
          id,
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        };
        try {
          await setDoc(doc(db, "Prestamos", id), newLoan);
          set(state => ({ loans: [newLoan, ...state.loans] }));
        } catch (error) { console.error("Error adding loan:", error); }
      },

      updateLoan: async (id, data) => {
        try {
          const docRef = doc(db, "Prestamos", id);
          await updateDoc(docRef, data);
          set(state => ({
            loans: state.loans.map(l => l.id === id ? { ...l, ...data } : l)
          }));
        } catch (error) { console.error("Error updating loan:", error); }
      },

      deleteLoan: async (id) => {
        try {
          await deleteDoc(doc(db, "Prestamos", id));
          set(state => ({ loans: state.loans.filter(l => l.id !== id) }));
        } catch (error) { console.error("Error deleting loan:", error); }
      },

      uploadLoanPdf: async (file, filename) => {
        const storageRef = ref(storage, `loans/${filename}`);
        await uploadBytes(storageRef, file);
        return await getDownloadURL(storageRef);
      },

      uploadFile: async (file, path) => {
        try {
          console.log(`Zustand: Iniciando upload a ${path} (Type: ${file.type}, Size: ${file.size})...`);
          const storageRef = ref(storage, path);

          // Determinar contentType: priorizar file.type, pero usar extensión del path como respaldo
          // para evitar que Blobs sin tipo se suban como 'application/pdf'
          let contentType = file.type;
          if (!contentType || contentType === 'application/octet-stream') {
            const ext = path.split('.').pop()?.toLowerCase();
            if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
            else if (ext === 'png') contentType = 'image/png';
            else if (ext === 'gif') contentType = 'image/gif';
            else if (ext === 'webp') contentType = 'image/webp';
            else if (ext === 'pdf') contentType = 'application/pdf';
            else contentType = 'application/octet-stream';
          }

          const metadata = { contentType, ...STORAGE_CACHE_METADATA };
          console.log(`Zustand: contentType resuelto: ${contentType} | Cache: immutable`);

          const snapshot = await uploadBytes(storageRef, file, metadata);
          console.log("Zustand: Upload exitoso, obteniendo URL...");

          const url = await getDownloadURL(snapshot.ref);
          console.log(`Zustand: URL obtenida: ${url}`);
          return url;
        } catch (error: any) {
          console.error("Zustand: Error detallado en uploadFile:", error);
          if (error.code === 'storage/unauthorized') {
            throw new Error("Privilegios insuficientes para subir a Firebase Storage. Verifica las reglas de seguridad.");
          }
          throw new Error(`Error de Firebase Storage: ${error.message}`);
        }
      },

      uploadBase64: async (base64String, path) => {
        try {
          console.log(`Zustand: Iniciando uploadBase64 a ${path}...`);
          const storageRef = ref(storage, path);
          // Detectar contentType dinámicamente del data URL (soporta WebP, JPEG, PNG)
          let contentType = 'image/webp'; // Default optimizado
          const match = base64String.match(/^data:(image\/\w+);/);
          if (match) contentType = match[1];
          const metadata = { contentType, ...STORAGE_CACHE_METADATA };
          const snapshot = await uploadString(storageRef, base64String, 'data_url', metadata);
          const url = await getDownloadURL(snapshot.ref);
          return url;
        } catch (error: any) {
          console.error("Zustand: Error detallado en uploadBase64:", error);
          throw new Error(`Error de Firebase Storage: ${error.message}`);
        }
      },

      // --- DIGITAL DOCUMENTS ACTIONS ---
      fetchDigitalDocuments: async () => {
        const { currentUser, unsubDigitalDocuments } = get();
        if (!currentUser) return;

        // Limpiar suscripción previa si existe
        if (unsubDigitalDocuments) unsubDigitalDocuments();

        try {
          let q;
          if (currentUser.role === 'admin' || currentUser.role === 'supervisor') {
            // OPTIMIZACIÓN: Limitar a 100 documentos para admin
            q = query(collection(db, "documents"), orderBy("createdAt", "desc"), limit(100));
          } else {
            q = query(
              collection(db, "documents"),
              where("assignedTo", "==", currentUser.uid),
              orderBy("createdAt", "desc")
            );
          }

          const unsubscribe = onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
            const docs: DigitalDocument[] = [];
            snapshot.forEach((doc) => docs.push({ ...doc.data(), id: doc.id } as DigitalDocument));
            set({ digitalDocuments: docs });
          }, (error) => {
            console.error("Error in digital documents listener:", error);
          });

          set({ unsubDigitalDocuments: unsubscribe });
        } catch (error) {
          console.error("Error setting up digital documents listener:", error);
        }
      },

      addDigitalDocument: async (docData) => {
        const id = "digdoc_" + Date.now();
        const newDoc: DigitalDocument = {
          ...docData,
          id,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };
        try {
          await setDoc(doc(db, "documents", id), newDoc);
          // Ya no hacemos set manual porque onSnapshot se encarga
        } catch (error) { console.error("Error adding digital document:", error); }
      },

      signDigitalDocument: async (id, signedUrl, metadata) => {
        const signedAt = new Date().toISOString();
        const updateData = {
          status: 'signed' as const,
          signedUrl,
          signedAt,
          metadata
        };
        try {
          const docRef = doc(db, "documents", id);
          await updateDoc(docRef, updateData);
          // Ya no hacemos set manual porque onSnapshot se encarga
        } catch (error) { console.error("Error signing digital document:", error); }
      },

      deleteDigitalDocument: async (id) => {
        try {
          await deleteDoc(doc(db, "documents", id));
          // Ya no hacemos set manual porque onSnapshot se encarga
        } catch (error) { console.error("Error deleting digital document:", error); }
      },

      // --- VACATION ACTIONS ---
      fetchVacations: async () => {
        const { currentUser } = get();
        if (!currentUser) return;
        try {
          const q = query(collection(db, "Vacaciones"), orderBy("createdAt", "desc"));
          const snapshot = await getDocs(q);
          const vacs: Vacation[] = [];
          snapshot.forEach(doc => vacs.push({ ...doc.data(), id: doc.id } as Vacation));
          set({ vacations: vacs });
        } catch (error) {
          console.error("Error fetching vacations:", error);
        }
      },

      addVacation: async (vacationData) => {
        const id = "vac_" + Date.now();
        const newVacation: Vacation = {
          ...vacationData,
          id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        try {
          await setDoc(doc(db, "Vacaciones", id), newVacation);
          
          // Auditar creación
          await setDoc(doc(db, "AuditoriaAcciones", `aud_${Date.now()}_${Math.random().toString(36).substring(7)}`), {
            actionType: "VACATION_CREATED",
            vacationId: id,
            employeeId: vacationData.employeeId,
            newStatus: vacationData.status,
            actorUid: vacationData.createdBy,
            timestamp: new Date().toISOString()
          });

          set((state) => ({ vacations: [newVacation, ...state.vacations] }));
        } catch (error) {
          console.error("Error adding vacation:", error);
          throw error;
        }
      },

      updateVacationStatus: async (id, newStatus, actorUid) => {
        try {
          const docRef = doc(db, "Vacaciones", id);
          const vac = get().vacations.find(v => v.id === id);
          if (!vac) return;
          
          const oldStatus = vac.status;
          const updateData: Partial<Vacation> = { 
            status: newStatus,
            updatedAt: new Date().toISOString()
          };
          if (newStatus === 'approved') {
            updateData.approvedAt = new Date().toISOString();
            updateData.approvedBy = actorUid;
          }

          await updateDoc(docRef, updateData);

          // Auditar cambio
          await setDoc(doc(db, "AuditoriaAcciones", `aud_${Date.now()}_${Math.random().toString(36).substring(7)}`), {
            actionType: "VACATION_STATUS_CHANGE",
            vacationId: id,
            employeeId: vac.employeeId,
            oldStatus,
            newStatus,
            actorUid,
            timestamp: new Date().toISOString()
          });

          set((state) => ({
            vacations: state.vacations.map(v => v.id === id ? { ...v, ...updateData } : v)
          }));
        } catch (error) {
          console.error("Error updating vacation status:", error);
          throw error;
        }
      },

      // ── Novedades ─────────────────────────────────────────────────────────
      fetchNovedades: async (siteIds?: string[]) => {
        try {
          let q;
          if (siteIds && siteIds.length > 0) {
            q = query(
              collection(db, 'novedades'),
              orderBy('timestamp', 'desc'),
              limit(200)
            );
          } else {
            q = query(collection(db, 'novedades'), orderBy('timestamp', 'desc'), limit(200));
          }
          const snapshot = await getDocs(q);
          const novedades: Novedad[] = [];
          snapshot.forEach(d => novedades.push({ ...d.data(), id: d.id } as Novedad));
          // Filter client-side if siteIds provided
          const filtered = siteIds && siteIds.length > 0
            ? novedades.filter(n => siteIds.includes(String(n.siteId)))
            : novedades;
          set({ novedades: filtered });
        } catch (error) {
          console.error('Error fetching novedades:', error);
        }
      },

      addNovedad: async (novedadData) => {
        const id = `nov_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const now = new Date().toISOString();
        const newNovedad: Novedad = {
          ...novedadData,
          id,
          createdAt: now,
        };
        try {
          await setDoc(doc(db, 'novedades', id), newNovedad);
          set((state) => ({ novedades: [newNovedad, ...state.novedades] }));
          return id;
        } catch (error) {
          console.error('Error adding novedad:', error);
          throw error;
        }
      },

    }),

    {
      name: 'ggss-storage-v2',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        employees: state.employees,
        sites: state.sites,
        currentUser: state.currentUser,
        f30History: state.f30History,
        contractHistory: state.contractHistory,
      }),
    }
  )
);
