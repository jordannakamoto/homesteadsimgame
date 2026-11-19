// Vehicles on the page: live bodies, a fixed real-time step with interpolation, seat possession through the control
// stack, mounting by walking into a unit's side, collisions both ways, and the pose reported to the sim. Generic: no
// game words; content (src/game/*.js) registers models and names the ground under a point.
//
//   window.__vehicles = {
//     register({ models, surface, onStroke, onDump }),   content, once. models[look] = (T, helper, kind) -> model (below);
//                                                surface(x, z) -> a name in the vehicles system's api.surfaces
//     units(), unit(id), driven() -> id | null, kinds(),
//     mount(id, seat?), dismount(),              also done by walking into a mount zone / pressing E
//     body(id) -> { x, y, z, yaw, pitch, roll, speed, rpm, gear } the live pose,
//     bedPoint(id, out), nearest(x, z, r) -> id | null, spawn(kind, x?, z?, yaw?) -> id (debug and tests),
//     findSpot(x, z, { rMin, rMax, rad, away }) -> { x, z, yaw } | null   a clear, dry, flat place near a point
//     unstick(id), stats(),
//     towing: hitch(id?) (the driven unit to the nearest towed unit in reach), unhitch() (X while seated),
//     cargo:  setCargo(id, groups, kg)  what lies on a unit's bed: groups = [{ n, w, h, l, color }] (pieces, metres,
//             laid along the bed, layer on layer); kg is what it weighs (the drive model tows it),
//             flyFrom(id, { x, y, z })  the next pieces added fly onto the bed from there,
//             carrierNear(x, z, r) -> id | null   a unit with a bed within r of a point, bed(id) -> { angle, sliding }
//     gen   bumped whenever the page's units are rebuilt (content re-sends cargo)
//   }
//   model = { body: Object3D, wheels: InstancedMesh | null (one instance per probe: front left, front right, rear left,
//             rear right; a one-axle towed unit: left, right), bars: Object3D | null (turns with the steering about its
//             own y), grips: [[x, y, z] left, right] | null, feet: [[x, y, z] left, right] | null,
//             bed: Object3D | null (a tipping bed, built in the unit's frame; it turns about kind.cargo.pivot) }
//   Towing: a unit hitched in the sim is stepped with its tow unit (stepBody's trailer). Backing the tow point within
//   kind.hitch.latchM of a loose unit's tongue, lined up within hitch.alignRad, latches it; a faint line from the ball
//   to the tongue shows while reversing within 3 m. Holding the left button while seated tips a towed unit's bed
//   (cargo.tips): past cargo.slideRad the load slides off and content's onDump(id, { x, z }) puts it on the ground.
//   helper = { boxModel(parts) -> BufferGeometry (parts: [w, h, d, x, y, z, hex, rx?, ry?, rz?]), mergeGeo(T, list) }
//
// The sim (vehicles system) owns where each unit is parked, its fuel and who sits where. While a unit is driven this file
// owns its motion and reports it with `vehicles.sync` every 0.5 s, on stepping off, and before the page is hidden.
(() => {
  const G = window.__game;
  if (!G || !G.control || !G.vehicleCore) return;
  const T = G.THREE, VC = G.vehicleCore, control = G.control, P = G.player, pm = G.pm, SUB = VC.SUB;
  const canvas = G.renderer.domElement;
  const MAX_SUB = 4, SYNC_S = 0.5, HOP_S = 0.3, OFF_MPS = 1.5, ZONE_HOLD_S = 0.25, TIP_WARN = 0.8, TIP_OVER_S = 0.35;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sysDef = () => G.sim.systems.find((s) => s.name === 'vehicles') || null;
  const S = () => G.sim.state.sys.vehicles || null;
  const kinds = () => { const d = sysDef(); return d ? d.api.kinds : {}; };
  const content = { models: {}, surface: null, onStroke: null, onDump: null };
  const CARGO_CAP = 96, FLY_S = 0.35, SLIDE_S = 0.7, GUIDE_M = 3;
  let gen = 0;
  const live = new Map();                 // id -> L, the page's view of each unit
  let simRef = null, seat = null, stepping = null, buildV = -1, zone = null, sayT = 0, warnT = 0;
  const stat = { ms: 0, sub: 0, frames: 0 };

  // ---------------------------------------------------------------- a short line of text near the bottom of the view
  const line = document.createElement('div');
  line.style.cssText = 'position:fixed;left:50%;bottom:118px;transform:translateX(-50%);padding:6px 14px;border-radius:8px;background:rgba(20,22,18,.72);color:#f1ead6;font:14px/1.3 system-ui,sans-serif;pointer-events:none;z-index:30;display:none;max-width:80vw;text-align:center';
  document.body.appendChild(line);
  // with the interface kit the line is a toast in the top lane; without it, a line near the bottom of the view
  function say(t, s = 2) {
    sayT = s;
    if (window.__ui && window.__ui.toast) { if (t) window.__ui.toast(t, { seconds: s }); return; }
    line.textContent = t; line.style.display = t ? 'block' : 'none';
  }

  // ---------------------------------------------------------------- models
  const lambert = () => new T.MeshLambertMaterial({ vertexColors: true });
  const _m = new T.Matrix4(), _e = new T.Euler(0, 0, 0, 'YXZ'), _q = new T.Quaternion(), _v = new T.Vector3(), _s1 = new T.Vector3(1, 1, 1);
  // coloured boxes merged into one geometry: [w, h, d, x, y, z, hex, rx, ry, rz]
  function boxModel(parts) {
    const list = parts.map(([w, h, d, x, y, z, hex, rx = 0, ry = 0, rz = 0]) => {
      _e.set(rx, ry, rz, 'XYZ'); _q.setFromEuler(_e); _v.set(x, y, z);
      return [new T.BoxGeometry(w, h, d), new T.Matrix4().compose(_v, _q, _s1), hex];
    });
    return window.__parts.mergeGeo(T, list);
  }
  const helper = { boxModel, mergeGeo: (T2, list) => window.__parts.mergeGeo(T2, list) };
  // the grey box: what a kind looks like until content gives it a model
  function greyBox(T2, h, kind) {
    const c = kind.clearance || kind.wheelR * 0.8, l = kind.dims.l, w = kind.dims.w, top = kind.dims.h;
    const body = new T.Mesh(h.boxModel([[w * 0.8, top - c - 0.1, l, 0, c + (top - c - 0.1) / 2, 0, 0x8a8f86], [0.3, 0.12, 0.5, 0, top - 0.06, -0.15, 0x222222]]), lambert());
    const wg = new T.CylinderGeometry(kind.wheelR, kind.wheelR, 0.22, 10); wg.rotateZ(Math.PI / 2);
    const wheels = new T.InstancedMesh(wg, new T.MeshLambertMaterial({ color: 0x262626 }), 4);
    return { body, wheels, bars: null, grips: null, feet: null };
  }

  // ---------------------------------------------------------------- live units
  const sag = (k) => { const s = k.susp || { hz: 2 }, om = 2 * Math.PI * s.hz; return 9.81 / (om * om); };
  function waterAt(x, z) {
    const s = G.streamWaterAt(x, z), d = s ? s.depth : 0;
    return Math.max(d, G.sea - G.heightAt(x, z), 0);
  }
  function makeEnv(L) {
    return {
      ground: (x, z, y) => G.groundAt(x, z, y),
      surface: () => L.surf,
      water: () => L.water,                                    // read once a frame at the body (it changes slowly)
      collide: (o, rad) => { stepping = L; G.pushOut(o, rad); stepping = null; },
    };
  }
  function surfAt(x, z) {
    const d = sysDef(), table = d && d.api.surfaces;
    if (!table || !content.surface) return null;
    return table[content.surface(x, z)] || null;
  }
  function create(u) {
    const kind = kinds()[u.kind];
    if (!kind) return null;
    const L = { id: u.id, kind, root: new T.Group(), model: null, body: null, prev: {}, cur: {}, pose: {}, acc: 0, env: null,
      parked: { x: u.x, z: u.z, yaw: u.yaw }, water: 0, wl: [0, 0, 0, 0], spin: 0, wake: 0, tip: null, glow: 0, mats: [], surf: null, syncT: 0,
      sent: { burned: 0, dist: 0, engine: 0 }, towL: null, trSpec: null, loadKg: 0, bedG: null, bedA: 0, bedWant: false, cg: null };
    L.env = makeEnv(L);
    const fn = content.models[kind.look] || greyBox;
    const m = fn(T, helper, kind) || greyBox(T, helper, kind);
    L.model = m;
    L.root.matrixAutoUpdate = false;
    for (const o of [m.body, m.wheels, m.bars]) if (o) { L.root.add(o); o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = false; if (c.material && c.material.emissive) { c.material = c.material.clone(); L.mats.push(c.material); } } }); }
    if (m.body) { m.body.matrixAutoUpdate = false; m.body.updateMatrix(); }
    const cgo = kind.cargo;
    if (m.bed && cgo) {                                       // the tipping bed turns about its pivot
      const pv = cgo.pivot || [cgo.bed.at[1], cgo.bed.at[2] - cgo.bed.l / 2];
      L.bedG = new T.Group(); L.bedG.position.set(0, pv[0], pv[1]);
      m.bed.position.set(0, -pv[0], -pv[1]); L.bedG.add(m.bed); L.root.add(L.bedG);
      m.bed.traverse((c) => { if (c.isMesh) c.castShadow = true; });
    }
    if (cgo) makeCargo(L);
    if (m.wheels) { m.wheels.frustumCulled = false; m.wheels.instanceMatrix.setUsage(T.DynamicDrawUsage); }
    G.scene.add(L.root);
    L.body = VC.createBody(kind, { x: u.x, z: u.z, yaw: u.yaw, fuelL: u.fuelL }, L.env);
    gen++;
    L.surf = surfAt(u.x, u.z);
    VC.poseOf(L.body, L.prev); VC.poseOf(L.body, L.cur); VC.poseOf(L.body, L.pose);
    for (let i = 0; i < 4; i++) L.wl[i] = kind.wheelR;
    draw(L, L.pose, 0, true);
    live.set(u.id, L);
    return L;
  }
  function destroy(L) {
    G.scene.remove(L.root);
    L.root.traverse((c) => { if (c.isMesh) { c.geometry.dispose(); if (c.material.dispose) c.material.dispose(); } });
    live.delete(L.id);
    gen++;
  }
  // put a parked unit on the ground at the sim's pose (on load, when it was moved, when the ground under it changed)
  function park(L, u) {
    L.body.x = u.x; L.body.z = u.z; L.body.yaw = u.yaw; L.body.u = L.body.w = L.body.r = 0; L.body.fuelL = u.fuelL;
    VC.settle(L.body, L.kind, L.env);
    L.parked.x = u.x; L.parked.z = u.z; L.parked.yaw = u.yaw;
    VC.poseOf(L.body, L.prev); VC.poseOf(L.body, L.cur); VC.poseOf(L.body, L.pose);
    draw(L, L.pose, 0, true);
  }

  // ---------------------------------------------------------------- drawing
  const _wm = new T.Matrix4(), _wq = new T.Quaternion(), _wp = new T.Vector3(), _we = new T.Euler(0, 0, 0, 'YXZ');
  function probes(kind) {
    const hw = kind.track / 2, zs = (kind.axles || []).map((a) => a.z);
    const zf = zs.length ? Math.max(...zs) : kind.wheelbase / 2, zr = zs.length ? Math.min(...zs) : -kind.wheelbase / 2;
    return [[-hw, zf, true], [hw, zf, true], [-hw, zr, false], [hw, zr, false]];
  }
  function draw(L, pose, dt, snap) {
    const k = L.kind, y0 = pose.y - sag(k);
    let roll = pose.roll;
    if (L.tip) roll += L.tip.dir * L.tip.k * 1.45;
    _we.set(-pose.pitch, pose.yaw, roll); _wq.setFromEuler(_we); _wp.set(pose.x, y0 + (L.tip ? L.tip.k * 0.35 : 0), pose.z);
    L.root.matrix.compose(_wp, _wq, _s1); L.root.matrixWorldNeedsUpdate = true;
    const m = L.model;
    if (m.wheels) {
      const pr = L.pr || (L.pr = probes(k)), b = L.body, travel = (k.susp && k.susp.travel) || 0.15, sp = Math.sin(pose.pitch), sr = Math.sin(pose.roll);
      const steer = k.drive === 'tracked' ? 0 : pose.steer, n = Math.min(4, m.wheels.count);
      for (let i = 0; i < n; i++) {
        const [lx, lz, front] = pr[i];
        // the wheel sits on the ground under it, within the suspension's travel of where the chassis carries it
        const want = clamp(b.contact[i] + k.wheelR - y0 - lz * sp - lx * sr, k.wheelR - travel, k.wheelR + travel * 0.5);
        L.wl[i] = snap ? want : L.wl[i] + (want - L.wl[i]) * Math.min(1, 30 * dt);
        _we.set(L.spin, front && k.axles && k.axles.some((a) => a.steer && a.z === lz) ? steer : 0, 0); _wq.setFromEuler(_we);
        _wp.set(lx, L.wl[i], lz);
        m.wheels.setMatrixAt(i, _wm.compose(_wp, _wq, _s1));
      }
      m.wheels.instanceMatrix.needsUpdate = true;
    }
    if (m.bars) m.bars.rotation.y = pose.steer;
  }
  function setGlow(L, g) {
    if (Math.abs(g - L.glow) < 0.01) return;
    L.glow = g;
    for (const mt of L.mats) mt.emissive.setRGB(0.22 * g, 0.19 * g, 0.1 * g);
  }
  // a local point of a unit's frame into the world, as the unit is drawn now
  function toWorld(L, x, y, z, out) {
    _v.set(x, y, z).applyMatrix4(L.root.matrix);
    out.x = _v.x; out.y = _v.y; out.z = _v.z;
    return out;
  }

  // ---------------------------------------------------------------- the load on a bed: one instanced mesh per unit
  // Pieces lie along the bed in rows across it, layer on layer; pieces longer than the bed rest on the front board and
  // hang over the tail, as lumber does on a small trailer. New pieces can fly in from a point; tipping slides them off.
  const hashf = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  function makeCargo(L) {
    const c = L.kind.cargo, mesh = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshLambertMaterial({ color: 0xffffff }), CARGO_CAP);
    mesh.count = 0; mesh.castShadow = true; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    const at = c.bed.at;
    if (L.bedG) { const pv = L.bedG.position; mesh.position.set(at[0], at[1] - pv.y, at[2] - pv.z); L.bedG.add(mesh); }
    else { mesh.position.set(at[0], at[1], at[2]); L.root.add(mesh); }
    L.cg = { mesh, slots: [], fly: new Map(), from: null, fromT: 0, slide: -1, hidden: false, maxL: 0 };
  }
  function layoutCargo(L, groups) {
    const c = L.kind.cargo.bed, out = [];
    let y = 0, maxL = 0;
    for (const g of groups) {
      const n = Math.min(Math.max(0, g.n | 0), CARGO_CAP - out.length);
      if (!n) continue;
      const per = Math.max(1, Math.floor((c.w + 0.01) / (g.w + 0.012))), rows = g.l * 2 <= c.l ? Math.max(1, Math.floor((c.l + 0.01) / (g.l + 0.03))) : 1, perL = per * rows;
      const z0 = g.l > c.l ? c.l / 2 - g.l / 2 : 0;
      for (let k = 0; k < n; k++) {
        const lay = Math.floor(k / perL), r = k % perL, i = r % per, row = Math.floor(r / per), q = out.length;
        out.push({ x: (i - (per - 1) / 2) * (g.w + 0.012) + (hashf(q, 1) - 0.5) * 0.01, y: y + lay * (g.h + 0.004) + g.h / 2,
          z: rows > 1 ? (row - (rows - 1) / 2) * (g.l + 0.03) : z0 + (hashf(q, 7) - 0.5) * 0.06,
          sx: g.w, sy: g.h, sz: g.l * (0.96 + 0.04 * hashf(q, 3)), col: g.color, v: 0.9 + 0.2 * hashf(q, n) });
      }
      y += Math.ceil(n / perL) * (g.h + 0.004);
      maxL = Math.max(maxL, g.l);
    }
    L.cg.maxL = maxL;
    return out;
  }
  function applyCargo(L, groups) {
    const cg = L.cg, old = cg.slots.length, slots = layoutCargo(L, groups);
    cg.slots = slots; cg.hidden = false;
    for (const k of [...cg.fly.keys()]) if (k >= slots.length) cg.fly.delete(k);
    if (cg.fromT > 0 && slots.length > old) {           // the new pieces come flying from where they were taken
      cg.mesh.updateWorldMatrix(true, false);
      const inv = _m.copy(cg.mesh.matrixWorld).invert(), f = _v.set(cg.from.x, cg.from.y, cg.from.z).applyMatrix4(inv);
      for (let k = old; k < slots.length; k++) cg.fly.set(k, { t: -(k - old) * 0.05, x: f.x, y: f.y, z: f.z });
    }
    drawCargo(L);
  }
  const _ce = new T.Euler(), _cq = new T.Quaternion(), _cp = new T.Vector3(), _cs = new T.Vector3(), _cc = new T.Color();
  function drawCargo(L) {
    const cg = L.cg, mesh = cg.mesh, slide = cg.slide >= 0 ? cg.slide : 0, bedL = L.kind.cargo.bed.l;
    let n = 0;
    if (!cg.hidden) for (let k = 0; k < cg.slots.length; k++) {
      const q = cg.slots[k];
      let x = q.x, y = q.y, z = q.z, rx = 0;
      const fl = cg.fly.get(k);
      if (fl) {
        const f = clamp(fl.t / FLY_S, 0, 1), e = f * f * (3 - 2 * f);
        x = fl.x + (q.x - fl.x) * e; z = fl.z + (q.z - fl.z) * e; y = fl.y + (q.y - fl.y) * e + Math.sin(Math.PI * f) * 0.7; rx = (1 - e) * 0.5;
      }
      if (slide > 0) {                                     // sliding off the tail: faster as it goes, tipping over the edge
        const d = 2.6 * slide * slide, over = Math.max(0, -bedL / 2 - (q.z - d));
        z -= d; y -= over * over * 2; rx = -Math.min(0.6, over * 0.8);
      }
      _ce.set(rx, 0, 0); _cq.setFromEuler(_ce); _cp.set(x, y, z); _cs.set(q.sx, q.sy, q.sz);
      mesh.setMatrixAt(n, _m.compose(_cp, _cq, _cs));
      mesh.setColorAt(n, _cc.setHex(q.col).multiplyScalar(q.v)); n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  // per frame, only for units whose bed moves or whose load is moving
  function bedTick(L, dt) {
    const c = L.kind.cargo, cg = L.cg;
    if (!c || !cg) return;
    if (cg.fromT > 0) cg.fromT -= dt;
    let redraw = false;
    if (L.bedG) {
      const want = L.bedWant && c.tips ? c.tipMaxRad || 0.8 : 0, rate = (c.tipRadS || 0.5) * (want > L.bedA ? 1 : 1.6);
      if (Math.abs(want - L.bedA) > 1e-4) {
        L.bedA += clamp(want - L.bedA, -rate * dt, rate * dt);
        L.bedG.rotation.x = -L.bedA;
      }
      if (cg.slide < 0 && !cg.hidden && cg.slots.length && L.bedA >= (c.slideRad || 0.47)) { cg.slide = 0; G.cam.shake = Math.min(0.4, G.cam.shake + 0.04); }
    }
    if (cg.fly.size) {
      for (const [k, f] of cg.fly) { f.t += dt; if (f.t >= FLY_S) cg.fly.delete(k); }
      redraw = true;
    }
    if (cg.slide >= 0) {
      cg.slide += dt; redraw = true;
      if (cg.slide >= SLIDE_S) {
        cg.slide = -1;
        const rear = c.bed.at[2] - c.bed.l / 2, at = VC.toWorld(L.body, 0, rear - 0.35 - Math.min(cg.maxL, 3.6) * 0.4, {});
        const ok = content.onDump ? content.onDump(L.id, { x: at.x, z: at.z }) : false;
        cg.hidden = !!ok;                                 // gone until content says what is left on the bed
        if (ok) { G.cam.shake = Math.min(0.45, G.cam.shake + 0.08); landPuff({ body: { x: at.x, y: G.groundAt(at.x, at.z, L.body.y + 1), z: at.z } }); }
      }
    }
    if (redraw) drawCargo(L);
  }

  // ---------------------------------------------------------------- the rider
  const _rq = new T.Quaternion(), _re = new T.Euler(0, 0, 0, 'XYZ'), _rp = { x: 0, y: 0, z: 0 };
  function poseRider(L, hop) {
    const k = L.kind, st = (k.seats || []).find((q) => q.id === seat.seatId) || (k.seats || [])[0], at = st ? st.at : [0, 1, 0];
    const b = L.body, m = L.model, lean = 0.32 + clamp(-b.ax / 9.81, -0.3, 0.3) * 0.25;
    const side = clamp(-(b.ay / 9.81) * 0.35 - L.pose.roll * 0.6, -0.35, 0.35);
    const bob = clamp(-b.vy * 0.025, -0.05, 0.05);
    toWorld(L, at[0], at[1] + 0.06 + bob, at[2], _rp);
    if (hop) {                                           // the swing on or off: an arc between the ground and the seat
      const f = hop.k, a = f * f * (3 - 2 * f), from = hop.from, to = hop.to;
      const x = from ? from.x + (_rp.x - from.x) * a : _rp.x + (to.x - _rp.x) * a;
      const z = from ? from.z + (_rp.z - from.z) * a : _rp.z + (to.z - _rp.z) * a;
      const y0 = from ? from.y + 0.56 : _rp.y, y1 = from ? _rp.y : to.y + 0.56;
      _rp.x = x; _rp.z = z; _rp.y = y0 + (y1 - y0) * a + Math.sin(Math.PI * f) * 0.35;
    }
    const ride = hop ? (hop.from ? hop.k : 1 - hop.k) : 1;
    pm.root.position.set(_rp.x, _rp.y, _rp.z);
    _re.set(lean * ride, 0, side * ride); _rq.setFromEuler(_re);
    pm.root.quaternion.copy(_wq.setFromRotationMatrix(_m.extractRotation(L.root.matrix))).multiply(_rq);
    pm.body.position.set(0, -0.56, 0); pm.body.rotation.set(0, L.pose.steer * 0.35 * ride, 0); pm.body.scale.setScalar(1);
    // arms to the grips and legs to the footrests, aimed in the seat's frame and leaned with the rider
    const hipY = at[1] + 0.06, gr = m.grips || [[-0.36, at[1] + 0.15, at[2] + 0.62], [0.36, at[1] + 0.15, at[2] + 0.62]];
    const ft = m.feet || [[-0.33, at[1] - 0.5, at[2] + 0.15], [0.33, at[1] - 0.5, at[2] + 0.15]];
    const shY = 0.47 * Math.cos(lean), shZ = 0.47 * Math.sin(lean);
    const arm = (g) => Math.atan2(g[2] - at[2] - shZ, -(g[1] - hipY - shY));
    const leg = (f) => Math.atan2(f[2] - at[2], -(f[1] - hipY));
    const air = b.air ? 0.25 : 0;
    pm.armL.rotation.set(-(arm(gr[0]) + lean) * ride, 0, clamp(Math.atan2(gr[0][0] + 0.31, 0.45), -0.4, 0.4) * ride);
    pm.armR.rotation.set(-(arm(gr[1]) + lean) * ride, 0, clamp(Math.atan2(gr[1][0] - 0.31, 0.45), -0.4, 0.4) * ride);
    pm.legL.rotation.set(-(leg(ft[0]) + lean - air) * ride, 0, clamp(Math.atan2(ft[0][0] + 0.12, 0.5), -0.6, 0.6) * ride);
    pm.legR.rotation.set(-(leg(ft[1]) + lean - air) * ride, 0, clamp(Math.atan2(ft[1][0] - 0.12, 0.5), -0.6, 0.6) * ride);
    pm.armR.position.z = 0;
    P.x = _rp.x; P.z = _rp.z; P.y = _rp.y - 0.56; P.face = P.faceTarget = L.pose.yaw;
  }
  function releaseRider(yaw) {
    pm.root.rotation.set(0, yaw, 0);
    pm.body.position.set(0, 0, 0);
    for (const l of [pm.armL, pm.armR, pm.legL, pm.legR]) l.rotation.set(0, 0, 0);
    if (pm.hatchet) for (const h of pm.hatchet) h.visible = !P.hammer;
    P.face = P.faceTarget = yaw; P.air = false; P.vy = 0;
  }

  // ---------------------------------------------------------------- stepping a driven unit
  function stepUnit(L, dt, input) {
    const t0 = performance.now();
    L.acc += dt;
    let n = 0;
    const Lt = L.towL, tr = Lt ? L.trSpec || (L.trSpec = { body: null, kind: null }) : null;
    if (Lt) { tr.body = Lt.body; tr.kind = Lt.kind; Lt.body.cargoKg = Lt.loadKg; }
    L.surf = surfAt(L.body.x, L.body.z); L.water = waterAt(L.body.x, L.body.z);
    while (L.acc >= SUB && n < MAX_SUB) {
      VC.poseOf(L.body, L.prev);
      if (Lt) VC.poseOf(Lt.body, Lt.prev);
      VC.stepBody(L.body, L.kind, input, L.env, SUB, tr);
      L.land = Math.max(L.land || 0, L.body.land); L.bump = Math.max(L.bump || 0, L.body.bump);
      L.jack = L.jack || L.body.jack;
      L.acc -= SUB; n++;
    }
    if (n === MAX_SUB) L.acc = Math.min(L.acc, SUB);
    if (n) { VC.poseOf(L.body, L.cur); if (Lt) VC.poseOf(Lt.body, Lt.cur); }
    const f = clamp(L.acc / SUB, 0, 1);
    VC.lerpPose(L.prev, L.cur, f, L.pose);
    L.spin += (L.body.u * dt) / L.kind.wheelR;
    if (L.body.spin > 0.5) L.spin += (Math.sign(L.body.u || 1) * 9 * dt) * L.body.spin;    // spinning wheels turn faster than the ground
    draw(L, L.pose, dt, false);
    if (Lt) { VC.lerpPose(Lt.prev, Lt.cur, f, Lt.pose); Lt.spin += (Lt.body.u * dt) / Lt.kind.wheelR; draw(Lt, Lt.pose, dt, false); }
    stat.ms += performance.now() - t0; stat.sub += n;
  }

  // ---------------------------------------------------------------- hitching
  // a towed unit taken onto a driven one: its live body starts from the sim's pose (snapped onto the ball)
  function wakeTowed(L, Lt) {
    const u = S().units[Lt.id];
    park(Lt, u);
    Lt.body.artic = u.artic || 0; Lt.acc = 0; Lt.wake = 0; Lt.body.cargoKg = Lt.loadKg;
  }
  const guide = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), new T.LineBasicMaterial({ color: 0xf0dca0, transparent: true, opacity: 0.4, depthWrite: false, fog: false }));
  guide.visible = false; guide.frustumCulled = false; guide.renderOrder = 5;
  G.scene.add(guide);
  const _ball = {}, _gp = { x: 0, y: 0, z: 0 };
  // the loose towed unit whose tongue is nearest the driven unit's tow point of the type it hitches on
  function nearestTongue(L, r) {
    const b = L.body, s = S();
    let best = null;
    for (const Lt of live.values()) {
      const h = Lt.kind.hitch, su = s.units[Lt.id];
      if (Lt === L || !h || Lt.tip || !su || su.towedBy || su.towing) continue;
      const ball = VC.towPoint(b, L.kind, h.type, _ball);
      if (!ball) continue;
      const tx = Lt.body.x + Math.sin(Lt.body.yaw) * h.at[2], tz = Lt.body.z + Math.cos(Lt.body.yaw) * h.at[2], d = Math.hypot(ball.x - tx, ball.z - tz);
      if (d < r && (!best || d < best.d)) best = { Lt, d, ang: Math.abs(VC.wrap(Lt.body.yaw - b.yaw)) };
    }
    return best;
  }
  function hitchGuide(L) {
    const b = L.body, best = !L.towL && nearestTongue(L, GUIDE_M);
    const backing = b.u < -0.05 || b.gear < 0;
    if (!best || (!backing && best.d > 0.6)) { guide.visible = false; return; }
    const h = best.Lt.kind.hitch, lined = best.ang < (h.alignRad || 0.61), pt = (L.kind.points || []).find((q) => q.type === h.type);
    const pos = guide.geometry.attributes.position;
    toWorld(L, pt.at[0], pt.at[1], pt.at[2], _gp); pos.setXYZ(0, _gp.x, _gp.y + 0.02, _gp.z);
    toWorld(best.Lt, h.at[0], h.at[1], h.at[2], _gp); pos.setXYZ(1, _gp.x, _gp.y + 0.02, _gp.z);
    pos.needsUpdate = true;
    guide.material.color.setHex(lined ? 0xc8e6a0 : 0xf0dca0); guide.material.opacity = 0.2 + 0.35 * (1 - best.d / GUIDE_M);
    guide.visible = true;
    if (L.dropped === best.Lt.id) { if (best.d > 0.6) L.dropped = null; else return; }   // just unhitched: drive clear first
    if (best.d <= (h.latchM || 0.4) && backing) {
      if (lined && Math.abs(b.u) < 1.5) latch(L, best.Lt);
      else if (!lined && warnT <= 0) { say('Line the trailer up straighter to hitch it.', 1.4); warnT = 1.4; }
    }
  }
  function latch(L, Lt) {
    syncNow(L);                                            // the sim snaps the tongue onto the ball where the ball is now
    const r = G.sim.commandNow('vehicles.hitch', { id: L.id, to: Lt.id });
    if (!r.ok) { if (warnT <= 0) { say('Cannot hitch: ' + r.reason + '.', 1.5); warnT = 1.5; } return false; }
    L.towL = Lt; wakeTowed(L, Lt);
    L.body.u *= 0.2; guide.visible = false;
    G.cam.shake = Math.min(0.4, G.cam.shake + 0.09);
    say(Lt.kind.cargo && Lt.kind.cargo.tips ? 'Hitched. X unhitches; hold the left button to tip the bed.' : 'Hitched. X unhitches.', 3);
    return true;
  }
  function unhitch() {
    if (!seat || seat.phase !== 'ride') return { ok: false, reason: 'not seated' };
    const L = seat.L, Lt = L.towL;
    if (!Lt) { say('Nothing is hitched.', 1.2); return { ok: false, reason: 'not hitched' }; }
    if (Math.abs(L.body.u) > 0.5) { say('Stop first to unhitch.', 1.2); return { ok: false, reason: 'moving' }; }
    syncNow(L);
    const r = G.sim.commandNow('vehicles.unhitch', { id: L.id });
    if (!r.ok) return r;
    L.towL = null; Lt.bedWant = false; L.dropped = Lt.id;
    park(Lt, S().units[Lt.id]);
    G.cam.shake = Math.min(0.3, G.cam.shake + 0.04);
    say('Unhitched.', 1.5);
    return { ok: true };
  }

  // ---------------------------------------------------------------- the seat (a possession on the control stack)
  function seatOf() { const s = S(); return s ? VC.seatOf(s, 'player') : null; }
  function refusal(r) {
    return ({ 'build mode': 'Leave build mode first.', cooking: 'Not while cooking.', climbing: 'Get off the ladder first.', 'standing on something': 'Step down first.', 'hands busy': 'Put that down first.', 'arms full': 'Your arms are full.' })[r] || 'Not now.';
  }
  function mount(id, seatId) {
    const L = live.get(id);
    if (!L || seat || L.tip) return { ok: false, reason: seat ? 'already seated' : 'no such unit' };
    const can = control.canTake('seat');
    if (!can.ok) { say(refusal(can.reason)); return can; }
    const r = G.sim.commandNow('vehicles.sit', { id, seat: seatId, actor: 'player' });
    if (!r.ok) { say(r.reason === 'seat taken' ? 'Someone is on it.' : 'Cannot get on: ' + r.reason + '.'); return r; }
    enterSeat(L, r.seat, { x: P.x, y: P.y, z: P.z });
    if (!localStorage.getItem('veh:told')) { say('Push where you want to go. Space brakes, Shift is gentle throttle, E gets off.', 5); localStorage.setItem('veh:told', '1'); }
    return { ok: true };
  }
  function enterSeat(L, seatId, from) {
    seat = { L, seatId, phase: from ? 'on' : 'ride', t: 0, from, to: null, offReq: false, aWas: false, tipT: 0 };
    L.body.cargoKg = L.kind.riderKg || 0;
    L.body.u = L.body.w = L.body.r = 0; L.acc = 0; L.wake = 0;
    L.sent.burned = L.body.burnedL; L.sent.dist = L.body.distM; L.sent.engine = L.body.engineS; L.syncT = 0;
    setGlow(L, 0);
    if (pm.hatchet) for (const h of pm.hatchet) h.visible = false;
    seat.poss = control.push({
      id: 'seat', touch: 'drive', locks: { tools: true, pointer: 'keep' },
      cam: { distK: 1, leadS: 0.35 },
      update: ride,
      follow(out) {
        const p = L.pose, b = L.body, sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
        let vx = b.u * sy + b.w * cy, vz = b.u * cy - b.w * sy;
        const v = Math.hypot(vx, vz), cap = 5 / 0.35;                  // the look-ahead stops at 5 m
        if (v > cap) { vx *= cap / v; vz *= cap / v; }
        out.x = p.x; out.y = p.y + 0.2; out.z = p.z; out.vx = vx; out.vz = vz;
        return out;
      },
      onExit() {},
    });
    poseRider(L, from ? { k: 0, from } : null);
  }
  function syncNow(L) {
    const b = L.body;
    const r = G.sim.commandNow('vehicles.sync', { id: L.id, x: b.x, z: b.z, yaw: b.yaw, artic: L.towL ? L.towL.body.artic : undefined, burnedL: b.burnedL - L.sent.burned, distM: b.distM - L.sent.dist, engineS: b.engineS - L.sent.engine });
    L.sent.burned = b.burnedL; L.sent.dist = b.distM; L.sent.engine = b.engineS;
    if (r && r.ok) {
      b.fuelL = r.fuelL; const u = S().units[L.id]; L.parked.x = u.x; L.parked.z = u.z; L.parked.yaw = u.yaw;
      const tu = L.towL && S().units[L.towL.id];
      if (tu) { L.towL.parked.x = tu.x; L.towL.parked.z = tu.z; L.towL.parked.yaw = tu.yaw; }
    }
    L.syncT = 0;
    return r;
  }
  // where to put the rider down: the side toward the camera's right, then the other side, then behind
  function offSpot(L) {
    const k = L.kind, p = L.body, cr = Math.cos(G.cam.yaw) * Math.cos(p.yaw) + Math.sin(G.cam.yaw) * Math.sin(p.yaw);
    const first = cr >= 0 ? 1 : -1, hw = k.dims.w / 2 + 0.45, at = ((k.seats || [])[0] || { at: [0, 0, -0.2] }).at[2];
    const tries = [[first * hw, at], [-first * hw, at], [0, -k.dims.l / 2 - 0.5], [0, k.dims.l / 2 + 0.5]];
    const gy = G.groundAt(p.x, p.z, p.y + 1);
    for (const [lx, lz] of tries) {
      const o = VC.toWorld(p, lx, lz, {}), x = o.x, z = o.z;
      G.pushOut(o, 0.28);
      if (Math.hypot(o.x - x, o.z - z) > 0.06) continue;
      const h = G.groundAt(o.x, o.z, gy + 1);
      if (Math.abs(h - gy) > 1.1 || waterAt(o.x, o.z) > 0.6) continue;
      return { x: o.x, y: h, z: o.z };
    }
    return null;
  }
  function ride(dt, input) {
    const L = seat.L, b = L.body, k = L.kind;
    seat.t += dt;
    const aEdge = input.a && !seat.aWas; seat.aWas = input.a;           // touch: the act button presses E
    if (aEdge) seat.offReq = true;
    if (seat.phase === 'on') {
      const f = clamp(seat.t / HOP_S, 0, 1);
      draw(L, L.pose, dt, false);
      poseRider(L, { k: f, from: seat.from });
      if (f >= 1) { seat.phase = 'ride'; seat.t = 0; }
      return;
    }
    let drive;
    if (seat.phase === 'off') {
      drive = { throttle: 0, steer: 0, brake: 1 };
      stepUnit(L, dt, drive);
      const f = clamp(seat.t / HOP_S, 0, 1);
      poseRider(L, { k: f, to: seat.to });
      if (f >= 1) finishOff();
      return;
    }
    drive = VC.headingControl(b, k, input.mx, input.mz, { gentle: input.shift });
    if (input.brake) { drive.brake = 1; drive.throttle = 0; }
    {                                                      // what it tows: the sim says; the live body follows the ball
      const u = S().units[L.id], Lt = u && u.towing ? live.get(u.towing) || null : null;
      if (Lt !== L.towL) { L.towL = Lt; if (Lt) wakeTowed(L, Lt); }
      if (Lt) { Lt.bedWant = !!(seat.useDown && Lt.kind.cargo && Lt.kind.cargo.tips); guide.visible = false; }
      else if (k.points && k.points.length) hitchGuide(L);
      if (seat.useDown && !Lt && warnT <= 0) { say('Nothing to tip: hitch a trailer first.', 1.2); warnT = 1.2; }
    }
    if (seat.offReq) {
      if (Math.abs(b.u) < OFF_MPS) {
        seat.offReq = false;
        const spot = offSpot(L);
        if (!spot) say('No room to get off here.');
        else { seat.phase = 'off'; seat.t = 0; seat.to = spot; }
      } else { drive.brake = 1; drive.throttle = 0; }
    }
    stepUnit(L, dt, drive);
    poseRider(L, null);
    // the camera: a little further out with speed; a shake on a hard landing or a knock
    seat.poss.cam.distK = 1 + 0.15 * Math.min(1, Math.abs(b.u) / k.topMps);
    if (L.land > 0.8) { G.cam.shake = Math.min(0.55, G.cam.shake + 0.06 * L.land); landPuff(L); }
    if (L.bump > 2) G.cam.shake = Math.min(0.5, G.cam.shake + 0.04 * L.bump);
    L.land = L.bump = 0;
    if (L.jack) { L.jack = false; if (warnT <= 0) { say('Jackknifed: pull forward to straighten the trailer.', 1.6); warnT = 1.6; } }
    // fuel, side slopes
    if (b.stalled === 'fuel' && sayT <= 0) say('Out of fuel.', 2.5);
    if (b.stalled === 'water' && sayT <= 0) say('Too deep: the engine drowned.', 2.5);
    if (b.tip > TIP_WARN) {
      if (warnT <= 0) { say(b.tip > 1 ? 'Tipping!' : 'Steep side slope: ease off.', 1.2); warnT = 1.2; }
      seat.tipT = b.tip > 1 && !b.air ? seat.tipT + dt : 0;
      if (seat.tipT > TIP_OVER_S) return tipOver(L);
    } else seat.tipT = 0;
    L.syncT += dt;
    if (L.syncT >= SYNC_S && (b.distM - L.sent.dist > 0.01 || b.burnedL - L.sent.burned > 0)) syncNow(L);
  }
  function finishOff() {
    const L = seat.L, yaw = L.body.yaw, to = seat.to;
    syncNow(L);
    G.sim.commandNow('vehicles.leave', { id: L.id, seat: seat.seatId });
    L.body.cargoKg = 0; L.wake = 1.2;                      // a moment to settle on its springs, braked
    if (L.towL) { L.towL.bedWant = false; park(L.towL, S().units[L.towL.id]); }
    guide.visible = false;
    const h = seat.poss;
    seat = null;
    control.pop(h, 'off');
    P.x = to.x; P.z = to.z; P.y = to.y;
    releaseRider(yaw);
  }
  // a soft roll-over: the rider jumps clear uphill, the machine goes over on its side, then is set back on its wheels
  function tipOver(L) {
    const b = L.body, dir = Math.sign(Math.tan(b.roll) + b.ay / 9.81) || 1;
    syncNow(L);
    G.sim.commandNow('vehicles.leave', { id: L.id, seat: seat.seatId });
    const hw = L.kind.dims.w / 2 + 0.9, o = VC.toWorld(b, dir * hw, 0, {});
    G.pushOut(o, 0.28);
    const h = seat.poss;
    seat = null;
    control.pop(h, 'tip');
    P.x = o.x; P.z = o.z; P.y = G.groundAt(o.x, o.z, b.y + 1);
    releaseRider(b.yaw);
    L.body.cargoKg = 0; b.u = b.w = b.r = 0;
    if (L.towL) { L.towL.bedWant = false; park(L.towL, S().units[L.towL.id]); }
    guide.visible = false;
    L.tip = { t: 0, k: 0, dir };
    G.cam.shake = Math.min(0.6, G.cam.shake + 0.35);
    say('It rolled over. You jumped clear.', 3);
  }
  function dismount() {
    if (!seat) return { ok: false, reason: 'not seated' };
    seat.offReq = true;
    return { ok: true };
  }
  function landPuff(L) {
    const b = L.body;
    G.burst(b.x, b.y + 0.1, b.z, 5, 0x9a8a6a, 1.6, 0.8, 0.12, 0.6);
  }

  // ---------------------------------------------------------------- the world: reconcile with the sim, mount zones
  function reset() {
    if (seat) { const h = seat.poss; seat = null; control.pop(h, 'reset'); releaseRider(P.face); }
    guide.visible = false;
    for (const L of [...live.values()]) destroy(L);
    simRef = G.sim; buildV = -1; zone = null;
  }
  function reconcile() {
    const s = S();
    if (!s) return;
    for (const id in s.units) {
      const u = s.units[id], L = live.get(id);
      if (!L) { create(u); continue; }
      const driven = seat && (seat.L === L || seat.L.towL === L);
      if (!driven && !L.wake && !L.tip && (Math.abs(u.x - L.parked.x) > 1e-3 || Math.abs(u.z - L.parked.z) > 1e-3 || Math.abs(VC.wrap(u.yaw - L.parked.yaw)) > 1e-3)) park(L, u);
    }
    for (const L of [...live.values()]) if (!s.units[L.id]) { if (seat && seat.L === L) reset(); else destroy(L); }
    const bv = window.__build ? window.__build.version : 0;
    if (bv !== buildV) { buildV = bv; for (const L of live.values()) if (!(seat && (seat.L === L || seat.L.towL === L)) && !L.wake && !L.tip) park(L, s.units[L.id]); }
    if (!seat) {                                           // after a load: the save had the player on a seat
      const so = seatOf(), L = so && live.get(so.id);
      if (L) enterSeat(L, so.seat, null);
    }
  }
  // walking into a unit's side, pushing toward the seat, for a moment: swing on
  function mountZones(dt) {
    let best = null;
    if (control.walking()) {
      const inp = control.input;
      for (const L of live.values()) {
        if (L.tip) continue;
        const k = L.kind, b = L.body, dx = P.x - b.x, dz = P.z - b.z;
        if (dx * dx + dz * dz > 9 || Math.abs(P.y - b.y) > 1.2) continue;
        const c = Math.cos(b.yaw), s = Math.sin(b.yaw), lx = dx * c - dz * s, lz = dx * s + dz * c, hw = k.dims.w / 2;
        for (const st of k.seats || []) for (const zn of st.mount || []) {
          if (Math.sign(lx) !== zn.side || Math.abs(lx) < hw - 0.1 || Math.abs(lx) > hw + 0.65 || lz < zn.x0 || lz > zn.x1) continue;
          if (S().units[L.id].seats[st.id] != null) continue;
          const ix = -zn.side * c, iz = zn.side * s;          // toward the unit: minus its right times the side
          const push = inp.mx * ix + inp.mz * iz;
          best = { L, seat: st.id, push };
        }
      }
    }
    for (const L of live.values()) setGlow(L, best && best.L === L ? 0.6 : 0);
    if (!best || best.push < 0.4) { zone = null; return; }
    if (!zone || zone.L !== best.L) zone = { L: best.L, t: 0 };
    zone.t += dt;
    if (zone.t >= ZONE_HOLD_S) { zone = null; mount(best.L.id, best.seat); }
  }
  // units that were just left settle on their springs, braked, then sleep; a rolled one goes over and comes back
  function settleUnits(dt) {
    for (const L of live.values()) {
      if (L.cg) bedTick(L, dt);
      if (seat && (seat.L === L || seat.L.towL === L)) continue;
      if (L.tip) {
        const t = (L.tip.t += dt);
        L.tip.k = t < 0.6 ? Math.sin((t / 0.6) * Math.PI / 2) : t < 2.4 ? 1 : Math.max(0, 1 - (t - 2.4) / 0.8);
        draw(L, L.pose, dt, false);
        if (t > 3.2) { L.tip = null; park(L, S().units[L.id]); }
        continue;
      }
      if (L.wake > 0) {
        L.wake -= dt;
        const b = L.body, x = b.x, z = b.z, yaw = b.yaw;
        stepUnit(L, dt, { throttle: 0, steer: 0, brake: 1 });
        b.x = x; b.z = z; b.yaw = yaw; b.u = b.w = b.r = 0;
        if (L.wake <= 0) { L.wake = 0; VC.poseOf(b, L.pose); draw(L, L.pose, 0, true); }
      }
    }
  }
  G.stepHooks.push((dt) => {
    if (G.sim !== simRef) reset();
    reconcile();
    mountZones(dt);
    settleUnits(dt);
    if (sayT > 0) { sayT -= dt; if (sayT <= 0) say(''); }
    if (warnT > 0) warnT -= dt;
    stat.frames++;
  });

  // ---------------------------------------------------------------- collisions: the player and other units against a unit's box
  control.colliders.push((o, rad) => {
    for (const L of live.values()) {
      if (L === stepping || (stepping && stepping.towL === L) || (seat && seat.L === L && o === P)) continue;
      const b = L.body, dx = o.x - b.x, dz = o.z - b.z, reach = L.kind.dims.l / 2 + rad + 0.2;
      if (dx * dx + dz * dz > reach * reach) continue;
      if (o.y != null && Math.abs(o.y - b.y) > 1.6) continue;
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw), hw = L.kind.dims.w / 2 + rad, hl = L.kind.dims.l / 2 + rad;
      const lx = dx * c - dz * s, lz = dx * s + dz * c, px = hw - Math.abs(lx), pz = hl - Math.abs(lz);
      if (px <= 0 || pz <= 0) continue;
      if (px < pz) { const d = Math.sign(lx || 1) * px; o.x += d * c; o.z -= d * s; }
      else { const d = Math.sign(lz || 1) * pz; o.x += d * s; o.z += d * c; }
    }
  });

  // ---------------------------------------------------------------- keys and clicks while seated
  // While seated the walking keys that would switch tools, open build mode or act with the hands are the seat's:
  // E steps off, the rest are swallowed. Panels (stock, weather, help, quality, speed) still open.
  const BLOCK = /^(Digit\d|Key[EQFRCBLKXZ])$/;
  window.addEventListener('keydown', (e) => {
    if (!seat || !BLOCK.test(e.code)) return;
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (e.code === 'KeyE' && !e.repeat) seat.offReq = true;
    if (e.code === 'KeyX' && !e.repeat) unhitch();
  }, true);
  window.addEventListener('pointerdown', (e) => {
    if (!seat || e.target !== canvas || e.pointerType !== 'mouse') return;
    e.stopImmediatePropagation();
    if (e.button === 0 && document.pointerLockElement === canvas) seat.useDown = true;     // held: the implement (tips a bed)
    if (document.pointerLockElement !== canvas) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* refused: the engine's lock prompt stays */ } }
  }, true);
  const useUp = () => { if (seat) seat.useDown = false; };
  window.addEventListener('pointerup', useUp, true); window.addEventListener('blur', useUp);
  // commit the pose before the engine saves on the way out (capture listeners at the target run first)
  const flush = () => { if (seat && seat.phase === 'ride') syncNow(seat.L); };
  window.addEventListener('pagehide', flush, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); }, true);

  // ---------------------------------------------------------------- finding room
  function clearAt(x, z, rad) {
    const o = { x, z };
    G.pushOut(o, rad);
    return Math.hypot(o.x - x, o.z - z) < 0.03;
  }
  function findSpot(cx, cz, { rMin = 3, rMax = 8, rad = 1.3, away = null, n = 32 } = {}) {
    let best = null;
    for (let i = 0; i < n; i++) {
      const r = rMin + ((rMax - rMin) * ((i * 7) % n)) / n, a = (i / n) * Math.PI * 2 + (away ? Math.atan2(cx - away.x, cz - away.z) : 0);
      const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r, h = G.groundAt(x, z, G.heightAt(x, z) + 0.5);
      if (h < G.sea + 0.3 || waterAt(x, z) > 0.02) continue;
      const slope = Math.abs(G.groundAt(x + 1.2, z, h + 1) - G.groundAt(x - 1.2, z, h + 1)) + Math.abs(G.groundAt(x, z + 1.2, h + 1) - G.groundAt(x, z - 1.2, h + 1));
      if (slope > 0.8 || !clearAt(x, z, rad)) continue;
      const score = slope + Math.abs(a - (away ? Math.atan2(cx - away.x, cz - away.z) : 0)) * 0.05 + (r - rMin) * 0.02;
      if (!best || score < best.score) best = { x, z, yaw: Math.atan2(cx - x, cz - z) + Math.PI / 2, score };
    }
    return best && { x: best.x, z: best.z, yaw: VC.wrap(best.yaw) };
  }

  // ---------------------------------------------------------------- the interface
  window.__vehicles = {
    register({ models, surface, onStroke, onDump } = {}) {
      if (models) Object.assign(content.models, models);
      if (onDump) content.onDump = onDump;
      if (surface) content.surface = surface;
      if (onStroke) content.onStroke = onStroke;
      for (const L of [...live.values()]) if (!(seat && seat.L === L)) destroy(L);    // redrawn with the new models
    },
    units: () => (S() ? S().units : {}), unit: (id) => (S() ? S().units[id] || null : null), kinds,
    driven: () => (seat ? seat.L.id : null),
    mount: (id, seatId) => mount(id, seatId), dismount,
    body(id) {
      const L = live.get(id);
      if (!L) return null;
      const p = L.pose, b = L.body;
      return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, roll: p.roll, steer: p.steer, speed: b.u, slip: b.slip, spin: b.spin, rpm: b.rpm, gear: b.gear, tip: b.tip, air: b.air, fuelL: b.fuelL, surface: L.surf };
    },
    bedPoint(id, out = {}) {
      const L = live.get(id), c = L && L.kind.cargo;
      return c ? toWorld(L, c.bed.at[0], c.bed.at[1], c.bed.at[2], out) : null;
    },
    nearest(x, z, r = 4) {
      let best = null, bd = r * r;
      for (const L of live.values()) { const d = (L.body.x - x) ** 2 + (L.body.z - z) ** 2; if (d < bd) { bd = d; best = L.id; } }
      return best;
    },
    spawn(kind = 'atv', x, z, yaw) {
      if (x == null) { const f = G.player.face; x = P.x + Math.sin(f) * 3.5; z = P.z + Math.cos(f) * 3.5; yaw = f + Math.PI / 2; }
      const r = G.sim.commandNow('vehicles.add', { kind, x, z, yaw: yaw || 0 });
      if (r.ok) reconcile();
      return r.ok ? r.id : r;
    },
    findSpot,
    get gen() { return gen; },
    hitch(id) {                                            // the driven unit onto the nearest loose towed unit in reach (tests, console)
      if (!seat) return { ok: false, reason: 'not seated' };
      const L = seat.L, best = nearestTongue(L, 0.6), Lt = id ? live.get(id) : best && best.Lt;
      return Lt && latch(L, Lt) ? { ok: true } : { ok: false, reason: 'nothing in reach' };
    },
    unhitch,
    setCargo(id, groups, kg = 0) {
      const L = live.get(id);
      if (!L || !L.cg) return false;
      L.loadKg = kg > 0 ? kg : 0; L.body.cargoKg = L.loadKg;
      applyCargo(L, groups || []);
      return true;
    },
    flyFrom(id, p) { const L = live.get(id); if (!L || !L.cg) return false; L.cg.from = { x: p.x, y: p.y, z: p.z }; L.cg.fromT = 0.6; return true; },
    carrierNear(x, z, r = 4) {
      let best = null, bd = Infinity;
      for (const L of live.values()) {
        if (!L.cg || L.tip || L.bedA > 0.05) continue;
        const d = Math.hypot(L.body.x - x, L.body.z - z) - L.kind.cargo.bed.l / 2;
        if (d < r && d < bd) { bd = d; best = L.id; }
      }
      return best;
    },
    bed(id) { const L = live.get(id); return L && L.cg ? { angle: L.bedA, sliding: L.cg.slide >= 0, pieces: L.cg.hidden ? 0 : L.cg.slots.length, kg: L.loadKg } : null; },
    tip(on = true) { if (seat && seat.L.towL) { seat.useDown = !!on; return true; } return false; },     // tests: as holding the left button
    unstick(id) {                                          // push a parked unit out of whatever it is stuck in (page only until it is driven)
      const L = live.get(id);
      if (!L || (seat && seat.L === L)) return false;
      for (let i = 0; i < 8; i++) { const o = { x: L.body.x, z: L.body.z }; stepping = L; G.pushOut(o, L.kind.dims.w / 2); stepping = null; L.body.x = o.x; L.body.z = o.z; }
      VC.settle(L.body, L.kind, L.env); VC.poseOf(L.body, L.pose); draw(L, L.pose, 0, true);
      return true;
    },
    // microseconds per drive substep of a unit here (4 ground reads, 3 push-outs, the model): __vehicles.bench()
    bench(id, n = 2000) {
      const L = live.get(id || (seat ? seat.L.id : live.keys().next().value));
      if (!L) return null;
      const b = VC.createBody(L.kind, { x: L.body.x, z: L.body.z, yaw: L.body.yaw, fuelL: 10 }, L.env), inp = { throttle: 0.6, steer: 0.3 };
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { stepping = L; VC.stepBody(b, L.kind, inp, L.env, SUB); }
      stepping = null;
      return +(((performance.now() - t0) / n) * 1000).toFixed(2);
    },
    stats() { const f = Math.max(1, stat.frames), r = { msPerFrame: +(stat.ms / f).toFixed(4), subPerFrame: +(stat.sub / f).toFixed(2), units: live.size, driven: seat ? seat.L.id : null }; stat.ms = stat.sub = stat.frames = 0; return r; },
    say,
  };
})();
