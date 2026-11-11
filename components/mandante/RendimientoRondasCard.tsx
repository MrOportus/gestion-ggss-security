import React, { useMemo, useState } from 'react';
import { Award, BarChart3, Clock, Users } from 'lucide-react';
import type { DailySeriesPoint, GuardRoundStat } from '../../lib/mandante/mandanteMetricsService';

interface RendimientoRondasCardProps {
  series: DailySeriesPoint[];
  guardStats: GuardRoundStat[];
  periodLabel: string;
}

const fmtDateShort = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }) : '—';
const fmtTimeShort = (iso: string) =>
  iso ? new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '—';

export const RendimientoRondasCard: React.FC<RendimientoRondasCardProps> = ({
  series,
  guardStats,
  periodLabel,
}) => {
  const [tab, setTab] = useState<'tendencia' | 'guardias'>('tendencia');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const totalSeriesRounds = useMemo(
    () => series.reduce((sum, p) => sum + p.count, 0),
    [series],
  );
  const dailyAvg = useMemo(() => {
    if (series.length === 0) return 0;
    return Number((totalSeriesRounds / series.length).toFixed(1));
  }, [series, totalSeriesRounds]);

  // Geometría del gráfico SVG
  const chart = useMemo(() => {
    const W = 520;
    const H = 178;
    const padL = 34;
    const padR = 16;
    const padT = 18;
    const padB = 28;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    const rawMax = Math.max(0, ...series.map((s) => s.count));
    const maxY = rawMax <= 4 ? 4 : Math.ceil((rawMax * 1.2) / 4) * 4;

    const pts = series.map((item, i) => {
      const x =
        series.length <= 1 ? padL + innerW / 2 : padL + (i / (series.length - 1)) * innerW;
      const y = padT + innerH - (item.count / maxY) * innerH;
      return { x, y, ...item };
    });

    let linePath = '';
    if (pts.length === 1) {
      linePath = `M ${pts[0].x} ${pts[0].y}`;
    } else if (pts.length > 1) {
      linePath = `M ${pts[0].x} ${pts[0].y}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i];
        const p1 = pts[i + 1];
        const cx = (p0.x + p1.x) / 2;
        linePath += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
      }
    }

    const baseY = padT + innerH;
    const areaPath =
      pts.length > 1
        ? `${linePath} L ${pts[pts.length - 1].x} ${baseY} L ${pts[0].x} ${baseY} Z`
        : '';

    const yTicks = [0, Math.round(maxY / 2), maxY];
    return { W, H, padL, padR, padT, padB, innerW, innerH, maxY, pts, linePath, areaPath, yTicks };
  }, [series]);

  const hoveredPoint = hoveredIdx !== null ? chart.pts[hoveredIdx] : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <BarChart3 size={16} />
          </div>
          <div>
            <h4 className="font-bold text-slate-800 text-sm leading-tight">
              Rendimiento de Rondas
            </h4>
            <p className="text-[11px] text-slate-400 font-medium">{periodLabel}</p>
          </div>
        </div>

        <div className="inline-flex items-center bg-slate-100 p-0.5 rounded-xl">
          <button
            type="button"
            onClick={() => setTab('tendencia')}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
              tab === 'tendencia'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Tendencia
          </button>
          <button
            type="button"
            onClick={() => setTab('guardias')}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
              tab === 'guardias'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Por Guardia ({guardStats.length})
          </button>
        </div>
      </div>

      {/* Body */}
      {tab === 'tendencia' ? (
        <div className="p-5 flex-1 flex flex-col sm:flex-row items-stretch gap-5">
          {/* Chart */}
          <div className="flex-1 min-w-0 relative">
            <svg
              viewBox={`0 0 ${chart.W} ${chart.H}`}
              className="w-full h-44 overflow-visible select-none"
              role="img"
              aria-label="Gráfico de tendencia diaria de rondas"
            >
              <defs>
                <linearGradient id="mandanteRoundsAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity="0.24" />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity="0.01" />
                </linearGradient>
              </defs>

              {/* Grid horizontal */}
              {chart.yTicks.map((tick) => {
                const y = chart.padT + chart.innerH - (tick / chart.maxY) * chart.innerH;
                return (
                  <g key={tick}>
                    <line
                      x1={chart.padL}
                      x2={chart.W - chart.padR}
                      y1={y}
                      y2={y}
                      stroke="#e2e8f0"
                      strokeDasharray={tick === 0 ? undefined : '3 3'}
                      strokeWidth={1}
                    />
                    <text
                      x={chart.padL - 8}
                      y={y + 3}
                      textAnchor="end"
                      className="fill-slate-400 text-[10px] font-semibold"
                    >
                      {tick}
                    </text>
                  </g>
                );
              })}

              {/* Area + Line */}
              {chart.areaPath && (
                <path d={chart.areaPath} fill="url(#mandanteRoundsAreaGrad)" />
              )}
              {chart.linePath && (
                <path
                  d={chart.linePath}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                />
              )}

              {/* Data points + X axis labels */}
              {chart.pts.map((pt, idx) => {
                const showLabel =
                  series.length <= 10 || idx === 0 || idx === series.length - 1 || idx % 5 === 0;
                const isHovered = hoveredIdx === idx;
                return (
                  <g key={pt.date}>
                    {showLabel && (
                      <text
                        x={pt.x}
                        y={chart.H - 6}
                        textAnchor="middle"
                        className="fill-slate-400 text-[10px] font-semibold"
                      >
                        {series.length <= 10 ? pt.label : pt.shortDate}
                      </text>
                    )}

                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isHovered ? 5.5 : 3.5}
                      fill={isHovered ? '#1d4ed8' : '#2563eb'}
                      stroke="#ffffff"
                      strokeWidth={2}
                      className="transition-all cursor-pointer"
                    />
                    {/* Hitbox más amplia */}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={14}
                      fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                    />
                  </g>
                );
              })}
            </svg>

            {hoveredPoint && (
              <div className="mt-1 text-[11px] font-semibold text-slate-600 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-600" />
                <span>
                  {hoveredPoint.label} {hoveredPoint.shortDate}:{' '}
                  <strong className="text-slate-900">{hoveredPoint.count}</strong> ronda
                  {hoveredPoint.count !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>

          {/* Summary boxes */}
          <div className="sm:w-44 grid grid-cols-2 sm:grid-cols-1 gap-3 shrink-0">
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200/70 flex items-center justify-center shrink-0">
                <BarChart3 size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500 truncate">Total serie</p>
                <p className="text-xl font-black text-slate-900 leading-tight">
                  {totalSeriesRounds}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 border border-blue-200/70 flex items-center justify-center shrink-0">
                <Clock size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-500 truncate">Promedio diario</p>
                <p className="text-xl font-black text-slate-900 leading-tight">{dailyAvg}</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          {guardStats.length === 0 ? (
            <div className="p-10 text-center text-slate-400">
              <Users size={30} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-semibold">Sin rondas registradas en el período</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                    <th className="text-left px-4 py-2.5">Guardia</th>
                    <th className="text-center px-3 py-2.5">Rondas</th>
                    <th className="text-center px-3 py-2.5">
                      Dur. Prom.
                    </th>
                    <th className="text-center px-3 py-2.5">Sin Nov.</th>
                    <th className="text-center px-3 py-2.5">Con Nov.</th>
                    <th className="text-left px-4 py-2.5">Última Ronda</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {guardStats.map((g, idx) => (
                    <tr key={g.workerId} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-800 text-xs sm:text-sm">
                            {g.name}
                          </span>
                          {idx === 0 && (
                            <span title="Mayor actividad en rondas">
                              <Award size={13} className="text-amber-500" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center font-black text-slate-800">
                        {g.total}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {g.avgDurationMin != null ? (
                          <span className="inline-flex items-center gap-1 text-slate-700 font-semibold text-xs">
                            <Clock size={11} className="text-slate-400" />
                            {g.avgDurationMin} min
                          </span>
                        ) : (
                          <span
                            className="text-slate-400 text-xs"
                            title={
                              g.excludedLongRounds > 0
                                ? 'Sin promedio disponible para este período'
                                : 'Sin rondas completadas'
                            }
                          >
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center font-bold text-emerald-600 text-xs">
                        {g.sinNovedad}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`font-bold text-xs ${
                            g.conNovedad > 0 ? 'text-rose-600' : 'text-slate-300'
                          }`}
                        >
                          {g.conNovedad}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                        {fmtDateShort(g.lastRound)} · {fmtTimeShort(g.lastRound)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RendimientoRondasCard;

