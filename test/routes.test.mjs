// Routes and links, the generic mechanisms, tested with something that is not a homestead: a pneumatic
// message-tube set in an equipment rack. Tubes come in segments and are joined at each end; signal lines
// are bored through the rack's shelves, pulled, and joined. Stations are terminals, a diverter can close.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim } from '../src/sim/sim.js';
import { createRoutesSystem, worldOf, pathLength } from '../src/sim/core/routes.js';
import { compileLinks } from '../src/sim/core/links.js';

const classes = {
  tube: { id: 'tube', linkKind: 'carrier', steps: ['seg', 'join'], phases: { rough: ['diverter'], trim: ['station'] } },
  line: { id: 'line', linkKind: 'signal', steps: ['bore', 'pull', 'join'], phases: { rough: ['jack'], trim: ['jack'] } },
};
const make = (guard) => createSim({ seed: 3, systems: [createRoutesSystem({ name: 'routes', classes, guard })] });
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

// A rack at (10, 0, 5) turned a quarter: station A at the top, a diverter below it, stations B and C either side.
function rack(sim) {
  const R = sim.state.sys.routes, c = (n, p) => sim.commandNow('routes.' + n, p);
  c('setFrames', { frames: { rack: { x: 10, y: 0, z: 5, yaw: Math.PI / 2 } } });
  const A = c('addNode', { kind: 'station', frame: 'rack', at: [0, 2, 0], ref: { piece: 'stA', port: 'tube' } }).id;
  const D = c('addNode', { kind: 'diverter', frame: 'rack', at: [0, 1, 0], set: { closed: false } }).id;
  const B = c('addNode', { kind: 'station', frame: 'rack', at: [-1, 1, 0], ref: { piece: 'stB', port: 'tube' } }).id;
  const C = c('addNode', { kind: 'station', frame: 'rack', at: [1, 0.5, 0], ref: { piece: 'stC', port: 'tube' } }).id;
  const t1 = c('addRun', { cls: 'tube', spec: 'tube_63', a: A, b: D, path: [[0, 2, 0], [0, 1, 0]], segs: 1 });
  const t2 = c('addRun', { cls: 'tube', spec: 'tube_63', a: D, b: B, path: [[0, 1, 0], [-1, 1, 0]], segs: 1 });
  const t3 = c('addRun', { cls: 'tube', spec: 'tube_63', a: D, b: C, path: [[0, 1, 0], [0, 0.5, 0], [1, 0.5, 0]], segs: 2 });
  for (const t of [t1, t2, t3]) assert.equal(t.ok, true, t.reason);
  return { R, A, D, B, C, t1: t1.id, t2: t2.id, t3: t3.id, c };
}
const jointRules = { joint: (n) => ({ blocked: !!(n.set && n.set.closed), open: !!(n.set && n.set.uncapped) }) };

test('runs keep their length from the path, refuse nonsense, and say why', () => {
  const sim = make(), { R, A, D, t3, c } = rack(sim);
  near(R.runs[t3].lengthM, 1.5);
  near(pathLength([[0, 0, 0], [3, 4, 0]]), 5);
  assert.deepEqual(c('addRun', { cls: 'hose', a: A, b: D }), { ok: false, reason: 'unknown class' });
  assert.equal(c('addRun', { cls: 'tube', a: A, b: 'nope' }).reason, 'no such node');
  assert.equal(c('addRun', { cls: 'tube', a: A, b: A }).reason, 'a run needs two ends');
  assert.equal(c('addNode', { kind: 'jack', frame: 'shelf', at: [0, 0, 0] }).reason, 'no such frame');
  assert.equal(c('removeNode', { id: D }).reason, 'a run ends here');
  // no path: the straight line between its nodes; a legacy run keeps the length it brings
  const L = c('addRun', { cls: 'tube', a: A, b: D }); near(L.lengthM, 1);
  near(c('addRun', { cls: 'tube', a: A, b: D, legacy: true, lengthM: 7.25, state: 'done' }).lengthM, 7.25);
  const v = R.version; c('removeRun', { id: L.id }); assert.equal(R.version, v + 1);
});

