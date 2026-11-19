// Foundation system skeleton (src/sim/foundation.js), headless: a slab building's foundation becomes a job, a
// sandbox pour cures on the sim clock and holds framing ("still green") until the frame gate, then lets it go.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameSim, foundationRead } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
import * as CC from '../src/sim/content/concrete.js';

const shed = JSON.parse(readFileSync(new URL('./helpers/shed-plan.json', import.meta.url), 'utf8'));
const SID = shed.struct;
// the tool shed, with its pier-block foundation swapped for a slab on a gravel bed with thickened edges
function slabPlan() {
  const pieces = shed.pieces.filter((p) => p.stage !== 'foundation' || p.kind === 'foundation');
  const fd = shed.pieces.find((p) => p.stage === 'foundation' && p.kind === 'foundation').id, mk = (id, kind, length) => ({ id: fd + '.' + id, struct: SID, stage: 'foundation', kind, parent: fd, length });
  const slab = [mk('g0', 'footing', 3), mk('ft1', 'footing', 3), mk('ft2', 'footing', 2.4), mk('ft3', 'footing', 3), mk('ft4', 'footing', 2.4), mk('sl5', 'slab', 3)];
  const lines = shed.materialsList.filter((l) => l.stage !== 'foundation');
  lines.push({ key: 'foundation|gravel', stage: 'foundation', itemId: 'gravel', qty: 0.72, unit: 'm3', label: 'Gravel', count: 1, members: [[slab[0].id, 0.72]] });
  lines.push({ key: 'foundation|concrete', stage: 'foundation', itemId: 'concrete_mix', qty: 2500, unit: 'kg', label: 'Concrete mix', count: 5, members: slab.slice(1).map((m, n) => [m.id, n < 4 ? 0.25 : 0.72]) });
  const site = pieces.find((p) => p.stage === 'site');
  const all = pieces.map((p) => (p === site ? { ...p, built: 1 } : p)).concat(slab);
  return K.planFromPieces(SID, all, lines, { name: 'Slab shed', x: 40, z: 40, r: 2 });
}
function start() {
  const sim = createGameSim(11);
  sim.setYearDays(20);
  assert.ok(sim.commandNow('construction.setPlan', slabPlan()).ok);
  return sim;
}
const pr = (sim) => sim.state.sys.construction.progress[SID];
const firstOf = (sim, stage) => Object.keys(pr(sim).members).find((id) => pr(sim).members[id].stage === stage);

test('a slab building becomes a foundation job; a pier-block shed does not', () => {
  const sim = start();
  const r = sim.commandNow('foundation.setPlan', { structId: SID });
  assert.ok(r.ok, r.reason);
  const job = foundationRead.job(sim.state, r.jobId);
  assert.equal(job.type, 'slab');
  assert.equal(job.step, 'layout');
  assert.deepEqual(job.elements.map((e) => e.kind).sort(), ['slab', 'strip', 'strip', 'strip', 'strip']);
  assert.equal(job.baseIds.length, 1);
  assert.equal(foundationRead.jobFor(sim.state, SID).id, r.jobId);
  // sent again: same job, progress kept by element id
  job.elements[0].dig.frac = 0.5;
  const again = sim.commandNow('foundation.setPlan', { structId: SID });
  assert.equal(again.jobId, r.jobId);
  assert.equal(foundationRead.job(sim.state, r.jobId).elements[0].dig.frac, 0.5);
  // nothing is held before the pour
  assert.ok(!(pr(sim).keep || {}).hold || !Object.keys((pr(sim).keep || {}).hold).length);

  const piers = createGameSim(3);
  assert.ok(piers.commandNow('construction.setPlan', K.planFromPieces(SID, shed.pieces, shed.materialsList, { x: 40, z: 40, r: 2 })).ok);
  assert.equal(piers.commandNow('foundation.setPlan', { structId: SID }).reason, 'not a poured foundation');
  assert.equal(piers.commandNow('foundation.setPlan', {}).reason, 'no building');
});

