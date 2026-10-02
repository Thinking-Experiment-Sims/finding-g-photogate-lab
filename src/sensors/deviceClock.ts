/**
 * Maps a Go Direct device's own sample clock onto the browser's clock.
 *
 * The library gives no timestamps, but it does deliver every sample in order at a fixed period, so sample k happened at
 * k × period on the DEVICE's clock. Bluetooth delays each sample's arrival by a variable latency L ≥ L_min. For every arriving
 * sample, (arrival − k × period) = (device start in browser time) + L, so the MINIMUM over many samples estimates the device's
 * start time plus the smallest latency seen. Using that offset, an event's time is offset + k × period: jitter cancels, and two
 * unsynchronized devices land on one shared timeline within about the difference of their best-case latencies.
 *
 * Resolution is one sampling period. Assumes no dropped packets and equal clock rates (true to ~ppm over a drop).
 */
export class DeviceClock {
  private offset = Infinity;

  reset() {
    this.offset = Infinity;
  }

  /** Call for every sample. `index` counts samples since measurements (re)started; returns the sample's browser-clock time (s). */
  observe(index: number, periodSeconds: number, arrivalSeconds: number): number {
    const deviceTime = index * periodSeconds;
    this.offset = Math.min(this.offset, arrivalSeconds - deviceTime);
    return this.offset + deviceTime;
  }
}
