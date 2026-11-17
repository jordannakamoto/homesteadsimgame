// Landscaping: the ground shaped by hand (dug, heaped, raked, surfaced), the stones set on it and the plants put in.
//
// The ground's shape and surface live in a generic earthwork grid (src/sim/core/earthwork.js) of 30 cm squares, the
// garden's own grid, so a bed's soil and a path's gravel share one surface. The content (surfaces, stones, nursery
// plants, the shovelful) is in src/sim/content/landscape.js. This file holds the commands and the slow changes:
// a sown lawn knitting back into turf.
//
// The garden reads the shape: a hilled potato is a raised square, a basin catches rain (src/sim/garden.js).
//
// State, at sim.state.sys.landscape (plain JSON):
//   { v, grid: { cellM, sq, rev }, carry: { m3, s } (the load on the shovel), scale (earth per scoop),
//     things: { [id]: { k, x, z, yaw, y, ax, az, on } }  y: base above the untouched ground at (ax, az), m;
//                                                           on: the id it sits on (a wall course), if any
//     plants: { [id]: { k, x, z, yaw, t, w, g, est } }      t: when planted (lifeT); w: root-zone moisture 0..1;
//                                                           g: years of growth so far; est: days toward rooted in
//     barrow: { m3, s } (the wheelbarrow's load), liner: { 'gx,gz': 1 } (squares under pond liner),
//     ponds: { [root key]: m3 of water }, hose: { [root key]: 1 } (a hose running into that pond),
//     rain: last rain total seen (mm), nextId, totals: { dugM3, filledM3, turfM3, laidM3 } }
// Commands: landscape.dig, .dump, .skim, .rake, .spread, .seedLawn, .place, .take, .plant, .lift, .move, .setScale,
//   .load, .tip (the wheelbarrow), .water, .line, .hose.
// Stones settle with the ground: dig under one and it drops; heap earth under it and it rides up.

import { makeGrid, keyOf, cellOf, square, heightOf, isLoose, cut, fill, slump, relax, move as moveSoil, setSurface, reliefAt as gridRelief, UNTOUCHED } from './core/earthwork.js';
import { SCOOP_M3, SCOOP_SCALES, LAWN, SURFACES, THINGS, PLANTS, BARROW_M3, ESTABLISH, POND } from './content/landscape.js';
import { ITEMS } from './items.js';
import { DAY } from './time.js';

const STATE_V = 1, CELL = 0.3, AREA = CELL * CELL;
const MAX_THINGS = 4000, MAX_PLANTS = 600;
const r3 = (v) => Math.round(v * 1000) / 1000, r4 = (v) => Math.round(v * 1e4) / 1e4;
const fail = (reason, extra) => ({ ok: false, reason, ...extra });

function fresh() {
  return { v: STATE_V, grid: makeGrid(CELL), carry: { m3: 0, s: '' }, barrow: { m3: 0, s: '' }, scale: 2, things: {}, plants: {}, liner: {}, ponds: {}, hose: {}, rain: null, nextId: 1, totals: { dugM3: 0, filledM3: 0, turfM3: 0, laidM3: 0 } };
}
// saves from before the wheelbarrow and ponds get the new fields
function upgrade(s) {
  if (!s.barrow) s.barrow = { m3: 0, s: '' };
  if (!s.liner) s.liner = {};
  if (!s.ponds) s.ponds = {};
  if (!s.hose) s.hose = {};
  if (s.rain === undefined) s.rain = null;
  return s;
}
function ensure(ctx) { if (!ctx.s || ctx.s.v !== STATE_V) ctx.s = fresh(); return upgrade(ctx.s); }

// ---------------------------------------------------------------------------------------- stones settle
// Every stone set in the ground sits at the shaped ground under it less how far it is set in; every stone in a wall
// sits on the one below. Called after anything that changes the ground's shape.
function reseat(s) {
  const done = new Set();
  const seat = (o, depth = 0) => {
    if (done.has(o.id) || depth > 64) return;
    const b = o.on && s.things[o.on];
    if (b) { seat(b, depth + 1); o.y = r4(b.y + THINGS[b.k].dims.h); o.ax = b.ax; o.az = b.az; }
    else { if (o.on) o.on = null; o.y = r4(gridRelief(s.grid, o.ax, o.az) - THINGS[o.k].sink); }
    done.add(o.id);
  };
  for (const id in s.things) seat(s.things[id]);
}

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

