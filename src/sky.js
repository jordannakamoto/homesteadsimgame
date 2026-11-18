// The sky: a dome round the camera, drawn behind everything.
//  - The air itself comes from the physically based atmosphere (atmosphere.js): its sky-view table gives the blue
//    overhead, the pale haze at the horizon, the glow round the sun and the whole run of a sunset or sunrise (orange
//    and gold low toward the sun, pink over the Earth's shadow on the far side, the deep blue of the blue hour).
//  - Clouds in two layers, as the big open-world games build theirs: heaped cumulus low (about 1.5 km), lit through
//    themselves from the sun's side, bright-rimmed looking toward the sun (forward scattering), grey underneath, and
//    thin streaky cirrus high up (8 km) that catches the light longest and glows pink and orange after the sun has
//    gone from the ground. Both are lit by the colour of the sunlight at their own height, and fade into the haze
//    with distance. How much of the sky they cover comes from the weather; overcast merges them into a grey deck.
//  - At night the real sky (night-sky.js draws the catalogue's stars): the Milky Way where it really lies, turning
//    with the stars, and the moon in its true place for its phase, lit on the side toward the sun, the dark part
//    faintly grey with earthshine; by day it shows pale if it is up. Its light is the night's light.
//  - Below the horizon, open sea out to the true horizon, shaded like the sea near the shore (body colour, the sky
//    reflected by the Fresnel law, the sun's glitter) and fading into the same haze as the land, so the sea meets
//    the sky in a soft, unbroken line.
// The horizon band is pulled to the distance-haze colour (with the same warming toward the sun as the fog of every
// material), so far land and sea fade into the sky without a seam.
//
// Options (setOptions): model 'physical' | 'painted' (the earlier two-colour gradient), clouds 'layered' | 'heaped'
// | 'off', night 'real' | 'simple' (made-up stars) | 'off'.
import * as THREE from 'three';
import { ATMOS_GLSL, createSkyView } from './atmosphere.js';
import { MILKY_WAY } from './data/stars.js';

// noise and the heaped-cloud layer, shared with the stars (which hide behind the clouds)
export const SKY_NOISE_GLSL = /* glsl */ `
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm4(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3; a *= 0.5; } return s / 0.9375; }
  float fbm2(vec2 p) { return (vnoise(p) * 0.66 + vnoise(p * 2.1 + 3.1) * 0.34); }
  // distance (km) along a ray rising dy to a layer hk km up, on the curved Earth: clouds crowd down to the horizon
  // (written so no two Earth-sized numbers are subtracted: phones that work at lower precision lose nothing)
  float layerT(float dy, float hk) { float r = 6360.0, c = 2.0 * r * hk + hk * hk; return c / (sqrt(r * r * dy * dy + c) + r * max(dy, 0.0)); }
  float cumulus(vec2 p, float cover) {
    vec2 w = vec2(fbm2(p * 0.35 + 3.0), fbm2(p * 0.35 - 5.0)) - 0.5;
    float n = fbm4(p * 0.55 + w * 1.4);
    return smoothstep(1.0 - cover - 0.04, 1.0 - cover + 0.3, n);
  }
  // ---- volumetric clouds (Schneider's Nubis recipe, as in Horizon and RDR2, cut down): a tiling Perlin-Worley
  // noise (r: billowy base shapes; g, b, a: Worley at 2, 4 and 8 times the frequency, for eroding the edges) shapes a
  // layer 1.3 to 3 km up; a weather map (the same noise, much larger) gathers them into fields and gaps
  uniform sampler2D uCloudNoise;
  uniform highp sampler3D uNoise3;
  uniform float uFrame;
  const float C_BASE = 1.4, C_TOP = 4.6;   // heaps up to about 3 km tall: fair-weather cumulus to towering congestus
  float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
  // where clouds may be (the weather map, as Red Dead's cloud map): fields tens of kilometres across with open sky
  // between, groups within them. A clear day has a few separate groups; partly cloudy, big fields; cloudy and
  // overcast, the fields run together into a deck
  float cloudCov(vec2 p, float cover) {
    float field = textureLod(uCloudNoise, p * 0.011 + vec2(0.31, 0.77), 2.0).r * 0.7 + textureLod(uCloudNoise, p * 0.04 + vec2(0.71, 0.13), 1.0).r * 0.3;
    float thr = mix(0.72, 0.22, pow(smoothstep(0.05, 0.95, cover), 1.6));
    float cl = smoothstep(thr, thr + 0.12, field);
    return clamp(cl * mix(0.5, 1.0, cover) + smoothstep(0.78, 1.0, cover) * 0.5, 0.0, 1.0);
  }
  // density at p (km, on the ground plan) and h (0 at the base .. 1 at the top), coverage cov; fine: erode the edges
  float fine_k = 1.0;                     // how much of the fine erosion to use (less far off, where it would alias)
  float cloud_t = 1.0;                    // distance (km) of the sample: picks the noise's level of detail (sampling in a
                                          // loop that may stop early, the automatic choice is not to be trusted)
  // density at p (km, on the ground plan) and h (0 at the base .. 1 at the top), coverage cov; fine: erode the
  // edges. True 3D noise (a tiling 64-cube of Perlin-Worley, makeCloudNoise3): shapes that swell, overhang and
  // narrow in every direction, as cumulus do, rather than outlines stood on end
  float cloudDens(vec2 p, float h, float cov, float t, bool fine) {
    if (h < 0.0 || h > 1.0 || cov <= 0.0) return 0.0;
    float alt = C_BASE + h * (C_TOP - C_BASE);
    vec3 q = vec3(p.x + h * 0.6, alt, p.y + h * 0.3);       // the tops lean downwind
    vec4 n = textureLod(uNoise3, q * vec3(0.085, 0.11, 0.085), 0.0);   // a tile about 12 km across: heaps of one to three km
    float wf = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
    float shape = remap(n.r, wf - 1.0, 1.0, 0.0, 1.0);
    // flat bases, rounded tops; under a heavy cover they build higher
    // (the tall ones only where the weather map gathers them: elsewhere the heaps stay low and flat-topped)
    float prof = smoothstep(0.0, 0.04, h) * smoothstep(mix(0.55, 1.15, smoothstep(0.15, 0.7, cov)), 0.05, h);
    float d = remap(shape * prof, 1.0 - cov * 0.45, 1.0, 0.0, 1.0);
    if (d <= 0.0 || !fine) return clamp(d, 0.0, 1.0) * cov;
    // eroded at the edges by finer billows: wispy at the base, cauliflower above
    vec4 e = textureLod(uNoise3, q * 0.7 + vec3(0.0, -t * 0.002, 0.0), 0.0);
    float df = e.g * 0.625 + e.b * 0.25 + e.a * 0.125;
    float det = mix(1.0 - df, df, clamp(h * 4.0, 0.0, 1.0));
    // and a finer octave still, for crisp edges
    float e2 = textureLod(uNoise3, q * 2.3 + vec3(0.3, t * 0.003, 0.7), 0.0).g;
    det = mix(det, mix(1.0 - e2, e2, clamp(h * 4.0, 0.0, 1.0)), 0.3);
    d = remap(d, det * 0.55 * fine_k, 1.0, 0.0, 1.0);
    return clamp(d, 0.0, 1.0) * cov;
  }
  // distance to height hk along a ray rising dy, and the height at distance t (curved Earth)
  float altAt(float t, float dy) { float r = 6360.0, c = t * t + 2.0 * r * t * dy; return c / (sqrt(r * r + c) + r); }
  // how much cloud stands in front of direction d (0 clear .. 1 hidden)
  float cloudCover(vec3 d, float cover, vec2 wind, float on) {
    if (on < 0.5 || d.y <= 0.0) return 0.0;
    if (on < 1.5) return max(clamp(cumulus(d.xz * layerT(d.y, 1.5) + wind, cover) * 1.15, 0.0, 1.0), smoothstep(0.75, 1.0, cover) * 0.7);
    vec2 p = d.xz * layerT(d.y, 1.8) + wind;
    float a = 0.0;
    for (int i = 0; i < 3; i++) { float h = 0.15 + 0.25 * float(i); vec2 q = d.xz * layerT(d.y, C_BASE + h * (C_TOP - C_BASE)) + wind; a += cloudDens(q, h, cloudCov(q, cover), 0.0, false); }
    return clamp(a * 1.5, 0.0, 1.0);
  }
`;

