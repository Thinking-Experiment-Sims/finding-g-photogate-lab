import { useId } from 'react';
import { niceTicks, tickLabel } from '../format';

export interface XY {
  x: number;
  y: number;
}
export interface Dots {
  points: XY[];
  color?: string;
  r?: number;
  label?: string;
}
export interface Line {
  points: XY[];
  color?: string;
  width?: number;
  dashed?: boolean;
}

interface Props {
  xLabel: string;
  yLabel: string;
  dots?: Dots[];
  lines?: Line[];
  /** Always include these x or y values in the domain (e.g. 0). */
  includeX?: number[];
  includeY?: number[];
  ariaLabel: string;
  /** Short caption drawn in the top-left of the plot (e.g. the fit equation). */
  note?: string;
  /** Use for narrow columns. */
  compact?: boolean;
}

const FULL = { W: 760, H: 460, M: { l: 84, r: 24, t: 22, b: 66 } };
// Side-column charts use a smaller viewBox so text is not scaled down below ~12px.
const COMPACT = { W: 500, H: 380, M: { l: 72, r: 16, t: 18, b: 58 } };

function domain(values: number[], include: number[] = []): [number, number] {
  const all = [...values, ...include].filter(Number.isFinite);
  if (all.length === 0) return [0, 1];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-9) {
    lo -= 0.5;
    hi += 0.5;
  }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

/** Hand-rolled SVG scatter/line chart. Colors come from CSS variables so the brand palette is defined once. */
export function Chart({ xLabel, yLabel, dots = [], lines = [], includeX, includeY, ariaLabel, note, compact }: Props) {
  const { W, H, M } = compact ? COMPACT : FULL;
  const clipId = useId();
  const xs = [...dots, ...lines].flatMap((s) => s.points.map((p) => p.x));
  const ys = [...dots, ...lines].flatMap((s) => s.points.map((p) => p.y));
  const [x0, x1] = domain(xs, includeX);
  const [y0, y1] = domain(ys, includeY);
  const sx = (x: number) => M.l + ((x - x0) / (x1 - x0)) * (W - M.l - M.r);
  const sy = (y: number) => H - M.b - ((y - y0) / (y1 - y0)) * (H - M.t - M.b);
  const xt = niceTicks(x0, x1, 7);
  const yt = niceTicks(y0, y1, 6);
  const path = (pts: XY[]) =>
    pts
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
      .join(' ');

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
      <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} className="chart-plot" />
      {xt.map((v) => (
        <g key={`x${v}`}>
          <line x1={sx(v)} x2={sx(v)} y1={M.t} y2={H - M.b} className="chart-grid" />
          <text x={sx(v)} y={H - M.b + 22} textAnchor="middle" className="chart-tick">
            {tickLabel(v, x1 - x0)}
          </text>
        </g>
      ))}
      {yt.map((v) => (
        <g key={`y${v}`}>
          <line x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} className="chart-grid" />
          <text x={M.l - 10} y={sy(v) + 5} textAnchor="end" className="chart-tick">
            {tickLabel(v, y1 - y0)}
          </text>
        </g>
      ))}
      {x0 < 0 && x1 > 0 && <line x1={sx(0)} x2={sx(0)} y1={M.t} y2={H - M.b} className="chart-axis" />}
      {y0 < 0 && y1 > 0 && <line x1={M.l} x2={W - M.r} y1={sy(0)} y2={sy(0)} className="chart-axis" />}
      <text x={(M.l + W - M.r) / 2} y={H - 12} textAnchor="middle" className="chart-label">
        {xLabel}
      </text>
      <text transform={`translate(20 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle" className="chart-label">
        {yLabel}
      </text>
      <clipPath id={clipId}>
        <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        {lines.map((l, i) => (
          <path
            key={i}
            d={path(l.points)}
            fill="none"
            stroke={l.color ?? 'var(--teal-dark)'}
            strokeWidth={l.width ?? 3}
            strokeDasharray={l.dashed ? '8 6' : undefined}
            strokeLinecap="round"
          />
        ))}
      </g>
      {dots.map((d, i) =>
        d.points
          .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
          .map((p, j) => (
            <circle key={`${i}-${j}`} cx={sx(p.x)} cy={sy(p.y)} r={d.r ?? 7} fill={d.color ?? 'var(--teal)'} stroke="#fff" strokeWidth={2} />
          )),
      )}
      {note && (
        <text x={M.l + 14} y={M.t + 26} className="chart-note">
          {note}
        </text>
      )}
    </svg>
  );
}

/** Sample a function densely for drawing a smooth curve. */
export function sampleCurve(f: (x: number) => number, from: number, to: number, n = 80): XY[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = from + ((to - from) * i) / n;
    return { x, y: f(x) };
  });
}
