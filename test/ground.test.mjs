// One ground: base + macro (1 m) + fine (0.1 m), edited by one command API (core/ground.js, sim/ground.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as GC from '../src/sim/core/ground.js';
import * as EW from '../src/sim/core/earthwork.js';
import { createSim, createGameSim, groundSystem, groundRead, setGroundBase, makeSave, readSave, stringifySave, f32ToBase64, SAVE_VERSION } from '../src/sim/index.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const tilt = (x, z) => 2 + 0.05 * x - 0.03 * z + 0.4 * Math.sin(x * 0.2);

function messyFine() {
  const fine = EW.makeGrid();
  for (let k = 0; k < 12; k++) EW.cut(fine, 3 + k * 0.3, 4, 0.03, { r: 0.3 });
  for (let k = 0; k < 6; k++) EW.fill(fine, 3.5, 5 + k * 0.2, 0.02, { r: 0.25 });
  return fine;
}

test('cut, fill and push conserve volume at 1 m and at 0.1 m, across both grids', () => {
  for (const on of ['fine', 'macro']) {
    const G = GC.makeGround(), fine = messyFine(), r = on === 'fine' ? 0.4 : 2.5;
    let v = GC.netVolume(G, fine);
    const c = GC.cut(G, fine, 3.5, 4.2, on === 'fine' ? 0.05 : 3, { r });
    assert.equal(c.on, on);
    assert.ok(c.m3 > 0);
    near(v - GC.netVolume(G, fine), c.m3, 1e-6, on + ' cut');
    v = GC.netVolume(G, fine);
    const f = GC.fill(G, fine, 6, 4, on === 'fine' ? 0.04 : 2, { r });
    near(GC.netVolume(G, fine) - v, f.m3, 1e-6, on + ' fill');
    near(f.m3, on === 'fine' ? 0.04 : 2, 2e-3, on + ' fill amount');
    v = GC.netVolume(G, fine);
    const w = on === 'fine' ? 0.45 : 2.4;
    for (let k = 0; k < 6; k++) GC.push(G, fine, 4 + k * (on === 'fine' ? 0.1 : 1), 4, 4 + (k + 1) * (on === 'fine' ? 0.1 : 1), 4, 0, { w });
    // the macro push folds the fine ground it scrapes into whole millimetres over 1 m points
    near(GC.netVolume(G, fine), v, on === 'fine' ? 1e-6 : 1e-3, on + ' push');
  }
});

test('a machine cut over hand-dug ground absorbs it: the fine tiles under it are dropped', () => {
  const G = GC.makeGround(), fine = messyFine(), before = Object.keys(fine.tiles).length, rev = fine.rev;
  const res = GC.cut(G, fine, 4, 4.5, 5, { r: 4 });
  assert.equal(res.on, 'macro');
  assert.ok(Object.keys(fine.tiles).length < before);
  assert.ok(fine.rev > rev);
  assert.ok(res.keys.includes('0,0'));
});

// build.js cutTerrain as it was, on a Map of deltas
function oldCut(base, edits, samples, target, pit) {
  const CORE = pit ? 0.8 : 1.05, RIM = pit ? 0.801 : 2.9, get = (u, h) => edits.get(u + ',' + h) || 0;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of samples) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (let h = Math.floor(z0 - RIM); h <= Math.ceil(z1 + RIM); h++) for (let u = Math.floor(x0 - RIM); u <= Math.ceil(x1 + RIM); u++) {
    let dist = 1e9;
    for (const [x, z] of samples) dist = Math.min(dist, Math.hypot(x - u, z - h));
    if (dist >= RIM) continue;
    const b = base(u, h), cur = b + get(u, h);
    let k = Math.min(1, Math.max(0, (dist - CORE) / (RIM - CORE)));
    k = k * k * (3 - 2 * k);
    const want = target + (cur - target) * k;
    if (Math.abs(want - cur) > 0.01 && !(pit && want > cur)) edits.set(u + ',' + h, Math.min(10, Math.max(-10, want - b)));
  }
}

