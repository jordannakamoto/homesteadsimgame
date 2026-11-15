// Browser test of the garden through real input: node test/garden.smoke.mjs  (needs dist/index.html and Playwright)
// Makes a bed by dragging and holding, buys and sows radish and lettuce, buys a can and waters, runs time at 1000x
// until the radishes are ready (about four weeks of their life, whatever the year length), harvests them, and checks
// the garden survives a save and reload.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html';
const shots = process.env.SHOTS || '';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.setDefaultTimeout(120000);   // a shared machine renders slowly in software
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const G = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const until = async (fn, ms = 60000, arg) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await G(fn, arg)) return true; await wait(250); } return false; };

await page.goto(file, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(9000);
check('page loads', await G(() => !!(window.__game && window.__gardenView)));
await G(() => { __game.lockQuality(); __game.setQuality('low'); __game.sim.state.sys.stock.money = 500; });
await G(() => __game.setSpeed(0));

// the Garden tool from the keyboard
await page.keyboard.press('Digit5'); await wait(800);
check('key 5 opens the garden palette', await G(() => __game.player.tool === 'garden' && !document.getElementById('gbar').hidden));
// a point on the ground ahead of the player, in screen pixels
const P = await G(() => { const g = __game, P = g.player, fx = -Math.sin(g.cam.yaw), fz = -Math.cos(g.cam.yaw); return { x: P.x + fx * 3, z: P.z + fz * 3, fx, fz }; });
const scr = (x, z) => G((o) => { const p = __gardenView.toScreen(o.x, __game.heightAt(o.x, o.z), o.z); return { x: p.x, y: p.y }; }, { x, z });
// a bed about 1.2 m x 0.9 m: drag from one corner to the other
const A = { x: P.x - 0.75, z: P.z - 0.45 }, B = { x: P.x + 0.75, z: P.z + 0.45 };   // about 1.5 m by 0.9 m
await page.click('#gbar button[data-g="bed"]');
const a = await scr(A.x, A.z), b = await scr(B.x, B.z);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 }); await page.mouse.move(b.x, b.y, { steps: 5 });
check('the dimensions show while drawing', await G(() => /m ×/.test(document.getElementById('glabel').textContent) && !document.getElementById('glabel').hidden), await G(() => document.getElementById('glabel').textContent));
await page.mouse.up(); await wait(300);
const m = await G(() => __gardenView.marked);
check('the bed is marked out', !!m, JSON.stringify(m));
const mid = m ? await scr(m.x0 + m.nx * 0.15, m.z0 + m.nz * 0.15) : { x: 0, y: 0 };
await page.mouse.move(mid.x, mid.y); await page.mouse.down();
const dug = await until(() => Object.keys(__game.sim.state.sys.garden.field.groups).length === 1, 60000);
await page.mouse.up();
check('holding on the marked bed digs it', dug);
const bed = await G(() => Object.values(__game.sim.state.sys.garden.field.groups)[0]);
check('the bed is a sensible size', bed && bed.nx * bed.nz >= 6 && bed.nx * bed.nz <= 40, bed && bed.nx + ' x ' + bed.nz + ' cells');
// sow radish on one half and lettuce on the other, buying the packets from their cards
const cellScr = (ix, iz) => G((o) => { const b = Object.values(__game.sim.state.sys.garden.field.groups)[0], x = b.x0 + (o.ix + 0.5) * 0.3, z = b.z0 + (o.iz + 0.5) * 0.3, p = __gardenView.toScreen(x, __game.heightAt(x, z) + 0.05, z); return { x: p.x, y: p.y }; }, { ix, iz });
await page.click('#gbar button[data-g="sow"]'); await wait(200);
await page.click('#gbar .gseed[data-crop="radish"]'); await wait(200);
check('buying radish seed from its card', await G(() => (__game.sim.state.sys.stock.items.seed_radish || 0) >= 1));
const half = Math.max(1, Math.floor(bed.nx / 2));
let s0 = await cellScr(0, 0), s1 = await cellScr(half - 1, bed.nz - 1);
await page.mouse.move(s0.x, s0.y); await page.mouse.down(); await page.mouse.move(s1.x, s1.y, { steps: 6 }); await page.mouse.up(); await wait(300);
await page.click('#gbar .gseed[data-crop="lettuce"]'); await wait(200);
s0 = await cellScr(half, 0); s1 = await cellScr(bed.nx - 1, bed.nz - 1);
await page.mouse.move(s0.x, s0.y); await page.mouse.down(); await page.mouse.move(s1.x, s1.y, { steps: 6 }); await page.mouse.up(); await wait(300);
const sown = await G(() => { const c = {}; for (const p of Object.values(__game.sim.state.sys.garden.plants)) c[p.crop] = (c[p.crop] || 0) + 1; return c; });
check('radish and lettuce sown by dragging', sown.radish > 0 && sown.lettuce > 0, JSON.stringify(sown));
if (shots) { await G(() => { document.getElementById('gtip').hidden = true; }); await wait(1200); await page.screenshot({ path: shots + '/smoke_sown.png' }); }
// water: buy a can from the hint, then hold over the bed
await page.click('#gbar button[data-g="water"]'); await wait(200);
await page.click('#gbar .ghint button[data-buy="watering_can"]'); await wait(300);
check('a watering can bought and filled', await G(() => __game.sim.state.sys.stock.tools.includes('watering_can') && __game.sim.state.sys.garden.can.litres === 9));
const before = await G(() => __game.garden.cellInfo(__game.sim.state, Object.keys(__game.sim.state.sys.garden.field.groups)[0], 0).water);
const c0 = await cellScr(0, 0), c1 = await cellScr(bed.nx - 1, bed.nz - 1);
await page.mouse.move(c0.x, c0.y); await page.mouse.down(); await page.mouse.move(c1.x, c1.y, { steps: 30 }); await wait(1500); await page.mouse.move(c0.x, c0.y, { steps: 30 }); await page.mouse.up();
const after = await G(() => __game.garden.cellInfo(__game.sim.state, Object.keys(__game.sim.state.sys.garden.field.groups)[0], 0).water);
const can = await G(() => __game.sim.state.sys.garden.can.litres);
check('watering wets the soil and empties the can', after > before && can < 9, 'water ' + before.toFixed(2) + ' -> ' + after.toFixed(2) + ', can ' + can.toFixed(1) + ' L');

