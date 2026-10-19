import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

// Mock lib/firebase para evitar que Firebase Messaging lance error en entorno Node de pruebas
vi.mock('../../lib/firebase', () => ({
  functions: {},
  db: {},
  auth: {},
  storage: {},
  messaging: null,
  getMessagingInstance: () => null
}));

import { ConsolidatedAttendanceService } from '../../services/consolidatedAttendanceService';
import { AttendanceLog } from '../../types';

const require = createRequire(import.meta.url);
const {
  consolidateAttendance,
  buildConsolidatedDoc,
  parseInstant,
  normalizeLog
} = require('../../functions/src/attendanceConsolidation/consolidate.js');
const {
  buildSyntheticDataset
} = require('../../functions/src/attendanceConsolidation/syntheticData.js');
const {
  runMigration,
  assertLocalOnly
} = require('../../functions/src/attendanceConsolidation/migrationRunner.js');

// Helpers para crear documentos idénticos al esquema real de Firestore
function makeCheckIn(id: string, empId: string, timestamp: string, extra: any = {}) {
  return {
    id,
    data: {
      type: 'check_in',
      employeeId: empId,
      employeeName: extra.employeeName || 'Trabajador Prueba',
      rut: extra.rut || '11.111.111-1',
      timestamp,
      siteId: extra.siteId ?? 101,
      siteName: extra.siteName || 'Sucursal Central',
      shiftId: extra.shiftId || `shift_${empId}_${timestamp.slice(0, 10)}`,
      localDate: extra.localDate || timestamp.slice(0, 10),
      estado: extra.estado || 'ABIERTO',
      detalle: extra.detalle || 'APP MOVIL',
      locationLat: extra.locationLat ?? -33.45,
      locationLng: extra.locationLng ?? -70.66,
      ...extra
    }
  };
}

function closeCheckIn(ci: any, endTimestamp: string, tipoCierre: string = 'MANUAL') {
  ci.data.estado = 'CERRADO';
  ci.data.status = 'completed';
  ci.data.endTime = endTimestamp;
  ci.data.horaSalidaReal = endTimestamp;
  ci.data.tipoCierre = tipoCierre;
  return ci;
}

function makeWorkerCheckOut(id: string, ci: any, timestamp: string, extra: any = {}) {
  return {
    id,
    data: {
      type: 'check_out',
      employeeId: ci.data.employeeId,
      employeeName: ci.data.employeeName,
      rut: ci.data.rut,
      timestamp,
      siteId: ci.data.siteId,
      siteName: ci.data.siteName,
      shiftId: ci.data.shiftId,
      localDate: ci.data.localDate,
      horaSalidaReal: timestamp,
      tipoCierre: 'MANUAL',
      estado: 'CERRADO',
      detalle: 'APP MOVIL',
      locationLat: extra.locationLat ?? -33.4501,
      locationLng: extra.locationLng ?? -70.6601,
      ...extra
    }
  };
}

function makeSystemCheckOut(prefix: string, ci: any, timestamp: string, tipoCierre: string, detalle: string, isManual: boolean) {
  return {
    id: `${prefix}${ci.id}`,
    data: {
      ...ci.data,
      id: `${prefix}${ci.id}`,
      type: 'check_out',
      timestamp,
      status: 'completed',
      isManual,
      tipoCierre,
      estado: 'CERRADO',
      horaSalidaReal: timestamp,
      detalle,
      closedByAttendanceId: ci.id,
      systemNote: isManual ? 'Cierre forzado por administrador' : 'Cierre automático de sesión'
    }
  };
}