test('gradePad levels a site exactly as build mode always has', () => {
  const samples = [];
  for (let z = 10; z <= 14; z += 0.5) for (let x = 20; x <= 26; x += 0.5) samples.push([x, z]);
  for (const pit of [false, true]) {
    const edits = new Map(), G = GC.makeGround(), target = tilt(23, 12) - 0.3;
    oldCut(tilt, edits, samples, target, pit);
    const res = GC.gradePad(G, null, tilt, samples, target, { core: pit ? 0.8 : 1.05, rim: pit ? 0.801 : 2.9, pit });
    assert.ok(res.cutM3 > 0 && res.keys.length);
    for (let h = 5; h < 20; h++) for (let u = 14; u < 32; u++) near(EW.hAt(G.macro, u, h), edits.get(u + ',' + h) || 0, 0.0006, `point ${u},${h}`);
    near(GC.surfaceY(G, null, tilt, 23.3, 12.7), target, 6e-4, 'pad level (whole millimetres)');
  }
});

test('a pad fills a hand-dug hole in its middle, even when its samples are only round its walls (A3)', () => {
  const G = GC.makeGround(), fine = EW.makeGrid(), flat = () => 2;
  EW.cut(fine, 21.5, 11.2, 0.15, { r: 0.3 });             // a hole in the middle of a 3 x 2.4 m shed plan
  EW.cut(fine, 40, 12, 0.05, { r: 0.3 });                 // and one well away from it
  const samples = [];                                     // wall ends, about a metre apart, as build mode sends them
  for (let x = 20; x <= 23; x++) samples.push([x, 10], [x, 12.4]);
  for (const z of [10.8, 11.6]) samples.push([20, z], [23, z]);
  assert.ok(GC.reliefTotal(G, fine, 21.5, 11.2) < -0.3);
  const v0 = GC.netVolume(G, fine), res = GC.gradePad(G, fine, flat, samples, 2.2, { core: 1.05, rim: 2.9 });
  near(GC.reliefTotal(G, fine, 21.5, 11.2), 0.2, 0.02, 'the hole is gone: the middle is at pad level');
  assert.equal(EW.hAt(fine, 215, 112), 0);
  near(GC.netVolume(G, fine) - v0, res.fillM3 - res.cutM3, 1e-6, 'volume accounted');
  assert.ok(GC.reliefTotal(G, fine, 40, 12) < -0.1, 'the hole outside the pad is left alone');
});

test('conform and trim measure and cut fine ground to an absolute level', () => {
  const G = GC.makeGround(), fine = EW.makeGrid(), R = { poly: [[1, 1], [3, 1], [3, 2], [1, 2]] };
  const y0 = GC.surfaceY(G, fine, tilt, 2, 1.5), target = y0 - 0.25;
  let c = GC.conform(G, fine, tilt, R, target, 0.02, 0.02);
  assert.equal(c.frac, 0);
  assert.ok(c.high.length > 10 && !c.low.length);
  const t = GC.trimTo(G, fine, tilt, R, target);
  assert.ok(t.m3 > 0.4 && t.m3 < 0.6, 'about 2 m2 by 0.25 m: ' + t.m3);
  c = GC.conform(G, fine, tilt, { poly: [[1.2, 1.2], [2.8, 1.2], [2.8, 1.8], [1.2, 1.8]] }, target, 0.02, 0.02);
  assert.ok(c.frac > 0.95, 'frac ' + c.frac);
});

// A game that is not a homestead: a quarry with a dozer, its own "fine" layer kept by another system.
function quarry() {
  setGroundBase(tilt);
  const pit = { name: 'pit', init: () => ({ grid: EW.makeGrid() }) };
  const ground = groundSystem({ fineOf: (get) => get('pit').grid, tampBits: [1, 2] });
  return createSim({ seed: 3, systems: [ground, pit] });
}

