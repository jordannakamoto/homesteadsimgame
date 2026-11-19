// Stairs as rules: the types, the carpenter's rules of thumb, and a solver that lays a stair out to fit the room.
// Pure and deterministic: no DOM, no three.js, no randomness. Plan in docs/design/plan-mode-redesign.md, section 3A.
//
// ---- Frames
// Building metres: x, z in the building's own frame (one grid cell is 1 m), as S.stairs records use.
// Local stair frame (u, v): origin at the FOOT (the centre of the first riser's line, on the lower surface),
//   +u = forward, the way you walk up = (cos(dir*90deg), sin(dir*90deg)); dir 0..3 matches build.js DIRS
//   ([1,0], [0,1], [-1,0], [0,-1]); +v = to the climber's right = (-f.z, f.x).
//   toWorld(layout, u, v) -> [x, z] and toLocal(layout, x, z) -> [u, v] convert.
// Heights are metres above the foot's surface (0 at the foot, `rise` at the head).
//
// ---- solve(input) -> layout
// input: { rise, run, side, clear, width, type, turn, n, at, opening, ceiling, deck, x, z, dir }
//   rise     height between the two surfaces (m).
//   run      room ahead of the foot (m, default Infinity): the drag length shortened by walls and floor edges.
//   side     room beside the stair, past its own edge: a number for both sides or { left, right } (default Infinity).
//   clear    side of the clear square at the foot, for a spiral (default min(run, width + 2 * min(side))).
//   width    0.92 m by default; clamped per type (Steps and Deck steps up to 3 m).
//   type     'auto' (default) | 'steps' | 'straight' | 'l' | 'u' | 'winder' | 'spiral' | 'ladder' | 'deck'.
//   turn     'left' | 'right' | null: the way an L, U, winder or spiral turns (null lets the solver pick).
//   n, at    risers, and the riser the landing (or the winders) follow: player overrides, null lets the solver pick.
//   opening  the longest the floor above may be opened, measured back from the head along the walking line
//            (default Infinity: cut it wherever headroom needs it).
//   ceiling  height of the underside of what is over the stair (default rise - deck when the rise is a storey,
//            Infinity for small rises and for deck steps). deck: floor thickness, 0.12.
//   x, z, dir  where the foot is (building metres) and which way it climbs; carried into the layout.
// Null or undefined means "not given" everywhere.
//
// layout: {
//   ok, issues: [{ code, text, by }], fixes: [{ code, label, patch }], fits: [type ids that solve ok here],
//   text ('Straight · 16 x 178 mm' or the first issue), label ('16 x 178 mm'),
//   type (resolved; never 'auto'), pick (what was asked, may be 'auto'), auto (true when Auto chose), base (deck: 'steps'|'straight'),
//   x, z, dir, rise, n (risers), riser, tread (going per step; spiral: at the walking line), width (spiral: tread length),
//   angle (pitch, degrees), turn ('left'|'right'|null), at (landing or winders after this riser, or null),
//   flights: [{ n, k0, y0, y1, a: [u, v], d: [du, dv], len, w, stringer }]
//       n risers in the flight, risers k0+1 .. k0+n; y0 = k0 * riser is the surface it starts from, y1 = (k0+n) * riser
//       the surface it lands on; a = centre of its first riser line; d = unit direction (axis aligned); len = (n-1) * tread.
//       Tread j (1 .. n-1) covers a + d * [(j-1) tread, j tread], its top at y0 + j * riser. The last riser lands on the
//       next landing, the winders or the upper floor. stringer: length of one cut stringer (m).
//   landings: [{ r: [u0, v0, u1, v1], y, after }], landing: landings[0] or null.
//   winders: [{ pts: [[u, v], ...], y }] three wedge treads (winder only); corner: { p, r, sgn, y0, y1 } the square
//       they fill, p the inner corner they radiate from.
//   spiral: { c: [u, v], r, post, a0, step, treads, rw, sweep } or null. Tread k (1 .. treads) covers angles
//       a0 + (k-1) * step .. a0 + k * step (radians in the u-v plane, from +u toward +v) at height k * riser; the last
//       riser lands on the upper floor at a0 + treads * step. step > 0 turns right (post on the climber's right).
//   rects: [{ part: 'flight'|'landing'|'winders'|'spiral', r: [u0, v0, u1, v1] }], box: bounds of rects,
//   length (forward extent), span: [v0, v1] (lateral extent), footprint: [[x, z] x 4] (box in building metres),
//   head: [u, v] centre of the top riser line (spiral: where the walking line leaves), headDir: [du, dv],
//   path: walking line, [{ a, b }] lines and [{ c, r, a0, a1 }] arcs (point = c + r * (cos, sin)), walk: its length,
//   well: [[u0, v0, u1, v1], ...] where the floor above must be opened (headroom under it would be below 2.0 m),
//   wellLength (along the walking line), headroom (least clear height on the walking line; Infinity when nothing is overhead),
//   railDefault ('none' under 0.6 m of rise, else 'both'), parts: { risers, treads, landings, winders, stringers: [m] },
// }
// Fit and fix vocabulary. Issue codes: run (not enough room ahead; a straight stair says "Too steep"), side (not enough
// room to the side for the turn), clear (spiral square too small), rise (wrong height for the type), flight (more than 16
// risers in a flight), riser (a forced riser count is too steep or too shallow), headroom (the floor above is in the way).
// Fix codes and their patches over the input: type {type, n: null, at: null}, run {run}, turn {turn}, at {at}, n {n},
// width {width}, opening {opening}. Every fix returned solves ok when merged into the same input.
//
// Also: heightAt(layout, x, z, y) the walking height (ramp per flight, flat on landings, by angle on a spiral; y picks the
// level on a spiral), walkLine(layout, step) samples along the walking line, fromRecord(rec, env) reads old
// { id, i, j, dir } and new records, layoutOf(rec, env) solves a record, lookOf(rec, layout) its look with defaults.

