/* Reach (window.__reach): the smallest pointer-and-reach layer the hands-on add-ons need, written to be
   swapped for src/engine/hands.js (window.__hands: hotbar, reach aiming, gestures, the overhead beat) when
   that lands. Nothing here knows what is being handled. It owns: the Hands mode (F), a free pointer aimed
   at things within arm's reach of the character, press / drag / release dispatch to whoever owns what is
   aimed at, one hint line, the carrying pose, and a short held-overhead beat.

   INTERFACE (the part add-ons use; keep these names when swapping to __hands)
     __reach.use(user)        register: { id, near(px, pz) -> bool, hover(R) -> hit | null, press(hit, R), move(hit, R),
                              release(hit, R), secondary(R) -> bool, key(code, R) -> bool, hint(R) -> string | null, frame(dt, R) }
                              hit = { score (smaller wins), hint, x, y, z (where, to face it), ... the user's own fields }
     R (passed to every call) { ray (THREE.Ray through the pointer), ptr { x, y, dx, dy since press, down }, player, reach (m),
                              ground { x, y, z } | null, held (whatever a user put in the hands, or null), on,
                              within(x, z, extra?), rayDist(x, y, z) -> { d, t }, hand() -> { x, y, z, yaw },
                              say(text, secs?), pose(l, r, lean, secs), beat(text), beating (0..1), hold(thing), drop() }
     __reach.on, enter(), leave()
   Cost: with Hands off, one distance check four times a second. No per-frame DOM writes: the hint is written only when its text changes. */
