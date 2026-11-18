// Streams and rivers, live tier: a shallow-water simulation on the GPU in a window that follows the player, drawn
// over the baked water (which still draws beyond it, and hands over to it in a dithered band at the window's edge).
//
// The model is the "virtual pipes" one (O'Brien & Hodgins 1995; Mei, Decaudin & Hu 2007), as used for the streams
// in Crimson Desert and most real-time height-field water: every cell is a column of water joined to its four
// neighbours by pipes. Each step
//   1. flux: the flow in each pipe gains g * (head difference) * dt, keeps most of what it had (momentum), loses
//      some to bed friction (more in shallow, fast water: a Manning-like term), and is scaled down so a cell never
//      sends out more water than it holds;
//   2. depth and velocity: depth changes by what flows in less what flows out; velocity is the mean flow through
//      the cell over its depth. White water (foam) is carried along that velocity, made where the flow goes
//      supercritical (Froude number near 1 and above: riffles, falls, chutes) and where something stirs the water,
//      and fades away in pools.
// The window is SIZE cells of CELL m (0.25 m: four water cells to a metre, finer than the 1 m terrain grid, so
// shorelines and eddies show at the water's own pixel size). The water starts from, and is fed at the window's
// edges by, the baked steady state of the channels (rivers-render.js), raised and lowered with the stream flow of
// the day; so the water in the window flows in from upstream and out downstream, and digging, damming or pouring
// water inside it changes where it goes.
//
// Textures (float, so it needs EXT_color_buffer_float; otherwise the live tier is unavailable and the baked water
// shows everywhere): bed (ground heights), feed (the baked state, as surface on an ordinary day, bed lip and
// velocity), state ping-pong (depth, velocity x, z, foam) and flux ping-pong (pipes left, right, back, front).
// When the player walks off centre the window moves in whole steps: the bed and feed are shifted on the CPU and only
// the new strip sampled, and the water already simulated moves with them.
//
// Gameplay reads the water back asynchronously around the player (waterAt), a few frames late.
import * as THREE from 'three';
import { RIVER_SHADE } from './river-shade.js';

const CELL = 0.25, STEP_DT = 1 / 120, MAX_STEPS = 3, SHIFT_M = 2, G = 9.81;   // the window follows in 2 m steps, so its edge creeps rather than jumps
const NOFEED = -1e4;

