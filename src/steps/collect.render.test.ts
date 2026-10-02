import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Collect } from './Collect';
import { stationRows, type GateRow } from '../experiments/fallingMotion/model';

const beam = (id: string, g: string, t: number | null): GateRow => ({ gateId: id, label: id, positionText: '', rawTime: t, groupId: g, groupLabel: `GDX-VPG ${g}` });
const noop = () => {};

describe('Collect with two two-beam photogates', () => {
  const raw = [beam('A#4', 'A', 0.2), beam('A#5', 'A', 0.203), beam('B#4', 'B', 0.31), beam('B#5', 'B', 0.312)];
  const rows = stationRows(raw, { A: '0.900', B: '0.500' });
  const html = renderToStaticMarkup(
    createElement(Collect, {
      mode: 'vernier', source: null, rows, beamRows: raw, saved: [], onKeep: noop, onClearSaved: noop, analysisBlocker: null, creases: { A: '0.900', B: '0.500' }, beams: {}, armed: false, error: null,
      onCrease: noop, onPosition: noop, onAddGate: noop, onRemoveGate: noop, onSort: noop, onRefresh: noop, onStandMoved: noop,
      onArm: noop, onDrop: noop, onReset: noop, onExport: noop, onNext: noop, onChangeSource: noop,
    }),
  );
  it('shows one row per photogate with a crease-height input, not one per beam', () => {
    expect(html.match(/crease height in meters/g)).toHaveLength(2);
    expect(html).toContain('GDX-VPG A');
    expect(html).toContain('GDX-VPG B');
    expect(html).toMatch(/crease between the two beams/);
  });
  it('shows each gate time (mean of its beams, 0 at the first gate), the beam times, and never NaN/Infinity', () => {
    expect(html).toContain('0.000'); // first gate = t 0
    expect(html).toContain('beams:');
    expect(html).not.toMatch(/NaN|Infinity/);
  });
  it('does not ask for more heights once both crease heights are entered, and offers to keep the drop', () => {
    expect(html).not.toMatch(/Enter \d more/);
    expect(html).toContain('Keep this drop');
  });
});
