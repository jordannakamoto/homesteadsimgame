/* Atmosphere and relight pass: ambient occlusion with bounce light (half resolution), depth of field, sun shafts,
   distance haze, glow, colour grade, saturation and vignette. One pass in the composer, after bloom and before
   output. High quality only. Campfires, particles and characters are in fx.js. */
(() => {
  const G = window.__game;
  if (!G || !G.composer) return;
  const T = G.THREE, R = G.renderer, scene = G.scene, cam = G.camera, dt = G.cam;
  const sun = scene.children.find((o) => o.isDirectionalLight);
  const H = { get nt() { return G.player; }, get Nt() { return G.world; }, get ji() { return G.composer(); } };
  const cfg = { dof: 1, shafts: 1, glow: 1, vignette: 0.3, saturation: 1.1, ao: 1, bounce: 1, relight: 1 };
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
  const rtAO = rt(T.HalfFloatType);
  rtAO.texture.minFilter = rtAO.texture.magFilter = T.NearestFilter;

  // ---------- ambient occlusion and bounce light, at half resolution ----------
  // Darkens creases where surfaces crowd together and lets nearby colour spill into them. Formerly its own
  // full-resolution pass (relight.js) plus a copy; here it is one half-resolution draw, joined back into the
  // composite with a depth-aware upsample. rgb: bounce light to add, a: how much of the light the crease keeps.
  const AO_N = 8;
  const aoMat = mat({ tColor: { value: null }, tDepth: { value: null }, uProj: { value: new T.Matrix4() }, uProjInv: { value: new T.Matrix4() }, uAO: { value: 0.5 }, uBounce: { value: 1 } }, `
    precision highp float;
    uniform sampler2D tColor; uniform sampler2D tDepth; uniform mat4 uProj; uniform mat4 uProjInv; uniform float uAO; uniform float uBounce;
    varying vec2 vUv;
    vec3 viewPos(vec2 uv) { float d = texture2D(tDepth, uv).x; vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
    float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
    void main() {
      float d = texture2D(tDepth, vUv).x;
      if (d >= 0.99995) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      vec3 p = viewPos(vUv);
      vec3 n = normalize(cross(dFdx(p), dFdy(p)));
      float dist = -p.z;
      float rad = 1.1 + dist * 0.016;
      vec2 ruv = vec2(uProj[0][0], uProj[1][1]) * rad / max(0.5, dist) * 0.5;
      float a0 = ign(gl_FragCoord.xy) * 6.2832;
      float occ = 0.0; vec3 spill = vec3(0.0); float sw = 0.0001;
      for (int i = 0; i < ${AO_N}; i++) {
        float fi = (float(i) + 0.5) / float(${AO_N});
        float ang = a0 + fi * 15.08;
        vec2 suv = vUv + vec2(cos(ang), sin(ang)) * sqrt(fi) * ruv;
        vec3 v = viewPos(suv) - p;
        float l2 = dot(v, v);
        float w = max(0.0, dot(v, n) - 0.035 - dist * 0.0012) / (l2 + 0.06) * smoothstep(rad * rad * 2.2, rad * rad * 0.6, l2);
        occ += w; spill += texture2D(tColor, suv).rgb * w; sw += w;
      }
      float ao = clamp(1.0 - uAO * occ * (1.15 / float(${AO_N})), 0.0, 1.0);
      ao = ao * ao * (3.0 - 2.0 * ao);
      gl_FragColor = vec4((spill / sw) * (1.0 - ao) * 0.22 * uBounce, ao);
    }`);

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
  const compMat = mat({ tColor: { value: null }, tBlur: { value: null }, tShaft: { value: null }, tDepth: { value: null }, uNear: { value: 0.5 }, uFar: { value: 400 }, uFocus: { value: 24 }, uDofFar: { value: 1 }, uDofNear: { value: 1 }, uShaftK: { value: 0 }, uGlowK: { value: 0 }, uSunCol: { value: new T.Color() }, uVig: { value: 0.3 }, uSat: { value: 1.1 }, tAO: { value: null }, uAOTexel: { value: new T.Vector2() }, uAOOn: { value: 0 }, uRelight: { value: 1 }, uProjInv: { value: new T.Matrix4() }, uSunV: { value: new T.Vector3(0, 1, 0) }, uSunTint: { value: new T.Color(1, 1, 1) }, uSky: { value: new T.Color(0.7, 0.8, 0.9) }, uDay: { value: 1 } }, `
    precision highp float;
    uniform sampler2D tColor; uniform sampler2D tBlur; uniform sampler2D tShaft; uniform sampler2D tDepth;
    uniform float uNear; uniform float uFar; uniform float uFocus; uniform float uDofFar; uniform float uDofNear; uniform float uShaftK; uniform float uGlowK; uniform float uVig; uniform float uSat;
    uniform vec3 uSunCol; varying vec2 vUv;
    uniform sampler2D tAO; uniform vec2 uAOTexel; uniform float uAOOn; uniform float uRelight; uniform mat4 uProjInv; uniform vec3 uSunV; uniform vec3 uSunTint; uniform vec3 uSky; uniform float uDay;
    float linZ(float d) { float zn = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - zn * (uFar - uNear)); }
    vec3 grade(vec3 c) {
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // cool shade, warm light
      c *= mix(vec3(1.0), mix(vec3(0.96, 0.99, 1.05), vec3(1.03, 1.0, 0.95), smoothstep(0.03, 0.55, l)), uDay);
      // the loudest colours are reined in, every surface takes a little of the light's colour, the darkest tones are lifted by the sky
      float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
      float sat = (mx - mn) / max(mx, 0.0001);
      c = mix(vec3(l), c, 0.988 * (1.0 - 0.12 * smoothstep(0.6, 1.0, sat)));
      c *= mix(vec3(1.0), uSunTint / max(0.001, dot(uSunTint, vec3(0.3333))), 0.056 * uDay);
      c += uSky * 0.006;
      return 0.18 * pow(max(c, 0.0) / 0.18, vec3(1.02));
    }
    void main(){
      vec4 c = texture2D(tColor, vUv);
      float d = texture2D(tDepth, vUv).x;
      float z = linZ(d);
      float coc = max(smoothstep(uFocus * 1.45, uFocus * 3.4, z) * uDofFar, smoothstep(uFocus * 0.74, uFocus * 0.34, z) * uDofNear);
      vec3 col = mix(c.rgb, texture2D(tBlur, vUv).rgb, coc);
      if (d < 0.99995) {
        if (uAOOn > 0.5) {
          // depth-aware upsample: the four nearest half-resolution samples, weighted by how close their depth is to this pixel's
          vec2 f = vUv / uAOTexel - 0.5, b = floor(f), t = f - b;
          vec4 acc = vec4(0.0); float wsum = 0.0;
          for (int j = 0; j < 4; j++) {
            vec2 o = vec2(float(j - (j / 2) * 2), float(j / 2));
            vec2 uv = (b + o + 0.5) * uAOTexel;
            float bw = (o.x > 0.5 ? t.x : 1.0 - t.x) * (o.y > 0.5 ? t.y : 1.0 - t.y);
            float dz = abs(linZ(texture2D(tDepth, uv).x) - z) / (z * 0.04 + 0.05);
            float w = bw / (1.0 + dz * dz * 8.0) + 0.0001;
            acc += texture2D(tAO, uv) * w; wsum += w;
          }
          acc /= wsum;
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          // creases lose mostly ambient light, so sunlit pixels are darkened less
          float keep = mix(acc.a, 1.0, smoothstep(0.25, 1.1, l) * 0.55);
          col = col * mix(1.0, keep, 0.9) + acc.rgb;
        }
        // haze thickens with distance and warms toward the sun; a thin veil of air even close up
        if (uRelight > 0.5) {
        vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        vec3 vd = normalize(vp.xyz / vp.w);
        float haze = 1.0 - exp(-max(0.0, z - 18.0) * 0.006);
        col += uSunTint * (0.02 + 0.1 * pow(max(dot(vd, uSunV), 0.0), 6.0)) * haze * uDay;
        col = mix(col, uSky, (1.0 - exp(-max(0.0, z - 8.0) * 0.004)) * 0.064);
        }
      }
      if (uRelight > 0.5) col = grade(col);
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
      const hw = Math.max(2, Math.round(w / 2)), hh = Math.max(2, Math.round(h / 2));
      rtAO.setSize(hw, hh);
      compMat.uniforms.uAOTexel.value.set(1 / hw, 1 / hh);
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
      const aoOn = cfg.ao > 0 && cfg.relight > 0;
      if (aoOn) {
        const u = aoMat.uniforms;
        u.tColor.value = read.texture; u.tDepth.value = depth;
        u.uProj.value.copy(cam.projectionMatrix); u.uProjInv.value.copy(cam.projectionMatrixInverse);
        u.uAO.value = 0.5 * cfg.ao; u.uBounce.value = cfg.bounce;
        draw(aoMat, rtAO);
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
      c.tAO.value = rtAO.texture; c.uAOOn.value = aoOn ? 1 : 0; c.uRelight.value = cfg.relight > 0 ? 1 : 0;
      c.uProjInv.value.copy(cam.projectionMatrixInverse);
      c.uSunV.value.copy(sunDir).transformDirection(cam.matrixWorldInverse);
      c.uSunTint.value.copy(sun.color);
      if (scene.fog) c.uSky.value.copy(scene.fog.color);
      const st = Math.sin((H.Nt.time - 0.25) * Math.PI * 2);
      c.uDay.value = Math.max(0, Math.min(1, (st + 0.1) / 0.3));
      draw(compMat, write);
      r.autoClear = auto;
    },
    dispose() {}
  };
  function install() {
    const c = H.ji;
    if (!c || c.__fx) return;
    c.__fx = true;
    // the pass reads scene depth, so both of the composer's buffers get a depth texture
    for (const t of [c.renderTarget1, c.renderTarget2]) if (!t.depthTexture) { t.depthTexture = new T.DepthTexture(t.width, t.height); t.dispose(); }
    c.insertPass(pass, c.passes.length - 1);
    FX.installed = true;
  }
  // A button to compare the cost and the look: full lighting, the same without the relight part (ambient occlusion,
  // bounce light, haze and grade), or the whole pass off (bloom only). The choice is remembered.
  const MODES = ['full', 'no relight', 'off'];
  let mode = 0;
  try { mode = Math.max(0, MODES.indexOf(localStorage.getItem('fx-lighting') || 'full')); } catch (e) {}
  const applyMode = () => { cfg.relight = mode === 0 ? 1 : 0; pass.enabled = mode !== 2 && !FX.err; if (btn) btn.textContent = 'Lighting: ' + MODES[mode]; };
  let btn = null;
  const host = document.getElementById('status');
  if (host) {
    btn = document.createElement('button'); btn.type = 'button'; btn.title = 'Compare lighting cost: full, without relight (occlusion, bounce, haze, grade), or the effects pass off. High quality only';
    btn.addEventListener('click', () => { mode = (mode + 1) % MODES.length; try { localStorage.setItem('fx-lighting', MODES[mode]); } catch (e) {} applyMode(); const v = document.getElementById('view'); v && v.focus(); });
    host.insertBefore(btn, document.getElementById('newworld'));
  }
  applyMode();
  FX.setLighting = (m) => { mode = Math.max(0, MODES.indexOf(m)); applyMode(); };
  G.fx = FX;
  window.__fxInfo = () => ({ installed: FX.installed, err: FX.err && String(FX.err), pass: pass.enabled });
  const tick = () => { install(); requestAnimationFrame(tick); };
  tick();
})();
