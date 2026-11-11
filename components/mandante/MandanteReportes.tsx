import React, { useMemo, useState } from 'react';
import { Activity, BarChart3, BookOpen, DoorOpen, Download, FileText } from 'lucide-react';
import type { AttendanceLog, GuardRound, Site } from '../../types';
import {
  buildAccessControlRecords,
  calculateAverageRoundDuration,
  computeGuardRoundStats,
  computeNovedadesBreakdown,
  computeServiceCoverage,
  filterAccesoNovedades,
  getPeriodDateRange,
  normalizeMandanteNovedad,
  toLocalDateStr,
  type AccessControlRecord,
  type MandantePeriod,
  type NormalizedMandanteNovedad,
} from '../../lib/mandante/mandanteMetricsService';
import { getMandanteCategoriaMeta } from './mandanteUiConstants';

interface MandanteReportesProps {
  allowedSites: Site[];
  guardRounds: GuardRound[];
  novedades: any[];
  attendanceLogs: AttendanceLog[];
  manualAttendances: any[];
  isRondasActive: boolean;
  initialPeriod?: MandantePeriod;
  initialSiteId?: string;
  showConfirmation: (cfg: any) => void;
}

const escapeHtml = (str: string) =>
  String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function generateMandantePDF(params: {
  tipo: 'resumen_ejecutivo' | 'detalle_cronologico';
  isRondasActive: boolean;
  rounds: GuardRound[];
  novedades: NormalizedMandanteNovedad[];
  accessRecords?: AccessControlRecord[];
  coveragePct: number;
  coveredDays: number;
  totalDays: number;
  siteName: string;
  startDate: string;
  endDate: string;
  onPopupBlocked: () => void;
}) {
  const {
    tipo,
    isRondasActive,
    rounds,
    novedades,
    coveragePct,
    coveredDays,
    totalDays,
    siteName,
    startDate,
    endDate,
    onPopupBlocked,
  } = params;

  const fD = (iso: string) =>
    new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fT = (iso: string) =>
    new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  const now = new Date().toLocaleString('es-CL');

  const gStats = isRondasActive ? computeGuardRoundStats(rounds) : [];
  const avgDuration = isRondasActive ? calculateAverageRoundDuration(rounds) : { avgMin: null, validCount: 0, excludedOver25Count: 0 };
  const totalConNovedad = rounds.filter((r) => r.result && r.result !== 'SIN_NOVEDAD').length;
  const novBreakdown = computeNovedadesBreakdown(novedades);
  const accesoBreakdown = filterAccesoNovedades(novedades);

  const timeline = [
    ...(isRondasActive
      ? rounds.map((r) => ({
          ts: r.startTime,
          kind: 'ronda' as const,
          guard: r.workerName || 'Guardia',
          site: r.siteName || 'Instalación',
          desc: r.notes || 'Ronda ejecutada sin observaciones.',
          res: r.result || 'COMPLETED',
          prioridad: '',
          categoria: '',
          estadoLabel: r.endTime ? 'Completada' : 'En curso',
        }))
      : []),
    ...novedades.map((n) => ({
      ts: n.timestamp,
      kind: 'novedad' as const,
      guard: n.guardName,
      site: n.siteName,
      desc: n.descripcion,
      res: n.prioridad,
      prioridad: n.prioridad,
      categoria: n.categoria,
      estadoLabel: '',
    })),
  ].sort((a, b) => b.ts.localeCompare(a.ts));

  const novBadgeClass = (p: string) => {
    if (p === 'critica') return 'nov-crit';
    if (p === 'alta') return 'nov-alta';
    if (p === 'media') return 'nov-media';
    return 'nov-info';
  };
  const novLabel = (p: string) => {
    if (p === 'critica') return 'CRÍTICA';
    if (p === 'alta') return 'ALTA';
    if (p === 'media') return 'MEDIA';
    return 'INFORMATIVA';
  };

  const css = `@page{size:A4;margin:18mm 14mm}*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;color:#1e293b}.hdr{background:#0f172a;color:#fff;padding:18px 22px;border-radius:8px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-start}.hdr h1{font-size:18px;font-weight:900}.hdr p{font-size:10px;opacity:.8;margin-top:3px}.hdr .meta{text-align:right;font-size:10px;opacity:.85;line-height:1.55}.stitle{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:#475569;border-bottom:2px solid #e2e8f0;padding-bottom:5px;margin:18px 0 10px}.sg{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}.sb{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}.sb .n{font-size:20px;font-weight:900;color:#0f172a;line-height:1.1}.sb .l{font-size:9px;font-weight:700;text-transform:uppercase;color:#64748b;margin-top:4px}.sb.g .n{color:#059669}.sb.r .n{color:#dc2626}.sb.b .n{color:#2563eb}.sb.o .n{color:#d97706}table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:12px}th{background:#f1f5f9;font-weight:800;text-transform:uppercase;font-size:9px;color:#475569;padding:8px 10px;text-align:left}td{padding:7px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top}tr:nth-child(even) td{background:#fafafa}.badge{display:inline-block;padding:2px 6px;border-radius:4px;font-size:8px;font-weight:800;text-transform:uppercase}.sin{background:#dcfce7;color:#15803d}.con{background:#fee2e2;color:#dc2626}.sos{background:#fef3c7;color:#b45309}.rnd{background:#dbeafe;color:#1d4ed8}.nov-info{background:#e0f2fe;color:#0369a1}.nov-media{background:#fef3c7;color:#b45309}.nov-alta{background:#ffedd5;color:#c2410c}.nov-crit{background:#fee2e2;color:#b91c1c}.ti{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9}.td{width:88px;font-weight:700;color:#64748b;font-size:9px;flex-shrink:0}.dot{width:8px;height:8px;border-radius:50%;background:#3b82f6;margin-top:4px;flex-shrink:0}.dot.r{background:#ef4444}.dot.g{background:#10b981}.dot.a{background:#f59e0b}.note{font-size:9px;color:#64748b;margin-top:4px}.ftr{margin-top:24px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;

  let body = '';
  if (tipo === 'resumen_ejecutivo') {
    if (isRondasActive) {
      const avgTxt = avgDuration.avgMin !== null ? `${avgDuration.avgMin} min` : '—';
      body = `
        <div class="sg">
          <div class="sb b"><div class="n">${rounds.length}</div><div class="l">Rondas Realizadas</div></div>
          <div class="sb"><div class="n">${avgTxt}</div><div class="l">Dur. Promedio</div></div>
          <div class="sb g"><div class="n">${rounds.length - totalConNovedad}</div><div class="l">Rondas Sin Novedad</div></div>
          <div class="sb r"><div class="n">${novBreakdown.total}</div><div class="l">Novedades (${novBreakdown.criticas + novBreakdown.altas} relev.)</div></div>
        </div>
        <div class="stitle">Rendimiento por Guardia</div>
        <table>
          <thead><tr><th>Guardia</th><th style="text-align:center">Rondas</th><th style="text-align:center">Sin Nov.</th><th style="text-align:center">Con Nov.</th><th style="text-align:center">Prom. Duración</th></tr></thead>
          <tbody>
            ${
              gStats
                .map(
                  (g) =>
                    `<tr><td><strong>${escapeHtml(g.name)}</strong></td><td style="text-align:center"><strong>${g.total}</strong></td><td style="text-align:center"><span class="badge sin">${g.sinNovedad}</span></td><td style="text-align:center"><span class="badge con">${g.conNovedad}</span></td><td style="text-align:center">${g.avgDurationMin != null ? `${g.avgDurationMin} min` : '—'}</td></tr>`,
                )
                .join('') || '<tr><td colspan="5" style="text-align:center;color:#94a3b8">Sin rondas en el período</td></tr>'
            }
          </tbody>
        </table>
      `;
    } else {
      body = `
        <div class="sg">
          <div class="sb g"><div class="n">${coveragePct}%</div><div class="l">Cobertura (${coveredDays}/${totalDays} días)</div></div>
          <div class="sb b"><div class="n">${accesoBreakdown.total}</div><div class="l">Registros de Acceso</div></div>
          <div class="sb"><div class="n">${accesoBreakdown.personasCount} / ${accesoBreakdown.vehiculosCount}</div><div class="l">Personas / Vehículos</div></div>
          <div class="sb r"><div class="n">${novBreakdown.total}</div><div class="l">Novedades (${novBreakdown.criticas + novBreakdown.altas} relev.)</div></div>
        </div>
        <div class="stitle">Registros de Acceso · Personas y Vehículos (${accesoBreakdown.records.length})</div>
        <table>
          <thead><tr><th>Fecha / Hora</th><th>Categoría</th><th>Instalación</th><th>Guardia</th><th>Detalle</th></tr></thead>
          <tbody>
            ${
              accesoBreakdown.records
                .slice(0, 30)
                .map((n) => {
                  const cat = getMandanteCategoriaMeta(n.categoria);
                  return `<tr><td>${fD(n.timestamp)} ${fT(n.timestamp)}</td><td>${cat.icon} <strong>${escapeHtml(cat.label)}</strong></td><td>${escapeHtml(n.siteName)}</td><td>${escapeHtml(n.guardName)}</td><td>${escapeHtml(n.descripcion.substring(0, 140))}</td></tr>`;
                })
                .join('') || '<tr><td colspan="5" style="text-align:center;color:#94a3b8">Sin registros de acceso de personas o vehículos en el período</td></tr>'
            }
          </tbody>
        </table>
      `;
    }

    body += `
      <div class="stitle" style="margin-top:20px">Novedades del Período (${novedades.length})</div>
      <table>
        <thead><tr><th>Fecha / Hora</th><th>Guardia</th><th>Instalación</th><th>Categoría / Prioridad</th><th>Descripción</th></tr></thead>
        <tbody>
          ${
            novedades
              .slice(0, 40)
              .map((n) => {
                const cat = getMandanteCategoriaMeta(n.categoria);
                return `<tr><td>${fD(n.timestamp)} ${fT(n.timestamp)}</td><td>${escapeHtml(n.guardName)}</td><td>${escapeHtml(n.siteName)}</td><td>${cat.icon} <span class="badge ${novBadgeClass(n.prioridad)}">${novLabel(n.prioridad)}</span></td><td>${escapeHtml(n.descripcion.substring(0, 140))}</td></tr>`;
              })
              .join('') || '<tr><td colspan="5" style="text-align:center;color:#94a3b8">Sin novedades registradas en el período</td></tr>'
          }
        </tbody>
      </table>
    `;
  } else {
    body = `<div class="stitle">Registro Cronológico (${timeline.length} eventos)</div>
      ${
        timeline
          .map((item) => {
            if (item.kind === 'ronda') {
              const dotC = item.res === 'SIN_NOVEDAD' ? 'g' : item.res === 'CON_NOVEDAD' ? 'r' : 'a';
              return `<div class="ti"><div class="td">${fD(item.ts)}<br/>${fT(item.ts)}</div><div class="dot ${dotC}"></div><div style="flex:1"><div style="display:flex;gap:6px;align-items:center;margin-bottom:2px"><span class="badge rnd">RONDA</span><strong>${escapeHtml(item.guard)}</strong><span style="color:#64748b;font-size:9px">· ${escapeHtml(item.site)}</span><span class="badge ${item.res === 'SIN_NOVEDAD' ? 'sin' : item.res === 'CON_NOVEDAD' ? 'con' : 'sos'}">${escapeHtml(String(item.res).replace(/_/g, ' '))}</span></div><div style="color:#475569">${escapeHtml(item.desc)}</div></div></div>`;
            }
            const cat = getMandanteCategoriaMeta(item.categoria);
            const dotC = item.prioridad === 'critica' ? 'r' : item.prioridad === 'alta' || item.prioridad === 'media' ? 'a' : 'b';
            return `<div class="ti"><div class="td">${fD(item.ts)}<br/>${fT(item.ts)}</div><div class="dot ${dotC}"></div><div style="flex:1"><div style="display:flex;gap:6px;align-items:center;margin-bottom:2px"><span>${cat.icon}</span><span class="badge ${novBadgeClass(item.prioridad)}">${novLabel(item.prioridad)}</span><strong>${escapeHtml(item.guard)}</strong><span style="color:#64748b;font-size:9px">· ${escapeHtml(item.site)}</span></div><div style="color:#475569">${escapeHtml(item.desc)}</div></div></div>`;
          })
          .join('') || '<p style="color:#94a3b8;padding:12px 0">Sin registros en el período seleccionado.</p>'
      }`;
  }

  const subtitleText = isRondasActive
    ? 'Resumen Ejecutivo de Rondas y Novedades'
    : 'Resumen Ejecutivo de Accesos, Cobertura y Novedades';

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Reporte ASPRO - ${escapeHtml(siteName)}</title><style>${css}</style></head><body><div class="hdr"><div><h1>ASPRO · REPORTE DEL SERVICIO</h1><p>${tipo === 'resumen_ejecutivo' ? subtitleText : 'Registro Cronológico del Servicio'}</p><p style="margin-top:6px;font-size:11px;opacity:.95">${escapeHtml(siteName)}</p></div><div class="meta"><div>Período: ${fD(startDate + 'T12:00:00')} — ${fD(endDate + 'T12:00:00')}</div><div>Emitido: ${now}</div><div>Eventos incluidos: ${timeline.length}</div></div></div>${body}<div class="ftr"><span>ASPRO Seguridad · Portal Mandante</span><span>Documento informativo generado automáticamente · ${now}</span></div></body></html>`;

  const win = window.open('', '_blank', 'width=920,height=720');
  if (!win) {
    onPopupBlocked();
    return;
  }
  win.document.write(html);
  win.document.close();
  win.document.title = `Reporte ASPRO - ${siteName}`;
  setTimeout(() => win.print(), 600);
}

