// The garden: beds of 30 cm cells, the soil and water in them, and the plants they grow.
//
// The mechanisms are generic (src/sim/core/): cellfield (beds as groups of cells, brush selections),
// soilwater (an FAO-56 bucket per cell) and growth (thermal-time development, light-driven growth with
// limits). The content is in src/sim/content/: crops.js, soils.js and garden-items.js. This file ties them
// to the weather and stock systems and turns the numbers into plain words for the player.
//
// Cadence: soil water every hour (every 60 ticks); growth, nutrients and weeds every three hours. With no
// beds the step returns at once.
//
// Two clocks. A world's year can be shorter than a real one (ctx.lifeScale = 365 / days in the year). Everything
// that belongs to a plant's life runs on the seasonal clock (ctx.lifeDt): degree days, germination, growth from
// sunlight, ripening, nutrient release, lime, weeds and mulch. The soil-water balance stays on real time (ctx.dt):
// rain is a real day's rain and a can is a can, so evaporation, drainage and the plants' drinking are a real day's
// physics. Scaling transpiration alone would empty the bucket lifeScale times too fast; scaling everything would
// make a can of water worth weeks. So a compressed crop simply lives through fewer days of weather, and water
// stress is judged from the bucket as before. Calendar functions get ctx.ct (date from the seasonal clock).
//
// Evapotranspiration: Priestley-Taylor reference rate (soilwater.priestleyTaylorMm) from the weather's
// temperature, sunshine, cloud and humidity, times the FAO-56 dual crop coefficient.
//
// State, at sim.state.sys.garden (plain JSON):
//   { v, field: { cellM, groups: { [bedId]: bed }, nextId }, plants: { [plantId]: plant }, nextPlant,
//     can: { litres }, packets: { [cropId]: seeds left in the open packet }, acc: { n, temps, minC, rsMJ },
//     soilC (seed-zone temperature), last: weather running totals, pending: [water draws], totals, coverOn }
//   bed:   { id, x0, z0, nx, nz, cells, soil, shade, cover, madeT }
//   cell:  { w, d, de (water, mm), n, p, k (plant-available N, P, K, g/m2), sn (soil organic N), on (added
//            organic N), onk (its release rate per year), ph, lime (unreacted g/m2), weed (cover 0..1),
//            wN (N in the weeds, g/m2), mulch (straw left, L/m2), pl (plant id or null), hist: [crop ids] }
//   plant: growth.newPlant fields plus { id, crop, bed, cell, span, count, area, nUp, pUp, kUp, ks, dryH,
//            readyT, status, reason, wilt, yellow, expectT }
// Totals: water in litres { rainL, irrigL, evapL, transpL, drainL, runoffL }, nitrogen in grams { nInit,
// nIn, nFixed, nLeached, nRemoved, nExported }, produce in kg { harvestKg: { [cropId]: kg } }.

import { makeField, addGroup, removeGroup, resolve, block, cellCentre, cellAt, groupArea } from './core/cellfield.js';
import { bucket, priestleyTaylorMm, stepCell, infiltrate, topFraction, stressOf, TOP_M } from './core/soilwater.js';
import { advance, newPlant, interception, stageIndex, thermalRate, EV_EMERGED, EV_STAGE, EV_FROST, EV_KILLED, EV_BOLTED } from './core/growth.js';
import { CROPS, CROP_IDS } from './content/crops.js';
import { SOILS, DEFAULT_SOIL, AMENDMENTS, MULCH } from './content/soils.js';
import { ITEMS } from './items.js';
import { DAY, HOUR, calendarT } from './time.js';
import { sunTimes, dayOfYear, MONTHS, MONTH_START, DAYS_IN_YEAR, START_DAY_OF_YEAR, monthOf, dayOfMonth } from './calendar.js';
import { climateModel, CLIMATES, DEFAULT_CLIMATE } from './weather.js';

export const CELL_M = 0.3, CELL_AREA = CELL_M * CELL_M;
const STATE_V = 1;
const SOIL_EVERY = 60, GROWTH_EVERY = 180;
const CAN_L = 9;                          // a 9 L watering can (2.4 US gal), a common size
const COVER_FROST_C = 2;                  // a lightweight row cover keeps plants about 2 C warmer on a radiation frost
const COVER_LIGHT = 0.85;                 // and lets through about 85% of the light (manufacturers' figures)
const N_IN_OM = 0.05, N_IN_ADDED_OM = 0.03;
const NATIVE_RATE = 0.045;                // share of soil organic N mineralised per year at a steady 20 C; about 2% a year
                                          // in a temperate soil's real temperatures (approx: 1 to 3% a year is typical)
const RESIDUE_RATE = 0.8;                 // fresh crop residue: most of its N is released within a year (approx)
const WEED_N_FULL = 8;                    // g N per m2 in a full weed cover (about 300 g DM at 2.7% N, approx)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// Critical nitrogen: young plants are rich in nitrogen and the concentration falls as they grow (the N dilution
// curve, Lemaire and Gastal 1997: %N proportional to W^-0.37). Scaled so a full-grown crop holds its total uptake.
const nCrit = (crop, bio) => crop.nConc * bio * Math.min(2.5, Math.pow(Math.max(bio, 1) / crop.bioRef, -0.37));
const r3 = (v) => Math.round(v * 1000) / 1000;
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const words = (n) => (n < NUM.length ? NUM[n] : String(n));
const days = (n) => (n === 1 ? 'a day' : words(n) + ' days');
const lifeOf = (state) => (state && state.yearDays ? 365 / state.yearDays : 1);

// ---------------------------------------------------------------------------------------- state
function fresh() {
  return {
    v: STATE_V, field: makeField(CELL_M), plants: {}, nextPlant: 1, can: { litres: 0 }, packets: {},
    acc: { n: 0, temps: [0, 0, 0, 0, 0, 0], minC: 99, rsMJ: 0 }, soilC: null, last: null, pending: [], carryKg: {},
    totals: { rainL: 0, irrigL: 0, evapL: 0, transpL: 0, drainL: 0, runoffL: 0, nInit: 0, nIn: 0, nFixed: 0, nLeached: 0, nRemoved: 0, nExported: 0, harvestKg: {} },
  };
}
const soilMassKgM2 = (soil) => soil.bulkGcm3 * TOP_M * 1000;
function newCell(soil) {
  const b = bucket(soil), sn = (soil.omPct / 100) * soilMassKgM2(soil) * 1000 * N_IN_OM;
  return {
    w: r3(b.wp1 + 0.7 * (b.fc1 - b.wp1)), d: r3(b.wp2 + 0.8 * (b.fc2 - b.wp2)), de: 0,
    n: soil.nMinG, p: soil.pG, k: soil.kG, sn, on: 0, onk: RESIDUE_RATE, ph: soil.ph, lime: 0,
    weed: 0.01, wN: 0, mulch: 0, pl: null, hist: [],
  };
}
export const cellN = (c) => c.n + c.sn + c.on + c.wN;                // g N per m2 held in a cell (not counting plants)
export const omPct = (c, soil) => ((c.sn / N_IN_OM + c.on / N_IN_ADDED_OM) / (soilMassKgM2(soil) * 1000)) * 100;

// Read-only helpers for other systems, tests and the view.
export const bedsOf = (g) => Object.values(g.field.groups);
export const soilOf = (bed) => SOILS[bed.soil] || SOILS[DEFAULT_SOIL];
export function nitrogenTotal(g) {
  let s = 0;
  for (const bed of bedsOf(g)) for (const c of bed.cells) s += cellN(c) * CELL_AREA;
  for (const p of Object.values(g.plants)) s += p.nUp * p.area;
  return s;
}
export function storedWaterL(g) {
  let s = 0;
  for (const bed of bedsOf(g)) for (const c of bed.cells) s += (c.w + c.d) * CELL_AREA;
  return s;
}

