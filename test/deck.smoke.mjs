// Decks (slice B-2) on the page: node test/deck.smoke.mjs  (needs dist/index.html and Playwright)
// The Deck tool draws one against the shed's back wall (bolted to the house: ledger, hangers, the piece, construction has
// it) and one free-standing (a structure of its own you can walk on); a too-deep 2x8 deck is refused; Select picks a deck
// with the pointer and Delete removes it; undo brings it back; both survive a save and reload. B-3: rails, a stair and a porch roof
// on the bolted deck make their members and stages.
import { openPage } from './helpers/page.mjs';
const t = await openPage({ viewport: { width: 960, height: 540 } });
const { G, check } = t;
await t.load();
await G(() => { localStorage.clear(); __build.reset(); });
await t.frames(10);

// a shed in construction mode, a few metres ahead; the build bar open with the Deck tool in hand
const sid = await G(() => {
  const P = __game.player, H = __game.heightAt; __build.setConstructionMode(true);
  // the flattest spot near the player for the shed and its deck
  let bx = P.x + 6, bz = P.z + 6, best = Infinity;
  for (let dx = -20; dx <= 20; dx += 2) for (let dz = -20; dz <= 20; dz += 2) {
    const x = Math.round(P.x) + dx, z = Math.round(P.z) + dz;
    if (Math.hypot(dx, dz) < 5) continue;
    let lo = Infinity, hi = -Infinity;
    for (let a = -2; a <= 2; a++) for (let b = -4; b <= 2; b++) { const h = H(x + a, z + b); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (hi - lo < best && lo > 0.5) ((best = hi - lo), (bx = x), (bz = z));
  }
  return __build.placePlan('shed', bx, bz, 0).struct;
});
await G(() => document.getElementById('view').focus());
await t.page.keyboard.press('KeyB'); await t.frames(10);
const tool = await G(() => { __build.setTool('deck-tool'); const v = __build.view(); return { bar: !!document.querySelector('#bpieces button[data-piece="deck-tool"]'), opts: JSON.stringify(v.groups).includes('Joists') }; });
check('the Deck tool is on the bar with its options', tool.bar && tool.opts, JSON.stringify(tool));

// the tool's own clicks, given build mode's hover (a headless browser cannot aim at the ground)
const click = (h) => G((h) => { const S = h.sid != null ? __build.state.structs.find((q) => q.id === h.sid) : null, F = S || { isNew: true, ox: h.ox, oz: h.oz, yaw: 0, y0: __game.heightAt(h.ox, h.oz) };
  const tl = __buildExt.get('deck').tools[0]; tl.hover({ F, lx: h.lx, lz: h.lz }); tl.down({ F, lx: h.lx, lz: h.lz }); return __deck.state.readout; }, h);
// the shed's back wall in its own metres: the deck goes on the side away from the floor
const wall = await G((sid) => { const S = __build.state.structs.find((q) => q.id === sid); const w = __build.pieces().filter((p) => p.struct === sid && p.kind === 'wall' && p.type === 'wall').map((p) => [__build.toLocal(S, p.a.x, p.a.z), __build.toLocal(S, p.b.x, p.b.z), p.id]).find(([a, b]) => Math.abs(a[1] - b[1]) < 1e-3 && Math.abs(a[1] + 1.5) < 1e-3); return w; }, sid);
check('the shed has a back wall on z = -1.5', !!wall, JSON.stringify(wall));
await click({ sid, lx: -1.2, lz: -1.4 });
const readout = await click({ sid, lx: 1.2, lz: -3.5 });
const att = await G((sid) => { const d = (__build.getExt(sid, 'deck') || [])[0], mw = __build.membersOf(sid), pid = d && 'x-deck-' + sid + '-' + d.id, piece = pid && __build.piece(pid), lines = __build.materialsList(sid), pr = __game.sim.state.sys.construction.progress[sid];
  return { d, ledger: mw.list.filter((m) => m.parent === pid && m.kind === 'ledger').length, planned: mw.list.filter((m) => m.parent === pid).every((m) => mw.planned.has(m.id)), piece: piece && piece.kind + '/' + piece.type, pieceMembers: piece && (piece.members || []).length,
    hangers: lines.some((l) => /joist_hanger/.test(l.itemId)), lags: lines.some((l) => l.itemId === 'ledger_lag'), boards: lines.some((l) => l.itemId === 'board_deck_pt'), sim: !!pr && Object.values(pr.members).some((m) => m.stage === 'decking') }; }, sid);
check('a deck drawn on the back wall bolts to it', !!att.d && att.d.attach === wall[2] && att.ledger >= 1, readout + ' ' + JSON.stringify(att.d));
check('its members are planned, the piece lists them', att.planned && att.piece === 'floor/deck' && att.pieceMembers > 20, JSON.stringify(att));
check('shopping lines: hangers, ledger lags, deck boards', att.hangers && att.lags && att.boards);
await t.frames(30);
check('construction has its decking stage', await G((sid) => Object.values(__game.sim.state.sys.construction.progress[sid].members).some((m) => m.stage === 'decking'), sid));

// B-3: rails, a stair and a porch roof on that deck (set as the strip's chips do), then the construction plan has them
await G(() => __build.choose('x:deck-tool:rails', 'on'));
const opts = await G(() => { const v = JSON.stringify(__build.view().groups); return { rails: /Rails/.test(v), stair: /Stairs/.test(v), porch: /Porch roof/.test(v), post: /Rail posts/.test(v) }; });
check('the strip has Rails, Rail posts, Stairs and Porch roof', opts.rails && opts.stair && opts.porch && opts.post, JSON.stringify(opts));
await G((sid) => { const d = __build.getExt(sid, 'deck')[0]; __build.setExt(sid, 'deck', [{ ...d, rails: 'on', post: '4x4', stair: { edge: 'out', w: 0.914 }, porch: { pitch: 2 } }]); }, sid);
await t.frames(30);
const b3 = await G((sid) => { const mw = __build.membersOf(sid), d = __build.getExt(sid, 'deck')[0], pid = 'x-deck-' + sid + '-' + d.id, pl = __deck.plan(d, { attached: true, found: __build.state.structs.find((q) => q.id === sid).found, groundY: () => -0.4, wallTop: 2.84 }), pr = __game.sim.state.sys.construction.progress[sid];
  const own = mw.list.filter((m) => m.parent === pid), planeIds = new Set(mw.roofs.filter((r) => r.porch).flatMap((r) => r.planes.map((p) => p.id)));
  const stages = new Set(Object.values(pr.members).map((m) => m.stage));
  return { gp: own.filter((m) => m.kind === 'guardpost').length, bal: own.filter((m) => m.kind === 'baluster').length, str: own.filter((m) => m.kind === 'stringer').length, tr: own.filter((m) => m.kind === 'tread' && m.type === 'tread').length, pad: own.filter((m) => m.kind === 'landing').length,
    posts: own.filter((m) => m.type === 'porch-post').length, planes: planeIds.size, rafters: mw.list.filter((m) => planeIds.has(m.parent) && m.kind === 'rafter').length, stages: [...stages].filter((x) => /porch|rails/.test(x)), planOk: pl.ok, err: pl.errors.join(' '), lines: __build.materialsList(sid).some((l) => l.itemId === 'baluster_pt') && __build.materialsList(sid).some((l) => l.itemId === 'stair_pad') }; }, sid);
check('rails, stair and porch members are made', b3.gp >= 4 && b3.bal > 10 && b3.str >= 3 && b3.tr >= 1 && b3.pad === 1 && b3.posts >= 2 && b3.planes === 1 && b3.rafters > 3, JSON.stringify(b3));
check('construction has the porch frame and the rails stage, shopping has balusters and a pad', b3.stages.includes('porch-frame') && b3.stages.includes('rails') && b3.lines, JSON.stringify(b3.stages));
// the stair's rise is within the IRC limit (7-3/4 in) on the shed's ground
const stairWalk = await G((sid) => { const S = __build.state.structs.find((q) => q.id === sid), d = __build.getExt(sid, 'deck')[0], pl = __deck.plan(d, { attached: true, found: S.found, groundY: (x, z) => __game.heightAt(...__build.toWorld(S, x, z)) - S.y0, wallTop: 2.84 }), st = pl.stair;
  return st && st.ok ? { N: st.N, rise: st.rise, ok: st.rise <= 0.19685 + 1e-9 && st.T >= 0.254 } : { err: pl.errors }; }, sid);
check('the stair is within the IRC rise and tread', !!stairWalk.ok, JSON.stringify(stairWalk));
// back to a plain deck for the rest of this test
await G((sid) => { const d = __build.getExt(sid, 'deck')[0]; __build.setExt(sid, 'deck', [{ ...d, rails: 'auto', stair: null, porch: null }]); }, sid);
await G(() => __build.choose('x:deck-tool:rails', 'auto'));
await t.frames(10);

// refused: 2x8 joists 4 m deep
await G(() => __build.choose('x:deck-tool:joist', '2x8'));
const nStructs = await G(() => __build.state.structs.length);
// a flat open spot for the free-standing decks, clear of the shed
const spot = await G(() => {
  const P = __game.player, H = __game.heightAt, sh = __build.state.structs[0];
  let bx = P.x - 8, bz = P.z - 8, best = Infinity;
  for (let dx = -24; dx <= 24; dx += 2) for (let dz = -24; dz <= 24; dz += 2) {
    const x = Math.round(P.x) + dx, z = Math.round(P.z) + dz;
    if (Math.hypot(x - sh.cx, z - sh.cz) < 9) continue;
    let lo = Infinity, hi = -Infinity;
    for (let a = 0; a <= 4; a++) for (let b = 0; b <= 5; b++) { const h = H(x + a, z + b); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (hi - lo < best && lo > 0.5) ((best = hi - lo), (bx = x), (bz = z));
  }
  return [bx, bz, best];
});
await click({ ox: spot[0], oz: spot[1], lx: 0, lz: 0 });
const refused = await click({ ox: spot[0], oz: spot[1], lx: 5, lz: 4.2 });   // joists span the short way: 4.2 m less the beams' inset
check('a 2x8 deck 4 m deep is refused', (await G(() => __build.state.structs.length)) === nStructs && /2x8 joists at 16 in span/.test(await G(() => document.getElementById('ui-lane-toast').textContent)), refused);
await click({ ox: spot[0], oz: spot[1], lx: 0, lz: 0 });   // the same corner again: start over
await G(() => __build.choose('x:deck-tool:joist', 'auto'));

// free-standing: a structure of its own, walked on row by row as its boards go down
await G(() => { for (let k = 0; k < 4; k++) __build.choose('x:deck-tool:height', 1); });   // 0.8 m up
await click({ ox: spot[0], oz: spot[1], lx: 0, lz: 0 });
const made = await click({ ox: spot[0], oz: spot[1], lx: 3, lz: 2.4 });
const fr = await G(() => { const S = __build.state.structs[__build.state.structs.length - 1], d = (__build.getExt(S.id, 'deck') || [])[0]; if (!d) return null;
  const [x, z] = __build.toWorld(S, 1.5, 0.3), [x2, z2] = __build.toWorld(S, 1.5, 2.2), top = S.y0 + d.height, pid = 'x-deck-' + S.id + '-' + d.id;
  const g0 = __game.groundAt(x, z, top + 0.2);
  // the first rows of boards go down: you can stand on them, not yet past them
  __build.setBuilt(__build.membersOf(S.id).list.filter((m) => m.parent === pid && m.kind === 'decking' && m.row <= 3).map((m) => m.id), true);
  return { id: S.id, attach: d.attach, top, before: g0, near: __game.groundAt(x, z, top + 0.2), far: __game.groundAt(x2, z2, top + 0.2), x: (x + x2) / 2, z: (z + z2) / 2 }; });
check('a free-standing deck is a structure of its own', !!fr && fr.attach === null, made + ' ' + JSON.stringify(fr));
check('its boards are walked on as they go down', !!fr && fr.before < fr.top - 0.05 && Math.abs(fr.near - fr.top) < 1e-6 && fr.far < fr.top - 0.05, JSON.stringify(fr));

// Select: point at the deck and click it; Delete takes it away; undo brings it back
await G(() => __build.setTool('select'));
await G((fr) => { const P = __game.player; P.x = fr.x + 4; P.z = fr.z + 4; P.y = __game.heightAt(P.x, P.z); }, fr); await t.frames(30);
const at = await G((fr) => { const v = new __game.THREE.Vector3(fr.x, fr.top, fr.z).project(__game.camera), r = document.getElementById('view').getBoundingClientRect(); return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height]; }, fr);
await t.page.mouse.move(at[0], at[1]); await t.frames(3);
const at2 = await G((fr) => { const v = new __game.THREE.Vector3(fr.x, fr.top, fr.z).project(__game.camera), r = document.getElementById('view').getBoundingClientRect(); return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height]; }, fr);
await t.page.mouse.move(at2[0], at2[1]); await t.frames(2);
await t.page.mouse.click(at2[0], at2[1]); await t.frames(2);
const sel = await G(() => ({ sel: __buildExt.selected(), hov: __build.state.hoverId, tool: __build.state.tool, on: __build.state.on, strip: JSON.stringify(__build.view().groups) }));
check('Select picks the deck with the pointer, its inspector shows', !!sel.sel && sel.sel.ext === 'deck' && /Deck/.test(sel.strip) && /Joists/.test(sel.strip), JSON.stringify({ ...sel, strip: undefined, at: at2 }));
await t.page.keyboard.press('Delete'); await t.frames(2);
check('Delete removes it (and its structure)', !(await G((id) => __build.state.structs.some((S) => S.id === id), fr.id)));
await G(() => __build.choose('undo')); await t.frames(2);
check('undo brings it back', await G((id) => !!__build.getExt(id, 'deck'), fr.id));

// save and reload
await G(() => __build.save()); await t.frames(2);
await t.reload(); await t.frames(20);
const back = await G(([sid, fid]) => ({ a: (__build.getExt(sid, 'deck') || []).length, f: (__build.getExt(fid, 'deck') || []).length, piece: !!__build.pieces().find((p) => p.type === 'deck' && p.struct === fid) }), [sid, fr.id]);
check('both decks survive a reload', back.a === 1 && back.f === 1 && back.piece, JSON.stringify(back));
await t.finish();
