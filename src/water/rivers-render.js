// Streams and rivers on screen, baked tier: one water mesh per chunk that a channel crosses, built from the channel
// data in rivers-gen.js, drawn with a shader of their own (not the sea's).
//
// The surface. Flat across the channel, so where it meets the banks the depth test cuts a crisp shoreline, and
// stepped along it: a pool holds 0.6 of bankfull depth above its lip, a riffle carries a thin sheet down to the next
// pool. Each vertex carries its flow velocity, its depth over the ground and how much white water it has.
//
// The look, from what makes real streams read as real (see the design doc):
//  - colour is reflection plus "water fog", never reflection alone: light is absorbed per channel, red first, so
//    clear shallows go green-gold over the bed and deeper water olive-brown; sediment (more with more flow) clouds it
//  - the bed shows through the shallows (transparency), with caustics where the sun reaches it
//  - flow shows in the surface: detail flowed along the velocity in two layers half a phase apart (Valve's flow
//    maps), glassy in pools, broken on riffles
//  - sky reflection darkened under trees (the baked sky-visibility map), sun glints, Fresnel
//  - white water on riffles and at the water's edge, posterised with an ordered dither
//  - everything evaluated per world texel (6.4 a metre, the terrain's), so the water is pixel-crisp like the ground
import * as THREE from 'three';

const TPM = 6.4;