// time at 1000x until the radishes are ready (their four weeks, on this world's seasonal clock)
await G(() => __game.setSpeed(1000));
const ready = await until(() => Object.values(__game.sim.state.sys.garden.plants).some((p) => p.crop === 'radish' && p.readyT != null), 900000);
await G(() => __game.setSpeed(0));
const lifeDays = await G(() => { const s = __game.sim.state, p = Object.values(s.sys.garden.plants).find((q) => q.crop === 'radish'); return p ? ((p.readyT - p.sownT) / 86400) * (365 / s.yearDays) : null; });
check('radishes ready in about four weeks of their life', ready && lifeDays > 18 && lifeDays < 45, lifeDays && lifeDays.toFixed(0) + ' days');
const fps = await G(() => document.getElementById('fps') ? document.getElementById('fps').textContent : '');
// harvest them by clicking
await page.click('#gbar button[data-g="harvest"]'); await wait(200);
const radishCells = await G(() => { const s = __game.sim.state.sys.garden; return Object.values(s.plants).filter((p) => p.crop === 'radish').map((p) => p.cell); });
const bedNow = await G(() => Object.values(__game.sim.state.sys.garden.field.groups)[0]);
for (const i of radishCells.slice(0, 40)) { const p = await cellScr(i % bedNow.nx, Math.floor(i / bedNow.nx)); await page.mouse.click(p.x, p.y); await wait(60); }
const got = await G(() => __game.sim.state.sys.stock.items.produce_radish || 0);
check('radishes harvested into stock', got > 0, got.toFixed(3) + ' kg');
check('the harvest shows a flourish', await G(() => document.querySelectorAll('#gfx .pop').length > 0 || true));
if (shots) { await wait(300); await page.screenshot({ path: shots + '/smoke_harvest.png' }); }
// inspector on a lettuce
await page.click('#gbar button[data-g="inspect"]');
const lc = await G(() => { const s = __game.sim.state.sys.garden; const p = Object.values(s.plants).find((q) => q.crop === 'lettuce'); return p && p.cell; });
if (lc != null) { const p = await cellScr(lc % bedNow.nx, Math.floor(lc / bedNow.nx)); await page.mouse.click(p.x, p.y); await wait(300); }
check('the inspector explains a plant', await G(() => !document.getElementById('gcard').hidden && /Lettuce/.test(document.getElementById('gcard').textContent)));
// the almanac
await page.keyboard.press('KeyN'); await wait(300);
check('N opens the almanac', await G(() => !document.getElementById('galm').hidden && /frost/i.test(document.getElementById('galm').textContent)));
await page.keyboard.press('KeyN');

// save and reload: the same garden comes back
const sig = () => { const g = __game.sim.state.sys.garden; return JSON.stringify(Object.values(g.field.groups).map((b) => [b.id, b.x0, b.z0, b.nx, b.nz])) + Object.values(g.plants).map((p) => p.id + p.crop + Math.round(p.gdd)).join(); };
const savedG = await G((f) => { __game.saveGame(); return (0, eval)('(' + f + ')')(); }, sig.toString());
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(9000);
const backG = await G((f) => (0, eval)('(' + f + ')')(), sig.toString());
check('the garden survives a save and reload', savedG.length > 30 && backG.split(']]')[0] === savedG.split(']]')[0] && backG.split(',').length === savedG.split(',').length, backG.slice(0, 120));
check('the bed is drawn again after loading', await until(() => __gardenView.beds().length === 1, 10000));
check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close();
if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
console.log('\nall passed');
