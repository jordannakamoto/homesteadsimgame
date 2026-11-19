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
// more than 30 in above grade (IRC R312.1.1); rails come with slice B-3, so for now that is a warning.

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
  { id: 'ledger_flashing', name: 'Ledger Z-flashing', category: 'fasteners', unit: 'm', massKg: 0.25, priceUsd: 3.2, blurb: 'Bent metal over the top of the ledger and up under the wrap: rain runs out over it, not behind it' },
]);
// the small things used up as the deck goes on (like nails): they sit by the stacks
export const DECK_SUPPLY = Object.freeze(['joist_hanger_2x6', 'joist_hanger_2x8', 'joist_hanger_2x10', 'joist_hanger_2x12', 'ledger_lag', 'screws_deck', 'ledger_flashing']);
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
  if (above > DECK.guardM) warns.push('Over 30 in (' + above.toFixed(2) + ' m) above the ground: it needs a guard rail (IRC R312.1.1). Rails come later; mind the edge.');
  out.ok = !errors.length;
  return out;
}

// The members of one deck. el = { id, poly, dir, height, attach, joist, board, attached, found, groundY }; h = the
// framing helpers { M, splice } (src/framing.js). Coordinates in the building's own metres.
export function deckMembers(out, el, h) {
  const pl = planDeck(el, { attached: el.attached, found: el.found, groundY: el.groundY });
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
  return pl;
}
// which rows of boards a point stands on: the row index at a local point, or -1 off the boards
export function rowAt(d, plan, x, z) {
  const f = plan.frame, s = (x - f.A[0]) * f.u[0] + (z - f.A[1]) * f.u[1], t = (x - f.A[0]) * f.v[0] + (z - f.A[1]) * f.v[1];
  if (s < -0.02 || s > f.W + 0.02 || t < -0.02 || t > f.D + 0.02) return -1;
  return Math.max(0, Math.floor((t - plan.tL - DECK.board.gap) / (DECK.board.w + DECK.board.gap)));
}
