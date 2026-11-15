import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameSim, mapPieces, resolveMaterial, MATERIALS, LAYER_MATERIAL } from '../src/sim/index.js';

test('every layer material name build mode uses maps to a registry material', () => {
  const src = readFileSync(new URL('../src/build.js', import.meta.url), 'utf8');
  const names = new Set([...src.matchAll(/(?:LY|solid)\("([^"]+)"/g)].map((m) => m[1]));
  assert.ok(names.size >= 20);
  for (const n of names) assert.ok(MATERIALS[LAYER_MATERIAL[n]], 'no registry material for layer "' + n + '"');
});

test('pieces reach the simulation with registry materials, immediately, even while paused', () => {
  const sim = createGameSim(1);
  const raw = [{ id: 'p1', kind: 'wall', type: 'wall', material: 'timber', length: 5, height: 2.84,
    layers: [{ material: 'softwood-boards', thickness: 0.022 }, { material: 'air', thickness: 0.089 }, { material: 'softwood-boards', thickness: 0.019 }],
    openings: [{ id: 'p2', kind: 'window', material: 'timber', layers: [{ material: 'glass', thickness: 0.004 }] }] },
  { id: 'p3', kind: 'roof', material: 'thatch', layers: [{ material: 'thatch', thickness: 0.3 }] },
  { id: 'p4', kind: 'wall', material: 'unobtainium' }];
  sim.commandNow('site.setPieces', { pieces: mapPieces(raw) });
  const site = sim.state.sys.site;
  assert.equal(site.version, 1);
  assert.equal(site.pieces[0].material, 'spf_seasoned');
  assert.equal(site.pieces[0].appearance, 'timber');
  assert.deepEqual(site.pieces[0].layers.map((l) => l.material), ['spf_seasoned', 'air', 'spf_seasoned']);
  assert.equal(site.pieces[0].openings[0].layers[0].material, 'float_glass');
  assert.equal(site.pieces[1].material, 'thatch');
  assert.equal(site.pieces[2].material, null);
  assert.equal(site.pieces[2].unknownMaterial, 'unobtainium');
  assert.equal(resolveMaterial('concrete'), 'concrete');
  const again = createGameSim(1); again.load(sim.serialize());
  assert.equal(again.hash(), sim.hash());
});
