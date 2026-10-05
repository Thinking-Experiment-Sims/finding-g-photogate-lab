import { Stand } from '../components/Stand';
import { fmt } from '../format';
import { parsePosition, readiness, rowStatuses, type GateRow, type SavedPoint } from '../experiments/fallingMotion/model';
import { percentDifference } from '../physics/kinematics';
import type { SimulatedPhotogateSource } from '../sensors/SimulatedPhotogateSource';
import type { GateInfo, PhotogateSource } from '../sensors/types';
import { webBluetoothSupported } from '../sensors/GoDirectPhotogateSource';

export type Mode = 'simulated' | 'vernier' | 'example';

interface Props {
  mode: Mode;
  source: PhotogateSource | null;
  /** One row per STATION (a photogate, or a simulated gate): crease height + mean beam time. */
  rows: GateRow[];
  /** Raw per-beam rows (two per Go Direct photogate). */
  beamRows: GateRow[];
  saved: SavedPoint[];
  onKeep: () => void;
  onClearSaved: () => void;
  /** Why analysis is not available yet, or null when it is. */
  analysisBlocker: string | null;
  beams: Record<string, GateInfo['beam']>;
  armed: boolean;
  error: string | null;
  creases: Record<string, string>;
  onCrease: (group: string, text: string) => void;
  onPosition: (gateId: string, text: string) => void;
  onAddGate: () => void;
  onRemoveGate: (gateId: string) => void;
  onSort: () => void;
  onRefresh: () => void;
  /** The stand geometry changed, so any recorded times no longer match the heights. */
  onStandMoved: () => void;
  onCopyStandHeights?: () => void;
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
  const groupIds = [...new Set(p.beamRows.filter((r) => r.groupId).map((r) => r.groupId as string))];
  const grouped = groupIds.length > 0;
  const missingHeights = grouped ? groupIds.filter((g) => parsePosition(p.creases[g] ?? '') === null).length : ready.missingPositions;
  const t0 = Math.min(...p.rows.filter((r) => r.rawTime !== null).map((r) => r.rawTime as number));
  const stationOf = (g: string) => p.rows.find((r) => r.gateId === g)!;
  const savedDrops = new Set(p.saved.map((x) => x.drop)).size;
  const sim = p.mode === 'simulated' ? (p.source as SimulatedPhotogateSource) : null;

  const velGates = p.rows
    .filter((r) => r.velocity !== null && r.velocity !== undefined && parsePosition(r.positionText) !== null && r.rawTime !== null)
    .map((r) => ({ y: parsePosition(r.positionText)!, v: r.velocity!, t: r.rawTime!, label: r.label }))
    .sort((a, b) => a.t - b.t);

  const directTwoGate = velGates.length >= 2 ? (() => {
    const g1 = velGates[0];
    const g2 = velGates[velGates.length - 1];
    const dy = Math.abs(g1.y - g2.y);
    if (dy > 0.01) {
      const gVal = Math.abs(g2.v * g2.v - g1.v * g1.v) / (2 * dy);
      return { g1, g2, dy, gVal };
    }
    return null;
  })() : null;

