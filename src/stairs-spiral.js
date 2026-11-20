/* Spiral stairs for window.__stairsGeo (src/stairs-geo.js): the part maker and the drawings for type 'spiral'.
   Plan: docs/design/plan-mode-redesign.md, sections 3A.5 and S3. Numbers and strings only, nothing per frame.

   kinds.spiral(k) gets the kit described in stairs-geo.js's header (local [u, v, y] frame, k.box, k.ob, k.newel, k.rail,
   k.pal, k.D) and reads the layout's spiral { c, r, post, a0, step, treads, rw, sweep }:
     - a centre post (octagonal: two boxes) on a base plate, rising to rail height above the landing, with a cap;
     - treads: tread j covers a0 + (j-1) step .. a0 + j step at j * riser, with a nosing (a few degrees more at the front).
       A wedge is the triangle centre, outer front corner, outer back corner; it is covered EXACTLY by three
       parallelograms, one at each corner, each made of that corner's medial triangle and the middle one (they overlap
       only inside the wedge, on the same faces), so no board half shows anywhere. The apex sits inside the post;
     - a collar on the post under each tread, an arm under each open tread, risers on the radial lines when not open;
     - a helical handrail of straight pieces (one a tread, lengthened so the outer corners meet) on the outer edge with
       its infill: two balusters a tread ('square'), three raking rails and a post a tread ('rails'), a post a tread
       ('plain' and 'wall'); none for rail 'none'. A newel at the foot on the floor and one at the head on the landing;
     - a landing at the top: the part of the floor opening (layout.well, the clear square) from the last riser line round
       a quarter turn (less where it would cut headroom under 2.0 m), so its outer edges meet the floor's edge; a guard
       with its infill along its open edge, from the post to a newel at the floor's edge.
   drawKinds.spiral(layout, size, opts) draws 'stage' (360 x 220: an elevation from the climber's left, near treads dark,
   far ones faint, the helical rail, the floor above with its opening, rise, diameter, risers and headroom), 'thumb'
   (56 x 56, currentColor: plan with the treads, the landing and the way up) and 'plan' (240 x 160: the opening, every
   tread, the landing shaded, the walking line with an arrow and "UP", the diameter).
   About 110 boxes for a storey (13 risers) with square balusters; 60 for half a storey. */
