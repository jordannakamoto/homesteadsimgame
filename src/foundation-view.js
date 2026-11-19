/* Foundation view (slices B2-B4 of the ground-foundations design): a poured foundation built by hand.
   - A building with a slab, stem wall or poured piers that is put up in construction mode becomes a foundation job
     (foundation.setPlan with its corners and dig regions, read from build mode's members): its site and foundation
     stages are this view's, not the construction view's, and build mode no longer levels its ground by magic.
   - The layout kit (key 7, "Site"): press a glowing corner and a stake goes in with two hammer blows; keep holding
     and pull toward the next corner: you walk after your hand and the string pays out behind you; every corner your
     hand passes gets its stake. With the last one the loop closes: batter boards pop in at the corners, the strings
     go up on them at finished height, and the diagonals flash to show it is square.
   - Digging to the line: the ground inside the painted line that is still above the dig level is tinted amber
     (darker the more there is to go; blue where it is dug too deep). The shovel is the Yard's own (press to dig,
     drag the scoop where it goes). A tape hangs from the string at the blade to read how far there is to go. Once
     most of the amber is gone, right-drag the flat of the shovel across the rest: it trims to the line and pushes
     the earth out past the edge. When it is all down the site stage is done.
   - The base (B3, slabs): gravel (the truck tips heaps where you drag), the barrow, the rake (drag: the gravel is
     pulled to the line under the strings) and the tamper (twice everywhere). The overlay shows amber where it wants
     more gravel, blue where it stands proud, faint dots where it is not yet tamped twice. All through the Yard's own
     commands (landscape.deliver via foundation.gravel, load, tip, push, rake, tamp).
   - Forms (B3): hold a board near a string and the ghost snaps along the run; a click sets `gesture` boards. Stakes
     glow outside the boards: the hammer drives one (two blows) and the next ones along, `gesture` in all. Unstaked
     boards wobble; under concrete they bow and leak until staked.
   - The pour (B4): the barrow mixes: drag up slashes bags in, the right button runs the hose, side to side hoes it,
     drag down at the forms tips it (a meter shows the water/cement ratio against too dry .. soupy). The rake spreads
     it. The screed board lies across the forms: drag it toward you and the surplus rolls ahead as a ridge, leaving a
     flat, wet-bright top; dull patches are hollows. The wet field is one mesh (window.__fieldmesh.create).
   - Finishing (B5): screeded, the wet field stays and the Site bar offers the finishing kit: Float (the bull float, drag over
     the screeded top: it goes from wet-bright to an even satin), Trowel / Broom (drag; only once the bleed-water sheen is
     gone, a bar and the hint say when: before that it scales the skin, after final set it tears), Edger (drag along a form),
     Joints (the groover dragged along the dashed lines on a slab over 3 m) and Bolts (press a glowing mark along the sill line:
     pushed in while wet; framing stays held without them). A small chip shows strength against the walk / strip / frame
     gates. Then cure: Blanket and Plastic (press to roll one over, again to take it off), Mist (the hose) and Strip (press a
     side: its boards and stakes come off to stock once the concrete is a fifth strength). The slab is tinted dark when wet
     and lightens with strength: a thin overlay from here (build mode's slab member is untouched).
   Owns no truth: the job, its layout and its dig are the foundation system's (src/sim/foundation.js); the ground is
   the ground system's. Registers window.__foundation = { owns, hint, job, redraw, tools, debugPour }.
   Cost: a sync of jobs twice a second (cheap reads); the overlay is recoloured only when the ground changes and the
   site is near; the strings draw only while they move. */
