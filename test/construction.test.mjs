// Construction, headless: orders, deliveries, stacks, carrying, installing by stage, taking apart.
// The shed is the real tool shed as build mode plans it (refresh: DUMP_SHED=tes./helpers/shed-plan.json node test/build.smoke.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameSim, createSim, stockSystem, supply as SUP, ITEMS, ITEMS_CONSTRUCTION, makeSave, readSave } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
import * as C from '../src/sim/content/construction.js';
import { workCost } from '../src/sim/content/services.js';

const shed = JSON.parse(readFileSync(new URL('./helpers/shed-plan.json', import.meta.url), 'utf8'));
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
    if (from === 'carried' && m.site && !m.prep) {     // cut on site: at the sawhorses first; then it is set from there
      const c = sim.commandNow('construction.cut', { structId: P.id, memberId: id });
      assert.ok(c.ok, id + ' cut: ' + c.reason);
      const r = sim.commandNow('construction.install', { structId: P.id, memberIds: [id], from });
      assert.ok(r.ok, id + ': ' + r.reason);
      continue;
    }
    if (from === 'carried' && ln && K.needsStock(cs(sim), P, id) && (!cs(sim).carried || cs(sim).carried.itemId !== ln.itemId || cs(sim).carried.qty + 1e-6 < K.stockNeed(cs(sim), P, id))) {
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
  assert.equal(Object.keys(P.lines).length, shed.materialsList.length + 1);   // and the ladder
  for (const k in P.lines) { const it = K.CONSTRUCTION_CATALOG[P.lines[k].itemId]; assert.ok(it && it.priceUsd > 0 && it.massKgPerUnit > 0, k); }
  for (const id of ['pier_block', 'door_prehung', 'window_shed', 'roof_underlayment']) assert.ok(ITEMS_CONSTRUCTION[id] && !ITEMS[id]);
  assert.equal(P.lines['foundation|pierblock'].itemId, 'pier_block');
  assert.equal(P.lines['openings|door'].qty, 1); assert.equal(P.lines['openings|window'].unit, 'each');
  const v = K.buildingView(cs(sim), shed.struct);
  assert.ok(v.costUsd > 800 && v.costUsd < 3200, 'the shed costs $' + v.costUsd);
  assert.equal(v.total, Object.keys(P.members).length);
  // every member with something to buy has a share, and the shares add up to the line
  for (const k in P.lines) { const ln = P.lines[k]; if (ln.supply || ln.sheet || ln.stick || ln.itemId === 'ladder') continue; const sum = Object.values(P.members).filter((m) => m.line === k).reduce((n, m) => n + m.need, 0); assert.ok(near(sum, ln.qty, 1e-5), k + ' ' + sum + ' ' + ln.qty); }
});

test('ordering the foundation stage debits the right money and delivers the right stacks', () => {
  const sim = start(), before = money(sim);
  const posts = 2.4;   // three short posts, cut to height on site from one 8 ft stick
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
  assert.ok(r.ok); assert.ok(K.carriedMassKg(s) <= C.CARRY.byHandKg * 3 + 1e-6, K.carriedMassKg(s) + ' kg');
  assert.ok(K.carriedMassKg(s) > C.CARRY.byHandKg * 3 - 0.01);                 // nothing wants 2x4s yet, so a full armful
  assert.equal(sim.commandNow('construction.pickUp', { stackId: stack('lumber_2x4').id }).reason, 'hands full');
  assert.equal(sim.commandNow('construction.pickUp', { stackId: stack('pier_block').id }).reason, 'hands full');
  assert.ok(sim.commandNow('construction.putDown', { stackId: stack('lumber_2x4').id }).ok); assert.equal(s.carried, null);
  // fasteners stay by the stacks
  assert.equal(sim.commandNow('construction.pickUp', { stackId: stack('nails_framing').id }).reason, 'stays by the stacks');
  // a wheelbarrow carries more
  sim.state.sys.stock.tools.push('wheelbarrow');
  sim.commandNow('construction.pickUp', { stackId: stack('lumber_2x4').id });
  assert.ok(K.carriedMassKg(s) > 170 && K.carriedMassKg(s) <= 180 + 1e-6);
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
  assert.ok(Number.isInteger(had) && had >= 1);            // 20 kg blocks: whole ones only, never half of one
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
  assert.ok(trips > 20 && trips < 110, trips + ' trips');      // precut pieces and cut pieces fetched from the sawhorses: fewer trips than sawing each one
  assert.deepEqual(SUP.imbalance(s), {}); assert.deepEqual(K.stickImbalance(s), {});
  // everything bought is in the building: the stacks are empty and the hands are free
  assert.equal(s.carried, null); assert.deepEqual(s.stacks.filter((k) => k.itemId !== 'ladder'), []);   // the ladder is still in its yard
  for (const id in bought) if (id !== 'ladder') assert.ok(near(s.ledger[id].used + s.ledger[id].spent, bought[id], 1e-4), id);
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
  assert.ok(!P.done); assert.deepEqual(SUP.imbalance(s), {}); assert.deepEqual(K.sheetImbalance(s), {});
  // all of it, stage by stage from the top
  for (const st of [...C.STAGE_ORDER].reverse()) {
    const ids = Object.keys(P.members).filter((id) => P.members[id].stage === st && P.members[id].built);
    if (ids.length) assert.ok(sim.commandNow('construction.dismantle', { structId: P.id, memberIds: ids }).ok, st);
  }
  assert.deepEqual(SUP.imbalance(s), {}); assert.deepEqual(K.sheetImbalance(s), {}); assert.deepEqual(K.stickImbalance(s), {});
  for (const id in bought) {
    const inStacks = s.stacks.filter((k) => k.itemId === id).reduce((n, k) => n + k.qty, 0);
    if (C.SITE_SUPPLY.includes(id)) assert.ok(near(s.ledger[id].spent, bought[id], 1e-4), id + ' is used up');
    else if (/^(osb|plywood|gypsum)_/.test(id)) assert.ok(near(inStacks, 0, 1e-4), id + ': cut sheets do not come back whole');
    else if (/^lumber_/.test(id)) assert.ok(near(inStacks, 0, 1e-4) && Object.values(P.lines).some((l) => l.itemId === id && l.cut && l.cut.sticks.some((st) => st.open && st.left > 0)), id + ': sawn lumber comes back as offcuts, not whole sticks');
    else assert.ok(near(inStacks, bought[id], 1e-4), id + ' came back: ' + inStacks + ' of ' + bought[id]);
  }
});

