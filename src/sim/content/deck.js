// Decks (slice B-2, DECK1): the store items, the span tables and the arithmetic that turns a drawn deck into the
// members a builder puts in. Pure data and arithmetic: no DOM, no three.js. The page's deck tool (src/game/deck.js,
// bundled with this file) registers the member maker with window.__framing; headless tests import it straight.
//
// A deck is { id, poly: [[x, z] x 4] (a rectangle in its building's own metres), dir (the poly edge k -> k+1 that is the
// house side: the ledger when attached, else the inner beam), height (the top of the boards, in the building's own y),
// attach: wall piece id | null, joist: 'auto' | '2x6' | '2x8' | '2x10' | '2x12', board: 'pt' | 'cedar' }.
//
// How it is built, in order (stages in src/sim/content/construction.js):
//   foundation  footing, poured pier (10 in tube) and 6x6 post at each post line, a doubled beam on the posts. These are
//               ordinary foundation members with their shape, so the foundation system makes the pier job itself.
//   deck-frame  the ledger (bolted through the sheathing into the house rim, with Z-flashing over it), joists every
//               400 mm (16 in) in hangers on the ledger, end joists, the rim (band) joist over the outer ends.
//   decking     5/4 x 6 boards across the joists, 5 mm gaps, screwed twice at every joist: laid row by row from the
//               house out, like siding courses (each board is a course: `course`, `row`).
//
// Span limits are the IRC's prescriptive deck tables (2015 IRC Table R507.5 / AWC DCA 6 Table 2: 40 psf live + 10 psf
// dead, L/360, No. 2 grade, no cantilever), in feet-inches. Ledger fastener spacing is 2015 IRC Table R507.9.1.3(1)
// (1/2 in lag screws through 15/32 in sheathing into a 2x band joist). Guards are required where the walking surface is
// more than 30 in above grade (IRC R312.1.1).
//
// Slice B-3 adds three things to a deck, all optional data on it (see the bottom of this file):
//   rails   d.rails 'auto' | 'on' | 'off', d.post '4x4' | '6x6': a guard round the open edges, 36 in high, balusters spaced so a
//           4 in sphere cannot pass (IRC R312.1.2, R312.1.3); required (and 'off' refused) when the boards are over 30 in up.
//   stair   d.stair { edge: 'out' | 'left' | 'right' | 'house', w }: a stair from that edge down to a landing pad at grade, its
//           risers at most 7-3/4 in and treads at least 10 in (IRC R311.7.5), handrails once it has four risers (R311.7.8).
//   porch   d.porch { pitch (rise in 12) }: 6x6 posts on the beam line, a header, and one shed roof plane from a ledger on the
//           house wall down to the header (the roof comes from framing.js's roofMembers through desc.roofs).
// Stages: 'porch-frame' (posts, header, wall ledger, rafters), then the house's roof-deck / dry-in / roofing take the porch
// roof's sheets, flashing and shingles; 'rails' (Rails and stairs) after the decking.

export const IN = 0.0254;
const ftin = (ft, inch) => (ft * 12 + inch) * IN;

// joist spans by species group and on-centre spacing (inches), metres
export const JOIST_SPANS = Object.freeze({
  syp: Object.freeze({ name: 'Southern yellow pine', 12: { '2x6': ftin(9, 11), '2x8': ftin(13, 1), '2x10': ftin(16, 2), '2x12': ftin(18, 0) }, 16: { '2x6': ftin(9, 0), '2x8': ftin(11, 10), '2x10': ftin(14, 0), '2x12': ftin(16, 6) }, 24: { '2x6': ftin(7, 7), '2x8': ftin(9, 8), '2x10': ftin(11, 5), '2x12': ftin(13, 6) } }),
  df: Object.freeze({ name: 'Douglas fir-larch, hem-fir, SPF', 12: { '2x6': ftin(9, 6), '2x8': ftin(12, 6), '2x10': ftin(15, 8), '2x12': ftin(18, 0) }, 16: { '2x6': ftin(8, 8), '2x8': ftin(11, 1), '2x10': ftin(13, 7), '2x12': ftin(15, 9) }, 24: { '2x6': ftin(7, 2), '2x8': ftin(9, 1), '2x10': ftin(11, 1), '2x12': ftin(12, 10) } }),
});
export const JOIST_SIZES = Object.freeze(['2x6', '2x8', '2x10', '2x12']);
export const maxJoistSpan = (size, species = 'syp', oc = 16) => ((JOIST_SPANS[species] || JOIST_SPANS.syp)[oc] || {})[size] || 0;
// 1/2 in lag screws into the band joist, inches on centre (staggered), by joist span (feet, up to)
export const LEDGER_LAG_OC = Object.freeze([[6, 30], [8, 23], [10, 18], [12, 15], [14, 13], [16, 11], [18, 10]]);

const ACTUAL = { '2x6': [0.038, 0.14], '2x8': [0.038, 0.184], '2x10': [0.038, 0.235], '2x12': [0.038, 0.286], '6x6': [0.14, 0.14] };
export const DECK = Object.freeze({
  oc: 16, ocM: 0.4,                 // joists every 400 mm (16 in)
  board: Object.freeze({ w: 0.14, t: 0.025, gap: 0.005 }),   // 5/4 x 6 deck boards (1 x 5-1/2 in actual), 5 mm (3/16 in) gaps
  boardMaxOcIn: 16,                 // 5/4 boards across joists at most 16 in apart (IRC Table R507.7)
  sheathFace: 0.0555,               // the outer face of the wall sheathing from the wall line (src/framing.js: half a 2x4 + 11 mm OSB)
  dropInset: 0.15,                  // a beam under the joists sits this far in from the deck's edge (a short cantilever)
  postMaxM: 1.8,                    // posts at most 6 ft apart along a beam
  postEndM: 0.15,                   // the end posts this far in from the corners
  pier: Object.freeze({ d: 0.25, aboveM: 0.05, footW: 0.5, footT: 0.2, footBelowM: 0.55 }),   // 10 in tube, its top 2 in proud of the ground (a bracket on it)
  guardM: 30 * IN,                  // a walking surface over 30 in above grade needs a guard (IRC R312.1.1)
  minM: 1.2, maxM: 12,              // sides, metres
  screwKg: 0.0045,                  // one #8 x 2-1/2 in deck screw
  framed: Object.freeze(['pier-blocks', 'skids', 'piers', 'stemwall']),   // foundations with a rim joist to bolt a ledger to
});
// a doubled beam on posts at most 6 ft apart, by the joist span it carries (on the safe side of IRC Table R507.5)
export const BEAM_SIZE = (span) => (span <= 2.4 ? '2x8' : span <= 3.0 ? '2x10' : '2x12');

