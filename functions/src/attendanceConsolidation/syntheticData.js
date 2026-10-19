'use strict';

/**
 * syntheticData.js
 *
 * Datos 100% SINTÉTICOS (nombres y RUT ficticios) que cubren los casos de borde de asistencia.
 * No contiene ni deriva de datos reales de trabajadores.
 */

const NOW = Date.UTC(2026, 9, 15, 15, 0, 0); // 2026-10-15T15:00:00Z (fijo → resultados deterministas)
const H = 3600 * 1000;
const iso = ms => new Date(ms).toISOString();

const EMP = {
  A: { id: 'syn_emp_a', name: 'Trabajador Sintetico A', rut: '00.000.001-0' },
  B: { id: 'syn_emp_b', name: 'Trabajador Sintetico B', rut: '00.000.002-0' },
  C: { id: 'syn_emp_c', name: 'Trabajador Sintetico C', rut: '00.000.003-0' }
};

function checkIn(id, emp, ms, extra = {}) {
  return {
    id,
    data: {
      type: 'check_in', employeeId: emp.id, employeeName: emp.name, rut: emp.rut,
      timestamp: iso(ms), locationLat: -33.4489, locationLng: -70.6693,
      siteId: 101, siteName: 'Sucursal Sintetica', shiftId: `prog_101_${emp.id}_${'2026-10-14'}`,
      localDate: '2026-10-14', estado: 'ABIERTO', detalle: 'APP MOVIL', ...extra
    }
  };
}

function workerCheckOut(id, ci, ms, extra = {}) {
  return {
    id,
    data: {
      type: 'check_out', employeeId: ci.data.employeeId, employeeName: ci.data.employeeName, rut: ci.data.rut,
      timestamp: iso(ms), locationLat: -33.4501, locationLng: -70.6702,
      siteId: ci.data.siteId, siteName: ci.data.siteName, shiftId: ci.data.shiftId, localDate: ci.data.localDate,
      horaSalidaReal: iso(ms), tipoCierre: 'MANUAL', estado: 'CERRADO', detalle: 'APP MOVIL', ...extra
    }
  };
}

/** Marca el check-in como cerrado igual que lo hace la app del trabajador. */
function closeCheckIn(ci, ms, tipoCierre = 'MANUAL') {
  ci.data.estado = 'CERRADO';
  ci.data.status = 'completed';
  ci.data.endTime = iso(ms);
  ci.data.horaSalidaReal = iso(ms);
  ci.data.tipoCierre = tipoCierre;
  return ci;
}

function systemCheckOut(prefix, ci, ms, tipoCierre, detalle, isManual) {
  return {
    id: `${prefix}${ci.id}`,
    data: {
      ...ci.data, id: `${prefix}${ci.id}`, type: 'check_out', timestamp: iso(ms), status: 'completed',
      isManual, tipoCierre, estado: 'CERRADO', horaSalidaReal: iso(ms), detalle, closedByAttendanceId: ci.id,
      systemNote: isManual ? 'Cierre forzado por administrador' : 'Cierre automático de sesión'
    }
  };
}

/**
 * Devuelve { docs, expectations } — expectations documenta el resultado esperado por escenario.
 */
