// The look of snow: the GLSL shared by every material that shows snow (the field, the live deformation, the ground
// under the snow, the albedo), and the material of the snow surface itself: a MeshLambertMaterial whose direct light
// is replaced so light wraps past the terminator and comes back bluer where it travelled far through the snow, thin
// raised lips glow when lit from behind, ruts hide the sky, and fresh snow sparkles with a few stable glints.
// Shadows, fog, the lights themselves and tone mapping stay the engine's.

// ---------------------------------------------------------------- shared chunks (also __snow.glsl)
// The field: depth before packing, density / 600, packed fraction; the reference pack beyond its window, blended over
// 6 m so its edge never shows.
export const FIELD_GLSL = /* glsl */ `
uniform sampler2D uSnowField; uniform vec4 uSnowFieldWin; uniform vec4 uSnowRef; uniform vec4 uSnowWind; uniform vec4 uSnowFlags; uniform vec4 uSnowFlags2;
float snowHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float snowNoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(snowHash12(i), snowHash12(i + vec2(1.0, 0.0)), f.x), mix(snowHash12(i + vec2(0.0, 1.0)), snowHash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec4 snowField(vec2 w) {
  vec4 ref = vec4(uSnowRef.x, uSnowRef.y, 0.0, 0.0);
  if (uSnowFieldWin.w < 0.5) return ref;
  vec2 e2 = min(w - uSnowFieldWin.xy, uSnowFieldWin.xy + uSnowFieldWin.z - w);
  float k = smoothstep(0.75, 6.75, min(e2.x, e2.y));
  if (k <= 0.0) return ref;
  return mix(ref, texture(uSnowField, w / uSnowFieldWin.z), k);
}
// the most this column can be pressed down (m): the gap between its density and packed snow's
float snowSquash(vec4 F) { return F.x * clamp(1.0 - F.y * (600.0 / 450.0), 0.0, 0.9); }
// albedo, linear: fresh powder, a week old, a touch darker when wet or packed. Cool on purpose: the engine's grade and
// haze are warm (set for grass and soil), and snow that is neutral before them reads beige after them.
vec3 snowAlbedo(float rho600, float packed) {
  float age = max(smoothstep(0.2, 0.5, rho600) - uSnowRef.z * 0.6, 0.0);
  vec3 a = mix(vec3(0.88, 0.93, 1.0), vec3(0.80, 0.85, 0.91), age);
  // x 0.9: at full albedo open snow in sun tone-maps to flat paper white
  return a * 0.9 * (1.0 - 0.08 * uSnowRef.w) * (1.0 - 0.06 * packed);
}`;
// The live deformation: press, rim, rough, cleared, in a toroidal window of uSnowLiveWin.z metres round its centre.
export const LIVE_GLSL = /* glsl */ `
uniform sampler2D uSnowLive; uniform vec4 uSnowLiveWin; uniform float uSnowLiveTexel;
bool snowInLive(vec2 w, float margin) { vec2 d = abs(w - uSnowLiveWin.xy); return uSnowLiveWin.w > 0.5 && max(d.x, d.y) < uSnowLiveWin.z * 0.5 - margin; }
vec4 snowLive(vec2 w, float lod) { return textureLod(uSnowLive, w / uSnowLiveWin.z, lod); }
// height the live layer adds (m), S the column's squash: pressed down; what was pushed out lying beside the print in
// clumps (up to half the squash, 16 cm at most; the ones that fell back in make the floor lumpy); crumbs
float snowLiveH(vec4 l, float S) { return -l.r * S + uSnowFlags.z * min(0.16, 0.5 * S) * l.g * (1.0 - 0.75 * smoothstep(0.1, 0.6, l.r)) + 0.012 * l.b; }`;
// The ground under the snow: the terrain mesh's height at 0.5 m lattice points, interpolated over each 0.5 m cell
// split along the same diagonal as the terrain's 1 m quads, so it is the drawn terrain exactly.
export const GROUND_GLSL = /* glsl */ `
uniform highp sampler2D uSnowGround;
float snowGroundAt(ivec2 c) { return texelFetch(uSnowGround, c & ivec2(${127}), 0).r; }
float snowGround(vec2 w) {
  vec2 g = w * 2.0, i = floor(g), f = g - i; ivec2 c = ivec2(i);
  if (f.x + f.y <= 1.0) { float h00 = snowGroundAt(c); return h00 + f.x * (snowGroundAt(c + ivec2(1, 0)) - h00) + f.y * (snowGroundAt(c + ivec2(0, 1)) - h00); }
  float h11 = snowGroundAt(c + ivec2(1, 1));
  return h11 + (1.0 - f.x) * (snowGroundAt(c + ivec2(0, 1)) - h11) + (1.0 - f.y) * (snowGroundAt(c + ivec2(1, 0)) - h11);
}
// open snow is never a flat plane: two octaves of swell (2.7 m and 0.9 m, +-10 and +-4 percent), stretched along
// the wind where the wind has worked it
float snowUndulate(vec2 w) {
  if (uSnowFlags.w < 0.5) return 1.0;
  vec2 d = uSnowWind.xy; float s = uSnowWind.w;
  vec2 q = vec2(dot(w, d), dot(w, vec2(-d.y, d.x)));
  q.x *= 1.0 - 0.6 * s;                                        // drifts run long along the wind
  return 1.0 + 0.2 * (snowNoise2(q / 2.7) - 0.5) + 0.08 * (snowNoise2(q / 0.9 + 17.0) - 0.5);
}`;

