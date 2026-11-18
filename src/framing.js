/* Real construction as data: given the walls, floors and roofs of a building, this lists every member that a
   builder would put in (piers, beams, joists, sheets, plates, studs, headers, rafters, batts, boards), each with
   its real section, its length and place, the stage of the build it belongs to, and what it is bought as.
   Pure arithmetic: no DOM, no three.js. The page reads it as window.__framing; tests read globalThis.__framing. */
(() => {
  // the order a building is raised in (docs/CONSTRUCTION.md)
  const STAGES = ["site", "foundation", "floor-frame", "subfloor", "wall-frame", "top-plates", "roof-frame", "roof-deck", "dry-in", "roofing", "sheathing", "wrap", "openings", "cladding", "gutters", "rough-in", "insulation", "lining", "trim-out", "services"];
  const STAGE_NAME = { site: "Site", foundation: "Foundation", "floor-frame": "Floor frame", subfloor: "Subfloor", "wall-frame": "Wall frames", "top-plates": "Top plates", "roof-frame": "Roof frame", "roof-deck": "Roof deck", "dry-in": "Dry-in", roofing: "Roofing", sheathing: "Sheathing", wrap: "Wrap", openings: "Windows and doors", cladding: "Cladding", gutters: "Gutters", "rough-in": "Rough-in", insulation: "Insulation", lining: "Lining", "trim-out": "Trim-out", services: "Services" };
  // actual (not nominal) sizes of North American lumber, metres: [breadth, depth]
  const LUMBER = { "2x4": [0.038, 0.089], "2x6": [0.038, 0.14], "2x8": [0.038, 0.184], "2x10": [0.038, 0.235], "2x12": [0.038, 0.286], glulam: [0.09, 0.225], "4x4": [0.089, 0.089], "6x6": [0.14, 0.14] };
  const SHEET = { w: 1.22, l: 2.44 };
  const T = { osb: 0.011, sub: 0.018, clad: 0.019, lining: 0.019, gyp: 0.0127, wrap: 0.0002 };
  const FOUNDATIONS = {
    "pier-blocks": { name: "Pier blocks", drop: 0.45, note: "Precast concrete blocks under beams. Quick, cheap, right for sheds and small cabins." },
    skids: { name: "Skids on gravel", drop: 0.33, note: "Heavy timbers on a gravel bed. The building can be dragged somewhere else later." },
    piers: { name: "Poured piers", drop: 0.45, note: "Concrete columns on footings below the frost. For a cabin that should stay put." },
    stemwall: { name: "Stem wall", drop: 0.45, note: "A concrete wall on a footing all the way round, with a crawl space inside." },
    slab: { name: "Slab on grade", drop: 0.05, note: "A concrete floor poured on gravel. The floor and the foundation in one." },
    plinth: { name: "Stone plinth", drop: 0.05, note: "A fieldstone base, as old buildings have." },
  };
  const FLOOR_T = 0.12,
    JD = LUMBER["2x8"][1],
    J_TOP = FLOOR_T - T.sub,
    J_BOT = J_TOP - JD,
    BEAM = LUMBER["6x6"][0];
  const hyp = Math.hypot,
    r3 = (v) => Math.round(v * 1000) / 1000;
  // Lumber comes in stock lengths (8 to 20 ft; the same list as STICK in src/sim/content/construction.js). Nothing is
  // stretched: a run longer than MAX_RUN is spliced from pieces that butt over a stud, joist, pier or rafter.
  const STOCK = [2.4, 3.0, 3.6, 4.2, 4.8, 5.4, 6.0],
    MAX_RUN = 4.8,
    KERF = 0.003,
    KEEP = 0.3;
  // [s0, s1] in pieces no longer than MAX_RUN, each joint on a support (origin + k * step); the first piece no longer than
  // `first` (a cap plate starts short so its joints fall 1.2 m from those of the plate under it); no stub under 0.6 m
  function splice(s0, s1, origin, step, first = MAX_RUN) {
    const out = [];
    let a = s0,
      lim = Math.min(first, MAX_RUN);
    while (s1 - a > lim + 1e-6) {
      let j = origin + Math.floor((a + lim - origin + 1e-6) / step) * step;
      if (s1 - j < 0.6 && j - step > a + 0.3) j -= step;
      if (j <= a + 0.3) j = a + lim;
      out.push([a, j]);
      a = j;
      lim = MAX_RUN;
    }
    out.push([a, s1]);
    return out;
  }

  // one member. a, b: the ends of its centre line [x, y, z]; n: the unit direction its depth d lies along; its
  // breadth b lies along (axis x n). Sheets are members too: thickness for b, width for d.
  function M(out, id, kind, type, stage, parent, material, bb, d, a, b, n, extra) {
    const m = { id, kind, type, stage, parent, material, section: { b: bb, d }, length: r3(hyp(b[0] - a[0], b[1] - a[1], b[2] - a[2])), a, b, n };
    if (extra) Object.assign(m, extra);
    out.push(m);
    return m;
  }
  const UP = [0, 1, 0];

  /* ---------- floors and what they stand on ---------- */
  // where a line across a polygon is inside it: pairs of crossings along the line (x = c if alongZ, else z = c)
  function spans(pts, c, alongZ) {
    const xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const p = pts[i],
        q = pts[j],
        pa = alongZ ? p[0] : p[1],
        qa = alongZ ? q[0] : q[1];
      if (pa > c !== qa > c) xs.push((alongZ ? p[1] : p[0]) + ((c - pa) / (qa - pa)) * ((alongZ ? q[1] : q[0]) - (alongZ ? p[1] : p[0])));
    }
    xs.sort((a, b) => a - b);
    const out = [];
    for (let k = 0; k + 1 < xs.length; k += 2) xs[k + 1] - xs[k] > 0.05 && out.push([xs[k], xs[k + 1]]);
    return out;
  }
  const polyArea = (pts) => {
    let a = 0;
    for (let n = 0; n < pts.length; n++) a += pts[n][0] * pts[(n + 1) % pts.length][1] - pts[(n + 1) % pts.length][0] * pts[n][1];
    return Math.abs(a) / 2;
  };
  // sheets laid over a rectangle (u along the first axis, v along the second), long side along u, joints staggered
  function sheetRows(u0, u1, v0, v1, each) {
    let row = 0;
    for (let v = v0; v < v1 - 0.01; v += SHEET.w, row++) {
      const ve = Math.min(v1, v + SHEET.w);
      for (let u = u0 - (row % 2 ? SHEET.l / 2 : 0); u < u1 - 0.01; u += SHEET.l) {
        const ua = Math.max(u0, u),
          ub = Math.min(u1, u + SHEET.l);
        ub - ua > 0.02 && each(ua, ub, v, ve);
      }
    }
  }
  function floorMembers(out, f, found, spec) {
    const pts = f.outline;
    if (!pts || pts.length < 3) return;
    let x0 = 1e9,
      x1 = -1e9,
      z0 = 1e9,
      z1 = -1e9;
    for (const p of pts) ((x0 = Math.min(x0, p[0])), (x1 = Math.max(x1, p[0])), (z0 = Math.min(z0, p[1])), (z1 = Math.max(z1, p[1])));
    const y = f.y0 || 0,
      area = polyArea(pts),
      // joists span the short way; a runs along the long side, b across it
      longX = x1 - x0 >= z1 - z0,
      a0 = longX ? x0 : z0,
      a1 = longX ? x1 : z1,
      b0 = longX ? z0 : x0,
      b1 = longX ? z1 : x1,
      P = (a, yy, b) => (longX ? [a, y + yy, b] : [b, y + yy, a]),
      dirA = longX ? [1, 0, 0] : [0, 0, 1],
      dirB = longX ? [0, 0, 1] : [1, 0, 0],
      rect = Math.abs(area - (x1 - x0) * (z1 - z0)) < 0.01,
      fid = f.id + ".fd",
      gY = (a, b) => (f.groundY ? f.groundY(...(longX ? [a, b] : [b, a])) : -(FOUNDATIONS[found] || FOUNDATIONS.plinth).drop);
    let n = 0;
    const id = (p, c) => p + "." + c + n++;
    if (f.ground) M(out, f.id + ".site", "site", "pad", "site", f.id, "earth", 0, 0, P(a0, 0, (b0 + b1) / 2), P(a1, 0, (b0 + b1) / 2), UP, { area: r3((a1 - a0 + 2) * (b1 - b0 + 2)), draw: 0 });
    const slab = f.ground && found === "slab",
      framed = !slab && found !== "plinth";
    // lines of support under the joists: at both sides, and between them so that no joist spans more than 3 m
    const nb = Math.max(2, Math.ceil((b1 - b0) / 3) + 1),
      lines = Array.from({ length: nb }, (_, k) => b0 + BEAM / 2 + ((b1 - b0 - BEAM) * k) / (nb - 1));
    if (f.ground && (found === "pier-blocks" || found === "piers" || found === "skids")) {
      const skid = found === "skids";
      if (skid) M(out, id(fid, "g"), "footing", "gravel-bed", "foundation", fid, "gravel", 0.1, b1 - b0 + 0.6, P(a0 - 0.3, J_BOT - BEAM - 0.05, (b0 + b1) / 2), P(a1 + 0.3, J_BOT - BEAM - 0.05, (b0 + b1) / 2), dirB, { area: r3((a1 - a0 + 0.6) * (b1 - b0 + 0.6)), volume: r3((a1 - a0 + 0.6) * (b1 - b0 + 0.6) * 0.1), col: "gravel" });
      for (const b of lines) {
        const sp = spans(pts, b, !longX)[0] || [a0, a1];
        // a pier at each end of the beam and between, no more than 1.8 m apart; a beam longer than a stick joins over a pier
        const np = Math.max(2, Math.ceil((sp[1] - sp[0] - 0.3) / 1.8) + 1);
        for (const [p0, p1] of splice(sp[0], sp[1], sp[0] + 0.15, (sp[1] - sp[0] - 0.3) / (np - 1))) M(out, id(fid, skid ? "sk" : "bm"), skid ? "skid" : "beam", skid ? "skid" : "girder", "foundation", fid, "timber", BEAM, BEAM, P(p0, J_BOT - BEAM / 2, b), P(p1, J_BOT - BEAM / 2, b), UP);
        if (skid) continue;
        for (let k = 0; k < np; k++) {
          const a = sp[0] + 0.15 + ((sp[1] - sp[0] - 0.3) * k) / (np - 1),
            top = J_BOT - BEAM,
            g = Math.min(gY(a, b), top - 0.2);
          if (found === "pier-blocks") {
            M(out, id(fid, "pb"), "pier", "block", "foundation", fid, "concrete", 0.3, 0.3, P(a, g, b), P(a, g + 0.2, b), dirA, { volume: 0.013, col: "concrete" });
            if (top - g - 0.2 > 0.03) M(out, id(fid, "pp"), "post", "pier-post", "foundation", fid, "timber", 0.089, 0.089, P(a, g + 0.2, b), P(a, top, b), dirA);
          } else {
            M(out, id(fid, "ft"), "footing", "pad", "foundation", fid, "concrete", 0.5, 0.5, P(a, g - 0.75, b), P(a, g - 0.55, b), dirA, { volume: 0.05, col: "concrete" });
            M(out, id(fid, "pr"), "pier", "poured", "foundation", fid, "concrete", 0.25, 0.25, P(a, g - 0.55, b), P(a, top, b), dirA, { volume: r3(0.049 * (top - g + 0.55)), draw: 2, col: "concrete" });
          }
        }
      }
    } else if (f.ground && found === "stemwall") {
      const top = J_BOT - 0.038;
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k],
          q = pts[(k + 1) % pts.length],
          L = hyp(q[0] - p[0], q[1] - p[1]),
          nx = (q[1] - p[1]) / L,
          nz = -(q[0] - p[0]) / L,
          g = Math.min(f.groundY ? f.groundY((p[0] + q[0]) / 2, (p[1] + q[1]) / 2) : -0.45, top - 0.2),
          A = (yy) => [p[0], y + yy, p[1]],
          Bq = (yy) => [q[0], y + yy, q[1]];
        M(out, id(fid, "ft"), "footing", "strip", "foundation", fid, "concrete", 0.2, 0.4, A(g - 0.5), Bq(g - 0.5), [nx, 0, nz], { volume: r3(L * 0.08), col: "concrete" });
        M(out, id(fid, "sw"), "stemwall", "stemwall", "foundation", fid, "concrete", top - g + 0.4, 0.2, A((top + g - 0.4) / 2), Bq((top + g - 0.4) / 2), [nx, 0, nz], { volume: r3(L * 0.2 * (top - g + 0.4)), col: "concrete", height: r3(top - g + 0.4) });
        M(out, id(f.id, "sp"), "plate", "sill", "floor-frame", f.id, "timber", 0.038, 0.14, A(top + 0.019), Bq(top + 0.019), [nx, 0, nz]);
      }
      if (b1 - b0 > 3.7) {
        // a beam down the middle on its own piers, so no joist spans too far
        const b = (b0 + b1) / 2;
        M(out, id(fid, "bm"), "beam", "girder", "foundation", fid, "timber", BEAM, BEAM, P(a0 + 0.2, J_BOT - BEAM / 2, b), P(a1 - 0.2, J_BOT - BEAM / 2, b), UP);
        const np = Math.max(2, Math.ceil((a1 - a0 - 0.6) / 1.8) + 1);
        for (let k = 0; k < np; k++) {
          const a = a0 + 0.3 + ((a1 - a0 - 0.6) * k) / (np - 1);
          M(out, id(fid, "pr"), "pier", "poured", "foundation", fid, "concrete", 0.25, 0.25, P(a, gY(a, b) - 0.55, b), P(a, J_BOT - BEAM, b), dirA, { volume: 0.05, draw: 2, col: "concrete" });
        }
      }
    } else if (slab) {
      M(out, id(fid, "g"), "footing", "gravel-bed", "foundation", fid, "gravel", 0.1, b1 - b0, P(a0, -0.03, (b0 + b1) / 2), P(a1, -0.03, (b0 + b1) / 2), dirB, { area: r3(area), volume: r3(area * 0.1), col: "gravel" });
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k],
          q = pts[(k + 1) % pts.length],
          L = hyp(q[0] - p[0], q[1] - p[1]);
        M(out, id(fid, "ft"), "footing", "edge", "foundation", fid, "concrete", 0.3, 0.3, [p[0], y - 0.13, p[1]], [q[0], y - 0.13, q[1]], UP, { volume: r3(L * 0.09), col: "concrete" });
      }
      M(out, id(fid, "sl"), "slab", "slab", "foundation", fid, "concrete", 0.1, b1 - b0, P(a0, FLOOR_T - 0.05, (b0 + b1) / 2), P(a1, FLOOR_T - 0.05, (b0 + b1) / 2), dirB, { area: r3(area), volume: r3(area * 0.1), thickness: 0.1, col: "concrete", draw: rect ? 1 : 0 });
    }
    if (framed) {
      const jy = (J_TOP + J_BOT) / 2,
        sp = spec.joists || 0.4;
      // rim joists close the ends of the joists; the joists run between them at 0.4 m centres
      if (rect) for (const b of [b0 + 0.019, b1 - 0.019]) for (const [p0, p1] of splice(a0, a1, a0, sp, b === b0 + 0.019 ? MAX_RUN : MAX_RUN - 1.2)) M(out, id(f.id, "rj"), "joist", "rim", "floor-frame", f.id, "timber", 0.038, JD, P(p0, jy, b), P(p1, jy, b), UP);
      const at = [a0 + 0.019];
      for (let a = a0 + sp; a < a1 - 0.06; a += sp) at.push(a);
      at.push(a1 - 0.019);
      for (const a of at)
        for (const s of spans(pts, a, longX)) {
          M(out, id(f.id, "j"), "joist", a === at[0] || a === at[at.length - 1] ? "end" : "joist", "floor-frame", f.id, "timber", 0.038, JD, P(a, jy, s[0] + (rect ? 0.038 : 0)), P(a, jy, s[1] - (rect ? 0.038 : 0)), UP);
        }
      if (spec.ins && f.ground)
        for (let k = 0; k + 1 < at.length; k++) {
          const w = at[k + 1] - at[k] - 0.038,
            s = spans(pts, (at[k] + at[k + 1]) / 2, longX)[0];
          if (w > 0.05 && s) M(out, id(f.id, "in"), "insulation", "floor-batt", "insulation", f.id, spec.ins, 0.14, w, P((at[k] + at[k + 1]) / 2, J_TOP - 0.07, s[0] + 0.04), P((at[k] + at[k + 1]) / 2, J_TOP - 0.07, s[1] - 0.04), dirA, { thickness: 0.14, area: r3(w * (s[1] - s[0] - 0.08)), col: "batt", draw: 0 });
        }
      sheetRows(a0, a1, b0, b1, (ua, ub, va, vb) => M(out, id(f.id, "sf"), "sheathing", "subfloor", "subfloor", f.id, "osb", T.sub, vb - va, P(ua, FLOOR_T - T.sub / 2, (va + vb) / 2), P(ub, FLOOR_T - T.sub / 2, (va + vb) / 2), dirB, { area: r3(((ub - ua) * (vb - va) * area) / ((a1 - a0) * (b1 - b0))), thickness: T.sub, col: "osb" }));
    }
    M(out, f.id + ".fl", "lining", "flooring", "lining", f.id, f.mat || "planks", T.lining, b1 - b0, P(a0, FLOOR_T, (b0 + b1) / 2), P(a1, FLOOR_T, (b0 + b1) / 2), dirB, { area: r3(area), thickness: T.lining, draw: 0 });
  }

  /* ---------- walls ---------- */
  // Header by span (the same table as HEADER_TABLE in src/sim/content/openings.js, which a test keeps in step): two boards
  // on edge up to 3 m; beyond that an engineered beam with doubled jack studs. A garage door always gets the beam.
  const HEADER_TABLE = [[1.2, "2x6"], [1.8, "2x8"], [2.4, "2x10"], [3.0, "2x12"]];
  const headerFor = (w, beam) => {
    if (!beam) for (const [u, z] of HEADER_TABLE) if (w <= u + 1e-9) return z;
    return "glulam";
  };
  // Siding: lap boards in even courses CH tall, each course one board along the wall, broken only at openings; a trim
  // board at each end and round every opening. The boards are drawn flat to the wall, one course above the next: the lap
  // itself (the shadow line under each butt edge, the lit edge) is painted by the siding material (lapMat in build.js),
  // which stays crisp at any distance where a real lean of a few degrees broke up into shadow-map blocks.
  const CH = 0.18,
    TRIM_W = 0.09,
    LEAN = 0,
    LAP = 0;
  function sidingCourses(out, id, c) {
    const [ux, uz] = c.u,
      col = c.mat === "dark" ? "sidingDark" : "siding",
      upV = [-c.out[0] * Math.sin(LEAN), Math.cos(LEAN), -c.out[2] * Math.sin(LEAN)],
      common = { thickness: T.clad, col, out: c.out, u: [ux, uz], ...(c.roof ? { roof: c.roof } : {}) }, trimC = { ...common, col: "trim" };
    // trim round every door and window: two jambs and a head (and a sill under a window), 90 x 20 mm, flat to the wall; the siding butts into it
    const tw0 = c.trim === false ? 0 : TRIM_W, W = TRIM_W, tmid = c.off + 0.006;
    for (const q of c.openings || []) {
      const y0 = q.door ? q.y0 : q.y0 - W, y1 = q.y1 + W,
        bits = [[Math.max(tw0, q.s0 - W), q.s0, y0, y1], [q.s1, Math.min(c.L - tw0, q.s1 + W), y0, y1], [Math.max(tw0, q.s0 - W), Math.min(c.L - tw0, q.s1 + W), q.y1, y1]];
      if (!q.door) bits.push([Math.max(tw0, q.s0 - W), Math.min(c.L - tw0, q.s1 + W), q.y0 - W, q.y0]);
      for (const [xa, xb, ya, yb] of bits) if (xb - xa > 0.02 && yb - ya > 0.02) M(out, id("ot"), "cladding", "trim", "cladding", c.parent, c.mat || "timber", 0.02, xb - xa, c.at((xa + xb) / 2, ya, tmid), c.at((xa + xb) / 2, yb, tmid), [ux, 0, uz], { ...trimC, area: r3((xb - xa) * (yb - ya)), row: -1 });
    }
    // corner trim: a vertical board at each end of the wall
    if (c.trim !== false) for (const [s0, s1] of [[0, TRIM_W], [c.L - TRIM_W, c.L]]) M(out, id("tr"), "cladding", "trim", "cladding", c.parent, c.mat || "timber", 0.02, TRIM_W, c.at((s0 + s1) / 2, c.y0, c.off + 0.006), c.at((s0 + s1) / 2, c.y1, c.off + 0.006), [ux, 0, uz], { ...trimC, area: r3(TRIM_W * (c.y1 - c.y0)), row: -1 });
    // board and batten: boards about 0.25 m wide running bottom to top, a 50 mm batten over each joint; built board by board, left to right
    if (c.vfree && c.mat === "batten") {
      const BW = 0.25, BT = 0.016, BAT = 0.05, BATT = 0.008, tw = c.trim === false ? 0 : TRIM_W,
        nb = Math.max(1, Math.round((c.L - 2 * tw) / BW)), wd = (c.L - 2 * tw) / nb;
      for (let k = 0; k < nb; k++) {
        const ka = tw + k * wd, kb = ka + wd, cuts = [ka, ...(c.vbreaks || []).filter((x) => x > ka + 0.03 && x < kb - 0.03), kb].sort((p, q) => p - q);
        for (let i = 0; i + 1 < cuts.length; i++) {
          const xa = cuts[i], xb = cuts[i + 1];
          if (xb - xa < 0.04) continue;
          for (const [ya, yb] of c.vfree(xa, xb)) if (yb - ya > 0.1) M(out, id("vb"), "cladding", "vboards", "cladding", c.parent, c.mat, BT, xb - xa, c.at((xa + xb) / 2, ya, c.off + 0.004), c.at((xa + xb) / 2, yb, c.off + 0.004), [ux, 0, uz], { ...common, thickness: BT, area: r3((xb - xa) * (yb - ya)), row: k });
        }
        if (k) for (const [ya, yb] of c.vfree(ka - BAT / 2, ka + BAT / 2)) if (yb - ya > 0.1) M(out, id("bt"), "cladding", "batten", "cladding", c.parent, c.mat, BATT, BAT, c.at(ka, ya, c.off + 0.016), c.at(ka, yb, c.off + 0.016), [ux, 0, uz], { ...common, thickness: BATT, area: r3(BAT * (yb - ya)), row: k });
      }
      return;
    }
    let row = 0;
    for (let y = c.y0; y < c.y1 - 0.05; y += CH, row++) {
      const ya = y,
        yb = Math.min(c.y1, y + CH);
      for (const [xa, xb] of c.spans(ya, yb, row)) {
        const tw = c.trim === false ? 0 : TRIM_W, sa = Math.max(xa, tw), sb = Math.min(xb, c.L - tw);
        if (sb - sa < 0.1) continue;
        const ym = (ya + yb) / 2;
        // a thin lapped board: it overlaps the course below by 25 mm and only its bottom edge stands off the wall, so the shadow line carries the look
        const lap = row && c.spans(ya - LAP, ya, row - 1).some(([x0, x1]) => x0 <= sa + 1e-6 && x1 >= sb - 1e-6) ? LAP : 0;
        M(out, id("cl"), "cladding", "boards", "cladding", c.parent, c.mat || "timber", 0.007, yb - ya + lap, c.at(sa, ym - lap / 2, c.off), c.at(sb, ym - lap / 2, c.off), upV, { ...common, area: r3((sb - sa) * (yb - ya)), row });
      }
    }
  }
  // w: { id, a: [x, z], b: [x, z], y0, h, out (1: outside is to the left of a->b, -1: to the right, 0: an inside wall),
  //      mat, openings: [{ id, offset, width, sill, height }] (sill measured from y0) }
  function wallMembers(out, w, spec) {
    const L = hyp(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (L < 0.3) return;
    const ux = (w.b[0] - w.a[0]) / L,
      uz = (w.b[1] - w.a[1]) / L,
      nrm = [-uz, 0, ux],
      o = w.out || 0,
      yb = w.y0 + (w.foot === undefined ? FLOOR_T : w.foot),
      yt = w.y0 + w.h,
      [SB, SD] = LUMBER[spec.wall || "2x4"],
      at = (s, y, off) => [w.a[0] + ux * s + nrm[0] * (off || 0), y, w.a[1] + uz * s + nrm[2] * (off || 0)],
      st0 = yb + SB,
      st1 = yt - 2 * SB,
      opens = (w.openings || []).map((q) => ({ id: q.id, s0: Math.max(0.1, q.offset), s1: Math.min(L - 0.1, q.offset + q.width), y0: w.y0 + q.sill, y1: Math.min(w.y0 + q.sill + q.height, st1 - 0.15), door: q.kind !== "window", frame: q.frame || null })).filter((q) => q.s1 - q.s0 > 0.2);
    // a pocket door's wall section: the opening carries on past the door for the leaf to slide into, framed as one span
    for (const q of opens) if (q.frame === "pocket") ((q.pocket = q.s1), (q.s1 = Math.min(L - 0.1, q.s1 + (q.s1 - q.s0) + 0.04)));
    for (const q of opens) ((q.beam = q.frame === "beam" || headerFor(q.s1 - q.s0) === "glulam"), (q.hs = headerFor(q.s1 - q.s0, q.frame === "beam")), (q.hd = LUMBER[q.hs][1]), (q.y1 = Math.min(q.y1, st1 - q.hd - 0.01)), (q.jn = q.beam ? 2 : 1));
    let n = 0;
    const id = (c) => w.id + "." + c + n++,
      stud = (type, s, y0, y1, stage) => y1 - y0 > 0.04 && M(out, id("st"), "stud", type, stage || "wall-frame", w.id, "timber", SB, SD, at(s, y0), at(s, y1), nrm),
      flat = (code, kind, type, stage, s0, s1, y, d) => M(out, id(code), kind, type, stage, w.id, "timber", SB, d || SD, at(s0, y), at(s1, y), nrm);
    // the bottom plate stops at doorways; plates longer than a stick are spliced over a stud, the cap plate's joints 1.2 m from the top plate's
    const sp = spec.studs || 0.4,
      plates = (code, type, stage, s0, s1, y, first) => { for (const [p0, p1] of splice(s0, s1, 0, sp, first)) flat(code, "plate", type, stage, p0, p1, y); };
    let s = 0;
    for (const q of opens.filter((q) => q.door && q.y0 - yb < 0.2).sort((p, q) => p.s0 - q.s0)) (q.s0 - s > 0.05 && plates("bp", "bottom", "wall-frame", s, q.s0, yb + SB / 2), (s = q.pocket || q.s1));
    L - s > 0.05 && plates("bp", "bottom", "wall-frame", s, L, yb + SB / 2);
    plates("tp", "top", "wall-frame", 0, L, yt - 1.5 * SB);
    { const j = splice(0, L, 0, sp)[0][1];
      plates("cp", "cap", "top-plates", 0, L, yt - 0.5 * SB, j < L - 1e-6 ? Math.max(0.6, j - 1.2) : MAX_RUN); }
    // studs: one at each end with a second beside it for the corner, then every 0.4 m measured from the start
    const inOpen = (x) => opens.find((q) => x > q.s0 - 0.12 && x < q.s1 + 0.12),
      ups = [];
    for (const [x, type] of [[SB / 2, "end"], [1.5 * SB, "corner"], [L - 1.5 * SB, "corner"], [L - SB / 2, "end"]]) inOpen(x) || (stud(type, x, st0, st1), ups.push(x));
    for (let x = sp; x < L - 0.1; x += sp) {
      const q = inOpen(x);
      if (!q) (stud("stud", x, st0, st1), ups.push(x));
      else if (x > q.s0 + 0.05 && x < q.s1 - 0.05) {
        // short studs carry on the spacing above the header and under a window
        stud(q.pocket ? "pocket" : "cripple", x, q.y1 + q.hd, st1);
        q.door || q.y0 - SB - st0 < 0.06 || stud("cripple", x, st0, q.y0 - SB);   // a floor-length window has no room for them
      }
    }
    for (const q of opens) {
      const hs = q.hs,
        hd = q.hd,
        [hb, hdep] = LUMBER[hs],
        plies = hs === "glulam" ? 1 : 2;
      // king studs each side, then the jack (trimmer) studs that carry the header; an engineered beam gets two jacks a side
      for (const k of [-1, 1]) {
        const e = k < 0 ? q.s0 : q.s1,
          x = e + k * (q.jn + 0.5) * SB;
        x > 0.02 && x < L - 0.02 && (stud("king", x, st0, st1), ups.push(x));
        for (let j = 0; j < q.jn; j++) stud("jack", e + k * (j + 0.5) * SB, st0, q.y1);
      }
      // the header: boards on edge (or one engineered beam), carrying what is above across the opening
      M(out, id("hd"), "header", "header", "wall-frame", w.id, "timber", plies * hb, hdep, at(q.s0 - q.jn * SB, q.y1 + hd / 2), at(q.s1 + q.jn * SB, q.y1 + hd / 2), UP, { size: hs, plies, opening: q.id || null, span: r3(q.s1 - q.s0) });
      q.door || flat("sl", "plate", "sill", "wall-frame", q.s0, q.s1, q.y0 - SB / 2);
    }
    const cut = (s0, s1, y0, y1) => {
      let a = 0;
      for (const q of opens) a += Math.max(0, Math.min(s1, q.s1) - Math.max(s0, q.s0)) * Math.max(0, Math.min(y1, q.y1) - Math.max(y0, q.y0));
      return a;
    };
    const net = L * (yt - yb) - cut(0, L, yb, yt),
      face = SD / 2;
    if (o) {
      // sheets stood on end across the studs, from the floor frame up; then wrap, then boards. Every layer leaves the
      // rough openings open: a sheet or a roll that crosses one is cut into the pieces round it.
      const lo = w.foot === undefined ? w.y0 + J_BOT : yb,
        free = (x0, x1, y0, y1, list = opens) => {
          const cov = list.filter((q) => q.y0 < y1 - 1e-4 && q.y1 > y0 + 1e-4 && q.s1 > x0 && q.s0 < x1).sort((p, q) => p.s0 - q.s0),
            r = [];
          let s = x0;
          for (const q of cov) {
            q.s0 - s > 0.02 && r.push([s, Math.min(q.s0, x1)]);
            s = Math.max(s, q.s1);
          }
          x1 - s > 0.02 && r.push([s, x1]);
          return r;
        },
        holes = (x0, x1, y0, y1) => {
          const ys = [y0, y1];
          for (const q of opens) if (q.s1 > x0 && q.s0 < x1) for (const v of [q.y0, q.y1]) v > y0 + 1e-3 && v < y1 - 1e-3 && ys.push(v);
          ys.sort((p, q) => p - q);
          const r = [];
          for (let k = 0; k + 1 < ys.length; k++) if (ys[k + 1] - ys[k] > 0.02) for (const [xa, xb] of free(x0, x1, ys[k], ys[k + 1])) r.push([xa, xb, ys[k], ys[k + 1]]);
          return r;
        },
        outV = [nrm[0] * o, 0, nrm[2] * o];
      for (let x = 0; x < L - 0.01; x += SHEET.w)
        for (let y = lo; y < yt - 0.01; y += SHEET.l)
          for (const [xa, xb, ya, yb2] of holes(x, Math.min(L, x + SHEET.w), y, Math.min(yt, y + SHEET.l))) {
            const a = (xb - xa) * (yb2 - ya);
            a > 0.02 && M(out, id("sh"), "sheathing", "wall", "sheathing", w.id, "osb", T.osb, xb - xa, at((xa + xb) / 2, ya, o * (face + T.osb / 2)), at((xa + xb) / 2, yb2, o * (face + T.osb / 2)), [ux, 0, uz], { area: r3(a), thickness: T.osb, col: "osb" });
          }
      // house wrap goes on in horizontal courses 2.7 m wide, from the bottom up; each course laps over the one below by 0.1 m
      // each course sits a hair off true (a little lean and offset, fixed here so nothing moves per frame) and is taped round every opening it meets
      for (let c = 0, ya0 = lo; ya0 < yt - 0.01; c++) {
        const top = Math.min(yt, ya0 + 2.7),
          y0c = c ? ya0 - 0.1 : ya0,
          lift = 0.003 * c,
          j0 = (((c * 7 + 3) % 5) - 2) * 0.0004,
          j1 = (((c * 11 + 1) % 5) - 2) * 0.0004;
        for (const [xa, xb, ya, yb2] of holes(0, L, y0c, top)) {
          let tape = "";
          for (const q of opens) {
            const ox = Math.min(xb, q.s1) - Math.max(xa, q.s0) > 0.01, oy = Math.min(yb2, q.y1) - Math.max(ya, q.y0) > 0.01;
            if (oy && Math.abs(q.s1 - xa) < 0.011) tape += "l";
            if (oy && Math.abs(q.s0 - xb) < 0.011) tape += "r";
            if (ox && Math.abs(q.y1 - ya) < 0.011) tape += "b";
            if (ox && Math.abs(q.y0 - yb2) < 0.011) tape += "t";
          }
          M(out, id("wr"), "membrane", "housewrap", "wrap", w.id, "housewrap", T.wrap + 0.004, xb - xa, at((xa + xb) / 2, ya, o * (face + T.osb + 0.004 + lift + j0)), at((xa + xb) / 2, yb2, o * (face + T.osb + 0.004 + lift + j1)), [ux, 0, uz], { area: r3((xb - xa) * (yb2 - ya)), thickness: T.wrap, col: "wrap", row: c, out: outV, tape });
        }
        ya0 = top;
      }
      // the siding stops at the trim round each opening
      const padded = opens.map((q) => ({ ...q, s0: q.s0 - TRIM_W, s1: q.s1 + TRIM_W, y0: q.door ? q.y0 : q.y0 - TRIM_W, y1: q.y1 + TRIM_W }));
      sidingCourses(out, id, {
        u: [ux, uz], out: outV, mat: w.mat, parent: w.id, y0: lo, y1: yt, off: o * (face + T.osb + 0.012), at, spans: (ya, yb2) => free(0, L, ya, yb2, padded), L, openings: opens,
        vbreaks: padded.flatMap((q) => [q.s0, q.s1]),
        vfree: (xa, xb) => {
          const cov = padded.filter((q) => q.s0 < xb - 1e-4 && q.s1 > xa + 1e-4).sort((p, q) => p.y0 - q.y0), r = [];
          let y = lo;
          for (const q of cov) (q.y0 - y > 0.02 && r.push([y, Math.min(q.y0, yt)]), (y = Math.max(y, q.y1)));
          yt - y > 0.02 && r.push([y, yt]);
          return r;
        },
      });
      if (spec.ins) {
        ups.sort((p, q) => p - q);
        for (let k = 0; k + 1 < ups.length; k++) {
          const g = ups[k + 1] - ups[k] - SB,
            mid = (ups[k] + ups[k + 1]) / 2;
          if (g < 0.06 || opens.some((q) => mid > q.s0 && mid < q.s1)) continue;
          M(out, id("in"), "insulation", "batt", "insulation", w.id, spec.ins, SD, g, at(mid, st0), at(mid, st1), [ux, 0, uz], { thickness: SD, area: r3(g * (st1 - st0)), col: "batt" });
        }
      }
    }
    if (spec.lining) M(out, w.id + ".ln", "lining", spec.lining, "lining", w.id, spec.lining === "gypsum" ? "gypsum_board" : "timber", spec.lining === "gypsum" ? T.gyp : T.lining, yt - yb, at(0, (yb + yt) / 2, -(o || 1) * (face + 0.01)), at(L, (yb + yt) / 2, -(o || 1) * (face + 0.01)), UP, { area: r3(net * (o ? 1 : 2)), thickness: spec.lining === "gypsum" ? T.gyp : T.lining, draw: 0 });
  }

  /* ---------- roofs ---------- */
  const rafterFor = (run) => (run <= 3.2 ? "2x6" : run <= 4.2 ? "2x8" : "2x10");
  // How each roof covering goes on, the way roofers lay it: in courses from the eave up, each lapping the one below
  // (h: how much of a course shows, up the slope; starter: a starter strip at the eave goes first), in panels side by
  // side from the eave to the ridge (w: panel width), or rolled out from the eave up (h: roll width). t: the thickness drawn.
  const COVERING = {
    asphalt: { how: "course", h: 0.45, starter: true, t: 0.012, col: "rAsphalt", name: "shingle" },
    shingle: { how: "course", h: 0.45, starter: true, t: 0.016, col: "rCedar", name: "shake" },
    slate: { how: "course", h: 0.35, starter: true, t: 0.014, col: "rSlate", name: "slate" },
    redslate: { how: "course", h: 0.35, starter: true, t: 0.014, col: "rRedslate", name: "slate" },
    tile: { how: "course", h: 0.38, starter: true, t: 0.03, col: "rTile", name: "tile" },
    thatch: { how: "course", h: 0.6, t: 0.18, col: "rThatch", name: "thatch" },
    seam: { how: "panel", w: 0.45, t: 0.03, col: "rSteel", name: "panel" },
    steel: { how: "panel", w: 0.45, t: 0.03, col: "rSteel", name: "panel" },
    copper: { how: "panel", w: 0.45, t: 0.03, col: "rCopper", name: "panel" },
    corrugated: { how: "panel", w: 0.8, t: 0.02, col: "rCorrugated", name: "sheet" },
    membrane: { how: "roll", h: 3.0, t: 0.004, col: "rMembrane", name: "membrane" },
    green: { how: "roll", h: 1.0, t: 0.07, col: "rGreen", name: "sedum mat" },
  };
  const coveringOf = (mat) => COVERING[mat] || COVERING.asphalt;
  // the colours of the roofing layers while they go on (build mode's member colours; the finished roof draws itself)
  const ROOF_COLORS = { rAsphalt: 0x4c4f55, rCedar: 0x8a6a48, rSlate: 0x56616c, rRedslate: 0x7b3b3b, rTile: 0xa9573b, rThatch: 0xb39a5c, rSteel: 0x7f8a92, rCopper: 0x5fa08a, rCorrugated: 0x9ba2a7, rMembrane: 0x2d2f33, rGreen: 0x5e8a3f, metal: 0xc3c8cc, icewater: 0x25272b, gutter: 0xe4e3de };
  const ROLL_W = 0.91, // underlayment comes in 36 inch rolls, laid along the eave, each strip lapping the one below by 10 cm
    ULAP = 0.1,
    TRIM_LEN = 3.05; // drip edge, ridge cap and gutter come in 10 ft lengths
  const lengths = (L, max) => {
    const k = Math.max(1, Math.ceil(L / max - 1e-9));
    return Array.from({ length: k }, (_, i) => [(L * i) / k, (L * (i + 1)) / k]);
  };
  // A roof plane's own coordinates: s along the eave from its first corner, t up the slope (as a horizontal run) from the
  // eave. on(s, t, lift) is a point lift off the plane's top surface. The outline in (s, t), where a line crosses it, and
  // whether a point is on it. The page uses the same frame to let the player stand on the deck.
  function planeFrame(pl) {
    const pts = pl.pts,
      e0 = pts[0],
      e1 = pts[1],
      EL = hyp(e1[0] - e0[0], e1[1] - e0[1]) || 1,
      ev = [(e1[0] - e0[0]) / EL, (e1[1] - e0[1]) / EL];
    let up = [-pl.facing[0], -pl.facing[1]];
    if (!pl.run) {
      // a flat roof: joists across the short way
      up = [-ev[1], ev[0]];
      const c = pts[2];
      if ((c[0] - e0[0]) * up[0] + (c[1] - e0[1]) * up[1] < 0) up = [ev[1], -ev[0]];
    }
    const k = pl.run ? (pl.ridgeY - pl.eaveY) / pl.run : 0,
      cs = 1 / Math.sqrt(1 + k * k),
      nS = [-up[0] * k * cs, cs, -up[1] * k * cs],
      st = pts.map((p) => [(p[0] - e0[0]) * ev[0] + (p[1] - e0[1]) * ev[1], (p[0] - e0[0]) * up[0] + (p[1] - e0[1]) * up[1]]);
    let top = 0;
    for (const q of st) top = Math.max(top, q[1]);
    const cut = (c, i) => {
      const xs = [];
      for (let a = 0, b = st.length - 1; a < st.length; b = a++) {
        const p = st[a],
          q = st[b];
        if (p[i] > c !== q[i] > c) xs.push(p[1 - i] + ((c - p[i]) / (q[i] - p[i])) * (q[1 - i] - p[1 - i]));
      }
      return xs.length < 2 ? null : [Math.min(...xs), Math.max(...xs)];
    };
    return {
      e0, ev, up, k, cs, nS, st, EL, top: pl.run || top, eaveY: pl.eaveY,
      on: (s, t, lift) => [e0[0] + ev[0] * s + up[0] * t + nS[0] * lift, pl.eaveY + k * t + nS[1] * lift, e0[1] + ev[1] * s + up[1] * t + nS[2] * lift],
      spanAt: (t) => cut(t, 1), // [s0, s1] of the line t across the plane
      reachAt: (s) => cut(s, 0), // [t0, t1] of the line s up the plane
      local: (x, z) => [(x - e0[0]) * ev[0] + (z - e0[1]) * ev[1], (x - e0[0]) * up[0] + (z - e0[1]) * up[1]],
      inside: (s, t) => {
        let o = false;
        for (let a = 0, b = st.length - 1; a < st.length; b = a++) {
          const p = st[a],
            q = st[b];
          if (p[1] > t !== q[1] > t && s < p[0] + ((t - p[1]) / (q[1] - p[1])) * (q[0] - p[0])) o = !o;
        }
        return o;
      },
    };
  }
  // r: { id, mat, planes: [{ id, pts, eaveY, ridgeY, run, facing }], ridges: [{ a, b, y }], infills: [{ id, a, b, y0, top(x, z) }],
  //      ties: [{ a, b, y }], gutters: [{ a: [x, z], b: [x, z], y, down: [x, z] }], groundY(x, z) } heights are from the structure's base
  function roofMembers(out, r, spec) {
    let n = 0;
    const id = (p, c) => p + "." + c + n++,
      sp = spec.rafters || 0.6,
      cv = coveringOf(r.mat),
      capped = cv.how !== "roll";
    for (const rd of r.ridges || []) {
      // a long ridge is spliced from boards that join between a pair of rafters
      const RL = hyp(rd.b[0] - rd.a[0], rd.b[1] - rd.a[1]) || 1,
        pt = (t) => [rd.a[0] + ((rd.b[0] - rd.a[0]) * t) / RL, rd.y - 0.1, rd.a[1] + ((rd.b[1] - rd.a[1]) * t) / RL],
        parts = splice(0, RL, 0, sp);
      parts.forEach(([p0, p1], k) => M(out, r.id + ".rb" + (k ? k : ""), "beam", "ridge", "roof-frame", r.planes[0].id, "timber", 0.038, LUMBER["2x8"][1], pt(p0), pt(p1), UP, { roof: r.id }));
    }
    for (const pl of r.planes) {
      const F = planeFrame(pl),
        pts = pl.pts,
        { ev, up, k, cs, nS, EL, on } = F,
        size = rafterFor(pl.run || 3),
        [RB, RD] = LUMBER[size],
        // how far up the slope a line from the eave stays on this plane
        reach = (s) => {
          const q = F.reachAt(s);
          return q && q[1] > 0 ? q[1] : 0;
        },
        rect = pts.length === 4 && Math.abs(polyArea(pts) - EL * (pl.run || reach(EL / 2))) < 0.02,
        ov = pl.overhang === undefined ? 0.45 : pl.overhang,
        inPlane = [up[0] * cs, k * cs, up[1] * cs],
        along = [ev[0], 0, ev[1]],
        at = [];
      if (rect && EL > 2 * ov + 0.5) {
        ov > 0.1 && at.push([RB / 2, "barge"]);
        for (let s = ov; s < EL - ov - 0.08; s += sp) at.push([s + (s === ov ? RB / 2 : 0), "common"]);
        at.push([EL - ov - RB / 2, "common"]);
        ov > 0.1 && at.push([EL - RB / 2, "barge"]);
      } else for (let s = sp / 2; s < EL; s += sp) at.push([s, "jack"]);
      const lens = [];
      for (const [s, type] of at) {
        const t = reach(s);
        if (t < 0.25) continue;
        lens.push([s, t]);
        M(out, id(pl.id, "rf"), "rafter", pl.run ? type : "roof-joist", "roof-frame", pl.id, "timber", RB, RD, on(s, 0, -(RD / 2 + T.osb)), on(s, t, -(RD / 2 + T.osb)), nS, { size });
      }
      const slope = F.top / cs,
        area = polyArea(pts) / cs;
      // rows of strips or sheets from the eave up, each cut to the outline at its middle: each(v0, v1, s0, s1, row)
      const rows = (h, lap, each, v00 = 0) => {
        for (let row = 0, v = v00; v < slope - 0.02; row++) {
          const vb = Math.min(slope, v + h),
            s = F.spanAt(((v + vb) / 2) * cs);
          s && s[1] - s[0] > 0.05 && each(v, vb, s[0], s[1], row);
          if (vb >= slope - 1e-6) break;
          v = vb - lap;
        }
      };
      // the roof deck: sheets from the eave up, joints staggered row by row
      rows(SHEET.w, 0, (v, vb, s0, s1, row) => {
        for (let u = s0 - (row % 2 ? SHEET.l / 2 : 0); u < s1 - 0.01; u += SHEET.l) {
          const ua = Math.max(s0, u),
            ub = Math.min(s1, u + SHEET.l),
            tm = ((v + vb) / 2) * cs;
          if (ub - ua > 0.02) M(out, id(pl.id, "dk"), "sheathing", "roof-deck", "roof-deck", pl.id, "osb", T.osb, vb - v, on(ua, tm, -T.osb / 2), on(ub, tm, -T.osb / 2), inPlane, { area: r3((ub - ua) * (vb - v)), thickness: T.osb, col: "osb", rs: [ua, ub, v * cs, vb * cs] });
        }
      });
      // drying in: drip edge along the eave; underlayment strips from the eave up, each lapping the one below (the first, at
      // the eave, is ice-and-water shield); then drip edge up the rakes, over the underlayment
      if (pl.drip !== false) for (const [a, b] of lengths(EL, TRIM_LEN)) M(out, id(pl.id, "de"), "drip", "eave", "dry-in", pl.id, "metal", 0.012, 0.08, on(a, 0.03 * cs, 0.006), on(b, 0.03 * cs, 0.006), inPlane, { col: "metal" });
      rows(ROLL_W, ULAP, (v, vb, s0, s1, row) => {
        const ice = row === 0,
          lift = 0.003 + row * 0.0006;
        M(out, pl.id + ".ul" + row, "membrane", ice ? "ice-water" : "underlayment", "dry-in", pl.id, ice ? "icewater" : "underlayment", 0.002, s1 - s0, on((s0 + s1) / 2, v * cs, lift), on((s0 + s1) / 2, vb * cs, lift), along, { area: r3((s1 - s0) * (vb - v)), thickness: 0.001, col: ice ? "icewater" : "felt", row, course: 1, roll: 1, out: nS, rs: [s0, s1, v * cs, vb * cs] });
      });
      if (rect && pl.run)
        for (const s of [0.03, EL - 0.03]) for (const [a, b] of lengths(slope, TRIM_LEN)) M(out, id(pl.id, "dr"), "rake", "rake", "dry-in", pl.id, "metal", 0.012, 0.08, on(s, a * cs, 0.012), on(s, b * cs, 0.012), along, { col: "metal" });
      // the covering, from the eave up
      const base = 0.014 + cv.t / 2;
      if (cv.how === "course") {
        // a starter strip at the eave, then course over course; each course's joints fall half a bundle from the ones below
        const bands = [];
        if (cv.starter) bands.push([0, Math.min(slope, 0.25), "starter"]);
        for (let v = 0; v < slope - 0.02; v += cv.h) bands.push([v, Math.min(slope, v + cv.h + 0.04), "course", Math.min(slope, v + cv.h)]);
        bands.forEach(([v, vb, type, vx], row) => {
          const tm = ((v + vb) / 2) * cs,
            s = F.spanAt(tm),
            lift = base + row * 0.0015 - (type === "starter" ? 0.004 : 0);
          if (!s || s[1] - s[0] < 0.05) return;
          let j = 0;
          for (let u = s[0] - (row % 2 ? TRIM_LEN / 2 : 0); u < s[1] - 0.01; u += TRIM_LEN) {
            const ua = Math.max(s[0], u),
              ub = Math.min(s[1], u + TRIM_LEN);
            if (ub - ua > 0.05) M(out, pl.id + ".rc" + row + "." + j++, "roofing", type, "roofing", pl.id, r.mat || "thatch", cv.t, vb - v, on(ua, tm, lift), on(ub, tm, lift), inPlane, { area: r3((ub - ua) * ((vx || vb) - v)), thickness: 0.001, col: cv.col, row, course: 1, rs: [ua, ub, v * cs, vb * cs] });
          }
        });
      } else if (cv.how === "panel") {
        // standing seam (or corrugated sheets): panels side by side along the eave, each running eave to ridge
        const np = Math.max(1, Math.round(EL / cv.w)),
          w = EL / np;
        for (let i = 0; i < np; i++) {
          const sm = (i + 0.5) * w,
            q = F.reachAt(sm);
          if (!q || q[1] - q[0] < 0.1) continue;
          M(out, pl.id + ".pn" + i, "roofing", "panel", "roofing", pl.id, r.mat || "steel", cv.t, w - 0.006, on(sm, q[0], base), on(sm, q[1], base), along, { area: r3((w * (q[1] - q[0])) / cs), thickness: 0.001, col: cv.col, rs: [i * w, (i + 1) * w, q[0], q[1]] });
        }
      } else {
        // a membrane (or sedum mats) rolled out along the eave, each roll lapping the one below
        rows(cv.h, 0.08, (v, vb, s0, s1, row) => {
          M(out, pl.id + ".rc" + row, "roofing", "roll", "roofing", pl.id, r.mat || "membrane", cv.t, s1 - s0, on((s0 + s1) / 2, v * cs, base + row * 0.001), on((s0 + s1) / 2, vb * cs, base + row * 0.001), along, { area: r3((s1 - s0) * (vb - v)), thickness: 0.001, col: cv.col, row, course: 1, roll: 1, out: nS, rs: [s0, s1, v * cs, vb * cs] });
        });
      }
      // last, the caps: a single slope's top edge, or a hip
      if (capped && pl.run && rect && !(r.ridges || []).length)
        for (const [a, b] of lengths(EL, TRIM_LEN)) M(out, id(pl.id, "cp"), "ridgecap", "top", "roofing", pl.id, r.mat || "thatch", 0.03, 0.2, on(a, F.top - 0.1 * cs, base + 0.03), on(b, F.top - 0.1 * cs, base + 0.03), inPlane, { col: cv.col });
      if (capped && pl.run && !rect && pts.length >= 3 && !r.hips) {
        const h0 = on(F.st[1][0], F.st[1][1], base + 0.03),
          h1 = on(F.st[2][0], F.st[2][1], base + 0.03),
          HL = hyp(h1[0] - h0[0], h1[1] - h0[1], h1[2] - h0[2]),
          hz = hyp(h1[0] - h0[0], h1[2] - h0[2]) || 1,
          hn = [-(h1[2] - h0[2]) / hz, 0, (h1[0] - h0[0]) / hz];
        for (const [a, b] of lengths(HL, TRIM_LEN)) M(out, id(pl.id, "cp"), "ridgecap", "hip", "roofing", pl.id, r.mat || "thatch", 0.035, 0.28, h0.map((v, i) => v + ((h1[i] - v) * a) / HL), h0.map((v, i) => v + ((h1[i] - v) * b) / HL), hn, { col: cv.col });
      }
      void area;
      if (spec.ins)
        for (let q = 0; q + 1 < lens.length; q++) {
          const g = lens[q + 1][0] - lens[q][0] - RB,
            t = Math.min(lens[q][1], lens[q + 1][1]),
            s = (lens[q][0] + lens[q + 1][0]) / 2;
          if (g > 0.06) M(out, id(pl.id, "in"), "insulation", "roof-batt", "insulation", pl.id, spec.ins, RD, g, on(s, 0.3 * cs, -(RD / 2 + T.osb)), on(s, t, -(RD / 2 + T.osb)), [ev[0], 0, ev[1]], { thickness: RD, area: r3((g * (t - 0.3 * cs)) / cs), col: "batt" });
        }
      if (spec.lining) M(out, pl.id + ".ln", "lining", "ceiling", "lining", pl.id, spec.lining === "gypsum" ? "gypsum_board" : "timber", T.lining, slope, on(0, 0, -RD), on(EL, 0, -RD), nS, { area: r3(area), thickness: T.lining, draw: 0 });
    }
    // the ridge cap goes on last, over the top courses of both slopes
    if (capped)
      for (const rd of r.ridges || []) {
        const RL = hyp(rd.b[0] - rd.a[0], rd.b[1] - rd.a[1]) || 1,
          ux = (rd.b[0] - rd.a[0]) / RL,
          uz = (rd.b[1] - rd.a[1]) / RL,
          pt = (t) => [rd.a[0] + ux * t, rd.y + 0.035 + coveringOf(r.mat).t, rd.a[1] + uz * t];
        for (const [a, b] of lengths(RL, TRIM_LEN)) M(out, id(r.id, "cap"), "ridgecap", "ridge", "roofing", r.planes[0].id, r.mat || "thatch", 0.04, 0.34, pt(a), pt(b), [-uz, 0, ux], { col: cv.col });
      }
    // hip caps, along each hip from the eave corner up to the ridge
    if (capped)
      (r.hips || []).forEach((hp) => {
        const h0 = [hp.a[0], hp.y0 + 0.035 + cv.t, hp.a[1]],
          h1 = [hp.b[0], hp.y1 + 0.035 + cv.t, hp.b[1]],
          HL = hyp(h1[0] - h0[0], h1[1] - h0[1], h1[2] - h0[2]),
          hz = hyp(h1[0] - h0[0], h1[2] - h0[2]) || 1,
          hn = [-(h1[2] - h0[2]) / hz, 0, (h1[0] - h0[0]) / hz];
        if (HL > 0.2) for (const [a, b] of lengths(HL, TRIM_LEN)) M(out, id(r.id, "hc"), "ridgecap", "hip", "roofing", r.planes[0].id, r.mat || "thatch", 0.035, 0.28, h0.map((v, i) => v + ((h1[i] - v) * a) / HL), h0.map((v, i) => v + ((h1[i] - v) * b) / HL), hn, { col: cv.col });
      });
    // gutters along the eaves, falling about 5 mm a metre toward a downspout that runs down to the ground
    (r.gutters || []).forEach((gt, gi) => {
      const L = hyp(gt.b[0] - gt.a[0], gt.b[1] - gt.a[1]);
      if (!(L > 0.3)) return;
      const gid = r.id + ".gt" + gi,
        d = gt.down || gt.b,
        toB = hyp(d[0] - gt.b[0], d[1] - gt.b[1]) <= hyp(d[0] - gt.a[0], d[1] - gt.a[1]),
        P = (u) => [gt.a[0] + ((gt.b[0] - gt.a[0]) * u) / L, gt.y - 0.005 * (toB ? u : L - u), gt.a[1] + ((gt.b[1] - gt.a[1]) * u) / L];
      for (const [a, b] of lengths(L, TRIM_LEN)) M(out, id(gid, "g"), "gutter", "gutter", "gutters", gid, "aluminium", 0.11, 0.1, P(a), P(b), UP, { col: "gutter" });
      // a downspout from each outlet, down the wall to the ground (src/build.js roofParts gives the outlets and the wall behind them)
      (gt.downs || [d]).forEach((dn, k) => {
        const w = (gt.wall && gt.wall[k]) || dn,
          gy = r.groundY ? r.groundY(w[0], w[1]) : -0.45,
          ylo = gt.y - 0.005 * L - 0.12;
        if (ylo - gy > 0.3) M(out, gid + ".ds" + (k || ""), "downspout", "downspout", "gutters", gid, "aluminium", 0.07, 0.07, [w[0], ylo, w[1]], [w[0], gy + 0.08, w[1]], [1, 0, 0], { col: "gutter" });
      });
    });
    // ties across the building at the top of the walls stop the rafters pushing the walls apart
    for (const t of r.ties || []) M(out, id(r.id, "cj"), "joist", "ceiling", "roof-frame", r.planes[0].id, "timber", 0.038, 0.14, [t.a[0], t.y + 0.07, t.a[1]], [t.b[0], t.y + 0.07, t.b[1]], UP, { roof: r.id });
    for (const g of r.infills || []) {
      const L = hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]),
        ux = (g.b[0] - g.a[0]) / L,
        uz = (g.b[1] - g.a[1]) / L,
        nrm = [-uz, 0, ux];
      let area = 0;
      for (let s = 0.2; s < L - 0.05; s += 0.4) {
        const x = g.a[0] + ux * s,
          z = g.a[1] + uz * s,
          top = g.top(x, z) - 0.16;
        area += Math.max(0, top + 0.16 - g.y0) * 0.4;
        if (top - g.y0 > 0.12) M(out, id(g.id, "st"), "stud", "gable", "roof-frame", g.id, "timber", 0.038, 0.089, [x, g.y0, z], [x, top, z], nrm);
      }
      const o = g.out || 1,
        mid = [(g.a[0] + g.b[0]) / 2, g.y0, (g.a[1] + g.b[1]) / 2],
        ext = { area: r3(g.area || area), draw: 0, roof: r.id };    // the gable belongs to its roof: hidden with it when you are inside
      M(out, g.id + ".sh", "sheathing", "wall", "sheathing", g.id, "osb", T.osb, L, mid, [mid[0], g.y1 || g.y0 + 1, mid[2]], [ux, 0, uz], { ...ext, thickness: T.osb });
      M(out, g.id + ".wr", "membrane", "housewrap", "wrap", g.id, "housewrap", T.wrap, L, mid, [mid[0], g.y1 || g.y0 + 1, mid[2]], [ux, 0, uz], { ...ext, thickness: T.wrap });
      {
        // siding on the gable: the same courses, each cut to the roof slope (stepped lengths)
        const gt = (q) => g.top(g.a[0] + ux * q, g.a[1] + uz * q) - 0.16;
        let gn = 0;
        sidingCourses(out, (c) => g.id + "." + c + gn++, { u: [ux, uz], out: [nrm[0] * o, 0, nrm[2] * o], mat: g.mat, parent: g.id, roof: r.id, y0: g.y0, y1: g.y1 || g.y0 + 1, trim: false, off: o * (0.0445 + T.osb + 0.012), L,
          at: (q, y, off) => [g.a[0] + ux * q + nrm[0] * (off || 0), y, g.a[1] + uz * q + nrm[2] * (off || 0)],
          spans: (ya) => { let lo = -1, hi = -1; for (let q = 0; q <= L + 1e-6; q += 0.02) if (gt(q) > ya + 0.1) { lo < 0 && (lo = q); hi = q; } return lo >= 0 && hi - lo > 0.1 ? [[lo, hi]] : []; },
          // board and batten goes on up the gable: each vertical board stops under the rake (at the lower of its two top corners)
          vfree: (xa, xb) => { const top = Math.min(gt(xa), gt(xb)); return top > g.y0 + 0.1 ? [[g.y0, top]] : []; } });
      }
      void o;
    }
  }

  // desc: { found, spec: { ins, lining, studs, joists, rafters }, floors, walls, roofs } -> members
  function generate(desc) {
    const out = [],
      spec = desc.spec || {};
    for (const f of desc.floors || []) floorMembers(out, f, desc.found || "plinth", spec);
    for (const w of desc.walls || []) wallMembers(out, w, spec);
    for (const r of desc.roofs || []) roofMembers(out, r, spec);
    return out;
  }

  /* ---------- what to buy ---------- */
  const sizeOf = (m) => {
    const b = Math.min(m.section.b, m.section.d),
      d = Math.max(m.section.b, m.section.d);
    for (const k in LUMBER) if (Math.abs(LUMBER[k][0] - b) < 0.002 && Math.abs(LUMBER[k][1] - d) < 0.002) return k;
    return null;
  };
  const INS_ITEM = { fibreglass_batt: "ins_fibreglass_89", mineral_wool: "ins_mineral_89", sheep_wool: "ins_wool_89", cellulose: "ins_cellulose_140" };
  const ROOF_ITEM = { thatch: "roof_thatch", slate: "roof_slate", redslate: "roof_slate", tile: "roof_clay", shingle: "roof_cedar", copper: "roof_steel", steel: "roof_steel", asphalt: "roof_asphalt", seam: "roof_steel", corrugated: "roof_corrugated", membrane: "roof_epdm", green: "roof_green" };
  const FLOOR_ITEM = { planks: ["board_pine_1x6", "m"], dark: ["board_oak_1x6", "m"], flags: ["flagstone_40", "m2"], cobble: ["flagstone_40", "m2"] };
  // what a member is bought as: [key, itemId, unit, quantity, label, why]
  function buyAs(m) {
    const k = m.kind,
      t = m.type,
      sz = k === "header" ? m.size : m.section ? sizeOf(m) : null,
      lum = (label, why, plies) => [label + sz, sz ? "lumber_" + sz : null, "m", m.length * (plies || 1), label + " (" + (sz || "timber").replace("x", " x ") + ")", why];
    if (k === "site") return null;
    if (k === "stud") return lum(t === "gable" ? "Gable studs" : "Studs", t === "gable" ? "Short uprights that fill the triangle under the roof at each end." : "The uprights inside your walls. They carry the roof down to the floor.");
    if (k === "plate") return t === "sill" && m.stage === "floor-frame" ? lum("Sill plates", "Boards bolted flat on top of the foundation wall. The floor frame sits on them.") : lum("Wall plates", "The boards along the bottom and top of each wall. The studs are nailed between them.");
    if (k === "header" && m.size === "glulam") return ["Beams" + sz, "glulam_90x225", "m", m.length, "Engineered beam (90 x 225)", "A glued-laminated beam over a wide opening. Plain boards would sag across it."];
    if (k === "header") return lum("Headers", "The beam over a door or window. It carries the load above around the opening.", 2);
    if (k === "joist") return t === "ceiling" ? lum("Ceiling joists", "Ties across the top of the walls. They stop the rafters pushing the walls apart.") : t === "rim" ? lum("Rim joists", "The boards that close the ends of the floor joists and hold them upright.") : lum("Floor joists", "The beams of the floor, 40 cm apart. Closer joists make a stiffer floor.");
    if (k === "rafter") return lum("Rafters", "The sloping beams of the roof. They carry rain and snow out to the walls.");
    if (k === "beam") return t === "ridge" ? lum("Ridge board", "The board along the peak. The rafters meet on it.") : lum("Beams", "Heavy timbers on the piers. The floor joists rest on them.");
    if (k === "skid") return lum("Skids", "Heavy timbers lying on the gravel. The whole building sits on them.");
    if (k === "post") return lum("Posts", "Short posts that bring each pier up to the level of the beams.");
    if (k === "pier" && t === "block") return ["pierblock", null, "each", 1, "Pier blocks", "Concrete blocks that keep the wood off the wet ground and carry the weight.", "a precast concrete pier block"];
    if (k === "pier" || k === "stemwall" || k === "slab" || (k === "footing" && m.material === "concrete")) return ["concrete", "concrete_mix", "kg", (m.volume || 0) * 2400 * 0.9, "Concrete mix", "Poured for the foundation: it spreads the weight of the building onto firm ground."];
    if (k === "footing") return ["gravel", "gravel", "m3", m.volume || 0, "Gravel", "A firm, free-draining bed under the foundation so it does not settle or sit in water."];
    if (k === "sheathing") return t === "subfloor" ? ["sub", "osb_18", "sheet", m.area, "Subfloor sheets", "Sheets across the joists. They give you a deck to stand and build on."] : t === "roof-deck" ? ["deck", "osb_11", "sheet", m.area, "Roof sheets", "Sheets on the rafters. They make the roof one stiff surface for the roofing."] : ["wallsh", "osb_11", "sheet", m.area, "Wall sheathing", "Sheets nailed to the outside of the studs. They stop the frame leaning over in wind."];
    if (k === "drip" || k === "rake") return ["drip", "drip_edge", "m", m.length, "Drip edge", "A bent metal strip along the roof edges: water runs off it clear of the fascia, never back under the roof."];
    if (k === "ridgecap") return ["ridgecap", "ridge_cap", "m", m.length, "Ridge cap", "Caps the top of the roof, lapped over the last courses. The last piece on: after it the roof is dried in."];
    if (k === "gutter") return ["gutter", "gutter_alu", "m", m.length, "Gutters", "Catch the rain off the eaves and carry it to the downspout, away from the foundation."];
    if (k === "downspout") return ["downspout", "downspout_alu", "m", m.length, "Downspouts", "Carry the water from the gutter down to the ground, a drain or a rain barrel."];
    if (k === "membrane" && t === "ice-water") return ["icewater", "roof_ice_water", "m2", m.area, "Ice and water shield", "A sticky rubber strip along the eaves, where ice dams and driven rain would get under the roofing."];
    if (k === "membrane") return t === "housewrap" ? ["wrap", "housewrap", "m2", m.area, "Housewrap", "Keeps wind and rain out of the wall while letting damp escape."] : ["felt", null, "m2", m.area, "Roof underlayment", "A waterproof layer under the roofing, the second line of defence against leaks.", "roofing underlayment by the square metre"];
    if (k === "cladding" && t === "batten") return ["batten" + m.material, "board_pine_1x6", "m", m.area / 0.14, "Battens", "Narrow strips nailed over each joint between boards. They keep the rain out of the gaps."];
    if (k === "cladding") return ["clad" + m.material, m.material === "dark" ? "board_oak_1x6" : m.material === "log" ? "board_cedar_1x6" : "board_pine_1x6", "m", m.area / 0.14, "Siding boards", "The boards on the outside. They protect the wall from weather and sun."];
    if (k === "roofing") return ["roof" + m.material, ROOF_ITEM[m.material] || null, "m2", m.area, "Roofing", "The outer skin of the roof. It keeps the water out.", ROOF_ITEM[m.material] ? undefined : "roofing: " + m.material];
    if (k === "insulation") return ["ins" + m.material, INS_ITEM[m.material] || null, "m2", m.area, "Insulation batts", "Fills the spaces between studs, joists and rafters. It slows heat leaving in winter.", INS_ITEM[m.material] ? undefined : "insulation: " + m.material];
    if (k === "lining" && t === "flooring") {
      const f = FLOOR_ITEM[m.material];
      return ["floor" + m.material, f ? f[0] : null, f ? f[1] : "m2", f && f[1] === "m" ? m.area / 0.14 : m.area, "Flooring", "The finished floor you walk on.", f ? undefined : "flooring: " + m.material];
    }
    if (k === "lining") return t === "gypsum" ? ["gyp", "gypsum_13", "sheet", m.area, "Wall panels", "Panels on the inside of the walls. They cover the insulation and finish the room."] : ["lin", "board_pine_1x6", "m", m.area / 0.14, "Lining boards", "Boards on the inside of the walls and ceiling. They cover the insulation and finish the room."];
    if ((k === "door" || k === "window") && m.unit) return ["u" + m.unit, m.unit, "each", 1, m.unitName || (k === "door" ? "Door" : "Window"), "A ready-made " + k + " in its frame. It is carried in, set into its rough opening and nailed through the frame."];
    if (k === "door") return ["door", null, "each", 1, "Doors", "A way in that closes. Without it the room is not enclosed.", "a door"];
    if (k === "window") return ["window", "glass_float_4", "m2", m.area || 0.6, "Window glass", "Lets light in while keeping the weather out."];
    return null;
  }
  // Sheet goods are cut to fit: pieces are cut biggest first, each from the smallest offcut that will do, else from a new sheet
  // whose rest is kept (a rest under MIN_KEEP is waste). Same rule as src/sim/content/construction.js (packSheets).
  const MIN_KEEP = 0.06;
  function packSheets(areas) {
    const A = SHEET.w * SHEET.l, pool = [];
    let sheets = 0;
    for (const a0 of areas.slice().sort((p, q) => q - p)) {
      const a = Math.min(a0, A),
        k = pool.findIndex((o) => o >= a - 1e-9);
      let rest;
      if (k >= 0) rest = pool.splice(k, 1)[0] - a;
      else (sheets++, (rest = A - a));
      if (rest >= MIN_KEEP) (pool.push(Math.round(rest * 1e6) / 1e6), pool.sort((x, y) => x - y));
    }
    return sheets;
  }
  // the metres of whole sticks a set of pieces is sawn from: longest first, each from the shortest offcut that holds it, else a
  // new stick of the shortest stock length (the same rule as packSticks in src/sim/content/construction.js)
  function packSticks(lens) {
    const pool = [];
    let metres = 0;
    for (const len of lens.slice().sort((p, q) => q - p)) {
      let k = -1;
      for (let i = 0; i < pool.length; i++) if (pool[i] >= len - 1e-9 && (k < 0 || pool[i] < pool[k])) k = i;
      let from;
      if (k >= 0) from = pool.splice(k, 1)[0];
      else ((from = STOCK.find((L) => L >= len - 1e-9) || Math.ceil((len - 1e-9) / 0.6) * 0.6), (metres += from));
      const rest = from - len < 1e-6 ? 0 : from - len - KERF;
      rest >= KEEP && pool.push(Math.round(rest * 1e6) / 1e6);
    }
    return Math.round(metres * 1e6) / 1e6;
  }
  // members (or pieces with the same fields) -> lines to buy, in stage order: { stage, itemId, qty, unit, label, why }
  function materialsList(members) {
    const lines = new Map(),
      nails = new Map();
    for (const m of members) {
      const q = m.stage && buyAs(m);
      if (!q) continue;
      const key = m.stage + "|" + q[0];
      let ln = lines.get(key);
      if (!ln) lines.set(key, (ln = { key, stage: m.stage, itemId: q[1], qty: 0, unit: q[2], label: q[4], why: q[5], count: 0, members: [] }));
      ln.members.push([m.id, r3(q[3])]);
      if (q[2] === "m" && /^lumber_/.test(q[1] || "")) (ln.pieces || (ln.pieces = [])).push(...Array(m.plies || 1).fill(m.length));
      if (q[6]) ln.missing = q[6];
      ln.qty += q[3];
      ln.count++;
      // fasteners: about 25 g of nails for each metre of framing, 60 g of screws for each square metre of sheet
      if (q[2] === "m" && /^lumber_/.test(q[1] || "")) nails.set(m.stage + "|nails_framing", (nails.get(m.stage + "|nails_framing") || 0) + m.length * 0.025);
      else if (q[2] === "sheet") nails.set(m.stage + "|screws_wood", (nails.get(m.stage + "|screws_wood") || 0) + m.area * 0.06);
    }
    for (const [key, kg] of nails) {
      const [stage, item] = key.split("|");
      lines.set(key, { key, members: [], stage, itemId: item, qty: kg, unit: "kg", label: item === "nails_framing" ? "Framing nails" : "Screws", why: item === "nails_framing" ? "Hold the frame together. Bought by weight and used up as you build." : "Fix the sheets down. Bought by weight and used up as you build.", count: 0 });
    }
    const out = [...lines.values()];
    for (const ln of out) {
      if (ln.unit === "sheet") ((ln.areaM2 = r3(ln.qty)), (ln.qty = packSheets(ln.members.map((q) => q[1]))), (ln.unit = "each"));
      else if (ln.pieces) ((ln.lengthM = r3(ln.qty)), (ln.qty = packSticks(ln.pieces)), delete ln.pieces);
      else if (ln.unit === "each") ln.qty = Math.round(ln.qty);
      else if (ln.unit === "kg") ln.qty = ln.itemId === "concrete_mix" ? Math.ceil(ln.qty / 25) * 25 : Math.ceil(ln.qty * 2) / 2;
      else ln.qty = Math.ceil(ln.qty * 10 - 1e-6) / 10;
    }
    return out.sort((p, q) => STAGES.indexOf(p.stage) - STAGES.indexOf(q.stage) || (p.label < q.label ? -1 : 1));
  }

  globalThis.__framing = { planeFrame, COVERING, coveringOf, ROOF_COLORS, packSheets, packSticks, STOCK, MAX_RUN, splice, STAGES, STAGE_NAME, LUMBER, SHEET, FOUNDATIONS, generate, materialsList, floorMembers, wallMembers, roofMembers, FLOOR_T };
})();
