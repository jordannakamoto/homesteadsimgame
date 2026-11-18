// Waves round the player: a fine wave simulation in a small square of water that follows you (10 m across, 5 cm
// cells), for what the stream simulation's 25 cm cells are far too coarse to carry: the bow wave a leg pushes up,
// the trough behind it, the slosh of a step, waves running out, bouncing off the banks and crossing each other, all
// carried off downstream by the current. This is the standard interactive-water technique (a height field stepped by
// the wave equation, the way the well-known WebGL water demos and most games' local interaction water work).
//
// Each cell holds the surface's height and how fast it is moving. A step: the speed changes by the wave speed
// squared times the curvature of the surface (the wave equation), loses a little to damping, and the height moves
// by the speed; then everything is carried along by the current (looked up where it came from). Dry ground (from the
// stream simulation's depths) holds the water still, so waves reflect off the banks. Things in the water make waves:
// a leg pushes the water ahead of where it moves and leaves a hollow behind, and a step or a drop lands as a
// downward push.
//
// The water shader reads it as extra slope on the surface (river-shade.js), only inside this square.
import * as THREE from 'three';

const N = 200, CELL = 0.05, STEP = 1 / 120, MAX_STEPS = 3, C = 0.55;   // cells a side, m a cell, s a step, wave speed m/s

