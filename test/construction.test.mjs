// Construction, headless: orders, deliveries, stacks, carrying, installing by stage, taking apart.
// The shed is the real tool shed as build mode plans it (refresh: DUMP_SHED=test/helpers/shed.json node test/build.smoke.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameSim, createSim, stockSystem, supply as SUP, ITEMS, ITEMS_CONSTRUCTION, makeSave, readSave } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
import * as C from '../src/sim/content/construction.js';

const shed = JSON.parse(readFileSync(new URL('./helpers/shed.json', import.meta.url), 'utf8'));
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const cs = (sim) => sim.state.sys.construction;
const money = (sim) => sim.state.sys.stock.money;
function start(seed = 7, extra = {}) {
  const sim = createGameSim(seed);
  sim.state.sys.stock.money = 5000;
  const r = sim.commandNow('construction.setPlan', K.planFromPieces(shed.struct, shed.pieces, shed.materialsList, { name: 'Tool shed', planId: 'shed', tutorial: true, x: 40, z: 40, r: 2, ...extra }));
  assert.ok(r.ok);
  return sim;
}
const pr = (sim) => cs(sim).progress[shed.struct];
// carry and install everything that can go in now, the way a player would; returns the number of trips
function workAll(sim, { stopAfter = null, from = 'carried' } = {}) {
  let trips = 0;
  for (let guard = 0; guard < 4000; guard++) {
    const P = pr(sim);
    for (const st of C.STAGES) if (st.flat) { const cur = K.flatCurrent(P, st.id); if (cur && K.frameReady(P, st.id, cur)) assert.ok(sim.commandNow('construction.raise', { structId: P.id, parent: cur }).ok); }
    const ids = K.installable(P);
    if (!ids.length) break;
    if (stopAfter && !ids.some((id) => C.STAGE_ORDER.indexOf(P.members[id].stage) <= C.STAGE_ORDER.indexOf(stopAfter))) break;
    const id = ids[0], m = P.members[id], ln = m.line ? P.lines[m.line] : null;
    if (from === 'carried' && ln && (!cs(sim).carried || cs(sim).carried.itemId !== ln.itemId)) {
      if (cs(sim).carried) assert.ok(sim.commandNow('construction.putDown', { x: 44, z: 40 }).ok);
      const st = cs(sim).stacks.find((k) => k.itemId === ln.itemId);
      assert.ok(st, 'a stack of ' + ln.itemId + ' for ' + id);
      const r = sim.commandNow('construction.pickUp', { stackId: st.id });
      assert.ok(r.ok, r.reason); trips++;
    }
    const r = sim.commandNow('construction.install', { structId: P.id, memberIds: [id], from });
    assert.ok(r.ok, id + ': ' + r.reason);
  }
  return trips;
}

test('supply mechanism with a fixture that is not a homestead: orders, stacks, carrying and the ledger', () => {
  const cat = { bolt: { priceUsd: 0.5, massKgPerUnit: 0.1 }, girder: { priceUsd: 80, massKgPerUnit: 40 } };
  const s = SUP.initSupply(); let purse = 100;
  const pay = (usd) => (purse >= usd ? ((purse -= usd), true) : false);
  assert.equal(SUP.quote([{ itemId: 'nope', qty: 1 }], cat).ok, false);
  assert.equal(SUP.placeOrder(s, SUP.quote([{ itemId: 'girder', qty: 2 }], cat), { t: 0, pay }).reason, 'not enough money');
  assert.equal(purse, 100); assert.equal(s.deliveries.length, 0);
  const r = SUP.placeOrder(s, SUP.quote([{ itemId: 'girder', qty: 1 }, { itemId: 'bolt', qty: 20 }], cat), { t: 0, delayS: 50, pay, x: 5, z: 5 });
  assert.ok(r.ok); assert.equal(purse, 10);
  assert.equal(SUP.dueDeliveries(s, 49).length, 0); assert.equal(SUP.dueDeliveries(s, 50).length, 1);
  SUP.deliver(s, r.delivery.id); assert.equal(s.stacks.length, 2);
  const g = s.stacks.find((k) => k.itemId === 'girder');
  // 40 kg is over a 25 kg limit, but one whole unit can always be lifted
  assert.ok(SUP.takeFromStack(s, g.id, { massKgPerUnit: 40, limitKg: 25, minQty: 1 }).ok);
  assert.equal(s.carried.qty, 1); assert.equal(s.stacks.length, 1);
  assert.equal(SUP.takeFromStack(s, s.stacks[0].id, { massKgPerUnit: 0.1, limitKg: 25 }).reason, 'hands full');
  assert.equal(SUP.useCarried(s, 'girder', 1), 1); assert.equal(s.carried, null);
  SUP.takeFromStack(s, s.stacks[0].id, { massKgPerUnit: 0.1, limitKg: 1 }); assert.ok(near(s.carried.qty, 10));
  SUP.putDown(s, { x: 20, z: 20 }); assert.equal(s.stacks.length, 2);
  SUP.giveBack(s, 'girder', 1, 5, 5);
  assert.deepEqual(SUP.imbalance(s), {});
});

