// Streams and rivers on screen, baked tier: one water mesh per chunk that a channel crosses, built from the channel
// data in rivers-gen.js, drawn with a shader of their own (not the sea's; the look is in river-shade.js).
//
// The surface. Flat across the channel, so where it meets the banks the depth test cuts a crisp shoreline, and
// stepped along it: a pool holds 0.6 of bankfull depth above its lip, a riffle carries a thin sheet down to the next
// pool. Each vertex carries the surface on an ordinary day, the bed lip it rides on, the ground under it, its flow
// velocity and how much white water it has; the vertex shader raises or lowers the water and speeds or slows it
// with the stream flow of the day (uWetDepth, uWetSpeed from src/sim/streams.js), so rain shows without a rebuild.
// Each chunk also keeps that data (ch.riverData) for the live simulation to start from and feed its edges with.
import * as THREE from 'three';
import { RIVER_SHADE } from './river-shade.js';
import { makeFoamTexture } from './water-fx.js';

export function createRiverWater({ U, sea, CS, P, SEA }) {
  const N = CS + 1;
  const su = sea.uniforms;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTurbid: { value: 1 }, uSnap: { value: 0 }, uTPM: { value: 12.8 }, uFoamTex: { value: null },
    uCloud: { value: 0 }, uRain: { value: 0 }, uRipTex: { value: null }, uRipWin: { value: new THREE.Vector4(0, 0, 1, 0) }, uWake: { value: new THREE.Vector4() }, uWakeK: { value: new THREE.Vector2() }, uRefl: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uReflOn: { value: new THREE.Vector4(0, 0, 0, 0) }, uEnv: { value: null }, uEnv2: { value: null }, uEnvMix: { value: 0 }, uEnvPos: { value: new THREE.Vector4(0, 0, 0, 0) },
    uRip: { value: Array.from({ length: 24 }, () => new THREE.Vector4(0, 0, -100, 0)) }, uRipV: { value: Array.from({ length: 24 }, () => new THREE.Vector2()) }, uRipD: { value: Array.from({ length: 24 }, () => new THREE.Vector2()) }, uSkyMap: { value: null }, uSkyK: { value: 1 }, uTex: { value: null },
    uWin: { value: new THREE.Vector4(1, 1, 0, 0) }, uWetDepth: { value: 1 }, uWetSpeed: { value: 1 },
  }]);
  // shared, not copied: time, sun and sky move with the world; the detail texture is the sea's
  uniforms.uTime = U.time; uniforms.uTex = su.uTex;
  uniforms.uSunDir = su.uSunDir; uniforms.uSunCol = su.uSunCol; uniforms.uAmb = su.uAmb; uniforms.uSky = su.uSky; uniforms.uZenith = su.uZenith;
  uniforms.uSkyMap = U.skyMap; uniforms.uSkyK = U.skyK;
  uniforms.uFoamTex.value = makeFoamTexture();
  const material = new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec4 aFlow;                 // xy velocity on an ordinary day (m/s), z the ground, w white water
      attribute float aBed;                 // the bed lip the surface rides on
      uniform float uWetDepth, uWetSpeed;
      varying vec3 vWorld; varying vec4 vFlow;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        p.y = aBed + (p.y - aBed) * uWetDepth;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz; vFlow = vec4(aFlow.xy * uWetSpeed, p.y - aFlow.z, aFlow.w * mix(0.7, 1.3, clamp(uWetSpeed - 0.5, 0.0, 1.0)));
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      varying vec3 vWorld; varying vec4 vFlow;
      #include <common>
      #include <fog_pars_fragment>
      ${RIVER_SHADE}
      void main() {
        vec2 p = vWorld.xz, cell = waterCell(p), q = waterTexel(p);
        if (bayer4(cell) < liveShare(q)) discard;                      // the live water draws here
        vec4 c = shadeRiver(q, cell, vWorld, vFlow.xy, vFlow.z, vFlow.w);
        c.a *= smoothstep(0.0, 0.008, vFlow.z + 0.004);
        gl_FragColor = c;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // a chunk's water on an ordinary day, on its 1 m grid: surface (NaN where there is none), the bed lip it rides on,
  // the ground, velocity and white water. Kept on the chunk for the live simulation.
  function sample(ch, R) {
    if (!R || !R.segmentsIn(ch.ox, ch.oz, ch.ox + CS, ch.oz + CS).length) return null;
    const surf = new Float32Array(N * N).fill(NaN), bed = new Float32Array(N * N), ground = new Float32Array(N * N), vel = new Float32Array(N * N * 2), foam = new Float32Array(N * N);
    let any = false;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = ch.ox + i, z = ch.oz + j, info = R.riverInfo(x, z);
      if (!info || info.dist > info.w / 2 + 1.5 * info.D + 1.5) continue;
      const rif = smooth(0.74, 0.92, info.phase);
      const s = info.bedLip + info.D * (0.62 - 0.4 * rif);
      if (s <= SEA + 0.02) continue;                                   // the sea takes over here
      const k = j * N + i, gr = ch.h[(j + 1) * P + i + 1];
      const speed = Math.min(3, 1.6 * info.Q / Math.max(0.2, info.w * Math.max(0.12, 0.6 * info.D)) * (1 + 1.6 * rif));
      surf[k] = s; bed[k] = Math.min(info.bedLip, s); ground[k] = gr;
      vel[k * 2] = info.dir[0] * speed; vel[k * 2 + 1] = info.dir[1] * speed;
      foam[k] = Math.min(1, rif * (0.35 + 0.5 * speed) + (info.fall ? 0.6 : 0) + smooth(0.6, 0.9, info.phase) * 0.3 * (1 - smooth(0.92, 1, info.phase)));
      if (s - gr > 0.004) any = true;
    }
    return any ? { surf, bed, ground, vel, foam, ox: ch.ox, oz: ch.oz } : null;
  }
  function build(D) {
    const { surf, bed, ground, vel, foam } = D;
    const pos = [], att = [], beds = [], idx = [], map = new Int32Array(N * N).fill(-1);
    const vert = (k) => {
      if (map[k] >= 0) return map[k];
      const i = k % N, j = (k / N) | 0;
      map[k] = pos.length / 3;
      pos.push(D.ox + i, surf[k], D.oz + j);
      att.push(vel[k * 2], vel[k * 2 + 1], ground[k], foam[k]);
      beds.push(bed[k]);
      return map[k];
    };
    for (let j = 0; j < CS; j++) for (let i = 0; i < CS; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      if (isNaN(surf[a]) || isNaN(surf[b]) || isNaN(surf[c]) || isNaN(surf[d])) continue;
      // keep quads that could hold water on a wet day (the surface rises up to half again)
      if (Math.max(surf[a] + 0.5 * (surf[a] - bed[a]) - ground[a], surf[b] + 0.5 * (surf[b] - bed[b]) - ground[b], surf[c] + 0.5 * (surf[c] - bed[c]) - ground[c], surf[d] + 0.5 * (surf[d] - bed[d]) - ground[d]) <= 0.004) continue;
      const va = vert(a), vb = vert(b), vc = vert(c), vd = vert(d);
      idx.push(va, vc, vb, vb, vc, vd);
    }
    if (!idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('aFlow', new THREE.BufferAttribute(new Float32Array(att), 4));
    geo.setAttribute('aBed', new THREE.BufferAttribute(new Float32Array(beds), 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.renderOrder = 1;
    return mesh;
  }
  // (re)build a chunk's water: called when the chunk is built and whenever its ground changes
  function refresh(ch, R) {
    if (ch.riverMesh) { ch.group.remove(ch.riverMesh); ch.riverMesh.geometry.dispose(); ch.riverMesh = null; }
    ch.riverData = sample(ch, R);
    const m = ch.riverData && build(ch.riverData);
    if (m) { ch.riverMesh = m; ch.group.add(m); }
  }
  function dispose(ch) {
    if (ch.riverMesh) { ch.riverMesh.geometry.dispose(); ch.riverMesh = null; }
    ch.riverData = null;
  }
  return { material, uniforms, refresh, dispose };
}
