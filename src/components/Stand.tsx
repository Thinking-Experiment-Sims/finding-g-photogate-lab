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

/** Virtual drop stand with a ruler. Gates can be dragged; students read heights off the ruler. */
export function Stand({ source, gates, beams, onMoved }: { source: SimulatedPhotogateSource; gates: GateInfo[]; beams: Record<string, GateInfo['beam']>; onMoved: () => void }) {
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
    const next = Math.round(hOf(py) / 0.005) * 0.005;
    const prev = source.standGates().find((g) => g.id === id)?.position;
    source.moveGate(id, next);
    if (prev !== source.standGates().find((g) => g.id === id)?.position) onMoved();
  };

  const ticks = Array.from({ length: Math.round(H_MAX * 100) + 1 }, (_, i) => i);
  return (
    <svg ref={svg} className="stand" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Drop stand with a vertical ruler and photogates. Drag a gate to move it." style={{ touchAction: 'none' }}>
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
      {ticks.map((cm) => {
        const major = cm % 10 === 0;
        const mid = cm % 5 === 0;
        const py = yPx(cm / 100);
        return (
          <g key={cm}>
            <line x1={RULER_X + 6} x2={RULER_X + 6 - (major ? 24 : mid ? 15 : 8)} y1={py} y2={py} className={major ? 'stand-tick' : 'stand-tick minor'} />
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
      {/* gates */}
      {stand.map((g) => {
        const info = gates.find((x) => x.id === g.id);
        const blocked = beams[g.id] === 'blocked';
        const py = yPx(g.position);
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
            <rect x={POLE_X - 56} y={py - 16} width={150} height={32} fill="transparent" />
            <rect x={POLE_X - 48} y={py - 7} width={96} height={14} rx={4} className="stand-gate-body" />
            <line x1={POLE_X - 48} x2={POLE_X + 48} y1={py} y2={py} className={blocked ? 'stand-beam blocked' : 'stand-beam'} />
            <text x={POLE_X + 56} y={py + 5} className="stand-gate-label">
              {info?.label ?? g.label}
            </text>
          </g>
        );
      })}
      {/* object */}
      <circle cx={POLE_X} cy={yPx(ballH)} r={9} className="stand-ball" />
      <text x={W - 10} y={TOP - 10} textAnchor="end" className="stand-small">
        Simulated stand
      </text>
      <text x={W - 10} y={H - 6} textAnchor="end" className="stand-small">
        Drag a gate, then read its height ({SIM_MIN_HEIGHT.toFixed(2)}–{SIM_MAX_HEIGHT.toFixed(2)} m)
      </text>
    </svg>
  );
}
