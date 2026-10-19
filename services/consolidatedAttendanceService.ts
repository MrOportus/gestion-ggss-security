import { functions } from '../lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { AttendanceSessionReadModel } from '../lib/phase5d2/queries/attendanceReadModels';
import { AttendanceLog } from '../types';

export interface ConsolidatedAttendanceQueryParams {
  sucursalId?: string | number | 'all';
  employeeId?: string;
  fromDate?: string;
  toDate?: string;
  jornadaDate?: string;
  status?: 'open' | 'completed';
  limit?: number;
}

export interface ConsolidatedAttendanceResponse {
  items: AttendanceSessionReadModel[];
  count: number;
  source: 'v2' | 'transitional';
}

export class ConsolidatedAttendanceService {
  /**
   * Consulta el backend callable getConsolidatedAttendance.
   * Si no está disponible (modo dev sin emulador de functions o error de red),
   * puede invocar consolidateLogsLocally como respaldo seguro.
   */
  static async fetchAttendance(
    params: ConsolidatedAttendanceQueryParams,
    fallbackLogs?: AttendanceLog[]
  ): Promise<ConsolidatedAttendanceResponse> {
    try {
      const getConsolidatedAttendance = httpsCallable<
        ConsolidatedAttendanceQueryParams,
        ConsolidatedAttendanceResponse
      >(functions, 'getConsolidatedAttendance');

      const result = await getConsolidatedAttendance(params);
      return result.data;
    } catch (error: any) {
      console.warn('[ConsolidatedAttendanceService] Backend callable unavailable or failed, falling back if logs available:', error?.message || error);
      if (fallbackLogs && fallbackLogs.length > 0) {
        const localItems = this.consolidateLogsLocally(fallbackLogs);
        // Filtrar según params
        let filtered = localItems;
        if (params.sucursalId && params.sucursalId !== 'all') {
          filtered = filtered.filter(item => String(item.sucursalId) === String(params.sucursalId));
        }
        if (params.employeeId) {
          filtered = filtered.filter(item => item.employeeId === params.employeeId);
        }
        if (params.fromDate) {
          filtered = filtered.filter(item => item.jornadaDate >= params.fromDate!);
        }
        if (params.toDate) {
          filtered = filtered.filter(item => item.jornadaDate <= params.toDate!);
        }
        if (params.jornadaDate) {
          filtered = filtered.filter(item => item.jornadaDate === params.jornadaDate);
        }
        if (params.status) {
          const expectedStatus = params.status === 'completed' ? 'closed' : 'open';
          filtered = filtered.filter(item => item.status === expectedStatus);
        }
        return {
          items: filtered,
          count: filtered.length,
          source: 'transitional'
        };
      }
      throw error;
    }
  }