test('guided building takes straight from the stacks and conserves too', () => {
  const sim = start(); sim.commandNow('construction.setOption', { key: 'instant', value: true });
  sim.commandNow('construction.order', { structId: shed.struct, stage: 'all' });
  assert.equal(workAll(sim, { from: 'stacks' }), 0);
  assert.ok(pr(sim).done); assert.deepEqual(SUP.imbalance(cs(sim)), {}); assert.deepEqual(cs(sim).stacks.filter((k) => k.itemId !== 'ladder'), []);
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
  const all = sim.commandNow('construction.setPlan', K.planFromPieces(99, shed.pieces.map((p) => ({ ...p, struct: 99, built: true })), shed.materialsList, {}));
  assert.ok(all.ok && cs(sim).progress[99].done);
});

test('set by hand, then fastened: a piece set in place holds its material but is not built until it is nailed', () => {
  const sim = start(); sim.commandNow('construction.setOption', { key: 'instant', value: true });
  sim.commandNow('construction.order', { structId: shed.struct, stage: 'all' });
  const s = cs(sim), P = pr(sim);
  sim.commandNow('construction.install', { structId: P.id, memberIds: Object.keys(P.members).filter((id) => P.members[id].stage === 'site') });
  const pier = Object.keys(P.members).find((id) => P.members[id].kind === 'pier');
  assert.equal(sim.commandNow('construction.install', { structId: P.id, memberIds: [pier], hold: true }).reason, 'no material');
  sim.commandNow('construction.pickUp', { stackId: s.stacks.find((k) => k.itemId === 'pier_block').id });
  const r = sim.commandNow('construction.install', { structId: P.id, memberIds: [pier], hold: true });
  assert.ok(r.ok); assert.deepEqual(r.set, [pier]); assert.ok(!s.carried || s.carried.qty < 3 + 1e-6);
  assert.equal(P.members[pier].built, 0); assert.equal(P.members[pier].got, 1); assert.equal(P.tally.foundation[0], 0);
  assert.equal(sim.commandNow('construction.install', { structId: P.id, memberIds: [pier], hold: true }).reason, 'already set');
  assert.deepEqual(SUP.imbalance(s), {});
  const n = sim.commandNow('construction.install', { structId: P.id, memberIds: [pier] });      // the nailing: needs nothing in the hands
  assert.ok(n.ok); assert.deepEqual(n.installed, [pier]); assert.equal(P.members[pier].built, 1);
  assert.deepEqual(SUP.imbalance(s), {});
});

// ---- sheet goods are cut to fit and offcuts are reused
const sheetPlan = (areas, structId = 77) => ({
  structId, name: 'Sheet test', x: 10, z: 10, r: 2,
  members: areas.map((a, i) => ({ id: 'p' + i, stage: 'subfloor', kind: 'sheathing', parent: 'f', built: false })),
  lines: [{ key: 'subfloor|sub', stage: 'subfloor', itemId: 'osb_18', qty: 99, unit: 'each', label: 'Subfloor sheets', why: '', count: areas.length, members: areas.map((a, i) => ['p' + i, a]) }],
});
test('packSheets: pieces are cut biggest first from the smallest offcut that will do', () => {
  const A = C.SHEET.areaM2;
  assert.equal(C.packSheets([]).sheets, 0);
  assert.equal(C.packSheets([A, A, 1, 0.9, 0.5]).sheets, 3);                 // the three small pieces share one sheet
  assert.equal(C.packSheets([1, 1, 0.9]).sheets, 1);                         // old rule: ceil(2.9 / 2.98) = 1 too, but with pieces of 1.5 and 1.5 it is 2 and cutting makes it 2 as well
  assert.equal(C.packSheets([1.5, 1.5, 1.4]).sheets, 2);                     // a 1.4 needs the 1.47 left of a sheet: it fits
  const r = C.packSheets([2, 1.5], [1.6]);                                   // the 1.6 offcut takes the 1.5; the 2 needs a new sheet
  assert.equal(r.sheets, 1); assert.deepEqual(r.from, ['new', 'offcut']);
  assert.equal(C.packSheets([A * 0.5], [A * 0.4]).sheets, 1);                // an offcut too small is not used
  for (const rest of C.packSheets([2.9]).left) assert.ok(rest >= C.SHEET.minKeepM2);   // slivers are waste, not kept
  assert.equal(C.packSheets([2.95]).left.length, 0);
});
test('a small piece takes an offcut, else cuts a sheet and keeps the rest; the order and the books agree', () => {
  const A = C.SHEET.areaM2, areas = [A, 1.0, 0.9, 0.5];
  const sim = createGameSim(5); sim.state.sys.stock.money = 5000;
  assert.ok(sim.commandNow('construction.setPlan', sheetPlan(areas)).ok);
  const P = () => cs(sim).progress[77], s = cs(sim);
  assert.equal(P().lines['subfloor|sub'].qty, 2); assert.equal(P().lines['subfloor|sub'].qty, C.packSheets(areas).sheets);
  assert.ok(near(P().members.p1.need, 1.0 / A));
  assert.ok(sim.commandNow('construction.setOption', { key: 'instant', value: true }).ok);
  assert.ok(sim.commandNow('construction.order', { structId: 77, stage: 'all' }).ok);
  const stack = s.stacks.find((k) => k.itemId === 'osb_18');
  assert.ok(sim.commandNow('construction.pickUp', { stackId: stack.id }).ok);
  assert.equal(K.needsStock(s, P(), 'p1'), true);
  let r = sim.commandNow('construction.install', { structId: 77, memberIds: ['p1'], hold: true });
  assert.ok(r.ok); assert.equal(r.cuts[0].how, 'new'); assert.ok(near(r.cuts[0].keptM2, A - 1.0));
  assert.ok(!s.carried || s.carried.qty < 2);                                 // a sheet left the arms
  assert.equal(K.needsStock(s, P(), 'p2'), false);
  r = sim.commandNow('construction.install', { structId: 77, memberIds: ['p2'], hold: true });
  assert.equal(r.cuts[0].how, 'offcut'); assert.ok(near(s.offcuts.osb_18.reduce((n, a) => n + a, 0), A - 1.0 - 0.9));
  r = sim.commandNow('construction.install', { structId: 77, memberIds: ['p3'], hold: true });
  assert.equal(r.cuts[0].how, 'offcut');
  assert.deepEqual(K.sheetImbalance(s), {});
  assert.equal(P().lines['subfloor|sub'].qty, 2);                           // still two: one more sheet for the whole one
  if (!s.carried) assert.ok(sim.commandNow('construction.pickUp', { stackId: s.stacks.find((k) => k.itemId === 'osb_18').id }).ok);
  r = sim.commandNow('construction.install', { structId: 77, memberIds: ['p0'], hold: true });
  assert.equal(r.cuts[0].how, 'new'); assert.equal(P().lines['subfloor|sub'].used, 2);
  assert.deepEqual(K.sheetImbalance(s), {}); assert.deepEqual(SUP.imbalance(s), {});
  for (const id of ['p0', 'p1', 'p2', 'p3']) assert.ok(sim.commandNow('construction.install', { structId: 77, memberIds: [id] }).ok);
  assert.ok(P().done);
  assert.ok(s.stacks.every((k) => k.itemId !== 'osb_18' || k.qty < 1e-6) && !s.carried);
  // taking a piece off leaves an offcut of its size, and the books still balance
  assert.ok(sim.commandNow('construction.dismantle', { structId: 77, memberIds: ['p3'] }).ok);
  assert.deepEqual(K.sheetImbalance(s), {});
  assert.equal(K.needsStock(s, P(), 'p3'), false);
});
test('a sheet cut from a stack by Guided and from the stacks with nothing in the arms', () => {
  const sim = createGameSim(5); sim.state.sys.stock.money = 5000;
  sim.commandNow('construction.setPlan', sheetPlan([1.2, 0.7, 0.5, 0.3, 0.2], 78));
  sim.commandNow('construction.setOption', { key: 'instant', value: true });
  sim.commandNow('construction.order', { structId: 78, stage: 'all' });
  const s = cs(sim);
  assert.equal(s.progress[78].lines['subfloor|sub'].qty, 1);
  for (const id of ['p0', 'p1', 'p2', 'p3', 'p4']) assert.ok(sim.commandNow('construction.install', { structId: 78, memberIds: [id], from: 'stacks' }).ok, id);
  assert.ok(s.progress[78].done); assert.deepEqual(K.sheetImbalance(s), {}); assert.equal(s.stacks.length, 0);
});

