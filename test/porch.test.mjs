// Guards, stairs and a porch roof on decks (slice B-3), headless: the guard rule and its members, the stair's geometry against the
// IRC numbers, the porch's roof plane and the stages they go in. The page half is test/deck.smoke.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/framing.js';
import '../src/build-ext.js';
import '../src/game/deck.js';
import * as D from '../src/sim/content/deck.js';
import * as C from '../src/sim/content/construction.js';
import { ITEMS } from '../src/sim/items.js';
import { createGameSim } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
const F = globalThis.__framing, EXT = globalThis.__buildExt, IN = D.IN;

const house = (h = 2.84) => ({ found: 'pier-blocks', spec: {}, floors: [{ id: 'f', outline: [[0, 0], [4, 0], [4, 3], [0, 3]], y0: 0, ground: true, groundY: () => -0.45 }],
  walls: [{ id: 'w1', a: [0, 3], b: [4, 3], y0: 0, h, out: 1, openings: [] }], roofs: [] });
const attached = (o = {}) => ({ id: 1, poly: [[0, 3], [4, 3], [4, 5.4], [0, 5.4]], dir: 0, height: 0.095, attach: 'w1', joist: 'auto', board: 'pt', ...o });
const free = (o = {}) => ({ id: 1, poly: [[0, 0], [4, 0], [4, 2.4], [0, 2.4]], dir: 0, height: 0.95, attach: null, joist: 'auto', board: 'pt', ...o });
function build(S, desc, gy = () => -0.45) {
  EXT.describe(S, desc, { groundY: gy });
  return { mem: F.generate(desc), desc };
}
const mine = (mem) => mem.filter((m) => String(m.parent).startsWith('x-deck-'));
const count = (mem, f) => mem.filter(f).length;
const flat = (g) => () => g;

test('a guard is required over 30 in (and Off is refused), optional under it', () => {
  const hi = D.planDeck(free({ height: 0.9 }), { groundY: flat(0) }), lo = D.planDeck(free({ height: 0.5 }), { groundY: flat(0) });
  assert.ok(hi.ok && hi.guardRequired && hi.guard, 'a deck 0.9 m up gets rails by itself');
  assert.ok(lo.ok && !lo.guardRequired && !lo.guard, 'a low one does not');
  assert.ok(D.planDeck(free({ height: 0.5, rails: 'on' }), { groundY: flat(0) }).guard, 'but may have them');
  const off = D.planDeck(free({ height: 0.9, rails: 'off' }), { groundY: flat(0) });
  assert.ok(!off.ok && /guard is required/.test(off.errors[0]) && /R312\.1\.1/.test(off.errors[0]));
  assert.ok(D.planDeck(free({ height: 0.5, rails: 'off' }), { groundY: flat(0) }).ok);
  assert.ok(Math.abs(D.DECK.guardM - 30 * IN) < 1e-9);
});

test('guard members: posts 36 in over the boards, two rails and a cap, balusters under a 4 in sphere', () => {
  for (const post of ['4x4', '6x6']) {
    const S = { id: 3, ext: { deck: [free({ post })] } }, { mem } = build(S, { found: 'piers', spec: {}, floors: [], walls: [], roofs: [] }, flat(0));
    const m = mine(mem), posts = m.filter((q) => q.kind === 'guardpost'), rails = m.filter((q) => q.kind === 'rail'), bal = m.filter((q) => q.kind === 'baluster');
    assert.ok(m.filter((q) => q.stage === 'rails').length === posts.length + rails.length + bal.length, 'all in the rails stage');
    assert.ok(posts.length >= 8, 'corners and at most 6 ft apart: ' + posts.length);
    for (const p of posts) assert.ok(Math.abs(p.b[1] - (0.95 + 36 * IN)) < 1e-9 && p.section.b === D.GUARD.postSize[post], 'post tops at 36 in');
    for (const t of ['top', 'bottom', 'cap']) assert.ok(rails.some((r) => r.type === t), t + ' rail');
    assert.ok(bal.length > 40 && bal.every((b) => b.gap < 4 * IN && b.gap > 0.04), 'every gap under 4 in');
    assert.ok(Math.max(...bal.map((b) => b.gap)) < D.GUARD.sphereM);
    // the lowest gap, under the bottom rail, is under 4 in too, and the top gap is closed by the rail
    const bot = rails.find((r) => r.type === 'bottom');
    assert.ok(bot.a[1] - bot.section.d / 2 - 0.95 < D.GUARD.sphereM);
    // no run of posts further apart than 6 ft
    for (const r of rails.filter((q) => q.type === 'cap')) assert.ok(r.length <= D.GUARD.postMaxM + 1e-6);
    assert.ok(m.filter((q) => q.kind === 'guardpost').every((q) => q.hw.some((h) => h[0] === 'carriage_bolt')));
  }
  // an attached deck has no rail along the house
  const A = { id: 4, ext: { deck: [attached({ height: 0.095 })] } }, a = mine(build(A, house(), () => -1.2).mem);
  assert.ok(a.some((q) => q.kind === 'guardpost'), 'high over the ground it gets rails');
  assert.ok(!a.some((q) => q.kind === 'rail' && Math.abs(q.a[2] - q.b[2]) < 1e-6 && q.a[2] < 3.3), 'no rail along the house wall');
  // a low deck has none unless asked
  const L = mine(build({ id: 5, ext: { deck: [free({ height: 0.4 })] } }, { found: 'piers', spec: {}, floors: [], walls: [], roofs: [] }, flat(0)).mem);
  assert.equal(count(L, (q) => q.stage === 'rails'), 0);
});