test('non-homestead fixture: a dozer works the ground through ground.* commands only', () => {
  const sim = quarry(), events = [];
  sim.listen((type, data) => { if (type === 'ground.macro') events.push(data.keys); });
  const vol = () => groundRead.netVolume(sim.state);
  let v = vol();
  const c = sim.commandNow('ground.cut', { x: 40, z: 40, r: 1.5, m3: 4 });
  assert.ok(c.ok && c.on === 'macro' && c.m3 > 3.9, JSON.stringify(c));
  near(v - vol(), c.m3, 1e-6, 'cut');
  assert.ok(events.length === 1 && events[0].includes('1,1'));
  v = vol();
  const f = sim.commandNow('ground.fill', { x: 50, z: 40, r: 1.5, m3: 4 });
  near(vol() - v, f.m3, 1e-6, 'fill');
  v = vol();
  const Y = groundRead.surfaceY(sim.state, 47, 40) - 0.2;
  for (let k = 0; k < 8; k++) assert.ok(sim.commandNow('ground.push', { x0: 46 + k, z0: 40, x1: 47 + k, z1: 40, w: 2.4, levelY: Y }).ok);
  sim.runTicks(2);                                     // the ridge settles
  near(vol(), v, 1e-6, 'push');
  // grade a pad, trim a footing in it with the fine layer, check it, tamp it
  const samples = [[60, 60], [64, 60], [64, 64], [60, 64], [62, 62]];
  const top = groundRead.surfaceY(sim.state, 62, 62) - 0.5;
  const g = sim.commandNow('ground.grade', { samples, targetY: top, core: 2.5, rim: 5 });
  assert.ok(g.ok && g.cutM3 > 0);
  near(groundRead.gradedY(sim.state, 62, 62), top, 1e-3);
  const R = { path: [[60.5, 61], [63.5, 61]], w: 0.4 };
  const t = sim.commandNow('ground.trim', { region: R, targetY: top - 0.3 });
  assert.ok(t.ok && t.m3 > 0.3);
  assert.ok(groundRead.conform(sim.state, { path: [[60.8, 61], [63.2, 61]], w: 0.2 }, top - 0.3, 0.02, 0.02).frac > 0.9);
  assert.ok(sim.commandNow('ground.tamp', { x: 62, z: 61, r: 0.3, passes: 2 }).n > 0);
  // failures change nothing
  const h = sim.hash();
  for (const [name, p] of [['ground.cut', { x: 1, z: 1, r: 1 }], ['ground.fill', { x: 'a', z: 1, r: 1, m3: 1 }], ['ground.push', { x0: 0, z0: 0, x1: 1, z1: 0, w: 1 }],
    ['ground.grade', { samples: [], targetY: 1, core: 1, rim: 2 }], ['ground.trim', { region: { poly: [[0, 0]] }, targetY: 0 }], ['ground.importMacro', { key: 'x', b64: '' }]]) {
    const r = sim.commandNow(name, p);
    assert.equal(r.ok, false, name);
  }
  assert.equal(sim.hash(), h);
});

test('the host mirror: imported tiles round-trip in millimetres and fine ground on top is told to redraw', () => {
  const sim = quarry();
  EW.fill(sim.state.sys.pit.grid, 5, 5, 0.01, { r: 0.2 });
  const rev = sim.state.sys.pit.grid.rev, m = new Float32Array(1024).map((_, i) => Math.sin(i / 50) * 0.7);
  assert.ok(sim.commandNow('ground.importMacro', { key: '0,0', b64: f32ToBase64(m) }).ok);
  assert.ok(sim.state.sys.pit.grid.rev > rev);
  const out = new Float32Array(1024);
  assert.ok(groundRead.macroTile(sim.state, '0,0', out));
  for (let n = 0; n < 1024; n++) near(out[n], m[n], 0.0005);
  assert.ok(sim.commandNow('ground.importMacro', { key: '0,0', b64: f32ToBase64(new Float32Array(1024)) }).ok);
  assert.deepEqual(groundRead.macroKeys(sim.state), []);
});

test('an old save brings its terrain edits into the ground; a new save keeps them packed', () => {
  setGroundBase(() => 0);
  const sim = createGameSim(7);
  const m = new Float32Array(1024).map((_, i) => (i % 32 > 10 && i % 32 < 20 ? -1.25 : 0));
  const old = sim.serialize(); delete old.sys.ground;          // saves from before the ground system
  const v1 = JSON.stringify({ format: 'homestead-save', v: 1, sim: old, world: { wood: 1, edits: { '2,-1': f32ToBase64(m) } } });
  const save = readSave(v1);
  assert.equal(save.v, SAVE_VERSION);
  assert.equal(save.world.edits, undefined);
  const again = createGameSim(1); again.load(save.sim);
  const out = new Float32Array(1024);
  assert.ok(groundRead.macroTile(again.state, '2,-1', out));
  assert.deepEqual([...out], [...m]);
  near(groundRead.gradedY(again.state, 64 + 15, -32 + 3), -1.25, 1e-9);
  again.commandNow('ground.grade', { samples: [[5, 5]], targetY: 0.8, core: 1, rim: 3 });
  const text = stringifySave(makeSave(again.state, {}));
  const back = createGameSim(1); back.load(readSave(text).sim);
  assert.equal(back.hash(), again.hash());
  near(groundRead.gradedY(back.state, 5, 5), 0.8, 1e-9);
});
