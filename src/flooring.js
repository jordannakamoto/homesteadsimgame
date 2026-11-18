/* Finished floors as an installer lays them: given a room's floor, its walls and the floor chosen in Plan mode, this lists
   every piece that goes down, in order, with its real size and place, and what it is bought as (docs/FLOORING.md).
     nail-down boards   rosin paper, then rows of boards from the start wall, blind-nailed through the tongue, ends staggered
     floating plank     foam (none under vinyl), then click boards: angle in, drop, tap tight; a row's cut-off starts the next
     tile               cement board on a wood subfloor, tiles laid out from the middle so the cuts at the walls are even,
                        set in thinset and beaten in, then grout floated into the joints and the haze sponged off
     carpet             tack strip round the walls, pad, then carpet unrolled and kicked tight onto the strip
     every floor        baseboard round the walls over the expansion gap, a threshold under each door
   Every piece is a member like the framing's (src/framing.js calls this for each floor), stage "flooring". Rows are
   `course`s with a `row`, laid from the start wall out; `pts` are where the hands fasten it (nails, screws, staples, taps,
   kicks, sponge wipes); `out` is the way a piece sits proud while it is loose; `tone` its own shade.
   Pure arithmetic: no DOM, no three.js. The page reads it as window.__flooring; tests read globalThis.__flooring. */