const INF = Infinity, EPS = 1e-6, TAU = Math.PI * 2, DEG = Math.PI / 180;

export const RULES = Object.freeze({
  riser: Object.freeze({ min: 0.15, max: 0.19, aim: 0.178 }),
  tread: Object.freeze({ min: 0.25, max: 0.28 }),
  stride: Object.freeze({ min: 0.6, max: 0.64, aim: 0.62 }),   // 2R + T
  flight: 16,                 // most risers in one flight
  headroom: 2.0,
  deck: 0.12,                 // floor thickness (build.js FLOOR_T)
  storey: 2.84,               // a normal storey (build.js EAVE)
  steps: Object.freeze({ rise: 0.6, n: 3, riser: 0.2, tread: [0.28, 0.4] }),
  spiral: Object.freeze({ d: 1.5, auto: 1.6, step: 30, riser: 0.22, post: 0.1, thick: 0.04, walk: 0.6 }),
  ladder: Object.freeze({ riser: 0.23, max: 0.25, angle: Object.freeze([60, 70]), aim: 65 }),
  gap: 0.1,                   // U: between the two flights
  width: Object.freeze({ def: 0.92, min: 0.6, max: 1.5, wide: 3.0, ladder: Object.freeze([0.5, 1.0]) }),
  rail: 0.6,                  // under this rise no rail by default
  part: Object.freeze({ tread: 0.04, nosing: 0.025, riser: 0.02, newel: 0.09, rail: 0.9, baluster: 0.11 }),
});

export const TYPES = Object.freeze([
  { id: 'auto', name: 'Auto', blurb: 'Picks the stair that fits the room you drag.' },
  { id: 'steps', name: 'Steps', blurb: '1 to 3 risers for a small change of level: sunken room, raised nook, split level.' },
  { id: 'straight', name: 'Straight', blurb: 'One flight.' },
  { id: 'l', name: 'L-shaped', blurb: 'Two flights and a square landing, turning left or right.' },
  { id: 'u', name: 'U-shaped', blurb: 'Two flights side by side and a half landing.' },
  { id: 'winder', name: 'Winder', blurb: 'An L with three wedge treads in place of the landing.' },
  { id: 'spiral', name: 'Spiral', blurb: 'Treads round a centre post. Needs a clear square of 1.5 m.' },
  { id: 'ladder', name: "Ship's ladder", blurb: 'Very steep, with handrails: lofts and cellars where nothing else fits.' },
  { id: 'deck', name: 'Deck steps', blurb: 'Open risers on cut stringers, foot on the ground.' },
].map(Object.freeze));
export const TYPE_BY_ID = Object.freeze(Object.fromEntries(TYPES.map((t) => [t.id, t])));
export const WIDTHS = Object.freeze([0.8, 0.92, 1.07, 1.2]);
export const MATERIALS = Object.freeze([
  { id: 'pine', name: 'Pine' }, { id: 'oak', name: 'Oak' }, { id: 'dark', name: 'Dark stain' },
  { id: 'white', name: 'Painted white, wood treads' }, { id: 'stone', name: 'Stone', only: ['steps', 'deck'] },
].map(Object.freeze));
export const RAILS = Object.freeze(['both', 'left', 'right', 'none', 'wall']);
export const RAIL_STYLES = Object.freeze([{ id: 'square', name: 'Square balusters' }, { id: 'rails', name: 'Horizontal rails' }, { id: 'plain', name: 'Plain handrail' }].map(Object.freeze));
const FIX_LABEL = { steps: 'Use steps', straight: 'Make it straight', l: 'Make it L-shaped', u: 'Make it U-shaped', winder: 'Use winders', spiral: 'Use a spiral', ladder: "Use a ship's ladder", deck: 'Use deck steps' };
const SWITCH = ['l', 'spiral', 'u', 'winder', 'ladder', 'straight', 'steps'];
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const r3 = (x) => Math.round(x * 1000) / 1000;
const fm = (x) => { const s = String(Math.round(x * 100) / 100); return s.includes('.') ? s : s + '.0'; };
const mm = (x) => Math.round(x * 1000);
const up05 = (x) => Math.ceil(x * 20 - 1e-6) / 20;
const given = (v) => v !== undefined && v !== null && v !== '' && !Number.isNaN(+v);
const num = (v, d) => (given(v) ? +v : d);
const range = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; };
const uniq = (a) => a.filter((x, i) => a.findIndex((y) => Math.abs(y - x) < 1e-9) === i);
const sideName = (sgn) => (sgn > 0 ? 'right' : 'left');

