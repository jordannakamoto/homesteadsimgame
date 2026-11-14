import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => logs.push('PAGEERROR ' + String(e.stack || e).slice(0, 600)));
await page.goto('file://' + process.cwd() + '/site/index.html');
await page.waitForTimeout(9000);
// freeze the game loop's camera: render our own close-up frames with a separate camera
const out = await page.evaluate(async (styles) => {
  const g = window.__game, T = g.THREE, H = window.__fxHost, res = [];
  g.lockQuality(); g.setQuality('low');
  g.spawnEnemy('t1', g.player.x + 2.2, g.player.z - 3.5, 0, 'start'); g.spawnEnemy('t2', g.player.x + 4.2, g.player.z - 3.5, 3, 'start'); g.spawnEnemy('t3', g.player.x + 0.4, g.player.z - 3.5, 1, 'start');
  g.world.time = 0.42; g.keys.KeyW = true;
  for (let i = 0; i < 40; i++) g.step(0.016);
  g.keys.KeyW = false; g.keys.KeyS = true; for (let i = 0; i < 14; i++) g.step(0.016); g.keys.KeyS = false; for (const e of g.enemies) { e.frozen = true; }
  await new Promise((r) => setTimeout(r, 1500));
  const cam = new T.PerspectiveCamera(30, 900 / 700, 0.1, 200);
  for (const style of styles) {
    g.fx.setCharacters(style);
    g.fx.scanCharacters(); g.fx.setCharacters(style); g.fx.frame();
    const p = g.player;
    cam.position.set(p.x + 1.6, p.y + 4.6, p.z + 7.4); cam.lookAt(p.x + 1.6, p.y + 0.9, p.z - 0.6); cam.updateMatrixWorld();
    g.renderer.render(H.oe, cam);
    res.push(g.renderer.domElement.toDataURL('image/png'));
  }
  return { res, info: window.__fxInfo() };
}, ['anime', 'blocks', 'anime']);
import fs from 'node:fs';
out.res.forEach((d, i) => fs.writeFileSync(`out/cu-${i}.png`, Buffer.from(d.split(',')[1], 'base64')));
console.log(JSON.stringify(out.info), logs.slice(0, 6).join('\n'));
await browser.close();
