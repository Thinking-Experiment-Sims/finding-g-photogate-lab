import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { distinctHeights, exampleRows, measurements, parsePosition, stationRows, toCsv, type GateRow, type SavedPoint } from './experiments/fallingMotion/model';
import { fitPosition, linearizationValid, linearizedFit, quadraticAcceleration, velocityFit } from './physics/kinematics';
import { GoDirectPhotogateSource, webBluetoothSupported } from './sensors/GoDirectPhotogateSource';
import { SimulatedPhotogateSource } from './sensors/SimulatedPhotogateSource';
import type { GateInfo, PhotogateSource, SourceEvent } from './sensors/types';
import { Collect, type Mode } from './steps/Collect';
import { Compare, type Estimate } from './steps/Compare';
import { Linearize } from './steps/Linearize';
import { Position } from './steps/Position';
import { Velocity } from './steps/Velocity';
import { FenceCheck } from './steps/FenceCheck';
import { TeacherLock } from './components/TeacherLock';
import { STRAIGHT_R2, type Datum, type LinState, type VelRecord } from './steps/types';

type Step = 'collect' | 'position' | 'velocity' | 'linearize' | 'compare';
const STEPS: { id: Step; label: string }[] = [
  { id: 'collect', label: 'Collect data' },
  { id: 'position', label: 'Position vs. time' },
  { id: 'velocity', label: 'Velocity from tangents' },
  { id: 'linearize', label: 'Linearize' },
  { id: 'compare', label: 'Compare g' },
];

const TEACHER_KEY = 'tte-teacher-mode';
const readTeacher = () => {
  try {
    return sessionStorage.getItem(TEACHER_KEY) === '1';
  } catch {
    return false;
  }
};

const FRESH_LIN: LinState = { xT: 't2', yT: 'y', fitShown: false, k: null, hint: 0 };