test('baluster, rail and stair kinds are bought as store items; the supply items are used up like nails', () => {
  const S = { id: 3, ext: { deck: [free({ stair: { edge: 'out', w: D.STAIR.minWidthM } })] } }, { mem } = build(S, { found: 'piers', spec: {}, floors: [], walls: [], roofs: [] }, flat(0));
  const lines = F.materialsList(mem);
  for (const it of ['baluster_pt', 'lumber_pt_4x4', 'lumber_pt_2x4', 'lumber_pt_2x6', 'lumber_pt_2x12', 'board_deck_pt', 'stair_pad', 'carriage_bolt', 'stair_bracket', 'handrail_pt']) {
    assert.ok(lines.some((l) => l.itemId === it), 'a line of ' + it);
    assert.ok(ITEMS[it], it + ' is in the catalog');
  }
  for (const it of ['carriage_bolt', 'stair_bracket']) assert.ok(C.SITE_SUPPLY.includes(it));
  assert.ok(lines.find((l) => l.itemId === 'baluster_pt').qty > 30, 'balusters by the dozen');
});

test('stair geometry: risers at most 7-3/4 in, treads at least 10 in, equal rises, stringers cut to them', () => {
  for (const drop of [0.3, 0.6, 0.95, 1.4, 2.2]) {
    const pl = D.planDeck(free({ height: drop, stair: { edge: 'out' } }), { groundY: flat(0) });
    assert.ok(pl.ok, drop + ': ' + pl.errors.join());
    const st = pl.stair;
    assert.ok(st.rise <= 7.75 * IN + 1e-9 && st.T >= 10 * IN, 'IRC R311.7.5');
    assert.equal(st.N, Math.ceil((drop - D.STAIR.padT) / (7.75 * IN) - 1e-9), 'as few risers as the rule allows');
    assert.ok(Math.abs(st.rise * st.N - (drop - D.STAIR.padT)) < 1e-9, 'the risers add up to the drop to the pad');
    assert.ok(st.throat >= D.STAIR.throatMinM, 'what is left under the notches: ' + st.throat);
    assert.equal(st.handrails, st.N >= 4 ? (drop > D.DECK.guardM ? 2 : 1) : 0, 'a handrail from four risers');
    assert.ok(st.w >= 36 * IN - 1e-9);
  }
  const S = { id: 3, ext: { deck: [free({ height: 0.95, stair: { edge: 'out' } })] } }, { mem } = build(S, { found: 'piers', spec: {}, floors: [], walls: [], roofs: [] }, flat(0)), m = mine(mem);
  const pl = D.planDeck(free({ height: 0.95, stair: { edge: 'out' } }), { groundY: flat(0) }), st = pl.stair;
  const strs = m.filter((q) => q.kind === 'stringer'), treads = m.filter((q) => q.kind === 'tread' && q.type === 'tread'), risers = m.filter((q) => q.type === 'riser');
  assert.equal(strs.length, st.stringers);
  assert.ok(st.stringers >= 3, 'three stringers for 36 in at 18 in o.c.');
  assert.equal(treads.length, st.N - 1);
  assert.equal(risers.length, st.N - 1, 'closed risers (4 in sphere, R311.7.5.1)');
  assert.ok(strs.every((q) => q.rise === Math.round(st.rise * 1000) / 1000 && q.notches === st.N - 1 && q.section.d === 0.286));
  // the treads' tops step down by one rise each, from the deck's boards to the pad
  const tops = treads.sort((a, b) => a.step - b.step).map((q) => q.a[1] + D.STAIR.treadT / 2);
  tops.forEach((y, k) => assert.ok(Math.abs(y - (0.95 - (k + 1) * st.rise)) < 1e-9));
  const pad = m.find((q) => q.kind === 'landing');
  assert.ok(Math.abs(pad.b[1] - (0.95 - st.N * st.rise)) < 1e-9, 'the pad is the last step');
  assert.ok(m.filter((q) => q.type === 'handrail').length === 2 && m.filter((q) => q.type === 'handrail').every((q) => Math.abs((q.a[1] - 0.95) - 36 * IN) < 1e-9));
  // the guard along that edge stops at the stair
  const capOut = m.filter((q) => q.type === 'cap' && Math.abs(q.a[2] - q.b[2]) < 1e-6 && q.a[2] > 2.2);
  assert.equal(capOut.length, 2, 'the front guard is split by the stair');
  // too tall a drop needs a landing; a deck at grade needs no steps; the ground slope changes the count
  assert.ok(!D.planDeck(free({ height: 4.2, stair: { edge: 'out' } }), { groundY: flat(0) }).ok);
  assert.ok(D.planDeck(free({ height: 0.5, stair: { edge: 'out' } }), { groundY: flat(0.48) }).stair.none);
  const slope = D.planDeck(free({ height: 0.95, stair: { edge: 'out' } }), { groundY: (x, z) => -0.3 * Math.max(0, z - 2.4) }).stair;
  assert.ok(slope.N > st.N, 'ground falling away makes the stair longer');
  // not off the house side of a deck bolted to the house
  assert.ok(!D.planDeck(attached({ stair: { edge: 'house' } }), { attached: true, groundY: flat(-0.45), wallTop: 2.84 }).ok);
});

