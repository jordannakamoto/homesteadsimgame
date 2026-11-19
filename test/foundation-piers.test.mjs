// Piers and stem walls (slice B-1), headless: the foundation system makes its own jobs from the members a building's
// plan carries (no page), poured piers are bored to the frost line, formed with plumbed tubes, filled, rodded and
// bracketed, and carry their beams once cured; a stem wall's trench is dug to the line, its footing poured, its wall
// forms set and tied, the wall poured and bolted, and stripped at a fifth strength. No debugPour anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/framing.js';
import { createGameSim, foundationRead, groundRead } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
import * as CC from '../src/sim/content/concrete.js';

const F = globalThis.__framing;
const SID = 7, OX = 40, OZ = 40, Y = 0.45;
// a 2.4 x 3 m building's floor and what it stands on, as build mode hands it to construction.setPlan (world pieces)
function plan(found, { y = Y } = {}) {
  const out = [];
  F.floorMembers(out, { id: 'p1', outline: [[0, 0], [2.4, 0], [2.4, 3], [0, 3]], y0: 0, ground: true, groundY: () => -0.45 }, found, { joists: 0.4 });
  const pieces = out.map((m) => {
    const ax = m.b[0] - m.a[0], ay = m.b[1] - m.a[1], az = m.b[2] - m.a[2], al = Math.hypot(ax, ay, az) || 1, wy = (az * m.n[0] - ax * m.n[2]) / al;
    const e = (Math.abs(m.n[1]) * m.section.d + Math.abs(wy) * m.section.b) / 2;
    return { id: m.id, struct: SID, storey: 0, kind: m.kind, type: m.type, material: m.material, stage: m.stage, parent: m.parent, section: m.section, length: m.length,
      a: { x: OX + m.a[0], z: OZ + m.a[2] }, b: { x: OX + m.b[0], z: OZ + m.b[2] }, y0: y + Math.min(m.a[1], m.b[1]) - e, y1: y + Math.max(m.a[1], m.b[1]) + e, volume: m.volume, built: false };
  });
  return K.planFromPieces(SID, pieces, F.materialsList(out), { name: found + ' cabin', x: OX + 1.2, z: OZ + 1.5, r: 2 });
}
const job = (sim) => foundationRead.jobFor(sim.state, SID);
const pr = (sim) => sim.state.sys.construction.progress[SID];
function start(found, seed = 9) {
  const sim = createGameSim(seed);
  sim.setYearDays(20);
  assert.ok(sim.commandNow('construction.setPlan', plan(found)).ok);
  return sim;
}
const stakeAll = (sim) => { const j = job(sim); j.layout.corners.forEach((c, k) => sim.commandNow('foundation.stake', { jobId: j.id, corner: k })); };
function mixBatch(sim, bags = 3) {
  const j = job(sim);
  sim.commandNow('foundation.mix', { jobId: j.id, bags }); sim.commandNow('foundation.mix', { jobId: j.id, waterL: 3 * bags });
  for (let k = 0; k < 10; k++) sim.commandNow('foundation.mix', { jobId: j.id, work: 0.6 });
}
// fill an element to the top from the barrow, rodding when it reads full, until it is in
function fillUp(sim, x, z) {
  const j = job(sim);
  let r, rods = 0;
  for (let k = 0; k < 40; k++) {
    if (!sim.state.sys.foundation.carry) mixBatch(sim);
    r = sim.commandNow('foundation.fill', { jobId: j.id, x, z });
    if (r.ok && r.full) return { r, rods };
    if (r.ok && r.rod || (!r.ok && /rod it/.test(r.reason))) { const q = sim.commandNow('foundation.rod', { jobId: j.id, x, z }); assert.ok(q.ok, q.reason); rods++; if (q.full) return { r: q, rods }; continue; }
    assert.ok(r.ok, r.reason);
  }
  throw new Error('never filled: ' + JSON.stringify(r));
}
const stock = (sim, items) => { for (const [id, qty] of Object.entries(items)) sim.commandNow('stock.add', { id, qty }); };