(() => {
  const S = globalThis.__stairsGeo;
  if (!S) return;
  const TAU = Math.PI * 2;
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const dir = (a) => [Math.cos(a), Math.sin(a)];
  const HEAD = 2.0;

  // ---- shared geometry
  function info(Ly) {
    const sp = Ly.spiral, c = sp.c, R = sp.r, sgn = Math.sign(sp.step) || 1, st = Math.abs(sp.step), n = sp.treads, rise = Ly.rise;
    const well = (Ly.well && Ly.well[0]) || [c[0] - R, c[1] - R, c[0] + R, c[1] + R];
    const ae = sp.a0 + sp.step * n;
    // how far round the landing reaches: whole treads' worth, at most a quarter, keeping 2.0 m over what is walked below
    const top = (x) => (x < -Math.PI / 2 - 1e-6 ? null : x < 0 ? 0 : x > sp.sweep + 1e-6 ? null : Math.min(n, Math.floor(x / st + 1e-6) + 1) * Ly.riser);
    let span = 0;
    for (let m = 1; m <= 3; m++) {
      let ok = true;
      for (let i = 0; i < 8 && ok; i++) {
        const q = sp.sweep + ((m - 1 + (i + 0.5) / 8) * st), x = q - TAU, t = top(x);
        if (t !== null && rise - 0.04 - t < HEAD - 1e-6) ok = false;
      }
      if (!ok) break;
      span = m * st;
    }
    if (!span) span = st;   // the head always gets one tread's worth of landing
    return { sp, c, R, sgn, st, n, rise, well, ae, span };
  }
  // the part of the well square inside the cone from angle a to angle b (turning sgn), as a convex polygon from c
  function conePoly(I, a, b) {
    const { c, well, sgn } = I, ray = (t) => {
      const d = dir(t);
      let s = Infinity;
      if (Math.abs(d[0]) > 1e-9) s = Math.min(s, ((d[0] > 0 ? well[2] : well[0]) - c[0]) / d[0]);
      if (Math.abs(d[1]) > 1e-9) s = Math.min(s, ((d[1] > 0 ? well[3] : well[1]) - c[1]) / d[1]);
      return [c[0] + d[0] * s, c[1] + d[1] * s];
    };
    const pts = [[c[0], c[1]], ray(a)];
    const corners = [[well[0], well[1]], [well[2], well[1]], [well[2], well[3]], [well[0], well[3]]]
      .map((p) => {
        let q = (sgn * (Math.atan2(p[1] - c[1], p[0] - c[0]) - a)) % TAU;
        if (q < 0) q += TAU;
        return { p, q };
      })
      .filter((o) => o.q > 1e-4 && o.q < sgn * (b - a) - 1e-4)
      .sort((x, y) => x.q - y.q);
    for (const o of corners) pts.push(o.p);
    pts.push(ray(b));
    return pts;
  }

  // ---- the part maker
  function spiral(k) {
    const { Ly, look, pal, D, parts } = k;
    if (!Ly.spiral) return;
    const I = info(Ly), { c, R, sgn, st, n, rise, ae, span } = I, sp = I.sp, Rr = Ly.riser;
    const tt = D.tread, open = !!look.open, nos = look.nosing ? 0.035 / (0.62 * R) : 0;
    const at = (a, r) => [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
    const th = (j) => sp.a0 + sp.step * (j - 1);   // tread j's front line
    const pr = sp.post / 2;
    // a flat plate over a triangle: three corner parallelograms, exact
    const tri = (O, A, B, y0, y1, colr) => {
      for (const [X, Y, Z] of [[O, A, B], [A, B, O], [B, O, A]]) {
        k.ob([(2 * X[0] + Y[0] + Z[0]) / 4, (2 * X[1] + Y[1] + Z[1]) / 4, (y0 + y1) / 2],
          [(Y[0] - X[0]) / 4, (Y[1] - X[1]) / 4, 0], [0, 0, (y1 - y0) / 2], [(Z[0] - X[0]) / 4, (Z[1] - X[1]) / 4, 0], colr);
      }
    };
    const plate = (pts, y0, y1, colr) => {
      if (pts.length === 4) {
        const [a, b, cc, d] = pts;
        if (Math.hypot(a[0] + cc[0] - b[0] - d[0], a[1] + cc[1] - b[1] - d[1]) < 1e-4) {
          k.ob([(a[0] + cc[0]) / 2, (a[1] + cc[1]) / 2, (y0 + y1) / 2], [(b[0] - a[0]) / 2, (b[1] - a[1]) / 2, 0], [0, 0, (y1 - y0) / 2], [(d[0] - a[0]) / 2, (d[1] - a[1]) / 2, 0], colr);
          return;
        }
      }
      for (let i = 1; i + 1 < pts.length; i++) tri(pts[0], pts[i], pts[i + 1], y0, y1, colr);
    };
    // an upright square bar turned to angle a
    const bar = (p, a, hw, hd, y0, y1, colr) => {
      const d = dir(a);
      k.ob([p[0], p[1], (y0 + y1) / 2], [d[0] * hw, d[1] * hw, 0], [0, 0, (y1 - y0) / 2], [-d[1] * hd, d[0] * hd, 0], colr);
    };

    // centre post: octagonal, a base plate, a cap
    const ptop = rise + D.rail + 0.06;
    k.box(c[0] - pr, c[1] - pr, c[0] + pr, c[1] + pr, 0, ptop, pal.newel);
    bar(c, Math.PI / 4, pr, pr, 0, ptop, pal.newel);
    k.box(c[0] - 0.11, c[1] - 0.11, c[0] + 0.11, c[1] + 0.11, 0, 0.018, pal.newel);
    bar(c, Math.PI / 8, 0.072, 0.072, ptop, ptop + 0.05, pal.rail);
    bar(c, Math.PI / 8 + Math.PI / 4, 0.045, 0.045, ptop + 0.05, ptop + 0.085, pal.rail);
    parts.newels++;

    // treads, collars, arms, risers
    for (let j = 1; j <= n; j++) {
      const a = th(j), b = a + sp.step, y = j * Rr, colr = k.shade(pal.tread, k.jit(j, 7));
      tri([c[0], c[1]], at(a - sgn * nos, R), at(b, R), y - tt, y, colr);
      parts.treads++;
      const mid = (a - sgn * nos + b) / 2;
      bar(c, mid, 0.064, 0.064, y - tt - 0.06, y - tt, k.shade(pal.newel, 1.05));
      if (open) {
        // an arm under the tread, tapering in look by sitting deeper at the post
        const r0 = 0.07, r1 = R * 0.82, pm = at(mid, (r0 + r1) / 2), d = dir(mid);
        k.ob([pm[0], pm[1], y - tt - 0.03], [d[0] * (r1 - r0) / 2, d[1] * (r1 - r0) / 2, 0.012], [0, 0, 0.03], [-d[1] * 0.017, d[0] * 0.017, 0], pal.stringer);
      } else {
        const rt = D.riser, d = dir(a), nrm = [-d[1] * sgn, d[0] * sgn], ro = R - 0.012;
        const m = [c[0] + d[0] * (pr + ro) / 2 + nrm[0] * rt / 2, c[1] + d[1] * (pr + ro) / 2 + nrm[1] * rt / 2], y0 = (j - 1) * Rr;
        k.ob([m[0], m[1], (y0 + y - tt) / 2], [d[0] * (ro - pr) / 2, d[1] * (ro - pr) / 2, 0], [0, 0, (y - tt - y0) / 2], [nrm[0] * rt / 2, nrm[1] * rt / 2, 0], k.shade(pal.riser, k.jit(j, 8)));
        parts.risers++;
      }
    }
    if (!open) {
      // the last riser, up to the landing
      const rt = D.riser, d = dir(ae), nrm = [-d[1] * sgn, d[0] * sgn], ro = R - 0.012, y0 = n * Rr;
      const m = [c[0] + d[0] * (pr + ro) / 2 + nrm[0] * rt / 2, c[1] + d[1] * (pr + ro) / 2 + nrm[1] * rt / 2];
      k.ob([m[0], m[1], (y0 + rise - tt) / 2], [d[0] * (ro - pr) / 2, d[1] * (ro - pr) / 2, 0], [0, 0, (rise - tt - y0) / 2], [nrm[0] * rt / 2, nrm[1] * rt / 2, 0], pal.riser);
      parts.risers++;
    }

    // the landing: from the last riser line (with a nosing) round to the guard, out to the floor's edge
    const ag = ae + sgn * span;
    plate(conePoly(I, ae, ag), rise - tt, rise, pal.deck);

    // the handrail and its infill, on the outer edge
    const rail = look.rail !== 'none';
    const style = look.rail === 'wall' ? 'plain' : look.railStyle || 'square';
    if (rail) {
      const rb = R - D.edge, per = style === 'rails' ? 1 : 2, da = sp.step / per, hw = D.railW / 2, ext = hw * Math.tan(st / per / 2) + 0.002, bw = 0.024;
      const yAt = (f) => (1 + f) * Rr + D.rail;   // rail top f treads round from the first nosing
      const segs = [], M = n * per;
      const baluster = (a, yb, yt) => { const p = at(a, rb); k.box(p[0] - bw / 2, p[1] - bw / 2, p[0] + bw / 2, p[1] + bw / 2, yb, yt, pal.baluster); parts.balusters++; };
      for (let i = 0; i < M; i++) {
        const p = at(sp.a0 + da * i, rb), q = at(sp.a0 + da * (i + 1), rb), du = q[0] - p[0], dv = q[1] - p[1], L = Math.hypot(du, dv);
        const ea = i === 0 ? 0 : ext, eb = i === M - 1 ? 0 : ext, yp = yAt(i / per), yq = yAt((i + 1) / per), sl = (yq - yp) / L;
        segs.push({ p: [p[0] - (du / L) * ea, p[1] - (dv / L) * ea, yp - sl * ea], q: [q[0] + (du / L) * eb, q[1] + (dv / L) * eb, yq + sl * eb], pn: false, qn: false, spots: [] });
      }
      // infill: two balusters a tread, or one post a tread carrying a plain rail or the raking rails
      for (let j = 1; j <= n; j++) {
        const fs = style === 'square' ? [0.27, 0.73] : [0.5];
        for (const f of fs) baluster(th(j) + sp.step * f, j * Rr, yAt(j - 1 + f) - D.railH * 0.5);
      }
      k.rail(segs);
      const f0 = at(th(1), rb), f1 = at(ae, rb), nose = (j) => j * Rr + D.rail;
      k.newel(f0[0], f0[1], 0, nose(1));
      k.newel(f1[0], f1[1], n * Rr - tt, rise + D.rail);
      // the guard along the landing's open edge: from the post out to the floor's edge, set in onto the board
      const pts = conePoly(I, ag, ag), e = pts[pts.length - 1], d = dir(ag), inw = [d[1] * sgn * D.edge, -d[0] * sgn * D.edge];
      const gl = Math.hypot(e[0] - c[0], e[1] - c[1]) - D.edge;
      const g0 = [c[0] + d[0] * (pr + 0.004) + inw[0], c[1] + d[1] * (pr + 0.004) + inw[1]], g1 = [c[0] + d[0] * gl + inw[0], c[1] + d[1] * gl + inw[1]];
      const yg = rise + D.rail;
      k.rail([{ p: [g0[0], g0[1], yg], q: [g1[0], g1[1], yg], pn: false, qn: false, spots: [] }]);
      const gm = style === 'square' ? Math.max(1, Math.round((gl - pr) / 0.11) - 1) : 1;
      for (let i = 1; i <= gm; i++) {
        const t = i / (gm + 1), q = [g0[0] + (g1[0] - g0[0]) * t, g0[1] + (g1[1] - g0[1]) * t];
        if ((1 - t) * (gl - pr) < D.newel / 2 + 0.03) continue;
        k.box(q[0] - bw / 2, q[1] - bw / 2, q[0] + bw / 2, q[1] + bw / 2, rise, yg - D.railH * 0.5, pal.baluster);
        parts.balusters++;
      }
      k.newel(g1[0], g1[1], rise - tt, yg);
    }
    parts.stringers = 0;
  }

  // ---- drawings
  const f1 = (v) => Math.round(v * 10) / 10;
  const m2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const wrap = (W, H, out, label, cls) =>
    '<svg class="' + cls + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(label) + '" font-family="var(--cad-font, system-ui, sans-serif)">' + out.join('') + '</svg>';
  const name = (Ly, tail) => 'Spiral' + (Ly.label ? ' ' + Ly.label : '') + tail;

  // plan, both sizes: v runs down the drawing like S2's plan
  function planSvg(Ly, size, opts) {
    const thumb = size === 'thumb', W = opts.width || (thumb ? 56 : 240), H = opts.height || (thumb ? 56 : 160);
    const I = info(Ly), { c, R, sgn, n, ae, span, well } = I, sp = I.sp;
    const pad = thumb ? 4 : 18, padB = thumb ? 4 : 26;
    const k = Math.min((W - 2 * pad) / (well[2] - well[0]), (H - pad - padB) / (well[3] - well[1]));
    const ox = (W - (well[2] - well[0]) * k) / 2 - well[0] * k, oy = pad + (H - pad - padB - (well[3] - well[1]) * k) / 2 - well[1] * k;
    const X = (u) => f1(ox + u * k), Y = (v) => f1(oy + v * k), P = (p) => X(p[0]) + ' ' + Y(p[1]);
    const at = (a, r) => [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
    const ink = thumb ? 'currentColor' : 'var(--cad-ink)', line = thumb ? 'currentColor' : 'var(--cad)', sw = thumb ? 1.3 : 1.2;
    const out = [];
    if (!thumb) {
      out.push('<rect width="' + W + '" height="' + H + '" fill="var(--cad-bg)"/>');
      out.push('<path d="M' + X(well[0]) + ' ' + Y(well[1]) + 'H' + X(well[2]) + 'V' + Y(well[3]) + 'H' + X(well[0]) + 'Z" fill="none" stroke="' + line + '" stroke-width=".8" stroke-dasharray="4 3" stroke-opacity=".8"/>');
    }
    // the landing, shaded
    const lp = conePoly(I, ae, ae + sgn * span);
    out.push('<path d="M' + lp.map(P).join('L') + 'Z" fill="' + line + '" fill-opacity="' + (thumb ? 0.28 : 0.16) + '" stroke="' + ink + '" stroke-width="' + (thumb ? 0.9 : 1) + '" stroke-linejoin="round"/>');
    // the treads: the outer edge and a line at each riser
    const a0 = sp.a0, a1 = ae, large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
    const full = Math.abs(a1 - a0) >= TAU - 1e-6;
    if (full) out.push('<circle cx="' + X(c[0]) + '" cy="' + Y(c[1]) + '" r="' + f1(R * k) + '" fill="none" stroke="' + ink + '" stroke-width="' + sw + '"/>');
    else {
      const s = at(a0, R), e = at(a1, R);
      out.push('<path d="M' + P(s) + 'A' + f1(R * k) + ' ' + f1(R * k) + ' 0 ' + large + ' ' + (sgn > 0 ? 1 : 0) + ' ' + P(e) + '" fill="none" stroke="' + ink + '" stroke-width="' + sw + '"/>');
    }
    let t = '';
    for (let j = 0; j <= n; j++) { const a = a0 + sp.step * j; t += 'M' + P(at(a, sp.post / 2)) + 'L' + P(at(a, R)); }
    out.push('<path d="' + t + '" stroke="' + (thumb ? ink : line) + '" stroke-width="' + (thumb ? 0.8 : 0.8) + '" stroke-opacity="' + (thumb ? 0.75 : 0.9) + '"/>');
    out.push('<circle cx="' + X(c[0]) + '" cy="' + Y(c[1]) + '" r="' + f1(Math.max(thumb ? 1.8 : 2.5, (sp.post / 2) * k)) + '" fill="' + ink + '"/>');
    // the walking line with an arrow up
    const rw = sp.rw, wa = a0 + sp.step * 0.35, wb = ae - sp.step * 0.25, ws = at(wa, rw), we = at(wb, rw);
    // sampled; a walk over a full turn closes in a little so the laps don't overlap
    const lap = Math.abs(wb - wa) > TAU * 0.92, wr = (f) => rw * (lap ? 1 - 0.3 * f : 1);
    let wpath = '';
    for (let i = 0, N = Math.max(8, Math.ceil(Math.abs(wb - wa) / 0.12)); i <= N; i++) wpath += (i ? 'L' : 'M') + P(at(wa + ((wb - wa) * i) / N, wr(i / N)));
    we.splice(0, 2, ...at(wb, wr(1)));
    const lw = thumb ? 1.1 : 1.2;
    out.push('<path d="' + wpath + '" fill="none" stroke="' + line + '" stroke-width="' + lw + '"/>');
    const td = [-Math.sin(wb) * sgn, Math.cos(wb) * sgn], ah = (thumb ? 4.5 : 7) / k, hb = [we[0] - td[0] * ah, we[1] - td[1] * ah];
    out.push('<path d="M' + P([hb[0] - td[1] * ah * 0.6, hb[1] + td[0] * ah * 0.6]) + 'L' + P([we[0] + td[0] * ah * 0.4, we[1] + td[1] * ah * 0.4]) + 'L' + P([hb[0] + td[1] * ah * 0.6, hb[1] - td[0] * ah * 0.6]) + '" fill="none" stroke="' + line + '" stroke-width="' + lw + '" stroke-linejoin="round"/>');
    out.push('<circle cx="' + X(ws[0]) + '" cy="' + Y(ws[1]) + '" r="' + (thumb ? 1.6 : 2.4) + '" fill="' + line + '"/>');
    if (!thumb) {
      // UP at the foot, outside the circle; the diameter below
      const fa = at(a0 - sp.step * 0.6, R + 0.12);
      out.push('<text x="' + X(Math.max(well[0] + 0.05, Math.min(well[2] - 0.05, fa[0]))) + '" y="' + f1(Y(fa[1]) + 4) + '" font-size="10" font-weight="600" text-anchor="middle" fill="var(--cad-ink)">UP</text>');
      const ty = H - 10;
      out.push('<path d="M' + X(c[0] - R) + ' ' + (ty - 8) + 'H' + X(c[0] + R) + 'M' + X(c[0] - R) + ' ' + (ty - 12) + 'v8M' + X(c[0] + R) + ' ' + (ty - 12) + 'v8" stroke="var(--cad)" stroke-width=".8"/>');
      out.push('<text x="' + X(c[0]) + '" y="' + (ty + 4) + '" font-size="10" text-anchor="middle" fill="var(--cad-ink)">Ø ' + m2(2 * R) + ' m · ' + n + ' treads</text>');
    }
    return wrap(W, H, out, opts.label || name(Ly, thumb ? '' : ': plan'), thumb ? 'st-thumb' : 'st-plan');
  }

  // elevation from the climber's left at the foot (looking along +v): u across, height up, v toward the viewer negative
  function sideSvg(Ly, opts) {
    const W = opts.width || 360, H = opts.height || 220;
    const I = info(Ly), { c, R, sgn, n, rise, ae, span, well } = I, sp = I.sp, Rr = Ly.riser;
    const rail = opts.rail ?? (Ly.railDefault !== 'none');
    const ml = 26, mr = 64, mt = 34, mb = 40;
    const x0 = well[0] - 0.55, x1 = well[2] + 0.55, ytop = rise + (rail ? 0.9 + 0.12 : 0.12);
    const k = Math.min((W - ml - mr) / (x1 - x0), (H - mt - mb) / ytop);
    const ox = ml + (W - ml - mr - (x1 - x0) * k) / 2 - x0 * k, oy = H - mb;
    const X = (u) => f1(ox + u * k), Y = (y) => f1(oy - y * k);
    const at = (a, r) => [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
    const near = (a) => Math.sin(a) * 1 < 0;   // v < 0 faces the viewer
    const ink = 'var(--cad-ink)', line = 'var(--cad)';
    const out = ['<rect width="' + W + '" height="' + H + '" fill="var(--cad-bg)"/>'];
    // floors: the ground, the floor above with its opening
    out.push('<path d="M' + X(x0) + ' ' + Y(0) + 'H' + X(x1) + '" stroke="' + ink + '" stroke-width="1.4"/>');
    const slab = (a, b) => '<rect x="' + X(a) + '" y="' + Y(rise) + '" width="' + f1((b - a) * k) + '" height="' + f1(Math.max(2, 0.12 * k)) + '" fill="' + line + '" fill-opacity=".18" stroke="' + ink + '" stroke-width="1"/>';
    out.push(slab(x0, well[0]), slab(well[2], x1));
    // the tread outline seen side on: its u extent and its thickness
    const ext = (a, b, r0) => {
      const us = [at(a, r0)[0], at(a, R)[0], at(b, r0)[0], at(b, R)[0]];
      for (let m = Math.ceil(Math.min(a, b) / Math.PI); m * Math.PI <= Math.max(a, b); m++) us.push(c[0] + Math.cos(m * Math.PI) * R);
      return [Math.min(...us), Math.max(...us)];
    };
    const treads = [];
    for (let j = 1; j <= n; j++) {
      const a = sp.a0 + sp.step * (j - 1), b = a + sp.step;
      treads.push({ j, a, b, y: j * Rr, near: near((a + b) / 2) });
    }
    const th = Math.max(2, 0.04 * k);
    const tr = (t, o) => { const [ua, ub] = ext(t.a, t.b, sp.post / 2); return '<rect x="' + X(ua) + '" y="' + Y(t.y) + '" width="' + f1((ub - ua) * k) + '" height="' + f1(th) + '" fill="' + (o ? line : 'none') + '" fill-opacity="' + (o ? 0.5 : 0) + '" stroke="' + ink + '" stroke-width="' + (o ? 1 : 0.7) + '" stroke-opacity="' + (o ? 1 : 0.35) + '"/>'; };
    // the rail as a helix, far part faint, near part solid, and the balusters on the near side
    const rb = R - 0.045, pts = [];
    for (let j = 1; j <= n; j++) for (let i = 0; i < 4; i++) { const f = j - 1 + i / 4, a = sp.a0 + sp.step * f; pts.push({ a, u: at(a, rb)[0], y: (1 + f) * Rr + 0.9 }); }
    pts.push({ a: ae, u: at(ae, rb)[0], y: rise + 0.9 });
    const railPath = (want) => {
      let d = '', pen = false;
      for (let i = 0; i + 1 < pts.length; i++) {
        const p = pts[i], q = pts[i + 1], nn = near((p.a + q.a) / 2);
        if (nn !== want) { pen = false; continue; }
        d += (pen ? '' : 'M' + X(p.u) + ' ' + Y(p.y)) + 'L' + X(q.u) + ' ' + Y(q.y);
        pen = true;
      }
      return d;
    };
    // far treads, far rail, post, landing, near treads, near rail
    for (const t of treads) if (!t.near) out.push(tr(t, false));
    if (rail) { const d = railPath(false); if (d) out.push('<path d="' + d + '" fill="none" stroke="' + line + '" stroke-width="1.1" stroke-opacity=".45"/>'); }
    out.push('<rect x="' + X(c[0] - sp.post / 2) + '" y="' + Y(rise + (rail ? 0.96 : 0.05)) + '" width="' + f1(Math.max(1.5, sp.post * k)) + '" height="' + f1((rise + (rail ? 0.96 : 0.05)) * k) + '" fill="' + ink + '"/>');
    const lp = conePoly(I, ae, ae + sgn * span), lu = lp.map((p) => p[0]);
    out.push('<rect x="' + X(Math.min(...lu)) + '" y="' + Y(rise) + '" width="' + f1((Math.max(...lu) - Math.min(...lu)) * k) + '" height="' + f1(th) + '" fill="' + line + '" fill-opacity=".5" stroke="' + ink + '" stroke-width="1"/>');
    for (const t of treads) if (t.near) out.push(tr(t, true));
    if (rail) {
      let b = '';
      for (const t of treads) if (t.near) for (const f of [0.27, 0.73]) { const a = t.a + sp.step * f, u = at(a, rb)[0]; b += 'M' + X(u) + ' ' + Y(t.y) + 'V' + Y(t.y + 0.9 + Rr * f - 0.03); }
      if (b) out.push('<path d="' + b + '" stroke="' + line + '" stroke-width=".7" stroke-opacity=".8"/>');
      const d = railPath(true);
      if (d) out.push('<path d="' + d + '" fill="none" stroke="' + line + '" stroke-width="1.6"/>');
      const f0 = at(sp.a0, rb)[0];
      out.push('<path d="M' + X(f0) + ' ' + Y(0) + 'V' + Y(Rr + 0.9) + '" stroke="' + line + '" stroke-width="1.4"/>');
    }
    // dimensions: rise at the right, diameter below, the label and headroom on top
    const xr = W - mr + 18, ty = H - mb + 18;
    out.push('<path d="M' + xr + ' ' + Y(0) + 'V' + Y(rise) + 'M' + (xr - 4) + ' ' + Y(0) + 'h8M' + (xr - 4) + ' ' + Y(rise) + 'h8" stroke="var(--cad)" stroke-width=".8"/>');
    out.push('<text x="' + (xr + 6) + '" y="' + f1((+Y(0) + +Y(rise)) / 2 + 4) + '" font-size="11" fill="var(--cad-ink)">' + m2(rise) + ' m</text>');
    out.push('<path d="M' + X(c[0] - R) + ' ' + ty + 'H' + X(c[0] + R) + 'M' + X(c[0] - R) + ' ' + (ty - 4) + 'v8M' + X(c[0] + R) + ' ' + (ty - 4) + 'v8" stroke="var(--cad)" stroke-width=".8"/>');
    out.push('<text x="' + X(c[0]) + '" y="' + (ty + 14) + '" font-size="11" text-anchor="middle" fill="var(--cad-ink)">Ø ' + m2(2 * R) + ' m · ' + Math.round((Math.abs(sp.sweep) * 180) / Math.PI) + '° turn</text>');
    const lab = Ly.n + ' × ' + Math.round(Rr * 1000) + ' mm · ' + Math.round((Math.abs(sp.step) * 180) / Math.PI) + '° a tread';
    out.push('<text x="' + ml + '" y="20" font-size="12" fill="var(--cad-ink)">' + esc(lab) + '</text>');
    if (Number.isFinite(Ly.headroom)) out.push('<text x="' + (W - 8) + '" y="20" font-size="11" text-anchor="end" fill="var(--cad)">headroom ' + m2(Ly.headroom) + ' m</text>');
    return wrap(W, H, out, opts.label || name(Ly, ': side view'), 'st-side');
  }

  function drawSpiral(Ly, size, opts = {}) {
    if (!Ly || !Ly.spiral) return null;
    if (size === 'thumb' || size === 'plan') return planSvg(Ly, size, opts);
    return sideSvg(Ly, opts);
  }

  S.kinds.spiral = spiral;
  S.drawKinds.spiral = drawSpiral;
  S.spiralInfo = (Ly) => (Ly && Ly.spiral ? (({ ae, span }) => ({ landing: { a0: r4(ae), a1: r4(ae + Math.sign(Ly.spiral.step) * span) } }))(info(Ly)) : null);
})();
