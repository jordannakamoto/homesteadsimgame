// Snow on things: on the faces of objects that look up (in world space, so a turned rock or a player-built roof works),
// more of the face covered the deeper the snow (a thin fall whitens only the flats; a deep one reaches down the pitches),
// with a soft, broken edge; never under a roof. Tree crowns hold the canopy's snow (__game.snow.canopyMm) on top of
// their boughs, and lose it where a tree was chopped, bumped or shed in the wind, until new snow falls on them.
//   cover(material, { kind })  patch a material: 'object' (buildings, vehicles), 'rock' (bare in stream water), 'tree'
//                              (crowns from the canopy store, bark and logs as objects), 'litter' (ground cover: sunk
//                              into the snow by its depth, so small things vanish and shrubs stand in it)
//   uSnowRoof: a top-down map of what roofs each 0.5 m cell (on the field's toroidal grid, 192 x 192 RGBA32F, nearest):
//   the roof plane's height at the cell's centre, its slope in x and z, and the highest the roof gets in the cell, from
//   __build.pieces() (roofs, and floors held up above the ground) whenever __build.version changes or the field moves.
//   A fragment gets snow only at or above that height less a small margin, or where nothing roofs it.
// Patches are compiled in only while snow lies (on); off, the materials compile exactly as before.
import { FIELD_GLSL } from './shade.js';
import { tmod } from './gpu.js';

const N = 192, CELL = 0.5, NONE = -1e4, SHAKES = 8, MARGIN = 0.35;
const U_NAMES = ['uSnowField', 'uSnowFieldWin', 'uSnowRef', 'uSnowWind', 'uSnowFlags', 'uSnowFlags2', 'uSnowRoof', 'uSnowRoofWin', 'uSnowObj', 'uSnowShake', 'uSnowClump', 'uSnowStick'];
const CROWN_R = [0.25, 0.25, 0.4];   // crown radius over tree height: pine, birch, oak

// a crown's snow cleared round where it was knocked off, back only once new snow has fallen on it (uSnowObj.z: the fall
// so far, mm). Shared with the mounds on the boughs (clumps.js): they collapse with the crown's dusting.
export const SHAKE_GLSL = /* glsl */ `
uniform vec4 uSnowObj; uniform vec4 uSnowShake[${SHAKES}];
float snowShaken(vec2 w) {
  float k = 1.0;
  for (int i = 0; i < ${SHAKES}; i++) {
    vec4 s = uSnowShake[i];
    if (s.z <= 0.0) continue;
    float near = 1.0 - smoothstep(0.65 * s.z, s.z, distance(w, s.xy));
    k *= 1.0 - near * (1.0 - clamp((uSnowObj.z - s.w) / 3.0, 0.0, 1.0));
  }
  return k;
}`;
// sunlight on snow lying on things (the snow surface's constants, shade.js): it wraps past the terminator and comes back
// bluer where it travelled far through the snow; for a Lambert material, after lights_lambert_pars_fragment
export const SNOW_LIGHT_GLSL = /* glsl */ `
void RE_Direct_SnowLump(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight) {
  float ndl = dot(geometryNormal, directLight.direction);
  float wrap = mix(saturate(ndl), clamp((ndl + 0.35) / 1.35, 0.0, 1.0), uSnowFlags.y);
  vec3 tint = mix(vec3(1.0), mix(vec3(0.60, 0.80, 1.0), vec3(1.0), smoothstep(0.0, 0.5, ndl)), uSnowFlags.y);
  reflectedLight.directDiffuse += directLight.color * wrap * tint * BRDF_Lambert(material.diffuseColor);
}
void RE_IndirectDiffuse_SnowLump(const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight) {
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert(material.diffuseColor) * vec3(0.86, 0.95, 1.12);
}
#undef RE_Direct
#undef RE_IndirectDiffuse
#define RE_Direct RE_Direct_SnowLump
#define RE_IndirectDiffuse RE_IndirectDiffuse_SnowLump`;

// a loaded bough bends down (more the stickier the snow, which is what makes it let go): model-space metres at model
// point p of a pine, most at the tips of the long low whorls, none at the trunk or the leader. Needs uSnowObj, uSnowStick.
export const DROOP_GLSL = /* glsl */ `
float snowDroop(vec3 p) {
  return uSnowObj.x * mix(0.5, 1.0, uSnowStick) * 0.13 * pow(clamp((length(p.xz) - 0.3) / 2.6, 0.0, 1.0), 1.5) * (1.0 - smoothstep(6.5, 8.6, p.y));
}`;
const V_DROOP = /* glsl */ `#include <begin_vertex>
  #ifdef USE_MAP
  if (vMapUv.x >= 0.5 && vMapUv.y < 0.5) transformed.y -= snowDroop(position);    // a pine's needles
  #endif`;