  return (
    <div className="collect">
      <div className="source-bar">
        <span className="badge">{p.mode === 'vernier' ? 'Hardware (experimental)' : 'Simulated data'}</span>
        <strong>{MODE_NAME[p.mode]}</strong>
        <button className="btn btn-quiet" onClick={p.onChangeSource}>
          {p.mode === 'vernier' ? 'Disconnect gates & change source' : 'Change data source'}
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
            <div className="callout" style={{ borderLeft: '4px solid var(--teal)' }}>
              {webBluetoothSupported() ? (
                <>
                  <p>
                    1. <strong>Turn on each photogate:</strong> ensure the power LED is flashing red/green (ready to pair, not connected elsewhere).<br/>
                    2. Click <strong>Connect a photogate</strong> below to pair each gate in Chrome (device names start with <strong>GDX-</strong>).<br/>
                    3. <strong>Wave your hand through each photogate</strong>: its row indicator lights up below so you can identify Gate 1 vs. Gate 2.
                  </p>
                </>
              ) : (
                <p>
                  <strong>To connect Vernier sensors, open this page in Google Chrome</strong> (or Microsoft Edge). You can still use the simulated drop in any browser.
                </p>
              )}
              <p>
                <strong>What height do I measure?</strong> Each photogate has two internal beams about 2 cm apart. Measure the height of the <strong>crease between the two beams</strong> (the center line of the gate) up from the table, and enter that one number for the gate.
              </p>
            </div>
          )}

          {p.mode === 'vernier' && p.source?.diagnostics && (
            <details className="reveal">
              <summary>Troubleshooting: what the photogates report</summary>
              {p.source.options && (
                <div className="opts">
                  <fieldset className="choice">
                    <legend>Timing method</legend>
                    {(['device', 'receive'] as const).map((m) => (
                      <label key={m} className={p.source!.options!.timingMode === m ? 'pill on' : 'pill'}>
                        <input
                          type="radio"
                          name="timingMode"
                          checked={p.source!.options!.timingMode === m}
                          onChange={() => { p.source!.options!.timingMode = m; p.onRefresh(); }}
                        />
                        {m === 'device' ? 'Gate’s own timestamps (recommended)' : 'When the browser receives it (less accurate)'}
                      </label>
                    ))}
                  </fieldset>
                </div>
              )}
              <pre className="diag">{p.source.diagnostics().join('\n') || 'Nothing connected yet.'}</pre>
            </details>
          )}

          {p.error && (
            <div className="callout warn" role="alert">
              {p.error}
            </div>
          )}

          {grouped ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Photogate</th>
                    <th scope="col">
                      Crease height <i>y</i> (m)
                      <span className="th-sub">between the two beams, up from the table</span>
                    </th>
                    <th scope="col">
                      Gate time <i>t</i> (s)
                      <span className="th-sub">mean of its two beams; 0 at the first gate</span>
                    </th>
                    <th scope="col" className="sr-only">Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {groupIds.map((g) => {
                    const members = p.beamRows.filter((r) => r.groupId === g);
                    const st = stationOf(g);
                    const stStatus = status[p.rows.indexOf(st)];
                    const live = members.some((m) => p.beams[m.gateId] === 'blocked');
                    const text = p.creases[g] ?? '';
                    const msg = stStatus.problems.find((x) => !x.startsWith('No time'));
                    return (
                      <tr key={g} className={live ? 'live' : undefined}>
                        <th scope="row">
                          {members.map((m) => (
                            <span key={m.gateId} className={p.beams[m.gateId] === 'blocked' ? 'beam-dot on' : m.rawTime !== null ? 'beam-dot done' : 'beam-dot'} aria-hidden="true" />
                          ))}
                          {members[0].groupLabel ?? 'Photogate'}
                          {live && <span className="sr-only"> (beam blocked)</span>}
                          {members.length !== 2 && (
                            <div className="field-msg">
                              This photogate reports {members.length} beam channel{members.length === 1 ? '' : 's'} (expected 2). See Troubleshooting.
                            </div>
                          )}
                        </th>
                        <td>
                          <input
                            className={msg && text.trim() !== '' ? 'num-input invalid' : 'num-input'}
                            inputMode="decimal"
                            aria-label={`${members[0].groupLabel ?? 'Photogate'} crease height in meters`}
                            placeholder="e.g. 0.640"
                            value={text}
                            onChange={(e) => p.onCrease(g, e.target.value)}
                          />
                          {msg && text.trim() !== '' && <div className="field-msg">{msg}</div>}
                        </td>
                        <td className={stStatus.time === null ? 'time pending' : 'time'}>
                          {stStatus.time === null ? 'waiting…' : fmt(stStatus.time, 4)}
                          {stStatus.time !== null && (
                            <div className="beam-times">
                              beams: {members.map((m) => (m.rawTime === null ? '—' : fmt(m.rawTime - t0, 4))).join(' / ')} s{st.velocity !== null && st.velocity !== undefined && <> · v = {fmt(st.velocity, 3)} m/s</>}
                            </div>
                          )}
                        </td>
                        <td>
                          <button className="btn btn-icon" aria-label={`Remove ${members[0].groupLabel ?? 'photogate'}`} onClick={() => p.onRemoveGate(g)}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
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
                      <td className={s.time === null ? "time pending" : "time"}>
                        {s.time === null ? "waiting…" : fmt(s.time, 4)}
                        {r.velocity !== null && r.velocity !== undefined && s.time !== null && (
                          <div className="beam-times">v = {fmt(r.velocity, 3)} m/s</div>
                        )}
                      </td>
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

          )}

          <p className="status-line" aria-live="polite">
            {missingHeights > 0 ? `Enter ${missingHeights} more ${grouped ? 'crease height' : 'height'}${missingHeights > 1 ? 's' : ''}. ` : ''}
            {p.mode !== 'example' && p.rows.length > 0 && (p.armed ? `Waiting for the drop… ${fired} of ${p.rows.length} gates triggered.` : fired === p.rows.length ? `Drop recorded: all ${fired} gates triggered.` : ready.missingTimes > 0 ? `${ready.missingTimes} gate${ready.missingTimes > 1 ? 's have' : ' has'} no time yet.` : '')}
          </p>

          <div className="actions">
            {p.mode !== 'example' && (
              <>
                {!p.armed ? (
                  <button className="btn btn-primary" disabled={p.rows.length < 2} onClick={p.onArm}>
                    {fired > 0 ? 'Run again (keep gates & heights)' : 'Arm the gates'}
                  </button>
                ) : sim ? (
                  <button className="btn btn-accent" onClick={p.onDrop}>
                    Release the object
                  </button>
                ) : (
                  <span className="armed-note">Armed — release the object now.</span>
                )}
                {p.armed && (
                  <button className="btn" onClick={p.onArm} title="Throw away this attempt's times and listen again. Your heights stay.">
                    Restart drop (keep heights)
                  </button>
                )}
                {p.onCopyStandHeights && (
                  <button className="btn" onClick={p.onCopyStandHeights} title="Set table heights to match current gate positions on the ruler">
                    Copy heights from ruler
                  </button>
                )}
                <button className={p.mode === 'vernier' ? 'btn btn-accent' : 'btn'} onClick={() => p.onAddGate()}>
                  {p.mode === 'vernier' ? 'Connect a photogate' : 'Add gate'}
                </button>
                {!grouped && <button className="btn" disabled={p.rows.length < 2} onClick={p.onSort} title="Order rows from the highest gate to the lowest">
                  Sort top → bottom
                </button>}
              </>
            )}
            <button className="btn" onClick={p.onReset} title="Clears the heights and times. Connected gates stay connected.">
              Clear heights &amp; times
            </button>
            <button className="btn" disabled={ready.usable === 0} onClick={p.onExport}>
              Export CSV
            </button>
          </div>
          {p.rows.length > 0 && p.rows.length < 2 && p.mode !== "example" && <p className="hint">You need at least 2 gates.</p>}
          {directTwoGate && (
            <div className="callout good" style={{ marginTop: "12px" }}>
              <strong>Direct 2-gate measurement (1 µs beam timing):</strong>
              <div>
                {directTwoGate.g1.label}: <i>v</i>₁ = {fmt(directTwoGate.g1.v, 3)} m/s at {fmt(directTwoGate.g1.y, 3)} m · {directTwoGate.g2.label}: <i>v</i>₂ = {fmt(directTwoGate.g2.v, 3)} m/s at {fmt(directTwoGate.g2.y, 3)} m
              </div>
              <div style={{ marginTop: "4px" }}>
                <i>g</i> = |<i>v</i>₂² − <i>v</i>₁²| / (2·Δ<i>y</i>) = <strong className="result">{fmt(directTwoGate.gVal, 2)} m/s²</strong> ({fmt(percentDifference(directTwoGate.gVal), 1)}% from 9.81 m/s²)
              </div>
            </div>
          )}

          {p.mode !== 'example' && (
            <div className="saved-box">
              <div className="actions">
                <button className="btn btn-accent" disabled={p.armed || ready.usable < 2} onClick={p.onKeep}>
                  Keep this drop &amp; run again
                </button>
                {p.saved.length > 0 && (
                  <button className="btn btn-quiet" onClick={p.onClearSaved}>
                    Clear saved drops
                  </button>
                )}
              </div>
              <p className="hint">
                {p.saved.length > 0
                  ? `Saved: ${savedDrops} drop${savedDrops === 1 ? '' : 's'} (${p.saved.length} points), pooled with the current drop. `
                  : 'Few gates? Keep this drop, move a photogate to a new height, enter its new height, and drop again. All kept drops are combined into one graph. '}
                Keep the <strong>top</strong> photogate at the same height for every drop — it is the time reference.
              </p>
              {p.saved.length > 0 && (
                <details className="reveal">
                  <summary>Saved points ({p.saved.length})</summary>
                  <table className="data-table compact">
                    <thead>
                      <tr><th>Drop</th><th>Gate</th><th>y (m)</th><th>t (s)</th></tr>
                    </thead>
                    <tbody>
                      {p.saved.map((x, i) => (
                        <tr key={i}><td>{x.drop}</td><td>{x.label}</td><td>{fmt(x.y, 3)}</td><td>{fmt(x.t, 3)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </div>
          )}

          <div className="next-row">
            <button className="btn btn-primary btn-large" disabled={p.analysisBlocker !== null} onClick={p.onNext}>
              Graph position vs. time →
            </button>
            {p.analysisBlocker && <span className="hint">{p.analysisBlocker}</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
