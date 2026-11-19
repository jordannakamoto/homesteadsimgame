// The night sky as it really is over the homestead: the 5044 stars the eye can see (data/stars.js, from the HYG
// catalogue), each where it stands for the date and the latitude, with its true brightness and colour (blue-white
// Rigel, red Antares, orange Arcturus), so the constellations are the real ones and change with the seasons. Near
// the horizon they dim and redden through the thicker air and twinkle more; clouds hide them; twilight and a bright
// moon wash out the faint ones first.
//
// Also: the planets (Venus, the evening or morning star, then Jupiter, Mars and Saturn) where they really are, from
// their orbits, bright and steady (planets do not twinkle); shooting stars, a few an hour on any dark night and many
// in the great showers (Quadrantids in January, Lyrids in April, Perseids in August, Orionids in October, Leonids in
// November, Geminids in December), each streaking away from its shower's radiant; and the moon's own changes
// (skyFrame): its phase, its distance (bigger and brighter at perigee, so some full moons are supermoons) and its
// eclipses (a full moon passing through the Earth's shadow, turning copper red).
//
// skyFrame(t, latitudeDeg) works out the sky's frame (the sidereal time from the sun's hour angle and right ascension)
// and the moon: its phase (a 29.53-day cycle, a few days old on the first day of a new world) and its place along the
// ecliptic, east of the sun by its age, a little above or below with its tilted orbit. Approximate (no parallax or
// perturbations), but the moon rises about 50 minutes later each day, fills, wanes and is lit on the side toward the
// sun.
//
// All of it costs nothing by day, or when no sky is on screen (the caller says), or under a closed sky.
import * as THREE from 'three';
import { STARS } from './data/stars.js';
import { SKY_NOISE_GLSL } from './sky.js';
import * as calendar from './sim/calendar.js';

const RAD = Math.PI / 180, OBL = 23.44 * RAD, SYNODIC = 29.530588, DRACONIC = 27.2122, ANOMALISTIC = 27.5546;
const MOON_AGE_AT_START = 3.5 - calendar.START_DAY_OF_YEAR;   // days old at world time 0 (10 April): a young crescent
const PERIGEE_AT = 6;                                         // a day of the first year the moon is nearest (sets which full moons are super)
const JD_YEAR1 = 2461041.5;                                   // the world's first 1 January, as a Julian date (2026): for the planets

// sky frame and moon at world time t: { eq: Matrix3 (stars' frame to world), moon: Vector4 (world direction, lit
// fraction), age (days) }
const _P = new THREE.Vector3(), _Q = new THREE.Vector3(), _E = new THREE.Vector3(1, 0, 0), _a = new THREE.Vector3(), _b = new THREE.Vector3();
// The game's clock runs far faster than life (a day in twenty minutes), and stars turning at that pace look wrong:
// so the stars (out.eq) show the true sky of the night at hand, as at its local midnight, and turn only at the real
// sidereal rate (realSeconds: real time passed), which the eye reads as still. The sun, the moon and the planets keep
// the game's clock (out.eqNow is the true frame for them: Venus belongs in the sunset's glow).
export function skyFrame(t, latitudeDeg, out, realSeconds = 0) {
  const phi = latitudeDeg * RAD;
  // world: x east, y up, z south. The celestial pole stands over the north point at the latitude's height;
  // Q is where the celestial equator crosses the meridian in the south
  _P.set(0, Math.sin(phi), -Math.cos(phi)); _Q.set(0, Math.cos(phi), Math.sin(phi));
  const days = calendar.absoluteDays(t);
  const lam = 2 * Math.PI * (days - 79.6) / 365.2422;                       // the sun's ecliptic longitude (0 at the March equinox)
  const raSun = Math.atan2(Math.cos(OBL) * Math.sin(lam), Math.cos(lam));
  const lstOf = (tt) => calendar.solarHourAngleRad(tt) + raSun;
  // star at (cos dec cos ra, cos dec sin ra, sin dec): hour angle lst - ra, direction cosd cosH Q - cosd sinH E + sind P
  const frame = (lst, m) => {
    const c = Math.cos(lst), s = Math.sin(lst);
    _a.copy(_Q).multiplyScalar(c).addScaledVector(_E, -s);
    _b.copy(_Q).multiplyScalar(s).addScaledVector(_E, c);
    m.set(_a.x, _b.x, _P.x, _a.y, _b.y, _P.y, _a.z, _b.z, _P.z);
  };
  frame(lstOf(t), out.eqNow);
  // the night at hand: its local midnight (after noon, the coming one)
  const frac = days - Math.floor(days), midnight = t - frac * 86400 + (frac >= 0.5 ? 86400 : 0);
  frame(lstOf(midnight) + realSeconds * 7.2921e-5, out.eq);
  // the moon
  const age = (((days + MOON_AGE_AT_START) % SYNODIC) + SYNODIC) % SYNODIC;
  const lm = lam + 2 * Math.PI * age / SYNODIC, bm = 5.14 * RAD * Math.sin(2 * Math.PI * days / DRACONIC);
  const sd = Math.sin(bm) * Math.cos(OBL) + Math.cos(bm) * Math.sin(OBL) * Math.sin(lm);
  const dec = Math.asin(sd), ra = Math.atan2(Math.sin(lm) * Math.cos(OBL) - Math.tan(bm) * Math.sin(OBL), Math.cos(lm));
  _a.set(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)).applyMatrix3(out.eqNow).normalize();
  out.moon.set(_a.x, _a.y, _a.z, (1 - Math.cos(2 * Math.PI * age / SYNODIC)) / 2);
  out.age = age;
  // its distance: 7 per cent nearer or farther over the anomalistic month (size and brightness with it)
  out.moonSize = 1 / (1 - 0.055 * Math.cos(2 * Math.PI * (days - PERIGEE_AT) / ANOMALISTIC));
  // an eclipse: how far the full moon passes from the middle of the Earth's shadow (degrees; the shadow's dark core
  // is about 0.7 across in radius at the moon's distance, the moon 0.26)
  const fromFull = (age - SYNODIC / 2) / SYNODIC * 360, sep = Math.hypot(fromFull, bm / RAD);
  out.eclipse = sep < 1.6 ? Math.min(1, Math.max(0, (1.0 - sep) / 0.55)) : 0;      // 0 none .. 1 totality
  out.penumbra = Math.max(0, Math.min(1, (1.6 - sep) / 0.6));
  out.days = days;
  out.eqInv.copy(out.eq).transpose();
  return out;
}

