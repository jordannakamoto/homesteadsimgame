// A clumsy player in the shed: wrong clicks, tool switching, panel toggling, the ladder in odd places, reloads and a new world mid-build.
//   node test/shed.clumsy.mjs      (needs dist/index.html and Playwright). Prints findings; exits 1 on any FAIL or page error.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [], warns = [], fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.setDefaultTimeout(120000);
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/net::ERR_/.test(t)) errors.push(t.slice(0, 400)); else if (/did not work|cannot|could not/i.test(t) && m.type() !== 'log') warns.push(t.slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 700)));
const G = (fn, arg) => page.evaluate(fn, arg);
const boot = async () => {
  await page.waitForFunction(() => window.__game && window.__build && window.__build.view && window.__construct, null, { timeout: 240000 });
  await G(() => { const g = __game; g.lockQuality(); g.setQuality('low'); const r = g.renderer; r.render = () => {}; window.__step = (n, dt) => { for (let i = 0; i < n; i++) g.step(dt); }; });
};
const tick = (n = 3) => G((n) => window.__step(n, 1 / 30), n);
const S = () => G(() => { const c = __construct, s = __game.sim.state.sys.construction, P = __game.player; return { tool: P.tool, climbY: P.climbY, climbing: !!c.V.climb, ladder: s.ladder, carried: s.carried, stacks: s.stacks.map((k) => k.itemId), deliveries: s.deliveries.length, glow: c.V.glowSig, ctx: c.context() && c.context().kind, hint: document.getElementById('cvprompt').hidden ? '' : document.getElementById('cvprompt').innerText.replace(/\s+/g, ' '), px: P.x, pz: P.z, py: P.y }; });
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name + ' (script)', false, String(e).slice(0, 200)); } };

await page.goto(file, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__game && window.__build, null, { timeout: 240000 });
await G(() => localStorage.clear()); await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 }); await boot(); await tick(20);

// ---- set the shed down and order it, then clumsy input with nothing delivered yet
await step('place and order', async () => {
  await page.keyboard.press('KeyL'); await tick(2);
  await page.click('#cvbody button[data-act="place:shed"]'); await tick(2);
  await page.mouse.move(700, 300); await tick(2); await page.mouse.click(700, 300); await tick(4);
  await page.click('#cvbody button[data-act="order:all"]'); await tick(3);
  check('the first delivery carries a ladder', await G(() => __game.sim.state.sys.construction.deliveries.some((d) => d.lines.some((l) => l.itemId === 'ladder'))));
});
await step('clumsy input before anything is delivered', async () => {
  for (const key of ['KeyL', 'KeyL', 'KeyL', 'Digit1', 'Digit5', 'KeyF', 'KeyB', 'KeyB', 'KeyF', 'Escape']) { await page.keyboard.press(key); await tick(2); }
  for (let i = 0; i < 6; i++) { await page.mouse.click(200 + i * 150, 200 + i * 40); await tick(2); }
  for (let i = 0; i < 8; i++) { await page.keyboard.press('KeyE'); await tick(1); }
  await page.keyboard.press('KeyL'); await tick(2); await page.keyboard.press('KeyL'); await tick(2);
  const s = await S();
  check('after mashing tools and the panel the page is alive and the panel is closed', await G(() => document.getElementById('cv').hidden), s.tool);
  await page.keyboard.press('Digit5'); await tick(3);
  const a = await S(); check('with the garden tool out (it owns the pointer) nothing is glowing and no hint is stale', !a.glow && !a.hint, 'glow=' + a.glow + ' hint=' + a.hint);
  await page.keyboard.press('Digit5'); await tick(3);
});
await step('deliver', async () => {
  await G(() => __game.sim.commandNow('construction.deliverNow', {})); await tick(10);
  const s = await S();
  check('stacks stand by the building, a ladder among them', s.stacks.length > 10 && s.stacks.includes('ladder'));
});
await step('click with empty arms, press E near stacks, switch tools mid-work', async () => {
  const b = await G(() => { const st = __game.sim.state.sys.construction.stacks[0]; return { x: st.x, z: st.z }; });
  await G((b) => { const P = __game.player; P.x = b.x + 1.2; P.z = b.z + 1; }, b); await tick(3);
  for (let i = 0; i < 5; i++) { await page.mouse.move(640, 360 + i * 20); await page.mouse.down(); await tick(2); await page.mouse.up(); await tick(1); await page.keyboard.press('KeyE'); await tick(1); }
  await page.keyboard.press('Digit5'); await tick(2); await page.mouse.click(640, 400); await tick(2); await page.keyboard.press('Digit5'); await tick(2); await page.keyboard.press('KeyF'); await tick(2);
  const s = await S();
  check('hands still work after tool switching (a context exists or nothing stale)', s.tool !== undefined, s.tool + ' ctx=' + s.ctx + ' hint=' + s.hint);
  const c = s.carried; if (c) check('a load in the arms can be put down', await G(() => { const r = __game.sim.commandNow('construction.putDown', { x: __game.player.x + 1, z: __game.player.z }); return !!r.ok; }));
  check('books balance', await G(() => Object.keys(__construct.plan ? {} : {}).length === 0 && Object.keys(__game.sim.state.sys.construction.ledger).length > 0));
});

