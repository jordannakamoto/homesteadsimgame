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
//
// ---- Grand stairs (GRAND_TYPES): 'curved', 'grand' (elliptical half turn), 'imperial', 'bifurcated', 'horseshoe'
// Auto never picks them. solve() lists them in layout.suggest when Auto runs in a big open hall (a storey's rise, 4 m of
// run, 1.2 m or more each side, no limit on the opening) and they fit there; a type picked by the player solves as usual.
// Extra input: sweep (degrees the curve turns: 90, 180, 270, 360 keep the head square to the floor; others get a curved
//   landing that squares it off), radius (inner radius of the curve, m; 'grand': at the head). Neither given: the solver
//   picks them for comfort and the room, preferring 1.5 m inside; a curve with room to spare starts with a straight run.
// Curves are measured on the walking line, 0.45 m in from the inner edge (the middle on narrower stairs): riser and going
//   as for a straight stair, the narrow end of each tapered tread at least 150 mm, at most 20 risers in the sweep.
// Their layouts add:
//   curves: [{ n, k0, y0, y1, lines: [[lu, lv, ru, rv], ...], c, sgn, a0, sweep, lead, fill, rin: [foot, head], w: [foot, head] }]
//       lines are the riser lines (the left and right ends, as the climber sees them), lines[0] the first riser, the last one
//       landing on the floor (or the apex landing); tread j (1 .. lines.length - 1) is the quad lines[j-1], lines[j] at
//       y0 + j * riser. c the centre of the arc, a0 the angle of its first radial line, sweep (radians) of the treads, lead
//       the straight run before the arc (m), fill (radians) of the curved landing that squares the head to the floor.
//   landings may carry pts (a convex polygon: the horseshoe's apex) or quads (the curved fill) instead of being their rect r.
//   arrive: [[[u, v], [u, v]], ...] the lines where flights step onto the upper floor (on the well's edge): the gallery guard
//       runs round the well's edge except there. heads: the same lines' midpoints. radius, sweep (degrees), lead, narrow
//       (least narrow-end going), widthFoot (the grand curve and a flared start are wider at the foot), wing (width of an
//       imperial or bifurcated stair's two upper flights; width is the central flight's), suggest.
//   imperial: flights [central, right wing, left wing], one landing across the back at riser `at`; the walking line takes
//   the wing on the `turn` side (right unless asked). bifurcated: the same, the wings leave the landing's ends at 90 deg.
//   horseshoe: two curves (right leg first) from feet either side of the foot's centre, meeting on the apex landing.
// Flared start (input flare: 0..3 bottom steps, flareSide 'both'|'left'|'right'; records keep flare): on straight, l, u and the
//   grand types the bottom steps widen with bullnose ends and the first is a curtail step round a newel under a volute.
//   layout.flare = { n, sides, ext: [m per step], quads: [{ pts, y }], curtail: [{ c, r, y, sg }] } (heightAt walks them).
// New issue codes: hall (the room is too small for this grand stair), radius (curve too tight), narrow (tapered treads too
// narrow at the narrow end), sweep (more than a full turn), flare (no room beside the stair for the flared foot).
// New fix codes: sweep {sweep}, radius {radius}, flare {flare: 0}, hall {run, side} (advice: the hall must be made bigger;
// the stair tool cannot do that itself).

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
  // curves: inner radius range and the one Auto aims for, least going at the narrow end, the walking line's distance
  // from the inner edge, sweep range (degrees), most risers in one sweep, the structure's depth under a tread
  curved: Object.freeze({ rin: Object.freeze([0.6, 4.0]), aim: 1.5, narrow: 0.15, line: 0.45, sweep: Object.freeze([45, 360]), flight: 20, depth: 0.3 }),
  grand: Object.freeze({
    width: Object.freeze({ curved: 1.2, grand: 1.4, imperial: 1.6, bifurcated: 1.4, horseshoe: 1.1, min: 0.9, max: 2.4 }),
    wing: 0.62, wingMin: 0.9, gap: 0.1,    // imperial / bifurcated: wings as a share of the central flight, the gap beside it
    foot: 0.5, footF: 0.45, ellipse: 1.4,  // grand curve: this much wider at the foot, narrowing over this share; foot radius / head radius
    apex: 30,                              // horseshoe: degrees of the apex landing between the two legs
    rise: 1.0,                             // least rise for a grand stair
    hall: Object.freeze({ rise: 2.0, run: 4.0, side: 1.2 }),   // when Auto suggests them
  }),
  flare: Object.freeze({ n: 3, ext: Object.freeze([Object.freeze([0.34]), Object.freeze([0.34, 0.17]), Object.freeze([0.34, 0.22, 0.11])]), curtail: 0.22 }),
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
  { id: 'curved', name: 'Curved', grand: true, blurb: 'A sweeping flight round an open well, a quarter to a full turn. Needs a big hall.' },
  { id: 'grand', name: 'Grand curve', grand: true, blurb: 'The entrance-hall stair: an elliptical half turn, wide at the foot, up to a gallery.' },
  { id: 'imperial', name: 'Imperial', grand: true, blurb: 'A wide flight to a half landing, then two flights back up either side to a gallery.' },
  { id: 'bifurcated', name: 'Bifurcated', grand: true, blurb: 'One wide flight to a landing, then two flights turning left and right.' },
  { id: 'horseshoe', name: 'Horseshoe', grand: true, blurb: 'Two curved flights mirroring each other up to one landing.' },
].map(Object.freeze));
export const TYPE_BY_ID = Object.freeze(Object.fromEntries(TYPES.map((t) => [t.id, t])));
export const GRAND_TYPES = Object.freeze(['curved', 'grand', 'imperial', 'bifurcated', 'horseshoe']);
export const FLARE_TYPES = Object.freeze(['straight', 'l', 'u', 'curved', 'grand', 'imperial', 'bifurcated', 'horseshoe']);
export const SWEEPS = Object.freeze([90, 180, 270, 360]);
export const WIDTHS = Object.freeze([0.8, 0.92, 1.07, 1.2]);
export const MATERIALS = Object.freeze([
  { id: 'pine', name: 'Pine' }, { id: 'oak', name: 'Oak' }, { id: 'dark', name: 'Dark stain' },
  { id: 'white', name: 'Painted white, wood treads' }, { id: 'stone', name: 'Stone', only: ['steps', 'deck'] },
].map(Object.freeze));
export const RAILS = Object.freeze(['both', 'left', 'right', 'none', 'wall']);
export const RAIL_STYLES = Object.freeze([{ id: 'square', name: 'Square balusters' }, { id: 'rails', name: 'Horizontal rails' }, { id: 'plain', name: 'Plain handrail' }].map(Object.freeze));
const FIX_LABEL = { steps: 'Use steps', straight: 'Make it straight', l: 'Make it L-shaped', u: 'Make it U-shaped', winder: 'Use winders', spiral: 'Use a spiral', ladder: "Use a ship's ladder", deck: 'Use deck steps',
  curved: 'Make it curved', grand: 'Make it a grand curve', imperial: 'Make it imperial', bifurcated: 'Split it left and right', horseshoe: 'Make it a horseshoe' };
