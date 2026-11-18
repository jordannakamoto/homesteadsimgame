// The controller stack: the one place that decides what body the input drives and what the camera follows.
// Generic (no game words). Imported by engine.js and bundled with it; exposed as window.__game.control.
//
//   possession  exclusive, a stack. The bottom entry is the built-in 'walk' (the engine's own updatePlayer).
//               A possession's update(dt, input) runs instead of walking; follow(out) moves the camera target;
//               camera(dt, camera) may place the camera completely; cam = { distK, pitch, leadS, fov } are soft
//               wants the rig eases in and out.
//   modifiers   not exclusive: control.mod(id, { pace, standY, climbY, lead, faceHold, carryK } | null).
//               Composed once a frame and written to the player, only for fields some modifier owns, so code
//               that still writes those player fields directly keeps working.
//   camera      control.cam.request(id, { dist, pitch, k, priority } | null): the rig remembers what the player
//               chose (cam.user) and blends the top request over it; releasing eases back.
//   input       control.input: one normalised read so keys and a touch stick are the same thing to a controller.
//   colliders   extra pushers (o, rad) => void, run by the engine's pushOut.

const MULT = ['pace', 'carryK'];                              // multiply; 0 / unset means "no effect" to the engine
const LAST = ['standY', 'climbY', 'lead', 'faceHold'];       // the most recently set non-null wins
const NEUTRAL = { pace: 0, carryK: 0, standY: null, climbY: null, lead: null, faceHold: null };

