import { Chart } from '../components/Chart';
import { fmt, fmtSigned } from '../format';
import { linearizationValid, linearizedFit, X_TRANSFORMS, Y_TRANSFORMS } from '../physics/kinematics';
import type { Datum, LinState } from './types';
import { KNOWN_LINEAR, STRAIGHT_R2 } from './types';

interface Props {
  data: Datum[];
  lin: LinState;
  setLin: (l: LinState) => void;
  onNext: () => void;
}

const K_CHOICES: { k: number; label: string }[] = [
  { k: 0.5, label: '½ × slope' },
  { k: 1, label: '1 × slope' },
  { k: 2, label: '2 × slope' },
  { k: 4, label: '4 × slope' },
];

export function Linearize({ data, lin, setLin, onNext }: Props) {
  const res = linearizedFit(data, lin.xT, lin.yT);
  const xAxis = X_TRANSFORMS.find((x) => x.id === lin.xT)!;
  const yAxis = Y_TRANSFORMS.find((y) => y.id === lin.yT)!;
  const fit = res.ok ? res.value : null;
  const straight = !!fit && fit.r2 >= STRAIGHT_R2;
  const isPair = KNOWN_LINEAR.has(`${lin.xT}|${lin.yT}`);
  const valid = linearizationValid(data, lin.xT, lin.yT);
  const set = (patch: Partial<LinState>) => setLin({ ...lin, ...patch, ...('xT' in patch || 'yT' in patch ? { k: null, fitShown: false } : {}) });
  const pts = fit?.points ?? [];
  const xmax = Math.max(...pts.map((p) => p.x), 0.001);

  return (
    <div className="step-grid">
      <section className="card graph-card">
        <h2>Straighten the graph</h2>
        <Chart
          xLabel={xAxis.axis}
          yLabel={yAxis.axis}
          includeX={[0]}
          dots={[{ points: pts }]}
          lines={lin.fitShown && fit ? [{ points: [{ x: 0, y: fit.b }, { x: xmax * 1.05, y: fit.m * xmax * 1.05 + fit.b }], color: 'var(--amber)' }] : []}
          note={lin.fitShown && fit ? `y = ${fmt(fit.m, 3)} x ${fmtSigned(fit.b, 3)}   R² = ${fmt(fit.r2, 4)}` : undefined}
          ariaLabel="Linearized graph of the position data"
        />
        {res.ok && res.value.dropped > 0 && (
          <p className="hint">{res.value.dropped} point{res.value.dropped > 1 ? 's' : ''} left out: the first gate is the starting point (<i>t</i> = 0), so this quantity is undefined there.</p>
        )}
        {!res.ok && <div className="callout warn">{res.reason}</div>}
        <details className="reveal" open>
          <summary>Original position vs. time (for comparison)</summary>
          <Chart
            xLabel="Time, t (s)"
            yLabel="Height, y (m)"
            includeX={[0]}
            dots={[{ points: data.map((d) => ({ x: d.t, y: d.y })) }]}
            ariaLabel="Original position versus time graph"
          />
        </details>
      </section>

      <section className="card guide-card">
        <h2>Which variables make a straight line?</h2>
        <p className="think">
          <strong>Your goal:</strong> a graph whose points fall on a <em>straight line</em>. A straight line has a slope you can interpret. Try different quantities for each axis.
        </p>
        <fieldset className="choice">
          <legend>Horizontal axis</legend>
          {X_TRANSFORMS.map((x) => (
            <label key={x.id} className={lin.xT === x.id ? 'pill on' : 'pill'}>
              <input type="radio" name="xT" checked={lin.xT === x.id} onChange={() => set({ xT: x.id })} />
              {x.id === 't' ? <i>t</i> : x.id === 't2' ? <span><i>t</i>²</span> : <span>√<i>t</i></span>}
            </label>
          ))}
        </fieldset>
        <fieldset className="choice">
          <legend>Vertical axis</legend>
          {Y_TRANSFORMS.map((y) => (
            <label key={y.id} className={lin.yT === y.id ? 'pill on' : 'pill'}>
              <input type="radio" name="yT" checked={lin.yT === y.id} onChange={() => set({ yT: y.id })} />
              {y.id === 'y' ? <span>height <i>y</i></span> : y.id === 'dy' ? <span>Δ<i>y</i> = <i>y</i> − <i>y</i>₁</span> : <span>Δ<i>y</i> / Δ<i>t</i></span>}
            </label>
          ))}
        </fieldset>
        <div className="actions">
          <button className="btn btn-primary" disabled={!fit} onClick={() => set({ fitShown: !lin.fitShown })}>
            {lin.fitShown ? 'Hide linear fit' : 'Fit a straight line'}
          </button>
          <button className="btn" onClick={() => set({ hint: lin.hint === 2 ? 2 : ((lin.hint + 1) as 1 | 2) })}>
            {lin.hint === 0 ? 'I’m stuck — give me a hint' : 'Another hint'}
          </button>
        </div>
        {lin.hint >= 1 && (
          <div className="callout">
            <strong>Hint 1.</strong> Start from <i>y</i> = <i>y</i>₁ + <i>v</i>₀<i>t</i> + ½<i>a</i><i>t</i>² and rearrange so the right side looks like <i>mx</i> + <i>b</i>. The object is already moving at the first gate — what term does that add?
            {lin.hint >= 2 && (
              <p>
                <strong>Hint 2.</strong> Subtract <i>y</i>₁ from both sides, then divide everything by <i>t</i>. Which quantity is now on the left? Which is on the right?
              </p>
            )}
          </div>
        )}

        {lin.fitShown && fit && (
          <div className={straight ? 'eq-box teal' : 'eq-box'}>
            <div className="eq-title">{straight ? 'It looks straight' : 'Not very straight yet'}</div>
            <div className="eq big"><i>y</i> = <i>m</i><i>x</i> + <i>b</i> = {fmt(fit.m, 3)} <i>x</i> {fmtSigned(fit.b, 3)} &nbsp; (<i>R</i>² = {fmt(fit.r2, 4)})</div>
            <div className="slope-box">
              <div className="eq-title">Record your slope</div>
              <div className="eq big">
                slope <i>m</i> = <span className="result">{fmt(fit.m, 3)}{fit.seM !== undefined && <> ± {fmt(fit.seM, 3)}</>}</span>{' '}
                <span className="unit">{isPair ? 'm/s²' : 'units of vertical ÷ horizontal'}</span>
              </div>
            </div>
            {!straight && (
              <p className="meaning">
                The points still curve away from the line, so this slope is not trustworthy. A good straightening gets <i>R</i>² very close to 1 and the points scatter evenly on both sides. Try a different combination.
              </p>
            )}
            {straight && !isPair && (
              <p className="meaning">
                The points are close to a line, but this combination does not turn into a simple kinematics equation. Can you work out what its slope would mean?
              </p>
            )}
            {straight && isPair && !valid && (
              <p className="meaning">
                Careful: close to a line is not the same as <em>the right</em> line. Check that your equation really turns into <i>mx</i> + <i>b</i> for this drop. Was the object at rest at the first gate? What does that do to this graph? Try the hint.
              </p>
            )}
            <p className="meaning">
              <strong>What does the slope mean?</strong> Match your graph to <i>y</i> = <i>y</i>₁ + <i>v</i>₀<i>t</i> + ½<i>a</i><i>t</i>². Acceleration equals…
            </p>
            <div className="k-row" role="radiogroup" aria-label="Acceleration in terms of the slope">
              <span><i>a</i> =</span>
              {K_CHOICES.map((c) => (
                <label key={c.k} className={lin.k === c.k ? 'pill on' : 'pill'}>
                  <input type="radio" name="k" checked={lin.k === c.k} onChange={() => setLin({ ...lin, k: c.k })} />
                  {c.label}
                </label>
              ))}
            </div>
            {lin.k !== null && isPair && valid && lin.k !== 2 && (
              <div className="callout warn">
                Check again. If the slope is ½<i>a</i>, then <i>a</i> is how many times the slope?
              </div>
            )}
            {lin.k !== null && (
              <div className={isPair && valid && lin.k === 2 && straight ? 'callout good' : 'callout'}>
                <i>a</i> = {fmt(lin.k, lin.k === 0.5 ? 1 : 0)} × slope = {fmtSigned(lin.k * fit.m, 2)} m/s², so <i>g</i> = <span className="result">{fmt(Math.abs(lin.k * fit.m), 2)}{fit.seM !== undefined && <> ± {fmt(Math.abs(lin.k) * fit.seM, 2)}</>} m/s²</span>.
                {lin.yT === 'dy_over_t' && <> The intercept is <i>v</i>₀ = {fmtSigned(fit.b, 2)} m/s, the velocity at the first gate.</>}
                {!(isPair && valid && straight) && <> This value is only trustworthy if the graph is straight and its slope really equals <i>a</i>/2 for your drop.</>}
              </div>
            )}
          </div>
        )}
        <div className="next-row">
          <button className="btn btn-primary btn-large" onClick={onNext}>
            Compare the three values of g →
          </button>
        </div>
      </section>
    </div>
  );
}
