import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + resolve(new URL('../dist/index.html', import.meta.url).pathname));
await page.waitForFunction(() => window.__game && window.__game.world.chunks.size > 20, { timeout: 60000 });
console.log(JSON.stringify(await page.evaluate(() => {
  const g = window.__game, P = g.player, D = 1 / 60, out = {};
  const run = (key) => {
    for (const k in g.keys) g.keys[k] = false; g.mouse.left = false; P.atk = null; P.twist = 0; P.twistV = 0; P.stam = 100; P.flow = 0;
    for (let i = 0; i < 30; i++) g.step(D);
    let walkTwist = 0; if (key) g.keys[key] = true; for (let i = 0; i < 30; i++) { g.step(D); walkTwist = Math.max(walkTwist, Math.abs(P.twist)); }   // just walking sideways
    g.keys[key] = false; for (let i = 0; i < 30; i++) g.step(D);
    g.mouse.left = true; for (let i = 0; i < 36; i++) g.step(D); g.mouse.left = false; if (key) g.keys[key] = true;
    let peak = 0, kind = null; for (let i = 0; i < 50; i++) { g.step(D); if (P.atk) { kind = P.atk.kind; peak = Math.max(peak, P.atk.tqPeak || P.atk.tq || 0); } }
    return { walkTwist: +walkTwist.toFixed(2), kind, drivePeak: +peak.toFixed(2) };
  };
  g.enemies.forEach((e) => { e.frozen = true; }); P.x = 30; P.z = -30;
  out.none = run(null); out.A = run('KeyA'); out.D = run('KeyD'); out.Q = run('KeyQ');
  return out;
})));
console.log(errors.length ? 'ERRORS ' + errors.join('\n') : 'no errors');
await browser.close();
