// What plan mode shows (docs/design/plan-mode-redesign.md 3B): node test/planview.smoke.mjs  (needs dist/index.html and Playwright)
// With sandbox off a planned shed is drawn finished, in its own materials; the tool in hand opens it as far as the task
// needs (Furnish cuts the walls at 1.2 m and lifts the roof, changing "Stands on" shows the foundation) and says so in a
// chip; the view control pins Finished or cuts a Section at a dragged height; leaving plan mode gives play its view back.
// Saves dist/planview-<name>.png.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [], fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

async function open(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 400)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
  await page.goto(file, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__game && window.__build && window.__build.view, null, { timeout: 180000 });
  const G = (fn, arg) => page.evaluate(fn, arg);
  await G(() => {
    const g = __game; g.lockQuality(); g.setQuality('low'); localStorage.clear(); __build.reset();
    g.sim.commandNow('construction.setOption', { key: 'sandbox', value: false });   // plans are raised by hand: a drawn plan is unbuilt
    __build.setFixtureCatalog(null);
    const r = g.renderer; window.__draw = r.render.bind(r); r.render = () => {};
    window.__step = (n = 2) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
  });
  const step = (n = 2) => G((n) => window.__step(n), n);
  const draw = () => G(() => { window.__step(1); window.__draw(__game.scene, __game.camera); });
  const shot = async (name) => { await draw(); await page.waitForTimeout(150); await page.screenshot({ path: 'dist/planview-' + name + '.png', timeout: 120000 }); };
  return { ctx, page, G, step, draw, shot };
}

