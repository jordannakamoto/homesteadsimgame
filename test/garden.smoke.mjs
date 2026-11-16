// Browser test of the garden through real input: node test/garden.smoke.mjs  (needs dist/index.html and Playwright)
// Works a strip of ground with pulls of the hoe, takes a radish packet and sows by dragging along the row, tips the
// can to water, fills it at the pump if the world has one, runs time at 1000x until the radishes are ready, pulls one
// up by hand, and checks the garden survives a save and reload.
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

await page.goto(file, { waitUntil: 'domcontentloaded', timeout: 180000 }); await wait(9000);
check('page loads', await G(() => !!(window.__game && window.__gardenView)));
await G(() => { __game.lockQuality(); __game.setQuality('low'); __game.sim.state.sys.stock.money = 500; });
await G(() => __game.setSpeed(0));

// the Garden tool from the keyboard: gardening stance, a hotbar of things to hold, and no palette of verbs
await page.keyboard.press('Digit5'); await wait(1500);
check('key 5 takes up the garden tools', await G(() => __game.player.tool === 'garden' && !document.getElementById('gbar').hidden && __hands.isOpen));
check('the hotbar holds things, not verbs', await G(() => { const n = [...document.querySelectorAll('#gbar .hslot .nm')].map((e) => e.textContent); return n.includes('Hands') && n.includes('Hoe') && n.includes('Can') && !n.includes('Sow') && !n.includes('Harvest') && !n.includes('Bed'); }));
check('new to the garden, you are holding the hoe', await G(() => __gardenView.held === 'hoe'));
await G(() => { document.getElementById('gtip').hidden = true; });
// screen pixels of a ground point, and a point at an offset (right, ahead) from the player in the camera's frame
const scr = (x, z) => G((o) => { const p = __gardenView.toScreen(o.x, __game.heightAt(o.x, o.z) + 0.03, o.z); return { x: p.x, y: p.y }; }, { x, z });
const P = await G(() => { const g = __game, P = g.player; return { x: P.x, z: P.z, fx: -Math.sin(g.cam.yaw), fz: -Math.cos(g.cam.yaw), rx: Math.cos(g.cam.yaw), rz: -Math.sin(g.cam.yaw) }; });
const at = (r, f) => ({ x: P.x + P.rx * r + P.fx * f, z: P.z + P.rz * r + P.fz * f });
const drag = async (A, B, steps = 8, hold = 0) => { const a = await scr(A.x, A.z), b = await scr(B.x, B.z); await page.mouse.move(a.x, a.y); await wait(120); await page.mouse.down(); await wait(120); await page.mouse.move(b.x, b.y, { steps }); await wait(150 + hold); return b; };
await page.click('#gbar .ghint button[data-buy="hoe"]'); await wait(300);
check('a hoe bought from the hint', await G(() => __game.sim.state.sys.stock.tools.includes('hoe')));
// hoe: press the blade in ahead and pull it back toward the character; three strips side by side, each gone over twice
const groups = () => G(() => Object.values(__game.sim.state.sys.garden.field.groups).map((b) => ({ id: b.id, nx: b.nx, nz: b.nz, x0: b.x0, z0: b.z0, till: b.cells.map((c) => (c.till === undefined ? 1 : c.till)) })));
await drag(at(-0.35, 1.35), at(-0.35, 0.5)); 
const mid = await groups();
if (shots) await page.screenshot({ path: shots + '/hoe_midstroke.png' });
await page.mouse.up(); await wait(300);
check('one pull of the hoe turns a strip of sod', mid.length >= 1 && mid[0].till.filter((t) => t > 0).length >= 3, JSON.stringify(mid.map((b) => [b.nx, b.nz])));
check('the first stroke leaves it half worked', mid[0].till.some((t) => t > 0 && t < 1));
for (const r of [-0.35, 0, 0.35]) for (let k = 0; k < 2; k++) { await drag(at(r, 1.4), at(r, 0.45)); await page.mouse.up(); await wait(250); }
const beds = await groups();
const fine = beds.reduce((n, b) => n + b.till.filter((t) => t >= 1).length, 0);
check('worked ground is one bed', beds.length === 1, beds.length + ' beds');
check('going over it again makes fine soil', fine >= 8, fine + ' squares of fine soil');
check('the worked ground is drawn', await until(() => __gardenView.beds().length === 1, 10000));
// seed: take a packet from the seed box and drag along the row
const bed = beds[0];
const cellXZ = (i) => ({ x: bed.x0 + ((i % bed.nx) + 0.5) * 0.3, z: bed.z0 + (Math.floor(i / bed.nx) + 0.5) * 0.3 });
const fineCells = bed.till.map((t, i) => (t >= 1 ? i : -1)).filter((i) => i >= 0);
await page.click('#gbar .hslot[data-slot="box"]'); await wait(300);
await page.click('#gbar .gseed[data-crop="radish"]'); await wait(400);
check('a radish packet bought from the seed box and held', await G(() => __gardenView.held === 'seed:radish'));
// one row of the bed along the camera's forward direction: the cells nearest the middle strip
const rowOf = (r) => fineCells.map((i) => ({ i, ...cellXZ(i) })).filter((c) => Math.abs((c.x - P.x) * P.rx + (c.z - P.z) * P.rz - r) < 0.16).sort((a, b) => ((a.x - P.x) * P.fx + (a.z - P.z) * P.fz) - ((b.x - P.x) * P.fx + (b.z - P.z) * P.fz));
let row = rowOf(0); if (row.length < 2) row = fineCells.map((i) => ({ i, ...cellXZ(i) }));
await drag(row[0], row[row.length - 1], 12); await page.mouse.up(); await wait(300);
const sown = await G(() => Object.values(__game.sim.state.sys.garden.plants).filter((p) => p.crop === 'radish').length);
check('radish sown along the row by dragging', sown >= 2, sown + ' squares');
// water: buy a can from the hint, lift it over the row and tip it by dragging down
await page.keyboard.press('Digit3'); await wait(300);
check('number keys change what is held', await G(() => __gardenView.held === 'can'));
await page.click('#gbar .ghint button[data-buy="watering_can"]'); await wait(300);
check('a watering can bought, and it comes full', await G(() => __game.sim.state.sys.stock.tools.includes('watering_can') && __game.sim.state.sys.garden.can.litres === 9));
const wetOf = () => G((id) => { const b = __game.sim.state.sys.garden.field.groups[id]; let w = 0, n = 0; b.cells.forEach((c, i) => { if (c.pl) { w += __game.garden.cellInfo(__game.sim.state, id, i).water; n++; } }); return w / Math.max(1, n); }, bed.id);
const before = await wetOf();
const m = row[Math.floor(row.length / 2)], ms = await scr(m.x, m.z);
await page.mouse.move(ms.x, ms.y); await wait(150); await page.mouse.down(); await wait(300);
const lifted = await G(() => __game.sim.state.sys.garden.can.litres);
await page.mouse.move(ms.x, ms.y + 100, { steps: 6 }); await wait(1800);
if (shots) await page.screenshot({ path: shots + '/watering.png' });
await page.mouse.move(ms.x - 40, ms.y + 100, { steps: 4 }); await wait(700); await page.mouse.move(ms.x + 40, ms.y + 100, { steps: 4 }); await wait(700);
await page.mouse.up(); await wait(300);
const after = await wetOf(), can = await G(() => __game.sim.state.sys.garden.can.litres);
check('a lifted can pours nothing until it is tipped', lifted === 9);
check('tipping the can wets the soil and lightens the can', after > before && can < 9, 'water ' + before.toFixed(2) + ' -> ' + after.toFixed(2) + ', can ' + can.toFixed(1) + ' L');
const src = await G(() => ({ kind: __gardenView.source.kind, btn: !!document.querySelector('#gbar .ghint button[data-act="refill"]') }));
check('no free refill button while the can holds water', !src.btn, src.kind);
if (await G(() => !!(window.__build && __build.pieces().some((p) => p.kind === 'fixture' && p.fixture === 'hand_pump')))) {
  // the pump by the well: stand by it, hold the can under the spout and work the handle
  await G(() => { const p = __build.pieces().find((q) => q.kind === 'fixture' && q.fixture === 'hand_pump'); __game.player.x = p.a.x + 0.9; __game.player.z = p.a.z; __game.sim.state.sys.garden.can.litres = 0; });
  await wait(1500);
  const pp = await G(() => { const p = __build.pieces().find((q) => q.kind === 'fixture' && q.fixture === 'hand_pump'); const s = __gardenView.toScreen(p.a.x, __game.heightAt(p.a.x, p.a.z), p.a.z); return { x: s.x, y: s.y }; });
  for (let k = 0; k < 4; k++) { await page.mouse.move(pp.x, pp.y); await page.mouse.down(); await wait(200); await page.mouse.move(pp.x, pp.y + 100, { steps: 4 }); await wait(300); await page.mouse.up(); await wait(300); }
  await G(() => __game.setSpeed(1)); await wait(1500); await G(() => __game.setSpeed(0));
  const filled = await G(() => __game.sim.state.sys.garden.can.litres);
  check('pumping at the well fills the can with real water', filled > 2, filled.toFixed(1) + ' L');
  await G((o) => { __game.player.x = o.x; __game.player.z = o.z; }, { x: P.x, z: P.z }); await wait(1200);
} else console.log('note  no hand pump in this world: the can is filled by dipping, or the temporary button');