test('every line of the shed is priced, and the items the catalog lacked have real figures', () => {
  const sim = start(), P = pr(sim);
  assert.equal(Object.keys(P.lines).length, shed.materialsList.length);
  for (const k in P.lines) { const it = K.CONSTRUCTION_CATALOG[P.lines[k].itemId]; assert.ok(it && it.priceUsd > 0 && it.massKgPerUnit > 0, k); }
  for (const id of ['pier_block', 'door_prehung', 'window_shed', 'roof_underlayment']) assert.ok(ITEMS_CONSTRUCTION[id] && !ITEMS[id]);
  assert.equal(P.lines['foundation|pierblock'].itemId, 'pier_block');
  assert.equal(P.lines['openings|door'].qty, 1); assert.equal(P.lines['openings|window'].unit, 'each');
  const v = K.buildingView(cs(sim), shed.struct);
  assert.ok(v.costUsd > 800 && v.costUsd < 3200, 'the shed costs $' + v.costUsd);
  assert.equal(v.total, Object.keys(P.members).length);
  // every member with something to buy has a share, and the shares add up to the line
  for (const k in P.lines) { const ln = P.lines[k]; if (ln.supply) continue; const sum = Object.values(P.members).filter((m) => m.line === k).reduce((n, m) => n + m.need, 0); assert.ok(near(sum, ln.qty, 1e-5), k + ' ' + sum + ' ' + ln.qty); }
});

test('ordering the foundation stage debits the right money and delivers the right stacks', () => {
  const sim = start(), before = money(sim);
  const posts = shed.materialsList.find((l) => l.key === 'foundation|Posts4x4').qty;
  const expect = 6 * 12 + Math.round(6 * 17.5 * 100) / 100 + Math.round(posts * 5.6 * 100) / 100 + Math.round(0.5 * 6.2 * 100) / 100;
  const r = sim.commandNow('construction.order', { structId: shed.struct, stage: 'foundation' });
  assert.ok(r.ok); assert.ok(near(r.costUsd, expect), r.costUsd + ' vs ' + expect);
  assert.ok(near(before - money(sim), expect));
  assert.equal(cs(sim).stacks.length, 0); assert.equal(cs(sim).deliveries.length, 1);
  assert.equal(K.buildingView(cs(sim), shed.struct).stages.find((s) => s.id === 'foundation').status, 'ordered');
  sim.runTicks(Math.ceil(C.DELIVERY.delayS / 60) + 1);
  const st = Object.fromEntries(cs(sim).stacks.map((k) => [k.itemId, k.qty]));
  assert.deepEqual(st, { lumber_6x6: 6, nails_framing: 0.5, pier_block: 6, lumber_4x4: posts });
  assert.ok(cs(sim).stacks.every((k) => Math.hypot(k.x - 44.5, k.z - 40) < 12));
  assert.equal(K.buildingView(cs(sim), shed.struct).stages.find((s) => s.id === 'foundation').status, 'delivered');
  // ordering the same stage again buys nothing more
  assert.equal(sim.commandNow('construction.order', { structId: shed.struct, stage: 'foundation' }).reason, 'nothing to order');
});

test('an order that cannot be afforded changes nothing', () => {
  const sim = start(); sim.state.sys.stock.money = 50;
  const h = sim.hash();
  const r = sim.commandNow('construction.order', { structId: shed.struct, stage: 'all' });
  assert.equal(r.ok, false); assert.equal(r.reason, 'not enough money'); assert.ok(r.costUsd > 50);
  assert.equal(sim.hash(), h);
});

