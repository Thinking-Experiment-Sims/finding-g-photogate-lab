// ALL Vernier-specific code lives in this file.
//
// STATUS: EXPERIMENTAL — written against Vernier's official @vernier/godirect library and its published
// photogate example, but NOT tested with real hardware (this was authored without access to any).
// See docs/VERNIER-FINDINGS.md for what is known, assumed, and risky.
import type { GateInfo, PhotogateSource, SourceEvent } from './types';

/** Go Direct Photogate service + name prefix, as used in Vernier's own gdx_photogate.html example. */
const GDX_SERVICE = 'd91714ef-28b9-4f91-ba16-f0d9a604f112';
const GATE_NAME_PREFIX = 'GDX-VPG';
/** Sensor channel 4 = "Gate 1" state in Vernier's example: value 1 = blocked, 0 = clear. Used only if no gate sensors are found by name. */
const GATE_1_CHANNEL = 4;
/** A Go Direct Photogate has two beams. We find them by sensor name ("Gate 1", "Gate 2") so we do not hard-code channel numbers. */
const GATE_NAME = /^gate\s*([12])\b/i;

/** Minimal shape of what we use from @vernier/godirect (the library ships loose types). */
interface GdxSensor {
  number: number;
  name: string;
  unit: string;
  setEnabled(on: boolean): void;
  on(event: 'value-changed', cb: (s: { value: number | null }) => void): void;
  off?(event: string, cb: unknown): void;
}
interface GdxDevice {
  name: string;
  sensors: GdxSensor[];
  getSensor(n: number): GdxSensor | undefined;
  on(event: 'device-closed', cb: () => void): void;
  close(): void;
}

/** One beam (one gate sensor channel) on one physical device. A Go Direct Photogate has two beams. */
interface Beam {
  info: GateInfo;
  deviceId: string;
  device: GdxDevice;
  sensor: GdxSensor;
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
  private beams: Beam[] = [];
  private listeners = new Set<(e: SourceEvent) => void>();
  private armed = false;
  private clockZero = 0;
  private diag: string[] = [];
  private latest = new Map<string, number>();

  private emit(e: SourceEvent) {
    this.listeners.forEach((l) => l(e));
  }

  gates(): GateInfo[] {
    return this.beams.map((b) => ({ ...b.info }));
  }

  diagnostics(): string[] {
    const live = this.beams.map((b) => `${b.info.label}: channel ${b.sensor.number} "${b.sensor.name}", latest raw value ${this.latest.get(b.info.id) ?? 'none yet'}`);
    return [...this.diag, ...live];
  }

  subscribe(listener: (e: SourceEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Opens the browser's Bluetooth chooser. Must be called from a click handler. Adds one row per beam on the device. */
  async addGate() {
    if (!webBluetoothSupported()) {
      throw new Error('To connect Vernier sensors, open this page in Google Chrome (or Microsoft Edge).');
    }
    // requestDevice must run while the click's user activation is still valid, so it comes BEFORE the (lazy) library import.
    const ble = await bluetooth()!.requestDevice({
      filters: [{ namePrefix: GATE_NAME_PREFIX }],
      optionalServices: [GDX_SERVICE],
    });
    if (this.beams.some((b) => b.deviceId === ble.id)) return; // already added
    const { default: godirect } = await import('@vernier/godirect');
    const device = (await godirect.createDevice(ble)) as unknown as GdxDevice;
    const devName = device.name || ble.name || 'Photogate';

    this.diag.push(`${devName}: channels ${device.sensors.map((s) => `${s.number}="${s.name}"${s.unit ? ` (${s.unit})` : ''}`).join(', ') || '(none reported)'}`);
    let gateSensors = device.sensors.filter((s) => GATE_NAME.test(s.name)).sort((a, b) => a.number - b.number);
    if (gateSensors.length === 0) {
      const fallback = device.getSensor(GATE_1_CHANNEL);
      if (fallback) {
        gateSensors = [fallback];
        this.diag.push(`${devName}: no sensor named "Gate 1/2" found; falling back to channel ${GATE_1_CHANNEL} only`);
      }
    }
    if (gateSensors.length === 0) {
      device.close();
      throw new Error('That device does not look like a Go Direct Photogate (no gate channels found).');
    }

    const added: Beam[] = gateSensors.map((sensor) => {
      const m = GATE_NAME.exec(sensor.name);
      const label = gateSensors.length > 1 ? `${devName} · Gate ${m ? m[1] : sensor.number}` : devName;
      return { info: { id: `${ble.id}#${sensor.number}`, label, beam: 'unknown' as const }, deviceId: ble.id, device, sensor, armedClear: false };
    });
    for (const beam of added) {
      beam.sensor.setEnabled(true);
      beam.sensor.on('value-changed', (s) => this.onValue(beam, s.value));
    }
    device.on('device-closed', () => {
      this.beams = this.beams.filter((b) => b.deviceId !== ble.id);
      this.emit({ type: 'gates', gates: this.gates() });
    });
    this.beams.push(...added);
    this.emit({ type: 'gates', gates: this.gates() });
  }

  private onValue(beam: Beam, value: number | null) {
    if (value === null || !Number.isFinite(value)) return;
    this.latest.set(beam.info.id, value);
    const blocked = value === 1;
    const state = blocked ? 'blocked' : 'clear';
    if (beam.info.beam !== state) {
      beam.info.beam = state;
      this.emit({ type: 'beam', gateId: beam.info.id, beam: state });
    }
    if (!this.armed) return;
    if (!blocked) {
      beam.armedClear = true;
    } else if (beam.armedClear) {
      beam.armedClear = false; // one event per beam per arm
      // TIMING CAVEAT: the library exposes no device timestamp, so this is the browser's receive time.
      // Bluetooth delivery jitter is added to every beam. See docs/VERNIER-FINDINGS.md.
      this.emit({ type: 'blocked', gateId: beam.info.id, time: performance.now() / 1000 - this.clockZero });
    }
  }

  /** Remove one beam. The physical device is disconnected only when none of its beams are left. */
  removeGate(id: string) {
    const beam = this.beams.find((b) => b.info.id === id);
    if (!beam) return;
    this.beams = this.beams.filter((b) => b !== beam);
    beam.sensor.setEnabled(false);
    if (!this.beams.some((b) => b.deviceId === beam.deviceId)) beam.device.close();
    this.emit({ type: 'gates', gates: this.gates() });
  }

  arm() {
    this.clockZero = performance.now() / 1000;
    this.beams.forEach((b) => (b.armedClear = b.info.beam === 'clear'));
    this.armed = true;
  }

  disarm() {
    this.armed = false;
  }

  dispose() {
    this.armed = false;
    new Set(this.beams.map((b) => b.device)).forEach((d) => d.close());
    this.beams = [];
    this.listeners.clear();
  }
}