// from a grand stair that does not fit, the plain ones read as a step down
const INSTEAD = { l: 'Use an L instead', u: 'Use a U instead', straight: 'Use a straight stair instead', spiral: 'Use a spiral instead', winder: 'Use winders instead', ladder: "Use a ship's ladder instead", steps: 'Use steps instead' };
const isGrand = (t) => GRAND_TYPES.includes(t);
const SWITCH = ['l', 'spiral', 'u', 'winder', 'ladder', 'straight', 'steps'];
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const r3 = (x) => Math.round(x * 1000) / 1000;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
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
    wGiven: given(inp.width),
    sweep: given(inp.sweep) && +inp.sweep > 0 ? clamp(+inp.sweep, RULES.curved.sweep[0], 400) : null,
    radius: given(inp.radius) && +inp.radius > 0 ? clamp(+inp.radius, 0.3, RULES.curved.rin[1]) : null,
    flare: given(inp.flare) ? clamp(Math.round(+inp.flare), 0, RULES.flare.n) : 0,
    flareSide: inp.flareSide === 'left' || inp.flareSide === 'right' ? inp.flareSide : 'both',
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

// ---- grand stairs. A candidate carries what fitting needs (its box, from the arc analytically); riser lines are made
// only for the one chosen.
const QT = Math.PI / 2;
function gWidth(env, type) { const W = RULES.grand.width; return clamp(env.wGiven ? env.width : W[type], W.min, W.max); }
function wingOf(w) { const G = RULES.grand; return r3(clamp(Math.round(w * G.wing * 20) / 20, G.wingMin, Math.max(G.wingMin, w))); }

