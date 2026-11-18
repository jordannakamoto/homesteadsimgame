// Landscaping: the ground shaped by hand (dug, thrown, raked, tamped, covered), the stones set on it, the garden
// boxes, the ponds and the plants put in.
//
// The ground's shape lives in a generic earthwork heightfield (src/sim/core/earthwork.js): points 10 cm apart, with
// round tool footprints and loose earth that runs to its angle of repose, so holes are bowls and thrown earth makes
// heaps, not blocks. The content (surfaces, stones, nursery plants, how things are installed) is in
// src/sim/content/landscape.js. This file holds the commands and the slow changes: sown lawns knitting, plants
// drinking and growing, ponds filling and drying, stones settling on unprepared ground, weeds in laid surfaces.
//
// The garden reads the shape: a hilled potato stands on raised ground, a basin catches rain (src/sim/garden.js).
//
// State, at sim.state.sys.landscape (plain JSON):
//   { v, grid (the heightfield), carry: { m3, s } (the shovel's load), barrow: { m3, s }, scale (earth per scoop),
//     things: { [id]: { id, k, x, z, yaw, y, ax, az, on, sag } }   y: base above the untouched ground at (ax, az);
//                                                                   on: the id it sits on; sag: how far it has sunk
//     plants: { [id]: { id, k, x, z, yaw, t, w, g, est } }         w: root-zone moisture; g: years grown; est: days rooting
//     ponds: { [root]: m3 }, hose: { [root]: 1 }, rain, hours, nextId, totals }
// Ground flags (FLAG in the content): liner, fabric, tamped once / firm, weeds (0..7), inside a box's walls.

import * as EW from './core/earthwork.js';
import { SCOOP_M3, SCOOP_SCALES, LAWN, SURFACES, THINGS, PLANTS, BARROW_M3, ESTABLISH, POND, INSTALL, FLAG, BAG_L, BAGGED, BULK } from './content/landscape.js';
import { ITEMS } from './items.js';
import { DAY } from './time.js';

const STATE_V = 2, STEP = 0.1, A = STEP * STEP;
const MAX_THINGS = 12000, MAX_PLANTS = 600;
const r3 = (v) => Math.round(v * 1000) / 1000, r4 = (v) => Math.round(v * 1e4) / 1e4;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const fail = (reason, extra) => ({ ok: false, reason, ...extra });
const finite = (p) => Number.isFinite(+p.x) && Number.isFinite(+p.z);
const pt = (v) => Math.round(v / STEP);
const WEED_SHIFT = 4;
const weedOf = (f) => (f >> WEED_SHIFT) & 7;
const tampOf = (f) => (f & FLAG.TAMP2 ? 2 : f & FLAG.TAMP1 ? 1 : 0);

function fresh() {
  return { v: STATE_V, grid: EW.makeGrid(), carry: { m3: 0, s: '' }, barrow: { m3: 0, s: '' }, scale: 4, things: {}, plants: {}, ponds: {}, hose: {}, rain: null, hours: 0, nextId: 1, loose: 1, totals: { dugM3: 0, filledM3: 0, turfM3: 0, laidM3: 0 } };
}
function ensure(ctx) {
  if (!ctx.s || ctx.s.v !== STATE_V) ctx.s = fresh();
  // saves from before loose and firm ground: what stands above grade was put there, so it is loose
  if (!ctx.s.loose) { for (const [, , h, c, , , , tile, n] of EW.worked(ctx.s.grid)) if (h > 0 && c) tile.f[n] |= EW.LOOSE_BIT; ctx.s.loose = 1; }
  return ctx.s;
}
const now = (ctx) => ctx.lifeT ?? ctx.t;
const hours = (ctx) => Math.round(now(ctx) / 3600);

// ---------------------------------------------------------------------------------------- stock
function call(ctx, name, payload) {
  const sim = ctx.sim, h = sim && sim.handlers.get(name);
  if (!h) return undefined;
  const st = sim.state;
  return h.fn({ sim, state: st, t: st.t, tick: st.tick, dt: 0, get s() { return st.sys[h.sys.name]; }, set s(v) { st.sys[h.sys.name] = v; },
    get: (n) => st.sys[n], rng: (n) => sim.rng(h.sys.name + (n ? ':' + n : '')), emit: ctx.emit }, payload);
}
const stockOf = (ctx) => ctx.get('stock');
const hasTool = (ctx, id) => { const s = stockOf(ctx); return !s || s.tools.includes(id); };
const haveQty = (ctx, id) => { const s = stockOf(ctx); return s ? s.items[id] || 0 : Infinity; };
function spend(ctx, id, qty) {
  if (!stockOf(ctx)) return qty;
  const q = Math.min(qty, haveQty(ctx, id));
  if (!(q > 1e-9)) return 0;
  return call(ctx, 'stock.remove', { id, qty: Math.round(q * 1e6) / 1e6 }).ok ? q : 0;
}
const giveBack = (ctx, id, qty) => { if (stockOf(ctx) && qty > 1e-9) call(ctx, 'stock.add', { id, qty: Math.round(qty * 1e6) / 1e6 }); };
const nameOf = (id) => (ITEMS[id] ? ITEMS[id].name.toLowerCase() : id);
const matName = (id) => (id === 'soil' ? 'earth' : SURFACES[id] ? SURFACES[id].name.toLowerCase() : id);
const shovelOk = (ctx) => !stockOf(ctx) || hasTool(ctx, 'shovel') || hasTool(ctx, 'spade');

// ---------------------------------------------------------------------------------------- what stands where
const plantNear = (s, x, z, r = 0.22) => Object.values(s.plants).find((p) => Math.hypot(p.x - x, p.z - z) < r) || null;
// Stones sit on the ground (less how far they are set in, less how far they have sunk), or on the stone below.
function reseat(s) {
  const done = new Set();
  const seat = (o, depth = 0) => {
    if (done.has(o.id) || depth > 64) return;
    const b = o.on && s.things[o.on];
    if (b) { seat(b, depth + 1); o.y = r4(b.y + THINGS[b.k].dims.h); o.ax = b.ax; o.az = b.az; }
    else { if (o.on) o.on = null; o.y = r4(EW.reliefAt(s.grid, o.ax, o.az) - THINGS[o.k].sink - (THINGS[o.k].box ? 0 : o.sag || 0)); }
    done.add(o.id);
  };
  for (const id in s.things) seat(s.things[id]);
}