{
  const { ctx, page, G, step, draw, shot } = await open({ viewport: { width: 1280, height: 720 } });
  await page.keyboard.press('KeyB'); await step(70);
  // the tutorial shed, set down as a plan ahead of the player
  await G(() => { const g = __game, c = g.cam; g.cam.dist = 16; const x = g.player.x - Math.sin(c.yaw) * 6, z = g.player.z - Math.cos(c.yaw) * 6; __build.placePlan('shed', x, z, c.yaw); });
  await step(30);
  const st = () => G(() => { const s = __build.planViewState(); return { ...s, S: s.structs[0] }; });
  const vc = () => G(() => __build.view().viewc);
  const ui = () => G(() => {
    const $ = (id) => document.getElementById(id), chip = $('bvchip'), cut = $('bvcut');
    return { view: !$('bview').hidden, pressed: [...$('bview').querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.m), chip: chip.hidden ? '' : chip.querySelector('.t').textContent, cut: !cut.hidden, roofs: !!$('broofs') };
  });
  const settle = async () => { await step(40); };

  check('the plan is unbuilt (sandbox off)', await G(() => { const S = __build.state.structs[0]; return !!S && S.plan.size > 0; }));
  const look = await G(() => {
    const S = __build.state.structs[0], mats = [];
    S.group.traverse((o) => { if (o.isMesh && o.visible) mats.push(o.material); });
    return { shell: mats.some((m) => m && m.uniforms && m.uniforms.uOp), wall: mats.includes(S.wallMat), roof: mats.includes(S.roofMat) };
  });
  check('the planned shed is drawn in its wall and roof materials, not the blueprint shell', !look.shell && look.wall && look.roof, JSON.stringify(look));
  let s = await st();
  check('Select with nothing selected: the whole house, roof on, no cut, no chip', s.S.visible && s.S.roof && s.S.cutH >= 99 && (await vc()).chip === '' && (await ui()).chip === '', JSON.stringify(s.S));
  const u0 = await ui();
  check('the view control replaces the Roofs toggle; Auto is pressed', u0.view && !u0.roofs && u0.pressed.join() === 'auto', JSON.stringify(u0));
  await shot('select');

  // Furnish: a dollhouse cut at 1.2 m above the floor, the roof lifted, and a chip that says so
  await page.keyboard.press('KeyC'); await settle();
  s = await st();
  let v = await vc();
  check('Furnish cuts the walls at 1.2 m and lifts the roof', !s.S.roof && near(s.S.cutH, 1.2, 0.02) && near(s.S.clip, (await G(() => __build.state.structs[0].y0)) + 1.2, 0.02) && near(v.cut, 1.2, 0.02), JSON.stringify({ S: s.S, cut: v.cut }));
  check('...and its chip reads "Cut at 1.2 m"', v.chip === 'Cut at 1.2 m' && (await ui()).chip === 'Cut at 1.2 m', JSON.stringify(await ui()));
  await shot('furnish');
  // closing the chip pins the finished house until the tool changes
  await page.click('#bvchip .x'); await settle();
  s = await st(); v = await vc();
  check('closing the chip shows the whole house again', s.S.roof && s.S.cutH >= 99 && v.chip === '' && (await ui()).chip === '', JSON.stringify(s.S));
  await page.keyboard.press('KeyV'); await step(2); await page.keyboard.press('KeyC'); await settle();
  check('...until the tool changes', near((await st()).S.cutH, 1.2, 0.02));

  // changing "Stands on" (Room's inspector) shows the foundation
  await page.keyboard.press('KeyR'); await step(4);
  await G(() => { if (!__build.view().inspector.open) __build.choose('insp'); }); await step(4);
  const fi = await G(() => __build.view().groups.findIndex((g) => /^(s:)?found$/.test(g.id || '')));
  check('Room\'s inspector has "Stands on"', fi >= 0);
  if (fi >= 0) {
    const sel = '#bdesign [data-g="' + fi + '"]';
    if (await G((q) => document.querySelector(q).tagName === 'SELECT', sel)) {
      const other = await G((q) => { const e = document.querySelector(q); return [...e.options].find((o) => !o.selected).value; }, sel);
      await page.selectOption(sel, other);
    } else await page.click(sel + '[aria-pressed="false"]');
    await settle();
    s = await st(); v = await vc();
    check('changing "Stands on" shows the foundation: ground storey only, roof off, the structure layer, and a chip', v.chip === 'Showing the foundation' && (await ui()).chip === 'Showing the foundation' && !s.S.roof && s.S.structure && s.S.cutH < 0.5, JSON.stringify({ S: s.S, chip: v.chip }));
    await shot('foundation');
  }
  await G(() => { if (__build.view().inspector.open) __build.choose('insp'); }); await step(2);
  await page.keyboard.press('Escape'); await step(2);

  // Finished pins the whole house whatever the tool
  await page.keyboard.press('KeyC'); await step(4);
  await page.click('#bview [data-m="finished"]'); await settle();
  s = await st(); v = await vc();
  check('Finished pins the whole house: roof on, no cut, no chip, even with Furnish', v.mode === 'finished' && s.S.visible && s.S.roof && s.S.cutH >= 99 && v.chip === '' && (await ui()).pressed.join() === 'finished', JSON.stringify(s.S));
  await shot('finished');

  // Section: the slider on the right edge; a drag to 2.0 m above the ground floor moves the plane there
  await page.click('#bview [data-m="section"]'); await settle();
  check('Section shows its height slider', (await ui()).cut && (await vc()).mode === 'section');
  const tr = await G(() => { const r = document.querySelector('#bvcut .tr').getBoundingClientRect(), v = __build.view().viewc; return { x: r.left + r.width / 2, top: r.top, h: r.height, lo: v.range[0], hi: v.range[1] }; });
  const yAt = (m) => tr.top + ((tr.hi - m) / (tr.hi - tr.lo)) * tr.h;
  await page.mouse.move(tr.x, yAt(1.0)); await page.mouse.down(); await page.waitForTimeout(40);
  await page.mouse.move(tr.x, yAt(1.6), { steps: 4 }); await page.waitForTimeout(40);
  await page.mouse.move(tr.x, yAt(2.0), { steps: 4 }); await page.waitForTimeout(60);
  await page.mouse.up(); await page.waitForTimeout(60); await settle();
  s = await st(); v = await vc();
  const g0 = await G(() => __build.state.structs[0].y0);
  check('dragging the slider to 2.0 m cuts there', near(v.cut, 2.0, 0.051) && near(s.S.clip, g0 + v.cut, 0.02), JSON.stringify({ cut: v.cut, clip: s.S.clip, y0: g0 }));
  check('the slider says where the cut is', await G(() => /2\.00 m above Ground/.test(document.querySelector('#bvcut .val').textContent)), await G(() => document.querySelector('#bvcut .val').textContent));
  await shot('section');

  // Materials: "Show what is left to build" brings the blueprint back
  await G(() => __build.choose('view:mode', 'auto')); await step(2);
  await page.click('#bsched'); await step(4);
  check('Materials has the "Show what is left to build" switch', await G(() => { const b = document.querySelector('#bschedp .bschv'); return !!b && !b.hidden && b.getAttribute('aria-checked') === 'false'; }));
  await page.click('#bschedp .bschv'); await settle();
  const bp = await G(() => { const S = __build.state.structs[0]; let shell = false; S.group.traverse((o) => { if (o.isMesh && o.visible && o.material && o.material.uniforms && o.material.uniforms.uOp) shell = true; }); return { shell, left: __build.view().viewc.left, on: document.querySelector('#bschedp .bschv').getAttribute('aria-checked') }; });
  check('...which draws the blueprint shell again', bp.shell && bp.left && bp.on === 'true', JSON.stringify(bp));
  await shot('left-to-build');
  await page.click('#bschedp .bschv'); await step(4);
  await page.click('#bsched'); await step(2);

  // leaving plan mode: play's own view (every storey drawn, roof on, no cut out here)
  await page.keyboard.press('KeyC'); await settle();
  await page.keyboard.press('KeyB'); await step(80);
  const play = await G(() => { const S = __build.state.structs[0]; return { on: __build.state.on, visible: S.group.visible, roofOp: S.roofOp, cutH: S.cutH, clip: S.clip.constant, near: S.near.constant, cut: !document.getElementById('bvcut') || getComputedStyle(document.getElementById('bvcut')).display === 'none' }; });
  check('leaving plan mode gives play its view back', !play.on && play.visible && play.roofOp === 1 && play.cutH >= 99 && play.clip >= 1e4 && play.near > -1e5 && play.cut, JSON.stringify(play));
  await draw();
  await ctx.close();
}