test('the ladder comes with the shed order; lean it, take it down, and the books balance', () => {
  const sim = start(); sim.commandNow('construction.setOption', { key: 'instant', value: true });
  const s = cs(sim), P = pr(sim);
  assert.ok(P.lines['site|ladder'] && P.lines['site|ladder'].itemId === 'ladder' && C.ITEMS_CONSTRUCTION.ladder.priceUsd > 0);
  assert.ok(sim.commandNow('construction.order', { structId: shed.struct, stage: 'all' }).ok);
  assert.ok(s.stacks.some((k) => k.itemId === 'ladder'));
  assert.equal(sim.commandNow('construction.leanLadder', { x: 1, z: 1, yaw: 0, topY: 3 }).reason, 'no ladder in the arms');
  assert.ok(sim.commandNow('construction.pickUp', { stackId: s.stacks.find((k) => k.itemId === 'ladder').id }).ok);
  assert.ok(s.carried && s.carried.itemId === 'ladder');
  const r = sim.commandNow('construction.leanLadder', { x: 41, z: 38, yaw: 1.5, topY: 3.4, structId: shed.struct });
  assert.ok(r.ok); assert.equal(s.carried, null); assert.equal(s.ladder.topY, 3.4); assert.deepEqual(SUP.imbalance(s), {});
  assert.equal(sim.commandNow('construction.leanLadder', { x: 1, z: 1, yaw: 0, topY: 3 }).ok, false);
  assert.ok(sim.commandNow('construction.takeLadder', {}).ok);
  assert.equal(s.ladder, null); assert.equal(s.carried.itemId, 'ladder'); assert.deepEqual(SUP.imbalance(s), {});
  const back = JSON.parse(JSON.stringify(s)); assert.equal(back.ladder, null);
});

test('learn once: two of a kind nailed by hand and the kind is known; auto work does not count', () => {
  const sim = start(), s = cs(sim);
  sim.commandNow('construction.setOption', { key: 'instant', value: true });
  sim.commandNow('construction.order', { structId: shed.struct, stage: 'all' });
  const P = pr(sim);
  assert.deepEqual(s.learn, { counts: {}, known: {} });
  const nailByHand = (id) => { const ln = P.lines[P.members[id].line]; if (!s.carried || s.carried.itemId !== ln.itemId) { if (s.carried) sim.commandNow('construction.putDown', { x: 44, z: 40 }); assert.ok(sim.commandNow('construction.pickUp', { stackId: s.stacks.find((k) => k.itemId === ln.itemId).id }).ok); } assert.ok(sim.commandNow('construction.install', { structId: P.id, memberIds: [id], hold: true }).ok); return sim.commandNow('construction.install', { structId: P.id, memberIds: [id], hand: true }); };
  // get to the floor frame by auto work (not counted)
  for (let g = 0; g < 200; g++) { const ids = K.installable(P).filter((i) => ['site', 'foundation'].includes(P.members[i].stage)); if (!ids.length) break; sim.commandNow('construction.install', { structId: P.id, memberIds: [ids[0]], from: 'stacks' }); }
  assert.deepEqual(s.learn.counts, {});
  const joists = K.installable(P).filter((i) => P.members[i].kind === 'joist');
  assert.ok(joists.length >= 4);
  assert.equal(nailByHand(joists[0]).learned.length, 0);
  assert.equal(s.learn.counts.joist, 1);
  assert.deepEqual(nailByHand(joists[1]).learned, ['joist']);
  assert.ok(s.learn.known.joist); assert.equal(nailByHand(joists[2]).learned.length, 0); assert.equal(s.learn.counts.joist, 2);
  // saved and loaded, it is still known
  const back = JSON.parse(JSON.stringify(s)); assert.ok(back.learn.known.joist);
});

test('support order: beams wait for the pier blocks, posts for piers', () => {
  const P = { members: {
    p: { stage: 'foundation', kind: 'pier', built: false }, b: { stage: 'foundation', kind: 'beam', built: false },
    s: { stage: 'site', kind: 'site', built: true } }, tally: { site: [1, 1], foundation: [0, 2] }, raised: {} };
  assert.equal(K.blocked(P, 'b'), 'support missing');
  assert.equal(K.supportMissing(P, 'b'), 'pier');
  assert.equal(K.blocked(P, 'p'), null);
  P.members.p.built = true; P.tally.foundation[0] = 1;
  assert.equal(K.blocked(P, 'b'), null);
});

