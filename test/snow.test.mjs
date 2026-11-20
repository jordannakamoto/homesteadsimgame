// Snow: the snowpack's simulation (src/sim/snow.js over core/snowfield.js). Registers only what it needs.
// Storms and winds are driven by hand: a pair of tiny systems round the weather puts back whatever the weather's own step did
// to the snow ledger and sets the air (temperature, wind) and the thaw the test wants, so every case is deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, weather, siteSystem, snow, snowRead, DAY } from '../src/sim/index.js';
import * as SF from '../src/sim/core/snowfield.js';
import { packReplacer, unpackReviver } from '../src/sim/core/earthwork-codec.js';
import { BENCH, benchOnly } from './helpers/bench.mjs';

const STEP = 10;                       // ticks: the snow's cadence
const DEG = Math.PI / 180;

// pre runs before the weather and notes the ledger (after any command, such as snow.debugFall); post runs after it, restores
// the ledger, applies the scripted thaw and sets the air.
function rig({ T = -5, wind = 0, fromDeg = 270 } = {}) {
  const ctl = { T, wind, dir: fromDeg * DEG, melt: 0 };
  const pre = { name: 'pin_pre', every: STEP, init: () => ({}), step(ctx) { const W = ctx.get('weather'); ctx.s.snap = { swe: W.snowSweMm, rho: W.snowDensityKgM3, fall: W.totals.snowfallMm, melt: W.totals.meltMm, precip: W.totals.precipMm }; } };
  const post = { name: 'pin_post', every: STEP, init: () => ({}), step(ctx) {
    const W = ctx.get('weather'), a = ctx.get('pin_pre').snap;
    W.snowSweMm = a.swe; W.snowDensityKgM3 = a.rho; W.totals.snowfallMm = a.fall; W.totals.meltMm = a.melt; W.totals.precipMm = a.precip;
    W.snowMmH = 0; W.rainMmH = 0; W.tempC = ctl.T; W.windMs = ctl.wind; W.windDirRad = ctl.dir;
    const m = Math.min(W.snowSweMm, ctl.melt);
    if (m > 0) { W.snowSweMm -= m; W.totals.meltMm += m; }
    W.snowDepthM = W.snowSweMm / W.snowDensityKgM3;
  } };
  const sim = createSim({ seed: 7, systems: [pre, weather, post, siteSystem(), snow] });
  return { sim, ctl, W: () => sim.state.sys.weather, S: () => sim.state.sys.snow, steps: (n) => sim.runTicks(n * STEP), fall: (mm) => sim.commandNow('snow.debugFall', { mm }) };
}
const wallP = (id, ax, az, bx, bz, y1 = 2.4) => ({ id, kind: 'wall', type: 'wall', a: { x: ax, z: az }, b: { x: bx, z: bz }, y0: 0, y1, thickness: 0.13 });
function shed(cx, cz, half = 2) {   // four walls and a flat-ish roof over them
  const c = [[cx - half, cz - half], [cx + half, cz - half], [cx + half, cz + half], [cx - half, cz + half]];
  const walls = c.map((p, i) => wallP('w' + i, p[0], p[1], c[(i + 1) % 4][0], c[(i + 1) % 4][1]));
  const roof = { id: 'r0', kind: 'roof', type: 'shed', a: { x: c[0][0], z: c[0][1] }, b: { x: c[1][0], z: c[1][1] }, y0: 2.4, y1: 3, eaveY: 2.4, ridgeY: 3, pitchDeg: 10, facing: { x: 0, z: 1 }, footprint: c.map((p) => ({ x: p[0], z: p[1] })) };
  return [...walls, roof];
}
const setPieces = (sim, pieces) => sim.commandNow('site.setPieces', { pieces });
const sweAt = (sim, x, z) => snowRead.at(sim.state, x, z).sweMm;
const sumH = (sim) => SF.total(sim.state.sys.snow.grid);

