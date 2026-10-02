import { useEffect, useRef, useState } from 'react';
import { fmt } from '../format';
import { analyzeFence, type FenceCapture } from '../physics/picketFence';
import { GoDirectPhotogateSource, webBluetoothSupported } from '../sensors/GoDirectPhotogateSource';
import type { SourceEvent } from '../sensors/types';
import { parsePosition } from '../experiments/fallingMotion/model';

/** Builds the plain-text report a teacher can paste into a chat or a note. */
function reportText(pitchCm: string, c: FenceCapture, diag: string[], summary: string[]): string {
  return [
    'PICKET FENCE CHECK',
    `flag spacing: ${pitchCm} cm`,
    ...summary,
    '',
    `gate-1 blocked times (s, browser clock): ${c.blocked.map((t) => t.toFixed(4)).join(', ') || 'none'}`,
    `Object Velocity values (m/s): ${c.velocities.map((v) => v.toFixed(4)).join(', ') || 'none'}`,
    `Object Acceleration values (m/s²): ${c.accelerations.map((v) => v.toFixed(4)).join(', ') || 'none'}`,
    '',
    'TROUBLESHOOTING PANEL',
    ...diag,
  ].join('\n');
}

export function FenceCheck({ onBack }: { onBack: () => void }) {
  const sourceRef = useRef<GoDirectPhotogateSource | null>(null);
  const capture = useRef<FenceCapture>({ pitch: 0.05, blocked: [], velocities: [], accelerations: [] });
  const [, bump] = useState(0);
  const [pitchText, setPitchText] = useState('5.0');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [summary, setSummary] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  if (!sourceRef.current) {
    const s = new GoDirectPhotogateSource();
    s.objectChannels = true; // also enable the firmware-timed Object Velocity / Acceleration channels
    sourceRef.current = s;
  }
  const src = sourceRef.current;

  useEffect(() => {
    const off = src.subscribe((e: SourceEvent) => {
      if (running) {
        if (e.type === 'blocked' && src.gates().find((g) => g.id === e.gateId)?.label.includes('beam 1')) capture.current.blocked.push(e.time);
        if (e.type === 'object' && e.kind === 'velocity') capture.current.velocities.push(e.value);
        if (e.type === 'object' && e.kind === 'acceleration') capture.current.accelerations.push(e.value);
      }
      bump((n) => n + 1);
    });
    return () => {
      off();
    };
  }, [src, running]);
  useEffect(() => () => src.dispose(), [src]);

  const connect = async () => {
    setError(null);
    try {
      await src.addGate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/cancel|chosen|No device selected/i.test(msg)) setError(msg);
    }
    bump((n) => n + 1);
  };

  const start = () => {
    capture.current = { pitch: 0.05, blocked: [], velocities: [], accelerations: [] };
    setReport(null);
    setSummary([]);
    src.arm();
    setRunning(true);
  };

  const stop = () => {
    src.disarm();
    setRunning(false);
    const pitchCm = parsePosition(pitchText);
    const c: FenceCapture = { ...capture.current, pitch: pitchCm === null ? NaN : pitchCm / 100 };
    const res = analyzeFence(c);
    const lines: string[] = [];
    if (res.ok) {
      const r = res.value;
      lines.push(
        `flags analysed: ${r.flags} (blocked events ${r.blockedCount}, velocity values ${r.velocityCount})`,
        `g from firmware velocities (no timing): ${fmt(r.gFromVelocities, 3)}${r.gFromVelocitiesSigma !== undefined ? ` ± ${fmt(r.gFromVelocitiesSigma, 3)}` : ''} m/s²`,
        `g from Object Acceleration channel: ${r.gFromAccelChannel !== undefined ? fmt(r.gFromAccelChannel, 3) : 'no values'} m/s²`,
        `g from browser-time stamps (what the lab's time path gives): ${r.gFromBrowserTimes !== undefined ? fmt(r.gFromBrowserTimes, 3) : '—'} m/s²`,
        `Bluetooth timing error per flag gap: mean ${fmt(r.intervalErrorMeanMs, 2)} ms, SD ${fmt(r.intervalErrorSdMs, 2)} ms`,
      );
    } else {
      lines.push(`could not analyse: ${res.reason}`);
    }
    setSummary(lines);
    setReport(reportText(pitchText, c, src.diagnostics(), lines));
  };

  const gates = src.gates();
  const cap = capture.current;
  return (
    <section className="card" aria-label="Picket fence check">
      <div className="source-bar">
        <span className="badge amber">Hardware check · experimental</span>
        <strong>Picket fence check: measure the timing error with ONE photogate</strong>
        <button className="btn btn-quiet" onClick={onBack}>← Back</button>
      </div>
      <p>
        A picket fence passes many flags through one photogate on one clock, and the gate’s own firmware reports each flag’s speed to about 0.01%. This check uses those
        speeds as the truth, then shows how far off the app’s Bluetooth timing is on the same drop. It does not affect the lab.
      </p>
      {!webBluetoothSupported() && <div className="callout warn"><strong>To connect Vernier sensors, open this page in Google Chrome</strong> (or Microsoft Edge).</div>}
      {error && <div className="callout warn" role="alert">{error}</div>}

      <ol className="steps-list">
        <li>
          <button className="btn" onClick={connect}>Connect the photogate</button>{' '}
          {gates.length > 0 ? <strong>Connected: {gates[0].groupLabel ?? gates[0].label}</strong> : <span className="hint">Connect only one photogate.</span>}
        </li>
        <li>
          Flag spacing, <strong>leading edge to leading edge</strong> of neighboring flags:{' '}
          <input className="num-input" style={{ width: 90 }} inputMode="decimal" aria-label="Flag spacing in centimeters" value={pitchText} onChange={(e) => setPitchText(e.target.value)} /> cm
          <span className="hint"> (Measure it on your fence. Vernier’s is typically 5.0 cm.)</span>
        </li>
        <li>
          {!running ? (
            <button className="btn btn-primary" disabled={gates.length === 0} onClick={start}>Start capture</button>
          ) : (
            <button className="btn btn-accent" onClick={stop}>Stop &amp; analyze</button>
          )}{' '}
          {running ? <span className="armed-note">Capturing — drop the fence through the gate, then press Stop.</span> : <span className="hint">Hold the fence above the gate, press Start, release it so it falls straight through, catch it below.</span>}
        </li>
      </ol>

      <p className="status-line" aria-live="polite">
        Captured so far: {cap.blocked.length} flag{cap.blocked.length === 1 ? '' : 's'} blocked, {cap.velocities.length} velocity value{cap.velocities.length === 1 ? '' : 's'}, {cap.accelerations.length} acceleration value{cap.accelerations.length === 1 ? '' : 's'}.
      </p>

      {summary.length > 0 && (
        <div className="eq-box teal">
          <div className="eq-title">Result</div>
          {summary.map((l) => (
            <div key={l} className="meaning">{l}</div>
          ))}
        </div>
      )}
      {report && (
        <div>
          <div className="actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                void navigator.clipboard?.writeText(report).then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied ✓' : 'Copy report'}
            </button>
            <span className="hint">Paste this report into the chat so the timing can be fixed.</span>
          </div>
          <pre className="diag">{report}</pre>
        </div>
      )}
      <details className="reveal">
        <summary>Troubleshooting: what the photogate reports</summary>
        <pre className="diag">{src.diagnostics().join('\n') || 'Nothing connected yet.'}</pre>
      </details>
    </section>
  );
}
