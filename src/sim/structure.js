// Structural loads: is what stands on the site strong enough, and what carries what?
//
// A simplified but honest solver over the built pieces. It finds the load path from geometry (roof
// planes bear on the ridge beam and the walls under their eaves, floors on walls and beams, beams on
// posts, walls on the walls or foundation beneath, everything on the soil), sends dead, live and snow
// load down that path, and checks every member the way a builder's handbook does.
//
// FORMAT: allowable stress design. Loads are the real, unfactored ones; a utilisation of 1.0 means
// "at the safe working limit", not "about to break". Combinations (ASCE 7 sec. 2.4 family):
//   D | D + L | D + (Lr or S) | D + 0.75 L + 0.75 (Lr or S) | wind checks with 0.6 D resisting.
//
// LOADS
//   dead    each layer's density x thickness x g, plus the framing members (real or implied)
//   live    floors 1.9 kPa (IRC 40 psf); roofs a 0.96 kPa maintenance load reduced with pitch (ASCE 7 Lr)
//   snow    ground snow x the roof shape coefficient mu1 of EN 1991-1-3 (0.8 up to 30 degrees, zero at 60).
//           Ground snow is the greater of what lies now (weather.snowSweMm) and a design value for the
//           climate: a normal winter's whole snowfall lying at once (see designSnowKPa), so a roof is
//           judged before the storm. A roof carries snow or the maintenance load, whichever is more.
//   wind    q = 0.613 Kz Kd v^2 Pa (ASCE 7 velocity pressure; Kz by height and exposure, Kd 0.85), v the
//           greater of the design gust (40 m/s default: the 50-year 3 s gust of ASCE 7-05 for most inland
//           sites) and 1.5 x the mean wind now (Durst: 3 s gust over the hourly mean).
//
// DESIGN VALUES, by the registry's strengthBasis (designValues below)
//   'characteristic' (EN 338, EN 14080, EN 300: 5th percentile of graded timber, short-term test):
//       allowable = f_k x k_mod / (gamma_M x gamma_F) = f_k x 0.7 / (1.3 x 1.5) = 0.359 f_k
//       k_mod 0.7 is Eurocode 5's long-term class, the ten-year "normal" duration of allowable stress
//       design; gamma_M 1.3 is EC5's material factor for solid timber; gamma_F 1.5 is the EN 1990 load
//       factor the EN design value expects to meet (it is moved to the resistance side here, a little
//       conservative for dead load). C24 gives 8.6 MPa in bending: the NDS value for select structural
//       spruce-pine-fir, the North American grade EN 1912 assigns to C24.
//   'clear-wood-mean' (Wood Handbook small clear specimens at 12 % moisture): ASTM D245 / D2555:
//       back to green wood (clear wood gains about 1.6x in bending, 1.9x in compression and 1.25x in
//       stiffness on drying: Wood Handbook species tables), 5 % exclusion limit (1 - 1.645 CoV, CoV 16 %
//       bending, 18 % compression), strength ratio of a No. 2 framing grade (0.45 bending, 0.52
//       compression), D245 adjustment factor for normal duration and safety (2.1 bending, 1.9 compression
//       softwood; 2.3 and 2.1 hardwood), D245 seasoning increase for dry use (1.25 bending, 1.5
//       compression, 1.14 stiffness). Stiffness also takes D245's 0.94 and the 0.9 quality factor.
//   Load duration (NDS 2.3.2, the Madison curve; EC5's k_mod / 0.7 gives the same ladder): dead alone
//       0.9, floor live 1.0, snow 1.15, roof live 1.25, wind 1.6.
//   Size: EC5 k_h = (150 / d)^0.2 <= 1.3 for characteristic values; D245 (50 / d)^(1/9) for clear wood.
//   Repetitive members (studs, joists, rafters at 0.6 m or less under sheathing): 1.15 (NDS 4.3.9).
//   Shear and bearing across the grain are not in the registry; they follow EN 384 / EN 338 relations:
//       f_v,k = 0.2 f_m,k^0.8 and f_c,90,k = 0.007 rho_k with rho_k = rho_mean / 1.2.
//   Columns: NDS column stability factor (Ylinen, c = 0.8) with F_cE = 0.822 E_min / (le/d)^2 and
//       E_min = E (1 - 1.645 x 0.25) 1.03 / 1.66. For a slender post this is Euler's load on E_min.
//   Masonry: wall strength f_k = 0.45 f_b^0.7 f_m^0.3 (EN 1996-1-1 eq. 3.1, M5 mortar), allowable
//       f_k / (2.5 x 1.5), reduced for slenderness by 1 - (h / 40 t)^2 (TMS 402). Unfired earth: strength / 7
//       (Lehmbau Regeln / DIN 18954). Metals: yield / 1.67 (AISC 360 allowable strength).
//   Deflection: elastic, under dead plus variable load: span / 240 where floor load is carried,
//       span / 180 for roofs; a cantilever is judged on twice its length (IBC table 1604.3).
//
// WHAT IS ASSUMED where build mode gives a sheet-like assembly rather than members
//   wall    38 mm studs at 0.4 m, as deep as the cavity layer; a stud each side of every opening; a
//           doubled 38 x 140 header over each opening
//   floor   38 mm joists at 0.4 m, as deep as the joist bay (140 mm if the build-up names none)
//   roof    38 mm rafters at 0.6 m, as deep as the rafter bay (140 mm if none: thatch)
//   The assumption is written in the member's `note`. When an assembly lists `members`, the built ones
//   are used instead: studs, headers, joists, rafters, sheathing; nothing is implied.
//   Pieces with built === false do not exist yet and are ignored: a half-built house is judged as it stands.
//
// Not modelled (yet): drifted and unbalanced snow, lateral buckling of deep unbraced beams, connections
// other than a roof's hold-down, storeys racking together, seismic load.

import { material } from './materials.js';
import { CLIMATES } from './weather.js';

const G = 9.81;
const STATE_V = 1;
const TOLY = 0.3;                      // m: how closely two levels must agree for one piece to sit on another
const UMAX = 9.99;                     // utilisation is capped here; "unsupported" reports this

// ---------------------------------------------------------------------------------------- site values
// Presumed safe bearing pressures (BS 8004 table 1 and IBC table 1806.2 families), kPa.
export const SOILS = Object.freeze({
  'rock': Object.freeze({ name: 'rock', allowableKPa: 600 }),               // weak rock; IBC crystalline bedrock 575
  'gravel': Object.freeze({ name: 'gravel', allowableKPa: 200 }),           // medium dense gravel, lower bound
  'firm-loam': Object.freeze({ name: 'firm loam', allowableKPa: 125 }),     // firm clay and loam, 75 to 150
  'sand': Object.freeze({ name: 'sand', allowableKPa: 100 }),               // medium dense sand; IBC 96
  'soft-clay': Object.freeze({ name: 'soft clay', allowableKPa: 50 }),      // soft clay and silt, under 75
  'peat': Object.freeze({ name: 'peat', allowableKPa: 20 }),                // organic ground: no presumed value in the codes
});
export const DEFAULT_SOIL = 'firm-loam';
// ASCE 7 table 26.10-1 power law: [alpha, gradient height m, lowest height m]
const EXPOSURE = Object.freeze({ open: [9.5, 274, 4.6], sheltered: [7, 366, 9.1], exposed: [11.5, 213, 4.6] });
export const DESIGN_GUST_MS = 40;
const GUST_FACTOR = 1.5, KD = 0.85;
const SNOW_BAND_KPA = 0.25, WIND_BAND_MS = 5;
const FLOOR_LIVE = 1900, ROOF_LIVE = 960, ROOF_LIVE_MIN = 580;   // Pa
const ASSUMED_SNOW_DENSITY = 300;      // kg/m3, settled snow (EN 1991-1-3 annex E), when the weather gives only a depth
const STUD_S = 0.4, JOIST_S = 0.4, RAFTER_S = 0.6, B_IMPLIED = 0.038, D_DEFAULT = 0.14, FRAMING = 'spf_seasoned';
const HOLD_DOWN_N = 890;               // one toe-nailed rafter seat: 200 lbf (IRC R802.11 limit before straps are required)
const C_WALL = 1.1;                    // wall as a component: +0.8 outside, -0.3 inside (EN 1991-1-4)
const C_DRAG = 1.1;                    // building as a whole: (0.8 windward + 0.5 leeward) x 0.85 (ASCE 7 directional)
// In-plane bracing of a wall line, allowable for wind (AWC SDPWS table 4.3: nominal / 2), N per metre, and
// apparent shear stiffness Ga, N per metre of sway per metre... (v h / Ga = sway).
const BRACE = Object.freeze({
  panel: [4900, 1.75e6],               // 11 mm OSB or plywood, 8d nails at 150 mm
  boards: [1020, 2.6e5],               // one layer of horizontal boards
  bare: [100, 1.0e4],                  // nailed stud-to-plate joints only: a parallelogram waiting to happen (nominal)
  solid: [50000, 2.0e7],               // masonry or logs, far stiffer than any wind asks
  earth: [5000, 2.0e6],                // daub or earth infill (NZS 4297 earth shear, about 0.05 MPa on 0.1 m)
});
const OPEN_FRAME = 0.2;                // share of a bare stud frame's face that the wind can push on (38 mm studs at 0.4 m, plates, headers)
const BRACE_N = 2700;                  // one let-in diagonal brace, about 600 lbf (approximate)
const POSTS_FD = Object.freeze({ spacing: 2, post: 0.22, pad: 0.4 });   // a raised floor's posts as build mode draws them, on pier pads

// ---------------------------------------------------------------------------------------- design values
const K_CHAR = 0.7 / (1.3 * 1.5);
const CD = Object.freeze({ dead: 0.9, live: 1.0, snow: 1.15, roofLive: 1.25, wind: 1.6 });
const REP = 1.15;
const dvCache = new Map();
// Allowable stresses (Pa) for normal load duration, and stiffness, for a registry material. null if it cannot carry load.
export function designValues(id) {
  if (dvCache.has(id)) return dvCache.get(id);
  const m = material(id); let o = null;
  if (m && m.class === 'wood' && m.bendingStrengthMPa && m.elasticModulusGPa) {
    let Fb, Fc, E, size;
    if (m.strengthBasis === 'characteristic') {
      Fb = m.bendingStrengthMPa * K_CHAR; Fc = (m.compressiveStrengthMPa || m.bendingStrengthMPa * 0.85) * K_CHAR; E = m.elasticModulusGPa; size = 'en';
    } else {
      const hard = m.densityKgM3 >= 680;
      Fb = m.bendingStrengthMPa * (1.25 / 1.6) * (1 - 1.645 * 0.16) * 0.45 / (hard ? 2.3 : 2.1);
      Fc = (m.compressiveStrengthMPa || m.bendingStrengthMPa * 0.55) * (1.5 / 1.9) * (1 - 1.645 * 0.18) * 0.52 / (hard ? 2.1 : 1.9);
      E = m.elasticModulusGPa * (1.14 / 1.25) * 0.94 * 0.9; size = 'd245';
    }
    const fmk = Fb / K_CHAR;
    o = { kind: 'wood', size, Fb: Fb * 1e6, Fc: Fc * 1e6, Fv: 0.2 * Math.pow(fmk, 0.8) * K_CHAR * 1e6, Fcp: 0.007 * (m.densityKgM3 / 1.2) * K_CHAR * 1e6,
      E: E * 1e9, Emin: E * 1e9 * (1 - 1.645 * 0.25) * 1.03 / 1.66, name: m.name };
  } else if (m && m.class === 'metal' && m.bendingStrengthMPa) {
    const Fy = m.bendingStrengthMPa * 1e6;
    o = { kind: 'metal', Fb: Fy / 1.67, Fc: Fy / 1.67, Fv: 0.4 * Fy, Fcp: Fy / 1.67, E: m.elasticModulusGPa * 1e9, Emin: m.elasticModulusGPa * 1e9 / 1.92, Fy, name: m.name };
  } else if (m && m.class === 'earth' && m.compressiveStrengthMPa) {
    const F = m.compressiveStrengthMPa * 1e6 / 7;
    o = { kind: 'earth', Fb: 0, Fc: F, Fv: 0, Fcp: F, E: 0, Emin: 0, name: m.name };
  } else if (m && m.class === 'masonry' && m.compressiveStrengthMPa) {
    const F = 0.45 * Math.pow(m.compressiveStrengthMPa, 0.7) * Math.pow(5, 0.3) / (2.5 * 1.5) * 1e6;
    o = { kind: 'masonry', Fb: 0, Fc: F, Fv: 0, Fcp: F, E: (m.elasticModulusGPa || 0) * 1e9, Emin: 0, name: m.name };
  }
  dvCache.set(id, o);
  return o;
}
const sizeFactor = (dv, d) => (dv.size === 'en' ? (d < 0.15 ? Math.min(1.3, Math.pow(0.15 / d, 0.2)) : 1) : dv.size === 'd245' ? (d > 0.0508 ? Math.pow(0.0508 / d, 1 / 9) : 1) : 1);

// Allowable axial stress (Pa) of a column of this material, buckling over length le across thickness d.
function columnStress(dv, le, d, cd) {
  const sl = le / d;
  if (dv.kind === 'wood') {
    const Fs = dv.Fc * cd, FcE = 0.822 * dv.Emin / (sl * sl), a = FcE / Fs, u = (1 + a) / 1.6;
    return Fs * (u - Math.sqrt(Math.max(0, u * u - a / 0.8)));
  }
  if (dv.kind === 'metal') {
    const Fe = Math.PI * Math.PI * dv.E / (12 * sl * sl);        // rectangle: r = d / sqrt(12)
    return (dv.Fy / Fe <= 2.25 ? Math.pow(0.658, dv.Fy / Fe) * dv.Fy : 0.877 * Fe) / 1.67;
  }
  return dv.Fc * Math.max(0.1, 1 - (sl / 40.4) * (sl / 40.4));
}
// A post or stud on its own: what it may carry and why. For tests and the inspector.
export function columnCapacity({ b, d, lengthM, material: id, duration = 'live' }) {
  const dv = designValues(id); if (!dv) return null;
  const t = Math.min(b, d), F = columnStress(dv, lengthM, t, CD[duration] || 1), I = Math.max(b, d) * t * t * t / 12;
  return { capacityN: F * b * d, stressPa: F, slenderness: lengthM / t, eulerN: Math.PI * Math.PI * dv.Emin * I / (lengthM * lengthM), eulerMeanN: Math.PI * Math.PI * dv.E * I / (lengthM * lengthM) };
}

