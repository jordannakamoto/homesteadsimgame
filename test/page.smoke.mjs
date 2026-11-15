// Browser smoke test of the built page: node test/page.smoke.mjs  (needs dist/index.html and Playwright)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const G = (fn, arg) => page.evaluate(fn, arg);
const frames = async (n) => { const f0 = await G(() => __game.renderer.info.render.frame); for (let i = 0; i < 240; i++) { await page.waitForTimeout(250); if ((await G(() => __game.renderer.info.render.frame)) - f0 >= n) return; } throw new Error('page stopped rendering'); };

await page.goto(file); await page.waitForTimeout(5000);
check('page loads and exposes the game', await G(() => !!(window.__game && __game.sim && window.__build)));
await G(() => __game.setQuality('low')); await frames(3);
check('low quality renders', (await G(() => document.getElementById('quality').textContent)) === 'Low');
await G(() => __game.setQuality('high')); await frames(3);
check('high quality renders', (await G(() => document.getElementById('quality').textContent)) === 'High');
await G(() => __game.lockQuality()); await G(() => __game.setQuality('low'));

// time controls
await page.click('#speed button[data-speed="0"]'); const t0 = await G(() => __game.sim.state.tick); await frames(4);
check('pause stops world time', (await G(() => __game.sim.state.tick)) === t0);
await page.click('#speed button[data-speed="1000"]'); await frames(12);
const t1 = await G(() => __game.sim.state.tick);
check('1000x runs world time', t1 > t0 + 20, 'ticks ' + (t1 - t0));
await page.click('#speed button[data-speed="1"]');
const before = await G(() => __game.world.time); await G(() => { __game.world.time = 0.5; });
check('setting the time of day moves forward to noon', Math.abs((await G(() => __game.world.time)) - 0.5) < 0.002 && (await G(() => __game.sim.state.tick)) > t1, 'was ' + before.toFixed(3));

// build mode opens and a room yields pieces
await page.keyboard.press('KeyB'); await frames(3);
check('build mode opens', await G(() => __game.player.tool === 'build' && !document.getElementById('buildbar').hidden));
check('piece list is available', Array.isArray(await G(() => __build.pieces())));
await page.keyboard.press('KeyB'); await frames(2);

// save, change the world, reload: same world comes back
await G(() => { const g = __game; g.editSet(3, 3, 1.25); g.world.wood = 17; g.player.x = 9; g.player.z = -4; g.saveGame(); });
const saved = await G(() => ({ hash: __game.sim.hash(), tick: __game.sim.state.tick, seed: __game.seed }));
await page.reload(); await page.waitForTimeout(5000);
const back = await G(() => ({ hash: __game.sim.hash(), tick: __game.sim.state.tick, seed: __game.seed, wood: __game.world.wood, edit: __game.editGet(3, 3), x: __game.player.x, day: document.getElementById('day').textContent }));
check('reload restores the same world', back.seed === saved.seed && back.wood === 17 && Math.abs(back.edit - 1.25) < 1e-6 && back.tick >= saved.tick && back.tick - saved.tick < 400, JSON.stringify(back));

// frame cost of the simulation at top speed
const cost = await G(() => { const g = __game; g.setSpeed(1000); const t = performance.now(); for (let i = 0; i < 200; i++) g.sim.advance(1 / 144 * 72 * 1000, 24); return (performance.now() - t) / 200; });
check('simulation costs well under a frame at 1000x', cost < 1, cost.toFixed(4) + ' ms per frame');
check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await page.screenshot({ path: 'dist/smoke.png' });
await browser.close();
if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
console.log('\nall passed');
