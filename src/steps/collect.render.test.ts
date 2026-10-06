import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Collect } from './Collect';
import type { GateRow } from '../experiments/fallingMotion/model';

const beam = (id: string, g: string, label: string, pos: string, t: number | null): GateRow => ({
  gateId: id,
  label,
  positionText: pos,
  rawTime: t,
  groupId: g,
  groupLabel: `GDX-VPG ${g}`,
});
const noop = () => {};

describe('Collect with dual-beam photogates', () => {
  const rows: GateRow[] = [
    beam('A#4', 'A', 'GDX-VPG A · Beam 1 (Top)', '0.900', 0.200),
    beam('A#5', 'A', 'GDX-VPG A · Beam 2 (Bottom)', '0.880', 0.210),
    beam('B#4', 'B', 'GDX-VPG B · Beam 1 (Top)', '0.500', 0.310),
    beam('B#5', 'B', 'GDX-VPG B · Beam 2 (Bottom)', '0.480', 0.318),
  ];

  const html = renderToStaticMarkup(
    createElement(Collect, {
      mode: 'vernier',
      source: null,
      rows,
      saved: [],
      onKeep: noop,
      onClearSaved: noop,
      analysisBlocker: null,
      beams: {},
      armed: false,
      error: null,
      onPosition: noop,
      onAddGate: noop,
      onRemoveGate: noop,
      onSort: noop,
      onRefresh: noop,
      onStandMoved: noop,
      onArm: noop,
      onDrop: noop,
      onReset: noop,
      onExport: noop,
      onNext: noop,
      onChangeSource: noop,
    }),
  );

  it('renders a row for each beam with point numbers for the student lab report', () => {
    expect(html).toContain('Point');
    expect(html).toContain('GDX-VPG A · Beam 1 (Top)');
    expect(html).toContain('GDX-VPG A · Beam 2 (Bottom)');
    expect(html).toContain('GDX-VPG B · Beam 1 (Top)');
    expect(html).toContain('GDX-VPG B · Beam 2 (Bottom)');
    expect(html).toContain('📋 Copy Table for Lab Report');
  });

  it('references times to the first beam (t = 0.0000) and displays gate velocities', () => {
    expect(html).toContain('0.0000'); // first beam trigger = 0
    expect(html).toContain('m/s'); // gate velocity computed from 2 cm beam spacing
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it('offers to keep the drop and continue analysis once all beams have heights', () => {
    expect(html).toContain('Keep this drop');
    expect(html).toContain('Graph position vs. time');
  });
});