export default function App() {
  const [mode, setMode] = useState<Mode | null>(null);
  /** Teacher mode unlocks the Linearize step (method 3). Students see the other two methods. */
  const [teacher, setTeacher] = useState(readTeacher);
  const [checking, setChecking] = useState(false);
  const [rows, setRows] = useState<GateRow[]>([]);
  /** One crease height (text) per two-beam photogate, keyed by device id. */
  const [creases, setCreases] = useState<Record<string, string>>({});
  /** Points kept from earlier drops (height + time relative to that drop's first gate), pooled with the current drop. */
  const [saved, setSaved] = useState<SavedPoint[]>([]);
  const [beams, setBeams] = useState<Record<string, GateInfo['beam']>>({});
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('collect');
  const [showFit, setShowFit] = useState(false);
  const [records, setRecords] = useState<VelRecord[]>([]);
  const [lin, setLin] = useState<LinState>(FRESH_LIN);
  const [velocities, setVelocities] = useState<Record<string, number>>({});
  const sourceRef = useRef<PhotogateSource | null>(null);
  const [, bump] = useState(0);

  const resetAnalysis = useCallback(() => {
    setShowFit(false);
    setRecords([]);
    setLin(FRESH_LIN);
  }, []);

  const syncRows = useCallback((gates: GateInfo[]) => {
    setRows((prev) =>
      gates.map((g) => prev.find((r) => r.gateId === g.id) ?? { gateId: g.id, label: g.label, positionText: '', rawTime: null, groupId: g.group, groupLabel: g.groupLabel }),
    );
  }, []);

  const onEvent = useCallback(
    (e: SourceEvent) => {
      if (e.type === 'gates') syncRows(e.gates);
      else if (e.type === "blocked") setRows((prev) => prev.map((r) => (r.gateId === e.gateId && r.rawTime === null ? { ...r, rawTime: e.time } : r)));
      else if (e.type === "object" && e.kind === "velocity") {
        const id = e.deviceId ?? "";
        if (id) {
          setVelocities((v) => ({ ...v, [id]: e.value }));
          setRows((prev) => prev.map((r) => ((r.gateId === id || r.groupId === id) && !r.velocity ? { ...r, velocity: e.value } : r)));
        }
      }
      else if (e.type === "beam") setBeams((b) => ({ ...b, [e.gateId]: e.beam }));
      else if (e.type === 'error') setError(e.message);
      bump((n) => n + 1);
    },
    [syncRows],
  );

  const disposeSource = () => {
    sourceRef.current?.dispose();
    sourceRef.current = null;
  };
  useEffect(() => () => disposeSource(), []);

  const chooseMode = (m: Mode) => {
    disposeSource();
    setError(null);
    setArmed(false);
    setBeams({});
    resetAnalysis();
    setCreases({});
    setSaved([]);
    setVelocities({});
    setStep('collect');
    if (m === 'example') {
      setRows(exampleRows());
    } else {
      const src = m === 'simulated' ? new SimulatedPhotogateSource() : new GoDirectPhotogateSource();
      src.subscribe(onEvent);
      sourceRef.current = src;
      syncRows(src.gates());
    }
    setMode(m);
  };

  // Stop listening once every gate has fired.
  useEffect(() => {
    if (armed && rows.length > 0 && rows.every((r) => r.rawTime !== null)) {
      sourceRef.current?.disarm();
      setArmed(false);
    }
  }, [rows, armed]);

  const src = sourceRef.current;
  // One station per photogate: crease height + mean of its two beam times. Ungrouped (simulated) gates are already stations.
  const stations = useMemo(() => stationRows(rows, creases, velocities), [rows, creases, velocities]);
  const currentPoints = useMemo(() => measurements(stations), [stations]);
  // The graphs use every kept drop plus the current one.
  const data: Datum[] = useMemo(
    () => [...saved.map((p) => ({ t: p.t, y: p.y })), ...currentPoints.map((m) => ({ t: m.time, y: m.position }))],
    [saved, currentPoints],
  );
  const heightsCount = distinctHeights(data);
  // Every drop's time zero is its first gate, so that gate must be at the same height in every drop.
  const referenceHeights = [...saved.filter((p) => p.t === 0).map((p) => p.y), ...currentPoints.filter((m) => m.time === 0).map((m) => m.position)];
  const referenceMoved = distinctHeights(referenceHeights.map((y) => ({ y }))) > 1;
  const analysisBlocker =
    referenceMoved
      ? 'The first (top) gate changed height between drops. Put it back, or clear the saved drops.'
      : data.length < 3
        ? 'Needs at least 3 points. Keep this drop, move a photogate, and drop again — or add another photogate.'
        : heightsCount < 3
          ? `Only ${heightsCount} different height${heightsCount === 1 ? '' : 's'} so far; a curve fit needs at least 3. Keep this drop, move a photogate to a NEW height, enter it, and drop again.`
          : null;
  const canAnalyze = analysisBlocker === null;
  const fit = useMemo(() => fitPosition(data), [data]);
  const dataLabel = mode === 'vernier' ? 'Vernier Go Direct Photogates (experimental)' : 'Simulated data';

  const steps = teacher ? STEPS : STEPS.filter((s) => s.id !== 'linearize');
  const setTeacherMode = (on: boolean) => {
    setTeacher(on);
    try {
      sessionStorage.setItem(TEACHER_KEY, on ? '1' : '0');
    } catch {
      /* private window: mode just lasts until reload */
    }
    if (!on && step === 'linearize') setStep('compare');
  };

  const estimates: Estimate[] = useMemo(() => {
    const vf = velocityFit(records);
    const lf = linearizedFit(data, lin.xT, lin.yT);
    const straight = lf.ok && lf.value.r2 >= STRAIGHT_R2;
    const valid = linearizationValid(data, lin.xT, lin.yT);
    const all: Estimate[] = [
      {
        key: 'quad',
        method: '1 · Quadratic fit',
        how: 'g = |2A| from y(t) = At² + Bt + C',
        g: fit.ok ? Math.abs(quadraticAcceleration(fit.value)) : null,
        sigma: fit.ok && fit.value.seA !== undefined ? 2 * fit.value.seA : undefined,
      },
      {
        key: 'vel',
        method: '2 · Velocity graph',
        how: 'g = |slope| of v vs. t, from tangent lines on the fitted curve',
        g: vf.ok && records.length >= 2 ? Math.abs(vf.value.m) : null,
        sigma: vf.ok && vf.value.seM !== undefined ? vf.value.seM : undefined,
      },
      {
        key: 'lin',
        method: '3 · Linearization',
        how: 'g = |a|, with a = k × slope of your straightened graph',
        g: lf.ok && lin.k !== null ? Math.abs(lin.k * lf.value.m) : null,
        sigma: lf.ok && lin.k !== null && lf.value.seM !== undefined ? Math.abs(lin.k) * lf.value.seM : undefined,
        note: lf.ok && lin.k !== null && !(straight && valid) ? (straight ? 'Check: this graph’s slope is not a/2 for your drop' : `Check: graph not straight (R² = ${lf.value.r2.toFixed(3)})`) : undefined,
      },
    ];
    return teacher ? all : all.filter((e) => e.key !== 'lin');
  }, [fit, records, data, lin, teacher]);

  const addGate = async () => {
    setError(null);
    try {
      await src?.addGate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/cancel|chosen|No device selected/i.test(msg)) setError(msg);
    }
  };

  const clearTimes = () => { setRows((r) => r.map((x) => ({ ...x, rawTime: null, velocity: null }))); setVelocities({}); };

  /** Clear the heights and times but KEEP the connected gates (or the simulated stand). */
  const clearAll = () => {
    if (mode === 'example') {
      chooseMode('example');
      return;
    }
    src?.disarm();
    setArmed(false);
    setError(null);
    setCreases({});
    setSaved([]);
    setRows((r) => r.map((x) => ({ ...x, positionText: '', rawTime: null })));
    resetAnalysis();
  };

  /** Save this drop's points (height + time relative to its first gate), clear the times, keep the heights. */
  const keepDrop = () => {
    const drop = new Set(saved.map((p) => p.drop)).size + 1;
    const label = (id: string) => stations.find((r) => r.gateId === id)?.label ?? id;
    setSaved((prev) => [...prev, ...currentPoints.map((m) => ({ y: m.position, t: m.time, drop, label: label(m.gateId) }))]);
    src?.disarm();
    setArmed(false);
    clearTimes();
    resetAnalysis();
  };

  const arm = () => {
    clearTimes();
    resetAnalysis();
    setError(null);
    src?.arm();
    setArmed(true);
  };

  const copyStandHeights = () => {
    if (mode === "simulated" && src instanceof SimulatedPhotogateSource) {
      const stand = src.standGates();
      setRows((prev) =>
        prev.map((r) => {
          const match = stand.find((g) => g.id === r.gateId);
          return match ? { ...r, positionText: match.position.toFixed(3) } : r;
        })
      );
      resetAnalysis();
    }
  };

  const exportCsv = () => {
    const drop = new Set(saved.map((p) => p.drop)).size + 1;
    const pts = [...saved, ...currentPoints.map((m) => ({ y: m.position, t: m.time, drop, label: stations.find((r) => r.gateId === m.gateId)?.label ?? m.gateId }))];
    const blob = new Blob([toCsv(pts, dataLabel)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = mode === 'vernier' ? 'falling-motion-photogates.csv' : 'falling-motion-SIMULATED.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const sortRows = () =>
    setRows((r) => [...r].sort((a, b) => (parsePosition(b.positionText) ?? -Infinity) - (parsePosition(a.positionText) ?? -Infinity)));

  const goto = (s: Step) => {
    if (s === 'collect' || canAnalyze) setStep(s);
  };

  return (
    <div className="shell">
      <header className={mode === null ? 'hero' : 'hero compact'}>
        <a className="brand" href="https://thinking-experiment-sims.github.io/interactive-physics/">← The Thinking Experiment</a>
        <h1>Falling Motion — Photogates</h1>
        <p className="subtitle">{teacher ? 'Measure the acceleration of gravity three ways: from a curve fit, from tangent-line velocities, and from a straightened graph.' : 'Measure the acceleration of gravity two ways: from a curve fit and from tangent-line velocities.'}</p>
      </header>

      {checking ? (
        <FenceCheck onBack={() => setChecking(false)} />
      ) : mode === null ? (
        <section className="setup" aria-label="Choose a data source">
          <div className="source-cards">
            <button className="source-card" onClick={() => chooseMode('simulated')}>
              <span className="badge">Works in any browser</span>
              <strong>Simulated drop</strong>
              <span>Use the virtual stand, move the gates, read the ruler, and release the object.</span>
              <span className="btn btn-primary">Start experiment</span>
            </button>
            <button className="source-card" onClick={() => chooseMode('vernier')}>
              <span className="badge amber">Experimental · Chrome or Edge</span>
              <strong>Vernier Go Direct Photogates</strong>
              <span>Connect your real photogates over Bluetooth. {webBluetoothSupported() ? 'Times are approximate until this has been tested with hardware.' : 'This browser can’t connect to sensors — open the page in Google Chrome.'}</span>
              <span className="btn">Connect gates</span>
            </button>
          </div>
          <p className="demo-link">
            Teacher demo: <button className="btn btn-quiet" onClick={() => { chooseMode('example'); }}>Load example experiment</button> — realistic simulated data, no hardware needed.
          </p>
          <p className="demo-link">
            Have a picket fence? <button className="btn btn-quiet" onClick={() => setChecking(true)}>Photogate timing check (picket fence)</button> — measures how accurate the Bluetooth timing is.
          </p>
        </section>
      ) : (
        <>
          <nav className="stepper" aria-label="Experiment steps">
            {steps.map((s, i) => (
              <button
                key={s.id}
                className={s.id === step ? 'step on' : 'step'}
                disabled={s.id !== 'collect' && !canAnalyze}
                aria-current={s.id === step ? 'step' : undefined}
                onClick={() => goto(s.id)}
              >
                <span className="num">{i + 1}</span>
                {s.label}
              </button>
            ))}
          </nav>
          <p className="datalabel">Data source: <strong>{dataLabel}</strong></p>

          {step === 'collect' && (
            <Collect
              mode={mode}
              source={src}
              rows={stations}
              beamRows={rows}
              saved={saved}
              onKeep={keepDrop}
              onClearSaved={() => { setSaved([]); resetAnalysis(); }}
              analysisBlocker={analysisBlocker}
              creases={creases}
              onCrease={(group, text) => { setCreases((c) => ({ ...c, [group]: text })); resetAnalysis(); }}
              beams={beams}
              armed={armed}
              error={error}
              onPosition={(id, text) => { setRows((r) => r.map((x) => (x.gateId === id ? { ...x, positionText: text } : x))); resetAnalysis(); }}
              onAddGate={addGate}
              onRemoveGate={(id) => { src ? src.removeGate(id) : setRows((r) => r.filter((x) => x.gateId !== id)); resetAnalysis(); }}
              onStandMoved={() => { clearTimes(); resetAnalysis(); }}
              onCopyStandHeights={mode === 'simulated' ? copyStandHeights : undefined}
              onSort={sortRows}
              onRefresh={() => bump((n) => n + 1)}
              onArm={arm}
              onDrop={() => (src as SimulatedPhotogateSource | null)?.drop()}
              onReset={clearAll}
              onExport={exportCsv}
              onNext={() => goto('position')}
              onChangeSource={() => { disposeSource(); setMode(null); setRows([]); }}
            />
          )}
          {step === 'position' && <Position data={data} fit={fit} showFit={showFit} onToggleFit={() => setShowFit((s) => !s)} onNext={() => goto('velocity')} />}
          {step === 'velocity' && fit.ok && (
            <Velocity data={data} fit={fit.value} records={records} setRecords={setRecords} onNext={() => goto(teacher ? 'linearize' : 'compare')} />
          )}
          {step === 'velocity' && !fit.ok && <div className="card"><div className="callout warn">{fit.reason}</div></div>}
          {step === 'linearize' && teacher && <Linearize data={data} lin={lin} setLin={setLin} onNext={() => goto('compare')} />}
          {step === 'compare' && <Compare estimates={estimates} onExport={exportCsv} />}
        </>
      )}
      <footer className="foot">The Thinking Experiment · {dataLabel === 'Simulated data' ? 'Simulated data is labeled wherever it appears.' : 'Hardware mode is experimental.'} · <TeacherLock teacher={teacher} onChange={setTeacherMode} /></footer>
    </div>
  );
}
