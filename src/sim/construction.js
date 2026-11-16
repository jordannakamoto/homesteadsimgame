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
const LADDER_KEY = C.LADDER.stage + '|ladder';
const o_cut = (old, id) => (old && old.members[id] && old.members[id].cut) || null;
export const CONSTRUCTION_CATALOG = Object.freeze({ ...C.ITEMS_CONSTRUCTION, ...ITEMS });
const item = (id) => CONSTRUCTION_CATALOG[id];
const LEVELS = ['guided', 'hands-on', 'piece'];
const isSupply = (itemId) => C.SITE_SUPPLY.includes(itemId);

export function initConstruction() {
  return {
    ...SUP.initSupply(),
    level: 'hands-on',
    progress: {},
    open: {},                         // doors and windows the hands have opened, by piece id
    learn: { counts: {}, known: {} },   // pieces nailed by hand, by kind of work; a kind with enough of them is known
    ladder: null,                     // { x, z, yaw, topY, structId } when one is leaned on a wall
    offcuts: {},                      // { [itemId]: [area m2, ...] } pieces of sheet goods kept from cutting
    waste: {},                        // { [itemId]: area m2 } offcuts too small to keep
    horses: null,                     // { x, z, yaw }: the sawhorses, the cut station, set by the work once lumber has come
    unlocked: [...C.UNLOCKS[0].opens],
    tutorial: { card: false, shed: null, seen: {}, done: false },
    options: { sandbox: false, instant: false, cards: true, auto: false, mute: true, gesture: 3 },   // sound is off until it has been tuned
    feel: { ...C.FEEL },
    barrow: null,                     // { x, z, yaw, held } once the first delivery has landed; its load is the stack flagged `barrow`
    finished: 0,
  };
}

// ---------------------------------------------------------------- sheet goods: cut to fit, offcuts reused
const isSheetItem = (itemId) => { const it = item(itemId); return !!it && it.category === 'sheet' && it.unit === 'each'; };
const sheetAreaOf = (itemId) => { const d = (item(itemId) || {}).dims; return d && d.widthM && d.lengthM ? d.widthM * d.lengthM : C.SHEET.areaM2; };
const placed = (m) => m.built || (m.need > 0 && m.got >= m.need - 1e-6);
// where a piece of a sheet line would be cut from: { how: 'offcut', idx } of the smallest offcut that will do, or { how: 'new' }
export function sheetSource(s, ln, area) {
  const pool = (s.offcuts && s.offcuts[ln.itemId]) || [];
  let idx = -1;
  for (let i = 0; i < pool.length; i++) if (pool[i] >= area - 1e-9 && (idx < 0 || pool[i] < pool[idx])) idx = i;
  return idx >= 0 ? { how: 'offcut', idx } : { how: 'new' };
}
// does putting this piece in want a sheet or a stick from the stacks or the arms?
export function needsStock(s, pr, id) {
  const m = pr.members[id], ln = m && m.line ? pr.lines[m.line] : null;
  if (ln && ln.stick && !placed(m)) return stickSource(s, pr, id).metres > 0;
  if (!ln || !ln.sheet || placed(m)) return true;
  return sheetSource(s, ln, m.area).how === 'new';
}
// how much of its item putting this member in takes from the stacks or the arms (a sheet, metres of new sticks, or its share)
export function stockNeed(s, pr, id) {
  const m = pr.members[id], ln = m && m.line ? pr.lines[m.line] : null;
  if (!ln || placed(m)) return 0;
  if (ln.stick) return stickSource(s, pr, id).metres;
  if (ln.sheet) return sheetSource(s, ln, m.area).how === 'new' ? 1 : 0;
  return round6(m.need - m.got);
}
// the whole sheets a sheet line still takes for the pieces not yet cut (all of them, or only those of open stages)
function sheetsLeft(s, pr, key, onlyOpen) {
  const ln = pr.lines[key], ids = Object.keys(pr.members).filter((id) => pr.members[id].line === key && !placed(pr.members[id]) && (!onlyOpen || stageOpen(pr, pr.members[id].stage)));
  return C.packSheets(ids.map((id) => pr.members[id].area), (s.offcuts && s.offcuts[ln.itemId]) || [], sheetAreaOf(ln.itemId)).sheets;
}
// a sheet line's quantity is what has been cut plus what the pieces still to cut will take, given the offcuts held
function requote(s, pr) {
  for (const key in pr.lines) { const ln = pr.lines[key]; if (ln.sheet) ln.qty = round6(ln.used + sheetsLeft(s, pr, key, false)); else if (ln.stick) ln.qty = round6(ln.used + unopened(ln)); }
}
// area conservation for sheet goods: sheets cut (whole) = area placed + offcuts held + waste. Returns the differences by item.
export function sheetImbalance(s) {
  const out = {};
  for (const sid in s.progress) for (const key in s.progress[sid].lines) { const ln = s.progress[sid].lines[key]; if (ln.sheet) out[ln.itemId] = (out[ln.itemId] || 0) + ln.used * sheetAreaOf(ln.itemId); }
  for (const sid in s.progress) for (const id in s.progress[sid].members) { const m = s.progress[sid].members[id]; if (m.area && m.line && s.progress[sid].lines[m.line].sheet && m.got > 0) out[s.progress[sid].lines[m.line].itemId] -= m.area; }
  for (const k in s.offcuts || {}) for (const a of s.offcuts[k]) out[k] = (out[k] || 0) - a;
  for (const k in s.waste || {}) out[k] = (out[k] || 0) - s.waste[k];
  for (const k of Object.keys(out)) if (Math.abs(out[k]) < 1e-4) delete out[k];
  return out;
}
const keepOrWaste = (s, itemId, area) => { if (area >= C.SHEET.minKeepM2) (s.offcuts[itemId] || (s.offcuts[itemId] = [])).push(round6(area)); else if (area > 1e-9) s.waste[itemId] = round6((s.waste[itemId] || 0) + area); };

