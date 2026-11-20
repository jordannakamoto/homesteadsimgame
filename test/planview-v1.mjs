// What plan mode shows (docs/design/plan-mode-redesign.md 3B, step V1): the finished look and the task views.
// node test/planview-v1.mjs [outdir]  (needs dist/index.html and Playwright; screenshots go to outdir, default dist)
// Sandbox off: a planned two-storey house is drawn finished, Floor gives the dollhouse, changing the foundation of a built,
// furnished house gives the foundation view, Door on storey 1 hides storey 2, Section at 1.5 m sets the plane, and leaving
// plan mode gives play its own values back.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const out = process.argv[2] || 'dist';
const file = 'file://' + process.cwd() + '/dist/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [], fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };

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
  g.sim.commandNow('construction.setOption', { key: 'sandbox', value: false });
  __build.setConstructionMode(true);
  __build.setFixtureCatalog(null);
  const r = g.renderer; window.__draw = r.render.bind(r); r.render = () => {};
  window.__step = (n = 2) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
});
const step = (n = 2) => G((n) => window.__step(n), n);
const pv = () => G(() => __build.planViewState());
const at = (lx, lz, up = 0.12) => G(([lx, lz, up]) => {
  const g = __game, S = __build.state.structs[0] || window.__F, [x, z] = __build.toWorld(S, lx, lz);
  const v = new g.THREE.Vector3(x, (S.y0 === undefined ? g.heightAt(x, z) : S.y0) + up, z).project(g.camera), r = g.renderer.domElement.getBoundingClientRect();
  return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height];
}, [lx, lz, up]);
const move = async (p) => { await page.mouse.move(p[0], p[1]); await step(2); };
const click = async (p) => { await move(p); await page.mouse.down(); await page.mouse.up(); await step(2); };
const dragRoom = async (a, b, up) => { const p = await at(a[0], a[1], up), q = await at(b[0], b[1], up); await move(p); await page.mouse.down(); await step(1); await page.mouse.move((p[0] + q[0]) / 2, (p[1] + q[1]) / 2); await step(1); await move(q); await page.mouse.up(); await step(3); };
// the camera: an orbit round the player, who stands outside the house
// the camera, placed for the picture (the player stays where they are): yaw round the house, pitch down, distance, and the
// height above the ground floor it looks at. Set after the frame's step, just before drawing
let CAM = null;
const cam = (yaw, pitch, dist, look = 2) => { CAM = [yaw, pitch, dist, look]; return step(30); };
const shot = async (name) => { await G((C) => { window.__step(1); if (C) { const g = __game, S = __build.state.structs.find((O) => O.level === 0), [yo, pitch, dist, look] = C, yaw = g.cam.yaw + yo, y = S.y0 + look; g.camera.position.set(S.cx + Math.sin(yaw) * Math.cos(pitch) * dist, y + Math.sin(pitch) * dist, S.cz + Math.cos(yaw) * Math.cos(pitch) * dist); g.camera.lookAt(S.cx, y, S.cz); g.camera.updateMatrixWorld(); } window.__draw(__game.scene, __game.camera); }, CAM); await page.waitForTimeout(300); await page.screenshot({ path: out + '/' + name + '.png', timeout: 120000 }); };

