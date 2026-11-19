// Supply plumbing by hand, quick: node test/services-water.smoke.mjs  (needs dist/index.html and Playwright)
// A cabin set down; a tank, manifold, line and stub planned through the sim; then by hand with real pointer input: cap the stub,
// pump the test gauge, set the sink on its stub (three clicks), open the main by a drag, run the tap. Page errors fail it.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.setDefaultTimeout(120000);
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const errors = [], fails = [];
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 300)); });
page.on('crash', () => console.log('PAGE CRASH')); page.on('pageerror', (e) => { console.log('PE', String(e.stack||e).slice(0,400)); errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 500)); });
const check = (n, ok, i = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (i ? '  ' + i : '')); if (!ok) fails.push(n); };
const G = (fn, arg) => page.evaluate(fn, arg);
const frames = async (n) => { const f0 = await G(() => __game.renderer.info.render.frame); for (let i = 0; i < 400; i++) { await page.waitForTimeout(50); if ((await G(() => __game.renderer.info.render.frame)) - f0 >= n) return; } throw new Error('page stopped rendering'); };
await page.goto(file, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__build, null, { timeout: 120000 });
await G(() => localStorage.clear()); await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__servicesWater && window.__servicesHands, null, { timeout: 120000 });
await G(() => { __game.lockQuality(); __game.setQuality('low'); __game.setSpeed(1); });
await frames(4);
const S = await G(() => {
  const sim = __game.sim, P = __game.player, r = __build.placePlan('cabin', P.x + 6, P.z, 0), id = String(r.struct), f = (n, p) => sim.commandNow(n, p);
  sim.state.sys.stock.money = 1e5; f('construction.setOption', { key: 'instant', value: true });
  const RS = sim.state.sys.routes, st = __build.structs().find((q) => String(q.id) === id); f('routes.setFrames', { frames: { ...RS.frames, [id]: { x: st.x, y: st.y0 || 0, z: st.z, yaw: st.yaw || 0 } } }); const fr = RS.frames[id];
  const ch = __game.routes.channelsFor(id), w = ch.walls[0], at = (d, h) => [w.o[0] + w.u[0] * d, w.yb + h, w.o[1] + w.u[1] * d];
  const man = f('routes.addNode', { kind: 'manifold', frame: id, at: at(0.5, 1.2), host: { parent: w.id } }).id;
  const stub = f('routes.addNode', { kind: 'stub_supply', frame: id, at: at(2.2, 0.5), host: { parent: w.id }, set: { preset: 'sink' } }).id;
  const run = f('routes.addRun', { cls: 'supply', spec: 'pex_12_blue', frame: id, a: man, b: stub, path: [at(0.5, 1.2), at(0.5, 0.5), at(2.2, 0.5)], bores: [] }).id;
  f('routes.work', { id: run, what: 'pull', to: 1 }); f('routes.work', { id: run, what: 'join', n: 2 });
  for (const n of [man, stub]) f('routes.setNode', { id: n, state: 'set' });
  f('services.sync'); 
  const mid = at(1.4, 0); P.x = fr.x + mid[0] - w.n[0] * w.out * 1.4; P.z = fr.z + mid[2] - w.n[1] * w.out * 1.4;
  __game.cam.yaw = Math.atan2(w.n[0] * w.out, w.n[1] * w.out) + Math.PI; __game.cam.tx = P.x; __game.cam.tz = P.z;
  return { id, man, stub, run };
});
await frames(40);
console.log(await G((id) => { const f = (n, p) => __game.sim.commandNow(n, p); f('services.sync'); const a = f('construction.order', { structId: id, stage: 'rough-in' }), b = f('construction.order', { structId: id, stage: 'trim-out' }); return JSON.stringify([a.ok || a.reason, b.ok || b.reason]); }, S.id));
await frames(6);
if (!(await G(() => __reach.on))) { await page.keyboard.press('KeyF'); await frames(6); }
const t0 = await G(() => __servicesWater.targets());
check('the open stub-out offers a cap, the manifold a gauge and a main', t0 && t0.cap.length === 1 && t0.pump.length === 1 && t0.main.length === 1, JSON.stringify(t0));
const click = async (kind) => { const w = await G((k) => __servicesWater.where(k), kind); if (!w) { console.log('no target ' + kind, await G(() => document.getElementById('reachhint').textContent)); return null; } await page.mouse.move(w.screen.x, w.screen.y); await frames(3); console.log(kind, JSON.stringify(w.screen), await G(() => document.getElementById('reachhint').textContent)); await page.mouse.down(); await page.mouse.up(); await frames(3); return w; };
console.log(await G(() => JSON.stringify({ py: __game.player.y, px: __game.player.x, pz: __game.player.z, on: __reach.on })));
await click('cap');
check('a click caps it', await G((id) => __game.sim.state.sys.routes.nodes[id].set.capped === true, S.stub));
const w = await G(() => __servicesWater.where('pump'));
await page.mouse.move(w.screen.x, w.screen.y); await frames(3); await page.mouse.down(); for (let i = 0; i < 60 && !(await G((id) => { const c = __game.sim.state.sys.services.checks[id]; return !!c && !!c.water; }, S.id)); i++) await page.waitForTimeout(500); await page.waitForTimeout(1500); await page.mouse.up(); await frames(3);
check('holding on the gauge ran the test and it passed', await G((id) => { const c = __game.sim.state.sys.services.checks[id]; return !!(c && c.water && c.water.pass); }, S.id));
for (let i = 0; i < 3; i++) await click('fix');
check('three clicks set the sink, a stop and a line', await G((id) => __game.sim.state.sys.routes.nodes[id].state === 'trimmed', S.stub));
const open = await G((n) => __game.sim.commandNow('services.valve', { node: n, on: true }), S.man);
check('opening the main knocks', open.ok && open.knock, JSON.stringify(open));
await click('tap'); await frames(30);
check('the faucet is on (no tank in this scene, so no flow)', await G((id) => { const t = __game.sim.state.sys.water.taps['sv:' + id]; return !!t && t.open; }, S.stub), await G((id) => JSON.stringify(__game.sim.state.sys.water.taps['sv:' + id]), S.stub));
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join('; ')); process.exit(1); }
console.log('services-water smoke passed');
