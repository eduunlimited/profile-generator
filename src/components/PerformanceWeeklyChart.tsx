import type { WeeklyPerformancePoint } from "../lib/orderEmail";

const CHART_WIDTH = 720;
const CHART_HEIGHT = 110;
const PAD = { top: 14, right: 36, bottom: 22, left: 28 };
const BAR_GAP = 0.32;

function formatRate(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

interface PerformanceWeeklyChartProps {
  weeks: WeeklyPerformancePoint[];
  siteLabel: string;
}

export function PerformanceWeeklyChart({ weeks, siteLabel }: PerformanceWeeklyChartProps) {
  const plotWidth = CHART_WIDTH - PAD.left - PAD.right;
  const plotHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const maxCount = Math.max(1, ...weeks.map((week) => week.total));
  const barSlot = weeks.length > 0 ? plotWidth / weeks.length : plotWidth;
  const barWidth = Math.max(8, barSlot * (1 - BAR_GAP));

  const ratePoints = weeks
    .map((week, index) => {
      if (week.successRate == null) return null;
      const x = PAD.left + barSlot * index + barSlot / 2;
      const y = PAD.top + plotHeight * (1 - week.successRate);
      return { x, y, week };
    })
    .filter((point): point is { x: number; y: number; week: WeeklyPerformancePoint } => point != null);

  const linePath = ratePoints
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");

  const yTicks = [0, 0.5, 1].map((fraction) => ({
    fraction,
    y: PAD.top + plotHeight * (1 - fraction),
    count: Math.round(maxCount * fraction),
    rate: `${Math.round(fraction * 100)}%`,
  }));

  return (
    <section className="performance-weekly" aria-label={`${siteLabel} weekly order performance`}>
      <header className="performance-weekly-head">
        <div className="performance-weekly-title">
          <h3>Weekly volume</h3>
          <p className="muted">Succeeded vs cancelled · last {weeks.length} weeks</p>
        </div>
        <div className="performance-weekly-legend" aria-hidden="true">
          <span className="performance-weekly-swatch is-ok">Succeeded</span>
          <span className="performance-weekly-swatch is-cxl">Cancelled</span>
          <span className="performance-weekly-swatch is-rate">Success %</span>
        </div>
      </header>
      <div className="performance-weekly-chart">
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-hidden="true">
          {yTicks.map((tick) => (
            <g key={tick.fraction}>
              <line
                className="performance-weekly-grid"
                x1={PAD.left}
                x2={CHART_WIDTH - PAD.right}
                y1={tick.y}
                y2={tick.y}
              />
              <text className="performance-weekly-axis" x={PAD.left - 8} y={tick.y + 3} textAnchor="end">
                {tick.count}
              </text>
              <text className="performance-weekly-axis is-rate" x={CHART_WIDTH - PAD.right + 8} y={tick.y + 3}>
                {tick.rate}
              </text>
            </g>
          ))}

          {weeks.map((week, index) => {
            const x = PAD.left + barSlot * index + (barSlot - barWidth) / 2;
            const successHeight = (week.successful / maxCount) * plotHeight;
            const cancelHeight = (week.cancelled / maxCount) * plotHeight;
            const successY = PAD.top + plotHeight - successHeight;
            const cancelY = successY - cancelHeight;
            return (
              <g key={week.weekStartIso}>
                {week.cancelled > 0 ? (
                  <rect
                    className="performance-weekly-bar is-cxl"
                    x={x}
                    y={cancelY}
                    width={barWidth}
                    height={Math.max(cancelHeight, week.cancelled > 0 ? 1.5 : 0)}
                    rx={2}
                  >
                    <title>
                      {week.label}: {week.cancelled} cancelled
                    </title>
                  </rect>
                ) : null}
                {week.successful > 0 ? (
                  <rect
                    className="performance-weekly-bar is-ok"
                    x={x}
                    y={successY}
                    width={barWidth}
                    height={Math.max(successHeight, week.successful > 0 ? 1.5 : 0)}
                    rx={2}
                  >
                    <title>
                      {week.label}: {week.successful} succeeded
                    </title>
                  </rect>
                ) : null}
                {week.successRate != null ? (
                  <text
                    className="performance-weekly-rate-label"
                    x={x + barWidth / 2}
                    y={Math.max(PAD.top + 9, Math.min(cancelY, successY) - 6)}
                    textAnchor="middle"
                  >
                    {formatRate(week.successRate)}
                  </text>
                ) : null}
                <text
                  className="performance-weekly-tick"
                  x={x + barWidth / 2}
                  y={CHART_HEIGHT - 12}
                  textAnchor="middle"
                >
                  {week.label}
                </text>
              </g>
            );
          })}

          {linePath ? <path className="performance-weekly-line" d={linePath} /> : null}
          {ratePoints.map((point) => (
            <circle
              key={point.week.weekStartIso}
              className="performance-weekly-dot"
              cx={point.x}
              cy={point.y}
              r={2.5}
            >
              <title>
                {point.week.label}: {formatRate(point.week.successRate)} success
              </title>
            </circle>
          ))}
        </svg>
      </div>
    </section>
  );
}
