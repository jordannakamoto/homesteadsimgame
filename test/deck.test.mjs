// Decks (slice B-2), headless: the span tables, the members a drawn deck makes (ledger, hangers, joists, beam on posts on
// piers, boards as courses), its shopping lines, the structure check, and that its piers become a foundation job by
// themselves once construction.setPlan has the plan. The page half is test/deck.smoke.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/framing.js';
import '../src/build-ext.js';
import '../src/game/deck.js';
import * as D from '../src/sim/content/deck.js';
import { createGameSim, foundationRead } from '../src/sim/index.js';
import * as K from '../src/sim/construction.js';
import * as C from '../src/sim/content/construction.js';
import { ITEMS } from '../src/sim/items.js';
const F = globalThis.__framing, EXT = globalThis.__buildExt;

const house = () => ({ found: 'pier-blocks', spec: {}, floors: [{ id: 'f', outline: [[0, 0], [4, 0], [4, 3], [0, 3]], y0: 0, ground: true, groundY: () => -0.45 }],
  walls: [{ id: 'w1', a: [0, 3], b: [4, 3], y0: 0, h: 2.4, out: 1, openings: [] }], roofs: [] });
const attached = (o = {}) => ({ id: 1, poly: [[0, 3], [4, 3], [4, 6], [0, 6]], dir: 0, height: 0.095, attach: 'w1', joist: 'auto', board: 'pt', ...o });
const free = (o = {}) => ({ id: 1, poly: [[0, 0], [4, 0], [4, 3], [0, 3]], dir: 0, height: 0.75, attach: null, joist: 'auto', board: 'cedar', ...o });
function membersOf(S, desc, gy = () => -0.45) {
  EXT.describe(S, desc, { groundY: gy });
  return F.generate(desc).filter((m) => String(m.parent).startsWith('x-deck-'));
}
const count = (mem, f) => mem.filter(f).length;

test('span tables: IRC prescriptive deck joist spans at 16 in, southern pine and fir', () => {
  const ftin = (m) => Math.round(m / D.IN);
  assert.equal(ftin(D.maxJoistSpan('2x8', 'syp')), 11 * 12 + 10);
  assert.equal(ftin(D.maxJoistSpan('2x8', 'df')), 11 * 12 + 1);
  assert.equal(ftin(D.maxJoistSpan('2x10', 'syp')), 14 * 12);
  assert.ok(D.JOIST_SIZES.every((s, k, a) => !k || D.maxJoistSpan(s) > D.maxJoistSpan(a[k - 1])), 'deeper joists span further');
  assert.ok(D.maxJoistSpan('2x8', 'syp', 12) > D.maxJoistSpan('2x8', 'syp', 16) && D.maxJoistSpan('2x8', 'syp', 16) > D.maxJoistSpan('2x8', 'syp', 24));
  // ledger lags: closer together for longer joists (IRC R507.9.1.3)
  assert.ok(D.ledgerLags(4, 1.5).oc > D.ledgerLags(4, 3.5).oc && D.ledgerLags(4, 3.5).n > D.ledgerLags(4, 1.5).n);
});