// ---------------------------------------------------------------------------------------- beam statics
// A straight member of length L on point supports at xs (sorted, at least two), continuous over them
// (three-moment equation), with overhangs. dist: [a, b, w] N/m between a and b; pts: [x, P] N. Downward positive.
// Returns reactions R (N), the greatest bending moment M (N.m) and shear V (N), and deflection: dM the greatest
// mid-span or tip deflection (m), dr the greatest deflection as a fraction of its span (a cantilever counts twice its length).
export function analyseBeam(L, xs, dist, pts, EI = 1) {
  const n = xs.length; if (n < 2) return null;
  const Ms = new Array(n).fill(0), tl = new Array(n - 1).fill(0), tr = new Array(n - 1).fill(0), RL = new Array(n - 1).fill(0), W = new Array(n - 1).fill(0);
  let wl = 0, wr = 0; const x0 = xs[0], xn = xs[n - 1];
  for (const [a, b, w] of dist) {
    if (a < x0) { const hi = Math.min(b, x0); wl += w * (hi - a); Ms[0] -= w * (hi - a) * (x0 - (a + hi) / 2); }
    if (b > xn) { const lo = Math.max(a, xn); wr += w * (b - lo); Ms[n - 1] -= w * (b - lo) * ((lo + b) / 2 - xn); }
  }
  for (const [x, P] of pts) { if (x < x0) { wl += P; Ms[0] -= P * (x0 - x); } else if (x > xn) { wr += P; Ms[n - 1] -= P * (x - xn); } }
  for (let i = 0; i < n - 1; i++) {
    const p = xs[i], l = xs[i + 1] - p; if (l <= 0) continue;
    for (const [a, b, w] of dist) {
      const a1 = Math.max(a, p) - p, a2 = Math.min(b, p + l) - p; if (a2 <= a1) continue;
      const f = (c) => l * l * c * c - l * c * c * c + c * c * c * c / 4, g = (c) => l * l * c * c / 2 - c * c * c * c / 4;
      tl[i] += w * (f(a2) - f(a1)) / l; tr[i] += w * (g(a2) - g(a1)) / l;
      RL[i] += w * (a2 - a1) * (l - (a1 + a2) / 2) / l; W[i] += w * (a2 - a1);
    }
    for (const [x, P] of pts) {
      if (x < p || x > p + l || (x === p + l && i < n - 2)) continue;
      const a = x - p, b = l - a;
      tl[i] += P * a * b * (l + b) / l; tr[i] += P * a * b * (l + a) / l; RL[i] += P * b / l; W[i] += P;
    }
  }
  if (n > 2) {                                                   // interior support moments (Thomas algorithm)
    const m = n - 2, cp = new Array(m), dp = new Array(m);
    for (let k = 0; k < m; k++) {
      const i = k + 1, l0 = xs[i] - xs[i - 1], l1 = xs[i + 1] - xs[i];
      let rhs = -(tr[i - 1] + tl[i]); if (k === 0) rhs -= Ms[0] * l0; if (k === m - 1) rhs -= Ms[n - 1] * l1;
      const lo = k === 0 ? 0 : l0, diag = 2 * (l0 + l1), up = k === m - 1 ? 0 : l1, den = diag - lo * (k ? cp[k - 1] : 0);
      cp[k] = up / den; dp[k] = (rhs - lo * (k ? dp[k - 1] : 0)) / den;
    }
    for (let k = m - 1; k >= 0; k--) Ms[k + 1] = dp[k] - (k < m - 1 ? cp[k] * Ms[k + 2] : 0);
  }
  const R = new Array(n).fill(0); let vl = -wl;
  for (let i = 0; i < n - 1; i++) { const l = xs[i + 1] - xs[i], vr = RL[i] + (l > 0 ? (Ms[i + 1] - Ms[i]) / l : 0); R[i] = vr - vl; vl = vr - W[i]; }
  R[n - 1] = wr - vl;
  // walk the member for the greatest shear and moment: events are load edges, point loads and supports
  const ev = [];
  for (let k = 0; k < dist.length; k++) { const d = dist[k]; if (d[1] > d[0]) { ev.push([Math.max(0, d[0]), 0, d[2]]); ev.push([Math.min(L, d[1]), 0, -d[2]]); } }
  for (let k = 0; k < pts.length; k++) ev.push([pts[k][0], -pts[k][1], 0]);
  for (let i = 0; i < n; i++) ev.push([xs[i], R[i], 0]);
  ev.sort((a, b) => a[0] - b[0]);
  let V = 0, M = 0, Vmax = 0, Mmax = 0, w = 0, x = 0;
  for (let k = 0; k <= ev.length; k++) {
    const nx = k < ev.length ? ev[k][0] : L, sg = nx - x;
    if (sg > 0) {
      if (w > 0 && V > 0 && V / w < sg) { const m = Math.abs(M + V * V / (2 * w)); if (m > Mmax) Mmax = m; }
      M += V * sg - w * sg * sg / 2; V -= w * sg; x = nx;
      if (Math.abs(V) > Vmax) Vmax = Math.abs(V); if (Math.abs(M) > Mmax) Mmax = Math.abs(M);
    }
    if (k < ev.length) { V += ev[k][1]; w += ev[k][2]; if (Math.abs(V) > Vmax) Vmax = Math.abs(V); }
  }
  // deflection: mid-span of each span, and the tip of each overhang
  let dM = 0, dr = 0, span = 0, over = 0;
  for (let i = 0; i < n - 1; i++) {
    const p = xs[i], l = xs[i + 1] - p, h = l / 2; if (l <= 0) continue; span = Math.max(span, l);
    const g = (c) => 1.5 * l * l * c * c - c * c * c * c; let d = 0;
    for (const [a, b, w] of dist) {
      const a1 = Math.max(a, p) - p, a2 = Math.min(b, p + l) - p; if (a2 <= a1) continue;
      if (a1 < h) d += w * (g(Math.min(a2, h)) - g(a1));
      if (a2 > h) d += w * (g(l - Math.max(a1, h)) - g(l - a2));
    }
    for (const [x, P] of pts) if (x > p && x < p + l) { const a = Math.min(x - p, p + l - x); d += P * a * (3 * l * l - 4 * a * a); }
    d = d / (48 * EI) + (Ms[i] + Ms[i + 1]) * l * l / (16 * EI);
    if (d > dM) dM = d; if (d / l > dr) dr = d / l;
  }
  for (const side of [0, 1]) {
    const a = side ? L - xn : x0; if (a < 0.05) continue; over = Math.max(over, a);
    let d = 0;
    for (const [p, q, w] of dist) {
      const c1 = side ? Math.max(p, xn) - xn : x0 - Math.min(q, x0), c2 = side ? q - xn : x0 - p;
      if (c2 <= Math.max(c1, 0)) continue; const lo = Math.max(c1, 0), f = (c) => a * c * c * c - c * c * c * c / 4;
      d += w * (f(Math.min(c2, a)) - f(lo)) / 6;
    }
    for (const [x, P] of pts) { const c = side ? x - xn : x0 - x; if (c > 0) d += P * c * c * (3 * a - c) / 6; }
    const i = side ? n - 2 : 0, l = xs[i + 1] - xs[i];
    const th = side ? tr[i] + (2 * Ms[n - 1] + Ms[n - 2]) * l : tl[0] + (2 * Ms[0] + Ms[1]) * l;
    d = d / EI - a * th / (6 * EI);
    if (d > dM) dM = d; if (d / (2 * a) > dr) dr = d / (2 * a);
  }
  return { R, M: Mmax, V: Vmax, dM, dr, span, over, Ms };
}

// Utilisation of a rectangular spanning member from its load effects by component [dead, live, roof live, snow].
// eff: { M, V, dr } arrays of four. Returns the governing check.
function spanCheck(dv, b, d, eff, rep, limit, cosT = 1) {
  const S = b * d * d / 6, A = b * d, kf = sizeFactor(dv, d) * (rep ? REP : 1);
  const M = eff.M, V = eff.V, r = eff.dr, R = [M[2] + M[3], V[2] + V[3], r[2] + r[3]], cdR = M[3] > 0 || V[3] > 0 ? CD.snow : CD.roofLive;
  let ub = 0, uv = 0, mb = 0, vb = 0, cb = 1, cv = 1;
  const combo = (kl, kr, cd) => {
    const m = M[0] + kl * M[1] + kr * R[0], v = (V[0] + kl * V[1] + kr * R[1]) * cosT, u1 = m / S / (dv.Fb * kf * cd), u2 = 1.5 * v / A / (dv.Fv * cd);
    if (u1 > ub) { ub = u1; mb = m; cb = cd; } if (u2 > uv) { uv = u2; vb = v; cv = cd; }
  };
  combo(0, 0, CD.dead); if (M[1] > 0 || V[1] > 0) combo(1, 0, CD.live);
  if (R[0] > 0 || R[1] > 0) { combo(0, 1, cdR); if (M[1] > 0) combo(0.75, 0.75, cdR); }
  const dfl = (r[0] + Math.max(r[1], R[2], 0.75 * (r[1] + R[2]))) / cosT, ud = dfl * limit;
  if (!(dv.Fb > 0)) return { u: UMAX, governs: 'bending', demand: 0, capacity: 0, unit: 'MPa', ub: UMAX, uv: 0, ud: 0 };
  const bend = { u: ub, governs: 'bending', demand: mb / S / 1e6, capacity: dv.Fb * kf * cb / 1e6, unit: 'MPa', ub, uv, ud };
  const shear = { u: uv, governs: 'shear', demand: 1.5 * vb / A / 1e6, capacity: dv.Fv * cv / 1e6, unit: 'MPa', ub, uv, ud };
  const st = ub >= uv ? bend : shear;                            // strength: what could break it
  if (st.u >= ud) return { ...st, st };
  return { u: ud, governs: 'deflection', demand: dfl, capacity: 1 / limit, unit: 'span', ub, uv, ud, st };
}
// A row of equal joists or rafters under uniform load on one simple span: the span-table case.
// deflectionLoad 'total' (the solver's rule) or 'live' (the building-code span tables' rule).
export function joistCheck({ b, d, spacing, span, deadKPa, liveKPa, material: id, limit = 240, deflectionLoad = 'total', repetitive = true, roof = false }) {
  const dv = designValues(id), EI = dv.E * b * d * d * d / 12, one = analyseBeam(span, [0, span], [[0, span, 1]], [], EI);
  const wd = deadKPa * 1000 * spacing, wl = liveKPa * 1000 * spacing, eff = { M: [one.M * wd, 0, 0, 0], V: [one.V * wd, 0, 0, 0], dr: [deflectionLoad === 'live' ? 0 : one.dr * wd, 0, 0, 0] };
  const k = roof ? 3 : 1; eff.M[k] = one.M * wl; eff.V[k] = one.V * wl; eff.dr[k] = one.dr * wl;
  return spanCheck(dv, b, d, eff, repetitive, limit);
}
export function maxSpan(o) {
  let lo = 0.2, hi = 12;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (joistCheck({ ...o, span: m }).u <= 1) lo = m; else hi = m; }
  return lo;
}

// ---------------------------------------------------------------------------------------- climate loads
const normPdf = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
function normCdf(x) {   // Abramowitz and Stegun 26.2.17
  const k = 1 / (1 + 0.2316419 * Math.abs(x)), p = normPdf(x) * k * (0.31938153 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
const snowCache = new Map();
// Design ground snow load (kPa) for a climate: the water in a normal winter's whole snowfall, lying at
// once. Each month's normal precipitation counts by the share that falls as snow (all at 0 C, none at 2 C, as
// in the weather model) given the month's mean and the climate's spread of winter air temperature. In an
// ordinary winter thaws take some of it; in a rare winter more falls: for continental sites the two about
// cancel, and the rule lands near the code values (2.2 kPa for Burlington, Vermont against 1.9 to 2.4 in ASCE 7; 2.1 kPa for Moscow against 1.5 to 2.1
// in SP 20.13330; Lisbon: nil).
export function designSnowKPa(climateId) {
  if (snowCache.has(climateId)) return snowCache.get(climateId);
  const c = CLIMATES[climateId] || CLIMATES.temperate, sd = (c.anomalySdC && c.anomalySdC[0]) || 4;
  const pos = (lim, T) => (lim - T) * normCdf((lim - T) / sd) + sd * normPdf((lim - T) / sd);     // E[max(0, lim - T)]
  let mm = 0; for (let m = 0; m < 12; m++) mm += c.precipMm[m] * (pos(2, c.tempC[m]) - pos(0, c.tempC[m])) / 2;
  const kPa = mm * G / 1000; snowCache.set(climateId, kPa);
  return kPa;
}
const mu1 = (deg) => (deg <= 30 ? 0.8 : deg >= 60 ? 0 : 0.8 * (60 - deg) / 30);
function roofLive(deg) { const F = 12 * Math.tan(deg * Math.PI / 180); return Math.max(ROOF_LIVE_MIN, ROOF_LIVE * (F <= 4 ? 1 : F >= 12 ? 0.6 : 1.2 - 0.05 * F)); }
const upliftC = (deg) => (deg < 10 ? 0.9 : 0.6) * 0.85 + 0.18;   // ASCE 7 fig. 27.3-1 roof suction x gust factor + internal pressure

// What the weather asks of a structure now. Pure: the same weather and settings give the same answer.
export function environment(weather, cfg = {}) {
  const w = weather || {}, climate = (w.site && w.site.climate) || 'temperate';
  const swe = Number.isFinite(w.snowSweMm) ? w.snowSweMm : (Number.isFinite(w.snowDepthM) ? w.snowDepthM * (Number.isFinite(w.snowDensityKgM3) ? w.snowDensityKgM3 : ASSUMED_SNOW_DENSITY) : 0);
  const snowDesign = Number.isFinite(cfg.designSnowKPa) ? cfg.designSnowKPa : designSnowKPa(climate);
  const gustDesign = Number.isFinite(cfg.designGustMs) ? cfg.designGustMs : DESIGN_GUST_MS;
  const snowBand = Math.max(0, Math.ceil(swe * G / 1000 / SNOW_BAND_KPA - 1e-9)), gust = GUST_FACTOR * (Number.isFinite(w.windMs) ? w.windMs : 0);
  const windBand = gust <= gustDesign ? 0 : Math.ceil((gust - gustDesign) / WIND_BAND_MS);
  const snowNow = snowBand * SNOW_BAND_KPA, soil = SOILS[cfg.soil] || SOILS[DEFAULT_SOIL];
  return { snowBand, windBand, snowNowKPa: snowNow, snowDesignKPa: snowDesign, snowKPa: Math.max(snowNow, snowDesign), snowIsNow: snowNow > snowDesign,
    gustDesignMs: gustDesign, gustMs: gustDesign + windBand * WIND_BAND_MS, windIsNow: windBand > 0, exposure: EXPOSURE[cfg.exposure] ? cfg.exposure : 'open',
    soil: SOILS[cfg.soil] ? cfg.soil : DEFAULT_SOIL, soilName: soil.name, allowableKPa: Number.isFinite(cfg.allowableKPa) ? cfg.allowableKPa : soil.allowableKPa };
}
function windQ(env, z) { const e = EXPOSURE[env.exposure]; return 0.613 * 2.01 * Math.pow(Math.max(z, e[2]) / e[1], 2 / e[0]) * KD * env.gustMs * env.gustMs; }

// ---------------------------------------------------------------------------------------- geometry
const num = (v, d) => (Number.isFinite(v) ? v : d);
const r0 = (v) => (Number.isFinite(v) ? Math.round(v) : 0);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0);
const cap = (u) => (Number.isFinite(u) ? Math.min(UMAX, Math.max(0, u)) : UMAX);
const m1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const mm = (v) => String(Math.round(v * 1000));
const kN = (v) => (v >= 9500 ? String(Math.round(v / 1000)) : (v / 1000).toFixed(1));
const add = (a, b, k = 1) => { a[0] += b[0] * k; a[1] += b[1] * k; a[2] += b[2] * k; a[3] += b[3] * k; };
const tot = (v) => v[0] + Math.max(v[1], v[2] + v[3], 0.75 * (v[1] + v[2] + v[3]));     // the worst gravity combination
function inPoly(P, x, z) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; }
function segDist(ax, az, bx, bz, x, z) { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0; return Math.hypot(x - ax - t * dx, z - az - t * dz); }
function nearPoly(P, x, z, tol) { if (inPoly(P, x, z)) return true; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if (segDist(P[j].x, P[j].z, P[i].x, P[i].z, x, z) <= tol) return true; return false; }
function polyArea(P) { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += P[j].x * P[i].z - P[i].x * P[j].z; return Math.abs(a) / 2; }
// where the line through (ox, oz) along (dx, dz) lies inside polygon P: [from, to] along the line, or null
function clipLine(P, ox, oz, dx, dz) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const ex = P[i].x - P[j].x, ez = P[i].z - P[j].z, den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue;
    const u = ((P[j].x - ox) * -dz + (P[j].z - oz) * dx) / -den; if (u < -1e-9 || u > 1 + 1e-9) continue;
    const t = ((P[j].x - ox) * ez - (P[j].z - oz) * ex) / den; if (t < lo) lo = t; if (t > hi) hi = t;
  }
  return hi - lo > 1e-6 ? [lo, hi] : null;
}
// where a strip (origin o, unit direction d, length len) crosses a line element; null if it does not or runs alongside
function cross(ox, oz, dx, dz, len, e, tol = 0.2) {
  const den = dx * e.uz - dz * e.ux; if (Math.abs(den) < 0.26 || !(e.len > 0)) return null;
  const px = e.ax - ox, pz = e.az - oz, x = (px * e.uz - pz * e.ux) / den, t = (px * dz - pz * dx) / den;
  if (x < -tol || x > len + tol || t < -tol || t > e.len + tol) return null;
  return [Math.max(0, Math.min(len, x)), Math.max(0, Math.min(e.len, t))];
}

