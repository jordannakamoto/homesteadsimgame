// Build mode's extension point (X1) on the page: node test/build-ext.smoke.mjs  (needs dist/index.html and Playwright)
// Injects the test fixture extension (test/fixtures/build-ext-post.js, not shipped) and checks that its member shows in
// membersOf, materialsList, the piece list and construction, survives undo and redo, and a save and reload; and that its
// tool reaches the bar, the options strip and choose().
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html', fixture = process.cwd() + '/test/fixtures/build-ext-post.js';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage(); page.setDefaultTimeout(180000);
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const errors = [], fails = [];
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
const G = (fn, arg) => page.evaluate(fn, arg);
async function load(fresh) {
  await page.goto(file, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__game && window.__build && window.__build.view, null, { timeout: 180000 });
  await G((fresh) => {
    const g = __game; g.lockQuality(); g.setQuality('low');
    if (fresh) (localStorage.clear(), __build.reset());
    const r = g.renderer; window.__draw = r.render.bind(r); r.render = () => {};
    window.__step = (n = 2) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
  }, fresh);
}
const step = (n = 2) => G((n) => window.__step(n), n);
const report = (id) => G((id) => {
  const mid = 'x-xpost-' + id + '-0', mw = __build.membersOf(id), pr = __game.sim.state.sys.construction.progress[id], piece = __build.piece(mid);
  return { ext: __build.getExt(id, 'xpost'), member: mw.list.some((m) => m.id === mid + '.post'), planned: mw.planned.has(mid + '.post'),
    listed: __build.materialsList(id).some((l) => l.members.some((q) => q[0] === mid + '.post') && l.itemId === 'lumber_4x4'),
    piece: !!piece && (piece.members || []).includes(mid + '.post'), sim: !!(pr && pr.members[mid + '.post']) };
}, id);

await load(true);
await step(10);
await page.addScriptTag({ path: fixture });
await G(() => __build.setConstructionMode(true));
const id = await G(() => { const g = __game; __build.placePlan('shed', g.player.x + 7, g.player.z + 2, 0); return __build.state.structs[__build.state.structs.length - 1].id; });
await step(10);
check('a plan is down and nothing of the extension yet', !(await report(id)).member);
check('setExt stores the data', await G((id) => __build.setExt(id, 'xpost', { posts: [[0, -2.2]] }), id));
await step(30);
let r = await report(id);
check('the fixture member is in membersOf, unbuilt in a plan', r.member && r.planned, JSON.stringify(r));
check('it is on the shopping list as 4x4 lumber', r.listed);
check('its parent piece lists it', r.piece);
check('construction.setPlan carries it', r.sim);
check('setExt refuses an extension nobody registered', !(await G((id) => __build.setExt(id, 'nobody', { a: 1 }), id)));

// undo and redo
await G(() => __build.choose('undo')); await step(4);
r = await report(id);
check('undo takes it away', !r.member && !r.ext, JSON.stringify(r));
await G(() => __build.choose('redo')); await step(4);
r = await report(id);
check('redo puts it back', r.member && r.ext && r.ext.posts.length === 1, JSON.stringify(r));

// the tool: a button on the bar, its options, its choose() ids
await page.keyboard.press('KeyB'); await step(20);
const tool = await G(() => { __build.setTool('xpost-tool'); const v = __build.view(); __build.choose('x:xpost-tool:size', 3);
  return { inTools: v.tools.some((t) => t.id === 'xpost-tool'), button: !!document.querySelector('#bpieces button[data-piece="xpost-tool"]'), opts: v.groups.some((q) => /Posts/.test(JSON.stringify(q))), chosen: window.__xpostChosen, top: v.top }; });
check('the tool is on the bar with its options', tool.inTools && tool.button && tool.opts && tool.top === 'xpost-tool', JSON.stringify(tool));
check('its options report through choose()', JSON.stringify(tool.chosen) === '["size",3]');
await G(() => __build.setTool('select')); await page.keyboard.press('KeyB'); await step(6);
await G(() => { window.__step(1); window.__draw(__game.scene, __game.camera); });

// save and reload: the data comes back with the building; the member returns once the extension is loaded again
await G(() => __build.save()); await step(2);
await load(false);
await step(20);
r = await report(id);
check('the data survives a reload, even before the extension is loaded', !!(r.ext && r.ext.posts.length === 1), JSON.stringify(r));
await page.addScriptTag({ path: fixture }); await step(20);
r = await report(id);
check('the member comes back once the extension registers', r.member && r.listed && r.piece, JSON.stringify(r));
check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close();
if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
console.log('\nall passed');