test('an attached deck: ledger, joists every 400 mm in hangers, beam on posts on poured piers, boards as rows', () => {
  const S = { id: 3, ext: { deck: [attached()] } }, desc = house();
  const mem = membersOf(S, desc);
  assert.deepEqual(desc.extras.map((e) => [e.id, e.attached]), [['x-deck-3-1', true]]);
  const ledger = mem.filter((m) => m.kind === 'ledger');
  assert.ok(ledger.length >= 1 && ledger.every((m) => m.stage === 'deck-frame'));
  // the ledger is on the sheathing's face, outside the wall line, the depth of the joists
  assert.ok(Math.abs(ledger[0].a[2] - (3 + D.DECK.sheathFace + 0.019)) < 1e-6 && ledger[0].section.d === F.LUMBER['2x8'][1]);
  const joists = mem.filter((m) => m.kind === 'joist' && m.type !== 'rim');
  const xs = joists.map((m) => m.a[0]).sort((a, b) => a - b);
  assert.equal(joists.length, 11);   // end joists at 0 and 4 m, 9 between every 400 mm
  for (let k = 1; k + 2 < xs.length; k++) assert.ok(Math.abs(xs[k + 1] - xs[k] - 0.4) < 1e-6);
  assert.ok(joists.every((m) => m.hw && m.hw.some((h) => h[0] === 'joist_hanger_2x8')), 'every joist hangs on the ledger');
  const piers = mem.filter((m) => m.kind === 'pier');
  assert.ok(piers.length >= 2 && piers.every((m) => m.type === 'poured' && m.stage === 'foundation' && m.volume > 0));
  assert.equal(count(mem, (m) => m.kind === 'footing'), piers.length);
  assert.equal(count(mem, (m) => m.kind === 'beam'), 1);
  const boards = mem.filter((m) => m.kind === 'decking');
  assert.ok(boards.every((m) => m.stage === 'decking' && m.course && m.deck && Number.isInteger(m.row)));
  const rows = new Set(boards.map((m) => m.row));
  assert.equal(rows.size, Math.ceil((3 - D.DECK.sheathFace - D.DECK.board.gap) / (D.DECK.board.w + D.DECK.board.gap)));
  // the boards' top is the deck's height
  assert.ok(boards.every((m) => Math.abs(m.a[1] + D.DECK.board.t / 2 - 0.095) < 1e-9));
});

test('a free-standing deck stands on two beams and has no ledger or hangers', () => {
  const S = { id: 4, ext: { deck: [free()] } };
  const mem = membersOf(S, { found: 'piers', spec: {}, floors: [], walls: [], roofs: [] }, () => -0.6);
  assert.equal(count(mem, (m) => m.kind === 'ledger'), 0);
  assert.equal(count(mem, (m) => m.kind === 'beam'), 2);
  assert.ok(mem.every((m) => !(m.hw || []).some((h) => /hanger/.test(h[0]))), 'joists sit on the beams');
  assert.equal(count(mem, (m) => m.kind === 'joist' && m.type === 'rim'), 2);
  // a wall that is gone leaves the deck free-standing (its beam takes the house side)
  const gone = membersOf({ id: 5, ext: { deck: [attached()] } }, { ...house(), walls: [] });
  assert.equal(count(gone, (m) => m.kind === 'ledger'), 0);
});

test('shopping list: treated lumber, hangers, ledger lags and flashing, deck boards and screws, concrete', () => {
  const mem = membersOf({ id: 3, ext: { deck: [attached()] } }, house());
  const lines = F.materialsList(mem), by = (item) => lines.filter((l) => l.itemId === item);
  for (const it of ['lumber_pt_2x8', 'lumber_pt_2x10', 'joist_hanger_2x8', 'ledger_lag', 'ledger_flashing', 'board_deck_pt', 'screws_deck', 'concrete_mix']) {
    assert.ok(by(it).length, 'a line of ' + it);
    assert.ok(ITEMS[it], it + ' is in the catalog');
  }
  assert.equal(by('joist_hanger_2x8')[0].qty, 11 * (D.planDeck(attached(), { attached: true, groundY: () => -0.45 }).flush ? 2 : 1));
  assert.ok(by('ledger_lag')[0].qty >= 4 && by('ledger_lag')[0].stage === 'deck-frame');
  assert.ok(Math.abs(by('board_deck_pt')[0].qty - 4 * 20.5) < 4 * 1.2, 'about a 4 m board for every row');
  assert.ok(by('lumber_pt_2x8').some((l) => l.label.startsWith('Deck joists')) && by('lumber_pt_2x8').some((l) => l.label.startsWith('Ledger')));
  for (const it of ['joist_hanger_2x8', 'ledger_lag', 'screws_deck', 'ledger_flashing']) assert.ok(C.SITE_SUPPLY.includes(it), it + ' is used up like nails');
});

