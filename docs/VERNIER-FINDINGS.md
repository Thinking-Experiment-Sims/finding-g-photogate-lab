# Vernier Go Direct Photogate — integration findings

Written by Claude (branch `claude/photogate-lab`) from the **source code of `@vernier/godirect` v1.8.3** and Vernier's
published `gdx_photogate.html` example. **None of this has been tested with real hardware.** Treat every "should" below as
an untested assumption.

## The spec's six questions

1. **Browser requirements.** Web Bluetooth (and WebHID for USB) only. Chrome and Edge on Mac, Windows, ChromeOS, Linux and
   Android. **Not** Safari (any platform, including iPad) and **not** Firefox. The page must be served over HTTPS (GitHub
   Pages is) and the device chooser must be opened from a user gesture (a click).
2. **Web Bluetooth / WebHID.** Bluetooth: `navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'GDX-VPG' }],
   optionalServices: ['d91714ef-28b9-4f91-ba16-f0d9a604f112'] })`, then `godirect.createDevice(bleDevice)`. This is exactly
   what Vernier's photogate example does. The library's own `godirect.selectDevice()` filters on the broader `GDX` prefix
   (any Go Direct sensor), so we call `requestDevice` ourselves to show only photogates.
3. **Photogate channels.** In Vernier's example, **sensor channel 4 is "Gate 1"** and reads `1` when the beam is blocked,
   `0` when clear. We read only that channel. Other channels (e.g. pulse time, gate 2, "time in gate") exist but are not
   documented in the library; we did not use them.
4. **Event/timing data format.** *This is the major risk.* The library delivers a stream of **sampled values** through
   `sensor.on('value-changed')`. It does **not** expose a device timestamp: the `START_TIME`, `DROPPED` and `PERIOD` packets
   are explicitly ignored (`Device._processMeasurements`). The minimum sampling period is 10 ms. One BLE packet can carry
   several samples (`valueCount` loop) and the library fires `value-changed` for all of them back-to-back in the same
   instant.
5. **Multiple gates at once.** Web Bluetooth allows several simultaneous connections in Chrome; each gate needs its own
   click on "Connect a photogate" (one chooser per device). We expect this to work but have not verified how many Chrome and
   a given Chromebook/Mac Bluetooth radio will sustain.
6. **Browser security limits.** User gesture required for every `requestDevice`; no silent reconnect after a page reload;
   HTTPS only; Chrome shows its own chooser UI, which we cannot style.

## Why timing may be unreliable (read before trusting a real-hardware *g*)

`GoDirectPhotogateSource` stamps each "beam blocked" event with `performance.now()` **when the browser receives it**.
That means every gate time carries Bluetooth delivery jitter. Free fall over ~1 m takes ~0.45 s, and the intervals between
adjacent gates are 0.03–0.1 s. Typical BLE jitter is **10–50 ms** — the same size as the intervals we are trying to
measure. Specific hazards:

- **Jitter** is added independently to each gate, scrambling small intervals.
- **Batched samples.** Several samples in one packet share one receive time, so two gates (or two transitions) can collapse
  to the same instant.
- **No shared clock** between separate Go Direct devices. Their internal clocks are unsynchronized, and the library does
  not give us a way to align them.
- **10 ms sampling** is itself ~2 % of a 0.45 s drop.

Likely better approaches to investigate with hardware in hand:

1. Use the device's own **sample index × period** as the timestamp instead of receive time (needs `keepValues` and care
   about dropped packets), then still deal with the unsynchronized starts across devices.
2. Find out whether the Go Direct Photogate exposes an **aperiodic, device-timestamped** channel (the way Graphical
   Analysis gets its gate-timing data) and whether `@vernier/godirect` can read it. If not, ask Vernier.
3. Use **one** photogate with a picket fence (many timestamps, one clock). This sidesteps the multi-device clock problem
   entirely, at the cost of a different lab design.

## Recommendation

Ship the simulated workflow first. Before using Vernier mode with students, run a calibration test with real gates: drop the
same object 10 times and check that the spread of the measured *g* is acceptable. The UI labels Vernier mode
"experimental — times approximate" for this reason.
