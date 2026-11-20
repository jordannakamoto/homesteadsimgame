// Browser smoke of the snow on screen (src/snow/): node test/snow.smoke.mjs  (needs dist/index.html and Playwright)
// A cold morning storm on a High-quality page with the full path forced on the software renderer
// (localStorage.snowLive = 'force'): the field is built, the surface, live texture and object patches come up with no
// shader errors, walking stamps footprints about 0.7 m apart and packs the snowpack, walking is slower in deep loose
// snow and full speed again on a path trodden a few times, the ATV reads the local snow, an axe blow knocks a crown's
// snow off, and screenshots go to /tmp/snow-shots/ (overhead, low toward the sun, the press debug view, a shed with a
// snowy roof, snowy pines). Software GL is slow: frame counts are small.
import { mkdirSync } from 'node:fs';
import { openPage } from './helpers/page.mjs';

const SHOTS = '/tmp/snow-shots';
mkdirSync(SHOTS, { recursive: true });
const t = await openPage({ viewport: { width: 1280, height: 720 }, quality: 'high', timeout: 300000 });
const { check, G, page } = t;
await page.addInitScript(() => { try { localStorage.setItem('snowLive', 'force'); localStorage.removeItem('snowFlags'); } catch (e) { /* none */ } });
await t.load();
check('snow add-on is up', await G(() => !!(window.__snow && __game.snow && __game.snow.at && __snow.cover)));

// a clear, cold morning (the look reads the air temperature: below zero the snow is dry and sparkles), a deep fresh fall
await G(() => {
  __game.world.time = 0.4; __game.setSpeed && __game.setSpeed(1);
  __game.stepHooks.unshift(() => { const w = __game.sim.state.sys.weather; if (w) { w.tempC = -6; w.rainMmH = 0; } });
});
await t.frames(70);                                     // the trees round you reach the snowpack (sent once a second while cold)
const trees = await G(() => (__game.sim.state.sys.snow.obstacles.trees || []).length);
check('the trees round you were sent to the snowpack', trees > 0, trees + ' trees');
const depth = await G(() => __snow.debug.storm(40));
check('the storm lies on the reference pack', depth > 0.3, depth.toFixed(3) + ' m');
await t.frames(3);
let info = await G(() => __snow.info());
check('field built and snow active', info.active && info.fieldBuilt && info.fieldMaxD > 0.3, JSON.stringify(info));
check('full path on the forced software renderer', info.tier === 'high' && info.triangles > 70000 && info.live === 1024, info.tier + ' ' + info.triangles);
check('terrain and grass patched', info.groundPatched === true);
check('objects patched (trees, rocks, ground cover)', info.objects >= 3, 'materials ' + info.objects);

// walk a few metres north-east through untouched snow: slow, footprints about 0.7 m apart
const walkTo = (face, frames, from) => G(([f, n, at]) => {
  const g = __game, P = g.player, pts = [];
  if (at) { P.x = at[0]; P.z = at[1]; P.y = g.heightAt(P.x, P.z); g.stepFrames(1); }
  P.faceTarget = P.face = f; g.cam.yaw = f + Math.PI;
  g.keys.KeyW = true;
  for (let i = 0; i < n; i++) { g.stepFrames(5); pts.push([P.x, P.z, P.groundPace]); }
  g.keys.KeyW = false;
  g.stepFrames(1);
  return pts;
}, [face, frames, from || null]);
const start = await G(() => [__game.player.x, __game.player.z]);
const s0 = await G(() => __snow.info().stamps);
const path = await walkTo(Math.PI / 4, 16);
const seg = (pts, a, b) => Math.hypot(pts[b][0] - pts[a][0], pts[b][1] - pts[a][1]);
const walked = seg(path, 0, path.length - 1);
const s1 = await G(() => __snow.info().stamps);
check('the player walked', walked > 1.5, walked.toFixed(2) + ' m');
const freshSpeed = seg(path, 2, 8) / (6 * 5 / 60), pace0 = path[8][2];
check('walking is slow in deep loose snow', pace0 < 0.75 && freshSpeed < 4.4, 'pace ' + pace0.toFixed(2) + ', ' + freshSpeed.toFixed(2) + ' m/s');
// one print a stride (the wading trench stamps as well when the sink is past the knee)
check('footprints follow the stride', s1 - s0 >= walked / 1.0 - 1, (s1 - s0) + ' stamps over ' + walked.toFixed(2) + ' m');
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

