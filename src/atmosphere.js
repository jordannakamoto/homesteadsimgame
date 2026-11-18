// The atmosphere: light scattered by air (Rayleigh: the blue, and the reds of sunset once the light has come a long
// way), by haze (Mie: the bright glow round the sun) and absorbed by ozone (the deep blue of twilight), lit by the sun
// through the air it has crossed, with the Earth's shadow below the horizon. Physically based, after Hillaire, "A
// Scalable and Production Ready Sky and Atmosphere Rendering Technique" (EGSR 2020, Unreal's sky): the sky has little
// fine detail, so it is worked out into a small texture over every direction (the sky-view table: azimuth across,
// elevation up it, with more rows near the horizon where the colour changes fastest) and the sky dome reads that.
// Sunsets, the blue hour, the pink band over the Earth's shadow and the pale haze at the horizon all come out of it,
// rather than being painted in.
//
// The same model runs on the CPU (skyRadiance) a few times a second for the colours the rest of the game needs: the
// haze colour of the distance (so far land fades into exactly the sky behind it) and the sky's colour above.
//
// Units: kilometres; the radiance is scaled by EXPOSURE to the brightness of the game's palette.
import * as THREE from 'three';

const RP = 6360, RA = 6460, EYE = 0.25;
const RAY = [5.802e-3, 13.558e-3, 33.1e-3], RAY_H = 8;
const MIE_S = 3.996e-3, MIE_E = 4.4e-3, MIE_H = 1.2, MIE_G = 0.8;
const OZ = [0.650e-3, 1.881e-3, 0.085e-3];
export const EXPOSURE = 0.23;
const SUN_E = 20;
const NV = 20, NL = 6;

// GLSL: the same model (kept line for line with the JS below)
export const ATMOS_GLSL = /* glsl */ `
  const float A_RP = ${RP.toFixed(1)}, A_RA = ${RA.toFixed(1)};
  const vec3 A_RAY = vec3(${RAY.map((v) => v.toExponential(4)).join(', ')});
  const vec3 A_OZ = vec3(${OZ.map((v) => v.toExponential(4)).join(', ')});
  float aSphere(vec3 o, vec3 d, float r) {             // distance to leave (or the first hit of) a sphere at the origin
    float b = dot(o, d), c = dot(o, o) - r * r, h = b * b - c;
    if (h < 0.0) return -1.0;
    h = sqrt(h);
    return -b - h > 0.0 ? -b - h : -b + h;
  }
  void aMedium(float hk, out vec3 rs, out float ms, out vec3 ext) {
    float rd = exp(-hk / ${RAY_H.toFixed(1)}), md = exp(-hk / ${MIE_H.toFixed(1)}), oz = max(0.0, 1.0 - abs(hk - 25.0) / 15.0);
    rs = A_RAY * rd; ms = ${MIE_S.toExponential(4)} * md;
    ext = rs + ${MIE_E.toExponential(4)} * md + A_OZ * oz;
  }
  vec3 aSunTrans(vec3 p, vec3 s) {                     // what of the sunlight reaches p (nothing in the Earth's shadow)
    float tg = aSphere(p, s, A_RP);
    if (tg > 0.0 && dot(p, s) < 0.0) return vec3(0.0);
    float t1 = aSphere(p, s, A_RA), dt = t1 / ${NL}.0;
    vec3 od = vec3(0.0);
    for (int j = 0; j < ${NL}; j++) {
      vec3 q = p + s * (dt * (float(j) + 0.5));
      vec3 rs; float ms; vec3 ext; aMedium(length(q) - A_RP, rs, ms, ext);
      od += ext * dt;
    }
    return exp(-od);
  }
  vec3 aSky(vec3 d, vec3 s) {
    vec3 o = vec3(0.0, A_RP + ${EYE.toFixed(2)}, 0.0);
    float t1 = aSphere(o, d, A_RA), tg = aSphere(o, d, A_RP);
    if (tg > 0.0) t1 = tg;
    float mu = dot(d, s);
    float pr = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu);
    float g = ${MIE_G.toFixed(2)}, g2 = g * g;
    float pm = 3.0 / (8.0 * 3.14159265) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
    vec3 L = vec3(0.0), T = vec3(1.0);
    float t = 0.0;
    for (int i = 0; i < ${NV}; i++) {
      float tn = t1 * pow((float(i) + 1.0) / ${NV}.0, 2.0), dt = tn - t;   // finer steps near the eye
      vec3 p = o + d * (t + dt * 0.5);
      vec3 rs; float ms; vec3 ext; aMedium(length(p) - A_RP, rs, ms, ext);
      vec3 st = aSunTrans(p, s);
      // single scattering, and a cheap stand-in for light scattered more than once (isotropic, from the sunlit air)
      vec3 S = st * (rs * pr + ms * pm) + (rs + ms) * (0.08 * st + 0.012 * smoothstep(-0.25, 0.1, s.y));
      vec3 te = exp(-ext * dt);
      L += T * S * (1.0 - te) / max(ext, vec3(1e-7));
      T *= te; t = tn;
    }
    return L * ${SUN_E.toFixed(1)};
  }
  vec3 aSunColor(vec3 s, float hk) { return aSunTrans(vec3(0.0, A_RP + hk, 0.0), s) * ${SUN_E.toFixed(1)}; }
  // the sky-view table: u round the compass, v up the sky, finer near the horizon
  vec2 aViewUV(vec3 d) {
    float el = asin(clamp(d.y, -1.0, 1.0)), az = atan(d.z, d.x);
    float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / 1.5707963);
    return vec2(az / 6.2831853 + 0.5, v);
  }
  vec3 aViewDir(vec2 uv) {
    float vv = (uv.y - 0.5) * 2.0, el = sign(vv) * vv * vv * 1.5707963, az = (uv.x - 0.5) * 6.2831853;
    return vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
  }
`;

