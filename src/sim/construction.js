// The construction system: a planned building is ordered, delivered as stacks, carried and put together
// member by member, stage by stage (docs/CONSTRUCTION.md). The mechanism for orders, stacks and carrying is
// src/sim/core/supply.js; the stages, texts, prices of missing items and rates are src/sim/content/construction.js.
//
// State, at sim.state.sys.construction:
//   { dropPoint, orders, deliveries, stacks: [{ id, itemId, qty, x, z }], carried: { itemId, qty } | null, nextId, ledger,
//     level: "guided" | "hands-on" | "piece"            (the default for new buildings),
//     progress: { [structId]: { id, name, planId, x, z, r, level, stage, done, lines, members, tally, raised } },
//     unlocked: [...], tutorial: { card, shed, seen: { [stage]: true }, done }, options: { sandbox, instant, cards, auto, mute }, finished }
//   progress[..].lines[key]   = { stage, itemId, qty, unit, label, why, count, supply, ordered, used }
//   progress[..].members[id]  = { stage, kind, parent, line, need, got, built }
// Build mode owns the shape of a building; the page hands its members and shopping lines to construction.setPlan.
// Commands return { ok, reason? ... } and change nothing when they fail.

import { ITEMS } from './items.js';
import * as SUP from './core/supply.js';
import * as C from './content/construction.js';

const { round6, cents } = SUP;
export const CONSTRUCTION_CATALOG = Object.freeze({ ...C.ITEMS_CONSTRUCTION, ...ITEMS });
const item = (id) => CONSTRUCTION_CATALOG[id];
const LEVELS = ['guided', 'hands-on', 'piece'];
const isSupply = (itemId) => C.SITE_SUPPLY.includes(itemId);

export function initConstruction() {
  return {
    ...SUP.initSupply(),
    level: 'hands-on',
    progress: {},
    unlocked: [...C.UNLOCKS[0].opens],
    tutorial: { card: false, shed: null, seen: {}, done: false },
    options: { sandbox: false, instant: false, cards: true, auto: false, mute: false },
    finished: 0,
  };
}

