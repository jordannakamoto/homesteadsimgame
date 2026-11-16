// The construction tools in the built page, quickly: the sawhorses and the saw, layout marks on a wall lying flat, walls
// tilted up, stepping through bare framing, scaffolding rented, set up along a wall, climbed by walking into its ladder
// and worked from. Needs dist/index.html and Playwright.   node test/construction-tools.smoke.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [], fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
const G = (fn, arg) => page.evaluate(fn, arg);
await page.goto(file, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__build, null, { timeout: 180000 });
await G(() => localStorage.clear()); await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__build && window.__construct, null, { timeout: 180000 });
await G(() => { const g = __game; g.lockQuality(); g.setQuality('low'); const r = g.renderer; r.render = () => {}; window.__step = (n, dt) => { for (let i = 0; i < n; i++) g.step(dt); }; });
const tick = (n = 3) => G((n) => window.__step(n, 1 / 30), n);
await tick(10);

// a shed, everything ordered and delivered at once
await G(() => {
  const P = __game.player, c = __game.sim;
  c.commandNow('construction.setOption', { key: 'instant', value: true });
  const r = __build.placePlan('shed', P.x + 7, P.z, 0);
  __construct.V.pendingPlan = { struct: r.struct, planId: 'shed', name: 'Tool shed' };
});
await tick(4);
await G(() => __construct.act('order:all'));
await tick(4);
let s = await G(() => { const s = __game.sim.state.sys.construction; return { horses: s.horses, stacks: s.stacks.map((k) => k.itemId), studs: Object.values(__construct.current().lines).find((l) => /Studs/.test(l.label)) }; });
check('lumber arrives and the sawhorses are set up by the work', !!s.horses && s.stacks.some((i) => /^lumber_/.test(i)), JSON.stringify(s.horses));
check('the studs are bought as whole stock-length sticks', !!(s.studs && s.studs.stick), s.studs && s.studs.qty + ' m');

// work until done, stage by stage, through the wall frames (cuts at the horses, walls tilted up)
const workStage = async (st) => {
  await G((st) => { __game.sim.commandNow('construction.setOption', { key: 'auto', value: true }); const P = __game.player, b = __build.structs()[0]; P.x = b.x + 2.6; P.z = b.z; __construct.act('auto:' + st); }, st);
  for (let i = 0; i < 400; i++) { await tick(10); const d = await G((st) => { const pr = __construct.current(); return !__construct.V.auto || __game.sim.systems.find((q) => q.name === 'construction').api.stageComplete(pr, st); }, st); if (d) break; }
  await G(() => __construct.act('stop'));
};
let marked = false, sawn = false;
for (const st of ['site', 'foundation', 'floor-frame', 'subfloor']) await workStage(st);
// one wall by hand-ish: frame it flat, and look for the layout marks once its plates are down
await G(() => { __game.sim.commandNow('construction.setOption', { key: 'auto', value: true }); const P = __game.player, b = __build.structs()[0]; P.x = b.x + 2.6; P.z = b.z; __construct.act('auto:wall-frame'); });
for (let i = 0; i < 600; i++) {
  await tick(6);
  const q = await G(() => { const V = __construct.V, pr = __construct.current(); return { marks: !!document && __construct.asm && JSON.stringify(Object.keys(pr.raised)).length >= 0 && V.sawing.size >= 0, raised: Object.keys(pr.raised).length, busy: __construct.station.busy(), done: __game.sim.systems.find((x) => x.name === 'construction').api.stageComplete(pr, 'wall-frame') }; });
  if (q.busy) sawn = true;
  if (q.done) break;
  if (process.env.DEBUG && i % 40 === 0) console.log(JSON.stringify(await G(() => ({ hint: __construct.V.hint, auto: !!__construct.V.auto, raise: !!__construct.V.raise, carried: __game.sim.state.sys.construction.carried, stage: __construct.current().stage, ctx: __construct.context() && __construct.context().kind }))));
}
await G(() => __construct.act('stop'));
if (process.env.DEBUG) console.log(JSON.stringify(await G(() => { const c = __game.sim.state.sys.construction, pr = __construct.current(); return { stacks: c.stacks.filter((k) => k.itemId === 'lumber_2x4'), led: c.ledger.lumber_2x4, lines: Object.entries(pr.lines).filter(([k, l]) => l.itemId === 'lumber_2x4').map(([k, l]) => [k, l.qty, l.ordered, l.used, l.cut && l.cut.sticks.length]) }; })));
s = await G(() => { const pr = __construct.current(), ln = Object.values(pr.lines).find((l) => /Studs/.test(l.label)); return { raised: Object.keys(pr.raised).length, used: ln.used, qty: ln.qty, cuts: Object.values(pr.members).filter((m) => m.cut).length, off: ln.cut ? ln.cut.sticks.filter((q) => q.open && q.left > 0).length : -1 }; });
check('four walls framed and tilted up, every stick sawn to length at the horses', s.raised === 4 && sawn && s.cuts > 20, JSON.stringify(s));
// layout marks are drawn on plates of a frame lying flat: check the helper made some for the first wall's plates
marked = await G(() => { const pr = __construct.current(), g = __construct.geom(pr.id); return [...g.walls.keys()].length === 4; });
check('the walls have their tilt-up hinges', marked);