test('snow: a world with no snow and mild weather does nothing and allocates no tiles', () => {
  const sim = createSim({ seed: 3, systems: [weather, siteSystem(), snow] });
  sim.runDays(3);
  const s = sim.state.sys.snow;
  assert.equal(Object.keys(s.grid.tiles).length, 0);
  assert.equal(s.rev, 0);
  assert.equal(snowRead.total(sim.state), 0);
  const a = snowRead.at(sim.state, 10, 10);
  assert.equal(a.sweMm, 0); assert.equal(a.depthM, 0);
});

test('snow: reads never throw when snow or weather is missing, and an old save gets a complete fresh state', () => {
  for (const st of [{}, { sys: {} }, { sys: { weather: {} } }, { sys: { snow: { grid: {} } } }]) {
    const r = snowRead.at(st, 1, 2);
    assert.equal(r.sweMm, 0);
    const out = new Float32Array(8 * 8 * 4).fill(9);
    snowRead.window(st, 0, 0, 8, out);
    assert.ok(out.every((v) => v === 0));
  }
  // an old save: weather already has a pack, no sys.snow; registering the system calls init
  const sim = createSim({ seed: 5, systems: [weather] });
  sim.state.sys.weather.snowSweMm = 40; sim.state.sys.weather.snowDensityKgM3 = 150; sim.state.sys.weather.totals.snowfallMm = 300; sim.state.sys.weather.totals.meltMm = 100;
  delete sim.state.sys.snow;
  sim.register(snow);
  const s = sim.state.sys.snow;
  assert.equal(s.v, 1); assert.deepEqual(s.seen, { fall: 300, melt: 100 }); assert.equal(Object.keys(s.grid.tiles).length, 0);
  assert.ok(Math.abs(snowRead.at(sim.state, 5, 5).sweMm - 40) < 1e-9, 'the reference pack where there is no tile');
  sim.runTicks(STEP * 3);
  assert.ok(sim.state.sys.snow.rev >= 0);
});

test('snow: a level, open, untouched cell tracks the reference pack through a storm and a thaw', () => {
  const r = rig();
  r.steps(3);
  r.fall(30); r.steps(3);
  assert.ok(Object.keys(r.S().grid.tiles).length >= 9, 'the active tiles were made');
  for (const [x, z] of [[3.3, 4.1], [-20, 12], [30, -25]]) assert.ok(Math.abs(sweAt(r.sim, x, z) - r.W().snowSweMm) < 0.01 * r.W().snowSweMm, `${x},${z}: ${sweAt(r.sim, x, z)} vs ${r.W().snowSweMm}`);
  const a = snowRead.at(r.sim.state, 3.3, 4.1);
  assert.ok(Math.abs(a.depth0M - r.W().snowDepthM) < 0.01 * r.W().snowDepthM && a.packed === 0 && Math.abs(a.rho - r.W().snowDensityKgM3) < 1e-6);
  r.ctl.T = 2; r.ctl.melt = 4; r.steps(5);                                   // 20 mm melts
  assert.ok(Math.abs(sweAt(r.sim, 3.3, 4.1) - r.W().snowSweMm) < 0.02 * 30, `${sweAt(r.sim, 3.3, 4.1)} vs ${r.W().snowSweMm}`);
  assert.ok(r.S().rev > 0);
});

test('snow: under a roof stays bare, and a cell beside the shed holds the snow', () => {
  const r = rig();
  setPieces(r.sim, shed(8, 8));
  r.steps(2); r.fall(25); r.steps(3);
  assert.ok(sweAt(r.sim, 8, 8) < 0.01, 'bare under the roof');
  assert.ok(sweAt(r.sim, 14, 8) > 20, 'snow outside');
});