// ---- the rules as arithmetic
function treadRange(R) {
  const T = RULES.tread, S = RULES.stride;
  let lo = Math.max(T.min, S.min - 2 * R), hi = Math.min(T.max, S.max - 2 * R);
  if (lo > hi) lo = hi = clamp(S.aim - 2 * R, T.min, T.max);
  return { lo, hi, aim: clamp(S.aim - 2 * R, lo, hi) };
}
function riserCounts(rise) {
  const lo = Math.max(1, Math.ceil(rise / RULES.riser.max - EPS));
  return [lo, Math.max(lo, Math.floor(rise / RULES.riser.min + EPS))];   // small rises: risers under 150 mm are accepted
}
const comfort = (R, T, aim) => 10 * Math.abs(R - RULES.riser.aim) + Math.abs(T - aim);
const issue = (code, text, by) => ({ code, text, by: r3(by || 0) });

function widthFor(type, w) {
  const W = RULES.width;
  if (type === 'ladder') return clamp(w, W.ladder[0], W.ladder[1]);
  return clamp(w, W.min, type === 'steps' || type === 'deck' ? W.wide : W.max);
}

function norm(inp) {
  const rise = Math.max(0, num(inp.rise, 0)), deck = num(inp.deck, RULES.deck);
  const s = inp.side;
  const side = !given(s) && (s === null || typeof s !== 'object') ? { left: INF, right: INF }
    : typeof s === 'object' ? { left: Math.max(0, num(s.left, INF)), right: Math.max(0, num(s.right, INF)) } : { left: Math.max(0, +s), right: Math.max(0, +s) };
  const run = Math.max(0, num(inp.run, INF)), width = num(inp.width, RULES.width.def), type = TYPE_BY_ID[inp.type] ? inp.type : 'auto';
  return {
    type, rise, run, side, width, deck,
    clear: given(inp.clear) ? Math.max(0, +inp.clear) : Math.min(run, width + 2 * Math.min(side.left, side.right)),
    ceiling: given(inp.ceiling) ? +inp.ceiling : type !== 'deck' && rise >= RULES.headroom + deck + 0.05 ? rise - deck : INF,
    turn: inp.turn === 'left' || inp.turn === 'right' ? inp.turn : null,
    n: given(inp.n) && +inp.n >= 1 ? Math.round(+inp.n) : null, at: given(inp.at) && +inp.at >= 1 ? Math.round(+inp.at) : null,
    opening: Math.max(0, num(inp.opening, INF)), x: num(inp.x, 0), z: num(inp.z, 0), dir: num(inp.dir, 0),
  };
}

// ---- candidates: every way a type could be laid out; the best one that fits wins
function straightC(env, type) {
  const w = widthFor(type, env.width), rise = env.rise, out = [];
  const [lo, hi] = riserCounts(rise);
  for (const n of env.n ? [env.n] : range(lo, hi)) {
    const R = rise / n, tr = treadRange(R);
    for (const T of uniq([tr.aim, tr.lo])) {
      const hard = [];
      if (n > RULES.flight) hard.push(issue('flight', `${n} risers in one flight; ${RULES.flight} is the most`, n - RULES.flight));
      if (env.n && R > RULES.riser.max + EPS) hard.push(issue('riser', `Risers of ${mm(R)} mm are too steep`, R - RULES.riser.max));
      if (env.n && R < RULES.riser.min - EPS && hi > lo - 1 && rise / lo >= RULES.riser.min) hard.push(issue('riser', `Risers of ${mm(R)} mm are too shallow`, RULES.riser.min - R));
      out.push({ type, n, R, T, w, fwd: (n - 1) * T, lat: 0, hard, score: comfort(R, T, tr.aim) });
    }
  }
  // nothing comfortable fits the run: draw it as close as it can be, steep, inside the run
  const best = Math.min(...out.filter((c) => !c.hard.length).map((c) => c.fwd));
  if (!env.n && env.run < INF && best > env.run + EPS) {
    const n = Math.min(lo - 1, Math.floor(env.run / RULES.tread.min + EPS) + 1);
    if (n >= 1) out.push({ type, n, R: rise / n, T: RULES.tread.min, w, fwd: (n - 1) * RULES.tread.min, need: best, steep: true, lat: 0, hard: [], score: -1 });
  }
  return out;
}

function stepsC(env, type) {
  const w = widthFor(type, env.width), rise = env.rise, S = RULES.steps, out = [];
  const n = env.n || Math.max(1, Math.ceil(rise / S.riser - EPS)), R = rise / n, aim = clamp(RULES.stride.aim - 2 * R, S.tread[0], S.tread[1]);
  const hard = [];
  if (rise > S.rise + EPS) hard.push(issue('rise', `Too high for steps: ${fm(rise)} m rise`, rise - S.rise));
  else if (n > S.n) hard.push(issue('riser', `Steps have 1 to ${S.n} risers`, n - S.n));
  else if (R > S.riser + EPS) hard.push(issue('riser', `Risers of ${mm(R)} mm are too steep`, R - S.riser));
  for (const T of uniq([aim, RULES.tread.min])) out.push({ type, n, R, T, w, fwd: (n - 1) * T, lat: 0, hard: hard.slice(), score: Math.abs(T - aim) });
  return out;
}

