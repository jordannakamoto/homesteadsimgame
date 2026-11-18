/* Services view: cable and pipe in buildings, drawn through the generic runs view (__routes) with the looks
   of src/sim/content/services.js, and the Power and Water overlays (__overlays, key X). Content: it knows what a
   cable is; the generic files do not. Owns no truth: everything it shows is read from the routes and services
   systems, and the only commands it issues are the console sample below.
   Console: __servicesView.sample() drops a sample circuit into the framed building nearest the player (a roughed-in
   cable from a wall box to a switch box, through the studs, and a planned PEX run with its holes still to drill);
   __servicesView.clearSample() takes it out again. Planning by hand is a later slice.
   Cost: the view rebuilds only when the routes change; an overlay recolours the runs four times a second while on. */
(() => {
  const G = window.__game, RT = window.__routes, OV = window.__overlays;
  if (!G || !RT || !G.sim || !G.sim.handlers.has('routes.addRun') || !G.sim.handlers.has('services.sync')) return;
  const T = G.THREE;
  const svApi = () => G.sim.systems.find((s) => s.name === 'services').api;
  const cmd = (n, p) => { try { return G.sim.commandNow(n, p) || { ok: true }; } catch (e) { console.warn('services: ' + n + ' failed: ' + e.message); return { ok: false, reason: e.message }; } };
  const NODE_LOOK = { slot: [0x40464c, 0.05], box: [0x2d6fb8, 0.09], box_ceiling: [0x2d6fb8, 0.1], stub_supply: [0xd8d8d0, 0.045], stub_drain: [0xece8e0, 0.07],
    cleanout: [0xece8e0, 0.07], vent_term: [0x8a8a80, 0.07], exit: [0xb07a40, 0.08], port: [0x70767c, 0.04] };

  const view = RT.attach({
    system: 'routes',
    looks: {
      run(run) {
        const A = svApi(), sp = A.specs[run.spec] || {}, cls = A.classes[run.cls] || {};
        return { colour: parseInt(String(sp.colour || cls.colour || '#cccccc').slice(1), 16), radiusM: sp.radiusM || 0.008 };
      },
      node(n) { const l = NODE_LOOK[n.kind]; return l ? { colour: l[0], sizeM: l[1] } : { colour: 0x9a9a9a, sizeM: 0.06 }; },
      bore: { todo: 0xffd23a, done: 0x2a2018 },
    },
  });
  if (!view) return;

  /* ================= overlays: Power and Water ================= */
  let timer = 0, mode = null;
  const C = (h) => new T.Color(h);
  const loadColour = (k) => C(0x3fbf5a).lerp(C(0xe0402a), Math.max(0, Math.min(1, k))).getHex();
  function paint() {
    const by = {};
    for (const r of svApi().overlayData(G.sim.state).runs) by[r.id] = r;
    view.tint((run) => {
      const o = by[run.id]; if (!o) return null;
      if (mode === 'power') {
        if (run.cls !== 'cable') return 0x33373b;
        return o.live ? loadColour(o.load) : 0x6a6a6a;                   // dead runs grey
      }
      if (run.cls === 'cable') return 0x33373b;
      if (o.leakLmin > 0) return 0xff6a2a;
      if (!o.live) return run.cls === 'drain' ? 0x5a4636 : 0x46556a;
      return null;                                                        // live: its own blue, red or brown
    });
  }
  function on(id) {
    mode = id; view.xray(true); paint();
    clearInterval(timer); timer = setInterval(paint, 250);
  }
  function off() { mode = null; clearInterval(timer); timer = 0; view.tint(null); view.xray(false); }
  if (OV) {
    OV.register({ id: 'power', name: 'Power', on: () => on('power'), off, legend: 'green carries, red is near its limit, grey is dead' });
    OV.register({ id: 'water', name: 'Water', on: () => on('water'), off, legend: 'blue cold, red hot, brown waste, orange leaking' });
  }

  /* ================= the console sample ================= */
  const SAMPLE = 'sample';
  function nearestFramed() {
    const B = window.__build; if (!B || !B.structs) return null;
    const P = G.player;
    let best = null;
    for (const s of B.structs()) {
      const m = B.membersOf(s.id); if (!m) continue;
      const studs = m.list.filter((x) => x.kind === 'stud' && x.type === 'stud');
      if (studs.length < 4) continue;
      const d = Math.hypot(s.x - P.x, s.z - P.z);
      if (!best || d < best.d) best = { d, s, m, studs };
    }
    return best;
  }
  function sample() {
    const f = nearestFramed();
    if (!f) return { ok: false, reason: 'No framed building with studs nearby: frame some walls first.' };
    // the frame: the building's own matrix (position and turn)
    const pos = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
    f.m.matrix.decompose(pos, q, sc);
    const yaw = new T.Euler().setFromQuaternion(q, 'YXZ').y, frame = String(f.s.id);
    const R = G.sim.state.sys.routes;
    cmd('routes.setFrames', { frames: { ...R.frames, [frame]: { x: pos.x, y: pos.y, z: pos.z, yaw } } });
    // four studs in a row along one wall
    const wall = f.studs[0].parent, studs = f.studs.filter((x) => x.parent === wall);
    if (studs.length < 4) return { ok: false, reason: 'The first wall has too few studs.' };
    const a0 = studs[0].a, dir = [studs[1].a[0] - a0[0], 0, studs[1].a[2] - a0[2]], L = Math.hypot(dir[0], dir[2]) || 1;
    const u = [dir[0] / L, 0, dir[2] / L], base = Math.min(studs[0].a[1], studs[0].b[1]);
    const at = (st, h, off = 0) => [st.a[0] + u[0] * off, base + h, st.a[2] + u[2] * off];
    const s0 = studs[0], s3 = studs[3];
    const boxA = cmd('routes.addNode', { id: SAMPLE + ':box', kind: 'box', frame, at: at(s0, 0.4, 0.08), state: 'set', host: { parent: wall } }).id;
    const boxB = cmd('routes.addNode', { id: SAMPLE + ':sw', kind: 'box', frame, at: at(s3, 1.2, -0.08), state: 'set', host: { parent: wall } }).id;
    const path = [at(s0, 0.4, 0.08), at(s0, 0.6, 0.08), at(s3, 0.6, -0.08), at(s3, 1.2, -0.08)];
    const bores = [1, 2].map((i) => ({ at: at(studs[i], 0.6), parent: studs[i].id }));
    const cable = cmd('routes.addRun', { id: SAMPLE + ':cable', cls: 'cable', spec: 'cable_nm_14_2', frame, a: boxA, b: boxB, path, bores, hosts: [wall] }).id;
    cmd('routes.work', { id: cable, what: 'bore', n: 9 }); cmd('routes.work', { id: cable, what: 'pull', to: 1 }); cmd('routes.work', { id: cable, what: 'join', n: 2 });
    // a planned cold-water run lower down: pale, holes still to drill
    const stA = cmd('routes.addNode', { id: SAMPLE + ':st1', kind: 'stub_supply', frame, at: at(s0, 0.3, 0.12), set: { capped: true } }).id;
    const stB = cmd('routes.addNode', { id: SAMPLE + ':st2', kind: 'stub_supply', frame, at: at(s3, 0.5, -0.12), set: { capped: true } }).id;
    cmd('routes.addRun', { id: SAMPLE + ':pex', cls: 'supply', spec: 'pex_12_blue', frame, a: stA, b: stB, path: [at(s0, 0.3, 0.12), at(s3, 0.3, -0.12), at(s3, 0.5, -0.12)],
      bores: [1, 2].map((i) => ({ at: at(studs[i], 0.3), parent: studs[i].id })), hosts: [wall] });
    view.refresh();
    return { ok: true, frame, wall, runs: [cable, SAMPLE + ':pex'] };
  }
  function clearSample() {
    const R = G.sim.state.sys.routes;
    for (const id of Object.keys(R.runs)) if (id.startsWith(SAMPLE + ':')) cmd('routes.removeRun', { id });
    for (const id of Object.keys(R.nodes)) if (id.startsWith(SAMPLE + ':')) cmd('routes.removeNode', { id });
    return { ok: true };
  }

  window.__servicesView = { view, sample, clearSample, info: (runId) => svApi().runInfo(G.sim.state, runId), pick: (R) => view.pick(R) };
})();
