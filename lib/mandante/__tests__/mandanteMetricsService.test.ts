import { describe, it, expect } from 'vitest';
import {
  MAX_VALID_ROUND_DURATION_MIN,
  calculateAverageRoundDuration,
  computeGuardRoundStats,
  resolveIsRondasViewActive,
  isValidRoundForAvgDuration,
  getRoundDurationMin,
  getPeriodDateRange,
  computeDailyRoundSeries,
  normalizeMandanteNovedad,
  computeNovedadesBreakdown,
  filterAccesoNovedades,
  buildAccessControlRecords,
  computeServiceCoverage,
  computeActiveGuards,
} from '../mandanteMetricsService';
import type { AttendanceLog, GuardRound, Site } from '../../../types';

const makeSite = (id: number, name: string, rondasEnabled?: boolean): Site => ({
  id,
  name,
  address: 'Av. Demo 123',
  active: true,
  rondasEnabled,
});

const makeRound = (
  id: string,
  durationMin: number | null,
  overrides: Partial<GuardRound> = {},
): GuardRound => {
  const start = new Date(2026, 10, 10, 10, 0, 0);
  const end =
    durationMin !== null ? new Date(start.getTime() + durationMin * 60000).toISOString() : undefined;
  return {
    id,
    workerId: overrides.workerId || 'g1',
    workerName: overrides.workerName || 'Henry Opazo',
    siteId: overrides.siteId ?? 1,
    siteName: overrides.siteName || 'Terrazas Kennedy',
    startTime: overrides.startTime || start.toISOString(),
    endTime: end,
    startLocation: { lat: -33.4, lng: -70.6 },
    status: end ? 'COMPLETED' : 'IN_PROGRESS',
    result: overrides.result || 'SIN_NOVEDAD',
    ...overrides,
  };
};