function ladderC(env) {
  const w = widthFor('ladder', env.width), rise = env.rise, L = RULES.ladder, out = [];
  const n = env.n || Math.max(1, Math.ceil(rise / L.riser - EPS)), R = rise / n;
  const hard = R > L.max + EPS ? [issue('riser', `Risers of ${mm(R)} mm are too steep even for a ship's ladder`, R - L.max)] : [];
  const fitDeg = env.run < INF && n > 1 ? Math.atan(((n - 1) * R) / Math.max(env.run, EPS)) / DEG : L.aim;
  for (const deg of uniq([L.aim, clamp(fitDeg, L.aim, L.angle[1]), L.angle[1]])) {
    const T = R / Math.tan(deg * DEG);
    out.push({ type: 'ladder', n, R, T, w, deg, fwd: (n - 1) * T, lat: 0, hard: hard.slice(), score: Math.abs(deg - L.aim) * 0.01 });
  }
  return out;
}

function turnC(env, type) {
  const w = widthFor(type, env.width), rise = env.rise, out = [], minN = type === 'winder' ? 4 : 2;
  const [lo, hi] = riserCounts(rise);
  let ns = env.n ? [env.n] : range(lo, hi);
  const low = ns.every((n) => n < minN);
  if (low) ns = [minN];
  const sides = env.turn ? [env.turn === 'right' ? 1 : -1] : env.side.right >= env.side.left ? [1, -1] : [-1, 1];
  for (const n of ns) {
    const R = rise / n, tr = treadRange(R);
    const atLo = type === 'u' ? Math.ceil(n / 2) : 1, atHi = type === 'winder' ? n - 3 : n - 1;
    if (atHi < atLo) continue;
    const ats = env.at ? [clamp(env.at, atLo, atHi)] : range(atLo, atHi);
    for (const T of uniq([tr.aim, tr.lo])) for (const at of ats) {
      const n2 = type === 'winder' ? n - at - 2 : n - at;
      const hard = [];
      if (low) hard.push(issue('rise', `Too low to turn: ${fm(rise)} m rise`, 0));
      if (at > RULES.flight || n2 > RULES.flight) hard.push(issue('flight', `${Math.max(at, n2)} risers in one flight; ${RULES.flight} is the most`, Math.max(at, n2) - RULES.flight));
      if (env.n && R > RULES.riser.max + EPS) hard.push(issue('riser', `Risers of ${mm(R)} mm are too steep`, R - RULES.riser.max));
      const fwd = (at - 1) * T + w, lat = type === 'u' ? w + RULES.gap : (n2 - 1) * T;
      const mid = type === 'winder' ? (n - 2) / 2 : n / 2;
      sides.forEach((sgn, si) => out.push({ type, n, R, T, w, at, n2, sgn, fwd, lat, hard: hard.slice(), score: comfort(R, T, tr.aim) + 0.01 * Math.abs(at - mid) + (si && !env.turn ? 0.5 : 0) }));
    }
  }
  return out;
}

function spiralC(env) {
  const S = RULES.spiral, rise = env.rise;
  const n = env.n || Math.max(2, Math.ceil(rise / S.riser - EPS)), R = rise / n;
  const want = Math.max(S.d, 2 * clamp(env.width, RULES.width.min, RULES.width.max) + S.post);
  const D = env.clear >= S.d - EPS ? Math.min(env.clear, want) : S.d;
  const hard = R > S.riser + EPS ? [issue('riser', `Risers of ${mm(R)} mm are too steep for a spiral`, R - S.riser)] : [];
  const sgn = env.turn === 'left' ? -1 : 1, rw = S.walk * (D / 2);
  return [{ type: 'spiral', n, R, T: rw * S.step * DEG, w: D / 2 - S.post / 2, D, sgn, fwd: D, lat: 0, hard, score: 0 }];
}

function candidates(env, type) {
  if (type === 'straight') return straightC(env, 'straight');
  if (type === 'steps') return stepsC(env, 'steps');
  if (type === 'deck') return (env.rise <= RULES.steps.rise + EPS ? stepsC(env, 'deck') : straightC(env, 'deck')).map((c) => ({ ...c, base: env.rise <= RULES.steps.rise + EPS ? 'steps' : 'straight' }));
  if (type === 'ladder') return ladderC(env);
  if (type === 'spiral') return spiralC(env);
  return turnC(env, type);
}

function deficits(c, env) {
  return {
    run: Math.max(0, (c.need ?? c.fwd) - env.run),
    side: c.lat > EPS ? Math.max(0, c.lat - (c.sgn > 0 ? env.side.right : env.side.left)) : 0,
    clear: c.D ? Math.max(0, c.D - env.clear) : 0,
  };
}

function choose(cands, env) {
  let best = null, bk = null;
  for (const c of cands) {
    const d = deficits(c, env), sum = d.run + d.side + d.clear;
    const k = [c.hard.length, sum < EPS ? 0 : sum, c.score];
    if (!best || k[0] < bk[0] || (k[0] === bk[0] && (k[1] < bk[1] - EPS || (Math.abs(k[1] - bk[1]) <= EPS && k[2] < bk[2])))) (best = c), (bk = k), (c.def = d);
  }
  return best;
}