test('jobs come from the plan: piers and stem walls laid out from their members, forgotten with the building', () => {
  const sim = start('piers');
  const j = job(sim);
  assert.ok(j, 'a pier building put up becomes a job with no page');
  assert.equal(j.type, 'piers');
  assert.equal(j.step, 'layout');
  assert.equal(j.layout.corners.length, 4);
  const piers = j.elements.filter((e) => e.kind === 'pier');
  assert.equal(piers.length, 6);
  assert.ok(piers.every((e) => e.memberIds.length === 2), 'each pier stands for its column and its footing pad');
  assert.ok(j.timber.length >= 2, 'the beams on the piers are the job\'s to set');
  // frost: the temperate site's 1.2 m, deeper than the plan's footing (0.75 m)
  const h = piers[0].hole;
  assert.ok(Math.abs(h.gy - h.botY - CC.FROST_DEPTH_M.temperate) < 1e-6, 'hole to the frost line: ' + (h.gy - h.botY));
  assert.equal(h.planCm, 75);
  assert.ok(h.need > 0.09 && h.need < 0.2, 'a pier and its footing take about 0.1 m3: ' + h.need);
  // sent again: the same job, progress kept
  piers[0].hole.dug = 0.3;
  assert.ok(sim.commandNow('construction.setPlan', plan('piers')).ok);
  assert.equal(job(sim).id, j.id);
  assert.equal(job(sim).elements.find((e) => e.id === piers[0].id).hole.dug, 0.3);
  // changed to pier blocks: not poured, the job goes; to a stem wall: a new job of that kind
  assert.ok(sim.commandNow('construction.setPlan', plan('pier-blocks')).ok);
  assert.equal(job(sim), null);
  assert.ok(sim.commandNow('construction.setPlan', plan('stemwall')).ok);
  const w = job(sim);
  assert.equal(w.type, 'stemwall');
  assert.deepEqual([...new Set(w.elements.map((e) => e.kind))].sort(), ['strip', 'wall']);
  assert.equal(w.digs.length, 4);
  assert.ok(w.digs.every((d) => Math.abs(d.targetY + CC.FROST_DEPTH_M.temperate) < 1e-6), 'trenches to the frost line');
  const wall = w.elements.find((e) => e.kind === 'wall').run;
  assert.ok(wall.h > 1.2 && wall.panelsNeed >= 2 && wall.tieRows >= 2, JSON.stringify(wall));
  // the building removed
  assert.ok(sim.commandNow('construction.forget', { structId: SID }).ok);
  assert.equal(job(sim), null);
  // a sandbox build, or a slab (no geometry), does not make one
  const sb = createGameSim(2);
  sb.commandNow('construction.setOption', { key: 'sandbox', value: true });
  sb.commandNow('construction.setPlan', plan('piers'));
  assert.equal(foundationRead.jobFor(sb.state, SID), null);
  // a cold site digs deeper; a frost-free one keeps the plan's depth
  const cold = createGameSim(3);
  cold.state.sys.weather.site.climate = 'cold-continental';
  cold.commandNow('construction.setPlan', plan('piers'));
  const ch = foundationRead.jobFor(cold.state, SID).elements[0].hole;
  assert.ok(Math.abs(ch.gy - ch.botY - 1.35) < 1e-6);
  const warm = createGameSim(3);
  warm.state.sys.weather.site.climate = 'mediterranean-coast';
  warm.commandNow('construction.setPlan', plan('piers'));
  const wh = foundationRead.jobFor(warm.state, SID).elements[0].hole;
  assert.ok(Math.abs(wh.gy - wh.botY - 0.75) < 1e-6);
});

