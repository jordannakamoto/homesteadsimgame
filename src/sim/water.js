// Water (iteration 7): catch rain off roofs, store it, move it through pipes by gravity and pumps,
// heat it, drain it, and freeze it when it is cold enough for long enough.
//
// Cadence 1 tick (1 minute). The network is built from ctx.get('site').pieces: fixtures whose `fixture`
// is in FIXTURES_WATER, and connection pieces of kind "pipe". Nothing else says what exists.
//
// Physics and the source family of each relationship:
//   Catchment    runoff L/min = rainMmH / 60 x roof plan area (m2) x runoff coefficient (1 mm on 1 m2 is 1 L).
//                Coefficients by roofing (rainwater-harvesting manuals, e.g. Texas Water Development Board
//                2005 and Australian HB 230): metal 0.9, slate and tile 0.85, shingle 0.8, thatch 0.5.
//                Snow on a roof is held as water equivalent and runs off only as it melts, by the same
//                degree-day rule the weather system uses for the ground pack (3.5 mm per C per day).
//   Hydrostatics p = rho g h: 9.81 kPa per metre of head (rho 1000 kg/m3, g 9.81 m/s2).
//   Friction     Hazen-Williams (SI): hf = 10.67 L Q^1.852 / (C^1.852 d^4.8704), Q in m3/s, d inner
//                diameter in m. Valid for water near room temperature in full pipes, which is all we model.
//   Outlets      orifice law Q = Qr sqrt(p / pr): the head an outlet uses at flow Q is (pr / rho g)(Q / Qr)^2.
//   Operating    for each outlet the flow Q solves: z_surface - z_outlet + H_pump(Q) - hf(Q) - h_outlet(Q) = 0
//   point        (bisection; every term is monotonic in Q). No positive root -> no flow.
//   Pumps        head/flow curve from the catalog; a stopped pump passes no water (check valve).
//                Electric pumps run only while electrical reports their load on and served; they draw
//                their rated power whenever they run (pressure-switch pumps run until cut-out).
//   Wells        the bore stores water (area x height); the aquifer refills it at yield x drawdown /
//                maximum drawdown (the well gives exactly its yield when pumped down to the intake).
//   Heat         m c dT with c = 4186 J/kg K; latent heat of fusion 334 kJ/kg; ice c = 2100 J/kg K.
//                Each tank, pipe and heater is one lumped body with an enthalpy, relaxed toward its
//                surroundings with UA (exact exponential within one phase). Outdoor film coefficient
//                h = 10 + 4 v W/m2K (natural convection plus long-wave radiation at rest, plus wind).
//   Frost depth  Stefan's equation X = sqrt(2 k F / L) on the accumulated surface freezing index F,
//                frozen moist soil k = 1.5 W/m K, L = 1600 kg/m3 x 0.20 water x 334 kJ/kg; snow insulates.
//                A buried pipe below X follows the deep-soil temperature; inside X it sits on the frozen
//                soil's linear temperature profile.
//
// Simplified (said here so nobody mistakes it for more): each outlet is solved on its own, as if no
// other outlet shared its pipes; tank geometry is a prism (level is linear in volume); evaporation from
// covered tanks is not modelled; a pipe blocks when half its water is ice; tanks lose heat over their
// box surface; the solar batch heater sees global horizontal irradiance (no tilt).
//
// Conservation (tested): collected + pumped from wells + imported = change in stored + used + overflow
// + first-flush loss. "Stored" is fresh water in tanks, heaters and pressure tanks.

import { FIXTURES_WATER } from './fixtures-water.js';
import { CLIMATES } from './weather.js';
import { DAY, hourOfDay } from './time.js';

export const RHO = 1000, G = 9.81;
export const KPA_PER_M = (RHO * G) / 1000;             // 9.81 kPa per metre of water
export const CW = 4186, CI = 2100, LF = 334000;         // J/kg K water, J/kg K ice, J/kg fusion
const STATE_V = 1;
const DDF = 3.5 / DAY;                                  // mm w.e. per C per second (weather.js uses the same)
const FROST_K = 1.5, FROST_L = 1600 * 0.2 * LF;         // Stefan's equation constants (see above)
const BURIED_TAU = 12 * 3600;                           // s: a buried body follows the soil over half a day
const INDOOR_C = 15;                                    // an unheated-but-sheltered indoor space
const INSUL_K = 0.035;                                  // W/m K: foam pipe sleeve / tank wrap (EPS, PE foam)
const DIP_LMIN = 20;                                    // a bucket dipped into a tank
const MAX_RESULTS = 64;
const NONE = Object.freeze([]);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------------------------------- pure relations
export const RUNOFF = Object.freeze({
  steel_roofing: 0.9, steel: 0.9, copper: 0.9, aluminium: 0.9,
  slate: 0.85, clay_tile: 0.85, asphalt_shingle: 0.8, cedar_shake: 0.8, epdm: 0.8, thatch: 0.5,
});
export const runoffCoefficient = (materialId) => RUNOFF[materialId] ?? 0.75;
export const catchmentLmin = (rainMmH, areaM2, coefficient) => (rainMmH / 60) * areaM2 * coefficient;
export const staticPressureKPa = (headM) => headM * KPA_PER_M;
const HW = (C, dM) => 10.67 / (Math.pow(C, 1.852) * Math.pow(dM, 4.8704));
export const hazenWilliamsHeadLossM = (lmin, lengthM, innerDiameterM, C) => HW(C, innerDiameterM) * lengthM * Math.pow(lmin / 60000, 1.852);
export function pumpHeadM(spec, lmin) {
  const q = Math.max(0, lmin);
  if (q >= spec.maxLmin) return 0;
  if (spec.curve === 'linear') return spec.shutoffHeadM * (1 - q / spec.maxLmin);
  if (spec.curve === 'quadratic') return spec.shutoffHeadM * (1 - (q / spec.maxLmin) ** 2);
  if (spec.curve === 'human') return q <= 1e-9 ? 100 : Math.min(100, spec.humanW / (RHO * G * (q / 60000)));
  return 0;
}
export const outletHeadM = (spec, lmin) => (spec.ratedLmin > 0 ? (spec.ratedKPa / KPA_PER_M) * (lmin / spec.ratedLmin) ** 2 : 0);
export const heatEnergyKWh = (litres, fromC, toC) => (litres * CW * (toC - fromC)) / 3.6e6;
export const frostDepthM = (freezingIndexCs) => Math.sqrt((2 * FROST_K * Math.max(0, freezingIndexCs)) / FROST_L);
export const filmCoefficient = (windMs) => Math.min(40, 10 + 4 * Math.max(0, windMs || 0));

// ---------------------------------------------------------------------------------------- thermal bodies
// A body is { tempC, iceL } holding m kg (1 L = 1 kg) of water. Enthalpy is measured from liquid at 0 C.
function enth(b, m) {
  if (b.iceL <= 0) return m * CW * Math.max(0, b.tempC);
  if (b.iceL >= m) return -m * LF + m * CI * Math.min(0, b.tempC);
  return -b.iceL * LF;
}
function setE(b, E, m) {
  if (m <= 1e-9) { b.iceL = 0; return; }
  if (E >= 0) { b.tempC = E / (m * CW); b.iceL = 0; }
  else if (E > -m * LF) { b.tempC = 0; b.iceL = -E / LF; }
  else { b.tempC = (E + m * LF) / (m * CI); b.iceL = m; }
}
function relax(b, m, UA, envC, dt, extraJ = 0) {
  if (m <= 1e-9) return;
  const E = enth(b, m), C = E > 0 ? m * CW : E < -m * LF ? m * CI : 0;
  let q = UA * (envC - b.tempC) * dt;
  if (C > 0 && UA > 0) { const k = (UA * dt) / C; if (k > 1e-6) q *= (1 - Math.exp(-k)) / k; }
  setE(b, E + q + extraJ, m);
}
function addLiquid(b, m, L, tC) { setE(b, enth(b, m) + L * CW * Math.max(0, tC), m + L); }
function removeLiquid(b, m, L) { const t = b.iceL > 0 ? 0 : Math.max(0, b.tempC); setE(b, enth(b, m) - L * CW * t, m - L); }
const liquidTemp = (b) => (b.iceL > 0 ? 0 : b.tempC);