// ---- from a chosen candidate to a full layout
function rectOf(a, d, len, w) {
  const b = [a[0] + d[0] * len, a[1] + d[1] * len], p = [-d[1] * (w / 2), d[0] * (w / 2)];
  const us = [a[0] + p[0], a[0] - p[0], b[0] + p[0], b[0] - p[0]], vs = [a[1] + p[1], a[1] - p[1], b[1] + p[1], b[1] - p[1]];
  return [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)].map(r3);
}
const bboxOf = (pts) => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))].map(r3);
const segLen = (g) => (g.c ? g.r * Math.abs(g.a1 - g.a0) : Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]));

function build(c, env) {
  const { rise } = env, n = c.n, R = c.R, T = c.T, w = c.w, sgn = c.sgn || 1;
  const Ly = {
    ok: true, issues: [], fixes: [], fits: [], text: '', label: `${n} x ${mm(R)} mm`,
    type: c.type, pick: env.type, auto: false, base: c.base || null,
    x: env.x, z: env.z, dir: env.dir, rise: r3(rise), n, riser: r3(R), tread: r3(T), width: r3(w),
    angle: Math.round((Math.atan2(R, T) / DEG) * 10) / 10, turn: null, at: null,
    flights: [], landings: [], landing: null, winders: [], corner: null, spiral: null, rects: [], path: [], well: [],
  };
  const els = [];   // walkable pieces with their tops and where they sit on the walking line, for headroom
  let s = 0;
  const flight = (k0, m, a, d) => {
    const len = Math.max(0, (m - 1) * T);
    const f = { n: m, k0, y0: r3(k0 * R), y1: r3((k0 + m) * R), a: a.map(r3), d, len: r3(len), w: r3(w), stringer: r3(Math.hypot(m * T, m * R)) };
    Ly.flights.push(f);
    Ly.rects.push({ part: 'flight', r: rectOf(a, d, len, w) });
    for (let j = 1; j < m; j++) els.push({ g: 'f' + Ly.flights.length, top: (k0 + j) * R, s0: s + (j - 1) * T, r: rectOf([a[0] + d[0] * (j - 1) * T, a[1] + d[1] * (j - 1) * T], d, T, w) });
    if (len > 0) Ly.path.push({ a: a.map(r3), b: [a[0] + d[0] * len, a[1] + d[1] * len].map(r3) });
    s += len;
    return f;
  };
  const line = (a, b) => { Ly.path.push({ a: a.map(r3), b: b.map(r3) }); s += Math.hypot(b[0] - a[0], b[1] - a[1]); };

  if (c.type === 'spiral') {
    const S = RULES.spiral, Rr = c.D / 2, step = S.step * DEG, sweep = (n - 1) * step, a0 = -sgn * (Math.PI / 2), rw = S.walk * Rr;
    Ly.turn = sideName(sgn);
    Ly.spiral = { c: [r3(Rr), 0], r: r3(Rr), post: S.post, a0, step: sgn * step, treads: n - 1, rw: r3(rw), sweep };
    Ly.rects.push({ part: 'spiral', r: [0, r3(-Rr), r3(c.D), r3(Rr)] });
    Ly.path.push({ c: [Rr, 0], r: rw, a0, a1: a0 + sgn * sweep });
    s = rw * sweep;
    Ly.well = [[0, r3(-Rr), r3(c.D), r3(Rr)]];
    const ae = a0 + sgn * sweep;
    Ly.head = [r3(Rr + rw * Math.cos(ae)), r3(rw * Math.sin(ae))];
    Ly.headDir = [r3(-sgn * Math.sin(ae)), r3(sgn * Math.cos(ae))];
    // headroom: each tread (and the floor in the quarter you walk in over) against the tread a full turn above it
    let hr = INF;
    for (let i = 0, N = Math.ceil(((Math.PI / 2 + sweep) / step) * 4); i < N; i++) {
      const q = -Math.PI / 2 + (i + 0.5) * (step / 4), top = q < 0 ? 0 : Math.min(n - 1, Math.floor(q / step) + 1) * R;
      for (let m = 1; q + m * TAU <= sweep + EPS; m++) hr = Math.min(hr, Math.min(n - 1, Math.floor((q + m * TAU) / step) + 1) * R - S.thick - top);
    }
    Ly.headroom = hr === INF ? INF : r3(hr);
    Ly.wellLength = r3(s);
    if (hr < RULES.headroom - EPS) Ly.issues.push(issue('headroom', `Head hits the tread above: ${fm(hr)} m of headroom`, RULES.headroom - hr));
  } else {
    if (c.type === 'l' || c.type === 'u' || c.type === 'winder') {
      const at = c.at, u1 = (at - 1) * T;
      Ly.turn = sideName(sgn);
      Ly.at = at;
      flight(0, at, [0, 0], [1, 0]);
      if (c.type === 'l') {
        const r = [u1, sgn > 0 ? -w / 2 : -w / 2, u1 + w, w / 2].map(r3);
        Ly.landings.push({ r, y: r3(at * R), after: at });
        Ly.rects.push({ part: 'landing', r });
        els.push({ g: 'l', top: at * R, s0: s, r });
        line([u1, 0], [u1 + w / 2, 0]), line([u1 + w / 2, 0], [u1 + w / 2, (sgn * w) / 2]);
        flight(at, n - at, [u1 + w / 2, (sgn * w) / 2], [0, sgn]);
      } else if (c.type === 'u') {
        const g = RULES.gap, far = sgn * (w / 2 + g + w), r = [u1, Math.min(-sgn * (w / 2), far), u1 + w, Math.max(-sgn * (w / 2), far)].map(r3);
        Ly.landings.push({ r, y: r3(at * R), after: at });
        Ly.rects.push({ part: 'landing', r });
        els.push({ g: 'l', top: at * R, s0: s, r });
        line([u1, 0], [u1 + w / 2, 0]), line([u1 + w / 2, 0], [u1 + w / 2, sgn * (w + g)]), line([u1 + w / 2, sgn * (w + g)], [u1, sgn * (w + g)]);
        flight(at, n - at, [u1, sgn * (w + g)], [-1, 0]);
      } else {
        const P = [u1, (sgn * w) / 2], q = Math.tan(30 * DEG) * w, at2 = (du, dv) => [r3(P[0] + du), r3(P[1] + dv)];
        const sq = [u1, -w / 2, u1 + w, w / 2].map(r3), rw = w / 2;
        const wedges = [
          [at2(0, 0), at2(0, -sgn * w), at2(q, -sgn * w)],
          [at2(0, 0), at2(q, -sgn * w), at2(w, -sgn * w), at2(w, -sgn * q)],
          [at2(0, 0), at2(w, -sgn * q), at2(w, 0)],
        ];
        Ly.corner = { p: P.map(r3), r: sq, sgn, y0: r3(at * R), y1: r3((at + 2) * R) };
        wedges.forEach((pts, i) => {
          Ly.winders.push({ pts, y: r3((at + i) * R) });
          els.push({ g: 'w', top: (at + i) * R, s0: s + (i * rw * Math.PI) / 6, r: bboxOf(pts) });
        });
        Ly.rects.push({ part: 'winders', r: sq });
        Ly.path.push({ c: P.map(r3), r: r3(rw), a0: -sgn * (Math.PI / 2), a1: 0 });
        s += (rw * Math.PI) / 2;
        flight(at + 2, n - at - 2, [u1 + w / 2, (sgn * w) / 2], [0, sgn]);
      }
    } else flight(0, n, [0, 0], [1, 0]);
    Ly.landing = Ly.landings[0] || null;
    const f = Ly.flights[Ly.flights.length - 1];
    Ly.head = [r3(f.a[0] + f.d[0] * f.len), r3(f.a[1] + f.d[1] * f.len)];
    Ly.headDir = f.d.slice();
    // the well: open the floor above wherever someone standing there would have under 2.0 m over their head
    const th = env.ceiling - RULES.headroom, total = s;
    const want = els.filter((e) => e.top > th + EPS);
    const wantOpen = want.length ? total - Math.min(...want.map((e) => e.s0)) : 0;
    const open = Math.min(wantOpen, env.opening);
    const opened = (e) => e.top > th + EPS && total - e.s0 <= open + EPS;
    let hr = INF;
    for (const e of els) if (!opened(e) && env.ceiling < INF) hr = Math.min(hr, env.ceiling - e.top);
    const groups = new Map();
    for (const e of els) if (opened(e)) {
      const b = groups.get(e.g);
      groups.set(e.g, b ? [Math.min(b[0], e.r[0]), Math.min(b[1], e.r[1]), Math.max(b[2], e.r[2]), Math.max(b[3], e.r[3])] : e.r.slice());
    }
    Ly.well = [...groups.values()];
    Ly.wellLength = r3(Math.min(wantOpen, open));
    Ly.headroom = hr === INF ? INF : r3(hr);
    if (hr < RULES.headroom - EPS) Ly.issues.push(issue('headroom', `Head hits the floor above: ${fm(hr)} m of headroom`, RULES.headroom - hr)), (Ly._open = up05(wantOpen));
  }
  Ly.walk = r3(s);
  const rs = Ly.rects.map((x) => x.r);
  Ly.box = [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))];
  Ly.length = r3(Ly.box[2]);
  Ly.span = [Ly.box[1], Ly.box[3]];
  Ly.footprint = [[Ly.box[0], Ly.box[1]], [Ly.box[2], Ly.box[1]], [Ly.box[2], Ly.box[3]], [Ly.box[0], Ly.box[3]]].map(([u, v]) => toWorld(Ly, u, v).map(r3));
  Ly.railDefault = rise < RULES.rail - EPS ? 'none' : 'both';
  Ly.parts = { risers: n, treads: n - 1, landings: Ly.landings.length, winders: Ly.winders.length, stringers: Ly.flights.map((f) => f.stringer) };
  // what does not fit, worst first after the hard rules
  const d = c.def || deficits(c, env);
  Ly.issues.unshift(...c.hard);
  if (d.run > EPS) {
    const need = c.need ?? c.fwd;
    Ly.issues.push(issue('run', c.steep ? `Too steep: ${n} risers of ${mm(R)} mm in ${fm(env.run)} m`
      : c.type === 'ladder' ? `Too steep even for a ship's ladder: needs ${fm(need)} m of run` : `Needs ${fm(need)} m of run, has ${fm(env.run)} m`, d.run));
  }
  if (d.side > EPS) Ly.issues.push(issue('side', `Needs ${fm(c.lat)} m of room to the ${sideName(sgn)}, has ${fm(c.lat - d.side)} m`, d.side));
  if (d.clear > EPS) Ly.issues.push(issue('clear', `A spiral needs a clear square of ${fm(c.D)} m; there is ${fm(env.clear)} m`, d.clear));
  if (env.rise < 0.02) Ly.issues.unshift(issue('rise', 'No change of level here', 0.02 - env.rise));
  Ly.ok = Ly.issues.length === 0;
  Ly.text = Ly.ok ? `${TYPE_BY_ID[Ly.type].name} · ${Ly.label}` : Ly.issues[0].text;
  return Ly;
}

