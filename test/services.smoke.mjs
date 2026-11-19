// Services rough-in by hand, with real pointer input: node test/services.smoke.mjs  (needs dist/index.html and Playwright)
// A cabin set down, one outlet circuit planned along a wall (console), then by hand: nail a box (two clicks), drill the
// holes in one sweep, pull the cable along the run, clamp both ends. Then trim-out by hand (S9b): a switch stripped, landed
// and folded in, a breaker pressed in, the main thrown, the light on, the switch, the tester, a trip reset. Screenshots go to /tmp/sv-*.png.
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

// ---------------------------------------------------------------- trim-out by hand (S9b)
// a generator and a 100 A panel on the wall (console), one circuit from it: a switch box, a ceiling light after it and the
// outlet box roughed in above (all already roughed in, console); then by hand: strip, land and fold the switch, press the
// breaker, throw the main, the light comes on; the switch puts it out; the tester passes; a tripped breaker is reset.
const TR = await G(() => {
  const sim = __game.sim, R = sim.state.sys.routes, A = sim.systems.find((q) => q.name === 'routes').api;
  const run0 = Object.values(R.runs)[0], frame = run0.frame, f = R.frames[frame], ch = __game.routes.channelsFor(frame), w = ch.walls[0];
  const inX = -w.n[0] * w.out, inZ = -w.n[1] * w.out, off = (w.SD || 0.09) / 2 + (w.finish || 0) - 0.035;
  const at = (d, h, k = off) => [w.o[0] + w.u[0] * d + inX * k, w.yb + h, w.o[1] + w.u[1] * d + inZ * k];
  const toW = (p) => A.worldOf(R, frame, p), yaw = Math.atan2(inX * Math.cos(f.yaw) + inZ * Math.sin(f.yaw), -inX * Math.sin(f.yaw) + inZ * Math.cos(f.yaw));
  const pw = toW(at(0.25, 1.0, 0.11));
  const [gen, pnl] = __build.addFixtures([{ fixture: 'gen_petrol_5500w', x: pw[0] + Math.sin(yaw) * 4, z: pw[2] + Math.cos(yaw) * 4 }, { fixture: 'panel_ac_100a', x: pw[0], z: pw[2], y: pw[1], yawRad: yaw, mount: 'wall' }]);
  const cn = __build.connect(gen, 'ac', pnl, 'main', { gauge: 6 });
  sim.commandNow('construction.setOption', { key: 'instant', value: true });
  const c = (n, p) => sim.commandNow('routes.' + n, p);
  const slotAt = at(0.25, 1.3, 0.11), swAt = at(1.0, 1.2), lampAt = [...at(1.2, 0, 1.0)]; lampAt[1] = ch.attic ? ch.attic.y - 0.05 : w.yb + 2.3;
  const slot = c('addNode', { kind: 'slot', frame, at: slotAt, ref: { piece: pnl, port: 'b1' } }).id;
  const sw = c('addNode', { kind: 'box', frame, at: swAt, host: { parent: w.id }, state: 'set', set: { preset: 'switch' } }).id;
  const lamp = c('addNode', { kind: 'box_ceiling', frame, at: lampAt, state: 'set' }).id;
  const boxA = run0.a;
  c('addRun', { cls: 'cable', spec: 'cable_nm_14_2', frame, a: slot, b: sw, path: [slotAt, swAt], hosts: [w.id], state: 'done' });
  c('addRun', { cls: 'cable', spec: 'cable_nm_14_2', frame, a: sw, b: lamp, path: [swAt, [swAt[0], lampAt[1], swAt[2]], lampAt], state: 'done' });
  c('addRun', { cls: 'cable', spec: 'cable_nm_14_2', frame, a: sw, b: boxA, path: [swAt, [swAt[0], 0.4 + w.yb, swAt[2]], R.nodes[boxA].at], hosts: [w.id], state: 'done' });
  sim.commandNow('services.sync');
  const o = sim.commandNow('construction.order', { structId: frame, stage: 'trim-out' });
  return { frame, slot, sw, lamp, boxA, gen, pnl, conn: cn && cn.ok, order: o.ok, reason: o.reason };
});
check('a panel on the wall, one circuit roughed in, the trim-out ordered', TR.conn && TR.order, JSON.stringify(TR));
await frames(6);
check('the generator runs', await until((g) => { const E = __game.sim.state.sys.electrical, x = E.sources && E.sources[g]; if (x) __game.sim.commandNow('electrical.switch', { pieceId: g, on: true }); return !!(x && x.running); }, TR.gen, 100));
const trimAt = async (kind, node) => { const t = await G(([k, n]) => (__servicesTrim.targets()[k] || []).findIndex((q) => !n || q.node === n), [kind, node]); return t < 0 ? null : G(([k, i]) => __servicesTrim.where(k, i), [kind, t]); };
const tsw = await trimAt('trim', TR.sw);
check('the switch box waits for its device', !!tsw && tsw.next === 'strip' && tsw.device === 'switch_single', JSON.stringify(tsw));
await page.mouse.move(tsw.screen.x, tsw.screen.y); await frames(3);
check('aiming at it says click to strip', /strip the cable ends/.test(await hint()), await hint());
await page.mouse.down(); await page.mouse.up(); await frames(2);
let ti = await G((n) => __game.sim.systems.find((q) => q.name === 'services').api.trimInfo(__game.sim.state.sys.routes, __game.sim.state.sys.routes.nodes[n]), TR.sw);
check('one click strips the three ends (3x)', ti.done.strip === 3 && ti.next === 'land', JSON.stringify(ti.done));
await page.mouse.move(tsw.screen.x, tsw.screen.y); await frames(3);
check('then it says drag to land', /Drag/.test(await hint()), await hint());
await page.mouse.down();
for (let i = 1; i <= 6; i++) { await page.mouse.move(tsw.screen.x + i * 8, tsw.screen.y + i * 3); await frames(1); }
await shot('4-landing');
await page.mouse.up(); await frames(2);
ti = await G((n) => __game.sim.systems.find((q) => q.name === 'services').api.trimInfo(__game.sim.state.sys.routes, __game.sim.state.sys.routes.nodes[n]), TR.sw);
check('one drag lands the wires on the switch', ti.done.land === 3 && ti.next === 'fold', JSON.stringify(ti.done));
await page.mouse.move(tsw.screen.x, tsw.screen.y); await frames(3);
await page.mouse.down(); await page.mouse.up(); await frames(6);
check('a click folds it in and puts the plate on', await G((n) => __game.sim.state.sys.routes.nodes[n].state === 'trimmed', TR.sw));
// the light and the outlet: the same steps, from the console
await G((ids) => { for (const n of [ids.lamp, ids.boxA]) for (let i = 0; i < 4; i++) __game.sim.commandNow('services.trim', { node: n, n: 4 }); }, TR);
check('the light and the outlet are in', await G((ids) => [ids.lamp, ids.boxA].every((n) => __game.sim.state.sys.routes.nodes[n].state === 'trimmed'), TR));
// the breaker
await frames(3);
const tsl = await trimAt('slot');
check('the empty slot on the panel is a target', !!tsl, JSON.stringify(await G(() => __servicesTrim.targets())));
await page.mouse.move(tsl.screen.x, tsl.screen.y); await frames(3);
check('aiming at it says press a breaker in', /breaker into the panel/.test(await hint()), await hint());
await page.mouse.down(); await page.mouse.up(); await frames(3);
check('a click presses the breaker in; the main goes off', await G((ids) => __game.sim.state.sys.routes.nodes[ids.slot].state === 'trimmed' && __game.sim.state.sys.services.mains[ids.pnl] === false, TR));
await page.waitForTimeout(1500);
check('main off: the light is dark', (await G(() => __servicesTrim.lamps()))[0].glow === 0, JSON.stringify(await G(() => __servicesTrim.lamps())));
const tm = await G(() => __servicesTrim.where('main'));
await page.mouse.move(tm.screen.x, tm.screen.y); await frames(3);
check('aiming at the main says drag it up', /Drag.*up/.test(await hint()), await hint());
await page.mouse.down();
for (let i = 1; i <= 5; i++) { await page.mouse.move(tm.screen.x, tm.screen.y - i * 6); await frames(1); }
await page.mouse.up(); await frames(2);
check('dragging the handle up throws the main', await G((ids) => __game.sim.state.sys.services.mains[ids.pnl] === true, TR));
const lit = await until(() => __servicesTrim.lamps()[0].glow >= 1, null, 200);
await shot('5-lit');
check('the light comes on', lit, JSON.stringify(await G(() => ({ lamps: __servicesTrim.lamps(), light: __servicesTrim.light() }))));
check('one pooled point light at it', (await G(() => __servicesTrim.light().intensity)) > 0);
// the wall switch
const ts = await trimAt('switch', TR.sw);
await page.mouse.move(ts.screen.x, ts.screen.y); await frames(3);
check('aiming at the switch says click', /switch: off/.test(await hint()), await hint());
await page.mouse.down(); await page.mouse.up();
check('clicking the switch puts the light out', await until(() => __servicesTrim.lamps()[0].glow === 0, null, 100));
await page.mouse.down(); await page.mouse.up();
check('and on again', await until(() => __servicesTrim.lamps()[0].glow >= 1, null, 200));
// the tester
const tt = await G(() => __servicesTrim.where('tester'));
await page.mouse.move(tt.screen.x, tt.screen.y); await frames(3);
check('aiming at the tester says hold', /Hold.*test/.test(await hint()), await hint());
await page.mouse.down();
await until(() => __servicesTrim.busy === 'test', null, 60);
await page.mouse.up();
await until(() => !__servicesTrim.busy, null, 200);
check('the tester walks the circuit and passes: a green tag', await G((f) => { const c = __game.sim.state.sys.services.checks[f]; return !!(c && c.power && c.power.pass) && __servicesTrim.targets().tester[0].tag; }, TR.frame));
// overload the outlet: the breaker trips, says why, and a click resets it
await G((ids) => { const sim = __game.sim; sim.commandNow('electrical.setLoad', { id: 'smoke-heater', pieceId: 'sv:' + ids.boxA, ratedW: 4000, on: true }); sim.runTicks(30); }, TR);
check('the breaker trips', await until(() => __servicesTrim.targets().breaker[0].tripped, null, 50));
await G(() => __game.sim.commandNow('electrical.removeLoad', { id: 'smoke-heater' }));
const tb = await G(() => __servicesTrim.where('breaker'));
await page.mouse.move(tb.screen.x, tb.screen.y); await frames(3);
check('hovering the tripped breaker names the cause', /Tripped.*drew \d+ A/.test(await hint()), await hint());
await page.mouse.down(); await page.mouse.up(); await frames(3);
check('a click resets it and the light comes back', await until(() => !__servicesTrim.targets().breaker[0].tripped && __servicesTrim.lamps()[0].glow >= 1, null, 200));
check('the devices, plate and breaker came off the stacks; the books balance', await G((f) => { const s = __game.sim.state.sys.construction, pr = s.progress[f], u = (it) => Object.values(pr.lines).filter((l) => l.itemId === it).reduce((n, l) => n + l.used, 0); return u('elec_switch') === 1 && u('elec_plate_switch') === 1 && u('elec_light_ceiling') === 1 && u('elec_breaker_15') === 1 && Object.keys(__game.sim.systems.find((q) => q.name === 'construction').api.imbalance(s)).length === 0; }, TR.frame));
await shot('6-trimmed');
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails.length ? fails.length + ' FAILED' : 'all ok');
process.exit(fails.length ? 1 : 0);