// ---------------------------------------------------------------------------------------- the shovel
// A blade's bite at (x, z): the scoop comes up on the shovel. A scoop is all of a laid layer, or all earth.
function dig(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  if (!shovelOk(ctx)) return fail('You need a shovel.');
  if (s.carry.m3 > 1e-6) return fail('The shovel is full. Throw the load somewhere first.');
  const x = +p.x, z = +p.z, pl = plantNear(s, x, z);
  if (pl) return fail('The ' + PLANTS[pl.k].name.toLowerCase() + ' is planted there. Lift it with your hands first.');
  const g = s.grid, i = pt(x), j = pt(z), wasTurf = EW.sAt(g, i, j) === 0, f0 = EW.fAt(g, i, j);
  const res = EW.cut(g, x, z, SCOOP_M3 * (p.scale || s.scale || 1), { r: 0.34, t: hours(ctx), clearF: FLAG.TAMP1 | FLAG.TAMP2, looseStays: true });
  // a heap dug into at its foot is left over-steep: it slides (the view rolls it down grain by grain; else within the hour)
  (s.unsettled ||= []).push([r3(x), r3(z)]); if (s.unsettled.length > 64) s.unsettled.shift();
  if (!(res.m3 > 1e-6)) return fail('That is as deep as a shovel will go here.');
  // the blade tears the turf at the lip of the hole: a narrow rim of bare earth (the walls themselves stand firm)
  EW.paint(g, x, z, 0.37, { surface: 'soil', t: hours(ctx), ok: (q) => q.s === EW.UNTOUCHED });
  const cutLiner = unline(ctx, s, x, z, 0.2);
  if (f0 & FLAG.FABRIC) EW.paint(g, x, z, 0.16, { clearF: FLAG.FABRIC });
  reseat(s);
  s.carry = { m3: res.m3, s: res.s };                  // exact: what came out of the ground goes back in
  s.totals.dugM3 = r4(s.totals.dugM3 + res.m3);
  ctx.emit('landscape.dig', { m3: res.m3, s: res.s, turf: wasTurf });
  return { ok: true, m3: r4(res.m3), s: res.s, turf: wasTurf, liner: cutLiner, h: r3(EW.reliefAt(g, x, z)) };
}
// The load thrown onto (x, z): it lands in a heap and runs down to its angle of repose. Inside a garden box it
// stays inside the walls.
function dump(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  if (!(s.carry.m3 > 1e-6)) return fail('The shovel is empty.');
  const m3 = s.carry.m3, surf = s.carry.s, layer = !!(SURFACES[surf] && SURFACES[surf].layer);
  EW.fill(s.grid, +p.x, +p.z, m3, { r: 0.26, surface: surf, layer, t: hours(ctx), markF: FLAG.TURF });
  reseat(s);
  s.carry = { m3: 0, s: '' };
  s.totals.filledM3 = r4(s.totals.filledM3 + m3);
  ctx.emit('landscape.dump', { m3, s: surf });
  return { ok: true, m3, s: surf, h: r3(EW.reliefAt(s.grid, +p.x, +p.z)) };
}
// Grains in the air. A load thrown, a bag spilt or a slope that sheds becomes grains (the view rolls them); until a
// grain comes to rest its earth is held here, by material, and returned to the ground where it lands.
function airOf(s) { if (!s.air || typeof s.air !== 'object') s.air = {}; return s.air; }
function addAir(s, surf, m3, x, z) { const a = airOf(s); a[surf] = (a[surf] || 0) + m3; s.airAt = { x: r3(x), z: r3(z) }; }
// put earth from the air down at (x, z): one grain's worth
function landOne(ctx, s, x, z, m3, surf, r) {
  const a = airOf(s), have = a[surf] || 0, take = Math.min(have, m3);
  if (!(take > 0)) return 0;
  a[surf] = have - take; if (a[surf] <= 1e-9) delete a[surf];
  const sf = SURFACES[surf], layer = !!(sf && sf.layer), into = sf && sf.fillSoil ? 'soil' : surf;
  const put = EW.fill(s.grid, x, z, take, { r, surface: into, layer: layer && !sf.fillSoil, t: hours(ctx), markF: FLAG.TURF, spread: false });
  // the grain's odd fraction of a millimetre stays in the air for the next one
  if (Math.abs(take - put) > 1e-9) { a[surf] = Math.max(0, (a[surf] || 0) + take - put); if (a[surf] <= 1e-9) delete a[surf]; }
  return put;
}
// The load on the shovel leaves it: into the air, to land as grains.
function pour(ctx, p = {}) {
  const s = ensure(ctx);
  if (!(s.carry.m3 > 1e-6)) return fail('The shovel is empty.');
  const m3 = s.carry.m3, surf = s.carry.s;
  addAir(s, surf, m3, +p.x || 0, +p.z || 0);
  s.carry = { m3: 0, s: '' };
  s.totals.filledM3 = r4(s.totals.filledM3 + m3);
  ctx.emit('landscape.pour', { m3, s: surf });
  return { ok: true, m3, s: surf };
}
// Grains that came to rest: p.pts = [[x, z, m3, surface], ...].
function land(ctx, p = {}) {
  const s = ensure(ctx);
  let n = 0;
  for (const q of Array.isArray(p.pts) ? p.pts : []) {
    const [x, z, m3, surf] = q;
    if (!Number.isFinite(+x) || !Number.isFinite(+z) || !(+m3 > 0) || typeof surf !== 'string') continue;
    // a grain's footprint always takes in at least one point; then it lodges into the surface (no spike of one grain)
    if (landOne(ctx, s, +x, +z, +m3, surf, 0.11) > 0) { n++; EW.settle(s.grid, +x, +z, 0.22, EW.REPOSE, 3); }
  }
  if (n) reseat(s);
  return { ok: true, n };
}
// Loose slopes round (x, z) steeper than they stand shed grains: returned for the view to roll downhill.
function shedAt(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  // a slope sheds only past what grains at rest can make (they stop under ~0.72), so it settles instead of churning
  const out = EW.shed(s.grid, +p.x, +p.z, Math.min(1.2, +p.r || 0.7), EW.REPOSE * 1.15);
  for (const [x, z, m3, surf] of out) addAir(s, surf, m3, x, z);
  return { ok: true, pts: out.map((q) => [r3(q[0]), r3(q[1]), q[2], q[3], r3(q[4]), r3(q[5])]) };
}
// The flat of the shovel pushed along the ground (a step of a right-button drag): loose earth above `level` is pushed
// ahead, low spots are filled from it. See EW.push.
function pushCmd(ctx, p = {}) {
  const s = ensure(ctx);
  if (!shovelOk(ctx)) return fail('You need a shovel.');
  const v = [p.x0, p.z0, p.x1, p.z1].map(Number);
  if (!v.every(Number.isFinite)) return fail('Where?');
  if (Math.hypot(v[2] - v[0], v[3] - v[1]) > 0.5) return fail('Too far in one push.');
  const pl = plantNear(s, v[2], v[3]);
  if (pl) return fail('The ' + PLANTS[pl.k].name.toLowerCase() + ' is in the way.');
  const res = EW.push(s.grid, v[0], v[1], v[2], v[3], Number.isFinite(+p.level) ? +p.level : 0, { w: 0.45, t: hours(ctx) });
  reseat(s);
  return { ok: true, m3: res.m3, s: res.s };
}
// Finish settling round (x, z) at once (a slope the grains have worked on long enough).
function settleAt(ctx, p = {}) { const s = ensure(ctx); if (!finite(p)) return fail('Where?'); EW.settle(s.grid, +p.x, +p.z, Math.min(1.2, +p.r || 0.7)); reseat(s); return { ok: true }; }
// Anything still in the air (a save made mid-throw, a view that never landed it) comes down where it was going.
function landAll(ctx, s) {
  const a = airOf(s), at = s.airAt || { x: 0, z: 0 };
  for (const surf of Object.keys(a)) { const m3 = a[surf]; if (m3 > 0) landOne(ctx, s, at.x, at.z, m3, surf, 0.3); delete s.air[surf]; }
  EW.settle(s.grid, at.x, at.z, 1.2);
}