// a curve's plan: inner radius and width along it (f = 0 at the first riser, 1 at the last), the walking line in from the inner edge
function shapeOf(rin0, rin1, w0, w1) {
  const F = RULES.grand.footF, L = RULES.curved.line;
  const rin = Math.abs(rin0 - rin1) < EPS ? () => rin1 : (f) => rin1 + ((rin0 - rin1) * (1 + Math.cos(Math.PI * f))) / 2;
  const wd = Math.abs(w0 - w1) < EPS ? () => w1 : (f) => w1 + (w0 - w1) * (f < F ? (1 - f / F) ** 2 : 0);
  const line = (f) => Math.min(wd(f) / 2, L);
  return { rin0, rin1, w0, w1, rin, wd, line, rw: (f) => rin(f) + line(f) };
}
const ARC_K = 48;
function arcTab(S, sweep) {
  const t = [0];
  let px = S.rw(0), py = 0;
  for (let i = 1; i <= ARC_K; i++) {
    const f = i / ARC_K, a = f * sweep, r = S.rw(f), x = r * Math.cos(a), y = r * Math.sin(a);
    t.push(t[i - 1] + Math.hypot(x - px, y - py));
    (px = x), (py = y);
  }
  return t;
}
const arcLen = (S, sweep) => (sweep > EPS ? arcTab(S, sweep)[ARC_K] : 0);
function fAt(tab, s) {
  if (s <= 0) return 0;
  if (s >= tab[ARC_K]) return 1;
  let lo = 0, hi = ARC_K;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tab[m] <= s) lo = m; else hi = m; }
  return (lo + (s - tab[lo]) / (tab[hi] - tab[lo] || 1)) / ARC_K;
}
// a curve starting at o heading d (axis aligned), turning sgn (+1 right) after a straight lead: its centre and first radial line
function curveSpec(o, d, sgn, lead, sweep, S) {
  const p = [-d[1], d[0]], rc = S.rin0 + S.w0 / 2;
  const c = [o[0] + d[0] * lead + p[0] * sgn * rc, o[1] + d[1] * lead + p[1] * sgn * rc];
  return { o, d, p, sgn, lead, sweep, S, c, a0: Math.atan2(-sgn * p[1], -sgn * p[0]) };
}
// the curved landing that brings a head which is not square to the floor round to the next quarter
const fillOf = (sweep) => { const f = Math.ceil(sweep / QT - 1e-3) * QT - sweep; return f < 0.5 * DEG ? 0 : f; };
function specPts(sp, fill) {
  const { o, d, p, S, c, a0, sgn, lead } = sp, pts = [], hw = S.w0 / 2;
  for (const s of [0, lead]) for (const t of [-hw, hw]) pts.push([o[0] + d[0] * s + p[0] * t, o[1] + d[1] * s + p[1] * t]);
  const tot = sp.sweep + fill;
  if (tot > EPS) {
    const N = Math.max(4, Math.ceil(tot / (Math.PI / 12))), phs = [];
    for (let i = 0; i <= N; i++) phs.push((i / N) * tot);
    for (let k = 1; k * QT < tot - EPS; k++) phs.push(k * QT);
    for (const ph of phs) {
      const f = sp.sweep > EPS ? Math.min(1, ph / sp.sweep) : 1, a = a0 + sgn * ph, ri = S.rin(f), ro = ri + S.wd(f);
      pts.push([c[0] + Math.cos(a) * ri, c[1] + Math.sin(a) * ri], [c[0] + Math.cos(a) * ro, c[1] + Math.sin(a) * ro]);
    }
  }
  return pts;
}
// the going at the narrow end, along the curve
function narrowOf(S, T) {
  let m = INF;
  for (const f of [0, 0.25, 0.5, 0.75, 1]) m = Math.min(m, (T * S.rin(f)) / Math.max(EPS, S.rw(f)));
  return m;
}
function grandHard(env, n, R) {
  const hard = [], G = RULES.grand;
  if (env.rise < G.rise - EPS) hard.push(issue('rise', `Too low for a grand stair: ${fm(env.rise)} m rise`, G.rise - env.rise));
  if (env.n && R > RULES.riser.max + EPS) hard.push(issue('riser', `Risers of ${mm(R)} mm are too steep`, R - RULES.riser.max));
  return hard;
}
function curveHard(env, n, R, S, sweep, fill, T) {
  const C = RULES.curved, hard = grandHard(env, n, R), rmin = Math.min(S.rin0, S.rin1);
  if (n > C.flight) hard.push(issue('flight', `${n} risers in one sweep; ${C.flight} is the most`, n - C.flight));
  if (sweep > EPS && rmin < C.rin[0] - EPS) hard.push(issue('radius', `Too tight a curve: ${fm(Math.max(0, rmin))} m inside; ${fm(C.rin[0])} m is the least`, C.rin[0] - rmin));
  else if (sweep > EPS) {
    const nar = narrowOf(S, T);
    if (nar < C.narrow - EPS) hard.push(issue('narrow', `Treads are ${mm(nar)} mm at the narrow end; ${mm(C.narrow)} mm is the least`, C.narrow - nar));
  }
  if (sweep + fill > TAU + 1e-3) hard.push(issue('sweep', 'A curve turns a full circle at most', sweep + fill - TAU));
  else if (sweep > TAU - T / Math.max(EPS, S.rw(0))) {
    // the flight passes over its own foot: a turn's climb less the structure under the tread
    const hr = (TAU * S.rw(1) * R) / T - C.depth;
    if (hr < RULES.headroom - EPS) hard.push(issue('headroom', `Head hits the flight above: ${fm(hr)} m of headroom`, RULES.headroom - hr));
  }
  return hard;
}
const pen = (c, si, env) => ((si && !env.turn ? (c.score += 0.5) : 0), c);
function oneCurve(env, type, n, R, T, w, w0, sgn, rin0, rin1, sweep, lead) {
  const S = shapeOf(rin0, rin1, w0, w), sp = curveSpec([0, 0], [1, 0], sgn, lead, sweep, S), fill = fillOf(sweep);
  const box = bboxOf(specPts(sp, fill));
  return {
    type, grand: true, n, R, T, w, w0, sgn, specs: [sp], fill, box, sweep, lead, rin: rin1, fwd: box[2], latR: box[3] - w0 / 2, latL: -box[1] - w0 / 2,
    hard: curveHard(env, n, R, S, sweep, fill, T),
    score: comfort(R, T, treadRange(R).aim) + 0.12 * Math.abs((rin0 + rin1) / 2 - RULES.curved.aim) + 0.06 * lead + (fill > EPS ? 0.03 : 0),
  };
}
// curved: sweep and radius as asked; otherwise each whole quarter with the radius it needs, and 1.5 m with a straight start
function curvedOpts(env, W, w) {
  const C = RULES.curved, line = Math.min(w / 2, C.line), o = [], rr = env.radius, sw = env.sweep ? env.sweep * DEG : null;
  const capped = (rin, s) => (rin > C.rin[1] ? { rin: C.rin[1], sweep: s, lead: Math.max(0, W - s * (C.rin[1] + line)) } : { rin, sweep: s, lead: 0 });
  if (rr && sw) { const rw = rr + line; o.push(sw * rw <= W + EPS ? { rin: rr, sweep: sw, lead: W - sw * rw } : { rin: rr, sweep: W / rw, lead: 0 }); }
  else if (rr) { const rw = rr + line, mx = W / rw, q = Math.floor(mx / QT + 1e-6) * QT; o.push(q >= QT - EPS ? { rin: rr, sweep: q, lead: W - q * rw } : { rin: rr, sweep: mx, lead: 0 }); }
  else if (sw) o.push(capped(W / sw - line, sw));
  else {
    for (const k of [1, 2, 3, 4]) o.push(capped(W / (k * QT) - line, k * QT));
    const rw = C.aim + line, q = Math.floor(W / rw / QT + 1e-6) * QT;
    if (q >= QT - EPS) o.push({ rin: C.aim, sweep: q, lead: W - q * rw });
  }
  return o;
}
// grand curve: an elliptical sweep (half a turn unless asked), the head radius solved so the walking line is the stair's walk
function grandOpt(env, W, w, w0) {
  const rho = RULES.grand.ellipse, Lr = (r, ph) => arcLen(shapeOf(r * rho, r, w0, w), ph);
  if (env.radius && !env.sweep) {
    let ph = Math.PI;
    for (let i = 0; i < 3; i++) ph *= W / Math.max(EPS, Lr(env.radius, ph));
    return { rin1: env.radius, sweep: ph };
  }
  const ph = env.sweep ? env.sweep * DEG : Math.PI, a = 0.8, b = 1.8, La = Lr(a, ph), Lb = Lr(b, ph), k = (b - a) / (Lb - La || EPS);
  let r = a + (W - La) * k;
  r += (W - Lr(r, ph)) * k;
  return { rin1: r, sweep: ph };
}
// horseshoe: two legs from feet either side, each turning in toward the apex landing, a straight start if there is room
function horseshoeC(env, n, R, T, w) {
  const G = RULES.grand, C = RULES.curved, ph = QT - (G.apex / 2) * DEG, line = Math.min(w / 2, C.line), W = (n - 1) * T, out = [];
  const rins = env.radius ? [env.radius] : uniq([C.aim, 2.0, 2.5, W / ph - line]);
  for (const rin of rins) {
    const rw = rin + line, sw = Math.min(ph, W / Math.max(EPS, rw)), lead = Math.max(0, W - sw * rw), rc = rin + w / 2, S = shapeOf(rin, rin, w, w);
    const right = curveSpec([0, rc], [1, 0], -1, lead, sw, S), left = curveSpec([0, -rc], [1, 0], 1, lead, sw, S);
    const box = bboxOf([...specPts(right, 0), ...specPts(left, 0), [lead + rin + w, 0]]);
    out.push({
      type: 'horseshoe', grand: true, n, R, T, w, w0: w, sgn: 1, specs: [right, left], fill: 0, box, sweep: sw, lead, rin,
      fwd: box[2], latR: box[3] - w / 2, latL: -box[1] - w / 2, hard: curveHard(env, n, R, S, sw, 0, T),
      score: comfort(R, T, treadRange(R).aim) + 0.12 * Math.abs(rin - C.aim) + 0.06 * lead,
    });
  }
  return out;
}
function landingAts(env, n, lo, hi, mid) {
  if (env.at) return [clamp(env.at, Math.min(lo, hi), hi)];
  const a = range(lo, hi);
  return a.length ? a : [Math.max(1, Math.round(mid))];
}
// imperial: the central flight to a half landing across the back, two wings coming back either side
function imperialC(env, n, R, T, wc) {
  const G = RULES.grand, ww = wingOf(wc), span = wc / 2 + G.gap + ww, mid = n / 2, out = [];
  for (const at of landingAts(env, n, Math.max(2, Math.floor(mid) - 1), Math.min(n - 2, Math.ceil(mid) + 1), mid)) {
    const n2 = n - at, u1 = (at - 1) * T, uh = u1 - (n2 - 1) * T, hard = grandHard(env, n, R);
    if (at > RULES.flight || n2 > RULES.flight) hard.push(issue('flight', `${Math.max(at, n2)} risers in one flight; ${RULES.flight} is the most`, Math.max(at, n2) - RULES.flight));
    const box = [Math.min(0, uh), -span, u1 + ww, span].map(r3);
    out.push({ type: 'imperial', grand: true, n, R, T, w: wc, w0: wc, ww, at, n2, u1, uh, sgn: env.turn === 'left' ? -1 : 1, box, fwd: box[2], latR: span - wc / 2, latL: span - wc / 2, hard,
      score: comfort(R, T, treadRange(R).aim) + 0.01 * Math.abs(at - mid) + (uh > EPS ? 0.02 : 0) });
  }
  return out;
}
// bifurcated: the central flight to a landing as wide as itself, the wings leaving its ends left and right
function bifurcatedC(env, n, R, T, wc) {
  const ww = wingOf(wc), mid = n / 2, out = [];
  for (const at of landingAts(env, n, Math.max(2, Math.ceil(n * 0.35)), n - 2, mid)) {
    const n2 = n - at, u1 = (at - 1) * T, len2 = Math.max(0, (n2 - 1) * T), hard = grandHard(env, n, R);
    if (at > RULES.flight || n2 > RULES.flight) hard.push(issue('flight', `${Math.max(at, n2)} risers in one flight; ${RULES.flight} is the most`, Math.max(at, n2) - RULES.flight));
    const box = [0, -(wc / 2 + len2), u1 + ww, wc / 2 + len2].map(r3);
    out.push({ type: 'bifurcated', grand: true, n, R, T, w: wc, w0: wc, ww, at, n2, u1, len2, sgn: env.turn === 'left' ? -1 : 1, box, fwd: box[2], latR: len2, latL: len2, hard,
      score: comfort(R, T, treadRange(R).aim) + 0.01 * Math.abs(at - mid) });
  }
  return out;
}
function grandC(env, type) {
  const out = [], [lo, hi] = riserCounts(env.rise), w = gWidth(env, type);
  const curve = type === 'curved' || type === 'grand';
  const sides = curve ? (env.turn ? [env.turn === 'right' ? 1 : -1] : env.side.right >= env.side.left ? [1, -1] : [-1, 1]) : [1];
  for (const n of env.n ? [env.n] : range(lo, hi)) {
    const R = env.rise / n, tr = treadRange(R);
    for (const T of uniq([tr.aim, tr.lo])) {
      const W = (n - 1) * T;
      if (type === 'curved') for (const o of curvedOpts(env, W, w)) sides.forEach((sgn, si) => out.push(pen(oneCurve(env, type, n, R, T, w, w, sgn, o.rin, o.rin, o.sweep, o.lead), si, env)));
      else if (type === 'grand') {
        const w0 = w + RULES.grand.foot, o = grandOpt(env, W, w, w0);
        sides.forEach((sgn, si) => out.push(pen(oneCurve(env, type, n, R, T, w, w0, sgn, o.rin1 * RULES.grand.ellipse, o.rin1, o.sweep, 0), si, env)));
      } else if (type === 'horseshoe') out.push(...horseshoeC(env, n, R, T, w));
      else if (type === 'imperial') out.push(...imperialC(env, n, R, T, w));
      else out.push(...bifurcatedC(env, n, R, T, w));
    }
  }
  return out;
}

