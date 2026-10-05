// ALL Vernier-specific code lives in this file.
//
// STATUS: EXPERIMENTAL. Gate-state and Object Velocity packets (including their microsecond timestamps) were decoded from real
// GDX-VPG captures; the lab flow with several gates has not been run on hardware yet. See docs/VERNIER-FINDINGS.md.
import { EventClock } from './eventClock';
import { parseEventPacket } from './goDirectPackets';
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
  getSensor(n: number): GdxSensor | undefined;
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
  private clocks = new Map<string, EventClock>();
  /** Gate timestamp (µs, unwrapped) of the packet currently being processed, keyed by sensor channel, per device. */
  private pendingTs = new Map<string, number>();
  private eventLog: string[] = [];
  private packetLog: string[] = [];
  options: SourceOptions = { timingMode: 'device' };
  /** Also enable the gate's firmware Object Velocity / Object Acceleration channels (timed inside the gate at 1 µs). */
  objectChannels = true;
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
    const sync = [...this.clocks.entries()].map(([id, c]) => `${this.deviceLabels.get(id) ?? id}: clock alignment from ${c.stats().packets} packets, latency spread ${c.stats().spreadMs.toFixed(1)} ms (more packets = better alignment between gates)`);
    const log = this.eventLog.length
      ? ['', 'Recent beam events (seconds after arming). "browser" = when Bluetooth delivered it; "gate" = the gate\'s own timestamp mapped to the browser clock:', ...this.eventLog.slice(-12)]
      : [];
    const packets = this.packetLog.length ? ['', 'First raw measurement packets (hex; for diagnosing the event format):', ...this.packetLog] : [];
    return [...this.diag, ...enabledNow, ...live, ...sync, ...log, ...packets];
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
      return { info: { id: `${ble.id}#${sensor.number}`, label, beam: 'unknown' as const }, deviceId: ble.id, device, sensor, armedClear: false };
    });
    for (const beam of added) {
      beam.sensor.setEnabled(true);
      beam.sensor.on('value-changed', (s) => this.onValue(beam, s.value));
    }
    this.clocks.set(ble.id, new EventClock());
    this.tapPackets(device, devName, ble.id);
    device.on('measurements-started', () => {
      // Every (re)start begins a new device timeline (timestamps count from 0 again).
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
  }

  /**
   * Wraps the library's private _handleResponse to read what it discards: the gate's own microsecond timestamp on every event packet.
   * The packet is parsed BEFORE the library handles it; the library then fires 'value-changed' synchronously, and onValue picks the
   * timestamp up from `pendingTs`. Any failure here falls back to the library's normal behavior (browser receive time).
   */
  private tapPackets(device: GdxDevice, name: string, deviceId: string) {
    const d = device as unknown as { _handleResponse?: (n: DataView) => void };
    const original = d._handleResponse?.bind(device);
    if (!original) return;
    d._handleResponse = (n: DataView) => {
      const arrival = performance.now() / 1000;
      try {
        if (n.byteLength > 4 && n.getUint8(0) === 0x20 && this.packetLog.length < 24) {
          const bytes = Array.from(new Uint8Array(n.buffer, n.byteOffset, Math.min(n.byteLength, 24))).map((b) => b.toString(16).padStart(2, '0')).join(' ');
          this.packetLog.push(`${arrival.toFixed(3)} s ${name.split(' ').pop()} type 0x${n.getUint8(4).toString(16)}: ${bytes}`);
        }
        const packet = parseEventPacket(n);
        const clock = this.clocks.get(deviceId);
        if (packet && clock) {
          for (const sample of packet.samples) {
            const ts = clock.observe(arrival, sample.tsUs);
            this.pendingTs.set(`${deviceId}#${packet.channel}`, ts);
          }
        }
      } catch {
        /* never let timestamp decoding break measurement */
      }
      original(n);
    };
  }

  /** Browser-clock time (s, relative to arming) of the gate timestamp attached to this channel's packet, if there is one. */
  private gateTime(deviceId: string, channel: number): number | undefined {
    const key = `${deviceId}#${channel}`;
    const ts = this.pendingTs.get(key);
    this.pendingTs.delete(key);
    const clock = this.clocks.get(deviceId);
    return ts === undefined || !clock ? undefined : clock.toBrowser(ts) - this.clockZero;
  }

  private onValue(beam: Beam, value: number | null) {
    if (value === null || !Number.isFinite(value)) return;
    const arrival = performance.now() / 1000;
    const viaBrowser = arrival - this.clockZero;
    const viaGate = this.gateTime(beam.deviceId, beam.sensor.number);
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
      beam.armedClear = false; // one event per beam per arm (re-armed by the next clear reading, so a picket fence gives one per flag)
      const useGate = this.options.timingMode === 'device' && viaGate !== undefined;
      this.eventLog.push(
        `${beam.info.label}: browser ${viaBrowser.toFixed(4)} s · gate ${viaGate === undefined ? 'no timestamp' : `${viaGate.toFixed(4)} s`}${useGate ? '' : ' — using browser time'}`,
      );
      this.emit({ type: 'blocked', gateId: beam.info.id, time: useGate ? (viaGate as number) : viaBrowser, receiveTime: viaBrowser });
    }
  }

  /**
   * Enable the firmware-timed Object Velocity / Object Acceleration channels (timed inside the gate at 1 µs). The library disables
   * channels that a newly enabled channel is mutually exclusive with, so the enabled list is shown in the diagnostics.
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
        if (s.value === null || !Number.isFinite(s.value)) return;
        const receive = performance.now() / 1000 - this.clockZero;
        const devId = this.deviceIdOf(device);
        const gate = this.gateTime(devId, sensor.number);
        this.emit({ type: 'object', kind, value: s.value, time: this.options.timingMode === 'device' && gate !== undefined ? gate : receive, receiveTime: receive, deviceId: devId });
      });
      this.diag.push(`${devName}: enabled "${sensor.name}" (channel ${sensor.number}, ${sensor.unit || 'no unit'})`);
    }
  }

  private deviceIdOf(device: GdxDevice): string {
    return this.beams.find((b) => b.device === device)?.deviceId ?? '';
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
