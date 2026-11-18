// Finishing, anchor bolts, joints, covers, misting and stripping (slice B5), headless: gravel tipped, raked and tamped twice
// is read from the ground; form boards and stakes go on the strings; bags and water make a mix whose water/cement
// ratio decides how it slumps and whether it screeds; the screed rides the forms with a ridge ahead of it; an
// unstaked form bows and leaks; the screeded slab starts to cure and holds framing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameSim, foundationRead, groundRead, earthwork as EW } from '../src/sim/index.js';
import { makeBolts, makeJoints } from '../src/sim/foundation.js';
import * as K from '../src/sim/construction.js';
import * as CC from '../src/sim/content/concrete.js';
import * as CU from '../src/sim/core/cure.js';
const shed = JSON.parse(readFileSync(new URL('./helpers/shed-plan.json', import.meta.url), 'utf8'));
const SID = shed.struct;
function slabPlan() {
  const pieces = shed.pieces.filter((p) => p.stage !== 'foundation' || p.kind === 'foundation');
  const fd = shed.pieces.find((p) => p.stage === 'foundation' && p.kind === 'foundation').id, mk = (id, kind, length) => ({ id: fd + '.' + id, struct: SID, stage: 'foundation', kind, parent: fd, length });
  const slab = [mk('g0', 'footing', 3), mk('sl5', 'slab', 3)];
  const lines = shed.materialsList.filter((l) => l.stage !== 'foundation');
  lines.push({ key: 'foundation|gravel', stage: 'foundation', itemId: 'gravel', qty: 0.72, unit: 'm3', label: 'Gravel', count: 1, members: [[slab[0].id, 0.72]] });
  lines.push({ key: 'foundation|concrete', stage: 'foundation', itemId: 'concrete_mix', qty: 1700, unit: 'kg', label: 'Concrete mix', count: 1, members: [[slab[1].id, 0.72]] });
  return K.planFromPieces(SID, pieces.concat(slab), lines, { name: 'Slab shed', x: 40, z: 40, r: 2 });
}
// a small slab (2 x 1.6 m) so the test is quick: base 10 cm under a 10 cm slab
const CORNERS = [[39, 39.2], [41, 39.2], [41, 40.8], [39, 40.8]];
const TOP = 0.12, BASEY = 0.02, TARGET = -0.08;
const job = (sim, id) => foundationRead.job(sim.state, id);
function start({ dug = true } = {}) {
  const sim = createGameSim(7);
  assert.ok(sim.commandNow('construction.setPlan', slabPlan()).ok);
  const r = sim.commandNow('foundation.setPlan', { structId: SID, corners: CORNERS, digs: [{ poly: CORNERS, targetY: TARGET, baseY: BASEY }], topY: TOP });
  assert.ok(r.ok, r.reason);
  for (const t of ['shovel', 'rake', 'tamper', 'wheelbarrow']) sim.commandNow('stock.add', { id: t, qty: 1 });
  sim.commandNow('stock.add', { id: 'gravel', qty: 1 });
  sim.commandNow('stock.add', { id: 'concrete_mix', qty: 36 * 30 });
  sim.commandNow('stock.add', { id: 'form_board', qty: 8 });
  sim.commandNow('stock.add', { id: 'form_stake', qty: 30 });
  if (dug) {
    for (let k = 0; k < 4; k++) sim.commandNow('foundation.stake', { jobId: r.jobId, corner: k });
    assert.ok(sim.commandNow('ground.trim', { region: { poly: CORNERS }, targetY: TARGET }).ok);
    assert.equal(sim.commandNow('foundation.check', { jobId: r.jobId }).step, 'base');
  }
  return { sim, jobId: r.jobId };
}
// the base by the landscape's own commands: heaps tipped in, raked to the line with pushes and the rake, tamped twice
function laybase(sim, jobId, { tampPasses = 2 } = {}) {
  for (const [x, z] of [[39.5, 39.6], [40.5, 39.6], [39.5, 40.4], [40.5, 40.4]]) assert.ok(sim.commandNow('foundation.gravel', { jobId, x, z, m3: 0.1 }).ok);
  const lvAt = (x, z) => BASEY - groundRead.gradedY(sim.state, x, z);
  for (let pass = 0; pass < 3; pass++) {
    for (let z = 39.25; z <= 40.76; z += 0.2) {
      for (let x = 39.05; x < 40.95; x += 0.1) sim.commandNow('landscape.push', { x0: x, z0: z, x1: x + 0.1, z1: z, level: lvAt(x, z) });
      for (let x = 40.95; x > 39.05; x -= 0.1) sim.commandNow('landscape.push', { x0: x, z0: z, x1: x - 0.1, z1: z, level: lvAt(x, z) });
    }
    for (let z = 39.3; z <= 40.7; z += 0.25) for (let x = 39.1; x <= 40.9; x += 0.25) sim.commandNow('landscape.rake', { x, z, r: 0.4, k: 0.6 });
  }
  for (let p = 0; p < tampPasses; p++) for (let z = 39.25; z <= 40.76; z += 0.12) for (let x = 39.05; x <= 40.96; x += 0.12) sim.commandNow('landscape.tamp', { x, z });
}