test('feel settings: defaults, clamped, presets, reset', () => {
  const sim = start();
  assert.deepEqual(C.feelOf(cs(sim)), { ...C.FEEL });
  assert.equal(sim.commandNow('construction.setFeel', { key: 'setCount', value: 99 }).feel.setCount, 6);
  assert.equal(sim.commandNow('construction.setFeel', { preset: 'fast' }).feel.nails, 0);
  assert.deepEqual(sim.commandNow('construction.setFeel', { reset: true }).feel, { ...C.FEEL });
});

test('wheelbarrow: comes with the first delivery, loads by weight, conserves material, counts as a stack', () => {
  const sim = start({ });
  assert.equal(cs(sim).barrow, null);
  assert.ok(sim.commandNow('construction.order', { structId: shed.struct, stage: 'floor-frame' }).ok || true);
  sim.commandNow('construction.order', { structId: shed.struct, stage: 'all' });
  sim.commandNow('construction.deliverNow', {});
  const b = cs(sim).barrow; assert.ok(b && !b.held);
  assert.equal(sim.commandNow('construction.barrowGrab', { px: b.x + 50, pz: b.z }).reason, 'too far');
  assert.ok(sim.commandNow('construction.barrowGrab', { px: b.x, pz: b.z }).ok);
  const st = cs(sim).stacks.find((k) => k.itemId === 'lumber_2x6') || cs(sim).stacks.find((k) => /^lumber_/.test(k.itemId));
  const before = SUP.stackQty(cs(sim), st.itemId), imb = JSON.stringify(SUP.imbalance(cs(sim)));
  const r = sim.commandNow('construction.barrowLoad', { stackId: st.id }); assert.ok(r.ok, r.reason);
  assert.ok(near(SUP.stackQty(cs(sim), st.itemId), before));
  assert.equal(JSON.stringify(SUP.imbalance(cs(sim))), imb);
  assert.ok(cs(sim).stacks.some((k) => k.barrow));
  sim.commandNow('construction.barrowMove', { x: 10, z: 12, yaw: 1 });
  assert.equal(cs(sim).stacks.find((k) => k.barrow).x, 10);
  assert.ok(sim.commandNow('construction.barrowSet', { x: 10, z: 12 }).ok); assert.equal(cs(sim).barrow.held, false);
  const rt = JSON.parse(JSON.stringify(cs(sim))); assert.equal(rt.barrow.x, 10);
});

test('nails bought in the Supplier go to the inventory and construction draws from it; the books balance', () => {
  const sim = start();
  sim.commandNow('construction.order', { structId: shed.struct, stage: 'all' });
  sim.commandNow('construction.deliverNow', {});
  const S = cs(sim);
  S.stacks = S.stacks.filter((k) => !C.SITE_SUPPLY.includes(k.itemId));       // out of nails and screws
  const imb0 = JSON.stringify(SUP.imbalance(S)), P = pr(sim), ids = () => K.installable(P);
  const place = () => { const id = ids().find((i) => P.members[i].line && !C.SITE_SUPPLY.includes(P.lines[P.members[i].line].itemId)); return id; };
  let id = ids()[0], r = null;
  for (let g = 0; g < 400; g++) { id = ids()[0]; const m = P.members[id], ln = m.line ? P.lines[m.line] : null; if (ln && (!S.carried || S.carried.itemId !== ln.itemId)) { if (S.carried) sim.commandNow('construction.putDown', { x: 44, z: 40 }); const st = S.stacks.find((k) => k.itemId === ln.itemId); if (!st) break; sim.commandNow('construction.pickUp', { stackId: st.id }); } r = sim.commandNow('construction.install', { structId: P.id, memberIds: [id] }); if (!r.ok) break; }
  void place;
  if (r && !r.ok) assert.equal(r.reason, 'no fasteners');
  const lack = r && r.itemId;
  assert.ok(lack, 'ran out of fasteners');
  assert.ok(sim.commandNow('stock.buy', { id: lack, qty: 20 }).ok);
  const r2 = sim.commandNow('construction.install', { structId: P.id, memberIds: [id] });
  assert.ok(r2.ok, r2.reason);
  assert.ok(sim.state.sys.stock.items[lack] < 20);
  assert.equal(JSON.stringify(SUP.imbalance(S)), imb0);          // drawing from the inventory neither conjures nor loses material
});

test('lumber comes cut to length from the yard; short and fitted pieces are cut on site from stock sticks and their offcuts', () => {
  const sim = start(), s = cs(sim), P = pr(sim);
  const studs = P.lines['wall-frame|Studs2x4'], list = K.cutList(P, 'wall-frame|Studs2x4');
  assert.ok(studs.stick && list.some((c) => c.pre) && list.filter((c) => !c.pre).every((c) => [2.4, 3, 3.6, 4.2, 4.8].includes(c.lenM)), JSON.stringify(list));
  const full = Object.keys(P.members).find((id) => P.members[id].kind === 'stud' && P.members[id].len > 2), short = Object.keys(P.members).find((id) => P.members[id].kind === 'stud' && P.members[id].len < 1);
  assert.ok(!P.members[full].site && P.members[short].site, 'a full stud is precut, a cripple is cut on site');
  const hd = Object.keys(P.members).find((id) => P.members[id].kind === 'header');
  assert.equal(P.members[hd].pcs, 2);
  sim.commandNow('construction.setOption', { key: 'instant', value: true });
  assert.ok(sim.commandNow('construction.order', { structId: shed.struct, stage: 'all' }).ok);
  workAll(sim, { stopAfter: 'wall-frame', from: 'stacks' });
  const cripples = Object.keys(P.members).filter((id) => P.members[id].kind === 'stud' && P.members[id].stage === 'wall-frame' && P.members[id].built && P.members[id].len < 1);
  assert.ok(cripples.length > 0 && cripples.some((id) => P.members[id].cut === 'offcut'), 'short pieces come out of offcuts');
  // nothing precut is ever sawn: its piece is the length it goes in at
  assert.ok(Object.keys(P.members).filter((id) => P.members[id].built && P.members[id].line && P.lines[P.members[id].line].stick && !P.members[id].site).every((id) => P.members[id].cut === 'new'));
  assert.deepEqual(K.stickImbalance(s), {}); assert.deepEqual(SUP.imbalance(s), {});
  // what was bought for the wall frames is exactly what they took
  for (const key of ['wall-frame|Studs2x4', 'wall-frame|Headers2x6']) assert.ok(near(P.lines[key].used, P.lines[key].qty, 1e-6), key);
});