test('structure check: joists over the span table are refused, near it warned; auto picks the size; too low and too high', () => {
  const ctx = { attached: false, groundY: () => -0.8 };
  const r8 = D.planDeck(free({ poly: [[0, 0], [3, 0], [3, 4], [0, 4]], joist: '2x8' }), ctx);
  assert.ok(!r8.ok && /2x8 joists at 16 in span 3\.61 m/.test(r8.errors[0]), r8.errors[0]);
  const auto = D.planDeck(free({ poly: [[0, 0], [3, 0], [3, 4], [0, 4]] }), ctx);
  assert.ok(auto.ok && auto.joist === '2x10' && auto.span <= 0.9 * auto.maxSpan);
  const tight = D.planDeck(free({ poly: [[0, 0], [3, 0], [3, 3.6], [0, 3.6]], joist: '2x8' }), ctx);
  assert.ok(tight.ok && tight.warns.some((w) => /springy/.test(w)));
  assert.ok(!D.planDeck(free({ poly: [[0, 0], [8, 0], [8, 6], [0, 6]] }), ctx).ok, 'nothing spans 5.7 m');
  const low = D.planDeck(free({ height: 0.3 }), { groundY: () => 0 });
  assert.ok(!low.ok && /Too low/.test(low.errors[0]));
  assert.ok(D.planDeck(free({ height: 1.2 }), { groundY: () => 0 }).guard, 'over 30 in gets a guard rail (test/porch.test.mjs has the rest)');
  // a ledger needs a rim joist: not on a slab
  assert.ok(!D.planDeck(attached(), { attached: true, found: 'slab', groundY: () => -0.45 }).ok);
  assert.ok(!D.planDeck({ ...free(), poly: [[0, 0], [1, 0], [1, 1]] }).ok, 'a rectangle');
});

test('the deck piece: a floor of type deck with an outline, its members under it', () => {
  const out = [], S = { id: 3, ext: { deck: [attached()] } };
  EXT.pieces(S, out, { head: (id, kind, type, material) => ({ id, struct: 3, kind, type, material, built: false }), W2: (x, z) => ({ x, z }), y0: 1, H: 2.84 });
  assert.equal(out.length, 1);
  const p = out[0];
  assert.ok(p.kind === 'floor' && p.type === 'deck' && p.outline.length === 4 && Math.abs(p.y1 - 1.095) < 1e-9 && Math.abs(p.area - 12) < 1e-9);
});

test('the deck\'s piers become a foundation job by themselves, and the deck stages wait their turn', () => {
  const SID = 9, OX = 30, OZ = 30, Y = 0.3, S = { id: SID, ext: { deck: [free({ height: 0.75 })] } };
  const mem = membersOf(S, { found: 'piers', spec: {}, floors: [], walls: [], roofs: [] }, () => -0.3);
  const pieces = mem.map((m) => {
    const ax = m.b[0] - m.a[0], ay = m.b[1] - m.a[1], az = m.b[2] - m.a[2], al = Math.hypot(ax, ay, az) || 1, wy = (az * m.n[0] - ax * m.n[2]) / al;
    const e = (Math.abs(m.n[1]) * m.section.d + Math.abs(wy) * m.section.b) / 2;
    return { id: m.id, struct: SID, storey: 0, kind: m.kind, type: m.type, material: m.material, stage: m.stage, parent: m.parent, section: m.section, length: m.length, plies: m.plies,
      a: { x: OX + m.a[0], z: OZ + m.a[2] }, b: { x: OX + m.b[0], z: OZ + m.b[2] }, y0: Y + Math.min(m.a[1], m.b[1]) - e, y1: Y + Math.max(m.a[1], m.b[1]) + e, volume: m.volume, built: false };
  });
  const sim = createGameSim(5);
  const r = sim.commandNow('construction.setPlan', K.planFromPieces(SID, pieces, F.materialsList(mem), { name: 'Deck', x: OX + 2, z: OZ + 1.5, r: 3 }));
  assert.ok(r.ok, r.reason);
  const j = foundationRead.jobFor(sim.state, SID);
  assert.ok(j && j.type === 'piers', 'a pier job, with no page');
  assert.equal(j.elements.filter((e) => e.kind === 'pier').length, mem.filter((m) => m.kind === 'pier').length);
  assert.ok(j.timber && j.timber.length >= 2, 'the posts and beams go on the brackets');
  const pr = sim.state.sys.construction.progress[SID];
  assert.ok(!K.stageOpen(pr, 'deck-frame') && !K.stageOpen(pr, 'decking'), 'nothing framed before the piers');
  assert.ok(pr.lines['decking|deckcedar'] && pr.lines['decking|deckcedar'].itemId === 'board_deck_cedar');
  assert.ok(pr.lines['decking|hw:screws_deck'] && pr.lines['decking|hw:screws_deck'].supply);
});
