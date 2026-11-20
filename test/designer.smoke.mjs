// The door and window designer, driven the way a player drives it: node test/designer.smoke.mjs  (needs dist/index.html
// and Playwright). Draws a room, then places a window and a door, opens a window from Select, resizes it by dragging
// the stage's edge handle, types a width, grows its height anchored at the head, applies a fix from the fit line, places
// a tall round-top window that fits by lowering its sill, sets which way a door opens from the plan view, hangs a
// patio door and changes its colour. Saves dist/designer-cozy.png and dist/designer-minimal.png at 1440x900.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [], fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
await page.goto(file, { waitUntil: 'commit' });
await page.waitForFunction(() => window.__game && window.__build && window.__build.view, null, { timeout: 180000 });
const G = (fn, arg) => page.evaluate(fn, arg);
await G(() => {
  const g = __game; g.lockQuality(); g.setQuality('low'); localStorage.clear(); __build.reset();
  window.__ui && __ui.skin.set('cozy');
  g.sim.commandNow('construction.setOption', { key: 'sandbox', value: true });
  const r = g.renderer; window.__draw = r.render.bind(r); r.render = () => {};
  window.__step = (n = 2) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
});
const step = (n = 2) => G((n) => window.__step(n), n);
const draw = () => G(() => { window.__step(1); window.__draw(__game.scene, __game.camera); });
const at = (lx, lz, up = 0.12) => G(([lx, lz, up]) => {
  const g = __game, S = __build.state.structs[0] || window.__F, [x, z] = __build.toWorld(S, lx, lz);
  const v = new g.THREE.Vector3(x, (S.y0 === undefined ? g.heightAt(x, z) : S.y0) + up, z).project(g.camera), r = g.renderer.domElement.getBoundingClientRect();
  return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height];
}, [lx, lz, up]);
const move = async (p) => { await page.mouse.move(p[0], p[1]); await step(2); };
const click = async (p) => { await move(p); await page.mouse.down(); await page.mouse.up(); await step(2); };
// the free doors and windows as saved, and what the designer shows
const units = () => G(() => (__build.state.structs[0] ? __build.state.structs[0].fopen : []).map((o) => ({ id: o.f.id, type: o.f.typeId, kind: o.sp.type.kind, w: o.sp.w, h: o.sp.h, sill: o.f.sill, head: o.sp.head, pos: o.f.pos, flip: !!o.f.flip, out: !!o.f.out, finish: o.f.finish || null })));
const stage = () => G(() => { const v = __build.view(), s = v.groups.find((g) => g.type === 'stage'); return s ? { mode: s.mode, kind: s.kind, anchor: s.anchor, hand: s.hand, sill: s.spec.sill, wall: s.wall, fit: v.fit, w: +(v.groups.find((g) => g.id === 'w:w') || {}).value, h: +(v.groups.find((g) => g.id === 'w:h') || {}).value } : null; });
const tab = async (name) => { await G((name) => [...document.querySelectorAll('#bdtabs [role="tab"]')].find((t) => t.textContent === name).click(), name); await step(2); };
const uiReady = async () => { await step(2); await page.waitForTimeout(30); };

await page.keyboard.press('KeyB'); await step(70);
await G(() => { __game.cam.dist = 30; }); await step(30);
// a 6 x 4 m room
await page.keyboard.press('KeyR'); await step(2);
await G(() => { const g = __game, c = g.cam, x = g.player.x - Math.sin(c.yaw) * 1 - Math.cos(c.yaw) * 5, z = g.player.z - Math.cos(c.yaw) * 1 + Math.sin(c.yaw) * 5; const r = g.renderer.domElement.getBoundingClientRect(), v = new g.THREE.Vector3(x, g.heightAt(x, z), z).project(g.camera); window.__p0 = [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height]; });
await move(await G(() => window.__p0));
await G(() => { const p = __build.state.pending; window.__F = { ox: p.ox, oz: p.oz, yaw: p.yaw }; });
await move(await at(0, 0)); await page.mouse.down(); await step(1);
await G(() => { window.__F.y0 = __build.state.drag.F.y0; });
await move(await at(3, 2, 0)); await move(await at(6, 4, 0));
await page.mouse.up(); await step(3);
check('a room to work in', await G(() => __build.pieces().filter((p) => p.kind === 'wall').length === 4));

