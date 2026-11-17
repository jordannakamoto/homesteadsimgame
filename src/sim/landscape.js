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
//     plants: { [id]: { k, x, z, yaw, t } }                t: when planted, on the seasonal clock (lifeT)
//     nextId, totals: { dugM3, filledM3, turfM3, laidM3 } }
// Commands: landscape.dig, .dump, .skim, .rake, .spread, .seedLawn, .place, .take, .plant, .lift, .move, .setScale.

import { makeGrid, keyOf, cellOf, square, heightOf, isLoose, cut, fill, relax, move as moveSoil, setSurface, reliefAt as gridRelief, UNTOUCHED } from './core/earthwork.js';
import { SCOOP_M3, SCOOP_SCALES, LAWN, SURFACES, THINGS, PLANTS } from './content/landscape.js';
import { ITEMS } from './items.js';
import { DAY } from './time.js';

const STATE_V = 1, CELL = 0.3, AREA = CELL * CELL;
const MAX_THINGS = 4000, MAX_PLANTS = 600;
const r3 = (v) => Math.round(v * 1000) / 1000, r4 = (v) => Math.round(v * 1e4) / 1e4;
const fail = (reason, extra) => ({ ok: false, reason, ...extra });

function fresh() {
  return { v: STATE_V, grid: makeGrid(CELL), carry: { m3: 0, s: '' }, scale: 2, things: {}, plants: {}, nextId: 1, totals: { dugM3: 0, filledM3: 0, turfM3: 0, laidM3: 0 } };
}
function ensure(ctx) { if (!ctx.s || ctx.s.v !== STATE_V) ctx.s = fresh(); return ctx.s; }

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
  const o = thingOn(s, gx, gz);
  if (o) return fail('Move the ' + THINGS[o.k].name.toLowerCase() + ' first.');
  const pl = plantOn(s, gx, gz);
  if (pl) return fail('The ' + PLANTS[pl.k].name.toLowerCase() + ' is planted there. Lift it with your hands first.');
  const q = square(s.grid, gx, gz), want = SCOOP_M3 * (p.scale || s.scale || 1);
  const layerM3 = q && q[2] > 0 ? q[2] * AREA : 0;
  const res = cut(s.grid, gx, gz, layerM3 > 0 ? Math.min(want, layerM3 + 1e-9) : want, { t: ctx.lifeT ?? ctx.t, maxDepth: 1.2 });
  if (!(res.m3 > 1e-6)) return fail('That is as deep as a shovel will go here.');
  const wasTurf = !q || q[1] === UNTOUCHED;
  s.carry = { m3: res.m3, s: res.layer ? res.layer.s : 'soil' };
  s.totals.dugM3 = r4(s.totals.dugM3 + res.m3);
  ctx.emit('landscape.dig', { gx, gz, m3: res.m3, s: s.carry.s, turf: wasTurf });
  return { ok: true, m3: res.m3, s: s.carry.s, turf: wasTurf, depthM: r3(-heightOf(s.grid, gx, gz)), h: heightOf(s.grid, gx, gz) };
}
// Toss the load on the shovel onto the square under (x, z). Soil heaps and runs down at its angle of repose.
function dump(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  if (!(s.carry.m3 > 1e-6)) return fail('The shovel is empty.');
  const [gx, gz] = at(p);
  const o = thingOn(s, gx, gz);
  if (o && !p.force) return fail('The ' + THINGS[o.k].name.toLowerCase() + ' is in the way.');
  const m3 = s.carry.m3, surf = s.carry.s, layer = !!(SURFACES[surf] && SURFACES[surf].layer);
  fill(s.grid, gx, gz, m3, { surface: surf, layer, t: ctx.lifeT ?? ctx.t });
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
  if (n) ctx.emit('landscape.skim', { cells: n });
  return { ok: true, cells: n };
}