test('snow: a north wall keeps snow longer than a south wall in the thaw', () => {
  const r = rig();
  setPieces(r.sim, [wallP('w', -4, 8, 20, 8)]);                // an east-west wall along z = 8
  r.steps(2); r.fall(80); r.steps(3);
  assert.ok(Math.abs(sweAt(r.sim, 8, 9) - 80) < 1 && Math.abs(sweAt(r.sim, 8, 7) - 80) < 1);
  r.ctl.T = 3; r.ctl.melt = 7; r.steps(10);                    // 70 mm melts from the reference
  const south = sweAt(r.sim, 8, 9), north = sweAt(r.sim, 8, 7), open = sweAt(r.sim, 8, 13);
  assert.ok(Math.abs(open - 10) < 0.5, 'open ground follows the reference: ' + open);
  assert.ok(south < 0.5, 'the sunny side is bare: ' + south);
  assert.ok(north > 20, 'the shaded side still holds snow: ' + north);
});

test('snow: after a windy storm a shed\'s lee holds more snow than its windward side, and mass is conserved', () => {
  const r = rig({ T: -6, wind: 14, fromDeg: 270 });              // from the west: the lee is east of the shed
  setPieces(r.sim, shed(8, 8));
  r.sim.commandNow('snow.focus', { x: 8, z: 8 });
  r.steps(2); r.fall(20);
  r.steps(72);                                                   // twelve hours
  const region = (x0, x1) => { let s = 0, n = 0; for (let x = x0; x < x1; x += 0.5) for (let z = 4.5; z <= 11.5; z += 0.5) { s += sweAt(r.sim, x, z); n++; } return s / n; };
  const lee = region(10.5, 14), windward = region(2, 5.5);
  assert.ok(lee > windward * 1.15, `lee ${lee.toFixed(2)} mm vs windward ${windward.toFixed(2)} mm`);
  const S = r.S(), expect = S.totals.fall + S.totals.unload - S.totals.melt - S.totals.blown;
  assert.ok(Math.abs(sumH(r.sim) / 1000 - expect) <= 0.005 * expect, `${sumH(r.sim) / 1000} vs ${expect}`);
  assert.ok(Math.abs(S.totals.blown) > 0.1, 'some snow left the area: ' + S.totals.blown);
});

test('snow: no wind below the threshold: a still storm stays level', () => {
  const r = rig({ T: -6, wind: 5 });
  setPieces(r.sim, shed(8, 8));
  r.steps(2); r.fall(20); r.steps(30);
  assert.ok(Math.abs(sweAt(r.sim, 13, 8) - 20) < 0.3 && Math.abs(sweAt(r.sim, 3, 8) - 20) < 0.3);
});

test('snow: trees take snow off the ground under them, drop it at the drip line, and it is all accounted for', () => {
  const r = rig();
  r.sim.commandNow('snow.setObstacles', { trees: [[8, 8, 3, 9, 1]] });
  r.steps(2); r.fall(30); r.steps(30);
  assert.ok(sweAt(r.sim, 8, 8) < 0.5 * sweAt(r.sim, 20, 8), 'the tree well is shallow');
  assert.ok(r.S().canopyMm > 0, 'the crown holds snow');
  r.ctl.T = 1; r.steps(40);                                       // it warms and the crown lets go
  assert.ok(r.S().unloadMm > 0 && r.S().totals.unload > 0);
  const S = r.S(), expect = S.totals.fall + S.totals.unload - S.totals.melt - S.totals.blown;
  assert.ok(Math.abs(sumH(r.sim) / 1000 - expect) < 0.005 * Math.max(expect, 1), `${sumH(r.sim) / 1000} vs ${expect}`);
});