test('picking up respects the carry limit and takes what the open stage wants', () => {
  const sim = start();
  sim.commandNow('construction.setOption', { key: 'instant', value: true });
  sim.commandNow('construction.order', { structId: shed.struct, stage: 'all' });
  const s = cs(sim), stack = (id) => s.stacks.find((k) => k.itemId === id);
  // 2x4s: far more in the stack than 30 kg
  const r = sim.commandNow('construction.pickUp', { stackId: stack('lumber_2x4').id });
  assert.ok(r.ok); assert.ok(K.carriedMassKg(s) <= C.CARRY.byHandKg + 1e-6 && K.carriedMassKg(s) > C.CARRY.byHandKg - 0.01, K.carriedMassKg(s) + ' kg');
  assert.equal(sim.commandNow('construction.pickUp', { stackId: stack('lumber_2x4').id }).reason, 'hands full');
  assert.equal(sim.commandNow('construction.pickUp', { stackId: stack('pier_block').id }).reason, 'hands full');
  assert.ok(sim.commandNow('construction.putDown', { stackId: stack('lumber_2x4').id }).ok); assert.equal(s.carried, null);
  // fasteners stay by the stacks
  assert.equal(sim.commandNow('construction.pickUp', { stackId: stack('nails_framing').id }).reason, 'stays by the stacks');
  // a wheelbarrow carries more
  sim.state.sys.stock.tools.push('wheelbarrow');
  sim.commandNow('construction.pickUp', { stackId: stack('lumber_2x4').id });
  assert.ok(K.carriedMassKg(s) > 80 && K.carriedMassKg(s) <= 90 + 1e-6);
  assert.deepEqual(SUP.imbalance(s), {});
});

test('install consumes the right material and refuses the wrong one; stages gate in order', () => {
  const sim = start();
  sim.commandNow('construction.setOption', { key: 'instant', value: true });
  sim.commandNow('construction.order', { structId: shed.struct, stage: 'all' });
  const s = cs(sim), P = pr(sim), stack = (id) => s.stacks.find((k) => k.itemId === id);
  const ids = (stage, kind) => Object.keys(P.members).filter((id) => P.members[id].stage === stage && (!kind || P.members[id].kind === kind));
  const pier = ids('foundation', 'pier')[0], stud = ids('wall-frame', 'stud')[0];
  // nothing but the site is open at the start
  assert.deepEqual(K.openStages(P), ['site']);
  assert.equal(sim.commandNow('construction.install', { structId: P.id, memberIds: [pier] }).reason, 'stage not open');
  assert.ok(sim.commandNow('construction.install', { structId: P.id, memberIds: ids('site') }).ok);
  assert.deepEqual(K.openStages(P), ['foundation']);
  // empty hands, then the wrong material
  assert.equal(sim.commandNow('construction.install', { structId: P.id, memberIds: [pier] }).reason, 'no material');
  sim.commandNow('construction.pickUp', { stackId: stack('lumber_2x4').id });
  const r0 = sim.commandNow('construction.install', { structId: P.id, memberIds: [pier] });
  assert.equal(r0.reason, 'wrong material'); assert.equal(r0.itemId, 'pier_block');
  sim.commandNow('construction.putDown', { stackId: stack('lumber_2x4').id });
  // the right one: one block leaves the hands for each pier
  sim.commandNow('construction.pickUp', { stackId: stack('pier_block').id });
  const had = s.carried.qty;
  const r = sim.commandNow('construction.install', { structId: P.id, memberIds: [pier] });
  assert.ok(r.ok); assert.deepEqual(r.installed, [pier]); assert.ok(near((s.carried ? s.carried.qty : 0), had - 1));
  assert.equal(P.members[pier].built, 1);
  assert.equal(sim.commandNow('construction.install', { structId: P.id, memberIds: [pier] }).reason, 'already built');
  assert.equal(sim.commandNow('construction.install', { structId: P.id, memberIds: [stud] }).reason, 'stage not open');
  // sheathing and the roof frame are open together once the top plates are on
  workAll(sim, { stopAfter: 'top-plates' });
  assert.deepEqual(K.openStages(P), ['roof-frame', 'sheathing']);
  // but a gable's sheet waits for its own studs
  const gableSheet = Object.keys(P.members).find((id) => P.members[id].stage === 'sheathing' && /\.g\d/.test(P.members[id].parent));
  assert.equal(K.blocked(P, gableSheet), 'frame not finished');
  assert.deepEqual(SUP.imbalance(s), {});
});

