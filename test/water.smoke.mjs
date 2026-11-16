// First Water smoke test, with real pointer input: node test/water.smoke.mjs  (needs dist/index.html and Playwright)
// pump the can full by hand -> open the kit -> pick up the valve and fit it on the barrel -> (the rest of the run
// by command) -> open the valve and the tap by clicking them -> water runs. Screenshots go to /tmp/fw-*.png.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html#seed-4242';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage(); page.setDefaultTimeout(180000);
const errors = [], fails = [];
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const G = (fn, arg) => page.evaluate(fn, arg);
const frames = async (n) => { const f0 = await G(() => __game.renderer.info.render.frame); for (let i = 0; i < 400; i++) { await page.waitForTimeout(200); if ((await G(() => __game.renderer.info.render.frame)) - f0 >= n) return; } throw new Error('page stopped rendering'); };
const shot = (name) => page.screenshot({ path: '/tmp/fw-' + name + '.png' });
const until = async (fn, arg, tries = 200) => { for (let i = 0; i < tries; i++) { if (await G(fn, arg)) return true; await page.waitForTimeout(250); } return false; };

await page.goto(file, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(8000);
await G(() => { __game.lockQuality(); __game.setQuality('low'); __game.setSpeed(1); }); await frames(4);
check('a new plot has the yard: well, pump, barrel, tap, bench and a kit', await until(() => !!(window.__waterHands && __waterHands.yard && __waterHands.yard.bench && Object.keys(__game.sim.state.sys.plumbing.kits).length === 1)));
check('the pump is already piped into the barrel', await G(() => __game.sim.state.sys.plumbing.pieces.some((p) => p.kind === 'pipe' && p.from.port === 'out' && p.to.port === 'in')) || await G(() => { __game.sim.commandNow('plumbing.sync', {}); return __game.sim.state.sys.plumbing.pieces.length >= 2; }));
// stand by the pump, hands out
const stand = async (dx, dz, faceYaw) => { await G(([dx, dz, yaw]) => { const Y = __waterHands.yard, P = __game.player; P.x = Y.well.x + dx; P.z = Y.well.z + dz; __game.cam.yaw = yaw; __game.cam.tx = P.x; __game.cam.tz = P.z; }, [dx, dz, faceYaw]); await frames(6); };
await stand(-0.9, 1.3, 0.5);
await page.keyboard.press('KeyF'); await frames(8);
check('F takes the hands out and the hint line says what to do', await G(() => __reach.on && !document.getElementById('reachhint').hidden));
const aim = async (name) => { const w = await G((n) => __waterHands.where(n), name); await page.mouse.move(w.screen.x, w.screen.y); await frames(3); return w.screen; };
await aim('pump');
check('aiming at the handle explains the gesture', /down and up/.test(await G(() => document.getElementById('reachhint').textContent)), await G(() => document.getElementById('reachhint').textContent));
await shot('1-pump');
await page.mouse.down();
check('holding the handle pumps: dry strokes, then the can fills', await until(() => __game.sim.state.sys.garden.can.litres >= 2, null, 1200), 'can ' + await G(() => __game.sim.state.sys.garden.can.litres) + ' L');
await shot('2-pumping');
await page.mouse.up(); await frames(3);
const led = await G(() => ({ well: __game.sim.state.sys.water.totals.wellL, can: __game.sim.state.sys.garden.can.litres }));
check('every litre in the can came out of the well', led.well >= led.can && led.can > 0, JSON.stringify(led));
// lever to the barrel, pump again
const lv = await aim('lever'); await page.mouse.down(); await page.mouse.up(); await frames(4);
check('the lever sends water up to the barrel', await G(() => __game.sim.state.sys.water.pumps[__waterHands.yard.pump.id].divert === 'tank'), JSON.stringify(lv));
await aim('pump'); await page.mouse.down();
check('strokes now fill the barrel', await until(() => __game.sim.state.sys.water.tanks[__waterHands.yard.barrel.id].storedL >= 2, null, 1200));
await page.mouse.up(); await frames(3);
// the kit
await stand(2.2, 2.9, 3.4);
await aim('kit'); await page.mouse.down(); await page.mouse.up();
check('clicking the box tips the kit out as loose parts', await until(() => Object.values(__game.sim.state.sys.parts.parts).filter((p) => !p.fixed).length === 13));
await until(() => __waterHands.view.stats().flyers === 0); await frames(20);
await shot('3-kit');
// pick the valve up off the bench with a click
const valve = await G(() => { const p = Object.values(__game.sim.state.sys.parts.parts).find((q) => q.kind === 'valve'); return { id: p.id, s: __waterHands.screen(p.pose.x, p.pose.y + 0.05, p.pose.z) }; });
await page.mouse.move(valve.s.x, valve.s.y); await frames(3);
const hov = await G(() => __waterHands.view.stats().hover);
await page.mouse.down(); await page.mouse.up(); await frames(4);
check('a click picks a small part out of the pile', (await G(() => __waterHands.view.held())) !== null, 'hovered ' + hov + ', valve is ' + valve.id + ', held ' + await G(() => __waterHands.view.held()));
const heldId = await G(() => __waterHands.view.held());
// carry it to the barrel outlet and click it on
await stand(1.3, 1.5, 0.3);
const out = await G(() => { const w = __waterHands.view.endWorld([5, 6, 2]); return __waterHands.screen(w.x, w.y, w.z); });
await page.mouse.move(out.x, out.y); await frames(4);
check('near an open end a ghost shows it already turned to fit', await G(() => __waterHands.view.stats().ghost), await G(() => document.getElementById('reachhint').textContent));
await shot('4-ghost');
await page.mouse.down(); await page.mouse.up(); await frames(6);
check('a click fits it: it is now fixed on the lattice', await G((id) => { const p = __game.sim.state.sys.parts.parts[id]; return !!p && !!p.at; }, heldId), JSON.stringify(await G((id) => __game.sim.state.sys.parts.parts[id], heldId)));
// the rest of the run by command (the unit tests cover the geometry), then finish by hand
const built = await G((first) => {
  const sim = __game.sim, api = sim.systems.find((s) => s.name === 'parts').api, S = () => sim.state.sys.parts, K = api.kinds;
  const loose = (kind) => Object.values(S().parts).find((p) => p.kind === kind && !p.at && !p.fixed);
  const put = (kind, on, leave, len) => {
    let part = kind === first.kind && !first.used ? ((first.used = true), S().parts[first.id]) : loose(kind);
    if (part.at) return part.id;
    const end = api.graph(S()).open.find((e) => e.part === on);
    if (len && len < part.len) sim.commandNow('parts.cut', { id: part.id, len });
    const ways = api.placements(S(), kind, part.len, end, part.id);
    const w = ways.find((x) => !leave || K[kind].ends.some((e) => api.rotate(x.rot, e.dir).join() === leave.join() && e.id !== x.end)) || ways[0];
    const r = sim.commandNow('parts.fit', { id: part.id, at: w.at, rot: w.rot });
    if (!r.ok) throw new Error(kind + ': ' + r.reason);
    return part.id;
  };
  const kindOfFirst = S().parts[first.id].kind;
  first.kind = kindOfFirst;
  const v = kindOfFirst === 'valve' ? first.id : put('valve', 'y:bout');
  const s1 = put('pipe', v, null, 1), e1 = put('elbow', s1, [0, -1, 0]), d = put('pipe', e1, null, 5), e2 = put('elbow', d, [-1, 0, 0]);
  const h = put('pipe', e2, null, 6), c = put('coupling', h), h2 = put('pipe', c, null, 2), e3 = put('elbow', h2, [0, 0, 1]);
  const g = put('pipe', e3, null, 6), e4 = put('elbow', g, [0, 1, 0]), up = put('pipe', e4, null, 2);
  sim.commandNow('plumbing.sync', {});
  const w = api.toWorld(S(), S().parts[v].at);
  return { v, run: sim.state.sys.plumbing.pieces.find((p) => p.kind === 'pipe' && p.to.port === 'in' && p.from.port === 'out' && p.valves), valveAt: __waterHands.screen(w.x, w.y + 0.1, w.z), up };
}, { id: heldId });
check('the fitted run reaches the tap, valve still shut', !!built.run && built.run.shut === true, JSON.stringify(built.run && { len: built.run.lengthM, shut: built.run.shut }));
// tap first: it must say why nothing comes
await stand(-1.6, 3.3, 3.6);
await aim('tap'); await page.mouse.down(); await page.mouse.up();
check('tap open, valve shut: the game says why no water comes', await until(() => /valve is closed/.test(document.getElementById('reachhint').textContent), null, 120), await G(() => document.getElementById('reachhint').textContent));
// open the valve by clicking it
await stand(1.3, 1.5, 0.3);
const vs = await G((id) => { const api = __game.sim.systems.find((s) => s.name === 'parts').api, p = __game.sim.state.sys.parts.parts[id], w = api.toWorld(__game.sim.state.sys.parts, p.at); return __waterHands.screen(w.x, w.y + 0.02, w.z); }, built.v);
await page.mouse.move(vs.x, vs.y); await frames(3);
await page.mouse.down(); await page.mouse.up(); await frames(3);
check('clicking the valve opens it', await G((id) => __game.sim.state.sys.parts.parts[id].set.open === true, built.v), await G(() => document.getElementById('reachhint').textContent));
check('water runs at the tap', await until(() => __game.sim.state.sys.water.taps[__waterHands.yard.tap.id].flowLmin > 0, null, 200), JSON.stringify(await G(() => __game.sim.state.sys.water.taps[__waterHands.yard.tap.id])));
await stand(-1.6, 3.3, 3.6); await frames(6);
await shot('5-tap');
// save and reload: the run is as left
await G(() => __game.saveGame());
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(8000);
check('after a reload the run is as it was left', await until((id) => { const p = window.__game && __game.sim.state.sys.parts.parts[id]; return !!p && !!p.at && !!(window.__waterHands && __waterHands.yard); }, built.up));
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(fails.length ? 'FAILED: ' + fails.join('; ') : 'First Water smoke passed');
process.exit(fails.length ? 1 : 0);
