/* Grand stairs for window.__stairsGeo (src/stairs-geo.js): the part makers and drawings for 'curved', 'grand' (the
   elliptical half turn), 'imperial', 'bifurcated' and 'horseshoe', and the flared starter steps that straight, L and U
   stairs take too. Plan: docs/design/plan-mode-redesign.md, section 3A. Numbers and strings only, nothing per frame.

   Every flight here is a run of riser lines (layout.curves[i].lines, or a flight's lines made the same way): tread j is the
   quad between lines j-1 and j, so straight flights, the straight start of a curve, the tapered treads of the arc and the
   elliptical sweep all go through one maker:
     - treads 40 mm thick with a nosing. A tapered tread is a trapezoid (its two chords are parallel); it is covered
       EXACTLY by two parallelograms, one on each riser line, overlapping only inside it (a wide one is first cut in two
       along a chord), the nosing a strip along the riser line. A rectangle is one box, its nosing included;
     - risers 20 mm on each riser line (none when open), a nosing on the floor's or landing's edge at the head;
     - closed strings both sides, 40 mm, standing 50 mm proud of the nosings, 300 mm deep: one slanted box a tread on the
       curve (lengthened so the outer faces meet), one a straight run; a soffit under closed risers;
     - a handrail 0.9 m over the nosings on each open side, continuous through the curve, with its infill (two balusters a
       tread standing on the string, three raking rails, or a plain rail with a post every third tread), turned newels at
       the foot, the head and the landings;
     - a flared start (layout.flare): the bottom steps widen as solid blocks with bullnose ends (a half octagon), the first
       is a curtail step round a turned newel, and the handrail ramps down and curls into a level volute over it with
       balusters round the scroll;
     - landings framed with a deck, a fascia, a soffit and posts; the curved landing that squares a curve's head to the
       floor carries the strings and the rail round level; the horseshoe's apex landing is a box and a trapezoid;
     - the gallery: a guard with its infill round every edge of the floor opening (layout.well) except where a flight
       arrives (layout.arrive), on the floor above. look.gallery === false leaves it off (rail 'none' does too).
   Straight, L and U stairs keep stairs-geo.js's carpentry; with a flare their foot newel and the bottom of the rail give way
   to the curtail, the volute and the flared blocks (kinds.straight / l / u are wrapped here).
   drawKinds draws 'stage' (360 x 220: an elevation from the climber's left at the foot, near treads solid and far ones
   faint, the rails, the floor above with its opening, rise, length, riser and going, radius and sweep), 'thumb' (56 x 56,
   currentColor: the plan at a glance) and 'plan' (240 x 160: every tread, landings, the flare, the opening dashed, the
   walking line with an arrow and UP, the overall size).
   Boxes (pine, square balusters, gallery on): curved storey about 230, grand curve 260, imperial 300 (with a 2-step flare
   340), bifurcated 280, horseshoe 330. */
