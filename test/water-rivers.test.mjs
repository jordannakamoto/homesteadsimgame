import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRivers, channelSize } from '../src/water/rivers-gen.js';

// an island 600 m across centred on (0, 250), like the islands of the game's world, with valleys from ripples
const height = (x, z) => 14 - Math.hypot(x, z - 250) * 0.05 + 2.5 * Math.sin(x * 0.021) * Math.cos(z * 0.013) + 1.2 * Math.sin(x * 0.07 + z * 0.05);

test('rivers: deterministic per seed, independent of the order chunks ask', () => {
  const a = createRivers({ seed: 7, height, spawnClear: 0, springNear: false }), b = createRivers({ seed: 7, height, spawnClear: 0, springNear: false });
  const pts = [];
  for (let k = 0; k < 300; k++) pts.push([((k * 37) % 400) - 200, ((k * 53) % 600) - 50]);
  const ha = pts.map(([x, z]) => a.carve(height(x, z), x, z));
  const hb = [...pts].reverse().map(([x, z]) => b.carve(height(x, z), x, z)).reverse();
  assert.deepEqual(ha, hb);
  for (let j = 20; j >= -2; j--) for (let i = -10; i <= 10; i++) assert.equal(a.area(a.node(i, j)), b.area(b.node(i, j)));
});

test('rivers: every chain descends strictly and ends at a mouth or a pond', () => {
  const r = createRivers({ seed: 3, height, spawnClear: 0, springNear: false });
  for (let j = 0; j <= 25; j++) for (let i = -12; i <= 12; i++) {
    let n = r.node(i, j), steps = 0;
    while (r.down(n)) { const d = r.down(n); assert.ok(d.h < n.h); n = d; assert.ok(++steps < 500); }
    assert.ok(n.mouth || n.pond);
  }
});

test('rivers: beds step down along each channel, and width and depth grow with catchment', () => {
  const r = createRivers({ seed: 5, height, spawnClear: 0, springNear: false });
  let checked = 0;
  for (let j = 0; j <= 25; j++) for (let i = -12; i <= 12; i++) {
    const sg = r.segment(r.node(i, j));
    if (!sg) continue;
    checked++;
    let prev = Infinity, flat = 0;
    for (let s = 0; s <= 200; s++) {
      const z = r.bedAt(sg, s / 200);
      assert.ok(z <= prev + 0.13, 'beds only rise by the scour below a riffle');
      if (Math.abs(z - prev) < 1e-3) flat++;
      prev = z;
    }
    if (sg.k > 1) assert.ok(flat > 60, 'pools are flat for most of the length');
  }
  assert.ok(checked > 5, 'the test terrain has channels');
  let last = channelSize(1);
  for (const a of [5, 20, 80, 400, 2000]) { const c = channelSize(a); assert.ok(c.w >= last.w && c.D > last.D && c.Q > last.Q); last = c; }
});

test('rivers: the carve leaves terrain alone away from channels and keeps the spawn clear', () => {
  const r = createRivers({ seed: 9, height });
  let touched = 0, far = 0;
  for (let k = 0; k < 4000; k++) {
    const x = ((k * 7919) % 600) - 300, z = ((k * 104729) % 600) - 20, h = height(x, z), c = r.carve(h, x, z), info = r.riverInfo(x, z);
    if (!info || info.dist > info.w * 2.5 + 2) { assert.equal(c, h); far++; } else if (c !== h) touched++;
    if (Math.hypot(x, z) < 28) assert.equal(c, h);
  }
  assert.ok(far > 1000 && touched > 10);
});

test('rivers: a spring near spawn starts a brook that runs to the sea without crossing the spawn', () => {
  const r = createRivers({ seed: 11, height }), s = r.spring;
  assert.ok(s, 'a spring was found');
  const d = Math.hypot(s.x, s.z);
  assert.ok(d >= 42 && d <= 70);
  assert.ok(r.area(s) >= 2 * r.MIN_AREA && r.segment(s));
  let m = s, n = 0;
  for (; m && !m.mouth && n < 300; n++) { assert.ok(Math.hypot(m.x, m.z) >= 40); assert.ok(r.segment(m)); m = r.down(m); }
  assert.ok(m && m.mouth);
  assert.equal(createRivers({ seed: 11, height }).spring.x, s.x);
});
