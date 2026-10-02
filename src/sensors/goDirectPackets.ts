/**
 * Decoder for Go Direct "aperiodic" (event) measurement packets, as sent by the Go Direct Photogate for gate-state changes
 * and firmware-computed Object Velocity / Acceleration. @vernier/godirect reads the channel and value but DISCARDS the timestamp.
 *
 * Layout, verified against real GDX-VPG packets (see the tests): 20 bytes, little-endian
 *   [0] 0x20 measurement   [1] length   [2] rolling counter   [3] checksum
 *   [4] sub-type: 0x0b = int32 value (gate state: 1 blocked, 0 clear), 0x0a = float32 value (velocity, acceleration)
 *   [5] 0xef (constant)    [6] channel number   [7] sample count
 *   then `count` samples of 8 bytes: value (4 bytes) + timestamp (uint32, MICROSECONDS on the gate's own clock,
 *   counted from when its measurements started).
 * For a velocity packet the timestamp is the mid-time of the pulse (halfway between the two beams being blocked).
 * Only count = 1 has been observed; the 8-byte-per-sample layout for count > 1 is an assumption.
 */
export interface EventSample {
  value: number;
  /** Microseconds on the gate's own clock (uint32; wraps every ~71.6 minutes: see EventClock.unwrap). */
  tsUs: number;
}

export interface EventPacket {
  /** 0x0b = int32 (gate state), 0x0a = float32 (velocity / acceleration). */
  subtype: 0x0a | 0x0b;
  channel: number;
  samples: EventSample[];
}

export function parseEventPacket(input: DataView | Uint8Array): EventPacket | null {
  const dv = input instanceof DataView ? input : new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (dv.byteLength < 16 || dv.getUint8(0) !== 0x20) return null;
  const subtype = dv.getUint8(4);
  if (subtype !== 0x0a && subtype !== 0x0b) return null;
  const channel = dv.getUint8(6);
  const count = dv.getUint8(7);
  const samples: EventSample[] = [];
  for (let i = 0; i < count && 8 + i * 8 + 8 <= dv.byteLength; i++) {
    const at = 8 + i * 8;
    const value = subtype === 0x0b ? dv.getInt32(at, true) : dv.getFloat32(at, true);
    samples.push({ value, tsUs: dv.getUint32(at + 4, true) });
  }
  return samples.length ? { subtype, channel, samples } : null;
}

export function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.trim().split(/\s+/).map((h) => parseInt(h, 16)));
}
