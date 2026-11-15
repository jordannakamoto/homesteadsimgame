import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChunkStream } from '../src/world/chunk-stream.js';

test('chunk streaming resumes within budget, reprioritizes on crossing and forgets loads after reset', () => {
  const chunks = new Map(), loaded = [], unloaded = [];
  let clock = 0, lookups = 0;
  const stream = createChunkStream({
    size: 32, radius: 3, chunks,
    key: (x, z) => { lookups++; return x + ',' + z; },
    load: (cx, cz) => { clock += 6; loaded.push([cx, cz]); return { cx, cz }; },
    unload: (chunk) => unloaded.push(chunk),
    now: () => clock,
  });
  stream.update(0, 0, 5);
  stream.update(0, 0, 5);
  assert.deepEqual(loaded, [[0, 0], [0, -1]]);
  stream.update(-0.01, 0, 5);
  assert.deepEqual(loaded.at(-1), [-1, 0]);
  stream.update(-0.01, 0, Infinity);
  const hits = lookups;
  stream.update(-0.02, 0, 5);
  assert.equal(lookups, hits);
  assert.equal(chunks.size, 37);

  stream.update(32, 0, Infinity);
  assert.ok(chunks.has('-3,0'), 'retention margin keeps adjacent chunks resident');
  assert.ok(!chunks.has('-4,0'), 'outside the margin, resources are unloaded');
  assert.ok(unloaded.some(({ cx, cz }) => cx === -4 && cz === 0));
  stream.update(3200, 0, Infinity);
  assert.equal(chunks.size, 37);
  assert.ok(chunks.has('100,0'));

  const beforeReset = unloaded.length;
  stream.reset();
  assert.equal(chunks.size, 0);
  assert.equal(unloaded.length - beforeReset, 37);
  stream.update(3200, 0, 5);
  assert.deepEqual([...chunks.keys()], ['100,0']);
});
