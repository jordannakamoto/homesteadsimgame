/* Planning cable and pipe in a building (window.__servicesPlan): two clicks. Hands (F) near a framed building
   shows four buttons: Power, Cold, Hot, Waste (keys 1 to 4). Every place a run can start glows: a breaker panel,
   a tank or heater, the last box of a circuit, a stub. Click one (or any stud to start fresh), then aim at the
   frame: a ghost box or stub snaps beside the nearest stud at a preset height (the wheel steps the preset), and
   the route draws itself along the studs and joists, dashed, with a dot at every hole. Click to plan it; R tries
   another way; drag the dashes to pin a point the route must pass. The new box becomes the next start, so a
   circuit is a chain of single clicks. Right-click steps back. A route that cannot be says why, in plain words.
   Content on the generic layers: __reach (pointer, hint), __game.routes (router and frame channels), the routes
   commands (the truth) and __servicesView (which draws what is planned). It also keeps the routes system's frames
   in step with where the buildings stand (__build.structs), so runs move with a moved building.
   Cost: hands off, one building signature compare every two seconds. Hands on and planning: the route is found
   only when the snapped target changes; the dashes and glows are a few dozen instance matrices a frame. */
(() => {
  const G = window.__game, RCH = window.__reach;
  if (!G || !RCH || !G.sim || !G.routes || !G.sim.handlers.has('routes.addRun') || !G.sim.handlers.has('services.sync')) return;
  const T = G.THREE, Rr = RCH.R, P = G.player;
  const B = () => window.__build;
  const SV = () => G.sim.systems.find((s) => s.name === 'services').api;
  const RS = () => G.sim.state.sys.routes;
  const cmd = (n, p) => { try { return G.sim.commandNow(n, p) || { ok: true }; } catch (e) { console.warn('services-plan: ' + n + ' failed: ' + e.message); return { ok: false, reason: e.message }; } };
  const PLAN_M = 7.5;                                     // how far from the player a run may be planned
  const hex = (c) => parseInt(String(c).slice(1), 16);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

  // the four kinds of run; presets are what the wheel steps through
  const MODES = [
    { id: 'power', key: 'Digit1', name: 'Power', cls: 'cable', colour: '#f2c94c', starts: ['box', 'box_ceiling', 'slot'], noun: 'box',
      presets: [{ id: 'outlet', name: 'Outlet', h: 0.4, kind: 'box', spec: 'cable_nm_14_2' }, { id: 'switch', name: 'Switch', h: 1.2, kind: 'box', spec: 'cable_nm_14_2' },
        { id: 'counter', name: 'Counter outlet', h: 1.1, kind: 'box', spec: 'cable_nm_12_2' }, { id: 'light', name: 'Ceiling light', on: 'ceiling', kind: 'box_ceiling', spec: 'cable_nm_14_2' }] },
    { id: 'cold', key: 'Digit2', name: 'Cold', cls: 'supply', colour: '#4a8fe8', starts: ['stub_supply', 'port'], noun: 'stub', spec: 'pex_12_blue', equip: ['storage', 'pump', 'pressure'],
      presets: [{ id: 'sink', name: 'Sink', h: 0.5, kind: 'stub_supply' }, { id: 'toilet', name: 'Toilet', h: 0.2, kind: 'stub_supply' }, { id: 'shower', name: 'Shower valve', h: 1.2, kind: 'stub_supply' }] },
    { id: 'hot', key: 'Digit3', name: 'Hot', cls: 'supply', colour: '#e0503a', starts: ['stub_supply', 'port'], noun: 'stub', spec: 'pex_12_red', equip: ['heater'],
      presets: [{ id: 'sink', name: 'Sink', h: 0.5, kind: 'stub_supply' }, { id: 'shower', name: 'Shower valve', h: 1.2, kind: 'stub_supply' }] },
    { id: 'waste', key: 'Digit4', name: 'Waste', cls: 'drain', colour: '#b07a48', starts: ['stub_drain', 'exit', 'cleanout'], noun: 'drain',
      presets: [{ id: 'sink', name: 'Sink drain', h: 0.45, kind: 'stub_drain', spec: 'dwv_40' }, { id: 'toilet', name: 'Toilet drain', on: 'floor', kind: 'stub_drain', spec: 'dwv_75' },
        { id: 'shower', name: 'Shower drain', on: 'floor', kind: 'stub_drain', spec: 'dwv_50' }, { id: 'exit', name: 'Out of the building', on: 'exit', kind: 'exit' }] },
  ];
  const DIAM = { dwv_40: 40, dwv_50: 50, dwv_75: 75, dwv_100: 100 };

  /* ================= the strip ================= */
  const css = document.createElement('style');
  css.textContent = '#svplan{position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:7;display:flex;gap:6px;padding:6px 8px}#svplan[hidden]{display:none}' +
    '#svplan button{display:flex;align-items:center;gap:6px;font-size:14px;padding:5px 11px}#svplan button i{width:10px;height:10px;border-radius:50%;display:inline-block}' +
    '#svplan button kbd{font:11px var(--font-body,system-ui);opacity:.6}#svplan button[aria-pressed="true"]{border-color:currentColor;background:rgba(255,255,255,.14)}';
  document.head.appendChild(css);
  const strip = document.createElement('div'); strip.id = 'svplan'; strip.className = 'panel'; strip.hidden = true;
  strip.innerHTML = MODES.map((m, i) => '<button data-m="' + m.id + '" aria-pressed="false" style="color:' + m.colour + '"><i style="background:' + m.colour + '"></i><span style="color:var(--ink)">' + m.name + '</span><kbd>' + (i + 1) + '</kbd></button>').join('');
  document.body.appendChild(strip);
  strip.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { setMode(mode && mode.id === b.dataset.m ? null : b.dataset.m); document.getElementById('view') && document.getElementById('view').focus(); } });
  function paintStrip() { for (const b of strip.querySelectorAll('button')) b.setAttribute('aria-pressed', String(!!mode && mode.id === b.dataset.m)); }

  /* ================= frames follow the buildings ================= */
  let frameSig = '', frameSim = null, frameT = 0;
  const _p = new T.Vector3(), _q = new T.Quaternion(), _s = new T.Vector3(), _e = new T.Euler();
  function syncFrames(force) {
    const b = B(); if (!b || !b.structs) return;
    const list = b.structs(), sig = list.map((s) => s.id + ':' + r3(s.x) + ':' + r3(s.z) + ':' + r3(s.yaw) + ':' + r3(s.y0)).join('|');
    if (!force && sig === frameSig && frameSim === G.sim) return;
    frameSig = sig; frameSim = G.sim;
    const frames = {}, cur = RS().frames || {};
    for (const s of list) {
      const m = b.membersOf(s.id); if (!m) continue;
      m.matrix.decompose(_p, _q, _s); _e.setFromQuaternion(_q, 'YXZ');
      frames[String(s.id)] = { x: r3(_p.x), y: r3(_p.y), z: r3(_p.z), yaw: Math.round(_e.y * 1e5) / 1e5 };
    }
    const same = Object.keys(frames).length === Object.keys(cur).length && Object.entries(frames).every(([k, f]) => cur[k] && ['x', 'y', 'z', 'yaw'].every((q) => Math.abs((cur[k][q] || 0) - f[q]) < 1e-3));
    if (!same) cmd('routes.setFrames', { frames });
  }
  const frameMat = (fid) => { const f = RS().frames[fid]; return f ? new T.Matrix4().makeRotationY(f.yaw || 0).setPosition(f.x, f.y, f.z) : null; };

  /* ================= what is near ================= */
  let near = null;                                         // { id, frame, ch, M, Mi, s }
  function nearest(px, pz) {
    const b = B(); if (!b || !b.structs) return null;
    let best = null;
    for (const s of b.structs()) { const d = Math.hypot(s.x - px, s.z - pz) - (s.r || 3); if (d < 3 && (!best || d < best.d)) best = { d, s }; }
    if (!best) return null;
    const ch = G.routes.channelsFor(best.s.id);
    if (!ch || !ch.walls.length) return null;
    return { id: best.s.id, frame: String(best.s.id), ch, s: best.s };
  }
  function refreshNear() {
    near = nearest(P.x, P.z);
    if (near) {
      if (!RS().frames[near.frame]) syncFrames(true);
      near.M = frameMat(near.frame) || new T.Matrix4(); near.Mi = near.M.clone().invert();
    }
  }
  const toWorld = (p) => new T.Vector3(p[0], p[1], p[2]).applyMatrix4(near.M);
  const toLocal = (v) => { const q = new T.Vector3(v.x, v.y, v.z).applyMatrix4(near.Mi); return [q.x, q.y, q.z]; };

  /* ================= the scene bits: glows, ghost, dashes, holes ================= */
  const root = new T.Group(); root.name = 'services-plan'; G.scene.add(root); root.visible = false;
  const glowMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, fog: false, blending: T.AdditiveBlending });
  const ghostMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false, fog: false });
  const dashMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, fog: false });
  const holeMat = new T.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, fog: false, transparent: true });
  const NG = 32, ND = 600, NH = 64;
  const glows = new T.InstancedMesh(new T.SphereGeometry(0.07, 12, 8), glowMat, NG); glows.renderOrder = 22; glows.frustumCulled = false; glows.count = 0;
  const dashes = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), dashMat, ND); dashes.renderOrder = 23; dashes.frustumCulled = false; dashes.count = 0;
  const holes = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), holeMat, NH); holes.renderOrder = 24; holes.frustumCulled = false; holes.count = 0;
  holes.instanceColor = new T.InstancedBufferAttribute(new Float32Array(NH * 3), 3);
  const ghost = new T.Mesh(new T.BoxGeometry(1, 1, 1), ghostMat); ghost.renderOrder = 25; ghost.visible = false;
  const startMark = new T.Mesh(new T.TorusGeometry(0.11, 0.018, 6, 20), glowMat.clone()); startMark.renderOrder = 25; startMark.visible = false;
  const pinMark = new T.Mesh(new T.SphereGeometry(0.05, 10, 8), new T.MeshBasicMaterial({ color: 0xffffff, depthTest: false, fog: false })); pinMark.renderOrder = 26; pinMark.visible = false;
  root.add(glows, dashes, holes, ghost, startMark, pinMark);
  const M4 = new T.Matrix4(), V3 = new T.Vector3(), V3b = new T.Vector3(), Q = new T.Quaternion(), S3 = new T.Vector3(), X = new T.Vector3(1, 0, 0), C3 = new T.Color();

  /* ================= state ================= */
  let mode = null, presetI = {}, start = null, target = null, cur = null, pin = null, locked = false, drag = null, sockets = [], socketsKey = '', tAnim = 0, reveal = 1, flash = 0;
  const preset = () => mode.presets[(presetI[mode.id] || 0) % mode.presets.length];
  function setMode(id) {
    mode = MODES.find((m) => m.id === id) || null;
    start = target = cur = pin = null; locked = false; drag = null; socketsKey = '';
    paintStrip(); drawRoute(null);
    if (mode && !RCH.on) RCH.enter();
  }

  // the runs that end on each node
  function runsAt() {
    const by = {};
    for (const r of Object.values(RS().runs)) for (const e of [r.a, r.b]) (by[e] || (by[e] = [])).push(r);
    return by;
  }
  // every place a run of this mode can start or end: its nodes in this building, and equipment to start from
  function findSockets() {
    const R = RS(), key = mode.id + '|' + R.version + '|' + near.frame + '|' + Math.floor(performance.now() / 1500);
    if (key === socketsKey) return sockets;
    socketsKey = key; sockets = [];
    const by = runsAt(), spec = mode.spec;
    for (const n of Object.values(R.nodes)) {
      if (n.frame !== near.frame || !mode.starts.includes(n.kind) || n.stray) continue;
      const rs = by[n.id] || [];
      if (rs.length && !rs.some((r) => r.cls === mode.cls)) continue;
      if (spec && rs.some((r) => r.cls === mode.cls && r.spec !== spec)) continue;          // a cold stub is not a hot one
      if (n.kind === 'slot' && rs.length) continue;                                           // one circuit per breaker
      sockets.push({ node: n.id, kind: n.kind, at: n.at, world: toWorld(n.at), label: labelOf(n, rs) });
    }
    // equipment in or on this building
    const b = B(), used = new Set(Object.values(R.nodes).filter((n) => n.ref).map((n) => n.ref.piece + '|' + n.ref.port));
    for (const p of (b && b.pieces ? b.pieces() : [])) {
      if (p.kind !== 'fixture' || !p.ports || Math.hypot(p.a.x - near.s.x, p.a.z - near.s.z) > (near.s.r || 3) + 1.5) continue;
      if (mode.cls === 'cable' && p.category === 'breaker_panel') {
        const free = p.ports.filter((q) => q.id !== 'main' && !used.has(p.id + '|' + q.id));
        if (!free.length) continue;
        const w = new T.Vector3(p.a.x, p.y0 + (p.height || 0.5) * 0.5, p.a.z);
        sockets.push({ equip: p.id, port: free[0].id, kind: 'slot', world: w, at: toLocal(w), label: 'the ' + (p.name || 'panel').replace(/\s*\(.*\)/, '') + ', breaker ' + free[0].id.replace('b', '') });
      } else if (mode.equip && mode.equip.includes(p.category) && p.ports.some((q) => q.id === 'out') && !used.has(p.id + '|out')) {
        const f = p.yawRad || 0, d = (p.depth || 0.5) / 2;
        const w = new T.Vector3(p.a.x + Math.sin(f) * d, p.y0 + Math.min((p.height || 0.5) * 0.35, 0.4), p.a.z + Math.cos(f) * d);
        sockets.push({ equip: p.id, port: 'out', kind: 'port', world: w, at: toLocal(w), label: 'the ' + (p.name || 'tank').split(',')[0].toLowerCase() });
      }
    }
    return sockets;
  }
  function labelOf(n, rs) {
    const k = SV().nodeKinds[n.kind] || {}, dev = n.set && n.set.device;
    return 'the ' + (dev ? (SV().devices[dev] || {}).name || k.name : k.name || n.kind) + (rs.length ? '' : ' (nothing joined yet)');
  }

  /* ================= aiming ================= */
  const ray = { o: [0, 0, 0], d: [0, 0, -1] };
  function localRay(R) {
    const o = R.ray.origin, d = R.ray.direction;
    ray.o = toLocal(o);
    const q = new T.Vector3(d.x, d.y, d.z).transformDirection(near.Mi);
    ray.d = [q.x, q.y, q.z];
    // ignore what is between the camera and the player (the wall at your back)
    ray.tMin = Math.max(0, R.rayDist(P.x, P.y + 1, P.z).t - 0.7);
  }
  const atT = (t) => [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t];
  const planeT = (y) => (Math.abs(ray.d[1]) > 1e-5 ? (y - ray.o[1]) / ray.d[1] : -1);
  function pickSocket(R, list, except) {
    let best = null;
    for (const s of list) {
      if (except && ((s.node && s.node === except.node) || (s.equip && s.equip === except.equip))) continue;
      const { d, t } = R.rayDist(s.world.x, s.world.y, s.world.z);
      if (d < 0.1 + t * 0.012 && (!best || d < best.d)) best = { s, d };
    }
    return best;
  }
  // where a new box, stub or exit goes for the pointer, or a plain-words refusal
  function spotFor(R) {
    const ch = near.ch, pr = preset();
    let hit = G.routes && rayHitLocal(ch);
    if (pr.on === 'ceiling' || pr.on === 'floor') {
      const y = pr.on === 'ceiling' ? (ch.attic ? ch.attic.y - 0.05 : null) : ch.floor ? ch.floor.top : null;
      if (y == null) return { refused: pr.on === 'floor' ? 'A floor drain needs a framed floor.' : 'No ceiling line on this building yet.' };
      // straight up or down from where the pointer meets the floor, so you aim at the spot under a light
      let t = planeT(ch.floor ? ch.floor.top : 0);
      if (hit && hit.kind === 'wall' && (t < 0 || hit.t < t)) {
        const w = ch.walls.find((x) => x.id === hit.wall), side = w.out ? -w.out : hit.side;
        const q = [hit.point[0] + w.n[0] * side * 0.35, y, hit.point[2] + w.n[1] * side * 0.35];
        return snapLocal(ch, { kind: pr.on, point: q, y, t: hit.t }, pr);
      }
      if (t < 0) return null;
      const q = atT(t);
      return snapLocal(ch, { kind: pr.on, point: [q[0], y, q[2]], y, t }, pr);
    }
    if (!hit) return null;
    if (hit.kind !== 'wall') return { refused: mode.cls === 'cable' ? 'Boxes go on a stud. For a light, wheel to Ceiling light.' : 'Stubs come out of a wall: aim at a stud.' };
    return snapLocal(ch, hit, pr);
  }
  function rayHitLocal(ch) {
    // the nearest wall, floor or ceiling past the player's back
    const o = atT(ray.tMin);
    const h = window.__game.routes && frameRay(ch, o, ray.d);
    if (h) h.t += ray.tMin;
    return h;
  }
  function snapLocal(ch, hit, pr) {
    const sn = FC.snap(ch, hit, pr.on === 'exit' ? { exit: true } : { heightM: pr.h, box: mode.cls === 'cable' ? 0.035 : 0.03 });
    if (!sn || sn.refused) return sn;
    const w = toWorld(sn.at);
    if (Math.hypot(w.x - P.x, w.z - P.z) > PLAN_M) return { refused: 'Too far from you: walk closer to plan there.' };
    return { ...sn, kind: pr.kind, world: w, preset: pr };
  }
  // frame-channels' pure helpers, through __game.routes (global scripts cannot import)
  const FC = { snap: (ch, hit, o) => G.routes.snap(ch, hit, o), attach: (ch, p, o) => G.routes.attach(ch, p, o) };
  const frameRay = (ch, o, d) => G.routes.rayHit(ch, o, d, { maxT: 40 });

  /* ================= routing ================= */
  function specFor(tg) {
    if (mode.cls === 'cable') {
      const grp = groupOf(start);
      if (grp && grp.spec) return grp.spec;
      return (tg && tg.preset && tg.preset.spec) || (start && start.preset && start.preset.spec) || 'cable_nm_14_2';
    }
    if (mode.cls === 'supply') return mode.spec;
    let d = 0, best = 'dwv_40';
    const by = runsAt();
    for (const e of [start, tg]) {
      if (!e) continue;
      const cand = [e.preset && e.preset.spec, ...(e.node ? (by[e.node] || []).filter((r) => r.cls === 'drain').map((r) => r.spec) : [])];
      for (const s of cand) if (s && DIAM[s] > d) { d = DIAM[s]; best = s; }
    }
    return best;
  }
  function groupOf(e) {
    if (!e || !e.node) return null;
    const rs = (runsAt()[e.node] || []).filter((r) => r.cls === 'cable');
    if (rs.length) return { id: rs[0].group || rs[0].a, spec: rs[0].spec };
    return null;
  }
  // a free point for the router: the node's place joined to the channels (equipment a little off the frame is
  // brought onto the nearest wall or the floor first)
  function freeEnd(e, id) {
    const ch = near.ch;
    let a = FC.attach(ch, e.at);
    if (!a && ch.floor) { const q = [e.at[0], ch.floor.top, e.at[2]]; const b = FC.attach(ch, q); if (b) a = { ...b, links: b.links.map((L) => ({ ...L, via: [q, ...(L.via || [])] })) }; }
    if (!a) {
      for (const w of ch.walls) {
        const s = (e.at[0] - w.o[0]) * w.u[0] + (e.at[2] - w.o[1]) * w.u[1], off = (e.at[0] - w.o[0]) * w.n[0] + (e.at[2] - w.o[1]) * w.n[1];
        if (s < 0 || s > w.L || Math.abs(off) > 0.9) continue;
        const q = [w.o[0] + w.u[0] * s, e.at[1], w.o[1] + w.u[1] * s], b = FC.attach(ch, q);
        if (b) { a = { ...b, links: b.links.map((L) => ({ ...L, via: [q, ...(L.via || [])] })) }; break; }
      }
    }
    return a ? { id, p: e.at, links: a.links } : null;
  }
  function combine(A, Bb) {
    const off = A.path.length - 1;
    return { path: A.path.concat(Bb.path.slice(1)), verts: A.verts.concat(Bb.verts.slice(1)), lengthM: A.lengthM + Bb.lengthM,
      bores: A.bores.concat(Bb.bores.map((b) => ({ ...b, seg: b.seg + off }))), hosts: [...new Set(A.hosts.concat(Bb.hosts))],
      tags: Object.fromEntries([...new Set([...Object.keys(A.tags), ...Object.keys(Bb.tags)])].map((k) => [k, (A.tags[k] || 0) + (Bb.tags[k] || 0)])), why: A.why === 'wall' ? Bb.why : A.why, level: A.level ?? Bb.level };
  }
  function route() {
    const tg = target;
    if (!start || !tg || tg.refused) return null;
    const spec = specFor(tg), sv = SV();
    // a drain runs downhill: from the higher end to the lower
    let up = start, down = tg, flip = false;
    if (mode.cls === 'drain' && (tg.at[1] > start.at[1] + 1e-3 || start.kind === 'exit')) { up = tg; down = start; flip = true; }
    const fixedEnd = mode.cls === 'drain' && !!down.node && down.kind !== 'exit';     // an exit can drop to meet the pipe
    const A = freeEnd(up, 'from'), Z = freeEnd(down, 'to');
    if (!A || !Z) return { spec, refused: (!A ? 'The start' : 'That spot') + ' is not on the frame of this building.' };
    const rule = sv.routeRule(spec, { fixedEnd });
    let results;
    if (pin) {
      const half = { allowed: rule.allowed, cost: rule.cost };
      const r1 = G.routes.find(near.ch, A, pin.v, half, 1), r2 = G.routes.find(near.ch, pin.v, Z, half, 1);
      if (!Array.isArray(r1) || !Array.isArray(r2)) results = (Array.isArray(r1) ? r2 : r1);
      else { const f = rule.finish(combine(r1[0], r2[0])); results = f && !f.refused ? [f] : f || { refused: 'Not that way.' }; }
    } else results = G.routes.find(near.ch, A, Z, rule, 3);
    if (!Array.isArray(results)) return { spec, refused: results.refused };
    return { spec, results, alt: 0, flip };
  }
  const targetKey = (tg) => (tg ? (tg.node || tg.equip || '') + '|' + (tg.at ? tg.at.join(',') : '') + '|' + (tg.refused || '') : '') + '|' + (pin ? pin.v : '') + '|' + (start ? (start.node || start.equip || start.at.join(',')) : '');
  let lastKey = '';
  function setTarget(tg) {
    target = tg;
    const k = targetKey(tg) + '|' + (mode ? mode.id + preset().id : '') + '|' + RS().version;
    if (k === lastKey) return;
    lastKey = k;
    cur = route();
    reveal = 0;
    drawRoute(cur);
  }

  /* ================= drawing the preview ================= */
  let dashPts = null;                                       // world points of the current path
  function drawRoute(c) {
    dashPts = null; holes.count = 0;
    const res = c && c.results ? c.results[c.alt] : null;
    if (!res || !near) { dashes.count = 0; return; }
    dashPts = res.path.map((p) => toWorld(p));
    let i = 0;
    for (const b of res.bores) {
      if (i >= NH) break;
      const w = toWorld(b.at), s = b.plate ? 0.055 : 0.04;
      M4.compose(w, Q.identity(), S3.set(s, s, s)); holes.setMatrixAt(i, M4);
      holes.setColorAt(i, C3.set(b.plate ? 0xd8dde2 : 0xffd23a)); i++;
    }
    holes.count = i; holes.instanceMatrix.needsUpdate = true; if (holes.instanceColor) holes.instanceColor.needsUpdate = true;
  }
  // dashes along the path, revealed from the start and marching slowly toward the far end
  function drawDashes(dt) {
    if (!dashPts) { dashes.count = 0; return; }
    reveal = Math.min(1, reveal + dt * 3.5); tAnim += dt;
    const DL = 0.12, GAP = 0.08, step = DL + GAP, r = mode && mode.cls === 'drain' ? 0.022 : 0.012;
    let total = 0; const seg = [];
    for (let i = 1; i < dashPts.length; i++) { const L = dashPts[i].distanceTo(dashPts[i - 1]); seg.push(L); total += L; }
    const upTo = total * reveal, shift = (tAnim * 0.25) % step;
    let n = 0, acc = 0;
    for (let i = 0; i < seg.length && n < ND; i++) {
      const a = dashPts[i], b = dashPts[i + 1], L = seg[i];
      if (L < 1e-4) continue;
      V3b.subVectors(b, a).normalize(); Q.setFromUnitVectors(X, V3b);
      for (let s = ((shift - acc) % step + step) % step - step; s < L && n < ND; s += step) {
        const s0 = Math.max(0, s), s1 = Math.min(L, s + DL);
        if (s1 <= s0 || acc + s0 > upTo) continue;
        V3.copy(a).addScaledVector(V3b, (s0 + Math.min(s1, upTo - acc)) / 2);
        M4.compose(V3, Q, S3.set(Math.max(0.005, Math.min(s1, upTo - acc) - s0), r * 2, r * 2)); dashes.setMatrixAt(n++, M4);
      }
      acc += L;
    }
    dashes.count = n; dashes.instanceMatrix.needsUpdate = true;
  }
  function drawGlows(list, t) {
    let n = 0;
    const pulse = 1 + Math.sin(t * 4) * 0.18;
    for (const s of list) {
      if (n >= NG) break;
      if (start && ((s.node && s.node === start.node) || (s.equip && s.equip === start.equip))) continue;
      const k = (start ? 0.75 : 1.25) * pulse;
      M4.compose(s.world, Q.identity(), S3.set(k, k, k)); glows.setMatrixAt(n++, M4);
    }
    glows.count = n; glows.instanceMatrix.needsUpdate = true;
  }
  function placeGhost(tg, t) {
    if (!tg || tg.refused || !tg.world || tg.node || tg.equip) { ghost.visible = false; return; }
    const w = tg.wall && near.ch.walls.find((x) => x.id === tg.wall), f = RS().frames[near.frame] || { yaw: 0 };
    const big = tg.kind === 'exit' ? [0.09, 0.09, 0.14] : mode.cls === 'cable' ? [0.06, 0.09, 0.06] : mode.cls === 'drain' ? [0.07, 0.07, 0.12] : [0.035, 0.035, 0.1];
    ghost.position.copy(tg.world); ghost.scale.set(big[0], big[1], big[2]);
    ghost.rotation.set(0, (f.yaw || 0) + (w ? Math.atan2(-w.u[1], w.u[0]) : 0), 0);
    const bad = cur && cur.refused;
    ghostMat.color.set(bad ? 0xe0765f : hex(mode.colour)); ghostMat.opacity = 0.55 + Math.sin(t * 5) * 0.15;
    ghost.visible = true;
  }

  /* ================= words ================= */
  const WHY = { wall: 'through the studs', over: 'up and over the top plates', under: 'down under the floor' };
  function routeHint() {
    if (!cur) return null;
    if (cur.refused) return '<span style="color:var(--danger,#e0765f)">' + esc(cur.refused) + '</span>';
    const res = cur.results[cur.alt], sp = SV().specs[cur.spec] || {}, n = res.bores.length, plates = res.bores.filter((b) => b.plate).length;
    let why = WHY[res.why] || '';
    if (res.why === 'wall' && res.level != null) why += res.level < 0.7 ? ', low' : res.level > 1.6 ? ', high' : '';
    let t = '<b>' + esc(sp.name || cur.spec) + '</b>, ' + res.lengthM.toFixed(1) + ' m, ' + (n ? n + (n === 1 ? ' hole' : ' holes') : 'no holes') + (plates ? ' (' + plates + ' nail plate' + (plates > 1 ? 's' : '') + ')' : '');
    if (res.fall) t += ', falls ' + Math.round(res.fall.dropM * 100) + ' cm';
    t += ', ' + why + '.\n<b>Click</b> to plan it' + (cur.results.length > 1 ? ',  <b>R</b> another way (' + (cur.alt + 1) + ' of ' + cur.results.length + ')' : '') + (pin ? ',  right-click unpins' : ',  drag the dashes to bend it');
    return t;
  }
  function presetWords() { const pr = preset(); return pr.name + (pr.h != null ? ' (' + pr.h.toFixed(2) + ' m)' : ''); }

  /* ================= confirming ================= */
  function makeNode(e, res, isEnd) {
    if (e.node) return e.node;
    const at = e.kind === 'exit' && res ? res.path[isEnd ? res.path.length - 1 : 0] : e.at;
    const p = { kind: e.kind, frame: near.frame, at, host: e.host || (e.wall ? { parent: e.wall } : undefined) };
    if (e.equip) p.ref = { piece: e.equip, port: e.port };
    if (e.kind === 'stub_supply' || e.kind === 'stub_drain') p.set = { capped: true };
    const r = cmd('routes.addNode', p);
    return r.ok ? r.id : null;
  }
  function confirm(R) {
    if (!cur || cur.refused || !cur.results) { R.say(cur && cur.refused ? cur.refused : target && target.refused ? target.refused : 'Aim at the frame where it should go.', 2.5); return; }
    syncFrames(true);
    const res = cur.results[cur.alt];
    // the route runs from the higher end for a drain; the run itself goes from where you started
    const path = cur.flip ? res.path.slice().reverse() : res.path;
    const ordered = { ...res, path };
    const a = makeNode(start, ordered, false), b = makeNode(target, ordered, true);
    if (!a || !b) { R.say('That did not plan: ' + (a ? 'the end' : 'the start') + ' would not go in.', 2.5); return; }
    const grp = mode.cls === 'cable' ? (groupOf({ node: a }) || {}).id || (start.kind === 'slot' ? a : 'g:' + a) : undefined;
    const r = cmd('routes.addRun', { cls: mode.cls, spec: cur.spec, frame: near.frame, a, b, path, hosts: res.hosts, group: grp,
      bores: res.bores.map((x) => ({ at: x.at, parent: x.parent, plate: x.plate ? 1 : 0 })) });
    if (!r.ok) { R.say('That did not plan: ' + r.reason, 2.5); return; }
    // an exit already there drops to where this pipe arrives, while nothing on it has been worked
    for (const [e, id, q] of [[start, a, path[0]], [target, b, path[path.length - 1]]]) {
      const n = RS().nodes[id];
      if (e.node && n && n.kind === 'exit' && q[1] < n.at[1] - 0.003) cmd('routes.moveNode', { id, at: [n.at[0], q[1], n.at[2]] });
    }
    const sp = SV().specs[cur.spec] || {}, end = toWorld(path[path.length - 1]);
    G.burst(end.x, end.y, end.z, 9, hex(mode.colour), 0.6, 0.9, 0.03, 0.45);
    R.pose(-1.6, -0.4, 0.05, 0.3); flash = 1;
    const first = cmd('services.note', { key: 'plan:first' });
    R.say((first.first ? 'Planned! ' : 'Planned: ') + (sp.name || cur.spec) + ', ' + res.lengthM.toFixed(1) + ' m.  Click the next ' + mode.noun + ' to carry on from here, right-click to stop.', 3.5);
    // carry on from the new end
    const bn = RS().nodes[b];
    start = { node: b, kind: bn.kind, at: bn.at, world: toWorld(bn.at), preset: target.preset };
    target = cur = pin = null; locked = false; lastKey = ''; socketsKey = '';
    drawRoute(null);
  }

  /* ================= the reach user ================= */
  let frozen = null;                                       // the hit while a drag or a locked route holds the target
  RCH.use({
    id: 'services-plan',
    near(px, pz) { return !!nearest(px, pz); },
    hover(R) {
      if (R.held || !mode) return null;
      if (!near) refreshNear();
      if (!near) return null;
      localRay(R);
      const list = findSockets();
      if (!start) {
        const s = pickSocket(R, list);
        if (s) { ghost.visible = false; return { sv: 'socket', socket: s.s, score: s.d, x: s.s.world.x, y: s.s.world.y, z: s.s.world.z, hint: 'Start at <b>' + esc(s.s.label) + '</b>.  <b>Click</b>' }; }
        const sp = spotFor(R);
        if (!sp) { ghost.visible = false; return null; }
        if (sp.refused) { ghost.visible = false; return { sv: 'none', score: 0.6, hint: '<span style="color:var(--danger,#e0765f)">' + esc(sp.refused) + '</span>' }; }
        target = sp; placeGhost(sp, tAnim);
        return { sv: 'spot', spot: sp, score: 0.5, x: sp.world.x, y: sp.world.y, z: sp.world.z,
          hint: '<b>Click</b> to start a new ' + esc(presetWords().toLowerCase()) + ' here, or at a glowing ' + (mode.cls === 'cable' ? 'panel or box' : mode.cls === 'drain' ? 'drain' : 'stub') + '.  <b>Wheel</b>: ' + mode.presets.map((p) => p.name.toLowerCase()).join(', ') };
      }
      if (locked && frozen) return frozen;
      const s = pickSocket(R, list, start);
      let tg;
      if (s) tg = { node: s.s.node, equip: s.s.equip, port: s.s.port, kind: s.s.kind, at: s.s.at, world: s.s.world, preset: null };
      else tg = spotFor(R);
      if (!tg) { ghost.visible = false; return { sv: 'none', score: 0.6, hint: 'Aim at a stud where the ' + mode.noun + ' should go.  <b>Wheel</b>: ' + esc(presetWords()) + '.  Right-click: start again' }; }
      setTarget(tg);
      placeGhost(tg, tAnim);
      const h = routeHint() || (tg.refused ? '<span style="color:var(--danger,#e0765f)">' + esc(tg.refused) + '</span>' : '');
      const label = tg.node || tg.equip ? 'To <b>' + esc(s.s.label) + '</b>: ' : tg.preset ? esc(tg.preset.name) + ': ' : '';
      return { sv: 'end', score: s ? s.d : 0.5, x: tg.world ? tg.world.x : undefined, y: tg.world ? tg.world.y : undefined, z: tg.world ? tg.world.z : undefined, hint: label + h };
    },
    press(hit, R) {
      drag = { x: R.ptr.x, y: R.ptr.y, moved: false, onPath: !!(cur && cur.results && nearPath(R)) };
      if (hit.sv === 'end') frozen = hit;
    },
    move(hit, R) {
      if (!drag || !drag.onPath || !near) return;
      if (!drag.moved && Math.hypot(R.ptr.x - drag.x, R.ptr.y - drag.y) < 7) return;
      drag.moved = true; locked = true;
      localRay(R);
      const h = rayHitLocal(near.ch);
      if (!h) return;
      let best = null, bd = 0.9;
      for (const v of near.ch.verts) { const d = Math.hypot(v.p[0] - h.point[0], v.p[1] - h.point[1], v.p[2] - h.point[2]); if (d < bd) { bd = d; best = v; } }
      if (best && (!pin || pin.v !== best.id)) {
        pin = { v: best.id, p: best.p };
        pinMark.position.copy(toWorld(best.p)); pinMark.visible = true;
        setTarget(target);
        frozen = { ...frozen, hint: routeHint() };
      }
    },
    release(hit, R, cancelled) {
      const d = drag; drag = null;
      if (cancelled || !d) return;
      if (d.moved) { R.say('Pinned. The route passes there now.', 1.6); return; }
      if (hit.sv === 'socket') { const s = hit.socket; start = { node: s.node, equip: s.equip, port: s.port, kind: s.kind, at: s.at, world: s.world, preset: null }; lastKey = ''; R.say('From ' + s.label + '. Now aim where it goes.', 2); return; }
      if (hit.sv === 'spot') { const sp = hit.spot; start = { ...sp }; lastKey = ''; R.say('Starting from a new ' + sp.preset.name.toLowerCase() + '. Now aim where it goes.', 2); return; }
      if (hit.sv === 'end') confirm(R);
    },
    pressNothing() { return false; },
    secondary(R) {
      if (!mode) return false;
      if (pin || locked) { pin = null; locked = false; pinMark.visible = false; frozen = null; lastKey = ''; R.say('Unpinned.', 1.2); return true; }
      if (start) { start = null; target = cur = null; drawRoute(null); lastKey = ''; R.say('Pick a start again.', 1.4); return true; }
      setMode(null); return true;
    },
    key(code, R) {
      if (R.held) return false;
      const m = MODES.find((x) => x.key === code);
      if (m && !strip.hidden) { setMode(mode && mode.id === m.id ? null : m.id); if (mode) R.say(mode.name + ': ' + (mode.cls === 'cable' ? 'start at the panel or a box' : mode.cls === 'drain' ? 'start at a fixture drain or where it leaves' : 'start at the tank, heater or a stub') + '.', 2); return true; }
      if (!mode) return false;
      if (code === 'KeyR' && cur && cur.results) {
        if (cur.results.length < 2) { R.say(pin ? 'Pinned: one way only. Right-click to unpin.' : 'That is the only way through here.', 1.6); return true; }
        cur.alt = (cur.alt + 1) % cur.results.length; reveal = 0; drawRoute(cur);
        if (frozen) frozen = { ...frozen, hint: routeHint() };
        return true;
      }
      return false;
    },
    wheel(dy, R) {
      if (!mode || R.held || locked) return false;
      presetI[mode.id] = ((presetI[mode.id] || 0) + (dy > 0 ? 1 : mode.presets.length - 1)) % mode.presets.length;
      lastKey = '';
      R.say(presetWords(), 1.2);
      return true;
    },
    hint(R) {
      if (R.held || !near) return null;
      if (!mode) return 'Near the frame: plan cable and pipe with <b>1</b> Power, <b>2</b> Cold, <b>3</b> Hot, <b>4</b> Waste';
      return null;
    },
    frame(dt, R) {
      frameT += dt;
      if (frameT > (R.on ? 0.5 : 2)) { frameT = 0; syncFrames(false); if (R.on) refreshNear(); }
      const show = R.on && !!near && !R.held;
      if (strip.hidden === show) strip.hidden = !show;
      root.visible = show && !!mode;
      if (!root.visible) { if (R.on && !near && mode) setMode(null); return; }
      tAnim += dt;
      drawGlows(findSockets(), tAnim);
      if (start) { startMark.visible = true; startMark.position.copy(start.world || toWorld(start.at)); startMark.material.color.set(hex(mode.colour)); startMark.lookAt(G.camera.position); const k = 1 + Math.sin(tAnim * 6) * 0.08; startMark.scale.set(k, k, k); }
      else startMark.visible = false;
      if (!pin) pinMark.visible = false;
      dashMat.color.set(cur && cur.refused ? 0xe0765f : hex(mode.colour));
      if (flash > 0) flash = Math.max(0, flash - dt * 3);
      glowMat.color.set(hex(mode.colour)).lerp(new T.Color(0xffffff), 0.25 + flash * 0.5);
      if (!start) { dashPts = null; dashes.count = 0; holes.count = 0; } else drawDashes(dt);
    },
    leave() { strip.hidden = true; root.visible = false; start = target = cur = pin = null; locked = false; drag = null; frozen = null; drawRoute(null); lastKey = ''; },
  });
  function nearPath(R) {
    if (!dashPts) return false;
    for (let i = 1; i < dashPts.length; i++) {
      const a = dashPts[i - 1], b = dashPts[i];
      for (let k = 0; k <= 8; k++) { V3.lerpVectors(a, b, k / 8); if (R.rayDist(V3.x, V3.y, V3.z).d < 0.09) return true; }
    }
    return false;
  }

  window.__servicesPlan = {
    setMode, get mode() { return mode && mode.id; }, syncFrames: () => syncFrames(true),
    state: () => ({ mode: mode && mode.id, preset: mode && preset().id, start, target, refused: cur && cur.refused, results: cur && cur.results ? cur.results.length : 0, alt: cur ? cur.alt : 0, pin, near: near && near.frame }),
    // console: plan a run between two frame-local points of the nearest building, as two clicks would
    plan(modeId, a, b, presetId) {
      refreshNear(); if (!near) return { ok: false, reason: 'No framed building nearby.' };
      setMode(modeId); if (!mode) return { ok: false, reason: 'no such mode' };
      if (presetId) presetI[mode.id] = Math.max(0, mode.presets.findIndex((p) => p.id === presetId));
      const pr = preset(), e = (p) => ({ kind: pr.kind, at: p, world: toWorld(p), preset: pr });
      start = e(a); setTarget(e(b));
      if (!cur || cur.refused) return { ok: false, reason: cur ? cur.refused : 'no route' };
      const before = Object.keys(RS().runs).length;
      confirm(Rr);
      return { ok: Object.keys(RS().runs).length > before };
    },
  };
})();
