// Water effects that are not the surface itself: spray, mist and splashes as soft sprites, rings spreading on the
// water, and the foam texture the surface and the falls share. Done the way films and games do white water
// (spray, surface foam and bubbles are told apart; splashes are sprites, not geometry):
//  - spray: small bright droplets thrown up and falling back under gravity, round and soft-edged, lit by the sky
//    and sun; short-lived
//  - mist: large, faint, slowly growing puffs that drift up and away with the wind, where falls land
//  - splash: a crown of droplets and a puff of mist where a foot or something dropped breaks the surface
//  - rings: ripples spreading from where the water is touched, drawn by the water shader (uRip, river-shade.js)
//    as a travelling ring in the surface normal, so they catch the light like real ones
//  - foam texture: a tileable lace of bubble cells (two sizes) over a soft noise, cut by a threshold that rises as
//    foam thins (Uncharted's "threshold on a gradient field"), so foam erodes away into holes and strands instead
//    of fading out
import * as THREE from 'three';

const MAX = 2400;

// tileable foam: R the coarse bubble lace, G a finer lace, B smooth noise; 256 px over the tile
export function makeFoamTexture(seed = 7) {
  const N = 256;
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const lace = (cells) => {
    const pts = Array.from({ length: cells }, () => [rnd() * N, rnd() * N, 0.6 + 0.8 * rnd()]);
    const g = Math.ceil(Math.sqrt(cells)), gs = N / g, grid = Array.from({ length: g * g }, () => []);
    pts.forEach((p, i) => grid[Math.min(g - 1, Math.floor(p[1] / gs)) * g + Math.min(g - 1, Math.floor(p[0] / gs))].push(i));
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let f1 = 1e9, f2 = 1e9;
      const gx = Math.floor(x / gs), gy = Math.floor(y / gs);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const cx = (gx + dx + g) % g, cy = (gy + dy + g) % g;
        for (const i of grid[cy * g + cx]) {
          let ex = pts[i][0] - x, ey = pts[i][1] - y;
          ex -= Math.round(ex / N) * N; ey -= Math.round(ey / N) * N;
          const d = Math.hypot(ex, ey) / pts[i][2];
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
        }
      }
      // bright on the walls between bubbles, dark in their middles
      const wall = 1 - Math.min(1, (f2 - f1) / (gs * 0.55));
      out[y * N + x] = Math.pow(wall, 2.2) * (0.55 + 0.45 * Math.min(1, f1 / (gs * 0.6)));
    }
    return out;
  };
  const coarse = lace(70), fine = lace(380);
  // smooth tileable value noise
  const vn = (freq) => {
    const v = Array.from({ length: freq * freq }, rnd), out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = (x / N) * freq, fy = (y / N) * freq, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const a = v[(iy % freq) * freq + (ix % freq)], b = v[(iy % freq) * freq + ((ix + 1) % freq)], c = v[((iy + 1) % freq) * freq + (ix % freq)], d = v[((iy + 1) % freq) * freq + ((ix + 1) % freq)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      out[y * N + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
    return out;
  };
  const n1 = vn(4), n2 = vn(9), n3 = vn(19);
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round(255 * Math.min(1, coarse[i]));
    data[i * 4 + 1] = Math.round(255 * Math.min(1, fine[i]));
    data[i * 4 + 2] = Math.round(255 * (n1[i] * 0.55 + n2[i] * 0.3 + n3[i] * 0.15));
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export function createWaterFx({ scene, river, groundAt }) {
  const u = river.uniforms;
  // ripples on the water: shared with the water shaders
  const rips = u.uRip.value;
  let ripNext = 0;
  function ripple(x, z, strength = 1) { rips[ripNext].set(x, z, u.uTime.value, strength); ripNext = (ripNext + 1) % rips.length; }

  // sprites
  const pos = new Float32Array(MAX * 3), size = new Float32Array(MAX), alpha = new Float32Array(MAX), kind = new Float32Array(MAX);
  const P = [];                     // live particles
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1).setUsage(THREE.DynamicDrawUsage));
  const vp = new THREE.Vector4();
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uViewH: { value: 1000 }, uFoam: { value: null } }]),
    vertexShader: /* glsl */ `
      attribute float aSize, aAlpha, aKind;
      uniform float uViewH;
      varying float vAlpha, vKind, vSeed;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = max(1.5, aSize * projectionMatrix[1][1] * uViewH * 0.5 / max(0.1, -mvPosition.z));
        vAlpha = aAlpha; vKind = aKind; vSeed = fract(position.x * 3.17 + position.z * 1.91);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunCol, uAmb, uSunDir; uniform sampler2D uFoam;
      varying float vAlpha, vKind, vSeed;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r = length(c);
        if (r > 1.0) discard;
        vec3 light = uAmb * 1.1 + uSunCol * 0.65 * (0.55 + 0.45 * max(uSunDir.y, 0.0));
        float a;
        vec3 col;
        if (vKind < 0.5) {            // a droplet: a bright core with a soft rim, lit a little from the sun's side
          a = smoothstep(1.0, 0.35, r);
          col = light * (1.05 + 0.25 * dot(normalize(vec3(c, 0.6)), normalize(vec3(0.3, 0.6, 0.7))));
        } else {                      // mist: a soft puff, broken by the foam's noise
          float n = texture2D(uFoam, gl_PointCoord * 0.45 + vSeed).b;
          a = smoothstep(1.0, 0.0, r) * smoothstep(0.15, 0.75, n + 0.35 * (1.0 - r));
          col = light * 0.95;
        }
        gl_FragColor = vec4(col, a * vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  for (const k of ['uSunCol', 'uAmb', 'uSunDir']) material.uniforms[k] = u[k];
  material.uniforms.uFoam = u.uFoamTex;
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false; points.renderOrder = 3;
  points.onBeforeRender = (r) => { r.getCurrentViewport(vp); material.uniforms.uViewH.value = vp.w; };
  scene.add(points);

  const add = (p) => { if (P.length < MAX) P.push(p); };
  // droplets thrown from (x, y, z): n of them, sideways speed up to `spread`, upward speed about `up`
  function spray(x, y, z, n, spread, up, sz = 0.05, life = 0.8, dir = null) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = spread * Math.sqrt(Math.random());
      let vx = Math.cos(a) * s, vz = Math.sin(a) * s;
      if (dir) { vx += dir[0]; vz += dir[1]; }
      add({ k: 0, x, y, z, vx, vy: up * (0.5 + Math.random() * 0.7), vz, age: 0, life: life * (0.6 + Math.random() * 0.7), s0: sz * (0.5 + Math.random()), s1: 0, a: 0.95, floor: y - 0.4 });
    }
  }
  function mist(x, y, z, n, spread, sz = 0.8, life = 2.4, a = 0.16) {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * 6.283, s = spread * Math.random();
      add({ k: 1, x: x + Math.cos(ang) * s * 0.3, y, z: z + Math.sin(ang) * s * 0.3, vx: Math.cos(ang) * s, vy: 0.25 + Math.random() * 0.5, vz: Math.sin(ang) * s, age: 0, life: life * (0.7 + Math.random() * 0.6), s0: sz * (0.5 + Math.random() * 0.5), s1: sz * (1.6 + Math.random()), a });
    }
  }
  // a foot or a thing breaking the surface at (x, y, z) moving at speed sp (m/s)
  function splash(x, y, z, sp, vx = 0, vz = 0) {
    const k = Math.min(1.5, 0.3 + sp * 0.3);
    spray(x, y, z, Math.round(6 + 10 * k), 0.6 + 0.8 * k, 1.4 + 1.6 * k, 0.035, 0.6, [vx * 0.35, vz * 0.35]);
    if (sp > 2) mist(x, y + 0.1, z, 1, 0.3, 0.35, 0.9, 0.1);
    ripple(x, z, Math.min(1, 0.35 + 0.25 * sp));
  }
  function update(dt, wind = [0, 0]) {
    let n = 0;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.age += dt;
      if (p.age >= p.life) { P[i] = P[P.length - 1]; P.pop(); continue; }
      if (p.k === 0) {
        p.vy -= 9.81 * dt; p.vx *= Math.exp(-0.6 * dt); p.vz *= Math.exp(-0.6 * dt);
        if (p.y < p.floor && p.vy < 0) { p.age = p.life; continue; }
      } else {
        const drag = Math.exp(-0.8 * dt);
        p.vx = p.vx * drag + wind[0] * 0.3 * dt; p.vz = p.vz * drag + wind[1] * 0.3 * dt; p.vy *= drag;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    for (const p of P) {
      const t = p.age / p.life;
      pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
      if (p.k === 0) { size[n] = p.s0; alpha[n] = p.a * (1 - t * t); }
      else { size[n] = p.s0 + (p.s1 - p.s0) * Math.sqrt(t); alpha[n] = p.a * Math.min(1, t * 5) * (1 - t); }
      kind[n] = p.k;
      n++;
    }
    geo.setDrawRange(0, n);
    for (const k of ['position', 'aSize', 'aAlpha', 'aKind']) geo.attributes[k].needsUpdate = true;
  }
  void groundAt;
  return { spray, mist, splash, ripple, update, points };
}
