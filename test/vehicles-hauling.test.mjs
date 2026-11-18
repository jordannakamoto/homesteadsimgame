// Hauling with the trailer, headless: lumber on a trailer stays a construction stack flagged `carrier`, so the ledger
// balances through loading, driving, building from the trailer and tipping the load off; and towing a load changes how
// the ATV pulls and stops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameSim, supply as SUP, VEHICLE_KINDS, vehicleCore as VC } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
import * as C from '../src/sim/content/construction.js';

const shed = JSON.parse(readFileSync(new URL('./helpers/shed-plan.json', import.meta.url), 'utf8'));
const cs = (sim) => sim.state.sys.construction;
const vs = (sim) => sim.state.sys.vehicles;
const ATV = VEHICLE_KINDS.atv, TR = VEHICLE_KINDS.trailer_small;
const imb = (sim) => JSON.stringify(SUP.imbalance(cs(sim)));
const kgOf = (k) => k.qty * K.CONSTRUCTION_CATALOG[k.itemId].massKgPerUnit;

function setUp() {
  const sim = createGameSim(11);
  sim.state.sys.stock.money = 9000;
  assert.ok(sim.commandNow('construction.setPlan', K.planFromPieces(shed.struct, shed.pieces, shed.materialsList, { name: 'Tool shed', planId: 'shed', x: 40, z: 40, r: 2 })).ok);
  sim.commandNow('construction.order', { structId: shed.struct, stage: 'all' });
  sim.commandNow('construction.deliverNow', {});
  const lum = cs(sim).stacks.find((k) => k.itemId === 'lumber_2x4');
  // the ATV with the trailer on its ball, the bed beside the lumber pile
  const atv = sim.commandNow('vehicles.add', { kind: 'atv', x: lum.x + 2, z: lum.z + 3.5, yaw: 0 }).id;
  const p = VC.hitchPose(vs(sim).units[atv], ATV, TR, 0);
  const tr = sim.commandNow('vehicles.add', { kind: 'trailer_small', x: p.x, z: p.z, yaw: p.yaw }).id;
  assert.ok(sim.commandNow('vehicles.hitch', { id: atv, to: tr }).ok);
  return { sim, lum, atv, tr };
}

test('hauling: load, drive, build from the trailer and tip it off; the ledger balances at every step', () => {
  const { sim, lum, atv, tr } = setUp();
  const S = cs(sim), imb0 = imb(sim), item = lum.itemId, total = SUP.stackQty(S, item);
  // refusals change nothing
  assert.equal(sim.commandNow('construction.carrierLoad', { stackId: lum.id, carrier: atv }).reason, 'no such trailer');
  const nails = S.stacks.find((k) => C.SITE_SUPPLY.includes(k.itemId));
  if (nails) assert.equal(sim.commandNow('construction.carrierLoad', { stackId: nails.id, carrier: tr }).reason, 'stays by the stacks');
  // the press picks up an armful; held, the armful goes onto the bed first
  assert.ok(sim.commandNow('construction.pickUp', { stackId: lum.id }).ok);
  const arm = S.carried.qty, hr = sim.commandNow('construction.carrierLoad', { hands: true, carrier: tr });
  assert.ok(hr.ok && Math.abs(hr.qty - arm) < 1e-6 && S.carried === null, JSON.stringify(hr));
  assert.equal(imb(sim), imb0, 'balanced after putting the armful on');
  assert.equal(sim.commandNow('construction.carrierLoad', { hands: true, carrier: tr }).reason, 'nothing carried');
  // hold to load: one piece at a time until the bed is at capacity
  let n = 0, r;
  const per = 3;                                    // a 2x4 stud is 3 m of the line
  while ((r = sim.commandNow('construction.carrierLoad', { stackId: (S.stacks.find((k) => k.itemId === item && !k.carrier) || {}).id, carrier: tr, qty: per })).ok && n < 500) n++;
  assert.ok(n > 3, 'loaded ' + n + ' pieces');
  assert.ok(['full', 'no such stack'].includes(r.reason), r.reason);
  const load = S.stacks.find((k) => k.carrier === tr);
  assert.ok(load && load.itemId === item);
  assert.ok(kgOf(load) <= TR.cargo.capKg + 1e-6, 'within capacity: ' + kgOf(load));
  assert.ok(Math.abs(SUP.stackQty(S, item) - total) < 1e-6, 'material only moved');
  assert.equal(imb(sim), imb0, 'balanced after loading');
  // the barrow cannot load from the trailer; a delivery never merges into it
  assert.equal(sim.commandNow('construction.barrowGrab', {}).ok, true);
  assert.equal(sim.commandNow('construction.barrowLoad', { stackId: load.id }).reason, 'no such stack');
  sim.commandNow('construction.barrowSet', {});
  const before = load.qty;
  const extra = SUP.addToStacks(S, item, 1, load.x, load.z, { mergeR: 20 });
  assert.ok(extra !== load && load.qty === before, 'not merged into the load');
  S.stacks = S.stacks.filter((k) => k !== extra);                  // the probe never happened: the books are as they were
  // drive the rig to the far side of the building: the load follows the trailer
  assert.ok(sim.commandNow('vehicles.sit', { id: atv }).ok);
  const u = vs(sim).units[atv];
  assert.ok(sim.commandNow('vehicles.sync', { id: atv, x: 36, z: 36.5, yaw: Math.PI, artic: 0, burnedL: 0.01, distM: 12 }).ok);
  const t = vs(sim).units[tr];
  assert.ok(sim.commandNow('construction.carrierMove', { carrier: tr, x: t.x, z: t.z }).ok);
  assert.equal(load.x, t.x); assert.equal(load.z, t.z);
  assert.ok(Math.hypot(load.x - 40, load.z - 40) < Math.hypot(lum.x - 40, lum.z - 40), 'the trailer is the nearer pile');
  assert.equal(imb(sim), imb0, 'balanced after driving');
  assert.ok(u.x === 36);
  // build from the stacks: the nearest pile with the lumber is the trailer
  const P = S.progress[shed.struct], q0 = load.qty;
  let used = 0;
  for (let g = 0; g < 400 && used < 4; g++) {
    for (const st of C.STAGES) if (st.flat) { const cur = K.flatCurrent(P, st.id); if (cur && K.frameReady(P, st.id, cur)) sim.commandNow('construction.raise', { structId: P.id, parent: cur }); }
    const id = K.installable(P).find((i) => P.members[i].line && P.lines[P.members[i].line].itemId === item);
    if (!id) { const any = K.installable(P)[0]; if (!any) break; sim.commandNow('construction.install', { structId: P.id, memberIds: [any], from: 'stacks' }); continue; }
    const rr = sim.commandNow('construction.install', { structId: P.id, memberIds: [id], from: 'stacks' });
    if (rr.ok) used++;
  }
  const left = S.stacks.find((k) => k.carrier === tr);
  assert.ok(used > 0 && (!left || left.qty < q0), 'the build drew from the trailer: ' + q0 + ' -> ' + (left && left.qty));
  assert.equal(imb(sim), imb0, 'balanced after building from it');
  // tip it: the rest slides off as an ordinary stack behind the trailer
  if (left) {
    assert.equal(sim.commandNow('construction.carrierUnload', { carrier: tr, x: t.x + 40, z: t.z }).reason, 'too far');
    const rr = sim.commandNow('construction.carrierUnload', { carrier: tr, x: t.x + 2, z: t.z });
    assert.ok(rr.ok && rr.stacks.length === 1, JSON.stringify(rr));
    const g = S.stacks.find((k) => k.id === rr.stacks[0]);
    assert.ok(g && !g.carrier && g.itemId === item);
  }
  assert.ok(!S.stacks.some((k) => k.carrier === tr), 'the bed is empty');
  assert.equal(sim.commandNow('construction.carrierUnload', { carrier: tr, x: t.x, z: t.z }).reason, 'empty');
  assert.equal(imb(sim), imb0, 'balanced after tipping');
  // a save round trip keeps the flag
  const rt = JSON.parse(JSON.stringify(sim.state));
  assert.deepEqual(rt.sys.construction.stacks, S.stacks);
});