// Skim the turf off along a line of points (the blade slid under it): bare earth about 3 cm lower.
const TURF_M = 0.03;
function skim(ctx, p = {}) {
  const s = ensure(ctx);
  if (!shovelOk(ctx)) return fail('You need a shovel.');
  let m = 0;
  for (const c of Array.isArray(p.points) ? p.points : []) {
    if (!Number.isFinite(+c[0]) || !Number.isFinite(+c[1]) || plantNear(s, +c[0], +c[1], 0.25)) continue;
    m += EW.strip(s.grid, +c[0], +c[1], 0.17, TURF_M, { t: hours(ctx) });
  }
  if (m) { reseat(s); s.totals.turfM3 = r4(s.totals.turfM3 + m); ctx.emit('landscape.skim', { m3: m }); }
  return { ok: true, m3: r4(m), m2: r3(m / TURF_M) };
}

// ---------------------------------------------------------------------------------------- the wheelbarrow
function load(ctx, p = {}) {
  const s = ensure(ctx);
  if (stockOf(ctx) && !hasTool(ctx, 'wheelbarrow')) return fail('You need a wheelbarrow.');
  if (s.barrow.m3 >= BARROW_M3 - 1e-6) return fail('The barrow is full. Wheel it somewhere and tip it.');
  if (!finite(p)) return fail('Where?');
  const x = +p.x, z = +p.z, g = s.grid, i = pt(x), j = pt(z);
  if (plantNear(s, x, z)) return fail('A plant is there.');
  const mat = EW.lAt(g, i, j) > 0.002 ? EW.nameOf(g, EW.sAt(g, i, j)) : 'soil';
  if (s.barrow.m3 > 1e-6 && s.barrow.s !== mat) return fail('The barrow holds ' + matName(s.barrow.s) + '. Tip that first.');
  const turf = EW.sAt(g, i, j) === 0;
  const res = EW.cut(g, x, z, Math.min(BARROW_M3 - s.barrow.m3, SCOOP_M3 * (s.scale || 1)), { r: 0.21, t: hours(ctx), clearF: FLAG.TAMP1 | FLAG.TAMP2 });
  if (!(res.m3 > 1e-6)) return fail('That is as deep as a shovel will go here.');
  unline(ctx, s, x, z, 0.2);
  reseat(s);
  s.barrow = { m3: r4(s.barrow.m3 + res.m3), s: mat };
  s.totals.dugM3 = r4(s.totals.dugM3 + res.m3);
  ctx.emit('landscape.load', { m3: res.m3, s: mat });
  return { ok: true, m3: r4(res.m3), load: s.barrow.m3, full: s.barrow.m3 >= BARROW_M3 - 1e-6, s: mat, turf };
}
function tip(ctx, p = {}) {
  const s = ensure(ctx);
  if (!(s.barrow.m3 > 1e-6)) return fail('The barrow is empty.');
  if (!finite(p)) return fail('Where?');
  const m3 = s.barrow.m3, surf = s.barrow.s, layer = !!(SURFACES[surf] && SURFACES[surf].layer);
  EW.fill(s.grid, +p.x, +p.z, m3, { r: 0.45, surface: surf, layer, t: hours(ctx), markF: FLAG.TURF });
  reseat(s);
  s.barrow = { m3: 0, s: '' };
  s.totals.filledM3 = r4(s.totals.filledM3 + m3);
  ctx.emit('landscape.tip', { m3, s: surf });
  return { ok: true, m3, s: surf };
}

// ---------------------------------------------------------------------------------------- rake and tamper
function rake(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  if (stockOf(ctx) && !hasTool(ctx, 'rake')) return fail('You need a rake.');
  const moved = EW.relax(s.grid, +p.x, +p.z, Math.min(0.6, +p.r || 0.35), Math.min(1, +p.k || 0.5));
  if (moved > 0) { reseat(s); ctx.emit('landscape.rake', { m3: moved }); }
  return { ok: true, m3: r4(moved) };
}
// Tamp the loose ground under the plate: once is settled, twice is firm. Tamping squeezes a little height out of
// freshly loosened earth (about a centimetre).
function tamp(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  if (stockOf(ctx) && !hasTool(ctx, 'tamper')) return fail('You need a hand tamper.');
  const g = s.grid;
  let n = 0, firm = 0;
  for (const [i, j, w] of EW.footprint(g, +p.x, +p.z, 0.2)) {
    if (w < 0.3) continue;
    const q = EW.point(g, i, j);
    if (!q || q.s === EW.UNTOUCHED) continue;
    const t0 = tampOf(q.f);
    if (t0 >= 2) { firm++; continue; }
    const f = (q.f & ~(FLAG.TAMP1 | FLAG.TAMP2 | EW.LOOSE_BIT)) | (t0 === 0 ? FLAG.TAMP1 : FLAG.TAMP2);   // packed: firm
    EW.setPoint(g, i, j, { f, h: q.h - (t0 === 0 && !q.l ? 0.01 : 0.003) });
    n++;
  }
  if (!n && !firm) return fail('The tamper firms loose ground: dig or lay something here first.');
  g.rev++;
  reseat(s);
  return { ok: true, points: n, firm: n === 0 };
}