test('a porch: one shed plane from a wall ledger down to a header on posts; rooms still treat it as outside', () => {
  const S = { id: 3, ext: { deck: [attached({ height: 0.095, porch: { pitch: 2 }, poly: [[0, 3], [4, 3], [4, 5.4], [0, 5.4]] })] } }, desc = house(), { mem } = build(S, desc);
  assert.equal(desc.roofs.length, 1, 'describe pushed a roof');
  const R = desc.roofs[0], pl = R.planes[0], k = 2 / 12;
  assert.equal(R.planes.length, 1);
  assert.ok(R.porch && pl.lean && pl.run > 2 && Math.abs((pl.ridgeY - pl.eaveY) / pl.run - k) < 1e-9, 'a 2:12 plane');
  assert.ok(Math.abs(pl.ridgeY - (2.84 - D.PORCH.ledgerBelowTopM)) < 1e-9, 'its top edge is on the house wall, under the top plate');
  const m = mine(mem).concat(mem.filter((q) => q.parent === pl.id)), posts = m.filter((q) => q.type === 'porch-post'), hdr = m.filter((q) => q.type === 'porch-header'), led = m.filter((q) => q.type === 'porch-ledger');
  assert.ok(posts.length >= 2 && posts.every((q) => q.section.b === 0.14 && q.stage === 'porch-frame'));
  const raf = mem.filter((q) => q.kind === 'rafter' && q.parent === pl.id);
  assert.ok(raf.length > 4 && raf.every((q) => q.stage === 'porch-frame'), 'the rafters are in the porch frame: ' + raf.length);
  // the header is under the rafters at the post line; the ledger at the wall
  const hy = hdr[0].a[1] + hdr[0].section.d / 2;
  assert.ok(hy < pl.eaveY + k * D.PORCH.eaveOverM + 1e-9 && hy > pl.eaveY - 0.3, 'header top sits under the plane at the eave');
  assert.ok(led.length >= 1 && Math.abs(led[0].a[2] - (3 + D.DECK.sheathFace + 0.019)) < 1e-9, 'ledger on the sheathing face');
  // sheets, dry-in and roofing are the house's stages; the wall flashing joins the dry-in over the underlayment
  assert.ok(mem.some((q) => q.parent === pl.id && q.stage === 'roof-deck') && mem.some((q) => q.parent === pl.id && q.kind === 'roofing'));
  const fl = mem.filter((q) => q.type === 'wall-flash');
  assert.ok(fl.length >= 1 && fl.every((q) => q.stage === 'dry-in' && q.kind === 'rake'), 'flashing in the dry-in');
  assert.ok(!mem.some((q) => q.type === 'top' && q.kind === 'ridgecap' && q.parent === pl.id), 'no ridge cap against a wall');
  // headroom under the header
  const p = D.planDeck(S.ext.deck[0], { attached: true, found: 'pier-blocks', groundY: () => -0.45, wallTop: 2.84 });
  assert.ok(p.ok && p.porch.clear >= 1.8, 'clear ' + p.porch.clear);
  assert.ok(Math.abs(p.porch.clear - (p.porch.hdrBot - 0.095)) < 1e-9);
  // a short wall, or a deck too deep, leaves too little headroom
  const low = D.planDeck({ ...S.ext.deck[0], poly: [[0, 3], [4, 3], [4, 7], [0, 7]] }, { attached: true, found: 'pier-blocks', groundY: () => -0.45, wallTop: 2.4 });
  assert.ok(!low.ok && /headroom/i.test(low.errors.join()));
  assert.ok(!D.planDeck(free({ porch: { pitch: 2 } }), { groundY: flat(0), wallTop: 2.8 }).ok, 'a porch ties to a house wall');
  // a roof of its own is not a piece the rooms see: the deck piece is the only piece and rooms skip decks
  const out = [];
  EXT.pieces(S, out, { head: (id, kind, type, material) => ({ id, struct: 3, kind, type, material, built: false }), W2: (x, z) => ({ x, z }), y0: 1, H: 2.84 });
  assert.ok(out.length === 1 && out[0].type === 'deck', 'the deck is the only piece: rooms skip decks');
});

