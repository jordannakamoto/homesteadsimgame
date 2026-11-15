import * as THREE from 'three';
import { createChunkStream } from './world/chunk-stream.js';
import { createGameSim, mapPieces, runStockCommand, setCounter, stockMassKg, canAfford, toolAvailable, MATERIALS, ITEMS, ITEM_CATEGORIES, material, unitVolumeM3, rValuePer100mm, makeSave, readSave, f32ToBase64, base64ToF32, clockText, SPEEDS, WORLD_SECONDS_PER_REAL_SECOND } from './sim/index.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Safety net for every lit material: a pixel whose colour comes out as "not a number" (from a zero-length normal,
// say) is drawn black instead. Left alone, bloom spreads a single such pixel over the whole screen.
THREE.ShaderChunk.opaque_fragment += '\nif ( isnan( gl_FragColor.r + gl_FragColor.g + gl_FragColor.b ) ) gl_FragColor.rgb = vec3( 0.0 );\n';

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
function baseHeight(x, z) {
  const cont = fbm(x * 0.0022, z * 0.0022, 4);
  const hills = fbm(x * 0.011 + 37, z * 0.011 - 91, 4);
  const detail = fbm(x * 0.06 + 11, z * 0.06 + 5, 2);
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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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

let composer = null, bloom = null;
const quality = { level: 'high' };
function buildComposer() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.7, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}
function resize() {
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  const pr = quality.level === 'high' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(pr); composer.setSize(w, h); }
}
window.addEventListener('resize', resize);

// ============================================================ shared uniforms and materials
const U = {
  time: { value: 0 },
  playerPx: { value: new THREE.Vector2() },
  playerDepth: { value: 0 },
  fadeR: { value: 100 },
};
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

// Wind sway (and optional see-through fade around the player) injected into a Lambert material.
function addWind(mat, y0, yr, amp, fade, upNormal) {
  mat.customProgramCacheKey = () => 'wind' + (fade ? 1 : 0) + (upNormal ? 1 : 0);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.time;
    sh.uniforms.uWind = { value: new THREE.Vector3(y0, yr, amp) };
    sh.uniforms.uPlayerPx = U.playerPx;
    sh.uniforms.uPlayerDepth = U.playerDepth;
    sh.uniforms.uFadeR = U.fadeR;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uWind; varying float vCamDepth;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
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
        gust *= gust;
        float sw = hk * uWind.z * (0.3 + 1.5 * gust);
        float ph = uTime * 1.6 + wp.x * 0.21 + wp.z * 0.17;
        vec2 dw = vec2(0.9 * gust + 0.45 * sin(ph) + 0.2 * sin(ph * 2.3 + 1.7), 0.55 * gust + 0.4 * cos(ph * 0.8) + 0.2 * sin(ph * 1.9)) * sw;
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
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCamDepth = -mvPosition.z;');
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
function makeGrassTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 32;
  const g = c.getContext('2d'); const img = g.createImageData(64, 32); const d = img.data;
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
      for (let px = Math.ceil(x - hw); px <= x + hw; px++) if (px >= 1 && px <= 30) put(px, 31 - y, tone * (0.66 + 0.34 * t));
    }
  }
  for (let k = 0; k < 4; k++) {                        // flowers (right tile)
    const bx = 38 + k * 6 + r() * 2, hgt = 14 + r() * 13;
    for (let y = 0; y < hgt; y++) put(bx + Math.sin(y * 0.3) * 0.6, 31 - y, 0.5);
    const cy = 31 - Math.round(hgt), cx = Math.round(bx);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 2) put(cx + dx, cy + dy, dx === 0 && dy === 0 ? 0.75 : 1);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const grassTex = makeGrassTex();
const grassMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: grassTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
addWind(grassMat, 0.0, 0.6, 0.11, false, true);   // a light breeze: the sward stirs, it does not thrash
function tuftGeo(cards, w, h, u0, u1, lean) {
  const pos = [], nor = [], uv = [], colr = [], idx = [];
  for (let k = 0; k < cards; k++) {
    const a = (k / cards) * Math.PI + 0.3, dx = Math.cos(a), dz = Math.sin(a);
    const lx = -dz * lean * (k - (cards - 1) / 2), lz = dx * lean * (k - (cards - 1) / 2);
    const b = pos.length / 3;
    pos.push(-dx * w / 2, 0, -dz * w / 2, dx * w / 2, 0, dz * w / 2, dx * w * 0.58 + lx, h, dz * w * 0.58 + lz, -dx * w * 0.58 + lx, h, -dz * w * 0.58 + lz);
    uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
    colr.push(0.88, 0.9, 0.84, 0.88, 0.9, 0.84, 1.13, 1.16, 0.98, 1.13, 1.16, 0.98);
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
const grassGeo = tuftGeo(3, 0.8, 0.62, 0.01, 0.49, 0.14);
const flowerGeo = tuftGeo(2, 0.5, 0.7, 0.52, 0.99, 0.0);
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
      if (hb < 1.3 || sl > 1.5 || spawnClear) d = 0;
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
      if (hb < 1.25 || hb > 19) continue;
      const sl = Math.hypot(this.baseLocal(lx + 0.5, lz) - this.baseLocal(lx - 0.5, lz), this.baseLocal(lx, lz + 0.5) - this.baseLocal(lx, lz - 0.5));
      if (sl > 0.72) continue;
      const f = this.forest[Math.round(lz) * N + Math.round(lx)];
      if (f > 0.2 && a < 0.35) continue;
      gs.push({ lx, lz, rot: a * 6.283, s: (0.75 + b * 0.75) * lerp(1.0, 0.8, smoothstep(0, 0.4, f)), sy: 0.8 + a * 0.6, f, hb });
    }
    this.grass = gs;
    if (gs.length) {
      this.grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, gs.length);
      this.grassMesh.receiveShadow = true;
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
      this.flowerMesh.receiveShadow = true;
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
        arm.add(haft, head);
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
  if (e.code === 'KeyG') setQuality(quality.level === 'high' ? 'low' : 'high');
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
// ---- water: depth-tinted, foamy at the shore, waves shared between shader and game logic
const WAVES = [[0.8, 0.6, 17, 0.11, 1.1], [-0.5, 0.86, 11, 0.07, 1.3], [0.95, -0.3, 7, 0.04, 1.6]];
const RIPPLES = [[0.3, 0.95, 3.1, 0.018, 2.0], [-0.9, 0.4, 2.2, 0.012, 2.4], [0.6, -0.8, 1.4, 0.007, 2.9], [-0.2, -0.98, 0.9, 0.004, 3.3]];
function waveHeight(x, z) {
  let h = 0; const t = U.time.value;
  for (const w of WAVES) h += w[3] * Math.sin((x * w[0] + z * w[1]) * (6.2832 / w[2]) + t * w[4]);
  return SEA + h;
}
// Water depth around the player, baked from the terrain heights into a small texture.
// This replaces a depth pre-pass: shore foam and depth colour cost one texture read.
const DM = 256;
const depthData = new Uint8Array(DM * DM);
const depthTex = new THREE.DataTexture(depthData, DM, DM, THREE.RedFormat, THREE.UnsignedByteType);
depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter;
const depthState = { ox: 1e9, oz: 1e9, dirty: true, wait: 0, origin: new THREE.Vector2() };
function updateDepthMap(dt) {
  depthState.wait -= dt;
  const ox = Math.round(player.x / 16) * 16 - DM / 2, oz = Math.round(player.z / 16) * 16 - DM / 2;
  if (ox !== depthState.ox || oz !== depthState.oz) depthState.dirty = true;
  if (!depthState.dirty || depthState.wait > 0) return;
  depthState.dirty = false; depthState.wait = 0.12; depthState.ox = ox; depthState.oz = oz;
  depthData.fill(255);
  for (const c of world.chunks.values()) {
    const i0 = c.ox - ox, j0 = c.oz - oz;
    if (i0 >= DM || j0 >= DM || i0 + CS <= 0 || j0 + CS <= 0) continue;
    for (let lj = 0; lj < CS; lj++) {
      const j = j0 + lj; if (j < 0 || j >= DM) continue;
      for (let li = 0; li < CS; li++) {
        const i = i0 + li; if (i < 0 || i >= DM) continue;
        depthData[j * DM + i] = clamp(((SEA - c.h[(lj + 1) * P + li + 1]) + 1) / 9 * 255, 0, 255);
      }
    }
  }
  depthTex.needsUpdate = true;
  depthState.origin.set(ox, oz);
}
// tileable water detail: RG = wavelet slope, B = ridged noise used for foam and caustics
function makeWaterTex() {
  const S = 256, data = new Uint8Array(S * S * 4), r = mulberry32(911);
  const mk = (n, kmax, pw) => {
    const w = [];
    for (let i = 0; i < n; i++) {
      let kx = 0, ky = 0;
      while (kx === 0 && ky === 0) { kx = Math.round((r() * 2 - 1) * kmax); ky = Math.round((r() * 2 - 1) * kmax); }
      w.push([kx, ky, r() * 6.2832, 1 / Math.pow(Math.hypot(kx, ky), pw)]);
    }
    return w;
  };
  const A = mk(22, 9, 1.1), Bw = mk(16, 7, 0.9);
  const gx = new Float32Array(S * S), gy = new Float32Array(S * S), nn = new Float32Array(S * S);
  let gmax = 0, sq = 0;
  const tw = 6.2832 / S;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let ax = 0, ay = 0, n = 0;
    for (const w of A) { const c = w[3] * Math.cos((w[0] * x + w[1] * y) * tw + w[2]); ax += c * w[0]; ay += c * w[1]; }
    for (const w of Bw) n += w[3] * Math.sin((w[0] * x + w[1] * y) * tw + w[2]);
    const i = y * S + x; gx[i] = ax; gy[i] = ay; nn[i] = n;
    gmax = Math.max(gmax, Math.abs(ax), Math.abs(ay)); sq += n * n;
  }
  const rms = Math.sqrt(sq / (S * S));
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = clamp((gx[i] / gmax) * 127 + 128, 0, 255);
    data[i * 4 + 1] = clamp((gy[i] / gmax) * 127 + 128, 0, 255);
    data[i * 4 + 2] = clamp(1 - Math.abs(nn[i]) / (rms * 1.7), 0, 1) * 255;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
const glslWaves = (list, withHeight) => list.map((w) => {
  const k = (6.2832 / w[2]).toFixed(4);
  return `ph = dot(p, vec2(${w[0].toFixed(3)}, ${w[1].toFixed(3)})) * ${k} + uTime * ${w[4].toFixed(2)};` +
    (withHeight ? ` h += ${w[3].toFixed(4)} * sin(ph);` : ` g += ${(w[3]).toFixed(4)} * ${k} * cos(ph) * vec2(${w[0].toFixed(3)}, ${w[1].toFixed(3)});`);
}).join('\n');
const waterUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
  uTime: { value: 0 }, uDepth: { value: null }, uTex: { value: null }, uDepthOrigin: { value: new THREE.Vector2() },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() },
  uSky: { value: new THREE.Color() }, uZenith: { value: new THREE.Color() }, uShallow: { value: col(0x2fa79c) }, uDeep: { value: col(0x06283f) },
}]);
waterUniforms.uTime = U.time;
waterUniforms.uDepth.value = depthTex;
waterUniforms.uTex.value = makeWaterTex();
waterUniforms.uDepthOrigin.value = depthState.origin;
const water = (() => {
  const g = new THREE.PlaneGeometry(288, 288, 180, 180); g.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: waterUniforms, fog: true, transparent: true, depthWrite: false,
    vertexShader: `
      uniform float uTime; uniform sampler2D uDepth; uniform vec2 uDepthOrigin;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float depth = texture2D(uDepth, (wp.xz - uDepthOrigin + 0.5) / ${DM}.0).r * 9.0 - 1.0;
        vec2 p = wp.xz; float h = 0.0; float ph;
        ${glslWaves(WAVES, true)}
        wp.y += h * (0.2 + 0.8 * smoothstep(0.0, 2.5, depth));
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime; uniform sampler2D uDepth; uniform sampler2D uTex; uniform vec2 uDepthOrigin;
      uniform vec3 uSunDir, uSunCol, uAmb, uSky, uZenith, uShallow, uDeep;
      varying vec3 vWorld;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        float depth = texture2D(uDepth, (vWorld.xz - uDepthOrigin + 0.5) / ${DM}.0).r * 9.0 - 1.0;
        vec2 p = vWorld.xz; vec2 g = vec2(0.0); float ph;
        ${glslWaves(WAVES, false)}
        // three scrolling layers of wavelets, the classic layered-normal-map trick
        vec2 d1 = texture2D(uTex, p * 0.035 + uTime * vec2(0.010, 0.006)).rg - 0.5;
        vec2 d2 = texture2D(uTex, p * 0.083 + uTime * vec2(-0.017, 0.012)).rg - 0.5;
        vec2 d3 = texture2D(uTex, p * 0.21 + uTime * vec2(0.025, -0.03)).rg - 0.5;
        float calm = 0.45 + 0.55 * smoothstep(0.0, 2.0, depth);
        g += (d1 * 0.6 + d2 * 0.42 + d3 * 0.24) * calm;
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        float fres = 0.07 + 0.93 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
        vec3 sky = mix(uSky, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.7));
        float sd = max(dot(R, uSunDir), 0.0);
        vec3 sunR = uSunCol * (pow(sd, 900.0) * 60.0 + pow(sd, 60.0) * 0.9);
        float absorb = 1.0 - exp(-max(depth, 0.0) * 0.8);
        float ndl = max(dot(N, uSunDir), 0.0);
        vec3 lightC = uSunCol * (0.35 + 0.65 * ndl) + uAmb;
        vec3 body = mix(uShallow, uDeep, absorb) * lightC;
        // caustics seen through the shallows
        float ca = texture2D(uTex, p * 0.075 + uTime * vec2(0.02, 0.011) + g * 0.3).b * texture2D(uTex, p * 0.11 - uTime * vec2(0.014, 0.021)).b;
        body += uSunCol * uShallow * pow(ca, 2.0) * 3.0 * (1.0 - absorb) * smoothstep(0.02, 0.5, depth);
        vec3 color = mix(body, sky, fres) + sunR;
        float alpha = max(mix(0.28, 0.985, absorb), fres);
        // lacy shore foam that thickens toward the waterline, plus one drifting line further out
        float fnz = texture2D(uTex, p * 0.14 + uTime * vec2(0.012, 0.02)).b * 0.6 + texture2D(uTex, p * 0.31 - uTime * vec2(0.02, 0.012)).b * 0.4;
        float lap = 0.14 * sin(uTime * 0.8 + p.x * 0.09 + p.y * 0.06);
        float shore = 1.0 - smoothstep(0.0, 0.6 + lap, depth);
        float th = 1.0 - shore * 1.02;
        float foam = smoothstep(th, th + 0.22, fnz) * smoothstep(0.0, 0.08, shore);
        float d0 = 1.1 + 0.45 * sin(uTime * 0.45 + p.x * 0.05);
        foam = max(foam, smoothstep(0.62, 0.9, fnz) * (1.0 - smoothstep(0.0, 0.4, abs(depth - d0))) * 0.65);
        color = mix(color, lightC * 0.92, foam);
        alpha = max(alpha, foam * 0.85) * smoothstep(-0.18, 0.03, depth);
        gl_FragColor = vec4(color, clamp(alpha + dot(sunR, vec3(0.3)), 0.0, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.position.y = SEA; m.frustumCulled = false;
  scene.add(m);
  return m;
})();
const MOTES = 140;
const motes = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
  const mat = new THREE.PointsMaterial({ color: 0xfff6c8, size: 0.16, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  const p = new THREE.Points(g, mat); p.frustumCulled = false;
  scene.add(p);
  const seeds = [];
  const r = mulberry32(7);
  for (let i = 0; i < MOTES; i++) seeds.push([r() * 70, 0.4 + r() * 3.2, r() * 70, r() * 6.283]);
  p.userData.seeds = seeds;
  return p;
})();
function updateMotes() {
  const pos = motes.geometry.attributes.position.array, seeds = motes.userData.seeds, t = U.time.value;
  for (let i = 0; i < MOTES; i++) {
    const s = seeds[i];
    const x = player.x + ((((s[0] + Math.sin(t * 0.3 + s[3]) * 2 - player.x) % 70) + 70) % 70) - 35;
    const z = player.z + ((((s[2] + Math.cos(t * 0.23 + s[3]) * 2 - player.z) % 70) + 70) % 70) - 35;
    pos[i * 3] = x; pos[i * 3 + 2] = z;
    pos[i * 3 + 1] = Math.max(heightAt(x, z), SEA) + s[1] + Math.sin(t * 0.7 + s[3]) * 0.4;
  }
  motes.geometry.attributes.position.needsUpdate = true;
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
function updateSky() {
  if (window.__game && !window.__game.calendar) window.__game.calendar = calendar;
  const wx = sim.state.sys.weather, site = (wx && wx.site) || SKY.site;
  const sp = calendar.sunPosition(sim.state.t + sim.acc, site);
  const e = Math.sin(sp.elevationRad);
  const dayF = smoothstep(0.02, 0.4, e), nightF = 1 - smoothstep(-0.22, 0.06, e);
  const goldF = clamp(1 - dayF - nightF, 0, 1);
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
  mixC(_fogC, 'fog'); towardOvercast(_fogC, O.fog, grey); _fogC.multiplyScalar(1 - 0.1 * ov - 0.08 * wet);
  scene.fog.color.copy(_fogC); scene.background.copy(_fogC);
  // falling rain and snow close the distance in (updateCamera sets the clear-air distances each frame)
  scene.fog.near *= 1 - 0.45 * wet; scene.fog.far *= 1 - 0.4 * wet;
  // the sun comes from its true azimuth (world +x east, +z south); below the horizon the same light
  // plays the moon, from the opposite side of the sky
  const up = e >= -0.05, el = Math.max(up ? sp.elevationRad : -sp.elevationRad, SKY.minElevation);
  const hx = Math.sin(sp.azimuthRad) * (up ? 1 : -1), hz = -Math.cos(sp.azimuthRad) * (up ? 1 : -1);
  const tx = Math.round(player.x), tz = Math.round(player.z);
  sun.target.position.set(tx, player.y, tz);
  sun.position.set(tx + hx * Math.cos(el) * 120, player.y + Math.sin(el) * 120, tz + hz * Math.cos(el) * 120);
  waterUniforms.uSunDir.value.subVectors(sun.position, sun.target.position).normalize();
  waterUniforms.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity * 0.32);
  waterUniforms.uAmb.value.copy(hemi.color).multiplyScalar(hemi.intensity * 0.3);
  waterUniforms.uSky.value.copy(_fogC); mixC(waterUniforms.uZenith.value, 'zen'); towardOvercast(waterUniforms.uZenith.value, O.zen, grey);
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
const SAVE_KEY = 'homestead:save:', LAST_KEY = 'homestead:last-seed';
function syncSite() {
  const build = window.__build;
  if (!build) return;
  build.ensureLoaded();
  if (build.version === simCtl.siteV) return;
  const version = build.version;
  sim.commandNow('site.setPieces', { pieces: mapPieces(build.pieces()) });
  simCtl.siteV = version;
}
function saveData() {
  syncSite();
  const edits = {};
  for (const [k, a] of world.edits) edits[k] = f32ToBase64(a);
  return makeSave(sim.serialize(), {
    edits, removed: [...world.removed], wood: world.wood, stone: world.stone,
    player: { x: player.x, z: player.z }, cam: { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist },
    builds: window.__build && window.__build.serialize ? window.__build.serialize() : simCtl.builds,
  });
}
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY + SEED, JSON.stringify(saveData()));
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
  for (const k in (w.edits || {})) world.edits.set(k, base64ToF32(w.edits[k]));
  for (const id of (w.removed || [])) world.removed.add(id);
  world.wood = w.wood || 0; world.stone = w.stone || 0;
  simCtl.builds = w.builds || null;
  if (w.player) { player.x = w.player.x; player.z = w.player.z; }
  if (w.cam) { cam.yaw = cam.prevYaw = w.cam.yaw; cam.pitch = w.cam.pitch; cam.dist = w.cam.dist; }
  return true;
}
window.addEventListener('pagehide', saveGame);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });
function setQuality(q) {
  quality.level = q;
  const hi = q === 'high';
  renderer.shadowMap.enabled = hi; sun.castShadow = hi;
  if (hi && !composer) buildComposer();
  resize();
  el('quality').textContent = hi ? 'High' : 'Low';
}
el('quality').addEventListener('click', () => { setQuality(quality.level === 'high' ? 'low' : 'high'); canvas.focus(); });
el('newworld').addEventListener('click', () => { saveGame(); resetWorld((Math.random() * 1e6) | 0); canvas.focus(); });
el('helpbtn').addEventListener('click', () => { el('help').hidden = true; canvas.focus(); });

function resetWorld(seed) {
  SEED = seed >>> 0;
  noise = makeSimplex(SEED);
  sim = createGameSim(SEED); simCtl.builds = null; simCtl.siteV = -1;
  clearEnemies();
  if (window.__build) window.__build.reset();
  chunkStream.reset();
  world.edits.clear(); world.removed.clear();
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
  if (raw) applySave(raw);
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
  if (window.__build) window.__build.collide(o, rad, o === player);      // walls and furniture
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
function updatePlayer(dt) {
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
  const swimming = heightAt(P.x, P.z) < -0.75;
  const alt = !!(keys.AltLeft || keys.AltRight);
  const armed = P.tool === 'axe';
  P.stamWait -= dt; P.regenWait -= dt; P.rollCd -= dt; P.dashCd -= dt; P.shotCd -= dt; P.comboLock -= dt; P.comboShow -= dt; P.riposte -= dt; P.tap -= dt;
  if (P.stamWait <= 0) P.stam = Math.min(100, P.stam + 30 * dt);
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
      if (P.aiming) sp *= 0.55;
      if (P.charging) sp *= 0.6;
      if (P.atk) sp *= 0.4;
      if (P.parry) sp *= 0.5;
      vx = mx * sp; vz = mz * sp;
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
  P.x += (vx + P.kvx) * dt; P.z += (vz + P.kvz) * dt;
  P.kvx *= Math.exp(-7 * dt); P.kvz *= Math.exp(-7 * dt);
  pushOut(P, 0.28);
  const gh = window.__build ? window.__build.ground(P.x, P.z, P.y, heightAt(P.x, P.z)) : heightAt(P.x, P.z);   // built floors count as ground
  const ty = Math.max(gh, waveHeight(P.x, P.z) - 0.95);
  if (P.air) {
    P.vy -= 21 * dt; P.y += P.vy * dt;
    if (P.y <= ty) { P.y = ty; P.air = false; P.vy = 0; P.jumps = 0; }
  } else P.y = lerp(P.y, ty, 1 - Math.exp(-18 * dt));
  P.speed = sp;
  P.walk += sp * dt * 1.9;

  // terrain tools work on the spot just ahead
  ring.visible = false; P.digging = false;
  if (!armed && P.tool !== 'build' && cursor.valid) {
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
  pm.legL.rotation.x = legL; pm.legR.rotation.x = legR;
  pm.armL.rotation.x = armL; pm.armR.rotation.x = armR;
  pm.armR.position.z = -0.22 * pullR;
  pm.body.rotation.set(lean, twist, 0);
  pm.bow.visible = P.aiming;
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
  const k = cam.aimK = lerp(cam.aimK, player.aiming ? 1 : 0, 1 - Math.exp(-11 * dt));
  const follow = 1 - Math.exp(-lerp(9, 24, k) * dt);
  cam.tx = lerp(cam.tx, player.x, follow); cam.tz = lerp(cam.tz, player.z, follow);
  cam.ty = lerp(cam.ty, player.y + 1.0, 1 - Math.exp(-lerp(5, 18, k) * dt));
  cam.shake = Math.max(0, cam.shake - dt * 1.6);
  const sh = cam.shake * cam.shake * 1.6 * (1 - 0.6 * k);
  // exploring: high above. Bow drawn: down behind the right shoulder.
  const dist = lerp(cam.dist, 4.4, k), pitch = lerp(cam.pitch, cam.aimPitch, k);
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
  const fov = lerp(40, 52, k);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
  scene.fog.near = lerp(cam.dist + 16, 28, k); scene.fog.far = lerp(cam.dist + 96, 122, k);
  // screen position of the player, for the see-through fade on trees
  const size = renderer.getDrawingBufferSize(_v2);
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
function step(dt) {
  U.time.value += dt;
  if (dt > 0) { const dy = Math.atan2(Math.sin(cam.yaw - cam.prevYaw), Math.cos(cam.yaw - cam.prevYaw)); cam.yawRate = lerp(cam.yawRate, dy / dt, 0.3); cam.prevYaw = cam.yaw; }
  if (juice.lockFailed && !locked() && mouse.inside && player.tool !== 'build') {     // no pointer capture: steer by pushing toward the screen edge
    const ax = Math.abs(mouse.x);
    if (ax > 0.18) cam.yaw -= Math.sign(mouse.x) * ((ax - 0.18) / 0.82) * 2.8 * dt;
    cam.aimPitch = clamp(0.25 - mouse.y * 0.5, -0.28, 0.9);
  }
  // Refresh geometry before a tick or save can read the headless site.
  syncSite();
  sim.advance(dt * WORLD_SECONDS_PER_REAL_SECOND * (keys.KeyT ? Math.max(simCtl.speed, 100) : simCtl.speed), 24);
  simCtl.saveT += dt;
  if (simCtl.saveT > 20) { simCtl.saveT = 0; saveGame(); }
  chunkStream.update(player.x, player.z, 5);
  updatePlayer(dt);
  updateEnemies(dt);
  updateShakes(dt);
  updateFallers(dt);
  updateLogs(dt);
  updatePickups(dt);
  updateParticles(dt);
  updateCamera(dt);
  updateDepthMap(dt);
  updateAim();
  updateArrows(dt);
  updateMotes();
  updateSky();
  if (window.__build) window.__build.update(dt);
  // grass only near the player
  const gr = quality.level === 'high' ? 84 : 52;
  for (const c of world.chunks.values()) {
    const near = Math.hypot(c.ox + CS / 2 - player.x, c.oz + CS / 2 - player.z) < gr;
    if (c.grassMesh) { c.grassMesh.visible = near; c.grassMesh.count = quality.level === 'high' ? c.grass.length : Math.ceil(c.grass.length * 0.45); }
    if (c.flowerMesh) c.flowerMesh.visible = near;
    if (c.litter) c.litter.visible = near;
  }
}
function render() {
  if (quality.level === 'high' && composer) composer.render();
  else renderer.render(scene, camera);
}
function frame(now) {
  const raw = (now - last) / 1000; last = now;
  let dt = clamp(raw, 0, 0.05);     // the first frame's timestamp can precede start-up, so never step backwards
  if (juice.hitStop > 0) { juice.hitStop -= raw; dt *= 0.06; }   // a few frames of freeze when a hit lands
  step(dt);
  render();
  updateHud();
  fpsAcc += raw; fpsN++;
  if (fpsAcc >= 0.5) {
    fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
    el('fps').textContent = String(Math.round(fps));
    el('clock').textContent = clock();
    el('day').textContent = String(sim.day());
    slowFor = fps < 27 ? slowFor + 0.5 : 0;
    if (slowFor >= 3 && quality.level === 'high' && !autoDropped) { autoDropped = true; setQuality('low'); }
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
buildComposer();
resize();
resetWorld(SEED);
setTool('axe');
lockUi();
window.__game = {
  pm, get seed() { return SEED; },
  get sim() { return sim; }, savedBuilds: () => simCtl.builds, powerAvailable: () => false,
  stock: {
    MATERIALS, ITEMS, ITEM_CATEGORIES, material, unitVolumeM3, rValuePer100mm, stockMassKg, canAfford, toolAvailable,
    get state() { return stockState(); },
    do: (name, payload) => { const r = runStockCommand(sim, name, payload); hudDirty = true; return r; },
  },
  saveGame, saveData, setSpeed, get speed() { return simCtl.speed; },
  enemies, spawnEnemy, arrows, fireArrow, MOVES, startMove, juice, updateHud, waveHeight, depthState, lockQuality: () => { autoDropped = true; }, world, player, cam, keys, mouse, cursor, step, render, heightAt, fellTree, applyBrush, setQuality, renderer, THREE,
  camera, scene, setTool, fade: addWind, fadeR: U.fadeR, burst, editGet: getDelta, editSet: setDelta, baseHeight, chunkSize: CS, treeKinds: TREE, refreshLock: lockUi, forestAt,
  light: SKY, noise: fbm, palette: PAL, quality: () => quality.level, composer: () => composer, treeGeo, pineLite: pineLiteGeo, markStockDirty: () => { hudDirty = true; },
};
requestAnimationFrame(frame);
