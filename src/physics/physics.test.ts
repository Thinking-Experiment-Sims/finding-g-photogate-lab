import { describe, expect, it } from 'vitest';
import { evalQuadratic, linearFit, quadraticFit, rSquared } from './regression';
import {
  fitPosition,
  linearizationValid,
  linearizedFit,
  percentDifference,
  quadraticAcceleration,
  quadraticVelocity,
  tangentOnFit,
  transformData,
  velocityFit,
} from './kinematics';

const known = [0, 0.1, 0.2, 0.3, 0.45].map((t) => ({ x: t, y: 1 + 2 * t + 5 * t * t })); // y(t) = 1 + 2t + 5t² (points are {x: t, y})

function ok<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(r.reason);
  return r.value;
}

describe('quadraticFit', () => {
  it('recovers A=5, B=2, C=1 from y(t) = 1 + 2t + 5t²', () => {
    const f = ok(quadraticFit(known));
    expect(f.A).toBeCloseTo(5, 9);
    expect(f.B).toBeCloseTo(2, 9);
    expect(f.C).toBeCloseTo(1, 9);
    expect(f.r2).toBeCloseTo(1, 12);
    expect(quadraticVelocity(f, 0.2)).toBeCloseTo(10 * 0.2 + 2, 9);
    expect(quadraticAcceleration(f)).toBeCloseTo(10, 9);
  });

  it('works with exactly 3 points', () => {
    const f = ok(quadraticFit(known.slice(0, 3)));
    expect(f.A).toBeCloseTo(5, 9);
  });

  it('is stable for large offsets in time', () => {
    const pts = [1000, 1000.1, 1000.2, 1000.35].map((t) => ({ x: t, y: 0.5 * 9.81 * (t - 1000) ** 2 }));
    expect(ok(quadraticFit(pts)).A).toBeCloseTo(4.905, 6);
  });

  it('gives a sensible, high-R² fit for noisy data', () => {
    const noise = [0.004, -0.003, 0.002, -0.004, 0.003, -0.002];
    const pts = [0, 0.08, 0.16, 0.24, 0.32, 0.4].map((t, i) => ({ x: t, y: 0.3 + 1.5 * t + 4.9 * t * t + noise[i] }));
    const f = ok(quadraticFit(pts));
    expect(f.A).toBeGreaterThan(4);
    expect(f.A).toBeLessThan(6);
    expect(f.r2).toBeGreaterThan(0.999);
    expect(f.r2).toBeLessThan(1);
  });

  it('fails clearly with insufficient data', () => {
    expect(quadraticFit(known.slice(0, 2)).ok).toBe(false);
    expect(quadraticFit([]).ok).toBe(false);
  });

  it('fails with duplicate times', () => {
    const r = quadraticFit([
      { x: 0.1, y: 1 },
      { x: 0.1, y: 1.2 },
      { x: 0.2, y: 2 },
    ]);
    expect(r.ok).toBe(false);
  });

  it('ignores NaN / Infinity / missing values and never returns them', () => {
    const r = quadraticFit([...known, { x: NaN, y: 3 }, { x: 0.5, y: Infinity }]);
    const f = ok(r);
    expect(f.n).toBe(known.length);
    expect(Number.isFinite(f.A + f.B + f.C + f.r2)).toBe(true);
    expect(quadraticFit([{ x: NaN, y: 1 }, { x: 1, y: NaN }, { x: 2, y: 2 }]).ok).toBe(false);
  });
});

describe('linearFit', () => {
  it('recovers slope and intercept', () => {
    const f = ok(linearFit([0, 1, 2, 3].map((x) => ({ x, y: 3 * x + 2 }))));
    expect(f.m).toBeCloseTo(3, 12);
    expect(f.b).toBeCloseTo(2, 12);
    expect(f.r2).toBeCloseTo(1, 12);
  });
  it('rejects too few points and identical x values', () => {
    expect(linearFit([{ x: 1, y: 1 }]).ok).toBe(false);
    expect(linearFit([{ x: 1, y: 1 }, { x: 1, y: 2 }]).ok).toBe(false);
  });
  it('handles perfectly flat data without NaN', () => {
    const f = ok(linearFit([0, 1, 2].map((x) => ({ x, y: 4 }))));
    expect(f.m).toBeCloseTo(0, 12);
    expect(f.r2).toBe(1);
  });
});

