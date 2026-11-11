import {
  AttendanceLog,
  DEFAULT_SITE_HORARIO,
  Employee,
  GuardRound,
  MandanteViewMode,
  Site,
} from '../../types';

/** Duración máxima (en minutos) para considerar una ronda en el promedio */
export const MAX_VALID_ROUND_DURATION_MIN = 25;

export type MandantePeriod = 'hoy' | '7d' | '30d';

export interface DateRangeWindow {
  startDate: string;
  endDate: string;
  prevStartDate: string;
  prevEndDate: string;
  daysCount: number;
}

export interface AverageDurationResult {
  avgMin: number | null;
  validCount: number;
  excludedOver25Count: number;
}

export interface GuardRoundStat {
  workerId: string;
  name: string;
  total: number;
  sinNovedad: number;
  conNovedad: number;
  avgDurationMin: number | null;
  validDurationRounds: number;
  excludedLongRounds: number;
  lastRound: string;
}

export interface DailySeriesPoint {
  date: string;
  label: string;
  shortDate: string;
  count: number;
}

export interface ActiveGuardSummary {
  id: string;
  name: string;
  siteId: string;
  siteName: string;
  checkInTime: string;
  checkInIso: string;
  shiftRange: string;
  roundsInPeriod: number;
}

export interface NormalizedMandanteNovedad {
  id: string;
  siteId: string;
  siteName: string;
  tipo: string;
  categoria: string;
  prioridad: 'critica' | 'alta' | 'media' | 'informativa';
  estadoTone: 'pendiente' | 'revision' | 'resuelta';
  estadoLabel: string;
  descripcion: string;
  ubicacionInstalacion?: string;
  guardName: string;
  timestamp: string;
  localDate: string;
  evidencias: string[];
  original: any;
}

export interface NovedadesBreakdown {
  total: number;
  criticas: number;
  altas: number;
  medias: number;
  informativas: number;
  pendientes: number;
  resueltas: number;
  summaryText: string;
}

export interface NovedadAccesoBreakdown {
  total: number;
  personasCount: number;
  vehiculosCount: number;
  summaryText: string;
  records: NormalizedMandanteNovedad[];
}

export interface AccessControlRecord {
  id: string;
  employeeId: string;
  personName: string;
  siteId: string;
  siteName: string;
  type: 'ingreso' | 'salida';
  timestamp: string;
  localDate: string;
  detail: string;
  isManual: boolean;
  photoUrl?: string;
}

export interface CoverageDayItem {
  date: string;
  weekdayShort: string;
  dayLabel: string;
  covered: boolean;
}

export interface ServiceCoverageSummary {
  percentage: number;
  coveredDaysCount: number;
  totalDaysCount: number;
  weeklyDays: CoverageDayItem[];
  weeklyCoveredCount: number;
  weeklyPercentage: number;
}

/** Convierte Date / ISO / Timestamp Firestore a ISO string seguro */
export function toIsoStr(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? '' : val.toISOString();
  if (typeof val?.toDate === 'function') {
    const d = val.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : '';
  }
  if (typeof val?.seconds === 'number') {
    return new Date(val.seconds * 1000).toISOString();
  }
  return '';
}

/** Devuelve YYYY-MM-DD en hora local para un valor fecha/timestamp */
export function toLocalDateStr(val?: any): string {
  if (!val) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
    return val.trim();
  }
  const iso = toIsoStr(val);
  const d = iso ? new Date(iso) : val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Construye ventana de fechas inclusive en horario local */
export function getPeriodDateRange(period: MandantePeriod, now: Date = new Date()): DateRangeWindow {
  const endObj = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysCount = period === 'hoy' ? 1 : period === '7d' ? 7 : 30;

  const startObj = new Date(endObj);
  startObj.setDate(endObj.getDate() - (daysCount - 1));

  const prevEndObj = new Date(startObj);
  prevEndObj.setDate(startObj.getDate() - 1);

  const prevStartObj = new Date(prevEndObj);
  prevStartObj.setDate(prevEndObj.getDate() - (daysCount - 1));

  return {
    startDate: toLocalDateStr(startObj),
    endDate: toLocalDateStr(endObj),
    prevStartDate: toLocalDateStr(prevStartObj),
    prevEndDate: toLocalDateStr(prevEndObj),
    daysCount,
  };
}