function candidates(env, type) {
  if (isGrand(type)) return grandC(env, type);
  if (type === 'straight') return straightC(env, 'straight');
  if (type === 'steps') return stepsC(env, 'steps');
  if (type === 'deck') return (env.rise <= RULES.steps.rise + EPS ? stepsC(env, 'deck') : straightC(env, 'deck')).map((c) => ({ ...c, base: env.rise <= RULES.steps.rise + EPS ? 'steps' : 'straight' }));
  if (type === 'ladder') return ladderC(env);
  if (type === 'spiral') return spiralC(env);
  return turnC(env, type);
}

function deficits(c, env) {
  if (c.grand) {
    const right = Math.max(0, c.latR - env.side.right), left = Math.max(0, c.latL - env.side.left);
    return { run: Math.max(0, c.fwd - env.run), side: right + left, clear: 0, right, left };
  }
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
  if (c.grand) return buildGrand(c, env);
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
  if (env.flare && FLARE_TYPES.includes(c.type) && Ly.flights.length) applyFlare(Ly, env, [{ lines: flightLines(Ly.flights[0], T), y0: Ly.flights[0].y0 }], true);
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

// riser lines of a straight flight, [[lu, lv, ru, rv], ...]: one at each riser, the last on what the flight lands on
function flightLines(f, T) {
  const p = [-f.d[1], f.d[0]], hw = f.w / 2, out = [];
  for (let j = 0; j < f.n; j++) {
    const m = [f.a[0] + f.d[0] * j * T, f.a[1] + f.d[1] * j * T];
    out.push([m[0] - p[0] * hw, m[1] - p[1] * hw, m[0] + p[0] * hw, m[1] + p[1] * hw].map(r3));
  }
  return out;
}

// a curve spec laid out: m treads T apart on the walking line, the riser lines, the walking line, the squaring landing
function curveOf(sp, T, m, fill) {
  const { o, d, p, S, c, a0, sgn, lead, sweep } = sp, tab = sweep > EPS ? arcTab(S, sweep) : null;
  const at = (a, r) => [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
  const lineAt = (s) => {
    if (!tab || s <= lead + EPS) {
      const q = [o[0] + d[0] * s, o[1] + d[1] * s], hw = S.w0 / 2, off = sgn * (hw - S.line(0));
      return { l: [q[0] - p[0] * hw, q[1] - p[1] * hw], r: [q[0] + p[0] * hw, q[1] + p[1] * hw], wp: [q[0] + p[0] * off, q[1] + p[1] * off], ph: 0 };
    }
    const f = fAt(tab, s - lead), ph = f * sweep, a = a0 + sgn * ph, ri = S.rin(f), inn = at(a, ri), out = at(a, ri + S.wd(f));
    return { l: sgn > 0 ? out : inn, r: sgn > 0 ? inn : out, wp: at(a, ri + S.line(f)), ph };
  };
  const lines = [], phs = [], walk = [], fl = [];
  for (let j = 0; j <= m; j++) {
    const q = lineAt(j * T);
    lines.push([q.l[0], q.l[1], q.r[0], q.r[1]].map(r3));
    phs.push(q.ph);
    if (j) walk.push(lineAt((j - 0.5) * T).wp);
    walk.push(q.wp);
  }
  if (fill > EPS && tab) {
    const k = Math.ceil(fill / (Math.PI / 12)), ri = S.rin(1), wd = S.wd(1);
    for (let i = 1; i <= k; i++) {
      const a = a0 + sgn * (sweep + (fill * i) / k), inn = at(a, ri), out = at(a, ri + wd), l = sgn > 0 ? out : inn, r = sgn > 0 ? inn : out;
      fl.push({ line: [l[0], l[1], r[0], r[1]].map(r3) });
      walk.push(at(a, ri + S.line(1)));
    }
  }
  return { lines, phs, fl, walk: walk.map((q) => q.map(r3)) };
}

// the flared foot: the bottom steps of each run widen on the given sides, the first into a curtail round its newel
function applyFlare(Ly, env, runs, check) {
  const F = RULES.flare, R = Ly.riser, quads = [], curtail = [];
  let sides = env.flareSide === 'left' ? [-1] : env.flareSide === 'right' ? [1] : [-1, 1];
  if (Ly.type === 'u') sides = sides.filter((sg) => sg !== (Ly.turn === 'left' ? -1 : 1));   // not under the U's other flight
  let nf = 0, ext = null;
  for (const run of runs) {
    const L = run.lines, k = Math.min(env.flare, L.length - 2);
    if (k < 1) continue;
    nf = Math.max(nf, k), (ext = F.ext[k - 1]);
    const end = (q, sg) => (sg < 0 ? [q[0], q[1]] : [q[2], q[3]]);
    const outw = (q, sg) => { const dx = (q[2] - q[0]) * sg, dy = (q[3] - q[1]) * sg, l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
    for (const sg of sides) for (let j = 1; j <= k; j++) {
      const A = L[j - 1], B = L[j], x = ext[j - 1], P = end(A, sg), Pn = end(B, sg), e = outw(A, sg), en = outw(B, sg);
      quads.push({ pts: [P, [P[0] + e[0] * x, P[1] + e[1] * x], [Pn[0] + en[0] * x, Pn[1] + en[1] * x], Pn].map((q) => q.map(r3)), y: r3(run.y0 + j * R), sg, j });
      if (j === 1) {
        const dv = [Pn[0] - P[0], Pn[1] - P[1]], al = dv[0] * e[0] + dv[1] * e[1], fv = [dv[0] - e[0] * al, dv[1] - e[1] * al], D1 = Math.hypot(fv[0], fv[1]) || 1;
        const f = [fv[0] / D1, fv[1] / D1], rc = F.curtail, o = D1 / 2 - 0.04;
        curtail.push({ c: [P[0] + e[0] * (x - rc) + f[0] * o, P[1] + e[1] * (x - rc) + f[1] * o].map(r3), r: rc, y: r3(run.y0 + R), sg });
      }
    }
  }
  if (!nf) return;
  Ly.flare = { n: nf, sides, ext: ext.slice(), quads, curtail };
  const pts = [];
  for (const q of quads) pts.push(...q.pts);
  for (const c of curtail) pts.push([c.c[0] - c.r, c.c[1] - c.r], [c.c[0] + c.r, c.c[1] + c.r]);
  Ly.rects.push({ part: 'flare', r: bboxOf(pts) });
  if (check) for (const sg of sides) {
    const room = sg > 0 ? env.side.right : env.side.left;
    if (room < ext[0] - EPS) Ly.issues.push(issue('flare', `The flared foot needs ${fm(ext[0])} m to the ${sideName(sg)}, has ${fm(room)} m`, ext[0] - room));
  }
}

function buildGrand(c, env) {
  const { rise } = env, n = c.n, R = c.R, T = c.T, w = c.w, type = c.type, sgn = c.sgn || 1;
  const Ly = {
    ok: true, issues: [], fixes: [], fits: [], text: '', label: `${n} x ${mm(R)} mm`, type, pick: env.type, auto: false, base: null,
    x: env.x, z: env.z, dir: env.dir, rise: r3(rise), n, riser: r3(R), tread: r3(T), width: r3(w), widthFoot: r3(c.w0 || w),
    angle: Math.round((Math.atan2(R, T) / DEG) * 10) / 10, turn: null, at: null,
    flights: [], landings: [], landing: null, winders: [], corner: null, spiral: null, curves: [], rects: [], path: [], well: [], arrive: [], heads: [],
    radius: null, sweep: null, lead: null, narrow: null, wing: null,
  };
  const els = [], merge = type !== 'curved' && type !== 'grand', runs = [];
  const elQ = (q, top, g) => els.push({ top, r: bboxOf(q), g: merge ? 'm' : g });
  let walk = [];
  if (c.specs) {
    const m = n - 1;
    c.specs.forEach((sp, i) => {
      const fill = i === 0 ? c.fill : 0, cv = curveOf(sp, T, m, fill), L = cv.lines;
      for (let j = 1; j <= m; j++) {
        const A = L[j - 1], B = L[j], s = (j - 0.5) * T;
        elQ([[A[0], A[1]], [A[2], A[3]], [B[2], B[3]], [B[0], B[1]]], j * R, s <= sp.lead + EPS ? 'lead' : 'q' + Math.floor((cv.phs[j - 1] + cv.phs[j]) / 2 / QT + 1e-6));
      }
      const side = (k) => { let t = 0; for (let j = 1; j <= m; j++) t += Math.hypot(Math.hypot(L[j][k] - L[j - 1][k], L[j][k + 1] - L[j - 1][k + 1]), R); return r3(t); };
      Ly.curves.push({ n, k0: 0, y0: 0, y1: r3(rise), lines: L, c: sp.c.map(r3), sgn: sp.sgn, a0: r4(sp.a0), sweep: r4(sp.sweep), lead: r3(sp.lead), fill: r4(fill),
        rin: [r3(sp.S.rin(0)), r3(sp.S.rin(1))], w: [r3(sp.S.wd(0)), r3(sp.S.wd(1))], stringer: [side(0), side(2)] });
      runs.push({ lines: L, y0: 0 });
      const ends = [...L, ...cv.fl.map((f) => f.line)].flatMap((l) => [[l[0], l[1]], [l[2], l[3]]]);
      Ly.rects.push({ part: 'curve', r: bboxOf(ends) });
      if (cv.fl.length) {
        // the curved landing that squares the head to the floor
        const qs = [];
        let prev = L[m];
        for (const f of cv.fl) { const B = f.line; qs.push([[prev[0], prev[1]], [prev[2], prev[3]], [B[2], B[3]], [B[0], B[1]]]); prev = B; }
        Ly.landings.push({ r: bboxOf(qs.flat()), y: r3(rise), after: n, quads: qs });
        for (const q of qs) elQ(q, rise, 'q' + Math.floor((sp.sweep + fill / 2) / QT + 1e-6));
      }
      if (i === 0) walk = cv.walk;
      if (type !== 'horseshoe') { const l = cv.fl.length ? cv.fl[cv.fl.length - 1].line : L[m]; Ly.arrive.push([[l[0], l[1]], [l[2], l[3]]]); }
    });
    const sp = c.specs[0], S = sp.S;
    Ly.radius = r3(c.rin), Ly.sweep = Math.round(sp.sweep / DEG), Ly.lead = r3(sp.lead), Ly.narrow = r3(sp.sweep > EPS ? narrowOf(S, T) : T);
    if (type !== 'horseshoe') Ly.turn = sideName(sgn);
    else {
      // the apex landing between the legs' heads, squared off to the floor ahead
      const cc = sp.c, ri = S.rin(1), ro = ri + S.wd(1), be = QT - sp.sweep, at = (a, r) => [cc[0] + Math.cos(a) * r, cc[1] + Math.sin(a) * r];
      const hex = [at(-be, ri), at(-be, ro), [cc[0] + ro, cc[1] - ro * Math.sin(be)], [cc[0] + ro, cc[1] + ro * Math.sin(be)], at(be, ro), at(be, ri)].map((q) => q.map(r3));
      Ly.landings.push({ r: bboxOf(hex), y: r3(rise), after: n, pts: hex });
      Ly.rects.push({ part: 'landing', r: bboxOf(hex) });
      elQ(hex, rise, 'm');
      walk.push([cc[0] + ri + S.line(1), cc[1]].map(r3), [cc[0] + ro, cc[1]].map(r3));
      Ly.arrive.push([hex[2], hex[3]]);
    }
  } else {
    // imperial and bifurcated: a central flight, a landing, two wings
    const { at, n2, u1, ww } = c, wc = w, g = RULES.grand.gap;
    Ly.at = at, Ly.wing = r3(ww), (Ly.turn = sideName(sgn));
    const mk = (k0, m, a, d, fw) => {
      const len = Math.max(0, (m - 1) * T), f = { n: m, k0, y0: r3(k0 * R), y1: r3((k0 + m) * R), a: a.map(r3), d, len: r3(len), w: r3(fw), stringer: r3(Math.hypot(m * T, m * R)) };
      Ly.flights.push(f);
      Ly.rects.push({ part: 'flight', r: rectOf(a, d, len, fw) });
      for (let j = 1; j < m; j++) els.push({ top: (k0 + j) * R, r: rectOf([a[0] + d[0] * (j - 1) * T, a[1] + d[1] * (j - 1) * T], d, T, fw), g: 'm' });
      return f;
    };
    let lr;
    if (type === 'imperial') {
      const span = wc / 2 + g + ww, vw = wc / 2 + g + ww / 2;
      mk(0, at, [0, 0], [1, 0], wc), mk(at, n2, [u1, vw], [-1, 0], ww), mk(at, n2, [u1, -vw], [-1, 0], ww);
      lr = [u1, -span, u1 + ww, span];
      walk = [[0, 0], [u1, 0], [u1 + ww / 2, 0], [u1 + ww / 2, sgn * vw], [u1, sgn * vw], [c.uh, sgn * vw]];
      for (const s of [1, -1]) Ly.arrive.push([[c.uh, s * vw - ww / 2], [c.uh, s * vw + ww / 2]].map((q) => q.map(r3)));
    } else {
      const len2 = c.len2;
      mk(0, at, [0, 0], [1, 0], wc), mk(at, n2, [u1 + ww / 2, wc / 2], [0, 1], ww), mk(at, n2, [u1 + ww / 2, -wc / 2], [0, -1], ww);
      lr = [u1, -wc / 2, u1 + ww, wc / 2];
      walk = [[0, 0], [u1, 0], [u1 + ww / 2, 0], [u1 + ww / 2, (sgn * wc) / 2], [u1 + ww / 2, sgn * (wc / 2 + len2)]];
      for (const s of [1, -1]) Ly.arrive.push([[u1, s * (wc / 2 + len2)], [u1 + ww, s * (wc / 2 + len2)]].map((q) => q.map(r3)));
    }
    lr = lr.map(r3);
    Ly.landings.push({ r: lr, y: r3(at * R), after: at });
    Ly.rects.push({ part: 'landing', r: lr });
    els.push({ top: at * R, r: lr, g: 'm' });
    runs.push({ lines: flightLines(Ly.flights[0], T), y0: 0 });
    walk = walk.map((q) => q.map(r3));
  }
  Ly.landing = Ly.landings[0] || null;
  // the walking line
  let s = 0;
  for (let i = 1; i < walk.length; i++) {
    const a = walk[i - 1], b = walk[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-6) continue;
    Ly.path.push({ a, b }), (s += l);
  }
  Ly.walk = r3(s);
  const hb = walk[walk.length - 1], ha = walk.length > 1 ? walk[walk.length - 2] : [hb[0] - 1, hb[1]], hl = Math.hypot(hb[0] - ha[0], hb[1] - ha[1]) || 1;
  Ly.head = hb.slice(), (Ly.headDir = [r3((hb[0] - ha[0]) / hl), r3((hb[1] - ha[1]) / hl)]);
  Ly.heads = Ly.arrive.map(([a, b]) => [r3((a[0] + b[0]) / 2), r3((a[1] + b[1]) / 2)]);
  // the well: the floor above opens over whatever would leave under 2.0 m of headroom (by quarter of the curve, or all in one)
  let hr = INF;
  if (env.ceiling < INF) {
    const th = env.ceiling - RULES.headroom, groups = new Map();
    for (const e of els) if (e.top > th + EPS) {
      const b = groups.get(e.g);
      groups.set(e.g, b ? [Math.min(b[0], e.r[0]), Math.min(b[1], e.r[1]), Math.max(b[2], e.r[2]), Math.max(b[3], e.r[3])] : e.r.slice());
    }
    const well = [...groups.values()];
    if (type === 'imperial' && well.length) well[0][0] = c.uh;   // the gallery's edge is where the wings arrive
    Ly.well = well.map((r) => r.map(r3));
    const inWell = (r) => { const cu = (r[0] + r[2]) / 2, cv = (r[1] + r[3]) / 2; return Ly.well.some((W) => cu >= W[0] - EPS && cu <= W[2] + EPS && cv >= W[1] - EPS && cv <= W[3] + EPS); };
    for (const e of els) if (!inWell(e.r)) hr = Math.min(hr, env.ceiling - e.top);
    if (hr < RULES.headroom - EPS) Ly.issues.push(issue('headroom', `Head hits the gallery above: ${fm(hr)} m of headroom`, RULES.headroom - hr));
  }
  Ly.headroom = hr === INF ? INF : r3(hr);
  Ly.wellLength = Ly.well.length ? Ly.walk : 0;
  if (env.flare) applyFlare(Ly, env, runs, false);
  const rs = Ly.rects.map((x) => x.r);
  Ly.box = [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))];
  Ly.length = r3(Ly.box[2]);
  Ly.span = [Ly.box[1], Ly.box[3]];
  Ly.footprint = [[Ly.box[0], Ly.box[1]], [Ly.box[2], Ly.box[1]], [Ly.box[2], Ly.box[3]], [Ly.box[0], Ly.box[3]]].map(([u, v]) => toWorld(Ly, u, v).map(r3));
  Ly.railDefault = 'both';
  const nr = Ly.curves.reduce((a, cv) => a + cv.n, 0) + Ly.flights.reduce((a, f) => a + f.n, 0);
  const nt = Ly.curves.reduce((a, cv) => a + cv.n - 1, 0) + Ly.flights.reduce((a, f) => a + Math.max(0, f.n - 1), 0);
  Ly.parts = { risers: nr, treads: nt, landings: Ly.landings.length, winders: 0, stringers: [...Ly.curves.flatMap((cv) => cv.stringer), ...Ly.flights.flatMap((f) => [f.stringer, f.stringer])] };
  Ly.issues.unshift(...c.hard);
  const d = c.def || deficits(c, env);
  if (d.run > EPS || d.side > EPS) {
    const L = c.box[2] - Math.min(0, c.box[0]), Wd = c.box[3] - c.box[1];
    const size = Math.abs(L - Wd) < 0.3 ? `${fm(up05(Math.max(L, Wd)))} m square` : `${fm(up05(L))} x ${fm(up05(Wd))} m`;
    Ly.issues.push(issue('hall', `Needs a ${size} hall`, Math.max(d.run, d.side)));
  }
  if (env.rise < 0.02) Ly.issues.unshift(issue('rise', 'No change of level here', 0.02 - env.rise));
  Ly.ok = Ly.issues.length === 0;
  Ly.text = Ly.ok ? `${TYPE_BY_ID[type].name} · ${Ly.label}` : Ly.issues[0].text;
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
    if (is.code === 'flare') specific.push(['flare', 'Plain start', { flare: 0 }]);
  }
  const grand = isGrand(cur);
  if (grand) specific.push(...grandFixes(env, Ly));
  const order = grand ? ['l', 'u', 'straight', 'spiral', 'winder', 'ladder', 'steps', ...GRAND_TYPES] : cur === 'steps' || cur === 'deck' ? ['straight', ...SWITCH] : SWITCH;
  const types = [...new Set(order)].filter((t) => t !== cur && !(cur === 'deck' && t === Ly.base));
  const sw = (t) => ['type', (grand && INSTEAD[t]) || FIX_LABEL[t], { type: t, n: null, at: null }];
  const first = types.find((t) => core(norm({ ...input, type: t, n: null, at: null })).ok);
  if (first) tryP(...sw(first));
  if (!grand && hallish(env)) tryP(...sw('curved'));   // a big open hall: offer the grand stair too
  for (const f of specific) tryP(...f);
  for (const t of types) tryP(...sw(t));
  if (grand && Ly.issues.some((is) => is.code === 'hall')) {
    // last, as advice: the room it would need
    const b = Ly.box, w0 = Ly.widthFoot || Ly.width, need = { run: up05(b[2]), side: { left: up05(Math.max(0, -b[1] - w0 / 2)), right: up05(Math.max(0, b[3] - w0 / 2)) } };
    if (out.length < 3 && core(norm({ ...input, ...need })).ok) out.push({ code: 'hall', label: 'Widen the hall', patch: need });
  }
  return out;
}