// ---------------------------------------------------------------------------------------- calling other systems
// Run another system's command handler directly (not recorded again: the garden command that caused it is the
// recorded one, so a replay does the same thing exactly once).
function call(ctx, name, payload) {
  const sim = ctx.sim, h = sim && sim.handlers.get(name);
  if (!h) return undefined;
  const st = sim.state;
  return h.fn({
    sim, state: st, t: st.t, tick: st.tick, dt: 0,
    get s() { return st.sys[h.sys.name]; }, set s(v) { st.sys[h.sys.name] = v; },
    get: (n) => st.sys[n], rng: (n) => sim.rng(h.sys.name + (n ? ':' + n : '')), emit: ctx.emit,
  }, payload);
}
const stockOf = (ctx) => ctx.get('stock');
const hasTool = (ctx, id) => { const s = stockOf(ctx); return !s || s.tools.includes(id); };

// ---------------------------------------------------------------------------------------- the plants' geometry
const spanOf = (crop) => (crop.spacingM > CELL_M + 1e-9 ? Math.round(crop.spacingM / CELL_M) : 1);
function cellsOfPlant(g, p) {
  const bed = g.field.groups[p.bed];
  if (!bed) return [];
  return block(bed, p.cell % bed.nx, Math.floor(p.cell / bed.nx), p.span) || [p.cell];
}
// Crop coefficient and rooting at the plant's stage (FAO-56: Kcb rises with ground cover to its mid value and
// falls to its end value as the crop matures; roots deepen until flowering).
function plantWater(p, crop) {
  if (!p.emerged || p.dead) return { kcb: 0, cover: 0, root: 0 };
  const x = p.gdd / crop.readyGdd, cover = interception(p.lai, crop.k);
  let kcb = crop.kcb[0] + (crop.kcb[1] - crop.kcb[0]) * clamp(cover / 0.7, 0, 1);
  const past = crop.stages[crop.stages.length - 1].gdd / crop.readyGdd;
  if (x > 1 && crop.harvest === 'once') kcb += (crop.kcb[2] - kcb) * clamp((x - 1) / Math.max(0.05, past - 1), 0, 1);
  const depth = 0.1 + (crop.rootDepthM - 0.1) * clamp(x / 0.6, 0, 1);
  return { kcb, cover, root: clamp((depth - TOP_M) / 0.7, 0, 1) };
}

// ---------------------------------------------------------------------------------------- the soil step (hourly)
const _out = { evap: 0, transp: 0, drain: 0, ks: 1 };
function soilStep(ctx, s) {
  const w = ctx.get('weather') || {};
  const hours = SOIL_EVERY / 60;
  const tC = w.tempC ?? 10, cloud = w.cloud ?? 0.5, wind = w.windMs ?? 2;
  const ghi = (w.solar && w.solar.globalHorizontalWm2) || 0;
  const rsMJ = ghi * 3600 * hours * 1e-6;
  // the weather's running totals give exactly the rain and snowmelt that reached the ground since the last step
  let inMm;
  if (w.totals) {
    const cur = { rain: w.totals.precipMm - w.totals.snowfallMm, melt: w.totals.meltMm };
    inMm = s.last ? Math.max(0, cur.rain - s.last.rain) + Math.max(0, cur.melt - s.last.melt) : 0;
    s.last = cur;
  } else inMm = ((w.rainMmH || 0)) * hours;
  const td = w.dewPointC ?? tC - 5, ea = 0.6108 * Math.exp((17.27 * td) / (td + 237.3));
  const rel = 1 - 0.75 * Math.pow(cloud, 3.4);
  const et0 = priestleyTaylorMm(tC, rsMJ, rel, ea, hours);
  // seed-zone soil temperature: follows the air with about a day's lag
  if (s.soilC == null) s.soilC = w.groundTempC != null ? (w.groundTempC + tC) / 2 : tC;
  s.soilC += (tC - s.soilC) * (1 - Math.exp(-hours / 24));
  const frozen = s.soilC < -0.5;
  // the coldest a plant felt: on a clear, still night leaves radiate below the air temperature
  const calm = clamp(1 - wind / 4, 0, 1), plantC = ghi > 0 ? tC : tC - 2 * (1 - cloud) * calm;
  const A = s.acc;
  if (A.n < A.temps.length) A.temps[A.n++] = tC;
  A.minC = Math.min(A.minC, plantC); A.rsMJ += rsMJ;
  const T = s.totals;
  for (const bed of Object.values(s.field.groups)) {
    const soil = soilOf(bed), b = bucket(soil), cells = bed.cells;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      let kcb = 0, cover = 0, root = 0, pp = 0.5, p = null;
      if (c.pl) { p = s.plants[c.pl]; if (p) { const pw = p._w; kcb = pw.kcb; cover = pw.cover; root = pw.root; pp = CROPS[p.crop].comfortP; } }
      if (inMm > 0) T.runoffL += infiltrate(c, b, inMm) * CELL_AREA;
      const weedKc = 0.9 * c.weed * (1 - 0.5 * cover);
      const o = stepCell(c, b, { et0, kcb, cover, mulch: Math.min(1, c.mulch / MULCH.fullCoverLPerM2), mulchCut: MULCH.evapCut, rootFrac: root, p: pp, weedKc, frozen }, hours, _out);
      T.evapL += o.evap * CELL_AREA; T.transpL += o.transp * CELL_AREA; T.drainL += o.drain * CELL_AREA;
      // nitrate leaves with the water draining out of the root zone
      if (o.drain > 0 && c.n > 0) {
        const lost = c.n * Math.min(1, (0.6 * o.drain) / (c.w + c.d + o.drain));
        c.n -= lost; T.nLeached += lost * CELL_AREA;
      }
      if (p) { p._ks += o.ks; p._ksN++; }
    }
    T.rainL += inMm * cells.length * CELL_AREA;
  }
  // water drawn from tanks and taps arrives as the water system supplies it
  if (s.pending.length) {
    const ws = ctx.get('water');
    for (let i = s.pending.length - 1; i >= 0; i--) {
      const pd = s.pending[i], r = ws && ws.results && ws.results[pd.id];
      if (!r) { s.pending.splice(i, 1); continue; }
      const more = r.suppliedL - pd.appliedL;
      if (more > 1e-9) { applyWater(s, pd.cells, more); pd.appliedL = r.suppliedL; }
      if (r.done) s.pending.splice(i, 1);
    }
  }
}
// litres spread evenly over [bedId, index] pairs
function applyWater(s, list, litres) {
  if (!list.length || !(litres > 0)) return 0;
  const mm = litres / (list.length * CELL_AREA);
  for (const [bid, i] of list) {
    const bed = s.field.groups[bid]; if (!bed) continue;
    s.totals.runoffL += infiltrate(bed.cells[i], bucket(soilOf(bed)), mm) * CELL_AREA;
  }
  s.totals.irrigL += litres;
  return litres;
}