(() => {
  const G = window.__game;
  if (!G || !G.THREE) return;
  const T = G.THREE, canvas = document.getElementById('view'), P = G.player, cam = G.cam;
  const REACH = 2.9, clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const css = document.createElement('style');
  css.textContent = '#reachhint{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:7;padding:7px 14px;font-size:15px;max-width:min(92vw,720px);text-align:center;pointer-events:none;white-space:pre-line}' +
    '#reachhint[hidden],#reachbeat[hidden]{display:none}#reachhint b{color:#ffd98a}' +
    '#reachbeat{position:fixed;left:50%;top:22%;transform:translateX(-50%);z-index:8;font-size:26px;font-weight:700;color:#fff3c9;text-shadow:0 2px 0 #3a2a12,0 0 18px rgba(255,214,120,.7);pointer-events:none;text-align:center}' +
    'body.handsmode #lock,body.handsmode #reticle,body.handsmode #stance,body.handsmode #combo{display:none!important}body.handsmode #view{cursor:crosshair}body.handsmode.grab #view{cursor:grabbing}';
  document.head.appendChild(css);
  const hintEl = document.createElement('div'); hintEl.id = 'reachhint'; hintEl.className = 'panel'; hintEl.hidden = true; hintEl.setAttribute('aria-live', 'polite');
  const beatEl = document.createElement('div'); beatEl.id = 'reachbeat'; beatEl.hidden = true;
  document.body.append(hintEl, beatEl);

  const users = [], ray = new T.Raycaster(), v2 = new T.Vector2();
  const ptr = { x: 0, y: 0, ndcX: 0, ndcY: 0, down: false, px: 0, py: 0, dx: 0, dy: 0, inside: false };
  let on = false, hit = null, active = null, saved = null, hintSig = '', slow = 0, near = false, last = performance.now();
  let flashMsg = '', flashUntil = 0, poseT = null, poseUntil = 0, beatT0 = -1e9, wantDist = 6.5, rdrag = null, engineRing = null;
  const findRing = () => engineRing || (engineRing = G.scene.children.find((o) => o.isMesh && o.geometry && o.geometry.type === 'RingGeometry') || null);
  const _g = { x: 0, y: 0, z: 0 };
  function groundAt() {
    const o = ray.ray.origin, d = ray.ray.direction;
    let t = 0;
    for (let i = 0; i < 160 && t < 80; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, h = G.heightAt(x, z);
      if (y < h) { _g.x = x; _g.y = h; _g.z = z; return _g; }
      t += Math.max(0.08, (y - h) * 0.5);
    }
    return null;
  }
  const R = {
    ray: ray.ray, ptr, player: P, reach: REACH, ground: null, held: null, beating: 0,
    get on() { return on; },
    within: (x, z, extra = 0) => Math.hypot(x - P.x, z - P.z) <= REACH + extra,
    // perpendicular distance from the pointer ray to a point, and how far along the ray that is
    rayDist(x, y, z) {
      const o = ray.ray.origin, d = ray.ray.direction, ax = x - o.x, ay = y - o.y, az = z - o.z, t = Math.max(0, ax * d.x + ay * d.y + az * d.z);
      return { d: Math.hypot(ax - d.x * t, ay - d.y * t, az - d.z * t), t };
    },
    hand() { const f = P.face; return { x: P.x + Math.sin(f) * 0.5, y: P.y + 1.0, z: P.z + Math.cos(f) * 0.5, yaw: f }; },
    overhead() { return { x: P.x, y: P.y + 2.15, z: P.z, yaw: P.face }; },
    say(text, secs = 3) { flashMsg = text; flashUntil = performance.now() + secs * 1000; },
    pose(l, r, lean = 0, secs = 0.25) { poseT = { l, r, lean }; poseUntil = performance.now() + secs * 1000; },
    face(x, z) { if (Math.hypot(x - P.x, z - P.z) > 0.15) P.faceTarget = Math.atan2(x - P.x, z - P.z); },
    beat(text) {
      beatT0 = performance.now(); beatEl.textContent = text; beatEl.hidden = false;
      for (let i = 0; i < 3; i++) G.burst(P.x, P.y + 2.2, P.z, 10, [0xffe9a0, 0xfff6d8, 0xffc95e][i], 2.2, 2.6, 0.07, 0.9);
      cam.shake = Math.min(cam.shake + 0.12, 0.5);
    },
    hold(thing) { R.held = thing; }, drop() { R.held = null; },
  };
  function setRay() { v2.set(ptr.ndcX, ptr.ndcY); ray.setFromCamera(v2, G.camera); R.ground = groundAt(); }
  function hover() {
    if (active) return;
    setRay();
    let best = null;
    for (const u of users) { const h = u.hover && u.hover(R); if (h && (!best || h.score < best.score)) { h.user = u; best = h; } }
    hit = best;
  }
  function hintText() {
    if (performance.now() < flashUntil) return flashMsg;
    if (!on) return near ? '<b>F</b>  use your hands' : '';
    if (active && active.hit.hintDown) return active.hit.hintDown;
    if (hit && hit.hint) return hit.hint;
    for (const u of users) { const h = u.hint && u.hint(R); if (h) return h; }
    return 'Aim at something within reach.  Right-drag turns the view.  <b>F</b> puts your hands away';
  }
  function writeHint() {
    const t = hintText();
    if (t === hintSig) return;
    hintSig = t; hintEl.hidden = !t;
    if (t) hintEl.innerHTML = t;
  }

  function enter() {
    if (on || P.tool === 'build') return;
    on = true; saved = { dist: cam.dist, pitch: cam.pitch, tool: P.tool === 'hands' ? 'axe' : P.tool };
    G.setTool('hands');
    document.body.classList.add('handsmode');
    if (document.pointerLockElement) document.exitPointerLock();
    const r = findRing(); if (r) r.scale.setScalar(0);
    wantDist = 6.5; cam.pitch = Math.min(cam.pitch, 0.8);
    hover();
  }
  function leave(keepTool) {
    if (!on) return;
    on = false; document.body.classList.remove('handsmode', 'grab');
    if (active) { active.user.release && active.user.release(active.hit, R, true); active = null; }
    for (const u of users) u.leave && u.leave(R);
    const r = findRing(); if (r) r.scale.setScalar(1);
    if (saved) { cam.dist = saved.dist; cam.pitch = saved.pitch; if (!keepTool) G.setTool(saved.tool); }
    P.handPose = null; hit = null;
  }
  function setPtr(e) {
    const r = canvas.getBoundingClientRect();
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.ndcX = ((e.clientX - r.left) / r.width) * 2 - 1; ptr.ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1);
  }
  window.addEventListener('pointerdown', (e) => {
    if (!on || e.target !== canvas) return;
    e.stopImmediatePropagation(); e.preventDefault(); canvas.focus();
    setPtr(e);
    if (e.button === 2) { rdrag = { x: e.clientX, y: e.clientY, moved: 0 }; return; }
    if (e.button !== 0 || active) return;
    hover();
    ptr.down = true; ptr.px = e.clientX; ptr.py = e.clientY; ptr.dx = ptr.dy = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (hit) {
      active = { user: hit.user, hit };
      if (hit.x !== undefined) R.face(hit.x, hit.z);
      document.body.classList.add('grab');
      hit.user.press && hit.user.press(hit, R);
    } else for (const u of users) if (u.pressNothing && u.pressNothing(R)) break;
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!on || (e.target !== canvas && !ptr.down && !rdrag)) return;
    e.stopImmediatePropagation();
    if (rdrag && (e.buttons & 2)) {
      const dx = e.clientX - rdrag.x, dy = e.clientY - rdrag.y;
      rdrag.moved += Math.abs(dx) + Math.abs(dy); rdrag.x = e.clientX; rdrag.y = e.clientY;
      cam.yaw -= dx * 0.005; cam.pitch = clamp(cam.pitch + dy * 0.004, 0.3, 1.35);
      return;
    }
    setPtr(e); ptr.inside = true;
    if (active) { ptr.dx = e.clientX - ptr.px; ptr.dy = e.clientY - ptr.py; setRay(); active.user.move && active.user.move(active.hit, R); }
    else hover();
  }, true);
  const up = (e) => {
    if (!on) return;
    if (rdrag && e.button === 2) {
      const click = rdrag.moved < 6; rdrag = null; e.stopImmediatePropagation();
      if (click) for (const u of users) if (u.secondary && u.secondary(R)) break;
      return;
    }
    if (!ptr.down) return;
    e.stopImmediatePropagation();
    ptr.down = false; document.body.classList.remove('grab');
    if (active) { const a = active; active = null; setRay(); a.user.release && a.user.release(a.hit, R, false); }
    hover();
  };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  canvas.addEventListener('contextmenu', (e) => { if (on) e.preventDefault(); });
  window.addEventListener('wheel', (e) => { if (!on || e.target !== canvas) return; e.stopImmediatePropagation(); e.preventDefault(); wantDist = clamp(wantDist * Math.exp(e.deltaY * 0.0012), 3.5, 14); }, { capture: true, passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (P.tool === 'build' || (G.cooking && G.cooking.active)) return;
    if (e.code === 'KeyF' && !e.repeat) { on ? leave() : enter(); e.preventDefault(); return; }
    if (!on) return;
    if (e.code === 'Escape') { leave(); return; }
    if (e.repeat) return;
    for (const u of users) if (u.key && u.key(e.code, R)) { e.preventDefault(); e.stopImmediatePropagation(); hover(); return; }
  }, true);
  const toolBtn = document.querySelector('#tools button[data-tool="hands"]');
  if (toolBtn) toolBtn.addEventListener('click', (e) => { e.stopImmediatePropagation(); on ? leave() : enter(); canvas.focus(); }, true);

  function frame(t) {
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    if (on && P.tool !== 'hands') leave(true);                 // another tool was chosen
    if (!on && P.tool === 'hands') enter();
    if (on) {
      const target = R.held ? Math.min(wantDist, 5.6) : wantDist;
      cam.dist += (target - cam.dist) * Math.min(1, dt * 5);
      if (ptr.inside && !rdrag) { if (active) { setRay(); active.user.move && active.user.move(active.hit, R); } else hover(); }
      const now = performance.now(), b = (now - beatT0) / 1000;
      R.beating = b < 1.5 ? 1 : 0;
      if (b >= 2.4 && !beatEl.hidden) beatEl.hidden = true;
      P.handPose = R.beating ? { l: -2.95, r: -2.95, lean: -0.08 } : now < poseUntil ? poseT : R.held ? { l: -1.1, r: -1.1, lean: 0.04 } : null;
    } else if (!beatEl.hidden && (performance.now() - beatT0) / 1000 >= 2.4) beatEl.hidden = true;
    slow += dt;
    if (!on && slow > 0.25) { slow = 0; near = P.tool !== 'build' && users.some((u) => u.near && u.near(P.x, P.z)); }
    for (const u of users) u.frame && u.frame(dt, R);
    writeHint();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__reach = { use: (u) => { users.push(u); return R; }, get on() { return on; }, enter, leave, R, get hit() { return hit; }, hintText };
})();
