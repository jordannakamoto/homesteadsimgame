// Heat: the temperature of every room, from what the building is actually made of.
//
// Each enclosed room (rooms.js) is two temperatures: its air (with furnishings) and the thermal mass of
// the inner part of its walls, floor and roof. The model, with the source family of each part:
//
//   Conduction   every assembly's resistance is the sum of thickness / conductivity over its layers plus
//                surface films (ISO 6946: Rsi 0.13 / 0.10 / 0.17 by heat-flow direction; outside film from
//                wind, h = 4 + 4 v plus radiation, which is 0.04 at 4 m/s). An air layer is a cavity
//                resistance from the ISO 6946 table, not conduction through still air. Glazing units use
//                their EN 673 U-value. Thermal bridging by studs and joists is NOT modelled yet (a real
//                framed wall loses 10 to 25 % more than its clear-bay value).
//   Thermal mass only the inner part of an assembly follows the room on a daily cycle (ISO 13786): layers
//                are counted inward until an insulating layer or cavity, half the thickness, or the daily
//                penetration depth sqrt(lambda T / pi rho c) / sqrt 2 is used up. The rest is conduction path.
//                The room's surfaces are lumped into one mass node the way the ISO 13790 simple hourly
//                method does it (H_em = 1 / (1/H_op - 1/H_ms)), so the steady state is exactly sum(U A).
//   Ground       ISO 13370: slab-on-ground and basement U-values from the floor's area, exposed perimeter
//                and depth (edge and under-floor paths together), against weather.groundTempC, whose lag
//                stands in for the standard's periodic terms.
//   Air leakage  ASHRAE Fundamentals (residential infiltration), the LBL / Sherman-Grimsrud model:
//                Q = A_L sqrt(Cs dT + Cw v^2), with the leakage area A_L summed from each surface's
//                construction (boards leak, sheathing leaks less, housewrap or masonry least) and its
//                doors and windows.
//   Sun          through glazing: direct normal times the true cosine of incidence on that window, an
//                incidence-angle modifier, isotropic sky and ground-reflected diffuse (Liu and Jordan),
//                times the glazing's solar heat gain coefficient (EN 410 / ASHRAE typical values).
//                On opaque surfaces: sol-air temperature (ASHRAE), including long-wave loss to a clear
//                sky (63 W/m2 on a horizontal surface, fading with cloud and tilt).
//   Gains        thermal.setGain({ roomId, source, watts, heating?, radiant? }): people, stoves, appliances.
//                The radiant share and the sun through the glass land on the room's surfaces, so a little of
//                them is conducted away without warming the air (air temperature is below operative).
//   Moisture     the room's vapour content follows the outside air through infiltration (no sources,
//                storage or condensation yet: the next iteration adds them).
//
// Numerics: backward Euler on the linear heat balance, the mass node eliminated by hand and rooms that
// share a wall solved together. Unconditionally stable at the 5-minute step for any room, exact at
// steady state, and energy-conserving step by step: stored energy changes by exactly dt x (gains - lossW).
// Not modelled: shading by eaves and neighbours, snow lying on roofs, frames around glazing, moisture
// storage, room-to-room air movement, depth-dependent ground temperature.

import { material } from './materials.js';
import { sunPosition } from './calendar.js';
import { saturationVapourHPa, dewPointFrom } from './weather.js';
import { findRooms } from './rooms.js';

const EVERY = 5, STATE_V = 1;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);

// ---------------------------------------------------------------------------------------- assemblies
export const RSI = Object.freeze({ horizontal: 0.13, up: 0.10, down: 0.17 });   // m2K/W, ISO 6946
export const RSE_STANDARD = 0.04;                                               // m2K/W, ISO 6946 design value
const H_RAD_OUT = 4.14;                    // W/m2K: 0.9 x 4 sigma T^3 at 0 C (ISO 6946 annex)
// Outside surface resistance at a wind speed (ISO 6946 annex: h_c = 4 + 4 v). No wind given: the design value.
export const rse = (windMs) => (Number.isFinite(windMs) ? 1 / (4 + 4 * Math.max(0, windMs) + H_RAD_OUT) : RSE_STANDARD);
// Unventilated air layers, ISO 6946 table (high-emissivity surfaces), m2K/W by thickness in mm.
const CAVITY_MM = [0, 5, 7, 10, 15, 25, 50, 100, 300];
const CAVITY_R = { up: [0, 0.11, 0.13, 0.15, 0.16, 0.16, 0.16, 0.16, 0.16], horizontal: [0, 0.11, 0.13, 0.15, 0.17, 0.18, 0.18, 0.18, 0.18], down: [0, 0.11, 0.13, 0.15, 0.17, 0.19, 0.21, 0.22, 0.23] };
export function cavityR(thicknessM, flow = 'horizontal') {
  const mm = thicknessM * 1000, T = CAVITY_R[flow] || CAVITY_R.horizontal;
  if (mm >= 300) return T[8];
  let i = 0; while (mm > CAVITY_MM[i + 1]) i++;
  return T[i] + ((T[i + 1] - T[i]) * (mm - CAVITY_MM[i])) / (CAVITY_MM[i + 1] - CAVITY_MM[i]);
}
const GLAZING_FILMS = RSI.horizontal + RSE_STANDARD;   // an EN 673 U-value already contains these
const isAir = (m) => m.id === 'air';