// ---------------------------------------------------------------------------------------- the growth step (3-hourly)
const _ev = { flags: 0 };
const _env = { days: 0, temps: null, n: 0, soilC: 0, topWet: 0, minC: 0, rsMJ: 0, dayH: 12, water: 1, nutrient: 1, light: 1, competition: 1 };
function growthStep(ctx, s) {
  const w = ctx.get('weather') || {}, site = w.site || { latitudeDeg: 45 };
  const life = ctx.lifeScale ?? 1, ct = ctx.ct ?? ctx.t;
  const A = s.acc, dt = (GROWTH_EVERY * 60 / DAY) * life;   // dt: days of the plants' life
  if (!A.n) { A.temps[0] = w.tempC ?? 10; A.n = 1; }
  const dayH = sunTimes(ct, site).dayLengthH;
  const minC = A.minC < 98 ? A.minC : (w.tempC ?? 10);
  const E = _env;
  E.days = dt; E.temps = A.temps; E.n = A.n; E.soilC = s.soilC ?? 10; E.dayH = dayH;
  const T = s.totals;
  for (const id in s.plants) {
    const p = s.plants[id], crop = CROPS[p.crop], bed = s.field.groups[p.bed];
    if (!bed) continue;
    const soil = soilOf(bed), b = bucket(soil), list = cellsOfPlant(s, p);
    let top = 0, weed = 0, n = 0, pp = 0, kk = 0, ph = 0;
    for (const i of list) { const c = bed.cells[i]; top += topFraction(c, b); weed += c.weed; n += c.n; pp += c.p; kk += c.k; ph += c.ph; }
    const m = list.length; top /= m; weed /= m; n /= m; pp /= m; kk /= m; ph /= m;
    const ks = p._ksN ? p._ks / p._ksN : stressOf(bed.cells[p.cell], b, p._w.root, crop.comfortP);
    p._ks = 0; p._ksN = 0; p.ks = ks;
    // nitrogen status: what the plant holds against what its dry matter needs (critical N); P and K by soil level
    const need = nCrit(crop, p.bio);
    const ns = need > 0.05 ? p.nUp / need : 1;
    const pk = Math.sqrt(clamp(pp / 4, 0.2, 1) * clamp(kk / 12, 0.2, 1));
    const nutrient = clamp((ns - 0.45) / 0.45, 0, 1) * pk;
    const light = (1 - (bed.shade || 0)) * (bed.cover ? COVER_LIGHT : 1);
    E.topWet = top; E.water = ks; E.nutrient = nutrient; E.light = light;
    E.minC = minC + (bed.cover ? COVER_FROST_C : 0);
    E.rsMJ = A.rsMJ * light * life;
    E.competition = 1 - 0.5 * weed * (p.lai < 1.5 ? 1 : 0.6);
    const wasStage = p.stage;
    advance(p, crop, E, _ev);
    // uptake to meet the new demand: legumes fix part of it from the air, the rest comes from the soil
    const phF = ph < crop.ph[0] ? Math.max(0.4, 1 - 0.35 * (crop.ph[0] - ph)) : ph > crop.ph[1] ? Math.max(0.4, 1 - 0.35 * (ph - crop.ph[1])) : 1;
    let want = Math.max(0, nCrit(crop, p.bio) - p.nUp);
    if (want > 0 && crop.fixFrac && p.emerged && E.soilC > 8) {
      const fix = Math.min(want, crop.fixFrac * nCrit(crop, p.bio) - p.nFix);
      if (fix > 0) { p.nUp += fix; p.nFix += fix; T.nFixed += fix * p.area; want -= fix; }
    }
    if (want > 0 && p.emerged) {
      const access = (0.25 + 0.75 * p._w.root) * phF * clamp(ks + 0.2, 0, 1);
      let got = 0;
      for (const i of list) { const c = bed.cells[i], take = Math.min(c.n * 0.2 * access, want); c.n -= take; got += take; }
      p.nUp += got / m;   // per m2 of the plant's ground: each cell is an equal share of it
    }
    const wantP = Math.max(0, p.bio * crop.pConc - p.pUp), wantK = Math.max(0, p.bio * crop.kConc - p.kUp);
    for (const i of list) {
      const c = bed.cells[i];
      const tp = Math.min(c.p * 0.1 * phF, wantP), tk = Math.min(c.k * 0.1 * phF, wantK);
      c.p -= tp; c.k -= tk; p.pUp += tp / m; p.kUp += tk / m;
    }
    // dry spells and wilting are counted in real hours: they are the soil's real days
    if (!p.emerged) { p.dryH = top < 0.35 ? p.dryH + 3 : 0; }
    else if (ks < 0.65) p.dryH += 3; else p.dryH = Math.max(0, p.dryH - 6);
    // a plant left wilted for long enough dies
    if (p.emerged && !p.dead && ks < 0.08) { p.health -= 0.025; if (p.health <= 0.05) p.dead = 'drought'; }
    else if (p.emerged && !p.dead) p.health = Math.min(1, p.health + 0.004);
    if (p.stage !== wasStage && crop.stages[p.stage].id === 'ready' && p.readyT == null) p.readyT = ctx.t;
    // expected harvest from the warmth of the last week
    p.rate += ((p.gdd - p.lastGdd) / dt - p.rate) * (1 - Math.exp(-dt / 7));
    p.lastGdd = p.gdd;
    // (rate: degree days per day of the plant's life; expectT is on the real clock)
    if (p.readyT == null && !p.dead) p.expectT = ctx.t + (Math.min(400, (crop.readyGdd - p.gdd) / Math.max(0.5, p.rate)) / life) * DAY;
    p._w = plantWater(p, crop);
    describe(p, crop, bed, s, ctx.t, top, weed);
    if (_ev.flags & (EV_EMERGED | EV_STAGE | EV_FROST | EV_KILLED | EV_BOLTED)) ctx.emit('garden.plant', { id, flags: _ev.flags, stage: crop.stages[p.stage].id, dead: p.dead });
  }
  // soil processes in every cell: mineralisation, lime, weeds, mulch
  const sc = s.soilC ?? 10;
  const tf = sc <= 0 ? 0 : Math.pow(2, (sc - 20) / 10);
  const yr = dt / 365;
  for (const bed of Object.values(s.field.groups)) {
    const soil = soilOf(bed), b = bucket(soil);
    for (const c of bed.cells) {
      const moist = clamp(topFraction(c, b), 0.2, 1);
      const f = tf * moist * yr;
      const m1 = c.sn * NATIVE_RATE * f, m2 = c.on * c.onk * f;
      c.sn -= m1; c.on -= m2; c.n += m1 + m2;
      if (c.lime > 0) { const react = c.lime * (1 - Math.exp(-dt / AMENDMENTS.lime.reactTauDays)) * moist; c.lime -= react; c.ph = Math.min(8, c.ph + react / soil.limeGPerPh); }
      // weeds creep up on warm, moist, bare soil; a canopy and mulch hold them back; a hard frost kills them
      const p = c.pl ? s.plants[c.pl] : null, cover = p && p._w ? p._w.cover : 0;
      const mulchC = Math.min(1, c.mulch / MULCH.fullCoverLPerM2);
      if (minC < -2 && c.weed > 0.002) { c.on += c.wN; c.wN = 0; c.weed = 0.002; }
      const gr = 0.13 * clamp((sc - 5) / 20, 0, 1) * moist * (1 - MULCH.weedCut * mulchC) * (1 - 0.7 * cover);
      c.weed = clamp(c.weed + gr * c.weed * (1 - c.weed) * dt + 0.0004 * gr * dt * 10, 0, 1);
      const wn = WEED_N_FULL * c.weed - c.wN;
      if (wn > 0) { const take = Math.min(wn, c.n * 0.15); c.n -= take; c.wN += take; }
      if (c.mulch > 0) {
        const rot = c.mulch * (1 - Math.exp(-MULCH.decayPerYear * yr * Math.max(0.2, tf)));
        c.mulch -= rot;
        c.on += rot * MULCH.kgPerL * 1000 * (MULCH.nPct / 100);    // straw's own nitrogen goes back into the soil as it rots
        if (c.mulch < 0.05) c.mulch = 0;
      }
    }
  }
  A.n = 0; A.minC = 99; A.rsMJ = 0;
}

