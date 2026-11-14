/* Atmosphere pass, carried over from the main prototype's effects pack: depth of field, sun shafts, haze glow,
   saturation and vignette. One extra pass in the composer, after bloom and before output. High quality only.
   The campfire, particle and character parts of that pack are not included here. */
(() => {
  const G = window.__game;
  if (!G || !G.composer) return;
  const T = G.THREE, R = G.renderer, scene = G.scene, cam = G.camera, dt = G.cam;
  const sun = scene.children.find((o) => o.isDirectionalLight);
  const H = { get nt() { return G.player; }, get Nt() { return G.world; }, get ji() { return G.composer(); } };
  const cfg = { dof: 1, shafts: 1, glow: 1, vignette: 0.3, saturation: 1.1 };
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
    // relight.js has already given the composer's buffers depth textures
    if (!c.renderTarget1.depthTexture) return void (c.__fx = false);
    c.insertPass(pass, c.passes.length - 1);
    FX.installed = true;
  }
  G.fx = FX;
  window.__fxInfo = () => ({ installed: FX.installed, err: FX.err && String(FX.err), pass: pass.enabled });
  const tick = () => { install(); requestAnimationFrame(tick); };
  tick();
})();