// ---- the store
export const ITEMS_DECK = Object.freeze([
  ...['2x6', '2x8', '2x10', '2x12'].map((s, k) => ({ id: 'lumber_pt_' + s, name: s.replace('x', ' x ') + ' pressure-treated lumber', category: 'lumber', unit: 'm', material: 'pine_seasoned', dims: { widthM: ACTUAL[s][0], depthM: ACTUAL[s][1] }, priceUsd: [4.2, 5.8, 8.2, 11][k], blurb: 'Southern pine treated for ground contact: deck framing that stays outdoors' })),
  { id: 'lumber_pt_6x6', name: '6 x 6 pressure-treated post', category: 'lumber', unit: 'm', material: 'pine_seasoned', dims: { widthM: 0.14, depthM: 0.14 }, priceUsd: 18, blurb: 'Treated for ground contact: deck posts, bolted into a bracket on the pier' },
  { id: 'board_deck_pt', name: 'Deck board 5/4 x 6, treated', category: 'logs', unit: 'm', material: 'pine_seasoned', dims: { widthM: 0.14, depthM: 0.025 }, priceUsd: 4.2, blurb: 'Radius-edged treated pine decking, 1 x 5-1/2 in actual' },
  { id: 'board_deck_cedar', name: 'Deck board 5/4 x 6, cedar', category: 'logs', unit: 'm', material: 'western_redcedar', dims: { widthM: 0.14, depthM: 0.025 }, priceUsd: 10.5, blurb: 'Western red cedar decking: light, stable, weathers silver' },
  ...['2x6', '2x8', '2x10', '2x12'].map((s, k) => ({ id: 'joist_hanger_' + s, name: 'Joist hanger, ' + s.replace('x', ' x '), category: 'fasteners', unit: 'each', massKg: [0.18, 0.22, 0.28, 0.34][k], priceUsd: [1.6, 2.1, 2.8, 3.6][k], blurb: 'A galvanized steel stirrup nailed to the ledger: the joist end drops into it' })),
  { id: 'ledger_lag', name: 'Ledger lag screw 1/2 x 4 in, with washer', category: 'fasteners', unit: 'each', material: 'steel', dims: { lengthM: 0.1, widthM: 0.0127, thicknessM: 0.0127 }, priceUsd: 1.1, blurb: 'Hot-dipped galvanized: bolts the ledger through the sheathing into the house rim, staggered' },
  { id: 'screws_deck', name: 'Deck screws #8 x 2-1/2 in', category: 'fasteners', unit: 'kg', material: 'steel', priceUsd: 14, blurb: 'Coated for treated lumber: two into every joist a board crosses' },
  { id: 'lumber_pt_4x4', name: '4 x 4 pressure-treated post', category: 'lumber', unit: 'm', material: 'pine_seasoned', dims: { widthM: 0.089, depthM: 0.089 }, priceUsd: 7.5, blurb: 'Treated for ground contact: guard posts, notched and bolted to the rim joist' },
  { id: 'lumber_pt_2x4', name: '2 x 4 pressure-treated lumber', category: 'lumber', unit: 'm', material: 'pine_seasoned', dims: { widthM: 0.038, depthM: 0.089 }, priceUsd: 2.9, blurb: 'Treated rails for guards' },
  { id: 'baluster_pt', name: 'Baluster 2 x 2 x 36 in, treated', category: 'lumber', unit: 'each', material: 'pine_seasoned', dims: { widthM: 0.038, depthM: 0.038, lengthM: 0.9 }, priceUsd: 1.6, blurb: 'Square balusters: set closer than 4 in so a child cannot slip through' },
  { id: 'handrail_pt', name: 'Handrail, treated, graspable profile', category: 'lumber', unit: 'm', material: 'pine_seasoned', dims: { widthM: 0.05, depthM: 0.05 }, priceUsd: 9, blurb: 'A profile you can close your hand round (1-1/4 to 2 in across)' },
  { id: 'stair_pad', name: 'Precast landing pad 36 x 36 in', category: 'stone', unit: 'each', material: 'concrete', dims: { lengthM: 0.914, widthM: 0.914, thicknessM: 0.05 }, priceUsd: 38, blurb: 'A firm landing at the foot of the stair, set into the ground on gravel' },
  { id: 'carriage_bolt', name: 'Carriage bolt 1/2 x 4-1/2 in, nut and washer', category: 'fasteners', unit: 'each', massKg: 0.12, priceUsd: 1.4, blurb: 'Hot-dipped galvanized: bolts a guard post to the rim joist' },
  { id: 'stair_bracket', name: 'Stair stringer connector', category: 'fasteners', unit: 'each', massKg: 0.25, priceUsd: 3.4, blurb: 'A galvanized angle that holds the top of a stringer to the rim joist' },
  { id: 'ledger_flashing', name: 'Ledger Z-flashing', category: 'fasteners', unit: 'm', massKg: 0.25, priceUsd: 3.2, blurb: 'Bent metal over the top of the ledger and up under the wrap: rain runs out over it, not behind it' },
]);
// the small things used up as the deck goes on (like nails): they sit by the stacks
export const DECK_SUPPLY = Object.freeze(['joist_hanger_2x6', 'joist_hanger_2x8', 'joist_hanger_2x10', 'joist_hanger_2x12', 'ledger_lag', 'screws_deck', 'ledger_flashing', 'carriage_bolt', 'stair_bracket']);
export const BOARD_ITEM = Object.freeze({ pt: 'board_deck_pt', cedar: 'board_deck_cedar' });
export const BOARD_NAME = Object.freeze({ pt: 'Treated pine', cedar: 'Cedar' });

// ---- the frame of a deck: u along its house side, v out from it
export function frameOf(d) {
  const P = d.poly, k = ((d.dir | 0) % P.length + P.length) % P.length, A = P[k], B = P[(k + 1) % P.length];
  const W = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, u = [(B[0] - A[0]) / W, (B[1] - A[1]) / W];
  let v = [-u[1], u[0]], cx = 0, cz = 0;
  for (const p of P) ((cx += p[0] / P.length), (cz += p[1] / P.length));
  if ((cx - A[0]) * v[0] + (cz - A[1]) * v[1] < 0) v = [-v[0], -v[1]];
  let D = 0;
  for (const p of P) D = Math.max(D, (p[0] - A[0]) * v[0] + (p[1] - A[1]) * v[1]);
  // (s, t) -> local [x, z]
  const at = (s, t) => [A[0] + u[0] * s + v[0] * t, A[1] + u[1] * s + v[1] * t];
  return { A, u, v, W, D, at };
}
export const isRect = (P) => Array.isArray(P) && P.length === 4 && P.every((p, k) => { const a = P[(k + 3) % 4], b = P[(k + 1) % 4]; return Math.abs((a[0] - p[0]) * (b[0] - p[0]) + (a[1] - p[1]) * (b[1] - p[1])) < 1e-3; });
// the lag screws a ledger of this length takes for a joist span (m): staggered at the table's spacing, two at each end
export function ledgerLags(lenM, spanM) {
  const ft = spanM / 0.3048, row = LEDGER_LAG_OC.find((q) => ft <= q[0] + 1e-9) || LEDGER_LAG_OC[LEDGER_LAG_OC.length - 1];
  return { oc: row[1], n: Math.max(4, Math.ceil(lenM / (row[1] * IN)) + 1 + 2) };
}

