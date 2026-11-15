import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + resolve(new URL('../dist/index.html', import.meta.url).pathname));
await page.waitForFunction(() => window.__game && window.__game.world.chunks.size > 20, { timeout: 60000 });
const out = await page.evaluate(() => {
  const g = window.__game, P = g.player, log = [];
  const run = (s) => { for (let i = 0; i < Math.round(s * 60); i++) g.step(1 / 60); };
  g.world.time = 0.5;
  const setup = (x, face) => {
    for (const e of g.enemies) { e.x = 500 + Math.random() * 50; e.z = 500 + Math.random() * 50; e.hx = 500; e.state = 'idle'; e.frozen = true; }
    g.cam.yaw = -Math.PI / 2; Object.assign(P, { x: 0, z: 0, stam: 100, hp: 100, atk: null, comboLock: 0, air: false, jumps: 0, holdT: 0, tap: 0, lUsed: false, crouch: false, stance: 'melee', speed: 0 });
    for (const k in g.keys) g.keys[k] = false; g.mouse.left = false; g.mouse.click = 0; run(0.05);
    const e = g.spawnEnemy('t' + Math.random(), x, 0, 0, 'test'); e.face = face; e.frozen = true; e.wanderT = 99; return e;
  };
  const seen = (x, face, crouch) => { const e = setup(x, face); P.crouch = crouch; run(0.2); return e.state !== 'idle'; };
  const toward = -Math.PI / 2, away = Math.PI / 2;
  log.push('standing, enemy facing you: noticed at 12 m ' + seen(12, toward, false) + ', at 16 m ' + seen(16, toward, false));
  log.push('standing, enemy facing away: at 8 m ' + seen(8, away, false) + ', at 10 m ' + seen(10, away, false));
  log.push('crouched, enemy facing you: at 6 m ' + seen(6, toward, true) + ', at 8 m ' + seen(8, toward, true));
  log.push('crouched, enemy facing away: at 1 m ' + seen(1, away, true) + ', at 1.8 m ' + seen(1.8, away, true));
  let e = setup(1.8, away); P.crouch = true; run(0.1); g.mouse.click = 0.25; run(0.35);
  log.push('crouched strike from behind: hp 40 -> ' + e.hp.toFixed(1) + ' "' + P.comboLabel + '" still crouched ' + P.crouch + ' enemy now ' + e.state);
  e = setup(1.8, away); P.crouch = true; g.keys.KeyW = true; run(0.3); const sp = P.speed; g.keys.ShiftLeft = true; run(0.2); g.keys.KeyW = false; g.keys.ShiftLeft = false;
  log.push('crouched walk speed ' + sp.toFixed(1) + ', sprinting stands you up: crouched ' + P.crouch);
  return log;
});
console.log(out.join('\n')); console.log(errors.length ? errors : 'no errors');
await browser.close();
