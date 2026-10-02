import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deriveRows, exampleRows, measurements, parsePosition, readiness, toCsv, type GateRow } from './experiments/fallingMotion/model';
import { fitPosition, linearizationValid, linearizedFit, quadraticAcceleration, velocityFit } from './physics/kinematics';
import { GoDirectPhotogateSource, webBluetoothSupported } from './sensors/GoDirectPhotogateSource';
import { SimulatedPhotogateSource } from './sensors/SimulatedPhotogateSource';
import type { GateInfo, PhotogateSource, SourceEvent } from './sensors/types';
import { Collect, type Mode } from './steps/Collect';
import { Compare, type Estimate } from './steps/Compare';
import { Linearize } from './steps/Linearize';
import { Position } from './steps/Position';
import { Velocity } from './steps/Velocity';
import { STRAIGHT_R2, type Datum, type LinState, type VelRecord } from './steps/types';

type Step = 'collect' | 'position' | 'velocity' | 'linearize' | 'compare';
const STEPS: { id: Step; label: string }[] = [
  { id: 'collect', label: 'Collect data' },
  { id: 'position', label: 'Position vs. time' },
  { id: 'velocity', label: 'Velocity from tangents' },
  { id: 'linearize', label: 'Linearize' },
  { id: 'compare', label: 'Compare g' },
];

const FRESH_LIN: LinState = { xT: 't2', yT: 'y', fitShown: false, k: null, hint: 0 };

export default function App() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [rows, setRows] = useState<GateRow[]>([]);
  /** One crease height (text) per two-beam photogate, keyed by device id. */
  const [creases, setCreases] = useState<Record<string, string>>({});
  const [beams, setBeams] = useState<Record<string, GateInfo['beam']>>({});
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('collect');
  const [showFit, setShowFit] = useState(false);
  const [records, setRecords] = useState<VelRecord[]>([]);
  const [lin, setLin] = useState<LinState>(FRESH_LIN);
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
      else if (e.type === 'blocked') setRows((prev) => prev.map((r) => (r.gateId === e.gateId && r.rawTime === null ? { ...r, rawTime: e.time } : r)));
      else if (e.type === 'beam') setBeams((b) => ({ ...b, [e.gateId]: e.beam }));
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
  // Rows with heights filled in from the crease heights (for two-beam photogates).
  const eff = useMemo(() => deriveRows(rows, creases), [rows, creases]);
  const data: Datum[] = useMemo(() => measurements(eff).map((m) => ({ t: m.time, y: m.position })), [eff]);
  const ready = readiness(eff);
  const canAnalyze = ready.usable >= 3;
  const fit = useMemo(() => fitPosition(data), [data]);
  const dataLabel = mode === 'vernier' ? 'Vernier Go Direct Photogates (experimental)' : 'Simulated data';

  const estimates: Estimate[] = useMemo(() => {
    const vf = velocityFit(records);
    const lf = linearizedFit(data, lin.xT, lin.yT);
    const linOk = lf.ok && lf.value.r2 >= STRAIGHT_R2 && linearizationValid(data, lin.xT, lin.yT) && lin.k !== null;
    return [
      { key: 'quad', method: '1 · Quadratic fit', how: 'g = |2A| from y(t) = At² + Bt + C', g: fit.ok ? Math.abs(quadraticAcceleration(fit.value)) : null },
      {
        key: 'vel',
        method: '2 · Velocity graph',
        how: 'g = |slope| of v vs. t, from tangent lines on the fitted curve',
        g: vf.ok && records.length >= 2 ? Math.abs(vf.value.m) : null,
      },
      { key: 'lin', method: '3 · Linearization', how: 'g = |a|, with a from the slope of your straightened graph', g: linOk && lf.ok && lin.k !== null ? Math.abs(lin.k * lf.value.m) : null },
    ];
  }, [fit, records, data, lin]);

  const addGate = async () => {
    setError(null);
    try {
      await src?.addGate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/cancel|chosen|No device selected/i.test(msg)) setError(msg);
    }
  };

  const clearTimes = () => setRows((r) => r.map((x) => ({ ...x, rawTime: null })));

  const arm = () => {
    clearTimes();
    resetAnalysis();
    setError(null);
    src?.arm();
    setArmed(true);
  };

  const exportCsv = () => {
    const blob = new Blob([toCsv(eff, dataLabel)], { type: 'text/csv' });
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
        <p className="subtitle">Measure the acceleration of gravity three ways: from a curve fit, from tangent-line velocities, and from a straightened graph.</p>
      </header>

      {mode === null ? (
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
        </section>
      ) : (
        <>
          <nav className="stepper" aria-label="Experiment steps">
            {STEPS.map((s, i) => (
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
              rows={eff}
              creases={creases}
              onCrease={(group, text) => { setCreases((c) => ({ ...c, [group]: text })); resetAnalysis(); }}
              beams={beams}
              armed={armed}
              error={error}
              onPosition={(id, text) => { setRows((r) => r.map((x) => (x.gateId === id ? { ...x, positionText: text } : x))); resetAnalysis(); }}
              onAddGate={addGate}
              onRemoveGate={(id) => { src ? src.removeGate(id) : setRows((r) => r.filter((x) => x.gateId !== id)); resetAnalysis(); }}
              onStandMoved={() => { clearTimes(); resetAnalysis(); }}
              onSort={sortRows}
              onArm={arm}
              onDrop={() => (src as SimulatedPhotogateSource | null)?.drop()}
              onReset={() => chooseMode(mode)}
              onExport={exportCsv}
              onNext={() => goto('position')}
              onChangeSource={() => { disposeSource(); setMode(null); setRows([]); }}
            />
          )}
          {step === 'position' && <Position data={data} fit={fit} showFit={showFit} onToggleFit={() => setShowFit((s) => !s)} onNext={() => goto('velocity')} />}
          {step === 'velocity' && fit.ok && (
            <Velocity data={data} fit={fit.value} records={records} setRecords={setRecords} onNext={() => goto('linearize')} />
          )}
          {step === 'velocity' && !fit.ok && <div className="card"><div className="callout warn">{fit.reason}</div></div>}
          {step === 'linearize' && <Linearize data={data} lin={lin} setLin={setLin} onNext={() => goto('compare')} />}
          {step === 'compare' && <Compare estimates={estimates} onExport={exportCsv} />}
        </>
      )}
      <footer className="foot">The Thinking Experiment · {dataLabel === 'Simulated data' ? 'Simulated data is labeled wherever it appears.' : 'Hardware mode is experimental.'}</footer>
    </div>
  );
}