test('snow: tread, move and push conserve the snow; a trodden cell is shallower and denser', () => {
  const r = rig();
  r.steps(1); r.fall(30); r.steps(3);
  const before = sumH(r.sim), far = snowRead.at(r.sim.state, 12, 12);
  const k = snowRead.bearing(far.rho, snowRead.RHO_BEAR.boot);
  assert.ok(k > 0.8);
  assert.ok(r.sim.commandNow('snow.tread', { pts: [[4.25, 4.25, 0.8, k]] }).ok);
  const trod = snowRead.at(r.sim.state, 4.25, 4.25);
  assert.equal(sumH(r.sim), before);
  assert.ok(trod.packed > 0.5 && trod.depthM < far.depthM * 0.6 && trod.sinkM < far.sinkM, `${trod.depthM} ${far.depthM}`);
  assert.equal(r.sim.commandNow('snow.tread', { pts: [[4, 4, 99, 1]] }).ok, false);
  // a shovelful
  const m = r.sim.commandNow('snow.move', { x: 8.25, z: 8.25, r: 0.6, frac: 0.8, tx: 10.25, tz: 8.25, tr: 0.5 });
  assert.ok(m.ok && m.mm > 0);
  assert.equal(sumH(r.sim), before);
  assert.ok(sweAt(r.sim, 10.25, 8.25) > sweAt(r.sim, 8.25, 8.25) + 5, 'the pile is higher than the hole');
  assert.equal(r.sim.commandNow('snow.move', { x: 0, z: 0, r: 0.6, frac: 2, tx: 1, tz: 1, tr: 0.5 }).ok, false);
  // a plough along z = 20, east to east: right-hand side is south (+z)
  const p = r.sim.commandNow('snow.push', { x0: 0.25, z0: 20.25, x1: 10.25, z1: 20.25, w: 1.5 });
  assert.ok(p.ok && p.mm > 0);
  assert.equal(sumH(r.sim), before);
  assert.ok(sweAt(r.sim, 5, 20.25) < 1, 'the strip is clear');
  assert.ok(sweAt(r.sim, 5, 21.4) > 30 || sweAt(r.sim, 10.7, 20.25) > 30, 'a windrow at the side or the end');
  const wr = snowRead.at(r.sim.state, 10.75, 20.25);
  assert.ok(wr.packed > 0.3, 'the windrow is packed: ' + wr.packed);
  // worked tiles are kept
  assert.ok(Object.values(r.S().meta).some((mm) => mm.worked));
});

test('snow: a long winter and spring: all the snow is accounted for (fall - melt + unload - blown)', () => {
  const sim = createSim({ seed: 11, systems: [weather, siteSystem(), snow] });
  sim.setYearDays(60);
  setPieces(sim, shed(8, 8));
  sim.commandNow('snow.setObstacles', { trees: [[-10, 5, 3, 8, 1], [22, -6, 2.5, 7, 1], [-4, -14, 3, 9, 0]] });
  sim.commandNow('snow.focus', { x: 8, z: 8 });
  let maxSwe = 0, windy = 0;
  for (let d = 0; d < 130; d++) {
    if (d % 4 === 0 && sim.state.sys.weather.tempC < -1) sim.commandNow('snow.debugFall', { mm: 14 });   // winter storms, on top of the weather's own
    sim.runTicks(1440);
    const S = sim.state.sys.snow, W = sim.state.sys.weather;
    maxSwe = Math.max(maxSwe, W.snowSweMm);
    if (S.totals.blown !== 0) windy++;
    if (d % 10 === 0 || d === 129) {
      const expect = S.totals.fall + S.totals.unload - S.totals.melt - S.totals.blown;
      assert.ok(Math.abs(sumH(sim) / 1000 - expect) <= 0.005 * Math.max(Math.abs(expect), 1), `day ${d}: ${sumH(sim) / 1000} vs ${expect}`);
    }
  }
  const S = sim.state.sys.snow;
  assert.ok(maxSwe > 15 && S.totals.fall > 0 && S.totals.melt > 0, `a real winter happened: peak ${maxSwe}`);
  const expect = S.totals.fall + S.totals.unload - S.totals.melt - S.totals.blown;
  assert.ok(Math.abs(sumH(sim) / 1000 - expect) <= 0.005 * Math.max(Math.abs(expect), 1));
});

