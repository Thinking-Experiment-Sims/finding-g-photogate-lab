import { describe, expect, it } from 'vitest';
import { distinctHeights, exampleRows, stationRows, measurements, parsePosition, readiness, relativeTimes, rowStatuses, toCsv, type GateRow } from './model';
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
  it('puts the header in row 1, labels the data source and drop on every row, and skips non-finite points', () => {
    const csv = toCsv(
      [
        { label: 'Gate 1', y: 0.1, t: 0, drop: 1 },
        { label: 'Gate, 2', y: 0.3, t: 0.3, drop: 2 },
        { label: 'Gate 3', y: NaN, t: 0.6, drop: 2 },
      ],
      'Simulated data',
    );
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('gate,position_m,time_s,data_source,drop');
    expect(lines[1]).toBe('Gate 1,0.1000,0.00000,Simulated data,1');
    expect(lines[2]).toBe('"Gate, 2",0.3000,0.30000,Simulated data,2');
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

describe('stationRows (two-beam photogates → one station each)', () => {
  const beam = (id: string, group: string, t: number | null): GateRow => ({ gateId: id, label: id, positionText: '', rawTime: t, groupId: group, groupLabel: `GDX ${group}` });
  it('one station per photogate: crease height, mean of the two beam times', () => {
    const st = stationRows([beam('a1', 'A', 0.30), beam('a2', 'A', 0.32), beam('b1', 'B', 0.50), beam('b2', 'B', 0.52)], { A: '0.900', B: '0.500' });
    expect(st).toHaveLength(2);
    expect(st[0]).toMatchObject({ gateId: 'A', positionText: '0.900' });
    // Kinematic crease time accounts for acceleration across the 2 cm dual-beam gap
    expect(st[0].rawTime).toBeCloseTo(0.310489, 4);
    expect(st[0].velocity).toBeCloseTo(1.0, 2);
    expect(st[1].rawTime).toBeCloseTo(0.510489, 4);
  });
  it('is not timed until every beam has fired, and does not depend on beam order', () => {
    expect(stationRows([beam('a1', 'A', 0.3), beam('a2', 'A', null)], { A: '0.9' })[0].rawTime).toBeNull();
    const x = stationRows([beam('a1', 'A', 0.30), beam('a2', 'A', 0.32)], { A: '0.9' })[0].rawTime;
    const y = stationRows([beam('a2', 'A', 0.32), beam('a1', 'A', 0.30)], { A: '0.9' })[0].rawTime;
    expect(x).toBe(y);
  });
  it('passes ungrouped rows through and keeps invalid typed text for validation', () => {
    expect(stationRows([row('x', '0.5', 1)], {})[0].positionText).toBe('0.5');
    expect(stationRows([beam('a1', 'A', 1), beam('a2', 'A', 1)], { A: 'abc' })[0].positionText).toBe('abc');
  });
  it("computes gate velocity from the 1 µs dual beam difference", () => {
    const st = stationRows([beam("a1", "A", 0.100), beam("a2", "A", 0.110)], { A: "1.000" });
    expect(st[0].velocity).toBeCloseTo(2.0, 2); // 0.02 m / 0.010 s = 2.0 m/s
  });

  it("two photogates are two usable stations, which is not yet enough for a quadratic", () => {
    const st = stationRows([beam('a1', 'A', 0.2), beam('a2', 'A', 0.21), beam('b1', 'B', 0.35), beam('b2', 'B', 0.36)], { A: '0.900', B: '0.500' });
    expect(measurements(st)).toHaveLength(2);
    expect(readiness(st).complete).toBe(false);
  });
});

describe('distinctHeights', () => {
  it('counts heights more than 5 mm apart', () => {
    expect(distinctHeights([{ y: 0.9 }, { y: 0.9 }, { y: 0.902 }, { y: 0.5 }])).toBe(2);
    expect(distinctHeights([{ y: 0.9 }, { y: 0.5 }, { y: 0.2 }, { y: NaN }])).toBe(3);
  });
});
