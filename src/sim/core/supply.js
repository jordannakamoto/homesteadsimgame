// Supply: orders, deliveries, stacks on the ground and a carried load. A generic mechanism: it knows
// nothing about what the items are. A game supplies item ids, masses, prices and where things land.
//
// State (plain data, lives inside a system's state):
//   { dropPoint: { x, z } | null, orders: [{ id, t, lines: [{ itemId, qty, costUsd }], costUsd, tag }],
//     deliveries: [{ id, orderId, dueT, lines: [{ itemId, qty }], x, z, tag }],
//     stacks: [{ id, itemId, qty, x, z, carrier? }], carried: { itemId, qty } | null, nextId, ledger: { [itemId]: { bought, used, spent } } }
// A stack with `carrier: unitId` rides on a vehicle (its x, z follow it); deliveries never merge into it.
// Every operation returns { ok, reason? ... } and changes nothing when it fails.
// Conservation, per item: ledger.bought = in deliveries + in stacks + carried + ledger.used + ledger.spent.

const EPS = 1e-9;
export const round6 = (x) => Math.round(x * 1e6) / 1e6;
export const cents = (x) => Math.round(x * 100) / 100;

export function initSupply() {
  return { dropPoint: null, orders: [], deliveries: [], stacks: [], carried: null, nextId: 1, ledger: {} };
}
const led = (s, itemId) => s.ledger[itemId] || (s.ledger[itemId] = { bought: 0, used: 0, spent: 0 });

// Price a list of { itemId, qty } against a catalog (id -> { priceUsd }). Unknown items make the whole quote fail.
export function quote(lines, catalog) {
  const out = [];
  let costUsd = 0;
  for (const ln of lines) {
    const it = catalog[ln.itemId];
    if (!it) return { ok: false, reason: 'unknown item', itemId: ln.itemId };
    if (!(ln.qty > 0)) continue;
    const c = cents(it.priceUsd * ln.qty);
    costUsd = cents(costUsd + c);
    out.push({ itemId: ln.itemId, qty: ln.qty, costUsd: c });
  }
  return { ok: true, costUsd, lines: out };
}

// Pay for a quote and turn it into a delivery. pay(costUsd) must take the money and return true, or return false.
export function placeOrder(s, q, { t, delayS = 0, tag = null, pay, x, z }) {
  if (!q || !q.ok) return { ok: false, reason: (q && q.reason) || 'nothing to order' };
  if (!q.lines.length) return { ok: false, reason: 'nothing to order' };
  if (!pay(q.costUsd)) return { ok: false, reason: 'not enough money', costUsd: q.costUsd };
  const order = { id: 'o' + s.nextId++, t, lines: q.lines.map((l) => ({ ...l })), costUsd: q.costUsd, tag };
  const at = x !== undefined ? { x, z } : s.dropPoint || { x: 0, z: 0 };
  const delivery = { id: 'd' + s.nextId++, orderId: order.id, dueT: t + delayS, lines: q.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })), x: at.x, z: at.z, tag };
  s.orders.push(order);
  s.deliveries.push(delivery);
  for (const l of q.lines) led(s, l.itemId).bought = round6(led(s, l.itemId).bought + l.qty);
  return { ok: true, order, delivery, costUsd: q.costUsd };
}

export const dueDeliveries = (s, t) => s.deliveries.filter((d) => d.dueT <= t);

// Add to the stack of the same item near (x, z), or start a new one in the first free slot of a grid there.
export function addToStacks(s, itemId, qty, x, z, { cols = 4, dx = 1.5, dz = 3.4, mergeR = 9, slot = null } = {}) {
  if (!(qty > 0)) return null;
  let st = s.stacks.find((k) => !k.barrow && !k.carrier && k.itemId === itemId && Math.hypot(k.x - x, k.z - z) <= mergeR);
  if (st) { st.qty = round6(st.qty + qty); return st; }
  let px = x, pz = z;
  for (let i = 0; i < 400; i++) {
    const o = slot ? slot(i, itemId) : { x: (i % cols) * dx, z: Math.floor(i / cols) * dz };
    px = round6(x + o.x); pz = round6(z + o.z);
    if (!s.stacks.some((k) => Math.hypot(k.x - px, k.z - pz) < (slot ? 0.5 : Math.min(dx, dz) * 0.6))) break;
  }
  st = { id: 's' + s.nextId++, itemId, qty: round6(qty), x: px, z: pz };
  s.stacks.push(st);
  return st;
}

// A delivery lands: its lines become stacks at its drop point.
export function deliver(s, deliveryId, layout) {
  const i = s.deliveries.findIndex((d) => d.id === deliveryId);
  if (i < 0) return { ok: false, reason: 'unknown delivery' };
  const d = s.deliveries[i];
  s.deliveries.splice(i, 1);
  const stacks = [];
  for (const l of d.lines) { const st = addToStacks(s, l.itemId, l.qty, d.x, d.z, layout); st && stacks.push(st.id); }
  return { ok: true, delivery: d, stacks };
}

