// Browser smoke test of the interface kit (window.__ui): node test/ui.smoke.mjs  (needs dist/index.html and Playwright)
// Skins switch live and survive a reload; kit panels open, close on Esc and one at a time; dock, toast and prompt work;
// the HUD's pinned elements do not overlap at 1440x900 and 390x844. Saves dist/ui-<skin>-<size>.png for a look.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const file = 'file://' + process.cwd() + '/dist/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const fails = [], warns = [];
const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
// The phone layout lands in S9; until then a phone overlap is reported, not failed.
const PHONE_OVERLAP_IS_FAILURE = false;
const warn = (name, ok, info = '') => { if (ok) return check(name, true, info); console.log('WARN ' + name + (info ? '  ' + info : '')); warns.push(name); };

async function open(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage(); page.setDefaultTimeout(180000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 400)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
  const G = (fn, arg) => page.evaluate(fn, arg);
  const frames = async (n) => { const f0 = await G(() => __game.renderer.info.render.frame); for (let i = 0; i < 240; i++) { await page.waitForTimeout(250); if ((await G(() => __game.renderer.info.render.frame)) - f0 >= n) return; } throw new Error('page stopped rendering'); };
  const load = async () => { await page.goto(file, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(8000); await G(() => { __game.lockQuality(); __game.setQuality('low'); }); };
  const reload = async () => { await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(8000); await G(() => { __game.lockQuality(); __game.setQuality('low'); }); };
  await load();
  return { ctx, page, errors, G, frames, reload };
}

const HUD = ['#stock', '#vitals', '#hud-top', '#dock', '#tools', '#tsl', '#tsr', '#cvnext'];
const overlaps = (G) => G((sels) => {
  const vis = (el) => {
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  };
  const items = sels.map((s) => [s, document.querySelector(s)]).filter(([, el]) => el && vis(el)).map(([s, el]) => [s, el.getBoundingClientRect()]);
  const hits = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const [a, A] = items[i], [b, B] = items[j];
    const w = Math.min(A.right, B.right) - Math.max(A.left, B.left), h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
    if (w > 1 && h > 1) hits.push(a + ' x ' + b + ' (' + Math.round(w) + 'x' + Math.round(h) + ')');
  }
  return { seen: items.map(([s]) => s), hits };
}, HUD);
const surface2 = (G) => G(() => getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim());

async function layoutPass(P, size, phone) {
  for (const skin of ['cozy', 'minimal']) {
    await P.G((s) => __ui.skin.set(s), skin); await P.frames(3); await P.page.waitForTimeout(400);
    const o = await overlaps(P.G);
    const name = 'no HUD overlap, ' + skin + ' ' + size;
    const info = o.hits.length ? o.hits.join('; ') : 'checked ' + o.seen.join(' ');
    if (phone && !PHONE_OVERLAP_IS_FAILURE) warn(name, o.hits.length === 0, info); else check(name, o.hits.length === 0, info);
    await P.page.screenshot({ path: 'dist/ui-' + skin + '-' + size + '.png' });
  }
}

