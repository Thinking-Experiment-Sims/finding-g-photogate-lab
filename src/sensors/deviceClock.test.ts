import { describe, expect, it } from 'vitest';
import { DeviceClock } from './deviceClock';

// A simple Bluetooth model (an ASSUMPTION, not a measurement): each packet arrives after 8–60 ms of latency.
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

/** One device sampled every `period` s starting at browser time `start`; returns browser-time arrival of each sample. */
function simulate(start: number, period: number, n: number, rand: () => number) {
  return Array.from({ length: n }, (_, k) => start + k * period + 0.008 + 0.052 * rand());
}

describe('DeviceClock', () => {
  it('recovers a device start time and event times far better than receive time', () => {
    const rand = rng(7);
    const period = 0.01;
    let errReceive = 0;
    let errDevice = 0;
    const trials = 200;
    for (let trial = 0; trial < trials; trial++) {
      // two devices that started at unrelated moments; the object crosses gate A at tA and gate B at tB (browser time)
      const startA = 10 + 0.3 * rand();
      const startB = 10 + 0.3 * rand();
      const tA = 12.0;
      const tB = 12.08; // true interval: 80 ms
      const arrA = simulate(startA, period, 400, rand);
      const arrB = simulate(startB, period, 400, rand);
      const clockA = new DeviceClock();
      const clockB = new DeviceClock();
      let eventA = 0;
      let eventB = 0;
      let recvA = 0;
      let recvB = 0;
      for (let k = 0; k < 400; k++) {
        const a = clockA.observe(k, period, arrA[k]);
        const b = clockB.observe(k, period, arrB[k]);
        // first sample at or after the crossing is where each device sees the beam blocked
        if (!eventA && startA + k * period >= tA) { eventA = a; recvA = arrA[k]; }
        if (!eventB && startB + k * period >= tB) { eventB = b; recvB = arrB[k]; }
      }
      errReceive += Math.abs(recvB - recvA - (tB - tA));
      errDevice += Math.abs(eventB - eventA - (tB - tA));
    }
    // Under this model the device clock cuts the interval error by more than half (the rest is 10 ms quantization + best-case latency spread).
    expect(errDevice / trials).toBeLessThan(0.5 * (errReceive / trials));
    expect(errDevice / trials).toBeLessThan(0.015);
  });

  it('converges to the true device offset for a single device', () => {
    const rand = rng(3);
    const c = new DeviceClock();
    const arr = simulate(5, 0.01, 300, rand);
    let t = 0;
    for (let k = 0; k < 300; k++) t = c.observe(k, 0.01, arr[k]);
    expect(Math.abs(t - (5 + 299 * 0.01))).toBeLessThan(0.02); // within the 8–60 ms latency floor
  });

  it('resets on a measurement restart', () => {
    const c = new DeviceClock();
    c.observe(100, 0.01, 50);
    c.reset();
    expect(c.observe(0, 0.01, 70)).toBeCloseTo(70, 9);
  });
});
