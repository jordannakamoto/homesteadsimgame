// The homestead's vehicles as the player sees them: the utility ATV's procedural model (proportions of a mid-size 4x4
// utility quad: 2.15 m long, 1.20 m wide, seat at 0.89 m, 24 in tyres, racks front and rear), what the ground under a
// wheel is called (for grip: dry or wet grass, packed or loose dirt, mud, gravel, mulch, sand, snow, water, floors),
// the starter ATV parked by the old well, once per world, the trailer delivered from the Supplier, delivery fuel top-ups and
// pouring from the fuel can (hold R beside the ATV). Registers with window.__vehicles (src/engine/vehicles.js).
// The small utility trailer: its model (a steel dump bed on an A-frame, two wheels), the lumber on its bed (construction
// stacks flagged `carrier`, drawn through __vehicles.setCargo and kept under the trailer with construction.carrierMove),
// tipping the load off (construction.carrierUnload).
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

  // ---- the small trailer: [w, h, d, x, y, z] in its frame (origin on the ground under the middle of the axle, z forward)
  const TC = { bed: 0x3d4a3f, rail: 0x2f3833, frame: 0x26282a, metal: 0x80858a, black: 0x1c1d1e, amber: 0xc98a2a, red: 0x8a2a22, plank: 0x7a6a52 };
  function trailerBody() {
    return [
      [1.2, 0.06, 0.06, 0, 0.25, 0, TC.frame],                                   // the axle
      ...mirror([
        [0.06, 0.07, 1.5, 0.42, 0.4, 0.12, TC.frame],                           // rails under the bed
        [0.05, 0.06, 1.12, 0.17, 0.4, 1.14, TC.frame, 0, -0.25],               // the A-frame, meeting at the coupler
        [0.17, 0.035, 0.5, 0.68, 0.54, 0, TC.rail],                             // fenders over the wheels, outside the bed
        [0.17, 0.12, 0.035, 0.68, 0.49, 0.25, TC.rail, 0.5],
        [0.17, 0.12, 0.035, 0.68, 0.49, -0.25, TC.rail, -0.5],
        [0.06, 0.15, 0.06, 0.42, 0.33, 0, TC.frame],                           // spring hangers
      ]),
      [0.9, 0.06, 0.06, 0, 0.4, 0.62, TC.frame],                                // cross members
      [0.9, 0.06, 0.06, 0, 0.4, -0.55, TC.frame],
      [0.08, 0.08, 0.2, 0, 0.42, 1.6, TC.metal],                                // the coupler and its latch
      [0.04, 0.05, 0.06, 0, 0.48, 1.58, TC.black],
      [0.05, 0.42, 0.05, 0.08, 0.21, 1.32, TC.frame],                          // the jack post and its foot
      [0.12, 0.02, 0.12, 0.08, 0.01, 1.32, TC.frame],
      [0.08, 0.05, 0.05, 0.08, 0.45, 1.32, TC.black],
      [0.06, 0.1, 0.06, 0, 0.47, 0.9, TC.frame],                                // the bed's front rest and its pin
      [0.1, 0.05, 0.03, 0, 0.53, 0.94, TC.amber],
    ];
  }
  function trailerBed() {
    return [
      [1.1, 0.04, 1.8, 0, 0.48, 0, TC.bed],                                     // the floor; the load lies on y 0.5
      ...mirror([
        [0.04, 0.3, 1.8, 0.57, 0.65, 0, TC.bed],                                // sides with a top rail
        [0.06, 0.04, 1.82, 0.57, 0.81, 0, TC.rail],
        [0.03, 0.04, 0.03, 0.57, 0.62, -0.91, TC.red],                          // tail reflectors
        [0.05, 0.22, 0.05, 0.57, 0.6, 0.6, TC.rail], [0.05, 0.22, 0.05, 0.57, 0.6, -0.3, TC.rail],
      ]),
      [1.18, 0.34, 0.04, 0, 0.66, 0.92, TC.bed],                               // the front board
      [1.18, 0.04, 0.06, 0, 0.83, 0.92, TC.rail],
      [1.1, 0.3, 0.035, 0, 0.36, -0.93, TC.bed],                               // the tailgate, hung down open for long loads
      [1.0, 0.06, 0.06, 0, 0.44, -0.3, TC.frame],                               // the pivot tube
      [0.6, 0.05, 0.04, 0, 0.53, 0.86, TC.metal],                               // the release lever
    ];
  }
  function trailer(T, h, kind) {
    const mat = () => new T.MeshLambertMaterial({ vertexColors: true });
    const body = new T.Mesh(h.boxModel(trailerBody()), mat());
    const bed = new T.Mesh(h.boxModel(trailerBed()), mat());
    const wheels = new T.InstancedMesh(wheelGeo(T, kind.wheelR, 0.18), mat(), 2);
    return { body, bed, wheels };
  }

  // ---- the load on a trailer: construction stacks flagged `carrier`, drawn on the bed and kept under the trailer
  const consys = () => G.sim.systems.find((q) => q.name === 'construction');
  let cargoSig = '', cargoGen = -1;
  function cargoTick() {
    const s = G.sim.state.sys.construction, CV = window.__construct, sys = consys();
    if (!s || !CV || !CV.describe || !sys) return;
    const cat = sys.api.catalog, units = V.units(), kinds = V.kinds();
    let sig = '';
    for (const k of s.stacks) if (k.carrier != null) sig += k.carrier + ':' + k.itemId + ':' + k.qty + ',';
    // the load follows its trailer (the sim's pose of it changes on sync, hitching and parking); a load whose
    // trailer is gone is left on the ground where it stood
    for (const k of s.stacks) {
      if (k.carrier == null) continue;
      const u = units[k.carrier];
      if (!u) { G.sim.commandNow('construction.carrierUnload', { carrier: k.carrier, x: k.x, z: k.z }); return; }
      if (Math.abs(u.x - k.x) > 0.02 || Math.abs(u.z - k.z) > 0.02) G.sim.commandNow('construction.carrierMove', { carrier: k.carrier, x: u.x, z: u.z });
    }
    if (sig === cargoSig && V.gen === cargoGen) return;
    cargoSig = sig; cargoGen = V.gen;
    for (const id in units) {
      if (!kinds[units[id].kind] || !kinds[units[id].kind].cargo) continue;
      let kg = 0;
      const groups = [];
      for (const k of s.stacks) {
        if (k.carrier !== id) continue;
        const d = CV.describe(k.itemId, k.qty), it = cat[k.itemId];
        kg += k.qty * (it ? it.massKgPerUnit : 0);
        groups.push({ n: d.form === 'ladder' ? 1 : d.n, w: d.w, h: d.h * (d.scaleH || 1), l: d.l, color: d.color });
      }
      V.setCargo(id, groups, kg);
    }
    cargoGen = V.gen;
  }
  // tipped: the load slides off the tail and lies on the ground there as an ordinary pile
  function onDump(id, at) {
    const r = G.sim.commandNow('construction.carrierUnload', { carrier: id, x: at.x, z: at.z });
    return !!(r && r.ok);
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

  V.register({ models: { atv, trailer_small: trailer }, surface, onDump });
  G.stepHooks.push(cargoTick);

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
  // ---- the trailer is bought at the Supplier (U): the purchase sits in stock for a few seconds, then arrives at the drop point
  // (where the lumber lands; by the ATV when nothing has been ordered yet) as a unit of its own. Old saves keep the trailer
  // they were given; none is given any more.
  const ARRIVE_S = 4;
  let deliverWait = 0;
  function deliverBought(dt) {
    const sim = G.sim, st = sim.state.sys.stock, s = sim.state.sys.vehicles;
    if (!st || !s || !((st.items.trailer_small || 0) >= 1)) { deliverWait = 0; return; }
    if ((deliverWait += dt) < ARRIVE_S) return;
    const cs = sim.state.sys.construction, drop = cs && cs.dropPoint, P = G.player;
    const atv = Object.values(s.units).find((u) => u.kind === 'atv');
    const c = drop || (atv ? { x: atv.x, z: atv.z } : { x: P.x, z: P.z });
    // beside the drop point, clear of the stacks that run along +x from it
    const spot = V.findSpot(c.x, c.z + 3, { rMin: 0, rMax: 7, rad: 1.2, n: 48 }) || V.findSpot(P.x, P.z, { rMin: 4, rMax: 14, rad: 1.2 });
    if (!spot) { deliverWait = ARRIVE_S - 2; return; }
    const r = sim.commandNow('vehicles.deliver', { kind: 'trailer_small', x: spot.x, z: spot.z, yaw: atv ? atv.yaw : spot.yaw });
    deliverWait = 0;
    if (r.ok) V.say(drop ? 'Your trailer has been delivered to the drop point.' : 'Your trailer has been delivered.', 5);
  }
  // ---- fuel: a delivery tops the tank up (a setting, on unless switched off: __vehicles.topUp(false)); a can pours the rest
  let listening = null, topPending = false;
  function listen() {
    if (listening === G.sim) return;
    listening = G.sim;
    G.sim.listen((type) => { if (type === 'construction.delivered' || type === 'vehicles.delivered') topPending = true; });
  }
  function topUp() {
    if (!topPending) return;
    topPending = false;
    const r = G.sim.commandNow('vehicles.topUp', {});
    if (r && r.litres > 0) V.say('The delivery driver topped up the ATV: ' + r.litres.toFixed(1) + ' L.', 4);
  }
  V.topUp = (on) => { const r = G.sim.commandNow('vehicles.setOption', { topUp: !!on }); return r.ok ? !!on : r; };
  V.topUpOn = () => { const o = G.sim.state.sys.vehicles.options; return !(o && o.topUp === false); };

  // Pouring: on foot with the axe, the fuel can owned and gasoline in stock, stand beside the ATV and hold R (touch: the
  // "Pour fuel" button). The can's spout runs at kind.fuel.pourLps litres a second, taken from stock through vehicles.refuel
  // in 0.1 s portions, so the stock, the tank and the fuel books all move together; the prompt shows the litres.
  let pourKey = false, pourBtn = false, pourAcc = 0, pourT = 0, poured = 0, pourSay = 0, near = null, pouring = false;
  const REACH_M = 1.6;                                       // from the body's edge
  function nearFuelUnit() {
    if (V.driven() || !G.control.walking() || G.player.tool !== 'axe' || (window.__build && window.__build.state.on)) return null;
    const s = G.sim.state.sys.vehicles, P = G.player, K = V.kinds();
    let best = null, bd = Infinity;
    for (const u of Object.values(s.units)) {
      const k = K[u.kind];
      if (!k.fuel || u.owner !== 'own') continue;
      const d = Math.hypot(P.x - u.x, P.z - u.z) - Math.min(k.dims.l, k.dims.w * 1.4) / 2;
      if (d < REACH_M && d < bd) { bd = d; best = u; }
    }
    return best;
  }
  function pourTick(dt) {
    const P = window.__ui && window.__ui.prompt;
    near = nearFuelUnit();
    const held = pourKey || pourBtn;
    if (!near) { if (pouring) { pouring = false; poured = 0; } if (P && P.hide) P.hide('fuel'); return; }
    const st = G.sim.state.sys.stock, k = V.kinds()[near.kind], room = k.fuel.tankL - near.fuelL, gas = st.items.gasoline || 0, can = st.tools.includes('fuel_can');
    if (pourSay > 0) pourSay -= dt;
    const full = room <= 0.05;
    if (!held) {
      if (pouring) { pouring = false; if (poured > 0.05) V.say('Poured ' + poured.toFixed(1) + ' L. The tank has ' + near.fuelL.toFixed(1) + ' L.', 3); poured = 0; }
      if (P && P.show) {
        if (!can) P.hide('fuel');
        else if (full) P.show({ text: 'The tank is full: ' + near.fuelL.toFixed(1) + ' L', owner: 'fuel' });
        else P.show({ key: 'R', text: gas > 0 ? 'Hold to pour fuel (' + near.fuelL.toFixed(1) + ' / ' + k.fuel.tankL + ' L)' : 'No gasoline: buy some at the Supplier (U)', owner: 'fuel' });
      }
      return;
    }
    if (!can) { if (pourSay <= 0) { V.say('You need a fuel can: the Supplier (U) sells one.', 3); pourSay = 3; } return; }
    if (full) { if (pouring) { pouring = false; V.say('The tank is full: ' + near.fuelL.toFixed(1) + ' L.', 3); poured = 0; } return; }
    if (gas <= 0) { if (pourSay <= 0) { V.say('No gasoline in stock: buy some at the Supplier (U).', 3); pourSay = 3; } pouring = false; return; }
    pouring = true; pourAcc += (k.fuel.pourLps || 0.4) * dt; pourT += dt;
    if (pourT >= 0.1 || pourAcc >= room) {
      pourT = 0;
      const want = Math.min(pourAcc, room, gas), r = G.sim.commandNow('vehicles.refuel', { id: near.id, litres: want });
      if (r.ok) { poured += r.litres; pourAcc = Math.max(0, pourAcc - r.litres); } else pourAcc = 0;
    }
    if (P && P.show) P.show({ key: 'R', text: 'Pouring ' + near.fuelL.toFixed(1) + ' / ' + k.fuel.tankL + ' L', progress: Math.min(1, near.fuelL / k.fuel.tankL), owner: 'fuel' });
  }
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyR' || V.driven()) return;
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    pourKey = true;
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'KeyR') pourKey = false; });
  window.addEventListener('blur', () => { pourKey = false; pourBtn = false; });
  window.__fuel = { press: (on) => { pourBtn = !!on; }, ready: () => !!near && (near.fuelL < V.kinds()[near.kind].fuel.tankL - 0.05), unit: () => near && near.id };

  G.stepHooks.push((dt) => {
    if (!G.sim.state.sys.vehicles) return;
    listen(); deliverBought(dt); topUp(); pourTick(dt);
  });
})();
