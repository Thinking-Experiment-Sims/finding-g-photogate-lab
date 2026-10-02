import type { GateInfo, PhotogateSource, SourceEvent } from './types';

export const SIM_G = 9.81; // true value used by the simulation (hidden from the analysis)
export const SIM_TIMING_NOISE = 0.0008; // s, 1σ gate timing jitter
export const SIM_RELEASE_HEIGHT = 1.3; // m above the table; the object is dropped from rest here
export const SIM_MIN_HEIGHT = 0.1;
export const SIM_MAX_HEIGHT = 1.25;
export const DEFAULT_SIM_HEIGHTS = [1.18, 1.04, 0.86, 0.64, 0.38]; // m above the table, top gate first

interface SimGate extends GateInfo {
  /** TRUE height above the table, m. Students must read it off the ruler. */
  truePosition: number;
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
    return { id: `sim-${n}`, label: `Gate ${n}`, beam: 'clear', truePosition: position };
  }

  private emit(e: SourceEvent) {
    this.listeners.forEach((l) => l(e));
  }

  gates(): GateInfo[] {
    return this.list.map(({ id, label, beam }) => ({ id, label, beam }));
  }

  /** True stand geometry, for drawing the virtual stand and ruler. */
  standGates(): { id: string; label: string; position: number }[] {
    return this.list.map((g) => ({ id: g.id, label: g.label, position: g.truePosition }));
  }

  subscribe(listener: (e: SourceEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async addGate() {
    const lowest = this.list.reduce((m, g) => Math.min(m, g.truePosition), SIM_MAX_HEIGHT);
    this.list.push(this.makeGate(Math.max(lowest - 0.12, SIM_MIN_HEIGHT)));
    this.emit({ type: 'gates', gates: this.gates() });
  }

  removeGate(id: string) {
    this.list = this.list.filter((g) => g.id !== id);
    this.emit({ type: 'gates', gates: this.gates() });
  }

  moveGate(id: string, position: number) {
    const g = this.list.find((x) => x.id === id);
    if (!g || !Number.isFinite(position)) return;
    g.truePosition = Math.min(Math.max(position, SIM_MIN_HEIGHT), SIM_MAX_HEIGHT);
    this.emit({ type: 'gates', gates: this.gates() });
  }

  arm() {
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

  /** Release the object. Gate events arrive in real time, like a real drop. Returns false if not armed. */
  drop(): boolean {
    if (!this.armed) return false;
    this.cancelTimers();
    this.lastDropStart = performance.now();
    for (const g of this.list) {
      const t = simulatedArrivalTime(g.truePosition, this.rand);
      this.timers.push(
        setTimeout(() => {
          if (!this.armed) return;
          g.beam = 'blocked';
          this.emit({ type: 'blocked', gateId: g.id, time: t });
          this.emit({ type: 'beam', gateId: g.id, beam: 'blocked' });
          this.clearTimers.push(
            setTimeout(() => {
              g.beam = 'clear';
              this.emit({ type: 'beam', gateId: g.id, beam: 'clear' });
            }, 150),
          );
        }, t * 1000),
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
