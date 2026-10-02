import { describe, expect, it } from 'vitest';
import { EventClock } from './eventClock';
import { hexToBytes, parseEventPacket } from './goDirectPackets';

// REAL packets captured from a Go Direct Photogate (GDX-VPG) on 2026-10-02: a hand/object passing through both beams.
const REAL = {
  gate1Block: '20 14 02 ed 0b ef 04 01 01 00 00 00 61 af a7 00 00 00 00 00',
  gate2Block: '20 14 03 80 0b ef 05 01 01 00 00 00 8f 11 a8 00 00 00 00 00',
  velocity: '20 14 04 b8 0a ef 01 01 47 b5 4b 3f 78 e0 a7 00 00 00 00 00',
  gate1Unblock: '20 14 05 17 0b ef 04 01 00 00 00 00 29 0b ab 00 00 00 00 00',
  gate2Unblock: '20 14 06 64 0b ef 05 01 00 00 00 00 59 26 ab 00 00 00 00 00',
  initial: '20 14 00 33 0b ef 04 01 00 00 00 00 00 00 00 00 00 00 00 00',
};
const parse = (hex: string) => parseEventPacket(hexToBytes(hex))!;

describe('parseEventPacket on real Go Direct Photogate packets', () => {
  it('decodes gate-state events with microsecond timestamps', () => {
    const a = parse(REAL.gate1Block);
    expect(a).toMatchObject({ subtype: 0x0b, channel: 4 });
    expect(a.samples[0]).toEqual({ value: 1, tsUs: 10989409 });
    expect(parse(REAL.gate2Block).samples[0]).toEqual({ value: 1, tsUs: 11014543 });
    expect(parse(REAL.gate1Unblock).samples[0]).toEqual({ value: 0, tsUs: 11209513 });
    expect(parse(REAL.initial).samples[0]).toEqual({ value: 0, tsUs: 0 });
  });

  it('the firmware velocity equals 2.0 cm ÷ the pulse time between the beams, to 4 digits', () => {
    const pulse = (parse(REAL.gate2Block).samples[0].tsUs - parse(REAL.gate1Block).samples[0].tsUs) / 1e6;
    const v = parse(REAL.velocity);
    expect(v).toMatchObject({ subtype: 0x0a, channel: 1 });
    expect(pulse).toBeCloseTo(0.025134, 6);
    expect(0.02 / pulse).toBeCloseTo(v.samples[0].value, 4); // 0.79573 vs the firmware's 0.7957
  });

  it("the velocity's timestamp is the mid-time between the two beams being blocked", () => {
    const mid = (parse(REAL.gate1Block).samples[0].tsUs + parse(REAL.gate2Block).samples[0].tsUs) / 2;
    expect(parse(REAL.velocity).samples[0].tsUs).toBe(mid);
  });

  it('ignores other packets and short or malformed ones without throwing', () => {
    expect(parseEventPacket(hexToBytes('00 14 00 33 0b ef 04 01'))).toBeNull(); // too short, not a measurement
    expect(parseEventPacket(hexToBytes('20 14 00 33 06 ef 04 01 00 00 00 00 00 00 00 00'))).toBeNull(); // periodic subtype
    expect(parseEventPacket(new Uint8Array(0))).toBeNull();
  });
});

describe('EventClock', () => {
  it('uses the real packets: both beams of one gate keep their exact 25.134 ms spacing on the browser clock', () => {
    const c = new EventClock();
    // browser arrival times from the same capture (s)
    const a1 = c.observe(37.652, parse(REAL.gate1Block).samples[0].tsUs);
    const a2 = c.observe(37.684, parse(REAL.gate2Block).samples[0].tsUs);
    expect(c.toBrowser(a2) - c.toBrowser(a1)).toBeCloseTo(0.025134, 9); // browser jitter (32 ms) is gone
  });

  it('aligns two unsynchronized devices to within the latency spread after enough events', () => {
    function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296); }
    const r = rng(9);
    let errFew = 0;
    let errMany = 0;
    for (let trial = 0; trial < 300; trial++) {
      const zeroA = 100 + r(); // each device's clock zero in browser time
      const zeroB = 100 + r();
      const A = new EventClock();
      const B = new EventClock();
      const event = (clock: EventClock, zero: number) => {
        const t = 1 + r() * 20; // device time of an event (s)
        const arrival = zero + t + 0.02 + 0.03 * r(); // 20–50 ms Bluetooth latency
        return clock.observe(arrival, Math.round(t * 1e6));
      };
      for (let i = 0; i < 5; i++) { event(A, zeroA); event(B, zeroB); }
      errFew += Math.abs(A.toBrowser(5e6) - zeroA - 5 - (B.toBrowser(5e6) - zeroB - 5));
      for (let i = 0; i < 25; i++) { event(A, zeroA); event(B, zeroB); }
      errMany += Math.abs(A.toBrowser(5e6) - zeroA - 5 - (B.toBrowser(5e6) - zeroB - 5));
    }
    expect(errMany).toBeLessThan(errFew); // more events → better alignment
    expect(errFew / 300).toBeLessThan(0.012); // 10 events: ~ a few ms
    expect(errMany / 300).toBeLessThan(0.004); // 60 events: ~ 1-2 ms
  });

  it('unwraps the 32-bit microsecond counter (wraps every ~71.6 minutes) and resets', () => {
    const c = new EventClock();
    const before = c.unwrap(4_290_000_000);
    const after = c.unwrap(1_000_000);
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeCloseTo(1_000_000 + (2 ** 32 - 4_290_000_000), 0);
    c.reset();
    expect(c.stats().packets).toBe(0);
  });
});