test('piers by hand: bored to the frost line, tubes plumbed, filled and rodded, brackets wet-set, beams on', () => {
  const sim = start('piers');
  stakeAll(sim);
  const j = job(sim), id = j.id, piers = () => job(sim).elements.filter((e) => e.kind === 'pier');
  assert.equal(j.step, 'excavate');
  const at = piers()[0].hole;
  { const q = sim.commandNow('foundation.bore', { jobId: id, x: at.x, z: at.z }); if (process.env.DBG) console.log(q); assert.match(q.reason, /post-hole digger/); }
  stock(sim, { post_hole_digger: 1, wheelbarrow: 1 });
  assert.match(sim.commandNow('foundation.bore', { jobId: id, x: at.x + 6, z: at.z }).reason, /pier mark/);
  const vol0 = groundRead.netVolume(sim.state);
  // three holes a gesture: each twist and lift takes a bite out of each
  let r, gestures = 0;
  for (const e of piers()) while (!(job(sim).elements.find((q) => q.id === e.id).hole.dug >= e.hole.gy - e.hole.botY - 1e-6)) { r = sim.commandNow('foundation.bore', { jobId: id, x: e.hole.x, z: e.hole.z, n: 3 }); assert.ok(r.ok, r.reason); gestures++; if (job(sim).step !== 'excavate') break; }
  assert.equal(job(sim).step, 'forms', 'bored: the tube forms next');
  assert.ok(gestures <= 20, gestures + ' gestures for six holes at three a gesture');
  assert.ok(Math.abs(groundRead.netVolume(sim.state) - vol0) < 1e-6, 'every plug of earth is beside its hole');
  assert.ok(groundRead.surfaceY(sim.state, at.x, at.z) < -0.5, 'the hole is in the ground: ' + groundRead.surfaceY(sim.state, at.x, at.z));
  assert.ok(pr(sim).members[Object.keys(pr(sim).members).find((k) => pr(sim).members[k].kind === 'site')].built, 'the site stage is done with the dig');
  // tubes: none in stock, then set four and two
  assert.match(sim.commandNow('foundation.setTube', { jobId: id, x: at.x, z: at.z }).reason, /tube forms/);
  stock(sim, { tube_form: 3 });
  const t1 = sim.commandNow('foundation.setTube', { jobId: id, x: at.x, z: at.z, n: 4 });
  assert.ok(t1.ok && t1.set.length === 4, JSON.stringify(t1));
  for (const e of piers()) if (!e.hole.tube) assert.ok(sim.commandNow('foundation.setTube', { jobId: id, x: e.hole.x, z: e.hole.z, n: 4 }).ok);
  assert.ok(piers().every((e) => e.hole.tube));
  assert.ok(job(sim).tubeOff >= 0 && job(sim).tubeOff < CC.PIER.tubeM, 'cut from 12 ft tubes, one offcut kept');
  assert.equal(job(sim).step, 'forms', 'leaning tubes are not plumb');
  // plumbing: push the top against its lean, in two nudges
  for (const e of piers()) {
    const h = e.hole;
    const a = sim.commandNow('foundation.plumb', { jobId: id, id: e.id, dx: -h.tilt[0] * 0.5, dz: -h.tilt[1] * 0.5 });
    assert.ok(a.ok && !a.plumb && a.off > 0.01, JSON.stringify(a));
    const b = sim.commandNow('foundation.plumb', { jobId: id, id: e.id, dx: -a.tilt[0] * 0.8, dz: -a.tilt[1] * 0.8 });
    assert.ok(b.plumb, 'the bubble centres: ' + JSON.stringify(b));
  }
  assert.equal(job(sim).step, 'pour');
  // fill, rod, top up, bracket
  stock(sim, { concrete_mix: 36 * 60 });
  assert.match(sim.commandNow('foundation.fill', { jobId: id, x: at.x, z: at.z }).reason, /empty/);
  let rods = 0;
  for (const e of piers()) {
    const f = fillUp(sim, e.hole.x, e.hole.z);
    rods += f.rods;
    assert.ok(job(sim).elements.find((q) => q.id === e.id).hole.full);
  }
  assert.ok(rods >= piers().length, 'every pier was rodded at least once (' + rods + ')');
  assert.equal(job(sim).step, 'cure');
  assert.ok(K.stageComplete(pr(sim), 'site'));
  const piersBuilt = Object.values(pr(sim).members).filter((m) => m.kind === 'pier' || (m.kind === 'footing' && m.stage === 'foundation'));
  assert.ok(piersBuilt.every((m) => m.built), 'piers and their footings are built in construction');
  const joist = Object.keys(pr(sim).members).find((k) => pr(sim).members[k].stage === 'floor-frame');
  assert.ok(K.blocked(pr(sim), joist), 'framing is held while green');
  // brackets in the wet tops, four at a time
  assert.match(sim.commandNow('foundation.setBracket', { jobId: id, x: at.x, z: at.z, n: 4 }).reason, /post brackets/);
  stock(sim, { post_bracket: 6 });
  let br = sim.commandNow('foundation.setBracket', { jobId: id, x: at.x, z: at.z, n: 4 });
  assert.ok(br.ok && br.n === 4 && !br.retro, JSON.stringify(br));
  for (const e of piers()) if (!e.hole.bracket) br = sim.commandNow('foundation.setBracket', { jobId: id, x: e.hole.x, z: e.hole.z, n: 4 });
  assert.equal(br.left, 0);
  // beams wait for the frame gate, then go on from the stacks
  const bm = job(sim).timber[0], g = pr(sim).members[bm].geo, mx = (g.a[0] + g.b[0]) / 2, mz = (g.a[1] + g.b[1]) / 2;
  assert.match(sim.commandNow('foundation.setBeam', { jobId: id, x: mx, z: mz }).reason, /half strength/);
  let hours = 0;
  while (!foundationRead.gates(sim.state, id).frame && hours < 96) { sim.runTicks(60); hours++; }
  assert.ok(foundationRead.gates(sim.state, id).frame, 'frame gate after ' + hours + ' h');
  sim.state.sys.stock.money = 1e5;
  assert.ok(sim.commandNow('construction.order', { structId: SID, stage: 'foundation' }).ok);
  sim.commandNow('construction.deliverNow', {});
  for (let k = 0; k < 6 && job(sim).timber.some((m) => !pr(sim).members[m].built); k++) { const r2 = sim.commandNow('foundation.setBeam', { jobId: id, x: mx, z: mz, n: 4 }); assert.ok(r2.ok, r2.reason); }
  assert.ok(K.stageComplete(pr(sim), 'foundation'), 'the foundation stage is done');
  assert.equal(K.blocked(pr(sim), joist), null, 'framing can start');
  sim.runDays(3);
  assert.equal(job(sim).step, 'done');
});

