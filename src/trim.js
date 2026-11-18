/* Interior trim as a finish carpenter puts it up (docs/TRIM.md): for each finished room, every piece of trim in the style
   chosen for the building, with its real size and place, and the order it goes in:
     window stool        the shelf at the foot of each window, set first
     casing              round every door and window: two legs and a head, mitred at the corners (Colonial, Modern) or
                         butted under a wider head with a cap (Craftsman, Farmhouse); a Modern window is framed on all four sides
     apron               under each stool
     baseboard           round the walls, stopping at the door casing it butts into; shoe moulding along its foot on a hard floor
     crown               where the walls meet the ceiling (Colonial)
     caulk, fill, paint  one pass per room: the seams caulked, the nail holes filled, the trim painted or oiled. Until then
                         it shows primed (or raw wood); after, its finished colour (`col` -> `paintCol`)
   Every piece is a member like the framing's, stage "trim", cut from stock on the mitre saw (`cut` -> `cutTo`), nailed
   with no heads on show (`pts`), sitting a little off the wall while loose (`out`). Pure arithmetic: no DOM, no three.js.
   The page reads it as window.__trim; tests read globalThis.__trim. Needs src/flooring.js (the room and the floor's top). */
(() => {
  // a style: casing width cw and thickness ct; head: "mitre" (as wide as the legs, a frame) or "butt" (a wider board hh on
  // top of the legs, with ears and a cap); base height bh and thickness bt; stool and apron under windows, or a picture frame;
  // shoe moulding on hard floors; crown at the ceiling. col: raw or primed; paintCol: finished. item ids it is bought as.
  const TRIMS = {
    craftsman: { name: "Craftsman", cw: 0.089, ct: 0.019, head: "butt", hh: 0.14, ear: 0.013, cap: true, bh: 0.14, bt: 0.019, stool: true, shoe: false, crown: false, col: "trFir", paintCol: "trFirStained", finish: "Stained and oiled",
      items: { casing: "trim_flat_1x4", head: "trim_flat_1x6", base: "trim_flat_1x6", stool: "window_stool" } },
    colonial: { name: "Colonial", cw: 0.057, ct: 0.016, head: "mitre", bh: 0.083, bt: 0.014, stool: true, shoe: true, crown: true, col: "trPrimed", paintCol: "trWhite", finish: "Painted white",
      items: { casing: "casing_colonial", head: "casing_colonial", base: "baseboard_primed", stool: "window_stool", shoe: "shoe_moulding", crown: "crown_moulding" } },
    modern: { name: "Modern", cw: 0.064, ct: 0.012, head: "mitre", bh: 0.089, bt: 0.012, stool: false, shoe: false, crown: false, col: "trPrimed", paintCol: "trWhite", finish: "Painted white",
      items: { casing: "trim_mdf_square", head: "trim_mdf_square", base: "trim_mdf_base" } },
    farmhouse: { name: "Farmhouse", cw: 0.14, ct: 0.022, head: "butt", hh: 0.14, ear: 0.025, cap: false, bh: 0.184, bt: 0.022, stool: true, shoe: false, crown: false, col: "trPineRough", paintCol: "trPineOiled", finish: "Oiled",
      items: { casing: "trim_rough_1x6", head: "trim_rough_1x6", base: "trim_rough_1x8", stool: "window_stool" } },
  };
  const TRIM_COLORS = { trPrimed: 0xe4e1d8, trWhite: 0xf4f2ec, trFir: 0xc99c68, trFirStained: 0x8c5e36, trPineRough: 0xbf9f74, trPineOiled: 0x9b7448 };
  const REVEAL = 0.006,          // the casing stands back this far from the edge of the jamb
    STOCK = { casing: 2.4, head: 2.4, base: 4.8, shoe: 2.4, crown: 3.6, stool: 2.4, apron: 2.4 },
    STOOL = { t: 0.025, d: 0.09, horn: 0.02, out: 0.055 },
    SHOE = { h: 0.019, t: 0.013 },
    CROWN = { h: 0.095, t: 0.06 },
    CAP = { h: 0.022, t: 0.035 };
  const r3 = (v) => Math.round(v * 1000) / 1000,
    hash = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };

  // f: the floor ({ id, outline, y0, mat, walls }); g: { M, top (the subfloor's top), base, style }
  function members(out, f, g) {
    const T = TRIMS[g.style], FL = globalThis.__flooring;
    if (!T || !FL || !f.outline || f.outline.length < 3) return;
    const { M } = g, y0 = f.y0 || 0, { edges } = FL.roomOf(f.outline, f.walls || []),
      floor = FL.finishTop ? FL.finishTop(f.mat, g.base, g.top) : g.top,
      hard = !/carpet|berber/.test(f.mat || ""),
      col = T.col, paintCol = T.paintCol;
    if (!edges.some((e) => e.walled)) return;
    let n = 0;
    const id = (c) => f.id + ".t" + c + "_" + g.style + n++, all = [];
    // a point on a wall's face: s along it, h above the floor's base, off out from the face into the room
    const at = (e, s, h, off) => [e.p[0] + e.u[0] * s + e.nIn[0] * off, y0 + h, e.p[1] + e.u[1] * s + e.nIn[1] * off];
    const U = (e) => [e.u[0], 0, e.u[1]], N = (e) => [e.nIn[0], 0, e.nIn[1]], UP = [0, 1, 0];
    // brad nails into the framing every 0.4 m: no heads on show, they are set and filled
    const nails = (a, b, lift) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), k = Math.max(1, Math.round(L / 0.4)), o = []; for (let i = 0; i < k; i++) { const t = (i + 0.5) / k; o.push([a[0] + (b[0] - a[0]) * t + lift[0], a[1] + (b[1] - a[1]) * t + lift[1], a[2] + (b[2] - a[2]) * t + lift[2]]); } return o; };
    const piece = (code, kind, type, item, e, a, b, dir, d, t, stock, extra = {}) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), face = N(e).map((v) => v * (t / 2 + 0.003));
      const m = M(out, id(code), kind, type, "trim", f.id, item, t, d, a, b, dir, {
        length: r3(L), area: r3(L * d), col, paintCol, tone: hash(n, L), vary: /Rough|Fir/.test(col) ? 0.08 : 0.015, out: [e.nIn[0], 0.15, e.nIn[1]],
        pts: nails(a, b, face), cut: r3(Math.max(stock, L + 0.05)), cutTo: r3(L), trim: g.style, item, ...extra,
      });
      all.push(m);
      return m;
    };

    for (const e of edges) {
      if (!e.walled) continue;
      const opens = (e.opens || []).filter((o) => o.s1 - o.s0 > 0.2);
      const doors = opens.filter((o) => (o.sill || 0) < 0.2), wins = opens.filter((o) => (o.sill || 0) >= 0.2);
      // casing round each door and window, on this room's side of the wall
      for (const o of opens) {
        const isWin = (o.sill || 0) >= 0.2, cw = T.cw, ct = T.ct, off = ct / 2 + 0.001,
          sL = o.s0 - REVEAL - cw / 2, sR = o.s1 + REVEAL + cw / 2,
          top = (o.sill || 0) + o.height + REVEAL,
          foot = isWin ? (T.stool ? o.sill + STOOL.t * 0.5 : o.sill - REVEAL - cw) : floor;
        if (sL - cw / 2 < -0.02 || sR + cw / 2 > e.L + 0.02) continue;     // jammed against a corner: no room for a casing
        // the window stool first: a shelf across the foot of the opening, horns past the casing, nosing into the room
        if (isWin && T.stool) {
          const sy = o.sill + 0.001, w0 = sL - cw / 2 - STOOL.horn, w1 = sR + cw / 2 + STOOL.horn, so = STOOL.out - STOOL.d / 2;
          piece("s", "stool", "stool", T.items.stool, e, at(e, w0, sy, so), at(e, w1, sy, so), N(e), STOOL.d, STOOL.t, STOCK.stool, { pts: nails(at(e, w0 + 0.1, sy + STOOL.t / 2 + 0.003, so), at(e, w1 - 0.1, sy + STOOL.t / 2 + 0.003, so), [0, 0, 0]), out: [0, 1, 0] });
        }
        const mitre = T.head === "mitre", headH = mitre ? cw : T.hh, legTop = mitre ? top + cw : top;
        // the legs, then the head (mitred: as wide as the legs, between them; butted: a wider board resting on them, with ears)
        for (const s of [sL, sR]) piece("c", "casing", "leg", T.items.casing, e, at(e, s, foot, off), at(e, s, legTop, off), U(e), cw, ct, STOCK.casing, { out: [e.nIn[0], 0.05, e.nIn[1]] });
        const hx0 = mitre ? sL + cw / 2 : sL - cw / 2 - (T.ear || 0), hx1 = mitre ? sR - cw / 2 : sR + cw / 2 + (T.ear || 0), hy = mitre ? top + cw / 2 : top + headH / 2;
        piece("h", "casing", "head", T.items.head, e, at(e, hx0, hy, off), at(e, hx1, hy, off), UP, headH, ct, STOCK.head);
        if (T.cap) piece("k", "casing", "cap", T.items.head, e, at(e, hx0 - 0.006, top + headH + CAP.h / 2, CAP.t / 2), at(e, hx1 + 0.006, top + headH + CAP.h / 2, CAP.t / 2), UP, CAP.h, CAP.t, STOCK.head);
        // the bottom of a picture-framed window; or the apron under the stool, as wide as the casing outside to outside
        if (isWin && !T.stool) piece("b", "casing", "sill", T.items.casing, e, at(e, sL + cw / 2, o.sill - REVEAL - cw / 2, off), at(e, sR - cw / 2, o.sill - REVEAL - cw / 2, off), UP, cw, ct, STOCK.casing);
        if (isWin && T.stool) piece("a", "apron", "apron", T.items.casing, e, at(e, sL - cw / 2, o.sill - STOOL.t / 2 - cw / 2, off), at(e, sR + cw / 2, o.sill - STOOL.t / 2 - cw / 2, off), UP, cw, ct, STOCK.apron);
      }
      // baseboard round the wall, butting into the casing at each door; shoe moulding along its foot on a hard floor
      const stops = doors.map((o) => [o.s0 - REVEAL - T.cw, o.s1 + REVEAL + T.cw]).sort((p, q) => p[0] - q[0]), runs = [];
      let s = 0.002;
      for (const [a, b] of stops) { a - s > 0.06 && runs.push([s, a]); s = Math.max(s, b); }
      e.L - 0.002 - s > 0.06 && runs.push([s, e.L - 0.002]);
      for (const [r0, r1] of runs) {
        const L = r1 - r0, k = Math.max(1, Math.ceil(L / STOCK.base - 1e-6));
        for (let i = 0; i < k; i++) {
          const a = r0 + (L * i) / k, b = r0 + (L * (i + 1)) / k;
          piece("r", "baseboard", "base", T.items.base, e, at(e, a, floor + T.bh / 2, T.bt / 2 + 0.001), at(e, b, floor + T.bh / 2, T.bt / 2 + 0.001), UP, T.bh, T.bt, STOCK.base, { out: [e.nIn[0], 0.25, e.nIn[1]] });
          if (T.shoe && hard) piece("q", "shoe", "shoe", T.items.shoe, e, at(e, a, floor + SHOE.h / 2, T.bt + SHOE.t / 2 + 0.001), at(e, b, floor + SHOE.h / 2, T.bt + SHOE.t / 2 + 0.001), UP, SHOE.h, SHOE.t, STOCK.shoe, { out: [e.nIn[0], 0.3, e.nIn[1]] });
        }
      }
      // crown where the wall meets the ceiling, the whole length of the wall
      if (T.crown && e.h && e.h - y0 > 1.8) {
        const L = e.L, k = Math.max(1, Math.ceil(L / STOCK.crown - 1e-6)), cy = e.h - CROWN.h / 2 - 0.002;
        for (let i = 0; i < k; i++) piece("w", "crown", "crown", T.items.crown, e, at(e, (L * i) / k + 0.002, cy - y0, CROWN.t / 2), at(e, (L * (i + 1)) / k - 0.002, cy - y0, CROWN.t / 2), UP, CROWN.h, CROWN.t, STOCK.crown, { out: [e.nIn[0], -0.3, e.nIn[1]] });
      }
    }
    if (!all.length) return;
    // last, one pass round the room: caulk the seams, fill the nail holes, paint (or oil) the lot
    const longest = edges.filter((e) => e.walled).sort((p, q) => q.L - p.L)[0], step = Math.max(1, Math.ceil(all.length / 14)), area = all.reduce((t, m) => t + m.area, 0);
    const pts = all.filter((_, i) => i % step === 0).map((m) => [(m.a[0] + m.b[0]) / 2 + (m.out[0] || 0) * 0.02, (m.a[1] + m.b[1]) / 2, (m.a[2] + m.b[2]) / 2 + (m.out[2] || 0) * 0.02]);
    M(out, id("p"), "paint", g.style, "trim", f.id, "paint_acrylic", 0.01, 0.1, at(longest, 0.3, 0.9, 0.05), at(longest, longest.L - 0.3, 0.9, 0.05), UP, { draw: 0, area: r3(area), length: r3(longest.L - 0.6), pts, finish: T.finish, out: [0, 0, 0] });
  }

  /* ---------- what each piece is bought as: [key, itemId, unit, quantity, label, why] ---------- */
  const WHY = {
    casing: "Covers the gap between the door or window frame and the wall, and frames the opening.",
    stool: "The shelf at the foot of a window, the first piece of its trim.",
    apron: "Finishes the wall under the window stool and holds it up.",
    baseboard: "Covers the gap left at the walls for the floor to move, and takes the knocks of brooms and chairs.",
    shoe: "A small moulding along the foot of the baseboard: it hides any gap where the floor is not quite flat.",
    crown: "A moulding where the walls meet the ceiling, hiding the joint and finishing the room.",
  };
  const NAMES = { casing: "Casing", stool: "Window stool", apron: "Apron", baseboard: "Baseboard", shoe: "Shoe moulding", crown: "Crown moulding" };
  function buyAs(m) {
    if (m.kind === "paint") return ["paint", "trim_paint", "L", Math.max(0.1, m.area * 2 / 10), "Caulk, filler and paint", "Two coats over the trim (or oil on bare wood), with caulk for the seams and filler for the nail holes."];
    if (!NAMES[m.kind]) return undefined;
    return ["t" + m.kind + "|" + m.material, m.material, "m", (m.length || 0) * 1.1, NAMES[m.kind], WHY[m.kind] + " Bought with a tenth extra for the mitres and cuts."];
  }
  const supplies = (m) => (NAMES[m.kind] ? ["nails_brad", (m.length || 0) * 0.006] : null);
  const SUPPLY_WORDS = { nails_brad: ["Brad nails", "Thin finish nails shot through the trim into the framing; the holes are filled and painted over. Used up as you go."] };

  globalThis.__trim = { TRIMS, TRIM_COLORS, members, buyAs, supplies, SUPPLY_WORDS };
})();
