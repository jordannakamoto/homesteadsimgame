// Foundation view (slice B2) in the page: a slab shed put up in construction mode becomes a foundation job that owns
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
  const B = __build, P = __game.player;
  B.setConstructionMode(true);
  const r = B.placePlan('shed', P.x + 4, P.z + 4, 0);
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

// a test pour: framing waits for the concrete
const pour = await G(() => __foundation.debugPour());
await until((sid) => { const pr = __game.sim.state.sys.construction.progress[sid]; return pr.hold && Object.keys(pr.hold).length > 0; }, sid, 30000);
const held = await G((sid) => { const pr = __game.sim.state.sys.construction.progress[sid]; return pr.hold ? Object.keys(pr.hold).length : 0; }, sid);
check('a test pour holds the stages on the concrete', pour.ok && held > 0, JSON.stringify(pour) + ' holds ' + held);

await page.keyboard.press('Escape');
await wait(300);
check('Escape puts the site tools away', await G(() => __game.player.tool !== 'site' && document.getElementById('fbar').hidden));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
if (fails.length) { console.log(fails.length + ' failed'); process.exit(1); }
console.log('foundation smoke: all ok');