// ---------------------------------------------------------------------------------------- laying things down
// Lay a loose layer (gravel, chips, sand...) or fill earth (raised-bed soil) over a round brush, p.m3 in all.
// Layers go only on worked ground: grass grows up through gravel laid on turf.
function spread(ctx, p = {}) {
  const s = ensure(ctx), sf = SURFACES[p.surface];
  if (!sf || (!sf.layer && !sf.fillSoil)) return fail('Unknown surface.');
  if (!finite(p)) return fail('Where?');
  const g = s.grid, x = +p.x, z = +p.z, r = Math.min(0.7, +p.r || 0.4);
  if (sf.layer) {
    const loose = EW.footprint(g, x, z, r).filter(([i, j]) => { const c = EW.sAt(g, i, j); return c !== 0 && EW.nameOf(g, c) !== 'lawn_sown'; });
    if (!loose.length) return fail('Skim the turf off first (drag the shovel along the grass), or the grass comes up through the ' + sf.name.toLowerCase() + '.');
  }
  const want = Math.max(0, +p.m3 || 0.003);
  const units = spend(ctx, sf.item, want / sf.m3PerUnit);
  if (!(units > 0)) return fail('You have no ' + nameOf(sf.item) + '. Buy some in the yard store.');
  const m3 = units * sf.m3PerUnit;
  const put = sf.layer ? EW.fill(g, x, z, m3, { r, surface: sf.id, layer: true, onTurf: false, t: hours(ctx), spread: false }) : EW.fill(g, x, z, m3, { r, surface: 'soil', t: hours(ctx) });
  if (!put) { giveBack(ctx, sf.item, units); return fail('Nothing here to cover.'); }
  reseat(s);
  s.totals.laidM3 = r4(s.totals.laidM3 + m3);
  ctx.emit('landscape.spread', { surface: sf.id, m3 });
  return { ok: true, m3: r4(m3) };
}
// Roll landscape fabric over the worked ground in a brush. It goes under whatever is laid after.
function fabric(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  const g = s.grid, r = Math.min(0.6, +p.r || 0.4);
  const ok = (q) => q.s !== EW.UNTOUCHED && !(q.f & FLAG.FABRIC);
  const fp = EW.footprint(g, +p.x, +p.z, r).filter(([i, j, w]) => w >= 0.2 && ok(EW.point(g, i, j) || { s: '', f: 0 }));
  if (!fp.length) return fail('Fabric goes on dug-out ground: skim the turf off or dig the path out first.');
  const m2 = spend(ctx, 'landscape_fabric', fp.length * A * 1.1);
  if (!(m2 > 0)) return fail('You have no landscape fabric. Buy some in the yard store.');
  const n = EW.paint(g, +p.x, +p.z, r, { setF: FLAG.FABRIC, ok });
  ctx.emit('landscape.fabric', { m2: r3(n * A) });
  return { ok: true, m2: r3(n * A) };
}
// Sow grass seed on bare earth in a brush. In about three weeks of growing weather it is turf again.
function seedLawn(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  const g = s.grid, r = Math.min(0.7, +p.r || 0.4), soil = EW.code(g, 'soil');
  const ok = (q, i, j) => EW.sAt(g, i, j) === soil && !EW.lAt(g, i, j);
  const n0 = EW.footprint(g, +p.x, +p.z, r).filter(([i, j, w]) => w >= 0.2 && ok(null, i, j)).length;
  if (!n0) return fail('Grass seed wants bare, raked earth.');
  const kg = spend(ctx, 'grass_seed', n0 * A * LAWN.seedKgPerM2);
  if (!(kg > 0)) return fail('You have no lawn seed. Buy some in the yard store.');
  const n = EW.paint(g, +p.x, +p.z, r, { surface: 'lawn_sown', t: hours(ctx), ok });
  ctx.emit('landscape.seedLawn', { m2: r3(n * A) });
  return { ok: true, m2: r3(n * A) };
}
// Pull the weeds out of a laid surface under the hand.
function weed(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  const g = s.grid;
  let n = 0;
  for (const [i, j] of EW.footprint(g, +p.x, +p.z, 0.25)) { const f = EW.fAt(g, i, j); if (weedOf(f)) { EW.setPoint(g, i, j, { f: f & ~FLAG.WEED }); n++; } }
  if (n) g.rev++;
  return { ok: n > 0, points: n };
}

// ---------------------------------------------------------------------------------------- stones and boxes
function place(ctx, p = {}) {
  const s = ensure(ctx), th = THINGS[p.kind];
  if (!th) return fail('Unknown piece.');
  if (!finite(p)) return fail('Where?');
  if (Object.keys(s.things).length >= MAX_THINGS) return fail('That is as many stones as one yard can hold.');
  const x = +p.x, z = +p.z, yaw = Number.isFinite(+p.yaw) ? +p.yaw : 0;
  let below = null;
  if (th.stack) {
    for (const id in s.things) {
      const o = s.things[id], ot = THINGS[o.k];
      if (!ot.stack || Math.hypot(o.x - x, o.z - z) > Math.max(ot.dims.w, ot.dims.d) * 0.55) continue;
      if (!below || o.y + ot.dims.h > below.y + THINGS[below.k].dims.h) below = o;
    }
  }
  if (!below) {
    for (const id in s.things) {
      const o = s.things[id], ot = THINGS[o.k];
      if (th.box || ot.box) {
        if (th.box && ot.box && Math.hypot(o.x - x, o.z - z) < Math.min(th.dims.d, ot.dims.d)) return fail('Another garden box is in the way.');
        continue;
      }
      const reach = (Math.min(ot.dims.w, ot.dims.d) + Math.min(th.dims.w, th.dims.d)) * 0.45;
      if (Math.hypot(o.x - x, o.z - z) < reach) return fail('Another ' + ot.name.toLowerCase() + ' is in the way.');
    }
    if (plantNear(s, x, z, th.box ? 0.9 : 0.2)) return fail('A plant is in the way.');
  }
  if (spend(ctx, th.item, th.qty) < th.qty - 1e-9) return fail('You have no ' + nameOf(th.item) + ' left. Buy more in the yard store.');
  const id = 's' + s.nextId++;
  const o = below
    ? { id, k: th.id, x: r3(x), z: r3(z), yaw: r3(yaw), y: 0, ax: below.ax, az: below.az, on: below.id, sag: 0 }
    : { id, k: th.id, x: r3(x), z: r3(z), yaw: r3(yaw), y: 0, ax: r3(x), az: r3(z), on: null, sag: 0 };
  s.things[id] = o;
  if (th.box) cage(s, o, true);
  reseat(s);
  // laid on ground that was not tamped firm, a stone will settle
  const firm = !!below || !!th.box || tampOf(EW.fAt(s.grid, pt(x), pt(z))) >= INSTALL.tampPasses;
  ctx.emit('landscape.place', { id, kind: th.id, stacked: !!below });
  return { ok: true, id, stacked: !!below, course: below ? courseOf(s, o) : 1, firm };
}
const courseOf = (s, o) => { let n = 1; while (o && o.on && s.things[o.on]) { o = s.things[o.on]; n++; } return n; };
// mark the ground inside a garden box's walls (or clear it), so earth put in it stays in
function cage(s, o, on) {
  const th = THINGS[o.k], g = s.grid, R = Math.hypot(th.dims.w, th.dims.d) / 2 + 0.1;
  for (let j = pt(o.z - R); j <= pt(o.z + R); j++) for (let i = pt(o.x - R); i <= pt(o.x + R); i++) {
    const c = Math.cos(o.yaw), sn = Math.sin(o.yaw), dx = i * STEP - o.x, dz = j * STEP - o.z, u = dx * c - dz * sn, v = dx * sn + dz * c;
    if (Math.abs(u) >= th.dims.w / 2 - 0.03 || Math.abs(v) >= th.dims.d / 2 - 0.03) continue;
    const f = EW.fAt(g, i, j);
    EW.setPoint(g, i, j, { f: on ? f | FLAG.WALL : f & ~FLAG.WALL });
  }
  g.rev++;
}
function take(ctx, p = {}) {
  const s = ensure(ctx), o = s.things[p.id];
  if (!o) return fail('Nothing there.');
  for (const id in s.things) if (s.things[id].on === o.id) return fail('Lift the one on top first.');
  const th = THINGS[o.k];
  if (th.bag) return fail('Carry the bag, or break it open with the shovel.');
  if (th.box && EW.reliefAt(s.grid, o.x, o.z) > 0.05) return fail('Empty the soil out of the box first.');
  if (th.box) cage(s, o, false);
  delete s.things[p.id];
  giveBack(ctx, th.item, th.qty);
  ctx.emit('landscape.take', { id: p.id, kind: o.k });
  return { ok: true, kind: o.k };
}

