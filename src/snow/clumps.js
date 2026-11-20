// Snow lying in heaps on things, as it really sits (Fearing 2000; Schmidt & Pomeroy 1990): it lands on what faces the
// sky and slumps to an angle of repose, so every heap is a cushion or cap, widest at its base with a flat-ish top and
// rounded shoulders, never a ball. One instanced cushion (a low-arch dome, 80 triangles) drawn in one call for:
//   - the pines' boughs: one long cushion along each needle spray (2-4 times longer than wide), thickest over the outer
//     fan, thin near the trunk where the whorls above shelter it, none on steep sprays, a cap on the leader. The spots
//     come from the pine models' spray cards (__game.pineBoughs, recorded as the engine builds them, full and lite);
//     each tree keeps its own subset (a hash of its position). The canopy load (uSnowObj.x) grows every cushion from
//     its own threshold, so they appear one by one; a crown knocked clear (uSnowShake) loses them until new snow falls.
//     Each anchor goes through the same per-tree variety (fx.js), wind sway (engine addWind) and loaded droop
//     (objects.js) as its bough, so it rides with it.
//   - caps on isolated tops near you: rocks, stumps, fallen logs. Footprint a little wider than the top, height the
//     snow's depth there (the field, read in the vertex shader) but no more than the top's half-width times the tangent
//     of the angle of repose; gone where the thing is buried.
// Stickiness (uSnowStick, 0 cold dry powder .. 1 near thaw, __snow.uniforms) sets the look: dry snow makes thin, narrow
// cushions and small steep caps; sticky snow fat, bridged, overhanging ones.
// Only things within R of the player are listed (rebuilt when you have moved REBUILD m, a tree came down, a chunk
// loaded, pine models swapped or a log moved); the heaps fade out over the last FADE m, where the crowns' whitening
// takes over. Nothing is allocated until snow lies on the canopy or the ground; released when it has gone.
import { FIELD_GLSL } from './shade.js';
import { SHAKE_GLSL, SNOW_LIGHT_GLSL, DROOP_GLSL } from './objects.js';

const MAX = 4000, R = 45, FADE = 8, REBUILD = 12, PER_TREE = [12, 40], SEG = 10;
const U_NAMES = ['uSnowField', 'uSnowFieldWin', 'uSnowRef', 'uSnowWind', 'uSnowFlags', 'uSnowFlags2', 'uSnowObj', 'uSnowShake', 'uSnowClump', 'uSnowStick'];

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash3 = (x, y, z) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };

// the cushion: 1 m across, 1 high (instances scale it). A low-arch profile (flat-ish top, rounded shoulders, widest at
// the base), its outline wobbled by a few sines so no two read as the same shape, and a
// shallow underside bedded a few cm into whatever carries it.
function cushionGeometry(T) {
  const rings = [0, 0.5, 0.82, 1.0], pos = [], idx = [], rnd = mulberry(5);
  const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  const rim = (a) => 1 + 0.07 * Math.sin(2 * a + ph[0]) + 0.05 * Math.sin(3 * a + ph[1]) + 0.03 * Math.sin(5 * a + ph[2]);
  const prof = (rho) => Math.pow(Math.max(0, 1 - Math.pow(rho, 2.2)), 0.75);
  pos.push(0, 1, 0);                                                       // 0: the top
  for (let i = 1; i < rings.length; i++) for (let k = 0; k < SEG; k++) {
    const a = (k / SEG) * 6.2832, rho = rings[i], r = 0.5 * rho * rim(a);
    const y = prof(rho) * (1 + 0.06 * Math.sin(a * 2 + ph[2] + i));
    pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
  }
  const under = pos.length / 3;
  for (let k = 0; k < SEG; k++) { const a = (k / SEG) * 6.2832, r = 0.5 * 0.86 * rim(a); pos.push(Math.cos(a) * r, -0.05, Math.sin(a) * r); }
  const bottom = pos.length / 3; pos.push(0, -0.06, 0);
  const ring = (i) => 1 + (i - 1) * SEG;
  for (let k = 0; k < SEG; k++) idx.push(0, ring(1) + ((k + 1) % SEG), ring(1) + k);
  for (let i = 1; i < rings.length - 1; i++) for (let k = 0; k < SEG; k++) {
    const a = ring(i) + k, b = ring(i) + ((k + 1) % SEG), c = ring(i + 1) + k, d = ring(i + 1) + ((k + 1) % SEG);
    idx.push(a, b, c, b, d, c);
  }
  const last = ring(rings.length - 1);
  for (let k = 0; k < SEG; k++) {
    const a = last + k, b = last + ((k + 1) % SEG), c = under + k, d = under + ((k + 1) % SEG);
    idx.push(a, b, c, b, d, c);
    idx.push(bottom, c, d);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the underside's normals lean up: it is the thin edge of a heap seen from below, not a dark dome
  const nr = g.attributes.normal;
  for (let i = under; i < nr.count; i++) { const x = nr.getX(i), z = nr.getZ(i), y = 0.35, l = Math.hypot(x, y, z); nr.setXYZ(i, x / l, y / l, z / l); }
  return g;
}

// the cushions on one pine model (model space): { p: anchor, X/Y/Z: unit axes, len, wid, hgt (m), keep, thr }
function template(cards) {
  const out = [], rnd = mulberry(91);
  const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (const b of cards) {
    const hv = [b.hv.x, b.hv.y, b.hv.z], tw = [b.tw.x, b.tw.y, b.tw.z];
    const hl = Math.hypot(...hv), tl = Math.hypot(...tw);
    // steep sprays shed it: flat ones carry most
    const steep = Math.abs(hv[1]) / hl, flat = 1 - Math.min(1, Math.max(0, (steep - 0.3) / 0.35));
    if (flat <= 0.05) continue;
    let n = nrm(cross(hv, tw));
    if (n[1] < 0) n = n.map((c) => -c);
    // along the spray, a little outward of its middle; the inner spray (sheltered) carries a thin one
    const inner = b.seg === 0, s = (inner ? 0.25 : 0.12) + (rnd() - 0.5) * 0.2, t = (rnd() - 0.5) * 0.3;
    const p = [b.c.x + s * hv[0] + t * tw[0], b.c.y + s * hv[1] + t * tw[1], b.c.z + s * hv[2] + t * tw[2]];
    // snow sits under gravity on a tilted spray: up between the spray's face and straight up; long along the bough
    const Y = nrm([n[0] * 0.4, n[1] * 0.4 + 0.6, n[2] * 0.4]);
    const d = hv[0] * Y[0] + hv[1] * Y[1] + hv[2] * Y[2];
    const X = nrm([hv[0] - d * Y[0], hv[1] - d * Y[1], hv[2] - d * Y[2]]), Z = cross(X, Y);
    const len = 2 * hl * (inner ? 0.62 : 0.75) * (0.85 + 0.3 * rnd());
    const wid = Math.min(len / 2.4, 2 * tl * (inner ? 0.3 : 0.4)) * (0.85 + 0.3 * rnd());
    const hgt = Math.min(0.16, wid * 0.36) * (inner ? 0.6 : 1) * (0.8 + 0.4 * rnd()) * (1.1 - 0.3 * b.l);
    out.push({ p, X, Y, Z, len, wid, hgt, keep: flat * (inner ? 0.45 : 1) * (b.seg === 2 ? 0.8 : 1), thr: 0.03 + 0.6 * Math.pow(rnd(), 1.3) + (inner ? 0.12 : 0) });
  }
  // the leader's cap, on the top whorl
  out.push({ p: [0, 8.16, 0], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1], len: 0.42, wid: 0.36, hgt: 0.16, keep: 9, thr: 0.02 });
  return out;
}