export const MandanteReportes: React.FC<MandanteReportesProps> = ({
  allowedSites,
  guardRounds,
  novedades,
  attendanceLogs,
  manualAttendances,
  isRondasActive,
  initialPeriod = '7d',
  initialSiteId = 'all',
  showConfirmation,
}) => {
  const defaultRange = useMemo(() => getPeriodDateRange(initialPeriod), [initialPeriod]);
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [tipoReporte, setTipoReporte] = useState<'resumen_ejecutivo' | 'detalle_cronologico'>('resumen_ejecutivo');
  const [siteFilter, setSiteFilter] = useState(initialSiteId);

  const filteredRounds = useMemo(() => {
    if (!isRondasActive) return [];
    return guardRounds.filter((r) => {
      const inSite = allowedSites.some((s) => String(s.id) === String(r.siteId));
      const siteMatch = siteFilter === 'all' || String(r.siteId) === siteFilter;
      const d = toLocalDateStr(r.startTime);
      return inSite && siteMatch && d >= startDate && d <= endDate;
    });
  }, [isRondasActive, guardRounds, allowedSites, siteFilter, startDate, endDate]);

  const filteredNovedades = useMemo(() => {
    return novedades
      .filter((raw) => {
        const sid = String(raw.siteId ?? raw.sucursalId ?? '');
        const inSite = allowedSites.some((s) => String(s.id) === sid);
        const siteMatch = siteFilter === 'all' || sid === siteFilter;
        const ts = raw.fechaHoraDispositivo || raw.timestamp || raw.createdAt;
        const d = toLocalDateStr(ts);
        return inSite && siteMatch && d >= startDate && d <= endDate;
      })
      .map((raw) => normalizeMandanteNovedad(raw, allowedSites))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [novedades, allowedSites, siteFilter, startDate, endDate]);

  const filteredAccess = useMemo(
    () =>
      buildAccessControlRecords({
        attendanceLogs,
        allowedSites,
        selectedSiteId: siteFilter,
        startDate,
        endDate,
      }),
    [attendanceLogs, allowedSites, siteFilter, startDate, endDate],
  );

  const coverage = useMemo(
    () =>
      computeServiceCoverage({
        accessRecords: filteredAccess,
        allAllowedAccessLogs: attendanceLogs,
        manualAttendances,
        allowedSites,
        selectedSiteId: siteFilter,
        startDate,
        endDate,
      }),
    [filteredAccess, attendanceLogs, manualAttendances, allowedSites, siteFilter, startDate, endDate],
  );

  const accesoBreakdown = useMemo(
    () => filterAccesoNovedades(filteredNovedades),
    [filteredNovedades],
  );

  const siteName =
    siteFilter === 'all'
      ? 'Todas mis instalaciones'
      : allowedSites.find((s) => String(s.id) === siteFilter)?.name || 'Instalación';

  const hasData = isRondasActive
    ? filteredRounds.length > 0 || filteredNovedades.length > 0
    : filteredNovedades.length > 0 || coverage.coveredDaysCount > 0;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-black text-slate-900 tracking-tight">Reportes Ejecutivos</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          Generación y descarga de informes consolidados en formato PDF
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 max-w-2xl space-y-5">
        <div className="flex items-center gap-2 font-bold text-slate-800 text-sm">
          <FileText size={16} className="text-blue-600" />
          <span>Parámetros del Informe</span>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
              Instalación
            </label>
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="all">Todas mis instalaciones</option>
              {allowedSites.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                Desde
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                Hasta
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
              Formato del Reporte
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  id: 'resumen_ejecutivo' as const,
                  label: 'Resumen Ejecutivo',
                  icon: <BarChart3 size={18} />,
                  desc: isRondasActive
                    ? 'Indicadores de rondas, desempeño por guardia y novedades.'
                    : 'Cobertura del servicio, accesos de personas/vehículos y novedades.',
                },
                {
                  id: 'detalle_cronologico' as const,
                  label: isRondasActive ? 'Bitácora de Rondas y Novedades' : 'Bitácora de Accesos y Novedades',
                  icon: isRondasActive ? <BookOpen size={18} /> : <DoorOpen size={18} />,
                  desc: isRondasActive
                    ? 'Línea cronológica detallada de rondas y novedades del período.'
                    : 'Línea cronológica de accesos de personas/vehículos y novedades.',
                },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTipoReporte(opt.id)}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    tipoReporte === opt.id
                      ? 'border-blue-600 bg-blue-50/70'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div
                    className={`mb-2 ${
                      tipoReporte === opt.id ? 'text-blue-600' : 'text-slate-400'
                    }`}
                  >
                    {opt.icon}
                  </div>
                  <p
                    className={`text-sm font-bold ${
                      tipoReporte === opt.id ? 'text-blue-900' : 'text-slate-800'
                    }`}
                  >
                    {opt.label}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center gap-3 text-xs text-slate-600">
          <Activity size={15} className="text-blue-500 shrink-0" />
          <span>
            {isRondasActive ? (
              <>
                Se incluirán <strong>{filteredRounds.length} rondas</strong> y{' '}
                <strong>{filteredNovedades.length} novedades</strong>.
              </>
            ) : (
              <>
                Se incluirán <strong>{accesoBreakdown.total} registros de acceso</strong> (
                {accesoBreakdown.personasCount} pers. · {accesoBreakdown.vehiculosCount} veh.), cobertura{' '}
                <strong>{coverage.percentage}%</strong> y{' '}
                <strong>{filteredNovedades.length} novedades</strong>.
              </>
            )}
          </span>
        </div>

        <div className="pt-4 border-t border-slate-100 space-y-2.5">
          <button
            type="button"
            disabled={!hasData}
            onClick={() =>
              generateMandantePDF({
                tipo: tipoReporte,
                isRondasActive,
                rounds: filteredRounds,
                novedades: filteredNovedades,
                coveragePct: coverage.percentage,
                coveredDays: coverage.coveredDaysCount,
                totalDays: coverage.totalDaysCount,
                siteName,
                startDate,
                endDate,
                onPopupBlocked: () =>
                  showConfirmation({
                    title: 'Ventana emergente bloqueada',
                    message:
                      'Permite las ventanas emergentes en tu navegador para generar e imprimir el reporte PDF.',
                    type: 'alert',
                    onConfirm: () => {},
                  }),
              })
            }
            className="w-full flex items-center justify-center gap-2.5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm transition-all shadow-sm"
          >
            <Download size={17} />
            Generar y Descargar PDF
          </button>
          <p className="text-center text-xs text-slate-400">
            Se abrirá la vista de impresión — seleccione &ldquo;Guardar como PDF&rdquo;.
          </p>
        </div>
      </div>
    </div>
  );
};

export default MandanteReportes;

