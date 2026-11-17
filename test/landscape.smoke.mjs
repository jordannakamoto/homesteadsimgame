// Browser test of the yard through real input: node test/landscape.smoke.mjs  (needs dist/index.html and Playwright)
// Key 6 takes up the yard tools; the shovel digs a scoop and tosses it into a heap; a drag skims turf off a path; gravel
// is laid on it; a stepping stone and a two-course wall go down; a hole is dug and a lavender planted in it; the
// garden's shovel and trowel are on its bar; and it all survives a save and reload. SHOTS=dir saves screenshots.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html';
const shots = process.env.SHOTS || '';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const G = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(file, { waitUntil: 'domcontentloaded', timeout: 180000 }); await wait(9000);
check('page loads', await G(() => !!(window.__game && window.__landscape)));
await G(() => { __game.lockQuality(); __game.setQuality('low'); __game.setSpeed(0); __game.sim.state.sys.stock.money = 5000; });
await page.keyboard.press('Digit6'); await wait(1500);
check('key 6 takes up the yard tools', await G(() => __game.player.tool === 'yard' && !document.getElementById('lbar').hidden && __hands.isOpen));
const scr = (x, z) => G((o) => { const p = __hands.toScreen(o.x, __game.surfaceAt(o.x, o.z) + 0.02, o.z, {}); return { x: p.x, y: p.y }; }, { x, z });
const P = await G(() => { const g = __game, P = g.player; return { x: P.x, z: P.z, fx: -Math.sin(g.cam.yaw), fz: -Math.cos(g.cam.yaw), rx: Math.cos(g.cam.yaw), rz: -Math.sin(g.cam.yaw) }; });
const at = (r, f) => ({ x: P.x + P.rx * r + P.fx * f, z: P.z + P.rz * r + P.fz * f });
const click = async (A) => { const a = await scr(A.x, A.z); await page.mouse.move(a.x, a.y); await wait(100); await page.mouse.down(); await wait(120); await page.mouse.up(); await wait(200); };
const drag = async (A, B, steps = 10) => { const a = await scr(A.x, A.z), b = await scr(B.x, B.z); await page.mouse.move(a.x, a.y); await wait(100); await page.mouse.down(); await wait(120); await page.mouse.move(b.x, b.y, { steps }); await wait(200); await page.mouse.up(); await wait(250); };
const L = () => G(() => { const s = __game.sim.state.sys.landscape; return { sq: Object.keys(s.grid.sq).length, carry: s.carry.m3, things: Object.keys(s.things).length, plants: Object.keys(s.plants).length, net: __game.earthwork.netVolume(s.grid) }; });

