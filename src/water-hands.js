/* Water by hand (docs/FIRST_WATER.md): the yard a new plot starts with, and everything the player does to
   water with their hands. Content on top of the generic layers: __reach (pointer, reach, hint, poses) and
   __parts (kit parts that click together). It draws the well, the hand pump with its working handle and
   diverter lever, the barrel on its stand with a sight tube, the tap on its post, the bench and the kit box,
   the watering can set under whichever spout you stand at, streams, leak spray and wet ground.
   It owns no truth: strokes are water.pumpStroke, the can is garden.fill, the tap is water.setTap, the valve
   is parts.set, and whether water flows is whatever src/sim/water.js says.
   Cost: models are built once; the frame does nothing unless a handle is moving, water is running or a
   patch is drying. Sim read-outs are checked four times a second. No sound yet (owner: motion and particles only). */
(() => {
  const G = window.__game, RCH = window.__reach, PV = window.__parts;
  if (!G || !RCH || !PV || !G.sim || !G.sim.handlers.has('water.pumpStroke') || !G.sim.handlers.has('parts.fit')) return;
  const T = G.THREE, sim = G.sim, R0 = RCH.R;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const W = () => sim.state.sys.water, PL = () => sim.state.sys.plumbing, PT = () => sim.state.sys.parts, GD = () => sim.state.sys.garden;
  const cmd = (n, p) => sim.commandNow(n, p);
  const CAN_L = 9, STEP = 0.25;
  const hasCan = () => sim.state.sys.stock.tools.includes('watering_can');
  const mat = new T.MeshLambertMaterial({ vertexColors: true });
  const M4 = () => new T.Matrix4();
  const at = (x, y, z) => M4().makeTranslation(x, y, z);
  const alongX = (x0, x1, y = 0, z = 0) => M4().makeTranslation((x0 + x1) / 2, y, z).multiply(M4().makeRotationZ(-Math.PI / 2));
  const alongZ = (z0, z1, x = 0, y = 0) => M4().makeTranslation(x, y, (z0 + z1) / 2).multiply(M4().makeRotationX(Math.PI / 2));
  const cyl = (r, h, seg = 10, r2) => new T.CylinderGeometry(r2 ?? r, r, h, seg);
  const box = (w, h, d) => new T.BoxGeometry(w, h, d);
  const merge = (list) => PV.mergeGeo(T, list);
  const C = { pipe: 0xd5dde2, fit: 0xe38b2c, fitD: 0xb96a1c, brass: 0xc9a13b, red: 0xc8402f, green: 0x4fae5a, iron: 0x3b5d4c, ironD: 0x2a4236, wood: 0xa8824f, woodD: 0x8a6a3e, stone: 0x9a9a92, blue: 0x3f78b5, blueD: 0x2f5e92, water: 0x6fbdf0, card: 0xc9a56e, tin: 0xa9b6bd };

  /* ================= the kit's shapes (for __parts) ================= */
  const R_PIPE = 0.024, R_FIT = 0.04;
  const arm = (dir, len = 0.085) => {
    const m = dir[0] ? alongX(0, len * dir[0]) : dir[1] ? at(0, (len * dir[1]) / 2, 0) : alongZ(0, len * dir[2]);
    return [cyl(R_FIT, len, 10), m, C.fit];
  };
  const collar = (dir, d = 0.085) => {
    const m = dir[0] ? alongX(d * dir[0] - 0.012 * dir[0], d * dir[0] + 0.012 * dir[0]) : at(0, d * dir[1], 0);
    return [cyl(R_FIT + 0.008, 0.024, 10), m, C.fitD];
  };
  const SHAPES = {
    pipe: { geo: () => merge([[cyl(R_PIPE, 1, 10), alongX(0, 1), C.pipe]]), pick: 0.16, lift: R_PIPE, name: (p) => (p.len * STEP).toFixed(2).replace(/\.?0+$/, '') + ' m pipe' },
    elbow: { geo: () => merge([arm([1, 0, 0]), arm([0, 1, 0]), [new T.SphereGeometry(R_FIT * 1.05, 10, 8), null, C.fit], collar([1, 0, 0]), collar([0, 1, 0])]), pick: 0.24, rest: [Math.PI / 2, 0, 0], lift: R_FIT, name: () => 'elbow' },
    tee: { geo: () => merge([[cyl(R_FIT, 0.17, 10), alongX(-0.085, 0.085), C.fit], arm([0, 1, 0]), collar([1, 0, 0]), collar([-1, 0, 0]), collar([0, 1, 0])]), pick: 0.24, rest: [Math.PI / 2, 0, 0], lift: R_FIT, name: () => 'tee' },
    valve: { geo: (T_, v) => merge([[cyl(R_FIT, 0.2, 10), alongX(-0.1, 0.1), C.fit], [new T.SphereGeometry(0.058, 10, 8), null, C.fitD], collar([1, 0, 0], 0.1), collar([-1, 0, 0], 0.1),
      [cyl(0.014, 0.07, 6), at(0, 0.075, 0), C.tin], [box(v === 'open' ? 0.2 : 0.045, 0.03, v === 'open' ? 0.045 : 0.2), at(0, 0.115, 0), v === 'open' ? C.green : C.red]]),
      variantOf: (p) => (p.set && p.set.open ? 'open' : 'shut'), pick: 0.26, lift: R_FIT, name: () => 'valve' },
    coupling: { geo: () => merge([[cyl(R_FIT, 0.13, 10), alongX(-0.065, 0.065), C.fit], [cyl(R_FIT + 0.008, 0.03, 10), alongX(-0.015, 0.015), C.fitD]]), pick: 0.22, lift: R_FIT, name: () => 'coupling' },
    cap: { geo: () => merge([[cyl(R_FIT, 0.07, 10), alongX(-0.02, 0.05), C.fit], [new T.SphereGeometry(R_FIT, 10, 6), at(-0.02, 0, 0), C.fitD]]), pick: 0.22, lift: R_FIT, name: () => 'end cap' },
    port: { geo: () => merge([[cyl(R_FIT + 0.012, 0.035, 12), alongX(-0.03, 0.005), C.brass]]), pick: 0, name: () => 'connection' },
  };

  /* ================= the yard: found from the equipment the game placed ================= */
  let Y = null, yardV = -1;                    // { well, pump, barrel, tap: {id, x, y, z}, bench, kits }
  const yardG = new T.Group(); G.scene.add(yardG);
  const dyn = {};                              // moving bits: handle, lever, tapHandle, sight, can, canWater, streams
  function findYard() {
    const B = window.__build; if (!B || !B.pieces) return null;
    const out = {};
    for (const p of B.pieces()) {
      if (p.kind !== 'fixture' || !p.settings || !p.settings.viewOwned) continue;
      const key = { well_dug: 'well', hand_pump: 'pump', rain_barrel_200: 'barrel', tap_hose_bib: 'tap' }[p.fixture];
      if (key && !out[key]) out[key] = { id: p.id, x: p.a.x, y: p.y0, z: p.a.z };
    }
    return out.well && out.pump && out.barrel && out.tap ? out : null;
  }
  const mesh = (geo, m = mat) => { const o = new T.Mesh(geo, m); o.castShadow = o.receiveShadow = true; return o; };
  function buildYard() {
    for (const o of [...yardG.children]) { yardG.remove(o); o.traverse((c) => c.geometry && c.geometry.dispose()); }
    Y = findYard();
    if (!Y) return;
    const { well, pump, barrel, tap } = Y, gy = well.y;
    const pl = PL(); Y.bench = pl.yard && pl.yard.bench;
    const stat = [];
    // well: a stone ring with a plank cover
    stat.push([new T.CylinderGeometry(0.6, 0.66, 0.62, 16), at(well.x, gy + 0.31, well.z), C.stone], [cyl(0.64, 0.08, 16), at(well.x, gy + 0.66, well.z), C.wood]);
    for (let i = -2; i <= 2; i++) stat.push([box(1.2, 0.012, 0.012), at(well.x, gy + 0.703, well.z + i * 0.21), C.woodD]);
    // pump body (the handle and the lever are separate, they move)
    const px = pump.x, py = pump.y - 0.05, pz = pump.z;
    stat.push([cyl(0.1, 0.06, 12), at(px, py + 0.03, pz), C.ironD], [cyl(0.075, 0.5, 12), at(px, py + 0.3, pz), C.iron], [cyl(0.095, 0.05, 12), at(px, py + 0.57, pz), C.ironD],
      [cyl(0.035, 0.3, 8), alongZ(pz, pz + 0.3, px, py + 0.4), C.iron], [cyl(0.035, 0.07, 8), at(px, py + 0.375, pz + 0.3), C.ironD],
      [cyl(0.03, 0.26, 8), alongX(px, px + 0.25, py + 0.3, pz), C.iron], [box(0.05, 0.16, 0.05), at(px - 0.07, py + 0.62, pz), C.ironD]);
    // barrel on its stand, outlet stub at its foot, a white backing for the sight tube
    const bx = barrel.x, by = barrel.y, bz = barrel.z;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) stat.push([box(0.09, by - gy, 0.09), at(bx + sx * 0.27, gy + (by - gy) / 2, bz + sz * 0.27), C.wood]);
    for (const sz of [-1, 1]) stat.push([box(0.7, 0.07, 0.07), at(bx, gy + 0.55, bz + sz * 0.27), C.woodD], [box(0.07, 0.07, 0.6), at(bx + sz * 0.27, gy + 1.0, bz), C.woodD]);
    stat.push([box(0.74, 0.06, 0.74), at(bx, by - 0.03, bz), C.woodD], [cyl(0.3, 0.9, 16), at(bx, by + 0.45, bz), C.blue], [cyl(0.31, 0.04, 16), at(bx, by + 0.25, bz), C.blueD], [cyl(0.31, 0.04, 16), at(bx, by + 0.65, bz), C.blueD],
      [cyl(0.31, 0.03, 16), at(bx, by + 0.9, bz), C.blueD], [cyl(0.03, 0.24, 8), alongZ(bz + 0.26, bz + 0.5, bx, by), C.brass],
      [box(0.07, 0.86, 0.02), at(bx - 0.215, by + 0.45, bz + 0.225), 0xf4f1e6]);
    // tap on a post
    const tx = tap.x, ty = tap.y, tz = tap.z;
    stat.push([box(0.1, ty - gy + 0.45, 0.1), at(tx, gy + (ty - gy + 0.45) / 2, tz - 0.1), C.wood], [cyl(0.035, 0.2, 8), at(tx, ty + 0.1, tz), C.brass],
      [cyl(0.028, 0.16, 8), alongZ(tz, tz + 0.16, tx, ty + 0.16), C.brass], [cyl(0.028, 0.07, 8), at(tx, ty + 0.13, tz + 0.16), C.brass], [box(0.12, 0.04, 0.06), at(tx, ty + 0.06, tz - 0.04), C.woodD]);
    // bench
    if (Y.bench) {
      const b = Y.bench;
      stat.push([box(b.w, 0.06, b.d), at(b.x, b.y + b.h - 0.03, b.z), C.wood]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) stat.push([box(0.08, b.h - 0.06, 0.08), at(b.x + sx * (b.w / 2 - 0.08), b.y + (b.h - 0.06) / 2, b.z + sz * (b.d / 2 - 0.08)), C.woodD]);
      stat.push([box(b.w - 0.2, 0.05, 0.05), at(b.x, b.y + 0.25, b.z), C.woodD]);
    }
    yardG.add(mesh(merge(stat)));
    // handle: pivots on the pump head, the grip out toward -x
    dyn.handle = new T.Group(); dyn.handle.position.set(px - 0.07, py + 0.68, pz);
    dyn.handle.add(mesh(merge([[box(0.78, 0.045, 0.045), at(-0.3, 0, 0), C.ironD], [cyl(0.03, 0.16, 8), M4().makeTranslation(-0.68, 0, 0).multiply(M4().makeRotationX(Math.PI / 2)), C.wood], [box(0.03, 0.2, 0.03), at(0.07, -0.1, 0), C.tin]])));
    // diverter: a red lever on the pump's shoulder that points where the water goes (toward the spout, or toward the riser)
    dyn.lever = new T.Group(); dyn.lever.position.set(px, py + 0.5, pz);
    dyn.lever.add(mesh(merge([[box(0.035, 0.035, 0.2), at(0, 0.03, 0.14), C.red], [new T.SphereGeometry(0.035, 8, 6), at(0, 0.03, 0.25), C.red]])));
    dyn.tapHandle = new T.Group(); dyn.tapHandle.position.set(tx, ty + 0.21, tz);
    dyn.tapHandle.add(mesh(merge([[cyl(0.012, 0.05, 6), at(0, 0.025, 0), C.tin], [box(0.16, 0.025, 0.035), at(0, 0.06, 0), C.red]])));
    dyn.sight = mesh(merge([[box(0.045, 1, 0.012), at(0, 0.5, 0), C.water]])); dyn.sight.position.set(bx - 0.215, by + 0.03, bz + 0.238); dyn.sight.castShadow = false;
    dyn.can = new T.Group();
    dyn.can.add(mesh(merge([[new T.CylinderGeometry(0.13, 0.115, 0.26, 12, 1, true), at(0, 0.13, 0), C.tin], [cyl(0.115, 0.012, 12), at(0, 0.006, 0), C.tin],
      [cyl(0.018, 0.26, 6), M4().makeTranslation(0.2, 0.17, 0).multiply(M4().makeRotationZ(-0.9)), C.tin], [new T.TorusGeometry(0.075, 0.012, 6, 10, Math.PI), M4().makeTranslation(-0.13, 0.15, 0).multiply(M4().makeRotationZ(Math.PI / 2)), C.tin]])));
    dyn.can.children[0].material = canMat;
    dyn.canWater = new T.Mesh(new T.CircleGeometry(0.118, 12), waterMat); dyn.canWater.rotation.x = -Math.PI / 2; dyn.can.add(dyn.canWater);
    dyn.can.visible = false;
    dyn.spoutStream = stream(); dyn.tapStream = stream();
    yardG.add(dyn.handle, dyn.lever, dyn.tapHandle, dyn.sight, dyn.can, dyn.spoutStream, dyn.tapStream);
    // kit boxes
    dyn.kits = {};
    for (const k of Object.values(pl.kits || {})) {
      const g = mesh(merge([[box(0.52, 0.3, 0.36), at(0, 0.15, 0), C.card], [box(0.53, 0.02, 0.08), at(0, 0.305, 0), 0x8f7447], [box(0.2, 0.12, 0.005), at(0, 0.16, 0.181), 0x3f78b5]]));
      g.position.set(k.x, k.y, k.z); g.rotation.y = k.yaw; if (k.opened) g.scale.set(1, 0.12, 1);
      dyn.kits[k.id] = g; yardG.add(g);
    }
    Y.spout = { x: px, y: py + 0.34, z: pz + 0.3, floor: gy + 0.71 };
    Y.tapOut = { x: tx, y: ty + 0.095, z: tz + 0.16, floor: gy };
    Y.handleTip = () => { const a = dyn.handle.rotation.z; return { x: px - 0.07 - Math.cos(a) * 0.68, y: py + 0.68 - Math.sin(a) * 0.68, z: pz }; };
    Y.leverTip = () => { const a = dyn.lever.rotation.y; return { x: px + Math.sin(a) * 0.22, y: py + 0.53, z: pz + Math.cos(a) * 0.22 }; };
    lever.k = lever.to = W().pumps[pump.id] && W().pumps[pump.id].divert === 'tank' ? 1 : 0;
    tapK = W().taps[tap.id] && W().taps[tap.id].open ? 1 : 0;
    applyHandle(); applyLever(); dyn.tapHandle.rotation.y = tapK * Math.PI / 2;
    sightSig = -1; refreshSlow();
  }
  const canMat = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
  const waterMat = new T.MeshLambertMaterial({ color: C.water, emissive: 0x1d4a6e, transparent: true, opacity: 0.9 });
  const patchMat = () => new T.MeshBasicMaterial({ color: 0x1c2a33, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  function stream() { const m = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 1, 6), waterMat); m.visible = false; return m; }
  // a stream from a spout straight down to whatever is under it; w is its thickness (m)
  function setStream(m, from, floorY, w, wobble) {
    const h = Math.max(0.02, from.y - floorY);
    m.visible = w > 0.001;
    if (m.visible) { m.position.set(from.x, from.y - h / 2, from.z); m.scale.set(w * (1 + wobble * 0.3 * Math.sin(performance.now() * 0.03)), h, w); }
  }

  /* ================= wet ground: dark patches that grow with litres and dry with time ================= */
  const patches = new Map();
  function wet(key, x, y, z, litres) {
    let p = patches.get(key);
    if (!p) { p = { m: new T.Mesh(new T.CircleGeometry(1, 18), patchMat()), L: 0 }; p.m.rotation.x = -Math.PI / 2; p.m.renderOrder = 3; G.scene.add(p.m); patches.set(key, p); }
    p.m.position.set(x, y + 0.025, z); p.L = Math.min(60, p.L + litres);
  }
  function dryPatches(dt) {
    for (const [k, p] of patches) {
      p.L -= dt * (0.25 + p.L * 0.04);                         // a puddle soaks away in about a minute
      if (p.L <= 0) { G.scene.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); patches.delete(k); continue; }
      const r = 0.18 + 0.2 * Math.sqrt(p.L);
      p.m.scale.set(r, r, 1); p.m.material.opacity = Math.min(0.5, 0.12 + p.L * 0.03);
    }
  }
  const splash = (x, y, z, n = 8, up = 1.6, spread = 1.1) => G.burst(x, y, z, n, C.water, spread, up, 0.045, 0.4);

  /* ================= the pump ================= */
  const pumping = { on: false, h: 0, manual: false, t: 0, armed: true, gush: 0, judder: 0 };
  const lever = { k: 0, to: 0 };
  function applyHandle() { if (dyn.handle) dyn.handle.rotation.z = -0.5 + pumping.h * 0.95 + (pumping.judder > 0 ? Math.sin(performance.now() * 0.09) * 0.03 : 0); }
  function applyLever() { if (dyn.lever) dyn.lever.rotation.y = lever.k * (Math.PI / 2); }
  let canPref = null, canAt = null, sightSig = -1, tapK = 0, sputter = 0, tapAsk = 0, lastTick = -1, leakT = 0, leakSaid = 0, saidTank = false;
  function stroke(R) {
    const r = cmd('water.pumpStroke', { id: Y.pump.id }), s = Y.spout;
    G.cam.shake = Math.min(G.cam.shake + 0.035, 0.5);
    if (!r.ok) { R.say(r.text || 'Nothing comes.'); pumping.judder = 0.25; return; }
    if (r.priming) {
      pumping.judder = 0.3;
      G.burst(s.x, s.y, s.z, 3, 0xcfd3d6, 0.5, 0.6, 0.035, 0.3);              // a dry cough of air
      R.say('Dry and squeaky… keep going, it is priming (' + Math.round(r.prime * 3) + ' of 3)', 1.6);
      return;
    }
    if (r.to === 'spout') {
      pumping.gush = 0.42;
      splash(s.x, s.y - 0.05, s.z, 7, 0.4, 0.5);
      let spill = r.litres;
      if (hasCan() && canAt === 'pump') {
        const f = cmd('garden.fill', { litres: r.litres }); spill = r.litres - (f.ok ? f.taken : 0);
        if (f.ok && f.taken > 0) splash(s.x, s.floor + 0.12 + 0.2 * (f.canL / CAN_L), s.z, 4, 1.0, 0.5);
        if (f.ok && f.full) { R.say(spill > 0.01 ? 'The can is full: 9 litres. The rest slops over the rim.' : 'The can is full: 9 litres.', 2.2); if (spill > 0.01) splash(s.x, s.floor + 0.3, s.z, 12, 1.8, 1.6); }
      } else splash(s.x, s.floor + 0.03, s.z, 10, 1.4, 1.5);
      if (spill > 0.01) wet('spout', s.x, Y.well.y, s.z + 0.55, spill * 0.6);
      refreshCan();
    } else if (r.to === 'tank') {
      const b = Y.barrel;
      splash(b.x - 0.15, b.y + 0.92, b.z, 4, 0.8, 0.5);
      G.burst(Y.pump.x + 0.25, Y.pump.y + 0.9, Y.pump.z, 2, 0xe8e4d4, 0.4, 0.3, 0.03, 0.25);   // the riser knocks
      if (!saidTank) { saidTank = true; R.say('Up the riser and into the barrel. Watch the sight tube climb.', 3); }
      if (r.overflowL > 0.01) { R.say('The barrel is full: it is running over.', 2.5); splash(b.x, b.y + 0.95, b.z + 0.3, 10, 1.2, 1.5); wet('over', b.x, Y.well.y, b.z + 0.6, r.overflowL); }
      refreshSight();
    } else { R.say(r.text || 'The water spills.', 3); splash(Y.pump.x, Y.pump.y + 0.3, Y.pump.z, 10, 1.2, 1.4); }
  }
  function refreshSight() {
    const t = Y && W().tanks[Y.barrel.id]; if (!t || !dyn.sight) return;
    const f = clamp(t.storedL / t.capacityL, 0, 1), sig = Math.round(f * 400);
    if (sig === sightSig) return;
    sightSig = sig; dyn.sight.scale.y = Math.max(0.004, f * 0.84); dyn.sight.visible = f > 0.002;
  }
  function refreshCan() {
    if (!dyn.can) return;
    const P = G.player, near = (o) => Math.hypot(o.x - P.x, o.z - P.z) < 3.4;
    // the can stands under the spout you last reached for, if you are still beside it; otherwise under the nearer one
    const dp = Math.hypot(Y ? Y.spout.x - P.x : 0, Y ? Y.spout.z - P.z : 0), dt_ = Math.hypot(Y ? Y.tapOut.x - P.x : 0, Y ? Y.tapOut.z - P.z : 0);
    canAt = !hasCan() || !Y ? null : canPref === 'pump' && near(Y.spout) ? 'pump' : canPref === 'tap' && near(Y.tapOut) ? 'tap' : near(Y.spout) && dp <= dt_ ? 'pump' : near(Y.tapOut) ? 'tap' : near(Y.spout) ? 'pump' : null;
    dyn.can.visible = !!canAt;
    if (!canAt) return;
    const o = canAt === 'pump' ? Y.spout : Y.tapOut;
    dyn.can.position.set(o.x, o.floor, o.z);
    const L = GD().can.litres;
    dyn.canWater.visible = L > 0.05; dyn.canWater.position.y = 0.02 + 0.23 * (L / CAN_L);
  }

  /* ================= the tap, the valve, and saying why ================= */
  function whyDry() {
    const tap = W().taps[Y.tap.id], pl = PL(), run = pl.runs && pl.runs['y:tap'];
    if (G.speed === 0) return 'Time is paused, and water only runs while time does. Press 1× at the top.';
    if (!run || !run.reaches.includes('y:bout')) return 'No pipe reaches the tap yet. Fit a run from the brass outlet at the foot of the barrel.';
    if (tap.why === 'valve') return 'The shutoff valve is closed. Click it to open it.';
    if (tap.why === 'empty') return 'The barrel is empty. Flip the red lever on the pump and pump some water up into it.';
    if (tap.why === 'above') return 'The tap is higher than the water in the barrel, so gravity cannot bring it here.';
    const iss = (W().issues || []).find((i) => i.pieceId === Y.tap.id);
    return iss ? iss.reason : 'Nothing comes yet.';
  }
  function toggleTap(R) {
    const open = !(W().taps[Y.tap.id] && W().taps[Y.tap.id].open);
    cmd('plumbing.sync', {}); cmd('water.setTap', { id: Y.tap.id, open });
    R.pose(-1.3, 0.2, 0.15, 0.25);
    if (open) { sputter = 0.7; tapAsk = performance.now() + 1500; G.burst(Y.tapOut.x, Y.tapOut.y, Y.tapOut.z, 3, 0xdfe6ea, 0.5, 0.3, 0.03, 0.25); }
    else { tapAsk = 0; R.say('Tap closed.', 1.2); }
  }
  function tapValve(part, R) {
    if (part.kind !== 'valve') return false;
    const open = !part.set.open, w = view.endWorld(part.at);
    cmd('parts.set', { id: part.id, key: 'open', value: open }); cmd('plumbing.sync', {});
    G.burst(w.x, w.y + 0.1, w.z, 4, open ? 0x8fd69a : 0xe0a090, 0.6, 0.8, 0.04, 0.3); G.cam.shake = Math.min(G.cam.shake + 0.04, 0.5);
    R.pose(-1.4, 0.2, 0.2, 0.2); R.say(open ? 'Valve open: the handle lies along the pipe.' : 'Valve shut: the handle sits across the pipe.', 2);
    return true;
  }

  /* ================= the kit box ================= */
  const benchTop = (x, z) => { const b = Y && Y.bench; return b && Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2 ? b.y + b.h : null; };
  function openKit(id, R) {
    const k = PL().kits[id], r = cmd('plumbing.openKit', { id });
    if (!r.ok) return;
    const ids = [], spots = [], b = Y.bench || { x: k.x, z: k.z, w: 1.6, d: 0.7 };
    let nPipe = 0, nFit = 0;
    for (const [kind, qty] of r.contents) for (let i = 0; i < qty; i++) {
      const s = cmd('parts.spawn', { kind, pose: { x: k.x, y: k.y, z: k.z } });
      if (!s.ok) continue;
      ids.push(s.id);
      // lengths lie side by side on the ground in front of the bench; fittings spread along the bench top
      if (kind === 'pipe') spots.push({ x: b.x, z: b.z + b.d / 2 + 0.35 + 0.14 * nPipe++, yaw: 0 });
      else { spots.push({ x: b.x - b.w / 2 + 0.16 + (nFit % 5) * 0.2 + (k.x > b.x ? -0.0 : 0.6), z: b.z - 0.2 + Math.floor(nFit / 5) * 0.24 + (nFit % 2) * 0.04, yaw: (nFit * 1.7) % 6.28 }); nFit++; }
    }
    if (dyn.kits[id]) dyn.kits[id].scale.set(1, 0.12, 1);
    G.burst(k.x, k.y + 0.3, k.z, 14, C.card, 2, 2.2, 0.07, 0.5); G.cam.shake = Math.min(G.cam.shake + 0.1, 0.5); G.juice.hitStop = 0.04;
    view.spill(ids, { x: k.x, y: k.y + 0.3, z: k.z }, spots);
    R.beat('Starter plumbing kit');
    R.say('Pipes, elbows, a tee, a valve, couplings and a cap. Pick one up and take it to the brass outlet on the barrel.', 6);
  }

  /* ================= parts view ================= */
  const view = PV.attach({
    system: 'parts', shapes: SHAPES, material: mat,
    surfaceAt: (x, z) => benchTop(x, z) ?? G.heightAt(x, z),
    canPlace: (way, ends) => ends.every((e) => e.y >= G.heightAt(e.x, e.z) + 0.08),
    onTap: tapValve,
    tapHint: (part) => (part.kind === 'valve' ? '<b>Click</b> to ' + (part.set.open ? 'shut' : 'open') + ' the valve' : null),
    onChange: (why) => { if (why === 'fit' || why === 'unfit' || why === 'cut') cmd('plumbing.sync', {}); },
  });

  /* ================= hands: what can be aimed at ================= */
  const user = {
    id: 'water',
    near(px, pz) { return !!Y && [Y.pump, Y.tap, Y.bench].some((o) => o && Math.hypot(o.x - px, o.z - pz) < 3.6); },
    hover(R) {
      if (!Y || R.held) return null;
      let best = null;
      const consider = (kind, p, rad, hint, extra) => {
        if (!R.within(p.x, p.z, 0.2)) return;
        const d = R.rayDist(p.x, p.y, p.z).d;
        if (d > rad) return;
        const score = d / rad * (extra && extra.w || 1);
        if (!best || score < best.score) best = { score, kind, x: p.x, y: p.y, z: p.z, hint, ...(extra || {}) };
      };
      const pm = W().pumps[Y.pump.id] || {}, toTank = pm.divert === 'tank', can = hasCan() ? '   Can: ' + GD().can.litres.toFixed(1).replace('.0', '') + ' of 9 L' : '';
      const bar = toTank && W().tanks[Y.barrel.id] ? '   Barrel: ' + Math.round(W().tanks[Y.barrel.id].storedL) + ' of 200 L' : can;
      const ph = '<b>Hold</b> on the handle and stroke the mouse <b>down and up</b> to pump (or just hold).   Water goes to the ' + (toTank ? 'barrel' : 'spout') + bar;
      const tip = Y.handleTip();
      consider('pump', tip, 0.3, ph, { hintDown: ph });
      consider('pump', { x: (tip.x + Y.pump.x) / 2, y: tip.y, z: tip.z }, 0.25, ph, { hintDown: ph });
      consider('pump', { x: Y.pump.x, y: Y.pump.y + 0.3, z: Y.pump.z }, 0.22, ph, { hintDown: ph, w: 1.3 });
      consider('lever', Y.leverTip(), 0.13, '<b>Click</b> the red lever: send the water ' + (toTank ? 'back to the spout' : 'up to the barrel'), { w: 0.7 });
      const tap = W().taps[Y.tap.id] || {};
      consider('tap', { x: Y.tap.x, y: Y.tap.y + 0.2, z: Y.tap.z + 0.05 }, 0.28, tap.open ? (tap.flowLmin > 0 ? '<b>Click</b> to close the tap.   Running at ' + tap.flowLmin.toFixed(1) + ' L a minute' + can : '<b>Click</b> to close the tap.   ' + whyDry()) : '<b>Click</b> to open the tap');
      for (const k of Object.values(PL().kits || {})) if (!k.opened) consider('kit', { x: k.x, y: k.y + 0.15, z: k.z }, 0.4, '<b>Click</b> to open the starter kit', { id: k.id });
      if (best && (best.kind === 'pump' || best.kind === 'tap') && canPref !== best.kind) { canPref = best.kind; refreshCan(); }
      return best;
    },
    press(hit, R) {
      if (hit.kind === 'pump') { Object.assign(pumping, { on: true, manual: false, t: 0, armed: pumping.h < 0.3 }); return; }
      if (hit.kind === 'lever') { const to = lever.to ? 'spout' : 'tank'; cmd('water.setPumpDivert', { id: Y.pump.id, to }); lever.to = to === 'tank' ? 1 : 0; R.pose(-1.4, 0.2, 0.15, 0.25); G.burst(hit.x, hit.y, hit.z, 3, 0xe0a090, 0.5, 0.6, 0.03, 0.25); R.say(to === 'tank' ? 'Lever toward the riser: strokes now lift water up into the barrel.' : 'Lever toward the spout: strokes pour from the spout.', 2.5); return; }
      if (hit.kind === 'tap') return toggleTap(R);
      if (hit.kind === 'kit') return openKit(hit.id, R);
    },
    move(hit, R) {
      if (hit.kind !== 'pump' || !pumping.on) return;
      if (Math.abs(R.ptr.dy) > 10) pumping.manual = true;
    },
    release(hit) { if (hit.kind === 'pump') pumping.on = false; },
    frame(dt, R) {
      if (!Y) { slow += dt; if (slow > 0.5) { slow = 0; const B = window.__build; if (B && B.version !== yardV) { yardV = B.version; buildYard(); } } return; }
      // the handle
      if (pumping.on) {
        pumping.t += dt;
        const want = pumping.manual ? clamp(R.ptr.dy / 110, 0, 1) : 0.5 - 0.5 * Math.cos((pumping.t / 0.62) * Math.PI * 2);
        pumping.h += (want - pumping.h) * Math.min(1, dt * 22);
        if (pumping.h < 0.22) pumping.armed = true;
        if (pumping.armed && pumping.h > 0.84) { pumping.armed = false; stroke(R); }
        const tip = Y.handleTip(); R.face(Y.pump.x, Y.pump.z);
        R.pose(-1.75 + pumping.h * 0.95, -1.75 + pumping.h * 0.95, 0.08 + pumping.h * 0.3, 0.12); void tip;
        applyHandle();
      } else if (pumping.h > 0.001 || pumping.judder > 0) { pumping.h += (0 - pumping.h) * Math.min(1, dt * 9); if (pumping.h < 0.002) pumping.h = 0; applyHandle(); }
      if (pumping.judder > 0) pumping.judder -= dt;
      if (pumping.gush > 0) { pumping.gush -= dt; setStream(dyn.spoutStream, Y.spout, Y.spout.floor + (canAt === 'pump' ? 0.03 + 0.23 * (GD().can.litres / CAN_L) : 0), pumping.gush > 0 ? 0.05 * Math.min(1, pumping.gush / 0.15) : 0, 1); }
      if (lever.k !== lever.to) { lever.k += clamp(lever.to - lever.k, -dt * 7, dt * 7); applyLever(); }
      // the tap
      const tap = W().taps[Y.tap.id], open = !!(tap && tap.open), flowing = open && tap.flowLmin > 0;
      const tk = open ? 1 : 0;
      if (tapK !== tk) { tapK += clamp(tk - tapK, -dt * 8, dt * 8); dyn.tapHandle.rotation.y = tapK * Math.PI / 2; }
      if (sputter > 0) {
        sputter -= dt;
        if (Math.random() < dt * 22) G.burst(Y.tapOut.x, Y.tapOut.y, Y.tapOut.z, 2, flowing ? C.water : 0xdfe6ea, 0.7, 0.2, 0.035, 0.3);   // air and spit along the run
      }
      if (flowing || dyn.tapStream.visible) {
        const w = flowing && sputter <= 0.25 ? clamp(0.012 + tap.flowLmin * 0.004, 0.015, 0.05) : 0;
        setStream(dyn.tapStream, Y.tapOut, Y.tapOut.floor + (canAt === 'tap' ? 0.03 + 0.23 * (GD().can.litres / CAN_L) : 0), w, 0.6);
        if (flowing && Math.random() < dt * 14) splash(Y.tapOut.x, Y.tapOut.floor + (canAt === 'tap' ? 0.2 : 0.03), Y.tapOut.z, 1, 0.9, 0.7);
      }
      if (tapAsk && performance.now() > tapAsk) { tapAsk = 0; if (open && !flowing) R.say(whyDry(), 5); }
      // each simulated minute that passed: what ran out of the tap goes into the can or onto the ground
      const tick = sim.state.tick;
      if (tick !== lastTick) {
        const n = lastTick < 0 ? 0 : Math.min(5, tick - lastTick); lastTick = tick;
        if (flowing && n > 0) {
          let L = tap.flowLmin * n;
          if (canAt === 'tap' && hasCan()) { const f = cmd('garden.fill', { litres: L }); if (f.ok) { L -= f.taken; if (f.full && f.taken > 0) R.say('The can is full: 9 litres.', 2); } refreshCan(); }
          if (L > 0.01) wet('tap', Y.tapOut.x, Y.tapOut.floor, Y.tapOut.z, L * 0.5);
          if (cmd('plumbing.note', { key: 'firstWater' }).first) { R.beat('First water!'); R.say('Water you pumped, through pipe you fitted, out of your own tap.', 6); }
        }
        refreshSight();
      }
      // leaks: spray from every open end the water reaches
      const leaks = W().leaks;
      let any = false;
      if (leaks) for (const id in leaks) {
        const lk = leaks[id]; if (!(lk.flowLmin > 0)) continue;
        any = true; leakT -= dt;
        if (leakT <= 0) {
          const pc = PL().pieces.find((p) => p.id === id), d = (pc && pc.d) || [0, 0, 0];
          G.burst(lk.x + d[0] * 0.12, lk.y + d[1] * 0.12 + 0.02, lk.z + d[2] * 0.12, 3, C.water, 1.6, 1.4 + d[1] * 2, 0.045, 0.45);
          wet(id, lk.x + d[0] * 0.5, G.heightAt(lk.x, lk.z), lk.z + d[2] * 0.5, lk.flowLmin * 0.004);
        }
      }
      if (any) { if (leakT <= 0) leakT = 0.05; if (performance.now() > leakSaid) { leakSaid = performance.now() + 9000; R.say('Water is pouring out of an open end! Shut the valve, or fit the next part.', 4); } }
      if (patches.size) dryPatches(dt);
      slow += dt;
      if (slow > 0.25) { slow = 0; refreshSlow(); }
    },
  };
  // the yard is trodden ground: no tall grass over the pipes (checked only when a chunk rebuilds its grass)
  const grassSeen = new WeakMap(), ZERO = new T.Matrix4().makeScale(0, 0, 0);
  function clearGrass() {
    const chunks = G.world && G.world.chunks; if (!chunks || !Y) return;
    const cx = Y.well.x + 0.4, cz = Y.well.z + 1.0, b = Y.bench;
    for (const c of chunks.values()) for (const [m, list] of [[c.grassMesh, c.grass], [c.flowerMesh, c.flowers]]) {
      if (!m || !list || grassSeen.get(m) === m.instanceMatrix.version) continue;
      let n = 0;
      list.forEach((g, i) => { const x = c.ox + g.lx, z = c.oz + g.lz; if (Math.hypot(x - cx, z - cz) < 3.3 || (b && Math.abs(x - b.x) < b.w / 2 + 0.9 && Math.abs(z - b.z) < b.d / 2 + 1.3)) { m.setMatrixAt(i, ZERO); n++; } });
      if (n) m.instanceMatrix.needsUpdate = true;
      grassSeen.set(m, m.instanceMatrix.version + (n ? 1 : 0));
    }
  }
  let slow = 0;
  function refreshSlow() {
    const B = window.__build;
    if (B && B.version !== yardV) { yardV = B.version; buildYard(); return; }
    if (!Y) return;
    refreshCan(); refreshSight(); clearGrass();
    const pm = W().pumps[Y.pump.id]; if (pm && !pumping.on) lever.to = pm.divert === 'tank' ? 1 : 0;
    for (const k of Object.values(PL().kits || {})) if (!dyn.kits[k.id]) { yardV = -1; }
  }
  RCH.use(user);
  sim.listen((type) => { if (type === 'loaded') { yardV = -1; Y = null; lastTick = -1; } });

  // debug and test hooks
  const _p = new T.Vector3();
  const screen = (x, y, z) => { _p.set(x, y, z).project(G.camera); const r = document.getElementById('view').getBoundingClientRect(); return { x: r.left + (_p.x * 0.5 + 0.5) * r.width, y: r.top + (-_p.y * 0.5 + 0.5) * r.height }; };
  window.__waterHands = {
    get yard() { return Y; }, view, screen,
    // another starter kit on the bench (until deliveries bring them)
    spawnKit() { if (!Y || !Y.bench) return null; const b = Y.bench, n = Object.keys(PL().kits).length; const r = cmd('plumbing.addKit', { x: b.x + (n % 2 ? -0.45 : 0.45), y: b.y + b.h, z: b.z, yaw: 0.2 * n }); yardV = -1; return r.id; },
    where: (name) => { if (!Y) return null; const p = name === 'pump' ? Y.handleTip() : name === 'lever' ? Y.leverTip() : name === 'tap' ? { x: Y.tap.x, y: Y.tap.y + 0.2, z: Y.tap.z + 0.05 } : name === 'kit' ? (() => { const k = Object.values(PL().kits).find((q) => !q.opened); return k && { x: k.x, y: k.y + 0.15, z: k.z }; })() : null; return p && { ...p, screen: screen(p.x, p.y, p.z) }; },
  };
})();
