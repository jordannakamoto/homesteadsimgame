// Plan mode: adding a door to an unbuilt design builds nothing. node test/plan-unbuilt.smoke.mjs (needs dist/index.html)
// Build mode, driven the way a player drives it: node test/build.smoke.mjs  (needs dist/index.html and Playwright)
// Builds a small house with pointer events on the canvas, then checks the piece list, exact typed sizes,
// selection and remodeling, undo and redo, saving, and that a phone can reach every tool and option.
// Software rendering manages about a frame a second here, so drawing is switched off and frames are stepped
// by hand; a real frame is drawn at the end of each part.
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
    __build.setConstructionMode(true);   // this test draws buildings that are built at once
    __build.setFixtureCatalog(null);     // and places the demonstration equipment, not the game's catalog
    const r = g.renderer; window.__draw = r.render.bind(r); r.render = () => {};
    window.__step = (n = 2) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
  });
  const step = (n = 2) => G((n) => window.__step(n), n);
  // a real frame, so shader and draw errors surface
  const draw = () => G(() => { window.__step(1); window.__draw(__game.scene, __game.camera); });
  return { ctx, page, G, step, draw };
}

/* ---------- */
{
  const { ctx, page, G, step, draw } = await open({ viewport: { width: 1280, height: 720 } });
  await page.keyboard.press('KeyB'); await step(70);
  // screen position of a point given in a frame's own metres (the building's grid), at a height above its base
  const at = (lx, lz, up = 0.12) => G(([lx, lz, up]) => {
    const g = __game, S = __build.state.structs[0] || window.__F, [x, z] = __build.toWorld(S, lx, lz);
    const v = new g.THREE.Vector3(x, (S.y0 === undefined ? g.heightAt(x, z) : S.y0) + up, z).project(g.camera), r = g.renderer.domElement.getBoundingClientRect();
    return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height];
  }, [lx, lz, up]);
  const move = async (p) => { await page.mouse.move(p[0], p[1]); await step(2); };
  const click = async (p) => { await move(p); await page.mouse.down(); await page.mouse.up(); await step(2); };
  const drag = async (a, b) => { await move(a); await page.mouse.down(); await step(1); await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); await step(1); await move(b); await page.mouse.up(); await step(3); };
  const pieces = (f) => G((f) => __build.pieces().filter((p) => (!f && !p.parent) || (p.kind === f && (!p.parent || f === 'door' || f === 'window'))).map((p) => ({ id: p.id, kind: p.kind, type: p.type, material: p.material, length: p.length, height: p.height, area: p.area, netArea: p.netArea, y0: p.y0, y1: p.y1, wall: p.wall, free: p.free, layers: p.layers, pitchDeg: p.pitchDeg, planArea: p.planArea, openings: (p.openings || []).map((o) => ({ id: o.id, kind: o.kind, offset: o.offset, width: o.width })) })), f);

  // the new building's grid: ahead of the player, clear of the bar, facing the way the view does
  await G(() => { __game.cam.dist = 44; }); await step(30);
  await page.keyboard.press('KeyR'); await step(2);
  await G(() => { const g = __game, c = g.cam, x = g.player.x - Math.sin(c.yaw) * 1 - Math.cos(c.yaw) * 5, z = g.player.z - Math.cos(c.yaw) * 1 + Math.sin(c.yaw) * 5; const r = g.renderer.domElement.getBoundingClientRect(), v = new g.THREE.Vector3(x, g.heightAt(x, z), z).project(g.camera); window.__p0 = [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height]; });
  await move(await G(() => window.__p0));
  await G(() => { const p = __build.state.pending; window.__F = { ox: p.ox, oz: p.oz, yaw: p.yaw }; });
  // a room 5 m by 4 m, in one drag
  await move(await at(0, 0)); await page.mouse.down(); await step(1);
  await G(() => { window.__F.y0 = __build.state.drag.F.y0; });   // the stroke runs on a level plane from where it began
  await move(await at(3, 2, 0)); await move(await at(5, 4, 0));
  await page.mouse.up(); await step(3);

  const rep = () => G(() => { const S = __build.state.structs[0]; __build.structs(); const m = __build.membersOf(S.id); return { total: m.list.length, planned: m.planned.size, built: m.list.filter((x) => !m.planned.has(x.id)).map((x) => x.id + ':' + x.kind).slice(0, 8), simBuilt: Object.values(__game.sim.state.sys.construction.progress[S.id]?.members || {}).filter((x) => x.built).length }; });
  console.log('room', JSON.stringify(await rep()));
  await page.keyboard.press('KeyJ'); await move(await at(2.5, 4, 1.2)); console.log('hover', JSON.stringify(await rep()));
  await page.mouse.down(); await page.mouse.up(); await step(4);
  { const r = await rep(); if (r.built.length || r.simBuilt) { console.log('FAIL a door added in plan mode built part of the blueprint', JSON.stringify(r)); process.exitCode = 1; } else console.log('ok   a door added in plan mode leaves the whole blueprint unbuilt'); }
  await ctx.close();
}
await browser.close(); console.log(errors.slice(0,3));
