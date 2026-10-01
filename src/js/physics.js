/**
 * physics.js — pure physics for this simulation.
 *
 * Rules (see AGENTS.md §1): no DOM, no canvas, SI units, every function tested in tests/physics.test.js.
 * The UMD wrapper below exposes `Physics` as a global in the browser and as module.exports in Node.
 *
 * TEMPLATE STARTER: 1D motion with constant acceleration. Replace with this sim's model.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Physics = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const G = 9.8; // m/s², AGENTS.md §4

  /** Position at time t:  x = x0 + v0·t + ½·a·t² */
  function position({ x0 = 0, v0 = 0, a = 0 }, t) {
    return x0 + v0 * t + 0.5 * a * t * t;
  }

  /** Velocity at time t:  v = v0 + a·t */
  function velocity({ v0 = 0, a = 0 }, t) {
    return v0 + a * t;
  }

  /**
   * Time when the velocity is zero (turnaround), or null if it never happens for t > 0.
   * t = −v0 / a
   */
  function turnaroundTime({ v0 = 0, a = 0 }) {
    if (a === 0) return null;
    const t = -v0 / a;
    return t > 0 ? t : null;
  }

  /**
   * Fixed-step sampler for graphs and tables.
   * Returns [{ t, x, v, a }] from t = 0 to tMax inclusive.
   */
  function sample(params, tMax, dt) {
    if (!(dt > 0)) throw new RangeError("dt must be positive");
    const out = [];
    const steps = Math.round(tMax / dt);
    for (let i = 0; i <= steps; i++) {
      const t = i * dt;
      out.push({ t, x: position(params, t), v: velocity(params, t), a: params.a || 0 });
    }
    return out;
  }

  return { G, position, velocity, turnaroundTime, sample };
});
