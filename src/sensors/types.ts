// The only thing the rest of the app knows about photogate hardware.
// Vernier-specific code lives in GoDirectPhotogateSource.ts and nowhere else.

export type SourceKind = 'simulated' | 'vernier';

export interface GateInfo {
  id: string;
  /** Short human label, e.g. "Gate 1" (simulated) or "GDX-VPG 0A1B" (the name on the physical gate). */
  label: string;
  /** Live state of the beam. 'blocked' means something is in the beam right now. */
  beam: 'clear' | 'blocked' | 'unknown';
}

export type SourceEvent =
  | { type: 'gates'; gates: GateInfo[] }
  /** The beam on a gate was newly blocked. `time` is seconds on this source's own clock. */
  | { type: 'blocked'; gateId: string; time: number }
  | { type: 'beam'; gateId: string; beam: GateInfo['beam'] }
  | { type: 'error'; message: string };

export interface PhotogateSource {
  readonly kind: SourceKind;
  /** Text that must be shown wherever data from this source appears. */
  readonly dataLabel: string;
  gates(): GateInfo[];
  subscribe(listener: (e: SourceEvent) => void): () => void;
  /** Add one gate. For real hardware this opens the browser's device chooser and must run inside a click. */
  addGate(): Promise<void>;
  removeGate(id: string): void;
  /** Start listening for beam-blocked events. Resolves once armed. */
  arm(): void;
  disarm(): void;
  dispose(): void;
}