function mixBatch(sim, jobId, waterPerBag = 3.0) {
  let r = sim.commandNow('foundation.mix', { jobId, bags: 3 });
  assert.ok(r.ok, r.reason);
  r = sim.commandNow('foundation.mix', { jobId, waterL: waterPerBag * r.mix.bags });
  for (let k = 0; k < 20 && r.mix.mixed < 1; k++) r = sim.commandNow('foundation.mix', { jobId, work: 0.5 });
  return r.mix;
}
function readyToPour({ stake = true } = {}) {
  const { sim, jobId } = start();
  laybase(sim, jobId);
  assert.equal(sim.commandNow('foundation.check', { jobId }).step, 'forms');
  for (let k = 0; k < 4; k++) sim.commandNow('foundation.setForm', { jobId, run: k, n: 4 });
  if (stake) for (let k = 0; k < 4; k++) sim.commandNow('foundation.stakeForm', { jobId, run: k, n: 4 });
  return { sim, jobId };
}


// poured and screeded: the slab is in the finish step
function screeded({ water = 3.0 } = {}) {
  const { sim, jobId } = readyToPour();
  for (const t of [CC.FIN.kit, CC.COVERS.blanket, CC.COVERS.plastic, CC.MIST.tool]) sim.commandNow('stock.add', { id: t, qty: 1 });
  sim.commandNow('stock.add', { id: CC.BOLTS.item, qty: 20 });
  let placed = 0, n = 0;
  const spots = [[39.4, 39.6], [40, 39.6], [40.6, 39.6], [39.4, 40.4], [40, 40.4], [40.6, 40.4]];
  while (placed < 0.33 && n < 30) { mixBatch(sim, jobId, water); const r = sim.commandNow('foundation.tip', { jobId, x: spots[n % 6][0], z: spots[n % 6][1] }); assert.ok(r.ok, r.reason); placed = r.placed; n++; }
  for (let z = 39.3; z <= 40.7; z += 0.2) for (let x = 39.1; x <= 40.9; x += 0.2) sim.commandNow('foundation.rake', { jobId, x, z });
  let s;
  for (let x = 39.0; x < 40.95; x += 0.5) { s = sim.commandNow('foundation.screed', { jobId, x0: x, z0: 40, x1: Math.min(41, x + 0.5), z1: 40 }); if (s.done) break; }
  for (let x = 41; x > 39.05 && !s.done; x -= 0.5) s = sim.commandNow('foundation.screed', { jobId, x0: x, z0: 40, x1: x - 0.5, z1: 40 });
  assert.ok(s.done, JSON.stringify(s));
  return { sim, jobId };
}
const sweep = (sim, jobId, kind, r = 0.3) => { let last; for (let z = 39.25; z <= 40.76; z += r * 0.8) for (let x = 39.05; x <= 40.96; x += r * 0.8) last = sim.commandNow('foundation.finishAt', { jobId, x, z, kind, r }); return last; };
const xOf = (sim, jobId) => foundationRead.finish(sim.state, jobId).x;
// run the clock (minutes) until the working time is at least x
const runTo = (sim, jobId, x) => { for (let k = 0; k < 4000 && xOf(sim, jobId) < x; k++) sim.runTicks(CC.CURE_EVERY); return xOf(sim, jobId); };