// ---------------------------------------------------------------------------------------- planting
// The deepest point of the ground within reach of the hand: that is the hole.
function holeNear(s, x, z, r = 0.25) {
  let best = null;
  for (const [i, j] of EW.footprint(s.grid, x, z, r)) { const h = EW.hAt(s.grid, i, j); if (!best || h < best.h) best = { x: i * STEP, z: j * STEP, h }; }
  return best || { x, z, h: 0 };
}
function plant(ctx, p = {}) {
  const s = ensure(ctx), pk = PLANTS[p.kind];
  if (!pk) return fail('Unknown plant.');
  if (!finite(p)) return fail('Where?');
  if (Object.keys(s.plants).length >= MAX_PLANTS) return fail('That is as many plants as one yard can hold.');
  const x = +p.x, z = +p.z;
  if (plantNear(s, x, z, 0.25)) return fail('Something is already planted there.');
  const yaw = r3(ctx.rng ? ctx.rng('yaw').float() * Math.PI * 2 : 0);
  if (pk.wet) {
    const pd = pondAt(s, x, z), d = pd ? pd.depthAt(x, z) : 0;
    if (!pd || d < 0.04 || d > 0.3) return fail('A ' + pk.name.toLowerCase() + ' goes on the shallow shelf of a filled pond, in 5 to 25 cm of water.');
    if (spend(ctx, pk.item, 1) < 1) return fail('You have no ' + pk.name.toLowerCase() + ' in a pot. Buy one at the nursery.');
    const id = 'p' + s.nextId++;
    s.plants[id] = { id, k: pk.id, x: r3(x), z: r3(z), yaw, t: now(ctx), w: 1, g: 0, est: 0 };
    ctx.emit('landscape.plant', { id, kind: pk.id });
    return { ok: true, id, kind: pk.id };
  }
  const hole = holeNear(s, x, z);
  if (hole.h > -pk.holeM * 0.8) {
    const got = Math.max(0, -hole.h);
    return fail((got > 0.02 ? 'The hole is only ' + Math.round(got * 100) + ' cm deep: ' : 'Dig a hole first: ') + 'a ' + pk.name.toLowerCase() + ' wants about ' + Math.round(pk.holeM * 100) + ' cm.', { needM: pk.holeM, haveM: r3(got) });
  }
  if (spend(ctx, pk.item, 1) < 1) return fail('You have no ' + pk.name.toLowerCase() + ' in a pot. Buy one at the nursery.');
  // the root ball and the earth from the rim fill the hole back to the ground round it
  for (const [i, j, w] of EW.footprint(s.grid, hole.x, hole.z, 0.32)) { const h = EW.hAt(s.grid, i, j); if (h < 0) EW.setPoint(s.grid, i, j, { h: h * (1 - Math.min(1, w * 1.6)), s: 'soil' }); }
  s.grid.rev++;
  unline(ctx, s, hole.x, hole.z, 0.2);
  reseat(s);
  const id = 'p' + s.nextId++;
  s.plants[id] = { id, k: pk.id, x: r3(hole.x), z: r3(hole.z), yaw, t: now(ctx), w: 0.5, g: 0, est: 0 };
  ctx.emit('landscape.plant', { id, kind: pk.id });
  return { ok: true, id, kind: pk.id };
}
function lift(ctx, p = {}) {
  const s = ensure(ctx), pl = s.plants[p.id];
  if (!pl) return fail('Nothing planted there.');
  delete s.plants[p.id];
  giveBack(ctx, PLANTS[pl.k].item, 1);
  if (!PLANTS[pl.k].wet) EW.cut(s.grid, pl.x, pl.z, PLANTS[pl.k].holeM * 0.04, { r: 0.18, t: hours(ctx) });   // the root ball leaves a hollow
  reseat(s);
  ctx.emit('landscape.lift', { id: p.id, kind: pl.k });
  return { ok: true, kind: pl.k };
}

