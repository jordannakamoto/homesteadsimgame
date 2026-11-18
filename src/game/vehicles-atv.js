// The homestead's vehicles as the player sees them: the utility ATV's procedural model (proportions of a mid-size 4x4
// utility quad: 2.15 m long, 1.20 m wide, seat at 0.89 m, 24 in tyres, racks front and rear), what the ground under a
// wheel is called (for grip: dry or wet grass, packed or loose dirt, mud, gravel, mulch, sand, snow, water, floors),
// and the starter ATV parked by the old well, once per world. Registers with window.__vehicles (src/engine/vehicles.js).
(() => {
  const G = window.__game, V = window.__vehicles;
  if (!G || !V) return;

  const C = {
    green: 0x56693f, greenDk: 0x45552f, frame: 0x2a2c2e, black: 0x1c1d1e, seat: 0x17181a, metal: 0x80858a,
    engine: 0x4a4e52, rack: 0x2f3235, light: 0xe6ddb4, red: 0x7a2420, spring: 0xa95d2c, hub: 0xb4ae9e, tyre: 0x232323,
  };
  // [w, h, d, x, y, z, colour, rx, ry, rz]: x right, y up from the ground, z forward, metres
  const mirror = (parts) => parts.flatMap((p) => [p, [p[0], p[1], p[2], -p[3], p[4], p[5], p[6], p[7] || 0, -(p[8] || 0), -(p[9] || 0)]]);
  function atvBody() {
    const tube = 0.03;
    return [
      // frame, engine, exhaust
      [0.5, 0.04, 1.05, 0, 0.255, 0.02, C.frame],
      ...mirror([[0.05, 0.06, 1.6, 0.2, 0.33, 0, C.frame]]),
      [0.36, 0.28, 0.42, 0, 0.42, 0, C.engine],
      [0.26, 0.14, 0.24, 0, 0.6, 0.08, C.metal, -0.3],
      [0.08, 0.22, 0.34, -0.22, 0.42, 0.02, C.engine],
      [0.06, 0.06, 0.6, 0.2, 0.52, -0.5, C.metal],
      [0.11, 0.11, 0.32, 0.25, 0.62, -0.8, 0x3a3c3e],
      // tank, seat, side covers
      [0.36, 0.16, 0.36, 0, 0.8, 0.2, C.green],
      [0.08, 0.04, 0.08, 0, 0.9, 0.24, C.black],
      [0.34, 0.11, 0.66, 0, 0.83, -0.32, C.seat],
      [0.4, 0.14, 0.62, 0, 0.71, -0.32, C.greenDk],
      // nose, headlight, winch
      [0.52, 0.2, 0.42, 0, 0.66, 0.74, C.green],
      [0.3, 0.09, 0.05, 0, 0.67, 0.96, C.light],
      [0.2, 0.09, 0.1, 0, 0.45, 0.98, C.frame],
      // fenders over the wheels, with their lips
      ...mirror([
        [0.36, 0.05, 0.62, 0.43, 0.73, 0.66, C.green],
        [0.36, 0.14, 0.05, 0.43, 0.67, 0.96, C.green, 0.5],
        [0.38, 0.05, 0.64, 0.43, 0.73, -0.65, C.green],
        [0.38, 0.14, 0.05, 0.43, 0.67, -0.97, C.green, -0.5],
      ]),
      [0.52, 0.12, 0.5, 0, 0.72, -0.72, C.green],
      [0.14, 0.05, 0.03, 0, 0.7, -0.99, C.red],
      // footwells and their guards
      ...mirror([[0.22, 0.04, 0.5, 0.36, 0.37, -0.02, C.black], [0.04, 0.18, 0.5, 0.47, 0.44, -0.02, C.black]]),
      // front rack
      ...mirror([[tube, tube, 0.46, 0.26, 0.86, 0.72, C.rack], [tube, 0.12, tube, 0.26, 0.8, 0.52, C.rack]]),
      ...[0.5, 0.72, 0.94].map((z) => [0.56, tube, tube, 0, 0.86, z, C.rack]),
      // rear rack
      ...mirror([[tube, tube, 0.6, 0.3, 0.9, -0.66, C.rack], [tube, 0.12, tube, 0.3, 0.84, -0.4, C.rack]]),
      ...[-0.38, -0.66, -0.95].map((z) => [0.63, tube, tube, 0, 0.9, z, C.rack]),
      // bumper, arms, shocks, hitch
      [0.52, 0.05, 0.05, 0, 0.5, 1.06, C.rack],
      ...mirror([
        [0.04, 0.25, 0.04, 0.2, 0.55, 1.04, C.rack],
        [0.36, 0.04, 0.06, 0.27, 0.36, 0.65, C.frame],
        [0.36, 0.04, 0.06, 0.27, 0.36, -0.65, C.frame],
        [0.05, 0.3, 0.05, 0.3, 0.52, 0.6, C.spring, 0, 0, 0.4],
        [0.05, 0.32, 0.05, 0.3, 0.53, -0.6, C.spring, 0, 0, 0.4],
      ]),
      [0.06, 0.06, 0.18, 0, 0.42, -1.04, C.frame],
      [0.07, 0.07, 0.07, 0, 0.47, -1.12, C.metal],
    ];
  }
  const BARS_AT = [0, 0.98, 0.38];
  function atvBars() {
    return [
      [0.04, 0.24, 0.04, 0, -0.1, -0.03, C.frame, 0.35],
      [0.72, 0.035, 0.035, 0, 0.05, 0, C.rack],
      ...mirror([[0.11, 0.045, 0.045, 0.33, 0.05, 0, C.black], [0.12, 0.015, 0.02, 0.27, 0.04, 0.05, C.metal]]),
      [0.16, 0.07, 0.09, 0, 0.07, 0.02, C.black],
    ];
  }
  // one wheel: a ten-sided tyre with eight tread lugs and a pale hub, so you can see it turn
  function wheelGeo(T, r, w) {
    const tyre = new T.CylinderGeometry(r - 0.02, r - 0.02, w, 10); tyre.rotateZ(Math.PI / 2);
    const hub = new T.CylinderGeometry(r * 0.5, r * 0.5, w + 0.01, 8); hub.rotateZ(Math.PI / 2);
    const list = [[tyre, null, C.tyre], [hub, null, C.hub]];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, m = new T.Matrix4().makeRotationX(a).multiply(new T.Matrix4().makeTranslation(0, r - 0.025, 0));
      list.push([new T.BoxGeometry(w * 0.9, 0.05, 0.08), m, i % 2 ? 0x2b2b2b : C.tyre]);
    }
    return window.__parts.mergeGeo(T, list);
  }
  function atv(T, h, kind) {
    const mat = () => new T.MeshLambertMaterial({ vertexColors: true });
    const body = new T.Mesh(h.boxModel(atvBody()), mat());
    const bars = new T.Group(), barsMesh = new T.Mesh(h.boxModel(atvBars()), mat());
    bars.position.set(BARS_AT[0], BARS_AT[1], BARS_AT[2]); bars.add(barsMesh);
    const wheels = new T.InstancedMesh(wheelGeo(T, kind.wheelR, 0.23), mat(), 4);
    return {
      body, bars, wheels,
      grips: [[-0.33, BARS_AT[1] + 0.05, BARS_AT[2]], [0.33, BARS_AT[1] + 0.05, BARS_AT[2]]],
      feet: [[-0.34, 0.39, -0.05], [0.34, 0.39, -0.05]],
    };
  }

  // ---- what the ground is under a wheel, by the names in the vehicles system's surfaces table
  const LAYER = { gravel: 'gravel', crushed: 'gravel', dg: 'gravel', slate: 'gravel', marble: 'gravel', lava: 'gravel', riverrock: 'gravel', woodchips: 'mulch', bark: 'mulch', sand: 'sand' };
  function surface(x, z) {
    const st = G.sim.state, wx = st.sys.weather, wet = !!wx && wx.rainMmH > 0.1;
    if (wx && wx.snowDepthM > 0.03) return 'snow';
    const sw = G.streamWaterAt(x, z);
    if ((sw && sw.depth > 0.03) || G.heightAt(x, z) < G.sea) return 'water';
    const L = G.landscape, rel = L ? L.reliefAt(st, x, z) : 0, th = G.heightAt(x, z) + rel;
    if (G.groundAt(x, z, th + 0.5) > th + 0.05) return 'floor';
    const q = L && L.groundAt(st, x, z), s = q && q.s;
    if (!s) return wet ? 'grass_wet' : 'grass';
    if (LAYER[s]) return LAYER[s];
    if (s === 'lawn_sown' || s === 'soil' || s === 'bedmix') return wet ? 'mud' : q.tamped ? 'dirt' : 'dirt_loose';
    return wet ? 'grass_wet' : 'grass';
  }

  V.register({ models: { atv }, surface });

  // ---- the starter ATV: once per world, parked a few steps past the old well (or by you in a world without one)
  let given = null, wait = 0;
  G.stepHooks.push((dt) => {
    const sim = G.sim, s = sim.state.sys.vehicles;
    if (!s || s.starter || given === sim || (wait -= dt) > 0) return;
    given = sim;
    const P = G.player, bench = sim.state.sys.plumbing && sim.state.sys.plumbing.yard && sim.state.sys.plumbing.yard.bench;
    const near = bench ? { x: bench.x, z: bench.z } : { x: P.x, z: P.z };
    const spot = V.findSpot(near.x, near.z, { rMin: bench ? 4.5 : 4, rMax: 9, rad: 1.4, away: bench ? { x: P.x, z: P.z } : null })
      || V.findSpot(P.x, P.z, { rMin: 4, rMax: 14, rad: 1.3 });
    if (!spot) { given = null; wait = 2; return; }     // nowhere clear yet: try again in a moment
    sim.commandNow('vehicles.add', { kind: 'atv', x: spot.x, z: spot.z, yaw: spot.yaw, starter: true });
  });
})();
