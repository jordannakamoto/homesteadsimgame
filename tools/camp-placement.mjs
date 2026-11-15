import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.goto('file://' + resolve(new URL('../dist/index.html', import.meta.url).pathname));
await page.waitForFunction(() => window.__game && window.__game.world.chunks.size > 20, { timeout: 60000 });
console.log(await page.evaluate(() => { const g = window.__game; let miss = 0, far = 0, n = 0; for (let i = 0; i < 25; i++) { document.getElementById('newworld').click(); for (let c = 0; c < 3; c++) { n++; const C = g.world.camps[c]; if (!C) miss++; else far = Math.max(far, Math.hypot(C.x, C.z)); } } return 'camps placed: ' + (n - miss) + ' of ' + n + ' over 25 random worlds, furthest ' + far.toFixed(0) + ' m from the start'; }));
await browser.close();