// ---------------------------------------------------------------- the snow surface's material
const V_PARS = FIELD_GLSL + LIVE_GLSL + GROUND_GLSL + /* glsl */ `
uniform vec3 uSnowCenter; uniform sampler2D uSkyMap; uniform float uSkyK; uniform float uSkySize;
uniform sampler2D uSnowLumps; uniform sampler2D uSnowDrape; uniform vec4 uSnowTune; uniform vec4 uSnowTune2;
varying vec3 vSnowW; varying vec4 vSnowA; varying vec4 vSnowF; varying vec2 vSnowSlope; varying float vSnowSky;
// Snow never lies as a sheet: it pillows over what it buried (tufts, stones) and is pocked with what fell from the
// crowns. A small tiling height texture (12.8 m, 2.5 cm): r mounds, g small fallen clumps (thick where the sky is hidden
// by a crown); its strength wanders so the tile never shows.
float snowLumpH(vec2 w, float D0, float sky, float lod) {
  vec4 t = textureLod(uSnowLumps, w / 12.8, lod);
  // what it buried (drape.js: rocks, stumps, logs; metres above the ground): banked up against the ones that stand
  // clear of it (to a third of its depth), a pillow over the ones it covers, flattening as they go deeper
  float ho = texture(uSnowDrape, w / 51.2).r * 1.5;
  float drape = min(ho, 0.35 * D0 + 0.02) * exp(-max(D0 - ho, 0.0) / 0.35);
  return uSnowTune2.y * (drape + smoothstep(0.03, 0.14, D0) * (0.025 * t.r * (0.5 + snowNoise2(w / 6.3)) + 0.04 * t.g * (0.12 + 1.7 * (1.0 - sky))));
}`;
const V_BEGIN = /* glsl */ `
  vec2 sw = uSnowCenter.xy + position.xz;
  float sRing = position.y;
  vec4 sF = snowField(sw);
  // the snow's thickness fades to nothing over the last 5 m of the surface, where the whitened ground takes over
  // (round, not square: from high above a square of deeper snow would show)
  float sEf = 1.0 - smoothstep(uSnowCenter.z - 7.0, uSnowCenter.z - 0.4, length(position.xz));
  float sLodV = sRing + uSnowTune2.x;                        // the live texture's mip whose texel matches this ring's vertices
  float sS = snowSquash(sF) * sEf;
  float sBase = sF.x * snowUndulate(sw) * sEf;
  vec4 sL = snowLive(sw, sLodV);
  vSnowSky = mix(1.0, texture(uSkyMap, (sw + 0.5) / uSkySize).r, uSkyK);
  float sLump = snowLumpH(sw, sF.x, vSnowSky, sLodV) * sEf;
  float sTh = (sBase + sLump * (1.0 - sL.r)) * (1.0 - sL.a) + snowLiveH(sL, sS);
  float sG = snowGround(sw);
  float sH = sG + 0.015 + sTh;
  // the field-scale slope: the ground and the untouched snow half a metre either side
  vec2 sE = vec2(0.5, 0.0);
  float hE = snowGround(sw + sE.xy) + snowField(sw + sE.xy).x * snowUndulate(sw + sE.xy) * sEf;
  float hW = snowGround(sw - sE.xy) + snowField(sw - sE.xy).x * snowUndulate(sw - sE.xy) * sEf;
  float hN = snowGround(sw + sE.yx) + snowField(sw + sE.yx).x * snowUndulate(sw + sE.yx) * sEf;
  float hS = snowGround(sw - sE.yx) + snowField(sw - sE.yx).x * snowUndulate(sw - sE.yx) * sEf;
  vSnowSlope = vec2(hE - hW, hN - hS);
  vSnowW = vec3(sw.x, sH, sw.y); vSnowA = vec4(sBase, sS, sEf, sTh); vSnowF = sF;
  vec3 transformed = vec3(sw.x, sH, sw.y);`;
