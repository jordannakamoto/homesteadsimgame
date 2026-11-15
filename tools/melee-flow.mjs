import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,760', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 760 });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + resolve(new URL('../dist/index.html', import.meta.url).pathname));
await page.waitForFunction(() => window.__game && window.__game.world.chunks.size > 20, { timeout: 60000 });
const out = await page.evaluate(() => {
  const g = window.__game, P = g.player, log = [];
  g.sfx.init();
  const run = (s) => { for (let i = 0; i < Math.round(s * 60); i++) g.step(1 / 60); };
  const setup = (kind, x, z, state, face = -Math.PI / 2) => {
    for (const e of g.enemies) { e.x = 500 + Math.random() * 50; e.z = 500 + Math.random() * 50; e.hx = 500; e.state = 'idle'; e.frozen = true; }
    g.cam.yaw = -Math.PI / 2;
    Object.assign(P, { x: 0, z: 0, stam: 100, hp: 100, atk: null, ready: null, guard: false, stun: 0, riposte: 0, comboLock: 0, kvx: 0, kvz: 0, air: false, jumps: 0, holdT: 0, tap: 0, lUsed: false, aiming: false, crouch: false, stance: 'melee' });
    for (const k in g.keys) g.keys[k] = false; g.mouse.left = false; g.mouse.right = false; g.mouse.click = 0; run(0.05);
    const e = g.spawnEnemy('t' + Math.random(), x, z, kind, 'test'); e.face = face; e.cd = 99; e.state = state; e.recT = 99; e.frozen = true; return e;
  };
  const stroke = (dx, dy) => { P.ready.su += dx; P.ready.sv -= dy; };
  const ready = (hold) => { g.mouse.left = true; run(0.2 + hold); return !!P.ready; };
  // alternate driven tap slashes: Q, E, Q, E. Each drive key is pressed as the cut starts.
  let e = setup(0, 1.9, 0, 'recover'); e.hp = e.maxHp = 400; P.twist = 0; P.twistV = 0; P.flow = 0; P.lastDriven = false; P.lightI = 0;
  const y0 = g.cam.yaw, rows = [];
  for (let i = 0; i < 5; i++) {
    const key = i % 2 === 0 ? 'KeyQ' : 'KeyE'; P.lightI = 0; P.lightIdle = 0; P.stam = 100;
    const hp0 = e.hp; g.keys[key] = true; g.mouse.click = 0.25; g.step(1 / 60); const a = P.atk; let n = 0; while (P.atk === a && n < 60) { g.step(1 / 60); n++; } g.keys[key] = false;
    rows.push((key === 'KeyQ' ? 'Q' : 'E') + ' side ' + a.side + ' flow ' + a.flow + ' dmg ' + (hp0 - e.hp).toFixed(1) + ' in ' + n + 'f');
    let w = 0; while (P.comboLock > 0 && w < 30) { g.step(1 / 60); w++; }
  }
  log.push('alternating driven cuts: ' + rows.join(' | ')); log.push('camera moved ' + (g.cam.yaw - y0).toFixed(2) + ', label "' + P.comboLabel + '"');
  // same side twice breaks it
  P.lightI = 0; P.lightIdle = 0; g.keys.KeyE = true; g.mouse.click = 0.25; g.step(1 / 60); const b1 = P.atk; run(0.5); g.keys.KeyE = false; run(0.2);
  P.lightI = 0; P.lightIdle = 0; g.keys.KeyE = true; g.mouse.click = 0.25; g.step(1 / 60); const b2 = P.atk; run(0.5); g.keys.KeyE = false;
  log.push('repeating the same side: flow ' + b1.flow + ' then ' + b2.flow + ' (sides ' + b1.side + ', ' + b2.side + ')');
  // undriven alternation gives no flow
  e = setup(0, 1.9, 0, 'recover'); P.flow = 0; P.lastDriven = false; P.lightI = 0; g.mouse.click = 0.25; run(0.35); P.lightI = 1; g.mouse.click = 0.25; g.step(1 / 60); const u = P.atk; run(0.4);
  log.push('alternating without the twist: flow ' + u.flow);
  return log;
});
console.log(out.join('\n')); console.log(errors.length ? errors : 'no errors');
await browser.close();