// ---------------------------------------------------------------- reading a building's progress (pure)
const membersOfStage = (pr, stage) => Object.keys(pr.members).filter((id) => pr.members[id].stage === stage);
// the frames of a lie-flat stage, in the order they are put together
export function flatParents(pr, stage) {
  const out = [];
  for (const id in pr.members) { const m = pr.members[id]; if (m.stage === stage && !out.includes(m.parent)) out.push(m.parent); }
  return out;
}
export function stageComplete(pr, stage) {
  const t = pr.tally[stage];
  if (t && t[0] < t[1]) return false;
  if (C.STAGE[stage] && C.STAGE[stage].flat && t && t[1]) for (const p of flatParents(pr, stage)) if (!pr.raised[p]) return false;
  return true;
}
// complete, and so is everything it stands on
export function stageSatisfied(pr, stage, seen = {}) {
  if (seen[stage] !== undefined) return seen[stage];
  seen[stage] = false;
  const def = C.STAGE[stage];
  let ok = stageComplete(pr, stage);
  if (ok && def) for (const n of def.needs) if (!stageSatisfied(pr, n, seen)) { ok = false; break; }
  return (seen[stage] = ok);
}
export function stageOpen(pr, stage) {
  const def = C.STAGE[stage];
  if (!def) return false;
  const seen = {};
  return def.needs.every((n) => stageSatisfied(pr, n, seen));
}
// the frame of a lie-flat stage being worked on now: the first not yet raised
export function flatCurrent(pr, stage) {
  for (const p of flatParents(pr, stage)) if (!pr.raised[p]) return p;
  return null;
}
export function frameReady(pr, stage, parent) {
  let n = 0;
  for (const id in pr.members) { const m = pr.members[id]; if (m.stage === stage && m.parent === parent) { if (!m.built) return false; n++; } }
  return n > 0;
}
// why a member cannot go in yet, or null if it can
export function blocked(pr, id) {
  const m = pr.members[id];
  if (!m) return 'unknown member';
  if (m.built) return 'already built';
  const def = C.STAGE[m.stage];
  if (!def) return 'not part of the build';
  if (!stageOpen(pr, m.stage)) return 'stage not open';
  if (def.parentFirst) for (const o in pr.members) { const q = pr.members[o]; if (!q.built && q.parent === m.parent && def.parentFirst.includes(q.stage)) return 'frame not finished'; }
  if (def.flat && flatCurrent(pr, m.stage) !== m.parent) return 'one frame at a time';
  return null;
}
export const installable = (pr) => Object.keys(pr.members).filter((id) => !pr.members[id].built && !blocked(pr, id));
// the stages that can be worked on now (open, not complete), in order
export function openStages(pr) {
  return C.STAGE_ORDER.filter((st) => pr.tally[st] && pr.tally[st][1] && !stageComplete(pr, st) && stageOpen(pr, st));
}
export function buildingDone(pr) {
  for (const st in pr.tally) if (!stageComplete(pr, st)) return false;
  return Object.keys(pr.members).length > 0;
}
// what one stage (or "all") still costs to order: { ok, costUsd, lines }
export function quoteStage(pr, stage) {
  const lines = [];
  for (const key in pr.lines) {
    const ln = pr.lines[key];
    if (stage !== 'all' && ln.stage !== stage) continue;
    const qty = round6(ln.qty - ln.ordered);
    if (qty > 1e-6) lines.push({ itemId: ln.itemId, qty, key });
  }
  const q = SUP.quote(lines, CONSTRUCTION_CATALOG);
  if (q.ok) q.keys = lines.map((l) => l.key);
  return q;
}
// how much of an item the open stages of every building still want
export function wanted(s, itemId) {
  let n = 0;
  for (const sid in s.progress) {
    const pr = s.progress[sid], open = {};
    for (const id in pr.members) {
      const m = pr.members[id];
      if (m.built || !m.line || pr.lines[m.line].itemId !== itemId) continue;
      if (open[m.stage] === undefined) open[m.stage] = stageOpen(pr, m.stage);
      if (open[m.stage]) n += m.need - m.got;
    }
  }
  return round6(n);
}
// a stage as the Build panel shows it
export function stageView(s, pr, stage) {
  const def = C.STAGE[stage], t = pr.tally[stage] || [0, 0];
  const lines = Object.keys(pr.lines).filter((k) => pr.lines[k].stage === stage).map((k) => {
    const ln = pr.lines[k], it = item(ln.itemId);
    return { key: k, label: ln.label, why: ln.why, qty: ln.qty, unit: ln.unit, count: ln.count, itemId: ln.itemId, itemName: it ? it.name : ln.itemId, costUsd: it ? cents(it.priceUsd * ln.qty) : 0, ordered: ln.ordered, used: ln.used, supply: ln.supply };
  });
  const q = quoteStage(pr, stage);
  const need = lines.some((l) => l.ordered + 1e-6 < l.qty);
  const pending = s.deliveries.some((d) => d.tag && d.tag.structId === pr.id && d.tag.stages.includes(stage));
  const complete = stageComplete(pr, stage), open = stageOpen(pr, stage);
  let status = complete ? 'done' : t[0] > 0 || (def.flat && Object.keys(pr.raised).length) ? 'progress' : need ? 'not-ordered' : pending ? 'ordered' : lines.length ? 'delivered' : 'ready';
  return { id: stage, name: def.name, what: def.what, why: def.why, verb: def.verb, built: t[0], total: t[1], open, complete, status, lines, costUsd: lines.reduce((n, l) => cents(n + l.costUsd), 0), toOrderUsd: q.ok ? q.costUsd : 0, pending };
}
export function buildingView(s, structId) {
  const pr = s.progress[structId];
  if (!pr) return null;
  const stages = C.STAGE_ORDER.filter((st) => pr.tally[st] && pr.tally[st][1]).map((st) => stageView(s, pr, st));
  const next = stages.find((v) => v.open && !v.complete) || null;
  const qa = quoteStage(pr, 'all');
  let built = 0, total = 0;
  for (const v of stages) { built += v.built; total += v.total; }
  return { id: pr.id, name: pr.name, planId: pr.planId, level: pr.level, done: pr.done, stages, next: next ? next.id : null, costUsd: stages.reduce((n, v) => cents(n + v.costUsd), 0), toOrderUsd: qa.ok ? qa.costUsd : 0, built, total };
}
// which of the first-shed steps the player is on (1..13), or 14 when the shed is finished
export function tutorialStep(s) {
  const t = s.tutorial, pr = t.shed !== null ? s.progress[t.shed] : null;
  if (t.done) return 14;
  if (!pr) return 1;
  if (Object.values(pr.lines).every((l) => l.ordered <= 1e-9)) return 2;
  for (const st of C.FIRST_SHED.steps) {
    if (!st.stages) continue;
    if (st.walls) { if (Object.keys(pr.raised).length < st.walls) return st.n; continue; }
    if (!st.stages.every((g) => stageComplete(pr, g))) return st.n;
  }
  return 13;
}
export const carriedMassKg = (s) => (s.carried ? s.carried.qty * item(s.carried.itemId).massKgPerUnit : 0);