test('screeded, the slab is in the finish step: curing already, framing held, the sheen on the top', () => {
  const { sim, jobId } = screeded();
  const j = foundationRead.job(sim.state, jobId);
  assert.equal(j.step, 'finish');
  assert.ok(j.elements.every((e) => e.cure && e.cure.setX === 0));
  const w = foundationRead.finish(sim.state, jobId);
  assert.equal(w.phase, 'bleeding'); assert.equal(w.sheen, 1);
  assert.ok(w.bolts.length >= 4 && w.boltsLeft === w.bolts.length, 'bolt marks along the sill line');
  assert.equal(w.joints.length, 0, 'a 2 x 1.6 m slab needs no joints');
  const pr = sim.state.sys.construction.progress[SID], joist = Object.keys(pr.members).find((id) => pr.members[id].stage === 'floor-frame' || pr.members[id].stage === 'wall-frame');
  assert.equal(K.blocked(pr, joist), CC.GATE_SAYS.frame);
  assert.match(sim.commandNow('foundation.cover', { jobId, kind: 'plastic' }).reason, /Finish the top first/);
  assert.match(sim.commandNow('foundation.strip', { jobId }).reason, /Finish the top first/);
  // a quality factor survives the steps (the cure used to overwrite the mix's cap)
  sim.runTicks(CC.CURE_EVERY * 3);
  assert.ok(j.elements.every((e) => e.cure.cap === e.cure.q && e.cure.cap > 0.95));
});

test('the finishing window: float at once, trowel only after the sheen, nothing after final set', () => {
  const { sim, jobId } = screeded();
  const st = sim.state.sys.stock; st.tools.splice(st.tools.indexOf(CC.FIN.kit), 1);
  assert.match(sim.commandNow('foundation.finishAt', { jobId, x: 40, z: 40, kind: 'float' }).reason, /finishing kit/);
  sim.commandNow('stock.add', { id: CC.FIN.kit, qty: 1 });
  assert.match(sim.commandNow('foundation.finishAt', { jobId, x: 40, z: 40, kind: 'nothing' }).reason, /no such/);
  // before it is floated the trowel finds nothing to work
  const t0 = sim.commandNow('foundation.finishAt', { jobId, x: 40, z: 40, kind: 'trowel', r: 0.4 });
  assert.equal(t0.n, 0); assert.match(t0.unfloated, /Bull float it first/);
  // the bull float, right away
  let f = sweep(sim, jobId, 'float', 0.5);
  assert.ok(f.cov.float > 0.95, 'floated: ' + f.cov.float);
  // troweling with the sheen still on works the water back in: scaled skin, a flaw
  const early = sim.commandNow('foundation.finishAt', { jobId, x: 39.4, z: 39.6, kind: 'trowel', r: 0.3 });
  assert.ok(early.early && early.n > 0 && early.phase === 'bleeding');
  assert.ok(foundationRead.finish(sim.state, jobId).cov.scaled > 0);
  // the sheen goes; then troweling takes
  const w0 = foundationRead.finish(sim.state, jobId);
  const x = runTo(sim, jobId, w0.bleedEnd + 0.02);
  const w1 = foundationRead.finish(sim.state, jobId);
  assert.ok(x >= w0.bleedEnd && w1.phase === 'ready' && w1.sheen === 0, JSON.stringify(w1));
  assert.ok(w1.leftH > 0);
  const t1 = sim.commandNow('foundation.finishAt', { jobId, x: 40.6, z: 40.4, kind: 'trowel', r: 0.3 });
  assert.ok(!t1.early && t1.n > 0);
  // trowelled and broomed points do not swap
  assert.equal(sim.commandNow('foundation.finishAt', { jobId, x: 40.6, z: 40.4, kind: 'broom', r: 0.3 }).n, 0);
  // too late: past final set the tools tear and refuse; the step ends by itself, what was not worked is left
  runTo(sim, jobId, CC.FIN.trowelUntil + 0.05);
  const j = foundationRead.job(sim.state, jobId);
  assert.equal(j.step, 'cure', 'the working time is over');
  assert.ok(j.finish.result.forced && j.finish.result.unfloated < 0.05 && j.finish.result.scaled > 0);
  assert.match(sim.commandNow('foundation.finishAt', { jobId, x: 40, z: 40, kind: 'trowel' }).reason, /past finishing/);
  assert.equal(j.pour.grid, null, 'the wet field is gone');
  assert.ok(j.elements.every((e) => e.cure.q < j.elements[0].cure.cap + 1e-9));
});

