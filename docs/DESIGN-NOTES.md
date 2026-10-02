# Design notes — Claude's implementation

Decisions that differ from, or go beyond, `SPEC.md`. Each was made on purpose; override any of them.

1. **Heights are up-positive (height above the table).** Matches the virtual lab (`measuring-g-acceleration-lab`, `y(t) = At² + Bt + C`,
   `g = |a|`). So `A ≈ −4.9`, `a = 2A ≈ −9.8 m/s²`, and the UI says why it is negative. Spec said "position"; the column is
   labeled "Height *y* (m), up from the table".
2. **Velocity comes from tangent lines on the fitted curve — never on data points** (the owner's rule). Students drag a continuous
   slider that moves a point *along the fitted curve*; the tangent line follows smoothly (as in `slope-tangents-sim`). They read the
   tangent's slope and **record** (*t*, *v*) points at any times they choose to build the v–t graph; its slope is *a*. The slope is
   measured as a tiny symmetric secant on the curve, not by evaluating a formula. `v(t) = 2At + B` is revealed only after ≥ 3 points.
   There is no snapping to gate times, and no neighbor-gate slope mode (removed on purpose).
   - Consequence: the v–t slope equals 2A by construction, so methods 1 and 2 are not independent. The Compare page says so.
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
6. **Two-beam photogates → one crease height.** A Go Direct Photogate has two beams ~2 cm apart. Students measure and enter ONE height: the
   crease between the beams. The app derives the beam heights (crease ± 1 cm; the beam that fires first is the upper one because the object
   is falling), so two photogates give four data points. `deriveRows()` in `model.ts`.
7. **Row → gate mapping (the Graphical Analysis complaint).** Each table row is one gate; its dot lights amber while that physical
   gate's beam is blocked ("block a gate with your hand to find its row"). Times are shown as one number per gate, in seconds, relative to the first gate.
