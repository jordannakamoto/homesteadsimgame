// Waterfalls: where a stream drops over a rock step (rivers-gen.js fallsIn), a curtain of falling water from the lip
// to the pool, spray and mist where it lands (water-fx.js), rings spreading on the pool, and the pool churned white
// (in the live water, a push at the foot of each fall near the player).
//
// The curtain follows the path water takes off a lip: it leaves at the speed it crossed the lip and falls under
// gravity (a parabola), narrowing a little as it speeds up, then spreading as it breaks up. Shaded the way game VFX
// artists build real-time falls (panning noise layers on a mesh, eroded by a rising threshold, with soft particles
// over it), against how small falls look in photographs:
//  - a smooth, glassy tongue at the lip: dark water with the sky and banks in it, the rock showing through
//  - breaking up as it falls: white strands racing down, pulled apart by a slower distortion layer so they waver,
//    the sheet eroding into strands and gaps (the erosion threshold rises with the fall)
//  - white and soft at the foot, where it is mostly air, hidden in mist and spray
// Blended, soft at its sides, lit by the sun and the sky.
import * as THREE from 'three';

const G = 9.81, TALL = 1.6;                 // drops below this (m) are chutes: no curtain, no mist

export function createFalls({ river, CS }) {
  const su = river.uniforms;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: null } }]);
  for (const k of ['uTime', 'uTex', 'uSunDir', 'uSunCol', 'uAmb', 'uSky', 'uZenith', 'uTurbid', 'uFoamTex']) uniforms[k] = su[k];
  const material = new THREE.ShaderMaterial({
    uniforms, fog: true, side: THREE.DoubleSide, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec3 aSheet;              // across (m from the middle), down the sheet (m from the lip), how far down (0-1)
      attribute float aHalf;              // half the sheet's width here (m)
      varying vec3 vSheet; varying float vHalf; varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vSheet = aSheet; vHalf = aHalf;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uTurbid; uniform sampler2D uTex, uFoamTex; uniform vec3 uSunDir, uSunCol, uAmb, uSky, uZenith;
      varying vec3 vSheet; varying float vHalf; varying vec3 vWorld;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec2 uv = vSheet.xy; float fall = vSheet.z;
        float speed = 1.6 + 5.5 * sqrt(fall);
        // a slow distortion layer, so the strands waver
        vec2 wob = (texture2D(uTex, vec2(uv.x * 0.35, uv.y * 0.06 - uTime * 0.35)).rg - 0.5) * vec2(0.35, 0.6);
        // strands: the foam lace stretched far down the fall and panned at the water's speed, two scales
        float s1 = texture2D(uFoamTex, vec2(uv.x * 0.9 + wob.x, (uv.y + wob.y) * 0.09 - uTime * speed * 0.09)).r;
        float s2 = texture2D(uFoamTex, vec2(uv.x * 2.1 + 0.31 + wob.x * 1.5, uv.y * 0.18 - uTime * speed * 0.2)).g;
        float n = texture2D(uFoamTex, vec2(uv.x * 0.45 + wob.x * 0.5, uv.y * 0.05 - uTime * speed * 0.05)).b;
        float strands = clamp(s1 * 0.75 + s2 * 0.6, 0.0, 1.0);
        // the sheet erodes as it falls: a threshold that rises with the fall cuts it into strands and gaps
        float erode = 0.55 * smoothstep(0.08, 0.9, fall);
        float body = smoothstep(erode, erode + 0.3, n * 0.7 + strands * 0.45);
        float white = clamp(smoothstep(0.25, 0.85, strands) * smoothstep(0.0, 0.3, fall) + smoothstep(0.55, 1.0, fall) * (0.5 + 0.5 * n), 0.0, 1.0);
        // soft, ragged sides
        float side = vHalf - abs(uv.x) + (texture2D(uTex, vec2(uv.y * 0.15 - uTime * 0.6, uv.x * 0.2)).b - 0.5) * (0.25 + 0.4 * fall);
        float edge = smoothstep(0.0, 0.18 + 0.35 * fall, side);
        // light: glassy water at the top (dark, with the sky in it), lit foam lower down
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 lightIn = uAmb + uSunCol * 0.6 * (0.6 + 0.4 * max(uSunDir.y, 0.0));
        vec3 glass = mix(vec3(0.05, 0.07, 0.045), vec3(0.1, 0.085, 0.055), clamp(uTurbid * 0.35, 0.0, 1.0)) * lightIn * 1.4;
        glass = mix(glass, mix(uSky, uZenith, 0.4) * 0.55, 0.25 + 0.35 * (1.0 - abs(V.y)));
        vec3 foam = lightIn * (0.82 + 0.28 * s2) * vec3(0.93, 0.96, 0.96);
        vec3 c = mix(glass, foam, white);
        float a = edge * mix(mix(0.82, 0.55, smoothstep(0.0, 0.5, fall)) * body, 0.95, white * body);
        a *= 1.0 - smoothstep(0.9, 1.0, fall) * 0.6;            // melts into the pool and the mist
        if (a < 0.01) discard;
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });

  // one mesh per chunk holding all its falls' curtains
  function build(falls) {
    const pos = [], sheet = [], half = [], idx = [];
    for (const f of falls) {
      const h = f.top - f.bottom;
      // a short drop is a chute the water runs down (the stream's own surface draws it); only a real fall, where
      // the water leaves the rock and drops free, gets a curtain
      if (h < TALL) continue;
      const v0 = 0.8 + 1.2 * Math.min(1, f.D * 2.5);          // the speed it crosses the lip at (m/s)
      const T = Math.sqrt((2 * h) / G), rows = Math.max(6, Math.ceil(h * 5)), w0 = f.w * 0.42;
      const across = Math.max(3, Math.ceil((w0 * 2) / 0.35));
      const lx = -f.dz, lz = f.dx, base = pos.length / 3;
      let down = 0, px = 0, py = 0;
      for (let r = 0; r <= rows; r++) {
        const k = r / rows, t = T * k;
        const x = 0.05 + v0 * t, y = -0.5 * G * t * t;
        if (r) down += Math.hypot(x - px, y - py);
        px = x; py = y;
        const hw = w0 * (1 - 0.12 * Math.sin(Math.min(1, k * 2) * Math.PI / 2) + 0.35 * k * k);
        for (let a = 0; a <= across; a++) {
          const u = (a / across * 2 - 1) * hw;
          pos.push(f.x + f.dx * x + lx * u, f.top + y, f.z + f.dz * x + lz * u);
          sheet.push(u, down, k); half.push(hw);
        }
      }
      for (let r = 0; r < rows; r++) for (let a = 0; a < across; a++) {
        const i0 = base + r * (across + 1) + a, i1 = i0 + across + 1;
        idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
      }
    }
    if (!idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('aSheet', new THREE.BufferAttribute(new Float32Array(sheet), 3));
    geo.setAttribute('aHalf', new THREE.BufferAttribute(new Float32Array(half), 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, material);
    m.renderOrder = 1;
    return m;
  }
  const withFalls = new Set();
  function refresh(ch, R) {
    dispose(ch);
    const falls = R ? R.fallsIn(ch.ox, ch.oz, ch.ox + CS, ch.oz + CS) : [];
    if (!falls.length) return;
    ch.falls = falls;
    withFalls.add(ch);
    const m = build(falls);
    if (m) { ch.fallMesh = m; ch.group.add(m); }
  }
  function dispose(ch) {
    if (ch.fallMesh) { ch.group.remove(ch.fallMesh); ch.fallMesh.geometry.dispose(); ch.fallMesh = null; }
    ch.falls = null; withFalls.delete(ch);
  }
  // spray, mist and rings where falls near the player land, and the pool stirred in the live water
  let sprayT = 0, mistT = 0;
  function update(dt, px, pz, { fx, live, wet }) {
    sprayT -= dt; mistT -= dt;
    const emit = sprayT <= 0, emitMist = mistT <= 0;
    if (emit) sprayT = 0.05;
    if (emitMist) mistT = 0.18;
    let slot = 1;
    for (const ch of withFalls) for (const f of ch.falls) {
      const h = f.top - f.bottom, d = Math.hypot(f.x - px, f.z - pz);
      if (d > 70) continue;
      const v0 = 0.8 + 1.2 * Math.min(1, f.D * 2.5), T = Math.sqrt((2 * h) / G), reach = 0.05 + v0 * T;
      const bx = f.x + f.dx * reach, bz = f.z + f.dz * reach, hw = f.w * 0.42;
      if (d < 55) {
        const lx = -f.dz, lz = f.dx;
        if (emit) {
          // droplets thrown up and out where the sheet hits, along its whole width
          const n = h >= TALL ? Math.max(1, Math.round((1.5 + h) * wet)) : (Math.random() < 0.4 * wet ? 1 : 0);   // a chute throws only the odd drop
          for (let i = 0; i < n; i++) {
            const u = (Math.random() * 2 - 1) * hw;
            fx.spray(bx + lx * u, f.bottom + 0.02, bz + lz * u, 2, 0.5 + 0.25 * h, 1.6 + 0.8 * h, 0.014, 0.9, [f.dx * 0.6, f.dz * 0.6]);
          }
        }
        if (emitMist && h >= TALL) {
          const u = (Math.random() * 2 - 1) * hw;
          fx.mist(bx + lx * u, f.bottom + 0.15, bz + lz * u, 1, 0.4 + 0.15 * h, 0.5 + 0.3 * h, 2.2 + h * 0.6, 0.1 + 0.04 * Math.min(2, h));
          fx.ripple(bx + lx * u * 0.5 + f.dx * (0.3 + Math.random()), bz + lz * u * 0.5 + f.dz * (0.3 + Math.random()), 0.6);
        }
      }
      // the falling water drives the pool: pushes it downstream and churns it white
      if (live && slot < 3) live.push(slot++, bx, bz, Math.min(1.6, f.w * 0.45), f.dx * (1.2 + h * 0.6), f.dz * (1.2 + h * 0.6), 0.6);
    }
  }
  return { material, refresh, dispose, update };
}