// the clouds' noise, made once on the graphics card: 256 x 256, tiling, with mipmaps for the distance
function makeCloudNoise(renderer) {
  const target = new THREE.WebGLRenderTarget(256, 256, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
  const mat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      vec2 h22(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
      float worley(vec2 uv, float P) {
        vec2 p = uv * P, i = floor(p), f = fract(p); float md = 1.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 c = vec2(float(x), float(y));
          md = min(md, length(c + h22(mod(i + c, P)) - f));
        }
        return clamp(md, 0.0, 1.0);
      }
      float gnoise(vec2 uv, float P) {
        vec2 p = uv * P, i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
        float a = dot(h22(mod(i, P)) * 2.0 - 1.0, f), b = dot(h22(mod(i + vec2(1.0, 0.0), P)) * 2.0 - 1.0, f - vec2(1.0, 0.0));
        float c = dot(h22(mod(i + vec2(0.0, 1.0), P)) * 2.0 - 1.0, f - vec2(0.0, 1.0)), d = dot(h22(mod(i + vec2(1.0, 1.0), P)) * 2.0 - 1.0, f - vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) + 0.5;
      }
      void main() {
        vec2 uv = vUv;
        float pf = (gnoise(uv, 4.0) * 0.5 + gnoise(uv, 8.0) * 0.25 + gnoise(uv, 16.0) * 0.125 + gnoise(uv, 32.0) * 0.0625) / 0.9375;
        float w1 = 1.0 - worley(uv, 4.0), w2 = 1.0 - worley(uv, 8.0), w3 = 1.0 - worley(uv, 16.0), w4 = 1.0 - worley(uv, 32.0);
        float wf = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
        float pw = clamp((pf - (wf - 1.0)) / (2.0 - wf), 0.0, 1.0);     // Perlin-Worley: Perlin's spread, Worley's billows
        gl_FragColor = vec4(pw, w2, w3, w4);
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(quad);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target); renderer.render(sc, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)); renderer.setRenderTarget(prev);
  mat.dispose(); quad.geometry.dispose();
  return target.texture;
}

