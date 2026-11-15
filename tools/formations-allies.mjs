import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,800'] });
const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + resolve(new URL('../dist/index.html', import.meta.url).pathname));
await page.waitForFunction(() => window.__game && window.__game.world.chunks.size > 20, { timeout: 60000 });
const out = await page.evaluate(() => {
  const g = window.__game, P = g.player, D = 1 / 60, R = {};
  const clr = () => { for (const k in g.keys) g.keys[k] = false; g.mouse.left = g.mouse.right = false; };
  R.camps = g.world.camps.map((c) => c ? c.name + ' @' + Math.hypot(c.x, c.z).toFixed(0) + 'm' : 'MISSING').join(', ');
  // ally travel: walk forward 12 s, then stand 8 s
  clr(); g.keys.KeyW = true; let ahead = [0, 0], dist = [0, 0], n = 0, maxd = 0;
  for (let i = 0; i < 720; i++) { g.step(D); if (i > 240) { n++; const hx = Math.sin(P.face), hz = Math.cos(P.face); g.allies.forEach((al, k) => { const q = Math.hypot(al.x - P.x, al.z - P.z); ahead[k] += (al.x - P.x) * hx + (al.z - P.z) * hz; dist[k] += q; maxd = Math.max(maxd, q); }); } }
  R.walk = g.allies.map((al, k) => al.name + ': avg ' + (dist[k] / n).toFixed(1) + ' m away, ' + (ahead[k] / n).toFixed(1) + ' m ahead').join('; ') + '; max ' + maxd.toFixed(1) + ' m; player moved ' + Math.hypot(P.x, P.z).toFixed(0) + ' m';
  clr(); const p0 = g.allies.map((al) => [al.x, al.z]); let moved = [0, 0];
  for (let i = 0; i < 480; i++) { g.step(D); }
  R.rest = g.allies.map((al, k) => al.name + ': ' + al.mode + ', ' + Math.hypot(al.x - P.x, al.z - P.z).toFixed(1) + ' m from you, drifted ' + Math.hypot(al.x - p0[k][0], al.z - p0[k][1]).toFixed(1) + ' m').join('; ');
  // shield wall: stand in front, watch the formation and the flankers for 9 s without acting (invulnerable)
  const C = g.world.camps[0], l = Math.hypot(C.x, C.z), fx = -C.x / l, fz = -C.z / l;
  P.x = C.x + fx * 14; P.z = C.z + fz * 14; g.allies.forEach((al) => { al.state = 'down'; al.downT = -1e9; });
  g.cam.yaw = Math.atan2(fx, fz);                       // face the camp
  let behindHits = 0, spread = [], backRank = [], hp0;
  for (let i = 0; i < 660; i++) { P.hp = 100; const h = P.hp; g.step(D); if (g.enemies.some((e) => e.kind === 4 && e.state === 'recover' && e.t < 0.02)) behindHits++; if (i % 60 === 59) { const sh = g.enemies.filter((e) => e.camp === 0 && e.kind === 1); const ds = sh.map((e) => Math.hypot(e.x - P.x, e.z - P.z)); spread.push((Math.max(...ds) - Math.min(...ds)).toFixed(1)); const spd = g.enemies.filter((e) => e.camp === 0 && e.kind === 5).map((e) => Math.hypot(e.x - P.x, e.z - P.z).toFixed(1)); backRank.push(spd.join('/')); } }
  R.wall = 'shield distance spread each second: ' + spread.join(' ') + ' | spear distances: ' + backRank.join(' ');
  const sk = g.enemies.filter((e) => e.camp === 0 && e.kind === 4);
  R.flank = 'skirmishers: ' + sk.map((e) => { const th = Math.atan2(e.x - P.x, e.z - P.z); let del = P.face + Math.PI - th; del = Math.atan2(Math.sin(del), Math.cos(del)); return e.state + ' ' + Math.hypot(e.x - P.x, e.z - P.z).toFixed(1) + ' m, ' + Math.abs(del * 57.3).toFixed(0) + '° off your back'; }).join('; ') + ' | "struck from behind" count ' + behindHits;
  // hexers: stand still 8 s
  const H = g.world.camps[3];
  if (H) { const l2 = Math.hypot(H.x, H.z); P.x = H.x - H.x / l2 * 14; P.z = H.z - H.z / l2 * 14; let hexN = 0, rage = 0, lost = 0; for (let i = 0; i < 600; i++) { const h = P.hp; const n0 = g.hexes.length; g.step(D); if (g.hexes.length > n0) hexN++; if (g.enemies.some((e) => e.rage > 6.9)) rage++; if (P.hp < h) lost += h - P.hp; if (P.hp < 40) P.hp = 100; } R.hex = 'hexes cast ' + hexN + ', rallies ' + rage + ', damage taken standing still ' + Math.round(lost); }
  return R;
});
for (const k in out) console.log(k + ': ' + out[k]);
await page.evaluate(() => { const g = window.__game; g.lockQuality && g.lockQuality(); g.setQuality('high'); g.render && g.render(); });
await page.screenshot({ path: '/tmp/hexers.png' });
console.log(errors.length ? 'ERRORS: ' + [...new Set(errors)].join('\n') : 'no errors');
await browser.close();
