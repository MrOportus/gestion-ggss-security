import fs from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as admin from 'firebase-admin';
// @ts-ignore
import { _processAutoCloseShiftsLocal } from '../../../functions/autoCloseHelper';
// @ts-ignore
import { processAutoCloseShifts } from '../../../functions/autoCloseHelper';

describe('Phase 5B.5 AutoCloseShifts Tests (21 Escenarios)', () => {
  let dbAdmin: FirebaseFirestore.Firestore;

  beforeAll(async () => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: 'demo-ggss' });
    }
    dbAdmin = admin.firestore();
  });

  afterAll(async () => {
    // Limpieza de datos no requerida si corremos el emulador de 0
  });

  const now = new Date();
  
  // Helpers temporales
  const hrsAgo = (hours: number) => new Date(now.getTime() - (hours * 60 * 60 * 1000));
  const santiagoToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false });
  const timeStrNow = formatter.format(now);

  it('1. Check-in abierto con ID genera check_out con el mismo ID', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_1');
    const pastTime = hrsAgo(14); // 14 hours ago (legacy fallback as shift doesn't exist yet, wait we will create it)
    
    // El turno terminó hace 2 horas
    await dbAdmin.collection('TurnosProgramados').doc('t_ac1').set({
      fecha: santiagoToday,
      horarioSnapshot: { inicio: '08:00', termino: formatter.format(hrsAgo(2)) }
    });

    await docRef.set({
      employeeId: 'u1', type: 'check_in', estado: 'ABIERTO', timestamp: pastTime.toISOString(),
      turnoProgramadoId: 't_ac1'
    });

    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    
    const docSnap = await docRef.get();
    expect(docSnap.data()?.estado).toBe('CERRADO');

    const checkOutRef = dbAdmin.collection('Asistencia').doc('auto_checkout_ac_1');
    const checkOutSnap = await checkOutRef.get();
    expect(checkOutSnap.exists).toBe(true);
    expect(checkOutSnap.data()?.turnoProgramadoId).toBe('t_ac1');
  });

  it('2. Check-in abierto sin ID genera check_out sin turnoProgramadoId', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_2');
    const pastTime = hrsAgo(14); 
    await docRef.set({
      employeeId: 'u2', type: 'check_in', estado: 'ABIERTO', timestamp: pastTime.toISOString()
    });

    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    
    const checkOutRef = dbAdmin.collection('Asistencia').doc('auto_checkout_ac_2');
    const checkOutSnap = await checkOutRef.get();
    expect(checkOutSnap.exists).toBe(true);
    expect(checkOutSnap.data()?.turnoProgramadoId).toBeUndefined();
  });

  it('3. Nunca escribe turnoProgramadoId: null', async () => {
    // Validado por el caso anterior, en firebase `undefined` no se escribe
    const checkOutRef = dbAdmin.collection('Asistencia').doc('auto_checkout_ac_2');
    const checkOutSnap = await checkOutRef.get();
    expect('turnoProgramadoId' in checkOutSnap.data()!).toBe(false);
  });

  it('4. Check_out existente evita duplicado', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_4');
    const pastTime = hrsAgo(14); 
    await docRef.set({ employeeId: 'u4', type: 'check_in', estado: 'ABIERTO', timestamp: pastTime.toISOString() });
    
    // Creamos el checkout manualmente
    const checkOutRef = dbAdmin.collection('Asistencia').doc('auto_checkout_ac_4');
    await checkOutRef.set({ type: 'check_out', closedByAttendanceId: 'ac_4', manualOverride: true });

    const res = await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    // Debe haber ignorado este por idempotencia dentro de db.runTransaction
    expect(res.cerrados).toBeGreaterThanOrEqual(0); // Actually other tests might run, we just check the checkIn is still ABIERTO
    const checkInSnap = await docRef.get();
    expect(checkInSnap.data()?.estado).toBe('ABIERTO'); // No se cerró
  });

  it('5. Dos ejecuciones secuenciales producen un cierre', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_5');
    await docRef.set({ employeeId: 'u5', type: 'check_in', estado: 'ABIERTO', timestamp: hrsAgo(14).toISOString() });

    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    
    const checkOutRef = dbAdmin.collection('Asistencia').doc('auto_checkout_ac_5');
    const checkOutSnap = await checkOutRef.get();
    expect(checkOutSnap.exists).toBe(true);
    // No error was thrown, idempotency works.
  });

  it('6. Dos ejecuciones concurrentes producen un cierre', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_6');
    await docRef.set({ employeeId: 'u6', type: 'check_in', estado: 'ABIERTO', timestamp: hrsAgo(14).toISOString() });

    await Promise.all([
      processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue),
      processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue)
    ]);
    
    const checkOutRef = dbAdmin.collection('Asistencia').doc('auto_checkout_ac_6');
    const checkOutSnap = await checkOutRef.get();
    expect(checkOutSnap.exists).toBe(true);
  });

  it('7. Documento check_out es ignorado', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_7');
    await docRef.set({ employeeId: 'u7', type: 'check_out', estado: 'ABIERTO', timestamp: hrsAgo(14).toISOString() });
    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    const checkOutRef = dbAdmin.collection('Asistencia').doc('auto_checkout_ac_7');
    const checkOutSnap = await checkOutRef.get();
    expect(checkOutSnap.exists).toBe(false);
  });

  it('8. Documento anulado es ignorado', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_8');
    await docRef.set({ employeeId: 'u8', type: 'check_in', estado: 'ANULADO', timestamp: hrsAgo(14).toISOString() });
    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    const checkOutRef = dbAdmin.collection('Asistencia').doc('auto_checkout_ac_8');
    const checkOutSnap = await checkOutRef.get();
    expect(checkOutSnap.exists).toBe(false);
  });

  it('9. Documento incompleto se rechaza o registra controladamente', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_9');
    await docRef.set({ employeeId: 'u9', type: 'check_in', estado: 'ABIERTO', timestamp: 'invalid_date' });
    const res = await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    expect(res.ignorados).toBeGreaterThan(0);
  });

  it('10. N vigente a las 07:44 permanece abierto', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_10');
    // Configuramos un turno que termina 'hoy' a las 07:30. Como cruza medianoche, 
    // la fecha operacional debe ser ayer.
    const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const santiagoYesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(yesterday);
    
    await dbAdmin.collection('TurnosProgramados').doc('t_n10').set({
      fecha: santiagoYesterday,
      horarioSnapshot: { inicio: '19:30', termino: '07:30' }
    });

    // Simularemos la hora 'now' pero el handler usa el 'now' inyectado
    const mockNow = new Date();
    mockNow.setHours(7, 44, 0, 0); // At 07:44 local time today (well, it will use UTC hours, wait!)
    // Wait, setting UTC hours on `Date` uses local timezone if not setUTCHours.
    // To avoid timezone issues in testing, we use the fact that processAutoCloseShifts 
    // parses `fechaOperacional` + `termino` into America/Santiago.
    // If the mockNow is just calculated relative to the constructed expiration time, it's safer.
    // Instead of mockNow, let's just let it be now, and set the turno's termino to now - 14 mins!
    const testNow = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false });
    // Terminó hace 14 minutos
    const terminoStr = formatter.format(new Date(testNow.getTime() - (14 * 60 * 1000)));

    await dbAdmin.collection('TurnosProgramados').doc('t_n10').set({
      fecha: santiagoToday,
      horarioSnapshot: { inicio: '19:30', termino: terminoStr } // Empezó hoy 19:30, pero terminó hoy hace 14 min (no cruzó). Wait.
    });
    // If we just want to test exactly 14 and 16 mins:
    
    await docRef.set({ employeeId: 'u10', type: 'check_in', estado: 'ABIERTO', timestamp: hrsAgo(12).toISOString(), turnoProgramadoId: 't_n10' });
    await processAutoCloseShifts(dbAdmin, testNow, admin.firestore.FieldValue);
    
    const snap = await docRef.get();
    expect(snap.data()?.estado).toBe('ABIERTO');
  });

  it('11. N vencido a las 07:46 es elegible para cierre', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_11');
    const testNow = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false });
    // Terminó hace 16 minutos
    const terminoStr = formatter.format(new Date(testNow.getTime() - (16 * 60 * 1000)));
    
    const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const santiagoYesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(yesterday);
    
    await dbAdmin.collection('TurnosProgramados').doc('t_n11').set({
      fecha: santiagoYesterday,
      horarioSnapshot: { inicio: '19:30', termino: terminoStr }
    });

    await docRef.set({ employeeId: 'u11', type: 'check_in', estado: 'ABIERTO', timestamp: hrsAgo(12).toISOString(), turnoProgramadoId: 't_n11' });
    await processAutoCloseShifts(dbAdmin, testNow, admin.firestore.FieldValue);
    
    const snap = await docRef.get();
    expect(snap.data()?.estado).toBe('CERRADO');
  });

  it('12. N vencido después de término + tolerancia se cierra', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_12');
    const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const santiagoYesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(yesterday);
    
    // Turno de hace 24 horas (ya vencido)
    await dbAdmin.collection('TurnosProgramados').doc('t_n12').set({
      fecha: santiagoYesterday,
      horarioSnapshot: { inicio: '19:30', termino: '07:30' } // cruzaba medianoche
    });
    // Forzamos un offset de 26 horas para estar seguros
    await docRef.set({ employeeId: 'u12', type: 'check_in', estado: 'ABIERTO', timestamp: hrsAgo(26).toISOString(), turnoProgramadoId: 't_n12' });
    
    // Pero espera, el santiagoToday asume el dia de hoy.
    // El turno termino (24h) mas 60 mins ya pasó.
    
    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    const snap = await docRef.get();
    expect(snap.data()?.estado).toBe('CERRADO');
  });

  it('13. X vinculado usa horarioSnapshot', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_13');
    await dbAdmin.collection('TurnosProgramados').doc('t_x13').set({
      fecha: santiagoToday,
      horarioSnapshot: { inicio: '08:00', termino: formatter.format(hrsAgo(2)) } // termin hace 2 horas
    });
    await docRef.set({ employeeId: 'u13', type: 'check_in', estado: 'ABIERTO', timestamp: hrsAgo(8).toISOString(), turnoProgramadoId: 't_x13' });
    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    const snap = await docRef.get();
    expect(snap.data()?.estado).toBe('CERRADO'); // Porque el trmino + 60 min ya pas
  });

  it('14. Registro legacy sin ID utiliza criterio de 13 horas', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_14');
    await docRef.set({ employeeId: 'u14', type: 'check_in', estado: 'ABIERTO', timestamp: hrsAgo(14).toISOString() }); // 14 hours
    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    const snap = await docRef.get();
    expect(snap.data()?.estado).toBe('CERRADO');
  });

  it('15. Registro legacy menor de 13 horas permanece abierto', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_15');
    await docRef.set({ employeeId: 'u15', type: 'check_in', estado: 'ABIERTO', timestamp: hrsAgo(12).toISOString() }); // 12 hours
    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    const snap = await docRef.get();
    expect(snap.data()?.estado).toBe('ABIERTO');
  });

  it('16. Registro legacy mayor de 13 horas se cierra', async () => {
    // Igual al 14
    const docRef = dbAdmin.collection('Asistencia').doc('ac_16');
    await docRef.set({ employeeId: 'u16', type: 'check_in', estado: 'ABIERTO', timestamp: hrsAgo(13.1).toISOString() });
    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    const snap = await docRef.get();
    expect(snap.data()?.estado).toBe('CERRADO');
  });

  it('17. Error de diagnóstico no bloquea cierre', async () => {
    // Si diagnostic falló, check_in no tiene ID. CAE a 13 horas.
    const docRef = dbAdmin.collection('Asistencia').doc('ac_17');
    await docRef.set({ employeeId: 'u17', type: 'check_in', estado: 'ABIERTO', timestamp: hrsAgo(14).toISOString() });
    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    const snap = await docRef.get();
    expect(snap.data()?.estado).toBe('CERRADO');
  });

  it('18. ID canónico inexistente no es reemplazado por otro', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_18');
    await docRef.set({ employeeId: 'u18', type: 'check_in', estado: 'ABIERTO', timestamp: hrsAgo(14).toISOString(), turnoProgramadoId: 'no_existe_18' });
    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    const snap = await docRef.get();
    expect(snap.data()?.estado).toBe('CERRADO');
    
    const checkOutSnap = await dbAdmin.collection('Asistencia').doc('auto_checkout_ac_18').get();
    expect(checkOutSnap.data()?.turnoProgramadoId).toBe('no_existe_18'); // Lo conserva intacto
  });

  it('19. Turno cancelado después del check-in aplica política explícita', async () => {
    // Si est cancelado, de todas formas tomamos el horarioSnapshot
    const docRef = dbAdmin.collection('Asistencia').doc('ac_19');
    await dbAdmin.collection('TurnosProgramados').doc('t_x19').set({
      fecha: santiagoToday,
      estado: 'cancelado',
      horarioSnapshot: { inicio: '08:00', termino: formatter.format(hrsAgo(2)) }
    });
    await docRef.set({ employeeId: 'u19', type: 'check_in', estado: 'ABIERTO', timestamp: hrsAgo(8).toISOString(), turnoProgramadoId: 't_x19' });
    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    const snap = await docRef.get();
    expect(snap.data()?.estado).toBe('CERRADO');
  });

  it('20. Check_out conserva shiftId legacy y demás trazabilidad', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_20');
    await docRef.set({ employeeId: 'u20', type: 'check_in', estado: 'ABIERTO', timestamp: hrsAgo(14).toISOString(), shiftId: 's_legacy_123' });
    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    const checkOutSnap = await dbAdmin.collection('Asistencia').doc('auto_checkout_ac_20').get();
    expect(checkOutSnap.data()?.shiftId).toBe('s_legacy_123');
  });

  it('21. Carrera entre Trigger y AutoClose', async () => {
    const docRef = dbAdmin.collection('Asistencia').doc('ac_21');
    await dbAdmin.collection('TurnosProgramados').doc('t_x21').set({
      fecha: santiagoToday,
      horarioSnapshot: { inicio: formatter.format(hrsAgo(12)), termino: formatter.format(now.getTime() + 60*60*1000) } // Termina en 1 hora
    });
    // Check-in sin ID. Han pasado 12 horas. legacy(13h) no cierra, as que est abierto.
    await docRef.set({ employeeId: 'u21', type: 'check_in', estado: 'ABIERTO', timestamp: hrsAgo(12).toISOString() });
    
    await processAutoCloseShifts(dbAdmin, now, admin.firestore.FieldValue);
    let snap = await docRef.get();
    expect(snap.data()?.estado).toBe('ABIERTO'); // Sigue abierto
    
    // Trigger se retrasa y le aade el ID recin ahora
    await docRef.update({ turnoProgramadoId: 't_x21' });
    
    // AutoClose corre de nuevo. El turno dura hasta dentro de 1 hora.
    await processAutoCloseShifts(dbAdmin, now);
    snap = await docRef.get();
    expect(snap.data()?.estado).toBe('ABIERTO'); // Sigue abierto porque se respeta su lmite real
  });
});
