// The sea: one flat water plane at sea level that follows the player, tinted by depth, foamy at the shore, with
// waves shared between the shader and game logic (waveHeight). Moved out of src/engine.js unchanged; the engine
// passes in what it used to reach directly. Rivers and streams will live beside it in this folder.
import * as THREE from 'three';

export function createSea({ U, scene, world, player, CS, P, SEA, clamp, mulberry32 }) {
  const col = (hex) => new THREE.Color(hex);
  // ---- water: depth-tinted, foamy at the shore, waves shared between shader and game logic
  const WAVES = [[0.8, 0.6, 17, 0.11, 1.1], [-0.5, 0.86, 11, 0.07, 1.3], [0.95, -0.3, 7, 0.04, 1.6]];
  const RIPPLES = [[0.3, 0.95, 3.1, 0.018, 2.0], [-0.9, 0.4, 2.2, 0.012, 2.4], [0.6, -0.8, 1.4, 0.007, 2.9], [-0.2, -0.98, 0.9, 0.004, 3.3]];
  function waveHeight(x, z) {
    let h = 0; const t = U.time.value;
    for (const w of WAVES) h += w[3] * Math.sin((x * w[0] + z * w[1]) * (6.2832 / w[2]) + t * w[4]);
    return SEA + h;
  }
  // Water depth around the player, baked from the terrain heights into a small texture.
  // This replaces a depth pre-pass: shore foam and depth colour cost one texture read.
  const DM = 256;
  const depthData = new Uint8Array(DM * DM);
  const depthTex = new THREE.DataTexture(depthData, DM, DM, THREE.RedFormat, THREE.UnsignedByteType);
  depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter;
  const depthState = { ox: 1e9, oz: 1e9, dirty: true, wait: 0, origin: new THREE.Vector2() };
  function updateDepthMap(dt) {
    depthState.wait -= dt;
    const ox = Math.round(player.x / 16) * 16 - DM / 2, oz = Math.round(player.z / 16) * 16 - DM / 2;
    if (ox !== depthState.ox || oz !== depthState.oz) depthState.dirty = true;
    if (!depthState.dirty || depthState.wait > 0) return;
    depthState.dirty = false; depthState.wait = 0.12; depthState.ox = ox; depthState.oz = oz;
    depthData.fill(255);
    for (const c of world.chunks.values()) {
      const i0 = c.ox - ox, j0 = c.oz - oz;
      if (i0 >= DM || j0 >= DM || i0 + CS <= 0 || j0 + CS <= 0) continue;
      for (let lj = 0; lj < CS; lj++) {
        const j = j0 + lj; if (j < 0 || j >= DM) continue;
        for (let li = 0; li < CS; li++) {
          const i = i0 + li; if (i < 0 || i >= DM) continue;
          depthData[j * DM + i] = clamp(((SEA - c.h[(lj + 1) * P + li + 1]) + 1) / 9 * 255, 0, 255);
        }
      }
    }
    depthTex.needsUpdate = true;
    depthState.origin.set(ox, oz);
  }
  // tileable water detail: RG = wavelet slope, B = ridged noise used for foam and caustics
  function makeWaterTex() {
    const S = 256, data = new Uint8Array(S * S * 4), r = mulberry32(911);
    const mk = (n, kmax, pw) => {
      const w = [];
      for (let i = 0; i < n; i++) {
        let kx = 0, ky = 0;
        while (kx === 0 && ky === 0) { kx = Math.round((r() * 2 - 1) * kmax); ky = Math.round((r() * 2 - 1) * kmax); }
        w.push([kx, ky, r() * 6.2832, 1 / Math.pow(Math.hypot(kx, ky), pw)]);
      }
      return w;
    };
    const A = mk(22, 9, 1.1), Bw = mk(16, 7, 0.9);
    const gx = new Float32Array(S * S), gy = new Float32Array(S * S), nn = new Float32Array(S * S);
    let gmax = 0, sq = 0;
    const tw = 6.2832 / S;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let ax = 0, ay = 0, n = 0;
      for (const w of A) { const c = w[3] * Math.cos((w[0] * x + w[1] * y) * tw + w[2]); ax += c * w[0]; ay += c * w[1]; }
      for (const w of Bw) n += w[3] * Math.sin((w[0] * x + w[1] * y) * tw + w[2]);
      const i = y * S + x; gx[i] = ax; gy[i] = ay; nn[i] = n;
      gmax = Math.max(gmax, Math.abs(ax), Math.abs(ay)); sq += n * n;
    }
    const rms = Math.sqrt(sq / (S * S));
    for (let i = 0; i < S * S; i++) {
      data[i * 4] = clamp((gx[i] / gmax) * 127 + 128, 0, 255);
      data[i * 4 + 1] = clamp((gy[i] / gmax) * 127 + 128, 0, 255);
      data[i * 4 + 2] = clamp(1 - Math.abs(nn[i]) / (rms * 1.7), 0, 1) * 255;
      data[i * 4 + 3] = 255;
    }
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  }
  const glslWaves = (list, withHeight) => list.map((w) => {
    const k = (6.2832 / w[2]).toFixed(4);
    return `ph = dot(p, vec2(${w[0].toFixed(3)}, ${w[1].toFixed(3)})) * ${k} + uTime * ${w[4].toFixed(2)};` +
      (withHeight ? ` h += ${w[3].toFixed(4)} * sin(ph);` : ` g += ${(w[3]).toFixed(4)} * ${k} * cos(ph) * vec2(${w[0].toFixed(3)}, ${w[1].toFixed(3)});`);
  }).join('\n');
  const waterUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uDepth: { value: null }, uTex: { value: null }, uDepthOrigin: { value: new THREE.Vector2() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() },
    uSky: { value: new THREE.Color() }, uZenith: { value: new THREE.Color() }, uShallow: { value: col(0x2fa79c) }, uDeep: { value: col(0x06283f) },
  }]);
  waterUniforms.uTime = U.time;
  waterUniforms.uDepth.value = depthTex;
  waterUniforms.uTex.value = makeWaterTex();
  waterUniforms.uDepthOrigin.value = depthState.origin;
  const water = (() => {
    const g = new THREE.PlaneGeometry(288, 288, 180, 180); g.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: waterUniforms, fog: true, transparent: true, depthWrite: false,
      vertexShader: `
        uniform float uTime; uniform sampler2D uDepth; uniform vec2 uDepthOrigin;
        varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float depth = texture2D(uDepth, (wp.xz - uDepthOrigin + 0.5) / ${DM}.0).r * 9.0 - 1.0;
          vec2 p = wp.xz; float h = 0.0; float ph;
          ${glslWaves(WAVES, true)}
          wp.y += h * (0.2 + 0.8 * smoothstep(0.0, 2.5, depth));
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform float uTime; uniform sampler2D uDepth; uniform sampler2D uTex; uniform vec2 uDepthOrigin;
        uniform vec3 uSunDir, uSunCol, uAmb, uSky, uZenith, uShallow, uDeep;
        varying vec3 vWorld;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          float depth = texture2D(uDepth, (vWorld.xz - uDepthOrigin + 0.5) / ${DM}.0).r * 9.0 - 1.0;
          vec2 p = vWorld.xz; vec2 g = vec2(0.0); float ph;
          ${glslWaves(WAVES, false)}
          // three scrolling layers of wavelets, the classic layered-normal-map trick
          vec2 d1 = texture2D(uTex, p * 0.035 + uTime * vec2(0.010, 0.006)).rg - 0.5;
          vec2 d2 = texture2D(uTex, p * 0.083 + uTime * vec2(-0.017, 0.012)).rg - 0.5;
          vec2 d3 = texture2D(uTex, p * 0.21 + uTime * vec2(0.025, -0.03)).rg - 0.5;
          float calm = 0.45 + 0.55 * smoothstep(0.0, 2.0, depth);
          g += (d1 * 0.6 + d2 * 0.42 + d3 * 0.24) * calm;
          vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 R = reflect(-V, N); R.y = abs(R.y);
          float fres = 0.07 + 0.93 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
          vec3 sky = mix(uSky, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.7));
          float sd = max(dot(R, uSunDir), 0.0);
          vec3 sunR = uSunCol * (pow(sd, 900.0) * 60.0 + pow(sd, 60.0) * 0.9);
          float absorb = 1.0 - exp(-max(depth, 0.0) * 0.8);
          float ndl = max(dot(N, uSunDir), 0.0);
          vec3 lightC = uSunCol * (0.35 + 0.65 * ndl) + uAmb;
          vec3 body = mix(uShallow, uDeep, absorb) * lightC;
          // caustics seen through the shallows
          float ca = texture2D(uTex, p * 0.075 + uTime * vec2(0.02, 0.011) + g * 0.3).b * texture2D(uTex, p * 0.11 - uTime * vec2(0.014, 0.021)).b;
          body += uSunCol * uShallow * pow(ca, 2.0) * 3.0 * (1.0 - absorb) * smoothstep(0.02, 0.5, depth);
          vec3 color = mix(body, sky, fres) + sunR;
          float alpha = max(mix(0.28, 0.985, absorb), fres);
          // lacy shore foam that thickens toward the waterline, plus one drifting line further out
          float fnz = texture2D(uTex, p * 0.14 + uTime * vec2(0.012, 0.02)).b * 0.6 + texture2D(uTex, p * 0.31 - uTime * vec2(0.02, 0.012)).b * 0.4;
          float lap = 0.14 * sin(uTime * 0.8 + p.x * 0.09 + p.y * 0.06);
          float shore = 1.0 - smoothstep(0.0, 0.6 + lap, depth);
          float th = 1.0 - shore * 1.02;
          float foam = smoothstep(th, th + 0.22, fnz) * smoothstep(0.0, 0.08, shore);
          float d0 = 1.1 + 0.45 * sin(uTime * 0.45 + p.x * 0.05);
          foam = max(foam, smoothstep(0.62, 0.9, fnz) * (1.0 - smoothstep(0.0, 0.4, abs(depth - d0))) * 0.65);
          color = mix(color, lightC * 0.92, foam);
          alpha = max(alpha, foam * 0.85) * smoothstep(-0.18, 0.03, depth);
          // toward this mesh's edge, over deep water, it gives way to the sky dome's open sea (shaded the same way),
          // so the sea runs on to the horizon without a line where the mesh stops
          alpha *= 1.0 - smoothstep(98.0, 126.0, length(vWorld.xz - cameraPosition.xz)) * smoothstep(1.5, 3.0, depth);
          gl_FragColor = vec4(color, clamp(alpha + dot(sunR, vec3(0.3)), 0.0, 1.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const m = new THREE.Mesh(g, mat);
    m.position.y = SEA; m.frustumCulled = false;
    scene.add(m);
    return m;
  })();
  return { WAVES, RIPPLES, waveHeight, DM, depthTex, depthState, updateDepthMap, uniforms: waterUniforms, mesh: water };
}