(() => {
  const S = globalThis.__stairsGeo;
  if (!S || S.grandKinds) return;
  const ST = () => globalThis.__stairs || null;
  const GRAND = ['curved', 'grand', 'imperial', 'bifurcated', 'horseshoe'];
  const P = Object.freeze({
    sThk: 0.04, sUp: 0.05, sDepth: 0.3, soffit: 0.012, newel: 0.105, shaft: 0.074, capW: 0.13, rail: 0.9, railW: 0.07, railH: 0.055,
    bal: 0.034, balGap: 0.125, guardGap: 0.13, deck: 0.035, fascia: 0.28, fasciaT: 0.045, post: 0.11, voluteEye: 0.05,
  });
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k];
  const len = (a) => Math.hypot(a[0], a[1]);
  const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const crs = (a, b) => a[0] * b[1] - a[1] * b[0];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const lp = (L) => [L[0], L[1]];
  const rp = (L) => [L[2], L[3]];
  const sidePt = (L, sg) => (sg < 0 ? lp(L) : rp(L));
  const OCT = Math.tan(Math.PI / 8);

  function flightLines(f, T) {
    const p = [-f.d[1], f.d[0]], hw = f.w / 2, out = [];
    for (let j = 0; j < f.n; j++) {
      const m = [f.a[0] + f.d[0] * j * T, f.a[1] + f.d[1] * j * T];
      out.push([m[0] - p[0] * hw, m[1] - p[1] * hw, m[0] + p[0] * hw, m[1] + p[1] * hw]);
    }
    return out;
  }
  // which sides carry a balustrade (-1 left, +1 right, as the climber sees them)
  function openSides(look) {
    const r = look.rail;
    if (r === 'none') return [];
    if (r === 'left') return [-1];
    if (r === 'right') return [1];
    if (r === 'wall') return look.wall === 'left' ? [1] : look.wall === 'right' ? [-1] : [];
    return [-1, 1];
  }

  // ---- the toolkit over the stairs-geo kit
  function tools(k) {
    const { pal, parts } = k, newels = [];
    // a flat parallelogram: corner p, edges e1, e2 (plan), y0..y1
    const para = (p, e1, e2, y0, y1, c) => k.ob([p[0] + (e1[0] + e2[0]) / 2, p[1] + (e1[1] + e2[1]) / 2, (y0 + y1) / 2], [e1[0] / 2, e1[1] / 2, 0], [0, 0, (y1 - y0) / 2], [e2[0] / 2, e2[1] / 2, 0], c);
    // a trapezoid: short base s0-s1, long base l0-l1 (s0 joined to l0 by a leg), exact with overlapping parallelograms
    // nose: a plan vector the front edge (s0-l0) is pushed out by; the front parallelogram takes it in (its back stays put)
    function trap(s0, s1, l0, l1, y0, y1, c, nose, depth = 0) {
      const e = sub(s1, s0), a = len(e), b = len(sub(l1, l0));
      if (b <= 2 * a + 1e-6 || depth > 3) {
        if (nose) para(sub(s0, nose), sub(l0, s0), add(e, nose), y0, y1, c);
        else para(s0, sub(l0, s0), e, y0, y1, c);
        para(s1, sub(l1, s1), mul(e, -1), y0, y1, c);
        return;
      }
      const t = a / (b - a), m0 = add(s0, mul(sub(l0, s0), t)), m1 = add(s1, mul(sub(l1, s1), t));
      trap(s0, s1, m0, m1, y0, y1, c, nose, depth + 1);
      trap(m0, m1, l0, l1, y0, y1, c, nose, depth + 1);
    }
    // a triangle as its three corner parallelograms (each the corner's medial triangle and the middle one)
    function tri(A, B, C, y0, y1, c) {
      for (const [X, Y, Z] of [[A, B, C], [B, C, A], [C, A, B]]) para(X, mul(sub(Y, X), 0.5), mul(sub(Z, X), 0.5), y0, y1, c);
    }
    // a flat convex quad [p0, p1, p2, p3]: parallelogram, trapezoid (either pair of sides), or two triangles
    // nose (optional): the edge q0-q1 is the front, pushed out by this plan vector
    function quad(q, y0, y1, c, nose) {
      const [a, b, cc, d] = q;
      if (len(sub(add(a, cc), add(b, d))) < 2e-4) return nose ? para(sub(a, nose), sub(b, a), add(sub(d, a), nose), y0, y1, c) : para(a, sub(b, a), sub(d, a), y0, y1, c);
      for (const [p0, p1, p2, p3, front] of [[a, b, cc, d, true], [b, cc, d, a, false]]) {
        // bases p0-p3 and p1-p2 parallel (same way round)
        const e1 = sub(p3, p0), e2 = sub(p2, p1);
        if (Math.abs(crs(unit(e1), unit(e2))) < 0.03 && dot(e1, e2) > 0) {
          const ns = front ? nose : null;
          if (len(e1) <= len(e2)) trap(p0, p3, p1, p2, y0, y1, c, ns);
          else trap(p1, p2, p0, p3, y0, y1, c, ns);
          if (nose && !front) para(sub(a, nose), sub(b, a), nose, y0, y1, c);
          return;
        }
      }
      tri(a, b, cc, y0, y1, c), tri(a, cc, d, y0, y1, c);
      if (nose) para(sub(a, nose), sub(b, a), nose, y0, y1, c);
    }
    // an upright bar on a plan segment a-b (thickness th across it), y0..y1
    const wall = (a, b, th, y0, y1, c) => {
      const e = sub(b, a), n = unit([-e[1], e[0]]);
      k.ob([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (y0 + y1) / 2], [e[0] / 2, e[1] / 2, 0], [0, 0, (y1 - y0) / 2], [n[0] * th / 2, n[1] * th / 2, 0], c);
    };
    // a sloped bar from plan a (top ya) to b (top yb), depth dp below its top line, thickness th, ends lengthened by ext
    const slab = (a, b, ya, yb, dp, th, c, ext = 0) => {
      const e = sub(b, a), L = len(e);
      if (L < 1e-4) return;
      const g = (L + 2 * ext) / L, n = unit([-e[1], e[0]]);
      k.ob([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (ya + yb) / 2 - dp / 2], [(e[0] * g) / 2, (e[1] * g) / 2, ((yb - ya) * g) / 2], [0, 0, dp / 2], [(n[0] * th) / 2, (n[1] * th) / 2, 0], c);
    };
    // the regular octagon of inradius r round c in the frame (f, e): four long boxes, two of them turned 45 degrees
    const octagon = (c, f, e, r, y0, y1, colr, only) => {
      const a = r * OCT, d1 = unit(add(f, e)), d2 = unit(sub(f, e));
      const bar = (ax, bx, hl, hw) => k.ob([c[0], c[1], (y0 + y1) / 2], [ax[0] * hl, ax[1] * hl, 0], [0, 0, (y1 - y0) / 2], [bx[0] * hw, bx[1] * hw, 0], colr);
      if (!only || only.includes('A')) bar(f, e, r, a);
      bar(e, f, r, a);
      bar(d1, d2, r, a);
      bar(d2, d1, r, a);
    };
    // a turned newel: base block, octagonal shaft, collar, top block, cap and finial; the rails meet it at yt
    const newel = (u, v, yb, yt) => {
      const n = newels.find((q) => Math.hypot(q.u - u, q.v - v) < 0.16);
      if (n) { n.yb = Math.min(n.yb, yb), (n.yt = Math.max(n.yt, yt)); return n; }
      const q = { u, v, yb, yt };
      newels.push(q);
      return q;
    };
    const drawNewels = () => {
      for (const n of newels) {
        // base block, octagonal turned shaft, top block, a cap with its moulding
        const { u, v, yb, yt } = n, h = P.newel / 2, s = P.shaft / 2, top = yt + 0.07, base = Math.min(yb + 0.2, top - 0.32), neck = yt - 0.1;
        k.box(u - h, v - h, u + h, v + h, yb, base, pal.newel);
        k.box(u - s, v - s, u + s, v + s, base, neck, pal.newel);
        k.ob([u, v, (base + neck) / 2], [s * Math.SQRT1_2, s * Math.SQRT1_2, 0], [0, 0, (neck - base) / 2], [-s * Math.SQRT1_2, s * Math.SQRT1_2, 0], pal.newel);
        k.box(u - h, v - h, u + h, v + h, neck, top, pal.newel);
        k.box(u - P.capW / 2, v - P.capW / 2, u + P.capW / 2, v + P.capW / 2, top, top + 0.035, pal.rail);
        parts.newels++;
      }
    };
    const baluster = (p, yb, yt) => {
      if (yt - yb < 0.08) return;
      const h = P.bal / 2;
      k.box(p[0] - h, p[1] - h, p[0] + h, p[1] + h, yb, yt, pal.baluster);
      parts.balusters++;
    };
    // a handrail bar along a plan segment, level or sloped, no infill (the volute, ramps)
    const railBar = (a, b, ya, yb, ext = 0) => {
      slab(a, b, ya, yb, P.railH, P.railW, pal.rail, ext);
      parts.rail += Math.hypot(len(sub(b, a)), yb - ya);
    };
    return { para, trap, tri, quad, wall, slab, octagon, newel, drawNewels, baluster, railBar, newels };
  }

  // ---- a run: treads, risers, strings, soffit, its balustrade; returns the rail ends per side
  // R: { lines, y0, from: 'floor' | 'landing', to: 'floor' | 'landing', fill: [lines] (level, at the head), flare: { sides, n } }
  function run(k, X, R, ri) {
    const { Ly, look, pal, parts, D } = k, Rr = Ly.riser, L = R.lines, m = L.length - 1, y0 = R.y0;
    if (m < 0) return {};
    const tt = D.tread, rt = look.open ? 0 : D.riser, nos = look.nosing ? D.nosing : 0;
    const yN = (j) => y0 + (j + 1) * Rr;   // the nosing line at riser line j (the last: the surface it lands on)
    const yTop = y0 + (m + 1) * Rr;
    const fwd = (j) => {
      // unit normal of line j pointing up the run
      const a = lp(L[j]), b = rp(L[j]), n = unit([-(b[1] - a[1]), b[0] - a[0]]);
      const o = j < m ? sub(mid(lp(L[j + 1]), rp(L[j + 1])), mid(a, b)) : j > 0 ? sub(mid(a, b), mid(lp(L[j - 1]), rp(L[j - 1]))) : n;
      return dot(n, o) >= 0 ? n : mul(n, -1);
    };
    const parallel = (A, B) => Math.abs(crs(unit(sub(rp(A), lp(A))), unit(sub(rp(B), lp(B))))) < 1e-4;
    // treads and risers stop just inside the strings' outer faces (they are housed in them)
    const Li = L.map((A) => { const d = mul(unit(sub(rp(A), lp(A))), 0.008); return [A[0] + d[0], A[1] + d[1], A[2] - d[0], A[3] - d[1]]; });
    for (let j = 1; j <= m; j++) {
      const A = Li[j - 1], B = Li[j], n = fwd(j - 1), x = rt + nos, top = y0 + j * Rr, c = k.shade(pal.tread, k.jit(ri * 40 + j, 1));
      if (parallel(A, B)) X.para(sub(lp(A), mul(n, x)), sub(rp(A), lp(A)), add(sub(lp(B), lp(A)), mul(n, x)), top - tt, top, c);
      else X.quad([lp(A), rp(A), rp(B), lp(B)], top - tt, top, c, x > 1e-4 ? mul(n, x) : null);
      parts.treads++;
    }
    // risers, and a nosing on what the head lands on
    if (!look.open) for (let j = 0; j <= m; j++) {
      const A = Li[j], n = fwd(j), ya = j === 0 ? y0 : y0 + j * Rr, yb = y0 + (j + 1) * Rr - tt;
      X.para(sub(lp(A), mul(n, rt)), sub(rp(A), lp(A)), mul(n, rt), ya, yb, k.shade(pal.riser, k.jit(ri * 40 + j, 2)));
      parts.risers++;
    }
    if (rt + nos > 1e-4 && !R.fill) { const A = Li[m], n = fwd(m); X.para(sub(lp(A), mul(n, rt + nos)), sub(rp(A), lp(A)), mul(n, rt + nos), yTop - tt, yTop, pal.tread); }
    // the strings: their line runs along each side, half a string in from the edge
    const inward = (A, sg) => unit(sg < 0 ? sub(rp(A), lp(A)) : sub(lp(A), rp(A)));
    const sline = (sg, inset) => L.map((A) => add(sidePt(A, sg), mul(inward(A, sg), inset)));
    const fl = R.flare || { sides: [], n: 0 };
    const groups = (pts, j0, j1) => {
      // consecutive segments that are the same straight piece merge
      const out = [];
      for (let j = j0; j < j1; j++) {
        const e = sub(pts[j + 1], pts[j]), g = out[out.length - 1];
        if (g && Math.abs(crs(unit(g.e), unit(e))) < 1e-4 && Math.abs(len(g.e) - len(e)) < 1e-4 && dot(g.e, e) > 0) g.b = j + 1;
        else out.push({ a: j, b: j + 1, e });
      }
      return out;
    };
    const turnExt = (pts, gs, i, th) => {
      // lengthen a piece so its outer face meets the next one's on a curve
      const g = gs[i], nx = gs[i + 1], pv = gs[i - 1], ang = (h) => (h ? Math.abs(Math.atan2(crs(unit(g.e), unit(h.e)), dot(unit(g.e), unit(h.e)))) : 0);
      return (th / 2) * Math.tan(Math.max(ang(nx), ang(pv)) / 2) + 0.004;
    };
    for (const sg of [-1, 1]) {
      const pts = sline(sg, P.sThk / 2), j0 = fl.sides.includes(sg) ? Math.min(fl.n, m) : 0;
      const tops = pts.map((_, j) => yN(j) + P.sUp), gs = groups(pts, j0, m), sc = k.shade(pal.stringer, k.jit(ri, sg + 5));
      gs.forEach((g, i) => { X.slab(pts[g.a], pts[g.b], tops[g.a], tops[g.b], P.sDepth, P.sThk, sc, turnExt(pts, gs, i, P.sThk)); });
      if (gs.length) parts.stringers++;
      // round the curved landing at the head, level
      if (R.fill) {
        let prev = pts[m];
        R.fill.forEach((F) => { const q = add(sidePt(F, sg), mul(inward(F, sg), P.sThk / 2)); X.slab(prev, q, yTop + P.sUp, yTop + P.sUp, P.sDepth, P.sThk, sc, 0.012); prev = q; });
      }
    }
    // the soffit under closed risers, just above the strings' bottom edge, between them
    if (!look.open && m >= 1) {
      const M = L.map((A) => mid(lp(A), rp(A))), ys = (j) => yN(j) + P.sUp - P.sDepth + 0.025, gs = groups(M, 0, m);
      for (const g of gs) {
        const A = L[g.a], B = L[g.b], across = unit(add(sub(rp(A), lp(A)), sub(rp(B), lp(B)))), hw = (len(sub(rp(A), lp(A))) + len(sub(rp(B), lp(B)))) / 4 - P.sThk;
        const e = sub(M[g.b], M[g.a]), outer = Math.max(len(sub(lp(B), lp(A))), len(sub(rp(B), rp(A)))), f = Math.max(1, outer / (len(e) || 1)) + 0.02 / (g.b - g.a);
        const c = mid(M[g.a], M[g.b]), ya = ys(g.a), yb = ys(g.b);
        k.ob([c[0], c[1], (ya + yb) / 2], [(e[0] * f) / 2, (e[1] * f) / 2, ((yb - ya) * f) / 2], [0, 0, P.soffit / 2], [across[0] * hw, across[1] * hw, 0], pal.panel);
      }
    }
    // the balustrade on each open side
    const ends = {}, style = look.railStyle || 'square';
    for (const sg of openSides(look)) {
      const pts = sline(sg, P.sThk / 2), fls = fl.sides.includes(sg) && fl.n >= 1, j0 = fls ? 1 : 0, segs = [];
      const yr = (j) => yN(j) + P.rail;
      const rg = groups(pts, j0, m);
      rg.forEach((g, i) => {
        const ext = turnExt(pts, rg, i, P.railW), a = pts[g.a], b = pts[g.b], e = unit(sub(b, a)), sl = (yr(g.b) - yr(g.a)) / len(sub(b, a));
        const p = [a[0] - e[0] * ext, a[1] - e[1] * ext, yr(g.a) - sl * ext], q = [b[0] + e[0] * ext, b[1] + e[1] * ext, yr(g.b) + sl * ext];
        const nT = g.b - g.a, spots = [], Lg = len(sub(b, a)) + 2 * ext;
        // two balusters a tread on the string (on the tread itself where the foot is flared)
        // two a tread where the going at the rail allows, one on a tight inner edge
        const per = clamp(Math.floor(len(sub(b, a)) / nT / 0.12), 1, 2), fs = per === 2 ? [0.27, 0.77] : [0.5];
        if (style === 'square') for (let t = 0; t < nT; t++) for (const f of fs) spots.push((ext + ((t + f) / nT) * len(sub(b, a))) / Lg);
        const base = (x) => {
          const s = clamp((x * Lg - ext) / len(sub(b, a)), 0, 1) * nT, j = g.a + Math.min(nT - 1, Math.floor(s));
          return j < fl.n && fls ? y0 + (j + 1) * Rr : yN(g.a) + P.sUp + s * Rr;
        };
        segs.push({ p, q, spots, base, pn: false, qn: false });
        if (style === 'plain') for (let t = 0; t < nT; t++) if ((g.a + t) % 3 === 1) { const s = (t + 0.5) / nT, at = add(a, mul(sub(b, a), s)); X.baluster(at, base((ext + s * len(sub(b, a))) / Lg), yr(g.a) + (yr(g.b) - yr(g.a)) * s - P.railH); }
      });
      if (segs.length) k.rail(segs);
      // newels: at the foot (unless a volute takes it), at the head; level round a curved landing
      if (!fls) X.newel(pts[0][0], pts[0][1], y0, yr(0));
      let head = pts[m], hy = yr(m);
      if (R.fill) {
        const fpts = [pts[m], ...R.fill.map((F) => add(sidePt(F, sg), mul(inward(F, sg), P.sThk / 2)))], ys = yTop + P.rail, gsegs = [];
        for (let i = 0; i + 1 < fpts.length; i++) {
          const a = fpts[i], b = fpts[i + 1], e = unit(sub(b, a)), ext = 0.006, Lg = len(sub(b, a)), nb = style === 'square' ? Math.max(1, Math.round(Lg / P.balGap)) : 0, spots = [];
          for (let s = 0; s < nb; s++) spots.push((s + 0.5) / nb);
          gsegs.push({ p: [a[0] - e[0] * ext, a[1] - e[1] * ext, ys], q: [b[0] + e[0] * ext, b[1] + e[1] * ext, ys], spots, base: () => yTop, pn: false, qn: false });
        }
        // the rail climbs its last tread then runs level
        X.newel(pts[m][0], pts[m][1], yTop - 0.3, ys);
        k.rail(gsegs);
        (head = fpts[fpts.length - 1]), (hy = ys);
      }
      X.newel(head[0], head[1], R.to === 'landing' ? yTop - 0.25 : yTop - 0.3, hy);
      ends[sg] = { foot: pts[0], head, hy, fy: yr(0) };
      if (fls) flareRail(k, X, R, sg, pts, yr);
    }
    if (R.flare && R.flare.n) flareBlocks(k, X, R);
    return ends;
  }

  // ---- the flared foot: blocks with bullnose ends, the curtail round its newel
  function flareGeom(R, sg, j) {
    const L = R.lines, A = L[j - 1], B = L[j], Pt = sidePt(A, sg), Pn = sidePt(B, sg);
    const e = unit(sg < 0 ? sub(lp(A), rp(A)) : sub(rp(A), lp(A))), dv = sub(Pn, Pt), fv = sub(dv, mul(e, dot(dv, e)));
    const D1 = len(fv) || 0.25, f = unit(fv);
    return { Pt, e, f, D1, at: (s, t) => add(add(Pt, mul(f, s)), mul(e, t)) };
  }
  function flareBlocks(k, X, R) {
    const { Ly, look, pal, D } = k, Rr = Ly.riser, y0 = R.y0, F = R.flare, tt = D.tread, rt = look.open ? 0 : D.riser, nos = look.nosing ? D.nosing : 0;
    for (const sg of F.sides) for (let j = 1; j <= F.n; j++) {
      const g = flareGeom(R, sg, j), x = F.ext[j - 1], top = y0 + j * Rr, bc = k.shade(pal.riser, 0.97), tc = k.shade(pal.tread, k.jit(70 + j, sg + 3));
      // a box in the step's own frame: s along the going, t out from the stair's edge
      const fb = (s0, s1, t0, t1, ya, yb, c) => { if (s1 - s0 > 1e-4 && t1 - t0 > 1e-4) X.para(g.at(s0, t0), mul(g.f, s1 - s0), mul(g.e, t1 - t0), ya, yb, c); };
      if (j === 1) {
        // the curtail: a full octagon round the newel, joined to the stair
        const cu = (R.curtailBy ? R.curtailBy[sg] : R.curtail) || { r: 0.22 }, rc = cu.r, tN = x - rc, sN = g.D1 / 2 - 0.04, N = g.at(sN, tN);
        fb(-rt, g.D1, -0.03, tN, y0, top - tt, bc);
        X.octagon(N, g.f, g.e, rc, y0, top - tt, bc);
        fb(-rt - nos, g.D1, -0.03, tN, top - tt, top - 0.001, tc);
        X.octagon(N, g.f, g.e, rc + nos, top - tt, top - 0.001, tc);
        k.parts.treads++;
        continue;
      }
      // a bullnose: the block to the end's centre line, a half octagon beyond (its other half buried in the block)
      const rb = (g.D1 + rt) / 2, sc = (g.D1 - rt) / 2, tc0 = x - rb, a = rb * OCT, C = g.at(sc, tc0);
      fb(-rt, g.D1, -0.03, Math.max(-0.02, tc0 + a), y0, top - tt, bc);
      X.octagon(C, g.f, g.e, rb, y0, top - tt, bc, []);
      const rb2 = rb + nos, a2 = rb2 * OCT, C2 = g.at(sc - nos / 2, tc0);
      fb(-rt - nos, g.D1, -0.03, Math.max(-0.02, tc0 + a2), top - tt, top - 0.001, tc);
      X.octagon(C2, g.f, g.e, rb2, top - tt, top - 0.001, tc, []);
      k.parts.treads++;
    }
  }
  // the rail at a flared foot: down the pitch to the first riser line but one, a ramp, then a level volute round the
  // curtail's newel with balusters round the scroll
  function flareRail(k, X, R, sg, pts, yr) {
    const { Ly, look } = k, Rr = Ly.riser, y0 = R.y0, cu = R.curtailBy ? R.curtailBy[sg] : R.curtail;
    if (!cu) return;
    const g = flareGeom(R, sg, 1), N = cu.c, hv = y0 + Rr + P.rail;
    // the volute in the step's frame round N: it starts beside the newel on the rail's line, curls out, round and in
    const r0 = Math.max(0.09, Math.abs(dot(sub(pts[0], N), g.e))), A = add(N, mul(g.e, -r0));
    X.railBar(pts[1], A, yr(1), hv, 0.01);
    const K = 8, pt = (i) => { const tau = i / K, ang = -Math.PI / 2 - 2 * Math.PI * tau, r = r0 - (r0 - P.voluteEye) * tau; return add(N, add(mul(g.f, Math.cos(ang) * r), mul(g.e, Math.sin(ang) * r))); };
    let prev = pt(0);
    for (let i = 1; i <= K; i++) { const q = pt(i); X.railBar(prev, q, hv, hv, 0.012); prev = q; }
    // balusters round the scroll on the curtail, one under the ramp
    for (const i of [1, 3, 5]) X.baluster(pt(i), y0 + Rr, hv - P.railH * 0.5);
    if (look.railStyle !== 'plain') X.baluster(mid(pts[1], A), y0 + Rr, (yr(1) + hv) / 2 - P.railH);
    // the newel under the eye
    const h = 0.034;
    k.box(N[0] - h, N[1] - h, N[0] + h, N[1] + h, y0 + Rr, hv - P.railH * 0.6, k.pal.newel);
    k.box(N[0] - 0.05, N[1] - 0.05, N[0] + 0.05, N[1] + 0.05, y0 + Rr, y0 + Rr + 0.12, k.pal.newel);
    k.parts.newels++;
  }

  // ---- landings
  function landing(k, X, Lnd, look) {
    const { pal } = k, y = Lnd.y, yd = y - P.deck, yf = y - P.fascia;
    if (Lnd.quads) {
      // the curved landing at a curve's head: decking only, the strings carry it
      for (const q of Lnd.quads) X.quad(q, yd, y, pal.deck);
      if (!look.open) for (const q of Lnd.quads) X.quad(q, yf - P.soffit, yf, pal.panel);
      return;
    }
    let poly;
    if (Lnd.pts) {
      // the horseshoe's apex: a box on the floor side, a trapezoid between the legs
      const [p1, p2, p3, p4, p5, p6] = Lnd.pts;
      X.para(p2, sub(p3, p2), sub(p5, p2), yd, y, pal.deck);
      X.quad([p1, p2, p5, p6], yd, y, pal.deck);
      poly = Lnd.pts;
      if (!look.open) X.quad([p1, p2, p5, p6], yf - P.soffit, yf, pal.panel), X.para(p2, sub(p3, p2), sub(p5, p2), yf - P.soffit, yf, pal.panel);
    } else {
      const [u0, v0, u1, v1] = Lnd.r;
      k.box(u0, v0, u1, v1, yd, y, pal.deck);
      if (!look.open) k.box(u0 + 0.02, v0 + 0.02, u1 - 0.02, v1 - 0.02, yf, yf + P.soffit, pal.panel);
      poly = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    }
    // the fascia round it, set in, and posts at the corners down to the floor
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    const inn = (p, d) => add(p, mul(unit(sub([cx, cy], p)), d));
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (len(sub(b, a)) < 0.05) continue;
      const n = unit([-(b[1] - a[1]), b[0] - a[0]]), s = dot(n, sub([cx, cy], a)) > 0 ? 1 : -1, o = mul(n, (s * P.fasciaT) / 2);
      X.wall(add(a, o), add(b, o), P.fasciaT, yf, yd, pal.stringer);
    }
    const posts = Lnd.pts ? [Lnd.pts[2], Lnd.pts[3], Lnd.pts[0], Lnd.pts[5]] : poly;
    for (const p of posts) { const q = inn(p, 0.09), h = P.post / 2; k.box(q[0] - h, q[1] - h, q[0] + h, q[1] + h, 0, yf, pal.stringer); k.parts.posts++; }
  }

  // a guard along plan points at floor height y: rail 0.9 up with its infill, newels at the ends
  function guard(k, X, a, b, y, opts = {}) {
    const style = k.look.railStyle || 'square', Lg = len(sub(b, a));
    if (Lg < 0.05) return;
    const spots = [];
    if (style === 'square') { const nb = Math.max(1, Math.round(Lg / (opts.gap || P.guardGap)) - 1); for (let i = 1; i <= nb; i++) spots.push(i / (nb + 1)); }
    k.rail([{ p: [a[0], a[1], y + P.rail], q: [b[0], b[1], y + P.rail], spots, base: () => y, pn: false, qn: false }]);
    if (style === 'plain') { const m = Math.max(1, Math.round(Lg / 1.2)); for (let i = 1; i < m; i++) X.baluster(add(a, mul(sub(b, a), i / m)), y, y + P.rail - P.railH); }
    if (opts.newels !== false) X.newel(a[0], a[1], opts.yb ?? y - 0.25, y + P.rail), X.newel(b[0], b[1], opts.yb ?? y - 0.25, y + P.rail);
  }

  // the edges of the union of the well's rects, less where a flight arrives: [[a, b], ...]
  function wellEdges(well, arrive) {
    const out = [], inside = (u, v) => well.some((W) => u > W[0] + 1e-4 && u < W[2] - 1e-4 && v > W[1] + 1e-4 && v < W[3] - 1e-4);
    for (const W of well) {
      for (const [ax, c, a0, a1, s] of [['v', W[1], W[0], W[2], -1], ['v', W[3], W[0], W[2], 1], ['u', W[0], W[1], W[3], -1], ['u', W[2], W[1], W[3], 1]]) {
        const cuts = [a0, a1];
        for (const X of well) for (const q of ax === 'v' ? [X[0], X[2]] : [X[1], X[3]]) if (q > a0 && q < a1) cuts.push(q);
        for (const [p, q] of arrive) for (const x of ax === 'v' ? [p[0], q[0]] : [p[1], q[1]]) if (x > a0 && x < a1) cuts.push(x);
        cuts.sort((x, y) => x - y);
        for (let i = 0; i + 1 < cuts.length; i++) {
          const s0 = cuts[i], s1 = cuts[i + 1], m = (s0 + s1) / 2;
          if (s1 - s0 < 0.02) continue;
          const pt = ax === 'v' ? [m, c + s * 0.01] : [c + s * 0.01, m], on = ax === 'v' ? [m, c] : [c, m];
          if (inside(pt[0], pt[1])) continue;
          // still open on the inner side? (an edge shared by two rects is inside both)
          const pin = ax === 'v' ? [m, c - s * 0.01] : [c - s * 0.01, m];
          if (!well.some((X) => pin[0] >= X[0] - 1e-4 && pin[0] <= X[2] + 1e-4 && pin[1] >= X[1] - 1e-4 && pin[1] <= X[3] + 1e-4)) continue;
          if (arrive.some(([p, q]) => {
            const e = sub(q, p), l = len(e) || 1, t = dot(sub(on, p), e) / (l * l), d = Math.abs(crs(e, sub(on, p))) / l;
            return d < 0.01 && t > -0.01 && t < 1.01;
          })) continue;
          out.push({ ax, c, s0, s1 });
        }
      }
    }
    // join pieces end to end on the same line
    out.sort((a, b) => (a.ax < b.ax ? -1 : a.ax > b.ax ? 1 : a.c - b.c || a.s0 - b.s0));
    const merged = [];
    for (const e of out) {
      const g = merged[merged.length - 1];
      if (g && g.ax === e.ax && Math.abs(g.c - e.c) < 1e-4 && Math.abs(g.s1 - e.s0) < 1e-4) g.s1 = e.s1;
      else merged.push({ ...e });
    }
    return merged.map((e) => (e.ax === 'v' ? [[e.s0, e.c], [e.s1, e.c]] : [[e.c, e.s0], [e.c, e.s1]]));
  }

  // ---- the part maker for the grand types
  function grandKind(k) {
    const { Ly, look } = k, X = tools(k), T = Ly.tread, Fl = Ly.flare;
    const runs = [];
    if (Ly.curves && Ly.curves.length) {
      const fillL = Ly.landings.find((l) => l.quads);
      Ly.curves.forEach((cv, i) => runs.push({ lines: cv.lines, y0: cv.y0, from: 'floor', to: Ly.type === 'horseshoe' ? 'landing' : 'floor', fill: i === 0 && fillL ? fillL.quads.map((q) => [q[3][0], q[3][1], q[2][0], q[2][1]]) : null }));
    } else (Ly.flights || []).forEach((f, i) => runs.push({ lines: flightLines(f, T), y0: f.y0, from: i ? 'landing' : 'floor', to: i ? 'floor' : 'landing' }));
    // which runs start flared: the first (both legs of a horseshoe)
    if (Fl && Fl.n) {
      const firsts = Ly.type === 'horseshoe' ? runs : runs.slice(0, 1);
      for (const R of firsts) {
        R.flare = { n: Fl.n, sides: Fl.sides, ext: Fl.ext };
        const foot = mid(lp(R.lines[0]), rp(R.lines[0]));
        R.curtails = Fl.curtail.filter((c) => len(sub(c.c, foot)) < 2.5);
      }
    }
    const ends = runs.map((R, i) => {
      const per = {};
      // each side's curtail is the one nearest that side's foot
      if (R.curtails) for (const sg of R.flare.sides) { const p = sidePt(R.lines[0], sg); per[sg] = R.curtails.reduce((b, c) => (!b || len(sub(c.c, p)) < len(sub(b.c, p)) ? c : b), null); }
      return runWithCurtails(k, X, R, i, per);
    });
    for (const Lnd of Ly.landings) landing(k, X, Lnd, look);
    landingGuards(k, X, runs, ends);
    // the gallery round the opening in the floor above
    if (look.gallery !== false && look.rail !== 'none' && Ly.well && Ly.well.length) {
      // by default along the gallery front, the edges flights arrive on; 'all': every open edge of the opening
      const arr = Ly.arrive || [], front = (a, b) => arr.some(([p, q]) => { const e = sub(q, p), l = len(e) || 1; return Math.abs(crs(e, sub(a, p))) / l < 0.01 && Math.abs(crs(e, sub(b, p))) / l < 0.01; });
      for (const [a, b] of wellEdges(Ly.well, arr)) if (look.gallery === 'all' || front(a, b)) guard(k, X, a, b, Ly.rise, { yb: Ly.rise - 0.25 });
    }
    X.drawNewels();
  }
  // run() with the curtail of each flared side handed in
  function runWithCurtails(k, X, R, i, per) {
    return run(k, X, { ...R, curtailBy: per }, i);
  }

  // landing guards: an imperial or bifurcated landing's open edges, from rail end to rail end
  function landingGuards(k, X, runs, ends) {
    const { Ly, look } = k;
    if (look.rail === 'none' || !Ly.landing || Ly.landing.quads) return;
    const Lnd = Ly.landing, y = Lnd.y;
    if (Ly.type === 'horseshoe') {
      // the apex landing's sides between the legs' outer rails and the floor's edge
      const [p1, p2, p3, p4, p5, p6] = Lnd.pts;
      if (openSides(look).length) guard(k, X, p5, p4, y, { yb: y - 0.25 }), guard(k, X, p2, p3, y, { yb: y - 0.25 }), guard(k, X, p6, p1, y, { yb: y - 0.25 });
      return;
    }
    const [u0, v0, u1, v1] = Lnd.r, e = 0.03, wallBack = look.rail === 'wall';
    if (!wallBack) guard(k, X, [u1 - e, v0 + e], [u1 - e, v1 - e], y);
    if (Ly.type === 'imperial') {
      // the ends, from the back corners to where each wing's outer rail starts; the short gaps beside the central flight
      guard(k, X, [u1 - e, v1 - e], [u0, v1 - e], y);
      guard(k, X, [u1 - e, v0 + e], [u0, v0 + e], y);
      const wc = Ly.flights[0].w, g = RULES_GAP(Ly);
      for (const s of [-1, 1]) guard(k, X, [u0, s * (wc / 2 - 0.02)], [u0, s * (wc / 2 + g + 0.02)], y, { newels: true, gap: 0.1 });
    }
  }
  const RULES_GAP = (Ly) => { const R = ST() && ST().RULES; return (R && R.grand && R.grand.gap) || 0.1; };

  // ---- flared straight, L and U stairs: stairs-geo's flight with its foot newel and the bottom of its rail given way
  function flared(base) {
    return function (k) {
      const { Ly, look } = k, Fl = Ly.flare;
      if (!Fl || !Fl.n || !Ly.flights || !Ly.flights.length || look.mat === 'stone') return base(k);
      const f = Ly.flights[0], T = Ly.tread, R = { lines: flightLines(f, T), y0: f.y0, flare: { n: Fl.n, sides: Fl.sides, ext: Fl.ext } };
      const p = [-f.d[1], f.d[0]], hw = f.w / 2, E = k.D.edge, open = openSides(look).filter((sg) => Fl.sides.includes(sg));
      const foot = open.map((sg) => ({ sg, q: add(f.a, mul(p, sg * (hw - E))) }));
      const near = (u, v) => foot.find((o) => len(sub(o.q, [u, v])) < 0.12);
      const rail0 = k.rail, newel0 = k.newel, nose = (s) => f.y0 + Ly.riser + ((s + (look.open ? 0 : k.D.riser) + (look.nosing ? k.D.nosing : 0)) * Ly.riser) / T;
      k.rail = (segs) => rail0(segs.map((sg) => {
        if (!near(sg.p[0], sg.p[1])) return sg;
        // start the rail one tread up; keep the infill above it
        const sA = dot(sub(sg.p, f.a), f.d), sB = dot(sub(sg.q, f.a), f.d), s1 = T, t = (s) => (s - sA) / (sB - sA), q1 = add(add(f.a, mul(f.d, s1)), mul(p, dot(sub(sg.p, f.a), p)));
        const spots = (sg.spots || []).filter((x) => sA + x * (sB - sA) > s1 + 0.03).map((x) => (sA + x * (sB - sA) - s1) / (sB - s1));
        const base = sg.base ? (x) => sg.base(t(s1 + x * (sB - s1))) : undefined;
        return { ...sg, p: [q1[0], q1[1], nose(s1) + k.D.rail], spots, base, pn: false };
      }));
      k.newel = (u, v, yb, yt, o) => (near(u, v) ? { u, v, yb, yt } : newel0(u, v, yb, yt, o));
      try { base(k); } finally { k.rail = rail0, (k.newel = newel0); }
      const X = tools(k), yr = (j) => nose(j * T) + k.D.rail;
      for (const sg of Fl.sides) {
        const cu = Fl.curtail.reduce((b, c) => (!b || len(sub(c.c, sidePt(R.lines[0], sg))) < len(sub(b.c, sidePt(R.lines[0], sg))) ? c : b), null);
        const Rs = { ...R, curtail: cu, flare: { ...R.flare, sides: [sg] } };
        flareBlocks(k, X, Rs);
        if (open.includes(sg)) flareRail(k, X, Rs, sg, R.lines.map((A) => add(sidePt(A, sg), mul(p, -sg * E))), yr);
      }
      X.drawNewels();
    };
  }

  // ---- drawings
  const f1 = (v) => Math.round(v * 10) / 10;
  const m2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const wrap = (W, H, out, label, cls) =>
    '<svg class="' + cls + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(label) + '" font-family="var(--cad-font, system-ui, sans-serif)">' + out.join('') + '</svg>';
  const nameOf = (Ly) => { const t = ST() && ST().TYPE_BY_ID && ST().TYPE_BY_ID[Ly.type]; return (t ? t.name : 'Stair') + (Ly.label ? ' ' + Ly.label : ''); };
  function runsForDraw(Ly) {
    const T = Ly.tread;
    if (Ly.curves && Ly.curves.length) return Ly.curves.map((cv) => ({ lines: cv.lines, y0: cv.y0 }));
    return (Ly.flights || []).map((f) => ({ lines: flightLines(f, T), y0: f.y0 }));
  }
  const landPolys = (Ly) => (Ly.landings || []).flatMap((l) => (l.quads ? l.quads : l.pts ? [l.pts] : [[[l.r[0], l.r[1]], [l.r[2], l.r[1]], [l.r[2], l.r[3]], [l.r[0], l.r[3]]]]));
  const caption = (Ly) => Ly.n + ' × ' + Math.round(Ly.riser * 1000) + ' mm · going ' + Math.round(Ly.tread * 1000) + ' mm';
  const caption2 = (Ly) => (Ly.curves && Ly.curves.length ? 'R ' + m2(Ly.radius) + ' m inside · ' + Ly.sweep + '° · narrow end ' + Math.round(Ly.narrow * 1000) + ' mm' : 'landing after riser ' + Ly.at);

  function planSvg(Ly, size, opts) {
    const thumb = size === 'thumb', W = opts.width || (thumb ? 56 : 240), H = opts.height || (thumb ? 56 : 160);
    const b = (Ly.box || [0, -1, 2, 1]).slice();
    for (const w of Ly.well || []) if (!thumb) (b[0] = Math.min(b[0], w[0])), (b[1] = Math.min(b[1], w[1])), (b[2] = Math.max(b[2], w[2])), (b[3] = Math.max(b[3], w[3]));
    const pad = thumb ? 4 : 14, padB = thumb ? 4 : 24;
    const k = Math.min((W - 2 * pad) / (b[2] - b[0] || 1), (H - pad - padB) / (b[3] - b[1] || 1));
    const ox = (W - (b[2] - b[0]) * k) / 2 - b[0] * k, oy = pad + (H - pad - padB - (b[3] - b[1]) * k) / 2 - b[1] * k;
    const Pp = (p) => f1(ox + p[0] * k) + ' ' + f1(oy + p[1] * k);
    const ink = thumb ? 'currentColor' : 'var(--cad-ink)', line = thumb ? 'currentColor' : 'var(--cad)', sw = thumb ? 1.2 : 1.1;
    const out = [];
    if (!thumb) {
      out.push('<rect width="' + W + '" height="' + H + '" fill="var(--cad-bg)"/>');
      for (const w of Ly.well || []) out.push('<path d="M' + Pp([w[0], w[1]]) + 'L' + Pp([w[2], w[1]]) + 'L' + Pp([w[2], w[3]]) + 'L' + Pp([w[0], w[3]]) + 'Z" fill="none" stroke="' + line + '" stroke-width=".8" stroke-dasharray="4 3" stroke-opacity=".8"/>');
    }
    for (const q of landPolys(Ly)) out.push('<path d="M' + q.map(Pp).join('L') + 'Z" fill="' + line + '" fill-opacity="' + (thumb ? 0.28 : 0.16) + '" stroke="' + ink + '" stroke-width="' + (thumb ? 0.9 : 1) + '" stroke-linejoin="round"/>');
    if (Ly.flare) {
      for (const q of Ly.flare.quads) out.push('<path d="M' + q.pts.map(Pp).join('L') + 'Z" fill="none" stroke="' + ink + '" stroke-width="' + (thumb ? 0.8 : 0.9) + '"/>');
      for (const c of Ly.flare.curtail) out.push('<circle cx="' + f1(ox + c.c[0] * k) + '" cy="' + f1(oy + c.c[1] * k) + '" r="' + f1(c.r * k) + '" fill="none" stroke="' + ink + '" stroke-width="' + (thumb ? 0.8 : 0.9) + '"/>');
    }
    let risers = '';
    for (const R of runsForDraw(Ly)) {
      const L = R.lines;
      out.push('<path d="M' + L.map((A) => Pp(lp(A))).join('L') + 'M' + L.map((A) => Pp(rp(A))).join('L') + '" fill="none" stroke="' + ink + '" stroke-width="' + sw + '" stroke-linejoin="round"/>');
      L.forEach((A, j) => { if (!thumb || j % 2 === 0 || j === L.length - 1) risers += 'M' + Pp(lp(A)) + 'L' + Pp(rp(A)); });
    }
    out.push('<path d="' + risers + '" stroke="' + line + '" stroke-width="' + (thumb ? 0.7 : 0.75) + '" stroke-opacity="' + (thumb ? 0.75 : 0.9) + '"/>');
    // the walking line and the way up
    const pts = [];
    for (const g of Ly.path || []) { if (!pts.length) pts.push(g.a); pts.push(g.b); }
    if (pts.length > 1) {
      const lw = thumb ? 1.1 : 1.2;
      out.push('<path d="M' + pts.map(Pp).join('L') + '" fill="none" stroke="' + line + '" stroke-width="' + lw + '"/>');
      const e = pts[pts.length - 1], dd = unit(sub(e, pts[pts.length - 2])), ah = (thumb ? 4.5 : 7) / k, hb = sub(e, mul(dd, ah));
      out.push('<path d="M' + Pp([hb[0] - dd[1] * ah * 0.6, hb[1] + dd[0] * ah * 0.6]) + 'L' + Pp(e) + 'L' + Pp([hb[0] + dd[1] * ah * 0.6, hb[1] - dd[0] * ah * 0.6]) + '" fill="none" stroke="' + line + '" stroke-width="' + lw + '" stroke-linejoin="round"/>');
      out.push('<circle cx="' + f1(ox + pts[0][0] * k) + '" cy="' + f1(oy + pts[0][1] * k) + '" r="' + (thumb ? 1.6 : 2.4) + '" fill="' + line + '"/>');
      if (!thumb) {
        const s = pts[0], d0 = unit(sub(pts[1], pts[0])), lab = sub(s, mul(d0, 14 / k));
        out.push('<text x="' + f1(ox + lab[0] * k) + '" y="' + f1(oy + lab[1] * k + 4) + '" font-size="10" font-weight="600" text-anchor="middle" fill="var(--cad-ink)">UP</text>');
      }
    }
    if (!thumb) {
      const bx = Ly.box, ty = H - 9;
      out.push('<text x="' + W / 2 + '" y="' + ty + '" font-size="10" text-anchor="middle" fill="var(--cad-ink)">' + m2(bx[2] - bx[0]) + ' × ' + m2(bx[3] - bx[1]) + ' m' + (Ly.sweep ? ' · ' + Ly.sweep + '° · R ' + m2(Ly.radius) + ' m' : Ly.at ? ' · landing after ' + Ly.at : '') + '</text>');
    }
    return wrap(W, H, out, opts.label || nameOf(Ly) + (thumb ? '' : ': plan'), thumb ? 'st-thumb' : 'st-plan');
  }

  // an elevation from the climber's left at the foot, looking along +v: u across, height up. A bifurcated stair is seen
  // from its foot instead, looking along +u, so its wings open out left and right.
  function stageSvg(Ly, opts) {
    const W = opts.width || 360, H = opts.height || 220, rise = Ly.rise, Rr = Ly.riser;
    const rail = opts.rail ?? true, ax = Ly.type === 'bifurcated' ? 1 : 0, dp = 1 - ax;
    const bb = Ly.box, b = ax ? [bb[1], bb[0], bb[3], bb[2]] : bb, ml = 22, mr = 62, mt = 40, mb = 40;
    const x0 = b[0] - 0.5, x1 = b[2] + 0.5, ytop = rise + (rail ? 1.02 : 0.15);
    const k = Math.min((W - ml - mr) / (x1 - x0), (H - mt - mb) / ytop);
    const ox = ml + (W - ml - mr - (x1 - x0) * k) / 2 - x0 * k, oy = H - mb;
    const X = (u) => f1(ox + u * k), Y = (y) => f1(oy - y * k), vmid = ax ? b[1] + 0.35 * (b[3] - b[1]) : (b[1] + b[3]) / 2;
    const ink = 'var(--cad-ink)', line = 'var(--cad)';
    const out = ['<rect width="' + W + '" height="' + H + '" fill="var(--cad-bg)"/>'];
    out.push('<path d="M' + X(x0) + ' ' + Y(0) + 'H' + X(x1) + '" stroke="' + ink + '" stroke-width="1.4"/>');
    // the floor above, open over the well
    if (Ly.well && Ly.well.length) {
      const iv = Ly.well.map((w) => [w[ax], w[ax + 2]]).sort((a, c) => a[0] - c[0]), segs = [];
      let s = x0;
      for (const [a, c] of iv) { if (a > s) segs.push([s, a]); s = Math.max(s, c); }
      if (s < x1) segs.push([s, x1]);
      for (const [a, c] of segs) out.push('<rect x="' + X(a) + '" y="' + Y(rise) + '" width="' + f1((c - a) * k) + '" height="' + f1(Math.max(2, 0.12 * k)) + '" fill="' + line + '" fill-opacity=".18" stroke="' + ink + '" stroke-width="1"/>');
    }
    // treads as bars at their height, far ones faint
    const items = [];
    for (const R of runsForDraw(Ly)) for (let j = 1; j < R.lines.length; j++) {
      const A = R.lines[j - 1], B = R.lines[j], us = [A[ax], A[ax + 2], B[ax], B[ax + 2]], vs = [A[dp], A[dp + 2], B[dp], B[dp + 2]];
      items.push({ u0: Math.min(...us), u1: Math.max(...us), y: R.y0 + j * Rr, v: (vs[0] + vs[1] + vs[2] + vs[3]) / 4 });
    }
    for (const q of landPolys(Ly)) { const us = q.map((p) => p[ax]); items.push({ u0: Math.min(...us), u1: Math.max(...us), y: (Ly.landings.find((l) => (l.quads || [l.pts || 0]).includes(q)) || Ly.landing || { y: rise }).y, v: q.reduce((a, p) => a + p[dp], 0) / q.length, land: true }); }
    items.sort((a, c) => c.v - a.v);
    const th = Math.max(2, 0.04 * k);
    for (const t of items) {
      const near = t.v <= vmid + 1e-6;
      out.push('<rect x="' + X(t.u0) + '" y="' + Y(t.y) + '" width="' + f1(Math.max(1, (t.u1 - t.u0) * k)) + '" height="' + f1(t.land ? th * 1.4 : th) + '" fill="' + (near ? line : 'none') + '" fill-opacity="' + (near ? 0.5 : 0) + '" stroke="' + ink + '" stroke-width="' + (near ? 1 : 0.7) + '" stroke-opacity="' + (near ? 1 : 0.35) + '"/>');
    }
    if (rail) {
      // the rails along each side of each run, near solid, far faint
      for (const R of runsForDraw(Ly)) for (const sg of [-1, 1]) {
        const L = R.lines, pts = L.map((A, j) => ({ u: sidePt(A, sg)[ax], v: sidePt(A, sg)[dp], y: R.y0 + (j + 1) * Rr + 0.9 }));
        let dn = '', df = '';
        for (let i = 0; i + 1 < pts.length; i++) {
          const p = pts[i], q = pts[i + 1], seg = 'M' + X(p.u) + ' ' + Y(p.y) + 'L' + X(q.u) + ' ' + Y(q.y);
          if ((p.v + q.v) / 2 <= vmid) dn += seg; else df += seg;
        }
        if (df) out.push('<path d="' + df + '" fill="none" stroke="' + line + '" stroke-width="1" stroke-opacity=".4"/>');
        if (dn) out.push('<path d="' + dn + '" fill="none" stroke="' + line + '" stroke-width="1.5"/>');
      }
    }
    const xr = W - mr + 18, ty = H - mb + 18;
    out.push('<path d="M' + xr + ' ' + Y(0) + 'V' + Y(rise) + 'M' + (xr - 4) + ' ' + Y(0) + 'h8M' + (xr - 4) + ' ' + Y(rise) + 'h8" stroke="var(--cad)" stroke-width=".8"/>');
    out.push('<text x="' + (xr + 6) + '" y="' + f1((+Y(0) + +Y(rise)) / 2 + 4) + '" font-size="11" fill="var(--cad-ink)">' + m2(rise) + ' m</text>');
    out.push('<path d="M' + X(b[0]) + ' ' + ty + 'H' + X(b[2]) + 'M' + X(b[0]) + ' ' + (ty - 4) + 'v8M' + X(b[2]) + ' ' + (ty - 4) + 'v8" stroke="var(--cad)" stroke-width=".8"/>');
    out.push('<text x="' + f1((+X(b[0]) + +X(b[2])) / 2) + '" y="' + (ty + 14) + '" font-size="11" text-anchor="middle" fill="var(--cad-ink)">' + m2(bb[2] - bb[0]) + ' m long · ' + m2(bb[3] - bb[1]) + ' m wide</text>');
    out.push('<text x="' + ml + '" y="18" font-size="12" fill="var(--cad-ink)">' + esc(caption(Ly)) + '</text>');
    out.push('<text x="' + ml + '" y="33" font-size="10.5" fill="var(--cad)">' + esc(caption2(Ly)) + '</text>');
    if (Number.isFinite(Ly.headroom)) out.push('<text x="' + (W - 8) + '" y="18" font-size="11" text-anchor="end" fill="var(--cad)">headroom ' + m2(Ly.headroom) + ' m</text>');
    return wrap(W, H, out, opts.label || nameOf(Ly) + ': side view', 'st-side');
  }

  function drawGrand(Ly, size, opts = {}) {
    if (!Ly || !GRAND.includes(Ly.type)) return null;
    if (size === 'thumb' || size === 'plan') return planSvg(Ly, size, opts);
    return stageSvg(Ly, opts);
  }

  for (const t of GRAND) (S.kinds[t] = grandKind), (S.drawKinds[t] = drawGrand);
  for (const t of ['straight', 'l', 'u']) {
    if (typeof S.kinds[t] === 'function') S.kinds[t] = flared(S.kinds[t]);
    // their plan shows the flared foot; everything else stays stairs-geo's drawing
    const prev = S.drawKinds[t];
    S.drawKinds[t] = (Ly, size, opts = {}) => (Ly && Ly.flare && size === 'plan' ? planSvg(Ly, size, opts) : prev ? prev(Ly, size, opts) : null);
  }
  S.grandKinds = GRAND.slice();
  S.wellEdges = wellEdges;
})();