/* ---------- the Window tool: the designer opens with its stage, fit line, tabs and the catalogue in the tray ---------- */
await page.keyboard.press('KeyU'); await uiReady();
check('Window opens the designer: stage with handles, fit line, three tabs', await G(() => {
  const d = document.getElementById('bdesign'), st = document.getElementById('bdstage');
  return !d.hidden && d.classList.contains('bdes') && !st.hidden && !!st.querySelector('svg.op-prev--stage[data-k]') && st.querySelectorAll('[data-h]').length >= 5 &&
    !document.getElementById('bdfit').hidden && [...document.querySelectorAll('#bdtabs [role="tab"]')].map((t) => t.textContent).join() === 'Size & place,Style,Finish';
}));
check('the old window preview is gone', await G(() => !document.querySelector('.bwinprev, .bwp')));
check('tray cards show a drawing and the whole name', await G(() => {
  const cs = [...document.querySelectorAll('#bopts .bocard')];
  return cs.length >= 8 && cs.every((c) => c.querySelector('.th svg') && c.querySelector('.nm b').textContent === c.getAttribute('aria-label')) && cs.every((c) => { const b = c.querySelector('.nm b'); return b.scrollHeight <= b.clientHeight + 1; }) && cs.some((c) => c.querySelector('.th svg.op-prev--thumb'));
}));
await click(await at(3, 4, 1.4));
let U = await units();
check('a window is placed by clicking a wall', U.length === 1 && U[0].kind === 'window', JSON.stringify(U));