// the house: the plan book's cabin, and a second storey like it on top (built from the same record, then all of it planned)
await G(() => {
  const g = __game, c = g.cam;
  __build.placePlan('cabin', g.player.x - Math.sin(c.yaw) * 9, g.player.z - Math.cos(c.yaw) * 9, c.yaw);
  const d = __build.serialize(), a = d.structs[0], ren = (o) => JSON.parse(JSON.stringify(o).replace(/"p(\d+)/g, (m, n) => '"p' + (+n + 100)));
  const b = ren(a);
  Object.assign(b, { id: 2, level: 1, y0: a.y0 + 2.84, plan: [], free: b.free.filter((f) => !/door/.test(f.typeId)) });
  a.roofs = []; a.plan = [];
  d.structs.push(b); d.nextStruct = 3; d.nextPiece = 300;
  __build.restore(d);
  __build.setAllBuilt(false);
});
await page.keyboard.press('KeyB'); await step(70);
const up1 = 2.96;
const house = await G(() => { const ss = __build.structs(); return { n: ss.length, levels: ss.map((s) => s.level), planned: ss.map((s) => s.planned), q: __build.quantities() }; });
console.log('house', JSON.stringify(house));
// paint and trim, so the finished look has them
await G(() => { const y = __game.sim.systems.find((x) => x.name === 'construction'), P = y.api.content.PAINTS; for (const s of __build.structs()) __build.setDeco(s.id, { walls: P[4][0] + '_eggshell', trim: P[1][0] + '_semigloss' }); });
await page.keyboard.press('KeyV'); await step(4);
await page.mouse.move(5, 450); await step(2);
await cam(0.6, 0.42, 17, 2.6);
{
  const s = await pv();
  check('planned two-storey house: Select shows every storey with the roof on and no cut', s.task === 'whole' && s.structs.every((x) => x.visible && x.cutH >= 99 && x.roof) && house.planned.every((n) => n > 0), JSON.stringify(s.structs));
  check('the planned house is drawn finished with its own materials, not the blueprint', s.structs.filter((x) => x.planned).every((x) => x.shell), '');
  check('viewc carries mode, chip, cut, range, ticks and left', s.viewc && s.viewc.mode === 'auto' && s.viewc.chip === '' && s.viewc.cut === null && Array.isArray(s.viewc.range) && s.viewc.ticks.some((t) => t.name === 'Ground') && s.viewc.left === false, JSON.stringify(s.viewc));
  await shot('v1-finished-planned');
}
// the blueprint behind the switch
await G(() => __build.choose('view:left', true)); await step(4);
check('"Show what is left to build" brings the blueprint back', (await pv()).structs.every((x) => !x.shell));
await shot('v1-left-to-build');
await G(() => __build.choose('view:left', false)); await step(4);
// Floor on the ground storey: dollhouse
await G(() => __build.choose('level:set', 0)); await step(2);
await page.keyboard.press('KeyF'); await step(30);
{
  const s = await pv();
  check('Floor on the ground storey: storey 2 hidden, roof off, ground cut at 1.2 m, chip', s.task === 'dollhouse' && s.viewc.chip === 'Cut at 1.2 m' && s.structs.every((x) => (x.level === 0 ? x.visible && Math.abs(x.cutH - 1.2) < 1e-6 && !x.roof : !x.visible)), JSON.stringify(s.structs));
  await cam(0.6, 1.0, 13, 0.4);
  await shot('v1-floor-dollhouse');
}
// the chip's close pins the finished house until the tool changes
await G(() => __build.choose('view:unpin')); await step(30);
check('closing the chip pins the finished house', (await pv()).task === 'pinned' && (await pv()).structs.every((x) => x.visible && x.cutH >= 99));
await page.keyboard.press('KeyN'); await step(30);
check('a new tool unpins: Wall lifts the roof', (await pv()).task === 'lifted' && (await pv()).viewc.chip === 'Roof lifted');
// Door on storey 1 with storey 2 hidden (storey 1 is the ground: the first one)
await page.keyboard.press('KeyJ'); await step(30);
{
  const s = await pv();
  check('Door on the ground storey: storey 2 hidden, chip', s.task === 'facade' && s.viewc.chip === 'Storeys above hidden' && s.structs.every((x) => (x.level === 0 ? x.visible && x.cutH >= 99 : !x.visible)), JSON.stringify(s.structs));
  await cam(0.6, 0.32, 14, 1.6);
  await page.mouse.move(5, 450); await step(2);
  await shot('v1-door-storeys-hidden');
}
// manual Section at 1.5 m
await G(() => __build.choose('view:cut', 1.5)); await step(40);
{
  const s = await pv();
  check('Section at 1.5 m: mode section, the ground storey cut at 1.5 m, storey 2 not drawn', s.mode === 'section' && s.viewc.cut === 1.5 && /1\.50 m above Ground/.test(s.viewc.cutText) && s.structs.every((x) => (x.level === 0 ? Math.abs(x.cutH - 1.5) < 1e-6 : !x.visible)), JSON.stringify([s.viewc, s.structs]));
  await cam(0.6, 0.95, 13, 0.4);
  await shot('v1-section-1.5');
}
await G(() => __build.choose('view:mode', 'auto')); await step(30);
// a finished, furnished house: build everything, furnish, then change what it stands on
// furnishings, set into the saved record: a few of each room's pieces on the ground floor
await G(() => {
  __build.setTool('decor');
  const kinds = [];
  for (const c of __build.view().groups.find((q) => q.id === 'dcat').items) { __build.choose('dcat', c.v); const g = __build.view().groups.find((q) => q.id === 'dkind'); if (g && g.items[0]) kinds.push(g.items[0].v); }
  const d = __build.serialize(), a = d.structs.find((x) => x.level === 0);
  [[-1, -1.4], [1, -1.2], [1, 1.2], [-1, 1.4], [0, 0]].forEach(([x, z], n) => a.decor.push([x, z, kinds[n % kinds.length], 0, 0, 'p' + (400 + n)]));
  d.nextPiece = 500;
  __build.restore(d);
  __build.setTool('select');
});
await step(4);
await G(() => { __game.sim.commandNow('construction.setOption', { key: 'sandbox', value: true }); __build.setAllBuilt(true); }); await step(4);
await G(() => { __game.sim.commandNow('construction.setOption', { key: 'sandbox', value: false }); }); await step(4);
console.log('furnished', JSON.stringify(await G(() => __build.structs().map((x) => [x.level, x.planned, __build.state.structs.find((S) => S.id === x.id).decor.length]))));
await page.keyboard.press('KeyC'); await step(30); await cam(0.6, 1.0, 12, 0.4); await shot('v1-furnished-dollhouse');
await page.keyboard.press('KeyV'); await step(2);
{
  const fl = await G(() => { const ss = __build.structs().find((s) => s.level === 0), f = __build.pieces().find((p) => p.kind === 'floor' && p.struct === ss.id); return f ? f.id : __build.state.structs.find((O) => O.level === 0).regs[0].id; });
  await G((id) => __build.select([id]), fl); await step(4);
  await G(() => __build.choose('s:found', 'piers')); await step(40);
  const s = await pv();
  check('changing what a built, furnished house stands on: the foundation view, ground only, chip', s.task === 'foundation' && s.viewc.chip === 'Showing the foundation' && s.structs.every((x) => (x.level === 0 ? x.visible && x.cutH < 0.2 && x.structure : !x.visible)), JSON.stringify(s.structs));
  await cam(0.6, 0.85, 10, 0);
  await page.mouse.move(5, 450); await step(2);
  await shot('v1-foundation');
  await G(() => { __build.state.vfocus = { k: 'found', until: performance.now() - 1 }; }); await step(4);
  check('the foundation view closes when the change is over', (await pv()).task !== 'foundation');
  await G(() => __build.choose('s:ins', 'mineral_wool')); await step(40);
  check('changing the insulation shows inside the walls', (await pv()).viewc.chip === 'Showing inside the walls');
  await shot('v1-wall-layers');
}
// leaving plan mode gives play its own values back
await page.keyboard.press('KeyB'); await step(80);
{
  const s = await G(() => __build.state.structs.map((S) => ({ v: S.group.visible, c: S.cutH, k: S.clip.constant, r: S.roofOp })));
  check('play: every storey drawn, roofs on and no plan cut', s.every((x) => x.v && x.r === 1 && (x.c >= 99 || x.c > 1.1)), JSON.stringify(s));
}
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
if (fails.length) { console.log(fails.length + ' failed'); process.exitCode = 1; }
