// The land beyond the loaded world: a coarse sheet of the same terrain (8 m cells) out to about 400 m, coloured by
// what grows there, with the forest's canopy raised over it, so the view runs out over hills and tree lines to the
// sky instead of into a wall of fog where the world stops loading (about 100 m out). It is drawn only outside the
// loaded chunks (a small mask of which chunks are loaded; pixels inside them are dropped), sits a little low so the
// real ground always wins at the seam, and fades into the haze toward its far edge. Lit like the terrain (Lambert,
// no shadows); the canopy has a blocky speckle of crowns, in keeping with the pixel textures near by.
//
// The grid is fixed to the world (re-centred in 32 m steps), so nothing swims as you walk; heights are cached by
// grid point, so a step only works out the new strip along the far edge.
import * as THREE from 'three';

const CELL = 8, HALF = 400, NV = (2 * HALF) / CELL + 1, MASK = 32, HZ = 128;

export function createFarLand({ scene, baseHeight, forestAt, chunks, CS, SEA, PAL, smoothstep }) {
  const cache = new Map();
  const pos = new Float32Array(NV * NV * 3), colr = new Float32Array(NV * NV * 3), canopy = new Float32Array(NV * NV);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  geo.setAttribute('canopy', new THREE.BufferAttribute(canopy, 1));
  const wet = new Float32Array(NV * NV);
  geo.setAttribute('wet', new THREE.BufferAttribute(wet, 1));
  const idx = new Uint32Array((NV - 1) * (NV - 1) * 6);
  let q = 0;
  for (let j = 0; j < NV - 1; j++) for (let i = 0; i < NV - 1; i++) {
    const a = j * NV + i, b = a + 1, c = a + NV, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(NV * NV * 3), 3));

  // which chunks are loaded, round the centre chunk (1 = loaded: the far land is not drawn there)
  const maskData = new Uint8Array(MASK * MASK);
  const maskTex = new THREE.DataTexture(maskData, MASK, MASK, THREE.RedFormat, THREE.UnsignedByteType);
  maskTex.magFilter = maskTex.minFilter = THREE.NearestFilter;
  // round the horizon: is the far edge sea (255) or land (0)? The sky dome draws open sea past the far land only where
  // the sea carries on
  const hzData = new Uint8Array(HZ), hzTex = new THREE.DataTexture(hzData, HZ, 1, THREE.RedFormat, THREE.UnsignedByteType);
  hzTex.magFilter = hzTex.minFilter = THREE.LinearFilter; hzTex.wrapS = THREE.RepeatWrapping;
  const uMask = { value: maskTex }, uMaskOrg = { value: new THREE.Vector3(0, 0, CS) }, uFade = { value: new THREE.Vector2(240, 385) }, uHaze = { value: 0.3 };
  let openSea = true;

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMask = uMask; sh.uniforms.uMaskOrg = uMaskOrg; sh.uniforms.uFade = uFade; sh.uniforms.uHaze = uHaze;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float canopy;\nattribute float wet;\nvarying vec3 vFarW;\nvarying float vCanopy;\nvarying float vWet;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFarW = (modelMatrix * vec4(transformed, 1.0)).xyz; vCanopy = canopy; vWet = wet;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uMask; uniform vec3 uMaskOrg; uniform vec2 uFade; uniform float uHaze;
varying vec3 vFarW; varying float vCanopy; varying float vWet;
float farHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (vFarW.y < ${SEA.toFixed(2)} + 0.02) discard;   // the sea (and land across it, sunk): the sky dome's open sea shows there
{
  vec2 cc = floor(vFarW.xz / uMaskOrg.z) - uMaskOrg.xy;
  if (cc.x >= 0.0 && cc.y >= 0.0 && cc.x < ${MASK}.0 && cc.y < ${MASK}.0 && texture2D(uMask, (cc + 0.5) / ${MASK}.0).r > 0.5) discard;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // crowns: blocks of light and shade across the canopy, and a fainter mottle on open ground
  vec2 cb = floor(vFarW.xz / 2.5);
  float n = farHash(cb), n2 = farHash(floor(vFarW.xz / 7.0) + 13.0);
  diffuseColor.rgb *= mix(0.94 + 0.12 * n2, 0.72 + 0.42 * n, smoothstep(0.1, 0.6, vCanopy));
}`)
      .replace('#include <fog_fragment>', THREE.ShaderChunk.fog_fragment.replace('vec3 fogTint = fogColor;',
        'fogFactor = max(max(fogFactor, uHaze * smoothstep(90.0, 380.0, vFogDepth)), smoothstep(uFade.x, uFade.y, vFogDepth));\n\tvec3 fogTint = fogColor;'));
  };
  mat.customProgramCacheKey = () => 'far-land-5';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.renderOrder = 1;                              // after the near world, so most of it is hidden by depth
  scene.add(mesh);

  const _c = new THREE.Color(), crown = new THREE.Color(0x355a2c), pine = new THREE.Color(0x2a4a2a), waterC = new THREE.Color(0x5d7f8f);
  function point(gx, gz) {
    const k = gx + ',' + gz;
    let e = cache.get(k);
    if (e) return e;
    const x = gx * CELL, z = gz * CELL, h = baseHeight(x, z), f = forestAt(x, z);
    // the same rules as the trees near by (engine.js, Chunk): denser with the forest, none on the shore, thinning
    // high up
    let d = 0.03 + 0.6 * smoothstep(0.0, 0.45, f);
    d *= 1 - smoothstep(17, 24, h);
    if (h < 1.3) d = 0;
    const cov = smoothstep(0.12, 0.5, d);
    if (h < SEA - 0.2) _c.copy(waterC);
    else {
      _c.copy(PAL.meadow).lerp(PAL.forest, smoothstep(-0.1, 0.35, f));
      _c.lerp(PAL.sand, 1 - smoothstep(0.7, 1.5, h));
      _c.lerp(PAL.rock, smoothstep(19, 25, h));
      _c.lerp(PAL.snow, smoothstep(29, 33, h));
      _c.lerp(f > 0.25 || h > 12 ? pine : crown, cov * 0.9);
    }
    _c.multiplyScalar(0.86);
    e = [Math.max(h, SEA - 0.3) + cov * 11 - 0.6, _c.r, _c.g, _c.b, cov];
    cache.set(k, e);
    return e;
  }

  let cgx = null, cgz = null, maskKey = '', cmx = 0, cmz = 0;
  function rebuild(gx0, gz0) {
    for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
      const v = j * NV + i, e = point(gx0 + i, gz0 + j);
      pos[v * 3] = (gx0 + i) * CELL; pos[v * 3 + 1] = e[0]; pos[v * 3 + 2] = (gz0 + j) * CELL;
      colr[v * 3] = e[1]; colr[v * 3 + 1] = e[2]; colr[v * 3 + 2] = e[3]; canopy[v] = e[4];
    }
    // the sea, and any land across it: only the land you are on (and whatever of it is loaded) stays
    const land = (v) => pos[v * 3 + 1] - canopy[v] * 11 + 0.6 > SEA + 0.15;
    const seen = new Uint8Array(NV * NV), stack = [];
    const c0x = Math.floor(cmx / CS), c0z = Math.floor(cmz / CS);
    for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
      const v = j * NV + i, x = pos[v * 3], z = pos[v * 3 + 2];
      const near = Math.abs(Math.floor(x / CS) - c0x) <= 4 && Math.abs(Math.floor(z / CS) - c0z) <= 4;
      if (near && land(v)) { seen[v] = 1; stack.push(v); }
    }
    while (stack.length) {
      const v = stack.pop(), i = v % NV, j = (v - i) / NV;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + a, jj = j + b;
        if (ii < 0 || jj < 0 || ii >= NV || jj >= NV) continue;
        const w = jj * NV + ii;
        if (!seen[w] && land(w)) { seen[w] = 1; stack.push(w); }
      }
    }
    // and land across a wide water (more than about 90 m of it, looking out from where you are) goes too: past
    // the shore the view opens onto sea all the way to the horizon
    const BINS = 720, cut = new Float32Array(BINS), mid0 = (NV - 1) / 2;
    for (let b = 0; b < BINS; b++) {
      const ang = (b + 0.5) / BINS * Math.PI * 2 - Math.PI, cx = Math.cos(ang), cz = Math.sin(ang);
      let run = 0; cut[b] = 1e9;
      for (let r = 0; r <= HALF; r += 4) {
        const i = Math.round(mid0 + cx * r / CELL), j = Math.round(mid0 + cz * r / CELL);
        if (i < 0 || j < 0 || i >= NV || j >= NV) break;
        if (land(j * NV + i)) run = 0; else if ((run += 4) > 90) { cut[b] = r - run; break; }
      }
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
      const v = j * NV + i, dx = i - mid0, dz = j - mid0;
      const b = Math.min(BINS - 1, Math.floor((Math.atan2(dz, dx) + Math.PI) / (Math.PI * 2) * BINS));
      wet[v] = !land(v) || (openSea && (!seen[v] || Math.hypot(dx, dz) * CELL > cut[b])) ? 1 : 0;
    }
    // sunk under the water, so a shore slopes into the sea and is cut cleanly at the waterline
    for (let v = 0; v < NV * NV; v++) if (wet[v]) { pos[v * 3 + 1] = SEA - 4; canopy[v] = 0; }
    // the horizon mask: sea where most of the outer ring in that direction is wet
    const mid = (NV - 1) / 2;
    for (let a = 0; a < HZ; a++) {
      const ang = (a + 0.5) / HZ * Math.PI * 2 - Math.PI;
      let n = 0, w = 0;
      for (let r = mid * 0.82; r < mid; r += 1.5) {
        const i = Math.round(mid + Math.cos(ang) * r), j = Math.round(mid + Math.sin(ang) * r);
        n++; w += wet[j * NV + i];
      }
      hzData[a] = w / n > 0.5 ? 255 : 0;
    }
    hzTex.needsUpdate = true;
    geo.computeVertexNormals();
    geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = geo.attributes.canopy.needsUpdate = geo.attributes.wet.needsUpdate = true;
    // forget points well behind
    if (cache.size > NV * NV * 2) for (const k of cache.keys()) {
      const [a, b] = k.split(',').map(Number);
      if (Math.abs(a - gx0 - NV / 2) > NV || Math.abs(b - gz0 - NV / 2) > NV) cache.delete(k);
    }
  }
  function updateMask(px, pz) {
    const c0x = Math.floor(px / CS) - MASK / 2, c0z = Math.floor(pz / CS) - MASK / 2;
    const key = c0x + ',' + c0z + ',' + chunks.size;
    if (key === maskKey) return;
    maskKey = key;
    for (let j = 0; j < MASK; j++) for (let i = 0; i < MASK; i++) maskData[j * MASK + i] = chunks.has((c0x + i) + ',' + (c0z + j)) ? 255 : 0;
    maskTex.needsUpdate = true;
    uMaskOrg.value.set(c0x, c0z, CS);
  }
  return {
    mesh, horizon: hzTex,
    // the far land's centre (the horizon mask is round it)
    get centre() { return [(cgx + (NV - 1) / 2) * CELL, (cgz + (NV - 1) / 2) * CELL]; },
    // once a frame: re-centre in 32 m steps, refresh the mask when the loaded chunks change
    update(px, pz) {
      const gx = Math.round(px / 32) * (32 / CELL) - (NV - 1) / 2, gz = Math.round(pz / 32) * (32 / CELL) - (NV - 1) / 2;
      if (gx !== cgx || gz !== cgz) { cgx = gx; cgz = gz; cmx = px; cmz = pz; rebuild(gx, gz); }
      updateMask(px, pz);
    },
    setOn(v) { mesh.visible = v; },
    // leave out land across wide water (the open sea horizon), or keep it
    setOpenSea(v) { if (v !== openSea) { openSea = v; cgx = cgz = null; } },
    // how much of the way into the haze the far land goes besides the fog (0.3 normal)
    setHaze(k) { uHaze.value = k; },
    reset() { cache.clear(); cgx = cgz = null; maskKey = ''; },
  };
}
