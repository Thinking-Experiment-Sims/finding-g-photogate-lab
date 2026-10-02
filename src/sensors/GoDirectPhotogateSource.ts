// ALL Vernier-specific code lives in this file.
//
// STATUS: EXPERIMENTAL — written against Vernier's official @vernier/godirect library and its published
// photogate example, but NOT tested with real hardware (this was authored without access to any).
// See docs/VERNIER-FINDINGS.md for what is known, assumed, and risky.
import type { GateInfo, PhotogateSource, SourceEvent } from './types';

/** Go Direct Photogate service + name prefix, as used in Vernier's own gdx_photogate.html example. */
const GDX_SERVICE = 'd91714ef-28b9-4f91-ba16-f0d9a604f112';
const GATE_NAME_PREFIX = 'GDX-VPG';
/** Sensor channel 4 = "Gate 1" state in Vernier's example: value 1 = blocked, 0 = clear. */
const GATE_1_CHANNEL = 4;

/** Minimal shape of what we use from @vernier/godirect (the library ships loose types). */
interface GdxSensor {
  setEnabled(on: boolean): void;
  on(event: 'value-changed', cb: (s: { value: number | null }) => void): void;
  off?(event: string, cb: unknown): void;
}
interface GdxDevice {
  name: string;
  getSensor(n: number): GdxSensor | undefined;
  on(event: 'device-closed', cb: () => void): void;
  close(): void;
}

interface Connected {
  info: GateInfo;
  device: GdxDevice;
  armedClear: boolean; // saw a "clear" reading since arming, so the next "blocked" is a real event
}

interface BluetoothLike {
  requestDevice(opts: unknown): Promise<{ id: string; name?: string }>;
}
const bluetooth = (): BluetoothLike | undefined => (navigator as unknown as { bluetooth?: BluetoothLike }).bluetooth;

export function webBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && !!bluetooth();
}

export class GoDirectPhotogateSource implements PhotogateSource {
  readonly kind = 'vernier' as const;
  readonly dataLabel = 'Vernier Go Direct Photogates (experimental)';
  private connected: Connected[] = [];
  private listeners = new Set<(e: SourceEvent) => void>();
  private armed = false;
  private clockZero = 0;

  private emit(e: SourceEvent) {
    this.listeners.forEach((l) => l(e));
  }

  gates(): GateInfo[] {
    return this.connected.map((c) => ({ ...c.info }));
  }

  subscribe(listener: (e: SourceEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Opens the browser's Bluetooth chooser. Must be called from a click handler. */
  async addGate() {
    if (!webBluetoothSupported()) {
      throw new Error('To connect Vernier sensors, open this page in Google Chrome (or Microsoft Edge).');
    }
    // requestDevice must run while the click's user activation is still valid, so it comes BEFORE the (lazy) library import.
    const ble = await bluetooth()!.requestDevice({
      filters: [{ namePrefix: GATE_NAME_PREFIX }],
      optionalServices: [GDX_SERVICE],
    });
    const { default: godirect } = await import('@vernier/godirect');
    if (this.connected.some((c) => c.info.id === ble.id)) return; // already added
    const device = (await godirect.createDevice(ble)) as unknown as GdxDevice;
    const sensor = device.getSensor(GATE_1_CHANNEL);
    if (!sensor) {
      device.close();
      throw new Error('That device does not look like a Go Direct Photogate (no gate channel found).');
    }
    const entry: Connected = {
      info: { id: ble.id, label: device.name || ble.name || 'Photogate', beam: 'unknown' },
      device,
      armedClear: false,
    };
    sensor.setEnabled(true);
    sensor.on('value-changed', (s) => {
      if (s.value === null || !Number.isFinite(s.value)) return;
      const blocked = s.value === 1;
      const beam = blocked ? 'blocked' : 'clear';
      if (entry.info.beam !== beam) {
        entry.info.beam = beam;
        this.emit({ type: 'beam', gateId: entry.info.id, beam });
      }
      if (!this.armed) return;
      if (!blocked) {
        entry.armedClear = true;
      } else if (entry.armedClear) {
        entry.armedClear = false; // one event per gate per arm
        // TIMING CAVEAT: the library exposes no device timestamp, so this is the browser's receive time.
        // Bluetooth delivery jitter is added to every gate. See docs/VERNIER-FINDINGS.md.
        this.emit({ type: 'blocked', gateId: entry.info.id, time: performance.now() / 1000 - this.clockZero });
      }
    });
    device.on('device-closed', () => {
      this.connected = this.connected.filter((c) => c !== entry);
      this.emit({ type: 'gates', gates: this.gates() });
    });
    this.connected.push(entry);
    this.emit({ type: 'gates', gates: this.gates() });
  }

  removeGate(id: string) {
    const c = this.connected.find((x) => x.info.id === id);
    if (c) c.device.close(); // 'device-closed' handler removes it from the list
  }

  arm() {
    this.clockZero = performance.now() / 1000;
    this.connected.forEach((c) => (c.armedClear = c.info.beam === 'clear'));
    this.armed = true;
  }

  disarm() {
    this.armed = false;
  }

  dispose() {
    this.armed = false;
    this.connected.forEach((c) => c.device.close());
    this.connected = [];
    this.listeners.clear();
  }
}