function solveType(env, type) { return build(choose(candidates(env, type), env), { ...env, type }); }

function core(env) {
  if (env.type !== 'auto') return solveType(env, env.type);
  let Ly = null;
  if (env.rise <= RULES.steps.rise + EPS) Ly = solveType(env, 'steps');
  else {
    for (const t of ['straight', 'l', 'u']) if ((Ly = solveType(env, t)).ok) break;
    if (!Ly.ok && env.clear >= RULES.spiral.auto - EPS) Ly = solveType(env, 'spiral');
    if (!Ly.ok) Ly = solveType(env, 'ladder');
  }
  return Object.assign(Ly, { pick: 'auto', auto: true });
}

// the shortest run ahead that this type needs, all else as it is
function minRun(env, type) {
  const free = { ...env, run: INF };
  const ok = candidates(free, type).filter((c) => !c.hard.length && !c.steep && (() => { const d = deficits(c, free); return d.side < EPS && d.clear < EPS; })());
  return ok.length ? up05(Math.min(...ok.map((c) => c.fwd))) : INF;
}

function fixesFor(input, env, Ly) {
  const out = [], seen = new Set(), cur = Ly.type;
  const tryP = (code, label, patch) => {
    if (out.length >= 3 || seen.has(label)) return;
    if (core(norm({ ...input, ...patch })).ok) seen.add(label), out.push({ code, label, patch });
  };
  const specific = [];
  for (const is of Ly.issues) {
    if (is.code === 'run') { const m = minRun(env, cur); if (m < INF && m > env.run) specific.push(['run', `Lengthen to ${fm(m)} m`, { run: m }]); }
    if (is.code === 'side') {
      if (env.at) { const b = core({ ...env, at: null }); if (b.ok && b.at) specific.push(['at', `Landing after riser ${b.at}`, { at: b.at }]); }
      const other = Ly.turn === 'right' ? 'left' : 'right';
      specific.push(['turn', `Turn ${other}`, { turn: other }]);
      if (cur === 'u') { const room = Ly.turn === 'right' ? env.side.right : env.side.left, w2 = Math.floor((room - RULES.gap) * 100) / 100; if (w2 >= RULES.width.min) specific.push(['width', `Narrow to ${fm(w2)} m`, { width: w2 }]); }
    }
    if (is.code === 'headroom' && Ly._open) specific.push(['opening', `Lengthen the opening to ${fm(Ly._open)} m`, { opening: Ly._open }]);
    if (is.code === 'riser' && env.n) { const b = core({ ...env, n: null }); if (b.ok) specific.push(['n', `Use ${b.n} risers`, { n: b.n }]); }
    if (is.code === 'run' && env.at) { const b = core({ ...env, at: null }); if (b.ok && b.at) specific.push(['at', `Landing after riser ${b.at}`, { at: b.at }]); }
  }
  const order = cur === 'steps' || cur === 'deck' ? ['straight', ...SWITCH] : SWITCH;
  const types = [...new Set(order)].filter((t) => t !== cur && !(cur === 'deck' && t === Ly.base));
  const sw = (t) => ['type', FIX_LABEL[t], { type: t, n: null, at: null }];
  const first = types.find((t) => core(norm({ ...input, type: t, n: null, at: null })).ok);
  if (first) tryP(...sw(first));
  for (const f of specific) tryP(...f);
  for (const t of types) tryP(...sw(t));
  return out;
}