// ---------------------------------------------------------------------------------------- network
// Built from the pieces and cached by the identity of the pieces array (a pure function of it, so the
// cache holds no truth: a loaded game rebuilds exactly the same network).
const nets = new WeakMap();
const resolvePipe = (p) => {
  const spec = FIXTURES_WATER[p.material];
  if (spec && spec.category === 'pipe') return spec;
  if (p.diameterMm) {
    const byNom = Object.values(FIXTURES_WATER).find((f) => f.category === 'pipe' && f.nominalMm === p.diameterMm);
    if (byNom) return byNom;
    return { id: 'custom', innerMm: p.diameterMm, outerMm: p.diameterMm * 1.2, hazenC: 140 };
  }
  return FIXTURES_WATER.pipe_pex_20;
};

function netFor(pieces) {
  let net = nets.get(pieces);
  if (net) return net;
  net = { fx: new Map(), pipes: [], pipeById: new Map(), ports: new Map(), roofs: new Map(), paths: new Map(),
    gutters: [], tanks: [], grey: [], pumps: [], ptanks: [], wells: [], outlets: [], heaters: [], ffs: [], drains: [], routes: {} };
  for (const p of pieces) {
    if (p.kind === 'roof') net.roofs.set(p.id, p);
    if (p.kind !== 'fixture') continue;
    const spec = FIXTURES_WATER[p.fixture];
    if (!spec || spec.category === 'pipe') continue;
    net.fx.set(p.id, { id: p.id, p, spec });
    const list = { catchment: spec.chamberL ? net.ffs : spec.id === 'gutter_k5' ? net.gutters : null, storage: net.tanks, grey: net.grey, pump: net.pumps,
      pressure: net.ptanks, source: net.wells, outlet: net.outlets, heater: net.heaters, drain: net.drains }[spec.category];
    if (list) list.push(p.id);
  }
  for (const p of pieces) {
    if (p.kind !== 'pipe' || !p.from || !p.to || !net.fx.has(p.from.piece) || !net.fx.has(p.to.piece)) continue;
    const spec = resolvePipe(p), d = spec.innerMm / 1000, od = spec.outerMm / 1000, L = Math.max(0.01, +p.lengthM || 1);
    const s = p.settings || {};
    const insulMm = +(p.insulationMm ?? s.insulationMm ?? 0), buriedDepthM = +(p.buriedDepthM ?? s.buriedDepthM ?? 0);
    const pipe = { id: p.id, from: p.from, to: p.to, L, d, od, C: spec.hazenC || 140, K: HW(spec.hazenC || 140, d) * L,
      volL: Math.PI * (d / 2) ** 2 * L * 1000, buriedDepthM, insulMm, indoor: !!(p.indoor ?? s.indoor), spec: spec.id };
    // heat path from the water to the air per unit film coefficient: bare wall resistance is negligible for plastic this thin
    const r1 = od / 2, r2 = r1 + insulMm / 1000;
    pipe.uaFor = (h) => L / (Math.log(r2 / r1) / (2 * Math.PI * INSUL_K) + 1 / (h * 2 * Math.PI * r2));
    net.pipes.push(pipe); net.pipeById.set(p.id, pipe);
    const add = (a, b) => { const k = a.piece + ':' + a.port; if (!net.ports.has(k)) net.ports.set(k, []); net.ports.get(k).push({ pipe, other: b }); };
    add(p.from, p.to); add(p.to, p.from);
  }
  for (const g of net.gutters) net.routes[g] = gutterRoute(net, g);
  net.empty = net.fx.size === 0;
  nets.set(pieces, net);
  return net;
}

// Rain from a gutter runs downhill through downpipes and first-flush diverters to the first tank inlet.
function gutterRoute(net, gid) {
  let pid = gid, port = 'out';
  const ffs = [], pipes = [];
  for (let guard = 0; guard < 8; guard++) {
    const links = net.ports.get(pid + ':' + port);
    if (!links || !links.length) return { ffs, tank: null, pipes };
    const ln = links[0], o = ln.other, f = net.fx.get(o.piece);
    pipes.push(ln.pipe.id);
    if (f.spec.category === 'catchment' && o.port === 'in') { if (f.spec.chamberL) ffs.push(o.piece); pid = o.piece; port = 'out'; continue; }
    if (f.spec.category === 'storage' && o.port === 'in') return { ffs, tank: o.piece, pipes };
    return { ffs, tank: null, pipes };
  }
  return { ffs, tank: null, pipes };
}

// Upstream from a consumer's port to the nearest source (a tank's outlet or a well), passing back
// through pumps, pressure tanks and heaters (out -> in). Breadth first, so the fewest pipes win.
function upstream(net, pid, port) {
  const key = pid + ':' + port;
  if (net.paths.has(key)) return net.paths.get(key);
  const seen = new Set([pid]);
  let frontier = [{ pid, port, pipes: [], devs: [] }], found = null;
  while (frontier.length && !found) {
    const next = [];
    for (const cur of frontier) {
      for (const ln of net.ports.get(cur.pid + ':' + cur.port) || []) {
        const o = ln.other, f = net.fx.get(o.piece);
        if (!f || seen.has(o.piece) || o.port !== 'out') continue;
        const pipes = [...cur.pipes, ln.pipe], cat = f.spec.category;
        if (cat === 'storage' || cat === 'source') { found = compilePath(net, o.piece, cat === 'source' ? 'well' : 'tank', pipes, cur.devs); break; }
        if (cat === 'pump' || cat === 'pressure' || cat === 'heater') { seen.add(o.piece); next.push({ pid: o.piece, port: 'in', pipes, devs: [...cur.devs, { id: o.piece, at: pipes.length }] }); }
      }
      if (found) break;
    }
    frontier = next;
  }
  net.paths.set(key, found);
  return found;
}
function compilePath(net, source, kind, pipes, devs) {
  const cat = (d) => net.fx.get(d.id).spec.category;
  const pumps = devs.filter((d) => cat(d) === 'pump').map((d) => d.id).reverse();   // source side first
  const pt = devs.find((d) => cat(d) === 'pressure' && devs.some((e) => cat(e) === 'pump' && e.at > d.at));
  const heater = devs.find((d) => cat(d) === 'heater');
  const K = pipes.reduce((a, p) => a + p.K, 0);
  return { source, kind, pipes, pumps, K, ptank: pt ? pt.id : null, ptPipes: pt ? pipes.slice(0, pt.at) : null,
    Kpt: pt ? pipes.slice(0, pt.at).reduce((a, p) => a + p.K, 0) : 0, heater: heater ? heater.id : null,
    heaterPipes: heater ? pipes.slice(heater.at) : null };
}

// ---------------------------------------------------------------------------------------- state
const zeroLedger = () => ({ collectedL: 0, wellL: 0, importedL: 0, usedL: 0, overflowL: 0, firstFlushL: 0, greyL: 0,
  heaterKWh: 0, propaneKg: 0, solarKWh: 0, pumpWh: 0 });
function fresh() {
  return { v: STATE_V, version: -1, empty: true,
    tanks: {}, catchments: {}, pumps: {}, taps: {}, wells: {}, heaters: {}, pressureTanks: {}, firstFlush: {}, pipes: {},
    greywater: { storedL: 0, toGroundL: 0, toSewerL: 0, tanks: {} }, diverters: {},
    ground: {}, draws: [], results: {}, issues: [], loadsSent: {}, frost: { indexCs: 0, depthM: 0 },
    today: { day: -1, collectedL: 0, usedL: 0, overflowL: 0 }, totals: zeroLedger(), nextDraw: 1, issuesDirty: false };
}
const tankHeight = (f) => f.spec.heightM;