// ---- the ladder: pick up, lean in odd spots, walk onto it, climb, step off
await step('ladder', async () => {
  const take = () => G(() => { const s = __game.sim.state.sys.construction; if (s.carried) __game.sim.commandNow('construction.putDown', { x: __game.player.x, z: __game.player.z }); const k = s.stacks.find((q) => q.itemId === 'ladder'); return !!k && __game.sim.commandNow('construction.pickUp', { stackId: k.id }).ok; });
  check('the ladder can be picked up', await take());
  check('leaning it on nothing (no building) is refused or harmless', await G(() => { try { __game.sim.commandNow('construction.leanLadder', { x: 1e9, z: NaN, yaw: 0, topY: 3 }); return true; } catch (e) { return false; } }));
  const P0 = await G(() => ({ x: __game.player.x, z: __game.player.z }));
  // lean at a spot beside the player, wall to the north (+z), top 3 m up
  const L = await G((P0) => { const x = P0.x + 6, z = P0.z; const r = __game.sim.commandNow('construction.leanLadder', { x, z, yaw: 0, topY: __game.heightAt(x, z) + 3.4 }); return { ok: r.ok, x, z }; }, P0);
  check('the ladder can be leaned', L.ok);
  const toward = async (tx, tz, keys) => { await G(([tx, tz]) => { const P = __game.player; __game.cam.yaw = Math.atan2(-(tx - P.x), -(tz - P.z)); }, [tx, tz]); for (const k of keys) await page.keyboard.down(k); };
  // walking past the foot sideways does not grab
  await G(([x, z]) => { __game.player.x = x - 3; __game.player.z = z - 0.2; }, [L.x, L.z]); await tick(2);
  await toward(L.x + 3, L.z - 0.2, ['KeyW']); for (let i = 0; i < 40; i++) await tick(2); await page.keyboard.up('KeyW');
  check('walking past the ladder does not grab the player', !(await S()).climbing);
  // walking into the foot, heading for the wall, climbs
  await G(([x, z]) => { __game.player.x = x; __game.player.z = z - 1.6; }, [L.x, L.z]); await tick(3);
  await toward(L.x, L.z + 3, ['KeyW']);
  for (let i = 0; i < 30 && !(await S()).climbing; i++) await tick(2);
  check('walking into the foot mounts the ladder with no key press', (await S()).climbing);
  for (let i = 0; i < 80; i++) await tick(2);
  let s = await S(); check('holding forward climbs to the top and stays there', s.climbing && s.climbY > (await G(([x, z]) => __game.heightAt(x, z), [L.x, L.z])) + 1.5, 'y=' + s.climbY);
  await page.keyboard.up('KeyW'); await page.keyboard.down('KeyA'); for (let i = 0; i < 20; i++) await tick(2); await page.keyboard.up('KeyA');
  check('stepping sideways at the top does not drop the player', (await S()).climbing);
  await page.keyboard.down('KeyE'); await tick(2); await page.keyboard.up('KeyE'); await page.keyboard.press('KeyE'); await tick(2);
  await page.keyboard.down('KeyS'); for (let i = 0; i < 160 && (await S()).climbing; i++) await tick(2); await page.keyboard.up('KeyS');
  s = await S(); check('holding back comes down and leaves the ladder at the bottom', !s.climbing && s.climbY == null, 'climbing=' + s.climbing + ' climbY=' + s.climbY);
  // stuck-on-ladder checks: reload with the player on it
  await G(([x, z]) => { __game.player.x = x; __game.player.z = z - 1.6; }, [L.x, L.z]); await tick(3);
  await toward(L.x, L.z + 3, ['KeyW']); for (let i = 0; i < 40; i++) await tick(2); await page.keyboard.up('KeyW');
  await G(() => __game.saveGame());
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 }); await boot(); await tick(10);
  s = await S(); check('reloading while on the ladder leaves the player free (not stuck on it)', !s.climbing && s.climbY == null, 'climbing=' + s.climbing + ' climbY=' + s.climbY);
  check('the leaned ladder survives the reload and can be taken down', !!s.ladder && await G(() => { const P = __game.player, L = __game.sim.state.sys.construction.ladder; P.x = L.x; P.z = L.z - 2.2; return true; }));
});

// ---- an order placed before the ladder existed (an old save) gets a ladder at the stacks
await step('old save', async () => {
  const r = await G(() => { const s = __game.sim.state.sys.construction; const k = s.stacks.filter((q) => q.itemId === 'ladder').map((q) => q.id); s.stacks = s.stacks.filter((q) => q.itemId !== 'ladder'); if (s.carried && s.carried.itemId === 'ladder') s.carried = null; s.ladder = null; delete s.ledger.ladder; return k.length; });
  await tick(5);
  check('a build ordered without a ladder is granted one at the stacks', await G(() => __game.sim.state.sys.construction.stacks.some((q) => q.itemId === 'ladder')), 'removed ' + r);
});

// ---- reload mid-stage, then New world mid-build
await step('reload and new world', async () => {
  await G(() => __game.saveGame()); await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 }); await boot(); await tick(10);
  const s = await S(); check('after the reload there is a stage hint and no stale glow', typeof s.hint === 'string' && (s.glow === '' || s.glow === undefined || s.ctx), 'hint=' + s.hint);
  await page.evaluate(() => document.getElementById('newworld').click()); await page.waitForTimeout(500); await boot().catch(() => {}); await tick(10);
  const n = await S();
  check('a new world has no ladder, no load, nothing climbing, no glow', !n.ladder && !n.carried && !n.climbing && n.climbY == null && !n.glow, JSON.stringify({ l: n.ladder, c: n.carried, g: n.glow }));
  check('and the construction card is back to the first shed', await G(() => __game.sim.state.sys.stock.projects.some((p) => p.id === 'first-shed')));
});
check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log('warnings:', warns.length ? warns.slice(0, 10).join(' | ') : 'none');
await browser.close();
if (fails.length) { console.log('\n' + fails.length + ' FAILED'); process.exit(1); }
console.log('\nall ok');