// Surface-to-surface thermal resistance of an assembly, m2K/W. layers: [{ material, thickness }] as pieces
// carry them. An air layer at either face is open to the room or the weather and counts for nothing, unless
// that face is closed off (outerClosed: a joist bay over a plinth).
export function assemblyR(layers, { flow = 'horizontal', outerClosed = false, innerClosed = false } = {}) {
  if (!Array.isArray(layers)) return 0;
  let r = 0; const n = layers.length;
  for (let i = 0; i < n; i++) {
    const l = layers[i], m = l && material(l.material), d = l ? +l.thickness : 0;
    if (!m) continue;
    if (m.uValueWm2K) { r += Math.max(0, 1 / m.uValueWm2K - GLAZING_FILMS); continue; }
    if (!(d > 0)) continue;
    if (isAir(m)) { if ((i === 0 && !outerClosed) || (i === n - 1 && !innerClosed)) continue; r += cavityR(d, flow); continue; }
    r += d / m.conductivityWmK;
  }
  return r;
}
// Thermal transmittance, W/m2K, air to air. windMs sets the outside film; leave it out for the design value.
export function uValue(layers, { windMs, flow = 'horizontal', outerClosed = false } = {}) {
  return 1 / ((RSI[flow] || RSI.horizontal) + assemblyR(layers, { flow, outerClosed }) + rse(windMs));
}

// The part of an assembly that stores heat for the room on a daily cycle (ISO 13786). layers run from the
// far side to the room. Returns its heat capacity per square metre and the resistance from the room-side
// surface to the middle of that stored heat.
const DAY_S = 86400, INSULATING_WMK = 0.065;
export function innerMass(layers, { soilBehind = false } = {}) {
  let total = 0;
  if (Array.isArray(layers)) for (const l of layers) if (l && l.thickness > 0 && material(l.material)) total += l.thickness;
  const cap = soilBehind ? Infinity : total / 2;
  let budget = 1, depth = 0, kappa = 0, rPos = 0, cr = 0, stopped = false;
  const take = (m, d) => {
    const lam = m.conductivityWmK, rc = m.densityKgM3 * m.specificHeatJkgK, dEff = Math.sqrt((lam * DAY_S) / (Math.PI * rc)) / Math.SQRT2;
    const use = Math.min(d, budget * dEff, cap - depth);
    if (!(use > 0)) return false;
    kappa += rc * use; cr += rc * use * (rPos + use / (2 * lam));
    rPos += d / lam; depth += use; budget -= use / dEff;
    return use >= d - 1e-9;
  };
  if (Array.isArray(layers)) for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i], m = l && material(l.material);
    if (!m || !(l.thickness > 0)) continue;
    if (isAir(m) || m.uValueWm2K || m.class === 'insulation' || m.conductivityWmK <= INSULATING_WMK) { stopped = true; break; }
    if (!take(m, l.thickness)) { stopped = true; break; }
  }
  if (soilBehind && !stopped && budget > 0) take(SOIL, 1);
  return { capacityJm2K: kappa, resistanceM2KW: kappa > 0 ? cr / kappa : 0 };
}

// ---------------------------------------------------------------------------------------- ground (ISO 13370)
const SOIL = material('soil_moist');           // clay or silt, 1.5 W/mK: the standard's default ground
// U-value of a floor on or in the ground, W/m2K. floorR: the floor's own resistance; depthM: floor below ground level.
export function groundFloorU({ areaM2, perimeterM, wallThicknessM = 0.2, floorR = 0, depthM = 0, lambda = SOIL.conductivityWmK }) {
  const B = perimeterM > 0.01 ? Math.min(100, areaM2 / (0.5 * perimeterM)) : 100;
  const d = wallThicknessM + lambda * (RSI.down + floorR + RSE_STANDARD) + 0.5 * Math.max(0, depthM);
  return d < B ? ((2 * lambda) / (Math.PI * B + d)) * Math.log((Math.PI * B) / d + 1) : lambda / (0.457 * B + d);
}
// U-value of a wall against the ground down to depthM, W/m2K. floorDtM: the floor's equivalent thickness, if known.
export function groundWallU({ depthM, wallR = 0, floorDtM, lambda = SOIL.conductivityWmK }) {
  const z = Math.max(0.1, depthM), dw = lambda * (RSI.horizontal + wallR + RSE_STANDARD), dt = Math.min(num(floorDtM, dw), dw);
  return ((2 * lambda) / (Math.PI * z)) * (1 + (0.5 * dt) / (dt + z)) * Math.log(z / dw + 1);
}

