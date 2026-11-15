// The stock system: what the player owns (money, materials, tools) and the optional project cards.
//
// State, at sim.state.sys.stock:
//   { money, items: { [itemId]: quantity }, tools: [itemId...], projects: [{ id, title, blurb, status }] }
// Tools are single, unconsumed items (category tools_hand / tools_power); they live in `tools`.
// Everything else lives in `items`. Commands (all atomic; a failed command changes nothing and
// emits an event saying why): stock.add, stock.remove, stock.buy, projects.add, projects.done,
// projects.dismiss (and projects.reopen, to un-tick a card).
// Events: 'stock.add', 'stock.remove', 'stock.buy' each carry { ok, id, qty, reason?, costUsd? };
// 'projects.changed' carries { id, status }.
// Money and mass are conserved: buying moves exactly price x qty out of money and qty x massKgPerUnit into stock.

import { ITEMS, isToolCategory } from './items.js';

export const START_MONEY_USD = 4000;   // enough for the first shed (about $2,700 of materials) with some left over
export const STARTER_TOOLS = Object.freeze(['axe', 'hand_saw', 'hammer', 'shovel', 'tape']);
export const STARTER_PROJECTS = Object.freeze([
  { id: 'roof', title: 'Put a roof over your head', blurb: 'Press B and raise four walls and a roof, so there is somewhere dry to sleep.' },
  { id: 'tree', title: 'Fell a tree and turn it into something', blurb: 'Swing the axe at a tree, split the trunk, and use the wood you gather.' },
  { id: 'lumber', title: 'Buy your first load of lumber', blurb: 'Open the supplier (U) and order some 2x4s. Delivery is instant for now.' },
  { id: 'level', title: 'Level a spot for your floor', blurb: 'The Level tool (4) smooths the ground, so a floor sits flat.' },
]);

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const cents = (x) => Math.round(x * 100) / 100;

export const isTool = (id) => !!ITEMS[id] && isToolCategory(ITEMS[id].category);

export function initStock() {
  return {
    money: START_MONEY_USD,
    items: {},
    tools: [...STARTER_TOOLS],
    projects: STARTER_PROJECTS.map((p) => ({ ...p, status: 'open' })),
  };
}

// ---------------------------------------------------------------- queries
export const quantityOf = (s, id) => (isTool(id) ? (s.tools.includes(id) ? 1 : 0) : s.items[id] || 0);
export function stockMassKg(state) {
  const s = state.sys ? state.sys.stock : state;
  let kg = 0;
  for (const id in s.items) kg += s.items[id] * ITEMS[id].massKgPerUnit;
  for (const id of s.tools) kg += ITEMS[id].massKgPerUnit;
  return kg;
}
export function priceOf(id, qty) { return cents(ITEMS[id].priceUsd * qty); }
export function canAfford(state, id, qty = 1) {
  const s = state.sys ? state.sys.stock : state;
  return !!ITEMS[id] && qty > 0 && s.money + 1e-9 >= priceOf(id, qty);
}
// Is the tool owned, and can it run? Power tools need `hasPower` (the game asks window.__game.powerAvailable()).
export function toolAvailable(state, toolId, hasPower = false) {
  const s = state.sys ? state.sys.stock : state;
  const it = ITEMS[toolId];
  if (!it || !s.tools.includes(toolId)) return false;
  return it.powerW ? !!hasPower : true;
}

