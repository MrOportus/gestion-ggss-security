import { db as defaultDb } from '../../lib/firebase';
import { doc, setDoc, deleteDoc, Firestore } from 'firebase/firestore';
import { AssignmentRepository } from '../phase1/repositories/assignmentRepository';
import { TurnoProgramado } from '../../types/phase1';

export class LegacyAdapter {
  private db: Firestore = defaultDb;
  private assignmentRepo = new AssignmentRepository(defaultDb);

  setDb(dbInstance: Firestore) {
    this.db = dbInstance;
    this.assignmentRepo = new AssignmentRepository(dbInstance);
  }

  /**
   * Procesa de fondo una escritura de turno exitosa en legacy y la adapta al nuevo modelo.
   */
  async adaptLegacySave(
    employeeId: string,
    siteId: string | number,
    dateStr: string, // YYYY-MM-DD
    status: 'programado' | 'noche' | 'descanso' | null,
    currentUserUid: string
  ) {
    try {
      const monthKey = dateStr.substring(0, 7); // YYYY-MM
      const siteStr = siteId.toString();

      // 1. Obtener o crear AsignacionOperacional
      const assignment = await this.assignmentRepo.getOrCreateAssignmentAtomically(
        employeeId,
        siteStr,
        monthKey,
        currentUserUid
      );

      const turnoId = `turno_${assignment.id}_${dateStr.replace(/-/g, '')}`;
      const turnoRef = doc(this.db, 'TurnosProgramados', turnoId);

      if (status === null) {
        // En lugar de eliminar físicamente (bloqueado por reglas), lo marcamos como cancelado.
        await setDoc(turnoRef, { 
          estado: 'cancelado', 
          modificadoEn: new Date().toISOString(), 
          modificadoPor: currentUserUid 
        }, { merge: true });
        return;
      }

      let codigo = 'X';
      if (status === 'noche') codigo = 'N';
      if (status === 'descanso') codigo = 'D';

      let inicio = '07:30';
      let termino = '19:30';
      let cruza = false;

      if (codigo === 'N') {
        inicio = '19:30';
        termino = '07:30';
        cruza = true;
      }

      const turnoSombra: TurnoProgramado = {
        id: turnoId,
        asignacionOperacionalId: assignment.id,
        colaboradorId: employeeId,
        sucursalId: siteStr,
        fecha: dateStr,
        codigo,
        horarioSnapshot: {
          inicio,
          termino,
          cruzaMedianoche: cruza,
          origen: 'fallback'
        },
        tipoOperacional: 'contractual', // Asumido por defecto en shadow mode
        estado: status === 'descanso' ? 'descanso' : 'programado',
        esProductivo: status !== 'descanso',
        requiereAsistencia: status !== 'descanso',
        estadoContrato: 'sin_contrato', // Simulado
        creadoEn: new Date().toISOString(),
        creadoPor: currentUserUid
      };

      await setDoc(turnoRef, turnoSombra);

    } catch (error) {
      console.warn('[SHADOW MODE] Error al adaptar guardado legacy', error);
      // No lanzamos el error para no interrumpir el flujo legacy del usuario
    }
  }
}

export const legacyAdapter = new LegacyAdapter();
