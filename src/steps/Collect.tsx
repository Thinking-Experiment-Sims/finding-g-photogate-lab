import { useState } from 'react';
import { Stand } from '../components/Stand';
import { fmt } from '../format';
import { parsePosition, readiness, relativeTimes, rowStatuses, type GateRow, type SavedPoint } from '../experiments/fallingMotion/model';
import { percentDifference } from '../physics/kinematics';
import type { SimulatedPhotogateSource } from '../sensors/SimulatedPhotogateSource';
import type { GateInfo, PhotogateSource } from '../sensors/types';
import { webBluetoothSupported } from '../sensors/GoDirectPhotogateSource';

export type Mode = 'simulated' | 'vernier' | 'example';

interface Props {
  mode: Mode;
  source: PhotogateSource | null;
  /** All beam rows (two per physical photogate). */
  rows: GateRow[];
  saved: SavedPoint[];
  onKeep: () => void;
  onClearSaved: () => void;
  /** Why analysis is not available yet, or null when it is. */
  analysisBlocker: string | null;
  beams: Record<string, GateInfo['beam']>;
  armed: boolean;
  error: string | null;
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
  simulated: 'Simulated drop (Dual-Beam Photogates)',
  vernier: 'Vernier Go Direct Photogates (Dual-Beam Hardware)',
  example: 'Example experiment (Dual-Beam Simulated Trial)',
};

