/* Stair carpentry: a solved stair layout (src/sim/content/stairs.js, window.__stairs) turned into real parts, as plain
   box lists for the building's merged mesh, and drawn as SVG for the tray and the inspector (window.__stairsGeo).
   Plan: docs/design/plan-mode-redesign.md, section 3A.5. String and number building only: no DOM, no three.js, nothing
   per frame, so it runs under node too (globalThis.__stairsGeo).

   The parts: two cut stringers on the slope (a sloped spine and one tooth under each tread; a middle one on wide steps),
   treads 40 mm thick with a 25 mm nosing, risers 20 mm (or none), newel posts 90 mm at the foot, the head and every
   turn, a handrail 0.9 m above the nosings, balusters two to a tread (about 110 mm apart on a guard) or three raking
   rails, landings as a framed platform on four posts, winders as three wedge treads on a framed corner. Stone steps are
   stacked blocks. A ship's ladder is two plain stringers with housed treads and a handrail each side. Spiral is S3's
   (kinds.spiral, src/stairs-spiral.js).

   INTERFACE
     build(layout, look?, opts?) -> { abox, obox, count, parts }
       layout   a solve() / layoutOf() result. Its own x, z, dir place it in building metres.
       look     lookOf(record, layout) ({ mat, rail, railStyle, open, nosing, boxed }); missing fields take lookOf's
                defaults. Extra, optional: wall: 'left' | 'right' | 'both' (default 'both'), the sides a wall runs along
                when rail is 'wall' (a handrail on brackets and a skirt board there, nothing on the other side);
                palette: { tread, riser, stringer, newel, rail, baluster, deck, panel, door } [r, g, b] overrides.
       opts.y0  added to every height (default 0: heights are metres above the foot's surface, as in the layout).
       abox     [[x0, y0, z0, x1, y1, z1, rgb], ...]   -> g.abox(...b)   (axis-aligned in building metres)
       obox     [[c, U, V, W, rgb], ...] c and the half-extent vectors as [x, y, z]   -> g.obox(...b)
       rgb      linear [r, g, b] like build.js col(): new THREE.Color(hex) with colour management on.
       count    abox.length + obox.length.  parts: { treads, risers, stringers, balusters, newels, posts, rail (m) }.
       A stair whose dir is not a whole quarter turn comes back as obox only.
     emit(g, layout, look?, opts?) -> count: build() pushed straight into a Geo (g.abox / g.obox).
     draw(layout | typeId, size?, opts?) -> '<svg ...>'
       size 'stage' (default, 360 x 220): the side view, developed along the walking line, with the rise, the run and
            "16 x 178 mm" in --cad on --cad-bg. 'thumb' (56 x 56, currentColor): the type at a glance, side view for
            single flights, plan for turning stairs. 'plan' (240 x 160): the plan with every tread and the walking line.
       A type id draws a typical stair of that type (a storey; Steps 0.5 m, Deck steps 0.9 m). opts.width, opts.height,
       opts.label (aria-label), opts.rail (side view: draw the handrail; default from the layout).
     topAt(layout, u, v) the tread, landing or winder top under a point of the stair's own frame (null when off it).
     kinds    { steps, straight, l, u, winder, deck, ladder, spiral } the part makers by type: fn(k) with k the kit below.
     drawKinds { spiral } optional (layout, size, opts) -> svg string | null, for types that draw themselves.
     The kit k a part maker gets: { Ly, look, pal, D, box(u0, v0, u1, v1, y0, y1, rgb), ob(c, U, V, W, rgb),
       newel(u, v, yb, yt), post(u, v, yb, yt), rail(segs), shade, jit(i, j) }. Coordinates are the stair's local frame
       [u, v, y] (u forward from the foot, v to the climber's right, y above the foot), converted by the kit. rail(segs)
       draws a handrail with its infill (railStyle) along [{ p: [u, v, yTop], q: [u, v, yTop] }] and returns the ends;
       newel(...) records a newel to be drawn once (posts at the same spot merge).
*/
(() => {
  const G = globalThis;
  if (G.__stairsGeo) return;
  const ST = () => G.__stairs || null;

  // sizes, metres
  const D = Object.freeze({
    tread: 0.04, nosing: 0.025, riser: 0.02, newel: 0.09, cap: 0.118, capH: 0.035, rail: 0.9, railW: 0.066, railH: 0.052,
    bal: 0.032, balGap: 0.11, stringer: 0.038, throat: 0.15, deck: 0.03, rim: 0.2, rimT: 0.045, post: 0.09, panel: 0.012,
    edge: 0.045,   // the newel, baluster and stringer line, in from the stair's side
  });
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lin1 = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const col = (hex) => [lin1(((hex >> 16) & 255) / 255), lin1(((hex >> 8) & 255) / 255), lin1((hex & 255) / 255)].map(r4);
  const shade = (c, k) => [r4(c[0] * k), r4(c[1] * k), r4(c[2] * k)];
  const hash = (a, b, c) => { const h = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return h - Math.floor(h); };

  // finishes: hex sRGB like the rest of build.js
  const MATS = {
    pine: { tread: 0xc69a62, riser: 0xbb915c, stringer: 0xa67d4c, newel: 0x9e7444, rail: 0x8f663b, baluster: 0xc0966a, deck: 0xbf945d },
    oak: { tread: 0xa57843, riser: 0x9a6f40, stringer: 0x86603a, newel: 0x7c5532, rail: 0x6c482a, baluster: 0x9c7246, deck: 0xa07444 },
    dark: { tread: 0x60452f, riser: 0x573e2b, stringer: 0x4b3524, newel: 0x412d1f, rail: 0x36261a, baluster: 0x5b412d, deck: 0x5c422e },
    white: { tread: 0xa57843, riser: 0xe6e2d8, stringer: 0xe0dcd1, newel: 0xeae6dc, rail: 0x5b3f29, baluster: 0xece8df, deck: 0xa57843 },
    stone: { tread: 0x928e85, riser: 0x86827a, stringer: 0x7d7972, newel: 0x2d2b29, rail: 0x2d2b29, baluster: 0x2d2b29, deck: 0x928e85 },
  };
  function palette(look) {
    const m = MATS[look.mat] || MATS.pine, out = {};
    for (const k in m) out[k] = col(m[k]);
    out.panel = look.mat === 'white' ? col(0xe4e0d6) : shade(out.stringer, 1.06);
    out.door = look.mat === 'white' ? col(0xdcd8cd) : shade(out.tread, 0.92);
    out.knob = col(0x3a3631);
    out.iron = look.mat === 'stone';
    if (look.palette) for (const k in look.palette) if (Array.isArray(look.palette[k])) out[k] = look.palette[k];
    return out;
  }

  function lookFor(Ly, look) {
    const S = ST(), base = S && S.lookOf ? S.lookOf(look || {}, Ly) : {
      mat: 'pine', rail: Ly.railDefault || 'both', railStyle: 'square', open: Ly.type === 'deck' || Ly.type === 'ladder', nosing: Ly.type !== 'ladder', boxed: false,
    };
    const L = { ...base, wall: (look && look.wall) || 'both', palette: look && look.palette };
    if (L.mat === 'stone' && !['steps', 'deck', 'straight'].includes(Ly.type)) L.mat = 'pine';
    return L;
  }

  // ---- the emitter: local stair frame [u, v, y] in, building metres out
  function emitter(Ly, y0) {
    const out = { abox: [], obox: [] }, d = +Ly.dir || 0, di = Math.round(d), axis = Math.abs(d - di) < 1e-9;
    const f = axis ? DIRS[((di % 4) + 4) % 4] : [Math.cos((d * Math.PI) / 2), Math.sin((d * Math.PI) / 2)], r = [-f[1], f[0]];
    const X = +Ly.x || 0, Z = +Ly.z || 0, Y = +y0 || 0;
    const P = (u, v, y) => [r4(X + f[0] * u + r[0] * v), r4(y + Y), r4(Z + f[1] * u + r[1] * v)];
    const V = (u, v, y) => [r4(f[0] * u + r[0] * v), r4(y), r4(f[1] * u + r[1] * v)];
    const box = (u0, v0, u1, v1, ya, yb, c) => {
      if (u1 < u0) [u0, u1] = [u1, u0];
      if (v1 < v0) [v0, v1] = [v1, v0];
      if (yb < ya) [ya, yb] = [yb, ya];
      if (u1 - u0 < 1e-4 || v1 - v0 < 1e-4 || yb - ya < 1e-4) return;
      if (axis) {
        const a = P(u0, v0, ya), b = P(u1, v1, yb);
        out.abox.push([Math.min(a[0], b[0]), a[1], Math.min(a[2], b[2]), Math.max(a[0], b[0]), b[1], Math.max(a[2], b[2]), c]);
      } else out.obox.push([P((u0 + u1) / 2, (v0 + v1) / 2, (ya + yb) / 2), V((u1 - u0) / 2, 0, 0), V(0, 0, (yb - ya) / 2), V(0, (v1 - v0) / 2, 0), c]);
    };
    const ob = (c, U, W, Vv, colr) => out.obox.push([P(c[0], c[1], c[2]), V(U[0], U[1], U[2]), V(W[0], W[1], W[2]), V(Vv[0], Vv[1], Vv[2]), colr]);
    return { out, box, ob };
  }
  // a flight's own frame: s along its direction, t to the climber's right, y up
  function frameOf(E, a, d) {
    const p = [-d[1], d[0]];
    const uv = (s, t) => [a[0] + d[0] * s + p[0] * t, a[1] + d[1] * s + p[1] * t];
    const vec = (v) => [d[0] * v[0] + p[0] * v[1], d[1] * v[0] + p[1] * v[1], v[2]];
    return {
      uv, p,
      box(s0, s1, t0, t1, y0, y1, c) { const A = uv(s0, t0), B = uv(s1, t1); E.box(A[0], A[1], B[0], B[1], y0, y1, c); },
      ob(c, U, V, W, colr) { const q = uv(c[0], c[1]); E.ob([q[0], q[1], c[2]], vec(U), vec(V), vec(W), colr); },
    };
  }

  // ---- where the treads are
  function pip(pts, u, v) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if (a[1] > v !== b[1] > v && u < ((b[0] - a[0]) * (v - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) c = !c;
    }
    return c;
  }
  function topAt(Ly, u, v) {
    let best = null;
    const R = Ly.riser, T = Ly.tread, up = (y) => (best = best === null ? y : Math.max(best, y));
    for (const f of Ly.flights || []) {
      const du = u - f.a[0], dv = v - f.a[1], t = du * f.d[0] + dv * f.d[1], lat = -du * f.d[1] + dv * f.d[0];
      if (Math.abs(lat) > f.w / 2 + 0.02 || t < -0.08 || t > f.len + 1e-3) continue;
      up(f.n > 1 ? f.y0 + clamp(Math.floor(t / T) + 1, 1, f.n - 1) * R : f.y1);
    }
    for (const L of Ly.landings || []) if (u >= L.r[0] - 1e-3 && u <= L.r[2] + 1e-3 && v >= L.r[1] - 1e-3 && v <= L.r[3] + 1e-3) up(L.y);
    for (const W of Ly.winders || []) if (pip(W.pts, u, v)) up(W.y);
    return best;
  }

  // ---- the kit a part maker works with
  function kit(Ly, look, opts) {
    const E = emitter(Ly, opts.y0), pal = palette(look), newels = [], parts = { treads: 0, risers: 0, stringers: 0, balusters: 0, newels: 0, posts: 0, rail: 0 };
    const iron = pal.iron, nw = iron ? 0.05 : D.newel, bw = iron ? 0.016 : D.bal, rw = iron ? 0.045 : D.railW, rh = iron ? 0.032 : D.railH;
    const k = {
      Ly, look, pal, D, E, parts, shade, box: E.box, ob: E.ob,
      jit: (i, j) => 0.94 + 0.12 * hash(i * 1.7 + 3, j * 2.3 + 1, (+Ly.x || 0) + (+Ly.z || 0) * 7),
      newel(u, v, yb, yt, o) {
        const n = newels.find((q) => Math.hypot(q.u - u, q.v - v) < 0.05);
        if (n) { n.yb = Math.min(n.yb, yb); n.yt = n.rail ? Math.max(n.yt, yt) : yt; n.rail = true; if (o) Object.assign(n, o); return n; }
        const q = { u, v, yb, yt, rail: true, ...(o || {}) };
        newels.push(q);
        return q;
      },
      post(u, v, yb, yt) {
        const n = newels.find((q) => Math.hypot(q.u - u, q.v - v) < 0.05);
        if (n) { n.yb = Math.min(n.yb, yb); return n; }
        const q = { u, v, yb, yt, rail: false };
        newels.push(q);
        return q;
      },
      // a handrail along segments of [u, v, yTop] with its infill below, newels at the ends and corners
      rail(segs) {
        const style = look.railStyle || 'square';
        for (const sg of segs) {
          const p = sg.p, q = sg.q, du = q[0] - p[0], dv = q[1] - p[1], L = Math.hypot(du, dv);
          if (L < 1e-3) continue;
          const nx = -dv / L, nz = du / L;
          const ob = (o, hw, hh, colr) => E.ob(
            [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2 - o - hh],
            [du / 2, dv / 2, (q[2] - p[2]) / 2], [0, 0, hh], [nx * hw, nz * hw, 0], colr);
          ob(0, rw / 2, rh / 2, pal.rail);
          parts.rail += Math.hypot(L, q[2] - p[2]);
          if (style === 'rails') for (const o of [0.24, 0.46, 0.68]) ob(o, 0.018, 0.026, pal.baluster);
          else if (style === 'square') {
            // balusters: on a flight two to a tread (sg.treads gives their spots), elsewhere about 110 mm apart
            const spots = sg.spots || (() => {
              const m = Math.max(0, Math.round(L / D.balGap) - 1), o = [];
              for (let i = 1; i <= m; i++) o.push(i / (m + 1));
              return o;
            })();
            for (const t of spots) {
              const u = p[0] + du * t, v = p[1] + dv * t;
              if (t * L < nw / 2 + 0.03 || (1 - t) * L < nw / 2 + 0.03) continue;
              const base = sg.base ? sg.base(t) : topAt(Ly, u, v);
              const top = p[2] + (q[2] - p[2]) * t - rh * 0.5;
              if (base === null || top - base < 0.1) continue;
              E.box(u - bw / 2, v - bw / 2, u + bw / 2, v + bw / 2, base, top, pal.baluster);
              parts.balusters++;
            }
          }
          if (sg.pn !== false) k.newel(p[0], p[1], p[2], p[2], sg.nopt);
          if (sg.qn !== false) k.newel(q[0], q[1], q[2], q[2], sg.nopt);
        }
      },
      finish() {
        for (const n of newels) {
          if (n.rail) {
            // the rail tops recorded at a newel: the post rises 0.1 above the highest, with a cap and a small finial
            const plain = iron || n.slim, top = n.yt + (plain ? 0.04 : 0.1), s = n.slim ? 0.05 : nw;
            E.box(n.u - s / 2, n.v - s / 2, n.u + s / 2, n.v + s / 2, n.yb, top, pal.newel);
            if (!plain) {
              E.box(n.u - D.cap / 2, n.v - D.cap / 2, n.u + D.cap / 2, n.v + D.cap / 2, top, top + D.capH, pal.rail);
              E.box(n.u - 0.035, n.v - 0.035, n.u + 0.035, n.v + 0.035, top + D.capH, top + D.capH + 0.03, pal.rail);
            }
            parts.newels++;
          } else {
            E.box(n.u - D.post / 2, n.v - D.post / 2, n.u + D.post / 2, n.v + D.post / 2, n.yb, n.yt, pal.stringer);
            parts.posts++;
          }
        }
      },
    };
    return k;
  }

  // which sides (-1 left, +1 right, as the climber sees them) carry a balustrade, and which a wall rail
  function sides(look) {
    const r = look.rail;
    if (r === 'wall') return { open: [], wall: look.wall === 'left' ? [-1] : look.wall === 'right' ? [1] : [-1, 1] };
    return { open: r === 'both' ? [-1, 1] : r === 'left' ? [-1] : r === 'right' ? [1] : [], wall: [] };
  }

  // ---- one flight of a wooden stair
  // f: the layout's flight; from: 'floor' | 'landing' | 'winder' (what its foot stands on); to: 'floor' | 'landing' | 'winder'
  function flight(k, f, fi, from, to) {
    const { Ly, look, pal, parts } = k;
    const n = f.n, R = Ly.riser, T = Ly.tread, w = f.w, hw = w / 2, len = f.len, y0 = f.y0, y1 = f.y1;
    const tt = D.tread, rt = look.open ? 0 : D.riser, nos = look.nosing ? D.nosing : 0;
    const F = frameOf(k.E, f.a, f.d), yj = (j) => y0 + j * R, h = (j) => yj(j) - tt;
    // treads, nosing over the riser
    for (let j = 1; j < n; j++) {
      F.box((j - 1) * T - rt - nos, j * T, -hw, hw, yj(j) - tt, yj(j), shade(pal.tread, k.jit(fi * 40 + j, 1)));
      parts.treads++;
    }
    // risers: each stands on the tread below and runs up under the next
    if (!look.open) for (let j = 1; j <= n; j++) {
      F.box((j - 1) * T - rt, (j - 1) * T, -hw, hw, j === 1 ? y0 : yj(j - 1), yj(j) - tt, shade(pal.riser, k.jit(fi * 40 + j, 2)));
      parts.risers++;
    }
    // the head: a nosing on the landing or the floor's edge
    if (to !== 'winder' && rt + nos > 1e-4) F.box(len - rt - nos, len, -hw, hw, y1 - tt, y1, pal.tread);
    // stringers: a sloped spine with vertical end cuts and one tooth under each tread. The spine is at least a riser
    // deep (plumb), so each tooth's box stays inside the cut outline.
    if (n >= 2) {
      const cos = T / Math.hypot(T, R), d = Math.max(D.throat / cos, R + 0.03);
      const yb = from === 'floor' ? y0 : y0 - (from === 'landing' ? D.deck : tt) - D.rim;
      const s1 = ((yb + d - h(0)) * T) / R, sf = clamp(Math.max(s1, T), 0, len);
      const inner = (s) => h(0) + (s * R) / T;
      const lines = [-(hw - D.edge), hw - D.edge];
      if (w > 1.25) { const m = Math.ceil((w - 2 * D.edge) / 0.75) - 1; for (let i = 1; i <= m; i++) lines.push(-(hw - D.edge) + (i * (w - 2 * D.edge)) / (m + 1)); }
      for (const tc of lines) {
        const t0 = tc - D.stringer / 2, t1 = tc + D.stringer / 2, c = shade(pal.stringer, k.jit(fi, tc * 10));
        F.box(0, sf, t0, t1, yb, h(1), c);
        for (let j = 2; j < n; j++) F.box((j - 1) * T, j * T, t0, t1, h(j - 1), h(j), c);
        if (s1 < len - 1e-3) {
          const sa = Math.max(s1, 0), sc = (sa + len) / 2, hl = (len - sa) / 2;
          F.ob([sc, tc, inner(sc) - d / 2], [hl, 0, (hl * R) / T], [0, 0, d / 2], [0, D.stringer / 2, 0], c);
        }
        parts.stringers++;
      }
      // boxed in: panels behind the outer stringers down to the stair's floor, the head closed, a door on the right
      if (look.boxed || (Ly.type === 'steps' && !look.open)) {
        for (const sg of [-1, 1]) {
          const ta = sg * (hw - D.edge + D.stringer / 2 - 0.002), tb = ta - sg * D.panel;
          for (let j = 1; j < n; j++) F.box((j - 1) * T, j * T, ta, tb, 0, Math.max(0, h(j - 1)), pal.panel);
        }
        if (to === 'floor' && y1 > 0.6) F.box(len - D.panel, len, -(hw - D.edge), hw - D.edge, 0, h(n - 1), pal.panel);
        const s0 = len - 0.14 - 0.62, top = Math.min(1.95, inner(Math.max(0, s0)) - d - 0.07);
        if (look.boxed && to === 'floor' && from === 'floor' && s0 > 0.2 && top > 1.2) {
          const ta = hw - D.edge + D.stringer / 2 - 0.002;
          F.box(s0, s0 + 0.62, ta - 0.004, ta + 0.008, 0.01, top, pal.door);
          F.box(s0 - 0.05, s0, ta - 0.004, ta + 0.014, 0, top + 0.05, pal.newel);          // casing
          F.box(s0 + 0.62, s0 + 0.67, ta - 0.004, ta + 0.014, 0, top + 0.05, pal.newel);
          F.box(s0 - 0.05, s0 + 0.67, ta - 0.004, ta + 0.014, top, top + 0.05, pal.newel);
          F.box(s0 + 0.06, s0 + 0.1, ta + 0.008, ta + 0.03, 0.95, 0.99, pal.knob);
        }
      }
    }
    // a deck stair's foot stands on a concrete pad
    if (Ly.type === 'deck' && from === 'floor') F.box(-rt - nos - 0.05, Math.min(len, 0.42), -hw - 0.06, hw + 0.06, y0 - 0.12, y0 + 0.02, col(0x9a968e));
    // wall side: a skirt board above the tread ends and a handrail on brackets
    const S = sides(look);
    const nose = (s) => y0 + R + ((s + rt + nos) * R) / T;   // the line through the nosings
    for (const sg of S.wall) {
      if (n < 2) break;
      const sa = -rt - nos, sb = len, lo = Math.min(0.17, R) - 0.005, hi = 0.07, tc = sg * (hw - 0.009);
      F.ob([(sa + sb) / 2, tc, nose((sa + sb) / 2) + (hi - lo) / 2], [(sb - sa) / 2, 0, ((sb - sa) / 2) * (R / T)], [0, 0, (hi + lo) / 2], [0, 0.009, 0], pal.riser);
      const ta = sg * (hw - 0.075), ra = 0.1, rb = len - 0.05, ya = nose(ra) + D.rail, yb2 = nose(rb) + D.rail;
      F.ob([(ra + rb) / 2, ta, (ya + yb2) / 2 - 0.025], [(rb - ra) / 2, 0, (yb2 - ya) / 2], [0, 0, 0.025], [0, 0.025, 0], pal.rail);
      for (const s of [ra, rb]) F.box(s - 0.025, s + 0.025, ta, sg * hw, nose(s) + D.rail - 0.05, nose(s) + D.rail, pal.rail);
      const m = Math.max(1, Math.round((rb - ra) / 1.1));
      for (let i = 1; i < m; i++) { const s = ra + ((rb - ra) * i) / m; F.box(s - 0.012, s + 0.012, ta, sg * hw, nose(s) + D.rail - 0.09, nose(s) + D.rail - 0.05, pal.newel); }
      parts.rail += Math.hypot(rb - ra, yb2 - ya);
    }
    // balustrade ends on each open side: the foot newel just behind the first riser, the head newel just past the last
    const ends = {};
    for (const sg of S.open) {
      const t = sg * (hw - D.edge), sA = from === 'floor' ? D.newel / 2 - rt : -D.edge, sB = len + D.edge;
      const pA = F.uv(sA, t), pB = F.uv(sB, t);
      const spots = [];
      const per = Math.max(1, Math.round(T / D.balGap));
      for (let j = 1; j < n; j++) for (let i = 0; i < per; i++) spots.push((((j - 1) * T + ((i + 0.5) * T) / per) - sA) / (sB - sA));
      ends[sg] = { p: [pA[0], pA[1], nose(sA) + D.rail], q: [pB[0], pB[1], nose(sB) + D.rail] };
      k.rail([{ ...ends[sg], spots, base: (x) => { const s = sA + x * (sB - sA); return n > 1 ? y0 + clamp(Math.floor(s / T) + 1, 1, n - 1) * R : y1; } }]);
      // newel bottoms: the foot one on the floor, a head one hangs below the floor's edge, a landing one is a post
      k.newel(pA[0], pA[1], from === 'floor' ? y0 : 0, ends[sg].p[2]);
      k.newel(pB[0], pB[1], to === 'floor' ? Math.max(0, y1 - 0.3) : 0, ends[sg].q[2]);
    }
    return ends;
  }

  // a landing: decking on a rim, four posts to the stair's floor
  function landing(k, L) {
    const { pal } = k, [u0, v0, u1, v1] = L.r, y = L.y, yd = y - D.deck, yr = yd - D.rim, e = D.rimT;
    k.box(u0, v0, u1, v1, yd, y, pal.deck);
    k.box(u0, v0, u1, v0 + e, yr, yd, pal.stringer);
    k.box(u0, v1 - e, u1, v1, yr, yd, pal.stringer);
    k.box(u0, v0, u0 + e, v1, yr, yd, pal.stringer);
    k.box(u1 - e, v0, u1, v1, yr, yd, pal.stringer);
    const c = [[u0 + D.edge, v0 + D.edge], [u1 - D.edge, v0 + D.edge], [u1 - D.edge, v1 - D.edge], [u0 + D.edge, v1 - D.edge]];
    for (const [u, v] of c) k.post(u, v, 0, yr);
    if (k.look.boxed) {
      // close the two sides no flight comes through: the far edge and the outer side
      const sgn = k.Ly.turn === 'left' ? -1 : 1, outer = sgn > 0 ? v0 : v1, inn = D.panel;
      k.box(u1 - e - inn, v0 + e, u1 - e, v1 - e, 0, yr + 0.05, pal.panel);
      k.box(u0 + e, outer === v0 ? v0 + e : v1 - e - inn, u1 - e, outer === v0 ? v0 + e + inn : v1 - e, 0, yr + 0.05, pal.panel);
      if (k.Ly.type === 'u') k.box(u0 + e, outer === v0 ? v1 - e - inn : v0 + e, u1 - e, outer === v0 ? v1 - e : v0 + e + inn, 0, yr + 0.05, pal.panel);
    }
  }

  // three winders on a framed corner. A board is a parallelogram, so each wedge is cut into triangles whose spare halves
  // lie inside the same wedge, under a higher one, or under the next flight between its stringers: never on show.
  function winders(k) {
    const { Ly, look, pal, parts } = k, C = Ly.corner, P = C.p, s = C.sgn, w = Ly.width;
    const tt = D.tread, rt = look.open ? 0 : D.riser, nos = look.nosing ? D.nosing : 0;
    const W = Ly.winders, [A, B] = [W[0].pts[1], W[0].pts[2]], F = W[1].pts[2], Cc = W[1].pts[3], Ee = W[2].pts[2];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
    // the board is the parallelogram p0, x, y, p0 + y - x; a front edge (p0-x) is pushed out by the nosing
    const board = (p0, x, y, top, front, colr) => {
      const e1 = sub(x, p0), e2 = sub(y, x), L1 = Math.hypot(e1[0], e1[1]), L2 = Math.hypot(e2[0], e2[1]);
      const sin = Math.abs(e1[0] * e2[1] - e1[1] * e2[0]) / (L1 * L2 || 1), ext = front ? (rt + nos) / Math.max(sin, 0.3) : 0, g = (L2 + ext) / L2;
      const c = [p0[0] + e1[0] / 2 + e2[0] / 2 - (ext / 2) * (e2[0] / L2), p0[1] + e1[1] / 2 + e2[1] / 2 - (ext / 2) * (e2[1] / L2)];
      k.ob([c[0], c[1], top - tt / 2], [e1[0] / 2, e1[1] / 2, 0], [0, 0, tt / 2], [(e2[0] * g) / 2, (e2[1] * g) / 2, 0], colr);
      parts.treads++;
    };
    const y = W.map((x) => x.y);
    const N = [(P[0] + Cc[0]) / 2, (P[1] + Cc[1]) / 2], c0 = shade(pal.tread, k.jit(90, 1)), c1 = shade(pal.tread, k.jit(91, 1)), c2 = shade(pal.tread, k.jit(92, 1));
    board(P, A, B, y[0], true, c0);
    board(P, B, F, y[1], true, c1);
    board(P, N, F, y[1], false, c1);
    board(N, F, Cc, y[1], false, c1);
    board(P, N, Ee, y[2], true, c2);
    board(N, Cc, Ee, y[2], true, c2);
    parts.treads -= 3;
    // risers on the two radial lines between them
    if (!look.open) for (const [q, i] of [[B, 1], [Cc, 2]]) {
      const e = sub(q, P), L = Math.hypot(e[0], e[1]), nrm = [-e[1] / L, e[0] / L], ya = y[i - 1], yb = y[i] - tt;
      k.ob([(P[0] + q[0]) / 2, (P[1] + q[1]) / 2, (ya + yb) / 2], [e[0] / 2, e[1] / 2, 0], [0, 0, (yb - ya) / 2], [(nrm[0] * rt) / 2, (nrm[1] * rt) / 2, 0], pal.riser);
      parts.risers++;
    }
    // the frame under them: rims along each edge at the height of the wedge above it, posts at the corners
    const e = D.rimT, u0 = C.r[0], u1 = C.r[2], vo = -s * (w / 2), vi = s * (w / 2), rim = (ua, va, ub, vb, top) => k.box(ua, va, ub, vb, top - tt - D.rim, top - tt, pal.stringer);
    rim(u0, -w / 2, u0 + e, w / 2, y[0]);                      // where the first flight arrives
    rim(u0, vo, B[0], vo + s * e, y[0]);                       // outer side, under the first and second wedges
    rim(B[0], vo, u1, vo + s * e, y[1]);
    rim(u1 - e, vo, u1, Cc[1], y[1]);                          // far side, under the second and third
    rim(u1 - e, Cc[1], u1, vi, y[2]);
    rim(u0, vi - s * e, u1, vi, y[2]);                         // where the second flight leaves
    const ins = (p, du, dv) => [p[0] + du * D.edge, p[1] + dv * D.edge];
    k.post(...ins(A, 1, s), 0, y[0] - tt - D.rim);
    k.post(...ins(F, -1, s), 0, y[1] - tt - D.rim);
    k.post(...ins(Ee, -1, -s), 0, y[2] - tt - D.rim);
    k.post(...ins(P, 1, -s), 0, y[0] - tt - D.rim);
    if (look.boxed) {
      const p = D.panel;
      k.box(u0 + e, vo + s * e, B[0], vo + s * (e + p), 0, y[0] - tt - D.rim + 0.05, pal.panel);
      k.box(B[0], vo + s * e, u1 - e, vo + s * (e + p), 0, y[1] - tt - D.rim + 0.05, pal.panel);
      k.box(u1 - e - p, vo + s * e, u1 - e, Cc[1], 0, y[1] - tt - D.rim + 0.05, pal.panel);
      k.box(u1 - e - p, Cc[1], u1 - e, vi - s * e, 0, y[2] - tt - D.rim + 0.05, pal.panel);
    }
  }

  // balustrade round a landing or the winders on the outer side, between where one flight's rail ends and the next begins
  function guard(k, pts) {
    const segs = [];
    for (let i = 0; i + 1 < pts.length; i++) segs.push({ p: pts[i], q: pts[i + 1] });
    k.rail(segs);
  }

  // ---- the kinds
  function flightsKind(k) {
    const { Ly, look } = k, F = Ly.flights, S = sides(look), turnType = Ly.type === 'l' || Ly.type === 'u' || Ly.type === 'winder';
    if (!F || !F.length) return;
    const mid = Ly.type === 'winder' ? 'winder' : 'landing';
    const e0 = flight(k, F[0], 0, 'floor', F.length > 1 ? mid : 'floor');
    if (!turnType || F.length < 2) return;
    if (Ly.type === 'winder') winders(k);
    else landing(k, Ly.landings[0]);
    const e1 = flight(k, F[1], 1, mid, 'floor');
    const sgn = Ly.turn === 'left' ? -1 : 1, [, v0, u1, v1] = (Ly.landing || Ly.corner).r;
    for (const sd of S.open) {
      const a = e0[sd] && e0[sd].q, b = e1[sd] && e1[sd].p;
      if (!a || !b) continue;
      if (sd === sgn) {
        // inner side: the L and the winder share one newel; a U has two, a short guard across the gap between flights
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.05) guard(k, [a, [b[0], b[1], a[2]]]);
        continue;
      }
      // outer side: round the far corners at the landing's height (rising across the winders)
      const yl = Ly.landing ? Ly.landing.y + D.rail : null;
      const fu = u1 - D.edge, nearV = sgn > 0 ? v0 + D.edge : v1 - D.edge, farV = sgn > 0 ? v1 - D.edge : v0 + D.edge;
      if (Ly.type === 'winder') guard(k, [a, [fu, a[1], (a[2] + b[2]) / 2], b]);
      else if (Ly.type === 'l') guard(k, [[a[0], a[1], yl], [fu, nearV, yl], [b[0], b[1], yl]]);
      else guard(k, [[a[0], a[1], yl], [fu, nearV, yl], [fu, farV, yl], [b[0], b[1], yl]]);
    }
  }

  // stone steps: stacked blocks, each course split into stones, an iron rail if any
  function stoneKind(k) {
    const { Ly, look, pal, parts } = k, f = Ly.flights[0];
    if (!f) return;
    const n = f.n, R = Ly.riser, T = Ly.tread, hw = f.w / 2, len = f.len, nos = look.nosing ? 0.02 : 0;
    const F = frameOf(k.E, f.a, f.d);
    for (let j = 1; j < n; j++) {
      const m = Math.max(1, Math.ceil(f.w / 0.95)), off = j % 2 ? 0 : 0.5;
      const cuts = [-hw];
      for (let i = 1; i < m + (off ? 1 : 0); i++) { const t = -hw + ((i - off) * f.w) / m; if (t > -hw + 0.15 && t < hw - 0.15) cuts.push(t); }
      cuts.push(hw);
      for (let i = 0; i + 1 < cuts.length; i++) {
        const g = i ? 0.004 : 0, g2 = i + 2 < cuts.length ? 0.004 : 0;
        F.box((j - 1) * T - nos, len, cuts[i] + g, cuts[i + 1] - g2, f.y0 + (j - 1) * R, f.y0 + j * R, shade(pal.tread, k.jit(j, i) * (i % 2 ? 0.97 : 1.02)));
      }
      parts.treads++;
    }
    if (n === 1 || nos) F.box(len - nos - 0.02, len, -hw, hw, f.y1 - 0.05, f.y1, pal.tread);
    const S = sides(look), nose = (s) => f.y0 + R + ((s + nos) * R) / T;
    for (const sd of S.open) {
      const t = sd * (hw - 0.06), sA = 0.06, sB = len + 0.05;
      const pA = F.uv(sA, t), pB = F.uv(sB, t);
      k.rail([{ p: [pA[0], pA[1], nose(sA) + D.rail], q: [pB[0], pB[1], nose(sB) + D.rail], spots: [], base: () => null }]);
      k.newel(pA[0], pA[1], f.y0 + R, nose(sA) + D.rail);
      k.newel(pB[0], pB[1], f.y1, nose(sB) + D.rail);
      // iron pickets, three to a step
      for (let j = 1; j < n; j++) for (const x of [0.2, 0.5, 0.8]) {
        const s = (j - 1) * T + x * T, q = F.uv(s, t);
        if (s < sA + 0.05 || s > sB - 0.05) continue;
        k.box(q[0] - 0.008, q[1] - 0.008, q[0] + 0.008, q[1] + 0.008, f.y0 + j * R, nose(s) + D.rail - 0.02, pal.baluster);
        parts.balusters++;
      }
    }
  }

  // ship's ladder: two plain stringers with level ends, housed treads, a handrail on posts each side going onto the floor
  function ladderKind(k) {
    const { Ly, look, pal, parts } = k, f = Ly.flights[0];
    if (!f) return;
    const n = f.n, R = Ly.riser, T = Ly.tread, hw = f.w / 2, len = f.len, y0 = f.y0, y1 = f.y1, tt = D.tread, sw = D.stringer;
    const nos = look.nosing ? D.nosing : 0, dp = clamp(T + 0.05, 0.13, 0.2), F = frameOf(k.E, f.a, f.d);
    for (let j = 1; j < n; j++) {
      F.box((j - 1) * T - nos, (j - 1) * T - nos + dp, -hw + sw - 0.01, hw - sw + 0.01, y0 + j * R - tt, y0 + j * R, shade(pal.tread, k.jit(j, 1)));
      parts.treads++;
    }
    if (!look.open) for (let j = 1; j <= n; j++) {
      F.box((j - 1) * T + dp - nos - D.riser, (j - 1) * T + dp - nos, -hw + sw, hw - sw, y0 + (j - 1) * R, y0 + j * R - tt, pal.riser);
      parts.risers++;
    }
    const th = Math.atan2(R, T), sc1 = -nos + dp / 2, yc1 = y0 + R - tt / 2;
    const sAt = (y) => sc1 + ((y - yc1) * T) / R, yAt = (s) => yc1 + ((s - sc1) * R) / T;
    const hv = 0.1 / Math.sin(th), sb = sAt(y0), st = sAt(y1);
    for (const sd of [-1, 1]) {
      F.ob([(sb + st) / 2, sd * (hw - sw / 2), (y0 + y1) / 2], [(st - sb) / 2, 0, (y1 - y0) / 2], [hv, 0, 0], [0, sw / 2, 0], pal.stringer);
      parts.stringers++;
    }
    const open = look.rail === 'wall' ? [] : sides(look).open, slim = { slim: true };
    for (const sd of open) {
      const t = sd * (hw + 0.03), yr = (s) => yAt(s) + 0.86;
      const sA = sAt(y0 + 0.45), sE = sAt(y1 + 0.02), sF = Math.max(sE + 0.35, len + 0.4);
      const pA = F.uv(sA, t), pE = F.uv(sE, t), pF = F.uv(sF, t), yE = yr(sE);
      k.rail([{ p: [pA[0], pA[1], yr(sA)], q: [pE[0], pE[1], yE], spots: [], qn: false, nopt: slim }, { p: [pE[0], pE[1], yE], q: [pF[0], pF[1], yE], spots: [], pn: false, nopt: slim }]);
      k.newel(pA[0], pA[1], y0, yr(sA), slim);
      k.newel(pF[0], pF[1], y1, yE, slim);
      // a bracket ties the rail to the stringer partway up
      const sm = (sA + sE) / 2, pm = F.uv(sm, sd * (hw + 0.02));
      k.box(pm[0] - 0.015, pm[1] - 0.015, pm[0] + 0.015, pm[1] + 0.015, yAt(sm) + (hv * R) / T - 0.02, yr(sm) - 0.03, pal.newel);
    }
  }

  const kinds = { steps: flightsKind, straight: flightsKind, l: flightsKind, u: flightsKind, winder: flightsKind, deck: flightsKind, ladder: ladderKind, spiral: null };
  const drawKinds = { spiral: null };

  function build(Ly, look, opts = {}) {
    const L = lookFor(Ly, look), k = kit(Ly, L, opts);
    if (Ly && Ly.flights) {
      const fn = L.mat === 'stone' && Ly.flights.length === 1 && Ly.type !== 'ladder' ? stoneKind : kinds[Ly.type];
      if (typeof fn === 'function') fn(k);
    }
    k.finish();
    const { abox, obox } = k.E.out;
    return { abox, obox, count: abox.length + obox.length, parts: { ...k.parts, rail: Math.round(k.parts.rail * 100) / 100 } };
  }

  function emit(g, Ly, look, opts) {
    const o = build(Ly, look, opts);
    for (const b of o.abox) g.abox(b[0], b[1], b[2], b[3], b[4], b[5], b[6]);
    for (const b of o.obox) g.obox(b[0], b[1], b[2], b[3], b[4]);
    return o.count;
  }

  // ---- drawings
  const f1 = (v) => Math.round(v * 10) / 10;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const m2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
  const TYPICAL = { steps: { rise: 0.5 }, deck: { rise: 0.9 }, spiral: { rise: 2.84, clear: 1.8 }, ladder: { rise: 2.84 } };
  function layoutFor(x) {
    if (x && typeof x === 'object') return x;
    const S = ST();
    if (!S || !S.solve) return null;
    const t = S.TYPE_BY_ID && S.TYPE_BY_ID[x] ? x : 'straight';
    return S.solve({ type: t === 'auto' ? 'straight' : t, rise: 2.84, ...(TYPICAL[t] || {}) });
  }
  // the treads in walking order, unrolled: [{ x0, x1, y, kind }] and the walk's length
  function developed(Ly) {
    const segs = [], R = Ly.riser, T = Ly.tread;
    let x = 0;
    if (Ly.spiral) {
      const sp = Ly.spiral, step = sp.rw * Math.abs(sp.step);
      for (let j = 1; j <= sp.treads; j++) segs.push({ x0: x, x1: (x += step), y: j * R, kind: 't' });
      return { segs, X: x };
    }
    (Ly.flights || []).forEach((f, i) => {
      for (let j = 1; j < f.n; j++) segs.push({ x0: x, x1: (x += T), y: f.y0 + j * R, kind: 't', fi: i });
      if (i < Ly.flights.length - 1) {
        if (Ly.winders && Ly.winders.length) {
          const ww = ((Ly.width / 2) * Math.PI) / 2 / 3;
          for (const W of Ly.winders) segs.push({ x0: x, x1: (x += ww), y: W.y, kind: 'w' });
        } else {
          const L = Ly.landings[i], ww = Ly.type === 'u' ? 2 * Ly.width + 0.1 : Ly.width;
          segs.push({ x0: x, x1: (x += ww), y: L.y, kind: 'l' });
        }
      }
    });
    return { segs, X: x };
  }

  function side(Ly, size, opts) {
    const thumb = size === 'thumb', W = opts.width || (thumb ? 56 : 360), H = opts.height || (thumb ? 56 : 220);
    const { segs, X } = developed(Ly), rise = Ly.rise, rail = opts.rail ?? (Ly.railDefault !== 'none' || Ly.type === 'ladder');
    const ml = thumb ? 5 : 26, mr = thumb ? 5 : 64, mt = thumb ? 6 : 34, mb = thumb ? 5 : 40;
    const x0 = thumb ? -0.15 : -0.45, x1 = X + (thumb ? 0.15 : 0.45), ytop = rise + (rail ? D.rail + 0.05 : 0.05);
    const k = Math.min((W - ml - mr) / (x1 - x0), (H - mt - mb) / ytop);
    const ox = ml + (W - ml - mr - (x1 - x0) * k) / 2 - x0 * k, oy = H - mb - (H - mt - mb - ytop * k) * (thumb ? 0.5 : 0);
    const X_ = (x) => f1(ox + x * k), Y_ = (y) => f1(oy - y * k);
    let d = 'M' + X_(x0) + ' ' + Y_(0) + 'H' + X_(0);
    for (const s of segs) d += 'V' + Y_(s.y) + 'H' + X_(s.x1);
    d += 'V' + Y_(rise) + 'H' + X_(x1);
    // the underside: a stringer line under each run of treads, flat under landings
    let u = 'M' + X_(x1 - (thumb ? 0.15 : 0.45)) + ' ' + Y_(rise - 0.12);
    const runs = [];
    for (const s of segs) { const last = runs[runs.length - 1]; if (last && last.kind === s.kind && s.kind !== 'l') last.s.push(s); else runs.push({ kind: s.kind, s: [s] }); }
    const thick = Math.max(0.18, Ly.riser + 0.04);
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i], a = r.s[0], b = r.s[r.s.length - 1];
      if (r.kind === 'l') u += 'L' + X_(b.x1) + ' ' + Y_(a.y - 0.25) + 'L' + X_(a.x0) + ' ' + Y_(a.y - 0.25);
      else u += 'L' + X_(b.x1) + ' ' + Y_(b.y - thick) + 'L' + X_(a.x0) + ' ' + Y_(Math.max(0, a.y - Ly.riser - thick));
    }
    u += 'L' + X_(Math.min(X, 0.35)) + ' ' + Y_(0);
    const ink = thumb ? 'currentColor' : 'var(--cad-ink)', line = thumb ? 'currentColor' : 'var(--cad)';
    const out = [];
    if (!thumb) out.push('<rect width="' + W + '" height="' + H + '" fill="var(--cad-bg)"/>');
    out.push('<path d="' + d + (thumb || rise < 0.9 ? '' : 'L' + X_(x1) + ' ' + Y_(rise - 0.12)) + '" fill="none" stroke="' + ink + '" stroke-width="' + (thumb ? 1.6 : 1.4) + '" stroke-linejoin="round"/>');
    if (segs.length && rise >= 0.9) out.push('<path d="' + u + '" fill="none" stroke="' + line + '" stroke-width="' + (thumb ? 1 : 0.9) + '" stroke-opacity="' + (thumb ? 0.55 : 0.7) + '" stroke-linejoin="round"/>');
    if (rail && segs.length) {
      let r = '';
      segs.forEach((s, i) => { const y = s.kind === 'l' ? s.y : s.y; r += (i ? 'L' : 'M') + X_(s.x0) + ' ' + Y_(y + D.rail) + (s.kind === 'l' ? 'L' + X_(s.x1) + ' ' + Y_(y + D.rail) : ''); });
      r += 'L' + X_(X) + ' ' + Y_(rise + D.rail);
      out.push('<path d="' + r + '" fill="none" stroke="' + line + '" stroke-width="' + (thumb ? 1.2 : 1.1) + '"' + (thumb ? '' : ' stroke-dasharray="4 2"') + '/>');
      out.push('<path d="M' + X_(segs[0].x0) + ' ' + Y_(0) + 'V' + Y_(segs[0].y + D.rail) + 'M' + X_(X) + ' ' + Y_(rise) + 'V' + Y_(rise + D.rail) + '" stroke="' + line + '" stroke-width="' + (thumb ? 1.2 : 1.1) + '"/>');
    }
    if (!thumb) {
      // dimensions: the rise at the right, the walk below, riser and tread on top
      const xr = W - mr + 18, ty = H - mb + 18;
      out.push('<path d="M' + xr + ' ' + Y_(0) + 'V' + Y_(rise) + 'M' + (xr - 4) + ' ' + Y_(0) + 'h8M' + (xr - 4) + ' ' + Y_(rise) + 'h8" stroke="var(--cad)" stroke-width=".8"/>');
      out.push('<text x="' + (xr + 6) + '" y="' + f1((Y_(0) + Y_(rise)) / 2 + 4) + '" font-size="11" fill="var(--cad-ink)">' + m2(rise) + ' m</text>');
      out.push('<path d="M' + X_(0) + ' ' + ty + 'H' + X_(X) + 'M' + X_(0) + ' ' + (ty - 4) + 'v8M' + X_(X) + ' ' + (ty - 4) + 'v8" stroke="var(--cad)" stroke-width=".8"/>');
      out.push('<text x="' + f1((X_(0) + X_(X)) / 2) + '" y="' + (ty + 14) + '" font-size="11" text-anchor="middle" fill="var(--cad-ink)">' + m2(X) + ' m walk' + (Ly.length && Ly.flights && Ly.flights.length > 1 ? ' · ' + m2(Ly.length) + ' m long' : '') + '</text>');
      const lab = Ly.n + ' × ' + Math.round(Ly.riser * 1000) + ' mm · tread ' + Math.round(Ly.tread * 1000) + ' mm · ' + Math.round(Ly.angle || 0) + '°';
      out.push('<text x="' + ml + '" y="20" font-size="12" fill="var(--cad-ink)">' + esc(lab) + '</text>');
      if (Ly.headroom !== undefined && Ly.headroom !== null && Number.isFinite(Ly.headroom)) out.push('<text x="' + (W - 8) + '" y="20" font-size="11" text-anchor="end" fill="var(--cad)">headroom ' + m2(Ly.headroom) + ' m</text>');
    }
    return wrap(W, H, out, opts.label || stairName(Ly) + (thumb ? '' : ': side view'), thumb ? 'st-thumb' : 'st-side');
  }

  function plan(Ly, size, opts) {
    const thumb = size === 'thumb', W = opts.width || (thumb ? 56 : 240), H = opts.height || (thumb ? 56 : 160);
    const b = Ly.box || [0, -0.5, 1, 0.5], pad = thumb ? 5 : 14;
    const k = Math.min((W - 2 * pad) / (b[2] - b[0] || 1), (H - 2 * pad) / (b[3] - b[1] || 1));
    const ox = (W - (b[2] - b[0]) * k) / 2 - b[0] * k, oy = (H - (b[3] - b[1]) * k) / 2 - b[1] * k;
    const P = (u, v) => f1(ox + u * k) + ' ' + f1(oy + v * k);
    const ink = thumb ? 'currentColor' : 'var(--cad-ink)', line = thumb ? 'currentColor' : 'var(--cad)', sw = thumb ? 1.3 : 1.2;
    const out = [];
    if (!thumb) out.push('<rect width="' + W + '" height="' + H + '" fill="var(--cad-bg)"/>');
    let t = '';
    for (const f of Ly.flights || []) {
      const p = [-f.d[1], f.d[0]], hw = f.w / 2, at = (s, q) => P(f.a[0] + f.d[0] * s + p[0] * q, f.a[1] + f.d[1] * s + p[1] * q);
      out.push('<path d="M' + at(0, -hw) + 'L' + at(f.len, -hw) + 'L' + at(f.len, hw) + 'L' + at(0, hw) + 'Z" fill="none" stroke="' + ink + '" stroke-width="' + sw + '"/>');
      for (let j = 1; j < f.n - 1; j++) t += 'M' + at(j * Ly.tread, -hw) + 'L' + at(j * Ly.tread, hw);
    }
    for (const L of Ly.landings || []) out.push('<path d="M' + P(L.r[0], L.r[1]) + 'H' + f1(ox + L.r[2] * k) + 'V' + f1(oy + L.r[3] * k) + 'H' + f1(ox + L.r[0] * k) + 'Z" fill="none" stroke="' + ink + '" stroke-width="' + sw + '"/>');
    for (const Wd of Ly.winders || []) out.push('<path d="M' + Wd.pts.map((q) => P(q[0], q[1])).join('L') + 'Z" fill="none" stroke="' + ink + '" stroke-width="' + sw + '" stroke-linejoin="round"/>');
    if (Ly.spiral) {
      const sp = Ly.spiral, c = sp.c;
      out.push('<circle cx="' + f1(ox + c[0] * k) + '" cy="' + f1(oy + c[1] * k) + '" r="' + f1(sp.r * k) + '" fill="none" stroke="' + ink + '" stroke-width="' + sw + '"/>');
      out.push('<circle cx="' + f1(ox + c[0] * k) + '" cy="' + f1(oy + c[1] * k) + '" r="' + f1(Math.max(1.5, (sp.post / 2) * k)) + '" fill="' + ink + '"/>');
      for (let j = 0; j <= Math.min(sp.treads, 12); j++) { const a = sp.a0 + j * sp.step; t += 'M' + P(c[0] + Math.cos(a) * sp.post / 2, c[1] + Math.sin(a) * sp.post / 2) + 'L' + P(c[0] + Math.cos(a) * sp.r, c[1] + Math.sin(a) * sp.r); }
    }
    if (t) out.push('<path d="' + t + '" stroke="' + line + '" stroke-width="' + (thumb ? 0.9 : 0.8) + '" stroke-opacity=".8"/>');
    // the walking line, with an arrow up
    let w = '', last = null, dir = null;
    for (const g of Ly.path || []) {
      if (g.c) {
        const n = 10;
        for (let i = 0; i <= n; i++) { const a = g.a0 + ((g.a1 - g.a0) * i) / n, q = [g.c[0] + g.r * Math.cos(a), g.c[1] + g.r * Math.sin(a)]; w += (w ? 'L' : 'M') + P(q[0], q[1]); if (last) dir = [q[0] - last[0], q[1] - last[1]]; last = q; }
      } else { w += (w ? 'L' : 'M') + P(g.a[0], g.a[1]) + 'L' + P(g.b[0], g.b[1]); dir = [g.b[0] - g.a[0], g.b[1] - g.a[1]]; last = g.b; }
    }
    if (w && last && dir) {
      const L = Math.hypot(dir[0], dir[1]) || 1, d = [dir[0] / L, dir[1] / L], a = (thumb ? 5 : 7) / k, hx = [last[0] - d[0] * a, last[1] - d[1] * a];
      out.push('<path d="' + w + '" fill="none" stroke="' + line + '" stroke-width="' + (thumb ? 1 : 1) + '"/>');
      out.push('<path d="M' + P(hx[0] - d[1] * a * 0.55, hx[1] + d[0] * a * 0.55) + 'L' + P(last[0], last[1]) + 'L' + P(hx[0] + d[1] * a * 0.55, hx[1] - d[0] * a * 0.55) + '" fill="none" stroke="' + line + '" stroke-width="' + (thumb ? 1 : 1) + '"/>');
    }
    return wrap(W, H, out, opts.label || stairName(Ly) + (thumb ? '' : ': plan'), thumb ? 'st-thumb' : 'st-plan');
  }

  function stairName(Ly) {
    const S = ST(), t = S && S.TYPE_BY_ID && S.TYPE_BY_ID[Ly.type];
    return (t ? t.name : 'Stair') + (Ly.label ? ' ' + Ly.label : '');
  }
  function wrap(W, H, out, label, cls) {
    return '<svg class="' + cls + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(label) + '" font-family="var(--cad-font, system-ui, sans-serif)">' + out.join('') + '</svg>';
  }

  function draw(x, size = 'stage', opts = {}) {
    const Ly = layoutFor(x);
    if (!Ly) return '';
    if (drawKinds[Ly.type]) { const s = drawKinds[Ly.type](Ly, size, opts); if (s) return s; }
    if (size === 'plan') return plan(Ly, size, opts);
    if (size === 'thumb' && (Ly.type === 'l' || Ly.type === 'u' || Ly.type === 'winder' || Ly.type === 'spiral')) return plan(Ly, 'thumb', opts);
    return side(Ly, size === 'thumb' ? 'thumb' : 'stage', opts);
  }

  G.__stairsGeo = { build, emit, draw, topAt, kinds, drawKinds, palette, dims: D, version: 1 };
})();
