import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,760'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
await page.goto('file://' + resolve(new URL('../dist/index.html', import.meta.url).pathname));
await page.waitForFunction(() => window.__game && window.__game.world.chunks.size > 20, { timeout: 60000 });
const out = await page.evaluate(() => {
  const g = window.__game, P = g.player, log = [];
  const run = (s) => { for (let i = 0; i < Math.round(s * 60); i++) g.step(1 / 60); };
  const setup = (kind, x, z, state, face = -Math.PI / 2) => {
    for (const e of g.enemies) { e.x = 500 + Math.random() * 50; e.z = 500 + Math.random() * 50; e.hx = 500; e.state = 'idle'; e.frozen = true; }
    g.cam.yaw = -Math.PI / 2; g.cam.prevYaw = g.cam.yaw; g.cam.yawRate = 0;
    Object.assign(P, { x: 0, z: 0, stam: 100, hp: 100, atk: null, charging: null, guard: false, guardDrop: 9, stun: 0, riposte: 0, comboLock: 0, dashCd: 0, kvx: 0, kvz: 0, air: false, nextSide: 1, lightI: 0, lightIdle: 9, aiming: false });
    for (const k in g.keys) g.keys[k] = false; P.qHeld = false; P.jumpHeld = false; P.jumps = 0; P.plunged = false; P.vy = 0; P.stance = 'bow'; P.holdT = 0; P.tap = 0; P.lUsed = false;
    g.mouse.left = false; g.mouse.right = false; g.mouse.click = 0;
    const e = g.spawnEnemy('t' + Math.random(), x, z, kind, 'test'); e.face = face; e.cd = 99; e.state = state; e.recT = 99; e.frozen = true; return e;
  };
  const click = () => { g.mouse.click = 0.25; };
  let e = setup(0, 1.8, 0, 'recover'); click(); run(0.3); const a1 = e.hp; click(); run(0.3); const a2 = e.hp; click(); run(0.35);
  log.push('three left clicks: 40 -> ' + a1 + ' -> ' + a2 + ' -> ' + e.hp);
  e = setup(0, 1.8, 0, 'recover'); g.mouse.left = true; run(0.25); g.mouse.left = false; run(0.5);
  const quick = e.hp; e = setup(0, 1.8, 0, 'recover'); g.mouse.left = true; run(0.95); g.mouse.left = false; run(0.6);
  log.push('heavy: quick release 40 -> ' + quick.toFixed(1) + ', full wind-up 40 -> ' + e.hp.toFixed(1));
  e = setup(1, 1.8, 0, 'chase'); click(); run(0.3); const f1 = e.hp; g.mouse.left = true; run(0.95); g.mouse.left = false; run(0.45);
  log.push('shield-bearer front: left click leaves ' + f1 + ', full heavy leaves ' + e.hp.toFixed(1) + ' ' + e.state + ' "' + P.comboLabel + '"');
  // held guard blocks with stamina
  e = setup(0, 1.8, 0, 'chase'); g.keys.KeyE = true; run(0.5); g.startMove(e, 'swing'); run(0.9);
  log.push('held guard vs swing: hp ' + P.hp + ' stamina ' + P.stam.toFixed(0) + ' guard ' + P.guard);
  // raise guard at the last moment: parry, then jab = riposte
  e = setup(0, 1.8, 0, 'chase'); g.startMove(e, 'swing'); run(0.6); g.keys.KeyE = true; run(0.2);
  log.push('late guard: hp ' + P.hp + ' "' + P.comboLabel + '" enemy ' + e.state + ' riposte ' + (P.riposte > 0));
  click(); run(0.3);
  log.push('jab after parry: 40 -> ' + e.hp.toFixed(1) + ' "' + P.comboLabel + '" guard still up ' + P.guard);
  // jab from guard without parry
  e = setup(0, 1.8, 0, 'recover'); g.keys.KeyE = true; run(0.4); click(); run(0.12); const midGuard = P.guard; run(0.2);
  log.push('jab from guard: 40 -> ' + e.hp + ', guard during jab ' + midGuard);
  // flicking guard gives no parry
  e = setup(0, 1.8, 0, 'chase'); g.keys.KeyE = true; run(0.1); g.keys.KeyE = false; run(0.1); g.startMove(e, 'jab'); run(0.3); g.keys.KeyE = true; run(0.2);
  log.push('guard re-raised right after dropping: "' + P.comboLabel + '" stamina ' + P.stam.toFixed(0) + ' hp ' + P.hp);
  // red slam through guard
  e = setup(1, 1.8, 0, 'chase'); g.keys.KeyE = true; run(0.3); g.startMove(e, 'slam'); run(1.2);
  log.push('guarding a red slam: hp ' + P.hp.toFixed(1));
  // guard break by stamina
  e = setup(0, 1.8, 0, 'chase'); P.stam = 10; g.keys.KeyE = true; run(0.3); g.startMove(e, 'swing'); run(0.8);
  log.push('guard with no stamina: stun ' + (P.stun > 0) + ' "' + P.comboLabel + '" hp ' + P.hp);
  // Q: shove a balanced enemy, throw an off-balance one
  e = setup(0, 1.6, 0, 'chase'); e.cd = 99; g.keys.KeyQ = true; run(0.25); g.keys.KeyQ = false;
  log.push('Q on a balanced grunt: ' + e.state + ' posture ' + e.post.toFixed(0) + ' pushed to x=' + e.x.toFixed(1));
  e = setup(0, 1.6, 0, 'stagger'); e.stagT = 9; const o = g.spawnEnemy('o', 5, 0, 0, 'test'); o.state = 'recover'; o.recT = 99; o.frozen = true;
  g.keys.KeyQ = true; run(0.2); g.keys.KeyQ = false; const st = e.state; run(1.0);
  log.push('Q on a staggered grunt: ' + st + ', landed at x=' + e.x.toFixed(1) + ' hp ' + e.hp + ' ' + e.state + '; bystander hp ' + o.hp + ' ' + o.state);
  // parry then throw sideways
  e = setup(0, 1.8, 0, 'chase'); g.startMove(e, 'jab'); run(0.3); g.keys.KeyE = true; run(0.15); g.keys.KeyE = false; g.keys.KeyD = true; g.keys.KeyQ = true; run(0.25); g.keys.KeyQ = false; const st2 = e.state; run(0.8); g.keys.KeyD = false;
  log.push('parry then Q while moving right: ' + st2 + ', thrown to z=' + e.z.toFixed(1) + ' (x=' + e.x.toFixed(1) + ')');
  // bow on Shift
  e = setup(0, 14, 0, 'stagger'); e.stagT = 99; g.mouse.right = true; run(1.1);
  let found = false; for (let yaw = -0.1; yaw <= 0.1 && !found; yaw += 0.01) for (let p = 0; p <= 0.6 && !found; p += 0.01) { g.cam.yaw = -Math.PI / 2 + yaw; g.cam.aimPitch = p; g.step(1 / 600); if (g.juice.onEnemy) found = true; }
  click(); run(0.6); g.mouse.right = false;
  log.push('right-mouse bow: aiming worked ' + found + ', enemy hp 40 -> ' + e.hp.toFixed(1));
  // Shift + Space rolls, Space jumps, Shift sprints
  setup(0, 300, 0, 'idle'); g.keys.ShiftLeft = true; run(0.05); g.keys.Space = true; run(0.05); const rolled = !!P.roll, air1 = P.air; g.keys.Space = false; g.keys.ShiftLeft = false; run(0.8);
  g.keys.Space = true; run(0.05); const jumped = P.air; g.keys.Space = false; run(1.2);
  g.keys.KeyW = true; g.keys.ShiftLeft = true; run(0.3); const spd = P.speed; g.keys.KeyW = false; g.keys.ShiftLeft = false; run(0.3);
  log.push('Shift+Space rolls ' + rolled + ' (in air ' + air1 + '), Space jumps ' + jumped + ', Shift sprint speed ' + spd.toFixed(1));
  // down attack: bounce off an enemy, shockwave on the ground
  e = setup(0, 0.5, 0, 'recover'); g.keys.Space = true; run(0.05); g.keys.Space = false; run(0.3); const h0 = 'air ' + P.air + ' h ' + (P.y - g.heightAt(P.x, P.z)).toFixed(2) + ' stam ' + P.stam.toFixed(0) + ' tool ' + P.tool + ' atk ' + (P.atk && P.atk.kind) + ' px ' + P.x.toFixed(2); log.push(h0); click(); run(0.05); const k0 = P.atk && P.atk.kind;
  let bounced = false, n = 0; while (n < 60) { g.step(1 / 60); n++; if (!P.atk && P.vy > 5) { bounced = true; break; } if (!P.air) break; }
  log.push('down attack on an enemy: started ' + k0 + ', enemy hp 40 -> ' + e.hp.toFixed(1) + ', bounced ' + bounced + ', jumps left ' + (2 - P.jumps));
  run(1.5);
  e = setup(0, 1.6, 0, 'recover'); g.keys.Space = true; run(0.05); g.keys.Space = false; run(0.3); click(); run(1.0);
  e = setup(0, 1.6, 0, 'recover'); click(); run(0.4);
  log.push('left click on the ground: attack was ' + 'a normal strike, enemy hp 40 -> ' + e.hp + ', air ' + P.air);
  e = setup(0, 0.5, 0, 'recover'); g.keys.Space = true; run(0.05); g.keys.Space = false; run(0.3); click(); let peak = 0, dives = 0, prev = null; for (let i = 0; i < 180; i++) { if (i % 6 === 0) g.mouse.click = 0.25; g.step(1 / 60); if (P.atk && P.atk.kind === 'plunge' && prev !== P.atk) { dives++; prev = P.atk; } }
  log.push('mashing left through a bounce: dives started ' + dives + ', enemy hp 40 -> ' + e.hp.toFixed(1) + ', back on the ground ' + !P.air);
  log.push('down attack beside an enemy: enemy hp 40 -> ' + e.hp.toFixed(1) + ', landed ' + !P.air);
  // stance: right mouse guards in melee stance and draws the bow in bow stance
  e = setup(0, 1.8, 0, 'chase'); P.stance = 'melee'; g.startMove(e, 'swing'); run(0.6); g.mouse.right = true; run(0.2);
  log.push('melee stance, right mouse raised late: "' + P.comboLabel + '" aiming ' + P.aiming + ' guard ' + P.guard + ' hp ' + P.hp);
  g.mouse.right = false; run(0.5); P.stance = 'bow'; g.mouse.right = true; run(0.3);
  log.push('bow stance, right mouse: aiming ' + P.aiming + ' guard ' + P.guard);
  g.mouse.right = false; run(1.5); log.push('camera distance in bow stance ' + g.cam.dist.toFixed(1)); P.stance = 'melee'; run(1.5); log.push('in melee stance ' + g.cam.dist.toFixed(1));
  return log;
});
console.log(out.join('\n'));
console.log(errors.length ? 'ERRORS: ' + errors.join('\n') : 'no errors');
await browser.close();