function sync(s, site, ctx) {
  const net = netFor(site.pieces);
  s.version = site.version;
  s.empty = net.empty;
  const keep = (obj, ids, make) => {
    const out = {};
    for (const id of ids) out[id] = obj[id] || make(id);
    return out;
  };
  const F = (id) => net.fx.get(id);
  s.tanks = keep(s.tanks, net.tanks, (id) => ({ capacityL: F(id).spec.capacityL, storedL: 0, elevationM: F(id).p.y0 || 0, overflowL: 0,
    levelM: 0, surfaceM: F(id).p.y0 || 0, tempC: 10, iceL: 0, fillOn: false, overflowLmin: 0 }));
  for (const id of net.tanks) { const t = s.tanks[id]; t.elevationM = F(id).p.y0 || 0; t.capacityL = F(id).spec.capacityL; }
  s.greywater.tanks = keep(s.greywater.tanks, net.grey, (id) => ({ capacityL: F(id).spec.capacityL, storedL: 0, overflowL: 0 }));
  s.catchments = keep(s.catchments, net.gutters, () => ({ roofPieceId: null, areaM2: 0, efficiency: 0, inflowLmin: 0, roofSnowMm: 0, material: null }));
  const usedRoofs = new Set();
  for (const id of net.gutters) {
    const c = s.catchments[id], rid = (F(id).p.settings || {}).roofPieceId, roof = net.roofs.get(rid);
    c.roofPieceId = rid || null; c.duplicate = !!(roof && usedRoofs.has(rid));
    c.areaM2 = roof && !c.duplicate ? +roof.planArea || 0 : 0;
    c.material = roof ? roof.material : null; c.efficiency = roof ? runoffCoefficient(roof.material) : 0;
    if (roof) usedRoofs.add(rid);
  }
  s.firstFlush = keep(s.firstFlush, net.ffs, (id) => ({ capacityL: F(id).spec.chamberL, heldL: 0 }));
  s.pumps = keep(s.pumps, net.pumps, (id) => ({ on: false, ratedW: F(id).spec.ratedW, headM: 0, flowLmin: 0, wanted: false }));
  s.pressureTanks = keep(s.pressureTanks, net.ptanks, (id) => ({ storedL: 0, drawdownL: F(id).spec.drawdownL, pressureKPa: 0, refill: false }));
  s.wells = keep(s.wells, net.wells, (id) => {
    const sp = F(id).spec, st = F(id).p.settings || {};
    return { depthM: st.depthM ?? sp.depthM, staticLevelM: st.staticLevelM ?? sp.staticLevelM, yieldLmin: st.yieldLmin ?? sp.yieldLmin,
      levelM: st.staticLevelM ?? sp.staticLevelM, pumpDepthM: st.pumpDepthM ?? (st.depthM ?? sp.depthM) - (sp.depthM > 10 ? 3 : 0.5), pumpedLmin: 0, dry: false };
  });
  s.taps = keep(s.taps, net.outlets, () => ({ open: false, pressureKPa: 0, flowLmin: 0, served: false, tempC: null, why: null }));
  s.heaters = keep(s.heaters, net.heaters, (id) => ({ storedL: 0, tempC: 10, iceL: 0, on: false, outTempC: 10, heatW: 0 }));
  const pipeIds = net.pipes.map((p) => p.id);
  s.pipes = keep(s.pipes, pipeIds, () => ({ tempC: 10, iceL: 0, frozen: false, flowLmin: 0 }));
  // power: anything no longer installed is switched off
  for (const id of Object.keys(s.loadsSent)) {
    if (!net.fx.has(id)) { if (s.loadsSent[id].on && ctx.sim.handlers.has('electrical.setLoad')) ctx.sim.command('electrical.setLoad', { id, ratedW: 0, on: false, priority: 9 }); delete s.loadsSent[id]; }
  }
  s.issuesDirty = !net.empty;
}

// ---------------------------------------------------------------------------------------- the step
const NO_WEATHER = { tempC: 10, rainMmH: 0, snowMmH: 0, snowDepthM: 0, windMs: 0, groundTempC: 8, solar: { globalHorizontalWm2: 0 }, site: { climate: 'temperate' } };
const meanAnnual = new Map();
function groundwaterC(w) {
  const id = (w.site && w.site.climate) || 'temperate';
  if (!meanAnnual.has(id)) { const c = CLIMATES[id] || CLIMATES.temperate; meanAnnual.set(id, c.tempC.reduce((a, b) => a + b, 0) / 12); }
  return Math.max(4, meanAnnual.get(id));                 // deep groundwater sits near the mean annual air temperature
}

function step(ctx) {
  let s = ctx.s;
  if (!s || s.v !== STATE_V) ctx.s = s = fresh();
  const site = ctx.get('site');
  if (!site) return;
  if (site.version !== s.version) sync(s, site, ctx);
  if (s.empty) return;                                     // nothing installed: costs nothing
  const net = netFor(site.pieces), w = ctx.get('weather') || NO_WEATHER, dt = ctx.dt, minutes = dt / 60;
  const el = ctx.get('electrical'), hasEl = ctx.sim.handlers.has('electrical.setLoad');
  const T = s.totals, today = s.today, day = Math.floor(ctx.t / DAY);
  if (today.day !== day) { s.today = { day, collectedL: 0, usedL: 0, overflowL: 0, firstFlushL: 0, wellL: 0 }; }
  const R = { s, net, w, dt, minutes, hasEl, el, gwC: groundwaterC(w), wellAvail: {}, wellOut: {}, wellDry: {}, pipeFlow: {} };

  // frost depth from the surface freezing index (snow insulates the surface)
  const insul = clamp((w.snowDepthM || 0) / 0.3, 0, 1), surfC = w.tempC < 0 ? w.tempC * (1 - insul) : w.tempC;
  s.frost.indexCs = Math.max(0, s.frost.indexCs - surfC * dt);
  s.frost.depthM = frostDepthM(s.frost.indexCs);
  R.surfC = surfC;

  // which pumps can run this minute
  for (const id of net.pumps) {
    const pm = s.pumps[id], spec = net.fx.get(id).spec;
    if (!spec.ratedW) pm.on = true;                        // a hand pump runs whenever someone pumps it
    else { const ld = hasEl && el && el.loads && el.loads[id]; pm.on = !!(ld && ld.on && ld.served); if (pm.on) T.pumpWh += (spec.ratedW * dt) / 3600; }
    pm.wanted = false; pm.flowLmin = 0; pm.headM = 0;
  }
  for (const id of net.wells) {
    const wl = s.wells[id], A = wellLperM(net, id), smax = Math.max(0.01, wl.pumpDepthM - wl.staticLevelM), sd = wl.levelM - wl.staticLevelM;
    R.wellAvail[id] = Math.max(0, (wl.pumpDepthM - wl.levelM) * A + wl.yieldLmin * (sd / smax) * minutes);
    R.wellOut[id] = 0;
  }
  for (const id in s.pipes) s.pipes[id].flowLmin = 0;
  for (const id of net.tanks) s.tanks[id].overflowLmin = 0;

  // rain and melt off the roofs
  for (const id of net.gutters) catchStep(R, id);
  for (const id of net.ffs) { const f = s.firstFlush[id]; f.heldL = Math.max(0, f.heldL - (net.fx.get(id).spec.dripLh * dt) / 3600); }

  // consumers: outlets, then tanks filled by pump or gravity, pressure tanks, heaters
  serveDraws(R);
  for (const id of net.outlets) outletStep(R, id);
  for (const id of net.tanks) tankFillStep(R, id);
  for (const id of net.ptanks) ptankStep(R, id);
  for (const id of net.heaters) heaterStep(R, id);

  // wells: the bore refills from the aquifer (exact exponential for a constant pumping rate)
  for (const id of net.wells) {
    const wl = s.wells[id], A = wellLperM(net, id), smax = Math.max(0.01, wl.pumpDepthM - wl.staticLevelM);
    const q = R.wellOut[id] / minutes, k = wl.yieldLmin / (A * smax);       // per minute
    const sEq = (q * smax) / Math.max(1e-9, wl.yieldLmin), s0 = wl.levelM - wl.staticLevelM;
    wl.levelM = wl.staticLevelM + clamp(sEq + (s0 - sEq) * Math.exp(-k * minutes), 0, smax);
    wl.pumpedLmin = q; wl.dry = !!R.wellDry[id];
  }

  thermalStep(R);
  powerStep(R, ctx);
  for (const id of net.tanks) { const t = s.tanks[id], f = net.fx.get(id); t.levelM = (t.storedL / t.capacityL) * tankHeight(f); t.surfaceM = t.elevationM + t.levelM; }
  s.greywater.storedL = Object.values(s.greywater.tanks).reduce((a, g) => a + g.storedL, 0);
  if (s.issuesDirty || ctx.tick % 10 === 0) { s.issues = findIssues(R, ctx); s.issuesDirty = false; }
}