(() => {
  // how each floor goes down. w: board or tile width across the rows; l: tile length along them; lens: board lengths in
  // the carton; t: thickness; joint: grout joint; gap: the expansion gap left at every wall. item: [itemId, unit] it is
  // bought as; col: the colour the pieces are drawn in (FLOOR_COLORS); vary: how much one piece's shade differs.
  const FLOORINGS = {
    planks: { how: "nail", name: "Pine floorboards", w: 0.14, t: 0.019, lens: [2.4, 3.0, 3.6], gap: 0.012, under: "rosin", item: ["board_pine_1x6", "m"], col: "flPine", vary: 0.12 },
    dark: { how: "nail", name: "Oak floorboards", w: 0.14, t: 0.019, lens: [1.8, 2.4, 3.0], gap: 0.012, under: "rosin", item: ["board_oak_1x6", "m"], col: "flOakDark", vary: 0.12 },
    hardwood: { how: "nail", name: "Oak strip", w: 0.083, t: 0.019, lens: [0.45, 0.6, 0.75, 0.9, 1.2, 1.5, 1.8, 2.1], gap: 0.012, under: "rosin", item: ["floor_oak_strip", "m2"], col: "flOak", vary: 0.14 },
    engineered: { how: "click", name: "Engineered oak", w: 0.19, t: 0.014, lens: [1.9], gap: 0.01, under: "foam", item: ["floor_engineered", "m2"], col: "flEng", vary: 0.1 },
    laminate: { how: "click", name: "Laminate", w: 0.195, t: 0.008, lens: [1.38], gap: 0.01, under: "foam", item: ["floor_laminate", "m2"], col: "flLam", vary: 0.07 },
    lvp: { how: "click", name: "Vinyl plank", w: 0.18, t: 0.006, lens: [1.22], gap: 0.008, under: null, item: ["floor_lvp", "m2"], col: "flLvp", vary: 0.06 },
    tile: { how: "tile", name: "Terracotta tile", w: 0.3, l: 0.3, t: 0.012, joint: 0.006, gap: 0.004, item: ["tile_terracotta", "m2"], col: "flTerra", grout: "flGroutDark", vary: 0.09 },
    porcelain: { how: "tile", name: "Porcelain tile", w: 0.6, l: 0.6, t: 0.01, joint: 0.003, gap: 0.004, item: ["tile_porcelain", "m2"], col: "flPorc", grout: "flGroutLight", vary: 0.025 },
    marble: { how: "tile", name: "Marble tile", w: 0.3, l: 0.3, t: 0.01, joint: 0.002, gap: 0.004, item: ["tile_marble", "m2"], col: "flMarble", grout: "flGroutLight", vary: 0.04 },
    carpet: { how: "carpet", name: "Carpet", t: 0.012, roll: 3.66, item: ["carpet_cut", "m2"], col: "flCarpetRed", vary: 0.012 },
    berber: { how: "carpet", name: "Berber carpet", t: 0.01, roll: 3.66, item: ["carpet_berber", "m2"], col: "flBerber", vary: 0.012 },
  };
  // what goes under: roll width, how much each strip laps the one before, thickness drawn, colour, the item
  const UNDER = {
    rosin: { name: "Rosin paper", w: 0.91, lap: 0.05, t: 0.0008, col: "flRosin", item: "underlay_rosin", mat: "rosin_paper", why: "Red building paper under a nailed floor: the boards do not squeak on the subfloor, and less draught comes up between them." },
    foam: { name: "Foam underlayment", w: 1.0, lap: 0, t: 0.002, col: "flFoam", item: "underlay_foam", mat: "pe_foam", why: "A floating floor is not fixed down: it rides on this soft layer, which evens out the subfloor and quiets footsteps." },
    poly: { name: "Vapour barrier", w: 3.0, lap: 0.2, t: 0.0004, col: "flPoly", item: "vapour_barrier", mat: "poly_vapour_barrier", why: "On concrete, a plastic sheet under a wood floor stops damp coming up into it." },
    pad: { name: "Carpet pad", w: 1.83, lap: 0, t: 0.011, col: "flPad", item: "carpet_pad", mat: "rebond_foam", why: "Bonded foam under the carpet: softer underfoot, warmer, and the carpet lasts far longer." },
  };
  // the colours pieces are drawn in while and after they go down (build mode's member colours)
  const FLOOR_COLORS = {
    flPine: 0xb99063, flOakDark: 0x6e4c30, flOak: 0xb4864f, flEng: 0x9c7348, flLam: 0xb59c7c, flLvp: 0x958a7a,
    flTerra: 0xb0613f, flPorc: 0xcfcbc2, flMarble: 0xe2dfd8, flGroutDark: 0x6a645e, flGroutLight: 0xb3aea4,
    flCarpetRed: 0x8a2e2b, flBerber: 0xc4b89e, flPad: 0x7f8ea3, flRosin: 0xb4513a, flFoam: 0xcfdde4, flPoly: 0xe6ecee,
    flBacker: 0x969895, flTack: 0x9b7b4f, flThresh: 0xb4864f,
  };
  const BACKER = { w: 0.915, l: 1.525, t: 0.0127, area: 0.915 * 1.525 };
  const SEAM = 0,               // rows butt tight: each board reads by its own shade (a hairline gap aliases into dots)
    MINP = 0.2,                 // no end piece of a board shorter than this
    STAG = 0.15,                // end joints at least this far from the joints in the row before
    KERF = 0.003,
    BASE = { h: 0.089, t: 0.012, max: 3.6 },
    TACK = { w: 0.025, t: 0.007, piece: 1.22, off: 0.008 };
  const r3 = (v) => Math.round(v * 1000) / 1000,
    hyp = Math.hypot;
  const lays = (mat) => !!FLOORINGS[mat];
  // a fixed, well-spread number in [0, 1) for a piece: the same every time the floor is generated
  const hash = (a, b, c = 0) => { const v = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return v - Math.floor(v); };

  /* ---------- the room: the floor's outline drawn in to the faces of the walls that stand on it ---------- */
  const signedArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  // walls: [{ a: [x, z], b: [x, z], half, gaps: [{ s0, s1, door }] }] (gaps measured from a). Returns the room outline and,
  // for each of its edges, whether a wall stands along it and where the doorways are on it (metres from its first corner).
  // an outline drawn on the grid has a corner at every cell; a wall's run is one straight side, so points in a line go
  const straighten = (outline) => {
    let pts = outline.slice();
    for (let changed = true; changed && pts.length > 3; ) {
      changed = false;
      for (let i = 0; i < pts.length && pts.length > 3; i++) {
        const a = pts[(i + pts.length - 1) % pts.length], p = pts[i], b = pts[(i + 1) % pts.length];
        const cr = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]), dt = (p[0] - a[0]) * (b[0] - p[0]) + (p[1] - a[1]) * (b[1] - p[1]);
        if ((Math.abs(cr) < 1e-6 && dt > 0) || Math.hypot(p[0] - a[0], p[1] - a[1]) < 1e-6) { pts.splice(i, 1); changed = true; i--; }
      }
    }
    return pts;
  };
  function roomOf(outline, walls = []) {
    const pts = straighten(outline), n = pts.length, sg = signedArea(pts) >= 0 ? 1 : -1, info = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], L = hyp(q[0] - p[0], q[1] - p[1]) || 1, u = [(q[0] - p[0]) / L, (q[1] - p[1]) / L], nIn = sg > 0 ? [-u[1], u[0]] : [u[1], -u[0]];
      let d = 0, gaps = [], opens = [], cover = 0, h = 0;
      for (const w of walls) {
        const WL = hyp(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1, wu = [(w.b[0] - w.a[0]) / WL, (w.b[1] - w.a[1]) / WL];
        if (Math.abs(u[0] * wu[1] - u[1] * wu[0]) > 0.02) continue;                        // not parallel
        const off = (x) => Math.abs((x[0] - w.a[0]) * wu[1] - (x[1] - w.a[1]) * wu[0]);
        if (off(p) > 0.06 || off(q) > 0.06) continue;                                          // not on the same line
        const t0 = (w.a[0] - p[0]) * u[0] + (w.a[1] - p[1]) * u[1], t1 = (w.b[0] - p[0]) * u[0] + (w.b[1] - p[1]) * u[1],
          lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(L, Math.max(t0, t1));
        if (hi - lo < 0.05) continue;
        cover += hi - lo;
        d = Math.max(d, w.half || 0);
        h = Math.max(h, w.h || 0);
        const dir = t1 >= t0 ? 1 : -1, map = (g) => { const a = t0 + dir * g.s0, b = t0 + dir * g.s1; return { ...g, s0: Math.max(0, Math.min(a, b)), s1: Math.min(L, Math.max(a, b)) }; };
        for (const g of w.gaps || []) gaps.push({ ...map(g), door: !!g.door });
        for (const g of w.opens || []) opens.push(map(g));
      }
      const walled = cover > 0.3 * L;
      info.push({ walled, d: walled ? d : 0, gaps: walled ? gaps.filter((g) => g.s1 - g.s0 > 0.05) : [], opens: walled ? opens : [], h, u, nIn });
    }
    // each edge moved in to the face of its wall; a corner is where two moved edges meet
    const room = [];
    for (let i = 0; i < n; i++) {
      const j = (i + n - 1) % n, A = info[j], Bq = info[i], pa = pts[j], pb = pts[i];
      const P0 = [pa[0] + A.nIn[0] * A.d, pa[1] + A.nIn[1] * A.d], P1 = [pb[0] + Bq.nIn[0] * Bq.d, pb[1] + Bq.nIn[1] * Bq.d];
      const den = A.u[0] * Bq.u[1] - A.u[1] * Bq.u[0];
      if (Math.abs(den) < 1e-6) { room.push(P1); continue; }
      const t = ((P1[0] - P0[0]) * Bq.u[1] - (P1[1] - P0[1]) * Bq.u[0]) / den;
      room.push([P0[0] + A.u[0] * t, P0[1] + A.u[1] * t]);
    }
    // the gaps measured from the moved edge's own corner
    const edges = room.map((p, i) => {
      const q = room[(i + 1) % n], L = hyp(q[0] - p[0], q[1] - p[1]), o = pts[i], s = (p[0] - o[0]) * info[i].u[0] + (p[1] - o[1]) * info[i].u[1];
      const shift = (g) => ({ ...g, s0: Math.max(0, g.s0 - s), s1: Math.min(L, g.s1 - s) });
      return { p, q, L, u: info[i].u, nIn: info[i].nIn, walled: info[i].walled, h: info[i].h, gaps: info[i].gaps.map(shift).filter((g) => g.s1 - g.s0 > 0.05), opens: info[i].opens.map(shift).filter((g) => g.s1 - g.s0 > 0.05) };
    });
    return { room, edges };
  }
  // where a line across the room (b = v, in the floor's own a/b frame) is inside it: [[a0, a1], ...]
  function crossA(poly, v) {
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const p = poly[i], q = poly[j];
      if (p[1] > v !== q[1] > v) xs.push(p[0] + ((v - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
    }
    xs.sort((a, b) => a - b);
    const out = [];
    for (let k = 0; k + 1 < xs.length; k += 2) xs[k + 1] - xs[k] > 0.02 && out.push([xs[k], xs[k + 1]]);
    return out;
  }
  const meet = (A, Bq) => { const out = []; for (const a of A) for (const b of Bq) { const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]); hi - lo > 0.02 && out.push([lo, hi]); } return out; };
  // inside the room over the whole band from v0 to v1, not only along its middle
  const band = (poly, v0, v1) => meet(meet(crossA(poly, v0 + 0.002), crossA(poly, (v0 + v1) / 2)), crossA(poly, v1 - 0.002));
  // rows from lo to hi, each `w` wide (the last ripped to what is left; a last row under 0.4 of a width is shared with the first)
  function rowsOf(lo, hi, w, balance = true) {
    const total = hi - lo, n = Math.max(1, Math.ceil(total / w - 1e-6)), last = total - (n - 1) * w, out = [];
    let ws = Array(n).fill(w);
    ws[n - 1] = last;
    if (balance && n > 2 && last < 0.4 * w) { const e = (last + w) / 2; ws[0] = e; ws[n - 1] = e; }
    let v = lo;
    for (const x of ws) { out.push([v, v + x]); v += x; }
    return out;
  }
  // a grid line through the middle of the room, or half a tile off it: whichever leaves the bigger cut tiles at the walls
  function gridOrigin(lo, hi, pitch) {
    const c = (lo + hi) / 2, edge = (o) => { const f = ((((lo - o) / pitch) % 1) + 1) % 1; return f < 1e-6 ? pitch : pitch * (1 - f); };
    return edge(c) >= edge(c + pitch / 2) ? c : c + pitch / 2;
  }

  /* ---------- the pieces ---------- */
  // f: the floor ({ id, outline, y0, mat, walls }); g: { M, longX, top (the subfloor's top above y0), base: "wood" | "slab" | "plinth" }
  function members(out, f, g) {
    const spec = FLOORINGS[f.mat];
    if (!spec || !f.outline || f.outline.length < 3) return;
    const { M, longX } = g, y = f.y0 || 0, base = g.base || "wood";
    const { room, edges } = roomOf(f.outline, f.walls || []);
    // the floor's own frame: a along its long side (boards run that way, across the joists), b across it
    const ab = (p) => (longX ? [p[0], p[1]] : [p[1], p[0]]),
      P = (a, yy, b) => (longX ? [a, y + yy, b] : [b, y + yy, a]),
      dirA = longX ? [1, 0, 0] : [0, 0, 1],
      dirB = longX ? [0, 0, 1] : [1, 0, 0],
      R = room.map(ab);
    let rb0 = 1e9, rb1 = -1e9, ra0 = 1e9, ra1 = -1e9;
    for (const p of R) ((ra0 = Math.min(ra0, p[0])), (ra1 = Math.max(ra1, p[0])), (rb0 = Math.min(rb0, p[1])), (rb1 = Math.max(rb1, p[1])));
    if (rb1 - rb0 < 0.1 || ra1 - ra0 < 0.1) return;
    let n = 0;
    // ids carry the floor's type: a floor changed to another in the plan is a new floor, its pieces never taken for the old ones
    const id = (c) => f.id + "." + c + "_" + f.mat + n++,
      top0 = g.top,
      col = spec.col;
    // a long strip of something on a roll: unrolled along a, from s0 to s1, across the band v0..v1
    const roll = (code, kind, type, material, U, v0, v1, s0, s1, lift, row, extra) => {
      const th = U.t, yy = top0 + lift + th / 2, area = (s1 - s0) * (v1 - v0);
      const pts = [];
      for (const v of [v0 + 0.04, v1 - 0.04]) for (let a = s0 + 0.25; a < s1 - 0.1; a += 0.9) pts.push(P(a, top0 + lift + th + 0.003, v));
      return M(out, id(code), kind, type, "flooring", f.id, material, th, s1 - s0, P((s0 + s1) / 2, yy, v0), P((s0 + s1) / 2, yy, v1), dirA,
        { area: r3(area), thickness: th, col: U.col, roll: 1, out: [0, 1, 0], course: true, row, pts, tone: hash(row, s0, 3), vary: 0.02, ...extra });
    };
    // a chalk line snapped across the room where the leading edge of a row will lie
    const chalk = (v, lift) => { const s = crossA(R, v); return s.length ? [P(s[0][0] + 0.03, lift + 0.0015, v), P(s[s.length - 1][1] - 0.03, lift + 0.0015, v)] : null; };
    let finish = top0;                        // the top of the finished floor, for the baseboard

    if (spec.how === "nail" || spec.how === "click") {
      // what goes under, rolled out from the start wall
      const under = spec.how === "nail" ? (base === "wood" ? "rosin" : "poly") : spec.under;
      let lift = 0;
      if (under) {
        const U = UNDER[under];
        rowsOf(rb0, rb1, U.w - U.lap, false).forEach(([v0, v1], row) => {
          const vb = Math.min(rb1, v1 + U.lap);
          for (const [s0, s1] of band(R, v0, vb)) roll("fu", "underlay", under, U.mat, U, v0, vb, s0, s1, row * 0.0003, row);
        });
        lift = UNDER[under].t + 0.003;
      }
      // the boards, row by row from the start wall: each row starts with what was cut off the end of the row before when it
      // is long enough, so end joints walk across the floor and never line up
      const W = spec.w, gap = spec.gap, t = spec.t, lo = rb0 + gap, hi = rb1 - gap, yy = top0 + lift + t / 2;
      let carry = null, prev = [];
      rowsOf(lo, hi, W).forEach(([v0, v1], row) => {
        const vm = (v0 + v1) / 2, joints = [], cl = chalk(v1, top0 + lift), start = carry;
        carry = null;
        band(R, v0, v1).forEach(([a0, a1], seg) => {
          const s0 = a0 + gap, s1 = a1 - gap;
          let pos = s0, k = 0;
          while (pos < s1 - 0.02) {
            let stock, from = "new";
            if (k === 0 && seg === 0 && start && start >= MINP) { stock = start; from = "offcut"; }
            else stock = spec.lens[Math.floor(hash(row, k, 11) * spec.lens.length) % spec.lens.length];
            // the board as it comes, or cut a little shorter: its end joint must fall at least STAG from every joint in the row
            // before, and must not leave an end piece shorter than MINP at the wall
            const ok = (L) => { const e = pos + L; return e >= s1 - 1e-6 || (s1 - e >= MINP && prev.every((x) => Math.abs(x - e) >= STAG)); };
            const tryLen = (st) => [0, 1.6, 0.8, 2.4, 3.2, 4.0].map((q) => st - q * STAG).find((x) => x >= MINP - 1e-9 && ok(x));
            let L = tryLen(stock);
            // that board will not do here: another from the carton (a cut-off that will not fit goes back on the pile)
            if (L === undefined) for (let q = 1; q <= spec.lens.length && L === undefined; q++) { const st = spec.lens[(Math.floor(hash(row, k, 11) * spec.lens.length) + q) % spec.lens.length]; const x = tryLen(st); if (x !== undefined) { stock = st; from = "new"; L = x; } }
            if (L === undefined) L = stock;
            let cut = L < stock - 1e-6 ? "short" : null, off = 0;
            if (pos + L > s1 + 1e-6) { off = pos + L - s1 - KERF; L = s1 - pos; cut = "end"; carry = off >= MINP ? r3(off) : null; }
            const a = pos, b = pos + L, wd = v1 - v0 - SEAM, pts = [];
            // blind nails through the tongue on the leading edge every 0.3 m (the first row is face-nailed by the wall too);
            // a click board is tapped tight along its long edge
            if (spec.how === "nail") {
              const per = Math.max(1, Math.round((L - 0.1) / 0.3));
              for (let i = 0; i < per; i++) pts.push(P(a + 0.05 + ((L - 0.1) * (i + 0.5)) / per, top0 + lift + t + 0.003, v1 - 0.008));
              if (row === 0) for (let i = 0; i < per; i++) pts.push(P(a + 0.05 + ((L - 0.1) * (i + 0.5)) / per, top0 + lift + t + 0.003, v0 + 0.015));
            } else for (const fr of L > 0.7 ? [0.28, 0.72] : [0.5]) pts.push(P(a + L * fr, top0 + lift + t + 0.003, v1 - 0.01));
            M(out, id("fb"), "plank", spec.how, "flooring", f.id, f.mat, t, wd, P(a, yy, vm), P(b, yy, vm), dirB, {
              area: r3(L * (v1 - v0)), thickness: t, col, course: true, row, tone: hash(row, k, seg + 1), vary: spec.vary, pts, cl,
              out: [dirB[0] * 0.55, 0.83, dirB[2] * 0.55], cut: cut && L < stock - 1e-3 ? r3(stock) : 0, cutTo: r3(L), from, first: row === 0,
            });
            joints.push(b);
            pos = b; k++;
          }
        });
        prev = joints;
      });
      finish = top0 + lift + t;
    } else if (spec.how === "tile") {
      // on a wood subfloor, cement board first: sheets screwed down with their joints staggered (a slab takes tile direct)
      let lift = 0;
      if (base === "wood") {
        const th = BACKER.t, yy = top0 + th / 2;
        rowsOf(rb0 + 0.003, rb1 - 0.003, BACKER.w, false).forEach(([v0, v1], row) => {
          for (const [a0, a1] of band(R, v0, v1))
            for (let u = a0 + 0.003 - (row % 2 ? BACKER.l / 2 : 0); u < a1 - 0.01; u += BACKER.l) {
              const ua = Math.max(a0 + 0.003, u), ub = Math.min(a1 - 0.003, u + BACKER.l);
              if (ub - ua < 0.05) continue;
              const pts = [];
              for (const fa of [0.15, 0.5, 0.85]) for (const fb of [0.2, 0.8]) pts.push(P(ua + (ub - ua) * fa, top0 + th + 0.003, v0 + (v1 - v0) * fb));
              M(out, id("fk"), "backer", "cement-board", "flooring", f.id, "cement_board", th, v1 - v0 - 0.003, P(ua, yy, (v0 + v1) / 2), P(ub, yy, (v0 + v1) / 2), dirB,
                { area: r3((ub - ua) * (v1 - v0)), thickness: th, col: "flBacker", course: true, row, pts, tone: hash(row, u, 5), vary: 0.03, out: [0, 1, 0] });
            }
        });
        lift = BACKER.t;
      }
      // the grid is set out from the middle of the room, so the tiles cut at the walls come out even on both sides
      const tw = spec.w, tl = spec.l, j = spec.joint, t = spec.t, gap = spec.gap, bed = 0.004, pb = tw + j, pa = tl + j,
        ob = gridOrigin(rb0 + gap, rb1 - gap, pb), oa = gridOrigin(ra0 + gap, ra1 - gap, pa),
        yt = top0 + lift + bed + t / 2, tileTop = top0 + lift + bed + t,
        groutKgM2 = ((pa + pb) / (pa * pb)) * j * (t + bed - 0.0015) * 1900 * 1.15;
      const k0 = Math.floor((rb0 + gap - ob) / pb), k1 = Math.ceil((rb1 - gap - ob) / pb);
      let row = 0;
      for (let k = k0; k < k1; k++) {
        const v0 = Math.max(rb0 + gap, ob + k * pb + j / 2), v1 = Math.min(rb1 - gap, ob + (k + 1) * pb - j / 2);
        if (v1 - v0 < 0.02) continue;
        const spansHere = band(R, v0, v1);
        if (!spansHere.length) continue;
        const cl = chalk(v1 + j / 2, top0 + lift);
        let nt = 0;
        for (const [a0, a1] of spansHere) {
          const s0 = a0 + gap, s1 = a1 - gap, c0 = Math.floor((s0 - oa) / pa), c1 = Math.ceil((s1 - oa) / pa);
          for (let c = c0; c < c1; c++) {
            const ua = Math.max(s0, oa + c * pa + j / 2), ub = Math.min(s1, oa + (c + 1) * pa - j / 2);
            if (ub - ua < 0.02) continue;
            const cut = ub - ua < tl - 0.004 || v1 - v0 < tw - 0.004;
            M(out, id("ft"), "tile", f.mat, "flooring", f.id, f.mat, t, v1 - v0, P(ua, yt, (v0 + v1) / 2), P(ub, yt, (v0 + v1) / 2), dirB, {
              area: r3((ub - ua) * (v1 - v0)), thickness: t, col, course: true, row, tone: hash(k, c, 9), vary: spec.vary,
              pts: [P((ua + ub) / 2, tileTop + 0.003, (v0 + v1) / 2)], cl, out: [0, 1, 0], cut: cut ? r3(tl) : 0, cutTo: r3(Math.min(ub - ua, v1 - v0)), tileSize: [r3(ub - ua), r3(v1 - v0)],
            });
            nt++;
          }
          // the row's grout: floated into its joints (a strip just under the tile faces, seen only in the joints)
          if (nt) {
            const g0 = Math.max(rb0 + gap, v0 - j / 2), g1 = Math.min(rb1 - gap, v1 + j / 2), gy0 = top0 + lift, gy1 = tileTop - 0.0015,
              kg = r3((s1 - s0) * (g1 - g0) * groutKgM2), pts = [];
            for (let a = s0 + 0.3; a < s1 - 0.1; a += 0.6) pts.push(P(a, tileTop + 0.004, (v0 + v1) / 2));
            if (!pts.length) pts.push(P((s0 + s1) / 2, tileTop + 0.004, (v0 + v1) / 2));
            M(out, id("fg"), "grout", "grout", "flooring", f.id, "grout", gy1 - gy0, g1 - g0, P(s0, (gy0 + gy1) / 2, (g0 + g1) / 2), P(s1, (gy0 + gy1) / 2, (g0 + g1) / 2), dirB, {
              area: r3((s1 - s0) * (g1 - g0)), thickness: gy1 - gy0, col: spec.grout, course: true, row, pts, kg, tone: 0.5, vary: 0.01, out: [0, 1, 0],
            });
          }
        }
        row++;
      }
      finish = tileTop;
    } else if (spec.how === "carpet") {
      // tack strip round every wall, a little out from it, broken at doorways
      for (const e of edges) {
        if (!e.walled) continue;
        for (const [s0, s1] of openRuns(e)) {
          const L = s1 - s0, k = Math.max(1, Math.ceil(L / TACK.piece - 1e-6));
          for (let i = 0; i < k; i++) {
            const a = s0 + (L * i) / k, b = s0 + (L * (i + 1)) / k, o = TACK.off + TACK.w / 2, yy = y + top0 + TACK.t / 2;
            const at = (s) => [e.p[0] + e.u[0] * s + e.nIn[0] * o, yy, e.p[1] + e.u[1] * s + e.nIn[1] * o];
            const pts = [0.15, 0.5, 0.85].map((fr) => { const q = at(a + (b - a) * fr); q[1] += TACK.t / 2 + 0.003; return q; });
            M(out, id("fs"), "tackstrip", "tack", "flooring", f.id, "spf_seasoned", TACK.t, TACK.w, at(a + 0.01), at(b - 0.01), [e.nIn[0], 0, e.nIn[1]], { length: r3(b - a - 0.02), col: "flTack", pts, tone: hash(i, s0, 7), vary: 0.08, out: [0, 1, 0] });
          }
        }
      }
      // pad inside the strips, in rolls across the room, then the carpet over it, to the walls
      const pin = TACK.off + TACK.w + 0.004, U = UNDER.pad;
      rowsOf(rb0 + pin, rb1 - pin, U.w, false).forEach(([v0, v1], row) => {
        for (const [a0, a1] of band(R, v0, v1)) roll("fp", "pad", "rebond", U.item, U, v0, v1, a0 + pin, a1 - pin, 0, row);
      });
      const C = { t: spec.t, col };
      rowsOf(rb0, rb1, spec.roll, false).forEach(([v0, v1], row) => {
        for (const [a0, a1] of band(R, v0, v1)) {
          const m = roll("fc", "carpet", f.mat, f.mat, C, v0, v1, a0, a1, U.t - 0.002 + row * 0.0004, row, { tone: 0.5, vary: spec.vary });
          // the knee kicker: kicked tight onto the strip along the walls at its ends, and along a wall at its side
          const pts = [], ky = top0 + U.t + spec.t + 0.004;
          for (const a of [a0 + 0.07, a1 - 0.07]) for (let v = v0 + 0.3; v < v1 - 0.1; v += 1.0) pts.push(P(a, ky, v));
          for (const v of [v0, v1]) if (Math.abs(v - rb0) < 0.01 || Math.abs(v - rb1) < 0.01) for (let a = a0 + 0.6; a < a1 - 0.4; a += 1.2) pts.push(P(a, ky, v + (v === v0 ? 0.07 : -0.07)));
          m.pts = pts;
          m.kicks = 1;
        }
      });
      finish = top0 + U.t + spec.t - 0.003;
    }

    // a threshold across each door (the baseboard round the walls is trim: src/trim.js)
    for (const e of edges) {
      if (!e.walled) continue;
      for (const gp of e.gaps) {
        if (!gp.door) continue;
        const yy = y + finish + 0.006, at = (s) => [e.p[0] + e.u[0] * s - e.nIn[0] * 0.04, yy, e.p[1] + e.u[1] * s - e.nIn[1] * 0.04];
        M(out, id("fh"), "threshold", "saddle", "flooring", f.id, "oak_seasoned", 0.014, 0.13, at(gp.s0 + 0.01), at(gp.s1 - 0.01), [e.nIn[0], 0, e.nIn[1]],
          { length: r3(gp.s1 - gp.s0), col: "flThresh", pts: [at(gp.s0 + 0.12), at(gp.s1 - 0.12)].map((q) => [q[0], q[1] + 0.011, q[2]]), tone: 0.4, vary: 0.05, out: [0, 1, 0] });
      }
    }
  }
  // where the top of a finished floor is, above the floor's base (top: the subfloor's top): the trim stands on it
  function finishTop(mat, base, top) {
    const s = FLOORINGS[mat];
    if (!s) return top;
    if (s.how === "nail" || s.how === "click") { const u = s.how === "nail" ? (base === "wood" ? "rosin" : "poly") : s.under; return top + (u ? UNDER[u].t + 0.003 : 0) + s.t; }
    if (s.how === "tile") return top + (base === "wood" ? BACKER.t : 0) + 0.004 + s.t;
    return top + UNDER.pad.t + s.t - 0.003;
  }
  // the stretches of a wall's foot with no doorway in them
  function openRuns(e) {
    const gs = e.gaps.slice().sort((p, q) => p.s0 - q.s0), out = [];
    let s = 0.005;
    for (const g of gs) { g.s0 - s > 0.08 && out.push([s, g.s0]); s = Math.max(s, g.s1); }
    e.L - 0.005 - s > 0.08 && out.push([s, e.L - 0.005]);
    return out;
  }

  /* ---------- what each piece is bought as: [key, itemId, unit, quantity, label, why, missing?, sheet area?] ---------- */
  // a tenth more than the area of boards, tile and carpet: the cuts, as installers order it
  const EXTRA = 1.1;
  function buyAs(m) {
    const k = m.kind;
    if (k === "underlay") { const U = UNDER[m.type] || UNDER.rosin; return ["ul" + m.type, U.item, "m2", m.area, U.name, U.why]; }
    if (k === "pad") return ["pad", UNDER.pad.item, "m2", m.area, UNDER.pad.name, UNDER.pad.why];
    if (k === "backer") return ["backer", "backer_board", "sheet", m.area, "Cement backer board", "Screwed over the wood subfloor under tile. It does not swell or flex, so the tile and grout do not crack.", undefined, BACKER.area];
    if (k === "plank") {
      const s = FLOORINGS[m.material] || FLOORINGS.planks, [item, unit] = s.item;
      return ["fl" + m.material, item, unit, unit === "m" ? (m.length || 0) * EXTRA : m.area * EXTRA, s.name, s.how === "nail" ? "The floor you walk on: tongue-and-groove boards nailed down row by row. Bought with a tenth extra for the cuts." : "The floor you walk on: planks that click together and float, held down only by their own weight and the walls. Bought with a tenth extra for the cuts."];
    }
    if (k === "tile") { const s = FLOORINGS[m.material]; return ["tile" + m.material, s.item[0], "m2", m.area * EXTRA, s.name, "Set in thinset mortar on a flat, stiff base. Bought with a tenth extra for the cuts at the walls."]; }
    if (k === "grout") return ["grout", "grout_sanded", "kg", Math.max(0.05, m.kg || 0), "Grout", "Floated into the joints between tiles: it locks them together and keeps dirt and water out of the gaps."];
    if (k === "carpet") { const s = FLOORINGS[m.material]; return ["carpet" + m.material, s.item[0], "m2", m.area * 1.05, s.name, "Cut from a 3.66 m (12 ft) roll and stretched tight over the pad: it is held only at the walls."]; }
    if (k === "tackstrip") return ["tack", "tack_strip", "m", m.length || 0, "Tack strip", "Thin strips of wood with angled pins, nailed round the walls: the carpet is stretched onto them and held."];
    if (k === "threshold") return ["thresh", "threshold_oak", "each", 1, "Thresholds", "A low saddle under each door: it covers the edge of the floor where it meets the next one."];
    return undefined;
  }
  // what is used up from the stacks as the work goes on, by weight: [itemId, kg]
  function supplies(m) {
    if (m.kind === "plank" && m.type === "nail") return ["nails_floor", m.area * 0.18];
    if (m.kind === "tile") return ["thinset_mortar", m.area * 4.5];
    if (m.kind === "backer") return ["thinset_mortar", m.area * 3];
    return null;
  }
  const SUPPLY_WORDS = {
    nails_floor: ["Flooring cleats", "Driven at 45 degrees through the tongue of each board, so the next board hides them. Used up as you lay the floor."],
    thinset_mortar: ["Thinset mortar", "Combed onto the floor with a notched trowel; the cement board and each tile are pressed into it. Used up as you go."],
  };

  globalThis.__flooring = { FLOORINGS, UNDER, FLOOR_COLORS, BACKER, lays, finishTop, roomOf, crossA, rowsOf, gridOrigin, members, buyAs, supplies, SUPPLY_WORDS };
})();
