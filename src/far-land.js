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

const CELL = 8, HALF = 400, NV = (2 * HALF) / CELL + 1, MASK = 32;

export function createFarLand({ scene, baseHeight, forestAt, chunks, CS, SEA, PAL, smoothstep }) {
  const cache = new Map();
  const pos = new Float32Array(NV * NV * 3), colr = new Float32Array(NV * NV * 3), canopy = new Float32Array(NV * NV);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  geo.setAttribute('canopy', new THREE.BufferAttribute(canopy, 1));
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
  const uMask = { value: maskTex }, uMaskOrg = { value: new THREE.Vector3(0, 0, CS) }, uFade = { value: new THREE.Vector2(240, 385) };

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMask = uMask; sh.uniforms.uMaskOrg = uMaskOrg; sh.uniforms.uFade = uFade;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float canopy;\nvarying vec3 vFarW;\nvarying float vCanopy;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFarW = (modelMatrix * vec4(transformed, 1.0)).xyz; vCanopy = canopy;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uMask; uniform vec3 uMaskOrg; uniform vec2 uFade;
varying vec3 vFarW; varying float vCanopy;
float farHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
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
        'fogFactor = max(fogFactor, smoothstep(uFade.x, uFade.y, vFogDepth));\n\tvec3 fogTint = fogColor;'));
  };
  mat.customProgramCacheKey = () => 'far-land-1';
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

  let cgx = null, cgz = null, maskKey = '';
  function rebuild(gx0, gz0) {
    for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
      const v = j * NV + i, e = point(gx0 + i, gz0 + j);
      pos[v * 3] = (gx0 + i) * CELL; pos[v * 3 + 1] = e[0]; pos[v * 3 + 2] = (gz0 + j) * CELL;
      colr[v * 3] = e[1]; colr[v * 3 + 1] = e[2]; colr[v * 3 + 2] = e[3]; canopy[v] = e[4];
    }
    geo.computeVertexNormals();
    geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = geo.attributes.canopy.needsUpdate = true;
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
    mesh,
    // once a frame: re-centre in 32 m steps, refresh the mask when the loaded chunks change
    update(px, pz) {
      const gx = Math.round(px / 32) * (32 / CELL) - (NV - 1) / 2, gz = Math.round(pz / 32) * (32 / CELL) - (NV - 1) / 2;
      if (gx !== cgx || gz !== cgz) { cgx = gx; cgz = gz; rebuild(gx, gz); }
      updateMask(px, pz);
    },
    setOn(v) { mesh.visible = v; },
    reset() { cache.clear(); cgx = cgz = null; maskKey = ''; },
  };
}
