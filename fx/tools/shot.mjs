import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const [,, file, outPrefix, ...shots] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 600)); });
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + String(e.stack || e).slice(0, 800)));
await page.goto('file://' + process.cwd() + '/' + file);
await page.waitForTimeout(6000);
const key = await page.evaluate(() => Object.keys(window).find((k) => window[k] && window[k].setQuality && window[k].world));
console.log('hook', key);
await page.evaluate((key)=>{window[key].setQuality('low');},key);await page.waitForTimeout(500);
const waitFrames=async(n)=>{const f0=await page.evaluate((key)=>window[key].renderer.info.render.frame,key);for(let i=0;i<120;i++){await page.waitForTimeout(500);const f=await page.evaluate((key)=>window[key].renderer.info.render.frame,key);if(f-f0>=n)return f-f0;}return -1;};
for (const s of shots) {
  // name:time:pitch:dist:yaw:x:z
  const [name, time, pitch, dist, yaw, x, z] = s.split(':');
  await page.evaluate(([key, time, pitch, dist, yaw, x, z]) => {
    const g = window[key];
    if (time !== '' && time !== undefined) g.world.time = +time;
    if (pitch) g.cam.pitch = +pitch;
    if (dist) g.cam.dist = +dist;
    if (yaw) g.cam.yaw = +yaw;
    if (x !== undefined && x !== '') { g.player.x = +x; g.player.z = +z; g.player.y = g.heightAt(+x, +z); }
  }, [key, time, pitch, dist, yaw, x, z]);
  await page.evaluate((key)=>{const g=window[key]; if(document.getElementById("quality").textContent!=="High") g.setQuality('high');},key);
  if(process.env.EVAL) await page.evaluate(([key,code])=>{const g=window[key]; return (new Function('g',code))(g);},[key,process.env.EVAL]);
  const nf=await waitFrames(+(process.env.FRAMES||14));
  const info = await page.evaluate((key) => { const g = window[key]; return { nf: 0, fps: document.getElementById('fps').textContent, q: document.getElementById('quality').textContent, t: g.world.time.toFixed(3), p: [g.player.x.toFixed(1), g.player.z.toFixed(1)], fx: window.__fxInfo ? window.__fxInfo() : null }; }, key);
  console.log(name, JSON.stringify(info));
  await page.screenshot({ path: `${outPrefix}-${name}.png` });
}
if(process.env.RESIZE){await page.setViewportSize({width:1000,height:600});await page.evaluate((key)=>{window[key].setQuality('high');},key);await waitFrames(6);await page.screenshot({path:`${outPrefix}-resized.png`});console.log('resized', await page.evaluate(()=>[document.getElementById('quality').textContent, JSON.stringify(window.__fxInfo())]));}
console.log(logs.slice(0, 12).join('\n'));
await browser.close();