test('work goes step by step, several per gesture, never backwards; trimming the ends finishes a run', () => {
  const sim = make(), c = (n, p) => sim.commandNow('routes.' + n, p), R = () => sim.state.sys.routes;
  c('setFrames', { frames: { rack: { x: 0, y: 0, z: 0, yaw: 0 } } });
  const a = c('addNode', { kind: 'jack', frame: 'rack', at: [0, 0, 0] }).id, b = c('addNode', { kind: 'jack', frame: 'rack', at: [0, 3, 0] }).id;
  const id = c('addRun', { cls: 'line', spec: 'cat6', a, b, path: [[0, 0, 0], [0, 3, 0]], bores: [{ at: [0, 1, 0], parent: 'shelf1' }, { at: [0, 2, 0], parent: 'shelf2' }, { at: [0, 2.5, 0], parent: 'shelf3' }] }).id;
  const pulled = c('work', { id, what: 'pull', to: 1 });
  assert.equal(pulled.ok, false); assert.equal(pulled.need, 'bore');
  assert.equal(c('work', { id, what: 'bore', n: 2 }).done, 2);
  assert.equal(c('work', { id, what: 'bore', index: 2 }).done, 1);
  assert.equal(c('work', { id, what: 'join', end: 'a' }).need, 'pull');
  c('work', { id, what: 'pull', to: 0.6 });
  assert.equal(c('work', { id, what: 'pull', to: 0.3 }).done, 0, 'progress stays');
  assert.equal(R().runs[id].pulled, 0.6);
  c('work', { id, what: 'pull', to: 1 });
  assert.equal(c('work', { id, what: 'seg' }).reason, 'this run has no seg step');
  assert.deepEqual(sim.state.sys.routes.runs[id].state, 'planned');
  assert.equal(c('work', { id, what: 'join', n: 2 }).state, 'roughed');
  // jacks are set at rough-in and finished at trim: progress counts both
  const api = createRoutesSystem({ classes }).api;
  assert.deepEqual(api.progress(R(), 'rack', 'rough'), [6, 8]);          // 3 bores + pull + 2 joins; two jacks not set
  c('setNode', { id: a, state: 'set' }); c('setNode', { id: b, state: 'set' });
  assert.deepEqual(api.progress(R(), 'rack', 'rough'), [8, 8]);
  assert.deepEqual(api.progress(R(), 'rack', 'trim'), [0, 2]);
  c('setNode', { id: a, state: 'trimmed' });
  assert.equal(R().runs[id].state, 'roughed');
  c('setNode', { id: b, state: 'trimmed' });
  assert.equal(R().runs[id].state, 'done');
  assert.deepEqual(api.progress(R(), 'rack', 'trim'), [2, 2]);
  // once worked, a run cannot be rerouted and its nodes cannot move
  assert.equal(c('reroute', { id, path: [[0, 0, 0], [1, 3, 0]] }).ok, false);
  assert.equal(c('moveNode', { id: a, at: [0, 0.2, 0] }).ok, false);
});

test('an untouched run reroutes and follows its nodes; content can refuse work through a guard', () => {
  const sim = make((ctx, run, what) => (run.props && run.props.sealed ? 'the panel is closed' : null)), { R, B, t2, c } = rack(sim);
  assert.equal(c('moveNode', { id: B, at: [-2, 1, 0] }).ok, true);
  near(R.runs[t2].lengthM, 2);
  near(c('reroute', { id: t2, path: [[0, 1, 0], [0, 1.5, 0], [-2, 1.5, 0], [-2, 1, 0]] }).lengthM, 3);
  const s = c('addRun', { cls: 'tube', a: B, b: R.runs[t2].a, props: { sealed: true } }).id;
  assert.equal(c('work', { id: s, what: 'seg' }).reason, 'the panel is closed');
  assert.equal(c('reroute', { id: s, path: [] }).reason, 'the panel is closed');
});

test('frames place runs in the world; a frame that goes leaves its runs stray, never deleted', () => {
  const sim = make(), { R, A, t1, c } = rack(sim);
  const w = worldOf(R, 'rack', [1, 2, 0]);                     // a quarter turn: local +x points to world -z
  near(w[0], 10); near(w[1], 2); near(w[2], 4);
  assert.deepEqual(worldOf(R, null, [1, 2, 3]), [1, 2, 3]);
  c('setFrames', { frames: {} });
  assert.ok(R.runs[t1] && R.runs[t1].stray && R.nodes[A].stray);
  assert.equal(c('work', { id: t1, what: 'seg' }).reason, 'what it was fixed to is gone');
  c('setFrames', { frames: { rack: { x: 0, y: 0, z: 0, yaw: 0 } } });
  assert.ok(!R.runs[t1].stray && !R.nodes[A].stray);
});

