// Services rough-in by hand, with real pointer input: node test/services.smoke.mjs  (needs dist/index.html and Playwright)
// A cabin set down, one outlet circuit planned along a wall (console), then by hand: nail a box (two clicks), drill the
// holes in one sweep, pull the cable along the run, clamp both ends. Screenshots go to /tmp/sv-*.png.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.setDefaultTimeout(180000);
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const errors = [], fails = [];
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const G = (fn, arg) => page.evaluate(fn, arg);
const frames = async (n) => { const f0 = await G(() => __game.renderer.info.render.frame); for (let i = 0; i < 400; i++) { await page.waitForTimeout(50); if ((await G(() => __game.renderer.info.render.frame)) - f0 >= n) return; } throw new Error('page stopped rendering'); };
const until = async (fn, arg, tries = 160) => { for (let i = 0; i < tries; i++) { if (await G(fn, arg)) return true; await page.waitForTimeout(100); } return false; };
const hint = () => G(() => document.getElementById('reachhint').textContent);
const shot = (name) => page.screenshot({ path: '/tmp/sv-' + name + '.png' });

await page.goto(file, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__build, null, { timeout: 180000 });
await G(() => localStorage.clear()); await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__build && window.__servicesPlan && window.__servicesHands, null, { timeout: 180000 });
await G(() => { __game.lockQuality(); __game.setQuality('low'); __game.setSpeed(1); });
await frames(4);

// a cabin, and one outlet circuit planned along its first wall: two boxes, holes through the studs between
const plan = await G(() => {
  const P = __game.player, r = __build.placePlan('cabin', P.x + 6, P.z, 0), s = __build.structs().find((q) => q.id === r.struct);
  const ch = __game.routes.channelsFor(s.id), w = ch.walls[0], at = (d, h) => [w.o[0] + w.u[0] * d, w.yb + h, w.o[1] + w.u[1] * d];
  const p = __servicesPlan.plan('power', at(0.5, 0.4), at(2.6, 0.4), 'outlet');
  __servicesPlan.setMode(null);
  const run = Object.values(__game.sim.state.sys.routes.runs)[0];
  // stand inside, a pace back from the wall's middle, facing it
  const f = __game.sim.state.sys.routes.frames[run.frame], mid = at(1.6, 0);
  P.x = f.x + mid[0] - w.n[0] * w.out * 1.3; P.z = f.z + mid[2] - w.n[1] * w.out * 1.3;
  __game.cam.yaw = Math.atan2(w.n[0] * w.out, w.n[1] * w.out) + Math.PI; __game.cam.tx = P.x; __game.cam.tz = P.z;
  return { p, run: run && run.id, bores: run ? run.bores.length : 0 };
});
check('a planned outlet circuit with holes to drill', plan.p.ok && plan.bores >= 3, JSON.stringify(plan));
const RUN = plan.run;
await frames(6);
if (await G(() => __reach.on)) { await page.keyboard.press('KeyF'); await frames(3); }      // planning took the hands out already
await page.keyboard.press('KeyF'); await frames(6);
check('the hint line lists the rough-in work', /Rough-in: .*holes to drill/.test(await hint()), await hint());

// a box: two clicks
const box = await G(() => __servicesHands.where('box'));
await page.mouse.move(box.screen.x, box.screen.y); await frames(3);
check('aiming at a pale box says two clicks', /twice/.test(await hint()), await hint());
await page.mouse.down(); await page.mouse.up(); await frames(2);
await page.mouse.down(); await page.mouse.up(); await frames(2);
// nothing ordered yet: the box is not there to nail (S8: rough-in material comes through the Build panel)
check('with nothing ordered, the box stays planned', await G((id) => __game.sim.state.sys.routes.nodes[id].state === 'planned', box.node));
const ord = await G((frame) => {
  const sim = __game.sim; sim.state.sys.stock.money = 1e5;
  sim.commandNow('construction.setOption', { key: 'instant', value: true }); sim.commandNow('services.sync');
  const v = sim.systems.find((q) => q.name === 'construction').api.buildingView(sim.state.sys.construction, frame), st = v && v.stages.find((q) => q.id === 'rough-in');
  const r = sim.commandNow('construction.order', { structId: frame, stage: 'rough-in' });
  return { ok: r.ok, reason: r.reason, stage: !!st, after: v ? v.stages.map((q) => q.id).slice(v.stages.findIndex((q) => q.id === 'rough-in') - 1, v.stages.findIndex((q) => q.id === 'rough-in') + 2).join() : '', cable: sim.state.sys.construction.stacks.filter((k) => k.itemId === 'nm_cable_14_2').reduce((n, k) => n + k.qty, 0) };
}, (await G((id) => __game.sim.state.sys.routes.runs[id].frame, RUN)));
check('the Build panel lists rough-in after the gutters; ordering it brings the cable', ord.ok && ord.stage && /^gutters,rough-in,insulation$/.test(ord.after) && ord.cable > 2, JSON.stringify(ord));
await page.mouse.move(box.screen.x, box.screen.y); await frames(3);
await page.mouse.down(); await page.mouse.up(); await frames(2);
await page.mouse.down(); await page.mouse.up(); await frames(2);
check('two clicks nail the box', await G((id) => __game.sim.state.sys.routes.nodes[id].state === 'set', box.node), JSON.stringify(await G((id) => { const sim = __game.sim, n = sim.state.sys.routes.nodes[id], sv = sim.systems.find((q) => q.name === 'services').api; return { state: n.state, frame: n.frame, cost: sv.nodeCost(n), use: sim.commandNow('construction.use', { structId: n.frame, itemId: 'elec_box_wall', qty: 1, from: 'stacks', check: true }), say: (document.getElementById('reachsay') || {}).textContent, hint: document.getElementById('reachhint').textContent }; }, box.node)));
const box2 = await G(() => __servicesHands.where('box'));
if (box2) { await page.mouse.move(box2.screen.x, box2.screen.y); await frames(3); for (let i = 0; i < 2; i++) { await page.mouse.down(); await page.mouse.up(); await frames(2); } }
check('and the other box', !(await G(() => __servicesHands.where('box'))));

