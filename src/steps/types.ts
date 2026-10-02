import type { XTransform, YTransform } from '../physics/kinematics';

export interface Datum {
  t: number; // s
  y: number; // m, height above the table
}

export interface VelRecord {
  t: number; // s
  v: number; // m/s
}

export interface LinState {
  xT: XTransform;
  yT: YTransform;
  fitShown: boolean;
  /** The student's claim: a = k × slope. null until chosen. */
  k: number | null;
  hint: 0 | 1 | 2;
}

/** The only transform pairs whose straight-line slope maps to a simple kinematics equation (a = 2 × slope). */
export const KNOWN_LINEAR = new Set(['t|dy_over_t', 't2|y', 't2|dy']);
// Noisy data: the correct Δy/Δt vs t graph can sit near 0.998, while y vs t² (when v₀ ≠ 0) is only ~0.98.
export const STRAIGHT_R2 = 0.99;