// ---------------------------------------------------------------------------------------- water
// Pour water at (x, z): plants within reach of the rose share it, a pond there takes it. From the garden's can
// (src/sim/garden.js, state.can.litres) unless p.carriedL says how much was carried.
function water(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  let litres = Math.max(0, +p.litres || 0);
  const g = ctx.get('garden');
  if (p.carriedL == null) {
    if (!g || !g.can) return fail('You need a watering can.');
    litres = Math.min(litres, g.can.litres);
    if (!(litres > 0)) return fail('The can is empty. Refill it.');
  } else litres = Math.min(litres, Math.max(0, +p.carriedL || 0));
  const x = +p.x, z = +p.z, near = Object.values(s.plants).filter((pl) => Math.hypot(pl.x - x, pl.z - z) < 0.6), pd = pondAt(s, x, z);
  if (!near.length && !pd) return fail('Nothing here to water.');
  if (p.carriedL == null) g.can.litres = r3(g.can.litres - litres);
  if (pd) s.ponds[pd.root] = r4(Math.min(pd.cap, (s.ponds[pd.root] || 0) + litres / 1000));
  else for (const pl of near) pl.w = r3(Math.min(1, (pl.w ?? 0.5) + litres / near.length / ESTABLISH.litresFull));
  ctx.emit('landscape.water', { litres, plants: near.length, pond: !!pd });
  return { ok: true, litres, plants: pd ? 0 : near.length, pond: pd ? pd.root : null };
}
// Lay pond liner in one sheet over the whole dug hole under the hand (every dug point joined to it).
function line(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  const g = s.grid, dug = (i, j) => EW.sAt(g, i, j) !== 0 && EW.hAt(g, i, j) <= -0.03;
  const h0 = holeNear(s, +p.x, +p.z, 0.2), si = pt(h0.x), sj = pt(h0.z);
  if (!dug(si, sj)) return fail('Dig the pond out first: the liner goes over a dug hole, up its sides.');
  const seen = new Set([si + ',' + sj]), stack = [[si, sj]], cells = [];
  while (stack.length && cells.length < 40000) {
    const [i, j] = stack.pop();
    if (!(EW.fAt(g, i, j) & FLAG.LINER)) cells.push([i, j]);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = i + di + ',' + (j + dj); if (!seen.has(k) && dug(i + di, j + dj)) { seen.add(k); stack.push([i + di, j + dj]); } }
  }
  if (!cells.length) return fail('That hole is already lined.');
  const m2 = spend(ctx, 'pond_liner', cells.length * A * 1.3);   // up the sides and the folds: about a third more than the floor
  if (!(m2 > 0)) return fail('You have no pond liner. Buy some in the yard store.');
  const n = Math.min(cells.length, Math.floor(m2 / (A * 1.3) + 1e-6)) || 1;
  for (let k = 0; k < n; k++) { const [i, j] = cells[k]; EW.setPoint(g, i, j, { f: EW.fAt(g, i, j) | FLAG.LINER }); }
  g.rev++;
  settlePonds(s);
  ctx.emit('landscape.line', { m2: r3(n * A) });
  return { ok: true, m2: r3(n * A), points: n };
}
// cutting into lined ground takes the liner there out (back to stock) and lets the pond's water out with it
function unline(ctx, s, x, z, r) {
  const g = s.grid;
  let n = 0, root = null;
  for (const [i, j] of EW.footprint(g, x, z, r)) {
    const f = EW.fAt(g, i, j);
    if (!(f & FLAG.LINER)) continue;
    if (!root) { const pd = pondAt(s, i * STEP, j * STEP); root = pd && pd.root; }
    EW.setPoint(g, i, j, { f: f & ~FLAG.LINER }); n++;
  }
  if (!n) return false;
  if (root) delete s.ponds[root];
  g.rev++;
  pondCache.delete(s);
  settlePonds(s);
  giveBack(ctx, 'pond_liner', n * A * 1.3);
  return true;
}
function hose(ctx, p = {}) {
  const s = ensure(ctx);
  if (stockOf(ctx) && !hasTool(ctx, 'garden_hose')) return fail('You need a garden hose.');
  if (!finite(p)) return fail('Where?');
  const pd = pondAt(s, +p.x, +p.z);
  if (!pd) return fail('Point the hose into a lined pond.');
  const on = p.on != null ? !!p.on : !s.hose[pd.root];
  if (on && pd.cap < 0.002) return fail('The water would run straight out: some of the hole round the liner is lower than its edge. Line the whole hole, up its sides.');
  if (on && (s.ponds[pd.root] || 0) >= pd.cap - 1e-4) return fail('The pond is full.');
  if (on) s.hose[pd.root] = 1; else delete s.hose[pd.root];
  ctx.emit('landscape.hose', { on, pond: pd.root });
  return { ok: true, on, pond: pd.root };
}
// Ponds: lined points that touch make one pond. Its water fills the lowest points first, up to the lowest point of
// its rim (the unlined ground round it).
const pondCache = new WeakMap();
function ponds(s) {
  let c = pondCache.get(s);
  if (c && c.rev === s.grid.rev) return c;
  const g = s.grid, lined = new Set();
  for (const [i, j, , , , f] of EW.worked(g, 0)) if (f & FLAG.LINER) lined.add(i + ',' + j);
  const seen = new Set(), list = [], byKey = new Map();
  for (const k of lined) {
    if (seen.has(k)) continue;
    const pts = [], stack = [k];
    seen.add(k);
    while (stack.length) {
      const cur = stack.pop(), q = cur.indexOf(','), i = +cur.slice(0, q), j = +cur.slice(q + 1);
      pts.push([i, j]);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nk = i + di + ',' + (j + dj); if (lined.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); } }
    }
    let rim = Infinity;
    for (const [i, j] of pts) for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!lined.has(i + di + ',' + (j + dj))) rim = Math.min(rim, EW.hAt(g, i + di, j + dj));
    const hs = pts.map(([i, j]) => EW.hAt(g, i, j));
    const vol = (L) => { let v = 0; for (const h of hs) if (L > h) v += (L - h) * A; return v; };
    const root = pts.map(([i, j]) => i + ',' + j).sort()[0];
    const lo0 = Math.min(...hs);
    const pd = { root, pts, rim, cap: r4(Math.max(0, vol(rim))) };
    pd.level = (m3) => {
      if (!(m3 > 0)) return -Infinity;
      let lo = lo0, hi = rim;
      for (let n = 0; n < 40; n++) { const mid = (lo + hi) / 2; if (vol(mid) < m3) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    };
    pd.depthAt = (x, z) => Math.max(0, pd.level(s.ponds[root] || 0) - EW.reliefAt(g, x, z));
    list.push(pd);
    for (const [i, j] of pts) byKey.set(i + ',' + j, pd);
  }
  c = { rev: g.rev, list, byKey };
  pondCache.set(s, c);
  return c;
}
function settlePonds(s) {
  const { list, byKey } = ponds(s);
  for (const r of Object.keys(s.ponds)) if (!list.some((pd) => pd.root === r)) {
    const pd = byKey.get(r);
    if (pd) s.ponds[pd.root] = r4((s.ponds[pd.root] || 0) + s.ponds[r]);
    delete s.ponds[r];
  }
  for (const r of Object.keys(s.hose)) if (!list.some((pd) => pd.root === r)) delete s.hose[r];
  for (const pd of list) if ((s.ponds[pd.root] || 0) > pd.cap) s.ponds[pd.root] = pd.cap;
}
function pondAt(s, x, z) {
  const { byKey } = ponds(s), i = pt(x), j = pt(z);
  for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const pd = byKey.get(i + di + ',' + (j + dj)); if (pd) return pd; }
  return null;
}

