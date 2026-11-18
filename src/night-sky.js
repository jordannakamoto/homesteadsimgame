// The night sky as it really is over the homestead: the 5044 stars the eye can see (data/stars.js, from the HYG
// catalogue), each where it stands for the date, the hour and the latitude, with its true brightness and colour (blue
// white Rigel, orange Betelgeuse and Arcturus), so the constellations are the real ones, rising in the east, turning
// round the pole star and setting in the west through the night, and changing with the seasons. Near the horizon
// they dim and redden through the thicker air and twinkle more; clouds hide them; twilight and a bright moon wash out
// the faint ones first.
//
// skyFrame(t, latitudeDeg) works out the sky's frame (the sidereal time from the sun's hour angle and right ascension)
// and the moon: its phase (a 29.53-day cycle, a few days old on the first day of a new world) and its place along the
// ecliptic, east of the sun by its age, a little above or below with its tilted orbit. Approximate (no parallax or
// perturbations), but the moon rises about 50 minutes later each day, fills, wanes and is lit on the side toward the
// sun.
import * as THREE from 'three';
import { STARS } from './data/stars.js';
import { SKY_NOISE_GLSL } from './sky.js';
import * as calendar from './sim/calendar.js';

const RAD = Math.PI / 180, OBL = 23.44 * RAD, SYNODIC = 29.530588, DRACONIC = 27.2122;
const MOON_AGE_AT_START = 3.5 - calendar.START_DAY_OF_YEAR;   // days old at world time 0 (10 April): a young crescent

// sky frame and moon at world time t: { eq: Matrix3 (stars' frame to world), moon: Vector4 (world direction, lit
// fraction), age (days) }
const _P = new THREE.Vector3(), _Q = new THREE.Vector3(), _E = new THREE.Vector3(1, 0, 0), _a = new THREE.Vector3(), _b = new THREE.Vector3();
export function skyFrame(t, latitudeDeg, out) {
  const phi = latitudeDeg * RAD;
  // world: x east, y up, z south. The celestial pole stands over the north point at the latitude's height;
  // Q is where the celestial equator crosses the meridian in the south
  _P.set(0, Math.sin(phi), -Math.cos(phi)); _Q.set(0, Math.cos(phi), Math.sin(phi));
  const days = calendar.absoluteDays(t);
  const lam = 2 * Math.PI * (days - 79.6) / 365.2422;                       // the sun's ecliptic longitude (0 at the March equinox)
  const raSun = Math.atan2(Math.cos(OBL) * Math.sin(lam), Math.cos(lam));
  const lst = calendar.solarHourAngleRad(t) + raSun;
  const c = Math.cos(lst), s = Math.sin(lst);
  // star at (cos dec cos ra, cos dec sin ra, sin dec): hour angle lst - ra, direction cosd cosH Q - cosd sinH E + sind P
  _a.copy(_Q).multiplyScalar(c).addScaledVector(_E, -s);
  _b.copy(_Q).multiplyScalar(s).addScaledVector(_E, c);
  out.eq.set(_a.x, _b.x, _P.x, _a.y, _b.y, _P.y, _a.z, _b.z, _P.z);
  // the moon
  const age = (((days + MOON_AGE_AT_START) % SYNODIC) + SYNODIC) % SYNODIC;
  const lm = lam + 2 * Math.PI * age / SYNODIC, bm = 5.14 * RAD * Math.sin(2 * Math.PI * days / DRACONIC);
  const sd = Math.sin(bm) * Math.cos(OBL) + Math.cos(bm) * Math.sin(OBL) * Math.sin(lm);
  const dec = Math.asin(sd), ra = Math.atan2(Math.sin(lm) * Math.cos(OBL) - Math.tan(bm) * Math.sin(OBL), Math.cos(lm));
  _a.set(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)).applyMatrix3(out.eq).normalize();
  out.moon.set(_a.x, _a.y, _a.z, (1 - Math.cos(2 * Math.PI * age / SYNODIC)) / 2);
  out.age = age;
  out.eqInv.copy(out.eq).transpose();
  return out;
}