// ---------------------------------------------------------------------------------------- what stands on a square
function thingOn(s, gx, gz) {
  for (const id in s.things) { const o = s.things[id]; if (cellOf(s.grid, o.x) === gx && cellOf(s.grid, o.z) === gz) return o; }
  return null;
}
function plantOn(s, gx, gz, r = 0) {
  for (const id in s.plants) { const p = s.plants[id]; if (Math.abs(cellOf(s.grid, p.x) - gx) <= r && Math.abs(cellOf(s.grid, p.z) - gz) <= r) return p; }
  return null;
}
const at = (p) => [Math.floor(p.x / CELL + 1e-9), Math.floor(p.z / CELL + 1e-9)];
const finite = (p) => Number.isFinite(+p.x) && Number.isFinite(+p.z);

// ---------------------------------------------------------------------------------------- the shovel
// One scoop from the square under (x, z): a scoop is all of a laid layer or all soil, never a mix.
function dig(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  if (stockOf(ctx) && !hasTool(ctx, 'shovel') && !hasTool(ctx, 'spade')) return fail('You need a shovel.');
  if (s.carry.m3 > 1e-6) return fail('The shovel is full. Toss the load somewhere first.');
  const [gx, gz] = at(p);
  const pl = plantOn(s, gx, gz);
  if (pl) return fail('The ' + PLANTS[pl.k].name.toLowerCase() + ' is planted there. Lift it with your hands first.');
  const q = square(s.grid, gx, gz), want = SCOOP_M3 * (p.scale || s.scale || 1);
  const layerM3 = q && q[2] > 0 ? q[2] * AREA : 0;
  const res = cut(s.grid, gx, gz, layerM3 > 0 ? Math.min(want, layerM3 + 1e-9) : want, { t: ctx.lifeT ?? ctx.t, maxDepth: 1.2 });
  if (!(res.m3 > 1e-6)) return fail('That is as deep as a shovel will go here.');
  const wasTurf = !q || q[1] === UNTOUCHED;
  const cutLiner = unline(ctx, s, gx, gz);
  reseat(s);
  s.carry = { m3: res.m3, s: res.layer ? res.layer.s : 'soil' };
  s.totals.dugM3 = r4(s.totals.dugM3 + res.m3);
  ctx.emit('landscape.dig', { gx, gz, m3: res.m3, s: s.carry.s, turf: wasTurf });
  return { ok: true, m3: res.m3, s: s.carry.s, turf: wasTurf, liner: cutLiner, depthM: r3(-heightOf(s.grid, gx, gz)), h: heightOf(s.grid, gx, gz) };
}
// Toss the load on the shovel onto the square under (x, z). Soil heaps and runs down at its angle of repose.
function dump(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  if (!(s.carry.m3 > 1e-6)) return fail('The shovel is empty.');
  const [gx, gz] = at(p);
  const m3 = s.carry.m3, surf = s.carry.s, layer = !!(SURFACES[surf] && SURFACES[surf].layer);
  fill(s.grid, gx, gz, m3, { surface: surf, layer, t: ctx.lifeT ?? ctx.t });
  reseat(s);
  s.carry = { m3: 0, s: '' };
  s.totals.filledM3 = r4(s.totals.filledM3 + m3);
  ctx.emit('landscape.dump', { gx, gz, m3, s: surf });
  return { ok: true, m3, s: surf, h: heightOf(s.grid, gx, gz) };
}
// Skim the turf off: the squares named become bare soil about 3 cm lower; the turf goes to the compost heap.
const TURF_M = 0.03;
function skim(ctx, p = {}) {
  const s = ensure(ctx);
  if (stockOf(ctx) && !hasTool(ctx, 'shovel') && !hasTool(ctx, 'spade')) return fail('You need a shovel.');
  let n = 0;
  for (const c of Array.isArray(p.cells) ? p.cells : []) {
    const gx = Math.round(c[0]), gz = Math.round(c[1]), q = square(s.grid, gx, gz);
    if (q && q[1] !== UNTOUCHED) continue;
    if (thingOn(s, gx, gz) || plantOn(s, gx, gz)) continue;
    cut(s.grid, gx, gz, TURF_M * AREA, { t: ctx.lifeT ?? ctx.t });
    s.totals.turfM3 = r4(s.totals.turfM3 + TURF_M * AREA); n++;
  }
  if (n) { reseat(s); ctx.emit('landscape.skim', { cells: n }); }
  return { ok: true, cells: n };
}

// ---------------------------------------------------------------------------------------- the rake
function rake(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  if (stockOf(ctx) && !hasTool(ctx, 'rake')) return fail('You need a rake.');
  const moved = relax(s.grid, +p.x, +p.z, Math.min(0.6, +p.r || 0.35), Math.min(1, +p.k || 0.5), ctx.lifeT ?? ctx.t);
  if (moved > 0) { reseat(s); ctx.emit('landscape.rake', { m3: moved }); }
  return { ok: true, m3: r4(moved) };
}

