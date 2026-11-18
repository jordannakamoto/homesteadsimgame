// Gravel base, forms, barrow mixing and the pour (slices B3 and B4), headless: gravel tipped, raked and tamped twice
// is read from the ground; form boards and stakes go on the strings; bags and water make a mix whose water/cement
// ratio decides how it slumps and whether it screeds; the screed rides the forms with a ridge ahead of it; an
// unstaked form bows and leaks; the screeded slab starts to cure and holds framing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameSim, foundationRead, groundRead, earthwork as EW } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
import * as CC from '../src/sim/content/concrete.js';
import * as BA from '../src/sim/core/batch.js';

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

test('batch: parts, room, work, ratio bands and discharge', () => {
  const b = BA.newBatch({ capM3: 0.051 });
  assert.equal(BA.add(b, 'mix', 36 * 4, { m3Each: 0.017 / 36 }), 108);   // three bags fit, not four
  assert.equal(BA.room(b), 0);
  BA.add(b, 'water', 9, { clock: 100 });
  assert.equal(b.t0, 100);
  const Q = { num: 'water', den: 'mix', k: 5.4 / 36, bands: CC.MIX.bands };
  assert.equal(BA.quality(b, Q).band.id, 'good');
  BA.add(b, 'water', 2);
  assert.equal(BA.quality(b, Q).band.id, 'wet');
  assert.ok(BA.work(b, 1, 100) > 0);
  const d = BA.discharge(b, 0.02);
  assert.ok(Math.abs(d.m3 - 0.02) < 1e-9 && Math.abs(d.parts.mix + b.parts.mix - 108) < 1e-6);
  BA.discharge(b, 1);
  assert.ok(BA.isEmpty(b) && b.t0 === null);
});

test('the base: gravel heaps, raked and tamped twice, read from the ground; then the forms', () => {
  const { sim, jobId } = start();
  assert.match(sim.commandNow('foundation.setForm', { jobId, run: 0, n: 1 }).reason, /base goes in first/);
  let c = sim.commandNow('foundation.check', { jobId });
  assert.equal(c.gravel, 0); assert.equal(c.compact, 0);
  laybase(sim, jobId, { tampPasses: 0 });
  c = sim.commandNow('foundation.check', { jobId });
  assert.ok(c.gravel > 0.9 && c.level > 0.85, JSON.stringify(c));
  assert.equal(c.compact, 0, 'loose gravel');
  assert.equal(c.step, 'base');
  for (let z = 39.25; z <= 40.76; z += 0.3) for (let x = 39.05; x <= 40.96; x += 0.3) sim.commandNow('landscape.tamp', { x, z });
  c = sim.commandNow('foundation.check', { jobId });
  assert.ok(c.compact > 0.1 && c.compact < 0.9, 'tamped once, thinly: ' + c.compact);
  for (let p = 0; p < 2; p++) for (let z = 39.25; z <= 40.76; z += 0.12) for (let x = 39.05; x <= 40.96; x += 0.12) sim.commandNow('landscape.tamp', { x, z });
  c = sim.commandNow('foundation.check', { jobId });
  assert.ok(c.compact >= 0.9, 'tamped twice: ' + c.compact);
  assert.equal(c.step, 'forms', JSON.stringify(c));
  const pr = sim.state.sys.construction.progress[SID], bed = Object.keys(pr.members).find((id) => id.endsWith('.g0'));
  assert.equal(pr.members[bed].built, 1, 'the gravel bed member is finished');
  const j = job(sim, jobId);
  assert.equal(j.forms.runs.length, 4);
  assert.deepEqual(j.forms.runs.map((r) => r.boards), [1, 1, 1, 1]);
  assert.ok(j.forms.runs.every((r) => r.stakes.length >= 2 && r.stakes.every((s, i) => i === 0 || s - r.stakes[i - 1] <= CC.FORMS.stakeEveryM + 1e-9)));
  // boards snap to a run, `gesture` at a time; stakes need their board
  assert.match(sim.commandNow('foundation.stakeForm', { jobId, run: 1, n: 1 }).reason, /boards on this side/);
  const f = sim.commandNow('foundation.setForm', { jobId, x: 40, z: 39.1, n: 3 });
  assert.equal(f.run, 0); assert.equal(f.set, 1);
  for (let k = 1; k < 4; k++) sim.commandNow('foundation.setForm', { jobId, run: k, n: 2 });
  assert.equal(job(sim, jobId).step, 'forms', 'stakes still to drive');
  const before = sim.state.sys.stock.items.form_stake;
  const st = sim.commandNow('foundation.stakeForm', { jobId, x: 40, z: 39.1, n: 3 });
  assert.equal(st.driven.length, 3);
  assert.equal(sim.state.sys.stock.items.form_stake, before - 3);
  for (let k = 0; k < 4; k++) sim.commandNow('foundation.stakeForm', { jobId, run: k, n: 4 });
  assert.equal(job(sim, jobId).step, 'pour');
  assert.equal(foundationRead.jobView(sim.state, jobId).forms.driven, foundationRead.jobView(sim.state, jobId).forms.stakes);
});