// ---------------------------------------------------------------------------------------- plain words
const STAGE_WORD = { sown: 'Sown', seedling: 'Seedling', leafy: 'Growing', flowering: 'Flowering', fruiting: 'Setting fruit', ready: 'Ready', past: 'Past its best' };
function ripeKg(p, crop) { return Math.max(0, p.ripeDM - p.pickedDM - p.lostDM) / crop.dmf / 1000 * p.area; }
export function yieldKgNow(p, crop) { return crop.harvest === 'repeat' ? ripeKg(p, crop) : (p.yieldDM / crop.dmf / 1000) * p.area * quality(p, crop); }
function quality(p, crop) {
  let q = 1;
  if (p.bolted) q *= 0.5;
  if (crop.harvest === 'once' && p.stage === crop.stages.length - 1 && !crop.keepsAfterKill) q *= 0.6;   // woody, split or bitter
  return q;
}
function describe(p, crop, bed, s, t, top, weed) {
  const st = crop.stages[p.stage].id, L = p.lim, d = Math.round(p.dryH / 24);
  p.wilt = p.emerged && !p.dead ? clamp((0.75 - p.ks) / 0.6, 0, 1) : 0;
  p.yellow = p.emerged && !p.dead ? clamp((0.85 - L.nutrient) / 0.6, 0, 1) : 0;
  let status = STAGE_WORD[st], reason = '';
  const name = crop.name, plural = crop.plural;
  if (p.dead === 'frost') { status = 'Killed by frost'; reason = 'Frost killed it. ' + cap(plural) + ' are ' + crop.frost.class + (crop.frost.class === 'tender' ? ': plant them after the last frost.' : '.') + (crop.keepsAfterKill && p.yieldDM > 0 ? ' What it grew can still be harvested.' : ' Pull it and sow again.'); }
  else if (p.dead === 'drought') { status = 'Dried out'; reason = 'It died after the soil stayed dry too long. Water when the soil looks pale.'; }
  else if (!p.emerged) {
    if (s.soilC < crop.germMinC) { status = 'Waiting'; reason = 'Waiting to come up: the soil is too cold (' + Math.round(s.soilC) + ' C; ' + plural + ' need ' + Math.round(crop.germMinC) + ' C).'; }
    else if (top < 0.35) { status = 'Seed bed dry'; reason = 'The seeds cannot sprout in dry soil. Water the bed.'; }
    else { status = 'Germinating'; reason = 'The seeds are sprouting. Keep the soil moist.'; }
  } else if (st === 'ready' || st === 'past' || (crop.harvest === 'repeat' && p.gdd >= crop.readyGdd)) {
    if (crop.harvest === 'repeat') {
      const kg = ripeKg(p, crop);
      status = kg > 0.02 ? 'Ready to pick' : 'Ripening';
      reason = kg > 0.02 ? 'About ' + fmtKg(kg) + ' ripe now. Pick often: ' + (p.lostDM > p.pickedDM * 0.2 && p.lostDM > 0.5 ? 'some is going over.' : 'it keeps coming.') : 'More is ripening.';
    } else if (st === 'past' && !crop.keepsAfterKill) { status = 'Past its best'; reason = cap(plural) + ' left too long go ' + (crop.part === 'leaves' ? 'bitter' : crop.part === 'root' ? 'woody' : 'tough') + '. Harvest now.'; }
    else { status = 'Ready'; reason = 'Ready to harvest: about ' + fmtKg(yieldKgNow(p, crop)) + '.'; }
  }
  if (!p.dead && p.emerged) {
    const worst = [];
    if (p.bolted) worst.push(['Bolted', 'Hot weather made it bolt (run to flower). The leaves turn bitter: harvest it now.']);
    if (p.frostBurn > 0.25) worst.push(['Frost-nipped', 'Frost burnt the leaves. ' + (crop.frost.class === 'tender' ? 'Cover the bed on cold nights.' : 'It should recover.')]);
    if (L.water < 0.7) worst.push(['Thirsty', (d >= 1 ? 'Growing slowly: the soil has been dry for ' + days(d) + '.' : 'Growing slowly: the soil is drying out.') + ' Water it.']);
    if (L.nutrient < 0.7) worst.push(['Hungry', 'Pale leaves: it is short of nitrogen. Spread compost or manure.']);
    if (L.weeds < 0.75) worst.push(['Weedy', 'Weeds are taking its water and light. Hoe the bed.']);
    if (L.crowd < 0.75) worst.push(['Crowded', 'Too close together: each plant stays small. Sow wider next time.']);
    if (L.light < 0.7) worst.push(['Shaded', 'Growing slowly: it gets too little sun here.']);
    if (L.temp < 0.25 && st !== 'ready') worst.push(['Cold', p.gdd > 0 && s.soilC < crop.tb ? 'Barely growing: it is too cold for ' + plural + '.' : 'Growing slowly: the weather is cool.']);
    if (worst.length && !(st === 'ready' && !p.bolted && crop.harvest === 'once')) { status = worst[0][0]; reason = worst[0][1] + (reason ? ' ' + reason : ''); }
    else if (!reason) reason = (st === 'flowering' ? 'Flowering and growing well.' : st === 'fruiting' ? 'Setting fruit and growing well.' : 'Growing well.');
  }
  p.status = status; p.reason = reason;
}
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const fmtKg = (kg) => (kg < 1 ? Math.round(kg * 1000 / 10) * 10 + ' g' : kg.toFixed(1) + ' kg');

// ---------------------------------------------------------------------------------------- commands
function ensure(ctx) { if (!ctx.s || ctx.s.v !== STATE_V) ctx.s = fresh(); return ctx.s; }
const fail = (reason, extra) => ({ ok: false, reason, ...extra });
function selection(s, p) {
  const sel = p.bed != null ? { bed: p.bed, cells: p.cells, ix: p.ix, iz: p.iz, w: p.w, h: p.h } : p.rect ? { rect: p.rect } : p.r != null ? { x: p.x, z: p.z, r: p.r } : null;
  return resolve(s.field, sel);
}