const V_PARS = FIELD_GLSL + /* glsl */ `
uniform float uSnowStick;
attribute vec3 aClLocal; attribute vec4 aClTree; attribute vec4 aClS;
uniform float uTime; uniform vec4 uSnowClump; varying float vClY; varying float vCamDepth;` + SHAKE_GLSL + DROOP_GLSL;
const V_BEGIN = /* glsl */ `#include <begin_vertex>
  float clStick = uSnowStick;
  float clFar = 1.0 - smoothstep(uSnowClump.z, uSnowClump.w, distance(aClTree.xz, uSnowClump.xy));
  float clK; vec3 clA;
  if (aClS.w < 0.5) {
    // a bough's cushion: model point aClLocal of the pine at aClTree (x, ground y, z, yaw), scale aClS.xy
    vec3 clP = aClLocal, clS = vec3(aClS.x, aClS.y, aClS.x);
    float clC = cos(aClTree.w), clSn = sin(aClTree.w);
    #define CL_ROT(v) vec3(clC * (v).x + clSn * (v).z, (v).y, -clSn * (v).x + clC * (v).z)
    // the per-tree variety of fx.js (crown width, height, lean), from the tree's position as it has it
    vec3 clT = clP;
    {
      float t1 = fract(sin(dot(aClTree.xz, vec2(12.9898, 78.233))) * 43758.5453);
      float t2 = fract(t1 * 37.71 + 0.31), t3 = fract(t1 * 91.17 + 0.67), t4 = fract(t1 * 53.3 + 0.13);
      clT.xz *= mix(1.0, mix(0.86, 1.16, t3), smoothstep(0.9, 2.4, clT.y));
      clT.y *= mix(0.9, 1.1, t2);
      float la = t1 * 6.2831;
      clT.xz += vec2(cos(la), sin(la)) * clT.y * 0.035 * t4 * t4;
    }
    clT.y -= snowDroop(clP);                                  // the loaded bough bends down (objects.js)
    // the crowns' sway (the engine's addWind for the tree material: y0 1.5, range 7, amplitude 0.24)
    vec3 clWp = aClTree.xyz + CL_ROT(clP * clS);
    float clHk = pow(clamp((clP.y - 1.5) / 7.0, 0.0, 1.0), 1.6);
    float clG1 = sin(clWp.x * 0.11 + clWp.z * 0.07 - uTime * 1.25), clG2 = sin(clWp.x * 0.043 - clWp.z * 0.061 - uTime * 0.55 + 1.3);
    float clGust = 0.5 + 0.5 * (0.6 * clG1 + 0.4 * clG2); clGust *= clGust;
    float clSw = clHk * 0.24 * (0.3 + 1.5 * clGust), clPh = uTime * 1.6 + clWp.x * 0.21 + clWp.z * 0.17;
    vec2 clDw = vec2(0.9 * clGust + 0.45 * sin(clPh) + 0.2 * sin(clPh * 2.3 + 1.7), 0.55 * clGust + 0.4 * cos(clPh * 0.8) + 0.2 * sin(clPh * 1.9)) * clSw;
    float clTip = clamp(length(clP.xz) / 2.2, 0.0, 1.0);
    float clFl = sin(uTime * 3.3 + clP.x * 2.1 + clP.z * 1.7 + clWp.x * 0.6) + 0.5 * sin(uTime * 7.1 + clP.z * 5.3 + clP.y * 3.0);
    vec3 clLw = vec3(cos(clP.y * 3.0 + uTime * 4.7) * clTip * 0.018 * (0.4 + clGust), clFl * clTip * (0.02 + 0.06 * clGust), sin(clP.x * 3.0 + uTime * 5.3) * clTip * 0.018 * (0.4 + clGust));
    clA = aClTree.xyz + CL_ROT((clT + clLw) * clS) + vec3(clDw.x, 0.0, clDw.y);
    // the canopy load past this cushion's threshold (sigmoid: a thin ridge first, then it bridges and fills out),
    // none where the crown was knocked clear
    float clL = uSnowObj.x, clG = smoothstep(aClS.z, aClS.z + 0.25, clL);
    clK = step(0.001, clG) * snowShaken(aClTree.xz) * clFar;
    // dry snow: a thin narrow ridge; sticky snow bridges along the spray and stands fat
    transformed.x *= mix(0.55, 1.0, clG) * mix(0.85, 1.2, clStick);
    transformed.z *= mix(0.45, 1.0, clG) * mix(0.8, 1.12, clStick);
    transformed.y *= clG * (0.55 + 0.45 * clL) * mix(0.7, 1.12, clStick);
  } else {
    // a cap on an isolated top at aClTree.xyz (yaw w), aClS.x its half-width, aClLocal.y how far above the ground it is:
    // as deep as the snow lies there, no higher than the top can hold at the angle of repose (steeper when sticky)
    float clD = snowField(aClTree.xz).x;
    float clH = min(clD * 0.9, aClS.x * tan(radians(mix(36.0, 70.0, clStick))));
    clK = step(0.004, clD) * smoothstep(clD * 0.9, clD * 0.9 + 0.08, aClLocal.y) * clFar;
    transformed.y *= clH;
    transformed.xz *= mix(1.0, 1.08, clStick);
    clA = aClTree.xyz;
  }
  // sticky snow overhangs: the shoulders stand out past the base
  transformed.xz *= 1.0 + 0.16 * clStick * smoothstep(0.08, 0.35, position.y) * (1.0 - smoothstep(0.5, 0.95, position.y));
  transformed *= clK;
  vClY = position.y;
  vec3 clW = clA + mat3(instanceMatrix) * transformed;`;
