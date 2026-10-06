import type { GateInfo, PhotogateSource, SourceEvent } from './types';

export const SIM_G = 9.81; // true value used by the simulation (hidden from the analysis)
export const SIM_TIMING_NOISE = 0.00005; // s, 1σ gate timing jitter (50 µs, high-precision photogate)
export const SIM_RELEASE_HEIGHT = 1.3; // m above the table; the object is dropped from rest here
export const SIM_MIN_HEIGHT = 0.1;
export const SIM_MAX_HEIGHT = 1.25;
export const BEAM_SPACING = 0.02; // 2.0 cm between internal beams on photogate
export const DEFAULT_SIM_HEIGHTS = [1.18, 0.92, 0.66, 0.40]; // 4 dual-beam photogates = 8 distinct points

export interface SimGate {
  id: string;
  label: string;
  /** TRUE top beam (Beam 1) height above the table, m. Beam 2 is exactly truePosition - BEAM_SPACING. */
  truePosition: number;
  beam1: 'clear' | 'blocked';
  beam2: 'clear' | 'blocked';
}

/** Box–Muller normal sample. */
function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Time for an object released from rest at SIM_RELEASE_HEIGHT to reach a gate at height h, plus timing noise. */
export function simulatedArrivalTime(h: number, rand: () => number = Math.random): number {
  return Math.sqrt((2 * Math.max(SIM_RELEASE_HEIGHT - h, 0)) / SIM_G) + SIM_TIMING_NOISE * gaussian(rand);
}

/** Simulated photogate stand. Clearly labeled as simulated; never claims to be hardware. */
export class SimulatedPhotogateSource implements PhotogateSource {
  readonly kind = 'simulated' as const;
  readonly dataLabel = 'Simulated data';
  private list: SimGate[];
  private listeners = new Set<(e: SourceEvent) => void>();
  private timers: ReturnType<typeof setTimeout>[] = []; // pending gate arrivals: cancelled by disarm()
  private clearTimers: ReturnType<typeof setTimeout>[] = []; // beam-clear flashes: always allowed to finish
  private armed = false;
  private nextId = 1;
  /** Wall-clock start of the most recent drop (ms, performance.now) — for animating the falling object. */
  lastDropStart: number | null = null;

  constructor(positions: number[] = DEFAULT_SIM_HEIGHTS, private rand: () => number = Math.random) {
    this.list = positions.map((p) => this.makeGate(p));
  }

  private makeGate(position: number): SimGate {
    const n = this.nextId++;
    return {
      id: `sim-${n}`,
      label: `Gate ${n}`,
      truePosition: position,
      beam1: 'clear',
      beam2: 'clear',
    };
  }

  private emit(e: SourceEvent) {
    this.listeners.forEach((l) => l(e));
  }

  /** Returns both Beam 1 (Top) and Beam 2 (Bottom) for each physical photogate. */
  gates(): GateInfo[] {
    const out: GateInfo[] = [];
    for (const g of this.list) {
      out.push({
        id: `${g.id}-b1`,
        label: `${g.label} · Beam 1 (Top)`,
        beam: g.beam1,
        group: g.id,
        groupLabel: g.label,
      });
      out.push({
        id: `${g.id}-b2`,
        label: `${g.label} · Beam 2 (Bottom)`,
        beam: g.beam2,
        group: g.id,
        groupLabel: g.label,
      });
    }
    return out;
  }

  /** True stand geometry, for drawing the virtual stand and ruler. */
  standGates(): { id: string; label: string; position: number; b1Position: number; b2Position: number }[] {
    return this.list.map((g) => ({
      id: g.id,
      label: g.label,
      position: g.truePosition,
      b1Position: g.truePosition,
      b2Position: g.truePosition - BEAM_SPACING,
    }));
  }

  subscribe(listener: (e: SourceEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async addGate() {
    const lowest = this.list.reduce((m, g) => Math.min(m, g.truePosition), SIM_MAX_HEIGHT);
    this.list.push(this.makeGate(Math.max(lowest - 0.15, SIM_MIN_HEIGHT + BEAM_SPACING)));
    this.emit({ type: 'gates', gates: this.gates() });
  }

  removeGate(id: string) {
    this.list = this.list.filter((g) => g.id !== id && `${g.id}-b1` !== id && `${g.id}-b2` !== id);
    this.emit({ type: 'gates', gates: this.gates() });
  }

  moveGate(id: string, position: number) {
    const g = this.list.find((x) => x.id === id || `${x.id}-b1` === id || `${x.id}-b2` === id);
    if (!g || !Number.isFinite(position)) return;
    g.truePosition = Math.min(Math.max(position, SIM_MIN_HEIGHT + BEAM_SPACING), SIM_MAX_HEIGHT);
    this.emit({ type: 'gates', gates: this.gates() });
  }

  arm() {
    this.cancelTimers(); // a restart must not inherit gate events from an earlier, unfinished drop
    this.armed = true;
  }

  disarm() {
    this.armed = false;
    this.cancelTimers();
  }

  private cancelTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  /** Release the object. Both Beam 1 and Beam 2 events fire with realistic 2 cm interval timing. */
  drop(): boolean {
    if (!this.armed) return false;
    this.cancelTimers();
    this.lastDropStart = performance.now();

    for (const g of this.list) {
      const y1 = g.truePosition;
      const y2 = g.truePosition - BEAM_SPACING;
      const t1 = simulatedArrivalTime(y1, this.rand);
      const t2 = simulatedArrivalTime(y2, this.rand);

      // Beam 1 event
      this.timers.push(
        setTimeout(() => {
          if (!this.armed) return;
          g.beam1 = 'blocked';
          this.emit({ type: 'blocked', gateId: `${g.id}-b1`, time: t1 });
          this.emit({ type: 'beam', gateId: `${g.id}-b1`, beam: 'blocked' });
          this.clearTimers.push(
            setTimeout(() => {
              g.beam1 = 'clear';
              this.emit({ type: 'beam', gateId: `${g.id}-b1`, beam: 'clear' });
            }, 150),
          );
        }, t1 * 1000),
      );

      // Beam 2 event
      this.timers.push(
        setTimeout(() => {
          if (!this.armed) return;
          g.beam2 = 'blocked';
          const dt = Math.max(t2 - t1, 0.0001);
          const v = BEAM_SPACING / dt;
          this.emit({ type: 'blocked', gateId: `${g.id}-b2`, time: t2 });
          this.emit({ type: 'object', kind: 'velocity', value: v, time: t2, deviceId: g.id });
          this.emit({ type: 'beam', gateId: `${g.id}-b2`, beam: 'blocked' });
          this.clearTimers.push(
            setTimeout(() => {
              g.beam2 = 'clear';
              this.emit({ type: 'beam', gateId: `${g.id}-b2`, beam: 'clear' });
            }, 150),
          );
        }, t2 * 1000),
      );
    }
    return true;
  }

  dispose() {
    this.disarm();
    this.clearTimers.forEach(clearTimeout);
    this.listeners.clear();
  }
}
