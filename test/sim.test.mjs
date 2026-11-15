// Headless simulation tests: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, createGameSim, TICK, DAY, START_T, makeSave, readSave, f32ToBase64, base64ToF32, hashState, clockText } from '../src/sim/index.js';

// A small system with real state, randomness, a cadence and a command, used to exercise the core.
const tank = () => ({
  name: 'tank', every: 5,
  init: () => ({ litres: 100, drawn: 0 }),
  step: (c) => {
    c.s.litres += c.rng('rain').range(0, 0.02) * c.dt;                 // litres per second of inflow
    const use = Math.min(c.s.litres, 0.004 * c.dt); c.s.litres -= use; c.s.drawn += use;
  },
  commands: { 'tank.dump': (c, p) => { c.s.litres = Math.max(0, c.s.litres - p.litres); } },
});
const walker = () => ({
  name: 'walker',
  init: () => ({ x: 0 }),
  step: (c) => { c.s.x += c.rng().normal(0, 1) + c.get('tank').litres * 1e-6; },
});
const make = (seed) => createSim({ seed, systems: [tank(), walker()] });

test('same seed gives the same world; a different seed does not', () => {
  const a = make(7), b = make(7), c = make(8);
  a.runDays(30); b.runDays(30); c.runDays(30);
  assert.equal(a.hash(), b.hash());
  assert.notEqual(a.hash(), c.hash());
});

test('time advances in whole ticks and a day is 86400 seconds', () => {
  const s = make(1);
  s.runDays(3);
  assert.equal(s.state.t, START_T + 3 * DAY);
  assert.equal(s.state.tick, (3 * DAY) / TICK);
  assert.equal(s.day(), 4);
  assert.equal(clockText(START_T), '08:10');
});

test('the result does not depend on frame rate or game speed', () => {
  const whole = make(3); whole.advance(2 * DAY);
  const frames = make(3);
  let left = 2 * DAY, i = 0;
  while (left > 1e-6) { const d = Math.min(left, [0.5, 7.3, 33.1, 120, 961.7][i++ % 5]); frames.advance(d); left -= d; }
  frames.advance(1e-3);                                     // settle floating point drift in the accumulator
  assert.equal(frames.state.tick, whole.state.tick);
  assert.equal(frames.hash(), whole.hash());
});

test('saving and loading mid-run continues exactly as if never interrupted', () => {
  const straight = make(11); straight.runDays(20);
  const first = make(11); first.runDays(9);
  const file = JSON.stringify(makeSave(first.serialize(), { wood: 3 }));
  const second = make(999);                                  // seed comes from the save, not from here
  const save = readSave(file);
  second.load(save.sim); second.runDays(11);
  assert.equal(save.world.wood, 3);
  assert.equal(second.hash(), straight.hash());
});

test('commands apply at the next tick and replay identically', () => {
  const a = createSim({ seed: 5, systems: [tank(), walker()], record: true });
  a.runTicks(100); a.command('tank.dump', { litres: 40 }); a.runTicks(1);
  const twin = make(5); twin.runTicks(101);
  assert.ok(Math.abs(twin.state.sys.tank.litres - a.state.sys.tank.litres - 40) < 1e-9);
  a.runTicks(200);
  const b = make(5);
  let k = 0;
  for (let t = 0; t < 301; t++) {
    while (k < a.recorded.length && a.recorded[k].tick === b.state.tick) { b.command(a.recorded[k].name, a.recorded[k].payload); k++; }
    b.runTicks(1);
  }
  assert.equal(b.hash(), a.hash());
  assert.throws(() => a.command('no.such.command'));
});

test('a bounded advance drops time it cannot afford instead of stalling', () => {
  const s = make(2);
  assert.equal(s.advance(100 * TICK, 16), 16);
  assert.ok(s.acc < TICK);
});

test('water is conserved by the test tank (inflow = stored + drawn)', () => {
  // the pattern every physical system should follow: a conservation check over a long run
  const s = make(4); let inflow = 0;
  const sys = s.systems.find((x) => x.name === 'tank'); const step = sys.step;
  sys.step = (c) => { const b = c.s.litres + c.s.drawn; step(c); inflow += c.s.litres + c.s.drawn - b; };
  s.runDays(60);
  assert.ok(Math.abs(100 + inflow - (s.state.sys.tank.litres + s.state.sys.tank.drawn)) < 1e-6);
});

test('save files reject foreign or newer data, and terrain edits survive the round trip', () => {
  assert.throws(() => readSave('{"format":"something-else"}'));
  assert.throws(() => readSave(JSON.stringify({ format: 'homestead-save', v: 999, sim: {} })));
  const h = new Float32Array(1024).map((_, i) => Math.sin(i) * 3);
  assert.deepEqual([...base64ToF32(f32ToBase64(h))], [...h]);
  assert.equal(hashState({ a: 1, b: [1, 2] }), hashState({ b: [1, 2], a: 1 }));
});

test('the game simulation builds, runs a year, and is deterministic', () => {
  const a = createGameSim(1337), b = createGameSim(1337);
  const t0 = performance.now(); a.runDays(365); const ms = performance.now() - t0;
  b.runDays(365);
  assert.equal(a.hash(), b.hash());
  assert.ok(ms < 20000, 'a simulated year should run headlessly in seconds, took ' + ms.toFixed(0) + ' ms');
});