  /**
   * Consolida marcaciones individuales en memoria siguiendo las mismas reglas
   * puras de negocio que el motor backend (1 fila por turno Buk-style).
   */
  static consolidateLogsLocally(logs: AttendanceLog[]): AttendanceSessionReadModel[] {
    if (!Array.isArray(logs) || logs.length === 0) return [];

    // 1. Filtrar registros con datos mínimos válidos
    const validLogs = logs.filter(l => l && l.employeeId && l.timestamp);

    // 2. Agrupar por employeeId
    const byEmployee = new Map<string, AttendanceLog[]>();
    for (const log of validLogs) {
      const empId = String(log.employeeId);
      if (!byEmployee.has(empId)) {
        byEmployee.set(empId, []);
      }
      byEmployee.get(empId)!.push(log);
    }

    const sessions: AttendanceSessionReadModel[] = [];

    // 3. Procesar cada trabajador
    for (const [, empLogs] of byEmployee.entries()) {
      const checkIns = empLogs
        .filter(l => l.type === 'check_in')
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      const checkOuts = empLogs
        .filter(l => l.type === 'check_out')
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      const usedCheckOutIds = new Set<string>();

      for (let i = 0; i < checkIns.length; i++) {
        const ci = checkIns[i];
        const nextCi = checkIns[i + 1];
        const ciTime = new Date(ci.timestamp).getTime();
        const nextCiTime = nextCi ? new Date(nextCi.timestamp).getTime() : Infinity;

        // Buscar Checkout correspondiente
        let matchedCo: AttendanceLog | null = null;
        let pairingMethod = 'none';

        // Prioridad A: Mismo shiftId explícito
        if (ci.shiftId) {
          const found = checkOuts.find(co => !usedCheckOutIds.has(co.id) && co.shiftId === ci.shiftId);
          if (found) {
            matchedCo = found;
            pairingMethod = 'explicit_shift_id';
          }
        }

        // Prioridad B: Match por id / endTime / horaSalidaReal
        if (!matchedCo) {
          const found = checkOuts.find(co => {
            if (usedCheckOutIds.has(co.id)) return false;
            const coTime = new Date(co.timestamp).getTime();
            if (ci.endTime && co.timestamp === ci.endTime) return true;
            if (ci.horaSalidaReal && co.timestamp === ci.horaSalidaReal) return true;
            return false;
          });
          if (found) {
            matchedCo = found;
            pairingMethod = 'matching_end_timestamp';
          }
        }

        // Prioridad C: Primer check_out posterior a ci y previo al siguiente ci
        if (!matchedCo) {
          const found = checkOuts.find(co => {
            if (usedCheckOutIds.has(co.id)) return false;
            const coTime = new Date(co.timestamp).getTime();
            return coTime >= ciTime && coTime < nextCiTime;
          });
          if (found) {
            matchedCo = found;
            pairingMethod = 'chronological_next';
          }
        }

        if (matchedCo) {
          usedCheckOutIds.add(matchedCo.id);
        }

        // Determinar clasificación del cierre
        let closureActor: 'worker' | 'scheduler' | 'admin' | 'new_entry' | 'system' | null = null;
        let closureType = 'ABIERTO';
        let closureOrigin = 'none';
        let isClosed = false;

        if (matchedCo) {
          isClosed = true;
          if (matchedCo.tipoCierre === 'AUTOMATICO') {
            closureActor = 'scheduler';
            closureType = 'AUTOMATICO';
            closureOrigin = 'scheduler_auto_checkout';
          } else if (matchedCo.tipoCierre === 'AUTOMATICO_POR_NUEVA_ENTRADA') {
            closureActor = 'new_entry';
            closureType = 'AUTOMATICO_POR_NUEVA_ENTRADA';
            closureOrigin = 'auto_checkout_on_new_entry';
          } else if (matchedCo.detalle === 'cierre forzado' || matchedCo.detalle === 'cierre por Admin') {
            closureActor = 'admin';
            closureType = 'CIERRE_FORZADO';
            closureOrigin = 'admin_forced_checkout';
          } else if (matchedCo.isManual) {
            closureActor = 'admin';
            closureType = 'MANUAL';
            closureOrigin = 'manual_entry';
          } else {
            closureActor = 'worker';
            closureType = 'MANUAL';
            closureOrigin = 'mobile_app';
          }
        } else if (ci.tipoCierre === 'AUTOMATICO') {
          isClosed = true;
          closureActor = 'scheduler';
          closureType = 'AUTOMATICO';
          closureOrigin = 'scheduler_auto_checkout';
        } else if (ci.tipoCierre === 'AUTOMATICO_POR_NUEVA_ENTRADA') {
          isClosed = true;
          closureActor = 'new_entry';
          closureType = 'AUTOMATICO_POR_NUEVA_ENTRADA';
          closureOrigin = 'auto_checkout_on_new_entry';
        } else if (ci.estado === 'CERRADO' || ci.status === 'completed') {
          isClosed = true;
          closureActor = 'admin';
          closureType = 'CIERRE_FORZADO';
          closureOrigin = 'embedded_closure';
        }

        // GPS de Entrada
        const checkInGps = (ci.locationLat && ci.locationLng) ? {
          lat: Number(ci.locationLat),
          lng: Number(ci.locationLng)
        } : null;

        // GPS de Salida
        let checkOutGps: { lat: number; lng: number } | null = null;
        let checkOutGpsUnreliable: { lat: number; lng: number; reason: string } | null = null;

        if (matchedCo && matchedCo.locationLat && matchedCo.locationLng) {
          const lat = Number(matchedCo.locationLat);
          const lng = Number(matchedCo.locationLng);
          if (closureActor === 'worker') {
            checkOutGps = { lat, lng };
          } else {
            // Cierre por sistema/admin: las coordenadas suelen ser heredadas de entrada
            checkOutGpsUnreliable = {
              lat,
              lng,
              reason: 'copied_from_check_in_by_system_closure'
            };
          }
        }

        // Cálculo de duración (tanto para marcación del trabajador como para cierres automáticos)
        let workedMinutes: number | null = null;
        let workedMinutesBasis: string | null = null;

        const effectiveOutTime = matchedCo
          ? new Date(matchedCo.timestamp).getTime()
          : (ci.endTime ? new Date(ci.endTime).getTime() : (ci.horaSalidaReal ? new Date(ci.horaSalidaReal).getTime() : null));

        if (effectiveOutTime !== null && !isNaN(effectiveOutTime)) {
          const diffMinutes = Math.floor((effectiveOutTime - ciTime) / 60000);
          if (diffMinutes >= 0 && diffMinutes <= 1440) {
            workedMinutes = diffMinutes;
            workedMinutesBasis = closureActor === 'worker'
              ? 'worker_check_in_to_check_out'
              : (closureActor === 'scheduler' ? 'auto_checkout_scheduler' : 'auto_or_system_checkout');
          } else {
            workedMinutesBasis = 'out_of_range';
          }
        } else {
          workedMinutesBasis = 'not_computable';
        }

        // Jornada Date (YYYY-MM-DD)
        let jornadaDate = '';
        if (ci.localDate) {
          jornadaDate = ci.localDate;
        } else if (ci.shiftId) {
          const part = ci.shiftId.split('_').pop();
          if (part && /^\d{4}-\d{2}-\d{2}$/.test(part)) {
            jornadaDate = part;
          }
        }
        if (!jornadaDate) {
          try {
            const d = new Date(ci.timestamp);
            jornadaDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          } catch {
            jornadaDate = '1970-01-01';
          }
        }

        const sessionItem: AttendanceSessionReadModel = {
          id: `manual_${ci.id}`,
          checkInId: ci.id,
          checkOutId: matchedCo ? matchedCo.id : null,
          employeeId: String(ci.employeeId),
          employeeName: ci.employeeName || '',
          employeeRut: ci.rut || '',
          jornadaDate,
          timezone: 'America/Santiago',
          turnoProgramadoId: ci.turnoProgramadoId || null,
          asignacionOperacionalId: null,
          codigoTurno: 'MANUAL',
          tipoOperacion: ci.isManual ? 'registro_manual' : 'app_movil',
          sucursalId: String(ci.siteId || ''),
          sucursalNombre: ci.siteName || '',
          sucursalResolution: 'exact',
          status: isClosed ? 'closed' : 'open',
          attendanceStatus: isClosed ? 'presente' : 'presente',
          checkInAt: ci.timestamp,
          checkInGps,
          checkOutAt: matchedCo ? matchedCo.timestamp : (ci.endTime || ci.horaSalidaReal || null),
          checkOutAtSource: matchedCo ? (closureActor === 'worker' ? 'worker_device' : 'system_execution') : null,
          checkOutGps,
          checkOutGpsUnreliable,
          scheduledStartAt: ci.turnoProgramadoInicio || null,
          scheduledEndAt: ci.turnoProgramadoTermino || null,
          workedMinutes,
          workedMinutesBasis,
          closureType,
          closureOrigin,
          closureActor,
          closureReason: matchedCo?.systemNote || ci.systemNote || null,
          pairing: matchedCo ? {
            method: pairingMethod,
            confidence: pairingMethod === 'explicit_shift_id' ? 'high' : 'medium',
            evidence: [`matched_checkout_${matchedCo.id}`, `method_${pairingMethod}`]
          } : null,
          reviewState: 'ok',
          reviewReasons: [],
          sourceRefs: {
            checkInPath: `Asistencia/${ci.id}`,
            checkOutPath: matchedCo ? `Asistencia/${matchedCo.id}` : null
          },
          auditRefs: [],
          source: 'v2',
          generationStatus: 'active',
          schemaVersion: 2,
          warnings: []
        };

        sessions.push(sessionItem);
      }
    }

    // Ordenar descendente por checkInAt
    return sessions.sort((a, b) => new Date(b.checkInAt).getTime() - new Date(a.checkInAt).getTime());
  }
}

