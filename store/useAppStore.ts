
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { User, Employee, Site, AttendanceLog, Document, DigitalDocument, ComparisonRecord, DailyPayment, AppNotification, AppConfirmation, ContractRecord, Advance, SupervisorTask, ChecklistTemplate, ResignationRequest, RecurringSupervisorTask, SupervisorSubTask, BoardNote, GuardRound, Loan } from '../types';
import { db, auth, secondaryAuth, storage } from '../lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
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
  limit
} from 'firebase/firestore';

interface AppState {
  currentUser: User | null;
  employees: Employee[];
  sites: Site[];
  attendanceLogs: AttendanceLog[];
  documents: Document[];
  f30History: ComparisonRecord[];
  contractHistory: ContractRecord[];
  dailyPayments: DailyPayment[]; // NEW
  advances: Advance[];
  notifications: AppNotification[];
  confirmation: AppConfirmation | null;
  isLoading: boolean;
  supervisorTasks: SupervisorTask[];
  checklistTemplates: ChecklistTemplate[];
  resignationRequests: ResignationRequest[];
  recurringSupervisorTasks: RecurringSupervisorTask[];
  supervisorSubTasks: SupervisorSubTask[];
  boardNotes: BoardNote[];
  loans: Loan[];
  digitalDocuments: DigitalDocument[];
  // Auth Actions
  login: (email: string, pass: string) => Promise<void>;
  logout: () => void;
  initializeAuthListener: () => void; // Para persistencia de sesión

  // Data Actions
  fetchInitialData: () => Promise<void>;
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
  saveContractRecord: (record: Omit<ContractRecord, 'id' | 'timestamp'>) => void;

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
  forceCloseAttendance: (logId: string, endTimestamp: string, note?: string) => Promise<void>;

  // Round Actions
  guardRounds: GuardRound[];
  fetchGuardRounds: () => Promise<void>;
  addGuardRound: (round: Omit<GuardRound, 'id' | 'startTime' | 'status'>) => Promise<string>;
  updateGuardRound: (id: string, data: Partial<GuardRound>) => Promise<void>;

  // Loan Actions
  fetchLoans: () => Promise<void>;
  addLoan: (loan: Omit<Loan, 'id' | 'createdAt' | 'status'>) => Promise<void>;
  updateLoan: (id: string, data: Partial<Loan>) => Promise<void>;
  deleteLoan: (id: string) => Promise<void>;
  uploadLoanPdf: (file: File, filename: string) => Promise<string>;
  // Digital Document Actions
  fetchDigitalDocuments: () => Promise<void>;
  addDigitalDocument: (doc: Omit<DigitalDocument, 'id' | 'createdAt' | 'status'>) => Promise<void>;
  signDigitalDocument: (id: string, signedUrl: string, metadata: DigitalDocument['metadata']) => Promise<void>;
  deleteDigitalDocument: (id: string) => Promise<void>;

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
      notifications: [],


      confirmation: null,
      isLoading: false,

      initializeAuthListener: () => {
        onAuthStateChanged(auth, async (firebaseUser) => {
          if (firebaseUser) {
            // Usuario logueado, intentamos obtener su rol desde la colección Colaboradores
            try {
              const docRef = doc(db, "Colaboradores", firebaseUser.uid);
              const docSnap = await getDoc(docRef);

              if (docSnap.exists()) {
                const empData = docSnap.data() as Employee;
                set({
                  currentUser: {
                    uid: firebaseUser.uid,
                    email: firebaseUser.email,
                    role: empData.role || 'worker'
                  }
                });
                // Si es admin, cargar datos
                if (empData.role === 'admin') {
                  get().fetchInitialData();
                } else {
                  // Si es worker, cargar solo lo necesario o sus datos
                  // Por ahora cargamos todo para simplificar la vista WorkerAttendance que filtra localmente
                  get().fetchInitialData();
                }
              } else {
                // Ocurre la primera vez. Asumimos rol admin si no existe ficha pero entró.
                // (Idealmente se crea la ficha manualmente en la consola de Firebase)
                set({ currentUser: { uid: firebaseUser.uid, email: firebaseUser.email, role: 'worker' } });
              }
            } catch (e) {
              console.error("Error fetching user profile", e);
            }
          } else {
            set({ currentUser: null, employees: [] });
          }
        });
      },