describe('rSquared / evalQuadratic', () => {
  it('is 0 for the mean-only model', () => {
    const pts = [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }];
    expect(rSquared(pts, () => 2)).toBeCloseTo(0, 12);
  });
  it('evaluates A t² + B t + C', () => {
    expect(evalQuadratic({ A: 5, B: 2, C: 1 }, 2)).toBe(25);
  });
});

describe('tangents', () => {
  const fit = ok(quadraticFit(known));
  it('tangent on the fitted curve has slope 2At + B', () => {
    const tg = tangentOnFit(fit, 0.25);
    expect(tg.slope).toBeCloseTo(10 * 0.25 + 2, 6);
    expect(tg.y).toBeCloseTo(evalQuadratic(fit, 0.25), 9);
  });
  it('velocity-vs-time line fit slope is the acceleration', () => {
    const fit = ok(quadraticFit(known));
    const f = ok(velocityFit([0.03, 0.11, 0.17, 0.26, 0.39].map((t) => ({ t, v: tangentOnFit(fit, t).slope }))));
    expect(f.m).toBeCloseTo(10, 5);
    expect(f.b).toBeCloseTo(2, 5);
  });
});

describe('linearization', () => {
  // Object is already moving at the first gate (v₀ = 2 m/s), as in a real drop.
  const data = [0, 0.1, 0.2, 0.3, 0.4].map((t) => ({ t, y: 0.5 + 2 * t + 4.905 * t * t }));
  it('Δy/Δt vs t is linear with slope a/2 and intercept v₀', () => {
    const f = ok(linearizedFit(data, 't', 'dy_over_t'));
    expect(f.m).toBeCloseTo(4.905, 9);
    expect(f.b).toBeCloseTo(2, 9);
    expect(f.dropped).toBe(1); // the t = 0 reference gate
  });
  it('y vs t² is NOT perfectly linear when v₀ ≠ 0, but is when v₀ = 0', () => {
    expect(ok(linearizedFit(data, 't2', 'y')).r2).toBeLessThan(0.9999);
    const fromRest = [0, 0.1, 0.2, 0.3].map((t) => ({ t, y: 0.5 + 4.905 * t * t }));
    const f = ok(linearizedFit(fromRest, 't2', 'y'));
    expect(f.r2).toBeCloseTo(1, 12);
    expect(f.m).toBeCloseTo(4.905, 9);
  });
  it('referenced to the first gate regardless of row order', () => {
    const shuffled = [data[3], data[0], data[4], data[2], data[1]];
    expect(transformData(shuffled, 't', 'dy').points).toHaveLength(5);
    expect(ok(linearizedFit(shuffled, 't', 'dy_over_t')).m).toBeCloseTo(4.905, 9);
  });
  it('returns empty / failure instead of NaN for bad data', () => {
    expect(transformData([], 't', 'y').points).toEqual([]);
    expect(linearizedFit([{ t: 0, y: 1 }], 't', 'dy_over_t').ok).toBe(false);
  });
});

describe('helpers', () => {
  it('percentDifference compares magnitudes to 9.81', () => {
    expect(percentDifference(9.81)).toBeCloseTo(0, 12);
    expect(percentDifference(-9.81)).toBeCloseTo(0, 12);
    expect(percentDifference(10.791)).toBeCloseTo(10, 9);
  });
  it('fitPosition maps (t, x) pairs', () => {
    expect(ok(fitPosition(known.map((p) => ({ t: p.x, y: p.y })))).A).toBeCloseTo(5, 9);
  });
});

describe('all three methods on falling heights (up-positive, a ≈ −g)', () => {
  // Released from rest at 1.30 m; gates at descending heights; g = 9.81, no noise.
  const g = 9.81;
  const gates = [1.18, 1.04, 0.86, 0.64, 0.38];
  const fall = (h: number) => Math.sqrt((2 * (1.3 - h)) / g);
  const t1 = fall(gates[0]);
  const data = gates.map((h) => ({ t: fall(h) - t1, y: h }));

  it('quadratic fit: a = 2A = −g', () => {
    const f = ok(fitPosition(data));
    expect(quadraticAcceleration(f)).toBeCloseTo(-g, 6);
    expect(f.B).toBeLessThan(0); // moving down at gate 1
  });
  it('tangents on the fit at arbitrary times (not at data points) give slope −g, equal to 2A by construction', () => {
    const f = ok(fitPosition(data));
    const v = [0.02, 0.07, 0.13, 0.2, 0.25].map((t) => ({ t, v: tangentOnFit(f, t).slope }));
    expect(ok(velocityFit(v)).m).toBeCloseTo(quadraticAcceleration(f), 5);
  });
  it('linearization Δy/Δt vs t has slope a/2 = −g/2', () => {
    const f = ok(linearizedFit(data, 't', 'dy_over_t'));
    expect(2 * f.m).toBeCloseTo(-g, 6);
    expect(f.r2).toBeCloseTo(1, 9);
  });
  it('y vs t² is visibly not linear because the object is moving at gate 1', () => {
    expect(ok(linearizedFit(data, 't2', 'y')).r2).toBeLessThan(0.999);
  });
});