const F_PARS = FIELD_GLSL + LIVE_GLSL + /* glsl */ `
uniform int uSnowView; uniform sampler2D uSnowLumps; uniform sampler2D uSnowDrape; uniform vec4 uSnowTune; uniform vec4 uSnowTune2; uniform vec3 uSnowSun;
varying vec3 vSnowW; varying vec4 vSnowA; varying vec4 vSnowF; varying vec2 vSnowSlope; varying float vSnowSky;
vec3 gSnN, gSnNs, gSnW; float gSnRim, gSnGlint, gSnPx, gSnCav, gSnShade;
float snowLumpH(vec2 w, float D0, float sky, float lod) {
  vec4 t = textureLod(uSnowLumps, w / 12.8, lod);
  // what it buried (drape.js: rocks, stumps, logs; metres above the ground): banked up against the ones that stand
  // clear of it (to a third of its depth), a pillow over the ones it covers, flattening as they go deeper
  float ho = texture(uSnowDrape, w / 51.2).r * 1.5;
  float drape = min(ho, 0.35 * D0 + 0.02) * exp(-max(D0 - ho, 0.0) / 0.35);
  return uSnowTune2.y * (drape + smoothstep(0.03, 0.14, D0) * (0.025 * t.r * (0.5 + snowNoise2(w / 6.3)) + 0.04 * t.g * (0.12 + 1.7 * (1.0 - sky))));
}
float snH(vec2 w, float lod, float S, float base) { vec4 l = snowLive(w, lod); return snowLiveH(l, S) - base * l.a; }`;
// replaces lights_lambert_pars_fragment: same structure and signatures as three r187's Lambert
const F_LIGHT = /* glsl */ `
varying vec3 vViewPosition;
struct LambertMaterial { vec3 diffuseColor; float specularStrength; };
vec3 snowHash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float snowHash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
// Glints (after Bowles and Wang): a world-anchored grid of mirror facets, each tilted its own way; one lights only
// when it sits at the half vector, as a dot about a pixel wide. Never animated: they change only as the camera or
// the sun moves.
float glintLevel(vec2 w, float cell, vec3 N, vec3 Hh, float px) {
  vec2 g = w / cell, id = floor(g), f = fract(g);
  vec3 r = snowHash33(vec3(id, cell * 17.0));
  float a = 6.2832 * r.z, t = 0.6 * sqrt(snowHash13(vec3(id.yx, 7.0 + cell)));
  vec3 T = normalize(cross(N, vec3(0.0, 0.0, 1.0))), B = cross(N, T);
  vec3 m = normalize(N + t * (cos(a) * T + sin(a) * B));
  float spec = smoothstep(0.985, 0.9985, dot(m, Hh));
  float dot_ = 1.0 - smoothstep(0.0, 1.0, length(f - (0.25 + 0.5 * r.xy)) * cell / max(px * 0.75, 0.004));
  return spec * dot_;
}
float snowGlints(vec2 w, vec3 N, vec3 V, vec3 L, float px) {
  float lvl = max(0.0, log2(px * 3.0 / 0.008)), l0 = floor(lvl);
  float c0 = 0.008 * exp2(l0);
  vec3 Hh = normalize(L + V);
  return mix(glintLevel(w, c0, N, Hh, px), glintLevel(w, c0 * 2.0, N, Hh, px), lvl - l0);
}
void RE_Direct_Snow(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight) {
  vec3 N = geometryNormal, L = directLight.direction, V = geometryViewDir;
  float ndl = dot(N, L);
  // light wraps past the terminator (multiple scattering) and comes back bluer where it travelled far
  float wrap = mix(saturate(ndl), clamp((ndl + uSnowTune.y) / (1.0 + uSnowTune.y), 0.0, 1.0), uSnowFlags.y);
  vec3 tint = mix(vec3(1.0), mix(vec3(0.60, 0.80, 1.0), vec3(1.0), smoothstep(0.0, 0.5, ndl)), uSnowFlags.y);
  vec3 lam = BRDF_Lambert(material.diffuseColor);
  float sky = mix(1.0, vSnowSky, 0.35);              // as the terrain: a little of the sun is really sky light
  // gSnShade: the sun hidden by the rut's own wall or a clump beside it (the live texture's horizon toward the sun)
  vec3 sun = directLight.color * gSnShade;
  reflectedLight.directDiffuse += sun * wrap * tint * lam * sky;
  // thin raised lips lit from behind glow
  reflectedLight.directDiffuse += sun * lam * 0.35 * gSnRim * pow(clamp(dot(V, -L) * 0.5 + 0.5, 0.0, 1.0), 3.0);
  // glints, in world space so the facets stay where they are
  if (gSnGlint > 0.0 && ndl > 0.0) {
    vec3 Lw = normalize((vec4(L, 0.0) * viewMatrix).xyz), Vw = normalize((vec4(V, 0.0) * viewMatrix).xyz);
    reflectedLight.directDiffuse += sun * snowGlints(gSnW.xz, gSnNs, Vw, Lw, gSnPx) * 1.2 * gSnGlint;
  }
  // wet or crusted snow: a broad low sheen toward the sun
  reflectedLight.directDiffuse += directLight.color * uSnowRef.w * 0.05 * pow(saturate(dot(N, normalize(L + V))), 12.0);
}
void RE_IndirectDiffuse_Snow(const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight) {
  // sky light: the blue of the open sky (snow in shade is lit by nothing else), hidden in a rut and under crowns, and
  // what does reach the bottom of a rut is bluer still
  vec3 skyTint = vec3(0.86, 0.95, 1.12);
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert(material.diffuseColor) * (1.0 - gSnCav) * vSnowSky * skyTint;
}
#define RE_Direct RE_Direct_Snow
#define RE_IndirectDiffuse RE_IndirectDiffuse_Snow`;
const F_MAIN = /* glsl */ `
  // the live texture is read at the mip that matches this pixel, not this ring: a print stays sharp as far as it can be seen
  gSnPx = max(length(dFdx(vSnowW)), length(dFdy(vSnowW)));
  float snLod = clamp(log2(max(gSnPx, 1e-4) / uSnowLiveTexel), 0.0, 7.0), snTx = uSnowLiveTexel * exp2(snLod), snS = vSnowA.y, snBase = vSnowA.x;
  vec4 snL = snowLive(vSnowW.xz, snLod);
  float snP = snL.r;
  float snLuK = vSnowA.z * (1.0 - snP), snLuLod = snLod, snLuE = max(0.04, snTx);
  float snLu = snowLumpH(vSnowW.xz, vSnowF.x, vSnowSky, snLuLod) * snLuK;
  float snThick = (snBase + snLu) * (1.0 - snL.a) + snowLiveH(snL, snS);
  // where less than 2 to 4 cm of snow is left, the whitened ground below shows (with grass tips through it)
  if (snThick < 0.02 + 0.02 * snowHash12(floor(vSnowW.xz * 20.0) + 0.5)) discard;
  vec2 snE = vec2(snTx, 0.0);
  float snH0 = snH(vSnowW.xz, snLod, snS, snBase);
  float snHx = snH(vSnowW.xz + snE.xy, snLod, snS, snBase) - snH(vSnowW.xz - snE.xy, snLod, snS, snBase);
  float snHz = snH(vSnowW.xz + snE.yx, snLod, snS, snBase) - snH(vSnowW.xz - snE.yx, snLod, snS, snBase);
  // the mounds' own slope
  vec2 snLg = vec2(snowLumpH(vSnowW.xz + vec2(snLuE, 0.0), vSnowF.x, vSnowSky, snLuLod), snowLumpH(vSnowW.xz + vec2(0.0, snLuE), vSnowF.x, vSnowSky, snLuLod)) * snLuK - snLu;
  gSnNs = normalize(vec3(-(vSnowSlope.x + snHx / (2.0 * snTx) + snLg.x / snLuE), 1.0, -(vSnowSlope.y + snHz / (2.0 * snTx) + snLg.y / snLuE)));
  // grains: a faint micro relief close up, off where the snow is packed smooth
  float snM = 0.5 * (1.0 - snP) * (1.0 - smoothstep(0.004, 0.025, gSnPx)) * uSnowFlags.y;
  vec2 snQ = vSnowW.xz * 28.0; float snN0 = snowNoise2(snQ);
  gSnN = normalize(gSnNs + snM * vec3(snN0 - snowNoise2(snQ + vec2(0.31, 0.0)), 0.0, snN0 - snowNoise2(snQ + vec2(0.0, 0.31))));
  gSnW = vSnowW;
  gSnCav = clamp((snL.r - snowLive(vSnowW.xz, snLod + 3.0).r) * snS * uSnowTune.z, 0.0, 0.35);
  gSnRim = uSnowFlags.z * snL.g * (1.0 - smoothstep(0.0, 0.25, snL.r));
  gSnGlint = uSnowFlags.x * clamp(uSnowRef.z, 0.0, 1.0) * (1.0 - snP) * (1.0 - snL.b);
  // the rut's own shadow: walk the live texture toward the sun; a wall or clump standing above the sun's ray hides it.
  // (The snow mesh casts no shadow of its own; this is what makes a print read from above.)
  gSnShade = 1.0;
  {
    float sl = length(uSnowSun.xz);
    if (sl > 1e-3 && uSnowSun.y > 0.03 && uSnowTune.w > 0.0) {
      vec2 sd = uSnowSun.xz / sl; float tanE = uSnowSun.y / sl, occ = 0.0;
      for (int i = 0; i < 3; i++) {
        float dd = snTx * (i == 0 ? 2.0 : (i == 1 ? 5.0 : 11.0));
        float hs = snH(vSnowW.xz + sd * dd, snLod + float(i), snS, snBase);
        occ = max(occ, (hs - snH0 - dd * tanE) / (0.015 + dd * 0.3));
      }
      gSnShade = 1.0 - uSnowTune.w * clamp(occ, 0.0, 1.0);
    }
  }`;