test('wall frames go together one at a time and are raised before the next', () => {
  const sim = start();
  sim.commandNow('construction.setOption', { key: 'instant', value: true });
  sim.commandNow('construction.order', { structId: shed.struct, stage: 'all' });
  workAll(sim, { stopAfter: 'subfloor' });
  const P = pr(sim), walls = K.flatParents(P, 'wall-frame');
  assert.equal(walls.length, 4); assert.equal(K.flatCurrent(P, 'wall-frame'), walls[0]);
  const other = Object.keys(P.members).find((id) => P.members[id].stage === 'wall-frame' && P.members[id].parent === walls[1]);
  assert.equal(K.blocked(P, other), 'one frame at a time');
  assert.equal(sim.commandNow('construction.raise', { structId: P.id, parent: walls[0] }).reason, 'frame not finished');
  const mine = Object.keys(P.members).filter((id) => P.members[id].stage === 'wall-frame' && P.members[id].parent === walls[0]);
  assert.ok(sim.commandNow('construction.install', { structId: P.id, memberIds: mine, from: 'stacks' }).ok);
  assert.equal(K.installable(P).length, 0);          // the frame lies ready: nothing more until it is up
  assert.ok(sim.commandNow('construction.raise', { structId: P.id, parent: walls[0] }).ok);
  assert.equal(K.flatCurrent(P, 'wall-frame'), walls[1]); assert.equal(K.blocked(P, other), null);
  assert.equal(K.tutorialStep(cs(sim)), 6);
});

test('a whole shed: conservation, the project card, unlocks; then taking it apart returns the material', () => {
  const sim = start(), s = cs(sim), m0 = money(sim);
  assert.ok(sim.state.sys.stock.projects.some((p) => p.id === 'first-shed' && p.status === 'open'));
  assert.equal(K.tutorialStep(s), 2);
  assert.ok(!s.unlocked.includes('plan:cabin'));
  const o = sim.commandNow('construction.order', { structId: shed.struct, stage: 'all' });
  assert.ok(o.ok); assert.ok(near(m0 - money(sim), o.costUsd));
  assert.ok(sim.commandNow('construction.deliverNow', {}).ok);
  const bought = Object.fromEntries(Object.entries(s.ledger).map(([k, v]) => [k, v.bought]));
  const trips = workAll(sim);
  const P = pr(sim);
  assert.ok(P.done); assert.equal(K.installable(P).length, 0);
  assert.ok(trips > 30 && trips < 110, trips + ' trips');
  assert.deepEqual(SUP.imbalance(s), {});
  // everything bought is in the building: the stacks are empty and the hands are free
  assert.equal(s.carried, null); assert.equal(s.stacks.length, 0, JSON.stringify(s.stacks));
  for (const id in bought) assert.ok(near(s.ledger[id].used + s.ledger[id].spent, bought[id], 1e-4), id);
  assert.equal(sim.state.sys.stock.projects.find((p) => p.id === 'first-shed').status, 'done');
  assert.ok(s.unlocked.includes('plan:cabin') && s.unlocked.includes('plan:draw')); assert.equal(K.tutorialStep(s), 14);
  // taking apart goes in reverse
  const studs = Object.keys(P.members).filter((id) => P.members[id].kind === 'stud' && P.members[id].stage === 'wall-frame');
  assert.equal(sim.commandNow('construction.dismantle', { structId: P.id, memberIds: [studs[0]] }).reason, 'something stands on it');
  const clad = Object.keys(P.members).filter((id) => P.members[id].stage === 'cladding');
  const lining = Object.keys(P.members).filter((id) => P.members[id].stage === 'lining');
  const r = sim.commandNow('construction.dismantle', { structId: P.id, memberIds: [...clad, ...lining] });
  assert.ok(r.ok); assert.equal(r.removed.length, clad.length + lining.length);
  assert.ok(near(r.returned.board_pine_1x6, bought.board_pine_1x6, 1e-4));
  assert.ok(near(s.stacks.find((k) => k.itemId === 'board_pine_1x6').qty, bought.board_pine_1x6, 1e-4));
  assert.ok(!P.done); assert.deepEqual(SUP.imbalance(s), {});
  // all of it, stage by stage from the top
  for (const st of [...C.STAGE_ORDER].reverse()) {
    const ids = Object.keys(P.members).filter((id) => P.members[id].stage === st && P.members[id].built);
    if (ids.length) assert.ok(sim.commandNow('construction.dismantle', { structId: P.id, memberIds: ids }).ok, st);
  }
  assert.deepEqual(SUP.imbalance(s), {});
  for (const id in bought) {
    const inStacks = s.stacks.filter((k) => k.itemId === id).reduce((n, k) => n + k.qty, 0);
    if (C.SITE_SUPPLY.includes(id)) assert.ok(near(s.ledger[id].spent, bought[id], 1e-4), id + ' is used up');
    else assert.ok(near(inStacks, bought[id], 1e-4), id + ' came back: ' + inStacks + ' of ' + bought[id]);
  }
});

