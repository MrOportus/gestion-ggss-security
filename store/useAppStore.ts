
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { User, Employee, Site, AttendanceLog, Document, ComparisonRecord, DailyPayment } from '../types';
import { db, auth, secondaryAuth } from '../lib/firebase';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  setDoc,
  writeBatch,
  getDoc
} from 'firebase/firestore';

interface AppState {
  currentUser: User | null;
  employees: Employee[];
  sites: Site[];
  attendanceLogs: AttendanceLog[];
  documents: Document[];
  f30History: ComparisonRecord[];
  dailyPayments: DailyPayment[]; // NEW
  isLoading: boolean;

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
      dailyPayments: [],
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
                // Caso especial: Admin hardcodeado en Firebase pero sin ficha de empleado
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
        set({ isLoading: true });
        try {
          // 1. Cargar Colaboradores
          const empSnapshot = await getDocs(collection(db, "Colaboradores"));
          const loadedEmployees: Employee[] = [];
          empSnapshot.forEach((doc) => {
            // Aseguramos que el ID del objeto sea el ID del documento (UID)
            loadedEmployees.push({ ...doc.data(), id: doc.id } as Employee);
          });

          // 2. Cargar Sucursales
          const siteSnapshot = await getDocs(collection(db, "Sucursales"));
          const loadedSites: Site[] = [];
          siteSnapshot.forEach((doc) => {
            loadedSites.push(doc.data() as Site);
          });

          set({
            employees: loadedEmployees,
            sites: loadedSites
          });

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
            role: 'worker', // Por defecto todos son workers, salvo que se cambie en BD
            isActive: true
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
            alert("El correo electrónico ya está registrado.");
          } else {
            alert("Error al crear el usuario: " + error.message);
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
        set((state) => ({
          employees: state.employees.map(e => e.id === id ? { ...e, ...data } : e)
        }));

        try {
          const docRef = doc(db, 'Colaboradores', id);
          // @ts-ignore
          await updateDoc(docRef, data);
        } catch (error) {
          console.error("Error updating employee:", error);
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
        const tempId = Date.now();
        const newLogEntry: AttendanceLog = {
          id: tempId,
          employeeId: log.employeeId,
          timestamp: new Date().toISOString(),
          type: log.type,
          locationLat: log.locationLat,
          locationLng: log.locationLng,
          siteId: log.siteId
        };
        set((state) => ({ attendanceLogs: [newLogEntry, ...state.attendanceLogs] }));
        // Aquí deberías agregar la escritura a Firestore en una colección 'Asistencia' si lo deseas persistir
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

      bulkAddEmployees: async (newEmployees) => {
        // Implementación simplificada para bulk: 
        // IMPORTANTE: Bulk add desde excel NO creará cuentas de Auth automáticamente
        // porque requiere contraseñas.
        // En esta versión, solo guardaremos la data en Firestore con IDs generados,
        // pero estos usuarios NO podrán loguearse hasta que se les cree una cuenta Auth manual
        // o se implemente una función Cloud.

        set({ isLoading: true });
        const batch = writeBatch(db);

        const employeesToAdd: Employee[] = [];

        newEmployees.forEach((e, idx) => {
          // Generar un ID temporal (no sirve para login real, solo para gestión)
          const tempId = "bulk_" + Date.now() + "_" + idx;
          const newEmp: Employee = {
            ...e,
            id: tempId,
            role: 'worker',
            isActive: true,
            email: e.email || `temp_${tempId}@ggss.cl` // Email placeholder
          };
          employeesToAdd.push(newEmp);

          const docRef = doc(db, 'Colaboradores', tempId);
          batch.set(docRef, newEmp);
        });

        try {
          await batch.commit();
          set(state => ({ employees: [...state.employees, ...employeesToAdd] }));
          alert("Carga masiva completada. NOTA: Estos usuarios no tienen cuenta de acceso (password). Deben crearse manualmente o editarse.");
        } catch (error) {
          console.error("Error bulk add:", error);
          alert("Error en carga masiva.");
        } finally {
          set({ isLoading: false });
        }
      },

      saveF30Comparison: (record) => {
        const newRecord = { ...record, id: Date.now(), timestamp: new Date().toISOString() };
        set(state => ({ f30History: [newRecord, ...state.f30History].slice(0, 12) }));
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
          const newPayment: DailyPayment = {
            ...paymentData,
            id: "dp_" + Date.now(),
            status: 'PENDING',
            createdAt: new Date().toISOString(),
            monthPeriod: new Date().toISOString().slice(0, 7)
          };

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

      updateDailyPayment: async (id, data) => {
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
      }
    }),
    {
      name: 'ggss-storage-v2',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        employees: state.employees,
        sites: state.sites,
        currentUser: state.currentUser
      }),
    }
  )
);