// ---------------------------------------------------------------- pure operations (return { ok, reason? })
function checkQty(id, qty) {
  const it = ITEMS[id];
  if (!it) return 'unknown item';
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) return 'quantity must be positive';
  if ((it.unit === 'each' || isTool(id)) && !Number.isInteger(qty)) return 'whole items only';
  if (qty > 1e6) return 'quantity too large';
  return null;
}
export function stockAdd(s, id, qty) {
  const bad = checkQty(id, qty);
  if (bad) return { ok: false, id, qty, reason: bad };
  if (isTool(id)) {
    if (qty !== 1 || s.tools.includes(id)) return { ok: false, id, qty, reason: 'already owned' };
    s.tools.push(id);
  } else s.items[id] = round6((s.items[id] || 0) + qty);
  return { ok: true, id, qty };
}
export function stockRemove(s, id, qty) {
  const bad = checkQty(id, qty);
  if (bad) return { ok: false, id, qty, reason: bad };
  if (isTool(id)) {
    const i = s.tools.indexOf(id);
    if (i < 0 || qty !== 1) return { ok: false, id, qty, reason: 'not enough' };
    s.tools.splice(i, 1);
  } else {
    const have = s.items[id] || 0;
    if (have + 1e-9 < qty) return { ok: false, id, qty, reason: 'not enough' };
    const left = round6(have - qty);
    if (left <= 0) delete s.items[id]; else s.items[id] = left;
  }
  return { ok: true, id, qty };
}
export function stockBuy(s, id, qty) {
  const bad = checkQty(id, qty);
  if (bad) return { ok: false, id, qty, reason: bad };
  if (isTool(id) && s.tools.includes(id)) return { ok: false, id, qty, reason: 'already owned' };
  const costUsd = priceOf(id, qty);
  if (s.money + 1e-9 < costUsd) return { ok: false, id, qty, costUsd, reason: 'not enough money' };
  const r = stockAdd(s, id, qty);     // cannot fail after the checks above
  if (!r.ok) return r;
  s.money = cents(s.money - costUsd);
  return { ok: true, id, qty, costUsd };
}

// ---------------------------------------------------------------- the world's wood and stone counters
// world.wood and world.stone in the engine are views of these two items.
export const WOOD_ITEM = 'wood', STONE_ITEM = 'stone';
export function setCounter(s, id, n) {
  n = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  if (n > 0) s.items[id] = n; else delete s.items[id];
}

// ---------------------------------------------------------------- projects
const findProject = (s, id) => s.projects.find((p) => p.id === id);
function setStatus(s, id, status) {
  const p = findProject(s, id);
  if (!p) return { ok: false, id, reason: 'unknown project' };
  p.status = status;
  return { ok: true, id, status };
}

export const stockSystem = () => ({
  name: 'stock',
  every: 1440,        // nothing here changes with time; the step is a no-op, so the cadence is one day
  init: () => initStock(),
  step: () => {},
  commands: {
    'stock.add': (c, p) => { const r = stockAdd(c.s, p.id, p.qty); c.emit('stock.add', r); return r; },
    'stock.remove': (c, p) => { const r = stockRemove(c.s, p.id, p.qty); c.emit('stock.remove', r); return r; },
    'stock.buy': (c, p) => { const r = stockBuy(c.s, p.id, p.qty); c.emit('stock.buy', r); return r; },
    'projects.add': (c, p) => {
      if (!p || typeof p.id !== 'string' || !p.id || typeof p.title !== 'string' || findProject(c.s, p.id)) return { ok: false, reason: 'invalid or duplicate project' };
      c.s.projects.push({ id: p.id, title: p.title, blurb: typeof p.blurb === 'string' ? p.blurb : '', status: 'open' });
      c.emit('projects.changed', { id: p.id, status: 'open' });
      return { ok: true, id: p.id };
    },
    'projects.done': (c, p) => { const r = setStatus(c.s, p.id, 'done'); if (r.ok) c.emit('projects.changed', r); return r; },
    'projects.dismiss': (c, p) => { const r = setStatus(c.s, p.id, 'dismissed'); if (r.ok) c.emit('projects.changed', r); return r; },
    'projects.reopen': (c, p) => { const r = setStatus(c.s, p.id, 'open'); if (r.ok) c.emit('projects.changed', r); return r; },
  },
});

// Apply a command to the live simulation immediately and return its result, for the interface (instant
// feedback, even while time is paused). It goes through the same handler as a queued command and is
// recorded the same way, so replays see it.
export function runStockCommand(sim, name, payload = {}) {
  const h = sim.handlers.get(name);
  if (!h) throw new Error('unknown command: ' + name);
  const st = sim.state;
  if (sim.recorded) sim.recorded.push({ tick: st.tick, name, payload });
  const ctx = {
    sim, state: st, t: st.t, tick: st.tick, dt: 0,
    get s() { return st.sys[h.sys.name]; },
    get: (n) => st.sys[n],
    rng: (n) => sim.rng(h.sys.name + (n ? ':' + n : '')),
    emit: (type, data) => { for (const fn of sim.listeners) fn(type, data, st); },
  };
  return h.fn(ctx, payload);
}