test('a ladder is always on site for work at height, even when the build is ordered a stage at a time after the site is dug', () => {
  const sim = start(), s = cs(sim);
  sim.commandNow('construction.setOption', { key: 'instant', value: true });
  workAll(sim, { stopAfter: 'site', from: 'stacks' });          // the site is dug before anything is ordered: its ladder line is never bought
  for (const st of ['foundation', 'floor-frame', 'subfloor', 'wall-frame']) { sim.commandNow('construction.order', { structId: shed.struct, stage: st }); workAll(sim, { stopAfter: st, from: 'stacks' }); }
  sim.runTicks(2);
  assert.ok(s.stacks.some((k) => k.itemId === 'ladder') || s.ladder || (s.carried && s.carried.itemId === 'ladder'), 'a ladder for the top plates');
  assert.deepEqual(SUP.imbalance(s), {});
  // lost: it comes back
  s.stacks = s.stacks.filter((k) => k.itemId !== 'ladder'); s.ledger.ladder.spent += 1;
  sim.runTicks(2);
  assert.ok(s.stacks.some((k) => k.itemId === 'ladder'));
});

test('scaffolding is rented by the day, set up along a wall, taken down, and collected when the days run out', () => {
  const sim = start(), s = cs(sim), m0 = money(sim);
  const r = sim.commandNow('construction.rentScaffold', { structId: shed.struct, days: 2 });
  assert.ok(r.ok); assert.ok(near(m0 - money(sim), 2 * C.SCAFFOLD.usdPerDay)); assert.ok(s.scaffold && !s.scaffold.set);
  assert.equal(sim.commandNow('construction.setScaffold', { x: 1, z: 2, yaw: 0, len: 9, deckY: 2 }).reason, 'bad place');
  assert.ok(sim.commandNow('construction.setScaffold', { x: 41, z: 38, yaw: 0, len: 2.6, deckY: 2.1, structId: shed.struct }).ok);
  assert.equal(sim.commandNow('construction.setScaffold', { x: 41, z: 38, yaw: 0, len: 2.6, deckY: 2.1 }).reason, 'already up');
  assert.ok(sim.commandNow('construction.strikeScaffold', { x: 44, z: 40 }).ok); assert.equal(s.scaffold.set, null);
  assert.ok(sim.commandNow('construction.rentScaffold', { days: 1 }).ok);       // one more day
  sim.runTicks(Math.ceil((3 * 86400) / 60) + 2);
  assert.equal(s.scaffold, null);
});

test('tape and mud: each drywall seam takes three coats, each on dry compound, then sanding; the stage completes when all are sanded', async () => {
  await import('../src/framing.js');
  const F = globalThis.__framing;
  const desc = { found: 'pier-blocks', spec: { ins: 'fibreglass_batt', lining: 'gypsum' }, floors: [{ id: 'f', outline: [[0, 0], [3, 0], [3, 3], [0, 3]], y0: 0, ground: true }],
    walls: [{ id: 'w1', a: [0, 0], b: [3, 0], y0: 0, h: 2.6, out: -1, mat: 'timber', openings: [] }, { id: 'w2', a: [0, 1.5], b: [3, 1.5], y0: 0, h: 2.6, out: 0, mat: 'timber', openings: [] }], roofs: [] };
  const mem = F.generate(desc).map((m) => ({ ...m, struct: 's1', built: m.stage !== 'finish' }));
  const sim = createGameSim(3);
  sim.state.sys.stock.money = 5000;
  assert.ok(sim.commandNow('construction.setPlan', K.planFromPieces('s1', mem, F.materialsList(mem), { name: 'Room', x: 40, z: 40, r: 2 })).ok);
  const pr = cs(sim).progress.s1, joints = Object.keys(pr.members).filter((id) => pr.members[id].kind === 'joint');
  assert.ok(joints.length >= 4, joints.length + ' seams');
  assert.ok(K.liningCovered(pr, 'w2') && !pr.done, 'the partition is hung on both faces and the room is not finished');
  assert.ok(sim.commandNow('construction.order', { structId: 's1', stage: 'finish' }).ok);
  sim.commandNow('construction.deliverNow', {});
  const id = joints[0], pass = () => sim.commandNow('construction.install', { structId: 's1', memberIds: [id], from: 'stacks' });
  let r = pass();
  assert.ok(r.ok && pr.members[id].coat === 1 && !pr.members[id].built, 'tape and the first coat');
  r = pass();
  assert.equal(r.refused[0].reason, 'wet');
  assert.ok(r.refused[0].waitS > 0 && r.refused[0].waitS <= C.FINISH.dryS);
  for (let k = 0; k < 2; k++) { sim.state.t += C.FINISH.dryS + 1; assert.ok(pass().ok); }
  assert.equal(pr.members[id].coat, 3);
  assert.equal(pass().refused[0].reason, 'wet', 'no sanding wet mud');
  sim.state.t += C.FINISH.dryS + 1;
  r = pass();
  assert.ok(r.ok && r.installed.includes(id) && pr.members[id].built && near(pr.members[id].got, pr.members[id].need), 'sanded: done');
  // the rest, all the way: the stage, and the building, finish
  for (const j of joints.slice(1)) for (let k = 0; k < 4; k++) { sim.state.t += C.FINISH.dryS + 1; assert.ok(sim.commandNow('construction.install', { structId: 's1', memberIds: [j], from: 'stacks' }).ok, j); }
  assert.ok(K.stageComplete(pr, 'finish') && pr.done);
});

test('an old save whose walls were lined in one piece stays finished: its new sheets and seams count as in', async () => {
  await import('../src/framing.js');
  const F = globalThis.__framing;
  const desc = { found: 'pier-blocks', spec: { ins: 'fibreglass_batt', lining: 'gypsum' }, floors: [{ id: 'f', outline: [[0, 0], [3, 0], [3, 3], [0, 3]], y0: 0, ground: true }],
    walls: [{ id: 'w1', a: [0, 0], b: [3, 0], y0: 0, h: 2.6, out: -1, mat: 'timber', openings: [] }], roofs: [] };
  const now = F.generate(desc).map((m) => ({ ...m, struct: 's2' }));
  const before = now.filter((m) => m.kind !== 'lining' && m.kind !== 'joint').map((m) => ({ ...m, built: true }));
  before.push({ id: 'w1.ln', kind: 'lining', type: 'gypsum', stage: 'lining', parent: 'w1', struct: 's2', length: 3, built: true });
  const sim = createGameSim(4);
  assert.ok(sim.commandNow('construction.setPlan', K.planFromPieces('s2', before, F.materialsList(before), { name: 'Old room', x: 40, z: 40, r: 2 })).ok);
  assert.ok(cs(sim).progress.s2.done, 'finished in the old save');
  assert.ok(sim.commandNow('construction.setPlan', K.planFromPieces('s2', now, F.materialsList(now), { x: 40, z: 40, r: 2 })).ok);
  const pr = cs(sim).progress.s2;
  assert.ok(Object.values(pr.members).some((m) => m.kind === 'joint') && pr.done && K.liningCovered(pr, 'w1'), 'still finished after the change');
});

