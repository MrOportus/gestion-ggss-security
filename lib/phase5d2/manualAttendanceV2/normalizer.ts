import { ManualAttendanceV2, FirebaseTimestamp } from './types';
import { getJornadaDateForTimezone } from './dateUtils';
import { buildManualAttendanceV2Id } from './idBuilder';

export interface NormalizerSessionInput {
  checkIn: any;
  checkOut: any | null;
  turnoProgramado: any | null;
  programacionLegacy: any | null;
  context: {
    now: FirebaseTimestamp;
    serverTimestampFn: () => FirebaseTimestamp;
  };
}

export function buildManualAttendanceV2FromSession({
  checkIn,
  checkOut,
  turnoProgramado,
  programacionLegacy,
  context
}: NormalizerSessionInput): { id: string; record: ManualAttendanceV2 } {
  if (!checkIn) {
    throw new Error('checkIn is required to build a session');
  }

  // 1. Resolver Sucursal
  let sucursalId: string | null = null;
  let sucursalResolution: ManualAttendanceV2['sucursalResolution'] = 'unresolved';

  if (turnoProgramado?.sucursalId) {
    sucursalId = turnoProgramado.sucursalId;
    sucursalResolution = 'turno_programado';
  } else if (programacionLegacy?.siteId) {
    sucursalId = programacionLegacy.siteId;
    sucursalResolution = 'programacion_legacy';
  } else if (checkIn.siteId) {
    sucursalId = checkIn.siteId;
    sucursalResolution = 'check_in';
  }

  // 2. Resolver JornadaDate
  let jornadaDate: string;
  if (checkIn.localDate && /^\d{4}-\d{2}-\d{2}$/.test(checkIn.localDate)) {
    jornadaDate = checkIn.localDate;
  } else if (turnoProgramado?.fecha && /^\d{4}-\d{2}-\d{2}$/.test(turnoProgramado.fecha)) {
    jornadaDate = turnoProgramado.fecha;
  } else if (checkIn.timestamp) {
    // Calculamos desde timestamp
    const dateObj = checkIn.timestamp.toDate ? checkIn.timestamp.toDate() : new Date(checkIn.timestamp);
    jornadaDate = getJornadaDateForTimezone(dateObj, 'America/Santiago');
  } else {
    throw new Error('Cannot safely resolve jornadaDate from checkIn');
  }

  // 3. Resolución de Checkout
  let resolvedCheckOut = null;
  if (checkOut) {
    // Check explícito o transaccional
    if (checkIn.checkOutId === checkOut.id || checkOut.parentCheckInId === checkIn.id) {
      resolvedCheckOut = checkOut;
    } else if (checkOut.type === 'check_out' && checkOut.employeeId === checkIn.employeeId) {
      // Advertencia estructurada en un contexto real: No deberíamos asociar solo por employeeId,
      // pero si el caller nos pasó explícitamente el checkout, asumimos que tiene relación transaccional.
      resolvedCheckOut = checkOut;
    }
  }

  // 4. Calcular estados
  let status: ManualAttendanceV2['status'] = 'open';
  let attendanceStatus: ManualAttendanceV2['attendanceStatus'] = 'sin_clasificar';
  
  if (resolvedCheckOut) {
    status = 'completed';
    attendanceStatus = 'presente';
  } else if (checkIn.estado === 'CERRADO') {
    status = 'completed';
    attendanceStatus = 'incompleto';
  }

  // Si está marcado manual como ausente
  if (checkIn.status === 'ausente') {
    attendanceStatus = 'ausente';
    status = 'completed';
  }

  // 5. Tipo Operación
  let tipoOperacion: ManualAttendanceV2['tipoOperacion'] = 'sin_clasificar';
  if (turnoProgramado) {
    tipoOperacion = 'contractual';
  } else if (checkIn.isEmergency) {
    tipoOperacion = 'emergencia';
  } else if (checkIn.isCobertura) {
    tipoOperacion = 'cobertura';
  } else if (checkIn.isExtra) {
    tipoOperacion = 'extra';
  } else if (programacionLegacy) {
    tipoOperacion = 'contractual';
  }

  // 6. Cierre (Closure)
  let closureType: ManualAttendanceV2['closureType'] = null;
  let closureOrigin: ManualAttendanceV2['closureOrigin'] = null;

  if (resolvedCheckOut) {
    if (resolvedCheckOut.tipoCierre === 'AUTOMATICO') {
      closureType = 'auto_close';
      closureOrigin = 'scheduler';
    } else if (resolvedCheckOut.tipoCierre === 'MANUAL') {
      closureType = 'force_close';
      closureOrigin = 'admin';
    } else {
      closureType = 'normal';
      closureOrigin = 'mobile';
    }
  } else if (checkIn.estado === 'CERRADO') {
    // Cerrado sin checkout? Probablemente error o corrección
    closureType = 'manual_correction';
    closureOrigin = 'admin';
  }

  // 7. Cálculo de horas
  let workedMinutes: number | null = null;
  if (resolvedCheckOut && checkIn.timestamp && resolvedCheckOut.timestamp) {
    const tIn = checkIn.timestamp.toMillis ? checkIn.timestamp.toMillis() : new Date(checkIn.timestamp).getTime();
    const tOut = resolvedCheckOut.timestamp.toMillis ? resolvedCheckOut.timestamp.toMillis() : new Date(resolvedCheckOut.timestamp).getTime();
    workedMinutes = Math.max(0, Math.floor((tOut - tIn) / 60000));
  }

  const record: ManualAttendanceV2 = {
    schemaVersion: 2,
    recordKind: 'shift_attendance',
    isLegacy: false,
    
    checkInId: checkIn.id,
    checkOutId: resolvedCheckOut ? resolvedCheckOut.id : null,
    employeeId: checkIn.employeeId,
    turnoProgramadoId: turnoProgramado?.id || null,
    asignacionOperacionalId: turnoProgramado?.asignacionOperacionalId || programacionLegacy?.id || null,
    legacyShiftId: checkIn.shiftId || null,

    jornadaDate,
    timezone: 'America/Santiago',

    codigoTurno: turnoProgramado?.codigoTurno || programacionLegacy?.codigoTurno || null,
    tipoOperacion,

    sucursalId,
    sucursalResolution,

    status,
    attendanceStatus,

    checkInAt: checkIn.timestamp,
    checkOutAt: resolvedCheckOut ? resolvedCheckOut.timestamp : null,
    scheduledStartAt: turnoProgramado?.startAt || null,
    scheduledEndAt: turnoProgramado?.endAt || null,

    closureType,
    closureOrigin,

    workedMinutes,

    source: 'canonical',
    createdAt: context.serverTimestampFn(),
    updatedAt: context.serverTimestampFn(),
    createdBy: checkIn.employeeId,
    updatedBy: checkIn.employeeId,
    requestId: resolvedCheckOut?.requestId || checkIn.requestId || null,
    operationTokenId: resolvedCheckOut?.operationTokenId || null,

    legacyDocumentId: `manual_${checkIn.employeeId}_${jornadaDate}`,
    legacyDate: jornadaDate,
    legacyType: null
  };

  return {
    id: buildManualAttendanceV2Id(checkIn.id),
    record
  };
}
