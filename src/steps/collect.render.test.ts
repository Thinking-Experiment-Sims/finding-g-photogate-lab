import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Collect } from './Collect';
import { deriveRows, type GateRow } from '../experiments/fallingMotion/model';

const beam = (id: string, g: string, t: number | null): GateRow => ({ gateId: id, label: id, positionText: '', rawTime: t, groupId: g, groupLabel: `GDX-VPG ${g}` });
const noop = () => {};

describe('Collect with two two-beam photogates', () => {
  const raw = [beam('A#4', 'A', 0.2), beam('A#5', 'A', 0.203), beam('B#4', 'B', 0.31), beam('B#5', 'B', 0.312)];
  const rows = deriveRows(raw, { A: '0.900', B: '0.500' });
  const html = renderToStaticMarkup(
    createElement(Collect, {
      mode: 'vernier', source: null, rows, creases: { A: '0.900', B: '0.500' }, beams: {}, armed: false, error: null,
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
  it('shows both beam times per photogate and never NaN/Infinity', () => {
    expect(html).toContain('0.000'); // first beam fired = t 0
    expect(html).not.toMatch(/NaN|Infinity/);
  });
  it('offers 4 usable data points: not asking for more heights', () => {
    expect(html).not.toMatch(/Enter \d more/);
  });
});