const F_COLOR = /* glsl */ `#include <color_fragment>
  {
    vec3 a = snowAlbedo(vSnowF.y, snP);
    // a rut pressed to within a few cm of the ground shows the dirt through it
    a = mix(a, vec3(0.31, 0.28, 0.23), (1.0 - smoothstep(0.02, 0.05, snThick)) * smoothstep(0.3, 0.8, snP) * 0.55);
    diffuseColor.rgb = a * uSnowTune.x;
  }`;
const F_DEBUG = /* glsl */ `#include <dithering_fragment>
  if (uSnowView == 1) gl_FragColor = vec4(snL.r, snL.g * 2.0, snL.b, 1.0);
  else if (uSnowView == 2) gl_FragColor = vec4(vec3(clamp(snThick * 2.5, 0.0, 1.0)), 1.0);
  else if (uSnowView == 3) gl_FragColor = vec4(snP, vSnowF.z, snL.a, 1.0);
  else if (uSnowView == 4) gl_FragColor = vec4(gSnN * 0.5 + 0.5, 1.0);`;

export const VIEWS = { press: 1, depth: 2, packed: 3, normal: 4 };
const SURF_U = ['uSnowField', 'uSnowFieldWin', 'uSnowRef', 'uSnowWind', 'uSnowFlags', 'uSnowFlags2', 'uSnowLive', 'uSnowLiveWin', 'uSnowLiveTexel', 'uSnowGround', 'uSnowCenter', 'uSnowView', 'uSkyMap', 'uSkyK', 'uSkySize', 'uSnowLumps', 'uSnowDrape', 'uSnowTune', 'uSnowTune2', 'uSnowSun'];

// The snow surface's material: receives shadows, fog and the scene's lights like everything else.
export function createSurfaceMaterial(T, U) {
  const mat = new T.MeshLambertMaterial({ color: 0xffffff });
  // a hair toward the camera, so thin snow never fights the terrain under it for the same depth
  mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2;
  mat.onBeforeCompile = (sh) => {
    for (const k of SURF_U) sh.uniforms[k] = U[k];
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + V_PARS).replace('#include <begin_vertex>', V_BEGIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + F_PARS)
      .replace('#include <lights_lambert_pars_fragment>', F_LIGHT)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + F_MAIN)
      .replace('#include <color_fragment>', F_COLOR)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mat3(viewMatrix) * gSnN);')
      .replace('#include <dithering_fragment>', F_DEBUG);
  };
  mat.customProgramCacheKey = () => 'snow-surface-3';
  return mat;
}
