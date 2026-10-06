import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  distinctHeights,
  exampleRows,
  measurements,
  parsePosition,
  toCsv,
  type GateRow,
  type SavedPoint,
} from './experiments/fallingMotion/model';
import { fitPosition, linearizationValid, linearizedFit, quadraticAcceleration, velocityFit } from './physics/kinematics';
import { GoDirectPhotogateSource, webBluetoothSupported } from './sensors/GoDirectPhotogateSource';
import { SimulatedPhotogateSource } from './sensors/SimulatedPhotogateSource';
import type { GateInfo, PhotogateSource, SourceEvent } from './sensors/types';
import { Collect, type Mode } from './steps/Collect';
import { Compare, type Estimate } from './steps/Compare';
import { FenceCheck } from './steps/FenceCheck';
import { Linearize } from './steps/Linearize';
import { Position } from './steps/Position';
import { STRAIGHT_R2, type Datum, type LinState, type VelRecord } from './steps/types';
import { Velocity } from './steps/Velocity';
import { TeacherLock } from './components/TeacherLock';
import './styles/app.css';

type Step = 'collect' | 'position' | 'velocity' | 'linearize' | 'compare';
const STEPS: { id: Step; label: string }[] = [
  { id: 'collect', label: '1 · Collect' },
  { id: 'position', label: '2 · Position vs. time' },
  { id: 'velocity', label: '3 · Velocity' },
  { id: 'linearize', label: '4 · Linearize' },
  { id: 'compare', label: '5 · Compare' },
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

const MODE_BADGE: Record<Mode, string> = {
  simulated: 'Simulated Drop',
  vernier: 'Vernier Hardware',
  example: 'Teacher Demo',
};

export default function App() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [step, setStep] = useState<Step>('collect');
  const [rows, setRows] = useState<GateRow[]>([]);
  const [saved, setSaved] = useState<SavedPoint[]>([]);
  const [armed, setArmed] = useState(false);
  const [beams, setBeams] = useState<Record<string, GateInfo['beam']>>({});
  const [error, setError] = useState<string | null>(null);
  const [showFit, setShowFit] = useState(false);
  const [records, setRecords] = useState<VelRecord[]>([]);
  const [lin, setLin] = useState<LinState>(FRESH_LIN);
  const [checking, setChecking] = useState(false);
  const [teacher, setTeacher] = useState<boolean>(readTeacher);
  const sourceRef = useRef<PhotogateSource | null>(null);

  const resetAnalysis = () => {
    setShowFit(false);
    setRecords([]);
  };

  const goto = (next: Step) => {
    setStep(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const syncRows = useCallback((gates: GateInfo[]) => {
    setRows((prev) => {
      const byId = new Map(prev.map((r) => [r.gateId, r]));
      return gates.map((g) => {
        const existing = byId.get(g.id);
        return {
          gateId: g.id,
          label: g.label,
          positionText: existing ? existing.positionText : '',
          rawTime: existing ? existing.rawTime : null,
          groupId: g.group,
          groupLabel: g.groupLabel,
        };
      });
    });
  }, []);

  const onEvent = useCallback(
    (e: SourceEvent) => {
      if (e.type === 'gates') {
        syncRows(e.gates);
      } else if (e.type === 'beam') {
        setBeams((b) => ({ ...b, [e.gateId]: e.beam }));
      } else if (e.type === 'blocked') {
        setRows((prev) => prev.map((r) => (r.gateId === e.gateId ? { ...r, rawTime: e.time } : r)));
      } else if (e.type === 'object' && e.kind === 'velocity' && e.deviceId) {
        const devId = e.deviceId;
        setRows((prev) =>
          prev.map((r) => (r.groupId === devId || r.gateId === devId ? { ...r, velocity: e.value } : r)),
        );
      } else if (e.type === 'error') {
        setError(e.message);
      }
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
    setSaved([]);
    setStep('collect');
    if (m === 'example') {
      setRows(exampleRows());
    } else {
      const src = m === 'simulated' ? new SimulatedPhotogateSource() : new GoDirectPhotogateSource();
      src.subscribe(onEvent);
      sourceRef.current = src;
      const initialGates = src.gates();
      if (m === 'simulated') {
        const stand = (src as SimulatedPhotogateSource).standGates();
        setRows(
          initialGates.map((g) => {
            const match = stand.find((s) => s.id === g.group);
            const isB2 = g.id.endsWith('-b2') || g.label.includes('Beam 2');
            const pos = match ? (isB2 ? match.b2Position : match.b1Position).toFixed(3) : '';
            return {
              gateId: g.id,
              label: g.label,
              positionText: pos,
              rawTime: null,
              groupId: g.group,
              groupLabel: g.groupLabel,
            };
          }),
        );
      } else {
        syncRows(initialGates);
      }
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
  // All beam points (2 per photogate) are individual measurements
  const currentPoints = useMemo(() => measurements(rows), [rows]);

  // The graphs use every kept drop plus the current one.
  const data: Datum[] = useMemo(
    () => [...saved.map((p) => ({ t: p.t, y: p.y })), ...currentPoints.map((m) => ({ t: m.time, y: m.position }))],
    [saved, currentPoints],
  );
  const heightsCount = distinctHeights(data);

  // Every drop's time zero is its first gate, so that gate must be at the same height in every drop.
  const referenceHeights = [
    ...saved.filter((p) => p.t === 0).map((p) => p.y),
    ...currentPoints.filter((m) => m.time === 0).map((m) => m.position),
  ];
  const referenceMoved = distinctHeights(referenceHeights.map((y) => ({ y }))) > 1;
  const analysisBlocker = referenceMoved
    ? 'The reference gate changed height between drops. Reset it, or clear the saved drops.'
    : data.length < 3
      ? 'Needs at least 3 points. Keep this drop, move a photogate, and drop again — or add another photogate.'
      : heightsCount < 3
        ? `Only ${heightsCount} distinct heights so far; a curve fit needs at least 3. Position the photogates at different heights.`
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
      /* private window */
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
        note:
          lf.ok && lin.k !== null && !(straight && valid)
            ? straight
              ? 'Check: this graph’s slope is not a/2 for your drop'
              : `Check: graph not straight (R² = ${lf.value.r2.toFixed(3)})`
            : undefined,
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

  const clearTimes = () => {
    setRows((r) => r.map((x) => ({ ...x, rawTime: null, velocity: null })));
  };

  const clearAll = () => {
    if (mode === 'example') {
      chooseMode('example');
      return;
    }
    src?.disarm();
    setArmed(false);
    setError(null);
    setSaved([]);
    setRows((r) => r.map((x) => ({ ...x, positionText: '', rawTime: null, velocity: null })));
    resetAnalysis();
  };

  const keepDrop = () => {
    const drop = new Set(saved.map((p) => p.drop)).size + 1;
    const label = (id: string) => rows.find((r) => r.gateId === id)?.label ?? id;
    setSaved((prev) => [
      ...prev,
      ...currentPoints.map((m) => ({ y: m.position, t: m.time, drop, label: label(m.gateId) })),
    ]);
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

  const handlePosition = (id: string, text: string) => {
    setRows((prev) => {
      const target = prev.find((r) => r.gateId === id);
      const isB1 = id.endsWith('-b1') || (!id.endsWith('-b2') && target?.label.includes('Beam 1'));
      const parsed = parsePosition(text);
      return prev.map((r) => {
        if (r.gateId === id) return { ...r, positionText: text };
        // If updating Beam 1, automatically set Beam 2 to (Beam 1 - 0.020 m) on same gate
        if (
          isB1 &&
          target?.groupId &&
          r.groupId === target.groupId &&
          (r.gateId.endsWith('-b2') || r.label.includes('Beam 2'))
        ) {
          if (parsed !== null) {
            const b2Val = Math.max(parsed - 0.02, 0);
            return { ...r, positionText: b2Val.toFixed(3) };
          }
        }
        return r;
      });
    });
    resetAnalysis();
  };

  const copyStandHeights = () => {
    if (mode === 'simulated' && src instanceof SimulatedPhotogateSource) {
      const stand = src.standGates();
      setRows((prev) =>
        prev.map((r) => {
          const match = stand.find((g) => g.id === r.groupId || `${g.id}-b1` === r.gateId || `${g.id}-b2` === r.gateId);
          if (match) {
            const isB2 = r.gateId.endsWith('-b2') || r.label.includes('Beam 2');
            const h = isB2 ? match.b2Position : match.b1Position;
            return { ...r, positionText: h.toFixed(3) };
          }
          return r;
        }),
      );
      resetAnalysis();
    }
  };

  const removeGate = (id: string) => {
    if (src) {
      src.removeGate(id);
    } else {
      setRows((r) => r.filter((x) => x.groupId !== id && x.gateId !== id));
    }
    resetAnalysis();
  };

  const sortRows = () => {
    setRows((r) =>
      [...r].sort((a, b) => {
        const pa = parsePosition(a.positionText);
        const pb = parsePosition(b.positionText);
        if (pa !== null && pb !== null) return pb - pa;
        if (pa !== null) return -1;
        if (pb !== null) return 1;
        return a.label.localeCompare(b.label);
      }),
    );
  };

  const exportCsv = () => {
    const drop = new Set(saved.map((p) => p.drop)).size + 1;
    const pts = [
      ...saved,
      ...currentPoints.map((m) => ({
        y: m.position,
        t: m.time,
        drop,
        label: rows.find((r) => r.gateId === m.gateId)?.label ?? m.gateId,
      })),
    ];
    const blob = new Blob([toCsv(pts, dataLabel)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = mode === 'vernier' ? 'falling-motion-photogates.csv' : 'falling-motion-SIMULATED.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="shell">
      <header className="hero" role="banner">
        <div className="hero-top">
          <div className="hero-headings">
            <div className="hero-badges">
              <a
                href="https://thinking-experiment-sims.github.io/interactive-physics/"
                className="brand-badge"
                title="Return to Physics Simulations Hub"
              >
                ← The Thinking Experiment
              </a>
              <span className="lab-badge">📐 Physics Lab Activity</span>
              {mode && <span className="mode-badge">{MODE_BADGE[mode]}</span>}
            </div>
            <h1>Falling Motion — Photogates Lab</h1>
            <p className="hero-subtitle">
              Measure the acceleration of gravity with dual-beam photogates: compare quadratic curve fitting with instantaneous gate velocities.
            </p>
          </div>
          <div className="hero-meta-badges">
            <span className="meta-badge">
              Standard: <strong>g = 9.80 m/s²</strong>
            </span>
            {mode !== null && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  disposeSource();
                  setMode(null);
                  setRows([]);
                }}
              >
                Change source
              </button>
            )}
          </div>
        </div>
      </header>

      {checking ? (
        <FenceCheck onBack={() => setChecking(false)} />
      ) : mode === null ? (
        <section className="setup" aria-label="Choose a data source">
          <div className="source-cards">
            <div
              className="source-card"
              role="button"
              tabIndex={0}
              onClick={() => chooseMode('simulated')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') chooseMode('simulated');
              }}
            >
              <div className="source-card-header">
                <span className="source-icon">💻</span>
                <span className="badge">Works in any browser</span>
              </div>
              <h3>Virtual Stand Simulation</h3>
              <p className="source-desc">
                Investigate free fall on an interactive virtual stand with dual-beam photogates. Position the gates, read heights on the precision ruler, and release the sphere to capture microsecond timing.
              </p>
              <div className="source-card-footer">
                <button className="btn btn-accent btn-large" type="button">
                  Start Virtual Lab →
                </button>
              </div>
            </div>

            <div
              className="source-card"
              role="button"
              tabIndex={0}
              onClick={() => chooseMode('vernier')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') chooseMode('vernier');
              }}
            >
              <div className="source-card-header">
                <span className="source-icon">📡</span>
                <span className="badge amber">Bluetooth · Chrome or Edge</span>
              </div>
              <h3>Vernier Go Direct Photogates</h3>
              <p className="source-desc">
                Connect real physical Vernier GDX-VPG photogates wirelessly via Web Bluetooth. Each gate streams dual-beam microsecond timing directly into your lab table.
              </p>
              <div className="source-card-footer">
                <button
                  className="btn btn-primary btn-large"
                  type="button"
                  disabled={!webBluetoothSupported()}
                >
                  {webBluetoothSupported() ? 'Connect Photogates →' : 'Open in Google Chrome'}
                </button>
              </div>
            </div>
          </div>

          <div className="setup-toolbar">
            <div className="toolbar-item">
              <span className="toolbar-label">🎓 Teacher Demo:</span>
              <button className="btn btn-quiet" onClick={() => chooseMode('example')}>
                Load Pre-Recorded Experiment
              </button>
              <span className="toolbar-hint">— realistic dual-beam trial, no hardware needed.</span>
            </div>
            <div className="toolbar-item">
              <span className="toolbar-label">⏱️ Hardware Check:</span>
              <button className="btn btn-quiet" onClick={() => setChecking(true)}>
                Photogate Timing Check (Picket Fence)
              </button>
            </div>
          </div>
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
          <p className="datalabel">
            Data source: <strong>{dataLabel}</strong>
          </p>

          {step === 'collect' && (
            <Collect
              mode={mode}
              source={src}
              rows={rows}
              saved={saved}
              onKeep={keepDrop}
              onClearSaved={() => {
                setSaved([]);
                resetAnalysis();
              }}
              analysisBlocker={analysisBlocker}
              beams={beams}
              armed={armed}
              error={error}
              onPosition={handlePosition}
              onAddGate={addGate}
              onRemoveGate={removeGate}
              onStandMoved={() => {
                clearTimes();
                resetAnalysis();
              }}
              onCopyStandHeights={mode === 'simulated' ? copyStandHeights : undefined}
              onSort={sortRows}
              onRefresh={() => {}}
              onArm={arm}
              onDrop={() => (src as SimulatedPhotogateSource | null)?.drop()}
              onReset={clearAll}
              onExport={exportCsv}
              onNext={() => goto('position')}
              onChangeSource={() => {
                disposeSource();
                setMode(null);
                setRows([]);
              }}
            />
          )}
          {step === 'position' && (
            <Position
              data={data}
              fit={fit}
              showFit={showFit}
              onToggleFit={() => setShowFit((s) => !s)}
              onNext={() => goto('velocity')}
            />
          )}
          {step === 'velocity' && fit.ok && (
            <Velocity
              data={data}
              fit={fit.value}
              records={records}
              setRecords={setRecords}
              onNext={() => goto(teacher ? 'linearize' : 'compare')}
            />
          )}
          {step === 'velocity' && !fit.ok && (
            <div className="card">
              <div className="callout warn">{fit.reason}</div>
            </div>
          )}
          {step === 'linearize' && teacher && (
            <Linearize data={data} lin={lin} setLin={setLin} onNext={() => goto('compare')} />
          )}
          {step === 'compare' && <Compare estimates={estimates} onExport={exportCsv} />}
        </>
      )}
      <footer className="foot">
        The Thinking Experiment ·{' '}
        {dataLabel === 'Simulated data'
          ? 'Simulated data is labeled wherever it appears.'
          : 'Hardware mode is experimental.'}{' '}
        · <TeacherLock teacher={teacher} onChange={setTeacherMode} />
      </footer>
    </div>
  );
}