/* ---------- phone: the view control is in the "..." sheet ---------- */
{
  const { ctx, page, G, step } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  await G(() => document.body.classList.add('touch'));
  await page.keyboard.press('KeyB'); await step(70);
  await G(() => { const g = __game, c = g.cam; const x = g.player.x - Math.sin(c.yaw) * 6, z = g.player.z - Math.cos(c.yaw) * 6; __build.placePlan('shed', x, z, c.yaw); }); await step(10);
  const sheet = await G(() => { const v = document.getElementById('bview'), s = document.getElementById('baidsheet'); return { inSheet: !!s && s.contains(v), barOnly: !document.getElementById('baids').contains(v) }; });
  check('phone: the view control lives in the "..." sheet', sheet.inSheet && sheet.barOnly, JSON.stringify(sheet));
  if (await G(() => !!document.getElementById('bxtra'))) {
    await page.tap('#bxtra'); await step(3);
    const big = await G(() => [...document.querySelectorAll('#bview button')].every((b) => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 36; }));
    check('phone: its buttons are finger-sized', big);
    await page.tap('#bview [data-m="section"]'); await step(4);
    const w = await G(() => document.getElementById('bvcut').getBoundingClientRect().width);
    check('phone: the Section slider is 44 px wide', w >= 44, String(w));
    await G(() => { window.__step(1); window.__draw(__game.scene, __game.camera); });
    await page.screenshot({ path: 'dist/planview-phone.png', timeout: 120000 });
  }
  await ctx.close();
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails.length ? fails.length + ' failed' : 'all passed');
process.exitCode = fails.length ? 1 : 0;
