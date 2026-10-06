import { DEFAULT_SIM_HEIGHTS, simulatedArrivalTime, BEAM_SPACING } from '../../sensors/SimulatedPhotogateSource';

/** One row of the data table: a gate beam, the height the student typed or derived, and the raw time the gate reported. */
export interface GateRow {
  gateId: string;
  label: string;
  /** Exactly what the student typed: height above the table, in meters. Kept as text so partial input never gets "corrected". */
  positionText: string;
  /** Time on the source's clock, seconds. null until the gate fires. */
  rawTime: number | null;
  /** Set for the beams of a two-beam photogate: the device id. */
  groupId?: string;
  groupLabel?: string;
  /** Instantaneous speed measured at this gate, m/s (from 1 µs dual-beam timing or firmware). */
  velocity?: number | null;
}

export interface PhotogateMeasurement {
  gateId: string;
  position: number; // m, height above the table (up is positive)
  time: number; // s, relative to the first gate that fired (that gate has t = 0)
}

export interface RowStatus {
  gateId: string;
  position: number | null;
  time: number | null;
  problems: string[];
}

/** Parse "0.452", "0,452", " .5 " … Returns null for anything that is not a plain finite number. */
export function parsePosition(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (s === '' || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** Relative times measured from the very first beam that fired (first beam has t = 0). */
export const relativeTimes = (rows: GateRow[]): Map<string, number> => {
  const fired = rows.filter((r) => r.rawTime !== null && Number.isFinite(r.rawTime));
  const out = new Map<string, number>();
  if (fired.length === 0) return out;
  const t0 = Math.min(...fired.map((r) => r.rawTime as number));
  fired.forEach((r) => out.set(r.gateId, (r.rawTime as number) - t0));
  return out;
};

export function rowStatuses(rows: GateRow[]): RowStatus[] {
  const times = relativeTimes(rows);
  const parsed = rows.map((r) => parsePosition(r.positionText));
  return rows.map((r, i) => {
    const position = parsed[i];
    const time = times.get(r.gateId) ?? null;
    const problems: string[] = [];
    if (r.positionText.trim() === '') problems.push('Enter this beam’s height.');
    else if (position === null) problems.push('Height must be a number, like 0.452.');
    else if (position < 0) problems.push('Height is negative — measure up from the table.');
    else if (parsed.some((p, j) => j !== i && p !== null && Math.abs(p - position) < 1e-9)) {
      problems.push('Another beam has this same height.');
    }
    if (time === null) problems.push('No time yet.');
    return { gateId: r.gateId, position, time, problems };
  });
}

/** Rows that have a usable position and time, as measurements sorted by time. */
export function measurements(rows: GateRow[]): PhotogateMeasurement[] {
  return rowStatuses(rows)
    .filter((s) => s.position !== null && s.time !== null)
    .map((s) => ({ gateId: s.gateId, position: s.position as number, time: s.time as number }))
    .sort((a, b) => a.time - b.time);
}

/** Heights the student must still enter or fix, plus gates that have not fired. */
export function readiness(rows: GateRow[]): { complete: boolean; missingPositions: number; missingTimes: number; usable: number } {
  const s = rowStatuses(rows);
  const missingPositions = s.filter((x) => x.position === null).length;
  const missingTimes = s.filter((x) => x.time === null).length;
  return {
    complete: s.length >= 3 && s.every((x) => x.problems.length === 0),
    missingPositions,
    missingTimes,
    usable: s.filter((x) => x.position !== null && x.time !== null).length,
  };
}

const csvEscape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * CSV of the measurements. Row 1 is the header (point, photogate_beam, height_m, time_s, data_source, drop).
 */
export function toCsv(points: { label: string; y: number; t: number; drop: number }[], dataLabel: string): string {
  const lines = ['gate,position_m,time_s,data_source,drop'];
  for (const p of points) {
    if (!Number.isFinite(p.y) || !Number.isFinite(p.t)) continue;
    lines.push([csvEscape(p.label), p.y.toFixed(4), p.t.toFixed(5), csvEscape(dataLabel), String(p.drop)].join(','));
  }
  return lines.join('\n') + '\n';
}

/** Format table for lab reports in Markdown. */
export function toMarkdownTable(points: { label: string; y: number; t: number }[]): string {
  const lines = [
    '| Point | Photogate & Beam | Height y (m) | Time t (s) |',
    '| :---: | :--- | :---: | :---: |',
  ];
  points.forEach((p, i) => {
    if (Number.isFinite(p.y) && Number.isFinite(p.t)) {
      lines.push(`| ${i + 1} | ${p.label} | ${p.y.toFixed(4)} | ${p.t.toFixed(5)} |`);
    }
  });
  return lines.join('\n');
}

/** Teacher/demo data. Each photogate has Beam 1 and Beam 2 (2 cm apart), giving 8 distinct points. */
export function exampleRows(rand: () => number = Math.random): GateRow[] {
  const out: GateRow[] = [];
  DEFAULT_SIM_HEIGHTS.forEach((p, i) => {
    const gId = `example-${i + 1}`;
    const gLabel = `Gate ${i + 1}`;
    const y1 = p;
    const y2 = p - BEAM_SPACING;
    const t1 = simulatedArrivalTime(y1, rand);
    const t2 = simulatedArrivalTime(y2, rand);
    const dt = Math.max(t2 - t1, 0.0001);
    const vel = BEAM_SPACING / dt;

    out.push({
      gateId: `${gId}-b1`,
      label: `${gLabel} · Beam 1 (Top)`,
      positionText: y1.toFixed(3),
      rawTime: t1,
      groupId: gId,
      groupLabel: gLabel,
      velocity: null,
    });
    out.push({
      gateId: `${gId}-b2`,
      label: `${gLabel} · Beam 2 (Bottom)`,
      positionText: y2.toFixed(3),
      rawTime: t2,
      groupId: gId,
      groupLabel: gLabel,
      velocity: vel,
    });
  });
  return out;
}

/**
 * Optional legacy helper to calculate crease station rows if needed.
 */
export function stationRows(rows: GateRow[], creases: Record<string, string>, gateVelocities?: Record<string, number>): GateRow[] {
  const out: GateRow[] = [];
  const seen = new Set<string>();
  const g = 9.81;

  for (const r of rows) {
    if (!r.groupId) {
      out.push({
        ...r,
        velocity: r.velocity ?? (gateVelocities ? gateVelocities[r.gateId] ?? null : null),
      });
      continue;
    }
    if (seen.has(r.groupId)) continue;
    seen.add(r.groupId);
    const members = rows.filter((m) => m.groupId === r.groupId);
    const times = members.map((m) => m.rawTime);
    const complete = times.every((t): t is number => t !== null && Number.isFinite(t));

    let rawTime: number | null = null;
    let velocity: number | null = gateVelocities ? gateVelocities[r.groupId] ?? null : null;

    if (complete && times.length === 2) {
      const [tA, tB] = times as [number, number];
      const t1 = Math.min(tA, tB);
      const t2 = Math.max(tA, tB);
      const dt = t2 - t1;
      if (dt > 1e-6) {
        const vBar = BEAM_SPACING / dt;
        if (!velocity) velocity = vBar;
        const v1 = Math.max(vBar - 0.5 * g * dt, 0.01);
        const vc = Math.sqrt(v1 * v1 + g * BEAM_SPACING);
        const dtCrease = BEAM_SPACING / (v1 + vc);
        rawTime = t1 + dtCrease;
      } else {
        rawTime = (tA + tB) / 2;
      }
    } else if (complete) {
      rawTime = (times as number[]).reduce((a, b) => a + b, 0) / times.length;
    }

    out.push({
      gateId: r.groupId,
      label: r.groupLabel ?? r.label,
      positionText: creases[r.groupId] ?? '',
      rawTime,
      velocity,
    });
  }
  return out;
}

/** A point kept from an earlier drop: height and time relative to that drop's first gate. */
export interface SavedPoint {
  y: number;
  t: number;
  drop: number;
  label: string;
}

/** Number of distinct heights (more than 5 mm apart). A quadratic fit needs at least 3. */
export function distinctHeights(points: { y: number }[]): number {
  const ys = points.map((p) => p.y).filter(Number.isFinite).sort((a, b) => a - b);
  let n = 0;
  let last = -Infinity;
  for (const y of ys) {
    if (y - last > 0.005) n += 1;
    last = y;
  }
  return n;
}