function makeBed(ctx, p = {}) {
  const s = ensure(ctx);
  if (stockOf(ctx) && !hasTool(ctx, 'spade') && !hasTool(ctx, 'shovel')) return fail('You need a spade to turn the sod.');
  const soil = SOILS[p.soil] ? p.soil : DEFAULT_SOIL;
  const rect = p.nx ? { x0: p.x0, z0: p.z0, nx: p.nx, nz: p.nz } : { x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z1 };
  const g = addGroup(s.field, rect, () => newCell(SOILS[soil]), { id: p.id, maxCells: 2500 });
  if (g.error) return fail(g.error === 'overlaps' ? 'That overlaps another bed.' : g.error === 'too big' ? 'Too big for one bed: keep it under 225 m2.' : g.error === 'too small' ? 'Draw it at least one cell (30 cm) across.' : g.error);
  g.soil = soil; g.shade = 0; g.cover = false; g.madeT = ctx.t;
  for (const c of g.cells) s.totals.nInit += cellN(c) * CELL_AREA;
  ctx.emit('garden.bed', { id: g.id, made: true });
  return { ok: true, id: g.id, nx: g.nx, nz: g.nz, areaM2: groupArea(s.field, g) };
}
function removeBed(ctx, p = {}) {
  const s = ensure(ctx), g = s.field.groups[p.bed ?? p.id];
  if (!g) return fail('No such bed.');
  // the soil stays where it is: its nitrogen and water simply stop being tracked
  for (const c of g.cells) {
    s.totals.nExported += cellN(c) * CELL_AREA;
    const pl = c.pl && s.plants[c.pl];
    if (pl) { s.totals.nExported += pl.nUp * pl.area; delete s.plants[c.pl]; }
  }
  removeGroup(s.field, g.id);
  ctx.emit('garden.bed', { id: g.id, removed: true });
  return { ok: true };
}
function plantsIn(s, list) {
  const seen = new Set(), out = [];
  for (const { group, index } of list) { const id = group.cells[index].pl; if (id && !seen.has(id) && s.plants[id]) { seen.add(id); out.push(s.plants[id]); } }
  return out;
}
// Take n seeds of a crop from the open packet, opening more from stock as needed. Returns how many were available.
function takeSeeds(ctx, s, crop, n) {
  const st = stockOf(ctx);
  if (!st) return n;
  const it = ITEMS[crop.seedItem];
  let have = s.packets[crop.id] || 0;
  if (have < n) {
    if (it.unit === 'each') {
      const units = Math.ceil((n - have) / crop.seedsPerUnit), own = st.items[it.id] || 0, take = Math.min(units, Math.floor(own + 1e-9));
      if (take > 0 && call(ctx, 'stock.remove', { id: it.id, qty: take }).ok) have += take * crop.seedsPerUnit;
    } else {
      const kg = Math.min(r3((n - have) / crop.seedsPerUnit + 0.0005), Math.floor((st.items[it.id] || 0) * 1000) / 1000);
      if (kg > 0 && call(ctx, 'stock.remove', { id: it.id, qty: kg }).ok) have += kg * crop.seedsPerUnit;
    }
  }
  const used = Math.min(n, have);
  s.packets[crop.id] = r3(have - used);
  return used;
}
function sow(ctx, p = {}) {
  const s = ensure(ctx), crop = CROPS[p.crop];
  if (!crop) return fail('Unknown crop.');
  const list = selection(s, p);
  if (!list.length) return fail('Choose cells in a bed to sow.');
  const span = spanOf(crop);
  const spacing = span > 1 ? crop.spacingM : clamp(p.spacingM || crop.spacingM, 0.02, CELL_M);
  const perCell = span > 1 ? 1 : (CELL_M / spacing) ** 2;
  const density = span > 1 ? 1 : (crop.spacingM / spacing) ** 2;
  // where plants can go: free cells in the selection (big plants need a free span x span block)
  const spots = [];
  const taken = new Set();
  for (const { group: g, index: i } of list) {
    if (span === 1) { if (!g.cells[i].pl) spots.push([g, i, [i]]); continue; }
    const ix = i % g.nx, iz = Math.floor(i / g.nx), cells = block(g, ix, iz, span);
    if (!cells || cells.some((j) => g.cells[j].pl || taken.has(g.id + ':' + j))) continue;
    for (const j of cells) taken.add(g.id + ':' + j);
    spots.push([g, i, cells]);
  }
  if (!spots.length) return fail(span > 1 ? cap(crop.plural) + ' need a free ' + Math.round(span * 30) + ' cm square.' : 'Those cells are already planted.');
  const seedsEach = Math.ceil(perCell * crop.seedsPerPlant - 1e-9);
  let sown = 0;
  for (const [g, i, cells] of spots) {
    if (takeSeeds(ctx, s, crop, seedsEach) < seedsEach) break;
    const id = 'p' + s.nextPlant++;
    const pl = newPlant(crop, ctx.t, density);
    Object.assign(pl, { id, crop: crop.id, bed: g.id, cell: i, span, count: Math.round(perCell * 100) / 100, area: span * span * CELL_AREA,
      nUp: 0, nFix: 0, pUp: 0, kUp: 0, ks: 1, dryH: 0, readyT: null, expectT: ctx.t + (crop.daysToMaturity / (ctx.lifeScale ?? 1)) * DAY, rate: crop.readyGdd / crop.daysToMaturity, lastGdd: 0,
      status: 'Sown', reason: '', wilt: 0, yellow: 0, _ks: 0, _ksN: 0 });
    // a transplant arrives with its own nitrogen (counted as brought in)
    if (crop.transplant) { pl.nUp = nCrit(crop, pl.bio); s.totals.nIn += pl.nUp * pl.area; }
    pl._w = plantWater(pl, crop);
    describe(pl, crop, g, s, ctx.t, 1, 0);
    s.plants[id] = pl;
    for (const j of cells) g.cells[j].pl = id;
    sown++;
  }
  if (sown) ctx.emit('garden.sow', { crop: crop.id, plants: sown });
  return sown ? { ok: true, plants: sown, partial: sown < spots.length, reason: sown < spots.length ? 'Ran out of ' + ITEMS[crop.seedItem].name.toLowerCase() + '.' : undefined }
    : fail('You have no ' + ITEMS[crop.seedItem].name.toLowerCase() + ' left. Buy some at the supplier.');
}
function water(ctx, p = {}) {
  const s = ensure(ctx), list = selection(s, p);
  if (!list.length) return fail('Choose cells in a bed to water.');
  const want = +p.litres;
  if (!(want > 0)) return fail('How much water?');
  const pairs = list.map(({ group, index }) => [group.id, index]);
  if (p.source != null && ctx.sim && ctx.sim.handlers.has('water.draw')) {
    const id = call(ctx, 'water.draw', { id: 'garden' + ctx.tick + '_' + s.pending.length, litres: want, at: p.source });
    s.pending.push({ id, cells: pairs, appliedL: 0 });
    return { ok: true, litres: 0, pending: true, drawId: id };
  }
  let litres;
  if (p.carriedL != null) litres = Math.min(want, Math.max(0, +p.carriedL || 0));
  else {
    if (stockOf(ctx) && !hasTool(ctx, 'watering_can')) return fail('You need a watering can.');
    litres = Math.min(want, s.can.litres); s.can.litres = r3(s.can.litres - litres);
    if (!(litres > 0)) return fail('The can is empty. Refill it.');
  }
  applyWater(s, pairs, litres);
  ctx.emit('garden.water', { litres });
  return { ok: true, litres, canL: s.can.litres };
}
// Refill the can. Free for now: any water source will do (a pump, tap or tank is not yet required).
function refill(ctx, p = {}) {
  const s = ensure(ctx);
  if (stockOf(ctx) && !hasTool(ctx, 'watering_can')) return fail('You need a watering can.');
  s.can.litres = CAN_L;
  return { ok: true, litres: CAN_L };
}
function hoe(ctx, p = {}) {
  const s = ensure(ctx);
  if (stockOf(ctx) && !hasTool(ctx, 'hoe')) return fail('You need a hoe.');
  const list = selection(s, p);
  let cleared = 0;
  for (const { group, index } of list) { const c = group.cells[index]; cleared += c.weed; c.on += c.wN; c.wN = 0; c.weed = 0; }
  ctx.emit('garden.hoe', { cells: list.length, cleared });
  return { ok: true, cells: list.length, clearedM2: r3(cleared * CELL_AREA) };
}
function useStock(ctx, id, qty) {
  if (!stockOf(ctx)) return qty;
  const have = stockOf(ctx).items[id] || 0, q = Math.min(qty, have);
  if (!(q > 0)) return 0;
  return call(ctx, 'stock.remove', { id, qty: r3(q) }).ok ? r3(q) : 0;
}
function mulch(ctx, p = {}) {
  const s = ensure(ctx), list = selection(s, p);
  if (!list.length) return fail('Choose cells in a bed to mulch.');
  const L = useStock(ctx, 'mulch_straw', +p.litres || list.length * CELL_AREA * MULCH.fullCoverLPerM2);
  if (!(L > 0)) return fail('You have no straw mulch.');
  const per = L / (list.length * CELL_AREA);
  for (const { group, index } of list) group.cells[index].mulch += per;
  s.totals.nIn += L * MULCH.kgPerL * 1000 * (MULCH.nPct / 100);
  return { ok: true, litres: L };
}
function amend(ctx, p = {}) {
  const s = ensure(ctx), list = selection(s, p), a = AMENDMENTS[p.kind];
  if (!a) return fail('Unknown amendment.');
  if (!list.length) return fail('Choose cells in a bed.');
  const area = list.length * CELL_AREA;
  if (a.perKg) {
    const kg = useStock(ctx, 'lime', +p.kg || area * 0.25);
    if (!(kg > 0)) return fail('You have no lime.');
    for (const { group, index } of list) group.cells[index].lime += (kg * 1000) / area;
    return { ok: true, kg };
  }
  const L = useStock(ctx, a.id, +p.litres || area * 20);
  if (!(L > 0)) return fail('You have no ' + a.name.toLowerCase() + '.');
  const dryKg = L * a.kgPerL * (1 - a.moisture);
  const nG = dryKg * 1000 * a.nPct / 100, pG = dryKg * 1000 * a.pPct / 100, kG = dryKg * 1000 * a.kPct / 100;
  for (const { group, index } of list) {
    const c = group.cells[index], add = nG / area;
    c.onk = (c.on * c.onk + add * a.releasePerYear) / Math.max(1e-9, c.on + add);
    c.on += add; c.p += (pG * a.pAvail) / area; c.k += (kG * a.kAvail) / area;
  }
  s.totals.nIn += nG;
  ctx.emit('garden.amend', { kind: a.id, litres: L });
  return { ok: true, litres: L, nG: r3(nG) };
}
// Residue of a plant goes back into its cells (or out of the bed, to the compost heap).
function returnResidue(s, p, crop, toCompost) {
  const bed = s.field.groups[p.bed], list = cellsOfPlant(s, p);
  const nLeft = p.nUp * p.area;
  if (toCompost || !bed) s.totals.nExported += nLeft;
  else for (const i of list) { const c = bed.cells[i], add = nLeft / (list.length * CELL_AREA); c.onk = (c.on * c.onk + add * RESIDUE_RATE) / Math.max(1e-9, c.on + add); c.on += add; }
  if (bed) for (const i of list) { const c = bed.cells[i]; c.pl = null; c.hist.push(crop.id); if (c.hist.length > 4) c.hist.shift(); if (!toCompost) { c.p += p.pUp * p.area / (list.length * CELL_AREA) * 0.9; c.k += p.kUp * p.area / (list.length * CELL_AREA) * 0.9; } }
  delete s.plants[p.id];
}
function harvest(ctx, p = {}) {
  const s = ensure(ctx), list = selection(s, p), got = {};
  const out = [];
  for (const pl of plantsIn(s, list)) {
    const crop = CROPS[pl.crop];
    if (pl.dead && !(crop.keepsAfterKill && pl.yieldDM > 0)) continue;
    const x = pl.gdd / crop.readyGdd;
    let kg = 0;
    if (crop.harvest === 'repeat') {
      kg = ripeKg(pl, crop);
      if (kg < 0.005) continue;
      pl.pickedDM += (kg * 1000 * crop.dmf) / pl.area;
    } else {
      if (x < 0.75 && !pl.dead) continue;
      kg = yieldKgNow(pl, crop);
    }
    kg = Math.floor(kg * 1000) / 1000;
    const nOut = Math.min(pl.nUp * pl.area, kg * crop.nRemovedGPerKg);
    pl.nUp -= nOut / pl.area; s.totals.nRemoved += nOut;
    const share = nOut / Math.max(1e-9, kg * crop.npk[0]);
    pl.pUp = Math.max(0, pl.pUp - kg * crop.npk[1] * share / pl.area); pl.kUp = Math.max(0, pl.kUp - kg * crop.npk[2] * share / pl.area);
    if (crop.harvest === 'once') returnResidue(s, pl, crop, false);
    if (kg > 0) {
      got[crop.id] = r3((got[crop.id] || 0) + kg);
      s.totals.harvestKg[crop.id] = r3((s.totals.harvestKg[crop.id] || 0) + kg);
      out.push({ plant: pl.id, crop: crop.id, kg, gesture: crop.gesture, bed: pl.bed, cell: pl.cell });
    }
  }
  // produce sold whole (the kitchen's potatoes, carrots, tomatoes) is counted out; the remainder waits for the next pick
  const items = {};
  for (const id in got) {
    const it = ITEMS[CROPS[id].produce];
    if (it.unit === 'each') {
      const kg = got[id] + (s.carryKg[id] || 0), n = Math.floor(kg / it.massKgPerUnit + 1e-9);
      s.carryKg[id] = r3(kg - n * it.massKgPerUnit);
      if (n > 0) { call(ctx, 'stock.add', { id: it.id, qty: n }); items[it.id] = n; }
    } else { call(ctx, 'stock.add', { id: it.id, qty: got[id] }); items[it.id] = got[id]; }
  }
  if (out.length) ctx.emit('garden.harvest', { picks: out, kg: got, items });
  return out.length ? { ok: true, kg: got, items, picks: out } : fail('Nothing here is ready to harvest yet.');
}
function pull(ctx, p = {}) {
  const s = ensure(ctx), list = selection(s, p);
  let n = 0;
  for (const pl of plantsIn(s, list)) { returnResidue(s, pl, CROPS[pl.crop], !!p.toCompost); n++; }
  return n ? { ok: true, plants: n } : fail('Nothing planted there.');
}
function cover(ctx, p = {}) {
  const s = ensure(ctx), beds = p.bed != null ? [s.field.groups[p.bed]].filter(Boolean) : Object.values(s.field.groups);
  if (!beds.length) return fail('No bed to cover.');
  for (const b of beds) b.cover = p.on !== undefined ? !!p.on : !b.cover;
  ctx.emit('garden.bed', { cover: true });
  return { ok: true, beds: beds.length, on: beds[0].cover };
}
function setShade(ctx, p = {}) {
  const s = ensure(ctx), b = s.field.groups[p.bed];
  if (!b) return fail('No such bed.');
  b.shade = clamp(+p.shade || 0, 0, 1);
  return { ok: true };
}

