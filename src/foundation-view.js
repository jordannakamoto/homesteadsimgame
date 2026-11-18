/* Foundation view (slice B2 of the ground-foundations design): a poured foundation built by hand.
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
      if (local.length >= 3 && slab) digs.push({ poly: local.map(([x, z]) => XZ(x, z)), targetY: Math.min(bottom(slab), bed ? bottom(bed) : Infinity) });
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
      const d = Math.hypot(cx - P.x, cz - P.z) - (['layout', 'excavate'].includes(j.step) ? 0 : 20);
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  }

  /* ================= the bar ================= */
  const css = document.createElement('style');
  css.textContent = '#fbar{position:fixed;bottom:92px;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100vw - 20px);display:flex;flex-direction:column;gap:6px;padding:8px 10px;z-index:6}#fbar[hidden]{display:none}' +
    '#fbar .gtools{display:flex;gap:6px;justify-content:center}#fbar .hslot{position:relative;display:flex;flex-direction:column;align-items:center;gap:1px;width:70px;padding:7px 2px 6px;border-radius:12px;background:rgba(255,248,228,.06);border-width:2px;transition:transform .12s}' +
    '#fbar .hslot svg{width:36px;height:36px}#fbar .hslot .nm{font-family:var(--font-display);font-size:14px;white-space:nowrap}#fbar .hslot .key{position:absolute;left:5px;top:3px;font-size:11px;font-weight:700;color:var(--ink-dim)}' +
    '#fbar .hslot .bdg{position:absolute;right:4px;top:3px;font-size:10px;color:var(--ink-dim)}#fbar .hslot.dim svg,#fbar .hslot.dim .nm{opacity:.45}#fbar .hslot[aria-pressed="true"]{border-color:var(--accent);background:rgba(226,182,90,.22);transform:translateY(-5px) scale(1.06)}' +
    '#fbar .hslot .mtr{display:block;width:46px;height:5px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden}#fbar .hslot .mtr i{display:block;height:100%;background:linear-gradient(90deg,#e0a020,#ffd23a)}' +
    '#fbar .ghint{text-align:center;font-size:15px;color:var(--ink);min-height:20px;max-width:640px;margin:0 auto;line-height:1.35}#fbar .ghint b{color:var(--accent)}';
  document.head.appendChild(css);
  const bar = document.createElement('div');
  bar.id = 'fbar'; bar.className = 'panel'; bar.hidden = true; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Site');
  bar.innerHTML = '<div class="ghint" aria-live="polite"></div><div class="gtools"></div>';
  document.body.appendChild(bar);
  const hintEl = bar.querySelector('.ghint'), toolsEl = bar.querySelector('.gtools');
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
    kit: I('<path d="M7 30V12M29 30V12" stroke="#c8a36a" stroke-width="3"/><path d="M4 13h28" stroke="#c8a36a" stroke-width="3"/><path d="M7 16L29 16" stroke="#ff4fa3" stroke-width="1.6"/><path d="M15 9l6-5 2 2-6 5z" fill="#9aa4ab"/><path d="M18 8l-4 4" stroke="#8a6a40" stroke-width="2"/>'),
    shovel: I('<path d="M27 5l-9 17" stroke="#d8b585" stroke-width="2.6"/><path d="M24 4l6 3" stroke="#3a3a3a" stroke-width="3"/><path d="M15 20l7 4-3 9c-1 2-4 2-6 1s-3-3-2-5z" fill="#9aa4ab" stroke="#cfd6dc"/><path d="M6 34c4-3 9-3 14-1" stroke="#ffb020" stroke-width="2"/>'),
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

  /* ================= press, drag, let go ================= */
  const held = () => H.held;
  function press(a) {
    const job = site.job, id = held();
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
    if (k === 'trim') { const t = act.trim; act.trim = null; if (t && t.m3 > 0.0005) say('Trimmed ' + Math.round(t.m3 * 1000) + ' L to the line, pushed out past the edge.', 3); return; }
    if (k === 'shovel' && LS()) LS().tools.shovel.release(a);
  }

  /* ================= taking up the site tools, and putting them away ================= */
  let on = false, lastHeld = 'kit';
  function slotList() {
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
    H.open({ bar: toolsEl, reach: 1.6, camDist: 8.5, camPitch: 0.95, camFree: true, pace: 0.55, tipPx: 90, liftPx: 70, slots: slotList(), held: j && j.step === 'excavate' ? 'shovel' : lastHeld, onHold, press, frame, release, alt: (cur) => !!cur && cur.id === 'shovel' });
    onHold(held());
  }
  function leave() {
    lastHeld = held() || lastHeld;
    if (LS()) LS().bindSay(null);
    on = false; bar.hidden = true; tape.visible = false; G.player.lead = null;
    if (!['garden', 'yard'].includes(G.player.tool)) document.body.classList.remove('gardening');
    if (H.isOpen && H.held && ['kit', 'shovel'].includes(H.held) && H.slots.some((s) => s.id === 'kit')) H.close();
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
    } else h = STEP_LINE[job.step] || 'The foundation is past digging.';
    if (h !== hintEl.innerHTML) hintEl.innerHTML = h;
  }
  const STEP_LINE = {
    base: 'Dug to the line. The gravel base, forms and the pour come next (not in the game yet: <b>__foundation.debugPour()</b> in the console pours it for testing).',
    cure: 'Poured: the concrete is curing.', strip: 'Poured: the concrete is curing.', done: 'The foundation is finished.',
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
    driveTick(dt); popTick(dt);
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
        site.ov.visible = near && ['layout', 'excavate'].includes(fresh.step);
        const gs = (LS() ? LS().rev : 0) + ':' + G.ground.rev + ':' + fresh.step;
        if (gs !== site.groundSig) {
          site.groundSig = gs; site.ov.request();
          if (fresh.step === 'excavate') site.checkDue = true;
        }
        site.ov.update();
      }
      if (site.checkDue && fresh && fresh.step === 'excavate' && !(LS() && LS().flying)) {
        site.checkT += 0.2;
        if (site.checkT > 0.4) {
          site.checkT = 0; site.checkDue = false;
          const r = cmd('check', { jobId: fresh.id });
          if (r.ok && r.advanced) dugOut(fresh);
        }
      }
      if (on) { H.setSlots(slotList()); updateHint(); }
    }
    requestAnimationFrame(tick);
  }
  function dugOut(job) {
    G.juice.hitStop = 0.08;
    const C = job.layout.corners;
    for (const c of C) G.burst(c[0], surf(c[0], c[1]) + 0.2, c[1], 8, 0xfff2c4, 1.4, 2.2, 0.06, 0.8);
    say('<b>Dug to the line.</b> Flat and down to firm ground: the site is ready for its gravel base.', 7);
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
      if (j.step === 'base') return 'Dug to the line. The base, forms and pour are not in the game yet: <code>__foundation.debugPour()</code> pours it for testing.';
      return null;
    },
    job: (structId) => (structId === undefined ? site.job : jobFor(structId)),
    redraw: () => { site.sig = ''; site.ovSig = ''; },
    tools: { kit },
    // for tests: what is drawn
    drawn: () => ({ overlay: !!(site.ov && site.ov.visible), tinted: site.ov ? (() => { const c = site.ov.mesh.geometry.attributes.color.array; let n = 0; for (let i = 3; i < c.length; i += 16) if (c[i] > 0) n++; return n; })() : 0, strands: site.strings.visible ? site.strings.mesh.count : 0, boards: site.boards.filter(Boolean).length, stakes: site.stakes.filter(Boolean).length, ghosts: site.ghosts.filter(Boolean).length }),
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