export function createRippleSim({ renderer, river, live }) {
  const gl = renderer.getContext();
  const ok = !!(renderer.capabilities.isWebGL2 && gl.getExtension('EXT_color_buffer_float')) && live.available;
  const u = river.uniforms;
  const mk = () => { const t = new THREE.WebGLRenderTarget(N, N, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }); t.texture.generateMipmaps = false; return t; };
  let rt = null;
  const quadCam = new THREE.Camera(), quadScene = new THREE.Scene(), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false; quadScene.add(quad);
  const lu = live.uniforms;
  const movers = Array.from({ length: 4 }, () => new THREE.Vector4()), moverV = Array.from({ length: 4 }, () => new THREE.Vector2());
  const drops = Array.from({ length: 6 }, () => new THREE.Vector4());
  let dropNext = 0;
  const org = new THREE.Vector2(), shift = new THREE.Vector2(), flow = new THREE.Vector2();
  const stepMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: {
      S: { value: null }, uLive: lu.uState, uLiveOrg: lu.uOrg, uLiveCell: lu.uCell, uLiveN: lu.uN, uLiveOn: { value: 0 },
      org: { value: org }, shift: { value: shift }, flow: { value: flow }, dt: { value: STEP },
      movers: { value: movers }, moverV: { value: moverV }, drops: { value: drops },
    },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      precision highp float; precision highp sampler2D;
      uniform sampler2D S, uLive; uniform vec2 uLiveOrg, org, flow; uniform ivec2 shift; uniform float uLiveCell, dt, uLiveOn; uniform int uLiveN;
      uniform vec4 movers[4]; uniform vec2 moverV[4]; uniform vec4 drops[6];
      const int N = ${N}; const float CELL = ${CELL.toFixed(3)}, C = ${C.toFixed(3)};
      vec2 at(ivec2 p) { p += shift; return (p.x < 0 || p.y < 0 || p.x >= N || p.y >= N) ? vec2(0.0) : texelFetch(S, p, 0).rg; }
      vec2 atF(vec2 p) {                                  // bilinear, in cells (for carrying it along the current)
        vec2 a = p - 0.5, f = fract(a); ivec2 i = ivec2(floor(a));
        return mix(mix(at(i), at(i + ivec2(1, 0)), f.x), mix(at(i + ivec2(0, 1)), at(i + ivec2(1, 1)), f.x), f.y);
      }
      float depthAt(vec2 w) {
        if (uLiveOn < 0.5) return 1.0;
        vec2 lc = (w - uLiveOrg) / uLiveCell;
        ivec2 i = clamp(ivec2(lc), ivec2(0), ivec2(uLiveN - 1));
        return texelFetch(uLive, i, 0).r;
      }
      void main() {
        ivec2 c = ivec2(gl_FragCoord.xy);
        vec2 w = org + (vec2(c) + 0.5) * CELL;
        // carried along by the current: what is here now came from upstream
        vec2 src = vec2(c) + 0.5 - flow * dt / CELL;
        vec2 s = atF(src);
        vec2 l = atF(src - vec2(1.0, 0.0)), r = atF(src + vec2(1.0, 0.0)), b = atF(src - vec2(0.0, 1.0)), t = atF(src + vec2(0.0, 1.0));
        float lap = (l.x + r.x + b.x + t.x - 4.0 * s.x) / (CELL * CELL);
        float h = s.x, v = s.y;
        v += C * C * lap * dt;
        v *= exp(-dt * 1.6);                              // waves die down over a second or two
        h += v * dt;
        h *= exp(-dt * 0.4);                              // and the surface settles back level
        // legs and things moving through the water: push it up ahead, leave a hollow behind, in proportion to how
        // fast they go through it; inside them, no water to wave
        for (int i = 0; i < 4; i++) {
          float rr = movers[i].z;
          if (rr <= 0.0) continue;
          vec2 d = w - movers[i].xy; float dist = length(d);
          if (dist < rr) { h = 0.0; v = 0.0; continue; }
          float k = exp(-(dist - rr) * (dist - rr) / 0.004) * movers[i].w;
          v += dot(moverV[i], d / max(dist, 1e-4)) * k * dt * 9.0;
        }
        // drops and steps: a sharp downward push
        for (int i = 0; i < 6; i++) {
          if (drops[i].w <= 0.0) continue;
          float k = exp(-dot(w - drops[i].xy, w - drops[i].xy) / (drops[i].z * drops[i].z));
          v -= drops[i].w * k;
        }
        // no water here: hold still (waves reflect off the banks); fade out toward the square's edges
        float dep = depthAt(w);
        float edge = float(min(min(c.x, c.y), min(N - 1 - c.x, N - 1 - c.y)));
        float keep = smoothstep(0.004, 0.02, dep) * smoothstep(0.0, 12.0, edge);
        gl_FragColor = vec4(clamp(h, -0.08, 0.08) * keep, clamp(v, -2.0, 2.0) * keep, 0.0, 1.0);
      }`,
  });
  quad.material = stepMat;
  let on = false, acc = 0, have = false;
  u.uRipTex.value = null;
  function update(dt, px, pz, current) {
    if (!ok || !on) { u.uRipWin.value.w = 0; return; }
    if (!rt) { rt = [mk(), mk()]; have = false; }
    // follow the player in whole cells
    const half = N * CELL / 2;
    const ox = Math.round((px - half) / CELL) * CELL, oz = Math.round((pz - half) / CELL) * CELL;
    if (!have) { org.set(ox, oz); }
    let si = Math.round((ox - org.x) / CELL), sj = Math.round((oz - org.y) / CELL);
    if (Math.abs(si) >= N || Math.abs(sj) >= N) { si = sj = 0; have = false; }
    org.set(ox, oz);
    flow.set(current[0], current[1]);
    stepMat.uniforms.uLiveOn.value = live.on ? 1 : 0;
    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    if (!have) {
      const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
      for (const t of rt) { renderer.setRenderTarget(t); renderer.setClearColor(0x000000, 0); renderer.clear(); }
      renderer.setClearColor(cc, ca);
      have = true;
    }
    acc = Math.min(acc + dt, STEP * MAX_STEPS);
    let first = true;
    while (acc >= STEP) {
      acc -= STEP;
      shift.set(first ? si : 0, first ? sj : 0);
      stepMat.uniforms.S.value = rt[0].texture;
      renderer.setRenderTarget(rt[1]); renderer.render(quadScene, quadCam);
      rt.reverse();
      if (first) { for (const d of drops) d.w = 0; first = false; }
    }
    if (!first) for (const m of movers) m.z = 0;
    renderer.setRenderTarget(prevRT); renderer.autoClear = prevAuto;
    u.uRipTex.value = rt[0].texture;
    u.uRipWin.value.set(org.x, org.y, N * CELL, 1);
  }
  return {
    available: ok, update,
    // for testing: the largest wave height in the square now (m), read back from the graphics card
    peak() {
      if (!rt) return 0;
      const buf = new Uint16Array(N * N * 4);
      renderer.readRenderTargetPixels(rt[0], 0, 0, N, N, buf);
      let m = 0;
      for (let i = 0; i < buf.length; i += 4) m = Math.max(m, Math.abs(THREE.DataUtils.fromHalfFloat(buf[i])));
      return m;
    },
    setOn(v) { on = v && ok; if (!on) u.uRipWin.value.w = 0; },
    // something moving through the water at (x, z), radius r, velocity (vx, vz), strength k (this frame)
    mover(slot, x, z, r, vx, vz, k = 1) { if (slot < 4) { movers[slot].set(x, z, r, k); moverV[slot].set(vx, vz); } },
    // a drop or a step landing at (x, z), radius r, strength k (a downward push, m/s)
    drop(x, z, r, k) { drops[dropNext].set(x, z, r, k); dropNext = (dropNext + 1) % drops.length; },
  };
}
