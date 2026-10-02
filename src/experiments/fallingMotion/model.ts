import { DEFAULT_SIM_HEIGHTS, simulatedArrivalTime } from '../../sensors/SimulatedPhotogateSource';

/** One row of the data table: a gate, the height the student typed, and the raw time the gate reported. */
export interface GateRow {
  gateId: string;
  label: string;
  /** Exactly what the student typed: height above the table, in meters. Kept as text so partial input never gets "corrected". */
  positionText: string;
  /** Time on the source's clock, seconds. null until the gate fires. */
  rawTime: number | null;
  /** Set for the beams of a two-beam photogate: the device id. Heights for these rows are derived, not typed. */
  groupId?: string;
  groupLabel?: string;
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
    if (r.positionText.trim() === '') problems.push('Enter this gate’s height.');
    else if (position === null) problems.push('Height must be a number, like 0.452.');
    else if (position < 0) problems.push('Height is negative — measure up from the table.');
    else if (parsed.some((p, j) => j !== i && p !== null && Math.abs(p - position) < 1e-9)) {
      problems.push('Another gate has this same height.');
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
 * CSV of the measurements. Row 1 is the header the spec names (gate, position_m, time_s); position_m is the height above the table.
 * data_source keeps simulated data labeled after it leaves the app; drop numbers the kept drops (the current drop is last).
 */
export function toCsv(points: { label: string; y: number; t: number; drop: number }[], dataLabel: string): string {
  const lines = ['gate,position_m,time_s,data_source,drop'];
  for (const p of points) {
    if (!Number.isFinite(p.y) || !Number.isFinite(p.t)) continue;
    lines.push([csvEscape(p.label), p.y.toFixed(4), p.t.toFixed(5), csvEscape(dataLabel), String(p.drop)].join(','));
  }
  return lines.join('\n') + '\n';
}

/** Teacher/demo data. Heights are read to the nearest mm like a careful ruler; times carry noise. */
export function exampleRows(rand: () => number = Math.random): GateRow[] {
  return DEFAULT_SIM_HEIGHTS.map((p, i) => ({
    gateId: `example-${i + 1}`,
    label: `Gate ${i + 1}`,
    positionText: p.toFixed(3),
    rawTime: simulatedArrivalTime(p, rand),
  }));
}

/**
 * Turns raw beam rows into one STATION per physical photogate: height = the crease height the student typed (halfway between the
 * two beams), time = the mean of its beams' times (available only once every beam has fired). Averaging the two beams halves the
 * timing noise and avoids guessing which beam is on top. Ungrouped rows (simulated gates) are already stations and pass through.
 */
export function stationRows(rows: GateRow[], creases: Record<string, string>): GateRow[] {
  const out: GateRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.groupId) {
      out.push(r);
      continue;
    }
    if (seen.has(r.groupId)) continue;
    seen.add(r.groupId);
    const members = rows.filter((m) => m.groupId === r.groupId);
    const times = members.map((m) => m.rawTime);
    const complete = times.every((t): t is number => t !== null && Number.isFinite(t));
    out.push({
      gateId: r.groupId,
      label: r.groupLabel ?? r.label,
      positionText: creases[r.groupId] ?? '',
      rawTime: complete ? (times as number[]).reduce((a, b) => a + b, 0) / times.length : null,
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