// ---------------------------------------------------------------- lumber: stock lengths sawn to length, offcuts reused
// A stick line is bought as whole sticks of stock length (C.STICK); each member is one or more pieces (a doubled header is
// two) sawn from them. The line keeps its cut list: line.cut = { sticks: [{ L, left, open, back? }], at: { pieceId: stick } }.
// A stick is opened (taken from stock, all L metres of it) when its first piece is sawn; what is left of it is an offcut the
// rest of its pieces come from. The list is drawn up longest piece first, each from the shortest stick or offcut that holds
// it, and drawn up again only when the plan changes or pieces come back: so a line buys exactly what it uses.
// line.scrap: metres of sawdust and ends too short to keep.
const piecesOf = (pr, id, left) => { const m = pr.members[id], out = [], k0 = left && m.len > 0 ? Math.min(m.pcs || 1, Math.round((m.got || 0) / m.len)) : 0; for (let k = k0; k < (m.pcs || 1); k++) out.push({ id: id + '#' + k, len: m.len }); return out; };
function replan(pr, key) {
  const ln = pr.lines[key], cut = ln.cut || (ln.cut = { sticks: [], at: {} }), K = C.STICK;
  cut.sticks = cut.sticks.filter((st) => st.open && st.left >= K.minKeepM - 1e-9);
  cut.at = {};
  const list = [];
  for (const id in pr.members) { const m = pr.members[id]; if (m.line === key && !placed(m)) list.push(...piecesOf(pr, id, true)); }
  list.sort((p, q) => q.len - p.len || (p.id < q.id ? -1 : 1));
  const room = cut.sticks.map((st) => st.left);
  for (const p of list) {
    let k = -1;
    for (let i = 0; i < room.length; i++) if (room[i] >= p.len - 1e-9 && (k < 0 || room[i] < room[k])) k = i;
    if (k < 0) { const L = C.stockFor(p.len); cut.sticks.push({ L, left: L, open: false }); room.push(L); k = room.length - 1; }
    cut.at[p.id] = k;
    const r = C.restAfter(room[k], p.len);
    room[k] = r >= K.minKeepM ? round6(r) : 0;
  }
}
const unopened = (ln) => (ln.cut ? ln.cut.sticks.reduce((n, st) => n + (st.open ? 0 : st.L), 0) : 0);
// the sticks still to open for the members of a line's open stages (onlyOpen) or all of them
function sticksToOpen(pr, key, onlyOpen) {
  const ln = pr.lines[key], ks = new Set();
  if (!ln.cut) return [];
  for (const id in pr.members) { const m = pr.members[id]; if (m.line !== key || placed(m) || (onlyOpen && !stageOpen(pr, m.stage))) continue; for (const q of piecesOf(pr, id, true)) { const k = ln.cut.at[q.id]; if (k !== undefined && !ln.cut.sticks[k].open) ks.add(k); } }
  return [...ks].map((k) => ln.cut.sticks[k].L);
}
// what sawing this member takes from stock now: metres of the sticks it opens, and each piece's stick
export function stickSource(s, pr, id) {
  const m = pr.members[id], ln = m && m.line ? pr.lines[m.line] : null;
  if (!ln || !ln.stick || placed(m)) return { metres: 0, steps: [] };
  if (!ln.cut) replan(pr, m.line);
  const ks = new Set(), steps = [];
  let metres = 0;
  for (const q of piecesOf(pr, id, true)) {
    const k = ln.cut.at[q.id], st = k === undefined ? null : ln.cut.sticks[k];
    if (st && !st.open && !ks.has(k)) { metres += st.L; ks.add(k); }
    steps.push({ len: q.len, k, how: st && st.open ? 'offcut' : 'new', from: st ? (st.open ? st.left : st.L) : C.stockFor(q.len) });
  }
  return { metres: round6(metres), steps };
}
const keepOrScrap = (ln, len) => { if (len >= C.STICK.minKeepM) { if (!ln.cut) ln.cut = { sticks: [], at: {} }; ln.cut.sticks.push({ L: round6(len), left: round6(len), open: true, back: true }); } else if (len > 1e-9) ln.scrap = round6((ln.scrap || 0) + len); };
// length conservation for lumber: metres of whole sticks opened = metres in place + offcuts held + scrap
export function stickImbalance(s) {
  const out = {};
  for (const sid in s.progress) for (const key in s.progress[sid].lines) { const ln = s.progress[sid].lines[key]; if (!ln.stick) continue; out[ln.itemId] = (out[ln.itemId] || 0) + ln.used - (ln.scrap || 0); for (const st of (ln.cut && ln.cut.sticks) || []) if (st.open) out[ln.itemId] -= st.left; }
  for (const sid in s.progress) for (const id in s.progress[sid].members) { const m = s.progress[sid].members[id], ln = m.line && s.progress[sid].lines[m.line]; if (ln && ln.stick && m.got > 0) out[ln.itemId] -= m.got; }
  for (const k of Object.keys(out)) if (Math.abs(out[k]) < 1e-4) delete out[k];
  return out;
}
// a stick line's cut list as bought: stock lengths counted, for the Build panel ("26 x 3.0 m (10 ft)")
export function cutList(pr, key) {
  const ln = pr.lines[key];
  return C.stickCount(((ln.cut && ln.cut.sticks) || []).filter((st) => !st.back).map((st) => st.L));
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
// the kind of piece this one bears on that is not built yet (same stage), or null
export function supportMissing(pr, id) {
  const m = pr.members[id], need = m && C.SUPPORT[m.kind];
  if (!need) return null;
  for (const o in pr.members) { const q = pr.members[o]; if (!q.built && q.stage === m.stage && q.kind !== m.kind && need.includes(q.kind)) return q.kind; }
  return null;
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
  return supportMissing(pr, id) ? 'support missing' : null;
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
    // the ladder belongs to the first stage, but any order for work at height brings it if it has not come yet
    if (stage !== 'all' && ln.stage !== stage && !(key === LADDER_KEY && C.LADDER.with.includes(stage))) continue;
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
      if (m.built || !m.line || pr.lines[m.line].itemId !== itemId || pr.lines[m.line].sheet || pr.lines[m.line].stick) continue;
      if (open[m.stage] === undefined) open[m.stage] = stageOpen(pr, m.stage);
      if (open[m.stage]) n += m.need - m.got;
    }
    for (const key in pr.lines) if (pr.lines[key].sheet && pr.lines[key].itemId === itemId) n += sheetsLeft(s, pr, key, true);
    for (const key in pr.lines) if (pr.lines[key].stick && pr.lines[key].itemId === itemId) n += sticksToOpen(pr, key, true).reduce((a, L) => a + L, 0);
  }
  return round6(n);
}
// an armful of an item: whole pieces for the members that want it, as many as fit in `cap` units (part of one
// if even a single piece is too heavy); Infinity when nothing wants it
export function armful(s, itemId, cap) {
  let sum = 0, any = false;
  for (const sid in s.progress) {
    const pr = s.progress[sid], open = {}, rs = [];
    for (const id in pr.members) {
      const m = pr.members[id];
      if (m.built || !m.line || pr.lines[m.line].itemId !== itemId || pr.lines[m.line].sheet || pr.lines[m.line].stick) continue;
      if (open[m.stage] === undefined) open[m.stage] = stageOpen(pr, m.stage);
      if (!open[m.stage]) continue;
      const r = m.need - m.got;
      if (r > 1e-6) rs.push(r);
    }
    for (const key in pr.lines) if (pr.lines[key].sheet && pr.lines[key].itemId === itemId) for (let i = sheetsLeft(s, pr, key, true); i > 0; i--) rs.push(1);
    for (const key in pr.lines) if (pr.lines[key].stick && pr.lines[key].itemId === itemId) for (const L of sticksToOpen(pr, key, true)) rs.push(L);
    for (const r of rs) {
      any = true;
      if (sum + r <= cap + 1e-6) sum += r;
      else return sum > 0 ? round6(sum) : cap;
    }
  }
  return any ? round6(sum) : Infinity;
}
// a stage as the Build panel shows it
export function stageView(s, pr, stage) {
  const def = C.STAGE[stage], t = pr.tally[stage] || [0, 0];
  const lines = Object.keys(pr.lines).filter((k) => pr.lines[k].stage === stage).map((k) => {
    const ln = pr.lines[k], it = item(ln.itemId);
    return { key: k, label: ln.label, why: ln.why, qty: ln.qty, unit: ln.unit, count: ln.count, itemId: ln.itemId, itemName: it ? it.name : ln.itemId, costUsd: it ? cents(it.priceUsd * ln.qty) : 0, ordered: ln.ordered, used: ln.used, supply: ln.supply, sticks: ln.stick ? cutList(pr, k) : null };
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
  for (const p of pieces) if (p.struct === structId && p.stage && p.parent && C.STAGE[p.stage]) members.push({ id: p.id, stage: p.stage, kind: p.kind, parent: p.parent, len: p.length, pcs: p.plies || 1, built: p.built !== false || p.area === 0 || (p.length === 0 && p.area === undefined && !p.volume) });
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
// Nails and screws bought through the Supplier sit in the player's inventory (stock.items): they count as on you, and are drawn
// after the site stacks. What is drawn from the inventory is entered as bought here, so bought = stacks + inventory + carried + used.
const haveSupply = (s, stock, itemId) => SUP.stackQty(s, itemId) + (stock && stock.items ? stock.items[itemId] || 0 : 0);
function drawSupply(s, stock, itemId, d, x, z) {
  let used = SUP.useFromStacks(s, itemId, d, x, z, { partial: true });
  const more = round6(d - used), inv = stock && stock.items ? stock.items[itemId] || 0 : 0, take = Math.min(more, inv);
  if (take > 1e-9) {
    const left = round6(inv - take);
    if (left > 0) stock.items[itemId] = left; else delete stock.items[itemId];
    const L = s.ledger[itemId] || (s.ledger[itemId] = { bought: 0, used: 0, spent: 0 });
    L.bought = round6(L.bought + take); L.used = round6(L.used + take);
    used += take;
  }
  return used;
}
function supplies(s, pr, stage, builtAfter, check, stock) {
  const t = pr.tally[stage];
  for (const key in pr.lines) {
    const ln = pr.lines[key];
    if (!ln.supply || ln.stage !== stage || !t || !t[1]) continue;
    const target = round6((ln.qty * builtAfter) / t[1]), d = round6(target - ln.used);
    if (d > 1e-6) {
      if (haveSupply(s, stock, ln.itemId) + 1e-6 < d) return ln.itemId;
      if (!check) { drawSupply(s, stock, ln.itemId, d, pr.x, pr.z); ln.used = target; }
    } else if (d < -1e-6 && !check) {       // taken apart: bent nails are spent, they do not come back
      const L = s.ledger[ln.itemId];
      L.used = round6(L.used + d); L.spent = round6(L.spent - d); ln.used = target;
    }
  }
  return null;
}
function leanLadder(ctx, p) {
  const s = ctx.s;
  if (s.ladder) return { ok: false, reason: 'a ladder is already up' };
  if (!s.carried || s.carried.itemId !== C.LADDER.itemId) return { ok: false, reason: 'no ladder in the arms' };
  if (![p && p.x, p && p.z, p && p.yaw, p && p.topY].every(Number.isFinite)) return { ok: false, reason: 'bad place' };
  SUP.useCarried(s, C.LADDER.itemId, 1);
  s.ladder = { x: round6(p.x), z: round6(p.z), yaw: round6(p.yaw), topY: round6(p.topY), structId: p.structId === undefined ? null : p.structId };
  ctx.emit('construction.ladder', { up: true });
  return { ok: true, ladder: s.ladder };
}
function takeLadder(ctx) {
  const s = ctx.s;
  if (!s.ladder) return { ok: false, reason: 'no ladder up' };
  if (s.carried) return { ok: false, reason: 'hands full' };
  const L = s.ladder, it = item(C.LADDER.itemId);
  SUP.giveBack(s, C.LADDER.itemId, 1, L.x, L.z, C.DELIVERY.layout);
  const st = s.stacks.find((k) => k.itemId === C.LADDER.itemId);
  SUP.takeFromStack(s, st.id, { massKgPerUnit: it.massKgPerUnit, limitKg: 1e9, want: 1, minQty: 1 });
  s.ladder = null;
  ctx.emit('construction.ladder', { up: false });
  return { ok: true };
}
// Work at height always has a ladder. A building whose open work is out of reach from the ground (top plates, rafters,
// roof, the top of the sheathing), that has had anything ordered, gets a ladder at its stacks when there is none anywhere:
// none leaned, carried, in the barrow, on the stacks or on its way. That covers a build ordered stage by stage after the
// site was dug (the ladder's line is in the site stage), a plan with walls but no roof, an old save, and a ladder lost.
const isLadderAt = (s) => !!s.ladder || (s.carried && s.carried.itemId === C.LADDER.itemId) || s.stacks.some((k) => k.itemId === C.LADDER.itemId) || s.deliveries.some((d) => d.lines.some((l) => l.itemId === C.LADDER.itemId));
export function needsHeight(pr) {
  return C.LADDER.with.some((st) => pr.tally[st] && pr.tally[st][1] && !stageComplete(pr, st) && stageOpen(pr, st));
}
function ensureLadder(ctx) {
  const s = ctx.s, oldKey = 'top-plates|ladder';
  let any = null;
  for (const id in s.progress) {
    const pr = s.progress[id];
    if (pr.lines[oldKey] && oldKey !== LADDER_KEY) { const o = pr.lines[oldKey]; delete pr.lines[oldKey]; if (!pr.lines[LADDER_KEY]) pr.lines[LADDER_KEY] = { ...o, stage: C.LADDER.stage }; }
    if (!any && !pr.done && Object.values(pr.lines).some((l) => l.ordered > 0) && (needsHeight(pr) || (pr.lines[LADDER_KEY] && pr.lines[LADDER_KEY].ordered > 0))) any = pr;
  }
  if (!any || isLadderAt(s)) return;
  const near = s.stacks.find((k) => !k.barrow), at = near ? { x: near.x - 1.6, z: near.z } : dropOf(s, any);
  SUP.addToStacks(s, C.LADDER.itemId, 1, at.x, at.z, C.DELIVERY.layout);
  const L = s.ledger.ladder || (s.ledger.ladder = { bought: 0, used: 0, spent: 0 });
  L.bought = round6(L.bought + 1);
  if (any.lines[LADDER_KEY]) any.lines[LADDER_KEY].ordered = Math.max(1, any.lines[LADDER_KEY].ordered);
  ctx.emit('construction.ladderGranted', {});
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
    pr.members[m.id] = { stage: m.stage, kind: m.kind, parent: m.parent || null, line: null, need: 0, got: o ? o.got : 0, built: o ? o.built : m.built ? 1 : 0 };
    if (m.len > 0) { pr.members[m.id].len = round6(m.len); pr.members[m.id].pcs = m.pcs > 1 ? m.pcs : 1; }
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
    if (!each && isSheetItem(itemId) && own.length && own.every((q) => q[1] > 0)) L.sheet = true;
    // an old save's half-sawn line stays by the metre; new and untouched lines are bought as whole sticks
    else if (!each && C.isStickItem(itemId) && own.length && own.every((q) => pr.members[q[0]].len > 0) && (!o || o.stick || o.used <= 1e-9)) L.stick = true;
    pr.lines[ln.key] = L;
    if (L.stick) {                         // sawn from stock lengths: each member's share is its own length, the line is the sticks it takes
      for (const q of own) { const m = pr.members[q[0]]; m.line = ln.key; m.need = round6(m.len * (m.pcs || 1)); if (m.built) m.got = m.need; else if (m.got > m.need) m.got = m.need; m.cut = o_cut(old, q[0]); }
      if (o && o.cut) { L.used = o.used; L.scrap = o.scrap || 0; L.cut = { sticks: o.cut.sticks.map((st) => ({ ...st })), at: {} }; }
      else {                                // members already built (a plan sent as built): their sticks are opened and sawn
        const pk = C.packSticks(own.filter((q) => pr.members[q[0]].built).flatMap((q) => piecesOf(pr, q[0])), []);
        L.used = pk.metres; L.scrap = pk.waste; L.cut = { sticks: pk.left.map((x) => ({ L: x, left: x, open: true, back: true })), at: {} };
      }
      replan(pr, ln.key);
      continue;
    }
    if (L.sheet) {                         // cut to fit: each piece's share is its own area, and the line is the sheets that cutting them takes
      const A = sheetAreaOf(itemId);
      for (const q of own) { const m = pr.members[q[0]]; m.line = ln.key; m.area = round6(Math.min(q[1], A)); m.need = round6(m.area / A); if (m.built) m.got = m.need; else if (m.got > m.need) m.got = m.need; m.cut = o_cut(old, q[0]); }
      L.used = o ? o.used : round6(C.packSheets(own.filter((q) => pr.members[q[0]].built).map((q) => pr.members[q[0]].area), [], A).sheets);
      continue;
    }
    // each member's share of the line, so that the shares add up to exactly what was bought
    let wsum = 0, cum = 0, prev = 0;
    for (const q of own) wsum += each ? 1 : q[1] || 0;
    for (const q of own) {
      cum += each ? 1 : q[1] || 0;
      const upto = wsum > 0 ? round6((qty * cum) / wsum) : 0, m = pr.members[q[0]];
      m.line = ln.key; m.need = round6(upto - prev); prev = upto;
      if (m.built) m.got = m.need;
      else if (m.got > m.need) m.got = m.need;
      L.used = round6(L.used + m.got);
    }
  }
  if (!s.offcuts) s.offcuts = {};
  if (!s.waste) s.waste = {};
  requote(s, pr);
  if (old) for (const k in old.raised) pr.raised[k] = true;
  if (!old) for (const st of C.STAGES) if (st.flat) for (const par of flatParents(pr, st.id)) if (frameReady(pr, st.id, par)) pr.raised[par] = true;
  retally(pr);
  if (!pr.lines[LADDER_KEY] && C.LADDER.with.some((st) => pr.tally[st] && pr.tally[st][1]) && item(C.LADDER.itemId)) {   // work at height is done from a ladder: it comes with the order
    const o = old && old.lines[LADDER_KEY];
    pr.lines[LADDER_KEY] = { stage: C.LADDER.stage, itemId: C.LADDER.itemId, qty: 1, unit: 'each', label: 'Ladder', why: C.LADDER.why, count: 1, supply: false, ordered: o ? o.ordered : 0, used: o ? o.used : 0 };
  }
  for (const key in pr.lines) { const ln = pr.lines[key]; if (ln.supply) { const t = pr.tally[ln.stage]; ln.used = old && old.lines[key] ? Math.min(old.lines[key].used, ln.qty) : 0; if (!old && t && t[1]) ln.used = round6((ln.qty * t[0]) / t[1]); } }
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
  const stages = [...new Set(q.keys.map((k) => pr.lines[k].stage))];
  const r = SUP.placeOrder(s, q, { t: ctx.state.t, delayS: s.options.instant ? 0 : C.DELIVERY.delayS, tag: { structId: pr.id, stages }, pay: (usd) => pay(ctx, usd), x: at.x, z: at.z });
  if (!r.ok) { ctx.emit('construction.order', { ok: false, reason: r.reason, costUsd: r.costUsd }); return r; }
  if (!s.dropPoint) s.dropPoint = { x: at.x, z: at.z };
  q.keys.forEach((k, i) => { pr.lines[k].ordered = round6(pr.lines[k].ordered + q.lines[i].qty); });
  const out = { ok: true, costUsd: r.costUsd, deliveryId: r.delivery.id, dueT: r.delivery.dueT, stages, lines: q.lines };
  ctx.emit('construction.order', out);
  if (s.options.instant) land(ctx, s, r.delivery.id);
  return out;
}
function land(ctx, s, id) {
  const r = SUP.deliver(s, id, C.DELIVERY.layout);
  if (r.ok && !s.barrow) s.barrow = { x: round6(r.delivery.x - 2.4), z: round6(r.delivery.z + 1.2), yaw: 0.6, held: false };
  if (r.ok) ctx.emit('construction.delivered', { deliveryId: id, stacks: r.stacks, x: r.delivery.x, z: r.delivery.z, tag: r.delivery.tag });
  return r;
}

// ---- the wheelbarrow: take the handles, push it, load it from a stack; its load is a stack that moves with it
const barrowStack = (s) => s.stacks.find((k) => k.barrow);
const barrowKg = (s) => { const k = barrowStack(s); return k ? k.qty * item(k.itemId).massKgPerUnit : 0; };
function barrowPlace(s, x, z, yaw) {
  if (Number.isFinite(x) && Number.isFinite(z)) { s.barrow.x = round6(x); s.barrow.z = round6(z); }
  if (Number.isFinite(yaw)) s.barrow.yaw = round6(yaw);
  const k = barrowStack(s); if (k) { k.x = s.barrow.x; k.z = s.barrow.z; }
}
function barrowGrab(ctx, p) {
  const s = ctx.s, b = s.barrow;
  if (!b) return { ok: false, reason: 'no wheelbarrow' };
  if (b.held) return { ok: false, reason: 'already held' };
  if (s.carried) return { ok: false, reason: 'hands full' };
  if (p && Number.isFinite(p.px) && Math.hypot(p.px - b.x, p.pz - b.z) > C.BARROW.reachM + 0.5) return { ok: false, reason: 'too far' };
  b.held = true;
  return { ok: true };
}
function barrowLoad(ctx, p) {
  const s = ctx.s, b = s.barrow;
  if (!b || !b.held) return { ok: false, reason: 'not holding the wheelbarrow' };
  const from = p && p.hands ? null : s.stacks.find((k) => k.id === (p && p.stackId));
  if (!p.hands && (!from || from.barrow)) return { ok: false, reason: 'no such stack' };
  const itemId = p.hands ? (s.carried && s.carried.itemId) : from.itemId;
  if (!itemId) return { ok: false, reason: 'nothing to load' };
  if (isSupply(itemId)) return { ok: false, reason: 'stays by the stacks' };
  const load = barrowStack(s), it = item(itemId);
  if (load && load.itemId !== itemId) return { ok: false, reason: 'holds something else' };
  const capKg = C.BARROW.capKg * C.feelOf(s).armful, room = capKg - barrowKg(s), minQty = it.unit === 'each' ? 1 : 0;
  const avail = p.hands ? s.carried.qty : from.qty;
  let n = Math.min(avail, Math.max(room / it.massKgPerUnit, load ? 0 : minQty));
  if (it.unit === 'each') n = Math.floor(n + 1e-9);
  n = round6(n);
  if (!(n > 1e-6)) return { ok: false, reason: 'full' };
  if (p.hands) { s.carried.qty = round6(s.carried.qty - n); if (s.carried.qty <= 1e-6) s.carried = null; }
  else { from.qty = round6(from.qty - n); if (from.qty <= 1e-6) s.stacks = s.stacks.filter((k) => k !== from); }
  if (load) load.qty = round6(load.qty + n);
  else s.stacks.push({ id: 's' + s.nextId++, itemId, qty: n, x: b.x, z: b.z, barrow: true });
  return { ok: true, itemId, qty: n };
}

function pickUp(ctx, p) {
  const s = ctx.s, st = s.stacks.find((k) => k.id === (p && p.stackId));
  if (!st) return { ok: false, reason: 'no such stack' };
  if (isSupply(st.itemId)) return { ok: false, reason: 'stays by the stacks' };
  const it = item(st.itemId), tools = (ctx.get('stock') || {}).tools || [];
  const have = s.carried && s.carried.itemId === st.itemId ? s.carried.qty : 0;
  const limitKg = C.carryLimitKg(tools, C.feelOf(s).armful), minQty = it.unit === 'each' ? 1 : 0, cap = Math.max(minQty, limitKg / it.massKgPerUnit);
  const want = p.qty > 0 ? have + p.qty : armful(s, st.itemId, cap);
  const r = SUP.takeFromStack(s, st.id, { massKgPerUnit: it.massKgPerUnit, limitKg, want, minQty });
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
  const out = { ok: false, installed: [], set: [], partial: [], refused: [], cuts: [], learned: [], stagesDone: [], done: false };
  if (!s.offcuts) s.offcuts = {};
  if (!s.waste) s.waste = {};
  const before = new Set(C.STAGE_ORDER.filter((st) => stageComplete(pr, st)));
  for (const id of p.memberIds || []) {
    const m = pr.members[id];
    const why = blocked(pr, id);
    if (why) { out.refused.push({ id, reason: why, missing: why === 'support missing' ? supportMissing(pr, id) : undefined }); break; }
    const ln = m.line ? pr.lines[m.line] : null;
    let need = round6(m.need - m.got), give = 0, cut = null, saw = null;
    if (ln && ln.stick && need > 1e-6) {       // lumber: sawn from offcuts or new sticks, as the cut list says
      saw = stickSource(s, pr, id);
      if (saw.metres > 0) {
        const have = fromStacks ? SUP.stackQty(s, ln.itemId) : s.carried && s.carried.itemId === ln.itemId ? s.carried.qty : 0;
        if (have + 1e-6 < saw.metres) { out.refused.push({ id, reason: !fromStacks && s.carried && s.carried.itemId !== ln.itemId ? 'wrong material' : 'no material', itemId: ln.itemId }); break; }
      }
      need = 0;
    } else if (ln && ln.sheet && need > 1e-6) {       // a sheet piece: from an offcut if one will do, else a whole sheet is cut
      cut = sheetSource(s, ln, m.area);
      if (cut.how === 'new') {
        const have = fromStacks ? SUP.stackQty(s, ln.itemId) : s.carried && s.carried.itemId === ln.itemId ? s.carried.qty : 0;
        if (have + 1e-6 < 1) { out.refused.push({ id, reason: !fromStacks && s.carried && s.carried.itemId !== ln.itemId ? 'wrong material' : 'no material', itemId: ln.itemId }); break; }
      }
      need = 0;
    } else if (ln && need > 1e-6) {
      if (fromStacks) { if (SUP.stackQty(s, ln.itemId) + 1e-6 < need) { out.refused.push({ id, reason: 'no material', itemId: ln.itemId }); break; } give = need; }
      else {
        if (!s.carried || s.carried.itemId !== ln.itemId) { out.refused.push({ id, reason: s.carried ? 'wrong material' : 'no material', itemId: ln.itemId }); break; }
        give = Math.min(need, s.carried.qty);
      }
    }
    const completes = !ln || give + 1e-6 >= need;
    const doSaw = () => {
      if (!saw) return;
      const cuts = [];
      for (const st0 of saw.steps) {
        let st = st0.k === undefined ? null : ln.cut.sticks[st0.k];
        if (!st || (st.open && st.left < st0.len - 1e-9)) { st = { L: C.stockFor(st0.len), open: false }; st.left = st.L; ln.cut.sticks.push(st); }   // never short: a fresh stick
        const how = st.open ? 'offcut' : 'new', from = st.open ? st.left : st.L;
        if (!st.open) { fromStacks ? SUP.useFromStacks(s, ln.itemId, st.L, pr.x, pr.z) : SUP.useCarried(s, ln.itemId, st.L); ln.used = round6(ln.used + st.L); st.open = true; st.left = st.L; }
        const rest = C.restAfter(st.left, st0.len), keep = rest >= C.STICK.minKeepM;
        ln.scrap = round6((ln.scrap || 0) + st.left - st0.len - (keep ? rest : 0));
        st.left = keep ? round6(rest) : 0;
        m.got = round6(Math.min(m.need, m.got + st0.len));
        cuts.push({ how, stockM: from, lenM: st0.len, keptM: keep ? round6(rest) : 0, sawn: from - st0.len > 1e-6 });
      }
      m.got = m.need; m.cut = cuts.some((c) => c.how === 'new') ? 'new' : 'offcut';
      out.cuts.push({ id, how: m.cut, stick: true, pieces: cuts, sawn: cuts.some((c) => c.sawn) });
    };
    const doCut = () => {
      if (!cut) return;
      const A = sheetAreaOf(ln.itemId);
      let rest;
      if (cut.how === 'new') { fromStacks ? SUP.useFromStacks(s, ln.itemId, 1, pr.x, pr.z) : SUP.useCarried(s, ln.itemId, 1); ln.used = round6(ln.used + 1); rest = A - m.area; }
      else { rest = s.offcuts[ln.itemId].splice(cut.idx, 1)[0] - m.area; }
      keepOrWaste(s, ln.itemId, rest);
      m.got = m.need; m.cut = cut.how;
      out.cuts.push({ id, how: cut.how, keptM2: rest >= C.SHEET.minKeepM2 ? round6(rest) : 0 });
    };
    if (p.hold) {                          // set in place by hand: the material goes in, the piece stays loose until it is fastened
      if (saw) { doSaw(); out.set.push(id); continue; }
      if (cut) { doCut(); out.set.push(id); continue; }
      if (!ln || need <= 1e-6) { out.refused.push({ id, reason: 'already set' }); break; }
      const used = fromStacks ? SUP.useFromStacks(s, ln.itemId, give, pr.x, pr.z) : SUP.useCarried(s, ln.itemId, give);
      m.got = round6(m.got + used); ln.used = round6(ln.used + used);
      if (completes) { m.got = m.need; out.set.push(id); } else { out.partial.push({ id, got: m.got, need: m.need }); break; }
      continue;
    }
    if (completes) { const lack = supplies(s, pr, m.stage, pr.tally[m.stage][0] + 1, true, ctx.get('stock')); if (lack) { out.refused.push({ id, reason: 'no fasteners', itemId: lack }); break; } }
    doCut(); doSaw();
    if (give > 0) {
      const used = fromStacks ? SUP.useFromStacks(s, ln.itemId, give, pr.x, pr.z) : SUP.useCarried(s, ln.itemId, give);
      m.got = round6(m.got + used); ln.used = round6(ln.used + used);
    }
    if (completes) {
      m.got = m.need; m.built = 1; pr.tally[m.stage][0]++;
      supplies(s, pr, m.stage, pr.tally[m.stage][0], false, ctx.get('stock'));
      out.installed.push(id);
    } else { out.partial.push({ id, got: m.got, need: m.need }); break; }
  }
  if (p.hand && out.installed.length) {         // nailed with your own blows: practice
    if (!s.learn) s.learn = { counts: {}, known: {} };
    for (const id of out.installed) {
      const g = C.learnGroup(pr.members[id].kind);
      if (!g || s.learn.known[g]) continue;
      s.learn.counts[g] = (s.learn.counts[g] || 0) + 1;
      if (s.learn.counts[g] >= C.feelOf(s).learnNeeded) { s.learn.known[g] = true; out.learned.push(g); }
    }
  }
  out.ok = out.installed.length > 0 || out.partial.length > 0 || out.set.length > 0;
  requote(s, pr);
  if (!out.ok) { out.reason = out.refused[0] ? out.refused[0].reason : 'nothing to do'; if (out.refused[0] && out.refused[0].itemId) out.itemId = out.refused[0].itemId; if (out.refused[0] && out.refused[0].missing) out.missing = out.refused[0].missing; return out; }
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
    if (ln && ln.stick && m.got > 0) {       // sawn pieces come off as offcuts of their own length
      for (const q of piecesOf(pr, id)) keepOrScrap(ln, q.len);
      m.cut = null;
    } else if (ln && ln.sheet && m.got > 0) {       // a cut piece comes off as an offcut of its own size: the sheet it was cut from stays used
      if (!s.offcuts) s.offcuts = {};
      (s.offcuts[ln.itemId] || (s.offcuts[ln.itemId] = [])).push(m.area);
      m.cut = null;
    } else if (ln && m.got > 0) {
      SUP.giveBack(s, ln.itemId, m.got, at.x, at.z, C.DELIVERY.layout);
      ln.used = round6(ln.used - m.got);
      out.returned[ln.itemId] = round6((out.returned[ln.itemId] || 0) + m.got);
    }
    if (m.built) { m.built = 0; pr.tally[m.stage][0]--; supplies(s, pr, m.stage, pr.tally[m.stage][0], false, ctx.get('stock')); }
    m.got = 0;
    if (C.STAGE[m.stage].flat && m.parent) delete pr.raised[m.parent];
    out.removed.push(id);
  }
  out.ok = out.removed.length > 0;
  if (!out.ok) { out.reason = out.refused[0] ? out.refused[0].reason : 'nothing to take apart'; return out; }
  for (const key of new Set(out.removed.map((id) => pr.members[id].line))) if (key && pr.lines[key].stick) replan(pr, key);   // the pieces back are offcuts the list can use again
  requote(s, pr);
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
    if (!s.deliveries.length) { ensureLadder(ctx); return; }
    for (const d of SUP.dueDeliveries(s, ctx.state.t)) land(ctx, s, d.id);
  },
  commands: {
    'construction.setPlan': setPlan,
    'construction.forget': (c, p) => { if (!c.s.progress[p.structId]) return { ok: false, reason: 'unknown building' }; delete c.s.progress[p.structId]; if (c.s.tutorial.shed === p.structId) c.s.tutorial.shed = null; return { ok: true }; },
    'construction.setDropPoint': (c, p) => { if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return { ok: false, reason: 'bad place' }; c.s.dropPoint = { x: round6(p.x), z: round6(p.z) }; for (const d of c.s.deliveries) { d.x = c.s.dropPoint.x; d.z = c.s.dropPoint.z; } return { ok: true }; },
    // the hands open or close a door or window that is built (docs/FRAMING.md): id, open? (omitted: toggle)
    'construction.operate': (c, p) => {
      if (!p || typeof p.id !== 'string' || !p.id) return { ok: false, reason: 'bad piece' };
      if (!c.s.open) c.s.open = {};
      const on = p.open === undefined ? !c.s.open[p.id] : !!p.open;
      if (on) c.s.open[p.id] = 1; else delete c.s.open[p.id];
      return { ok: true, open: on };
    },
    'construction.order': order,
    'construction.deliverNow': (c, p) => { const ids = c.s.deliveries.filter((d) => !p || !p.deliveryId || d.id === p.deliveryId).map((d) => d.id); for (const id of ids) land(c, c.s, id); return { ok: ids.length > 0, delivered: ids }; },
    'construction.pickUp': pickUp,
    'construction.putDown': putDownCmd,
    'construction.install': install,
    'construction.leanLadder': leanLadder,
    'construction.takeLadder': takeLadder,
    'construction.raise': raise,
    'construction.barrowGrab': barrowGrab,
    'construction.barrowLoad': barrowLoad,
    'construction.barrowMove': (c, p) => { if (!c.s.barrow || !c.s.barrow.held) return { ok: false, reason: 'not held' }; barrowPlace(c.s, p.x, p.z, p.yaw); return { ok: true }; },
    'construction.barrowSet': (c, p) => { if (!c.s.barrow || !c.s.barrow.held) return { ok: false, reason: 'not held' }; barrowPlace(c.s, p && p.x, p && p.z, p && p.yaw); c.s.barrow.held = false; return { ok: true }; },
    // places that can never be reached or seen (no geometry, no size) are finished with their stage, never left as stray markers
    'construction.settle': (c, p) => {
      const pr = c.s.progress[p && p.structId];
      if (!pr) return { ok: false, reason: 'unknown building' };
      const done = [];
      for (const id of p.memberIds || []) { const m = pr.members[id]; if (!m || m.built || m.kind === 'site') continue; m.got = m.need; m.built = 1; pr.tally[m.stage][0]++; done.push(id); }
      if (done.length) refresh(c, c.s, pr);
      return { ok: done.length > 0, settled: done };
    },
    'construction.dismantle': dismantle,
    'construction.setLevel': (c, p) => { if (!LEVELS.includes(p.level)) return { ok: false, reason: 'unknown level' }; const pr = c.s.progress[p.structId]; if (pr) pr.level = p.level; else c.s.level = p.level; return { ok: true }; },
    'construction.setOption': (c, p) => { if (!p || !(p.key in c.s.options)) return { ok: false, reason: 'unknown option' }; c.s.options[p.key] = !!p.value; if (p.key === 'sandbox') c.emit('construction.sandbox', { on: !!p.value }); return { ok: true }; },
    'construction.setGesture': (c, p) => { if (!p || !C.GESTURES.includes(p.n)) return { ok: false, reason: 'unknown amount' }; c.s.options.gesture = p.n; return { ok: true }; },
    'construction.setFeel': (c, p) => {
      if (!p) return { ok: false, reason: 'nothing' };
      if (p.reset) c.s.feel = { ...C.FEEL };
      else if (p.preset) { if (!C.FEEL_PRESETS[p.preset]) return { ok: false, reason: 'unknown preset' }; c.s.feel = { ...C.FEEL_PRESETS[p.preset] }; }
      else { const sp = C.FEEL_SPEC.find((q) => q.key === p.key); if (!sp || !Number.isFinite(p.value)) return { ok: false, reason: 'unknown setting' }; c.s.feel = { ...C.feelOf(c.s), [sp.key]: Math.max(sp.min, Math.min(sp.max, p.value)) }; }
      return { ok: true, feel: C.feelOf(c.s) };
    },
    'construction.seeCard': (c, p) => { c.s.tutorial.seen[p.stage] = true; return { ok: true }; },
  },
  api: { content: C, feelOf: (s) => C.feelOf(s), knows: (s, kind) => !!(s.learn && s.learn.known[C.learnGroup(kind)]), sheetSource, needsStock, stockNeed, stickSource, stickImbalance, cutList, sheetImbalance, planFromPieces, catalog: CONSTRUCTION_CATALOG, buildingView, stageView, installable, blocked, openStages, stageOpen, stageComplete, flatCurrent, flatParents, frameReady, quoteStage, wanted, armful, stageSatisfied, tutorialStep, carriedMassKg, imbalance: SUP.imbalance },
});
