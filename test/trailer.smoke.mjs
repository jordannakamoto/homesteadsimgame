// Browser smoke test of the trailer: node test/trailer.smoke.mjs  (needs dist/index.html and Playwright)
// A trailer comes with the starter ATV; backing the ball onto its tongue hitches it; it follows and swings behind;
// holding R unhitches while seated; lumber loads onto its bed by holding at a pile, rides with it, the build can draw from it,
// and holding the left button tips the load off as a pile on the ground. The construction ledger balances throughout.
import { openPage } from './helpers/page.mjs';
const T = await openPage();   // 640x360, Low quality locked, fonts blocked, errors collected
const { page, browser, errors, fails, check, G } = T;
const frames = async (n) => { const f0 = await G(() => __game.renderer.info.render.frame); for (let i = 0; i < 400; i++) { await page.waitForTimeout(100); if ((await G(() => __game.renderer.info.render.frame)) - f0 >= n) return; } throw new Error('page stopped rendering'); };

await T.load();   // waits for the game object, not a fixed 8 s
await frames(40);
const st = await G(() => { const u = __game.sim.state.sys.vehicles.units; return Object.values(u).map((q) => ({ id: q.id, kind: q.kind, x: q.x, z: q.z, yaw: q.yaw })); });
const atv = st.find((q) => q.kind === 'atv'), tr = st.find((q) => q.kind === 'trailer_small');
check('a trailer comes with the starter ATV', !!atv && !!tr, JSON.stringify(st));
if (!atv || !tr) { console.log(errors); process.exit(1); }

// get on, then back onto the tongue: put the ATV a metre in front of the tongue, lined up, and reverse
await G(({ a, t }) => {
  const K = __vehicles.kinds(), ball = K.atv.points.find((q) => q.type === 'ball').at[2], Lh = K.trailer_small.hitch.at[2];
  const tu = __game.sim.state.sys.vehicles.units[t], tx = tu.x + Math.sin(tu.yaw) * Lh, tz = tu.z + Math.cos(tu.yaw) * Lh;
  const d = -ball + 1.0, u = __game.sim.state.sys.vehicles.units[a];
  u.x = tx + Math.sin(tu.yaw) * d; u.z = tz + Math.cos(tu.yaw) * d; u.yaw = tu.yaw + 0.1;
}, { a: atv.id, t: tr.id });
await frames(5);
await G((a) => __vehicles.mount(a), atv.id);
await frames(30);
// reverse: point the camera along the nose and hold S
await G((a) => { __game.cam.yaw = __vehicles.body(a).yaw + Math.PI; }, atv.id);
let hitched = false, sawGuide = false;
await page.keyboard.down('KeyS');
for (let i = 0; i < 40 && !hitched; i++) {
  await frames(4);
  const r = await G(() => ({ h: !!__game.sim.state.sys.vehicles.units[__vehicles.driven()].towing, g: __game.scene.children.some((c) => c.isLine && c.visible) }));
  hitched = r.h; sawGuide = sawGuide || r.g;
}
await page.keyboard.up('KeyS');
check('backing the ball onto the tongue hitches it, with a guide line on the way', hitched && sawGuide, JSON.stringify({ hitched, sawGuide }));
if (!hitched) await G(() => __vehicles.hitch());

// tow it forward and round a bend: it follows on the ball, swung behind
await G((a) => { __game.cam.yaw = __vehicles.body(a).yaw + Math.PI; }, atv.id);
const t0 = await G((t) => __vehicles.body(t), tr.id);
await page.keyboard.down('KeyW'); await frames(40); await page.keyboard.down('KeyD'); await frames(25); await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW');
await page.keyboard.down('Space'); await frames(60); await page.keyboard.up('Space');
const pair = await G(({ a, t }) => {
  const A = __vehicles.body(a), B = __vehicles.body(t), K = __vehicles.kinds(), ball = K.atv.points.find((q) => q.type === 'ball').at[2], Lh = K.trailer_small.hitch.at[2];
  const bx = A.x + Math.sin(A.yaw) * ball, bz = A.z + Math.cos(A.yaw) * ball, tx = B.x + Math.sin(B.yaw) * Lh, tz = B.z + Math.cos(B.yaw) * Lh;
  return { gap: Math.hypot(bx - tx, bz - tz), moved: 0, B, sim: __game.sim.state.sys.vehicles.units[t] };
}, { a: atv.id, t: tr.id });
const movedT = Math.hypot(pair.B.x - t0.x, pair.B.z - t0.z);
check('the trailer follows on the ball', movedT > 3 && pair.gap < 0.1 && Math.abs(pair.B.speed) < 1.5, 'moved ' + movedT.toFixed(1) + ' m, gap ' + pair.gap.toFixed(3) + ', speed ' + pair.B.speed.toFixed(2));
check('its pose reaches the sim', Math.hypot(pair.sim.x - pair.B.x, pair.sim.z - pair.B.z) < 2.5, JSON.stringify(pair.sim).slice(0, 100));