// ---- CPU: the same, for a handful of directions
function sphere(o, d, r) {
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2], c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r, h = b * b - c;
  if (h < 0) return -1;
  const s = Math.sqrt(h);
  return -b - s > 0 ? -b - s : -b + s;
}
function medium(hk, out) {
  const rd = Math.exp(-hk / RAY_H), md = Math.exp(-hk / MIE_H), oz = Math.max(0, 1 - Math.abs(hk - 25) / 15);
  out.ms = MIE_S * md;
  for (let k = 0; k < 3; k++) { out.rs[k] = RAY[k] * rd; out.ext[k] = out.rs[k] + MIE_E * md + OZ[k] * oz; }
}
const _m = { rs: [0, 0, 0], ext: [0, 0, 0], ms: 0 };
function sunTrans(p, s, out) {
  const tg = sphere(p, s, RP);
  if (tg > 0 && p[0] * s[0] + p[1] * s[1] + p[2] * s[2] < 0) { out[0] = out[1] = out[2] = 0; return out; }
  const t1 = sphere(p, s, RA), dt = t1 / NL;
  let a = 0, b = 0, c = 0;
  for (let j = 0; j < NL; j++) {
    const f = dt * (j + 0.5), q0 = p[0] + s[0] * f, q1 = p[1] + s[1] * f, q2 = p[2] + s[2] * f;
    medium(Math.hypot(q0, q1, q2) - RP, _m);
    a += _m.ext[0] * dt; b += _m.ext[1] * dt; c += _m.ext[2] * dt;
  }
  out[0] = Math.exp(-a); out[1] = Math.exp(-b); out[2] = Math.exp(-c);
  return out;
}
const _st = [0, 0, 0], _p = [0, 0, 0];
// radiance (exposed, linear) seen looking along d with the sun toward s; both unit [x, y, z], y up
export function skyRadiance(d, s, out = [0, 0, 0]) {
  const o = [0, RP + EYE, 0];
  let t1 = sphere(o, d, RA);
  const tg = sphere(o, d, RP);
  if (tg > 0) t1 = tg;
  const mu = d[0] * s[0] + d[1] * s[1] + d[2] * s[2];
  const pr = 3 / (16 * Math.PI) * (1 + mu * mu), g = MIE_G, g2 = g * g;
  const pm = 3 / (8 * Math.PI) * ((1 - g2) * (1 + mu * mu)) / ((2 + g2) * Math.pow(1 + g2 - 2 * g * mu, 1.5));
  const L = [0, 0, 0], T = [1, 1, 1];
  const amb = 0.012 * smooth(-0.25, 0.1, s[1]);
  let t = 0;
  for (let i = 0; i < NV; i++) {
    const tn = t1 * ((i + 1) / NV) ** 2, dt = tn - t, f = t + dt * 0.5;
    _p[0] = o[0] + d[0] * f; _p[1] = o[1] + d[1] * f; _p[2] = o[2] + d[2] * f;
    medium(Math.hypot(_p[0], _p[1], _p[2]) - RP, _m);
    const rs = _m.rs.slice(), ms = _m.ms, ext = _m.ext.slice();
    sunTrans(_p, s, _st);
    for (let k = 0; k < 3; k++) {
      const S = _st[k] * (rs[k] * pr + ms * pm) + (rs[k] + ms) * (0.08 * _st[k] + amb);
      const te = Math.exp(-ext[k] * dt);
      L[k] += T[k] * S * (1 - te) / Math.max(ext[k], 1e-7);
      T[k] *= te;
    }
    t = tn;
  }
  for (let k = 0; k < 3; k++) out[k] = L[k] * SUN_E * EXPOSURE;
  return out;
}
// the colour of sunlight reaching height hk km (exposed)
export function sunColor(s, hk = EYE, out = [0, 0, 0]) {
  sunTrans([0, RP + hk, 0], s, out);
  for (let k = 0; k < 3; k++) out[k] *= SUN_E * EXPOSURE;
  return out;
}
function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// ---- the sky-view table on the GPU: 192 x 108, redrawn when the sun has moved
export function createSkyView(renderer) {
  const W = 192, H = 108;
  const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false });
  target.texture.minFilter = target.texture.magFilter = THREE.LinearFilter;
  target.texture.wrapS = THREE.RepeatWrapping; target.texture.wrapT = THREE.ClampToEdgeWrapping;
  target.texture.generateMipmaps = false;
  const uSun = { value: new THREE.Vector3(0, 1, 0) };
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun },
    depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: ATMOS_GLSL + `
      uniform vec3 uSun; varying vec2 vUv;
      void main() { gl_FragColor = vec4(aSky(aViewDir(vUv), normalize(uSun)) * ${EXPOSURE}, 1.0); }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const last = new THREE.Vector3(9, 9, 9);
  return {
    texture: target.texture,
    // redraw when the sun has moved a little (about a sixth of a degree): at normal speed every few seconds
    update(sunDir) {
      if (last.distanceToSquared(sunDir) < 1e-5) return false;
      last.copy(sunDir); uSun.value.copy(sunDir);
      const prev = renderer.getRenderTarget(), xr = renderer.xr.enabled;
      renderer.xr.enabled = false;
      renderer.setRenderTarget(target); renderer.render(sc, cam); renderer.setRenderTarget(prev);
      renderer.xr.enabled = xr;
      return true;
    },
  };
}