// what the sky dome and the cloud pass share: the uniforms, the air's colour, the haze, the cloud march
const SKY_COMMON = /* glsl */ `
      uniform vec3 uSunDir, uSunCol, uAmb, uSky, uZenith, uDeep, uTrueSun, uSunLo, uSunHi, uSunCi, uFogC, uFog;
      uniform float uTime, uCloud, uGrey, uNight, uDay, uCamY, uSea;
      uniform vec2 uWindOff; uniform sampler2D uView, uHz, uMW;
      uniform vec4 uMoon, uOpt; uniform mat3 uEq;
      #include <common>
      vec3 airAt(vec3 d) {
        if (uOpt.x < 0.5) {                                   // painted: the earlier gradient, with a glow round the sun
          float sd = max(dot(d, uSunDir), 0.0);
          return mix(uSky, uZenith, pow(smoothstep(0.0, 1.0, max(d.y, 0.0)), 0.55)) + uSunCol * (0.08 * pow(sd, 6.0) + 0.25 * pow(sd, 64.0)) * (0.4 + 0.6 * uDay);
        }
        return texture2D(uView, aViewUV(d)).rgb;
      }
      // the air's colour where the land meets the sky: the distance haze, warmed toward the sun as the fog is
      vec3 hazeTint(vec3 d) {
        float sunA = max(dot(d, uSunDir), 0.0);
        vec3 hue = uSunCol / max(max(uSunCol.r, max(uSunCol.g, uSunCol.b)), 1e-3);
        return mix(uFogC, uFogC * hue * 1.3, 0.25 * sunA * sunA + 0.75 * pow(sunA, 8.0));
      }
      float hg(float mu, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * mu, 1.5)); }
      float hg4(float mu, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * mu, 1.5); }
      float cPhase(float mu, float k) { return min(mix(hg4(mu, 0.75 * k), hg4(mu, -0.3 * k), 0.5), 5.0); }
      vec3 skyAbove(vec3 d) {
        vec3 col = airAt(d);
        // overcast greys it, and night's own sky (moonlit air, the glow of the dark) lies under it
        col = mix(col, mix(uSky, uZenith, 0.35) * 1.05, uGrey);
        col += mix(uSky, uZenith, pow(max(d.y, 0.0), 0.5)) * uNight * (0.2 + 0.8 * uMoon.w * smoothstep(-0.02, 0.15, uMoon.y));
        return col;
      }
      // the cloud layer along d: 12 steps through it, each lit through the cloud toward the sun (three samples) with
      // a few lobes of light scattered again and again inside (Wrenninge's octaves: what makes the interiors soft and
      // bright and the edges toward the sun silver), and the sky's light from above and, dimmer, below; returns the
      // light and how much it covers, and (w) the distance it mostly lies at
      vec4 marchClouds(vec3 d, float cover, vec2 wind, float mu, vec3 ambHi, vec3 ambLo, out float tMid) {
        float t0 = layerT(d.y, C_BASE), t1 = min(layerT(d.y, C_TOP), t0 + 6.0);   // (past 3.5 km in, a cloud is opaque or the haze has it)
        const int N = 28;
        float span = smoothstep(1.5, 6.0, t1 - t0);
        // a different start each frame (the golden-ratio step through a per-pixel offset): blended over the frames by
        // the cloud pass, the steps and their grain smooth out
        float jit = fract(fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) + uFrame * 0.618034);
        fine_k = mix(1.0, 0.7, span) * (1.0 - 0.6 * smoothstep(8.0, 40.0, t0));
        float dt = (t1 - t0) / float(N);
        vec3 L = vec3(0.0); float T = 1.0, tw = 0.0, tws = 0.0;
        vec3 s3 = uTrueSun;
        // phase: a strong forward lobe (silver edges toward the sun) and a back lobe (the bright face with the sun
        // behind you), normalised so even scattering is 1; each later bounce spreads wider
        float pf = cPhase(mu, 1.0), pb = cPhase(mu, 0.5), pc = cPhase(mu, 0.25);
        for (int i = 0; i < N; i++) {
          float t = t0 + (float(i) + jit) * dt;
          cloud_t = t;
          float h = (altAt(t, d.y) - C_BASE) / (C_TOP - C_BASE);
          vec2 p = d.xz * t + wind;
          float cov = cloudCov(p, cover);
          float den = cloudDens(p, h, cov, uTime, true);
          if (den > 0.003) {
            float od = 0.0;
            // (the nearest with the fine billows: they shade one another, which is what gives a cumulus its
            // cauliflower relief)
            od += cloudDens(p + s3.xz * 0.06, h + s3.y * 0.06 / (C_TOP - C_BASE), cov, uTime, true) * 0.06;
            od += cloudDens(p + s3.xz * 0.15, h + s3.y * 0.15 / (C_TOP - C_BASE), cov, 0.0, false) * 0.1;
            od += cloudDens(p + s3.xz * 0.3, h + s3.y * 0.3 / (C_TOP - C_BASE), cov, 0.0, false) * 0.2;
            od += cloudDens(p + s3.xz * 0.75, h + s3.y * 0.75 / (C_TOP - C_BASE), cov, 0.0, false) * 0.45;
            od += cloudDens(p + s3.xz * 1.5, h + s3.y * 1.5 / (C_TOP - C_BASE), cov, 0.0, false) * 0.75;
            od *= 52.0;
            // powder: the thin, outer parts facing the light scatter less of it back, so the billows stand out
            float powder = 1.0 - exp(-den * 16.0);
            float sunL = (exp(-od) * pf + 0.5 * exp(-od * 0.3) * pb + 0.25 * exp(-od * 0.1) * pc) * mix(0.5, 1.0, powder);
            // (with the sun low the sky's light is most of what a cloud's body gets: more of it, so dusk clouds go lavender
            // and slate, not mud)
            vec3 amb = mix(ambLo, ambHi, smoothstep(0.0, 1.0, h)) * mix(0.55, 1.0, h) * (0.7 + 0.3 * powder) * (1.0 + 0.9 * (1.0 - smoothstep(0.0, 0.35, uTrueSun.y)));
            // (scaled so a cloud's sunlit face sits just under white: brighter, every lit face tone-maps to the same flat
            // white and the cloud loses its shading)
            vec3 S = uSunHi * sunL * 0.17 + amb;
            float st = exp(-den * 55.0 * dt);   // dense enough for a definite edge, thin enough that light comes through
            L += T * S * (1.0 - st);
            tw += t * T * (1.0 - st); tws += T * (1.0 - st);
            T *= st;
            if (T < 0.03) break;
          }
        }
        tMid = tws > 0.0 ? tw / tws : t0;
        return vec4(L, 1.0 - T);
      }
`;

