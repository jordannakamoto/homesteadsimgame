// Waterfalls: where a stream drops over a rock step (rivers-gen.js fallsIn), a curtain of falling water from the lip
// to the pool, spray thrown up where it lands, and the plunge pool stirred white (in the live water, a push at the
// foot of each fall near the player).
//
// The curtain is a sheet that follows the path water actually takes off a lip: it leaves at the speed it crossed
// the lip and falls under gravity (a parabola), narrowing a little as it accelerates and then spreading as it breaks
// up. Its look, from photographs and from how painters handle small falls:
//  - a smooth, glassy tongue at the lip, the colour of the water and the rock behind it showing through
//  - breaking up as it falls: streaks of white water racing down it, with gaps between them
//  - white and opaque at the foot, where it is mostly air
// Drawn opaque with an ordered dither instead of blending (no sorting against the water and the spray), on the
// water's own texel grid in the sheet's own coordinates, so it stays pixel-crisp like the rest.
import * as THREE from 'three';

const G = 9.81;

export function createFalls({ river, CS }) {
  const su = river.uniforms;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: null } }]);
  for (const k of ['uTime', 'uTex', 'uSunDir', 'uSunCol', 'uAmb', 'uTPM', 'uTurbid']) uniforms[k] = su[k];
  const material = new THREE.ShaderMaterial({
    uniforms, fog: true, side: THREE.DoubleSide,
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
      uniform float uTime, uTPM, uTurbid; uniform sampler2D uTex; uniform vec3 uSunDir, uSunCol, uAmb;
      varying vec3 vSheet; varying float vHalf; varying vec3 vWorld;
      #include <common>
      #include <fog_pars_fragment>
      const mat4 BAYER = mat4(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
      float bayer4(vec2 c) { ivec2 i = ivec2(mod(c, 4.0)); return (BAYER[i.y][i.x] + 0.5) / 16.0; }
      void main() {
        vec2 cell = floor(vSheet.xy * uTPM), q = (cell + 0.5) / uTPM;
        float fall = vSheet.z;
        // streaks racing down: noise stretched along the fall, moving at the speed the water has reached
        float speed = 2.0 + 6.0 * fall;
        float s1 = texture2D(uTex, vec2(q.x * 0.55, q.y * 0.07 - uTime * speed * 0.07)).b;
        float s2 = texture2D(uTex, vec2(q.x * 1.3 + 0.37, q.y * 0.11 - uTime * speed * 0.11)).b;
        float white = clamp(smoothstep(0.42, 0.7, s1 * 0.6 + s2 * 0.55) * smoothstep(0.0, 0.35, fall) + smoothstep(0.6, 1.0, fall), 0.0, 1.0);
        // how solid the sheet is: whole at the lip, breaking into strands lower down; ragged at the sides
        float edge = smoothstep(0.0, 0.25 + 0.3 * fall, vHalf - abs(q.x) + (texture2D(uTex, vec2(q.y * 0.2 - uTime * 0.5, q.x * 0.3)).b - 0.5) * 0.4);
        float body = mix(0.95, 0.35 + 0.65 * smoothstep(0.35, 0.65, s1), smoothstep(0.1, 0.55, fall)) + white * 0.5;
        if (bayer4(cell) >= clamp(body, 0.0, 1.0) * edge) discard;
        vec3 lightIn = uAmb + uSunCol * 0.6 * (0.6 + 0.4 * max(uSunDir.y, 0.0));
        vec3 glassy = mix(vec3(0.07, 0.09, 0.06), vec3(0.11, 0.09, 0.06), clamp(uTurbid * 0.35, 0.0, 1.0)) * lightIn * 1.6;
        vec3 foam = lightIn * vec3(0.9, 0.94, 0.94);
        vec3 c = mix(glassy, foam, clamp(white + 0.25 * fall, 0.0, 1.0));
        c *= 0.85 + 0.3 * step(0.6, s2);                      // a little light and shade in the strands
        gl_FragColor = vec4(c, 1.0);
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
      if (h < 0.3) continue;
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
  // spray where falls near the player land, and the pool stirred in the live water
  let sprayT = 0;
  function update(dt, px, pz, { burst, live, wet }) {
    sprayT -= dt;
    const emit = sprayT <= 0;
    if (emit) sprayT = 0.09;
    let slot = 1;
    for (const ch of withFalls) for (const f of ch.falls) {
      const h = f.top - f.bottom, d = Math.hypot(f.x - px, f.z - pz);
      if (d > 60) continue;
      const v0 = 0.8 + 1.2 * Math.min(1, f.D * 2.5), T = Math.sqrt((2 * h) / G), reach = 0.05 + v0 * T;
      const bx = f.x + f.dx * reach, bz = f.z + f.dz * reach;
      if (emit && d < 45) {
        const n = Math.max(1, Math.round((1 + h) * wet));
        burst(bx, f.bottom + 0.05, bz, n, 0xeef3f1, 0.6 + 0.25 * f.w, 2.2 + 0.9 * h, 0.06, 0.55);
        if (Math.random() < 0.35) burst(bx, f.bottom + 0.3, bz, 1, 0xdfe7e8, 0.35 + 0.2 * f.w, 1.1, 0.09, 0.9);
      }
      // the falling water drives the pool: pushes it downstream and churns it white
      if (live && slot < 3) live.push(slot++, bx, bz, Math.min(1.6, f.w * 0.45), f.dx * (1.2 + h * 0.6), f.dz * (1.2 + h * 0.6), 0.6);
    }
  }
  return { material, refresh, dispose, update };
}