// Everything the structure check needs, and the plan the members follow. ctx: { attached: true when a wall is found
// for d.attach, found: the building's foundation, groundY(x, z) local ground y }. Never throws.
export function planDeck(d, ctx = {}) {
  const errors = [], warns = [];
  const out = { ok: false, errors, warns };
  if (!d || !isRect(d.poly)) { errors.push('A deck is drawn as a rectangle.'); return out; }
  const f = frameOf(d), attached = !!(d.attach && ctx.attached), species = d.species === 'df' ? 'df' : 'syp';
  Object.assign(out, { frame: f, attached, species, W: f.W, D: f.D });
  if (f.W < DECK.minM - 1e-6 || f.D < DECK.minM - 1e-6) errors.push('Too small: a deck is at least ' + DECK.minM + ' m each way.');
  if (f.W > DECK.maxM + 1e-6 || f.D > DECK.maxM + 1e-6) errors.push('Too big: at most ' + DECK.maxM + ' m each way.');
  if (d.attach && !ctx.attached) errors.push('That wall is gone: draw the deck against an outside wall again, or away from it.');
  if (attached && ctx.found && !DECK.framed.includes(ctx.found)) errors.push('No rim joist to bolt a ledger to on a ' + ctx.found + ' foundation: draw the deck away from the wall (free-standing).');
  const bt = DECK.board.t, top = +d.height, jt = top - bt;
  const tL = attached ? DECK.sheathFace : 0;
  // which joist: the one asked for, or the smallest that spans it
  const bdGuess = '2x10';
  const spanFor = (flush, bd) => {
    const bw = 2 * ACTUAL[bd][0];
    const tOut = flush ? f.D - bw / 2 : f.D - DECK.dropInset, tIn = attached ? tL + 0.038 : flush ? bw / 2 : DECK.dropInset;
    return { tOut, tIn, span: tOut - tIn };
  };
  // a beam under the joists if there is room for it over the pier, else flush with them (joists hung on it)
  const gys = [[0, 0], [f.W, 0], [0, f.D], [f.W, f.D], [f.W / 2, f.D / 2]].map(([s, t]) => { const p = f.at(s, t); return ctx.groundY ? ctx.groundY(p[0], p[1]) : 0; });
  const gMax = Math.max(...gys), gMin = Math.min(...gys);
  let size = d.joist && d.joist !== 'auto' ? d.joist : null;
  const tryPlan = (sz) => {
    const jd = ACTUAL[sz][1], sp0 = spanFor(false, bdGuess).span, b0 = BEAM_SIZE(sp0), bd = ACTUAL[sz][1] > ACTUAL[b0][1] ? sz : b0, bdd = ACTUAL[bd][1];
    const flush = jt - jd - bdd < gMax + DECK.pier.aboveM + 0.05;
    const s = spanFor(flush, bd);
    return { sz, jd, bd, bdd, flush, ...s, max: maxJoistSpan(sz, species, DECK.oc) };
  };
  let p = null;
  if (size && ACTUAL[size]) p = tryPlan(size);
  else {
    // the smallest that spans it with some to spare, else the smallest that spans it at all
    const all = JOIST_SIZES.map(tryPlan);
    p = all.find((q) => q.span <= 0.9 * q.max) || all.find((q) => q.span <= q.max + 1e-9) || all[all.length - 1];
    size = p.sz;
  }
  Object.assign(out, { joist: size, span: p.span, maxSpan: p.max, beam: p.bd, flush: p.flush, tIn: p.tIn, tOut: p.tOut, tL, top, jt, jd: p.jd, bdd: p.bdd });
  const fmt = (m) => m.toFixed(2) + ' m (' + Math.floor(m / 0.3048) + ' ft ' + Math.round((m / IN) % 12) + ' in)';
  if (p.span > p.max + 1e-9) errors.push(size + ' joists at 16 in span ' + fmt(p.max) + ' at most (IRC R507.6, ' + JOIST_SPANS[species].name + '); this deck needs ' + fmt(p.span) + '.' + (size !== '2x12' ? ' Use deeper joists or a shallower deck.' : ' Make it shallower.'));
  else if (p.span > 0.9 * p.max) warns.push('Joists near their limit (' + Math.round((p.span / p.max) * 100) + '% of the table span): it will feel springy.');
  // room under it: the beam bottom over the pier tops
  const beamBot = p.flush ? jt - p.bdd : jt - p.jd - p.bdd;
  out.minAbove = top - beamBot + DECK.pier.aboveM;     // the lowest the boards can be over the highest ground under the deck
  if (beamBot < gMax + DECK.pier.aboveM - 1e-6) errors.push('Too low for a beam over the piers: the boards need to be at least ' + out.minAbove.toFixed(2) + ' m above the ground.');
  const above = top - gMin;
  out.above = above;
  // guards (slice B-3): required where the boards are more than 30 in above the ground (IRC R312.1.1), optional below that
  const railsOpt = d.rails === 'on' || d.rails === 'off' ? d.rails : 'auto';
  out.guardRequired = above > DECK.guardM;
  out.guard = railsOpt === 'on' || (railsOpt === 'auto' && out.guardRequired);
  out.postSize = d.post === '6x6' ? '6x6' : '4x4';
  if (railsOpt === 'off' && out.guardRequired) errors.push('A guard is required: the boards are ' + (above / IN).toFixed(0) + ' in above the ground and the rule is 30 in (IRC R312.1.1). Put the rails on, or build the deck lower.');
  // a stair, a porch
  out.stair = null; out.porch = null;
  if (d.stair) {
    out.stair = planStair(d, f, top, ctx.groundY || (() => 0), attached, out.postSize);
    errors.push(...out.stair.errors); warns.push(...out.stair.warns);
  }
  if (d.porch) {
    out.porch = planPorch(d, out, ctx);
    errors.push(...out.porch.errors); warns.push(...out.porch.warns);
  }
  out.ok = !errors.length;
  return out;
}

