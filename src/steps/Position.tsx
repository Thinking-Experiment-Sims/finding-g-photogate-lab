import { Chart, sampleCurve } from '../components/Chart';
import { fmt, fmtSigned } from '../format';
import { quadraticAcceleration } from '../physics/kinematics';
import { evalQuadratic, type QuadraticFit, type Result } from '../physics/regression';
import type { Datum } from './types';

interface Props {
  data: Datum[];
  fit: Result<QuadraticFit>;
  showFit: boolean;
  onToggleFit: () => void;
  onNext: () => void;
}

export function Position({ data, fit, showFit, onToggleFit, onNext }: Props) {
  const tmax = Math.max(...data.map((d) => d.t), 0.001);
  const f = fit.ok ? fit.value : null;
  return (
    <div className="step-grid">
      <section className="card graph-card">
        <h2>
          Position vs. time
        </h2>
        <Chart
          xLabel="Time, t (s)"
          yLabel="Height, y (m)"
          includeX={[0]}
          dots={[{ points: data.map((d) => ({ x: d.t, y: d.y })) }]}
          lines={showFit && f ? [{ points: sampleCurve((t) => evalQuadratic(f, t), 0, tmax * 1.03) }] : []}
          note={showFit && f ? `y(t) = ${fmt(f.A, 2)} t² ${fmtSigned(f.B, 2)} t ${fmtSigned(f.C, 3)}` : undefined}
          ariaLabel="Position versus time graph of the photogate measurements"
        />
      </section>

      <section className="card guide-card">
        <h2>What does the graph tell you?</h2>
        <p className="think">
          <strong>Think first.</strong> The object is speeding up as it falls. Is the graph a straight line or a curve? What does the <em>steepness</em> of the graph mean?
        </p>
        <div className="actions">
          <button className="btn btn-primary" onClick={onToggleFit}>
            {showFit ? 'Hide quadratic fit' : 'Fit a quadratic curve'}
          </button>
        </div>
        {!fit.ok && <div className="callout warn">{fit.reason}</div>}
        {showFit && f && (
          <>
            <div className="eq-box">
              <div className="eq-title">Model</div>
              <div className="eq">
                <i>y</i>(<i>t</i>) = <i>A</i><i>t</i>² + <i>B</i><i>t</i> + <i>C</i>
              </div>
              <div className="eq-title">Your fit</div>
              <div className="eq big">
                <i>y</i>(<i>t</i>) = {fmt(f.A, 3)} <i>t</i>² {fmtSigned(f.B, 3)} <i>t</i> {fmtSigned(f.C, 4)}
              </div>
              <div className="coef-row">
                <span><i>A</i> = {fmt(f.A, 3)} m/s²</span>
                <span><i>B</i> = {fmt(f.B, 3)} m/s</span>
                <span><i>C</i> = {fmt(f.C, 4)} m</span>
                <span><i>R</i>² = {fmt(f.r2, 5)}</span>
              </div>
            </div>
            <div className="eq-box teal">
              <div className="eq-title">What the numbers mean physically</div>
              <p className="meaning">
                Compare with <i>y</i>(<i>t</i>) = <i>y</i>₁ + <i>v</i>₀<i>t</i> + ½<i>a</i><i>t</i>²
              </p>
              <ul className="meaning-list">
                <li>
                  <strong><i>B</i> = initial velocity</strong> at <i>t</i> = 0 (when the object passes the first gate): <i>v</i>₀ = {fmtSigned(f.B, 2)} m/s
                </li>
                <li>
                  <strong><i>a</i> = 2<i>A</i></strong> (because <i>A</i> = ½<i>a</i>): <i>a</i> = {fmtSigned(quadraticAcceleration(f), 2)} m/s²
                </li>
                <li>
                  <strong><i>g</i> = |<i>a</i>|</strong> = <span className="result">{fmt(Math.abs(quadraticAcceleration(f)), 2)}{f.seA !== undefined && <> ± {fmt(2 * f.seA, 2)}</>} m/s²</span>
                </li>
              </ul>
              <p className="hint">
                <i>a</i> is negative because up is positive and gravity pulls down. Its size is <i>g</i>.
              </p>
            </div>
          </>
        )}
        <div className="next-row">
          <button className="btn btn-primary btn-large" disabled={!fit.ok || !showFit} onClick={onNext}>
            Find velocity with tangent lines →
          </button>
          {(!fit.ok || !showFit) && <span className="hint">Fit the curve first.</span>}
        </div>
      </section>
    </div>
  );
}
