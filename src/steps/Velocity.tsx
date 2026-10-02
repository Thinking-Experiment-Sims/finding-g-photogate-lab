import { useState } from 'react';
import { Chart, sampleCurve } from '../components/Chart';
import { fmt, fmtSigned } from '../format';
import { tangentOnFit, velocityFit } from '../physics/kinematics';
import { evalQuadratic, type QuadraticFit } from '../physics/regression';
import type { Datum, VelRecord } from './types';

interface Props {
  data: Datum[];
  fit: QuadraticFit;
  records: VelRecord[];
  setRecords: (r: VelRecord[]) => void;
  onNext: () => void;
}

const sameTime = (a: number, b: number) => Math.abs(a - b) < 2e-3;

export function Velocity({ data, fit, records, setRecords, onNext }: Props) {
  const tmax = Math.max(...data.map((d) => d.t), 0.001);
  // The tangent lives on the fitted curve only, never on a data point. Start partway along so it is not sitting on a gate.
  const [t, setT] = useState(tmax * 0.37);
  const tg = tangentOnFit(fit, t);
  const span = tmax * 0.22;
  const tangentLine = [
    { x: Math.max(0, t - span), y: tg.y + tg.slope * (Math.max(0, t - span) - t) },
    { x: t + span, y: tg.y + tg.slope * span },
  ];

  const sortedRecords = [...records].sort((a, b) => a.t - b.t);
  const vFit = velocityFit(records);
  const record = (rt: number, v: number) => setRecords([...records.filter((r) => !sameTime(r.t, rt)), { t: rt, v }]);
  const m = vFit.ok ? vFit.value : null;
  // Axis range from the position fit's end-point speed, so the empty graph is sized sensibly before any point is recorded.
  const vAxisMin = Math.min(2 * fit.A * tmax + fit.B, fit.B, ...records.map((r) => r.v)) * 1.1;

  return (
    <div className="step-grid">
      <section className="card graph-card">
        <h2>Position vs. time — the tangent line</h2>
        <div className="controls">
          <div className="readout-row">
            <span>
              <label htmlFor="tslider">
                Move <i>t</i>: <strong>{fmt(t, 3)} s</strong>
              </label>
            </span>
            <span>
              Tangent slope = <strong className="result">{fmtSigned(tg.slope, 3)} m/s</strong>
            </span>
            <button className="btn btn-accent" onClick={() => record(t, tg.slope)}>
              Record this velocity
            </button>
          </div>
          <div className="slider-row">
            <input id="tslider" type="range" min={0} max={tmax} step="any" value={t} onChange={(e) => setT(Number(e.target.value))} />
          </div>
          <p className="hint">Drag the slider: the point and its tangent line slide along the fitted curve. The slope of the tangent line is the object’s velocity at that instant.</p>
        </div>
        <Chart
          xLabel="Time, t (s)"
          yLabel="Height, y (m)"
          includeX={[0]}
          dots={[
            { points: data.map((d) => ({ x: d.t, y: d.y })) },
            { points: [{ x: t, y: tg.y }], color: 'var(--amber)', r: 10 },
            { points: records.map((r) => ({ x: r.t, y: evalQuadratic(fit, r.t) })), color: 'var(--amber)', r: 5 },
          ]}
          lines={[
            { points: sampleCurve((x) => evalQuadratic(fit, x), 0, tmax * 1.03) },
            { points: tangentLine, color: 'var(--amber)', width: 4 },
          ]}
          ariaLabel="Position versus time with a tangent line"
        />
      </section>

      <section className="card guide-card">
        <h2>Velocity vs. time</h2>
        <p className="think">
          <strong>Think first.</strong> Slide <i>t</i> along the curve. Where is the tangent steepest in magnitude? What happens to the velocity as the object falls? Record at least 3 times and look at the pattern.
        </p>
        <Chart
          xLabel="Time, t (s)"
          yLabel="Velocity, v (m/s)"
          includeX={[0, tmax * 1.03]}
          includeY={[0, vAxisMin]}
          dots={[{ points: sortedRecords.map((r) => ({ x: r.t, y: r.v })), color: 'var(--amber)' }]}
          lines={m ? [{ points: [{ x: 0, y: m.b }, { x: tmax * 1.03, y: m.m * tmax * 1.03 + m.b }] }] : []}
          note={m ? `v(t) = ${fmt(m.m, 2)} t ${fmtSigned(m.b, 2)}` : undefined}
          ariaLabel="Velocity versus time graph built from recorded tangent slopes"
          compact
        />
        {sortedRecords.length > 0 && (
          <div className="mini-table">
            {sortedRecords.map((r) => (
              <span key={r.t} className="chip">
                t = {fmt(r.t, 3)} s → v = {fmtSigned(r.v, 2)} m/s
                <button aria-label={`Remove the point at ${fmt(r.t, 3)} seconds`} onClick={() => setRecords(records.filter((x) => x !== r))}>✕</button>
              </span>
            ))}
            <button className="btn btn-quiet" onClick={() => setRecords([])}>Clear all</button>
          </div>
        )}
        {records.length >= 2 && m && (
          <div className="eq-box teal">
            <div className="eq-title">Straight-line fit</div>
            <div className="eq big"><i>v</i>(<i>t</i>) = <i>m</i><i>t</i> + <i>b</i> = {fmt(m.m, 3)} <i>t</i> {fmtSigned(m.b, 3)} &nbsp; (<i>R</i>² = {fmt(m.r2, 5)})</div>
            <p className="meaning">
              Slope of a velocity graph = <strong>acceleration</strong>: <i>a</i> = <i>m</i> = {fmtSigned(m.m, 2)} m/s², so <i>g</i> = <span className="result">{fmt(Math.abs(m.m), 2)} m/s²</span>. The intercept <i>b</i> = {fmtSigned(m.b, 2)} m/s is the velocity at the first gate.
            </p>
          </div>
        )}
        {records.length < 2 && <div className="callout">Record 2 or more velocities to fit a line.</div>}
        {records.length >= 3 && m && (
          <details className="reveal">
            <summary>Check against calculus</summary>
            <p>
              For <i>y</i>(<i>t</i>) = <i>A</i><i>t</i>² + <i>B</i><i>t</i> + <i>C</i>, the slope at any time is <i>v</i>(<i>t</i>) = 2<i>A</i><i>t</i> + <i>B</i> = {fmt(2 * fit.A, 3)} <i>t</i> {fmtSigned(fit.B, 3)}. The tangents you drew are on the fitted curve, so your velocity graph should follow this line, and its slope should match 2<i>A</i> from the position fit.
            </p>
          </details>
        )}
        <div className="next-row">
          <button className="btn btn-primary btn-large" onClick={onNext}>
            Linearize the position graph →
          </button>
        </div>
      </section>
    </div>
  );
}
