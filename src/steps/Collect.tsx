import { Stand } from '../components/Stand';
import { fmt } from '../format';
import { readiness, rowStatuses, type GateRow } from '../experiments/fallingMotion/model';
import type { SimulatedPhotogateSource } from '../sensors/SimulatedPhotogateSource';
import type { GateInfo, PhotogateSource } from '../sensors/types';
import { webBluetoothSupported } from '../sensors/GoDirectPhotogateSource';

export type Mode = 'simulated' | 'vernier' | 'example';

interface Props {
  mode: Mode;
  source: PhotogateSource | null;
  rows: GateRow[];
  beams: Record<string, GateInfo['beam']>;
  armed: boolean;
  error: string | null;
  onPosition: (gateId: string, text: string) => void;
  onAddGate: () => void;
  onRemoveGate: (gateId: string) => void;
  onSort: () => void;
  /** The stand geometry changed, so any recorded times no longer match the heights. */
  onStandMoved: () => void;
  onArm: () => void;
  onDrop: () => void;
  onReset: () => void;
  onExport: () => void;
  onNext: () => void;
  onChangeSource: () => void;
}

const MODE_NAME: Record<Mode, string> = {
  simulated: 'Simulated drop',
  vernier: 'Vernier Go Direct Photogates — experimental, times approximate',
  example: 'Example experiment (simulated data)',
};

export function Collect(p: Props) {
  const status = rowStatuses(p.rows);
  const ready = readiness(p.rows);
  const fired = p.rows.filter((r) => r.rawTime !== null).length;
  const sim = p.mode === 'simulated' ? (p.source as SimulatedPhotogateSource) : null;

  return (
    <div className="collect">
      <div className="source-bar">
        <span className="badge">{p.mode === 'vernier' ? 'Hardware (experimental)' : 'Simulated data'}</span>
        <strong>{MODE_NAME[p.mode]}</strong>
        <button className="btn btn-quiet" onClick={p.onChangeSource}>
          Change data source
        </button>
      </div>

      <div className={sim ? 'collect-grid with-stand' : 'collect-grid'}>
        {sim && (
          <section className="card stand-card" aria-label="Virtual stand">
            <h2>1 · Measure the heights</h2>
            <p className="hint">Drag the gates to where you want them. Then read each gate’s height from the ruler — measure <em>up from the table</em>.</p>
            <Stand source={sim} gates={p.source!.gates()} beams={p.beams} onMoved={p.onStandMoved} />
          </section>
        )}

        <section className="card table-card" aria-label="Data table">
          <h2>{sim ? '2 · Record, then drop' : 'Gate data'}</h2>

          {p.mode === 'vernier' && (
            <div className="callout">
              {webBluetoothSupported() ? (
                <p>
                  Turn on each photogate, then press <strong>Connect a photogate</strong> once per gate. <strong>Block a gate with your hand</strong> — its row
                  below lights up, so you know which height belongs to which row.
                </p>
              ) : (
                <p>
                  <strong>To connect Vernier sensors, open this page in Google Chrome</strong> (or Microsoft Edge). You can still use the simulated drop in any browser.
                </p>
              )}
            </div>
          )}

          {p.mode === 'vernier' && p.source?.diagnostics && (
            <details className="reveal">
              <summary>Troubleshooting: what the photogates report</summary>
              <pre className="diag">{p.source.diagnostics().join('\n') || 'Nothing connected yet.'}</pre>
            </details>
          )}

          {p.error && (
            <div className="callout warn" role="alert">
              {p.error}
            </div>
          )}

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Gate</th>
                  <th scope="col">
                    Height <i>y</i> (m)
                    <span className="th-sub">up from the table</span>
                  </th>
                  <th scope="col">
                    Time <i>t</i> (s)
                    <span className="th-sub">0 at the first gate</span>
                  </th>
                  <th scope="col" className="sr-only">
                    Remove
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty">
                      {p.mode === 'vernier' ? 'No photogates connected yet.' : 'No gates yet. Add a gate.'}
                    </td>
                  </tr>
                )}
                {p.rows.map((r, i) => {
                  const s = status[i];
                  const live = p.beams[r.gateId] === 'blocked';
                  const heightProblem = s.problems.find((x) => !x.startsWith('No time'));
                  return (
                    <tr key={r.gateId} className={live ? 'live' : undefined}>
                      <th scope="row">
                        <span className={live ? 'beam-dot on' : r.rawTime !== null ? 'beam-dot done' : 'beam-dot'} aria-hidden="true" />
                        {r.label}
                        {live && <span className="sr-only"> (beam blocked)</span>}
                      </th>
                      <td>
                        <input
                          className={heightProblem ? 'num-input invalid' : 'num-input'}
                          inputMode="decimal"
                          aria-label={`${r.label} height in meters`}
                          aria-invalid={!!heightProblem}
                          placeholder="e.g. 0.640"
                          value={r.positionText}
                          onChange={(e) => p.onPosition(r.gateId, e.target.value)}
                        />
                        {heightProblem && r.positionText.trim() !== '' && <div className="field-msg">{heightProblem}</div>}
                      </td>
                      <td className={s.time === null ? 'time pending' : 'time'}>{s.time === null ? 'waiting…' : fmt(s.time, 3)}</td>
                      <td>
                        {p.mode !== 'example' && (
                          <button className="btn btn-icon" aria-label={`Remove ${r.label}`} onClick={() => p.onRemoveGate(r.gateId)}>
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="status-line" aria-live="polite">
            {p.rows.length === 0
              ? ''
              : ready.missingPositions > 0
                ? `Enter ${ready.missingPositions} more height${ready.missingPositions > 1 ? 's' : ''}. `
                : ''}
            {p.mode !== 'example' && p.rows.length > 0 && (p.armed ? `Waiting for the drop… ${fired} of ${p.rows.length} gates triggered.` : fired === p.rows.length ? `Drop recorded: all ${fired} gates triggered.` : ready.missingTimes > 0 ? `${ready.missingTimes} gate${ready.missingTimes > 1 ? 's have' : ' has'} no time yet.` : '')}
          </p>

          <div className="actions">
            {p.mode !== 'example' && (
              <>
                {!p.armed ? (
                  <button className="btn btn-primary" disabled={p.rows.length < 3} onClick={p.onArm}>
                    {fired > 0 ? 'Drop again' : 'Arm the gates'}
                  </button>
                ) : sim ? (
                  <button className="btn btn-accent" onClick={p.onDrop}>
                    Release the object
                  </button>
                ) : (
                  <span className="armed-note">Armed — release the object now.</span>
                )}
                <button className="btn" onClick={p.onAddGate}>
                  {p.mode === 'vernier' ? 'Connect a photogate' : 'Add gate'}
                </button>
                <button className="btn" disabled={p.rows.length < 2} onClick={p.onSort} title="Order rows from the highest gate to the lowest">
                  Sort top → bottom
                </button>
              </>
            )}
            <button className="btn" onClick={p.onReset}>
              Reset experiment
            </button>
            <button className="btn" disabled={ready.usable === 0} onClick={p.onExport}>
              Export CSV
            </button>
          </div>
          {p.rows.length > 0 && p.rows.length < 3 && p.mode !== 'example' && <p className="hint">You need at least 3 gates.</p>}

          <div className="next-row">
            <button className="btn btn-primary btn-large" disabled={ready.usable < 3} onClick={p.onNext}>
              Graph position vs. time →
            </button>
            {ready.usable < 3 && <span className="hint">Needs 3 gates with both a height and a time.</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
