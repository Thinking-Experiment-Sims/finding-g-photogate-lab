// ALL Vernier-specific code lives in this file.
//
// STATUS: EXPERIMENTAL — written against Vernier's official @vernier/godirect library and its published
// photogate example, but NOT tested with real hardware (this was authored without access to any).
// See docs/VERNIER-FINDINGS.md for what is known, assumed, and risky.
import { DeviceClock } from './deviceClock';
import type { GateInfo, PhotogateSource, SourceEvent, SourceOptions } from './types';

/** Go Direct Photogate service + name prefix, as used in Vernier's own gdx_photogate.html example. */
const GDX_SERVICE = 'd91714ef-28b9-4f91-ba16-f0d9a604f112';
const GATE_NAME_PREFIX = 'GDX-VPG';
/** Sensor channel 4 = "Gate 1" state in Vernier's example: value 1 = blocked, 0 = clear. Used only if no gate sensors are found by name. */
const GATE_1_CHANNEL = 4;
/** A Go Direct Photogate has two beams. We find them by sensor name ("Gate 1", "Gate 2") so we do not hard-code channel numbers. */
const GATE_NAME = /^gate\s*([12])$/i;

/** Minimal shape of what we use from @vernier/godirect (the library ships loose types). */
interface GdxSensor {
  number: number;
  name: string;
  unit: string;
  specs?: { measurementInfo?: { minPeriod?: number; typicalPeriod?: number } };
  setEnabled(on: boolean): void;
  on(event: 'value-changed', cb: (s: { value: number | null }) => void): void;
  off?(event: string, cb: unknown): void;
}
interface GdxDevice {
  name: string;
  sensors: GdxSensor[];
  /** Sampling period in milliseconds currently in use. */
  measurementPeriod: number;
  minMeasurementPeriod: number;
  getSensor(n: number): GdxSensor | undefined;
  start(period?: number): void;
  on(event: 'device-closed' | 'measurements-started', cb: () => void): void;
  close(): void;
}

/** One beam (one gate sensor channel) on one physical device. A Go Direct Photogate has two beams. */
interface Beam {
  info: GateInfo;
  deviceId: string;
  device: GdxDevice;
  sensor: GdxSensor;
  armedClear: boolean; // saw a "clear" reading since arming, so the next "blocked" is a real event
  sampleCount: number; // samples received since measurements (re)started: this beam's position on the device clock
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
  private clocks = new Map<string, DeviceClock>();
  private eventLog: string[] = [];
  options: SourceOptions = { timingMode: 'device', fastSampling: false };
  private latest = new Map<string, number>();
  private deviceLabels = new Map<string, string>();

  private emit(e: SourceEvent) {
    this.listeners.forEach((l) => l(e));
  }

  /** One entry per beam. The two beams of a photogate share a `group` so the UI can ask for one crease height per gate. */
  gates(): GateInfo[] {
    return this.beams.map((b) => ({ ...b.info, group: b.deviceId, groupLabel: this.deviceLabels.get(b.deviceId) ?? 'Photogate' }));
  }

  diagnostics(): string[] {
    const live = this.beams.map((b) => `${b.info.label}: channel ${b.sensor.number} "${b.sensor.name}", latest raw value ${this.latest.get(b.info.id) ?? 'none yet'}`);
    const log = this.eventLog.length
      ? ['', 'Recent beam events (seconds after arming). "browser" = when Bluetooth delivered it; "device" = the gate\'s own clock:', ...this.eventLog.slice(-12)]
      : [];
    return [...this.diag, ...live, ...log];
  }