// the clouds' 3D noise, made once on the graphics card: a tiling 64-cube; r Perlin-Worley (the heaps), g b a Worley
// at three frequencies (the billows that erode their edges)
function makeCloudNoise3(renderer) {
  const N = 64;
  const target = new THREE.WebGL3DRenderTarget(N, N, N, { depthBuffer: false });
  const tex = target.texture;
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uZ: { value: 0 } }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uZ; varying vec2 vUv;
      vec3 h33(vec3 p) {
        p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
        return fract(sin(p) * 43758.5453);
      }
      float worley3(vec3 uvw, float P) {
        vec3 p = uvw * P, i = floor(p), f = fract(p); float md = 1.0;
        for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec3 c = vec3(float(x), float(y), float(z));
          md = min(md, length(c + h33(mod(i + c, P)) - f));
        }
        return clamp(md, 0.0, 1.0);
      }
      float gn(vec3 i, vec3 f, vec3 c, float P) { return dot(h33(mod(i + c, P)) * 2.0 - 1.0, f - c); }
      float gnoise3(vec3 uvw, float P) {
        vec3 p = uvw * P, i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
        float a = mix(mix(gn(i, f, vec3(0, 0, 0), P), gn(i, f, vec3(1, 0, 0), P), u.x), mix(gn(i, f, vec3(0, 1, 0), P), gn(i, f, vec3(1, 1, 0), P), u.x), u.y);
        float b = mix(mix(gn(i, f, vec3(0, 0, 1), P), gn(i, f, vec3(1, 0, 1), P), u.x), mix(gn(i, f, vec3(0, 1, 1), P), gn(i, f, vec3(1, 1, 1), P), u.x), u.y);
        return mix(a, b, u.z) + 0.5;
      }
      void main() {
        vec3 uvw = vec3(vUv, (uZ + 0.5) / ${N}.0);
        float pf = (gnoise3(uvw, 4.0) * 0.5 + gnoise3(uvw, 8.0) * 0.25 + gnoise3(uvw, 16.0) * 0.125) / 0.875;
        float w1 = 1.0 - worley3(uvw, 4.0), w2 = 1.0 - worley3(uvw, 8.0), w3 = 1.0 - worley3(uvw, 16.0);
        float wf = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
        float pw = clamp((pf - (wf - 1.0)) / (2.0 - wf), 0.0, 1.0);
        gl_FragColor = vec4(pw, w1, w2, w3);
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  for (let z = 0; z < N; z++) { mat.uniforms.uZ.value = z; renderer.setRenderTarget(target, z); renderer.render(sc, cam); }
  renderer.setRenderTarget(prev);
  mat.dispose(); quad.geometry.dispose();
  return tex;
}

export function createSkyDome({ scene, camera, renderer, water, U, SEA = 0 }) {
  const view = createSkyView(renderer);
  const cloudNoise = makeCloudNoise(renderer), cloudNoise3 = makeCloudNoise3(renderer);
  const mwTex = new THREE.TextureLoader().load(MILKY_WAY);
  mwTex.wrapS = THREE.RepeatWrapping; mwTex.colorSpace = THREE.NoColorSpace;
  const uniforms = {
    uSunDir: water.uSunDir, uSunCol: water.uSunCol, uAmb: water.uAmb, uSky: water.uSky, uZenith: water.uZenith, uDeep: water.uDeep, uTime: U.time,
    uView: { value: view.texture }, uHz: { value: null }, uMW: { value: mwTex }, uCloudNoise: { value: cloudNoise }, uNoise3: { value: cloudNoise3 },
    uCloudTex: { value: null }, uScreen: { value: new THREE.Vector2(1, 1) }, uMainCam: { value: 0 }, uDust: { value: 1024 }, uInvVP: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
    uPrevTex: { value: null }, uPrevVP: { value: new THREE.Matrix4() }, uHist: { value: 0 }, uFrame: { value: 0 },
    uTrueSun: { value: new THREE.Vector3(0, 1, 0) }, uSunLo: { value: new THREE.Color() }, uSunHi: { value: new THREE.Color() }, uSunCi: { value: new THREE.Color() },
    uCloud: { value: 0.3 }, uGrey: { value: 0 }, uNight: { value: 0 }, uDay: { value: 1 }, uWind: { value: new THREE.Vector2() }, uWindOff: { value: new THREE.Vector2() },
    uFogC: { value: new THREE.Color() }, uFog: { value: new THREE.Vector3(60, 1000, 1) }, uCamY: { value: 10 }, uSea: { value: SEA },
    uMoon: { value: new THREE.Vector4(0, -1, 0, 0) },            // direction, lit fraction
    uEq: { value: new THREE.Matrix3() },                          // the sky's frame: world direction to the stars' frame
    uOpt: { value: new THREE.Vector4(1, 2, 2, 0) },               // model (1 physical), clouds (2 layered, 1 heaped), night (2 real, 1 simple)
  };
  const material = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;                               // on the far plane: behind everything
      }`,
    fragmentShader: ATMOS_GLSL + SKY_NOISE_GLSL + /* glsl */ `
      varying vec3 vDir;
      uniform sampler2D uCloudTex; uniform vec2 uScreen; uniform float uMainCam, uDust;