test('snow: a save round trip is exact and packed, and a loaded world carries on the same', () => {
  const r = rig({ T: -6, wind: 12 });
  setPieces(r.sim, shed(8, 8));
  r.sim.commandNow('snow.setObstacles', { trees: [[-8, 6, 3, 8, 1]] });
  r.steps(2); r.fall(25); r.steps(30);
  r.sim.commandNow('snow.tread', { pts: [[3.25, 3.25, 1, 0.9], [3.75, 3.25, 1, 0.9]] });
  const plain = JSON.stringify(r.sim.state), packed = JSON.stringify(r.sim.state, packReplacer);
  assert.ok(packed.length < plain.length * 0.5, `${packed.length} vs ${plain.length}`);
  const back = JSON.parse(packed, unpackReviver);
  assert.deepEqual(back.sys.snow, r.sim.state.sys.snow);
  assert.ok(back.sys.snow.grid.tiles && Object.values(back.sys.snow.grid.tiles).some((t) => t.l.some((v) => v > 0)));
  // the loaded world (the caches rebuilt from scratch) runs on identically
  const twin = createSim({ seed: 7, systems: r.sim.systems.map((s) => s) });
  twin.load(back);
  for (const q of [r, { sim: twin, steps: (n) => twin.runTicks(n * STEP) }]) q.steps(20);
  assert.deepEqual(twin.state.sys.snow, r.sim.state.sys.snow);
  assert.equal(twin.hash(), r.sim.hash());
});

test('snow: a sleeping worked tile catches up to the same state as one that stayed active (no wind)', () => {
  const run = (focusFar) => {
    const r = rig({ T: -4, wind: 0 });
    if (focusFar) r.sim.commandNow('snow.focus', { x: 120, z: 120 });
    r.steps(2); r.fall(15); r.steps(2);
    assert.ok(r.sim.commandNow('snow.tread', { pts: [[120.25, 120.25, 1.2, 0.8]] }).ok);
    r.steps(2); r.fall(20); r.steps(3); r.ctl.T = 2; r.ctl.melt = 2; r.steps(5); r.ctl.melt = 0; r.steps(2); r.fall(8); r.steps(3);
    if (!focusFar) { assert.ok(r.S().meta['7,7'].worked); const m = r.S().meta['7,7']; assert.ok(m.fall < r.W().totals.snowfallMm, 'asleep'); r.sim.commandNow('snow.focus', { x: 120, z: 120 }); r.steps(1); }
    return r;
  };
  const a = run(false), b = run(true);
  const ta = a.S().grid.tiles['7,7'], tb = b.S().grid.tiles['7,7'];
  assert.ok(ta && tb);
  let worst = 0;
  for (let n = 0; n < ta.h.length; n++) worst = Math.max(worst, Math.abs(ta.h[n] - tb.h[n]) / Math.max(1000, tb.h[n]));
  assert.ok(worst < 0.005, 'worst relative difference ' + worst);
  assert.deepEqual(a.S().meta['7,7'].worked, true);
});

test('snow: bearing and sink follow the design numbers', () => {
  const b = snowRead.bearing;
  assert.ok(Math.abs(b(100, 330) - 0.9) < 0.01 && Math.abs(b(300, 330) - 0.27) < 0.01 && b(380, 330) === 0 && b(450, 330) === 0);
  assert.ok(b(100, 200) > b(100, 330) * 0.6);
  const r = rig();
  r.steps(1); r.fall(40); r.steps(3);
  const a = snowRead.at(r.sim.state, 6, 6);
  assert.ok(a.sinkM > 0.15 && a.sinkM < a.depth0M, String(a.sinkM));
});