export function createRiverWater({ U, sea, CS, P, SEA }) {
  const N = CS + 1;
  const su = sea.uniforms;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTurbid: { value: 1 }, uSnap: { value: 1 }, uSkyMap: { value: null }, uSkyK: { value: 1 }, uTex: { value: null },
  }]);
  // shared, not copied: time, sun and sky move with the world; the detail texture is the sea's
  uniforms.uTime = U.time; uniforms.uTex = su.uTex;
  uniforms.uSunDir = su.uSunDir; uniforms.uSunCol = su.uSunCol; uniforms.uAmb = su.uAmb; uniforms.uSky = su.uSky; uniforms.uZenith = su.uZenith;
  uniforms.uSkyMap = U.skyMap; uniforms.uSkyK = U.skyK;
  const material = new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec4 aFlow;                 // xy velocity (m/s), z depth over the ground (m), w white water
      varying vec3 vWorld; varying vec4 vFlow;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz; vFlow = aFlow;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime, uTurbid, uSnap, uSkyK; uniform sampler2D uTex, uSkyMap;
      uniform vec3 uSunDir, uSunCol, uAmb, uSky, uZenith;
      varying vec3 vWorld; varying vec4 vFlow;
      #include <common>
      #include <fog_pars_fragment>
      const mat4 BAYER = mat4(0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
      float bayer4(vec2 c) { ivec2 i = ivec2(mod(c, 4.0)); return (BAYER[i.y][i.x] + 0.5) / 16.0; }
      void main() {
        vec2 p = vWorld.xz;
        vec2 cell = floor(p * ${TPM.toFixed(1)});
        vec2 q = uSnap > 0.5 ? (cell + 0.5) / ${TPM.toFixed(1)} : p;
        vec2 v = vFlow.xy; float sp = length(v);
        float d = max(vFlow.z, 0.0);
        // flowed detail, two layers half a phase apart, the phase offset in 4 m patches to hide the pulse
        float ph = uTime * 0.32 + texture2D(uTex, floor(q / 4.0) * 0.173).b;
        float t0 = fract(ph), t1 = fract(ph + 0.5), wb = abs(1.0 - 2.0 * t0);
        vec2 uvA = q * 0.31 - v * t0 * 0.55, uvB = q * 0.31 - v * t1 * 0.55 + 0.37;
        vec3 dA = texture2D(uTex, uvA).rgb, dB = texture2D(uTex, uvB).rgb;
        vec3 det = mix(dA, dB, wb);
        float rough = 0.12 + 0.88 * smoothstep(0.05, 1.1, sp);           // pools glassy, riffles broken
        vec2 g = (det.rg - 0.5) * rough * 1.1;
        g = floor(g * 8.0 + 0.5) / 8.0;                                  // ripples as pixel facets
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 V = normalize(cameraPosition - vWorld);
        float ndv = max(dot(N, V), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        float skyVis = mix(1.0, texture2D(uSkyMap, (q + 0.5) / 512.0).r, uSkyK);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        // low reflections hit the banks and the plants on them, not open sky: a small stream mirrors dark green
        vec3 bank = uAmb * vec3(0.16, 0.2, 0.11) + uSunCol * vec3(0.04, 0.05, 0.025);
        vec3 sky = mix(bank, mix(uSky, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.7)), smoothstep(0.04, 0.3, R.y)) * mix(0.35, 1.0, skyVis);
        float sd = max(dot(R, uSunDir), 0.0);
        vec3 glint = uSunCol * (pow(sd, mix(600.0, 120.0, rough)) * mix(40.0, 6.0, rough)) * skyVis;
        // light through the water: absorbed per channel along the path down and back, clouded by sediment
        float path = d * (1.0 + 1.0 / max(V.y, 0.25));
        vec3 sigma = vec3(1.9, 0.55, 0.85) + uTurbid * vec3(0.55, 0.65, 1.1);
        vec3 T = exp(-sigma * path);
        float opaque = 1.0 - dot(T, vec3(0.3, 0.45, 0.25));
        vec3 lightIn = uAmb * mix(0.55, 1.0, skyVis) + uSunCol * 0.55 * skyVis * (0.6 + 0.4 * max(uSunDir.y, 0.0));
        // clear water mostly absorbs: it darkens and tints the bed rather than glowing over it
        vec3 scatter = mix(vec3(0.045, 0.065, 0.035), vec3(0.075, 0.062, 0.04), clamp(uTurbid * 0.4, 0.0, 1.0));
        float fwd = pow(max(dot(-V, uSunDir), 0.0), 6.0);                 // looking upstream into a low sun
        vec3 body = scatter * lightIn * (1.0 + 2.5 * fwd);
        // caustics on the bed, seen through the shallows where the sun reaches
        vec2 bedP = q - V.xz / max(V.y, 0.3) * d;
        float ca = texture2D(uTex, bedP * 0.42 + uTime * vec2(0.03, 0.017) + g).b * texture2D(uTex, bedP * 0.61 - uTime * vec2(0.021, 0.031)).b;
        ca = step(0.42, ca);
        vec3 caust = uSunCol * vec3(0.9, 1.0, 0.75) * ca * 0.22 * (1.0 - opaque) * skyVis * smoothstep(0.03, 0.15, d);
        vec3 col = mix(body + caust, sky, fres) + glint;
        float alpha = max(max(opaque, fres * 0.85), 0.12);
        // white water: riffle foam carried in the flow, and lace where the water thins to nothing at the edge
        float lace = 1.0 - smoothstep(0.0, 0.06, d);
        // foam breaks into streaks along the flow: noise stretched down the current
        vec2 fd = sp > 0.01 ? v / sp : vec2(1.0, 0.0);
        vec2 fq = vec2(dot(q, fd) * 0.35, dot(q, vec2(-fd.y, fd.x)) * 1.6) - vec2(uTime * sp * 0.35, 0.0);
        float streak = texture2D(uTex, fq * 0.5).b;
        float fa = clamp(vFlow.w * 0.75 * (streak * 1.7 - 0.6) + lace * (det.b * 1.4 - 0.45), 0.0, 1.0);
        float foam = step(bayer4(cell), fa * fa * 1.6) + step(0.75, fa);
        foam = min(foam, 1.0) * mix(0.75, 1.0, step(0.75, fa));
        col = mix(col, lightIn * vec3(0.92, 0.95, 0.95) * 1.05, foam);
        alpha = max(alpha, foam * 0.92);
        alpha *= smoothstep(0.0, 0.008, vFlow.z + 0.004);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // the water mesh for one chunk, or null if no channel crosses it
  function build(ch, R) {
    if (!R || !R.segmentsIn(ch.ox, ch.oz, ch.ox + CS, ch.oz + CS).length) return null;
    const surf = new Float32Array(N * N).fill(NaN), flow = new Float32Array(N * N * 4);
    let any = false;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = ch.ox + i, z = ch.oz + j, info = R.riverInfo(x, z);
      if (!info || info.dist > info.w / 2 + 1.5 * info.D + 1.5) continue;
      const rif = smooth(0.74, 0.92, info.phase);
      let s = info.bedLip + info.D * (0.62 - 0.4 * rif);
      if (s <= SEA + 0.02) continue;                                   // the sea takes over here
      const k = j * N + i, ground = ch.h[(j + 1) * P + i + 1];
      const depth = s - ground;
      const speed = Math.min(2.5, info.Q / Math.max(0.2, info.w * Math.max(0.12, 0.6 * info.D)) * (1 + 1.6 * rif));
      surf[k] = s;
      flow[k * 4] = info.dir[0] * speed; flow[k * 4 + 1] = info.dir[1] * speed; flow[k * 4 + 2] = depth;
      flow[k * 4 + 3] = Math.min(1, rif * (0.35 + 0.5 * speed) + (info.fall ? 0.6 : 0) + smooth(0.6, 0.9, info.phase) * 0.3 * (1 - smooth(0.92, 1, info.phase)));
      if (depth > 0.004) any = true;
    }
    if (!any) return null;
    const pos = [], att = [], idx = [], map = new Int32Array(N * N).fill(-1);
    const vert = (k) => {
      if (map[k] >= 0) return map[k];
      const i = k % N, j = (k / N) | 0;
      map[k] = pos.length / 3;
      pos.push(ch.ox + i, surf[k], ch.oz + j);
      att.push(flow[k * 4], flow[k * 4 + 1], flow[k * 4 + 2], flow[k * 4 + 3]);
      return map[k];
    };
    for (let j = 0; j < CS; j++) for (let i = 0; i < CS; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      if (isNaN(surf[a]) || isNaN(surf[b]) || isNaN(surf[c]) || isNaN(surf[d])) continue;
      if (Math.max(flow[a * 4 + 2], flow[b * 4 + 2], flow[c * 4 + 2], flow[d * 4 + 2]) <= 0.004) continue;
      const va = vert(a), vb = vert(b), vc = vert(c), vd = vert(d);
      idx.push(va, vc, vb, vb, vc, vd);
    }
    if (!idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('aFlow', new THREE.BufferAttribute(new Float32Array(att), 4));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.renderOrder = 1;
    return mesh;
  }
  // (re)build a chunk's water: called when the chunk is built and whenever its ground changes
  function refresh(ch, R) {
    if (ch.riverMesh) { ch.group.remove(ch.riverMesh); ch.riverMesh.geometry.dispose(); ch.riverMesh = null; }
    const m = build(ch, R);
    if (m) { ch.riverMesh = m; ch.group.add(m); }
  }
  function dispose(ch) {
    if (ch.riverMesh) { ch.riverMesh.geometry.dispose(); ch.riverMesh = null; }
  }
  return { material, uniforms, refresh, dispose };
}
