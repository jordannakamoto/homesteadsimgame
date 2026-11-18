;(function () {
  /* Atmosphere pack: depth of field, sun shafts, haze glow, grade, vignette, campfires, night wisp.
     Runs only on High, as one extra pass in the existing composer (after bloom, before output). */
  const H = window.__fxHost;
  if (!H) return;
  // H is set by the game bundle in index.html: three.js namespace, renderer, scene, camera, sun, terrain height, water level, quality, camera state
  const jp = H.jp, yi = H.yi, oe = H.oe, hn = H.hn, en = H.en, Se = H.Se, jn = H.jn, ar = H.ar, dt = H.dt;
  const T = jp, R = yi, scene = oe, cam = hn, sun = en;
  const cfg = { dof: 1, shafts: 1, glow: 1, vignette: 0.3, saturation: 1.1, fireLight: 1, wisp: 1, treeVariety: 1 };
  const FX = { cfg, err: null, installed: false };
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const phases = () => { const t = Math.sin((H.Nt.time - 0.25) * Math.PI * 2), day = sm(0.02, 0.4, t), night = 1 - sm(-0.22, 0.06, t); return { day, night, gold: Math.min(1, Math.max(0, 1 - day - night)) }; };

  // ---------- fullscreen helpers ----------
  const quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new T.Mesh(new T.PlaneGeometry(2, 2), null);
  quad.frustumCulled = false;
  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const mat = (uniforms, fragmentShader) => new T.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  const draw = (m, target) => { quad.material = m; R.setRenderTarget(target); R.render(quad, quadCam); };
  const rt = (type) => new T.WebGLRenderTarget(4, 4, { type, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false });
  const rtShaftA = rt(T.UnsignedByteType), rtShaftB = rt(T.UnsignedByteType);
  const rtA = rt(T.HalfFloatType), rtB = rt(T.HalfFloatType);

  const shaftMat = mat({ tDepth: { value: null }, tShadow: { value: null }, uInvVP: { value: new T.Matrix4() }, uShadowM: { value: new T.Matrix4() }, uCam: { value: new T.Vector3() }, uSunDir: { value: new T.Vector3() }, uReach: { value: 22 } }, `
    precision highp float;
    precision highp sampler2DShadow;
    uniform sampler2D tDepth; uniform sampler2DShadow tShadow;
    uniform mat4 uInvVP; uniform mat4 uShadowM; uniform vec3 uCam; uniform vec3 uSunDir; uniform float uReach;
    varying vec2 vUv;
    float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
    void main(){
      float d = texture2D(tDepth, vUv).x;
      vec4 w = uInvVP * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      vec3 P = w.xyz / w.w;
      vec3 ray = P - uCam; float len = length(ray); vec3 dir = ray / len;
      float sky = step(0.99995, d);
      float seg = min(len, uReach);
      vec3 start = P - dir * seg;
      float j = ign(gl_FragCoord.xy);
      float acc = 0.0;
      for (int i = 0; i < 12; i++) {
        vec3 p = start + dir * seg * ((float(i) + j) / 12.0);
        vec4 sc = uShadowM * vec4(p, 1.0);
        sc.xyz /= sc.w;
        float inside = step(0.0, sc.x) * step(sc.x, 1.0) * step(0.0, sc.y) * step(sc.y, 1.0) * step(sc.z, 1.0);
        float lit = texture(tShadow, vec3(sc.xy, sc.z - 0.0015));
        acc += mix(1.0, lit, inside);
      }
      acc /= 12.0;
      gl_FragColor = vec4(acc * (seg / uReach) * (1.0 - sky), dot(dir, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
    }`);
  const shaftBlurMat = mat({ tMap: { value: null }, uTexel: { value: new T.Vector2() } }, `
    uniform sampler2D tMap; uniform vec2 uTexel; varying vec2 vUv;
    void main(){
      vec4 s = texture2D(tMap, vUv) * 0.2;
      s += texture2D(tMap, vUv + uTexel * vec2(1.5, 0.5)) * 0.2;
      s += texture2D(tMap, vUv + uTexel * vec2(-0.5, 1.5)) * 0.2;
      s += texture2D(tMap, vUv + uTexel * vec2(-1.5, -0.5)) * 0.2;
      s += texture2D(tMap, vUv + uTexel * vec2(0.5, -1.5)) * 0.2;
      gl_FragColor = s;
    }`);
  const downMat = mat({ tMap: { value: null }, uTexel: { value: new T.Vector2() } }, `
    uniform sampler2D tMap; uniform vec2 uTexel; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tMap, vUv + uTexel * vec2(1.0, 1.0)).rgb + texture2D(tMap, vUv + uTexel * vec2(-1.0, 1.0)).rgb
             + texture2D(tMap, vUv + uTexel * vec2(1.0, -1.0)).rgb + texture2D(tMap, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
      gl_FragColor = vec4(min(c * 0.25, vec3(6.0)), 1.0);
    }`);
  const gaussMat = mat({ tMap: { value: null }, uDir: { value: new T.Vector2() } }, `
    uniform sampler2D tMap; uniform vec2 uDir; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tMap, vUv).rgb * 0.2270270270;
      c += (texture2D(tMap, vUv + uDir * 1.3846153846).rgb + texture2D(tMap, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
      c += (texture2D(tMap, vUv + uDir * 3.2307692308).rgb + texture2D(tMap, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
      gl_FragColor = vec4(c, 1.0);
    }`);
  const compMat = mat({ tColor: { value: null }, tBlur: { value: null }, tShaft: { value: null }, tDepth: { value: null }, uNear: { value: 0.5 }, uFar: { value: 400 }, uFocus: { value: 24 }, uDofFar: { value: 1 }, uDofNear: { value: 1 }, uShaftK: { value: 0 }, uGlowK: { value: 0 }, uSunCol: { value: new T.Color() }, uVig: { value: 0.3 }, uSat: { value: 1.1 } }, `
    precision highp float;
    uniform sampler2D tColor; uniform sampler2D tBlur; uniform sampler2D tShaft; uniform sampler2D tDepth;
    uniform float uNear; uniform float uFar; uniform float uFocus; uniform float uDofFar; uniform float uDofNear; uniform float uShaftK; uniform float uGlowK; uniform float uVig; uniform float uSat;
    uniform vec3 uSunCol; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tColor, vUv);
      float zn = texture2D(tDepth, vUv).x * 2.0 - 1.0;
      float z = 2.0 * uNear * uFar / (uFar + uNear - zn * (uFar - uNear));
      float coc = max(smoothstep(uFocus * 1.45, uFocus * 3.4, z) * uDofFar, smoothstep(uFocus * 0.74, uFocus * 0.34, z) * uDofNear);
      vec3 col = mix(c.rgb, texture2D(tBlur, vUv).rgb, coc);
      vec4 s = texture2D(tShaft, vUv);
      float cosT = max(s.g * 2.0 - 1.0, 0.0);
      col += uSunCol * s.r * (0.4 + 0.6 * cosT * cosT) * uShaftK;
      col += uSunCol * pow(cosT, 8.0) * smoothstep(26.0, 130.0, z) * uGlowK;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = max(mix(vec3(l), col, uSat), vec3(0.0));
      vec2 q = vUv - 0.5;
      col *= 1.0 - uVig * smoothstep(0.18, 0.9, dot(q, q) * 2.0);
      gl_FragColor = vec4(col, c.a);
    }`);

  const pass = {
    enabled: true, needsSwap: true, clear: false, renderToScreen: false,
    setSize(w, h) {
      const qw = Math.max(2, Math.round(w / 4)), qh = Math.max(2, Math.round(h / 4));
      for (const r of [rtShaftA, rtShaftB, rtA, rtB]) r.setSize(qw, qh);
      shaftBlurMat.uniforms.uTexel.value.set(1 / qw, 1 / qh);
      downMat.uniforms.uTexel.value.set(1 / w, 1 / h);
      this.q = [qw, qh];
    },
    render(r, write, read) {
      try { this.run(r, write, read); } catch (e) { this.enabled = false; FX.err = e; console.error('fx disabled:', e); }
    },
    run(r, write, read) {
      const depth = read.depthTexture, ph = phases(), auto = r.autoClear;
      r.autoClear = true;
      const sd = sun.castShadow && sun.shadow && sun.shadow.map && sun.shadow.map.depthTexture;
      const shaftsOn = cfg.shafts > 0 && sd && sd.compareFunction !== null;
      const sunDir = shaftMat.uniforms.uSunDir.value.subVectors(sun.position, sun.target.position).normalize();
      if (shaftsOn) {
        const u = shaftMat.uniforms;
        u.tDepth.value = depth; u.tShadow.value = sd;
        u.uInvVP.value.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
        u.uShadowM.value.copy(sun.shadow.matrix); u.uCam.value.setFromMatrixPosition(cam.matrixWorld);
        draw(shaftMat, rtShaftA);
        shaftBlurMat.uniforms.tMap.value = rtShaftA.texture; draw(shaftBlurMat, rtShaftB);
      }
      const dofOn = cfg.dof > 0;
      if (dofOn) {
        downMat.uniforms.tMap.value = read.texture; draw(downMat, rtA);
        gaussMat.uniforms.tMap.value = rtA.texture; gaussMat.uniforms.uDir.value.set(1 / this.q[0], 0); draw(gaussMat, rtB);
        gaussMat.uniforms.tMap.value = rtB.texture; gaussMat.uniforms.uDir.value.set(0, 1 / this.q[1]); draw(gaussMat, rtA);
      }
      const c = compMat.uniforms, aim = dt.aimK || 0;
      c.tColor.value = read.texture; c.tBlur.value = rtA.texture; c.tShaft.value = rtShaftB.texture; c.tDepth.value = depth;
      c.uNear.value = cam.near; c.uFar.value = cam.far;
      c.uFocus.value = Math.max(6, Math.hypot(cam.position.x - H.nt.x, cam.position.y - (H.nt.y + 1), cam.position.z - H.nt.z));
      c.uDofFar.value = dofOn ? 0.85 * cfg.dof * (1 - aim) : 0; c.uDofNear.value = dofOn ? 0.9 * cfg.dof * (1 - 0.6 * aim) : 0;
      c.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity);
      c.uShaftK.value = shaftsOn ? cfg.shafts * (0.035 * ph.day + 0.055 * ph.gold + 0.015 * ph.night) : 0;
      c.uGlowK.value = cfg.glow * (0.06 * ph.day + 0.15 * ph.gold + 0.03 * ph.night);
      c.uVig.value = cfg.vignette; c.uSat.value = cfg.saturation;
      draw(compMat, write);
      r.autoClear = auto;
    },
    dispose() {}
  };
  function install() {
    const c = H.ji;
    if (!c || c.__fx) return;
    c.__fx = true;
    for (const t of [c.renderTarget1, c.renderTarget2]) { t.depthTexture = new T.DepthTexture(t.width, t.height); t.dispose(); }
    c.insertPass(pass, c.passes.length - 1);
    FX.installed = true;
  }

  // ---------- fire: campfires, embers, lights, night wisp ----------
  const glowTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; return t;
  })();
  const fireTime = { value: 0 };
  const flameMat = new T.ShaderMaterial({
    uniforms: { uTime: fireTime }, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false, toneMapped: false,
    vertexShader: `uniform float uTime; varying float vH;
      void main(){
        vec3 p = position; float h = clamp(p.y / 1.3 + 0.5, 0.0, 1.0); vH = h;
        float ph = modelMatrix[3].x * 1.7 + modelMatrix[3].z * 2.3;
        float s = 1.0 + 0.16 * sin(uTime * 11.0 + ph);
        p.xz *= s * (1.0 - 0.25 * h);
        p.x += sin(uTime * 9.0 + h * 7.0 + ph) * 0.13 * h;
        p.z += cos(uTime * 7.3 + h * 6.0 + ph * 1.3) * 0.13 * h;
        p.y += sin(uTime * 13.0 + ph) * 0.09 * h;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `varying float vH;
      void main(){
        vec3 col = mix(vec3(1.0, 0.78, 0.32) * 2.6, vec3(1.0, 0.24, 0.03) * 1.5, smoothstep(0.0, 0.8, vH));
        float a = (1.0 - smoothstep(0.5, 1.0, vH)) * 0.75;
        gl_FragColor = vec4(col * a, 1.0);
      }`
  });
  const flameGeo = new T.ConeGeometry(0.36, 1.3, 8, 5, true);
  const logGeo = new T.CylinderGeometry(0.09, 0.11, 1.15, 6), stoneGeo = new T.DodecahedronGeometry(0.2, 0);
  const logMat = new T.MeshLambertMaterial({ color: 0x3b2516, emissive: 0x3a1203 }), stoneMat = new T.MeshLambertMaterial({ color: 0x77736b });
  const EMB = 14;
  let fires = [], fireKey = '', embers = null, keyClock = 0;
  const lights = [0, 1].map(() => { const l = new T.PointLight(0xff8c3a, 0, 20, 2); l.visible = false; scene.add(l); return l; });
  const wisp = new T.Mesh(new T.IcosahedronGeometry(0.07, 1), new T.MeshBasicMaterial({ color: new T.Color().setRGB(3.2, 2.4, 1.3), fog: false, toneMapped: false }));
  const wispGlow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xffc98a, blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55, fog: false }));
  wispGlow.scale.setScalar(1.3); wisp.add(wispGlow); wisp.visible = false; scene.add(wisp);

  function buildFires() {
    for (const f of fires) scene.remove(f.group);
    if (embers) { scene.remove(embers); embers.geometry.dispose(); }
    fires = [];
    const spots = [[3.5, 2.5]];
    (H.Nt.camps || []).forEach((c) => { if (!c) return; const n = Math.hypot(c.x, c.z) || 1, sx = -c.x / n, sz = -c.z / n; spots.push([c.x - sz * 5.5 - sx * 1.5, c.z + sx * 5.5 - sz * 1.5]); });
    const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v = new T.Vector3(), one = new T.Vector3(1, 1, 1);
    for (const [x, z] of spots) {
      const y = Se(x, z);
      if (y < jn + 0.25) continue;
      const g = new T.Group(); g.position.set(x, y, z);
      const logs = new T.InstancedMesh(logGeo, logMat, 3);
      for (let i = 0; i < 3; i++) { e.set(Math.PI / 2 - 0.5, i * 2.094 + 0.3, 0, 'YXZ'); q.setFromEuler(e); v.set(Math.sin(i * 2.094 + 0.3) * 0.2, 0.3, Math.cos(i * 2.094 + 0.3) * 0.2); logs.setMatrixAt(i, m4.compose(v, q, one)); }
      const stones = new T.InstancedMesh(stoneGeo, stoneMat, 8);
      for (let i = 0; i < 8; i++) { const a = i * 0.785 + 0.2; e.set(i * 1.3, i * 2.1, i * 0.7); q.setFromEuler(e); v.set(Math.cos(a) * 0.78, 0.08, Math.sin(a) * 0.78); stones.setMatrixAt(i, m4.compose(v, q, one)); }
      const flame = new T.Mesh(flameGeo, flameMat); flame.position.y = 0.85;
      const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0xff7a2a, blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.4, fog: false }));
      glow.position.y = 0.8; glow.scale.setScalar(4.2);
      g.add(logs, stones, flame, glow); scene.add(g);
      fires.push({ x, z, y, group: g, glow, seed: x * 0.37 + z * 0.91 });
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(Math.max(1, fires.length) * EMB * 3), 3));
    embers = new T.Points(geo, new T.PointsMaterial({ color: new T.Color().setRGB(3.0, 1.1, 0.25), size: 0.16, map: glowTex, sizeAttenuation: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
    embers.frustumCulled = false; scene.add(embers);
    buildSmoke();
  }
  const flick = (t, s) => 0.78 + 0.13 * Math.sin(t * 11.3 + s) + 0.09 * Math.sin(t * 23.7 + s * 2.1) + 0.06 * Math.sin(t * 5.1 + s * 0.7);


  // ---------- soft particles, smoke, tree variety ----------
  const END = '\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';
  const airLight = { value: new T.Color(1, 1, 1) };
  // the game's debris and dust are 500 instanced cubes; draw the same instances as soft camera-facing puffs
  const puffMat = new T.ShaderMaterial({
    uniforms: { uLight: airLight }, transparent: true, depthWrite: false, fog: false,
    vertexShader: `varying vec2 vP; varying vec3 vC;
      void main(){
        vP = position.xy * 2.0;
        vec3 c = instanceMatrix[3].xyz; float s = length(instanceMatrix[0].xyz);
        float a = atan(instanceMatrix[0].z, instanceMatrix[0].x), ca = cos(a), sa = sin(a);
        #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
        #else
          vC = vec3(0.8);
        #endif
        vec4 mv = modelViewMatrix * vec4(c, 1.0);
        mv.xy += vec2(position.x * ca - position.y * sa, position.x * sa + position.y * ca) * s * 3.4;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uLight; varying vec2 vP; varying vec3 vC;
      void main(){
        float d = length(vP);
        float a = smoothstep(1.0, 0.15, d) * (0.72 + 0.28 * sin(vP.x * 4.3 + 1.0) * sin(vP.y * 5.1));
        float hot = smoothstep(0.72, 0.95, max(vC.r, max(vC.g, vC.b))) * step(vC.b, 0.8 * vC.r);
        vec3 col = mix(vC * uLight, vC * 2.2, hot);
        gl_FragColor = vec4(col, a * mix(0.6, 0.95, hot));` + END + `}`
  });
  let puffDone = false;
  function softenParticles() {
    const m = scene.children.find((o) => o.isInstancedMesh && o.geometry && o.geometry.type === 'BoxGeometry' && o.instanceMatrix.count === 500);
    if (!m) return;
    m.geometry = new T.PlaneGeometry(1, 1); m.material = puffMat; m.renderOrder = 5; puffDone = true;
  }
  // campfire smoke: a few soft billboards per fire, animated entirely in the shader
  const SMK = 9;
  const smokeMat = new T.ShaderMaterial({
    uniforms: { uTime: fireTime, uLight: airLight }, transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute float aSeed; uniform float uTime; varying vec2 vP; varying float vL; varying float vS;
      void main(){
        float life = fract(uTime * 0.085 + aSeed), sd = aSeed * 43.0;
        vec3 c = instanceMatrix[3].xyz;
        c.y += 1.3 + life * 6.5;
        c.x += (0.7 + sin(sd)) * life * life * 2.0 + sin(uTime * 0.6 + sd) * 0.3 * life;
        c.z += cos(sd * 1.7) * life * 0.9 + cos(uTime * 0.5 + sd * 2.0) * 0.3 * life;
        float s = mix(0.7, 3.6, life), a = sd + life * 1.6 * sign(sin(sd * 3.0)), ca = cos(a), sa = sin(a);
        vP = position.xy * 2.0; vL = life; vS = sd;
        vec4 mv = modelViewMatrix * vec4(c, 1.0);
        mv.xy += vec2(position.x * ca - position.y * sa, position.x * sa + position.y * ca) * s;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uLight; uniform float uTime; varying vec2 vP; varying float vL; varying float vS;
      void main(){
        float d = length(vP);
        float n = sin(vP.x * 3.1 + vS + uTime * 0.4) * sin(vP.y * 3.7 - vS) + 0.5 * sin(vP.x * 6.3 - vP.y * 5.1 + vS * 2.0);
        float a = smoothstep(1.0, 0.1, d) * smoothstep(-0.55, 0.5, n * 0.5 + (1.0 - d) * 0.9);
        a *= smoothstep(0.0, 0.1, vL) * (1.0 - smoothstep(0.4, 1.0, vL)) * 0.34;
        vec3 col = vec3(0.56, 0.57, 0.6) * uLight + vec3(1.0, 0.42, 0.12) * pow(1.0 - vL, 4.0) * 0.7;
        gl_FragColor = vec4(col, a);` + END + `}`
  });
  let smoke = null;
  function buildSmoke() {
    if (smoke) { scene.remove(smoke); smoke.geometry.dispose(); smoke = null; }
    if (!fires.length) return;
    const g = new T.PlaneGeometry(1, 1), n = fires.length * SMK, seeds = new Float32Array(n), m4 = new T.Matrix4();
    smoke = new T.InstancedMesh(g, smokeMat, n);
    fires.forEach((f, i) => { for (let k = 0; k < SMK; k++) { const j = i * SMK + k; seeds[j] = (k + ((f.seed * 7.13 + k * 0.37) % 1 + 1) % 1 * 0.6) / SMK; smoke.setMatrixAt(j, m4.makeTranslation(f.x, f.y, f.z)); } });
    g.setAttribute('aSeed', new T.InstancedBufferAttribute(seeds, 1));
    smoke.frustumCulled = false; smoke.renderOrder = 6; scene.add(smoke);
  }
  // trees share one model per species; reshape each one in the vertex shader from its position (height, crown width, lean, lumps)
  // Per-tree variation that keeps trees believable: crowns a little wider or narrower, trees a little taller
  // or shorter, and a slight straight lean (a trunk stays straight; it never curves). No wobble or warping.
  const TREE_VARY = `
      {
        #ifdef USE_INSTANCING
          vec2 tv = instanceMatrix[3].xz;
        #else
          vec2 tv = modelMatrix[3].xz;
        #endif
        float t1 = fract(sin(dot(tv, vec2(12.9898, 78.233))) * 43758.5453);
        float t2 = fract(t1 * 37.71 + 0.31), t3 = fract(t1 * 91.17 + 0.67), t4 = fract(t1 * 53.3 + 0.13);
        float crown = smoothstep(0.9, 2.4, transformed.y);
        transformed.xz *= mix(1.0, mix(0.86, 1.16, t3), crown);
        transformed.y *= mix(0.9, 1.1, t2);
        float la = t1 * 6.2831;
        transformed.xz += vec2(cos(la), sin(la)) * transformed.y * 0.035 * t4 * t4;
      }`;
  let treeDone = false;
  function varyTrees() {
    let mesh = null;
    scene.traverse((o) => { if (!mesh && o.isInstancedMesh && o.customDepthMaterial && o.castShadow) mesh = o; });
    if (!mesh) return;
    for (const m of [mesh.material, mesh.customDepthMaterial]) {
      if (!m || m.__fxVary) continue;
      m.__fxVary = true;
      const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
      m.onBeforeCompile = function (sh, r) { if (prev) prev.call(this, sh, r); sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>' + TREE_VARY); };
      m.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|vary2'; };
      m.needsUpdate = true;
    }
    treeDone = true;
  }

  // ---------- character models: procedural JRPG-style bodies, one skinned cel-shaded mesh each ----------
  // The game's block rig keeps running underneath and drives this body's bones every frame. The blocks keep
  // their original geometry (userData.fxBox), so 'blocks' mode restores the original models exactly.
  // The generator is split into pieces (torso, arms, legs, head, painted face, hair) inside makeBody().
  let charStyle = 'anime';
  try { charStyle = localStorage.getItem('fx-characters') === 'blocks' ? 'blocks' : 'anime'; } catch (e) {}
  const EMPTY = new T.BufferGeometry(); EMPTY.setAttribute('position', new T.BufferAttribute(new Float32Array(9), 3));
  const boxOf = (m) => m.isMesh && m.geometry && m.geometry.type === 'BoxGeometry' ? m.geometry.parameters : null;
  const limbBox = (group) => { let best = null; if (group) for (const c of group.children) { const q = boxOf(c); if (q && q.height >= 2.2 * Math.max(q.width, q.depth) && Math.abs(c.position.x) < 0.03 && Math.abs(c.position.y + q.height / 2) < 0.06 && (!best || q.height > best.geometry.parameters.height)) best = c; } return best; };
  const chars = new Map();

  // Procedural JRPG-style character: one skinned mesh, vertex colours plus a painted face texture.
  // makeBody(T, opt) -> { geo, defs (bone table), faceTex }.  y up, facing +z, about 1.6 units tall.
  function makeBody(T, opt) {
    const o = Object.assign({ skin: '#f2c9a5', tunic: '#2a6b73', pants: '#3b3247', sleeve: null, boot: null, hair: '#6b3e22', accent: '#c9482e', belt: '#5a3a22', eye: '#3d6fb5', goblin: false, hairStyle: 0, lean: 0, cape: null, tabard: null, pauldron: null, glove: null, eyeType: 0, mouthType: 0, seed: 1 }, opt);
    const shade = (h, k) => '#' + new T.Color(h).multiplyScalar(k).getHexString();
    const tone = (h, sat, lum) => { if (!h) return h; const c = new T.Color(h), q = {}; c.getHSL(q); return '#' + c.setHSL(q.h, q.s * sat, Math.min(0.92, q.l * lum)).getHexString(); };
    o.sleeve = o.sleeve || o.tunic; o.boot = o.boot || shade(o.pants, 0.6);
    if (!o.goblin) { for (const k of ['tunic', 'sleeve', 'pants', 'boot', 'accent', 'cape']) o[k] = tone(o[k], 0.8, 0.84); o.hair = tone(o.hair, 0.85, 1); o.belt = tone(o.belt, 0.8, 0.95); }
    else for (const k of ['skin', 'tunic', 'sleeve', 'pants', 'boot', 'accent']) o[k] = tone(o[k], 0.8, 0.95);
    const pos = [], col = [], uv = [], si = [], sw = [], idx = [], c = new T.Color(), WHITE = new T.Color(1, 1, 1);
    const ring = (r, N) => {
      const e = r.e || 1, w = r.w, zf = r.rzf !== undefined ? r.rzf : r.rz, zb = r.rzb !== undefined ? r.rzb : r.rz;
      c.set(r.color); if (r.k) c.multiplyScalar(r.k); if (r.hi) c.lerp(WHITE, r.hi);
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), px = Math.sign(ca) * Math.pow(Math.abs(ca), e), pz = Math.sign(sa) * Math.pow(Math.abs(sa), e);
        if (r.u) pos.push(r.c[0] + r.u[0] * px + r.v[0] * pz, r.c[1] + r.u[1] * px + r.v[1] * pz, r.c[2] + r.u[2] * px + r.v[2] * pz);
        else pos.push(r.c[0] + r.rx * px, r.c[1], r.c[2] + (pz > 0 ? zf : zb) * pz);
        col.push(c.r, c.g, c.b); uv.push(0.02, 0.02);
        si.push(w[0], w.length > 2 ? w[2] : 0, 0, 0); sw.push(w.length > 2 ? w[1] : 1, w.length > 2 ? 1 - w[1] : 0, 0, 0);
      }
    };
    const tube = (rings, N = 12) => {
      const base = pos.length / 3, first = idx.length;
      rings.forEach((r) => ring(r, N));
      for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < N; k++) { const p0 = base + i * N + k, p1 = base + i * N + (k + 1) % N; idx.push(p0, p0 + N, p1, p1, p0 + N, p1 + N); }
      const q = rings[rings.length >> 1].c; let vol = 0;
      for (let t = first; t < idx.length; t += 3) {
        const A = idx[t] * 3, B = idx[t + 1] * 3, C = idx[t + 2] * 3, ax = pos[A] - q[0], ay = pos[A + 1] - q[1], az = pos[A + 2] - q[2], bx = pos[B] - q[0], by = pos[B + 1] - q[1], bz = pos[B + 2] - q[2], cx = pos[C] - q[0], cy = pos[C + 1] - q[1], cz = pos[C + 2] - q[2];
        vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
      }
      if (vol < 0) for (let t = first; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
    };
    const blob = (c0, r, color, bone, N = 8, band = 0) => { const rs = []; for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI, s = Math.max(0.03, Math.sin(a)); rs.push({ c: [c0[0], c0[1] - r[1] * Math.cos(a), c0[2]], rx: r[0] * s, rz: r[2] * s, color, hi: i === 6 ? band : 0, w: [bone] }); } tube(rs, N); };
    // a flattened, tapering lock of hair (or an ear, a thumb) swept along a few points
    const lock = (pts, wid, thick, color, bone, N = 6, sheen = 0) => {
      const curve = new T.CatmullRomCurve3(pts.map((p) => new T.Vector3(p[0], p[1], p[2]))), M = 6, rs = [], out = new T.Vector3(), tan = new T.Vector3(), u = new T.Vector3(), v = new T.Vector3();
      for (let i = 0; i <= M; i++) {
        const t = i / M, p = curve.getPoint(t); curve.getTangent(t, tan);
        out.set(p.x, 0, p.z + 0.02).normalize(); u.crossVectors(tan, out).normalize(); v.crossVectors(u, tan).normalize();
        const k = Math.max(0.04, Math.sin(Math.min(1, t * 2.6 + 0.3) * Math.PI / 2) * (1 - t * t * 0.96));
        rs.push({ c: [p.x, p.y, p.z], u: [u.x * wid * k, u.y * wid * k, u.z * wid * k], v: [v.x * thick * k, v.y * thick * k, v.z * thick * k], color, hi: i === 2 ? sheen : 0, k: i >= M - 1 ? 0.86 : 0, w: [bone] });
      }
      tube(rs, N);
    };
    const G = o.goblin, HS = G ? 1.6 : 1.75;            // head size against a 1.6-unit body; goblins larger still
    const TW = 1.04, TD = 1.1, AT = 1.14, LT = 1.16, LEG = 0.72, TOR = 0.84, BX = 0.82, GOLD = '#d4b057'; // stout build: wider torso, thicker limbs, shorter legs
    // 'homestead' style: work clothes instead of the fantasy kit. Shirt tucked into bib overalls, sleeves rolled
    // to the elbow, bare forearms and hands, plain boots, a neckerchief, and a straw hat hung on the back.
    const HOME = o.style === 'homestead' && !G;
    const CUFF = HOME ? shade(o.sleeve, 0.8) : GOLD, WRIST = HOME ? o.skin : GOLD, STRAW = '#d8ba6c';
    const hipY = 0.8, hipX = 0.086, kneeY = 0.43, shY = 1.27, shX = 0.176, elbow = 0.25, wrist = 0.47, chestY = 1.05, neckY = 1.33, HC0 = 1.47, HY = HC0 + (HS - 1) * 0.1;
    const zl = (y) => o.lean * Math.max(0, y - hipY);
    const defs = [[-1, 0, hipY, 0], [0, 0, chestY, zl(chestY)], [1, 0, neckY, zl(neckY)], [1, -shX, shY, zl(shY)], [3, -shX, shY - elbow, zl(shY)], [1, shX, shY, zl(shY)], [5, shX, shY - elbow, zl(shY)], [0, -hipX, hipY, 0], [7, -hipX, kneeY, 0], [0, hipX, hipY, 0], [9, hipX, kneeY, 0]];
    const bl = (y, a, b) => Math.min(1, Math.max(0, (y - a) / (b - a)));
    // ---- torso ----
    const wide = (y, k) => 1 + (k - 1) * bl(1.335 - y, 0, 0.04);
    const tr = (y, rx, zf, zb, color, e) => { if (HOME && y < 0.968) { color = o.pants; if (y < 0.918) { const f = y < 0.76 ? 0.22 : 0.5 + 0.4 * bl(y, 0.56, 0.9); rx *= f; zf *= f; zb *= f; } } return tr0(y, rx, zf, zb, color, e); };
    const tr0 = (y, rx, zf, zb, color, e) => ({ c: [0, y, zl(y)], rx: rx * wide(y, TW), rzf: zf * wide(y, TD), rzb: zb * wide(y, TD), color, k: color === T_ ? 0.82 + 0.18 * bl(y, 0.58, 1.1) : 0, e: e || 0.92, w: [1, bl(y, hipY + 0.04, chestY + 0.06), 0] });
    const T_ = o.tunic;
    const HEM = G ? shade(T_, 1.5) : GOLD;
    tube([tr(0.555, 0.01, 0.01, 0.01, HEM), tr(0.56, 0.222, 0.16, 0.182, HEM), tr(0.59, 0.217, 0.157, 0.178, HEM), tr(0.595, 0.216, 0.156, 0.177, T_), tr(0.66, 0.2, 0.146, 0.164, T_), tr(0.74, 0.182, 0.133, 0.148, T_), tr(0.82, 0.166, 0.122, 0.134, T_), tr(0.915, 0.132, 0.1, 0.106, T_), tr(0.92, 0.136, 0.104, 0.11, o.belt), tr(0.965, 0.134, 0.103, 0.108, o.belt), tr(0.97, 0.122, 0.092, 0.097, T_),
      tr(1.04, 0.128, 0.099, 0.098, T_), tr(1.12, 0.148, 0.116, 0.104, T_), tr(1.2, 0.15, 0.114, 0.104, T_), tr(1.255, 0.146, 0.096, 0.098, T_), tr(1.29, 0.12, 0.078, 0.088, T_), tr(1.312, 0.085, 0.064, 0.072, T_),
      tr(1.318, 0.066, 0.058, 0.064, o.accent), tr(1.345, 0.058, 0.054, 0.058, o.accent), tr(1.35, 0.043, 0.042, 0.045, shade(o.skin, 0.86)), { c: [0, 1.4, zl(1.4)], rx: 0.04, rz: 0.04, color: shade(o.skin, 0.86), w: [2] }, { c: [0, 1.41, zl(1.4)], rx: 0.004, rz: 0.004, color: o.skin, w: [2] }], 16);
    for (const s of [-1, 1]) {
      // ---- arm ----
      const ua = s < 0 ? 3 : 5, fa = ua + 1, x = s * shX, z = zl(shY);
      const ar = (d, rx, rz, color, w, dx) => { const k = d > 0.47 ? 1.2 : AT; return { c: [x + (dx || 0) * s, shY - d, z], rx: rx * k, rz: rz * k, color, w }; };
      const SL = o.sleeve, K = o.glove || o.skin, BR = HOME ? o.skin : o.glove || o.accent, US = G ? o.sleeve : HOME ? o.skin : (o.shirt || '#d6ccb6');
      tube([ar(-0.03, 0.004, 0.004, SL, [1, 0.6, ua], -0.03), ar(-0.022, 0.03, 0.036, SL, [1, 0.55, ua], -0.024), ar(0.005, 0.045, 0.05, SL, [1, 0.3, ua], -0.01), ar(0.05, 0.047, 0.051, SL, [ua]), ar(0.12, 0.047, 0.051, SL, [ua]), ar(0.165, 0.046, 0.05, SL, [ua]), ar(0.168, 0.048, 0.052, G ? SL : CUFF, [ua]), ar(0.19, 0.047, 0.051, G ? SL : CUFF, [ua, 0.85, fa]), ar(0.193, 0.039, 0.042, US, [ua, 0.85, fa]),
        ar(elbow - 0.02, 0.038, 0.04, US, [ua, 0.6, fa]), ar(elbow + 0.02, 0.038, 0.04, US, [ua, 0.3, fa]), ar(0.31, 0.039, 0.042, US, [fa]), ar(0.335, 0.037, 0.04, US, [fa]), ar(0.34, 0.042, 0.045, BR, [fa]), ar(0.4, 0.038, 0.04, BR, [fa]), ar(0.455, 0.035, 0.037, BR, [fa]), ar(0.46, 0.037, 0.039, G ? shade(BR, 1.3) : WRIST, [fa]), ar(0.469, 0.036, 0.038, G ? shade(BR, 1.3) : WRIST, [fa]), ar(0.4695, 0.024, 0.027, K, [fa]),
        ar(wrist + 0.02, 0.02, 0.03, K, [fa]), ar(wrist + 0.06, 0.02, 0.037, K, [fa]), ar(wrist + 0.1, 0.017, 0.032, K, [fa]), ar(wrist + 0.135, 0.011, 0.02, K, [fa]), ar(wrist + 0.142, 0.003, 0.004, K, [fa])], 10);
      lock([[x, shY - wrist - 0.03, z + 0.027], [x - s * 0.008, shY - wrist - 0.065, z + 0.052], [x - s * 0.012, shY - wrist - 0.1, z + 0.056]], 0.014, 0.014, K, fa, 5);
      // ---- leg and boot ----
      const th = s < 0 ? 7 : 9, sh = th + 1, lx = s * hipX, PA = o.pants, BT = o.boot;
      const lr = (y, rx, zf, zb, color, w, dx) => { const boot = color !== PA, k = boot ? 1.42 : LT; return { c: [lx + (dx || 0) * s, y, 0], rx: rx * k, rzf: zf * (boot && y < 0.07 ? 1.18 : k), rzb: zb * k, color, k: !boot ? 0.8 + 0.2 * bl(0.74 - y, 0, 0.2) : 0, w }; };
      tube([lr(0.9, 0.004, 0.004, 0.004, PA, [0, 0.7, th]), lr(0.88, 0.055, 0.07, 0.075, PA, [0, 0.6, th], -0.005), lr(0.8, 0.068, 0.08, 0.085, PA, [0, 0.2, th]), lr(0.7, 0.072, 0.08, 0.08, PA, [th]), lr(0.58, 0.066, 0.068, 0.068, PA, [th]), lr(kneeY + 0.06, 0.056, 0.06, 0.055, PA, [th, 0.85, sh]),
        lr(kneeY, 0.053, 0.058, 0.052, PA, [th, 0.5, sh]), lr(kneeY - 0.045, 0.051, 0.05, 0.055, PA, [th, 0.15, sh]), lr(0.39, 0.05, 0.048, 0.058, PA, [sh]), lr(0.4, 0.05, 0.05, 0.056, G ? shade(BT, 1.7) : HOME ? shade(BT, 1.35) : GOLD, [sh]), lr(0.405, 0.06, 0.06, 0.068, G ? shade(BT, 1.7) : HOME ? shade(BT, 1.35) : GOLD, [sh]), lr(0.39, 0.061, 0.061, 0.069, G ? shade(BT, 1.7) : HOME ? shade(BT, 1.35) : GOLD, [sh]), lr(0.386, 0.061, 0.061, 0.069, shade(BT, 1.7), [sh]), lr(0.345, 0.062, 0.062, 0.07, shade(BT, 1.7), [sh]), lr(0.34, 0.054, 0.052, 0.064, BT, [sh]), lr(0.22, 0.044, 0.043, 0.05, BT, [sh]),
        lr(0.11, 0.038, 0.04, 0.04, BT, [sh]), lr(0.06, 0.042, 0.075, 0.045, BT, [sh]), lr(0.02, 0.046, 0.14, 0.05, BT, [sh]), lr(0.0, 0.04, 0.13, 0.044, shade(BT, 0.7), [sh]), lr(-0.002, 0.004, 0.02, 0.004, shade(BT, 0.7), [sh])], 10);
    }
    // ---- head ----
    const hz = zl(neckY) + 0.012, hd = (y, rx, zf, zb, zc) => ({ c: [0, HY + (y - HC0) * HS, hz + zc * HS], rx: rx * HS, rzf: zf * HS, rzb: zb * HS, color: o.skin, e: 0.95, w: [2] });
    const HR = [[1.335, 0.01, 0.01, 0.01, 0.062], [1.342, 0.03, 0.026, 0.035, 0.056], [1.36, 0.058, 0.05, 0.068, 0.044], [1.385, 0.08, 0.071, 0.09, 0.03], [1.415, 0.094, 0.086, 0.103, 0.017], [1.455, 0.103, 0.093, 0.113, 0.006], [1.5, 0.106, 0.095, 0.118, 0], [1.545, 0.1, 0.09, 0.113, -0.002], [1.578, 0.08, 0.072, 0.092, -0.004], [1.595, 0.045, 0.04, 0.052, -0.005], [1.602, 0.005, 0.005, 0.005, -0.005]];
    tube(HR.map((h) => hd(...h)), 16);
    const hp = (x, y, z) => [x * HS, HY + (y - HC0) * HS, hz + z * HS];
    // front surface depth of the head at (x, y), for laying the face on it
    const faceZ = (x, y) => { let i = 0; while (i < HR.length - 2 && HR[i + 1][0] < y) i++; const a = HR[i], b = HR[i + 1], t = bl(y, a[0], b[0]), rx = a[1] + (b[1] - a[1]) * t, zf = a[2] + (b[2] - a[2]) * t, zc = a[4] + (b[4] - a[4]) * t; return zc + zf * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(x) / rx), 2 / 0.95)), 0.95 / 2); };
    for (const s of [-1, 1]) {
      if (G) lock([hp(s * 0.095, 1.45, 0.0), hp(s * 0.17, 1.5, -0.02), hp(s * 0.24, 1.56, -0.05)], 0.05, 0.016, o.skin, 2);
      else blob(hp(s * 0.104, 1.445, 0.012), [0.014, 0.03, 0.02], o.skin, 2, 6);
    }
    // face: a patch laid on the front of the head, textured with painted eyes, brows and mouth
    { const base = pos.length / 3, NX = 8, NY = 7, x0 = -0.088, x1 = 0.088, y0 = 1.352, y1 = 1.54;
      for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) { const x = x0 + (x1 - x0) * i / NX, y = y0 + (y1 - y0) * j / NY, p = hp(x, y, faceZ(x, y) + 0.0025); pos.push(p[0], p[1], p[2]); col.push(1, 1, 1); uv.push(0.1 + 0.9 * i / NX, 0.1 + 0.9 * j / NY); si.push(2, 0, 0, 0); sw.push(1, 0, 0, 0); }
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const a = base + j * (NX + 1) + i, b = a + 1, d = a + NX + 1, e = d + 1; idx.push(a, b, d, b, e, d); } }
    // ---- hair ----
    // Built the way anime hair is drawn in 2D: decide the crown, then split the hair into a few big tapering
    // clumps that all flow from it. Here each clump is a "petal" of one continuous shell over the skull: petals
    // sit edge to edge near the crown (a clean dome with crease lines between them) and separate into pointed
    // tips toward the hem. Bangs are simply the front petals. A shorter second layer on top gives the layered cut.
    if (!G) {
      const H = o.hair, HCc = [0, 1.5, -0.008], HRd = [0.113, 0.116, 0.124], TH_E = 1.3, TILT = -0.22, ct_ = Math.cos(TILT), st_ = Math.sin(TILT);
      const skull = (th, ph) => {
        const t = Math.min(th, TH_E), sn = Math.sin(t), d0 = [sn * Math.sin(ph), Math.cos(t), sn * Math.cos(ph)], d = [d0[0], d0[1] * ct_ - d0[2] * st_, d0[1] * st_ + d0[2] * ct_];
        const n = new T.Vector3(d[0] / HRd[0], th > TH_E ? 0 : d[1] / HRd[1], d[2] / HRd[2]).normalize();
        return { p: new T.Vector3(HCc[0] + d[0] * HRd[0], HCc[1] + d[1] * HRd[1] - Math.max(0, th - TH_E) * HRd[1], HCc[2] + d[2] * HRd[2]), n };
      };
      const sstep = (a0, b0, x) => { const t = Math.min(1, Math.max(0, (x - a0) / (b0 - a0))); return t * t * (3 - 2 * t); };
      const hc = new T.Color(), hcen = hp(0, 1.5, 0);
      let petalN = 0;
      // one petal: ph centre, hw half-width (radians), th0..th1 crown to tip, tip: where across the petal the point falls (-1..1),
      // lift: how far the tip stands off the head, sweep: sideways drift toward the tip, off: height of this layer, bulge: roundness
      const petal = (ph, hw, th0, th1, tip, lift, sweep, off, bulge) => {
        const NU = 6, NV = 11, tone = 0.95 + 0.09 * (((petalN++) * 0.618) % 1);
        for (const inner of [0, 1]) {
          const base = pos.length / 3, first = idx.length;
          for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
            const t = j / NV, a = (i / NU) * 2 - 1, th = th0 + t * (th1 - th0);
            const wt = (t < 0.5 ? 1 : 1 - Math.pow((t - 0.5) / 0.5, 1.7)) * 1.07, pc = ph + tip * hw * sstep(0.4, 1, t) + sweep * t * t;
            const q = skull(th, pc + a * hw * wt), g = sstep(0, 0.4, t) * (1 - 0.55 * sstep(0.75, 1, t));
            const r = off + bulge * (1 - a * a) * g + lift * t * t * t - (inner ? 0.011 * (1 - 0.7 * t) : 0);
            q.p.addScaledVector(q.n, r); const P3 = hp(q.p.x, q.p.y, q.p.z);
            pos.push(P3[0], P3[1], P3[2]);
            hc.set(H).multiplyScalar(inner ? 0.58 : tone * (0.86 + 0.14 * (1 - Math.pow(Math.abs(a), 3))) * (t > 0.85 ? 0.9 : 1));
            if (!inner && th > 0.72 && th < 1.0) hc.lerp(WHITE, 0.16 * Math.sin((th - 0.72) / 0.28 * Math.PI));          // the sheen ring, at one height all the way round
            col.push(hc.r, hc.g, hc.b); uv.push(0.02, 0.02); si.push(2, 0, 0, 0); sw.push(1, 0, 0, 0);
          }
          for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const p0 = base + j * (NU + 1) + i, p1 = p0 + 1, p2 = p0 + NU + 1, p3 = p2 + 1; idx.push(p0, p2, p1, p1, p2, p3); }
          // outer faces look away from the head, inner faces toward it
          const A = idx[first] * 3, B = idx[first + 1] * 3, C = idx[first + 2] * 3;
          const ux = pos[B] - pos[A], uy = pos[B + 1] - pos[A + 1], uz = pos[B + 2] - pos[A + 2], vx = pos[C] - pos[A], vy = pos[C + 1] - pos[A + 1], vz = pos[C + 2] - pos[A + 2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, out = nx * (pos[A] - hcen[0]) + ny * (pos[A + 1] - hcen[1]) + nz * (pos[A + 2] - hcen[2]);
          if ((out < 0) !== !!inner) for (let t = first; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
        }
      };
      blob(hp(0, 1.512, -0.034), [0.113 * HS, 0.105 * HS, 0.113 * HS], shade(H, 0.55), 2, 14);   // dark hair seen through the gaps (kept behind the forehead)
      blob(hp(0, 1.44, -0.034), [0.09 * HS, 0.092 * HS, 0.104 * HS], shade(H, 0.55), 2, 12);     // and down the back of the head to the nape
      // Every clump is authored separately, as a 2D artist would vary them: big next to small, long next to
      // short, tips leaning different ways, a thin stray strand here and there. A per-character seed then
      // nudges each one a little so two characters with the same style still differ.
      let rs_ = (o.seed * 2654435761) >>> 0; const rnd = () => { rs_ = (rs_ + 0x6D2B79F5) >>> 0; let t = rs_; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const jit = (v, k) => v * (1 + k * (rnd() * 2 - 1));
      // rows are [ph, hw, th1, tip, lift, sweep]
      const lay = (rows, th0, off, bulge) => rows.forEach(([ph, hw, th1, tip, lift, sweep]) => petal(ph, jit(hw, 0.07), th0, jit(th1, 0.03), tip + (rnd() - 0.5) * 0.2, jit(lift, 0.18), (sweep || 0) + (rnd() - 0.5) * 0.03, off, bulge));
      const st = o.hairStyle;
      if (st === 1) {            // long: curtain bangs, face-framing locks, layered ends down the back
        lay([[-0.86, 0.2, 2.75, 0.55, -0.004, 0.04], [-0.5, 0.2, 2.34, -0.1, -0.004], [-0.2, 0.13, 2.0, -0.55, -0.004, -0.05], [0.22, 0.15, 2.04, 0.5, -0.004, 0.05], [0.54, 0.21, 2.4, 0.25, -0.004], [0.88, 0.19, 2.68, -0.5, -0.004, -0.04]], 0.06, 0.012, 0.012);
        lay([[0.02, 0.07, 1.86, -0.3, -0.002]], 0.06, 0.017, 0.006);
        lay([[-1.22, 0.22, 4.1, 0.5, -0.012], [1.2, 0.25, 3.8, -0.5, -0.012]], 0.06, 0.01, 0.012);
        lay([[1.66, 0.26, 4.25, -0.3, 0.012], [2.14, 0.3, 4.75, 0.5, 0.028], [2.72, 0.34, 4.45, -0.55, 0.016], [3.3, 0.3, 4.9, 0.35, 0.03], [3.86, 0.3, 4.35, -0.45, 0.014], [4.46, 0.36, 4.65, 0.5, 0.024]], 0.06, 0.01, 0.013);
        lay([[2.45, 0.08, 5.0, 0, 0.03], [3.62, 0.07, 4.6, 0, 0.02]], 0.9, 0.016, 0.006);
        lay([[1.5, 0.38, 1.66, 0.5, 0.014], [2.15, 0.3, 1.52, -0.4, 0.008], [2.7, 0.42, 1.74, 0.3, 0.02], [3.35, 0.32, 1.56, -0.5, 0.01], [3.95, 0.4, 1.7, 0.45, 0.016], [4.6, 0.34, 1.5, -0.35, 0.008]], 0.05, 0.024, 0.016);
      } else if (st === 2) {     // neat: bangs brushed to one side, short ends
        lay([[-0.84, 0.18, 2.16, 0.5, -0.004, 0.2], [-0.52, 0.22, 2.1, 0.6, -0.004, 0.24], [-0.14, 0.26, 2.02, 0.6, -0.004, 0.26], [0.3, 0.24, 1.94, 0.5, -0.004, 0.22], [0.7, 0.18, 2.14, -0.4, -0.004, 0.06]], 0.06, 0.012, 0.012);
        lay([[0.1, 0.07, 2.12, 0.4, -0.002, 0.24]], 0.06, 0.017, 0.006);
        lay([[-1.2, 0.24, 2.42, 0.5, -0.022], [1.2, 0.26, 2.56, -0.5, -0.02]], 0.06, 0.01, 0.012);
        lay([[1.66, 0.26, 2.3, -0.3, 0.008], [2.14, 0.3, 2.46, 0.5, 0.016], [2.72, 0.34, 2.34, -0.55, 0.01], [3.3, 0.3, 2.5, 0.35, 0.018], [3.86, 0.3, 2.32, -0.45, 0.008], [4.46, 0.36, 2.44, 0.5, 0.014]], 0.06, 0.01, 0.013);
        lay([[1.5, 0.38, 1.76, 0.5, 0.026], [2.15, 0.3, 1.6, -0.4, 0.014], [2.7, 0.42, 1.82, 0.3, 0.03], [3.35, 0.32, 1.64, -0.5, 0.018], [3.95, 0.4, 1.78, 0.45, 0.028], [4.6, 0.34, 1.6, -0.35, 0.014]], 0.05, 0.024, 0.016);
      } else {                   // short and spiky: forelock between the eyes, uneven bangs, flicked ends, layered spikes
        lay([[-0.92, 0.17, 2.42, 0.6, -0.004, 0.05], [-0.56, 0.24, 2.02, -0.5, -0.004, -0.03], [-0.2, 0.15, 2.22, 0.4, -0.004, 0.04], [0.06, 0.13, 2.5, 0.2, -0.004, 0.03], [0.4, 0.26, 2.08, 0.55, -0.004, 0.06], [0.8, 0.16, 2.3, -0.5, -0.004, -0.04]], 0.06, 0.012, 0.012);
        lay([[0.62, 0.07, 2.2, 0, -0.002]], 0.06, 0.017, 0.006);
        lay([[-1.22, 0.22, 2.85, 0.6, -0.022], [1.2, 0.26, 2.7, -0.5, -0.02]], 0.06, 0.01, 0.012);
        lay([[1.66, 0.26, 2.42, -0.3, 0.03], [2.14, 0.3, 2.66, 0.5, 0.05], [2.72, 0.34, 2.5, -0.55, 0.035], [3.3, 0.3, 2.72, 0.35, 0.055], [3.86, 0.3, 2.46, -0.45, 0.03], [4.46, 0.36, 2.6, 0.5, 0.045]], 0.06, 0.01, 0.013);
        lay([[2.45, 0.08, 2.82, 0, 0.07], [3.6, 0.07, 2.76, 0, 0.06]], 0.9, 0.016, 0.006);
        lay([[1.5, 0.38, 1.9, 0.5, 0.08], [2.15, 0.3, 1.7, -0.4, 0.05], [2.7, 0.42, 2.0, 0.3, 0.1], [3.35, 0.32, 1.76, -0.5, 0.06], [3.95, 0.4, 1.95, 0.45, 0.09], [4.6, 0.34, 1.72, -0.35, 0.055]], 0.05, 0.024, 0.016);
        lay([[-0.5, 0.3, 1.15, 0.3, 0.006], [0.45, 0.34, 1.05, -0.3, 0.004]], 0.05, 0.026, 0.012);
        petal(0.5, 0.2, 0.04, 0.5, 0.6, 0.055, 0.5, 0.03, 0.006);                               // one stray lock at the crown
      }
    }
    // ---- outfit pieces ----
    const TF = [[0.56, 0.16], [0.6, 0.156], [0.66, 0.146], [0.74, 0.133], [0.82, 0.122], [0.915, 0.1], [0.92, 0.104], [0.965, 0.103], [0.97, 0.092], [1.04, 0.099], [1.12, 0.116], [1.2, 0.114], [1.255, 0.096], [1.29, 0.078]];
    const torsoFront = (y) => { let i = 0; while (i < TF.length - 2 && TF[i + 1][0] < y) i++; const t = bl(y, TF[i][0], TF[i + 1][0]); return zl(y) + (TF[i][1] + (TF[i + 1][1] - TF[i][1]) * t) * wide(y, TD); };
    const tw = (y) => [1, bl(y, hipY + 0.04, chestY + 0.06), 0];
    if (!G && !HOME) {
      blob([0, 0.942, zl(0.942) + 0.104 * TD + 0.004], [0.03, 0.028, 0.013], GOLD, 0, 6);                       // belt buckle
      blob([0.13 * TW, 0.875, zl(0.875) + 0.06], [0.04, 0.05, 0.036], shade(o.belt, 1.25), 0, 6);                    // belt pouch
    }
    if (HOME) {
      const OV = o.pants, SEAM = shade(o.pants, 0.78), BRASS = '#c9a24a';
      const TB = [[0.92, 0.11], [1.04, 0.098], [1.12, 0.104], [1.2, 0.104], [1.255, 0.098], [1.29, 0.088], [1.312, 0.072]];
      const torsoBack = (y) => { let i = 0; while (i < TB.length - 2 && TB[i + 1][0] < y) i++; const t = bl(y, TB[i][0], TB[i + 1][0]); return zl(y) - (TB[i][1] + (TB[i + 1][1] - TB[i][1]) * t) * wide(y, TD); };
      // bib: a panel up the chest with a darker top hem, a pocket and two brass buttons
      { const rs = [], ys = [0.93, 0.936, 0.99, 1.06, 1.13, 1.18, 1.2, 1.206];
        ys.forEach((y, i) => { const edge = i === 0 || i === ys.length - 1; rs.push({ c: [0, y, torsoFront(y) + 0.004], rx: edge ? 0.004 : 0.092 - 0.012 * bl(y, 0.95, 1.2), rz: edge ? 0.002 : 0.01, color: y > 1.17 ? SEAM : OV, w: tw(y) }); });
        tube(rs, 8); }
      blob([0, 1.075, torsoFront(1.075) + 0.013], [0.036, 0.03, 0.006], SEAM, 1, 6);
      for (const s of [-1, 1]) {
        blob([s * 0.066, 1.178, torsoFront(1.178) + 0.016], [0.011, 0.011, 0.006], BRASS, 1, 6);
        // straps: up the chest, over the shoulder, and down the back to the waist
        const fr = [], bk = [];
        for (const y of [1.17, 1.176, 1.22, 1.26, 1.295, 1.3]) fr.push({ c: [s * (0.068 - 0.006 * bl(y, 1.17, 1.3)), y, torsoFront(Math.min(y, 1.29)) - 0.012 * bl(y, 1.26, 1.3) + 0.004], rx: y === 1.17 || y === 1.3 ? 0.003 : 0.016, rz: y === 1.17 || y === 1.3 ? 0.002 : 0.008, color: OV, w: tw(y) });
        tube(fr, 6);
        for (const y of [0.955, 0.961, 1.04, 1.12, 1.2, 1.26, 1.295, 1.3]) bk.push({ c: [s * (0.03 + 0.032 * bl(y, 0.96, 1.3)), y, torsoBack(y) - 0.004], rx: y === 0.955 || y === 1.3 ? 0.003 : 0.016, rz: y === 0.955 || y === 1.3 ? 0.002 : 0.008, color: OV, w: tw(y) });
        tube(bk, 6);
        blob([s * 0.062, 1.306, zl(1.306) - 0.004], [0.017, 0.011, 0.082], OV, 1, 6);
      }
      // straw hat hung on the back by its cord: brim, crown and band
      const hy = 1.16, hz = zl(hy) - 0.175;
      blob([0, hy, hz], [0.175, 0.175, 0.02], STRAW, 1, 14);
      blob([0, hy, hz - 0.034], [0.09, 0.09, 0.05], shade(STRAW, 0.93), 1, 12);
      blob([0, hy, hz - 0.016], [0.096, 0.096, 0.016], o.accent, 1, 12);
    }
    if (o.tabard) { const rs = [], ys = [0.596, 0.604, 0.66, 0.74, 0.82, 0.9, 0.918, 0.967, 0.975, 1.04, 1.12, 1.2, 1.25, 1.256];
      ys.forEach((y, i) => { const belt = y > 0.91 && y < 0.972, edge = i === 0 || i === ys.length - 1; rs.push({ c: [0, y, torsoFront(y) + 0.003], rx: edge ? 0.004 : (belt ? 0.062 : 0.058) * (y < 0.75 ? 1.15 : 1), rz: edge ? 0.002 : 0.009, color: belt ? o.belt : o.tabard, w: tw(y) }); });
      tube(rs, 8);
      for (const s of [-1, 1]) { const gs = []; ys.forEach((y, i) => { const belt = y > 0.91 && y < 0.972, edge = i === 0 || i === ys.length - 1, x = s * 0.066 * (y < 0.75 ? 1.15 : 1); gs.push({ c: [x, y, zl(y) + (torsoFront(y) - zl(y)) * 0.93 + 0.004], rx: edge ? 0.002 : 0.011, rz: edge ? 0.002 : 0.008, color: belt ? o.belt : GOLD, w: tw(y) }); }); tube(gs, 6); } }
    if (o.pauldron) for (const s of [-1, 1]) {
      blob([s * (shX + 0.022), shY + 0.008, zl(shY)], [0.08, 0.042, 0.086], o.pauldron, s < 0 ? 3 : 5, 10);
      blob([s * (shX + 0.026), shY - 0.022, zl(shY)], [0.088, 0.016, 0.094], GOLD, s < 0 ? 3 : 5, 10);
    }
    if (o.cape) { const rs = [], ys = [1.318, 1.31, 1.25, 1.12, 0.98, 0.84, 0.7, 0.56, 0.5, 0.47, 0.463];
      ys.forEach((y, i) => { const t = bl(1.31 - y, 0, 0.85), edge = i === 0 || i === ys.length - 1; rs.push({ c: [0, y, zl(y) - (0.094 * TD + 0.012 + 0.11 * t * t + 0.02 * t)], rx: edge ? 0.01 : 0.118 + 0.14 * Math.pow(t, 0.8), rzf: edge ? 0.003 : 0.012, rzb: edge ? 0.003 : 0.016 + 0.03 * t, color: y < 0.51 ? GOLD : o.cape, k: y < 0.51 ? 0 : 0.8 + 0.2 * bl(y, 0.5, 1.2), e: 0.75, w: tw(y) }); });
      tube(rs, 14);
      blob([0, 1.318, zl(1.318) + 0.03], [0.1, 0.03, 0.085], o.cape, 1, 12);                                         // mantle round the collar
    }
    // compact proportions: shorten the legs and torso and narrow the body; the head rides down whole
    const warp = (y) => y < hipY ? y * LEG : y < neckY ? hipY * LEG + (y - hipY) * TOR : y - (hipY * (1 - LEG) + (neckY - hipY) * (1 - TOR));
    const headDrop = neckY - warp(neckY);
    for (let i = 0; i < pos.length / 3; i++) {
      if (si[i * 4] === 2 && sw[i * 4] === 1) { pos[i * 3 + 1] -= headDrop; continue; }
      pos[i * 3] *= BX; pos[i * 3 + 1] = warp(pos[i * 3 + 1]); pos[i * 3 + 2] *= BX;
    }
    defs.forEach((d, i) => { d[2] = warp(d[2]); if (i !== 2) { d[1] *= BX; d[3] *= BX; } });
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new T.Float32BufferAttribute(col, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geo.setAttribute('skinIndex', new T.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new T.Float32BufferAttribute(sw, 4));
    geo.setIndex(idx); geo.computeVertexNormals();
    return { geo, defs, faceTex: faceTexture(T, o), handDrop: warp(shY - elbow) - warp(shY - wrist - 0.07), headTop: HY + 0.13 * HS - neckY };
  }
  // painted face: the lower-left corner is opaque white (every non-face vertex samples it); the rest is the face.
  // Eyes are drawn from lid curves, so their shape carries the character: 0 determined, 1 gentle, 2 sharp, 3 stern.
  // Mouths: 0 neutral, 1 smile, 2 smirk, 3 serious.
  const faceCache = new Map();
  const EYE_TYPES = [
    { w: 30, hu: 19, hl: 15, ci: 4, co: -4, pu: -3, ir: 17.5, iy: 0, lash: 7, brow: [7, -7, 6], lid: 0.3 },
    { w: 29, hu: 23, hl: 18, ci: 0, co: 4, pu: 0, ir: 19.5, iy: 1, lash: 6, brow: [-3, 2, 4], lid: 0.22 },
    { w: 31, hu: 13, hl: 11, ci: 6, co: -8, pu: 4, ir: 13.5, iy: -1, lash: 6, brow: [6, -9, 4.5], lid: 0.36 },
    { w: 29, hu: 12, hl: 13, ci: 3, co: -1, pu: -2, ir: 14, iy: 0, lash: 7.5, brow: [10, -3, 8], lid: 0.42 }
  ];
  function faceTexture(T, o) {
    const key = [o.goblin, o.eye, o.hair, o.eyeType, o.mouthType].join('|');
    if (faceCache.has(key)) return faceCache.get(key);
    const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'); g.clearRect(0, 0, S, S); g.scale(S / 256, S / 256); g.fillStyle = '#fff'; g.fillRect(0, 236, 20, 20);
    // face area: x 26..256, y 0..230 (canvas y is flipped against uv)
    const X = (u) => 26 + (u * 0.5 + 0.5) * 230, Y = (v) => 230 - v * 230;   // u -1..1 across the face, v 0..1 chin to forehead
    const shadeC = (h, k) => '#' + new T.Color(h).multiplyScalar(k).getHexString(), lightC = (h, k) => '#' + new T.Color(h).lerp(new T.Color(1, 1, 1), k).getHexString();
    const ell = (cx, cy, rx, ry, fill, rot) => { g.beginPath(); g.ellipse(cx, cy, rx, ry, rot || 0, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); };
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (o.goblin) {
      for (const s of [-1, 1]) { const ex = X(s * 0.47), ey = Y(0.47); ell(ex, ey, 29, 16, '#f6d24a', s * 0.3); ell(ex + s * 2, ey, 7, 13, '#1b120c', s * 0.3); g.strokeStyle = '#1b120c'; g.lineWidth = 6; g.beginPath(); g.moveTo(ex - s * 30, ey - 22); g.lineTo(ex + s * 24, ey - 10); g.stroke(); }
      g.fillStyle = 'rgba(30,45,15,0.6)'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(X(s * 0.07), Y(0.33), 4, 6, 0, 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = '#7a3b34'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(X(-0.3), Y(0.2)); g.lineTo(X(0.3), Y(0.2)); g.stroke();
      g.fillStyle = '#f3efe2'; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(X(s * 0.2) - 5, Y(0.2)); g.lineTo(X(s * 0.2) + 5, Y(0.2)); g.lineTo(X(s * 0.2), Y(0.2) - 14); g.fill(); }
    } else {
      const E = EYE_TYPES[o.eyeType % EYE_TYPES.length], ink = '#231519';
      // soft shadow the fringe throws on the forehead
      const fs = g.createLinearGradient(0, Y(1), 0, Y(0.66)); fs.addColorStop(0, 'rgba(150,85,75,0.3)'); fs.addColorStop(1, 'rgba(150,85,75,0)'); g.fillStyle = fs; g.fillRect(26, Y(1), 230, Y(0.66) - Y(1));
      for (const s of [-1, 1]) {
        const ex = X(s * 0.46), ey = Y(0.4), I = [ex - s * E.w, ey + E.ci], O = [ex + s * E.w, ey + E.co], PU = [ex + s * E.pu, ey - 2 * E.hu], PL = [ex + s * 2, ey + 2 * E.hl];
        const lids = () => { g.beginPath(); g.moveTo(I[0], I[1]); g.quadraticCurveTo(PU[0], PU[1], O[0], O[1]); g.quadraticCurveTo(PL[0], PL[1], I[0], I[1]); g.closePath(); };
        g.save(); lids(); g.clip();
        g.fillStyle = '#f7f3ee'; g.fillRect(ex - 40, ey - 50, 80, 100);
        const ix = ex - s * 1, iy = ey + E.iy, gr = g.createLinearGradient(0, iy - E.ir * 1.15, 0, iy + E.ir * 1.15); gr.addColorStop(0, shadeC(o.eye, 0.38)); gr.addColorStop(0.5, o.eye); gr.addColorStop(1, lightC(o.eye, 0.5));
        g.beginPath(); g.ellipse(ix, iy, E.ir, E.ir * 1.15, 0, 0, Math.PI * 2); g.fillStyle = gr; g.fill(); g.lineWidth = 2.6; g.strokeStyle = shadeC(o.eye, 0.42); g.stroke();
        ell(ix, iy - 1, E.ir * 0.44, E.ir * 0.6, '#16111b');
        g.beginPath(); g.ellipse(ix, iy + E.ir * 0.62, E.ir * 0.6, E.ir * 0.3, 0, 0, Math.PI * 2); g.fillStyle = lightC(o.eye, 0.55); g.globalAlpha = 0.55; g.fill(); g.globalAlpha = 1;
        const ls = g.createLinearGradient(0, ey - E.hu, 0, ey + 2); ls.addColorStop(0, 'rgba(40,24,50,' + (E.lid + 0.25) + ')'); ls.addColorStop(1, 'rgba(40,24,50,0)'); g.fillStyle = ls; g.fillRect(ex - 40, ey - 50, 80, 60);
        ell(ix - E.ir * 0.42, iy - E.ir * 0.5, E.ir * 0.3, E.ir * 0.36, '#ffffff'); ell(ix + E.ir * 0.42, iy + E.ir * 0.52, E.ir * 0.13, E.ir * 0.16, 'rgba(255,255,255,0.9)');
        g.restore();
        // upper lash: a tapered wedge along the lid, heavier toward the outer corner, with a flick
        g.beginPath(); g.moveTo(I[0], I[1]); g.quadraticCurveTo(PU[0], PU[1], O[0], O[1]); g.lineTo(O[0] + s * 7, O[1] - 5); g.quadraticCurveTo(PU[0] + s * 4, PU[1] - E.lash * 1.9, I[0] + s * 2, I[1] - 2); g.closePath(); g.fillStyle = ink; g.fill();
        g.strokeStyle = 'rgba(70,40,45,0.45)'; g.lineWidth = 2; g.beginPath(); g.moveTo(I[0] + s * 8, I[1] - E.hu * 0.75 - 6); g.quadraticCurveTo(PU[0], PU[1] - E.lash * 1.9 - 9, O[0] - s * 2, O[1] - E.hu * 0.45 - 7); g.stroke();   // lid crease
        g.strokeStyle = 'rgba(50,30,34,0.6)'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(O[0] - s * 1, O[1] + 2); g.quadraticCurveTo(ex + s * E.w * 0.6, ey + E.hl * 1.25, ex + s * 2, ey + E.hl * 1.02); g.stroke();                       // lower lid, outer half
        // brow: thicker at the inner end
        const by = ey - E.hu - 20, bi = [ex - s * E.w * 0.95, by + E.brow[0]], bo = [ex + s * E.w * 1.12, by + E.brow[1]], bm = [ex + s * 2, by + (E.brow[0] + E.brow[1]) / 2 - 7], t = E.brow[2];
        g.beginPath(); g.moveTo(bi[0], bi[1] - t * 0.5); g.quadraticCurveTo(bm[0], bm[1] - t * 0.45, bo[0], bo[1]); g.quadraticCurveTo(bm[0], bm[1] + t * 0.5, bi[0], bi[1] + t * 0.5); g.closePath(); g.fillStyle = shadeC(o.hair, 0.62); g.fill();
        if (o.eyeType === 1) ell(X(s * 0.68), Y(0.2), 18, 8, 'rgba(235,120,110,0.22)');
      }
      // nose: a short shaded tick; mouth by type
      g.strokeStyle = 'rgba(150,92,74,0.6)'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(X(0.0), Y(0.215)); g.lineTo(X(0.024), Y(0.19)); g.stroke();
      const mx = X(0), my = Y(0.1), m = o.mouthType % 4; g.strokeStyle = '#7d3c36'; g.lineWidth = 3; g.beginPath();
      if (m === 1) { g.moveTo(mx - 15, my - 3); g.quadraticCurveTo(mx, my + 8, mx + 15, my - 3); }
      else if (m === 2) { g.moveTo(mx - 12, my + 2); g.quadraticCurveTo(mx + 2, my + 4, mx + 15, my - 5); g.lineTo(mx + 18, my - 4); }
      else if (m === 3) { g.moveTo(mx - 12, my + 3); g.quadraticCurveTo(mx, my - 2, mx + 12, my + 3); }
      else { g.moveTo(mx - 11, my); g.quadraticCurveTo(mx, my + 2, mx + 11, my); }
      g.stroke();
      g.strokeStyle = 'rgba(150,92,74,0.4)'; g.lineWidth = 2; g.beginPath(); g.moveTo(mx - 5, my + 10); g.lineTo(mx + 5, my + 10); g.stroke();   // lower-lip shadow
    }
    const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.magFilter = T.LinearFilter; t.minFilter = T.LinearFilter; t.generateMipmaps = false;
    faceCache.set(key, t); return t;
  }

  function charMaterials(T) {
    const N = 32, d = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) { const t = i / (N - 1), e = Math.min(1, Math.max(0, (t - 0.46) / 0.1)), k = e * e * (3 - 2 * e); d[i * 4] = 255 * (0.6 + 0.4 * k); d[i * 4 + 1] = 255 * (0.57 + 0.43 * k); d[i * 4 + 2] = 255 * (0.7 + 0.3 * k); d[i * 4 + 3] = 255; }
    const ramp = new T.DataTexture(d, N, 1); ramp.minFilter = ramp.magFilter = T.LinearFilter; ramp.needsUpdate = true;
    const patch = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <gradientmap_pars_fragment>', T.ShaderChunk.gradientmap_pars_fragment.replace('return vec3( texture2D( gradientMap, coord ).r );', 'return texture2D( gradientMap, coord ).rgb;'))
        .replace('#include <lights_toon_fragment>', '#include <lights_toon_fragment>\n{ float fxRim = pow( 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 ), 3.0 ); totalEmissiveRadiance += diffuseColor.rgb * fxRim * 0.3; }');
    };
    const outline = new T.MeshBasicMaterial({ color: new T.Color(0.2, 0.15, 0.17), side: T.BackSide, vertexColors: true });
    outline.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * 0.0038;'); };
    return { outline, toon(faceTex) { const m = new T.MeshToonMaterial({ vertexColors: true, gradientMap: ramp, map: faceTex, alphaTest: 0.5 }); m.onBeforeCompile = patch; m.customProgramCacheKey = () => 'fxtoon2'; return m; } };
  }
  const charMats = charMaterials(T);
  function measure(rig) {
    const body = rig.body, arm = limbBox(rig.armL) || limbBox(rig.armR), leg = limbBox(rig.legL) || limbBox(rig.legR);
    if (!body || !arm || !leg || !rig.armL || !rig.armR || !rig.legL || !rig.legR) return null;
    const at = (m) => { const v = new T.Vector3(); for (let o = m; o && o !== body; o = o.parent) v.add(o.position); return v; };
    const parts = [], limbs = [rig.armL, rig.armR, rig.legL, rig.legR];
    rig.root.traverse((o) => { if (!boxOf(o)) return; for (let p = o.parent; p; p = p.parent) { if (limbs.includes(p) || p === rig.shield) return; if (p === rig.root) break; } parts.push(o); });
    let head = null, torso = null, tv = 0;
    for (const m of parts) {
      const q = m.geometry.parameters, mx = Math.max(q.width, q.height, q.depth), mn = Math.min(q.width, q.height, q.depth), vol = q.width * q.height * q.depth;
      if (mx / mn < 1.3 && mn > 0.2 && (!head || at(m).y > at(head).y)) head = m;
      if (q.height >= 0.38 && q.width >= 0.3 && vol > tv) { tv = vol; torso = m; }
    }
    if (!head || !torso) return null;
    const hp = at(head), tq = torso.geometry.parameters, enemy = !!rig.skin, hex = (m) => '#' + m.material.color.getHexString();
    const pal = { skin: hex(head), tunic: hex(torso), pants: hex(leg), sleeve: hex(arm), hair: null, accent: null, belt: null };
    const hats = [];
    for (const m of parts) {
      if (m === head || m === torso) continue;
      const q = m.geometry.parameters, p = at(m);
      if (p.y > hp.y + 0.04 && q.width > 0.2) { if (enemy) hats.push(m); else pal.hair = hex(m); }
      else if (q.height < 0.15 && q.width > 0.3) { if (p.y > at(torso).y) pal.accent = hex(m); else pal.belt = hex(m); }
    }
    return { enemy, pal, parts, hats, head, torso, arm, leg,
      hipY: rig.legL.position.y, hipX: Math.abs(rig.legL.position.x), legH: leg.geometry.parameters.height, legW: leg.geometry.parameters.width,
      shY: rig.armL.position.y, shX: Math.abs(rig.armL.position.x), shZ: rig.armL.position.z, armH: arm.geometry.parameters.height, armW: arm.geometry.parameters.width,
      headY: hp.y, headZ: hp.z, headS: head.geometry.parameters.height, torsoW: tq.width, lean: Math.tan(torso.rotation.x || 0) };
  }


  const HAIRS = ['#e6cf8a', '#2c2430', '#a8472c', '#7c5a3a'], EYES = ['#3d6fb5', '#3f8f5a', '#8a5a2b', '#7a4bb5'];
  const hatGeo = (w) => { const g = new T.LatheGeometry([[w * 0.66, 0], [w * 0.64, 0.025], [w * 0.36, 0.05], [w * 0.2, w * 0.5], [0.01, w * 1.0]].map((q) => new T.Vector2(q[0], q[1])), 10); g.computeVertexNormals(); return g; };
  let charCount = 0;
  function convertChar(rig) {
    const root = rig.root; root.userData.fxChar = true;
    const P = measure(rig); if (!P) return;
    const pal = P.pal, n = charCount++, plainHair = !pal.hair || pal.hair === pal.tunic;
    const g = window.__game || {}, ally = (g.allies || []).find((a) => a.m === rig), shadeOf = (h, k) => '#' + new T.Color(h).multiplyScalar(k).getHexString();
    const accent = pal.accent || shadeOf(pal.tunic, 1.35), look = { cape: null, tabard: null, pauldron: null, glove: null, eyeType: n % 4, mouthType: (n * 3 + 1) % 4 };
    if (!P.enemy) {
      look.glove = '#5b4030';
      if (g.pm === rig) { Object.assign(look, { style: 'homestead', glove: null, tunic: '#e6dcc6', sleeve: '#e6dcc6', pants: '#4d74a6', boot: '#6f4a2b', accent: '#c8472f', eyeType: 1, mouthType: 1 }); }      // the player: a homesteader in overalls
      else if (ally && ally.kind === 0) { look.pauldron = '#7f8892'; look.eyeType = 3; look.mouthType = 3; }                             // the Guardian: steel shoulders
      else { look.cape = shadeOf(pal.tunic, 0.6); look.eyeType = 1; look.mouthType = 1; }                                                // the Archer and anyone else: a plain cloak
    }
    const made = makeBody(T, Object.assign({ skin: pal.skin, tunic: pal.tunic, pants: pal.pants, sleeve: pal.sleeve, hair: plainHair ? HAIRS[n % HAIRS.length] : pal.hair, accent, belt: pal.belt || shadeOf(pal.tunic, 0.5),
      eye: EYES[n % EYES.length], hairStyle: ally && ally.kind === 0 ? 2 : plainHair ? 1 : 0, goblin: P.enemy, lean: P.lean, seed: n + 1 }, look));
    const bones = made.defs.map(() => new T.Bone());
    made.defs.forEach((d, i) => { const p = d[0] < 0 ? [0, 0, 0] : made.defs[d[0]].slice(1); bones[i].position.set(d[1] - p[0], d[2] - p[1], d[3] - p[2]); if (d[0] >= 0) bones[d[0]].add(bones[i]); });
    const mat = charMats.toon(made.faceTex);
    const mesh = new T.SkinnedMesh(made.geo, mat), line = new T.SkinnedMesh(made.geo, charMats.outline), sk = new T.Skeleton(bones);
    mesh.add(bones[0]); mesh.castShadow = true; rig.body.add(mesh); mesh.bind(sk);
    rig.body.add(line); line.bind(sk, mesh.bindMatrix);
    if (P.enemy) { mesh.scale.setScalar(0.92); line.scale.setScalar(0.92); }
    const st = { rig, root, mesh, line, mat, tex: made.faceTex, bones, moved: [], hidden: [], swapped: [], flash: rig.skin || rig.tunic || null };
    for (const m of P.parts) { if (P.hats.includes(m)) continue; m.userData.fxBox = m.geometry; st.hidden.push(m); }
    for (const gp of [rig.armL, rig.armR, rig.legL, rig.legR]) { const lb = limbBox(gp); if (lb) { lb.userData.fxBox = lb.geometry; st.hidden.push(lb); } }
    // whatever the arms carry rides the forearm, in the hand; hats sit on the new head
    [[rig.armL, 4], [rig.armR, 6]].forEach(([gp, bi]) => { const lb = limbBox(gp); for (const c of gp.children.slice()) if (c !== lb) st.moved.push({ c, from: gp, to: bones[bi], home: c.position.clone(), away: c.position.clone().add(new T.Vector3(0, P.armH - made.handDrop, 0)) }); });
    for (const h of P.hats) { const q = h.geometry.parameters; h.userData.fxBox = h.geometry; st.swapped.push({ m: h, round: hatGeo(q.width) }); st.moved.push({ c: h, from: h.parent, to: bones[2], home: h.position.clone(), away: new T.Vector3(0, made.headTop + 0.01, 0) }); }
    bones[2].rotation.order = 'YXZ';
    chars.set(root, st); applyChar(st);
  }
  function applyChar(st) {
    const on = charStyle === 'anime';
    for (const mv of st.moved) {
      const want = on ? mv.to : mv.from;
      if (mv.c.parent !== want && (mv.c.parent === mv.to || mv.c.parent === mv.from)) { want.add(mv.c); mv.c.position.copy(on ? mv.away : mv.home); }
    }
    for (const m of st.hidden) m.geometry = on ? EMPTY : m.userData.fxBox;
    for (const sw of st.swapped) sw.m.geometry = on ? sw.round : sw.m.userData.fxBox;
    st.mesh.visible = st.line.visible = on;
  }
  function poseChars() {
    if (charStyle !== 'anime') return;
    const high = ar.level === 'high';
    for (const st of chars.values()) {
      const r = st.rig, b = st.bones;
      st.line.visible = high;
      [[r.armL, 3, -1], [r.armR, 5, 1]].forEach(([g, i, side]) => {
        const rx = g.rotation.x, relax = 1 - Math.min(1, Math.abs(rx) / 1.2);
        b[i].rotation.set(rx, 0, g.rotation.z + side * 0.13 * relax);
        b[i + 1].rotation.x = -(0.1 + 0.4 * relax) - Math.min(1.3, Math.max(0, -g.position.z) * 5.5);
      });
      [[r.legL, 7], [r.legR, 9]].forEach(([g, i]) => { const rx = g.rotation.x; b[i].rotation.x = rx; b[i + 1].rotation.x = g.userData.knee !== undefined ? g.userData.knee : 0.06 + Math.max(0, -rx) * 0.9 + Math.max(0, rx) * 0.3; });
      if (r.head) b[2].rotation.copy(r.head.rotation);
      if (st.flash && st.flash.emissive) st.mat.emissive.copy(st.flash.emissive);
    }
  }
  function scanChars() {
    const g = window.__game; if (!g) return;
    const rigs = [];
    if (g.pm && g.pm.root) rigs.push(g.pm);
    for (const a of g.allies || []) if (a.m && a.m.root) rigs.push(a.m);
    for (const e of g.enemies || []) if (e.m && e.m.root) rigs.push(e.m);
    for (const r of rigs) if (!r.root.userData.fxChar) { try { convertChar(r); } catch (e) { console.error('fx character skipped:', e); } }
    for (const [r, st] of chars) if (!r.parent) { st.mesh.geometry.dispose(); st.mat.dispose(); chars.delete(r); }
  }
  const charLabel = () => charStyle === 'anime' ? 'Models: anime' : 'Models: blocks';
  let charBtn = null;
  FX.setCharacters = function (style) {
    charStyle = style === 'blocks' ? 'blocks' : 'anime';
    try { localStorage.setItem('fx-characters', charStyle); } catch (e) {}
    for (const st of chars.values()) applyChar(st);
    if (charBtn) charBtn.textContent = charLabel();
  };
  FX.scanCharacters = scanChars;
  (function () {
    const host = document.getElementById('status'); if (!host) return;
    charBtn = document.createElement('button'); charBtn.type = 'button'; charBtn.title = 'Switch character models between the anime-style bodies and the original blocks';
    charBtn.addEventListener('click', () => { FX.setCharacters(charStyle === 'anime' ? 'blocks' : 'anime'); const v = document.getElementById('view'); if (v) v.focus(); });
    host.insertBefore(charBtn, document.getElementById('newworld'));
    charBtn.textContent = charLabel();
  })();

  let last = performance.now(), clock = 0;
  FX.frame = function () {
    const now = performance.now(), dtime = Math.min(0.05, (now - last) / 1000); last = now; clock += dtime; fireTime.value = clock;
    const high = ar.level === 'high';
    if (high) install();
    keyClock -= dtime;
    if (keyClock <= 0) {
      keyClock = 0.6;
      scanChars();
      const key = H.Ts + '|' + (H.Nt.camps || []).map((c) => c ? c.x.toFixed(1) + ',' + c.z.toFixed(1) : '-').join('|');
      if (key !== fireKey) { fireKey = key; buildFires(); }
      for (const f of fires) { const y = Se(f.x, f.z); if (Math.abs(y - f.y) > 0.02) { f.y = y; f.group.position.y = y; } }
    }
    if (!puffDone) softenParticles();
    if (!treeDone && cfg.treeVariety) varyTrees();
    poseChars();
    const ph = phases(), arr = embers.geometry.attributes.position.array;
    airLight.value.copy(sun.color).multiplyScalar(sun.intensity * 0.3).addScalar(0.12 + 0.2 * ph.day + 0.12 * ph.gold);
    fires.forEach((f, i) => {
      f.glow.material.opacity = (0.22 + 0.3 * ph.night + 0.12 * ph.gold) * flick(clock, f.seed);
      for (let k = 0; k < EMB; k++) {
        const s = f.seed + k * 7.31, life = (clock * (0.32 + (k % 5) * 0.05) + k * 0.173) % 1, o = (i * EMB + k) * 3;
        arr[o] = f.x + Math.sin(s) * 0.25 + Math.sin(clock * 1.7 + s) * 0.35 * life;
        arr[o + 1] = f.y + 0.6 + life * 3.2;
        arr[o + 2] = f.z + Math.cos(s * 1.3) * 0.25 + Math.cos(clock * 1.3 + s) * 0.35 * life;
      }
    });
    embers.geometry.attributes.position.needsUpdate = true;
    // night wisp: a small light that circles the player after dark
    const wk = cfg.wisp * ph.night;
    wisp.visible = wk > 0.02;
    if (wisp.visible) {
      const a = clock * 0.8;
      wisp.position.set(H.nt.x + Math.cos(a) * 0.95, H.nt.y + 1.75 + Math.sin(clock * 1.9) * 0.14, H.nt.z + Math.sin(a) * 0.95);
      wisp.scale.setScalar(0.4 + 0.6 * wk);
    }
    // two pooled point lights: the wisp and the nearest fire
    const lit = high && cfg.fireLight > 0;
    lights[0].visible = lights[1].visible = lit;
    if (lit) {
      lights[0].position.copy(wisp.position); lights[0].color.setHex(0xffc98a); lights[0].distance = 13; lights[0].intensity = wisp.visible ? 9 * wk * cfg.fireLight * (0.92 + 0.08 * Math.sin(clock * 3.1)) : 0;
      let best = null, bd = 1e9;
      for (const f of fires) { const d = Math.hypot(f.x - H.nt.x, f.z - H.nt.z); if (d < bd) { bd = d; best = f; } }
      if (best && bd < 70) {
        lights[1].position.set(best.x + Math.sin(clock * 6.1) * 0.06, best.y + 1.15, best.z + Math.cos(clock * 5.3) * 0.06);
        lights[1].intensity = (16 + 24 * ph.night + 8 * ph.gold) * cfg.fireLight * flick(clock, best.seed) * sm(70, 52, bd);
      } else lights[1].intensity = 0;
    }
  };

  H.hook(function () {
    if (!FX.err) { try { FX.frame(); } catch (e) { FX.err = e; pass.enabled = false; console.error('fx disabled:', e); } }
  });
  if (window.__game) window.__game.fx2 = FX;
  window.__fxInfo2 = () => ({ installed: FX.installed, err: FX.err && String(FX.err), fires: fires.length, pass: pass.enabled, puffs: puffDone, trees: treeDone, chars: chars.size, style: charStyle });
})();
