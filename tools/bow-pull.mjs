import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + resolve(new URL('../dist/index.html', import.meta.url).pathname));
await page.waitForFunction(() => window.__game && window.__game.world.chunks.size > 20, { timeout: 60000 });
const out = await page.evaluate(() => {
  const g = window.__game, P = g.player, log = [];
  for (const e of g.enemies) { e.x = 500; e.hx = 500; e.frozen = true; }
  const run = (s) => { for (let i = 0; i < Math.round(s * 60); i++) g.step(1 / 60); };
  P.stance = 'bow'; g.cam.yaw = -Math.PI / 2; run(0.3);
  g.mouse.right = true; run(1.0); log.push('bow raised for 1 s without Q: pull ' + P.charge.toFixed(2) + ', arrows ' + g.arrows.length);
  const shot = (hold) => { P.stam = 100; g.cam.aimPitch = 0.0; run(0.4); const n0 = g.arrows.length; g.keys.KeyQ = true; run(hold); const c = P.charge, mid = g.arrows.length - n0; g.keys.KeyQ = false; g.step(1 / 60);
    const a = g.arrows[g.arrows.length - 1]; if (g.arrows.length === n0) return 'pull ' + c.toFixed(2) + ': nothing loosed';
    const x0 = a.x, z0 = a.z, v = Math.hypot(a.vx, a.vy, a.vz); let n = 0; while (a.stuck <= 0 && g.arrows.includes(a) && n < 400) { g.step(1 / 60); n++; }
    return 'pull ' + c.toFixed(2) + ': loosed on release (while held: ' + mid + '), speed ' + v.toFixed(0) + ' m/s, damage ' + a.dmg.toFixed(0) + ', flew ' + Math.hypot(a.x - x0, a.z - z0).toFixed(0) + ' m'; };
  log.push(shot(0.05)); log.push(shot(0.25)); log.push(shot(0.5)); log.push(shot(1.0));
  P.shotCd = 0; g.keys.AltLeft = true; run(0.3); g.keys.KeyQ = true; run(0.6); const b = g.arrows.length; g.keys.KeyQ = false; g.step(1 / 60); g.keys.AltLeft = false; log.push('Alt held, pull and release: loosed ' + (g.arrows.length - b));
  return log;
});
console.log(out.join('\n')); console.log(errors.length ? errors : 'no errors');
await browser.close();