/**
 * Determina si el Portal Mandante debe mostrar la vista completa con Rondas
 * o la vista ejecutiva de Solo Control de Acceso y Novedades.
 */
export function resolveIsRondasViewActive(params: {
  mandanteViewMode?: MandanteViewMode;
  selectedSiteId: string;
  allowedSites: Pick<Site, 'id' | 'rondasEnabled'>[];
}): boolean {
  const { mandanteViewMode = 'auto', selectedSiteId, allowedSites } = params;

  if (mandanteViewMode === 'sin_rondas') return false;
  if (mandanteViewMode === 'con_rondas') return true;

  // Modo automático: depende de la configuración `rondasEnabled` de la sucursal
  if (selectedSiteId && selectedSiteId !== 'all') {
    const selected = allowedSites.find((s) => String(s.id) === String(selectedSiteId));
    return Boolean(selected?.rondasEnabled);
  }

  return allowedSites.some((s) => Boolean(s.rondasEnabled));
}

/** Calcula duración de ronda en minutos (null si no está cerrada o es inválida) */
export function getRoundDurationMin(round: Pick<GuardRound, 'startTime' | 'endTime'>): number | null {
  const startIso = toIsoStr(round.startTime);
  const endIso = toIsoStr(round.endTime);
  if (!startIso || !endIso) return null;

  const diffMin = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
  if (!Number.isFinite(diffMin) || diffMin < 0) return null;
  return diffMin;
}

/** Indica si la ronda es elegible para el cálculo de duración promedio (≤ 25 min) */
export function isValidRoundForAvgDuration(round: Pick<GuardRound, 'startTime' | 'endTime'>): boolean {
  const dur = getRoundDurationMin(round);
  return dur !== null && dur >= 0 && dur <= MAX_VALID_ROUND_DURATION_MIN;
}

/**
 * Calcula la duración promedio de rondas excluyendo aquellas > 25 minutos
 * y las rondas inconclusas o con timestamps inválidos.
 */
export function calculateAverageRoundDuration(
  rounds: Pick<GuardRound, 'startTime' | 'endTime'>[],
): AverageDurationResult {
  let sumMin = 0;
  let validCount = 0;
  let excludedOver25Count = 0;

  for (const r of rounds) {
    const dur = getRoundDurationMin(r);
    if (dur === null) continue;
    if (dur <= MAX_VALID_ROUND_DURATION_MIN) {
      sumMin += dur;
      validCount++;
    } else {
      excludedOver25Count++;
    }
  }

  return {
    avgMin: validCount > 0 ? Math.round(sumMin / validCount) : null,
    validCount,
    excludedOver25Count,
  };
}

/** Calcula estadísticas por guardia aplicando la regla de duración ≤ 25 min */
export function computeGuardRoundStats(rounds: GuardRound[]): GuardRoundStat[] {
  const map: Record<
    string,
    {
      workerId: string;
      name: string;
      total: number;
      sinNovedad: number;
      conNovedad: number;
      validDurSum: number;
      validDurationRounds: number;
      excludedLongRounds: number;
      lastRound: string;
    }
  > = {};

  for (const r of rounds) {
    const key = r.workerId || r.workerName || 'sin_id';
    const startIso = toIsoStr(r.startTime);
    if (!map[key]) {
      map[key] = {
        workerId: key,
        name: r.workerName || 'Guardia',
        total: 0,
        sinNovedad: 0,
        conNovedad: 0,
        validDurSum: 0,
        validDurationRounds: 0,
        excludedLongRounds: 0,
        lastRound: startIso,
      };
    }

    const entry = map[key];
    entry.total++;
    if (r.result === 'SIN_NOVEDAD') entry.sinNovedad++;
    if (r.result === 'CON_NOVEDAD' || r.result === 'SOSPECHA') entry.conNovedad++;

    const dur = getRoundDurationMin(r);
    if (dur !== null) {
      if (dur <= MAX_VALID_ROUND_DURATION_MIN) {
        entry.validDurSum += dur;
        entry.validDurationRounds++;
      } else {
        entry.excludedLongRounds++;
      }
    }

    if (startIso > entry.lastRound) {
      entry.lastRound = startIso;
    }
  }

  return Object.values(map)
    .map((entry) => ({
      workerId: entry.workerId,
      name: entry.name,
      total: entry.total,
      sinNovedad: entry.sinNovedad,
      conNovedad: entry.conNovedad,
      avgDurationMin:
        entry.validDurationRounds > 0
          ? Math.round(entry.validDurSum / entry.validDurationRounds)
          : null,
      validDurationRounds: entry.validDurationRounds,
      excludedLongRounds: entry.excludedLongRounds,
      lastRound: entry.lastRound,
    }))
    .sort((a, b) => b.total - a.total);
}