describe('mandanteMetricsService', () => {
  describe('Regla de duración máxima de rondas (≤ 25 min)', () => {
    it('constante MAX_VALID_ROUND_DURATION_MIN es 25', () => {
      expect(MAX_VALID_ROUND_DURATION_MIN).toBe(25);
    });

    it('incluye rondas de hasta 25 minutos exactos y excluye > 25 minutos', () => {
      expect(isValidRoundForAvgDuration(makeRound('r1', 0))).toBe(true);
      expect(isValidRoundForAvgDuration(makeRound('r2', 12))).toBe(true);
      expect(isValidRoundForAvgDuration(makeRound('r3', 25))).toBe(true);
      expect(isValidRoundForAvgDuration(makeRound('r4', 25.1))).toBe(false);
      expect(isValidRoundForAvgDuration(makeRound('r5', 180))).toBe(false);
      expect(isValidRoundForAvgDuration(makeRound('r6', null))).toBe(false);
    });

    it('calculateAverageRoundDuration excluye rondas > 25 min y no completadas', () => {
      const rounds = [
        makeRound('r1', 10),
        makeRound('r2', 20),
        makeRound('r3', 25),
        makeRound('r4', 26),   // excluida
        makeRound('r5', 240),  // excluida (olvido de cierre)
        makeRound('r6', null), // en progreso
      ];

      const res = calculateAverageRoundDuration(rounds);
      // (10 + 20 + 25) / 3 = 18.33 -> 18 min
      expect(res.avgMin).toBe(18);
      expect(res.validCount).toBe(3);
      expect(res.excludedOver25Count).toBe(2);
    });

    it('calculateAverageRoundDuration retorna null si todas las rondas exceden 25 min', () => {
      const rounds = [makeRound('r1', 40), makeRound('r2', 95)];
      const res = calculateAverageRoundDuration(rounds);
      expect(res.avgMin).toBeNull();
      expect(res.validCount).toBe(0);
      expect(res.excludedOver25Count).toBe(2);
    });

    it('computeGuardRoundStats aplica la regla > 25 min por guardia manteniendo conteo total de rondas', () => {
      const rounds = [
        makeRound('g1_1', 10, { workerId: 'g1', workerName: 'Guardia Uno' }),
        makeRound('g1_2', 14, { workerId: 'g1', workerName: 'Guardia Uno' }),
        makeRound('g1_3', 90, { workerId: 'g1', workerName: 'Guardia Uno', result: 'CON_NOVEDAD' }),
        makeRound('g2_1', 60, { workerId: 'g2', workerName: 'Guardia Dos' }),
      ];

      const stats = computeGuardRoundStats(rounds);
      const g1 = stats.find((s) => s.workerId === 'g1')!;
      const g2 = stats.find((s) => s.workerId === 'g2')!;

      expect(g1.total).toBe(3); // Mantiene sus 3 rondas realizadas
      expect(g1.conNovedad).toBe(1);
      expect(g1.avgDurationMin).toBe(12); // (10 + 14) / 2, ignora 90m
      expect(g1.validDurationRounds).toBe(2);
      expect(g1.excludedLongRounds).toBe(1);

      expect(g2.total).toBe(1);
      expect(g2.avgDurationMin).toBeNull(); // Única ronda fue > 25 min
      expect(g2.excludedLongRounds).toBe(1);
    });

    it('getRoundDurationMin retorna null si endTime es anterior a startTime', () => {
      const dur = getRoundDurationMin({
        startTime: '2026-11-10T10:00:00.000Z',
        endTime: '2026-11-10T09:50:00.000Z',
      });
      expect(dur).toBeNull();
    });
  });

  describe('Resolución de vista Mandante (Con Rondas vs Solo Acceso y Novedades)', () => {
    const siteConRondas = makeSite(1, 'Terrazas Kennedy', true);
    const siteSinRondas = makeSite(2, 'Bodega Sur', false);

    it('mandanteViewMode "sin_rondas" siempre desactiva la vista de rondas aunque la sucursal tenga rondas', () => {
      expect(
        resolveIsRondasViewActive({
          mandanteViewMode: 'sin_rondas',
          selectedSiteId: '1',
          allowedSites: [siteConRondas],
        }),
      ).toBe(false);
    });

    it('mandanteViewMode "con_rondas" fuerza vista de rondas incluso en sitio sin rondas', () => {
      expect(
        resolveIsRondasViewActive({
          mandanteViewMode: 'con_rondas',
          selectedSiteId: '2',
          allowedSites: [siteSinRondas],
        }),
      ).toBe(true);
    });

    it('modo "auto" cambia dinámicamente según sucursal seleccionada y todas las asignadas', () => {
      expect(
        resolveIsRondasViewActive({
          mandanteViewMode: 'auto',
          selectedSiteId: 'all',
          allowedSites: [siteConRondas, siteSinRondas],
        }),
      ).toBe(true);

      expect(
        resolveIsRondasViewActive({
          mandanteViewMode: 'auto',
          selectedSiteId: '2',
          allowedSites: [siteConRondas, siteSinRondas],
        }),
      ).toBe(false);

      expect(
        resolveIsRondasViewActive({
          mandanteViewMode: undefined,
          selectedSiteId: 'all',
          allowedSites: [siteSinRondas],
        }),
      ).toBe(false);
    });
  });

  describe('Ventanas de fechas, novedades y series diarias', () => {
    it('getPeriodDateRange calcula exactamente 1, 7 y 30 días locales inclusive', () => {
      const now = new Date(2026, 10, 11, 14, 0, 0); // 11 nov 2026
      const hoy = getPeriodDateRange('hoy', now);
      expect(hoy.startDate).toBe('2026-11-11');
      expect(hoy.endDate).toBe('2026-11-11');
      expect(hoy.daysCount).toBe(1);

      const d7 = getPeriodDateRange('7d', now);
      expect(d7.startDate).toBe('2026-11-05');
      expect(d7.endDate).toBe('2026-11-11');
      expect(d7.daysCount).toBe(7);

      const d30 = getPeriodDateRange('30d', now);
      expect(d30.startDate).toBe('2026-10-13');
      expect(d30.endDate).toBe('2026-11-11');
      expect(d30.daysCount).toBe(30);
    });

    it('computeDailyRoundSeries completa los 7 días del rango incluyendo días en cero', () => {
      const rounds = [
        makeRound('r1', 10, { startTime: new Date(2026, 10, 10, 9, 0).toISOString() }),
        makeRound('r2', 12, { startTime: new Date(2026, 10, 10, 18, 0).toISOString() }),
      ];
      const series = computeDailyRoundSeries(rounds, '2026-11-05', '2026-11-11');
      expect(series).toHaveLength(7);
      expect(series.find((p) => p.date === '2026-11-10')?.count).toBe(2);
      expect(series.find((p) => p.date === '2026-11-11')?.count).toBe(0);
    });

    it('normalizeMandanteNovedad y computeNovedadesBreakdown calculan prioridades y estados exactamente', () => {
      const sites = [makeSite(1, 'Terrazas', true)];
      const raw = [
        { id: 'n1', siteId: 1, prioridad: 'critica', estado: 'registrada', descripcion: 'Portón abierto', timestamp: '2026-11-11T12:00:00-03:00' },
        { id: 'n2', sucursalId: 1, prioridad: 'informativa', estado: 'resuelta', descripcion: 'Entrega normal', fechaHoraDispositivo: '2026-11-11T10:00:00-03:00' },
      ];
      const normalized = raw.map((r) => normalizeMandanteNovedad(r, sites));
      const bd = computeNovedadesBreakdown(normalized);

      expect(bd.total).toBe(2);
      expect(bd.criticas).toBe(1);
      expect(bd.informativas).toBe(1);
      expect(bd.pendientes).toBe(1);
      expect(bd.resueltas).toBe(1);
      expect(bd.summaryText).toBe('1 crítica · 1 informativa');
    });
  });

  describe('Control de acceso, guardias activos y cobertura del servicio', () => {
    const sites = [makeSite(2, 'Bodega Sur', false)];

    it('buildAccessControlRecords y computeServiceCoverage reflejan ingresos/salidas y 7 días cubiertos', () => {
      const now = new Date(2026, 10, 11, 12, 0, 0);
      const logs: AttendanceLog[] = [
        {
          id: 'l1',
          employeeId: 'e1',
          employeeName: 'Oscar Inzulza',
          rut: '1-9',
          timestamp: new Date(2026, 10, 11, 8, 0).toISOString(),
          type: 'check_in',
          siteId: 2,
          siteName: 'Bodega Sur',
          status: 'active',
        },
        {
          id: 'l2',
          employeeId: 'e2',
          employeeName: 'Henry Opazo',
          rut: '2-7',
          timestamp: new Date(2026, 10, 10, 20, 0).toISOString(),
          type: 'check_out',
          siteId: 2,
          siteName: 'Bodega Sur',
          status: 'completed',
        },
      ];

      const access = buildAccessControlRecords({
        attendanceLogs: logs,
        allowedSites: sites,
        selectedSiteId: '2',
        startDate: '2026-11-05',
        endDate: '2026-11-11',
      });

      expect(access).toHaveLength(2);
      expect(access[0].type).toBe('ingreso');
      expect(access[0].detail).toContain('Inicio de turno');
      expect(access[1].type).toBe('salida');
      expect(access[1].detail).toBe('Término de turno');

      const active = computeActiveGuards({
        attendanceLogs: logs,
        allowedSites: sites,
        selectedSiteId: '2',
        roundsInPeriod: [],
        now,
      });
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('Oscar Inzulza');

      const coverage = computeServiceCoverage({
        accessRecords: access,
        allAllowedAccessLogs: logs,
        manualAttendances: [{ siteId: 2, date: '2026-11-09', status: 'presente' }],
        allowedSites: sites,
        selectedSiteId: '2',
        startDate: '2026-11-05',
        endDate: '2026-11-11',
        hasActiveGuardNow: true,
        now,
      });

      // Nov 09 (manual), Nov 10 (log), Nov 11 (log/active) = 3 de 7 días
      expect(coverage.coveredDaysCount).toBe(3);
      expect(coverage.totalDaysCount).toBe(7);
      expect(coverage.percentage).toBe(43);
      expect(coverage.weeklyDays).toHaveLength(7);
    });

    it('computeServiceCoverage marca hoy cubierto cuando hasActiveGuardNow es true aunque el check-in sea del turno nocturno de ayer', () => {
      const now = new Date(2026, 10, 11, 2, 0, 0); // 11 nov 02:00 AM
      const nightCheckInYesterday: AttendanceLog[] = [
        {
          id: 'night-1',
          employeeId: 'e1',
          employeeName: 'Turno Nocturno',
          rut: '1-9',
          timestamp: new Date(2026, 10, 10, 20, 0).toISOString(), // 10 nov 20:00 PM
          type: 'check_in',
          siteId: 2,
          siteName: 'Bodega Sur',
          status: 'active',
        },
      ];

      const coverageWithActive = computeServiceCoverage({
        accessRecords: [],
        allAllowedAccessLogs: nightCheckInYesterday,
        manualAttendances: [],
        allowedSites: sites,
        selectedSiteId: '2',
        startDate: '2026-11-11',
        endDate: '2026-11-11',
        hasActiveGuardNow: true,
        now,
      });

      expect(coverageWithActive.coveredDaysCount).toBe(1);
      expect(coverageWithActive.percentage).toBe(100);
    });

    it('filterAccesoNovedades extrae únicamente novedades de Acceso Personas y Acceso Vehículos', () => {
      const mixedRaw = [
        { id: 'a1', siteId: 2, categoria: 'acceso_personas', prioridad: 'informativa', descripcion: 'Ingresa visita Juan Pérez', timestamp: '2026-11-11T09:00:00-03:00' },
        { id: 'a2', siteId: 2, categoria: 'acceso_vehiculos', prioridad: 'informativa', descripcion: 'Sale furgón patente BBCC12', timestamp: '2026-11-11T10:00:00-03:00' },
        { id: 'n3', siteId: 2, categoria: 'seguridad', prioridad: 'media', descripcion: 'Se retira turno', timestamp: '2026-11-11T11:00:00-03:00' },
      ];
      const normalized = mixedRaw.map((r) => normalizeMandanteNovedad(r, sites));
      const bd = filterAccesoNovedades(normalized);

      expect(bd.total).toBe(2);
      expect(bd.personasCount).toBe(1);
      expect(bd.vehiculosCount).toBe(1);
      expect(bd.summaryText).toBe('1 persona · 1 vehículo');
      expect(bd.records.map((r) => r.id)).toEqual(['a1', 'a2']);
    });
  });
});
