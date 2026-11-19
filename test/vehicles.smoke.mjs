// Browser smoke test of the vehicles on the page: node test/vehicles.smoke.mjs  (needs dist/index.html and Playwright)
// The starter ATV is parked by the well; walk into its side to get on; drive; E gets off; the pose survives a reload;
// seated at save time you are seated again after the reload; tools are locked while seated.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage(); page.setDefaultTimeout(180000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const G = (fn, arg) => page.evaluate(fn, arg);
const frames = async (n) => { const f0 = await G(() => __game.renderer.info.render.frame); for (let i = 0; i < 400; i++) { await page.waitForTimeout(100); if ((await G(() => __game.renderer.info.render.frame)) - f0 >= n) return; } throw new Error('page stopped rendering'); };

await page.goto(file, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(8000);
await G(() => { __game.lockQuality(); __game.setQuality('low'); });
await frames(5);
const st = await G(() => ({ s: __game.sim.state.sys.vehicles, P: { x: __game.player.x, z: __game.player.z } }));
const ids = Object.keys(st.s.units).filter((k) => st.s.units[k].kind === 'atv');     // the trailer given with it is a second unit
check('a new world has the starter ATV, once', st.s.starter && ids.length === 1, JSON.stringify(st.s.units[ids[0]] || {}).slice(0, 160));
const id = ids[0];

// walk into its left side, pushing toward it
await G((id) => { const u = __vehicles.unit(id), c = Math.cos(u.yaw), s = Math.sin(u.yaw), P = __game.player; P.x = u.x - 1.1 * c + -0.1 * s; P.z = u.z + 1.1 * s + -0.1 * c; P.y = __game.groundAt(P.x, P.z, P.y + 2);
  __game.cam.yaw = u.yaw - Math.PI / 2; }, id);      // the camera looks along the unit's right: W pushes toward it
await page.keyboard.down('KeyW'); await frames(40); await page.keyboard.up('KeyW');
await frames(25);
const on = await G(() => ({ top: __game.control.top().id, driven: __vehicles.driven(), seats: Object.values(__game.sim.state.sys.vehicles.units)[0].seats }));
check('walking into its side mounts it', on.top === 'seat' && on.driven === id, JSON.stringify(on));
await page.keyboard.press('Digit5'); await frames(2);
check('tools are locked while seated', await G(() => __game.player.tool === 'axe'));

// drive: point the camera along its nose and hold W
await G((id) => { const u = __vehicles.body(id); __game.cam.yaw = u.yaw + Math.PI; }, id);
const b0 = await G((id) => __vehicles.body(id), id);
await G(() => __vehicles.stats());
await page.keyboard.down('KeyW'); await frames(120);
const b1 = await G((id) => __vehicles.body(id), id);
const cost = await G(() => __vehicles.stats());
await page.keyboard.up('KeyW');
check('W drives it forward', Math.hypot(b1.x - b0.x, b1.z - b0.z) > 3 && b1.speed > 1, `moved ${Math.hypot(b1.x - b0.x, b1.z - b0.z).toFixed(1)} m, ${b1.speed.toFixed(1)} m/s, gear ${b1.gear}, ${b1.surface ? 'surface ok' : 'no surface'}`);
const us = await G((id) => __vehicles.bench(id), id);
check('a drive substep costs well under 0.1 ms', us < 100 && cost.msPerFrame / Math.max(1, cost.subPerFrame) < 0.25, us + ' us per substep; in frames ' + JSON.stringify(cost));
const synced = await G((id) => __game.sim.state.sys.vehicles.units[id], id);
check('the pose reaches the sim while driving', Math.hypot(synced.x - b0.x, synced.z - b0.z) > 1, JSON.stringify(synced).slice(0, 120));

// car keys are vehicle-relative: with the camera turned square across the nose, W still goes straight ahead and D turns it right
await G((id) => { __game.cam.yaw = __vehicles.body(id).yaw + Math.PI / 2; }, id);
const c0 = await G((id) => __vehicles.body(id), id);
await page.keyboard.down('KeyW'); await frames(60);
const c1 = await G((id) => __vehicles.body(id), id);
await page.keyboard.down('KeyD'); await frames(60); await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW');
const c2 = await G((id) => __vehicles.body(id), id);
const wr = (a) => Math.atan2(Math.sin(a), Math.cos(a));
check('with the camera across the nose, W still drives straight ahead', Math.abs(wr(c1.yaw - c0.yaw)) < 0.1, wr(c1.yaw - c0.yaw).toFixed(3));
check('D steers the vehicle right whatever the camera sees', wr(c2.yaw - c1.yaw) > 0.1, wr(c2.yaw - c1.yaw).toFixed(3));
await page.keyboard.down('Space'); await frames(60); await page.keyboard.up('Space');

// E: brakes, then steps off
await page.keyboard.press('KeyE'); await frames(150);
const off = await G((id) => ({ top: __game.control.top().id, u: __game.sim.state.sys.vehicles.units[id], b: __vehicles.body(id), P: { x: __game.player.x, z: __game.player.z } }), id);
check('E stops it and steps off', off.top === 'walk' && !Object.values(off.u.seats).some(Boolean) && Math.abs(off.u.x - off.b.x) < 0.05, JSON.stringify({ top: off.top, sx: off.u.x, bx: off.b.x }));
const d = Math.hypot(off.P.x - off.b.x, off.P.z - off.b.z);
check('put down beside it', d > 0.6 && d < 2.2, d.toFixed(2));
await page.keyboard.press('Digit5'); await frames(2);
check('tools come back on foot', await G(() => __game.player.tool === 'garden'));
await page.keyboard.press('Digit1');

// reload: parked where it was left; then seated at save time comes back seated
await G(() => __game.saveGame());
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(8000); await frames(3);
const back = await G((id) => ({ u: __game.sim.state.sys.vehicles.units[id], n: Object.values(__game.sim.state.sys.vehicles.units).filter((q) => q.kind === 'atv').length }), id);
check('reload keeps it where it was left, and no second starter', back.n === 1 && Math.abs(back.u.x - off.u.x) < 1e-3 && Math.abs(back.u.z - off.u.z) < 1e-3, JSON.stringify(back.u).slice(0, 120));
await G((id) => __vehicles.mount(id), id); await frames(30);
await G(() => __game.saveGame());
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(8000); await frames(3);
check('seated at save, seated after reload', await G(() => __game.control.top().id === 'seat' && !!__vehicles.driven()));
check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await page.screenshot({ path: 'dist/vehicles-smoke.png' });
await browser.close();
if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
console.log('\nall passed');
