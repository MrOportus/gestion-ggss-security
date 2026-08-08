import { useState } from 'react';
import { db } from '../../lib/firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

type ShiftStatus = 'programado' | 'asistio_manual' | 'asistio_manual_completed' | 'ausente' | 'noche' | 'descanso' | 'trasladado' | null;

interface SaveChangesParams {
  pendingChanges: Record<string, ShiftStatus>;
  programmingMap: Record<string, any>;
  sites: any[];
  employees: any[];
  currentUser: any;
  previousTokens?: Record<string, string>;
  overrideConflicts?: boolean;
}

export interface SaveChangesResult {
  success: number;
  conflicts: any[];
  technicalErrors: any[];
  newTokens: Record<string, string>;
  failedColabIds: string[];
  conflictCheckPending: boolean;
}

export const useShiftManagementFacade = () => {
  const [isSaving, setIsSaving] = useState(false);

  const saveChanges = async ({
    pendingChanges,
    programmingMap,
    sites,
    employees,
    currentUser,
    previousTokens = {},
    overrideConflicts = false,
  }: SaveChangesParams): Promise<SaveChangesResult> => {
    setIsSaving(true);
    
    const result: SaveChangesResult = {
      success: 0,
      conflicts: [],
      technicalErrors: [],
      newTokens: { ...previousTokens },
      failedColabIds: [],
      conflictCheckPending: false
    };

    try {
      const batchPromises: Promise<any>[] = [];
      const callableChangesByColab: Record<string, any[]> = {};
      const functions = getFunctions();
      const saveProgramacionCallable = httpsCallable(functions, 'saveProgramacionValidated');

      for (const [key, status] of Object.entries(pendingChanges)) {
        const parts = key.split('_');
        const siteId = parts[0];
        const dateStr = parts[parts.length - 1];
        const empId = parts.slice(1, -1).join('_');
        
        const progDocId = `prog_${siteId}_${empId}_${dateStr}`;
        const manualDocId = `manual_${siteId}_${empId}_${dateStr}`;
        const manualRef = doc(db, 'asistencia_manual', manualDocId);

        const site = sites.find(s => s.id.toString() === siteId.toString());
        const emp = employees.find(e => e.id === empId);

        if (status === 'programado' || status === 'noche' || status === 'descanso' || status === null) {
          if (!callableChangesByColab[empId]) callableChangesByColab[empId] = [];
          
          let accion = status === null ? 'delete' : 'create';
          const cruzaMedianoche = status === 'noche';
          
          callableChangesByColab[empId].push({
            colaboradorId: empId,
            sucursalId: siteId,
            sucursalNombre: site?.name || "",
            fechaOperacional: dateStr,
            codigoTurno: status === 'noche' ? 'N' : (status === 'descanso' ? 'D' : 'X'),
            horarioSnapshot: status === 'descanso' || status === null ? null : {
              inicio: cruzaMedianoche ? '19:30' : '07:30',
              termino: cruzaMedianoche ? '07:30' : '19:30',
              cruzaMedianoche,
            },
            estado: status === null ? 'cancelado' : (status === 'noche' ? 'programado' : status),
            tipoOperacion: 'contractual',
            turnoIdExistente: progDocId,
            accion: accion
          });

          if (status === null) {
            batchPromises.push(deleteDoc(manualRef));
            batchPromises.push(deleteDoc(doc(db, 'Asistencia', `manual_att_check_in_${empId}_${dateStr}`)));
            batchPromises.push(deleteDoc(doc(db, 'Asistencia', `manual_att_check_out_${empId}_${dateStr}`)));
            batchPromises.push(deleteDoc(doc(db, 'asistencia_digital', `${siteId}_${empId}_${dateStr}`)));
          }

        } else if (status === 'asistio_manual' || status === 'asistio_manual_completed') {
          batchPromises.push(setDoc(manualRef, {
            siteId: siteId,
            employeeId: empId,
            date: dateStr,
            status: 'presente',
            editorId: currentUser?.uid || 'admin',
            updatedAt: new Date()
          }, { merge: true }));

          if (emp && site) {
            const type = status === 'asistio_manual_completed' ? 'check_out' : 'check_in';
            const attId = `manual_att_${type}_${empId}_${dateStr}`;
            const attRef = doc(db, 'Asistencia', attId);
            const progDoc = programmingMap[`${siteId}_${empId}_${dateStr}`] as any;
            const isNight = progDoc?.status === 'noche' || progDoc?.turno === 'N' || progDoc?.codigoTurno === 'N';
            const [year, month, dayNum] = dateStr.split('-').map(Number);

            let startH = 7, startM = 30, endH = 19, endM = 30;
            if (isNight) { startH = 19; startM = 30; endH = 7; endM = 30; }

            const startTimestamp = new Date(year, month - 1, dayNum, startH, startM).toISOString();
            let endTimestamp = new Date(year, month - 1, dayNum, endH, endM).toISOString();
            if (isNight) {
              const nextDay = new Date(year, month - 1, dayNum + 1, endH, endM);
              endTimestamp = nextDay.toISOString();
            }
            const isCompleted = status === 'asistio_manual_completed';

            batchPromises.push(setDoc(attRef, {
              employeeId: empId,
              employeeName: `${emp.firstName} ${emp.lastNamePaterno}`,
              rut: emp.rut,
              siteId: site.id,
              siteName: site.name,
              timestamp: isCompleted ? endTimestamp : startTimestamp,
              type: isCompleted ? 'check_out' : 'check_in',
              isManual: true,
              status: isCompleted ? 'completed' : 'active',
              startTime: startTimestamp,
              endTime: isCompleted ? endTimestamp : null,
              createdBy: currentUser?.uid || 'admin',
              systemNote: 'Registro manual desde Gestión de Turnos',
              shiftId: progDocId,
              detalle: 'REGISTRO MANUAL'
            }, { merge: true }));
          }
        } else if (status === 'ausente') {
          batchPromises.push(setDoc(manualRef, {
            siteId: siteId,
            employeeId: empId,
            date: dateStr,
            status: 'ausente',
            editorId: currentUser?.uid || 'admin',
            updatedAt: new Date()
          }, { merge: true }));
          batchPromises.push(deleteDoc(doc(db, 'Asistencia', `manual_att_check_in_${empId}_${dateStr}`)));
          batchPromises.push(deleteDoc(doc(db, 'Asistencia', `manual_att_check_out_${empId}_${dateStr}`)));
          batchPromises.push(deleteDoc(doc(db, 'asistencia_digital', `${siteId}_${empId}_${dateStr}`)));
        }
      }
      
      if (batchPromises.length > 0) {
        await Promise.allSettled(batchPromises);
      }
      
      const BATCH_SIZE = 10;
      const colabs = Object.keys(callableChangesByColab);
      
      for (let i = 0; i < colabs.length; i += BATCH_SIZE) {
        const batch = colabs.slice(i, i + BATCH_SIZE);
        
        const promises = batch.map(async (empId) => {
          const cambios = callableChangesByColab[empId];
          if (result.failedColabIds.includes(empId)) return;
          
          const operationRequestId = result.newTokens[empId] || `op_${empId}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          result.newTokens[empId] = operationRequestId;

          try {
            await saveProgramacionCallable({ 
              operationRequestId, 
              cambios
            });
            result.success++;
            result.conflictCheckPending = true; // conflictos verificados async en background
          } catch (err: any) {
            result.failedColabIds.push(empId);
            result.technicalErrors.push(`Error en colaborador ${empId}: ${err.message || 'Desconocido'}`);
          }
        });
        
        await Promise.allSettled(promises);
      }

    } catch (error: any) {
      console.error("Error catastrófico saving changes:", error);
      result.technicalErrors.push(error.message);
    } finally {
      setIsSaving(false);
    }

    return result;
  };

  return { saveChanges, isSaving };
};
