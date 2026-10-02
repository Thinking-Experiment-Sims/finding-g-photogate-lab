import { linearFit, quadraticFit, type Result } from './regression';

/** What one drop of a picket fence through ONE photogate produced. */
export interface FenceCapture {
  /** Distance between the leading edges of successive flags, meters. */
  pitch: number;
  /** Time (s) of each blocked event on Gate 1, one per flag: the gate's own timestamps when available, else browser time. */
  blocked: number[];
  /** The same events by the browser's receive time (s), when recorded separately, to show how much Bluetooth adds. */
  blockedReceive?: number[];
  /** Firmware-timed Object Velocity values (m/s), one per flag, in order. Sign depends on fence direction. */
  velocities: number[];
  /** Firmware Object Acceleration values (m/s²), if the channel delivered any. */
  accelerations: number[];
  /** Distance between the photogate's two internal beams, meters (Vernier: 2.0 cm). */
  gateSpacing?: number;
}

export interface FenceReport {
  flags: number;
  blockedCount: number;
  velocityCount: number;
  /** g from the firmware velocities alone: slope of v² against distance fallen (no timing at all). */
  gFromVelocities: number;
  gFromVelocitiesSigma?: number;
  /** g from the firmware's own Object Acceleration channel (mean magnitude), if present. */
  gFromAccelChannel?: number;
  /** g from a quadratic fit of distance vs the `blocked` times: what the lab's time-based path gives with this fence. */
  gFromBrowserTimes?: number;
  /** Interval error per flag gap: measured − firmware-derived (ms). */
  intervalErrorMs: number[];
  intervalErrorMeanMs: number;
  /** Standard deviation of the interval error (ms) for the `blocked` times. */
  intervalErrorSdMs: number;
  /** Same measures for the browser-receive times, if provided: this is the Bluetooth jitter. */
  receiveIntervalErrorMeanMs?: number;
  receiveIntervalErrorSdMs?: number;
  gFromReceiveTimes?: number;
}

const fail = (reason: string): Result<FenceReport> => ({ ok: false, reason });
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

/**
 * Uses the firmware velocities as ground truth, assuming constant acceleration a:
 *   v_k² = c + 2a·(k·P)   with P = flag spacing  →  g from the slope, with no timing at all.
 * Each blocked event happens when flag k reaches Gate 1 (fall distance k·P), but its velocity is the average over the
 * 2 cm between the beams, i.e. the speed about half a gate spacing LOWER. That offset is removed before the true
 * event times t_k = (V_k − V_0)/a, V_k = √(c − 2a·δ + 2a·k·P), are compared with the app's browser times.
 */
export function analyzeFence(c: FenceCapture): Result<FenceReport> {
  if (!(c.pitch > 0) || !Number.isFinite(c.pitch)) return fail('Enter the flag spacing (distance between the leading edges of successive flags).');
  const v = c.velocities.map(Math.abs).filter((x) => Number.isFinite(x) && x > 0);
  const flags = Math.min(c.blocked.length, v.length);
  if (v.length < 3) return fail(`Only ${v.length} velocity value(s) arrived; need at least 3 flags. The Object Velocity channel may not be enabled or may be mutually exclusive with the gate-state channels (see the channel list).`);

  const delta = (c.gateSpacing ?? 0.02) / 2;
  const fit = linearFit(v.map((x, k) => ({ x: k * c.pitch, y: x * x })));
  if (!fit.ok) return fail(fit.reason);
  const a = fit.value.m / 2;
  const gFromVelocities = a;
  const gFromVelocitiesSigma = fit.value.seM !== undefined ? fit.value.seM / 2 : undefined;

  // Model speed when flag k reaches Gate 1, then the true time each flag arrives (t_0 = 0).
  const speedAtGate1 = (k: number) => Math.sqrt(Math.max(fit.value.b - 2 * a * delta + 2 * a * k * c.pitch, 0));
  const trueTime = (k: number) => (speedAtGate1(k) - speedAtGate1(0)) / a;
  const trueGaps: number[] = [];
  for (let k = 0; k + 1 < v.length; k++) trueGaps.push(trueTime(k + 1) - trueTime(k));

  const gaps = (times: number[]) => {
    const errs: number[] = [];
    for (let k = 0; k + 1 < Math.min(times.length, v.length); k++) errs.push((times[k + 1] - times[k] - trueGaps[k]) * 1000);
    return errs;
  };
  const quadG = (times: number[]) => {
    if (times.length < 4) return undefined;
    const q = quadraticFit(times.map((t, k) => ({ x: t - times[0], y: k * c.pitch })));
    return q.ok ? Math.abs(2 * q.value.A) : undefined;
  };
  const errors = flags >= 2 ? gaps(c.blocked) : [];
  const gFromBrowserTimes = quadG(c.blocked);
  const recvErrors = c.blockedReceive && c.blockedReceive.length >= 2 ? gaps(c.blockedReceive) : [];
  const acc = c.accelerations.map(Math.abs).filter(Number.isFinite);

  return {
    ok: true,
    value: {
      flags: v.length,
      blockedCount: c.blocked.length,
      velocityCount: v.length,
      gFromVelocities,
      gFromVelocitiesSigma,
      gFromAccelChannel: acc.length ? mean(acc) : undefined,
      gFromBrowserTimes,
      intervalErrorMs: errors,
      intervalErrorMeanMs: errors.length ? mean(errors) : 0,
      intervalErrorSdMs: sd(errors),
      receiveIntervalErrorMeanMs: recvErrors.length ? mean(recvErrors) : undefined,
      receiveIntervalErrorSdMs: recvErrors.length ? sd(recvErrors) : undefined,
      gFromReceiveTimes: c.blockedReceive ? quadG(c.blockedReceive) : undefined,
    },
  };
}