// time at 1000x until the radishes are ready (their four weeks, on this world's seasonal clock)
await G(() => __game.setSpeed(1000));
const ready = await until(() => Object.values(__game.sim.state.sys.garden.plants).some((p) => p.crop === 'radish' && p.readyT != null), 900000);
await G(() => __game.setSpeed(0));
const lifeDays = await G(() => { const s = __game.sim.state, p = Object.values(s.sys.garden.plants).find((q) => q.crop === 'radish'); return p ? ((p.readyT - p.sownT) / 86400) * (365 / s.yearDays) : null; });
check('radishes ready in about four weeks of their life', ready && lifeDays > 18 && lifeDays < 55, lifeDays && lifeDays.toFixed(0) + ' days');
// harvest: hold nothing, press on a radish and pull upward until it comes free
await page.keyboard.press('Digit1'); await wait(400);
check('hands are held for harvest', await G(() => __gardenView.held === 'hands'));
await G(() => { document.getElementById('gtip').hidden = true; });
const rad = await G(() => { const s = __game.sim.state.sys.garden; return Object.values(s.plants).filter((p) => p.crop === 'radish' && p.readyT != null).map((p) => { const b = s.field.groups[p.bed]; return { x: b.x0 + ((p.cell % b.nx) + 0.5) * 0.3, z: b.z0 + (Math.floor(p.cell / b.nx) + 0.5) * 0.3 }; }); });
const r0 = await scr(rad[0].x, rad[0].z);
await page.mouse.move(r0.x, r0.y); await wait(900);
const tagTxt = await G(() => { const t = document.getElementById('glabel'); return t.hidden ? '' : t.textContent; });
check('pointing at a plant shows its name tag', /^Radish: /.test(tagTxt), tagTxt);
if (shots) await page.screenshot({ path: shots + '/planted_tag.png' });
await page.mouse.down(); await wait(150);
const held0 = await G(() => __game.sim.state.sys.stock.items.produce_radish || 0);
await page.mouse.move(r0.x, r0.y - 90, { steps: 6 }); await wait(400);
const got = await G(() => __game.sim.state.sys.stock.items.produce_radish || 0);
check('a press alone does not pull a root; pulling upward does', held0 === 0 && got > 0, got.toFixed(3) + ' kg');
check('the first radishes are held up to admire', await G(() => __gardenView.firsts.radish === true));
if (shots) { await wait(300); await page.screenshot({ path: shots + '/harvest_overhead.png' }); }
await page.mouse.up(); await wait(300);
// look closer (F) at whatever is left, or at the bed
const lc = rad[1] || rad[0], ls = await scr(lc.x, lc.z);
await page.mouse.move(ls.x, ls.y); await wait(500); await page.keyboard.press('KeyF'); await wait(400);
check('F opens the full card', await G(() => !document.getElementById('gcard').hidden && /Radish|Bed/.test(document.getElementById('gcard').textContent)));
await page.keyboard.press('Escape'); await wait(200);
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