// Build mode's pieces and shopping lines for one building, as the payload of construction.setPlan.
export function planFromPieces(structId, pieces, lines, extra = {}) {
  const members = [];
  for (const p of pieces) if (p.struct === structId && p.stage && p.parent && C.STAGE[p.stage]) members.push({ id: p.id, stage: p.stage, kind: p.kind, parent: p.parent, built: p.built !== false });
  return { structId, members, lines: lines.map((l) => ({ key: l.key, stage: l.stage, itemId: l.itemId, qty: l.qty, unit: l.unit, label: l.label, why: l.why, count: l.count, members: l.members })), ...extra };
}

// ---------------------------------------------------------------- helpers that change state
// Money and project cards belong to the stock system. Until it grows a "pay" command, money is moved here by its
// own rule (exact cents, never below zero), and cards go through its command handlers.
function pay(ctx, costUsd) {
  const st = ctx.get('stock');
  if (!st || st.money + 1e-9 < costUsd) return false;
  st.money = cents(st.money - costUsd);
  return true;
}
function stockCall(ctx, name, payload) {
  const h = ctx.sim && ctx.sim.handlers.get(name);
  if (!h || !ctx.state.sys.stock) return null;
  return h.fn({ sim: ctx.sim, state: ctx.state, get s() { return ctx.state.sys.stock; }, get: ctx.get, emit: ctx.emit }, payload);
}
function ensureCard(ctx, s) {
  if (s.tutorial.card) return;
  const st = ctx.state.sys.stock;
  if (!st) return;
  if (!st.projects.some((p) => p.id === C.FIRST_SHED.projectId)) stockCall(ctx, 'projects.add', { id: C.FIRST_SHED.projectId, title: C.FIRST_SHED.title, blurb: C.FIRST_SHED.blurb });
  s.tutorial.card = true;
}
function retally(pr) {
  pr.tally = {};
  for (const id in pr.members) { const m = pr.members[id]; const t = pr.tally[m.stage] || (pr.tally[m.stage] = [0, 0]); t[1]++; if (m.built) t[0]++; }
}
function refresh(ctx, s, pr) {
  const was = pr.done;
  pr.stage = openStages(pr)[0] || null;
  pr.done = buildingDone(pr);
  if (pr.done && !was) {
    s.finished++;
    const open = (when) => { const u = C.UNLOCKS.find((q) => q.when === when); if (u) for (const o of u.opens) s.unlocked.includes(o) || s.unlocked.push(o); };
    if (pr.planId) open('plan:' + pr.planId);
    if (s.finished >= 2) open('buildings:2');
    if (pr.planId === 'shed' && !s.tutorial.done) { s.tutorial.done = true; stockCall(ctx, 'projects.done', { id: C.FIRST_SHED.projectId }); }
    ctx.emit('construction.finished', { structId: pr.id, planId: pr.planId });
  }
}
// fasteners and the like: used up from the stacks in step with the stage's progress. check: only say whether there is enough.
function supplies(s, pr, stage, builtAfter, check) {
  const t = pr.tally[stage];
  for (const key in pr.lines) {
    const ln = pr.lines[key];
    if (!ln.supply || ln.stage !== stage || !t || !t[1]) continue;
    const target = round6((ln.qty * builtAfter) / t[1]), d = round6(target - ln.used);
    if (d > 1e-6) {
      if (SUP.stackQty(s, ln.itemId) + 1e-6 < d) return ln.itemId;
      if (!check) { SUP.useFromStacks(s, ln.itemId, d, pr.x, pr.z, { partial: true }); ln.used = target; }
    } else if (d < -1e-6 && !check) {       // taken apart: bent nails are spent, they do not come back
      const L = s.ledger[ln.itemId];
      L.used = round6(L.used + d); L.spent = round6(L.spent - d); ln.used = target;
    }
  }
  return null;
}
const dropOf = (s, pr) => s.dropPoint || { x: pr.x + pr.r + 2.5, z: pr.z };