// ---------------------------------------------------------------------------------------- surfaces
// Lay a loose layer (gravel, bark, sand) over the worked squares in a round brush, up to p.m3 in all. Untouched turf
// is refused: grass grows through a layer laid on it.
function spread(ctx, p = {}) {
  const s = ensure(ctx), sf = SURFACES[p.surface];
  if (!sf || !sf.layer) return fail('Unknown surface.');
  if (!finite(p)) return fail('Where?');
  const r = Math.min(0.7, +p.r || 0.4), x = +p.x, z = +p.z, cells = [];
  let turf = 0;
  for (let gz = cellOf(s.grid, z - r); gz <= cellOf(s.grid, z + r); gz++) for (let gx = cellOf(s.grid, x - r); gx <= cellOf(s.grid, x + r); gx++) {
    if (Math.hypot((gx + 0.5) * CELL - x, (gz + 0.5) * CELL - z) > r) continue;
    const q = square(s.grid, gx, gz);
    if (!isLoose(q) || q[1] === 'lawn_sown') { turf++; continue; }
    if (thingOn(s, gx, gz)) continue;
    cells.push([gx, gz]);
  }
  if (!cells.length) return fail(turf ? 'Skim the turf off first (shovel, drag along the ground), or the grass comes up through the ' + sf.name.toLowerCase() + '.' : 'Nothing here to cover.');
  const want = Math.max(0, +p.m3 || cells.length * AREA * 0.02);
  const units = spend(ctx, sf.item, want / sf.m3PerUnit);
  if (!(units > 0)) return fail('You have no ' + nameOf(sf.item) + '. Buy some in the yard store.');
  const m3 = units * sf.m3PerUnit, each = m3 / cells.length;
  for (const [gx, gz] of cells) fill(s.grid, gx, gz, each, { surface: sf.id, layer: true, t: ctx.lifeT ?? ctx.t, spread: false });
  reseat(s);
  s.totals.laidM3 = r4(s.totals.laidM3 + m3);
  ctx.emit('landscape.spread', { surface: sf.id, m3, cells: cells.length });
  return { ok: true, m3: r4(m3), cells: cells.length, partial: units < want / sf.m3PerUnit - 1e-9 };
}
// Sow grass seed on bare soil in a round brush. In about three weeks of the season it is turf again.
function seedLawn(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  const r = Math.min(0.7, +p.r || 0.4), x = +p.x, z = +p.z, cells = [];
  for (let gz = cellOf(s.grid, z - r); gz <= cellOf(s.grid, z + r); gz++) for (let gx = cellOf(s.grid, x - r); gx <= cellOf(s.grid, x + r); gx++) {
    if (Math.hypot((gx + 0.5) * CELL - x, (gz + 0.5) * CELL - z) > r) continue;
    const q = square(s.grid, gx, gz);
    if (q && q[1] === 'soil') cells.push([gx, gz]);
  }
  if (!cells.length) return fail('Grass seed wants bare, raked soil.');
  const kg = spend(ctx, 'grass_seed', cells.length * AREA * LAWN.seedKgPerM2);
  if (!(kg > 0)) return fail('You have no lawn seed. Buy some in the yard store.');
  const n = Math.min(cells.length, Math.floor(kg / (AREA * LAWN.seedKgPerM2) + 1e-6)) || 1;
  for (let i = 0; i < n; i++) setSurface(s.grid, cells[i][0], cells[i][1], 'lawn_sown', ctx.lifeT ?? ctx.t);
  ctx.emit('landscape.seedLawn', { cells: n });
  return { ok: true, cells: n };
}

