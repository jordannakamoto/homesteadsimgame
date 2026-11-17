// Roofing as roofers do it, headless: the deck, then drying in (drip edge at the eaves, underlayment from the eave up, drip
// edge up the rakes), then the covering course by course with the ridge cap last, then gutters; and the roof anchor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameSim, supply as SUP } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
import * as C from '../src/sim/content/construction.js';
import '../src/framing.js';

const F = globalThis.__framing;
const cs = (sim) => sim.state.sys.construction;
// a 3 x 4 m single-slope roof, its eave along z = -0.45, with a gutter under the eave
function plan(mat) {
  const run = 3.7, eaveY = 2.6, ridgeY = 4.0;
  const roof = { id: 'r', mat, planes: [{ id: 'r.0', pts: [[-0.45, -0.45], [4.45, -0.45], [4.45, run - 0.45], [-0.45, run - 0.45]], eaveY, ridgeY, run, facing: [0, -1] }], ridges: [], infills: [], ties: [], gutters: [{ a: [-0.45, -0.5], b: [4.45, -0.5], y: eaveY - 0.08, down: [4.45, -0.5] }] };
  const members = F.generate({ found: 'pier-blocks', spec: {}, floors: [], walls: [], roofs: [roof] });
  const pieces = members.map((m) => ({ id: m.id, struct: 1, stage: m.stage, parent: m.parent, kind: m.kind, length: m.length, area: m.area, built: false }));
  return { members, pieces, lines: F.materialsList(members) };
}
function start(mat = 'asphalt') {
  const sim = createGameSim(3), p = plan(mat);
  sim.state.sys.stock.money = 20000;
  assert.ok(sim.commandNow('construction.setPlan', K.planFromPieces(1, p.pieces, p.lines, { name: 'Roof', x: 2, z: 1.5, r: 3 })).ok);
  sim.commandNow('construction.setOption', { key: 'instant', value: true });
  assert.ok(sim.commandNow('construction.order', { structId: 1, stage: 'all' }).ok);
  return { sim, P: cs(sim).progress[1], p };
}
const install = (sim, ids) => sim.commandNow('construction.install', { structId: 1, memberIds: ids, from: 'stacks' });
const ofStage = (P, st, kind) => Object.keys(P.members).filter((id) => P.members[id].stage === st && (!kind || P.members[id].kind === kind));

test('every roofing line is a real, priced item; the new materials map to items', () => {
  const { P } = start();
  for (const k in P.lines) { const it = K.CONSTRUCTION_CATALOG[P.lines[k].itemId]; assert.ok(it && it.priceUsd > 0 && it.massKgPerUnit > 0, k); }
  for (const k of ['dry-in|drip', 'dry-in|icewater', 'dry-in|felt', 'roofing|ridgecap', 'gutters|gutter', 'gutters|downspout']) assert.ok(P.lines[k], k);
  for (const [mat, item] of [['asphalt', 'roof_asphalt'], ['seam', 'roof_steel'], ['corrugated', 'roof_corrugated'], ['membrane', 'roof_epdm'], ['green', 'roof_green'], ['thatch', 'roof_thatch']]) {
    const ln = F.materialsList(plan(mat).members).find((l) => l.stage === 'roofing' && l.label === 'Roofing');
    assert.equal(ln.itemId, item, mat);
  }
});

test('dried in from the eave up, the courses after, the ridge cap last, then the gutters', () => {
  const { sim, P } = start();
  for (const st of ['roof-frame', 'roof-deck']) assert.ok(install(sim, ofStage(P, st)).ok, st);
  assert.deepEqual(K.openStages(P), ['dry-in']);
  // the underlayment waits for the drip edge along the eave; the rake edge waits for the underlayment
  const ul = ofStage(P, 'dry-in', 'membrane'), rake = ofStage(P, 'dry-in', 'rake'), drip = ofStage(P, 'dry-in', 'drip');
  assert.ok(ul.length >= 4 && rake.length >= 2 && drip.length >= 2);
  assert.equal(K.blocked(P, ul[0]), 'support missing');
  assert.ok(install(sim, drip).ok);
  assert.equal(K.blocked(P, ul[0]), null); assert.equal(K.blocked(P, rake[0]), 'support missing');
  assert.ok(install(sim, ul).ok); assert.ok(install(sim, rake).ok);
  assert.ok(K.stageComplete(P, 'dry-in')); assert.deepEqual(K.openStages(P), ['roofing']);
  // a starter strip and courses, then the cap
  const courses = ofStage(P, 'roofing', 'roofing'), cap = ofStage(P, 'roofing', 'ridgecap');
  assert.ok(courses.length >= 8 && cap.length >= 1);
  assert.equal(K.blocked(P, cap[0]), 'support missing');
  const r = install(sim, courses);
  assert.ok(r.ok && r.installed.length === courses.length, r.reason);
  assert.equal(K.blocked(P, cap[0]), null);
  assert.equal(K.openStages(P).includes('gutters'), false);
  const done = install(sim, cap);
  assert.ok(done.stagesDone.includes('roofing'));
  // gutters: the downspout hangs from the gutter
  const gut = ofStage(P, 'gutters', 'gutter'), ds = ofStage(P, 'gutters', 'downspout');
  assert.ok(gut.length && ds.length);
  assert.equal(K.blocked(P, ds[0]), 'support missing');
  assert.ok(install(sim, [...gut, ...ds]).ok);
  assert.ok(P.done); assert.deepEqual(SUP.imbalance(cs(sim)), {}); assert.deepEqual(K.sheetImbalance(cs(sim)), {});
});

test('a roof anchor at the ridge is fixed once per building and kept with the save', () => {
  const { sim } = start();
  assert.equal(sim.commandNow('construction.fixAnchor', { structId: 9, x: 1, y: 4, z: 1 }).ok, false);
  const r = sim.commandNow('construction.fixAnchor', { structId: 1, x: 2, y: 4.02, z: 3.1 });
  assert.ok(r.ok); assert.deepEqual(cs(sim).anchors[1], { x: 2, y: 4.02, z: 3.1 });
  assert.ok(C.ROOFWALK.slideK === 0.5, 'steeper than 6 in 12 slides');
});

test('a plane frame: heights from the eave, and where a person can stand', () => {
  const pl = plan('asphalt').members.find((m) => m.type === 'roof-deck');
  assert.ok(pl.rs && pl.rs[2] === 0, 'the first row of deck sheets starts at the eave');
  const fr = F.planeFrame({ id: 'x', pts: [[0, 0], [4, 0], [4, 3], [0, 3]], eaveY: 2, ridgeY: 3.5, run: 3, facing: [0, -1] });
  const [s, t] = fr.local(1, 2);
  assert.ok(Math.abs(s - 1) < 1e-9 && Math.abs(t - 2) < 1e-9 && fr.inside(s, t) && !fr.inside(5, 1));
  assert.ok(Math.abs(fr.on(1, 2, 0)[1] - 3) < 1e-9 && Math.abs(fr.k - 0.5) < 1e-9);
});
