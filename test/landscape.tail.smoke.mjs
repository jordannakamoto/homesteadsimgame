// Browser test of the yard, the long tail: node test/landscape.tail.smoke.mjs  (needs dist/index.html and Playwright)
// Run when src/sim/core/earthwork.js, src/sim/content/landscape.js, src/sim/landscape.js or src/landscape-view.js change
// (the fast core is test/landscape.smoke.mjs). Bags dragged and ripped open, a garden box filled, a lavender in a dug hole,
// the barrow fills and tips, a pond is lined and filled by the hose, the garden bar has the trowel and shovel, and the yard survives a reload.
import { yardSetup } from './helpers/landscape.mjs';
const Y = await yardSetup();
const { t, page, G, check, wait, scr, P, at, landed, hold, click, drag, L, rel, ground, scoop, dig1, bags, shots } = Y;
await hold('shovel');
for (let i = 0; i < 2; i++) await scoop(at(0.4, 1.2), at(-0.8, 1.2));
// bags: set down, dragged by hand, ripped open by the shovel, scooped to the marker
await G(() => { const st = __game.sim.state.sys.stock; st.items.wood_chips = 2 * 56; });
const bagAt = at(-1.3, 0.3);
const dl = await G((p) => __game.sim.commandNow('landscape.deliver', { item: 'wood_chips', qty: 112, x: p.x, z: p.z }), bagAt);
check('chips come as bags in the yard', dl.ok && dl.bags === 2);

let bl = await bags();
await hold('hands');
{ const b0 = bl[1], to = at(-0.3, 1.9); await drag({ x: b0.x, z: b0.z }, to, 14, 300); }
const moved = (await bags()).find((o) => o.id === bl[1].id);
check('hands drag a bag across the yard', moved && Math.hypot(moved.x - bl[1].x, moved.z - bl[1].z) > 0.5, moved ? (Math.hypot(moved.x - bl[1].x, moved.z - bl[1].z)).toFixed(2) + ' m' : 'gone');
await hold('shovel');
await dig1({ x: bl[0].x, z: bl[0].z });
check('a shovel stroke rips a bag open into a heap of chips', (await bags()).length === 1 && (await ground({ x: bl[0].x, z: bl[0].z }))?.s === 'woodchips');
const bed = at(-1.7, 1.6);
await scoop({ x: bl[0].x, z: bl[0].z }, bed);
check('scooped off the heap and dragged to the bed', (await ground(bed))?.s === 'woodchips', JSON.stringify(await ground(bed)));
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
for (let i = 0; i < 4 && (await rel(spot)) > -0.11; i++) await scoop(spot, at(-0.3, 2.4));
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
await G(() => __game.saveGame()); await t.reload();
const after = await L();
check('the yard survives a save and reload', after.tiles === before.tiles && after.things === before.things && after.plants === before.plants, JSON.stringify(after));
check('and is drawn again', await G(() => __landscape.tiles() > 0));

await t.finish();