/* ---------- open it from Select, then resize it by dragging the stage's right edge ---------- */
await page.keyboard.press('KeyV'); await step(2);
await click(await at(3, 4, 1.4)); await uiReady();
let S = await stage();
check('clicking the window with Select opens the designer on it', !!S && S.mode === 'sel' && S.kind === 'window' && (await G(() => __build.view().tool)) === 'window', JSON.stringify(S));
{
  const w0 = U[0].w, pos0 = U[0].pos, n0 = await G(() => __build.state.undo.length);
  const h = await G(() => {
    const svg = document.querySelector('#bdstage svg.op-prev--stage'), r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, e = svg.querySelector('[data-h="r"]').getBoundingClientRect();
    return { x: e.left + e.width / 2, y: e.top + e.height / 2, pxPerM: (+svg.dataset.k * r.width) / vb.width };
  });
  const dx = 0.3 * h.pxPerM;
  await page.mouse.move(h.x, h.y); await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(h.x + (dx * i) / 6, h.y); await page.waitForTimeout(25); await step(1); }
  await page.mouse.up(); await uiReady();
  U = await units();
  check('dragging the stage\'s right edge widens the window 0.3 m, its left edge stays put', near(U[0].w, w0 + 0.3, 0.051) && near(U[0].pos, pos0, 0.011), JSON.stringify([w0, U[0].w, pos0, U[0].pos]));
  check('the whole drag is one step to undo', (await G(() => __build.state.undo.length)) === n0 + 1);
}
// a width typed in the designer
await page.fill('#bdbody input[aria-label="Width"]', '0.9'); await page.keyboard.press('Enter'); await uiReady();
U = await units();
check('a typed width sets it exactly', near(U[0].w, 0.9, 1e-3), String(U[0].w));
// anchored at the head, a taller window keeps its head and lowers its sill
{
  const head0 = U[0].head, sill0 = U[0].sill;
  await G(() => [...document.querySelectorAll('#bdbody [data-id="o:anchor"] button')].find((b) => b.textContent === 'Head').click()); await uiReady();
  check('the anchor switches to Head', (await stage()).anchor === 'head');
  for (let i = 0; i < 2; i++) { await G(() => document.querySelector('#bdbody input[aria-label="Height"]').parentNode.querySelector('[data-i="1"]').click()); await uiReady(); }
  U = await units();
  check('with Head anchored, two steps taller keep the head and drop the sill 0.10', near(U[0].head, head0, 0.006) && near(U[0].sill, sill0 - 0.1, 0.006), JSON.stringify([head0, U[0].head, sill0, U[0].sill]));
}
// too tall for where it sits: the sill goes down and the fit line offers the other way, as a button that works
{
  await G(() => [...document.querySelectorAll('#bdbody [data-id="o:anchor"] button')].find((b) => b.textContent === 'Sill').click()); await uiReady();
  await page.fill('#bdbody input[aria-label="Height"]', '2.1'); await page.keyboard.press('Enter'); await uiReady();
  S = await stage(); U = await units();
  const fixes = await G(() => [...document.querySelectorAll('#bdfit [data-fix]')].map((b) => b.textContent));
  check('a height that does not fit is applied as far as it goes and said on the fit line', !!S.fit && S.fit.adjusted && near(U[0].h, 2.1, 1e-3) && U[0].head <= S.wall.H - 0.19 + 1e-6, JSON.stringify([S.fit, U[0]]));
  check('the fit line offers a fix as a button', fixes.length >= 1, JSON.stringify(fixes));
  const before = JSON.stringify(U[0]);
  await G(() => document.querySelector('#bdfit [data-fix]').click()); await uiReady();
  U = await units();
  check('pressing the fix changes the window as it said', JSON.stringify(U[0]) !== before && U[0].head <= S.wall.H - 0.19 + 1e-6, before + ' -> ' + JSON.stringify(U[0]));
}
await page.keyboard.press('Escape'); await step(2);

/* ---------- a tall round-top window: set 2.0 m high before placing it; it fits by sitting lower ---------- */
await page.keyboard.press('KeyU'); await uiReady();
await G(() => { const t = [...document.querySelectorAll('#bopts .btabl [role="tab"]')].find((b) => b.textContent === 'Classic'); t && t.click(); }); await step(2);
await G(() => document.querySelector('#bopts .bocard[aria-label="Round-top window"]').click()); await uiReady();
await page.fill('#bdbody input[aria-label="Height"]', '2'); await page.keyboard.press('Enter'); await uiReady();
S = await stage();
check('the next round-top window, 2.0 m high, fits on the wall (its sill drops)', !!S && S.fit && S.fit.ok && near(S.h, 2, 1e-3) && S.sill + 2 <= S.wall.H - 0.19 + 1e-6, JSON.stringify(S));
await click(await at(1.3, 4, 1.4));
U = await units();
const arch = U.find((u) => u.type === 'arched');
check('it is placed 2.0 m high under the top plate', !!arch && near(arch.h, 2, 1e-3) && arch.head <= (await G(() => __build.state.structs[0].hs * 2.84)) - 0.19 + 1e-3, JSON.stringify(arch));
await page.keyboard.press('Escape'); await step(2);

