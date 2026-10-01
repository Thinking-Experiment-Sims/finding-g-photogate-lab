# AGENTS.md — Physics Data Lab (React app)

Rules for every AI agent (Claude, Codex/ChatGPT, Gemini/Antigravity) working in this repo. `CLAUDE.md`, `GEMINI.md`,
and `.agent/rules/` only point here.

**This repo is an exception to the usual Thinking Experiment sim rules:** it is a growing multi-experiment application,
so it uses React + TypeScript + Vite with a build step. Do not apply the plain-HTML sim template rules here.

- **What to build:** [`docs/SPEC.md`](docs/SPEC.md) — the product specification. Read it fully before starting.
- **How to work:** this file.
- If the two conflict, or the spec is ambiguous in a way that changes the architecture, stop and ask Vladimir.

Owner: Vladimir Lopez — high school physics teacher (Houston). Users: high school physics students on school Macs,
Chromebooks, and tablets. Hosted free on GitHub Pages at `https://thinking-experiment-sims.github.io/<repo>/`.

---

## 1. Hard rules

1. **Stack:** React + TypeScript (strict) + Vite + Vitest. Minimal dependencies — justify every runtime dependency in
   your PR. No backend, accounts, database, analytics, or cloud storage. Data stays in the browser.
2. **Static deploy on GitHub Pages.** `npm run build` must produce a self-contained `dist/`. Set `base: './'` in
   `vite.config.ts` so the site works under any repo name. A GitHub Action (already in `.github/workflows/`) builds and
   deploys `main`; do not change deployment without asking.
3. **Layers stay separate** (spec "Core architecture"):
   - `src/physics/` — pure TypeScript math (regressions, R², derivatives). No React, no DOM, no sensor code.
   - `src/sensors/` — data sources behind one interface. All Vernier-specific code lives only here.
   - `src/experiments/` — experiment modules (falling-motion photogates first).
   - `src/ui/` (or `src/components/`) — React only; calls physics and sensors, never re-implements them.
4. **Never fake hardware.** Simulated data must be labeled as simulated everywhere it appears. Do not claim Vernier
   integration works unless it was tested with real devices — and you cannot test real devices, so say so.
5. **Tests:** commit `package-lock.json`. `npm test` (Vitest) must pass and `npm run build` must succeed before every commit. Every physics/math
   function has tests, including the cases listed in the spec. The UI must never show `NaN` or `Infinity`.
6. **Browsers:** everything except hardware must work in current Chrome, Safari, Firefox, and Edge on Mac, Windows,
   ChromeOS, and iPad. Hardware (Web Bluetooth / WebHID) only works in **Chrome and Edge** — detect support and show a
   plain-language message ("To connect Vernier sensors, open this page in Google Chrome") instead of failing.
7. **Brand: The Thinking Experiment, teal + amber.** Teal `#0f7e9b` / `#0b5f77`, amber `#d67b19` (minority accent),
   ink `#123140`, body text `#4b6570`, border `#c8dbe3`, light surfaces `#f7fcff` / `#f0f8fb`, white background. Fonts:
   Inter (headings/UI), IBM Plex Sans (body). Light mode. **Never** purple (`#59118e`/`#4b2e83`) or gold (`#ffc61e`/`#b3a369`).
   Define colors once as CSS custom properties and use them everywhere, including in charts.
8. **Accessible and touch-friendly:** labeled inputs, visible keyboard focus, buttons ≥ 44 px tall, readable at
   Chromebook resolution (1366×768) and on an iPad. Graphs are the largest elements on screen.
9. **Units and notation:** SI internally. Show units in every column header, axis, and result. Use real math notation
   (`x(t) = At² + Bt + C`, `v(t) = 2At + B`, `a = 2A`).

## 2. Multi-agent workflow

Several AIs build competing versions and critique each other. Rules:

- **Never commit to `main`.** Work on your own branch: `claude/<topic>`, `codex/<topic>`, or `gemini/<topic>`.
- **Work only in your own folder** (git worktree, e.g. `finding-g-photogate-lab--codex`). Never edit another agent's folder.
- **Commit messages** end with a trailer naming the agent, because all agents commit as Vladimir:
  `Agent: Claude` / `Agent: Codex` / `Agent: Gemini`.
- **Open a pull request** to `main` when a stage is ready (`gh pr create`), filling in the PR template. Vladimir merges;
  agents never merge their own PRs or push to `main`.
- **Reviewing another agent's PR** (`gh pr view <n>`, `gh pr diff <n>`; check it out in a scratch folder, never in
  someone else's worktree):
  1. `npm ci && npm test && npm run build`. Run `npm run dev` and use the app if a UI exists.
  2. Check the math against the spec and by hand for at least one case. Wrong physics or math is the most serious defect.
  3. Check the hard rules (§1), then the spec's student workflow and UI philosophy, then code quality and architecture.
  4. Post with `gh pr review <n> --comment --body-file <file>`, headed `Review by <Agent>`. Rank findings
     **Blocker / Should fix / Nice to have**, each with file:line, what is wrong, and a concrete fix. Also say what the
     other version does better than yours — the goal is the best app, not winning.
  5. Do not push to another agent's branch unless Vladimir asks.

## 3. Before opening a PR

- [ ] `npm ci && npm test && npm run build` pass; new math has tests
- [ ] No console errors; no `NaN`/`Infinity` reachable in the UI
- [ ] Simulated data clearly labeled; no fake hardware claims
- [ ] Brand palette only; works at 1366×768 and iPad width
- [ ] PR lists what was **not** tested (especially anything hardware-related)
- [ ] Commit trailer `Agent: <name>`