// ---------------------------------------------------------------- commands
function setPlan(ctx, p) {
  const s = ctx.s;
  if (!p || p.structId === undefined || !Array.isArray(p.members) || !Array.isArray(p.lines)) return { ok: false, reason: 'bad plan' };
  const old = s.progress[p.structId];
  const pr = { id: p.structId, name: p.name || (old && old.name) || 'Building', planId: p.planId !== undefined ? p.planId : old ? old.planId : null,
    x: +p.x || 0, z: +p.z || 0, r: +p.r || 2, level: (old && old.level) || s.level, stage: null, done: false, lines: {}, members: {}, tally: {}, raised: {} };
  for (const m of p.members) {
    if (!C.STAGE[m.stage]) continue;
    const o = old && old.members[m.id];
    pr.members[m.id] = { stage: m.stage, kind: m.kind, parent: m.parent || null, line: null, need: 0, got: o ? o.got : 0, built: p.built ? (m.built ? 1 : 0) : o ? o.built : 0 };
  }
  for (const ln of p.lines) {
    if (!C.STAGE[ln.stage]) continue;
    const name = String(ln.key).split('|')[1], map = C.LINE_ITEM[name], o = old && old.lines[ln.key];
    const own = (ln.members || []).filter((q) => pr.members[q[0]]);
    const itemId = (map && map.itemId) || ln.itemId;
    const each = !!(map && map.each);
    const qty = each ? own.length : round6(ln.qty);
    const L = { stage: ln.stage, itemId, qty, unit: each ? 'each' : ln.unit, label: (map && map.label) || ln.label, why: ln.why || '', count: ln.count || own.length, supply: isSupply(itemId), ordered: o ? o.ordered : 0, used: 0 };
    if (!item(itemId) || !(qty > 0)) continue;
    pr.lines[ln.key] = L;
    // each member's share of the line, so that the shares add up to exactly what was bought
    let wsum = 0, cum = 0, prev = 0;
    for (const q of own) wsum += each ? 1 : q[1] || 0;
    for (const q of own) {
      cum += each ? 1 : q[1] || 0;
      const upto = wsum > 0 ? round6((qty * cum) / wsum) : 0, m = pr.members[q[0]];
      m.line = ln.key; m.need = round6(upto - prev); prev = upto;
      if (m.built) m.got = m.need;
      L.used = round6(L.used + m.got);
    }
  }
  if (old) for (const k in old.raised) pr.raised[k] = true;
  if (p.built) for (const st of C.STAGES) if (st.flat) for (const par of flatParents(pr, st.id)) if (frameReady(pr, st.id, par)) pr.raised[par] = true;
  retally(pr);
  for (const key in pr.lines) { const ln = pr.lines[key]; if (ln.supply) { const t = pr.tally[ln.stage]; ln.used = old && old.lines[key] ? Math.min(old.lines[key].used, ln.qty) : 0; if (p.built && t && t[1]) ln.used = round6((ln.qty * t[0]) / t[1]); } }
  s.progress[p.structId] = pr;
  if (p.tutorial && s.tutorial.shed === null && !s.tutorial.done) s.tutorial.shed = p.structId;
  const was = old ? old.done : false;
  pr.done = was;
  refresh(ctx, s, pr);
  return { ok: true, structId: pr.id, stage: pr.stage };
}