export function solve(input = {}) {
  const env = norm(input);
  const Ly = core(env);
  if (!Ly.ok) Ly.fixes = fixesFor(input, env, Ly);
  delete Ly._open;
  Ly.fits = TYPES.filter((t) => t.id !== 'auto' && core(norm({ ...input, type: t.id, n: null, at: null })).ok).map((t) => t.id);
  return Ly;
}

// ---- frames
function axes(Ly) {
  const d = +Ly.dir || 0;
  if (Number.isInteger(d)) { const f = DIRS[((d % 4) + 4) % 4]; return [f, [-f[1], f[0]]]; }
  const f = [Math.cos(d * Math.PI / 2), Math.sin(d * Math.PI / 2)];
  return [f, [-f[1], f[0]]];
}
export function toWorld(Ly, u, v) { const [f, r] = axes(Ly); return [Ly.x + f[0] * u + r[0] * v, Ly.z + f[1] * u + r[1] * v]; }
export function toLocal(Ly, x, z) { const [f, r] = axes(Ly), dx = x - Ly.x, dz = z - Ly.z; return [dx * f[0] + dz * f[1], dx * r[0] + dz * r[1]]; }

// ---- walking: a ramp per flight, flat on landings, by angle round the winders and the spiral
const inR = (r, u, v) => u >= r[0] - EPS && u <= r[2] + EPS && v >= r[1] - EPS && v <= r[3] + EPS;
const STEP_UP = 0.35;
// Height (above the foot's surface) of the stair under building point (x, z), or null when the point is off the stair.
// y: the walker's current height; where levels overlap (a spiral) the highest one within a step up of y is taken.
export function heightAt(Ly, x, z, y = 0) {
  const [u, v] = toLocal(Ly, x, z), hs = [];
  if (Ly.spiral) {
    const S = Ly.spiral, du = u - S.c[0], dv = v - S.c[1];
    if (Math.hypot(du, dv) > S.r + EPS) return null;
    const sg = Math.sign(S.step);
    let q = (sg * (Math.atan2(dv, du) - S.a0)) % TAU;
    if (q < 0) q += TAU;
    hs.push(0);
    for (let k = q; k <= S.sweep + EPS; k += TAU) hs.push(S.sweep > 0 ? (Math.min(k, S.sweep) / S.sweep) * Ly.rise : Ly.rise);
  } else {
    for (const f of Ly.flights) {
      if (f.len < EPS) continue;
      const t = (u - f.a[0]) * f.d[0] + (v - f.a[1]) * f.d[1], lat = -(u - f.a[0]) * f.d[1] + (v - f.a[1]) * f.d[0];
      if (Math.abs(lat) <= f.w / 2 + EPS && t >= -EPS && t <= f.len + EPS) hs.push(f.y0 + clamp(t / f.len, 0, 1) * (f.y1 - f.y0));
    }
    for (const l of Ly.landings) if (inR(l.r, u, v)) hs.push(l.y);
    const C = Ly.corner;
    if (C && inR(C.r, u, v)) {
      const a = Math.atan2(u - C.p[0], -C.sgn * (v - C.p[1]));
      hs.push(C.y0 + clamp(a / (Math.PI / 2), 0, 1) * (C.y1 - C.y0));
    }
  }
  if (!hs.length) return null;
  const under = hs.filter((h) => h <= y + STEP_UP + EPS);
  return under.length ? Math.max(...under) : Math.min(...hs);
}