describe('linearization validity (decided by physics, not R²)', () => {
  const g = 9.81;
  const build = (release: number, gates: number[]) => {
    const T = gates.map((h) => Math.sqrt((2 * (release - h)) / g));
    return gates.map((h, i) => ({ t: T[i] - T[0], y: h }));
  };
  // Released at 1.30 m, first gate only 2 cm below: the object is already moving at gate 1.
  const nearRelease = build(1.3, [1.28, 1.1, 0.9, 0.6, 0.3]);

  it('rejects y vs t² when v₀ ≠ 0 even though R² looks great (0.995, g would be 12.8)', () => {
    const f = ok(linearizedFit(nearRelease, 't2', 'y'));
    expect(f.r2).toBeGreaterThan(0.99); // the trap: looks straight
    expect(Math.abs(2 * f.m)).toBeGreaterThan(12); // …and gives the wrong g
    expect(linearizationValid(nearRelease, 't2', 'y')).toBe(false);
    expect(linearizationValid(nearRelease, 't2', 'dy')).toBe(false);
  });
  it('accepts Δy/Δt vs t on the same data and recovers g', () => {
    expect(linearizationValid(nearRelease, 't', 'dy_over_t')).toBe(true);
    expect(Math.abs(2 * ok(linearizedFit(nearRelease, 't', 'dy_over_t')).m)).toBeCloseTo(g, 6);
  });
  it('accepts y vs t² when the object really starts from rest at gate 1', () => {
    const fromRest = [0, 0.1, 0.2, 0.3, 0.4].map((t) => ({ t, y: 1.2 - 0.5 * g * t * t }));
    expect(linearizationValid(fromRest, 't2', 'y')).toBe(true);
    expect(Math.abs(2 * ok(linearizedFit(fromRest, 't2', 'y')).m)).toBeCloseTo(g, 6);
  });
  it('never validates other pairs or too little data', () => {
    expect(linearizationValid(nearRelease, 't', 'y')).toBe(false);
    expect(linearizationValid(nearRelease, 'sqrt_t', 'dy')).toBe(false);
    expect(linearizationValid(nearRelease.slice(0, 2), 't2', 'y')).toBe(false);
  });
});

describe('standard errors', () => {
  it('quadratic seA is ~0 for exact data and matches a hand-checked noisy case', () => {
    expect(ok(quadraticFit(known)).seA).toBeLessThan(1e-8);
    // y = t² + noise on 5 equally spaced points; SE computed independently from (XᵀX)⁻¹ with n−3 = 2 dof.
    const t = [-2, -1, 0, 1, 2];
    const noise = [0.1, -0.1, 0.05, -0.05, 0.08];
    const pts = t.map((x, i) => ({ x, y: x * x + noise[i] }));
    const f = ok(quadraticFit(pts));
    // closed form for symmetric x: Var(A) = σ² / (Σx⁴ − (Σx²)²/n)
    const res = pts.map((p) => p.y - (f.A * p.x * p.x + f.B * p.x + f.C));
    const sigma2 = res.reduce((a, r) => a + r * r, 0) / 2;
    const expected = Math.sqrt(sigma2 / (34 - (10 * 10) / 5));
    expect(f.seA).toBeCloseTo(expected, 8);
  });
  it('is undefined (not NaN) when there are too few points', () => {
    expect(ok(quadraticFit(known.slice(0, 3))).seA).toBeUndefined();
    expect(ok(linearFit([{ x: 0, y: 0 }, { x: 1, y: 1 }])).seM).toBeUndefined();
  });
  it('linear seM matches the closed form', () => {
    const pts = [0, 1, 2, 3, 4].map((x, i) => ({ x, y: 2 * x + [0.1, -0.2, 0.15, -0.05, 0.1][i] }));
    const f = ok(linearFit(pts));
    const res = pts.map((p) => p.y - (f.m * p.x + f.b));
    expect(f.seM).toBeCloseTo(Math.sqrt(res.reduce((a, r) => a + r * r, 0) / 3 / 10), 10);
  });
});