// a big open room: a storey to climb, room ahead and either side, and the floor above free to open
function hallish(env) {
  const H = RULES.grand.hall;
  return env.rise >= H.rise - EPS && Number.isFinite(env.run) && env.run >= H.run - EPS && Math.min(env.side.left, env.side.right) >= H.side - EPS && env.opening === INF;
}

// fixes in the grand stairs' own terms: another sweep, an easier curve, a narrower stair, a plain start
function grandFixes(env, Ly) {
  const out = [], cur = Ly.type, codes = new Set(Ly.issues.map((is) => is.code)), C = RULES.curved;
  const curve = cur === 'curved' || cur === 'grand' || cur === 'horseshoe';
  if (cur === 'curved' || cur === 'grand') for (const s of SWEEPS) if (s !== Ly.sweep) out.push(['sweep', `Sweep ${s}°`, { sweep: s, radius: null }]);
  if (curve && (codes.has('radius') || codes.has('narrow'))) for (const r of [C.rin[0], 1.0, C.aim]) if (r > (Ly.radius || 0) + 0.05) out.push(['radius', `Open the curve to ${fm(r)} m`, { radius: r }]);
  if (codes.has('hall')) {
    const W = RULES.grand.width;
    for (const w2 of uniq([Ly.width - 0.2, Ly.width - 0.4, W.min].map((x) => Math.round(x * 20) / 20))) if (w2 >= W.min - EPS && w2 < Ly.width - EPS) out.push(['width', `Narrow to ${fm(w2)} m`, { width: w2 }]);
    if (curve && !env.radius) for (const r of [1.0, C.rin[0]]) if (r < (Ly.radius || 0) - 0.05) out.push(['radius', `Tighten the curve to ${fm(r)} m`, { radius: r }]);
  }
  if ((codes.has('headroom') || codes.has('hall')) && env.at) out.push(['at', 'Landing where it fits best', { at: null }]);
  if (env.flare && Ly.flare) out.push(['flare', 'Plain start', { flare: 0 }]);
  if (env.n && (codes.has('riser') || codes.has('flight'))) out.push(['n', 'Let the risers fit', { n: null }]);
  return out;
}