const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Genera serie diaria de rondas entre startDate y endDate */
export function computeDailyRoundSeries(
  rounds: GuardRound[],
  startDate: string,
  endDate: string,
): DailySeriesPoint[] {
  const counts: Record<string, number> = {};
  for (const r of rounds) {
    const d = toLocalDateStr(r.startTime);
    if (d) counts[d] = (counts[d] || 0) + 1;
  }

  const series: DailySeriesPoint[] = [];
  const startParts = startDate.split('-').map(Number);
  const endParts = endDate.split('-').map(Number);
  const cur = new Date(startParts[0], startParts[1] - 1, startParts[2]);
  const end = new Date(endParts[0], endParts[1] - 1, endParts[2]);

  while (cur <= end) {
    const ds = toLocalDateStr(cur);
    series.push({
      date: ds,
      label: WEEKDAY_LABELS[cur.getDay()],
      shortDate: `${String(cur.getDate()).padStart(2, '0')}/${String(cur.getMonth() + 1).padStart(2, '0')}`,
      count: counts[ds] || 0,
    });
    cur.setDate(cur.getDate() + 1);
  }

  return series;
}

export function normalizeMandanteNovedad(raw: any, allowedSites: Site[]): NormalizedMandanteNovedad {
  const rawSid = raw.siteId ?? raw.sucursalId ?? '';
  let siteId = String(rawSid);
  const matchedSite = allowedSites.find((s) => String(s.id) === siteId);
  const siteName =
    raw.siteName ||
    raw.sucursalNombre ||
    raw.sucursalName ||
    matchedSite?.name ||
    'Instalación';

  const ts =
    toIsoStr(raw.fechaHoraDispositivo) ||
    toIsoStr(raw.timestamp) ||
    toIsoStr(raw.createdAt) ||
    toIsoStr(raw.creadoEn);

  const rawPrioridad = String(raw.prioridad || '').toLowerCase();
  const prioridad: NormalizedMandanteNovedad['prioridad'] =
    rawPrioridad === 'critica'
      ? 'critica'
      : rawPrioridad === 'alta'
      ? 'alta'
      : rawPrioridad === 'media'
      ? 'media'
      : raw.tipo === 'incidente' || raw.resultado === 'CON_NOVEDAD'
      ? 'alta'
      : raw.tipo === 'alerta'
      ? 'media'
      : 'informativa';

  const rawEstado = String(raw.estado || '').toLowerCase();
  let estadoTone: NormalizedMandanteNovedad['estadoTone'] = 'pendiente';
  let estadoLabel = 'Pendiente';
  if (rawEstado === 'resuelta' || rawEstado === 'resuelto') {
    estadoTone = 'resuelta';
    estadoLabel = 'Resuelta';
  } else if (rawEstado === 'en_revision' || rawEstado === 'en_seguimiento') {
    estadoTone = 'revision';
    estadoLabel = 'En revisión';
  }

  const evidencias: string[] = Array.isArray(raw.evidencias)
    ? raw.evidencias.filter((u: any) => typeof u === 'string' && u.length > 0)
    : typeof raw.evidenciaUrl === 'string' && raw.evidenciaUrl.length > 0
    ? [raw.evidenciaUrl]
    : Array.isArray(raw.fotos)
    ? raw.fotos.filter((u: any) => typeof u === 'string' && u.length > 0)
    : [];

  return {
    id: String(raw.id),
    siteId,
    siteName,
    tipo: String(raw.tipoRegistro || raw.tipo || 'novedad'),
    categoria: String(raw.categoria || 'otro'),
    prioridad,
    estadoTone,
    estadoLabel,
    descripcion: String(raw.descripcion || raw.detalles || 'Sin descripción registrada.'),
    ubicacionInstalacion: raw.ubicacionInstalacion ? String(raw.ubicacionInstalacion) : undefined,
    guardName: String(raw.autorNombre || raw.guardName || 'Personal en turno'),
    timestamp: ts,
    localDate: toLocalDateStr(raw.fechaOperacional || ts),
    evidencias,
    original: raw,
  };
}