const PARS = SHAKE_GLSL + /* glsl */ `
uniform highp sampler2D uSnowRoof; uniform vec4 uSnowRoofWin; uniform vec4 uSnowClump;
// the height of whatever roofs this point (NONE where nothing does): the cell's roof plane, capped at its highest
float snowRoofH(vec2 w) {
  if (uSnowRoofWin.w < 0.5) return ${NONE.toFixed(1)};
  vec2 o = w - uSnowRoofWin.xy;
  if (o.x < 0.0 || o.y < 0.0 || o.x >= uSnowRoofWin.z || o.y >= uSnowRoofWin.z) return ${NONE.toFixed(1)};
  vec2 c = floor(w * 2.0);
  vec4 r = texelFetch(uSnowRoof, ivec2(mod(c, ${N}.0)), 0);
  if (r.a < -1000.0) return ${NONE.toFixed(1)};
  return min(r.x + dot(r.yz, w - (c + 0.5) * 0.5), r.a);
}
// how much of a face is under snow: faces that look up, more of them the deeper it lies, a soft broken edge
float snowCover(vec3 w, vec3 n, float depth) {
  if (depth <= 0.0015 || w.y < snowRoofH(w.xz) - ${MARGIN}) return 0.0;
  float thr = mix(0.82, 0.3, smoothstep(0.01, 0.3, depth));
  float nz = snowNoise2(w.xz * 3.1 + w.y * 1.7) - 0.5 + 0.5 * (snowNoise2(w.xz * 11.0 - w.y * 5.0) - 0.5);
  return smoothstep(thr - 0.08, thr + 0.12, n.y + nz * 0.3) * smoothstep(0.0015, 0.02, depth);
}
varying vec3 vSnowOW;`;
const V_WORLD = /* glsl */ `#include <project_vertex>
  {
    vec4 snWp = vec4(transformed, 1.0);
    #ifdef USE_BATCHING
    snWp = batchingMatrix * snWp;
    #endif
    #ifdef USE_INSTANCING
    snWp = instanceMatrix * snWp;
    #endif
    vSnowOW = (modelMatrix * snWp).xyz;
  }`;
// ground cover sinks into the snow by its depth (it is lying on the ground the snow lies on)
const V_SINK = /* glsl */ `#include <begin_vertex>
  { vec4 snSw = modelMatrix * vec4(transformed, 1.0); vec4 snF = snowField(snSw.xz); transformed.y -= snF.x * (1.0 - 0.5 * snF.z); }`;
const F_COVER = (kind) => /* glsl */ `
  {
    vec3 snNw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    float snD = uSnowRef.x, snK = 1.0;
    ${kind === 'rock' ? 'snK = step(0.002, snowField(vSnowOW.xz).x);            // in stream water: bare' : ''}
    ${kind === 'tree' ? `
    #ifdef USE_MAP
    if (vMapUv.y < 0.5) {
      // a crown: the canopy's own store, on top of the boughs (pine) or a little caught in bare twigs (broadleaf)
      // (a light load reaches only the boughs' upper faces: the dark green shows beneath and between them)
      snD = (vMapUv.x >= 0.5 ? uSnowObj.x : uSnowObj.y) * 0.06;
      snK = snowShaken(vSnowOW.xz) * (0.55 + 0.45 * snowNoise2(vSnowOW.xz * 1.3 + vSnowOW.y * 0.9));
      // with mounds on the boughs (uSnowObj.w, clumps.js) a pine's needles keep only a broken dusting: the mounds carry it
      // (only as far as the mounds are drawn, uSnowClump: player x, z, fade start, end; beyond, the crown carries it all)
      if (vMapUv.x >= 0.5) snK *= mix(1.0, 0.42 * smoothstep(0.32, 0.78, snowNoise2(vSnowOW.xz * 2.3 - vSnowOW.y * 1.9)),
        uSnowObj.w * (1.0 - smoothstep(uSnowClump.z, uSnowClump.w, distance(vSnowOW.xz, uSnowClump.xy))));
    }
    #endif` : ''}
    float snC = snowCover(vSnowOW, snNw, snD) * snK;
    diffuseColor.rgb = mix(diffuseColor.rgb, snowAlbedo(uSnowRef.y, 0.0) * 0.92, snC);
  }
  #include <lights_lambert_fragment>`;

// simple hash of a string (cache keys)
const strHash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };

export function createObjects(G, U, { stamp }) {
  const T = G.THREE;
  U.uSnowRoof = U.uSnowRoof || { value: null };
  U.uSnowRoofWin = U.uSnowRoofWin || { value: new T.Vector4() };
  U.uSnowObj = U.uSnowObj || { value: new T.Vector4() };                      // crown snow (pine, broadleaf, 0..1), fall so far (mm), mounds on (clumps.js)
  U.uSnowClump = U.uSnowClump || { value: new T.Vector4(0, 0, 37, 45) };          // mounds drawn round x, z: fade start, end (m)
  U.uSnowStick = U.uSnowStick || { value: 0 };                                   // 0 cold dry powder .. 1 sticky, near thaw
  U.uSnowShake = U.uSnowShake || { value: Array.from({ length: SHAKES }, () => new T.Vector4()) };
  const done = new WeakMap(), live = new Set();
  let on = false;

  // ---------------------------------------------------------------- patching
  function cover(mat, { kind = 'object' } = {}) {
    if (!mat || done.has(mat)) return false;
    if (!(mat.isMeshLambertMaterial || mat.isMeshPhongMaterial || mat.isMeshStandardMaterial) || mat.transparent) return false;
    done.set(mat, kind); live.add(mat);
    const before = mat.onBeforeCompile, own = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey : null;
    // the key this material had: its own, or (three's default, as nature.js sets it) its compile hook's source
    const baseKey = own ? () => own.call(mat) : (() => { const k = (before ? before.toString() : '') + '|even'; return () => k; })();
    const hb = strHash(before ? before.toString() : '');
    mat.onBeforeCompile = function (sh, r) {
      if (before) before.call(this, sh, r);
      if (!on) return;
      for (const k of U_NAMES) sh.uniforms[k] = U[k];
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + FIELD_GLSL + '\nvarying vec3 vSnowOW;')
        .replace('#include <project_vertex>', V_WORLD);
      if (kind === 'litter') sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', V_SINK);
      if (kind === 'tree') sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec4 uSnowObj; uniform float uSnowStick;' + DROOP_GLSL).replace('#include <begin_vertex>', V_DROOP);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FIELD_GLSL + PARS)
        .replace('#include <lights_lambert_fragment>', F_COVER(kind));
    };
    mat.customProgramCacheKey = function () { return baseKey() + '|' + hb + '|snowobj' + (on ? kind : '0'); };
    mat.needsUpdate = true;
    return true;
  }
  const isMat = (m) => m && (m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshStandardMaterial);
  function coverTree(root, kind) {
    if (!root) return;
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (isMat(m)) { if (!done.has(m)) cover(m, { kind }); else live.add(m); }
    });
  }
  // find everything that should carry snow: the engine's shared materials, ground cover, buildings, vehicles
  let buildV = -1, vehGen = -1, scanT = 0, roofT = 0;
  function scan(force) {
    const M = G.materials || {};
    if (M.tree) { cover(M.tree, { kind: 'tree' }); live.add(M.tree); }
    if (M.solid) { cover(M.solid, { kind: 'rock' }); live.add(M.solid); }
    const NA = window.__nature;
    if (NA && NA.materials && NA.materials.litter) { cover(NA.materials.litter, { kind: 'litter' }); live.add(NA.materials.litter); }
    const B = window.__build;
    if (B && B.groups && (force || B.version !== buildV)) { buildV = B.version; for (const g of B.groups()) coverTree(g, 'object'); }
    const V = window.__vehicles;
    if (V && V.roots && (force || V.gen !== vehGen)) { vehGen = V.gen; for (const r of V.roots()) coverTree(r, 'object'); }
  }

  // ---------------------------------------------------------------- the roof map
  let rtex = null, rdata = null, rx0 = null, rz0 = null, rv = -1;
  function roofOn() {
    if (rtex) return;
    rdata = new Float32Array(N * N * 4);
    rtex = new T.DataTexture(rdata, N, N, T.RGBAFormat, T.FloatType);
    rtex.internalFormat = 'RGBA32F'; rtex.minFilter = rtex.magFilter = T.NearestFilter; rtex.generateMipmaps = false;
    rtex.wrapS = rtex.wrapT = T.RepeatWrapping;
    U.uSnowRoof.value = rtex; rx0 = rz0 = null; rv = -1;
  }
  function roofOff() { if (rtex) rtex.dispose(); rtex = null; rdata = null; U.uSnowRoof.value = null; U.uSnowRoofWin.value.w = 0; }
  function inPoly(poly, x, z) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  }
  function rasterise() {
    const W = U.uSnowFieldWin.value, B = window.__build;
    if (!rtex || W.w < 0.5) return;
    const x0 = W.x, z0 = W.y, v = B ? B.version : 0;
    if (x0 === rx0 && z0 === rz0 && v === rv) return;
    rx0 = x0; rz0 = z0; rv = v;
    for (let k = 0; k < N * N; k++) { rdata[k * 4] = NONE; rdata[k * 4 + 1] = 0; rdata[k * 4 + 2] = 0; rdata[k * 4 + 3] = NONE; }
    const i0w = Math.round(x0 / CELL), j0w = Math.round(z0 / CELL);
    let any = false;
    const put = (poly, at, grad) => {
      let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
      for (const q of poly) { if (q.x < bx0) bx0 = q.x; if (q.x > bx1) bx1 = q.x; if (q.z < bz0) bz0 = q.z; if (q.z > bz1) bz1 = q.z; }
      const ia = Math.max(i0w, Math.floor(bx0 / CELL)), ib = Math.min(i0w + N - 1, Math.floor(bx1 / CELL));
      const ja = Math.max(j0w, Math.floor(bz0 / CELL)), jb = Math.min(j0w + N - 1, Math.floor(bz1 / CELL));
      for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
        const cx = (i + 0.5) * CELL, cz = (j + 0.5) * CELL;
        // the cell is roofed if its centre or any corner is under the shape (so eaves are not left with a bare rim)
        let inside = inPoly(poly, cx, cz);
        if (!inside) for (const [dx, dz] of [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]]) if (inPoly(poly, cx + dx, cz + dz)) { inside = true; break; }
        if (!inside) continue;
        const h = at(cx, cz), k = (tmod(j, N) * N + tmod(i, N)) * 4;
        if (h <= rdata[k]) continue;
        let cap = h;
        for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) cap = Math.max(cap, at(cx + dx, cz + dz));
        const g = grad(cx, cz);
        rdata[k] = h; rdata[k + 1] = g[0]; rdata[k + 2] = g[1]; rdata[k + 3] = cap; any = true;
      }
    };
    for (const p of (B && B.pieces ? B.pieces() : [])) {
      if (!p || p.built === false) continue;
      if (p.kind === 'roof' && Array.isArray(p.footprint) && p.footprint.length >= 3) {
        const f = p.facing, fl = f ? Math.hypot(f.x, f.z) : 0, slope = Math.tan(((p.pitchDeg || 0) * Math.PI) / 180);
        const fx = fl ? f.x / fl : 0, fz = fl ? f.z / fl : 0, ax = p.a ? p.a.x : 0, az = p.a ? p.a.z : 0;
        const up = (x, z) => -((x - ax) * fx + (z - az) * fz);
        const at = fl ? (x, z) => Math.min(p.ridgeY, p.eaveY + Math.max(0, up(x, z)) * slope) : () => (p.eaveY + p.ridgeY) / 2;
        const grad = (x, z) => { const u = up(x, z); return fl && u > 0 && p.eaveY + u * slope < p.ridgeY ? [-fx * slope, -fz * slope] : [0, 0]; };
        put(p.footprint, at, grad);
      } else if (p.kind === 'floor' && Array.isArray(p.outline) && p.outline.length >= 3 && p.y1 != null) {
        let cx = 0, cz = 0;
        for (const q of p.outline) { cx += q.x / p.outline.length; cz += q.z / p.outline.length; }
        if (p.y0 - G.heightAt(cx, cz) > 1.2) put(p.outline, () => p.y1, () => [0, 0]);   // a deck or upper floor roofs what is under it
      }
    }
    U.uSnowRoofWin.value.set(x0, z0, N * CELL, any ? 1 : 0);
    rtex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- knocking snow off crowns
  const shakes = U.uSnowShake.value;
  let shakeI = 0;
  const fallNow = () => { const w = G.sim.state.sys.weather; return w && w.totals ? w.totals.snowfallMm : 0; };
  const crownR = (tr) => CROWN_R[tr.type] * G.treeKinds[tr.type].h * tr.scale;
  // the crown's snow held now (0..1) for a tree of this type
  const held = (type) => (type === 0 ? U.uSnowObj.value.x : U.uSnowObj.value.y);
  function knock(tr, big) {
    const a = held(tr.type);
    if (a < 0.04 || !G.treeKinds || !G.treeKinds[tr.type]) return false;
    const R = crownR(tr), H = G.treeKinds[tr.type].h * tr.scale, gy = G.heightAt(tr.x, tr.z);
    shakes[shakeI].set(tr.x, tr.z, R * 1.1, fallNow()); shakeI = (shakeI + 1) % SHAKES;
    if (G.burst) {
      // clumps fall from round the crown, a cloud of powder drifts down after them
      const n = Math.round((big ? 7 : 4) * a + 1);
      for (let k = 0; k < 3; k++) {
        const ang = Math.random() * 6.283, rr = R * (0.3 + 0.5 * Math.random());
        G.burst(tr.x + Math.cos(ang) * rr, gy + H * (0.45 + 0.35 * Math.random()), tr.z + Math.sin(ang) * rr, n, 0xf2f5f9, 0.6, 0.4, 0.15, 1.4);
      }
      G.burst(tr.x, gy + H * 0.55, tr.z, Math.round((big ? 22 : 12) * a + 2), 0xf6f8fb, R * 0.9, 0.9, 0.05, 1.1);
    }
    // where the clumps land: small craters under the drip line
    const nc = Math.round(5 + 4 * a);
    for (let k = 0; k < nc; k++) {
      const ang = Math.random() * 6.283, rr = R * (0.55 + 0.45 * Math.random()), x = tr.x + Math.cos(ang) * rr, z = tr.z + Math.sin(ang) * rr;
      stamp({ x0: x, z0: z, r: 0.07 + 0.08 * Math.random(), k: 0.35 + 0.3 * a, rim: 0.8, rough: 0.6 });
    }
    return true;
  }
  const seenShake = new WeakMap(), seenFall = new WeakSet();
  function watchTrees() {
    const Wd = G.world;
    if (!Wd) return;
    const now = performance.now();
    for (const tr of Wd.shakes || []) {
      if (tr.shake < 0.3) continue;                                    // just struck: the engine sets 0.35
      const t = seenShake.get(tr);
      if (t && now - t < 400) continue;
      seenShake.set(tr, now); knock(tr, false);
    }
    for (const f of Wd.fallers || []) { if (seenFall.has(f)) continue; seenFall.add(f); if (f.tr) knock(f.tr, true); }
  }
  // the wind shed snow from the crowns: a tree or two near you lets go of its load
  function unloadNear() {
    const P = G.player, near = [];
    for (const c of G.world.chunks.values()) {
      if (Math.abs(c.ox + (G.chunkSize || 32) / 2 - P.x) > 40 || Math.abs(c.oz + (G.chunkSize || 32) / 2 - P.z) > 40) continue;
      for (const tr of c.trees) if (tr.alive && tr.type === 0 && Math.hypot(tr.x - P.x, tr.z - P.z) < 25) near.push(tr);
    }
    for (let k = 0; k < 2 && near.length; k++) knock(near.splice(Math.floor(Math.random() * near.length), 1)[0], false);
  }

  return {
    cover, knock, unloadNear,
    get on() { return on; }, get count() { return live.size; },
    get roofCells() { if (!rdata) return 0; let n = 0; for (let k = 3; k < rdata.length; k += 4) if (rdata[k] > NONE) n++; return n; },
    // on: snow lies (patches compiled in, the roof map kept)
    set(o) {
      if (o) { roofOn(); scan(true); }
      if (o === on) return;
      on = o;
      if (!on) { roofOff(); for (const s of shakes) s.set(0, 0, 0, 0); }
      for (const m of live) m.needsUpdate = true;
    },
    update(dt) {
      if (!on) return;
      const st = G.sim.state, w = st.sys.weather;
      // the crowns' snow: the canopy store (mm water over the crown), or with no snowpack system a guess from the ground's
      const cm = G.snow && G.snow.canopyMm && st.sys.snow ? G.snow.canopyMm(st) : Math.min(3, (w.snowSweMm || 0) * 0.1);
      const a = Math.min(1, cm / 2.5);
      U.uSnowObj.value.set(a, a * 0.35, fallNow(), U.uSnowObj.value.w);   // w: mounds on the pines (clumps.js)
      // new buildings and vehicles are covered soon after they appear (building changes at most twice a second: a
      // build in progress changes every frame), and the roof map follows; the rest is looked over every 2 s
      const B = window.__build, V = window.__vehicles;
      scanT -= dt; roofT -= dt;
      if (scanT <= 0 || (roofT <= 0 && B && B.version !== buildV) || (V && V.gen !== vehGen)) { scanT = 2; scan(false); }
      const Wn = U.uSnowFieldWin.value;
      if (roofT <= 0 || Wn.x !== rx0 || Wn.y !== rz0) { roofT = 0.5; rasterise(); }
      watchTrees();
    },
  };
}