// ---------------------------------------------------------------- services in the walls (rough-in, trim-out: S8)
// A small walled box: roofed and sheathed (sent as built), two walls to insulate and line. Cable and pipe are planned
// on its frame through the routes commands, as services-plan.js does.
function walled(seed = 11) {
  const sim = createGameSim(seed);
  sim.state.sys.stock.money = 5000;
  sim.commandNow('construction.setOption', { key: 'instant', value: true });
  const members = [{ id: 'rf', stage: 'roofing', kind: 'roofing', parent: 'r1', built: true }, { id: 'sh', stage: 'sheathing', kind: 'sheathing', parent: 'w1', built: true }];
  for (const w of ['w1', 'w2']) members.push({ id: w + '.b1', stage: 'insulation', kind: 'batt', parent: w }, { id: w + '.b2', stage: 'insulation', kind: 'batt', parent: w }, { id: w + '.ln', stage: 'lining', kind: 'gypsum', parent: w });
  const lines = [
    { key: 'insulation|ins', stage: 'insulation', itemId: 'ins_fibreglass_89', qty: 4, unit: 'm2', label: 'Batts', members: [['w1.b1', 1], ['w1.b2', 1], ['w2.b1', 1], ['w2.b2', 1]] },
    { key: 'lining|gyp', stage: 'lining', itemId: 'gypsum_13', qty: 2, unit: 'each', label: 'Wall panels', members: [['w1.ln', 2.5], ['w2.ln', 2.5]] },
  ];
  assert.ok(sim.commandNow('construction.setPlan', { structId: 9, name: 'Box', x: 20, z: 20, r: 2, members, lines }).ok);
  const R = (n, p) => { const r = sim.commandNow('routes.' + n, p); assert.notEqual(r && r.ok, false, n + ': ' + (r && r.reason)); return r; };
  R('setFrames', { frames: { 9: { x: 20, y: 0, z: 20, yaw: 0 } } });
  return { sim, R, P: () => cs(sim).progress[9] };
}
// a cable from a panel slot to a wall box through two studs of w1 (one hole near the face), and a cold PEX run in w2
function plan(R) {
  const slot = R('addNode', { kind: 'slot', frame: '9', at: [0, 1.2, 0] }).id;
  const box = R('addNode', { kind: 'box', frame: '9', at: [2, 0.4, 0], host: { parent: 'w1' } }).id;
  const cable = R('addRun', { cls: 'cable', spec: 'cable_nm_14_2', a: slot, b: box, path: [[0, 1.2, 0], [0, 0.4, 0], [2, 0.4, 0]], hosts: ['w1'], bores: [{ at: [0.6, 0.4, 0], parent: 'w1.s1', plate: 1 }, { at: [1.2, 0.4, 0], parent: 'w1.s2' }] }).id;
  const tank = R('addNode', { kind: 'port', frame: '9', at: [0, 0.5, 2] }).id;
  const stub = R('addNode', { kind: 'stub_supply', frame: '9', at: [2, 0.5, 2], host: { parent: 'w2' }, set: { capped: true } }).id;
  const pex = R('addRun', { cls: 'supply', spec: 'pex_12_blue', a: tank, b: stub, path: [[0, 0.5, 2], [2, 0.5, 2]], hosts: ['w2'], bores: [{ at: [1, 0.5, 2], parent: 'w2.s1' }] }).id;
  return { slot, box, cable, tank, stub, pex };
}
const lineOf = (P, itemId) => Object.values(P.lines).find((l) => l.itemId === itemId && l.ext);

test('services: no runs planned, insulation goes on as before and there is no rough-in stage', () => {
  const { sim, P } = walled();
  sim.runTicks(2);
  const v = K.buildingView(cs(sim), 9);
  assert.ok(!v.stages.some((q) => q.id === 'rough-in' || q.id === 'trim-out'), v.stages.map((q) => q.id).join());
  assert.ok(K.stageOpen(P(), 'insulation'), 'nothing planned: insulation is open');
  assert.equal(C.STAGE_ORDER.indexOf('rough-in'), C.STAGE_ORDER.indexOf('gutters') + 1);
  assert.equal(C.STAGE_ORDER.indexOf('trim-out'), C.STAGE_ORDER.indexOf('finish') + 1);     // after lining and its taping (docs/design/interior-walls.md)
  assert.ok(C.UNLOCKS.find((u) => u.when === 'plan:cabin').opens.includes('services:in-wall'));
});