await G(() => __landscape.hold('shovel'));
await click(at(0.4, 1.2));
let s = await L();
check('a click with the shovel digs a scoop', s.carry > 0.01, Math.round(s.carry * 1000) + ' L');
for (let i = 0; i < 3; i++) { await click(at(-0.8, 1.2)); await click(at(0.4, 1.2)); }
await click(at(-0.8, 1.2));
s = await L();
check('tossed loads make a heap, and earth is neither made nor lost', s.carry === 0 && Math.abs(s.net) < 1e-3 && s.sq > 2, s.sq + ' squares, net ' + s.net.toFixed(4));
const heap = await G((p) => __game.earthwork.heightOf(__game.sim.state.sys.landscape.grid, Math.floor(p.x / 0.3), Math.floor(p.z / 0.3)), at(-0.8, 1.2));
check('the heap stands up', heap > 0.1, Math.round(heap * 100) + ' cm');
check('the shaped ground is drawn and the terrain lets it through', await G(() => __landscape.tiles() > 0));
// a path: skim the turf off along a drag, buy gravel and sweep it on
await drag(at(1.0, 0.6), at(1.0, 1.8));
const skimmed = await G(() => Object.values(__game.sim.state.sys.landscape.grid.sq).filter((q) => q[1] === 'soil').length);
check('dragging the shovel skims the turf off', skimmed >= 3, skimmed + ' bare squares');
await G(() => __landscape.hold('store')); await wait(300);
await page.click('#lbar .gseed[data-buy="gravel"]'); await wait(300);
check('gravel bought in the yard store', await G(() => (__game.sim.state.sys.stock.items.gravel || 0) > 0.2));
await G(() => __landscape.hold('gravel')); await wait(200);
{ const a = await scr(at(1.0, 0.7).x, at(1.0, 0.7).z), b = await scr(at(1.0, 1.7).x, at(1.0, 1.7).z); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 20 }); await wait(1500); await page.mouse.up(); await wait(300); }
const gravel = await G(() => Object.values(__game.sim.state.sys.landscape.grid.sq).filter((q) => q[1] === 'gravel').length);
check('sweeping the bucket lays gravel on the bare ground', gravel >= 2, gravel + ' squares');
// stones: a flagstone, and a wall stone with another on top of it
await G(() => __landscape.hold('store')); await wait(200);
await page.click('#lbar .gseed[data-buy="flagstone_40"]'); await page.click('#lbar .gseed[data-buy="stone"]'); await wait(300);
await G(() => __landscape.hold('flagstone')); await click(at(-0.6, 0.6));
await G(() => __landscape.hold('wallstone')); await click(at(0.2, 0.5)); await click(at(0.2, 0.5));
const stack = await G(() => Object.values(__game.sim.state.sys.landscape.things).filter((o) => o.on).length);
s = await L();
check('stones set, and a second wall stone sits on the first', s.things >= 3 && stack >= 1, s.things + ' stones, ' + stack + ' stacked');
// a plant: refused without a hole, planted once one is dug
await G(() => __landscape.hold('store')); await wait(200);
await page.click('#lbar .gseed[data-buy="plant_lavender"]'); await wait(300);
const spot = at(-0.4, 1.7);
await G(() => __landscape.hold('plant:lavender')); await click(spot);
check('a plant needs a hole', (await L()).plants === 0);
await G(() => __landscape.hold('shovel'));
for (let i = 0; i < 3 && (await G((p) => __game.earthwork.heightOf(__game.sim.state.sys.landscape.grid, Math.floor(p.x / 0.3), Math.floor(p.z / 0.3)), spot)) > -0.1; i++) { await click(spot); await click(at(0.6, 1.9)); }
await G(() => __landscape.hold('plant:lavender')); await click(spot);
check('dug a hole and planted the lavender in it', (await L()).plants === 1);
// a wheelbarrow load, a pond (dig, line, hose), timbers and a path light
await G(() => { const st = __game.sim.state.sys.stock; st.tools.push('wheelbarrow', 'garden_hose'); st.items.pond_liner = 6; st.items.landscape_timber = 6; st.items.path_light = 2; st.items.river_rock = 0.2; __landscape.refresh(); });
await G(() => __landscape.hold('barrow')); await wait(200);
for (let i = 0; i < 3; i++) await click(at(1.6, 0.2 + i * 0.3));
check('scoops go into the wheelbarrow', await G(() => __game.sim.state.sys.landscape.barrow.m3 > 0.02));
{ const a = await scr(at(-1.4, 1.4).x, at(-1.4, 1.4).z); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x, a.y + 120, { steps: 8 }); await wait(200); await page.mouse.up(); await wait(300); }
check('dragging down tips the barrow out', await G(() => __game.sim.state.sys.landscape.barrow.m3 === 0));
const pondAt = at(-0.9, 0.2);
await G((p) => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { __game.sim.commandNow('landscape.dig', { x: p.x + dx * 0.3, z: p.z + dz * 0.3 }); __game.sim.commandNow('landscape.dump', { x: p.x + 3, z: p.z + 3 }); } }, pondAt);
await wait(400); await G(() => __landscape.hold('liner')); await wait(300);
await click(pondAt);
const lined = await G(() => Object.keys(__game.sim.state.sys.landscape.liner).length);
check('one click lines the whole hole', lined >= 9, lined + ' squares');
await G(() => __landscape.hold('hose')); await wait(200); await click(pondAt);
check('the hose is running', await G(() => Object.keys(__game.sim.state.sys.landscape.hose).length === 1));
await G(() => __game.sim.runTicks(240)); await wait(800);
const pond = await G(() => __game.landscape.pondsOf(__game.sim.state)[0]);
check('the hose fills the pond', pond && pond.m3 > 0.01, pond ? Math.round(pond.m3 * 1000) + ' L' : 'none');
await G(() => __landscape.hold('timber')); await drag(at(-1.6, -0.2), at(-1.6, 1.2), 10);
await G(() => __landscape.hold('pathlight')); await click(at(1.4, 1.4));
check('timbers and a path light set', await G(() => Object.values(__game.sim.state.sys.landscape.things).filter((o) => o.k === 'timber' || o.k === 'pathlight').length >= 2));
if (shots) { await G(() => { __game.cam.dist = 7; }); await wait(1500); await page.screenshot({ path: shots + '/yard.png' }); }
// the garden's bar has the trowel and the shovel
await page.keyboard.press('Escape'); await wait(500);
await page.keyboard.press('Digit5'); await wait(1200);
check('the garden holds a trowel and a shovel', await G(() => { const n = [...document.querySelectorAll('#gbar .hslot .nm')].map((e) => e.textContent); return n.includes('Trowel') && n.includes('Shovel'); }));
await page.keyboard.press('Escape'); await wait(400);
// save and reload
const before = await L();
await G(() => __game.saveGame()); await page.reload({ waitUntil: 'domcontentloaded' }); await wait(9000);
const after = await L();
check('the yard survives a save and reload', after.sq === before.sq && after.things === before.things && after.plants === before.plants, JSON.stringify(after));
check('and is drawn again', await G(() => __landscape.tiles() > 0));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails.length ? fails.length + ' failed' : 'all passed');
process.exit(fails.length ? 1 : 0);