export function Collect(p: Props) {
  const [copied, setCopied] = useState(false);
  const status = rowStatuses(p.rows);
  const ready = readiness(p.rows);
  const times = relativeTimes(p.rows);
  const fired = p.rows.filter((r) => r.rawTime !== null).length;
  const savedDrops = new Set(p.saved.map((x) => x.drop)).size;
  const sim = p.mode === 'simulated' ? (p.source as SimulatedPhotogateSource) : null;

  // Group beams by their physical photogate (groupId)
  const groupIds = [...new Set(p.rows.map((r) => r.groupId ?? r.gateId))];

  // Calculate instantaneous dual-beam velocities for each photogate
  const gateVelocities: Record<string, number> = {};
  groupIds.forEach((gid) => {
    const members = p.rows.filter((r) => (r.groupId ?? r.gateId) === gid);
    if (members.length >= 2 && members[0].rawTime !== null && members[1].rawTime !== null) {
      const dt = Math.abs(members[1].rawTime - members[0].rawTime);
      if (dt > 1e-6) {
        gateVelocities[gid] = 0.02 / dt;
      }
    }
  });

  const copyForLabReport = async () => {
    try {
      const tsvLines = ['Point\tPhotogate & Beam\tHeight y (m)\tTime t (s)\tGate Velocity (m/s)'];
      p.rows.forEach((r, idx) => {
        const t = times.get(r.gateId);
        const tStr = t !== null && t !== undefined ? t.toFixed(4) : '—';
        const yStr = r.positionText || '—';
        const v = gateVelocities[r.groupId ?? r.gateId];
        const vStr = r.label.includes('Beam 2') && v ? v.toFixed(3) : '—';
        tsvLines.push(`${idx + 1}\t${r.label}\t${yStr}\t${tStr}\t${vStr}`);
      });
      await navigator.clipboard.writeText(tsvLines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard write rejected */
    }
  };

  // Two-gate acceleration check
  const velPoints = groupIds
    .map((gid) => {
      const members = p.rows.filter((r) => (r.groupId ?? r.gateId) === gid);
      const v = gateVelocities[gid];
      const y = members[0] ? parsePosition(members[0].positionText) : null;
      const t = members[0]?.rawTime;
      return v && y !== null && t !== null ? { gid, v, y, t, label: members[0].groupLabel ?? members[0].label } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.t - b.t);

  const directTwoGate = velPoints.length >= 2 ? (() => {
    const g1 = velPoints[0];
    const g2 = velPoints[velPoints.length - 1];
    const dy = Math.abs(g1.y - g2.y);
    if (dy > 0.02) {
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
            <h2>1 · Position the Photogates</h2>
            <p className="hint">
              Each photogate has <strong>two internal beams spaced 2.0 cm (0.020 m) apart</strong>. Drag the photogates along the pole. Read the ruler heights for both beams (measure <em>up from the table</em>).
            </p>
            <Stand source={sim} gates={p.source!.gates()} beams={p.beams} onMoved={p.onStandMoved} />
          </section>
        )}

        <section className="card table-card" aria-label="Data table">
          <div className="panel-header">
            <div>
              <h2>{sim ? '2 · Photogate Data & Lab Report Table' : 'Photogate Data & Lab Report Table'}</h2>
              <p className="hint" style={{ margin: '2px 0 0' }}>
                Each photogate records <strong>two data points</strong> (Beam 1 &amp; Beam 2). Both points are plotted on your Position vs. Time graph.
              </p>
            </div>
            <div className="actions" style={{ margin: 0 }}>
              <button className="btn btn-sm" onClick={copyForLabReport} title="Copy tab-separated table ready to paste into Google Docs, Word, or Sheets">
                📋 Copy Table for Lab Report
              </button>
              {copied && <span className="toast">✓ Copied to clipboard!</span>}
            </div>
          </div>

          {p.mode === 'vernier' && (
            <div className="callout" style={{ borderLeft: '4px solid var(--teal)', margin: '10px 0' }}>
              {webBluetoothSupported() ? (
                <>
                  <p>
                    1. <strong>Turn on each photogate:</strong> ensure the power LED is flashing red/green (ready to pair).<br/>
                    2. Click <strong>Connect a photogate</strong> below to pair each gate in Chrome (names start with <strong>GDX-VPG</strong>).<br/>
                    3. <strong>Wave your hand through the photogate</strong>: both beam indicators light up below. Enter the height of Beam 1 (top beam); Beam 2 is automatically 2.0 cm below.
                  </p>
                </>
              ) : (
                <p>
                  <strong>To connect Vernier sensors, open this page in Google Chrome</strong> (or Microsoft Edge).
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

          {/* Unified Lab Report Data Table */}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: '60px', textAlign: 'center' }}>Point</th>
                  <th scope="col">
                    Photogate &amp; Beam
                    <span className="th-sub">2 beams per gate (2.0 cm spacing)</span>
                  </th>
                  <th scope="col">
                    Height <i>y</i> (m)
                    <span className="th-sub">measured up from table</span>
                  </th>
                  <th scope="col">
                    Time <i>t</i> (s)
                    <span className="th-sub">0 at first beam trigger</span>
                  </th>
                  <th scope="col">
                    Gate Velocity <i>v</i>
                    <span className="th-sub">v = 0.020 m / Δt</span>
                  </th>
                  <th scope="col" className="sr-only">Remove</th>
                </tr>
              </thead>
              <tbody>
                {p.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty">
                      {p.mode === 'vernier' ? 'No photogates connected yet. Click "Connect a photogate" below.' : 'No gates yet. Add a gate.'}
                    </td>
                  </tr>
                )}
                {p.rows.map((r, i) => {
                  const s = status[i];
                  const live = p.beams[r.gateId] === 'blocked';
                  const t = times.get(r.gateId) ?? null;
                  const heightProblem = s.problems.find((x) => !x.startsWith('No time'));
                  const gid = r.groupId ?? r.gateId;
                  const isBeam2 = r.gateId.endsWith('-b2') || r.label.includes('Beam 2');
                  const gateVel = gateVelocities[gid];

                  return (
                    <tr key={r.gateId} className={live ? 'live' : undefined}>
                      <td style={{ textAlign: 'center' }}>
                        <span className="point-badge">{i + 1}</span>
                      </td>
                      <th scope="row">
                        <span className={live ? 'beam-dot on' : r.rawTime !== null ? 'beam-dot done' : 'beam-dot'} aria-hidden="true" />
                        {r.label}
                        {live && <span className="sr-only"> (beam blocked)</span>}
                      </th>
                      <td>
                        <input
                          className={heightProblem && r.positionText.trim() !== '' ? 'num-input invalid' : 'num-input'}
                          inputMode="decimal"
                          aria-label={`${r.label} height in meters`}
                          placeholder={isBeam2 ? 'e.g. 1.160' : 'e.g. 1.180'}
                          value={r.positionText}
                          onChange={(e) => p.onPosition(r.gateId, e.target.value)}
                        />
                        {heightProblem && r.positionText.trim() !== '' && <div className="field-msg">{heightProblem}</div>}
                      </td>
                      <td className={t === null ? 'time pending' : 'time'}>
                        {t === null ? 'waiting…' : fmt(t, 4)}
                      </td>
                      <td>
                        {isBeam2 && gateVel ? (
                          <strong className="result" style={{ fontSize: '0.95rem' }}>
                            {fmt(gateVel, 3)} m/s
                          </strong>
                        ) : isBeam2 && t !== null ? (
                          <span className="hint">—</span>
                        ) : (
                          <span style={{ color: 'var(--border)' }}>—</span>
                        )}
                      </td>
                      <td>
                        {p.mode !== 'example' && isBeam2 && (
                          <button className="btn btn-icon" aria-label={`Remove photogate`} onClick={() => p.onRemoveGate(gid)}>
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
            {ready.missingPositions > 0 ? `Enter height for ${ready.missingPositions} beam${ready.missingPositions > 1 ? 's' : ''}. ` : ''}
            {p.mode !== 'example' && p.rows.length > 0 && (
              p.armed
                ? `Waiting for the drop… ${fired} of ${p.rows.length} beams triggered.`
                : fired === p.rows.length
                  ? `Drop complete: all ${fired} beams recorded (${p.rows.length / 2} photogates, ${p.rows.length} data points).`
                  : ready.missingTimes > 0
                    ? `${ready.missingTimes} beam${ready.missingTimes > 1 ? 's have' : ' has'} no time yet.`
                    : ''
            )}
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
                    Release the sphere
                  </button>
                ) : (
                  <span className="armed-note">Armed — release the object now.</span>
                )}
                {p.armed && (
                  <button className="btn" onClick={p.onArm} title="Restart this trial while preserving your entered heights">
                    Restart trial
                  </button>
                )}
                {p.onCopyStandHeights && (
                  <button className="btn" onClick={p.onCopyStandHeights} title="Set table heights to match current photogate positions on the ruler">
                    Copy heights from ruler
                  </button>
                )}
                <button className={p.mode === 'vernier' ? 'btn btn-accent' : 'btn'} onClick={() => p.onAddGate()}>
                  {p.mode === 'vernier' ? 'Connect a photogate' : 'Add photogate'}
                </button>
              </>
            )}
            <button className="btn" onClick={p.onReset} title="Clears heights and times. Connected gates stay connected.">
              Clear heights &amp; times
            </button>
            <button className="btn" disabled={ready.usable === 0} onClick={p.onExport}>
              Export CSV
            </button>
          </div>

          {directTwoGate && (
            <div className="callout good" style={{ marginTop: '12px' }}>
              <strong>Direct Dual-Beam Photogate Velocity Check:</strong>
              <div>
                {directTwoGate.g1.label}: <i>v</i>₁ = {fmt(directTwoGate.g1.v, 3)} m/s at {fmt(directTwoGate.g1.y, 3)} m · {directTwoGate.g2.label}: <i>v</i>₂ = {fmt(directTwoGate.g2.v, 3)} m/s at {fmt(directTwoGate.g2.y, 3)} m
              </div>
              <div style={{ marginTop: '4px' }}>
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
                  ? `Saved: ${savedDrops} drop${savedDrops === 1 ? '' : 's'} (${p.saved.length} points), combined with the current trial. `
                  : 'Want more data points? Keep this drop, move a photogate to a new position, and drop again. All trials are combined on the position graph. '}
                Keep the <strong>top</strong> photogate at the same height for every drop — it provides the reference time (t = 0).
              </p>
              {p.saved.length > 0 && (
                <details className="reveal">
                  <summary>Saved points ({p.saved.length})</summary>
                  <table className="data-table compact">
                    <thead>
                      <tr><th>Drop</th><th>Gate &amp; Beam</th><th>y (m)</th><th>t (s)</th></tr>
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
              Graph position vs. time ({p.rows.filter(r => r.rawTime !== null && parsePosition(r.positionText) !== null).length + p.saved.length} points) →
            </button>
            {p.analysisBlocker && <span className="hint">{p.analysisBlocker}</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
