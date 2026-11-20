/* Doors and windows drawn as clean architectural elevations, to scale, as SVG strings (window.__openingPreview).
   String building only: no DOM, no three.js, so it runs under node too (globalThis.__openingPreview). The catalogue
   comes from window.__openings (src/sim/content/openings.js) when it is there; a spec that carries its own type,
   size and look draws without it.

   Lines are var(--cad) and var(--cad-ink) on var(--cad-bg) at stage size (the --cad instrument look, the same in both
   skins); thumbs draw in currentColor so they take the card's ink. The only literal colour is the unit's own finish,
   a faint tint under the stage drawing (it is the player's data, like a swatch).

   INTERFACE
     draw(spec, opts?) -> '<svg ...>'
       spec: a type id ('gothic'), a free opening record ({ typeId, w, h, sill, look, finish, flip, out }), or a
             freeSpec result / anything like it ({ type: id | type, w, h, sill, look, leaf, finish }). A designed door's
             w and h are the whole unit with sidelights and transom when spec.leaf is given, else the leaf's size.
       opts.size    'stage' (default, 360 x 220) | 'thumb' (56 x 56: the unit only, no wall, dimensions or handles)
       opts.width, opts.height   the drawing's size in px
       opts.wall    { L, H, others }: the wall run's length and height in metres (default 4 x 2.84) and its other
                    openings as rough extents [{ a, b, sill, head }] along the run (as snapFree and fitReport take them)
       opts.at      the unit's centre along the run, metres (default: the middle of the wall)
       opts.hand    { flip, out } (default spec.flip / spec.out): flip mirrors the swing or slide, out opens outward
       opts.anchor  'sill' | 'head' | 'centre': which height the dimension beside the unit gives (windows)
       opts.handles true: edge grips and hit areas <rect data-h="l|r|t|b|move"> (b for windows only)
       opts.label   the svg's aria-label (default: the type's name and size)
       The stage svg carries data-k (px per metre), data-ox (px of the run's left end) and data-oy (px of the floor),
       all in viewBox units, so a drag in the stage can be turned back into metres.
     plan(spec, hand?, opts?) -> '<svg ...>' a door's plan view (wall, leaf, swing arc; slide, barn and pocket show their
       travel), '' for a window. Every possible hand is drawn faint and the current one solid; each is a button area
       <rect class="op-q" data-flip="0|1" data-out="0|1" aria-pressed>. opts.width / opts.height (default 360 x 120).
     hands(spec) -> [{ flip, out, label }] the same choices as a list for a row of buttons (flip or out null: unchanged)
     metrics(spec, opts?) -> { k, ox, oy, x0, x1, y0, y1, view: [m0, m1] } the stage layout without drawing it
*/
(() => {
  const G = globalThis;
  if (G.__openingPreview) return;
  const OPS = () => G.__openings || null;
  const TOP_PLATE = 0.19, ROUGH = 0.012, FLOOR_GAP = 0.02, SIDE_W = 0.36, TRANSOM_H = 0.36;
  const DESIGN_OPS = new Set(["swing", "dutch", "pivot"]);
  const FACE_ROWS = { shaker: [[1, 1]], p2: [[0.58, 1], [0.42, 1]], p3: [[1, 3]], p5: [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1]], p6: [[0.2, 2], [0.42, 2], [0.38, 2]] };
  const f = (v) => Math.round(v * 10) / 10;
  const m2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let uid = 0;
  const hex6 = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6);

  /* ---------- the spec: type, size, look, finish, whatever form it comes in ---------- */
  function finishCss(k) {
    if (k === undefined || k === null || k === "") return null;
    if (typeof k === "number") return hex6(k);
    if (/^#[0-9a-f]{3,8}$/i.test(k)) return k;
    const O = OPS(), F = O && O.FINISHES && O.FINISHES[k];
    return F ? hex6(F.hex) : null;
  }
  function typeOf(t) {
    if (!t) return null;
    if (typeof t === "object") return t;
    const O = OPS(), found = O && O.openingType ? O.openingType(t) : null;
    if (found) return found;
    const door = /^door/.test(t);
    return { id: t, name: t, kind: door ? "door" : "window", op: door ? "swing" : "fixed", w: [door ? 0.81 : 0.9], h: [door ? 2.03 : 1.2], sill: door ? 0 : 0.9, look: { panels: 1, grid: [1, 1] }, frame: "wall" };
  }
  const designable = (t) => {
    const O = OPS();
    if (O && O.designable) return O.designable(t);
    return !!t && t.kind === "door" && DESIGN_OPS.has(t.op) && (t.frame || "wall") === "wall" && !t.surface;
  };
  const mid = (a) => a[Math.floor((a.length - 1) / 2)];
  function lookFor(t, own) {
    const O = OPS();
    if (O && O.lookOf) return O.lookOf(t, { look: own || {} });
    const L = { panels: 1, grid: [1, 1], ...(t.look || {}), ...(own || {}) };
    if (t.kind === "window") {
      L.shape = L.shape || (L.arch ? "arch" : "rect");
      L.lites = L.lites || [1, 1];
      if (!L.grille) L.grille = L.grid[0] > 1 || L.grid[1] > 1 ? "colonial" : "none";
    } else if (designable(t)) return { face: "flush", glass: "none", bars: false, side: "none", transom: false, hw: "knob", metal: "brass", ...L };
    return L;
  }
  // a designed door's unit round its leaf: sidelights beside it and a transom over it (as freeSpec does)
  function withLeaf(t, w, h, K) {
    const sl = K.side === "left" || K.side === "both" ? SIDE_W : 0,
      sr = K.side === "right" || K.side === "both" ? SIDE_W : 0;
    return { w: w + sl + sr, h: h + (K.transom ? TRANSOM_H : 0), leaf: { a: sl, b: sl + w, h } };
  }
  function norm(spec) {
    const O = OPS();
    if (typeof spec === "string") spec = { type: spec };
    spec = spec || {};
    if (spec.typeId && !spec.type) {
      if (O && O.freeSpec) {
        const fs = O.freeSpec(spec);
        if (fs) spec = { ...fs, flip: spec.flip, out: spec.out };
      } else spec = { ...spec, type: spec.typeId };
    }
    const t = typeOf(spec.type) || typeOf("picture");
    const door = t.kind === "door";
    let w = spec.w > 0 ? spec.w : mid(t.w || [0.9]),
      h = spec.h > 0 ? spec.h : mid(t.h || [1.2]),
      leaf = spec.leaf || null;
    const sill = door ? 0 : Number.isFinite(spec.sill) ? spec.sill : t.sill || 0;
    const look = lookFor(t, spec.look);
    if (designable(t) && !leaf) ({ w, h, leaf } = withLeaf(t, w, h, look));
    return { t, id: t.id, name: t.name || t.id, kind: door ? "door" : "window", op: t.op, w, h, sill, look, leaf, fin: finishCss(spec.finish || t.finish), flip: !!spec.flip, out: !!spec.out };
  }

  /* ---------- styles: stage (--cad on --cad-bg) or thumb (currentColor on the card) ---------- */
  function styles(thumb, fin) {
    const ink = thumb ? "currentColor" : "var(--cad-ink)",
      ln = thumb ? "currentColor" : "var(--cad)",
      sw = thumb ? 0.9 : 1;
    const solidFill = thumb ? 'fill="currentColor" fill-opacity=".16"' : fin ? 'fill="' + fin + '" fill-opacity=".42"' : 'fill="var(--cad)" fill-opacity=".1"';
    return {
      ink,
      ln,
      solid: solidFill + ' stroke="' + ink + '" stroke-width="' + sw + '" stroke-linejoin="round"',
      // a recess: the face's own colour a shade darker, edged in a finer line
      panel: (thumb ? 'fill="currentColor" fill-opacity=".14"' : 'fill="var(--cad-bg)" fill-opacity=".34"') + ' stroke="' + ink + '" stroke-width="' + (thumb ? 0.6 : 0.7) + '" stroke-opacity=".85"',
      glass: (thumb ? 'fill="currentColor" fill-opacity=".05"' : 'fill="var(--cad)" fill-opacity=".2"') + ' stroke="' + ink + '" stroke-width="' + (thumb ? 0.6 : 0.7) + '"',
      fine: 'fill="none" stroke="' + ink + '" stroke-width="' + (thumb ? 0.5 : 0.6) + '" stroke-opacity=".8"',
      bar: 'fill="none" stroke="' + ink + '" stroke-width="' + (thumb ? 0.6 : 0.9) + '" stroke-linecap="square"',
      shine: 'fill="none" stroke="' + ln + '" stroke-width="' + (thumb ? 0.5 : 0.7) + '" stroke-opacity="' + (thumb ? 0.45 : 0.55) + '" stroke-linecap="round"',
      opTo: 'fill="none" stroke="' + ln + '" stroke-width="' + (thumb ? 0.5 : 0.7) + '" stroke-opacity="' + (thumb ? 0.55 : 0.7) + '" stroke-linejoin="round"',
      opAway: 'fill="none" stroke="' + ln + '" stroke-width="' + (thumb ? 0.5 : 0.7) + '" stroke-opacity="' + (thumb ? 0.55 : 0.7) + '" stroke-dasharray="' + (thumb ? "2 1.5" : "4 3") + '" stroke-linejoin="round"',
      arrow: 'fill="none" stroke="' + ln + '" stroke-width="' + (thumb ? 0.7 : 0.9) + '" stroke-opacity=".85" stroke-linecap="round" stroke-linejoin="round"',
      hw: 'fill="' + ink + '" stroke="none"',
      hidden: 'fill="none" stroke="' + ln + '" stroke-width="' + (thumb ? 0.5 : 0.7) + '" stroke-opacity=".5" stroke-dasharray="' + (thumb ? "2 1.5" : "4 3") + '"',
      axis: 'fill="none" stroke="' + ln + '" stroke-width=".6" stroke-opacity=".6" stroke-dasharray="8 2 1.5 2"',
    };
  }

  /* ---------- a pen in a unit's own frame: u along the wall from its left edge, v up from its bottom, metres ---------- */
  function pen(k, X0, Y0, w, flip, S, thumb) {
    const x = (u) => X0 + (flip ? w - u : u) * k,
      y = (v) => Y0 - v * k,
      o = [];
    const D = { k, o, S, w, flip, thumb, x, y, X0, Y0 };
    D.R = (u0, v0, u1, v1, a) => {
      const xa = Math.min(x(u0), x(u1)), xb = Math.max(x(u0), x(u1)), ya = Math.min(y(v0), y(v1)), yb = Math.max(y(v0), y(v1));
      if (xb - xa < 0.15 || yb - ya < 0.15) return;
      o.push('<rect x="' + f(xa) + '" y="' + f(ya) + '" width="' + f(xb - xa) + '" height="' + f(yb - ya) + '" ' + a + "/>");
    };
    // a solid with glass-sized holes in it, so the glass shows the background and not the face behind it
    D.holed = (u0, v0, u1, v1, holes, a) => {
      const sp = (p, q, r, t) => { const xa = Math.min(x(p), x(r)), xb = Math.max(x(p), x(r)), ya = Math.min(y(q), y(t)), yb = Math.max(y(q), y(t)); return "M" + f(xa) + " " + f(ya) + "H" + f(xb) + "V" + f(yb) + "H" + f(xa) + "Z"; };
      o.push('<path d="' + sp(u0, v0, u1, v1) + holes.map((h) => sp(h[0], h[1], h[2], h[3])).join("") + '" fill-rule="evenodd" ' + a + "/>");
    };
    D.L = (u0, v0, u1, v1, a) => o.push('<path d="M' + f(x(u0)) + " " + f(y(v0)) + "L" + f(x(u1)) + " " + f(y(v1)) + '" ' + a + "/>");
    D.P = (pts, close, a) => o.push('<path d="M' + pts.map((p) => f(x(p[0])) + " " + f(y(p[1]))).join("L") + (close ? "Z" : "") + '" ' + a + "/>");
    D.C = (u, v, r, a) => o.push('<circle cx="' + f(x(u)) + '" cy="' + f(y(v)) + '" r="' + f(Math.max(thumb ? 0.5 : 1, r * k)) + '" ' + a + "/>");
    // an arrow from (u0, v0) to (u1, v1), its head a few px long
    D.A = (u0, v0, u1, v1) => {
      const ax = x(u0), ay = y(v0), bx = x(u1), by = y(v1), d = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / d, uy = (by - ay) / d, hs = clamp(d * 0.3, thumb ? 2 : 3, thumb ? 3 : 5.5);
      o.push('<path d="M' + f(ax) + " " + f(ay) + "L" + f(bx) + " " + f(by) + "M" + f(bx - ux * hs - uy * hs * 0.6) + " " + f(by - uy * hs + ux * hs * 0.6) + "L" + f(bx) + " " + f(by) + "L" + f(bx - ux * hs + uy * hs * 0.6) + " " + f(by - uy * hs - ux * hs * 0.6) + '" ' + S.arrow + "/>");
    };
    // the which-way-it-opens sign: lines from the free corners meet on the hinge side. Solid when it opens toward the
    // viewer (outside), dashed when away.
    D.swing = (a, b, p, q, hinge, toward) => {
      const st = toward ? S.opTo : S.opAway, m = (a + b) / 2, n = (p + q) / 2;
      if (hinge === "l") D.P([[b, q], [a, n], [b, p]], false, st);
      else if (hinge === "r") D.P([[a, q], [b, n], [a, p]], false, st);
      else if (hinge === "t") D.P([[a, p], [m, q], [b, p]], false, st);
      else D.P([[a, q], [m, p], [b, q]], false, st);
    };
    // two short strokes across a pane: the drafter's sign for glass
    D.shine = (a, b, p, q) => {
      const W = Math.abs(x(b) - x(a)), H = Math.abs(y(q) - y(p));
      if (W < (thumb ? 7 : 14) || H < (thumb ? 7 : 14)) return;
      const xa = Math.min(x(a), x(b)), yb = Math.min(y(p), y(q)), s = Math.min(W, H);
      for (const [o0, l] of [[0.2, 0.28], [0.34, 0.16]]) {
        const x0 = xa + W * 0.14 + s * o0, y0 = yb + H * 0.14;
        o.push('<path d="M' + f(x0) + " " + f(y0 + s * l * 0.6) + "L" + f(x0 + s * l * 0.6) + " " + f(y0) + '" ' + S.shine + "/>");
      }
    };
    return D;
  }
  // a shape's outline in px, always drawn left to right (the shapes are symmetric, so a flip does not change them)
  function shapeD(D, u0, v0, u1, v1, shape) {
    const xa = Math.min(D.x(u0), D.x(u1)), xb = Math.max(D.x(u0), D.x(u1)), ya = D.y(v1), yb = D.y(v0), hw = (xb - xa) / 2, cx = (xa + xb) / 2, H = yb - ya;
    if (shape === "round") {
      const cy = (ya + yb) / 2;
      return "M" + f(xa) + " " + f(cy) + "A" + f(hw) + " " + f(H / 2) + " 0 1 1 " + f(xb) + " " + f(cy) + "A" + f(hw) + " " + f(H / 2) + " 0 1 1 " + f(xa) + " " + f(cy) + "Z";
    }
    if (shape === "half") return "M" + f(xa) + " " + f(yb) + "A" + f(hw) + " " + f(H) + " 0 0 1 " + f(xb) + " " + f(yb) + "Z";
    if (shape === "arch") {
      const r = Math.min(hw, H * 0.45);
      return "M" + f(xa) + " " + f(yb) + "V" + f(ya + r) + "A" + f(hw) + " " + f(r) + " 0 0 1 " + f(xb) + " " + f(ya + r) + "V" + f(yb) + "Z";
    }
    if (shape === "gothic") {
      const r = Math.min(hw * 1.732, H * 0.6);
      return "M" + f(xa) + " " + f(yb) + "V" + f(ya + r) + "Q" + f(xa) + " " + f(ya + r * 0.25) + " " + f(cx) + " " + f(ya) + "Q" + f(xb) + " " + f(ya + r * 0.25) + " " + f(xb) + " " + f(ya + r) + "V" + f(yb) + "Z";
    }
    return "M" + f(xa) + " " + f(ya) + "H" + f(xb) + "V" + f(yb) + "H" + f(xa) + "Z";
  }

  /* ---------- windows ---------- */
  // the grille over one pane, in px (a..b across, p..q down); role: 'top' or 'bottom' sash of a double-hung, else ''
  function grille(o, S, k, gr, nx, ny, a, b, p, q, role) {
    const ln = (x1, y1, x2, y2) => o.push('<path d="M' + f(x1) + " " + f(y1) + "L" + f(x2) + " " + f(y2) + '" ' + S.bar + "/>");
    const half = Math.max(1, Math.round(ny / 2));
    if (gr === "colonial") {
      const rows = role ? half : ny;
      for (let u = 1; u < nx; u++) ln(a + ((b - a) * u) / nx, p, a + ((b - a) * u) / nx, q);
      for (let v = 1; v < rows; v++) ln(a, p + ((q - p) * v) / rows, b, p + ((q - p) * v) / rows);
    } else if (gr === "cottage" || gr === "craftsman") {
      const n = gr === "craftsman" ? Math.max(2, nx) : nx;
      if (role === "bottom") return;
      if (role === "top") {
        for (let u = 1; u < n; u++) ln(a + ((b - a) * u) / n, p, a + ((b - a) * u) / n, q);
        if (gr === "cottage") for (let v = 1; v < half; v++) ln(a, p + ((q - p) * v) / half, b, p + ((q - p) * v) / half);
        return;
      }
      const yc = p + (q - p) * (gr === "cottage" ? 0.36 : 0.34);
      ln(a, yc, b, yc);
      for (let u = 1; u < n; u++) ln(a + ((b - a) * u) / n, p, a + ((b - a) * u) / n, yc);
    } else if (gr === "farmhouse") {
      ln((a + b) / 2, p, (a + b) / 2, q);
      role || ln(a, (p + q) / 2, b, (p + q) / 2);
    } else if (gr === "prairie") {
      if (role === "bottom") return;
      const e = Math.min(0.09 * k, 0.2 * Math.min(b - a, q - p));
      ln(a + e, p, a + e, q), ln(b - e, p, b - e, q), ln(a, p + e, b, p + e), ln(a, q - e, b, q - e);
    } else if (gr === "diamond") {
      const rows = role ? half : ny, sx = (b - a) / Math.max(1, nx), sy = (q - p) / Math.max(1, rows), run = ((q - p) * sx) / sy;
      for (let u = -rows - 1; u <= nx + rows + 1; u++) ln(a + u * sx, q, a + u * sx + run, p), ln(a + u * sx, q, a + u * sx - run, p);
    } else if (gr === "sunburst") {
      const n = Math.max(4, nx + 3), cx = (a + b) / 2, r = Math.max(b - a, q - p) * 1.2, hub = Math.min((b - a) * 0.12, (q - p) * 0.25);
      for (let u = 1; u < n; u++) ln(cx + Math.cos((Math.PI * u) / n) * hub, q - Math.sin((Math.PI * u) / n) * hub, cx + Math.cos((Math.PI * u) / n) * r, q - Math.sin((Math.PI * u) / n) * r);
      o.push('<path d="M' + f(cx - hub) + " " + f(q) + "A" + f(hub) + " " + f(hub) + " 0 0 1 " + f(cx + hub) + " " + f(q) + '" ' + S.bar + "/>");
    }
  }
  function drawWindow(D, s, defs) {
    const S = D.S, L = s.look, w = s.w, h = s.h, op = s.op, shape = L.shape || (L.arch ? "arch" : "rect"), slim = !!L.slim,
      fw = slim ? 0.04 : 0.055, rect = shape === "rect", SR = slim ? 0.03 : 0.045, mw = slim ? 0.016 : 0.024,
      [lx, ly] = L.lites || [1, 1], [nx, ny] = L.grid || [1, 1], gr = L.grille || "none";
    // the sill nose under a classic frame
    if (!slim && rect) D.R(-0.03, -0.035, w + 0.03, 0.004, S.solid);
    D.o.push('<path d="' + shapeD(D, 0, 0, w, h, shape) + shapeD(D, fw, fw, w - fw, h - fw, shape) + '" fill-rule="evenodd" ' + S.solid + "/>");
    const gx0 = fw, gx1 = w - fw, gy0 = fw, gy1 = h - fw, inner = shapeD(D, gx0, gy0, gx1, gy1, shape);
    D.o.push('<path d="' + inner + '" ' + S.glass + "/>");
    const id = "opv" + ++uid;
    defs.push('<clipPath id="' + id + 's"><path d="' + inner + '"/></clipPath>');
    // cells between mullions and transom bars, then the sashes in them
    const cols = op === "slide" ? 1 : lx, cells = [], panes = [], solids = [], signs = [];
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < ly; j++) {
        const a = gx0 + ((gx1 - gx0) * i) / cols + (i ? mw : 0), b = gx0 + ((gx1 - gx0) * (i + 1)) / cols - (i < cols - 1 ? mw : 0),
          p = gy0 + ((gy1 - gy0) * j) / ly + (j ? mw : 0), q = gy0 + ((gy1 - gy0) * (j + 1)) / ly - (j < ly - 1 ? mw : 0);
        cells.push([a, b, p, q, i]);
        i && j === 0 && solids.push([a - 2 * mw, gy0, a, gy1]);
        j && solids.push([a, p - 2 * mw, b, p]);
      }
    const sash = (a, b, p, q) => (solids.push(["sash", a, b, p, q]), [a + SR, b - SR, p + SR, q - SR]);
    for (const [a, b, p, q, i] of cells) {
      if (!rect || op === "fixed") panes.push([a, b, p, q, ""]);
      else if (op === "double_hung") {
        const m = (p + q) / 2, lo = sash(a, b, p, m + 0.02), hi = sash(a, b, m - 0.02, q);
        panes.push([...hi, "top"], [...lo, "bottom"]);
        signs.push(() => D.A((a + b) / 2, p + (m - p) * 0.3, (a + b) / 2, p + (m - p) * 0.72));
      } else if (op === "slide") {
        const pn = Math.max(2, L.panels || 2);
        for (let n = 0; n < pn; n++) {
          const u0 = a + ((b - a) * n) / pn - (n ? 0.015 : 0), u1 = a + ((b - a) * (n + 1)) / pn + (n < pn - 1 ? 0.015 : 0), g = sash(u0, u1, p, q);
          panes.push([...g, ""]);
          if (n === pn - 1) signs.push(() => D.A(u1 - (u1 - u0) * 0.3, (p + q) / 2, u0 + (u1 - u0) * 0.3, (p + q) / 2));
        }
      } else {
        const g = sash(a, b, p, q);
        panes.push([...g, ""]);
        const right = cols > 1 && i >= cols / 2;
        if (op === "casement") signs.push(() => D.swing(g[0], g[1], g[2], g[3], right ? "r" : "l", true));
        else if (op === "awning") signs.push(() => D.swing(g[0], g[1], g[2], g[3], "t", true));
        else if (op === "tilt_in") signs.push(() => (D.swing(g[0], g[1], g[2], g[3], "b", false), s.id === "tilt_turn" && D.swing(g[0], g[1], g[2], g[3], "l", false)));
      }
    }
    // the glazing: sash rims, mullions, grille and the glass sign, all inside the frame's outline
    const g = ['<g clip-path="url(#' + id + 's)">'];
    for (const sd of solids) {
      if (sd[0] === "sash") {
        const [, a, b, p, q] = sd;
        g.push('<path d="' + shapeD(D, a, p, b, q, "rect") + shapeD(D, a + SR, p + SR, b - SR, q - SR, "rect") + '" fill-rule="evenodd" ' + S.solid + "/>");
      } else g.push(rectPx(D, sd[0], sd[1], sd[2], sd[3], S.solid));
    }
    if (gr !== "none") {
      defs.push('<clipPath id="' + id + 'p">' + panes.map((pn) => '<path d="' + shapeD(D, pn[0], pn[2], pn[1], pn[3], "rect") + '"/>').join("") + "</clipPath>");
      g.push('<g clip-path="url(#' + id + 'p)">');
      for (const [a, b, p, q, role] of panes) {
        const xa = Math.min(D.x(a), D.x(b)), xb = Math.max(D.x(a), D.x(b));
        grille(g, S, D.k, gr, nx, ny, xa, xb, D.y(q), D.y(p), role);
      }
      g.push("</g>");
    }
    const sh = pen(D.k, D.X0, D.Y0, D.w, D.flip, S, D.thumb);
    if (gr === "none" || gr === "prairie") for (const [a, b, p, q] of panes) sh.shine(a, b, p, q);
    g.push(...sh.o);
    g.push("</g>");
    D.o.push(g.join(""));
    for (const sg of signs) sg();
  }
  const rectPx = (D, u0, v0, u1, v1, a) => {
    const xa = Math.min(D.x(u0), D.x(u1)), xb = Math.max(D.x(u0), D.x(u1)), ya = Math.min(D.y(v0), D.y(v1)), yb = Math.max(D.y(v0), D.y(v1));
    return '<rect x="' + f(xa) + '" y="' + f(ya) + '" width="' + f(xb - xa) + '" height="' + f(yb - ya) + '" ' + a + "/>";
  };

  /* ---------- doors ---------- */
  function glassCell(D, u0, u1, y0, y1, K, bars) {
    D.R(u0, y0, u1, y1, D.S.glass);
    const [cx, cy] = bars === false || !K.bars ? [1, 1] : [Math.max(1, Math.round((u1 - u0) / 0.27)), Math.max(1, Math.round((y1 - y0) / 0.3))];
    for (let k = 1; k < cx; k++) D.L(u0 + ((u1 - u0) * k) / cx, y0, u0 + ((u1 - u0) * k) / cx, y1, D.S.bar);
    for (let k = 1; k < cy; k++) D.L(u0, y0 + ((y1 - y0) * k) / cy, u1, y0 + ((y1 - y0) * k) / cy, D.S.bar);
    if (cx === 1 && cy === 1) D.shine(u0, u1, y0, y1);
  }
  // one leaf's face (the layout of src/build.js leafFace): rails, stiles, panels, glass, grooves or planks
  function leafFace(D, a, b, ya, yb, K, upper) {
    const S = D.S, W = b - a, face = K.face || "flush", glass = K.glass || "none",
      plank = face === "plank", slab = face === "flush" || face === "groove" || plank, steel = face === "flush" && glass === "full",
      st = steel ? 0.055 : Math.min(0.115, W * 0.16), topR = steel ? 0.055 : Math.min(0.115, (yb - ya) * 0.12),
      botR = upper ? topR : steel ? 0.11 : slab ? st : Math.min(0.2, (yb - ya) * 0.12),
      yi0 = ya + botR, yi1 = yb - topR, H = yi1 - yi0, ua = a + st, ub = b - st, rows = [];
    let g0 = yi1, shelf;
    if (glass === "slot") {
      const sw = Math.min(0.14, W * 0.16), s1 = ub - Math.min(0.12, W * 0.12);
      rows.push({ y0: yi0 + H * 0.05, y1: yi1 - H * 0.05, cells: [{ u0: s1 - sw, u1: s1, k: "glass" }] });
      g0 = yi0;
    } else if (glass !== "none") {
      const frac = glass === "top" ? Math.min(0.42, H * 0.24) / H : glass === "half" ? 0.48 : glass === "three" ? 0.72 : glass === "craft" ? 0.27 : 1;
      g0 = yi1 - H * frac;
      const cells = [];
      if (glass === "craft") {
        const n = W > 0.95 ? 4 : 3, m = 0.035;
        for (let k = 0; k < n; k++) cells.push({ u0: ua + ((ub - ua + m) * k) / n, u1: ua + ((ub - ua + m) * (k + 1)) / n - m, k: "glass", bars: false });
        shelf = g0;
      } else cells.push({ u0: plank ? ua + 0.03 : ua, u1: plank ? ub - 0.03 : ub, k: "glass" });
      rows.push({ y0: g0, y1: yi1, cells });
    }
    const rest1 = glass === "slot" ? yi0 : glass === "none" ? yi1 : g0 - 0.1;
    if (!slab && rest1 - yi0 > 0.12) {
      let R = FACE_ROWS[face] || FACE_ROWS.shaker;
      const keep = glass === "none" ? R.length : Math.max(1, Math.round((R.length * (rest1 - yi0)) / H));
      R = R.slice(R.length - keep);
      const rail = 0.1, tot = R.reduce((q, r) => q + r[0], 0), span = rest1 - yi0 - rail * (R.length - 1);
      let y = rest1;
      for (const [wt, nc] of R) {
        const hh = (span * wt) / tot, mul = 0.1, cw = (ub - ua - mul * (nc - 1)) / nc, cells = [];
        for (let k = 0; k < nc; k++) cells.push({ u0: ua + k * (cw + mul), u1: ua + k * (cw + mul) + cw, k: face === "p6" ? "raised" : "panel" });
        rows.push({ y0: y - hh, y1: y, cells });
        y -= hh + rail;
      }
    }
    D.holed(a, ya, b, yb, rows.flatMap((r) => r.cells.filter((c) => c.k === "glass").map((c) => [c.u0, r.y0, c.u1, r.y1])), S.solid);
    const glassRows = rows.filter((r) => r.cells.some((c) => c.k === "glass"));
    if (plank) {
      // boards: a joint line every board, broken where the glass is
      const n = Math.max(3, Math.round(W / 0.14)), bw = W / n;
      for (let k = 1; k < n; k++) {
        const u = a + k * bw;
        let segs = [[ya, yb]];
        for (const r of glassRows) for (const c of r.cells) if (u > c.u0 - 1e-4 && u < c.u1 + 1e-4) segs = segs.flatMap(([p, q]) => [p < r.y0 ? [p, Math.min(q, r.y0)] : null, q > r.y1 ? [Math.max(p, r.y1), q] : null].filter(Boolean));
        for (const [p, q] of segs) D.L(u, p, u, q, S.fine);
      }
    }
    for (const r of rows)
      for (const c of r.cells) {
        if (c.k === "glass") glassCell(D, c.u0, c.u1, r.y0, r.y1, K, c.bars);
        else if (c.k === "panel") D.R(c.u0, r.y0, c.u1, r.y1, S.panel);
        else {
          D.R(c.u0, r.y0, c.u1, r.y1, S.panel);
          const m = Math.min(0.045, (c.u1 - c.u0) * 0.2);
          D.R(c.u0 + m, r.y0 + m, c.u1 - m, r.y1 - m, S.fine);
        }
      }
    if (shelf !== undefined) D.R(ua - 0.015, shelf - 0.05, ub + 0.015, shelf - 0.022, S.solid);
    if (face === "groove") {
      const gl = rows.flatMap((r) => r.cells.filter((c) => c.k === "glass").map((c) => ({ ...c, y0: r.y0, y1: r.y1 }))), n = Math.max(3, Math.round((yb - ya) / 0.3));
      for (let k = 1; k < n; k++) {
        const gy = ya + ((yb - ya) * k) / n;
        let u = a;
        for (const c of gl.filter((c) => gy > c.y0 - 0.02 && gy < c.y1 + 0.02).sort((p, q) => p.u0 - q.u0)) (D.L(u, gy, c.u0 - 0.02, gy, S.fine), (u = c.u1 + 0.02));
        D.L(u, gy, b, gy, S.fine);
      }
    }
  }
  // the handle near the latch edge: b, or a when the latch is on the left (`left`)
  function hardware(D, a, b, ya, yb, left, K) {
    const S = D.S, u = left ? a + 0.065 : b - 0.065, toHinge = left ? 1 : -1, hy = Math.min(ya + 0.95, yb - 0.15), hw = K.hw || "knob";
    if (hw === "pull") {
      const len = Math.min(1.1, (yb - ya) * 0.42);
      D.R(u - 0.013, hy - len * 0.42, u + 0.013, hy + len * 0.58, S.hw);
    } else if (hw === "lever") {
      D.C(u, hy, 0.024, S.hw);
      D.R(u, hy - 0.011, u + toHinge * 0.12, hy + 0.011, S.hw);
    } else D.C(u, hy, 0.032, S.hw);
  }
  function drawDesigned(D, s, hand) {
    const S = D.S, K = s.look, w = s.w, h = s.h, leaf = s.leaf, fw = 0.05, yD = leaf.h, ySide = yD - fw, la = leaf.a, lb = leaf.b, t = s.t, toward = !!hand.out;
    // the frame: jambs, head, mullions beside sidelights, a bar under the transom; a threshold at the floor
    D.R(0, 0, fw, h, S.solid), D.R(w - fw, 0, w, h, S.solid), D.R(fw, h - fw, w - fw, h, S.solid);
    if (la > 0) D.R(la, 0, la + fw, ySide, S.solid);
    if (lb < w - 1e-6) D.R(lb - fw, 0, lb, ySide, S.solid);
    if (K.transom) D.R(fw, yD - fw, w - fw, yD, S.solid);
    if (!t.thin) D.R(fw - 0.01, -0.012, w - fw + 0.01, 0.012, S.solid);
    const sideLite = (s0, s1) => {
      const kick = K.glass === "half" || K.glass === "three" ? 0.24 : 0.3;
      D.holed(s0, 0, s1, ySide, [[s0 + 0.035, kick, s1 - 0.035, ySide - 0.035]], S.solid);
      D.R(s0 + 0.04, 0.07, s1 - 0.04, kick - 0.05, S.panel);
      glassCell(D, s0 + 0.035, s1 - 0.035, kick, ySide - 0.035, { bars: K.bars }, K.bars ? undefined : false);
    };
    if (la > 0) sideLite(fw, la);
    if (lb < w - 1e-6) sideLite(lb, w - fw);
    if (K.transom) {
      const ta = fw, tb = w - fw, tya = yD, tyb = h - fw, cuts = [ta];
      if (la > 0) cuts.push(la + fw / 2);
      if (lb < w - 1e-6) cuts.push(lb - fw / 2);
      cuts.push(tb);
      const lites = [];
      for (let k = 0; k + 1 < cuts.length; k++) lites.push([cuts[k] + (k ? 0.02 : 0.035), tya + 0.035, cuts[k + 1] - (k + 2 < cuts.length ? 0.02 : 0.035), tyb - 0.035]);
      D.holed(ta, tya, tb, tyb, lites, S.solid);
      for (let k = 0; k + 1 < cuts.length; k++) {
        const a = cuts[k] + (k ? 0.02 : 0.035), b = cuts[k + 1] - (k + 2 < cuts.length ? 0.02 : 0.035);
        D.R(a, tya + 0.035, b, tyb - 0.035, S.glass);
        const n = K.bars ? Math.max(1, Math.round((b - a) / 0.3)) : 1;
        for (let m = 1; m < n; m++) D.L(a + ((b - a) * m) / n, tya + 0.035, a + ((b - a) * m) / n, tyb - 0.035, S.bar);
        n === 1 && D.shine(a, b, tya + 0.035, tyb - 0.035);
      }
    }
    const x0 = la + fw, x1 = lb - fw, ly0 = 0.004, ly1 = ySide - 0.003, pair = (t.look && t.look.panels) === 2 && t.op === "swing", pivot = t.op === "pivot";
    const leaves = pair ? [[x0 + 0.003, (x0 + x1) / 2 - 0.002, "l"], [(x0 + x1) / 2 + 0.002, x1 - 0.003, "r"]] : [[x0 + 0.003, x1 - 0.003, "l"]];
    for (const [a, b, hinge] of leaves) {
      if (t.op === "dutch") {
        const cut = Math.min(1.07, ly1 * 0.55), half = FACE_ROWS[K.face] && K.face !== "p3" ? "shaker" : K.face;
        leafFace(D, a, b, ly0, cut - 0.003, { ...K, face: half, glass: "none" }, false);
        leafFace(D, a, b, cut + 0.003, ly1, { ...K, face: half, glass: K.glass === "none" ? "none" : K.glass === "slot" ? "slot" : "full" }, true);
        D.R(a - 0.015, cut - 0.04, b + 0.015, cut - 0.003, S.solid);
        hardware(D, a, b, ly0, ly1, false, K);
        D.swing(a, b, ly0, cut - 0.04, "l", toward), D.swing(a, b, cut + 0.003, ly1, "l", toward);
        continue;
      }
      leafFace(D, a, b, ly0, ly1, K, false);
      hardware(D, a, b, ly0, ly1, hinge === "r", K);
      if (pivot) {
        const pu = a + Math.min(0.26, (b - a) * 0.2);
        D.L(pu, -0.03, pu, ly1 + 0.03, S.axis);
        D.P([[b, ly1], [pu, (ly0 + ly1) / 2], [b, ly0]], false, toward ? S.opTo : S.opAway);
      } else D.swing(a, b, ly0, ly1, hinge, toward);
    }
  }
  // the other doors: a patio slider, a barn door on its track, a pocket door, a bifold, a roll-up and a cased opening
  function drawDoor(D, s, hand, full) {
    const S = D.S, K = s.look || {}, w = s.w, h = s.h, t = s.t, op = s.op, fw = 0.05;
    const frame = () => (D.R(0, 0, fw, h, S.solid), D.R(w - fw, 0, w, h, S.solid), D.R(fw, h - fw, w - fw, h, S.solid));
    const face = (def) => ({ face: K.face || def.face, glass: K.glass || def.glass, bars: K.bars === undefined ? !!def.bars : K.bars });
    if (op === "slide") {
      frame();
      D.R(fw - 0.01, -0.012, w - fw + 0.01, 0.012, S.solid);
      const pn = Math.max(2, K.leaves || K.panels || 2), x0 = fw, x1 = w - fw;
      for (let p = 0; p < pn; p++) {
        const a = x0 + ((x1 - x0) * p) / pn - (p ? 0.02 : 0), b = x0 + ((x1 - x0) * (p + 1)) / pn + (p < pn - 1 ? 0.02 : 0);
        leafFace(D, a, b, 0.006, h - fw - 0.004, face({ face: "flush", glass: "full" }), false);
        if (p === pn - 1) {
          D.R(a + 0.035, 0.85, a + 0.06, 1.15, S.hw);
          D.A(b - (b - a) * 0.28, h * 0.5, a + (b - a) * 0.28, h * 0.5);
        }
      }
      return;
    }
    if (t.surface || op === "barn") {
      const lo = t.leafOver === undefined ? 0.1 : t.leafOver, yT = h + 0.14, end = full ? 2 * w + 0.2 : w + 0.3;
      D.R(0, 0, w, h, S.hidden);
      D.R(-0.1, yT - 0.02, end, yT + 0.02, S.solid);
      const a = -lo, b = w + lo, top = h + 0.06;
      if (K.face) leafFace(D, a, b, 0, top, face({}), false);
      else {
        // the classic: boards, three rails and the braces between them on the face
        D.R(a, 0, b, top, S.solid);
        const n = Math.max(4, Math.round((b - a) / 0.15)), bw = (b - a) / n, rw = 0.13, r0 = 0.12, r1 = top / 2, r2 = top - 0.12;
        for (let k = 1; k < n; k++) D.L(a + k * bw, 0, a + k * bw, top, S.fine);
        for (const r of [r0, r1, r2]) D.R(a + 0.02, r - rw / 2, b - 0.02, r + rw / 2, S.solid);
        D.P([[a + 0.02, r0 + rw / 2], [a + 0.02 + rw * 1.2, r0 + rw / 2], [b - 0.02, r1 - rw / 2], [b - 0.02 - rw * 1.2, r1 - rw / 2]], true, S.solid);
        D.P([[a + 0.02, r1 + rw / 2], [a + 0.02 + rw * 1.2, r1 + rw / 2], [b - 0.02, r2 - rw / 2], [b - 0.02 - rw * 1.2, r2 - rw / 2]], true, S.solid);
      }
      for (const u of [a + 0.18, b - 0.18]) (D.R(u - 0.02, top - 0.12, u + 0.02, yT, S.solid), D.C(u, yT, 0.04, S.solid));
      D.R(b - 0.2, 0.85, b - 0.17, 1.2, S.hw);
      D.A(w * 0.38, h * 0.5 - 0.25, w * 0.62, h * 0.5 - 0.25);
      return;
    }
    if (op === "pocket" || t.frame === "pocket") {
      frame();
      if (full) D.R(w, 0, 2 * w - fw, h - fw, S.hidden);
      leafFace(D, fw + 0.004, w - fw - 0.004, 0.004, h - fw - 0.003, face({ face: "flush", glass: "none" }), false);
      D.R(w - 0.2, 0.9, w - 0.17, 1.1, S.hw);
      D.A(w * 0.38, h * 0.62, w * 0.62, h * 0.62);
      return;
    }
    if (op === "fold") {
      frame();
      const n = Math.max(2, (K.leaves || (w > 1.1 ? 4 : 2)) & ~1), x0 = fw, x1 = w - fw, pw = (x1 - x0) / n, toward = !!hand.out;
      for (let p = 0; p < n; p++) {
        const a = x0 + p * pw + 0.003, b = x0 + (p + 1) * pw - 0.003, left = p < n / 2;
        leafFace(D, a, b, 0.006, h - fw - 0.004, face({ face: "shaker", glass: "none" }), false);
        D.swing(a, b, 0.006, h - fw - 0.004, left ? "l" : "r", toward);
        if (p % 2 === 1 && left) D.C(b - 0.04, 1.0, 0.022, S.hw);
        if (p % 2 === 0 && !left) D.C(a + 0.04, 1.0, 0.022, S.hw);
      }
      return;
    }
    if (op === "roll") {
      const tw = 0.08;
      D.R(-tw, 0, 0, h + tw, S.solid), D.R(w, 0, w + tw, h + tw, S.solid), D.R(0, h, w, h + tw, S.solid);
      const n = Math.max(2, K.leaves || (K.grid && K.grid[1]) || 4), m = Math.max(2, Math.round(w / 0.62)), sh = h / n;
      for (let k = 0; k < n; k++) {
        const p = k * sh, q = (k + 1) * sh;
        D.R(0, p, w, q, S.solid);
        const ins = Math.min(0.08, sh * 0.2), cw = w / m;
        for (let c = 0; c < m; c++) D.R(c * cw + ins, p + ins, (c + 1) * cw - ins, q - ins, S.panel);
      }
      D.R(w / 2 - 0.12, 0.08, w / 2 + 0.12, 0.11, S.hw);
      D.A(w - 0.25, h * 0.3, w - 0.25, h * 0.7);
      return;
    }
    if (op === "open") {
      const cw = 0.07;
      D.R(0, 0, cw, h, S.solid), D.R(w - cw, 0, w, h, S.solid), D.R(0, h - cw, w, h, S.solid);
      D.R(cw, 0, cw + 0.02, h - cw, S.fine), D.R(w - cw - 0.02, 0, w - cw, h - cw, S.fine);
      D.R(cw + 0.02, h - cw - 0.02, w - cw - 0.02, h - cw, S.fine);
      D.L(cw + 0.02, 0.0, w - cw - 0.02, 0.0, S.fine);
      return;
    }
    // anything else: a frame and a plain leaf
    frame();
    leafFace(D, fw + 0.003, w - fw - 0.003, 0.004, h - fw - 0.003, face({ face: "flush", glass: "none" }), false);
    hardware(D, fw, w - fw, 0, h - fw, false, K);
  }
  // how far a unit's drawing reaches past its own box (a barn door's leaf and track, a window's sill nose)
  function extents(s) {
    if (s.kind === "window") return { a: -0.04, b: s.w + 0.04, lo: -0.04, hi: s.h };
    if (s.t.surface || s.op === "barn") return { a: -0.1, b: s.w + 0.3, lo: -0.02, hi: s.h + 0.2 };
    if (s.op === "roll") return { a: -0.08, b: s.w + 0.08, lo: -0.02, hi: s.h + 0.08 };
    return { a: 0, b: s.w, lo: -0.02, hi: s.h };
  }
  function drawUnit(D, s, hand, defs, full) {
    if (s.kind === "window") drawWindow(D, s, defs);
    else if (s.leaf && designable(s.t)) drawDesigned(D, s, hand);
    else drawDoor(D, s, hand, full);
  }

  /* ---------- the stage: the unit on its wall run, with dimensions and handles ---------- */
  function layout(s, o) {
    const W = o.width || 360, Hp = o.height || 220, wall = o.wall || {}, L = wall.L > 0 ? wall.L : 4, H = wall.H > 0 ? wall.H : 2.84,
      at = Number.isFinite(o.at) ? o.at : L / 2, u0 = at - s.w / 2, e = extents(s), padT = 16, padB = 42, padS = 12;
    let k = (Hp - padT - padB) / Math.max(H, s.sill + e.hi + 0.1);
    k = Math.min(k, (W - 2 * padS - 76) / Math.max(0.3, e.b - e.a));
    const span = (W - 2 * padS) / k;
    const v0 = span >= L ? (L - span) / 2 : clamp(at - span / 2, 0, L - span);
    const X = (r) => padS + (r - v0) * k, oy = Hp - padB;
    return { W, Hp, L, H, at, u0, k, v0, v1: v0 + span, X, oy, padS, padT, ox: X(0), others: wall.others || [] };
  }
  function stage(s, o, hand) {
    const S = styles(false, s.fin), defs = [], out = [], Y = (y) => M.oy - y * M.k, M = layout(s, o), { W, Hp, L, H, k, X, oy, u0 } = M;
    const vis0 = Math.max(0, M.v0), vis1 = Math.min(L, M.v1), cid = "opv" + ++uid;
    defs.push('<clipPath id="' + cid + 'v"><rect x="' + f(M.padS) + '" y="0" width="' + f(W - 2 * M.padS) + '" height="' + Hp + '"/></clipPath>');
    out.push('<rect class="op-bg" width="' + W + '" height="' + Hp + '" fill="var(--cad-bg)"/>');
    // the wall: its face, the floor with ground hatching under it, the top, the top plate line, its ends or break marks
    const xa = X(vis0), xb = X(vis1), yT = Y(H), yP = Y(H - TOP_PLATE);
    out.push('<rect x="' + f(xa) + '" y="' + f(yT) + '" width="' + f(xb - xa) + '" height="' + f(oy - yT) + '" fill="var(--cad)" fill-opacity=".05"/>');
    let hatch = "";
    for (let x = xa + 3; x < xb; x += 6) hatch += "M" + f(x) + " " + f(oy + 1) + "l-4 5";
    out.push('<path d="' + hatch + '" fill="none" stroke="var(--cad)" stroke-width=".6" stroke-opacity=".28"/>');
    out.push('<path d="M' + f(xa - (M.v0 < 0 ? 8 : 0)) + " " + f(oy) + "H" + f(xb + (M.v1 > L ? 8 : 0)) + '" stroke="var(--cad-ink)" stroke-width="1.4" stroke-opacity=".75"/>');
    out.push('<path d="M' + f(xa) + " " + f(yT) + "H" + f(xb) + '" stroke="var(--cad)" stroke-width="1" stroke-opacity=".6"/>');
    const rough = s.kind === "door" ? s.h + FLOOR_GAP + ROUGH : s.sill + s.h + ROUGH, over = rough - (H - TOP_PLATE);
    out.push('<path d="M' + f(xa) + " " + f(yP) + "H" + f(xb) + '" stroke="' + (over > 1e-6 ? "var(--danger)" : "var(--cad)") + '" stroke-width="' + (over > 1e-6 ? 1 : 0.7) + '" stroke-opacity="' + (over > 1e-6 ? 0.9 : 0.45) + '" stroke-dasharray="5 3"/>');
    out.push('<text x="' + f(xb - 3) + '" y="' + f(yP - 3) + '" text-anchor="end" font-size="7.5" fill="var(--cad)" fill-opacity=".6">top plate</text>');
    const end = (x) => out.push('<path d="M' + f(x) + " " + f(oy) + "V" + f(yT) + '" stroke="var(--cad-ink)" stroke-width="2" stroke-opacity=".7"/>');
    const brk = (x) => {
      const n = 6, hh = (oy - yT) / n;
      let d = "M" + f(x) + " " + f(yT - 4);
      for (let i = 0; i < n; i++) d += "L" + f(x + (i % 2 ? -3 : 3)) + " " + f(yT + hh * (i + 0.5));
      out.push('<path d="' + d + "L" + f(x) + " " + f(oy + 4) + '" fill="none" stroke="var(--cad)" stroke-width=".8" stroke-opacity=".6"/>');
    };
    M.v0 <= 1e-6 ? end(X(0)) : brk(xa);
    M.v1 >= L - 1e-6 ? end(X(L)) : brk(xb);
    // the other openings on the run, in outline
    const body = ['<g clip-path="url(#' + cid + 'v)">'];
    for (const q of M.others) {
      const sl = q.sill > 0.05 ? q.sill : 0, hd = q.head > sl ? q.head : Math.min(H - TOP_PLATE, 2.1);
      body.push('<rect x="' + f(X(q.a)) + '" y="' + f(Y(hd)) + '" width="' + f((q.b - q.a) * k) + '" height="' + f((hd - sl) * k) + '" fill="var(--cad)" fill-opacity=".05" stroke="var(--cad)" stroke-width=".8" stroke-opacity=".55" stroke-dasharray="3 2"/>');
    }
    if (over > 1e-6) body.push('<rect x="' + f(X(u0)) + '" y="' + f(Y(H - TOP_PLATE + over)) + '" width="' + f(s.w * k) + '" height="' + f(over * k) + '" fill="var(--danger)" fill-opacity=".35"/>');
    const D = pen(k, X(u0), Y(s.sill), s.w, !!hand.flip, S, false);
    drawUnit(D, s, hand, defs, true);
    body.push(D.o.join(""), "</g>");
    out.push(body.join(""));
    out.push(dims(s, o, M, Y));
    if (o.handles) out.push(handles(s, M, Y));
    return { svg: out.join(""), defs, M };
  }
  function dims(s, o, M, Y) {
    const { X, oy, u0, L, k } = M, out = [], dl = 'stroke="var(--cad)" stroke-width=".75"', tx = 'fill="var(--cad-ink)" font-size="9.5" font-weight="600"';
    const xL = M.padS, xR = M.W - M.padS, cx = (x) => clamp(x, xL, xR);
    const tick = (x, y) => "M" + f(x - 3) + " " + f(y + 3) + "L" + f(x + 3) + " " + f(y - 3);
    // the string under the floor: wall end or neighbour, the gap, the unit's width, the gap, the next
    let lb = 0, rb = L;
    for (const q of M.others) {
      if (q.b <= u0 + 1e-6) lb = Math.max(lb, q.b - ROUGH);
      if (q.a >= u0 + s.w - 1e-6) rb = Math.min(rb, q.a + ROUGH);
    }
    const yC = oy + 18, pts = [lb, u0, u0 + s.w, rb];
    let d = "M" + f(cx(X(lb))) + " " + f(yC) + "H" + f(cx(X(rb)));
    for (const p of pts) if (X(p) >= xL - 0.5 && X(p) <= xR + 0.5) d += tick(X(p), yC);
    // extension lines from the unit's edges down to the string
    d += "M" + f(X(u0)) + " " + f(Y(s.sill) + 3) + "V" + f(yC + 4) + "M" + f(X(u0 + s.w)) + " " + f(Y(s.sill) + 3) + "V" + f(yC + 4);
    out.push('<path d="' + d + '" fill="none" ' + dl + "/>");
    // labels: inside its ticks if it fits, else below the string (with a short leader), else shifted sideways along that
    // row or dropped to a second row; never over another label. A gap under 3 cm is not labelled.
    const TW = (t) => t.length * 5.8 + 2, rows = [[yC - 3, 0], [yC + 10, 1], [yC + 20, 1]], boxes = [];
    const free = (cxm, tw, ri) => boxes.every((q) => q.ri !== ri || cxm + tw / 2 <= q.l || cxm - tw / 2 >= q.r) && cxm - tw / 2 >= 2 && cxm + tw / 2 <= M.W - 2;
    const items = [[lb, u0, u0 - lb, false], [u0, u0 + s.w, s.w, true], [u0 + s.w, rb, rb - u0 - s.w, false]].filter((q) => q[3] || q[2] >= 0.03)
      .map((q) => { const x0 = cx(X(q[0])), x1 = cx(X(q[1])); return { x0, x1, v: q[2], strong: q[3], t: m2(q[2]), m: (x0 + x1) / 2 }; })
      .sort((p, q) => (q.strong - p.strong) || ((q.x1 - q.x0) - (p.x1 - p.x0)));
    let leaders = "";
    for (const it of items) {
      const tw = TW(it.t);
      let at = null;
      if (it.x1 - it.x0 > tw + 2 && free(it.m, tw, 0)) at = [it.m, 0];
      for (let ri = 1; ri < 3 && !at; ri++)
        for (let d = 0; d <= 140 && !at; d += 4)
          for (const sg of d ? [-1, 1] : [1]) if (free(it.m + sg * d, tw, ri)) { at = [it.m + sg * d, ri]; break; }
      if (!at) at = [it.m, 2];
      boxes.push({ l: at[0] - tw / 2, r: at[0] + tw / 2, ri: at[1] });
      const y = rows[at[1]][0];
      if (at[1]) leaders += "M" + f(it.m) + " " + f(yC) + "L" + f(at[0]) + " " + f(y - 8.5);
      out.push('<text x="' + f(at[0]) + '" y="' + f(y) + '" text-anchor="middle" ' + tx + (it.strong ? "" : ' fill-opacity=".8"') + ">" + it.t + "</text>");
    }
    leaders && out.push('<path d="' + leaders + '" fill="none" stroke="var(--cad)" stroke-width=".6" stroke-opacity=".7"/>');
    // the height beside the unit, and the sill (or head, or centre) from the floor on the other side
    const vert = (x, y0, y1, t, side, cap) => {
      out.push('<path d="M' + f(x) + " " + f(y0) + "V" + f(y1) + tick(x, y0) + tick(x, y1) + '" fill="none" ' + dl + "/>");
      const tX = x + (side > 0 ? 4 : -4), anc = side > 0 ? "start" : "end", my = (y0 + y1) / 2;
      if (Math.abs(y1 - y0) < 26) {
        // too short to hold its label: the number (and what it is) above the top end
        out.push('<text x="' + f(tX) + '" y="' + f(Math.min(y0, y1) - 4) + '" text-anchor="' + anc + '" ' + tx + ">" + t + (cap ? ' <tspan font-size="7.5" font-weight="400" fill="var(--cad)" fill-opacity=".75">' + cap + "</tspan>" : "") + "</text>");
        return;
      }
      out.push('<text x="' + f(tX) + '" y="' + f(my + (cap ? 0 : 3.3)) + '" text-anchor="' + anc + '" ' + tx + ">" + t + "</text>");
      cap && out.push('<text x="' + f(tX) + '" y="' + f(my + 9) + '" text-anchor="' + anc + '" font-size="7.5" fill="var(--cad)" fill-opacity=".75">' + cap + "</text>");
    };
    const e = extents(s), right = X(u0 + e.b) + 8;
    vert(Math.min(right, xR - 26), Y(s.sill + s.h), Y(s.sill), m2(s.h), 1, "");
    if (s.kind === "window") {
      const an = o.anchor === "head" || o.anchor === "centre" ? o.anchor : "sill", yv = an === "head" ? s.sill + s.h : an === "centre" ? s.sill + s.h / 2 : s.sill;
      if (yv > 0.04) vert(Math.max(X(u0 + e.a) - 8, xL + 26), Y(yv), Y(0), m2(yv), -1, an);
    }
    return out.join("");
  }
  function handles(s, M, Y) {
    const { X, u0 } = M, x0 = X(u0), x1 = X(u0 + s.w), y0 = Y(s.sill + s.h), y1 = Y(s.sill), out = [], hit = 'fill="none" pointer-events="all"';
    const r = (h, x, y, w, hh, cur) => out.push('<rect class="op-h" data-h="' + h + '" x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(hh) + '" ' + hit + ' cursor="' + cur + '"/>');
    const grip = (x, y) => out.push('<rect x="' + f(x - 3.5) + '" y="' + f(y - 3.5) + '" width="7" height="7" fill="var(--cad-bg)" stroke="var(--cad)" stroke-width="1.2" pointer-events="none"/>');
    const win = s.kind === "window";
    out.push('<rect x="' + f(x0) + '" y="' + f(y0) + '" width="' + f(x1 - x0) + '" height="' + f(y1 - y0) + '" fill="none" stroke="var(--cad)" stroke-width=".8" stroke-opacity=".7" stroke-dasharray="2 2" pointer-events="none"/>');
    r("move", x0, y0, x1 - x0, y1 - y0, win ? "move" : "ew-resize");
    r("l", x0 - 7, y0, 14, y1 - y0, "ew-resize"), r("r", x1 - 7, y0, 14, y1 - y0, "ew-resize"), r("t", x0, y0 - 7, x1 - x0, 14, "ns-resize");
    win && r("b", x0, y1 - 7, x1 - x0, 14, "ns-resize");
    grip(x0, (y0 + y1) / 2), grip(x1, (y0 + y1) / 2), grip((x0 + x1) / 2, y0);
    win && grip((x0 + x1) / 2, y1);
    return '<g class="op-hs">' + out.join("") + "</g>";
  }

  /* ---------- the thumb: the unit alone, fitted to a card ---------- */
  function thumb(s, o, hand) {
    const W = o.width || 56, Hp = o.height || 56, S = styles(true, null), defs = [], e = extents(s), pad = 4, door = s.kind === "door",
      k = Math.min((W - 2 * pad) / (e.b - e.a), (Hp - 2 * pad - (door ? 2 : 0)) / (e.hi - e.lo)),
      X0 = (W - (e.b - e.a) * k) / 2 - e.a * k, Y0 = door ? Hp - pad - 1 : (Hp + (e.hi + e.lo) * k) / 2;
    const D = pen(k, X0, Y0, s.w, !!hand.flip, S, true);
    drawUnit(D, s, hand, defs, false);
    const floor = door ? '<path d="M' + f(pad * 0.5) + " " + f(Y0 + 0.5) + "H" + f(W - pad * 0.5) + '" stroke="currentColor" stroke-width="1" stroke-opacity=".55"/>' : "";
    return { svg: floor + D.o.join(""), defs };
  }

  function draw(spec, opts = {}) {
    const s = norm(spec), hand = opts.hand || { flip: s.flip, out: s.out }, th = opts.size === "thumb";
    const label = esc(opts.label || s.name + " " + m2(s.w) + " x " + m2(s.h));
    if (th) {
      const W = opts.width || 56, Hp = opts.height || 56, r = thumb(s, opts, hand);
      return '<svg class="op-prev op-prev--thumb" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + Hp + '" width="' + W + '" height="' + Hp + '" role="img" aria-label="' + label + '">' + (r.defs.length ? "<defs>" + r.defs.join("") + "</defs>" : "") + r.svg + "</svg>";
    }
    const r = stage(s, opts, hand), M = r.M;
    return '<svg class="op-prev op-prev--stage" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + M.W + " " + M.Hp + '" width="' + M.W + '" height="' + M.Hp + '" role="img" aria-label="' + label + '" data-k="' + f(M.k * 100) / 100 + '" data-ox="' + f(M.ox) + '" data-oy="' + f(M.oy) + '" font-family="var(--cad-font, system-ui, sans-serif)">' + "<defs>" + r.defs.join("") + "</defs>" + r.svg + "</svg>";
  }
  function metrics(spec, opts = {}) {
    const s = norm(spec), M = layout(s, opts), Y = (y) => M.oy - y * M.k;
    return { k: M.k, ox: M.ox, oy: M.oy, x0: M.X(M.u0), x1: M.X(M.u0 + s.w), y0: Y(s.sill + s.h), y1: Y(s.sill), view: [M.v0, M.v1] };
  }

  /* ---------- the plan view of a door: which way it opens ---------- */
  const SLIDES = new Set(["slide", "barn", "pocket"]);
  const pairOf = (s) => (s.t.look && s.t.look.panels) === 2 && s.op === "swing";
  // which way a sliding leaf travels for a flip: -1 left, 1 right (src/build.js: a patio slider's right panel slides
  // left; a barn or pocket door slides right)
  const travel = (s, flip) => (s.op === "slide" ? -1 : 1) * (flip ? -1 : 1);
  const hands = (spec) => handsOf(norm(spec));
  function handsOf(s) {
    if (s.kind !== "door" || s.op === "roll" || s.op === "open") return [];
    // a pocket door always slides toward the pocket the wall's framing leaves on one side: nothing to choose
    if (s.op === "pocket" || s.t.frame === "pocket") return [];
    if (SLIDES.has(s.op) || s.t.surface) {
      const fl = travel(s, false) < 0 ? 0 : 1;
      return [{ flip: fl, out: null, label: "Slides left" }, { flip: 1 - fl, out: null, label: "Slides right" }];
    }
    if (pairOf(s) || s.op === "fold") return [{ flip: null, out: 0, label: "Opens in" }, { flip: null, out: 1, label: "Opens out" }];
    return [
      { flip: 0, out: 0, label: "Hinge left, opens in" }, { flip: 1, out: 0, label: "Hinge right, opens in" },
      { flip: 0, out: 1, label: "Hinge left, opens out" }, { flip: 1, out: 1, label: "Hinge right, opens out" },
    ];
  }
  function plan(spec, hand, opts = {}) {
    const s = norm(spec);
    if (s.kind !== "door") return "";
    hand = hand || { flip: s.flip, out: s.out };
    const W = opts.width || 360, Hp = opts.height || 120, th = 0.14, fw = 0.05, cy = Hp / 2, flip = !!hand.flip, outw = !!hand.out;
    const la = s.leaf ? s.leaf.a + fw : fw, lb = s.leaf ? s.leaf.b - fw : s.w - fw, lw = lb - la, pair = pairOf(s), pivot = s.op === "pivot";
    const slide = SLIDES.has(s.op) || !!s.t.surface, fold = s.op === "fold";
    const R = pair ? lw / 2 : pivot ? lw - Math.min(0.26, lw * 0.2) : fold ? lw / (s.w > 1.1 ? 4 : 2) : slide ? 0.25 : lw;
    const k = Math.min((cy - 12) / (th / 2 + R + 0.06), (W - 60) / (s.w + (slide ? s.w + 0.4 : 0.8)), 110),
      X0 = W / 2 - (s.w * k) / 2, ht = (th / 2) * k;
    const xu = (u, fl) => X0 + (fl ? s.w - u : u) * k;
    const out = ['<rect class="op-bg" width="' + W + '" height="' + Hp + '" fill="var(--cad-bg)"/>'];
    const ink = 'stroke="var(--cad-ink)"', cad = 'stroke="var(--cad)"';
    // the wall in section either side of the opening, hatched, and the jambs
    const wallSeg = (x0, x1) => {
      if (x1 - x0 < 1) return;
      let hd = "";
      for (let x = x0 + 4; x < x1 + ht * 2; x += 5) hd += "M" + f(Math.min(x, x1)) + " " + f(cy - ht + Math.max(0, x - x1)) + "L" + f(Math.max(x0, x - ht * 2)) + " " + f(cy + ht - Math.max(0, x0 - (x - ht * 2)));
      out.push('<rect x="' + f(x0) + '" y="' + f(cy - ht) + '" width="' + f(x1 - x0) + '" height="' + f(2 * ht) + '" fill="var(--cad)" fill-opacity=".1"/>');
      out.push('<path d="' + hd + '" fill="none" ' + cad + ' stroke-width=".5" stroke-opacity=".35"/>');
      out.push('<path d="M' + f(x0) + " " + f(cy - ht) + "H" + f(x1) + "M" + f(x0) + " " + f(cy + ht) + "H" + f(x1) + '" fill="none" ' + ink + ' stroke-width="1.1"/>');
    };
    const xo0 = X0, xo1 = X0 + s.w * k;
    wallSeg(10, xo0), wallSeg(xo1, W - 10);
    out.push('<path d="M' + f(xo0) + " " + f(cy - ht) + "V" + f(cy + ht) + "M" + f(xo1) + " " + f(cy - ht) + "V" + f(cy + ht) + '" ' + ink + ' stroke-width="1.1"/>');
    if (s.op !== "open") out.push('<path d="M' + f(xo0) + " " + f(cy) + "h" + f(fw * k) + "M" + f(xo1) + " " + f(cy) + "h" + f(-fw * k) + '" ' + ink + ' stroke-width="' + f(Math.max(1.5, 0.05 * k)) + '"/>');
    out.push('<text x="12" y="13" font-size="8" fill="var(--cad)" fill-opacity=".7">Inside</text><text x="12" y="' + (Hp - 6) + '" font-size="8" fill="var(--cad)" fill-opacity=".7">Outside</text>');
    const lt = Math.max(2, 0.045 * k);
    // one hinged leaf open at a right angle with its swing arc, for a hand (fl, ou)
    const swingLeaf = (fl, ou, on, a, b, hingeAtA) => {
      const sd = ou ? 1 : -1, fy = cy + sd * ht, hu = hingeAtA ? a : b, hx = xu(hu, fl), lx = xu(hingeAtA ? b : a, fl), r = Math.abs(lx - hx), dir = Math.sign(lx - hx) || 1;
      const st = on ? 'stroke="var(--cad-ink)" stroke-width="1.2"' : 'stroke="var(--cad)" stroke-width=".7" stroke-opacity=".38" stroke-dasharray="3 2"';
      const sweep = dir * sd > 0 ? 1 : 0;
      let g = '<path d="M' + f(lx) + " " + f(fy) + "A" + f(r) + " " + f(r) + " 0 0 " + sweep + " " + f(hx) + " " + f(fy + sd * r) + '" fill="none" ' + st + "/>";
      g += '<rect x="' + f(hx - (dir > 0 ? 0 : lt)) + '" y="' + f(Math.min(fy, fy + sd * r)) + '" width="' + f(lt) + '" height="' + f(r) + '" ' + (on ? 'fill="var(--cad-ink)" fill-opacity=".85" stroke="none"' : 'fill="none" ' + st) + "/>";
      return g;
    };
    const pivotLeaf = (fl, ou, on) => {
      const sd = ou ? 1 : -1, pu = la + Math.min(0.26, lw * 0.2), px = xu(pu, fl), lx = xu(lb, fl), hx0 = xu(la, fl), r1 = Math.abs(lx - px), r2 = Math.abs(px - hx0), dir = Math.sign(lx - px) || 1;
      const st = on ? 'stroke="var(--cad-ink)" stroke-width="1.2"' : 'stroke="var(--cad)" stroke-width=".7" stroke-opacity=".38" stroke-dasharray="3 2"';
      let g = '<path d="M' + f(lx) + " " + f(cy) + "A" + f(r1) + " " + f(r1) + " 0 0 " + (dir * sd > 0 ? 1 : 0) + " " + f(px) + " " + f(cy + sd * r1) + '" fill="none" ' + st + "/>";
      g += '<path d="M' + f(hx0) + " " + f(cy) + "A" + f(r2) + " " + f(r2) + " 0 0 " + (dir * sd > 0 ? 1 : 0) + " " + f(px) + " " + f(cy - sd * r2) + '" fill="none" ' + st + "/>";
      g += '<rect x="' + f(px - lt / 2) + '" y="' + f(Math.min(cy - sd * r2, cy + sd * r1)) + '" width="' + f(lt) + '" height="' + f(r1 + r2) + '" ' + (on ? 'fill="var(--cad-ink)" fill-opacity=".85" stroke="none"' : 'fill="none" ' + st) + "/>";
      return g + '<circle cx="' + f(px) + '" cy="' + f(cy) + '" r="2" fill="var(--cad)"/>';
    };
    const candidates = handsOf(s), btn = [], ghosts = [], solid = [];
    const q = (x, y, w, h, c) => {
      const pressed = (c.flip === null || +c.flip === +flip) && (c.out === null || +c.out === +outw);
      btn.push('<rect class="op-q" x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(h) + '" fill="none" pointer-events="all" cursor="pointer"' + (c.flip === null ? "" : ' data-flip="' + c.flip + '"') + (c.out === null ? "" : ' data-out="' + c.out + '"') + ' aria-pressed="' + pressed + '" aria-label="' + c.label + '"><title>' + c.label + "</title></rect>");
      return pressed;
    };
    if (slide) {
      const yb = s.t.surface || s.op === "barn" ? cy + (outw ? 1 : -1) * (ht + 0.05 * k) : cy;
      for (const fl of [0, 1]) {
        const dir = travel(s, fl), on = +fl === +flip, st = on ? 'stroke="var(--cad-ink)" stroke-width="1.2"' : 'stroke="var(--cad)" stroke-width=".7" stroke-opacity=".38" stroke-dasharray="3 2"';
        const sh = (s.op === "slide" ? (s.w - 2 * fw) / 2 : s.w + (s.op === "barn" || s.t.surface ? 0.25 : -2 * fw)) * k * dir;
        const [p0, p1] = s.op === "slide" ? (dir < 0 ? [xo0 + (xo1 - xo0) / 2, xo1 - fw * k] : [xo0 + fw * k, xo0 + (xo1 - xo0) / 2]) : s.op === "pocket" ? [xo0 + fw * k, xo1 - fw * k] : [xo0 - 0.1 * k, xo1 + 0.1 * k];
        const yy = s.op === "slide" ? cy + 0.03 * k : yb;
        const g = '<path d="M' + f(p0 + sh) + " " + f(yy) + "H" + f(p1 + sh) + '" fill="none" ' + st + ' stroke-width="' + (on ? f(lt) : 0.9) + '"/>' + (on ? '<path d="M' + f(p0) + " " + f(yy) + "H" + f(p1) + '" fill="none" stroke="var(--cad-ink)" stroke-width="' + f(lt) + '" stroke-opacity=".45"/>' : "");
        (on ? solid : ghosts).push(g);
        if (on) {
          const ax = (p0 + p1) / 2, ay = yy + (s.op === "slide" ? 9 : yy < cy ? -9 : 9), ex = ax + sh * 0.6;
          solid.push('<path d="M' + f(ax) + " " + f(ay) + "H" + f(ex) + "M" + f(ex - Math.sign(sh) * 4) + " " + f(ay - 3) + "L" + f(ex) + " " + f(ay) + "L" + f(ex - Math.sign(sh) * 4) + " " + f(ay + 3) + '" fill="none" stroke="var(--cad)" stroke-width="1"/>');
        }
      }
      if (s.op === "slide") out.push('<path d="M' + f(xo0 + fw * k) + " " + f(cy - 0.03 * k) + "H" + f(xo0 + (xo1 - xo0) / 2 + 0.02 * k) + '" stroke="var(--cad-ink)" stroke-width="' + f(lt) + '" stroke-opacity=".7" transform="' + (travel(s, flip) < 0 ? "" : "translate(" + f((xo1 - xo0) / 2 - fw * k) + " 0)") + '"/>');
      if (s.op === "pocket") {
        const dir = travel(s, flip), x0 = dir > 0 ? xo1 : xo0 - (s.w - fw) * k;
        out.push('<rect x="' + f(x0) + '" y="' + f(cy - ht * 0.45) + '" width="' + f((s.w - fw) * k) + '" height="' + f(ht * 0.9) + '" fill="var(--cad-bg)" stroke="var(--cad)" stroke-width=".7" stroke-dasharray="3 2"/>');
      }
      for (const c of candidates) q(travel(s, c.flip) < 0 ? 0 : W / 2, 0, W / 2, Hp, c);
    } else if (fold) {
      for (const ou of [0, 1]) {
        const on = +ou === +outw, sd = ou ? 1 : -1, st = on ? 'stroke="var(--cad-ink)" stroke-width="' + f(lt) + '"' : 'stroke="var(--cad)" stroke-width=".8" stroke-opacity=".38" stroke-dasharray="3 2"', n = Math.max(2, ((s.look && s.look.leaves) || (s.w > 1.1 ? 4 : 2)) & ~1), pw = (lb - la) / n;
        // the panels part-folded: one stack at the left jamb, or a stack at each jamb when there are four or more
        const halves = n >= 4 ? 2 : 1, m = n / halves, ang = 0.95, dx = Math.cos(ang) * pw * k, dy = Math.sin(ang) * pw * k;
        let d = "";
        for (let half = 0; half < halves; half++) {
          const x0 = half ? xo1 - fw * k : xo0 + fw * k, dir = half ? -1 : 1;
          d += "M" + f(x0) + " " + f(cy + sd * ht);
          for (let p = 0; p < m; p++) d += "L" + f(x0 + dir * dx * (p + 1)) + " " + f(cy + sd * (ht + (p % 2 ? 0 : dy)));
        }
        (on ? solid : ghosts).push('<path d="' + d + '" fill="none" stroke-linejoin="round" ' + st + "/>");
      }
      for (const c of candidates) q(0, c.out ? cy : 0, W, cy, c);
    } else if (s.op === "roll") {
      out.push('<path d="M' + f(xo0 + 2) + " " + f(cy) + "H" + f(xo1 - 2) + '" stroke="var(--cad-ink)" stroke-width="' + f(lt) + '"/>');
      out.push('<path d="M' + f(xo0 + 4) + " " + f(cy - ht) + "V10M" + f(xo1 - 4) + " " + f(cy - ht) + 'V10" fill="none" stroke="var(--cad)" stroke-width=".8" stroke-dasharray="5 3" stroke-opacity=".6"/>');
    } else if (s.op !== "open") {
      for (const c of candidates) {
        const on = c.flip === null ? +c.out === +outw : +c.flip === +flip && +c.out === +outw;
        const fl = c.flip === null ? flip : c.flip;
        let g;
        if (pivot) g = pivotLeaf(fl, c.out, on);
        else if (pair) g = swingLeaf(fl, c.out, on, la, (la + lb) / 2, true) + swingLeaf(fl, c.out, on, (la + lb) / 2, lb, false);
        else g = swingLeaf(fl, c.out, on, la, lb, true);
        (on ? solid : ghosts).push(g);
        if (c.flip === null) q(0, c.out ? cy : 0, W, cy, c);
        else q(c.flip ? W / 2 : 0, c.out ? cy : 0, W / 2, cy, c);
      }
      if (candidates.length === 4) out.push('<path d="M' + f(W / 2) + " 6V" + f(cy - ht - 2) + "M" + f(W / 2) + " " + f(cy + ht + 2) + "V" + (Hp - 6) + '" stroke="var(--cad)" stroke-width=".5" stroke-opacity=".2"/>');
    }
    const label = esc(opts.label || s.name + ": plan");
    return '<svg class="op-plan" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + Hp + '" width="' + W + '" height="' + Hp + '" role="group" aria-label="' + label + '" font-family="var(--cad-font, system-ui, sans-serif)">' + out.join("") + ghosts.join("") + solid.join("") + btn.join("") + "</svg>";
  }

  G.__openingPreview = { draw, plan, hands, metrics, version: 1 };
})();
