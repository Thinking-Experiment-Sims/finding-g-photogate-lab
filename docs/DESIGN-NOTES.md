# Design notes — Claude's implementation

Decisions that differ from, or go beyond, `SPEC.md`. Each was made on purpose; override any of them.

1. **Heights are up-positive (height above the table).** Matches the virtual lab (`measuring-g-acceleration-lab`, `y(t) = At² + Bt + C`,
   `g = |a|`). So `A ≈ −4.9`, `a = 2A ≈ −9.8 m/s²`, and the UI says why it is negative. Spec said "position"; the column is
   labeled "Height *y* (m), up from the table".
2. **Velocity comes from tangent lines, not just `v = 2At + B`** (the owner's change after the spec was written). Students move *t*
   along the fitted curve (as in `slope-tangents-sim`), read the tangent's slope, and record (*t*, *v*) points that build the v–t
   graph. The slope is measured as a tiny symmetric secant, not by evaluating a formula. `v(t) = 2At + B` is only revealed
   after ≥ 3 points are recorded.
   - **Caveat:** a tangent to the *fitted* curve has slope `2At + B` by construction, so method 2 equals method 1 digit for digit.
   - An optional switch ("use only my data") instead uses slopes between **neighboring gates**, plotted at the midpoint time. That
     value depends on the raw data, so it is a genuinely independent estimate.
3. **Linearization is Δy/Δt vs *t*** (slope = a/2, intercept = v₀), not *y* vs *t²*. Time zero is the first gate, where the object is
   already moving (v₀ ≠ 0), so *y* vs *t²* is *not* a straight line. Students may try it; it visibly fails (R² ≈ 0.98 in the
   simulation) and a two-step hint points toward dividing by *t*. If the object is released from rest at gate 1, *y* vs *t²* does
   straighten and is accepted. The student must choose how *a* relates to the slope (a = k × slope); the third *g* only counts
   once they choose.
4. **Plotting library:** none. Charts are hand-rolled SVG (`components/Chart.tsx`) so the tangent overlay, brand colors and text sizes
   are fully controlled and no dependency is added. Runtime dependencies: `react`, `react-dom`, `@vernier/godirect` (lazy-loaded only
   when Vernier mode is chosen).
5. **`text-encoding` alias.** `@vernier/godirect` has an undeclared fallback import of `text-encoding`; `vite.config.ts` aliases it to
   the browser's native `TextDecoder` instead of adding a package.
6. **Row → gate mapping (the Graphical Analysis complaint).** Each table row is one gate; its dot lights amber while that physical
   gate's beam is blocked ("block a gate with your hand to find its row"). Times are shown as one number per gate, in seconds, relative to the first gate.
