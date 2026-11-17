// Browser test of the yard through real input: node test/landscape.smoke.mjs  (needs dist/index.html and Playwright)
// Key 6 takes up the yard tools. The shovel goes in with a press and levers earth up when the mouse is pulled down;
// a click elsewhere throws it, and it lands as a heap. A drag skims turf; the path is tamped, covered with fabric and
// gravel; cobbles go down in a band; cut stone stacks into a wall with a capstone; a garden box is set and filled; a
// lavender goes in a dug hole; the barrow fills and tips; a pond is lined and filled; the garden's bar has the trowel
// and shovel; everything survives a reload. SHOTS=dir saves a screenshot.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html';
const shots = process.env.SHOTS || '';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
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
await G(() => { __game.lockQuality(); __game.setQuality('low'); __game.setSpeed(0); const st = __game.sim.state.sys.stock; st.money = 20000; st.tools.push('rake', 'tamper', 'wheelbarrow', 'garden_hose');
  Object.assign(st.items, { gravel: 1, landscape_fabric: 30, granite_sett: 200, cut_stone: 20, capstone: 4, garden_box_kit: 1, raised_bed_mix: 1200, plant_lavender: 1, pond_liner: 20 }); });
await page.keyboard.press('Digit6'); await wait(1500);
check('key 6 takes up the yard tools', await G(() => __game.player.tool === 'yard' && __hands.isOpen));
const scr = (x, z) => G((o) => { const p = __hands.toScreen(o.x, __game.surfaceAt(o.x, o.z) + 0.02, o.z, {}); return { x: p.x, y: p.y }; }, { x, z });
const P = await G(() => { const g = __game, P = g.player; return { x: P.x, z: P.z, fx: -Math.sin(g.cam.yaw), fz: -Math.cos(g.cam.yaw), rx: Math.cos(g.cam.yaw), rz: -Math.sin(g.cam.yaw) }; });
const at = (r, f) => ({ x: P.x + P.rx * r + P.fx * f, z: P.z + P.rz * r + P.fz * f });
const landed = async () => { for (let k = 0; k < 60 && (await G(() => __landscape.flying)); k++) await wait(250); };
const hold = async (id) => { await G((i) => __landscape.hold(i), id); await wait(250); };
const click = async (A) => { const a = await scr(A.x, A.z); await page.mouse.move(a.x, a.y); await wait(80); await page.mouse.down(); await wait(120); await page.mouse.up(); await wait(200); };
const drag = async (A, B, steps = 12, holdMs = 200) => { const a = await scr(A.x, A.z), b = await scr(B.x, B.z); await page.mouse.move(a.x, a.y); await wait(80); await page.mouse.down(); await wait(120); await page.mouse.move(b.x, b.y, { steps }); await wait(holdMs); await page.mouse.up(); await wait(250); };
const lever = async (A) => { const a = await scr(A.x, A.z); await page.mouse.move(a.x, a.y); await page.mouse.down(); await wait(150); await page.mouse.move(a.x, a.y + 110, { steps: 6 }); await wait(150); await page.mouse.up(); await wait(200); };
const L = () => G(() => { const s = __game.sim.state.sys.landscape; return { tiles: Object.keys(s.grid.tiles || {}).length, carry: s.carry.m3, things: Object.keys(s.things).length, plants: Object.keys(s.plants).length, net: __game.earthwork.netVolume(s.grid) }; });
const rel = (A) => G((p) => __game.landscape.reliefAt(__game.sim.state, p.x, p.z), A);
const ground = (A) => G((p) => __game.landscape.groundAt(__game.sim.state, p.x, p.z), A);