test('guided building takes straight from the stacks and conserves too', () => {
  const sim = start(); sim.commandNow('construction.setOption', { key: 'instant', value: true });
  sim.commandNow('construction.order', { structId: shed.struct, stage: 'all' });
  assert.equal(workAll(sim, { from: 'stacks' }), 0);
  assert.ok(pr(sim).done); assert.deepEqual(SUP.imbalance(cs(sim)), {}); assert.equal(cs(sim).stacks.length, 0);
});

test('deterministic, and saves and loads mid-build with a load in the arms', () => {
  const run = () => { const sim = start(11); sim.commandNow('construction.order', { structId: shed.struct, stage: 'all' }); sim.runTicks(90); workAll(sim, { stopAfter: 'floor-frame' });
    sim.commandNow('construction.pickUp', { stackId: cs(sim).stacks.find((k) => k.itemId === 'osb_18').id }); sim.runTicks(30); return sim; };
  const a = run(), b = run();
  assert.equal(a.hash(), b.hash());
  assert.ok(cs(a).carried && cs(a).carried.itemId === 'osb_18');
  const save = readSave(JSON.stringify(makeSave(a.serialize(), {})));
  const c = createGameSim(11); c.load(save.sim);
  assert.equal(c.hash(), a.hash());
  workAll(a); workAll(c); a.runTicks(10); c.runTicks(10);
  assert.ok(pr(c).done); assert.equal(c.hash(), a.hash());
});

test('a save from before construction existed loads, with the system fresh and the card added', () => {
  const old = createSim({ seed: 3, systems: [stockSystem()] }); old.runTicks(5);
  old.state.sys.stock.money = 777;
  const sim = createGameSim(3); sim.load(JSON.parse(JSON.stringify(old.serialize())));
  const s = cs(sim);
  assert.ok(s && s.stacks.length === 0 && s.level === 'hands-on' && s.unlocked.includes('plan:shed'));
  assert.equal(money(sim), 777);
  assert.ok(sim.state.sys.stock.projects.some((p) => p.id === 'first-shed'));
  sim.runTicks(3);
});

test('a plan sent again keeps what was built and ordered; one sent as built is finished without buying', () => {
  const sim = start(); sim.commandNow('construction.setOption', { key: 'instant', value: true });
  sim.commandNow('construction.order', { structId: shed.struct, stage: 'foundation' });
  workAll(sim, { stopAfter: 'foundation' });
  const built = Object.values(pr(sim).members).filter((m) => m.built).length;
  sim.commandNow('construction.setPlan', K.planFromPieces(shed.struct, shed.pieces, shed.materialsList, { x: 40, z: 40, r: 2 }));
  assert.equal(Object.values(pr(sim).members).filter((m) => m.built).length, built);
  assert.equal(pr(sim).lines['foundation|pierblock'].ordered, 6); assert.equal(pr(sim).planId, 'shed');
  assert.deepEqual(SUP.imbalance(cs(sim)), {});
  const all = sim.commandNow('construction.setPlan', K.planFromPieces(99, shed.pieces.map((p) => ({ ...p, struct: 99, built: true })), shed.materialsList, { built: true }));
  assert.ok(all.ok && cs(sim).progress[99].done);
});