export function computeNovedadesBreakdown(items: NormalizedMandanteNovedad[]): NovedadesBreakdown {
  let criticas = 0;
  let altas = 0;
  let medias = 0;
  let informativas = 0;
  let pendientes = 0;
  let resueltas = 0;

  for (const n of items) {
    if (n.prioridad === 'critica') criticas++;
    else if (n.prioridad === 'alta') altas++;
    else if (n.prioridad === 'media') medias++;
    else informativas++;

    if (n.estadoTone === 'resuelta') resueltas++;
    else pendientes++;
  }

  const parts: string[] = [];
  const graves = criticas + altas;
  if (criticas > 0) parts.push(`${criticas} crítica${criticas !== 1 ? 's' : ''}`);
  if (altas > 0) parts.push(`${altas} alta${altas !== 1 ? 's' : ''}`);
  if (medias > 0 && graves === 0) parts.push(`${medias} media${medias !== 1 ? 's' : ''}`);
  if (informativas > 0) parts.push(`${informativas} informativa${informativas !== 1 ? 's' : ''}`);

  return {
    total: items.length,
    criticas,
    altas,
    medias,
    informativas,
    pendientes,
    resueltas,
    summaryText:
      items.length === 0
        ? 'Sin novedades en el período'
        : parts.join(' · ') || `${items.length} registradas`,
  };
}

/** Filtra novedades correspondientes a registros de acceso de personas y vehículos */
export function filterAccesoNovedades(
  items: NormalizedMandanteNovedad[],
): NovedadAccesoBreakdown {
  const records = items.filter(
    (n) => n.categoria === 'acceso_personas' || n.categoria === 'acceso_vehiculos',
  );
  let personasCount = 0;
  let vehiculosCount = 0;
  for (const r of records) {
    if (r.categoria === 'acceso_personas') personasCount++;
    else if (r.categoria === 'acceso_vehiculos') vehiculosCount++;
  }

  return {
    total: records.length,
    personasCount,
    vehiculosCount,
    summaryText:
      records.length === 0
        ? 'Personas / Vehículos'
        : `${personasCount} persona${personasCount !== 1 ? 's' : ''} · ${vehiculosCount} vehículo${vehiculosCount !== 1 ? 's' : ''}`,
    records,
  };
}

