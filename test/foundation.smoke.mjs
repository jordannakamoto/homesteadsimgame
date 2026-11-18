// Foundation view (slices B2-B4) in the page: a slab shed put up in construction mode becomes a foundation job that owns
// its site (build mode does not level it), the layout kit tool opens on key 7, staking the corners raises batter
// boards and strings, the dig overlay is drawn, a dig down to the line finishes the site stage, and a test pour
// holds framing. Drives the page through its own APIs (a headless browser cannot aim a mouse at the ground).
//   node test/foundation.smoke.mjs        (needs dist/index.html and Playwright); SHOTS=<dir> saves two screenshots
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html';
const SHOTS = process.env.SHOTS || '';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [], fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
const G = (fn, arg) => page.evaluate(fn, arg);
await page.goto(file, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__build, null, { timeout: 180000 });
await G(() => localStorage.clear()); await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__game && window.__build && window.__construct && window.__foundation, null, { timeout: 180000 });
await G(() => { const g = __game; g.lockQuality(); g.setQuality('low'); const r = g.renderer; window.__draw = r.render.bind(r); r.render = () => {}; });
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name) => { if (!SHOTS) return; await G(() => window.__draw(__game.scene, __game.camera)); await page.screenshot({ path: SHOTS + '/' + name + '.png', timeout: 120000 }); };
const until = (fn, arg, ms = 60000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 250 }).then(() => true, () => false);