// ---------------------------------------------------------------------------------------- air leakage
// Effective leakage area at 4 Pa per square metre of surface, cm2/m2, by how the surface is built. Mid-range
// picks in the spirit of the ASHRAE Fundamentals component leakage table (continuous air barrier 0.15,
// rigid sheathing 0.35, finished brick 0.7, general ceilings 1.8, floors over crawl spaces 2.2); the
// unsealed-board and thatch figures are estimates for traditional construction. approx: true.
export const LEAK_CM2_M2 = Object.freeze({ wrapped: 0.3, masonry: 0.7, sheathed: 1.2, glazed: 1.5, log: 2, boards: 3.2, thatch: 3, fabric: 5, other: 2 });
const SHEETS = { plywood: 1, osb: 1, gypsum_board: 1 };
export function leakageClass(layers) {
  let wood = 0, sheet = false, stone = false, cls = '';
  for (const l of layers || []) {
    const m = l && material(l.material); if (!m || !(l.thickness > 0)) continue;
    if (m.class === 'membrane' || m.id === 'epdm') return 'wrapped';
    if (SHEETS[m.id] || m.class === 'metal' || m.id === 'steel_roofing') sheet = true;
    else if ((m.class === 'masonry' || m.class === 'earth') && l.thickness >= 0.015) stone = true;
    else if (m.class === 'wood') wood = Math.max(wood, l.thickness);
    cls = cls || m.class; if (m.id === 'thatch') cls = 'thatch';
  }
  if (stone) return 'masonry';
  if (sheet) return 'sheathed';
  if (wood >= 0.09) return 'log';
  if (wood > 0) return 'boards';
  return cls === 'thatch' ? 'thatch' : cls === 'fabric' ? 'fabric' : cls === 'glass' ? 'glazed' : 'other';
}
const DOOR_LEAK_CM2 = 21;          // one door, not weatherstripped (ASHRAE component table)
const WINDOW_LEAK_CM2_M = 2.5;     // per metre of sash perimeter, not weatherstripped
const HOLE_CD = 0.6;               // discharge coefficient of a plain hole
// LBL model coefficients for one storey (2.5 m), shelter class 3 (some trees, sheds or fences nearby).
const LBL_CS = 0.000145;           // (L/s)^2 / (cm^4 K): stack; proportional to height
const LBL_CW = 0.000174;           // (L/s)^2 / (cm^4 (m/s)^2): wind; goes with height^0.4
export function infiltrationLs(leakageCm2, dTK, windMs, heightM = 2.5) {
  const h = Math.max(heightM, 1) / 2.5;
  return leakageCm2 * Math.sqrt(LBL_CS * h * Math.abs(dTK) + LBL_CW * Math.pow(h, 0.4) * windMs * windMs);
}
const AIR = material('air'), AIR_J_M3K = AIR.densityKgM3 * AIR.specificHeatJkgK;
// Furnishings: EN ISO 52016-1 takes air and furniture together as 10 kJ/m2K of floor; the air is counted
// here from the real volume, leaving about 7 kJ/m2K for what is in the room. approx: true.
const CONTENTS_J_M2K = 7000;
const RADIANT_SHARE = 0.5;         // of internal gains (ISO 13790: half to the air, half to surfaces)
const LIGHT_J_M2K = 2000;          // a surface storing less than this (sheet, membrane, glass) passes heat straight through

// ---------------------------------------------------------------------------------------- sun on surfaces
// Solar heat gain coefficient at normal incidence and incidence-angle coefficient b0 (modifier 1 - b0 (1/cos - 1),
// about 0.1 for one pane and 0.17 for two: Duffie and Beckman). approx: true.
const GLASS = { float_glass: [0.86, 0.1], dgu: [0.76, 0.17], dgu_lowe: [0.62, 0.17], polycarbonate: [0.8, 0.1] };
const isGlazing = (layers) => { let any = false; for (const l of layers || []) { const m = l && material(l.material); if (!m) continue; if (m.class !== 'glass') return false; any = true; } return any; };
const glassOf = (layers) => { for (const l of layers) if (GLASS[l.material]) return GLASS[l.material]; return [0.8, 0.1]; };
// Solar absorptance of outside surfaces (ASHRAE / CIBSE Guide A typical values). approx: true.
const ABSORB = { slate: 0.9, asphalt_shingle: 0.88, epdm: 0.9, lime_plaster: 0.4, limestone: 0.45, marble: 0.45, canvas: 0.45 };
const ABSORB_CLASS = { wood: 0.65, masonry: 0.65, roofing: 0.7, earth: 0.75, metal: 0.6, fabric: 0.5 };
const absorptance = (layers) => { for (const l of layers || []) { const m = l && material(l.material); if (m) return ABSORB[m.id] || ABSORB_CLASS[m.class] || 0.65; } return 0.65; };
const SKY_LOSS_WM2 = 63, EMISSIVITY = 0.9;

