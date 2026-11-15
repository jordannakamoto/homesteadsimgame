// A bucket soil-water model for a cell of ground, after FAO-56 (Allen et al. 1998) with its dual crop
// coefficient: reference evapotranspiration ET0, a basal coefficient Kcb for transpiration, an evaporation
// coefficient Ke for the wet soil surface, and a stress coefficient Ks when the root zone runs dry.
// Generic: it takes soil records { fc, wp, bulkGcm3, rewMm, drainTauH } (volumetric water contents) and
// plain numbers for the plant cover; it knows nothing about which plants they are.
//
// Each cell has two layers: the top (0 to TOP_M), which rain and watering fill first and which loses water
// to evaporation, and the deep reserve (TOP_M to TOP_M + DEEP_M) that deeper roots reach. Water above
// field capacity drains downward with the soil's time constant; what leaves the deep layer is lost to
// drainage, and what cannot soak in (above saturation) runs off. Every millimetre is accounted for:
// in = change in storage + evaporation + transpiration + drainage + runoff.
//
// cell fields used: w (top layer water, mm), d (deep layer water, mm), de (depletion of the 10 cm surface
// layer that evaporation draws on, mm), sw (water in the top 2 cm where seeds lie, mm: part of w, wetted first by
// rain and watering and dried first by evaporation, so a seed bed needs watering more often than the roots do).
// 1 mm over 1 m2 is 1 L.

export const TOP_M = 0.3, DEEP_M = 0.7, ZE_M = 0.1, SEED_M = 0.02;
const KC_MAX = 1.2;   // FAO-56 eq. 72, the upper limit on evaporation plus transpiration after wetting

// Capacities of a soil, in mm. Cached per soil record.
const cache = new WeakMap();
export function bucket(soil) {
  let b = cache.get(soil);
  if (b) return b;
  const sat = 1 - soil.bulkGcm3 / 2.65;                       // total porosity
  b = {
    fc1: soil.fc * TOP_M * 1000, wp1: soil.wp * TOP_M * 1000, sat1: sat * TOP_M * 1000, dry1: 0.5 * soil.wp * TOP_M * 1000,
    fc2: soil.fc * DEEP_M * 1000, wp2: soil.wp * DEEP_M * 1000, sat2: sat * DEEP_M * 1000,
    tew: 1000 * (soil.fc - 0.5 * soil.wp) * ZE_M, rew: soil.rewMm, tauH: soil.drainTauH,
    swCap: 1000 * (soil.fc - 0.5 * soil.wp) * SEED_M,
  };
  b.rew = Math.min(b.rew, b.tew * 0.9);
  cache.set(soil, b);
  return b;
}

// Priestley-Taylor reference evapotranspiration (Priestley and Taylor 1972), mm over `hours`, with FAO-56's
// hourly net radiation: Rn = 0.77 Rs - Rnl (albedo 0.23; Rnl from eq. 39 with the hourly Stefan-Boltzmann
// constant), soil heat flux G = 0.1 Rn by day and 0.5 Rn at night (eqs. 45, 46), alpha = 1.26.
// It needs no wind: it is the method for humid climates, where ET follows the energy available.
//   tC air temperature, rsMJ global solar radiation over the period (MJ/m2), rel = Rs/Rso (clearness, 0.25..1),
//   eaKPa actual vapour pressure.
export function priestleyTaylorMm(tC, rsMJ, rel, eaKPa, hours = 1) {
  const es = 0.6108 * Math.exp((17.27 * tC) / (tC + 237.3));
  const delta = (4098 * es) / ((tC + 237.3) ** 2);
  const gamma = 0.0665;                                       // kPa/C at about 101 kPa
  const tk = tC + 273.16;
  const rnl = 2.043e-10 * hours * tk ** 4 * (0.34 - 0.14 * Math.sqrt(Math.max(0, eaKPa))) * (1.35 * Math.min(1, Math.max(0.25, rel)) - 0.35);
  const rn = 0.77 * rsMJ - rnl;
  const g = rn > 0 ? 0.1 * rn : 0.5 * rn;
  return Math.max(0, (1.26 * delta) / (delta + gamma) * (rn - g) / 2.45);
}