const BAY_ROLES = { cavity: 1, infill: 1, 'joist-bay': 1, 'rafter-bay': 1, insulation: 1 };
const MEMBER_KINDS = { stud: 1, plate: 1, header: 1, joist: 1, rafter: 1, sheathing: 1, membrane: 1, cladding: 1, roofing: 1, insulation: 1, lining: 1, brace: 1 };
const LINE_GROUND = { skid: 1, stemwall: 1 }, AREA_GROUND = { foundation: 1, slab: 1, footing: 1 };
function layerPa(layers) { let s = 0; if (layers) for (const l of layers) { const m = material(l.material); if (m && m.class !== 'fluid') s += m.densityKgM3 * num(l.thickness, 0) * G; } return s; }
function bayOf(layers) { let best = null; if (layers && layers.length > 1) for (const l of layers) { const m = material(l.material); if ((BAY_ROLES[l.role] || (m && (m.class === 'fluid' || m.class === 'insulation'))) && l.thickness >= 0.05 && (!best || l.thickness > best.thickness)) best = l; } return best; }
function woodOf(p, bay) { if (p.layers) for (const l of p.layers) if (l !== bay) { const dv = designValues(l.material); if (dv && dv.kind === 'wood') return l.material; } const dv = designValues(p.material); return dv && dv.kind === 'wood' ? p.material : FRAMING; }
const sec = (p, b, d) => ({ b: num(p.section && p.section.b, b), d: num(p.section && p.section.d, d) });
const plen = (p) => num(p.length, p.a && p.b ? Math.hypot(p.b.x - p.a.x, p.b.z - p.a.z) : 0);
function memberWeight(p) {
  const m = material(p.material); if (!m) return 0;
  if (p.section) { const l = Math.max(plen(p), p.a && p.b && Math.hypot(p.b.x - p.a.x, p.b.z - p.a.z) < 0.01 ? num(p.y1 - p.y0, 0) : 0); return num(p.section.b, 0) * num(p.section.d, 0) * l * m.densityKgM3 * G; }
  return num(p.area, 0) * num(p.thickness, 0) * m.densityKgM3 * G;
}