// ---------------------------------------------------------------------------------------- the derived model
// Everything about the rooms that follows from the pieces alone, laid out flat for the step. Not state:
// it is rebuilt from site.pieces whenever site.version changes or a save is loaded.
const CAT = { wall: 0, roof: 1, floor: 2, ceiling: 1 }, CATS = ['walls', 'roof', 'floor', 'windows'];
const W = 28;   // numbers kept per room during a step
function buildModel(pieces) {
  const rooms = findRooms(pieces), n = rooms.length, index = new Map();
  rooms.forEach((r, i) => index.set(r.id, i));
  const col = { kind: [], cat: [], A: [], R: [], K: [], nx: [], ny: [], nz: [], abs: [], b0: [], sky: [], gnd: [], up: [] }, info = [];
  const M = { rooms, n, index, ids: rooms.map((r) => r.id), s0: new Int32Array(n + 1), enclosed: rooms.map((r) => r.enclosed),
    Ca: new Float64Array(n), Cm: new Float64Array(n), Ham: new Float64Array(n), phi: new Float64Array(n), leak: new Float64Array(n),
    cs: new Float64Array(n), cw: new Float64Array(n), vol: new Float64Array(n), tmp: new Float64Array(n * W), Ta: new Float64Array(n), info };
  const pairs = new Map();
  // kind: 0 massive to outside, 1 massive to ground, 2 light to outside, 3 glazing, 4 light to ground
  const push = (kind, cat, A, R, K, s, abs, b0, meta) => {
    const st = Math.sin(s.tiltRad), ny = Math.cos(s.tiltRad);
    col.kind.push(kind); col.cat.push(cat); col.A.push(A); col.R.push(R); col.K.push(K);
    col.nx.push(st * Math.sin(s.orientationRad)); col.ny.push(ny); col.nz.push(-st * Math.cos(s.orientationRad));
    col.abs.push(ny < -0.5 ? 0 : abs); col.b0.push(b0); col.sky.push((1 + ny) / 2); col.gnd.push(ny < -0.5 ? 0 : (1 - ny) / 2); col.up.push(EMISSIVITY * Math.max(0, ny));
    info.push(meta);
  };
  rooms.forEach((r, i) => {
    M.s0[i] = col.kind.length; M.vol[i] = r.volumeM3;
    M.Ca[i] = AIR_J_M3K * r.volumeM3 + CONTENTS_J_M2K * r.floorAreaM2;
    const h = Math.max(r.stackHeightM, 1) / 2.5; M.cs[i] = LBL_CS * h; M.cw[i] = LBL_CW * Math.pow(h, 0.4);
    let Cm = 0, Ham = 0, phiN = 0, phiD = 0, leak = HOLE_CD * r.openAreaM2 * 1e4;
    const mass = (A, layers, rsi, soil) => {
      const m = innerMass(layers, { soilBehind: soil });
      if (m.capacityJm2K < LIGHT_J_M2K) return false;
      Cm += A * m.capacityJm2K; Ham += A / (rsi + m.resistanceM2KW);
      phiN += (A * m.resistanceM2KW) / (rsi + m.resistanceM2KW); phiD += A;
      return true;
    };
    let Ag = 0; for (const s of r.envelope) if (s.kind === 'floor' && s.toRoom === 'ground') Ag += s.areaM2;
    let floorDt;
    const flowOf = (s) => (s.kind === 'floor' ? 'down' : s.kind === 'wall' || s.tiltRad > Math.PI / 3 ? 'horizontal' : 'up');
    for (const s of [...r.envelope].sort((a, b) => (b.kind === 'floor') - (a.kind === 'floor'))) {
      const flow = flowOf(s), rsi = RSI[flow], A = s.areaM2, cat = CAT[s.kind] || 0, meta = { room: i, pieceId: s.pieceId, kind: s.kind, toRoom: s.toRoom, areaM2: A };
      if (index.has(s.toRoom)) {                                    // a wall or floor shared with another room
        const j = index.get(s.toRoom); let K = A / (2 * rsi + assemblyR(s.layers, { flow }));
        for (const o of s.openings) if (!o.open) K += o.areaM2 / (2 * RSI.horizontal + assemblyR(o.layers));
        const key = Math.min(i, j) + '|' + Math.max(i, j); pairs.set(key, (pairs.get(key) || 0) + K / 2);
        mass(A, s.layers, rsi, false);
        continue;
      }
      const ground = s.toRoom === 'ground';
      if (A > 0) {
        if (isGlazing(s.layers)) { const g = glassOf(s.layers); push(3, 3, A, rsi + assemblyR(s.layers, { flow }), 0, s, g[0], g[1], meta); leak += A * LEAK_CM2_M2.glazed; }
        else if (ground) {
          let U;
          if (s.kind === 'floor') {
            const fd = s.foundation, fm = fd && material(fd.material);
            const floorR = assemblyR(s.layers, { flow, outerClosed: true }) + (fm ? Math.min(fd.thicknessM, 1) / fm.conductivityWmK : 0);
            if (floorDt === undefined) floorDt = r.wallThicknessM + SOIL.conductivityWmK * (RSI.down + floorR + RSE_STANDARD);
            U = groundFloorU({ areaM2: Ag, perimeterM: r.groundPerimeterM, wallThicknessM: r.wallThicknessM, floorR, depthM: s.depthM });
          } else if (s.kind === 'wall') U = groundWallU({ depthM: s.depthM, wallR: assemblyR(s.layers, { flow }), floorDtM: floorDt });
          else U = 1 / (rsi + assemblyR(s.layers, { flow }) + Math.max(0.1, s.coverM || 0.5) / SOIL.conductivityWmK + RSE_STANDARD);
          meta.uWm2K = U;
          push(mass(A, s.layers, rsi, true) ? 1 : 4, cat, A, 0, A * U, s, 0, 0, meta);
        } else {
          const R = rsi + assemblyR(s.layers, { flow });
          push(mass(A, s.layers, rsi, false) ? 0 : 2, cat, A, R, 0, s, absorptance(s.layers), 0, meta);
          leak += A * LEAK_CM2_M2[leakageClass(s.layers)];
        }
      }
      for (const o of s.openings) {                                  // doors and windows always open onto the weather
        const meta2 = { room: i, pieceId: o.pieceId, kind: o.kind, toRoom: 'outside', areaM2: o.areaM2 };
        if (o.open) { leak += HOLE_CD * o.areaM2 * 1e4; continue; }
        if (isGlazing(o.layers)) { const g = glassOf(o.layers); push(3, 3, o.areaM2, RSI.horizontal + assemblyR(o.layers), 0, s, g[0], g[1], meta2); leak += WINDOW_LEAK_CM2_M * (o.widthM > 0 ? 2 * (o.widthM + o.heightM) : 4 * Math.sqrt(o.areaM2)); }
        else { push(2, 3, o.areaM2, RSI.horizontal + assemblyR(o.layers), 0, s, absorptance(o.layers), 0, meta2); leak += DOOR_LEAK_CM2; }
      }
    }
    for (const q of r.internal) mass(q.areaM2, q.layers, RSI.horizontal, false);
    M.Cm[i] = Cm; M.Ham[i] = Ham; M.phi[i] = phiD > 0 ? phiN / phiD : 1; M.leak[i] = leak;
  });
  M.s0[n] = col.kind.length;
  for (const k in col) M[k] = Float64Array.from(col[k]);
  // rooms that share a wall are solved together
  M.links = rooms.map(() => []);
  for (const [key, K] of pairs) { const [a, b] = key.split('|').map(Number); if (M.enclosed[a] && M.enclosed[b]) { M.links[a].push([b, K]); M.links[b].push([a, K]); } }
  M.groups = []; const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (seen[i] || !M.links[i].length) continue;
    const g = [i]; seen[i] = 1;
    for (let k = 0; k < g.length; k++) for (const [j] of M.links[g[k]]) if (!seen[j]) { seen[j] = 1; g.push(j); }
    M.groups.push({ list: g, pos: new Map(g.map((v, k) => [v, k])), a: new Float64Array(g.length * g.length), b: new Float64Array(g.length) });
  }
  return M;
}
const CACHE = new WeakMap();
const EMPTY = [];
function entryFor(simState, site) {
  const pieces = (site && site.pieces) || EMPTY, version = site ? site.version | 0 : 0;
  let e = CACHE.get(simState);
  if (!e || e.pieces !== pieces || e.version !== version) CACHE.set(simState, (e = { pieces, version, model: buildModel(pieces), synced: false }));
  return e;
}