// the same few metres twice more (from the same start): a trodden path, then full speed on it
for (let k = 0; k < 2; k++) { await walkTo(Math.PI / 4, 16, start); await G(() => { __snow.debug.flush(); __game.stepFrames(2); }); }
await t.frames(20);
const again = await walkTo(Math.PI / 4, 9, start);
const pathSpeed = seg(again, 2, 8) / (6 * 5 / 60), pace1 = again[8][2];
check('full speed again on the trodden path', pathSpeed > freshSpeed * 1.25 && pace1 > 0.85, 'pace ' + pace1.toFixed(2) + ', ' + pathSpeed.toFixed(2) + ' m/s (fresh ' + freshSpeed.toFixed(2) + ')');

// the snowpack has stepped a few times by now (every 10 ticks): the crowns hold their share, never more than the cap
const canopy = await G(() => __game.snow.canopyMm(__game.sim.state));
check('the evergreen crowns caught some of the fall', canopy > 0.5 && canopy <= 6, canopy.toFixed(2) + ' mm');

// the ATV reads the snow where its wheel is: loose powder off the path, packed snow on it
const surf = await G((pts) => {
  const V = window.__vehicles;
  if (!V || !V.surfaceAt) return null;
  const P = __game.player, m = pts[pts.length >> 1];
  return { off: V.surfaceAt(P.x + 6, P.z - 6), on: V.surfaceAt(m[0], m[1]), packed: __game.snow.at(__game.sim.state, m[0], m[1]).packed };
}, again);
check('wheels read the local snow (loose off the path, packed on it)', !!surf && surf.off === 'snow' && (surf.on === 'snow_packed' || surf.packed < 0.5), JSON.stringify(surf));

// knocking the snow off a pine
const knock = await G(() => {
  const g = __game, P = g.player;
  let best = null, bd = 1e9;
  for (const c of g.world.chunks.values()) for (const tr of c.trees) { const d = Math.hypot(tr.x - P.x, tr.z - P.z); if (tr.alive && tr.type === 0 && d < bd) { bd = d; best = tr; } }
  if (!best) return null;
  const before = __snow.uniforms.uSnowShake.value.filter((v) => v.z > 0).length;
  // as an axe blow does: the engine marks the tree shaking
  if (best.shake <= 0) g.world.shakes.push(best);
  best.shake = 0.35;
  g.stepFrames(1);
  const after = __snow.uniforms.uSnowShake.value.filter((v) => v.z > 0).length;
  return { before, after, x: best.x, z: best.z, d: bd, scale: best.scale };
});
check('an axe blow knocks the crown\'s snow off', !!knock && knock.after === knock.before + 1, JSON.stringify(knock));

// a shed with a snowy roof and a bare inside, and snowy pines
const shed = await G(() => {
  const g = __game, P = g.player, B = window.__build;
  if (!B || !B.placePlan) return null;
  const x = P.x + 7, z = P.z + 7;
  const r = B.placePlan('shed', x, z, 0.3);
  B.setAllBuilt(true);
  g.stepFrames(3);
  return { r: !!r, x, z, y: g.heightAt(x, z) };
});
if (shed && shed.r) {
  await t.frames(6);
  info = await G(() => __snow.info());
  check('the roof map holds the shed\'s roof', info.roofCells > 10, 'cells ' + info.roofCells);
  await G((s) => { __game.look.debugView([s.x - 6.5, s.y + 7.5, s.z - 7, s.x, s.y + 1.2, s.z]); __game.stepFrames(3); }, shed);
  await page.screenshot({ path: SHOTS + '/shed.png' });
}
if (knock) {
  await G((k) => {
    const g = __game, y = g.heightAt(k.x, k.z);
    g.look.debugView([k.x + 9, y + 3.5, k.z - 9, k.x, y + 4.5, k.z]); g.stepFrames(3);
  }, knock);
  await page.screenshot({ path: SHOTS + '/pines.png' });
}
await G(() => { __game.look.debugView(null); __game.stepFrames(1); });
check('no shader errors with objects patched', !t.errors.some((e) => /Shader Error|WebGLProgram|GL_INVALID/.test(e)), t.errors.slice(0, 2).join(' | '));
info = await G(() => __snow.info());
console.log('info', JSON.stringify(info), 'view', JSON.stringify(view));

// the thaw lets everything go again
await G(() => { __snow.debug.thaw(); __game.stepFrames(1); });
const gone = await G(() => { for (let i = 0; i < 13; i++) __game.stepFrames(1, 1.1); return { ...__snow.info(), pace: __game.player.groundPace }; });
check('released when the snow is gone', (gone.active === false || gone.fieldMaxD < 0.002) && gone.pace === 1, JSON.stringify({ active: gone.active, maxD: gone.fieldMaxD, pace: gone.pace }));
await t.finish();
