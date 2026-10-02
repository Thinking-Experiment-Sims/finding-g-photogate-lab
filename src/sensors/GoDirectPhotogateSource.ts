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
const GATE_NAME = /^gate\s*([12])\b.*gate\s*state/i;
/** Firmware-computed channels (timed inside the gate at 1 µs). "Remote Gate – …" variants are excluded. */
export const isObjectVelocity = (name: string) => /^object\s*velocity$/i.test(name.trim());
export const isObjectAcceleration = (name: string) => /^object\s*acceleration/i.test(name.trim());
/** Vernier's documented channel names are "Gate 1 – Gate State" and "Gate 2 – Gate State". Excludes remote/laser gates and timing channels. */
export const isBeamChannel = (name: string) => GATE_NAME.test(name.trim()) && !/remote|laser/i.test(name);

/** Minimal shape of what we use from @vernier/godirect (the library ships loose types). */
interface GdxSensor {
  number: number;
  name: string;
  unit: string;
  specs?: { measurementInfo?: { mode?: number; minPeriod?: number; typicalPeriod?: number } };
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
  private packetLog: string[] = [];
  options: SourceOptions = { timingMode: 'device', fastSampling: false };
  /** Also enable the gate's firmware Object Velocity / Object Acceleration channels (used by the picket-fence check). */
  objectChannels = false;
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
    const enabledNow = [...new Set(this.beams.map((b) => b.device))].map((d) => `${d.name}: enabled now → ${d.sensors.filter((x) => (x as unknown as { enabled?: boolean }).enabled).map((x) => `${x.number}="${x.name}"`).join(', ') || '(none)'}`);
    const live = this.beams.map((b) => `${b.info.label}: channel ${b.sensor.number} "${b.sensor.name}", latest raw value ${this.latest.get(b.info.id) ?? 'none yet'}`);
    const log = this.eventLog.length
      ? ['', 'Recent beam events (seconds after arming). "browser" = when Bluetooth delivered it; "device" = the gate\'s own clock:', ...this.eventLog.slice(-12)]
      : [];
    const packets = this.packetLog.length ? ['', 'First raw measurement packets (hex; for diagnosing the event format):', ...this.packetLog] : [];
    return [...this.diag, ...enabledNow, ...live, ...log, ...packets];
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

    this.diag.push(`${devName}: channels ${device.sensors.map((s) => `${s.number}="${s.name}"${s.unit ? ` (${s.unit})` : ''} [${s.specs?.measurementInfo?.mode === 1 ? 'event-based' : 'fixed-rate'}]`).join(', ') || '(none reported)'}`);
    // Only the two "Gate n – Gate State" channels become beams; remote/laser gates and timing channels must not.
    let gateSensors = device.sensors.filter((s) => isBeamChannel(s.name)).sort((a, b) => a.number - b.number);
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
      const m = GATE_NAME.exec(sensor.name.trim());
      const label = `${devName} · beam ${m ? m[1] : sensor.number}`;
      return { info: { id: `${ble.id}#${sensor.number}`, label, beam: 'unknown' as const }, deviceId: ble.id, device, sensor, armedClear: false, sampleCount: 0 };
    });
    for (const beam of added) {
      beam.sensor.setEnabled(true);
      beam.sensor.on('value-changed', (s) => this.onValue(beam, s.value));
    }
    this.clocks.set(ble.id, new DeviceClock());
    this.tapPackets(device, devName);
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
    if (this.objectChannels) this.enableObjectChannels(device, devName);
    this.emit({ type: 'gates', gates: this.gates() });
    // Enabling sensors made the library restart measurements at each sensor's own period; apply our sampling choice on top.
    if (this.options.fastSampling) this.applyOptions();
  }

  /**
   * DIAGNOSTIC ONLY. Records the first raw measurement packets so the Go Direct event format can be inspected: the library ignores
   * any timestamps these packets may carry. Wraps the library's private _handleResponse without changing its behavior.
   */
  private tapPackets(device: GdxDevice, name: string) {
    const d = device as unknown as { _handleResponse?: (n: DataView) => void };
    const original = d._handleResponse?.bind(device);
    if (!original) return;
    d._handleResponse = (n: DataView) => {
      try {
        if (n.byteLength > 4 && n.getUint8(0) === 0x20 && this.packetLog.length < 40) {
          const bytes = Array.from(new Uint8Array(n.buffer, n.byteOffset, Math.min(n.byteLength, 40))).map((b) => b.toString(16).padStart(2, '0')).join(' ');
          this.packetLog.push(`${(performance.now() / 1000).toFixed(3)} s ${name.split(' ').pop()} type 0x${n.getUint8(4).toString(16)}: ${bytes}`);
        }
      } catch {
        /* diagnostics must never break measurement */
      }
      original(n);
    };
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
      // Sample-number timing is only meaningful for FIXED-RATE channels. Gate-state channels are normally EVENT-based
      // (values arrive only on a change), so counting them × period is meaningless; and if the two clocks disagree wildly, distrust the device one.
      const eventBased = beam.sensor.specs?.measurementInfo?.mode === 1;
      const deviceUsable = !eventBased && Math.abs(viaDevice - viaBrowser) < 0.25;
      this.eventLog.push(`${beam.info.label}: browser ${viaBrowser.toFixed(4)} s · device ${viaDevice.toFixed(4)} s · sample ${beam.sampleCount - 1} @ ${(periodS * 1000).toFixed(0)} ms${deviceUsable ? '' : ` — device clock NOT used (${eventBased ? 'event-based channel' : 'disagrees with browser time'}); using browser time`}`);
      this.emit({ type: 'blocked', gateId: beam.info.id, time: this.options.timingMode === 'device' && deviceUsable ? viaDevice : viaBrowser });
    }
  }

  /**
   * Enable the firmware-timed Object Velocity / Object Acceleration channels. The library disables channels that a newly enabled
   * channel is mutually exclusive with, so the channel list is logged AFTER enabling to show exactly what survived.
   */
  private enableObjectChannels(device: GdxDevice, devName: string) {
    for (const [kind, test] of [['velocity', isObjectVelocity], ['acceleration', isObjectAcceleration]] as const) {
      const sensor = device.sensors.find((s) => test(s.name));
      if (!sensor) {
        this.diag.push(`${devName}: no "${kind === 'velocity' ? 'Object Velocity' : 'Object Acceleration'}" channel found`);
        continue;
      }
      sensor.setEnabled(true);
      sensor.on('value-changed', (s) => {
        if (s.value !== null && Number.isFinite(s.value)) this.emit({ type: 'object', kind, value: s.value, time: performance.now() / 1000 - this.clockZero });
      });
      this.diag.push(`${devName}: enabled "${sensor.name}" (channel ${sensor.number}, ${sensor.unit || 'no unit'})`);
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