// the shovel: in, lever, throw
await hold('shovel');
await click(at(0.4, 1.2)); await wait(400);   // a click is the whole push-and-lever (the slow pull-down gesture needs a real frame rate)
let s = await L();
check('the shovel goes in and levers a scoop up', s.carry > 0.01, Math.round(s.carry * 1000) + ' L');
await click(at(-0.8, 1.2)); await landed();
s = await L();
check('a click throws it; it lands, and earth is neither made nor lost', s.carry === 0 && Math.abs(s.net) < 2e-4, 'net ' + s.net.toFixed(5));
for (let i = 0; i < 3; i++) { await click(at(0.4, 1.2)); await click(at(-0.8, 1.2)); await landed(); }
const hole = await rel(at(0.4, 1.2)), heap = await rel(at(-0.8, 1.2));
check('a round hole and a heap', hole < -0.12 && heap > 0.1, Math.round(hole * 100) + ' cm, +' + Math.round(heap * 100) + ' cm');
check('the shaped ground is drawn and the terrain lets it through', await G(() => __landscape.tiles() > 0));
// a path, put in properly: skim, tamp, fabric, gravel
{ const a = await scr(at(1.0, 0.6).x, at(1.0, 0.6).z), b = await scr(at(1.0, 1.8).x, at(1.0, 1.8).z); await page.mouse.move(a.x, a.y); await page.mouse.down(); await wait(600); await page.mouse.move(b.x, b.y, { steps: 12 }); await wait(300); await page.mouse.up(); await wait(300); }
check('dragging the shovel along the grass skims the turf', (await ground(at(1.0, 1.2)))?.s === 'soil');
await hold('tamper'); await drag(at(1.0, 0.7), at(1.0, 1.7), 10, 900);
check('the tamper firms it', ((await ground(at(1.0, 0.7))) || {}).tamped >= 1 || ((await ground(at(1.0, 1.7))) || {}).tamped >= 1);
await hold('fabric'); await drag(at(1.0, 0.7), at(1.0, 1.7), 16, 900);
check('fabric rolled over the dug-out path', !!(await ground(at(1.0, 1.2)))?.fabric);
await hold('gravel'); await drag(at(1.0, 0.7), at(1.0, 1.7), 20, 1500);
const gp = await ground(at(1.0, 1.2));
check('gravel laid on the fabric', gp && gp.s === 'gravel' && gp.fabric, JSON.stringify(gp));
// stone: a cobbled band, a cut-stone wall with a capstone
await hold('cobble'); await drag(at(0.75, 0.4), at(0.75, 1.4), 14);
const cob = await G(() => Object.values(__game.sim.state.sys.landscape.things).filter((o) => o.k === 'cobble').length);
check('dragging lays cobblestones in a band', cob >= 20, cob + ' setts');
await hold('cutstone'); await drag(at(1.45, 0.9), at(1.45, 1.75), 8); await drag(at(1.45, 0.9), at(1.45, 1.75), 8);
await hold('capstone'); await click(at(1.45, 1.3));
const wall = await G(() => { const t = __game.sim.state.sys.landscape.things; const c = (o) => { let n = 1; while (o.on && t[o.on]) { o = t[o.on]; n++; } return n; }; return Math.max(0, ...Object.values(t).map(c)); });
check('cut stone stacks into a wall with a capstone on top', wall >= 3, wall + ' courses');
// a garden box, filled
const boxAt = at(-1.4, 0.2);
await hold('gardenbox'); await click(boxAt);
check('a garden box set down', await G(() => Object.values(__game.sim.state.sys.landscape.things).some((o) => o.k === 'gardenbox')));
await G((p) => { for (let k = 0; k < 14; k++) __game.sim.commandNow('landscape.spread', { surface: 'bedmix', x: p.x + ((k % 5) - 2) * 0.4, z: p.z + (Math.floor(k / 5) - 1) * 0.35, r: 0.4, m3: 0.07 }); }, boxAt);
check('bed soil stays inside the box', (await rel(boxAt)) > 0.12, '+' + Math.round((await rel(boxAt)) * 100) + ' cm');
// a lavender in a dug hole
const spot = at(0.3, 2.0);
await hold('plant:lavender'); await click(spot);
check('a plant needs a hole', (await L()).plants === 0);
await hold('shovel');
for (let i = 0; i < 3 && (await rel(spot)) > -0.11; i++) { await click(spot); await click(at(-0.3, 2.3)); await landed(); }
await hold('plant:lavender'); await click(spot);
check('dug a hole and planted the lavender in it', (await L()).plants === 1);
// barrow and a pond
await hold('barrow');
for (let i = 0; i < 3; i++) await click(at(1.6, 0.2 + i * 0.3));
check('scoops go into the wheelbarrow', await G(() => __game.sim.state.sys.landscape.barrow.m3 > 0.02));
{ const a = await scr(at(-1.0, 1.9).x, at(-1.0, 1.9).z); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x, a.y + 120, { steps: 8 }); await wait(200); await page.mouse.up(); await wait(300); }
check('dragging down tips the barrow out', await G(() => __game.sim.state.sys.landscape.barrow.m3 === 0));
const pondAt = at(-0.4, -0.2);
await G((p) => { __game.sim.commandNow('landscape.setScale', { scale: 4 }); for (let k = 0; k < 9; k++) { __game.sim.commandNow('landscape.dig', { x: p.x + ((k % 3) - 1) * 0.25, z: p.z + (Math.floor(k / 3) - 1) * 0.25 }); __game.sim.commandNow('landscape.dump', { x: p.x + 4, z: p.z + 4 }); } }, pondAt);
await hold('liner'); await click(pondAt);
await hold('hose'); await click(pondAt);
check('the hose is running into the lined pond', await G(() => Object.keys(__game.sim.state.sys.landscape.hose).length === 1));
await G(() => __game.sim.runTicks(240)); await wait(800);
const pond = await G(() => __game.landscape.pondsOf(__game.sim.state)[0]);
check('the hose fills the pond', pond && pond.m3 > 0.01, pond ? Math.round(pond.m3 * 1000) + ' L' : 'none');
if (shots) { await G(() => { __game.cam.dist = 7; }); await wait(1500); await page.screenshot({ path: shots + '/yard.png' }); }
// the garden's bar has the trowel and the shovel
await page.keyboard.press('Escape'); await wait(500);
await page.keyboard.press('Digit5'); await wait(1200);
check('the garden holds a trowel and a shovel', await G(() => { const n = [...document.querySelectorAll('#gbar .hslot .nm')].map((e) => e.textContent); return n.includes('Trowel') && n.includes('Shovel'); }));
await page.keyboard.press('Escape'); await wait(400);
const before = await L();
await G(() => __game.saveGame()); await page.reload({ waitUntil: 'domcontentloaded' }); await wait(9000);
const after = await L();
check('the yard survives a save and reload', after.tiles === before.tiles && after.things === before.things && after.plants === before.plants, JSON.stringify(after));
check('and is drawn again', await G(() => __landscape.tiles() > 0));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails.length ? fails.length + ' failed' : 'all passed');
process.exit(fails.length ? 1 : 0);