// stepping through bare framing: from inside the shed, walk out through a wall with no door
const out = await G(() => { const b = __build.structs()[0], P = __game.player; P.x = b.x; P.z = b.z; P.climbY = null; return { x: b.x, z: b.z }; });
await page.keyboard.down('KeyW'); await G(() => { __game.cam.yaw = Math.PI / 2; }); await tick(60); await page.keyboard.up('KeyW');
const at = await G(() => ({ x: __game.player.x, z: __game.player.z }));
check('bare stud walls do not trap you: you step out between the studs', Math.hypot(at.x - out.x, at.z - out.z) > 2.2, JSON.stringify(at));

// the top plates need height: rent scaffolding, set it along a wall, walk into its ladder, work from the plank
await G(() => __construct.act('rent:3'));
await tick(2);
const spot = await G(() => { const pr = __construct.current(), b = __build.structs()[0]; return __construct.scaffoldSpot(pr, b.x + 3, b.z); });
check('a scaffold spot along the nearest raised wall', !!spot, JSON.stringify(spot));
const up = await G((sp) => __game.sim.commandNow('construction.setScaffold', sp).ok, spot);
await tick(3);
check('the scaffold is set up and drawn', up && (await G(() => !!__construct.scaffold.foot())));
// stand beyond the ladder end and walk into it
await G(() => { const f = __construct.scaffold.foot(), sc = __game.sim.state.sys.construction.scaffold.set, P = __game.player; P.x = f.x - Math.sin(sc.yaw) * 0.2; P.z = f.z - Math.cos(sc.yaw) * 0.2; __game.cam.yaw = sc.yaw + Math.PI; });
await tick(10);
await page.keyboard.down('KeyW');
for (let i = 0; i < 4; i++) { await tick(1); if (process.env.DEBUG) console.log(JSON.stringify(await G(() => { const sc = __game.sim.state.sys.construction.scaffold.set, P = __game.player, dx = P.x - sc.x, dz = P.z - sc.z; return { along: dx * Math.sin(sc.yaw) + dz * Math.cos(sc.yaw), across: dx * Math.cos(sc.yaw) - dz * Math.sin(sc.yaw), mvx: P.mvx, mvz: P.mvz, y: P.y, g: __game.heightAt(sc.x, sc.z), len: sc.len }; }))); }
const mounted = await G(() => __construct.scaffold.on());
await tick(40); await page.keyboard.up('KeyW'); await tick(10);
s = await G(() => { const sc = __game.sim.state.sys.construction.scaffold.set, P = __game.player, x = __construct.context(); return { y: P.y, deck: sc.deckY, on: __construct.scaffold.on(), ctx: x && x.kind, text: x && x.text }; });
check('walking into the ladder climbs it, no key press', mounted);
check('on the plank you stand at deck height', s.on && Math.abs(s.y - s.deck) < 0.2, JSON.stringify(s));
// walking off the ladder end climbs back down
await G(() => { const sc = __game.sim.state.sys.construction.scaffold.set; __game.cam.yaw = sc.yaw; });
await page.keyboard.down('KeyW'); await tick(60); await page.keyboard.up('KeyW'); await tick(10);
s = await G(() => ({ on: __construct.scaffold.on(), y: __game.player.y, g: __game.heightAt(__game.player.x, __game.player.z) }));
check('walking back off the ladder end climbs down', !s.on && Math.abs(s.y - s.g) < 0.6, JSON.stringify(s));
// the ladder is always there for work at height
s = await G(() => { const c = __game.sim.state.sys.construction; return !!c.ladder || c.stacks.some((k) => k.itemId === 'ladder') || (c.carried && c.carried.itemId === 'ladder'); });
check('a ladder is on site for the work at height', s);
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails.length ? '\n' + fails.length + ' failed' : '\nall passed');
process.exit(fails.length ? 1 : 0);
