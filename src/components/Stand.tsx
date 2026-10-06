import { useEffect, useRef, useState } from 'react';
import { SIM_MAX_HEIGHT, SIM_MIN_HEIGHT, SIM_RELEASE_HEIGHT, type SimulatedPhotogateSource } from '../sensors/SimulatedPhotogateSource';
import type { GateInfo } from '../sensors/types';

const W = 330;
const H = 620;
const TOP = 30; // px for height 1.40 m
const BOTTOM = 560; // px for height 0 m (the table)
const H_MAX = 1.4;
const PX_PER_M = (BOTTOM - TOP) / H_MAX;
const RULER_X = 104;
const POLE_X = 190;

const yPx = (h: number) => BOTTOM - h * PX_PER_M;
const hOf = (py: number) => (BOTTOM - py) / PX_PER_M;

/** Virtual drop stand with a ruler and dual-beam photogates. Gates can be dragged; students read heights off the ruler. */
export function Stand({ source, beams, onMoved }: { source: SimulatedPhotogateSource; gates?: GateInfo[]; beams: Record<string, GateInfo['beam']>; onMoved: () => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [ballH, setBallH] = useState(SIM_RELEASE_HEIGHT);
  const stand = source.standGates();

  // Animate the falling object from the moment of the drop.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const start = source.lastDropStart;
      if (start !== null) {
        const t = (performance.now() - start) / 1000;
        const h = Math.max(SIM_RELEASE_HEIGHT - 0.5 * 9.81 * t * t, 0.04);
        setBallH(h);
        if (h > 0.04) raf = requestAnimationFrame(tick);
      }
    };
    const id = setInterval(() => {
      if (source.lastDropStart !== null && performance.now() - source.lastDropStart < 60) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(tick);
      }
    }, 30);
    return () => {
      clearInterval(id);
      cancelAnimationFrame(raf);
    };
  }, [source]);

  const move = (clientY: number, id: string) => {
    const el = svg.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const py = ((clientY - r.top) / r.height) * H;
    const next = Math.round(hOf(py) / 0.001) * 0.001;
    const prev = source.standGates().find((g) => g.id === id)?.position;
    source.moveGate(id, next);
    if (prev !== source.standGates().find((g) => g.id === id)?.position) onMoved();
  };

  const cmTicks = Array.from({ length: Math.round(H_MAX * 100) + 1 }, (_, i) => i);
  const mm5Ticks = Array.from({ length: Math.round(H_MAX * 200) + 1 }, (_, i) => i);

  return (
    <svg ref={svg} className="stand" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Drop stand with a vertical ruler and dual-beam photogates. Drag a gate to move it." style={{ touchAction: 'none' }}>
      <rect x={0} y={0} width={W} height={H} className="stand-bg" />
      {/* table */}
      <rect x={20} y={BOTTOM} width={W - 40} height={14} className="stand-table" />
      <text x={W / 2} y={BOTTOM + 34} textAnchor="middle" className="stand-small">
        table (height 0)
      </text>
      {/* pole */}
      <rect x={POLE_X - 4} y={TOP} width={8} height={BOTTOM - TOP} className="stand-pole" />
      {/* ruler */}
      <rect x={RULER_X - 40} y={TOP - 6} width={46} height={BOTTOM - TOP + 6} className="stand-ruler" rx={3} />
      {mm5Ticks.map((i) => {
        if (i % 2 === 0) return null; // cm ticks drawn separately with greater prominence
        const py = yPx(i * 0.005);
        return (
          <line key={`mm5-${i}`} x1={RULER_X + 6} x2={RULER_X + 6 - 9} y1={py} y2={py} className="stand-tick minor" />
        );
      })}
      {cmTicks.map((cm) => {
        const major = cm % 10 === 0;
        const mid = cm % 5 === 0;
        const py = yPx(cm / 100);
        return (
          <g key={cm}>
            <line x1={RULER_X + 6} x2={RULER_X + 6 - (major ? 24 : mid ? 18 : 13)} y1={py} y2={py} className={major ? 'stand-tick' : 'stand-tick minor'} />
            {major && (
              <text x={RULER_X - 46} y={py + 4} textAnchor="end" className="stand-small">
                {(cm / 100).toFixed(1)}
              </text>
            )}
          </g>
        );
      })}
      <text x={RULER_X - 46} y={TOP - 14} textAnchor="end" className="stand-small">
        height (m)
      </text>
      {/* release marker */}
      <line x1={POLE_X - 30} x2={POLE_X + 30} y1={yPx(SIM_RELEASE_HEIGHT)} y2={yPx(SIM_RELEASE_HEIGHT)} className="stand-release" />
      <text x={POLE_X + 36} y={yPx(SIM_RELEASE_HEIGHT) + 4} className="stand-small">
        release point
      </text>

      {/* dual-beam photogates */}
      {stand.map((g) => {
        const isDragging = dragging === g.id;
        const b1Pos = g.b1Position ?? g.position;
        const b2Pos = g.b2Position ?? (g.position - 0.02);
        const py1 = yPx(b1Pos);
        const py2 = yPx(b2Pos);
        const blocked1 = beams[`${g.id}-b1`] === 'blocked' || beams[g.id] === 'blocked';
        const blocked2 = beams[`${g.id}-b2`] === 'blocked';
        const bracketH = Math.max(py2 - py1 + 14, 22);

        return (
          <g
            key={g.id}
            className="stand-gate"
            style={{ cursor: 'ns-resize' }}
            onPointerDown={(e) => {
              (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
              setDragging(g.id);
              move(e.clientY, g.id);
            }}
            onPointerMove={(e) => dragging === g.id && move(e.clientY, g.id)}
            onPointerUp={() => setDragging(null)}
          >
            {/* hairline sightline for Beam 1 */}
            <line
              x1={RULER_X + 6}
              x2={POLE_X - 48}
              y1={py1}
              y2={py1}
              className="stand-sightline"
              stroke={isDragging ? 'var(--amber)' : 'var(--teal)'}
              strokeWidth={isDragging ? 1.5 : 1}
              strokeDasharray={isDragging ? 'none' : '2 2'}
              opacity={isDragging ? 1 : 0.75}
            />
            <polygon
              points={`${RULER_X + 6},${py1} ${RULER_X + 11},${py1 - 3} ${RULER_X + 11},${py1 + 3}`}
              fill={isDragging ? 'var(--amber)' : 'var(--teal-dark)'}
            />

            {/* hairline sightline for Beam 2 */}
            <line
              x1={RULER_X + 6}
              x2={POLE_X - 48}
              y1={py2}
              y2={py2}
              className="stand-sightline"
              stroke={isDragging ? 'var(--amber)' : 'var(--teal)'}
              strokeWidth={isDragging ? 1.5 : 1}
              strokeDasharray={isDragging ? 'none' : '2 2'}
              opacity={isDragging ? 1 : 0.55}
            />
            <polygon
              points={`${RULER_X + 6},${py2} ${RULER_X + 10},${py2 - 2.5} ${RULER_X + 10},${py2 + 2.5}`}
              fill={isDragging ? 'var(--amber)' : 'var(--teal)'}
            />

            {/* hit target for dragging */}
            <rect x={POLE_X - 56} y={py1 - 12} width={160} height={bracketH + 24} fill="transparent" />

            {/* photogate body spanning both beams */}
            <rect x={POLE_X - 48} y={py1 - 6} width={96} height={bracketH} rx={4} className="stand-gate-body" />

            {/* dual laser beams */}
            <line x1={POLE_X - 48} x2={POLE_X + 48} y1={py1} y2={py1} className={blocked1 ? 'stand-beam blocked' : 'stand-beam'} />
            <line x1={POLE_X - 48} x2={POLE_X + 48} y1={py2} y2={py2} className={blocked2 ? 'stand-beam blocked' : 'stand-beam'} />

            {/* optical sensor indicator LEDs */}
            <circle cx={POLE_X - 42} cy={py1} r={2.5} fill={blocked1 ? '#dc2626' : '#0f7e9b'} />
            <circle cx={POLE_X - 42} cy={py2} r={2.5} fill={blocked2 ? '#dc2626' : '#0f7e9b'} />

            {/* Labels showing Beam 1 and Beam 2 (2 cm apart) */}
            <text x={POLE_X + 54} y={py1 + 2} className="stand-gate-label">
              {g.label} · <tspan fill={isDragging ? 'var(--amber)' : 'var(--teal-dark)'} fontWeight="700">{b1Pos.toFixed(3)} m</tspan>
            </text>
            <text x={POLE_X + 54} y={py2 + 4} className="stand-gate-label" style={{ fontSize: '10.5px', fill: 'var(--body)' }}>
              ↳ Beam 2: <tspan fontWeight="600">{b2Pos.toFixed(3)} m</tspan>
            </text>
          </g>
        );
      })}

      {/* object */}
      <circle cx={POLE_X} cy={yPx(ballH)} r={9} className="stand-ball" />
      <text x={W - 10} y={TOP - 10} textAnchor="end" className="stand-small">
        Simulated Stand (Dual-Beam)
      </text>
      <text x={W - 10} y={H - 6} textAnchor="end" className="stand-small">
        Drag gate to position ({SIM_MIN_HEIGHT.toFixed(2)}–{SIM_MAX_HEIGHT.toFixed(2)} m)
      </text>
    </svg>
  );
}