// ---------------------------------------------------------------------------------------- stones
// Set a stone. A stone that stacks sits on the highest of its kind under it (a wall course); others sit in the ground.
function place(ctx, p = {}) {
  const s = ensure(ctx), th = THINGS[p.kind];
  if (!th) return fail('Unknown stone.');
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
      const o = s.things[id], ot = THINGS[o.k], reach = (Math.min(ot.dims.w, ot.dims.d) + Math.min(th.dims.w, th.dims.d)) * 0.45;
      if (Math.hypot(o.x - x, o.z - z) < reach) return fail('Another ' + ot.name.toLowerCase() + ' is in the way.');
    }
    const [gx, gz] = at({ x, z });
    if (plantOn(s, gx, gz)) return fail('A plant is in the way.');
  }
  if (spend(ctx, th.item, th.qty) < th.qty - 1e-9) return fail('You have no ' + nameOf(th.item) + ' left. Buy more in the yard store.');
  const id = 's' + s.nextId++;
  const o = below
    ? { k: th.id, x: r3(x), z: r3(z), yaw: r3(yaw), y: r4(below.y + THINGS[below.k].dims.h), ax: below.ax, az: below.az, on: below.id || null }
    : { k: th.id, x: r3(x), z: r3(z), yaw: r3(yaw), y: r4(gridRelief(s.grid, x, z) - th.sink), ax: r3(x), az: r3(z), on: null };
  o.id = id;
  s.things[id] = o;
  ctx.emit('landscape.place', { id, kind: th.id, stacked: !!below });
  return { ok: true, id, stacked: !!below, course: below ? courseOf(s, o) : 1 };
}
const courseOf = (s, o) => { let n = 1; while (o && o.on && s.things[o.on]) { o = s.things[o.on]; n++; } return n; };
function take(ctx, p = {}) {
  const s = ensure(ctx), o = s.things[p.id];
  if (!o) return fail('Nothing there.');
  for (const id in s.things) if (s.things[id].on === o.id) return fail('Lift the one on top first.');
  delete s.things[p.id];
  const th = THINGS[o.k];
  giveBack(ctx, th.item, th.qty);
  ctx.emit('landscape.take', { id: p.id, kind: o.k });
  return { ok: true, kind: o.k };
}

// ---------------------------------------------------------------------------------------- planting
// Put a nursery plant in the hole at (x, z): the hole must be about as deep as the root ball. The root ball fills it
// back to the ground around it, and a ring of bare soil is left round the stem.
function plant(ctx, p = {}) {
  const s = ensure(ctx), pk = PLANTS[p.kind];
  if (!pk) return fail('Unknown plant.');
  if (!finite(p)) return fail('Where?');
  if (Object.keys(s.plants).length >= MAX_PLANTS) return fail('That is as many plants as one yard can hold.');
  const [cx, cz] = at(p);
  // the deepest square within a step of the hand: that is the hole
  let best = null;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const h = heightOf(s.grid, cx + dx, cz + dz);
    if (!best || h < best[2]) best = [cx + dx, cz + dz, h];
  }
  const need = pk.holeM * 0.8;
  if (pk.wet) {
    // a marginal plant goes on the shallow shelf of a pond: under 5 to 25 cm of water
    const pd = pondAt(s, cx, cz);
    if (!pd || pd.depth(cx, cz) < 0.04 || pd.depth(cx, cz) > 0.3) return fail('A ' + pk.name.toLowerCase() + ' goes on the shallow shelf of a filled pond, in 5 to 25 cm of water.');
    if (spend(ctx, pk.item, 1) < 1) return fail('You have no ' + pk.name.toLowerCase() + ' in a pot. Buy one at the nursery.');
    const id = 'p' + s.nextId++;
    s.plants[id] = { id, k: pk.id, x: r3((cx + 0.5) * CELL), z: r3((cz + 0.5) * CELL), yaw: r3(ctx.rng ? ctx.rng('yaw').float() * Math.PI * 2 : 0), t: ctx.lifeT ?? ctx.t, w: 1, g: 0, est: 0 };
    ctx.emit('landscape.plant', { id, kind: pk.id });
    return { ok: true, id, kind: pk.id };
  }
  if (!best || best[2] > -need) {
    const got = best ? Math.max(0, -best[2]) : 0;
    return fail((got > 0.02 ? 'The hole is only ' + Math.round(got * 100) + ' cm deep: ' : 'Dig a hole first: ') + 'a ' + pk.name.toLowerCase() + ' wants about ' + Math.round(pk.holeM * 100) + ' cm.', { needM: pk.holeM, haveM: r3(got) });
  }
  const [gx, gz] = best;
  if (plantOn(s, gx, gz)) return fail('Something is already planted there.');
  if (spend(ctx, pk.item, 1) < 1) return fail('You have no ' + pk.name.toLowerCase() + ' in a pot. Buy one at the nursery.');
  // the root ball and the soil from the edge of the hole bring it back to the level around it
  const q = square(s.grid, gx, gz);
  fill(s.grid, gx, gz, -q[0] * AREA, { surface: 'soil', t: ctx.lifeT ?? ctx.t, spread: false });
  unline(ctx, s, gx, gz);
  reseat(s);
  const id = 'p' + s.nextId++;
  // planted from a pot with moist compost round the roots: it still wants watering in
  s.plants[id] = { id, k: pk.id, x: r3((gx + 0.5) * CELL), z: r3((gz + 0.5) * CELL), yaw: r3(ctx.rng ? ctx.rng('yaw').float() * Math.PI * 2 : 0), t: ctx.lifeT ?? ctx.t, w: 0.5, g: 0, est: 0 };
  ctx.emit('landscape.plant', { id, kind: pk.id });
  return { ok: true, id, kind: pk.id };
}
function lift(ctx, p = {}) {
  const s = ensure(ctx), pl = s.plants[p.id];
  if (!pl) return fail('Nothing planted there.');
  delete s.plants[p.id];
  giveBack(ctx, PLANTS[pl.k].item, 1);
  const [gx, gz] = at(pl);
  if (!PLANTS[pl.k].wet) cut(s.grid, gx, gz, PLANTS[pl.k].holeM * AREA * 0.5, { t: ctx.lifeT ?? ctx.t });   // the root ball leaves a hollow
  reseat(s);
  ctx.emit('landscape.lift', { id: p.id, kind: pl.k });
  return { ok: true, kind: pl.k };
}