// The weather as the surfaces see it at one moment.
function envOf(w, tCal, tMid) {
  const sol = w.solar || {}, v = Math.max(0, num(w.windMs, 0)), cloud = clamp(num(w.cloud, 0.5), 0, 1);
  const sun = sunPosition(tCal + tMid, { latitudeDeg: (w.site && num(w.site.latitudeDeg, 45)) || 45 });
  const up = sun.elevationRad > 0, ce = Math.cos(sun.elevationRad), To = num(w.tempC, 10);
  const snow = clamp(num(w.snowDepthM, 0) / 0.05, 0, 1);
  return { To, Tg: num(w.groundTempC, To), v, rse: rse(v), dni: up ? num(sol.directNormalWm2, 0) : 0, dhi: num(sol.diffuseWm2, 0),
    refl: num(sol.globalHorizontalWm2, 0) * (0.2 + 0.45 * snow), lw: SKY_LOSS_WM2 * (1 - 0.85 * cloud * cloud),
    sx: ce * Math.sin(sun.azimuthRad), sy: Math.sin(sun.elevationRad), sz: -ce * Math.cos(sun.azimuthRad) };
}
// One surface against the weather: its conductance, the temperature it faces, and the sun it lets in.
let bK = 0, bT = 0, bQ = 0;
function bound(M, k, e) {
  const kind = M.kind[k];
  bQ = 0;
  if (kind === 1 || kind === 4) { bK = M.K[k]; bT = e.Tg; return; }
  bK = M.A[k] / (M.R[k] + e.rse);
  const cos = e.dni > 0 ? Math.max(0, M.nx[k] * e.sx + M.ny[k] * e.sy + M.nz[k] * e.sz) : 0, dif = e.dhi * M.sky[k] + e.refl * M.gnd[k];
  if (kind === 3) { bT = e.To; bQ = M.A[k] * M.abs[k] * (cos > 0 ? e.dni * cos * Math.max(0, 1 - M.b0[k] * (1 / cos - 1)) : 0) + M.A[k] * M.abs[k] * 0.9 * dif; }
  else bT = e.To + e.rse * (M.abs[k] * (e.dni * cos + dif) - e.lw * M.up[k]);
}