// Points along the walking line from the foot to the head, about `step` metres apart: [{ u, v, x, z, s }].
export function walkLine(Ly, step = 0.1) {
  const out = [];
  let s0 = 0;
  for (const g of Ly.path) {
    const L = segLen(g), k = Math.max(1, Math.ceil(L / step));
    for (let i = out.length ? 1 : 0; i <= k; i++) {
      const t = i / k;
      const p = g.c ? [g.c[0] + g.r * Math.cos(g.a0 + (g.a1 - g.a0) * t), g.c[1] + g.r * Math.sin(g.a0 + (g.a1 - g.a0) * t)] : [g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t];
      const [x, z] = toWorld(Ly, p[0], p[1]);
      out.push({ u: p[0], v: p[1], x, z, s: s0 + L * t });
    }
    s0 += L;
  }
  return out;
}

// ---- records
export const LOOK_DEFAULTS = Object.freeze({ mat: 'pine', rail: null, railStyle: 'square', open: null, nosing: null, boxed: false });
// A saved stair as a full record. Old records { id, i, j, dir } (one cell wide, a storey high, straight up from cell i, j)
// become a straight stair to the storey above, 0.92 m wide, laid out by the rules. env: { rise } or { hs } (storey scale).
export function fromRecord(rec, env = {}) {
  if (!rec) return null;
  const look = {};
  for (const k in LOOK_DEFAULTS) look[k] = rec[k] ?? LOOK_DEFAULTS[k];
  if (rec.type && TYPE_BY_ID[rec.type]) {
    return { id: rec.id, type: rec.type, x: +rec.x || 0, z: +rec.z || 0, dir: +rec.dir || 0, rise: rec.rise ?? env.rise ?? null, run: rec.run ?? null,
      width: rec.width ?? RULES.width.def, n: rec.n ?? null, turn: rec.turn ?? null, at: rec.at ?? null, ...look };
  }
  const dir = ((Math.round(+rec.dir || 0) % 4) + 4) % 4, [dx, dz] = DIRS[dir];
  const rise = r3(env.rise ?? RULES.storey * (env.hs ?? 1));
  const Ly = core(norm({ type: 'straight', rise, width: RULES.width.def }));
  return { id: rec.id, type: 'straight', x: (+rec.i || 0) + 0.5 - dx * 0.5, z: (+rec.j || 0) + 0.5 - dz * 0.5, dir, rise, run: Ly.length,
    width: RULES.width.def, n: Ly.n, turn: null, at: null, ...look };
}
// Solve a record where it stands. env carries what the record does not: rise (if absent), side, clear, ceiling, opening.
export function layoutOf(rec, env = {}) {
  const r = fromRecord(rec, env);
  return solve({ ...env, type: r.type, x: r.x, z: r.z, dir: r.dir, rise: r.rise ?? env.rise, run: r.run ?? env.run, width: r.width, n: r.n, turn: r.turn, at: r.at });
}
// The look with its defaults filled in: rails off under 0.6 m, open risers on deck steps and ladders, no nosing on a ladder.
export function lookOf(rec = {}, Ly = {}) {
  const open = Ly.type === 'deck' || Ly.type === 'ladder';
  return {
    mat: rec.mat || 'pine', rail: rec.rail || Ly.railDefault || 'both', railStyle: rec.railStyle || 'square',
    open: rec.open ?? open, nosing: rec.nosing ?? Ly.type !== 'ladder', boxed: !!rec.boxed,
  };
}