export function createNightSky({ scene, camera, sky }) {
  const raw = Uint8Array.from(atob(STARS), (ch) => ch.charCodeAt(0));
  const v = new DataView(raw.buffer), n = raw.length / 8;
  const pos = new Float32Array(n * 3), mag = new Float32Array(n), col = new Float32Array(n * 3);
  const bvCol = (bv) => {                                      // colour index to a star's colour (roughly its temperature)
    const t = Math.min(1, Math.max(0, (bv + 0.3) / 2.0));
    return [Math.min(1, 0.62 + t * 0.9), Math.min(1, 0.72 + t * 0.4) - Math.max(0, t - 0.55) * 0.5, Math.max(0.35, 1.0 - Math.max(0, t - 0.2) * 1.1)];
  };
  for (let i = 0; i < n; i++) {
    const ra = v.getUint16(i * 8, true) / 65535 * 2 * Math.PI, dec = (v.getUint16(i * 8 + 2, true) / 65535 * 180 - 90) * RAD;
    mag[i] = v.getUint16(i * 8 + 4, true) / 1000 - 2;
    const bv = v.getUint16(i * 8 + 6, true) / 20000 - 0.5;
    pos[i * 3] = Math.cos(dec) * Math.cos(ra); pos[i * 3 + 1] = Math.cos(dec) * Math.sin(ra); pos[i * 3 + 2] = Math.sin(dec);
    const c = bvCol(bv); col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  geo.setAttribute('scol', new THREE.BufferAttribute(col, 3));
  const su = sky.uniforms;
  const uniforms = {
    uEqW: { value: new THREE.Matrix3() }, uLimit: { value: 6 }, uVis: { value: 0 }, uScale: { value: 1 },
    uTime: su.uTime, uCloud: su.uCloud, uWindOff: su.uWindOff, uOpt: su.uOpt, uCloudNoise: su.uCloudNoise,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: /* glsl */ `
      uniform mat3 uEqW; uniform float uLimit, uVis, uScale, uTime;
      attribute float mag; attribute vec3 scol;
      varying vec3 vCol; varying vec3 vDir;
      void main() {
        vec3 d = normalize(uEqW * position);
        vDir = d;
        // the thicker air low down: dimmer (about a magnitude at 10 degrees), redder, and more twinkle
        float air = 1.0 / max(d.y + 0.025, 0.02);
        float m = mag + 0.12 * (air - 1.0);
        float f = pow(10.0, -0.4 * (m - uLimit + 1.0));      // flux relative to the faintest seen
        float tw = 1.0 + (0.12 + 0.5 * smoothstep(0.5, 0.05, d.y)) * sin(uTime * (9.0 + fract(mag * 37.0) * 9.0) + mag * 91.0);
        float b = clamp(f, 0.0, 3.0) * tw * uVis * smoothstep(uLimit + 0.3, uLimit - 0.6, m) * smoothstep(-0.01, 0.06, d.y);
        vCol = scol * mix(vec3(1.0), vec3(1.0, 0.75, 0.5), smoothstep(0.35, 0.03, d.y)) * b;
        vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + d * 280.0, 1.0);
        gl_Position = p.xyww;
        gl_Position.z = gl_Position.w * 0.99999;
        // a few pixels for the brightest, one for the faint; the brightest also bloom
        gl_PointSize = uScale * (2.0 + 8.0 * clamp(pow(10.0, -0.4 * (mag - 0.5)), 0.0, 1.0));
      }`,
    fragmentShader: SKY_NOISE_GLSL + /* glsl */ `
      uniform float uCloud; uniform vec2 uWindOff; uniform vec4 uOpt;
      varying vec3 vCol; varying vec3 vDir;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float r = length(q) * 2.0;
        // a sharp point and, for the bright ones (their sprites are bigger), a soft glow round it, as the eye sees them
        float a = smoothstep(0.32, 0.0, r) + exp(-r * r * 7.0) * 0.22;
        float hidden = cloudCover(normalize(vDir), clamp(uCloud, 0.0, 1.0), uWindOff, uOpt.y);
        gl_FragColor = vec4(vCol * a * (1.0 - hidden) * 2.8, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.renderOrder = -9;
  scene.add(points);
  return {
    points,
    // night: how dark the sky is (0 day .. 1 full night); moon: Vector4 (direction, lit fraction); eq: Matrix3
    update(eq, night, moon, pixelRatio) {
      uniforms.uEqW.value.copy(eq);
      const moonUp = Math.max(0, Math.min(1, (moon.y + 0.05) / 0.25));
      // the faintest star to be seen: 6 on a dark night, brighter with a moon up, much brighter in twilight
      uniforms.uLimit.value = 6.0 - 1.8 * moon.w * moonUp - 4.5 * (1 - night);
      uniforms.uVis.value = Math.min(1, night * 1.4);
      uniforms.uScale.value = pixelRatio;
      points.visible = night > 0.02 && uniforms.uVis.value > 0;
    },
    setOn(v) { points.material.visible = v; },
  };
}
