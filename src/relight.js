/* Screen-space relight: one pass over the finished frame that adds what the direct lighting leaves out.
   It reads the depth buffer to find where surfaces crowd together, darkens those creases (ambient occlusion),
   lets nearby colour spill into them (bounce light), adds sun-tinted haze with distance, and grades the result.
   No neural network: about a dozen texture reads per pixel. High quality only. */
(() => {
  const G = window.__game;
  if (!G || !G.composer) return;
  const T = G.THREE;
  const touch = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  const N = touch ? 5 : 8;
  const mat = new T.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tColor: { value: null },
      tDepth: { value: null },
      uProj: { value: new T.Matrix4() },
      uProjInv: { value: new T.Matrix4() },
      uSunV: { value: new T.Vector3(0, 1, 0) },
      uSunCol: { value: new T.Color(1, 1, 1) },
      uAO: { value: 0.5 },
      uBounce: { value: 1 },
      uDay: { value: 1 },
      uSky: { value: new T.Color(0.7, 0.8, 0.9) },
    },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `
      precision highp float;
      uniform sampler2D tColor; uniform sampler2D tDepth;
      uniform mat4 uProj; uniform mat4 uProjInv;
      uniform vec3 uSunV; uniform vec3 uSunCol; uniform vec3 uSky; uniform float uAO; uniform float uBounce; uniform float uDay;
      varying vec2 vUv;
      vec3 viewPos(vec2 uv) {
        float d = texture2D(tDepth, uv).x;
        vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        return p.xyz / p.w;
      }
      float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      vec3 grade(vec3 c, vec2 uv) {
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // cool shade, warm light
        vec3 tint = mix(vec3(0.96, 0.99, 1.05), vec3(1.03, 1.0, 0.95), smoothstep(0.03, 0.55, l));
        c *= mix(vec3(1.0), tint, uDay);
        // One air for everything: the loudest colours are reined in toward the rest, every surface takes
        // a little of the light's own colour, and the darkest tones are lifted by the sky.
        float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
        float sat = (mx - mn) / max(mx, 0.0001);
        c = mix(vec3(l), c, 0.988 * (1.0 - 0.12 * smoothstep(0.6, 1.0, sat)));
        vec3 key = uSunCol / max(0.001, dot(uSunCol, vec3(0.3333)));
        c *= mix(vec3(1.0), key, 0.056 * uDay);
        c += uSky * 0.006;
        c = 0.18 * pow(max(c, 0.0) / 0.18, vec3(1.02));
        vec2 q = uv - 0.5;
        return c;
      }
      void main() {
        vec4 src = texture2D(tColor, vUv);
        float d = texture2D(tDepth, vUv).x;
        vec3 c = src.rgb;
        if (d < 0.99995) {
          vec3 p = viewPos(vUv);
          vec3 n = normalize(cross(dFdx(p), dFdy(p)));
          float dist = -p.z;
          float rad = 1.1 + dist * 0.016;
          vec2 ruv = vec2(uProj[0][0], uProj[1][1]) * rad / max(0.5, dist) * 0.5;
          float a0 = ign(gl_FragCoord.xy) * 6.2832;
          float occ = 0.0; vec3 spill = vec3(0.0); float sw = 0.0001;
          for (int i = 0; i < ${N}; i++) {
            float fi = (float(i) + 0.5) / float(${N});
            float ang = a0 + fi * 15.08;
            vec2 suv = vUv + vec2(cos(ang), sin(ang)) * sqrt(fi) * ruv;
            vec3 v = viewPos(suv) - p;
            float l2 = dot(v, v);
            float w = max(0.0, dot(v, n) - 0.035 - dist * 0.0012) / (l2 + 0.06) * smoothstep(rad * rad * 2.2, rad * rad * 0.6, l2);
            occ += w;
            spill += texture2D(tColor, suv).rgb * w;
            sw += w;
          }
          float ao = clamp(1.0 - uAO * occ * (1.15 / float(${N})), 0.0, 1.0);
          ao = ao * ao * (3.0 - 2.0 * ao);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          // creases lose mostly ambient light, so sunlit pixels are darkened less
          float keep = mix(ao, 1.0, smoothstep(0.25, 1.1, l) * 0.55);
          vec3 lit = c * mix(1.0, keep, 0.9);
          // and pick up a little of the colour around them
          lit += (spill / sw) * (1.0 - ao) * 0.22 * uBounce;
          // haze thickens with distance and warms toward the sun
          vec3 vd = normalize(p);
          float haze = 1.0 - exp(-max(0.0, dist - 18.0) * 0.006);
          lit += uSunCol * (0.02 + 0.1 * pow(max(dot(vd, uSunV), 0.0), 6.0)) * haze * uDay;
          // a thin veil of air even at close range, so near things sit in the same atmosphere as far ones
          lit = mix(lit, uSky, (1.0 - exp(-max(0.0, dist - 8.0) * 0.004)) * 0.064);
          c = lit;
        }
        gl_FragColor = vec4(grade(c, vUv), src.a);
      }`,
  });
  const scene = new T.Scene(),
    cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    quad = new T.Mesh(new T.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  const sunV = new T.Vector3();
  const tmp = new T.WebGLRenderTarget(4, 4, { type: T.HalfFloatType, depthBuffer: false });
  const copy = new T.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { tColor: { value: null } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: "uniform sampler2D tColor; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tColor, vUv); }",
  });
  const pass = {
    isPass: true,
    enabled: true,
    needsSwap: false,
    clear: false,
    renderToScreen: false,
    setSize(w, h) {
      tmp.setSize(w, h);
    },
    dispose() {},
    render(renderer, write, read) {
      const u = mat.uniforms,
        sun = G.scene.children.find((o) => o.isDirectionalLight);
      u.tColor.value = read.texture;
      u.tDepth.value = read.depthTexture;
      u.uProj.value.copy(G.camera.projectionMatrix);
      u.uProjInv.value.copy(G.camera.projectionMatrixInverse);
      if (sun) {
        sunV.subVectors(sun.position, sun.target.position).normalize().transformDirection(G.camera.matrixWorldInverse);
        u.uSunV.value.copy(sunV);
        u.uSunCol.value.copy(sun.color);
      }
      if (G.scene.fog) u.uSky.value.copy(G.scene.fog.color);
      const s = Math.sin((G.world.time - 0.25) * Math.PI * 2);
      u.uDay.value = Math.max(0, Math.min(1, (s + 0.1) / 0.3));
      quad.material = mat;
      renderer.setRenderTarget(tmp);
      renderer.render(scene, cam);
      copy.uniforms.tColor.value = tmp.texture;
      quad.material = copy;
      const auto = renderer.autoClear;
      renderer.autoClear = false; // keep the scene depth that later passes read
      renderer.setRenderTarget(read);
      renderer.render(scene, cam);
      renderer.autoClear = auto;
    },
  };
  let wired = null;
  function wire() {
    const comp = G.composer();
    if (!comp || comp === wired) return;
    wired = comp;
    // the pass needs to read scene depth, so both of the composer's buffers get a depth texture
    for (const rt of [comp.renderTarget1, comp.renderTarget2]) {
      rt.depthTexture = new T.DepthTexture(rt.width, rt.height);
      rt.dispose();
    }
    comp.insertPass(pass, 1);
  }
  window.__relight = { pass, mat, wire };
  const tick = () => {
    wire();
    requestAnimationFrame(tick);
  };
  tick();
})();
