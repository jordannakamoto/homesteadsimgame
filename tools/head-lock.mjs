import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + resolve(new URL('../dist/index.html', import.meta.url).pathname));
await page.waitForFunction(() => window.__game && window.__game.world.chunks.size > 20, { timeout: 60000 });
const out = await page.evaluate(() => {
  const g = window.__game, P = g.player, pm = g.pm, T = g.THREE, log = [];
  for (const e of g.enemies) { e.x = 500; e.hx = 500; e.frozen = true; }
  P.stance = 'melee'; g.cam.yaw = -Math.PI / 2;
  const run = (s) => { for (let i = 0; i < Math.round(s * 60); i++) g.step(1 / 60); };
  // world-space direction the face points, compared with where the character is aiming
  const headOff = () => { pm.root.updateMatrixWorld(true); const d = new T.Vector3(0, 0, 1).transformDirection(pm.head.matrixWorld); const aim = new T.Vector3(Math.sin(P.face), 0, Math.cos(P.face)); return (Math.acos(Math.min(1, d.dot(aim))) * 180 / Math.PI).toFixed(1) + ' deg'; };
  const bodyYaw = () => (pm.body.rotation.y * 180 / Math.PI).toFixed(0) + ' deg';
  run(0.5); log.push('standing: body ' + bodyYaw() + ', head off target by ' + headOff());
  g.mouse.left = true; run(0.9); log.push('winding up a slash, no keys: body ' + bodyYaw() + ', head off by ' + headOff() + ', arms out to the side ' + pm.armR.rotation.z.toFixed(2));
  g.keys.KeyQ = true; run(0.5); log.push('winding up and holding Q: body ' + bodyYaw() + ', head off by ' + headOff());
  g.keys.KeyQ = false; g.keys.KeyE = true; run(0.5); log.push('holding E: body ' + bodyYaw() + ', head off by ' + headOff());
  g.mouse.left = false; g.keys.KeyE = false; g.keys.KeyQ = true; let worst = 0, by = 0; for (let i = 0; i < 40; i++) { g.step(1 / 60); const d = parseFloat(headOff()); if (d > worst) { worst = d; by = pm.body.rotation.y; } }
  g.keys.KeyQ = false; log.push('through a coiled, driven slash: head never more than ' + worst.toFixed(1) + ' deg off (body at ' + (by * 180 / Math.PI).toFixed(0) + ' deg then)');
  return log;
});
console.log(out.join('\n')); console.log(errors.length ? errors : 'no errors');
await browser.close();