      login: async (email, pass) => {
        set({ isLoading: true });
        try {
          await signInWithEmailAndPassword(auth, email, pass);
          // El listener onAuthStateChanged manejará el estado
        } catch (error: any) {
          console.error("Login error:", error);
          throw error; // Propagar error para mostrar en UI
        } finally {
          set({ isLoading: false });
        }
      },

      logout: async () => {
        try {
          await signOut(auth);
          set({ currentUser: null, employees: [] });
        } catch (error) {
          console.error("Logout error:", error);
        }
      },

      fetchInitialData: async () => {
        const { currentUser } = get();
        if (!currentUser) return;

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

          // Llamadas "Smart" a otras colecciones
          get().fetchAttendanceLogs();
          get().fetchGuardRounds();
          get().fetchLoans();
          get().fetchDigitalDocuments();

          if (currentUser.role === 'admin' || currentUser.role === 'supervisor') {
            get().fetchResignationRequests();
            get().fetchRecurringTasks();
            get().fetchSubTasks();
            get().fetchBoardNotes();
            get().fetchDailyPayments();
            get().fetchAdvances();
          }

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
        const newLogEntry: AttendanceLog = {
          ...log,
          id,
          timestamp: (log as any).timestamp || new Date().toISOString(),
        };

        // Sanitizar el objeto para eliminar campos con valor 'undefined', 
        // ya que Firebase v9+ lanza error si encuentra uno.
        Object.keys(newLogEntry).forEach(key => {
          if (newLogEntry[key as keyof AttendanceLog] === undefined) {
            delete newLogEntry[key as keyof AttendanceLog];
          }
        });

        try {
          await setDoc(doc(db, 'Asistencia', id), newLogEntry);
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
        } catch (error) { console.error("Error fetching attendance logs:", error); }
      },

      uploadAttendancePhoto: async (file, filename) => {
        const storageRef = ref(storage, `attendance/${filename}`);
        await uploadBytes(storageRef, file);
        return await getDownloadURL(storageRef);
      },

      forceCloseAttendance: async (logId, endTimestamp, note) => {
        try {
          const docRef = doc(db, 'Asistencia', logId);
          const updateData: Partial<AttendanceLog> = {
            status: 'completed',
            endTime: endTimestamp,
            type: 'check_out' // Mantener coherencia con sistema actual
          };
          if (note) updateData.systemNote = note;

          await updateDoc(docRef, updateData);

          set(state => ({
            attendanceLogs: state.attendanceLogs.map(log =>
              log.id === logId ? { ...log, ...updateData } : log
            )
          }));
        } catch (error) {
          console.error("Error force closing attendance:", error);
          throw error;
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
          alert(`Carga completada:\n- ${addedCount} nuevos colaboradores agregados.\n- ${updatedCount} colaboradores existentes actualizados.`);
        } catch (error) {
          console.error("Error bulk upsert:", error);
          alert("Error en la carga masiva.");
        } finally {
          set({ isLoading: false });
        }
      },


      saveF30Comparison: (record) => {
        const newRecord = { ...record, id: Date.now(), timestamp: new Date().toISOString() };
        set(state => ({ f30History: [newRecord, ...state.f30History].slice(0, 12) }));
      },

