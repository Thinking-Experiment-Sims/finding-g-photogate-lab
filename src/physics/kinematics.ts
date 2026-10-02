import { evalQuadratic, linearFit, quadraticFit, type LinearFit, type Point, type QuadraticFit, type Result } from './regression';

export const STANDARD_G = 9.81; // m/s², reference value for comparison only

/** v(t) = 2At + B for y(t) = At² + Bt + C. Shown to students only after they have found slopes themselves. */
export const quadraticVelocity = (f: QuadraticFit, t: number) => 2 * f.A * t + f.B;

/** a = 2A */
export const quadraticAcceleration = (f: QuadraticFit) => 2 * f.A;

export interface Tangent {
  t: number;
  y: number;
  slope: number; // m/s
}

/**
 * Tangent to the fitted position curve at time t. Tangents are only ever taken on the fitted curve, never on data points. The slope is measured as a very small
 * symmetric secant (x(t+h) − x(t−h)) / 2h, i.e. literally the slope of a line, not a formula lookup.
 */
export function tangentOnFit(fit: QuadraticFit, t: number, h = 1e-4): Tangent {
  const slope = (evalQuadratic(fit, t + h) - evalQuadratic(fit, t - h)) / (2 * h);
  return { t, y: evalQuadratic(fit, t), slope };
}

/** Linear fit of velocity points: slope = acceleration. */
export function velocityFit(points: { t: number; v: number }[]): Result<LinearFit> {
  return linearFit(points.map((p) => ({ x: p.t, y: p.v })));
}

// ---------- Linearization ----------

export type XTransform = 't' | 't2' | 'sqrt_t';
export type YTransform = 'y' | 'dy' | 'dy_over_t';

export const X_TRANSFORMS: { id: XTransform; label: string; axis: string }[] = [
  { id: 't', label: 't', axis: 'Time, t (s)' },
  { id: 't2', label: 't²', axis: 't² (s²)' },
  { id: 'sqrt_t', label: '√t', axis: '√t (s^½)' },
];

export const Y_TRANSFORMS: { id: YTransform; label: string; axis: string }[] = [
  { id: 'y', label: 'height y', axis: 'Height, y (m)' },
  { id: 'dy', label: 'change in height Δy = y − y₁', axis: 'Δy (m)' },
  { id: 'dy_over_t', label: 'average velocity Δy / Δt', axis: 'Δy / Δt (m/s)' },
];

/**
 * Transform (t, y) data. t is measured from the first gate (t₁ = 0), so Δt = t − t₁ and Δy = y − y₁,
 * where gate 1 is whichever gate fired first. Points where the transform is undefined
 * (Δt = 0 for Δy/Δt) are dropped and counted.
 */
export function transformData(
  data: { t: number; y: number }[],
  xT: XTransform,
  yT: YTransform,
): { points: Point[]; dropped: number } {
  const valid = data.filter((d) => Number.isFinite(d.t) && Number.isFinite(d.y));
  if (valid.length === 0) return { points: [], dropped: 0 };
  const first = valid.reduce((a, b) => (b.t < a.t ? b : a));
  const points: Point[] = [];
  let dropped = 0;
  for (const d of valid) {
    const dt = d.t - first.t;
    const dy = d.y - first.y;
    let px: number;
    if (xT === 't') px = dt;
    else if (xT === 't2') px = dt * dt;
    else px = dt >= 0 ? Math.sqrt(dt) : NaN;
    let py: number;
    if (yT === 'y') py = d.y;
    else if (yT === 'dy') py = dy;
    else py = dt > 1e-9 ? dy / dt : NaN;
    if (Number.isFinite(px) && Number.isFinite(py)) points.push({ x: px, y: py });
    else dropped += 1;
  }
  return { points, dropped };
}

export function linearizedFit(
  data: { t: number; y: number }[],
  xT: XTransform,
  yT: YTransform,
): Result<LinearFit & { dropped: number; points: Point[] }> {
  const { points, dropped } = transformData(data, xT, yT);
  const fit = linearFit(points);
  if (!fit.ok) return fit;
  return { ok: true, value: { ...fit.value, dropped, points } };
}

/**
 * Is a straight-line fit on this (x, y) pair actually a valid way to get a = 2 × slope?
 * Decided from the physics, never from R² (a nearly-straight y vs t² graph is a trap when v₀ ≠ 0):
 *  - Δy/Δt vs t is always valid (slope a/2, intercept v₀).
 *  - y or Δy vs t² is valid only when v₀·t is negligible next to the total change in height,
 *    i.e. the object was (nearly) at rest at the first gate. Tolerance: v₀·t_max ≤ 3 % of |Δy_total|.
 */
export const REST_TOLERANCE = 0.03;
export function linearizationValid(data: { t: number; y: number }[], xT: XTransform, yT: YTransform): boolean {
  if (xT === 't' && yT === 'dy_over_t') return true;
  if (xT === 't2' && (yT === 'y' || yT === 'dy')) {
    const fit = fitPosition(data);
    if (!fit.ok) return false;
    const sorted = [...data].filter((d) => Number.isFinite(d.t) && Number.isFinite(d.y)).sort((a, b) => a.t - b.t);
    const tMax = sorted[sorted.length - 1].t - sorted[0].t;
    const total = Math.abs(sorted[sorted.length - 1].y - sorted[0].y);
    return total > 1e-9 && Math.abs(fit.value.B) * tMax <= REST_TOLERANCE * total;
  }
  return false;
}

/** Compare |a| with standard g, as a percent difference. Heights are up-positive, so a ≈ −g: compare magnitudes. */
export const percentDifference = (measured: number, reference = STANDARD_G) =>
  (Math.abs(Math.abs(measured) - reference) / reference) * 100;

/** Convenience: fit y(t) from (time, height) pairs. */
export function fitPosition(data: { t: number; y: number }[]): Result<QuadraticFit> {
  return quadraticFit(data.map((d) => ({ x: d.t, y: d.y })));
}