test('the sheen lasts longer on a wetter mix, and windows are in set-time units that stretch with the cold', () => {
  const a = screeded({ water: 3.0 }), b = screeded({ water: 4.6 });
  const wa = foundationRead.finish(a.sim.state, a.jobId), wb = foundationRead.finish(b.sim.state, b.jobId);
  assert.ok(wb.bleedEnd > wa.bleedEnd * 1.2, wa.bleedEnd + ' vs ' + wb.bleedEnd);
  // 6 h of hand-scaled set time at 20 C is 12 h at 10 C: the window in clock hours doubles
  const warm = CU.setHoursAt(CC.SET_H20 * CC.WORKABLE_SCALE, 20), cold = CU.setHoursAt(CC.SET_H20 * CC.WORKABLE_SCALE, 10);
  assert.ok(Math.abs(cold / warm - 2) < 1e-9);
  const s = foundationRead.finish(a.sim.state, a.jobId);
  assert.ok(s.leftH > CC.FIN.trowelUntil * 2 && s.leftH < CC.FIN.trowelUntil * 24, 'clock hours left ' + s.leftH);
});

test('finishing everything advances to cure; anchor bolts are needed first and gate framing', () => {
  const { sim, jobId } = screeded();
  sweep(sim, jobId, 'float', 0.5);
  runTo(sim, jobId, foundationRead.finish(sim.state, jobId).bleedEnd + 0.02);
  const f = sweep(sim, jobId, 'broom', 0.35);
  assert.ok(f.cov.broom > 0.9, 'broomed ' + f.cov.broom);
  assert.ok(!f.done && foundationRead.job(sim.state, jobId).step === 'finish', 'the bolts are not in: not finished');
  const w = foundationRead.finish(sim.state, jobId), n = w.bolts.length;
  assert.match(sim.commandNow('foundation.setBolt', { jobId, x: 30, z: 30 }).reason, /glowing bolt mark/);
  const stock0 = sim.state.sys.stock.items.anchor_bolt;
  let r = sim.commandNow('foundation.setBolt', { jobId, x: w.bolts[0][0], z: w.bolts[0][1], n: 3 });
  assert.ok(r.ok && r.n === 3 && !r.retro && r.left === n - 3, JSON.stringify(r));
  assert.equal(sim.state.sys.stock.items.anchor_bolt, stock0 - 3);
  // while wet they go in, the last one finishes the surface, the slab goes on to cure
  r = sim.commandNow('foundation.setBolt', { jobId, n: 4 });
  assert.ok(r.ok && r.left === 0 && r.done, JSON.stringify(r));
  assert.equal(foundationRead.job(sim.state, jobId).step, 'cure');
  assert.ok(foundationRead.job(sim.state, jobId).elements.every((e) => e.finish.broom > 0.9));
  assert.equal(foundationRead.job(sim.state, jobId).finish.result.forced, false);
});