export function createRiverLive({ renderer, river, scene, CS, heightAt, chunkAt }) {
  const gl = renderer.getContext();
  // a software renderer (SwiftShader, llvmpipe: headless tests, machines with no usable GPU) runs the simulation on
  // the CPU at a few frames a second, so the live tier is off there unless localStorage 'riverLive' = 'force'
  let soft = false;
  try { const di = gl.getExtension('WEBGL_debug_renderer_info'); soft = /swiftshader|llvmpipe|software/i.test(di ? gl.getParameter(di.UNMASKED_RENDERER_WEBGL) : ''); } catch (e) { /* unknown: assume a GPU */ }
  try { if (localStorage.getItem('riverLive') === 'force') soft = false; } catch (e) { /* no storage */ }
  const ok = !!(renderer.capabilities.isWebGL2 && gl.getExtension('EXT_color_buffer_float')) && !soft;
  let SIZE = 256, M = 0;                          // cells a side; render mesh vertices a side
  let on = false, mesh = null, built = false;
  const win = { ox: 0, oz: 0 };                  // world position of cell (0, 0)'s corner
  let bedA = null, feedA = null, bedTex = null, feedTex = null, st = null, fx = null;
  const pushers = Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, 0)), pushV = Array.from({ length: 4 }, () => new THREE.Vector2());
  const pours = Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, 0));
  const obstU = { value: [new THREE.Vector4(), new THREE.Vector4()] }, orgU = { value: new THREE.Vector2() }, froths = [new THREE.Vector4(), new THREE.Vector4()];
  const shared = river.uniforms;

  // ---- simulation passes
  const quadCam = new THREE.Camera(), quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false; quadScene.add(quad);
  const vs = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const common = /* glsl */ `
    precision highp float; precision highp sampler2D;
    uniform sampler2D S, F, B, T; uniform int n; uniform float dt, l, wetD, wetV; uniform vec2 orgC; uniform vec4 obst[2];
    ivec2 cl(ivec2 p) { return clamp(p, ivec2(0), ivec2(n - 1)); }
    bool inside(ivec2 p) { return p.x >= 0 && p.y >= 0 && p.x < n && p.y < n; }
    // the ground, and whatever stands in the water (legs wading): the water has to go round it, piling up a little in
    // front and leaving a hollow and a wake behind, as it does round a real leg
    float bed(ivec2 p) {
      p = cl(p);
      float b = texelFetch(B, p, 0).r;
      vec2 w = orgC + (vec2(p) + 0.5) * l;
      for (int i = 0; i < 2; i++) if (obst[i].z > 0.0 && distance(w, obst[i].xy) < obst[i].z) b = max(b, obst[i].w);
      return b;
    }
    // the baked water here today: depth over the bed, velocity
    vec3 feed(ivec2 p) {
      vec4 t = texelFetch(T, cl(p), 0);
      if (t.r < -1000.0) return vec3(0.0);
      float s = t.g + (t.r - t.g) * wetD;
      return vec3(max(0.0, s - bed(p)), t.ba * wetV);
    }`;
  const mat = (frag, extra = {}) => new THREE.ShaderMaterial({
    vertexShader: vs, fragmentShader: common + frag, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { S: { value: null }, F: { value: null }, B: { value: null }, T: { value: null }, n: { value: SIZE }, dt: { value: STEP_DT }, l: { value: CELL }, wetD: shared.uWetDepth, wetV: shared.uWetSpeed, orgC: orgU, obst: obstU, ...extra },
  });
  // 1. flux through the four pipes (x: to -x, y: to +x, z: to -z, w: to +z)
  const fluxMat = mat(/* glsl */ `
    void main() {
      ivec2 c = ivec2(gl_FragCoord.xy);
      vec4 s = texelFetch(S, c, 0), f = texelFetch(F, c, 0);
      float h = bed(c) + s.r;
      #define HN(dd) (inside(c + dd) ? bed(c + dd) + texelFetch(S, c + dd, 0).r : h)
      vec4 dh = h - vec4(HN(ivec2(-1, 0)), HN(ivec2(1, 0)), HN(ivec2(0, -1)), HN(ivec2(0, 1)));
      float sp = length(s.gb), d = max(s.r, 0.004);
      float keep = 1.0 / (1.0 + dt * (0.12 + 0.03 * 9.81 * sp / pow(d, 1.333)));  // bed friction, Manning-like
      f = max(vec4(0.0), f * keep + dt * 9.81 * l * dh);
      // the channel's own current: the terrain carries a stream's fall in steps, so flat pools between them would sit
      // still; the baked flow (what the whole channel's slope drives) tops each pipe's flow up toward it, downhill or
      // level only, never pushing water up onto anything higher (a dam still holds)
      vec3 cur = feed(c);
      if (s.r > 0.01 && cur.x > 0.0) {
        vec4 tgt = max(vec4(0.0), vec4(-cur.y, cur.y, -cur.z, cur.z)) * l * s.r;
        vec4 down = step(-0.005, dh);
        f = max(f, mix(f, tgt, min(1.0, dt * 1.5)) * down);
      }
      float out_ = (f.x + f.y + f.z + f.w) * dt;
      f *= out_ > 0.0 ? min(1.0, s.r * l * l / out_) : 0.0;
      gl_FragColor = f;
    }`);
  // 2. depth, velocity, foam
  const stateMat = mat(/* glsl */ `
    uniform vec4 push[4]; uniform vec2 pushV[4]; uniform vec4 pour[4]; uniform vec4 froth[2]; uniform vec2 org; uniform float soak, evap;
    vec4 flux(ivec2 p) { return inside(p) ? texelFetch(F, p, 0) : vec4(0.0); }
    float foamAt(vec2 p) {                                    // bilinear, in cells
      vec2 a = p - 0.5, f = fract(a); ivec2 i = ivec2(floor(a));
      float f00 = texelFetch(S, cl(i), 0).a, f10 = texelFetch(S, cl(i + ivec2(1, 0)), 0).a, f01 = texelFetch(S, cl(i + ivec2(0, 1)), 0).a, f11 = texelFetch(S, cl(i + ivec2(1, 1)), 0).a;
      return mix(mix(f00, f10, f.x), mix(f01, f11, f.x), f.y);
    }
    void main() {
      ivec2 c = ivec2(gl_FragCoord.xy);
      vec4 s = texelFetch(S, c, 0), f = flux(c);
      vec4 L = flux(c + ivec2(-1, 0)), R = flux(c + ivec2(1, 0)), K = flux(c + ivec2(0, -1)), Fw = flux(c + ivec2(0, 1));
      float fin = L.y + R.x + K.w + Fw.z, fout = f.x + f.y + f.z + f.w;
      float d = max(0.0, s.r + dt * (fin - fout) / (l * l));
      float dav = max(0.5 * (s.r + d), 0.01);
      vec2 v = vec2(L.y - f.x + f.y - R.x, K.w - f.z + f.w - Fw.z) * 0.5 / (l * dav);
      if (d < 0.003) v = vec2(0.0);
      float vl = length(v); if (vl > 3.0) v *= 3.0 / vl;
      // white water: carried along the flow, made where it runs supercritical, fading in calm water
      float foam = foamAt(vec2(c) + 0.5 - v * dt / l) * exp(-dt * 0.8);
      float fr = length(v) / sqrt(9.81 * max(d, 0.01));
      foam += dt * 2.0 * smoothstep(0.85, 1.6, fr) * smoothstep(0.015, 0.05, d);
      vec2 w = org + (vec2(c) + 0.5) * l;
      for (int i = 0; i < 4; i++) {
        // something wading or dropped in: drags the water with it and stirs it white
        float r = push[i].z;
        if (r > 0.0 && d > 0.005) {
          float k = 1.0 - smoothstep(0.0, r, distance(w, push[i].xy));
          v = mix(v, pushV[i], k * min(1.0, dt * 30.0 * push[i].w));
          foam += k * dt * 3.0 * push[i].w * min(1.0, length(pushV[i]));
        }
        // water poured in (m3/s over a disc)
        float pr = pour[i].z;
        if (pr > 0.0) { float k = 1.0 - smoothstep(0.0, pr, distance(w, pour[i].xy)); d += dt * pour[i].w * k / (3.0 * pr * pr); foam += k * dt * 1.5 * step(0.0, pour[i].w); }
      }
      d = max(d, 0.0);
      for (int i = 0; i < 2; i++) if (froth[i].z > 0.0 && d > 0.01) foam += dt * froth[i].w * 4.0 * (1.0 - smoothstep(0.0, froth[i].z, distance(w, froth[i].xy)));
      // seepage: the banks and the ground water keep a channel topped up toward its level for the day (so a brook
      // whose spring or tributaries lie inside the window keeps running); it only ever adds, so a dam still fills
      // and a channel cut off upstream runs low and slowly recovers
      vec3 fd0 = feed(c);
      d += max(0.0, fd0.x - d) * min(1.0, dt * 0.04);
      // and it goes away again: water standing where no channel runs on a normal day (a flood, a spill, a bucket
      // tipped out) soaks into the ground; everything evaporates a little. Rates in game time (set by the engine)
      d = max(0.0, d - dt * (evap + (fd0.x < 0.005 ? soak : 0.0)));
      // the edges of the window: held to the baked water, so the stream flows in upstream and out downstream
      int e = min(min(c.x, c.y), min(n - 1 - c.x, n - 1 - c.y));
      if (e < 4) { vec3 fd = feed(c); float k = e < 2 ? 0.5 : 0.15; d = mix(d, fd.x, k); v = mix(v, fd.yz, k); }
      gl_FragColor = vec4(d, v, clamp(foam, 0.0, 1.0));
    }`, { push: { value: pushers }, pushV: { value: pushV }, pour: { value: pours }, froth: { value: froths }, org: { value: new THREE.Vector2() }, soak: { value: 0 }, evap: { value: 0 } });
  // the water the window starts with, or carries over when it moves: the old state shifted, else the baked water
  const initMat = mat(/* glsl */ `
    uniform ivec2 shift; uniform int keep, flux;
    void main() {
      ivec2 c = ivec2(gl_FragCoord.xy), p = c + shift;
      if (keep == 1 && inside(p)) { gl_FragColor = texelFetch(S, p, 0); return; }
      if (flux == 1) { gl_FragColor = vec4(0.0); return; }
      vec3 fd = feed(c);
      gl_FragColor = vec4(fd.x, fd.yz, 0.0);
    }`, { shift: { value: new THREE.Vector2() }, keep: { value: 0 }, flux: { value: 0 } });
  const fluxInit = mat('void main() { gl_FragColor = vec4(0.0); }');

  function rt() {
    const t = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
    t.texture.generateMipmaps = false;
    return t;
  }
  function pass(m, target) { quad.material = m; renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); }

  // ---- bed and feed, sampled on the CPU
  function sampleCell(i, j) {
    const x = win.ox + (i + 0.5) * CELL, z = win.oz + (j + 0.5) * CELL, k = j * SIZE + i;
    const ch = chunkAt(x, z), D = ch && ch.riverData;
    let b0 = heightAt(x, z);
    // rocks in the stream stand up out of the bed, so the water piles against them and runs round
    if (ch && ch.riverRocks) for (const r of ch.riverRocks) {
      const dd = Math.hypot(x - r.x, z - r.z) / (r.r * 0.9);
      if (dd < 1) b0 = Math.max(b0, r.y + r.hy * Math.sqrt(1 - dd * dd));
    }
    bedA[k] = b0;
    if (!D) { feedA[k * 4] = NOFEED; return; }
    const lx = x - D.ox, lz = z - D.oz, N = CS + 1;
    const i0 = Math.min(CS - 1, Math.floor(lx)), j0 = Math.min(CS - 1, Math.floor(lz)), fx = lx - i0, fz = lz - j0;
    const ks = [j0 * N + i0, j0 * N + i0 + 1, (j0 + 1) * N + i0, (j0 + 1) * N + i0 + 1], ws = [(1 - fx) * (1 - fz), fx * (1 - fz), (1 - fx) * fz, fx * fz];
    let sw = 0, s = 0, b = 0, vx = 0, vz = 0;
    for (let q = 0; q < 4; q++) {
      const kk = ks[q];
      if (isNaN(D.surf[kk])) continue;
      const w = ws[q] + 1e-4;
      sw += w; s += D.surf[kk] * w; b += D.bed[kk] * w; vx += D.vel[kk * 2] * w; vz += D.vel[kk * 2 + 1] * w;
    }
    if (sw <= 0) { feedA[k * 4] = NOFEED; return; }
    feedA[k * 4] = s / sw; feedA[k * 4 + 1] = b / sw; feedA[k * 4 + 2] = vx / sw; feedA[k * 4 + 3] = vz / sw;
  }
  function sampleRect(i0, j0, i1, j1) {
    for (let j = Math.max(0, j0); j < Math.min(SIZE, j1); j++) for (let i = Math.max(0, i0); i < Math.min(SIZE, i1); i++) sampleCell(i, j);
    bedTex.needsUpdate = true; feedTex.needsUpdate = true;
  }

  function allocate() {
    free();
    bedA = new Float32Array(SIZE * SIZE); feedA = new Float32Array(SIZE * SIZE * 4);
    bedTex = new THREE.DataTexture(bedA, SIZE, SIZE, THREE.RedFormat, THREE.FloatType);
    feedTex = new THREE.DataTexture(feedA, SIZE, SIZE, THREE.RGBAFormat, THREE.FloatType);
    for (const t of [bedTex, feedTex]) { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; }
    st = [rt(), rt()]; fx = [rt(), rt()];
    for (const m of [fluxMat, stateMat, initMat, fluxInit]) { m.uniforms.n.value = SIZE; m.uniforms.B.value = bedTex; m.uniforms.T.value = feedTex; }
    drawU.uFeed.value = feedTex;
    buildMesh();
    built = false;
  }
  function free() {
    for (const t of [...(st || []), ...(fx || [])]) t.dispose();
    if (bedTex) bedTex.dispose(); if (feedTex) feedTex.dispose();
    st = fx = null; bedTex = feedTex = null;
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh = null; }
  }

  // ---- the surface: a grid denser near the middle of the window (one vertex a cell there, one every four at the
  // edges for the wide window), its heights read from the simulation in the vertex shader
  const drawU = {
    uState: { value: null }, uBed: { value: null }, uFeed: { value: null }, uBedWin: { value: new THREE.Vector4(1, 1, 0, 0) }, uN: { value: SIZE }, uOrg: { value: new THREE.Vector2() }, uCell: { value: CELL }, uWarp: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    fog: true, transparent: true, depthWrite: false,
    uniforms: { ...shared, ...drawU },
    vertexShader: /* glsl */ `
      precision highp sampler2D;
      uniform sampler2D uState, uBed; uniform int uN; uniform vec2 uOrg; uniform float uCell, uWarp;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      vec2 at(ivec2 p) { p = clamp(p, ivec2(0), ivec2(uN - 1)); return vec2(texelFetch(uBed, p, 0).r, texelFetch(uState, p, 0).r); }
      void main() {
        vec2 u = position.xz * 2.0 - 1.0;                       // -1..1 across the window
        u = uWarp * u + (1.0 - uWarp) * u * u * u;              // denser in the middle
        vec2 cpos = (u * 0.5 + 0.5) * float(uN);
        ivec2 c = ivec2(floor(cpos));
        vec2 bd = at(c);
        float y;
        if (bd.y > 0.002) y = bd.x + bd.y;
        else {
          // dry: carry the neighbouring water's surface level out flat, so the terrain cuts the shoreline;
          // with no water near, sink below the ground
          y = -1e4;
          for (int dz = -1; dz <= 1; dz++) for (int dx = -1; dx <= 1; dx++) { vec2 q = at(c + ivec2(dx, dz)); if (q.y > 0.002) y = max(y, q.x + q.y); }
          if (y < -1000.0) y = bd.x - 0.3;
        }
        vec4 wp = vec4(uOrg.x + cpos.x * uCell, y, uOrg.y + cpos.y * uCell, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      precision highp sampler2D;
      uniform sampler2D uState, uBed, uFeed; uniform int uN; uniform vec2 uOrg; uniform float uCell; uniform float uWetSpeed;
      varying vec3 vWorld;
      #include <common>
      #include <fog_pars_fragment>
      ${RIVER_SHADE}
      vec4 st(vec2 p, out float b) {                            // bilinear state and bed at a world point
        vec2 a = (p - uOrg) / uCell - 0.5, f = fract(a); ivec2 i = ivec2(floor(a)), n = ivec2(uN - 1);
        ivec2 i00 = clamp(i, ivec2(0), n), i10 = clamp(i + ivec2(1, 0), ivec2(0), n), i01 = clamp(i + ivec2(0, 1), ivec2(0), n), i11 = clamp(i + ivec2(1, 1), ivec2(0), n);
        b = mix(mix(texelFetch(uBed, i00, 0).r, texelFetch(uBed, i10, 0).r, f.x), mix(texelFetch(uBed, i01, 0).r, texelFetch(uBed, i11, 0).r, f.x), f.y);
        return mix(mix(texelFetch(uState, i00, 0), texelFetch(uState, i10, 0), f.x), mix(texelFetch(uState, i01, 0), texelFetch(uState, i11, 0), f.x), f.y);
      }
      void main() {
        vec2 p = vWorld.xz, cell = waterCell(p), q = waterTexel(p);
        if (bayer4(cell) >= liveShare(q)) discard;              // the baked water draws here
        float b; vec4 s = st(q, b);
        if (s.r < 0.004) discard;                               // the shoreline, at the water's own texel
        float d = max(s.r, vWorld.y - b);
        // The surface is drawn moving with the channel's settled current (the baked flow: smooth, as in the baked
        // water), with only a little of the simulation's own eddying in it: the simulation's velocity, cell by cell,
        // is too restless to draw the surface by and shows as swirling lines. Where there is no channel (water let
        // into a trench, a flooded bed) the simulation's is all there is.
        vec4 fdT = texelFetch(uFeed, clamp(ivec2((q - uOrg) / uCell), ivec2(0), ivec2(uN - 1)), 0);
        vec2 vel = fdT.r > -1000.0 ? mix(fdT.ba * uWetSpeed, s.gb, 0.2) : s.gb;
        // how close dry land is: depths a little way off in eight directions
        for (int k = 0; k < 8; k++) {
          float an = float(k) * 0.785, rr = 0.5 + 0.45 * float(k / 4);
          vec2 o = vec2(cos(an), sin(an)) * rr;
          ivec2 ci = clamp(ivec2((q + o - uOrg) / uCell), ivec2(0), ivec2(uN - 1));
          bankNear = max(bankNear, (1.0 - smoothstep(0.004, 0.03, texelFetch(uState, ci, 0).r)) * (1.0 - rr / 1.6));
        }
                vec4 c = shadeRiver(q, cell, vWorld, vel, d, s.a);
        gl_FragColor = c;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  function buildMesh() {
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
    // the wide window keeps the vertex count of the normal one, spread thinner toward the edges
    M = 257;
    const warp = SIZE > 256 ? 0.5 : 1;
    drawU.uWarp.value = warp;
    const pos = new Float32Array(M * M * 3), idx = [];
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { const k = (j * M + i) * 3; pos[k] = i / (M - 1); pos[k + 2] = j / (M - 1); }
    for (let j = 0; j < M - 1; j++) for (let i = 0; i < M - 1; i++) { const a = j * M + i; idx.push(a, a + M, a + 1, a + 1, a + M, a + M + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false; mesh.renderOrder = 1; mesh.visible = false;
    scene.add(mesh);
  }

  // ---- running it
  let wantSize = 256, readBusy = false, readT = 0;
  const read = { ox: 0, oz: 0, n: 0, ok: false, buf: null, tmp: null };
  function center(px, pz) {
    const half = SIZE * CELL / 2;
    return [Math.round((px - half) / SHIFT_M) * SHIFT_M, Math.round((pz - half) / SHIFT_M) * SHIFT_M];
  }
  function start(px, pz) {
    [win.ox, win.oz] = center(px, pz);
    sampleRect(0, 0, SIZE, SIZE);
    initMat.uniforms.keep.value = 0;
    pass(initMat, st[0]);
    pass(fluxInit, fx[0]);
    built = true;
  }
  function moveTo(px, pz) {
    const [nx, nz] = center(px, pz);
    if (nx === win.ox && nz === win.oz) return;
    const si = Math.round((nx - win.ox) / CELL), sj = Math.round((nz - win.oz) / CELL);
    if (Math.abs(si) >= SIZE || Math.abs(sj) >= SIZE) { start(px, pz); return; }
    // shift the CPU copies, then sample only the cells that came into the window
    const shiftArr = (a, c) => {
      const b = new Float32Array(a.length);
      for (let j = 0; j < SIZE; j++) {
        const oj = j + sj; if (oj < 0 || oj >= SIZE) continue;
        const i0 = Math.max(0, -si), i1 = Math.min(SIZE, SIZE - si);
        if (i1 > i0) b.set(a.subarray((oj * SIZE + i0 + si) * c, (oj * SIZE + i1 + si) * c), (j * SIZE + i0) * c);
      }
      a.set(b);
    };
    shiftArr(bedA, 1); shiftArr(feedA, 4);
    win.ox = nx; win.oz = nz;
    if (si > 0) sampleRect(SIZE - si, 0, SIZE, SIZE); else if (si < 0) sampleRect(0, 0, -si, SIZE);
    if (sj > 0) sampleRect(0, SIZE - sj, SIZE, SIZE); else if (sj < 0) sampleRect(0, 0, SIZE, -sj);
    initMat.uniforms.keep.value = 1; initMat.uniforms.shift.value.set(si, sj); initMat.uniforms.S.value = st[0].texture;
    pass(initMat, st[1]); st.reverse();
    // the pipes' flows move with it too, so the current does not stop and restart each time the window moves
    initMat.uniforms.flux.value = 1; initMat.uniforms.S.value = fx[0].texture;
    pass(initMat, fx[1]); fx.reverse();
    initMat.uniforms.flux.value = 0;
  }
  let acc = 0;
  // game seconds a real second (for soaking in and evaporation, which run on game time)
  let gameRate = 72;
  function update(dt, px, pz, running, rate = 72) {
    gameRate = rate;
    if (!on) return;
    if (!st || SIZE !== wantSize) { SIZE = wantSize; allocate(); }
    const prevRT = renderer.getRenderTarget(), prevXr = renderer.xr.enabled, prevAuto = renderer.autoClear;
    renderer.xr.enabled = false; renderer.autoClear = false;
    if (!built) start(px, pz); else moveTo(px, pz);
    stateMat.uniforms.org.value.set(win.ox, win.oz); orgU.value.set(win.ox, win.oz);
    // 25 mm an hour soaks into ordinary ground; 4 mm a day evaporates
    stateMat.uniforms.soak.value = 25e-3 / 3600 * gameRate; stateMat.uniforms.evap.value = 4e-3 / 86400 * gameRate;
    acc = bedOnly ? 0 : Math.min(acc + (running ? dt : 0), STEP_DT * MAX_STEPS);
    while (acc >= STEP_DT) {
      acc -= STEP_DT;
      fluxMat.uniforms.S.value = st[0].texture; fluxMat.uniforms.F.value = fx[0].texture;
      pass(fluxMat, fx[1]); fx.reverse();
      stateMat.uniforms.S.value = st[0].texture; stateMat.uniforms.F.value = fx[0].texture;
      pass(stateMat, st[1]); st.reverse();
    }
    renderer.setRenderTarget(prevRT); renderer.xr.enabled = prevXr; renderer.autoClear = prevAuto;
    for (const p of pushers) p.z = 0;
    for (const p of pours) p.z = 0;
    for (const o of obstU.value) o.z = 0;
    for (const o of froths) o.z = 0;
    drawU.uState.value = st[0].texture; drawU.uBed.value = bedTex; drawU.uN.value = SIZE; drawU.uOrg.value.set(win.ox, win.oz);
    const w = SIZE * CELL;
    drawU.uBedWin.value.set(win.ox, win.oz, win.ox + w, win.oz + w);
    if (!bedOnly) shared.uWin.value.set(win.ox, win.oz, win.ox + w, win.oz + w);
    mesh.visible = !bedOnly;
    // read the whole window back a few times a second (asynchronously, a frame or two late), for wading, filling
    // the can and irrigation: 1 MB for the normal window
    readT += dt;
    if (readT > 0.25 && !readBusy && renderer.readRenderTargetPixelsAsync) {
      readT = 0; readBusy = true;
      const n = SIZE, ox = win.ox, oz = win.oz;
      if (!read.tmp || read.tmp.length !== n * n * 4) read.tmp = new Float32Array(n * n * 4);
      renderer.readRenderTargetPixelsAsync(st[0], 0, 0, n, n, read.tmp).then(() => {
        if (!read.buf || read.buf.length !== read.tmp.length) read.buf = new Float32Array(read.tmp.length);
        read.buf.set(read.tmp); read.ox = ox; read.oz = oz; read.n = n; read.ok = true; readBusy = false;
      }).catch(() => { readBusy = false; read.ok = false; });
    }
  }
  // the simulated water at a world point, as last read back: { depth, vx, vz, foam } or null outside the window
  function waterAt(x, z) {
    if (!on || !read.ok) return null;
    const i = Math.floor((x - read.ox) / CELL), j = Math.floor((z - read.oz) / CELL), n = read.n;
    if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) return null;
    const k = (j * n + i) * 4, b = read.buf;
    return { depth: b[k], vx: b[k + 1], vz: b[k + 2], foam: b[k + 3] };
  }
  // a chunk's ground or channels changed: sample its cells again (the water there keeps flowing)
  function chunkChanged(ch) {
    if (!on || !built) return;
    const i0 = Math.floor((ch.ox - win.ox) / CELL), j0 = Math.floor((ch.oz - win.oz) / CELL), n = Math.ceil(CS / CELL);
    if (i0 >= SIZE || j0 >= SIZE || i0 + n <= 0 || j0 + n <= 0) return;
    sampleRect(i0 - 1, j0 - 1, i0 + n + 1, j0 + n + 1);
  }
  // 'off' | 'live' | 'wide' | 'bed': the last keeps the window's ground and baked water (for the stream-bed look
  // under the baked water) without simulating or drawing any water of its own
  let bedOnly = false;
  function setMode(mode) {
    const want = ok && (mode === 'live' || mode === 'wide' || mode === 'bed');
    wantSize = mode === 'wide' ? 512 : 256;
    bedOnly = mode === 'bed';
    on = want;
    if (bedOnly) { shared.uWin.value.set(1, 1, 0, 0); if (mesh) mesh.visible = false; }
    if (!on) { free(); built = false; read.ok = false; shared.uWin.value.set(1, 1, 0, 0); drawU.uBedWin.value.set(1, 1, 0, 0); }
  }
  return {
    available: ok, update, waterAt, chunkChanged, setMode,
    // something moving through the water at (x, z): radius r (m), velocity (vx, vz), strength 0-1
    push(slot, x, z, r, vx, vz, k = 1) { if (slot < 4) { pushers[slot].set(x, z, r, k); pushV[slot].set(vx, vz); } },
    // something standing in the water at (x, z), radius r, this frame: the water flows round it
    obstacle(slot, x, z, r) { if (slot < 2) obstU.value[slot].set(x, z, r, heightAt(x, z) + 1.5); },
    // white water churned at (x, z) over radius r, this frame (amount about 0-1)
    froth(slot, x, z, r, amount) { if (slot < 2) froths[slot].set(x, z, r, amount); },
    // water poured in at (x, z) over radius r, rate m3/s, for this frame
    pour(slot, x, z, r, rate) { if (slot < 4) pours[slot].set(x, z, r, rate); },
    get on() { return on; }, get window() { return { ...win, size: SIZE * CELL }; },
    uniforms: drawU,
    material,
  };
}
