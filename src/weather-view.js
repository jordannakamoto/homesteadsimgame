/* Weather view: rain and snow near the camera and the weather readout in the
   status bar. Draws the simulation's weather (sim.state.sys.weather); owns no truth of its own.
   Reaches the game only through window.__game. */
(() => {
  const G = window.__game;
  if (!G || !G.sim) return;
  const T = G.THREE,
    $ = (id) => document.getElementById(id),
    clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const W = () => G.sim.state.sys.weather;

  /* ================= falling rain and snow =================
     One pooled buffer each, animated entirely in the vertex shader from a time uniform: the CPU sets a
     handful of uniforms per frame and the draw range follows the intensity. Hidden when nothing falls. */
  const RAIN_MAX = 5000,
    SNOW_MAX = 10000,
    BOX = 34; // metres across the volume around the view
  const rnd = (() => {
    let a = 0x9e3779b9; // cosmetic only, so a fixed local generator is fine
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const shared = {
    uTime: { value: 0 },
    uCenter: { value: new T.Vector3() },
    uBox: { value: new T.Vector3(BOX, 20, BOX) },
    uWind: { value: new T.Vector2() },
    uLight: { value: new T.Color(1, 1, 1) },
    uCam: { value: new T.Vector3() },
    uFar: { value: 30 },
  };
  const VERT_COMMON = `
    uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform vec2 uWind; uniform vec3 uCam; uniform float uFar;
    attribute vec4 seed; varying float vFade;
    vec3 place(float fall, float drift) {
      // each particle loops through a box that follows the view; wind carries it sideways as it falls
      float h = fract(seed.z - uTime * fall / uBox.y);
      vec2 xz = seed.xy * uBox.xz + uWind * (uTime * drift) - uCenter.xz;
      xz = mod(xz, uBox.xz) - 0.5 * uBox.xz + uCenter.xz;
      return vec3(xz.x, uCenter.y + (h - 0.5) * uBox.y, xz.y);
    }`;
  // fade in past the lens and out beyond the player, so the volume never shows its edges
  const FADE = "float d = distance(p, uCam); vFade = smoothstep(1.5, 4.0, d) * (1.0 - smoothstep(uFar * 0.75, uFar, d));";

  // rain: thin streaks, the length of the drop's travel in about a 30th of a second
  const rainGeo = new T.BufferGeometry();
  {
    const pos = new Float32Array(RAIN_MAX * 2 * 3),
      seed = new Float32Array(RAIN_MAX * 2 * 4);
    for (let i = 0; i < RAIN_MAX; i++) {
      const s = [rnd(), rnd(), rnd(), 0.8 + 0.4 * rnd()];
      for (let k = 0; k < 2; k++) {
        seed.set(s, (i * 2 + k) * 4);
        pos[(i * 2 + k) * 3 + 1] = k; // 0 = head, 1 = tail
      }
    }
    rainGeo.setAttribute("position", new T.BufferAttribute(pos, 3));
    rainGeo.setAttribute("seed", new T.BufferAttribute(seed, 4));
    rainGeo.boundingSphere = new T.Sphere(new T.Vector3(), 1e6);
  }
  const rainMat = new T.ShaderMaterial({
    uniforms: { ...shared, uAlpha: { value: 0 } },
    transparent: true,
    depthWrite: false,
    vertexShader:
      VERT_COMMON +
      `
      void main() {
        float fall = 8.0 * seed.w;                       // m/s, a raindrop near terminal velocity
        vec3 p = place(fall, 1.0);
        vec3 v = vec3(uWind.x, -fall, uWind.y);
        p -= v * (position.y * 0.03);                   // the tail trails behind the head
        ${FADE}
        vFade *= 1.0 - 0.6 * position.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform float uAlpha; uniform vec3 uLight; varying float vFade;
      void main() { gl_FragColor = vec4(uLight * vec3(0.75, 0.8, 0.86), uAlpha * vFade); }`,
  });
  const rain = new T.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.renderOrder = 8;
  rain.visible = false;

  // snow: soft round flakes that drift and sway
  const snowGeo = new T.BufferGeometry();
  {
    const pos = new Float32Array(SNOW_MAX * 3),
      seed = new Float32Array(SNOW_MAX * 4);
    for (let i = 0; i < SNOW_MAX; i++) seed.set([rnd(), rnd(), rnd(), 0.7 + 0.6 * rnd()], i * 4);
    snowGeo.setAttribute("position", new T.BufferAttribute(pos, 3));
    snowGeo.setAttribute("seed", new T.BufferAttribute(seed, 4));
    snowGeo.boundingSphere = new T.Sphere(new T.Vector3(), 1e6);
  }
  const snowMat = new T.ShaderMaterial({
    uniforms: { ...shared, uAlpha: { value: 0 }, uPx: { value: 600 } },
    transparent: true,
    depthWrite: false,
    vertexShader:
      VERT_COMMON +
      `
      uniform float uPx;
      void main() {
        float fall = 1.0 * seed.w;                       // m/s, a snowflake
        vec3 p = place(fall, 1.0);
        float ph = seed.x * 40.0 + uTime * (0.6 + seed.y);
        p.xz += 0.35 * vec2(sin(ph), cos(ph * 0.8));      // flakes flutter as they fall
        ${FADE}
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uPx * 0.07 * (0.6 + 0.5 * seed.w) / -mv.z, 1.5, 9.0);   // flakes about 7 cm across, drawn larger than life
      }`,
    fragmentShader: `uniform float uAlpha; uniform vec3 uLight; varying float vFade;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.5, 1.0, r)) * uAlpha * vFade;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uLight, a);
      }`,
  });
  const snow = new T.Points(snowGeo, snowMat);
  snow.frustumCulled = false;
  snow.renderOrder = 8;
  snow.visible = false;
  G.scene.add(rain, snow);

  // Snow lying on the ground is drawn by the snow add-on (src/snow/), from the simulation's snowpack.

  /* ================= status bar readout ================= */
  const CMP = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const hm = (h) => {
    const m = Math.round((((h % 24) + 24) % 24) * 60);
    return String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  };
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const cf = (c) => Math.round(c * 1.8 + 32);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // one short word for the status bar; the detail panel says more
  function condition(w) {
    if (w.snowMmH > 0.05 && w.snowMmH >= w.rainMmH) return "Snow";
    if (w.rainMmH > 0.05) return "Rain";
    if (w.windMs > 8) return "Windy";
    if (w.cloud > 0.6) return "Cloudy";
    return "Clear";
  }
  function detail(w) {
    if (w.snowMmH > 0.05 && w.snowMmH >= w.rainMmH) return w.snowMmH > 1.5 ? "Heavy snow" : w.snowMmH < 0.3 ? "Light snow" : "Snow";
    if (w.rainMmH > 0.05) return w.rainMmH > 4 ? "Heavy rain" : w.rainMmH < 0.5 ? "Drizzle" : "Rain";
    const sky = w.cloud > 0.85 ? "Overcast" : w.cloud > 0.6 ? "Mostly cloudy" : w.cloud > 0.3 ? "Partly cloudy" : "Clear";
    return w.windMs > 8 ? sky + ", windy" : sky;
  }
  const btn = $("wxbtn"),
    panel = $("wxpanel");
  let open = false;
  function setOpen(v) {
    open = v;
    if (panel) panel.hidden = !v;
    if (btn) btn.setAttribute("aria-expanded", v ? "true" : "false");
    hud(true);
  }
  if (btn) btn.addEventListener("click", () => { setOpen(!open); $("view") && $("view").focus(); });
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyY" && !e.repeat && G.player.tool !== "build" && !(e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))) setOpen(!open);
  });
  const yearSel = $("wxyear");
  if (yearSel) yearSel.addEventListener("change", () => { if (G.setYearDays) G.setYearDays(+yearSel.value); const v = document.getElementById("view"); if (v) v.focus(); });
  const sel = $("wxclimate");
  if (sel) {
    sel.addEventListener("change", () => {
      try { G.sim.command("weather.setSite", { climate: sel.value }); } catch (err) { /* unknown climate: ignore */ }
      sel.blur();
    });
  }
  const last = {};
  const put = (id, text) => {
    if (last[id] !== text) {
      const e = $(id);
      if (e) e.textContent = text;
      last[id] = text;
    }
  };
  function hud(force) {
    const w = W(),
      C = G.calendar;
    if (!w || !C) return;
    const t = G.sim.calendarT ? G.sim.calendarT() : G.sim.state.t,
      doy = C.dayOfYear(t),
      m = C.monthOf(doy),
      sea = C.season(t, w.site);
    put("wxdate", C.dayOfMonth(doy) + " " + MON[m]);
    put("wxtemp", Math.round(w.tempC) + "°C");
    put("wxcond", condition(w));
    if (btn) btn.title = "Weather: " + C.dateText(t) + ", " + sea + " (Y)";
    if (!open && !force) return;
    const st = C.sunTimes(t, w.site),
      dir = CMP[Math.round(w.windDirRad / (Math.PI / 4)) % 8];
    put("wxd-date", C.dateText(t) + " \u00b7 " + sea[0].toUpperCase() + sea.slice(1) + " \u00b7 " + detail(w));
    put("wxd-temp", f1(w.tempC) + " °C  (" + cf(w.tempC) + " °F)");
    put("wxd-hum", Math.round(w.humidity * 100) + "%  ·  dew point " + f1(w.dewPointC) + " °C (" + cf(w.dewPointC) + " °F)");
    put("wxd-wind", f1(w.windMs) + " m/s from the " + dir + "  (" + Math.round(w.windMs * 3.6) + " km/h)");
    put("wxd-cloud", Math.round(w.cloud * 100) + "%  ·  " + Math.round(w.pressureHPa) + " hPa");
    put("wxd-rain", w.snowMmH > 0.05 ? f1(w.snowMmH) + " mm/h of snow (water)" : f1(w.rainMmH) + " mm/h");
    put("wxd-snow", w.snowDepthM > 0.005 ? Math.round(w.snowDepthM * 100) + " cm" : "none");
    put("wxd-sun", st.dayLengthH >= 23.99 ? "up all day" : st.dayLengthH <= 0.01 ? "does not rise" : hm(st.sunriseH) + " – " + hm(st.sunsetH));
    put("wxd-len", Math.floor(st.dayLengthH) + " h " + String(Math.round((st.dayLengthH % 1) * 60) % 60).padStart(2, "0") + " min");
    put("wxd-sol", Math.round(w.solar.globalHorizontalWm2) + " W/m²");
    put("wxd-soil", f1(w.groundTempC) + " °C (" + cf(w.groundTempC) + " °F)");
    if (sel && document.activeElement !== sel && sel.value !== w.site.climate) sel.value = w.site.climate;
    if (yearSel && document.activeElement !== yearSel && +yearSel.value !== G.sim.state.yearDays) yearSel.value = String(G.sim.state.yearDays);
    put("wxd-lat", Math.abs(w.site.latitudeDeg).toFixed(1) + "° " + (w.site.latitudeDeg >= 0 ? "N" : "S"));
  }

  /* ================= per frame ================= */
  let prev = performance.now(),
    hudT = 0,
    cost = 0,
    costN = 0;
  const hemi = (() => {
    let h = null;
    G.scene.traverse((o) => { if (o.isHemisphereLight) h = o; });
    return h;
  })();
  const _v = new T.Vector3(),
    _d = new T.Vector3();
  let rainK = 0,
    snowK = 0,
    windX = 0,
    windZ = 0;
  function update(dt) {
    const w = W();
    if (w) {
      // ease toward the simulation's values so a step of the weather never pops on screen
      const e = 1 - Math.exp(-dt * 1.5);
      rainK += (clamp(Math.pow(w.rainMmH / 8, 0.6), 0, 1) - rainK) * e;
      snowK += (clamp(Math.pow(w.snowMmH / 2.5, 0.6), 0, 1) - snowK) * e;
      // wind blows from windDirRad (clockwise from north); world +x is east and +z is south
      const s = Math.min(w.windMs, 16) * 0.35;   // the wind is slower near the ground where we see the rain
      windX += (-Math.sin(w.windDirRad) * s - windX) * e;
      windZ += (Math.cos(w.windDirRad) * s - windZ) * e;
      const cam = G.camera,
        P = G.player;
      shared.uTime.value = (shared.uTime.value + dt) % 3600;
      shared.uWind.value.set(windX, windZ);
      shared.uCam.value.copy(cam.position);
      shared.uFar.value = Math.hypot(cam.position.x - P.x, cam.position.y - P.y, cam.position.z - P.z) + 8;
      // the volume sits between the camera and the player, from above the camera down to the ground
      cam.getWorldDirection(_d);
      _v.copy(cam.position).addScaledVector(_d, 9);
      _v.x = (_v.x + P.x) / 2;
      _v.z = (_v.z + P.z) / 2;
      const top = cam.position.y + 6,
        bot = Math.min(P.y, cam.position.y) - 3;
      shared.uBox.value.y = top - bot;
      shared.uCenter.value.set(_v.x, (top + bot) / 2, _v.z);
      if (hemi) shared.uLight.value.copy(hemi.color).multiplyScalar(0.55 + 0.45 * Math.min(1.4, hemi.intensity));
      const low = G.quality && G.quality() === "low" ? 0.6 : 1;
      rain.visible = rainK > 0.01;
      snow.visible = snowK > 0.01;
      if (rain.visible) {
        rainGeo.setDrawRange(0, 2 * Math.ceil(RAIN_MAX * low * rainK));
        rainMat.uniforms.uAlpha.value = 0.18 + 0.14 * rainK;
      }
      if (snow.visible) {
        snowGeo.setDrawRange(0, Math.ceil(SNOW_MAX * low * snowK));
        snowMat.uniforms.uAlpha.value = 0.9;
        snowMat.uniforms.uPx.value = G.renderer.domElement.height / (2 * Math.tan((cam.fov * Math.PI) / 360));   // focal length in pixels
      }
      hudT += dt;
      if (hudT > 0.5) { hudT = 0; hud(false); }
    }
  }
  function frame(now) {
    const t0 = performance.now();
    update(Math.min(0.1, Math.max(0, (now - prev) / 1000)));
    prev = now;
    cost += performance.now() - t0;
    costN++;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // the snow on the ground is the snow add-on's; its readings are passed on here for older callers
  const groundInfo = () => {
    const i = window.__snow ? window.__snow.info() : null, w = W();
    return { groundSnow: i ? i.groundSnow : clamp(((w && w.snowDepthM) || 0) / 0.12, 0, 1), groundPatched: i ? !!i.groundPatched : false };
  };
  // for tests and screenshots: what the view is drawing, and its CPU cost per frame
  window.__weatherView = {
    info: () => ({ rain: rain.visible ? rainGeo.drawRange.count / 2 : 0, snow: snow.visible ? snowGeo.drawRange.count : 0, ...groundInfo(), msPerFrame: costN ? cost / costN : 0 }),
    resetCost: () => { cost = 0; costN = 0; },
    bench: (n = 2000) => { const t0 = performance.now(); for (let i = 0; i < n; i++) update(1 / 144); return (performance.now() - t0) / n; },
    settle: () => { const w = W(); if (!w) return; rainK = clamp(Math.pow(w.rainMmH / 8, 0.6), 0, 1); snowK = clamp(Math.pow(w.snowMmH / 2.5, 0.6), 0, 1); },
    open: setOpen,
    parts: { rain, snow, shared },
  };
})();