const wellLperM = (net, id) => Math.PI * (net.fx.get(id).spec.boreDiameterM / 2) ** 2 * 1000;
const ledger = (R, key, L) => { R.s.totals[key] += L; if (key in R.s.today) R.s.today[key] += L; };

// ------------------------------------------------------------------ catchment
function catchStep(R, id) {
  const { s, net, w, dt, minutes } = R, c = s.catchments[id];
  if (!c.areaM2) { c.inflowLmin = 0; return; }
  c.roofSnowMm += ((w.snowMmH || 0) * dt) / 3600;
  let melt = 0;
  if (c.roofSnowMm > 0 && w.tempC > 0) { melt = Math.min(c.roofSnowMm, DDF * w.tempC * dt); c.roofSnowMm -= melt; }
  const rainMm = ((w.rainMmH || 0) * dt) / 3600;
  let L = (rainMm + melt) * c.areaM2 * c.efficiency;
  c.inflowLmin = L / minutes;
  if (L <= 0) return;
  ledger(R, 'collectedL', L);
  const tIn = melt > 0 && rainMm === 0 ? 0.5 : Math.max(0.5, w.tempC);
  const route = net.routes[id];
  for (const ff of route.ffs) {
    const f = s.firstFlush[ff], take = Math.min(L, f.capacityL - f.heldL);
    if (take > 0) { f.heldL += take; L -= take; ledger(R, 'firstFlushL', take); toGround(R, ff, take, 'cleanL'); }
  }
  if (L <= 0) return;
  const tank = route.tank && s.tanks[route.tank];
  if (tank && eaveFeeds(net, id, route.tank, c)) addToTank(R, route.tank, L, tIn, 0);
  else { ledger(R, 'overflowL', L); toGround(R, id, L, 'cleanL'); }
}
// Rain only reaches a tank whose inlet is below the gutter.
function eaveFeeds(net, gid, tid) {
  const roof = net.roofs.get((net.fx.get(gid).p.settings || {}).roofPieceId), f = net.fx.get(tid);
  return (roof ? roof.eaveY ?? roof.y0 : Infinity) >= (f.p.y0 || 0) + f.spec.heightM - 0.05;
}

// ------------------------------------------------------------------ tanks and drains
function addToTank(R, id, L, tC, depth) {
  const { s, net } = R, t = s.tanks[id], room = Math.max(0, t.capacityL - t.storedL), take = Math.min(room, L);
  if (take > 0) { addLiquid(t, t.storedL, take, tC); t.storedL += take; }
  const over = L - take;
  if (over > 1e-12) {
    t.overflowL += over; t.overflowLmin += over / R.minutes;
    route(R, id, 'overflow', over, 'cleanL', depth + 1, tC, true);
  }
}
// Send water that has left a fixture through whatever is piped to `port`: another tank, a grey tank,
// a diverter, a mulch basin or soakaway; with nothing piped there it lands on the ground right there.
// `fresh`: the water is still part of the fresh-water ledger (a tank overflow), so leaving counts as overflow.
function route(R, pid, port, L, cls, depth = 0, tC = 10, fresh = false) {
  const { s, net } = R, links = net.ports.get(pid + ':' + port);
  const leaves = () => { if (fresh) ledger(R, 'overflowL', L); };
  if (!links || !links.length || depth > 6) {
    if (port === 'sewer') { s.greywater.toSewerL += L; leaves(); return; }
    leaves(); toGround(R, pid, L, cls); return;
  }
  const ln = links[0], o = ln.other, f = net.fx.get(o.piece);
  R.pipeFlow[ln.pipe.id] = (R.pipeFlow[ln.pipe.id] || 0) + L;
  if (f.spec.kind === 'diverter' && o.port === 'in') {
    const mode = (s.diverters[o.piece] && s.diverters[o.piece].mode) || (f.p.settings || {}).mode || 'garden';
    return route(R, o.piece, mode === 'sewer' ? 'sewer' : 'garden', L, cls, depth + 1, tC, fresh);
  }
  if (f.spec.kind === 'ground') { leaves(); toGround(R, o.piece, L, cls); return; }
  if (f.spec.category === 'grey' && o.port === 'in') {
    leaves();
    const g = s.greywater.tanks[o.piece], take = Math.min(L, g.capacityL - g.storedL);
    g.storedL += take;
    if (L - take > 0) { g.overflowL += L - take; route(R, o.piece, 'overflow', L - take, cls === 'cleanL' ? 'greyL' : cls, depth + 1); }
    return;
  }
  if (f.spec.category === 'storage' && o.port === 'in' && fresh) { addToTank(R, o.piece, L, tC, depth); return; }
  leaves(); toGround(R, pid, L, cls);
}
function toGround(R, pid, L, cls) {
  const g = R.s.ground[pid] || (R.s.ground[pid] = (() => { const p = R.net.fx.get(pid).p; return { x: p.a ? p.a.x : 0, z: p.a ? p.a.z : 0, cleanL: 0, greyL: 0, blackL: 0 }; })());
  g[cls] += L;
  if (cls !== 'cleanL') R.s.greywater.toGroundL += cls === 'greyL' ? L : 0;
}

// ------------------------------------------------------------------ sources
function sourceSurfaceM(R, path) {
  const { s, net } = R;
  if (path.kind === 'tank') { const t = s.tanks[path.source]; return t.elevationM + (t.storedL / t.capacityL) * net.fx.get(path.source).spec.heightM; }
  return (net.fx.get(path.source).p.y0 || 0) - s.wells[path.source].levelM;
}
function sourceAvailL(R, path) {
  if (path.kind === 'tank') { const t = R.s.tanks[path.source]; return Math.max(0, t.storedL - t.iceL); }
  return R.wellAvail[path.source];
}
function sourceTempC(R, path) { return path.kind === 'tank' ? liquidTemp(R.s.tanks[path.source]) : R.gwC; }
function withdraw(R, path, L) {
  if (L <= 0) return;
  if (path.kind === 'tank') { const t = R.s.tanks[path.source]; removeLiquid(t, t.storedL, L); t.storedL = Math.max(0, t.storedL - L); }
  else {
    R.wellAvail[path.source] -= L; R.wellOut[path.source] += L; ledger(R, 'wellL', L);
    if (R.wellAvail[path.source] <= 1e-6) R.wellDry[path.source] = true;     // took all the bore had
  }
}
// Pipes the water went through: record the flow and flush them with source water (moving water does not freeze).
function flowThrough(R, pipes, L, tC) {
  for (const p of pipes) {
    R.pipeFlow[p.id] = (R.pipeFlow[p.id] || 0) + L;
    const ps = R.s.pipes[p.id], f = Math.min(1, L / p.volL);
    if (f > 0) setE(ps, (1 - f) * enth(ps, p.volL) + f * p.volL * CW * Math.max(0, tC), p.volL);
  }
}