// a slab shed set down in construction mode, a few metres ahead
const sid = await G(() => {
  const B = __build, P = __game.player, H = __game.heightAt;
  // the flattest spot near the player (a slab on a hillside needs fill, not just a base)
  let bx = P.x + 4, bz = P.z + 4, best = Infinity;
  for (let dx = -16; dx <= 16; dx += 2) for (let dz = -16; dz <= 16; dz += 2) {
    const x = P.x + dx, z = P.z + dz;
    if (Math.hypot(dx, dz) < 4) continue;
    let lo = Infinity, hi = -Infinity;
    for (let a = -2; a <= 2; a += 1) for (let b = -2; b <= 2; b += 1) { const h = H(x + a, z + b); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if (hi - lo < best && lo > 0.5) { best = hi - lo; bx = x; bz = z; }
  }
  P.x = bx - 4; P.z = bz - 4;
  B.setConstructionMode(true);
  const r = B.placePlan('shed', bx, bz, 0);
  B.setFoundation(r.struct, 'slab');
  return r.struct;
});
await until((sid) => !!__foundation.job(sid), sid);
check('ghost corners show where to stake', await G(() => __foundation.drawn().ghosts === 4) || (await wait(1500), await G(() => __foundation.drawn().ghosts === 4)));
const j0 = await G((sid) => { const j = __foundation.job(sid); return j && { step: j.step, corners: j.layout.corners.length, digs: j.digs.length, topY: j.topY, target: j.digs[0] && j.digs[0].targetY }; }, sid);
check('a slab shed in construction mode becomes a foundation job', !!j0 && j0.step === 'layout' && j0.corners === 4 && j0.digs === 1, JSON.stringify(j0));
check('its site is dug by hand (build mode leaves the ground)', await G((sid) => __foundation.owns(sid), sid));
check('the construction view points at the layout kit', /layout kit/.test(await G(() => (__construct.nextAction() || {}).line || '')));
console.log('     ground over the pad, above the dig level (m): ' + await G((sid) => { const j = __foundation.job(sid), d = j.digs[0], C = j.layout.corners, out = []; for (const c of C) out.push((__game.ground.surfaceAt(c[0], c[1]) - d.targetY).toFixed(3)); out.push('mid ' + (__game.ground.surfaceAt((C[0][0] + C[2][0]) / 2, (C[0][1] + C[2][1]) / 2) - d.targetY).toFixed(3)); return out.join(' '); }, sid));
check('the dig level is below the slab top', j0 && j0.target < j0.topY - 0.15, j0 && (j0.topY - j0.target).toFixed(3));

// the Site tool on key 7, with the layout kit and the shovel
await G(() => document.getElementById('view').focus());
await page.keyboard.press('Digit7');
await wait(400);
const bar = await G(() => ({ tool: __game.player.tool, open: !document.getElementById('fbar').hidden, slots: __hands.slots.map((s) => s.id), held: __hands.held }));
check('key 7 takes up the site tools', bar.tool === 'site' && bar.open && bar.slots.join() === 'kit,shovel', JSON.stringify(bar));

// stake the corners (the sim command the kit sends after its two blows), and see the boards and strings come up
await G((sid) => { const j = __foundation.job(sid); __game.player.x = j.layout.corners[0][0] - 1.5; __game.player.z = j.layout.corners[0][1] - 1.5; for (let k = 0; k < 4; k++) __game.sim.commandNow('foundation.stake', { jobId: j.id, corner: k }); }, sid);
await until((sid) => __foundation.job(sid).step === 'excavate', sid);
await wait(1500);
const j1 = await G((sid) => { const j = __foundation.job(sid); return { step: j.step, closed: j.layout.closed, hint: document.querySelector('#fbar .ghint').innerText }; }, sid);
check('all corners staked: laid out, dig next', j1.step === 'excavate' && j1.closed, JSON.stringify(j1));
await shot('foundation-laid-out');

// dig part of it (as the shovel would) and check it, then trim the rest with strokes
const frac = await G((sid) => {
  const j = __foundation.job(sid), d = j.digs[0], P = d.poly, x0 = Math.min(...P.map((p) => p[0])), x1 = Math.max(...P.map((p) => p[0])), z0 = Math.min(...P.map((p) => p[1])), z1 = Math.max(...P.map((p) => p[1]));
  const f0 = __game.sim.commandNow('foundation.check', { jobId: j.id }).frac;
  __game.ground.cmd('trim', { region: { poly: [[x0, z0], [x1 - 0.3, z0], [x1 - 0.3, (z0 + z1) / 2], [x0, (z0 + z1) / 2]] }, targetY: d.targetY });
  return [f0, __game.sim.commandNow('foundation.check', { jobId: j.id }).frac];
}, sid);
const dr = await G(() => __foundation.drawn());
check('strings on batter boards and the amber dig overlay are drawn', dr.overlay && dr.tinted > 50 && dr.strands >= 4 && dr.boards === 4, JSON.stringify(dr));
check('digging is read from the ground', frac[1] > frac[0] && frac[0] < 0.97, JSON.stringify(frac));
await shot('foundation-digging');
const after = await G((sid) => {
  const j = __foundation.job(sid), P = j.digs[0].poly;
  __game.ground.cmd('trim', { region: { poly: P }, targetY: j.digs[0].targetY + 0.05 });   // the shovel takes it down to near the line
  __game.sim.commandNow('foundation.check', { jobId: j.id });
  const x1 = Math.max(...P.map((p) => p[0])), z0 = Math.min(...P.map((p) => p[1])), z1 = Math.max(...P.map((p) => p[1]));
  for (let z = z0 + 0.1; z < z1; z += 0.2) __game.sim.commandNow('foundation.trim', { jobId: j.id, x0: x1 - 3.6, z0: z, x1: x1 + 0.3, z1: z });
  return true;
}, sid);
await until((sid) => __foundation.job(sid).step === 'base', sid);
const j2 = await G((sid) => { const j = __foundation.job(sid), pr = __game.sim.state.sys.construction.progress[sid]; return { step: j.step, site: Object.values(pr.members).filter((m) => m.kind === 'site').map((m) => m.built) }; }, sid);
check('trimmed to the line: dug, and the site stage is done', after && j2.step === 'base' && j2.site.length && j2.site.every(Boolean), JSON.stringify(j2));

// B3 and B4 (gravel base, forms, the pour) follow the dig.
// B3: the gravel base by the Yard's own commands (as the gravel, rake and tamper gestures send them)
await G(() => { for (const t of ['shovel', 'rake', 'tamper', 'wheelbarrow']) __game.sim.commandNow('stock.add', { id: t, qty: 1 }); __game.sim.commandNow('stock.add', { id: 'gravel', qty: 1 }); __game.sim.commandNow('stock.add', { id: 'concrete_mix', qty: 36 * 60 }); __game.sim.commandNow('stock.add', { id: 'form_board', qty: 8 }); __game.sim.commandNow('stock.add', { id: 'form_stake', qty: 40 }); });
await wait(600);
const b0 = await G(() => ({ slots: __hands.slots.map((s) => s.id).join(), held: __hands.held, hint: document.querySelector('#fbar .ghint').innerText }));
check('the base step offers gravel, barrow, rake and tamper', /^gravel,barrow,rake,tamper/.test(b0.slots), JSON.stringify(b0));
const base = await G((sid) => {
  const j = __foundation.job(sid), d = j.digs[0], P = d.poly, sim = __game.sim, by = d.baseY;
  const x0 = Math.min(...P.map((p) => p[0])), x1 = Math.max(...P.map((p) => p[0])), z0 = Math.min(...P.map((p) => p[1])), z1 = Math.max(...P.map((p) => p[1]));
  let tipped = 0;
  for (let x = x0 + 0.5; x < x1; x += 0.8) for (let z = z0 + 0.5; z < z1; z += 0.8) { const g = sim.commandNow('foundation.gravel', { jobId: j.id, x, z, m3: 0.1 }); if (g.ok) tipped += g.m3; }
  const lv = (x, z) => by - __game.heightAt(x, z);
  for (let pass = 0; pass < 3; pass++) {
    for (let z = z0 + 0.05; z <= z1 - 0.04; z += 0.2) {
      for (let x = x0 + 0.05; x < x1 - 0.05; x += 0.1) sim.commandNow('landscape.push', { x0: x, z0: z, x1: x + 0.1, z1: z, level: lv(x, z) });
      for (let x = x1 - 0.05; x > x0 + 0.05; x -= 0.1) sim.commandNow('landscape.push', { x0: x, z0: z, x1: x - 0.1, z1: z, level: lv(x, z) });
    }
    for (let z = z0 + 0.1; z <= z1 - 0.1; z += 0.25) for (let x = x0 + 0.1; x <= x1 - 0.1; x += 0.25) sim.commandNow('landscape.rake', { x, z, r: 0.4, k: 0.6 });
  }
  const mid = sim.commandNow('foundation.check', { jobId: j.id });
  for (let p = 0; p < 2; p++) for (let z = z0 + 0.05; z <= z1 - 0.04; z += 0.12) for (let x = x0 + 0.05; x <= x1 - 0.04; x += 0.12) sim.commandNow('landscape.tamp', { x, z });
  return { tipped, mid, end: sim.commandNow('foundation.check', { jobId: j.id }) };
}, sid);
check('gravel raked level, then tamped twice: the base is in', base.mid.gravel > 0.9 && base.mid.compact < 0.5 && base.end.step === 'forms', JSON.stringify(base));
await wait(800);
// B3: forms snapped to the strings and staked
const f1 = await G((sid) => { const j = __foundation.job(sid); for (let k = 0; k < 4; k++) __game.sim.commandNow('foundation.setForm', { jobId: j.id, run: k, n: 4 }); return __foundation.job(sid).step; }, sid);
await wait(800);
const fd = await G(() => ({ d: __foundation.drawn(), slots: __hands.slots.map((s) => s.id).join() }));
check('form boards drawn on the strings, stake marks glowing', f1 === 'forms' && fd.d.boardsDrawn > 10 && fd.d.stakeMarks > 8 && fd.slots === 'board,hammer', JSON.stringify(fd));
await G((sid) => { const j = __foundation.job(sid); for (let k = 0; k < 4; k++) __game.sim.commandNow('foundation.stakeForm', { jobId: j.id, run: k, n: 4 }); }, sid);
await until((sid) => __foundation.job(sid).step === 'pour', sid);
await wait(800);
// B4: mixed in the barrow, tipped, raked, screeded off the forms
const pr0 = await G((sid) => {
  const j = __foundation.job(sid), sim = __game.sim, C = j.layout.corners, cx = C.reduce((a, c) => a + c[0], 0) / 4, cz = C.reduce((a, c) => a + c[1], 0) / 4;
  let r, n = 0;
  const spots = C.map((c) => [cx + (c[0] - cx) * 0.55, cz + (c[1] - cz) * 0.55]).concat([[cx, cz]]);
  do {
    sim.commandNow('foundation.mix', { jobId: j.id, bags: 3 }); sim.commandNow('foundation.mix', { jobId: j.id, waterL: 9 });
    for (let k = 0; k < 10; k++) sim.commandNow('foundation.mix', { jobId: j.id, work: 0.6 });
    r = sim.commandNow('foundation.tip', { jobId: j.id, x: spots[n % 5][0], z: spots[n % 5][1] }); n++;
  } while (r.ok && r.placed < r.needM3 * 1.06 && n < 40);
  for (let x = Math.min(...C.map((c) => c[0])) + 0.1; x < Math.max(...C.map((c) => c[0])); x += 0.25) for (let z = Math.min(...C.map((c) => c[1])) + 0.1; z < Math.max(...C.map((c) => c[1])); z += 0.25) sim.commandNow('foundation.rake', { jobId: j.id, x, z });
  return { ok: r.ok, reason: r.reason, n, placed: r.placed, need: r.needM3 };
}, sid);
await wait(800);
const pd = await G(() => __foundation.drawn());
check('batches mixed and tipped into the forms; the wet field is drawn', pr0.ok && pr0.n > 5 && pd.pour, JSON.stringify(pr0) + ' ' + JSON.stringify(pd));
if (SHOTS) { await G((sid) => { const C = __foundation.job(sid).layout.corners, cx = C.reduce((a, c) => a + c[0], 0) / 4, cz = C.reduce((a, c) => a + c[1], 0) / 4; __game.player.x = cx; __game.player.z = cz + 2.2; }, sid); await wait(1500); }
await shot('foundation-poured');
const sc = await G((sid) => {
  const j = __foundation.job(sid), C = j.layout.corners, sim = __game.sim;
  let u = [1, 0], best = 0;
  for (let k = 0; k < 4; k++) { const a = C[k], b = C[(k + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > best) { best = L; u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; } }
  const al = C.map((c) => c[0] * u[0] + c[1] * u[1]), a0 = Math.min(...al), a1 = Math.max(...al), cx = C.reduce((a, c) => a + c[0], 0) / 4, cz = C.reduce((a, c) => a + c[1], 0) / 4, ac = cx * u[0] + cz * u[1];
  const at = (a) => [cx + u[0] * (a - ac), cz + u[1] * (a - ac)];
  let r, strokes = 0, extra = 0;
  for (let pass = 0; pass < 8 && !(r && r.done); pass++) {
    const fwd = pass % 2 === 0;
    // hollows left behind the board: a batch tipped ahead of it, and another pass
    if (pass >= 2) { sim.commandNow('foundation.mix', { jobId: j.id, bags: 2 }); sim.commandNow('foundation.mix', { jobId: j.id, waterL: 6 }); for (let k = 0; k < 10; k++) sim.commandNow('foundation.mix', { jobId: j.id, work: 0.6 }); const [tx, tz] = at(fwd ? a0 + 0.6 : a1 - 0.6); if (sim.commandNow('foundation.tip', { jobId: j.id, x: tx, z: tz }).ok) extra++; }
    for (let a = fwd ? a0 : a1; fwd ? a < a1 : a > a0; a += fwd ? 0.4 : -0.4) { const [x0, z0] = at(a), [x1, z1] = at(fwd ? Math.min(a1, a + 0.4) : Math.max(a0, a - 0.4)); r = sim.commandNow('foundation.screed', { jobId: j.id, x0, z0, x1, z1 }); strokes++; if (!r.ok || r.done) break; }
  }
  return { ok: r.ok, done: r.done, screed: r.screed, hollow: r.hollow, low: r.low, strokes, extra, leak: __foundation.job(sid).pour.leakM3, step: __foundation.job(sid).step };
}, sid);
check('screeded off the forms: the slab is poured and curing', sc.done && sc.step === 'cure', JSON.stringify(sc));
await until((sid) => { const pr = __game.sim.state.sys.construction.progress[sid]; return pr.hold && Object.keys(pr.hold).length > 0; }, sid, 30000);
const held = await G((sid) => { const pr = __game.sim.state.sys.construction.progress[sid]; return pr.hold ? Object.keys(pr.hold).length : 0; }, sid);
check('the poured slab holds the stages on the concrete', held > 0, 'holds ' + held);

await page.keyboard.press('Escape');
await wait(300);
check('Escape puts the site tools away', await G(() => __game.player.tool !== 'site' && document.getElementById('fbar').hidden));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
if (fails.length) { console.log(fails.length + ' failed'); process.exit(1); }
console.log('foundation smoke: all ok');