// ---------------------------------------------------------------------------------------- state
const freshRoom = (T, rh, dew) => ({ tempC: T, massTempC: T, humidity: rh, dewPointC: dew, enclosed: false, uaWK: 0, infiltrationAch: 0,
  solarGainW: 0, internalGainW: 0, heatingW: 0, lossW: { walls: 0, roof: 0, floor: 0, windows: 0, infiltration: 0 }, toRoomsW: 0, ventM2: 0, radiantW: 0 });
const fresh = () => ({ v: STATE_V, version: -1, rooms: {}, gains: {}, heat: {}, vents: {}, radiant: {} });
const sumOf = (o) => { let s = 0; if (o) for (const k in o) s += o[k]; return s; };
function tally(s, id) {
  const r = s.rooms[id]; if (!r) return;
  r.internalGainW = sumOf(s.gains[id]); r.heatingW = sumOf(s.heat[id]); r.ventM2 = sumOf(s.vents[id]);
  let rad = 0; const f = s.radiant[id];
  for (const m of [s.gains[id], s.heat[id]]) if (m) for (const k in m) rad += m[k] * (f && f[k] !== undefined ? f[k] : RADIANT_SHARE);
  r.radiantW = rad;
}
// Bring the room list in line with what is built. A room that is still there keeps its temperatures; a room
// split off another starts at that room's; a new one starts at the outside air.
function reconcile(s, M, w) {
  const old = s.rooms, next = {}, To = num(w.tempC, 10), rh = clamp(num(w.humidity, 0.6), 0.01, 1), dew = num(w.dewPointC, dewPointFrom(To, rh));
  for (let i = 0; i < M.n; i++) {
    const id = M.ids[i], parent = old[id] || old[id.split('#')[0]];
    const r = old[id] || (parent ? { ...freshRoom(parent.tempC, parent.humidity, parent.dewPointC), massTempC: parent.massTempC } : freshRoom(To, rh, dew));
    r.enclosed = M.enclosed[i]; next[id] = r;
  }
  s.rooms = next;
  for (const k of ['gains', 'heat', 'vents', 'radiant']) for (const id in s[k]) if (!next[id]) delete s[k][id];
  for (const id in next) tally(s, id);
}