// Why a path cannot flow right now, or null. Also checks suction lift for a surface pump.
function blocked(R, path, pipes, usePumps) {
  const { s, net } = R;
  for (const p of pipes) if (s.pipes[p.id].frozen) return 'frozen';
  if (usePumps) {
    for (const id of path.pumps) if (!s.pumps[id].on) return net.fx.get(id).spec.ratedW ? 'unpowered' : 'pump';
    if (path.pumps.length) {
      const f = net.fx.get(path.pumps[0]);
      if (!f.spec.submersible && (f.p.y0 || 0) - sourceSurfaceM(R, path) > f.spec.maxSuctionM) return 'suction';
    }
  }
  if (path.kind === 'well' && R.wellAvail[path.source] <= 1e-6) { R.wellDry[path.source] = true; return 'dry'; }
  if (path.kind === 'tank' && sourceAvailL(R, path) <= 1e-6) return s.tanks[path.source].iceL > 0 ? 'iced' : 'empty';
  return null;
}

// The operating point: the flow at which the available head is all used.
function solveLmin(zs, zo, pumps, net, K, outSpec) {
  let cap = 400;
  for (const id of pumps) cap = Math.min(cap, net.fx.get(id).spec.maxLmin);
  const H = (q) => {
    let h = zs - zo - K * Math.pow(q / 60000, 1.852);
    for (const id of pumps) h += pumpHeadM(net.fx.get(id).spec, q);
    return outSpec ? h - outletHeadM(outSpec, q) : h;
  };
  if (H(1e-6) <= 0) return 0;
  if (H(cap) > 0) return cap;
  let lo = 0, hi = cap;
  for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (H(m) > 0) lo = m; else hi = m; }
  return lo;
}
function ptankHeadM(pt, spec) { return (spec.cutInKPa + ((spec.cutOutKPa - spec.cutInKPa) * pt.storedL) / spec.drawdownL) / KPA_PER_M; }

// What an outlet (or tank inlet) at elevation zo can get through `path` this minute:
// { lmin, pipes, from: 'path' | 'ptank', reason }.
function supply(R, path, zo, outSpec) {
  const { s, net } = R;
  const pumpsOk = path.pumps.every((id) => s.pumps[id].on);
  if (!path.ptank) for (const id of path.pumps) s.pumps[id].wantedBy = true;   // with a pressure tank its switch decides
  if (path.ptank && !pumpsOk) {
    const pt = s.pressureTanks[path.ptank], f = net.fx.get(path.ptank);
    if (pt.storedL <= 1e-6) return { lmin: 0, reason: blocked(R, path, path.pipes, true) || 'pump' };
    for (const p of path.ptPipes) if (s.pipes[p.id].frozen) return { lmin: 0, reason: 'frozen' };
    const q = solveLmin((f.p.y0 || 0) + ptankHeadM(pt, f.spec), zo, [], net, path.Kpt, outSpec);
    return { lmin: q, pipes: path.ptPipes, from: 'ptank', reason: q > 0 ? null : 'head' };
  }
  const why = blocked(R, path, path.pipes, true);
  if (why) return { lmin: 0, reason: why };
  const q = solveLmin(sourceSurfaceM(R, path), zo, path.pumps, net, path.K, outSpec);
  return { lmin: q, pipes: path.pipes, from: 'path', reason: q > 0 ? null : path.pumps.length ? 'head' : 'above' };
}
function noteFlow(R, path, lmin) {
  for (const id of path.pumps) { const pm = R.s.pumps[id]; pm.flowLmin += lmin; pm.headM = pumpHeadM(R.net.fx.get(id).spec, pm.flowLmin); }
}

// ------------------------------------------------------------------ outlets and draws
function serveDraws(R) {
  // draws not at an outlet: a bucket dipped into a tank
  const { s, net } = R;
  for (const d of s.draws) {
    if (d.done || net.outlets.includes(d.at)) continue;
    const tid = net.tanks.includes(d.at) ? d.at : net.tanks.find((id) => s.tanks[id].storedL - s.tanks[id].iceL > 1e-6);
    if (!tid) { finishDraw(s, d, 'There is no water stored to draw from.'); continue; }
    const t = s.tanks[tid], L = Math.min(d.litres - d.suppliedL, DIP_LMIN * R.minutes, Math.max(0, t.storedL - t.iceL));
    if (L > 0) { removeLiquid(t, t.storedL, L); t.storedL -= L; d.suppliedL += L; ledger(R, 'usedL', L); }
    if (d.suppliedL >= d.litres - 1e-9) finishDraw(s, d, null);
    else if (L <= 0 && ++d.waited >= 3) finishDraw(s, d, t.iceL > 0 ? 'The tank is frozen over.' : 'The tank is empty.');
  }
}
function finishDraw(s, d, reason) {
  d.done = true;
  const r = s.results[d.id];
  if (r) { r.suppliedL = d.suppliedL; r.done = true; r.reason = reason; }
  s.draws = s.draws.filter((x) => !x.done);
}
const REASON = {
  none: 'Nothing supplies this outlet with water.', above: 'The outlet is above the water level, so water will not flow to it without a pump.',
  unpowered: 'The pump that feeds this outlet has no power.', pump: 'The pump that feeds this outlet is not running.',
  frozen: 'A pipe feeding this outlet is frozen.', empty: 'The tank feeding this outlet is empty.', iced: 'The tank feeding this outlet is frozen over.',
  dry: 'The well is pumped dry for now.', suction: 'The pump sits too far above the water to lift it by suction.', head: 'The pump cannot push water that high.',
  dry_toilet: 'A composting toilet needs no water.',
};

function outletStep(R, id) {
  const { s, net, minutes } = R, o = s.taps[id], f = net.fx.get(id), spec = f.spec;
  const draws = s.draws.length ? s.draws.filter((d) => d.at === id && !d.done) : NONE;
  if (!spec.ports.length) {                                   // composting toilet
    o.flowLmin = 0; o.pressureKPa = 0; o.served = true; o.why = null;
    for (const d of draws) finishDraw(s, d, REASON.dry_toilet);
    return;
  }
  const cold = upstream(net, id, 'in'), hot = spec.ports.some((p) => p.id === 'hot') ? upstream(net, id, 'hot') : null;
  const path = cold || hot, zo = (f.p.y0 || 0) + (spec.outletHeightM || 0);
  o.flowLmin = 0;
  if (!path) { o.pressureKPa = 0; o.served = false; o.why = 'none'; for (const d of draws) finishDraw(s, d, REASON.none); return; }
  if (!o.open && !draws.length) {                             // closed: static pressure only
    let head = path.pumps.length ? 0 : sourceSurfaceM(R, path) - zo;
    if (path.ptank) { const pt = s.pressureTanks[path.ptank], pf = net.fx.get(path.ptank); if (pt.storedL > 0) head = (pf.p.y0 || 0) + ptankHeadM(pt, pf.spec) - zo; }
    o.pressureKPa = Math.max(0, head) * KPA_PER_M;
    const why = blocked(R, path, path.pipes, false);
    o.served = head > 0 && !why;
    o.why = head <= 0 ? (path.pumps.length ? null : 'above') : why;
    return;
  }
  const sup = supply(R, path, zo, spec);
  // hot and cold split for the temperature asked for
  const want = draws.length && draws[0].tempC != null ? draws[0].tempC : o.tempC ?? (hot ? spec.defaultTempC ?? null : null);
  const tc = sourceTempC(R, path);
  let hotFrac = 0, th = tc;
  if (hot && hot.heater && want != null) {
    th = heaterOutC(R, hot.heater, sup.lmin);
    hotFrac = !cold ? 1 : th > tc + 0.1 ? clamp((want - tc) / (th - tc), 0, 1) : 1;
  } else if (!cold) hotFrac = 1;
  let capL = sup.lmin * minutes;
  if (capL > 0) {
    const coldAvail = cold ? (sup.from === 'ptank' ? s.pressureTanks[cold.ptank].storedL : sourceAvailL(R, cold)) : 0;
    const hotAvail = hot && hot.heater ? heaterAvailL(R, hot) : 0;
    capL = Math.min(capL, hotFrac >= 1 ? hotAvail : hotFrac <= 0 ? coldAvail : Math.min(coldAvail / (1 - hotFrac), hotAvail / hotFrac));
  }
  // give the litres: draws first (in order), then an open tap runs to its drain
  let left = Math.max(0, capL), drained = 0;
  for (const d of draws) {
    const L = Math.min(left, d.litres - d.suppliedL);
    d.suppliedL += L; left -= L;
    if (spec.ports.some((p) => p.id === 'drain')) drained += L;
    if (d.suppliedL >= d.litres - 1e-9) finishDraw(s, d, null);
    else if (L <= 0 && ++d.waited >= 3) finishDraw(s, d, REASON[sup.reason] || REASON.none);
  }
  const openL = o.open ? left : 0;
  const usedL = capL - left + openL;
  drained += openL;
  if (usedL > 0) {
    const hotL = usedL * hotFrac, coldL = usedL - hotL;
    if (coldL > 0) {
      if (sup.from === 'ptank') { const pt = s.pressureTanks[cold.ptank]; pt.storedL -= coldL; flowThrough(R, cold.ptPipes, coldL, tc); }
      else { withdraw(R, cold, coldL); flowThrough(R, cold.pipes, coldL, tc); noteFlow(R, cold, coldL / minutes); }
    }
    if (hotL > 0) { takeHot(R, hot, hotL); flowThrough(R, hot.pipes.slice(0, hot.heaterPipes ? hot.pipes.length - hot.heaterPipes.length : hot.pipes.length), hotL, th); }
    ledger(R, 'usedL', usedL);
    const cls = spec.waste === 'black' ? 'blackL' : spec.id === 'tap_hose_bib' ? 'cleanL' : 'greyL';
    if (drained > 0) route(R, id, 'drain', drained, cls, 0, tc, false);
    if (drained > 0 && cls === 'greyL') ledger(R, 'greyL', drained);
  }
  o.flowLmin = usedL / minutes;
  o.pressureKPa = outletHeadM(spec, o.flowLmin) * KPA_PER_M;
  o.served = usedL > 0;
  const why = usedL > 0 ? null : sup.reason || 'none';
  if (why !== o.why) { o.why = why; s.issuesDirty = true; }
  o.tempC = o.tempC ?? null;
  o.outTempC = usedL > 0 ? tc + hotFrac * (th - tc) : null;
}