function order(ctx, p) {
  const s = ctx.s, pr = s.progress[p && p.structId];
  if (!pr) return { ok: false, reason: 'unknown building' };
  const stage = p.stage || 'all';
  if (stage !== 'all' && !C.STAGE[stage]) return { ok: false, reason: 'unknown stage' };
  const q = quoteStage(pr, stage);
  if (!q.ok) return { ok: false, reason: q.reason };
  const at = dropOf(s, pr);
  if (!s.dropPoint) s.dropPoint = { x: at.x, z: at.z };
  const stages = [...new Set(q.keys.map((k) => pr.lines[k].stage))];
  const r = SUP.placeOrder(s, q, { t: ctx.state.t, delayS: s.options.instant ? 0 : C.DELIVERY.delayS, tag: { structId: pr.id, stages }, pay: (usd) => pay(ctx, usd), x: at.x, z: at.z });
  if (!r.ok) { ctx.emit('construction.order', { ok: false, reason: r.reason, costUsd: r.costUsd }); return r; }
  q.keys.forEach((k, i) => { pr.lines[k].ordered = round6(pr.lines[k].ordered + q.lines[i].qty); });
  const out = { ok: true, costUsd: r.costUsd, deliveryId: r.delivery.id, dueT: r.delivery.dueT, stages, lines: q.lines };
  ctx.emit('construction.order', out);
  if (s.options.instant) land(ctx, s, r.delivery.id);
  return out;
}
function land(ctx, s, id) {
  const r = SUP.deliver(s, id, C.DELIVERY.layout);
  if (r.ok) ctx.emit('construction.delivered', { deliveryId: id, stacks: r.stacks, x: r.delivery.x, z: r.delivery.z, tag: r.delivery.tag });
  return r;
}

function pickUp(ctx, p) {
  const s = ctx.s, st = s.stacks.find((k) => k.id === (p && p.stackId));
  if (!st) return { ok: false, reason: 'no such stack' };
  if (isSupply(st.itemId)) return { ok: false, reason: 'stays by the stacks' };
  const it = item(st.itemId), tools = (ctx.get('stock') || {}).tools || [];
  const have = s.carried && s.carried.itemId === st.itemId ? s.carried.qty : 0;
  const w = wanted(s, st.itemId);
  const want = p.qty > 0 ? have + p.qty : w > have + 1e-6 ? w : Infinity;
  const r = SUP.takeFromStack(s, st.id, { massKgPerUnit: it.massKgPerUnit, limitKg: C.carryLimitKg(tools), want, minQty: it.unit === 'each' ? 1 : 0 });
  if (r.ok) ctx.emit('construction.carry', { itemId: r.itemId, qty: r.carried.qty });
  return r;
}
function putDownCmd(ctx, p) {
  const r = SUP.putDown(ctx.s, p || {}, C.DELIVERY.layout);
  if (r.ok) ctx.emit('construction.carry', { itemId: null, qty: 0 });
  return r;
}