// ---------------------------------------------------------------------------------------- the solver
// pieces: the site's pieces. env: from environment(). Returns the structure state's computed part (plain JSON).
export function solveStructure(pieces, env) {
  const els = [], byId = new Map(), mem = new Map(), issues = [], members = {}, foundations = {}, racking = {};
  const totals = { appliedN: 0, groundN: 0, unsupportedN: 0 };
  // an assembly that lists members reports built only when all of them are: it stands as soon as any one is
  const hasKids = (p) => Array.isArray(p.members) && p.members.length > 0;
  const live = (pieces || []).filter((p) => p && p.id != null && (p.built !== false || hasKids(p)));
  const ids = new Set(live.map((p) => p.id)), kidsOf = new Map(), skip = new Set(), ties = new Set();
  for (const p of live) if (p.parent != null && !hasKids(p)) { if (!kidsOf.has(p.parent)) kidsOf.set(p.parent, []); kidsOf.get(p.parent).push(p); if (p.kind === 'joist' && p.type === 'ceiling' && p.roof != null) ties.add(p.roof); }
  for (const p of live) if (p.parent != null && MEMBER_KINDS[p.kind] && ids.has(p.parent) && !hasKids(p)) { if (!mem.has(p.parent)) mem.set(p.parent, []); mem.get(p.parent).push(p); }
  for (const p of live) {
    if (!hasKids(p)) continue; const k = kidsOf.get(p.id) || [];
    if (!k.length) { skip.add(p.id); continue; }                 // planned, nothing of it built yet
    if (p.kind === 'foundation') {                                // a slab or plinth is one solid base; piers, skids and stem walls stand for themselves
      if (p.type === 'plinth' || k.some((m) => m.kind === 'slab')) for (const m of k) { if (m.kind === 'slab' || m.kind === 'footing') skip.add(m.id); }
      else skip.add(p.id);
    }
  }
  const issue = (id, severity, governs, utilisation, reason, fix) => issues.push({ pieceId: id, severity, governs, utilisation: r3(cap(utilisation)), reason, fix });

  // ---- elements
  const mk = (p, cls) => {
    const a = p.a || { x: 0, z: 0 }, b = p.b || a, len = Math.hypot(b.x - a.x, b.z - a.z);
    const e = { i: els.length, p, id: p.id, cls, ax: a.x, az: a.z, bx: b.x, bz: b.z, len, ux: len > 0 ? (b.x - a.x) / len : 1, uz: len > 0 ? (b.z - a.z) / len : 0,
      y0: num(p.y0, 0), y1: num(p.y1, num(p.y0, 0)), sup: [], inbox: [], own: [0, 0, 0, 0], got: [0, 0, 0, 0], ground: false, stable: undefined, group: p.struct == null ? 0 : p.struct, wind: 0 };
    els.push(e); byId.set(p.id, e); return e;
  };
  for (const p of live) {
    const k = p.kind;
    if (skip.has(p.id) || (MEMBER_KINDS[k] && p.parent != null && ids.has(p.parent) && !hasKids(p))) continue;
    if (k === 'wall' || LINE_GROUND[k] || (k === 'footing' && !p.outline && plen(p) > 0.05)) {
      const e = mk(p, 'wall'); e.h = Math.max(0.05, e.y1 - e.y0); e.explicit = Array.isArray(p.members) && p.members.length > 0; e.ms = mem.get(p.id) || [];
      e.opens = (p.openings || []).map((o) => [num(o.offset, 0), num(o.offset, 0) + num(o.width, 0)]).filter((o) => o[1] > o[0]).sort((x, y) => x[0] - y[0]);
      let cut = 0; for (const o of e.opens) cut += o[1] - o[0]; e.net = Math.max(0, e.len - cut);
      const L = p.layers || [], solid = L.find((l) => l.role === 'structure'), bay = bayOf(L);
      if (LINE_GROUND[k] || k === 'footing') { e.ground = k !== 'stemwall'; e.viaGround = true; const s0 = sec(p, num(p.thickness, 0.14), e.h), s = { b: k === 'footing' ? Math.max(s0.b, s0.d) : Math.min(s0.b, s0.d) }; e.t = s.b; e.wm = { type: 'solid', t: s.b, mat: p.material }; e.own[0] = memberWeight(p) || s.b * e.h * e.len * ((material(p.material) || {}).densityKgM3 || 0) * G; }
      else if (e.explicit) {
        const studs = e.ms.filter((q) => q.kind === 'stud').map((q) => ({ s: (q.a.x - e.ax) * e.ux + (q.a.z - e.az) * e.uz, ...sec(q, B_IMPLIED, 0.089), mat: q.material, id: q.id })).sort((x, y) => x.s - y.s);
        const heads = e.ms.filter((q) => q.kind === 'header').map((q) => { const s0 = (q.a.x - e.ax) * e.ux + (q.a.z - e.az) * e.uz, s1 = (q.b.x - e.ax) * e.ux + (q.b.z - e.az) * e.uz; return { s0: Math.min(s0, s1), s1: Math.max(s0, s1), ...sec(q, B_IMPLIED, 0.14), mat: q.material, id: q.id }; });
        e.t = num(p.thickness, 0.1); e.wm = { type: 'framed', explicit: true, studs, heads, mat: studs.length ? studs[0].mat : FRAMING, b: studs.length ? Math.min(...studs.map((q) => q.b)) : B_IMPLIED, d: studs.length ? Math.min(...studs.map((q) => q.d)) : 0.089 };
        for (const q of e.ms) e.own[0] += memberWeight(q);
        let cu = 0, ga = 0, braced = false;
        for (const kind of ['sheathing', 'cladding', 'lining']) { const q = e.ms.find((x) => x.kind === kind); if (!q) continue; const m = material(q.material); if (!m || m.class !== 'wood') continue; const t = /plywood|osb/.test(q.material) ? BRACE.panel : BRACE.boards; cu += t[0]; ga += t[1]; braced = true; }
        const nb = e.ms.filter((q) => q.kind === 'brace').length;
        e.rack = { cap: (cu || BRACE.bare[0]) * e.net + nb * BRACE_N, k: (ga || BRACE.bare[1]) * e.net + nb * 3e5, braced: braced || nb > 0, framed: true };
        e.open = !braced;                                      // an open frame: the wind passes between the studs
      } else if (solid || (!bay && L.length)) {
        const mat = solid ? solid.material : p.material, t = solid ? solid.thickness : num(p.thickness, 0.1), dv = designValues(mat);
        e.t = t; e.wm = p.type === 'rail' ? { type: 'none' } : { type: 'solid', t, mat }; e.own[0] = layerPa(L) * num(p.netArea, num(p.area, e.len * e.h));
        const br = dv && dv.kind === 'earth' ? BRACE.earth : BRACE.solid; e.rack = { cap: br[0] * e.net, k: br[1] * e.net, braced: true };
      } else if (bay) {
        const mat = woodOf(p, bay), d = bay.thickness, rho = material(mat).densityKgM3;
        e.t = num(p.thickness, d); e.wm = { type: 'framed', mat, b: B_IMPLIED, d, note: `${mm(B_IMPLIED)} x ${mm(d)} mm studs at ${STUD_S} m assumed, from the ${mm(d)} mm ${bay.role || 'cavity'}` };
        e.own[0] = layerPa(L) * num(p.netArea, e.len * e.h) + (e.net / STUD_S * e.h + 3 * e.len) * B_IMPLIED * d * rho * G;
        let cu = 0, ga = 0;
        for (const l of L) { if (l === bay) continue; const m = material(l.material); if (!m) continue; const t = m.class === 'wood' && l.thickness >= 0.009 ? (/plywood|osb/.test(l.material) ? BRACE.panel : BRACE.boards) : m.class === 'earth' ? BRACE.earth : null; if (t) { cu += t[0]; ga += t[1]; } }
        if (material(bay.material) && material(bay.material).class === 'earth') { cu += BRACE.earth[0]; ga += BRACE.earth[1]; }
        e.rack = { cap: (cu || BRACE.bare[0]) * e.net, k: (ga || BRACE.bare[1]) * e.net, braced: cu > 0, framed: true };
      } else { e.t = num(p.thickness, 0.1); e.wm = { type: 'none' }; e.own[0] = memberWeight(p); }
      e.b = e.t;
    } else if (k === 'beam' || k === 'joist' || k === 'rafter' || k === 'header' || k === 'plate') {
      const e = mk(p, 'beam'), s = sec(p, num(p.thickness, 0.1), num(p.height, Math.max(0.05, e.y1 - e.y0))); e.b = s.b; e.d = s.d; e.t = s.b;
      e.own[0] = s.b * s.d * e.len * ((material(p.material) || {}).densityKgM3 || 0) * G;
      e.board = p.type === 'ridge' && s.b < 0.06;            // a ridge board only lines the rafters up: it cannot carry them
    } else if (k === 'post' || k === 'stud' || k === 'pier' || (k === 'footing' && !p.outline)) {
      const e = mk(p, 'post'), t = num(p.thickness, 0.1), s = sec(p, t, t); e.b = s.b; e.d = s.d; e.t = Math.min(s.b, s.d); e.h = Math.max(0.05, e.y1 - e.y0);
      e.solidity = p.type === 'chimney' ? 0.75 : 1;          // a chimney is a hollow stack: walls a quarter of its width
      e.own[0] = s.b * s.d * e.h * e.solidity * ((material(p.material) || {}).densityKgM3 || 0) * G; if (k === 'footing') e.ground = true; e.viaGround = k === 'pier' || k === 'footing';
    } else if (k === 'floor') {
      const e = mk(p, 'floor'); e.P = p.outline && p.outline.length >= 3 ? p.outline : null; e.area = num(p.area, e.P ? polyArea(e.P) : 0);
      e.explicit = Array.isArray(p.members) && p.members.length > 0; e.ms = mem.get(p.id) || [];
      if (e.explicit) { for (const q of e.ms) e.own[0] += memberWeight(q); e.joists = e.ms.filter((q) => q.kind === 'joist' && q.type !== 'rim' && q.type !== 'ceiling'); e.deck = e.ms.some((q) => q.kind === 'sheathing' || q.kind === 'lining' || q.kind === 'cladding'); }
      else {
        const bay = bayOf(p.layers), mat = woodOf(p, bay), d = bay ? bay.thickness : D_DEFAULT;
        e.fr = { b: B_IMPLIED, d, mat, s: JOIST_S, note: `${mm(B_IMPLIED)} x ${mm(d)} mm joists at ${JOIST_S} m assumed${bay ? `, from the ${mm(d)} mm joist bay` : ' (the build-up names none)'}` };
        e.own[0] = (layerPa(p.layers) + B_IMPLIED * d * material(mat).densityKgM3 * G / JOIST_S) * e.area; e.deck = true;
      }
      if (e.deck) e.own[1] = FLOOR_LIVE * e.area;
    } else if (k === 'roof') {
      const e = mk(p, 'roof'); e.P = p.footprint && p.footprint.length >= 3 ? p.footprint : null; e.deg = num(p.pitchDeg, 0); e.cos = Math.max(0.2, Math.cos(e.deg * Math.PI / 180));
      e.plan = num(p.planArea, e.P ? polyArea(e.P) : 0); e.area = num(p.area, e.plan / e.cos); e.eaveY = num(p.eaveY, e.y0); e.tan = Math.tan(e.deg * Math.PI / 180);
      e.explicit = Array.isArray(p.members) && p.members.length > 0; e.ms = mem.get(p.id) || [];
      if (e.explicit) { for (const q of e.ms) e.own[0] += memberWeight(q); e.rafters = e.ms.filter((q) => q.kind === 'rafter'); e.deck = e.ms.some((q) => q.kind === 'sheathing' || q.kind === 'roofing'); }
      else {
        const bay = bayOf(p.layers), mat = woodOf(p, bay), d = bay ? bay.thickness : D_DEFAULT;
        e.fr = { b: B_IMPLIED, d, mat, s: RAFTER_S, note: `${mm(B_IMPLIED)} x ${mm(d)} mm rafters at ${RAFTER_S} m assumed${bay ? `, from the ${mm(d)} mm rafter bay` : ' (the build-up names none)'}` };
        e.own[0] = (layerPa(p.layers) + B_IMPLIED * d * material(mat).densityKgM3 * G / RAFTER_S) * e.area; e.deck = true;
      }
      if (e.deck) { const s = mu1(e.deg) * env.snowKPa * 1000, lr = roofLive(e.deg); if (s >= lr) e.own[3] = s * e.plan; else e.own[2] = lr * e.plan; }
      const f = p.facing, fl = f ? Math.hypot(f.x, f.z) : 0;
      e.mode = p.type === 'pyramid' || p.type === 'cone' || p.type === 'dome' ? 'radial' : fl > 0.5 && e.deg > 0.5 ? 'slope' : 'flat';
      if (e.mode === 'slope') { e.vx = -f.x / fl; e.vz = -f.z / fl; if (!(e.len > 0)) { e.ux = -e.vz; e.uz = e.vx; } }
    } else if (AREA_GROUND[k]) {
      const e = mk(p, 'ground'); e.ground = true; const kk = hasKids(p) ? kidsOf.get(p.id) || [] : null; e.P = p.outline && p.outline.length >= 3 ? p.outline : null; e.area = num(p.area, e.P ? polyArea(e.P) : 0); e.h = Math.max(0, e.y1 - e.y0);
      e.posts = p.type === 'posts'; const rho = (material(p.material) || {}).densityKgM3 || 0;
      if (e.posts) { let per = 0; if (e.P) for (let i = 0, j = e.P.length - 1; i < e.P.length; j = i++) per += Math.hypot(e.P[i].x - e.P[j].x, e.P[i].z - e.P[j].z); e.n = Math.max(1, Math.round(e.area / 4 + per / 4 + 1)); e.own[0] = e.n * POSTS_FD.post * POSTS_FD.post * e.h * rho * G; }
      else if (kk && kk.some((m) => m.kind === 'slab')) { for (const m of kk) e.own[0] += m.kind === 'slab' ? num(m.area, e.area) * 0.1 * ((material(m.material) || {}).densityKgM3 || 0) * G : 0; e.h = 0.1; }
      else e.own[0] = e.area * e.h * rho * G;
      e.lines = [];
    } else if (k === 'stair') {
      const e = mk(p, 'stair'), w = num(p.width, 0.9), run = Math.max(e.len, w), rho = (material(p.material) || material(FRAMING)).densityKgM3;
      e.own[0] = (num(p.steps, run * 4) * w * 0.25 * 0.038 + 2 * 0.038 * 0.286 * Math.hypot(run, num(p.height, e.y1 - e.y0))) * rho * G; e.own[1] = FLOOR_LIVE * w * run;
    }
  }
  for (const p of live) if ((p.kind === 'door' || p.kind === 'window') && p.wall != null && byId.has(p.wall)) byId.get(p.wall).own[0] += layerPa(p.layers) * num(p.area, 0);
  for (const e of els) { totals.appliedN += e.own[0] + e.own[1] + e.own[2] + e.own[3]; e.bb = bbox(e); }
  function bbox(e) {
    const P = e.P; if (!P) return [Math.min(e.ax, e.bx) - 0.4, Math.min(e.az, e.bz) - 0.4, Math.max(e.ax, e.bx) + 0.4, Math.max(e.az, e.bz) + 0.4];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const q of P) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.z < z0) z0 = q.z; if (q.z > z1) z1 = q.z; }
    return [x0 - 0.4, z0 - 0.4, x1 + 0.4, z1 + 0.4];
  }
  const baseY = new Map(), roofN = new Map();
  for (const e of els) { const y = baseY.get(e.group); if (y === undefined || e.y0 < y) baseY.set(e.group, e.y0); if (e.cls === 'roof' && e.p.roof != null) roofN.set(e.p.roof, (roofN.get(e.p.roof) || 0) + 1); }
  const hit = (a, b) => a.bb[0] <= b.bb[2] && b.bb[0] <= a.bb[2] && a.bb[1] <= b.bb[3] && b.bb[1] <= a.bb[3];
  // a coarse grid so each piece is only compared with its neighbours
  const CELL = 8, grid = new Map(); let stamp = 0;
  const cellsOf = (e, fn) => { const x0 = Math.floor(e.bb[0] / CELL), x1 = Math.floor(e.bb[2] / CELL), z0 = Math.floor(e.bb[1] / CELL), z1 = Math.floor(e.bb[3] / CELL); for (let x = x0; x <= x1 && x - x0 < 64; x++) for (let z = z0; z <= z1 && z - z0 < 64; z++) fn(x * 65536 + z); };
  for (const e of els) if (e.cls === 'wall' || e.cls === 'beam' || e.cls === 'post') cellsOf(e, (k) => { const c = grid.get(k); if (c) c.push(e); else grid.set(k, [e]); });
  const nearOf = (e, cls2) => { const out = []; stamp++; cellsOf(e, (k) => { const c = grid.get(k); if (c) for (const o of c) if (o.stamp !== stamp) { o.stamp = stamp; if ((cls2 ? o.cls === 'post' : o.cls !== 'post') && o !== e && hit(e, o)) out.push(o); } }); return out.sort((a, b) => a.i - b.i); };
  const lines = els.filter((e) => e.cls === 'wall' || e.cls === 'beam'), posts = els.filter((e) => e.cls === 'post'), grounds = els.filter((e) => e.cls === 'ground'), floors = els.filter((e) => e.cls === 'floor');
  const groundUnder = (x, z, y) => grounds.find((g) => Math.abs(g.y1 - y) <= TOLY && g.P && nearPoly(g.P, x, z, 0.3));
  for (const f of floors) f.gnd = grounds.find((g) => g.p.floor === f.id) || (f.P ? grounds.find((g) => hit(g, f) && Math.abs(g.y1 - f.y0) <= TOLY && g.P && nearPoly(g.P, (f.bb[0] + f.bb[2]) / 2, (f.bb[1] + f.bb[3]) / 2, 0.3)) : null);
  const floorAt = (x, z, y) => floors.find((f) => f.P && (Math.abs(f.y0 - y) <= TOLY || Math.abs(f.y1 - y) <= TOLY) && nearPoly(f.P, x, z, 0.25));
  // along e: the stretch [t0, t1] that line c runs alongside, or null
  const along = (e, c, tol = 0.2) => {
    if (Math.abs(e.ux * c.uz - e.uz * c.ux) > 0.1) return null;
    const d0 = (c.ax - e.ax) * -e.uz + (c.az - e.az) * e.ux; if (Math.abs(d0) > tol + (c.t || 0) / 2) return null;
    const s0 = (c.ax - e.ax) * e.ux + (c.az - e.az) * e.uz, s1 = (c.bx - e.ax) * e.ux + (c.bz - e.az) * e.uz, lo = Math.max(0, Math.min(s0, s1)), hi = Math.min(e.len, Math.max(s0, s1));
    return hi - lo > 0.1 ? [lo, hi] : null;
  };
  const onGroundOk = (e) => e.p.storey == null || e.p.storey <= 0;

  // ---- what could carry what (geometry only)
  for (const e of els) {
    if (e.cls === 'wall') {
      if (e.ground) continue;
      let covered = 0; const mx = (e.ax + e.bx) / 2, mz = (e.az + e.bz) / 2;
      for (const c of nearOf(e)) { if (c.y1 < e.y0 - 0.5 || c.y1 > e.y0 + 0.15 || c.y0 > e.y0 - 0.1) continue; const o = along(e, c); if (o) { e.sup.push({ el: c, w: o[1] - o[0], t: ((c.ax - e.ax) * e.ux + (c.az - e.az) * e.uz) }); covered += o[1] - o[0]; } }
      const rest = Math.max(0, e.len - covered);
      if (rest > 0.05 || !e.sup.length) {
        const g = groundUnder(mx, mz, e.y0), f = g ? null : floorAt(mx, mz, e.y0);
        if (g) e.sup.push({ el: g, w: rest || e.len }); else if (f && f.gnd) e.sup.push({ el: f.gnd, w: rest || e.len }); else if (f) e.sup.push({ el: f, w: rest || e.len });
      }
      if (!e.sup.length && p0(e) !== 'gable' && (onGroundOk(e) || e.viaGround)) e.ground = true;
    } else if (e.cls === 'beam') {
      const pts = [];
      for (const c of nearOf(e, true)) { if (c.y1 < e.y0 - TOLY || c.y0 > e.y0 - 0.05 || c.y1 > e.y1 + 0.6) continue; if (segDist(e.ax, e.az, e.bx, e.bz, c.ax, c.az) <= c.t / 2 + e.b / 2 + 0.12) pts.push({ el: c, t: Math.max(0, Math.min(e.len, (c.ax - e.ax) * e.ux + (c.az - e.az) * e.uz)), w: c.t }); }
      for (const c of nearOf(e)) {
        const under = c.cls === 'beam' ? c.y1 >= e.y0 - TOLY && c.y1 <= e.y0 + 0.12 : p0(c) === 'gable' ? e.y0 >= c.y0 - 0.1 && e.y0 <= c.y1 + TOLY : Math.abs(c.y1 - e.y0) <= TOLY || (c.y1 > e.y0 && c.y0 < e.y0 - 0.5);
        if (!under || c.y0 > e.y0 - 0.04) continue;
        const o = along(e, c), x = o ? null : cross(e.ax, e.az, e.ux, e.uz, e.len, c, 0.15);
        if (o) { pts.push({ el: c, t: o[0], w: c.t, solid: o[1] }); pts.push({ el: c, t: o[1], w: c.t }); } else if (x) pts.push({ el: c, t: x[0], w: c.t, tc: x[1] });
      }
      for (const g of grounds) if (g.P && Math.abs(g.y1 - e.y0) <= TOLY && hit(e, g)) for (const t of [0, e.len]) if (nearPoly(g.P, e.ax + e.ux * t, e.az + e.uz * t, 0.3)) pts.push({ el: g, t, w: 0.3 });
      pts.sort((a, b) => a.t - b.t || b.el.y1 - a.el.y1);
      for (const q of pts) if (!e.sup.length || q.t - e.sup[e.sup.length - 1].t > 0.08) e.sup.push(q);
    } else if (e.cls === 'post') {
      if (e.ground) continue;
      const lo = e.y0 - TOLY, hi = e.y0 + 0.15;
      const c = nearOf(e, true).find((q) => q.y1 >= lo && q.y1 <= hi && Math.hypot(q.ax - e.ax, q.az - e.az) <= 0.25);
      const b = c ? null : nearOf(e).find((q) => q.y1 >= lo && q.y1 <= hi && segDist(q.ax, q.az, q.bx, q.bz, e.ax, e.az) <= 0.25);
      if (c) e.sup.push({ el: c }); else if (b) e.sup.push({ el: b, t: (e.ax - b.ax) * b.ux + (e.az - b.az) * b.uz });
      else { const g = groundUnder(e.ax, e.az, e.y0), f = g ? null : floorAt(e.ax, e.az, e.y0); if (g) e.sup.push({ el: g }); else if (f && f.gnd) e.sup.push({ el: f.gnd }); else if (f) e.sup.push({ el: f }); else if (onGroundOk(e) || e.viaGround) e.ground = true; }
    } else if (e.cls === 'floor') {
      if (e.gnd) { e.sup.push({ el: e.gnd }); continue; }
      for (const c of nearOf(e)) if (c.y0 < e.y0 - 0.1 && (c.cls === 'beam' ? c.y1 >= e.y0 - 0.35 && c.y1 <= e.y0 + 0.15 : c.y1 >= e.y0 - 0.35)) e.sup.push({ el: c });
      if (!e.sup.length && onGroundOk(e) && !e.explicit) e.ground = true;
    } else if (e.cls === 'roof') {
      for (const c of nearOf(e)) if (c.y1 >= e.eaveY - 0.6 && c.y0 <= e.y1 + 0.3) e.sup.push({ el: c });
    } else if (e.cls === 'stair') {
      const f = floorAt(e.ax, e.az, e.y0) || groundUnder(e.ax, e.az, e.y0); if (f) e.sup.push({ el: f.gnd || f }); else e.ground = true;
    }
  }
  function p0(e) { return e.p.type; }

  // ---- which pieces reach the ground (a beam needs two supports; an infill under a roof hangs from it)
  const stable = (e) => {
    if (e.stable !== undefined) return e.stable;
    e.stable = false;                                              // guards against a loop
    if (e.board) return false;
    let n = 0, solid = false; for (const s of e.sup) if (stable(s.el)) { n++; if (s.solid != null) solid = true; }
    return (e.stable = e.cls === 'ground' || e.ground || (e.cls === 'beam' ? n >= 2 || solid : n >= 1));
  };
  for (const e of els) stable(e);
  for (const e of els) if (e.cls !== 'roof' && e.cls !== 'floor') e.sup = e.sup.filter((s) => s.el.stable);
  const order = [], seen = new Uint8Array(els.length);
  const visit = (e) => { if (seen[e.i]) return; seen[e.i] = 1; for (const s of e.sup) visit(s.el); order.push(e); };
  for (const e of els) visit(e);
  order.reverse();

  // ---- helpers for sending load down
  const lost = (v) => { totals.unsupportedN += v[0] + v[1] + v[2] + v[3]; };
  // send v to supporter c. where: { t } a point along a line, { x, z } a point in plan, { line: [x0, z0, x1, z1] } a run in plan. conc: a concentrated load.
  const send = (c, v, where, conc, from) => {
    if (!(v[0] + v[1] + v[2] + v[3] > 0)) return;
    add(c.got, v); c.inbox.push({ v, where: where || null, conc: !!conc, from });
  };
  const rec = (e, chk, supports, extra) => {
    const v = [e.own[0] + e.got[0], e.own[1] + e.got[1], e.own[2] + e.got[2], e.own[3] + e.got[3]];
    members[e.id] = { load: { deadN: r0(v[0]), liveN: r0(v[1] + v[2]), snowN: r0(v[3]), windN: r0(e.wind) }, demand: r3(chk.demand), capacity: r3(chk.capacity), unit: chk.unit || 'N',
      utilisation: r3(cap(chk.u)), governs: chk.governs, supports: [...new Set(supports)], ok: cap(chk.u) <= 1, ...extra };
    return members[e.id];
  };
  const under = (e) => (env.snowIsNow && e.got[3] + e.own[3] > 0 ? 'under the snow lying on it now' : e.got[3] + e.own[3] > 0 ? 'under a heavy snow load' : e.got[1] + e.own[1] > 0 ? 'under a full room' : 'under the weight it carries');
  const pct = (u) => (u >= UMAX ? 'far more than' : `${Math.round(u * 100)} % of`);
  const spanWords = (e, what, chk, an, s, where) => {
    const size = `${mm(s.b)} x ${mm(s.d)} mm`, len = an.over > 0.6 && 2 * an.over > an.span ? `overhang ${m1(an.over)} m past ${where || 'their last support'}` : `span ${m1(an.span)} m`;
    if (chk.governs === 'deflection') return [`${what} ${len}, and at ${size} would sag about ${Math.max(1, Math.round(an.dShow * 1000))} mm ${under(e)}: ${pct(chk.u)} what stays firm. It would be springy and could crack finishes, though it would not break.`, `Put a beam, post or wall under the middle of the span, or use deeper timber.`];
    if (chk.governs === 'shear') return [`${what} ${len} and carry so much that the wood could split along the grain near the supports ${under(e)} (${pct(chk.u)} the safe shear).`, `Use a deeper or wider timber, or add a support to share the load.`];
    return [`${what} ${len}: too far for ${size} timber ${under(e)}. The wood would be bent to ${pct(chk.u)} what it safely takes.`, `Add a support under the middle of the span (a beam on posts or a wall), or use deeper timber.`];
  };

  // strips carrying an area (roof plane or floor): supports found along each, load sent down, worst one reported
  const runStrips = (e, strips, fr, q, limit, cosT, okSup, what) => {
    // strips: [{ ox, oz, dx, dz, len, w (width carried), wc (width to check), b, d, mat, id?, pts? }]; q: [D, L, Lr, S] Pa on plan
    let worst = null, wan = null, ws = null, noSup = 0, oneSup = 0, conn = 0, thrust = false, sumA = 0; const sup = new Set();
    for (const s of strips) sumA += s.len * s.w;
    const fa = sumA > 0 ? e.planA / sumA : 0, cl = []; for (const c of e.sup) if (c.el.stable) cl.push(c.el);
    let unit = null, uLen = -1, uXs = null, uEI = 0, lastChk = null, lastUnit = null, lastW = 0, lastD = 0;
    const sameXs = (a, b) => { if (!b || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-9) return false; return true; };
    for (const s of strips) {
      const xs = [], who = [], cand = [];
      for (const el of cl) { const x = cross(s.ox, s.oz, s.dx, s.dz, s.len, el); if (x && okSup(el, x[0], s)) cand.push([x[0], el, x[1]]); }
      cand.sort((a, b) => a[0] - b[0]);
      for (const c of cand) if (!xs.length || c[0] - xs[xs.length - 1] > 0.08) { xs.push(c[0]); who.push(c); }
      s.xs = xs; s.who = who; s.load = [q[0] * s.w * s.len * fa, q[1] * s.w * s.len * fa, q[2] * s.w * s.len * fa, q[3] * s.w * s.len * fa];
    }
    // an edge strip with nothing under it (the roof's overhang past the end wall) is carried by its neighbour, as lookouts and sheathing do
    for (const dir of [1, -1]) { let wsum = 0; for (let i = dir > 0 ? 0 : strips.length - 1; i >= 0 && i < strips.length; i += dir) { const s = strips[i]; if (s.xs.length) { for (let j = i - dir; j >= 0 && j < strips.length; j -= dir) { add(s.load, strips[j].load); strips[j].gone = true; } break; } wsum += s.w; if (wsum > 0.7) break; } }
    for (const s of strips) {
      if (s.gone) continue;
      const xs = s.xs, who = s.who, load = s.load;
      let virt = false;
      if (e.apex && xs.length && s.len - xs[xs.length - 1] > 0.6) { xs.push(s.len); virt = true; }
      const extra = s.pts || [];
      if (!xs.length || (xs.length === 1 && virt)) { noSup++; lost(load); for (const pt of extra) lost(pt.v); continue; }
      if (xs.length === 1) { oneSup++; const v = load.slice(); for (const pt of extra) add(v, pt.v); send(who[0][1], v, { t: who[0][2] }, false, e.id); sup.add(who[0][1].id); continue; }
      const dv = designValues(s.mat), EI = dv && dv.E > 0 ? dv.E * s.b * s.d * s.d * s.d / 12 : 0;
      if (!(Math.abs(s.len - uLen) < 1e-9 && uEI === EI && sameXs(xs, uXs))) { unit = analyseBeam(s.len, xs, [[0, s.len, 1]], [], EI || 1); uLen = s.len; uXs = xs; uEI = EI; }
      const eff = { M: [0, 0, 0, 0], V: [0, 0, 0, 0], dr: [0, 0, 0, 0] }, R = xs.map(() => [0, 0, 0, 0]);
      const kc = s.wc / (s.w * fa || 1);
      for (let k = 0; k < 4; k++) {
        const w = load[k] / s.len, wk = q[k] * s.w * fa * kc; if (w > 0) { eff.M[k] += unit.M * wk; eff.V[k] += unit.V * wk; eff.dr[k] += unit.dr * wk; for (let i = 0; i < xs.length; i++) R[i][k] += unit.R[i] * w; }
        if (false) { eff.M[k] += unit.M * w * kc; eff.V[k] += unit.V * w * kc; eff.dr[k] += unit.dr * w * kc; for (let i = 0; i < xs.length; i++) R[i][k] += unit.R[i] * w; }
        const pk = extra.length ? extra.filter((pt) => pt.v[k] > 0).map((pt) => [pt.x, pt.v[k]]) : extra;
        if (pk.length) { const a = analyseBeam(s.len, xs, [], pk, EI || 1); eff.M[k] += a.M; eff.V[k] += a.V; eff.dr[k] += a.dr; for (let i = 0; i < xs.length; i++) R[i][k] += a.R[i]; }
      }
      if (virt) { thrust = true; add(R[xs.length - 2], R[xs.length - 1]); }
      for (let i = 0; i < who.length; i++) { for (let k = 0; k < 4; k++) if (R[i][k] < 0) R[i][k] = 0; send(who[i][1], R[i], { t: who[i][2] }, false, e.id); sup.add(who[i][1].id); conn++; }
      if (!dv || dv.kind !== 'wood') continue;
      const same = lastChk && !extra.length && !s.id && lastUnit === unit && Math.abs(q[0] * s.w * fa * kc - lastW) < 1e-9 && s.d === lastD;
      const chk = same ? lastChk : spanCheck(dv, s.b, s.d, eff, strips.length >= 3 && s.wc <= 0.61, limit, cosT);
      if (!extra.length && !s.id) { lastChk = chk; lastUnit = unit; lastW = q[0] * s.w * fa * kc; lastD = s.d; }
      if (s.id) { const an = { span: unit.span, over: unit.over, dShow: chk.ud / limit * Math.max(unit.span, 2 * unit.over) }; members[s.id] = { load: { deadN: r0(load[0]), liveN: r0(load[1] + load[2]), snowN: r0(load[3]), windN: 0 }, demand: r3(chk.demand), capacity: r3(chk.capacity), unit: chk.unit, utilisation: r3(cap(chk.u)), governs: chk.governs, supports: who.map((c) => c[1].id), ok: chk.u <= 1 }; s.chk = chk; s.an = an; }
      if (!worst || chk.u > worst.u) { worst = chk; ws = s; wan = { span: unit.span, over: unit.over, dShow: chk.ud / limit * Math.max(unit.span, 2 * unit.over) }; }
    }
    return { worst, wan, ws, noSup, oneSup, n: strips.filter((s) => !s.gone).length, sup, conn, thrust };
  };

  // ---- carry the load down, top first
  for (const e of order) {
    const p = e.p;
    if (e.cls === 'roof') {
      const q = [e.plan > 0 ? e.own[0] / e.plan : 0, 0, e.plan > 0 ? e.own[2] / e.plan : 0, e.plan > 0 ? e.own[3] / e.plan : 0]; e.planA = e.plan;
      const fr = e.fr, z = Math.max(0, e.y1 - groundY(e)); e.wind = upliftC(e.deg) * windQ(env, z) * e.plan * (e.deck ? 1 : OPEN_FRAME);
      let res = null, strips = [];
      const mkStrip = (ox, oz, dx, dz, len, w, r) => ({ ox, oz, dx, dz, len, w, wc: r ? w : fr.s, b: r ? sec(r, B_IMPLIED, D_DEFAULT).b : fr.b, d: r ? sec(r, B_IMPLIED, D_DEFAULT).d : fr.d, mat: r ? r.material : fr.mat, id: r ? r.id : null });
      if (e.explicit && !e.rafters.length) { rec(e, { u: 0, governs: 'bending', demand: 0, capacity: 0, unit: 'MPa' }, []); lost(e.own); continue; }
      if (e.mode === 'radial' || !e.P) {
        const ws = e.sup.map((s) => s.el).filter((c) => c.stable && c.cls === 'wall' && Math.abs(c.y1 - e.eaveY) <= 0.45 && (!e.P || nearPoly(e.P, (c.ax + c.bx) / 2, (c.az + c.bz) / 2, 0.3)));
        let L = 0; for (const c of ws) L += c.len;
        if (!ws.length) { lost(e.own); rec(e, { u: UMAX, governs: 'unsupported', demand: tot(e.own), capacity: 0 }, []); issue(e.id, 'fail', 'unsupported', UMAX, 'Nothing holds this roof up: there are no walls under its edge.', 'Build walls under the roof\'s edge.'); continue; }
        for (const c of ws) send(c, e.own.map((x) => x * c.len / L), null, false, e.id);
        // radial rafters lean together at the peak: each is a beam from the wall to the peak under a load that tapers to nothing
        const span = Math.sqrt(e.plan / Math.PI) * 0.85, dv = designValues(fr.mat), eff = { M: [0, 0, 0, 0], V: [0, 0, 0, 0], dr: [0, 0, 0, 0] }, EI = dv.E * fr.b * fr.d ** 3 / 12;
        for (let k = 0; k < 4; k++) { const w0 = q[k] * fr.s; eff.M[k] = 0.0642 * w0 * span * span; eff.V[k] = w0 * span / 3; eff.dr[k] = 0.00652 * w0 * span ** 3 / EI; }
        const chk = spanCheck(dv, fr.b, fr.d, eff, true, 180, e.cos); res = { worst: chk, wan: { span, over: 0, dShow: chk.ud / 180 * span }, ws: fr, sup: new Set(ws.map((c) => c.id)), conn: Math.round(L / fr.s), noSup: 0, oneSup: 0, n: 1 };
      } else if (e.mode === 'slope') {
        const P = e.P; let s0 = Infinity, s1 = -Infinity; for (const c of P) { const s = (c.x - e.ax) * e.ux + (c.z - e.az) * e.uz; if (s < s0) s0 = s; if (s > s1) s1 = s; }
        if (e.explicit) {
          const rs = e.rafters.map((r) => { const xa = (r.a.x - e.ax) * e.vx + (r.a.z - e.az) * e.vz, xb = (r.b.x - e.ax) * e.vx + (r.b.z - e.az) * e.vz, lo = xa < xb ? r.a : r.b; return { r, s: (lo.x - e.ax) * e.ux + (lo.z - e.az) * e.uz, lo, len: Math.abs(xb - xa) }; }).filter((r) => r.len > 0.05).sort((a, b) => a.s - b.s);
          rs.forEach((r, i) => { const gl = i ? (r.s - rs[i - 1].s) / 2 : Math.min(Math.max(0, r.s - s0), i < rs.length - 1 ? (rs[i + 1].s - r.s) / 2 : RAFTER_S / 2), gr = i < rs.length - 1 ? (rs[i + 1].s - r.s) / 2 : Math.min(Math.max(0, s1 - r.s), i ? (r.s - rs[i - 1].s) / 2 : RAFTER_S / 2); strips.push(mkStrip(r.lo.x, r.lo.z, e.vx, e.vz, r.len, Math.max(0.05, gl + gr), r.r)); });
          if (!e.deck) e.planA = strips.reduce((a, s) => a + s.len * s.w, 0);
        } else {
          const nb = Math.max(1, Math.ceil((s1 - s0) / fr.s - 1e-6)), wb = (s1 - s0) / nb;
          for (let i = 0; i < nb; i++) { const s = s0 + (i + 0.5) * wb, c = clipLine(P, e.ax + e.ux * s, e.az + e.uz * s, e.vx, e.vz); if (c) strips.push(mkStrip(e.ax + e.ux * s + e.vx * c[0], e.az + e.uz * s + e.vz * c[0], e.vx, e.vz, c[1] - c[0], wb, null)); }
        }
        e.apex = (p.type === 'gable' || p.type === 'hip') && roofN.get(p.roof) > 1;
        const surf = (s, x) => e.eaveY + ((s.ox + s.dx * x - e.ax) * e.vx + (s.oz + s.dz * x - e.az) * e.vz) * e.tan;
        res = runStrips(e, strips, fr, q, 180, e.cos, (c, x, s) => { const y = surf(s, x); return c.cls === 'beam' ? y >= c.y0 - TOLY && y <= c.y1 + TOLY : c.p.type === 'gable' ? false : Math.abs(c.y1 - y) <= TOLY || (c.y1 > y && c.y0 < y - 0.5); }, 'roof');
      } else {
        strips = areaStrips(e, e.explicit ? e.rafters : null, fr, RAFTER_S, (c) => (c.cls === 'beam' ? c.y1 <= e.eaveY + 0.15 : true) && c.y1 >= e.eaveY - 0.45);
        res = runStrips(e, strips, fr, q, 180, 1, () => true, 'roof');
      }
      const sup = [...res.sup], w = res.worst, hold = 0.6 * e.own[0] + res.conn * HOLD_DOWN_N, uu = hold > 0 ? e.wind / hold : UMAX;
      const note = e.explicit ? undefined : fr.note;
      if (res.noSup + res.oneSup > 0 && res.noSup + res.oneSup >= res.n * 0.2) {
        rec(e, { u: UMAX, governs: 'unsupported', demand: tot(e.own), capacity: 0 }, sup, { note });
        issue(e.id, 'fail', 'unsupported', UMAX, sup.length ? `Part of this roof slope has nothing under its lower edge: no wall or beam carries its eave, so about ${m1((res.noSup + res.oneSup) / res.n * (e.len || 1))} m of it would hinge down.` : 'Nothing holds this roof up: no wall or beam lies under it.', 'Build a wall under the eave, or a beam on posts.');
      } else if (!w) rec(e, { u: 0, governs: 'bending', demand: 0, capacity: 0, unit: 'MPa' }, sup, { note });
      else {
        const chk = uu > w.u ? { u: uu, governs: 'uplift', demand: e.wind, capacity: hold, unit: 'N' } : w; rec(e, chk, e.explicit ? e.rafters.map((r) => r.id) : sup, { note, spanM: r3(res.wan.span) });
        if (w.u > 1) { const c = w.st && w.st.u > 1 ? w.st : w, t = spanWords(e, 'This roof\'s rafters', c, res.wan, res.ws, 'the wall'); issue(res.ws.id || e.id, c.governs === 'deflection' ? 'warn' : 'fail', c.governs, c.u, t[0], c.governs === 'deflection' ? t[1] : 'Add a ridge beam on posts, a purlin, or a supporting wall mid-span, or use deeper rafters.'); }
        if (uu > 1) issue(e.id, 'warn', 'uplift', uu, `In a ${Math.round(env.gustMs)} m/s storm gust the wind would lift this roof with about ${kN(e.wind)} kN, more than its own weight and its nailed seats hold down (${kN(hold)} kN).`, 'Strap the rafters down to the walls, give them more supports, or use a heavier covering.');
        if (res.thrust && p.type === 'gable' && !ties.has(p.roof)) issue(e.id, 'warn', 'thrust', 0, 'This roof has no ridge beam held up at its ends, so its rafters lean on each other and push the tops of the walls outward.', 'Hold the ridge up with gable walls or posts, or tie each pair of rafters together at wall height.');
      }
    } else if (e.cls === 'floor') {
      if (e.gnd || e.ground) {
        const v = [e.own[0] + e.got[0], e.own[1] + e.got[1], e.got[2], e.got[3]], fr = e.fr || { b: B_IMPLIED, mat: FRAMING, s: JOIST_S }, dv = designValues(fr.mat);
        const press = e.area > 0 ? tot(v) / e.area : 0, bear = press * fr.s / fr.b, capB = dv ? dv.Fcp * 1.25 : 0;
        if (e.gnd) send(e.gnd, v, null, false, e.id); else { totals.groundN += v[0] + v[1] + v[2] + v[3]; foundations[e.id] = { bearingKPa: r3(press / 1000), allowableKPa: env.allowableKPa, ok: press / 1000 <= env.allowableKPa }; }
        rec(e, { u: capB > 0 ? bear / capB : 0, governs: 'bearing', demand: bear / 1e6, capacity: capB / 1e6, unit: 'MPa' }, e.gnd ? [e.gnd.id] : [], { note: e.fr ? e.fr.note + '; they lie on the foundation along their length' : undefined });
        continue;
      }
      if (e.explicit && !e.joists.length) { rec(e, { u: 0, governs: 'bending', demand: 0, capacity: 0, unit: 'MPa' }, []); lost(e.own); for (const it of e.inbox) lost(it.v); continue; }
      e.planA = e.area; const q = [e.area > 0 ? e.own[0] / e.area : 0, e.area > 0 ? e.own[1] / e.area : 0, 0, 0];
      const strips = areaStrips(e, e.explicit ? e.joists : null, e.fr, JOIST_S, () => true);
      for (const it of e.inbox) {                               // walls, posts and stairs standing on the floor load the joists under them
        const w = it.where || {}, ln = w.line || [num(w.x, e.ax), num(w.z, e.az), num(w.x, e.ax), num(w.z, e.az)], n = Math.max(1, Math.ceil(Math.hypot(ln[2] - ln[0], ln[3] - ln[1]) / 0.2));
        for (let i = 0; i < n; i++) {
          const f = (i + 0.5) / n, x = ln[0] + (ln[2] - ln[0]) * f, z = ln[1] + (ln[3] - ln[1]) * f; let best = null, bd = Infinity;
          for (const s of strips) { const d = Math.abs((x - s.ox) * -s.dz + (z - s.oz) * s.dx); if (d < bd) { bd = d; best = s; } }
          if (!best) { lost(it.v.map((c) => c / n)); continue; }
          (best.pts || (best.pts = [])).push({ x: Math.max(0, Math.min(best.len, (x - best.ox) * best.dx + (z - best.oz) * best.dz)), v: it.v.map((c) => c / n) });
        }
      }
      const res = runStrips(e, strips, e.fr, q, 240, 1, () => true, 'floor'), sup = [...res.sup], w = res.worst, note = e.explicit ? undefined : e.fr.note;
      if (res.noSup + res.oneSup > 0 && res.noSup + res.oneSup >= res.n * 0.2) {
        rec(e, { u: UMAX, governs: 'unsupported', demand: tot(e.own), capacity: 0 }, sup, { note });
        issue(e.id, 'fail', 'unsupported', UMAX, sup.length ? 'Part of this floor has nothing beneath it: its joists reach only one support and would tip.' : 'This floor has nothing beneath it to carry its joists.', 'Stand it on walls, or on beams and posts, at both ends of the joists.');
      } else if (!w) rec(e, { u: 0, governs: 'bending', demand: 0, capacity: 0, unit: 'MPa' }, sup, { note });
      else {
        rec(e, w, e.explicit ? e.joists.map((j) => j.id) : sup, { note, spanM: r3(res.wan.span) });
        if (w.u > 1) { const c = w.st && w.st.u > 1 ? w.st : w, t = spanWords(e, 'This floor\'s joists', c, res.wan, res.ws, 'the wall'); issue(res.ws.id || e.id, c.governs === 'deflection' ? 'warn' : 'fail', c.governs, c.u, t[0], t[1]); }
      }
    } else if (e.cls === 'beam') {
      const dv = designValues(p.material), v = [e.own[0] + e.got[0], e.own[1] + e.got[1], e.got[2], e.got[3]], what = p.type === 'ridge' ? 'This ridge beam' : p.kind === 'beam' ? 'This beam' : `This ${p.kind}`;
      if (e.sup.length < 2) {
        if (p.type === 'ridge' && !(e.got[0] + e.got[1] + e.got[2] + e.got[3] > 0)) {                 // a ridge board: it rides on the rafters
          const pl = els.filter((o) => o.cls === 'roof' && o.p.roof != null && o.p.roof === p.roof && members[o.id]);
          rec(e, { u: 0, governs: 'bending', demand: 0, capacity: 0, unit: 'MPa' }, pl.map((o) => o.id), { note: 'not held up at its ends: it is a ridge board that the rafters carry' });
          if (e.sup.length) send(e.sup[0].el, v, { t: e.sup[0].tc }, true, e.id); else lost(v); continue;
        }
        rec(e, { u: UMAX, governs: 'unsupported', demand: tot(v), capacity: 0 }, e.sup.map((s) => s.el.id));
        issue(e.id, 'fail', 'unsupported', UMAX, e.sup.length ? `${what} rests on only one support, so it would tip and fall.` : `${what} has nothing under it.`, e.sup.length ? 'Put a post or a wall under its other end.' : 'Stand it on posts or walls at both ends.');
        if (e.sup.length) send(e.sup[0].el, v, { t: e.sup[0].tc }, true, e.id); else lost(v); continue;
      }
      const xs = e.sup.map((s) => s.t), EI = dv && dv.E > 0 ? dv.E * e.b * e.d ** 3 / 12 : 1, eff = { M: [0, 0, 0, 0], V: [0, 0, 0, 0], dr: [0, 0, 0, 0] }, R = xs.map(() => [0, 0, 0, 0]);
      let span = 0, over = 0;
      for (let k = 0; k < 4; k++) {
        const pts = []; for (const it of e.inbox) if (it.v[k] > 0) pts.push([Math.max(0, Math.min(e.len, num(it.where && it.where.t, e.len / 2))), it.v[k]]);
        const dist = k === 0 && e.own[0] > 0 ? [[0, e.len, e.own[0] / e.len]] : []; if (!pts.length && !dist.length) continue;
        const a = analyseBeam(e.len, xs, dist, pts, EI); eff.M[k] = a.M; eff.V[k] = a.V; eff.dr[k] = a.dr; span = a.span; over = a.over;
        for (let i = 0; i < xs.length; i++) R[i][k] = Math.max(0, a.R[i]);
      }
      let ub = 0;
      for (let i = 0; i < xs.length; i++) { const s = e.sup[i], r = tot(R[i]); send(s.el, R[i], s.el.cls === 'wall' ? { t: s.tc } : null, true, e.id); if (dv && dv.Fcp > 0 && s.solid == null) ub = Math.max(ub, r / (e.b * Math.min(0.3, Math.max(0.04, s.w || 0.1))) / (dv.Fcp * 1.5)); }
      if (!dv || dv.kind === 'masonry' || dv.kind === 'earth') { rec(e, { u: 0, governs: 'bending', demand: 0, capacity: 0, unit: 'MPa' }, e.sup.map((s) => s.el.id), { note: 'no bending strength is known for this material, so the beam itself was not checked' }); issue(e.id, 'info', 'bending', 0, `${what} is of a material with no known bending strength, so its own strength was not checked.`, 'Use timber or steel for beams.'); continue; }
      let chk = spanCheck(dv, e.b, e.d, eff, false, eff.M[1] > 0 ? 240 : 180); const an = { span, over, dShow: chk.ud / (eff.M[1] > 0 ? 240 : 180) * Math.max(span, 2 * over) }, sc = chk.st && chk.st.u > 1 ? chk.st : chk;
      if (ub > chk.u) chk = { u: ub, governs: 'bearing', demand: ub * dv.Fcp * 1.5 / 1e6, capacity: dv.Fcp * 1.5 / 1e6, unit: 'MPa' };
      rec(e, chk, e.sup.map((s) => s.el.id), { spanM: r3(span) });
      if (sc.u > 1) { const t = spanWords(e, `${what} would`, sc, an, e, 'its last support'); issue(e.id, sc.governs === 'deflection' ? 'warn' : 'fail', sc.governs, sc.u, t[0].replace(' would span', ' spans').replace(' would overhang', ' overhangs').replace('and carry', 'and carries'), sc.governs === 'deflection' ? 'Put a post under the middle of the beam, or use a deeper one.' : 'Put a post under the middle of the beam to halve its span, or use a deeper beam.'); }
      if (ub > 1) issue(e.id, 'fail', 'bearing', ub, `${what} presses on its seat harder than wood can take across the grain: the fibres would crush where it sits.`, 'Give it a wider seat: a thicker post, or a longer bearing on the wall.');
    } else if (e.cls === 'wall') {
      doWall(e);
    } else if (e.cls === 'post') {
      const dv = designValues(p.material), v = [e.own[0] + e.got[0], e.own[1] + e.got[1], e.got[2], e.got[3]], A = e.b * e.d * e.solidity, what = p.type === 'chimney' ? 'This chimney' : p.kind === 'pier' ? 'This pier' : 'This post';
      let u = 0, N = 0, capN = 0;
      if (dv) for (const [kl, kr, cd] of [[0, 0, CD.dead], [1, 0, CD.live], [0, 1, v[3] > 0 ? CD.snow : CD.roofLive], [0.75, 0.75, v[3] > 0 ? CD.snow : CD.roofLive]]) { const n = v[0] + kl * v[1] + kr * (v[2] + v[3]), c = columnStress(dv, e.h, e.t, cd) * A; if (c > 0 && n / c > u) { u = n / c; N = n; capN = c; } }
      const s = e.sup[0];
      if (!s && !e.ground) { rec(e, { u: UMAX, governs: 'unsupported', demand: tot(v), capacity: 0 }, []); issue(e.id, 'fail', 'unsupported', UMAX, `${what} has nothing under its foot.`, 'Stand it on the ground, a foundation, a beam or another post.'); lost(v); continue; }
      rec(e, { u, governs: 'compression', demand: N, capacity: capN, unit: 'N' }, s ? [s.el.id] : [], dv ? undefined : { note: 'no strength is known for this material, so the post itself was not checked' });
      if (u > 1) issue(e.id, 'fail', 'compression', u, `${what} is too slender for the ${kN(N)} kN it carries: at ${m1(e.h)} m tall and ${mm(e.t)} mm thick it would bow sideways and buckle (it is safe for ${kN(capN)} kN).`, 'Use a thicker post, add another post to share the load, or brace it at mid-height.');
      if (s) send(s.el, v, s.el.cls === 'floor' ? { x: e.ax, z: e.az } : { t: s.t }, true, e.id);
      else { totals.groundN += v[0] + v[1] + v[2] + v[3]; const a = p.kind === 'pier' || p.kind === 'footing' ? e.b * e.d : e.b * e.d, press = tot(v) / a / 1000; bearGround(e, press, what, a, tot(v)); }
    } else if (e.cls === 'ground') {
      const v = [e.own[0] + e.got[0], e.got[1], e.got[2], e.got[3]], T = tot(v); totals.groundN += v[0] + v[1] + v[2] + v[3];
      let press, why;
      if (e.posts) {
        let wmax = 0, fl = 0; for (const it of e.inbox) { if (it.where && it.where.lineLoad) wmax = Math.max(wmax, it.where.lineLoad); else fl += tot(it.v); }
        const qf = e.area > 0 ? fl / e.area : 0, P = Math.max(qf * 4, qf * 2 + wmax * POSTS_FD.spacing) + e.own[0] / e.n; press = P / (POSTS_FD.pad * POSTS_FD.pad) / 1000;
        const dv = designValues(p.material), c = dv ? columnStress(dv, Math.max(0.3, e.h), POSTS_FD.post, CD.live) * POSTS_FD.post ** 2 : 0;
        e.note = `${e.n} posts ${mm(POSTS_FD.post)} mm square at ${POSTS_FD.spacing} m centres on ${mm(POSTS_FD.pad)} mm pads assumed`; e.uPost = c > 0 ? P / c : 0; why = 'the pads under its posts';
      } else {
        let strip = 0, base = 0; for (const it of e.inbox) { if (it.where && it.where.lineLoad) strip = Math.max(strip, it.where.lineLoad / (it.where.width + e.h / 2)); else base += tot(it.v); }
        const self = e.area > 0 ? e.own[0] / e.area : 0, avg = e.area > 0 ? T / e.area : 0; press = Math.max(avg, strip + self + (e.area > 0 ? base / e.area : 0)) / 1000; why = 'the ground under its walls';
      }
      const u = env.allowableKPa > 0 ? press / env.allowableKPa : UMAX;
      foundations[e.id] = { bearingKPa: r3(press), allowableKPa: env.allowableKPa, ok: u <= 1 };
      rec(e, e.uPost > u ? { u: e.uPost, governs: 'compression', demand: e.uPost, capacity: 1, unit: 'ratio' } : { u, governs: 'bearing', demand: press, capacity: env.allowableKPa, unit: 'kPa' }, [], e.note ? { note: e.note } : undefined);
      if (u > 1) issue(e.id, 'fail', 'bearing', u, `This foundation presses ${Math.round(press)} kPa on ${why}, and ${env.soilName} safely carries ${Math.round(env.allowableKPa)} kPa: the building would settle and crack.`, 'Spread the load over a wider foundation, lighten what stands on it, or build on firmer ground.');
      if (e.uPost > 1) issue(e.id, 'fail', 'compression', e.uPost, 'The posts under this raised floor are too tall and thin for the weight on them: they would buckle.', 'Lower the floor, or lighten what stands on it.');
    } else if (e.cls === 'stair') {
      const s = e.sup[0]; if (s) send(s.el, e.own, { x: e.ax, z: e.az }, false, e.id); else totals.groundN += e.own[0] + e.own[1];
    }
  }
  function groundY(e) { return baseY.get(e.group); }
  function bearGround(e, press, what, a, P) {
    const u = env.allowableKPa > 0 ? press / env.allowableKPa : UMAX;
    foundations[e.id] = { bearingKPa: r3(press), allowableKPa: env.allowableKPa, ok: u <= 1 };
    const m = members[e.id]; if (m && u > m.utilisation) { m.utilisation = r3(cap(u)); m.governs = 'bearing'; m.demand = r3(press); m.capacity = env.allowableKPa; m.unit = 'kPa'; m.ok = u <= 1; }
    if (u > 1) issue(e.id, 'fail', 'bearing', u, `${what} presses ${Math.round(press)} kPa on the ground, and ${env.soilName} safely carries ${Math.round(env.allowableKPa)} kPa: it would sink.`, `Stand it on a wider footing (a pad at least ${m1(Math.sqrt(P / (env.allowableKPa * 1000)) + 0.05)} m square), or share the load between more supports.`);
  }
  // joists (or a flat roof's rafters) across an outline: real ones if given, otherwise at spacing sp the shorter way between supports
  function areaStrips(e, real, fr, sp, okLine) {
    const P = e.P, out = []; if (!P) return out;
    if (real) {
      const js = real.map((r) => { const l = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z); return { r, l, dx: (r.b.x - r.a.x) / l, dz: (r.b.z - r.a.z) / l }; }).filter((j) => j.l > 0.05);
      if (!js.length) return out; const nx = -js[0].dz, nz = js[0].dx; let lo = Infinity, hi = -Infinity; for (const c of P) { const o = c.x * nx + c.z * nz; if (o < lo) lo = o; if (o > hi) hi = o; }
      for (const j of js) j.o = j.r.a.x * nx + j.r.a.z * nz; js.sort((a, b) => a.o - b.o);
      js.forEach((j, i) => { const gl = i ? (j.o - js[i - 1].o) / 2 : Math.max(0, Math.min(j.o - lo, sp / 2)), gr = i < js.length - 1 ? (js[i + 1].o - j.o) / 2 : Math.max(0, Math.min(hi - j.o, sp / 2)), s = sec(j.r, B_IMPLIED, D_DEFAULT); out.push({ ox: j.r.a.x, oz: j.r.a.z, dx: j.dx, dz: j.dz, len: j.l, w: Math.max(0.05, gl + gr), wc: Math.max(0.05, gl + gr), b: s.b, d: s.d, mat: j.r.material, id: j.r.id }); });
      if (!e.deck) e.planA = out.reduce((a, s) => a + s.len * s.w, 0);
      return out;
    }
    const cands = e.sup.map((s) => s.el).filter((c) => c.stable && okLine(c)); let best = null;
    const dirs = []; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const l = Math.hypot(P[i].x - P[j].x, P[i].z - P[j].z); if (l < 0.3) continue; const dx = (P[i].x - P[j].x) / l, dz = (P[i].z - P[j].z) / l; if (!dirs.some((d) => Math.abs(d[0] * dz - d[1] * dx) < 0.1)) dirs.push([dx, dz]); if (dirs.length >= 3) break; }
    for (const [dx, dz] of dirs) {
      const nx = -dz, nz = dx; let lo = Infinity, hi = -Infinity; for (const c of P) { const o = c.x * nx + c.z * nz; if (o < lo) lo = o; if (o > hi) hi = o; }
      const nb = Math.max(1, Math.ceil((hi - lo) / sp - 1e-6)), wb = (hi - lo) / nb, st = []; let bad = 0, span = 0;
      for (let i = 0; i < nb; i++) {
        const o = lo + (i + 0.5) * wb, c = clipLine(P, nx * o, nz * o, dx, dz); if (!c) continue;
        const s = { ox: nx * o + dx * c[0], oz: nz * o + dz * c[0], dx, dz, len: c[1] - c[0], w: wb, wc: fr.s, b: fr.b, d: fr.d, mat: fr.mat, id: null }, xs = [];
        for (const el of cands) { const x = cross(s.ox, s.oz, dx, dz, s.len, el); if (x) xs.push(x[0]); } xs.sort((a, b) => a - b);
        if (xs.length < 2 || xs[xs.length - 1] - xs[0] < 0.1) bad++; else { span = Math.max(span, xs[0], s.len - xs[xs.length - 1]); for (let k = 1; k < xs.length; k++) span = Math.max(span, xs[k] - xs[k - 1]); }
        st.push(s);
      }
      const score = bad / Math.max(1, st.length) * 1000 + span; if (!best || score < best.score - 1e-9) best = { score, st };
    }
    return best ? best.st : out;
  }
  function doWall(e) {
    const p = e.p, wm = e.wm, v = [e.own[0] + e.got[0], e.got[1], e.got[2], e.got[3]], sup = e.sup.filter((s) => s.el.stable), what = p.type === 'gable' ? 'This gable wall' : p.kind === 'wall' ? 'This wall' : `This ${p.kind}`;
    const z = Math.max(0, e.y1 - groundY(e)), qw = windQ(env, z) * C_WALL; e.wind = qw * e.len * e.h * (e.open ? OPEN_FRAME : 1);
    const line = [0, 0, 0, 0], conc = []; for (const it of e.inbox) { if (it.conc) conc.push(it); else add(line, it.v); }
    let chk = { u: 0, governs: 'compression', demand: 0, capacity: 0, unit: 'N' }, note = wm.note, why = null;
    const cdR = v[3] > 0 ? CD.snow : CD.roofLive, combos = [[0, 0, CD.dead], [1, 0, CD.live], [0, 1, cdR], [0.75, 0.75, cdR]];
    if (wm.type === 'framed') {
      const dv = designValues(wm.mat), le = Math.min(e.h, 3.2 > e.h ? e.h : e.h), A = wm.b * wm.d, qv = line.map((x) => x / Math.max(0.1, e.len)), ownPer = e.own[0] / Math.max(0.1, e.len);
      const piers = []; let at = 0; for (const o of e.opens) { piers.push([at, o[0]]); at = o[1]; } piers.push([at, e.len]);
      const widthAt = (k) => (k >= 0 && k < e.opens.length ? e.opens[k][1] - e.opens[k][0] : 0);
      if (dv) piers.forEach((pr, k) => {
        const wp = Math.max(0, pr[1] - pr[0]), trib = wp + widthAt(k - 1) / 2 + widthAt(k) / 2;
        const n = wm.explicit ? wm.studs.filter((s) => s.s >= pr[0] - 0.03 && s.s <= pr[1] + 0.03).length : Math.max(e.opens.length ? 2 : 1, Math.floor(wp / STUD_S) + 1);
        const pv = [qv[0] * trib + ownPer * wp, qv[1] * trib, qv[2] * trib, qv[3] * trib];
        for (const c of conc) { const t = num(c.where && c.where.t, e.len / 2); if (t >= pr[0] - 0.2 && t <= pr[1] + 0.2) add(pv, c.v, 1); }
        if (trib <= 0.01 && !(pv[0] > 0)) return;
        if (n < 1) { if (tot(pv) > ownPer * wp + 1) { if (chk.u < UMAX) { chk = { u: UMAX, governs: 'unsupported', demand: tot(pv), capacity: 0, unit: 'N' }; why = 'nostud'; } } return; }
        // a concentrated load lands on two studs; the spread load on every stud of the pier
        let cv = [0, 0, 0, 0], hasC = false; for (const c of conc) { const t = num(c.where && c.where.t, e.len / 2); if (t >= pr[0] - 0.2 && t <= pr[1] + 0.2) { add(cv, c.v); hasC = true; } }
        for (const [kl, kr, cd] of combos) {
          const cs = columnStress(dv, le, wm.d, cd), cN = Math.min(cs * A, dv.Fcp * 1.25 * (wm.b + 0.06) * wm.d);
          const all = pv[0] + kl * pv[1] + kr * (pv[2] + pv[3]), cc = cv[0] + kl * cv[1] + kr * (cv[2] + cv[3]);
          const per = Math.max(all / n, hasC ? cc / Math.min(2, n) + (all - cc) / n : 0), u = per / cN;
          if (u > chk.u) { chk = { u, governs: cN < cs * A ? 'bearing' : 'compression', demand: per, capacity: cN, unit: 'N' }; why = 'stud'; }
        }
        // wind on the face bends the studs while they carry the roof (NDS 3.9.2, with 0.75 of each acting together)
        const S = wm.b * wm.d * wm.d / 6, Mw = qw * (wm.explicit && n > 1 ? wp / (n - 1) : STUD_S) * le * le / 8, Fb = dv.Fb * sizeFactor(dv, wm.d) * REP * CD.wind, cs = columnStress(dv, le, wm.d, CD.wind), FcE = 0.822 * dv.Emin / ((le / wm.d) ** 2);
        const fc = (pv[0] + 0.75 * (pv[1] + pv[2] + pv[3])) / n / A, amp = 1 - fc / FcE, uw = amp > 0.05 ? (fc / cs) ** 2 + 0.75 * Mw / S / (Fb * amp) : UMAX;
        if (uw > chk.u) { chk = { u: uw, governs: 'bending', demand: 0.75 * Mw / S / 1e6, capacity: Fb / 1e6, unit: 'MPa' }; why = 'wind'; }
      });
      else note = 'no strength is known for this wall\'s framing, so it was not checked';
      // headers: each opening's lintel carries what comes down above it across to the studs either side
      if (dv) e.opens.forEach((o, k) => {
        const w = o[1] - o[0], hs = wm.explicit ? wm.heads.filter((h) => h.s0 <= o[0] + 0.08 && h.s1 >= o[1] - 0.08) : null, hv = qv.map((x) => x * w);
        for (const c of conc) { const t = num(c.where && c.where.t, -1); if (t > o[0] && t < o[1]) add(hv, c.v); }
        const oid = (p.openings[k] && p.openings[k].id) || e.id;
        if (wm.explicit && !hs.length) {
          if (tot(hv) > 50) { if (chk.u < UMAX) { chk = { u: UMAX, governs: 'unsupported', demand: tot(hv), capacity: 0, unit: 'N' }; why = 'nohead'; } issue(e.id, 'fail', 'unsupported', UMAX, `The ${m1(w)} m opening in this wall has no header over it, so the ${kN(tot(hv))} kN coming down from above has nothing to carry it across to the studs either side.`, 'Frame a header across the top of the opening before loading the wall.'); }
          return;
        }
        const h = wm.explicit ? { b: hs.reduce((a, x) => a + x.b, 0), d: Math.min(...hs.map((x) => x.d)), mat: hs[0].mat, id: hs[0].id } : { b: 2 * B_IMPLIED, d: 0.14, mat: wm.mat }, hd = designValues(h.mat); if (!hd) return;
        const span = w + 0.04, EI = hd.E * h.b * h.d ** 3 / 12, one = analyseBeam(span, [0, span], [[0, span, 1 / span]], [], EI), eff = { M: hv.map((x) => x * one.M), V: hv.map((x) => x * one.V), dr: hv.map((x) => x * one.dr) };
        const hc = spanCheck(hd, h.b, h.d, eff, false, 240);
        if (wm.explicit) for (const x of hs) members[x.id] = { load: { deadN: r0(hv[0]), liveN: r0(hv[1] + hv[2]), snowN: r0(hv[3]), windN: 0 }, demand: r3(hc.demand), capacity: r3(hc.capacity), unit: hc.unit, utilisation: r3(cap(hc.u)), governs: hc.governs, supports: [e.id], ok: hc.u <= 1, spanM: r3(span) };
        if (hc.u > 1) issue(wm.explicit ? h.id : oid, hc.governs === 'deflection' && !(hc.st.u > 1) ? 'warn' : 'fail', hc.governs, hc.u, `The header over this ${m1(w)} m opening is too small: at ${mm(h.b)} x ${mm(h.d)} mm it would be loaded to ${pct(hc.u)} what it safely carries by the ${kN(tot(hv))} kN coming down from above${wm.explicit ? '' : ' (a doubled 38 x 140 header is assumed)'}.`, 'Use a deeper header, double it, or make the opening narrower.');
        if (hc.u > chk.u) { chk = hc; why = 'head'; }
      });
      if (wm.explicit) for (const s of wm.studs) members[s.id] = { load: { deadN: 0, liveN: 0, snowN: 0, windN: 0 }, demand: r3(chk.governs === 'compression' ? chk.demand : 0), capacity: r3(chk.governs === 'compression' ? chk.capacity : 0), unit: 'N', utilisation: r3(cap(why === 'stud' || why === 'wind' ? chk.u : 0)), governs: why === 'wind' ? 'bending' : 'compression', supports: [e.id], ok: !(why === 'stud' || why === 'wind') || chk.u <= 1 };
    } else if (wm.type === 'solid') {
      const dv = designValues(wm.mat), A = wm.t * Math.max(0.1, e.net || e.len);
      if (dv) {
        const log = dv.kind === 'wood', F = log ? dv.Fcp : dv.Fc * Math.max(0.1, 1 - (e.h / wm.t / 40.4) ** 2), n = tot(v);
        chk = { u: n / A / F, governs: log ? 'bearing' : 'compression', demand: n / A / 1e6, capacity: F / 1e6, unit: 'MPa' }; why = 'solid';
        for (const c of conc) { const u = tot(c.v) / (wm.t * 0.2) / (F * 1.25); if (u > chk.u) { chk = { u, governs: 'bearing', demand: tot(c.v) / (wm.t * 0.2) / 1e6, capacity: F * 1.25 / 1e6, unit: 'MPa' }; why = 'seat'; } }
        if (log) note = 'a solid timber wall is taken as stacked logs, loaded across the grain';
      } else note = 'no strength is known for this material, so the wall itself was not checked';
    }
    if (!sup.length && !e.ground) {
      if (p.type === 'gable' && p.roof != null) {                 // an infill with no wall below hangs in the roof's end frame
        const pl = els.filter((o) => o.cls === 'roof' && o.p.roof === p.roof), tg = []; for (const o of pl) for (const id of (members[o.id] || { supports: [] }).supports) { const c = byId.get(id); if (c && c !== e && c.cls !== 'roof' && order.indexOf(c) > order.indexOf(e)) tg.push(c); }
        if (tg.length) { for (const c of tg) send(c, v.map((x) => x / tg.length), null, false, e.id); rec(e, chk, tg.map((c) => c.id), { note: 'no wall below: it hangs in the roof\'s end frame' }); return; }
      }
      rec(e, { u: UMAX, governs: 'unsupported', demand: tot(v), capacity: 0 }, []); lost(v);
      issue(e.id, 'fail', 'unsupported', UMAX, `${what} has nothing under it.`, 'Build a wall, beam or floor beneath it.'); return;
    }
    rec(e, chk, sup.map((s) => s.el.id), note ? { note } : undefined);
    if (chk.u > 1 && why === 'stud') issue(e.id, 'fail', chk.governs, chk.u, chk.governs === 'bearing' ? `${what}'s studs press on the plate beneath them with ${kN(chk.demand)} kN each, more than the wood takes across the grain (${kN(chk.capacity)} kN): the plate would crush.` : `${what}'s studs carry ${kN(chk.demand)} kN each ${under(e)}, more than the ${kN(chk.capacity)} kN a ${mm(wm.b)} x ${mm(wm.d)} mm stud ${m1(e.h)} m tall can take before it bows and buckles.`, 'Use deeper studs, set them closer together, or bring some of the load down another way (a post or a second wall).');
    if (chk.u > 1 && why === 'wind') issue(e.id, 'warn', 'bending', chk.u, `In a ${Math.round(env.gustMs)} m/s storm gust the wind on this wall would bend its ${mm(wm.b)} x ${mm(wm.d)} mm studs past what they safely take while they carry the load above.`, 'Use deeper studs or set them closer together; a floor or a cross wall part-way up also shortens them.');
    if (why === 'nostud') issue(e.id, 'fail', 'unsupported', UMAX, `Part of ${what.toLowerCase()} has load coming down on it but no studs built to carry it.`, 'Build the studs in that stretch of wall.');
    if (chk.u > 1 && (why === 'solid' || why === 'seat')) issue(e.id, 'fail', chk.governs, chk.u, why === 'seat' ? `A beam bears on ${what.toLowerCase()} harder than the ${(designValues(wm.mat) || {}).name || 'wall'} can take at that spot.` : `${what} carries more than its ${(designValues(wm.mat) || {}).name || 'material'} safely takes: ${chk.demand.toFixed(2)} MPa against ${chk.capacity.toFixed(2)} MPa.`, why === 'seat' ? 'Put a spreader (a stone or timber pad) under the beam, or a post beside the wall.' : 'Make the wall thicker, or lighten what stands on it.');
    if (e.ground) {
      totals.groundN += v[0] + v[1] + v[2] + v[3]; const press = tot(v) / (Math.max(0.05, e.t) * Math.max(0.1, e.len)) / 1000; bearGround(e, press, what, e.t * e.len, tot(v)); return;
    }
    let W = 0; for (const s of sup) W += s.w || 1;
    for (const s of sup) {
      const c = s.el, share = (s.w || 1) / W, sv = v.map((x) => x * share);
      if (c.cls === 'ground') send(c, sv, { lineLoad: tot(sv) / Math.max(0.1, s.w || e.len), width: e.t }, false, e.id);
      else if (c.cls === 'floor') send(c, sv, { line: [e.ax, e.az, e.bx, e.bz] }, false, e.id);
      else if (c.cls === 'beam') { const n = Math.max(1, Math.ceil(e.len / 0.3)); for (let i = 0; i < n; i++) { const f = (i + 0.5) / n, x = e.ax + (e.bx - e.ax) * f, zz = e.az + (e.bz - e.az) * f; send(c, sv.map((q) => q / n), { t: (x - c.ax) * c.ux + (zz - c.az) * c.uz }, false, e.id); } }
      else send(c, sv, null, false, e.id);
    }
  }

  // ---- wind across each building: racking of its wall lines, and overturning
  const groups = new Map();
  for (const e of els) { if (!groups.has(e.group)) groups.set(e.group, []); groups.get(e.group).push(e); }
  for (const [, list] of groups) {
    const walls = list.filter((e) => e.cls === 'wall' && e.rack && e.len > 0.3 && e.p.type !== 'gable' && e.p.type !== 'rail' && !LINE_GROUND[e.p.kind] && members[e.id] && members[e.id].governs !== 'unsupported');
    if (!walls.length) continue;
    let top = -Infinity, base = Infinity, dead = 0; for (const e of list) { if (e.y1 > top) top = e.y1; if (e.y0 < base) base = e.y0; dead += e.own[0]; }
    const q = windQ(env, top - base), axes = [];
    for (const w of walls) if (!axes.some((a) => Math.abs(a[0] * w.uz - a[1] * w.ux) < 0.3)) axes.push([w.ux, w.uz]);
    for (const [dx, dz] of axes) {
      // wind blowing along (dx, dz): the walls and roof slopes that face it gather the force; the walls that run along it resist
      let face = 0, big = 0, roofA = 0, ext0 = Infinity, ext1 = -Infinity;
      for (const e of list) {
        if (e.cls === 'wall' && e.p.type !== 'rail' && !LINE_GROUND[e.p.kind]) { const a = num(e.p.area, e.len * e.h) * Math.abs(-e.uz * dx + e.ux * dz) * (e.p.type === 'gable' ? 1 : 0.5) * (e.open ? OPEN_FRAME : 1); face += a; if (a > big) big = a; }
        if (e.cls === 'roof' && e.mode === 'slope') roofA += Math.abs(e.vx * dx + e.vz * dz) * (e.y1 - e.eaveY) * Math.max(e.len, 0.1) * 0.8 * Math.max(0, Math.min(1, (e.deg - 10) / 20)) * (e.deck ? 1 : OPEN_FRAME);
        if (e.cls === 'wall' || e.cls === 'ground') for (const [x, zz] of [[e.ax, e.az], [e.bx, e.bz]]) { const s = x * dx + zz * dz; if (s < ext0) ext0 = s; if (s > ext1) ext1 = s; }
      }
      const F = q * (C_DRAG * Math.max(face / 2, big) + roofA / 2), along = walls.filter((w) => Math.abs(w.ux * dx + w.uz * dz) > 0.7);
      let K = 0; for (const w of along) K += w.rack.k;
      for (const w of along) {
        const f = K > 0 ? F * w.rack.k / K : 0, u = w.rack.cap > 0 ? f / w.rack.cap : UMAX, sway = Math.min(w.h / 20, w.rack.k > 0 ? f * w.h / w.rack.k : w.h / 20);
        const prev = racking[w.id]; if (prev && prev.utilisation >= r3(cap(u))) continue;
        racking[w.id] = { demandN: r0(f), capacityN: r0(w.rack.cap), utilisation: r3(cap(u)), swayMm: r3(sway * 1000), braced: !!w.rack.braced, ok: u <= 1 && !(w.rack.framed && !w.rack.braced) };   // nailed joints alone are never counted as bracing
      }
      const half = (ext1 - ext0) / 2, Mo = F * (top - base) / 2, Mr = 0.6 * dead * half, uo = Mr > 0 ? Mo / Mr : 0;
      if (uo > 1 && half > 0.3) { const g = list.find((e) => e.cls === 'ground') || walls[0]; if (!issues.some((i) => i.pieceId === g.id && i.governs === 'overturning')) issue(g.id, 'warn', 'overturning', uo, `This building is light for its height: a ${Math.round(env.gustMs)} m/s storm gust pushes on it with about ${kN(F)} kN, enough to tip it unless it is held down.`, 'Anchor it to its foundation, make it wider or lower, or add weight low down.'); }
    }
    for (const w of walls) {
      const r = racking[w.id]; if (!r) continue; const m = members[w.id];
      if (!r.ok) {
        issue(w.id, 'warn', 'racking', r.utilisation, w.rack.framed && !w.rack.braced ? `This wall is a bare frame: studs and plates with nothing across them. Nothing stops it leaning over sideways like a folding parallelogram, and in a storm gust it would sway about ${Math.round(r.swayMm)} mm.` : `In a ${Math.round(env.gustMs)} m/s storm gust this wall line must resist about ${kN(r.demandN)} kN of sideways push along its length, and its ${w.rack.framed ? 'boarding' : 'fabric'} is good for ${kN(r.capacityN)} kN: it would lean (rack) about ${Math.round(r.swayMm)} mm.`, w.rack.framed && !w.rack.braced ? 'Nail sheathing sheets across the studs, or let in a diagonal brace.' : 'Sheathe it with plywood or OSB sheets, add a diagonal brace, or add a cross wall to share the wind.');
        if (m && r.utilisation > m.utilisation && r.utilisation > 1) { m.utilisation = r.utilisation; m.governs = 'racking'; m.demand = r.demandN; m.capacity = r.capacityN; m.unit = 'N'; m.ok = false; }
      }
    }
  }
  for (const e of els) if (e.cls === 'wall' && members[e.id]) members[e.id].load.windN = r0(e.wind);

  let worst = null;
  for (const id in members) { const m = members[id]; if (!worst || m.utilisation > worst.utilisation) worst = { pieceId: id, utilisation: m.utilisation, governs: m.governs }; }
  const rank = { fail: 0, warn: 1, info: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity] || b.utilisation - a.utilisation || (a.pieceId < b.pieceId ? -1 : a.pieceId > b.pieceId ? 1 : 0));
  if (issues.length > 80) issues.length = 80;
  return { members, foundations, racking, worst, issues, totals: { appliedN: r0(totals.appliedN), groundN: r0(totals.groundN), unsupportedN: r0(totals.unsupportedN) } };
}