test('services: planned runs make a rough-in stage with its own lines; insulation waits; ordered, roughed in, covered, opened again; the books balance', () => {
  const { sim, R, P } = walled();
  const ids = plan(R);
  sim.runTicks(1);
  let v = K.buildingView(cs(sim), 9);
  const ri = v.stages.find((q) => q.id === 'rough-in');
  assert.ok(ri && ri.total > 0 && ri.built === 0, 'the Build panel lists rough-in');
  assert.deepEqual(v.stages.map((q) => q.id).filter((q) => ['rough-in', 'insulation', 'lining', 'trim-out'].includes(q)), ['rough-in', 'insulation', 'lining', 'trim-out']);
  // 2.8 m of path + 0.3 m spare at each box; 2 staples, 2 nail plates on the hole near the face; one box; 2 m + 0.4 of PEX and 2 rings
  assert.ok(near(lineOf(P(), 'nm_cable_14_2').qty, 3.4)); assert.equal(lineOf(P(), 'cable_staple').qty, 2); assert.equal(lineOf(P(), 'nail_plate').qty, 2);
  assert.equal(lineOf(P(), 'elec_box_wall').qty, 1); assert.ok(near(lineOf(P(), 'pex_coil_12_blue').qty, 2.4)); assert.equal(lineOf(P(), 'crimp_ring_12').qty, 2);
  assert.ok(lineOf(P(), 'cable_staple').supply && lineOf(P(), 'crimp_ring_12').supply && !lineOf(P(), 'nm_cable_14_2').supply, 'small supplies stay by the stacks');
  assert.equal(K.stageOpen(P(), 'insulation'), false, 'insulation waits for the rough-in');
  assert.equal(K.blocked(P(), 'w1.b1'), 'stage not open');
  // "do it for me" before anything has come: refused, nothing changes
  const v0 = sim.state.sys.routes.version;
  const no = sim.commandNow('services.auto', { structId: 9, stage: 'rough-in' });
  assert.equal(no.ok, false); assert.equal(no.reason, 'no material'); assert.equal(sim.state.sys.routes.version, v0);
  // order the stage: cable, PEX, boxes and the small supplies come as stacks
  const m0 = money(sim), o = sim.commandNow('construction.order', { structId: 9, stage: 'rough-in' });
  assert.ok(o.ok, o.reason); assert.ok(near(m0 - money(sim), o.costUsd, 1e-6) && o.costUsd > 5);
  assert.ok(near(SUP.stackQty(cs(sim), 'nm_cable_14_2'), 3.4) && SUP.stackQty(cs(sim), 'crimp_ring_12') === 2);
  // carry the spool and pull part of the cable by hand: drawn from the arms
  const sp = cs(sim).stacks.find((k) => k.itemId === 'nm_cable_14_2');
  assert.ok(sim.commandNow('construction.pickUp', { stackId: sp.id }).ok);
  R('work', { id: ids.cable, what: 'bore', n: 2 });
  const half = workCost(sim.state.sys.routes.runs[ids.cable], 'pull', { from: 0, to: 0.5 });
  assert.deepEqual(half, { nm_cable_14_2: 1.7, cable_staple: 1, nail_plate: 2 }, 'half the run: 1.4 m and the spare at the panel, a staple, the plates on the hole near the face');
  R('work', { id: ids.cable, what: 'pull', to: 0.5 });
  const use = sim.commandNow('construction.use', { structId: 9, itemId: 'nm_cable_14_2', qty: half.nm_cable_14_2, from: 'carried' });
  assert.ok(use.ok && near(use.used, 1.7), use.reason);
  for (const it of ['cable_staple', 'nail_plate']) assert.ok(sim.commandNow('construction.use', { structId: 9, itemId: it, qty: half[it], from: 'stacks' }).ok);
  assert.ok(near(lineOf(P(), 'nm_cable_14_2').used, 1.7));
  assert.equal(sim.commandNow('construction.use', { structId: 9, itemId: 'nail_plate', qty: 1, from: 'stacks', check: true }).reason, 'no material', 'both plates are on');
  assert.deepEqual(SUP.imbalance(cs(sim)), {});
  assert.ok(sim.commandNow('construction.putDown', { x: 22, z: 20 }).ok);
  // the rest by "do it for me": every run drilled, pulled and joined, the box nailed; the material used up exactly
  const a = sim.commandNow('services.auto', { structId: 9, stage: 'rough-in' });
  assert.ok(a.ok, JSON.stringify(a));
  sim.runTicks(1);
  assert.ok(K.stageComplete(P(), 'rough-in') && K.stageOpen(P(), 'insulation'), 'roughed in: insulation is open');
  for (const it of ['nm_cable_14_2', 'cable_staple', 'nail_plate', 'elec_box_wall', 'pex_coil_12_blue', 'crimp_ring_12']) assert.ok(near(lineOf(P(), it).used, lineOf(P(), it).qty), it + ' used ' + lineOf(P(), it).used + ' of ' + lineOf(P(), it).qty);
  assert.ok(near(SUP.stackQty(cs(sim), 'nm_cable_14_2'), 1 - 1, 1e-6) || SUP.stackQty(cs(sim), 'nm_cable_14_2') < 1e-6, 'the spool is used up');
  assert.deepEqual(SUP.imbalance(cs(sim)), {});
  // insulate and line w1: the cable in it is covered, and a new run planned there cannot be worked on
  assert.ok(sim.commandNow('construction.order', { structId: 9, stage: 'all' }).ok);
  assert.ok(sim.commandNow('construction.install', { structId: 9, memberIds: ['w1.b1', 'w1.b2', 'w2.b1', 'w2.b2'], from: 'stacks' }).ok);
  assert.ok(sim.commandNow('construction.install', { structId: 9, memberIds: ['w1.ln'], from: 'stacks' }).ok);
  sim.runTicks(1);
  assert.ok(sim.state.sys.services.covered[ids.cable] && !sim.state.sys.services.covered[ids.pex], 'only the run in the lined wall is covered');
  const box2 = R('addNode', { kind: 'box', frame: '9', at: [1.6, 1.2, 0], host: { parent: 'w1' } }).id;
  const late = R('addRun', { cls: 'cable', spec: 'cable_nm_14_2', a: ids.box, b: box2, path: [[2, 0.4, 0], [1.6, 0.4, 0], [1.6, 1.2, 0]], hosts: ['w1'], bores: [{ at: [1.8, 0.4, 0], parent: 'w1.s3' }] }).id;
  sim.runTicks(1);
  assert.equal(sim.commandNow('routes.work', { id: late, what: 'bore', n: 1 }).reason, 'Open this wall first');
  assert.equal(K.stageComplete(P(), 'rough-in'), false, 'the new run is rough-in work again');
  // open the wall: the lining and batts of w1 come off (the batts of w2 stay), the run is uncovered
  const op = sim.commandNow('services.openWall', { structId: 9, host: 'w1' });
  assert.ok(op.ok, op.reason); assert.deepEqual(op.removed.sort(), ['w1.b1', 'w1.b2', 'w1.ln']);
  assert.ok(!sim.state.sys.services.covered[late]);
  assert.ok(sim.commandNow('routes.work', { id: late, what: 'bore', n: 1 }).ok);
  assert.deepEqual(SUP.imbalance(cs(sim)), {});
  assert.deepEqual(K.sheetImbalance(cs(sim)), {});
});

