// Compare scheduler overhead with generation and rendering replaced by inexpensive stand-ins.
// Run with node bench/chunk-stream.mjs.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createChunkStream } from '../src/world/chunk-stream.js';

const size = 32, radius = 3;
const key = (cx, cz) => cx + ',' + cz;
const load = (cx, cz) => ({ cx, cz });

function baseline(chunks) {
  return (x, z) => {
    const cx = Math.floor(x / size), cz = Math.floor(z / size), missing = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const distance = dx * dx + dz * dz;
        if (distance > (radius + 0.5) ** 2) continue;
        if (!chunks.has(key(cx + dx, cz + dz))) missing.push([distance, cx + dx, cz + dz]);
      }
    }
    missing.sort((a, b) => a[0] - b[0]);
    const start = performance.now();
    for (const [, tx, tz] of missing) {
      chunks.set(key(tx, tz), load(tx, tz));
      if (performance.now() - start > Infinity) break;
    }
    for (const [id, chunk] of chunks) {
      if (Math.max(Math.abs(chunk.cx - cx), Math.abs(chunk.cz - cz)) > radius + 1) chunks.delete(id);
    }
  };
}

const scenarios = {
  stationary: () => 0,
  crossing: (i) => (Math.floor(i / 60) % 16) * size,
};
const frames = 200_000;
function run(makeUpdate, position) {
  const chunks = new Map(), update = makeUpdate(chunks);
  for (let i = 0; i < 10_000; i++) update(position(i), 0, Infinity);
  const start = performance.now();
  for (let i = 0; i < frames; i++) update(position(i), 0, Infinity);
  return { ms: performance.now() - start, keys: [...chunks.keys()] };
}
const current = (chunks) => createChunkStream({
  size, radius, chunks, key, load, unload: () => {}, now: () => performance.now(),
}).update;
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
for (const [name, position] of Object.entries(scenarios)) {
  const before = [], after = [];
  for (let i = 0; i < 7; i++) {
    const a = run(baseline, position), b = run(current, position);
    assert.deepEqual(a.keys, b.keys);
    before.push(a.ms);
    after.push(b.ms);
  }
  console.log(name, ...[median(before), median(after)].map((ms) => (ms * 1000 / frames).toFixed(3) + ' µs/frame'));
}