// ---------------------------------------------------------------------------------------- the system
const fresh = () => ({ v: STATE_V, version: -1, site: { soil: DEFAULT_SOIL, exposure: 'open', designGustMs: DESIGN_GUST_MS, designSnowKPa: null, allowableKPa: null },
  bands: { snow: -1, wind: -1 }, env: {}, members: {}, foundations: {}, racking: {}, worst: null, issues: [], totals: { appliedN: 0, groundN: 0, unsupportedN: 0 } });
function recompute(ctx, env) {
  const s = ctx.s, site = ctx.get('site') || { version: 0, pieces: [] }, out = solveStructure(site.pieces, env);
  s.version = site.version | 0; s.bands = { snow: env.snowBand, wind: env.windBand };
  s.env = { snowNowKPa: env.snowNowKPa, snowDesignKPa: r3(env.snowDesignKPa), gustMs: env.gustMs, gustDesignMs: env.gustDesignMs, soil: env.soil, allowableKPa: env.allowableKPa };
  s.members = out.members; s.foundations = out.foundations; s.racking = out.racking; s.worst = out.worst; s.issues = out.issues; s.totals = out.totals;
  ctx.emit('structure.changed', { version: s.version, worst: s.worst, issues: s.issues.length });
}
function step(ctx) {
  let s = ctx.s; if (!s || s.v !== STATE_V) { ctx.s = s = { ...fresh(), site: { ...fresh().site, ...((s && s.site) || {}) } }; }
  const site = ctx.get('site'), w = ctx.get('weather') || {};
  // the guard: three comparisons on a tick where nothing changed
  const swe = w.snowSweMm > 0 ? w.snowSweMm : 0, gust = GUST_FACTOR * (w.windMs || 0), gd = s.site.designGustMs;
  const sb = Math.max(0, Math.ceil(swe * G / 1000 / SNOW_BAND_KPA - 1e-9)), wb = gust <= gd ? 0 : Math.ceil((gust - gd) / WIND_BAND_MS);
  if (site && s.version === (site.version | 0) && s.bands.snow === sb && s.bands.wind === wb && Number.isFinite(w.snowSweMm)) return;
  const env = environment(w, s.site);
  if (site && s.version === (site.version | 0) && s.bands.snow === env.snowBand && s.bands.wind === env.windBand) return;
  recompute(ctx, env);
}
export const structure = {
  name: 'structure',
  // The weather it reads changes every ten ticks, so it looks every ten. A change to the site made in between (or while
  // time is paused) shows at once in overlayData, and the interface can issue structure.recheck to bring state up to date.
  every: 10,
  init: fresh,
  step,
  commands: {
    // soil class, wind exposure and design loads of the site: { soil?, allowableKPa?, exposure?, designGustMs?, designSnowKPa? } (null restores the default)
    'structure.setSite': (c, p = {}) => {
      if (!c.s || c.s.v !== STATE_V) c.s = fresh();
      if (p.soil !== undefined) { if (!SOILS[p.soil]) throw new Error('unknown soil: ' + p.soil); c.s.site.soil = p.soil; c.s.site.allowableKPa = null; }
      if (p.exposure !== undefined) { if (!EXPOSURE[p.exposure]) throw new Error('unknown exposure: ' + p.exposure); c.s.site.exposure = p.exposure; }
      for (const k of ['allowableKPa', 'designGustMs', 'designSnowKPa']) if (p[k] !== undefined) { if (p[k] !== null && !(Number.isFinite(+p[k]) && +p[k] >= 0)) throw new Error(k + ' must be a number'); c.s.site[k] = p[k] === null ? (k === 'designGustMs' ? DESIGN_GUST_MS : null) : +p[k]; }
      recompute(c, environment(c.get('weather'), c.s.site));
    },
    // judge the site now (the interface calls this after a change while time is paused)
    'structure.recheck': (c) => { if (!c.s || c.s.v !== STATE_V) c.s = fresh(); recompute(c, environment(c.get('weather'), c.s.site)); },
  },
};