test('framing refuses a slab with no anchor bolts, even when the concrete is strong enough', () => {
  const { sim, jobId } = screeded();
  const pr = sim.state.sys.construction.progress[SID], joist = Object.keys(pr.members).find((id) => pr.members[id].stage === 'floor-frame' || pr.members[id].stage === 'wall-frame');
  sim.commandNow('foundation.finish', { jobId });
  const j = foundationRead.job(sim.state, jobId);
  assert.equal(j.step, 'cure');
  for (const e of j.elements) CU.ageTo(e.cure, 24 * 6);
  sim.runTicks(CC.CURE_EVERY);
  assert.ok(foundationRead.gates(sim.state, jobId).frame, 'strong enough');
  assert.equal(K.blocked(pr, joist), CC.BOLT_SAYS);
  assert.equal(K.stageOpen(pr, 'floor-frame'), false);
  // after set they are drilled and epoxied in, one at a time
  const w = foundationRead.finish(sim.state, jobId);
  const r = sim.commandNow('foundation.setBolt', { jobId, x: w.bolts[0][0], z: w.bolts[0][1], n: 4 });
  assert.ok(r.ok && r.retro && r.n === 1, JSON.stringify(r));
  for (let k = 0; k < w.bolts.length; k++) sim.commandNow('foundation.setBolt', { jobId });
  sim.runTicks(CC.CURE_EVERY);
  assert.equal(K.blocked(pr, joist), null);
  assert.equal(foundationRead.finish(sim.state, jobId).boltsLeft, 0);
  // no bolts in stock: it says so
  const t = screeded();
  t.sim.state.sys.stock.items.anchor_bolt = 0;
  assert.match(t.sim.commandNow('foundation.setBolt', { jobId: t.jobId }).reason, /anchor bolts/);
});

test('control joints: planned for spans over 3 m, a groover stroke cuts the line it runs along', () => {
  const big = { layout: { corners: [[0, 0], [6, 0], [6, 4], [0, 4]] } };
  const J = makeJoints(big).lines;
  assert.equal(J.length, 3, 'one across 4 m, two across 6 m');
  assert.ok(J.every((l) => Math.abs(l.len - (l.a[0] === l.b[0] ? 4 : 6)) < 0.2));
  const small = makeJoints({ layout: { corners: [[0, 0], [3, 0], [3, 2], [0, 2]] } }).lines;
  assert.equal(small.length, 0, 'a span of 3 m or less is not jointed');
  const B = makeBolts(big).pos;
  assert.ok(B.length >= 8 && B.every((b) => b[0] >= 0 && b[0] <= 6 && b[1] >= 0 && b[1] <= 4), 'inside the outline: ' + B.length);
  // bolts at most 1.8 m apart along a side and near the corners
  const side = B.filter((b) => Math.abs(b[1] - 0.05) < 1e-6).map((b) => b[0]).sort((a, c) => a - c);
  assert.ok(side.length >= 4 && side.every((x, i) => i === 0 || x - side[i - 1] <= 1.8 + 1e-9) && side[0] <= 0.3);
  // through the command: the lines are put into a real finishing job
  const { sim, jobId } = screeded();
  const j = foundationRead.job(sim.state, jobId);
  j.finish.joints = makeJoints({ layout: { corners: [[39, 38], [45, 38], [45, 42], [39, 42]] } });
  const lines = j.finish.joints.lines, ln = lines.find((l) => l.a[0] === l.b[0]);
  assert.match(sim.commandNow('foundation.joint', { jobId, x0: 100, z0: 100, x1: 101, z1: 100 }).reason || '', /dashed joint line/);
  const half = sim.commandNow('foundation.joint', { jobId, x0: ln.a[0], z0: ln.a[1], x1: ln.a[0], z1: ln.a[1] + ln.len / 2 });
  assert.ok(half.ok && half.n > 0 && half.cut[lines.indexOf(ln)] > 0.4 && half.cut[lines.indexOf(ln)] < 0.7 && !half.done, JSON.stringify(half));
  for (const l of lines) for (let t = 0; t < l.len; t += 3) { const u = [(l.b[0] - l.a[0]) / l.len, (l.b[1] - l.a[1]) / l.len], t1 = Math.min(l.len, t + 3); sim.commandNow('foundation.joint', { jobId, x0: l.a[0] + u[0] * t, z0: l.a[1] + u[1] * t, x1: l.a[0] + u[0] * t1, z1: l.a[1] + u[1] * t1 }); }
  assert.ok(foundationRead.finish(sim.state, jobId).joints.every((l) => l.cells.every(Boolean)));
  // a groover stroke later than the joint window refuses
  const late = screeded();
  late.sim.state.sys.foundation.jobs[late.jobId].finish.joints = makeJoints({ layout: { corners: [[39, 38], [45, 38], [45, 42], [39, 42]] } });
  for (const e of late.sim.state.sys.foundation.jobs[late.jobId].elements) e.cure.setX = CC.FIN.jointUntil + 0.01;
  assert.match(late.sim.commandNow('foundation.joint', { jobId: late.jobId, x0: 42, z0: 38, x1: 42, z1: 40 }).reason, /set/);
});

