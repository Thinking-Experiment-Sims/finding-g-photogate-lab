// Run with: npm test   (Node's built-in test runner, no dependencies)
const test = require("node:test");
const assert = require("node:assert/strict");
const Physics = require("../src/js/physics.js");

const close = (actual, expected, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

test("position: constant velocity (a = 0)", () => {
  close(Physics.position({ x0: 2, v0: 3, a: 0 }, 4), 14); // 2 + 3·4
});

test("position: starting from rest, a = 2 m/s², t = 3 s → 9 m", () => {
  close(Physics.position({ v0: 0, a: 2 }, 3), 9); // ½·2·3²
});

test("velocity: v = v0 + a·t", () => {
  close(Physics.velocity({ v0: 5, a: -2 }, 1.5), 2);
});

test("turnaround: thrown up at 19.6 m/s stops after 2 s", () => {
  close(Physics.turnaroundTime({ v0: 19.6, a: -Physics.G }), 2, 1e-12);
});

test("turnaround: none when velocity and acceleration share a sign", () => {
  assert.equal(Physics.turnaroundTime({ v0: 3, a: 1 }), null);
  assert.equal(Physics.turnaroundTime({ v0: 3, a: 0 }), null);
});

test("sample: includes both endpoints and matches position()", () => {
  const params = { x0: 0, v0: 1, a: 2 };
  const pts = Physics.sample(params, 2, 0.5);
  assert.equal(pts.length, 5);
  close(pts[0].t, 0);
  close(pts.at(-1).t, 2);
  close(pts.at(-1).x, Physics.position(params, 2));
});

test("sample: rejects non-positive dt", () => {
  assert.throws(() => Physics.sample({}, 1, 0), RangeError);
});
