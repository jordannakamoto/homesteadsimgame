// Snow on the terrain and the grass, driven by the field: the terrain is whitened per fragment (one field fetch, plus
// the live texture near the player, so a footprint in thin snow shows the ground and a cleared path is brown at any
// distance), with the same albedo as the snow surface so the two meet; a grass tuft reads the field once per vertex
// at its root: shorter than the snow, it is collapsed (no fill cost); taller, it is weighed down and its tips whitened.
// The patches are compiled in only while snow lies (on); off, the materials compile exactly as before.
import { FIELD_GLSL, LIVE_GLSL } from './shade.js';

const U_NAMES = ['uSnowField', 'uSnowFieldWin', 'uSnowRef', 'uSnowWind', 'uSnowFlags', 'uSnowFlags2', 'uSnowLive', 'uSnowLiveWin', 'uSnowLiveTexel', 'uSnowCenter'];

const TERRAIN_F = /* glsl */ `#include <normal_fragment_maps>
  {
    vec4 sF = snowField(vSnowW.xz);
    float sS = snowSquash(sF), sP = sF.z, sCl = 0.0;
    #ifdef SNOW_LIVE
    if (snowInLive(vSnowW.xz, 0.2)) { vec4 l = texture(uSnowLive, vSnowW.xz / uSnowLiveWin.z); sP = max(sP * 0.6, l.r); sCl = l.a; }
    #endif
    float sD = sF.x * (1.0 - sCl) - sP * sS;
    // thin snow lies in patches; from about 4 cm it covers
    float sN = snowNoise2(vSnowW.xz * 0.45) * 0.65 + snowNoise2(vSnowW.xz * 2.1) * 0.35;
    float sCov = smoothstep(0.03 * sN, 0.03 * sN + 0.012, sD) * smoothstep(0.5, 0.85, dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)));
    // the ground's light is softer (it wraps further) than the snow surface's, and its sky light is not tinted: a touch
    // darker and bluer here so they meet
    diffuseColor.rgb = mix(diffuseColor.rgb, snowAlbedo(sF.y, sP) * vec3(0.82, 0.85, 0.9), sCov);
  }`;
const GRASS_V = /* glsl */ `#include <begin_vertex>
  vSnowTip = 0.0; vSnowStraw = 0.0;
  #ifdef USE_INSTANCING
  if (uSnowFlags2.x > 0.5) {
    vec2 sR = instanceMatrix[3].xz;
    vec4 sF = snowField(sR);
    float sD = sF.x - sF.z * snowSquash(sF);
    #ifdef SNOW_LIVE
    if (snowInLive(sR, 0.2)) { vec4 l = textureLod(uSnowLive, sR / uSnowLiveWin.z, 2.0); sD = sF.x * (1.0 - l.a) - max(sF.z, l.r) * snowSquash(sF); }
    #endif
    float sTh = 0.62 * length(instanceMatrix[1].xyz);            // the tuft's height
    float sHash = snowHash12(floor(sR * 37.0) + 0.5);
    if (sD > 0.06 + 0.04 * sHash) {
      // winter grass is dead and lies flat under the snow: every tuft whose root is covered is gone, but for one in
      // twelve left standing as a few short pale-straw stalks, thin, a hand above the snow
      if (fract(sHash * 12.9898) < 1.0 / 16.0) {
        // where the snow surface has its real depth the stalk stands in it; further out (the ground is only whitened
        // there) it shows just what would stand clear, so no ring of taller stalks marks where the deep snow ends
        float sIn = 1.0 - smoothstep(uSnowCenter.z - 7.0, uSnowCenter.z - 0.4, length(sR - uSnowCenter.xy));
        float sTop = min(sTh, sD * sIn + 0.06 + 0.16 * fract(sHash * 7.31));
        transformed.y *= sTop / max(sTh, 0.05);
        transformed.xz *= 0.45;
        vSnowStraw = 1.0;
      } else vSnowBury = 1.0;
    } else {
      float sK = clamp(sD / max(sTh, 0.05), 0.0, 1.5);
      // first snow: weighed down and splayed by it; buried when what is left would not clear it
      float sSq = 0.75 * min(sK * 2.5, 1.0);                     // snow lies on the blades and flattens them
      transformed.y *= 1.0 - sSq;
      transformed.xz *= 1.0 + 0.4 * min(sK, 1.0);
      vSnowTip = sK > 0.0 ? clamp(sK * 2.0, 0.0, 0.85) * smoothstep(0.1, 1.0, position.y / 0.62) : 0.0;
      vSnowBury = (sTh * (1.0 - sSq) < sD + 0.03) ? 1.0 : 0.0;
    }
  }
  #endif`;
const GRASS_F = /* glsl */ `
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.50, 0.43, 0.27), vSnowStraw);   // dead straw, pale
  diffuseColor.rgb = mix(diffuseColor.rgb, snowAlbedo(uSnowRef.y, 0.0) * 0.8, vSnowTip);
  #include <lights_lambert_fragment>`;

export function createGroundPatches(G, U) {
  const done = new WeakSet(), mats = [];
  let on = false, live = false;
  function patch(mat, kind) {
    if (!mat || done.has(mat)) return;
    done.add(mat); mats.push(mat);
    const before = mat.onBeforeCompile, keyBefore = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (sh, r) {
      if (before) before.call(this, sh, r);
      if (!on) return;
      for (const k of U_NAMES) sh.uniforms[k] = U[k];
      const def = live ? '#define SNOW_LIVE\n' : '';
      if (kind === 'ground') {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSnowW;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvSnowW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + def + FIELD_GLSL + LIVE_GLSL + '\nvarying vec3 vSnowW;')
          .replace('#include <normal_fragment_maps>', TERRAIN_F);
      } else {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + def + FIELD_GLSL + LIVE_GLSL + '\nuniform vec3 uSnowCenter; varying float vSnowTip; varying float vSnowStraw; float vSnowBury = 0.0;')
          .replace('#include <begin_vertex>', GRASS_V)
          .replace('#include <project_vertex>', '#include <project_vertex>\nif (vSnowBury > 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FIELD_GLSL + '\nvarying float vSnowTip; varying float vSnowStraw;')
          .replace('#include <lights_lambert_fragment>', GRASS_F);
      }
    };
    mat.customProgramCacheKey = function () { return (keyBefore ? keyBefore.call(this) : '') + '|snow' + (on ? (live ? 'L' : 'F') : '0') + kind; };
    mat.needsUpdate = true;
  }
  // the terrain and grass materials are shared by every chunk: find them once
  function find() {
    let t = false, g = false;
    for (const c of G.world.chunks.values()) {
      if (c.terrain) { patch(c.terrain.material, 'ground'); t = true; }
      if (c.grassMesh) { patch(c.grassMesh.material, 'grass'); g = true; }
      if (t && g) break;
    }
    return t;
  }
  return {
    get on() { return on; }, get patched() { return mats.length > 0; },
    // on: snow lies; live: the live deformation texture exists (the surface tiers)
    set(o, l) {
      if (o && !mats.length) find();
      if (o === on && l === live) return;
      on = o; live = l;
      for (const m of mats) m.needsUpdate = true;
    },
    find,
  };
}