// ---------------------------------------------------------------------------------------- the wheelbarrow
const hasBarrow = (ctx) => hasTool(ctx, 'wheelbarrow');
// Shovel a scoop from the ground straight into the barrow.
function load(ctx, p = {}) {
  const s = ensure(ctx);
  if (stockOf(ctx) && !hasBarrow(ctx)) return fail('You need a wheelbarrow.');
  if (s.barrow.m3 >= BARROW_M3 - 1e-6) return fail('The barrow is full. Wheel it somewhere and tip it.');
  const [gx, gz] = at(p);
  if (plantOn(s, gx, gz)) return fail('A plant is there.');
  const q = square(s.grid, gx, gz), layerM3 = q && q[2] > 0 ? q[2] * AREA : 0, mat = layerM3 > 0 ? q[1] : 'soil';
  if (s.barrow.m3 > 1e-6 && s.barrow.s !== mat) return fail('The barrow holds ' + matName(s.barrow.s) + '. Tip that first.');
  const want = Math.min(BARROW_M3 - s.barrow.m3, SCOOP_M3 * (s.scale || 1));
  const res = cut(s.grid, gx, gz, layerM3 > 0 ? Math.min(want, layerM3 + 1e-9) : want, { t: ctx.lifeT ?? ctx.t });
  if (!(res.m3 > 1e-6)) return fail('That is as deep as a shovel will go here.');
  unline(ctx, s, gx, gz);
  reseat(s);
  s.barrow = { m3: r4(s.barrow.m3 + res.m3), s: mat };
  s.totals.dugM3 = r4(s.totals.dugM3 + res.m3);
  ctx.emit('landscape.load', { m3: res.m3, s: mat });
  return { ok: true, m3: res.m3, load: s.barrow.m3, full: s.barrow.m3 >= BARROW_M3 - 1e-6, s: mat, turf: !q || q[1] === UNTOUCHED };
}
// Tip the whole load out round (x, z): it spreads over about a metre, then runs down to its angle of repose.
function tip(ctx, p = {}) {
  const s = ensure(ctx);
  if (!(s.barrow.m3 > 1e-6)) return fail('The barrow is empty.');
  if (!finite(p)) return fail('Where?');
  const [cx, cz] = at(p), spots = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) spots.push([cx + dx, cz + dz, dx === 0 && dz === 0 ? 3 : dx && dz ? 0.5 : 1]);
  const wsum = spots.reduce((a, b) => a + b[2], 0), m3 = s.barrow.m3, surf = s.barrow.s, layer = !!(SURFACES[surf] && SURFACES[surf].layer);
  for (const [gx, gz, w] of spots) fill(s.grid, gx, gz, (m3 * w) / wsum, { surface: surf, layer, t: ctx.lifeT ?? ctx.t, spread: false });
  for (const [gx, gz] of spots) slump(s.grid, gx, gz);
  reseat(s);
  s.barrow = { m3: 0, s: '' };
  s.totals.filledM3 = r4(s.totals.filledM3 + m3);
  ctx.emit('landscape.tip', { m3, s: surf });
  return { ok: true, m3, s: surf };
}
const matName = (id) => (id === 'soil' ? 'earth' : SURFACES[id] ? SURFACES[id].name.toLowerCase() : id);

