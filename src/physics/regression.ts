// Pure least-squares math. No React, no DOM, no sensor code.

export type Point = { x: number; y: number };

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface LinearFit {
  m: number; // slope
  b: number; // intercept
  r2: number;
  n: number;
  /** Standard error of the slope (needs n ≥ 3). */
  seM?: number;
}

export interface QuadraticFit {
  A: number;
  B: number;
  C: number;
  r2: number;
  n: number;
  /** Standard error of A (needs n ≥ 4). g = |2A| so its uncertainty is 2·seA. */
  seA?: number;
}

const fail = <T>(reason: string): Result<T> => ({ ok: false, reason });

/** Keep only points whose coordinates are real, finite numbers. */
export function validPoints(points: Point[]): Point[] {
  return points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function distinctCount(values: number[]): number {
  // Treat values closer than 1 µ-unit as identical (duplicate times).
  const sorted = [...values].sort((a, b) => a - b);
  let count = 0;
  let last = -Infinity;
  for (const v of sorted) {
    if (v - last > 1e-9) count += 1;
    last = v;
  }
  return count;
}

/** Coefficient of determination. Returns 1 when the data are perfectly flat and perfectly fit. */
export function rSquared(points: Point[], predict: (x: number) => number): number {
  const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;
  let ssTot = 0;
  let ssRes = 0;
  for (const p of points) {
    ssTot += (p.y - meanY) ** 2;
    ssRes += (p.y - predict(p.x)) ** 2;
  }
  if (ssTot === 0) return ssRes < 1e-18 ? 1 : 0;
  return 1 - ssRes / ssTot;
}

export function linearFit(input: Point[]): Result<LinearFit> {
  const pts = validPoints(input);
  if (pts.length < 2) return fail('Need at least 2 valid points for a straight-line fit.');
  if (distinctCount(pts.map((p) => p.x)) < 2) return fail('The x-values are all the same, so a line cannot be fit.');
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const m = sxy / sxx;
  const b = my - m * mx;
  const r2 = rSquared(pts, (x) => m * x + b);
  if (![m, b, r2].every(Number.isFinite)) return fail('The fit did not produce finite numbers.');
  let seM: number | undefined;
  if (n >= 3) {
    const ssRes = pts.reduce((acc, p) => acc + (p.y - (m * p.x + b)) ** 2, 0);
    seM = Math.sqrt(ssRes / (n - 2) / sxx);
  }
  return { ok: true, value: { m, b, r2, n, seM: Number.isFinite(seM) ? seM : undefined } };
}

/** Solve a 3x3 system with partial pivoting. Returns null if singular. */
function solve3(M: number[][], v: number[]): number[] | null {
  const a = M.map((row, i) => [...row, v[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = col + 1; r < 3; r++) {
      const f = a[r][col] / a[col][col];
      for (let c = col; c < 4; c++) a[r][c] -= f * a[col][c];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = a[r][3];
    for (let c = r + 1; c < 3; c++) s -= a[r][c] * x[c];
    x[r] = s / a[r][r];
  }
  return x;
}

/** Least-squares fit of y = A·x² + B·x + C. Solved on centered/scaled x for numerical stability. */
export function quadraticFit(input: Point[]): Result<QuadraticFit> {
  const pts = validPoints(input);
  if (pts.length < 3) return fail('Need at least 3 valid gates for a quadratic fit.');
  if (distinctCount(pts.map((p) => p.x)) < 3) return fail('At least 3 gates need different times. Some times are duplicates.');
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const scale = Math.max(...pts.map((p) => Math.abs(p.x - mx))) || 1;
  // u = (x - mx) / scale; fit y = a u² + b u + c, then convert back to x.
  const S = [0, 0, 0, 0, 0];
  const T = [0, 0, 0];
  for (const p of pts) {
    const u = (p.x - mx) / scale;
    for (let k = 0; k <= 4; k++) S[k] += u ** k;
    for (let k = 0; k <= 2; k++) T[k] += p.y * u ** k;
  }
  const sol = solve3(
    [
      [S[4], S[3], S[2]],
      [S[3], S[2], S[1]],
      [S[2], S[1], S[0]],
    ],
    [T[2], T[1], T[0]],
  );
  if (!sol) return fail('The data are degenerate; a quadratic fit is not possible.');
  const [a, b, c] = sol;
  // y = a((x-mx)/s)² + b((x-mx)/s) + c
  const A = a / scale ** 2;
  const B = b / scale - (2 * a * mx) / scale ** 2;
  const C = (a * mx ** 2) / scale ** 2 - (b * mx) / scale + c;
  const r2 = rSquared(pts, (x) => A * x * x + B * x + C);
  if (![A, B, C, r2].every(Number.isFinite)) return fail('The fit did not produce finite numbers.');
  // Var(A) = σ² · [(XᵀX)⁻¹]₀₀ in the scaled variable u, divided by scale⁴ (A = a / scale²); σ² = SSres / (n − 3).
  let seA: number | undefined;
  if (n >= 4) {
    const col = solve3(
      [
        [S[4], S[3], S[2]],
        [S[3], S[2], S[1]],
        [S[2], S[1], S[0]],
      ],
      [1, 0, 0],
    );
    const ssRes = pts.reduce((acc, p) => acc + (p.y - (A * p.x * p.x + B * p.x + C)) ** 2, 0);
    if (col) seA = Math.sqrt(Math.max((ssRes / (n - 3)) * col[0], 0)) / scale ** 2;
  }
  return { ok: true, value: { A, B, C, r2, n, seA: seA !== undefined && Number.isFinite(seA) ? seA : undefined } };
}

export const evalQuadratic = (f: Pick<QuadraticFit, 'A' | 'B' | 'C'>, t: number) => f.A * t * t + f.B * t + f.C;
export const evalLinear = (f: Pick<LinearFit, 'm' | 'b'>, x: number) => f.m * x + f.b;
