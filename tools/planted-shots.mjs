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
  P.stance = 'bow'; g.cam.yaw = -Math.PI / 2; run(0.3); g.mouse.right = true; run(0.5);
  g.keys.KeyD = true; run(0.3); const walk = P.speed; g.keys.KeyQ = true; run(0.3); const pulled = P.speed; g.keys.KeyQ = false; g.keys.KeyD = false; run(0.5);
  log.push('bow raised: moving at ' + walk.toFixed(1) + ' m/s, with the string pulled ' + pulled.toFixed(1) + ' m/s');
  const volley = (moving) => { const yaws = []; let dmg = 0, steady = 0; for (let i = 0; i < 12; i++) { P.stam = 100; g.keys.KeyD = moving; run(0.5); g.keys.KeyQ = true; run(0.95); g.keys.KeyQ = false; g.step(1 / 60); const a = g.arrows[g.arrows.length - 1]; yaws.push(Math.atan2(a.vz, a.vx)); dmg = a.dmg; if (P.comboLabel === 'Steady' && P.comboShow > 0.5) steady++; }
    g.keys.KeyD = false; const mean = yaws.reduce((x, y) => x + y) / yaws.length; const spread = Math.max(...yaws.map((y) => Math.abs(y - mean))) * 180 / Math.PI; return 'damage ' + dmg.toFixed(1) + ', widest stray ' + spread.toFixed(2) + ' deg, "Steady" shown on ' + steady + ' of 12'; };
  log.push('full pulls, standing still: ' + volley(false));
  log.push('full pulls, shuffling sideways: ' + volley(true));
  return log;
});
console.log(out.join('\n')); console.log(errors.length ? errors : 'no errors');
await browser.close();