// ---------------------------------------------------------------------------------------- water: plants and ponds
// Pour water at (x, z): plants within reach of the rose share it, and a pond there takes it. From the garden's can
// unless p.carriedL says how much was carried (the can is the garden's: src/sim/garden.js, state.can.litres).
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
  const x = +p.x, z = +p.z, near = Object.values(s.plants).filter((pl) => Math.hypot(pl.x - x, pl.z - z) < 0.6);
  const [gx, gz] = at(p), pd = pondAt(s, gx, gz);
  if (!near.length && !pd) return fail('Nothing here to water.');
  if (p.carriedL == null) g.can.litres = r3(g.can.litres - litres);
  if (pd) s.ponds[pd.root] = r4(Math.min(pd.cap, (s.ponds[pd.root] || 0) + litres / 1000));
  else for (const pl of near) pl.w = r3(Math.min(1, (pl.w ?? 0.5) + litres / near.length / ESTABLISH.litresFull));
  ctx.emit('landscape.water', { litres, plants: near.length, pond: !!pd });
  return { ok: true, litres, plants: pd ? 0 : near.length, pond: pd ? pd.root : null };
}
// Lay pond liner over the dug squares in a round brush, or (p.whole) over the whole dug hole under the hand in one
// sheet (it goes under any gravel or stone laid after). Only ground that has been dug takes it.
function line(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  const r = Math.min(0.7, +p.r || 0.4), x = +p.x, z = +p.z, cells = [];
  const dug = (gx, gz) => { const q = square(s.grid, gx, gz); return isLoose(q) && q[0] <= -0.03 && !plantOn(s, gx, gz); };
  if (p.whole) {
    // one sheet over the whole hole: every dug square joined to the one under the hand
    const [sx, sz] = at(p), seen = new Set([keyOf(sx, sz)]), stack = dug(sx, sz) ? [[sx, sz]] : [];
    while (stack.length && cells.length < 400) {
      const [gx, gz] = stack.pop();
      if (!s.liner[keyOf(gx, gz)]) cells.push([gx, gz]);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = keyOf(gx + dx, gz + dz); if (!seen.has(k) && dug(gx + dx, gz + dz)) { seen.add(k); stack.push([gx + dx, gz + dz]); } }
    }
  } else for (let gz = cellOf(s.grid, z - r); gz <= cellOf(s.grid, z + r); gz++) for (let gx = cellOf(s.grid, x - r); gx <= cellOf(s.grid, x + r); gx++) {
    if (Math.hypot((gx + 0.5) * CELL - x, (gz + 0.5) * CELL - z) > r) continue;
    if (!dug(gx, gz) || s.liner[keyOf(gx, gz)]) continue;
    cells.push([gx, gz]);
  }
  if (!cells.length) return fail('Dig the pond out first: the liner goes over a dug hole, up its sides.');
  const m2 = spend(ctx, 'pond_liner', cells.length * AREA * 1.3);   // it runs up the sides and folds: about a third more than the floor
  if (!(m2 > 0)) return fail('You have no pond liner. Buy some in the yard store.');
  const n = Math.min(cells.length, Math.floor(m2 / (AREA * 1.3) + 1e-6)) || 1;
  for (let i = 0; i < n; i++) s.liner[keyOf(cells[i][0], cells[i][1])] = 1;
  s.grid.rev++;
  settlePonds(s);
  ctx.emit('landscape.line', { cells: n });
  return { ok: true, cells: n };
}
// cutting into a lined square takes its liner out (back to stock) and lets the pond's water out with it
function unline(ctx, s, gx, gz) {
  const k = keyOf(gx, gz);
  if (!s.liner[k]) return false;
  const before = pondAt(s, gx, gz);
  delete s.liner[k];
  if (before) delete s.ponds[before.root];   // cut the liner and the water runs out into the ground
  pondCache.delete(s);
  settlePonds(s);
  giveBack(ctx, 'pond_liner', AREA * 1.3);
  return true;
}
// Turn a hose on or off into the pond at (x, z). It shuts itself off when the pond is full.
function hose(ctx, p = {}) {
  const s = ensure(ctx);
  if (stockOf(ctx) && !hasTool(ctx, 'garden_hose')) return fail('You need a garden hose.');
  const [gx, gz] = at(p), pd = pondAt(s, gx, gz);
  if (!pd) return fail('Point the hose into a lined pond.');
  const on = p.on != null ? !!p.on : !s.hose[pd.root];
  if (on && pd.cap < 0.002) return fail('The water would run straight out: part of the hole round the liner is lower than its edge. Line the whole hole, up its sides.');
  if (on && (s.ponds[pd.root] || 0) >= pd.cap - 1e-4) return fail('The pond is full.');
  if (on) s.hose[pd.root] = 1; else delete s.hose[pd.root];
  ctx.emit('landscape.hose', { on, pond: pd.root });
  return { ok: true, on, pond: pd.root };
}

