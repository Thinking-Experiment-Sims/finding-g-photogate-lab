// The only thing the rest of the app knows about photogate hardware.
// Vernier-specific code lives in GoDirectPhotogateSource.ts and nowhere else.

export type SourceKind = 'simulated' | 'vernier';

export interface GateInfo {
  id: string;
  /** Short human label, e.g. "Gate 1" (simulated) or "GDX-VPG 0A1B" (the name on the physical gate). */
  label: string;
  /** Live state of the beam. 'blocked' means something is in the beam right now. */
  beam: 'clear' | 'blocked' | 'unknown';
  /** Beams on the same physical photogate share a group (its device id). Their heights are tied together. */
  group?: string;
  groupLabel?: string;
}

export type SourceEvent =
  | { type: 'gates'; gates: GateInfo[] }
  /** The beam on a gate was newly blocked. `time` is seconds on this source's own clock. */
  | { type: 'blocked'; gateId: string; time: number }
  | { type: 'beam'; gateId: string; beam: GateInfo['beam'] }
  | { type: 'error'; message: string };

/** Hardware timing options (Vernier source only). */
export interface SourceOptions {
  /** 'device': use each photogate's own sample clock (sample number × period). 'receive': stamp events when the browser receives them. */
  timingMode: 'device' | 'receive';
  /** Ask the gates for the fastest sampling period they report (instead of their default). Experimental. */
  fastSampling: boolean;
}

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
  /** Plain-text lines for troubleshooting (sensor channels, latest raw values). Optional. */
  diagnostics?(): string[];
  /** Timing options; present only on sources where they apply. Call `applyOptions()` after changing them. */
  options?: SourceOptions;
  applyOptions?(): void;
}