test('snow: the window is toroidal, snapped to cells, and the field texture shows the pack', () => {
  const r = rig();
  r.steps(1); r.fall(30); r.steps(3);
  r.sim.commandNow('snow.tread', { pts: [[2.25, 2.25, 0.6, 0.9]] });
  const n = 64, out = new Float32Array(n * n * 4), org = snowRead.window(r.sim.state, 2.3, 2.1, n, out);
  assert.ok(org.x % 0.5 === 0 && org.z % 0.5 === 0);
  const idx = (x, z) => { const i = Math.floor(x / 0.5), j = Math.floor(z / 0.5), ii = ((i % n) + n) % n, jj = ((j % n) + n) % n; return (jj * n + ii) * 4; };
  const at = idx(2.25, 2.25), far = idx(14.25, 6.25);
  assert.ok(out[at + 2] > 0.5, 'packed channel'); assert.ok(out[far] > 0.2 && out[far + 2] === 0);
  assert.ok(Math.abs(out[far + 1] * 600 - r.W().snowDensityKgM3) < 1, 'rho / 600');
  // a window moved by whole cells gives the same texel for the same cell
  const out2 = new Float32Array(n * n * 4);
  snowRead.window(r.sim.state, 2.3 + 3, 2.1, n, out2);
  assert.equal(out2[at], out[at]); assert.equal(out2[at + 2], out[at + 2]);
});

test('snow: the wind pass conserves what it moves (core transport, explicit inputs)', () => {
  const W = 24, H = 12, N = W * H;
  const L = { W, H, surf: new Float32Array(N), top: new Float32Array(N).fill(-1e9), solid: new Uint8Array(N), avail: new Float32Array(N).fill(4), e: new Float32Array(N), st: new Float32Array(N),
    erode: new Float64Array(N), dep: new Float64Array(N), cur: new Float64Array(N), nxt: new Float64Array(N) };
  for (let j = 4; j < 8; j++) for (let i = 10; i < 13; i++) { L.solid[j * W + i] = 1; L.top[j * W + i] = 3; }   // a building 3 x 4
  const P = { dists: [1, 2, 3, 4, 6, 8, 12], sxFull: 0.25, eMax: 1.5, pick: 0.8, pickCap: 0.5, hops: 12, settleBase: 0.08, settleGain: 0.9, over: 0.5, reach: 8 };
  const R = SF.transport(L, 1, 0, P);                              // wind blowing toward +x
  let dep = 0, er = 0; for (let n = 0; n < N; n++) { dep += L.dep[n]; er += L.erode[n]; }
  assert.ok(R.eroded > 0 && Math.abs(er - R.eroded) < 1e-9 && Math.abs(er - dep - R.blown) < 1e-9, `${er} ${dep} ${R.blown}`);
  const sum = (i0, i1) => { let s = 0; for (let j = 4; j < 8; j++) for (let i = i0; i < i1; i++) s += L.dep[j * W + i] - L.erode[j * W + i]; return s; };
  assert.ok(sum(13, 17) > 0 && sum(13, 17) > sum(5, 10), 'the lee gains, the windward row does not');
  for (let n = 0; n < N; n++) if (L.solid[n]) assert.equal(L.dep[n], 0);
});

test('snow: cost of a step over the 5 x 5 active tiles is under 0.2 ms', benchOnly, () => {
  const mk = (withSnow) => {
    const r = rig({ T: -4, wind: 4 });
    const sim = createSim({ seed: 7, systems: withSnow ? [r.sim.systems[0], weather, r.sim.systems[2], siteSystem(), snow] : [r.sim.systems[0], weather, r.sim.systems[2], siteSystem()] });
    if (withSnow) sim.commandNow('snow.focus', { x: 8, z: 8 });
    return sim;
  };
  const a = mk(true), b = mk(false);
  for (const s of [a, b]) { s.state.sys.weather.snowSweMm = 30; s.state.sys.weather.snowDensityKgM3 = 100; }
  a.runTicks(STEP * 5);
  const nt = Object.keys(a.state.sys.snow.grid.tiles).length;
  const N = 600;
  const go = (s) => { const t0 = performance.now(); for (let i = 0; i < N; i++) { if (s.state.sys.snow) s.commandNow('snow.debugFall', { mm: 0.02 }); s.runTicks(STEP); } return (performance.now() - t0) / N; };
  go(a); go(b);
  const ta = go(a), tb = go(b);
  console.log(`snow step: ${(ta - tb).toFixed(3)} ms over ${nt} tiles`);
  assert.ok(ta - tb < 0.2, `${(ta - tb).toFixed(3)} ms`);
});
