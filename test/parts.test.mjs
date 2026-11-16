// The parts mechanism, tested with a kit that has nothing to do with the homestead: model railway track.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/index.js';
import { createPartsSystem, graph, placements, ROTATIONS, rotate } from '../src/sim/core/parts.js';

const E = (id, type, at, dir) => ({ id, type, at, dir });
const kinds = {
  track: { id: 'track', ends: [E('a', 'tab', [0, 0, 0], [-1, 0, 0]), E('b', 'tab', [1, 0, 0], [1, 0, 0])], stretch: { min: 1, max: 4, end: 'b' } },
  curve: { id: 'curve', ends: [E('a', 'slot', [0, 0, 0], [1, 0, 0]), E('b', 'slot', [0, 0, 0], [0, 0, 1])] },
  points: { id: 'points', ends: [E('a', 'slot', [0, 0, 0], [1, 0, 0]), E('b', 'slot', [0, 0, 0], [-1, 0, 0]), E('c', 'slot', [0, 0, 0], [0, 0, 1])], set: { thrown: false } },
  buffer: { id: 'buffer', ends: [E('a', 'tab', [0, 0, 0], [1, 0, 0])], anchor: true, thin: true },
};
const mates = { tab: ['slot'], slot: ['tab'] };
const sys = { kinds, mates };
const make = () => createSim({ seed: 3, systems: [createPartsSystem({ name: 'rail', stepM: 0.5, kinds, mates })] });
const R = (sim) => sim.state.sys.rail;
const spawn = (sim, kind, len) => sim.commandNow('rail.spawn', { kind, len, pose: { x: 1, y: 0, z: 1 } }).id;
const rotFor = (from, to) => ROTATIONS.findIndex((_, r) => rotate(r, from).join() === to.join());

test('there are 24 square orientations and each is a proper rotation', () => {
  assert.equal(ROTATIONS.length, 24);
  assert.equal(new Set(ROTATIONS.map((m) => JSON.stringify(m))).size, 24);
});

test('parts join end to end, the graph follows, and a part must join something', () => {
  const sim = make();
  sim.commandNow('rail.anchor', { id: 'stop', kind: 'buffer', at: [0, 0, 0], rot: 0, ref: { name: 'station' } });
  const t1 = spawn(sim, 'track', 4), c = spawn(sim, 'curve'), t2 = spawn(sim, 'track', 2);
  assert.equal(R(sim).parts[t1].at, null, 'spawned loose');
  assert.equal(sim.commandNow('rail.fit', { id: t1, at: [5, 0, 5], rot: 0 }).ok, false, 'floating in space is refused');
  // the buffer's slot faces +x at the origin: the track's end a (facing -x) meets it
  sim.commandNow('rail.anchor', { id: 'stop', kind: 'curve', at: [0, 0, 0], rot: 0, ref: { name: 'station' } });
  const ways = placements(sys, R(sim), 'track', 4, graph(sys, R(sim)).open.find((e) => e.d.join() === '1,0,0'));
  assert.equal(ways.length, 1, 'a straight sits one way: its two ends are alike');
  assert.ok(ways.every((w) => w.len === 4));
  assert.equal(sim.commandNow('rail.fit', { id: t1, at: ways[0].at, rot: ways[0].rot }).ok, true);
  let g = graph(sys, R(sim));
  assert.equal(g.joins.length, 1); assert.equal(g.open.length, 2);
  // a curve on the free end: four turns about the joint for each of its two ends
  const cw = placements(sys, R(sim), 'curve', 0, g.open.find((e) => e.part === t1));
  assert.equal(cw.length, 4, 'a curve can leave in four directions');
  const flat = cw.find((w) => rotate(w.rot, [0, 0, 1]).join() === '0,0,1' || rotate(w.rot, [1, 0, 0]).join() === '0,0,1');
  assert.ok(flat);
  sim.commandNow('rail.fit', { id: c, at: flat.at, rot: flat.rot });
  g = graph(sys, R(sim));
  const free = g.open.find((e) => e.part === c);
  const tw = placements(sys, R(sim), 'track', 2, free)[0];
  sim.commandNow('rail.fit', { id: t2, at: tw.at, rot: tw.rot });
  g = graph(sys, R(sim));
  assert.equal(g.joins.length, 3);
  assert.deepEqual(g.adj.get(c).map((l) => l.other).sort(), [t1, t2].sort());
  // nothing may pass through something else
  const t3 = spawn(sim, 'track', 4);
  assert.equal(sim.commandNow('rail.fit', { id: t3, at: [1, 0, 0], rot: 0, free: true }).ok, false, 'two tracks cannot lie in the same place');
  assert.equal(sim.commandNow('rail.fit', { id: t3, at: [2, 0, -2], rot: rotFor([1, 0, 0], [0, 0, 1]), free: true }).ok, false, 'nor cross through one');
  // fixed parts stay; fitted ones come off into the world
  assert.equal(sim.commandNow('rail.unfit', { id: 'stop' }).ok, false);
  assert.equal(sim.commandNow('rail.unfit', { id: t2, pose: { x: 9, y: 0, z: 9 } }).ok, true);
  assert.equal(R(sim).parts[t2].pose.x, 9);
  assert.equal(graph(sys, R(sim)).joins.length, 2);
});

test('a length is cut shorter and the offcut is a real part; nothing is created or lost', () => {
  const sim = make();
  const t = spawn(sim, 'track', 4);
  assert.equal(sim.commandNow('rail.cut', { id: t, len: 5 }).ok, false, 'never longer');
  const r = sim.commandNow('rail.cut', { id: t, len: 1 });
  assert.equal(r.ok, true);
  assert.equal(R(sim).parts[t].len + R(sim).parts[r.offcut].len, 4);
  assert.equal(sim.commandNow('rail.cut', { id: t, len: 0 }).ok, false);
});

test('a length too long for the gap is offered cut to fit', () => {
  const sim = make();
  sim.commandNow('rail.anchor', { id: 'a', kind: 'curve', at: [0, 0, 0], rot: 0 });
  sim.commandNow('rail.anchor', { id: 'b', kind: 'curve', at: [3, 0, 0], rot: rotFor([1, 0, 0], [-1, 0, 0]) });
  const w = placements(sys, R(sim), 'track', 4, graph(sys, R(sim)).open.find((e) => e.part === 'a' && e.d.join() === '1,0,0'));
  assert.ok(w.length && w.every((x) => x.len === 3), JSON.stringify(w));
});

test('settings, save and load, and determinism', () => {
  const sim = make();
  sim.commandNow('rail.anchor', { id: 'stop', kind: 'buffer', at: [0, 0, 0], rot: 0 });
  const p = spawn(sim, 'points');
  const w = placements(sys, R(sim), 'points', 0, graph(sys, R(sim)).open[0])[0];
  sim.commandNow('rail.fit', { id: p, at: w.at, rot: w.rot });
  assert.equal(sim.commandNow('rail.set', { id: p, key: 'thrown', value: true }).ok, true);
  assert.equal(sim.commandNow('rail.set', { id: p, key: 'nope', value: 1 }).ok, false);
  const v = R(sim).version, saved = sim.serialize();
  const again = make(); again.load(saved);
  assert.equal(again.hash(), sim.hash());
  assert.equal(graph(sys, R(again)).joins.length, 1);
  assert.equal(R(again).parts[p].set.thrown, true);
  assert.ok(v > 1);
});
