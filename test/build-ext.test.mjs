// Build mode's extension point (X1), headless: a fixture extension (test/fixtures/build-ext-post.js, not shipped) puts its
// elements into desc.extras, framing draws their members by the kind it registered, and they reach the shopping list and
// construction.setPlan like any wall stud. The page half (membersOf, save, undo) is checked by test/build-ext.smoke.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/framing.js';
import '../src/build-ext.js';
import '../test/fixtures/build-ext-post.js';
import { createGameSim } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
const F = globalThis.__framing, EXT = globalThis.__buildExt;

const room = () => ({ found: 'pier-blocks', spec: {}, floors: [{ id: 'f', outline: [[0, 0], [3, 0], [3, 3], [0, 3]], y0: 0, ground: true }], walls: [], roofs: [] });
const S = { id: 7, ext: { xpost: { posts: [[4, 1], [4, 2.5]] } } };

test('framing: a registered kind draws the members of each desc.extras element; unknown kinds are skipped', () => {
  const desc = room();
  const plain = F.generate(desc).length;
  desc.extras = [{ kind: 'xpost', id: 'a', at: [5, 1] }, { kind: 'nobody-registered-this', id: 'b' }];
  const out = F.generate(desc), post = out.find((m) => m.id === 'a.post');
  assert.equal(out.length, plain + 1);
  assert.ok(post && post.kind === 'post' && post.stage === 'floor-frame' && post.parent === 'a' && Math.abs(post.length - 1.2) < 1e-9);
  assert.throws(() => F.register('bad', null));
});

test('the extension describes its elements from S.ext, with ids of its own that never look like build mode piece ids', () => {
  assert.ok(EXT.get('xpost') && EXT.list().includes('xpost'));
  const desc = room();
  EXT.describe(S, desc, {});
  assert.deepEqual(desc.extras.map((x) => x.id), ['x-xpost-7-0', 'x-xpost-7-1']);
  assert.ok(desc.extras.every((x) => x.id[0] !== 'p'));
  // a structure without the extension's data gets nothing, and a throwing extension does not stop the others
  const none = room(); EXT.describe({ id: 8 }, none, {}); assert.deepEqual(none.extras, []);
  const errs = [], was = console.error; console.error = (...a) => errs.push(a.join(' '));
  try { EXT.extend({ id: 'xbroken', describe() { throw new Error('boom'); } }); const d = room(); EXT.describe(S, d, {}); assert.equal(d.extras.length, 2); }
  finally { console.error = was; EXT.extend({ id: 'xbroken' }); }   // registered again with no hooks: quiet from here on
  assert.ok(errs.some((e) => /xbroken/.test(e)));
  assert.throws(() => EXT.extend({ id: 'Bad Id' }));
});

test('the extension\'s members are on the shopping list and in construction.setPlan', () => {
  const desc = room(); EXT.describe(S, desc, {});
  const mem = F.generate(desc).map((m) => ({ ...m, struct: 's1', built: false }));
  const lines = F.materialsList(mem), posts = lines.find((l) => l.stage === 'floor-frame' && l.itemId === 'lumber_4x4');
  assert.ok(posts, 'a line of 4x4 for the posts');
  assert.deepEqual(posts.members.map((q) => q[0]).sort(), ['x-xpost-7-0.post', 'x-xpost-7-1.post']);
  // the parent pieces the extension adds (build.js structPieces calls EXT.pieces with these helpers)
  const pieces = [];
  EXT.pieces(S, pieces, { head: (id, kind, type, material) => ({ id, struct: 's1', kind, type, material, built: false }), W2: (x, z) => ({ x, z }), y0: 0, H: 2.84 });
  assert.deepEqual(pieces.map((p) => p.id), ['x-xpost-7-0', 'x-xpost-7-1']);
  const sim = createGameSim(3);
  sim.state.sys.stock.money = 5000;
  assert.ok(sim.commandNow('construction.setPlan', K.planFromPieces('s1', mem, lines, { name: 'Posts', x: 40, z: 40, r: 2 })).ok);
  const pr = sim.state.sys.construction.progress.s1;
  assert.ok(pr.members['x-xpost-7-0.post'] && pr.members['x-xpost-7-0.post'].stage === 'floor-frame' && !pr.members['x-xpost-7-0.post'].built);
});