const V_WORLD = /* glsl */ `vec4 worldPosition = vec4(clW, 1.0);`;
const V_PROJECT = /* glsl */ `vec4 mvPosition = viewMatrix * vec4(clW, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vCamDepth = -mvPosition.z;`;
const F_PARS = FIELD_GLSL + /* glsl */ `
varying float vClY; varying float vCamDepth; uniform vec2 uPlayerPx; uniform float uPlayerDepth; uniform float uFadeR;`;
// a crown between the camera and the player is seen through (the engine's dithered fade): so is the snow on it
const F_FADE = /* glsl */ `#include <clipping_planes_fragment>
  {
    vec2 dd = (gl_FragCoord.xy - uPlayerPx) / uFadeR;
    float d2 = dot(dd, dd);
    if (d2 < 1.0 && vCamDepth < uPlayerDepth - 0.6) {
      float dn = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
      if (dn > d2 * d2 + 0.12) discard;
    }
  }`;
// the snow's own albedo, kept below paper white so its shading shows; the underside a little darker (it sees the boughs)
const F_COLOR = /* glsl */ `#include <color_fragment>
  diffuseColor.rgb = snowAlbedo(uSnowRef.y, 0.0) * 0.82 * mix(0.84, 1.0, smoothstep(-0.04, 0.2, vClY));`;