function install(ctx, p) {
  const s = ctx.s, pr = s.progress[p && p.structId];
  if (!pr) return { ok: false, reason: 'unknown building' };
  const fromStacks = p.from === 'stacks';
  const out = { ok: false, installed: [], partial: [], refused: [], stagesDone: [], done: false };
  const before = new Set(C.STAGE_ORDER.filter((st) => stageComplete(pr, st)));
  for (const id of p.memberIds || []) {
    const m = pr.members[id];
    const why = blocked(pr, id);
    if (why) { out.refused.push({ id, reason: why }); break; }
    const ln = m.line ? pr.lines[m.line] : null, need = round6(m.need - m.got);
    let give = 0;
    if (ln && need > 1e-6) {
      if (fromStacks) { if (SUP.stackQty(s, ln.itemId) + 1e-6 < need) { out.refused.push({ id, reason: 'no material', itemId: ln.itemId }); break; } give = need; }
      else {
        if (!s.carried || s.carried.itemId !== ln.itemId) { out.refused.push({ id, reason: s.carried ? 'wrong material' : 'no material', itemId: ln.itemId }); break; }
        give = Math.min(need, s.carried.qty);
      }
    }
    const completes = !ln || give + 1e-6 >= need;
    if (completes) { const lack = supplies(s, pr, m.stage, pr.tally[m.stage][0] + 1, true); if (lack) { out.refused.push({ id, reason: 'no fasteners', itemId: lack }); break; } }
    if (give > 0) {
      const used = fromStacks ? SUP.useFromStacks(s, ln.itemId, give, pr.x, pr.z) : SUP.useCarried(s, ln.itemId, give);
      m.got = round6(m.got + used); ln.used = round6(ln.used + used);
    }
    if (completes) {
      m.got = m.need; m.built = 1; pr.tally[m.stage][0]++;
      supplies(s, pr, m.stage, pr.tally[m.stage][0], false);
      out.installed.push(id);
    } else { out.partial.push({ id, got: m.got, need: m.need }); break; }
  }
  out.ok = out.installed.length > 0 || out.partial.length > 0;
  if (!out.ok) { out.reason = out.refused[0] ? out.refused[0].reason : 'nothing to do'; if (out.refused[0] && out.refused[0].itemId) out.itemId = out.refused[0].itemId; return out; }
  refresh(ctx, s, pr);
  out.stagesDone = C.STAGE_ORDER.filter((st) => !before.has(st) && stageComplete(pr, st));
  out.done = pr.done; out.stage = pr.stage; out.carried = s.carried;
  ctx.emit('construction.installed', { structId: pr.id, ids: out.installed, stagesDone: out.stagesDone, done: out.done });
  return out;
}

function raise(ctx, p) {
  const s = ctx.s, pr = s.progress[p && p.structId];
  if (!pr) return { ok: false, reason: 'unknown building' };
  const st = C.STAGES.find((q) => q.flat && flatParents(pr, q.id).includes(p.parent));
  if (!st) return { ok: false, reason: 'nothing to raise' };
  if (pr.raised[p.parent]) return { ok: false, reason: 'already raised' };
  if (flatCurrent(pr, st.id) !== p.parent || !frameReady(pr, st.id, p.parent)) return { ok: false, reason: 'frame not finished' };
  const was = stageComplete(pr, st.id);
  pr.raised[p.parent] = true;
  refresh(ctx, s, pr);
  const out = { ok: true, parent: p.parent, stagesDone: !was && stageComplete(pr, st.id) ? [st.id] : [], done: pr.done, stage: pr.stage };
  ctx.emit('construction.raised', { structId: pr.id, parent: p.parent });
  return out;
}