/** Resuelve guardias actualmente en servicio (último log check_in abierto dentro de 24h) */
export function computeActiveGuards(params: {
  attendanceLogs: AttendanceLog[];
  allowedSites: Site[];
  selectedSiteId: string;
  roundsInPeriod: GuardRound[];
  employees?: Employee[];
  now?: Date;
}): ActiveGuardSummary[] {
  const { attendanceLogs, allowedSites, selectedSiteId, roundsInPeriod, employees, now = new Date() } = params;
  if (!attendanceLogs || attendanceLogs.length === 0) return [];

  const logsByUser: Record<string, AttendanceLog[]> = {};
  for (const log of attendanceLogs) {
    if (!log.employeeId) continue;
    if (!logsByUser[log.employeeId]) logsByUser[log.employeeId] = [];
    logsByUser[log.employeeId].push(log);
  }

  const cutoffMs = now.getTime() - 24 * 60 * 60 * 1000;
  const active: ActiveGuardSummary[] = [];

  for (const logs of Object.values(logsByUser)) {
    logs.sort((a, b) => new Date(toIsoStr(b.timestamp)).getTime() - new Date(toIsoStr(a.timestamp)).getTime());
    const latest = logs[0];
    const tsIso = toIsoStr(latest.timestamp);
    const tsMs = new Date(tsIso).getTime();

    const isOpenCheckIn =
      latest.type === 'check_in' &&
      latest.status !== 'completed' &&
      latest.estado !== 'CERRADO' &&
      Number.isFinite(tsMs) &&
      tsMs >= cutoffMs;

    if (!isOpenCheckIn) continue;

    let sid = latest.siteId != null ? String(latest.siteId) : '';
    if (!sid && latest.siteName) {
      const byName = allowedSites.find((s) => s.name === latest.siteName);
      if (byName) sid = String(byName.id);
    }
    if (!sid && employees) {
      const emp = employees.find((e) => e.id === latest.employeeId);
      if (emp?.currentSiteId != null) sid = String(emp.currentSiteId);
    }

    if (!sid) continue;
    const matchedSite = allowedSites.find((s) => String(s.id) === sid);
    if (!matchedSite) continue;

    if (selectedSiteId !== 'all' && sid !== selectedSiteId) continue;

    const roundsInPeriodCount = roundsInPeriod.filter(
      (r) =>
        (r.workerId === latest.employeeId || r.workerName === latest.employeeName) &&
        String(r.siteId) === sid,
    ).length;

    const isNight = latest.turnoProgramadoStatus === 'noche';
    const siteInicio = latest.turnoProgramadoInicio || matchedSite.horario?.inicio || DEFAULT_SITE_HORARIO.inicio;
    const siteTermino = latest.turnoProgramadoTermino || matchedSite.horario?.termino || DEFAULT_SITE_HORARIO.termino;
    const shiftRange = isNight ? `${siteTermino} - ${siteInicio}` : `${siteInicio} - ${siteTermino}`;

    active.push({
      id: latest.employeeId,
      name: latest.employeeName || 'Guardia de Seguridad',
      siteId: sid,
      siteName: matchedSite.name || latest.siteName || 'Instalación',
      checkInTime: new Date(tsIso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
      checkInIso: tsIso,
      shiftRange,
      roundsInPeriod: roundsInPeriodCount,
    });
  }

  return active.sort((a, b) => a.name.localeCompare(b.name));
}

/** Construye registros formales de Control de Acceso (Ingresos y Salidas de turno) */
export function buildAccessControlRecords(params: {
  attendanceLogs: AttendanceLog[];
  allowedSites: Site[];
  selectedSiteId: string;
  startDate: string;
  endDate: string;
}): AccessControlRecord[] {
  const { attendanceLogs, allowedSites, selectedSiteId, startDate, endDate } = params;
  const records: AccessControlRecord[] = [];

  for (const log of attendanceLogs) {
    const ts = toIsoStr(log.timestamp);
    if (!ts) continue;

    let sid = log.siteId != null ? String(log.siteId) : '';
    if (!sid && log.siteName) {
      const byName = allowedSites.find((s) => s.name === log.siteName);
      if (byName) sid = String(byName.id);
    }

    const matchedSite = allowedSites.find((s) => String(s.id) === sid);
    if (!matchedSite) continue;
    if (selectedSiteId !== 'all' && sid !== selectedSiteId) continue;

    const localDate = toLocalDateStr(ts);
    if (!localDate || localDate < startDate || localDate > endDate) continue;

    const isEntry = log.type === 'check_in';
    const siteInicio = log.turnoProgramadoInicio || matchedSite.horario?.inicio || DEFAULT_SITE_HORARIO.inicio;
    const siteTermino = log.turnoProgramadoTermino || matchedSite.horario?.termino || DEFAULT_SITE_HORARIO.termino;
    const isNight = log.turnoProgramadoStatus === 'noche';
    const shiftWindow = isNight ? `${siteTermino} - ${siteInicio}` : `${siteInicio} - ${siteTermino}`;

    let detail = '';
    if (isEntry) {
      detail = `Inicio de turno (${shiftWindow})${log.isManual ? ' · Registro manual' : ''}`;
    } else {
      const isAuto =
        log.tipoCierre === 'AUTOMATICO' ||
        log.tipoCierre === 'AUTOMATICO_POR_NUEVA_ENTRADA' ||
        log.detalle === 'cierre forzado';
      detail = isAuto ? 'Término de turno · Cierre automático' : 'Término de turno';
    }

    records.push({
      id: log.id,
      employeeId: log.employeeId,
      personName: log.employeeName || 'Guardia',
      siteId: sid,
      siteName: matchedSite.name || log.siteName || 'Instalación',
      type: isEntry ? 'ingreso' : 'salida',
      timestamp: ts,
      localDate,
      detail,
      isManual: Boolean(log.isManual),
      photoUrl: log.photoUrl,
    });
  }

  return records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** Calcula porcentaje de cobertura en el período seleccionado y la tira de últimos 7 días */
export function computeServiceCoverage(params: {
  accessRecords: AccessControlRecord[];
  allAllowedAccessLogs: AttendanceLog[];
  manualAttendances?: { siteId?: string | number; date?: string; status?: string }[];
  allowedSites: Site[];
  selectedSiteId: string;
  startDate: string;
  endDate: string;
  hasActiveGuardNow?: boolean;
  now?: Date;
}): ServiceCoverageSummary {
  const {
    accessRecords,
    allAllowedAccessLogs,
    manualAttendances = [],
    allowedSites,
    selectedSiteId,
    startDate,
    endDate,
    hasActiveGuardNow = false,
    now = new Date(),
  } = params;

  const allowedSet = new Set(allowedSites.map((s) => String(s.id)));
  const matchesSite = (sid: string) =>
    sid && allowedSet.has(sid) && (selectedSiteId === 'all' || sid === selectedSiteId);

  const coveredDatesSet = new Set<string>();
  if (hasActiveGuardNow) {
    coveredDatesSet.add(toLocalDateStr(now));
  }

  // 1. Días con registros de ingreso/salida en el rango general
  for (const rec of accessRecords) {
    if (rec.localDate) coveredDatesSet.add(rec.localDate);
  }
  for (const log of allAllowedAccessLogs) {
    let sid = log.siteId != null ? String(log.siteId) : '';
    if (!sid && log.siteName) {
      const byName = allowedSites.find((s) => s.name === log.siteName);
      if (byName) sid = String(byName.id);
    }
    if (!matchesSite(sid)) continue;
    const ld = toLocalDateStr(log.timestamp);
    if (ld) coveredDatesSet.add(ld);
    // Si tiene fechaTurno registrada (ej. turno nocturno), también marca esa fecha
    if ((log as any).localDate) coveredDatesSet.add(String((log as any).localDate));
  }

  // 2. Días con asistencia manual marcada como presente
  for (const m of manualAttendances) {
    if (m.status !== 'presente' || !m.date) continue;
    const sid = m.siteId != null ? String(m.siteId) : '';
    if (matchesSite(sid)) {
      coveredDatesSet.add(m.date);
    }
  }

  // Contar cobertura en [startDate .. endDate]
  const startParts = startDate.split('-').map(Number);
  const endParts = endDate.split('-').map(Number);
  const cur = new Date(startParts[0], startParts[1] - 1, startParts[2]);
  const end = new Date(endParts[0], endParts[1] - 1, endParts[2]);

  let totalDaysCount = 0;
  let coveredDaysCount = 0;
  while (cur <= end) {
    totalDaysCount++;
    const ds = toLocalDateStr(cur);
    if (coveredDatesSet.has(ds)) coveredDaysCount++;
    cur.setDate(cur.getDate() + 1);
  }

  const percentage = totalDaysCount > 0 ? Math.round((coveredDaysCount / totalDaysCount) * 100) : 0;

  // Tira fija de últimos 7 días (rolling ending today)
  const weeklyDays: CoverageDayItem[] = [];
  const todayBase = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let offset = 6; offset >= 0; offset--) {
    const d = new Date(todayBase);
    d.setDate(todayBase.getDate() - offset);
    const ds = toLocalDateStr(d);
    weeklyDays.push({
      date: ds,
      weekdayShort: WEEKDAY_LABELS[d.getDay()],
      dayLabel: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
      covered: coveredDatesSet.has(ds),
    });
  }

  const weeklyCoveredCount = weeklyDays.filter((d) => d.covered).length;
  const weeklyPercentage = Math.round((weeklyCoveredCount / 7) * 100);

  return {
    percentage,
    coveredDaysCount,
    totalDaysCount,
    weeklyDays,
    weeklyCoveredCount,
    weeklyPercentage,
  };
}
