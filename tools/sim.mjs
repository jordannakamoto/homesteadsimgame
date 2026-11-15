// Plays each camp with a scripted player to see whether the fights reward skill over mashing.
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + resolve(new URL('../dist/index.html', import.meta.url).pathname));
await page.waitForFunction(() => window.__game && window.__game.world.chunks.size > 20, { timeout: 60000 });
const run = (camp, mode, withAllies, limit) => page.evaluate((camp, mode, withAllies, limit) => {
  const g = window.__game, P = g.player, W = g.world, D = 1 / 60;
  document.getElementById('newworld').click();                      // fresh world, same seed logic as the button: random seed
  return null;
}, camp, mode, withAllies, limit);
const play = (camp, mode, withAllies, limit) => page.evaluate((camp, mode, withAllies, limit) => {
  const g = window.__game, P = g.player, W = g.world, D = 1 / 60;
  const C = W.camps[camp]; if (!C) return { err: 'no camp' };
  const l = Math.hypot(C.x, C.z), fx = -C.x / l, fz = -C.z / l;
  P.x = C.x + fx * 22; P.z = C.z + fz * 22; P.y = g.heightAt(P.x, P.z); P.hp = 100; P.stam = 100; P.stance = 'melee'; P.dead = 0;
  g.allies.forEach((al, i) => { al.x = P.x + (i ? 2 : -2); al.z = P.z + 1; al.hp = al.maxHp; al.state = withAllies ? 'follow' : 'down'; al.downT = -1e9; });
  for (const k in g.keys) g.keys[k] = false; g.mouse.left = g.mouse.right = false; g.mouse.click = 0;
  const foes = () => g.enemies.filter((e) => e.camp === camp && e.state !== 'dead');
  let t = 0, deaths = 0, dmgTaken = 0, lastHp = 100, parries = 0, phase = 0, pt = 0, drive = 1, tapT = 0, guardT = 0, rollT = 0, fT = 0, alliesDown = 0, minHp = 100;
  const n0 = foes().length;
  while (t < limit && foes().length) {
    const fs = foes(); let tg = null, bd = 1e9;
    for (const e of fs) { const d = Math.hypot(e.x - P.x, e.z - P.z) - (e.state === 'stagger' ? 2 : 0) - (e.kind === 2 ? 1.5 : 0); if (d < bd) { bd = d; tg = e; } }
    const dx = tg.x - P.x, dz = tg.z - P.z, d = Math.hypot(dx, dz);
    let aimAt = tg;
    for (const k of ['KeyW', 'KeyS', 'KeyQ', 'KeyE', 'KeyF', 'ShiftLeft', 'Space']) g.keys[k] = false;
    g.mouse.right = false;
    if (mode !== 'idle') g.keys.KeyW = d > (tg.kind === 3 ? 2.6 : 2.0);
    if (mode === 'backstep') { const w = g.enemies.some((e) => e.state === 'windup' && !e.move.ranged && e.tgt === P && Math.hypot(e.x - P.x, e.z - P.z) < 5); if (w) { g.keys.KeyW = false; g.keys.KeyS = true; } tapT -= D; if (!w && tapT <= 0 && d < 2.8) { g.mouse.click = 0.25; tapT = 0.2; } }
    if (mode === 'mash') { tapT -= D; if (tapT <= 0 && d < 2.8) { g.mouse.click = 0.25; tapT = 0.2; } }
    if (mode === 'skilled') {
      // read the nearest incoming blow
      let th = null, rem = 9;
      for (const e of g.enemies) { if (e.state !== 'windup' || e.move.ranged || e.tgt !== P) continue; const r = e.windT - e.t, de = Math.hypot(e.x - P.x, e.z - P.z); if (de < e.move.reach * (e.kind === 3 ? 1.25 : 1) + 0.6 && r < rem) { rem = r; th = e; } }
      const arrow = g.arrows.find((a) => a.hostile && a.stuck <= 0 && Math.hypot(a.x - P.x, a.z - P.z) < 5 && (a.vx * (P.x - a.x) + a.vz * (P.z - a.z)) > 0);
      guardT -= D; rollT -= D; fT -= D;
      if (th && !th.move.parry && rem < 0.4 && rollT <= 0 && !P.roll) { g.keys.ShiftLeft = true; g.keys.KeyS = true; g.keys.KeyW = false; g.keys.Space = true; rollT = 0.8; g.mouse.left = false; phase = 0; }
      else if (th && th.move.parry && rem < 0.14 && guardT <= -0.4) { guardT = 0.3; aimAt = th; }
      else if (arrow && guardT <= -0.4) { guardT = 0.3; aimAt = arrow.src || tg; }
      if (guardT > 0) { g.mouse.right = true; g.mouse.left = false; phase = 0; if (th) aimAt = th; }
      else if (tg.state === 'stagger' && d < 1.9 && fT <= 0 && tg.kind !== 3 && !P.atk) { g.keys.KeyF = true; fT = 1.2; }
      else if (P.riposte > 0 && !P.atk && d < 2.6) { tapT -= D; if (tapT <= 0) { g.mouse.click = 0.25; tapT = 0.3; } }
      else {
        // aimed, driven slashes: hold, release, drive the other way each time
        pt += D;
        if (phase === 0 && d < 2.6 && !P.atk && P.stam > 25) { g.mouse.left = true; phase = 1; pt = 0; }
        else if (phase === 1 && pt > 0.5) { g.mouse.left = false; phase = 2; pt = 0; drive = -drive; }
        else if (phase === 2) { g.keys[drive > 0 ? 'KeyQ' : 'KeyE'] = true; if (pt > 0.3) { phase = 0; } }
        if (phase === 1 && d > 3.2) { g.mouse.left = false; phase = 0; }
      }
    }
    const ax = aimAt.x - P.x, az = aimAt.z - P.z;
    g.cam.yaw = Math.atan2(-ax, -az);
    g.step(D); t += D;
    if (P.hp < lastHp) { const src = g.enemies.find((e) => e.state === 'recover' && e.t < 0.03 && !e.move.ranged && Math.hypot(e.x - P.x, e.z - P.z) < 5); const nm = src ? Object.keys(g.MOVES).find((k) => g.MOVES[k] === src.move) : 'arrow'; W.__src = W.__src || {}; W.__src[nm] = (W.__src[nm] || 0) + Math.round(lastHp - P.hp); dmgTaken += lastHp - P.hp; } lastHp = P.hp; minHp = Math.min(minHp, P.hp);
    if (P.comboLabel === 'Parry' && P.comboShow > 0.88) parries++;
    if (P.dead > 0) { deaths++; break; }
  }
  alliesDown = g.allies.filter((al) => al.state === 'down' && al.downT > -1e8).length;
  return { src: JSON.stringify(W.__src || {}), time: +t.toFixed(1), left: foes().length, of: n0, deaths, dmgTaken: Math.round(dmgTaken), minHp: Math.round(minHp), alliesDown, allyHp: g.allies.map((al) => Math.round(al.hp)).join('/') };
}, camp, mode, withAllies, limit);
const reset = () => page.evaluate(() => { const g = window.__game; document.getElementById('newworld').click(); for (let i = 0; i < 5; i++) g.step(1 / 60); return g.world.camps.map((c) => c && c.name); });
const names = await reset();
console.log('camps:', names.join(', '));
const rows = [];
for (const camp of [0, 1, 2]) for (const [mode, allies] of [['backstep', false], ['skilled', false], ['skilled', true]]) {
  const res = [];
  for (let k = 0; k < 2; k++) { await reset(); res.push(await play(camp, mode, allies, 90)); if (mode !== 'mash') console.log('   ', names[camp], mode, allies, res[res.length-1].src); }
  rows.push([names[camp], mode + (allies ? ' + allies' : ' alone'), ...res.map((r) => r.err || (r.deaths ? 'DIED at ' + r.time + 's (' + r.left + '/' + r.of + ' left)' : r.left ? 'timeout, ' + r.left + '/' + r.of + ' left, took ' + r.dmgTaken : 'won in ' + r.time + 's, took ' + r.dmgTaken + (allies ? ', allies ' + r.allyHp : '')))]);
}
for (const r of rows) console.log(r.join(' | '));
console.log(errors.length ? 'ERRORS: ' + [...new Set(errors)].join('\n') : 'no errors');
await browser.close();