// ======================================================================== guards, stairs, porch (slice B-3)
export const GUARD = Object.freeze({
  heightM: 36 * IN,                 // at least 36 in from the boards to the top of the guard (IRC R312.1.2)
  sphereM: 4 * IN,                  // no opening a 4 in sphere passes through (IRC R312.1.3)
  aimGapM: 3.75 * IN,               // the gap the balusters are spaced for, a little under the limit
  postMaxM: 6 * 0.3048,             // posts at most 6 ft apart (AWC DCA 6)
  baluster: 0.038,                  // 2 x 2
  bottomLiftM: 0.05,                // the bottom rail's underside sits 2 in over the boards (the gap under it is under 4 in)
  postOff: Object.freeze({ '4x4': 0.02, '6x6': 0.07 }),   // post centre outside the deck's edge: a 4 x 4 notched into the rim, a 6 x 6 bolted to its face
  postSize: Object.freeze({ '4x4': 0.089, '6x6': 0.14 }),
});
export const STAIR = Object.freeze({
  maxRiseM: 7.75 * IN,              // IRC R311.7.5.1
  minTreadM: 10 * IN,               // IRC R311.7.5.2
  treadM: 2 * 0.14 + 0.005,         // two 5/4 x 6 boards with a gap: 11-3/16 in
  treadT: 0.025,
  minWidthM: 36 * IN,               // IRC R311.7.1
  maxFlightM: 12 * 0.3048,          // IRC R311.7.3: 12 ft between landings
  handrailRisers: 4,                // IRC R311.7.8: handrails on stairs of four or more risers
  handrailM: 36 * IN,               // 34 to 38 in above the nosings (R311.7.8.1)
  stringerOcM: 18 * IN,             // 2 x 12 stringers at most 18 in apart under 5/4 treads (AWC DCA 6)
  stringerSpanM: 6 * 0.3048,        // and no more than 6 ft of horizontal run without a support
  throatMinM: 3.5 * IN,             // what must be left of the stringer's depth under the notches
  padM: 36 * IN, padT: 0.05,          // a 36 in precast landing pad (R311.7.6), set 2 in proud of the ground
  stringer: '2x12',
});
export const PORCH = Object.freeze({
  pitches: Object.freeze([2, 3, 4]),   // rise in 12
  clearMinM: 1.8, clearWarnM: 80 * IN, // headroom under the header: refuse under 1.8 m, warn under 6 ft 8 in
  eaveOverM: 0.3, rakeM: 0.15,         // the roof reaches this far past the header and past the ends
  ledgerBelowTopM: 0.1,                // the roof's top edge meets the wall this far under the top plate
  postMaxM: 2.4,
  postEndM: 0.15,
});
export const HEADER_SIZE = (spacing) => (spacing <= 1.8 ? '2x8' : spacing <= 2.4 ? '2x10' : '2x12');
const rafterFor = (run) => (run <= 3.2 ? '2x6' : run <= 4.2 ? '2x8' : '2x10');   // framing.js's rule
const OSB_T = 0.011;