function buildSyntheticDataset() {
  const docs = [];
  const push = (...items) => items.forEach(i => docs.push(i));
  const D13 = Date.UTC(2026, 9, 14, 11, 0, 0); // 08:00 Santiago aprox (UTC-3)

  // 1. Ingreso y salida normales (trabajador A)
  const normalIn = closeCheckIn(checkIn('syn_ci_normal', EMP.A, D13), D13 + 9 * H);
  const normalOut = workerCheckOut('att_syn_out_normal', normalIn, D13 + 9 * H);
  push(normalIn, normalOut);

  // 2. Ingreso sin salida (reciente, abierto)
  push(checkIn('syn_ci_open_recent', EMP.B, NOW - 1 * H, { shiftId: 'prog_101_syn_emp_b_2026-10-15', localDate: '2026-10-15' }));

  // 3. Ingreso sin salida antiguo (obsoleto)
  push(checkIn('syn_ci_open_stale', EMP.C, NOW - 60 * H, { shiftId: 'prog_101_syn_emp_c_2026-10-12', localDate: '2026-10-12' }));

  // 4. Salida sin ingreso identificable
  push({
    id: 'att_syn_out_orphan',
    data: { type: 'check_out', employeeId: EMP.B.id, employeeName: EMP.B.name, timestamp: iso(D13 + 5 * H), siteId: 101, shiftId: 'prog_101_syn_emp_b_2026-10-14', tipoCierre: 'MANUAL', estado: 'CERRADO', detalle: 'APP MOVIL' }
  });

  // 5. Dos turnos del mismo trabajador el mismo día (mismo shiftId → colisión real de claves legacy)
  const t1 = Date.UTC(2026, 9, 13, 9, 0, 0);
  const t2 = Date.UTC(2026, 9, 13, 21, 0, 0);
  const two1 = closeCheckIn(checkIn('syn_ci_two_1', EMP.B, t1, { shiftId: 'prog_101_syn_emp_b_2026-10-13', localDate: '2026-10-13' }), t1 + 4 * H);
  const two1o = workerCheckOut('att_syn_two_1o', two1, t1 + 4 * H);
  const two2 = closeCheckIn(checkIn('syn_ci_two_2', EMP.B, t2, { shiftId: 'prog_101_syn_emp_b_2026-10-13', localDate: '2026-10-13' }), t2 + 3 * H);
  const two2o = workerCheckOut('att_syn_two_2o', two2, t2 + 3 * H);
  push(two1, two1o, two2, two2o);

  // 6. Turno que cruza la medianoche
  const nightIn = Date.UTC(2026, 9, 11, 1, 0, 0); // 22:00 del 10-oct Santiago
  const night = closeCheckIn(checkIn('syn_ci_night', EMP.C, nightIn, { shiftId: 'prog_101_syn_emp_c_2026-10-10', localDate: '2026-10-10' }), nightIn + 9 * H);
  push(night, workerCheckOut('att_syn_night_out', night, nightIn + 9 * H, { localDate: '2026-10-11' }));

  // 7. Cierre forzado por admin (GPS copiado del ingreso)
  const forcedIn = checkIn('syn_ci_forced', EMP.A, Date.UTC(2026, 9, 9, 11, 0, 0), { shiftId: 'prog_101_syn_emp_a_2026-10-09', localDate: '2026-10-09' });
  const forcedOut = systemCheckOut('forced_checkout_', forcedIn, Date.UTC(2026, 9, 9, 23, 30, 0), 'MANUAL', 'cierre por Admin', true);
  closeCheckIn(forcedIn, Date.UTC(2026, 9, 9, 23, 30, 0));
  push(forcedIn, forcedOut);

  // 8. Cierre automático del scheduler
  const autoIn = checkIn('syn_ci_auto', EMP.B, Date.UTC(2026, 9, 8, 11, 0, 0), { shiftId: 'prog_101_syn_emp_b_2026-10-08', localDate: '2026-10-08' });
  const autoOut = systemCheckOut('auto_checkout_', autoIn, Date.UTC(2026, 9, 9, 0, 15, 0), 'AUTOMATICO', 'cierre forzado', false);
  closeCheckIn(autoIn, Date.UTC(2026, 9, 9, 0, 15, 0), 'AUTOMATICO');
  push(autoIn, autoOut);

  // 9. Cierre automático por nueva entrada (ID embebido)
  const neIn = checkIn('syn_ci_newentry', EMP.C, Date.UTC(2026, 9, 7, 11, 0, 0), { shiftId: 'prog_101_syn_emp_c_2026-10-07', localDate: '2026-10-07' });
  const neOutId = 'att_auto_new_1790000000000_syn_ci_newentry';
  const neOut = { id: neOutId, data: { ...neIn.data, id: neOutId, type: 'check_out', timestamp: iso(Date.UTC(2026, 9, 8, 11, 0, 0)), tipoCierre: 'AUTOMATICO_POR_NUEVA_ENTRADA', estado: 'CERRADO', detalle: 'cierre forzado', isManual: false } };
  closeCheckIn(neIn, Date.UTC(2026, 9, 8, 11, 0, 0), 'AUTOMATICO_POR_NUEVA_ENTRADA');
  push(neIn, neOut);

  // 10. Duplicados exactos (mismo tipo, trabajador, instante y sucursal con otro ID)
  const dupIn = checkIn('syn_ci_dup_a', EMP.A, Date.UTC(2026, 9, 6, 11, 0, 0), { shiftId: 'prog_101_syn_emp_a_2026-10-06', localDate: '2026-10-06' });
  push(dupIn, { id: 'syn_ci_dup_b', data: { ...dupIn.data } });

  // 11. Formatos de fecha distintos (offset, epoch ms)
  push(checkIn('syn_ci_fmt_offset', EMP.A, Date.UTC(2026, 9, 5, 11, 0, 0), { timestamp: '2026-10-05T08:00:00.000-03:00', shiftId: 'prog_101_syn_emp_a_2026-10-05', localDate: '2026-10-05' }));
  push(checkIn('syn_ci_fmt_epoch', EMP.B, Date.UTC(2026, 9, 4, 11, 0, 0), { timestamp: Date.UTC(2026, 9, 4, 11, 0, 0), shiftId: 'prog_101_syn_emp_b_2026-10-04', localDate: '2026-10-04' }));

  // 12. GPS ausente y GPS inválido
  push(checkIn('syn_ci_nogps', EMP.C, Date.UTC(2026, 9, 3, 11, 0, 0), { locationLat: null, locationLng: null, shiftId: 'prog_101_syn_emp_c_2026-10-03', localDate: '2026-10-03' }));
  push(checkIn('syn_ci_badgps', EMP.A, Date.UTC(2026, 9, 2, 11, 0, 0), { locationLat: 999, locationLng: -70, shiftId: 'prog_101_syn_emp_a_2026-10-02', localDate: '2026-10-02' }));

  // 13. Histórico incompleto: cerrado en el propio ingreso, sin documento de salida; y sin estado
  push(closeCheckIn(checkIn('syn_ci_closed_no_out', EMP.B, Date.UTC(2026, 9, 1, 11, 0, 0), { shiftId: 'prog_101_syn_emp_b_2026-10-01', localDate: '2026-10-01' }), Date.UTC(2026, 9, 1, 19, 0, 0)));
  push(checkIn('syn_ci_no_state', EMP.C, Date.UTC(2026, 8, 30, 11, 0, 0), { estado: undefined, shiftId: undefined, localDate: undefined }));

  // 14. Documentos inutilizables
  push({ id: 'syn_bad_ts', data: { type: 'check_in', employeeId: EMP.A.id, timestamp: 'no-es-fecha' } });
  push({ id: 'syn_bad_emp', data: { type: 'check_in', timestamp: iso(D13) } });
  push({ id: 'syn_bad_type', data: { type: 'otro', employeeId: EMP.A.id, timestamp: iso(D13) } });

  // 15. Ambiguo: dos ingresos con el mismo endTime y una salida sin vínculo explícito
  const ambT = Date.UTC(2026, 8, 29, 20, 0, 0);
  const amb1 = closeCheckIn(checkIn('syn_ci_amb_1', EMP.A, ambT - 9 * H, { shiftId: 'prog_101_syn_emp_a_2026-09-29', localDate: '2026-09-29' }), ambT);
  const amb2 = closeCheckIn(checkIn('syn_ci_amb_2', EMP.A, ambT - 8 * H, { shiftId: 'prog_101_syn_emp_a_2026-09-29', localDate: '2026-09-29' }), ambT);
  push(amb1, amb2, workerCheckOut('att_syn_amb_out', amb1, ambT));

  // 16. Vínculo explícito con otro trabajador (inconsistente)
  const mmIn = checkIn('syn_ci_mismatch', EMP.A, Date.UTC(2026, 8, 28, 11, 0, 0), { shiftId: 'prog_101_syn_emp_a_2026-09-28', localDate: '2026-09-28' });
  push(mmIn, { id: 'forced_checkout_syn_ci_mismatch', data: { type: 'check_out', employeeId: EMP.B.id, timestamp: iso(Date.UTC(2026, 8, 28, 20, 0, 0)), closedByAttendanceId: 'syn_ci_mismatch', isManual: true, tipoCierre: 'MANUAL', detalle: 'cierre por Admin' } });

  // 17. Dos salidas para un ingreso (cierre del trabajador + cierre automático posterior)
  const dcIn = closeCheckIn(checkIn('syn_ci_double_close', EMP.C, Date.UTC(2026, 8, 27, 11, 0, 0), { shiftId: 'prog_101_syn_emp_c_2026-09-27', localDate: '2026-09-27' }), Date.UTC(2026, 8, 27, 19, 0, 0));
  push(dcIn, workerCheckOut('att_syn_dc_worker', dcIn, Date.UTC(2026, 8, 27, 19, 0, 0)));
  push(systemCheckOut('auto_checkout_', dcIn, Date.UTC(2026, 8, 28, 0, 30, 0), 'AUTOMATICO', 'cierre forzado', false));

  // 18. Teléfono compartido / cambio de teléfono: la atribución es por employeeId.
  //     Un ingreso de A (endTime=T) y una salida de B (timestamp=T) NO deben emparejarse.
  const shT = Date.UTC(2026, 8, 26, 19, 0, 0);
  const shIn = closeCheckIn(checkIn('syn_ci_shared_a', EMP.A, shT - 8 * H, { shiftId: 'prog_101_syn_emp_a_2026-09-26', localDate: '2026-09-26' }), shT);
  push(shIn, { id: 'att_syn_shared_out_b', data: { type: 'check_out', employeeId: EMP.B.id, employeeName: EMP.B.name, timestamp: iso(shT), siteId: 101, shiftId: 'prog_101_syn_emp_a_2026-09-26', tipoCierre: 'MANUAL', estado: 'CERRADO', detalle: 'APP MOVIL' } });

  const expectations = {
    sessions: docs.filter(d => d.data.type === 'check_in' && d.data.employeeId && !['syn_bad_ts'].includes(d.id) && d.data.timestamp !== 'no-es-fecha').length,
    note: 'Ver tests de consolidación: cada escenario se verifica de forma explícita.'
  };
  return { docs, expectations, NOW, EMP };
}

module.exports = { buildSyntheticDataset, NOW, EMP };
