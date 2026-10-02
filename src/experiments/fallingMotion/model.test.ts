import { describe, expect, it } from 'vitest';
import { exampleRows, measurements, parsePosition, readiness, relativeTimes, rowStatuses, toCsv, type GateRow } from './model';
import { fitPosition, quadraticAcceleration } from '../../physics/kinematics';

const row = (id: string, pos: string, t: number | null): GateRow => ({ gateId: id, label: id, positionText: pos, rawTime: t });

describe('parsePosition', () => {
  it('accepts plain decimals and comma decimals', () => {
    expect(parsePosition('0.452')).toBe(0.452);
    expect(parsePosition(' 0,5 ')).toBe(0.5);
    expect(parsePosition('.5')).toBe(0.5);
  });
  it('rejects blanks, text, units, and non-finite', () => {
    for (const bad of ['', '  ', 'abc', '0.4 m', '1e999x', 'NaN', 'Infinity', '1.2.3']) expect(parsePosition(bad)).toBeNull();
  });
});

describe('table model', () => {
  it('references times to the first gate that fires, in any row order', () => {
    const t = relativeTimes([row('a', '0.5', 0.30), row('b', '0.1', 0.15), row('c', '0.2', null)]);
    expect(t.get('b')).toBe(0);
    expect(t.get('a')).toBeCloseTo(0.15, 12);
    expect(t.has('c')).toBe(false);
  });
  it('flags missing, non-numeric, negative, duplicate positions and missing times', () => {
    const s = rowStatuses([row('a', '', 0.1), row('b', 'x', 0.2), row('c', '-1', 0.3), row('d', '0.5', null), row('e', '0.5', 0.4)]);
    expect(s[0].problems.join()).toMatch(/Enter/);
    expect(s[1].problems.join()).toMatch(/number/);
    expect(s[2].problems.join()).toMatch(/negative/);
    expect(s[3].problems.join()).toMatch(/same height/);
    expect(s[3].problems.join()).toMatch(/No time/);
    expect(s[4].problems.join()).toMatch(/same height/);
  });
  it('readiness counts what is missing', () => {
    const r = readiness([row('a', '0.1', 0.1), row('b', '', 0.2), row('c', '0.3', null)]);
    expect(r).toMatchObject({ complete: false, missingPositions: 1, missingTimes: 1, usable: 1 });
  });
  it('measurements only include fully specified rows, sorted by time', () => {
    const m = measurements([row('a', '0.5', 0.4), row('b', '0.1', 0.2), row('c', '', 0.3)]);
    expect(m.map((x) => x.gateId)).toEqual(['b', 'a']);
    expect(m[0].time).toBe(0);
  });
});

describe('CSV export', () => {
  it('puts the header in row 1, labels the data source on every row, and omits incomplete rows', () => {
    const csv = toCsv([row('Gate 1', '0.1', 0.2), row('Gate, 2', '0.3', 0.5), row('Gate 3', '', 0.6)], 'Simulated data');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('gate,position_m,time_s,data_source');
    expect(lines[1]).toBe('Gate 1,0.1000,0.00000,Simulated data');
    expect(lines[2]).toBe('"Gate, 2",0.3000,0.30000,Simulated data');
    expect(lines).toHaveLength(3);
  });
});

describe('example experiment', () => {
  it('is analysed by the normal regression, not hard-coded (a ≈ −9.8 within noise)', () => {
    const m = measurements(exampleRows());
    expect(m).toHaveLength(5);
    const fit = fitPosition(m.map((d) => ({ t: d.time, y: d.position })));
    expect(fit.ok).toBe(true);
    if (fit.ok) expect(Math.abs(quadraticAcceleration(fit.value))).toBeGreaterThan(8.5), expect(quadraticAcceleration(fit.value)).toBeLessThan(-8.5);
  });
});