test('stages: porch frame before the roof deck, rails after the decking; supports order posts, header, rafters', () => {
  assert.ok(C.STAGE['porch-frame'] && C.STAGE.rails && C.STAGE.rails.name === 'Rails and stairs');
  assert.deepEqual(C.STAGE['roof-deck'].needs, ['roof-frame', 'porch-frame']);
  assert.deepEqual(C.STAGE['porch-frame'].needs, ['top-plates'], 'a house without a porch sees no change');
  assert.deepEqual(C.STAGE.rails.needs, ['decking']);
  assert.ok(F.STAGES.includes('porch-frame') && F.STAGES.includes('rails'));
  for (const s of C.STAGES) assert.ok(F.STAGES.includes(s.id), s.id + ' is a framing stage');
  assert.ok(C.SUPPORT.rail.includes('guardpost') && C.SUPPORT.baluster.includes('rail') && C.SUPPORT.tread.includes('stringer'));
  // balusters are learned and swept like boards
  assert.equal(C.learnGroup('baluster'), 'baluster');
  assert.ok(C.GESTURES.some((n) => n >= 3), 'a gesture sets several at once');
});

test('the construction plan takes a deck with rails, stairs and a porch: lines, supports and stages', () => {
  const SID = 9, OX = 30, OZ = 30, Y = 0.3, d = attached({ height: 0.095, stair: { edge: 'out' }, porch: { pitch: 2 }, poly: [[0, 3], [4, 3], [4, 5], [0, 5]] });
  const { mem } = build({ id: SID, ext: { deck: [d] } }, house(), () => -1.2);
  const pieces = mem.map((m) => {
    const ax = m.b[0] - m.a[0], ay = m.b[1] - m.a[1], az = m.b[2] - m.a[2], al = Math.hypot(ax, ay, az) || 1, wy = (az * m.n[0] - ax * m.n[2]) / al;
    const e = (Math.abs(m.n[1]) * m.section.d + Math.abs(wy) * m.section.b) / 2;
    return { id: m.id, struct: SID, storey: 0, kind: m.kind, type: m.type, material: m.material, stage: m.stage, parent: m.parent, section: m.section, length: m.length, plies: m.plies,
      a: { x: OX + m.a[0], z: OZ + m.a[2] }, b: { x: OX + m.b[0], z: OZ + m.b[2] }, y0: Y + Math.min(m.a[1], m.b[1]) - e, y1: Y + Math.max(m.a[1], m.b[1]) + e, volume: m.volume, built: false };
  });
  const sim = createGameSim(5);
  const r = sim.commandNow('construction.setPlan', K.planFromPieces(SID, pieces, F.materialsList(mem), { name: 'Deck', x: OX + 2, z: OZ + 4, r: 4 }));
  assert.ok(r.ok, r.reason);
  const pr = sim.state.sys.construction.progress[SID], stages = new Set(Object.values(pr.members).map((m) => m.stage));
  for (const s of ['porch-frame', 'rails', 'roof-deck', 'dry-in', 'roofing', 'decking']) assert.ok(stages.has(s), s);
  assert.ok(Object.keys(pr.lines).some((k) => /^rails\|baluster/.test(k)), 'a balusters line: ' + Object.keys(pr.lines).filter((k) => /^rails/.test(k)).join());
  // supports in a stage: balusters wait for rails, rails for posts, treads for stringers, stringers for the pad
  const first = (kind) => Object.keys(pr.members).find((id) => pr.members[id].kind === kind);
  assert.equal(K.supportMissing(pr, first('baluster')), 'rail');
  assert.equal(K.supportMissing(pr, first('rail')), 'guardpost');
  assert.equal(K.supportMissing(pr, first('stringer')), 'landing');
  assert.equal(K.supportMissing(pr, first('tread')), 'stringer');
  const rafter = Object.keys(pr.members).find((id) => pr.members[id].kind === 'rafter' && pr.members[id].stage === 'porch-frame');
  assert.equal(K.supportMissing(pr, rafter), 'beam', 'rafters wait for the header and ledger');
});