test('a stem wall by hand: trench to the line, footing, forms on a firm footing, tied, poured, bolted, stripped', () => {
  const sim = start('stemwall', 4);
  stakeAll(sim);
  const id = job(sim).id, walls = () => job(sim).elements.filter((e) => e.kind === 'wall'), foots = () => job(sim).elements.filter((e) => e.kind === 'strip');
  // the trenches, dug to the string line (as the shovel and its trim would leave them)
  for (const d of job(sim).digs) assert.ok(sim.commandNow('ground.trim', { region: { poly: d.poly }, targetY: d.targetY }).ok);
  const c = sim.commandNow('foundation.check', { jobId: id });
  assert.ok(c.advanced && c.step === 'footing', JSON.stringify(c));
  stock(sim, { wheelbarrow: 1, concrete_mix: 36 * 400 });
  // forms before the footing: refused
  assert.match(sim.commandNow('foundation.setPanel', { jobId: id, run: 0 }).reason, /footing/i);
  for (const e of foots()) { const [x, z] = [(e.run.a[0] + e.run.b[0]) / 2, (e.run.a[1] + e.run.b[1]) / 2]; fillUp(sim, x, z); }
  assert.equal(job(sim).step, 'forms');
  // the panels stand on the footing once it is a tenth strength
  stock(sim, { wall_form_panel: 80, form_tie: 400 });
  assert.match(sim.commandNow('foundation.setPanel', { jobId: id, run: 0, n: 4 }).reason, /soft/);
  let hours = 0;
  while (foots().some((e) => e.cure.strength < CC.CURE_GATES.walk) && hours < 48) { sim.runTicks(60); hours++; }
  for (const e of walls()) { let r; do { r = sim.commandNow('foundation.setPanel', { jobId: id, run: e.run.k, n: 4 }); assert.ok(r.ok, r.reason); } while (!r.runDone); }
  // ties before the pour: a column at a time, four columns a gesture
  assert.match(sim.commandNow('foundation.fill', { jobId: id, x: walls()[0].run.a[0], z: walls()[0].run.a[1] }).reason, /tie|forms/i);
  for (const e of walls()) { let r; do { r = sim.commandNow('foundation.tie', { jobId: id, run: e.run.k, n: 4 }); assert.ok(r.ok, r.reason); } while (job(sim).elements.find((q) => q.id === e.id).run.ties.some((t) => !t)); }
  assert.equal(job(sim).step, 'pour');
  assert.ok(job(sim).finish.bolts.pos.length >= 6, 'anchor bolts along every wall: ' + job(sim).finish.bolts.pos.length);
  for (const e of walls()) { const [x, z] = [(e.run.a[0] + e.run.b[0]) / 2, (e.run.a[1] + e.run.b[1]) / 2]; fillUp(sim, x, z); }
  assert.equal(job(sim).step, 'cure');
  // bolts in the wet tops
  stock(sim, { anchor_bolt: 30 });
  for (const b of job(sim).finish.bolts.pos) if (!b[2]) { const r = sim.commandNow('foundation.setBolt', { jobId: id, x: b[0], z: b[1], n: 4 }); assert.ok(r.ok, r.reason); }
  assert.ok(job(sim).finish.bolts.pos.every((b) => b[2] && !b[3]), 'pushed in wet');
  // strip at a fifth strength: the panels back to stock
  const p0 = sim.state.sys.stock.items.wall_form_panel || 0;
  assert.match(sim.commandNow('foundation.strip', { jobId: id }).reason, /green/);
  hours = 0;
  while (!foundationRead.gates(sim.state, id).strip && hours < 48) { sim.runTicks(60); hours++; }
  let r;
  do { r = sim.commandNow('foundation.strip', { jobId: id, n: 4 }); assert.ok(r.ok, r.reason); } while (!r.all);
  assert.equal((sim.state.sys.stock.items.wall_form_panel || 0) - p0, walls().reduce((a, e) => a + 2 * e.run.panelsNeed, 0));
  assert.ok(K.stageComplete(pr(sim), 'foundation'));
  sim.runDays(3);
  assert.equal(job(sim).step, 'done');
  assert.ok(!Object.keys((pr(sim).keep || {}).hold || {}).length, 'nothing held once cured');
});