      saveContractRecord: (record) => {
        const newRecord = { ...record, id: Date.now(), timestamp: new Date().toISOString() };
        set(state => ({ contractHistory: [newRecord, ...state.contractHistory].slice(0, 15) }));
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
          const q = collection(db, "TurnosDiarios");
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
          const q = collection(db, "Anticipos");
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
        try {
          const snapshot = await getDocs(collection(db, "SupervisorTasks"));
          const tasks: SupervisorTask[] = [];
          snapshot.forEach(doc => tasks.push({ ...doc.data(), id: doc.id } as SupervisorTask));
          set({ supervisorTasks: tasks });
        } catch (error) { console.error(error); }
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
          const snapshot = await getDocs(collection(db, "ChecklistTemplates"));
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
        try {
          const snapshot = await getDocs(collection(db, "ResignationRequests"));
          const requests: ResignationRequest[] = [];
          snapshot.forEach(doc => requests.push({ ...doc.data(), id: doc.id } as ResignationRequest));
          requests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          set({ resignationRequests: requests });
        } catch (error) { console.error(error); }
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
        try {
          const snapshot = await getDocs(collection(db, "RecurringSupervisorTasks"));
          const tasks: RecurringSupervisorTask[] = [];
          snapshot.forEach(doc => tasks.push({ ...doc.data(), id: doc.id } as RecurringSupervisorTask));
          set({ recurringSupervisorTasks: tasks });
        } catch (error) { console.error(error); }
      },

      fetchSubTasks: async () => {
        try {
          const snapshot = await getDocs(collection(db, "SupervisorSubTasks"));
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
        try {
          const snapshot = await getDocs(collection(db, "BoardNotes"));
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
          const docRef = doc(db, "Employees", employeeId);
          const emp = get().employees.find(e => e.id === employeeId);
          if (!emp) return;

          const currentTokens = emp.fcmTokens || [];
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
          if (currentUser.role === 'admin' || currentUser.role === 'supervisor') {
            q = query(collection(db, "Rondas"), orderBy("startTime", "desc"), limit(100));
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

          await setDoc(doc(db, "Rondas", id), newRound);
          console.log("addGuardRound: Ronda guardada exitosamente con ID:", id);
          set(state => ({ guardRounds: [newRound, ...state.guardRounds] }));
          return id;
        } catch (error: any) {
          console.error("addGuardRound: Error crítico al guardar en Firestore:", error);
          throw error;
        }
      },

      updateGuardRound: async (id, data) => {
        try {
          const docRef = doc(db, "Rondas", id);
          await updateDoc(docRef, data);
          set(state => ({
            guardRounds: state.guardRounds.map(r => r.id === id ? { ...r, ...data } : r)
          }));
        } catch (error) { console.error("Error updating round:", error); }
      },

      // --- LOAN ACTIONS ---
      fetchLoans: async () => {
        const { currentUser } = get();
        if (!currentUser) return;

        try {
          let q;
          if (currentUser.role === 'admin' || currentUser.role === 'supervisor') {
            q = query(collection(db, "Prestamos"), orderBy("createdAt", "desc"));
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

          // Forzar contentType para evitar problemas de detección automática
          const metadata = {
            contentType: file instanceof File ? file.type : 'application/pdf'
          };

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

      // --- DIGITAL DOCUMENTS ACTIONS ---
      fetchDigitalDocuments: async () => {
        const { currentUser } = get();
        if (!currentUser) return;

        try {
          let q;
          if (currentUser.role === 'admin' || currentUser.role === 'supervisor') {
            q = query(collection(db, "documents"), orderBy("createdAt", "desc"));
          } else {
            q = query(
              collection(db, "documents"),
              where("assignedTo", "==", currentUser.uid),
              orderBy("createdAt", "desc")
            );
          }
          const snapshot = await getDocs(q);
          const docs: DigitalDocument[] = [];
          snapshot.forEach(doc => docs.push({ ...doc.data(), id: doc.id } as DigitalDocument));
          set({ digitalDocuments: docs });
        } catch (error) { console.error("Error fetching digital documents:", error); }
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
          set(state => ({ digitalDocuments: [newDoc, ...state.digitalDocuments] }));
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
          set(state => ({
            digitalDocuments: state.digitalDocuments.map(d => d.id === id ? { ...d, ...updateData } : d)
          }));
        } catch (error) { console.error("Error signing digital document:", error); }
      },

      deleteDigitalDocument: async (id) => {
        try {
          await deleteDoc(doc(db, "documents", id));
          set(state => ({ digitalDocuments: state.digitalDocuments.filter(d => d.id !== id) }));
        } catch (error) { console.error("Error deleting digital document:", error); }
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
