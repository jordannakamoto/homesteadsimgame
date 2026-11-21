// The live deformation: a toroidal RGBA16F texture of the snow round the player at 2.5 cm (press, rim, rough, cleared),
// with mips. Every presser stamps a capsule from where it was to where it is, so ruts are continuous at any speed, as
// instanced quads with MAX blending on all four channels: no ping-pong, no full pass. A strip that scrolls into the
// window is written from the snowpack's packed fraction, so old paths are there when you come back. While it snows,
// blows or thaws, one quad every 0.25 s multiplies the texture down: tracks fill in, rims slump.
// All of a frame's drawing (decay, seeding, stamps) goes in one render call, so the mips are rebuilt once.
import { makeTarget, drawTo } from './gpu.js';
import { FIELD_GLSL } from './shade.js';

const MAXS = 128;                                   // stamps a frame (more wait for the next)
const OFFS = [[0, 0], [-1, 0], [0, -1], [-1, -1]];  // each quad drawn four times, so it wraps across the texture's edge

const VERT = /* glsl */ `
  attribute vec4 aRect; attribute vec4 aPar; attribute vec4 aPar2; attribute vec2 aOff;
  uniform float uM; uniform float uMode;            // uMode 0: a capsule stamp, 1: a rectangle (seeding)
  varying vec2 vL; varying vec2 vOrg; varying vec4 vRect; varying vec4 vPar; varying vec4 vPar2;
  void main() {
    vec2 L;
    if (uMode < 0.5) {
      vec2 p0 = aRect.xy, p1 = aRect.zw, d = p1 - p0; float len = length(d);
      vec2 ax = len > 1e-4 ? d / len : vec2(1.0, 0.0), pp = vec2(-ax.y, ax.x);
      float R = aPar.x * 4.2 + 0.08;
      L = (p0 + p1) * 0.5 + ax * position.x * (len * 0.5 + R) + pp * position.y * R;
    } else L = mix(aRect.xy, aRect.zw, position.xy * 0.5 + 0.5);
    vL = L; vOrg = aPar2.zw; vRect = aRect; vPar = aPar; vPar2 = aPar2;
    gl_Position = vec4((L / uM + aOff) * 2.0 - 1.0, 0.0, 1.0);
  }`;
const STAMP_F = /* glsl */ `
  precision highp float;
  varying vec2 vL; varying vec2 vOrg; varying vec4 vRect; varying vec4 vPar; varying vec4 vPar2;
  float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
  // Clumps: broken snow lies in lumps, not in a ridge. A jittered grid of soft domes, each its own size and height,
  // some cells empty (keep 0..1: the share of cells that hold one). Anchored to the world, so every stamp that
  // touches a lump draws the same lump.
  float clumps(vec2 w, float cell, float keep) {
    vec2 g = w / cell, id = floor(g); float v = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = id + vec2(float(i), float(j)), r = h22(c + cell * 13.7);
      float has = step(1.0 - keep, h12(c * 1.7 + 3.1 + cell));
      float rad = 0.28 + 0.34 * r.x, hgt = 0.45 + 0.55 * r.y;
      float d = length(g - (c + 0.2 + 0.6 * h22(c + 5.3))) / rad;
      v = max(v, has * hgt * (1.0 - smoothstep(0.35, 1.0, d)));
    }
    return v;
  }
  void main() {
    vec2 p0 = vRect.xy, p1 = vRect.zw, ba = p1 - p0, pa = vL - p0;
    float bb = max(dot(ba, ba), 1e-8), h = clamp(dot(pa, ba) / bb, 0.0, 1.0);
    float r = vPar.x, k = vPar.y, q = vPar.w;
    float tread = floor(vPar2.y + 0.001), uneven = fract(vPar2.y + 0.001) / 0.99;
    vec2 vW = vL + vOrg;
    // the edge is never a clean capsule: the wall breaks away in pieces (two scales of world-anchored wobble)
    float wob = (vnoise(vW * 8.0) - 0.5) * 0.55 + (vnoise(vW * 27.0) - 0.5) * 0.3;
    float d = length(pa - ba * h) / (r * (1.0 + wob * uneven));           // 0 on the centre line, 1 at the presser's edge
    // the floor: pressed hardest in the middle, lumpy where the wall fell in, a slumped shoulder not a cliff
    float lump = mix(1.0, 0.7 + 0.3 * vnoise(vW * 15.0), uneven);
    float press = k * lump * (1.0 - smoothstep(0.55, 1.05, d));
    // what was pushed out lies beside it in clumps, thinning outward; a few are thrown further
    float ring = smoothstep(0.8, 1.05, d) * (1.0 - smoothstep(1.2, 2.2, d));
    float big = clumps(vW, 0.12 + 0.5 * r, 0.8), small = clumps(vW, 0.065, 0.55);
    float rim = vPar.z * k * ring * mix(0.8, 0.25 + 1.0 * max(big, 0.6 * small), uneven);
    float fling = q * smoothstep(1.0, 1.5, d) * (1.0 - smoothstep(1.6, 4.0, d));
    rim = max(rim, fling * k * small * step(0.35, small) * 0.8);
    float rough = q * (1.0 - smoothstep(1.0, 3.0, d)) * vnoise(vW * 40.0);  // crumbs round it
    // the tread: a boot's sole bars across the print, a tyre's lugs in a chevron
    vec2 ax = ba / sqrt(bb), pp = vec2(-ax.y, ax.x);
    float along = dot(pa, ax), across = dot(pa, pp) / r, tr = 1.0;
    if (tread > 1.5) tr = 0.88 + 0.12 * step(0.5, fract(along / 0.09 + abs(across) * 0.6));
    else if (tread > 0.5) tr = 0.93 + 0.07 * step(0.45, fract(along / 0.035));
    float cl = vPar2.x * (1.0 - smoothstep(0.8, 1.0, d));
    gl_FragColor = vec4(press * tr, rim, rough, cl);
  }`;