// ---- the planets: Keplerian elements (Standish, valid 1800-2050) and their rates per century
const PLANETS = [
  // name, a, e, I, L, long. perihelion, long. node; then their rates; magnitude at 1 AU and 1 AU, colour
  ['venus', [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418], -4.4, [1.0, 0.98, 0.9]],
  ['mars', [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343], -1.52, [1.0, 0.62, 0.42]],
  ['jupiter', [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106], -9.4, [1.0, 0.95, 0.85]],
  ['saturn', [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794], -8.9, [1.0, 0.92, 0.75]],
];
const EARTH = [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]];
function helio(el, rate, T) {
  const [a, e, I, L, wb, O] = el.map((x, i) => x + rate[i] * T);
  const w = (wb - O) * RAD, Om = O * RAD, inc = I * RAD;
  let M = ((L - wb) % 360) * RAD, E = M;
  for (let k = 0; k < 6; k++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(inc), sI = Math.sin(inc);
  return [(cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp, (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp, sw * sI * xp + cw * sI * yp];
}
// each planet's direction in the stars' frame (unit, equatorial) and magnitude, at world day `days`
export function planetsAt(days) {
  const T = (JD_YEAR1 + days - 2451545.0) / 36525;
  const ea = helio(EARTH[0], EARTH[1], T), re = Math.hypot(...ea);
  return PLANETS.map(([name, el, rate, m0, col]) => {
    const p = helio(el, rate, T), r = Math.hypot(...p);
    const g = [p[0] - ea[0], p[1] - ea[1], p[2] - ea[2]], D = Math.hypot(...g);
    // ecliptic to equatorial
    const x = g[0] / D, y = (g[1] * Math.cos(OBL) - g[2] * Math.sin(OBL)) / D, z = (g[1] * Math.sin(OBL) + g[2] * Math.cos(OBL)) / D;
    // brightness: distance from the sun and from us, and (for Venus) how much of it is lit
    const phase = Math.acos(Math.max(-1, Math.min(1, (r * r + D * D - re * re) / (2 * r * D)))) / RAD;
    let m = m0 + 5 * Math.log10(r * D) + (name === 'venus' ? 0.0009 * phase + 0.00000239 * phase * phase * phase / 100 : name === 'mars' ? 0.016 * phase : 0);
    if (name === 'venus') m = Math.max(-4.9, Math.min(-3.8, m));
    return { name, dir: [x, y, z], mag: m, col };
  });
}

// ---- the meteor showers: day of the year at the peak, radiant (right ascension, declination, degrees), hourly
// rate at their best
const SHOWERS = [
  [3, 230, 49, 80], [112, 271, 34, 18], [224, 48, 58, 100], [294, 95, 16, 20], [321, 152, 22, 15], [347, 112, 33, 120],
];

export function createNightSky({ scene, camera, sky }) {
  const raw = Uint8Array.from(atob(STARS), (ch) => ch.charCodeAt(0));
  const v = new DataView(raw.buffer), n = raw.length / 8;
  const pos = new Float32Array(n * 3), mag = new Float32Array(n), col = new Float32Array(n * 3), steady = new Float32Array(n);
  // colour index to a star's colour (roughly its temperature): blue-white through white and gold to orange-red
  const bvCol = (bv) => {
    const t = Math.min(1, Math.max(0, (bv + 0.35) / 2.1));
    return [Math.min(1, 0.55 + t * 1.0), Math.min(1, 0.7 + t * 0.45) - Math.max(0, t - 0.55) * 0.65, Math.max(0.28, 1.0 - Math.max(0, t - 0.18) * 1.25)];
  };
  for (let i = 0; i < n; i++) {
    const ra = v.getUint16(i * 8, true) / 65535 * 2 * Math.PI, dec = (v.getUint16(i * 8 + 2, true) / 65535 * 180 - 90) * RAD;
    mag[i] = v.getUint16(i * 8 + 4, true) / 1000 - 2;
    const bv = v.getUint16(i * 8 + 6, true) / 20000 - 0.5;
    pos[i * 3] = Math.cos(dec) * Math.cos(ra); pos[i * 3 + 1] = Math.cos(dec) * Math.sin(ra); pos[i * 3 + 2] = Math.sin(dec);
    const c = bvCol(bv); col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  const su = sky.uniforms;
  // drawn after the frame is enlarged, at the screen's own resolution (crisp points, not blobs scaled up with the
  // rest); hidden behind the land by the frame's depth (uDepth, the scene's depth texture, when there is one)
  const occl = { uDepth: { value: null }, uScreenPx: { value: new THREE.Vector2(1, 1) }, uUseDepth: { value: 0 } };
  const shared = {
    ...occl, uLimit: { value: 6 }, uVis: { value: 0 }, uScale: { value: 1 },
    uTime: su.uTime, uCloud: su.uCloud, uWindOff: su.uWindOff, uOpt: su.uOpt, uCloudNoise: su.uCloudNoise, uNoise3: su.uNoise3,
  };
  const makeMat = (uEqW) => new THREE.ShaderMaterial({
    uniforms: { ...shared, uEqW }, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: /* glsl */ `
      uniform mat3 uEqW; uniform float uLimit, uVis, uScale, uTime;
      attribute float mag, steady; attribute vec3 scol;
      varying vec3 vCol; varying vec3 vDir; varying float vSize, vBright;
      void main() {
        vec3 d = normalize(uEqW * position);
        vDir = d;
        // the thicker air low down: dimmer (about a magnitude at 10 degrees), redder, and more twinkle
        float air = 1.0 / max(d.y + 0.025, 0.02);
        float m = mag + 0.12 * (air - 1.0);
        // brightness by the real scale (each magnitude 2.5 times the next): a few bright stars stand out, the many
        // faint ones are barely there, rather than a field of equal specks
        float flux = pow(10.0, -0.4 * (m - 1.0));
        float f = 0.07 + 0.9 * min(flux, 1.6 + 1.4 * steady);
        // a gentle twinkle, mostly low down where the air is thick, with a flicker of colour in the brightest low
        // stars; the planets shine steady
        float ph = uTime * (2.2 + fract(mag * 37.0) * 2.5) + mag * 91.0;
        float low = smoothstep(0.35, 0.03, d.y);
        float tw = 1.0 + (0.03 + 0.22 * low) * sin(ph) * (1.0 - steady);
        float b = f * tw * uVis * smoothstep(uLimit + 0.3, uLimit - 0.6, m) * smoothstep(-0.01, 0.06, d.y);
        vec3 sc = scol * (1.0 + low * 0.25 * vec3(sin(ph * 1.7), sin(ph * 1.3 + 2.0), sin(ph * 2.1 + 4.0)) * (1.0 - steady) * smoothstep(0.3, 1.0, flux));
        vCol = sc * mix(vec3(1.0), vec3(1.0, 0.75, 0.5), low) * b;
        vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + d * 280.0, 1.0);
        gl_Position = p.xyww;
        gl_Position.z = gl_Position.w * 0.99999;
        // the sprite: every star at least a soft point a pixel and a half across (smaller, it would come and go
        // between pixels as the view moves, like dust), the bright ones with room for a glow
        vBright = clamp(flux - 0.25, 0.0, 1.0 + steady);
        vSize = uScale * (3.0 + 8.0 * min(vBright, 1.4));
        gl_PointSize = vSize;
      }`,
    fragmentShader: SKY_NOISE_GLSL + /* glsl */ `
      uniform float uCloud; uniform vec2 uWindOff; uniform vec4 uOpt;
      uniform sampler2D uDepth; uniform vec2 uScreenPx; uniform float uUseDepth, uScale;
      varying vec3 vCol; varying vec3 vDir; varying float vSize, vBright;
      void main() {
        if (uUseDepth > 0.5 && texture2D(uDepth, gl_FragCoord.xy / uScreenPx).r < 0.9999) discard;
        vec2 q = gl_PointCoord - 0.5;
        float r = length(q) * 2.0;
        // a sharp point and, for the bright ones (their sprites are bigger), a soft glow round it, as the eye sees them
        float rp = r * 0.5 * vSize;                          // pixels from the centre
        // a fine core (about half a point across on a sharp screen) and, for the bright, a soft glow
        float sg = 0.3 + 0.35 * uScale;
        float a = exp(-rp * rp / (2.0 * sg * sg)) * (0.62 * 0.62) / (sg * sg) * min(1.0, 0.45 + 0.55 / uScale * 1.6)
                + exp(-rp * rp / (2.0 * pow(0.2 * vSize, 2.0))) * 0.18 * vBright;
        float hidden = cloudCover(normalize(vDir), clamp(uCloud, 0.0, 1.0), uWindOff, uOpt.y);
        gl_FragColor = vec4(vCol * a * (1.0 - hidden) * 1.6, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  starGeo.setAttribute('scol', new THREE.BufferAttribute(col, 3));
  starGeo.setAttribute('steady', new THREE.BufferAttribute(steady, 1));
  const uStars = { value: new THREE.Matrix3() }, uNow = { value: new THREE.Matrix3() };
  const points = new THREE.Points(starGeo, makeMat(uStars));
  points.frustumCulled = false; points.renderOrder = -9;
  scene.add(points);

  // the planets, in the true sky of the hour
  const NP = PLANETS.length;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NP * 3), 3));
  pGeo.setAttribute('mag', new THREE.BufferAttribute(new Float32Array(NP), 1));
  pGeo.setAttribute('scol', new THREE.BufferAttribute(new Float32Array(NP * 3), 3));
  pGeo.setAttribute('steady', new THREE.BufferAttribute(new Float32Array(NP).fill(1), 1));
  const planets = new THREE.Points(pGeo, makeMat(uNow));
  planets.frustumCulled = false; planets.renderOrder = -9;
  scene.add(planets);
  let lastPlanetDay = -1e9;

  // ---- shooting stars: up to three at once, each a short streak drawn as a thin quad on the sky, its head bright
  // and its tail fading, burning out in under a second (a rare fireball longer and brighter, sometimes green)
  const NM = 3;
  const mPos = new Float32Array(NM * 4 * 3), mUv = new Float32Array(NM * 4 * 2), mIdx = [];
  for (let k = 0; k < NM; k++) {
    const b = k * 4;
    mIdx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    mUv.set([0, -1, 0, 1, 1, -1, 1, 1], k * 8);
  }
  const mGeo = new THREE.BufferGeometry();
  mGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
  mGeo.setAttribute('uv', new THREE.BufferAttribute(mUv, 2));
  mGeo.setAttribute('mcol', new THREE.BufferAttribute(new Float32Array(NM * 4 * 4), 4));
  mGeo.setIndex(mIdx);
  const mMat = new THREE.ShaderMaterial({
    uniforms: { ...occl, uCloud: su.uCloud, uWindOff: su.uWindOff, uOpt: su.uOpt, uCloudNoise: su.uCloudNoise, uNoise3: su.uNoise3, uTime: su.uTime },
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec4 mcol; varying vec4 vCol; varying vec2 vUv; varying vec3 vDir;
      void main() {
        vCol = mcol; vUv = uv; vDir = normalize(position - cameraPosition);
        vec4 p = projectionMatrix * viewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; gl_Position.z = gl_Position.w * 0.99998;
      }`,
    fragmentShader: SKY_NOISE_GLSL + /* glsl */ `
      uniform float uCloud; uniform vec2 uWindOff; uniform vec4 uOpt;
      uniform sampler2D uDepth; uniform vec2 uScreenPx; uniform float uUseDepth;
      varying vec4 vCol; varying vec2 vUv; varying vec3 vDir;
      void main() {
        if (uUseDepth > 0.5 && texture2D(uDepth, gl_FragCoord.xy / uScreenPx).r < 0.9999) discard;
        // vUv.x: 0 at the tail .. 1 at the head; vUv.y across
        float along = pow(vUv.x, 2.2), across = exp(-vUv.y * vUv.y * 4.0);
        float head = exp(-pow((1.0 - vUv.x) * 9.0, 2.0)) * 1.5;
        float hidden = cloudCover(normalize(vDir), clamp(uCloud, 0.0, 1.0), uWindOff, uOpt.y);
        gl_FragColor = vec4(vCol.rgb * (along + head) * across * vCol.a * (1.0 - hidden), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const meteors = new THREE.Mesh(mGeo, mMat);
  meteors.frustumCulled = false; meteors.renderOrder = -8; meteors.visible = false;
  scene.add(meteors);
  const live = [];                                              // { from, dir (unit vectors), len, life, age, bright, col }
  const _m0 = new THREE.Vector3(), _m1 = new THREE.Vector3(), _side = new THREE.Vector3(), _rad = new THREE.Vector3(), _t = new THREE.Vector3();
  function spawn(eq, days) {
    // which shower, if any, is on: its radiant (in the true sky of the hour, eqNow, like everything that moves)
    const doy = ((days % 365) + 365) % 365;
    let best = null, rate = 6;
    for (const [peak, ra, dec, zhr] of SHOWERS) {
      const dd = Math.min(Math.abs(doy - peak), 365 - Math.abs(doy - peak)), k = Math.exp(-dd * dd / 3.2);
      if (k * zhr > 2 && (!best || k * zhr > best.r)) best = { r: k * zhr, ra: ra * RAD, dec: dec * RAD };
      rate += k * zhr;
    }
    // a start somewhere in the sky above 20 degrees
    let dir;
    for (let i = 0; i < 8; i++) {
      const az = Math.random() * Math.PI * 2, el = (20 + Math.random() * 60) * RAD;
      _m0.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
      if (_m0.y > 0.3) break;
    }
    if (best && Math.random() < best.r / rate) {
      // a shower meteor: travelling straight away from the radiant
      _rad.set(Math.cos(best.dec) * Math.cos(best.ra), Math.cos(best.dec) * Math.sin(best.ra), Math.sin(best.dec)).applyMatrix3(eq).normalize();
      dir = _t.copy(_m0).sub(_rad.clone().multiplyScalar(_m0.dot(_rad))).normalize().clone();
    } else {
      _t.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      dir = _t.sub(_m0.clone().multiplyScalar(_t.dot(_m0))).normalize().clone();
      if (dir.y > 0.2) dir.y *= -1;                            // most head downward, as they seem to
    }
    const fire = Math.random() < 0.04;
    live.push({
      from: _m0.clone(), dir: dir.normalize(), len: (fire ? 0.3 : 0.08 + Math.random() * 0.22),
      life: fire ? 1.6 + Math.random() : 0.35 + Math.random() * 0.7, age: 0,
      bright: fire ? 9 : 1.6 + Math.random() * 3.0,
      col: fire && Math.random() < 0.5 ? [0.7, 1.0, 0.75] : [1.0, 0.95, 0.85],
    });
    return rate;
  }
  let meteorClock = 0;
  function updateMeteors(dt, night, cover, eqNow, days, pxAngle, on) {
    const col = mGeo.attributes.mcol.array;
    // how many an hour: the sporadic few plus any shower, on a clear dark night (a game night passes in minutes,
    // so the rate is per real minute, about ten times the real hourly rate spread over the short night)
    if (on && night > 0.6 && cover < 0.7 && live.length < NM) {
      meteorClock -= dt;
      if (meteorClock <= 0) {
        const rate = spawn(eqNow, days);
        meteorClock = (60 / Math.max(0.5, rate * 0.12)) * (0.4 + Math.random() * 1.2);
      }
    }
    mPos.fill(0); col.fill(0);
    for (let i = live.length - 1; i >= 0; i--) { live[i].age += dt; if (live[i].age > live[i].life) live.splice(i, 1); }
    live.forEach((m, k) => {
      const f = m.age / m.life, travelled = m.len * Math.min(1, f * 1.3);
      // head and tail along the great circle from its start
      _m1.copy(m.from).multiplyScalar(Math.cos(travelled)).addScaledVector(m.dir, Math.sin(travelled));
      const tail = Math.max(0, travelled - m.len * 0.55);
      _m0.copy(m.from).multiplyScalar(Math.cos(tail)).addScaledVector(m.dir, Math.sin(tail));
      _side.crossVectors(_m1, m.dir).normalize().multiplyScalar(280 * pxAngle * (m.bright > 6 ? 2.2 : 1.4));
      const c = camera.position, b = k * 12;
      const h = _m1.clone().multiplyScalar(280).add(c), tl = _m0.clone().multiplyScalar(280).add(c);
      mPos.set([tl.x - _side.x, tl.y - _side.y, tl.z - _side.z, tl.x + _side.x, tl.y + _side.y, tl.z + _side.z, h.x - _side.x, h.y - _side.y, h.z - _side.z, h.x + _side.x, h.y + _side.y, h.z + _side.z], b);
      const a = m.bright * Math.sin(Math.PI * Math.min(1, f)) * night * smoothstep01(-0.02, 0.15, Math.min(_m1.y, _m0.y + 0.1));
      for (let j = 0; j < 4; j++) col.set([m.col[0], m.col[1], m.col[2], a], (k * 4 + j) * 4);
    });
    mGeo.attributes.position.needsUpdate = true; mGeo.attributes.mcol.needsUpdate = true;
    meteors.visible = live.length > 0;
  }
  const smoothstep01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  let on = true, limitMax = 5.2;
  return {
    points, planets, meteors,
    // frame: the skyFrame result; night: how dark the sky is (0 day .. 1 full night); skyOnScreen: whether any of
    // the sky is in view; cover: the cloud cover; dt: real seconds
    update(frame, night, pixelRatio, skyOnScreen, cover, dt, pxAngle) {
      const moon = frame.moon;
      uStars.value.copy(frame.eq); uNow.value.copy(frame.eqNow);
      const moonUp = Math.max(0, Math.min(1, (moon.y + 0.05) / 0.25));
      // the faintest star to be seen: 6 on a dark night, brighter with a moon up, much brighter in twilight
      shared.uLimit.value = limitMax - 1.8 * moon.w * moonUp * (1 - frame.eclipse * 0.9) - 4.5 * (1 - night);
      shared.uVis.value = Math.min(1, night * 1.4);
      shared.uScale.value = pixelRatio;
      // nothing to draw by day, with no sky in view, or under a closed sky
      const show = on && night > 0.02 && skyOnScreen && cover < 0.97;
      points.visible = show;
      planets.visible = on && night > 0.01 && skyOnScreen && cover < 0.97;
      if (planets.visible && Math.abs(frame.days - lastPlanetDay) > 0.02) {
        lastPlanetDay = frame.days;
        const ps = planetsAt(frame.days), pp = pGeo.attributes.position.array, pm = pGeo.attributes.mag.array, pc = pGeo.attributes.scol.array;
        ps.forEach((p, i) => { pp.set(p.dir, i * 3); pm[i] = p.mag; pc.set(p.col, i * 3); });
        pGeo.attributes.position.needsUpdate = pGeo.attributes.mag.needsUpdate = pGeo.attributes.scol.needsUpdate = true;
      }
      updateMeteors(dt, night, cover, frame.eqNow, frame.days, pxAngle, show);
      if (!show) meteors.visible = false;
    },
    // how many stars: 'rich' (all the eye can see on the darkest night, to magnitude 6), 'natural' (to about 5.2,
    // as most dark country skies), 'sparse' (the brighter few hundred)
    setField(k) { limitMax = k === 'rich' ? 6.0 : k === 'sparse' ? 4.4 : 5.2; },
    // before drawing: the scene's depth texture (null when the frame is drawn straight to the screen, which leaves its
    // own depth for the stars to test against) and the screen's size in pixels
    setTarget(depthTex, w, h) { occl.uDepth.value = depthTex; occl.uUseDepth.value = depthTex ? 1 : 0; occl.uScreenPx.value.set(w, h); },
    setOn(v) { on = v; if (!v) { points.visible = planets.visible = meteors.visible = false; } },
    // for tests: start a shooting star now
    meteorNow(frame) { spawn(frame.eqNow, frame.days); },
  };
}