// ---- desktop: the API, then the layout ----
const D = await open({ viewport: { width: 1440, height: 900 } });
const { G } = D;
check('__ui exists with the kit', await G(() => !!(window.__ui && __ui.skin && __ui.icon && __ui.icons && __ui.mount && __ui.panel && __ui.dock && __ui.toast && __ui.prompt)));
check('lanes are on the page', await G(() => ['bottom', 'context', 'prompt', 'toast', 'left', 'drawer'].every((n) => document.getElementById('ui-lane-' + n) === __ui.lanes[n])));
check('icons render as currentColor svg', await G(() => { const s = __ui.icon('coin'); return /^<svg class="ui-ic/.test(s) && /currentColor/.test(s) && __ui.icon('nope') === ''; }));

// skins
const skinRes = await G(() => {
  let ev = 0; const on = () => ev++; window.addEventListener('ui:skin', on);
  const val = () => getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim();
  __ui.skin.set('cozy'); const cozy = val(); __ui.skin.set('minimal'); const minimal = val();
  window.removeEventListener('ui:skin', on);
  return { cozy, minimal, ev, attr: document.documentElement.dataset.skin, saved: localStorage.getItem('ui:skin') };
});
check('switching skin changes --surface-2', skinRes.cozy && skinRes.minimal && skinRes.cozy !== skinRes.minimal, JSON.stringify(skinRes));
check('switching skin fires ui:skin and saves it', skinRes.ev >= 1 && skinRes.attr === 'minimal' && skinRes.saved === 'minimal');
await D.reload();
const after = await G(() => ({ attr: document.documentElement.dataset.skin, get: __ui.skin.get() }));
check('the skin survives a reload', after.attr === 'minimal' && after.get === 'minimal' && (await surface2(G)) === skinRes.minimal, JSON.stringify(after));
await G(() => __ui.skin.set('cozy'));

// panels: open, Esc closes and stops there, one at a time, adopt keeps children, dock button follows
await G(() => {
  window.__uiT = { esc: 0, dockWas: !!document.getElementById('dock') };
  window.addEventListener('keydown', (window.__uiT.on = (e) => { if (e.key === 'Escape') window.__uiT.esc++; }));
  const a = __ui.panel({ id: 'uitest-a', title: 'Test A', icon: 'info' });
  const b = __ui.panel({ id: 'uitest-b', title: 'Test B', icon: 'gear', kind: 'side', wide: true });
  const host = document.createElement('div'); host.id = 'uitest-c'; host.hidden = true; host.innerHTML = '<p class="keep">kept</p>'; document.body.appendChild(host);
  const c = __ui.panel({ el: host, title: 'Test C' });
  const btn = __ui.dock.add({ id: 'uitest-dock', label: 'Test', icon: 'bag', panel: a, order: 999 });
  window.__uiT.p = { a, b, c, btn };
});
await G(() => __uiT.p.a.open());
check('a kit panel opens', await G(() => __uiT.p.a.isOpen && !__uiT.p.a.el.hidden && document.body.classList.contains('ui-sheet') && __uiT.p.btn.getAttribute('aria-pressed') === 'true'));
await D.page.keyboard.press('Escape');
check('Esc closes it and stops there', await G(() => !__uiT.p.a.isOpen && __uiT.esc === 0 && !document.body.classList.contains('ui-sheet') && __uiT.p.btn.getAttribute('aria-pressed') === 'false'), 'Esc seen by others: ' + (await G(() => __uiT.esc)));
await G(() => { __uiT.p.a.open(); __uiT.p.b.open(); });
check('opening a second panel closes the first', await G(() => !__uiT.p.a.isOpen && __uiT.p.b.isOpen));
await D.page.keyboard.press('Escape');
check('Esc closes the second', await G(() => !__uiT.p.b.isOpen && !document.body.classList.contains('ui-sheet')));
await D.page.keyboard.press('Escape');
check('Esc with no panel open passes through', await G(() => __uiT.esc === 1));
check('adopting keeps the children and adds no head', await G(() => { const c = __uiT.p.c; return !!c.el.querySelector('p.keep') && !c.el.querySelector('.ui-panel__head') && c.el.classList.contains('ui-panel'); }));
await G(() => __uiT.p.btn.click());
check('the dock button toggles its panel', await G(() => __uiT.p.a.isOpen && __uiT.p.btn.getAttribute('aria-pressed') === 'true'));
await G(() => { document.getElementById('uitest-c').hidden = false; });
check('a panel shown by setting hidden counts as opened', await G(async () => { await new Promise((r) => setTimeout(r)); return !__uiT.p.a.isOpen && __uiT.p.c.isOpen; }));
await G(() => __ui.closeAll());

// toast and prompt
const tp = await G(async () => {
  const t = __ui.toast('ui smoke', { tone: 'good', seconds: 0.2 }); __ui.toast('ui smoke', { tone: 'good', seconds: 0.2 });
  const shown = __ui.lanes.toast.querySelectorAll('.ui-toast').length;
  __ui.prompt.show({ key: 'KeyE', text: 'Try it', progress: 0.5, owner: 'smoke' });
  const p = { shown: __ui.prompt.shown, key: __ui.prompt.el.querySelector('.ui-key').textContent, inLane: __ui.prompt.el.parentNode === __ui.lanes.prompt };
  __ui.prompt.hide('someone-else'); p.kept = __ui.prompt.shown; __ui.prompt.hide('smoke'); p.hidden = !__ui.prompt.shown;
  for (let i = 0; i < 30 && t.el.isConnected; i++) await new Promise((r) => setTimeout(r, 100));   // the game's first frames can delay timers
  return { shown, gone: !t.el.isConnected, p };
});
check('a toast shows once and leaves', tp.shown === 1 && tp.gone, JSON.stringify(tp));
check('the prompt shows and hides', tp.p.shown && tp.p.key === 'E' && tp.p.inLane && tp.p.kept && tp.p.hidden, JSON.stringify(tp.p));

// clean up what the test added so it does not show in the layout check
await G(() => {
  window.removeEventListener('keydown', __uiT.on);
  for (const id of ['uitest-a', 'uitest-b', 'uitest-c', 'uitest-dock']) { const el = document.getElementById(id); if (el) el.remove(); }
  if (!__uiT.dockWas) { const d = document.getElementById('dock'); if (d && !d.children.length) d.remove(); }
});
check('no page errors (desktop)', D.errors.length === 0, D.errors.slice(0, 4).join(' | '));
await layoutPass(D, '1440x900', false);
await D.ctx.close();

// ---- phone ----
const M = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
await layoutPass(M, '390x844', true);
check('no page errors (phone)', M.errors.length === 0, M.errors.slice(0, 4).join(' | '));
await M.ctx.close();

await browser.close();
if (warns.length) console.log('\n' + warns.length + ' warning(s): ' + warns.join(', '));
if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
console.log('\nall passed');
