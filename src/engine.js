import * as THREE from 'three';
import { createCookingView } from './cooking/view.js';
import { createControl } from './engine/control.js';
import { createChunkStream } from './world/chunk-stream.js';
import { createSea } from './water/sea.js';
import { createSkyDome } from './sky.js';
import { skyRadiance, sunColor } from './atmosphere.js';
import { createNightSky, skyFrame } from './night-sky.js';
import { createFarLand } from './far-land.js';
import { createRivers } from './water/rivers-gen.js';
import { createRiverWater } from './water/rivers-render.js';
import { createRiverLive } from './water/rivers-live.js';
import { createFalls } from './water/falls-render.js';
import { createWaterFx } from './water/water-fx.js';
import { createReflectProbe } from './water/reflect-probe.js';
import { createReflectPlane } from './water/reflect-plane.js';
import { createRippleSim } from './water/ripple-sim.js';
import { createGameSim, mapPieces, PLACEABLE_FIXTURES, runStockCommand, setCounter, stockMassKg, canAfford, toolAvailable, MATERIALS, ITEMS, ITEM_CATEGORIES, material, unitVolumeM3, rValuePer100mm, makeSave, readSave, stringifySave, f32ToBase64, base64ToF32, clockText, SPEEDS, WORLD_SECONDS_PER_REAL_SECOND, gardenRead, starterYard, rotationTo, streamLook, landscapeRead, earthwork, powerNear, vehicleCore, groundRead, setGroundBase, routeFind, frameChannelsFor, frameAttach, frameSnap, frameRayHit } from './sim/index.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Safety net for every lit material: a pixel whose colour comes out as "not a number" (from a zero-length normal,
// say) is drawn black instead. Left alone, bloom spreads a single such pixel over the whole screen.
THREE.ShaderChunk.opaque_fragment += '\nif ( isnan( gl_FragColor.r + gl_FragColor.g + gl_FragColor.b ) ) gl_FragColor.rgb = vec3( 0.0 );\n';

// Look switches (Graphics panel, or __game.look.toggle). grassShadows: tree and building shadows on grass.
// tuftShadow: grass takes its shadow once per tuft (cheaper) instead of per pixel; same lighting either way.
// drawOrder: trees, then grass, then terrain, so covered pixels are skipped. farGrass: 'off' (full detail
// everywhere), 'normal' (far tufts drop cards) or 'aggressive' (far grass also thins out and ends sooner).
// rootShade: how dark grass blades are at the root (1 = original). All of these are in the Graphics panel and are
// remembered per browser.
// grassClumps: grass grows in clumps with their own height, lean and colour, in broad dry and lush drifts.
// grassBacklight: sunlight glows through the blades when you look toward the sun, strongest at the tips.
// skyShade: ground and grass under tree crowns and down in hollows get less sky light (a baked map, no frame cost).
// sunFog: the fog warms toward the sun and thins with height (hilltops stay clear, the far edge stays hidden).
// grassSheen: a narrow sun highlight along the blades, brighter in gusts. farBlend: far grass takes the ground's colour.
// crownShade: tree crowns have a lit outer shell and a darker core. camFx: film grain and a little chromatic aberration.
// edgeBelts: scrub, brambles and saplings along forest edges and long grass along shores (nature.js, visual only).
// toneMap: 'aces' (the original), 'agxlook' (AgX, warmer, with contrast and some saturation back), 'agx' (Blender's: rolls bright colours to white without the hue shift) or 'neutral'
// (Khronos PBR Neutral: keeps hues and saturation, only compresses highlights).
// taa: temporal upscaling (TAAU) in place of MSAA: the camera is jittered a fraction of a pixel each frame and the
// frames are blended, so detail builds up over time. Replaces MSAA. Off by default: averaging jittered samples inside
// each texel softens the nearest-filtered pixel textures, which is the look this game is built on.
// upscaler: how a below-full-size render is enlarged. 'bicubic' (Catmull-Rom plus contrast-adaptive sharpening, the
// default), 'fsr' (AMD FSR 1: made for smooth, photoreal, anti-aliased images; on pixel textures it smears texel
// edges into brush strokes) or 'sharp' (area-weighted nearest: every render pixel stays a crisp block, only the
// seams between blocks are blended, the usual way to scale pixel art by uneven amounts).
const LOOK = { ao: false, hudBlur: true, lightBloom: false, compactHdr: false, grassShadows: true, tuftShadow: true, drawOrder: true, farGrass: 'normal', rootShade: 1, grassClumps: true, grassBacklight: true, skyShade: true, sunFog: true, grassSheen: true, farBlend: true, crownShade: true, camFx: false, upscaler: 'bicubic', toneMap: 'aces', taa: false, edgeBelts: true, riverWater: 'live', waterTexel: 'smooth', bedStyle: 'voxel', waterReflect: 'probe', skyModel: 'physical', skyClouds: 'volume', nightSky: 'real', farLand: true, openSea: true, haze: 'normal' };
const LOOK_KEY = 'homestead:look';
try { const s = JSON.parse(localStorage.getItem(LOOK_KEY) || 'null'); if (s) for (const k in LOOK) if (typeof s[k] === typeof LOOK[k]) LOOK[k] = s[k]; } catch (e) { /* no storage */ }
const saveLook = () => { try { localStorage.setItem(LOOK_KEY, JSON.stringify(LOOK)); } catch (e) { /* no storage */ } };

// Sun-tinted height fog, for every material at once (three's own fog chunks, replaced). Two changes to the plain
// distance fog: (1) where the view looks toward the sun the fog takes the sun's hue, faintly over a wide angle and
// strongly near the sun (Inigo Quilez's trick; at noon the sun is near white so it barely shows, at golden hour it
// glows), and (2) the fog thins with height above FOG_SUN[2] m, so hills stand clear instead of washing out, but
// it always reaches full strength at the far edge, which hides where the world stops loading. The sun is read from
// three's own light uniforms, so it costs no new uniform per material; FOG_SUN is one shared array (strengths).
const FOG_SUN = new Float32Array([LOOK.sunFog ? 1 : 0, LOOK.sunFog ? 1 : 0, 4.0, 0.07]);   // warmth, height, base (m), falloff (1/m)
for (const k of ['basic', 'lambert', 'phong', 'standard', 'physical', 'toon']) if (THREE.ShaderLib[k]) THREE.ShaderLib[k].uniforms.fogSun = { value: FOG_SUN };
THREE.UniformsLib.fog.fogSun = { value: FOG_SUN };
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogView;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogView = mvPosition.xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	uniform vec4 fogSun;
	varying float vFogDepth;
	varying vec3 vFogView;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	vec3 fogTint = fogColor;
	{
		float fogY = cameraPosition.y + dot( viewMatrix[ 1 ].xyz, vFogView );
		float hAtt = exp( - max( 0.0, fogY - fogSun.z ) * fogSun.w );
		fogFactor *= mix( 1.0, mix( hAtt, 1.0, smoothstep( 0.55, 1.0, fogFactor ) ), fogSun.y );
	}
	#if defined( RE_Direct ) && NUM_DIR_LIGHTS > 0
	{
		float sunA = max( dot( normalize( vFogView ), directionalLights[ 0 ].direction ), 0.0 );
		vec3 sunHue = directionalLights[ 0 ].color / max( max( directionalLights[ 0 ].color.r, max( directionalLights[ 0 ].color.g, directionalLights[ 0 ].color.b ) ), 1e-3 );
		fogTint = mix( fogTint, fogTint * sunHue * 1.3, fogSun.x * ( 0.25 * sunA * sunA + 0.75 * pow( sunA, 8.0 ) ) );
	}
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );
#endif`;

// ============================================================ utilities
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, z, seed) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
function makeSimplex(seed) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return function (xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = perm[ii + perm[jj]] & 7; t0 *= t0; n += t0 * t0 * (GX[g] * x0 + GY[g] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = perm[ii + i1 + perm[jj + j1]] & 7; t1 *= t1; n += t1 * t1 * (GX[g] * x1 + GY[g] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = perm[ii + 1 + perm[jj + 1]] & 7; t2 *= t2; n += t2 * t2 * (GX[g] * x2 + GY[g] * y2); }
    return 70 * n;
  };
}

// ============================================================ world constants
const CS = 32;          // chunk size in metres
const N = CS + 1;       // vertices per chunk side
const P = N + 2;        // padded height grid (one extra ring for normals)
const LOAD_R = 3;       // chunk load radius
const SEA = 0;

let SEED = 1337;
{
  const m = /^#seed-(\d+)$/.exec(location.hash || '');
  if (m) SEED = parseInt(m[1], 10) >>> 0;
  else { try { const last = localStorage.getItem('homestead:last-seed'); if (last) SEED = parseInt(last, 10) >>> 0; } catch (e) { /* no storage */ } }
}
let noise;
// The simulation owns world time and every simulated system; the engine draws it. See ARCHITECTURE.md.
let sim = createGameSim(SEED);
const simCtl = { speed: 1, dirty: false, saveT: 0 };
function fbm(x, z, oct) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let o = 0; o < oct; o++) { s += a * noise(x * f, z * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
// The terrain before rivers; `coarse` leaves out the finest octave (the drainage graph routes on that).
function rawHeight(x, z, coarse) {
  const cont = fbm(x * 0.0022, z * 0.0022, 4);
  const hills = fbm(x * 0.011 + 37, z * 0.011 - 91, 4);
  const detail = coarse ? 0 : fbm(x * 0.06 + 11, z * 0.06 + 5, 2);
  const land = smoothstep(-0.25, 0.35, cont);
  let h = cont * 16 + 1.2 + hills * 6 * (0.35 + 0.65 * land) + detail * 0.45;
  const mmask = smoothstep(0.45, 0.8, fbm(x * 0.004 + 300, z * 0.004 + 300, 3) * 0.5 + 0.5) * land;
  if (mmask > 0) {
    const r = 1 - Math.abs(noise(x * 0.009 + 50, z * 0.009 + 50));
    h += mmask * r * r * 26;
  }
  const d2 = x * x + z * z;
  h += 6 * Math.exp(-d2 / (90 * 90));
  const f = Math.exp(-d2 / (22 * 22));
  h = lerp(h, Math.max(h, 3.2), f);
  return h;
}
// Streams and rivers (src/water/rivers-gen.js): a drainage graph per seed, carved into the terrain as stepped
// channels. On unless switched off in Graphics > Look (localStorage 'rivers' = '0').
let RIVERS_ON = true;
try { RIVERS_ON = localStorage.getItem('rivers') !== '0'; } catch (e) { /* no storage */ }
let rivers = null;
const makeRivers = () => (RIVERS_ON ? createRivers({ seed: SEED, height: (x, z) => rawHeight(x, z, true), SEA }) : null);
const RIVER_PAL = { gravel: new THREE.Color(0x7d7461), silt: new THREE.Color(0x4f4a3a), earth: new THREE.Color(0x5b4430) };
// whether x, z lies in a stream or river channel, widened by `margin` m each side
function inChannel(x, z, margin) {
  if (!rivers) return false;
  const i = rivers.riverInfo(x, z);
  return !!i && i.dist < i.w / 2 + margin;
}
function baseHeight(x, z) {
  const h = rawHeight(x, z);
  return rivers ? rivers.carve(h, x, z) : h;
}
setGroundBase(baseHeight);       // the ground system's untouched land (reads the current seed and rivers when called)
// The game is a peaceful homestead builder by default. The old action-RPG combat (enemies, combat HUD) is kept
// behind a switch: run localStorage.setItem('combat', '1') in the console and reload to bring it back.
let COMBAT = false;
try { COMBAT = localStorage.getItem('combat') === '1'; } catch (e) {}
document.body.classList.toggle('peaceful', !COMBAT);
// Patchy ground colour: leaf litter under trees, dry and lush patches in the open, bare earth here and there.
var groundTintPal = null;
function groundTint(c, x, z, f, blades) {
  groundTintPal || (groundTintPal = { litter: col(7033396), dry: col(10722894), lush: col(5214010), bare: col(6045744) });
  let q1 = fbm(x * 0.13 + 70, z * 0.13 - 30, 2),
    q2 = fbm(x * 0.045 - 11, z * 0.045 + 53, 2);
  (c.lerp(groundTintPal.litter, smoothstep(0.1, 0.38, f) * smoothstep(-0.15, 0.2, q1) * 0.6),
    c.lerp(groundTintPal.dry, (1 - smoothstep(0.05, 0.25, f)) * smoothstep(0.02, 0.4, q2) * 0.3),
    c.lerp(groundTintPal.lush, (1 - smoothstep(0.1, 0.3, f)) * smoothstep(0.02, 0.42, -q2) * 0.26),
    c.lerp(groundTintPal.bare, smoothstep(0.28, 0.5, fbm(x * 0.17 - 7, z * 0.17 + 19, 2)) * 0.2),
    // the ground under the sward is shaded thatch and soil, darker than the blades above it
    blades || c.multiplyScalar(0.8),
    // under a canopy most of the sky is hidden, so the floor of the woods receives less ambient light
    c.multiplyScalar(1 - 0.15 * smoothstep(0.14, 0.42, f)));
}
const forestAt = (x, z) => fbm(x * 0.008 + 500, z * 0.008 - 500, 3);

// ---------------------------------------------------------- terrain edits (the save diff)
const world = {
  chunks: new Map(),
  edits: new Map(),       // tile key -> Float32Array(CS*CS) of height deltas
  removed: new Set(),     // ids of felled trees / broken rocks
  queue: [],
  fallers: [], logs: [], pickups: [], shakes: [],
  kills: 0,
  // wood and stone are views of the stock (items 'wood' and 'stone'), the way time is a view of the clock
  get wood() { return stockState().items.wood || 0; },
  set wood(n) { setCounter(stockState(), 'wood', n); },
  get stone() { return stockState().items.stone || 0; },
  set stone(n) { setCounter(stockState(), 'stone', n); },
  // time of day as a fraction (0 = midnight), read from the simulation. Setting it moves time
  // forward to the next moment the clock shows that time; time never runs backwards.
  get time() { return sim.dayFraction(); },
  set time(f) {
    const d = (((f - sim.dayFraction()) % 1) + 1) % 1;
    if (d > 1e-9) {
      syncSite();
      sim.advance(d * 86400 + 1e-6);
    }
  },
};
const stockState = () => sim.state.sys.stock;
const ckey = (cx, cz) => cx + ',' + cz;
function getDelta(gx, gz) {
  const tx = Math.floor(gx / CS), tz = Math.floor(gz / CS);
  const t = world.edits.get(ckey(tx, tz));
  if (!t) return 0;
  return t[(gz - tz * CS) * CS + (gx - tx * CS)];
}
function setDelta(gx, gz, v) {
  const tx = Math.floor(gx / CS), tz = Math.floor(gz / CS);
  const k = ckey(tx, tz);
  let t = world.edits.get(k);
  if (!t) { t = new Float32Array(CS * CS); world.edits.set(k, t); }
  t[(gz - tz * CS) * CS + (gx - tx * CS)] = v;
  macroDirty.add(k);
}
// world.edits is a mirror of the ground system's macro grid (sim.state.sys.ground, src/sim/ground.js), which is the
// truth that is saved. Sim -> engine: syncMacro on 'ground.macro' and 'loaded'. Engine -> sim: old writers (the brush,
// the starting well, build mode's site cut) still call setDelta; flushMacro hands their tiles to ground.importMacro.
const macroDirty = new Set(), chunkRefreshQ = new Set(), _macroTmp = new Float32Array(CS * CS);
let macroEcho = false, chunkRefreshT = -1e9;
function flushMacro() {
  if (!macroDirty.size) return;
  macroEcho = true;                   // the tiles came from here: no need to mirror them back
  try { for (const k of macroDirty) sim.commandNow('ground.importMacro', { key: k, b64: f32ToBase64(world.edits.get(k) || new Float32Array(CS * CS)) }); }
  finally { macroEcho = false; macroDirty.clear(); }
}
function syncMacro(keys) {
  for (const k of keys) {
    const has = groundRead.macroTile(sim.state, k, _macroTmp), old = world.edits.get(k);
    if (!has && !old) continue;
    let i0 = CS, i1 = -1, j0 = CS, j1 = -1;
    for (let n = 0; n < CS * CS; n++) {
      if ((old ? old[n] : 0) === _macroTmp[n]) continue;
      const i = n % CS, j = (n / CS) | 0;
      if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
    }
    if (!has) world.edits.delete(k); else if (old) old.set(_macroTmp); else world.edits.set(k, _macroTmp.slice());
    if (i1 < 0) continue;
    // heights now (feet, wheels and heightAt read them at once); the mesh on the throttle (flushChunkRefresh)
    const [tx, tz] = k.split(',').map(Number), gx0 = tx * CS + i0, gx1 = tx * CS + i1, gz0 = tz * CS + j0, gz1 = tz * CS + j1;
    for (let cz = Math.floor((gz0 - 2) / CS); cz <= Math.floor((gz1 + 1) / CS); cz++) for (let cx = Math.floor((gx0 - 2) / CS); cx <= Math.floor((gx1 + 1) / CS); cx++) {
      const c = world.chunks.get(ckey(cx, cz));
      if (!c) continue;
      for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) c.h[j * P + i] = c.base[j * P + i] + getDelta(c.ox + i - 1, c.oz + j - 1);
      chunkRefreshQ.add(c);
    }
  }
}
// rebuild the meshes of chunks whose ground changed, at most every 120 ms (a blade edits several times a second)
function flushChunkRefresh(force = false) {
  if (!chunkRefreshQ.size) return;
  const now = performance.now();
  if (!force && now - chunkRefreshT < 120) return;
  chunkRefreshT = now;
  for (const c of chunkRefreshQ) if (world.chunks.get(c.key) === c) c.refresh();
  chunkRefreshQ.clear();
  depthState.dirty = true;
}
function onSimEvent(type, data) {
  if (type === 'ground.macro') { if (!macroEcho) syncMacro(data.keys); }
  else if (type === 'loaded') syncMacro(new Set([...world.edits.keys(), ...groundRead.macroKeys(sim.state)]));
}
// the mirror against the truth: { tiles, maxDiff } (metres; brush strokes round to whole millimetres in the sim)
function verifyGround() {
  let maxDiff = 0, tiles = 0;
  for (const k of new Set([...world.edits.keys(), ...groundRead.macroKeys(sim.state)])) {
    groundRead.macroTile(sim.state, k, _macroTmp);
    const a = world.edits.get(k);
    let d = 0;
    for (let n = 0; n < CS * CS; n++) d = Math.max(d, Math.abs((a ? a[n] : 0) - _macroTmp[n]));
    if (d > 0.001) tiles++;
    maxDiff = Math.max(maxDiff, d);
  }
  return { tiles, maxDiff };
}
function heightAt(x, z) {
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
  const c = world.chunks.get(ckey(cx, cz));
  if (c) return c.heightLocal(x - cx * CS, z - cz * CS);
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const v = (a, b) => baseHeight(a, b) + getDelta(a, b);
  return lerp(lerp(v(ix, iz), v(ix + 1, iz), fx), lerp(v(ix, iz + 1), v(ix + 1, iz + 1), fx), fz);
}

// ============================================================ renderer
const canvas = document.getElementById('view');
// No antialiasing on the canvas itself: the composer antialiases (or not) in its own render target, and a
// multisampled canvas under it was a second full-screen MSAA buffer that did nothing but cost fill.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const TONE_MAPS = { aces: THREE.ACESFilmicToneMapping, agxlook: THREE.CustomToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping };
// The AgX look, three's 'custom' tone mapping: AgX for its clean roll-off to white (no ACES hue shift), then what
// Blender's AgX looks add and three's plain AgX lacks: a slightly warm key, an S-curve for contrast, some of the
// saturation AgX gives up, and a gentle split tone (cooler shadows, warmer highlights) after the landscape painters
// RDR2 drew on. Used by the composer's output pass and, on Low, by every material directly.
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace('vec3 CustomToneMapping( vec3 color ) { return color; }', `vec3 CustomToneMapping( vec3 color ) {
	color *= vec3( 1.035, 1.0, 0.95 );
	vec3 d = pow( max( AgXToneMapping( color ), vec3( 0.0 ) ), vec3( 1.0 / 2.2 ) );
	d = mix( d, d * d * ( 3.0 - 2.0 * d ), 0.35 );
	float l = dot( d, vec3( 0.2126, 0.7152, 0.0722 ) );
	d = max( mix( vec3( l ), d, 1.15 ), vec3( 0.0 ) );
	d *= mix( vec3( 0.97, 1.0, 1.04 ), vec3( 1.02, 1.0, 0.97 ), smoothstep( 0.15, 0.7, l ) );
	return pow( d, vec3( 2.2 ) );
}`);
renderer.toneMapping = TONE_MAPS[LOOK.toneMap] || THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // three r181+ removed PCFSoftShadowMap; softness is shadow.radius now

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9c4d6);
scene.fog = new THREE.Fog(0xa9c4d6, 40, 120);
const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);

const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -48; sun.shadow.camera.right = 48;
sun.shadow.camera.top = 48; sun.shadow.camera.bottom = -48;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 220;
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.06;
sun.shadow.radius = 3; sun.shadow.intensity = 0.84;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbcd7ff, 0x5a6b3c, 0.9);
scene.add(hemi);

// ---------------------------------------------------------- graphics settings
// Two independent choices, saved per browser:
//  - preset: which effects run (shadows, bloom, MSAA, how far grass reaches and thins). Ultra is for strong GPUs.
//  - scale: render resolution as a share of the screen's. 100% is native. 85% and 70% are for slower machines:
//    the browser stretches the image back to full size, smoothly, so it softens a little rather than going blocky.
// At 2560x1440: 100% renders 2560x1440, 85% renders 2176x1224, 70% renders 1792x1008.
const GFX = {
  // shadows: 'pcf' is filtered (soft edges, width = shadowRadius in shadow-map texels), 'basic' is one hard-edged
  // sample per pixel, which also suits the pixel art. Ultra's radius is larger to keep the same softness in metres.
  ultra:  { label: 'Ultra',  composer: true,  msaa: 4, shadows: 'pcf',   shadowSize: 4096, shadowRadius: 5, bloom: true,  grassR: 84, grassCount: 1,    thin: null },
  high:   { label: 'High',   composer: true,  msaa: 4, shadows: 'pcf',   shadowSize: 2048, shadowRadius: 3, bloom: true,  grassR: 84, grassCount: 1,    thin: null,           cards: [30, 46] },
  medium: { label: 'Medium', composer: true,  msaa: 2, shadows: 'basic', shadowSize: 2048, shadowRadius: 1, bloom: false, grassR: 64, grassCount: 1,    thin: [20, 56, 0.4],  cards: [22, 34] },
  low:    { label: 'Low',    composer: false, msaa: 0, shadows: 'off',   shadowSize: 1024, shadowRadius: 1, bloom: false, grassR: 52, grassCount: 0.45, thin: [16, 44, 0.5],  cards: [16, 26] },
};
const GFX_ORDER = ['ultra', 'high', 'medium', 'low'];
const RENDER_SCALES = ['auto', 1, 0.85, 0.75, 0.67];
const FPS_TARGETS = [60, 120, 144, 165, 240];
const GFX_KEY = 'homestead:gfx';
// level stays 'high' | 'low' (composer on or off) for code that already reads it
// scale: 'auto' (hold the frame-rate target by adjusting resolution) or a fixed share of native resolution.
// autoScale is what Auto is using right now.
const quality = { level: 'high', preset: 'high', scale: 'auto', autoScale: 1, target: 144 };
try {
  const s = JSON.parse(localStorage.getItem(GFX_KEY) || 'null');
  if (s && GFX[s.preset]) quality.preset = s.preset;
  if (s && RENDER_SCALES.includes(s.scale)) quality.scale = s.scale;   // older saved sizes are ignored
  if (s && FPS_TARGETS.includes(s.target)) quality.target = s.target;
} catch (e) { /* no storage, or an unreadable value */ }
quality.level = GFX[quality.preset].composer ? 'high' : 'low';
const gfx = () => GFX[quality.preset];
// 4x MSAA is part of the look on Ultra and High. msaaOverride is only for the benchmark's MSAA-off run.
const msaaSamples = () => (LOOK.taa ? 0 : Math.min(quality.msaaOverride ?? gfx().msaa, renderer.capabilities.maxSamples));   // TAAU replaces MSAA

// AO blend that fades out with the fog, so distant hazy ground isn't darkened by creases you can't see.
const AO_BLEND_FRAGMENT = `
  #include <packing>
  uniform float intensity; uniform sampler2D tDiffuse; uniform sampler2D tDepth;
  uniform float cameraNear, cameraFar, fogNear, fogFar;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D( tDiffuse, vUv );
    float viewZ = - perspectiveDepthToViewZ( texture2D( tDepth, vUv ).r, cameraNear, cameraFar );
    float k = intensity * ( 1.0 - smoothstep( fogNear, fogFar, viewZ ) );
    gl_FragColor = vec4( mix( vec3( 1.0 ), texel.rgb, k ), texel.a );
  }`;
// Extra ambient occlusion (GTAO), a switch in the Graphics panel, off by default. It reads the depth of the main render, which already has the wind sway and the
// alpha-cut grass and leaves, and rebuilds normals from it, instead of drawing the whole scene a second time
// (which would also make every grass and leaf card a solid square in the AO). Runs at G.ao of full resolution.
function makeAO(depthTexture, w, h, scale) {
  const ao = new GTAOPass(scene, camera, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)),
    { depthTexture }, { radius: 1.1, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: 16 }, { radius: 6, samples: 12 });
  ao.blendIntensity = 0.9;
  const bm = ao.blendMaterial;
  Object.assign(bm.uniforms, { tDepth: { value: depthTexture }, cameraNear: { value: camera.near }, cameraFar: { value: camera.far },
    fogNear: { value: 40 }, fogFar: { value: 120 } });
  bm.fragmentShader = AO_BLEND_FRAGMENT; bm.needsUpdate = true;
  const setSize = ao.setSize.bind(ao);
  ao.setSize = (sw, sh) => setSize(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)));
  // The AO is computed into GTAO's own targets (output Off) and then multiplied straight into the scene buffer, with
  // no swap. The scene's depth stays with the scene's colour, so the passes after it (the fx pass's depth of field,
  // haze and occlusion) still read the right depth. Swapping instead left them a buffer with no scene depth, which
  // the depth of field took as everything out of focus. Needs MSAA: see aoScale.
  ao.output = GTAOPass.OUTPUT.Off;
  ao.needsSwap = false;
  // The composer swaps its two buffers, so the scene can be in either: point AO at this frame's depth.
  const render = ao.render.bind(ao);
  ao.render = (r, writeBuffer, readBuffer, dt, mask) => {
    const d = readBuffer.depthTexture;
    if (d && ao.depthTexture !== d) {
      ao.depthTexture = d;
      ao.gtaoMaterial.uniforms.tDepth.value = d; ao.pdMaterial.uniforms.tDepth.value = d;
      ao.depthRenderMaterial.uniforms.tDepth.value = d; bm.uniforms.tDepth.value = d;
    }
    bm.uniforms.cameraNear.value = camera.near; bm.uniforms.cameraFar.value = camera.far;
    bm.uniforms.fogNear.value = scene.fog.near; bm.uniforms.fogFar.value = scene.fog.far;
    render(r, writeBuffer, readBuffer, dt, mask);
    bm.uniforms.intensity.value = ao.blendIntensity;
    bm.uniforms.tDiffuse.value = ao.pdRenderTarget.texture;
    ao._renderPass(r, bm, readBuffer);                  // multiply blend, no clear
  };
  return ao;
}
// Compact HDR buffers (a switch): the composer's colour buffers in R11F_G11F_B10F, 32 bits a sample instead of the
// 64 of half-float RGBA. Same brightness range for bloom, no alpha (the canvas is opaque), a little less precision.
// With 4x MSAA this halves most of the memory traffic of drawing and resolving the scene. Offered only where the
// GPU can render it with multisampling; checked once here.
const compactHdrOK = (() => {
  const gl = renderer.getContext();
  try {
    if (!gl.getExtension('EXT_color_buffer_float')) return false;
    const counts = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.R11F_G11F_B10F, gl.SAMPLES);
    if (!counts || !Array.from(counts).some((n) => n >= 4)) return false;
    const rb = gl.createRenderbuffer(), fb = gl.createFramebuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.R11F_G11F_B10F, 4, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.deleteFramebuffer(fb); gl.deleteRenderbuffer(rb);
    return ok;
  } catch (e) { return false; }
})();
const hdrFormat = () => (LOOK.compactHdr && compactHdrOK
  ? { format: THREE.RGBFormat, type: THREE.UnsignedInt101111Type }
  : { format: THREE.RGBAFormat, type: THREE.HalfFloatType });
let composer = null, bloom = null, ao = null;
// extra AO resolution by preset: full on Ultra, half on High and Medium, none on Low. Only with MSAA: the AO darkens
// the scene buffer in place while reading its depth, which without MSAA is attached to that same buffer.
const aoScale = () => (LOOK.ao && msaaSamples() > 0 ? ({ ultra: 1, high: 0.5, medium: 0.5 })[quality.preset] || 0 : 0);
// One composer for the whole session, built at start-up even on Low (as before). Add-ons put their own passes into
// it (fxpost.js and fx.js both claim it once, through composer.__fx), so it is never replaced: graphics settings
// change it in place, and leave every pass they didn't add where it is.
function buildComposer() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const samples = msaaSamples();
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { ...hdrFormat(), samples });
  composer = new EffectComposer(renderer, rt);
  composer.msaa = samples;
  composer.addPass(new RenderPass(scene, camera));
  // notes which buffer holds this frame's scene depth, for TAAU's reprojection (draws nothing)
  composer.addPass({ enabled: true, needsSwap: false, clear: false, renderToScreen: false, setSize() {}, dispose() {}, render(r, w, read) { taa.depth = read.depthTexture; } });
  bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.7, 0.92);
  // Lighter bloom (a switch): the glow chain starts from a quarter-resolution image instead of half
  const bloomSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => (LOOK.lightBloom ? bloomSize(Math.max(2, Math.round(w / 2)), Math.max(2, Math.round(h / 2))) : bloomSize(w, h));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}
function syncComposer() {
  if (!composer) buildComposer();
  const G = gfx();
  // MSAA and buffer format: changed on the same two buffers (three rebuilds their GPU storage on next use)
  const n = msaaSamples(), fmt = hdrFormat();
  if (composer.msaa !== n || composer.renderTarget1.texture.type !== fmt.type) {
    for (const t of [composer.renderTarget1, composer.renderTarget2]) { t.samples = n; t.texture.format = fmt.format; t.texture.type = fmt.type; t.dispose(); }
    composer.msaa = n;
  }
  bloom.enabled = G.bloom;
  if (LOOK.taa) for (const t of [composer.renderTarget1, composer.renderTarget2]) if (!t.depthTexture) { t.depthTexture = new THREE.DepthTexture(t.width, t.height); t.dispose(); }
  // extra AO: right after the scene pass. It needs scene depth, which the fx add-ons may already have added.
  const aoK = aoScale();
  if (ao && ao.scaleK !== aoK) { composer.removePass(ao); ao.dispose(); ao = null; }
  if (aoK && !ao) {
    for (const t of [composer.renderTarget1, composer.renderTarget2]) if (!t.depthTexture) { t.depthTexture = new THREE.DepthTexture(t.width, t.height); t.dispose(); }
    ao = makeAO(composer.renderTarget1.depthTexture, composer.renderTarget1.width, composer.renderTarget1.height, aoK);
    ao.scaleK = aoK;
    composer.insertPass(ao, composer.passes.indexOf(composer.passes.find((p) => p instanceof RenderPass)) + 1);
  }
  // with the extra AO on, the water writes depth, so AO sees the water's surface rather than the lake bed under it
  water.material.depthWrite = !!aoK; riverWater.material.depthWrite = !!aoK;
}
// Render resolution. With the composer (Ultra, High, Medium) the canvas stays at full resolution and the 3D scene
// is rendered at renderScale() of it, then enlarged by the upscaler below. On Low, which draws straight to the
// canvas, the canvas itself is made smaller and the browser stretches it.
const renderScale = () => (quality.scale === 'auto' ? quality.autoScale : quality.scale);
const viaComposer = () => quality.level === 'high' && !!composer;
function resize() {
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  const base = Math.min(window.devicePixelRatio || 1, 1.5), k = renderScale(), vc = viaComposer();
  renderer.setPixelRatio(vc ? base : base * k);
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(base * (vc ? k : 1)); composer.setSize(w, h); }
  upscaler.on = vc && (k < 0.999 || LOOK.camFx || LOOK.taa);   // also at full size for the camera effects or TAAU
  taa.reset();
}
// Upscaler: enlarges the finished frame to the screen with a sharp bicubic filter (Catmull-Rom) and then sharpens it
// against the neighbouring source pixels, more where the image is soft and less where it already has contrast, and
// never past the neighbours' range, so edges stay crisp without halos (the idea of AMD's FSR 1 / CAS). The input is
// the composer's output, already tone-mapped and in display colour, which is where sharpening behaves.
const upscaler = (() => {
  const mat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uSrcSize: { value: new THREE.Vector2(1, 1) }, uDstSize: { value: new THREE.Vector2(1, 1) }, uSharp: { value: 0.4 },
      uMode: { value: 0 }, uGrain: { value: 0 }, uCA: { value: 0 }, uSeed: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tSrc; uniform vec2 uSrcSize, uDstSize; uniform float uSharp, uMode, uGrain, uCA, uSeed;
      varying vec2 vUv;
      vec3 tap(vec2 uv) { return texture2D(tSrc, uv).rgb; }
      vec3 fetch(ivec2 p) { return texelFetch(tSrc, clamp(p, ivec2(0), ivec2(uSrcSize) - 1), 0).rgb; }
      // AMD FidelityFX Super Resolution 1 in one pass, after atyuwen's mobile version (MIT, (c) 2021 atyuwen, based on
      // AMD's ffx_fsr1.h, MIT): EASU, an edge-directed Lanczos-like upscale over 12 source pixels, with RCAS sharpening
      // folded in from the 5-pixel cross. RCAS's denoise term is on: where the cross is busy (grass, leaves) it
      // sharpens less, so clean edges (buildings, fences, the player) get crisp and foliage does not turn to static.
      // WebGL2 has no textureGather, so the 12 taps are plain texel fetches.
      void easuTap(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len, float lob, float clp, vec3 c) {
        vec2 v = vec2(dot(off, dir), dot(off, vec2(-dir.y, dir.x))) * len;
        float d2 = min(dot(v, v), clp);
        float wB = 0.4 * d2 - 1.0, wA = lob * d2 - 1.0;
        wB *= wB; wA *= wA;
        float w = (1.5625 * wB - 0.5625) * wA;
        aC += c * w; aW += w;
      }
      vec3 fsr1() {
        vec2 pp = gl_FragCoord.xy * (uSrcSize / uDstSize) - 0.5;
        vec2 tc = (pp + 0.5) / uSrcSize, px = 1.0 / uSrcSize;
        vec3 sA = tap(tc - vec2(0.0, px.y)), sB = tap(tc - vec2(px.x, 0.0)), sC = tap(tc), sD = tap(tc + vec2(px.x, 0.0)), sE = tap(tc + vec2(0.0, px.y));
        // RCAS from the cross: the strongest sharpening that cannot push any channel outside [0, 1]
        vec3 mn4 = min(min(sA, sB), min(sD, sE)), mx4 = max(max(sA, sB), max(sD, sE));
        vec3 hitMin = mn4 / (4.0 * max(mx4, vec3(1e-4))), hitMax = (1.0 - mx4) / min(4.0 * mn4 - 4.0, vec3(-1e-4));
        vec3 lobeC = max(-hitMin, hitMax);
        float lA = sA.r * 0.5 + sA.g, lB = sB.r * 0.5 + sB.g, lC = sC.r * 0.5 + sC.g, lD = sD.r * 0.5 + sD.g, lE = sE.r * 0.5 + sE.g;
        float nz = 0.25 * (lA + lB + lD + lE) - lC;
        nz = clamp(abs(nz) / max(max(max(lA, lB), max(lC, max(lD, lE))) - min(min(lA, lB), min(lC, min(lD, lE))), 1e-4), 0.0, 1.0);
        float lobe = max(-0.1875, min(max(lobeC.r, max(lobeC.g, lobeC.b)), 0.0)) * uSharp * (1.0 - 0.5 * nz);
        float rcpL = 1.0 / (4.0 * lobe + 1.0);
        vec3 contrast = lobe * (sA + sB + sD + sE) * rcpL;
        // EASU direction and length from the luma cross
        float dc = lD - lC, cb = lC - lB, dirX = lD - lB;
        float lenX = clamp(abs(dirX) / max(max(abs(dc), abs(cb)), 1e-5), 0.0, 1.0); lenX *= lenX;
        float ec = lE - lC, ca = lC - lA, dirY = lE - lA;
        float lenY = clamp(abs(dirY) / max(max(abs(ec), abs(ca)), 1e-5), 0.0, 1.0);
        float len = lenY * lenY + lenX;
        vec2 dir = vec2(dirX, dirY);
        float dirR = dot(dir, dir);
        if (dirR < 1.0 / 64.0) return contrast + sC * rcpL;
        dir *= inversesqrt(dirR);
        len *= 0.5; len *= len;
        float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
        vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
        float lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len, clp = 1.0 / lob;
        vec2 fp = floor(pp), f = pp - fp;
        ivec2 ip = ivec2(fp);
        vec3 aC = vec3(0.0); float aW = 0.0;
        easuTap(aC, aW, vec2(0.0, -1.0) - f, dir, len2, lob, clp, fetch(ip + ivec2(0, -1)));
        easuTap(aC, aW, vec2(1.0, -1.0) - f, dir, len2, lob, clp, fetch(ip + ivec2(1, -1)));
        easuTap(aC, aW, vec2(-1.0, 1.0) - f, dir, len2, lob, clp, fetch(ip + ivec2(-1, 1)));
        easuTap(aC, aW, vec2(0.0, 1.0) - f, dir, len2, lob, clp, fetch(ip + ivec2(0, 1)));
        easuTap(aC, aW, vec2(0.0, 0.0) - f, dir, len2, lob, clp, fetch(ip));
        easuTap(aC, aW, vec2(-1.0, 0.0) - f, dir, len2, lob, clp, fetch(ip + ivec2(-1, 0)));
        easuTap(aC, aW, vec2(1.0, 1.0) - f, dir, len2, lob, clp, fetch(ip + ivec2(1, 1)));
        easuTap(aC, aW, vec2(2.0, 1.0) - f, dir, len2, lob, clp, fetch(ip + ivec2(2, 1)));
        easuTap(aC, aW, vec2(2.0, 0.0) - f, dir, len2, lob, clp, fetch(ip + ivec2(2, 0)));
        easuTap(aC, aW, vec2(1.0, 0.0) - f, dir, len2, lob, clp, fetch(ip + ivec2(1, 0)));
        easuTap(aC, aW, vec2(1.0, 2.0) - f, dir, len2, lob, clp, fetch(ip + ivec2(1, 2)));
        easuTap(aC, aW, vec2(0.0, 2.0) - f, dir, len2, lob, clp, fetch(ip + ivec2(0, 2)));
        // EASU's own deringing: stay within the four nearest source pixels
        vec3 c4 = fetch(ip), c5 = fetch(ip + ivec2(1, 0)), c6 = fetch(ip + ivec2(0, 1)), c7 = fetch(ip + ivec2(1, 1));
        vec3 e = clamp(aC / aW, min(min(c4, c5), min(c6, c7)), max(max(c4, c5), max(c6, c7)));
        return contrast + e * rcpL;
      }
      // camera: a little chromatic aberration toward the corners and fine film grain, stronger in the shadows
      vec3 cameraFx(vec3 c) {
        if (uCA > 0.0) {
          vec2 d = vUv - 0.5, o = d * dot(d, d) * uCA;
          c.r = mix(c.r, tap(vUv - o).r, 0.85); c.b = mix(c.b, tap(vUv + o).b, 0.85);
        }
        if (uGrain > 0.0) {
          float n = fract(sin(dot(gl_FragCoord.xy + uSeed * vec2(37.0, 17.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          c += n * uGrain * (1.2 - l);
        }
        return c;
      }
      void main() {
        // sharp pixels: nearest within each render pixel, a one-screen-pixel blend only across the seam between two
        if (uMode > 1.5) {
          vec2 t = vUv * uSrcSize, sc = uDstSize / uSrcSize, d = fract(t) - 0.5, r = 0.5 - 0.5 / sc;
          vec2 c = floor(t) + (d - clamp(d, -r, r)) * sc + 0.5;
          gl_FragColor = vec4(cameraFx(tap(c / uSrcSize)), 1.0); return;
        }
        if (uMode > 0.5) { gl_FragColor = vec4(cameraFx(fsr1()), 1.0); return; }
        // Catmull-Rom from nine bilinear taps
        vec2 sp = vUv * uSrcSize, t1 = floor(sp - 0.5) + 0.5, f = sp - t1;
        vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
        vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
        vec2 w12 = w1 + w2, o12 = w2 / w12;
        vec2 p0 = (t1 - 1.0) / uSrcSize, p3 = (t1 + 2.0) / uSrcSize, p12 = (t1 + o12) / uSrcSize;
        vec3 c = tap(vec2(p0.x, p0.y)) * w0.x * w0.y + tap(vec2(p12.x, p0.y)) * w12.x * w0.y + tap(vec2(p3.x, p0.y)) * w3.x * w0.y
               + tap(vec2(p0.x, p12.y)) * w0.x * w12.y + tap(vec2(p12.x, p12.y)) * w12.x * w12.y + tap(vec2(p3.x, p12.y)) * w3.x * w12.y
               + tap(vec2(p0.x, p3.y)) * w0.x * w3.y + tap(vec2(p12.x, p3.y)) * w12.x * w3.y + tap(vec2(p3.x, p3.y)) * w3.x * w3.y;
        // contrast-adaptive sharpening against the four neighbouring source pixels
        vec2 px = 1.0 / uSrcSize;
        vec3 n = tap(vUv - vec2(0.0, px.y)), s = tap(vUv + vec2(0.0, px.y)), e = tap(vUv + vec2(px.x, 0.0)), w = tap(vUv - vec2(px.x, 0.0));
        vec3 mn = min(min(min(n, s), min(e, w)), c), mx = max(max(max(n, s), max(e, w)), c);
        vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0)) * uSharp;
        vec3 res = c + (c * 4.0 - (n + s + e + w)) * amp * 0.25;
        gl_FragColor = vec4(cameraFx(clamp(res, mn, mx)), 1.0);
      }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), _dst = new THREE.Vector2();
  return {
    on: false, material: mat,
    draw(rt, sharpOverride) {
      mat.uniforms.tSrc.value = rt.texture;
      mat.uniforms.uSrcSize.value.set(rt.width, rt.height);
      renderer.getDrawingBufferSize(_dst); mat.uniforms.uDstSize.value.copy(_dst);
      const k = renderScale(), up = k < 0.999;
      // the chosen upscaler when enlarging; the bicubic path at 1:1, where it is an exact copy
      const fsr = LOOK.upscaler === 'fsr';
      mat.uniforms.uMode.value = !up ? 0 : fsr ? 1 : LOOK.upscaler === 'sharp' ? 2 : 0;
      // sharpen more the further the image is enlarged; nothing at 1:1 (only here for the camera effects)
      mat.uniforms.uSharp.value = !up ? 0 : fsr ? Math.min(1, 0.55 + 1.2 * (1 - k)) : Math.min(0.85, 0.3 + 1.6 * (1 - k));
      if (sharpOverride !== undefined) { mat.uniforms.uMode.value = 0; mat.uniforms.uSharp.value = sharpOverride; }
      mat.uniforms.uGrain.value = LOOK.camFx ? 0.035 : 0;
      mat.uniforms.uCA.value = LOOK.camFx ? 0.012 : 0;
      mat.uniforms.uSeed.value = (mat.uniforms.uSeed.value + 1) % 64;
      renderer.setRenderTarget(null);
      renderer.render(quad, cam);
    },
  };
})();
// Temporal upscaling (TAAU), a switch (LOOK.taa). Each frame the camera is shifted by a sub-pixel amount from a
// 16-step Halton sequence, so successive frames sample the scene at different points inside each pixel. The finished
// frame (after bloom, the fx pass and tone mapping) is then resolved at screen resolution: each screen pixel takes
// the render pixels around it, weighted by how close their actual sample points fell (a Gaussian close to
// Blackman-Harris), and blends that with last frame's result found by reprojection through the scene depth. Last
// frame's colour is first clipped to the range of the current neighbourhood (variance clipping in YCoCg), which is
// what stops ghosting. Only the camera's motion is reprojected; things that move on their own (wind in the grass,
// the player, animals) rely on that clipping and a faster blend where the image moves. The result is lightly
// sharpened on the way to the screen. History is kept in half floats at screen size, two buffers swapped each frame.
const taa = (() => {
  const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
  const SEQ = Array.from({ length: 16 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);
  const mat = new THREE.ShaderMaterial({
    uniforms: { tCur: { value: null }, tDepth: { value: null }, tHist: { value: null }, uCurSize: { value: new THREE.Vector2() }, uDstSize: { value: new THREE.Vector2() },
      uJitter: { value: new THREE.Vector2() }, uInvVP: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uValid: { value: 0 }, uDbg: { value: 0 } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tCur, tDepth, tHist; uniform vec2 uCurSize, uDstSize, uJitter; uniform mat4 uInvVP, uPrevVP; uniform float uValid, uDbg;
      vec3 toYC(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
      vec3 toRGB(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
      void main() {
        vec2 uv = gl_FragCoord.xy / uDstSize, ip = uv * uCurSize;
        ivec2 b = ivec2(floor(ip)), mx = ivec2(uCurSize) - 1;
        vec3 sum = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0); float wsum = 0.0, wmax = 0.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          ivec2 q = clamp(b + ivec2(x, y), ivec2(0), mx);
          vec3 c = texelFetch(tCur, q, 0).rgb, yc = toYC(c);
          m1 += yc; m2 += yc * yc;
          vec2 d = vec2(q) + 0.5 + uJitter - ip;          // where this render pixel really sampled, from here
          float w = exp(-2.29 * dot(d, d));
          sum += c * w; wsum += w; wmax = max(wmax, w);
        }
        vec3 cur = sum / max(wsum, 1e-4);
        if (uDbg > 0.5) { gl_FragColor = vec4(texelFetch(tCur, clamp(b, ivec2(0), mx), 0).rgb, 1.0); return; }
        vec3 mu = m1 / 9.0, sg = sqrt(max(m2 / 9.0 - mu * mu, 0.0));
        // where this point was on screen last frame: through this frame's depth into the world, then last frame's camera
        float z = texture2D(tDepth, uv).r;
        vec4 wp = uInvVP * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); wp /= wp.w;
        vec4 pc = uPrevVP * wp; vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
        if (uValid < 0.5 || any(lessThan(puv, vec2(0.0))) || any(greaterThan(puv, vec2(1.0)))) { gl_FragColor = vec4(cur, 1.0); return; }
        vec3 h = toYC(texture2D(tHist, puv).rgb);
        // clip the history toward the neighbourhood's mean, into its box of mean +- 1.1 standard deviations
        vec3 lo = mu - 1.1 * sg, hi = mu + 1.1 * sg, cen = 0.5 * (lo + hi), ext = max(0.5 * (hi - lo), vec3(1e-4));
        vec3 dv = (h - cen) / ext; float m = max(abs(dv.x), max(abs(dv.y), abs(dv.z)));
        if (m > 1.0) h = cen + (h - cen) / m;
        float vel = length((puv - uv) * uDstSize);
        float a = clamp(0.05 + 0.1 * wmax + 0.15 * clamp(vel / 6.0, 0.0, 1.0), 0.04, 0.4);
        gl_FragColor = vec4(mix(toRGB(h), cur, a), 1.0);
      }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const hist = [null, null], projU = new THREE.Matrix4(), vp = new THREE.Matrix4(), prevVP = new THREE.Matrix4(), dst = new THREE.Vector2();
  let cur = 0, frame = 0, valid = false;
  const T = {
    depth: null,
    // debugging aids from the console (__game.taa): noHistory, noJitter, nearest, noSharpen
    reset() { valid = false; },
    // before the scene renders: remember the unjittered projection, then shift the view by this frame's sub-pixel step
    begin(rw, rh) {
      camera.updateProjectionMatrix(); projU.copy(camera.projectionMatrix);
      const j = T.noJitter ? [0, 0] : SEQ[frame % SEQ.length];
      mat.uniforms.uJitter.value.set(j[0], -j[1]);       // the view offset counts y down, the shader up
      camera.setViewOffset(rw, rh, j[0], j[1], rw, rh);
    },
    end() { camera.clearViewOffset(); },
    resolve(src) {
      renderer.getDrawingBufferSize(dst);
      if (!hist[0] || hist[0].width !== dst.x || hist[0].height !== dst.y) {
        for (let i = 0; i < 2; i++) { if (hist[i]) hist[i].dispose(); hist[i] = new THREE.WebGLRenderTarget(dst.x, dst.y, { type: THREE.HalfFloatType, depthBuffer: false }); }
        valid = false;
      }
      vp.multiplyMatrices(projU, camera.matrixWorldInverse);
      const u = mat.uniforms;
      u.tCur.value = src.texture; u.tDepth.value = T.depth; u.tHist.value = hist[cur].texture;
      u.uCurSize.value.set(src.width, src.height); u.uDstSize.value.copy(dst);
      u.uInvVP.value.copy(vp).invert(); u.uPrevVP.value.copy(prevVP); u.uValid.value = valid && T.depth && !T.noHistory ? 1 : 0; u.uDbg.value = T.nearest ? 1 : 0;
      const out = hist[1 - cur];
      renderer.setRenderTarget(out); renderer.render(quad, qcam);
      upscaler.draw(out, T.noSharpen ? 0 : 0.45);                          // to the screen, lightly sharpened, with the camera effects
      prevVP.copy(vp); cur = 1 - cur; frame++; valid = true;
    },
  };
  return T;
})();
window.addEventListener('resize', resize);

// ============================================================ shared uniforms and materials
const U = {
  time: { value: 0 },
  bedVox: { value: 1 },             // stream beds in the voxel style (1) or fully real (0): Graphics > Look
  playerPx: { value: new THREE.Vector2() },
  playerDepth: { value: 0 },
  fadeR: { value: 100 },
  grassLod: { value: new THREE.Vector4(0, 0, 1e5, 2e5) },   // player x, z; thinning starts, thinning ends (m)
  grassMin: { value: 1 },                                     // share of tufts still drawn where thinning ends
  grassCards: { value: new THREE.Vector2(1e5, 2e5) },          // beyond x m a tuft drops its third card, beyond y its second
  grassLook: { value: new THREE.Vector4(LOOK.grassClumps ? 1 : 0, LOOK.grassBacklight ? 1 : 0, LOOK.grassSheen ? 1 : 0, LOOK.farBlend ? 1 : 0) },   // clumps, backlight, sheen, far blend (0 = off)
  skyMap: { value: null },                                    // SKY_MAP below
  skyK: { value: LOOK.skyShade ? 1 : 0 },                     // how much of it applies (0 = off)
};
// Sky visibility map, the RDR2 idea in miniature: a top-down texture, 1 texel per metre, wrapped every 512 m, holding
// how much of the sky each spot of ground sees (255 = all of it). Tree crowns overhead and hillsides around it lower
// it. Each chunk bakes its own 32 x 32 texels when it loads and again when a tree falls or the ground is dug, so it
// costs nothing per frame. Terrain and grass read it once per vertex and dim their sky light by it, which is what
// darkens a forest floor and the bottom of a hollow. Only the loaded 7 x 7 chunks (224 m) are ever in it, so the
// 512 m wrap never puts two loaded places on the same texel.
const SKY_MAP_SIZE = 512;
const skyMapData = new Uint8Array(SKY_MAP_SIZE * SKY_MAP_SIZE).fill(255);
const skyMap = new THREE.DataTexture(skyMapData, SKY_MAP_SIZE, SKY_MAP_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
skyMap.wrapS = skyMap.wrapT = THREE.RepeatWrapping;
skyMap.magFilter = skyMap.minFilter = THREE.LinearFilter; skyMap.generateMipmaps = false;
skyMap.needsUpdate = true;
U.skyMap.value = skyMap;
// sky light (three's indirect light) times the visibility, and a little of the sun too, since in this engine shade
// is never fully dark (nature.js lets some sun into shadow) and that leak is really sky light as well
const SKY_PARS_V = '\nuniform sampler2D uSkyMap; uniform float uSkyK; varying float vSkyVis;';
const SKY_V = (xz) => `\nvSkyVis = mix(1.0, texture(uSkyMap, (${xz} + 0.5) / ${SKY_MAP_SIZE}.0).r, uSkyK);`;
const SKY_PARS_F = '\nvarying float vSkyVis;';
const SKY_F = '\nreflectedLight.indirectDiffuse *= vSkyVis; reflectedLight.directDiffuse *= mix(1.0, vSkyVis, 0.35);\n#include <aomap_fragment>';
function makePixelTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const img = g.createImageData(64, 64);
  const r = mulberry32(99);
  for (let y = 0; y < 64; y += 2) for (let x = 0; x < 64; x += 2) {
    const base = 205 + Math.floor(r() * 50);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const v = clamp(base + Math.floor((r() - 0.5) * 26), 0, 255);
      const i = ((y + dy) * 64 + x + dx) * 4;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const pixelTex = makePixelTexture();

// Distance thinning for grass, tuft by tuft. Beyond uGrassLod.z metres from the player a growing share of tufts
// is dropped, down to uGrassMin of them kept at uGrassLod.w. A dropped tuft is moved behind the far plane, so it
// costs no pixels. Which tufts go is fixed by where they stand, so the sward thins smoothly with no seam at chunk edges.
// Far tufts are also simplified: each is three crossed cards (flowers two), and past uGrassCards.x it drops its
// third card, past uGrassCards.y its second, each tuft at its own distance (spread over 8 m) so there is no line.
const GRASS_LOD_GLSL = `
  #ifdef USE_INSTANCING
  {
    vec2 ip = instanceMatrix[3].xz;
    float gd = distance(ip, uGrassLod.xy);
    float keep = mix(1.0, uGrassMin, smoothstep(uGrassLod.z, uGrassLod.w, gd));
    float pick = fract(52.9829189 * fract(dot(ip, vec2(0.06711056, 0.00583715))));
    int card = gl_VertexID / 4;
    float cd = gd - pick * 8.0;
    if (pick > keep || (card == 2 && cd > uGrassCards.x) || (card == 1 && cd > uGrassCards.y)) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  }
  #endif`;
// One shadow reading per grass tuft, taken in the vertex shader a little above the tuft's root, instead of a
// filtered shadow lookup for every grass pixel. Grass normals all point straight up, so the light is already the
// same across a tuft; only the shadow varied, and now that is per tuft too, which reads as pixel art anyway.
// Written against three r187: directional shadow maps are depth textures, read through sampler2DShadow for
// PCF and as plain depth for BasicShadowMap. The sampler is declared here exactly as the fragment shader
// declares it, so both stages share the one uniform three already fills in.
const TUFT_SHADOW_PARS_GLSL = `
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    #if defined( SHADOWMAP_TYPE_PCF )
      uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
    #else
      uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
    #endif
    varying float vTuftShadow;
  #endif`;
const TUFT_SHADOW_GLSL = `
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  {
    #ifdef USE_INSTANCING
      vec4 root = modelMatrix * instanceMatrix * vec4( 0.0, 0.2, 0.0, 1.0 );
    #else
      vec4 root = modelMatrix * vec4( 0.0, 0.2, 0.0, 1.0 );
    #endif
    DirectionalLightShadow ls = directionalLightShadows[ 0 ];
    vec4 sc = directionalShadowMatrix[ 0 ] * ( root + vec4( 0.0, ls.shadowNormalBias, 0.0, 0.0 ) );
    sc.xyz /= sc.w;
    #ifdef USE_REVERSED_DEPTH_BUFFER
      sc.z -= ls.shadowBias;
    #else
      sc.z += ls.shadowBias;
    #endif
    float s = 1.0;
    if ( sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0 && sc.z <= 1.0 ) {
      #if defined( SHADOWMAP_TYPE_PCF )
        // four hardware-filtered taps around the root: tufts at a shadow's edge come out half shaded
        vec2 o = ls.shadowRadius / ls.shadowMapSize;
        s = 0.25 * (
          texture( directionalShadowMap[ 0 ], vec3( sc.xy + vec2( o.x, 0.35 * o.y ), sc.z ) ) +
          texture( directionalShadowMap[ 0 ], vec3( sc.xy + vec2( -0.35 * o.x, o.y ), sc.z ) ) +
          texture( directionalShadowMap[ 0 ], vec3( sc.xy - vec2( o.x, 0.35 * o.y ), sc.z ) ) +
          texture( directionalShadowMap[ 0 ], vec3( sc.xy - vec2( -0.35 * o.x, o.y ), sc.z ) ) );
      #else
        float d = texture( directionalShadowMap[ 0 ], sc.xy ).r;
        #ifdef USE_REVERSED_DEPTH_BUFFER
          s = step( d, sc.z );
        #else
          s = step( sc.z, d );
        #endif
      #endif
    }
    vTuftShadow = mix( 1.0, s, ls.shadowIntensity );
  }
  #endif`;
// The fragment shader keeps three's light loop untouched (nature.js rewrites it to soften and tint shade), and
// only the directional shadow lookup inside it is redirected to the tuft's reading, by a macro defined after
// three's getShadow function. Whatever the loop does with the shadow value, it now gets it per tuft.
const TUFT_SHADOW_FRAG_GLSL = `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  varying float vTuftShadow;
  #define getShadow( shadowMap, shadowMapSize, shadowIntensity, shadowBias, shadowRadius, shadowCoord ) vTuftShadow
#endif`;
// Clumps, after Ghost of Tsushima: real grass grows in clumps, so each tuft belongs to the nearest of a set of
// jittered points about 3.4 m apart (a Voronoi cell). A clump is taller or shorter as a whole, tallest in its
// middle, and its tufts splay outward at the edge. Its colour runs from lush to straw, set by the clump and by
// broad drifts across the field, so a meadow reads as patches of green and dry grass as in RDR2 and KCD2.
// Flowers keep their colour. Strength uGrassLook.x (0 = off, no change at all).
const CLUMP_GLSL = `
  vec2 cLean = vec2(0.0); float cH = 1.0; vClumpTint = vec3(1.0); vBladeR = 1.0; vBladeN = vec3(0.0, 1.0, 0.0);
  vGrassTip = clamp((position.y - uWind.x) / uWind.y, 0.0, 1.0) * (uv.x < 0.5 ? 1.0 : 0.5);
  #ifdef USE_INSTANCING
  vBladeR = 0.3 + 0.7 * fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233)) + float(gl_VertexID / 4) * 1.71) * 43758.5453);
  if (uGrassLook.x > 0.0) {
    vec2 cip = instanceMatrix[3].xz;
    vec2 cg = floor(cip / 3.4);
    float cBest = 1e9; vec2 cCtr = cip; vec2 cR = vec2(0.5);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = cg + vec2(float(i), float(j));
      vec2 r = fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453);
      vec2 p = (c + 0.15 + 0.7 * r) * 3.4, dp = p - cip;
      float d = dot(dp, dp);
      if (d < cBest) { cBest = d; cCtr = p; cR = r; }
    }
    float cd = sqrt(cBest), ck = uGrassLook.x;
    cH = mix(1.0, mix(0.72, 1.3, cR.x) * (1.1 - 0.22 * smoothstep(0.4, 2.2, cd)), ck);
    cLean = ck * 0.16 * (cip - cCtr) / (cd + 0.35) * smoothstep(0.2, 1.6, cd);
    float drift = sin(cip.x * 0.071 + 1.7 * sin(cip.y * 0.053)) * sin(cip.y * 0.083 + 1.3 * sin(cip.x * 0.047));
    float dry = clamp(0.42 + 0.42 * drift + 0.5 * (cR.y - 0.5), 0.0, 1.0);
    vec3 tint = mix(vec3(0.84, 1.0, 0.86), vec3(1.3, 1.12, 0.62), dry) * mix(0.88, 1.08, cR.x);
    vClumpTint = mix(vec3(1.0), tint, ck * step(uv.x, 0.5));
  }
  #endif
  transformed.y *= cH;`;
// Light through the blades: grass is thin, so looking toward the sun it glows, saturated, brightest at the tips
// (the golden-hour meadow of RDR2 and KCD2). Added after three's light loop, from the sun as that loop left it,
// shadow included, so shaded grass does not glow. Strength uGrassLook.y (0 = off).
const BACKLIGHT_GLSL = `
  #if NUM_DIR_LIGHTS > 0
  if (uGrassLook.y > 0.0) {
    float bA = saturate(dot(normalize(-vViewPosition), directLight.direction));
    float bMax = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
    vec3 bC = diffuseColor.rgb * diffuseColor.rgb / max(bMax, 1e-4);
    reflectedLight.directDiffuse += uGrassLook.y * vGrassTip * sqrt(vGrassTip) * (0.15 + 1.6 * pow(bA, 3.0)) * directLight.color * BRDF_Lambert(bC);
  }
  // Sheen: blades that face the sun catch it. Each blade has its own facing (vBladeN, mostly sideways, turned by the
  // wind), and catches light by how squarely it faces the sun, on a dome along the blade, brighter in gusts. It does
  // not depend on where the camera is, so it stays put as the view moves and only the wind moves it. Tinted by the
  // grass itself rather than white, and faint: a glint of green-gold, not a metallic shine.
  if (uGrassLook.z > 0.0) {
    float sp = pow(saturate(dot(normalize(vBladeN), directLight.direction)), 6.0) * sin(3.14159 * clamp(vGrassTip, 0.0, 1.0)) * vBladeR * (0.3 + 0.8 * vGust);
    vec3 sc = mix(diffuseColor.rgb / max(max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)), 1e-3), vec3(1.0), 0.2);
    reflectedLight.directDiffuse += uGrassLook.z * 0.03 * sp * directLight.color * sc;
  }
  #endif`;
// Far grass takes the colour of the ground under it (the soil tint the tuft's foot already fades to), so where
// distant tufts thin out the gaps and the grass match. Strength uGrassLook.w.
const FARBLEND_GLSL = `
  diffuseColor.rgb = mix(diffuseColor.rgb, vColor.rgb * vec3(0.82, 0.8, 0.86), uGrassLook.w * 0.55 * vFar);`;
// Wind sway injected into a Lambert material, with options: a see-through fade around the player (fade), normals
// kept straight up (upNormal), and the grass extras (grass): distance thinning and one shadow reading per tuft.
function addWind(mat, y0, yr, amp, fade, upNormal, grass) {
  const lod = grass, tuftOn = () => grass && LOOK.tuftShadow;
  mat.customProgramCacheKey = () => 'wind' + (fade ? 1 : 0) + (upNormal ? 1 : 0) + (lod ? 1 : 0) + (tuftOn() ? 1 : 0);
  mat.onBeforeCompile = (sh) => {
    const tuft = tuftOn();
    sh.uniforms.uTime = U.time;
    sh.uniforms.uWind = { value: new THREE.Vector3(y0, yr, amp) };
    sh.uniforms.uPlayerPx = U.playerPx;
    sh.uniforms.uPlayerDepth = U.playerDepth;
    sh.uniforms.uFadeR = U.fadeR;
    if (lod) { sh.uniforms.uGrassLod = U.grassLod; sh.uniforms.uGrassMin = U.grassMin; sh.uniforms.uGrassCards = U.grassCards; sh.uniforms.uGrassLook = U.grassLook; sh.uniforms.uSkyMap = U.skyMap; sh.uniforms.uSkyK = U.skyK; }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uWind; varying float vCamDepth;' + (lod ? '\nuniform vec4 uGrassLod; uniform float uGrassMin; uniform vec2 uGrassCards; uniform vec4 uGrassLook; varying vec3 vClumpTint; varying float vGrassTip; varying float vGust; varying float vBladeR; varying float vFar; varying vec3 vBladeN;' + SKY_PARS_V : ''))
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${lod ? CLUMP_GLSL : 'vec2 cLean = vec2(0.0);'}
        #ifdef USE_INSTANCING
          vec3 wp = (instanceMatrix * vec4(position, 1.0)).xyz;
        #else
          vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
        #endif
        float hk = pow(clamp((position.y - uWind.x) / uWind.y, 0.0, 1.0), 1.6);
        // gusts roll across the land as travelling waves, and everything leans the same way
        float g1 = sin(wp.x * 0.11 + wp.z * 0.07 - uTime * 1.25);
        float g2 = sin(wp.x * 0.043 - wp.z * 0.061 - uTime * 0.55 + 1.3);
        float gust = 0.5 + 0.5 * (0.6 * g1 + 0.4 * g2);
        gust *= gust;${lod ? ' vGust = gust;' : ''}
        float sw = hk * uWind.z * (0.3 + 1.5 * gust);
        float ph = uTime * 1.6 + wp.x * 0.21 + wp.z * 0.17;
        vec2 dw = vec2(0.9 * gust + 0.45 * sin(ph) + 0.2 * sin(ph * 2.3 + 1.7), 0.55 * gust + 0.4 * cos(ph * 0.8) + 0.2 * sin(ph * 1.9)) * sw + cLean * hk;${lod ? `
        { float aB = fract(vBladeR * 7.31) * 6.2832; vec2 wv = vec2(0.9 * gust + 0.45 * sin(ph), 0.55 * gust + 0.4 * cos(ph * 0.8));
          vBladeN = normalize(mat3(viewMatrix) * vec3(cos(aB) + wv.x, 0.35, sin(aB) + wv.y)); }` : ''}
        #ifdef USE_INSTANCING
          vec3 ax = instanceMatrix[0].xyz, az = instanceMatrix[2].xyz;
          transformed.x += dot(vec3(dw.x, 0.0, dw.y), ax) / dot(ax, ax);
          transformed.z += dot(vec3(dw.x, 0.0, dw.y), az) / dot(az, az);
        #else
          transformed.xz += dw;
        #endif
        // boughs bob and their tips flutter
        float tipk = clamp(length(position.xz) / 2.2, 0.0, 1.0) * step(2.0, uWind.y);
        float fl = sin(uTime * 3.3 + position.x * 2.1 + position.z * 1.7 + wp.x * 0.6) + 0.5 * sin(uTime * 7.1 + position.z * 5.3 + position.y * 3.0);
        transformed.y += fl * tipk * (0.02 + 0.06 * gust);
        transformed.xz += vec2(cos(position.y * 3.0 + uTime * 4.7), sin(position.x * 3.0 + uTime * 5.3)) * tipk * 0.018 * (0.4 + gust);`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCamDepth = -mvPosition.z;' + (lod ? GRASS_LOD_GLSL + '\n#ifdef USE_INSTANCING' + SKY_V('instanceMatrix[3].xz') + '\nvFar = smoothstep(uGrassLod.z, uGrassLod.w, distance(instanceMatrix[3].xz, uGrassLod.xy));\n#else\nvSkyVis = 1.0; vFar = 0.0;\n#endif' : ''));
    if (tuft) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <shadowmap_pars_vertex>', '#include <shadowmap_pars_vertex>' + TUFT_SHADOW_PARS_GLSL)
        .replace('#include <shadowmap_vertex>', '#include <shadowmap_vertex>' + TUFT_SHADOW_GLSL);
      sh.fragmentShader = sh.fragmentShader.replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>' + TUFT_SHADOW_FRAG_GLSL);
    }
    if (lod) {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec4 uGrassLook; varying vec3 vClumpTint; varying float vGrassTip; varying float vGust; varying float vBladeR; varying float vFar; varying vec3 vBladeN;' + SKY_PARS_F)
        .replace('#include <aomap_fragment>', SKY_F)
        .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>' + FARBLEND_GLSL)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vClumpTint;')
        .replace('#include <lights_fragment_begin>', '#include <lights_fragment_begin>' + BACKLIGHT_GLSL);
    }
    if (upNormal) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    if (fade) {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vCamDepth; uniform vec2 uPlayerPx; uniform float uPlayerDepth; uniform float uFadeR;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          {
            vec2 dd = (gl_FragCoord.xy - uPlayerPx) / uFadeR;
            float d2 = dot(dd, dd);
            if (d2 < 1.0 && vCamDepth < uPlayerDepth - 0.6) {
              float dn = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
              if (dn > d2 * d2 + 0.12) discard;
            }
          }`);
    }
  };
}
const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: pixelTex });
// Under the live stream water (src/water/rivers-live.js) the ground is a stream bed seen close up, drawn smooth and
// real rather than pixelled (close up is where you wade, fish and gather), the way a clear stream bed actually looks:
//  - stones sorted by the current: cobbles where it runs fast, gravel where it is middling, sand and silt in slow
//    pools; each stone a rounded, lit dome with dark cracks between, in the mixed greys, browns, ochres and the odd
//    pale quartz of river stones, some green-brown with algae where the water is slow
//  - wet: darker and richer than dry stone
//  - seen through a moving surface: the bed wobbles with the ripples above it (refraction, faked by offsetting where
//    the bed is read by the surface slope times the depth)
//  - caustics: the bright net of light the ripples focus onto the bed, moving with the water, dappled under trees
const BED_PARS_F = `
uniform highp sampler2D uLiveState, uLiveFeed; uniform sampler2D uFoamTex, uSeaTex; uniform vec2 uLiveOrg; uniform float uLiveCell, uTime; uniform int uLiveN; uniform vec4 uWin; uniform vec3 uSunDirB, uSunColB; uniform float uBedVox;
varying vec3 vWPosT;
vec3 bedHash(vec2 p) { vec3 q = vec3(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)), dot(p, vec2(419.2, 371.9))); return fract(sin(q) * 43758.5453); }
// stones lying on finer stuff, p in cells: x how far up the stone (0 at its edge, 1 on top; below 0 outside it,
// down to -1 a third of its size away, for the shade round it), yzw the stone's random numbers. k scales the
// stones' size: 0 none, 1 full.
// toC: from the point toward the stone's middle, over its radius (for lighting it as a dome). In the voxel style
// (uBedVox 1) stones are squarer, like the world's blocks, and the bed is read in texels.
vec4 bedStones(vec2 p, float k, out vec2 toC) {
  vec2 i = floor(p), f = fract(p);
  float best = -9.0; vec3 id = vec3(0.0); toC = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)); vec3 h = bedHash(i + g);
    vec2 o = g + 0.18 + 0.64 * h.xy - f;
    float an = h.z * 6.283, ca = cos(an), sa = sin(an);
    vec2 r = vec2(ca * o.x + sa * o.y, -sa * o.x + ca * o.y); r.x *= 0.7 + 0.6 * h.y;   // flattened, turned stones
    float rr = (0.24 + 0.24 * fract(h.x * 7.3 + h.y)) * k;
    float dist = mix(length(r), max(abs(r.x), abs(r.y)) * 1.12, uBedVox * 0.6);
    float e = rr > 0.0 ? 1.0 - dist / rr : -9.0;
    if (e > best) { best = e; id = h; toC = rr > 0.0 ? o / rr : vec2(0.0); }
  }
  return vec4(max(best, -1.0), id);
}
vec3 stoneCol(vec3 id) {
  vec3 c = id.x < 0.3 ? vec3(0.5, 0.5, 0.48) : id.x < 0.5 ? vec3(0.5, 0.4, 0.3) : id.x < 0.66 ? vec3(0.62, 0.5, 0.32) : id.x < 0.78 ? vec3(0.42, 0.33, 0.27) : id.x < 0.92 ? vec3(0.24, 0.24, 0.23) : vec3(0.78, 0.76, 0.72);
  return c * (0.7 + 0.6 * id.y);
}
float liveAt(vec2 lc, int ch) {
  vec2 a = lc - 0.5, f = fract(a); ivec2 i = ivec2(floor(a));
  return mix(mix(texelFetch(uLiveState, i, 0)[ch], texelFetch(uLiveState, i + ivec2(1, 0), 0)[ch], f.x), mix(texelFetch(uLiveState, i + ivec2(0, 1), 0)[ch], texelFetch(uLiveState, i + ivec2(1, 1), 0)[ch], f.x), f.y);
}`;
const BED_F = `#include <map_fragment>
float bedCaustic = 0.0;
{
  vec2 lc = (vWPosT.xz - uLiveOrg) / uLiveCell;
  if (uWin.z > uWin.x && lc.x > 1.0 && lc.y > 1.0 && lc.x < float(uLiveN) - 1.0 && lc.y < float(uLiveN) - 1.0) {
    float dep = liveAt(lc, 0);
    float uw = smoothstep(0.0, 0.04, dep);
    // fade the stone bed out toward the window's edge over the same 10 m the water hands over in, so its edge
    // creeps unseen as the window follows you
    uw *= clamp((min(min(lc.x, lc.y), min(float(uLiveN) - lc.x, float(uLiveN) - lc.y)) * uLiveCell - 2.0) / 10.0, 0.0, 1.0);
    if (uw > 0.0) {
      vec2 v = vec2(liveAt(lc, 1), liveAt(lc, 2));
      // what lies on the bed follows the channel's settled current (the baked flow), not the moment's water, so
      // it holds still as you move about
      vec4 fdT = texelFetch(uLiveFeed, ivec2(lc), 0);
      float sp = fdT.r > -1000.0 ? length(fdT.ba) : length(v), fdep = fdT.r > -1000.0 ? fdT.r - fdT.g : dep;
      // the surface slope above (the water shader's flowed ripples, simplified) bends the view of the bed
      float ph = uTime * 0.32, t0 = fract(ph), t1 = fract(ph + 0.5), wb = abs(1.0 - 2.0 * t0);
      vec2 q = vWPosT.xz;
      vec2 g = mix(texture2D(uSeaTex, q * 0.31 - v * t0 * 0.55).rg, texture2D(uSeaTex, q * 0.31 - v * t1 * 0.55 + 0.37).rg, wb) - 0.5;
      g = g * (0.3 + 0.7 * smoothstep(0.05, 1.1, sp)) + (texture2D(uSeaTex, q * 1.7 - v * t0 * 0.9 + uTime * vec2(0.05, 0.03)).rg - 0.5) * 0.35;
      vec2 bp = q + g * min(dep, 0.6) * 0.5;
      if (uBedVox > 0.5) { float tpm = uBedVox > 1.5 ? 32.0 : 16.0; bp = (floor(bp * tpm) + 0.5) / tpm; }   // voxel style: 6 cm texels (fine: 3 cm)
      // what the current leaves: cobbles in fast water, gravel in middling, sand in slow pools, each layer lying on
      // the finer one, with the finer stuff showing between
      float big = smoothstep(0.3, 0.9, sp + (texture2D(uFoamTex, bp * 0.11).b - 0.5) * 0.6);
      float sand = (1.0 - smoothstep(0.08, 0.3, sp)) * smoothstep(0.12, 0.35, fdep) * smoothstep(0.35, 0.65, texture2D(uFoamTex, bp * 0.07 + 0.3).b);
      vec3 sandC = vec3(0.6, 0.54, 0.41) * (0.85 + 0.25 * texture2D(uFoamTex, bp * 0.9).b) * (0.94 + 0.06 * sin(dot(bp, v.yx * 6.0 + vec2(9.0, 3.0))));
      vec3 lightDir = normalize(uSunDirB + vec3(0.0, 0.6, 0.0));
      vec3 bed = sandC;
      vec2 toC;
      vec4 st = bedStones(bp * 12.0, 1.0 - sand * 0.85, toC);
      for (int L = 0; L < 2; L++) {
        if (st.x > -1.0) {
          // lit as a dome: the slope faces away from the stone's middle, steeper toward its edge
          float hgt = sqrt(max(st.x, 0.02));
          vec3 sn = normalize(vec3(-toC.x * 0.9 / hgt, 1.0, -toC.y * 0.9 / hgt));
          float lit = 0.7 + 0.45 * clamp(dot(sn, lightDir), -1.0, 1.0);
          if (uBedVox > 0.5) lit = floor(lit * 5.0 + 0.5) / 5.0;                     // voxel style: a few tones a stone
          vec3 sc = stoneCol(st.yzw) * lit * mix(0.6, 1.0, smoothstep(0.0, 0.5, st.x));
          sc = mix(sc, sc * vec3(0.72, 0.86, 0.52), (1.0 - smoothstep(0.2, 0.7, sp)) * smoothstep(0.3, 0.9, st.x) * smoothstep(0.4, 0.7, st.w));   // algae
          bed *= mix(1.0, 0.62, smoothstep(-0.6, 0.0, st.x) * step(st.x, 0.0));                                  // shade round it
          bed = mix(bed, sc, smoothstep(0.0, 0.08, st.x));
        }
        st = bedStones(bp * 4.0 + 17.0, big * 1.25, toC);
      }
      bed *= vec3(0.78, 0.8, 0.76);                                                                                    // wet: darker
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * bed * 1.6, uw);
      // caustics: two moving layers of the foam's bright net; where they cross the light is focused
      vec2 cp = bp * 1.1;
      float c1 = texture2D(uFoamTex, cp + uTime * vec2(0.031, 0.022) + g * 0.3).r, c2 = texture2D(uFoamTex, cp * 1.37 + 0.41 - uTime * vec2(0.024, 0.035) - g * 0.3).r;
      bedCaustic = (pow(c1, 3.0) + pow(c2, 3.0)) * 1.6 * uw * smoothstep(0.02, 0.12, dep) * exp(-dep * 1.4) * vSkyVis * max(uSunDirB.y, 0.0);
    }
  }
}`;
// Hand-dug ground (src/landscape-view.js) is drawn by its own mesh, which can sit below the terrain's surface: a
// hole, a trench, a sunken path. Where a 30 cm square has been worked, the terrain lets it show through. The mask is a
// texture of squares around the player; the test is compiled in only once anything has been dug (DIG_MASK), so an
// untouched world pays nothing for it.
const DIG = { uDigMask: { value: null }, uDigWin: { value: new THREE.Vector4(0, 0, 0.3, 0) }, on: false };
function enableDigMask(tex) {
  DIG.uDigMask.value = tex;
  if (DIG.on) return;
  DIG.on = true; terrainMat.defines = { ...(terrainMat.defines || {}), DIG_MASK: '' }; terrainMat.needsUpdate = true;
}
const DIG_F = `
#ifdef DIG_MASK
{
  vec2 dc = floor((vWPosT.xz - uDigWin.xy) / uDigWin.z);
  if (uDigWin.w > 0.0 && dc.x >= 0.0 && dc.y >= 0.0 && dc.x < uDigWin.w && dc.y < uDigWin.w && texelFetch(uDigMask, ivec2(dc), 0).r > 0.5) discard;
}
#endif`;
terrainMat.onBeforeCompile = (sh) => {
  sh.uniforms.uSkyMap = U.skyMap; sh.uniforms.uSkyK = U.skyK;
  sh.uniforms.uDigMask = DIG.uDigMask; sh.uniforms.uDigWin = DIG.uDigWin;
  const lu = riverLive.uniforms, ru = riverWater.uniforms;
  sh.uniforms.uLiveState = lu.uState; sh.uniforms.uLiveFeed = lu.uFeed; sh.uniforms.uLiveOrg = lu.uOrg; sh.uniforms.uLiveCell = lu.uCell; sh.uniforms.uLiveN = lu.uN; sh.uniforms.uWin = lu.uBedWin; sh.uniforms.uFoamTex = ru.uFoamTex; sh.uniforms.uSeaTex = ru.uTex; sh.uniforms.uTime = U.time; sh.uniforms.uSunDirB = ru.uSunDir; sh.uniforms.uSunColB = ru.uSunCol; sh.uniforms.uBedVox = U.bedVox;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + SKY_PARS_V + '\nvarying vec3 vWPosT;')
    .replace('#include <project_vertex>', '#include <project_vertex>' + SKY_V('(modelMatrix * vec4(transformed, 1.0)).xz') + '\nvWPosT = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + SKY_PARS_F + BED_PARS_F + '\n#ifdef DIG_MASK\nuniform highp sampler2D uDigMask; uniform vec4 uDigWin;\n#endif').replace('#include <aomap_fragment>', SKY_F)
    .replace('#include <map_fragment>', BED_F).replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>' + DIG_F)
    .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directDiffuse += bedCaustic * uSunColB * diffuseColor.rgb;');
};
terrainMat.customProgramCacheKey = () => 'terrain-sky4-bed' + (DIG.on ? '-dig' : '');
const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: pixelTex });

// ============================================================ geometry library
const col = (hex) => new THREE.Color(hex);
function paint(geo, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position, n = pos.count;
  const c = new Float32Array(n * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    fn(tmp, pos.getX(i), pos.getY(i), pos.getZ(i));
    c[i * 3] = tmp.r; c[i * 3 + 1] = tmp.g; c[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
// ---- tree atlas: bark, birch bark, leaf cluster, pine bough (pixel art, generated)
function makeAtlas() {
  let c = document.createElement("canvas");
  c.width = c.height = 128;
  let g = c.getContext("2d"),
    img = g.createImageData(128, 128),
    d = img.data,
    r = mulberry32(4242),
    put = (x, y, l, a = 255) => {
      if (x < 0 || y < 0 || x >= 128 || y >= 128) return;
      let i = (y * 128 + x) * 4,
        v = clamp(Math.round(l * 255), 0, 255);
      ((d[i] = v), (d[i + 1] = v), (d[i + 2] = v), (d[i + 3] = a));
    },
    colR = [];
  for (let i = 0; i < 32; i++) colR.push(r());
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      let l = 0.8 + 0.16 * colR[x >> 1] + (r() - 0.5) * 0.08;
      ((hash2(x >> 1, y >> 3, 77) & 255) < 34 && (l *= 0.62), put(x, y, l));
    }
  for (let y = 0; y < 64; y++) for (let x = 64; x < 128; x++) put(x, y, 0.92 + (r() - 0.5) * 0.1);
  for (let k = 0; k < 16; k++) {
    let y0 = Math.floor(r() * 62),
      x0 = 64 + Math.floor(r() * 54),
      len = 5 + Math.floor(r() * 12),
      th = 1 + (r() < 0.4 ? 1 : 0);
    for (let x = x0; x < Math.min(x0 + len, 128); x++) for (let t2 = 0; t2 < th; t2++) put(x, y0 + t2, 0.25 + r() * 0.1);
  }
  for (let k = 0; k < 34; k++) {
    let rr = Math.sqrt(r()) * 26,
      an = r() * 6.283,
      cx = 32 + Math.cos(an) * rr,
      cy = 96 + Math.sin(an) * rr,
      rot = r() * 6.283,
      a = 2.1 + r() * 1,
      b = 4.4 + r() * 2.4,
      base = 0.74 + 0.26 * r(),
      co = Math.cos(rot),
      si = Math.sin(rot);
    for (let y = Math.floor(cy - 8); y <= cy + 8; y++)
      for (let x = Math.floor(cx - 8); x <= cx + 8; x++) {
        if (x < 1 || x > 62 || y < 65 || y > 126) continue;
        let dx = x + 0.5 - cx,
          dy = y + 0.5 - cy,
          u = dx * co + dy * si,
          v = -dx * si + dy * co,
          taper = a * (1 - 0.55 * Math.max(0, v / b));
        (u / taper) ** 2 + (v / b) ** 2 >= 1 || put(x, y, base * (Math.abs(u) < 0.6 ? 0.82 : 1) * (0.9 + 0.1 * (v / b)));
      }
  }
  for (let x = 1; x < 63; x++) {
    let f = x / 63,
      hw = 25 * Math.min(1, x / 12) * Math.pow(1 - f, 0.7) + 1.5;
    for (let y = 2; y < 62; y++) {
      let dy = y - 32,
        ad = Math.abs(dy);
      if (ad <= 1) {
        put(64 + x, 64 + y, 0.62);
        continue;
      }
      ad >= hw || (((((x - ad) % 4) + 4) % 4 < 2 || r() < 0.12) && put(64 + x, 64 + y, 0.72 + 0.28 * (ad / hw) + (r() - 0.5) * 0.08));
    }
  }
  {
    let pa = (x, y, v, al = 255) => {
      x < 1 || x > 62 || y < 1 || y > 62 || put(64 + x, 64 + y, v, al);
    };
    for (let c = 0; c < 64; c++) for (let h = 0; h < 64; h++) put(64 + c, 64 + h, 0, 0);
    for (let c = 1; c < 62; c++) (pa(c, 32, 0.52), c < 24 && pa(c, 31, 0.48));
    for (let c = 2; c < 60; c += 4)
      for (let sg = -1; sg <= 1; sg += 2) {
        let c0 = c + (sg > 0 ? 2 : 0),
          L = (21 * Math.min(1, c0 / 9) * Math.pow(1 - c0 / 63, 0.62) + 3) * (0.78 + 0.44 * r()),
          an = 0.8 + 0.3 * r(),
          ca = Math.cos(an),
          sa = Math.sin(an) * sg;
        for (let q = 0; q < L; q += 0.5) {
          let x = c0 + ca * q,
            y = 32 + sa * q;
          if ((pa(Math.round(x), Math.round(y), 0.58), q % 1)) continue;
          for (let s2 = -1; s2 <= 1; s2 += 2) {
            let nl = 2 + r() * 2.4,
              na = an * sg + s2 * 0.85,
              bq = 0.7 + 0.3 * r();
            for (let k = 1; k <= nl; k++) pa(Math.round(x + Math.cos(na) * k), Math.round(y + Math.sin(na) * k), bq * (0.82 + (0.18 * k) / nl));
          }
        }
      }
  }
  {
    // conifer bark: long plated ridges with dark furrows between them, broken across here and there
    let x = 0,
      ridges = [];
    while (x < 64) {
      let w = Math.min(64 - x, 3 + Math.floor(r() * 4));
      (ridges.push([x, w, r() * 6.28, 0.78 + r() * 0.22]), (x += w));
    }
    for (let [x0, w, ph, tone] of ridges) {
      let next = 3 + Math.floor(r() * 9);
      for (let y = 0; y < 64; y++) {
        let wob = Math.round(Math.sin(y * 0.33 + ph) * 0.9),
          crack = --next <= 0;
        crack && (next = 5 + Math.floor(r() * 12));
        for (let k = 0; k < w; k++) {
          let px = (x0 + k + wob + 64) % 64,
            edge = k === 0 ? 0.5 : k === 1 || k === w - 1 ? 0.78 : 1,
            v = tone * edge * (0.9 + r() * 0.14);
          (crack && k > 0 && (v *= 0.7), put(px, y, v));
        }
      }
    }
    // birch: chalk-white paper with fine dashes, dark eyes where branches were, and rough black bark at the foot
    for (let y = 0; y < 64; y++)
      for (let xx = 64; xx < 128; xx++) {
        let foot = smoothstep(46, 60, y);
        put(xx, y, lerp(0.9 + (r() - 0.5) * 0.08, (hash2(xx >> 1, y >> 2, 31) & 255) < 120 ? 0.3 : 0.62, foot * (r() < 0.75 ? 1 : 0.4)));
      }
    for (let k = 0; k < 46; k++) {
      let y = Math.floor(r() * 50),
        x0 = 64 + Math.floor(r() * 60),
        len = 2 + Math.floor(r() * 8);
      for (let q = 0; q < len && x0 + q < 128; q++) put(x0 + q, y, 0.5 + r() * 0.12);
    }
    for (let k = 0; k < 5; k++) {
      let cy = 4 + Math.floor(r() * 40),
        cx = 70 + Math.floor(r() * 50),
        hw = 3 + Math.floor(r() * 3);
      for (let q = -hw; q <= hw; q++) for (let d = 0; d <= hw - Math.abs(q); d++) (put(cx + q, cy - d, 0.14), d === 0 && put(cx + q, cy + 1, 0.4));
    }
  }
  g.putImageData(img, 0, 0);
  // The atlas is repainted at four times the resolution: bark, birch, broadleaf and needle sprays.
  let S = 256,
    big = document.createElement("canvas");
  big.width = big.height = S * 2;
  let bx = big.getContext("2d"),
    im = bx.createImageData(S * 2, S * 2),
    px = im.data,
    R = mulberry32(9091),
    putBig = (ox, oy, x, y, v, al = 255) => {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || y < 0 || x >= S || y >= S) return;
      let f = ((oy + y) * S * 2 + ox + x) * 4,
        p = clamp(Math.round(v * 255), 0, 255);
      ((px[f] = p), (px[f + 1] = p), (px[f + 2] = p), (px[f + 3] = al));
    },
    get = (ox, oy, x, y) => px[((oy + y) * S * 2 + ox + x) * 4] / 255;
  {
    // Conifer and oak bark, grown from layered noise so no two plates match: fissures follow the contours
    // of a stretched, warped field, and the whole sheet repeats seamlessly so it can tile up a trunk.
    let lat = (cx, cy, sd) => (hash2(cx, cy, sd) & 65535) / 65535,
      pn = (u, v, qx, qy, sd) => {
        let fx = u * qx,
          fy = v * qy,
          x0 = Math.floor(fx),
          y0 = Math.floor(fy),
          tx = fx - x0,
          ty = fy - y0,
          w = (k, q) => ((k % q) + q) % q;
        tx = tx * tx * (3 - 2 * tx);
        ty = ty * ty * (3 - 2 * ty);
        return lerp(lerp(lat(w(x0, qx), w(y0, qy), sd), lat(w(x0 + 1, qx), w(y0, qy), sd), tx), lerp(lat(w(x0, qx), w(y0 + 1, qy), sd), lat(w(x0 + 1, qx), w(y0 + 1, qy), sd), tx), ty);
      };
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        let u = x / S,
          v = y / S,
          warp = (pn(u, v, 7, 3, 11) - 0.5) * 0.035 + (pn(u, v, 19, 7, 12) - 0.5) * 0.014,
          n1 = 0.5 * pn(u + warp, v, 22, 4, 21) + 0.32 * pn(u + warp, v, 41, 9, 22) + 0.18 * pn(u + warp, v, 77, 19, 23),
          n2 = pn(u + warp * 0.5, v, 53, 11, 31),
          deep = 1 - smoothstep(0, 0.06, Math.abs(n1 - 0.5)),
          fine = 1 - smoothstep(0, 0.035, Math.abs(n2 - 0.5)),
          plate = 0.84 + 0.16 * pn(u, v, 12, 5, 41),
          grain = (pn(u, v, 110, 44, 51) - 0.5) * 0.16 + (R() - 0.5) * 0.05;
        putBig(0, 0, x, y, clamp(plate * (1 - 0.3 * deep) * (1 - 0.12 * fine) + grain * 0.8, 0.45, 1));
      }
  }
  {
    // birch: chalky paper bark with fine lenticels, dark eyes, and rough black bark at the foot
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        let foot = smoothstep(170, 235, y + 14 * Math.sin(x * 0.11)),
          rough = (hash2(x >> 3, y >> 4, 31) & 255) < 110 ? 0.24 + R() * 0.08 : 0.5 + R() * 0.14;
        putBig(S, 0, x, y, lerp(0.9 + (R() - 0.5) * 0.05 + 0.03 * Math.sin(y * 0.3 + x * 0.02), rough, foot * (R() < 0.8 ? 1 : 0.5)));
      }
    for (let k = 0; k < 190; k++) {
      let y = Math.floor(R() * 205),
        x0 = Math.floor(R() * S),
        len = 5 + Math.floor(R() * 26),
        v = 0.52 + R() * 0.2,
        th = R() < 0.3 ? 2 : 1;
      for (let q = 0; q < len; q++) for (let d = 0; d < th; d++) putBig(S, 0, (x0 + q) % S, y + d, v + 0.2 * Math.abs(q / len - 0.5));
    }
    for (let k = 0; k < 7; k++) {
      let cy = 16 + Math.floor(R() * 150),
        cx = 24 + Math.floor(R() * 208),
        hw = 9 + Math.floor(R() * 9);
      for (let q = -hw; q <= hw; q++) {
        let top = Math.round((hw - Math.abs(q)) * 0.75);
        for (let d = -2; d <= top; d++) putBig(S, 0, cx + q, cy - d, 0.1 + 0.25 * (d < 0 ? 1 : d / (top + 1)) * R());
        (putBig(S, 0, cx + q, cy + 3, 0.62), putBig(S, 0, cx + q, cy + 4, 0.74));
      }
    }
  }
  {
    // broadleaf spray: pointed leaves with a midrib and veins, lit toward the tip
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) putBig(0, S, x, y, 0, 0);
    for (let k = 0; k < 46; k++) {
      let rad = Math.sqrt(R()) * 100,
        an = R() * 6.283,
        cx = 128 + Math.cos(an) * rad,
        cy = 128 + Math.sin(an) * rad,
        dir = R() * 6.283,
        hw = 8 + R() * 5,
        hl = 17 + R() * 11,
        tone = 0.7 + 0.3 * R(),
        cd = Math.cos(dir),
        sd = Math.sin(dir);
      for (let y = Math.floor(cy - 32); y <= cy + 32; y++)
        for (let x = Math.floor(cx - 32); x <= cx + 32; x++) {
          let dx = x + 0.5 - cx,
            dy = y + 0.5 - cy,
            u = dx * cd + dy * sd,
            v = -dx * sd + dy * cd,
            t = u / hl,
            wAt = hw * (1 - 0.55 * Math.max(0, t)) * Math.sqrt(Math.max(0, 1 - t * t * 0.96));
          if (t < -1 || t > 1 || Math.abs(v) >= wAt) continue;
          let vein = Math.abs(v) < 0.8 ? 0.78 : Math.abs(((u + Math.abs(v) * 0.9) % 6) + 6) % 6 < 0.9 ? 0.9 : 1,
            edge = Math.abs(v) > wAt - 1.2 ? 0.86 : 1;
          putBig(0, S, x, y, tone * vein * edge * (0.88 + 0.12 * t) * (0.96 + R() * 0.07));
        }
    }
  }
  {
    // conifer bough: a tapering stem, side shoots, and fine needles swept forward along each
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) putBig(S, S, x, y, 0, 0);
    let dab = (x, y, v, th) => {
      for (let d = 0; d < th; d++) (putBig(S, S, x, y + d, v), putBig(S, S, x + d, y, v));
    };
    for (let c = 4; c < 250; c++) for (let d = -2; d <= 2; d++) Math.abs(d) <= 2 * (1 - c / 260) + 0.5 && putBig(S, S, c, 128 + d, 0.5);
    for (let c = 6; c < 240; c += 8)
      for (let sg = -1; sg <= 1; sg += 2) {
        let c0 = c + (sg > 0 ? 4 : 0) + R() * 3,
          L = (88 * Math.min(1, c0 / 36) * Math.pow(1 - c0 / 252, 0.6) + 10) * (0.75 + 0.5 * R()),
          an = 0.78 + 0.34 * R(),
          bend = (R() - 0.3) * 0.004;
        for (let q = 0; q < L; q += 0.5) {
          let aa = an - bend * q * 4,
            x = c0 + Math.cos(aa) * q,
            y = 128 + Math.sin(aa) * q * sg;
          if ((dab(x, y, 0.56, q < L * 0.5 ? 2 : 1), q % 2)) continue;
          for (let s2 = -1; s2 <= 1; s2 += 2) {
            let nl = 8 + R() * 9,
              na = aa * sg + s2 * (0.7 + R() * 0.3),
              bq = 0.68 + 0.32 * R();
            for (let k = 1; k <= nl; k += 0.7) dab(x + Math.cos(na) * k, y + Math.sin(na) * k, bq * (0.8 + (0.2 * k) / nl), k < nl * 0.6 ? 2 : 1);
          }
        }
      }
  }
  bx.putImageData(im, 0, 0);
  let l = new THREE.CanvasTexture(big);
  return ((l.magFilter = THREE.LinearFilter), (l.minFilter = THREE.LinearFilter), (l.generateMipmaps = !1), (l.colorSpace = THREE.SRGBColorSpace), l);
}
const atlasTex = makeAtlas();
const Q = { bark: [0, 0.5], birch: [0.5, 0.5], leaf: [0, 0], pine: [0.5, 0] };
const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: atlasTex, alphaTest: 0.5, alphaToCoverage: true });
addWind(treeMat, 1.5, 7.0, 0.24, true);
const treeDepthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlasTex, alphaTest: 0.5 });
addWind(treeDepthMat, 1.5, 7.0, 0.24, false);

const V3 = THREE.Vector3;
const v3 = (x, y, z) => new V3(x, y, z);
function newB() { return { pos: [], nor: [], uv: [], col: [] }; }
function pushV(B, p, n, q, s, t, c) {
  B.pos.push(p.x, p.y, p.z); B.nor.push(n.x, n.y, n.z);
  B.uv.push(q[0] + (0.02 + 0.96 * s) * 0.5, q[1] + (0.02 + 0.96 * t) * 0.5);
  B.col.push(c.r, c.g, c.b);
}
const _e1 = new V3(), _e2 = new V3();
// tapered tube along a list of {p, r}; triangles are wound to face outward
function tube(B, pts, sides, q, cA, cB) {
  const last = pts.length - 1;
  const axis = new V3().subVectors(pts[last].p, pts[0].p).normalize();
  const ref = Math.abs(axis.y) > 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
  const rings = [];
  for (let i = 0; i <= last; i++) {
    const dir = new V3().subVectors(pts[Math.min(i + 1, last)].p, pts[Math.max(i - 1, 0)].p).normalize();
    const u = new V3().crossVectors(dir, ref).normalize(), w = new V3().crossVectors(dir, u).normalize();
    const ring = [];
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const n = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a));
      ring.push({ p: pts[i].p.clone().addScaledVector(n, pts[i].r), n, s: k / sides, t: i / last, c: cA.clone().lerp(cB, i / last) });
    }
    rings.push(ring);
  }
  const tri = (a, b, c) => {
    _e1.subVectors(b.p, a.p); _e2.subVectors(c.p, a.p); _e1.cross(_e2);
    if (_e1.dot(a.n) < 0) { const x = b; b = c; c = x; }
    for (const o of [a, b, c]) pushV(B, o.p, o.n, q, o.s, o.t, o.c);
  };
  for (let i = 0; i < last; i++) for (let k = 0; k < sides; k++) {
    tri(rings[i][k], rings[i + 1][k], rings[i][k + 1]);
    tri(rings[i][k + 1], rings[i + 1][k], rings[i + 1][k + 1]);
  }
}
// textured card, emitted with both windings and one shared normal so both faces light the same
function tubeTiled(s, t, e, n, i, r, tile) {
  let L = [0];
  for (let u = 1; u < t.length; u++) L.push(L[u - 1] + t[u].p.distanceTo(t[u - 1].p));
  let total = L[L.length - 1],
    at = (d) => {
      let u = 1;
      for (; u < t.length - 1 && L[u] < d; ) u++;
      let k = (d - L[u - 1]) / (L[u] - L[u - 1] || 1);
      return { p: t[u - 1].p.clone().lerp(t[u].p, k), r: t[u - 1].r + (t[u].r - t[u - 1].r) * k };
    },
    st = [];
  for (let d = 0; d < total - 0.05; d += tile) st.push(d);
  st.push(total);
  // keep the bends of the original trunk
  for (let u = 1; u < t.length - 1; u++) st.some((d) => Math.abs(d - L[u]) < 0.12) || st.push(L[u]);
  st.sort((u, d) => u - d);
  let l = v3(1, 0, 0),
    ring = (d, tv) => {
      let q = at(d),
        dir = new V3().subVectors(at(Math.min(total, d + 0.2)).p, at(Math.max(0, d - 0.2)).p).normalize(),
        f = new V3().crossVectors(dir, l).normalize(),
        p = new V3().crossVectors(dir, f).normalize(),
        x = [];
      for (let m = 0; m <= e; m++) {
        let gq = (m / e) * Math.PI * 2,
          _ = f.clone().multiplyScalar(Math.cos(gq)).addScaledVector(p, Math.sin(gq));
        x.push({ p: q.p.clone().addScaledVector(_, q.r), n: _, s: m / e, t: tv, c: i.clone().lerp(r, d / total) });
      }
      return x;
    },
    push = (u) => {
      (s.pos.push(u.p.x, u.p.y, u.p.z),
        s.nor.push(u.n.x, u.n.y, u.n.z),
        s.uv.push(n[0] + (0.006 + 0.988 * u.s) * 0.5, n[1] + (0.006 + 0.988 * u.t) * 0.5),
        s.col.push(u.c.r, u.c.g, u.c.b));
    },
    h = (u, d, f) => {
      if ((_e1.subVectors(d.p, u.p), _e2.subVectors(f.p, u.p), _e1.cross(_e2), _e1.dot(u.n) < 0)) {
        let p = d;
        ((d = f), (f = p));
      }
      (push(u), push(d), push(f));
    };
  for (let k = 0; k < st.length - 1; k++) {
    let t0 = (st[k] / tile) % 1,
      A = ring(st[k], t0),
      B = ring(st[k + 1], t0 + (st[k + 1] - st[k]) / tile);
    for (let d = 0; d < e; d++) (h(A[d], B[d], A[d + 1]), h(A[d + 1], B[d], B[d + 1]));
  }
}
function card(B, c, U, W, q, nFn, cFn) {
  const mk = (s, t) => {
    const p = c.clone().addScaledVector(U, s * 2 - 1).addScaledVector(W, t * 2 - 1);
    return { p, n: nFn(p), s, t, c: cFn(s, t, p) };
  };
  const a = mk(0, 0), b = mk(1, 0), d = mk(1, 1), e = mk(0, 1);
  for (const o of [a, b, d, a, d, e, a, d, b, a, e, d]) pushV(B, o.p, o.n, q, o.s, o.t, o.c);
}
function finish(B) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
  g.computeBoundingSphere();
  return g;
}
// Crown shading: inside a tree, leaves and limbs are lit by less sky than the outer shell. For each vertex, how far
// out it sits compared with the outermost vertex at its height (0.5 m bands), and how low in the tree it is, set a
// darkening baked into the vertex colours: a lit shell, a dark core, a darker underside. The trunk below the crown
// is the outermost thing at its height, so it is left alone. The original colours are kept to switch it off.
function crownShade(g) {
  const pos = g.attributes.position.array, n = pos.length / 3, band = new Map();
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = pos[i * 3 + 1], r = Math.hypot(pos[i * 3], pos[i * 3 + 2]), b = Math.floor(y * 2);
    band.set(b, Math.max(band.get(b) || 0, r)); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const ao = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const y = pos[i * 3 + 1], r = Math.hypot(pos[i * 3], pos[i * 3 + 2]), b = Math.floor(y * 2);
    const rm = Math.max(band.get(b - 1) || 0, band.get(b) || 0, band.get(b + 1) || 0);
    const open = rm > 0.6 ? r / rm : 1;                        // bands no wider than a trunk are not crown
    ao[i] = lerp(0.55, 1, smoothstep(0.1, 0.95, open)) * lerp(0.82, 1, smoothstep(y0 + 0.3 * (y1 - y0), y1, y));
  }
  g.userData.baseCol = Float32Array.from(g.attributes.color.array);
  g.userData.crownAo = ao;
}
function applyCrownShade(g, on) {
  const c = g.attributes.color.array, b = g.userData.baseCol, ao = g.userData.crownAo;
  if (!b) return;
  for (let i = 0; i < ao.length; i++) { const k = on ? ao[i] : 1; c[i * 3] = b[i * 3] * k; c[i * 3 + 1] = b[i * 3 + 1] * k; c[i * 3 + 2] = b[i * 3 + 2] * k; }
  g.attributes.color.needsUpdate = true;
}
// a canopy of leaf cards scattered through an ellipsoid, shaded as one rounded mass
function canopy(B, r, C, rad, n, sMin, sMax, dark, light, anchors) {
  const nFn = (p) => v3((p.x - C.x) / rad.x, (p.y - C.y) / rad.y + 0.7, (p.z - C.z) / rad.z).normalize();
  for (let i = 0; i < n; i++) {
    let p, dir;
    if (i < anchors.length) { p = anchors[i].clone(); dir = new V3().subVectors(p, C).normalize(); }
    else {
      dir = v3(r() * 2 - 1, r() * 1.5 - 0.45, r() * 2 - 1).normalize();
      const f = 0.5 + 0.5 * r();
      p = v3(C.x + dir.x * rad.x * f, C.y + dir.y * rad.y * f, C.z + dir.z * rad.z * f);
    }
    const N = dir.clone().add(v3((r() - 0.5) * 0.9, 0.55 + r() * 0.4, (r() - 0.5) * 0.9)).normalize();
    const size = lerp(sMin, sMax, r()) * 0.5;
    const U = new V3().crossVectors(N, v3(r() - 0.5, r() - 0.5, r() - 0.5)).normalize();
    const W = new V3().crossVectors(N, U).normalize();
    const tint = 0.84 + 0.3 * r();
    card(B, p, U.multiplyScalar(size), W.multiplyScalar(size), Q.leaf, nFn, (s, t, pp) => {
      const k = smoothstep(C.y - rad.y, C.y + rad.y * 0.9, pp.y);
      return dark.clone().lerp(light, k).multiplyScalar(tint);
    });
  }
}
function branch(B, r, from, to, r0, q, c) {
  const mid = from.clone().lerp(to, 0.5); mid.y += 0.25;
  tube(B, [{ p: from, r: r0 }, { p: mid, r: r0 * 0.65 }, { p: to, r: r0 * 0.25 }], 4, q, c, c);
}
const TRUNK = [
  { pts: [[0, -0.3, 0, 0.56], [0.01, 0.22, 0, 0.42], [0, 0.8, 0.01, 0.34], [0, 3, 0, 0.24], [0.03, 6, 0, 0.13], [0, 8.7, 0, 0.03]], sides: 6, q: 'bark', c0: 0x5d4735, c1: 0x7c634c },
  { pts: [[0, -0.3, 0, 0.3], [0.02, 0.25, 0, 0.21], [0.1, 1.6, 0.02, 0.15], [0, 3.3, 0.1, 0.12], [0.16, 4.9, 0.02, 0.08], [0.1, 6.3, 0, 0.03]], sides: 6, q: 'birch', c0: 0xd6d2c4, c1: 0xf1eee4 },
  { pts: [[0, -0.3, 0, 0.72], [0.02, 0.2, 0, 0.5], [0.05, 0.9, 0.02, 0.31], [-0.08, 2.1, 0.06, 0.26], [0.06, 3.4, 0, 0.17], [0, 4.7, 0, 0.09]], sides: 7, q: 'bark', c0: 0x5a4332, c1: 0x7d6048 },
];
const trunkPts = (t) => TRUNK[t].pts.map((a) => ({ p: v3(a[0], a[1], a[2]), r: a[3] }));
function buildOak() {
  const B = newB(), r = mulberry32(11);
  const b0 = col(0x766f66), b1 = col(0x968e82);
  tubeTiled(B, trunkPts(2), 10, Q.bark, b0, b1, 1.5);
  // moss creeping up the foot of the trunk
  tube(B, [{ p: v3(0, -0.25, 0), r: 0.725 }, { p: v3(0.02, 0.2, 0), r: 0.508 }, { p: v3(0.04, 0.62, 0.01), r: 0.375 }], 10, Q.bark, col(0x4b5f2e), col(0x5d5732));
  const C = v3(0, 4.3, 0), rad = v3(2.7, 1.7, 2.7), ends = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * 6.283 + r() * 0.7, len = 1.5 + r() * 0.9;
    const end = v3(Math.cos(a) * len, 3.5 + r() * 1.3, Math.sin(a) * len);
    branch(B, r, v3(0, 2.0 + r() * 1.0, 0), end, 0.13, Q.bark, b1);
    ends.push(end);
  }
  canopy(B, r, C, rad, 30, 1.7, 2.4, col(0x2a5a26), col(0x77b347), ends);
  return finish(B);
}
function buildBirch() {
  const B = newB(), r = mulberry32(23);
  const b0 = col(0xd6d2c4), b1 = col(0xf1eee4);
  tube(B, trunkPts(1), 8, Q.birch, b0, b1);
  const C = v3(0.08, 4.9, 0.02), rad = v3(1.6, 2.1, 1.6), ends = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * 6.283 + r(), len = 0.9 + r() * 0.7, y = 3.2 + i * 0.5;
    const end = v3(0.1 + Math.cos(a) * len, y + 0.6 + r() * 0.4, Math.sin(a) * len);
    branch(B, r, v3(0.06, y, 0.04), end, 0.06, Q.birch, b1);
    ends.push(end);
  }
  canopy(B, r, C, rad, 22, 1.1, 1.6, col(0x6c9a30), col(0xcbe060), ends);
  return finish(B);
}
function buildPine(lite) {
  // A conifer grown in whorls: each bough is a thin limb that sags and lifts at the tip,
  // carrying a flat spray of needles and a second one hanging beneath it.
  let B = newB(),
    r = mulberry32(37),
    e = col(7366244),
    n = col(5262908),
    limb = col(3814953);
  lite ? tube(B, trunkPts(0), 5, Q.bark, e, n) : tubeTiled(B, trunkPts(0), 9, Q.bark, e, n, 1.5);
  lite ||
    tube(
    B,
    [
      { p: v3(0, -0.25, 0), r: 0.565 },
      { p: v3(0.01, 0.22, 0), r: 0.428 },
      { p: v3(0, 0.6, 0.01), r: 0.368 },
    ],
    9,
    Q.bark,
    col(4939566),
    col(6117170),
  );
  let i = col(1323037),
    mid = col(5012026),
    tipPale = col(8365648),
    dead = col(7038300);
  for (let o = 0; o < (lite ? 0 : 5); o++) {
    let y = 0.9 + o * 0.3 + r() * 0.2,
      x = r() * 6.283,
      len = 0.3 + r() * 0.55;
    tube(
      B,
      [
        { p: v3(Math.cos(x) * 0.15, y, Math.sin(x) * 0.15), r: 0.04 },
        { p: v3(Math.cos(x) * (0.15 + len), y + 0.08 - r() * 0.2, Math.sin(x) * (0.15 + len)), r: 0.012 },
      ],
      3,
      Q.bark,
      dead,
      dead,
    );
  }
  let W = lite ? 6 : 10;
  for (let o = 0; o < W; o++) {
    let l = o / (W - 1),
      y = 1.8 + l * 6.3,
      L = lerp(2.75, 0.6, Math.pow(l, 0.8)) * (0.88 + 0.24 * r()),
      cnt = lite || l > 0.8 ? 4 : 5,
      droop = lerp(0.42, -0.3, l);
    for (let p = 0; p < cnt; p++) {
      let a = (p / cnt) * 6.283 + o * 2.4 + (r() - 0.5) * 0.7,
        len = L * (0.72 + 0.5 * r()),
        yy = y + (r() - 0.5) * 0.4,
        dir = v3(Math.cos(a), 0, Math.sin(a)),
        sd = v3(-Math.sin(a), 0, Math.cos(a)),
        p0 = v3(dir.x * 0.1, yy, dir.z * 0.1),
        p1 = v3(dir.x * len * 0.55, yy - Math.sin(droop) * len * 0.55, dir.z * len * 0.55),
        p2 = v3(dir.x * len, yy - Math.sin(droop) * len * 0.8 + 0.14 * len, dir.z * len),
        w = (0.82 + 0.3 * r()) * lerp(0.82, 1.1, l),
        nf = v3(dir.x * 0.45, 1, dir.z * 0.45).normalize(),
        roll = (r() - 0.5) * 0.7;
      !lite &&
        l < 0.62 &&
        tube(
          B,
          [
            { p: p0, r: 0.05 * (1 - l * 0.6) },
            { p: p1, r: 0.024 },
            { p: p1.clone().lerp(p2, 0.45), r: 0.008 },
          ],
          3,
          Q.bark,
          limb,
          limb,
        );
      let segs =
        lite || l > 0.8
          ? [[p0, p2, 0, 1]]
          : [
              [p0.clone().lerp(p1, 0.25), p1, 0, 0.55],
              [p1, p2.clone().addScaledVector(dir, len * 0.08), 0.45, 1],
            ];
      for (let [A, Bq, c0, c1] of segs) {
        let c = A.clone().lerp(Bq, 0.5),
          hv = Bq.clone().sub(A).multiplyScalar(0.56),
          wd2 = len * (segs.length > 1 ? (c0 ? 0.33 : 0.42) : 0.4),
          tv = sd
            .clone()
            .multiplyScalar(Math.cos(roll))
            .add(v3(0, Math.sin(roll), 0)),
          cf = (T) =>
            i
              .clone()
              .lerp(mid, smoothstep(0, 1, c0 + (c1 - c0) * T))
              .lerp(tipPale, c1 === 1 ? smoothstep(0.72, 1, T) * 0.55 : 0)
              .multiplyScalar(w);
        card(B, c, hv, tv.multiplyScalar(wd2), Q.pine, () => nf, cf);
        !lite &&
          l < 0.45 &&
          card(
            B,
            c.clone().add(v3(0, -wd2 * 0.42, 0)),
            hv.clone().multiplyScalar(0.9),
            v3(sd.x * 0.3, -0.95, sd.z * 0.3).multiplyScalar(wd2 * 0.5),
            Q.pine,
            () => nf,
            (T) => cf(T).multiplyScalar(0.78),
          );
      }
    }
  }
  for (let o = 0; o < 3; o++) {
    let x = (o / 3) * 3.1416 + 0.4;
    card(
      B,
      v3(0, 8.55, 0),
      v3(0, 0.75, 0),
      v3(Math.cos(x) * 0.42, 0, Math.sin(x) * 0.42),
      Q.pine,
      (T) => v3(T.x, 0.6, T.z).normalize(),
      () => mid.clone().lerp(tipPale, 0.4),
    );
  }
  return finish(B);
}
const PINE = 0, BIRCH = 1, OAK = 2;
const TREE = [
  { name: 'pine', h: 8.6, r: 0.34, hp: 4, logs: 2, logR: 0.22 },
  { name: 'birch', h: 6.3, r: 0.2, hp: 3, logs: 2, logR: 0.13 },
  { name: 'oak', h: 5.8, r: 0.42, hp: 5, logs: 2, logR: 0.3 },
];
const treeGeo = [buildPine(), buildBirch(), buildOak()];
const pineLiteGeo = buildPine(1);      // a cheaper pine for the distance
for (const g of [...treeGeo, pineLiteGeo]) { crownShade(g); applyCrownShade(g, LOOK.crownShade); }
// ---- felled trunks: the same trunk the standing tree had, whole and then as two halves
function trunkPiece(type, y0, y1) {
  const T = TRUNK[type], src = T.pts;
  const at = (y) => {
    for (let i = 0; i < src.length - 1; i++) {
      if (y <= src[i + 1][1] || i === src.length - 2) {
        const a = src[i], b = src[i + 1], k = clamp((y - a[1]) / (b[1] - a[1]), 0, 1);
        return { p: v3(lerp(a[0], b[0], k), y, lerp(a[2], b[2], k)), r: lerp(a[3], b[3], k) };
      }
    }
  };
  const pts = [at(y0)];
  for (const a of src) if (a[1] > y0 + 0.05 && a[1] < y1 - 0.05) pts.push({ p: v3(a[0], a[1], a[2]), r: a[3] });
  pts.push(at(y1));
  const B = newB();
  tube(B, pts, T.sides, Q[T.q], col(T.c0), col(T.c1));
  const wood = col(0xd9b98a);
  for (const [pt, sgn] of [[pts[0], -1], [pts[pts.length - 1], 1]]) {
    const n = v3(0, sgn, 0);
    for (let k = 0; k < T.sides; k++) {
      const a0 = (k / T.sides) * 6.2832, a1 = ((k + 1) / T.sides) * 6.2832;
      const A = pt.p.clone(), Bp = pt.p.clone().add(v3(Math.cos(a0) * pt.r, 0, Math.sin(a0) * pt.r)), C = pt.p.clone().add(v3(Math.cos(a1) * pt.r, 0, Math.sin(a1) * pt.r));
      _e1.subVectors(Bp, A); _e2.subVectors(C, A); _e1.cross(_e2);
      const order = _e1.dot(n) < 0 ? [A, C, Bp] : [A, Bp, C];
      for (const o of order) pushV(B, o, n, Q[T.q], 0.5, 0.5, wood);
    }
  }
  const g = finish(B), cy = (y0 + y1) / 2;
  g.translate(0, -cy, 0); g.rotateZ(-Math.PI / 2); g.computeBoundingSphere();
  // real volume of this piece of trunk (m3 at scale 1): the sum of its tapered sections
  let vol = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const h = pts[i + 1].p.y - pts[i].p.y, a = pts[i].r, b = pts[i + 1].r;
    vol += (Math.PI * h * (a * a + a * b + b * b)) / 3;
  }
  return { geo: g, len: y1 - y0, r: (pts[0].r + pts[pts.length - 1].r) / 2, cy, vol };
}
const LOGS = TRUNK.map((T, t) => {
  const top = T.pts[T.pts.length - 1][1] - 0.4, mid = top * 0.5;
  return { full: trunkPiece(t, -0.1, top), lo: trunkPiece(t, -0.1, mid), hi: trunkPiece(t, mid, top) };
});
const stumpGeo = (() => {
  const g = new THREE.CylinderGeometry(0.9, 1.05, 0.5, 7, 1); g.translate(0, 0.2, 0);
  const a = col(0x4a3524), b = col(0xc9a877);
  return paint(g, (c, x, y) => c.copy(y > 0.44 && Math.hypot(x) < 2 ? b : a));
})();
const logGeo = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 8, 1); g.rotateZ(Math.PI / 2);
  const a = col(0x513a27), b = col(0xcfae7c);
  return paint(g, (c, x) => c.copy(Math.abs(x) > 0.499 ? b : a));
})();
const rockGeo = (() => {
  let g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 0.78 + 0.44 * ((hash2(Math.round(x * 50), Math.round(y * 50) * 7 + Math.round(z * 50), 5) & 255) / 255);
    pos.setXYZ(i, x * k, Math.max(y * k * 0.75, -0.25), z * k);
  }
  g.computeVertexNormals();
  const a = col(0x5c6166), b = col(0x9aa0a3);
  return paint(g, (c, x, y) => c.copy(a).lerp(b, smoothstep(-0.3, 0.8, y)));
})();
// ---- grass: textured tufts tinted to the ground colour, plus flower patches
// How much darker a grass blade is at its root than at its tip: 1 = the original fade (roots at about half the
// tips' brightness), lower values lift the roots toward the tips, 0 = evenly lit. The tips never change.
// Change it live with __game.look.grassRootShade(k).
let GRASS_ROOT_SHADE = LOOK.rootShade;   // 1 is the original look
function makeGrassTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 32;
  const g = c.getContext('2d');
  const t = new THREE.CanvasTexture(c);
  // repaint(shade) redraws the same blades (same random sequence) with a root-to-tip fade of strength shade.
  // (Not called k: the blade loop below has its own k, which once shadowed it and blackened the roots.)
  t.userData.repaint = (shade) => {
  const img = g.createImageData(64, 32); const d = img.data;
  const r = mulberry32(606);
  const put = (x, y, l) => {
    x = Math.round(x); if (x < 0 || y < 0 || x >= 64 || y >= 32) return;
    const i = (y * 64 + x) * 4, v = clamp(Math.round(l * 255), 0, 255);
    d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
  };
  for (let k = 0; k < 13; k++) {                       // blades (left tile)
    const bx = 3 + k * 2.1 + (r() - 0.5) * 2, hgt = 13 + r() * 18, lean = (r() - 0.5) * 9, tone = 0.86 + 0.14 * r();
    for (let y = 0; y < hgt; y++) {
      const t = y / hgt, x = bx + lean * t * t, hw = 1.5 * (1 - t) + 0.3;
      for (let px = Math.ceil(x - hw); px <= x + hw; px++) if (px >= 1 && px <= 30) put(px, 31 - y, tone * (1.0 - 0.34 * shade * (1.0 - t)));
    }
  }
  for (let k = 0; k < 4; k++) {                        // flowers (right tile)
    const bx = 38 + k * 6 + r() * 2, hgt = 14 + r() * 13;
    for (let y = 0; y < hgt; y++) put(bx + Math.sin(y * 0.3) * 0.6, 31 - y, 0.5);
    const cy = 31 - Math.round(hgt), cx = Math.round(bx);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 2) put(cx + dx, cy + dy, dx === 0 && dy === 0 ? 0.75 : 1);
  }
  g.putImageData(img, 0, 0);
  t.needsUpdate = true;
  };
  t.userData.repaint(GRASS_ROOT_SHADE);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const grassTex = makeGrassTex();
const grassMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: grassTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
addWind(grassMat, 0.0, 0.6, 0.11, false, true, true);   // a light breeze: the sward stirs, it does not thrash; thins with distance
function tuftGeo(cards, w, h, u0, u1, lean) {
  const pos = [], nor = [], uv = [], colr = [], idx = [];
  for (let k = 0; k < cards; k++) {
    const a = (k / cards) * Math.PI + 0.3, dx = Math.cos(a), dz = Math.sin(a);
    const lx = -dz * lean * (k - (cards - 1) / 2), lz = dx * lean * (k - (cards - 1) / 2);
    const b = pos.length / 3;
    pos.push(-dx * w / 2, 0, -dz * w / 2, dx * w / 2, 0, dz * w / 2, dx * w * 0.58 + lx, h, dz * w * 0.58 + lz, -dx * w * 0.58 + lx, h, -dz * w * 0.58 + lz);
    uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
    colr.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);       // filled by shadeTuft
    for (let i = 0; i < 4; i++) nor.push(0, 1, 0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  return g;
}
// Vertex colours of a tuft: the tips are always (1.13, 1.16, 0.98); the foot is the original (0.88, 0.9, 0.84) at
// GRASS_ROOT_SHADE 1 and rises toward the tips' colour as it goes down.
function shadeTuft(geo, k) {
  const c = geo.attributes.color, tip = [1.13, 1.16, 0.98], foot = [0.88, 0.9, 0.84];
  for (let i = 0; i < c.count; i++) {
    const f = i % 4 < 2 ? k : 0;                           // each card: two foot vertices, then two tip vertices
    c.setXYZ(i, tip[0] - f * (tip[0] - foot[0]), tip[1] - f * (tip[1] - foot[1]), tip[2] - f * (tip[2] - foot[2]));
  }
  c.needsUpdate = true;
}
const grassGeo = tuftGeo(3, 0.8, 0.62, 0.01, 0.49, 0.14);
const flowerGeo = tuftGeo(2, 0.5, 0.7, 0.52, 0.99, 0.0);
shadeTuft(grassGeo, GRASS_ROOT_SHADE); shadeTuft(flowerGeo, GRASS_ROOT_SHADE);
function setGrassRootShade(k) {
  GRASS_ROOT_SHADE = clamp(+k || 0, 0, 1);
  grassTex.userData.repaint(GRASS_ROOT_SHADE);
  shadeTuft(grassGeo, GRASS_ROOT_SHADE); shadeTuft(flowerGeo, GRASS_ROOT_SHADE);
  return GRASS_ROOT_SHADE;
}
const FLOWER_COLORS = [col(0xffffff), col(0xffd84a), col(0xc7a2ff), col(0xff9ec4), col(0x9fd3ff)];

// terrain palette (linear)
const PAL = {
  mud: col(0x3c4a44), sand: col(0xd8c690), meadow: col(0x769a48), forest: col(0x4c7a3a),
  rock: col(0x7c7f80), rockDark: col(0x5d6062), snow: col(0xf2f5f7), dirt: col(0x6b4f35),
};

// ============================================================ chunks
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
const GRASS_PER_CHUNK = 4200;

class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz; this.key = ckey(cx, cz);
    this.ox = cx * CS; this.oz = cz * CS;
    this.base = new Float32Array(P * P);
    this.h = new Float32Array(P * P);
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
      this.base[j * P + i] = baseHeight(this.ox + i - 1, this.oz + j - 1);
    }
    this.forest = new Float32Array(N * N);
    for (let j = 0; j < N; j += 2) for (let i = 0; i < N; i += 2) this.forest[j * N + i] = forestAt(this.ox + i, this.oz + j);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if ((i & 1) || (j & 1)) {
        const i0 = i & ~1, j0 = j & ~1, i1 = Math.min(i0 + 2, N - 1), j1 = Math.min(j0 + 2, N - 1);
        const fx = (i - i0) / 2, fz = (j - j0) / 2;
        const f = this.forest;
        this.forest[j * N + i] = lerp(lerp(f[j0 * N + i0], f[j0 * N + i1], fx), lerp(f[j1 * N + i0], f[j1 * N + i1], fx), fz);
      }
    }
    this.group = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      pos[k * 3] = this.ox + i; pos[k * 3 + 2] = this.oz + j;
      uv[k * 2] = (this.ox + i) / 5; uv[k * 2 + 1] = (this.oz + j) / 5;
    }
    const idx = new Uint16Array(CS * CS * 6);
    let q = 0;
    for (let j = 0; j < CS; j++) for (let i = 0; i < CS; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N * N * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * N * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.terrain = new THREE.Mesh(geo, terrainMat);
    this.terrain.receiveShadow = true;
    // Draw order for opaque things, near to the ground: trees first, then grass, then the bare terrain last, so pixels
    // already covered by a canopy or a tuft are skipped instead of shaded and then painted over. (three would
    // otherwise draw in material order, which put the terrain first, under everything.) Nothing looks different.
    this.terrain.renderOrder = LOOK.drawOrder ? 2 : 0;
    this.group.add(this.terrain);
    this.populate();
    this.refresh();
    scene.add(this.group);
  }
  baseLocal(lx, lz) {
    const i = clamp(Math.floor(lx), -1, N - 1), j = clamp(Math.floor(lz), -1, N - 1);
    const fx = lx - i, fz = lz - j, b = this.base, k = (j + 1) * P + i + 1;
    return lerp(lerp(b[k], b[k + 1], fx), lerp(b[k + P], b[k + P + 1], fx), fz);
  }
  heightLocal(lx, lz) {
    const i = clamp(Math.floor(lx), -1, N - 1), j = clamp(Math.floor(lz), -1, N - 1);
    const fx = lx - i, fz = lz - j, b = this.h, k = (j + 1) * P + i + 1;
    return lerp(lerp(b[k], b[k + 1], fx), lerp(b[k + P], b[k + P + 1], fx), fz);
  }
  populate() {
    const rng = mulberry32(hash2(this.cx, this.cz, SEED));
    this.trees = []; this.rocks = [];
    const cell = 3.1;
    for (let gz = 0; gz + cell <= CS; gz += cell) for (let gx = 0; gx + cell <= CS; gx += cell) {
      const lx = gx + rng() * cell, lz = gz + rng() * cell;
      const r = rng(), r2 = rng(), r3 = rng();
      const x = this.ox + lx, z = this.oz + lz;
      const hb = this.baseLocal(lx, lz);
      const sl = Math.hypot(this.baseLocal(lx + 1, lz) - this.baseLocal(lx - 1, lz), this.baseLocal(lx, lz + 1) - this.baseLocal(lx, lz - 1));
      const f = forestAt(x, z);
      const spawnClear = x * x + z * z < 49;
      let d = 0.03 + 0.6 * smoothstep(0.0, 0.45, f);
      d *= 1 - smoothstep(17, 24, hb);
      if (hb < 1.3 || sl > 1.5 || spawnClear || inChannel(x, z, 1.0)) d = 0;
      if (r < d) {
        const type = (f > 0.25 || hb > 12) ? (r2 < 0.85 ? PINE : BIRCH) : (r2 < 0.5 ? BIRCH : r2 < 0.85 ? OAK : PINE);
        const id = this.key + '|t' + this.trees.length;
        this.trees.push({ id, x, z, type, scale: 0.8 + r3 * 0.6, rot: r3 * 100, hp: TREE[type].hp, alive: !world.removed.has(id), shake: 0, sx: 0, sz: 0, chunk: this, slot: 0 });
      } else if (!spawnClear) {
        const rd = 0.014 + 0.09 * smoothstep(9, 22, hb) + (hb < 1.3 && hb > -1.2 ? 0.03 : 0);
        if (r2 < rd) {
          const id = this.key + '|r' + this.rocks.length;
          this.rocks.push({ id, x, z, scale: 0.45 + r3 * 1.0, rot: r3 * 50, hp: 3, alive: !world.removed.has(id), chunk: this });
        }
      }
    }
    // instanced meshes: one per tree type, one for rocks, one for grass
    this.treeMeshes = [];
    for (let t = 0; t < 3; t++) {
      const list = this.trees.filter((tr) => tr.type === t);
      if (!list.length) { this.treeMeshes.push(null); continue; }
      const mesh = new THREE.InstancedMesh(treeGeo[t], treeMat, list.length);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.customDepthMaterial = treeDepthMat;
      mesh.renderOrder = LOOK.drawOrder ? -1 : 0;
      list.forEach((tr, i) => {
        tr.slot = i;
        const v = 0.74 + 0.42 * ((hash2(i, t, this.cx * 31 + this.cz) & 255) / 255);
        const q = hash2(i * 7 + 3, t + 11, this.cx * 17 + this.cz * 5), w1 = (q & 255) / 255, w2 = ((q >> 8) & 255) / 255;
        if (t === 1) mesh.setColorAt(i, _c.setRGB(v * (0.94 + 0.3 * w1), v * (0.95 + 0.1 * w2), v * (0.76 + 0.24 * (1 - w1))));
        else mesh.setColorAt(i, _c.setRGB(v * (0.8 + 0.42 * w1), v * (0.9 + 0.16 * w2), v * (0.7 + 0.42 * (1 - w1))));
      });
      this.treeMeshes.push(mesh); this.group.add(mesh);
    }
    if (this.rocks.length) {
      this.rockMesh = new THREE.InstancedMesh(rockGeo, solidMat, this.rocks.length);
      this.rockMesh.castShadow = true; this.rockMesh.receiveShadow = true;
      this.group.add(this.rockMesh);
    }
    // grass tufts, tinted to the ground they stand on
    const grng = mulberry32(hash2(this.cz, this.cx, SEED ^ 0x9e3779b9));
    const gs = [];
    for (let i = 0; i < GRASS_PER_CHUNK; i++) {
      const lx = grng() * CS, lz = grng() * CS, a = grng(), b = grng();
      const hb = this.baseLocal(lx, lz);
      if (hb < 1.25 || hb > 19 || inChannel(this.ox + lx, this.oz + lz, 0.15)) continue;
      const sl = Math.hypot(this.baseLocal(lx + 0.5, lz) - this.baseLocal(lx - 0.5, lz), this.baseLocal(lx, lz + 0.5) - this.baseLocal(lx, lz - 0.5));
      if (sl > 0.72) continue;
      const f = this.forest[Math.round(lz) * N + Math.round(lx)];
      if (f > 0.2 && a < 0.35) continue;
      gs.push({ lx, lz, rot: a * 6.283, s: (0.75 + b * 0.75) * lerp(1.0, 0.8, smoothstep(0, 0.4, f)), sy: 0.8 + a * 0.6, f, hb });
    }
    this.grass = gs;
    if (gs.length) {
      this.grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, gs.length);
      this.grassMesh.receiveShadow = LOOK.grassShadows;
      this.grassMesh.renderOrder = LOOK.drawOrder ? 1 : 0;
      gs.forEach((g, i) => {
        const v = 0.97 + 0.06 * ((i * 7919) % 100) / 100;
        _c.copy(PAL.meadow).lerp(PAL.forest, smoothstep(-0.1, 0.35, g.f));
        groundTint(_c, this.ox + g.lx, this.oz + g.lz, g.f, 1);
        _c.lerp(PAL.sand, (1 - smoothstep(0.7, 1.5, g.hb)) * 0.7).multiplyScalar(v);
        // darker tufts gather in loose drifts, with a few strays, so the sward has depth instead of one flat tone
        const drift = smoothstep(0.08, 0.3, fbm((this.ox + g.lx) * 0.55 + 31, (this.oz + g.lz) * 0.55 - 17, 2)), stray = (i * 2654435761 >>> 0) % 100;
        if (stray < 6 + 34 * drift) _c.multiplyScalar(0.66 + 0.14 * (stray % 7) / 6);
        this.grassMesh.setColorAt(i, _c);
      });
      this.group.add(this.grassMesh);
    }
    // flower patches in open meadow
    const fl = [];
    for (let k = 0; k < 6; k++) {
      const px = grng() * CS, pz = grng() * CS, ci = Math.floor(grng() * FLOWER_COLORS.length), n = 8 + Math.floor(grng() * 12);
      for (let i = 0; i < n; i++) {
        const an = grng() * 6.283, rr = Math.sqrt(grng()) * 3.2, sc = 0.7 + grng() * 0.6;
        const lx = px + Math.cos(an) * rr, lz = pz + Math.sin(an) * rr;
        if (lx < 0 || lz < 0 || lx >= CS || lz >= CS) continue;
        const hb = this.baseLocal(lx, lz);
        if (hb < 1.5 || hb > 15 || this.forest[Math.round(lz) * N + Math.round(lx)] > 0.12) continue;
        fl.push({ lx, lz, rot: an, s: sc, sy: 1, ci });
      }
    }
    this.flowers = fl;
    if (fl.length) {
      this.flowerMesh = new THREE.InstancedMesh(flowerGeo, grassMat, fl.length);
      this.flowerMesh.receiveShadow = LOOK.grassShadows;
      this.flowerMesh.renderOrder = LOOK.drawOrder ? 1 : 0;
      fl.forEach((g, i) => this.flowerMesh.setColorAt(i, FLOWER_COLORS[g.ci]));
      this.group.add(this.flowerMesh);
    }
    // creatures that live here, unless already defeated
    if (Math.hypot(this.ox + CS / 2, this.oz + CS / 2) > 50) {
      const n = (grng() < 0.5 ? 1 : 0) + (grng() < 0.18 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const lx = 4 + grng() * 24, lz = 4 + grng() * 24, kind = grng() < 0.4 ? 1 : 0;
        const hb = this.baseLocal(lx, lz), id = this.key + '|e' + k;
        if (hb > 1.6 && hb < 18 && !world.removed.has(id)) spawnEnemy(id, this.ox + lx, this.oz + lz, kind, this.key);
      }
    }
    this.stumpMesh = null;
    if (window.__nature) window.__nature.populate(this);
  }
  treeMatrix(tr, out) {
    if (!tr.alive) return out.copy(ZERO_M);
    _p.set(tr.x, this.heightLocal(tr.x - this.ox, tr.z - this.oz) - 0.08, tr.z);
    _q.setFromAxisAngle(UP, tr.rot);
    if (tr.shake > 0) {
      const a = Math.sin(tr.shake * 42) * 0.07 * (tr.shake / 0.35);
      _q2.setFromAxisAngle(_s.set(tr.sz, 0, -tr.sx), a); _q.premultiply(_q2);
    }
    const wq = tr.scale * (0.84 + ((tr.rot * 7.31) % 1) * 0.34);
    _s.set(wq, tr.scale * (0.9 + ((tr.rot * 3.17) % 1) * 0.24), wq);
    return out.compose(_p, _q, _s);
  }
  updateTree(tr) {
    const mesh = this.treeMeshes[tr.type];
    mesh.setMatrixAt(tr.slot, this.treeMatrix(tr, _m));
    mesh.instanceMatrix.needsUpdate = true;
  }
  rebuildStumps() {
    markShade(this);
    if (window.__nature) window.__nature.refresh(this);
    if (this.stumpMesh) { this.group.remove(this.stumpMesh); this.stumpMesh.dispose(); this.stumpMesh = null; }
    const dead = this.trees.filter((t) => !t.alive);
    if (!dead.length) return;
    const mesh = new THREE.InstancedMesh(stumpGeo, solidMat, dead.length);
    mesh.castShadow = true; mesh.receiveShadow = true;
    dead.forEach((tr, i) => {
      _p.set(tr.x, this.heightLocal(tr.x - this.ox, tr.z - this.oz) - 0.05, tr.z);
      _q.setFromAxisAngle(UP, tr.rot);
      const s = TREE[tr.type].r * tr.scale;
      _s.set(s, tr.scale, s);
      mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    });
    mesh.computeBoundingSphere();
    this.stumpMesh = mesh; this.group.add(mesh);
  }
  // Recompute heights from base + edits, then vertex data and instance placement.
  refresh() {
    const h = this.h, base = this.base;
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
      h[j * P + i] = base[j * P + i] + getDelta(this.ox + i - 1, this.oz + j - 1);
    }
    this.skyT = null;                      // the ground changed: its horizons are baked again
    const geo = this.terrain.geometry;
    const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, colr = geo.attributes.color.array;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, kk = (j + 1) * P + i + 1;
      const hh = h[kk];
      pos[k * 3 + 1] = hh;
      let nx = h[kk - 1] - h[kk + 1], nz = h[kk - P] - h[kk + P], ny = 2;
      const il = 1 / Math.hypot(nx, ny, nz); nx *= il; ny *= il; nz *= il;
      nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
      // colour by height, slope, forest density and edits
      const slope = 1 - ny, f = this.forest[k];
      const delta = hh - base[kk];
      if (hh < -0.2) _c.copy(PAL.sand).lerp(PAL.mud, clamp((-0.2 - hh) / 3.5, 0, 1));
      else {
        _c.copy(PAL.meadow).lerp(PAL.forest, smoothstep(-0.1, 0.35, f));
        groundTint(_c, this.ox + i, this.oz + j, f);
        _c.lerp(PAL.sand, 1 - smoothstep(0.7, 1.5, hh));
        if (hh < 0.5) _c.multiplyScalar(lerp(0.68, 1, smoothstep(0.05, 0.5, hh)));
        const rk = Math.max(smoothstep(0.15, 0.3, slope), smoothstep(19, 25, hh));
        _c.lerp(slope > 0.3 ? PAL.rockDark : PAL.rock, rk);
        _c.lerp(PAL.snow, smoothstep(29, 33, hh) * (1 - smoothstep(0.25, 0.45, slope)));
      }
      const dd = clamp(Math.abs(delta) * 1.6, 0, 1) * 0.85;
      if (dd > 0) _c.lerp(PAL.dirt, dd);
      // streams (riverTint): kept untinted too, for the finer bank mesh (refreshBanks)
      if (rivers) {
        const pre = this.colPre || (this.colPre = new Float32Array(N * N * 3)), band = this.bandV || (this.bandV = new Uint8Array(N * N));
        pre[k * 3] = _c.r; pre[k * 3 + 1] = _c.g; pre[k * 3 + 2] = _c.b;
        band[k] = riverTint(_c, rivers.riverInfo(this.ox + i, this.oz + j), slope) ? 1 : 0;
      }
      const v = 0.96 + 0.08 * ((hash2(this.ox + i, this.oz + j, SEED) & 255) / 255);
      colr[k * 3] = _c.r * v; colr[k * 3 + 1] = _c.g * v; colr[k * 3 + 2] = _c.b * v;
    }
    // bare, needle-strewn earth round the foot of each tree
    for (let o of this.trees) {
      if (!o.alive) continue;
      let l = Math.round(o.x - this.ox),
        c = Math.round(o.z - this.oz);
      for (let [h, u, d] of [
        [0, 0, 0.55],
        [1, 0, 0.3],
        [-1, 0, 0.3],
        [0, 1, 0.3],
        [0, -1, 0.3],
      ]) {
        let f = l + h,
          p = c + u;
        if (f < 0 || p < 0 || f >= N || p >= N) continue;
        let x = (p * N + f) * 3;
        ((colr[x] = lerp(colr[x], 0.36, d)), (colr[x + 1] = lerp(colr[x + 1], 0.27, d)), (colr[x + 2] = lerp(colr[x + 2], 0.17, d)));
      }
    }
    for (let o of this.rocks) {
      if (!o.alive) continue;
      let l = Math.round(o.x - this.ox),
        c = Math.round(o.z - this.oz);
      for (let [h, u, d] of [
        [0, 0, 0.4],
        [1, 0, 0.18],
        [-1, 0, 0.18],
        [0, 1, 0.18],
        [0, -1, 0.18],
      ]) {
        let f = l + h,
          p = c + u;
        if (f < 0 || p < 0 || f >= N || p >= N) continue;
        let x = (p * N + f) * 3;
        ((colr[x] = lerp(colr[x], 0.3, d)), (colr[x + 1] = lerp(colr[x + 1], 0.27, d)), (colr[x + 2] = lerp(colr[x + 2], 0.2, d)));
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeBoundingSphere();
    if (rivers) { refreshBanks(this); riverWater.refresh(this, rivers); refreshRiverRocks(this); riverFalls.refresh(this, rivers); riverLive.chunkChanged(this); }
    for (const tr of this.trees) this.treeMeshes[tr.type].setMatrixAt(tr.slot, this.treeMatrix(tr, _m));
    for (const mesh of this.treeMeshes) if (mesh) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); }
    if (this.rockMesh) {
      this.rocks.forEach((r, i) => {
        if (!r.alive) { this.rockMesh.setMatrixAt(i, ZERO_M); return; }
        _p.set(r.x, this.heightLocal(r.x - this.ox, r.z - this.oz) - 0.05, r.z);
        _q.setFromAxisAngle(UP, r.rot); _s.set(r.scale, r.scale * (0.7 + (r.rot % 1) * 0.5), r.scale);
        this.rockMesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      });
      this.rockMesh.instanceMatrix.needsUpdate = true; this.rockMesh.computeBoundingSphere();
    }
    for (const [mesh, list] of [[this.grassMesh, this.grass], [this.flowerMesh, this.flowers]]) {
      if (!mesh) continue;
      list.forEach((g, i) => {
        const hh = this.heightLocal(g.lx, g.lz);
        if (Math.abs(hh - this.baseLocal(g.lx, g.lz)) > 0.25 || hh < 0.4 || (window.__build && window.__build.covers(this.ox + g.lx, this.oz + g.lz))) { mesh.setMatrixAt(i, ZERO_M); return; }
        _p.set(this.ox + g.lx, hh - 0.04, this.oz + g.lz);
        _q.setFromAxisAngle(UP, g.rot); _s.set(g.s, g.s * g.sy, g.s);
        mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      });
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    }
    this.rebuildStumps();
  }
  dispose() {
    clearShade(this);
    riverWater.dispose(this); riverFalls.dispose(this);
    if (this.bankMesh) { this.bankMesh.geometry.dispose(); this.bankMesh = null; }
    if (this.riverRockMesh) { this.riverRockMesh.dispose(); this.riverRockMesh = null; }
    scene.remove(this.group);
    clearEnemies((e) => e.chunkKey === this.key);
    this.terrain.geometry.dispose();
    if (window.__nature) window.__nature.dispose(this);
    for (const mesh of this.treeMeshes) if (mesh) mesh.dispose();
    if (this.rockMesh) this.rockMesh.dispose();
    if (this.grassMesh) this.grassMesh.dispose();
    if (this.flowerMesh) this.flowerMesh.dispose();
    if (this.stumpMesh) this.stumpMesh.dispose();
  }
}

// ---------------------------------------------------------- sky visibility bake (see SKY_MAP above)
// Crown radius of each tree kind at scale 1, from its geometry, and how much sky a crown hides (birch is airy).
const CROWN = treeGeo.map((g, t) => { g.computeBoundingBox(); const b = g.boundingBox; return { r: 0.8 * Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z), k: [0.8, 0.5, 0.9][t] }; });
const shadeDirty = new Set();
// a chunk changed (loaded, a tree fell, the ground was dug): it and its neighbours bake again, since crowns overhang
function markShade(ch) { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) shadeDirty.add(ckey(ch.cx + dx, ch.cz + dz)); }
// Horizons, on a 4 m grid over the chunk: in 8 directions, how high the ground rises within 10 m. A spot whose
// horizon stands at angle a sees roughly (1 - sin a) of the sky that way; averaged, and kept gentle.
function bakeHorizon(ch) {
  const t = new Float32Array(81);
  for (let gj = 0; gj <= 8; gj++) for (let gi = 0; gi <= 8; gi++) {
    const x = ch.ox + gi * 4, z = ch.oz + gj * 4, h0 = heightAt(x, z) + 0.3;
    let occ = 0;
    for (let d = 0; d < 8; d++) {
      const dx = Math.cos(d * Math.PI / 4), dz = Math.sin(d * Math.PI / 4);
      let m = 0;
      for (const s of [2, 5, 10]) m = Math.max(m, (heightAt(x + dx * s, z + dz * s) - h0) / s);
      occ += m / Math.sqrt(1 + m * m);
    }
    t[gj * 9 + gi] = 1 - 0.8 * occ / 8;
  }
  return t;
}
function bakeShade(ch) {
  if (!ch.skyT) ch.skyT = bakeHorizon(ch);
  const dens = new Float32Array(CS * CS);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const nb = world.chunks.get(ckey(ch.cx + dx, ch.cz + dz));
    if (!nb || !nb.trees) continue;
    for (const tr of nb.trees) {
      if (!tr.alive) continue;
      const cr = CROWN[tr.type], r = cr.r * tr.scale, lx = tr.x - ch.ox, lz = tr.z - ch.oz, reach = r * 1.3;
      if (lx < -reach || lz < -reach || lx > CS + reach || lz > CS + reach) continue;
      for (let j = Math.max(0, Math.ceil(lz - reach)); j <= Math.min(CS - 1, Math.floor(lz + reach)); j++)
        for (let i = Math.max(0, Math.ceil(lx - reach)); i <= Math.min(CS - 1, Math.floor(lx + reach)); i++) {
          const d = Math.hypot(i - lx, j - lz);
          if (d < reach) dens[j * CS + i] += cr.k * (1 - smoothstep(0.35 * r, reach, d));
        }
    }
  }
  const t = ch.skyT, x0 = ((ch.ox % SKY_MAP_SIZE) + SKY_MAP_SIZE) % SKY_MAP_SIZE, z0 = ((ch.oz % SKY_MAP_SIZE) + SKY_MAP_SIZE) % SKY_MAP_SIZE;
  for (let j = 0; j < CS; j++) for (let i = 0; i < CS; i++) {
    const gi = Math.min(7, i >> 2), gj = Math.min(7, j >> 2), fx = (i - gi * 4) / 4, fz = (j - gj * 4) / 4;
    const hz = lerp(lerp(t[gj * 9 + gi], t[gj * 9 + gi + 1], fx), lerp(t[gj * 9 + gi + 9], t[gj * 9 + gi + 10], fx), fz);
    const v = clamp(hz * Math.exp(-1.2 * dens[j * CS + i]), 0.22, 1);
    skyMapData[(z0 + j) * SKY_MAP_SIZE + x0 + i] = Math.round(v * 255);
  }
}
function clearShade(ch) {
  const x0 = ((ch.ox % SKY_MAP_SIZE) + SKY_MAP_SIZE) % SKY_MAP_SIZE, z0 = ((ch.oz % SKY_MAP_SIZE) + SKY_MAP_SIZE) % SKY_MAP_SIZE;
  for (let j = 0; j < CS; j++) skyMapData.fill(255, (z0 + j) * SKY_MAP_SIZE + x0, (z0 + j) * SKY_MAP_SIZE + x0 + CS);
  skyMap.needsUpdate = true;
}
// once a frame: bake whatever changed, then upload the map (256 KB) once
function processShade() {
  if (!shadeDirty.size) return;
  for (const k of shadeDirty) { const ch = world.chunks.get(k); if (ch && ch.trees) bakeShade(ch); }
  shadeDirty.clear();
  skyMap.needsUpdate = true;
}

const chunkStream = createChunkStream({
  size: CS, radius: LOAD_R, chunks: world.chunks, key: ckey,
  load(cx, cz) {
    const chunk = new Chunk(cx, cz);
    depthState.dirty = true;
    return chunk;
  },
  unload: (chunk) => chunk.dispose(),
  now: () => performance.now(),
});
function forNearby(x, z, r, fn) {
  const c0x = Math.floor((x - r) / CS), c1x = Math.floor((x + r) / CS);
  const c0z = Math.floor((z - r) / CS), c1z = Math.floor((z + r) / CS);
  for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
    const c = world.chunks.get(ckey(cx, cz));
    if (c) fn(c);
  }
}

// ============================================================ particles
const MAXP = 500;
const partMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), MAXP);
partMesh.frustumCulled = false; partMesh.count = 0; partMesh.castShadow = false;
scene.add(partMesh);
const parts = [];
function burst(x, y, z, n, hex, spread, up, size, life) {
  const c = col(hex);
  for (let i = 0; i < n && parts.length < MAXP; i++) {
    const a = Math.random() * 6.283, s = Math.random() * spread;
    const v = 0.75 + Math.random() * 0.5;
    parts.push({
      x, y, z, vx: Math.cos(a) * s, vy: up * (0.4 + Math.random() * 0.8), vz: Math.sin(a) * s,
      life: life * (0.6 + Math.random() * 0.6), age: 0, size: size * (0.6 + Math.random() * 0.8),
      r: c.r * v, g: c.g * v, b: c.b * v, rot: Math.random() * 6,
    });
  }
}
function updateParticles(dt) {
  let n = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.age += dt;
    if (p.age > p.life) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
    p.vy -= 12 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    const gh = Math.max(heightAt(p.x, p.z), SEA) + p.size * 0.5;
    if (p.y < gh) { p.y = gh; p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; }
  }
  for (const p of parts) {
    const k = p.size * clamp((p.life - p.age) / 0.25, 0, 1);
    _q.setFromAxisAngle(UP, p.rot + p.age * 4); _p.set(p.x, p.y, p.z); _s.set(k, k, k);
    partMesh.setMatrixAt(n, _m.compose(_p, _q, _s));
    partMesh.setColorAt(n, _c.setRGB(p.r, p.g, p.b));
    n++;
  }
  partMesh.count = n;
  partMesh.instanceMatrix.needsUpdate = true;
  if (partMesh.instanceColor) partMesh.instanceColor.needsUpdate = true;
}

// ============================================================ player
const player = {
  x: 0, z: 0, y: 0, face: 0, faceTarget: 0, walk: 0, speed: 0,
  swing: null, roll: null, rollCd: 0, vy: 0, air: false, jumpHeld: false,
  hp: 100, stamWait: 0, regenWait: 0, kvx: 0, kvz: 0, hurt: 0, dead: 0,
  holdT: 0, tap: 0, charging: null, parry: null, riposte: 0, nextSide: 1, eHeld: false, qHeld: false, mvx: 0, mvz: 0,
  atk: null, comboI: 0, comboT: 9, comboLock: 0, comboShow: 0, comboLabel: '', dash: null, dashCd: 0, shotCd: 0, aiming: false, draw: 0, charge: 0, shiftT: 0, jumps: 0, tool: 'axe', levelTarget: 0, stam: 100,
};
const pm = {};
{
  const mk = (w, h, d, hex) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: hex }));
    m.castShadow = true; return m;
  };
  pm.root = new THREE.Group(); pm.body = new THREE.Group(); pm.root.add(pm.body);
  const torso = mk(0.46, 0.5, 0.26, 0x2f7d86); torso.position.y = 0.82;
  const belt = mk(0.48, 0.08, 0.28, 0x5a3b22); belt.position.y = 0.6;
  const head = mk(0.3, 0.3, 0.3, 0xe9b88f); head.position.y = 1.26;
  const hair = mk(0.33, 0.14, 0.33, 0x6b3f22); hair.position.set(0, 1.39, -0.01);
  const scarf = mk(0.36, 0.1, 0.32, 0xc9482e); scarf.position.y = 1.09;
  pm.legL = new THREE.Group(); pm.legR = new THREE.Group();
  pm.legL.position.set(-0.12, 0.56, 0); pm.legR.position.set(0.12, 0.56, 0);
  const l1 = mk(0.17, 0.56, 0.19, 0x3b3247); l1.position.y = -0.28; pm.legL.add(l1);
  const l2 = mk(0.17, 0.56, 0.19, 0x3b3247); l2.position.y = -0.28; pm.legR.add(l2);
  pm.armL = new THREE.Group(); pm.armR = new THREE.Group();
  pm.armL.position.set(-0.31, 1.03, 0); pm.armR.position.set(0.31, 1.03, 0);
  const a1 = mk(0.13, 0.5, 0.13, 0x2a6b73); a1.position.y = -0.25; pm.armL.add(a1);
  const a2 = mk(0.13, 0.5, 0.13, 0x2a6b73); a2.position.y = -0.25; pm.armR.add(a2);
  for (const arm of [pm.armL, pm.armR]) {
    if (!COMBAT) {
      // a homesteader carries one hatchet, in the right hand
      if (arm === pm.armR) {
        const haft = mk(0.04, 0.04, 0.46, 0x7a5230); haft.position.set(0, -0.5, 0.16);
        const head = mk(0.035, 0.17, 0.11, 0x9aa2a8); head.position.set(0, -0.545, 0.34);
        arm.add(haft, head); pm.hatchet = [haft, head];
        // a framing hammer, out while there is nailing to do (P.hammer, set by construction)
        const hh = mk(0.035, 0.035, 0.34, 0x8a5a32); hh.position.set(0, -0.5, 0.13);
        const hd = mk(0.045, 0.15, 0.05, 0x5f666c); hd.position.set(0, -0.53, 0.3);
        hh.visible = hd.visible = false; arm.add(hh, hd); pm.hammer = [hh, hd];
      }
      continue;
    }
    const grip = mk(0.05, 0.05, 0.14, 0x5a3b22); grip.position.set(0, -0.5, 0.02);
    const blade = mk(0.035, 0.09, 0.5, 0xcfd6dc); blade.position.set(0, -0.5, 0.32);
    arm.add(grip, blade);
  }
  pm.bow = new THREE.Group();
  const limbG = new THREE.TorusGeometry(0.5, 0.024, 5, 14, Math.PI); limbG.rotateZ(Math.PI); limbG.rotateY(Math.PI / 2);
  const limb = new THREE.Mesh(limbG, new THREE.MeshLambertMaterial({ color: 0x7a5230 })); limb.castShadow = true;
  const string = mk(0.012, 0.012, 1.0, 0xe8e4d4);
  pm.bow.add(limb, string); pm.bow.visible = false; pm.armL.add(pm.bow);
  pm.body.add(torso, belt, head, hair, scarf, pm.legL, pm.legR, pm.armL, pm.armR);
  scene.add(pm.root);
}

// ============================================================ dynamic objects: falling trees, logs, pickups
function fellTree(tr, dx, dz) {
  if (!tr.alive) return;
  const c = tr.chunk, T = TREE[tr.type];
  tr.alive = false; world.removed.add(tr.id);
  c.updateTree(tr); c.rebuildStumps();
  const mesh = new THREE.Mesh(treeGeo[tr.type], treeMat);
  mesh.castShadow = true; mesh.customDepthMaterial = treeDepthMat;
  const y = heightAt(tr.x, tr.z);
  mesh.position.set(tr.x, y, tr.z); mesh.scale.setScalar(tr.scale);
  scene.add(mesh);
  const len = T.h * tr.scale;
  const tipH = heightAt(tr.x + dx * len, tr.z + dz * len);
  const maxA = clamp(Math.PI / 2 - Math.atan2(tipH - y, len), 1.15, 1.95);
  world.fallers.push({ mesh, tr, dx, dz, a: 0.02, w: 0.25, maxA, len, y });
  burst(tr.x, y + 0.4, tr.z, 10, 0xc9a877, 2.2, 3.5, 0.11, 0.8);
}
function updateFallers(dt) {
  for (let i = world.fallers.length - 1; i >= 0; i--) {
    const f = world.fallers[i];
    f.w += (2.6 * Math.sin(f.a) + 0.15) * dt;
    f.a += f.w * dt;
    const landed = f.a >= f.maxA;
    if (landed) f.a = f.maxA;
    _q.setFromAxisAngle(_p.set(f.dz, 0, -f.dx), f.a);
    _q2.setFromAxisAngle(UP, f.tr.rot);
    f.mesh.quaternion.copy(_q).multiply(_q2);
    if (!landed) continue;
    const T = TREE[f.tr.type], tr = f.tr;
    scene.remove(f.mesh);
    world.fallers.splice(i, 1);
    cam.shake = Math.min(cam.shake + 0.25, 0.5);
    // knock down anything standing under the trunk
    for (let s = 0.35; s <= 1.0; s += 0.16) {
      const px = tr.x + f.dx * f.len * s, pz = tr.z + f.dz * f.len * s;
      forNearby(px, pz, 2, (c) => {
        for (const o of c.trees) {
          if (o.alive && Math.hypot(o.x - px, o.z - pz) < 1.0 + TREE[o.type].r * o.scale) fellTree(o, f.dx, f.dz);
        }
      });
      for (const e of enemies) if (e.state !== 'dead' && Math.hypot(e.x - px, e.z - pz) < 1.3) damageEnemy(e, 60, f.dx, f.dz, 4);
      const leaf = tr.type === PINE ? 0x2f6b3f : tr.type === BIRCH ? 0x9dbd45 : 0x457f37;
      if (s > 0.5) burst(px, heightAt(px, pz) + 0.6, pz, 16, leaf, 3.0, 3.6, 0.14, 1.2);
    }
    // the trunk stays where it fell, as one whole log
    const Pc = LOGS[tr.type];
    spawnLog(tr.x + f.dx * Pc.full.cy * tr.scale, tr.z + f.dz * Pc.full.cy * tr.scale, Math.atan2(-f.dz, f.dx), tr.type, 'full', Pc.full, tr.scale);
  }
}
function spawnLog(x, z, yaw, type, stage, piece, scale) {
  const mesh = new THREE.Mesh(piece.geo, treeMat);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.customDepthMaterial = treeDepthMat;
  mesh.scale.setScalar(scale);
  scene.add(mesh);
  const r = Math.max(piece.r * scale, 0.1);
  const L = { mesh, x, z, yaw, type, stage, scale, len: piece.len * scale, r, v: 0, roll: 0, hp: 2, y: heightAt(x, z) + r, volM3: piece.vol * scale ** 3 };
  world.logs.push(L);
  return L;
}
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const XAXIS = new THREE.Vector3(1, 0, 0), ZAXIS = new THREE.Vector3(0, 0, 1);
function updateLogs(dt) {
  for (const L of world.logs) {
    const ax = Math.cos(L.yaw), az = -Math.sin(L.yaw);       // log axis
    const px = Math.sin(L.yaw), pz = Math.cos(L.yaw);        // roll direction
    const gx = (heightAt(L.x + 0.6, L.z) - heightAt(L.x - 0.6, L.z)) / 1.2;
    const gz = (heightAt(L.x, L.z + 0.6) - heightAt(L.x, L.z - 0.6)) / 1.2;
    const ground = heightAt(L.x, L.z);
    const floating = ground + L.r < SEA - 0.02;
    const gp = gx * px + gz * pz;
    if (floating) L.v *= Math.exp(-1.5 * dt);
    else {
      L.v += -9.8 * gp / Math.sqrt(1 + gx * gx + gz * gz) * 0.55 * dt;
      L.v *= Math.exp(-0.9 * dt);
      if (Math.abs(gp) < 0.14 && Math.abs(L.v) < 0.35) L.v = 0;
    }
    L.x += px * L.v * dt; L.z += pz * L.v * dt;
    L.roll += (L.v / L.r) * dt;
    const ty = floating ? waveHeight(L.x, L.z) - L.r * 0.3 : ground + L.r;
    L.y = lerp(L.y, ty, 1 - Math.exp(-14 * dt));
    L.mesh.position.set(L.x, L.y, L.z);
    _qa.setFromAxisAngle(UP, L.yaw);
    _qb.setFromAxisAngle(ZAXIS, floating ? 0 : Math.atan(gx * ax + gz * az));
    _qc.setFromAxisAngle(XAXIS, L.roll);
    L.mesh.quaternion.copy(_qa).multiply(_qb).multiply(_qc);
  }
}
const LOG_ITEM = ['log_pine', 'log_birch', 'log_oak'];     // by tree type: PINE, BIRCH, OAK
const woodGeo = new THREE.BoxGeometry(0.42, 0.13, 0.13), stoneGeo = new THREE.IcosahedronGeometry(0.15, 0);
const woodMat = new THREE.MeshLambertMaterial({ color: 0xb98a55 }), stoneMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a3, flatShading: true });
function spawnPickup(kind, x, y, z) {
  const mesh = new THREE.Mesh(kind === 'wood' ? woodGeo : stoneGeo, kind === 'wood' ? woodMat : stoneMat);
  mesh.castShadow = true; mesh.rotation.y = Math.random() * 6;
  scene.add(mesh);
  const a = Math.random() * 6.283, s = 1 + Math.random() * 1.6;
  world.pickups.push({ mesh, kind, x, y, z, vx: Math.cos(a) * s, vy: 3.5 + Math.random() * 2, vz: Math.sin(a) * s, age: 0 });
}
function updatePickups(dt) {
  for (let i = world.pickups.length - 1; i >= 0; i--) {
    const p = world.pickups[i];
    p.age += dt;
    const dx = player.x - p.x, dz = player.z - p.z, dy = player.y + 0.8 - p.y;
    const d = Math.hypot(dx, dz);
    if (p.age > 0.5 && d < 4.2) {
      const pull = 22 / Math.max(d, 0.4);
      p.vx += (dx / d) * pull * dt; p.vz += (dz / d) * pull * dt; p.vy += dy * 14 * dt;
      p.vx *= Math.exp(-4 * dt); p.vz *= Math.exp(-4 * dt); p.vy *= Math.exp(-4 * dt);
      if (d < 0.6) {
        world[p.kind]++; hudDirty = true;
        scene.remove(p.mesh); world.pickups.splice(i, 1); continue;
      }
    } else p.vy -= 14 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    const gh = Math.max(heightAt(p.x, p.z), SEA - 0.05) + 0.1;
    if (p.y < gh) { p.y = gh; p.vy = Math.abs(p.vy) * 0.25; p.vx *= 0.6; p.vz *= 0.6; }
    p.mesh.position.set(p.x, p.y, p.z);
    p.mesh.rotation.y += dt * 2;
  }
}

// ============================================================ interaction: swings and terrain tools
function arcHit(ox, oz, fx, fz, reach, cosA, x, z, r) {
  const dx = x - ox, dz = z - oz, d = Math.hypot(dx, dz);
  if (d > reach + r) return false;
  return d < 0.9 + r || (dx * fx + dz * fz) / d > cosA;
}
// Damage everything in the world that a swing arc touches. Used by the player and by enemies.
function arcWorldDamage(ox, oz, oy, inArc, seen) {
  const fresh = (o) => { if (!seen) return true; if (seen.has(o)) return false; seen.add(o); return true; };
  let hit = false;
  forNearby(ox, oz, 4, (c) => {
    for (const tr of c.trees) {
      if (!tr.alive || !inArc(tr.x, tr.z, TREE[tr.type].r * tr.scale) || !fresh(tr)) continue;
      hit = true; tr.hp--;
      const d = Math.hypot(tr.x - ox, tr.z - oz) || 1;
      tr.sx = (tr.x - ox) / d; tr.sz = (tr.z - oz) / d;
      burst(tr.x - tr.sx * 0.3, oy + 1.0, tr.z - tr.sz * 0.3, 7, 0xd8b98a, 2.4, 3, 0.09, 0.7);
      if (tr.hp <= 0) fellTree(tr, tr.sx, tr.sz);
      else { if (tr.shake <= 0) world.shakes.push(tr); tr.shake = 0.35; }
    }
    c.rocks.forEach((r, i) => {
      if (!r.alive || !inArc(r.x, r.z, r.scale * 0.8) || !fresh(r)) return;
      hit = true; r.hp--;
      const ry = heightAt(r.x, r.z) + r.scale * 0.4;
      burst(r.x, ry, r.z, 8, 0x9aa0a3, 2.8, 3.5, 0.1, 0.7);
      if (r.hp <= 0) {
        r.alive = false; world.removed.add(r.id);
        c.rockMesh.setMatrixAt(i, ZERO_M); c.rockMesh.instanceMatrix.needsUpdate = true;
        burst(r.x, ry, r.z, 16, 0x7c7f80, 3.5, 4.5, 0.16, 1.0);
        const n = 1 + Math.round(r.scale * 2);
        for (let k = 0; k < n; k++) spawnPickup('stone', r.x, ry, r.z);
      }
    });
  });
  for (let i = world.logs.length - 1; i >= 0; i--) {
    const L = world.logs[i];
    const ax = Math.cos(L.yaw), az = -Math.sin(L.yaw);
    const t = clamp((ox - L.x) * ax + (oz - L.z) * az, -L.len / 2, L.len / 2);
    const qx = L.x + ax * t, qz = L.z + az * t;
    if (!inArc(qx, qz, L.r) || !fresh(L)) continue;
    hit = true; L.hp--;
    burst(qx, L.y, qz, 7, 0xd8b98a, 2.4, 3, 0.09, 0.7);
    if (L.hp > 0) { L.v += (((L.x - ox) * Math.sin(L.yaw) + (L.z - oz) * Math.cos(L.yaw)) > 0 ? 1 : -1) * 0.8; continue; }
    scene.remove(L.mesh); world.logs.splice(i, 1);
    if (L.stage === 'full') {            // the whole trunk splits into its lower and upper half
      const Pc = LOGS[L.type];
      for (const [piece, sg] of [[Pc.lo, -1], [Pc.hi, 1]]) {
        const off = (piece.cy - Pc.full.cy) * L.scale;
        const n = spawnLog(L.x + ax * off, L.z + az * off, L.yaw, L.type, 'half', piece, L.scale);
        n.v = sg * 0.5; n.roll = L.roll; n.y = L.y; if (seen) seen.add(n);
      }
      burst(L.x, L.y + 0.2, L.z, 12, 0xd8b98a, 2.8, 3.5, 0.11, 0.9);
    } else {
      // the half-log is cut up: its real volume goes into the stock as green log, besides the cut wood you see
      runStockCommand(sim, 'stock.add', { id: LOG_ITEM[L.type], qty: Math.round(L.volM3 * 1000) / 1000 });
      const n = 1 + Math.round(L.len * 1.2);
      for (let k = 0; k < n; k++) spawnPickup('wood', L.x + ax * (Math.random() - 0.5) * L.len, L.y + 0.2, L.z + az * (Math.random() - 0.5) * L.len);
    }
  }
  return hit;
}
function applyBrush(x, z, mode, dt, target) {
  const R = 2.6;
  const x0 = Math.floor(x - R), x1 = Math.ceil(x + R), z0 = Math.floor(z - R), z1 = Math.ceil(z + R);
  for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
    const d = Math.hypot(gx - x, gz - z);
    if (d >= R) continue;
    const w = (1 - (d / R) * (d / R)) ** 2;
    const cur = getDelta(gx, gz);
    let nd = cur;
    if (mode === 'dig') nd = cur - 3.4 * w * dt;
    else if (mode === 'raise') nd = cur + 3.4 * w * dt;
    else nd = cur + (target - (baseHeight(gx, gz) + cur)) * Math.min(1, 6 * w * dt);
    setDelta(gx, gz, clamp(nd, -10, 10));
  }
  for (let cz = Math.floor((z0 - 2) / CS); cz <= Math.floor((z1 + 2) / CS); cz++) {
    for (let cx = Math.floor((x0 - 2) / CS); cx <= Math.floor((x1 + 2) / CS); cx++) {
      const c = world.chunks.get(ckey(cx, cz));
      if (c) c.refresh();
    }
  }
  depthState.dirty = true;
}

// ============================================================ input
const keys = {};
const mouse = { x: 0, y: 0, left: false, right: false, inside: false, click: 0, swallow: false };
const cam = { yaw: 0.6, pitch: 0.95, dist: 24, aimPitch: 0.2, aimK: 0, yawRate: 0, prevYaw: 0.6, tx: 0, ty: 0, tz: 0, shake: 0 };
// what body the input drives and what the camera follows (src/engine/control.js); until the takeovers below move onto it,
// nothing new may take the body while one of them holds it
const control = createControl({ player, cam, keys, mouse });
control.guards.push(() => player.tool === 'build' ? 'build mode' : window.__game?.cooking?.active ? 'cooking'
  : player.climbY != null ? 'climbing' : player.standY != null ? 'standing on something' : window.__reach?.on || window.__hands?.isOpen ? 'hands busy'
  : sim.state.sys.construction?.carried ? 'arms full' : null);
const cursor = { x: 0, y: 0, z: 0, valid: false };
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (!(window.__build && window.__build.key(e))) {          // build mode gets first refusal on every key
    if (e.code === 'Digit1') setTool('axe');
    if (e.code === 'Digit2') setTool('dig');
    if (e.code === 'Digit3') setTool('raise');
    if (e.code === 'Digit4') setTool('level');
  }
  if (player.tool !== 'build') {                             // build mode uses these keys itself; its speed buttons still work
    if (e.code === 'Semicolon') stepSpeed(-1);
    if (e.code === 'Quote') stepSpeed(1);
    if (e.code === 'Backquote') setSpeed(simCtl.speed ? 0 : 1);
  }
  if (e.code === 'KeyG') cycleQuality();
  if (e.code === 'KeyH') { const h = document.getElementById('help'); h.hidden = !h.hidden; }
  if (e.altKey || ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft', 'AltRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault(); });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.left = mouse.right = false; });
const locked = () => document.pointerLockElement === canvas;
// A browser refuses to capture the mouse for a second or so after Esc, and that refusal used to switch the game to
// edge-steering for good. Now a refusal just means "click again"; edge-steering is only the fallback where capture
// has never worked on this page and has been refused three times running.
let lockEver = false, lockMisses = 0, lockLastMiss = 0;
function lockRefused() {
  const now = performance.now();
  if (now - lockLastMiss < 50) return;                  // one refusal reports twice (promise and event)
  lockLastMiss = now; lockMisses++;
  if (!lockEver && lockMisses >= 3) juice.lockFailed = true;
  lockUi();
}
function lockUi() {
  const b = el('lock');
  b.hidden = locked() || player.tool === 'build';
  b.textContent = juice.lockFailed
    ? 'Mouse capture is not available here. Push the mouse toward the left or right edge to turn.'
    : lockMisses ? 'Click the view again to take control.' : 'Click the view to take control. Esc frees the mouse.';
}
function syncButtons(e) {
  const left = !!(e.buttons & 1);
  if (!left) mouse.swallow = false;
  if (left && !mouse.left && !mouse.swallow) { mouse.click = 0.25; player.levelTarget = player.y; }
  mouse.left = left && !mouse.swallow;
  mouse.right = !!(e.buttons & 2);
}
canvas.addEventListener('pointerdown', (e) => {
  canvas.focus();
  if (!locked() && !juice.lockFailed && player.tool !== 'build') {            // the first click only takes control of the camera
    if (e.button === 0) mouse.swallow = true;
    try {
      const pr = canvas.requestPointerLock();
      if (pr && pr.catch) pr.catch(lockRefused);
    } catch (err) { lockRefused(); }
  }
  syncButtons(e);
});
canvas.addEventListener('pointerup', syncButtons);
canvas.addEventListener('pointercancel', () => { mouse.left = mouse.right = false; });
canvas.addEventListener('pointerleave', () => { mouse.inside = false; });
document.addEventListener('pointerlockchange', () => { if (locked()) { lockEver = true; lockMisses = 0; lockLastMiss = 0; juice.lockFailed = false; } lockUi(); if (!locked()) { mouse.left = mouse.right = false; } });
document.addEventListener('pointerlockerror', lockRefused);
canvas.addEventListener('pointermove', (e) => {
  syncButtons(e);
  const r = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
  mouse.inside = true;
  if (locked()) {                                    // the mouse steers the camera, and the camera is the aim
    const sens = cam.aimK > 0.5 ? 0.0019 : 0.0026;
    cam.yaw -= e.movementX * sens;
    if (cam.aimK > 0.5) cam.aimPitch = clamp(cam.aimPitch + e.movementY * 0.0016, -0.28, 0.9);
    else cam.pitch = clamp(cam.pitch + e.movementY * 0.002, 0.5, 1.35);
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.0012), 9, 50);
}, { passive: false });

const TOOLS = ['axe', 'dig', 'raise', 'level'];
function setTool(t) {
  player.tool = t;
  for (const b of document.querySelectorAll('#tools button')) b.setAttribute('aria-pressed', b.dataset.tool === t ? 'true' : 'false');
}
for (const b of document.querySelectorAll('#tools button')) b.addEventListener('click', () => { setTool(b.dataset.tool); canvas.focus(); });

// brush ring shown for the terrain tools
const ring = new THREE.Mesh(
  new THREE.RingGeometry(2.45, 2.6, 40),
  new THREE.MeshBasicMaterial({ color: 0xfff2c4, transparent: true, opacity: 0.8, depthTest: false, fog: false })
);
ring.rotation.x = -Math.PI / 2; ring.renderOrder = 10; ring.visible = false;
scene.add(ring);

const _ray = new THREE.Raycaster(), _v2 = new THREE.Vector2();
// Where attacks and tools point. Exploring: the ground just ahead. Bow drawn: whatever sits under the reticle.
function updateAim() {
  juice.onEnemy = false;
  if (cam.aimK < 0.5) {
    cursor.x = player.x - Math.sin(cam.yaw) * 4.5; cursor.z = player.z - Math.cos(cam.yaw) * 4.5;
    cursor.y = heightAt(cursor.x, cursor.z); cursor.valid = true;
    return;
  }
  const o = camera.position, d = camera.getWorldDirection(_dir);
  let tHit = 95, t = 0, prev = 0;
  for (let i = 0; i < 140 && t < 95; i++) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    const h = Math.max(heightAt(x, z), SEA);
    if (y < h) {
      let a = prev, b = t;
      for (let k = 0; k < 6; k++) { const m = (a + b) / 2; if (o.y + d.y * m < Math.max(heightAt(o.x + d.x * m, o.z + d.z * m), SEA)) b = m; else a = m; }
      tHit = b; break;
    }
    prev = t; t += Math.max(0.6, (y - h) * 0.45);
  }
  for (const e of enemies) {
    if (e.state === 'dead') continue;
    const cx = e.x - o.x, cy = e.y + 0.7 - o.y, cz = e.z - o.z;
    const tc = cx * d.x + cy * d.y + cz * d.z;
    if (tc > 0 && tc < tHit + 0.5 && cx * cx + cy * cy + cz * cz - tc * tc < 0.17) { tHit = Math.min(tHit, tc); juice.onEnemy = true; }
  }
  cursor.x = o.x + d.x * tHit; cursor.y = o.y + d.y * tHit; cursor.z = o.z + d.z * tHit; cursor.valid = true;
}

// ============================================================ water, motes, sky
// ---- water: the sea plane and its depth map live in src/water/ (sea.js)
const sea = createSea({ U, scene, world, player, CS, P, SEA, clamp, mulberry32 });
const { waveHeight, depthState, updateDepthMap, uniforms: waterUniforms, mesh: water } = sea;
// ---- streams and rivers: their own water and shader (src/water/rivers-render.js), one mesh per chunk they cross
const riverWater = createRiverWater({ U, sea, CS, P, SEA });
// the sky itself (src/sky.js): gradient, sun and clouds from the weather, instead of the flat fog colour
const skyDome = createSkyDome({ scene, camera, renderer, water: waterUniforms, U, SEA });
// the land past the loaded world, out to the horizon haze (src/far-land.js)
const farLand = createFarLand({ scene, baseHeight, forestAt, chunks: world.chunks, CS, SEA, PAL, smoothstep });
skyDome.setHorizon(farLand.horizon);
// the real stars (src/night-sky.js), and the sky's frame and moon for the date and hour
const nightSky = createNightSky({ scene, camera, sky: skyDome });
const SKYF = { eq: new THREE.Matrix3(), eqInv: new THREE.Matrix3(), moon: new THREE.Vector4(0, -1, 0, 0), age: 0 };
const HAZE = { light: 1.7, normal: 1, heavy: 0.5 };
function applySkyLook() {
  skyDome.setOptions({ model: LOOK.skyModel, clouds: LOOK.skyClouds, night: LOOK.nightSky });
  nightSky.setOn(LOOK.nightSky === 'real');
  farLand.setOn(LOOK.farLand); farLand.setOpenSea(LOOK.openSea); farLand.setHaze(LOOK.haze === 'heavy' ? 0.55 : LOOK.haze === 'light' ? 0.12 : 0.3);
  skyDome.setHorizon(LOOK.farLand ? farLand.horizon : null);
}
applySkyLook();
// the live tier (src/water/rivers-live.js): a shallow-water simulation on the GPU in a window round the player
const riverLive = createRiverLive({ renderer, river: riverWater, scene, CS, heightAt, chunkAt: (x, z) => world.chunks.get(ckey(Math.floor(x / CS), Math.floor(z / CS))) });
riverLive.setMode(LOOK.riverWater === 'baked' ? 'bed' : LOOK.riverWater);
const riverFalls = createFalls({ river: riverWater, CS });
// spray, mist, splashes and rings on the water (src/water/water-fx.js)
const waterFx = createWaterFx({ scene, river: riverWater });
// what the streams reflect near you: the real surroundings (src/water/reflect-probe.js)
const reflectProbe = createReflectProbe({ renderer, scene, hide: [riverWater.material, riverLive.material, riverFalls.material, waterFx.points, water], uniforms: riverWater.uniforms });
// and the mirror of the banks in the water at the level of the stream beside you (src/water/reflect-plane.js)
const reflectPlane = createReflectPlane({ renderer, scene, hide: [riverWater.material, riverLive.material, riverFalls.material, waterFx.points, water], uniforms: riverWater.uniforms });
// and a second, for the next step of the stream in view: a pool above or below yours (each pool takes the mirror at
// its own level; with one mirror, the steps not at your level fell back to the sky's colour and looked misty)
const reflectPlane2 = createReflectPlane({ renderer, scene, hide: [riverWater.material, riverLive.material, riverFalls.material, waterFx.points, water], uniforms: riverWater.uniforms, names: ['uRefl2', 'uReflMat2', 'uReflOn2'], second: true });
let probeAt = null, probeAway = 0;
// the fine waves round you when you are in or by a stream (src/water/ripple-sim.js)
const rippleSim = createRippleSim({ renderer, river: riverWater, live: riverLive });
reflectProbe.setDetail(LOOK.waterReflect === 'full'); reflectPlane.setDetail(LOOK.waterReflect === 'full'); reflectPlane2.setDetail(LOOK.waterReflect === 'full');
riverWater.uniforms.uTPM.value = LOOK.waterTexel === 'ground' ? 6.4 : 25.6;
riverWater.uniforms.uSnap.value = LOOK.waterTexel === 'smooth' ? 0 : 1;
U.bedVox.value = LOOK.bedStyle === 'real' ? 0 : LOOK.bedStyle === 'voxelFine' ? 2 : 1;
// The stream water at a point: the live simulation's where it runs, else the baked water of the day.
// { depth (m), vx, vz (m/s), foam } or null where there is no stream.
function streamWaterAt(x, z) {
  if (!rivers) return null;
  const live = riverLive.waterAt(x, z);
  if (live) return live;
  const ch = world.chunks.get(ckey(Math.floor(x / CS), Math.floor(z / CS))), D = ch && ch.riverData;
  if (!D) return null;
  const k = Math.round(z - D.oz) * (CS + 1) + Math.round(x - D.ox);
  if (!(k >= 0 && k < D.surf.length) || isNaN(D.surf[k])) return null;
  const u = riverWater.uniforms, sfc = D.bed[k] + (D.surf[k] - D.bed[k]) * u.uWetDepth.value, depth = sfc - heightAt(x, z);
  return depth > 0 ? { depth, vx: D.vel[k * 2] * u.uWetSpeed.value, vz: D.vel[k * 2 + 1] * u.uWetSpeed.value, foam: D.foam[k] } : null;
}
// Stream colours on the ground: wet gravel on riffles and silt in pools; a gravel bar up the inside of a bend and
// bare earth on the cut bank outside it; rock where a fall drops; and the ground at the water's edge dark with wet.
// ri: rivers.riverInfo at the point. True when the point is in a stream's band (channel and banks).
function riverTint(c, ri, slope) {
  if (!ri || ri.dist >= ri.w / 2 + 1.5 * ri.D + 2.5) return false;
  const half = ri.w / 2, bed = 1 - smoothstep(half - 0.4, half + 1.0, ri.dist);
  const bar = ri.bend < 0 ? -ri.bend * (1 - smoothstep(half + 0.2, half + 0.6 - ri.bend * 1.6, ri.dist)) : 0;
  c.lerp(ri.riffle || bar > bed ? RIVER_PAL.gravel : RIVER_PAL.silt, Math.max(bed * 0.85, bar * 0.8));
  const cut = ri.bend > 0 ? ri.bend * smoothstep(0.22, 0.42, slope) * (1 - smoothstep(half + 0.4, half + 1.5 * ri.D + 2.2, ri.dist)) : 0;
  c.lerp(RIVER_PAL.earth, cut * 0.9);
  const along = ri.seg ? ri.t * ri.seg.k % 1 : 0;
  const rock = ri.seg && ri.seg.fall ? smoothstep(0.82, 0.9, along) * (1 - smoothstep(0.97, 1, along)) * (1 - smoothstep(half + 0.6, half + 2.5, ri.dist)) : 0;
  c.lerp(slope > 0.3 ? PAL.rockDark : PAL.rock, Math.max(rock, smoothstep(0.35, 0.6, slope) * (1 - smoothstep(half, half + 2, ri.dist)) * 0.7 * (1 - cut)));
  c.multiplyScalar(1 - 0.28 * (1 - smoothstep(half - 0.1, half + 0.9, ri.dist)) * (1 - bed * 0.5));
  return true;
}
// Stream banks at twice the ground's resolution: in a chunk a stream crosses, the ground's 1 m squares in the
// stream's band are left out of the terrain mesh and drawn instead as 0.5 m squares, their extra points on the true
// carved shape (cut banks, bars, steps, plunge pools), coloured afresh at that resolution. Their corners, and the
// middles of edges shared with ordinary squares, stay on the coarse surface, so there are no cracks.
const BANK_R = 2, BANK_N = CS * BANK_R + 1;
function refreshBanks(ch) {
  const geo = ch.terrain.geometry;
  if (ch.bankMesh) { ch.group.remove(ch.bankMesh); ch.bankMesh.geometry.dispose(); ch.bankMesh = null; }
  const band = ch.bandV;
  if (!rivers || !band) { if (ch.fullIdx) { geo.setIndex(ch.fullIdx); ch.fullIdx = null; } return; }
  const inBand = (i, j) => band[j * N + i] || band[j * N + i + 1] || band[(j + 1) * N + i] || band[(j + 1) * N + i + 1];
  const quads = [];
  for (let j = 0; j < CS; j++) for (let i = 0; i < CS; i++) if (inBand(i, j)) quads.push(j * CS + i);
  if (!quads.length) { if (ch.fullIdx) { geo.setIndex(ch.fullIdx); ch.fullIdx = null; } return; }
  if (!ch.fullIdx) ch.fullIdx = geo.index;
  const isQ = new Uint8Array(CS * CS);
  for (const q of quads) isQ[q] = 1;
  // the terrain without the band's squares
  const full = ch.fullIdx.array, keep = [];
  for (let q = 0; q < CS * CS; q++) if (!isQ[q]) for (let t = 0; t < 6; t++) keep.push(full[q * 6 + t]);
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array(keep), 1));
  // fine points: base heights and stream info cached on the chunk (they only change if the world does)
  if (!ch.fineBase) { ch.fineBase = new Float32Array(BANK_N * BANK_N).fill(NaN); ch.fineInfo = new Array(BANK_N * BANK_N); }
  const h = ch.h, base = ch.base;
  const coarse = (lx, lz) => ch.heightLocal(lx, lz);
  const delta = (lx, lz) => { const i = Math.floor(lx), j = Math.floor(lz), fx = lx - i, fz = lz - j, k = (j + 1) * P + i + 1, d = (kk) => h[kk] - base[kk];
    return lerp(lerp(d(k), d(k + 1), fx), lerp(d(k + P), d(k + P + 1), fx), fz); };
  const vid = new Int32Array(BANK_N * BANK_N).fill(-1), pos = [], uv = [], col = [], idx = [];
  // is a fine point free to take the true shape? Not on the chunk's edge, and not on an edge it shares with an
  // ordinary square (those must follow the coarse surface)
  const freePoint = (fi, fj) => {
    if (fi % BANK_R === 0 && fj % BANK_R === 0) return false;
    const qi = Math.floor(fi / BANK_R), qj = Math.floor(fj / BANK_R);
    if (fi % BANK_R === 0) { if (fi === 0 || fi === BANK_N - 1) return false; return isQ[qj * CS + qi - 1] && isQ[qj * CS + Math.min(qi, CS - 1)]; }
    if (fj % BANK_R === 0) { if (fj === 0 || fj === BANK_N - 1) return false; return isQ[(qj - 1) * CS + qi] && isQ[Math.min(qj, CS - 1) * CS + qi]; }
    return true;
  };
  const point = (fi, fj) => {
    const k = fj * BANK_N + fi;
    if (vid[k] >= 0) return vid[k];
    const lx = fi / BANK_R, lz = fj / BANK_R, x = ch.ox + lx, z = ch.oz + lz;
    let y;
    if (freePoint(fi, fj)) {
      if (isNaN(ch.fineBase[k])) ch.fineBase[k] = baseHeight(x, z);
      y = ch.fineBase[k] + delta(lx, lz);
    } else y = coarse(lx, lz);
    vid[k] = pos.length / 3;
    pos.push(x, y, z); uv.push(x / 5, z / 5);
    return vid[k];
  };
  for (const q of quads) {
    const qi = q % CS, qj = (q / CS) | 0;
    for (let b = 0; b < BANK_R; b++) for (let a = 0; a < BANK_R; a++) {
      const fi = qi * BANK_R + a, fj = qj * BANK_R + b;
      const p00 = point(fi, fj), p10 = point(fi + 1, fj), p01 = point(fi, fj + 1), p11 = point(fi + 1, fj + 1);
      idx.push(p00, p01, p10, p10, p01, p11);
    }
  }
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g2.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g2.setIndex(idx);
  g2.computeVertexNormals();
  // colours: the ground's own colour (interpolated from the coarse points, before the stream's) with the stream's
  // colours worked out again at each fine point
  const nor = g2.attributes.normal.array, pre = ch.colPre;
  for (let v = 0; v < pos.length / 3; v++) {
    const lx = pos[v * 3] - ch.ox, lz = pos[v * 3 + 2] - ch.oz;
    const i = Math.min(CS - 1, Math.floor(lx)), j = Math.min(CS - 1, Math.floor(lz)), fx = lx - i, fz = lz - j;
    const c3 = (o) => lerp(lerp(pre[(j * N + i) * 3 + o], pre[(j * N + i + 1) * 3 + o], fx), lerp(pre[((j + 1) * N + i) * 3 + o], pre[((j + 1) * N + i + 1) * 3 + o], fx), fz);
    _c.setRGB(c3(0), c3(1), c3(2));
    const fk = Math.round(lz * BANK_R) * BANK_N + Math.round(lx * BANK_R);
    if (ch.fineInfo[fk] === undefined) ch.fineInfo[fk] = rivers.riverInfo(pos[v * 3], pos[v * 3 + 2]);
    riverTint(_c, ch.fineInfo[fk], 1 - nor[v * 3 + 1]);
    const vv = 0.96 + 0.08 * ((hash2(Math.round(pos[v * 3] * 2), Math.round(pos[v * 3 + 2] * 2), SEED) & 255) / 255);
    col.push(_c.r * vv, _c.g * vv, _c.b * vv);
  }
  g2.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g2.computeBoundingSphere();
  const m = new THREE.Mesh(g2, terrainMat);
  m.receiveShadow = true; m.renderOrder = ch.terrain.renderOrder;
  ch.bankMesh = m; ch.group.add(m);
}
// Rocks of the streams (rivers-gen.js rocksIn): set on the carved ground, wet and dark in the water, mossy above it.
// Kept on the chunk as { x, z, r, y, hy } (centre height, top above it) for the live water to flow round.
const _rc = new THREE.Color();
// stream-worn stones: rounded, a little flattened, lumpy at a large scale only
const riverRockGeo = (() => {
  const g = new THREE.IcosahedronGeometry(1, 3), pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + 0.12 * Math.sin(x * 2.1 + z * 1.3) * Math.cos(y * 1.7 - x) + 0.06 * Math.sin(z * 4.3 + y * 3.1);
    pos.setXYZ(i, x * k, Math.max(y * k * 0.8, -0.3), z * k);
  }
  g.computeVertexNormals();
  const a = col(0x575b5c), b = col(0x8e9393);
  return paint(g, (c, x, y) => c.copy(a).lerp(b, smoothstep(-0.3, 0.8, y)));
})();
function refreshRiverRocks(ch) {
  const list = rivers ? rivers.rocksIn(ch.ox, ch.oz, ch.ox + CS, ch.oz + CS) : [];
  let mesh = ch.riverRockMesh;
  if (mesh && mesh.instanceMatrix.count < list.length) { ch.group.remove(mesh); mesh.dispose(); mesh = ch.riverRockMesh = null; }
  if (!list.length) { if (mesh) mesh.count = 0; ch.riverRocks = null; return; }
  if (!mesh) {
    mesh = ch.riverRockMesh = new THREE.InstancedMesh(riverRockGeo, solidMat, list.length);
    mesh.castShadow = true; mesh.receiveShadow = true;
    ch.group.add(mesh);
  }
  mesh.count = list.length;
  ch.riverRocks = list.map((r, i) => {
    const g = ch.heightLocal(r.x - ch.ox, r.z - ch.oz), y = g - r.r * r.sink, hy = 0.8 * r.r * r.squash;
    const hsh = hash2(Math.round(r.x * 10), Math.round(r.z * 10), SEED);
    _p.set(r.x, y, r.z); _q.setFromAxisAngle(UP, (hsh & 1023) / 1023 * Math.PI * 2); _s.set(r.r, r.r * r.squash, r.r);
    mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    const ri = rivers.riverInfo(r.x, r.z), wet = ri && ri.dist < ri.w / 2 + 0.2 ? 1 : 0, v = 0.85 + 0.3 * (((hsh >> 10) & 255) / 255);
    mesh.setColorAt(i, wet ? _rc.setRGB(0.62 * v, 0.6 * v, 0.55 * v) : _rc.setRGB(0.78 * v, 0.86 * v, 0.62 * v));
    return { x: r.x, z: r.z, r: r.r, y, hy };
  });
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}
// the stream water nearest the player within about 12 m, as a point just above its surface, or null
function nearStream() {
  for (const r of [0, 3, 6, 9, 12]) for (let a = 0; a < (r ? 8 : 1); a++) {
    const x = player.x + Math.cos(a * 0.785) * r, z = player.z + Math.sin(a * 0.785) * r, w = streamWaterAt(x, z);
    if (w && w.depth > 0.03) { const lv = bakedLevelAt(x, z); return { x, y: (lv ?? heightAt(x, z) + w.depth) + 0.25, z, level: lv ?? heightAt(x, z) + w.depth }; }
  }
  return null;
}
// the settled surface level of the stream at a point (the baked water of the day: steady, unlike the simulation's
// moving surface), or null
function bakedLevelAt(x, z) {
  const ch = world.chunks.get(ckey(Math.floor(x / CS), Math.floor(z / CS))), D = ch && ch.riverData;
  if (!D) return null;
  const k = Math.round(z - D.oz) * (CS + 1) + Math.round(x - D.ox);
  if (!(k >= 0 && k < D.surf.length) || isNaN(D.surf[k])) return null;
  return D.bed[k] + (D.surf[k] - D.bed[k]) * riverWater.uniforms.uWetDepth.value;
}
// the mirror's level glides to the level of the water by you instead of jumping, and only moves on when that has
// really changed (a step down to the next pool), so the mirror does not flicker between pools as you walk
let mirrorLevel = null, mirrorWant = null, mirrorHold = 0, lastDt = 1 / 60;
function updateMirrorLevel(dt, target) {
  if (mirrorLevel === null) { mirrorLevel = mirrorWant = target; return mirrorLevel; }
  if (Math.abs(target - mirrorWant) > 0.08) { mirrorHold += dt; if (mirrorHold > 0.4) { mirrorWant = target; mirrorHold = 0; } } else mirrorHold = 0;
  mirrorLevel += (mirrorWant - mirrorLevel) * (1 - Math.exp(-dt * 5));
  return mirrorLevel;
}
// The second mirror's level: the step of the stream that fills most of the view ahead, other than the one the first
// mirror is on. Looked for a few times a second along a fan in front of the camera (nearer water counts for more);
// it moves to a new step only once that has been the pick for a moment, and then straight there (gliding through the
// levels between would match neither pool on the way).
const step2 = { level: null, x: 0, z: 0, want: null, wx: 0, wz: 0, hold: 0, t: 0 };
function scanSecondStep(levelA) {
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), found = [];
  for (let d = 2; d <= 30; d += 2) for (const l of [-1, -0.5, 0, 0.5, 1]) {
    const lat = l * (2 + d * 0.45), x = player.x + fx * d - fz * lat, z = player.z + fz * d + fx * lat;
    const lv = bakedLevelAt(x, z);
    if (lv === null || Math.abs(lv - levelA) < 0.22) continue;
    const w = 1 / (1 + d * 0.08);
    let c = found.find((o) => Math.abs(o.lv - lv) < 0.15);
    if (!c) found.push(c = { lv, w: 0, sx: 0, sz: 0, n: 0 });
    c.w += w; c.sx += x * w; c.sz += z * w; c.n++;
  }
  let best = null;
  for (const c of found) if (c.n >= 2 && (!best || c.w > best.w)) best = c;
  return best && { level: best.lv, x: best.sx / best.w, z: best.sz / best.w };
}
function updateSecondMirror(dt) {
  if (!probeAt || mirrorLevel === null) { step2.level = step2.want = null; return; }
  step2.t -= dt;
  if (step2.t <= 0) {
    step2.t = 0.15;
    const f = scanSecondStep(mirrorLevel);
    if (!f) { step2.hold += 0.15; if (step2.hold > 1.5) step2.level = step2.want = null; }
    else if (step2.level === null || Math.abs(f.level - step2.level) < 0.1) { step2.level = f.level; step2.x = f.x; step2.z = f.z; step2.hold = 0; }
    else if (step2.want !== null && Math.abs(f.level - step2.want) < 0.1) { step2.hold += 0.15; if (step2.hold > 0.45) { step2.level = f.level; step2.x = f.x; step2.z = f.z; step2.hold = 0; } }
    else { step2.want = f.level; step2.hold = 0; }
  }
}
// the streams follow the weather (src/sim/streams.js): depth and speed with the day's flow, mud with the storm flow;
// eased, so a change shows over a few seconds rather than in a jump
let irrigT = 0;
function updateStreams(dt) {
  lastDt = dt;
  if (!rivers) return;
  const sw = sim.state.sys.streams, u = riverWater.uniforms;
  if (sw) {
    const lk = streamLook(sw.wetness), k = 1 - Math.exp(-dt * 0.5);
    u.uWetDepth.value += (lk.depth - u.uWetDepth.value) * k;
    u.uWetSpeed.value += (lk.speed - u.uWetSpeed.value) * k;
    u.uTurbid.value += (sw.turbidity - u.uTurbid.value) * k;
    const wxs = sim.state.sys.weather;
    u.uCloud.value += ((wxs ? wxs.cloud || 0 : 0) - u.uCloud.value) * k;
    u.uRain.value += (Math.min(1, (wxs ? wxs.rainMmH || 0 : 0) / 5) - u.uRain.value) * (1 - Math.exp(-dt * 2));
  }
  riverFalls.update(dt, player.x, player.z, { fx: waterFx, live: riverLive.on ? riverLive : null, wet: u.uWetSpeed.value });
  const wx = sim.state.sys.weather, wms = wx ? wx.windMs || 0 : 0, wd = wx ? wx.windDirRad || 0 : 0;
  waterFx.update(dt, [Math.sin(wd) * wms, Math.cos(wd) * wms]);
  riverLive.update(dt, player.x, player.z, simCtl.speed > 0, WORLD_SECONDS_PER_REAL_SECOND * Math.min(simCtl.speed, 20));
  // the reflection probe, just above the stream water nearest you, while there is stream water near
  // (kept on for a few seconds after you step away, so it does not blink on and off at a stream's edge)
  const near = LOOK.waterReflect !== 'simple' ? nearStream() : null;
  if (near) { probeAt = near; probeAway = 0; } else probeAway += dt;
  if (probeAt && probeAway > 4) probeAt = null;
  reflectProbe.setOn(!!probeAt); reflectPlane.setOn(!!probeAt);
  updateSecondMirror(dt); reflectPlane2.setOn(!!probeAt && step2.level !== null);
  { const near2 = nearStream(); rippleSim.setOn(!!near2); const w0 = streamWaterAt(player.x, player.z); rippleSim.update(dt, player.x, player.z, w0 ? [w0.vx, w0.vz] : [0, 0]); }
  if (probeAt) { reflectProbe.update(dt, probeAt.x, probeAt.y, probeAt.z); u.uEnvPos.value.set(player.x, probeAt.y, player.z, 1); } else u.uEnvPos.value.w = 0;
  // irrigation: garden cells under stream water (a trench dug from a brook, a flooded bed) soak it up
  irrigT += dt;
  if (irrigT >= 2 && riverLive.on) {
    irrigT = 0;
    const g = sim.state.sys.garden, cm = g && g.field ? g.field.cellM : 0;
    if (cm) for (const b of Object.values(g.field.groups)) {
      const cells = [];
      let litres = 0;
      for (let i = 0; i < b.cells.length; i++) {
        const x = b.x0 + ((i % b.nx) + 0.5) * cm, z = b.z0 + (((i / b.nx) | 0) + 0.5) * cm, w = riverLive.waterAt(x, z);
        if (w && w.depth > 0.01) { cells.push(i); litres += Math.min(0.6, w.depth * cm * cm * 1000 * 0.25); }
      }
      if (cells.length) {
        try { sim.commandNow('garden.water', { bed: b.id, cells, litres, carriedL: litres }); } catch (e) { /* the garden refused: nothing soaks in */ }
        // what soaked in leaves the water (a pour taken out over the bed)
        riverLive.pour(3, b.x0 + b.nx * cm / 2, b.z0 + b.nz * cm / 2, Math.max(b.nx, b.nz) * cm / 2, -litres / 1000 / 2);
      }
    }
  }
}
const MOTES = 140;
const motes = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
  const mat = new THREE.PointsMaterial({ color: 0xfff6c8, size: 0.16, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, vertexColors: true });
  const p = new THREE.Points(g, mat); p.frustumCulled = false;
  p.userData.noReflect = true;   // the motes (green fireflies at night) glare in the water's reflections
  scene.add(p);
  const seeds = [];
  const r = mulberry32(7);
  for (let i = 0; i < MOTES; i++) seeds.push([r() * 70, 0.4 + r() * 3.2, r() * 70, r() * 6.283]);
  p.userData.seeds = seeds;
  return p;
})();
// By day, specks of pollen and dust drifting in the light. By night, fireflies: only in pockets (gathered toward
// the edges of woods and in patches of meadow, none over open ground or water), low over the grass, each blinking a
// short flash every few seconds rather than glowing, so the sky above stays dark for the stars.
function updateMotes() {
  const pos = motes.geometry.attributes.position.array, col = motes.geometry.attributes.color.array, seeds = motes.userData.seeds, t = U.time.value;
  const night = SKYK.night;
  for (let i = 0; i < MOTES; i++) {
    const s = seeds[i];
    const x = player.x + ((((s[0] + Math.sin(t * 0.3 + s[3]) * 2 - player.x) % 70) + 70) % 70) - 35;
    const z = player.z + ((((s[2] + Math.cos(t * 0.23 + s[3]) * 2 - player.z) % 70) + 70) % 70) - 35;
    const gy = heightAt(x, z);
    pos[i * 3] = x; pos[i * 3 + 2] = z;
    let k = 1, fly = s[1];
    if (night > 0.05) {
      // the pocket field: patches tens of metres across, more where meadow meets wood
      const f = forestAt(x, z), edge = 1 - Math.abs(f - 0.22) * 4;
      const pocket = smoothstep(0.3, 0.55, fbm(x * 0.03 + 41, z * 0.03 - 17, 2) + 0.25 * edge);
      const blink = Math.pow(Math.max(0, Math.sin(t * (0.9 + (s[3] % 1) * 0.8) + s[3] * 7)), 14);
      const fireK = (gy > SEA + 0.3 ? pocket : 0) * (0.08 + 0.92 * blink) * (i % 5 < 3 ? 1 : 0);
      k = lerp(1, fireK, night);
      fly = lerp(s[1], 0.3 + (s[1] - 0.4) * 0.4, night);       // low over the grass
    }
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    pos[i * 3 + 1] = Math.max(gy, SEA) + fly + Math.sin(t * 0.7 + s[3]) * 0.4;
  }
  motes.geometry.attributes.position.needsUpdate = true;
  motes.geometry.attributes.color.needsUpdate = true;
}
// The sun follows the calendar (sim/calendar.js): its height and path change with the date and the
// site's latitude. Weather from the simulation greys and dims the light.
import * as calendar from './sim/calendar.js';
const SKY = {
  day: { sun: col(0xffe8c2), si: 3.0, sky: col(0xb5d5ff), gnd: col(0x66733f), hi: 1.12, fog: col(0xa9c6d8), zen: col(0x4d86c8) },
  gold: { sun: col(0xffa25e), si: 3.3, sky: col(0xf3c0a6), gnd: col(0x6a5644), hi: 1.25, fog: col(0xe6a888), zen: col(0x6f74ad) },
  night: { sun: col(0x8fa8ff), si: 1.15, sky: col(0x4a62a8), gnd: col(0x1c2434), hi: 1.0, fog: col(0x1b2742), zen: col(0x0b1228) },
  // an overcast sky: the colours each light is pulled toward as cloud thickens (scaled by its own brightness)
  overcast: { sun: col(0xe4e6e6), sky: col(0xc3cad0), gnd: col(0x5f6656), fog: col(0xaab3ba), zen: col(0x8c98a3), snowGnd: col(0xdfe6ee) },
  minElevation: 0.3,      // radians: the light never comes in lower than this, so shadows stay readable
  site: { latitudeDeg: 45 },
};
const _fogC = new THREE.Color(), _ovC = new THREE.Color();
// pull a colour toward a target hue while keeping its own brightness
function towardOvercast(c, target, k) {
  if (k <= 0) return;
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, lt = 0.2126 * target.r + 0.7152 * target.g + 0.0722 * target.b;
  _ovC.copy(target).multiplyScalar(l / Math.max(lt, 1e-4));
  c.lerp(_ovC, k);
}
const SKYK = { day: 1, night: 0 };   // how much day and night there is now, for add-ons (path lights)
// The sky's colours from the atmosphere model (src/atmosphere.js), worked out on the CPU a few times a second: the
// haze at the horizon (an average round the compass; the fog of every material warms it toward the sun), the blue
// overhead, and the colour of the sunlight at the ground, at the height of the heaped clouds and of the cirrus
const ATM = { t: -1, sx: 9, sy: 9, sz: 9, hor: new THREE.Color(), zen: new THREE.Color(), lo: new THREE.Color(), hi: new THREE.Color(), ci: new THREE.Color(), sun: new THREE.Vector3() };
function updateAtmosphere(s) {
  const now = performance.now();
  if (now - ATM.t < 250 && (s.x - ATM.sx) ** 2 + (s.y - ATM.sy) ** 2 + (s.z - ATM.sz) ** 2 < 1e-5) return;
  if (now - ATM.t < 120) return;
  ATM.t = now; ATM.sx = s.x; ATM.sy = s.y; ATM.sz = s.z;
  const sv = [s.x, s.y, s.z], o = [0, 0, 0];
  let r = 0, g = 0, b = 0;
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; skyRadiance([Math.cos(a) * 0.9992, 0.04, Math.sin(a) * 0.9992], sv, o); r += o[0]; g += o[1]; b += o[2]; }
  ATM.hor.setRGB(r / 8, g / 8, b / 8);
  skyRadiance([0, 1, 0], sv, o); ATM.zen.setRGB(o[0], o[1], o[2]);
  sunColor(sv, 0.25, o); ATM.lo.setRGB(o[0], o[1], o[2]);
  sunColor(sv, 1.5, o); ATM.hi.setRGB(o[0], o[1], o[2]);
  sunColor(sv, 8, o); ATM.ci.setRGB(o[0], o[1], o[2]);
}
function updateSky() {
  if (window.__game && !window.__game.calendar) window.__game.calendar = calendar;
  const wx = sim.state.sys.weather, site = (wx && wx.site) || SKY.site;
  const sp = calendar.sunPosition(sim.calendarT(), site);
  const e = Math.sin(sp.elevationRad);
  const dayF = smoothstep(0.02, 0.4, e), nightF = 1 - smoothstep(-0.22, 0.06, e);
  const goldF = clamp(1 - dayF - nightF, 0, 1);
  SKYK.day = dayF; SKYK.night = nightF;
  // the real night: as dark as the moon allows (a moonless night is starlight only; a full moon lights the land)
  skyFrame(sim.calendarT(), site.latitudeDeg, SKYF);
  const moonK = SKYF.moon.w * smoothstep(0.02, 0.2, SKYF.moon.y);
  const nightDark = LOOK.nightSky === 'real' ? lerp(1, lerp(0.3, 1.05, moonK), nightF) : 1;
  const mix3 = (k) => SKY.day[k] * dayF + SKY.gold[k] * goldF + SKY.night[k] * nightF;
  const mixC = (out, k) => out.setRGB(
    SKY.day[k].r * dayF + SKY.gold[k].r * goldF + SKY.night[k].r * nightF,
    SKY.day[k].g * dayF + SKY.gold[k].g * goldF + SKY.night[k].g * nightF,
    SKY.day[k].b * dayF + SKY.gold[k].b * goldF + SKY.night[k].b * nightF);
  // weather: cloud cuts the direct beam far more than the sky light, and greys everything
  const cloud = wx ? wx.cloud : 0, ov = smoothstep(0.3, 1, cloud);
  const wet = wx ? clamp((wx.rainMmH + wx.snowMmH * 3) / 4, 0, 1) : 0;
  const snowK = wx ? smoothstep(0.01, 0.08, wx.snowDepthM) : 0;
  const O = SKY.overcast, grey = ov * (0.75 - 0.35 * nightF);
  mixC(sun.color, 'sun'); sun.intensity = mix3('si') * (1 - 0.8 * Math.pow(ov, 1.4));
  towardOvercast(sun.color, O.sun, grey);
  mixC(hemi.color, 'sky'); mixC(hemi.groundColor, 'gnd'); hemi.intensity = mix3('hi') * (1 + 0.4 * ov * (1 - nightF) - 0.1 * wet);   // the whole sky glows under cloud
  towardOvercast(hemi.color, O.sky, grey); towardOvercast(hemi.groundColor, O.gnd, grey);
  if (snowK > 0) towardOvercast(hemi.groundColor, O.snowGnd, 0.45 * snowK * (1 - nightF * 0.5));   // light bounced off snow
  // the true sun (the light below plays the moon), for the atmosphere
  { const ce = Math.cos(sp.elevationRad); ATM.sun.set(Math.sin(sp.azimuthRad) * ce, Math.sin(sp.elevationRad), -Math.cos(sp.azimuthRad) * ce); }
  updateAtmosphere(ATM.sun);
  const atmK = LOOK.skyModel === 'physical' ? 1 - nightF : 0;   // by night the palette's own dark sky stands
  mixC(_fogC, 'fog'); _fogC.lerp(ATM.hor, atmK * 0.9); towardOvercast(_fogC, O.fog, grey); _fogC.multiplyScalar((1 - 0.1 * ov - 0.08 * wet) * lerp(1, nightDark, 0.85));
  hemi.intensity *= lerp(1, nightDark, 0.9);
  scene.fog.color.copy(_fogC); scene.background.copy(_fogC);
  // falling rain and snow close the distance in (updateCamera sets the clear-air distances each frame)
  scene.fog.near *= 1 - 0.45 * wet; scene.fog.far *= 1 - 0.4 * wet;
  // the sun comes from its true azimuth (world +x east, +z south); below the horizon the same light
  // plays the moon, from the opposite side of the sky
  const up = e >= -0.05;
  let el = Math.max(up ? sp.elevationRad : -sp.elevationRad, SKY.minElevation);
  let hx = Math.sin(sp.azimuthRad) * (up ? 1 : -1), hz = -Math.cos(sp.azimuthRad) * (up ? 1 : -1);
  // with the real night sky, the night's light is the moon's: from where it stands, as bright as its phase; with
  // no moon up, the dimmer light of the stars and the glow of the sky
  if (!up && LOOK.nightSky === 'real') {
    const m = SKYF.moon;
    if (m.y > 0.06) { el = Math.max(Math.asin(m.y), SKY.minElevation); const hl = Math.hypot(m.x, m.z) || 1; hx = m.x / hl; hz = m.z / hl; }
    sun.intensity *= nightDark;
  }
  const tx = Math.round(player.x), tz = Math.round(player.z);
  sun.target.position.set(tx, player.y, tz);
  sun.position.set(tx + hx * Math.cos(el) * 120, player.y + Math.sin(el) * 120, tz + hz * Math.cos(el) * 120);
  waterUniforms.uSunDir.value.subVectors(sun.position, sun.target.position).normalize();
  waterUniforms.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity * 0.32);
  waterUniforms.uAmb.value.copy(hemi.color).multiplyScalar(hemi.intensity * 0.3);
  waterUniforms.uSky.value.copy(_fogC); mixC(waterUniforms.uZenith.value, 'zen'); waterUniforms.uZenith.value.lerp(ATM.zen, atmK * 0.9); towardOvercast(waterUniforms.uZenith.value, O.zen, grey);
  skyDome.update({
    trueSun: ATM.sun, sunLo: ATM.lo, sunHi: ATM.hi, sunCi: ATM.ci, cloud, grey, night: nightF, day: dayF,
    windX: wx ? Math.sin(wx.windDirRad || 0) * (wx.windMs || 0) : 1, windZ: wx ? Math.cos(wx.windDirRad || 0) * (wx.windMs || 0) : 0,
    fog: scene.fog, moon: SKYF.moon, eq: SKYF.eqInv,
  }, lastDt);
  nightSky.update(SKYF.eq, nightF, SKYF.moon, renderer.getPixelRatio());
  motes.material.opacity = (0.22 + 0.7 * nightF + 0.25 * goldF) * (1 - 0.8 * wet);
  motes.material.color.setHex(nightF > 0.5 ? 0xd9ff8a : 0xfff6c8);
  motes.material.size = 0.13 + 0.09 * nightF;
  if (bloom) bloom.strength = (0.28 + 0.3 * nightF + 0.12 * goldF) * (1 - 0.4 * ov);
}

// ============================================================ HUD
let hudDirty = true;
const el = (id) => document.getElementById(id);
function clock() {
  const t = clockText(sim.state.t);
  return t.slice(0, 4) + '0';          // shown to the ten minutes
}
function setSpeed(v) {
  simCtl.speed = SPEEDS.includes(v) ? v : 1;
  for (const b of document.querySelectorAll('#speed button')) b.setAttribute('aria-pressed', +b.dataset.speed === simCtl.speed ? 'true' : 'false');
}
function stepSpeed(d) { setSpeed(SPEEDS[clamp(SPEEDS.indexOf(simCtl.speed) + d, 0, SPEEDS.length - 1)]); }
for (const b of document.querySelectorAll('#speed button')) b.addEventListener('click', () => { setSpeed(+b.dataset.speed); canvas.focus(); });

// ---------------------------------------------------------- saving
// One save per world seed: the simulation state plus what the engine owns (terrain edits, felled
// trees, stock, where the player stood, and editable build data).
const NEW_WORLD_YEAR_DAYS = 20;          // five days a season. The player can change it in the weather panel.
const SAVE_KEY = 'homestead:save:', LAST_KEY = 'homestead:last-seed';
// Every new plot comes with an old dug well, a hand pump and a spigot a few steps from where you arrive,
// so there is water from the first minute without power or plumbing.
function placeStartingWell(build) {
  if (!build.addFixtures || !build.connect || build.pieces().length) return;
  let best = null;
  for (let i = 0; i < 24; i++) {                       // the flattest dry spot in a ring around the arrival point
    const a = (i / 24) * Math.PI * 2, r = 7 + (i % 3) * 2, x = player.x + Math.cos(a) * r, z = player.z + Math.sin(a) * r;
    const h = heightAt(x, z), slope = Math.abs(heightAt(x + 1.5, z) - h) + Math.abs(heightAt(x, z + 1.5) - h);
    if (h > SEA + 0.4 && (!best || slope < best.slope)) best = { x, z, slope };
  }
  if (!best) return;
  // The yard is content (starterYard): the engine only levels the spot and places what it lists. Everything sits on
  // the parts lattice, so the pipes the player fits by hand meet the pump, the barrel and the tap exactly.
  const ox = Math.round(best.x * 4) / 4, oz = Math.round(best.z * 4) / 4, oy0 = heightAt(ox, oz);
  const yard = starterYard(ox, oy0, oz);
  for (let n = 0; n < 3; n++) for (let dz = -4; dz <= 4; dz += 2) for (let dx = -4; dx <= 4; dx += 2) applyBrush(ox + dx, oz + dz, 'level', 1, oy0);
  const dy = heightAt(ox, oz) - oy0;                       // whatever the levelling left
  const ids = build.addFixtures(yard.fixtures.map((f) => ({ fixture: f.fixture, x: f.x, z: f.z, y: f.y + dy, settings: f.settings })));
  const id = Object.fromEntries(yard.fixtures.map((f, i) => [f.key, ids[i]]));
  sim.commandNow('parts.setOrigin', { ...yard.origin, y: oy0 + dy });
  for (const a of yard.anchors) sim.commandNow('parts.anchor', { id: a.id, kind: a.kind, len: a.len, at: a.at, rot: rotationTo(a.x, a.y), ref: a.ref ? { piece: id[a.ref[0]], port: a.ref[1] } : null });
  sim.commandNow('plumbing.setYard', { bench: { ...yard.bench, y: yard.bench.y + dy } });
  sim.commandNow('plumbing.addKit', { x: yard.bench.x, y: yard.bench.y + dy + yard.bench.h, z: yard.bench.z, yaw: 0.3 });
  if (!stockState().tools.includes('watering_can')) runStockCommand(sim, 'stock.add', { id: 'watering_can', qty: 1 });
}
function syncSite() {
  flushMacro();
  // hand build mode the real equipment catalog once it has loaded
  if (!simCtl.catalogSet && window.__build && window.__build.setFixtureCatalog) { window.__build.setFixtureCatalog(PLACEABLE_FIXTURES); simCtl.catalogSet = true; }
  const build = window.__build;
  if (!build) return;
  build.ensureLoaded();
  if (simCtl.newWorld) { simCtl.newWorld = false; placeStartingWell(build); flushMacro(); }
  if (build.version === simCtl.siteV) return;
  const version = build.version;
  sim.commandNow('site.setPieces', { pieces: mapPieces(build.pieces()) });
  sim.commandNow('structure.recheck');          // judge the building as it now stands, even while time is paused
  simCtl.siteV = version;
}
// live: hand the simulation state by reference (for saveGame, which only stringifies it: no 4 MB deep copy)
function saveData(live = false) {
  syncSite();
  return makeSave(live ? sim.state : sim.serialize(), {
    removed: [...world.removed], wood: world.wood, stone: world.stone,
    player: { x: player.x, z: player.z }, cam: { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist },
    builds: window.__build && window.__build.serialize ? window.__build.serialize() : simCtl.builds,
  });
}
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY + SEED, stringifySave(saveData(true)));
    localStorage.setItem(LAST_KEY, String(SEED));
    return true;
  } catch (e) { return false; }      // storage full or unavailable: the game carries on unsaved
}
// Reads this seed's save into the world. Call before chunks are built. Returns true if one was applied.
function applySave(raw) {
  let save;
  try { save = readSave(raw); } catch (e) { console.warn('Save not loaded: ' + e.message); return false; }
  if ((save.sim.seed >>> 0) !== SEED) return false;
  sim.load(save.sim);
  const w = save.world || {};
  // terrain edits are in the simulation (sys.ground); sim.load's 'loaded' event has mirrored them into world.edits
  for (const id of (w.removed || [])) world.removed.add(id);
  world.wood = w.wood || 0; world.stone = w.stone || 0;
  simCtl.builds = w.builds || null;
  if (w.player) { player.x = w.player.x; player.z = w.player.z; }
  if (w.cam) { cam.yaw = cam.prevYaw = w.cam.yaw; cam.pitch = w.cam.pitch; cam.dist = w.cam.dist; }
  return true;
}
window.addEventListener('pagehide', saveGame);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });
const SHADOW_TYPES = { pcf: THREE.PCFShadowMap, basic: THREE.BasicShadowMap };
// Puts the current preset and render scale into effect. Safe to call at any time.
function applyGfx() {
  const G = gfx();
  quality.level = G.composer ? 'high' : 'low';
  // Shadows. three (r187) rebuilds the map and recompiles materials by itself when the type changes, and
  // turning castShadow on or off recompiles too; only a new size needs the old map thrown away here.
  const on = G.shadows !== 'off';
  renderer.shadowMap.enabled = on; sun.castShadow = on;
  if (on) renderer.shadowMap.type = SHADOW_TYPES[G.shadows];
  sun.shadow.radius = G.shadowRadius;
  if (sun.shadow.mapSize.x !== G.shadowSize) {
    sun.shadow.mapSize.set(G.shadowSize, G.shadowSize);
    if (sun.shadow.map) { sun.shadow.map.depthTexture?.dispose(); sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  // alpha-to-coverage only does anything with MSAA; without it, plain alpha testing is cheaper and keeps edges hard
  const a2c = msaaSamples() > 0;
  for (const m of [grassMat, treeMat]) if (m.alphaToCoverage !== a2c) { m.alphaToCoverage = a2c; m.needsUpdate = true; }
  syncComposer();
  // with AO on, the water writes depth, so AO sees the water's surface rather than the lake bed under it
  resize();
  el('quality').textContent = G.label;
  if (window.__gfxPanel) window.__gfxPanel.refresh();
}
function saveGfx() {
  try { localStorage.setItem(GFX_KEY, JSON.stringify({ preset: quality.preset, scale: quality.scale, target: quality.target })); } catch (e) { /* no storage */ }
}
// setQuality('ultra' | 'high' | 'medium' | 'low'). The old 'high' / 'low' calls still work.
function setQuality(q, save) {
  if (!GFX[q]) return;
  quality.preset = q; applyGfx();
  if (save) saveGfx();
}
function setRenderScale(n, save) {
  if (!RENDER_SCALES.includes(n)) return;
  quality.scale = n; applyGfx();
  if (save) saveGfx();
}
const cycleQuality = () => setQuality(GFX_ORDER[(GFX_ORDER.indexOf(quality.preset) + 1) % GFX_ORDER.length], true);
const cycleRenderScale = () => setRenderScale(RENDER_SCALES[(RENDER_SCALES.indexOf(quality.scale) + 1) % RENDER_SCALES.length], true);
el('quality').title = 'Graphics quality: Ultra, High, Medium, Low (G)';
el('quality').addEventListener('click', () => { cycleQuality(); canvas.focus(); });
// ---------------------------------------------------------- Graphics panel
// Every graphics setting and switch in one place, opened from the Graphics button in the top bar.
function setLook(key, value) {
  LOOK[key] = value; saveLook();
  if (key === 'drawOrder') for (const c of world.chunks.values()) {
    if (c.terrain) c.terrain.renderOrder = value ? 2 : 0;
    for (const m of c.treeMeshes || []) if (m) m.renderOrder = value ? -1 : 0;
    for (const m of [c.grassMesh, c.flowerMesh]) if (m) m.renderOrder = value ? 1 : 0;
  }
  if (key === 'tuftShadow') grassMat.needsUpdate = true;
  if (key === 'ao') applyGfx();
  if (key === 'lightBloom') resize();
  if (key === 'compactHdr') syncComposer();
  if (key === 'hudBlur') applyHudBlur();
  if (key === 'grassShadows') for (const c of world.chunks.values()) for (const m of [c.grassMesh, c.flowerMesh]) if (m) m.receiveShadow = value;
  if (key === 'rootShade') setGrassRootShade(value);
  if (key === 'grassClumps' || key === 'grassBacklight') U.grassLook.value.set(LOOK.grassClumps ? 1 : 0, LOOK.grassBacklight ? 1 : 0, LOOK.grassSheen ? 1 : 0, LOOK.farBlend ? 1 : 0);
  if (key === 'skyShade') U.skyK.value = value ? 1 : 0;
  if (key === 'grassSheen' || key === 'farBlend') U.grassLook.value.set(LOOK.grassClumps ? 1 : 0, LOOK.grassBacklight ? 1 : 0, LOOK.grassSheen ? 1 : 0, LOOK.farBlend ? 1 : 0);
  if (key === 'sunFog') { FOG_SUN[0] = FOG_SUN[1] = value ? 1 : 0; }
  if (key === 'crownShade') for (const g of [...treeGeo, pineLiteGeo]) applyCrownShade(g, value);
  if (key === 'camFx') resize();
  if (key === 'edgeBelts' && window.__nature) for (const c of world.chunks.values()) { c.litterItems = null; window.__nature.refresh(c); }
  if (key === 'taa') { applyGfx(); resize(); }
  if (key === 'riverWater') riverLive.setMode(value === 'baked' ? 'bed' : value);
  if (key === 'waterReflect') { if (value === 'simple') { reflectProbe.setOn(false); reflectPlane.setOn(false); reflectPlane2.setOn(false); } reflectProbe.setDetail(value === 'full'); reflectPlane.setDetail(value === 'full'); reflectPlane2.setDetail(value === 'full'); }
  if (['skyModel', 'skyClouds', 'nightSky', 'farLand', 'openSea', 'haze'].includes(key)) applySkyLook();
  if (key === 'bedStyle') U.bedVox.value = value === 'real' ? 0 : value === 'voxelFine' ? 2 : 1;
  if (key === 'waterTexel') { riverWater.uniforms.uTPM.value = value === 'ground' ? 6.4 : 25.6; riverWater.uniforms.uSnap.value = value === 'smooth' ? 0 : 1; }      // MSAA off or back on, and the resolve path
  if (key === 'toneMap') {
    renderer.toneMapping = TONE_MAPS[value] || THREE.ACESFilmicToneMapping;   // the composer's output pass follows it by itself
    if (!viaComposer()) scene.traverse((o) => { for (const m of o.material ? [].concat(o.material) : []) m.needsUpdate = true; });
  }
}
// HUD blur (a switch): the panels' frosted glass. The browser redoes that blur behind every panel each frame, at full
// screen resolution, outside the game's own GPU timing; off, the panels stay see-through without blurring.
const hudBlurStyle = document.createElement('style');
hudBlurStyle.textContent = '.panel, #status, #vitals, #tools { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }';
function applyHudBlur() { if (LOOK.hudBlur) hudBlurStyle.remove(); else document.head.appendChild(hudBlurStyle); }
applyHudBlur();
const gfxPanel = (() => {
  const css = document.createElement('style');
  css.textContent = `
#gfxsettings { top: 72px; right: 16px; width: 360px; max-height: calc(100% - 96px); overflow: auto; z-index: 30; font-size: 13px; }
#gfxsettings[hidden] { display: none; }
#gfxsettings .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
#gfxsettings h2 { font-size: 16px; margin: 0; }
#gfxsettings .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 7px 0; }
#gfxsettings .seg { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
#gfxsettings .seg button { padding: 3px 8px; }
#gfxsettings button[aria-pressed="true"] { border-color: var(--accent); background: rgba(226, 182, 90, 0.18); color: var(--accent); }
#gfxsettings .sec { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--panel-edge); color: var(--ink-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
#gfxsettings label.chk { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; margin: 7px 0; }
#gfxsettings label.chk input { margin-top: 2px; }
#gfxsettings label.chk.off { opacity: 0.45; }
#gfxsettings .hint { display: block; color: var(--ink-dim); font-size: 11px; }
#gfxsettings input[type=range] { width: 130px; }
#gfxsettings pre { white-space: pre-wrap; font-size: 11px; line-height: 1.35; max-height: 240px; overflow: auto; background: rgba(0, 0, 0, 0.28); padding: 8px; border-radius: 6px; margin: 6px 0 0; }`;
  document.head.appendChild(css);
  const box = document.createElement('div');
  box.id = 'gfxsettings'; box.className = 'panel'; box.hidden = true;
  document.body.appendChild(box);
  const q = el('quality');
  const open = q.cloneNode(false);
  open.id = 'gfxopen'; open.removeAttribute('aria-label'); open.title = 'Graphics settings and switches'; open.textContent = 'Graphics';
  q.after(open);
  open.addEventListener('click', () => { box.hidden = !box.hidden; if (!box.hidden) refresh(); canvas.focus(); });
  let benchText = '';
  // live numbers while the panel is open: fps, frame time, GPU time, JavaScript time, render resolution
  const statsEl = document.createElement('div');
  statsEl.className = 'hint'; statsEl.style.fontVariantNumeric = 'tabular-nums'; statsEl.style.marginBottom = '6px';
  const stats = (st) => {
    if (box.hidden) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (viaComposer()) size.multiplyScalar(renderScale());
    statsEl.textContent = `${Math.round(st.fps)} fps · frame ${(1000 / st.fps).toFixed(1)} ms · GPU ${st.gpu > 0 ? st.gpu.toFixed(1) + ' ms' : 'n/a'}`
      + ` · JS ${st.js.toFixed(1)} ms · ${Math.round(size.x)}×${Math.round(size.y)} (${Math.round(renderScale() * 100)}%)`;
  };
  const h = (tag, props, ...kids) => { const e = document.createElement(tag); Object.assign(e, props || {}); for (const k of kids) e.append(k); return e; };
  const seg = (label, opts, current, pick) => h('div', { className: 'row' }, h('span', { textContent: label }),
    h('div', { className: 'seg' }, ...opts.map(([v, text]) => { const b = h('button', { type: 'button', textContent: text }); b.setAttribute('aria-pressed', String(v === current)); b.addEventListener('click', () => { pick(v); refresh(); canvas.focus(); }); return b; })));
  const chk = (key, label, hint, enabled = true) => {
    const i = h('input', { type: 'checkbox', checked: !!LOOK[key], disabled: !enabled });
    i.addEventListener('change', () => { setLook(key, i.checked); refresh(); canvas.focus(); });
    return h('label', { className: 'chk' + (enabled ? '' : ' off') }, i, h('span', {}, label, h('span', { className: 'hint', textContent: hint })));
  };
  function refresh() {
    if (box.hidden) return;
    // sit just below the top bar, which wraps to two rows in narrow windows
    const bar = el('status').getBoundingClientRect();
    box.style.top = Math.round(bar.bottom + 8) + 'px';
    box.style.maxHeight = 'calc(100% - ' + Math.round(bar.bottom + 24) + 'px)';
    const fx = window.__game && window.__game.fx, fxOn = window.__fxInfo ? __fxInfo().pass : false;
    const fxMode = !fx ? null : !fxOn ? 'off' : fx.cfg.relight ? 'full' : 'no relight';
    const close = h('button', { type: 'button', textContent: 'Close' });
    close.addEventListener('click', () => { box.hidden = true; canvas.focus(); });
    const up = h('select', {}, ...[['bicubic', 'Bicubic + sharpen'], ['sharp', 'Sharp pixels'], ['fsr', 'FSR 1']].map(([v, t]) => h('option', { value: v, textContent: t, selected: LOOK.upscaler === v })));
    up.addEventListener('change', () => { setLook('upscaler', up.value); canvas.focus(); });
    const rw = h('select', { disabled: !RIVERS_ON }, ...[['baked', 'Baked'], ['live', 'Live (64 m round you)'], ['wide', 'Live, wide (128 m)']].map(([v, t]) => h('option', { value: v, textContent: t, selected: LOOK.riverWater === v, disabled: v !== 'baked' && !riverLive.available })));
    rw.addEventListener('change', () => { setLook('riverWater', rw.value); canvas.focus(); });
    const wt = h('select', { disabled: !RIVERS_ON }, ...[['smooth', 'Smooth (realistic)'], ['fine', 'Pixels, fine (4 per ground pixel)'], ['ground', 'Pixels, as the ground']].map(([v, t]) => h('option', { value: v, textContent: t, selected: LOOK.waterTexel === v })));
    wt.addEventListener('change', () => { setLook('waterTexel', wt.value); canvas.focus(); });
    const bs = h('select', { disabled: !RIVERS_ON }, ...[['voxel', 'Voxel'], ['voxelFine', 'Voxel, fine'], ['real', 'Realistic']].map(([v, t]) => h('option', { value: v, textContent: t, selected: LOOK.bedStyle === v })));
    bs.addEventListener('change', () => { setLook('bedStyle', bs.value); canvas.focus(); });
    const wr = h('select', { disabled: !RIVERS_ON }, ...[['probe', 'Surroundings'], ['full', 'Surroundings, full'], ['simple', 'Simple']].map(([v, t]) => h('option', { value: v, textContent: t, selected: LOOK.waterReflect === v })));
    wr.addEventListener('change', () => { setLook('waterReflect', wr.value); canvas.focus(); });
    const tm = h('select', {}, ...[['aces', 'ACES (original)'], ['agxlook', 'AgX look'], ['agx', 'AgX'], ['neutral', 'Neutral']].map(([v, t]) => h('option', { value: v, textContent: t, selected: LOOK.toneMap === v })));
    tm.addEventListener('change', () => { setLook('toneMap', tm.value); canvas.focus(); });
    const rs = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: LOOK.rootShade });
    const rsVal = h('span', { textContent: LOOK.rootShade.toFixed(2) });
    rs.addEventListener('input', () => { setLook('rootShade', +rs.value); rsVal.textContent = (+rs.value).toFixed(2); });
    rs.addEventListener('change', () => canvas.focus());
    const fs = h('button', { type: 'button', textContent: document.fullscreenElement ? 'Exit full screen' : 'Full screen' });
    fs.addEventListener('click', () => el('fullscreen').click());
    const run = h('button', { type: 'button', textContent: 'Run benchmark' });
    run.addEventListener('click', async () => {
      box.hidden = true; canvas.focus();                      // the panel itself costs a little to draw: keep it out of the numbers
      const r = await perf.bench();
      benchText = r ? r.text : benchText;
      box.hidden = false; refresh();
    });
    const copy = h('button', { type: 'button', textContent: 'Copy' });
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(benchText); copy.textContent = 'Copied'; } catch (e) { copy.textContent = 'Select and copy by hand'; } });
    box.replaceChildren(
      h('div', { className: 'head' }, h('h2', { textContent: 'Graphics' }), close),
      statsEl,
      seg('Quality', GFX_ORDER.map((k) => [k, GFX[k].label]), quality.preset, (k) => setQuality(k, true)),
      seg('Resolution', RENDER_SCALES.map((v) => [v, v === 'auto' ? 'Auto' : Math.round(v * 100) + '%']), quality.scale, (v) => setRenderScale(v, true)),
      quality.scale === 'auto' ? seg('Target fps', FPS_TARGETS.map((v) => [v, String(v)]), quality.target, (v) => { quality.target = v; saveGfx(); }) : '',
      h('div', { className: 'hint', textContent: quality.level !== 'high' ? 'Low draws straight to the screen: lower resolution there is a plain stretch.'
        : (quality.scale === 'auto' ? 'Auto: rendering at ' + Math.round(renderScale() * 100) + '% to hold ' + quality.target + ' fps. ' : '')
          + 'Below 100%, the 3D view is enlarged with a sharpening upscaler; the HUD stays sharp.' }),
      fxMode ? seg('Lighting', [['full', 'Full'], ['no relight', 'No relight'], ['off', 'Off']], fxMode, (m) => { fx.setLighting(m); try { localStorage.setItem('fx-lighting', m); } catch (e) {} }) : '',
      h('div', { className: 'row' }, h('span', { textContent: 'Screen' }), fs),
      h('div', { className: 'sec', textContent: 'Grass and trees' }),
      chk('drawOrder', 'Draw trees, then grass, then ground', 'Skips pixels that end up covered. Looks the same, runs faster.'),
      seg('Far grass', [['off', 'Full'], ['normal', 'Simplified'], ['aggressive', 'Aggressive']], LOOK.farGrass, (v) => setLook('farGrass', v)),
      h('div', { className: 'hint', textContent: 'Simplified: tufts past about 30 m use fewer cards. Aggressive: fewer cards from 12 m, thinning to a quarter by 46 m, no grass past 56 m; the ground colour shows through. Mostly matters zoomed out.' }),
      chk('tuftShadow', 'One shadow per grass tuft', 'Cheaper than per pixel; shadow edges fall tuft by tuft.'),
      chk('grassShadows', 'Shadows on grass', 'Tree and building shadows fall on the grass.'),
      h('div', { className: 'sec', textContent: 'Speed' }),
      chk('hudBlur', 'Frosted glass behind HUD panels', 'The browser re-blurs the scene behind every panel each frame, at full resolution. Off: panels stay see-through without the blur.'),
      compactHdrOK ? chk('compactHdr', 'Compact HDR buffers', 'Scene buffers at 32 bits a sample instead of 64: about half the memory traffic with 4x MSAA. Rarely, slight banding in smooth dark gradients.') : '',
      chk('lightBloom', 'Lighter bloom', 'Starts the glow from a quarter-resolution image instead of half. Looks nearly the same.'),
      h('div', { className: 'sec', textContent: 'Look' }),
      (() => {
        // streams change the terrain itself, so switching them saves and reloads the world
        const i = h('input', { type: 'checkbox', checked: RIVERS_ON });
        i.addEventListener('change', () => { try { localStorage.setItem('rivers', i.checked ? '1' : '0'); } catch (e) { /* no storage */ } saveGame(); location.reload(); });
        return h('label', { className: 'chk' }, i, h('span', {}, 'Streams and rivers', h('span', { className: 'hint', textContent: 'Streams carved into the land, with water of their own. Changes the terrain, so the world saves and reloads.' })));
      })(),
      chk('grassClumps', 'Grass in clumps', 'Patches with their own height, lean and colour, in drifts of green and dry grass.'),
      chk('grassBacklight', 'Sun through grass', 'Looking toward the sun, the blades glow, brightest at the tips.'),
      chk('grassSheen', 'Grass sheen', 'Blades that face the sun catch a faint green-gold glint, moving with the wind, not the camera.'),
      chk('farBlend', 'Far grass blends into the ground', 'Distant grass takes the colour of the ground under it, so thinning does not show.'),
      chk('edgeBelts', 'Forest edges and shores', 'A belt of scrub, brambles and saplings where forest meets meadow, and long grass along the water. Looks only; trees are where they were.'),
      chk('crownShade', 'Tree crowns: lit shell, dark core', 'Leaves inside and under a crown are darker than the outer ones.'),
      chk('sunFog', 'Fog warms toward the sun', 'The fog takes the sun\'s colour where you look toward it and thins with height, so hills stay clear.'),
      chk('camFx', 'Camera: film grain and lens fringing', 'Fine grain, stronger in shadows, and a little colour fringing toward the corners.'),
      chk('taa', 'Temporal upscaling (TAAU), experimental', 'Blends frames from a jittered camera in place of MSAA. Smooths edges and shimmer, but softens the pixel textures. Off: MSAA as before.'),
      chk('skyShade', 'Shade under trees and in hollows', 'Ground and grass beneath tree crowns and down in dips see less sky, so forest floors darken. Baked, no frame cost.'),
      chk('ao', 'Extra ambient occlusion', 'A second, stronger occlusion on top of the Lighting pass (Ultra full, High and Medium half resolution).'),
      h('div', { className: 'sec', textContent: 'Sky' }),
      seg('Sky', [['physical', 'Physical'], ['painted', 'Painted']], LOOK.skyModel, (v) => setLook('skyModel', v)),
      h('div', { className: 'hint', textContent: 'Physical works the sky out from how air and haze scatter sunlight: the blue, the pale horizon, the glow round the sun and the colours of sunrise and sunset, which also tint the distance haze. Painted is the earlier two-colour sky.' }),
      seg('Clouds', [['volume', 'Volumetric'], ['flat', 'Flat'], ['off', 'Off']], LOOK.skyClouds === 'layered' ? 'volume' : LOOK.skyClouds === 'heaped' ? 'flat' : LOOK.skyClouds, (v) => setLook('skyClouds', v)),
      h('div', { className: 'hint', textContent: 'Volumetric: clouds with depth, worked out by marching through a cloud layer 1.3 to 3 km up: flat bases, billowed tops, lit through themselves from the sun, silver-edged toward it, glowing pink from below at sunset. Flat: the cheaper painted heaps. Both have thin cirrus high up. Cover follows the weather.' }),
      seg('Night sky', [['real', 'Real stars'], ['simple', 'Simple'], ['off', 'Off']], LOOK.nightSky, (v) => setLook('nightSky', v)),
      h('div', { className: 'hint', textContent: 'Real: the 5000 stars the eye can see, in their true constellations for the date, hour and latitude, the Milky Way, and the moon in its true place and phase, which lights the night. Simple: made-up stars and a fixed moonlight.' }),
      seg('Distance haze', [['light', 'Light'], ['normal', 'Normal'], ['heavy', 'Heavy']], LOOK.haze, (v) => setLook('haze', v)),
      chk('farLand', 'Land to the horizon', 'Past the loaded world (about 100 m), a simpler sheet of the same land runs on to about 400 m and into the haze. Off: the fog closes in at the world\'s edge, as before.'),
      chk('openSea', 'Open sea horizon', 'Far land across a wide water (more than about 90 m of it) is left out, so the sea runs to the horizon. Off: the far shores show.', LOOK.farLand),
      h('div', { className: 'row' }, h('span', {}, 'Stream water', h('span', { className: 'hint', textContent: 'Live simulates the water round you on the graphics card: it flows round what you put in it, fills what you dig and stirs as you wade. Baked is the still, cheaper version everywhere. Beyond the live window the baked water shows.' })), rw),
      h('div', { className: 'row' }, h('span', {}, 'Stream reflections', h('span', { className: 'hint', textContent: 'Surroundings: streams near you reflect what is really round them: the banks, grass and rocks mirrored in place where they meet the water, and a small picture of the surroundings further off. It draws the scene again, every other frame, at low resolution and only to 40 m. Surroundings, full: every frame, sharper and to the horizon (costly). Simple: a sky and a tree line worked out in the shader, cheapest.' })), wr),
      h('div', { className: 'row' }, h('span', {}, 'Stream beds', h('span', { className: 'hint', textContent: 'The stones under the stream water near you. Voxel draws them in small texels with a few tones, like the rest of the world (Voxel, fine: texels half the size); Realistic draws them smooth.' })), bs),
      h('div', { className: 'row' }, h('span', {}, 'Water style', h('span', { className: 'hint', textContent: 'Smooth draws the foam, flow and ripples of the streams at full detail. The pixel styles cut them into texels like the ground.' })), wt),
      h('div', { className: 'row' }, h('span', {}, 'Upscaler', h('span', { className: 'hint', textContent: 'How a below-full-size render is enlarged. Sharp pixels keeps each pixel a crisp block. FSR 1 is made for photoreal images and smears pixel textures.' })), up),
      h('div', { className: 'row' }, h('span', {}, 'Tone mapping', h('span', { className: 'hint', textContent: 'How bright light is fitted to the screen. AgX rolls bright colours to white without ACES\'s hue shift; Neutral keeps colours as painted.' })), tm),
      h('div', { className: 'row' }, h('span', {}, 'Grass root shade', h('span', { className: 'hint', textContent: '1 is the original; lower lifts the roots, tips unchanged.' })), h('span', {}, rs, ' ', rsVal)),
      h('div', { className: 'sec', textContent: 'Benchmark' }),
      h('div', { className: 'row' }, h('span', { className: 'hint', textContent: 'About 20 s. Stand somewhere typical and leave the controls alone.' }), run),
      benchText ? h('div', {}, h('pre', { textContent: benchText }), copy) : '',
    );
  }
  window.__gfxPanel = { refresh, stats, get open() { return !box.hidden; }, show: () => { box.hidden = false; refresh(); } };
  return window.__gfxPanel;
})();
// Full screen. Browsers allow it only from a click; inside an embedded viewer it may be refused, and the button says so.
(() => {
  const q = el('quality');
  const b = q.cloneNode(false);
  b.id = 'fullscreen'; b.removeAttribute('aria-label'); b.title = 'Full screen (Esc leaves it)';
  q.after(b);
  const label = () => { b.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; };
  b.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch (e) { b.textContent = 'Full screen not allowed here'; setTimeout(label, 2500); }
    canvas.focus();
  });
  document.addEventListener('fullscreenchange', () => { label(); resize(); });
  label();
})();
el('newworld').addEventListener('click', () => { saveGame(); resetWorld((Math.random() * 1e6) | 0); canvas.focus(); });
el('helpbtn').addEventListener('click', () => { el('help').hidden = true; canvas.focus(); });

function resetWorld(seed) {
  SEED = seed >>> 0;
  noise = makeSimplex(SEED);
  rivers = makeRivers();
  sim = createGameSim(SEED); simCtl.builds = null; simCtl.siteV = -1;
  sim.listen(onSimEvent);
  clearEnemies();
  if (window.__game?.cooking?.active) window.__game.cooking.close();
  if (window.__build) window.__build.reset();
  chunkStream.reset(); farLand.reset();
  world.edits.clear(); world.removed.clear(); macroDirty.clear(); chunkRefreshQ.clear();
  for (const f of world.fallers) scene.remove(f.mesh);
  for (const L of world.logs) scene.remove(L.mesh);
  for (const p of world.pickups) scene.remove(p.mesh);
  world.fallers.length = world.logs.length = world.pickups.length = world.shakes.length = 0;
  parts.length = 0;
  world.wood = world.stone = world.kills = 0; depthState.dirty = true;
  Object.assign(player, { hp: 100, stam: 100, dead: 0, kvx: 0, kvz: 0, atk: null, dash: null, roll: null, air: false, aiming: false, charging: null, parry: null, riposte: 0, tap: 0 });
  for (const a of arrows) scene.remove(a.mesh);
  arrows.length = 0;
  player.x = 0; player.z = 0;
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY + SEED); } catch (e) { /* no storage here */ }
  if (!(raw && applySave(raw))) { sim.setYearDays(NEW_WORLD_YEAR_DAYS); simCtl.newWorld = true; }   // a new world gets the short year and a well; saved worlds keep theirs
  chunkStream.update(player.x, player.z, Infinity);
  player.y = heightAt(player.x, player.z);
  cam.tx = player.x; cam.tz = player.z; cam.ty = player.y;
  spawnEnemy('start|e0', 12, 10, 0, 'start');
  spawnEnemy('start|e1', -16, 13, 1, 'start');
  setMsg('');
  el('seed').textContent = String(SEED);
  setSpeed(simCtl.speed);
  try { history.replaceState(null, '', '#seed-' + SEED); } catch (err) { /* hash not writable here */ }
  hudDirty = true;
}

// ============================================================ combat
// Melee works like the bow: hold to wind up, release to strike, and the camera aims it.
// A swing is a real arc that sweeps over time, so the blade hits a target when it reaches it,
// and turning the camera into the swing brings it round sooner. A tap is a quick straight thrust.
// Enemy timing varies and they defend, so the fight is watching them, not keeping a beat.
const say = (t) => { player.comboLabel = t; player.comboShow = 0.9; };
function sweepTest(ox, oz, face, a0, a1, reach) {
  const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  return (x, z, r) => {
    const dx = x - ox, dz = z - oz, d = Math.hypot(dx, dz);
    if (d > reach + r) return false;
    if (d < 0.5 + r) return true;
    let th = Math.atan2(dx, dz) - face; th = Math.atan2(Math.sin(th), Math.cos(th));
    const pad = Math.min(0.6, r / d + 0.08);
    return th > lo - pad && th < hi + pad;
  };
}
// One frame of the blade moving through the world: whatever the edge crosses this frame is hit, once per swing.
function bladePass(a, test) {
  const P = player, fx = Math.sin(P.face), fz = Math.cos(P.face);
  if (arcWorldDamage(P.x, P.z, P.y, test, a.seen)) { a.hitAny = true; cam.shake = Math.min(cam.shake + 0.07, 0.5); }
  const into = P.mvx * fx + P.mvz * fz;                       // stepping into the blow adds weight, backing away takes it off
  const mom = into > 3 ? 1.25 : into < -1.5 ? 0.75 : 1;
  let landed = false;
  for (const e of enemies) {
    if (e.state === 'dead' || a.seen.has(e) || !test(e.x, e.z, 0.45)) continue;
    a.seen.add(e); a.hitAny = true;
    const dx = e.x - P.x, dz = e.z - P.z, d = Math.hypot(dx, dz) || 1;
    const back = Math.sin(e.face) * (dx / d) + Math.cos(e.face) * (dz / d) > 0.35;
    const guarding = e.kind === 1 && !back && (e.state === 'chase' || e.state === 'idle');
    if (guarding && !a.heavy) {                               // a light blow glances off a raised shield and invites a counter
      burst(e.x - (dx / d) * 0.4, e.y + 1.0, e.z - (dz / d) * 0.4, 9, 0xffe9a8, 3.5, 3, 0.07, 0.4);
      e.bar = 4; P.kvx -= (dx / d) * 2.5; P.kvz -= (dz / d) * 2.5; spendStam(4);
      if (Math.random() < 0.5) e.cd = 0;
      continue;
    }
    landed = true;
    let dmg = a.dmg * mom * (back ? 1.6 : 1) * (e.state === 'stagger' ? 1.9 : 1) * (a.crit ? 2.2 : 1);
    if (guarding) { dmg *= 0.5; e.state = 'stagger'; e.t = 0; e.stagT = 1.3; e.post = 0; say('Guard broken'); }
    damageEnemy(e, dmg, dx / d, dz / d, a.heavy ? 7 : 2.5, a.post * (a.crit ? 2 : 1));
    if (back || a.crit) burst(e.x, e.y + 1.0, e.z, 6, 0xffd45a, 3, 3, 0.08, 0.45);
  }
  if (landed) { juice.hitStop = a.heavy ? 0.1 : a.crit ? 0.08 : 0.045; cam.shake = Math.min(cam.shake + (a.heavy ? 0.2 : 0.07), 0.5); }
}
function faceCamera() { player.face = player.faceTarget = cam.yaw + Math.PI; }
function stepBlocked() {
  const fx = Math.sin(player.face), fz = Math.cos(player.face);
  for (const e of enemies) if (e.state !== 'dead' && arcHit(player.x, player.z, fx, fz, 1.5, 0.3, e.x, e.z, 0.3)) return true;
  return false;
}
function takeRiposte() { const c = player.riposte > 0; player.riposte = 0; if (c) say('Riposte'); return c; }
function startThrust() {
  const P = player; faceCamera();
  const run = P.speed > 7;                                   // a running thrust carries further and hits harder
  P.atk = { kind: 'thrust', t: 0, dur: 0.3, done: false, seen: new Set(), dmg: 9 * (run ? 1.4 : 1), post: 10, heavy: false, crit: takeRiposte(), reach: 2.6, half: 0.3, lunge: run ? 14 : 9, blocked: stepBlocked(), hitAny: false };
  spendStam(6);
}
function startSwing(c) {
  const P = player; faceCamera();
  const side = Math.abs(cam.yawRate) > 1.2 ? Math.sign(cam.yawRate) : P.nextSide;    // swing the way you are turning
  const half = lerp(1.1, 1.6, c);
  P.atk = { kind: 'swing', side, c, t: 0, dur: lerp(0.32, 0.5, c), done: false, seen: new Set(), dmg: lerp(9, 30, c), post: lerp(10, 65, c), heavy: c >= 0.55, crit: takeRiposte(), reach: lerp(2.1, 2.6, c), half, ang: -side * half, lunge: lerp(4, 8, c), blocked: stepBlocked(), hitAny: false };
  spendStam(lerp(7, 15, c));
}
function kickHit() {
  const P = player, fx = Math.sin(P.face), fz = Math.cos(P.face);
  let any = false;
  for (const e of enemies) {
    if (e.state === 'dead' || !arcHit(P.x, P.z, fx, fz, 1.9, Math.cos(0.7), e.x, e.z, 0.45)) continue;
    any = true;
    const facing = Math.sin(e.face) * -fx + Math.cos(e.face) * -fz > 0.3;
    if (e.kind === 1 && facing && (e.state === 'chase' || e.state === 'idle')) { e.state = 'stagger'; e.t = 0; e.stagT = 1.5; say('Guard broken'); }
    else if (e.state === 'windup' && e.move.parry) { e.state = 'recover'; e.t = 0; e.recT = 0.7; e.chain = false; }   // a kick stuffs a quick attack
    damageEnemy(e, 3, fx, fz, 8, 30);
  }
  if (any) { burst(P.x + fx, P.y + 0.6, P.z + fz, 8, 0xe8e4d4, 2.5, 2, 0.09, 0.4); cam.shake = Math.min(cam.shake + 0.1, 0.5); juice.hitStop = 0.04; }
}

const juice = { hitStop: 0, onEnemy: false, lockFailed: false };
const enemies = [];
function spendStam(n) { player.stam = Math.max(0, player.stam - n); player.stamWait = 0.7; }
function pushOut(o, rad) {
  forNearby(o.x, o.z, 2.5, (c) => {
    for (const tr of c.trees) {
      if (!tr.alive) continue;
      const r = TREE[tr.type].r * tr.scale + rad, dx = o.x - tr.x, dz = o.z - tr.z, d = Math.hypot(dx, dz);
      if (d < r && d > 1e-4) { o.x = tr.x + (dx / d) * r; o.z = tr.z + (dz / d) * r; }
    }
    for (const rk of c.rocks) {
      if (!rk.alive || rk.scale < 0.7) continue;
      const r = rk.scale * 0.75 + rad - 0.08, dx = o.x - rk.x, dz = o.z - rk.z, d = Math.hypot(dx, dz);
      if (d < r && d > 1e-4) { o.x = rk.x + (dx / d) * r; o.z = rk.z + (dz / d) * r; }
    }
  });
  if (window.__game?.cooking) window.__game.cooking.collide(o, rad);
  if (window.__build) window.__build.collide(o, rad, o === player);      // walls and furniture
  for (let i = 0; i < control.colliders.length; i++) control.colliders[i](o, rad);   // vehicle bodies and other registered pushers
}
const trails = { t: 0, cur: null };
{
  const mk = (half) => {
    const g = new THREE.RingGeometry(0.8, 2.3, 28, 1, -Math.PI / 2 - half, half * 2);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xfff3c9, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.position.y = 0.95; m.visible = false; pm.root.add(m);
    return m;
  };
  trails.stab = mk(0.35); trails.blade = mk(0.2); trails.peak = 0.5;
}
function showTrail(kind, perfect) {
  if (trails.cur) trails.cur.visible = false;
  trails.cur = trails[kind]; trails.cur.visible = true; trails.t = 0.14;
  trails.cur.material.color.setHex(perfect ? 0xffd45a : 0xfff3c9);
  trails.peak = perfect ? 0.85 : 0.5;
}
// ---- arrows
const arrows = [];
const arrowGeo = new THREE.BoxGeometry(0.045, 0.045, 0.8);
const arrowMat = new THREE.MeshLambertMaterial({ color: 0xe8dcc0, emissive: 0x4a3a1c });
const streakGeo = new THREE.BoxGeometry(0.03, 0.03, 2.0); streakGeo.translate(0, 0, -1.3);
const streakMat = new THREE.MeshBasicMaterial({ color: 0xfff3c9, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
const _dir = new THREE.Vector3();
function fireArrow(yawOff, power) {
  const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw), fwx = -Math.sin(cam.yaw), fwz = -Math.cos(cam.yaw);
  const ox = player.x + rx * 0.22 + fwx * 0.4, oy = player.y + 1.25, oz = player.z + rz * 0.22 + fwz * 0.4;
  _dir.set(cursor.x - ox, cursor.y - oy, cursor.z - oz).normalize();
  if (yawOff) _dir.applyAxisAngle(UP, yawOff);
  const sp = lerp(30, 64, power);
  const mesh = new THREE.Mesh(arrowGeo, arrowMat);
  const streak = new THREE.Mesh(streakGeo, streakMat); mesh.add(streak);
  mesh.castShadow = true; scene.add(mesh);
  arrows.push({ mesh, streak, x: ox, y: oy, z: oz, vx: _dir.x * sp, vy: _dir.y * sp, vz: _dir.z * sp, dmg: lerp(7, 24, power), power, life: 4, stuck: 0 });
}
function arrowHitsEnemy(a, e) {
  const sp = Math.hypot(a.vx, a.vz) || 1, adx = a.vx / sp, adz = a.vz / sp;
  const head = a.y > e.y + 0.92;
  const front = Math.sin(e.face) * -adx + Math.cos(e.face) * -adz;       // 1 means the arrow meets the enemy head-on
  const guarding = e.kind === 1 && (e.state === 'chase' || e.state === 'idle') && front > 0.35;
  if (guarding && !head) {                                                // a shield stops body shots from the front
    burst(a.x, a.y, a.z, 8, 0xffe9a8, 3, 3, 0.07, 0.4); e.bar = 4;
    if (e.state === 'idle') { e.state = 'chase'; e.t = 0; }
    return;
  }
  let dmg = a.dmg * (head ? 1.8 : 1) * (front < -0.3 ? 1.4 : 1);
  if (head) { burst(a.x, a.y, a.z, 10, 0xffd45a, 3.5, 3, 0.08, 0.5); juice.hitStop = 0.05; }
  damageEnemy(e, dmg, adx, adz, 2 + a.power * 4);
}
function updateArrows(dt) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    if (a.stuck > 0) { a.stuck -= dt; if (a.stuck <= 0) { scene.remove(a.mesh); arrows.splice(i, 1); } continue; }
    a.life -= dt;
    let gone = a.life <= 0, stick = false;
    for (let s = 0; s < 3 && !gone && !stick; s++) {
      const h = dt / 3;
      a.vy -= 5 * h; a.x += a.vx * h; a.y += a.vy * h; a.z += a.vz * h;
      const gh = heightAt(a.x, a.z);
      if (a.y < gh) { a.y = gh + 0.05; stick = true; burst(a.x, a.y, a.z, 4, 0x6b4f35, 1.5, 2, 0.08, 0.4); break; }
      if (a.y < SEA && gh < SEA) { burst(a.x, SEA, a.z, 8, 0xd8f0ff, 1.8, 3, 0.09, 0.5); gone = true; break; }
      for (const e of enemies) {
        if (e.state === 'dead') continue;
        const dx = a.x - e.x, dz = a.z - e.z;
        if (dx * dx + dz * dz < 0.3 && a.y > e.y && a.y < e.y + 1.4) { arrowHitsEnemy(a, e); gone = true; break; }
      }
      if (gone) break;
      forNearby(a.x, a.z, 1, (c) => {
        for (const tr of c.trees) {
          if (!tr.alive || stick) continue;
          const r = TREE[tr.type].r * tr.scale + 0.04;
          if ((a.x - tr.x) ** 2 + (a.z - tr.z) ** 2 < r * r && a.y < gh + TREE[tr.type].h * tr.scale * 0.85) stick = true;
        }
      });
    }
    if (gone) { scene.remove(a.mesh); arrows.splice(i, 1); continue; }
    a.mesh.position.set(a.x, a.y, a.z);
    a.mesh.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz);
    if (stick) { a.stuck = 6; a.streak.visible = false; }
  }
}
function makeEnemy(kind) {
  const skin = new THREE.MeshLambertMaterial({ color: kind ? 0x55804f : 0x7aa052 });
  const cloth = new THREE.MeshLambertMaterial({ color: kind ? 0x3d3a4a : 0x4a3b2c });
  const woodM = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  const box = (w, h, d, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.castShadow = true; return o; };
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const torso = box(0.52, 0.46, 0.32, cloth); torso.position.set(0, 0.7, 0.03); torso.rotation.x = 0.25;
  const head = box(0.36, 0.3, 0.34, skin); head.position.set(0, 1.07, 0.12);
  const earL = box(0.16, 0.08, 0.05, skin); earL.position.set(0.25, 1.12, 0.1);
  const earR = box(0.16, 0.08, 0.05, skin); earR.position.set(-0.25, 1.12, 0.1);
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.13, 0.48, 0); legR.position.set(0.13, 0.48, 0);
  const l1 = box(0.17, 0.48, 0.19, skin); l1.position.y = -0.24; legL.add(l1);
  const l2 = box(0.17, 0.48, 0.19, skin); l2.position.y = -0.24; legR.add(l2);
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(0.33, 0.88, 0.05); armR.position.set(-0.33, 0.88, 0.05);
  const a1 = box(0.13, 0.5, 0.13, skin); a1.position.y = -0.25; armL.add(a1);
  const a2 = box(0.13, 0.5, 0.13, skin); a2.position.y = -0.25; armR.add(a2);
  const handle = box(0.07, 0.07, 0.7, woodM); handle.position.set(0, -0.48, 0.25);
  const clubHead = box(0.18, 0.18, 0.34, woodM); clubHead.position.set(0, -0.48, 0.66);
  armR.add(handle, clubHead);
  body.add(torso, head, earL, earR, legL, legR, armL, armR);
  let shield = null;
  if (kind) {
    shield = new THREE.Group();
    const plank = box(0.07, 0.66, 0.54, new THREE.MeshLambertMaterial({ color: 0x8a6b3f }));
    const boss = box(0.1, 0.2, 0.2, new THREE.MeshLambertMaterial({ color: 0xb9c2c9 }));
    shield.add(plank, boss); body.add(shield);
  }
  const bar = new THREE.Group();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.1), new THREE.MeshBasicMaterial({ color: 0x14181a, depthTest: false, fog: false, transparent: true }));
  const fg = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.06), new THREE.MeshBasicMaterial({ color: 0xd9503c, depthTest: false, fog: false, transparent: true }));
  const pg = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.035), new THREE.MeshBasicMaterial({ color: 0xe2b65a, depthTest: false, fog: false, transparent: true }));
  bg.renderOrder = 20; fg.renderOrder = 21; fg.position.z = 0.001; pg.renderOrder = 21; pg.position.set(0, -0.085, 0.001);
  bar.add(bg, fg, pg); bar.position.y = 1.75; root.add(bar);
  scene.add(root);
  return { root, body, legL, legR, armL, armR, shield, bar, fg, pg, skin };
}
// What an enemy can throw. Yellow glow can be parried. Red cannot, and has to be dodged or outspaced.
const MOVES = {
  jab: { wind: 0.42, hold: [0, 0], dmg: 10, reach: 2.2, arc: 0.8, parry: true, rec: 0.6 },
  swing: { wind: 0.7, hold: [0, 0], dmg: 15, reach: 2.4, arc: 1.0, parry: true, rec: 0.85 },
  delay: { wind: 0.55, hold: [0.3, 0.7], dmg: 16, reach: 2.4, arc: 1.0, parry: true, rec: 0.85 },
  slam: { wind: 1.05, hold: [0, 0], dmg: 24, reach: 2.8, arc: 1.3, parry: false, rec: 1.2 },
};
const MOVESET = [['jab', 'swing', 'swing', 'delay'], ['swing', 'delay', 'slam', 'jab']];
function spawnEnemy(id, x, z, kind, chunkKey) {
  if (!COMBAT) return;
  const m = makeEnemy(kind);
  const e = {
    id, x, z, y: heightAt(x, z), hx: x, hz: z, tx: x, tz: z, kind, chunkKey, m,
    face: Math.random() * 6.28, hp: kind ? 62 : 40, maxHp: kind ? 62 : 40, post: 0, maxPost: kind ? 130 : 90, postWait: 0,
    state: 'idle', t: 0, cd: 0, wanderT: 1, stagT: 1, recT: 0.8, windT: 0.7, move: MOVES.swing, chain: false,
    kvx: 0, kvz: 0, flash: 0, bar: 0, walk: 0, hits: 0, hitT: 0, strafe: Math.random() < 0.5 ? 1 : -1,
  };
  enemies.push(e);
  return e;
}
function startMove(e, name) {
  const mv = MOVES[name];
  e.move = mv; e.state = 'windup'; e.t = 0;
  e.windT = mv.wind + lerp(mv.hold[0], mv.hold[1], Math.random());
}
function damageEnemy(e, dmg, kx, kz, knock, post = 0) {
  if (e.state === 'dead') return;
  e.hp -= dmg; e.flash = 0.18; e.bar = 5;
  e.kvx += kx * knock; e.kvz += kz * knock;
  burst(e.x, e.y + 0.9, e.z, 8, 0xd8d2b0, 2.6, 3, 0.09, 0.5);
  if (e.state === 'idle') { e.state = 'chase'; e.t = 0; }
  if (e.hp <= 0) {
    e.state = 'dead'; e.t = 0; world.removed.add(e.id); world.kills++; hudDirty = true;
    burst(e.x, e.y + 0.8, e.z, 18, e.kind ? 0x55804f : 0x7aa052, 3, 4, 0.13, 0.9);
    return;
  }
  if (e.state !== 'stagger') {
    e.post += post; e.postWait = 1.5;
    if (e.post >= e.maxPost) {                       // posture broken: wide open for a moment
      e.post = 0; e.state = 'stagger'; e.t = 0; e.stagT = 1.9; say('Staggered');
      burst(e.x, e.y + 1.2, e.z, 12, 0xffd45a, 3.5, 4, 0.09, 0.6);
      return;
    }
  }
  // a grunt that eats two quick hits hops back out of the third and comes straight back in
  e.hits = e.hitT > 0 ? e.hits + 1 : 1; e.hitT = 1.2;
  if (e.kind === 0 && e.hits >= 2 && (e.state === 'chase' || e.state === 'recover') && Math.random() < 0.7) {
    e.hits = 0; e.state = 'hop'; e.t = 0;
    const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz) || 1;
    e.kvx = (dx / d) * 11; e.kvz = (dz / d) * 11;
  }
}
function hitPlayer(e, fx, fz, mv) {
  const P = player;
  if (P.dead > 0 || P.roll || P.dash) return;                        // a roll or a dash goes straight through the blow
  const front = Math.sin(P.face) * -fx + Math.cos(P.face) * -fz > 0.1;
  if (P.parry && P.parry.t <= 0.22 && front && mv.parry) {           // deflected
    burst(P.x + fx * -0.6, P.y + 1.1, P.z + fz * -0.6, 18, 0xfff0b0, 4.5, 4, 0.08, 0.5);
    cam.shake = Math.min(cam.shake + 0.2, 0.5); juice.hitStop = 0.08;
    P.riposte = 1.4; P.parry.t = 0.34; say('Parry');
    e.bar = 5; e.chain = false;
    e.post += 45; e.postWait = 1.5;
    if (e.post >= e.maxPost) { e.post = 0; e.state = 'stagger'; e.t = 0; e.stagT = 1.9; say('Parry, staggered'); }
    else { e.state = 'recover'; e.t = 0; e.recT = 1.15; }
    return;
  }
  P.hp -= mv.dmg;
  P.hurt = 0.4; P.regenWait = 6; P.atk = null; P.charging = null; P.parry = null; P.riposte = 0;
  P.kvx += fx * 6; P.kvz += fz * 6;
  cam.shake = Math.min(cam.shake + 0.35, 0.5);
  burst(P.x, P.y + 1.0, P.z, 8, 0xc9482e, 2.5, 3, 0.08, 0.5);
  if (P.hp <= 0) { P.hp = 0; P.dead = 2.6; P.dash = P.roll = null; P.aiming = false; setMsg('You fell. Waking at camp.'); }
}
function enemyStrike(e) {
  const fx = Math.sin(e.face), fz = Math.cos(e.face), mv = e.move;
  arcWorldDamage(e.x, e.z, e.y, (x, z, r) => arcHit(e.x, e.z, fx, fz, mv.reach - 0.3, Math.cos(mv.arc * 0.8), x, z, r));
  if (arcHit(e.x, e.z, fx, fz, mv.reach, Math.cos(mv.arc), player.x, player.z, 0.3)) hitPlayer(e, fx, fz, mv);
}
function updateEnemies(dt) {
  let attackers = 0;
  for (const o of enemies) if (o.state === 'windup') attackers++;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i], m = e.m;
    const dx = player.x - e.x, dz = player.z - e.z, d = Math.hypot(dx, dz) || 1e-3;
    if (d > 90 && e.state !== 'dead') { m.root.visible = false; continue; }
    m.root.visible = true;
    e.t += dt; e.cd -= dt; e.hitT -= dt; e.postWait -= dt;
    e.flash = Math.max(0, e.flash - dt); e.bar = Math.max(0, e.bar - dt);
    if (e.postWait <= 0) e.post = Math.max(0, e.post - 16 * dt);
    let mvx = 0, mvz = 0, turnTo = null, glow = 0;
    if (e.state === 'dead') {
      const k = Math.min(1, e.t / 0.45);
      m.body.rotation.x = -k * 1.5; m.body.position.y = k * 0.12; m.bar.visible = false;
      if (e.t > 2.4) { scene.remove(m.root); enemies.splice(i, 1); }
      else if (e.t > 1.8) m.root.scale.setScalar(Math.max(0.01, 1 - (e.t - 1.8) / 0.6));
      continue;
    }
    if (e.state === 'idle') {
      if (e.t > e.wanderT) { e.t = 0; e.wanderT = 2 + Math.random() * 3; const a = Math.random() * 6.283; e.tx = e.hx + Math.cos(a) * 5; e.tz = e.hz + Math.sin(a) * 5; }
      const wx = e.tx - e.x, wz = e.tz - e.z, wd = Math.hypot(wx, wz);
      if (wd > 0.6) { mvx = (wx / wd) * 1.1; mvz = (wz / wd) * 1.1; turnTo = Math.atan2(wx, wz); }
      if (d < 15 && player.dead <= 0) { e.state = 'chase'; e.t = 0; e.bar = 3; e.cd = 0.3 + Math.random() * 0.8; }
    } else if (e.state === 'chase') {
      turnTo = Math.atan2(dx, dz);
      const ux = dx / d, uz = dz / d, sp = e.kind ? 3.2 : 3.8;
      if (player.dead > 0 || d > 40) { e.state = 'idle'; e.t = 0; }
      else if (e.cd <= 0 && attackers < 2) {            // its turn: close in and commit to a move
        if (d > 2.0) { mvx = ux * sp; mvz = uz * sp; }
        if (d < 2.3) { const set = MOVESET[e.kind]; startMove(e, set[Math.floor(Math.random() * set.length)]); attackers++; }
      } else if (d > 6) { mvx = ux * sp; mvz = uz * sp; }
      else {                                            // waiting: hold a ring around the player and circle
        const ring = (3.5 - d) * -1.2;
        if (Math.random() < dt * 0.4) e.strafe = -e.strafe;
        mvx = ux * ring + -uz * e.strafe * 1.5; mvz = uz * ring + ux * e.strafe * 1.5;
      }
    } else if (e.state === 'windup') {
      if (e.t < e.windT - 0.22) turnTo = Math.atan2(dx, dz);   // tracking stops just before the blow, so a sidestep works
      glow = Math.min(1, e.t / e.move.wind);
      if (e.t > e.move.wind) glow = 0.75 + 0.25 * Math.sin(e.t * 26);         // held back: a delayed swing
      if (e.windT - e.t < 0.1) glow = 1.6;
      if (e.t >= e.windT) {
        const mv = e.move; e.chain = mv === MOVES.swing && Math.random() < 0.35;
        enemyStrike(e);
        if (e.state === 'windup') { e.state = 'recover'; e.t = 0; e.recT = e.chain ? 0.28 : mv.rec; }
      }
    } else if (e.state === 'recover') {
      if (e.t >= e.recT) {
        if (e.chain && d < 3.2) { e.chain = false; startMove(e, 'jab'); }
        else { e.chain = false; e.state = 'chase'; e.t = 0; e.cd = 1.1 + Math.random() * 1.6; }
      }
    } else if (e.state === 'stagger') {
      if (e.t >= e.stagT) { e.state = 'chase'; e.t = 0; e.cd = 0.5; }
    } else if (e.state === 'hop') {
      turnTo = Math.atan2(dx, dz);
      if (e.t >= 0.32) { if (d < 4.5) startMove(e, 'jab'); else { e.state = 'chase'; e.t = 0; e.cd = 0.2; } }
    }
    if (turnTo !== null) { let df = turnTo - e.face; df = Math.atan2(Math.sin(df), Math.cos(df)); e.face += clamp(df, -7 * dt, 7 * dt); }
    if (e.frozen || ((mvx || mvz) && heightAt(e.x + mvx * 0.4, e.z + mvz * 0.4) < -0.45)) { mvx = 0; mvz = 0; }
    e.x += (mvx + e.kvx) * dt; e.z += (mvz + e.kvz) * dt;
    e.kvx *= Math.exp(-6 * dt); e.kvz *= Math.exp(-6 * dt);
    for (const o of enemies) {
      if (o === e || o.state === 'dead') continue;
      const sx = e.x - o.x, sz = e.z - o.z, sd = Math.hypot(sx, sz);
      if (sd < 0.95 && sd > 1e-4) { e.x += (sx / sd) * (0.95 - sd) * 0.5; e.z += (sz / sd) * (0.95 - sd) * 0.5; }
    }
    if (d < 0.8 && !player.dash) { e.x -= (dx / d) * (0.8 - d); e.z -= (dz / d) * (0.8 - d); }
    pushOut(e, 0.3);
    e.y = lerp(e.y, Math.max(heightAt(e.x, e.z), -0.6), 1 - Math.exp(-16 * dt));
    const sp = Math.hypot(mvx, mvz);
    e.walk += sp * dt * 2.4;
    // pose
    m.root.position.set(e.x, e.y + (e.state === 'hop' ? Math.sin(Math.min(e.t / 0.32, 1) * Math.PI) * 0.5 : 0), e.z); m.root.rotation.y = e.face;
    const stride = Math.sin(e.walk) * clamp(sp / 3, 0, 1) * 0.8;
    m.legL.rotation.x = stride; m.legR.rotation.x = -stride; m.armL.rotation.x = -stride * 0.6;
    m.body.rotation.x = 0; m.body.rotation.z = 0; m.body.position.y = 0;
    let arm = stride * 0.6;
    if (e.state === 'windup') { arm = lerp(0, -2.9, smoothstep(0, e.move.wind * 0.75, e.t)); m.body.rotation.x = -0.15 * smoothstep(0, e.move.wind, e.t); }
    else if (e.state === 'recover') { arm = lerp(-2.9, -0.3, smoothstep(0, 0.12, e.t)); if (e.t > 0.3) arm = lerp(-0.3, 0, smoothstep(0.3, e.recT, e.t)); m.body.rotation.x = e.t < 0.3 ? 0.25 : 0; }
    else if (e.state === 'stagger') { m.body.rotation.z = Math.sin(e.t * 9) * 0.22; m.body.rotation.x = -0.25; arm = 0.6; }
    m.armR.rotation.x = arm;
    const fl = e.flash > 0 ? 1 : 0;
    if (e.move.parry) m.skin.emissive.setRGB(fl + glow * 1.0, fl + glow * 0.7, fl + glow * 0.05);
    else m.skin.emissive.setRGB(fl + glow * 1.2, fl + glow * 0.05, fl + glow * 0.03);
    if (m.shield) {       // held in front, unless the creature is committed to a swing or reeling
      const down = e.state === 'windup' || e.state === 'recover' || e.state === 'stagger';
      const gp = down ? [0.44, 0.55, -0.05, 0] : [0.05, 0.8, 0.44, Math.PI / 2];
      const k = 1 - Math.exp(-12 * dt);
      m.shield.position.x = lerp(m.shield.position.x, gp[0], k); m.shield.position.y = lerp(m.shield.position.y, gp[1], k);
      m.shield.position.z = lerp(m.shield.position.z, gp[2], k); m.shield.rotation.y = lerp(m.shield.rotation.y, gp[3], k);
    }
    m.bar.visible = e.bar > 0;
    if (m.bar.visible) {
      m.bar.quaternion.setFromAxisAngle(UP, -e.face).multiply(camera.quaternion);
      const f = clamp(e.hp / e.maxHp, 0, 1);
      m.fg.scale.x = Math.max(f, 0.001); m.fg.position.x = -0.44 * (1 - f);
      const pf = e.state === 'stagger' ? 1 : clamp(e.post / e.maxPost, 0, 1);
      m.pg.scale.x = Math.max(pf, 0.001); m.pg.position.x = -0.44 * (1 - pf);
    }
  }
}
function clearEnemies(pred) {
  for (let i = enemies.length - 1; i >= 0; i--) if (!pred || pred(enemies[i])) { scene.remove(enemies[i].m.root); enemies.splice(i, 1); }
}
function setMsg(t) { const b = el('msg'); b.textContent = t; b.hidden = !t; }
function respawn() {
  player.x = 0; player.z = 0; player.y = heightAt(0, 0); player.hp = 100; player.stam = 100; player.kvx = player.kvz = 0;
  cam.tx = 0; cam.tz = 0;
  for (const e of enemies) if (e.state !== 'dead') { e.state = 'idle'; e.t = 0; e.x = e.hx; e.z = e.hz; e.hp = e.maxHp; }
  setMsg('');
}

// ============================================================ main loop
// the one ground read (feet, wheels): terrain, plus hand-shaped ground (src/landscape-view.js), plus built floors
function groundAt(x, z, y) {
  const th = heightAt(x, z) + (reliefFn ? reliefFn(x, z) : 0);
  return window.__build ? window.__build.ground(x, z, y, th) : th;
}
function updatePlayer(dt) {
  if (window.__game?.cooking?.active) { mouse.left = mouse.right = false; ring.visible = false; return; }
  control.compose();
  if (control.possess(dt)) { ring.visible = false; return; }     // a seat (or other possession) moves the body instead
  const P = player;
  P.hurt = Math.max(0, P.hurt - dt);
  if (P.dead > 0) {
    P.dead -= dt;
    const k = clamp((2.6 - P.dead) / 0.5, 0, 1);
    pm.body.rotation.set(-k * 1.5, 0, 0); pm.body.position.y = k * 0.1;
    P.y = lerp(P.y, heightAt(P.x, P.z), 1 - Math.exp(-18 * dt));
    pm.root.position.set(P.x, P.y, P.z);
    ring.visible = false; pm.bow.visible = false;
    if (P.dead <= 0) respawn();
    return;
  }
  // the camera is the aim: forward is wherever it looks
  const fwx = -Math.sin(cam.yaw), fwz = -Math.cos(cam.yaw);
  const rxw = Math.cos(cam.yaw), rzw = -Math.sin(cam.yaw);
  const yawF = Math.atan2(fwx, fwz);
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz += 1;
  if (keys.KeyS || keys.ArrowDown) iz -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  ix += keys.joyX || 0; iz += keys.joyY || 0;                   // the on-screen stick, when there is one
  let mx = fwx * iz + rxw * ix, mz = fwz * iz + rzw * ix;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) { mx /= ml; mz /= ml; }                           // an analogue stick may ask for less than full speed
  if (ml < 0.05 && P.lead) { mx = P.lead.x; mz = P.lead.z; }      // an add-on may lead the walk (a shovel load pulled past reach)
  const swimming = heightAt(P.x, P.z) < -0.75;
  const alt = !!(keys.AltLeft || keys.AltRight);
  const armed = P.tool === 'axe';
  P.stamWait -= dt; P.regenWait -= dt; P.rollCd -= dt; P.dashCd -= dt; P.shotCd -= dt; P.comboLock -= dt; P.comboShow -= dt; P.riposte -= dt; P.tap -= dt;
  if (P.stamWait <= 0) {
    const food = sim.state.sys.cooking;
    const fed = food && food.fullness >= 60 && food.wellFedUntil > sim.state.t;
    P.stam = Math.min(100, P.stam + 30 * dt * (fed ? 1.1 : 1));
  }
  if (P.regenWait <= 0) P.hp = Math.min(100, P.hp + 2 * dt);
  // key edges
  const shift = !!(keys.ShiftLeft || keys.ShiftRight);
  let wantRoll = !!keys.KeyC;
  if (shift) P.shiftT += dt; else { if (P.shiftT > 0 && P.shiftT < 0.2) wantRoll = true; P.shiftT = 0; }
  const wantParry = !!keys.KeyE && !P.eHeld, wantKick = !!keys.KeyQ && !P.qHeld;
  P.eHeld = !!keys.KeyE; P.qHeld = !!keys.KeyQ;
  const busy = () => !!(P.roll || P.dash);
  if (keys.Space && !P.jumpHeld && !busy() && !swimming && P.stam > 4) {
    if (!P.air) { P.air = true; P.vy = 7.4; P.jumps = 1; spendStam(8); }
    else if (P.jumps < 2 && !(P.atk && P.atk.kind === 'plunge')) { P.vy = 6.8; P.jumps = 2; spendStam(8); burst(P.x, P.y, P.z, 8, 0xe8e4d4, 2, 1, 0.1, 0.4); }
  }
  P.jumpHeld = !!keys.Space;
  if (wantRoll && !busy() && P.rollCd <= 0 && !swimming && !P.air && P.stam >= 8) {
    const dx = ml > 0 ? mx : Math.sin(P.face), dz = ml > 0 ? mz : Math.cos(P.face);
    P.roll = { t: 0, dx, dz }; P.rollCd = 0.7; P.atk = null; P.charging = null; P.parry = null; spendStam(20);
    P.faceTarget = Math.atan2(dx, dz);
  }
  // bow: hold right mouse to draw
  const wasAiming = P.aiming;
  P.aiming = mouse.right && armed && !busy() && !swimming;
  if (P.aiming && !wasAiming) { P.draw = 0; P.atk = null; P.charging = null; P.parry = null; cam.aimPitch = 0.2; }
  if (P.aiming) {
    P.draw += dt;
    if (P.draw >= 0.85) { P.stam = Math.max(0, P.stam - 5 * dt); P.stamWait = 0.4; if (P.stam <= 0) P.draw = 0.2; }
  }
  const charge = P.aiming ? clamp(P.draw / 0.85, 0, 1) : 0;
  P.charge = charge;
  // movement
  let sp = 0, vx = 0, vz = 0;
  if (P.dash) {
    const d = P.dash; d.t += dt; sp = 30; vx = d.dx * 30; vz = d.dz * 30;
    for (const e of enemies) {
      if (e.state === 'dead' || d.hit.has(e) || Math.hypot(e.x - P.x, e.z - P.z) > 1.25) continue;
      d.hit.add(e);
      const back = Math.sin(e.face) * d.dx + Math.cos(e.face) * d.dz > 0.35;
      const guarded = e.kind === 1 && !back && (e.state === 'chase' || e.state === 'idle');
      damageEnemy(e, 14 * (back ? 1.6 : 1) * (guarded ? 0.5 : 1), d.dx, d.dz, 1, 15);
      juice.hitStop = 0.04;
    }
    if (Math.random() < dt * 60) burst(P.x, P.y + 0.9, P.z, 2, 0xfff3c9, 0.6, 0.6, 0.12, 0.25);
    if (d.t >= 0.2) P.dash = null;
  } else if (P.roll) {
    const r = P.roll; r.t += dt;
    sp = 11 * (1 - r.t / 0.42 * 0.5); vx = r.dx * sp; vz = r.dz * sp;
    if (r.t >= 0.42) P.roll = null;
  } else {
    if (ml > 0) {
      const sprint = shift && P.shiftT >= 0.2 && P.stam > 0 && !P.aiming && !swimming && !P.atk && !P.charging && !P.parry;
      if (sprint) { P.stam = Math.max(0, P.stam - 11 * dt); P.stamWait = 0.4; }
      sp = swimming ? 2.6 : sprint ? 8.2 : 5.4;
      if (P.carryK) sp *= P.carryK;                                // slower with a load in the arms
      if (P.aiming) sp *= 0.55;
      if (P.charging) sp *= 0.6;
      if (P.atk) sp *= 0.4;
      if (P.parry) sp *= 0.5;
      vx = mx * sp; vz = mz * sp;
      if (P.pace) { vx *= P.pace; vz *= P.pace; sp *= P.pace; }   // an add-on working with the hands slows the walk
      if (!P.atk && !P.aiming && !P.charging && !P.parry) P.faceTarget = Math.atan2(mx, mz);
    }
    P.mvx = vx; P.mvz = vz;
    const a = P.atk;
    if (a && a.lunge && !a.blocked) {                    // each strike steps into the target
      const k = a.t / a.dur;
      if (k < 0.5) { const l = a.lunge * (1 - k * 2); vx += Math.sin(P.face) * l; vz += Math.cos(P.face) * l; }
    }
  }
  if (sp > 0 && !busy()) {
    const ahead = heightAt(P.x + (vx / sp) * 0.6, P.z + (vz / sp) * 0.6) - heightAt(P.x, P.z);
    if (ahead > 0.25) { const k = clamp(1 - (ahead - 0.25) * 1.3, 0.25, 1); vx *= k; vz *= k; sp *= k; }
  }
  // Wading, as it is in a real stream. Water slows you by how much of you it has to push through (little at the
  // ankles, a lot at the thighs) and by how hard you are pushing into the current; a deep, fast current pushes you
  // downstream (drag grows with depth and the square of its speed); in still water you hardly feel it at the knee.
  // What it does to the water is drawn, not simulated as a lump: the water piles against your legs, leaves a hollow
  // behind and trails a V wake downstream of you (in the frame of the water going past, so standing in a current
  // makes one as walking through still water does), white water where it runs fast past you, a splash at each step,
  // and rings spreading in still water.
  const sw = rivers && !P.air ? streamWaterAt(P.x, P.z) : null;
  P.wade = sw && sw.depth > 0.04 ? sw.depth : 0;
  const wu = riverWater.uniforms;
  if (P.wade) {
    const d = P.wade, cur = Math.hypot(sw.vx, sw.vz);
    const into = sp > 0.1 ? Math.max(0, -(vx * sw.vx + vz * sw.vz) / sp) : 0;           // walking against the current
    const k = clamp(1 - 0.75 * smoothstep(0.12, 0.85, d) - 0.25 * into * smoothstep(0.2, 0.7, d) * Math.min(1, cur), 0.3, 1);
    vx *= k; vz *= k; sp *= k;
    const drag = 0.35 * smoothstep(0.3, 0.9, d) * Math.min(1.5, cur * cur) * 7 * dt;
    P.kvx += sw.vx * drag; P.kvz += sw.vz * drag;
    const rx = sw.vx - vx, rz = sw.vz - vz, rel = Math.hypot(rx, rz);
    // the legs, moving through the water (relative to it): the fine wave simulation makes their bow waves, troughs
    // and wake; without it, a drawn bow wave and hollow stand in
    const fine = rippleSim.available && riverLive.on;
    if (fine) {
      const sx = Math.cos(P.face) * 0.1, sz = -Math.sin(P.face) * 0.1, k = clamp(d / 0.3, 0.4, 1.5);
      rippleSim.mover(0, P.x + sx, P.z + sz, 0.07, -rx, -rz, k); rippleSim.mover(1, P.x - sx, P.z - sz, 0.07, -rx, -rz, k);
      wu.uWakeK.value.y = 0;
    } else { wu.uWake.value.set(P.x, P.z, rx, rz); wu.uWakeK.value.set(clamp(d / 0.35, 0.35, 1.6), 1); }
    riverLive.froth(0, P.x, P.z, 0.3, 0.7 * smoothstep(0.25, 1.1, rel));
    // the wake: rings dropped as you go, carried off by the current; together they spread into a V behind you
    P.ringT = (P.ringT || 0) - dt;
    if (P.ringT <= 0 && !fine) {
      P.ringT = rel > 0.25 ? clamp(0.06 / rel, 0.08, 0.2) : 1.1;
      // heading of the legs through the water (against the current going past them)
      const hx = rel > 0.25 ? -rx / rel : 0, hz = rel > 0.25 ? -rz / rel : 0;
      waterFx.ripple(P.x, P.z, (rel > 0.25 ? clamp(0.25 + 0.35 * rel, 0.25, 0.6) : 0.15) * Math.min(1, d * 3), sw.vx, sw.vz, hx, hz);
    }
    P.splashT = (P.splashT || 0) - dt;
    if (P.splashT <= 0 && sp > 0.5) {
      const wy = heightAt(P.x, P.z) + d, side = (P.stepSide = -(P.stepSide || 1)) * 0.12;
      P.splashT = clamp(0.62 / sp, 0.12, 0.4) * 1.6;
      const fx2 = P.x + Math.cos(P.face) * side, fz2 = P.z - Math.sin(P.face) * side;
      waterFx.splash(fx2, wy, fz2, sp * Math.min(1, d * 3), vx, vz, !fine);
      if (fine) rippleSim.drop(fx2 + vx * 0.08, fz2 + vz * 0.08, 0.09, 0.5 + 0.25 * sp);
    }
  } else wu.uWakeK.value.y = 0;
  if (P.climbY != null) { vx = vz = 0; P.kvx = P.kvz = 0; }       // on a ladder (set by the construction add-on): it places the player
  P.x += (vx + P.kvx) * dt; P.z += (vz + P.kvz) * dt;
  P.kvx *= Math.exp(-7 * dt); P.kvz *= Math.exp(-7 * dt);
  pushOut(P, 0.28);
  const gh = groundAt(P.x, P.z, P.y);
  // climbY: on a ladder, placed by an add-on. standY: on a platform an add-on keeps you on (scaffold planks): you walk, it holds the height
  const ty = P.climbY != null ? P.climbY : P.standY != null ? P.standY : Math.max(gh, waveHeight(P.x, P.z) - 0.95);
  if (P.air) {
    P.vy -= 21 * dt; P.y += P.vy * dt;
    if (P.y <= ty) { P.y = ty; P.air = false; P.vy = 0; P.jumps = 0; }
  } else P.y = lerp(P.y, ty, 1 - Math.exp(-18 * dt));
  P.speed = sp;
  P.walk += sp * dt * 1.9;

  // terrain tools work on the spot just ahead
  ring.visible = false; P.digging = false;
  if (!armed && TOOLS.includes(P.tool) && cursor.valid) {     // only the terrain tools: the garden and yard stances work by hand
    ring.visible = true;
    ring.position.set(cursor.x, cursor.y + 0.25, cursor.z);
    ring.material.opacity = 0.85;
    if (mouse.left && !busy()) {
      P.faceTarget = yawF;
      applyBrush(cursor.x, cursor.z, P.tool, dt, P.levelTarget);
      if (Math.random() < dt * 22) burst(cursor.x + (Math.random() - 0.5) * 3, cursor.y + 0.2, cursor.z + (Math.random() - 0.5) * 3, 2, 0x6b4f35, 1.6, 3, 0.11, 0.6);
      P.digging = true;
    }
  }
  // ---- weapons
  const canAct = armed && !busy() && !swimming;
  if (canAct && P.aiming) {
    P.faceTarget = yawF; P.tap = 0; P.holdT = 0;
    if (mouse.click > 0 && charge >= 0.15) {
      if (alt) {
        if (P.shotCd <= 0 && P.stam >= 10) { for (const o of [-0.075, 0, 0.075]) fireArrow(o, charge); P.shotCd = 3; spendStam(14); P.draw = -0.15; }
      } else if (P.stam >= 3) { fireArrow(0, charge); spendStam(5); P.draw = -0.12; }
      mouse.click = 0;
    }
  } else {
    // a short press is a tap, a longer one is a wind-up
    if (mouse.left) P.holdT += dt;
    else { if ((P.holdT > 0 && P.holdT < 0.15) || (P.holdT === 0 && mouse.click > 0)) P.tap = 0.3; P.holdT = 0; mouse.click = 0; }
    if (canAct) {
      const free = !P.atk && !P.parry && P.comboLock <= 0;
      const recovering = P.atk && (P.atk.kind === 'thrust' || P.atk.kind === 'swing') && P.atk.t / P.atk.dur > 0.62;
      if (wantParry && !P.parry && P.stam >= 6 && (!P.atk || recovering)) {
        P.parry = { t: 0 }; P.atk = null; P.charging = null; spendStam(8); faceCamera();
      } else if (wantKick && free && !P.charging && !P.air && P.stam >= 8) {
        faceCamera(); P.atk = { kind: 'kick', t: 0, dur: 0.36, done: false }; spendStam(10);
      } else if (P.air && P.tap > 0 && free && !P.charging && P.y - gh > 0.9 && P.stam >= 8) {
        faceCamera(); P.atk = { kind: 'plunge', t: 0, dur: 9, seen: new Set(), dmg: 20, post: 40, heavy: true, crit: false, hitAny: false };
        P.vy = -17; spendStam(12); P.tap = 0;
      } else if (alt && P.tap > 0 && free) {
        if (P.dashCd <= 0 && P.stam >= 12) { P.dash = { t: 0, dx: fwx, dz: fwz, hit: new Set() }; P.dashCd = 2.5; spendStam(22); P.charging = null; faceCamera(); }
        P.tap = 0;
      } else if (free && !P.charging) {
        if (mouse.left && P.holdT >= 0.15 && P.stam > 6) P.charging = { t: 0.15, full: false };
        else if (P.tap > 0 && P.stam > 3) { startThrust(); P.tap = 0; }
      }
    }
    if (P.charging) {
      const c = P.charging; c.t += dt; P.faceTarget = yawF;
      if (c.t >= 0.9 && !c.full) { c.full = true; burst(P.x, P.y + 1.1, P.z, 8, 0xffd45a, 2, 2, 0.07, 0.4); }
      if (!mouse.left || c.t > 1.8) { P.charging = null; if (canAct && P.stam > 3) startSwing(clamp((c.t - 0.15) / 0.75, 0, 1)); }
    }
  }
  if (P.atk) {
    const a = P.atk; a.t += dt;
    const k = a.t / a.dur;
    if (a.kind === 'thrust') {
      if (!a.done && k >= 0.4) { a.done = true; const fx = Math.sin(P.face), fz = Math.cos(P.face); bladePass(a, (x, z, r) => arcHit(P.x, P.z, fx, fz, a.reach, Math.cos(a.half), x, z, r)); showTrail('stab', a.crit); }
    } else if (a.kind === 'swing') {
      P.faceTarget = yawF;                               // the arc follows the camera while it travels
      if (k >= 0.22 && !a.done) {
        const s = clamp((k - 0.22) / 0.4, 0, 1), ang = a.side * lerp(-a.half, a.half, s);
        bladePass(a, sweepTest(P.x, P.z, P.face, a.ang, ang, a.reach));
        a.ang = ang; if (s >= 1) a.done = true;
        trails.blade.rotation.y = ang; trails.blade.scale.setScalar(a.reach / 2.3);
        if (trails.cur && trails.cur !== trails.blade) trails.cur.visible = false;
        trails.cur = trails.blade; trails.blade.visible = true; trails.t = 0.14; trails.peak = a.heavy ? 0.9 : 0.6;
        trails.blade.material.color.setHex(a.crit || a.heavy ? 0xffd45a : 0xfff3c9);
      }
    } else if (a.kind === 'kick') {
      if (!a.done && k >= 0.4) { a.done = true; kickHit(); }
    } else if (a.kind === 'plunge' && !P.air) {          // landing
      bladePass(a, (x, z, r) => Math.hypot(x - P.x, z - P.z) < 2.3 + r);
      burst(P.x, P.y + 0.2, P.z, 16, 0xd8d2b0, 4, 2.5, 0.12, 0.6); cam.shake = Math.min(cam.shake + 0.25, 0.5);
      P.atk = null; P.comboLock = 0.3;
    }
    if (P.atk && a.kind !== 'plunge' && k >= 1) {
      P.atk = null;
      if (a.kind === 'swing') { P.nextSide = -a.side; P.comboLock = a.heavy && !a.hitAny ? 0.32 : 0.04; }   // a big miss leaves you off balance
      else P.comboLock = 0.04;
    }
  }
  if (P.parry) { P.parry.t += dt; if (P.parry.t >= 0.45) P.parry = null; }
  mouse.click = Math.max(0, mouse.click - dt);
  if (P.faceHold != null) P.faceTarget = P.faceHold;     // the hands add-on turns the character to what it is reaching for
  let df = P.faceTarget - P.face;
  df = Math.atan2(Math.sin(df), Math.cos(df));
  P.face += df * (1 - Math.exp(-(P.aiming || (P.atk && P.atk.kind === 'swing') ? 30 : 16) * dt));

  // pose
  pm.root.position.set(P.x, P.y, P.z);
  pm.root.rotation.y = P.face;
  const stride = Math.sin(P.walk) * clamp(sp / 5, 0, 1) * 0.8;
  let legL = P.air ? 0.7 : stride, legR = P.air ? -0.4 : -stride;
  let armL = -stride * 0.8, armR = stride * 0.8, twist = 0, lean = 0, pullR = 0;
  pm.body.position.y = swimming ? -0.1 : Math.abs(Math.sin(P.walk)) * 0.05 * clamp(sp / 5, 0, 1);
  pm.body.scale.setScalar(1);
  if (P.roll) {
    const k = P.roll.t / 0.42;
    lean = k * Math.PI * 2;
    pm.body.position.y = 0.55 - 0.55 * Math.cos(k * Math.PI * 2) * 0.6;
    pm.body.scale.setScalar(0.85);
  } else if (P.dash) { lean = 0.5; armL = armR = -1.4; }
  else if (P.atk) {
    const a = P.atk, k = a.t / a.dur;
    if (a.kind === 'thrust') { const th = Math.sin(clamp(k, 0, 1) * Math.PI); armL = armR = -1.5 * th; lean = 0.3 * th; }
    else if (a.kind === 'swing') { armL = armR = -1.5; twist = k < 0.22 ? -a.side * a.half * 0.8 : a.ang * 0.8; lean = 0.12; }
    else if (a.kind === 'kick') { legR = -1.5 * Math.sin(clamp(k, 0, 1) * Math.PI); lean = -0.2; }
    else { armL = armR = -2.8; lean = 0.5; }
  } else if (P.charging) {                                // coiled toward the side the swing will start from
    const k = Math.min(1, P.charging.t / 0.6);
    armL = armR = -1.5 * k; twist = -P.nextSide * 1.15 * k; lean = -0.1 * k;
  } else if (P.parry) { const up = P.parry.t < 0.24 ? 1 : 1 - (P.parry.t - 0.24) / 0.21; armL = armR = -1.25 * up; lean = -0.08 * up; }
  else if (P.aiming) { armL = -1.55; armR = -1.5; twist = 0.45; pullR = charge; }
  else if (P.digging) armR = -1.2 + Math.sin(U.time.value * 14) * 0.5;
  else if (P.work) {                                      // set by add-ons: hammering (phase 0..1 of a blow), lifting, carrying
    if (P.work.kind === 'hammer') { armR = -2.3 + 1.7 * P.work.k; lean = 0.1 + 0.12 * P.work.k; }
    else if (P.work.kind === 'lift') { armL = armR = -2.5; lean = -0.12; }
    else if (P.work.kind === 'carry') armR = -2.0 + armR * 0.2;
    else if (P.work.kind === 'saw') { armR = -1.25 + 0.5 * Math.sin(P.work.k * Math.PI * 2); armL = -0.85; lean = 0.38; }
  }
  if (pm.hammer && (pm.hammer[0].visible !== !!P.hammer)) { const h = !!P.hammer; pm.hammer[0].visible = pm.hammer[1].visible = h; pm.hatchet[0].visible = pm.hatchet[1].visible = !h; }
  if (P.handPose) { armL = P.handPose.l; armR = P.handPose.r; lean += P.handPose.lean || 0; }   // hands-on work poses the arms (set by add-ons)
  pm.legL.rotation.x = legL; pm.legR.rotation.x = legR;
  pm.armL.rotation.x = armL; pm.armR.rotation.x = armR;
  pm.armR.position.z = -0.22 * pullR;
  pm.body.rotation.set(lean, twist, 0);
  pm.bow.visible = P.aiming;
  if (window.__game.handPose) window.__game.handPose(pm, P, dt);   // src/engine/hands.js poses the arms and what they hold
  if (trails.cur) {
    trails.t -= dt;
    trails.cur.material.opacity = clamp(trails.t / 0.14, 0, 1) * trails.peak;
    if (trails.t <= 0) { trails.cur.visible = false; trails.cur = null; }
  }
}
function updateShakes(dt) {
  for (let i = world.shakes.length - 1; i >= 0; i--) {
    const tr = world.shakes[i];
    tr.shake -= dt;
    if (tr.shake <= 0) { tr.shake = 0; world.shakes.splice(i, 1); }
    if (tr.alive && world.chunks.get(tr.chunk.key) === tr.chunk) tr.chunk.updateTree(tr);
  }
}
const _proj = new THREE.Vector3();
function updateCamera(dt) {
  if (window.__game?.cooking?.updateCamera(dt)) return;
  if (control.camera(dt, camera)) { afterCamera(cam.dist); return; }   // a possession placed the camera itself
  const k = cam.aimK = lerp(cam.aimK, player.aiming ? 1 : 0, 1 - Math.exp(-11 * dt));
  const follow = 1 - Math.exp(-lerp(9, 24, k) * dt);
  const f = control.follow();     // the player, or what a possession wants followed, plus its look-ahead
  cam.tx = lerp(cam.tx, f.x, follow); cam.tz = lerp(cam.tz, f.z, follow);
  cam.ty = lerp(cam.ty, f.y + 1.0, 1 - Math.exp(-lerp(5, 18, k) * dt));
  cam.shake = Math.max(0, cam.shake - dt * 1.6);
  const sh = cam.shake * cam.shake * 1.6 * (1 - 0.6 * k);
  // exploring: high above. Bow drawn: down behind the right shoulder.
  const dist = lerp(cam.dist * control.rig.distK, 4.4, k), pitch = lerp(control.rig.pitch(cam.pitch), cam.aimPitch, k);
  const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  const tx = cam.tx + rx * 0.8 * k, ty = cam.ty + 0.75 * k, tz = cam.tz + rz * 0.8 * k;
  const cp = Math.cos(pitch), spn = Math.sin(pitch);
  camera.position.set(
    tx + Math.sin(cam.yaw) * cp * dist + (Math.random() - 0.5) * sh,
    ty + spn * dist + (Math.random() - 0.5) * sh,
    tz + Math.cos(cam.yaw) * cp * dist);
  const floor = Math.max(heightAt(camera.position.x, camera.position.z), SEA) + lerp(1.5, 0.95, k);
  if (camera.position.y < floor) camera.position.y = floor;
  camera.lookAt(tx, ty, tz);
  const fov = lerp(control.rig.fov(40), 52, k);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
  afterCamera(dist);
}
// what follows the camera every frame, however it was placed: fog, the see-through fade, the water patch
function afterCamera(dist) {
  // the distance haze. Past the loaded world the far land (src/far-land.js) carries the view on to the horizon, so
  // on a clear, dry day the air only softens the distance (a fifth of the way to the sky's colour by 350 m); humid,
  // misty or overcast air closes in, to a real mist in the worst of it
  const wxf = sim.state.sys.weather;
  const clearAir = wxf ? clamp(1 - 1.1 * smoothstep(0.35, 0.95, wxf.cloud) - 0.8 * smoothstep(0.85, 0.99, wxf.humidity), 0, 1) : 0.5;
  if (LOOK.farLand) { scene.fog.near = lerp(20, 60, clearAir); scene.fog.far = lerp(330, 1100, clearAir * clearAir) * HAZE[LOOK.haze]; }
  else { scene.fog.near = lerp(lerp(cam.dist + 16, cam.dist + 52, clearAir), lerp(28, 60, clearAir), cam.aimK); scene.fog.far = lerp(cam.dist + 96, 122, cam.aimK); }   // the old wall at the world's edge
  // screen position of the player, for the see-through fade on trees
  const size = renderer.getDrawingBufferSize(_v2);
  if (viaComposer()) size.multiplyScalar(renderScale());     // the scene is drawn at render resolution
  _proj.set(player.x, player.y + 0.9, player.z).project(camera);
  U.playerPx.value.set((_proj.x * 0.5 + 0.5) * size.x, (_proj.y * 0.5 + 0.5) * size.y);
  _proj.set(player.x, player.y + 0.9, player.z).applyMatrix4(camera.matrixWorldInverse);
  U.playerDepth.value = -_proj.z;
  U.fadeR.value = Math.min(size.y * 0.1 * (31 / dist), size.y * 0.24);
  water.position.x = Math.round(player.x / 8) * 8; water.position.z = Math.round(player.z / 8) * 8;
}

const hudState = { hp: -1, st: -1, mode: '', hurt: -1, armed: null, k1: '', k2: '', ret: null, retScale: -1, retCls: '', combo: '' };
function updateHud() {
  const P = player, hs = hudState;
  const hp = Math.round(P.hp), st = Math.round(P.stam);
  if (hp !== hs.hp) { el('hpbar').style.width = hp + '%'; hs.hp = hp; }
  if (st !== hs.st) { el('stbar').style.width = st + '%'; hs.st = st; }
  const mode = P.aiming ? 'B' : (P.charging || (P.atk && P.atk.kind === 'swing')) ? 'S' : P.parry ? 'P' : (P.atk && P.atk.kind === 'kick') ? 'K' : (P.atk && P.atk.kind === 'thrust') ? 'T' : '';
  if (mode !== hs.mode) {
    for (const c of document.querySelectorAll('#stance [data-w]')) c.setAttribute('aria-current', c.dataset.w === mode ? 'true' : 'false');
    hs.mode = mode;
  }
  const k1 = P.dashCd > 0 ? 'Alt: dash strike ' + P.dashCd.toFixed(1) : 'Alt: dash strike';
  const k2 = P.shotCd > 0 ? 'Alt: triple shot ' + P.shotCd.toFixed(1) : 'Alt: triple shot';
  if (k1 !== hs.k1) { const c = el('k1'); c.textContent = k1; c.classList.toggle('cool', P.dashCd > 0); hs.k1 = k1; }
  if (k2 !== hs.k2) { const c = el('k2'); c.textContent = k2; c.classList.toggle('cool', P.shotCd > 0); hs.k2 = k2; }
  const armed = P.tool === 'axe';
  if (armed !== hs.armed) { el('stance').hidden = !armed; hs.armed = armed; }
  const h = Math.round(Math.min(1, P.hurt * 2.2) * 20) / 20;
  if (h !== hs.hurt) { el('hurt').style.opacity = String(h); hs.hurt = h; }
  const show = cam.aimK > 0.35;
  if (show !== hs.ret) { el('reticle').hidden = !show; hs.ret = show; }
  if (show) {
    const sc = Math.round(lerp(2.6, 1, P.charge) * 20) / 20, cls = (P.charge >= 1 ? 'full ' : '') + (juice.onEnemy ? 'on' : '');
    if (sc !== hs.retScale) { el('reticle').style.transform = 'translate(-50%, -50%) scale(' + sc + ')'; hs.retScale = sc; }
    if (cls !== hs.retCls) { el('reticle').className = cls; hs.retCls = cls; }
  }
  const combo = P.comboShow > 0 ? P.comboLabel : '';
  if (combo !== hs.combo) { el('combo').textContent = combo; hs.combo = combo; }
}
let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 60, slowFor = 0, autoDropped = false;
const stepHooks = [];
let reliefFn = null;   // (x, z) -> metres of hand-shaped ground above the terrain, set by the landscape view
function step(dt) {
  U.time.value += dt;
  if (dt > 0) { const dy = Math.atan2(Math.sin(cam.yaw - cam.prevYaw), Math.cos(cam.yaw - cam.prevYaw)); cam.yawRate = lerp(cam.yawRate, dy / dt, 0.3); cam.prevYaw = cam.yaw; }
  if (!window.__game?.cooking?.active && juice.lockFailed && !locked() && mouse.inside && player.tool !== 'build') {     // no pointer capture: steer by pushing toward the screen edge
    const ax = Math.abs(mouse.x);
    if (ax > 0.18) cam.yaw -= Math.sign(mouse.x) * ((ax - 0.18) / 0.82) * 2.8 * dt;
    cam.aimPitch = clamp(0.25 - mouse.y * 0.5, -0.28, 0.9);
  }
  // Refresh geometry before a tick or save can read the headless site.
  syncSite();
  sim.advance(dt * WORLD_SECONDS_PER_REAL_SECOND * (keys.KeyT ? Math.max(simCtl.speed, 100) : simCtl.speed), 24);
  flushChunkRefresh();
  simCtl.saveT += dt;
  if (simCtl.saveT > 20) { simCtl.saveT = 0; saveGame(); }
  chunkStream.update(player.x, player.z, 5); farLand.update(player.x, player.z);
  updatePlayer(dt);
  updateEnemies(dt);
  updateShakes(dt);
  updateFallers(dt);
  updateLogs(dt);
  updatePickups(dt);
  updateParticles(dt);
  if (window.__game?.cooking) window.__game.cooking.update(dt);
  updateCamera(dt);
  updateDepthMap(dt);
  updateStreams(dt);
  updateAim();
  updateArrows(dt);
  updateMotes();
  updateSky();
  if (window.__build) window.__build.update(dt);
  for (let i = 0; i < stepHooks.length; i++) stepHooks[i](dt);    // add-ons that must move with the world (construction)
  // grass only near the player, thinning toward the edge of its reach (the thinning itself happens in the shader)
  const G = gfx();
  // far grass: Simplified uses the preset's distances; Aggressive drops cards from 12 m, thins to a quarter of the
  // tufts between 18 and 46 m (each tuft at its own distance, so there is no line) and stops grass at 56 m
  const fg = LOOK.farGrass, aggr = fg === 'aggressive';
  const thin = aggr ? [18, 46, 0.25] : G.thin, cards = fg === 'off' ? null : aggr ? [12, 22] : G.cards;
  const reach = aggr ? Math.min(G.grassR, 56) : G.grassR;
  U.grassLod.value.set(player.x, player.z, thin ? thin[0] : 1e5, thin ? thin[1] : 2e5);
  U.grassMin.value = thin ? thin[2] : 1;
  if (cards) U.grassCards.value.set(cards[0], cards[1]); else U.grassCards.value.set(1e5, 2e5);
  for (const c of world.chunks.values()) {
    const near = Math.hypot(c.ox + CS / 2 - player.x, c.oz + CS / 2 - player.z) < reach;
    if (c.grassMesh) { c.grassMesh.visible = near; c.grassMesh.count = Math.ceil(c.grass.length * G.grassCount); }
    if (c.flowerMesh) c.flowerMesh.visible = near;
    if (c.litter) c.litter.visible = near;
  }
}
// Auto resolution: once a second, compare the GPU's frame time (or, without a GPU timer, the frame interval) with
// the budget for the target frame rate, and move the render scale toward what fits: down quickly when over budget
// (time goes roughly with pixel count, the square of the scale), back up in small steps when there is room.
const autoRes = { t: 0, changed: 0 };
function autoResolution(now) {
  const on = quality.scale === 'auto' && viaComposer() && !perf.busy;
  perf.setLive((on || (window.__gfxPanel && window.__gfxPanel.open)) && !perf.busy);
  if (!on || now - autoRes.t < 1000) return;
  autoRes.t = now;
  const m = perf.liveStats(), ms = perf.available ? m.gpu : m.cpu;
  if (!(ms > 0)) return;
  const budget = 1000 / quality.target * (perf.available ? 0.9 : 1);
  let k = quality.autoScale;
  if (ms > budget * 1.03) k = Math.max(0.6, k * Math.max(0.85, Math.sqrt(budget / ms)));
  else if (now - autoRes.changed > 3000 && (perf.available ? ms < budget * 0.78 : ms <= budget * 1.01)) k = Math.min(1, k + 0.04);
  k = Math.round(k * 50) / 50;
  if (Math.abs(k - quality.autoScale) >= 0.02 && now - autoRes.changed > 1500) {
    quality.autoScale = k; autoRes.changed = now; resize(); perf.resetLive();
    if (window.__gfxPanel) window.__gfxPanel.refresh();
  }
}
function render() {
  processShade();
  // the stream mirror, drawn from the camera as it is for this frame
  if (probeAt && reflectPlane.on) reflectPlane.update(camera, updateMirrorLevel(lastDt, probeAt.level), player.x, player.z);
  if (probeAt && reflectPlane2.on && step2.level !== null) reflectPlane2.update(camera, step2.level, step2.x, step2.z);
  if (viaComposer()) {
    const useTaa = LOOK.taa;
    if (useTaa) taa.begin(composer.renderTarget1.width, composer.renderTarget1.height);
    composer.renderToScreen = !upscaler.on;            // when upscaling, the composer finishes into its own buffer
    composer.render();
    if (useTaa) { taa.end(); taa.resolve(composer.readBuffer); } else if (upscaler.on) upscaler.draw(composer.readBuffer);
  } else renderer.render(scene, camera);
}

// ============================================================ GPU timing and benchmark
// Run __game.bench() in the console. For about ten seconds it times how long the GPU spends on each frame
// (vsync doesn't hide it, unlike fps), first with everything on and then with each system switched off in turn,
// and prints what each one costs. Stand somewhere typical, a meadow with trees in view, and leave the controls
// alone while it runs. With EXT_disjoint_timer_query_webgl2 (Chrome and Edge on desktop) it reads the GPU's own
// timer. Without it (Safari, Firefox) frame intervals are all it can see, and vsync pins those to the refresh rate,
// so it draws each frame several times over until a frame no longer fits in one refresh and divides by the count.
// That number is the CPU and GPU cost of drawing a frame together, whichever is the slower.
// At 144 fps the whole frame has to fit in 6.9 ms.
const perf = (() => {
  const gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending = [], gpu = [], cpu = [];
  let collecting = false, lastT = 0, calls = 0, tris = 0, repeat = 1, live = false, liveT = 0;
  const liveGpu = [], liveCpu = [];
  function timed(fn) {
    if (!collecting && live) {                          // Auto resolution: time every frame, cheaply
      const now = performance.now();
      if (liveT) { liveCpu.push(now - liveT); if (liveCpu.length > 240) liveCpu.shift(); }
      liveT = now;
      let q = null;
      if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
      fn();
      if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); }
      return;
    }
    if (!collecting) { fn(); return; }
    const now = performance.now();
    if (lastT) cpu.push(now - lastT);
    lastT = now;
    renderer.info.autoReset = false; renderer.info.reset();
    let q = null;
    if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
    fn();
    calls = renderer.info.render.calls; tris = renderer.info.render.triangles;
    for (let i = 1; i < repeat; i++) fn();              // no GPU timer: draw the frame again to get past vsync
    if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); }
    renderer.info.autoReset = true;
  }
  function poll() {
    if (!ext || !pending.length) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = pending.shift();
      if (!disjoint) {
        const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        if (collecting) gpu.push(ms); else { liveGpu.push(ms); if (liveGpu.length > 240) liveGpu.shift(); }
      }
      gl.deleteQuery(q);
    }
  }
  const frames = (n) => new Promise((done) => { let k = 0; const f = () => (++k >= n ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const median = (a) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
  async function measure(warm = 45, n = ext ? 150 : 60) {
    collecting = true; lastT = 0;
    await frames(warm);                                 // let shaders compile and the GPU settle
    gpu.length = cpu.length = 0;
    await frames(n);
    collecting = false;
    await frames(8); poll();                           // collect the last query results
    return { gpu: median(gpu), cpu: median(cpu), calls, tris };
  }
  // No GPU timer: find how many draws per frame it takes for the frame time to clearly pass the refresh interval.
  async function calibrate() {
    repeat = 1;
    const refresh = (await measure(30, 60)).cpu;
    for (repeat = 2; repeat <= 32; repeat *= 2) {
      setMsg(`Benchmarking: calibrating (${repeat} draws per frame). Hands off.`);
      if ((await measure(15, 40)).cpu > refresh * 1.8) return { refresh, ok: true };
    }
    repeat = 32;
    return { refresh, ok: false };
  }
  const hide = (m) => { const was = m.visible; m.visible = false; return () => { m.visible = was; }; };
  const TESTS = [
    ['everything on', () => () => {}],
    ['grass + flowers off', () => hide(grassMat)],
    ['trees + logs off', () => hide(treeMat)],         // also takes them out of the shadow map
    ['terrain off', () => hide(terrainMat)],
    ['water off', () => { water.visible = false; return () => { water.visible = true; }; }],
    ['shadow-map pass off', () => { renderer.shadowMap.autoUpdate = false; return () => { renderer.shadowMap.autoUpdate = true; }; }],
    ['bloom off', () => { if (!bloom || quality.level !== 'high') return null; const was = bloom.enabled; bloom.enabled = false; return () => { bloom.enabled = was; }; }],
    ['extra AO off', () => { if (!ao) return null; ao.enabled = false; return () => { ao.enabled = true; }; }],
    ['compact HDR buffers on', () => { if (LOOK.compactHdr || !compactHdrOK || quality.level !== 'high') return null; setLook('compactHdr', true); return () => setLook('compactHdr', false); }],
    ['draw order off', () => { if (!LOOK.drawOrder) return null; setLook('drawOrder', false); return () => setLook('drawOrder', true); }],
    ['grass clumps, backlight, sheen, far blend off', () => { const v = U.grassLook.value, was = v.clone(); if (!v.x && !v.y && !v.z && !v.w) return null; v.set(0, 0, 0, 0); return () => v.copy(was); }],
    ['TAAU on (MSAA off)', () => { if (LOOK.taa || quality.level !== 'high') return null; setLook('taa', true); return () => setLook('taa', false); }],
    ['FSR 1 upscaler', () => { const was = LOOK.upscaler; if (was === 'fsr' || !upscaler.on || renderScale() > 0.999) return null; LOOK.upscaler = 'fsr'; return () => { LOOK.upscaler = was; }; }],
    ['far grass at full detail', () => { const was = LOOK.farGrass; if (was === 'off') return null; setLook('farGrass', 'off'); return () => setLook('farGrass', was); }],
    // your fx pass (src/fxpost.js): the whole pass, then its heavier parts one at a time
    ...(() => {
      const fx = () => window.__game && window.__game.fx, on = () => !!(fx() && window.__fxInfo && __fxInfo().pass && quality.level === 'high');
      const cfgOff = (key) => () => { if (!on()) return null; const c = fx().cfg, was = c[key]; c[key] = 0; return () => { c[key] = was; }; };
      return [
        ['fx pass off', () => {
          if (!on()) return null;
          const relight = fx().cfg.relight;
          fx().setLighting('off');
          return () => fx().setLighting(relight ? 'full' : 'no relight');
        }],
        ['fx AO + bounce off', cfgOff('ao')],
        ['fx depth of field off', cfgOff('dof')],
        ['fx sun shafts off', cfgOff('shafts')],
      ];
    })(),
    ['MSAA off', () => {
      if (quality.level !== 'high' || !msaaSamples()) return null;
      quality.msaaOverride = 0; syncComposer();
      return () => { quality.msaaOverride = null; syncComposer(); };
    }],
  ];
  let running = false;
  async function bench() {
    if (running) return null;
    running = true;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const head = `${gl.getParameter(gl.RENDERER)} | ${size.x}x${size.y} | ${gfx().label}, MSAA ${msaaSamples()}x, ` +
      `shadows ${gfx().shadows} ${gfx().shadowSize}, resolution ${quality.scale === 'auto' ? 'auto, now ' : ''}${Math.round(renderScale() * 100)}%`;
    const rows = [];
    let base = null, method = 'GPU timer';
    try {
      if (!ext) {
        const c = await calibrate();
        method = `no GPU timer in this browser: frame drawn ${repeat}x and timed (CPU+GPU), refresh interval ${c.refresh.toFixed(2)} ms` +
          (c.ok ? '' : '. WARNING: could not get past vsync even at 32x, so these numbers are not reliable');
      }
      for (let i = 0; i < TESTS.length; i++) {
        const [name, setup] = TESTS[i];
        setMsg(`Benchmarking ${i + 1}/${TESTS.length}: ${name}. Hands off for a few seconds.`);
        const undo = setup();
        if (!undo) continue;                             // not running in this preset
        let r;
        try { r = await measure(); } finally { undo(); }
        const ms = ext ? r.gpu : r.cpu / repeat;
        if (!base) base = ms;
        rows.push({ test: name, 'frame ms': +ms.toFixed(2), 'saves ms': i ? +(base - ms).toFixed(2) : '', 'draw calls': r.calls, triangles: r.tris });
      }
    } finally { setMsg(''); running = false; repeat = 1; }
    console.log('%cBenchmark ' + head + '\n' + method, 'font-weight:bold');
    console.table(rows);
    const text = head + '\n' + method + '\n' + rows.map((r) => `${r.test}: ${r['frame ms']} ms` + (r['saves ms'] !== '' ? ` (saves ${r['saves ms']})` : '') + `, ${r['draw calls']} calls, ${r.triangles} tris`).join('\n');
    console.log(text);                                  // plain text, easy to copy and paste
    return { head, method, rows, text };
  }
  return {
    timed, poll, bench, get available() { return !!ext; }, get busy() { return running; },
    setLive(on) { if (on !== live) { live = on; liveT = 0; liveGpu.length = liveCpu.length = 0; } },
    liveStats() { return { gpu: median(liveGpu.slice(-120)), cpu: median(liveCpu.slice(-120)) }; },
    resetLive() { liveGpu.length = liveCpu.length = 0; liveT = 0; },
    js: [],                                              // main-thread milliseconds per frame (update + draw calls)
  };
})();
function frame(now) {
  const raw = (now - last) / 1000; last = now;
  let dt = clamp(raw, 0, 0.05);     // the first frame's timestamp can precede start-up, so never step backwards
  if (juice.hitStop > 0) { juice.hitStop -= raw; dt *= 0.06; }   // a few frames of freeze when a hit lands
  const t0 = performance.now();
  step(dt);
  perf.timed(render);
  perf.js.push(performance.now() - t0); if (perf.js.length > 120) perf.js.shift();
  perf.poll();
  updateHud();
  fpsAcc += raw; fpsN++;
  if (fpsAcc >= 0.5) {
    fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
    el('fps').textContent = String(Math.round(fps));
    el('clock').textContent = clock();
    el('day').textContent = String(sim.day());
    // a machine that can't keep up steps down one preset at a time (not saved, so the player's choice comes back
    // next visit). The pause after each step lets the shaders recompile without counting as slowness.
    autoResolution(now);
    if (window.__gfxPanel && window.__gfxPanel.open) {
      const js = [...perf.js].sort((a, b) => a - b)[perf.js.length >> 1] || 0;
      window.__gfxPanel.stats({ fps, gpu: perf.liveStats().gpu, js });
    }
    slowFor = fps < 27 ? slowFor + 0.5 : 0;
    if (slowFor >= 3 && quality.preset !== 'low' && !autoDropped) {
      setQuality(GFX_ORDER[GFX_ORDER.indexOf(quality.preset) + 1]);
      slowFor = -4;
    }
    hudDirty = true;
  }
  if (hudDirty) {
    el('wood').textContent = String(world.wood);
    el('stone').textContent = String(world.stone);
    el('kills').textContent = String(world.kills);
    el('money').textContent = '$' + Math.round(stockState().money).toLocaleString('en-US');
    hudDirty = false;
  }
  requestAnimationFrame(frame);
}

window.addEventListener('error', (e) => {
  const b = el('err'); b.textContent = 'Something went wrong: ' + e.message; b.hidden = false;
});
resize();
applyGfx();
resetWorld(SEED);
setTool('axe');
lockUi();
window.__game = {
  pm, get seed() { return SEED; }, get nightF() { return SKYK.night; },
  stepHooks,
  get sim() { return sim; }, setYearDays: (d) => { sim.setYearDays(d); saveGame(); }, savedBuilds: () => simCtl.builds, powerAvailable: (minW = 1) => powerNear(sim.state, player.x, player.z, 30, minW),
  stock: {
    MATERIALS, ITEMS, ITEM_CATEGORIES, material, unitVolumeM3, rValuePer100mm, stockMassKg, canAfford, toolAvailable,
    get state() { return stockState(); },
    do: (name, payload) => { const r = runStockCommand(sim, name, payload); hudDirty = true; return r; },
  },
  saveGame, saveData: () => saveData(), setSpeed,
  // what a save costs: bytes as stored (earthwork grids packed) and as plain JSON
  saveSize: () => { const d = saveData(true); return { bytes: stringifySave(d).length, plainBytes: JSON.stringify(d).length }; }, get speed() { return simCtl.speed; },
  enemies, spawnEnemy, arrows, fireArrow, MOVES, startMove, juice, updateHud, waveHeight, depthState, lockQuality: () => { autoDropped = true; }, world, player, cam, keys, mouse, cursor, step, render, heightAt, fellTree, applyBrush, setQuality, renderer, THREE,
  taa, lookFlags: LOOK, get rivers() { return rivers; }, riverWater, riverLive, streamWaterAt, waterFx, get rippleSim() { return rippleSim; }, camera, scene, setTool, fade: addWind, fadeR: U.fadeR, burst, editGet: getDelta, editSet: setDelta, baseHeight, chunkSize: CS, treeKinds: TREE, refreshLock: lockUi, forestAt,
  light: SKY, noise: fbm, palette: PAL, quality: () => quality.level, composer: () => composer,
  graphics: { presets: GFX, get preset() { return quality.preset; }, get scale() { return quality.scale; }, get renderScale() { return renderScale(); }, setRenderScale }, bench: perf.bench,
  // Look switches from the console: __game.look.grassRootShade(0..1), __game.look.toggle('ao' | 'grassShadows' | 'tuftShadow' | 'drawOrder'),
  // __game.look.farGrass('off' | 'normal' | 'aggressive').
  look: {
    get ao() { return ao; },
    // bake the whole sky-visibility map again now; returns how long it took (ms)
    rebakeShade: () => { const t0 = performance.now(); for (const c of world.chunks.values()) { c.skyT = null; markShade(c); } processShade(); return +(performance.now() - t0).toFixed(1); },
    upscaler: (v) => { if (['bicubic', 'sharp', 'fsr'].includes(v)) setLook('upscaler', v); return LOOK.upscaler; },
    toneMap: (v) => { if (['aces', 'agxlook', 'agx', 'neutral'].includes(v)) setLook('toneMap', v); return LOOK.toneMap; },
    // the sky: __game.look.sky({ model: 'physical'|'painted', clouds: 'layered'|'heaped'|'off', night: 'real'|'simple'|'off',
    //   farLand: bool, openSea: bool, haze: 'light'|'normal'|'heavy' }); returns the current settings
    sky: (o = {}) => { const map = { model: 'skyModel', clouds: 'skyClouds', night: 'nightSky', farLand: 'farLand', openSea: 'openSea', haze: 'haze' }; for (const k in o) if (map[k]) setLook(map[k], o[k]); return { model: LOOK.skyModel, clouds: LOOK.skyClouds, night: LOOK.nightSky, farLand: LOOK.farLand, openSea: LOOK.openSea, haze: LOOK.haze }; },
    skyFrame: () => ({ moon: SKYF.moon.toArray(), age: SKYF.age, eqInv: SKYF.eqInv.toArray() }),
    streamReflections: (v) => { if (['probe', 'full', 'simple'].includes(v)) setLook('waterReflect', v); return LOOK.waterReflect; },
    waterStyle: (v) => { if (['smooth', 'fine', 'ground'].includes(v)) setLook('waterTexel', v); return LOOK.waterTexel; },
    farGrass: (v) => { if (['off', 'normal', 'aggressive'].includes(v)) setLook('farGrass', v); return LOOK.farGrass; },
    grassRootShade: (k) => { setLook('rootShade', Math.min(1, Math.max(0, +k || 0))); return LOOK.rootShade; },                // 1 = the original roots, lower lifts the roots only (tips unchanged)
    toggle(what) {
      if (what === 'tuftShadow') { setLook('tuftShadow', !LOOK.tuftShadow); return LOOK.tuftShadow; }
      if (what === 'grassShadows') { setLook('grassShadows', !LOOK.grassShadows); return LOOK.grassShadows; }
      if (what === 'ao' || what === 'drawOrder' || what === 'grassClumps' || what === 'grassBacklight' || what === 'skyShade' || ['sunFog', 'grassSheen', 'farBlend', 'crownShade', 'camFx', 'taa', 'edgeBelts'].includes(what)) { setLook(what, !LOOK[what]); return LOOK[what]; }
      return null;
    },
  },
  treeGeo, pineLite: pineLiteGeo, markStockDirty: () => { hudDirty = true; },
  garden: gardenRead, landscape: landscapeRead, earthwork, vehicleCore,
  // runs through a building's frame (src/sim/core/routefind.js over src/sim/content/frame-channels.js)
  routes: { find: routeFind, channelsFor: (structId) => frameChannelsFor(structId, window.__build), attach: frameAttach, snap: frameSnap, rayHit: frameRayHit },
  // the landscape view's hooks: the ground it shapes is walked on, and shows through the terrain where dug
  setRelief: (fn) => { reliefFn = fn; }, digMask: { win: DIG.uDigWin, enable: enableDigMask },
  handPose: null, sea: SEA,
  // the controller stack (src/engine/control.js), the one ground read and the circle push-out, for vehicles and other bodies
  control, groundAt, pushOut,
  // one ground (src/sim/ground.js): ground.cmd('cut' | 'fill' | 'push' | 'grade' | 'trim' | 'tamp', payload) moves earth;
  // heightAt is the graded ground (base + macro), ground.surfaceAt the walked surface (plus the fine, hand-dug ground)
  ground: {
    read: groundRead,
    cmd: (name, p) => { flushMacro(); return sim.commandNow('ground.' + name, p); },
    surfaceAt: (x, z) => heightAt(x, z) + (reliefFn ? reliefFn(x, z) : 0),
    get rev() { return sim.state.sys.ground ? sim.state.sys.ground.rev : 0; },
    verify: () => { flushMacro(); return verifyGround(); },
  },
  // the sky as reflections see it (world sun direction and colour, horizon and zenith), kept up to date each frame
  skyU: { uGSunDir: waterUniforms.uSunDir, uGSunCol: waterUniforms.uSunCol, uGSky: waterUniforms.uSky, uGZen: waterUniforms.uZenith },
};
window.__game.cooking = createCookingView(window.__game);
requestAnimationFrame(frame);