test('a sandbox pour finishes the foundation stage, then framing waits for the frame gate', () => {
  const sim = start();
  const { jobId } = sim.commandNow('foundation.setPlan', { structId: SID });
  const r = sim.commandNow('foundation.debugPour', { jobId });
  assert.ok(r.ok, r.reason);
  assert.equal(sim.commandNow('foundation.debugPour', { jobId }).reason, 'already poured');
  assert.ok(K.stageComplete(pr(sim), 'foundation'), 'the slab and its base count as built');
  const joist = firstOf(sim, 'floor-frame'), stud = firstOf(sim, 'wall-frame');
  assert.equal(K.blocked(pr(sim), joist), CC.GATE_SAYS.frame);
  assert.equal(K.blocked(pr(sim), stud), CC.GATE_SAYS.frame);
  assert.equal(K.stageOpen(pr(sim), 'floor-frame'), false);
  const ins = sim.commandNow('construction.install', { structId: SID, memberIds: [joist] });
  assert.equal(ins.refused[0].reason, CC.GATE_SAYS.frame);
  assert.equal(ins.refused[0].held, 1);
  assert.equal(foundationRead.gates(sim.state, jobId).frame, false);

  // a plan sent again (build mode does this on every edit) loses the hold; the next cure step puts it back
  assert.ok(sim.commandNow('construction.setPlan', slabPlan()).ok);
  sim.runTicks(CC.CURE_EVERY);
  assert.equal(K.blocked(pr(sim), joist), CC.GATE_SAYS.frame);

  // cure on the clock until the gate opens (a 20-day year: a few world hours, depending on the weather)
  let hours = 0, gates = [];
  const off = sim.listen((type, d) => { if (type === 'foundation.gate') gates.push(d.gate); });
  while (!foundationRead.gates(sim.state, jobId).frame && hours < 72) { sim.runTicks(60); hours++; }
  off();
  const v = foundationRead.jobView(sim.state, jobId);
  assert.ok(v.gates.frame, 'frame gate open after ' + hours + ' h, strength ' + v.strength);
  assert.ok(hours >= 2 && hours <= 30, 'frame gate after ' + hours + ' world hours');
  if (process.env.SHOW) console.log('frame gate after', hours, 'world hours');
  assert.deepEqual(gates, ['walk', 'strip', 'frame']);
  assert.ok(v.strength >= CC.CURE_GATES.frame && v.strength < 0.6);
  assert.equal(v.held, null);
  assert.equal(K.blocked(pr(sim), joist), null);
  assert.ok(K.stageOpen(pr(sim), 'floor-frame'));
  assert.ok(!Object.keys((pr(sim).keep || {}).hold).length);

  // the cure is followed until 28 days equivalent, then the job is done and nothing is stepped
  sim.runDays(3);
  assert.equal(foundationRead.job(sim.state, jobId).step, 'done');
  assert.ok(foundationRead.cureOf(sim.state, jobId).strength > 0.95);
});

test('forget releases the holds; saves and replays carry the cure', () => {
  const sim = start();
  const { jobId } = sim.commandNow('foundation.setPlan', { structId: SID });
  sim.commandNow('foundation.debugPour', { jobId });
  sim.runTicks(120);
  const copy = createGameSim(11);
  copy.load(sim.serialize());
  sim.runTicks(300); copy.runTicks(300);
  assert.equal(copy.hash(), sim.hash());
  assert.ok(sim.commandNow('foundation.forget', { structId: SID }).ok);
  assert.equal(foundationRead.jobFor(sim.state, SID), null);
  assert.ok(!Object.keys((pr(sim).keep || {}).hold).length);
  assert.equal(sim.commandNow('construction.setHold', { structId: SID, stage: 'nope', reason: 'x' }).reason, 'unknown stage');
  assert.equal(sim.commandNow('construction.setHold', { structId: 999, stage: 'roofing', reason: 'x' }).reason, 'unknown building');
});