export const OPEN_EDGES = (attached) => (attached ? ['out', 'left', 'right'] : ['house', 'out', 'left', 'right']);
const EDGE_N = { out: [0, 1], house: [0, -1], left: [-1, 0], right: [1, 0] };
export const edgeLen = (f, e) => (e === 'out' || e === 'house' ? f.W : f.D);
// the point [s, t] of an edge at distance p along it
export const edgeAt = (f, e, p) => (e === 'out' ? [p, f.D] : e === 'house' ? [p, 0] : e === 'left' ? [0, p] : [f.W, p]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// The stair from one edge down to grade: how many risers the drop needs at most 7-3/4 in each, the stringers cut to that
// rise and run, treads, the landing pad, handrails from four risers. Returns { errors, warns, none?, ... }.
export function planStair(d, f, top, gy, attached, postSize = '4x4') {
  const st = d.stair, errors = [], warns = [], out = { ok: false, errors, warns };
  if (!st || !st.edge) return out;
  const e = st.edge;
  if (!OPEN_EDGES(attached).includes(e)) { errors.push('A stair goes down from an open edge: the house side of a deck bolted to the house is the door.'); return out; }
  const w = Math.max(STAIR.minWidthM, +st.w || STAIR.minWidthM), ps = GUARD.postSize[postSize] || 0.089, gap = w + ps, L = edgeLen(f, e);
  if (L < gap + 0.5) { errors.push('That edge is too short for a ' + (w / IN).toFixed(0) + ' in stair.'); return out; }
  const pc = clamp(Number.isFinite(+st.s) ? +st.s : L / 2, gap / 2 + 0.25, L - gap / 2 - 0.25), nrm = EDGE_N[e];
  const o = [nrm[0] * f.u[0] + nrm[1] * f.v[0], nrm[0] * f.u[1] + nrm[1] * f.v[1]];   // outward, in the building's metres
  const E = f.at(...edgeAt(f, e, pc)), T = STAIR.treadM;
  // the ground at the foot depends on how far out the foot is, which depends on the drop: settle it
  let N = 1, g = 0, drop = 0;
  for (let k = 0; k < 8; k++) {
    const run = (N - 1) * T, c = [E[0] + o[0] * (run + STAIR.padM / 2), E[1] + o[1] * (run + STAIR.padM / 2)];
    g = gy(c[0], c[1]); drop = top - g - STAIR.padT;
    const n2 = Math.max(1, Math.ceil(drop / STAIR.maxRiseM - 1e-9));
    if (n2 === N) break;
    N = n2;
  }
  Object.assign(out, { edge: e, w, gap, pc, o, nrm, E, ps, g, drop, N, T });
  if (drop < 0.02) { out.none = true; out.N = 0; out.ok = true; warns.push('The deck is at the ground: no steps are needed.'); return out; }
  if (drop > STAIR.maxFlightM) { errors.push('A flight can rise 12 ft at most (IRC R311.7.3); this drop is ' + (drop / 0.3048).toFixed(1) + ' ft. It needs a landing partway down.'); return out; }
  const rise = drop / N, run = (N - 1) * T, D = ACTUAL[STAIR.stringer][1], throat = D - (rise * T) / Math.hypot(rise, T);
  Object.assign(out, { rise, run, throat, pitchLen: Math.hypot(run, drop - rise), theta: Math.atan2(rise, T), stringers: N > 1 ? Math.max(2, Math.ceil(w / STAIR.stringerOcM - 1e-6) + 1) : 0, treads: N - 1,
    pads: Math.max(1, Math.ceil(w / STAIR.padM - 1e-6)), handrails: N >= STAIR.handrailRisers ? (drop > DECK.guardM ? 2 : 1) : 0, treadTop0: top });
  if (rise > STAIR.maxRiseM + 1e-9) errors.push('Risers over 7-3/4 in (IRC R311.7.5.1).');
  if (T < STAIR.minTreadM - 1e-9) errors.push('Treads under 10 in (IRC R311.7.5.2).');
  if (throat < STAIR.throatMinM) errors.push('The stringers would be cut too thin: 3-1/2 in must be left under the notches.');
  if (run > STAIR.stringerSpanM + 1e-9) warns.push('A stringer runs ' + (run / 0.3048).toFixed(1) + ' ft: over 6 ft it wants a post under it.');
  out.ok = !errors.length;
  return out;
}

// The porch roof: one shed plane from a ledger on the house wall (its top edge) down to a header on posts on the deck's
// beam line. The geometry framing.js's roofMembers takes in desc.roofs, and what the header must clear.
export function planPorch(d, pl, ctx = {}) {
  const errors = [], warns = [], out = { ok: false, errors, warns };
  const pitch = PORCH.pitches.includes(+d.porch.pitch) ? +d.porch.pitch : 2;
  if (!pl.attached) { errors.push('A porch roof ties to the house: draw the deck against an outside wall.'); return out; }
  if (!Number.isFinite(ctx.wallTop)) { errors.push('The porch roof needs the wall it ties to.'); return out; }
  const f = pl.frame, k = pitch / 12, cs = 1 / Math.sqrt(1 + k * k), tL = pl.tL, tHdr = pl.tOut, tE = tHdr + PORCH.eaveOverM, run = tE - tL;
  const ridgeY = ctx.wallTop - PORCH.ledgerBelowTopM, eaveY = ridgeY - k * run, rafter = rafterFor(run), RD = ACTUAL[rafter][1];
  const ySurfHdr = eaveY + k * PORCH.eaveOverM, hdrTop = ySurfHdr - (RD + OSB_T) / cs;
  const spacing = PORCH.postMaxM, hSize = HEADER_SIZE(spacing), hdd = ACTUAL[hSize][1], hdrBot = hdrTop - hdd, clear = hdrBot - pl.top;
  Object.assign(out, { pitch, k, cs, run, tE, tL, tHdr, ridgeY, eaveY, rafter, rafterD: RD, hdrTop, hdrBot, hSize, hdd, clear, ledgerY: ridgeY - (RD / 2 + OSB_T) / cs });
  if (clear < PORCH.clearMinM) errors.push('Not enough headroom under the porch: ' + clear.toFixed(2) + ' m under the header, at least ' + PORCH.clearMinM + ' m. Make it shallower, a flatter pitch, or set the deck lower.');
  else if (clear < PORCH.clearWarnM) warns.push('Headroom under the porch header is ' + clear.toFixed(2) + ' m, under a door\'s 2.03 m (6 ft 8 in): mind your head.');
  out.ok = !errors.length;
  return out;
}
// the roof desc framing.js's roofMembers takes (src/framing.js, "r:"), for a planned porch
export function porchRoofDesc(pl, pid, groundY) {
  const f = pl.frame, P = pl.porch, s0 = -PORCH.rakeM, s1 = f.W + PORCH.rakeM, id = pid + '.pr';
  return { id, mat: 'asphalt', porch: true, groundY, ridges: [], infills: [], ties: [], gutters: [],
    planes: [{ id: id + '.0', pts: [f.at(s0, P.tE), f.at(s1, P.tE), f.at(s1, P.tL), f.at(s0, P.tL)], eaveY: P.eaveY, ridgeY: P.ridgeY, run: P.run, facing: [f.v[0], f.v[1]], overhang: PORCH.rakeM, lean: true, drip: true }] };
}

// The members of one deck. el = { id, poly, dir, height, attach, joist, board, attached, found, groundY }; h = the
// framing helpers { M, splice } (src/framing.js). Coordinates in the building's own metres.
export function deckMembers(out, el, h) {
  const pl = planDeck(el, { attached: el.attached, found: el.found, groundY: el.groundY, wallTop: el.wallTop });
  if (!pl.frame || pl.errors.some((e) => /rectangle|Too small|Too big/.test(e))) return pl;
  const { M, splice } = h, f = pl.frame, id = el.id, UPV = [0, 1, 0], uN = [f.u[0], 0, f.u[1]], vN = [f.v[0], 0, f.v[1]];
  const P = (s, y, t) => { const q = f.at(s, t); return [q[0], y, q[1]]; };
  const gy = (s, t) => { const q = f.at(s, t); return el.groundY ? el.groundY(q[0], q[1]) : 0; };
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const sz = pl.joist, [jb, jd] = ACTUAL[sz], bd = pl.beam, [, bdd] = ACTUAL[bd], jt = pl.jt, jy = jt - jd / 2;
  const PT = 'pt', why = {
    joist: 'Treated joists every 40 cm (16 in) carry the boards. The span tables say how far each size may reach.',
    ledger: 'A treated board as deep as the joists, bolted through the sheathing into the house rim: the house carries this side of the deck.',
    rim: 'The band joist across the outer ends of the joists: holds them upright and takes the face boards.',
    beam: 'Two treated boards nailed together on the posts: they carry the outer ends of the joists.',
    post: 'Treated 6 x 6 posts from the pier brackets up to the beam.',
    board: 'The deck you walk on: boards across the joists with a 5 mm gap for the rain, two screws at every joist.',
  };
  const buy = (key, item, len, label, w, plies = 1) => [key, item, 'm', len * plies, label, w];
  let n = 0;
  const nid = (c) => id + '.' + c + n++;
  // joist places along the house side: an end joist at each end, then every 400 mm from the start
  const js = [0.019];
  for (let s = DECK.ocM; s < f.W - 0.06; s += DECK.ocM) js.push(s);
  js.push(f.W - 0.019);
  // ---- foundation: beams on posts on piers (the inner beam too, when nothing holds that side up)
  const beams = [pl.tOut];
  if (!pl.attached) beams.unshift(pl.tIn);
  const np = Math.max(2, Math.ceil((f.W - 2 * DECK.postEndM) / DECK.postMaxM) + 1);
  const bTop = pl.flush ? jt : jt - jd, bc = bTop - bdd / 2;
  for (const tb of beams) {
    const ps = Array.from({ length: np }, (_, k) => DECK.postEndM + ((f.W - 2 * DECK.postEndM) * k) / (np - 1));
    for (const s of ps) {
      const g = gy(s, tb), top = g + DECK.pier.aboveM, bot = bTop - bdd;
      M(out, nid('ft'), 'footing', 'pad', 'foundation', id, 'concrete', DECK.pier.footW, DECK.pier.footW, P(s, g - DECK.pier.footBelowM - DECK.pier.footT, tb), P(s, g - DECK.pier.footBelowM, tb), uN, { volume: r3(DECK.pier.footW ** 2 * DECK.pier.footT), col: 'concrete' });
      M(out, nid('pr'), 'pier', 'poured', 'foundation', id, 'concrete', DECK.pier.d, DECK.pier.d, P(s, g - DECK.pier.footBelowM, tb), P(s, top, tb), uN, { volume: r3(Math.PI * (DECK.pier.d / 2) ** 2 * (top - g + DECK.pier.footBelowM)), draw: 2, col: 'concrete' });
      if (bot - top > 0.05) M(out, nid('po'), 'post', 'deck-post', 'foundation', id, 'timber', 0.14, 0.14, P(s, top, tb), P(s, bot, tb), uN, { col: PT, buy: buy('ptpost', 'lumber_pt_6x6', bot - top, 'Deck posts (6 x 6 treated)', why.post) });
    }
    for (const [a, b] of splice(0, f.W, DECK.postEndM, (f.W - 2 * DECK.postEndM) / (np - 1)))
      M(out, nid('bm'), 'beam', 'deck-beam', 'foundation', id, 'timber', 2 * 0.038, bdd, P(a, bc, tb), P(b, bc, tb), UPV, { plies: 2, size: bd, col: PT, buy: buy('ptbeam' + bd, 'lumber_pt_' + bd, b - a, 'Deck beam (2 x ' + bd.split('x')[1] + ' treated)', why.beam, 2) });
  }
  // ---- the frame: ledger, joists in hangers, rim
  const span = pl.span, lag = ledgerLags(f.W, span), hang = 'joist_hanger_' + sz;
  const tJ0 = pl.attached ? pl.tL + 0.038 : pl.flush ? 2 * 0.038 : 0.038, tJ1 = pl.flush ? f.D - 2 * 0.038 : f.D - 0.038;
  if (pl.attached) {
    splice(0, f.W, 0, DECK.ocM).forEach(([a, b], k) => M(out, nid('lg'), 'ledger', 'ledger', 'deck-frame', id, 'timber', jb, jd, P(a, jy, pl.tL + jb / 2), P(b, jy, pl.tL + jb / 2), UPV, { col: PT, buy: buy('ledger' + sz, 'lumber_pt_' + sz, b - a, 'Ledger (' + sz.replace('x', ' x ') + ' treated)', why.ledger),
      hw: k ? [] : [['ledger_lag', lag.n, 'each', 'Ledger lag screws', 'Half-inch lags with washers, staggered every ' + lag.oc + ' in through the sheathing into the house rim (IRC R507.9).'], ['ledger_flashing', f.W, 'm', 'Ledger flashing', 'Z-flashing over the ledger, tucked up under the housewrap: water runs out over the ledger, not into the wall.']] }));
  } else if (!pl.flush) M(out, nid('rj'), 'joist', 'rim', 'deck-frame', id, 'timber', jb, jd, P(0, jy, 0.019), P(f.W, jy, 0.019), UPV, { col: PT, buy: buy('ptrim' + sz, 'lumber_pt_' + sz, f.W, 'Rim joists (' + sz.replace('x', ' x ') + ' treated)', why.rim) });
  const hangers = (pl.attached ? 1 : 0) + (pl.flush ? (pl.attached ? 1 : 2) : 0);
  js.forEach((s, k) => M(out, nid('j'), 'joist', k === 0 || k === js.length - 1 ? 'end' : 'joist', 'deck-frame', id, 'timber', jb, jd, P(s, jy, tJ0), P(s, jy, tJ1), UPV, { col: PT, buy: buy('ptjoist' + sz, 'lumber_pt_' + sz, tJ1 - tJ0, 'Deck joists (' + sz.replace('x', ' x ') + ' treated)', why.joist),
    hw: hangers ? [[hang, hangers, 'each', 'Joist hangers (' + sz.replace('x', ' x ') + ')', 'Galvanized stirrups the joist ends drop into, nailed to the ledger' + (pl.flush ? ' and the beam' : '') + ' with hanger nails.']] : [] }));
  if (!pl.flush) M(out, nid('rj'), 'joist', 'rim', 'deck-frame', id, 'timber', jb, jd, P(0, jy, f.D - 0.019), P(f.W, jy, f.D - 0.019), UPV, { col: PT, buy: buy('ptrim' + sz, 'lumber_pt_' + sz, f.W, 'Rim joists (' + sz.replace('x', ' x ') + ' treated)', why.rim) });
  // ---- the boards: rows across the joists from the house out; a long row breaks over a joist, staggered row to row
  const bw = DECK.board.w, gap = DECK.board.gap, item = BOARD_ITEM[el.board] || BOARD_ITEM.pt, by = pl.top - DECK.board.t / 2;
  const t0 = pl.tL + gap;
  for (let row = 0, t = t0; t < f.D - 0.02; row++, t += bw + gap) {
    const w = Math.min(bw, f.D - t);
    if (w < 0.03) break;
    for (const [a, b] of splice(0, f.W, 0, DECK.ocM, f.W <= 4.8 || row % 2 === 0 ? 4.8 : 3.6)) {
      const cross = js.filter((s) => s >= a - 0.02 && s <= b + 0.02).length;
      M(out, nid('db'), 'decking', 'board', 'decking', id, el.board === 'cedar' ? 'cedar' : 'pine', DECK.board.t, w, P(a, by, t + w / 2), P(b, by, t + w / 2), vN, {
        area: r3((b - a) * w), thickness: DECK.board.t, col: el.board === 'cedar' ? 'cedar' : 'ptboard', row, course: 1, deck: 1,
        buy: [(el.board === 'cedar' ? 'deckcedar' : 'deckpt'), item, 'm', (b - a) * (w / bw), 'Deck boards (' + BOARD_NAME[el.board === 'cedar' ? 'cedar' : 'pt'].toLowerCase() + ')', why.board],
        hw: [['screws_deck', cross * 2 * DECK.screwKg, 'kg', 'Deck screws', 'Coated screws for treated wood: two at every joist a board crosses.']] });
    }
  }
  // ---- the porch: posts on the beam line, a header on them, a ledger on the house wall, the rafters between (they come from
  // the roof plane describe pushed into desc.roofs; they are re-staged here into the porch's own frame stage)
  if (pl.porch && pl.porch.ok) porchMembers(out, el, pl, h, { P, nid, r3, id, f, UPV, uN });
  // ---- rails and stairs, after the decking
  if (pl.guard || (pl.stair && pl.stair.ok && !pl.stair.none)) guardMembers(out, el, pl, h, { P, nid, r3, id, f, UPV, uN, vN });
  return pl;
}
const evenly = (lo, hi, maxStep) => { const n = Math.max(1, Math.ceil((hi - lo) / maxStep - 1e-9)); return Array.from({ length: n + 1 }, (_, k) => lo + ((hi - lo) * k) / n); };
function porchMembers(out, el, pl, h, c) {
  const { M, splice } = h, { P, nid, f, UPV, uN } = c, po = pl.porch, id = el.id, hb = ACTUAL[po.hSize][0], st = pl.stair && pl.stair.ok && !pl.stair.none && pl.stair.edge === 'out' ? pl.stair : null;
  // posts: spread along the beam line, leaving the stair's gap clear
  const segs = st ? [[PORCH.postEndM, st.pc - st.gap / 2 - 0.1], [st.pc + st.gap / 2 + 0.1, f.W - PORCH.postEndM]].filter(([a, b]) => b - a > 0.2) : [[PORCH.postEndM, f.W - PORCH.postEndM]];
  const ps = segs.flatMap(([a, b]) => evenly(a, b, PORCH.postMaxM));
  const base = pl.top, why = {
    post: 'A 6 x 6 post bolted down to the deck frame carries the header and the roof load to the pier under the beam.',
    header: 'Two boards on edge across the posts: the rafters\' outer ends sit on it. Sized for the post spacing on the safe side.',
    ledger: 'A board bolted through the house wall at the roof\'s top edge: the rafters hang from it and the wall carries that side of the roof.',
    flash: 'Flashing turned up the wall and over the shingles, tucked under the wrap: water runs onto the roof, not behind the siding.',
  };
  for (const s of ps) M(out, nid('pp'), 'post', 'porch-post', 'porch-frame', id, 'timber', 0.14, 0.14, P(s, base, po.tHdr), P(s, po.hdrBot, po.tHdr), uN, { col: 'pt', buy: ['porchpost', 'lumber_pt_6x6', 'm', po.hdrBot - base, 'Porch posts (6 x 6 treated)', why.post],
    hw: [['carriage_bolt', 2, 'each', 'Carriage bolts', 'Half-inch bolts through the post and the deck framing.']] });
  const bc = po.hdrTop - po.hdd / 2;
  for (const [a, b] of splice(0, f.W, PORCH.postEndM, PORCH.postMaxM))
    M(out, nid('ph'), 'beam', 'porch-header', 'porch-frame', id, 'timber', 2 * hb, po.hdd, P(a, bc, po.tHdr), P(b, bc, po.tHdr), UPV, { plies: 2, size: po.hSize, col: 'pt', buy: ['porchhdr' + po.hSize, 'lumber_pt_' + po.hSize, 'm', b - a, 'Porch header (2 x ' + po.hSize.split('x')[1] + ' treated)', why.header, 2] });
  const RD = po.rafterD, lag = ledgerLags(f.W, po.run);
  splice(0, f.W, 0, DECK.ocM).forEach(([a, b], k) => M(out, nid('pl'), 'beam', 'porch-ledger', 'porch-frame', id, 'timber', ACTUAL[po.rafter][0], RD, P(a, po.ledgerY, po.tL + 0.019), P(b, po.ledgerY, po.tL + 0.019), UPV, { col: 'pt',
    buy: ['porchledger', 'lumber_pt_' + po.rafter, 'm', b - a, 'Porch roof ledger (' + po.rafter.replace('x', ' x ') + ' treated)', why.ledger],
    hw: k ? [] : [['ledger_lag', lag.n, 'each', 'Roof ledger lag screws', 'Half-inch lags through the sheathing into the wall framing, staggered.']] }));
  // the roof plane's own members: the frame goes in the porch's stage, the flashing joins the dry-in
  const planeIds = new Set([id + '.pr.0']);
  for (const m of out) if (planeIds.has(m.parent) && m.stage === 'roof-frame') m.stage = 'porch-frame';
  // wall flashing along the ledger line, over the underlayment, in the dry-in
  for (const [a, b] of splice(0, f.W, 0, 3.05))
    M(out, nid('wf'), 'rake', 'wall-flash', 'dry-in', id + '.pr.0', 'metal', 0.012, 0.15, P(a, po.ridgeY + 0.04, po.tL + 0.012), P(b, po.ridgeY + 0.04, po.tL + 0.012), UPV, { col: 'metal',
      buy: ['porchflash', 'drip_edge', 'm', b - a, 'Porch wall flashing', why.flash] });
}
// guard posts, rails and balusters round the open edges; the stair's stringers, risers, treads, landing pad and handrails
function guardMembers(out, el, pl, h, c) {
  const { M } = h, { P, nid, r3, f, UPV, vN } = c, id = el.id, st = pl.stair && pl.stair.ok && !pl.stair.none ? pl.stair : null, top = pl.top;
  const why = {
    gpost: 'A treated post fixed to the rim joist: it stands 36 in over the boards and takes a hard shove on the rail.',
    rail: 'Rails between the posts: a 2 x 4 on edge low and high, a 2 x 6 cap flat on top to lean on.',
    bal: 'Balusters set so no gap is over 3-3/4 in: a 4 in sphere must not pass (IRC R312.1.3).',
    stringer: 'The stringer is a 2 x 12 cut to the stair\'s rise and run: the treads sit on the notches.',
    tread: 'Two 5/4 boards across the stringers: an 11 in tread, at least 10 in (IRC R311.7.5.2).',
    riser: 'A closed riser, so a 4 in sphere cannot pass between the treads (IRC R311.7.5.1).',
    pad: 'A firm landing at the foot, at least 36 in each way (IRC R311.7.6).',
    hand: 'A handrail 36 in over the nosings, a profile you can grip (IRC R311.7.8).',
  };
  if (pl.guard) {
    const ps = GUARD.postSize[pl.postSize], off = GUARD.postOff[pl.postSize], H = top + GUARD.heightM, bot = pl.jt - pl.jd, railOff = off - ps / 2 - 0.019;
    const posts = new Map();   // nominal [s, t] -> the outward normals of the edges that meet there
    const addPost = (s, t, n) => { const key = r3(s) + ',' + r3(t); let q = posts.get(key); if (!q) posts.set(key, (q = { s, t, n: [0, 0] })); q.n[0] += n[0]; q.n[1] += n[1]; };
    const bays = [];
    for (const e of OPEN_EDGES(pl.attached)) {
      const L = edgeLen(f, e), n = EDGE_N[e], gaps = st && st.edge === e ? [[st.pc - st.gap / 2, st.pc + st.gap / 2]] : [];
      const segs = gaps.length ? [[0, gaps[0][0]], [gaps[0][1], L]] : [[0, L]];
      for (const [a, b] of segs) {
        if (b - a < 0.05) continue;
        const ts = evenly(a, b, GUARD.postMaxM);
        ts.forEach((p) => addPost(...edgeAt(f, e, p), n));
        for (let k = 0; k + 1 < ts.length; k++) bays.push({ e, n, a: ts[k], b: ts[k + 1] });
      }
    }
    const pos = (q) => [q.s + q.n[0] * off, q.t + q.n[1] * off];
    for (const q of posts.values()) { const [s, t] = pos(q); M(out, nid('gp'), 'guardpost', 'guard-post', 'rails', id, 'timber', ps, ps, P(s, bot, t), P(s, H, t), UPV, { col: 'pt',
      buy: ['gpost' + pl.postSize, 'lumber_pt_' + pl.postSize, 'm', H - bot, 'Guard posts (' + pl.postSize.replace('x', ' x ') + ' treated)', why.gpost],
      hw: [['carriage_bolt', 2, 'each', 'Carriage bolts', 'Half-inch bolts through the post and the rim joist (a ' + (pl.postSize === '4x4' ? 'notched 4 x 4' : '6 x 6 on the face') + ').']] }); }
    const bw = GUARD.baluster, rb = [0.038, 0.089];
    const yTopRail = H - 0.038 - rb[1] / 2, yBotRail = top + GUARD.bottomLiftM + rb[1] / 2, yb0 = top + GUARD.bottomLiftM + rb[1], yb1 = H - 0.038 - rb[1];
    for (const bay of bays) {
      const { e, n } = bay, len = bay.b - bay.a;
      const at = (p, y, o2) => { const q = edgeAt(f, e, p); return P(q[0] + n[0] * o2, y, q[1] + n[1] * o2); };
      const hn = [n[0] * f.u[0] + n[1] * f.v[0], 0, n[0] * f.u[1] + n[1] * f.v[1]];
      M(out, nid('rt'), 'rail', 'top', 'rails', id, 'timber', 0.038, rb[1], at(bay.a, yTopRail, railOff), at(bay.b, yTopRail, railOff), UPV, { col: 'pt', buy: ['rail24', 'lumber_pt_2x4', 'm', len, 'Guard rails (2 x 4 treated)', why.rail] });
      M(out, nid('rb'), 'rail', 'bottom', 'rails', id, 'timber', 0.038, rb[1], at(bay.a, yBotRail, railOff), at(bay.b, yBotRail, railOff), UPV, { col: 'pt', buy: ['rail24', 'lumber_pt_2x4', 'm', len, 'Guard rails (2 x 4 treated)', why.rail] });
      M(out, nid('rc'), 'rail', 'cap', 'rails', id, 'timber', 0.038, 0.14, at(bay.a, H - 0.019, off), at(bay.b, H - 0.019, off), hn, { col: 'pt', buy: ['rail26', 'lumber_pt_2x6', 'm', len, 'Guard rail caps (2 x 6 treated)', why.rail] });
      const clear = len - ps, nb = Math.max(0, Math.ceil((clear - GUARD.aimGapM) / (bw + GUARD.aimGapM) - 1e-9)), gap = (clear - nb * bw) / (nb + 1);
      for (let k = 0; k < nb; k++) { const p = bay.a + ps / 2 + gap * (k + 1) + bw * k + bw / 2;
        M(out, nid('bl'), 'baluster', 'baluster', 'rails', id, 'timber', bw, bw, at(p, yb0, railOff), at(p, yb1, railOff), hn, { col: 'pt', gap: r3(gap), buy: ['baluster', 'baluster_pt', 'each', 1, 'Balusters (2 x 2 treated)', why.bal],
          hw: [['screws_deck', 4 * DECK.screwKg, 'kg', 'Deck screws', 'Two screws through each end of every baluster.']] });}
    }
  }
  if (st) {
    const { rise, N, T, w, g, theta, E } = st, sn = Math.sin(theta), cn = Math.cos(theta), SD = ACTUAL[STAIR.stringer];
    // the stair's own frame: base point E is in the building's metres; step out along the edge's world direction
    const ow = st.o, lw = [ow[1], -ow[0]];
    const W3 = (x, y, l) => [E[0] + ow[0] * x + lw[0] * l, y, E[1] + ow[1] * x + lw[1] * l];
    const yk = (k) => top - k * rise;
    const n3 = [ow[0] * sn, cn, ow[1] * sn], o3 = [ow[0], 0, ow[1]];
    for (let j = 0; j < st.stringers; j++) {
      const l = -w / 2 + 0.019 + (j * (w - 0.038)) / (st.stringers - 1);
      const ctr = (x, y) => W3(x - (SD[1] / 2) * sn, y - (SD[1] / 2) * cn, l);
      M(out, nid('sg'), 'stringer', 'stringer', 'rails', id, 'timber', SD[0], SD[1], ctr(0, top), ctr((N - 1) * T, yk(N - 1)), n3, { col: 'pt', rise: r3(rise), run: r3(T), notches: N - 1, throat: r3(st.throat),
        buy: ['stringer', 'lumber_pt_2x12', 'm', st.pitchLen + 0.3, 'Stair stringers (2 x 12 treated, cut to the rise and run)', why.stringer],
        hw: [['stair_bracket', 1, 'each', 'Stringer connectors', 'A galvanized angle holds the top of each stringer to the rim joist.']] });
    }
    for (let k = 1; k <= N - 1; k++) {
      M(out, nid('tr'), 'tread', 'tread', 'rails', id, 'pine', STAIR.treadT, T, W3((k - 0.5) * T, yk(k) - STAIR.treadT / 2, -w / 2), W3((k - 0.5) * T, yk(k) - STAIR.treadT / 2, w / 2), o3, { col: 'ptboard', step: k, deck: 1,
        buy: ['stairtread', 'board_deck_pt', 'm', 2 * w, 'Stair treads (5/4 x 6 treated)', why.tread], hw: [['screws_deck', 2 * st.stringers * DECK.screwKg, 'kg', 'Deck screws', 'Two screws at every stringer.']] });
      M(out, nid('ri'), 'tread', 'riser', 'rails', id, 'pine', 0.019, rise - STAIR.treadT, W3(k * T - 0.0095, yk(k) - STAIR.treadT - (rise - STAIR.treadT) / 2, -w / 2), W3(k * T - 0.0095, yk(k) - STAIR.treadT - (rise - STAIR.treadT) / 2, w / 2), o3, { col: 'ptboard', step: k, deck: 1,
        buy: ['stairriser', 'board_deck_pt', 'm', w * ((rise - STAIR.treadT) / 0.14), 'Stair risers (5/4 x 6 treated, ripped)', why.riser] });
    }
    for (let q = 0; q < st.pads; q++) {
      const l = -w / 2 + STAIR.padM / 2 + q * STAIR.padM;
      M(out, nid('pd'), 'landing', 'pad', 'rails', id, 'concrete', STAIR.padM, STAIR.padM, W3((N - 1) * T + STAIR.padM / 2, g, l), W3((N - 1) * T + STAIR.padM / 2, g + STAIR.padT, l), o3, { col: 'concrete', buy: ['stairpad', 'stair_pad', 'each', 1, 'Landing pad (36 x 36 in precast)', why.pad] });
    }
    // handrails (and the newel post at the foot) on one side, or both when the drop is over 30 in
    const ps = st.ps, sides = st.handrails === 2 ? [-1, 1] : st.handrails === 1 ? [1] : [];
    for (const sd of sides) {
      const l = (sd * st.gap) / 2, y1 = yk(N - 1) + STAIR.handrailM;
      M(out, nid('np'), 'guardpost', 'newel', 'rails', id, 'timber', ps, ps, W3((N - 1) * T, g, l), W3((N - 1) * T, y1 + 0.05, l), UPV, { col: 'pt', buy: ['gpost' + pl.postSize, 'lumber_pt_' + pl.postSize, 'm', y1 + 0.05 - g, 'Guard posts (' + pl.postSize.replace('x', ' x ') + ' treated)', why.gpost] });
      M(out, nid('hr'), 'rail', 'handrail', 'rails', id, 'timber', 0.05, 0.05, W3(0, top + STAIR.handrailM, l), W3((N - 1) * T, y1, l), UPV, { col: 'pt', buy: ['handrail', 'handrail_pt', 'm', st.pitchLen, 'Handrail (graspable profile)', why.hand] });
    }
  }
}
// which rows of boards a point stands on: the row index at a local point, or -1 off the boards
export function rowAt(d, plan, x, z) {
  const f = plan.frame, s = (x - f.A[0]) * f.u[0] + (z - f.A[1]) * f.u[1], t = (x - f.A[0]) * f.v[0] + (z - f.A[1]) * f.v[1];
  if (s < -0.02 || s > f.W + 0.02 || t < -0.02 || t > f.D + 0.02) return -1;
  return Math.max(0, Math.floor((t - plan.tL - DECK.board.gap) / (DECK.board.w + DECK.board.gap)));
}