// drill: hold on the first dot and sweep along the rest
const dots = await G(() => __servicesHands.targets().bores.map((b) => ({ ...__servicesHands.screen(b.w[0], b.w[1], b.w[2]), reach: b.reach })));
check('every hole is within reach from here', dots.every((d) => d.reach), JSON.stringify(dots));
await page.mouse.move(dots[0].x, dots[0].y); await frames(3);
check('aiming at a dot explains the sweep', /sweep/.test(await hint()), await hint());
await page.mouse.down();
for (let i = 1; i < dots.length; i++) for (let k = 1; k <= 4; k++) { await page.mouse.move(dots[i - 1].x + (dots[i].x - dots[i - 1].x) * k / 4, dots[i - 1].y + (dots[i].y - dots[i - 1].y) * k / 4); await frames(1); }
await shot('1-drilling');
await page.mouse.up();
check('one sweep drills every hole', await until((id) => __game.sim.state.sys.routes.runs[id].bores.every((b) => b.done), RUN), JSON.stringify(await G((id) => __game.sim.state.sys.routes.runs[id].bores.map((b) => b.done), RUN)));

// pull: grab the cable end, drag along the run
await until(() => !__servicesHands.busy);
const pull = await G(() => __servicesHands.where('pull'));
check('the run now waits to be pulled', !!pull && pull.run === RUN);
const pts = await G((id) => { const p = __servicesHands.pathOf(id), out = []; for (let s = 0; s <= p.L + 1e-6; s += 0.12) { let a = 0; for (let i = 1; i < p.wp.length; i++) { const q = p.wp[i - 1], r = p.wp[i], l = Math.hypot(r[0] - q[0], r[1] - q[1], r[2] - q[2]); if (s <= a + l || i === p.wp.length - 1) { const k = l ? Math.min(1, (s - a) / l) : 0; out.push(__servicesHands.screen(q[0] + (r[0] - q[0]) * k, q[1] + (r[1] - q[1]) * k, q[2] + (r[2] - q[2]) * k)); break; } a += l; } } const e = p.wp[p.wp.length - 1]; out.push(__servicesHands.screen(e[0], e[1], e[2])); return out; }, RUN);
await page.mouse.move(pull.screen.x, pull.screen.y); await frames(3);
check('aiming at the cable end says hold and drag', /drag along the run/.test(await hint()), await hint());
await page.mouse.down();
for (const q of pts) { await page.mouse.move(q.x, q.y); await frames(2); }
for (let i = 0; i < 6; i++) { await page.mouse.move(pts[pts.length - 1].x + (i % 2), pts[pts.length - 1].y); await frames(2); }
await shot('2-pulled');
await page.mouse.up(); await frames(2);
const pulled = await G((id) => __game.sim.state.sys.routes.runs[id].pulled, RUN);
check('dragging along the run pulls the cable through', pulled >= 1, 'pulled ' + pulled);
check('staples went in behind it', (await G(() => __servicesHands.fixings().staples)) > 0, JSON.stringify(await G(() => __servicesHands.fixings())));

// clamp both ends: hold on each
for (let k = 0; k < 2; k++) {
  const e = await G(() => __servicesHands.where('end'));
  if (!e) break;
  await page.mouse.move(e.screen.x, e.screen.y); await frames(3);
  if (k === 0) check('aiming at an end says hold to clamp', /Hold.*clamp/.test(await hint()), await hint());
  await page.mouse.down();
  await until((n) => !__servicesHands.where('end') || __servicesHands.where('end').node !== n, e.node, 60);
  await page.mouse.up(); await frames(2);
}
const st = await G((id) => { const r = __game.sim.state.sys.routes.runs[id]; return { joined: r.joined, state: r.state }; }, RUN);
check('both ends clamped: the run is roughed in', st.joined.a && st.joined.b && st.state === 'roughed', JSON.stringify(st));
check('the box, the cable, staples and plates were drawn from the stacks; the books balance', await G(() => { const s = __game.sim.state.sys.construction, pr = Object.values(s.progress).find((p) => Object.values(p.lines).some((l) => l.ext)), u = (it) => Object.values(pr.lines).filter((l) => l.itemId === it).reduce((n, l) => n + l.used, 0); return u('elec_box_wall') === 2 && u('nm_cable_14_2') > 2 && u('cable_staple') > 0 && Object.keys(__game.sim.systems.find((q) => q.name === 'construction').api.imbalance(s)).length === 0; }));
await shot('3-roughed');
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails.length ? fails.length + ' FAILED' : 'all ok');
process.exit(fails.length ? 1 : 0);