// straight to the pour: base laid by the ground system, forms set
function formed({ stake = true } = {}) {
  const { sim, jobId } = start();
  const j = job(sim, jobId);
  j.step = 'forms'; j.forms = null;
  sim.commandNow('ground.fill', { x: 40, z: 40, r: 0.1, m3: 0 });
  // the base: the dig filled back to the base line (the fine ground) and the forms made
  assert.ok(sim.commandNow('ground.trim', { region: { poly: CORNERS }, targetY: BASEY }).ok);
  const g = sim.state.sys.landscape.grid;
  for (const [, , h, , , , , t, n] of EW.worked(g, 0)) t.h[n] = Math.max(t.h[n], Math.round(-0)), void h;
  return { sim, jobId, stake };
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

test('mixing in the barrow: bags, water, hoe; the water/cement ratio is read back', () => {
  const { sim, jobId } = readyToPour();
  assert.match(sim.commandNow('foundation.mix', { jobId, waterL: 3 }).reason, /Bags in first/);
  const kg0 = sim.state.sys.stock.items.concrete_mix;
  let r = sim.commandNow('foundation.mix', { jobId, bags: 4 });
  assert.equal(r.mix.bags, 3, 'the barrow takes three bags');
  assert.equal(sim.state.sys.stock.items.concrete_mix, kg0 - 108);
  assert.match(sim.commandNow('foundation.tip', { jobId, x: 40, z: 40 }).reason, /dry powder/);
  r = sim.commandNow('foundation.mix', { jobId, waterL: 5 });
  assert.equal(r.mix.band, 'dry');
  r = sim.commandNow('foundation.mix', { jobId, work: 1 });
  assert.match(sim.commandNow('foundation.tip', { jobId, x: 40, z: 40 }).reason, /Hoe it through/);
  r = sim.commandNow('foundation.mix', { jobId, waterL: 4 });
  assert.equal(r.mix.band, 'good');
  r = sim.commandNow('foundation.mix', { jobId, waterL: 2 });
  assert.equal(r.mix.band, 'wet');
  for (let k = 0; k < 12; k++) r = sim.commandNow('foundation.mix', { jobId, work: 0.5 });
  assert.equal(r.mix.mixed, 1);
});

test('wetter mixes slump flatter; a dry mix tears under the screed', () => {
  const heights = {};
  for (const w of [2.0, 3.0, 4.4]) {
    const { sim, jobId } = readyToPour();
    const m = mixBatch(sim, jobId, w);
    const r = sim.commandNow('foundation.tip', { jobId, x: 40, z: 40 });
    assert.ok(r.ok, r.reason);
    assert.equal(r.band, m.band);
    heights[m.band] = EW.reliefAt(foundationRead.pourGrid(sim.state, jobId), 40, 40);
  }
  assert.ok(heights.dry > heights.good && heights.good > heights.soupy, JSON.stringify(heights));
  // dry all through: the board passes but it will not close up
  const { sim, jobId } = readyToPour();
  for (let k = 0; k < 4; k++) { mixBatch(sim, jobId, 2.0); sim.commandNow('foundation.tip', { jobId, x: 39.4 + (k % 2) * 1.2, z: 39.6 + (k > 1 ? 0.8 : 0) }); }
  const s = sim.commandNow('foundation.screed', { jobId, x0: 39.0, z0: 40, x1: 41, z1: 40 });
  assert.ok(s.ok, s.reason);
  assert.ok(s.screed < 0.2, 'a dry mix does not screed: ' + s.screed);
});

test('the pour: tip, rake, screed with a ridge riding ahead; volume kept; cure starts and holds framing', () => {
  const { sim, jobId } = readyToPour();
  const need = foundationRead.jobView(sim.state, jobId);
  let placed = 0, n = 0;
  const spots = [[39.4, 39.6], [40, 39.6], [40.6, 39.6], [39.4, 40.4], [40, 40.4], [40.6, 40.4]];
  // a little over the volume (a screed needs surplus to fill its hollows)
  while (placed < 0.33 && n < 30) {
    mixBatch(sim, jobId, 3.0);
    const r = sim.commandNow('foundation.tip', { jobId, x: spots[n % 6][0], z: spots[n % 6][1] });
    assert.ok(r.ok, r.reason);
    assert.deepEqual(r.leaking, []);
    placed = r.placed; n++;
  }
  assert.ok(Math.abs(foundationRead.jobView(sim.state, jobId).pour.needM3 - 0.32) < 0.01, 'needs 2 x 1.6 x 0.1 m');
  const g = foundationRead.pourGrid(sim.state, jobId), vol = () => EW.netVolume(g);
  assert.ok(Math.abs(vol() - placed) < 1e-6, 'all of it is in the grid');
  for (let z = 39.3; z <= 40.7; z += 0.2) for (let x = 39.1; x <= 40.9; x += 0.2) sim.commandNow('foundation.rake', { jobId, x, z });
  assert.ok(Math.abs(vol() - placed) < 2e-3, 'raking keeps it: ' + vol() + ' vs ' + placed);
  // the board drawn along the long side, in strokes: the ridge rides ahead
  let s, ridgeAhead = 0;
  for (let x = 39.0; x < 40.95; x += 0.5) {
    s = sim.commandNow('foundation.screed', { jobId, x0: x, z0: 40, x1: Math.min(41, x + 0.5), z1: 40 });
    assert.ok(s.ok, s.reason);
    if (x < 40.4) ridgeAhead = Math.max(ridgeAhead, s.m3);
    if (s.done) break;
  }
  assert.ok(ridgeAhead > 0.003, 'a ridge of surplus rolls ahead of the board: ' + ridgeAhead);
  assert.ok(Math.abs(vol() - placed) < 2e-3, 'the screed moves concrete, it does not lose it');
  if (!s.done) {
    // what is left at the far end is pulled back over the hollows
    for (let x = 41; x > 39.05 && !s.done; x -= 0.5) s = sim.commandNow('foundation.screed', { jobId, x0: x, z0: 40, x1: x - 0.5, z1: 40 });
  }
  assert.ok(s.done, 'screeded: ' + JSON.stringify(s));
  const j = job(sim, jobId);
  assert.equal(j.step, 'cure');
  assert.ok(j.elements.every((e) => e.cure && e.cure.cap > 0.95), 'a right mix: full strength to come');
  const pr = sim.state.sys.construction.progress[SID];
  assert.ok(K.stageComplete(pr, 'foundation'));
  const joist = Object.keys(pr.members).find((id) => pr.members[id].stage === 'floor-frame') || Object.keys(pr.members).find((id) => pr.members[id].stage === 'wall-frame');
  assert.equal(K.blocked(pr, joist), CC.GATE_SAYS.frame);
  // the hold is kept when build mode sends the plan again
  assert.ok(sim.commandNow('construction.setPlan', slabPlan()).ok);
  assert.equal(K.blocked(sim.state.sys.construction.progress[SID], joist), CC.GATE_SAYS.frame);
  // saved and loaded mid-cure: the same
  const copy = createGameSim(7); copy.load(sim.serialize());
  sim.runTicks(200); copy.runTicks(200);
  assert.equal(copy.hash(), sim.hash());
});

test('an unstaked form bows under the concrete and leaks; staking it stops the leak', () => {
  const { sim, jobId } = readyToPour({ stake: false });
  // the east and west short sides staked, the long south side (2 m) left free
  for (const k of [1, 2, 3]) sim.commandNow('foundation.stakeForm', { jobId, run: k, n: 4 });
  assert.equal(job(sim, jobId).step, 'forms');
  let r, leaked = false;
  for (let n = 0; n < 6; n++) {
    mixBatch(sim, jobId, 3.4);
    r = sim.commandNow('foundation.tip', { jobId, x: 39.6 + (n % 3) * 0.4, z: 39.5 });
    assert.ok(r.ok, r.reason);
    if (r.leaking.includes(0)) leaked = true;
  }
  const j = job(sim, jobId);
  assert.ok(leaked, 'the free board bowed: ' + j.forms.runs[0].bow);
  assert.ok(j.forms.runs[0].bow > CC.FORMS.leakBowM);
  assert.ok(j.pour.leakM3 > 0, 'concrete ran out under it');
  assert.ok(EW.reliefAt(j.pour.grid, 40, 39.05) > 0.002 || EW.reliefAt(j.pour.grid, 40, 38.95) > 0.002, 'outside the line');
  const st = sim.commandNow('foundation.stakeForm', { jobId, run: 0, n: 4 });
  assert.ok(st.ok && !st.leaking);
  assert.equal(job(sim, jobId).forms.runs[0].leak, null);
  const lost = j.pour.leakM3;
  mixBatch(sim, jobId, 3.4);
  r = sim.commandNow('foundation.tip', { jobId, x: 40, z: 39.5 });
  assert.equal(r.leakM3, 0);
  assert.equal(job(sim, jobId).pour.leakM3, lost);
});