  /** Apply the sampling option to every connected device. */
  applyOptions() {
    for (const deviceId of new Set(this.beams.map((b) => b.deviceId))) {
      const mine = this.beams.filter((b) => b.deviceId === deviceId);
      const device = mine[0].device;
      const infos = mine.map((b) => b.sensor.specs?.measurementInfo);
      const typical = Math.max(...infos.map((i) => i?.typicalPeriod ?? 10));
      const fastest = Math.max(1, ...infos.map((i) => i?.minPeriod ?? 1));
      const target = this.options.fastSampling ? fastest : typical;
      this.diag.push(`${mine[0].info.label.split(' · ')[0]}: asking for a ${target} ms sampling period (reported typical ${typical} ms, fastest ${fastest} ms)`);
      try {
        device.minMeasurementPeriod = Math.min(device.minMeasurementPeriod, target);
        device.start(target);
      } catch (err) {
        this.diag.push(`Could not change the sampling period: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
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
    // Exact names only ("Gate 1", "Gate 2"): a loose match could also catch other channels (e.g. "Gate 1 Time") and create phantom beams.
    let gateSensors = device.sensors.filter((s) => GATE_NAME.test(s.name.trim())).sort((a, b) => a.number - b.number);
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

    this.deviceLabels.set(ble.id, devName);
    this.diag.push(`${devName}: listening to ${gateSensors.length} beam channel${gateSensors.length === 1 ? '' : 's'}: ${gateSensors.map((x) => `${x.number}="${x.name}"`).join(', ')}`);
    const added: Beam[] = gateSensors.map((sensor) => {
      const m = GATE_NAME.exec(sensor.name);
      const label = `${devName} · beam ${m ? m[1] : sensor.number}`;
      return { info: { id: `${ble.id}#${sensor.number}`, label, beam: 'unknown' as const }, deviceId: ble.id, device, sensor, armedClear: false, sampleCount: 0 };
    });
    for (const beam of added) {
      beam.sensor.setEnabled(true);
      beam.sensor.on('value-changed', (s) => this.onValue(beam, s.value));
    }
    this.clocks.set(ble.id, new DeviceClock());
    device.on('measurements-started', () => {
      // Every (re)start begins a new device timeline: sample 0 again.
      this.beams.filter((b) => b.deviceId === ble.id).forEach((b) => (b.sampleCount = 0));
      this.clocks.get(ble.id)?.reset();
    });
    device.on('device-closed', () => {
      this.beams = this.beams.filter((b) => b.deviceId !== ble.id);
      this.deviceLabels.delete(ble.id);
      this.emit({ type: 'gates', gates: this.gates() });
    });
    this.beams.push(...added);
    this.emit({ type: 'gates', gates: this.gates() });
    // Enabling sensors made the library restart measurements at each sensor's own period; apply our sampling choice on top.
    if (this.options.fastSampling) this.applyOptions();
  }

  private onValue(beam: Beam, value: number | null) {
    if (value === null || !Number.isFinite(value)) return;
    const arrival = performance.now() / 1000;
    // Position of this sample on the device's own clock, mapped onto the browser clock (see deviceClock.ts).
    const periodS = (beam.device.measurementPeriod || 10) / 1000;
    const deviceEstimate = (this.clocks.get(beam.deviceId) ?? (this.clocks.set(beam.deviceId, new DeviceClock()), this.clocks.get(beam.deviceId)!)).observe(beam.sampleCount++, periodS, arrival);
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
      const viaBrowser = arrival - this.clockZero;
      const viaDevice = deviceEstimate - this.clockZero;
      this.eventLog.push(`${beam.info.label}: browser ${viaBrowser.toFixed(4)} s · device ${viaDevice.toFixed(4)} s · sample ${beam.sampleCount - 1} @ ${(periodS * 1000).toFixed(0)} ms`);
      this.emit({ type: 'blocked', gateId: beam.info.id, time: this.options.timingMode === 'device' ? viaDevice : viaBrowser });
    }
  }

  /** Remove a whole photogate (both beams) and disconnect it. `id` may be a beam id or the device id. */
  removeGate(id: string) {
    const deviceId = this.beams.find((b) => b.info.id === id || b.deviceId === id)?.deviceId;
    const mine = this.beams.filter((b) => b.deviceId === deviceId);
    id = deviceId ?? id;
    if (mine.length === 0) return;
    this.beams = this.beams.filter((b) => b.deviceId !== id);
    this.deviceLabels.delete(id);
    this.clocks.delete(id);
    mine[0].device.close();
    this.emit({ type: 'gates', gates: this.gates() });
  }

  arm() {
    this.clockZero = performance.now() / 1000;
    this.eventLog = [];
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