// ------------------------------------------------------------------ heaters
function heaterAvailL(R, hotPath) {
  const h = R.s.heaters[hotPath.heater], f = R.net.fx.get(hotPath.heater);
  if (f.spec.kind === 'tankless') {
    const up = upstream(R.net, hotPath.heater, 'in');
    return up ? sourceAvailL(R, up) : 0;
  }
  return Math.max(0, h.storedL - h.iceL);
}
function heaterOutC(R, id, lmin) {
  const h = R.s.heaters[id], f = R.net.fx.get(id), sp = f.spec;
  if (sp.kind !== 'tankless') return liquidTemp(h);
  const up = upstream(R.net, id, 'in'), tin = up ? sourceTempC(R, up) : 10;
  if (lmin < sp.minLmin) return tin;                          // below the ignition flow it never lights
  return Math.min(sp.setpointC, tin + (sp.efficiency * sp.inputW) / ((lmin / 60) * CW));
}
function takeHot(R, hotPath, L) {
  const { s, net } = R, id = hotPath.heater, h = s.heaters[id], sp = net.fx.get(id).spec, up = upstream(net, id, 'in');
  if (sp.kind === 'tankless') {
    if (!up) return;
    const tin = sourceTempC(R, up), tout = heaterOutC(R, id, (L / R.minutes));
    withdraw(R, up, L); flowThrough(R, up.pipes, L, tin); noteFlow(R, up, L / R.minutes);
    const J = L * CW * Math.max(0, tout - tin), fuelJ = J / sp.efficiency;
    s.totals.propaneKg += fuelJ / (sp.fuelMJkg * 1e6); s.totals.heaterKWh += J / 3.6e6;
    h.outTempC = tout; h.fuelKWh = (h.fuelKWh || 0) + fuelJ / 3.6e6;
    return;
  }
  // a storage heater gives hot water and takes the same litres of cold in from its supply
  removeLiquid(h, h.storedL, L); h.storedL -= L;
  refillHeater(R, id, L);
}
function refillHeater(R, id, wantL) {
  const { s, net } = R, h = s.heaters[id], up = upstream(net, id, 'in');
  if (!up || wantL <= 0) return 0;
  if (blocked(R, up, up.pipes, true)) { for (const pid of up.pumps) s.pumps[pid].wantedBy = true; return 0; }
  const f = net.fx.get(id), zo = (f.p.y0 || 0) + (f.spec.dims.h || 0);
  if (!up.pumps.length && sourceSurfaceM(R, up) <= zo && !up.ptank) return 0;
  const L = Math.min(wantL, sourceAvailL(R, up)), tin = sourceTempC(R, up);
  if (L <= 0) return 0;
  withdraw(R, up, L); flowThrough(R, up.pipes, L, tin); noteFlow(R, up, L / R.minutes);
  addLiquid(h, h.storedL, L, tin); h.storedL += L;
  return L;
}
function heaterStep(R, id) {
  const { s, net, dt, w } = R, h = s.heaters[id], f = net.fx.get(id), sp = f.spec, st = f.p.settings || {};
  if (sp.kind === 'tankless') { h.on = false; h.heatW = 0; return; }
  if (h.storedL < sp.volumeL - 1e-6) refillHeater(R, id, Math.min(sp.volumeL - h.storedL, 20 * R.minutes));
  h.heatW = 0;
  if (sp.kind === 'tank') {
    const set = st.setpointC ?? sp.setpointC, t = liquidTemp(h);
    h.wantOn = h.storedL > 0.5 * sp.volumeL && (t < set - sp.deadbandC || (h.wantOn && t < set));
    const ld = R.hasEl && R.el && R.el.loads && R.el.loads[id];
    h.on = !!(ld && ld.on && ld.served);
    if (h.on) { h.heatW = sp.ratedW; s.totals.heaterKWh += (sp.ratedW * dt) / 3.6e6; }
  } else if (sp.kind === 'solar') {
    h.heatW = sp.opticalEff * sp.apertureM2 * ((w.solar && w.solar.globalHorizontalWm2) || 0);
    s.totals.solarKWh += (h.heatW * dt) / 3.6e6;
  }
}

// ------------------------------------------------------------------ tanks filled by pumps or gravity, pressure tanks
function tankFillStep(R, id) {
  const { s, net, minutes } = R, t = s.tanks[id], up = upstream(net, id, 'in');
  if (!up || up.source === id) return;
  const st = net.fx.get(id).p.settings || {}, start = st.fillStartFrac ?? 0.7;
  if (t.storedL < start * t.capacityL) t.fillOn = true;
  if (t.storedL >= 0.98 * t.capacityL) t.fillOn = false;
  if (!t.fillOn) return;
  const f = net.fx.get(id), zo = (f.p.y0 || 0) + f.spec.heightM;          // free discharge at the top inlet
  const sup = supply(R, up, zo, null);
  if (sup.lmin <= 0) { t.fillWhy = sup.reason; return; }
  t.fillWhy = null;
  const L = Math.min(sup.lmin * minutes, t.capacityL - t.storedL, sourceAvailL(R, up)), tin = sourceTempC(R, up);
  if (L <= 0) return;
  withdraw(R, up, L); flowThrough(R, up.pipes, L, tin); noteFlow(R, up, L / minutes);
  addToTank(R, id, L, tin, 0);
}
function ptankStep(R, id) {
  const { s, net, minutes } = R, pt = s.pressureTanks[id], f = net.fx.get(id), up = upstream(net, id, 'in');
  if (!up) return;
  if (pt.storedL <= 0.05 * pt.drawdownL) pt.refill = true;
  if (pt.storedL >= pt.drawdownL - 1e-6) pt.refill = false;
  pt.pressureKPa = pt.storedL > 0 ? ptankHeadM(pt, f.spec) * KPA_PER_M : 0;
  if (!pt.refill) return;
  for (const pid of up.pumps) s.pumps[pid].wantedBy = true;
  const why = blocked(R, up, up.pipes, true);
  if (why) return;
  // the pump pushes against the tank's present pressure; it stops at cut-out, or where the pump can push no harder
  const q = solveLmin(sourceSurfaceM(R, up), (f.p.y0 || 0) + ptankHeadM(pt, f.spec), up.pumps, net, up.K, null);
  const qMax = up.pumps.reduce((a, id) => Math.min(a, net.fx.get(id).spec.maxLmin), Infinity);
  if (q <= 0.05 * qMax) { pt.refill = false; return; }        // the switch cuts out as the pump nears its limit
  const L = Math.min(q * minutes, pt.drawdownL - pt.storedL, sourceAvailL(R, up)), tin = sourceTempC(R, up);
  if (L <= 0) return;
  withdraw(R, up, L); flowThrough(R, up.pipes, L, tin); noteFlow(R, up, L / minutes);
  pt.storedL += L;
}

