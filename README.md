# Physics Data Lab

A browser-based data collection and analysis app for high-school physics, by **The Thinking Experiment**.
Module 1: **Falling Motion — Photogates** (finding *g* with Vernier Go Direct Photogates on a stand).

- Live app: https://thinking-experiment-sims.github.io/finding-g-photogate-lab/
- Specification: [docs/SPEC.md](docs/SPEC.md) · Design decisions: [docs/DESIGN-NOTES.md](docs/DESIGN-NOTES.md)
- Vernier integration findings and risks: [docs/VERNIER-FINDINGS.md](docs/VERNIER-FINDINGS.md)
- Rules for contributors and AI agents: [AGENTS.md](AGENTS.md)
- Virtual version of this lab: https://thinking-experiment-sims.github.io/measuring-g-acceleration-lab/

## Student workflow

1. **Collect data** — connect gates (or use the simulated stand), type each gate's height, drop the object.
2. **Position vs. time** — fit *y*(*t*) = *At*² + *Bt* + *C*; see *v*₀ = *B*, *a* = 2*A*.
3. **Velocity from tangents** — slide along the curve, read tangent slopes, build the v–t graph; its slope is *a*.
4. **Linearize** — choose axis quantities until the graph is straight; interpret the slope.
5. **Compare** — three values of *g* against 9.81 m/s².

Connecting real Vernier sensors requires **Google Chrome** (or Edge) and is **experimental / untested with hardware** —
see the findings doc. Simulated mode works in any browser.

## Development
```
npm ci
npm run dev     # local preview
npm test        # unit tests
npm run build   # static site in dist/
```
