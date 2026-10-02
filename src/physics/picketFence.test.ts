import { describe, expect, it } from 'vitest';
import { analyzeFence, type FenceCapture } from './picketFence';

function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296); }
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());

/** A fence falling from speed v0 with acceleration g past one gate; flag k's leading edge crosses after falling k·P. */
function simulate(opts: { g?: number; v0?: number; pitch?: number; n?: number; jitterMs?: number; seed?: number; sign?: number }): FenceCapture {
  const { g = 9.81, v0 = 0.4, pitch = 0.05, n = 10, jitterMs = 0, seed = 1, sign = 1 } = opts;
  const r = rng(seed);
  // time for the leading edge of flag k to reach the gate: k·P = v0 t + ½ g t²
  const tk = (k: number) => (-v0 + Math.sqrt(v0 * v0 + 2 * g * k * pitch)) / g;
  const blocked = Array.from({ length: n }, (_, k) => 5 + tk(k) + (jitterMs / 1000) * gauss(r));
  // firmware velocity = 2 cm / pulse time = mean speed over the 2 cm = speed at the mid-time ≈ exact speed at the flag (to ~0.2 mm)
  const velocities = Array.from({ length: n }, (_, k) => sign * Math.sqrt(v0 * v0 + 2 * g * (k * pitch + 0.01)));
  return { pitch, blocked, velocities, accelerations: [] };
}
const ok = (c: FenceCapture) => {
  const r = analyzeFence(c);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

describe('analyzeFence', () => {
  it('recovers g from the firmware velocities alone, with no timing involved', () => {
    const rep = ok(simulate({ jitterMs: 25 })); // big Bluetooth jitter must not matter
    expect(rep.gFromVelocities).toBeCloseTo(9.81, 6);
    expect(rep.gFromVelocitiesSigma).toBeLessThan(1e-6);
  });
  it('works for a fence moving the other way (negative velocities)', () => {
    expect(ok(simulate({ sign: -1 })).gFromVelocities).toBeCloseTo(9.81, 6);
  });
  it('measures the Bluetooth jitter: interval error sd ≈ √2 × per-event jitter', () => {
    const sds: number[] = [];
    for (let seed = 1; seed <= 200; seed++) sds.push(ok(simulate({ jitterMs: 15, seed })).intervalErrorSdMs);
    const m = sds.reduce((a, b) => a + b, 0) / sds.length;
    expect(m).toBeGreaterThan(15 * 1.414 * 0.8);
    expect(m).toBeLessThan(15 * 1.414 * 1.2);
  });
  it('with perfect timing the interval errors are ~0 and browser-time g matches', () => {
    const rep = ok(simulate({}));
    expect(Math.abs(rep.intervalErrorMeanMs)).toBeLessThan(0.5);
    expect(rep.intervalErrorSdMs).toBeLessThan(0.5);
    expect(rep.gFromBrowserTimes).toBeCloseTo(9.81, 1);
  });
  it('shows how bad browser-time g is under jitter while velocity g stays right', () => {
    const rep = ok(simulate({ jitterMs: 30, seed: 3 }));
    expect(Math.abs((rep.gFromBrowserTimes ?? 0) - 9.81)).toBeGreaterThan(0.2);
    expect(rep.gFromVelocities).toBeCloseTo(9.81, 6);
  });
  it('reports the acceleration-channel value when present and explains missing data', () => {
    const c = simulate({});
    c.accelerations = [-9.7, -9.9];
    expect(ok(c).gFromAccelChannel).toBeCloseTo(9.8, 9);
    const bad = analyzeFence({ ...c, velocities: [1] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/Object Velocity|velocity/i);
    expect(analyzeFence({ ...c, pitch: NaN }).ok).toBe(false);
  });
});

describe('analyzeFence with gate timestamps AND receive times', () => {
  it('reports exact gate timing (≈0 error) next to the Bluetooth jitter of the receive times', () => {
    const exact = simulate({ jitterMs: 0 });
    const noisy = simulate({ jitterMs: 20, seed: 4 });
    const rep = ok({ ...exact, blockedReceive: noisy.blocked });
    expect(rep.intervalErrorSdMs).toBeLessThan(0.5); // gate timestamps
    expect(rep.receiveIntervalErrorSdMs).toBeGreaterThan(8); // Bluetooth
    expect(rep.gFromBrowserTimes).toBeCloseTo(9.81, 1);
    expect(Math.abs((rep.gFromReceiveTimes ?? 0) - 9.81)).toBeGreaterThan(0.2);
  });
});