test('covers and misting feed the cure: a blanket keeps the heat in, a misting expires, plastic needs no misting', () => {
  const { sim, jobId } = screeded();
  sim.commandNow('foundation.finish', { jobId });
  const j = foundationRead.job(sim.state, jobId), c = j.elements[0].cure;
  sim.runTicks(CC.CURE_EVERY);
  const bare = c.tc;
  assert.equal(sim.commandNow('foundation.cover', { jobId, kind: 'tarp' }).reason, 'no such cover');
  const st = sim.state.sys.stock; st.tools.splice(st.tools.indexOf(CC.COVERS.blanket), 1);
  assert.match(sim.commandNow('foundation.cover', { jobId, kind: 'blanket' }).reason, /curing blanket/);
  sim.commandNow('stock.add', { id: CC.COVERS.blanket, qty: 1 });
  assert.ok(sim.commandNow('foundation.cover', { jobId, kind: 'blanket' }).ok);
  assert.equal(c.covered, 'blanket'); assert.equal(foundationRead.finish(sim.state, jobId).cover, 'blanket');
  sim.runTicks(CC.CURE_EVERY);
  assert.ok(c.tc >= bare + CC.CURE.blanketC - 3 && c.tc > bare + 4, 'the blanket warms it: ' + bare + ' -> ' + c.tc);
  assert.ok(sim.commandNow('foundation.cover', { jobId, kind: null }).ok);
  assert.equal(c.covered, null);
  // misting: wet for half an hour, then it stops
  const m = sim.commandNow('foundation.mist', { jobId });
  if (m.ok) {
    assert.equal(m.minutes, 30);
    sim.runTicks(CC.CURE_EVERY); assert.equal(c.wet, true);
    sim.runTicks(60); assert.equal(c.wet, false, 'the mist has dried');
  } else assert.match(m.reason, /Too cold/);
  assert.ok(sim.commandNow('foundation.cover', { jobId, kind: 'plastic' }).ok);
  assert.match(sim.commandNow('foundation.mist', { jobId }).reason, /Too cold|plastic/);
  // the cure core: covered or kept wet escapes the drying damage that a hot, dry, windy bare slab suffers
  const hot = { airC: 33, windMs: 7, rh: 0.25 };
  const mk = (o) => { const r = CU.newCure(0); for (let h = 0; h < 12; h++) CU.stepCure(r, 1, 1, { ...hot, ...o }); return r.dry; };
  assert.ok(mk({}) > 0.3 && mk({ covered: 'plastic' }) === 0 && mk({ wet: true }) === 0);
  assert.equal(CC.COVERS.plastic, 'poly_sheeting');
});