// How far a wall line leans (mm) in a mean wind of windMs, from its design-gust figure: sway goes with the square of the speed.
export function swayNow(state, wallId, windMs) {
  const s = state && state.sys && state.sys.structure, r = s && s.racking && s.racking[wallId]; if (!r || !(s.env.gustMs > 0)) return 0;
  const k = (GUST_FACTOR * Math.max(0, windMs || 0)) / s.env.gustMs; return Math.round(r.swayMm * Math.min(1, k * k) * 1000) / 1000;
}

// Pure data for the structural overlay: every piece's utilisation and status, the wall lines' sway, the worst piece.
let memo = null;
export function overlayData(state) {
  let s = state && state.sys && state.sys.structure; const site = state && state.sys && state.sys.site;
  if (!s) return { version: -1, pieces: {}, worst: null, issues: [] };
  if (site && s.version !== (site.version | 0)) {                  // changed while paused: judge it here without touching state
    if (!memo || memo.pieces !== site.pieces || memo.version !== site.version) memo = { pieces: site.pieces, version: site.version, out: solveStructure(site.pieces, environment(state.sys.weather, s.site)) };
    s = { ...s, ...memo.out, version: site.version };
  }
  const worstOf = {}; for (const i of s.issues) if (!worstOf[i.pieceId] || (i.severity === 'fail' && worstOf[i.pieceId] !== 'fail')) worstOf[i.pieceId] = i.severity === 'info' ? (worstOf[i.pieceId] || 'ok') : i.severity;
  const pieces = {};
  for (const id in s.members) { const m = s.members[id], r = s.racking[id]; pieces[id] = { utilisation: m.utilisation, status: worstOf[id] || (m.utilisation > 1 ? 'warn' : 'ok'), governs: m.governs, supports: m.supports, ...(r ? { swayMm: r.swayMm, braced: r.braced } : {}) }; }
  for (const id in worstOf) if (!pieces[id]) pieces[id] = { utilisation: 0, status: worstOf[id], governs: null, supports: [] };
  return { version: s.version, pieces, worst: s.worst, issues: s.issues, env: s.env };
}