test('toNeutral + compileLinks: finished runs link the stations, a closed diverter blocks, a loose end spills', () => {
  const sim = make(), { R, A, D, B, C, t1, t2, t3, c } = rack(sim);
  assert.deepEqual(toN(R), {}, 'nothing is in until it is built');
  for (const t of [t1, t2, t3]) c('work', { id: t, what: 'seg', n: 5 });
  c('work', { id: t1, what: 'join', n: 2 }); c('work', { id: t2, what: 'join', n: 2 }); c('work', { id: t3, what: 'join', end: 'a' });
  let L = compileLinks(toN(R).carrier, { start: () => 0, sum: (acc, st) => acc + (st.edge.lengthM > 1 ? 1 : 0) });
  assert.deepEqual(L.links.map((x) => [x.a, x.b]), [[A, B]]);
  near(L.links[0].lengthM, 2);
  assert.deepEqual(L.links[0].via, [D]);
  // C's tube is not joined at C: what A sends spills at that loose end, and C hears nothing
  assert.deepEqual(L.open.map((o) => [o.from, o.end.run, o.end.end]), [[A, t3, 'b'], [B, t3, 'b']]);
  near(L.open[0].lengthM, 2.5);
  assert.equal(L.open[0].acc, 1, 'the content reducer saw the one long tube');
  assert.deepEqual(L.reach[C].reaches, []);
  c('work', { id: t3, what: 'join', end: 'b' });
  L = compileLinks(toN(R).carrier);
  assert.deepEqual(L.links.map((x) => [x.a, x.b]).sort(), [[A, B], [A, C], [B, C]].sort());
  assert.equal(L.open.length, 0);
  // close the diverter: links still found but through a blocked joint; nothing spills past it
  c('setNode', { id: D, key: 'uncapped', value: true });
  c('setNode', { id: D, key: 'closed', value: true });
  L = compileLinks(toN(R).carrier);
  assert.ok(L.links.every((x) => x.blocked.length === 1 && x.blocked[0] === D));
  assert.deepEqual(L.reach[A].blocked, [D]);
  assert.equal(L.open.length, 0, 'an open end behind a closed joint is dry');
  c('setNode', { id: D, key: 'closed', value: false });
  assert.deepEqual(compileLinks(toN(R).carrier).open.map((o) => o.from), [A, B, C]);
});
const toN = (R) => createRoutesSystem({ classes }).api.toNeutral(R, jointRules);

test('compileLinks: fewest blocked joints first, then shortest; stops end walks; order never depends on input order', () => {
  const g = (rev) => {
    const edges = [{ a: 'T1', b: 'x', lengthM: 1 }, { a: 'x', b: 'T2', lengthM: 1 }, { a: 'T1', b: 'y', lengthM: 5 }, { a: 'y', b: 'T2', lengthM: 5 }, { a: 'T2', b: 'z', lengthM: 1 }, { a: 'z', b: 'S', lengthM: 1 }];
    const terminals = [{ id: 'T1' }, { id: 'T2' }];
    return { terminals: rev ? terminals.reverse() : terminals, edges, joints: { x: { blocked: true }, S: { stop: true } }, openEnds: [] };
  };
  const L = compileLinks(g(false));
  assert.deepEqual(L.links.map((x) => [x.a, x.b, x.lengthM, x.blocked.length]), [['T1', 'T2', 10, 0], ['T2', 'S', 2, 0]]);
  assert.deepEqual(L.reach.T1.reaches, ['T2'], 'a walk never passes through another terminal');
  assert.deepEqual(L.reach.T2.reaches, ['T1', 'S']);
  assert.deepEqual(JSON.stringify(compileLinks(g(true))), JSON.stringify(L));
});

test('saves round-trip as plain JSON, and the generic files carry no homestead words', () => {
  const sim = make(), { c, t1 } = rack(sim);
  c('work', { id: t1, what: 'seg' });
  const S = sim.state.sys.routes;
  assert.deepEqual(JSON.parse(JSON.stringify(S)), S);
  for (const f of ['routes.js', 'links.js']) {
    const src = readFileSync(new URL('../src/sim/core/' + f, import.meta.url), 'utf8');
    assert.ok(!/water|power|pipe|wire|cable|electric|plumb|volt|stud|joist|drain|breaker/i.test(src), f);
    assert.ok(!/Math\.random|Date\.|performance\.now/.test(src), f);
  }
});