// an empty stack is gone; so is one down to sawdust (which is written off as spent)
function dropEmpty(s) {
  for (const k of s.stacks) if (k.qty > 0 && k.qty <= 1e-4) { const L = led(s, k.itemId); L.spent = round6(L.spent + k.qty); k.qty = 0; }
  s.stacks = s.stacks.filter((k) => k.qty > EPS);
}

// Take from a stack into the hands. One kind of item is carried at a time; the load is limited by mass
// (limitKg), but one whole unit can always be lifted (minQty). want: how much to end up holding, at most.
export function takeFromStack(s, stackId, { massKgPerUnit, limitKg, want = Infinity, minQty = 0 }) {
  const st = s.stacks.find((k) => k.id === stackId);
  if (!st) return { ok: false, reason: 'no such stack' };
  if (s.carried && s.carried.itemId !== st.itemId) return { ok: false, reason: 'hands full' };
  const have = s.carried ? s.carried.qty : 0;
  const cap = Math.max(minQty, massKgPerUnit > 0 ? limitKg / massKgPerUnit : Infinity);
  const take = round6(Math.min(st.qty, Math.min(cap, want) - have));
  if (!(take > EPS)) return { ok: false, reason: 'hands full' };
  st.qty = round6(st.qty - take);
  s.carried = { itemId: st.itemId, qty: round6(have + take) };
  dropEmpty(s);
  return { ok: true, itemId: st.itemId, qty: take, carried: s.carried };
}

// Put the carried load down: onto a given stack of the same item, or on the ground at (x, z).
export function putDown(s, { stackId, x, z }, layout) {
  if (!s.carried) return { ok: false, reason: 'nothing carried' };
  const c = s.carried;
  let st = stackId ? s.stacks.find((k) => k.id === stackId && k.itemId === c.itemId) : null;
  if (st) st.qty = round6(st.qty + c.qty);
  else st = addToStacks(s, c.itemId, c.qty, x || 0, z || 0, { ...layout, mergeR: 1.6 });
  s.carried = null;
  return { ok: true, itemId: c.itemId, qty: c.qty, stackId: st.id };
}

// Use up part of the carried load (it has gone into something). Returns the amount actually used.
export function useCarried(s, itemId, qty) {
  if (!s.carried || s.carried.itemId !== itemId || !(qty > 0)) return 0;
  const use = Math.min(qty, s.carried.qty);
  s.carried.qty = round6(s.carried.qty - use);
  if (s.carried.qty <= 1e-6) { led(s, itemId).spent = round6(led(s, itemId).spent + s.carried.qty); s.carried = null; }
  led(s, itemId).used = round6(led(s, itemId).used + use);
  return use;
}
// Use up material straight from the stacks, nearest to (x, z) first. All or nothing unless partial is set.
export function useFromStacks(s, itemId, qty, x = 0, z = 0, { partial = false, spent = false } = {}) {
  if (!(qty > 0)) return 0;
  const list = s.stacks.filter((k) => k.itemId === itemId).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  const have = list.reduce((n, k) => n + k.qty, 0);
  if (have + 1e-6 < qty && !partial) return 0;
  let left = Math.min(qty, have);
  const used = left;
  for (const k of list) { const u = Math.min(k.qty, left); k.qty = round6(k.qty - u); left -= u; if (left <= EPS) break; }
  dropEmpty(s);
  const L = led(s, itemId);
  if (spent) L.spent = round6(L.spent + used); else L.used = round6(L.used + used);
  return used;
}
// Material comes back out of something that was built: onto a stack near (x, z).
export function giveBack(s, itemId, qty, x, z, layout) {
  if (!(qty > 0)) return null;
  const L = led(s, itemId);
  L.used = round6(L.used - qty);
  return addToStacks(s, itemId, qty, x, z, layout);
}

export const stackQty = (s, itemId) => s.stacks.reduce((n, k) => n + (k.itemId === itemId ? k.qty : 0), 0);
export const pendingQty = (s, itemId) => s.deliveries.reduce((n, d) => n + d.lines.reduce((m, l) => m + (l.itemId === itemId ? l.qty : 0), 0), 0);
// What the ledger says should exist against what does: zero for every item when nothing was conjured or lost.
export function imbalance(s) {
  const out = {};
  const ids = new Set([...Object.keys(s.ledger), ...s.stacks.map((k) => k.itemId), ...(s.carried ? [s.carried.itemId] : [])]);
  for (const id of ids) {
    const L = s.ledger[id] || { bought: 0, used: 0, spent: 0 };
    const d = L.bought - (pendingQty(s, id) + stackQty(s, id) + (s.carried && s.carried.itemId === id ? s.carried.qty : 0) + L.used + L.spent);
    if (Math.abs(d) > 1e-4) out[id] = d;
  }
  return out;
}