export function createClumps(G, U, flags) {
  const T = G.THREE, P = G.player;
  let mesh = null, geo = null, mat = null, tpl = null, count = 0, caps = 0, idleT = 0, lodT = 0, fadeR = R;
  let at = null, removedN = -1, chunksN = -1, sig = '';
  let aLocal, aTree, aS, rockTop = null;
  const _ax = new T.Vector3();

  function allocate() {
    if (!tpl) tpl = [template(G.pineBoughs[0]), template(G.pineBoughs[1])];
    geo = cushionGeometry(T);
    aLocal = new T.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    aTree = new T.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    aS = new T.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    geo.setAttribute('aClLocal', aLocal); geo.setAttribute('aClTree', aTree); geo.setAttribute('aClS', aS);
    mat = new T.MeshLambertMaterial({ color: 0xffffff });
    const TU = G.treeU || {};
    mat.onBeforeCompile = (sh) => {
      for (const k of U_NAMES) sh.uniforms[k] = U[k];
      sh.uniforms.uTime = TU.time || { value: 0 };
      sh.uniforms.uPlayerPx = TU.playerPx || { value: new T.Vector2() };
      sh.uniforms.uPlayerDepth = TU.playerDepth || { value: -1e9 };
      sh.uniforms.uFadeR = TU.fadeR || G.fadeR || { value: 100 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + V_PARS)
        .replace('#include <begin_vertex>', V_BEGIN)
        .replace('#include <worldpos_vertex>', V_WORLD)
        .replace('#include <project_vertex>', V_PROJECT);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + F_PARS)
        .replace('#include <lights_lambert_pars_fragment>', '#include <lights_lambert_pars_fragment>\n' + SNOW_LIGHT_GLSL)
        .replace('#include <clipping_planes_fragment>', F_FADE)
        .replace('#include <color_fragment>', F_COLOR);
    };
    mat.customProgramCacheKey = () => 'snow-clumps-2';
    mesh = new T.InstancedMesh(geo, mat, MAX);
    mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; mesh.name = 'snow-clumps';
    G.scene.add(mesh);
    at = null;
  }
  function release() {
    if (!mesh) return;
    G.scene.remove(mesh); geo.dispose(); mat.dispose(); mesh.dispose();
    mesh = geo = mat = null; count = caps = 0; at = null;
    U.uSnowObj.value.w = 0;
  }

  const liteOf = (c) => (c.treeMeshes && c.treeMeshes[0] && G.pineLite && c.treeMeshes[0].geometry === G.pineLite ? 1 : 0);
  function nearChunks(r) {
    const cs = G.chunkSize || 32, out = [];
    for (const c of G.world.chunks.values()) if (Math.abs(c.ox + cs / 2 - P.x) <= r + cs / 2 && Math.abs(c.oz + cs / 2 - P.z) <= r + cs / 2) out.push(c);
    return out;
  }
  // what makes the list stale besides moving: pine models swapped, logs rolled or were cut
  function signature(chunks) {
    let s = '';
    for (const c of chunks) if (liteOf(c)) s += c.key + ';';
    for (const L of G.world.logs || []) s += Math.round(L.x * 4) + ',' + Math.round(L.z * 4) + ',' + L.stage + ';';
    return s;
  }
  // the rock model's top (shared by every rock): its highest point and how wide the top is 0.25 below it
  function rockTopOf(g) {
    if (rockTop || !g) return rockTop;
    const p = g.attributes.position;
    let y1 = -1e9;
    for (let i = 0; i < p.count; i++) y1 = Math.max(y1, p.getY(i));
    let r = 0;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > y1 - 0.25) r = Math.max(r, Math.hypot(p.getX(i), p.getZ(i)));
    rockTop = { y: y1, r };
    return rockTop;
  }

  // one instance: matrix columns X, Y, Z (world, scaled) and its attributes
  function put(n, X, Y, Z, loc, tree, s) {
    const M = mesh.instanceMatrix.array, o = n * 16;
    M[o] = X[0]; M[o + 1] = X[1]; M[o + 2] = X[2]; M[o + 3] = 0;
    M[o + 4] = Y[0]; M[o + 5] = Y[1]; M[o + 6] = Y[2]; M[o + 7] = 0;
    M[o + 8] = Z[0]; M[o + 9] = Z[1]; M[o + 10] = Z[2]; M[o + 11] = 0;
    M[o + 12] = 0; M[o + 13] = 0; M[o + 14] = 0; M[o + 15] = 1;
    aLocal.array.set(loc, n * 3); aTree.array.set(tree, n * 4); aS.array.set(s, n * 4);
  }
  // a cap on a top: centre x, top y, z, how high above the ground, yaw, size along and across (m), tilt along
  function cap(n, x, y, z, clear, yaw, along, across, tilt = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
    put(n, [c * ct * along, st * along, -s * ct * along], [-c * st, ct, s * st], [s * across, 0, c * across], [0, clear, 0], [x, y - 0.02, z, yaw], [Math.min(along, across) / 2, 0, 0, 1]);
  }

  function rebuild() {
    const RR = R + REBUILD, chunks = nearChunks(RR), list = [];
    at = [P.x, P.z]; removedN = G.world.removed ? G.world.removed.size : 0; chunksN = G.world.chunks.size; sig = signature(chunks);
    const near = (x, z) => Math.hypot(x - P.x, z - P.z) < RR;
    let n = 0;
    // caps first (few): rocks, stumps, logs
    for (const c of chunks) {
      const gyOf = (x, z) => (c.heightLocal ? c.heightLocal(x - c.ox, z - c.oz) : G.heightAt(x, z));
      const rt = c.rockMesh ? rockTopOf(c.rockMesh.geometry) : null;
      if (rt) for (const r of c.rocks || []) {
        if (!r.alive || !near(r.x, r.z) || n >= MAX) continue;
        // the engine's rock: its shared model at (x, ground - 0.05, z), yaw rot, scale (s, s * (0.7 .. 1.2), s)
        const sy = r.scale * (0.7 + (r.rot % 1) * 0.5), clear = rt.y * sy, w = 2 * rt.r * r.scale * 0.85;
        cap(n++, r.x, gyOf(r.x, r.z) - 0.05 + clear, r.z, clear, r.rot, w, w * 0.9);
      }
      for (const tr of c.trees) {
        if (tr.alive || !near(tr.x, tr.z) || n >= MAX) continue;
        // a stump: the engine's cylinder, top radius 0.9 at 0.45 up, scaled by the tree's radius and scale
        const s = G.treeKinds[tr.type].r * tr.scale, clear = 0.45 * tr.scale - 0.05, w = 2 * 0.9 * s;
        cap(n++, tr.x, gyOf(tr.x, tr.z) + clear, tr.z, clear, tr.rot, w, w);
      }
    }
    for (const L of G.world.logs || []) {
      if (!near(L.x, L.z) || n >= MAX || !L.mesh) continue;
      // a log lies along its yaw, tilted with the ground; its top line is about a radius above its centre
      _ax.set(1, 0, 0).applyQuaternion(L.mesh.quaternion);
      const tilt = Math.asin(Math.max(-1, Math.min(1, _ax.y)));
      cap(n++, L.mesh.position.x, L.mesh.position.y + L.r * 0.97, L.mesh.position.z, L.r * 2, L.yaw, L.len * 0.9, 2 * L.r * 0.8, tilt);
    }
    caps = n;
    // the pines, nearest first: as many spots each as the budget allows over the pines listed
    for (const c of chunks) {
      const lite = liteOf(c);
      for (const tr of c.trees) if (tr.alive && tr.type === 0) { const d = Math.hypot(tr.x - P.x, tr.z - P.z); if (d < RR) list.push([d, tr, lite]); }
    }
    list.sort((a, b) => a[0] - b[0]);
    const per = Math.max(PER_TREE[0], Math.min(PER_TREE[1], Math.floor((MAX - n) / Math.max(1, list.length))));
    let coverR = R;
    for (const [d, tr, lite] of list) {
      const spots = tpl[lite], rnd = mulberry(hash3(Math.round(tr.x * 100), Math.round(tr.z * 100), 7));
      const want = d < 25 ? per : Math.max(PER_TREE[0], Math.round(per * 0.75));
      const frac = Math.min(1.6, (want / spots.length) * 1.4);
      if (n + Math.ceil(want * 1.3) > MAX) { coverR = Math.max(10, d - REBUILD); break; }
      const c = tr.chunk, gy = c && c.heightLocal ? c.heightLocal(tr.x - c.ox, tr.z - c.oz) - 0.08 : G.heightAt(tr.x, tr.z) - 0.08;
      const wq = tr.scale * (0.84 + ((tr.rot * 7.31) % 1) * 0.34), sy = tr.scale * (0.9 + ((tr.rot * 3.17) % 1) * 0.24);
      const cr = Math.cos(tr.rot), sr = Math.sin(tr.rot);
      // a model-space axis to world: the tree's scale, then its yaw
      const toW = (v, k) => { const x = v[0] * wq * k, y = v[1] * sy * k, z = v[2] * wq * k; return [cr * x + sr * z, y, -sr * x + cr * z]; };
      for (const sp of spots) {
        const r0 = rnd(), r1 = rnd(), r2 = rnd();
        if (r0 > frac * sp.keep && sp.keep < 5) continue;
        if (n >= MAX) break;
        const k = 0.85 + 0.3 * r1;
        put(n++, toW(sp.X, sp.len * k), toW(sp.Y, (sp.hgt * (0.8 + 0.4 * r2) * wq) / sy), toW(sp.Z, sp.wid * k), sp.p, [tr.x, gy, tr.z, tr.rot], [wq, sy, Math.min(0.9, sp.thr + (r2 - 0.5) * 0.08), 0]);
      }
    }
    count = n; mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    aLocal.needsUpdate = aTree.needsUpdate = aS.needsUpdate = true;
    fadeR = Math.min(R, coverR);
  }

  return {
    get count() { return mesh ? count : 0; },
    get caps() { return mesh ? caps : 0; },
    get triangles() { return mesh && geo ? count * (geo.index.count / 3) : 0; },
    release,
    // want: snow lies and objects are covered. Drawn while the crowns hold snow or it lies on the ground
    update(dt, want) {
      const ok = want && flags.clumps && G.pineBoughs && G.pineBoughs[0].length && G.world;
      if (!ok) { release(); return; }
      const load = U.uSnowObj.value.x, ground = U.uSnowRef.value.x > 0.004 || U.uSnowFieldWin.value.w > 0.5;
      if (load <= 0.005 && !ground) { if (mesh) { idleT += dt; U.uSnowObj.value.w = 0; mesh.visible = false; if (idleT > 10) release(); } return; }
      idleT = 0;
      if (!mesh) allocate();
      mesh.visible = true;
      U.uSnowObj.value.w = 1;
      // the cheap check: moved far enough, a tree came down, a chunk came or went; models swapped, logs moved (2 Hz)
      let stale = !at || Math.hypot(P.x - at[0], P.z - at[1]) > REBUILD || (G.world.removed && G.world.removed.size !== removedN) || G.world.chunks.size !== chunksN;
      lodT -= dt;
      if (!stale && lodT <= 0) { lodT = 0.5; stale = signature(nearChunks(R + REBUILD)) !== sig; }
      if (stale) rebuild();
      U.uSnowClump.value.set(P.x, P.z, fadeR - FADE, fadeR);
    },
  };
}
