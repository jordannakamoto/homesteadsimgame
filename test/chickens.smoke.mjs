// Browser check of the chickens view: node test/chickens.smoke.mjs  (needs dist/index.html and Playwright)
// Sets up a coop, buys a mixed flock, does the chores, and takes screenshots by day, at the feeder and at night.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const out = process.env.SHOTS || 'dist';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 500)));
const G = (fn, a) => page.evaluate(fn, a);
const wait = (ms) => page.waitForTimeout(ms);
page.setDefaultTimeout(120000);
await page.goto('file://' + process.cwd() + '/dist/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await wait(8000);
await G((Q) => { __game.lockQuality(); __game.setQuality(Q); __game.setSpeed(1); document.getElementById('help').hidden = true; }, process.env.Q || 'low');
await page.keyboard.press('KeyH'); await wait(300);
await page.$eval('#ckbody button[data-act="starter"]', (b) => b.click()); await wait(200);
await G(() => { const s = __game.sim; s.commandNow('chickens.buy', { breed: 'rir', count: 2, ageWeeks: 30 }); s.commandNow('chickens.buy', { breed: 'leghorn', count: 1, ageWeeks: 30 }); s.commandNow('chickens.buy', { breed: 'rock', count: 1, ageWeeks: 30 }); s.commandNow('chickens.buy', { breed: 'australorp', count: 1, ageWeeks: 30 }); s.commandNow('chickens.buy', { breed: 'wyandotte', count: 1, ageWeeks: 30 }); s.commandNow('chickens.buy', { breed: 'pekin', count: 1, ageWeeks: 30 }); s.commandNow('chickens.buy', { breed: 'rir', count: 1, ageWeeks: 40, sex: 'rooster' }); });
await page.$eval('#ckbody button[data-act="feed"]', (b) => b.click()); await wait(100);
await page.$eval('#ckbody button[data-act="water"]', (b) => b.click()); await wait(300);
await page.screenshot({ path: out + '/ck-panel.png' });
await page.keyboard.press('Escape');
// frame the coop: camera close, looking at it
const frameCoop = async (dist, pitch, side = 0.6) => G(([d, p, sd]) => { const g = __game, own = g.sim.state.sys.chickens.own[0]; const c = g.cam; c.dist = d; c.pitch = p; const f = own.yawRad; g.pm.root.visible = false; document.getElementById('lock').hidden = true; g.player.x = own.a.x + Math.sin(f) * 1.6; g.player.z = own.a.z + Math.cos(f) * 1.6; c.yaw = f + sd; c.prevYaw = c.yaw; }, [dist, pitch, side]);
await G(() => { __game.world.time = 0.4; }); await wait(6000);
await frameCoop(9, 0.5); await wait(2500);
await page.screenshot({ path: out + '/ck-day.png' });
// at the feeder: fill it and look close
await G(() => __game.sim.commandNow('chickens.fillFeeder', {}));
await G(() => { __game.sim.commandNow('chickens.buySupply', { id: 'layer_feed', qty: 5 }); });
await wait(300); await G(() => { __game.sim.state.sys.chickens.fx.ck3.feedKg = 2; __game.sim.commandNow('chickens.fillFeeder', {}); });
await frameCoop(5, 0.42); await wait(4000);
await page.screenshot({ path: out + '/ck-feeder.png' });
const info = await G(() => ({ v: __chickensView.info(), pos: __chickensView.positions().slice(0, 3), phase: Object.values(__game.sim.state.sys.chickens.birds).map((b) => b.phase), eggs: __game.sim.state.sys.chickens.eggs.length, cost: __chickensView.bench(300) }));
console.log(JSON.stringify(info));
// night: skip to late evening, let them go to roost
await G(() => { __game.world.time = 0.92; }); await wait(5000);
await frameCoop(5, 0.35); await wait(3000);
await page.screenshot({ path: out + '/ck-night.png' });
console.log(JSON.stringify(await G(() => Object.values(__game.sim.state.sys.chickens.birds).map((b) => b.phase + ':' + b.mood))));
// next morning: eggs in the nest box
await G(() => { __game.world.time = 0.42; }); await wait(5000);
await frameCoop(4, 0.6); await wait(2500);
await page.screenshot({ path: out + '/ck-morning.png' });
console.log('eggs waiting', await G(() => __game.sim.state.sys.chickens.eggs.length), 'issues', JSON.stringify(await G(() => __game.sim.state.sys.chickens.issues.map((i) => i.id))));
console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