export function createControl({ player, cam, keys, mouse }) {
  const walk = { id: 'walk', touch: 'walk', locks: null };
  const stack = [walk];
  const top = () => stack[stack.length - 1];

  // ---- possession
  function push(p) {
    if (!p || !p.id) throw new Error('control.push: a possession needs an id');
    stack.push(p);
    if (p.onEnter) p.onEnter();
    return p;
  }
  function pop(handle, reason) {
    const i = stack.indexOf(handle);
    if (i <= 0) return false;                                 // never the walk entry
    stack.splice(i, 1);
    if (handle.onExit) handle.onExit(reason || 'pop');
    return true;
  }
  const is = (id) => top().id === id;
  const walking = () => top() === walk;
  const guards = [];                                          // (id) => reason string | null; the game adds its own
  function canTake(id) {
    if (!walking()) return { ok: false, reason: top().id };
    for (const g of guards) { const r = g(id); if (r) return { ok: false, reason: r }; }
    return { ok: true };
  }

  // ---- input
  const input = { mx: 0, mz: 0, ix: 0, iz: 0, a: false, b: false, brake: false, shift: false };
  function readInput() {
    let ix = 0, iz = 0;
    if (keys.KeyW || keys.ArrowUp) iz += 1;
    if (keys.KeyS || keys.ArrowDown) iz -= 1;
    if (keys.KeyD || keys.ArrowRight) ix += 1;
    if (keys.KeyA || keys.ArrowLeft) ix -= 1;
    ix += keys.joyX || 0; iz += keys.joyY || 0;
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    // camera-relative, in world space: forward is where the camera looks (as the engine's walk reads it)
    const fwx = -Math.sin(cam.yaw), fwz = -Math.cos(cam.yaw), rxw = Math.cos(cam.yaw), rzw = -Math.sin(cam.yaw);
    input.ix = ix; input.iz = iz;
    input.mx = fwx * iz + rxw * ix; input.mz = fwz * iz + rzw * ix;
    input.a = !!keys.KeyE; input.b = !!keys.KeyQ; input.brake = !!keys.Space;
    input.shift = !!(keys.ShiftLeft || keys.ShiftRight);
    return input;
  }
  // called at the top of the engine's updatePlayer: true = a possession moved the body, skip walking
  function possess(dt) {
    readInput();
    const p = top();
    if (p === walk) return false;
    if (p.update) p.update(dt, input);
    mouse.left = mouse.right = false;                         // the walking tools do not see clicks meant for the possession
    return true;
  }

  // ---- modifiers
  const mods = new Map();                                     // id -> values; insertion order = order last set
  let owned = new Set();
  function mod(id, v) {
    mods.delete(id);
    if (v) mods.set(id, v);
  }
  function compose() {
    if (!mods.size && !owned.size) return;
    const now = new Set();
    for (const f of MULT) {
      let k = 1, any = false;
      for (const v of mods.values()) if (v[f] != null) { k *= v[f]; any = true; }
      if (any) { player[f] = k; now.add(f); }
    }
    for (const f of LAST) {
      let val = null, any = false;
      for (const v of mods.values()) if (v[f] != null) { val = v[f]; any = true; }
      if (any) { player[f] = val; now.add(f); }
    }
    for (const f of owned) if (!now.has(f)) player[f] = NEUTRAL[f];   // the last owner let go: back to neutral, once
    owned = now;
  }

  // ---- camera: the rig (possession wants) and requests (dist / pitch over the player's own choice)
  const rig = { distK: 1, pitchW: 0, pitchT: 0, fovW: 0, fovT: 40, lx: 0, lz: 0 };
  const ease = (a, b, t) => (Math.abs(b - a) < 1e-4 ? b : a + (b - a) * t);
  const fol = { x: 0, y: 0, z: 0, vx: 0, vz: 0 };
  // the point the default camera follows, with the possession's look-ahead; the player when nobody is possessed
  function follow() {
    const p = top();
    let r = null;
    if (p.follow) { fol.vx = fol.vz = 0; r = p.follow(fol); }
    if (!r) { fol.x = player.x; fol.y = player.y; fol.z = player.z; fol.vx = fol.vz = 0; }
    fol.x += rig.lx; fol.z += rig.lz;
    return fol;
  }
  function stepRig(dt) {
    const w = top().cam || null, t = 1 - Math.exp(-3 * dt);
    rig.distK = ease(rig.distK, w && w.distK != null ? w.distK : 1, t);
    rig.pitchW = ease(rig.pitchW, w && w.pitch != null ? 1 : 0, t);
    if (w && w.pitch != null) rig.pitchT = w.pitch;
    rig.fovW = ease(rig.fovW, w && w.fov != null ? 1 : 0, t);
    if (w && w.fov != null) rig.fovT = w.fov;
    const lead = w && w.leadS ? w.leadS : 0, tl = 1 - Math.exp(-2 * dt);
    rig.lx = ease(rig.lx, top().follow ? fol.vx * lead : 0, tl);
    rig.lz = ease(rig.lz, top().follow ? fol.vz * lead : 0, tl);
  }
  rig.pitch = (p) => (rig.pitchW > 0 ? p + (rig.pitchT - p) * rig.pitchW : p);
  rig.fov = (f) => (rig.fovW > 0 ? f + (rig.fovT - f) * rig.fovW : f);

  const reqs = new Map();                                     // id -> { dist, pitch, k, priority, seq }
  let seq = 0, wrote = null, back = null, own = { dist: false, pitch: false };
  const user = { dist: cam.dist, pitch: cam.pitch };
  function request(id, r) {
    if (!r) { reqs.delete(id); return; }
    const old = reqs.get(id);
    reqs.set(id, { ...r, priority: r.priority || 0, seq: old ? old.seq : ++seq });
  }
  function topReq() {
    let best = null;
    for (const r of reqs.values()) if (!best || r.priority > best.priority || (r.priority === best.priority && r.seq > best.seq)) best = r;
    return best;
  }
  const moved = (f) => wrote && Math.abs(cam[f] - wrote[f]) > 1e-6;     // the wheel or mouse changed it since the rig wrote it
  function stepRequests(dt) {
    const r = topReq();
    if (!r && !back) { user.dist = cam.dist; user.pitch = cam.pitch; wrote = null; own.dist = own.pitch = false; return; }
    for (const f of ['dist', 'pitch']) if (moved(f)) own[f] = true;   // the player takes that number back
    const goal = r || back, t = goal.k ? 1 - Math.exp(-goal.k * dt) : 1;
    let done = true;
    for (const f of ['dist', 'pitch']) {
      if (own[f]) { if (!r) user[f] = cam[f]; continue; }
      const want = r ? r[f] : user[f];
      if (want == null) continue;
      cam[f] = ease(cam[f], want, t);
      if (cam[f] !== want) done = false;
    }
    wrote = { dist: cam.dist, pitch: cam.pitch };
    if (r) back = { k: r.k };                                 // when the last request goes, ease back at its pace
    else if (done) { back = null; wrote = null; own.dist = own.pitch = false; }
  }
  // called at the top of the engine's updateCamera: true = a possession placed the camera completely
  function camera(dt, cameraObj) {
    stepRequests(dt);
    stepRig(dt);
    const p = top();
    return !!(p.camera && p.camera(dt, cameraObj));
  }

  return {
    push, pop, top, is, walking, canTake, guards,
    mod, compose, possess, input, follow, camera, rig,
    cam: { request, user, get requests() { return reqs; } },
    colliders: [],
    get stack() { return stack.slice(); },
  };
}