// taking apart goes in reverse: nothing that stands on a member may still be built
function dismantle(ctx, p) {
  const s = ctx.s, pr = s.progress[p && p.structId];
  if (!pr) return { ok: false, reason: 'unknown building' };
  const out = { ok: false, removed: [], refused: [], returned: {} };
  const at = dropOf(s, pr);
  const standsOn = (stage) => C.STAGES.filter((q) => q.needs.includes(stage) || (q.parentFirst || []).includes(stage)).map((q) => q.id);
  const anyBuilt = (stage, seen = {}) => { if (seen[stage]) return false; seen[stage] = 1; const t = pr.tally[stage]; return (t && t[0] > 0) || standsOn(stage).some((q) => anyBuilt(q, seen)); };
  for (const id of p.memberIds || []) {
    const m = pr.members[id];
    if (!m || !(m.built || m.got > 0)) { out.refused.push({ id, reason: 'not built' }); continue; }
    if (standsOn(m.stage).some((q) => anyBuilt(q))) { out.refused.push({ id, reason: 'something stands on it' }); continue; }
    const ln = m.line ? pr.lines[m.line] : null;
    if (ln && m.got > 0) {
      SUP.giveBack(s, ln.itemId, m.got, at.x, at.z, C.DELIVERY.layout);
      ln.used = round6(ln.used - m.got);
      out.returned[ln.itemId] = round6((out.returned[ln.itemId] || 0) + m.got);
    }
    if (m.built) { m.built = 0; pr.tally[m.stage][0]--; supplies(s, pr, m.stage, pr.tally[m.stage][0], false); }
    m.got = 0;
    if (C.STAGE[m.stage].flat && m.parent) delete pr.raised[m.parent];
    out.removed.push(id);
  }
  out.ok = out.removed.length > 0;
  if (!out.ok) { out.reason = out.refused[0] ? out.refused[0].reason : 'nothing to take apart'; return out; }
  refresh(ctx, s, pr);
  ctx.emit('construction.dismantled', { structId: pr.id, ids: out.removed });
  return out;
}

export const constructionSystem = () => ({
  name: 'construction',
  every: 1,
  init: (ctx) => { const s = initConstruction(); ensureCard(ctx, s); return s; },
  step: (ctx) => {
    const s = ctx.s;
    if (!s.tutorial.card) ensureCard(ctx, s);
    if (!s.deliveries.length) return;
    for (const d of SUP.dueDeliveries(s, ctx.state.t)) land(ctx, s, d.id);
  },
  commands: {
    'construction.setPlan': setPlan,
    'construction.forget': (c, p) => { if (!c.s.progress[p.structId]) return { ok: false, reason: 'unknown building' }; delete c.s.progress[p.structId]; if (c.s.tutorial.shed === p.structId) c.s.tutorial.shed = null; return { ok: true }; },
    'construction.setDropPoint': (c, p) => { if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return { ok: false, reason: 'bad place' }; c.s.dropPoint = { x: round6(p.x), z: round6(p.z) }; for (const d of c.s.deliveries) { d.x = c.s.dropPoint.x; d.z = c.s.dropPoint.z; } return { ok: true }; },
    'construction.order': order,
    'construction.deliverNow': (c, p) => { const ids = c.s.deliveries.filter((d) => !p || !p.deliveryId || d.id === p.deliveryId).map((d) => d.id); for (const id of ids) land(c, c.s, id); return { ok: ids.length > 0, delivered: ids }; },
    'construction.pickUp': pickUp,
    'construction.putDown': putDownCmd,
    'construction.install': install,
    'construction.raise': raise,
    'construction.dismantle': dismantle,
    'construction.setLevel': (c, p) => { if (!LEVELS.includes(p.level)) return { ok: false, reason: 'unknown level' }; const pr = c.s.progress[p.structId]; if (pr) pr.level = p.level; else c.s.level = p.level; return { ok: true }; },
    'construction.setOption': (c, p) => { if (!p || !(p.key in c.s.options)) return { ok: false, reason: 'unknown option' }; c.s.options[p.key] = !!p.value; if (p.key === 'sandbox') c.emit('construction.sandbox', { on: !!p.value }); return { ok: true }; },
    'construction.seeCard': (c, p) => { c.s.tutorial.seen[p.stage] = true; return { ok: true }; },
  },
  api: { content: C, planFromPieces, catalog: CONSTRUCTION_CATALOG, buildingView, stageView, installable, blocked, openStages, stageOpen, stageComplete, flatCurrent, flatParents, frameReady, quoteStage, wanted, tutorialStep, carriedMassKg, imbalance: SUP.imbalance },
});
