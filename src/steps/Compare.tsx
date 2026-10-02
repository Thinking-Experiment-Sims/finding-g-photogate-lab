import { fmt } from '../format';
import { percentDifference, STANDARD_G } from '../physics/kinematics';

export interface Estimate {
  key: string;
  method: string;
  how: string;
  g: number | null;
  /** Uncertainty (one standard error) in g, when it can be computed. */
  sigma?: number;
  /** Caution to show next to the value. */
  note?: string;
}

export function Compare({ estimates, onExport }: { estimates: Estimate[]; onExport: () => void }) {
  const have = estimates.filter((e) => e.g !== null && Number.isFinite(e.g)) as (Estimate & { g: number })[];
  const lo = Math.min(STANDARD_G - 1.5, ...have.map((e) => e.g)) - 0.3;
  const hi = Math.max(STANDARD_G + 1.5, ...have.map((e) => e.g)) + 0.3;
  const pos = (g: number) => ((g - lo) / (hi - lo)) * 100;
  const spread = have.length >= 2 ? Math.max(...have.map((e) => e.g)) - Math.min(...have.map((e) => e.g)) : null;

  return (
    <div className="step-grid single">
      <section className="card">
        <h2>Three ways to find <i>g</i></h2>
        <div className="table-wrap">
          <table className="data-table compare">
            <thead>
              <tr>
                <th scope="col">Method</th>
                <th scope="col">How it works</th>
                <th scope="col"><i>g</i> ± uncertainty (m/s²)</th>
                <th scope="col">Difference from 9.81</th>
              </tr>
            </thead>
            <tbody>
              {estimates.map((e) => (
                <tr key={e.key}>
                  <th scope="row">{e.method}</th>
                  <td>{e.how}</td>
                  <td className="result">
                    {fmt(e.g, 2)}
                    {e.sigma !== undefined && e.g !== null && <span className="sigma"> ± {fmt(e.sigma, 2)}</span>}
                    {e.note && <div className="field-msg">{e.note}</div>}
                  </td>
                  <td>{e.g === null ? 'not finished yet' : `${fmt(percentDifference(e.g), 1)} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="numberline" role="img" aria-label="Your g values compared with 9.81 meters per second squared">
          <div className="nl-track" />
          <div className="nl-ref" style={{ left: `${pos(STANDARD_G)}%` }}>
            <span>9.81</span>
          </div>
          {have.map((e, i) => (
            <div key={e.key} className="nl-dot" style={{ left: `${pos(e.g)}%` }} title={`${e.method}: ${fmt(e.g, 2)}`}>
              <span>{i + 1}</span>
            </div>
          ))}
          <div className="nl-axis">
            <span>{fmt(lo, 1)}</span>
            <span>g (m/s²)</span>
            <span>{fmt(hi, 1)}</span>
          </div>
        </div>
        {spread !== null && (
          <p className="meaning">
            Your values spread over <strong>{fmt(spread, 2)} m/s²</strong>.
          </p>
        )}

        <div className="think">
          <strong>Discuss.</strong>
          <ul>
            <li>Which values agree most closely? Why might that happen?</li>
            <li>Methods 1 and 2 both come from the same quadratic fit. Are they independent measurements? Which method depends most directly on your raw data?</li>
            <li>Which source of error matters most: your height measurements, or the gate times?</li>
          </ul>
        </div>
        <div className="actions">
          <button className="btn" onClick={onExport}>Export CSV</button>
          <button className="btn" onClick={() => window.print()}>Print this page</button>
        </div>
      </section>
    </div>
  );
}