// ---------------------------------------------------------------------------------------- the rake
function rake(ctx, p = {}) {
  const s = ensure(ctx);
  if (!finite(p)) return fail('Where?');
  if (stockOf(ctx) && !hasTool(ctx, 'rake')) return fail('You need a rake.');
  const moved = relax(s.grid, +p.x, +p.z, Math.min(0.6, +p.r || 0.35), Math.min(1, +p.k || 0.5), ctx.lifeT ?? ctx.t);
  if (moved > 0) ctx.emit('landscape.rake', { m3: moved });
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
  const id = 'p' + s.nextId++;
  s.plants[id] = { id, k: pk.id, x: r3((gx + 0.5) * CELL), z: r3((gz + 0.5) * CELL), yaw: r3(ctx.rng ? ctx.rng('yaw').float() * Math.PI * 2 : 0), t: ctx.lifeT ?? ctx.t };
  ctx.emit('landscape.plant', { id, kind: pk.id });
  return { ok: true, id, kind: pk.id };
}
function lift(ctx, p = {}) {
  const s = ensure(ctx), pl = s.plants[p.id];
  if (!pl) return fail('Nothing planted there.');
  delete s.plants[p.id];
  giveBack(ctx, PLANTS[pl.k].item, 1);
  const [gx, gz] = at(pl);
  cut(s.grid, gx, gz, PLANTS[pl.k].holeM * AREA * 0.5, { t: ctx.lifeT ?? ctx.t });   // the root ball leaves a hollow
  ctx.emit('landscape.lift', { id: p.id, kind: pl.k });
  return { ok: true, kind: pl.k };
}

// ---------------------------------------------------------------------------------------- generic soil moves
// Draw soil from one square onto another (hilling: soil pulled up round a plant from the path beside it).
function move(ctx, p = {}) {
  const s = ensure(ctx);
  if (!Array.isArray(p.from) || !Array.isArray(p.to)) return fail('From where to where?');
  const m3 = Math.min(0.01, Math.max(0, +p.m3 || 0));
  const got = moveSoil(s.grid, p.from, p.to, m3, ctx.lifeT ?? ctx.t);
  return { ok: got > 0, m3: got, h: heightOf(s.grid, p.to[0], p.to[1]) };
}
function setScale(ctx, p = {}) {
  const s = ensure(ctx), v = +p.scale;
  if (!SCOOP_SCALES.includes(v)) return fail('Earth per scoop is 1, 2 or 4 shovelfuls.');
  s.scale = v;
  return { ok: true, scale: v };
}

// ---------------------------------------------------------------------------------------- the slow part
// Hourly: sown lawns knit back into turf once they have had a few weeks of growing weather (soil above 5 C).
const STEP_TICKS = 60;
const sownCache = new WeakMap();   // grid -> { rev, n }: how many squares are sown lawn (not state: rebuilt as needed)
function step(ctx) {
  const s = ctx.s;
  if (!s || s.v !== STATE_V) { ctx.s = fresh(); return; }
  const g = s.grid;
  let c = sownCache.get(g);
  if (!c || c.rev !== g.rev) {
    let n = 0; for (const k in g.sq) if (g.sq[k][1] === 'lawn_sown') n++;
    sownCache.set(g, (c = { rev: g.rev, n }));
  }
  if (!c.n) return;
  const w = ctx.get('weather'), warm = !w || (w.tempC ?? 10) > 5;
  const now = ctx.lifeT ?? ctx.t, dt = ctx.lifeDt ?? ctx.dt;
  for (const k in g.sq) {
    const q = g.sq[k];
    if (q[1] !== 'lawn_sown') continue;
    if (!warm) { q[3] += dt; continue; }               // cold hours do not count toward the cover
    if (now - q[3] >= LAWN.coverDays * DAY) {
      const [gx, gz] = k.split(',').map(Number);
      setSurface(g, gx, gz, UNTOUCHED, now);
      ctx.emit('landscape.lawn', { gx, gz });
    }
  }
}

export const landscape = {
  name: 'landscape',
  every: STEP_TICKS,
  init: () => fresh(),
  step,
  commands: {
    'landscape.dig': dig, 'landscape.dump': dump, 'landscape.skim': skim, 'landscape.rake': rake, 'landscape.spread': spread, 'landscape.seedLawn': seedLawn,
    'landscape.place': place, 'landscape.take': take, 'landscape.plant': plant, 'landscape.lift': lift, 'landscape.move': move, 'landscape.setScale': setScale,
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
  const pk = PLANTS[p.k], years = Math.max(0, (lifeT - p.t) / (365 * DAY));
  const k = 1 - Math.exp(-years / (pk.years / 2.3));     // about nine-tenths grown at its named number of years
  return { h: pk.buy[0] + (pk.mature[0] - pk.buy[0]) * k, w: pk.buy[1] + (pk.mature[1] - pk.buy[1]) * k, k };
}
export const landscapeRead = { reliefAt, squareAt, plantSize, keyOf, SURFACES, THINGS, PLANTS, SCOOP_M3, SCOOP_SCALES, LAWN };
