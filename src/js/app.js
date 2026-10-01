/**
 * app.js — UI wiring, animation loop, and canvas rendering.
 * All physics comes from physics.js (global `Physics`). Keep equations out of this file.
 *
 * TEMPLATE STARTER: constant-acceleration cart. Replace the sim-specific parts; keep the
 * theme, tabs, status, and trial-table helpers.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ── Theme (AGENTS.md §1.6) ──────────────────────────────────
  const themeBtn = $("themeToggle");

  function applyTheme(theme) {
    document.body.dataset.theme = theme;
    themeBtn.textContent = theme === "dark" ? "Light mode" : "Dark mode";
    draw();
  }

  themeBtn.addEventListener("click", () => {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("te-theme", next); } catch (_) { /* storage blocked */ }
    applyTheme(next);
  });

  /** Read a design-system color so canvas drawing follows the theme. */
  function cssVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
  }

  // ── Status line ─────────────────────────────────────────────
  function setStatus(msg, type = "") {
    const el = $("statusText");
    el.textContent = msg;
    el.className = "status" + (type ? " " + type : "");
  }

  // ── State ───────────────────────────────────────────────────
  const TRACK_LENGTH = 20; // m
  const DOT_INTERVAL = 0.5; // s

  const state = {
    params: { x0: 2, v0: 2, a: 1 },
    tMax: 4,
    t: 0,
    running: false,
    lastFrame: null,
    showDots: true,
  };

  function readControls() {
    state.params.x0 = clamp(+$("x0Input").value, 0, TRACK_LENGTH);
    state.params.v0 = +$("v0Slider").value;
    state.params.a = +$("aSlider").value;
    state.tMax = clamp(+$("tMaxInput").value, 1, 10);
    state.showDots = $("dotsToggle").checked;
    $("v0Value").textContent = state.params.v0.toFixed(1) + " m/s";
    $("aValue").textContent = state.params.a.toFixed(2) + " m/s²";
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
  }

  // ── Animation ───────────────────────────────────────────────
  function frame(now) {
    if (!state.running) return;
    if (state.lastFrame !== null) {
      state.t = Math.min(state.tMax, state.t + (now - state.lastFrame) / 1000);
    }
    state.lastFrame = now;

    const x = Physics.position(state.params, state.t);
    if (x < 0 || x > TRACK_LENGTH) {
      stop();
      setStatus(`The cart left the track at t = ${state.t.toFixed(2)} s.`, "warn");
    } else if (state.t >= state.tMax) {
      stop();
      setStatus(`Run complete at t = ${state.tMax.toFixed(1)} s. Compare with your prediction.`, "ok");
    }
    draw();
    if (state.running) requestAnimationFrame(frame);
  }

  function start() {
    if (state.t >= state.tMax) state.t = 0;
    state.running = true;
    state.lastFrame = null;
    setStatus("Running…");
    requestAnimationFrame(frame);
  }

  function stop() {
    state.running = false;
    $("pauseBtn").textContent = "Pause";
  }

  function reset() {
    stop();
    state.t = 0;
    readControls();
    setStatus("Reset. Make a prediction, then press Start.");
    draw();
  }

  // ── Rendering ───────────────────────────────────────────────
  const canvas = $("simCanvas");
  const ctx = canvas.getContext("2d");

  function draw() {
    const W = canvas.width;
    const H = canvas.height;
    const pad = 50;
    const trackY = H * 0.62;
    const toPx = (x) => pad + (x / TRACK_LENGTH) * (W - 2 * pad);

    ctx.fillStyle = cssVar("--draw-bg");
    ctx.fillRect(0, 0, W, H);

    // Track + meter ticks
    ctx.strokeStyle = cssVar("--draw-axis");
    ctx.fillStyle = cssVar("--draw-axis");
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(toPx(0), trackY);
    ctx.lineTo(toPx(TRACK_LENGTH), trackY);
    ctx.stroke();
    ctx.font = "13px Inter, sans-serif";
    ctx.textAlign = "center";
    for (let m = 0; m <= TRACK_LENGTH; m++) {
      const px = toPx(m);
      const major = m % 5 === 0;
      ctx.beginPath();
      ctx.moveTo(px, trackY);
      ctx.lineTo(px, trackY + (major ? 12 : 6));
      ctx.stroke();
      if (major) ctx.fillText(m + " m", px, trackY + 28);
    }

    // Motion map dots up to the current time
    if (state.showDots) {
      ctx.fillStyle = cssVar("--draw-secondary");
      for (let t = 0; t <= state.t + 1e-9; t += DOT_INTERVAL) {
        const x = Physics.position(state.params, t);
        if (x < 0 || x > TRACK_LENGTH) break;
        ctx.beginPath();
        ctx.arc(toPx(x), trackY - 62, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Cart
    const x = clamp(Physics.position(state.params, state.t), 0, TRACK_LENGTH);
    const cx = toPx(x);
    ctx.fillStyle = cssVar("--draw-primary");
    ctx.fillRect(cx - 26, trackY - 34, 52, 26);
    ctx.fillStyle = cssVar("--draw-ink");
    for (const dx of [-15, 15]) {
      ctx.beginPath();
      ctx.arc(cx + dx, trackY - 5, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Velocity arrow
    const v = Physics.velocity(state.params, state.t);
    drawArrow(cx, trackY - 46, cx + v * 12, trackY - 46, cssVar("--draw-tertiary"));

    updateMetrics(x, v);
  }

  function drawArrow(x1, y1, x2, y2, color) {
    if (Math.abs(x2 - x1) < 2) return;
    const dir = Math.sign(x2 - x1);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - dir * 8, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - dir * 10, y2 - 6);
    ctx.lineTo(x2 - dir * 10, y2 + 6);
    ctx.closePath();
    ctx.fill();
  }

  function updateMetrics(x, v) {
    $("metricT").textContent = state.t.toFixed(2) + " s";
    $("metricX").textContent = x.toFixed(2) + " m";
    $("metricV").textContent = v.toFixed(2) + " m/s";
  }

  // ── Controls ────────────────────────────────────────────────
  for (const id of ["x0Input", "v0Slider", "aSlider", "tMaxInput", "dotsToggle"]) {
    $(id).addEventListener("input", () => { if (!state.running) reset(); else readControls(); });
  }

  $("startBtn").addEventListener("click", start);
  $("resetBtn").addEventListener("click", reset);
  $("pauseBtn").addEventListener("click", () => {
    if (state.running) {
      stop();
      $("pauseBtn").textContent = "Resume";
      setStatus("Paused.");
    } else if (state.t > 0 && state.t < state.tMax) {
      $("pauseBtn").textContent = "Pause";
      start();
    }
  });

  // ── Presets ─────────────────────────────────────────────────
  const presets = {
    steady:     { x0: 2,  v0: 3,  a: 0,  tMax: 5, label: "Steady speed" },
    speedUp:    { x0: 1,  v0: 0,  a: 2,  tMax: 4, label: "Speeding up" },
    turnaround: { x0: 4,  v0: 5,  a: -2, tMax: 5, label: "Turnaround" },
  };

  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = presets[btn.dataset.preset];
      if (!p) return;
      $("x0Input").value = p.x0;
      $("v0Slider").value = p.v0;
      $("aSlider").value = p.a;
      $("tMaxInput").value = p.tMax;
      reset();
      setStatus(`Loaded: ${p.label}. Predict first, then press Start.`);
    });
  });

  // ── Tabs ────────────────────────────────────────────────────
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", String(b === btn));
      });
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      $(btn.dataset.tab + "Tab").classList.add("active");
    });
  });

  // ── Trial table ─────────────────────────────────────────────
  const tbody = $("trialTableBody");
  let trialCount = 0;

  $("recordBtn").addEventListener("click", () => {
    const { x0, v0, a } = state.params;
    const x = Physics.position(state.params, state.t);
    const v = Physics.velocity(state.params, state.t);
    if (trialCount === 0) tbody.innerHTML = "";
    trialCount++;
    const tr = document.createElement("tr");
    for (const cell of [trialCount, x0.toFixed(1), v0.toFixed(1), a.toFixed(2), state.t.toFixed(2), x.toFixed(2), v.toFixed(2)]) {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
    setStatus(`Trial #${trialCount} recorded.`, "ok");
  });

  $("clearBtn").addEventListener("click", () => {
    trialCount = 0;
    tbody.innerHTML = '<tr><td colspan="7">No trials recorded yet.</td></tr>';
    setStatus("Table cleared.");
  });

  // ── Keyboard: Space = start/pause, R = reset ────────────────
  document.addEventListener("keydown", (e) => {
    if (e.target !== document.body) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (state.running || state.t > 0) $("pauseBtn").click(); else start();
    } else if (e.key === "r" || e.key === "R") {
      reset();
    }
  });

  // ── Init ────────────────────────────────────────────────────
  readControls();
  let saved = "light";
  try { saved = localStorage.getItem("te-theme") || "light"; } catch (_) { /* storage blocked */ }
  applyTheme(saved);
})();