describe('Asistencia Consolidada — Suite de Pruebas Automatizadas (20 Casos)', () => {

  // -------------------------------------------------------------------------
  // Caso 1: Turno normal (check_in 08:00 + check_out 17:00)
  // -------------------------------------------------------------------------
  it('1. Turno normal: check_in 08:00 + check_out 17:00 consolida 1 fila con duración exacta y actor worker', () => {
    const tIn = '2026-05-10T08:00:00.000-04:00';
    const tOut = '2026-05-10T17:00:00.000-04:00';
    const ci = closeCheckIn(makeCheckIn('ci_normal', 'emp_01', tIn), tOut);
    const co = makeWorkerCheckOut('co_normal', ci, tOut);

    const rawDocs = [ci, co];
    const result = consolidateAttendance(rawDocs);
    expect(result.sessions.length).toBe(1);
    expect(result.review.length).toBe(0);

    const rawMap = new Map(rawDocs.map(d => [d.id, d.data]));
    const { doc } = buildConsolidatedDoc(result.sessions[0], rawMap);

    expect(doc.status).toBe('completed');
    expect(doc.attendanceStatus).toBe('presente');
    expect(doc.closureActor).toBe('worker');
    expect(doc.workedMinutes).toBe(540); // 9 horas = 540 minutos
    expect(doc.workedMinutesBasis).toBe('worker_check_in_to_check_out');
    expect(doc.checkInGps).toEqual({ lat: -33.45, lng: -70.66, accuracy: null });
    expect(doc.checkOutGps).toEqual({ lat: -33.4501, lng: -70.6601, accuracy: null });
  });

  // -------------------------------------------------------------------------
  // Caso 2: Turno nocturno que cruza medianoche (20:00 D -> 06:00 D+1)
  // -------------------------------------------------------------------------
  it('2. Turno nocturno: check_in 20:00 (D) + check_out 06:00 (D+1) asigna jornadaDate D y duración 600 min', () => {
    const tIn = '2026-05-10T20:00:00.000-04:00';
    const tOut = '2026-05-11T06:00:00.000-04:00';
    const ci = closeCheckIn(makeCheckIn('ci_night', 'emp_02', tIn, { localDate: '2026-05-10' }), tOut);
    const co = makeWorkerCheckOut('co_night', ci, tOut);

    const rawDocs = [ci, co];
    const result = consolidateAttendance(rawDocs);
    expect(result.sessions.length).toBe(1);

    const rawMap = new Map(rawDocs.map(d => [d.id, d.data]));
    const { doc } = buildConsolidatedDoc(result.sessions[0], rawMap);

    expect(doc.jornadaDate).toBe('2026-05-10');
    expect(doc.workedMinutes).toBe(600); // 10 horas = 600 minutos
    expect(doc.status).toBe('completed');
  });

  // -------------------------------------------------------------------------
  // Caso 3: Dos turnos del mismo trabajador el mismo día (mañana y tarde)
  // -------------------------------------------------------------------------
  it('3. Dos turnos mismo trabajador y día: genera 2 documentos consolidados sin colisión de claves', () => {
    const ci1 = closeCheckIn(makeCheckIn('ci_morn', 'emp_03', '2026-05-10T08:00:00.000-04:00', { shiftId: 'shift_emp03_morn_2026-05-10' }), '2026-05-10T12:00:00.000-04:00');
    const co1 = makeWorkerCheckOut('co_morn', ci1, '2026-05-10T12:00:00.000-04:00');

    const ci2 = closeCheckIn(makeCheckIn('ci_eve', 'emp_03', '2026-05-10T18:00:00.000-04:00', { shiftId: 'shift_emp03_eve_2026-05-10' }), '2026-05-10T22:00:00.000-04:00');
    const co2 = makeWorkerCheckOut('co_eve', ci2, '2026-05-10T22:00:00.000-04:00');

    const rawDocs = [ci1, co1, ci2, co2];
    const result = consolidateAttendance(rawDocs);
    expect(result.sessions.length).toBe(2);

    const rawMap = new Map(rawDocs.map(d => [d.id, d.data]));
    const doc1 = buildConsolidatedDoc(result.sessions[0], rawMap);
    const doc2 = buildConsolidatedDoc(result.sessions[1], rawMap);

    expect(doc1.id).not.toBe(doc2.id);
    expect(doc1.id).toBe('manual_ci_morn');
    expect(doc2.id).toBe('manual_ci_eve');
    expect(doc1.doc.workedMinutes).toBe(240); // 4 horas
    expect(doc2.doc.workedMinutes).toBe(240); // 4 horas
  });

  // -------------------------------------------------------------------------
  // Caso 4: Auto-cierre por scheduler (tipoCierre = 'AUTOMATICO')
  // -------------------------------------------------------------------------
  it('4. Auto-cierre por scheduler: clasifica closureActor = scheduler, checkOutAtSource = system_execution y calcula duración de turno', () => {
    const ci = closeCheckIn(makeCheckIn('ci_sched', 'emp_04', '2026-05-10T08:00:00.000-04:00'), '2026-05-10T20:00:00.000-04:00', 'AUTOMATICO');
    const co = makeSystemCheckOut('auto_checkout_', ci, '2026-05-10T20:00:00.000-04:00', 'AUTOMATICO', 'cierre forzado', false);

    const rawDocs = [ci, co];
    const result = consolidateAttendance(rawDocs);
    const rawMap = new Map(rawDocs.map(d => [d.id, d.data]));
    const { doc } = buildConsolidatedDoc(result.sessions[0], rawMap);

    expect(doc.closureType).toBe('auto_close');
    expect(doc.closureActor).toBe('scheduler');
    expect(doc.closureOrigin).toBe('scheduler');
    expect(doc.checkOutAtSource).toBe('system_execution');
    expect(doc.workedMinutes).toBe(720); // 12 horas calculadas también para cierre automático
    expect(doc.workedMinutesBasis).toBe('auto_checkout_scheduler');
    expect(doc.checkOutGps).toBeNull();
    expect(doc.checkOutGpsUnreliable).not.toBeNull();
    expect(doc.checkOutGpsUnreliable.reason).toBe('copied_from_check_in_by_system_closure');
  });

  // -------------------------------------------------------------------------
  // Caso 5: Auto-cierre por nueva entrada
  // -------------------------------------------------------------------------
  it('5. Auto-cierre por nueva entrada: clasifica closureActor = new_entry y closureOrigin = mobile', () => {
    const ciPrev = closeCheckIn(makeCheckIn('ci_prev', 'emp_05', '2026-05-10T08:00:00.000-04:00'), '2026-05-11T08:00:00.000-04:00', 'AUTOMATICO_POR_NUEVA_ENTRADA');
    const coAutoNew = {
      id: 'att_auto_new_1778500800000_ci_prev',
      data: {
        ...ciPrev.data,
        type: 'check_out',
        timestamp: '2026-05-11T08:00:00.000-04:00',
        tipoCierre: 'AUTOMATICO_POR_NUEVA_ENTRADA',
        parentCheckInId: 'ci_prev'
      }
    };
    const ciNew = makeCheckIn('ci_new', 'emp_05', '2026-05-11T08:00:01.000-04:00');

    const rawDocs = [ciPrev, coAutoNew, ciNew];
    const result = consolidateAttendance(rawDocs);
    const rawMap = new Map(rawDocs.map(d => [d.id, d.data]));

    const prevSession = result.sessions.find((s: any) => s.checkIn.id === 'ci_prev');
    expect(prevSession).toBeDefined();

    const { doc } = buildConsolidatedDoc(prevSession, rawMap);
    expect(doc.closureActor).toBe('new_entry');
    expect(doc.closureType).toBe('auto_close_new_entry');
    expect(doc.closureOrigin).toBe('mobile');
  });

  // -------------------------------------------------------------------------
  // Caso 6: Cierre forzado por Administrador
  // -------------------------------------------------------------------------
  it('6. Cierre forzado por Administrador: clasifica closureActor = admin, closureType = force_close y calcula duración', () => {
    const ci = closeCheckIn(makeCheckIn('ci_admin', 'emp_06', '2026-05-10T08:00:00.000-04:00'), '2026-05-10T19:00:00.000-04:00', 'MANUAL');
    const co = makeSystemCheckOut('forced_checkout_', ci, '2026-05-10T19:00:00.000-04:00', 'MANUAL', 'cierre por Admin', true);

    const rawDocs = [ci, co];
    const result = consolidateAttendance(rawDocs);
    const rawMap = new Map(rawDocs.map(d => [d.id, d.data]));
    const { doc } = buildConsolidatedDoc(result.sessions[0], rawMap);

    expect(doc.closureActor).toBe('admin');
    expect(doc.closureType).toBe('force_close');
    expect(doc.closureOrigin).toBe('admin');
    expect(doc.checkOutAtSource).toBe('admin_action');
    expect(doc.workedMinutes).toBe(660); // 11 horas calculadas
  });

  // -------------------------------------------------------------------------
  // Caso 7: Check-in abierto reciente (< 36 horas)
  // -------------------------------------------------------------------------
  it('7. Check-in abierto reciente: status = open, checkOutAt = null, reviewState = ok', () => {
    const now = Date.now();
    const recentCheckInTime = new Date(now - 4 * 3600 * 1000).toISOString();

    const rawDocs = [
      makeCheckIn('ci_open_recent', 'emp_07', recentCheckInTime, { estado: 'ABIERTO' })
    ];

    const result = consolidateAttendance(rawDocs, { now });
    expect(result.sessions.length).toBe(1);

    const rawMap = new Map(rawDocs.map(d => [d.id, d.data]));
    const { doc } = buildConsolidatedDoc(result.sessions[0], rawMap);

    expect(doc.status).toBe('open');
    expect(doc.checkOutAt).toBeNull();
    expect(doc.reviewState).toBe('ok');
    expect(doc.workedMinutes).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Caso 8: Check-in abierto stale (> 36 horas sin salida)
  // -------------------------------------------------------------------------
  it('8. Check-in abierto stale: status = open y flag stale_open_checkin en reviewReasons', () => {
    const now = Date.now();
    const staleTime = new Date(now - 48 * 3600 * 1000).toISOString();

    const rawDocs = [
      makeCheckIn('ci_stale', 'emp_08', staleTime, { estado: 'ABIERTO' })
    ];

    const result = consolidateAttendance(rawDocs, { now, staleOpenHours: 36 });
    const rawMap = new Map(rawDocs.map(d => [d.id, d.data]));
    const { doc } = buildConsolidatedDoc(result.sessions[0], rawMap);

    expect(doc.status).toBe('open');
    expect(doc.reviewState).toBe('pending_review');
    expect(doc.reviewReasons).toContain('stale_open_checkin');
  });

  // -------------------------------------------------------------------------
  // Caso 9: Check-out con GPS clonado / heredado del ingreso
  // -------------------------------------------------------------------------
  it('9. GPS heredado en auto-cierre: checkOutGps es null y checkOutGpsUnreliable almacena la coordenada', () => {
    const ci = closeCheckIn(makeCheckIn('ci_gps_inherit', 'emp_09', '2026-05-10T08:00:00.000-04:00', { locationLat: -33.456, locationLng: -70.654 }), '2026-05-10T20:00:00.000-04:00', 'AUTOMATICO');
    const co = makeSystemCheckOut('auto_checkout_', ci, '2026-05-10T20:00:00.000-04:00', 'AUTOMATICO', 'cierre forzado', false);

    const rawDocs = [ci, co];
    const result = consolidateAttendance(rawDocs);
    const rawMap = new Map(rawDocs.map(d => [d.id, d.data]));
    const { doc } = buildConsolidatedDoc(result.sessions[0], rawMap);

    expect(doc.checkOutGps).toBeNull();
    expect(doc.checkOutGpsUnreliable).toEqual({
      lat: -33.456,
      lng: -70.654,
      reason: 'copied_from_check_in_by_system_closure'
    });
  });

  // -------------------------------------------------------------------------
  // Caso 10: Check-out con GPS propio verificado del trabajador móvil
  // -------------------------------------------------------------------------
  it('10. GPS propio del trabajador: checkOutGps almacena las coordenadas reales del dispositivo', () => {
    const ci = closeCheckIn(makeCheckIn('ci_gps_worker', 'emp_10', '2026-05-10T08:00:00.000-04:00', { locationLat: -33.45, locationLng: -70.66 }), '2026-05-10T17:00:00.000-04:00');
    const co = makeWorkerCheckOut('co_gps_worker', ci, '2026-05-10T17:00:00.000-04:00', { locationLat: -33.4502, locationLng: -70.6602 });

    const rawDocs = [ci, co];
    const result = consolidateAttendance(rawDocs);
    const rawMap = new Map(rawDocs.map(d => [d.id, d.data]));
    const { doc } = buildConsolidatedDoc(result.sessions[0], rawMap);

    expect(doc.checkOutGps).toEqual({
      lat: -33.4502,
      lng: -70.6602,
      accuracy: null
    });
    expect(doc.checkOutGpsUnreliable).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Caso 11: Check-out huérfano (sin check_in previo)
  // -------------------------------------------------------------------------
  it('11. Check-out huérfano: se registra en review collection como orphan y no crea sesión fantasma', () => {
    const rawDocs = [
      {
        id: 'co_orphan',
        data: {
          type: 'check_out',
          employeeId: 'emp_11',
          timestamp: '2026-05-10T17:00:00.000-04:00',
          siteId: 101,
          detalle: 'APP MOVIL',
          tipoCierre: 'MANUAL',
          closedByAttendanceId: 'non_existent_checkin'
        }
      }
    ];

    const result = consolidateAttendance(rawDocs);
    expect(result.sessions.length).toBe(0);
    expect(result.review.length).toBe(1);

    const orphanReview = result.review[0];
    expect(orphanReview.kind).toBe('orphan');
    expect(orphanReview.checkOutId).toBe('co_orphan');
  });

  // -------------------------------------------------------------------------
  // Caso 12: Múltiples check-outs ambiguos para un solo check-in
  // -------------------------------------------------------------------------
  it('12. Check-outs ambiguos: pareo con el checkout primario y flag multiple_checkouts_for_checkin en reviewReasons', () => {
    const ci = closeCheckIn(makeCheckIn('ci_mult', 'emp_12', '2026-05-10T08:00:00.000-04:00'), '2026-05-10T17:00:00.000-04:00');
    // co1 pareado por closedByAttendanceId
    const co1 = {
      id: 'co_mult_1',
      data: {
        type: 'check_out',
        employeeId: 'emp_12',
        timestamp: '2026-05-10T17:00:00.000-04:00',
        siteId: 101,
        closedByAttendanceId: 'ci_mult'
      }
    };
    // co2 también con closedByAttendanceId al mismo ci
    const co2 = {
      id: 'co_mult_2',
      data: {
        type: 'check_out',
        employeeId: 'emp_12',
        timestamp: '2026-05-10T17:30:00.000-04:00',
        siteId: 101,
        closedByAttendanceId: 'ci_mult'
      }
    };

    const rawDocs = [ci, co1, co2];
    const result = consolidateAttendance(rawDocs);
    expect(result.sessions.length).toBe(1);

    const rawMap = new Map(rawDocs.map(d => [d.id, d.data]));
    const { doc } = buildConsolidatedDoc(result.sessions[0], rawMap);

    expect(doc.reviewState).toBe('pending_review');
    expect(doc.reviewReasons).toContain('multiple_checkouts_for_checkin');
    expect(doc.checkOutId).toBe('co_mult_1'); // El primero cronológicamente
  });

  // -------------------------------------------------------------------------
  // Caso 13: Duración anómala (checkout antes de checkin)
  // -------------------------------------------------------------------------
  it('13. Duración anómala: checkout antes de checkin marca checkout_before_checkin en reviewReasons', () => {
    const ci = closeCheckIn(makeCheckIn('ci_backwards', 'emp_13', '2026-05-10T18:00:00.000-04:00'), '2026-05-10T08:00:00.000-04:00');
    const co = {
      id: 'forced_checkout_ci_backwards',
      data: {
        type: 'check_out',
        employeeId: 'emp_13',
        timestamp: '2026-05-10T08:00:00.000-04:00', // 10 horas antes!
        siteId: 101,
        closedByAttendanceId: 'ci_backwards'
      }
    };

    const rawDocs = [ci, co];
    const result = consolidateAttendance(rawDocs);
    expect(result.sessions.length).toBe(1);

    const rawMap = new Map(rawDocs.map(d => [d.id, d.data]));
    const { doc } = buildConsolidatedDoc(result.sessions[0], rawMap);

    expect(doc.workedMinutes).toBeNull();
    expect(doc.reviewState).toBe('pending_review');
    expect(doc.reviewReasons).toContain('checkout_before_checkin');
  });

  // -------------------------------------------------------------------------
  // Caso 14: Idempotencia (doble ejecución produce hashes y salidas idénticas)
  // -------------------------------------------------------------------------
  it('14. Idempotencia: dos ejecuciones sobre dataset sintético producen idénticos hashes y documentos', () => {
    const { docs } = buildSyntheticDataset();

    const run1 = consolidateAttendance(docs);
    const run2 = consolidateAttendance(docs);

    expect(run1.stats).toEqual(run2.stats);

    const rawMap = new Map(docs.map((d: any) => [d.id, d.data]));
    const docs1 = run1.sessions.map((s: any) => buildConsolidatedDoc(s, rawMap));
    const docs2 = run2.sessions.map((s: any) => buildConsolidatedDoc(s, rawMap));

    expect(docs1.length).toBe(docs2.length);
    for (let i = 0; i < docs1.length; i++) {
      expect(docs1[i].id).toBe(docs2[i].id);
      expect(docs1[i].doc.sourceHash).toBe(docs2[i].doc.sourceHash);
      expect(docs1[i].doc.workedMinutes).toBe(docs2[i].doc.workedMinutes);
    }
  });

  // -------------------------------------------------------------------------
  // Caso 15: No destructividad de la colección Asistencia
  // -------------------------------------------------------------------------
  it('15. No destructividad: los documentos originales nunca se modifican ni se descartan', () => {
    const raw = makeCheckIn('ci_immutable', 'emp_15', '2026-05-10T08:00:00.000-04:00', {
      customField: 'never_change_this'
    });

    const snapshotBefore = JSON.stringify(raw);
    const result = consolidateAttendance([raw]);
    const snapshotAfter = JSON.stringify(raw);

    expect(snapshotBefore).toBe(snapshotAfter);
    expect(result.sessions.length).toBe(1);
    expect(raw.data.customField).toBe('never_change_this');
  });

  // -------------------------------------------------------------------------
  // Caso 16: Seguridad de Dry-Run (0 escrituras en Firestore)
  // -------------------------------------------------------------------------
  it('16. Dry-run safety: el modo dry-run ejecuta la consolidación y reporta reconciliación aprobada con 0 writes', async () => {
    const prevHost = process.env.FIRESTORE_EMULATOR_HOST;
    const prevProj = process.env.GCLOUD_PROJECT;
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    process.env.GCLOUD_PROJECT = 'demo-ggss-local';

    try {
      let writeCount = 0;
      const mockBatch = {
        set: () => { writeCount++; },
        commit: async () => {}
      };
      const mockDb = {
        batch: () => mockBatch,
        collection: () => ({
          get: async () => ({ docs: [] })
        })
      };

      const report = await runMigration(mockDb, { dryRun: true, synthetic: true });

      expect(report.summary.mode).toBe('dry-run');
      expect(report.written.created).toBe(0);
      expect(report.written.updated).toBe(0);
      expect(report.reconciliation.approved).toBe(true);
      expect(writeCount).toBe(0); // CERO escrituras en la base de datos
    } finally {
      if (prevProj) {
        process.env.GCLOUD_PROJECT = prevProj;
      } else {
        delete process.env.GCLOUD_PROJECT;
      }
      if (prevHost) {
        process.env.FIRESTORE_EMULATOR_HOST = prevHost;
      } else {
        delete process.env.FIRESTORE_EMULATOR_HOST;
      }
    }
  });

  // -------------------------------------------------------------------------
  // Caso 17: Salvaguarda de producción (rechaza credenciales de producción)
  // -------------------------------------------------------------------------
  it('17. Salvaguarda de producción: assertLocalOnly lanza error si no detecta emulador local', () => {
    const oldHost = process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;

    try {
      expect(() => {
        assertLocalOnly();
      }).toThrow(/SEGURIDAD/);
    } finally {
      if (oldHost) process.env.FIRESTORE_EMULATOR_HOST = oldHost;
    }
  });

  // -------------------------------------------------------------------------
  // Caso 18: Variaciones de formato de Timestamp soportadas
  // -------------------------------------------------------------------------
  it('18. Variaciones de fecha: parseInstant interpreta ISO string, Date object, Firestore Timestamp y epoch ms', () => {
    const isoResult = parseInstant('2026-05-10T12:00:00.000Z');
    expect(isoResult).not.toBeNull();
    expect(isoResult.format).toBe('iso_string');

    const dateResult = parseInstant(new Date('2026-05-10T12:00:00.000Z'));
    expect(dateResult).not.toBeNull();
    expect(dateResult.format).toBe('date_object');

    const firestoreTimestamp = {
      toMillis: () => 1778414400000
    };
    const fsResult = parseInstant(firestoreTimestamp);
    expect(fsResult).not.toBeNull();
    expect(fsResult.format).toBe('firestore_timestamp');

    const epochResult = parseInstant(1778414400000);
    expect(epochResult).not.toBeNull();
    expect(epochResult.format).toBe('epoch_ms');

    expect(parseInstant('not-a-date')).toBeNull();
    expect(parseInstant(null)).toBeNull();
    expect(parseInstant(undefined)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Caso 19: Validación y límites de coordenadas GPS
  // -------------------------------------------------------------------------
  it('19. Validación GPS: normalizeLog valida límites geográficos [-90, 90] y detecta coordenadas anómalas', () => {
    const valid = normalizeLog('test_valid', {
      type: 'check_in',
      employeeId: 'emp_gps',
      timestamp: '2026-05-10T12:00:00Z',
      locationLat: -33.45,
      locationLng: -70.66
    });
    expect(valid.gpsProblem).toBeNull();
    expect(valid.gps).toEqual({ lat: -33.45, lng: -70.66, accuracy: null });

    const outOfRange = normalizeLog('test_oor', {
      type: 'check_in',
      employeeId: 'emp_gps',
      timestamp: '2026-05-10T12:00:00Z',
      locationLat: 95.0,
      locationLng: -70.66
    });
    expect(outOfRange.gpsProblem).toBe('gps_out_of_range');
    expect(outOfRange.gps).toBeNull();

    const incomplete = normalizeLog('test_inc', {
      type: 'check_in',
      employeeId: 'emp_gps',
      timestamp: '2026-05-10T12:00:00Z',
      locationLat: -33.45,
      locationLng: null
    });
    expect(incomplete.gpsProblem).toBe('gps_incomplete');
    expect(incomplete.gps).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Caso 20: Motor cliente (ConsolidatedAttendanceService) y compatibilidad con ReadModel
  // -------------------------------------------------------------------------
  it('20. Compatibilidad cliente: consolidateLogsLocally produce sesiones con formato AttendanceSessionReadModel', () => {
    const mockLogs: AttendanceLog[] = [
      {
        id: 'ci_client_test',
        employeeId: 'emp_20',
        employeeName: 'Carlos Gómez',
        rut: '33.333.333-3',
        type: 'check_in',
        timestamp: '2026-05-10T09:00:00.000-04:00',
        siteId: 'site_10',
        siteName: 'Planta Norte',
        locationLat: -33.40,
        locationLng: -70.60
      },
      {
        id: 'co_client_test',
        employeeId: 'emp_20',
        employeeName: 'Carlos Gómez',
        rut: '33.333.333-3',
        type: 'check_out',
        timestamp: '2026-05-10T18:00:00.000-04:00',
        siteId: 'site_10',
        siteName: 'Planta Norte',
        locationLat: -33.401,
        locationLng: -70.601
      }
    ];

    const clientConsolidated = ConsolidatedAttendanceService.consolidateLogsLocally(mockLogs);
    expect(clientConsolidated.length).toBe(1);

    const session = clientConsolidated[0];
    expect(session.id).toBe('manual_ci_client_test');
    expect(session.employeeId).toBe('emp_20');
    expect(session.employeeName).toBe('Carlos Gómez');
    expect(session.employeeRut).toBe('33.333.333-3');
    expect(session.status).toBe('closed');
    expect(session.workedMinutes).toBe(540); // 9 horas
    expect(session.closureActor).toBe('worker');
    expect(session.checkInGps).toEqual({ lat: -33.4, lng: -70.6 });
    expect(session.checkOutGps).toEqual({ lat: -33.401, lng: -70.601 });
    expect(session.source).toBe('v2');
    expect(session.schemaVersion).toBe(2);
  });
});
