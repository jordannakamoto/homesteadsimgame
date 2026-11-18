// Earthwork grids are packed in save files and come back exactly (core/earthwork-codec.js, save.js v2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { packGrid, unpackGrid, packReplacer, unpackReviver, isGrid, isPacked } from '../src/sim/core/earthwork-codec.js';
import * as EW from '../src/sim/core/earthwork.js';
import { makeSave, readSave, stringifySave, createGameSim, f32ToBase64, SAVE_VERSION } from '../src/sim/index.js';

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function randomGrid(seed, step = 0.1, T = 32) {
  const r = rng(seed), N = T * T, g = { step, T, codes: ['', 'soil', 'gravel'], tiles: {}, rev: 17 };
  for (let k = 0; k < 6; k++) {
    const kind = k % 3, tile = { h: [], s: [], l: [], f: [], t: [] };
    for (let n = 0; n < N; n++) {
      // kind 0: noise (worst case), 1: smooth slope with flat runs, 2: sparse marks
      tile.h.push(kind === 0 ? Math.round((r() - 0.5) * 2e6) : kind === 1 ? (n % T < 10 ? 0 : Math.round(Math.sin(n / 40) * 300)) : (r() < 0.02 ? -120 : 0));
      tile.s.push(kind === 0 ? Math.floor(r() * 3) : n > N / 2 ? 1 : 0);
      tile.l.push(kind === 0 ? Math.floor(r() * 50) : 0);
      tile.f.push(kind === 0 ? Math.floor(r() * 1024) : n % 7 === 0 ? 512 : 0);
      tile.t.push(kind === 0 ? Math.floor(r() * 1e9) : n > 100 ? 4567 : 0);
    }
    g.tiles[(k - 3) + ',' + (2 - k)] = tile;
  }
  g.tiles['9,9'] = { h: new Array(N).fill(0), s: new Array(N).fill(0), l: new Array(N).fill(0), f: new Array(N).fill(0), t: new Array(N).fill(0) };
  return g;
}

test('a packed grid unpacks to exactly the same grid (all-zero tiles dropped)', () => {
  for (const [seed, step, T] of [[1, 0.1, 32], [2, 1, 32], [3, 0.5, 8]]) {
    const g = randomGrid(seed, step, T), p = packGrid(g);
    assert.ok(isGrid(g) && !isGrid(p) && isPacked(p));
    assert.equal(p.tiles['9,9'], undefined);
    const back = unpackGrid(JSON.parse(JSON.stringify(p)));
    delete g.tiles['9,9'];
    assert.deepEqual(back, JSON.parse(JSON.stringify(g)));       // as plain JSON would (-0 is 0)
  }
});

test('a tile that is not whole numbers is kept as it is', () => {
  const g = EW.makeGrid();
  EW.setPoint(g, 3, 4, { h: 0.25 });
  g.tiles['0,0'].h[7] = 0.5;                       // not a whole millimetre: kept raw, still exact
  const back = unpackGrid(JSON.parse(JSON.stringify(packGrid(g))));
  assert.deepEqual(back, g);
});

test('packing shrinks hand-dug ground about tenfold and more for flat machine ground', () => {
  const g = EW.makeGrid();
  for (let k = 0; k < 40; k++) EW.cut(g, 0.3 + (k % 8) * 0.35, 0.4 + Math.floor(k / 8) * 0.5, 0.02, { r: 0.3 });
  for (let k = 0; k < 20; k++) EW.fill(g, 1.5 + (k % 5) * 0.3, 2.2, 0.01, { r: 0.25 });
  const plain = JSON.stringify(g).length, packed = JSON.stringify(g, packReplacer).length;
  assert.ok(packed * 6 < plain, `packed ${packed} vs plain ${plain}`);
  const flat = { step: 1, T: 32, codes: [''], tiles: { '0,0': { h: new Array(1024).fill(-400), s: new Array(1024).fill(0), l: new Array(1024).fill(0), f: new Array(1024).fill(0), t: new Array(1024).fill(0) } }, rev: 1 };
  assert.ok(JSON.stringify(flat, packReplacer).length < 150);
  assert.deepEqual(JSON.parse(JSON.stringify(flat, packReplacer), unpackReviver), flat);
});

test('a save is stored packed and reads back to the same state; a version 1 save still loads', () => {
  const sim = createGameSim(5);
  const g = sim.state.sys.landscape.grid;
  for (let k = 0; k < 10; k++) EW.cut(g, k * 0.4, 1, 0.03, { r: 0.3 });
  const text = stringifySave(makeSave(sim.state, { wood: 2 }));
  assert.ok(text.includes('"enc":"ew1"'));
  const save = readSave(text);
  assert.equal(save.v, SAVE_VERSION);
  assert.deepEqual(save.sim.sys.landscape.grid, JSON.parse(JSON.stringify(g)));
  const again = createGameSim(1); again.load(save.sim);
  assert.equal(again.hash(), sim.hash());
  // a save written before packing (version 1, plain arrays, terrain edits in world)
  const v1 = JSON.stringify({ format: 'homestead-save', v: 1, sim: sim.serialize(), world: { wood: 1, edits: { '0,0': f32ToBase64(new Float32Array(1024).fill(0.5)) } } });
  const old = readSave(v1);
  assert.equal(old.v, SAVE_VERSION);
  assert.deepEqual(old.sim.sys.landscape.grid, JSON.parse(JSON.stringify(g)));
  // a parsed object with packed grids in it is unpacked too
  const obj = readSave(JSON.parse(text));
  assert.deepEqual(obj.sim.sys.landscape.grid, JSON.parse(JSON.stringify(g)));
});