export function solve(input = {}) {
  const env = norm(input);
  const Ly = core(env);
  if (!Ly.ok) Ly.fixes = fixesFor(input, env, Ly);
  delete Ly._open;
  Ly.fits = TYPES.filter((t) => t.id !== 'auto' && !(t.grand && env.rise < RULES.grand.rise - EPS) && core(norm({ ...input, type: t.id, n: null, at: null })).ok).map((t) => t.id);
  // Auto never picks a grand stair, but in a big open hall it says which would fit
  Ly.suggest = env.type === 'auto' && hallish(env) ? Ly.fits.filter(isGrand) : [];
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
// inside a convex polygon (either winding), with a millimetre or two of give for rounded lines
function inConvex(pts, u, v, tol = 2e-3) {
  let pos = false, neg = false;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-9) continue;
    const c = ((b[0] - a[0]) * (v - a[1]) - (b[1] - a[1]) * (u - a[0])) / l;
    if (c > tol) pos = true;
    if (c < -tol) neg = true;
    if (pos && neg) return false;
  }
  return true;
}
// signed side of a riser line [lu, lv, ru, rv]
const lineSide = (L, u, v) => (L[2] - L[0]) * (v - L[1]) - (L[3] - L[1]) * (u - L[0]);
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
    for (const l of Ly.landings) {
      if (l.pts) { if (inConvex(l.pts, u, v)) hs.push(l.y); }
      else if (l.quads) { if (l.quads.some((q) => inConvex(q, u, v))) hs.push(l.y); }
      else if (inR(l.r, u, v)) hs.push(l.y);
    }
    // curves: a ramp across each tread from its riser line to the next, by where the point sits between them
    for (const cv of Ly.curves || []) {
      const L = cv.lines, m = L.length - 1;
      for (let j = 0; j < m; j++) {
        const A = L[j], B = L[j + 1];
        if (!inConvex([[A[0], A[1]], [A[2], A[3]], [B[2], B[3]], [B[0], B[1]]], u, v)) continue;
        const d0 = lineSide(A, u, v), d1 = lineSide(B, u, v), t = clamp(d0 / (d0 - d1 || 1e-12), 0, 1);
        hs.push(cv.y0 + ((j + t) / m) * (cv.y1 - cv.y0));
      }
    }
    // the flared foot: the widened steps and the curtail
    const F = Ly.flare;
    if (F) {
      for (const q of F.quads) if (inConvex(q.pts, u, v)) hs.push(q.y);
      for (const c of F.curtail) if (Math.hypot(u - c.c[0], v - c.c[1]) <= c.r + EPS) hs.push(c.y);
    }
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
export const LOOK_DEFAULTS = Object.freeze({ mat: 'pine', rail: null, railStyle: 'square', open: null, nosing: null, boxed: false, flare: 0, gallery: true });
// A saved stair as a full record. Old records { id, i, j, dir } (one cell wide, a storey high, straight up from cell i, j)
// become a straight stair to the storey above, 0.92 m wide, laid out by the rules. env: { rise } or { hs } (storey scale).
export function fromRecord(rec, env = {}) {
  if (!rec) return null;
  const look = {};
  for (const k in LOOK_DEFAULTS) look[k] = rec[k] ?? LOOK_DEFAULTS[k];
  if (rec.type && TYPE_BY_ID[rec.type]) {
    return { id: rec.id, type: rec.type, x: +rec.x || 0, z: +rec.z || 0, dir: +rec.dir || 0, rise: rec.rise ?? env.rise ?? null, run: rec.run ?? null,
      width: rec.width ?? (isGrand(rec.type) ? null : RULES.width.def), n: rec.n ?? null, turn: rec.turn ?? null, at: rec.at ?? null,
      sweep: rec.sweep ?? null, radius: rec.radius ?? null, ...look };
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
  return solve({ ...env, type: r.type, x: r.x, z: r.z, dir: r.dir, rise: r.rise ?? env.rise, run: r.run ?? env.run, width: r.width, n: r.n, turn: r.turn, at: r.at,
    sweep: r.sweep, radius: r.radius, flare: r.flare, flareSide: flareSideOf({ rail: r.rail, wall: rec && rec.wall }) });
}
// the flared foot goes on the sides with a balustrade
function flareSideOf(r) {
  if (r.rail === 'left' || r.rail === 'right') return r.rail;
  if (r.rail === 'wall') return r.wall === 'left' ? 'right' : r.wall === 'right' ? 'left' : 'both';
  return 'both';
}
// The look with its defaults filled in: rails off under 0.6 m, open risers on deck steps and ladders, no nosing on a ladder.
export function lookOf(rec = {}, Ly = {}) {
  const open = Ly.type === 'deck' || Ly.type === 'ladder';
  return {
    mat: rec.mat || 'pine', rail: rec.rail || Ly.railDefault || 'both', railStyle: rec.railStyle || 'square',
    open: rec.open ?? open, nosing: rec.nosing ?? Ly.type !== 'ladder', boxed: !!rec.boxed,
    flare: FLARE_TYPES.includes(Ly.type) ? clamp(Math.round(+rec.flare || 0), 0, RULES.flare.n) : 0, gallery: rec.gallery ?? true,
  };
}