test('towing: a loaded trailer slows the pull-away and lengthens the stop; the tongue load is on the ball', () => {
  const FLAT = { ground: () => 0 };
  const pull = (cargoKg) => {
    const b = VC.createBody(ATV, { fuelL: 10 }, FLAT);
    b.cargoKg = 80;
    const t = cargoKg == null ? null : { body: VC.createBody(TR, VC.hitchPose(b, ATV, TR, 0), FLAT), kind: TR };
    if (t) t.body.cargoKg = cargoKg;
    let s5 = 0;
    for (let i = 0; i < 5 / VC.SUB; i++) VC.stepBody(b, ATV, { throttle: 1 }, FLAT, VC.SUB, t);
    s5 = b.u;
    const x0 = b.z;
    let n = 0;
    while (b.u > 0.05 && n++ < 3000) VC.stepBody(b, ATV, { throttle: 0, brake: 1 }, FLAT, VC.SUB, t);
    return { v5: s5, stop: b.z - x0, sF0: b.sF0 };
  };
  const solo = pull(null), empty = pull(0), full = pull(TR.cargo.capKg);
  assert.ok(solo.v5 > empty.v5 && empty.v5 > full.v5, 'slower with more behind: ' + [solo.v5, empty.v5, full.v5].map((v) => v.toFixed(2)));
  // from the same speed the stop is longer: compare braking from each run's speed by deceleration
  const decel = (r) => (r.v5 * r.v5) / (2 * r.stop);
  assert.ok(decel(full) < decel(solo) * 0.75, 'an unbraked load pushes: ' + decel(solo).toFixed(2) + ' vs ' + decel(full).toFixed(2) + ' m/s2');
  assert.ok(full.sF0 < 0.5 && solo.sF0 === 0.5, 'the tongue lifts the front: ' + full.sF0);
});

test('backing a trailer: past its stop the rig binds instead of folding through', () => {
  const FLAT = { ground: () => 0 };
  const b = VC.createBody(ATV, { fuelL: 10 }, FLAT), t = { body: VC.createBody(TR, VC.hitchPose(b, ATV, TR, 0.3), FLAT), kind: TR };
  t.body.artic = 0.3;
  let jack = false;
  for (let i = 0; i < 12 / VC.SUB; i++) { VC.stepBody(b, ATV, { throttle: -0.6, steer: -1 }, FLAT, VC.SUB, t); jack = jack || b.jack; }
  assert.ok(Math.abs(t.body.artic) <= VC.ARTIC_MAX + 1e-9 && Math.abs(t.body.artic) > VC.ARTIC_MAX - 0.02, 'at the stop: ' + t.body.artic);
  assert.ok(jack && Math.abs(b.u) < 0.05, 'bound and stopped: ' + b.u);
});