export const garden = {
  name: 'garden',
  every: SOIL_EVERY,
  init: () => fresh(),
  step(ctx) {
    const s = ctx.s;
    if (!s || s.v !== STATE_V) { ctx.s = fresh(); return; }
    let any = false; for (const _ in s.field.groups) { any = true; break; }
    if (!any) { s.last = null; return; }
    // a plant needs its water figures before the first soil step after sowing or loading
    for (const id in s.plants) { const p = s.plants[id]; if (!p._w) p._w = plantWater(p, CROPS[p.crop]); }
    soilStep(ctx, s);
    if (ctx.tick % GROWTH_EVERY === 0) growthStep(ctx, s);
  },
  commands: {
    'garden.makeBed': makeBed, 'garden.removeBed': removeBed, 'garden.sow': sow, 'garden.water': water, 'garden.refill': refill,
    'garden.hoe': hoe, 'garden.mulch': mulch, 'garden.amend': amend, 'garden.harvest': harvest, 'garden.pull': pull,
    'garden.cover': cover, 'garden.setShade': setShade,
  },
};

// ---------------------------------------------------------------------------------------- read-outs
// Everything the inspector shows about one plant.
export function plantInfo(state, id, t) {
  const g = state.sys ? state.sys.garden : state, p = g.plants[id];
  if (!p) return null;
  const crop = CROPS[p.crop], x = p.gdd / crop.readyGdd;
  const packetT = p.sownT + (crop.daysToMaturity / lifeOf(state.sys ? state : null)) * DAY;
  const expectT = p.readyT ?? p.expectT;
  const aheadDays = Math.round((packetT - expectT) / DAY);
  return {
    id, crop: crop.id, name: crop.name, variety: crop.variety, stage: crop.stages[p.stage].id, stageWord: STAGE_WORD[crop.stages[p.stage].id],
    status: p.status, reason: p.reason, progress: clamp(x, 0, 1.5), sownT: p.sownT, expectT, packetT, readyT: p.readyT,
    ahead: p.dead ? 0 : aheadDays,   // game days ahead of the seed packet (negative: behind) count: p.count, area: p.area, dead: p.dead, bolted: p.bolted, wilt: p.wilt, yellow: p.yellow,
    needs: needsOf(p, crop), yieldKg: yieldKgNow(p, crop), harvest: crop.harvest, gesture: crop.gesture,
    details: { gdd: Math.round(p.gdd), readyGdd: crop.readyGdd, lai: r3(p.lai), bioGm2: Math.round(p.bio), yieldDMgm2: Math.round(p.yieldDM), waterLimit: r3(p.lim.water), nitrogenLimit: r3(p.lim.nutrient), nUpGm2: r3(p.nUp), lightLimit: r3(p.lim.light), tempLimit: r3(p.lim.temp), crowd: r3(p.lim.crowd), ks: r3(p.ks) },
  };
}
function needsOf(p, crop) {
  const out = [];
  if (p.dead) return out;
  out.push(crop.frost.class === 'tender' ? 'No frost' : crop.frost.class === 'hardy' ? 'Takes frost' : 'Light frost only');
  out.push(crop.comfortP <= 0.3 ? 'Steady moisture' : crop.comfortP >= 0.5 ? 'Tolerates dry spells' : 'Water when dry');
  out.push(crop.npk[0] >= 8 && !crop.fixFrac ? 'Rich soil' : crop.fixFrac ? 'Feeds the soil' : 'Ordinary soil');
  return out;
}
export function cellInfo(state, bedId, index) {
  const g = state.sys ? state.sys.garden : state, bed = g.field.groups[bedId];
  if (!bed) return null;
  const c = bed.cells[index], soil = soilOf(bed), b = bucket(soil);
  return { water: topFraction(c, b), deep: clamp((c.d - b.wp2) / (b.fc2 - b.wp2), 0, 1.2), n: c.n, p: c.p, k: c.k, ph: c.ph, om: omPct(c, soil), weed: c.weed, mulch: Math.min(1, c.mulch / MULCH.fullCoverLPerM2), plant: c.pl, hist: c.hist };
}
// A bed in a few words.
export function bedSummary(state, bedId) {
  const g = state.sys ? state.sys.garden : state, bed = g.field.groups[bedId];
  if (!bed) return null;
  const soil = soilOf(bed), b = bucket(soil);
  let wat = 0, weed = 0, n = 0, om = 0, ph = 0;
  for (const c of bed.cells) { wat += topFraction(c, b); weed += c.weed; n += c.n; om += omPct(c, soil); ph += c.ph; }
  const m = bed.cells.length; wat /= m; weed /= m; n /= m; om /= m; ph /= m;
  const crops = {}, ready = [];
  const plants = Object.values(g.plants).filter((p) => p.bed === bedId);
  for (const p of plants) { crops[p.crop] = (crops[p.crop] || 0) + 1; if (/Ready/.test(p.status)) ready.push(p.crop); }
  const needs = [];
  if (wat < 0.45) needs.push('Water');
  if (weed > 0.25) needs.push('Hoe');
  if (ready.length) needs.push('Harvest');
  if (n < 1.2 && om < 2.5) needs.push('Compost');
  const last = {};
  for (const c of bed.cells) if (c.hist.length) { const h = c.hist[c.hist.length - 1]; last[h] = (last[h] || 0) + 1; }
  const prev = Object.entries(last).sort((a, b2) => b2[1] - a[1])[0];
  return {
    id: bed.id, areaM2: m * CELL_AREA, nx: bed.nx, nz: bed.nz, soil: soil.name, soilFeel: soil.feel, water: wat, weeds: weed, nitrogen: n, omPct: om, ph,
    moistWord: wat > 1.02 ? 'Wet' : wat > 0.6 ? 'Moist' : wat > 0.4 ? 'Drying' : 'Dry', crops, needs, cover: bed.cover, shade: bed.shade,
    rotation: prev ? rotationHint(prev[0]) : null,
  };
}
// What to grow next where a crop grew (classic rotation advice: follow heavy feeders with legumes, do not
// repeat a family in the same place).
export function rotationHint(lastCrop) {
  const c = CROPS[lastCrop];
  if (!c) return null;
  if (c.legume) return 'Last grown here: ' + c.plural + '. They left nitrogen behind: a good spot for corn, squash or kale.';
  if (c.npk[0] >= 8 || c.id === 'tomato' || c.id === 'squash') return 'Last grown here: ' + c.plural + ', a hungry crop. Follow with peas or beans, or add compost.';
  return 'Last grown here: ' + c.plural + '. Grow something from another family next (not more ' + c.family + 's).';
}

