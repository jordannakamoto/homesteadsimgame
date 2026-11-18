// Layout and dig to the line (slice B2), headless: corners staked close the strings, the dig is read from the ground,
// the flat of the shovel trims to the line once most of it is dug (earth pushed out, none lost), and a finished dig
// completes the building's site stage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameSim, foundationRead, groundRead } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
import { clipConvex } from '../src/sim/foundation.js';

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
const CORNERS = [[38.5, 38.8], [41.5, 38.8], [41.5, 41.2], [38.5, 41.2]];
const TARGET = -0.08;
function start() {
  const sim = createGameSim(5);
  assert.ok(sim.commandNow('construction.setPlan', slabPlan()).ok);
  const r = sim.commandNow('foundation.setPlan', { structId: SID, corners: CORNERS, digs: [{ poly: CORNERS, targetY: TARGET }], topY: 0.12 });
  assert.ok(r.ok, r.reason);
  return { sim, jobId: r.jobId };
}
const job = (sim, id) => foundationRead.job(sim.state, id);
const site = (sim) => Object.values(sim.state.sys.construction.progress[SID].members).filter((m) => m.kind === 'site');

test('staking every corner closes the strings and starts the dig', () => {
  const { sim, jobId } = start();
  assert.equal(job(sim, jobId).step, 'layout');
  assert.equal(sim.commandNow('foundation.check', { jobId }).step, 'layout');
  for (let k = 0; k < 3; k++) assert.equal(sim.commandNow('foundation.stake', { jobId, corner: k }).closed, false);
  assert.equal(sim.commandNow('foundation.stake', { jobId, corner: 9 }).ok, false);
  assert.equal(sim.commandNow('foundation.stake', { jobId, corner: 3 }).closed, true);
  assert.equal(job(sim, jobId).step, 'excavate');
  assert.equal(sim.commandNow('foundation.stake', { jobId, corner: 0 }).ok, false);
  // the plan sent again with the same corners keeps the layout; moved corners lay it out again
  sim.commandNow('foundation.setPlan', { structId: SID, corners: CORNERS, digs: [{ poly: CORNERS, targetY: TARGET }] });
  assert.equal(job(sim, jobId).step, 'excavate');
  const moved = CORNERS.map(([x, z]) => [x + 1, z]);
  sim.commandNow('foundation.setPlan', { structId: SID, corners: moved, digs: [{ poly: moved, targetY: TARGET }] });
  assert.equal(job(sim, jobId).step, 'layout');
  assert.ok(job(sim, jobId).layout.corners.every((c) => !c[2]));
});

test('dig to the line: read from the ground, trimmed once mostly dug, earth kept, site stage finished', () => {
  const { sim, jobId } = start();
  for (let k = 0; k < 4; k++) sim.commandNow('foundation.stake', { jobId, corner: k });
  let c = sim.commandNow('foundation.check', { jobId });
  assert.equal(c.frac, 0);
  assert.match(sim.commandNow('foundation.trim', { jobId, x0: 39, z0: 40, x1: 41, z1: 40 }).reason, /Dig more/);
  // dug roughly (within a shovel's few centimetres) everywhere: trimming is allowed though little is on the line
  const s2 = createGameSim(5);
  assert.ok(s2.commandNow('construction.setPlan', slabPlan()).ok);
  const j2 = s2.commandNow('foundation.setPlan', { structId: SID, corners: CORNERS, digs: [{ poly: CORNERS, targetY: TARGET }] }).jobId;
  for (let k = 0; k < 4; k++) s2.commandNow('foundation.stake', { jobId: j2, corner: k });
  s2.commandNow('ground.trim', { region: { poly: CORNERS }, targetY: TARGET + 0.05 });
  const c2 = s2.commandNow('foundation.check', { jobId: j2 });
  assert.ok(c2.frac < 0.1 && c2.rough > 0.97, JSON.stringify(c2));
  assert.ok(s2.commandNow('foundation.trim', { jobId: j2, x0: 39, z0: 40, x1: 41, z1: 40 }).m3 > 0.01);
  // most of it dug (a strip along the east edge left), as a shovel would leave it
  assert.ok(sim.commandNow('ground.trim', { region: { poly: [[38.5, 38.8], [41.1, 38.8], [41.1, 41.2], [38.5, 41.2]] }, targetY: TARGET }).ok);
  c = sim.commandNow('foundation.check', { jobId });
  assert.ok(c.frac >= 0.85 && c.frac < 0.97, 'mostly dug: ' + c.frac);
  assert.ok(c.rough >= 0.85, 'roughly dug: ' + c.rough);
  assert.ok(site(sim).every((m) => !m.built));
  const before = groundRead.netVolume(sim.state);
  // push strokes along the remaining strip, eastward: the earth goes out past the east edge
  let m3 = 0;
  for (const z of [38.9, 39.15, 39.4, 39.65, 39.9, 40.15, 40.4, 40.65, 40.9, 41.15]) { const r = sim.commandNow('foundation.trim', { jobId, x0: 40.9, z0: z, x1: 41.6, z1: z }); assert.ok(r.ok, r.reason); m3 += r.m3; }
  assert.ok(m3 > 0.01, 'trimmed ' + m3);
  assert.ok(Math.abs(groundRead.netVolume(sim.state) - before) < 1e-6, 'no earth lost');
  assert.ok(groundRead.surfaceY(sim.state, 41.85, 40) > 0.005, 'a spoil ridge past the edge');
  c = sim.commandNow('foundation.check', { jobId });
  assert.ok(c.frac >= 0.97, 'dug: ' + c.frac);
  assert.equal(c.advanced, true);
  assert.equal(job(sim, jobId).step, 'base');
  assert.ok(site(sim).length > 0 && site(sim).every((m) => m.built), 'the site stage is done');
});

test('clipping a stroke to an outline', () => {
  const sq = [[0, 0], [2, 0], [2, 2], [0, 2]];
  const r = clipConvex(sq, [[1, -1], [3, -1], [3, 1], [1, 1]]);
  let A = 0; for (let a = 0, b = r.length - 1; a < r.length; b = a++) A += (r[b][0] + r[a][0]) * (r[b][1] - r[a][1]);
  assert.ok(Math.abs(Math.abs(A / 2) - 1) < 1e-9);
  assert.equal(clipConvex(sq, [[5, 5], [6, 5], [6, 6], [5, 6]]).length, 0);
});
