/* Hands: working with what the character holds, at arm's reach.
   A generic mechanism, with no knowledge of what the held things are for:
   - a hotbar of things to hold (number keys, the wheel, or a click choose one), drawn into an element the caller gives;
   - reach-limited aiming: the pointer picks a spot on the ground, clamped to arm's reach around the character, who
     turns to face it; a marker shows the spot and a faint circle shows the reach;
   - gesture measures while the button is held, in one `aim` object the caller reads: the pull of a stroke toward the
     character, the path travelled, the tip (pointer dragged down, or the second button), the lift (dragged up) and
     the sideways sweep;
   - pick(objects): what the pointer is over among any 3D objects, for targets that are not ground;
   - the held thing shown in the character's hands (carried at rest, shouldered when walking, put to the aimed spot
     in use), and a moment of holding something up overhead.
   The caller supplies slots and handlers through window.__hands.open(). Reaches the game only through window.__game.
   Cost: one ground pick and a few matrix writes a frame while open; nothing while closed. No DOM writes per frame. */
(() => {
  const G = window.__game;
  if (!G || !G.THREE) return;
  const T = G.THREE, canvas = document.getElementById('view');
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------------- ground picking ---------------- */
  const ray = new T.Raycaster(), v2 = new T.Vector2(), v3 = new T.Vector3();
  function groundAt(nx, ny, out) {
    v2.set(nx, ny); ray.setFromCamera(v2, G.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    let t = 0, prev = 0;
    for (let i = 0; i < 200 && t < 140; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, h = G.heightAt(x, z);
      if (y < h) {
        let a = prev, b = t;
        for (let k = 0; k < 10; k++) { const m = (a + b) / 2; if (o.y + d.y * m < G.heightAt(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
        out.x = o.x + d.x * b; out.z = o.z + d.z * b; out.y = G.heightAt(out.x, out.z);
        return out;
      }
      prev = t; t += Math.max(0.15, (y - h) * 0.5);
    }
    return null;
  }
  function toScreen(x, y, z, out) {
    v3.set(x, y, z).project(G.camera);
    out.x = (v3.x * 0.5 + 0.5) * innerWidth; out.y = (-v3.y * 0.5 + 0.5) * innerHeight; out.vis = v3.z < 1;
    return out;
  }

  /* ---------------- state ---------------- */
  // everything a caller needs to know about where the hands are and what the pointer is doing
  const aim = {
    x: 0, y: 0, z: 0, valid: false, far: false, dist: 0,          // the aimed spot (clamped to reach); far: the pointer is beyond reach
    down: false, second: false, held: 0,                           // main button, second button, seconds held
    sx: 0, sy: 0, dx: 0, dy: 0,                                    // pointer in screen pixels, and its travel since the press
    ox: 0, oz: 0, travel: 0, pull: 0,                              // where the press landed; metres the spot has travelled; metres pulled toward the character
    tip: 0, lift: 0, side: 0,                                      // 0..1 tip (dragged down or second button), 0..1 lift (dragged up), pixels sideways
    shift: false, touch: false,
  };
  const ptr = { ndcX: 0, ndcY: 0, pressNdcY: 0, px: 0, py: 0, rx: 0, ry: 0, turning: false, inside: false, ux: 0, uz: 0, lx: 0, lz: 0, id: -1 };
  const gp = { x: 0, y: 0, z: 0 };
  let cfg = null, cur = null, slots = [], slotSig = '', barEl = null;
  let saved = null;      // camera distance and pitch before opening
  let zoomK = 1;         // the stance's own zoom (the wheel, where the stance asks for it)
  const trophy = { obj: null, t: 0, secs: 0, done: null };

  /* ---------------- markers ---------------- */
  const markMat = new T.MeshBasicMaterial({ color: 0xfff2c4, transparent: true, opacity: 0.9, depthTest: false });
  const mark = new T.Mesh(new T.RingGeometry(0.13, 0.17, 28), markMat);
  mark.rotation.x = -Math.PI / 2; mark.renderOrder = 12; mark.visible = false; G.scene.add(mark);
  const dot = new T.Mesh(new T.CircleGeometry(0.035, 12), markMat); dot.position.z = 0.001; mark.add(dot);
  const reachGeo = new T.BufferGeometry();
  { const p = []; for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; p.push(Math.sin(a), 0, Math.cos(a)); } reachGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(p), 3)); }
  const reachRing = new T.Line(reachGeo, new T.LineBasicMaterial({ color: 0xfff2c4, transparent: true, opacity: 0.22, depthTest: false }));
  reachRing.renderOrder = 11; reachRing.visible = false; reachRing.frustumCulled = false; G.scene.add(reachRing);
  let markCol = -1;
  function setMark(hex, scale) { if (hex !== markCol) { markCol = hex; markMat.color.setHex(hex); } mark.scale.setScalar(scale || 1); }

  /* ---------------- the hotbar ---------------- */
  function drawBar() {
    if (!barEl) return;
    let h = '';
    slots.forEach((s, i) => {
      h += '<button type="button" class="hslot' + (s.dim ? ' dim' : '') + '" data-slot="' + s.id + '" aria-pressed="' + (cur && cur.id === s.id) + '" title="' + (s.title || s.name) + '">' +
        (i < 9 ? '<span class="key ui-key">' + (i + 1) + '</span>' : '') + s.icon + '<span class="nm">' + s.name + '</span>' +
        (s.badge != null ? '<span class="bdg">' + s.badge + '</span>' : '') +
        (s.meter != null ? '<span class="mtr"><i style="width:' + Math.round(clamp(s.meter, 0, 1) * 100) + '%"></i></span>' : '') + '</button>';
    });
    barEl.innerHTML = h;
  }
  // The caller hands over the slots whenever they may have changed; the bar is redrawn only if they did.
  function setSlots(list) {
    let sig = cur ? cur.id : '';
    for (const s of list) sig += '|' + s.id + ':' + s.name + ':' + (s.badge ?? '') + ':' + (s.meter != null ? Math.round(s.meter * 50) : '') + (s.dim ? 'd' : '');
    slots = list;
    const was = cur && cur.id;
    cur = list.find((s) => s.id === was) || list[0] || null;
    if (cur && cur.id !== was) { showItem(); sig = ''; }
    else if (cur) { const o = cur.item && cur.item.obj; if (o !== shown) showItem(); }
    if (sig !== slotSig) { slotSig = sig; drawBar(); }
  }
  function hold(id, quiet) {
    const s = slots.find((x) => x.id === id);
    if (!s) return false;
    const changed = !cur || cur.id !== s.id;
    if (aim.down) endPress();
    cur = s; slotSig = ''; setSlots(slots); showItem();
    if (!quiet && cfg && cfg.onHold) cfg.onHold(s.id, changed);
    return true;
  }
  let shown = null;
  function showItem() {
    const o = cur && cur.item && cur.item.obj;
    if (shown && shown !== o) G.pm.root.remove(shown);
    if (o && o.parent !== G.pm.root) G.pm.root.add(o);
    shown = o || null;
  }

  /* ---------------- input ---------------- */
  function setPtr(e) {
    const r = canvas.getBoundingClientRect();
    aim.sx = e.clientX; aim.sy = e.clientY; ptr.inside = true;
    ptr.ndcX = ((e.clientX - r.left) / r.width) * 2 - 1; ptr.ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1);
  }
  function locate() {
    const P = G.player, R = cfg.reach || 1.5;
    const hit = groundAt(ptr.ndcX, aim.down && cur && cur.freezeY ? ptr.pressNdcY : ptr.ndcY, gp);
    aim.valid = !!hit && ptr.inside;
    if (!hit) return;
    aim.gx = gp.x; aim.gz = gp.z;                          // the ground under the pointer, before reach clamps it
    let dx = gp.x - P.x, dz = gp.z - P.z, d = Math.hypot(dx, dz);
    aim.far = d > R + 0.6;
    const min = 0.3;
    if (d < 1e-4) { dx = Math.sin(P.face); dz = Math.cos(P.face); d = 1; aim.dist = min; }
    else aim.dist = clamp(d, min, R);
    aim.x = P.x + (dx / d) * aim.dist; aim.z = P.z + (dz / d) * aim.dist; aim.y = (G.surfaceAt || G.heightAt)(aim.x, aim.z);
  }
  function endPress(e) {
    if (!aim.down) return;
    aim.down = false; aim.second = false;
    if (cfg && cfg.release) cfg.release(aim, cur);
  }
  const fingers = new Map();
  const turn = (mx, my) => { G.cam.yaw -= mx * 0.005; G.cam.pitch = clamp(G.cam.pitch + my * 0.004, cfg && cfg.camFree ? 0.35 : 0.5, 1.35); if (saved) saved.pitchSet = G.cam.pitch; };
  window.addEventListener('pointerdown', (e) => {
    if (!cfg || e.target !== canvas) return;
    e.stopImmediatePropagation(); e.preventDefault();
    canvas.focus();
    aim.touch = e.pointerType === 'touch';
    if (aim.touch) { fingers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (fingers.size > 1) { endPress(); return; } }
    setPtr(e);
    // the middle button always turns the view; the right button does too, unless the item in hand has a second use
    // for it (the shovel: the flat of the blade), when it is a press of its own (aim.alt)
    const alt = e.button === 2 && !aim.down && !!(cfg.alt && cfg.alt(cur));
    if (e.button === 1 || (e.button === 2 && !alt)) {
      if (aim.down) aim.second = true;                       // second button while working: tip all the way
      else { ptr.turning = true; ptr.rx = ptr.rx0 = e.clientX; ptr.ry = ptr.ry0 = e.clientY; }
      return;
    }
    if (e.button !== 0 && !alt) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    aim.down = false; locate();
    if (!aim.valid) return;
    const P = G.player;
    aim.down = true; aim.alt = alt; aim.held = 0; aim.shift = e.shiftKey; ptr.px = e.clientX; ptr.py = e.clientY; ptr.pressNdcY = ptr.ndcY;
    aim.dx = aim.dy = aim.travel = aim.pull = aim.lift = aim.side = 0; aim.tip = 0;
    aim.ox = ptr.lx = aim.x; aim.oz = ptr.lz = aim.z;
    const d = Math.hypot(P.x - aim.x, P.z - aim.z) || 1; ptr.ux = (P.x - aim.x) / d; ptr.uz = (P.z - aim.z) / d;
    if (cfg.press) cfg.press(aim, cur);
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!cfg || (e.target !== canvas && !aim.down && !ptr.turning)) return;
    e.stopImmediatePropagation();
    if (e.pointerType === 'touch' && fingers.size > 1) {       // two fingers turn and tilt the view
      const f = fingers.get(e.pointerId); if (!f) return;
      turn(e.clientX - f.x, e.clientY - f.y); f.x = e.clientX; f.y = e.clientY; return;
    }
    if (ptr.turning && (e.buttons & 6)) { turn(e.clientX - ptr.rx, e.clientY - ptr.ry); ptr.rx = e.clientX; ptr.ry = e.clientY; return; }
    setPtr(e);
    if (aim.down) { aim.dx = e.clientX - ptr.px; aim.dy = e.clientY - ptr.py; aim.side = Math.max(aim.side, Math.abs(aim.dx)); aim.shift = e.shiftKey; }
  }, true);
  const up = (e) => {
    if (!cfg) return;
    if (e.pointerType === 'touch') fingers.delete(e.pointerId);
    if (e.button === 2 && aim.down && aim.alt) { e.stopImmediatePropagation(); endPress(); return; }
    if (e.button === 1) { ptr.turning = false; return; }
    if (e.button === 2) {
      // a right-click that did not drag the view is a tap: the stance may use it (the yard sets where earth goes)
      const tap = ptr.turning && Math.hypot(e.clientX - (ptr.rx0 ?? e.clientX), e.clientY - (ptr.ry0 ?? e.clientY)) < 6;
      ptr.turning = false; aim.second = false; e.stopImmediatePropagation();
      if (tap && cfg.second && e.target === canvas) { setPtr(e); locate(); if (aim.valid) cfg.second(aim, cur); }
      return;
    }
    if (!aim.down || aim.alt) return;
    e.stopImmediatePropagation();
    endPress();
  };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  canvas.addEventListener('pointerleave', () => { if (cfg && !aim.down) ptr.inside = false; });
  window.addEventListener('wheel', (e) => {
    if (!cfg || e.target !== canvas) return;
    // a stance with a free camera: the wheel zooms (shift: tilts); otherwise it steps through what is in hand
    if (cfg.camFree) {
      e.stopImmediatePropagation(); e.preventDefault();
      if (e.shiftKey) turn(0, e.deltaY * 0.25); else zoomK = clamp(zoomK * Math.exp(e.deltaY * 0.0012), 0.4, 2.4);
      return;
    }
    if (!slots.length) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const i = slots.indexOf(cur), n = slots.length;
    hold(slots[(i + (e.deltaY > 0 ? 1 : n - 1)) % n].id);
  }, { capture: true, passive: false });
  window.addEventListener('keydown', (e) => {
    if (!cfg || e.repeat || (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))) return;
    const m = /^Digit([1-9])$/.exec(e.code);
    if (!m) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const s = slots[+m[1] - 1];
    if (s) hold(s.id);
  }, true);
  window.addEventListener('blur', () => { endPress(); ptr.turning = false; });

  /* ---------------- every frame, from the engine's player update ---------------- */
  const Q = new T.Quaternion(), UP = new T.Vector3(0, 1, 0), DIR = new T.Vector3(), E = new T.Euler();
  function place(o, a) { o.position.set(a[0], a[1], a[2]); o.rotation.set(a[3] || 0, a[4] || 0, a[5] || 0); }
  function tick(pm, P, dt) {
    if (!cfg) return;
    locate();
    const moving = P.speed > 0.2;
    if (aim.down) {
      aim.held += dt;
      aim.travel += Math.hypot(aim.x - ptr.lx, aim.z - ptr.lz); ptr.lx = aim.x; ptr.lz = aim.z;
      aim.pull = (aim.x - aim.ox) * ptr.ux + (aim.z - aim.oz) * ptr.uz;
      const want = aim.second ? 1 : clamp(aim.dy / (cfg.tipPx || 90), 0, 1);
      aim.tip += (want - aim.tip) * (1 - Math.exp(-14 * dt));
      aim.lift = clamp(-aim.dy / (cfg.liftPx || 70), 0, 1);
    } else aim.tip = 0;
    // the character turns to what the hands reach for; walking with empty attention faces the way it walks
    P.faceHold = aim.valid && (aim.down || !moving) ? Math.atan2(aim.x - P.x, aim.z - P.z) : null;
    if (cfg.frame) cfg.frame(aim, dt, cur);

    // the marker and the reach circle
    mark.visible = aim.valid && !trophy.obj;
    if (mark.visible) mark.position.set(aim.x, aim.y + 0.07, aim.z);
    reachRing.visible = true; reachRing.position.set(P.x, P.y + 0.06, P.z); reachRing.scale.setScalar(cfg.reach || 1.5);

    // the camera comes in close while the hands work
    if (saved) { const k = 1 - Math.exp(-5 * dt); G.cam.dist += ((cfg.camDist || 8) * zoomK - G.cam.dist) * k; }
    // Q and E turn the view (a free camera)
    if (cfg.camFree && G.keys) { const ty = (G.keys.KeyQ ? 1 : 0) - (G.keys.KeyE ? 1 : 0); if (ty) turn(-ty * 340 * dt, 0); }

    // arms, and the thing in them
    const it = cur && cur.item, o = shown;
    if (trophy.obj) {
      trophy.t += dt;
      const k = trophy.t / trophy.secs, pop = k < 0.15 ? k / 0.15 : k > 0.85 ? Math.max(0, (1 - k) / 0.15) : 1;
      pm.armL.rotation.x = pm.armR.rotation.x = -3.0 * Math.min(1, pop * 1.3);
      pm.body.rotation.x = -0.08;
      trophy.obj.position.set(0, 1.5 + 0.3 * pop + Math.sin(trophy.t * 9) * 0.015, 0.02);
      trophy.obj.scale.setScalar(trophy.scale * (0.3 + 0.7 * pop) * (k < 0.3 ? 1 + 0.25 * Math.sin((k / 0.3) * Math.PI) : 1));
      trophy.obj.rotation.y += dt * 2.4;
      if (o) o.visible = false;
      if (trophy.t >= trophy.secs) { pm.root.remove(trophy.obj); const d = trophy.done; trophy.obj = null; trophy.done = null; if (d) d(); }
      return;
    }
    if (!o || !it) { if (aim.down) { pm.armR.rotation.x = -1.15; pm.armL.rotation.x = -0.9; pm.body.rotation.x += 0.28; } return; }
    o.visible = true;
    // an item with its own motion (a shovel stroke) poses the body and itself while that motion runs
    if (it.anim && it.anim(o, pm, toLocal, dt)) return;
    const using = aim.down && it.use;
    if (!using) {
      place(o, moving && it.walk ? it.walk : it.still);
      pm.armR.rotation.x = moving && it.walk ? it.walkArm ?? -0.9 : it.stillArm ?? -0.55;
      return;
    }
    // the aimed spot in the character's own frame (+z ahead)
    const wx = aim.x - P.x, wz = aim.z - P.z, c = Math.cos(P.face), s = Math.sin(P.face);
    const lx = wx * c - wz * s, lz = wx * s + wz * c, ly = aim.y - P.y;
    if (it.use === 'tip') {
      // a long tool: its working end on the aimed spot, its handle back to the hands
      const chop = aim.held < 0.1 ? (1 - aim.held / 0.1) * 0.5 : 0;
      o.position.set(lx, ly + 0.03 + chop, lz);
      DIR.set(0.05 - lx, 1.0 - ly - chop * 0.4, 0.3 - lz).normalize();
      o.quaternion.copy(Q.setFromUnitVectors(UP, DIR));
      pm.armL.rotation.x = pm.armR.rotation.x = -0.75 - 0.5 * clamp(aim.dist / (cfg.reach || 1.5), 0, 1);
      pm.body.rotation.x += 0.12 + 0.3 * clamp(aim.dist / (cfg.reach || 1.5), 0, 1);
    } else if (it.use === 'over') {
      // a vessel: carried out toward the aimed spot and tipped by the gesture
      const d = Math.hypot(lx, lz) || 1, r = Math.min(d, it.overD ?? 0.6);
      E.set((it.tiltHold || 0) + aim.tip * (it.tiltMax ?? 1.1), Math.atan2(lx, lz), 0, 'YXZ');
      o.position.set((lx / d) * r, (it.overH ?? 0.9) + ly * 0.3 - aim.tip * 0.08, (lz / d) * r); o.quaternion.setFromEuler(E);
      pm.armL.rotation.x = pm.armR.rotation.x = -1.25; pm.body.rotation.x += 0.15;
    } else {
      place(o, it.reach || it.still);
      pm.armR.rotation.x = -1.3; pm.body.rotation.x += 0.2 + 0.25 * clamp(aim.dist / (cfg.reach || 1.5), 0, 1);
    }
  }

  // a world point in the character's own frame (+z ahead), for items that animate themselves
  function toLocal(x, y, z, out = { x: 0, y: 0, z: 0 }) {
    const P = G.player, wx = x - P.x, wz = z - P.z, c = Math.cos(P.face), s = Math.sin(P.face);
    out.x = wx * c - wz * s; out.z = wx * s + wz * c; out.y = y - P.y;
    return out;
  }

  /* ---------------- open and close ---------------- */
  function open(c) {
    if (cfg) close();
    cfg = c; barEl = c.bar || null; slotSig = '';
    if (document.pointerLockElement) document.exitPointerLock();
    saved = { dist: G.cam.dist, pitch: G.cam.pitch, pitchSet: null }; zoomK = 1;
    if (c.camPitch) G.cam.pitch = c.camPitch;
    G.player.pace = c.pace || 0.5;
    G.handPose = tick;
    if (G.pm.hatchet) for (const m of G.pm.hatchet) m.visible = false;
    setSlots(c.slots || []);
    if (c.held) hold(c.held, true);
    showItem();
  }
  function close() {
    if (!cfg) return;
    endPress();
    if (trophy.obj) { G.pm.root.remove(trophy.obj); trophy.obj = null; }
    if (shown) { G.pm.root.remove(shown); shown = null; }
    if (saved) { G.cam.dist = saved.dist; if (saved.pitchSet == null) G.cam.pitch = saved.pitch; saved = null; }
    G.player.pace = 0; G.player.faceHold = null; G.player.lead = null; G.handPose = null;
    if (G.pm.hatchet) for (const m of G.pm.hatchet) m.visible = true;
    mark.visible = false; reachRing.visible = false;
    cfg = null; cur = null; ptr.turning = false;
  }
  if (barEl === null) document.addEventListener('click', (e) => {
    if (!cfg || !barEl) return;
    const b = e.target.closest && e.target.closest('.hslot');
    if (b && barEl.contains(b)) { hold(b.dataset.slot); canvas.focus(); }
  });

  // What the pointer is over among the given objects (any Object3D list): the nearest hit { object, point, distance }
  // or null. For callers whose targets are things rather than ground: a handle, a spout, a fruit.
  function pick(objects, recursive = true) {
    v2.set(ptr.ndcX, ptr.ndcY); ray.setFromCamera(v2, G.camera);
    const hits = ray.intersectObjects(objects, recursive);
    return hits.length ? hits[0] : null;
  }
  window.__hands = {
    aim, open, close, setSlots, hold, groundAt, toScreen, setMark, pick,
    get isOpen() { return !!cfg; }, get held() { return cur ? cur.id : null; }, get slots() { return slots; },
    // hold something up overhead for a beat: obj is any Object3D, shown above the head and then handed back to `done`
    raise(obj, secs, scale, done) {
      if (trophy.obj) { G.pm.root.remove(trophy.obj); if (trophy.done) trophy.done(); }
      trophy.obj = obj; trophy.t = 0; trophy.secs = secs; trophy.scale = scale || 1; trophy.done = done || null;
      G.pm.root.add(obj);
    },
    get raising() { return !!trophy.obj; },
  };
})();