function step(ctx) {
  let s = ctx.s;
  if (!s || s.v !== STATE_V) s = ctx.s = fresh();
  const site = ctx.get('site'), w = ctx.get('weather') || {}, E = entryFor(ctx.state, site), M = E.model, ver = site ? site.version | 0 : 0;
  if (!E.synced || s.version !== ver) { reconcile(s, M, w); s.version = ver; E.synced = true; }
  const n = M.n; if (!n) return;
  const dt = ctx.dt, e = envOf(w, ctx.ct ?? ctx.t, dt / 2), tmp = M.tmp, Ta = M.Ta, To = e.To;
  const R = new Array(n);
  // 1. every room's balance with the weather, the mass node folded into the air equation
  for (let i = 0; i < n; i++) {
    const r = (R[i] = s.rooms[M.ids[i]]), o = i * W;
    for (let k = 0; k < W; k++) tmp[o + k] = 0;
    for (let k = M.s0[i], k1 = M.s0[i + 1]; k < k1; k++) {
      bound(M, k, e);
      const c = M.cat[k];
      if (M.kind[k] < 2) { tmp[o + 2] += bK; tmp[o + 3] += bK * bT; tmp[o + 20 + c] += bK; tmp[o + 23 + c] += bK * bT; }
      else { tmp[o] += bK; tmp[o + 1] += bK * bT; tmp[o + 12 + c] += bK; tmp[o + 16 + c] += bK * bT; tmp[o + 4] += bQ; }
    }
    const Km = tmp[o + 2], Ham = M.Ham[i], Hmb = Km > 0 ? 1 / (1 / Km - 1 / Ham) : 0, Tbb = Km > 0 ? tmp[o + 3] / Km : To;
    const Dm = M.Cm[i] / dt + Ham + Hmb;
    tmp[o + 6] = Hmb; tmp[o + 7] = Tbb; tmp[o + 8] = Dm;
    if (!r.enclosed) { Ta[i] = To; continue; }
    const leak = M.leak[i] + HOLE_CD * r.ventM2 * 1e4, dT = r.tempC - To;
    const Hinf = AIR_J_M3K * 0.001 * leak * Math.sqrt(M.cs[i] * Math.abs(dT) + M.cw[i] * e.v * e.v);
    const Qr = r.radiantW + tmp[o + 4], Qint = r.internalGainW + r.heatingW - r.radiantW;
    const Qa = Qint + Qr * M.phi[i], Qm = Qr * (1 - M.phi[i]);
    const mr = (M.Cm[i] / dt) * r.massTempC + Hmb * Tbb + Qm;
    tmp[o + 5] = Hinf; tmp[o + 9] = mr;
    tmp[o + 10] = M.Ca[i] / dt + tmp[o] + Hinf + (Dm > 0 ? Ham - (Ham * Ham) / Dm : 0);
    tmp[o + 11] = (M.Ca[i] / dt) * r.tempC + tmp[o + 1] + Hinf * To + Qa + (Dm > 0 ? (Ham * mr) / Dm : Qm);
    Ta[i] = tmp[o + 11] / tmp[o + 10];
  }
  // 2. rooms joined by shared walls: one small linear system per building
  for (const g of M.groups) {
    const m = g.list.length, a = g.a, b = g.b;
    a.fill(0);
    for (let p = 0; p < m; p++) {
      const i = g.list[p]; a[p * m + p] = tmp[i * W + 10]; b[p] = tmp[i * W + 11];
      for (const [j, K] of M.links[i]) { a[p * m + p] += K; a[p * m + g.pos.get(j)] -= K; }
    }
    for (let p = 0; p < m; p++) for (let q = p + 1; q < m; q++) {
      const f = a[q * m + p] / a[p * m + p]; if (f === 0) continue;
      for (let c = p; c < m; c++) a[q * m + c] -= f * a[p * m + c];
      b[q] -= f * b[p];
    }
    for (let p = m - 1; p >= 0; p--) { let v = b[p]; for (let c = p + 1; c < m; c++) v -= a[p * m + c] * Ta[g.list[c]]; Ta[g.list[p]] = v / a[p * m + p]; }
  }
  // 3. the mass, where the heat went, and the air's moisture
  const pres = num(w.pressureHPa, 1013), eOut = clamp(num(w.humidity, 0.6), 0, 1) * saturationVapourHPa(To), wOut = (0.622 * eOut) / (pres - eOut);
  for (let i = 0; i < n; i++) {
    const r = R[i], o = i * W, T = Ta[i], Hmb = tmp[o + 6], Tbb = tmp[o + 7], Dm = tmp[o + 8], Km = tmp[o + 2], Ham = M.Ham[i], L = r.lossW;
    r.uaWK = tmp[o] + Km; r.solarGainW = r.enclosed ? tmp[o + 4] : 0;
    if (!r.enclosed) {                                             // open to the weather: the air is the outside air, the fabric cools at its own pace
      r.massTempC = Dm > 0 ? ((M.Cm[i] / dt) * r.massTempC + Hmb * Tbb + Ham * To) / Dm : To;
      r.tempC = To; r.humidity = clamp(num(w.humidity, 0.6), 0, 1); r.dewPointC = num(w.dewPointC, dewPointFrom(To, Math.max(r.humidity, 0.01)));
      r.infiltrationAch = 0; r.toRoomsW = 0; L.walls = L.roof = L.floor = L.windows = L.infiltration = 0;
      continue;
    }
    const Tm = Dm > 0 ? (tmp[o + 9] + Ham * T) / Dm : T, lag = Km > 0 ? (Hmb / Km) * (Tm - Tbb) : 0;
    L.walls = tmp[o + 12] * T - tmp[o + 16] + tmp[o + 20] * (lag + Tbb) - tmp[o + 23];
    L.roof = tmp[o + 13] * T - tmp[o + 17] + tmp[o + 21] * (lag + Tbb) - tmp[o + 24];
    L.floor = tmp[o + 14] * T - tmp[o + 18] + tmp[o + 22] * (lag + Tbb) - tmp[o + 25];
    L.windows = tmp[o + 15] * T - tmp[o + 19];
    L.infiltration = tmp[o + 5] * (T - To);
    let x = 0; for (const [j, K] of M.links[i]) x += K * (T - Ta[j]);
    r.toRoomsW = x;
    const ach = M.vol[i] > 0 ? (tmp[o + 5] / AIR_J_M3K) * 3600 / M.vol[i] : 0;
    r.infiltrationAch = ach;
    // moisture: mixing ratio relaxes toward the outside air's at the air-change rate (exact over the step)
    const eIn = saturationVapourHPa(r.dewPointC), wIn = (0.622 * eIn) / (pres - eIn), sat = saturationVapourHPa(T);
    const wNew = Math.min(wOut + (wIn - wOut) * Math.exp((-ach * dt) / 3600), (0.622 * sat) / (pres - sat));
    r.humidity = clamp(((wNew * pres) / (0.622 + wNew)) / sat, 0, 1); r.dewPointC = dewPointFrom(T, Math.max(r.humidity, 1e-4));
    r.tempC = T; r.massTempC = Tm;
  }
}

