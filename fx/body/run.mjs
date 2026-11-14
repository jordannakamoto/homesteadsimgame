import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const srv = http.createServer((q, r) => { const f = path.join(process.cwd(), decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(d); } }); }).listen(8124);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1300, height: 760 } });
p.on('pageerror', (e) => console.log('ERR', String(e).slice(0, 400))); p.on('console', (m) => { if (m.type() === 'error') console.log('cerr', m.text().slice(0, 300)); });
for (const v of (process.env.VIEWS || 'turn,face,game').split(',')) { await p.goto('http://localhost:8124/index.html#' + v); await p.reload(); await p.waitForFunction(() => window.__done, null, { timeout: 90000 }); await p.screenshot({ path: v + '.png' }); }
await b.close(); srv.close();
