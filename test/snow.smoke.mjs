// Browser smoke of the snow on screen (src/snow/): node test/snow.smoke.mjs  (needs dist/index.html and Playwright)
// A storm on a High-quality page with the full path forced on the software renderer (localStorage.snowLive = 'force'):
// the field is built, the surface and live texture come up with no shader errors, walking stamps footprints and
// packs the snowpack under the path, and screenshots go to /tmp/snow-shots/ (overhead, low toward the sun, the press
// debug view). Software GL is slow: frame counts are small.
import { mkdirSync } from 'node:fs';
import { openPage } from './helpers/page.mjs';

const SHOTS = '/tmp/snow-shots';
mkdirSync(SHOTS, { recursive: true });
const t = await openPage({ viewport: { width: 1280, height: 720 }, quality: 'high', timeout: 300000 });
const { check, G, page } = t;
await page.addInitScript(() => { try { localStorage.setItem('snowLive', 'force'); localStorage.removeItem('snowFlags'); } catch (e) { /* none */ } });
await t.load();
check('snow add-on is up', await G(() => !!(window.__snow && __game.snow && __game.snow.at)));

// a clear morning, a deep fresh fall
await G(() => { __game.world.time = 0.4; __game.setSpeed && __game.setSpeed(1); });
const depth = await G(() => __snow.debug.storm(40));
check('the storm lies on the reference pack', depth > 0.3, depth.toFixed(3) + ' m');
await t.frames(3);
let info = await G(() => __snow.info());
check('field built and snow active', info.active && info.fieldBuilt && info.fieldMaxD > 0.3, JSON.stringify(info));
check('full path on the forced software renderer', info.tier === 'high' && info.triangles > 70000 && info.live === 1024, info.tier + ' ' + info.triangles);
check('terrain and grass patched', info.groundPatched === true);

// walk a few metres north-east: footprints stamped and the path packed in the snowpack
const path = await G(() => {
  const g = __game, P = g.player, pts = [];
  P.faceTarget = P.face = Math.PI / 4;
  g.cam.yaw = P.face + Math.PI;
  g.keys.KeyW = true;
  for (let i = 0; i < 12; i++) { g.stepFrames(5); pts.push([P.x, P.z]); }
  g.keys.KeyW = false;
  return pts;
});
const walked = Math.hypot(path[path.length - 1][0] - path[0][0], path[path.length - 1][1] - path[0][1]);
check('the player walked', walked > 1.5, walked.toFixed(2) + ' m');
await G(() => { __snow.debug.flush(); __game.stepFrames(2); });
await t.frames(20);                                     // the batch lands at the next tick; the snowpack steps
info = await G(() => __snow.info());
check('stamps drawn', info.stampsDrawn > 2 && info.liveDraws > 0, 'stamps ' + info.stampsDrawn + ', draws ' + info.liveDraws);
const packed = await G((pts) => Math.max(...pts.map(([x, z]) => __game.snow.at(__game.sim.state, x, z).packed)), path);
check('the snowpack is packed under the path', packed > 0, packed.toFixed(3));
check('no shader errors', !t.errors.some((e) => /Shader Error|WebGLProgram|GL_INVALID/.test(e)), t.errors.slice(0, 2).join(' | '));

// screenshots
await page.screenshot({ path: SHOTS + '/overhead.png' });
const view = await G((pts) => {
  const g = __game, sd = g.skyU.uGSunDir.value, m = pts[pts.length >> 1];
  const l = Math.hypot(sd.x, sd.z) || 1, ux = sd.x / l, uz = sd.z / l, y = g.heightAt(m[0], m[1]);
  // low beside the middle of the walked path, the sun ahead: footprints lit from behind
  const v = [m[0] - ux * 5, y + 2.0, m[1] - uz * 5, m[0] + ux, y + 0.1, m[1] + uz];
  g.look.debugView(v);
  g.stepFrames(2);
  return v.map((n) => +n.toFixed(2));
}, path);
await page.screenshot({ path: SHOTS + '/low-toward-sun.png' });
await G(() => { __snow.debug.view('press'); __game.stepFrames(1); });
await page.screenshot({ path: SHOTS + '/press.png' });
await G(() => { __snow.debug.view(null); __game.look.debugView(null); __game.stepFrames(1); });
info = await G(() => __snow.info());
console.log('info', JSON.stringify(info), 'view', JSON.stringify(view));

// the thaw lets everything go again
await G(() => { __snow.debug.thaw(); __game.stepFrames(1); });
const gone = await G(() => { for (let i = 0; i < 13; i++) __game.stepFrames(1, 1.1); return __snow.info(); });
check('released when the snow is gone', gone.active === false || gone.fieldMaxD < 0.002, JSON.stringify({ active: gone.active, maxD: gone.fieldMaxD }));
await t.finish();