(() => {
  const G = window.__game, B = window.__build, H = window.__hands, PO = window.__payout, FM = window.__fieldmesh;
  if (!G || !B || !H || !PO || !FM || !G.sim || !G.foundation || !G.ground || !B.membersOf || !G.sim.handlers.has('foundation.stake')) return;
  const T = G.THREE, FR = G.foundation;
  const POURED = ['slab', 'piers', 'stemwall'];
  const DIG = { tolUpM: 0.02, tolDownM: 0.04, roughM: 0.07 };         // as content/concrete.js DIG (the sim decides; this only tints)
  const OUT = 0.9;                                                     // batter boards stand this far beyond the corners
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
  const cmd = (n, p) => { try { return G.sim.commandNow('foundation.' + n, p || {}) || { ok: false }; } catch (e) { console.warn('foundation.' + n + ': ' + e.message); return { ok: false, reason: e.message }; } };
  const CS = () => G.sim.state.sys.construction;
  const FS = () => G.sim.state.sys.foundation || { jobs: {} };
  const LS = () => window.__landscape;
  const surf = (x, z) => G.ground.surfaceAt(x, z);
  const jobFor = (id) => FR.jobFor(G.sim.state, id);
  const ownsTool = (id) => { const st = G.sim.state.sys.stock; return !st || !st.tools || st.tools.includes(id); };
  const $ = (id) => document.getElementById(id);

  /* ================= jobs from build mode's buildings ================= */
  const sent = new Map();          // structId -> struct version last sent
  const _v = new T.Vector3();
  // corners and dig regions of a building, in world metres, from its foundation members
  function geometry(st) {
    const mw = B.membersOf(st.id);
    if (!mw) return null;
    const M = mw.matrix, W = (x, y, z) => (_v.set(x, y, z).applyMatrix4(M), [_v.x, _v.y, _v.z]), XZ = (x, z) => { const w = W(x, 0, z); return [+w[0].toFixed(4), +w[2].toFixed(4)]; };
    const fl = mw.list.filter((m) => m.stage === 'foundation');
    const by = (kind, type) => fl.filter((m) => m.kind === kind && (!type || m.type === type));
    const bottom = (m) => W(m.a[0], Math.min(m.a[1], m.b[1]) - (m.section.b || 0) / 2, m.a[2])[1];
    const rect = (a, b, w, ext) => {        // a footprint around the line a-b (local), w wide, ext past both ends
      const L = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1, ux = (b[0] - a[0]) / L, uz = (b[2] - a[2]) / L, nx = -uz * w / 2, nz = ux * w / 2;
      const ax = a[0] - ux * ext, az = a[2] - uz * ext, bx = b[0] + ux * ext, bz = b[2] + uz * ext;
      return [XZ(ax + nx, az + nz), XZ(bx + nx, bz + nz), XZ(bx - nx, bz - nz), XZ(ax - nx, az - nz)];
    };
    let local = [], digs = [], topY = -Infinity;
    for (const m of fl) if (m.material === 'concrete' || m.col === 'concrete') topY = Math.max(topY, W(m.a[0], Math.max(m.a[1], m.b[1]) + (m.kind === 'pier' ? 0 : (m.section.b || 0) / 2), m.a[2])[1]);
    if (st.found === 'slab') {
      local = by('footing', 'edge').map((m) => [m.a[0], m.a[2]]);
      const slab = by('slab')[0], bed = by('footing', 'gravel-bed')[0];
      if (local.length >= 3 && slab) digs.push({ poly: local.map(([x, z]) => XZ(x, z)), targetY: Math.min(bottom(slab), bed ? bottom(bed) : Infinity), baseY: +bottom(slab).toFixed(4) });
    } else if (st.found === 'stemwall') {
      const strips = by('footing', 'strip');
      local = strips.map((m) => [m.a[0], m.a[2]]);
      for (const m of strips) digs.push({ poly: rect(m.a, m.b, m.section.d + 0.2, (m.section.d + 0.2) / 2), targetY: bottom(m) });
      for (const m of by('pier')) { const lo = m.a[1] < m.b[1] ? m.a : m.b; digs.push({ poly: rect([lo[0] - 0.2, 0, lo[2]], [lo[0] + 0.2, 0, lo[2]], 0.4, 0), targetY: W(lo[0], lo[1], lo[2])[1] }); }
    } else if (st.found === 'piers') {
      const pads = by('footing', 'pad');
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const m of pads) { x0 = Math.min(x0, m.a[0]); x1 = Math.max(x1, m.a[0]); z0 = Math.min(z0, m.a[2]); z1 = Math.max(z1, m.a[2]); }
      if (pads.length) local = [[x0 - 0.3, z0 - 0.3], [x1 + 0.3, z0 - 0.3], [x1 + 0.3, z1 + 0.3], [x0 - 0.3, z1 + 0.3]];
      for (const m of pads) digs.push({ poly: rect([m.a[0] - 0.3, 0, m.a[2]], [m.a[0] + 0.3, 0, m.a[2]], 0.6, 0), targetY: bottom(m) });
    }
    // corners only: points on a straight run between two others are not corners
    local = local.filter((q, k) => { const a = local[(k + local.length - 1) % local.length], b = local[(k + 1) % local.length]; return Math.abs((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])) > 1e-4; });
    if (local.length < 3 || !digs.length || !Number.isFinite(topY)) return null;
    const c = W(0, 0, 0);
    return { corners: local.map(([x, z]) => XZ(x, z)), digs, topY: +topY.toFixed(4), x: c[0], z: c[2], yaw: st.yaw || 0 };
  }
  function send(st) {
    const g = geometry(st);
    if (!g) return false;
    const r = cmd('setPlan', { structId: st.id, type: st.found, ...g });
    if (r.ok) { sent.set(st.id, st.ver); site.sig = ''; }
    return r.ok;
  }
  // build mode draws as built what the simulation says is built (the site once it is dug, a sandbox pour)
  function showBuilt(st, pr) {
    const mw = B.membersOf(st.id);
    if (!mw) return;
    const on = Object.keys(pr.members).filter((id) => { const m = pr.members[id]; return m.built && (m.stage === 'site' || m.stage === 'foundation') && mw.planned.has(id); });
    if (on.length) B.setBuilt(on, true);
  }
  function syncJobs() {
    const cs = CS();
    if (!cs || !cs.progress) return;
    const have = new Set();
    for (const st of B.structs()) {
      have.add(st.id);
      const pr = cs.progress[st.id], job = jobFor(st.id), poured = POURED.includes(st.found) && !st.level;
      if (job) {
        if (!pr || !poured) { cmd('forget', { structId: st.id }); sent.delete(st.id); continue; }
        // a plan sent again by the construction view starts without the cure's holds: put them back now
        if (sent.get(st.id) !== st.ver || (job.held && !(pr.hold && Object.keys(pr.hold).length))) { send(st); showBuilt(st, pr); }
        continue;
      }
      if (!pr || pr.done || !poured || (cs.options && cs.options.sandbox)) continue;
      // a building whose ground was already dug the old way (an older save) carries on the old way
      const ms = Object.values(pr.members), siteM = ms.filter((m) => m.kind === 'site');
      if (siteM.length ? siteM.every((m) => m.built) : ms.some((m) => m.stage === 'foundation' && m.built)) continue;
      send(st);
    }
    for (const j of Object.values(FS().jobs)) if (j.owner && !have.has(j.owner.structId)) cmd('forget', { jobId: j.id });
  }

  /* ================= the site: stakes, batter boards, strings, the dig overlay ================= */
  const wood = new T.MeshLambertMaterial({ color: 0xc8a36a }), woodDark = new T.MeshLambertMaterial({ color: 0x8a6a40 });
  const ghostMat = new T.MeshBasicMaterial({ color: 0xfff2c4, transparent: true, opacity: 0.55, depthWrite: false });
  const tapeMat = new T.MeshBasicMaterial({ color: 0xffd23a }), tickMat = new T.MeshBasicMaterial({ color: 0xe0402a });
  const box = new T.BoxGeometry(1, 1, 1);
  const ringGeo = new T.RingGeometry(0.16, 0.22, 24); ringGeo.rotateX(-Math.PI / 2);
  const site = { job: null, sig: '', group: null, ghosts: [], stakes: [], boards: [], pop: -1, ov: null, ovSig: '', ovRev: '', cells: null, order: [], strings: PO.create({ colour: 0xff4fa3 }), drive: null, checkT: 0, groundSig: '' };
  site.strings.visible = false;
  const tape = new T.Group();
  { const t = new T.Mesh(box, tapeMat); t.scale.set(0.02, 1, 0.004); t.position.y = -0.5; tape.add(t); const k = new T.Mesh(box, tickMat); k.scale.set(0.09, 0.012, 0.012); k.name = 'tick'; tape.add(k); }
  tape.visible = false; G.scene.add(tape);
  const cornerY = (job, x, z) => Math.max(job.topY, surf(x, z) + 0.1);
  const stakeMesh = (x, z, top, mat = wood, w = 0.04) => { const y0 = surf(x, z) - 0.15, m = new T.Mesh(box, mat); m.scale.set(w, top - y0, w); m.position.set(x, (top + y0) / 2, z); m.castShadow = true; return m; };
  // the strings on the boards: each side carried on past both corners to its batter boards
  function boardSpans(job) {
    const C = job.layout.corners, n = C.length, out = [];
    for (let k = 0; k < n; k++) {
      const p = C[k], q = C[(k + 1) % n], L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, ux = (q[0] - p[0]) / L, uz = (q[1] - p[1]) / L;
      out.push([[p[0] - ux * OUT, cornerY(job, p[0], p[1]), p[1] - uz * OUT], [q[0] + ux * OUT, cornerY(job, q[0], q[1]), q[1] + uz * OUT]]);
    }
    return out;
  }
  function diagonals(job) {
    const C = job.layout.corners, out = [];
    if (C.length === 4) for (const [a, b] of [[0, 2], [1, 3]]) out.push([[C[a][0], cornerY(job, C[a][0], C[a][1]), C[a][1]], [C[b][0], cornerY(job, C[b][0], C[b][1]), C[b][1]]]);
    return out;
  }
  function batterBoards(job, k) {
    const C = job.layout.corners, n = C.length, c = C[k], p = C[(k + n - 1) % n], q = C[(k + 1) % n];
    const u = (a) => { const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1; return [(c[0] - a[0]) / L, (c[1] - a[1]) / L]; };
    const u1 = u(p), u2 = u(q), y = cornerY(job, c[0], c[1]), g = new T.Group();
    const E = [c[0] + (u1[0] + u2[0]) * OUT, c[1] + (u1[1] + u2[1]) * OUT];
    const ends = [[E[0] - u2[0] * (OUT + 0.4), E[1] - u2[1] * (OUT + 0.4)], [E[0] - u1[0] * (OUT + 0.4), E[1] - u1[1] * (OUT + 0.4)]];
    for (const P of [E, ...ends]) g.add(stakeMesh(P[0], P[1], y + 0.06, woodDark, 0.045));
    for (const P of ends) {
      const m = new T.Mesh(box, wood), L = Math.hypot(P[0] - E[0], P[1] - E[1]);
      m.scale.set(L + 0.08, 0.09, 0.025); m.position.set((P[0] + E[0]) / 2, y - 0.045, (P[1] + E[1]) / 2); m.rotation.y = -Math.atan2(P[1] - E[1], P[0] - E[0]); m.castShadow = true;
      g.add(m);
    }
    g.userData.at = E;
    return g;
  }
  function clearGroup() { if (site.group) { G.scene.remove(site.group); site.group = null; } site.ghosts = []; site.stakes = []; site.boards = []; }
  // rebuilt when the job's layout changes (a stake, the loop closed, a reload)
  function buildSite(job) {
    clearGroup();
    if (!job) { site.strings.visible = false; return; }
    const g = (site.group = new T.Group());
    G.scene.add(g);
    const C = job.layout.corners;
    if (job.step === 'layout') {
      C.forEach((c, k) => {
        if (c[2]) { const s = stakeMesh(c[0], c[1], cornerY(job, c[0], c[1]) + 0.02); g.add(s); site.stakes[k] = s; return; }
        const gh = new T.Group(), post = new T.Mesh(box, ghostMat), ring = new T.Mesh(ringGeo, ghostMat), y = surf(c[0], c[1]);
        post.scale.set(0.05, 0.9, 0.05); post.position.y = 0.45; ring.position.y = 0.03;
        gh.add(post, ring); gh.position.set(c[0], y, c[1]); g.add(gh); site.ghosts[k] = gh;
      });
      // the strings already tied: between corners staked next to each other
      const spans = [];
      for (let k = 0; k < C.length; k++) { const a = C[k], b = C[(k + 1) % C.length]; if (a[2] && b[2]) spans.push([[a[0], cornerY(job, a[0], a[1]), a[1]], [b[0], cornerY(job, b[0], b[1]), b[1]]]); }
      if (!site.order.length || site.order.some((k) => !C[k] || !C[k][2])) {
        site.strings.setSpans(spans);
        // after a reload: the string carries on from the last staked corner
        site.order = C.map((c, k) => k).filter((k) => C[k][2]);
        if (site.order.length) { const c = C[site.order[site.order.length - 1]]; site.strings.tie([c[0], cornerY(job, c[0], c[1]), c[1]]); }
      }
      site.strings.visible = true;
    } else if (job.layout.closed) {
      C.forEach((c, k) => { const b = batterBoards(job, k); g.add(b); site.boards[k] = b; });
      site.strings.setSpans(boardSpans(job));
      site.strings.visible = true;
    } else site.strings.visible = false;
  }
  const jobSig = (j) => j ? j.id + ':' + j.step + ':' + j.layout.corners.map((c) => c.join(',')).join(';') + ':' + j.topY : '';

  // the dig overlay: which cells are inside a dig and on its painted edge are worked out once per layout
  const inPoly = (P, x, z) => { let ins = false; for (let a = 0, b = P.length - 1; a < P.length; b = a++) if ((P[a][1] > z) !== (P[b][1] > z) && x < ((P[b][0] - P[a][0]) * (z - P[a][1])) / (P[b][1] - P[a][1]) + P[a][0]) ins = !ins; return ins; };
  const edgeDist = (P, x, z) => { let d = Infinity; for (let a = 0, b = P.length - 1; a < P.length; b = a++) { const dx = P[a][0] - P[b][0], dz = P[a][1] - P[b][1], L2 = dx * dx + dz * dz, k = L2 ? clamp(((x - P[b][0]) * dx + (z - P[b][1]) * dz) / L2, 0, 1) : 0; d = Math.min(d, Math.hypot(x - P[b][0] - dx * k, z - P[b][1] - dz * k)); } return d; };
  function buildOverlay(job) {
    if (site.ov) { site.ov.dispose(); site.ov = null; }
    site.cells = null;
    if (!job || !job.digs || !job.digs.length) return;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const d of job.digs) for (const [x, z] of d.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    x0 -= 0.1; z0 -= 0.1; x1 += 0.1; z1 += 0.1;
    let cell = 0.1;
    while (((x1 - x0) / cell) * ((z1 - z0) / cell) > 9000) cell *= 1.25;
    const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell), dig = new Int16Array(nx * nz).fill(-1), edge = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell, c = j * nx + i;
      for (let k = 0; k < job.digs.length; k++) { const P = job.digs[k].poly; if (inPoly(P, x, z)) { dig[c] = k; if (edgeDist(P, x, z) < cell * 0.75) edge[c] = 1; break; } }
    }
    site.cells = { x0, z0, nx, nz, cell, dig, edge };
    site.ov = FM.overlay({ x0, z0, nx, nz, cell, yAt: surf, colourAt, lift: 0.012, minMs: 110 });
    site.ov.refresh();
  }
  function colourAt(x, z, out) {
    const C = site.cells, job = site.job;
    if (!C || !job) return false;
    const i = Math.floor((x - C.x0) / C.cell), j = Math.floor((z - C.z0) / C.cell), c = j * C.nx + i, k = C.dig[c];
    if (k < 0) return false;
    if (job.step === 'layout') {
      if (!C.edge[c] || (Math.floor((x + z) * 4) & 1)) return false;           // the outline to come, dashed
      out[0] = 1; out[1] = 0.97; out[2] = 0.88; out[3] = 0.4; return true;
    }
    if (C.edge[c]) { out[0] = 0.97; out[1] = 0.96; out[2] = 0.92; out[3] = 0.9; return true; }   // the painted dig line
    if (job.step === 'base') {
      // the base: amber where it wants more gravel, blue where it stands proud, and a faint dot pattern where it is
      // level but not yet tamped twice (the tamper's job)
      const d0 = surf(x, z) - (job.digs[k].baseY ?? job.topY - 0.1);
      if (d0 < -0.03) { const f = clamp((-d0 - 0.03) / 0.08, 0, 1); out[0] = 0.95 - 0.15 * f; out[1] = 0.55 - 0.2 * f; out[2] = 0.08; out[3] = 0.4 + 0.35 * f; return true; }
      if (d0 > 0.02) { out[0] = 0.35; out[1] = 0.62; out[2] = 1; out[3] = 0.3; return true; }
      const q = G.landscape.groundAt(G.sim.state, x, z);
      if ((!q || q.tamped < 2) && ((Math.floor(x * 10) + Math.floor(z * 10)) & 1)) { out[0] = 1; out[1] = 1; out[2] = 0.92; out[3] = q && q.tamped ? 0.12 : 0.22; return true; }
      return false;
    }
    if (job.step !== 'excavate') return false;
    const d = surf(x, z) - job.digs[k].targetY;
    // dark amber: still to dig (darker the more there is); pale yellow: close, the flat of the shovel trims it
    if (d > DIG.roughM) { const f = clamp((d - DIG.roughM) / 0.2, 0, 1); out[0] = 0.95 - 0.15 * f; out[1] = 0.55 - 0.2 * f; out[2] = 0.08; out[3] = 0.45 + 0.35 * f; return true; }
    if (d > DIG.tolUpM) { out[0] = 1; out[1] = 0.93; out[2] = 0.45; out[3] = 0.38; return true; }
    if (d < -DIG.tolDownM) { out[0] = 0.35; out[1] = 0.62; out[2] = 1; out[3] = 0.28; return true; }
    return false;
  }
  function digAt(x, z) { const j = site.job; if (!j || !j.digs) return null; for (const d of j.digs) if (inPoly(d.poly, x, z)) return d; return null; }

  // the job the player is working on: the nearest one still being laid out or dug (or any, if none)
  function nearJob() {
    const P = G.player;
    let best = null, bd = 30;
    for (const j of Object.values(FS().jobs)) {
      if (!j.layout || !j.layout.corners.length) continue;
      const C = j.layout.corners, cx = C.reduce((a, c) => a + c[0], 0) / C.length, cz = C.reduce((a, c) => a + c[1], 0) / C.length;
      const d = Math.hypot(cx - P.x, cz - P.z) - (['layout', 'excavate', 'base', 'forms', 'pour', 'finish', 'cure', 'strip'].includes(j.step) ? 0 : 20);
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  }

  /* ================= the bar ================= */
  const css = document.createElement('style');
  css.textContent = '#fbar .hslot .mtr>i{background:var(--warn)}';   // the slots' look is shared (template/ui/10-kit.css, 30-hotbar.css)
  document.head.appendChild(css);
  const bar = document.createElement('div');
  bar.id = 'fbar'; bar.className = 'panel'; bar.hidden = true; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Site');
  bar.innerHTML = '<div class="ghint" aria-live="polite"></div><div class="gtools"></div>';
  document.body.appendChild(bar);
  const hintEl = bar.querySelector('.ghint'), toolsEl = bar.querySelector('.gtools');
  // the bar sits in the bottom lane beside the mode chip; its hint stacks above it in the prompt place (template/ui/30-hotbar.css)
  if (window.__ui) {
    const ctx = document.createElement('div'); ctx.className = 'gctx'; ctx.append(hintEl); bar.insertBefore(ctx, toolsEl);
    toolsEl.classList.add('panel'); hintEl.classList.add('panel'); bar.classList.remove('panel');
    window.__ui.mount(bar, 'bottom', { order: 2 });
    new ResizeObserver(() => document.body.style.setProperty('--fbar-ctx', ctx.offsetHeight + 'px')).observe(ctx);
  }
  // a button on the tool strip, beside the Yard
  const tb = $('tools'), yardBtn = tb && tb.querySelector('[data-tool="hands"]');
  if (tb) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.tool = 'site'; b.setAttribute('aria-pressed', 'false');
    b.innerHTML = '<span class="key">7</span><span class="name">Site</span>';
    b.addEventListener('click', () => { G.setTool(G.player.tool === 'site' ? 'axe' : 'site'); $('view') && $('view').focus(); });
    tb.insertBefore(b, yardBtn || null);
  }
  let sayT = 0, sayMsg = '';
  const say = (m, secs = 4) => { if (!m) return; sayMsg = m; sayT = secs; hintEl.innerHTML = m; };
  const I = (p) => '<svg viewBox="0 0 36 36" fill="none" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  const ICONS = {
    kit: I('<path d="M7 30V12M29 30V12" stroke="var(--ic-wood)" stroke-width="3"/><path d="M4 13h28" stroke="var(--ic-wood)" stroke-width="3"/><path d="M7 16L29 16" stroke="var(--ic-warn)" stroke-width="1.6"/><path d="M15 9l6-5 2 2-6 5z" fill="var(--ic-steel)"/><path d="M18 8l-4 4" stroke="var(--ic-wood)" stroke-width="2"/>'),
    shovel: I('<path d="M27 5l-9 17" stroke="var(--ic-wood)" stroke-width="2.6"/><path d="M24 4l6 3" stroke="var(--ic-steel)" stroke-width="3"/><path d="M15 20l7 4-3 9c-1 2-4 2-6 1s-3-3-2-5z" fill="var(--ic-steel)" stroke="var(--ic-outline)"/><path d="M6 34c4-3 9-3 14-1" stroke="var(--ic-warn)" stroke-width="2"/>'),
  };

  /* ================= the layout kit: a hammer and a bundle of stakes ================= */
  const kit = (() => {
    const g = new T.Group(), h = new T.Mesh(box, woodDark), head = new T.Mesh(box, new T.MeshLambertMaterial({ color: 0x6d757c }));
    h.scale.set(0.028, 0.34, 0.028); h.position.y = 0.17; head.scale.set(0.11, 0.045, 0.045); head.position.y = 0.34;
    g.add(h, head); g.scale.setScalar(0.9);
    return { obj: g, use: null, still: [0.32, 0.78, 0.2, 0.3, 0, 0], stillArm: -0.5, walk: [0.32, 0.8, 0.05, 0.6, 0, 0], walkArm: -0.6, reach: [0.25, 0.95, 0.45, 1.1, 0, 0] };
  })();
  const _D = { x: 0, y: 0, z: 0 };
  kit.anim = (o, pm, toLocal) => {
    const d = site.drive;
    if (!d) return false;
    // two blows (at 0.13 s and 0.32 s): raised over the shoulder between them, brought down on the stake top
    const strike = d.t >= 0.32 ? 1 : 0.5 + 0.5 * Math.cos(2 * Math.PI * (d.t - 0.13) / 0.19);
    toLocal(d.x, d.top, d.z, _D);
    const L = Math.hypot(_D.x, _D.z) || 1, r = Math.min(L, 0.75);
    const sx = (_D.x / L) * r, sz = (_D.z / L) * r;
    o.position.set(sx * strike + 0.25 * (1 - strike), _D.y * strike + 1.75 * (1 - strike) + 0.02, sz * strike + 0.05 * (1 - strike));
    o.rotation.set(-1.6 * strike + 0.4 * (1 - strike), Math.atan2(sx, sz), 0);
    pm.armL.rotation.x = pm.armR.rotation.x = -2.8 + 1.7 * strike;
    pm.body.rotation.x += 0.3 * strike;
    G.player.faceHold = Math.atan2(d.x - G.player.x, d.z - G.player.z);
    return true;
  };

  const handPt = () => { const P = G.player; return [P.x + Math.sin(P.face) * 0.35, P.y + 0.95, P.z + Math.cos(P.face) * 0.35]; };
  // the unstaked corner the hand is at (or the pointer, within reach)
  function cornerAt(a, job) {
    const P = G.player, C = job.layout.corners;
    let best = -1, bd = 0.5;
    for (let k = 0; k < C.length; k++) {
      if (C[k][2]) continue;
      const dHand = Math.hypot(C[k][0] - a.x, C[k][1] - a.z), dPtr = a.gx != null && Math.hypot(C[k][0] - P.x, C[k][1] - P.z) < 2.3 ? Math.hypot(C[k][0] - a.gx, C[k][1] - a.gz) : Infinity, d = Math.min(dHand, dPtr);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
  function startDrive(job, k) {
    const c = job.layout.corners[k], top = cornerY(job, c[0], c[1]) + 0.02;
    const m = stakeMesh(c[0], c[1], top + 0.22);
    site.group && site.group.add(m);
    if (site.ghosts[k]) site.ghosts[k].visible = false;
    site.drive = { job: job.id, k, x: c[0], z: c[1], top, t: 0, blows: 0, mesh: m };
  }
  function driveTick(dt) {
    const d = site.drive;
    if (!d) return;
    d.t += dt;
    const blowAt = [0.13, 0.32];
    while (d.blows < 2 && d.t >= blowAt[d.blows]) {
      d.blows++;
      // a blow: the stake goes down, a jolt, a puff of earth
      d.mesh.scale.y -= 0.11; d.mesh.position.y -= 0.055;
      G.juice.hitStop = 0.045; G.cam.shake = Math.min((G.cam.shake || 0) + 0.02, 0.2);
      G.burst(d.x, surf(d.x, d.z) + 0.04, d.z, 5, 0x6b4f35, 0.9, 1.2, 0.04, 0.4);
    }
    if (d.t < 0.42) return;
    site.drive = null;
    if (d.form) { if (d.mesh.parent) d.mesh.parent.remove(d.mesh); return stakeDone(d); }
    const job = site.job;
    if (!job || job.id !== d.job) return;
    const r = cmd('stake', { jobId: job.id, corner: d.k });
    if (!r.ok) return say(r.reason);
    const p = [d.x, d.top - 0.02, d.z];
    if (!site.order.length) site.strings.tie(p); else site.strings.pin(p);
    site.order.push(d.k);
    const left = site.job.layout.corners.filter((c) => !c[2]).length;
    if (r.closed) closeLoop();
    else say(site.order.length === 1 ? 'Stake in, string tied on. Keep holding and pull toward the next glowing corner: the string pays out behind you.' : 'Stake in. ' + left + ' corner' + (left === 1 ? '' : 's') + ' to go.', 4);
  }
  function closeLoop() {
    const job = site.job;
    site.strings.close();
    G.juice.hitStop = 0.06;
    site.pop = 0;          // the batter boards come up over the next moment (see popTick)
    say('<b>Square.</b> The diagonals match. The strings go up on batter boards at finished height. Now dig inside the white line until the amber is gone: take up the <b>shovel</b> (2).', 7);
    site.closeAt = performance.now();
    site.sig = '';
    site.flashD = diagonals(job);
    site.order = [];
  }
  function popTick(dt) {
    if (site.pop < 0) return;
    site.pop += dt;
    for (let k = 0; k < site.boards.length; k++) {
      const b = site.boards[k];
      if (!b) continue;
      const t = site.pop - k * 0.12, s = t <= 0 ? 0.01 : t < 0.25 ? ease(t / 0.25) * 1.15 : t < 0.4 ? 1.15 - 0.15 * ease((t - 0.25) / 0.15) : 1;
      b.scale.set(1, s, 1);
      const E = b.userData.at, y = surf(E[0], E[1]);
      b.position.y = (1 - s) * y;      // grow up from the ground
      if (t > 0 && !b.userData.thunk) { b.userData.thunk = 1; G.burst(E[0], y + 0.1, E[1], 6, 0x8a6a40, 1.2, 1.6, 0.05, 0.5); }
    }
    if (site.flashD && site.pop > 0.2) { site.strings.flash(site.flashD, 0xffffff, 1.4); site.flashD = null; }
    if (site.pop > 0.4 + site.boards.length * 0.12) site.pop = -1;
  }

  /* ================= the shovel: the Yard's, and its flat trimming to the line ================= */
  const act = { kind: '', trim: null, warned: 0 };
  function trimPress(a, job) {
    act.trim = { x: a.x, z: a.z, m3: 0, n: 0 };
    G.juice.hitStop = 0.02;
  }
  function trimFrame(a) {
    const t = act.trim, job = site.job;
    if (!t || !job) return;
    lead(a);
    const L = Math.hypot(a.x - t.x, a.z - t.z);
    if (L < 0.08) return;
    const r = cmd('trim', { jobId: job.id, x0: t.x, z0: t.z, x1: a.x, z1: a.z });
    if (r.ok && r.m3 > 0) {
      t.m3 += r.m3; t.n++;
      const ux = (a.x - t.x) / L, uz = (a.z - t.z) / L;
      G.burst(a.x + ux * 0.18, surf(a.x, a.z) + 0.05, a.z + uz * 0.18, 2 + Math.min(5, Math.round(r.m3 * 400)), 0x5a4230, 0.8, 0.6, 0.04, 0.35);
      if (site.ov) site.ov.request();
    } else if (!r.ok && r.reason) say(r.reason);
    t.x = a.x; t.z = a.z;
  }
  function lead(a) {
    const P = G.player, gx = a.gx ?? a.x, gz = a.gz ?? a.z, d = Math.hypot(gx - P.x, gz - P.z);
    P.lead = d > 1.9 ? { x: ((gx - P.x) / d) * Math.min(1, (d - 1.9) / 0.8), z: ((gz - P.z) / d) * Math.min(1, (d - 1.9) / 0.8) } : null;
  }


  /* ================= B3: the gravel base, form boards and stakes ================= */
  const ITEMS = (G.stock && G.stock.ITEMS) || {};
  const money = (v) => '$' + (Math.round(v * 100) / 100).toFixed(v % 1 ? 2 : 0);
  const gestureN = () => { const o = CS() && CS().options; return Math.max(1, Math.min(4, (o && o.gesture) || 1)); };
  const stockItems = () => (G.sim.state.sys.stock && G.sim.state.sys.stock.items) || {};
  const buyBtn = (id, qty, label) => ITEMS[id] ? ' <button type="button" class="go" data-buy="' + id + '" data-qty="' + qty + '">' + (label || 'Buy') + ' ' + money(ITEMS[id].priceUsd * qty) + '</button>' : '';
  hintEl.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-buy]');
    if (!b) return;
    const r = G.sim.commandNow('stock.buy', { id: b.dataset.buy, qty: +b.dataset.qty || 1 });
    say(r.ok ? 'Bought ' + (ITEMS[b.dataset.buy] ? ITEMS[b.dataset.buy].name.toLowerCase() : b.dataset.buy) + '.' : r.reason === 'not enough money' ? 'Not enough money.' : r.reason, 3);
    G.markStockDirty && G.markStockDirty();
    $('view') && $('view').focus();
  });
  const FRM = { boardM: 2.44, boardH: 0.14, boardT: 0.038 };      // as content/concrete.js FORMS (the sim decides)
  const GRAVEL = 0x9c958a, CONC = 0x76736d;
  const mat = (c, o) => new T.MeshLambertMaterial({ color: c, ...(o || {}) });
  const formWood = mat(0xd2b07a), stakeWood = mat(0xb08a52), ghostBoard = new T.MeshBasicMaterial({ color: 0xfff2c4, transparent: true, opacity: 0.45, depthWrite: false });
  const dotMat = new T.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.85, depthWrite: false });
  const dotGeo = new T.RingGeometry(0.07, 0.11, 18); dotGeo.rotateX(-Math.PI / 2);
  const runPt = (r, t, off = 0) => [r.a[0] + ((r.b[0] - r.a[0]) * t) / r.len + r.out[0] * off, r.a[1] + ((r.b[1] - r.a[1]) * t) / r.len + r.out[1] * off];
  const runYaw = (r) => -Math.atan2(r.b[1] - r.a[1], r.b[0] - r.a[0]);
  const fv = { sig: '', group: null, runs: [], dots: [], ghost: null, ghostRun: -1, pop: [], bags: null, bagSig: '' };
  // the gaps between what holds a run (its corners and driven stakes), and the bow of the worst one at t
  function bowAt(r, t) {
    if (!(r.bow > 0.0005)) return 0;
    const sup = [0, ...r.stakes.filter((s, q) => r.driven[q]), r.len].sort((a, b) => a - b);
    let g0 = 0, g1 = r.len, best = -1;
    for (let q = 0; q + 1 < sup.length; q++) if (sup[q + 1] - sup[q] > best) { best = sup[q + 1] - sup[q]; g0 = sup[q]; g1 = sup[q + 1]; }
    return t > g0 && t < g1 ? r.bow * Math.sin((Math.PI * (t - g0)) / (g1 - g0)) : 0;
  }
  function buildForms(job) {
    if (fv.group) { G.scene.remove(fv.group); fv.group = null; }
    fv.runs = []; fv.dots = [];
    if (!job || !job.forms) return;
    const g = (fv.group = new T.Group()), top = job.topY, F = FRM;
    G.scene.add(g);
    job.forms.runs.forEach((r, k) => {
      const rg = new T.Group(), segs = [];
      g.add(rg);
      const setL = Math.min(r.len + F.boardT * 2, (r.set - (r.stripped || 0)) * F.boardM);
      // the boards, in short pieces so a bow shows as a curve
      for (let t0 = -F.boardT; t0 < setL - F.boardT - 1e-3; t0 += 0.3) {
        const t1 = Math.min(setL - F.boardT, t0 + 0.3), tm = (t0 + t1) / 2, m = new T.Mesh(box, formWood);
        m.scale.set(t1 - t0 + 0.004, F.boardH, F.boardT); m.rotation.y = runYaw(r); m.castShadow = true;
        m.userData.t = tm; segs.push(m); rg.add(m);
      }
      // stakes driven outside the boards; the ones still to drive glow where they go
      r.stakes.forEach((s, q) => {
        if (s > setL || r.pulled) return;
        const [x, z] = runPt(r, s, F.boardT + 0.022);
        if (r.driven[q]) { const m = stakeMesh(x, z, top - 0.015, stakeWood, 0.038); rg.add(m); }
        else { const d = new T.Mesh(dotGeo, dotMat); d.position.set(x, surf(x, z) + 0.03, z); d.renderOrder = 3; d.userData = { run: k, stake: q }; g.add(d); fv.dots.push(d); }
      });
      fv.runs.push({ r, segs, group: rg, loose: r.set >= r.boards && r.driven.some((d) => !d) });
    });
    placeBoards(job, 0);
  }
  function placeBoards(job, time) {
    const top = job.topY, F = FRM;
    for (const fr of fv.runs) {
      const wob = fr.loose && job.step === 'forms' ? 0.004 * Math.sin(time * 9 + fr.r.len) : 0;
      for (const m of fr.segs) {
        const t = m.userData.t, [x, z] = runPt(fr.r, t, F.boardT / 2 + bowAt(fr.r, t) + wob);
        m.position.set(x, top - F.boardH / 2, z);
      }
    }
  }
  const formsSig = (j) => j && j.forms ? j.step + ':' + j.topY + ':' + j.forms.runs.map((r) => r.set + '/' + (r.stripped || 0) + '/' + r.driven.join('') + '/' + Math.round(r.bow * 1000)).join(';') : '';
  // the ghost of the next boards, snapped along the run nearest the hand
  function ghostTick(a, job) {
    const show = on && held() === 'board' && job && job.step === 'forms' && job.forms && a.valid;
    let k = -1;
    if (show) { let bd = 1.2; job.forms.runs.forEach((r, q) => { if (r.set >= r.boards) return; const d = segDistV(r, a.gx ?? a.x, a.gz ?? a.z); if (d < bd) { bd = d; k = q; } }); }
    if (k < 0) { if (fv.ghost) fv.ghost.visible = false; fv.ghostRun = -1; return; }
    const r = job.forms.runs[k], n = Math.min(gestureN(), r.boards - r.set), t0 = r.set * FRM.boardM - FRM.boardT, t1 = Math.min(r.len + FRM.boardT, (r.set + n) * FRM.boardM - FRM.boardT);
    if (!fv.ghost) { fv.ghost = new T.Mesh(box, ghostBoard); fv.ghost.renderOrder = 4; G.scene.add(fv.ghost); }
    const [x, z] = runPt(r, (t0 + t1) / 2, FRM.boardT / 2);
    fv.ghost.scale.set(t1 - t0, FRM.boardH, FRM.boardT); fv.ghost.rotation.y = runYaw(r); fv.ghost.position.set(x, job.topY - FRM.boardH / 2 + 0.02 * Math.sin(performance.now() / 160), z);
    fv.ghost.visible = true; fv.ghostRun = k;
  }
  function segDistV(r, x, z) { const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1], L2 = dx * dx + dz * dz, k = L2 ? clamp(((x - r.a[0]) * dx + (z - r.a[1]) * dz) / L2, 0, 1) : 0; return Math.hypot(x - r.a[0] - dx * k, z - r.a[1] - dz * k); }
  function setBoards(job) {
    if (fv.ghostRun < 0) return say('Hold a board near a string line: it snaps along the run. Click to set it.');
    const r = cmd('setForm', { jobId: job.id, run: fv.ghostRun, n: gestureN() });
    if (!r.ok) return say(r.reason + (/form boards/.test(r.reason) ? buyBtn('form_board', job.forms.runs.reduce((a, q) => a + q.boards - q.set, 0), 'Buy them') : ''), 6);
    const rr = FR.job(G.sim.state, job.id).forms.runs[r.run], [x, z] = runPt(rr, Math.min(rr.len, rr.set * FRM.boardM) / 2);
    G.juice.hitStop = 0.05; G.cam.shake = Math.min((G.cam.shake || 0) + 0.03, 0.2);
    G.burst(x, job.topY - 0.05, z, 10, 0xd2b07a, 1.4, 1.6, 0.05, 0.5);
    say(r.done ? (r.stakesLeft ? '<b>Formed.</b> Now stake them: take up the <b>hammer</b> and drive the glowing stakes, or the boards bow out under the concrete.' : '<b>Formed and staked.</b>') : 'Board set on the string. ' + (r.runDone ? 'That side is done.' : ''), 5);
  }
  // the hammer on a form stake: two blows, then the stakes beside it (up to the gesture setting)
  function stakeAt(a, job) {
    let best = null, bd = 0.45;
    for (const d of fv.dots) { const x = d.position.x, z = d.position.z, dh = Math.min(Math.hypot(x - a.x, z - a.z), a.gx != null ? Math.hypot(x - a.gx, z - a.gz) : Infinity); if (dh < bd && Math.hypot(x - G.player.x, z - G.player.z) < 2.4) { bd = dh; best = d; } }
    return best;
  }
  function startStake(job, d) {
    const top = job.topY - 0.015, x = d.position.x, z = d.position.z, m = stakeMesh(x, z, top + 0.2, stakeWood, 0.038);
    fv.group && fv.group.add(m);
    d.visible = false;
    site.drive = { job: job.id, form: d.userData, x, z, top, t: 0, blows: 0, mesh: m };
  }
  function stakeDone(dr) {
    const job = site.job;
    if (!job || job.id !== dr.job) return;
    const r = cmd('stakeForm', { jobId: job.id, run: dr.form.run, stake: dr.form.stake, n: gestureN() });
    fv.sig = '';
    if (!r.ok) return say(r.reason + (/form stakes/.test(r.reason) ? buyBtn('form_stake', 10, 'Buy 10') : ''), 6);
    const rr = FR.job(G.sim.state, job.id).forms.runs[r.run];
    r.driven.slice(1).forEach((q, n) => { const [x, z] = runPt(rr, rr.stakes[q], FRM.boardT + 0.022); setTimeout(() => { G.burst(x, surf(x, z) + 0.05, z, 4, 0x6b4f35, 0.9, 1.2, 0.04, 0.35); G.cam.shake = Math.min((G.cam.shake || 0) + 0.015, 0.2); }, 90 * (n + 1)); });
    if (job.step === 'pour' && !r.leaking) say('Staked: the board is held.', 3);
    else if (r.stakesLeft) say(r.driven.length + ' staked and nailed to the board. ' + r.stakesLeft + ' to go.', 3);
    else say('<b>Every stake in.</b> The forms are ready for the pour: mix concrete in the <b>barrow</b>.', 6);
  }

  /* ---------- hand items (simple procedural) ---------- */
  const part = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; return o; };
  const bx = (w, h, d) => new T.BoxGeometry(w, h, d);
  const steel = mat(0x6d767c), handleMat = mat(0xc9975a), dark = mat(0x2a2a2a), trayMat = mat(0x2f6e8e);
  const heapMat = mat(0x9c958a), heapGeo = new T.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const barrow = (() => {
    const g = new T.Group();
    g.add(part(bx(0.56, 0.05, 0.7), trayMat, 0, 0.42, 0), part(bx(0.56, 0.2, 0.04), trayMat, 0, 0.52, 0.34, 0.25), part(bx(0.56, 0.2, 0.04), trayMat, 0, 0.52, -0.34, -0.25),
      part(bx(0.04, 0.2, 0.7), trayMat, 0.28, 0.52, 0), part(bx(0.04, 0.2, 0.7), trayMat, -0.28, 0.52, 0), part(new T.CylinderGeometry(0.16, 0.16, 0.07, 14), dark, 0, 0.16, 0.48, 0, 0, Math.PI / 2),
      part(bx(0.035, 0.035, 1.3), handleMat, 0.22, 0.42, -0.25, 0.12), part(bx(0.035, 0.035, 1.3), handleMat, -0.22, 0.42, -0.25, 0.12));
    const heap = new T.Mesh(heapGeo, heapMat); heap.position.set(0, 0.45, 0); heap.scale.set(1.2, 0.01, 1.5); g.add(heap);
    g.scale.setScalar(0.85);
    return { obj: g, heap, use: 'hand', still: [0, 0.05, 0.65, 0, 0, 0], reach: [0, 0.05, 0.75, 0, 0, 0], stillArm: -0.4 };
  })();
  const rake = { obj: (() => { const g = new T.Group(); g.add(part(bx(0.024, 1.6, 0.024), handleMat, 0, 0.83, 0), part(bx(0.46, 0.03, 0.04), steel, 0, 0.03, 0.02)); for (let i = 0; i < 12; i++) g.add(part(bx(0.012, 0.08, 0.012), steel, -0.21 + i * 0.038, 0, 0.05)); return g; })(), use: 'tip', still: [0.38, 0.02, 0.24, 0, 0, 0], stillArm: -0.5, walk: [0.3, 1.74, -0.78, 2.15, 0, 0], walkArm: -1.0 };
  const tamper = { obj: (() => { const g = new T.Group(); g.add(part(bx(0.03, 1.2, 0.03), dark, 0, 0.62, 0), part(bx(0.2, 0.025, 0.2), steel, 0, 0.012, 0), part(bx(0.16, 0.03, 0.03), dark, 0, 1.22, 0)); return g; })(), use: 'tip', still: [0.38, 0.02, 0.24, 0, 0, 0], stillArm: -0.5, walk: [0.3, 1.74, -0.78, 2.15, 0, 0], walkArm: -1.0 };
  const boardItem = { obj: part(bx(1.2, 0.14, 0.038), formWood, 0, 0, 0), use: 'hand', still: [0.3, 0.9, 0.15, 0, 1.5, 0], stillArm: -0.6, walk: [0.3, 1.5, -0.1, 0, 1.5, 1.4], walkArm: -1.2 };
  const screedItem = { obj: part(bx(1.8, 0.089, 0.038), formWood, 0, 0, 0), use: 'hand', still: [0.3, 0.9, 0.15, 0, 1.5, 0], stillArm: -0.6, walk: [0.3, 1.5, -0.1, 0, 1.5, 1.4], walkArm: -1.2 };
  const truckFlag = { obj: (() => { const g = new T.Group(); g.add(part(bx(0.02, 0.9, 0.02), handleMat, 0, 0.45, 0), part(bx(0.22, 0.14, 0.01), mat(0xff7a1a), 0.11, 0.82, 0)); return g; })(), use: 'hand', still: [0.32, 0.78, 0.2, 0.3, 0, 0], stillArm: -0.5 };
  ICONS.gravel = I('<path d="M4 30h28" stroke="#a3784e" stroke-width="2"/><path d="M7 29c3-9 8-13 11-13s8 4 11 13z" fill="#9c958a" stroke="#d8d2c6"/><circle cx="14" cy="24" r="1.4" fill="#6f6a62"/><circle cx="20" cy="21" r="1.4" fill="#6f6a62"/><circle cx="23" cy="26" r="1.4" fill="#6f6a62"/>');
  ICONS.barrow = I('<path d="M6 14h20l-4 10H11z" fill="#2f6e8e" stroke="#cfe4ee"/><circle cx="25" cy="29" r="4" fill="#222" stroke="#ddd"/><path d="M8 24l-3 8M21 24l4 2M26 14l9-4" stroke="#d8b585" stroke-width="2"/>');
  ICONS.rake = I('<path d="M29 5L15 27" stroke="#d8b585" stroke-width="2.6"/><path d="M7 25l14 9" stroke="#b9c2c9" stroke-width="2.6"/><path d="M8 26l-2 4M11 28l-2 4M14 30l-2 4M17 32l-2 4M20 34l-2 3" stroke="#b9c2c9" stroke-width="1.8"/>');
  ICONS.tamper = I('<path d="M20 5v24" stroke="#bbb" stroke-width="2.6"/><path d="M15 5h10" stroke="#888" stroke-width="3"/><path d="M11 29h18v4H11z" fill="#7d8287" stroke="#ddd"/>');
  ICONS.board = I('<path d="M4 22l26-10 2 5-26 10z" fill="#d2b07a" stroke="#f1dcb2"/><path d="M9 26v7M27 19v7" stroke="#b08a52" stroke-width="2.4"/>');
  ICONS.hammer = I('<path d="M12 31l12-19" stroke="#c9975a" stroke-width="3"/><path d="M18 9l9 6 3-4-9-6z" fill="#8f979d" stroke="#cfd6dc"/><path d="M6 33h10" stroke="#b08a52" stroke-width="2"/><path d="M9 26v7" stroke="#b08a52" stroke-width="3"/>');
  ICONS.screed = I('<path d="M3 20h30" stroke="#d2b07a" stroke-width="4"/><path d="M5 26c6-2 11-2 16 0" stroke="#76736d" stroke-width="3"/><path d="M22 27c3-3 6-4 10-3" stroke="#9a978f" stroke-width="2.4"/>');

  /* ================= B3: the base gestures (the Yard's own commands) ================= */
  const lcmd = (n, p) => { try { return G.sim.commandNow('landscape.' + n, p) || { ok: false }; } catch (e) { return { ok: false, reason: e.message }; } };
  const tools = () => (G.sim.state.sys.stock && G.sim.state.sys.stock.tools) || [];
  const needTool = (id, name) => tools().includes(id) ? null : 'You need ' + name + '.' + buyBtn(id, 1);
  const baseLine = (job, x, z) => { const d = digAt(x, z) || (job.digs || [])[0]; return d ? (d.baseY ?? job.topY - 0.1) : job.topY - 0.1; };
  const b3 = { lx: 0, lz: 0, acc: 0, tipped: false, n: 0, m3: 0 };
  function heapTick() {
    const st = G.sim.state.sys, job = site.job, pour = job && job.step === 'pour';
    const m3 = pour ? (FR.carry(G.sim.state).vol || 0) : (st.landscape && st.landscape.barrow ? st.landscape.barrow.m3 : 0), cap = pour ? 0.051 : 0.1;
    const k = clamp(m3 / cap, 0, 1);
    barrow.heap.visible = k > 0.01;
    barrow.heap.scale.set(1.2, 0.05 + 0.75 * k, 1.5);
    if (pour) { const c = FR.carry(G.sim.state); heapMat.color.setHex(!c.band ? 0xb9b5ad : c.mixed < 0.5 ? 0x9a968e : c.band === 'dry' ? 0x8f8b83 : c.band === 'soupy' || c.band === 'wet' ? 0x5f5d59 : 0x6c6a65); }
    else heapMat.color.setHex(st.landscape && st.landscape.barrow && st.landscape.barrow.s === 'soil' ? 0x5a4230 : GRAVEL);
  }
  function gravelPress(a, job) {
    if (job.step !== 'base') return say(job.step === 'excavate' ? 'Dig to the line first.' : 'The base is in.');
    b3.lx = a.x; b3.lz = a.z; b3.n = 0; b3.m3 = 0;
    tipGravel(a, job);
  }
  function tipGravel(a, job) {
    const r = cmd('gravel', { jobId: job.id, x: a.x, z: a.z });
    if (!r.ok) { say(r.reason + (/No gravel/.test(r.reason) ? buyBtn('gravel', 0.5, 'Buy 0.5 m³') : ''), 6); b3.n = -99; return; }
    b3.n++; b3.m3 += r.m3;
    G.juice.hitStop = 0.06; G.cam.shake = Math.min((G.cam.shake || 0) + 0.08, 0.3);
    G.burst(a.x, surf(a.x, a.z) + 0.6, a.z, 30, GRAVEL, 2.2, 1.2, 0.07, 0.8);
    say('The truck tips as you guide it: <b>' + Math.round(r.delivered * 1000) + ' L</b> of ' + Math.round(r.needM3 * 1000) + ' L. Drag along the pad to spread the load.', 4);
  }
  function gravelFrame(a, job) {
    if (b3.n < 0) return;
    lead(a);
    if (Math.hypot(a.x - b3.lx, a.z - b3.lz) < 0.55) return;
    b3.lx = a.x; b3.lz = a.z;
    tipGravel(a, job);
  }
  // the barrow (the Yard's): click to shovel a scoop in, drag down to tip it out
  function barrowRelease(a) {
    if (b3.tipped) return;
    const why = needTool('wheelbarrow', 'a wheelbarrow');
    if (why) return say(why, 5);
    const r = lcmd('load', { x: a.x, z: a.z });
    if (!r.ok) return say(r.reason);
    G.burst(a.x, surf(a.x, a.z) + 0.12, a.z, 10, r.s === 'soil' ? 0x5a4230 : GRAVEL, 1.5, 2.2, 0.07, 0.6);
    say(r.full ? 'The barrow is full. Wheel it to a low spot and <b>drag down</b> to tip it.' : 'In the barrow: ' + Math.round(r.load * 1000) + ' L.');
  }
  function barrowTipBase(a) {
    if (b3.tipped || a.tip < 0.45) return;
    b3.tipped = true;
    const r = lcmd('tip', { x: a.x, z: a.z });
    if (!r.ok) return say(r.reason);
    G.burst(a.x, surf(a.x, a.z) + 0.3, a.z, 24, r.s === 'soil' ? 0x5a4230 : GRAVEL, 1.8, 1.4, 0.07, 0.7);
    say('Tipped ' + Math.round(r.m3 * 1000) + ' L. Rake it to the line.');
  }
  // the rake on the base: the back of it pulls gravel to the line under the strings (a push riding at the base
  // level), the tines even it out
  function rakeBaseFrame(a, job) {
    lead(a);
    const L = Math.hypot(a.x - b3.lx, a.z - b3.lz);
    if (L < 0.1) return;
    const why = needTool('rake', 'a rake');
    if (why) { if (!b3.warned) say(why, 5); b3.warned = 1; return; }
    const mx = (a.x + b3.lx) / 2, mz = (a.z + b3.lz) / 2, level = baseLine(job, mx, mz) - G.heightAt(mx, mz);
    const steps = Math.ceil(L / 0.1);
    for (let k = 0; k < steps; k++) {
      const x0 = b3.lx + ((a.x - b3.lx) * k) / steps, z0 = b3.lz + ((a.z - b3.lz) * k) / steps, x1 = b3.lx + ((a.x - b3.lx) * (k + 1)) / steps, z1 = b3.lz + ((a.z - b3.lz) * (k + 1)) / steps;
      lcmd('push', { x0, z0, x1, z1, level });
    }
    const r = lcmd('rake', { x: a.x, z: a.z, r: 0.4, k: 0.6 });
    if (!r.ok && r.reason) { if (!b3.warned) say(r.reason); b3.warned = 1; }
    b3.lx = a.x; b3.lz = a.z;
    if (++b3.n % 2 === 0) G.burst(a.x, surf(a.x, a.z) + 0.04, a.z, 3, GRAVEL, 0.9, 0.8, 0.035, 0.35);
  }
  function thump(a) {
    const r = lcmd('tamp', { x: a.x, z: a.z });
    G.juice.hitStop = 0.05; G.cam.shake = Math.min((G.cam.shake || 0) + 0.03, 0.2);
    // a dust ring off the plate
    for (let k = 0; k < 6; k++) { const an = (k / 6) * Math.PI * 2; G.burst(a.x + Math.cos(an) * 0.16, surf(a.x, a.z) + 0.02, a.z + Math.sin(an) * 0.16, 1, 0xb8ae9c, 0.8, 0.3, 0.04, 0.4); }
    if (!r.ok) { if (b3.why !== r.reason) say(r.reason); b3.why = r.reason; }
  }

  /* ================= B4: mixing in the barrow, tipping, raking, the screed ================= */
  const MIXB = [['dry', 0.4], ['stiff', 0.48], ['good', 0.64], ['wet', 0.78], ['soupy', 1.0]];  // as content MIX bands
  const BAND_COL = { dry: '#c9b48a', stiff: '#b9c27a', good: '#6fcf6f', wet: '#7ab6e0', soupy: '#5a86d8' };
  function mixMeter() {
    const c = FR.carry(G.sim.state);
    if (!c.vol) return '';
    const lo = 0.25, hi = 1.0, pct = (v) => Math.round((clamp(v, lo, hi) - lo) / (hi - lo) * 100);
    let bands = '', prev = lo;
    for (const [id, up] of MIXB) { bands += '<i style="left:' + pct(prev) + '%;width:' + (pct(up) - pct(prev)) + '%;background:' + BAND_COL[id] + '"></i>'; prev = up; }
    const needle = c.wc != null ? '<b style="left:' + pct(c.wc) + '%"></b>' : '';
    return '<span class="fmix"><span class="fbands">' + bands + needle + '</span><span class="flab">' + c.bags.toFixed(c.bags % 1 ? 1 : 0) + ' bags · ' + c.waterL.toFixed(1) + ' L water · mixed ' + Math.round(c.mixed * 100) + '%</span></span>';
  }
  css.textContent += '#fbar .fmix{display:block;margin:4px auto 0;width:300px}#fbar .fbands{position:relative;display:block;height:9px;border-radius:5px;overflow:hidden;background:#333}#fbar .fbands i{position:absolute;top:0;bottom:0;opacity:.75}' +
    '#fbar .fbands b{position:absolute;top:-2px;width:3px;height:13px;margin-left:-1px;background:#fff;box-shadow:0 0 4px #000}#fbar .flab{display:block;font-size:12px;color:var(--ink-dim)}';
  const b4 = { hose: false, waterAcc: 0, slashed: false, tipped: false, hoeX: null, hoeZ: null, hoeAcc: 0, rx: 0, rz: 0, scr: null, last: null };
  function bagsAvail() {
    const cs = CS(), st = cs && cs.stacks ? cs.stacks.filter((k) => k.itemId === 'concrete_mix').reduce((a, k) => a + k.qty, 0) : 0;
    return Math.floor(((st || 0) + (stockItems().concrete_mix || 0)) / 36 + 1e-6);
  }
  function mixPress(a, job) {
    b4.slashed = false; b4.tipped = false; b4.hoeX = a.x; b4.hoeZ = a.z; b4.hoeAcc = 0; b4.hose = !!a.alt;
    if (!tools().includes('wheelbarrow')) { say(needTool('wheelbarrow', 'a wheelbarrow to mix in'), 6); act.kind = ''; return; }
    if (b4.hose) say('Water running in…', 1.5);
  }
  function mixFrame(a, dt, job) {
    const c = FR.carry(G.sim.state);
    if (b4.hose) {
      b4.waterAcc += dt;
      if (b4.waterAcc >= 0.1) {
        const r = cmd('mix', { jobId: job.id, waterL: 0.5 * b4.waterAcc }); b4.waterAcc = 0;
        if (!r.ok) { say(r.reason); b4.hose = false; return; }
        G.burst(a.x, surf(a.x, a.z) + 0.55, a.z, 2, 0x9fd0ff, 0.5, 0.6, 0.025, 0.25);
        say(mixSays(r.mix), 1.2);
      }
      return;
    }
    // drag up over the lip: bags slashed open into it
    if (!b4.slashed && a.lift > 0.45) {
      b4.slashed = true;
      const r = cmd('mix', { jobId: job.id, bags: gestureN() });
      if (!r.ok) return say(r.reason + (/No concrete mix/.test(r.reason) ? buyBtn('concrete_mix', 36 * 3, 'Buy 3 bags') : ''), 6);
      G.juice.hitStop = 0.04;
      G.burst(a.x, surf(a.x, a.z) + 0.75, a.z, 18, 0xcfcac0, 1.6, 1.2, 0.06, 0.9);
      say('Slashed open ' + (r.bags % 1 ? r.bags.toFixed(1) : r.bags) + ' bag' + (r.bags === 1 ? '' : 's') + ' (' + Math.round(r.mix.bags * 36) + ' kg). Now <b>hold the right button</b> to run the hose in, about 3 L a bag.', 5);
      return;
    }
    // drag down at the forms: tip it in
    if (!b4.tipped && a.tip > 0.45 && c.vol > 0) {
      b4.tipped = true;
      return tipConcrete(a, job);
    }
    // side to side in the tub: the hoe works it through
    const d = Math.hypot(a.x - b4.hoeX, a.z - b4.hoeZ);
    if (d > 0.05 && a.lift < 0.3 && a.tip < 0.3 && c.vol > 0) {
      b4.hoeAcc += d; b4.hoeX = a.x; b4.hoeZ = a.z;
      if (b4.hoeAcc > 0.15) {
        const r = cmd('mix', { jobId: job.id, work: b4.hoeAcc * 1.6 }); b4.hoeAcc = 0;
        if (r.ok) { if (r.dry) say('Stirring dry powder does little: water in first (right button).', 3); else { say(mixSays(r.mix), 1.5); if (Math.random() < 0.5) G.burst(a.x, surf(a.x, a.z) + 0.5, a.z, 2, 0x6c6a65, 0.6, 0.6, 0.03, 0.3); } }
      }
    }
  }
  function mixSays(m) {
    if (!m || !m.vol) return 'The barrow is empty.';
    if (m.band === null) return 'Grey powder. Run water in (right button).';
    const word = { dry: 'Crumbly, too dry', stiff: 'Stiff', good: 'Right', wet: 'Wet', soupy: 'Soupy' }[m.band];
    return '<b>' + word + '.</b> ' + (m.mixed < 0.5 ? 'Hoe it through: drag back and forth in the barrow.' : m.mixed < 1 ? 'Keep hoeing (' + Math.round(m.mixed * 100) + '%).' : m.says + '.') + mixMeter();
  }
  function tipConcrete(a, job) {
    const r = cmd('tip', { jobId: job.id, x: a.x, z: a.z });
    if (!r.ok) return say(r.reason);
    const [x, z] = r.at;
    G.juice.hitStop = 0.07; G.cam.shake = Math.min((G.cam.shake || 0) + 0.06, 0.25);
    G.burst(x, surf(x, z) + 0.25, z, 16, CONC, 1.4, 0.9, 0.07, 0.6);
    pourDirty(x, z, 2.2);
    const pct = Math.round((r.placed / Math.max(1e-6, r.needM3)) * 100);
    const slump = { dry: 'It sits in a crumbly heap.', stiff: 'It holds its heap: rake it out.', good: 'A heavy heap that slumps and spreads.', wet: 'It slumps flat and runs.', soupy: 'It runs out flat and bleeds water.' }[r.band];
    say(slump + ' <b>' + pct + '%</b> of the slab in. ' + (r.leaking.length ? '<b>A form is bowing out and leaking: stake it!</b> (hammer)' : pct >= 100 ? 'Enough for the screed: rake it level, then take up the <b>screed</b>.' : 'Mix the next batch.'), 6);
  }
  function rakeConcreteFrame(a, job) {
    lead(a);
    if (Math.hypot(a.x - b4.rx, a.z - b4.rz) < 0.1) return;
    b4.rx = a.x; b4.rz = a.z;
    const r = cmd('rake', { jobId: job.id, x: a.x, z: a.z });
    if (!r.ok) return;
    pourDirty(a.x, a.z, 1.4);
    if (r.leaking.length && !b4.leakSaid) { b4.leakSaid = 1; say('<b>A form is bowing out and leaking:</b> stake it with the hammer.', 5); }
    if (r.m3 > 0.0005 && Math.random() < 0.4) G.burst(a.x, surf(a.x, a.z) + 0.12, a.z, 2, CONC, 0.6, 0.5, 0.03, 0.3);
  }
  // the screed: the board lies across the forms at the hand; drag it toward you with a little saw and the surplus
  // rolls ahead of it as a ridge
  const screedMesh = part(bx(1, 0.089, 0.038), formWood, 0, 0, 0); screedMesh.visible = false; G.scene.add(screedMesh);
  function longAxis(job) {
    const C = job.layout.corners;
    let best = -1, u = [1, 0];
    for (let k = 0; k < C.length; k++) { const a = C[k], b = C[(k + 1) % C.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > best) { best = L; u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; } }
    return u;
  }
  function placeScreed(job, x, z, board, saw) {
    const u = board ? board.u : longAxis(job), n = [-u[1], u[0]], C = job.layout.corners;
    let lo = Infinity, hi = -Infinity;
    for (const c of C) { const v = c[0] * n[0] + c[1] * n[1]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const mid = board ? board.mid : (lo + hi) / 2, w = board ? board.w : hi - lo + 0.24, al = x * u[0] + z * u[1];
    const px = al * u[0] + (mid + saw) * n[0], pz = al * u[1] + (mid + saw) * n[1];
    screedMesh.scale.set(w, 1, 1); screedMesh.rotation.set(0, -Math.atan2(n[1], n[0]), 0.12);
    screedMesh.position.set(px, job.topY + 0.045, pz); screedMesh.visible = true;
  }
  function screedPress(a, job) {
    b4.scr = { x: a.x, z: a.z, t: 0, board: null, n: 0 };
    placeScreed(job, a.x, a.z, null, 0);
    say('Drag the board toward you along the forms, sawing a little: it rides the forms at the top of the slab.', 4);
  }
  function screedFrame(a, dt, job) {
    const s = b4.scr;
    if (!s) return;
    lead(a);
    s.t += dt;
    const saw = 0.035 * Math.sin(s.t * 14);
    const L = Math.hypot(a.x - s.x, a.z - s.z);
    if (L >= 0.08) {
      const r = cmd('screed', { jobId: job.id, x0: s.x, z0: s.z, x1: a.x, z1: a.z });
      if (r.ok) {
        s.board = r.board || s.board; s.n++;
        pourDirty(a.x, a.z, 3);
        // the ridge rolling ahead: grey crumbs off the front, more the bigger it is
        if (r.m3 > 0.001) { const u = s.board ? s.board.u : [0, 0], sg = Math.sign((a.x - s.x) * u[0] + (a.z - s.z) * u[1]) || 1; G.burst(a.x + u[0] * 0.2 * sg, job.topY + 0.03, a.z + u[1] * 0.2 * sg, 2 + Math.min(6, Math.round(r.m3 * 300)), CONC, 0.9, 0.5, 0.04, 0.35); }
        G.cam.shake = Math.min((G.cam.shake || 0) + 0.004, 0.06);
        if (r.torn) say(r.torn + '.', 3);
        else if (r.hollow > 0.04) say('Dull hollows behind the board: tip a little more ahead of it and pass again.', 3);
        if (r.done) screededOut(job);
      } else if (r.reason) say(r.reason);
      s.x = a.x; s.z = a.z;
    }
    if (FR.job(G.sim.state, job.id).step === 'pour') placeScreed(job, a.x, a.z, s.board, saw); else screedMesh.visible = false;
  }
  function screededOut(job) {
    G.juice.hitStop = 0.12; G.cam.shake = Math.min((G.cam.shake || 0) + 0.12, 0.35);
    const C = job.layout.corners;
    for (const c of C) G.burst(c[0], job.topY + 0.2, c[1], 10, 0xfff2c4, 1.6, 2.4, 0.06, 0.9);
    const cx = C.reduce((a, c) => a + c[0], 0) / C.length, cz = C.reduce((a, c) => a + c[1], 0) / C.length;
    G.burst(cx, job.topY + 0.1, cz, 30, 0xdfe6ea, 2.6, 1.4, 0.05, 1.1);
    screedMesh.visible = false;
    const v = FR.jobView(G.sim.state, job.id);
    say('<b>Screeded.</b> Dead flat and wet-bright, right to the forms (' + (v.pour ? Math.round(v.pour.m3 * 1000) + ' L' : '') + '). Now finish it: take up the <b>float</b> and sweep it over the top while the bleed water rises.', 9);
    setTimeout(() => { if (on) { H.setSlots(slotList()); H.hold && H.hold('bfloat'); } }, 260);
  }

  /* ---------- the pour drawn: the wet field (fieldmesh) ---------- */
  const pourMesh = { fm: null, jobId: null, grid: null, colour: null };
  function pourDirty(x, z, r) { if (pourMesh.fm) pourMesh.fm.request([Math.floor((x - r) / 0.1), Math.floor((z - r) / 0.1), Math.ceil((x + r) / 0.1), Math.ceil((z + r) / 0.1)]); }
  function pourColour(job) {
    const top = job.topY, band = (FR.jobView(G.sim.state, job.id).pour || {}).band || 'good', fw = FR.finish(G.sim.state, job.id), sheen = fw ? fw.sheen : 1;
    return (tile, n, i, j, out) => {
      const g = pourMesh.grid, name = g.codes[tile.s[n]], h = tile.h[n] / 1000, x = i * 0.1, z = j * 0.1;
      const lv = FR.screedLevelAt(G.sim.state, job.id, x, z), inside = lv > 0, nz = ((i * 73856093) ^ (j * 19349663)) % 7 / 300;
      // wet concrete is a dark, cool grey; the finish channel is how glossy (the bleed-water sheen of a screeded top)
      let v = 0.34 + nz, f = 0.22;
      if (name === 'screeded') { v = 0.31 + 0.09 * (1 - sheen); f = 0.1 + 0.6 * sheen; }
      else if (name === 'floated') { v = 0.34 + nz * 0.5 + 0.04 * (1 - sheen); f = 0.08 + 0.45 * sheen; }          // an even satin, the sheen over it while it bleeds
      else if (name === 'troweled') { v = 0.31 + nz * 0.3; f = 0.5; }                                           // burnished steel-trowel satin
      else if (name === 'broomed') { v = ((i >> 1) & 1) ? 0.43 : 0.39; f = 0.02; }                                // fine broom lines
      else if (name === 'scaled') { v = 0.5 + nz * 3; f = 0.0; }                                                  // pale, blotchy: water worked into the skin
      else if (inside && h < lv - 0.006) { v = 0.4 + nz; f = 0.05; }                 // a hollow: dull
      else if (inside && h > lv + 0.01) { v = 0.36 + nz; f = 0.15; }                 // standing proud: lumpy
      if (band === 'soupy' || band === 'wet') { v -= 0.03; f = Math.max(f, 0.6 * (name ? sheen : 1)); }
      if (band === 'dry') { v += 0.06; f = Math.min(f, 0.05); }
      if (!inside) { v += 0.03; f = 0.15; }
      out[0] = v; out[1] = v * 0.985; out[2] = v * (0.95 + 0.05 * sheen); out[3] = f;
      return true;
    };
  }
  function pourSync(job) {
    const g = job && (job.step === 'pour' || job.step === 'finish') && job.pour ? job.pour.grid : null;
    if (!g) {
      if (pourMesh.fm) {
        // poured: build mode draws the slab member in its place
        const was = FR.job(G.sim.state, pourMesh.jobId), st = was && was.owner && B.structs().find((q) => q.id === was.owner.structId);
        if (st && CS().progress[st.id]) showBuilt(st, CS().progress[st.id]);
        pourMesh.fm.dispose(); pourMesh.fm = null; pourMesh.grid = null; pourMesh.jobId = null;
      }
      return;
    }
    if (pourMesh.fm && pourMesh.jobId === job.id && pourMesh.grid === g) {
      pourMesh.colour = pourColour(job);
      const w = FR.finish(G.sim.state, job.id), sg = w ? Math.round(w.sheen * 10) + w.phase : '';
      if (sg !== pourMesh.sheenSig) { pourMesh.sheenSig = sg; pourMesh.fm.request(); }      // the sheen thins as the time goes
      return;
    }
    if (pourMesh.fm) pourMesh.fm.dispose();
    const C = job.layout.corners;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of C) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const pad = 0.8, col = pourColour(job);
    pourMesh.grid = g; pourMesh.jobId = job.id; pourMesh.colour = col;
    pourMesh.fm = FM.create({ grid: g, i0: Math.floor((x0 - pad) / 0.1), j0: Math.floor((z0 - pad) / 0.1), i1: Math.ceil((x1 + pad) / 0.1), j1: Math.ceil((z1 + pad) / 0.1), baseY: surf, colour: (t, n, i, j, o) => pourMesh.colour(t, n, i, j, o), minMs: 70 });
    pourMesh.fm.refresh();
  }
  // the bags of mix, stacked by the forms where the mixing is done
  function bagPile(job) {
    const want = job && job.step === 'pour' ? Math.min(12, bagsAvail()) : 0, sig = job ? job.id + ':' + want : '';
    if (sig === fv.bagSig) return;
    fv.bagSig = sig;
    if (fv.bags) { G.scene.remove(fv.bags); fv.bags = null; }
    if (!want) return;
    const r = job.forms && job.forms.runs[0];
    if (!r) return;
    const [x, z] = runPt(r, r.len / 2, 1.1), g = (fv.bags = new T.Group()), bagMat = mat(0xd9cdb2);
    for (let k = 0; k < want; k++) { const m = part(bx(0.45, 0.13, 0.32), bagMat, (k % 3 - 1) * 0.47, surf(x, z) + 0.065 + Math.floor(k / 6) * 0.13, (Math.floor(k / 3) % 2) * 0.34, 0, (k % 2) * 0.08, 0); g.add(m); }
    g.position.set(x, 0, z); g.rotation.y = runYaw(r);
    G.scene.add(g);
  }
  function b34Tick(dt, t) {
    const job = site.job;
    if (on) { heapTick(); ghostTick(H.aim, job); } else if (fv.ghost) fv.ghost.visible = false;
    const sig = formsSig(job);
    if (sig !== fv.sig && !site.drive) { fv.sig = sig; buildForms(job); }
    if (fv.runs.length) placeBoards(job, t / 1000);
    if (fv.dots.length) { const s = 1 + 0.15 * Math.sin(t / 170), hammer = on && held() === 'hammer'; for (const d of fv.dots) { d.scale.set(s, 1, s); d.material.opacity = hammer ? 0.95 : 0.5; } }
    if (pourMesh.fm) pourMesh.fm.update();
    // a leaking board: grey seeps out at its foot
    if (job && job.step === 'pour' && job.forms) for (const r of job.forms.runs) if (r.leak && Math.random() < dt * 3) { const [x, z] = runPt(r, (r.leak[0] + r.leak[1]) / 2, 0.08); G.burst(x, surf(x, z) + 0.03, z, 2, CONC, 0.5, 0.3, 0.03, 0.4); }
  }
  function b34Slow(job) { pourSync(job); bagPile(job); }

  /* ================= B5: finishing, bolts, joints, curing, covers, stripping ================= */
  const KIT = 'concrete_finishing_kit', COVER_ITEM = { blanket: 'curing_blanket', plastic: 'poly_sheeting' }, HOSE = 'garden_hose';
  const STROKE = { bfloat: 'float', trowel: 'trowel', broom: 'broom', edger: 'edge' };
  const FIN_IDS = ['bfloat', 'trowel', 'broom', 'edger', 'groover', 'bolt', 'blanket', 'plastic', 'mist', 'strip'];
  const steelLight = mat(0xb9c2c9), boltMat = mat(0x8b9399), blanketMat = new T.MeshLambertMaterial({ color: 0xb8864b, side: T.DoubleSide }), plasticMat = new T.MeshLambertMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.4, side: T.DoubleSide, depthWrite: false });
  const grooveMat = new T.MeshBasicMaterial({ color: 0x23262a }), dashMat = new T.MeshBasicMaterial({ color: 0xfff2c4, transparent: true, opacity: 0.8, depthWrite: false });
  const bfloatItem = { obj: (() => { const g = new T.Group(); g.add(part(bx(0.024, 1.7, 0.024), handleMat, 0, 0.88, 0), part(bx(0.2, 0.014, 0.62), steelLight, 0, 0.02, 0.1), part(bx(0.04, 0.05, 0.1), steel, 0, 0.06, 0.1)); return g; })(), use: 'tip', still: [0.38, 0.02, 0.24, 0, 0, 0], stillArm: -0.5, walk: [0.3, 1.74, -0.78, 2.15, 0, 0], walkArm: -1.0 };
  const broomItem = { obj: (() => { const g = new T.Group(); g.add(part(bx(0.024, 1.6, 0.024), handleMat, 0, 0.83, 0), part(bx(0.46, 0.05, 0.07), mat(0x6e5a3a), 0, 0.03, 0.04)); return g; })(), use: 'tip', still: [0.38, 0.02, 0.24, 0, 0, 0], stillArm: -0.5, walk: [0.3, 1.74, -0.78, 2.15, 0, 0], walkArm: -1.0 };
  const handTool = (parts) => ({ obj: (() => { const g = new T.Group(); for (const q of parts) g.add(q); return g; })(), use: 'hand', still: [0.3, 0.9, 0.15, 0, 1.5, 0], stillArm: -0.6, walk: [0.3, 1.5, -0.1, 0, 1.5, 1.4], walkArm: -1.2 });
  const trowelItem = handTool([part(bx(0.34, 0.01, 0.12), steelLight, 0, 0, 0), part(bx(0.03, 0.03, 0.1), handleMat, 0, 0.04, 0)]);
  const edgerItem = handTool([part(bx(0.2, 0.01, 0.09), steelLight, 0, 0, 0), part(bx(0.2, 0.025, 0.012), steelLight, 0, 0.012, -0.045), part(bx(0.03, 0.03, 0.08), handleMat, 0, 0.04, 0)]);
  const grooverItem = handTool([part(bx(0.26, 0.012, 0.07), steelLight, 0, 0, 0), part(bx(0.26, 0.03, 0.012), steel, 0, -0.012, 0), part(bx(0.03, 0.03, 0.07), handleMat, 0, 0.04, 0)]);
  const boltItem = handTool([part(new T.CylinderGeometry(0.008, 0.008, 0.26, 8), boltMat, 0, 0, 0), part(bx(0.04, 0.012, 0.04), boltMat, 0, 0.12, 0)]);
  const rollItem = (m) => handTool([part(new T.CylinderGeometry(0.07, 0.07, 0.5, 12), m, 0, 0, 0, 0, 0, Math.PI / 2)]);
  const mistItem = handTool([part(new T.CylinderGeometry(0.02, 0.02, 0.22, 8), mat(0x2f9e5a), 0, 0, 0, 0, 0, Math.PI / 2), part(new T.CylinderGeometry(0.028, 0.012, 0.06, 8), steel, 0.13, 0, 0, 0, 0, Math.PI / 2)]);
  const barItem = handTool([part(bx(0.04, 0.03, 0.5), dark, 0, 0, 0), part(bx(0.04, 0.03, 0.1), dark, 0, 0.02, 0.22, 0.5)]);
  ICONS.bfloat = I('<path d="M6 8l22 14" stroke="#d8b585" stroke-width="2.6"/><path d="M5 30h24l-3-6H8z" fill="#b9c2c9" stroke="#e7ecef"/>');
  ICONS.trowel = I('<path d="M4 24l20-9 6 4-18 11z" fill="#b9c2c9" stroke="#e7ecef"/><path d="M26 12l6-5" stroke="#c9975a" stroke-width="3"/>');
  ICONS.broom = I('<path d="M28 5L14 25" stroke="#d8b585" stroke-width="2.6"/><path d="M6 25l13 8-2 2L4 28z" fill="#8a6f43" stroke="#cdb381"/><path d="M8 29l-2 3M11 31l-2 3M14 33l-2 3" stroke="#cdb381" stroke-width="1.6"/>');
  ICONS.edger = I('<path d="M5 27h22" stroke="#b9c2c9" stroke-width="3"/><path d="M5 27c0-5 4-6 8-6" stroke="#e7ecef" stroke-width="2"/><path d="M24 22l7-9" stroke="#c9975a" stroke-width="3"/>');
  ICONS.groover = I('<path d="M4 28h24" stroke="#b9c2c9" stroke-width="3"/><path d="M8 31h16" stroke="#23262a" stroke-width="2"/><path d="M26 24l6-9" stroke="#c9975a" stroke-width="3"/>');
  ICONS.bolt = I('<path d="M18 5v22c0 4-8 4-8 0" stroke="#aab2b8" stroke-width="3"/><path d="M14 8h8" stroke="#d8dde0" stroke-width="3"/><path d="M5 30h26" stroke="#76736d" stroke-width="3"/>');
  ICONS.blanket = I('<rect x="5" y="12" width="26" height="14" rx="3" fill="#b8864b" stroke="#e3c08a"/><path d="M9 12v14M14 12v14M19 12v14M24 12v14M28 12v14" stroke="#8a6a3a" stroke-width="1.2"/>');
  ICONS.plastic = I('<path d="M4 24l8-10h20l-8 10z" fill="#cfe8ff" fill-opacity=".55" stroke="#e8f4ff"/><path d="M12 14l-4 10M32 14l-8 10" stroke="#fff" stroke-width="1" stroke-opacity=".7"/>');
  ICONS.mist = I('<path d="M5 26h14" stroke="#2f9e5a" stroke-width="3"/><path d="M21 22l8 -3M21 26h9M21 30l8 3" stroke="#6fb8ff" stroke-width="2.2"/><circle cx="32" cy="18" r="1.4" fill="#6fb8ff"/><circle cx="33" cy="26" r="1.4" fill="#6fb8ff"/><circle cx="32" cy="34" r="1.4" fill="#6fb8ff"/>');
  ICONS.strip = I('<path d="M6 30l20-20" stroke="#4a4f55" stroke-width="3"/><path d="M26 10c3 0 5 2 5 5" stroke="#4a4f55" stroke-width="3"/><path d="M6 32h12" stroke="#d2b07a" stroke-width="4"/>');

  const fin = { sig: '', group: null, dots: [], last: null, tool: '', warn: 0, cover: null, coverKind: null, coverJob: null, pop: 1, ov: null, ovJob: null, ovSig: '', mistAcc: 0 };
  const hash2 = (i, j) => (((i * 73856093) ^ (j * 19349663)) >>> 0) % 1000 / 1000;
  const smooth = (a, b, v) => ease((v - a) / (b - a));
  const pctS = (v) => Math.round(v * 100) + '%';
  // ---- the marks on the slab: bolt marks and bolts, the joint lines (dashed to cut, dark when cut)
  function finSync(job, fw) {
    const sig = job && fw ? job.id + ':' + job.step + ':' + fw.bolts.map((b) => b[2]).join('') + ':' + fw.joints.map((l) => l.cells.join('')).join('/') : '';
    if (sig === fin.sig) return;
    fin.sig = sig;
    if (fin.group) { G.scene.remove(fin.group); fin.group = null; }
    fin.dots = [];
    if (!job || !fw || !fw.bolts) return;
    const g = (fin.group = new T.Group()), y = job.topY;
    G.scene.add(g);
    fw.bolts.forEach((b, k) => {
      if (b[2]) {
        const m = part(new T.CylinderGeometry(0.0065, 0.0065, 0.1, 6), boltMat, b[0], y + 0.045, b[1]); g.add(m);
        g.add(part(bx(0.032, 0.008, 0.032), boltMat, b[0], y + 0.09, b[1]));
      } else if (job.step === 'finish' || job.step === 'cure' || job.step === 'strip') {
        const d = new T.Mesh(dotGeo, dotMat); d.position.set(b[0], y + 0.012, b[1]); d.renderOrder = 3; d.userData = { bolt: k }; g.add(d); fin.dots.push(d);
      }
    });
    for (const l of fw.joints) {
      const n = l.cells.length, ux = (l.b[0] - l.a[0]) / l.len, uz = (l.b[1] - l.a[1]) / l.len, cw = l.len / n;
      for (let c = 0; c < n; c++) {
        if (!l.cells[c] && (job.step !== 'finish' || (c & 1))) continue;
        const t = (c + 0.5) * cw, m = new T.Mesh(box, l.cells[c] ? grooveMat : dashMat);
        m.scale.set(cw * (l.cells[c] ? 1.02 : 0.85), 0.004, l.cells[c] ? 0.018 : 0.024); m.rotation.y = -Math.atan2(uz, ux);
        m.position.set(l.a[0] + ux * t, y + (l.cells[c] ? 0.001 : 0.006), l.a[1] + uz * t); m.renderOrder = 3; g.add(m);
      }
    }
  }
  // ---- the cure tint: dark and wet at first, lightening with strength (a thin overlay on the slab member)
  function cureColour(job, fw) {
    return (x, z, out) => {
      if (!inPoly(job.layout.corners, x, z)) return false;
      const s = fw.strength, i = Math.floor(x * 10), j = Math.floor(z * 10), h = hash2(i, j);
      let a = 0.62 * (1 - smooth(0.02, 0.9, s)), r = 0.16, gg = 0.17, b = 0.19;
      if ((fw.wetUntil || 0) > G.sim.state.t) { a += 0.14; b += 0.04; }                           // misted: wet-dark again
      if (fw.dry > 0.2 && h < fw.dry * 0.14) { r = gg = b = 0.92; a = 0.3; }                       // crazing from drying out
      else if (fw.frost > 0.15 && h < fw.frost * 0.25) { r = gg = b = 0.85; a = 0.34; }            // frost-scaled patches
      if (a < 0.015) return false;
      out[0] = r; out[1] = gg; out[2] = b; out[3] = Math.min(0.8, a); return true;
    };
  }
  function cureSync(job, fw) {
    const show = job && fw && ['cure', 'strip', 'done'].includes(job.step) && job.type === 'slab' && fw.strength < 0.97;
    if (!show) { if (fin.ov) { fin.ov.dispose(); fin.ov = null; fin.ovJob = null; fin.ovSig = ''; } return; }
    const sig = job.id + ':' + Math.round(fw.strength * 100) + ':' + Math.round(fw.dry * 10) + ':' + Math.round(fw.frost * 10) + ':' + ((fw.wetUntil || 0) > G.sim.state.t ? 1 : 0);
    if (!fin.ov || fin.ovJob !== job.id) {
      if (fin.ov) fin.ov.dispose();
      const C = job.layout.corners;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of C) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      let cell = 0.1;
      while (((x1 - x0) / cell) * ((z1 - z0) / cell) > 12000) cell *= 1.25;
      const y = job.topY;
      fin.ov = FM.overlay({ x0, z0, nx: Math.ceil((x1 - x0) / cell), nz: Math.ceil((z1 - z0) / cell), cell, yAt: () => y, colourAt: (x, z, o) => fin.colour(x, z, o), lift: 0.006, minMs: 300 });
      fin.ovJob = job.id; fin.ovSig = '';
    }
    if (sig !== fin.ovSig) { fin.ovSig = sig; fin.colour = cureColour(job, fw); fin.ov.refresh(); }
  }
  // ---- the cover rolled over the slab
  function coverSync(job, fw) {
    const kind = job && fw && ['cure', 'strip'].includes(job.step) ? fw.cover : null;
    if (kind === fin.coverKind && (!job || fin.coverJob === job.id)) return;
    if (fin.cover) { G.scene.remove(fin.cover); fin.cover.geometry.dispose(); fin.cover = null; }
    fin.coverKind = kind; fin.coverJob = job ? job.id : null;
    if (!kind) return;
    const C = job.layout.corners, cx = C.reduce((a, c) => a + c[0], 0) / C.length, cz = C.reduce((a, c) => a + c[1], 0) / C.length;
    const sh = new T.Shape(); C.forEach((c, k) => { const x = c[0] - cx, z = -(c[1] - cz); if (k) sh.lineTo(x, z); else sh.moveTo(x, z); });
    const geo = new T.ShapeGeometry(sh); geo.rotateX(-Math.PI / 2);
    const m = new T.Mesh(geo, kind === 'blanket' ? blanketMat : plasticMat);
    m.position.set(cx, job.topY + (kind === 'blanket' ? 0.04 : 0.025), cz); m.scale.set(1.04, 1, 1.04); m.receiveShadow = true; m.renderOrder = 4;
    fin.cover = m; fin.pop = 0; G.scene.add(m);
  }
  // ---- the gate chip: strength against the gates, and what is next
  const chip = document.createElement('div');
  chip.id = 'fgate'; chip.hidden = true; chip.setAttribute('aria-live', 'polite');
  css.textContent += '#fgate{position:fixed;top:62px;left:50%;transform:translateX(-50%);z-index:5;pointer-events:none;padding:6px 12px 7px;border-radius:12px;background:rgba(30,26,20,.78);color:var(--ink);font-size:13px;text-align:center;min-width:250px;max-width:92vw}#fgate[hidden]{display:none}' +
    '#fgate .gt{font-family:var(--font-display);font-size:15px;margin-bottom:3px}#fgate .gb{position:relative;display:block;height:8px;border-radius:5px;background:rgba(255,255,255,.14);margin:2px 0 3px}#fgate .gb i{position:absolute;left:0;top:0;bottom:0;border-radius:5px;background:linear-gradient(90deg,#7ab0c4,#e8e2d0)}' +
    '#fgate .gb u{position:absolute;top:-2px;bottom:-2px;width:2px;background:rgba(255,255,255,.7)}#fgate .gl{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--ink-dim)}#fgate .gl .ok{color:#9be29b}#fgate .gn{margin-top:3px;font-size:12px}';
  document.body.appendChild(chip);
  let chipHtml = '';
  function chipTick(job, fw) {
    let html = '';
    if (job && fw && ['finish', 'cure', 'strip'].includes(job.step)) {
      const v = FR.jobView(G.sim.state, job.id), gt = v.gates, st = Math.round(fw.strength * 100), GATES = [['walk', 10, 'Walk'], ['strip', 20, 'Strip forms'], ['frame', 50, 'Frame']];
      const marks = GATES.map(([k, pc]) => '<u style="left:' + Math.min(100, pc * 100 / 50) + '%"></u>').join('');
      const labs = GATES.map(([k, pc, nm]) => '<span class="' + (gt[k] ? 'ok' : '') + '">' + (gt[k] ? '✓ ' : '') + nm + ' ' + pc + '%</span>').join('');
      let next = '';
      if (job.step === 'finish') next = fw.phase === 'bleeding' ? 'Bleed water on top: float, then wait for the sheen to go' : fw.phase === 'ready' ? '<b>Sheen gone:</b> trowel or broom it now, about ' + Math.max(1, Math.round(fw.leftH)) + ' h of working time left' : 'Setting up';
      else if (fw.boltsLeft && !gt.frame) next = 'Anchor bolts still to set: ' + fw.boltsLeft;
      else if (!gt.strip) next = 'Cure: ' + (fw.cover ? fw.cover + ' on' : 'cover it or mist it');
      else if (fw.unstripped) next = '<b>Strip the forms</b> (' + fw.unstripped + ' boards)';
      else if (fw.boltsLeft) next = 'Set the anchor bolts: framing waits for them';
      else if (!gt.frame) next = 'Frame at 50%: still green';
      else next = 'Ready for framing';
      html = '<div class="gt">Slab ' + st + '%</div><span class="gb"><i style="width:' + Math.min(100, st * 2) + '%"></i>' + marks + '</span><div class="gl">' + labs + '</div><div class="gn">' + next + '</div>';
    }
    if (html !== chipHtml) { chipHtml = html; chip.innerHTML = html; chip.hidden = !html; }
  }
  // ---- gestures
  const finSay = (job, r, kind) => {
    if (!r.ok) return say(r.reason + (/finishing kit/.test(r.reason) ? buyBtn(KIT, 1, 'Buy the kit') : ''), 5);
    if (r.early) { if (performance.now() - fin.warn > 2500) { fin.warn = performance.now(); say('<b>Too soon:</b> the bleed water is still on top and you are working it into the skin. Pale blotches will scale. Float, then wait for the sheen to go.', 5); } return; }
    if (r.unfloated) { if (performance.now() - fin.warn > 3000) { fin.warn = performance.now(); say(r.unfloated, 4); } return; }
  };
  function strokeTo(a, job, tool) {
    const kind = STROKE[tool], L = fin.last ? Math.hypot(a.x - fin.last[0], a.z - fin.last[1]) : 1;
    if (L < 0.1) return;
    const n = Math.max(1, Math.ceil(L / 0.18));
    let any = false, lastR = null;
    for (let k = 1; k <= n; k++) {
      const x = fin.last[0] + ((a.x - fin.last[0]) * k) / n, z = fin.last[1] + ((a.z - fin.last[1]) * k) / n;
      const r = cmd('finishAt', { jobId: job.id, x, z, kind });
      lastR = r;
      if (!r.ok) break;
      if (r.n > 0) { any = true; pourDirty(x, z, FINR[kind] + 0.2); }
      if (r.done) break;
    }
    fin.last = [a.x, a.z];
    if (!lastR) return;
    finSay(job, lastR, kind);
    if (any) {
      G.cam.shake = Math.min((G.cam.shake || 0) + 0.003, 0.05);
      if (Math.random() < 0.5) G.burst(a.x, job.topY + 0.03, a.z, 1, kind === 'broom' ? 0x8a8780 : 0x6c6a65, 0.5, 0.4, 0.03, 0.3);
    }
    if (lastR.done) finishedOut(job);
  }
  const FINR = { float: 0.5, trowel: 0.3, broom: 0.35, edge: 0.18 };
  function finishedOut(job) {
    G.juice.hitStop = 0.1; G.cam.shake = Math.min((G.cam.shake || 0) + 0.1, 0.3);
    const C = job.layout.corners;
    for (const c of C) G.burst(c[0], job.topY + 0.2, c[1], 8, 0xfff2c4, 1.5, 2.2, 0.06, 0.9);
    say('<b>Finished.</b> Floated, ' + (FR.finish(G.sim.state, job.id) && FR.finish(G.sim.state, job.id).cov && FR.finish(G.sim.state, job.id).cov.broom > 0.5 ? 'broomed' : 'troweled') + ', bolted down. It cures now: cover it or mist it, and strip the forms at a fifth of its strength.', 9);
    setTimeout(() => { if (on) { H.setSlots(slotList()); H.hold && H.hold(['blanket', 'plastic'].find((k) => ownsTool(COVER_ITEM[k])) || 'mist'); } }, 260);
  }
  function groovePress(a, job) { fin.last = [a.x, a.z]; const fw = FR.finish(G.sim.state, job.id); if (!fw || !fw.joints.length) say('This slab is small enough to need no control joints.', 4); else say('Drag the groover along a dashed line: it cuts a joint a quarter of the slab deep.', 4); }
  function grooveFrame(a, job) {
    lead(a);
    if (!fin.last || Math.hypot(a.x - fin.last[0], a.z - fin.last[1]) < 0.15) return;
    const r = cmd('joint', { jobId: job.id, x0: fin.last[0], z0: fin.last[1], x1: a.x, z1: a.z });
    fin.last = [a.x, a.z];
    if (!r.ok) return say(r.reason + (/finishing kit/.test(r.reason) ? buyBtn(KIT, 1, 'Buy the kit') : ''), 5);
    if (r.n > 0) { G.burst(a.x, job.topY + 0.02, a.z, 2, 0x6c6a65, 0.5, 0.4, 0.03, 0.3); fin.sig = ''; if (r.done) finishedOut(job); else say('Joint: ' + (r.cut ? r.cut.map(pctS).join(' · ') : ''), 2); }
    else if (r.reason) say(r.reason, 2);
  }
  function boltAt(a) {
    let best = null, bd = 0.5;
    for (const d of fin.dots) { const x = d.position.x, z = d.position.z, dh = Math.min(Math.hypot(x - a.x, z - a.z), a.gx != null ? Math.hypot(x - a.gx, z - a.gz) : Infinity); if (dh < bd && Math.hypot(x - G.player.x, z - G.player.z) < 2.6) { bd = dh; best = d; } }
    return best;
  }
  function boltPress(a, job) {
    const d = boltAt(a);
    if (!d) return say(fin.dots.length ? 'Aim at a glowing bolt mark along the sill line.' : 'Every bolt is in.');
    const r = cmd('setBolt', { jobId: job.id, x: d.position.x, z: d.position.z, n: gestureN() });
    if (!r.ok) return say(r.reason + (/anchor bolts/.test(r.reason) ? buyBtn('anchor_bolt', Math.max(4, fin.dots.length), 'Buy ' + Math.max(4, fin.dots.length)) : ''), 6);
    G.juice.hitStop = 0.05; G.cam.shake = Math.min((G.cam.shake || 0) + 0.025, 0.2);
    G.burst(d.position.x, job.topY + 0.05, d.position.z, 5, 0x9aa2a8, 0.9, 1.4, 0.03, 0.4);
    fin.sig = '';
    if (r.done) return finishedOut(job);
    say(r.left ? (r.retro ? 'Drilled and epoxied one in (it has set). ' : 'Pushed in ' + r.n + '. ') + r.left + ' to go.' : '<b>Every bolt is in.</b> Framing can bolt down to the slab.', 4);
  }
  function coverPress(kind, job) {
    const fw = FR.finish(G.sim.state, job.id), want = fw && fw.cover === kind ? null : kind;
    const r = cmd('cover', { jobId: job.id, kind: want });
    if (!r.ok) return say(r.reason + (/blanket|sheeting/.test(r.reason) ? buyBtn(COVER_ITEM[kind], 1) : ''), 6);
    G.juice.hitStop = 0.04; fin.coverKind = '?'; fin.ovSig = '';
    say(want ? (kind === 'blanket' ? '<b>Blanket on.</b> It holds the moisture and the heat in: good for a cold night.' : '<b>Plastic on.</b> It holds the moisture in so the top cannot dry out.') : 'Cover off.', 5);
  }
  function mistPress(a, job) {
    const r = cmd('mist', { jobId: job.id });
    if (!r.ok) return say(r.reason + (/hose/.test(r.reason) ? buyBtn(HOSE, 1) : ''), 6);
    fin.mistAcc = 0; fin.sig = ''; fin.ovSig = '';
    say('<b>Misting.</b> The top stays wet for half an hour: it cannot dry out in the sun or wind.', 5);
  }
  function mistFrame(a, dt, job) {
    fin.mistAcc += dt;
    if (fin.mistAcc > 0.06) { fin.mistAcc = 0; G.burst(a.x + (Math.random() - 0.5) * 0.5, job.topY + 0.25, a.z + (Math.random() - 0.5) * 0.5, 2, 0x9fd0ff, 0.5, 0.2, 0.025, 0.4); }
  }
  function stripPress(a, job) {
    const fw = FR.finish(G.sim.state, job.id);
    const r = cmd('strip', { jobId: job.id, x: a.gx ?? a.x, z: a.gz ?? a.z, n: gestureN() });
    if (!r.ok) return say(r.reason, 5);
    const run = FR.job(G.sim.state, job.id).forms.runs[r.run];
    const [x, z] = runPt(run, run.len / 2, 0.15);
    G.juice.hitStop = 0.07; G.cam.shake = Math.min((G.cam.shake || 0) + 0.05, 0.25);
    G.burst(x, job.topY - 0.05, z, 14, 0xd2b07a, 1.8, 2, 0.05, 0.7);
    fv.sig = '';
    say(r.all ? '<b>Forms off.</b> The slab stands alone, boards and stakes back in your stock.' + (fw && fw.boltsLeft ? ' Set the anchor bolts so framing can start.' : '') : 'Boards off' + (r.stakes ? ' with ' + r.stakes + ' stakes' : '') + (r.chipped ? ' (the unedged corner chipped)' : '') + '. ' + r.left + ' to go.', 5);
  }
  function finPress(a, job, id) {
    act.kind = id; fin.last = [a.x, a.z]; fin.warn = 0;
    if (STROKE[id]) {
      if (job.step !== 'finish') return say('The top is past finishing.');
      fin.last = [a.x - 0.2, a.z]; return strokeTo(a, job, id);
    }
    if (id === 'groover') return job.step === 'finish' ? groovePress(a, job) : say('Joints are cut while the top is workable.');
    if (id === 'bolt') return boltPress(a, job);
    if (id === 'blanket' || id === 'plastic') return coverPress(id, job);
    if (id === 'mist') return mistPress(a, job);
    if (id === 'strip') return stripPress(a, job);
  }
  function finFrame(a, dt, job) {
    const id = act.kind;
    if (STROKE[id]) { lead(a); if (job.step === 'finish') strokeTo(a, job, id); } else if (id === 'groover') grooveFrame(a, job); else if (id === 'mist') mistFrame(a, dt, job);
  }
  // each frame: the sheen, the marks, the tint and the cover
  function finSlow(job) {
    const fw = job ? FR.finish(G.sim.state, job.id) : null;
    finSync(job, fw); cureSync(job, fw); coverSync(job, fw); chipTick(job, fw);
    if (fin.ov && fin.ov.visible) fin.ov.update();
  }
  function finTick(dt, t) {
    if (fin.dots.length) { const s = 1 + 0.15 * Math.sin(t / 170), on2 = on && held() === 'bolt'; for (const d of fin.dots) { d.scale.set(s, 1, s); d.material.opacity = on2 ? 0.95 : 0.5; } }
    if (fin.cover && fin.pop < 1) { fin.pop = Math.min(1, fin.pop + dt * 4); const k = ease(fin.pop); fin.cover.scale.set(1.04 * (0.2 + 0.8 * k), 1, 1.04 * (0.2 + 0.8 * k)); }
  }

  /* ================= press, drag, let go ================= */
  const held = () => H.held;
  function press(a) {
    const job = site.job, id = held();
    if (job && FIN_IDS.includes(id)) return finPress(a, job, id);
    if (job && ['gravel', 'barrow', 'rake', 'tamper', 'board', 'hammer', 'screed'].includes(id)) {
      act.kind = id; b3.lx = a.x; b3.lz = a.z; b3.n = 0; b3.tipped = false; b3.warned = 0; b3.why = ''; b3.acc = 0; b4.rx = a.x; b4.rz = a.z; b4.leakSaid = 0;
      const pour = job.step === 'pour';
      if (id === 'gravel') return gravelPress(a, job);
      if (id === 'barrow') return pour ? mixPress(a, job) : undefined;
      if (id === 'rake') { if (pour) { const r = cmd('rake', { jobId: job.id, x: a.x, z: a.z }); if (r.ok) pourDirty(a.x, a.z, 1.4); return; } return; }
      if (id === 'tamper') { const why = needTool('tamper', 'a hand tamper'); if (why) { act.kind = ''; return say(why, 5); } return thump(a); }
      if (id === 'board') return setBoards(job);
      if (id === 'hammer') { if (site.drive) return; const d = stakeAt(a, job); if (d) startStake(job, d); else say(fv.dots.length ? 'Aim at a glowing stake mark outside a board.' : 'Every stake is in.'); return; }
      if (id === 'screed') return pour ? screedPress(a, job) : say('The screed comes out once concrete is in the forms.');
    }
    if (id === 'kit') {
      act.kind = 'kit';
      if (!job) return say('Nothing to lay out here. Put up a building with a slab, stem wall or pier foundation (<kbd>L</kbd>).');
      if (job.step !== 'layout') return say(job.step === 'excavate' ? 'Laid out. Dig with the shovel (2) until the amber is gone.' : 'This one is laid out.');
      if (site.drive) return;
      const k = cornerAt(a, job);
      if (k >= 0) startDrive(job, k);
      else say(site.order.length ? 'Pull the string to the next glowing corner (keep holding: you walk after your hand).' : 'Press on a glowing corner to drive the first stake.');
      return;
    }
    if (id === 'shovel') {
      if (!LS()) return;
      if (!ownsTool('shovel') && !ownsTool('spade')) return say('You need a shovel (the Yard store, key 6).');
      if (a.alt && job && job.step === 'excavate' && digAt(a.x, a.z)) {
        const v = FR.jobView(G.sim.state, job.id);
        if (v.rough >= v.trimFrom) { act.kind = 'trim'; trimPress(a, job); return; }
        if (performance.now() - act.warned > 4000) { act.warned = performance.now(); say('Trim to the line once most of the dark amber is gone (' + Math.round(v.rough * 100) + '% dug roughly). For now, dig with the blade.'); }
      }
      act.kind = 'shovel';
      LS().bindSay(say);
      LS().tools.shovel.press(a);
    }
  }
  function frame(a, dt) {
    if (!a.down) return;
    const job = site.job, k0 = act.kind;
    if (job && FIN_IDS.includes(k0)) return finFrame(a, dt, job);
    if (job && k0 === 'gravel') return gravelFrame(a, job);
    if (job && k0 === 'barrow') return job.step === 'pour' ? mixFrame(a, dt, job) : barrowTipBase(a);
    if (job && k0 === 'rake') return job.step === 'pour' ? rakeConcreteFrame(a, job) : rakeBaseFrame(a, job);
    if (job && k0 === 'tamper') { lead(a); b3.acc += dt; if (b3.acc >= 0.3) { b3.acc = 0; thump(a); } return; }
    if (job && k0 === 'screed') return screedFrame(a, dt, job);
    if (['board', 'hammer'].includes(k0)) return;
    if (act.kind === 'kit') {
      const job = site.job;
      if (!job || job.step !== 'layout') return;
      lead(a);
      if (!site.drive && site.order.length) { const k = cornerAt(a, job); if (k >= 0) startDrive(job, k); }
    } else if (act.kind === 'trim') trimFrame(a);
    else if (act.kind === 'shovel' && LS()) LS().tools.shovel.frame(a, dt);
  }
  function release(a) {
    const k = act.kind;
    act.kind = '';
    G.player.lead = null;
    if (FIN_IDS.includes(k)) { fin.last = null; return; }
    if (k === 'barrow' && site.job && site.job.step !== 'pour') return barrowRelease(a);
    if (k === 'barrow') { b4.hose = false; return; }
    if (k === 'screed') { b4.scr = null; screedMesh.visible = false; return; }
    if (k === 'gravel' && b3.n > 1) return say('Tipped ' + Math.round(b3.m3 * 1000) + ' L along your line. Rake it level to the strings, then tamp it twice.', 5);
    if (k === 'trim') { const t = act.trim; act.trim = null; if (t && t.m3 > 0.0005) say('Trimmed ' + Math.round(t.m3 * 1000) + ' L to the line, pushed out past the edge.', 3); return; }
    if (k === 'shovel' && LS()) LS().tools.shovel.release(a);
  }

  /* ================= taking up the site tools, and putting them away ================= */
  let on = false, lastHeld = 'kit';
  function slotList() {
    const step = site.job ? site.job.step : 'layout', own = (id) => tools().includes(id);
    if (step === 'base') return [
      { id: 'gravel', name: 'Gravel', icon: ICONS.gravel, item: truckFlag, title: 'Gravel: press and drag along the pad; the truck tips as you guide it' },
      { id: 'barrow', name: 'Barrow', icon: ICONS.barrow, item: barrow, dim: !own('wheelbarrow'), title: 'Wheelbarrow: click to shovel a scoop in, drag down to tip it' },
      { id: 'rake', name: 'Rake', icon: ICONS.rake, item: rake, dim: !own('rake'), meter: site.job.base ? site.job.base.level : 0, title: 'Rake: drag to pull the gravel to the line under the strings' },
      { id: 'tamper', name: 'Tamper', icon: ICONS.tamper, item: tamper, dim: !own('tamper'), meter: site.job.base ? site.job.base.compact : 0, title: 'Tamper: click to thump, hold and walk to tamp a strip. Twice everywhere is firm' },
      ...(LS() ? [{ id: 'shovel', name: 'Shovel', icon: ICONS.shovel, item: LS().items.shovel, dim: !ownsTool('shovel') && !ownsTool('spade'), title: 'Shovel: move gravel by hand' }] : []),
    ];
    if (step === 'forms' || step === 'rebar' || step === 'roughin') return [
      { id: 'board', name: 'Boards', icon: ICONS.board, item: boardItem, badge: String(Math.floor(stockItems().form_board || 0)), title: 'Form boards: hold one near a string, it snaps along the run; click sets ' + gestureN() },
      { id: 'hammer', name: 'Stakes', icon: ICONS.hammer, item: kit, badge: String(Math.floor(stockItems().form_stake || 0)), title: 'Hammer and stakes: click a glowing mark outside a board to drive a stake and nail it' },
    ];
    if (step === 'pour') {
      const c = FR.carry(G.sim.state);
      return [
        { id: 'barrow', name: 'Barrow', icon: ICONS.barrow, item: barrow, dim: !own('wheelbarrow'), badge: c.vol ? Math.round(c.vol * 1000) + ' L' : null, meter: c.vol ? c.mixed : null, title: 'Barrow: drag up to slash bags in, hold the right button to run water, drag side to side to hoe, drag down at the forms to tip' },
        { id: 'rake', name: 'Rake', icon: ICONS.rake, item: rake, title: 'Rake: drag through the wet concrete to spread it into the corners' },
        { id: 'screed', name: 'Screed', icon: ICONS.screed, item: screedItem, meter: site.job.pour ? site.job.pour.screed : 0, title: 'Screed: drag the board toward you along the forms' },
        { id: 'hammer', name: 'Stakes', icon: ICONS.hammer, item: kit, title: 'Hammer and stakes: stake a form that bows out' },
      ];
    }
    if (step === 'finish' || step === 'cure' || step === 'strip') {
      const fw = site.job ? FR.finish(G.sim.state, site.job.id) : null, kit = own(KIT), bolts = fw ? fw.boltsLeft : 0;
      const bolt = { id: 'bolt', name: 'Bolts', icon: ICONS.bolt, item: boltItem, badge: bolts ? String(bolts) : null, dim: !bolts, title: 'Anchor bolts: press a glowing mark along the sill line; they go in while the concrete is wet' };
      if (step === 'finish') {
        const cv = (fw && fw.cov) || { float: 0, trowel: 0, broom: 0 };
        return [
          { id: 'bfloat', name: 'Float', icon: ICONS.bfloat, item: bfloatItem, dim: !kit, meter: cv.float, title: 'Bull float: sweep it over the screeded top right away; evens it out and brings the water up' },
          { id: 'trowel', name: 'Trowel', icon: ICONS.trowel, item: trowelItem, dim: !kit, meter: cv.trowel, title: 'Steel trowel: only once the sheen has gone. A smooth, hard top for indoors' },
          { id: 'broom', name: 'Broom', icon: ICONS.broom, item: broomItem, dim: !kit, meter: cv.broom, title: 'Broom: only once the sheen has gone. A gripping top for outdoors' },
          { id: 'edger', name: 'Edger', icon: ICONS.edger, item: edgerItem, dim: !kit, title: 'Edger: run it along a form to round the edge so it does not chip' },
          { id: 'groover', name: 'Joints', icon: ICONS.groover, item: grooverItem, dim: !kit || !(fw && fw.joints.length), title: 'Groover: drag along the dashed lines (slabs over 3 m)' },
          bolt,
        ];
      }
      const cover = fw && fw.cover;
      return [
        { id: 'blanket', name: 'Blanket', icon: ICONS.blanket, item: rollItem(blanketMat), dim: !own(COVER_ITEM.blanket), badge: cover === 'blanket' ? 'on' : null, title: 'Curing blanket: holds moisture and heat in (press again to take it off)' },
        { id: 'plastic', name: 'Plastic', icon: ICONS.plastic, item: rollItem(plasticMat), dim: !own(COVER_ITEM.plastic), badge: cover === 'plastic' ? 'on' : null, title: 'Plastic sheeting: holds moisture in (press again to take it off)' },
        { id: 'mist', name: 'Mist', icon: ICONS.mist, item: mistItem, dim: !own(HOSE), title: 'Hose on a fine mist: keeps the top wet for half an hour (not in frost)' },
        { id: 'strip', name: 'Strip', icon: ICONS.strip, item: barItem, badge: fw && fw.unstripped ? String(fw.unstripped) : null, dim: !(fw && fw.unstripped), title: 'Pry the forms off: a side at a time, once the concrete is a fifth strength' },
        ...(bolts ? [bolt] : []),
      ];
    }
    const out = [{ id: 'kit', name: 'Layout', icon: ICONS.kit, item: kit, title: 'Layout kit: press a glowing corner to drive a stake, keep holding and pull to the next corner' }];
    if (LS()) {
      const v = site.job ? FR.jobView(G.sim.state, site.job.id) : null;
      out.push({ id: 'shovel', name: 'Shovel', icon: ICONS.shovel, item: LS().items.shovel, dim: !ownsTool('shovel') && !ownsTool('spade'), meter: v && site.job.step === 'excavate' ? (v.rough + v.dig) / 2 : null, title: 'Shovel: press to dig a scoop, drag it out of the way. Right-drag trims to the line once most of it is dug' });
    }
    return out;
  }
  function enter() {
    on = true; document.body.classList.add('gardening'); bar.hidden = false;
    const j = site.job;
    H.open({ bar: toolsEl, reach: 1.6, camDist: 8.5, camPitch: 0.95, camFree: true, pace: 0.55, tipPx: 90, liftPx: 70, slots: slotList(), held: j ? ({ excavate: 'shovel', base: 'gravel', forms: 'board', pour: 'barrow', finish: 'bfloat', cure: 'blanket', strip: 'strip' }[j.step] || lastHeld) : lastHeld, onHold, press, frame, release, alt: (cur) => !!cur && (cur.id === 'shovel' || (cur.id === 'barrow' && !!site.job && site.job.step === 'pour')) });
    onHold(held());
  }
  function leave() {
    lastHeld = held() || lastHeld;
    if (LS()) LS().bindSay(null);
    on = false; bar.hidden = true; tape.visible = false; G.player.lead = null;
    if (!['garden', 'yard'].includes(G.player.tool)) document.body.classList.remove('gardening');
    if (H.isOpen && H.held && H.slots.some((s) => ['kit', 'gravel', 'board', 'screed', 'bfloat', 'blanket', 'strip'].includes(s.id))) H.close();
    screedMesh.visible = false; if (fv.ghost) fv.ghost.visible = false;
  }
  function onHold() { sayT = 0; updateHint(true); }
  function updateHint(force) {
    if (sayT > 0 && !force) return;
    const job = site.job, id = held();
    let h;
    if (!job) h = 'No foundation to lay out here. Put up a building with a <b>slab</b>, <b>stem wall</b> or <b>poured piers</b> in construction mode (<kbd>L</kbd>), then come back.';
    else if (job.step === 'layout') {
      const C = job.layout.corners, n = C.filter((c) => c[2]).length;
      h = id === 'kit' ? (n ? '<b>' + n + ' of ' + C.length + '</b> corners staked. Hold the button and pull to the next glowing corner: each corner your hand reaches gets its stake.' : '<b>Press</b> a glowing corner: a stake goes in. <b>Keep holding</b> and pull toward the next corner: you walk after your hand and the string pays out.') : 'Lay out the corners first: take up the <b>layout kit</b> (1).';
    } else if (job.step === 'excavate') {
      const v = FR.jobView(G.sim.state, job.id), pct = Math.round(v.dig * 100);
      h = id === 'shovel' ? (v.rough >= v.trimFrom ? '<b>' + pct + '%</b> on the line. <b>Right-drag</b> the flat of the shovel across the yellow: it trims to the line and pushes the earth out past the edge.' : '<b>' + Math.round(v.rough * 100) + '%</b> dug. <b>Press</b> in the dark amber to dig a scoop, <b>drag</b> it out past the white line. Yellow is close enough to trim later.') : 'Dig to the strings: take up the <b>shovel</b> (2).';
      if (id === 'shovel' && tape.visible && tape.userData.cm != null) h += ' <b>Here: ' + (tape.userData.cm > 0 ? tape.userData.cm + ' cm to go' : tape.userData.cm < -4 ? Math.abs(tape.userData.cm) + ' cm too deep' : 'on the line') + '</b>';
    } else if (job.step === 'base') {
      const v = FR.jobView(G.sim.state, job.id), b = v.base, pc = (x) => Math.round(x * 100) + '%';
      const line = 'Base: gravel <b>' + pc(b.gravel) + '</b> · level <b>' + pc(b.level) + '</b> · tamped <b>' + pc(b.compact) + '</b>. ';
      h = line + (id === 'gravel' ? '<b>Press and drag</b> along the pad: the truck tips gravel as you guide it.'
        : id === 'rake' ? (needTool('rake', 'a rake') || '<b>Drag</b> to pull the gravel to the line: amber wants more, blue stands proud.')
        : id === 'tamper' ? (needTool('tamper', 'a hand tamper') || '<b>Click</b> to thump, <b>hold and walk</b> to tamp a strip. Twice everywhere: the dots go when it is firm.')
        : id === 'barrow' ? (needTool('wheelbarrow', 'a wheelbarrow') || '<b>Click</b> on a heap to shovel a scoop in, <b>drag down</b> to tip it where it is low.')
        : 'Move gravel by hand: press to scoop, drag to throw.');
    } else if (job.step === 'forms' || job.step === 'rebar' || job.step === 'roughin') {
      const v = FR.jobView(G.sim.state, job.id), f = v.forms || { boards: 0, set: 0, stakes: 0, driven: 0 }, need = f.boards - f.set, have = Math.floor(stockItems().form_board || 0), hs = Math.floor(stockItems().form_stake || 0);
      h = 'Forms: <b>' + f.set + ' of ' + f.boards + '</b> boards · <b>' + f.driven + ' of ' + f.stakes + '</b> stakes. ';
      if (id === 'board') h += need > 0 ? (have >= need ? 'Hold a board near a string: it snaps along the run. <b>Click</b> to set ' + gestureN() + '.' : 'You have ' + have + ' form boards and need ' + need + '.' + buyBtn('form_board', need - have)) : 'Boards all set. Take up the <b>stakes</b>.';
      else h += f.stakes - f.driven > 0 ? (hs >= f.stakes - f.driven ? '<b>Click</b> a glowing mark outside a board: a stake goes in and is nailed to it (' + gestureN() + ' at a time).' : 'You have ' + hs + ' stakes and need ' + (f.stakes - f.driven) + '.' + buyBtn('form_stake', f.stakes - f.driven - hs)) : 'Every stake is in.';
    } else if (job.step === 'pour') {
      const v = FR.jobView(G.sim.state, job.id), p = v.pour, pct = p ? Math.round((p.m3 / Math.max(1e-6, p.needM3)) * 100) : 0, bags = bagsAvail();
      h = (v.forms && v.forms.leaking ? '<b>A form is bowing and leaking: stake it (4)!</b> ' : '') + 'Pour: <b>' + pct + '%</b> in' + (p && p.screed ? ' · screeded <b>' + Math.round(p.screed * 100) + '%</b>' : '') + ' · ' + bags + ' bags on site. ';
      if (id === 'barrow') h += (needTool('wheelbarrow', 'a wheelbarrow') || '<b>Drag up</b>: slash ' + gestureN() + ' bag' + (gestureN() > 1 ? 's' : '') + ' in. <b>Hold right</b>: hose water in. <b>Drag side to side</b>: hoe. <b>Drag down</b> at the forms: tip.') + (bags ? '' : buyBtn('concrete_mix', 36 * 6, 'Buy 6 bags')) + mixMeter();
      else if (id === 'rake') h += '<b>Drag</b> through it to push it into the corners and even it out.';
      else if (id === 'screed') h += pct < 95 ? 'Get a little more than enough in first, then screed.' : 'Stand at one end and <b>drag the board toward you</b>, sawing a little. The surplus rolls ahead of it.';
      else h += 'Stake a bowing form: click its glowing marks.';
    } else if (job.step === 'finish') {
      const fw = FR.finish(G.sim.state, job.id), cv = (fw && fw.cov) || { float: 0, worked: 0 };
      const state = !fw ? '' : fw.phase === 'bleeding' ? 'Bleed water is on top: <b>float</b> it, then wait for the sheen to go. ' : fw.phase === 'ready' ? '<b>The sheen is gone:</b> trowel or broom it now. ' : 'It has set. ';
      const todo = [];
      if (fw && cv.float < 0.9) todo.push('float');
      if (fw && cv.worked < 0.9) todo.push('trowel or broom');
      if (fw && fw.joints.some((l) => l.cells.some((c) => !c))) todo.push('joints');
      if (fw && fw.boltsLeft) todo.push('bolts (' + fw.boltsLeft + ')');
      h = state + 'Float <b>' + pctS(cv.float) + '</b> · worked <b>' + pctS(cv.worked) + '</b>' + (todo.length ? ' · still to do: ' + todo.join(', ') : '') + '. ';
      const kitWhy = needTool(KIT, 'the finishing kit');
      if (kitWhy && ['bfloat', 'trowel', 'broom', 'edger', 'groover'].includes(id)) h += kitWhy;
      else if (id === 'bfloat') h += '<b>Drag</b> the float over the top, overlapping your passes.';
      else if (id === 'trowel') h += fw && fw.phase === 'bleeding' ? 'Not yet! Troweling now scales the skin.' : '<b>Drag</b> in broad arcs over the floated top.';
      else if (id === 'broom') h += fw && fw.phase === 'bleeding' ? 'Not yet! Brooming now scales the skin.' : '<b>Drag</b> straight across the floated top, one pass at a time.';
      else if (id === 'edger') h += '<b>Drag</b> along inside a form to round the edge.';
      else if (id === 'groover') h += fw && fw.joints.length ? '<b>Drag</b> along each dashed line.' : 'No joints needed on a slab this size.';
      else if (id === 'bolt') h += fin.dots.length ? '<b>Click</b> a glowing mark along the sill line: a bolt goes in (' + gestureN() + ' at a time).' : 'Every bolt is in.';
    } else if (job.step === 'cure' || job.step === 'strip') {
      const fw = FR.finish(G.sim.state, job.id), st = fw ? Math.round(fw.strength * 100) : 0;
      h = 'Curing <b>' + st + '%</b>' + (fw && fw.cover ? ' · ' + fw.cover + ' on' : '') + (fw && fw.wetUntil > G.sim.state.t ? ' · misted' : '') + '. ';
      if (id === 'blanket') h += needTool(COVER_ITEM.blanket, 'a curing blanket') || '<b>Click</b> to roll it over the slab (again to take it off): it keeps the heat in on a cold night.';
      else if (id === 'plastic') h += needTool(COVER_ITEM.plastic, 'polyethylene sheeting') || '<b>Click</b> to lay it over the slab: it stops the top drying out.';
      else if (id === 'mist') h += needTool(HOSE, 'a garden hose') || '<b>Click</b> to mist the top: wet for half an hour. Do it in hot, dry wind.';
      else if (id === 'strip') h += fw && fw.unstripped ? (fw.strength >= 0.2 ? '<b>Click</b> a side: its boards and stakes come off.' : 'The forms stay on until it is a fifth strength (' + st + '%).') : 'The forms are off.';
      else if (id === 'bolt') h += fin.dots.length ? '<b>Click</b> a bolt mark: it is drilled and epoxied in now that it has set.' : 'Every bolt is in.';
    } else h = STEP_LINE[job.step] || 'The foundation is past digging.';
    if (h !== hintEl.innerHTML) hintEl.innerHTML = h;
  }
  const STEP_LINE = {
    base: 'Dug to the line. The gravel base goes in next (slab foundations; stem walls and piers are poured with <b>__foundation.debugPour()</b> for now).',
    done: 'The foundation is finished.',
  };
  addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (G.player.tool === 'build') return;
    if (e.code === 'Digit7' && !e.repeat && !H.isOpen) { G.setTool('site'); e.preventDefault(); }
    else if (on && e.code === 'Escape') G.setTool('axe');
  }, true);

  /* ================= every frame (cheap) ================= */
  let last = performance.now(), slow = 0, syncT = 0;
  function tapeTick() {
    const a = H.aim, job = site.job;
    const d = on && held() === 'shovel' && job && job.step === 'excavate' && a.valid && !act.trim ? digAt(a.x, a.z) : null;
    tape.visible = !!d;
    if (!d) { tape.userData.cm = null; return; }
    const top = cornerY(job, a.x, a.z) + 0.0, g = surf(a.x, a.z), len = Math.max(0.05, top - d.targetY);
    tape.position.set(a.x + 0.12, top, a.z);
    tape.children[0].scale.y = len; tape.children[0].position.y = -len / 2;
    tape.children[1].position.y = -len;
    tape.userData.cm = Math.round((g - d.targetY) * 100);
  }
  function tick(t) {
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    const want = G.player.tool === 'site';
    if (want !== on) { if (want) enter(); else leave(); }
    driveTick(dt); popTick(dt); b34Tick(dt, t); finTick(dt, t);
    if (site.strings.visible) {
      if (on && held() === 'kit' && site.job && site.job.step === 'layout' && site.order.length) site.strings.hand(handPt()); else if (site.job && site.job.step === 'layout') site.strings.hand(null);
      site.strings.update(dt);
    }
    if (site.ghosts.length) { const s = 1 + 0.12 * Math.sin(t / 180); for (const gh of site.ghosts) if (gh) gh.children[1].scale.set(s, 1, s); }
    if (on) tapeTick();
    if (sayT > 0) { sayT -= dt; if (sayT <= 0) updateHint(true); }
    syncT += dt;
    if (syncT > 0.5) { syncT = 0; syncJobs(); }
    slow += dt;
    if (slow > 0.2) {
      slow = 0;
      const job = nearJob(), fresh = job ? FR.job(G.sim.state, job.id) : null;
      site.job = fresh;
      const sig = jobSig(fresh);
      if (sig !== site.sig && !site.drive) { site.sig = sig; buildSite(fresh); if (site.closeAt && performance.now() - site.closeAt < 1500) site.pop = 0; }
      const os = fresh ? fresh.id + ':' + JSON.stringify(fresh.digs || []).length + ':' + (fresh.digs || []).map((d) => d.targetY).join(',') : '';
      if (os !== site.ovSig) { site.ovSig = os; buildOverlay(fresh); }
      if (site.ov) {
        const P = G.player, C = fresh.layout.corners, near = Math.hypot(C[0][0] - P.x, C[0][1] - P.z) < 40;
        site.ov.visible = near && ['layout', 'excavate', 'base'].includes(fresh.step);
        const gs = (LS() ? LS().rev : 0) + ':' + G.ground.rev + ':' + fresh.step;
        if (gs !== site.groundSig) {
          site.groundSig = gs; site.ov.request();
          if (fresh.step === 'excavate' || fresh.step === 'base' || fresh.step === 'forms') site.checkDue = true;
        }
        site.ov.update();
      }
      if (site.checkDue && fresh && ['excavate', 'base'].includes(fresh.step) && !(LS() && LS().flying)) {
        site.checkT += 0.2;
        if (site.checkT > 0.4) {
          site.checkT = 0; site.checkDue = false;
          const step0 = fresh.step, r = cmd('check', { jobId: fresh.id });
          if (r.ok && r.advanced) { if (step0 === 'excavate') dugOut(fresh); else baseIn(fresh); }
        }
      }
      b34Slow(fresh); finSlow(fresh);
      if (on) { H.setSlots(slotList()); updateHint(); }
    }
    requestAnimationFrame(tick);
  }
  function baseIn(job) {
    G.juice.hitStop = 0.08;
    for (const c of job.layout.corners) G.burst(c[0], surf(c[0], c[1]) + 0.2, c[1], 8, 0xfff2c4, 1.4, 2.2, 0.06, 0.8);
    say('<b>The base is firm and level.</b> Now the forms: hold a <b>form board</b> near a string and it snaps along the run.', 7);
    const st = B.structs().find((s) => s.id === (job.owner && job.owner.structId)), pr = st && CS().progress[st.id];
    if (st && pr) showBuilt(st, pr);
    if (on) { H.setSlots(slotList()); H.hold && H.hold('board'); }
  }
  function dugOut(job) {
    G.juice.hitStop = 0.08;
    const C = job.layout.corners;
    for (const c of C) G.burst(c[0], surf(c[0], c[1]) + 0.2, c[1], 8, 0xfff2c4, 1.4, 2.2, 0.06, 0.8);
    say('<b>Dug to the line.</b> Flat and down to firm ground. Now the gravel base: take up <b>gravel</b> and drag along the pad.', 7);
    if (on) { setTimeout(() => { H.setSlots(slotList()); H.hold && H.hold('gravel'); }, 50); }
    const st = B.structs().find((s) => s.id === (job.owner && job.owner.structId)), pr = st && CS().progress[st.id];
    if (st && pr) showBuilt(st, pr);
  }
  G.sim.listen((type) => { if (type === 'loaded') { sent.clear(); site.sig = ''; site.ovSig = ''; site.order = []; site.drive = null; } });
  requestAnimationFrame(tick);

  window.__foundation = {
    // whether this building's ground and foundation are built by hand here (build mode then does not level it)
    owns: (structId) => !!jobFor(structId),
    // the line the construction view shows for this building while its site and foundation are this view's
    hint(structId) {
      const j = jobFor(structId);
      if (!j) return null;
      if (j.step === 'layout') return 'Lay out the foundation: press <kbd>7</kbd> for the layout kit. Press a glowing corner and pull the string round the others.';
      if (j.step === 'excavate') return 'Dig to the strings: press <kbd>7</kbd> and dig where the ground is amber (' + Math.round(FR.jobView(G.sim.state, j.id).dig * 100) + '% down to the line).';
      if (j.step === 'base') return j.type === 'slab' ? 'The gravel base: press <kbd>7</kbd>, tip gravel on the pad, rake it to the line and tamp it twice.' : 'Dug to the line. Stem walls and piers are not poured by hand yet: <code>__foundation.debugPour()</code> pours it for testing.';
      if (['forms', 'rebar', 'roughin'].includes(j.step)) return 'Set the forms: press <kbd>7</kbd>, snap form boards along the strings and stake them.';
      if (j.step === 'pour') return 'Pour the slab: press <kbd>7</kbd>, mix bags in the barrow, tip, rake and screed it off the forms.';
      if (j.step === 'finish') return 'Finish the slab: press <kbd>7</kbd>: float it, trowel or broom it once the sheen is gone, joints and anchor bolts.';
      if (j.step === 'cure' || j.step === 'strip') { const f = FR.finish(G.sim.state, j.id); return f && f.boltsLeft ? 'Set the anchor bolts (press <kbd>7</kbd>): framing waits for them.' : f && f.unstripped ? 'Curing: cover or mist it, and strip the forms at a fifth strength (press <kbd>7</kbd>).' : null; }
      return null;
    },
    job: (structId) => (structId === undefined ? site.job : jobFor(structId)),
    redraw: () => { site.sig = ''; site.ovSig = ''; },
    tools: { kit },
    // for tests: what is drawn
    drawn: () => ({ overlay: !!(site.ov && site.ov.visible), tinted: site.ov ? (() => { const c = site.ov.mesh.geometry.attributes.color.array; let n = 0; for (let i = 3; i < c.length; i += 16) if (c[i] > 0) n++; return n; })() : 0, strands: site.strings.visible ? site.strings.mesh.count : 0, boards: site.boards.filter(Boolean).length, stakes: site.stakes.filter(Boolean).length, ghosts: site.ghosts.filter(Boolean).length, boardsDrawn: fv.runs.reduce((a, r) => a + r.segs.length, 0), stakeMarks: fv.dots.length, pour: !!(pourMesh.fm && pourMesh.fm.visible), bags: fv.bags ? fv.bags.children.length : 0, boltMarks: fin.dots.length, finishMarks: fin.group ? fin.group.children.length : 0, cureTint: fin.ov ? (() => { const c = fin.ov.mesh.geometry.attributes.color.array; let n = 0; for (let i = 3; i < c.length; i += 16) if (c[i] > 0) n++; return n; })() : 0, cover: fin.cover ? fin.coverKind : null, chip: chip.hidden ? '' : chip.innerText }),
    // testing: the nearest job (or a building's) is poured now and starts to cure
    debugPour(structId) {
      const j = structId === undefined ? site.job || nearJob() : jobFor(structId);
      if (!j) return { ok: false, reason: 'no foundation job' };
      const r = cmd('debugPour', { jobId: j.id });
      const st = j.owner && B.structs().find((s) => s.id === j.owner.structId);
      if (r.ok && st) showBuilt(st, CS().progress[st.id]);
      return r;
    },
  };
})();