/* ---------- the Door tool: the plan view sets which way it opens ---------- */
await page.keyboard.press('KeyJ'); await uiReady();
check('the door designer shows the plan view beside the elevation', await G(() => document.querySelectorAll('#bdstage svg.op-plan .op-q').length === 4 && !!document.querySelector('#bdstage .bstcap')));
await G(() => document.querySelector('#bdstage .op-q[data-flip="1"][data-out="1"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))); await uiReady();
S = await stage();
check('a quarter of the plan sets the next door to hinge right and open out', S.hand.flip === true && S.hand.out === true && (await G(() => document.querySelector('#bdstage .bstcap').textContent)) === 'Hinge right, opens out', JSON.stringify(S.hand));
await click(await at(6, 2, 1.2));
U = await units();
let door = U.find((u) => u.kind === 'door');
check('the door is hung opening out, hinged right', !!door && door.flip && door.out, JSON.stringify(door));
await click(await at(6, 2, 1.2)); await uiReady();
S = await stage();
check('clicking the door selects it in the designer', !!S && S.mode === 'sel' && S.kind === 'door');
await G(() => document.querySelector('#bdstage .op-q[data-flip="0"][data-out="0"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))); await uiReady();
door = (await units()).find((u) => u.kind === 'door');
check('the plan flips the selected door to hinge left, opening in', !door.flip && !door.out, JSON.stringify(door));
{
  const w0 = door.w;
  const h = await G(() => {
    const svg = document.querySelector('#bdstage svg.op-prev--stage'), r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, e = svg.querySelector('[data-h="l"]').getBoundingClientRect();
    return { x: e.left + e.width / 2, y: e.top + e.height / 2, pxPerM: (+svg.dataset.k * r.width) / vb.width };
  });
  await page.mouse.move(h.x, h.y); await page.mouse.down();
  for (let i = 1; i <= 4; i++) { await page.mouse.move(h.x - (0.1 * h.pxPerM * i) / 4, h.y); await page.waitForTimeout(25); await step(1); }
  await page.mouse.up(); await uiReady();
  door = (await units()).find((u) => u.kind === 'door');
  check('dragging the door\'s left edge in the stage widens it', near(door.w, w0 + 0.1, 0.051), JSON.stringify([w0, door.w]));
}
await G(() => { document.getElementById('bdbody').scrollTop = 0; });
await draw(); await page.waitForTimeout(200);
await page.screenshot({ path: 'dist/designer-cozy.png' });
await page.keyboard.press('Escape'); await step(2);

/* ---------- a patio door, then its colour ---------- */
await page.keyboard.press('KeyJ'); await uiReady();
await G(() => { const t = [...document.querySelectorAll('#bopts .btabl [role="tab"]')].find((b) => b.textContent === 'Patio and sliding'); t && t.click(); }); await step(2);
await G(() => document.querySelector('#bopts .bocard[aria-label="Sliding patio door"]').click()); await uiReady();
check('the patio door\'s plan shows its two ways to slide', await G(() => document.querySelectorAll('#bdstage svg.op-plan .op-q').length === 2));
await click(await at(0, 2, 1.2));
U = await units();
const patio = U.find((u) => u.type === 'door_patio');
check('a patio door is placed', !!patio, JSON.stringify(U.map((u) => u.type)));
if (patio) {
  await click(await at(0, 2, 1.2)); await uiReady();
  await tab('Finish');
  const sw = await G(() => { const b = [...document.querySelectorAll('#bdbody .bsw')].find((x) => x.getAttribute('aria-pressed') !== 'true'); if (!b) return null; b.click(); return b.title; });
  await uiReady();
  const p2 = (await units()).find((u) => u.id === patio.id);
  check('its colour changes from the Finish tab', !!sw && p2.finish && p2.finish !== patio.finish, JSON.stringify([sw, patio.finish, p2.finish]));
}

/* ---------- the designer in the minimal skin ---------- */
await page.keyboard.press('KeyU'); await uiReady();
await click(await at(3, 4, 1.4)); await uiReady();
await G(() => __ui.skin.set('minimal')); await uiReady();
check('minimal skin: the stage keeps its instrument look', await G(() => { const st = getComputedStyle(document.getElementById('bdstage')); return st.backgroundColor !== 'rgba(0, 0, 0, 0)' && !document.getElementById('bdstage').hidden; }));
await draw(); await page.waitForTimeout(200);
await page.screenshot({ path: 'dist/designer-minimal.png' });
await G(() => __ui.skin.set('cozy'));

check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close();
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