// ---------------------------------------------------------------------------------------- the almanac
// Typical frost dates for the site's climate, derived from the climate's monthly normals as the weather
// system fits them: the chance of frost on a night is the chance that the night's minimum (daily mean minus
// half the day-to-night range, minus a little for radiative cooling of plants) falls below 0 C, with the
// climate's own day-to-day spread. The median last spring frost is the date after which the chance of any
// further frost falls below one half (and likewise for autumn). Nights a few days apart are treated as
// independent. DTR (mean diurnal range) is an approximation for a mid-latitude inland site.
const DTR_C = 13;            // approx: typical mean daily range in a humid continental climate (6 h boundary layer)
const NIGHT_EXTRA_C = 1.5;     // approx: leaves and soil surface run about 1 C below screen temperature on frosty nights
const INDEPENDENT_DAYS = 3;  // approx: weather systems last a few days, so nights are not independent
const frostCache = new Map();
function phiN(x) { const k = 1 / (1 + 0.2316419 * Math.abs(x)), d = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI); const p = d * k * (0.31938153 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429)))); return x >= 0 ? 1 - p : p; }
export function frostDates(site) {
  const climate = (site && site.climate) || DEFAULT_CLIMATE, lat = site && site.latitudeDeg != null ? site.latitudeDeg : CLIMATES[climate].latitudeDeg;
  const key = climate + '@' + lat;
  if (frostCache.has(key)) return frostCache.get(key);
  const M = climateModel(climate, lat), c = M.climate;
  const pf = new Float64Array(DAYS_IN_YEAR);
  let warm = 0;
  for (let d = 0; d < DAYS_IN_YEAR; d++) {
    const mean = M.seasonalC[d];
    if (mean > M.seasonalC[warm]) warm = d;
    const summer = clamp((mean - M.tMin) / Math.max(1e-6, M.tMax - M.tMin), 0, 1);
    const sd = Math.hypot(c.anomalySdC[0] + (c.anomalySdC[1] - c.anomalySdC[0]) * summer, 2);
    // the day-to-night range scales with how deep the weather model's boundary layer is: the sea damps it
    const dtr = DTR_C * (c.boundaryLayerHours || 6) / 6;
    pf[d] = phiN((0 - (mean - dtr / 2 - NIGHT_EXTRA_C)) / sd);
  }
  const at = (d) => pf[((d % DAYS_IN_YEAR) + DAYS_IN_YEAR) % DAYS_IN_YEAR];
  // spring: walk back from the warmest day; autumn: walk forward from it
  let last = null, first = null, surv = 1;
  for (let d = warm; d > warm - DAYS_IN_YEAR / 2; d--) { surv *= Math.pow(1 - at(d), 1 / INDEPENDENT_DAYS); if (surv < 0.5) { last = (d + DAYS_IN_YEAR) % DAYS_IN_YEAR; break; } }
  surv = 1;
  for (let d = warm; d < warm + DAYS_IN_YEAR / 2; d++) { surv *= Math.pow(1 - at(d), 1 / INDEPENDENT_DAYS); if (surv < 0.5) { first = d % DAYS_IN_YEAR; break; } }
  const r = { lastDoy: last, firstDoy: first, frostFree: last == null, seasonDays: last == null ? 365 : (first - last + DAYS_IN_YEAR) % DAYS_IN_YEAR };
  frostCache.set(key, r);
  return r;
}
const PART = ['early', 'mid', 'late'];
export const roughDate = (doy) => { const m = monthOf(doy), dm = dayOfMonth(doy); return PART[dm <= 10 ? 0 : dm <= 20 ? 1 : 2] + ' ' + MONTHS[m]; };
export const exactDate = (doy) => dayOfMonth(doy) + ' ' + MONTHS[monthOf(doy)];
// The sow windows of a crop as day-of-year ranges for this site (null when the site has no frosts to anchor to).
export function sowWindows(crop, fd) {
  return crop.sow.map((w) => {
    const anchor = w.anchor === 'last' ? (fd.frostFree ? 45 : fd.lastDoy) : (fd.frostFree ? 320 : fd.firstDoy);
    return { from: (anchor + w.from + DAYS_IN_YEAR) % DAYS_IN_YEAR, to: (anchor + w.to + DAYS_IN_YEAR) % DAYS_IN_YEAR };
  });
}
const inWin = (doy, w) => (w.from <= w.to ? doy >= w.from && doy <= w.to : doy >= w.from || doy <= w.to);
const until = (doy, d) => (d - doy + DAYS_IN_YEAR) % DAYS_IN_YEAR;
// "Sow mid April to mid May (about four weeks before the last frost, usually mid May here)."
// life: the world's lifeScale (365 / days in its year), so the advice can say how many game days away a date is.
const gameDays = (calDays, life) => Math.max(0, Math.round(calDays / life));
const inDays = (n) => (n <= 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days');
export function sowAdvice(cropId, site, doy, life = 1) {
  const crop = CROPS[cropId], fd = frostDates(site), wins = sowWindows(crop, fd);
  const now = wins.find((w) => inWin(doy, w));
  const next = wins.slice().sort((a, b) => until(doy, a.from) - until(doy, b.from))[0];
  const frostWord = fd.frostFree ? 'Frost is rare here.' : 'Last frost usually ' + roughDate(fd.lastDoy) + ', first frost ' + roughDate(fd.firstDoy) + ' here.';
  return {
    now: !!now, until: now ? exactDate(now.to) : null, next: next ? exactDate(next.from) : null, daysToNext: next ? until(doy, next.from) : null,
    gameDaysToNext: next ? gameDays(until(doy, next.from), life) : null, gameDaysLeft: now ? gameDays(until(doy, now.to), life) : null,
    windows: wins.map((w) => roughDate(w.from) + ' to ' + roughDate(w.to)),
    text: crop.sowText, frostWord,
    // the real-calendar window, and when that is in this world's (possibly shorter) year
    short: now ? 'Sow now, until ' + exactDate(now.to) + (life > 1.01 ? ' (' + (gameDays(until(doy, now.to), life) < 1 ? 'today is the last day' : gameDays(until(doy, now.to), life) + ' more game days') + ')' : '') + '.'
      : 'Best sown from ' + exactDate(next.from) + (life > 1.01 ? ' (' + inDays(gameDays(until(doy, next.from), life)) + ')' : '') + '.',
  };
}
// Tonight's frost risk from the weather now: the night's minimum tends toward the dew point on a clear, still
// night (a forecaster's rule of thumb), stays warmer under cloud and wind, and leaves run a little colder still.
export function frostTonight(w) {
  if (!w || w.tempC == null) return { level: 'none', minC: null, text: '' };
  const cloud = w.cloud ?? 0.5, calm = clamp(1 - (w.windMs ?? 2) / 5, 0, 1);
  const base = Math.min(w.tempC, (w.dewPointC ?? w.tempC - 4) + 3.5 * cloud + 2 * (1 - calm));
  const minC = base - 1.5 * (1 - cloud) * calm;
  const sky = cloud < 0.35 ? (calm > 0.5 ? 'Clear and still tonight' : 'Clear tonight') : cloud > 0.7 ? 'Cloudy tonight' : 'Some cloud tonight';
  const level = minC <= 0 ? 'likely' : minC <= 2.5 ? 'possible' : 'none';
  const text = level === 'likely' ? sky + ': frost likely.' : level === 'possible' ? sky + ': a light frost is possible.' : sky + ': no frost.';
  return { level, minC: Math.round(minC * 10) / 10, text };
}
export function almanac(state, t) {
  const g = state.sys ? state.sys.garden : null, w = state.sys ? state.sys.weather : null;
  const site = (w && w.site) || { climate: DEFAULT_CLIMATE, latitudeDeg: CLIMATES[DEFAULT_CLIMATE].latitudeDeg };
  t = t ?? state.t;
  const life = lifeOf(state), ct = calendarT(t, state.lifeT ?? t);
  const doy = dayOfYear(ct), fd = frostDates(site);
  const sowNow = [], sowSoon = [];
  for (const id of CROP_IDS) {
    const a = sowAdvice(id, site, doy, life);
    if (a.now) sowNow.push({ crop: id, until: a.until, gameDaysLeft: a.gameDaysLeft });
    else if (a.daysToNext != null && a.daysToNext <= 21) sowSoon.push({ crop: id, from: a.next, inDays: a.gameDaysToNext });
  }
  const readySoon = [];
  if (g) for (const p of Object.values(g.plants)) {
    if (p.dead) continue;
    const crop = CROPS[p.crop], left = (p.expectT - t) / DAY;
    if (/Ready|pick/i.test(p.status)) readySoon.push({ crop: p.crop, plant: p.id, bed: p.bed, now: true });
    else if (p.readyT == null && left < 10) readySoon.push({ crop: p.crop, plant: p.id, bed: p.bed, inDays: Math.max(0, Math.round(left)) });
  }
  // fold ready plants into one line per crop and bed
  const rs = new Map();
  for (const r of readySoon) { const k = r.crop + '|' + r.bed + '|' + (r.now ? 'now' : 'soon'); const e = rs.get(k); if (e) { e.plants++; if (!r.now) e.inDays = Math.min(e.inDays, r.inDays); } else rs.set(k, { ...r, plants: 1 }); }
  const frost = frostTonight(w);
  const atRisk = [];
  if (g && frost.level !== 'none') for (const p of Object.values(g.plants)) {
    const crop = CROPS[p.crop], bed = g.field.groups[p.bed];
    if (p.dead || !p.emerged || !bed) continue;
    if (frost.minC + (bed.cover ? COVER_FROST_C : 0) <= crop.frost.damageC + 2.5 && !atRisk.includes(p.crop)) atRisk.push(p.crop);
  }
  const anyUncovered = g ? Object.values(g.field.groups).some((b) => !b.cover) : false;
  return {
    lastFrost: fd.frostFree ? null : roughDate(fd.lastDoy), firstFrost: fd.frostFree ? null : roughDate(fd.firstDoy),
    lastFrostDoy: fd.lastDoy, firstFrostDoy: fd.firstDoy, frostFree: fd.frostFree, seasonDays: fd.seasonDays,
    today: exactDate(doy), sowNow, sowSoon, readySoon: [...rs.values()], frost: { ...frost, atRisk, coverAdvised: frost.level !== 'none' && atRisk.length > 0 && anyUncovered },
  };
}
export { CROPS, CROP_IDS, SOILS, AMENDMENTS, MULCH, CAN_L };
export { cellAt, cellCentre, spanOf };
