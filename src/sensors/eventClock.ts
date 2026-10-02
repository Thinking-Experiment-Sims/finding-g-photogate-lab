/**
 * Puts one Go Direct device's own microsecond clock on the browser's clock.
 *
 * Inside ONE gate, timestamps are exact (1 µs): differences between its beams, and its velocity, need no alignment at all.
 * To compare gates that are DIFFERENT devices, their clocks (each starting at its own zero) must be aligned. Every packet gives
 *     arrival − timestamp = (device zero in browser time) + (Bluetooth latency ≥ the smallest latency seen),
 * so the MINIMUM over many packets estimates the device zero plus the best-case latency. More packets → closer to the floor.
 * Two devices end up on one timeline to within roughly the difference of their best-case latencies.
 */
export class EventClock {
  private offset = Infinity;
  private lo = Infinity;
  private hi = -Infinity;
  private count = 0;
  private lastTs = 0;
  private wraps = 0;

  /** The timestamp is uint32 microseconds, so it wraps every 2³² µs (~71.6 min). Unwrap to a monotonic value. */
  unwrap(tsUs: number): number {
    if (tsUs < this.lastTs - 2 ** 31) this.wraps += 1;
    this.lastTs = tsUs;
    return tsUs + this.wraps * 2 ** 32;
  }

  reset() {
    this.offset = Infinity;
    this.lo = Infinity;
    this.hi = -Infinity;
    this.count = 0;
    this.lastTs = 0;
    this.wraps = 0;
  }

  /** Call for EVERY packet (any channel). Returns the unwrapped timestamp. */
  observe(arrivalSec: number, tsUs: number): number {
    const t = this.unwrap(tsUs);
    const candidate = arrivalSec - t / 1e6;
    this.offset = Math.min(this.offset, candidate);
    this.lo = Math.min(this.lo, candidate);
    this.hi = Math.max(this.hi, candidate);
    this.count += 1;
    return t;
  }

  /** Browser-clock time (s) of a device timestamp. Requires at least one observe(). */
  toBrowser(unwrappedUs: number): number {
    return this.offset + unwrappedUs / 1e6;
  }

  /** How well-aligned this device is: packets seen, and the spread of arrival latencies (a jitter indicator). */
  stats(): { packets: number; spreadMs: number } {
    return { packets: this.count, spreadMs: this.count ? (this.hi - this.lo) * 1000 : 0 };
  }
}