test('stripping: refused until a fifth strength, then boards and stakes go back to stock; the step follows', () => {
  const { sim, jobId } = screeded();
  const stk = sim.state.sys.stock.items, boards0 = stk.form_board, stakes0 = stk.form_stake;
  sim.commandNow('foundation.finish', { jobId });
  assert.match(sim.commandNow('foundation.strip', { jobId }).reason, /still green \(\d+% of 20%\)/);
  const j = foundationRead.job(sim.state, jobId);
  for (const e of j.elements) CU.ageTo(e.cure, 24 * 1.5);
  assert.ok(sim.runTicks(CC.CURE_EVERY) !== null);
  assert.equal(j.step, 'strip', 'the gate is open and the forms are on');
  assert.ok(foundationRead.gates(sim.state, jobId).strip);
  assert.equal(foundationRead.finish(sim.state, jobId).unstripped, 4);
  const r0 = sim.commandNow('foundation.strip', { jobId, x: 40, z: 39.2, n: 4 });
  assert.ok(r0.ok && r0.boards === 1 && r0.run === 0 && r0.stakes >= 2 && r0.runDone && !r0.all, JSON.stringify(r0));
  assert.equal(stk.form_board, boards0 + 1);
  assert.ok(stk.form_stake >= stakes0 + r0.stakes);
  assert.equal(sim.commandNow('foundation.strip', { jobId, run: 0 }).reason, 'That side is already stripped');
  let r;
  for (let k = 1; k < 4; k++) r = sim.commandNow('foundation.strip', { jobId, run: k, n: 2 });
  assert.ok(r.all && j.stripped === 1, JSON.stringify(r));
  assert.equal(j.step, 'cure');
  assert.equal(stk.form_board, boards0 + 4);
  assert.equal(stk.form_stake, stakes0 + j.forms.runs.reduce((a, q) => a + q.driven.filter(Boolean).length, 0));
  assert.equal(sim.commandNow('foundation.strip', { jobId }).reason, 'The forms are off');
  // saved mid-way and loaded: the same
  const copy = createGameSim(7); copy.load(sim.serialize());
  sim.runTicks(300); copy.runTicks(300);
  assert.equal(copy.hash(), sim.hash());
  // the cure carries on to done, with the bolts in
  for (let k = 0; k < 10; k++) sim.commandNow('foundation.setBolt', { jobId });
  sim.setYearDays(20);
  sim.runDays(40);
  assert.equal(foundationRead.job(sim.state, jobId).step, 'done');
});

test('an edger along an unstaked side marks cells; an unedged side chips when its board comes off', () => {
  const { sim, jobId } = screeded();
  assert.match(sim.commandNow('foundation.finishAt', { jobId, x: 40, z: 38, kind: 'edge' }).reason, /along a form/);
  let e;
  for (let x = 39; x <= 41; x += 0.2) e = sim.commandNow('foundation.finishAt', { jobId, x, z: 39.2, kind: 'edge', r: 0.2 });
  assert.ok(e.ok && e.edge > 0.2 && e.run === 0, JSON.stringify(e));
  sim.commandNow('foundation.finish', { jobId });
  const j = foundationRead.job(sim.state, jobId);
  for (const q of j.elements) CU.ageTo(q.cure, 24 * 1.5);
  sim.runTicks(CC.CURE_EVERY);
  assert.equal(sim.commandNow('foundation.strip', { jobId, run: 0 }).chipped, false);
  assert.equal(sim.commandNow('foundation.strip', { jobId, run: 1 }).chipped, true);
  assert.equal(foundationRead.finish(sim.state, jobId).chips, 1);
});