test('services: "Close up anyway" leaves unfinished runs out of the tally; trim-out by "do it for me" finishes the building', () => {
  const { sim, R, P } = walled(12);
  const ids = plan(R);
  sim.runTicks(1);
  assert.equal(K.stageOpen(P(), 'insulation'), false);
  const d = sim.commandNow('services.defer', { structId: 9 });
  assert.ok(d.ok && d.deferred >= 3, JSON.stringify(d));
  assert.ok(K.stageOpen(P(), 'insulation'), 'closed up anyway: insulation is open');
  assert.ok(sim.state.sys.routes.runs[ids.cable], 'the run stays, as a plan line');
  assert.ok(!K.buildingView(cs(sim), 9).stages.some((q) => q.id === 'rough-in' && q.total > 0));
  // undo, rough it in, and finish
  assert.ok(sim.commandNow('services.defer', { structId: 9, undo: true }).ok);
  assert.equal(K.stageOpen(P(), 'insulation'), false);
  assert.ok(sim.commandNow('construction.order', { structId: 9, stage: 'all' }).ok);
  assert.ok(sim.commandNow('services.auto', { structId: 9, stage: 'rough-in' }).ok);
  sim.runTicks(1);
  assert.ok(sim.commandNow('construction.install', { structId: 9, memberIds: ['w1.b1', 'w1.b2', 'w2.b1', 'w2.b2', 'w1.ln', 'w2.ln'], from: 'stacks' }).ok);
  sim.runTicks(1);
  assert.equal(P().done, false, 'trim-out is still to do');
  assert.ok(K.stageOpen(P(), 'trim-out'));
  const t = sim.commandNow('services.auto', { structId: 9, stage: 'trim-out' });
  assert.ok(t.ok, t.reason);
  sim.runTicks(1);
  assert.ok(K.stageComplete(P(), 'trim-out') && P().done, 'finished');
  assert.equal(sim.state.sys.routes.nodes[ids.box].set.device, 'outlet_120v');
  assert.deepEqual(SUP.imbalance(cs(sim)), {});
});

test('construction.setExternal and setExtLines on their own: a stage tallied outside, lines kept through a new plan, sandbox uses are free', () => {
  const { sim, P } = walled(13);
  assert.equal(sim.commandNow('construction.setExternal', { structId: 9, stage: 'nope', built: 0, total: 1 }).reason, 'unknown stage');
  assert.ok(sim.commandNow('construction.setExternal', { structId: 9, stage: 'rough-in', built: 1, total: 4 }).ok);
  assert.deepEqual(P().tally['rough-in'], [1, 4]);
  assert.ok(sim.commandNow('construction.setExtLines', { structId: 9, source: 'test', lines: [{ stage: 'rough-in', itemId: 'nm_cable_12_2', qty: 10, label: 'Cable' }] }).ok);
  assert.ok(near(K.quoteStage(P(), 'rough-in').costUsd, 20));
  assert.ok(sim.commandNow('construction.order', { structId: 9, stage: 'rough-in' }).ok);
  // the plan is sent again (build mode changed something): the outside tally and lines stay, ordered and all
  const again = { structId: 9, name: 'Box', x: 20, z: 20, r: 2, members: Object.entries(P().members).map(([id, m]) => ({ id, stage: m.stage, kind: m.kind, parent: m.parent, built: !!m.built })), lines: [] };
  assert.ok(sim.commandNow('construction.setPlan', again).ok);
  assert.deepEqual(P().tally['rough-in'], [1, 4]);
  assert.equal(lineOf(P(), 'nm_cable_12_2').ordered, 10);
  // fewer metres wanted than were used: the line stays at what went in
  assert.ok(sim.commandNow('construction.use', { structId: 9, itemId: 'nm_cable_12_2', qty: 6, from: 'stacks' }).ok);
  assert.ok(sim.commandNow('construction.setExtLines', { structId: 9, source: 'test', lines: [] }).ok);
  assert.equal(lineOf(P(), 'nm_cable_12_2').qty, 6);
  assert.deepEqual(SUP.imbalance(cs(sim)), {});
  assert.ok(sim.commandNow('construction.setOption', { key: 'sandbox', value: true }).ok);
  assert.ok(sim.commandNow('construction.use', { structId: 9, itemId: 'nm_cable_12_2', qty: 100, from: 'stacks' }).free);
});

test('keep: what other systems keep on a building survives a plan sent again (hold, ext, extLines, and a key nobody here knows)', () => {
  const sim = start();
  assert.ok(sim.commandNow('construction.setHold', { structId: shed.struct, stage: 'wall-frame', reason: 'green concrete' }).ok);
  assert.ok(sim.commandNow('construction.setExternal', { structId: shed.struct, stage: 'rough-in', built: 1, total: 3 }).ok);
  assert.ok(sim.commandNow('construction.setExtLines', { structId: shed.struct, source: 'svc', lines: [], sig: 'a' }).ok);
  pr(sim).keep.someoneElse = { n: 5, deep: { x: [1, 2] } };
  const again = () => assert.ok(sim.commandNow('construction.setPlan', K.planFromPieces(shed.struct, shed.pieces, shed.materialsList, { name: 'Tool shed', planId: 'shed', tutorial: true, x: 40, z: 40, r: 2 })).ok);
  again(); again();
  const P = pr(sim);
  assert.deepEqual(P.keep.someoneElse, { n: 5, deep: { x: [1, 2] } });
  assert.equal(P.keep.hold['wall-frame'], 'green concrete');
  assert.deepEqual(P.keep.ext['rough-in'], [1, 3]);
  assert.equal(P.keep.extLines.svc.sig, 'a');
  assert.ok(P.keep !== undefined && P.ext === undefined && P.hold === undefined && P.extLines === undefined);
  assert.ok(K.blocked(P, Object.keys(P.members).find((id) => P.members[id].stage === 'wall-frame')) === 'green concrete');
});

test('keep: an old save with ext, extLines and hold on the record itself still loads and works', () => {
  const sim = start();
  const P = pr(sim);
  P.hold = { 'wall-frame': 'old hold' }; P.ext = { 'rough-in': [2, 4] }; P.extLines = { svc: { sig: 'z', lines: [] } };
  delete P.keep;
  const sim2 = createGameSim(7);
  sim2.state.sys = JSON.parse(JSON.stringify(sim.state.sys));
  const Q = pr(sim2);
  assert.equal(K.kept(Q, 'hold')['wall-frame'], 'old hold');
  assert.ok(!K.stageOpen(Q, 'wall-frame'));
  assert.ok(sim2.commandNow('construction.setHold', { structId: shed.struct, stage: 'wall-frame', reason: null }).ok);
  assert.deepEqual(Q.keep.ext['rough-in'], [2, 4]);
  assert.equal(Q.hold, undefined);
  assert.ok(sim2.commandNow('construction.setPlan', K.planFromPieces(shed.struct, shed.pieces, shed.materialsList, { name: 'Tool shed', planId: 'shed', tutorial: true, x: 40, z: 40, r: 2 })).ok);
  assert.equal(pr(sim2).keep.extLines.svc.sig, 'z');
  assert.deepEqual(pr(sim2).tally['rough-in'], [2, 4]);
});
