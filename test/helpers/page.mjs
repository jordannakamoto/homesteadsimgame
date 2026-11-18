// Shared Playwright launch for browser smokes (needs dist/index.html: sh build.sh).
//   const t = await openPage({ viewport: ..., settle: ... });   // t.page, t.G, t.check, t.frames, t.wait, t.errors, t.finish
// Defaults: 640x360 viewport (software GL is the cost, so small is faster), Low quality locked, console and page
// errors collected. t.frames(n) steps the game n fixed frames synchronously (__game.stepFrames), so a smoke advances
// the game without wall-clock waits. Pass { viewport: { width: 1280, height: 720 } } when a check needs the room.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';

export async function openPage({ viewport = { width: 640, height: 360 }, quality = 'low', timeout = 120000, settle = 'game' } = {}) {
  const file = 'file://' + process.cwd() + '/dist/index.html';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await (await browser.newContext({ viewport })).newPage();
  page.setDefaultTimeout(timeout);
  const errors = [], fails = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push(m.text().slice(0, 400)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
  const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails.push(name); };
  const G = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => page.waitForTimeout(ms);
  const t = { browser, page, errors, fails, check, G, wait, file, quality };
  // wait until the game object is up (instead of a fixed sleep), then lock quality so a slow renderer cannot drop it
  t.ready = async (cond = () => !!(window.__game && window.__game.stepFrames)) => {
    await page.waitForFunction(cond, null, { timeout, polling: 100 });
    await G((q) => { __game.lockQuality(); __game.setQuality(q); }, quality);
  };
  t.frames = (n = 1) => G((k) => __game.stepFrames(k), n);
  t.load = async () => { await page.goto(file, { waitUntil: 'domcontentloaded', timeout: 180000 }); await t.ready(); };
  t.reload = async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await t.ready(); };
  t.finish = async () => {
    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
    console.log(fails.length ? fails.length + ' failed' : 'all passed');
    process.exit(fails.length ? 1 : 0);
  };
  return t;
}
