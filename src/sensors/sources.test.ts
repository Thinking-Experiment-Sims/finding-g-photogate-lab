import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIM_G, SIM_RELEASE_HEIGHT, SimulatedPhotogateSource, simulatedArrivalTime } from './SimulatedPhotogateSource';
import type { SourceEvent } from './types';

const noNoise = () => 0.5; // Box–Muller with u=0.5: cos(π) → -1 × sqrt(-2 ln .5) — small, deterministic

describe('SimulatedPhotogateSource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('arrival time follows free fall from the release height (within timing noise)', () => {
    const h = 0.64;
    const expected = Math.sqrt((2 * (SIM_RELEASE_HEIGHT - h)) / SIM_G);
    expect(Math.abs(simulatedArrivalTime(h, noNoise) - expected)).toBeLessThan(0.005);
  });

  it('does nothing unless armed', () => {
    const s = new SimulatedPhotogateSource();
    const events: SourceEvent[] = [];
    s.subscribe((e) => events.push(e));
    expect(s.drop()).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(events).toEqual([]);
  });

  it('never leaves a beam stuck "blocked" when disarmed right after a gate fires', () => {
    const s = new SimulatedPhotogateSource();
    const blocked: string[] = [];
    s.subscribe((e) => e.type === 'blocked' && blocked.push(e.gateId));
    s.arm();
    expect(s.drop()).toBe(true);
    vi.advanceTimersByTime(200); // gate 1 fires at ≈156 ms; its beam is blocked for 150 ms
    expect(blocked).toHaveLength(1);
    expect(s.gates()[0].beam).toBe('blocked');
    s.disarm(); // the app disarms as soon as the last gate fires — simulate that mid-flash
    vi.advanceTimersByTime(2000);
    expect(blocked).toHaveLength(1); // later gates never fire after disarm
    expect(s.gates().every((g) => g.beam === 'clear')).toBe(true); // …and nothing is stuck blocked
  });

  it('restarting (arming again) discards the unfinished drop\'s pending gate events', () => {
    const s = new SimulatedPhotogateSource();
    const blocked: string[] = [];
    s.subscribe((e) => e.type === 'blocked' && blocked.push(e.gateId));
    s.arm();
    s.drop();
    vi.advanceTimersByTime(200); // gate 1 has fired; the rest are pending
    s.arm(); // restart
    vi.advanceTimersByTime(3000);
    expect(blocked).toHaveLength(1); // nothing from the old drop arrives after the restart
  });

  it('reports every gate in height order when allowed to finish', () => {
    const s = new SimulatedPhotogateSource();
    const times: number[] = [];
    s.subscribe((e) => e.type === 'blocked' && times.push(e.time));
    s.arm();
    s.drop();
    vi.advanceTimersByTime(2000);
    expect(times).toHaveLength(5);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(s.gates().every((g) => g.beam === 'clear')).toBe(true);
  });

  it('adds, moves (clamped) and removes gates', () => {
    const s = new SimulatedPhotogateSource();
    void s.addGate();
    expect(s.gates()).toHaveLength(6);
    const id = s.gates()[0].id;
    s.moveGate(id, 99);
    expect(s.standGates()[0].position).toBeLessThanOrEqual(1.25);
    s.moveGate(id, NaN);
    expect(Number.isFinite(s.standGates()[0].position)).toBe(true);
    s.removeGate(id);
    expect(s.gates()).toHaveLength(5);
  });
});

import { isBeamChannel } from './GoDirectPhotogateSource';
describe('isBeamChannel (Vernier channel names)', () => {
  it('accepts the two gate-state channels, with any dash style', () => {
    expect(isBeamChannel('Gate 1 – Gate State')).toBe(true);
    expect(isBeamChannel('Gate 2 - Gate State')).toBe(true);
    expect(isBeamChannel(' Gate 2 — Gate State ')).toBe(true);
  });
  it('rejects remote/laser gates, timing and object channels', () => {
    for (const n of ['Laser Gate – Gate State', 'Gate 1/Remote Gate – Timing', 'Laser Gate/Remote Gate – Timing', 'Remote Gate – Object Velocity', 'Object Velocity', 'Object Acceleration', 'Gate 3 – Gate State']) {
      expect(isBeamChannel(n)).toBe(false);
    }
  });
});