// ------------------------------------------------------------------ heat: tanks, pipes, heaters
function boxAreaM2(d) { return 2 * (d.w * d.d + d.w * d.h + d.d * d.h); }
function envFor(R, settings) {
  const { w, s } = R, st = settings || {};
  if (st.indoor) return { env: INDOOR_C, buried: false };
  const d = +(st.buriedDepthM || 0);
  if (d > 0) {
    const X = s.frost.depthM;
    return { env: d >= X ? Math.max(0.5, w.groundTempC) : R.surfC < 0 ? R.surfC * (1 - d / X) : 0, buried: true };
  }
  return { env: w.tempC, buried: false };
}
function thermalStep(R) {
  const { s, net, w, dt } = R, h = filmCoefficient(w.windMs);
  for (const id of net.tanks) {
    const t = s.tanks[id], f = net.fx.get(id), st = f.p.settings || {};
    if (t.storedL <= 1e-6) { t.tempC = w.tempC; t.iceL = 0; continue; }
    const e = envFor(R, st), A = boxAreaM2(f.spec.dims), ins = +(st.insulationMm || 0) / 1000;
    const UA = e.buried ? (t.storedL * CW) / BURIED_TAU : A / (1 / h + ins / INSUL_K);
    relax(t, t.storedL, UA, e.env, dt);
  }
  for (const p of net.pipes) {
    const ps = s.pipes[p.id];
    ps.flowLmin = (R.pipeFlow[p.id] || 0) / R.minutes;
    const e = p.indoor ? { env: INDOOR_C, buried: false } : envFor(R, { buriedDepthM: p.buriedDepthM });
    relax(ps, p.volL, e.buried ? (p.volL * CW) / BURIED_TAU : p.uaFor(h), e.env, dt);
    const fr = ps.iceL >= 0.5 * p.volL;
    if (fr !== ps.frozen) { ps.frozen = fr; s.issuesDirty = true; }
  }
  for (const id of net.heaters) {
    const hs = s.heaters[id], f = net.fx.get(id), sp = f.spec, st = f.p.settings || {};
    if (sp.kind === 'tankless' || hs.storedL <= 1e-6) continue;
    const env = sp.kind === 'solar' || st.indoor === false ? w.tempC : INDOOR_C;
    relax(hs, hs.storedL, sp.kind === 'solar' ? sp.uaWK : sp.uaWK, env, dt, hs.heatW * dt);
    hs.outTempC = liquidTemp(hs);
  }
}

// ------------------------------------------------------------------ power
function powerStep(R, ctx) {
  const { s, net, hasEl } = R;
  for (const id of net.pumps) { const pm = s.pumps[id]; pm.wanted = !!pm.wantedBy; pm.wantedBy = false; if (!pm.on) pm.flowLmin = 0; }
  if (!hasEl) return;
  const send = (id, ratedW, on, priority) => {
    const prev = s.loadsSent[id];
    if (prev && prev.on === on && prev.ratedW === ratedW) return;
    s.loadsSent[id] = { on, ratedW };
    ctx.sim.command('electrical.setLoad', { id, ratedW, on, priority });
  };
  for (const id of net.pumps) { const sp = net.fx.get(id).spec; if (sp.ratedW) send(id, sp.ratedW, s.pumps[id].wanted, 2); }
  for (const id of net.heaters) { const sp = net.fx.get(id).spec; if (sp.kind === 'tank') send(id, sp.ratedW, !!s.heaters[id].wantOn, 5); }
}