// Ponds: the lined squares that touch (4-neighbour) make one pond. Its water finds a level: it fills the lowest
// squares first, up to the lowest point of its rim (the unlined ground round it); more than that overflows.
const pondCache = new WeakMap();   // state -> { rev, list, byKey }
function ponds(s) {
  let c = pondCache.get(s);
  if (c && c.rev === s.grid.rev) return c;
  const seen = new Set(), list = [], byKey = new Map();
  for (const k in s.liner) {
    if (seen.has(k)) continue;
    const cells = [], stack = [k];
    seen.add(k);
    while (stack.length) {
      const cur = stack.pop(), i = cur.indexOf(','), gx = +cur.slice(0, i), gz = +cur.slice(i + 1);
      cells.push([gx, gz]);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nk = keyOf(gx + dx, gz + dz); if (s.liner[nk] && !seen.has(nk)) { seen.add(nk); stack.push(nk); } }
    }
    // the rim: the lowest of the unlined squares round it; the water cannot rise above it
    let rim = Infinity;
    for (const [gx, gz] of cells) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!s.liner[keyOf(gx + dx, gz + dz)]) rim = Math.min(rim, heightOf(s.grid, gx + dx, gz + dz));
    const hs = cells.map(([gx, gz]) => heightOf(s.grid, gx, gz));
    const vol = (L) => { let v = 0; for (const h of hs) if (L > h) v += (L - h) * AREA; return v; };
    const root = cells.map(([gx, gz]) => keyOf(gx, gz)).sort()[0];
    const pd = { root, cells, rim, hs, cap: r4(Math.max(0, vol(rim))), vol };
    pd.level = (m3) => {
      if (!(m3 > 0)) return -Infinity;
      let lo = Math.min(...hs), hi = rim;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (vol(mid) < m3) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    };
    pd.depth = (gx, gz) => { const L = pd.level(s.ponds[root] || 0); return Math.max(0, L - heightOf(s.grid, gx, gz)); };
    list.push(pd);
    for (const [gx, gz] of cells) byKey.set(keyOf(gx, gz), pd);
  }
  c = { rev: s.grid.rev, list, byKey };
  pondCache.set(s, c);
  return c;
}
// After the ponds' shape changes: water from a pond that no longer exists under its name goes to the pond that now
// holds that square, and no pond holds more than its rim allows. Only commands and the step call this.
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
function pondAt(s, gx, gz) { return ponds(s).byKey.get(keyOf(gx, gz)) || null; }

// ---------------------------------------------------------------------------------------- generic soil moves
// Draw soil from one square onto another (hilling: soil pulled up round a plant from the path beside it).
function move(ctx, p = {}) {
  const s = ensure(ctx);
  if (!Array.isArray(p.from) || !Array.isArray(p.to)) return fail('From where to where?');
  const m3 = Math.min(0.01, Math.max(0, +p.m3 || 0));
  const got = moveSoil(s.grid, p.from, p.to, m3, ctx.lifeT ?? ctx.t);
  if (got > 0) reseat(s);
  return { ok: got > 0, m3: got, h: heightOf(s.grid, p.to[0], p.to[1]) };
}
function setScale(ctx, p = {}) {
  const s = ensure(ctx), v = +p.scale;
  if (!SCOOP_SCALES.includes(v)) return fail('Earth per scoop is 1, 2 or 4 shovelfuls.');
  s.scale = v;
  return { ok: true, scale: v };
}