${SKY_COMMON}      void main() {
        vec3 d = normalize(vDir);
        float mu = dot(d, uTrueSun);
        if (d.y < 0.0) {
          // ---- the open sea, out to the horizon (the same shading as the sea near the shore, sea.js, so the two
          // meet without a line)
          float t = (uCamY - uSea) / max(-d.y, 1e-4);
          vec2 sp = cameraPosition.xz + d.xz * t;
          float fade = 1.0 - smoothstep(60.0, 900.0, t);   // ripples blur out with distance
          vec2 g = (vec2(fbm2(sp * 0.09 + uTime * vec2(0.05, 0.03)), fbm2(sp * 0.09 - uTime * vec2(0.03, 0.05) + 9.0)) - 0.5) * 0.18 * fade;
          vec3 N = normalize(vec3(g.x, 1.0, g.y));
          vec3 R = reflect(d, N); R.y = abs(R.y);
          float cosV = max(dot(-d, N), 0.0);
          float fres = 0.07 + 0.93 * pow(1.0 - cosV, 4.0);
          vec3 refl = mix(uSky, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.7));
          float sd = max(dot(R, uSunDir), 0.0);
          vec3 glint = uSunCol * (pow(sd, 900.0) * 60.0 + pow(sd, 60.0) * 0.9) * mix(0.6, 1.0, fade);
          vec3 lightC = uSunCol * (0.35 + 0.65 * max(dot(N, uSunDir), 0.0)) + uAmb;
          vec3 col = mix(uDeep * lightC, refl, fres) + glint;
          float ff = smoothstep(uFog.x, uFog.y, t);
          col = mix(col, hazeTint(d), max(ff, smoothstep(-0.02, 0.0, d.y)));
          // past the far land (about 400 m), open sea only where the sea carries on; inland, the land beyond is lost
          // in the haze
          float seaOn = texture2D(uHz, vec2(atan(d.z, d.x) / 6.2831853 + 0.5, 0.5)).r;
          col = mix(col, hazeTint(d), smoothstep(330.0, 390.0, t) * (1.0 - seaOn));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          return;
        }
        vec3 col = skyAbove(d);
        float dark = uNight * (1.0 - 0.75 * uMoon.w * smoothstep(-0.05, 0.2, uMoon.y));   // moonlight drowns the faint
        // ---- night: the Milky Way where it really lies (real; the stars themselves are points, night-sky.js), or
        // made-up stars (simple)
        if (uNight > 0.01 && uOpt.z > 0.5) {
          float clear = (1.0 - smoothstep(0.25, 0.8, uCloud)) * smoothstep(0.0, 0.2, d.y);
          if (uOpt.z > 1.5) {
            vec3 e = uEq * d;                                 // into the stars' frame: x to the equinox, z to the pole
            vec2 uv = vec2(atan(e.y, e.x) / 6.2831853, asin(clamp(e.z, -1.0, 1.0)) / 3.14159265 + 0.5);
            float mw = texture2D(uMW, uv).r;
            // the band: star clouds and dark lanes of dust in it, warm toward the bright core, cooler out along it
            float clouds = fbm4(uv * vec2(180.0, 90.0)) * 0.6 + fbm4(uv * vec2(520.0, 260.0)) * 0.4;
            float lanes = smoothstep(0.35, 0.75, fbm4(uv * vec2(90.0, 45.0) + 3.0));
            float glow = pow(mw, 1.5) * (0.35 + 0.95 * clouds) * mix(1.0, 0.45, lanes * smoothstep(0.25, 0.7, mw));
            vec3 band = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.88, 0.72), smoothstep(0.45, 0.95, mw));
            col += band * glow * 0.32 * clear * dark;
            // the faint stars past what the catalogue holds: a dust of them, many times thicker along the band
            // (each faint star about a pixel and a half across whatever the screen: finer, they would shimmer as the
            // view moves; the scale steps in powers of two, so it holds still)
            vec3 q = e * uDust, c = floor(q);
            float hs = h3(c);
            float pr = (0.02 + 0.24 * mw) * clamp(1100.0 / uDust, 0.6, 3.0);
            float res = 1.0;
            if (hs < pr) {
              vec3 sp = c + 0.5 + (vec3(h3(c + 1.7), h3(c + 4.1), h3(c + 9.3)) - 0.5) * 0.6;
              float b = smoothstep(0.5, 0.0, length(q - sp)) * (0.05 + 0.2 * h3(c + 6.0));
              col += b * mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.9, 0.78), h3(c + 2.0)) * clear * dark * 1.6 * res;
            }
            // airglow: the faint green-gold light of the high air itself, low round the horizon on the darkest nights
            col += vec3(0.010, 0.016, 0.008) * exp(-max(d.y, 0.0) * 9.0) * dark * (1.0 - uMoon.w * 0.8);
          } else {
            vec3 q = (uEq * d) * 420.0, c = floor(q);
            float hs = h3(c), star = 0.0;
            if (hs > 0.965) {
              vec3 sp = c + 0.5 + (vec3(h3(c + 1.7), h3(c + 4.1), h3(c + 9.3)) - 0.5) * 0.5;
              star = smoothstep(0.42, 0.0, length(q - sp)) * (0.25 + 2.5 * pow((hs - 0.965) / 0.035, 3.0));
            }
            col += star * vec3(0.85, 0.9, 1.0) * 0.9 * clear * dark;
          }
        }
        // ---- the moon: its disc lit on the side toward the sun, earthshine on the rest; pale by day
        vec3 md = uMoon.xyz;
        float mc = dot(d, md);
        if (md.y > -0.02 && mc > 0.9997 - 0.0003 && uOpt.z > 0.5) {
          vec3 tx = normalize(cross(md, vec3(1e-4, 1.0, 0.0))), ty = cross(tx, md);
          // disc radius 0.7 degrees (twice the real moon, as games draw it, so it reads on screen), and larger still low down:
          // the moon illusion, the low moon looking huge against the far horizon
          float mR = 0.012 * mix(1.45, 1.0, smoothstep(0.0, 0.45, md.y));
          vec2 o = vec2(dot(d, tx), dot(d, ty)) / mR;
          float r2 = dot(o, o);
          if (r2 < 1.0) {
            vec3 n = normalize(tx * o.x + ty * o.y + md * sqrt(1.0 - r2));
            float lit = smoothstep(-0.04, 0.06, dot(n, uTrueSun));
            float maria = 0.72 + 0.28 * fbm4(o * 2.4 + 11.0);
            float edge = smoothstep(1.0, 0.9, r2);
            vec3 mcol = vec3(1.0, 0.97, 0.92) * maria * (lit * mix(0.35, 1.6, uNight) + 0.025 * uNight) * edge;
            col = mix(col, col * (1.0 - lit * 0.4) + mcol, edge * (1.0 - 0.85 * smoothstep(0.5, 0.95, uCloud)));
          }
        }
        if (md.y > -0.02) col += vec3(0.55, 0.65, 0.85) * pow(max(mc, 0.0), 900.0) * 0.1 * uMoon.w * uNight;
        // ---- the sun's disc (darker at its rim), reddened by the air it shines through
        float disc = smoothstep(0.99995, 0.99998, mu);
        vec3 sunDisc = uSunLo * disc * (0.7 + 0.3 * smoothstep(0.99995, 1.0, mu)) * 40.0;
        // ---- clouds
        float cover = clamp(uCloud, 0.0, 1.0);
        vec2 wind = uWindOff;
        float hor = smoothstep(0.0, 0.07, d.y);
        vec3 zen = airAt(vec3(0.0, 1.0, 0.0));
        // cirrus: long streaks, high and thin, lit longest at dusk
        if (uOpt.y > 0.5) {
          float tc = layerT(d.y, 8.0);
          vec2 pcs = mat2(0.9, 0.44, -0.44, 0.9) * (d.xz * tc + wind * 2.5);
          // fine fibres combed along the wind, in patches, not broad sheets
          float ci = fbm4(vec2(pcs.x * 0.035, pcs.y * 0.5)) * 0.62 + fbm4(vec2(pcs.x * 0.12, pcs.y * 1.6) + 5.0) * 0.38;
          float patchy = smoothstep(0.35, 0.7, fbm2(pcs * 0.045 + 2.0));
          float ciAmt = 0.12 + 0.38 * smoothstep(0.05, 0.4, cover) * (1.0 - smoothstep(0.7, 1.0, cover));
          float ciA = smoothstep(0.58, 0.86, ci) * patchy * ciAmt * 0.2 * hor * smoothstep(0.04, 0.25, d.y);
          vec3 ciCol = uSunCi * (0.35 + 0.6 * hg(mu, 0.6)) + zen * 1.2 + mix(uSky, uZenith, 0.5) * uNight * 0.5;
          ciCol = mix(ciCol, col, 1.0 - exp(-tc / 160.0));
          col = mix(col, ciCol, ciA);
        }
        // volumetric clouds: from their own pass at half resolution (renderClouds), smoothly enlarged; in the
        // water's reflections (other cameras) the flat ones stand in
        if (uOpt.y > 1.5 && uMainCam > 0.5) {
          vec4 cl = texture2D(uCloudTex, gl_FragCoord.xy / uScreen);
          sunDisc *= 1.0 - cl.a;
          col = mix(col, cl.rgb * 2.0, cl.a);
        }
        // flat clouds: heaps low down, self-shadowed toward the sun
        else if (uOpt.y > 0.5) {
          float tl = layerT(d.y, 1.5);
          vec2 p = d.xz * tl + wind;
          float dens = cumulus(p, cover);
          if (dens > 0.001) {
            vec2 sdir = normalize(uTrueSun.xz + 1e-4) * (0.18 + 0.25 * (1.0 - abs(uTrueSun.y)));
            float shade = cumulus(p + sdir, cover) * 0.6 + cumulus(p + sdir * 2.6, cover) * 0.4;
            float light = exp(-shade * 2.6) * (1.0 - exp(-dens * 3.0) * 0.5);
            float ph = 0.55 + 2.2 * hg(mu, 0.55) * (1.0 - 0.6 * dens);
            vec3 amb = zen * 1.4 + airAt(normalize(vec3(d.x, 0.05, d.z))) * 0.5;
            vec3 cc = uSunHi * light * ph + amb * mix(1.0, 0.55, dens);
            cc = mix(cc, mix(uSky, uZenith, 0.25) * 0.9, uGrey * 0.85);
            cc += mix(uSky, uZenith, 0.5) * uNight * (0.35 + 0.5 * uMoon.w);
            cc = mix(cc, col, 1.0 - exp(-tl / 55.0));          // far clouds fade into the haze
            float a = clamp(dens * 1.15, 0.0, 1.0) * hor * mix(0.92, 1.0, cover);
            sunDisc *= 1.0 - a;
            col = mix(col, cc, a);
          }
          // overcast: an even deck over all of it
          col = mix(col, mix(uSky, uZenith, 0.25) * 0.95 + uSunHi * 0.05, smoothstep(0.75, 1.0, cover) * 0.7 * hor);
        }
        col += sunDisc * (1.0 - smoothstep(0.6, 0.95, cover));
        // where land and sea meet the sky: the distance haze, so they fade into it without a line
        col = mix(col, hazeTint(d), (1.0 - smoothstep(0.0, 0.05, d.y)) * 0.85);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), material);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  scene.add(mesh);
  // which camera, and how big the target: the volumetric clouds are only for the main view
  const _rs = new THREE.Vector2();
  mesh.onBeforeRender = (r, sc, cam) => {
    uniforms.uMainCam.value = cam === camera && cloudsDrawn ? 1 : 0;
    const rt = r.getRenderTarget();
    if (rt) uniforms.uScreen.value.set(rt.width, rt.height); else uniforms.uScreen.value.copy(r.getDrawingBufferSize(_rs));
    // the faint stars' cell: a pixel and a half of this view, in a power of two
    if (cam.isPerspectiveCamera) { const px = (cam.fov * Math.PI / 180) / uniforms.uScreen.value.y; uniforms.uDust.value = Math.pow(2, Math.floor(Math.log2(1 / (px * 1.5)))); }
    material.uniformsNeedUpdate = true;
  };

  // ---- the cloud pass: the volumetric clouds for the main view, at a fraction of its resolution (soft things lose
  // nothing by it), worked out just before the frame so they sit exactly where the frame looks
  // plain 8-bit colour (every phone can draw into it; half-floats are not everywhere), the colour halved to keep
  // the brightest sunlit edges
  // two, written in turn: each frame blends with the last, re-projected to where those clouds now are on screen
  // (temporal reprojection, as Horizon and Red Dead do; the clouds are so far off that turning the camera is all
  // that moves them)
  const rtOpts = { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const cloudRTs = [new THREE.WebGLRenderTarget(4, 4, rtOpts), new THREE.WebGLRenderTarget(4, 4, rtOpts)];
  let cloudCur = 0;
  uniforms.uCloudTex.value = cloudRTs[0].texture;
  const cloudMat = new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vNdc; void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: ATMOS_GLSL + SKY_NOISE_GLSL + SKY_COMMON + /* glsl */ `
      uniform mat4 uInvVP, uPrevVP; uniform vec3 uCamPos; uniform sampler2D uPrevTex; uniform float uHist;
      varying vec2 vNdc;
      vec4 cloudNow(vec3 d);
      void main() {
        vec4 p = uInvVP * vec4(vNdc, 1.0, 1.0);
        vec3 d = normalize(p.xyz / p.w - uCamPos);
        vec4 now = cloudNow(d);
        // where this direction was on screen last frame
        vec4 pp = uPrevVP * vec4(uCamPos + d * 1000.0, 1.0);
        vec2 puv = pp.xy / pp.w * 0.5 + 0.5;
        if (uHist > 0.5 && pp.w > 0.0 && all(greaterThan(puv, vec2(0.0))) && all(lessThan(puv, vec2(1.0)))) now = mix(now, texture2D(uPrevTex, puv), 0.85);
        gl_FragColor = now;
      }
      vec4 cloudNow(vec3 d) {
        if (d.y <= 0.0) return vec4(0.0);
        float mu = dot(d, uTrueSun), cover = clamp(uCloud, 0.0, 1.0);
        vec3 zen = airAt(vec3(0.0, 1.0, 0.0));
        // the sky's own light on the cloud: from overhead and all round (it is what colours a cloud's shaded body: blue
        // grey by day, lavender and rose at dawn and dusk)
        vec3 ambHi = zen * 0.75 + airAt(normalize(vec3(d.x, 0.3, d.z))) * 0.9 + mix(uSky, uZenith, 0.5) * uNight * (0.25 + 0.5 * uMoon.w);
        // under the clouds: the sky low down, and light thrown up off the land (warm and green near, cooler far off,
        // as landscape painters give cloud bases)
        float near = exp(-layerT(d.y, C_BASE) / 6.0);
        vec3 ambLo = airAt(normalize(vec3(d.x, 0.06, d.z))) * 0.6 + uSunCol * vec3(0.36, 0.38, 0.22) * 0.06 * near + uAmb * 0.05;
        float tMid;
        vec4 cl = marchClouds(d, cover, uWindOff, mu, ambHi, ambLo, tMid);
        if (cl.a < 0.001) return vec4(0.0);
        vec3 cc = cl.rgb / cl.a;
        cc = mix(cc, mix(uSky, uZenith, 0.25) * 0.9, uGrey * 0.6);
        cc = mix(cc, skyAbove(d), 1.0 - exp(-tMid / 22.0));    // far clouds fade into the haze
        return vec4(min(cc * 0.5, vec3(1.0)), cl.a * smoothstep(0.0, 0.07, d.y));
      }`,
  });
  const cloudQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), cloudMat); cloudQuad.frustumCulled = false;
  const cloudScene = new THREE.Scene(); cloudScene.add(cloudQuad);
  const cloudCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let cloudsDrawn = false, cloudScale = 0.5, histOk = false, lastCover = -1;
  const lastSun = new THREE.Vector3(), lastFwd = new THREE.Vector3(), lastPos = new THREE.Vector3();
  const prevVP = new THREE.Matrix4();
  const _c = new THREE.Vector3();
  // before the frame: w, h the size the scene is drawn at
  function renderClouds(cam, w, h, renderer) {
    cloudsDrawn = false;
    if (uniforms.uOpt.value.y < 1.5) { histOk = false; return; }
    cam.updateMatrixWorld();
    // none of the sky on screen (looking down at the ground): nothing to do
    let up = -1;
    for (const x of [-1, 0, 1]) { _c.set(x, 1, 1).unproject(cam).sub(cam.position); up = Math.max(up, _c.normalize().y); }
    if (up < -0.01) { histOk = false; return; }
    const cw = Math.max(16, Math.round(w * cloudScale)), ch = Math.max(16, Math.round(h * cloudScale));
    const last = cloudRTs[cloudCur], next = cloudRTs[1 - cloudCur];
    let hist = histOk;
    // a jump (the time, the weather or the view changing at once) starts the blend afresh rather than smearing
    cam.getWorldDirection(_c);
    const u = uniforms;
    if (u.uTrueSun.value.distanceTo(lastSun) > 0.01 || Math.abs(u.uCloud.value - lastCover) > 0.03 || _c.dot(lastFwd) < 0.97 || cam.position.distanceTo(lastPos) > 20) hist = false;
    lastSun.copy(u.uTrueSun.value); lastCover = u.uCloud.value; lastFwd.copy(_c); lastPos.copy(cam.position);
    for (const rt of cloudRTs) if (rt.width !== cw || rt.height !== ch) { rt.setSize(cw, ch); hist = false; }
    uniforms.uInvVP.value.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    uniforms.uCamPos.value.copy(cam.position);
    uniforms.uPrevTex.value = last.texture; uniforms.uPrevVP.value.copy(prevVP); uniforms.uHist.value = hist ? 1 : 0;
    uniforms.uFrame.value = (uniforms.uFrame.value + 1) % 1000;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(next); renderer.render(cloudScene, cloudCam); renderer.setRenderTarget(prev);
    cloudCur = 1 - cloudCur; uniforms.uCloudTex.value = next.texture;
    prevVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    histOk = true;
    cloudsDrawn = true;
  }
  // o: { trueSun (Vector3), sunLo, sunHi, sunCi (Colors: the sunlight at the ground, 1.5 km and 8 km), cloud,
  //   grey (overcast greying), night, day, windX, windZ, fog (scene.fog), moon (Vector4: direction, lit fraction),
  //   eq (Matrix3: world to the stars' frame) }
  function update(o, dt) {
    mesh.position.copy(camera.position);
    const u = uniforms;
    u.uTrueSun.value.copy(o.trueSun); u.uSunLo.value.copy(o.sunLo); u.uSunHi.value.copy(o.sunHi); u.uSunCi.value.copy(o.sunCi);
    u.uCloud.value = o.cloud; u.uGrey.value = o.grey; u.uNight.value = o.night; u.uDay.value = o.day;
    u.uWind.value.set(o.windX, o.windZ);
    // the clouds drift with the wind, carried on from where they were (so a change of wind does not jump them)
    u.uWindOff.value.x += o.windX * 0.0012 * dt; u.uWindOff.value.y += o.windZ * 0.0012 * dt;
    u.uFogC.value.copy(o.fog.color); u.uFog.value.set(o.fog.near, o.fog.far, 1); u.uCamY.value = camera.position.y;
    u.uMoon.value.copy(o.moon); u.uEq.value.copy(o.eq);
    if (u.uOpt.value.x > 0.5) view.update(o.trueSun);
  }
  const MODEL = { physical: 1, painted: 0 }, CLOUDS = { volume: 2, layered: 2, flat: 1, heaped: 1, off: 0 }, NIGHT = { real: 2, simple: 1, off: 0 };
  return {
    mesh, update, view, uniforms, renderClouds,
    // the cloud pass's share of the frame's resolution: 1, 0.5 or 0.25
    setCloudScale(k) { cloudScale = k; },
    setHorizon(tex) { uniforms.uHz.value = tex; },
    setOptions({ model, clouds, night }) {
      const v = uniforms.uOpt.value;
      if (model in MODEL) v.x = MODEL[model];
      if (clouds in CLOUDS) v.y = CLOUDS[clouds];
      if (night in NIGHT) v.z = NIGHT[night];
    },
  };
}