// ------------------------------------------------------------------ issues
function hoursToFreeze(tempC, iceL, m, UA, airC) {
  if (airC >= 0 || UA <= 0) return Infinity;
  const tau = (m * CW) / UA, cool = tempC > 0 ? tau * Math.log((tempC - airC) / -airC) : 0;
  const latent = (Math.max(0, 0.5 * m - iceL) * LF) / (UA * -airC);
  return (cool + latent) / 3600;
}
function findIssues(R, ctx) {
  const { s, net, w } = R, out = [], hr = hourOfDay(ctx.t), h = filmCoefficient(w.windMs), X = s.frost.depthM;
  const add = (pieceId, severity, reason, fix) => out.push({ pieceId, severity, reason, fix });
  const frostText = X > 0.05 ? X.toFixed(1) + ' m' : 'the frost line';
  for (const id of net.gutters) {
    const c = s.catchments[id], rt = net.routes[id];
    if (!c.roofPieceId || !net.roofs.get(c.roofPieceId)) add(id, 'problem', 'This gutter is not fixed to a roof, so it catches nothing.', 'Attach it to a roof plane.');
    else if (c.duplicate) add(id, 'info', 'Another gutter already drains this roof plane.', 'Move this gutter to a different roof plane.');
    else if (!rt.tank) add(id, 'warning', 'Rain from this gutter runs onto the ground.', 'Pipe its downpipe to a tank inlet.');
    else if (!eaveFeeds(net, id, rt.tank)) add(id, 'warning', 'The tank inlet is higher than the gutter, so rain cannot run into it.', 'Set the tank lower than the eave.');
    if (c.material === 'thatch') add(id, 'info', 'Thatch sheds only about half the rain and stains it brown with tannins: fine for the garden, poor for drinking.', 'Use a metal, slate or tile roof for drinking water, or filter and boil it.');
    if (rt.tank && !rt.ffs.length && c.areaM2 > 0) add(id, 'info', 'Without a first-flush diverter the first dirty water off the roof goes into the tank.', 'Fit a first-flush diverter on the downpipe.');
  }
  for (const id of net.tanks) {
    const t = s.tanks[id];
    if (t.overflowLmin > 0) add(id, 'info', 'This tank is full and overflowing.', 'Add another tank, or pipe the overflow to the garden.');
    if (t.iceL > 0.05 * t.capacityL) add(id, 'warning', 'This tank is freezing: ' + Math.round(t.iceL) + ' L is ice.', 'Insulate the tank, bury it, or move it indoors.');
    else if (t.storedL > 0 && !(net.fx.get(id).p.settings || {}).indoor) {
      const f = net.fx.get(id), hrs = hoursToFreeze(t.tempC, t.iceL, t.storedL, boxAreaM2(f.spec.dims) / (1 / h + (+((f.p.settings || {}).insulationMm || 0) / 1000) / INSUL_K), w.tempC);
      if (hrs < 12) add(id, 'warning', 'This tank will start to freeze within ' + Math.max(1, Math.round(hrs)) + ' hours at this temperature.', 'Insulate it or move it somewhere sheltered.');
    }
  }
  for (const p of net.pipes) {
    const ps = s.pipes[p.id];
    if (ps.frozen) { add(p.id, 'problem', 'This pipe is frozen; nothing flows through it until it thaws.', 'Bury it deeper than ' + frostText + ', insulate it, or drain it before cold nights.'); continue; }
    if (p.indoor || p.buriedDepthM >= X && p.buriedDepthM > 0) continue;
    if (p.buriedDepthM > 0) { add(p.id, 'warning', 'This pipe is buried above the frost line (' + frostText + ' here) and may freeze.', 'Bury it deeper than ' + frostText + '.'); continue; }
    const UA = p.uaFor(h), now = hoursToFreeze(ps.tempC, ps.iceL, p.volL, UA, w.tempC);
    // forecast-free rule: in the afternoon and evening assume the night falls about 6 C below now
    const evening = hr >= 15 && hr < 23, low = evening ? w.tempC - 6 : w.tempC;
    const night = evening ? hoursToFreeze(ps.tempC, ps.iceL, p.volL, UA, low) : Infinity;
    if (now < 12) add(p.id, 'warning', (hr >= 15 || hr < 6 ? 'This pipe will freeze tonight' : 'This pipe will freeze within ' + Math.max(1, Math.round(now)) + ' hours') + ' at ' + Math.round(w.tempC) + ' C.', 'Drain it, insulate it, or bury it deeper than ' + frostText + '.');
    else if (night < 10) add(p.id, 'warning', 'This pipe will freeze tonight if the night is clear and cold.', 'Drain it, insulate it, or bury it.');
  }
  for (const id of net.outlets) {
    const o = s.taps[id];
    if (o.why && o.why !== 'dry_toilet') add(id, o.why === 'none' || o.why === 'above' || o.why === 'unpowered' ? 'problem' : 'warning', REASON[o.why] || REASON.none,
      { none: 'Pipe it to a tank or a pump.', above: 'Raise the tank above the outlet, or add a pump.', unpowered: R.hasEl ? 'Wire the pump to a battery, panel or generator.' : 'Nothing supplies electricity yet: use a hand pump or a gravity tank.',
        pump: 'Check the pump.', frozen: 'Wait for a thaw, then bury or insulate the pipe.', empty: 'Wait for rain or fill the tank.', iced: 'Wait for a thaw; insulate the tank.',
        dry: 'Draw less at a time; the well refills at its yield.', suction: 'Use a submersible pump, or set the pump closer to the water.', head: 'Use a stronger pump or lower the outlet.' }[o.why] || 'Check the connections.');
  }
  for (const id of net.pumps) {
    const sp = net.fx.get(id).spec, pm = s.pumps[id];
    if (sp.ratedW && pm.wanted && !pm.on) add(id, 'problem', R.hasEl ? 'This pump has no power.' : 'Nothing supplies electricity yet, so this pump cannot run.', R.hasEl ? 'Wire it to a battery, panel or generator.' : 'Use a hand pump or a gravity tank until there is power.');
  }
  for (const id of net.wells) {
    const wl = s.wells[id];
    if (wl.dry) add(id, 'warning', 'The well is pumped dry; it refills at about ' + wl.yieldLmin + ' L/min.', 'Pump less at a time, or store water in a tank.');
  }
  for (const id of net.heaters) {
    const sp = net.fx.get(id).spec, hs = s.heaters[id];
    if (sp.kind === 'tank' && hs.wantOn && !hs.on) add(id, 'warning', R.hasEl ? 'The water heater has no power.' : 'Nothing supplies electricity yet, so the water heater stays cold.', 'Wire it to a supply that can carry ' + sp.ratedW + ' W.');
    if (hs.iceL > 0) add(id, 'problem', 'The water in this heater is freezing.', 'Drain it for the winter or move it indoors.');
  }
  return out;
}

// ---------------------------------------------------------------------------------------- commands
// Commands can arrive right after the site changes (and while paused): bring the network up to date first.
function ensure(ctx) {
  if (!ctx.s || ctx.s.v !== STATE_V) ctx.s = fresh();
  const site = ctx.get('site');
  if (site && site.version !== ctx.s.version) sync(ctx.s, site, ctx);
  return ctx.s;
}
function draw(ctx, p = {}) {
  const s = ensure(ctx);
  const litres = +p.litres;
  if (!(litres > 0)) throw new Error('water.draw needs litres > 0');
  const id = p.id != null ? String(p.id) : 'draw' + s.nextDraw++;
  const at = p.at != null ? String(p.at) : id;
  s.draws.push({ id, at, litres, tempC: p.tempC ?? null, suppliedL: 0, waited: 0, done: false });
  if (s.results[id]) delete s.results[id];
  s.results[id] = { requestedL: litres, suppliedL: 0, done: false, reason: null, at, t: ctx.t };
  const keys = Object.keys(s.results);
  for (let i = 0; keys.length - i > MAX_RESULTS && i < keys.length; i++) if (s.results[keys[i]].done) delete s.results[keys[i]];
  return id;
}
function setTap(ctx, p = {}) {
  const o = ensure(ctx).taps[p.id];
  if (!o) throw new Error('no water outlet ' + p.id);
  o.open = !!p.open;
  if (p.tempC !== undefined) o.tempC = p.tempC;
}
function setDiverter(ctx, p = {}) {
  if (p.mode !== 'garden' && p.mode !== 'sewer') throw new Error('diverter mode is garden or sewer');
  ensure(ctx).diverters[p.id] = { mode: p.mode };
}
// Fill a tank from outside the homestead (a hose in town, a delivery): counted as imported.
function fillTank(ctx, p = {}) {
  const t = ensure(ctx).tanks[p.id];
  if (!t) throw new Error('no tank ' + p.id);
  const L = Math.min(Math.max(0, +p.litres || 0), t.capacityL - t.storedL);
  addLiquid(t, t.storedL, L, p.tempC ?? 12); t.storedL += L;
  ctx.s.totals.importedL += L;
  return L;
}
function emptyGrey(ctx, p = {}) {
  const g = ensure(ctx).greywater.tanks[p.id];
  if (!g) throw new Error('no grey tank ' + p.id);
  ctx.s.greywater.toSewerL += g.storedL; g.storedL = 0;
}

export const water = {
  name: 'water',
  every: 1,
  init: () => fresh(),
  step,
  commands: { 'water.draw': draw, 'water.setTap': setTap, 'water.setDiverter': setDiverter, 'water.fillTank': fillTank, 'water.emptyGrey': emptyGrey },
};

// ---------------------------------------------------------------------------------------- read-outs
export function freshStoredL(state) {
  let L = 0;
  for (const id in state.tanks) L += state.tanks[id].storedL;
  for (const id in state.heaters) L += state.heaters[id].storedL;
  for (const id in state.pressureTanks) L += state.pressureTanks[id].storedL;
  return L;
}
// Plain data for the water-network overlay (src/overlays.js draws it).
export function overlayData(state) {
  if (!state || state.empty) return { tanks: [], pipes: [], taps: [], pumps: [], catchments: [], wells: [] };
  const map = (o, f) => Object.entries(o).map(([id, v]) => ({ id, ...f(v) }));
  return {
    tanks: map(state.tanks, (t) => ({ storedL: t.storedL, capacityL: t.capacityL, fraction: t.capacityL ? t.storedL / t.capacityL : 0, surfaceM: t.surfaceM, tempC: t.tempC, iceL: t.iceL })),
    pipes: map(state.pipes, (p) => ({ flowLmin: p.flowLmin, frozen: p.frozen, tempC: p.tempC })),
    taps: map(state.taps, (o) => ({ open: o.open, pressureKPa: o.pressureKPa, flowLmin: o.flowLmin, served: o.served })),
    pumps: map(state.pumps, (p) => ({ on: p.on, flowLmin: p.flowLmin, headM: p.headM, pressureKPa: p.headM * KPA_PER_M })),
    catchments: map(state.catchments, (c) => ({ roofPieceId: c.roofPieceId, inflowLmin: c.inflowLmin, areaM2: c.areaM2 })),
    wells: map(state.wells, (w) => ({ levelM: w.levelM, yieldLmin: w.yieldLmin, dry: w.dry })),
    greywater: { storedL: state.greywater.storedL },
    frostDepthM: state.frost.depthM,
  };
}