// Root-zone stress coefficient (FAO-56 eq. 84) for a plant reaching `rootFrac` of the deep layer.
export function stressOf(cell, b, rootFrac, p) {
  const taw = (b.fc1 - b.wp1) + rootFrac * (b.fc2 - b.wp2);
  const avail = Math.max(0, cell.w - b.wp1) + rootFrac * Math.max(0, cell.d - b.wp2);
  const dr = Math.max(0, taw - avail);
  return dr <= p * taw ? 1 : Math.max(0, (taw - dr) / ((1 - p) * taw));
}
// Fraction of plant-available water in the top layer and in the root zone (0 = wilting point, 1 = field capacity).
export const topFraction = (cell, b) => Math.max(0, Math.min(1.2, (cell.w - b.wp1) / (b.fc1 - b.wp1)));

// Add water at the surface (rain, watering). What will not fit below saturation runs off. Returns runoff mm.
export function infiltrate(cell, b, mm) {
  if (!(mm > 0)) return 0;
  cell.w += mm;
  cell.de = Math.max(0, cell.de - mm);
  cell.sw = Math.min(b.swCap, (cell.sw || 0) + mm);
  let off = 0;
  if (cell.w > b.sat1) {                                      // the top is full: the surplus goes down at once if the deep layer has room
    const over = cell.w - b.sat1, room = Math.max(0, b.sat2 - cell.d), down = Math.min(over, room);
    cell.d += down; cell.w -= over; off = over - down;
  }
  return off;
}

// One step of `hours`. inp: { et0 (mm over the step), kcb, cover (canopy fraction 0..1), mulch (0..1 cover),
// mulchCut (share of evaporation a full mulch stops), rootFrac (0..1 of the deep layer reached), p (depletion
// fraction where stress starts), weedKc (extra transpiration of weeds), frozen (soil frozen: no ET) }.
// out (reused, no allocation): { evap, transp, drain, ks } in mm.
export function stepCell(cell, b, inp, hours, out) {
  // drainage: water above field capacity moves down the profile with the soil's time constant
  if (b.hours !== hours) { b.hours = hours; b.k1 = 1 - Math.exp(-hours / b.tauH); b.k2 = 1 - Math.exp(-hours / (b.tauH * 2)); b.kc = 1 - Math.exp(-hours / 4); }
  const k = b.k1, k2 = b.k2;
  if (cell.w > b.fc1) { const m = (cell.w - b.fc1) * k; cell.w -= m; cell.d += m; }
  let drain = 0;
  if (cell.d > b.sat2) { drain += cell.d - b.sat2; cell.d = b.sat2; }
  if (cell.d > b.fc2) { const m = (cell.d - b.fc2) * k2; cell.d -= m; drain += m; }
  out.drain = drain;
  out.evap = 0; out.transp = 0;
  out.ks = stressOf(cell, b, inp.rootFrac, inp.p);
  // the seed zone is fed from below by capillary rise, toward the moisture of the soil under it
  const under = b.swCap * Math.max(0, 1 - cell.de / b.tew, 0.9 * Math.min(1, (cell.w - b.wp1) / (b.fc1 - b.wp1)));
  if (under > (cell.sw || 0)) cell.sw = (cell.sw || 0) + (under - (cell.sw || 0)) * b.kc;
  if (inp.frozen || !(inp.et0 > 0)) return out;
  // evaporation from the wet surface, cut by the canopy shading it and by mulch (FAO-56 eqs. 71 to 77)
  const kr = cell.de <= b.rew ? 1 : Math.max(0, (b.tew - cell.de) / (b.tew - b.rew));
  const few = Math.max(0.01, 1 - inp.cover);
  const ke = Math.min(kr * Math.max(0, KC_MAX - inp.kcb), few * KC_MAX);
  let evap = ke * inp.et0 * (1 - (inp.mulchCut || 0) * (inp.mulch || 0));
  evap = Math.max(0, Math.min(evap, cell.w - b.dry1));
  cell.w -= evap; cell.de = Math.min(b.tew, cell.de + evap);
  cell.sw = Math.max(0, (cell.sw || 0) - evap);

  // transpiration by the crop and the weeds, from the layers in proportion to the water each still holds
  const want = (inp.kcb + (inp.weedKc || 0)) * inp.et0 * out.ks;
  const a1 = Math.max(0, cell.w - b.wp1), a2 = inp.rootFrac * Math.max(0, cell.d - b.wp2), a = a1 + a2;
  const t = Math.min(want, a);
  if (t > 0) { cell.w -= (t * a1) / a; cell.d -= (t * a2) / a; }
  out.evap = evap; out.transp = t;
  return out;
}

export const seedFraction = (cell, b) => (cell.sw || 0) / b.swCap;
export const storedMm = (cell) => cell.w + cell.d;