const SEED_F = /* glsl */ `
  precision highp float;
  ${FIELD_GLSL}
  varying vec2 vL; varying vec2 vOrg; varying vec4 vRect; varying vec4 vPar; varying vec4 vPar2;
  void main() {
    vec2 w = vL + vOrg;
    float p = snowField(w).z;
    // a packed path from the snowpack, broken up a little so it reads as trodden rather than drawn
    p *= 0.82 + 0.18 * snowNoise2(w * 3.1);
    gl_FragColor = vec4(p, 0.0, 0.0, 0.0);
  }`;

export function createLive(G, U, { n, m }) {
  const T = G.THREE, R = G.renderer;
  const rt = makeTarget(T, n, { mips: true });
  U.uSnowLive.value = rt.texture;
  U.uSnowLiveTexel.value = m / n;
  const scene = new T.Scene(), cam = new T.Camera();
  scene.matrixWorldAutoUpdate = false;
  const quad = new T.PlaneGeometry(2, 2);
  function instGeo(max) {
    const g = new T.InstancedBufferGeometry();
    g.index = quad.index; g.setAttribute('position', quad.attributes.position);
    const a = (k) => { const b = new T.InstancedBufferAttribute(new Float32Array(max * 4 * k), k); b.setUsage(T.DynamicDrawUsage); return b; };
    g.setAttribute('aRect', a(4)); g.setAttribute('aPar', a(4)); g.setAttribute('aPar2', a(4)); g.setAttribute('aOff', a(2));
    g.instanceCount = 0;
    return g;
  }
  const base = { depthTest: false, depthWrite: false, toneMapped: false, vertexShader: VERT };
  const stampMat = new T.ShaderMaterial({ ...base, uniforms: { uM: { value: m }, uMode: { value: 0 } }, fragmentShader: STAMP_F,
    blending: T.CustomBlending, blendEquation: T.MaxEquation, blendEquationAlpha: T.MaxEquation, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneFactor });
  const seedU = { uM: { value: m }, uMode: { value: 1 } };
  for (const k of ['uSnowField', 'uSnowFieldWin', 'uSnowRef', 'uSnowWind', 'uSnowFlags', 'uSnowFlags2']) seedU[k] = U[k];
  const seedMat = new T.ShaderMaterial({ ...base, uniforms: seedU, fragmentShader: SEED_F, blending: T.NoBlending });
  const decayU = { uK: { value: new T.Vector4(1, 1, 1, 1) } };
  const decayMat = new T.ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false, uniforms: decayU,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'precision highp float; uniform vec4 uK; void main() { gl_FragColor = uK; }',
    blending: T.CustomBlending, blendEquation: T.AddEquation, blendEquationAlpha: T.AddEquation,
    blendSrc: T.DstColorFactor, blendDst: T.ZeroFactor, blendSrcAlpha: T.DstAlphaFactor, blendDstAlpha: T.ZeroFactor });
  const stampGeo = instGeo(MAXS), seedGeo = instGeo(8);
  const mk = (geo, mat, order) => { const o = new T.Mesh(geo, mat); o.frustumCulled = false; o.renderOrder = order; o.matrixAutoUpdate = false; scene.add(o); return o; };
  const decay = mk(quad, decayMat, 0), seed = mk(seedGeo, seedMat, 1), stamps = mk(stampGeo, stampMat, 2);
  let ns = 0, nseed = 0, cx = null, cz = null, total = 0, draws = 0;
  // one rectangle or capsule, in a frame local to the texture tile that holds its first point (keeps floats small)
  function put(geo, i, rect, par, par2) {
    const ox = Math.floor(rect[0] / m) * m, oz = Math.floor(rect[1] / m) * m;
    const A = geo.attributes;
    for (let o = 0; o < 4; o++) {
      const k = i * 4 + o;
      A.aRect.array.set([rect[0] - ox, rect[1] - oz, rect[2] - ox, rect[3] - oz], k * 4);
      A.aPar.array.set(par, k * 4);
      A.aPar2.array.set([par2[0], par2[1], ox, oz], k * 4);
      A.aOff.array.set(OFFS[o], k * 2);
    }
  }
  const dirty = (geo, count) => { geo.instanceCount = count * 4; for (const k of ['aRect', 'aPar', 'aPar2', 'aOff']) { const a = geo.attributes[k]; a.clearUpdateRanges(); a.addUpdateRange(0, count * 4 * a.itemSize); a.needsUpdate = true; } };

  return {
    rt, n, m,
    get centre() { return cx === null ? null : [cx, cz]; },
    get total() { return total; }, get draws() { return draws; },
    // a capsule from (x0, z0) to (x1, z1), radius r (m); k how far it packs the column (0..1); rim, rough, cleared 0..1;
    // tread 0 none, 1 boot, 2 tyre; uneven 0..1 how broken the edge and rim are (1: a foot in powder; 0: a clean blade)
    stamp(s) {
      if (ns >= MAXS || cx === null) return false;
      const x1 = s.x1 != null ? s.x1 : s.x0, z1 = s.z1 != null ? s.z1 : s.z0;
      put(stampGeo, ns++, [s.x0, s.z0, x1, z1], [Math.max(s.r || 0.1, 0.01), s.k != null ? s.k : 1, s.rim != null ? s.rim : 1, s.rough || 0], [s.cleared || 0, (s.tread || 0) + 0.99 * Math.min(1, Math.max(0, s.uneven != null ? s.uneven : 1))]);
      total++;
      return true;
    },
    // follow the snow surface's centre: write the strips that came into view from the snowpack
    follow(nx, nz) {
      const h = m / 2;
      if (cx === null || Math.abs(nx - cx) >= m || Math.abs(nz - cz) >= m) put(seedGeo, nseed++, [nx - h, nz - h, nx + h, nz + h], [0, 0, 0, 0], [0, 0]);
      else {
        if (nx !== cx) put(seedGeo, nseed++, nx > cx ? [cx + h, nz - h, nx + h, nz + h] : [nx - h, nz - h, cx - h, nz + h], [0, 0, 0, 0], [0, 0]);
        if (nz !== cz) put(seedGeo, nseed++, nz > cz ? [nx - h, cz + h, nx + h, nz + h] : [nx - h, nz - h, nx + h, cz - h], [0, 0, 0, 0], [0, 0]);
      }
      cx = nx; cz = nz;
      U.uSnowLiveWin.value.set(cx, cz, m, 1);
    },
    // reseed the whole window from the snowpack (after a storm or a thaw from the debug tools)
    reseed() { if (cx !== null) { nseed = 0; put(seedGeo, nseed++, [cx - m / 2, cz - m / 2, cx + m / 2, cz + m / 2], [0, 0, 0, 0], [0, 0]); } },
    // multiply the texture down: press, rim, rough, cleared (each 0..1, 1 keeps it)
    decay(kp, kr, kq, kc) { decayU.uK.value.set(kp, kr, kq, kc); decay.visible = true; },
    // draw what this frame queued, in one render call; false if there was nothing
    flush() {
      if (!ns && !nseed && !decay.visible) return false;
      dirty(stampGeo, ns); dirty(seedGeo, nseed);
      stamps.visible = ns > 0; seed.visible = nseed > 0;
      drawTo(T, R, rt, scene, cam);
      ns = 0; nseed = 0; decay.visible = false; draws++;
      return true;
    },
    dispose() {
      rt.dispose(); stampGeo.dispose(); seedGeo.dispose(); quad.dispose(); stampMat.dispose(); seedMat.dispose(); decayMat.dispose();
      U.uSnowLive.value = null; U.uSnowLiveWin.value.w = 0;
    },
  };
}