// ---------------------------------------------------------------------------------------- deliveries and bags
// Turn bought material into things in the yard at (x, z): bagged material as bags set down in a row, bulk as a heap
// tipped off the truck. p.item: the stock item; p.qty: how much of it (litres or m3, its own unit).
function deliver(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  const id = p.item, unit = ITEMS[id] && ITEMS[id].unit, x = +p.x, z = +p.z;
  if (BAGGED[id] && unit === 'L') {
    const n = Math.max(1, Math.floor(Math.min(+p.qty || BAG_L, haveQty(ctx, id)) / BAG_L + 1e-6));
    if (haveQty(ctx, id) < BAG_L - 1e-6) return fail('You have no ' + nameOf(id) + ' to set out.');
    if (spend(ctx, id, n * BAG_L) < n * BAG_L - 1e-6) return fail('You have no ' + nameOf(id) + ' to set out.');
    const ids = [];
    for (let k = 0; k < n; k++) {
      const bid = 's' + s.nextId++, row = Math.floor(k / 3), col = k % 3;
      const bx = r3(x + col * 0.42 - 0.42), bz = r3(z + row * 0.6);
      s.things[bid] = { id: bid, k: 'bag', x: bx, z: bz, yaw: r3(0.15 * (k % 2 ? 1 : -1)), y: 0, ax: bx, az: bz, on: null, sag: 0, m: BAGGED[id], L: BAG_L };
      ids.push(bid);
    }
    reseat(s);
    ctx.emit('landscape.deliver', { item: id, bags: n });
    return { ok: true, bags: n, ids };
  }
  if (BULK[id] && unit === 'm3') {
    const m3 = spend(ctx, id, Math.min(+p.qty || 0.25, haveQty(ctx, id)));
    if (!(m3 > 0)) return fail('You have no ' + nameOf(id) + ' to set out.');
    EW.fill(s.grid, x, z, m3, { r: 0.55, surface: BULK[id], layer: true, t: hours(ctx), markF: FLAG.TURF });
    reseat(s);
    ctx.emit('landscape.deliver', { item: id, m3 });
    return { ok: true, m3: r4(m3) };
  }
  return fail('That is not delivered loose.');
}
// Break a bag open where it lies: it spills in a heap.
function open(ctx, p = {}) {
  const s = ensure(ctx), o = s.things[p.id];
  if (!o || o.k !== 'bag') return fail('That is not a bag.');
  const m3 = (o.L || BAG_L) / 1000, sf = SURFACES[o.m];
  delete s.things[p.id];
  // spilt: the contents go into the air at the bag, to come out as grains
  if (p.spill) { addAir(s, o.m, m3, o.x, o.z); reseat(s); ctx.emit('landscape.open', { m: o.m, m3 }); return { ok: true, m: o.m, m3, x: o.x, z: o.z }; }
  if (sf && sf.fillSoil) EW.fill(s.grid, o.x, o.z, m3, { r: 0.3, surface: 'soil', t: hours(ctx) });
  else EW.fill(s.grid, o.x, o.z, m3, { r: 0.3, surface: o.m, layer: true, t: hours(ctx), markF: FLAG.TURF });
  reseat(s);
  ctx.emit('landscape.open', { m: o.m, m3 });
  return { ok: true, m: o.m, m3 };
}
// Carry a bag (or a single loose stone) to (x, z) and set it down.
function moveThing(ctx, p = {}) {
  const s = ensure(ctx), o = s.things[p.id];
  if (!o) return fail('Nothing there.');
  if (!finite(p)) return fail('Where?');
  if (o.on || THINGS[o.k].box) return fail('That stays where it is.');
  for (const id in s.things) if (s.things[id].on === o.id) return fail('Lift the one on top first.');
  o.x = o.ax = r3(+p.x); o.z = o.az = r3(+p.z); o.sag = 0;
  reseat(s);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------- generic moves, settings
function move(ctx, p = {}) {
  const s = ensure(ctx);
  if (!Array.isArray(p.from) || !Array.isArray(p.to)) return fail('From where to where?');
  const got = EW.move(s.grid, p.from, p.to, Math.min(0.01, Math.max(0, +p.m3 || 0)), hours(ctx));
  if (got > 0) reseat(s);
  return { ok: got > 0, m3: got, h: r3(EW.reliefAt(s.grid, p.to[0], p.to[1])) };
}
function setScale(ctx, p = {}) {
  const s = ensure(ctx), v = +p.scale;
  if (!SCOOP_SCALES.includes(v)) return fail('Earth per scoop is 1, 2 or 4 shovelfuls.');
  s.scale = v;
  return { ok: true, scale: v };
}

// ---------------------------------------------------------------------------------------- the slow part
// Hourly: rain; sown lawns knitting; nursery plants drinking, rooting and growing; ponds filling and drying. Daily:
// stones settling on ground that was not tamped firm, weeds coming up through laid surfaces.
const STEP_TICKS = 60;
function step(ctx) {
  const s = ctx.s;
  if (!s || s.v !== STATE_V) { ctx.s = fresh(); return; }
  if (s.air && Object.keys(s.air).length) landAll(ctx, s);
  if (s.unsettled && s.unsettled.length) { for (const [ux, uz] of s.unsettled) EW.settle(s.grid, ux, uz, 1.0); s.unsettled = []; }
  const g = s.grid, w = ctx.get('weather');
  const tempC = w ? w.tempC ?? 10 : 15, warm = tempC > 5;
  const dt = ctx.dt, lifeDt = ctx.lifeDt ?? ctx.dt, hr = hours(ctx);
  const total = w && w.totals ? (w.totals.precipMm || 0) + (w.totals.meltMm || 0) : 0;
  const rainMm = s.rain == null ? 0 : Math.max(0, total - s.rain);
  s.rain = r3(total);
  s.hours = (s.hours || 0) + 1;
  const daily = s.hours % 24 === 0;

  // lawns, and (daily) weeds in laid surfaces
  const sown = EW.code(g, 'lawn_sown');
  let changed = false;
  for (const [, , , c, l, f, t0, tile, n] of EW.worked(g, 1)) {
    if (c === sown) {
      if (!warm) tile.t[n] = t0 + Math.round(lifeDt / 3600);      // cold hours do not count toward the cover
      else if (hr - t0 >= LAWN.coverDays * 24) { tile.s[n] = 0; changed = true; }
      continue;
    }
    if (daily && warm && l > 0.002) {
      // the grass under a layer laid on turf comes straight up through it; fabric keeps nearly everything down
      const days = f & FLAG.FABRIC ? INSTALL.weedDaysFabric : f & FLAG.TURF ? INSTALL.weedDaysBare / 3 : INSTALL.weedDaysBare, wd = weedOf(f);
      // each point comes up on its own day (offset by where it is), one step of weeds per `days` of growing weather
      const lifeDays = (lifeDt * 24) / DAY;
      if (wd < 7 && ((hr / 24 + (n * 7.31) % days) % days) < lifeDays) { tile.f[n] = (f & ~FLAG.WEED) | ((wd + 1) << WEED_SHIFT); changed = true; }
    }
  }
  if (changed) g.rev++;

  // stones on ground that was not tamped firm sink over their first weeks (walls go down with them)
  if (daily) {
    let moved = false;
    for (const id in s.things) {
      const o = s.things[id], th = THINGS[o.k];
      if (o.on || th.box || th.glow || th.bag || (o.sag || 0) >= INSTALL.sagM) continue;
      if (tampOf(EW.fAt(g, pt(o.ax), pt(o.az))) >= INSTALL.tampPasses) continue;
      o.sag = r4(Math.min(INSTALL.sagM, (o.sag || 0) + (INSTALL.sagM * (lifeDt * 24)) / (INSTALL.sagDays * DAY)));
      moved = true;
    }
    if (moved) reseat(s);
  }

  // nursery plants
  const etMm = Math.max(0.5, 0.25 * tempC) * (dt / DAY);
  for (const id in s.plants) {
    const p = s.plants[id], pk = PLANTS[p.k];
    if (pk.wet) p.w = 1;
    else {
      const rooted = p.est >= ESTABLISH.days;
      p.w = r4(clamp01(p.w + rainMm / ESTABLISH.rootMm - (rooted ? etMm / 4 : etMm) / ESTABLISH.rootMm));
      if (rooted && tempC < 28) p.w = Math.max(p.w, 0.35);
    }
    if (warm && p.w >= ESTABLISH.growAt) { p.g = r4(p.g + lifeDt / (365 * DAY)); if (p.est < ESTABLISH.days) p.est = r3(p.est + lifeDt / DAY); }
  }

  // ponds
  settlePonds(s);
  const P = ponds(s);
  if (P.list.length) {
    const evap = (warm && tempC > 10 ? POND.evapMmWarm : POND.evapMmCool) * (dt / DAY);
    for (const pd of P.list) {
      let v = s.ponds[pd.root] || 0;
      const ar = pd.pts.length * A;
      v += (rainMm / 1000) * ar;
      if (v > 0) v -= (evap / 1000) * Math.min(ar, v / 0.01);
      if (s.hose[pd.root]) { v += (POND.hoseLpm * dt) / 60 / 1000; if (v >= pd.cap - 1e-4) { delete s.hose[pd.root]; ctx.emit('landscape.pondFull', { pond: pd.root }); } }
      v = Math.max(0, Math.min(pd.cap, v));
      if (v > 0) s.ponds[pd.root] = r4(v); else delete s.ponds[pd.root];
    }
  }
}

export const landscape = {
  name: 'landscape',
  every: STEP_TICKS,
  init: () => fresh(),
  step,
  commands: {
    'landscape.dig': dig, 'landscape.dump': dump, 'landscape.skim': skim, 'landscape.rake': rake, 'landscape.tamp': tamp, 'landscape.spread': spread,
    'landscape.fabric': fabric, 'landscape.seedLawn': seedLawn, 'landscape.weed': weed, 'landscape.place': place, 'landscape.take': take,
    'landscape.plant': plant, 'landscape.lift': lift, 'landscape.move': move, 'landscape.setScale': setScale,
    'landscape.load': load, 'landscape.tip': tip, 'landscape.water': water, 'landscape.line': line, 'landscape.hose': hose,
    'landscape.deliver': deliver, 'landscape.open': open, 'landscape.moveThing': moveThing,
    'landscape.pour': pour, 'landscape.land': land, 'landscape.shed': shedAt, 'landscape.settle': settleAt, 'landscape.push': pushCmd,
  },
};

// ---------------------------------------------------------------------------------------- read-outs
const stateOf = (state) => (state && state.sys ? state.sys.landscape : state);
const hasGrid = (s) => !!(s && s.grid && s.grid.tiles);
export function reliefAt(state, x, z) { const s = stateOf(state); return hasGrid(s) ? EW.reliefAt(s.grid, x, z) : 0; }
// what the ground is at a point: surface name, height, layer depth, fabric, how firm, weeds, liner, inside a box
export function groundAt(state, x, z) {
  const s = stateOf(state);
  if (!hasGrid(s)) return null;
  const q = EW.point(s.grid, pt(x), pt(z));
  if (!q) return null;
  return { s: q.s, h: EW.reliefAt(s.grid, x, z), l: q.l, fabric: !!(q.f & FLAG.FABRIC), tamped: tampOf(q.f), weeds: weedOf(q.f), liner: !!(q.f & FLAG.LINER), boxed: !!(q.f & FLAG.WALL) };
}
export function plantSize(state, id) {
  const s = stateOf(state), p = s && s.plants[id];
  if (!p) return null;
  const pk = PLANTS[p.k], k = 1 - Math.exp(-(p.g || 0) / (pk.years / 2.3));     // about nine-tenths grown at its named number of years
  const wilt = p.w < ESTABLISH.wiltAt;
  return { h: (pk.buy[0] + (pk.mature[0] - pk.buy[0]) * k) * (wilt ? 0.88 : 1), w: pk.buy[1] + (pk.mature[1] - pk.buy[1]) * k, k, wilt, thirsty: p.w < ESTABLISH.growAt, rooted: p.est >= ESTABLISH.days };
}
export function pondsOf(state) {
  const s = stateOf(state);
  if (!hasGrid(s)) return [];
  return ponds(s).list.map((pd) => ({ root: pd.root, pts: pd.pts, rim: pd.rim, cap: pd.cap, m3: s.ponds[pd.root] || 0, level: pd.level(s.ponds[pd.root] || 0), hose: !!s.hose[pd.root] }));
}
export const landscapeRead = { reliefAt, groundAt, plantSize, pondsOf, SURFACES, THINGS, PLANTS, SCOOP_M3, SCOOP_SCALES, LAWN, BARROW_M3, ESTABLISH, INSTALL, FLAG, BAG_L, BAGGED, BULK };