// ---------------------------------------------------------------------------------------- commands
function setter(key, field) {
  return (c, p = {}) => {
    let s = c.s; if (!s || s.v !== STATE_V) s = c.s = fresh();
    const { roomId, source = 'gain' } = p, v = p[field];
    if (typeof roomId !== 'string' || !roomId) throw new Error('thermal: roomId is required');
    if (v !== undefined && v !== null && !Number.isFinite(v)) throw new Error('thermal: ' + field + ' must be a number');
    if (p.radiant !== undefined && !(p.radiant >= 0 && p.radiant <= 1)) throw new Error('thermal: radiant is a share from 0 to 1');
    const maps = key === 'vents' ? ['vents'] : ['gains', 'heat', 'radiant'], into = key === 'vents' ? 'vents' : p.heating ? 'heat' : 'gains';
    for (const k of maps) if (s[k][roomId]) { delete s[k][roomId][source]; if (!Object.keys(s[k][roomId]).length) delete s[k][roomId]; }
    if (v) (s[into][roomId] = s[into][roomId] || {})[source] = v;
    if (v && key !== 'vents' && p.radiant !== undefined && p.radiant !== RADIANT_SHARE) (s.radiant[roomId] = s.radiant[roomId] || {})[source] = p.radiant;
    tally(s, roomId);
  };
}

export const thermal = {
  name: 'thermal',
  every: EVERY,
  init: fresh,
  step,
  commands: {
    // heat given off in a room, W, kept per source; 0 removes it. heating: true counts it as heatingW.
    // radiant: the share (0..1, default a half) that lands on the room's surfaces instead of warming the air directly.
    'thermal.setGain': setter('gains', 'watts'),
    // a hole to the outside air in a room (an open window, a vent), m2 of clear opening, kept per source.
    'thermal.setVent': setter('vents', 'areaM2'),
  },
};

// ---------------------------------------------------------------------------------------- reading it
// These take the whole simulation state (sim.state): rooms come from site.pieces, numbers from thermal.

// The rooms as found, with the numbers the model derived for each. For the inspector and for tests.
export function roomModels(simState) {
  const M = entryFor(simState, simState.sys.site).model;
  return M.rooms.map((r, i) => ({ id: r.id, enclosed: r.enclosed, leaks: r.leaks, floorAreaM2: r.floorAreaM2, volumeM3: r.volumeM3, heightM: r.heightM,
    airCapacityJK: M.Ca[i], massCapacityJK: M.Cm[i], airToMassWK: M.Ham[i], leakageCm2: M.leak[i], stackHeightM: r.stackHeightM, room: r }));
}
// The room a point is in (its id), or null.
export function roomIdAt(simState, x, z, y) {
  for (const r of entryFor(simState, simState.sys.site).model.rooms) for (const c of r.cells) {
    if (y !== undefined && (y < c.y0 - 0.3 || y > (c.heightAt ? c.heightAt(x, z) : c.y0 + 2.5))) continue;
    let s = 0, inside = true; const n = c.poly.length;
    for (let i = 0; i < n && inside; i++) { const a = c.poly[i], b = c.poly[(i + 1) % n], cr = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x); if (cr > 1e-9) { if (s < 0) inside = false; s = 1; } else if (cr < -1e-9) { if (s > 0) inside = false; s = -1; } }
    if (inside) return r.id;
  }
  return null;
}
// For the thermal overlay: each room's temperature and, surface by surface, the heat leaving through it
// now (W), its share of the room's fabric loss, and W per m2.
export function overlayData(simState) {
  const sys = simState.sys || {}, s = sys.thermal, w = sys.weather || {};
  if (!s || !sys.site) return { outsideC: num(w.tempC, 0), rooms: [] };
  const M = entryFor(simState, sys.site).model, e = envOf(w, num(simState.ct, simState.t), 0), rooms = [];
  for (let i = 0; i < M.n; i++) {
    const r = s.rooms[M.ids[i]]; if (!r) continue;
    let Km = 0, KmT = 0; const list = [];
    for (let k = M.s0[i]; k < M.s0[i + 1]; k++) { bound(M, k, e); if (M.kind[k] < 2) { Km += bK; KmT += bK * bT; } }
    const Hmb = Km > 0 ? 1 / (1 / Km - 1 / M.Ham[i]) : 0, Tbb = Km > 0 ? KmT / Km : e.To, lag = Km > 0 ? (Hmb / Km) * (r.massTempC - Tbb) : 0;
    let total = 0;
    for (let k = M.s0[i]; k < M.s0[i + 1]; k++) {
      bound(M, k, e);
      const q = r.enclosed ? (M.kind[k] < 2 ? bK * (lag + Tbb - bT) : bK * (r.tempC - bT)) : 0;
      list.push({ pieceId: M.info[k].pieceId, kind: M.info[k].kind, toRoom: M.info[k].toRoom, areaM2: M.A[k], uWm2K: bK / M.A[k], lossW: q, lossWm2: q / M.A[k], share: 0 });
      total += Math.max(0, q);
    }
    for (const x of list) x.share = total > 0 ? Math.max(0, x.lossW) / total : 0;
    rooms.push({ id: M.ids[i], tempC: r.tempC, massTempC: r.massTempC, humidity: r.humidity, enclosed: r.enclosed, leaks: M.rooms[i].leaks, infiltrationW: r.lossW.infiltration, fabricLossW: total, surfaces: list });
  }
  return { outsideC: e.To, rooms };
}
export const LOSS_PATHS = CATS;