// ---------------------------------------------------------------------------------------- the slow part
// Hourly: sown lawns knit back into turf once they have had a few weeks of growing weather (soil above 5 C); nursery
// plants drink and dry, root out and grow; ponds fill from rain and the hose and lose to the sun.
const STEP_TICKS = 60;
const sownCache = new WeakMap();   // grid -> { rev, n }: how many squares are sown lawn (not state: rebuilt as needed)
function step(ctx) {
  const s = ctx.s;
  if (!s || s.v !== STATE_V) { ctx.s = fresh(); return; }
  upgrade(s);
  const g = s.grid, w = ctx.get('weather');
  const tempC = w ? w.tempC ?? 10 : 15, warm = tempC > 5;
  const now = ctx.lifeT ?? ctx.t, dt = ctx.dt, lifeDt = ctx.lifeDt ?? ctx.dt;
  // rain since the last step, mm
  const total = w && w.totals ? (w.totals.precipMm || 0) + (w.totals.meltMm || 0) : 0;
  const rainMm = s.rain == null ? 0 : Math.max(0, total - s.rain);
  s.rain = r3(total);

  let c = sownCache.get(g);
  if (!c || c.rev !== g.rev) {
    let n = 0; for (const k in g.sq) if (g.sq[k][1] === 'lawn_sown') n++;
    sownCache.set(g, (c = { rev: g.rev, n }));
  }
  if (c.n) for (const k in g.sq) {
    const q = g.sq[k];
    if (q[1] !== 'lawn_sown') continue;
    if (!warm) { q[3] += lifeDt; continue; }               // cold hours do not count toward the cover
    if (now - q[3] >= LAWN.coverDays * DAY) {
      const [gx, gz] = k.split(',').map(Number);
      setSurface(g, gx, gz, UNTOUCHED, now);
      ctx.emit('landscape.lawn', { gx, gz });
    }
  }

  // nursery plants: the root zone gains the rain and loses to the air; rooted-in plants reach deeper, so they only
  // dry out in a drought. Growth and rooting run on the seasonal clock, and only while the plant has water.
  const etMm = Math.max(0.5, 0.25 * tempC) * (dt / DAY);
  for (const id in s.plants) {
    const p = s.plants[id], pk = PLANTS[p.k];
    if (p.w == null) { p.w = 0.6; p.g = Math.max(0, (now - p.t) / (365 * DAY)); p.est = ESTABLISH.days; }   // older saves: already settled in
    if (pk.wet) { p.w = 1; }
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
      const area = pd.cells.length * AREA;
      v += (rainMm / 1000) * area;
      if (v > 0) v -= (evap / 1000) * Math.min(area, v / 0.01);
      if (s.hose[pd.root]) {
        v += (POND.hoseLpm * dt) / 60 / 1000;
        if (v >= pd.cap - 1e-4) { delete s.hose[pd.root]; ctx.emit('landscape.pondFull', { pond: pd.root }); }
      }
      v = Math.max(0, Math.min(pd.cap, v));
      if (v > 0) s.ponds[pd.root] = r4(v); else delete s.ponds[pd.root];
    }
  }
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const landscape = {
  name: 'landscape',
  every: STEP_TICKS,
  init: () => fresh(),
  step,
  commands: {
    'landscape.dig': dig, 'landscape.dump': dump, 'landscape.skim': skim, 'landscape.rake': rake, 'landscape.spread': spread, 'landscape.seedLawn': seedLawn,
    'landscape.place': place, 'landscape.take': take, 'landscape.plant': plant, 'landscape.lift': lift, 'landscape.move': move, 'landscape.setScale': setScale,
    'landscape.load': load, 'landscape.tip': tip, 'landscape.water': water, 'landscape.line': line, 'landscape.hose': hose,
  },
};

// ---------------------------------------------------------------------------------------- read-outs
const stateOf = (state) => (state && state.sys ? state.sys.landscape : state);
// Height of the shaped ground above the untouched ground at a world point, metres (0 where nothing was done).
export function reliefAt(state, x, z) { const s = stateOf(state); return s && s.grid ? gridRelief(s.grid, x, z) : 0; }
export function squareAt(state, gx, gz) { const s = stateOf(state); return s && s.grid ? square(s.grid, gx, gz) : null; }
// How big a nursery plant is now: height and spread in metres, and 0..1 of the way to mature.
export function plantSize(state, id, lifeT) {
  const s = stateOf(state), p = s && s.plants[id];
  if (!p) return null;
  const pk = PLANTS[p.k], years = p.g != null ? p.g : Math.max(0, (lifeT - p.t) / (365 * DAY));
  const k = 1 - Math.exp(-years / (pk.years / 2.3));     // about nine-tenths grown at its named number of years
  const wilt = p.w != null && p.w < ESTABLISH.wiltAt;
  return { h: (pk.buy[0] + (pk.mature[0] - pk.buy[0]) * k) * (wilt ? 0.88 : 1), w: pk.buy[1] + (pk.mature[1] - pk.buy[1]) * k, k, wilt, thirsty: p.w != null && p.w < ESTABLISH.growAt, rooted: (p.est ?? ESTABLISH.days) >= ESTABLISH.days };
}
// The ponds: each with its squares, rim, capacity, water and level (m above the untouched ground), and whether a
// hose is running into it.
export function pondsOf(state) {
  const s = stateOf(state);
  if (!s || !s.liner) return [];
  return ponds(s).list.map((pd) => ({ root: pd.root, cells: pd.cells, rim: pd.rim, cap: pd.cap, m3: s.ponds[pd.root] || 0, level: pd.level(s.ponds[pd.root] || 0), hose: !!s.hose[pd.root] }));
}
export const landscapeRead = { reliefAt, squareAt, plantSize, pondsOf, keyOf, SURFACES, THINGS, PLANTS, SCOOP_M3, SCOOP_SCALES, LAWN, BARROW_M3, ESTABLISH };
