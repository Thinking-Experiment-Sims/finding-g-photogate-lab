import { DEFAULT_SIM_HEIGHTS, simulatedArrivalTime } from '../../sensors/SimulatedPhotogateSource';

/** One row of the data table: a gate, the height the student typed, and the raw time the gate reported. */
export interface GateRow {
  gateId: string;
  label: string;
  /** Exactly what the student typed: height above the table, in meters. Kept as text so partial input never gets "corrected". */
  positionText: string;
  /** Time on the source's clock, seconds. null until the gate fires. */
  rawTime: number | null;
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
 * A data_source column keeps simulated data labeled even after it leaves the app. Gates missing either value are omitted.
 */
export function toCsv(rows: GateRow[], dataLabel: string): string {
  const times = relativeTimes(rows);
  const lines = ['gate,position_m,time_s,data_source'];
  rows.forEach((r) => {
    const p = parsePosition(r.positionText);
    const t = times.get(r.gateId);
    if (p === null || t === undefined) return;
    lines.push([csvEscape(r.label), p.toFixed(4), t.toFixed(5), csvEscape(dataLabel)].join(','));
  });
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