// lumber: order the shed's lumber to a pile right by the trailer, then hold at the pile to load it
await G(() => { __game.sim.state.sys.stock.money = 20000; });
const pile = await G(({ t }) => {
  const s = __game.sim.state.sys.construction, B = __vehicles.body(t);
  const sys = __game.sim.systems.find((q) => q.name === 'construction'), SUPimb = sys.api.imbalance;
  // a ground stack of studs beside the trailer, bought through the supply ledger as a delivery would be
  const L = s.ledger.lumber_2x4 || (s.ledger.lumber_2x4 = { bought: 0, used: 0, spent: 0 });
  L.bought += 60;
  const x = B.x + Math.cos(B.yaw) * 2.6, z = B.z - Math.sin(B.yaw) * 2.6;
  s.stacks.push({ id: 'sT1', itemId: 'lumber_2x4', qty: 60, x, z });
  return { x, z, imb: JSON.stringify(SUPimb(s)) };
}, { t: tr.id });
await page.keyboard.press('KeyE'); for (let i = 0; i < 30 && (await G(() => __game.control.top().id)) !== 'walk'; i++) await frames(10);   // step off
check('E steps off with the trailer still on', await G(({ t }) => __game.control.top().id === 'walk' && !!__game.sim.state.sys.vehicles.units[t].towedBy, { t: tr.id }));
await G((p) => { const P = __game.player; P.x = p.x + 1.0; P.z = p.z + 0.3; P.y = __game.groundAt(P.x, P.z, P.y + 2); __game.player.tool = 'axe'; }, pile);
await frames(10);
const ctx0 = await G(() => { const c = __construct.context(); return c && { kind: c.kind, trailer: c.trailer, stack: c.stack && c.stack.id }; });
check('at the pile, the trailer is offered', !!ctx0 && ctx0.kind === 'pick' && ctx0.trailer === tr.id, JSON.stringify(ctx0));
await page.keyboard.down('KeyE'); await frames(70); await page.keyboard.up('KeyE'); await frames(30);
const loaded = await G(({ t }) => { const s = __game.sim.state.sys.construction; const k = s.stacks.find((q) => q.carrier === t); return { k, bed: __vehicles.bed(t), imb: JSON.stringify(__game.sim.systems.find((q) => q.name === 'construction').api.imbalance(s)) }; }, { t: tr.id });
check('holding at the pile streams studs onto the bed', !!loaded.k && loaded.k.qty >= 9 && loaded.bed.pieces >= 3 && loaded.bed.kg > 10, JSON.stringify(loaded).slice(0, 220));
check('the ledger balances after loading', loaded.imb === pile.imb, loaded.imb + ' vs ' + pile.imb);

// get back on, drive a little: the load rides along; tip it off behind
await G((a) => { __vehicles.mount(a); }, atv.id); await frames(40);
await G((a) => { __game.cam.yaw = __vehicles.body(a).yaw + Math.PI; }, atv.id);
await page.keyboard.down('KeyW'); await frames(50); await page.keyboard.up('KeyW'); await page.keyboard.down('Space'); await frames(50); await page.keyboard.up('Space');
await frames(40);
const rode = await G(({ t }) => { const s = __game.sim.state.sys.construction, k = s.stacks.find((q) => q.carrier === t), u = __game.sim.state.sys.vehicles.units[t]; return { k, u }; }, { t: tr.id });
check('the load follows the trailer', !!rode.k && Math.hypot(rode.k.x - rode.u.x, rode.k.z - rode.u.z) < 0.05 && Math.hypot(rode.k.x - pile.x, rode.k.z - pile.z) > 1, JSON.stringify(rode).slice(0, 200));
await G(() => __vehicles.tip(true)); await frames(150); await G(() => __vehicles.tip(false)); await frames(60);
const tipped = await G(({ t }) => { const s = __game.sim.state.sys.construction; return { on: s.stacks.filter((q) => q.carrier === t).length, ground: s.stacks.filter((q) => q.itemId === 'lumber_2x4' && !q.carrier).map((q) => q.qty), bed: __vehicles.bed(t), imb: JSON.stringify(__game.sim.systems.find((q) => q.name === 'construction').api.imbalance(s)) }; }, { t: tr.id });
check('holding the left button tips the load off as a pile', tipped.on === 0 && tipped.ground.length >= 1, JSON.stringify(tipped));
check('the ledger balances after tipping', tipped.imb === pile.imb, tipped.imb);
await page.keyboard.down('KeyR'); await frames(60); await page.keyboard.up('KeyR'); await frames(10);
check('holding R unhitches while seated', await G(({ t }) => !__game.sim.state.sys.vehicles.units[t].towedBy, { t: tr.id }));
const cost = await G(() => __vehicles.stats());
console.log('frame cost', JSON.stringify(cost));
check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await page.screenshot({ path: 'dist/trailer-smoke.png' });
await browser.close();
if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
console.log('\nall passed');
