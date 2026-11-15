/* Build mode. Talks to the world engine through window.__game and the window.__build hooks. */
(() => {
  const G = window.__game;
  if (!G) return;
  const T = G.THREE,
    P = G.player,
    W = G.world;
  const $ = (id) => document.getElementById(id);
  const canvas = G.renderer.domElement;

  const WALL_H = 2.7,
    FLOOR_T = 0.12,
    EAVE = 2.84,
    HALF_T = 0.1;
  const COST = { wall: 2, floor: 1, roof: 1, door: 2, window: 1 };
  const TOOLS = [
    { id: "room", name: "Room", hint: "Drag a rectangle for a floor with walls. Drag a straight line for a single wall." },
    { id: "wall", name: "Wall", hint: "Drag a wall at any angle, or click point to point to chain walls. R steps through wall, arches, fence, battlement and castle wall. Castle walls can be walked on: run stairs up beside them." },
    { id: "floor", name: "Floor", hint: "Drag out floor tiles." },
    { id: "door", name: "Door", hint: "Click a wall to hang a door, or a fence for a gate. It opens when you walk up. R switches to a double door or a castle gate." },
    { id: "window", name: "Window", hint: "Click a wall to cut a window. R switches between square, arched, shuttered and arrow slit." },
    { id: "roof", name: "Roof", hint: "Click inside a room or tower to roof it, or drag a rectangle. R changes the roof shape, or over a tower its top." },
    { id: "tower", name: "Tower", hint: "Click a centre and drag outward for a round tower. R sets its height. Towers 4 m or wider get a spiral stair you can climb." },
    { id: "stairs", name: "Stairs", hint: "Drag from the foot of the stairs in the direction they should climb. They reach the next storey." },
    { id: "erase", name: "Remove", hint: "Click a piece to remove it, or drag a box to clear an area." },
  ];
  TOOLS.push({ id: "pillar", name: "Pillar", hint: "Click to stand a pillar. Pillars within 4 m of each other are joined by a beam. R switches to a chimney." });
  TOOLS.push({ id: "path", key: "L", name: "Path", hint: "Drag a path or road over the ground, or click point to point. It follows the land. R sets the width, M the surface." });
  TOOLS.push({ id: "decor", key: "F", name: "Furnish", hint: "Pick a piece below and click to place it. R turns it, M changes its colour, comma and full stop step through the pieces. Wall pieces snap to walls." });
  TOOLS.push({ id: "copy", key: "K", name: "Copy", hint: "Click a building to pick it up, then click wherever you want copies. R turns the copy. Right-click or Esc puts it down." });
  const ICONS = {
    pillar: '<path d="M8 20h8M9 20V6M15 20V6M7 6h10M8 4h8"/>',
    path: '<path d="M9 21c0-5 6-5 6-9s-5-4-5-9M14 21c0-4 6-4 6-9"/>',
    copy: '<rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/>',
    decor: '<path d="M5 20v-6h14v6M7 14V9h10v5M5 17h14M9 9V6h6v3"/>',
    room: '<rect x="4" y="5" width="16" height="14"/><path d="M4 12h3M17 12h3" opacity=".5"/>',
    wall: '<path d="M3 17h18M5 17V8M19 17V8M5 8h14M12 8v9"/>',
    floor: '<path d="M4 6h16v12H4zM4 10h16M4 14h16M10 6v4M15 10v4M8 14v4"/>',
    door: '<path d="M7 20V5h10v15M5 20h14"/><circle cx="14.2" cy="13" r=".9" fill="currentColor"/>',
    window: '<rect x="5" y="6" width="14" height="12"/><path d="M12 6v12M5 12h14"/>',
    roof: '<path d="M3 13l9-8 9 8M6 11v8h12v-8"/>',
    tower: '<path d="M7 20V10M17 20V10M5 20h14M6 10l6-7 6 7zM11 20v-4h2v4"/>',
    stairs: '<path d="M4 19h4v-4h4v-4h4V7h4"/>',
    erase: '<path d="M6 6l12 12M18 6L6 18"/>',
  };

  const B = {
    on: false,
    tool: "room",
    free: true,
    structs: [],
    drag: null,
    hover: null,
    undo: [],
    redo: [],
    flip: false,
    levels: 2,
    level: 0,
    hs: 1,
    lift: 0,
    style: "wall",
    wstyle: "window",
    pkind: "pillar",
    dstyle: "door",
    rshape: 0,
    tshape: "cone",
    pwidth: 2,
    pmat: "cobble",
    clipb: null,
    dkind: "bed",
    drot: 0,
    dcol: 0,
    idleT: 0,
    smokeT: 0,
    mood: "",
    clipN: 0,
    seed: undefined,
    saveT: 0,
    savedV: 0,
    wmat: "timber",
    fmat: "planks",
    rmat: "thatch",
    stairDir: 0,
    prevTool: "axe",
    pending: { ox: 0, oz: 0, yaw: 0, y0: 0, isNew: true },
    ptr: { x: 0, y: 0, rx: 0, ry: 0 },
    alt: false,
    key: "",
    op: null,
    version: 0,
    nextId: 1,
    sheltered: false,
  };

  /* ---------- small helpers ---------- */
  const isWin = (t) => !!t && t.startsWith("window");
  const isArch = (t) => !!t && t.startsWith("arch");
  const isLow = (t) => t === "rail" || t === "parapet" || t === "railgate";
  const isDoor = (t) => t === "door" || t === "door2" || t === "gate" || t === "railgate";
  const isThick = (t) => t === "rampart" || t === "gate";
  const blocks = (t, isPlayer, low) => t === "wall" || t === "rampart" || t === "parapet" || t === "rail" || isWin(t) || (isDoor(t) && (!isPlayer || low));
  const append = (a, b) => {
    for (let n = 0; n < b.length; n++) a.push(b[n]);
  };
  // storeys taller than normal keep their stone footing and stretch the rest
  const stretchY = (y, hs) => {
    if (hs === 1 || y <= 0.3) return y;
    const l = Math.floor(y / EAVE + 1e-6),
      w = y - l * EAVE,
      k = (EAVE * hs - 0.3) / (EAVE - 0.3);
    return l * EAVE * hs + (w <= 0.3 ? w : 0.3 + (w - 0.3) * k);
  };
  const ck = (i, j) => i + "," + j;
  const ek = (i, j, d) => i + "," + j + "," + d;
  const parse = (k) => k.split(",").map(Number);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hash = (a, b, c) => {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  function toLocal(F, x, z) {
    const dx = x - F.ox,
      dz = z - F.oz,
      c = Math.cos(F.yaw),
      s = Math.sin(F.yaw);
    return [dx * c - dz * s, dx * s + dz * c];
  }
  function toWorld(F, lx, lz) {
    const c = Math.cos(F.yaw),
      s = Math.sin(F.yaw);
    return [F.ox + lx * c + lz * s, F.oz - lx * s + lz * c];
  }
  const col = (hex) => {
    const c = new T.Color(hex);
    return [c.r, c.g, c.b];
  };
  const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const C = {
    plank: col(0x8f6d44),
    beam: col(0x57402a),
    stone: col(0x8b8880),
    floor: col(0xa98858),
    thatch: col(0xb89b52),
    door: col(0x6f4d2c),
    gable: col(0x86663f),
  };

  const WALLS = {
    timber: { name: "Timber", plank: C.plank, beam: C.beam, stone: C.stone },
    stone: { name: "Stone", plank: col(0x8f8c84), beam: col(0x6d6a62), stone: col(0x77746c), courses: true },
    plaster: { name: "Plaster", plank: col(0xd9cfb6), beam: col(0x4a3625), stone: C.stone, flat: true },
    dark: { name: "Dark wood", plank: col(0x4f3a28), beam: col(0x2e2118), stone: C.stone },
    brick: { name: "Brick", plank: col(0x9a5a44), beam: col(0x6b4034), stone: col(0x7c6a60), courses: true },
    halftimber: { name: "Half-timber", plank: col(0xe4dcc6), beam: col(0x3d2c1f), stone: C.stone, flat: true, brace: true },
    sandstone: { name: "Sandstone", plank: col(0xc9ab7a), beam: col(0x9a8058), stone: col(0xa88d62), courses: true },
    whitestone: { name: "White stone", plank: col(0xd8d6cf), beam: col(0xa9a69c), stone: col(0xb9b6ad), courses: true },
    mossy: { name: "Mossy stone", plank: col(0x6f7a66), beam: col(0x545c4d), stone: col(0x5d6656), courses: true },
    log: { name: "Log", plank: col(0x7a5a3a), beam: col(0x4b3724), stone: C.stone, courses: true },
  };
  const PATHS = { cobble: { name: "Cobbles", c: col(0x8e8a80) }, dirt: { name: "Packed earth", c: col(0x8a6b47) }, gravel: { name: "Gravel", c: col(0xb5ad9c) }, boards: { name: "Boardwalk", c: col(0x9b7b4f) } };
  const FLOORS = { planks: { name: "Planks", c: C.floor }, flags: { name: "Flagstone", c: col(0x9a968c) }, dark: { name: "Dark boards", c: col(0x6b5238) }, tile: { name: "Clay tiles", c: col(0xb4654a), c2: col(0xc98a62) }, marble: { name: "Marble", c: col(0xd9d6cf), c2: col(0x4c4f55) }, cobble: { name: "Cobbles", c: col(0x86837b), c2: col(0x77746c) }, carpet: { name: "Red carpet", c: col(0x8c2f2c) }, moss: { name: "Lawn", c: col(0x5f8a3c) } };
  const ROOFS = { thatch: { name: "Thatch", c: C.thatch }, slate: { name: "Slate", c: col(0x56616c) }, tile: { name: "Clay tile", c: col(0xa9573b) }, shingle: { name: "Wood shingle", c: col(0x6a4f37) }, copper: { name: "Green copper", c: col(0x5fa08a) }, redslate: { name: "Red slate", c: col(0x7b3b3b) } };
  let PAL = WALLS.timber,
    RPAL = C.thatch;

  /* ---------- geometry ---------- */
  class Geo {
    constructor() {
      this.p = [];
      this.n = [];
      this.c = [];
    }
    tri(a, b, c, n, colr) {
      // keep the winding in step with the normal, so lighting is right on both sides
      const ux = b[0] - a[0],
        uy = b[1] - a[1],
        uz = b[2] - a[2],
        vx = c[0] - a[0],
        vy = c[1] - a[1],
        vz = c[2] - a[2];
      if ((uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0) {
        const t = b;
        b = c;
        c = t;
      }
      const yo = this.yo || 0;
      this.p.push(a[0], a[1] + yo, a[2], b[0], b[1] + yo, b[2], c[0], c[1] + yo, c[2]);
      for (let i = 0; i < 3; i++) (this.n.push(n[0], n[1], n[2]), this.c.push(colr[0], colr[1], colr[2]));
    }
    tp(p) {
      const f = this.xf,
        x = p[0] * f.su;
      return [f.ox + x * f.c + p[2] * f.s, p[1] + f.oy, f.oz - x * f.s + p[2] * f.c];
    }
    tv(v) {
      const f = this.xf,
        x = v[0] * f.su;
      return [x * f.c + v[2] * f.s, v[1], -x * f.s + v[2] * f.c];
    }
    obox(c, U, V, Wv, colr) {
      if (this.xf) {
        c = this.tp(c);
        U = this.tv(U);
        V = this.tv(V);
        Wv = this.tv(Wv);
      }
      const faces = [
        [U, V, Wv, 1],
        [U, Wv, V, -1],
        [V, Wv, U, 1],
        [V, U, Wv, -1],
        [Wv, U, V, 1],
        [Wv, V, U, -1],
      ];
      for (const [N, A, Bv, sg] of faces) {
        const len = Math.hypot(N[0], N[1], N[2]) || 1;
        const n = [(N[0] / len) * sg, (N[1] / len) * sg, (N[2] / len) * sg];
        const v = (sa, sb) => [
          c[0] + N[0] * sg + A[0] * sa + Bv[0] * sb,
          c[1] + N[1] * sg + A[1] * sa + Bv[1] * sb,
          c[2] + N[2] * sg + A[2] * sa + Bv[2] * sb,
        ];
        const p0 = v(-1, -1),
          p1 = v(1, -1),
          p2 = v(1, 1),
          p3 = v(-1, 1);
        this.tri(p0, p1, p2, n, colr);
        this.tri(p0, p2, p3, n, colr);
      }
    }
    abox(x0, y0, z0, x1, y1, z1, colr) {
      this.obox(
        [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
        [(x1 - x0) / 2, 0, 0],
        [0, (y1 - y0) / 2, 0],
        [0, 0, (z1 - z0) / 2],
        colr,
      );
    }
    // triangle with its own normals and colours, for rounded and draped shapes
    triS(a, b, c, na, nb, nc, ca, cb, cc) {
      const ux = b[0] - a[0],
        uy = b[1] - a[1],
        uz = b[2] - a[2],
        vx = c[0] - a[0],
        vy = c[1] - a[1],
        vz = c[2] - a[2];
      if ((uy * vz - uz * vy) * (na[0] + nb[0] + nc[0]) + (uz * vx - ux * vz) * (na[1] + nb[1] + nc[1]) + (ux * vy - uy * vx) * (na[2] + nb[2] + nc[2]) < 0) {
        let t = b;
        b = c;
        c = t;
        t = nb;
        nb = nc;
        nc = t;
        t = cb;
        cb = cc;
        cc = t;
      }
      this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      this.n.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
      this.c.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
    }
    // round or tapering log between two points; e squashes it into an oval
    cyl(p0, p1, r0, r1, n, c0, c1, capC, e = 1) {
      c1 = c1 || c0;
      const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]],
        len = Math.hypot(d[0], d[1], d[2]) || 1,
        ax = [d[0] / len, d[1] / len, d[2] / len],
        ref = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      let u = [ax[1] * ref[2] - ax[2] * ref[1], ax[2] * ref[0] - ax[0] * ref[2], ax[0] * ref[1] - ax[1] * ref[0]];
      const ul = Math.hypot(u[0], u[1], u[2]);
      u = [u[0] / ul, u[1] / ul, u[2] / ul];
      const v = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
      const A = [],
        Bq = [],
        N = [];
      for (let k = 0; k < n; k++) {
        const an = (k / n) * Math.PI * 2,
          cs = Math.cos(an),
          sn = Math.sin(an) * e,
          dir = [u[0] * cs + v[0] * sn, u[1] * cs + v[1] * sn, u[2] * cs + v[2] * sn];
        A.push([p0[0] + dir[0] * r0, p0[1] + dir[1] * r0, p0[2] + dir[2] * r0]);
        Bq.push([p1[0] + dir[0] * r1, p1[1] + dir[1] * r1, p1[2] + dir[2] * r1]);
        const nx = dir[0] * len + ax[0] * (r0 - r1),
          ny = dir[1] * len + ax[1] * (r0 - r1),
          nz = dir[2] * len + ax[2] * (r0 - r1),
          nl = Math.hypot(nx, ny, nz) || 1;
        N.push([nx / nl, ny / nl, nz / nl]);
      }
      const back = [-ax[0], -ax[1], -ax[2]];
      for (let k = 0; k < n; k++) {
        const m = (k + 1) % n;
        if (r0 > 0) this.triS(A[k], A[m], Bq[m], N[k], N[m], N[m], c0, c0, c1);
        if (r1 > 0) this.triS(A[k], Bq[m], Bq[k], N[k], N[m], N[k], c0, c1, c1);
        if (r0 > 0 && capC !== false) this.tri(p0, A[m], A[k], back, capC || c0);
        if (r1 > 0 && capC !== false) this.tri(p1, Bq[k], Bq[m], ax, capC || c1);
      }
    }
    // hewn timber: a beam with chamfered edges that catch the light
    beam(p0, p1, w, h, colr, bev = 0.22) {
      const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]],
        len = Math.hypot(d[0], d[1], d[2]) || 1,
        ax = [d[0] / len, d[1] / len, d[2] / len],
        ref = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      let s = [ax[1] * ref[2] - ax[2] * ref[1], ax[2] * ref[0] - ax[0] * ref[2], ax[0] * ref[1] - ax[1] * ref[0]];
      const sl = Math.hypot(s[0], s[1], s[2]);
      s = [s[0] / sl, s[1] / sl, s[2] / sl];
      const up = [s[1] * ax[2] - s[2] * ax[1], s[2] * ax[0] - s[0] * ax[2], s[0] * ax[1] - s[1] * ax[0]];
      const hw = w / 2,
        hh = h / 2,
        b = bev * Math.min(hw, hh);
      const prof = [
        [hw - b, hh],
        [hw, hh - b],
        [hw, -hh + b],
        [hw - b, -hh],
        [-hw + b, -hh],
        [-hw, -hh + b],
        [-hw, hh - b],
        [-hw + b, hh],
      ];
      const at = (p, q) => [p[0] + s[0] * q[0] + up[0] * q[1], p[1] + s[1] * q[0] + up[1] * q[1], p[2] + s[2] * q[0] + up[2] * q[1]];
      const tone = [1.14, 0.92, 1.1, 0.74, 1.1, 0.92, 1.14, 1.04];
      const back = [-ax[0], -ax[1], -ax[2]],
        capc = shade(colr, 0.86);
      for (let k = 0; k < 8; k++) {
        const q0 = prof[k],
          q1 = prof[(k + 1) % 8],
          ex = q1[0] - q0[0],
          ey = q1[1] - q0[1],
          el = Math.hypot(ex, ey) || 1,
          fn = [(s[0] * -ey + up[0] * ex) / el, (s[1] * -ey + up[1] * ex) / el, (s[2] * -ey + up[2] * ex) / el],
          nrm = fn,
          cc = shade(colr, tone[k]);
        const A0 = at(p0, q0),
          A1 = at(p0, q1),
          B0 = at(p1, q0),
          B1 = at(p1, q1);
        this.tri(A0, A1, B1, nrm, cc);
        this.tri(A0, B1, B0, nrm, cc);
        this.tri(p0, A1, A0, back, capc);
        this.tri(p1, B0, B1, ax, capc);
      }
    }
    // a lump: smooth for sacks and cushions, faceted and uneven for stones and leaves
    ball(c, rx, ry, rz, colr, o = {}) {
      const lat = o.lat || 4,
        lon = o.lon || 7,
        jit = o.jit || 0,
        sd = o.seed || 1,
        rows = [];
      for (let a = 0; a <= lat; a++) {
        const row = [];
        for (let b = 0; b < lon; b++) {
          const th = (a / lat) * Math.PI,
            ph = (b / lon) * Math.PI * 2 + (a % 2) * (Math.PI / lon),
            k = a > 0 && a < lat ? 1 + jit * (hash(sd, a * 7 + b, 3) - 0.5) * 2 : 1,
            nx = Math.sin(th) * Math.cos(ph),
            ny = Math.cos(th),
            nz = Math.sin(th) * Math.sin(ph),
            mx = nx / rx,
            my = ny / ry,
            mz = nz / rz,
            ml = Math.hypot(mx, my, mz) || 1;
          row.push([[c[0] + nx * rx * k, c[1] + ny * ry * k, c[2] + nz * rz * k], [mx / ml, my / ml, mz / ml]]);
        }
        rows.push(row);
      }
      for (let a = 0; a < lat; a++)
        for (let b = 0; b < lon; b++) {
          const q00 = rows[a][b],
            q01 = rows[a][(b + 1) % lon],
            q10 = rows[a + 1][b],
            q11 = rows[a + 1][(b + 1) % lon],
            c0 = shade(colr, 1.08 - 0.3 * (a / lat) + (o.flat ? 0.12 * (hash(sd, a * 13 + b, 9) - 0.5) : 0)),
            c1 = o.flat ? c0 : shade(colr, 1.08 - 0.3 * ((a + 1) / lat));
          if (o.flat) {
            const nA = [q00[1][0] + q10[1][0] + q11[1][0], q00[1][1] + q10[1][1] + q11[1][1], q00[1][2] + q10[1][2] + q11[1][2]],
              la = Math.hypot(nA[0], nA[1], nA[2]) || 1,
              nB = [q00[1][0] + q11[1][0] + q01[1][0], q00[1][1] + q11[1][1] + q01[1][1], q00[1][2] + q11[1][2] + q01[1][2]],
              lb = Math.hypot(nB[0], nB[1], nB[2]) || 1;
            this.tri(q00[0], q10[0], q11[0], [nA[0] / la, nA[1] / la, nA[2] / la], c0);
            this.tri(q00[0], q11[0], q01[0], [nB[0] / lb, nB[1] / lb, nB[2] / lb], shade(c0, 0.94));
          } else {
            this.triS(q00[0], q10[0], q11[0], q00[1], q10[1], q11[1], c0, c1, c1);
            this.triS(q00[0], q11[0], q01[0], q00[1], q11[1], q01[1], c0, c1, c0);
          }
        }
    }
    // cloth, thatch, fur: a surface from a function of (u, v), smoothly shaded
    surf(nu, nv, fn, cf, crisp) {
      const P = [],
        N = [];
      for (let i = 0; i <= nu; i++) {
        P.push([]);
        for (let j = 0; j <= nv; j++) P[i].push(fn(i / nu, j / nv));
      }
      for (let i = 0; i <= nu; i++) {
        N.push([]);
        for (let j = 0; j <= nv; j++) {
          const a = P[Math.max(0, i - 1)][j],
            b = P[Math.min(nu, i + 1)][j],
            c = P[i][Math.max(0, j - 1)],
            d = P[i][Math.min(nv, j + 1)],
            ux = b[0] - a[0],
            uy = b[1] - a[1],
            uz = b[2] - a[2],
            vx = d[0] - c[0],
            vy = d[1] - c[1],
            vz = d[2] - c[2];
          let n = [vy * uz - vz * uy, vz * ux - vx * uz, vx * uy - vy * ux];
          const nl = Math.hypot(n[0], n[1], n[2]);
          // where the surface pinches to a point there is no normal to compute: face it upward. (A zero normal
          // lights as "not a number", and the bloom pass then smears that one pixel over the whole screen.)
          N[i].push(nl > 1e-9 ? [n[0] / nl, n[1] / nl, n[2] / nl] : [0, 1, 0]);
        }
      }
      for (let i = 0; i < nu; i++)
        for (let j = 0; j < nv; j++) {
          const mid = crisp ? cf((i + 0.5) / nu, (j + 0.5) / nv) : null,
            c00 = mid || cf(i / nu, j / nv),
            c10 = mid || cf((i + 1) / nu, j / nv),
            c01 = mid || cf(i / nu, (j + 1) / nv),
            c11 = mid || cf((i + 1) / nu, (j + 1) / nv);
          this.triS(P[i][j], P[i + 1][j], P[i + 1][j + 1], N[i][j], N[i + 1][j], N[i + 1][j + 1], c00, c10, c11);
          this.triS(P[i][j], P[i + 1][j + 1], P[i][j + 1], N[i][j], N[i + 1][j + 1], N[i][j + 1], c00, c11, c01);
        }
    }
    // four-sided block that narrows or widens upward
    frust(cx, cz, y0, y1, hx0, hz0, hx1, hz1, colr) {
      const b = [
          [cx - hx0, y0, cz - hz0],
          [cx + hx0, y0, cz - hz0],
          [cx + hx0, y0, cz + hz0],
          [cx - hx0, y0, cz + hz0],
        ],
        t = [
          [cx - hx1, y1, cz - hz1],
          [cx + hx1, y1, cz - hz1],
          [cx + hx1, y1, cz + hz1],
          [cx - hx1, y1, cz + hz1],
        ],
        nr = [
          [0, 0.2, -1],
          [1, 0.2, 0],
          [0, 0.2, 1],
          [-1, 0.2, 0],
        ];
      for (let k = 0; k < 4; k++) {
        const m = (k + 1) % 4,
          cc = shade(colr, k % 2 ? 0.9 : 1);
        this.tri(b[k], b[m], t[m], nr[k], cc);
        this.tri(b[k], t[m], t[k], nr[k], cc);
      }
      this.tri(t[0], t[1], t[2], [0, 1, 0], shade(colr, 1.08));
      this.tri(t[0], t[2], t[3], [0, 1, 0], shade(colr, 1.08));
    }
    build() {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute("normal", new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute("color", new T.Float32BufferAttribute(this.c, 3));
      g.computeBoundingSphere();
      return g;
    }
  }

  // box along a unit edge: t0..t1 along it, +-half across it
  function ebox(g, i, j, d, t0, t1, y0, y1, half, colr) {
    if (d === 0) g.abox(i + t0, y0, j - half, i + t1, y1, j + half, colr);
    else g.abox(i - half, y0, j + t0, i + half, y1, j + t1, colr);
  }

  function wallPieces(g, i, j, d, type, depth, si = i, sj = j) {
    const hs = (k) => 0.9 + 0.2 * hash(si * 7 + k, sj * 13 + d, 5);
    const planks = (ya, yb) => {
      if (PAL.courses) {
        const rows = Math.max(1, Math.round((yb - ya) / 0.34)),
          hh = (yb - ya) / rows;
        for (let r = 0; r < rows; r++) {
          const jt = r % 2 ? 0.36 : 0.64;
          ebox(g, i, j, d, 0, jt, ya + r * hh, ya + (r + 1) * hh, 0.074 - (r % 2) * 0.006, shade(PAL.plank, hs(r * 2)));
          ebox(g, i, j, d, jt, 1, ya + r * hh, ya + (r + 1) * hh, 0.068 + (r % 2) * 0.006, shade(PAL.plank, hs(r * 2 + 1)));
        }
      } else if (PAL.flat) {
        ebox(g, i, j, d, 0, 1, ya, yb, 0.06, shade(PAL.plank, 0.97 + 0.05 * hs(1)));
        ebox(g, i, j, d, 0.46, 0.54, ya, yb, 0.075, PAL.beam);
        if (PAL.brace && yb - ya > 1.4) {
          const h2 = (yb - ya) / 2,
            sg = (si + sj + d) & 1 ? 1 : -1,
            kk = 0.045 / Math.hypot(0.48, h2);
          const ev = (t, y, o) => (d === 0 ? [t, y, o] : [o, y, t]);
          g.obox(d === 0 ? [i + 0.5, (ya + yb) / 2, j] : [i, (ya + yb) / 2, j + 0.5], ev(0.47, sg * h2 * 0.97, 0), ev(-sg * h2 * kk, 0.48 * kk, 0), ev(0, 0, 0.076), PAL.beam);
        }
      } else for (let k = 0; k < 4; k++) ebox(g, i, j, d, k / 4, (k + 1) / 4, ya, yb, 0.068 + (k % 2) * 0.006, shade(PAL.plank, hs(k)));
    };
    const ob = (t0, t1, ya, yb, off, half, colr) => (d === 0 ? g.abox(i + t0, ya, j + off - half, i + t1, yb, j + off + half, colr) : g.abox(i + off - half, ya, j + t0, i + off + half, yb, j + t1, colr));
    const sc = PAL.courses ? PAL.plank : PAL.stone;
    const foot = () => ebox(g, i, j, d, 0, 1, -depth, 0.3, 0.13, shade(PAL.stone, 0.92 + 0.16 * hash(i, j, d + 9)));
    const cap = () => ebox(g, i, j, d, 0, 1, WALL_H, EAVE, 0.095, PAL.beam);
    if (type === "parapet") {
      ebox(g, i, j, d, 0, 1, -depth, 0.06, 0.16, shade(sc, 0.78));
      for (let r = 0; r < 3; r++) {
        const jt = r % 2 ? 0.38 : 0.62;
        ebox(g, i, j, d, 0, jt, 0.06 + r * 0.3, 0.36 + r * 0.3, 0.13, shade(sc, hs(r * 2)));
        ebox(g, i, j, d, jt, 1, 0.06 + r * 0.3, 0.36 + r * 0.3, 0.124, shade(sc, hs(r * 2 + 1)));
      }
      ebox(g, i, j, d, 0.25, 0.75, 0.96, 1.5, 0.13, shade(sc, hs(7)));
      return;
    }
    if (type === "rampart" || type === "gate") {
      const gate = type === "gate",
        rows = 6,
        hh = (EAVE - 0.4) / rows;
      if (gate) {
        ob(0, 0.1, -depth, 0.4, 0, 0.52, shade(sc, 0.74));
        ob(0.9, 1, -depth, 0.4, 0, 0.52, shade(sc, 0.74));
        ob(0, 1, -depth, 0.03, 0, 0.52, shade(sc, 0.6));
        ob(0.1, 0.22, 1.72, 2.03, 0, 0.5, shade(sc, 0.8));
        ob(0.78, 0.9, 1.72, 2.03, 0, 0.5, shade(sc, 0.8));
      } else ob(0, 1, -depth, 0.4, 0, 0.52, shade(sc, 0.74));
      for (let r = 0; r < rows; r++) {
        const ya = 0.4 + r * hh,
          yb = ya + hh,
          jt = r % 2 ? 0.36 : 0.64;
        if (gate && yb < 2.35) {
          ob(0, 0.1, ya, yb, 0, 0.5, shade(sc, hs(r * 2)));
          ob(0.9, 1, ya, yb, 0, 0.5, shade(sc, hs(r * 2 + 1)));
        } else {
          ob(0, jt, ya, yb, 0, 0.5 - (r % 2) * 0.008, shade(sc, hs(r * 2)));
          ob(jt, 1, ya, yb, 0, 0.492 + (r % 2) * 0.008, shade(sc, hs(r * 2 + 1)));
        }
      }
      ob(0, 1, EAVE - 0.02, EAVE + 0.03, 0, 0.5, shade(sc, 0.7));
      for (const off of [-0.43, 0.43]) {
        ob(0, 1, EAVE + 0.03, EAVE + 0.5, off, 0.08, shade(sc, hs(11)));
        ob(0.25, 0.75, EAVE + 0.5, EAVE + 1.0, off, 0.08, shade(sc, hs(12)));
      }
      return;
    }
    if (type === "railgate") {
      ebox(g, i, j, d, 0, 1, -depth, 0.04, 0.1, PAL.stone);
      for (const t of [0.045, 0.955]) ebox(g, i, j, d, t - 0.045, t + 0.045, 0.04, 1.14, 0.05, PAL.beam);
      return;
    }
    if (type === "window3") {
      foot();
      planks(0.3, 0.95);
      planks(2.15, WALL_H);
      ebox(g, i, j, d, 0, 0.43, 0.95, 2.15, 0.07, shade(PAL.plank, hs(0)));
      ebox(g, i, j, d, 0.57, 1, 0.95, 2.15, 0.07, shade(PAL.plank, hs(2)));
      ebox(g, i, j, d, 0.39, 0.61, 0.89, 0.96, 0.09, PAL.beam);
      ebox(g, i, j, d, 0.39, 0.61, 2.14, 2.21, 0.09, PAL.beam);
      cap();
      return;
    }
    if (type === "window4") {
      foot();
      planks(0.3, 1.05);
      planks(1.95, WALL_H);
      ebox(g, i, j, d, 0, 0.3, 1.05, 1.95, 0.07, shade(PAL.plank, hs(0)));
      ebox(g, i, j, d, 0.7, 1, 1.05, 1.95, 0.07, shade(PAL.plank, hs(3)));
      ebox(g, i, j, d, 0.26, 0.74, 1.03, 1.11, 0.11, PAL.beam);
      ebox(g, i, j, d, 0.26, 0.74, 1.89, 1.97, 0.1, PAL.beam);
      ebox(g, i, j, d, 0.28, 0.33, 1.05, 1.95, 0.09, PAL.beam);
      ebox(g, i, j, d, 0.67, 0.72, 1.05, 1.95, 0.09, PAL.beam);
      ebox(g, i, j, d, 0.49, 0.51, 1.11, 1.89, 0.03, PAL.beam);
      for (const off of [-0.1, 0.1]) {
        ob(0.07, 0.27, 1.08, 1.92, off, 0.02, shade(C.door, 0.9));
        ob(0.73, 0.93, 1.08, 1.92, off, 0.02, shade(C.door, 0.9));
        ob(0.24, 0.76, 0.86, 1.02, off * 2.1, 0.08, shade(C.beam, 1.15));
        const fl = [
          [0.86, 0.26, 0.3],
          [0.95, 0.8, 0.32],
          [0.9, 0.52, 0.72],
          [0.34, 0.58, 0.27],
        ];
        for (let k = 0; k < 6; k++) ob(0.27 + k * 0.08, 0.33 + k * 0.08, 1.02, 1.1 + 0.05 * hs(k), off * 2.1, 0.05, fl[(k + (si & 3)) % 4]);
      }
      cap();
      return;
    }
    if (type === "door2") {
      ebox(g, i, j, d, 0, 1, -depth, 0.05, 0.13, PAL.stone);
      ebox(g, i, j, d, 0, 0.05, 0.05, 2.3, 0.1, PAL.beam);
      ebox(g, i, j, d, 0.95, 1, 0.05, 2.3, 0.1, PAL.beam);
      ebox(g, i, j, d, 0, 1, 2.24, 2.36, 0.11, PAL.beam);
      planks(2.36, WALL_H);
      cap();
      return;
    }
    if (type === "rail") {
      ebox(g, i, j, d, 0, 1, -depth, 0.04, 0.1, PAL.stone);
      ebox(g, i, j, d, 0, 1, 0.94, 1.02, 0.06, PAL.beam);
      ebox(g, i, j, d, 0, 1, 0.5, 0.56, 0.035, PAL.beam);
      for (const t of [0.03, 0.27, 0.5, 0.73, 0.97]) ebox(g, i, j, d, t - 0.03, t + 0.03, 0.04, 0.94, 0.035, shade(PAL.plank, hs(Math.round(t * 9))));
      return;
    }
    if (type === "window2") {
      ebox(g, i, j, d, 0, 1, -depth, 0.3, 0.13, shade(PAL.stone, 0.92 + 0.16 * hash(i, j, d + 9)));
      planks(0.3, 0.8);
      ebox(g, i, j, d, 0, 0.24, 0.8, WALL_H, 0.07, shade(PAL.plank, hs(0)));
      ebox(g, i, j, d, 0.76, 1, 0.8, WALL_H, 0.07, shade(PAL.plank, hs(3)));
      for (let k = 0; k < 6; k++) {
        const u0 = k / 6,
          u1 = (k + 1) / 6,
          yb = 1.78 + 0.42 * Math.sin(Math.PI * ((k + 0.5) / 6));
        ebox(g, i, j, d, 0.24 + 0.52 * u0, 0.24 + 0.52 * u1, yb, WALL_H, 0.07, shade(PAL.plank, hs(k % 4)));
        ebox(g, i, j, d, 0.24 + 0.52 * u0, 0.24 + 0.52 * u1, yb - 0.07, yb, 0.09, PAL.beam);
      }
      ebox(g, i, j, d, 0.2, 0.8, 0.78, 0.86, 0.12, PAL.beam);
      ebox(g, i, j, d, 0.2, 0.26, 0.86, 1.8, 0.09, PAL.beam);
      ebox(g, i, j, d, 0.74, 0.8, 0.86, 1.8, 0.09, PAL.beam);
      ebox(g, i, j, d, 0.48, 0.52, 0.86, 2.15, 0.03, PAL.beam);
      ebox(g, i, j, d, 0, 1, WALL_H, EAVE, 0.095, PAL.beam);
      return;
    }
    if (isArch(type)) {
      ebox(g, i, j, d, 0, 1, -depth, 0.05, 0.13, PAL.stone);
      ebox(g, i, j, d, 0, 0.11, 0.05, WALL_H, 0.1, PAL.beam);
      ebox(g, i, j, d, 0.89, 1, 0.05, WALL_H, 0.1, PAL.beam);
      for (let k = 0; k < 8; k++) {
        const u0 = k / 8,
          u1 = (k + 1) / 8,
          uu = (k + 0.5) / 8,
          yb = type === "arch2" ? 1.5 + 1.0 * (1 - Math.abs(2 * uu - 1)) ** 0.8 : type === "arch3" ? 1.8 + 0.35 * Math.min(1, Math.min(uu, 1 - uu) / 0.2) : 1.72 + 0.62 * Math.sin(Math.PI * uu);
        ebox(g, i, j, d, 0.11 + 0.78 * u0, 0.11 + 0.78 * u1, yb, WALL_H, 0.07, shade(PAL.plank, hs(k % 4)));
        ebox(g, i, j, d, 0.11 + 0.78 * u0, 0.11 + 0.78 * u1, yb - 0.09, yb, 0.085, PAL.beam);
      }
      ebox(g, i, j, d, 0, 1, WALL_H, EAVE, 0.095, PAL.beam);
      return;
    }
    if (type === "door") {
      ebox(g, i, j, d, 0, 1, -depth, 0.05, 0.13, PAL.stone);
      ebox(g, i, j, d, 0, 0.09, 0.05, 2.1, 0.095, PAL.beam);
      ebox(g, i, j, d, 0.91, 1, 0.05, 2.1, 0.095, PAL.beam);
      ebox(g, i, j, d, 0, 1, 2.04, 2.14, 0.1, PAL.beam);
      planks(2.14, WALL_H);
    } else {
      ebox(g, i, j, d, 0, 1, -depth, 0.3, 0.13, shade(PAL.stone, 0.92 + 0.16 * hash(i, j, d + 9)));
      if (type === "window") {
        planks(0.3, 1.05);
        planks(1.95, WALL_H);
        ebox(g, i, j, d, 0.04, 0.96, 1.03, 1.11, 0.11, PAL.beam);
        ebox(g, i, j, d, 0.04, 0.96, 1.89, 1.97, 0.1, PAL.beam);
        ebox(g, i, j, d, 0, 0.1, 1.05, 1.95, 0.09, PAL.beam);
        ebox(g, i, j, d, 0.9, 1, 1.05, 1.95, 0.09, PAL.beam);
        ebox(g, i, j, d, 0.475, 0.525, 1.11, 1.89, 0.03, PAL.beam);
        ebox(g, i, j, d, 0.1, 0.9, 1.475, 1.525, 0.03, PAL.beam);
      } else planks(0.3, WALL_H);
    }
    ebox(g, i, j, d, 0, 1, WALL_H, EAVE, 0.095, PAL.beam);
  }

  // one sloping face, from the eave edge e0-e1 up to p0-p1 (which may be a single point)
  function roofFace(rg, e0, e1, p0, p1, seed) {
    const mx = (p0[0] + p1[0] - e0[0] - e1[0]) / 2,
      my = (p0[1] + p1[1] - e0[1] - e1[1]) / 2,
      mz = (p0[2] + p1[2] - e0[2] - e1[2]) / 2;
    const ex = e1[0] - e0[0],
      ey = e1[1] - e0[1],
      ez = e1[2] - e0[2];
    let n = [ey * mz - ez * my, ez * mx - ex * mz, ex * my - ey * mx];
    const nl = Math.hypot(n[0], n[1], n[2]) || 1,
      s = n[1] < 0 ? -1 : 1;
    n = [(n[0] / nl) * s, (n[1] / nl) * s, (n[2] / nl) * s];
    const bands = Math.max(2, Math.ceil(Math.hypot(mx, my, mz) / 0.5));
    const L = (a, b, t, up) => [a[0] + (b[0] - a[0]) * t + n[0] * up, a[1] + (b[1] - a[1]) * t + n[1] * up, a[2] + (b[2] - a[2]) * t + n[2] * up];
    for (let b = 0; b < bands; b++) {
      const t0 = b / bands,
        t1 = Math.min(1, (b + 1) / bands + 0.02),
        up = 0.02 + (b % 2) * 0.03,
        colr = shade(RPAL, 0.84 + 0.2 * hash(seed, b, 3) - 0.1 * t0);
      rg.tri(L(e0, p0, t0, up), L(e1, p1, t0, up), L(e1, p1, t1, up), n, colr);
      rg.tri(L(e0, p0, t0, up), L(e1, p1, t1, up), L(e0, p0, t1, up), n, colr);
    }
  }
  const RSHAPES = [
    ["gable", 0, "Gable roof", 1],
    ["gable", 1, "Gable roof, ridge turned", 1],
    ["gable", 0, "Steep gable roof", 1.7],
    ["gable", 1, "Steep gable roof, ridge turned", 1.7],
    ["hip", 0, "Hip roof", 1],
    ["hip", 0, "Spire roof", 2.2],
    ["shed", 0, "Lean-to roof", 1],
    ["shed", 1, "Lean-to roof, turned", 1],
    ["shed", 2, "Lean-to roof, turned twice", 1],
    ["shed", 3, "Lean-to roof, turned thrice", 1],
    ["flat", 0, "Flat roof", 1],
  ];
  const TOP_NAME = { cone: "Pointed roof", dome: "Dome", crenel: "Battlements" };
  function roofPieces(g, r) {
    const shape = r.shape || "gable";
    if (shape === "gable") return gableRoof(g, r);
    const x0 = r.i0,
      x1 = r.i1 + 1,
      z0 = r.j0,
      z1 = r.j1 + 1,
      ov = 0.45,
      seed = r.i0 * 3 + r.j0;
    if (shape === "flat") {
      g.abox(x0 - 0.14, EAVE - 0.02, z0 - 0.14, x1 + 0.14, EAVE + 0.1, z1 + 0.14, shade(RPAL, 0.92));
      for (const [a, b, c, e] of [
        [x0 - 0.14, z0 - 0.14, x1 + 0.14, z0 + 0.02],
        [x0 - 0.14, z1 - 0.02, x1 + 0.14, z1 + 0.14],
        [x0 - 0.14, z0, x0 + 0.02, z1],
        [x1 - 0.02, z0, x1 + 0.14, z1],
      ])
        g.abox(a, EAVE + 0.1, b, c, EAVE + 0.28, e, shade(RPAL, 0.78));
      return;
    }
    if (shape === "hip") {
      const w = x1 - x0,
        l = z1 - z0,
        half = Math.min(w, l) / 2,
        rise = clamp(half * 0.85, 0.7, 2.9) * (r.pitch || 1),
        ye = EAVE - (rise / half) * ov,
        yt = EAVE + rise;
      const c00 = [x0 - ov, ye, z0 - ov],
        c10 = [x1 + ov, ye, z0 - ov],
        c11 = [x1 + ov, ye, z1 + ov],
        c01 = [x0 - ov, ye, z1 + ov];
      const r0 = w >= l ? [x0 + half, yt, (z0 + z1) / 2] : [(x0 + x1) / 2, yt, z0 + half],
        r1 = w >= l ? [x1 - half, yt, (z0 + z1) / 2] : [(x0 + x1) / 2, yt, z1 - half];
      if (w >= l) {
        roofFace(g, c00, c10, r0, r1, seed);
        roofFace(g, c01, c11, r0, r1, seed + 1);
        roofFace(g, c10, c11, r1, r1, seed + 2);
        roofFace(g, c00, c01, r0, r0, seed + 3);
      } else {
        roofFace(g, c00, c01, r0, r1, seed);
        roofFace(g, c10, c11, r0, r1, seed + 1);
        roofFace(g, c00, c10, r0, r0, seed + 2);
        roofFace(g, c01, c11, r1, r1, seed + 3);
      }
      g.obox([(r0[0] + r1[0]) / 2, yt + 0.06, (r0[2] + r1[2]) / 2], [Math.abs(r1[0] - r0[0]) / 2 + 0.1, 0, 0], [0, 0.09, 0], [0, 0, Math.abs(r1[2] - r0[2]) / 2 + 0.1], PAL.beam);
      return;
    }
    // lean-to: one slope, running down in direction r.dir
    const [dx, dz] = DIRS[r.dir || 0];
    const alongX = dx !== 0,
      sgn = dx + dz;
    const a0 = alongX ? x0 : z0,
      a1 = alongX ? x1 : z1,
      b0 = alongX ? z0 : x0,
      b1 = alongX ? z1 : x1;
    const hi = sgn > 0 ? a0 : a1,
      lo = sgn > 0 ? a1 : a0,
      span = a1 - a0,
      rise = clamp(span * 0.45, 0.6, 2.6),
      sl = rise / span;
    const m = (a, y, b) => (alongX ? [a, y, b] : [b, y, a]);
    roofFace(g, m(lo + sgn * ov, EAVE - sl * ov, b0 - ov), m(lo + sgn * ov, EAVE - sl * ov, b1 + ov), m(hi - sgn * 0.25, EAVE + rise + sl * 0.25, b0 - ov), m(hi - sgn * 0.25, EAVE + rise + sl * 0.25, b1 + ov), seed);
    const gc = shade(C.gable, 0.95),
      nb = alongX ? [0, 0, 1] : [1, 0, 0],
      na = alongX ? [1, 0, 0] : [0, 0, 1];
    for (const b of [b0, b1]) g.tri(m(lo, EAVE - 0.02, b), m(hi, EAVE - 0.02, b), m(hi, EAVE + rise, b), nb, gc);
    g.tri(m(hi, EAVE - 0.02, b0), m(hi, EAVE - 0.02, b1), m(hi, EAVE + rise, b1), na, gc);
    g.tri(m(hi, EAVE - 0.02, b0), m(hi, EAVE + rise, b1), m(hi, EAVE + rise, b0), na, gc);
  }
  function gableRoof(g, r) {
    // a = along the ridge, b = across it
    const alongX = r.axis === "x";
    const a0 = (alongX ? r.i0 : r.j0) - 0.45,
      a1 = (alongX ? r.i1 : r.j1) + 1 + 0.45;
    const b0 = alongX ? r.j0 : r.i0,
      b1 = (alongX ? r.j1 : r.i1) + 1;
    const half = (b1 - b0) / 2,
      bc = (b0 + b1) / 2,
      rise = clamp(half * 0.85, 0.7, 2.9) * (r.pitch || 1),
      ov = 0.45,
      sl = rise / half;
    const pt = (a, b, y) => (alongX ? [a, y, b] : [b, y, a]);
    const vec = (a, b, y) => (alongX ? [a, y, b] : [b, y, a]);
    const run = half + ov,
      drop = rise + sl * ov,
      L = Math.hypot(run, drop),
      n = Math.max(2, Math.ceil(L / 0.5));
    for (const side of [-1, 1]) {
      const db = (side * run) / L,
        dy = -drop / L; // unit vector down the slope (b, y)
      const nb = (side * drop) / L,
        ny = run / L; // outward normal
      for (let k = 0; k < n; k++) {
        const tm = ((k + 0.5) / n) * L,
          hl = L / n / 2 + 0.03,
          lift = 0.06 + (k % 2) * 0.025;
        const cb = bc + db * tm + nb * lift,
          cy = EAVE + rise + dy * tm + ny * lift;
        const sh = 0.84 + 0.22 * hash(r.i0 + k, r.j0 + side, 3) - 0.1 * (k / n);
        g.obox(pt((a0 + a1) / 2, cb, cy), vec((a1 - a0) / 2, 0, 0), vec(0, db * hl, dy * hl), vec(0, nb * 0.06, ny * 0.06), shade(RPAL, sh));
      }
    }
    g.obox(pt((a0 + a1) / 2, bc, EAVE + rise + 0.1), vec((a1 - a0) / 2 + 0.06, 0, 0), vec(0, 0, 0.1), vec(0, 0.1, 0), PAL.beam);
    // gable ends, on the wall line
    for (const a of [a0 + 0.45, a1 - 0.45]) {
      for (const off of [-0.07, 0.07]) {
        const A = pt(a + off, b0, EAVE - 0.02),
          Bp = pt(a + off, b1, EAVE - 0.02),
          Cp = pt(a + off, bc, EAVE + rise);
        g.tri(A, Bp, Cp, vec(Math.sign(off), 0, 0), shade(C.gable, 0.95));
      }
    }
  }

  // a wall piece between two arbitrary points, drawn by mapping the unit wall onto it
  function freePiece(g, x0, z0, x1, z1, type, depth, seed, oy) {
    const dx = x1 - x0,
      dz = z1 - z0,
      len = Math.hypot(dx, dz) || 1;
    g.xf = { ox: x0, oz: z0, c: dx / len, s: -dz / len, su: len, oy: oy || 0 };
    wallPieces(g, 0, 0, 0, type, depth, seed, Math.round(x0 * 3 + z0 * 7));
    g.xf = null;
  }
  const ringVert = (r, k) => {
    const a = r.rot + (k / r.n) * Math.PI * 2;
    return [r.cx + Math.cos(a) * r.r, r.cz + Math.sin(a) * r.r];
  };
  const ringInner = (r) => r.r * Math.cos(Math.PI / r.n);
  // towers wide enough for a spiral stair can be climbed, one turn per storey
  const inRings = (D, x, z) => !!D.rings && D.rings.some((r) => Math.hypot(x - r.cx, z - r.cz) < ringInner(r) - 0.05);
  const climbLevels = (r) => (ringInner(r) >= 1.7 ? (r.roof === "crenel" ? r.h : r.h - 1) : 0);
  // the spiral is turned so that it passes the first wall-walk doorway at exactly that height
  const ringPhase = (r, portals) => (portals && portals.size ? ([...portals][0] + 0.5) / r.n : 0);
  function ringPieces(g, rg, r, depth, portals) {
    const ph = ringPhase(r, portals);
    const top = r.h * EAVE,
      ri = ringInner(r),
      climb = r.floor !== false ? climbLevels(r) : 0,
      fc = FLOORS[r.fmat || "planks"].c,
      TAU = Math.PI * 2;
    for (let k = 0; k < r.n; k++) {
      const a = ringVert(r, k),
        b = ringVert(r, k + 1);
      if (r.floor !== false) g.tri([r.cx, FLOOR_T, r.cz], [a[0], FLOOR_T, a[1]], [b[0], FLOOR_T, b[1]], [0, 1, 0], shade(fc, 0.9 + 0.16 * hash(k, r.n, 2)));
      const ty = r.sides[k];
      if (ty) {
        for (let l = 0; l < r.h; l++) freePiece(g, a[0], a[1], b[0], b[1], l === 0 ? ty : l === 1 && portals && portals.has(k) ? "arch" : k % 3 === 1 ? (PAL.courses ? "window3" : "window") : "wall", l === 0 ? depth : 0, k * 5 + l, l * EAVE);
        g.abox(a[0] - 0.12, -depth, a[1] - 0.12, a[0] + 0.12, top + 0.03, a[1] + 0.12, PAL.beam);
        g.abox(b[0] - 0.12, -depth, b[1] - 0.12, b[0] + 0.12, top + 0.03, b[1] + 0.12, PAL.beam);
      }
    }
    const disc = (G2, y, rd, colr, band) => {
      for (let k = 0; k < r.n; k++) {
        const a0 = r.rot + (k / r.n) * TAU,
          a1 = r.rot + ((k + 1) / r.n) * TAU,
          ia = [r.cx + Math.cos(a0) * rd, y, r.cz + Math.sin(a0) * rd],
          ib = [r.cx + Math.cos(a1) * rd, y, r.cz + Math.sin(a1) * rd],
          cc = shade(colr, 0.88 + 0.14 * hash(k, Math.round(y * 3), 2));
        G2.tri([r.cx, y, r.cz], ia, ib, [0, 1, 0], cc);
        const tk = (k + 0.5) / r.n - ph;
        const tf = tk - Math.floor(tk);
        if (band === true ? tf < 0.4 : band === "gallery" && tf >= 0.2 && tf < 0.75) {
          const a = ringVert(r, k),
            b = ringVert(r, k + 1);
          G2.tri(ia, [a[0], y, a[1]], [b[0], y, b[1]], [0, 1, 0], cc);
          G2.tri(ia, [b[0], y, b[1]], ib, [0, 1, 0], cc);
        }
      }
    };
    if (climb) {
      const m = 16,
        rm = ri - 0.55,
        hw = (rm * Math.PI) / m + 0.04;
      for (let s = 0; s < climb * m; s++) {
        const ang = r.rot + (ph + (s + 0.5) / m) * TAU,
          cs = Math.cos(ang),
          sn = Math.sin(ang),
          y = ((s + 1) / m) * EAVE + FLOOR_T;
        g.obox([r.cx + cs * rm, y - 0.05, r.cz + sn * rm], [cs * 0.46, 0, sn * 0.46], [0, 0.05, 0], [-sn * hw, 0, cs * hw], shade(fc, 0.78 + 0.2 * hash(s, r.n, 9)));
      }
      for (let l = 1; l < r.h; l++) disc(g, l * EAVE + FLOOR_T, ri - 1.05, fc, l === climb ? true : l === 1 && portals && portals.size ? "gallery" : null);
    }
    const shape = r.roof === true ? "cone" : r.roof;
    if (shape === "crenel") {
      const sc = shade(PAL.courses ? PAL.plank : PAL.stone, 0.74);
      if (climb) disc(rg, top + FLOOR_T, ri - 1.05, sc, true);
      else disc(rg, top + 0.02, r.r, sc, false);
      for (let k = 0; k < r.n; k++) {
        const a = ringVert(r, k),
          b = ringVert(r, k + 1);
        freePiece(rg, a[0], a[1], b[0], b[1], "parapet", 0, k * 3, top);
      }
    } else if (shape === "dome") {
      const re = r.r + 0.3,
        rise = r.r * 0.95,
        y0 = top - 0.1,
        bands = 5;
      for (let k = 0; k < r.n; k++) {
        const a0 = r.rot + (k / r.n) * TAU,
          a1 = r.rot + ((k + 1) / r.n) * TAU,
          am = (a0 + a1) / 2;
        for (let b = 0; b < bands; b++) {
          const f0 = ((b / bands) * Math.PI) / 2,
            f1 = (((b + 1) / bands) * Math.PI) / 2,
            fm = (f0 + f1) / 2;
          const P = (ang, f) => [r.cx + Math.cos(ang) * re * Math.cos(f), y0 + rise * Math.sin(f), r.cz + Math.sin(ang) * re * Math.cos(f)];
          const nrm = [Math.cos(am) * Math.cos(fm), Math.sin(fm), Math.sin(am) * Math.cos(fm)],
            colr = shade(RPAL, 0.8 + 0.2 * hash(k, b, r.n) + 0.05 * b);
          rg.tri(P(a0, f0), P(a1, f0), P(a1, f1), nrm, colr);
          if (b < bands - 1) rg.tri(P(a0, f0), P(a1, f1), P(a0, f1), nrm, colr);
        }
      }
      rg.abox(r.cx - 0.07, y0 + rise - 0.05, r.cz - 0.07, r.cx + 0.07, y0 + rise + 0.55, r.cz + 0.07, PAL.beam);
    } else if (shape === "cone") {
      const re = r.r + 0.55,
        rise = clamp(r.r * 1.35, 1.6, 6),
        y0 = top - 0.12,
        bands = 4;
      for (let k = 0; k < r.n; k++) {
        const a0 = r.rot + (k / r.n) * TAU,
          a1 = r.rot + ((k + 1) / r.n) * TAU,
          am = (a0 + a1) / 2,
          nl = Math.hypot(rise, re),
          nrm = [(Math.cos(am) * rise) / nl, re / nl, (Math.sin(am) * rise) / nl];
        for (let b = 0; b < bands; b++) {
          const t0 = b / bands,
            t1 = (b + 1) / bands,
            lift = (b % 2) * 0.03;
          const P = (ang, t) => [r.cx + Math.cos(ang) * re * (1 - t), y0 + rise * t + lift, r.cz + Math.sin(ang) * re * (1 - t)];
          const colr = shade(RPAL, 0.8 + 0.22 * hash(k, b, r.n) + 0.06 * b);
          rg.tri(P(a0, t0), P(a1, t0), P(a1, t1), nrm, colr);
          if (b < bands - 1) rg.tri(P(a0, t0), P(a1, t1), P(a0, t1), nrm, colr);
        }
      }
    }
  }
  // walkable tops: castle walls, and the stairs and floors inside towers
  function topWalk(S, lx, lz, y) {
    let best = null;
    const H = EAVE * S.hs,
      ok = (hh) => {
        if (y >= S.y0 + hh - 0.65 && (best === null || hh > best)) best = hh;
      };
    if (S.thick) {
      const fi = Math.floor(lx),
        fj = Math.floor(lz);
      let on = false;
      for (let j = fj - 1; j <= fj + 2 && !on; j++)
        for (let i = fi - 1; i <= fi + 2 && !on; i++)
          for (let d = 0; d < 2; d++) {
            if (!isThick(S.walls.get(ek(i, j, d))) || S.hid.has(ek(i, j, d))) continue;
            const u = d === 0 ? lx - i : lz - j,
              w = d === 0 ? lz - j : lx - i;
            if (Math.abs(w) < 0.52 && u > -0.52 && u < 1.52) on = true;
          }
      for (const sg of S.colSegs) {
        if (on || !isThick(sg[4])) continue;
        const dx = sg[2] - sg[0],
          dz = sg[3] - sg[1],
          t = clamp(((lx - sg[0]) * dx + (lz - sg[1]) * dz) / (dx * dx + dz * dz), 0, 1);
        if (Math.hypot(lx - sg[0] - dx * t, lz - sg[1] - dz * t) < 0.55) on = true;
      }
      on && ok(H);
    }
    for (let n = 0; n < S.rings.length; n++) {
      const r = S.rings[n],
        L = climbLevels(r);
      if (!L) continue;
      const dx = lx - r.cx,
        dz = lz - r.cz,
        rad = Math.hypot(dx, dz),
        ri = ringInner(r);
      if (rad > ri + 0.1) continue;
      if (rad < ri - 1.05) {
        for (let l = 1; l < r.h; l++) ok(l * H + FLOOR_T);
        r.roof === "crenel" && ok(r.h * H + FLOOR_T);
      } else {
        let raw = (Math.atan2(dz, dx) - r.rot) / (Math.PI * 2);
        raw -= Math.floor(raw);
        let th = raw - ringPhase(r, S.portals[n]);
        th -= Math.floor(th);
        for (let k = 0; k < L; k++) ok(stretchY((th + k) * EAVE + FLOOR_T, S.hs));
        th < 0.4 && ok(L * H + FLOOR_T);
        S.portals[n].size && th >= 0.2 && th < 0.75 && ok(H + FLOOR_T);
      }
    }
    return best === null ? null : S.y0 + best;
  }
  // upstairs in a tower the walls still hold you in
  function ringHold(e, r, S) {
    const H = EAVE * S.hs;
    if (e.y === undefined || e.y < S.y0 + H - 0.3) return;
    const [lx, lz] = toLocal(S, e.x, e.z);
    for (let n = 0; n < S.rings.length; n++) {
      const rg = S.rings[n];
      if (!climbLevels(rg) || e.y > S.y0 + rg.h * H + 1.2) continue;
      const dx = lx - rg.cx,
        dz = lz - rg.cz,
        rad = Math.hypot(dx, dz) || 1,
        ri = ringInner(rg),
        pad = r + 0.14;
      if (rad < ri - pad || rad > ri + pad) continue;
      if (S.portals[n].size && e.y < S.y0 + 2 * H - 0.5) {
        // a castle wall meets the tower here: the doorway onto it is open
        let th = (Math.atan2(dz, dx) - rg.rot) / (Math.PI * 2);
        th -= Math.floor(th);
        if (S.portals[n].has(Math.floor(th * rg.n))) continue;
      }
      const to = rad < ri ? ri - pad : ri + pad;
      [e.x, e.z] = toWorld(S, rg.cx + (dx / rad) * to, rg.cz + (dz / rad) * to);
    }
  }
  /* ---------- furniture and decorations ---------- */
  const DYES = [
    ["Red", col(0xa33a32)],
    ["Blue", col(0x3d5f9a)],
    ["Green", col(0x4d7a3f)],
    ["Gold", col(0xc9a23f)],
    ["Purple", col(0x6e4a8a)],
    ["Cream", col(0xe6dfcc)],
    ["Charcoal", col(0x3a3a40)],
  ];
  const DC = { iron: col(0x34343a), linen: col(0xe9e4d6), leaf: col(0x4f8a3a), leaf2: col(0x3d6f2f), water: col(0x4f8fb5), soil: col(0x5a4330), straw: col(0xcdb25e), clay: col(0xb0603f), flame: [1, 0.6, 0.16], flame2: [1, 0.86, 0.42], ember: [1, 0.36, 0.1] };
  const DCATS = ["Home", "Fire and light", "Work and stores", "Village and garden"];
  const PT = [[-0.02, 0, 0.02, 0]];
  // cosy: how much a piece adds to a room feeling like home. light: [height, strength]. wall: how far from a wall it sits when it snaps to one.
  const DECOR = {
    bed: { name: "Bed", cat: 0, cosy: 2, col: [[0, -0.6, 0, 0.6]] },
    table: { name: "Long table", cat: 0, cosy: 1, col: [[-0.6, 0, 0.6, 0]] },
    roundtable: { name: "Round table", cat: 0, cosy: 1, col: PT },
    chair: { name: "Chair", cat: 0, cosy: 1 },
    bench: { name: "Bench", cat: 0, cosy: 1, col: [[-0.55, 0, 0.55, 0]] },
    chest: { name: "Chest", cat: 0, cosy: 1, col: [[-0.2, 0, 0.2, 0]] },
    bookcase: { name: "Bookcase", cat: 0, cosy: 1, wall: 0.26, col: [[-0.35, 0, 0.35, 0]] },
    cupboard: { name: "Cupboard", cat: 0, cosy: 1, wall: 0.31, col: [[-0.3, 0, 0.3, 0]] },
    counter: { name: "Counter", cat: 0, col: [[-0.7, 0, 0.7, 0]] },
    rug: { name: "Rug", cat: 0, cosy: 1 },
    plant: { name: "Potted plant", cat: 0, cosy: 1 },
    throne: { name: "Throne", cat: 0, col: PT },
    fireplace: { name: "Fireplace", cat: 1, cosy: 3, wall: 0.38, light: [0.7, 1.3], col: [[-0.5, 0, 0.5, 0]] },
    campfire: { name: "Campfire", cat: 1, light: [0.5, 1.2], col: PT },
    brazier: { name: "Brazier", cat: 1, cosy: 1, light: [1.1, 1], col: PT },
    torch: { name: "Standing torch", cat: 1, light: [1.8, 0.9] },
    sconce: { name: "Wall torch", cat: 1, cosy: 1, wall: 0.15, light: [1.8, 0.8] },
    candles: { name: "Candle stand", cat: 1, cosy: 1, light: [1.5, 0.6] },
    chandelier: { name: "Chandelier", cat: 1, cosy: 1, light: [-1.1, 1.1] },
    lamppost: { name: "Lamp post", cat: 1, light: [2.2, 1.2], col: PT },
    cauldron: { name: "Cooking pot", cat: 1, cosy: 1, light: [0.3, 0.5], col: PT },
    barrel: { name: "Barrel", cat: 2, col: PT },
    crate: { name: "Crate", cat: 2, col: PT },
    sacks: { name: "Sacks", cat: 2, col: PT },
    anvil: { name: "Anvil", cat: 2, col: PT },
    rack: { name: "Weapon rack", cat: 2, col: [[-0.4, 0, 0.4, 0]] },
    haybale: { name: "Hay bale", cat: 2, col: [[-0.3, 0, 0.3, 0]] },
    woodpile: { name: "Wood pile", cat: 2, col: [[-0.45, 0, 0.45, 0]] },
    trough: { name: "Water trough", cat: 2, col: [[-0.5, 0, 0.5, 0]] },
    cart: { name: "Hand cart", cat: 2, col: [[-0.6, 0, 0.6, 0]] },
    well: { name: "Well", cat: 3, col: [[-0.55, 0, 0.55, 0], [0, -0.55, 0, 0.55]] },
    fountain: { name: "Fountain", cat: 3, col: [[-1, 0, 1, 0], [0, -1, 0, 1]] },
    stall: { name: "Market stall", cat: 3, col: [[-1, 0.3, 1, 0.3]] },
    signpost: { name: "Signpost", cat: 3, col: PT },
    statue: { name: "Statue", cat: 3, col: PT },
    scarecrow: { name: "Scarecrow", cat: 3, col: PT },
    banner: { name: "Banner", cat: 3, wall: 0.1 },
    flag: { name: "Flag pole", cat: 3, col: PT },
    tent: { name: "Tent", cat: 3 },
    flowerbed: { name: "Flower bed", cat: 3 },
    bush: { name: "Bush", cat: 3, col: PT },
  };
  const DKEYS = Object.keys(DECOR);
  // Every piece is modelled once, in its own space, then stamped wherever it stands.
  const decorCache = new Map();
  function decorGeo(kind, ci, drop) {
    const key = kind + "|" + ci + "|" + (kind === "chandelier" || kind === "fireplace" ? Math.round(drop * 10) : 0);
    if (decorCache.has(key)) return decorCache.get(key);
    const m = new Geo(),
      gl = new Geo(),
      K = DKEYS.indexOf(kind) * 31 + 7,
      rnd = (k) => hash(K, k, 5),
      dye = DYES[ci || 0][1],
      gold = DYES[3][1],
      OAK = C.plank,
      DKW = C.beam,
      PINE = col(0xb08a5a),
      BARK = col(0x4d3b2a),
      END = col(0xc9a878),
      IRON = DC.iron,
      ST = C.stone,
      FUR = col(0x74614c),
      LIN = DC.linen,
      TAU = Math.PI * 2;
    const j = (c, k, a = 0.18) => shade(c, 1 - a / 2 + a * rnd(k));
    // bm: hewn beam, lg: round log with pale end grain, rod: thin round bar
    const bm = (a, b, w, h, c, bev) => m.beam(a, b, w, h, c, bev),
      lg = (a, b, r0, r1, c, n = 8) => m.cyl(a, b, r0, r1 === undefined ? r0 : r1, n, shade(c, 0.8), c, END),
      rod = (a, b, r, c, n = 5) => m.cyl(a, b, r, r, n, c, c),
      rock = (c, rx, ry, rz, k, tone = ST) => m.ball(c, rx, ry, rz, j(tone, k, 0.3), { flat: true, jit: 0.16, seed: K + k, lat: 3, lon: 6 }),
      disc = (c, r, h, cc, n = 12) => m.cyl(c, [c[0], c[1] + h, c[2]], r, r, n, shade(cc, 0.85), cc),
      ringBand = (c, r, h, cc, n = 12) => m.cyl(c, [c[0], c[1] + h, c[2]], r, r, n, cc, cc, false);
    const flame = (x, y, z, s) => {
      gl.cyl([x, y - 0.02, z], [x, y + 0.04, z], 0.2 * s, 0.15 * s, 7, DC.ember, DC.ember);
      gl.cyl([x, y, z], [x + 0.03 * s, y + 0.55 * s, z - 0.02 * s], 0.13 * s, 0, 6, DC.flame, DC.flame2);
      gl.cyl([x - 0.08 * s, y, z + 0.05 * s], [x - 0.13 * s, y + 0.32 * s, z + 0.08 * s], 0.08 * s, 0, 5, DC.ember, DC.flame);
      gl.cyl([x + 0.09 * s, y, z - 0.04 * s], [x + 0.12 * s, y + 0.38 * s, z - 0.09 * s], 0.075 * s, 0, 5, DC.ember, DC.flame2);
      gl.cyl([x, y + 0.05 * s, z], [x + 0.01, y + 0.33 * s, z], 0.06 * s, 0, 5, DC.flame2, [1, 0.97, 0.75]);
    };
    const candle = (x, y, z, h = 0.16) => {
      m.cyl([x, y, z], [x, y + h, z], 0.026, 0.022, 6, shade(LIN, 0.85), LIN);
      gl.cyl([x, y + h, z], [x, y + h + 0.1, z], 0.02, 0, 5, DC.flame, DC.flame2);
    };
    const firewood = (y, s) => {
      lg([-0.28 * s, y + 0.05, -0.06], [0.28 * s, y + 0.07, 0.05], 0.055, 0.05, BARK, 6);
      lg([-0.2 * s, y + 0.05, 0.1], [0.24 * s, y + 0.16, -0.1], 0.05, 0.045, BARK, 6);
      lg([0.05, y + 0.04, -0.22 * s], [-0.06, y + 0.2, 0.2 * s], 0.05, 0.04, shade(BARK, 0.6), 6);
    };
    const tankard = (x, y, z) => {
      m.cyl([x, y, z], [x, y + 0.13, z], 0.045, 0.04, 7, DKW, OAK, shade(OAK, 0.6));
      rod([x + 0.045, y + 0.03, z], [x + 0.075, y + 0.065, z], 0.012, IRON, 4);
      rod([x + 0.075, y + 0.065, z], [x + 0.045, y + 0.1, z], 0.012, IRON, 4);
    };
    const wheel = (c, r, axis) => {
      // spoked wheel standing in the x-y plane at depth c[2]
      for (let k = 0; k < 10; k++) {
        const a0 = (k / 10) * TAU,
          a1 = ((k + 1) / 10) * TAU;
        bm([c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r, c[2]], [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r, c[2]], 0.07, 0.06, j(DKW, k), 0.3);
      }
      for (let k = 0; k < 5; k++) {
        const a0 = (k / 5) * Math.PI + 0.2;
        rod([c[0] - Math.cos(a0) * r, c[1] - Math.sin(a0) * r, c[2]], [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r, c[2]], 0.02, OAK, 5);
      }
      m.cyl([c[0], c[1], c[2] - 0.06], [c[0], c[1], c[2] + 0.06], 0.07, 0.07, 8, DKW, DKW, IRON);
    };
    switch (kind) {
      case "bed": {
        for (const sx of [-0.5, 0.5]) {
          lg([sx, 0, -1.0], [sx, 1.12, -1.0], 0.07, 0.055, DKW);
          m.ball([sx, 1.17, -1.0], 0.075, 0.075, 0.075, DKW, { lat: 3, lon: 6 });
          lg([sx, 0, 1.0], [sx, 0.62, 1.0], 0.065, 0.055, DKW);
          bm([sx, 0.3, -1.0], [sx, 0.3, 1.0], 0.07, 0.17, j(OAK, sx > 0 ? 1 : 2));
        }
        bm([-0.5, 0.3, 1.0], [0.5, 0.3, 1.0], 0.06, 0.16, OAK);
        bm([-0.5, 0.46, 1.0], [0.5, 0.46, 1.0], 0.05, 0.08, DKW);
        [0.86, 1.02, 1.02, 0.86].forEach((hh, k) => bm([-0.375 + k * 0.25, 0.22, -1.0], [-0.375 + k * 0.25, hh, -1.0], 0.05, 0.235, j(OAK, k + 3)));
        bm([-0.5, 0.62, -1.03], [0.5, 0.62, -1.03], 0.04, 0.07, DKW);
        // straw mattress, wool blanket hanging over the sides, pillow, fur at the foot
        m.surf(6, 6, (u, v) => [-0.45 + 0.9 * u, 0.36 + 0.1 * Math.sin(Math.PI * u) ** 0.5, -0.94 + 1.9 * v], () => shade(LIN, 0.9));
        m.abox(-0.45, 0.24, -0.94, 0.45, 0.37, 0.96, shade(DC.straw, 0.8));
        m.surf(12, 14, (u, v) => {
          const x = -0.58 + 1.16 * u,
            t = clamp((Math.abs(x) - 0.44) / 0.14, 0, 1);
          return [x, 0.49 + 0.07 * Math.cos((x / 0.5) * 1.3) - t * t * 0.3 + 0.012 * Math.sin(v * 11 + u * 7), -0.3 + 1.27 * v + 0.02 * Math.sin(u * 9)];
        }, (u, v) => (v > 0.8 && v < 0.93 ? (Math.floor(u * 12) % 2 ? gold : shade(dye, 0.6)) : v > 0.7 && v < 0.76 ? gold : shade(dye, 0.9 + 0.08 * Math.sin(u * 23) * Math.sin(v * 17))), true);
        m.ball([0, 0.52, -0.7], 0.3, 0.075, 0.16, LIN, { lat: 4, lon: 8 });
        m.surf(5, 4, (u, v) => [-0.4 + 0.8 * u + 0.05 * Math.sin(v * 7), 0.555 + 0.03 * Math.sin(u * 6 + v * 4), 0.55 + 0.4 * v], (u, v) => shade(FUR, 0.8 + 0.3 * rnd(Math.floor(u * 5) + Math.floor(v * 4) * 7)));
        break;
      }
      case "table": {
        for (let k = 0; k < 4; k++) bm([-0.92 + 0.03 * rnd(k), 0.77, -0.345 + k * 0.23], [0.92 - 0.04 * rnd(k + 4), 0.77, -0.345 + k * 0.23], 0.22, 0.07, j(OAK, k));
        for (const sx of [-0.68, 0.68]) {
          bm([sx, 0, -0.36], [sx, 0.74, -0.08], 0.09, 0.09, DKW);
          bm([sx, 0, 0.36], [sx, 0.74, 0.08], 0.09, 0.09, DKW);
          bm([sx, 0.7, -0.4], [sx, 0.7, 0.4], 0.08, 0.07, DKW);
        }
        lg([-0.72, 0.3, 0], [0.72, 0.3, 0], 0.04, 0.04, BARK, 6);
        m.cyl([-0.45, 0.805, 0.02], [-0.45, 0.86, 0.02], 0.07, 0.13, 8, DKW, OAK, shade(OAK, 0.55));
        m.ball([-0.45, 0.86, 0.02], 0.07, 0.035, 0.07, [0.72, 0.3, 0.22], { lat: 2, lon: 6 });
        tankard(0.3, 0.805, 0.14);
        tankard(0.52, 0.805, -0.16);
        m.ball([0.05, 0.84, -0.12], 0.13, 0.05, 0.08, [0.8, 0.6, 0.32], { lat: 3, lon: 6 });
        disc([0.72, 0.805, 0.05], 0.05, 0.015, IRON, 6);
        candle(0.72, 0.82, 0.05, 0.2);
        break;
      }
      case "roundtable": {
        disc([0, 0.74, 0], 0.6, 0.07, OAK, 14);
        ringBand([0, 0.75, 0], 0.605, 0.05, shade(DKW, 0.9), 14);
        lg([0, 0.05, 0], [0, 0.74, 0], 0.16, 0.1, BARK, 9);
        for (let k = 0; k < 3; k++) bm([0, 0.06, 0], [Math.cos((k / 3) * TAU) * 0.42, 0.04, Math.sin((k / 3) * TAU) * 0.42], 0.09, 0.08, DKW);
        tankard(0.2, 0.81, 0.1);
        disc([-0.18, 0.81, -0.1], 0.13, 0.015, shade(OAK, 1.15), 8);
        m.ball([-0.18, 0.86, -0.1], 0.08, 0.05, 0.06, [0.8, 0.6, 0.32], { lat: 2, lon: 6 });
        break;
      }
      case "chair": {
        for (const sx of [-0.2, 0.2]) {
          lg([sx, 0, 0.2], [sx, 0.45, 0.19], 0.032, 0.028, DKW, 6);
          lg([sx * 1.05, 0, -0.22], [sx, 1.02, -0.27], 0.034, 0.026, DKW, 6);
          rod([sx, 0.2, -0.21], [sx, 0.2, 0.19], 0.016, OAK);
        }
        rod([-0.2, 0.16, 0.19], [0.2, 0.16, 0.19], 0.016, OAK);
        bm([-0.24, 0.45, -0.01], [0.24, 0.45, -0.01], 0.46, 0.045, OAK, 0.35);
        m.surf(4, 4, (u, v) => [-0.2 + 0.4 * u, 0.475 + 0.02 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v), -0.2 + 0.38 * v], (u, v) => shade(FUR, 0.85 + 0.25 * rnd(Math.floor(u * 4) + Math.floor(v * 4) * 5)));
        bm([-0.2, 0.92, -0.265], [0.2, 0.92, -0.265], 0.03, 0.13, OAK);
        bm([-0.2, 0.7, -0.255], [0.2, 0.7, -0.255], 0.025, 0.07, j(OAK, 2));
        break;
      }
      case "bench": {
        bm([-0.82, 0.42, 0], [0.82, 0.42, 0], 0.36, 0.09, OAK, 0.4);
        m.cyl([-0.82, 0.38, 0], [0.82, 0.38, 0], 0.17, 0.17, 8, shade(BARK, 0.8), BARK, END, 0.35);
        for (const sx of [-0.6, 0.6]) {
          lg([sx, 0, -0.14], [sx * 0.95, 0.38, -0.06], 0.045, 0.04, DKW, 6);
          lg([sx, 0, 0.14], [sx * 0.95, 0.38, 0.06], 0.045, 0.04, DKW, 6);
        }
        break;
      }
      case "chest": {
        for (let k = 0; k < 3; k++) m.abox(-0.45, 0.04 + k * 0.13, -0.26, 0.45, 0.165 + k * 0.13, 0.26, j(OAK, k));
        for (const sx of [-0.38, 0.38]) for (const sz of [-0.2, 0.2]) m.abox(sx - 0.04, 0, sz - 0.04, sx + 0.04, 0.05, sz + 0.04, DKW);
        m.cyl([-0.45, 0.42, 0], [0.45, 0.42, 0], 0.27, 0.27, 12, shade(OAK, 0.8), shade(OAK, 0.95), shade(DKW, 1.1));
        for (const sx of [-0.3, 0.3]) {
          m.cyl([sx - 0.035, 0.42, 0], [sx + 0.035, 0.42, 0], 0.28, 0.28, 12, IRON, IRON);
          m.abox(sx - 0.035, 0.03, -0.27, sx + 0.035, 0.42, 0.27, IRON);
        }
        m.abox(-0.06, 0.3, 0.26, 0.06, 0.44, 0.285, gold);
        m.abox(-0.015, 0.33, 0.285, 0.015, 0.38, 0.295, IRON);
        for (const sx of [-0.46, 0.46]) rod([sx, 0.3, -0.08], [sx, 0.3, 0.08], 0.018, IRON);
        break;
      }
      case "bookcase": {
        bm([-0.48, 0, 0], [-0.48, 1.92, 0], 0.34, 0.06, DKW);
        bm([0.48, 0, 0], [0.48, 1.92, 0], 0.34, 0.06, DKW);
        m.abox(-0.46, 0.03, -0.17, 0.46, 1.9, -0.14, shade(DKW, 0.8));
        bm([-0.54, 1.93, 0.01], [0.54, 1.93, 0.01], 0.4, 0.06, OAK);
        for (let s = 0; s < 5; s++) {
          const yy = 0.07 + s * 0.45;
          bm([-0.46, yy, 0], [0.46, yy, 0], 0.32, 0.04, j(OAK, s));
          if (s === 4) break;
          let x = -0.43;
          for (let k = 0; x < 0.36; k++) {
            const w = 0.045 + 0.05 * rnd(s * 11 + k),
              hgt = 0.24 + 0.12 * rnd(s * 7 + k),
              cc = DYES[Math.floor(rnd(s * 9 + k + 1) * 6.99)][1];
            if (rnd(s * 5 + k + 40) > 0.86) {
              m.obox([x + w + 0.05, yy + 0.02 + hgt / 2, 0.0], [w / 2, hgt / 2, 0], [-0.03, 0.01, 0], [0, 0, 0.1], shade(cc, 0.8));
              x += w + 0.1;
            } else if (rnd(s * 3 + k + 70) > 0.9) {
              m.cyl([x + 0.06, yy + 0.02, 0.02], [x + 0.06, yy + 0.2, 0.02], 0.045, 0.06, 7, DC.clay, shade(DC.clay, 1.15), shade(DC.clay, 0.6));
              x += 0.14;
            } else {
              m.abox(x, yy + 0.02, -0.1, x + w, yy + 0.02 + hgt, 0.1, shade(cc, 0.75 + 0.3 * rnd(k + s)));
              m.abox(x - 0.002, yy + 0.02 + hgt * 0.7, 0.085, x + w + 0.002, yy + 0.02 + hgt * 0.78, 0.103, gold);
              x += w + 0.006;
            }
          }
        }
        break;
      }
      case "cupboard": {
        for (const sx of [-0.47, 0.47]) bm([sx, 0, 0], [sx, 1.74, 0], 0.44, 0.07, DKW);
        m.abox(-0.45, 0.08, -0.21, 0.45, 1.72, 0.17, shade(OAK, 0.8));
        bm([-0.55, 1.77, 0.01], [0.55, 1.77, 0.01], 0.5, 0.08, OAK);
        bm([-0.5, 0.06, 0.01], [0.5, 0.06, 0.01], 0.46, 0.1, DKW);
        for (const sx of [-0.225, 0.225])
          for (const [y0, y1] of [
            [0.14, 0.86],
            [0.94, 1.68],
          ]) {
            bm([sx - 0.19, y0, 0.19], [sx - 0.19, y1, 0.19], 0.035, 0.06, OAK);
            bm([sx + 0.19, y0, 0.19], [sx + 0.19, y1, 0.19], 0.035, 0.06, OAK);
            bm([sx - 0.2, y0 + 0.03, 0.19], [sx + 0.2, y0 + 0.03, 0.19], 0.035, 0.06, OAK);
            bm([sx - 0.2, y1 - 0.03, 0.19], [sx + 0.2, y1 - 0.03, 0.19], 0.035, 0.06, OAK);
            m.abox(sx - 0.17, y0 + 0.05, 0.16, sx + 0.17, y1 - 0.05, 0.18, j(PINE, y0 * 10 + sx * 10 + 5));
            m.ball([sx - Math.sign(sx) * 0.14, (y0 + y1) / 2, 0.215], 0.02, 0.02, 0.02, IRON, { lat: 2, lon: 5 });
          }
        disc([-0.25, 1.81, 0], 0.11, 0.02, shade(LIN, 0.9), 9);
        m.cyl([0.2, 1.81, 0.02], [0.2, 2.03, 0.02], 0.07, 0.04, 7, DC.clay, shade(DC.clay, 1.2));
        break;
      }
      case "counter": {
        for (let k = 0; k < 8; k++) bm([-0.79 + k * 0.225, 0.04, 0.22], [-0.79 + k * 0.225, 0.9, 0.22], 0.05, 0.215, j(OAK, k));
        m.abox(-0.9, 0.04, -0.24, 0.9, 0.9, 0.2, shade(DKW, 0.85));
        bm([-0.9, 0.07, 0.24], [0.9, 0.07, 0.24], 0.05, 0.1, DKW);
        for (let k = 0; k < 2; k++) bm([-0.97, 0.94, -0.14 + k * 0.29], [0.97, 0.94, -0.14 + k * 0.29], 0.29, 0.08, j(PINE, k + 9));
        // a keg on its cradle, and mugs
        m.cyl([-0.72, 1.17, 0], [-0.36, 1.17, 0], 0.17, 0.17, 10, OAK, OAK, shade(OAK, 0.7));
        for (const sx of [-0.66, -0.42]) m.cyl([sx - 0.02, 1.17, 0], [sx + 0.02, 1.17, 0], 0.178, 0.178, 10, IRON, IRON, false);
        bm([-0.66, 1.0, -0.14], [-0.66, 1.0, 0.14], 0.06, 0.06, DKW);
        bm([-0.42, 1.0, -0.14], [-0.42, 1.0, 0.14], 0.06, 0.06, DKW);
        rod([-0.54, 1.1, 0.17], [-0.54, 1.1, 0.24], 0.015, IRON);
        tankard(0.1, 0.98, 0.05);
        tankard(0.3, 0.98, -0.08);
        m.surf(3, 2, (u, v) => [0.5 + 0.3 * u, 0.985 + 0.01 * Math.sin(u * 5), -0.12 + 0.2 * v], () => shade(LIN, 0.9));
        break;
      }
      case "throne": {
        m.abox(-0.55, 0, -0.45, 0.55, 0.14, 0.5, shade(ST, 0.85));
        m.frust(0, 0, 0.14, 0.55, 0.42, 0.36, 0.4, 0.34, shade(DKW, 1.1));
        [1.55, 1.85, 2.15, 1.85, 1.55].forEach((hh, k) => bm([-0.34 + k * 0.17, 0.5, -0.3], [-0.34 + k * 0.17, hh, -0.33], 0.07, 0.165, j(DKW, k)));
        m.cyl([0, 2.15, -0.33], [0, 2.4, -0.34], 0.07, 0, 4, gold, gold);
        bm([-0.42, 1.2, -0.36], [0.42, 1.2, -0.36], 0.04, 0.09, gold);
        for (const sx of [-0.42, 0.42]) {
          lg([sx, 0.14, 0.3], [sx, 0.86, 0.3], 0.06, 0.05, DKW);
          lg([sx, 0.82, -0.32], [sx, 0.82, 0.34], 0.055, 0.055, DKW);
          m.ball([sx, 0.84, 0.36], 0.08, 0.08, 0.08, gold, { lat: 3, lon: 6 });
        }
        m.surf(5, 5, (u, v) => [-0.34 + 0.68 * u, 0.56 + 0.04 * Math.sin(Math.PI * u) + (v > 0.85 ? -(v - 0.85) * 1.4 : 0), -0.26 + 0.62 * v], () => dye);
        m.surf(4, 5, (u, v) => [-0.3 + 0.6 * u, 0.6 + 0.85 * v, -0.265 - 0.01 * v + 0.02 * Math.sin(Math.PI * u)], (u, v) => shade(dye, 0.85 + 0.1 * v));
        break;
      }
      case "rug": {
        m.surf(26, 18, (u, v) => [-1 + 2 * u, 0.018 + 0.008 * Math.sin(u * 13 + v * 5) * Math.sin(v * 9), -0.7 + 1.4 * v], (u, v) => {
          const e = Math.min(u, 1 - u) * 2,
            f = Math.min(v, 1 - v) * 1.4,
            b = Math.min(e, f),
            dia = Math.abs(u - 0.5) * 2 + Math.abs(v - 0.5) * 2;
          return b < 0.06 ? shade(dye, 0.6) : b < 0.13 ? gold : b < 0.18 ? shade(dye, 0.7) : dia < 0.28 ? gold : dia < 0.4 ? shade(dye, 0.62) : shade(dye, 0.92 + 0.1 * Math.sin(u * 40) * Math.sin(v * 30));
        }, true);
        for (let k = 0; k < 14; k++)
          for (const sx of [-1, 1]) m.abox(sx * 1.0 - 0.0 + (sx > 0 ? 0 : -0.07), 0.005, -0.66 + k * 0.1, sx * 1.0 + (sx > 0 ? 0.07 : 0), 0.02, -0.63 + k * 0.1, LIN);
        break;
      }
      case "plant": {
        m.cyl([0, 0, 0], [0, 0.28, 0], 0.12, 0.18, 9, shade(DC.clay, 0.8), DC.clay, DC.soil);
        ringBand([0, 0.26, 0], 0.19, 0.04, shade(DC.clay, 1.1), 9);
        for (let k = 0; k < 9; k++) {
          const an = (k / 9) * TAU + rnd(k),
            reach = 0.25 + 0.2 * rnd(k + 9),
            top = 0.55 + 0.45 * rnd(k + 20),
            cx = Math.cos(an),
            cz = Math.sin(an),
            lc = k % 2 ? DC.leaf : DC.leaf2;
          m.surf(1, 4, (u, v) => {
            const w = 0.06 * Math.sin(Math.PI * Math.min(1, v + 0.15)) * (u - 0.5) * 2;
            return [cx * reach * v * v - cz * w, 0.28 + top * Math.sin(v * 1.9) * 0.62, cz * reach * v * v + cx * w];
          }, (u, v) => shade(lc, 0.8 + 0.4 * v));
        }
        break;
      }
      case "fireplace": {
        const top = Math.max(2.2, drop - 0.02);
        m.abox(-0.8, 0, -0.3, 0.8, 0.1, 0.55, shade(ST, 0.7));
        for (let k = 0; k < 5; k++) rock([-0.62 + k * 0.31, 0.12, 0.42], 0.17, 0.06, 0.13, k + 60);
        for (const sx of [-1, 1])
          for (let r = 0; r < 5; r++) {
            rock([sx * (0.6 + 0.03 * rnd(r)), 0.22 + r * 0.24, 0.06], 0.17, 0.135, 0.2, r + (sx > 0 ? 10 : 0));
            rock([sx * 0.62, 0.22 + r * 0.24, -0.16], 0.16, 0.135, 0.15, r + 20 + (sx > 0 ? 10 : 0));
          }
        m.abox(-0.74, 0.1, -0.3, 0.74, 1.3, -0.2, shade(ST, 0.33));
        m.abox(-0.74, 0.1, -0.28, -0.5, 1.3, 0.1, shade(ST, 0.6));
        m.abox(0.5, 0.1, -0.28, 0.74, 1.3, 0.1, shade(ST, 0.6));
        bm([-0.9, 1.4, 0.06], [0.9, 1.4, 0.06], 0.5, 0.17, DKW, 0.3);
        for (let r = 0; r < 4; r++) for (let k = 0; k < 3 - (r > 1 ? 1 : 0); k++) rock([(k - (r > 1 ? 0.5 : 1)) * 0.36 + (r % 2) * 0.08, 1.63 + r * 0.24, -0.08 - r * 0.02], 0.2, 0.13, 0.2 - r * 0.02, r * 5 + k + 40);
        m.frust(0, -0.12, 1.48, top, 0.52, 0.17, 0.3, 0.14, shade(ST, 0.8));
        // things on the mantel
        candle(-0.6, 1.49, 0.1, 0.14);
        candle(-0.5, 1.49, 0.14, 0.09);
        m.cyl([0.55, 1.49, 0.1], [0.55, 1.66, 0.1], 0.05, 0.07, 7, DC.clay, shade(DC.clay, 1.2));
        // andirons, logs, fire
        for (const sx of [-0.3, 0.3]) {
          rod([sx, 0.1, -0.1], [sx, 0.1, 0.22], 0.016, IRON);
          rod([sx, 0.1, 0.22], [sx, 0.4, 0.22], 0.016, IRON);
          m.ball([sx, 0.42, 0.22], 0.03, 0.03, 0.03, IRON, { lat: 2, lon: 5 });
        }
        firewood(0.12, 1.1);
        flame(0, 0.24, 0, 1.15);
        break;
      }
      case "campfire": {
        for (let k = 0; k < 9; k++) rock([Math.cos((k / 9) * TAU) * 0.47, 0.07, Math.sin((k / 9) * TAU) * 0.47], 0.13, 0.1, 0.12, k);
        disc([0, 0, 0], 0.4, 0.03, shade(ST, 0.35), 9);
        for (let k = 0; k < 5; k++) {
          const an = (k / 5) * TAU + 0.3;
          lg([Math.cos(an) * 0.34, 0.03, Math.sin(an) * 0.34], [Math.cos(an) * 0.02, 0.4, Math.sin(an) * 0.02], 0.05, 0.035, k % 2 ? BARK : shade(BARK, 0.55), 6);
        }
        flame(0, 0.1, 0, 1.35);
        break;
      }
      case "brazier": {
        for (let k = 0; k < 3; k++) {
          const an = (k / 3) * TAU;
          rod([Math.cos(an) * 0.3, 0, Math.sin(an) * 0.3], [Math.cos(an) * 0.1, 0.72, Math.sin(an) * 0.1], 0.022, IRON);
          rod([Math.cos(an) * 0.2, 0.36, Math.sin(an) * 0.2], [Math.cos(an + TAU / 3) * 0.2, 0.36, Math.sin(an + TAU / 3) * 0.2], 0.012, IRON, 4);
        }
        m.cyl([0, 0.66, 0], [0, 0.9, 0], 0.12, 0.3, 9, shade(IRON, 0.8), IRON, false);
        ringBand([0, 0.88, 0], 0.31, 0.035, shade(IRON, 1.3), 9);
        for (let k = 0; k < 5; k++) gl.ball([Math.cos(k * 1.3) * 0.13, 0.86, Math.sin(k * 1.3) * 0.13], 0.08, 0.05, 0.08, k % 2 ? DC.ember : [0.5, 0.12, 0.05], { lat: 2, lon: 5 });
        flame(0, 0.88, 0, 0.85);
        break;
      }
      case "torch": {
        for (let k = 0; k < 4; k++) rock([Math.cos(k * 1.6) * 0.13, 0.06, Math.sin(k * 1.6) * 0.13], 0.11, 0.08, 0.1, k);
        lg([0, 0, 0], [0.03, 1.55, 0], 0.045, 0.03, BARK, 6);
        m.cyl([0.03, 1.5, 0], [0.035, 1.72, 0], 0.045, 0.065, 7, shade(FUR, 0.5), shade(FUR, 0.7));
        rod([0.03, 1.56, 0], [0.03, 1.6, 0], 0.062, IRON, 7);
        flame(0.035, 1.72, 0, 0.6);
        break;
      }
      case "sconce": {
        m.abox(-0.05, 1.3, -0.15, 0.05, 1.5, -0.12, IRON);
        rod([0, 1.4, -0.13], [0, 1.36, 0.02], 0.016, IRON);
        ringBand([0, 1.33, 0.04], 0.045, 0.05, IRON, 6);
        lg([0, 1.22, 0.0], [0, 1.74, 0.09], 0.03, 0.035, BARK, 6);
        m.cyl([0, 1.7, 0.083], [0, 1.84, 0.107], 0.04, 0.055, 6, shade(FUR, 0.5), shade(FUR, 0.7));
        flame(0, 1.85, 0.11, 0.5);
        break;
      }
      case "candles": {
        for (let k = 0; k < 3; k++) rod([0, 0.12, 0], [Math.cos((k / 3) * TAU) * 0.2, 0, Math.sin((k / 3) * TAU) * 0.2], 0.018, IRON);
        rod([0, 0.1, 0], [0, 1.2, 0], 0.02, IRON, 6);
        for (const yy of [0.35, 0.8, 1.2]) m.ball([0, yy, 0], 0.04, 0.035, 0.04, IRON, { lat: 2, lon: 6 });
        for (let k = 0; k < 3; k++) {
          const an = (k / 3) * TAU + 0.5,
            x = Math.cos(an) * 0.2,
            z = Math.sin(an) * 0.2;
          rod([0, 1.12, 0], [x, 1.2, z], 0.012, IRON, 4);
          disc([x, 1.2, z], 0.045, 0.012, IRON, 6);
          candle(x, 1.21, z, 0.14 + 0.06 * rnd(k));
        }
        disc([0, 1.22, 0], 0.045, 0.012, IRON, 6);
        candle(0, 1.23, 0, 0.22);
        break;
      }
      case "chandelier": {
        const yy = drop - 1.05;
        for (let k = 0; k < 12; k++) {
          const a0 = (k / 12) * TAU,
            a1 = ((k + 1) / 12) * TAU;
          bm([Math.cos(a0) * 0.52, yy, Math.sin(a0) * 0.52], [Math.cos(a1) * 0.52, yy, Math.sin(a1) * 0.52], 0.07, 0.06, j(DKW, k), 0.3);
          if (k % 2 === 0) {
            disc([Math.cos(a0) * 0.52, yy + 0.03, Math.sin(a0) * 0.52], 0.04, 0.012, IRON, 6);
            candle(Math.cos(a0) * 0.52, yy + 0.04, Math.sin(a0) * 0.52, 0.13);
          }
          if (k % 4 === 0) rod([Math.cos(a0) * 0.5, yy + 0.03, Math.sin(a0) * 0.5], [0, yy + 0.62, 0], 0.01, IRON, 4);
        }
        rod([0, yy + 0.62, 0], [0, drop, 0], 0.014, IRON, 4);
        ringBand([0, yy + 0.58, 0], 0.035, 0.05, IRON, 6);
        break;
      }
      case "lamppost": {
        for (let k = 0; k < 5; k++) rock([Math.cos(k * 1.3) * 0.16, 0.08, Math.sin(k * 1.3) * 0.16], 0.13, 0.1, 0.12, k);
        bm([0, 0, 0], [0, 2.75, 0], 0.13, 0.13, DKW);
        bm([0, 2.6, -0.1], [0, 2.6, 0.62], 0.09, 0.09, DKW);
        bm([0, 2.05, 0.02], [0, 2.56, 0.42], 0.06, 0.06, OAK);
        rod([0, 2.56, 0.5], [0, 2.36, 0.5], 0.01, IRON, 4);
        m.cyl([0, 2.3, 0.5], [0, 2.4, 0.5], 0.13, 0.02, 4, IRON, IRON);
        m.abox(-0.1, 2.0, 0.4, 0.1, 2.03, 0.6, IRON);
        for (const sx of [-0.09, 0.09]) for (const sz of [0.41, 0.59]) rod([sx, 2.03, sz], [sx, 2.3, sz], 0.01, IRON, 4);
        gl.abox(-0.07, 2.05, 0.43, 0.07, 2.26, 0.57, DC.flame2);
        break;
      }
      case "cauldron": {
        for (let k = 0; k < 3; k++) {
          const an = (k / 3) * TAU + 0.5;
          lg([Math.cos(an) * 0.48, 0, Math.sin(an) * 0.48], [-Math.cos(an) * 0.05, 1.5, -Math.sin(an) * 0.05], 0.035, 0.028, BARK, 6);
        }
        ringBand([0, 1.36, 0], 0.07, 0.06, shade(LIN, 0.7), 6);
        rod([0, 1.36, 0], [0, 0.82, 0], 0.01, IRON, 4);
        m.cyl([0, 0.3, 0], [0, 0.52, 0], 0.16, 0.28, 10, shade(IRON, 0.8), IRON);
        m.cyl([0, 0.52, 0], [0, 0.72, 0], 0.28, 0.23, 10, IRON, IRON, [0.5, 0.42, 0.2]);
        ringBand([0, 0.7, 0], 0.245, 0.035, shade(IRON, 1.35), 10);
        rod([-0.23, 0.72, 0], [0, 0.84, 0], 0.01, IRON, 4);
        rod([0.23, 0.72, 0], [0, 0.84, 0], 0.01, IRON, 4);
        for (let k = 0; k < 6; k++) rock([Math.cos(k * 1.05) * 0.3, 0.05, Math.sin(k * 1.05) * 0.3], 0.09, 0.07, 0.09, k);
        firewood(0.02, 0.8);
        flame(0, 0.1, 0, 0.6);
        break;
      }
      case "barrel": {
        m.cyl([0, 0, 0], [0, 0.3, 0], 0.26, 0.32, 12, shade(OAK, 0.75), OAK);
        m.cyl([0, 0.3, 0], [0, 0.58, 0], 0.32, 0.32, 12, OAK, OAK, false);
        m.cyl([0, 0.58, 0], [0, 0.88, 0], 0.32, 0.26, 12, OAK, shade(OAK, 0.95), false);
        disc([0, 0.84, 0], 0.235, 0.012, shade(OAK, 0.72), 12);
        for (let k = 0; k < 12; k++) {
          const an = (k / 12) * TAU;
          m.abox(Math.cos(an) * 0.318 - 0.006, 0.05, Math.sin(an) * 0.318 - 0.006, Math.cos(an) * 0.318 + 0.006, 0.83, Math.sin(an) * 0.318 + 0.006, shade(DKW, 0.9));
        }
        for (const [yy, rr] of [
          [0.07, 0.285],
          [0.24, 0.318],
          [0.6, 0.325],
          [0.78, 0.29],
        ])
          ringBand([0, yy, 0], rr, 0.045, IRON, 12);
        m.cyl([0.32, 0.44, 0], [0.36, 0.44, 0], 0.03, 0.025, 6, DKW, DKW);
        break;
      }
      case "crate": {
        m.abox(-0.3, 0.03, -0.3, 0.3, 0.66, 0.3, shade(DKW, 0.6));
        for (let k = 0; k < 4; k++) {
          const yy = 0.1 + k * 0.165;
          bm([-0.34, yy, 0.33], [0.34, yy, 0.33], 0.04, 0.14, j(PINE, k));
          bm([-0.34, yy, -0.33], [0.34, yy, -0.33], 0.04, 0.14, j(PINE, k + 4));
          bm([0.33, yy, -0.34], [0.33, yy, 0.34], 0.04, 0.14, j(PINE, k + 8));
          bm([-0.33, yy, -0.34], [-0.33, yy, 0.34], 0.04, 0.14, j(PINE, k + 12));
        }
        for (const sx of [-0.33, 0.33]) for (const sz of [-0.33, 0.33]) bm([sx, 0, sz], [sx, 0.7, sz], 0.085, 0.085, DKW);
        for (let k = 0; k < 4; k++) bm([-0.36, 0.7, -0.26 + k * 0.175], [0.36, 0.7, -0.26 + k * 0.175], 0.16, 0.035, j(PINE, k + 16));
        bm([-0.3, 0.12, 0.355], [0.3, 0.6, 0.355], 0.03, 0.08, OAK);
        break;
      }
      case "sacks": {
        const SK = col(0xb9a06e);
        const sack = (x, y, z, sx, sy, sz, k, lean) => {
          m.ball([x, y + sy, z], sx, sy, sz, j(SK, k), { lat: 4, lon: 8 });
          m.cyl([x + lean * 0.3, y + sy * 1.8, z], [x + lean * 0.5, y + sy * 2.25, z], 0.05, 0.08, 6, shade(SK, 0.8), SK);
          ringBand([x + lean * 0.33, y + sy * 1.86, z], 0.055, 0.03, DKW, 6);
        };
        sack(-0.22, 0, 0.02, 0.24, 0.23, 0.2, 1, -0.1);
        sack(0.24, 0, -0.06, 0.22, 0.2, 0.22, 2, 0.15);
        m.ball([0.02, 0.5, 0.03], 0.3, 0.13, 0.2, j(SK, 3), { lat: 4, lon: 8 });
        m.ball([0.08, 0.14, 0.32], 0.2, 0.13, 0.15, j(SK, 4), { lat: 3, lon: 7 });
        break;
      }
      case "anvil": {
        m.cyl([0, 0, 0], [0, 0.5, 0], 0.29, 0.26, 10, shade(BARK, 0.8), BARK, END);
        ringBand([0, 0.36, 0], 0.275, 0.05, IRON, 10);
        m.frust(0, 0, 0.5, 0.6, 0.2, 0.13, 0.13, 0.09, IRON);
        m.frust(0, 0, 0.6, 0.72, 0.1, 0.07, 0.13, 0.09, shade(IRON, 0.9));
        bm([-0.26, 0.79, 0], [0.24, 0.79, 0], 0.2, 0.14, shade(IRON, 1.15), 0.15);
        m.cyl([0.24, 0.79, 0], [0.52, 0.83, 0], 0.07, 0.012, 7, shade(IRON, 1.1), shade(IRON, 1.3));
        lg([-0.2, 0.89, -0.03], [0.14, 0.89, 0.07], 0.018, 0.018, OAK, 5);
        bm([-0.25, 0.9, -0.09], [-0.2, 0.9, 0.03], 0.07, 0.07, shade(IRON, 0.8));
        break;
      }
      case "rack": {
        for (const sx of [-0.55, 0.55]) {
          bm([sx, 0, -0.16], [sx, 1.4, 0], 0.07, 0.07, DKW);
          bm([sx, 0, 0.16], [sx, 1.4, 0], 0.07, 0.07, DKW);
        }
        lg([-0.62, 1.38, 0], [0.62, 1.38, 0], 0.04, 0.04, BARK, 6);
        lg([-0.6, 0.42, 0.1], [0.6, 0.42, 0.1], 0.03, 0.03, BARK, 6);
        // spear, axe, sword, round shield
        lg([-0.38, 0.02, 0.2], [-0.4, 2.0, 0.03], 0.02, 0.018, PINE, 5);
        m.cyl([-0.4, 2.0, 0.03], [-0.403, 2.28, 0.006], 0.045, 0, 4, shade(IRON, 1.5), shade(IRON, 1.9), undefined, 0.3);
        lg([-0.14, 0.02, 0.2], [-0.15, 1.5, 0.04], 0.022, 0.02, OAK, 5);
        m.surf(1, 2, (u, v) => [-0.15 + (u ? 0.2 : 0.02), 1.42 + (u ? (v - 0.5) * 0.34 : (v - 0.5) * 0.12), 0.05], () => shade(IRON, 1.6));
        m.abox(0.07, 0.5, 0.11, 0.11, 1.32, 0.125, shade(IRON, 1.8));
        m.abox(0.0, 1.32, 0.105, 0.18, 1.35, 0.13, gold);
        lg([0.09, 1.35, 0.118], [0.09, 1.52, 0.118], 0.018, 0.018, DKW, 5);
        m.cyl([0.38, 0.8, 0.12], [0.38, 0.8, 0.16], 0.27, 0.27, 12, dye, dye, shade(dye, 1.05));
        m.cyl([0.38, 0.8, 0.115], [0.38, 0.8, 0.165], 0.285, 0.285, 12, IRON, IRON, false);
        m.ball([0.38, 0.8, 0.17], 0.07, 0.07, 0.04, shade(IRON, 1.6), { lat: 3, lon: 7 });
        m.abox(0.36, 0.56, 0.16, 0.4, 1.04, 0.165, shade(dye, 0.6));
        break;
      }
      case "haybale": {
        m.cyl([-0.45, 0.42, 0], [0.45, 0.42, 0], 0.42, 0.42, 12, shade(DC.straw, 0.85), DC.straw, shade(DC.straw, 1.12));
        for (const sx of [-0.2, 0.2]) m.cyl([sx - 0.012, 0.42, 0], [sx + 0.012, 0.42, 0], 0.428, 0.428, 12, shade(DKW, 1.2), shade(DKW, 1.2), false);
        for (let k = 0; k < 16; k++) {
          const an = rnd(k) * TAU,
            x = -0.4 + 0.8 * rnd(k + 20);
          rod([x, 0.42 + Math.cos(an) * 0.4, Math.sin(an) * 0.4], [x + 0.1 * (rnd(k + 5) - 0.5), 0.42 + Math.cos(an) * 0.52, Math.sin(an) * 0.52], 0.008, shade(DC.straw, 1.15), 3);
        }
        m.ball([0.1, 0.03, 0.5], 0.3, 0.05, 0.14, shade(DC.straw, 0.9), { lat: 2, lon: 7, flat: true, jit: 0.2, seed: 5 });
        break;
      }
      case "woodpile": {
        for (const sx of [-0.62, 0.62]) lg([sx, 0, 0], [sx, 0.85, 0], 0.04, 0.03, BARK, 6);
        let n = 0;
        for (let ry = 0; ry < 4; ry++)
          for (let k = 0; k < 5 - (ry % 2); k++) {
            const r = 0.1 + 0.025 * rnd(n++),
              x = -0.46 + k * 0.23 + (ry % 2) * 0.115;
            m.cyl([x, 0.11 + ry * 0.185, -0.36 + 0.05 * rnd(n)], [x, 0.11 + ry * 0.185, 0.36 - 0.05 * rnd(n + 3)], r, r, 7, j(BARK, n, 0.4), j(BARK, n + 1, 0.4), j(END, n, 0.25));
          }
        break;
      }
      case "trough": {
        for (const sx of [-0.55, 0.55]) {
          bm([sx, 0, -0.26], [sx, 0.42, 0.2], 0.07, 0.07, DKW);
          bm([sx, 0, 0.26], [sx, 0.42, -0.2], 0.07, 0.07, DKW);
        }
        m.cyl([-0.75, 0.42, 0], [0.75, 0.42, 0], 0.27, 0.27, 9, shade(BARK, 0.8), BARK, END, 0.8);
        m.abox(-0.68, 0.44, -0.19, 0.68, 0.645, 0.19, shade(DKW, 0.5));
        m.surf(4, 2, (u, v) => [-0.67 + 1.34 * u, 0.6 + 0.006 * Math.sin(u * 9 + v * 4), -0.18 + 0.36 * v], (u, v) => shade(DC.water, 0.9 + 0.2 * Math.sin(u * 7 + v * 5)));
        break;
      }
      case "cart": {
        for (let k = 0; k < 4; k++) bm([-0.85, 0.56, -0.33 + k * 0.22], [0.85, 0.56, -0.33 + k * 0.22], 0.21, 0.05, j(OAK, k));
        for (const sz of [-0.43, 0.43]) {
          bm([-0.85, 0.84, sz], [0.85, 0.84, sz], 0.05, 0.07, DKW);
          bm([-0.85, 0.68, sz], [0.85, 0.68, sz], 0.035, 0.07, j(PINE, sz > 0 ? 1 : 2));
          for (const sx of [-0.8, -0.27, 0.27, 0.8]) bm([sx, 0.56, sz], [sx, 0.9, sz], 0.05, 0.05, DKW);
          wheel([-0.1, 0.42, sz * 1.28], 0.42);
          lg([0.8, 0.6, sz * 0.8], [1.75, 0.72, sz * 0.75], 0.035, 0.025, BARK, 6);
        }
        bm([-0.85, 0.76, -0.43], [-0.85, 0.76, 0.43], 0.04, 0.2, j(OAK, 9));
        lg([-0.1, 0.42, -0.6], [-0.1, 0.42, 0.6], 0.035, 0.035, DKW, 6);
        bm([0.75, 0, 0], [0.75, 0.54, 0], 0.06, 0.06, DKW);
        m.ball([-0.3, 0.72, 0], 0.45, 0.2, 0.34, DC.straw, { lat: 3, lon: 8, flat: true, jit: 0.12, seed: 3 });
        m.ball([0.45, 0.72, 0.1], 0.2, 0.15, 0.18, col(0xb9a06e), { lat: 4, lon: 7 });
        break;
      }
      case "well": {
        for (let r = 0; r < 3; r++)
          for (let k = 0; k < 11; k++) {
            const an = ((k + (r % 2) * 0.5) / 11) * TAU;
            rock([Math.cos(an) * 0.74, 0.13 + r * 0.26, Math.sin(an) * 0.74], 0.22, 0.15, 0.17, r * 11 + k);
          }
        ringBand([0, 0, 0], 0.62, 0.8, shade(ST, 0.35), 11);
        disc([0, 0.4, 0], 0.62, 0.02, shade(DC.water, 0.7), 11);
        for (const sx of [-0.92, 0.92]) {
          bm([sx, 0, 0], [sx, 2.25, 0], 0.11, 0.11, DKW);
          bm([sx, 1.75, 0], [sx * 0.6, 2.2, 0], 0.06, 0.06, OAK);
        }
        lg([-0.98, 1.7, 0], [0.98, 1.7, 0], 0.07, 0.07, BARK, 8);
        rod([0.98, 1.7, 0], [1.12, 1.7, 0], 0.018, IRON);
        rod([1.12, 1.7, 0], [1.12, 1.52, 0], 0.018, IRON);
        rod([1.12, 1.52, 0], [1.26, 1.52, 0], 0.018, IRON);
        for (let k = 0; k < 4; k++) ringBand([-0.12 + k * 0.05, 1.7, 0], 0, 0, LIN, 3), m.cyl([-0.14 + k * 0.055, 1.7, 0], [-0.1 + k * 0.055, 1.7, 0], 0.085, 0.085, 8, shade(LIN, 0.8), shade(LIN, 0.8), false);
        rod([0.1, 1.63, 0], [0.1, 1.22, 0], 0.012, shade(LIN, 0.8), 4);
        m.cyl([0.1, 0.98, 0], [0.1, 1.2, 0], 0.1, 0.13, 8, shade(OAK, 0.8), OAK, shade(DKW, 0.5));
        ringBand([0.1, 1.05, 0], 0.115, 0.03, IRON, 8);
        for (const sz of [-1, 1]) m.surf(5, 3, (u, v) => [-1.12 + 2.24 * u, 2.72 - 0.56 * v - 0.04 * Math.sin(Math.PI * u) * v, sz * (0.02 + 0.74 * v)], (u, v) => shade(DC.straw, (sz > 0 ? 0.95 : 0.8) + 0.2 * rnd(Math.floor(u * 5) + Math.floor(v * 3) * 9) - 0.12 * v));
        lg([-1.16, 2.74, 0], [1.16, 2.74, 0], 0.05, 0.05, BARK, 6);
        break;
      }
      case "fountain": {
        for (let k = 0; k < 16; k++) {
          const a0 = (k / 16) * TAU,
            a1 = ((k + 1) / 16) * TAU;
          bm([Math.cos(a0) * 1.25, 0.2, Math.sin(a0) * 1.25], [Math.cos(a1) * 1.25, 0.2, Math.sin(a1) * 1.25], 0.3, 0.4, j(ST, k, 0.25), 0.25);
          bm([Math.cos(a0) * 1.25, 0.45, Math.sin(a0) * 1.25], [Math.cos(a1) * 1.25, 0.45, Math.sin(a1) * 1.25], 0.38, 0.1, j(shade(ST, 1.15), k + 16, 0.15), 0.3);
        }
        disc([0, 0, 0], 1.2, 0.05, shade(ST, 0.5), 16);
        m.surf(8, 2, (u, v) => {
          const an = u * TAU,
            r = 0.2 + 0.95 * v;
          return [Math.cos(an) * r, 0.33 + 0.012 * Math.sin(an * 5 + v * 9), Math.sin(an) * r];
        }, (u, v) => shade(DC.water, 0.85 + 0.25 * Math.sin(u * 31 + v * 7)));
        m.cyl([0, 0, 0], [0, 0.5, 0], 0.3, 0.2, 8, shade(ST, 0.8), ST);
        m.cyl([0, 0.5, 0], [0, 1.15, 0], 0.13, 0.11, 8, ST, shade(ST, 1.1));
        m.cyl([0, 1.15, 0], [0, 1.36, 0], 0.14, 0.55, 12, shade(ST, 0.85), shade(ST, 1.15), shade(DC.water, 0.95));
        ringBand([0, 1.33, 0], 0.56, 0.05, shade(ST, 1.2), 12);
        m.cyl([0, 1.36, 0], [0, 1.72, 0], 0.09, 0.06, 7, ST, shade(ST, 1.15));
        m.ball([0, 1.78, 0], 0.09, 0.09, 0.09, shade(ST, 1.2), { lat: 3, lon: 6 });
        for (let k = 0; k < 4; k++) {
          const an = (k / 4) * TAU + 0.4;
          m.cyl([Math.cos(an) * 0.5, 1.34, Math.sin(an) * 0.5], [Math.cos(an) * 0.66, 0.35, Math.sin(an) * 0.66], 0.03, 0.05, 5, shade(DC.water, 1.35), shade(DC.water, 1.15), false);
        }
        break;
      }
      case "stall": {
        for (const sx of [-1.15, 1.15]) {
          bm([sx, 0, -0.62], [sx, 2.36, -0.62], 0.1, 0.1, DKW);
          bm([sx, 0, 0.62], [sx, 1.98, 0.62], 0.1, 0.1, DKW);
          bm([sx, 2.38, -0.7], [sx, 1.94, 0.82], 0.07, 0.08, OAK);
          bm([sx, 1.5, -0.62], [sx, 2.1, -0.2], 0.05, 0.05, OAK);
        }
        bm([-1.2, 2.32, -0.62], [1.2, 2.32, -0.62], 0.08, 0.08, DKW);
        bm([-1.2, 1.96, 0.72], [1.2, 1.96, 0.72], 0.07, 0.07, DKW);
        for (let k = 0; k < 3; k++) bm([-1.22, 0.88, 0.08 + k * 0.24], [1.22, 0.88, 0.08 + k * 0.24], 0.23, 0.06, j(PINE, k));
        for (let k = 0; k < 9; k++) bm([-1.0 + k * 0.25, 0.05, 0.6], [-1.0 + k * 0.25, 0.84, 0.6], 0.04, 0.23, j(OAK, k + 3));
        // striped awning that sags, with a scalloped front edge
        m.surf(12, 5, (u, v) => {
          const sc = v === 1 ? 0.07 * Math.abs(Math.sin(u * Math.PI * 6)) : 0;
          return [-1.3 + 2.6 * u, 2.42 - 0.48 * v - 0.07 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) - sc * 1.2, -0.72 + 1.6 * v + sc * 0.2];
        }, (u) => (Math.floor(u * 6 + 0.001) % 2 ? shade(LIN, 0.95) : dye), true);
        // wares: apples, loaves, cabbages in baskets and trays
        const basket = (x, z, fill, r) => {
          m.cyl([x, 0.91, z], [x, 1.06, z], 0.15, 0.2, 9, shade(DC.straw, 0.6), shade(DC.straw, 0.85), false);
          for (let k = 0; k < 7; k++) m.ball([x + Math.cos(k * 0.9) * 0.1 * (k ? 1 : 0), 1.06 + (k ? 0 : 0.05), z + Math.sin(k * 0.9) * 0.1 * (k ? 1 : 0)], r, r, r, shade(fill, 0.85 + 0.3 * rnd(k)), { lat: 3, lon: 6 });
        };
        basket(-0.85, 0.32, [0.75, 0.18, 0.15], 0.06);
        basket(-0.42, 0.34, [0.86, 0.62, 0.2], 0.06);
        for (let k = 0; k < 3; k++) m.ball([0.05 + k * 0.2, 0.96, 0.3 + 0.04 * (k % 2)], 0.1, 0.055, 0.075, [0.78, 0.58, 0.3], { lat: 3, lon: 7 });
        for (let k = 0; k < 3; k++) m.ball([0.78 + (k % 2) * 0.2, 1.0, 0.22 + k * 0.1], 0.1, 0.09, 0.1, j(DC.leaf, k, 0.3), { lat: 3, lon: 6, flat: true, jit: 0.1, seed: k + 2 });
        for (let k = 0; k < 3; k++) rod([-0.5 + k * 0.4, 2.3, -0.6], [-0.5 + k * 0.4, 1.95, -0.6], 0.008, LIN, 3), m.ball([-0.5 + k * 0.4, 1.86, -0.6], 0.05, 0.11, 0.05, k % 2 ? [0.55, 0.25, 0.2] : [0.8, 0.74, 0.5], { lat: 3, lon: 6 });
        m.cyl([-0.7, 0, 0.1], [-0.7, 0.5, 0.1], 0.2, 0.22, 9, shade(OAK, 0.7), OAK, shade(OAK, 0.6));
        break;
      }
      case "signpost": {
        for (let k = 0; k < 4; k++) rock([Math.cos(k * 1.6) * 0.14, 0.06, Math.sin(k * 1.6) * 0.14], 0.12, 0.09, 0.11, k);
        lg([0, 0, 0], [0.06, 2.15, 0.02], 0.065, 0.045, BARK, 7);
        const board = (y, dir, tilt, k) => {
          m.surf(3, 1, (u, v) => {
            const x = dir * (-0.12 + 0.9 * u),
              tip = u > 0.99 ? 0.5 : v;
            return [x + 0.05, y + (tip - 0.5) * 0.2 * (u > 0.99 ? 0 : 1) + tilt * u, 0.07 + k * 0.02];
          }, () => j(PINE, k));
          m.ball([0.05, y, 0.085 + k * 0.02], 0.018, 0.018, 0.012, IRON, { lat: 2, lon: 5 });
        };
        board(1.82, 1, 0.05, 0);
        board(1.52, -1, -0.04, 1);
        board(1.24, 1, -0.06, 2);
        break;
      }
      case "statue": {
        const LS = shade(ST, 1.22),
          limb = (a, b, r0, r1) => m.cyl(a, b, r0, r1, 6, shade(LS, 0.82), LS);
        bm([0, 0.12, -0.45], [0, 0.12, 0.45], 0.9, 0.24, shade(ST, 0.9), 0.15);
        bm([0, 0.45, -0.36], [0, 0.45, 0.36], 0.72, 0.42, ST, 0.12);
        bm([0, 0.7, -0.4], [0, 0.7, 0.4], 0.8, 0.09, shade(ST, 1.1), 0.3);
        limb([-0.12, 0.74, 0], [-0.1, 1.42, 0], 0.085, 0.1);
        limb([0.12, 0.74, 0.04], [0.1, 1.42, 0], 0.085, 0.1);
        limb([0, 1.38, 0], [0, 1.95, 0], 0.19, 0.24);
        m.surf(4, 3, (u, v) => [-0.26 + 0.52 * u, 1.92 - 0.95 * v, -0.14 - 0.1 * v - 0.04 * Math.sin(u * 6)], (u, v) => shade(LS, 0.75 + 0.1 * Math.sin(u * 9)));
        limb([-0.24, 1.9, 0], [-0.32, 1.42, 0.12], 0.075, 0.06);
        limb([0.24, 1.9, 0], [0.34, 1.5, 0.16], 0.075, 0.06);
        limb([0.34, 1.5, 0.16], [0.3, 1.2, 0.3], 0.06, 0.05);
        m.ball([0, 2.12, 0], 0.13, 0.15, 0.13, LS, { lat: 4, lon: 7 });
        m.cyl([0, 2.16, 0], [0, 2.36, 0], 0.14, 0.03, 7, shade(LS, 0.9), LS);
        m.abox(-0.012, 2.02, 0.12, 0.012, 2.2, 0.14, shade(LS, 0.8));
        bm([0.3, 0.74, 0.32], [0.3, 1.7, 0.32], 0.02, 0.07, shade(LS, 1.05), 0.4);
        bm([0.2, 1.3, 0.32], [0.4, 1.3, 0.32], 0.03, 0.04, LS);
        m.cyl([-0.36, 1.35, 0.1], [-0.4, 1.35, 0.13], 0.3, 0.3, 10, shade(LS, 0.9), LS);
        m.ball([-0.41, 1.35, 0.135], 0.07, 0.07, 0.05, LS, { lat: 2, lon: 6 });
        for (let k = 0; k < 6; k++) m.ball([(rnd(k) - 0.5) * 0.7, 0.26 + rnd(k + 9) * 0.4, (rnd(k + 3) > 0.5 ? 1 : -1) * 0.37], 0.1, 0.07, 0.02, shade(DC.leaf2, 0.8), { lat: 2, lon: 5, flat: true, jit: 0.3, seed: k });
        break;
      }
      case "scarecrow": {
        lg([0, 0, 0], [0.02, 1.9, 0], 0.045, 0.035, BARK, 6);
        lg([-0.72, 1.4, 0], [0.72, 1.44, 0], 0.03, 0.028, BARK, 6);
        m.surf(8, 5, (u, v) => {
          const x = -0.6 + 1.2 * u,
            arm = Math.abs(x) > 0.24,
            len = arm ? 0.26 : 0.72;
          return [x, 1.47 - len * v - (v === 1 ? 0.05 * rnd(Math.round(u * 8)) : 0), (0.07 + 0.03 * Math.sin(u * 14)) * Math.sin(Math.PI * Math.min(1, v * 1.4)) + 0.02];
        }, (u, v) => shade(dye, 0.75 + 0.25 * rnd(Math.round(u * 8) + Math.round(v * 5) * 9)));
        m.surf(8, 5, (u, v) => {
          const x = -0.6 + 1.2 * u,
            arm = Math.abs(x) > 0.24,
            len = arm ? 0.26 : 0.72;
          return [x, 1.47 - len * v, -(0.07 + 0.03 * Math.sin(u * 11)) * Math.sin(Math.PI * Math.min(1, v * 1.4)) - 0.02];
        }, () => shade(dye, 0.62));
        ringBand([0, 1.08, 0], 0.12, 0.04, DKW, 7);
        for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) rod([sx * 0.6, 1.4, 0], [sx * (0.74 + 0.06 * rnd(k)), 1.3 + 0.07 * k, (rnd(k + 5) - 0.5) * 0.12], 0.01, DC.straw, 3);
        for (let k = 0; k < 6; k++) rod([(rnd(k) - 0.5) * 0.2, 0.78, (rnd(k + 2) - 0.5) * 0.1], [(rnd(k) - 0.5) * 0.34, 0.6, (rnd(k + 2) - 0.5) * 0.2], 0.01, DC.straw, 3);
        m.ball([0.01, 1.66, 0], 0.15, 0.17, 0.15, col(0xb9a06e), { lat: 4, lon: 7 });
        m.abox(-0.07, 1.69, 0.135, -0.03, 1.72, 0.15, DKW);
        m.abox(0.04, 1.69, 0.135, 0.08, 1.72, 0.15, DKW);
        disc([0.01, 1.79, 0], 0.3, 0.015, shade(DC.straw, 0.85), 10);
        m.cyl([0.01, 1.8, 0], [0.03, 2.06, 0], 0.15, 0.04, 8, shade(DC.straw, 0.8), DC.straw);
        break;
      }
      case "banner": {
        lg([0, 0, 0], [0, 2.55, 0], 0.03, 0.024, DKW, 6);
        m.ball([0, 2.6, 0], 0.05, 0.06, 0.05, gold, { lat: 3, lon: 6 });
        lg([-0.42, 2.38, 0.02], [0.42, 2.38, 0.02], 0.02, 0.02, DKW, 5);
        for (const sx of [-0.42, 0.42]) m.ball([sx, 2.38, 0.02], 0.03, 0.03, 0.03, gold, { lat: 2, lon: 5 });
        m.surf(12, 14, (u, v) => [-0.36 + 0.72 * u, 2.37 - v * (1.1 + 0.32 * Math.abs(2 * u - 1)), 0.035 + 0.05 * v * Math.sin(v * 5 + u * 3)], (u, v) => {
          const e = Math.min(u, 1 - u),
            dia = Math.abs(u - 0.5) * 2.4 + Math.abs(v - 0.42) * 2.2;
          return e < 0.07 || v < 0.05 ? gold : dia < 0.3 ? gold : dia < 0.42 ? shade(dye, 0.6) : shade(dye, 0.9 + 0.12 * Math.sin(v * 9));
        }, true);
        break;
      }
      case "flag": {
        for (let k = 0; k < 5; k++) rock([Math.cos(k * 1.3) * 0.17, 0.08, Math.sin(k * 1.3) * 0.17], 0.14, 0.1, 0.13, k);
        lg([0, 0, 0], [0, 5.1, 0], 0.06, 0.035, DKW, 7);
        m.ball([0, 5.16, 0], 0.07, 0.08, 0.07, gold, { lat: 3, lon: 6 });
        m.surf(10, 8, (u, v) => [0.04 + 1.35 * u, 4.95 - 0.8 * v - 0.12 * u * u + 0.03 * Math.sin(u * 7), 0.11 * u * Math.sin(u * 8 + v * 2)], (u, v) => (v > 0.38 && v < 0.62 ? gold : shade(dye, 0.85 + 0.18 * Math.sin(u * 8 + 1))), true);
        break;
      }
      case "tent": {
        for (const sz of [-1.12, 1.12]) {
          lg([-0.16, 0, sz], [0.03, 1.62, sz], 0.035, 0.03, BARK, 6);
          lg([0.16, 0, sz], [-0.03, 1.62, sz], 0.035, 0.03, BARK, 6);
        }
        lg([0, 1.55, -1.25], [0, 1.55, 1.25], 0.035, 0.035, BARK, 6);
        for (const sx of [-1, 1])
          m.surf(4, 6, (u, v) => {
            const sag = 0.07 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
            return [sx * (0.02 + 1.12 * u - sag), 1.57 - 1.55 * u - sag, -1.15 + 2.3 * v];
          }, (u, v) => shade(dye, (sx > 0 ? 0.8 : 1) - 0.12 * u + 0.05 * Math.sin(v * 21)));
        // back wall, and front flaps tied open
        m.surf(4, 3, (u, v) => [(-1.1 + 2.2 * u) * (1 - v), 1.52 * v, -1.14], () => shade(dye, 0.7));
        for (const sx of [-1, 1]) m.surf(2, 3, (u, v) => [sx * (1.1 - 0.62 * u) * (1 - v) + sx * 0.12 * v, 1.52 * v, 1.14 + 0.12 * u * (1 - v)], () => shade(dye, 0.86));
        for (const sx of [-1, 1])
          for (const sz of [-1, 1]) {
            rod([sx * 0.9, 0.32, sz * 1.1], [sx * 1.45, 0, sz * 1.45], 0.006, LIN, 3);
            lg([sx * 1.45, 0, sz * 1.45], [sx * 1.42, 0.16, sz * 1.42], 0.02, 0.015, DKW, 5);
          }
        m.surf(4, 5, (u, v) => [-0.42 + 0.84 * u, 0.04 + 0.02 * Math.sin(u * 6 + v * 5), -0.9 + 1.5 * v], (u, v) => shade(FUR, 0.8 + 0.3 * rnd(Math.floor(u * 4) + Math.floor(v * 5) * 7)));
        m.cyl([-0.3, 0.1, -0.85], [0.3, 0.1, -0.85], 0.09, 0.09, 7, shade(LIN, 0.8), shade(LIN, 0.8), shade(LIN, 0.6));
        break;
      }
      case "flowerbed": {
        lg([-0.85, 0.08, -0.34], [0.85, 0.08, -0.34], 0.08, 0.075, BARK, 7);
        lg([-0.85, 0.08, 0.34], [0.85, 0.08, 0.34], 0.075, 0.08, BARK, 7);
        lg([-0.8, 0.08, -0.4], [-0.8, 0.08, 0.4], 0.075, 0.075, BARK, 7);
        lg([0.8, 0.08, -0.4], [0.8, 0.08, 0.4], 0.075, 0.075, BARK, 7);
        m.surf(6, 3, (u, v) => [-0.76 + 1.52 * u, 0.1 + 0.06 * Math.sin(Math.PI * v) + 0.02 * Math.sin(u * 13), -0.3 + 0.6 * v], (u, v) => shade(DC.soil, 0.8 + 0.3 * rnd(Math.floor(u * 6) + Math.floor(v * 3) * 9)));
        for (let k = 0; k < 15; k++) {
          const x = -0.68 + (k % 5) * 0.34 + 0.12 * (rnd(k) - 0.5),
            z = -0.2 + Math.floor(k / 5) * 0.2 + 0.08 * (rnd(k + 30) - 0.5),
            hh = 0.34 + 0.3 * rnd(k + 20),
            lx = 0.08 * (rnd(k + 7) - 0.5),
            fc = k % 3 === 0 ? DYES[((ci || 0) + 3) % 6][1] : k % 3 === 1 ? shade(dye, 1.2) : dye;
          rod([x, 0.12, z], [x + lx, hh, z + lx * 0.5], 0.01, DC.leaf2, 3);
          m.surf(1, 2, (u, v) => [x + (u - 0.5) * 0.07 * (1 - v) + 0.1 * v * (k % 2 ? 1 : -1), 0.18 + 0.12 * v, z + 0.05 * v], () => DC.leaf);
          if (k % 4 === 3) m.cyl([x + lx, hh - 0.06, z + lx * 0.5], [x + lx, hh + 0.12, z + lx * 0.5], 0.035, 0.012, 5, shade(fc, 0.8), fc);
          else {
            for (let q = 0; q < 5; q++) m.ball([x + lx + Math.cos(q * 1.257) * 0.04, hh, z + lx * 0.5 + Math.sin(q * 1.257) * 0.04], 0.03, 0.014, 0.03, fc, { lat: 2, lon: 5 });
            m.ball([x + lx, hh + 0.01, z + lx * 0.5], 0.02, 0.016, 0.02, gold, { lat: 2, lon: 5 });
          }
        }
        break;
      }
      case "bush": {
        const blobs = [
          [0, 0.42, 0, 0.5, 0.42, 0.45],
          [0.28, 0.62, 0.15, 0.36, 0.34, 0.34],
          [-0.3, 0.55, -0.1, 0.36, 0.36, 0.38],
          [0.05, 0.82, -0.12, 0.32, 0.26, 0.3],
          [-0.12, 0.5, 0.33, 0.3, 0.3, 0.26],
          [0.3, 0.36, -0.3, 0.28, 0.28, 0.26],
        ];
        blobs.forEach((q, k) => m.ball([q[0], q[1], q[2]], q[3], q[4], q[5], j(k % 2 ? DC.leaf : DC.leaf2, k, 0.3), { flat: true, jit: 0.2, seed: k + 3, lat: 4, lon: 7 }));
        for (let k = 0; k < 9; k++) {
          const an = rnd(k) * TAU,
            el = 0.3 + rnd(k + 9) * 0.9;
          m.ball([Math.cos(an) * 0.48 * Math.cos(el - 0.5), 0.45 + Math.sin(el) * 0.42, Math.sin(an) * 0.44 * Math.cos(el - 0.5)], 0.035, 0.035, 0.035, dye, { lat: 2, lon: 5 });
        }
        lg([0, 0, 0], [0.03, 0.3, 0], 0.04, 0.03, BARK, 5);
        break;
      }
    }
    const out = { m, gl };
    decorCache.set(key, out);
    return out;
  }
  // stamp a modelled piece into a structure's geometry at its place and turn
  function decorPieces(g, glow, it, y, ceil) {
    const [x, z, kind, rot, ci] = it,
      a = ((rot || 0) * Math.PI) / 4,
      c = Math.cos(a),
      s = Math.sin(a),
      src = decorGeo(kind, ci || 0, ceil - y);
    for (const [from, to] of [
      [src.m, g],
      [src.gl, glow],
    ]) {
      const p = from.p,
        n = from.n,
        cc = from.c;
      for (let k = 0; k < p.length; k += 3) {
        to.p.push(x + p[k] * c + p[k + 2] * s, y + p[k + 1], z - p[k] * s + p[k + 2] * c);
        to.n.push(n[k] * c + n[k + 2] * s, n[k + 1], -n[k] * s + n[k + 2] * c);
        to.c.push(cc[k], cc[k + 1], cc[k + 2]);
      }
    }
  }
  const onFloorAt = (S, x, z) => (S.floors.has(ck(Math.floor(x), Math.floor(z))) && !(S.id && wellOver(S, Math.floor(x), Math.floor(z)))) || inRings(S, x, z) || (S.polys || []).some((p) => pip(p.pts, x, z));
  // height of a decoration above its structure's base: on the floor if there is one, else on the ground
  function decorY(D, it) {
    const base = D.base || D;
    if (onFloorAt(base, it[0], it[1])) return FLOOR_T;
    const fr = D.ox !== undefined ? D : D.frame;
    if (!fr) return 0;
    const [X, Z] = toWorld(fr, it[0], it[1]);
    return G.heightAt(X, Z) - fr.y0;
  }
  const nearestDecor = (S, lx, lz, reach) => {
    let best = -1,
      bd = reach;
    S.decor.forEach((d, n) => {
      const dist = Math.hypot(d[0] - lx, d[1] - lz);
      if (dist < bd) ((bd = dist), (best = n));
    });
    return best;
  };
  // a path or road, draped over the ground
  function pathPieces(g, F, p, n) {
    const [x0, z0, x1, z1, w, mat] = p,
      dx = x1 - x0,
      dz = z1 - z0,
      L = Math.hypot(dx, dz) || 1,
      ux = dx / L,
      uz = dz / L,
      ext = w * 0.35,
      na = Math.max(1, Math.round((L + 2 * ext) / 0.5)),
      nb = Math.max(2, Math.round(w / 0.5)),
      c = PATHS[mat || "cobble"].c,
      boards = mat === "boards";
    const pt = [];
    for (let a = 0; a <= na; a++) {
      pt.push([]);
      for (let b = 0; b <= nb; b++) {
        const edge = b === 0 || b === nb ? (hash(a, n, b) - 0.5) * 0.16 : 0,
          al = -ext + (a / na) * (L + 2 * ext),
          ac = (b / nb - 0.5) * w + edge,
          lx = x0 + ux * al - uz * ac,
          lz = z0 + uz * al + ux * ac,
          [X, Z] = toWorld(F, lx, lz);
        pt[a].push([lx, G.heightAt(X, Z) - F.y0 + 0.05 + (n % 5) * 0.007, lz]);
      }
    }
    for (let a = 0; a < na; a++)
      for (let b = 0; b < nb; b++) {
        const colr = shade(c, boards ? 0.86 + 0.2 * hash(a, n, 1) : 0.8 + 0.3 * hash(a * 3 + n, b, 7));
        g.tri(pt[a][b], pt[a + 1][b], pt[a + 1][b + 1], [0, 1, 0], colr);
        g.tri(pt[a][b], pt[a + 1][b + 1], pt[a][b + 1], [0, 1, 0], colr);
      }
  }

  const DIRS = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  const HEIGHTS = [
    [0.8, "Low"],
    [1, "Normal"],
    [1.5, "Tall"],
    [2, "Grand"],
  ];
  const stairLen = (hs) => Math.max(3, Math.round(3 * hs));
  const sameGrid = (A, Bq) => A.ox === Bq.ox && A.oz === Bq.oz && A.yaw === Bq.yaw;
  // is this floor tile an opening above a staircase coming up from the storey below?
  function wellOver(U, i, j) {
    for (const S of B.structs) {
      if (S === U || !S.stairs.length || !sameGrid(S, U) || Math.abs(S.y0 + EAVE * S.hs - U.y0) > 0.3) continue;
      const n = stairLen(S.hs);
      for (const st of S.stairs) {
        const [dx, dz] = DIRS[st.dir];
        for (let m = 0; m < n; m++) if (st.i + dx * m === i && st.j + dz * m === j) return true;
      }
    }
    return false;
  }
  function stairH(S, lx, lz) {
    const n = stairLen(S.hs);
    for (const st of S.stairs) {
      const [dx, dz] = DIRS[st.dir],
        rx = lx - (st.i + 0.5),
        rz = lz - (st.j + 0.5),
        along = rx * dx + rz * dz + 0.5,
        lat = Math.abs(-rx * dz + rz * dx);
      if (lat <= 0.5 && along >= -0.05 && along <= n + 0.05) return FLOOR_T + clamp(along / n, 0, 1) * EAVE * S.hs;
    }
    return null;
  }
  function stairPieces(g, st, hs) {
    const steps = stairLen(hs) * 4,
      [dx, dz] = DIRS[st.dir],
      sx = st.i + 0.5 - dx * 0.5,
      sz = st.j + 0.5 - dz * 0.5;
    for (let m = 0; m < steps; m++) {
      const mid = (m + 0.5) * 0.25,
        cx = sx + dx * mid,
        cz = sz + dz * mid,
        hx = dx ? 0.125 : 0.46,
        hz = dz ? 0.125 : 0.46;
      g.abox(cx - hx, 0, cz - hz, cx + hx, FLOOR_T + ((m + 1) / steps) * EAVE * hs, cz + hz, shade(C.floor, 0.82 + 0.2 * hash(st.i, st.j, m)));
    }
    // handrails
    const L = stairLen(hs),
      rise = EAVE * hs;
    for (const side of [-1, 1]) {
      const lx = -dz * 0.47 * side,
        lz = dx * 0.47 * side;
      g.obox([sx + (dx * L) / 2 + lx, FLOOR_T + rise / 2 + 0.95, sz + (dz * L) / 2 + lz], [(dx * L) / 2, rise / 2, (dz * L) / 2], [0, 0.04, 0], [-dz * 0.035, 0, dx * 0.035], C.beam);
      for (const t of [0.02, 0.5, 0.98]) {
        const px = sx + dx * L * t + lx,
          pz = sz + dz * L * t + lz,
          py = FLOOR_T + rise * t;
        g.abox(px - 0.04, py - 0.1, pz - 0.04, px + 0.04, py + 0.97, pz + 0.04, C.beam);
      }
    }
  }
  function pip(pts, x, z) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i],
        b = pts[j];
      if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  // closed shapes made with at least one angled wall: found as faces of the wall graph
  function findPolys(S) {
    if (!S.segs.length) return [];
    const raw = S.segs.map((sg) => [sg[0], sg[1], sg[2], sg[3], 1]);
    for (const k of S.walls.keys()) {
      const [i, j, d] = parse(k);
      raw.push(d === 0 ? [i, j, i + 1, j, 0] : [i, j, i, j + 1, 0]);
    }
    const pts = [];
    for (const e of raw) pts.push([e[0], e[1]], [e[2], e[3]]);
    const key = (x, z) => Math.round(x * 20) + "," + Math.round(z * 20);
    const adj = new Map(),
      pos = new Map();
    const link = (a, b, free) => {
      if (a === b) return;
      adj.has(a) || adj.set(a, []);
      adj.get(a).some((o) => o.to === b) || adj.get(a).push({ to: b, free });
    };
    for (const e of raw) {
      const dx = e[2] - e[0],
        dz = e[3] - e[1],
        L2 = dx * dx + dz * dz,
        cuts = [0, 1];
      for (const p of pts) {
        const t = ((p[0] - e[0]) * dx + (p[1] - e[1]) * dz) / L2;
        if (t > 0.02 && t < 0.98 && Math.hypot(p[0] - e[0] - dx * t, p[1] - e[1] - dz * t) < 0.04) cuts.push(t);
      }
      cuts.sort((a, b) => a - b);
      for (let c = 0; c < cuts.length - 1; c++) {
        if (cuts[c + 1] - cuts[c] < 1e-3) continue;
        const p = [e[0] + dx * cuts[c], e[1] + dz * cuts[c]],
          q = [e[0] + dx * cuts[c + 1], e[1] + dz * cuts[c + 1]],
          a = key(p[0], p[1]),
          b = key(q[0], q[1]);
        pos.set(a, p);
        pos.set(b, q);
        link(a, b, e[4]);
        link(b, a, e[4]);
      }
    }
    // drop dead ends
    for (let again = true; again; ) {
      again = false;
      for (const [a, list] of adj)
        if (list.length < 2) {
          for (const o of list) adj.set(o.to, adj.get(o.to).filter((x) => x.to !== a));
          adj.delete(a);
          again = true;
        }
    }
    for (const [a, list] of adj) {
      const p = pos.get(a);
      for (const o of list) {
        const q = pos.get(o.to);
        o.ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
      }
      list.sort((x, y) => x.ang - y.ang);
    }
    const seen = new Set(),
      out = [];
    for (const [a, list] of adj)
      for (const o of list) {
        if (seen.has(a + ">" + o.to)) continue;
        let u = a,
          v = o.to,
          free = o.free,
          guard = 0;
        const poly = [];
        while (guard++ < 600) {
          seen.add(u + ">" + v);
          poly.push(pos.get(u));
          const lv = adj.get(v),
            back = lv.findIndex((x) => x.to === u),
            nx = lv[(back - 1 + lv.length) % lv.length];
          u = v;
          v = nx.to;
          if (u === a && v === o.to) break;
          free = free || nx.free;
        }
        if (guard >= 600 || !free || poly.length < 3) continue;
        let area = 0,
          cx = 0,
          cz = 0;
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i],
            q = poly[(i + 1) % poly.length];
          area += p[0] * q[1] - q[0] * p[1];
          cx += p[0];
          cz += p[1];
        }
        if (area / 2 < 1.5) continue;
        cx /= poly.length;
        cz /= poly.length;
        let rad = 0,
          inr = 1e9;
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i],
            q = poly[(i + 1) % poly.length],
            dx = q[0] - p[0],
            dz = q[1] - p[1],
            t = clamp(((cx - p[0]) * dx + (cz - p[1]) * dz) / (dx * dx + dz * dz), 0, 1);
          rad = Math.max(rad, Math.hypot(p[0] - cx, p[1] - cz));
          inr = Math.min(inr, Math.hypot(cx - p[0] - dx * t, cz - p[1] - dz * t));
        }
        out.push({ pts: poly, area: area / 2, cx, cz, rad, inr, roofed: S.polyRoofs.some((p) => pip(poly, p[0], p[1])), rmat: (S.polyRoofs.find((p) => pip(poly, p[0], p[1])) || [])[2] });
      }
    return out;
  }
  function polyPieces(g, rg, p) {
    const tris = T.ShapeUtils.triangulateShape(
      p.pts.map((q) => new T.Vector2(q[0], q[1])),
      [],
    );
    tris.forEach((t, n) => {
      const v = t.map((k) => [p.pts[k][0], FLOOR_T + 0.004, p.pts[k][1]]);
      g.tri(v[0], v[1], v[2], [0, 1, 0], shade(C.floor, 0.9 + 0.16 * hash(n, p.pts.length, 4)));
    });
    if (!p.roofed) return;
    const rise = clamp(p.inr * 1.2, 1.2, 5),
      y0 = EAVE - 0.12,
      k = 1 + 0.55 / Math.max(p.rad, 1),
      bands = 3,
      n = p.pts.length;
    for (let e = 0; e < n; e++) {
      const A = p.pts[e],
        Bq = p.pts[(e + 1) % n];
      const P = (q, t) => [p.cx + (q[0] - p.cx) * k * (1 - t), y0 + rise * t, p.cz + (q[1] - p.cz) * k * (1 - t)];
      const a0 = P(A, 0),
        b0 = P(Bq, 0),
        ap = [p.cx, y0 + rise, p.cz];
      const ux = b0[0] - a0[0],
        uy = b0[1] - a0[1],
        uz = b0[2] - a0[2],
        vx = ap[0] - a0[0],
        vy = ap[1] - a0[1],
        vz = ap[2] - a0[2];
      let nrm = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const nl = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1,
        sg = nrm[1] < 0 ? -1 : 1;
      nrm = [(nrm[0] / nl) * sg, (nrm[1] / nl) * sg, (nrm[2] / nl) * sg];
      for (let b = 0; b < bands; b++) {
        const t0 = b / bands,
          t1 = (b + 1) / bands,
          colr = shade(RPAL, 0.8 + 0.2 * hash(e, b, n) + 0.06 * b);
        rg.tri(P(A, t0), P(Bq, t0), P(Bq, t1), nrm, colr);
        if (b < bands - 1) rg.tri(P(A, t0), P(Bq, t1), P(A, t1), nrm, colr);
      }
    }
  }
  const polyAt = (S, lx, lz) => S.polys.findIndex((p) => pip(p.pts, lx, lz));

  // D = { floors:Set, walls:Map, roofs:[], segs:[], rings:[] }. Returns { main:Geo, roof:Geo }.
  function buildGeo(D, depth) {
    const g = new Geo(),
      rg = new Geo();
    const hs = D.hs || 1;
    // floors raised well clear of the ground stand on posts instead of a solid plinth
    const open = D.lift > 0 && depth > 1.6,
      full = depth;
    if (open) depth = 0.2;
    for (const k of D.floors) {
      const [i, j] = parse(k);
      if (D.id && wellOver(D, i, j)) continue;
      const fm = FLOORS[(D.fmat && D.fmat.get(k)) || "planks"],
        fcol = fm.c2 && (i + j) & 1 ? fm.c2 : fm.c;
      for (let p = 0; p < 2; p++) g.abox(i, 0, j + p * 0.5, i + 1, FLOOR_T - (p ? 0.006 : 0), j + p * 0.5 + 0.5, shade(fcol, 0.9 + 0.2 * hash(i, j, p)));
      const st = open ? C.beam : shade(C.stone, 0.85);
      if (!D.floors.has(ck(i, j - 1))) g.abox(i, -depth, j, i + 1, 0.04, j + 0.12, st);
      if (!D.floors.has(ck(i, j + 1))) g.abox(i, -depth, j + 0.88, i + 1, 0.04, j + 1, st);
      if (!D.floors.has(ck(i - 1, j))) g.abox(i, -depth, j, i + 0.12, 0.04, j + 1, st);
      if (!D.floors.has(ck(i + 1, j))) g.abox(i + 0.88, -depth, j, i + 1, 0.04, j + 1, st);
      if (open)
        for (const [vi, vj] of [
          [i, j],
          [i + 1, j],
          [i, j + 1],
          [i + 1, j + 1],
        ])
          if (!((vi | vj) & 1)) g.abox(vi - 0.11, -full, vj - 0.11, vi + 0.11, 0, vj + 0.11, shade(C.beam, 0.9));
    }
    const verts = new Map();
    const touch = (i, j, d) => {
      const k = ck(i, j);
      if (!verts.has(k)) verts.set(k, []);
      verts.get(k).push(d);
    };
    const late = new Geo(),
      thick = new Set(),
      tall = new Set(),
      vmat = new Map();
    for (const [k, type] of D.walls) {
      const [i, j, d] = parse(k);
      if (D.hid && D.hid.has(k)) continue;
      const wm = (D.wmat && D.wmat.get(k)) || "timber";
      PAL = WALLS[wm];
      wallPieces(isLow(type) ? late : g, i, j, d, type, depth);
      if (isThick(type)) (thick.add(ck(i, j)), thick.add(d === 0 ? ck(i + 1, j) : ck(i, j + 1)));
      for (const vk of [ck(i, j), d === 0 ? ck(i + 1, j) : ck(i, j + 1)]) vmat.has(vk) || vmat.set(vk, wm);
      touch(i, j, d);
      if (d === 0) touch(i + 1, j, d);
      else touch(i, j + 1, d);
      if (!isLow(type)) (tall.add(ck(i, j)), tall.add(d === 0 ? ck(i + 1, j) : ck(i, j + 1)));
    }
    for (const [k, ds] of verts) {
      const [i, j] = parse(k);
      const vp = WALLS[vmat.get(k) || "timber"],
        pb = vp.beam;
      if (thick.has(k)) {
        const sc = shade(vp.courses ? vp.plank : vp.stone, 0.82);
        g.abox(i - 0.5, -depth, j - 0.5, i + 0.5, EAVE + 0.03, j + 0.5, sc);
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ])
          g.abox(i + sx * 0.43 - 0.09, EAVE, j + sz * 0.43 - 0.09, i + sx * 0.43 + 0.09, EAVE + 1.0, j + sz * 0.43 + 0.09, sc);
      } else if (!tall.has(k)) late.abox(i - 0.08, -depth, j - 0.08, i + 0.08, 1.1, j + 0.08, pb);
      else if (!(ds.length === 2 && ds[0] === ds[1])) g.abox(i - 0.12, -depth, j - 0.12, i + 0.12, EAVE + 0.03, j + 0.12, pb);
    }
    rg.yo = (hs - 1) * EAVE;
    for (const r of D.roofs) {
      RPAL = ROOFS[r.mat || "thatch"].c;
      roofPieces(rg, r);
    }
    const ends = new Set();
    (D.segs || []).forEach((sg, n) => {
      const low = isLow(sg[4]);
      if (D.id && inRings(D, (sg[0] + sg[2]) / 2, (sg[1] + sg[3]) / 2)) return;
      PAL = WALLS[sg[5] || "timber"];
      freePiece(low ? late : g, sg[0], sg[1], sg[2], sg[3], sg[4], depth, n);
      for (const [x, z] of [
        [sg[0], sg[1]],
        [sg[2], sg[3]],
      ]) {
        const k = Math.round(x * 20) + "," + Math.round(z * 20) + (low ? "r" : "");
        if (ends.has(k)) continue;
        ends.add(k);
        if (isThick(sg[4])) g.abox(x - 0.5, -depth, z - 0.5, x + 0.5, EAVE + 0.03, z + 0.5, shade(PAL.courses ? PAL.plank : PAL.stone, 0.82));
        else if (low) late.abox(x - 0.08, -depth, z - 0.08, x + 0.08, 1.1, z + 0.08, PAL.beam);
        else g.abox(x - 0.12, -depth, z - 0.12, x + 0.12, EAVE + 0.03, z + 0.12, PAL.beam);
      }
    });
    for (const [n, r] of (D.rings || []).entries()) {
      rg.yo = r.h * EAVE * (hs - 1);
      PAL = WALLS[r.mat || "timber"];
      RPAL = ROOFS[r.rmat || "thatch"].c;
      ringPieces(g, rg, r, full, D.portals && D.portals[n]);
    }
    rg.yo = (hs - 1) * EAVE;
    for (const p of D.polys || []) {
      RPAL = ROOFS[p.rmat || "thatch"].c;
      polyPieces(g, rg, p);
    }
    // pillars, and a beam between any two that stand close together
    const pil = D.pillars || [];
    pil.forEach((p, n) => {
      PAL = WALLS[p[2] || "timber"];
      const [x, z] = p;
      depth = full;
      if (p[3] === "chimney") {
        const cc = PAL.courses ? PAL.plank : PAL.stone;
        for (let r = 0; r < 14; r++) g.abox(x - 0.32 + (r % 2) * 0.012, -depth + (r ? 0 : 0) + (r === 0 ? 0 : depth + r * 0.4 - 0.4), z - 0.32 + (r % 2) * 0.012, x + 0.32 - (r % 2) * 0.012, r * 0.4 + 0.4, z + 0.32 - (r % 2) * 0.012, shade(cc, 0.86 + 0.2 * hash(n, r, 7)));
        g.abox(x - 0.4, 5.6, z - 0.4, x + 0.4, 5.78, z + 0.4, shade(cc, 0.7));
        return;
      }
      g.abox(x - 0.24, -depth, z - 0.24, x + 0.24, 0.3, z + 0.24, PAL.stone);
      g.abox(x - 0.17, 0.3, z - 0.17, x + 0.17, WALL_H - 0.12, z + 0.17, shade(PAL.courses || PAL.flat ? PAL.plank : PAL.beam, 0.95 + 0.1 * hash(n, 3, 1)));
      g.abox(x - 0.25, WALL_H - 0.12, z - 0.25, x + 0.25, EAVE, z + 0.25, PAL.beam);
      for (let m = n + 1; m < pil.length; m++) {
        const q = pil[m],
          dx = q[0] - x,
          dz = q[1] - z,
          len = Math.hypot(dx, dz);
        if (len > 4.01 || len < 0.4 || q[3] === "chimney") continue;
        g.xf = { ox: x, oz: z, c: dx / len, s: -dz / len, su: len, oy: 0 };
        g.abox(0, WALL_H + 0.02, -0.1, 1, EAVE - 0.01, 0.1, PAL.beam);
        g.xf = null;
      }
    });
    PAL = WALLS.timber;
    RPAL = C.thatch;
    rg.yo = 0;
    if (hs !== 1) for (let n = 1; n < g.p.length; n += 3) g.p[n] = stretchY(g.p[n], hs);
    for (const st of D.stairs || []) stairPieces(g, st, hs);
    const fr = D.ox !== undefined ? D : D.frame;
    if (fr) (D.paths || []).forEach((p, n) => pathPieces(late, fr, p, n));
    const glow = new Geo();
    for (const it of D.decor || []) decorPieces(late, glow, it, decorY(D, it), EAVE * hs);
    append(g.p, late.p);
    append(g.n, late.n);
    append(g.c, late.c);
    return { main: g, roof: rg, glow };
  }

  /* ---------- materials and scene objects ---------- */
  // Built pieces are flat-coloured; the world around them is pixel-textured. A faint grain of texels,
  // fixed to the piece, gives timber, stone and thatch the same hand-painted surface as everything else.
  function texel(m) {
    const before = m.onBeforeCompile,
      key = m.customProgramCacheKey;
    m.onBeforeCompile = (sh, r) => {
      before && before.call(m, sh, r);
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vTexP;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvTexP = position;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vTexP;")
        .replace(
          "#include <color_fragment>",
          "#include <color_fragment>\n{ vec3 tq = floor( vTexP * 9.0 + 0.31 ); float th = fract( sin( dot( tq, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ); float tb = fract( sin( dot( floor( vTexP * 2.2 + 0.17 ), vec3( 39.3, 11.1, 83.7 ) ) ) * 24634.63 ); diffuseColor.rgb *= 0.89 + 0.15 * th + 0.08 * tb; }",
        );
    };
    m.customProgramCacheKey = () => key.call(m) + "|texel";
    return m;
  }
  const wallMat = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
  G.fade(wallMat, 0, 1, 0, true);
  texel(wallMat);
  G.renderer.localClippingEnabled = true;
  // warm light that comes on when you are home
  const hearth = new T.PointLight(0xffb469, 0, 11, 1.6);
  G.scene.add(hearth);
  function makeWallMat(plane, near, sideA, sideB) {
    // a wall is cut only where it is both above waist height and between the camera and you
    const m = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, clippingPlanes: [plane, near, sideA, sideB], clipIntersection: true, clipShadows: true });
    G.fade(m, 0, 1, 0, true);
    return texel(m);
  }
  const doorMat = new T.MeshLambertMaterial({ color: 0x6f4d2c });
  const doorGeo = new T.BoxGeometry(0.82, 2.0, 0.05);
  doorGeo.translate(0.41, 1.0, 0);
  // a few real lights shared between whichever lit decorations are nearest
  const lamps = [0, 1, 2].map(() => {
    const l = new T.PointLight(0xffb060, 0, 10, 1.7);
    G.scene.add(l);
    return l;
  });
  const gateMat = new T.MeshLambertMaterial({ color: 0x2c2823 });
  const gateGeo = (() => {
    const g = new Geo();
    for (let t = 0.14; t < 0.9; t += 0.145) g.abox(t - 0.022, 0, -0.03, t + 0.022, 2.05, 0.03, [1, 1, 1]);
    for (const y of [0.25, 0.85, 1.45, 2.0]) g.abox(0.1, y - 0.025, -0.02, 0.9, y + 0.025, 0.02, [1, 1, 1]);
    return g.build();
  })();
  function makeRoofMat() {
    const m = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, alphaHash: true });
    G.fade(m, 0, 1, 0, true);
    return texel(m);
  }
  const ghostOpts = { transparent: true, opacity: 0.5, depthTest: false, depthWrite: false, fog: false, side: T.DoubleSide };
  const ghostAdd = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: 0xffe2a0, ...ghostOpts }));
  const ghostDel = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: 0xe0563f, ...ghostOpts, opacity: 0.6 }));
  const ghostGroup = new T.Group();
  ghostAdd.renderOrder = 20;
  ghostDel.renderOrder = 21;
  ghostAdd.frustumCulled = ghostDel.frustumCulled = false;
  ghostGroup.add(ghostAdd, ghostDel);
  ghostGroup.visible = false;
  G.scene.add(ghostGroup);

  const gridGroup = new T.Group();
  {
    const N = 11,
      seg = 22,
      pos = [],
      colr = [];
    const push = (x0, z0, x1, z1) => {
      for (const [x, z] of [
        [x0, z0],
        [x1, z1],
      ]) {
        pos.push(x, 0, z);
        const f = clamp(1 - Math.hypot(x, z) / N, 0, 1);
        colr.push(1, 0.95, 0.8, f * f * 0.55);
      }
    };
    for (let i = -N; i <= N; i++)
      for (let s = 0; s < seg; s++) {
        const t0 = -N + (s / seg) * 2 * N,
          t1 = -N + ((s + 1) / seg) * 2 * N;
        push(i, t0, i, t1);
        push(t0, i, t1, i);
      }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(colr, 4));
    const lines = new T.LineSegments(g, new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false, fog: false }));
    lines.renderOrder = 15;
    lines.frustumCulled = false;
    gridGroup.add(lines);
    gridGroup.userData.lines = lines;
    gridGroup.visible = false;
    G.scene.add(gridGroup);
  }
  const gapMat = new T.MeshBasicMaterial({ color: 0xffb14a, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, fog: false });
  const guideMat = new T.MeshBasicMaterial({ color: 0x9fe3ff, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false, fog: false });
  const guideMesh = new T.Mesh(new T.BufferGeometry(), guideMat);
  guideMesh.renderOrder = 19;
  guideMesh.frustumCulled = false;
  ghostGroup.add(guideMesh);

  /* ---------- structures ---------- */
  function newStruct(F) {
    const S = {
      id: B.nextId++,
      ox: F.ox,
      oz: F.oz,
      yaw: F.yaw,
      y0: F.y0,
      floors: new Set(),
      walls: new Map(),
      roofs: [],
      segs: [],
      rings: [],
      colSegs: [],
      level: F.level || 0,
      hs: F.hs || 1,
      lift: F.lift || 0,
      clip: new T.Plane(new T.Vector3(0, -1, 0), 1e5),
      near: new T.Plane(new T.Vector3(0, 0, 1), 1e5),
      sideA: new T.Plane(new T.Vector3(1, 0, 0), -1e5),
      sideB: new T.Plane(new T.Vector3(-1, 0, 0), -1e5),
      cutH: 99,
      stairs: [],
      polyRoofs: [],
      polys: [],
      pillars: [],
      paths: [],
      po: !!F.po,
      hid: new Set(),
      portals: [],
      decor: [],
      lights: [],
      beds: [],
      fires: [],
      ringCosy: [],
      glow: null,
      glowMat: new T.MeshBasicMaterial({ vertexColors: true }),
      thick: false,
      wmat: new Map(),
      fmat: new Map(),
      group: new T.Group(),
      main: null,
      roof: null,
      roofMat: makeRoofMat(),
      roofOp: 1,
      gapMesh: null,
      doors: [],
      rooms: [],
      cellRoom: new Map(),
      corners: [],
      b: null,
    };
    S.wallMat = makeWallMat(S.clip, S.near, S.sideA, S.sideB);
    S.group.position.set(S.ox, S.y0, S.oz);
    S.group.rotation.y = S.yaw;
    G.scene.add(S.group);
    B.structs.push(S);
    return S;
  }
  function disposeStruct(S) {
    G.scene.remove(S.group);
    for (const m of [S.main, S.roof, S.gapMesh]) m && m.geometry.dispose();
    S.roofMat.dispose();
    S.wallMat.dispose();
    S.glow && S.glow.geometry.dispose();
    S.glowMat.dispose();
    const i = B.structs.indexOf(S);
    i >= 0 && B.structs.splice(i, 1);
  }
  const isEmpty = (S) => !S.floors.size && !S.walls.size && !S.roofs.length && !S.segs.length && !S.rings.length && !S.stairs.length && !S.pillars.length && !S.paths.length && !S.decor.length;
  const ringAt = (S, lx, lz, pad = 0) => S.rings.findIndex((r) => Math.hypot(lx - r.cx, lz - r.cz) < ringInner(r) + pad);
  const covered = (S, i, j) => S.roofs.some((r) => i >= r.i0 && i <= r.i1 && j >= r.j0 && j <= r.j1);

  function analyse(S) {
    S.rooms = [];
    S.cellRoom = new Map();
    const nb = (i, j) => [
      [i - 1, j, ek(i, j, 1)],
      [i + 1, j, ek(i + 1, j, 1)],
      [i, j - 1, ek(i, j, 0)],
      [i, j + 1, ek(i, j + 1, 0)],
    ];
    for (const k of S.floors) {
      if (S.cellRoom.has(k)) continue;
      const room = { cells: [], gaps: [], enclosed: true, roofed: true, i0: 1e9, i1: -1e9, j0: 1e9, j1: -1e9 };
      const stack = [k];
      S.cellRoom.set(k, room);
      while (stack.length) {
        const [i, j] = parse(stack.pop());
        room.cells.push([i, j]);
        room.i0 = Math.min(room.i0, i);
        room.i1 = Math.max(room.i1, i);
        room.j0 = Math.min(room.j0, j);
        room.j1 = Math.max(room.j1, j);
        if (!covered(S, i, j)) room.roofed = false;
        for (const [ni, nj, e] of nb(i, j)) {
          const ty = S.walls.get(e);
          if (ty && !isArch(ty) && !isLow(ty)) continue;
          const nk = ck(ni, nj);
          if (!S.floors.has(nk)) {
            room.enclosed = false;
            ty || room.gaps.push(e);
          } else if (ty) {
            room.enclosed = false;
          } else if (!S.cellRoom.has(nk)) {
            S.cellRoom.set(nk, room);
            stack.push(nk);
          }
        }
      }
      S.rooms.push(room);
    }
    // wall corners and ends, used as alignment guides
    const deg = new Map();
    const touch = (i, j, d) => {
      const k = ck(i, j);
      deg.set(k, (deg.get(k) || []).concat(d));
    };
    for (const k of S.walls.keys()) {
      const [i, j, d] = parse(k);
      touch(i, j, d);
      d === 0 ? touch(i + 1, j, d) : touch(i, j + 1, d);
    }
    S.corners = [];
    for (const [k, ds] of deg) if (!(ds.length === 2 && ds[0] === ds[1])) S.corners.push(parse(k));
  }

  // after a structure changes, the terrain chunks under it are refreshed (a moment later, so a drag does it once)
  // to hide or bring back the grass and ground cover beneath its floors and paths
  const COVER_TAPS = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]];
  const coverDirty = new Set();
  let coverT = 0;
  function markCover(S) {
    if (S.cx === undefined) return;
    const cs = G.chunkSize, r = (S.rad || 4) + 4;
    for (let h = Math.floor((S.cz - r) / cs); h <= Math.floor((S.cz + r) / cs); h++) for (let u = Math.floor((S.cx - r) / cs); u <= Math.floor((S.cx + r) / cs); u++) coverDirty.add(u + "," + h);
    coverT = 0.35;
  }
  function flushCover(dt) {
    if (!coverDirty.size || (coverT -= dt) > 0) return;
    for (const k of coverDirty) { const c = W.chunks.get(k); c && c.refresh(); }
    coverDirty.clear();
  }
  function rebuild(S) {
    markCover(S);
    try { return rebuild0(S); } finally { markCover(S); }
  }
  function rebuild0(S) {
    // bounds
    let i0 = 1e9,
      i1 = -1e9,
      j0 = 1e9,
      j1 = -1e9;
    const ext = (i, j) => {
      i0 = Math.min(i0, i);
      i1 = Math.max(i1, i);
      j0 = Math.min(j0, j);
      j1 = Math.max(j1, j);
    };
    const pts = [];
    for (const k of S.floors) {
      const [i, j] = parse(k);
      ext(i, j);
      ext(i + 1, j + 1);
      pts.push([i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]);
    }
    for (const k of S.walls.keys()) {
      const [i, j, d] = parse(k);
      ext(i, j);
      d === 0 ? ext(i + 1, j) : ext(i, j + 1);
      pts.push([i, j], d === 0 ? [i + 1, j] : [i, j + 1]);
    }
    for (const r of S.roofs) {
      ext(r.i0, r.j0);
      ext(r.i1 + 1, r.j1 + 1);
    }
    // walls that run on into a tower stop at its wall
    S.hid = new Set();
    if (S.rings.length)
      for (const k of S.walls.keys()) {
        const [i, j, d] = parse(k);
        inRings(S, d === 0 ? i + 0.5 : i, d === 0 ? j : j + 0.5) && S.hid.add(k);
      }
    S.colSegs = S.segs.filter((sg) => !inRings(S, (sg[0] + sg[2]) / 2, (sg[1] + sg[3]) / 2)).map((sg) => sg.slice(0, 5));
    S.thick = S.colSegs.some((sg) => isThick(sg[4]));
    const thickSegs = S.colSegs.filter((sg) => isThick(sg[4])).map((sg) => sg.slice(0, 4));
    for (const [k, ty] of S.walls) {
      if (!isThick(ty) || S.hid.has(k)) continue;
      const [i, j, d] = parse(k);
      thickSegs.push(d === 0 ? [i, j, i + 1, j] : [i, j, i, j + 1]);
      S.thick = true;
    }
    // where a castle wall meets a climbable tower, the tower gets a doorway onto the wall walk
    S.portals = S.rings.map((r) => {
      const set = new Set();
      if (!thickSegs.length || r.h < 2 || !climbLevels(r)) return set;
      for (let k = 0; k < r.n; k++) {
        const a = ringVert(r, k),
          b = ringVert(r, k + 1),
          mx = (a[0] + b[0]) / 2,
          mz = (a[1] + b[1]) / 2;
        for (const sg of thickSegs) {
          const dx = sg[2] - sg[0],
            dz = sg[3] - sg[1],
            t = clamp(((mx - sg[0]) * dx + (mz - sg[1]) * dz) / (dx * dx + dz * dz), 0, 1);
          if (Math.hypot(mx - sg[0] - dx * t, mz - sg[1] - dz * t) < 0.8) {
            set.add(k);
            break;
          }
        }
      }
      return set;
    });
    for (const p of S.pillars) {
      S.colSegs.push([p[0] - 0.02, p[1], p[0] + 0.02, p[1], "wall"]);
      ext(Math.floor(p[0]), Math.floor(p[1]));
      ext(Math.ceil(p[0]), Math.ceil(p[1]));
      pts.push([p[0], p[1]]);
    }
    for (const it of S.decor) {
      ext(Math.floor(it[0]) - 1, Math.floor(it[1]) - 1);
      ext(Math.ceil(it[0]) + 1, Math.ceil(it[1]) + 1);
    }
    for (const sg of S.paths) {
      ext(Math.floor(Math.min(sg[0], sg[2])), Math.floor(Math.min(sg[1], sg[3])));
      ext(Math.ceil(Math.max(sg[0], sg[2])), Math.ceil(Math.max(sg[1], sg[3])));
    }
    for (const sg of S.segs) {
      ext(Math.floor(Math.min(sg[0], sg[2])), Math.floor(Math.min(sg[1], sg[3])));
      ext(Math.ceil(Math.max(sg[0], sg[2])), Math.ceil(Math.max(sg[1], sg[3])));
      pts.push([sg[0], sg[1]], [sg[2], sg[3]]);
    }
    for (const r of S.rings) {
      ext(Math.floor(r.cx - r.r), Math.floor(r.cz - r.r));
      ext(Math.ceil(r.cx + r.r), Math.ceil(r.cz + r.r));
      for (let k = 0; k < r.n; k++) {
        const a = ringVert(r, k),
          b = ringVert(r, k + 1);
        pts.push(a);
        if (r.sides[k]) S.colSegs.push([a[0], a[1], b[0], b[1], r.sides[k]]);
      }
    }
    S.b = { i0, i1, j0, j1 };
    const [cx, cz] = toWorld(S, (i0 + i1) / 2, (j0 + j1) / 2);
    S.cx = cx;
    S.cz = cz;
    S.rad = Math.hypot(i1 - i0, j1 - j0) / 2 + 1;
    let minH = S.y0;
    for (const [i, j] of pts) {
      const [x, z] = toWorld(S, i, j);
      minH = Math.min(minH, G.heightAt(x, z));
    }
    S.depth = S.level ? 0.12 : clamp(S.y0 - minH + 0.35, 0.35, 8);
    for (const st of S.stairs) {
      ext(st.i - 3, st.j - 3);
      ext(st.i + 4, st.j + 4);
    }
    S.b = { i0, i1, j0, j1 };
    S.polys = findPolys(S);
    const geo = buildGeo(S, S.depth);
    for (const key of ["main", "roof"]) {
      if (S[key]) {
        S.group.remove(S[key]);
        S[key].geometry.dispose();
      }
      const m = new T.Mesh(geo[key].build(), key === "main" ? S.wallMat : S.roofMat);
      m.castShadow = m.receiveShadow = true;
      S.group.add(m);
      S[key] = m;
    }
    if (S.glow) {
      S.group.remove(S.glow);
      S.glow.geometry.dispose();
      S.glow = null;
    }
    if (geo.glow.p.length) {
      S.glow = new T.Mesh(geo.glow.build(), S.glowMat);
      S.group.add(S.glow);
    }
    // what the decorations do: block the way, give light, make smoke
    S.lights = [];
    S.beds = [];
    S.fires = [];
    for (const it of S.decor) {
      const def = DECOR[it[2]],
        a = ((it[3] || 0) * Math.PI) / 4,
        c = Math.cos(a),
        s = Math.sin(a),
        y = decorY(S, it);
      for (const q of def.col || []) S.colSegs.push([it[0] + q[0] * c + q[1] * s, it[1] - q[0] * s + q[1] * c, it[0] + q[2] * c + q[3] * s, it[1] - q[2] * s + q[3] * c, "wall"]);
      if (def.light) S.lights.push([it[0], y + (def.light[0] < 0 ? EAVE * S.hs + def.light[0] : def.light[0]), it[1], def.light[1]]);
      if (it[2] === "bed") S.beds.push(it);
      if (it[2] === "fireplace" || it[2] === "campfire") {
        const ch = it[2] === "fireplace" && S.pillars.find((p) => p[3] === "chimney" && Math.hypot(p[0] - it[0], p[1] - it[1]) < 4);
        S.fires.push(ch ? [ch[0], 5.9, ch[1]] : [it[0], it[2] === "campfire" ? y + 0.9 : EAVE * S.hs + 1.4, it[1]]);
      }
    }
    for (const dr of S.doors) S.group.remove(dr.mesh);
    S.doors = [];
    const kk = (EAVE * S.hs - 0.3) / (EAVE - 0.3);
    const doorways = S.colSegs.filter((sg) => isDoor(sg[4])).map((sg) => sg.slice(0, 5));
    for (const [k, type] of S.walls) {
      if (!isDoor(type) || S.hid.has(k)) continue;
      const [i, j, d] = parse(k);
      doorways.push(d === 0 ? [i, j, i + 1, j, type] : [i, j, i, j + 1, type]);
    }
    for (const [x0, z0, x1, z1, kind] of doorways) {
      const dx = x1 - x0,
        dz = z1 - z0,
        len = Math.hypot(dx, dz) || 1,
        base = Math.atan2(-dz, dx),
        rec = { base, mx: (x0 + x1) / 2, mz: (z0 + z1) / 2, nx: -dz / len, nz: dx / len, open: 0, dir: 1, sign: 1, kind, reach: 1.7 };
      if (kind === "gate") {
        const mesh = new T.Mesh(gateGeo, gateMat);
        mesh.position.set(x0, 0.04, z0);
        mesh.rotation.y = base;
        mesh.scale.set(len, (0.3 + 1.75 * kk) / 2.05, 1);
        S.group.add(mesh);
        S.doors.push({ ...rec, mesh, lift: 1.85 * kk, reach: 3 });
        continue;
      }
      const leaves = kind === "door2" ? 2 : 1,
        jamb = kind === "door" ? 0.09 : 0.05;
      for (let n = 0; n < leaves; n++) {
        const mesh = new T.Mesh(doorGeo, doorMat);
        mesh.castShadow = true;
        n ? mesh.position.set(x1 - dx * jamb, 0.06, z1 - dz * jamb) : mesh.position.set(x0 + dx * jamb, 0.06, z0 + dz * jamb);
        mesh.scale.x = kind === "door" ? Math.min(1.25, len) : (len * (1 - 2 * jamb)) / leaves / 0.82;
        mesh.scale.y = kind === "railgate" ? 0.5 : (0.24 + (kind === "door2" ? 2.0 : 1.8) * kk) / 2;
        S.group.add(mesh);
        S.doors.push({ ...rec, mesh, base: n ? base + Math.PI : base, sign: n ? -1 : 1, reach: leaves > 1 ? 2.1 : 1.7 });
      }
    }
    analyse(S);
    // how homely each room is
    S.ringCosy = S.rings.map(() => 0);
    const seen = new Map();
    for (const it of S.decor) {
      const cz = DECOR[it[2]].cosy;
      if (!cz) continue;
      const room = S.cellRoom.get(ck(Math.floor(it[0]), Math.floor(it[1]))),
        ri = room ? -1 : ringAt(S, it[0], it[1]),
        where = room || (ri >= 0 ? S.rings[ri] : null);
      if (!where) continue;
      seen.has(where) || seen.set(where, new Set());
      if (seen.get(where).has(it[2])) continue;
      seen.get(where).add(it[2]);
      if (room) room.cosy = (room.cosy || 0) + cz;
      else S.ringCosy[ri] += cz;
    }
    // amber markers on the open edges of unfinished rooms
    if (S.gapMesh) {
      S.group.remove(S.gapMesh);
      S.gapMesh.geometry.dispose();
    }
    const gg = new Geo();
    for (const room of S.rooms)
      if (!room.enclosed && room.cells.length > 1)
        for (const e of room.gaps) {
          const [i, j, d] = parse(e);
          ebox(gg, i, j, d, 0.06, 0.94, FLOOR_T + 0.02, FLOOR_T + 0.05, 0.05, [1, 1, 1]);
        }
    for (const r of S.rings)
      if (r.sides.some((t) => t) && r.sides.some((t) => !t))
        for (let k = 0; k < r.n; k++) {
          if (r.sides[k]) continue;
          const a = ringVert(r, k),
            b = ringVert(r, k + 1),
            dx = b[0] - a[0],
            dz = b[1] - a[1],
            len = Math.hypot(dx, dz);
          gg.xf = { ox: a[0], oz: a[1], c: dx / len, s: -dz / len, su: len, oy: 0 };
          gg.abox(0.06, FLOOR_T + 0.02, -0.05, 0.94, FLOOR_T + 0.05, 0.05, [1, 1, 1]);
          gg.xf = null;
        }
    S.gapMesh = new T.Mesh(gg.build(), gapMat);
    S.gapMesh.renderOrder = 18;
    S.gapMesh.frustumCulled = false;
    S.gapMesh.visible = B.on;
    S.group.add(S.gapMesh);
    B.version++;
  }

  /* ---------- terrain ---------- */
  // Level the site under new pieces: cut and fill to floor height, with a blended rim.
  function cutTerrain(S, samples, pit) {
    if (!samples.length) return;
    let x0 = 1e9,
      x1 = -1e9,
      z0 = 1e9,
      z1 = -1e9;
    for (const [x, z] of samples) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    const target = S.y0 - 0.05,
      CORE = pit ? 0.8 : 1.05,
      RIM = pit ? 0.801 : 2.9;
    let changed = false;
    for (let h = Math.floor(z0 - RIM); h <= Math.ceil(z1 + RIM); h++)
      for (let u = Math.floor(x0 - RIM); u <= Math.ceil(x1 + RIM); u++) {
        let dist = 1e9;
        for (const [x, z] of samples) {
          const dd = Math.hypot(x - u, z - h);
          if (dd < dist) dist = dd;
        }
        if (dist >= RIM) continue;
        const base = G.baseHeight(u, h),
          cur = base + G.editGet(u, h);
        let k = clamp((dist - CORE) / (RIM - CORE), 0, 1);
        k = k * k * (3 - 2 * k);
        const want = target + (cur - target) * k;
        if (Math.abs(want - cur) > 0.01 && !(pit && want > cur)) {
          G.editSet(u, h, clamp(want - base, -10, 10));
          changed = true;
        }
      }
    if (!changed) return;
    const cs = G.chunkSize;
    for (let h = Math.floor((z0 - RIM - 2) / cs); h <= Math.floor((z1 + RIM + 2) / cs); h++)
      for (let u = Math.floor((x0 - RIM - 2) / cs); u <= Math.floor((x1 + RIM + 2) / cs); u++) {
        const c = W.chunks.get(u + "," + h);
        c && c.refresh();
      }
    G.depthState.dirty = true;
  }
  function blockedBy(x, z) {
    const cs = G.chunkSize;
    for (let h = Math.floor((z - 3) / cs); h <= Math.floor((z + 3) / cs); h++)
      for (let u = Math.floor((x - 3) / cs); u <= Math.floor((x + 3) / cs); u++) {
        const c = W.chunks.get(u + "," + h);
        if (!c) continue;
        for (const t of c.trees) if (t.alive && Math.hypot(t.x - x, t.z - z) < G.treeKinds[t.type].r * t.scale + 0.45) return "A tree is in the way. Fell it first";
        for (const r of c.rocks) if (r.alive && r.scale >= 0.7 && Math.hypot(r.x - x, r.z - z) < r.scale * 0.75 + 0.3) return "A boulder is in the way";
      }
    return "";
  }

  /* ---------- operations ---------- */
  // samples (local) of the pieces an op adds, for height, validity and dust
  function opSamples(op) {
    const out = [];
    for (const [i, j] of op.addFloors) out.push([i + 0.5, j + 0.5], [i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]);
    for (const [i, j, d] of op.addWalls) out.push([i, j], d === 0 ? [i + 0.5, j] : [i, j + 0.5], d === 0 ? [i + 1, j] : [i, j + 1]);
    for (const sg of op.addSegs) out.push([sg[0], sg[1]], [sg[2], sg[3]]);
    for (const p of op.addPillars) out.push([p[0], p[1]]);
    for (const r of op.addRings) {
      out.push([r.cx, r.cz]);
      for (let k = 0; k < r.n; k++) out.push(ringVert(r, k), ringVert({ ...r, r: r.r * 0.5 }, k));
    }
    return out;
  }
  function finishOp(op) {
    const F = op.F;
    op.cost =
      op.addFloors.length * COST.floor +
      op.addWalls.length * COST.wall +
      op.setTypes.reduce((a, s) => a + (COST[s[3]] || 1), 0) +
      op.addRoofs.reduce((a, r) => a + (r.i1 - r.i0 + 1) * (r.j1 - r.j0 + 1) * COST.roof, 0) +
      op.addSegs.length * COST.wall +
      op.addStairs.length * 6 +
      op.addPillars.length * 3 +
      op.addDecor.length * 2 +
      op.addPaths.reduce((a, p) => a + Math.ceil(Math.hypot(p[2] - p[0], p[3] - p[1]) / 2), 0) +
      op.addPolyRoofs.reduce((a, p) => a + Math.round(p[2] || 0), 0) +
      op.addRings.reduce((a, r) => a + r.n * r.h * COST.wall + Math.round(Math.PI * r.r * r.r), 0) +
      op.setSegs.length * COST.door +
      op.setSides.filter((x) => x[2]).length * COST.door +
      op.ringRoofs.filter((x) => x[1]).reduce((a, x) => a + Math.round(Math.PI * F.rings[x[0]].r ** 2), 0);
    op.adds = op.addFloors.length + op.addWalls.length + op.setTypes.length + op.addRoofs.length + op.addSegs.length + op.addRings.length + op.addPillars.length + op.addDecor.length + op.addPaths.length + op.addStairs.length + op.addPolyRoofs.length + op.setSegs.length + op.setSides.filter((x) => x[2]).length + op.ringRoofs.filter((x) => x[1]).length;
    op.dels = op.delFloors.length + op.delWalls.length + op.delRoofs.length + op.revert.length + op.delSegs.length + op.delRings.length + op.delPillars.length + op.delDecor.length + op.delPaths.length + op.delStairs.length + op.delPolyRoofs.length + op.setSides.filter((x) => !x[2]).length + op.ringRoofs.filter((x) => !x[1]).length;
    op.valid = true;
    op.reason = "";
    const fail = (r) => {
      op.valid = false;
      op.reason = op.reason || r;
    };
    const samples = opSamples(op).map(([lx, lz]) => toWorld(F, lx, lz));
    if (samples.length && !F.level) {
      let lo = 1e9,
        hi = -1e9;
      for (const [x, z] of samples) {
        const h = G.heightAt(x, z);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      op.y0 = F.y0;
      if (op.y0 < 0.3 || (lo < -0.4 && !(F.lift > 0))) fail(F.lift > 0 ? "Too wet to build here" : "Too wet to build here. Raise the floor with + to bridge water");
      else if (lo < F.y0 - 6 || hi > F.y0 + 4) fail("Too steep here. Level the ground first");
      if (op.valid)
        for (const [x, z] of samples) {
          const r = blockedBy(x, z);
          if (r) {
            fail(r);
            break;
          }
        }
    } else op.y0 = F.y0;
    if (op.valid && !B.free && op.cost > W.wood) fail("Need " + op.cost + " wood (have " + W.wood + ")");
    if (!op.adds && !op.dels) {
      op.valid = false;
      op.idle = true;
    }
    return op;
  }
  const STYLE_NAME = { wall: "Wall", arch: "Round arches", arch2: "Pointed arches", arch3: "Braced openings", rail: "Fence", parapet: "Battlement", rampart: "Castle wall" };
  const WIN_NAME = { window: "Square window", window2: "Arched window", window4: "Shuttered window", window3: "Arrow slit" };
  const DOOR_NAME = { door: "Door", door2: "Double door", gate: "Castle gate" };
  const blankOp = (F) => ({ F, addFloors: [], addWalls: [], setTypes: [], addRoofs: [], delFloors: [], delWalls: [], delRoofs: [], revert: [], addSegs: [], addRings: [], delSegs: [], delRings: [], setSegs: [], setSides: [], ringRoofs: [], addStairs: [], delStairs: [], addPillars: [], delPillars: [], addPolyRoofs: [], delPolyRoofs: [], addPaths: [], delPaths: [], addDecor: [], delDecor: [], label: "", marker: null });

  function rectOps(op, S, i0, j0, i1, j1, withFloor, withWalls) {
    // cells i0..i1, j0..j1 inclusive
    const hasF = (i, j) => S && S.floors.has(ck(i, j));
    const hasW = (i, j, d) => S && S.walls.has(ek(i, j, d));
    if (withFloor) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) hasF(i, j) || op.addFloors.push([i, j]);
    if (withWalls) {
      for (let i = i0; i <= i1; i++) {
        hasW(i, j0, 0) || op.addWalls.push([i, j0, 0]);
        hasW(i, j1 + 1, 0) || op.addWalls.push([i, j1 + 1, 0]);
      }
      for (let j = j0; j <= j1; j++) {
        hasW(i0, j, 1) || op.addWalls.push([i0, j, 1]);
        hasW(i1 + 1, j, 1) || op.addWalls.push([i1 + 1, j, 1]);
      }
    }
  }
  function lineOps(op, S, a, b) {
    const hasW = (i, j, d) => S && S.walls.has(ek(i, j, d));
    if (a.j === b.j) for (let i = Math.min(a.i, b.i); i < Math.max(a.i, b.i); i++) hasW(i, a.j, 0) || op.addWalls.push([i, a.j, 0]);
    else for (let j = Math.min(a.j, b.j); j < Math.max(a.j, b.j); j++) hasW(a.i, j, 1) || op.addWalls.push([a.i, j, 1]);
  }
  function eraseRect(op, S, i0, j0, i1, j1) {
    if (!S) return;
    for (const k of S.floors) {
      const [i, j] = parse(k);
      i >= i0 && i <= i1 && j >= j0 && j <= j1 && op.delFloors.push([i, j]);
    }
    for (const k of S.walls.keys()) {
      const [i, j, d] = parse(k);
      const inside = d === 0 ? i >= i0 && i <= i1 && j >= j0 && j <= j1 + 1 : i >= i0 && i <= i1 + 1 && j >= j0 && j <= j1;
      inside && op.delWalls.push([i, j, d]);
    }
    S.roofs.forEach((r, idx) => {
      !(r.i1 < i0 || r.i0 > i1 || r.j1 < j0 || r.j0 > j1) && op.delRoofs.push(idx);
    });
    const inside = (x, z) => x >= i0 - 0.01 && x <= i1 + 1.01 && z >= j0 - 0.01 && z <= j1 + 1.01;
    S.decor.forEach((q, idx) => inside(q[0], q[1]) && op.delDecor.push(idx));
    S.segs.forEach((sg, idx) => inside(sg[0], sg[1]) && inside(sg[2], sg[3]) && op.delSegs.push(idx));
    S.rings.forEach((r, idx) => inside(r.cx, r.cz) && op.delRings.push(idx));
  }
  // nearest free wall piece or tower side to a point
  function pickFree(S, lx, lz) {
    let best = null;
    const test = (x0, z0, x1, z1, ref) => {
      const dx = x1 - x0,
        dz = z1 - z0,
        t = clamp(((lx - x0) * dx + (lz - z0) * dz) / (dx * dx + dz * dz), 0, 1),
        dist = Math.hypot(lx - x0 - dx * t, lz - z0 - dz * t);
      if (!best || dist < best.dist) best = { ...ref, dist, seg: [x0, z0, x1, z1] };
    };
    if (!S) return null;
    S.segs.forEach((sg, idx) => test(sg[0], sg[1], sg[2], sg[3], { kind: "seg", idx, type: sg[4] }));
    S.rings.forEach((r, ri) => {
      for (let k = 0; k < r.n; k++) {
        if (!r.sides[k]) continue;
        const a = ringVert(r, k),
          b = ringVert(r, k + 1);
        test(a[0], a[1], b[0], b[1], { kind: "side", ri, k, type: r.sides[k] });
      }
    });
    return best;
  }
  function nearestEdge(S, lx, lz, needWall) {
    const cands = [
      [Math.floor(lx), Math.round(lz), 0, Math.abs(lz - Math.round(lz))],
      [Math.round(lx), Math.floor(lz), 1, Math.abs(lx - Math.round(lx))],
    ].sort((p, q) => p[3] - q[3]);
    for (const c of cands) if (c[3] < 0.5 && (!needWall || (S && S.walls.has(ek(c[0], c[1], c[2]))))) return c;
    return null;
  }

  function computeOp() {
    const h = B.hover;
    if (!h) return null;
    const F = h.F,
      S = F.isNew ? null : F,
      op = blankOp(F),
      t = B.tool,
      d = B.drag;
    const vtx = { i: Math.round(h.lx), j: Math.round(h.lz) },
      cell = { i: Math.floor(h.lx), j: Math.floor(h.lz) };
    const size = (w, l) => w + " × " + l + " m";
    const hv = { i: Math.round(h.lx * 2) / 2, j: Math.round(h.lz * 2) / 2 };
    const isInt = Number.isInteger;
    if (t === "pillar") {
      const near = S ? S.pillars.findIndex((p) => Math.hypot(p[0] - h.lx, p[1] - h.lz) < 0.4) : -1;
      if (B.alt) near >= 0 && op.delPillars.push(near);
      else if (near >= 0) op.note = "A pillar stands here";
      else op.addPillars.push([hv.i, hv.j, B.wmat, B.pkind]);
      op.label = B.pkind === "chimney" ? "Chimney" : "Pillar";
      return finishOp(op);
    }
    if (t === "decor") {
      const near = S ? nearestDecor(S, h.lx, h.lz, 0.6) : -1;
      if (B.alt) {
        if (near >= 0) (op.delDecor.push(near), (op.label = "Remove the " + DECOR[S.decor[near][2]].name.toLowerCase()));
        return finishOp(op);
      }
      const def = DECOR[B.dkind];
      let x = Math.round(h.lx * 4) / 4,
        z = Math.round(h.lz * 4) / 4,
        rot = B.drot;
      if (def.wall && S) {
        const e = nearestEdge(S, h.lx, h.lz, true);
        if (e && e[3] < 0.75 && !isLow(S.walls.get(ek(e[0], e[1], e[2])))) {
          if (e[2] === 0) {
            const side = h.lz >= e[1] ? 1 : -1;
            z = e[1] + side * def.wall;
            x = e[0] + 0.5;
            rot = side > 0 ? 0 : 4;
          } else {
            const side = h.lx >= e[0] ? 1 : -1;
            x = e[0] + side * def.wall;
            z = e[1] + 0.5;
            rot = side > 0 ? 2 : 6;
          }
          op.snapped = true;
        }
      }
      if (F.level && !(S && onFloorAt(S, x, z))) op.note = "It needs a floor up here";
      else if (S && S.decor.some((q) => q[2] === B.dkind && Math.hypot(q[0] - x, q[1] - z) < 0.2)) op.note = "One stands here already";
      else op.addDecor.push([x, z, B.dkind, rot, B.dcol]);
      op.label = def.name + (def.wall && !op.snapped ? " \u00b7 snaps to walls" : "");
      return finishOp(op);
    }
    if (t === "path") {
      if (!d) {
        if (B.alt && S) {
          let best = -1,
            bd = 1e9;
          S.paths.forEach((p, idx) => {
            const dx = p[2] - p[0],
              dz = p[3] - p[1],
              tt = clamp(((h.lx - p[0]) * dx + (h.lz - p[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1),
              dist = Math.hypot(h.lx - p[0] - dx * tt, h.lz - p[1] - dz * tt);
            if (dist < p[4] / 2 + 0.3 && dist < bd) ((bd = dist), (best = idx));
          });
          best >= 0 && op.delPaths.push(best);
        } else op.marker = [hv.i, hv.j];
        return finishOp(op);
      }
      const L = Math.hypot(hv.i - d.a.i, hv.j - d.a.j);
      op.end = hv;
      op.marker = [hv.i, hv.j];
      if (L > 0.4) {
        op.addPaths.push([d.a.i, d.a.j, hv.i, hv.j, B.pwidth, B.pmat]);
        op.label = PATHS[B.pmat].name + " " + Math.round(L * 10) / 10 + " m \u00b7 " + B.pwidth + " m wide";
      }
      return finishOp(op);
    }
    if (t === "stairs") {
      const a0 = d ? d.a : cell;
      let dir = B.stairDir;
      if (d && (cell.i !== a0.i || cell.j !== a0.j)) dir = Math.abs(cell.i - a0.i) >= Math.abs(cell.j - a0.j) ? (cell.i > a0.i ? 0 : 2) : cell.j > a0.j ? 1 : 3;
      if (!S) {
        op.marker = [vtx.i, vtx.j];
        op.note = "Stairs start on a floor";
      } else if (S.stairs.some((st) => st.i === a0.i && st.j === a0.j && st.dir === dir)) op.note = "Stairs already here";
      else {
        op.addStairs.push({ i: a0.i, j: a0.j, dir });
        op.label = "Stairs up, " + stairLen(S.hs) + " m long";
      }
      return finishOp(op);
    }
    if (t === "tower") {
      op.marker = d ? [d.a.i, d.a.j] : [hv.i, hv.j];
      if (d) {
        const dist = Math.hypot(h.lx - d.a.i, h.lz - d.a.j);
        if (dist > 0.8) {
          const r = clamp(Math.round(dist * 2) / 2, 1.5, 9),
            n = clamp(Math.round((Math.PI * 2 * r) / 1.05 / 2) * 2, 8, 32);
          op.addRings.push({ cx: d.a.i, cz: d.a.j, r, n, rot: Math.PI / n, h: B.levels, sides: Array(n).fill("wall"), roof: false });
          if (r >= 2 && B.levels > 1) op.label2 = " \u00b7 spiral stair inside";
          op.label = "Tower " + r * 2 + " m wide \u00b7 " + n + " sides \u00b7 " + B.levels + (B.levels > 1 ? " storeys" : " storey") + (op.label2 || "");
        }
      }
      return finishOp(op);
    }
    if (t === "wall") {
      if (!d) {
        op.marker = [hv.i, hv.j];
        return finishOp(op);
      }
      const a = d.a,
        b = hv;
      if (!(isInt(a.i) && isInt(a.j) && isInt(b.i) && isInt(b.j) && (a.i === b.i || a.j === b.j))) {
        const L = Math.hypot(b.i - a.i, b.j - a.j);
        op.end = b;
        op.marker = [b.i, b.j];
        if (L > 0.4) {
          if (B.alt) {
            S &&
              S.segs.forEach((sg, idx) => {
                const near = (x, z) => {
                  const tt = ((x - a.i) * (b.i - a.i) + (z - a.j) * (b.j - a.j)) / (L * L);
                  return tt > -0.05 && tt < 1.05 && Math.hypot(x - a.i - (b.i - a.i) * tt, z - a.j - (b.j - a.j) * tt) < 0.2;
                };
                near(sg[0], sg[1]) && near(sg[2], sg[3]) && op.delSegs.push(idx);
              });
          } else {
            const k = Math.max(1, Math.round(L));
            for (let m = 0; m < k; m++) {
              const p = [a.i + ((b.i - a.i) * m) / k, a.j + ((b.j - a.j) * m) / k, a.i + ((b.i - a.i) * (m + 1)) / k, a.j + ((b.j - a.j) * (m + 1)) / k];
              const dup = S && S.segs.some((sg) => Math.abs(sg[0] - p[0]) + Math.abs(sg[1] - p[1]) + Math.abs(sg[2] - p[2]) + Math.abs(sg[3] - p[3]) < 0.05);
              dup || op.addSegs.push([...p, B.style]);
            }
          }
          let ang = Math.round((Math.atan2(Math.abs(b.j - a.j), Math.abs(b.i - a.i)) * 180) / Math.PI);
          op.label = STYLE_NAME[B.style] + " " + Math.round(L * 10) / 10 + " m \u00b7 " + ang + "\u00b0";
        }
        return finishOp(op);
      }
    }
    if (t === "room" || t === "wall") {
      if (!d) {
        op.marker = [vtx.i, vtx.j];
        return finishOp(op);
      }
      let a = d.a,
        b = vtx;
      const di = Math.abs(b.i - a.i),
        dj = Math.abs(b.j - a.j);
      if (t === "wall" || di === 0 || dj === 0) {
        b = di >= dj ? { i: b.i, j: a.j } : { i: a.i, j: b.j };
        op.end = b;
        op.marker = [b.i, b.j];
        const len = Math.max(Math.abs(b.i - a.i), Math.abs(b.j - a.j));
        if (B.alt) {
          const lo = { i: Math.min(a.i, b.i), j: Math.min(a.j, b.j) },
            hi = { i: Math.max(a.i, b.i), j: Math.max(a.j, b.j) };
          if (S)
            for (const k of S.walls.keys()) {
              const [i, j, dd] = parse(k);
              if (a.j === b.j ? dd === 0 && j === a.j && i >= lo.i && i < hi.i : dd === 1 && i === a.i && j >= lo.j && j < hi.j) op.delWalls.push([i, j, dd]);
            }
        } else lineOps(op, S, a, b);
        op.label = len ? (t === "wall" ? STYLE_NAME[B.style] : "Wall") + " " + len + " m" : "";
        if (t === "wall") op.style = B.style;
      } else {
        const i0 = Math.min(a.i, b.i),
          i1 = Math.max(a.i, b.i) - 1,
          j0 = Math.min(a.j, b.j),
          j1 = Math.max(a.j, b.j) - 1;
        if (B.alt) eraseRect(op, S, i0, j0, i1, j1);
        else rectOps(op, S, i0, j0, i1, j1, true, true);
        op.label = "Room " + size(i1 - i0 + 1, j1 - j0 + 1);
        op.end = b;
      }
    } else if (t === "floor") {
      const a = d ? d.a : cell;
      const i0 = Math.min(a.i, cell.i),
        i1 = Math.max(a.i, cell.i),
        j0 = Math.min(a.j, cell.j),
        j1 = Math.max(a.j, cell.j);
      if (B.alt) {
        if (S) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) S.floors.has(ck(i, j)) && op.delFloors.push([i, j]);
      } else rectOps(op, S, i0, j0, i1, j1, true, false);
      op.label = d ? "Floor " + size(i1 - i0 + 1, j1 - j0 + 1) : "";
    } else if (t === "door" || t === "window") {
      let tt = t === "window" ? B.wstyle : B.dstyle;
      const e = nearestEdge(S, h.lx, h.lz, true);
      const fp = pickFree(S, h.lx, h.lz);
      const lowGate = (cur) => (t === "door" && isLow(cur) ? "railgate" : tt);
      op.label = t === "window" ? WIN_NAME[tt] : DOOR_NAME[tt];
      if (fp && fp.dist < 0.5 && (!e || fp.dist < e[3])) {
        tt = lowGate(fp.type);
        if (fp.type === tt) op.note = "Already a " + t;
        else if (fp.kind === "seg") op.setSegs.push([fp.idx, tt]);
        else op.setSides.push([fp.ri, fp.k, tt]);
      } else if (e) {
        tt = lowGate(S.walls.get(ek(e[0], e[1], e[2])));
        if (tt === "railgate") op.label = "Gate";
        if (S.walls.get(ek(e[0], e[1], e[2])) !== tt) op.setTypes.push([e[0], e[1], e[2], tt]);
        else op.note = "Already a " + t;
      } else {
        op.marker = [vtx.i, vtx.j];
        op.note = t === "door" ? "Doors hang in walls" : "Windows go in walls";
      }
    } else if (t === "roof" && !(d && (d.a.i !== cell.i || d.a.j !== cell.j)) && S && ringAt(S, h.lx, h.lz) >= 0) {
      const ri = ringAt(S, h.lx, h.lz),
        r = S.rings[ri];
      if (B.alt) r.roof && op.ringRoofs.push([ri, false]);
      else if ((r.roof === true ? "cone" : r.roof) === B.tshape) op.note = "Already has this top. R changes it";
      else op.ringRoofs.push([ri, B.tshape]);
      op.label = TOP_NAME[B.tshape] + (B.tshape === "crenel" && climbLevels({ ...r, roof: "crenel" }) ? " \u00b7 you can climb up to them" : "");
    } else if (t === "roof" && !(d && (d.a.i !== cell.i || d.a.j !== cell.j)) && S && polyAt(S, h.lx, h.lz) >= 0) {
      const pi = polyAt(S, h.lx, h.lz),
        p = S.polys[pi];
      if (B.alt) p.roofed && op.delPolyRoofs.push(pi);
      else if (p.roofed) op.note = "Already roofed";
      else op.addPolyRoofs.push([p.cx, p.cz, p.area]);
      op.label = "Roof";
    } else if (t === "roof") {
      let rect = null;
      if (d && (d.a.i !== cell.i || d.a.j !== cell.j))
        rect = { i0: Math.min(d.a.i, cell.i), i1: Math.max(d.a.i, cell.i), j0: Math.min(d.a.j, cell.j), j1: Math.max(d.a.j, cell.j) };
      else if (S) {
        const room = S.cellRoom.get(ck(cell.i, cell.j));
        if (room) rect = { i0: room.i0, i1: room.i1, j0: room.j0, j1: room.j1 };
      }
      if (rect) {
        const wide = rect.i1 - rect.i0 >= rect.j1 - rect.j0;
        const RS = RSHAPES[B.rshape];
        rect.axis = wide !== (RS[0] === "gable" && RS[1] === 1) ? "x" : "z";
        rect.shape = RS[0];
        rect.dir = RS[1];
        rect.pitch = RS[3];
        if (B.alt) {
          S && S.roofs.forEach((r, idx) => !(r.i1 < rect.i0 || r.i0 > rect.i1 || r.j1 < rect.j0 || r.j0 > rect.j1) && op.delRoofs.push(idx));
        } else {
          const same = S ? S.roofs.findIndex((r) => r.i0 === rect.i0 && r.i1 === rect.i1 && r.j0 === rect.j0 && r.j1 === rect.j1) : -1;
          if (same >= 0 && S.roofs[same].axis === rect.axis && (S.roofs[same].shape || "gable") === rect.shape && (S.roofs[same].dir || 0) === rect.dir && (S.roofs[same].pitch || 1) === rect.pitch) op.note = "Already roofed. R changes the roof shape";
          else {
            same >= 0 && op.delRoofs.push(same);
            op.addRoofs.push(rect);
            op.replacing = same >= 0;
          }
        }
        op.label = RSHAPES[B.rshape][2] + " " + size(rect.i1 - rect.i0 + 1, rect.j1 - rect.j0 + 1);
      } else {
        op.marker = [vtx.i, vtx.j];
        op.note = "Click inside a room, or drag a rectangle";
      }
    } else if (t === "erase") {
      if (d && (d.a.i !== cell.i || d.a.j !== cell.j)) {
        eraseRect(op, S, Math.min(d.a.i, cell.i), Math.min(d.a.j, cell.j), Math.max(d.a.i, cell.i), Math.max(d.a.j, cell.j));
        op.label = "Clear " + size(Math.abs(d.a.i - cell.i) + 1, Math.abs(d.a.j - cell.j) + 1);
      } else if (S) {
        const ri = h.rlx === undefined ? -1 : S.roofs.findIndex((r) => h.rlx >= r.i0 - 0.4 && h.rlx <= r.i1 + 1.4 && h.rlz >= r.j0 - 0.4 && h.rlz <= r.j1 + 1.4);
        const e = nearestEdge(S, h.lx, h.lz, true);
        const fp = pickFree(S, h.lx, h.lz);
        const rr = h.rlx === undefined ? -1 : S.rings.findIndex((r) => r.roof && Math.hypot(h.rlx - r.cx, h.rlz - r.cz) < r.r + 0.5);
        const pr = h.rlx === undefined ? -1 : S.polys.findIndex((p) => p.roofed && pip(p.pts, h.rlx, h.rlz));
        const si = S.stairs.findIndex((st) => {
          const [dx, dz] = DIRS[st.dir];
          return [0, 1, 2].some((m) => st.i + dx * m === cell.i && st.j + dz * m === cell.j);
        });
        const pl = S.pillars.findIndex((p) => Math.hypot(p[0] - h.lx, p[1] - h.lz) < 0.4);
        const dc = nearestDecor(S, h.lx, h.lz, 0.45);
        if (ri >= 0) op.delRoofs.push(ri);
        else if (dc >= 0) op.delDecor.push(dc);
        else if (pl >= 0) op.delPillars.push(pl);
        else if (rr >= 0) op.ringRoofs.push([rr, false]);
        else if (pr >= 0) op.delPolyRoofs.push(pr);
        else if (si >= 0) op.delStairs.push(si);
        else if (fp && fp.dist < 0.32 && (!e || fp.dist < e[3])) {
          if (isDoor(fp.type) || isWin(fp.type)) fp.kind === "seg" ? op.setSegs.push([fp.idx, fp.type === "railgate" ? "rail" : fp.type === "gate" ? "rampart" : "wall"]) : op.setSides.push([fp.ri, fp.k, "wall"]);
          else fp.kind === "seg" ? op.delSegs.push(fp.idx) : op.setSides.push([fp.ri, fp.k, null]);
        } else if (e && e[3] < 0.32) {
          const ty = S.walls.get(ek(e[0], e[1], e[2]));
          isDoor(ty) || isWin(ty) ? op.revert.push([e[0], e[1], e[2]]) : op.delWalls.push([e[0], e[1], e[2]]);
        } else if (S.floors.has(ck(cell.i, cell.j))) op.delFloors.push([cell.i, cell.j]);
        else if (ringAt(S, h.lx, h.lz) >= 0) op.delRings.push(ringAt(S, h.lx, h.lz));
      }
    }
    return finishOp(op);
  }

  const serial = (S) => ({ ox: S.ox, oz: S.oz, yaw: S.yaw, y0: S.y0, floors: [...S.floors], walls: [...S.walls], roofs: S.roofs.map((r) => ({ ...r })), level: S.level, hs: S.hs, lift: S.lift, po: S.po, pillars: S.pillars.map((x) => x.slice()), paths: S.paths.map((x) => x.slice()), decor: S.decor.map((x) => x.slice()), wmat: [...S.wmat], fmat: [...S.fmat], stairs: S.stairs.map((x) => ({ ...x })), polyRoofs: S.polyRoofs.map((x) => x.slice()), segs: S.segs.map((x) => x.slice()), rings: S.rings.map((r) => ({ ...r, sides: r.sides.slice() })) });
  function fill(S, d) {
    S.floors = new Set(d.floors);
    S.walls = new Map(d.walls);
    S.roofs = d.roofs.map((r) => ({ ...r }));
    S.segs = (d.segs || []).map((x) => x.slice());
    S.stairs = (d.stairs || []).map((x) => ({ ...x }));
    S.pillars = (d.pillars || []).map((x) => x.slice());
    S.paths = (d.paths || []).map((x) => x.slice());
    S.decor = (d.decor || []).filter((x) => DECOR[x[2]]).map((x) => x.slice());
    S.wmat = new Map(Array.isArray(d.wmat) ? d.wmat : []);
    S.fmat = new Map(Array.isArray(d.fmat) ? d.fmat : []);
    S.polyRoofs = (d.polyRoofs || []).map((x) => x.slice());
    S.rings = (d.rings || []).map((r) => ({ ...r, sides: r.sides.slice() }));
  }
  function snapshot() {
    return { wood: W.wood, structs: B.structs.map(serial) };
  }
  function restore(snap) {
    for (const S of [...B.structs]) disposeStruct(S);
    for (const d of snap.structs) {
      const S = newStruct(d);
      fill(S, d);
    }
    // storeys look at each other for stairwells, so build once all are in place
    for (const S of B.structs) rebuild(S);
    W.wood = snap.wood;
    G.markStockDirty();
    B.version++;
  }
  // ground-level sample points of everything in a structure (local)
  function localSamples(S) {
    const out = [];
    for (const k of S.floors) {
      const [i, j] = parse(k);
      out.push([i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1], [i + 0.5, j + 0.5]);
    }
    for (const k of S.walls.keys()) {
      const [i, j, d] = parse(k);
      out.push([i, j], d === 0 ? [i + 1, j] : [i, j + 1]);
    }
    for (const sg of S.segs) out.push([sg[0], sg[1]], [sg[2], sg[3]]);
    for (const p of S.pillars) out.push([p[0], p[1]]);
    for (const r of S.rings) {
      out.push([r.cx, r.cz]);
      for (let k = 0; k < r.n; k++) out.push(ringVert(r, k), ringVert({ ...r, r: r.r * 0.5 }, k));
    }
    return out;
  }
  // level the ground under freshly placed structures, then build them
  function settle(list) {
    for (const S of list) {
      if (S.po) continue;
      const smp = localSamples(S).map(([a, b]) => toWorld(S, a, b));
      if (!S.level) cutTerrain(S, smp, !!S.lift);
      else if (S.level < 0) cutTerrain(S, smp, true);
    }
    for (const S of list) rebuild(S);
  }
  /* ---------- saving: buildings are kept with the world seed ---------- */
  const SAVE = "world-engine-build:1:";
  function saveBuilds() {
    try {
      localStorage.setItem(SAVE + B.seed, JSON.stringify({ v: 1, structs: B.structs.map(serial) }));
    } catch {}
  }
  function loadBuilds() {
    try {
      const raw = localStorage.getItem(SAVE + B.seed);
      if (!raw || B.structs.length) return;
      const made = [];
      for (const d of JSON.parse(raw).structs) {
        const S = newStruct(d);
        fill(S, d);
        made.push(S);
      }
      settle(made);
    } catch {}
  }
  /* ---------- copy and stamp ---------- */
  function copyPick() {
    const h = B.hover;
    if (!h || h.F.isNew) return;
    const S0 = h.F,
      group = B.structs.filter((O) => sameGrid(O, S0) && !O.po),
      base = group.reduce((a, O) => (O.level === 0 && (!a || O.y0 < a.y0) ? O : a), null) || S0;
    let i0 = 1e9,
      i1 = -1e9,
      j0 = 1e9,
      j1 = -1e9,
      cost = 0;
    const samples = [];
    for (const O of group) {
      i0 = Math.min(i0, O.b.i0);
      i1 = Math.max(i1, O.b.i1);
      j0 = Math.min(j0, O.b.j0);
      j1 = Math.max(j1, O.b.j1);
      O.level || append(samples, localSamples(O));
      cost += O.floors.size + 2 * (O.walls.size + O.segs.length) + 3 * O.pillars.length + 6 * O.stairs.length + O.roofs.reduce((a, r) => a + (r.i1 - r.i0 + 1) * (r.j1 - r.j0 + 1), 0) + O.rings.reduce((a, r) => a + r.n * r.h * 2 + Math.round(Math.PI * r.r * r.r), 0);
    }
    B.clipb = { id: ++B.clipN, items: group.map(serial), y0: base.y0, cx: Math.round((i0 + i1) / 2), cz: Math.round((j0 + j1) / 2), yaw: S0.yaw, rot: 0, samples, step: Math.max(1, Math.ceil(samples.length / 60)), cost };
    B.key = "";
    hint();
  }
  function stampFrame(h) {
    const c = B.clipb,
      yaw = c.yaw + (c.rot * Math.PI) / 4,
      cs = Math.cos(yaw),
      sn = Math.sin(yaw),
      wx = Math.round(h.wx * 2) / 2,
      wz = Math.round(h.wz * 2) / 2;
    return { ox: wx - (c.cx * cs + c.cz * sn), oz: wz - (-c.cx * sn + c.cz * cs), yaw, y0: h.wy + B.lift };
  }
  function stampCheck(f) {
    const c = B.clipb;
    if (f.y0 < 0.3) return "Too wet to build here";
    for (let n = 0; n < c.samples.length; n += c.step) {
      const [x, z] = toWorld(f, c.samples[n][0], c.samples[n][1]),
        hgt = G.heightAt(x, z);
      if (hgt > f.y0 + 4 || hgt < f.y0 - 6) return "Too steep here. Level the ground first";
      const why = blockedBy(x, z);
      if (why) return why;
    }
    if (!B.free && c.cost > W.wood) return "Need " + c.cost + " wood (have " + W.wood + ")";
    return "";
  }
  function stamp() {
    const h = B.hover,
      c = B.clipb;
    if (!h || !c) return;
    const f = stampFrame(h);
    if (stampCheck(f)) return;
    B.undo.push(snapshot());
    B.redo.length = 0;
    const made = [];
    for (const it of c.items) {
      const S = newStruct({ ox: f.ox, oz: f.oz, yaw: f.yaw, y0: f.y0 + it.y0 - c.y0, level: it.level, hs: it.hs, lift: it.lift });
      fill(S, it);
      made.push(S);
    }
    settle(made);
    if (!B.free) {
      W.wood -= c.cost;
      G.markStockDirty();
    }
    G.burst(h.wx, f.y0 + 1, h.wz, 18, 0xcdb48a, 3.5, 3, 0.11, 0.7);
    syncButtons();
  }
  function copyPreview(h) {
    B.key = "";
    B.op = null;
    gridGroup.visible = false;
    const lb = $("blabel");
    lb.style.left = B.ptr.x + 18 + "px";
    lb.style.top = B.ptr.y + 18 + "px";
    const c = B.clipb;
    if (!c) {
      ghostGroup.visible = false;
      label(h.F.isNew ? "Click a building to pick it up" : "Click to copy this building");
      return;
    }
    const f = stampFrame(h);
    if (B.ghostIs !== "c" + c.id) {
      B.ghostIs = "c" + c.id;
      const all = new Geo();
      for (const it of c.items) {
        const ga = buildGeo({ floors: new Set(it.floors), walls: new Map(it.walls), roofs: it.roofs, segs: it.segs, rings: it.rings, stairs: it.stairs, pillars: it.pillars, wmat: new Map(it.wmat), fmat: new Map(it.fmat), hs: it.hs, lift: it.lift, decor: it.decor }, 0.6);
        for (const q of [ga.main, ga.roof, ga.glow]) {
          for (let n = 1; n < q.p.length; n += 3) q.p[n] += it.y0 - c.y0;
          append(all.p, q.p);
          append(all.n, q.n);
          append(all.c, q.c);
        }
      }
      setGeo(ghostAdd, all);
      setGeo(ghostDel, new Geo());
      setGeo(guideMesh, new Geo());
    }
    ghostGroup.position.set(f.ox, f.y0, f.oz);
    ghostGroup.rotation.y = f.yaw;
    ghostGroup.visible = true;
    const why = stampCheck(f);
    ghostAdd.material.color.setHex(why ? 0xe0563f : 0xffe2a0);
    label(why || "Click to place a copy \u00b7 R turns it" + (B.free ? "" : " \u00b7 " + c.cost + " wood"), !!why);
  }
  function undo() {
    if (!B.undo.length) return;
    B.redo.push(snapshot());
    restore(B.undo.pop());
    B.drag = null;
    syncButtons();
  }
  function redo() {
    if (!B.redo.length) return;
    B.undo.push(snapshot());
    restore(B.redo.pop());
    B.drag = null;
    syncButtons();
  }

  function applyOp(op) {
    if (!op || !op.valid) return null;
    B.undo.push(snapshot());
    B.undo.length > 60 && B.undo.shift();
    B.redo.length = 0;
    let S = op.F.isNew ? newStruct({ ox: op.F.ox, oz: op.F.oz, yaw: op.F.yaw, y0: op.y0, level: op.F.level || 0, hs: op.F.hs || B.hs, lift: op.F.lift || 0, po: op.addPaths.length > 0 || op.addDecor.length > 0 }) : op.F;
    let refund = 0;
    for (const idx of [...op.delRoofs].sort((a, b) => b - a)) {
      const r = S.roofs.splice(idx, 1)[0];
      if (!op.replacing) refund += (r.i1 - r.i0 + 1) * (r.j1 - r.j0 + 1) * COST.roof;
    }
    for (const [i, j] of op.delFloors) (S.fmat.delete(ck(i, j)), S.floors.delete(ck(i, j)) && (refund += COST.floor));
    for (const idx of [...op.delPillars].sort((a, b) => b - a)) S.pillars.splice(idx, 1);
    for (const p of op.addPillars) S.pillars.push(p.slice());
    for (const idx of [...op.delPaths].sort((a, b) => b - a)) S.paths.splice(idx, 1);
    for (const p of op.addPaths) S.paths.push(p.slice());
    for (const idx of [...op.delDecor].sort((a, b) => b - a)) S.decor.splice(idx, 1);
    for (const p of op.addDecor) S.decor.push(p.slice());
    for (const [i, j, d] of op.delWalls) {
      const ty = S.walls.get(ek(i, j, d));
      S.walls.delete(ek(i, j, d));
      S.wmat.delete(ek(i, j, d));
      refund += COST.wall + (ty !== "wall" ? COST[ty] || 0 : 0);
    }
    for (const [i, j, d] of op.revert) {
      refund += COST[S.walls.get(ek(i, j, d))] || 0;
      const was = S.walls.get(ek(i, j, d));
      S.walls.set(ek(i, j, d), was === "railgate" ? "rail" : was === "gate" ? "rampart" : "wall");
    }
    for (const [idx, ty] of op.setSegs) S.segs[idx][4] = ty;
    for (const [ri, k, ty] of op.setSides) S.rings[ri].sides[k] = ty;
    for (const [ri, on] of op.ringRoofs) ((S.rings[ri].roof = on), on && (S.rings[ri].rmat = B.rmat));
    for (const idx of [...op.delSegs].sort((a, b) => b - a)) (S.segs.splice(idx, 1), (refund += COST.wall));
    for (const idx of [...op.delRings].sort((a, b) => b - a)) {
      const r = S.rings.splice(idx, 1)[0];
      refund += r.n * r.h * COST.wall + Math.round(Math.PI * r.r * r.r);
    }
    for (const pi of op.delPolyRoofs) S.polyRoofs = S.polyRoofs.filter((p) => !pip(S.polys[pi].pts, p[0], p[1]));
    for (const p of op.addPolyRoofs) S.polyRoofs.push([p[0], p[1], B.rmat]);
    for (const idx of [...op.delStairs].sort((a, b) => b - a)) S.stairs.splice(idx, 1);
    for (const st of op.addStairs) S.stairs.push({ ...st });
    for (const sg of op.addSegs) S.segs.push([...sg.slice(0, 5), B.wmat]);
    for (const r of op.addRings) S.rings.push({ ...r, sides: r.sides.slice(), mat: B.wmat, rmat: B.rmat, fmat: B.fmat });
    for (const [i, j] of op.addFloors) (S.floors.add(ck(i, j)), B.fmat !== "planks" && S.fmat.set(ck(i, j), B.fmat));
    for (const [i, j, d] of op.addWalls) (S.walls.set(ek(i, j, d), op.style || "wall"), B.wmat !== "timber" && S.wmat.set(ek(i, j, d), B.wmat));
    for (const [i, j, d, ty] of op.setTypes) S.walls.set(ek(i, j, d), ty);
    for (const r of op.addRoofs) S.roofs.push({ i0: r.i0, i1: r.i1, j0: r.j0, j1: r.j1, axis: r.axis, shape: r.shape, dir: r.dir, pitch: r.pitch, mat: B.rmat });
    if (!B.free) {
      W.wood += refund - (op.replacing ? 0 : op.cost);
      G.markStockDirty();
    }
    const samples = opSamples(op).map(([lx, lz]) => toWorld(S, lx, lz));
    if (!S.level) cutTerrain(S, samples, !!S.lift);
    else if (S.level < 0) cutTerrain(S, samples, true);
    if (isEmpty(S)) {
      disposeStruct(S);
      B.version++;
      S = null;
    } else {
      rebuild(S);
      if (!S.level && S.polys.length) {
        const inner = [];
        for (const p of S.polys) {
          inner.push(toWorld(S, p.cx, p.cz));
          for (const q of p.pts) inner.push(toWorld(S, (q[0] + p.cx) / 2, (q[1] + p.cz) / 2), toWorld(S, (q[0] * 3 + p.cx) / 4, (q[1] * 3 + p.cz) / 4));
        }
        cutTerrain(S, inner);
      }
    }
    if (S) for (const O of B.structs) O !== S && (sameGrid(O, S) || (O.po && !S.po && Math.hypot(O.cx - S.cx, O.cz - S.cz) < O.rad + S.rad + 6)) && rebuild(O);
    // dust where things landed
    const puffs = samples.filter((_, n) => n % Math.max(1, Math.floor(samples.length / 14)) === 0);
    for (const [x, z] of puffs) G.burst(x, op.y0 + 0.3, z, 3, 0xcdb48a, 1.6, 2.2, 0.1, 0.5);
    if (S)
      for (const r of op.addRings) {
        const [x, z] = toWorld(S, r.cx, r.cz);
        G.burst(x, S.y0 + 1.2, z, 16, 0xcdb48a, 3.5, 3, 0.11, 0.7);
      }
    if (S)
      for (const r of op.addRoofs) {
        const [x, z] = toWorld(S, (r.i0 + r.i1 + 1) / 2, (r.j0 + r.j1 + 1) / 2);
        G.burst(x, S.y0 + EAVE + 1, z, 14, 0xc9ae62, 3, 2, 0.1, 0.7);
      }
    B.key = "";
    syncButtons();
    return S;
  }

  /* ---------- hover and preview ---------- */
  const ray = new T.Raycaster(),
    v2 = new T.Vector2();
  function planeHit(y) {
    const o = ray.ray.origin,
      d = ray.ray.direction;
    if (d.y > -1e-4) return null;
    const t = (y - o.y) / d.y;
    return t > 0 ? [o.x + d.x * t, o.z + d.z * t] : null;
  }
  function snapYaw(y) {
    const q = Math.PI / 12,
      hp = Math.PI / 2;
    return (((Math.round(y / q) * q) % hp) + hp) % hp;
  }
  const pick = { x: 0, y: 0, z: 0, valid: false };
  function terrainHit() {
    const o = ray.ray.origin,
      d = ray.ray.direction;
    let t = 0,
      last = 0;
    pick.valid = false;
    for (let n = 0; n < 160 && t < 320; n++) {
      const x = o.x + d.x * t,
        y = o.y + d.y * t,
        z = o.z + d.z * t,
        h = G.heightAt(x, z);
      if (y < h) {
        let a = last,
          b = t;
        for (let k = 0; k < 8; k++) {
          const m = (a + b) / 2;
          o.y + d.y * m < G.heightAt(o.x + d.x * m, o.z + d.z * m) ? (b = m) : (a = m);
        }
        pick.x = o.x + d.x * b;
        pick.z = o.z + d.z * b;
        pick.y = G.heightAt(pick.x, pick.z);
        pick.valid = true;
        return;
      }
      last = t;
      t += Math.max(0.6, (y - h) * 0.45);
    }
  }
  function updateHover() {
    const c = pick;
    if (!B.ptr.inside) {
      B.hover = null;
      return;
    }
    const rc = canvas.getBoundingClientRect();
    ray.setFromCamera(v2.set(((B.ptr.x - rc.left) / rc.width) * 2 - 1, -(((B.ptr.y - rc.top) / rc.height) * 2 - 1)), G.camera);
    terrainHit();
    if (!c.valid) {
      B.hover = null;
      return;
    }
    let F = null;
    if (B.drag) F = B.drag.F;
    else {
      let best = 1e9;
      for (const S of B.structs) {
        // paths and loose decorations live in their own structures, which only those tools see
        if (S.level !== B.level || (S.po ? B.tool !== "path" && B.tool !== "decor" : B.tool === "path")) continue;
        const hit = (S.po ? null : planeHit(S.y0 + FLOOR_T)) || [c.x, c.z];
        const [lx, lz] = toLocal(S, hit[0], hit[1]);
        const dx = Math.max(S.b.i0 - lx, 0, lx - S.b.i1),
          dz = Math.max(S.b.j0 - lz, 0, lz - S.b.j1),
          dist = Math.hypot(dx, dz);
        if (dist < (B.tool === "decor" && !S.po ? 0.6 : 3.5) && (dist < best || (dist === best && !S.po))) {
          best = dist;
          F = S;
        }
      }
      if (!F && B.level !== 0 && B.tool !== "path" && B.tool !== "copy" && B.tool !== "decor") {
        const below = B.level > 0 ? B.level - 1 : 0;
        for (const S of B.structs) {
          if (S.level !== below || S.po) continue;
          const y0 = B.level > 0 ? S.y0 + EAVE * S.hs : S.y0 - EAVE * B.hs,
            hit = planeHit(y0 + FLOOR_T);
          if (!hit) continue;
          const [lx, lz] = toLocal(S, hit[0], hit[1]);
          if (lx > S.b.i0 - 3 && lx < S.b.i1 + 3 && lz > S.b.j0 - 3 && lz < S.b.j1 + 3) F = { ox: S.ox, oz: S.oz, yaw: S.yaw, y0, isNew: true, level: B.level, hs: B.hs };
        }
        if (!F) {
          B.hover = null;
          return;
        }
      }
      if (!F) {
        const p = B.pending,
          yaw = snapYaw(G.cam.yaw);
        if (p.yaw !== yaw || Math.hypot(c.x - p.ox, c.z - p.oz) > 60) {
          p.yaw = yaw;
          p.ox = Math.round(c.x);
          p.oz = Math.round(c.z);
        }
        p.y0 = c.y + B.lift;
        p.lift = B.lift;
        F = p;
      }
    }
    // existing buildings and drags in progress work on a flat plane, like the grid that is drawn
    const hit = (B.tool === "path" || F.po ? null : F.isNew ? (B.drag || F.level ? planeHit(F.y0) : null) : planeHit(F.y0 + FLOOR_T)) || [c.x, c.z];
    const [lx, lz] = toLocal(F, hit[0], hit[1]);
    B.hover = { F, lx, lz, wx: c.x, wz: c.z, wy: c.y };
    if (!F.isNew && F.roofs && F.roofs.length) {
      const rh = planeHit(F.y0 + EAVE + 0.8);
      if (rh) [B.hover.rlx, B.hover.rlz] = toLocal(F, rh[0], rh[1]);
    }
  }

  function setGeo(mesh, geo) {
    mesh.geometry.dispose();
    mesh.geometry = geo.build();
  }
  function updatePreview() {
    const h = B.hover;
    if (!h) {
      ghostGroup.visible = gridGroup.visible = false;
      label(B.level !== 0 && B.ptr.inside ? (B.level > 0 ? "Upper storeys go above the storey below" : "Cellars go under an existing building") : "");
      $("blabel").style.left = B.ptr.x + 18 + "px";
      $("blabel").style.top = B.ptr.y + 18 + "px";
      B.op = null;
      B.key = "";
      return;
    }
    if (B.tool === "copy") return copyPreview(h);
    const F = h.F,
      d = B.drag;
    const fine = B.tool === "door" || B.tool === "window" || B.tool === "erase" || B.tool === "decor";
    const key = [B.tool, F.isNew ? "n" + F.ox + "," + F.oz + "," + F.yaw : F.id, d ? d.a.i + "," + d.a.j : "-", fine ? Math.round(h.lx * 4) + "," + Math.round(h.lz * 4) : Math.round(h.lx * 2) + "," + Math.round(h.lz * 2), fine && h.rlx !== undefined ? Math.round(h.rlx * 2) + "," + Math.round(h.rlz * 2) : "", B.alt, B.flip, B.levels, B.level, B.hs, B.lift, B.style, B.wstyle, B.dstyle, B.rshape, B.tshape, B.pwidth, B.pmat, B.dkind, B.drot, B.dcol, B.pkind, B.wmat, B.stairDir, B.free, B.version, W.wood].join("|");
    if (key !== B.key) {
      B.key = key;
      B.ghostIs = "op";
      const op = (B.op = computeOp());
      const y0 = F.y0;
      ghostGroup.position.set(F.ox, y0, F.oz);
      ghostGroup.rotation.y = F.yaw;
      gridGroup.position.copy(ghostGroup.position);
      gridGroup.rotation.y = F.yaw;
      const depth = F.isNew ? 1.2 : F.depth || 0.5;
      const A = { floors: new Set(op.addFloors.map(([i, j]) => ck(i, j))), walls: new Map(), roofs: op.addRoofs, segs: op.addSegs.slice(), rings: op.addRings.slice(), stairs: op.addStairs, pillars: op.addPillars, hs: F.hs || B.hs, paths: op.addPaths, frame: F, lift: F.lift || 0, decor: op.addDecor, base: F.isNew ? null : F };
      A.polys = op.addPolyRoofs.length && !F.isNew ? [{ ...F.polys[polyAt(F, op.addPolyRoofs[0][0], op.addPolyRoofs[0][1])], roofed: true }] : [];
      const Sx = F.isNew ? null : F;
      const sideSeg = (ri, k, ty) => [...ringVert(Sx.rings[ri], k), ...ringVert(Sx.rings[ri], k + 1), ty];
      for (const [idx, ty] of op.setSegs) A.segs.push([...Sx.segs[idx].slice(0, 4), ty]);
      for (const [ri, k, ty] of op.setSides) ty && A.segs.push(sideSeg(ri, k, ty));
      for (const [ri, on] of op.ringRoofs) on && A.rings.push({ ...Sx.rings[ri], sides: [], roof: true, floor: false });
      for (const [i, j, dd] of op.addWalls) A.walls.set(ek(i, j, dd), op.style || "wall");
      for (const [i, j, dd, ty] of op.setTypes) A.walls.set(ek(i, j, dd), ty);
      const ga = buildGeo(A, depth);
      const merged = ga.main;
      append(merged.p, ga.roof.p);
      append(merged.n, ga.roof.n);
      append(merged.c, ga.roof.c);
      append(merged.p, ga.glow.p);
      append(merged.n, ga.glow.n);
      append(merged.c, ga.glow.c);
      if (op.marker) merged.abox(op.marker[0] - 0.14, 0, op.marker[1] - 0.14, op.marker[0] + 0.14, d ? EAVE : 0.5, op.marker[1] + 0.14, [1, 1, 1]);
      if (d && (B.tool === "room" || B.tool === "wall")) merged.abox(d.a.i - 0.14, 0, d.a.j - 0.14, d.a.i + 0.14, EAVE, d.a.j + 0.14, [1, 1, 1]);
      setGeo(ghostAdd, merged);
      ghostAdd.material.color.setHex(op.valid || op.idle ? 0xffe2a0 : 0xe0563f);
      const S = F.isNew ? null : F;
      const Dl = { floors: new Set(op.delFloors.map(([i, j]) => ck(i, j))), walls: new Map(), roofs: S && !op.replacing ? op.delRoofs.map((i) => S.roofs[i]) : [] };
      for (const [i, j, dd] of op.delWalls.concat(op.revert)) Dl.walls.set(ek(i, j, dd), S.walls.get(ek(i, j, dd)) || "wall");
      Dl.segs = op.delSegs.map((idx) => S.segs[idx]);
      Dl.rings = op.delRings.map((idx) => S.rings[idx]);
      Dl.stairs = op.delStairs.map((idx) => S.stairs[idx]);
      Dl.pillars = op.delPillars.map((idx) => S.pillars[idx]);
      Dl.paths = op.delPaths.map((idx) => S.paths[idx]);
      Dl.decor = op.delDecor.map((idx) => S.decor[idx]);
      Dl.base = S;
      Dl.frame = F;
      Dl.hs = S ? S.hs : 1;
      Dl.polys = op.delPolyRoofs.map((pi) => S.polys[pi]);
      for (const [ri, k, ty] of op.setSides) ty || Dl.segs.push(sideSeg(ri, k, S.rings[ri].sides[k]));
      for (const [ri, on] of op.ringRoofs) on || Dl.rings.push({ ...S.rings[ri], sides: [], roof: true, floor: false });
      const gd = buildGeo(Dl, depth);
      append(gd.main.p, gd.roof.p);
      append(gd.main.n, gd.roof.n);
      append(gd.main.c, gd.roof.c);
      setGeo(ghostDel, gd.main);
      // alignment guides to existing corners
      const gg = new Geo();
      const tip = op.end || (op.marker ? { i: op.marker[0], j: op.marker[1] } : null);
      if (S && tip && (B.tool === "room" || B.tool === "wall")) {
        let gi = null,
          gj = null;
        for (const [ci, cj] of S.corners) {
          if (ci === tip.i && cj !== tip.j && (!gi || Math.abs(cj - tip.j) < Math.abs(gi[1] - tip.j))) gi = [ci, cj];
          if (cj === tip.j && ci !== tip.i && (!gj || Math.abs(ci - tip.i) < Math.abs(gj[0] - tip.i))) gj = [ci, cj];
        }
        if (gi) gg.abox(tip.i - 0.025, FLOOR_T + 0.03, Math.min(gi[1], tip.j), tip.i + 0.025, FLOOR_T + 0.05, Math.max(gi[1], tip.j), [1, 1, 1]);
        if (gj) gg.abox(Math.min(gj[0], tip.i), FLOOR_T + 0.03, tip.j - 0.025, Math.max(gj[0], tip.i), FLOOR_T + 0.05, tip.j + 0.025, [1, 1, 1]);
      }
      setGeo(guideMesh, gg);
      // label
      let text = op.label || "";
      if (!op.valid && op.reason) text = op.reason;
      else if (op.note) text = op.note;
      else if (op.adds && !B.free && op.cost) text += (text ? " · " : "") + op.cost + " wood";
      else if (op.dels && !op.adds) text = text || "Remove";
      label(text, !op.valid && !!op.reason);
      hint();
    }
    gridGroup.userData.lines.position.set(Math.round(h.lx), FLOOR_T + 0.03, Math.round(h.lz));
    ghostGroup.visible = gridGroup.visible = true;
    const lb = $("blabel");
    if (!lb.hidden) {
      lb.style.left = B.ptr.x + 18 + "px";
      lb.style.top = B.ptr.y + 18 + "px";
    }
  }
  function label(text, bad) {
    const lb = $("blabel");
    lb.hidden = !text;
    lb.textContent = text;
    lb.classList.toggle("bad", !!bad);
  }
  function hint() {
    const tool = TOOLS.find((t) => t.id === B.tool);
    let text = tool.hint;
    const h = B.hover;
    if (B.drag && B.drag.mode === "click") text = "Click to finish. Right-click or Esc to stop.";
    else if (B.drag) text = "Release to place. Right-click or Esc cancels.";
    else if (h && !h.F.isNew) {
      const room = h.F.cellRoom.get(ck(Math.floor(h.lx), Math.floor(h.lz)));
      if (room && room.cells.length > 1) {
        const dims = room.i1 - room.i0 + 1 + " × " + (room.j1 - room.j0 + 1);
        text =
          "Room " +
          dims +
          ": " +
          (room.enclosed ? (room.roofed ? "walled and roofed. You are sheltered in here." : "walled in. Add a roof to make it a shelter.") : room.gaps.length + " open " + (room.gaps.length === 1 ? "edge" : "edges") + " marked in amber.");
      }
    }
    if (B.tool === "copy" && B.clipb) text = "Click to place a copy. R turns it. Right-click or Esc puts it down.";
    if (!B.drag && B.tool !== "door" && B.tool !== "window" && B.tool !== "erase" && B.tool !== "tower" && B.tool !== "stairs" && B.tool !== "copy") text += " Hold Alt to remove instead.";
    if (document.body.classList.contains("touch"))
      text = text
        .replace(" Hold Alt to remove instead.", " Remove takes pieces away.")
        .replace("Right-click or Esc cancels.", "Cancel drops it.")
        .replace("Right-click or Esc puts it down.", "Cancel puts it down.")
        .replace(/\bClick\b/g, "Tap")
        .replace(/\bclick\b/g, "tap")
        .replace(/, comma and full stop step through the pieces/, "")
        .replace(/\bM\b(?= (changes|the))/g, "Material")
        .replace(/\bR\b(?= (turns|changes|switches|steps|sets))/g, "Style");
    $("bhint").textContent = text;
  }

  /* ---------- input ---------- */
  function anchorFor(h) {
    if (B.tool === "wall" || B.tool === "tower" || B.tool === "pillar" || B.tool === "path") return { i: Math.round(h.lx * 2) / 2, j: Math.round(h.lz * 2) / 2 };
    return B.tool === "room" ? { i: Math.round(h.lx), j: Math.round(h.lz) } : { i: Math.floor(h.lx), j: Math.floor(h.lz) };
  }
  function freeze(F) {
    return F.isNew ? { ...F } : F;
  }
  function commit() {
    B.key = "";
    updateHover();
    const op = computeOp();
    const d = B.drag;
    B.drag = null;
    if (!op || !op.valid) {
      if (op && op.reason) flash(op.reason);
      B.key = "";
      return;
    }
    const end = op.end;
    const S = applyOp(op);
    if (S && d && d.mode === "click" && (B.tool === "wall" || B.tool === "path") && end) B.drag = { F: S, a: end, t: performance.now(), mode: "click" };
  }
  function flash() {
    B.key = ""; // the preview label already shows the reason in red
  }
  // Touch: the aim point sits a little above the finger so the piece is not hidden under it.
  // One finger draws or places (lift to confirm), two fingers pinch, twist and tilt the view.
  const AIM_UP = 46,
    fingers = new Map();
  let gest = null;
  const aimDot = document.createElement("div");
  aimDot.id = "baim";
  aimDot.hidden = true;
  document.body.appendChild(aimDot);
  function setPtr(e, inside = true) {
    const touch = e.pointerType === "touch";
    B.ptr.x = e.clientX;
    B.ptr.y = e.clientY - (touch && B.on ? AIM_UP : 0);
    B.ptr.inside = inside;
    aimDot.hidden = !(touch && B.on && inside);
    aimDot.style.left = B.ptr.x + "px";
    aimDot.style.top = B.ptr.y + "px";
  }
  const pair = () => {
    const [p, q] = [...fingers.values()];
    return { d: Math.hypot(q.x - p.x, q.y - p.y) || 1, ang: Math.atan2(q.y - p.y, q.x - p.x), my: (p.y + q.y) / 2 };
  };
  // the tools that act on a single click
  const tapTool = () => B.tool === "copy" || (B.drag && B.drag.mode === "click") || (B.tool === "path" && B.alt) || B.tool === "decor" || B.tool === "door" || B.tool === "window" || B.tool === "pillar";
  function tapAct() {
    if (B.tapMode) {
      updateHover();
      B.tapMode === "paint" ? paint(true) : eyedrop();
      if (B.tapMode === "pick") B.tapMode = "";
      return;
    }
    if (B.tool === "copy") return void (B.clipb ? stamp() : copyPick());
    commit();
  }
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch" && fingers.has(e.pointerId)) {
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gest && fingers.size >= 2) {
        const now = pair();
        let da = now.ang - gest.ang;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        G.cam.dist = clamp((gest.dist * gest.d) / now.d, 9, 50);
        G.cam.yaw = gest.yaw + da;
        G.cam.pitch = clamp(gest.pitch + (now.my - gest.my) * 0.004, 0.5, 1.35);
        B.camT = 0;
        return;
      }
      if (gest) return;
    }
    setPtr(e);
    if (B.on && e.buttons & 2) {
      G.cam.yaw -= e.movementX * 0.006;
      G.cam.pitch = clamp(G.cam.pitch + e.movementY * 0.004, 0.5, 1.35);
      B.camT = 0;
    }
  });
  canvas.addEventListener("pointerleave", (e) => e.pointerType !== "touch" && (B.ptr.inside = false));
  canvas.addEventListener("pointerdown", (e) => {
    const touch = e.pointerType === "touch";
    if (touch && B.on) {
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size >= 2) {
        // a second finger: drop whatever was being drawn and move the view instead
        if (!gest) gest = { ...pair(), dist: G.cam.dist, yaw: G.cam.yaw, pitch: G.cam.pitch };
        B.aim = false;
        if (B.drag && B.drag.mode === "drag") B.drag = null;
        B.key = "";
        setPtr(e, false);
        return;
      }
    }
    setPtr(e);
    if (e.button === 2) {
      B.ptr.rx = e.clientX;
      B.ptr.ry = e.clientY;
      return;
    }
    if (!B.on || e.button !== 0) return;
    updateHover();
    const h = B.hover;
    if (!h) return;
    if (B.tapMode || tapTool()) {
      // a finger aims first and acts when it lifts; a mouse acts at once
      if (touch) return void ((B.aim = true), (B.key = ""));
      return tapAct();
    }
    // Shift starts a separate wing on the same grid, with its own height
    const wing = (e.shiftKey || B.wingNext) && !h.F.isNew ? { ox: h.F.ox, oz: h.F.oz, yaw: h.F.yaw, y0: h.F.y0 + B.lift, isNew: true, level: h.F.level, hs: B.hs, lift: B.lift } : null;
    B.wingNext = false;
    B.drag = { F: wing || freeze(h.F), a: anchorFor(h), t: performance.now(), mode: "drag" };
    B.key = "";
  });
  const liftFinger = (e, act) => {
    const touch = e.pointerType === "touch";
    if (touch && fingers.has(e.pointerId)) {
      fingers.delete(e.pointerId);
      if (gest) {
        if (!fingers.size) gest = null;
        return true;
      }
    }
    if (touch && B.aim) {
      B.aim = false;
      if (act) (setPtr(e), updateHover(), tapAct());
      setPtr(e, false);
      B.key = "";
      return true;
    }
    return false;
  };
  canvas.addEventListener("pointercancel", (e) => {
    liftFinger(e, false);
    if (e.pointerType === "touch") {
      if (B.drag && B.drag.mode === "drag") B.drag = null;
      setPtr(e, false);
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    if (liftFinger(e, true)) return;
    if (e.button === 2) {
      if (B.on && Math.hypot(e.clientX - B.ptr.rx, e.clientY - B.ptr.ry) < 6) {
        if (B.tool === "copy" && B.clipb) ((B.clipb = null), hint());
        B.drag = null;
        B.key = "";
      }
      return;
    }
    const touch = e.pointerType === "touch";
    if (!B.on || e.button !== 0 || !B.drag || B.drag.mode !== "drag") return void (touch && setPtr(e, false));
    setPtr(e);
    updateHover();
    const h = B.hover,
      d = B.drag;
    const same = !h || (anchorFor(h).i === d.a.i && anchorFor(h).j === d.a.j);
    if (same && (B.tool === "room" || B.tool === "wall" || B.tool === "path")) {
      // a plain click: switch to click-to-click drawing
      if (performance.now() - d.t < 350) d.mode = "click";
      else B.drag = null;
      B.key = "";
      if (touch) setPtr(e, false);
      return;
    }
    commit();
    if (touch) setPtr(e, false);
  });

  function setTool(id) {
    B.tool = id;
    $("bmat") && (showMat(), showStyle());
    $("bdecor") && ($("bdecor").hidden = id !== "decor");
    B.drag = null;
    B.key = "";
    syncButtons();
    hint();
  }
  function setLevel(l) {
    B.level = clamp(l, -1, 3);
    B.drag = null;
    B.key = "";
    $("blname").textContent = (B.level > 0 ? "Storey " + (B.level + 1) : B.level < 0 ? "Cellar" : "Ground") + (B.lift ? " " + (B.lift > 0 ? "+" : "") + B.lift + " m" : "");
  }
  // V changes the ceiling height: of the storey under the cursor, or of what you build next
  function cycleHeight() {
    const h = B.hover,
      S = h && !h.F.isNew ? h.F : null,
      cur = S ? S.hs : B.hs,
      next = HEIGHTS[(HEIGHTS.findIndex((x) => x[0] === cur) + 1) % HEIGHTS.length];
    B.hs = next[0];
    if (S) {
      B.undo.push(snapshot());
      B.redo.length = 0;
      const delta = EAVE * (next[0] - S.hs);
      S.hs = next[0];
      for (const O of B.structs)
        if (O !== S && sameGrid(O, S) && O.level > S.level && S.level >= 0) {
          O.y0 += delta;
          O.group.position.y = O.y0;
        }
      for (const O of B.structs) sameGrid(O, S) && rebuild(O);
      syncButtons();
    }
    $("bheight").textContent = "Height: " + next[1];
    B.key = "";
  }
  const matCat = () => (B.tool === "roof" ? ["rmat", ROOFS] : B.tool === "floor" ? ["fmat", FLOORS] : B.tool === "path" ? ["pmat", PATHS] : ["wmat", WALLS]);
  const cyc = (list, cur, back) => list[(list.indexOf(cur) + (back ? list.length - 1 : 1)) % list.length];
  const overTower = () => !!B.hover && !B.hover.F.isNew && ringAt(B.hover.F, B.hover.lx, B.hover.lz) >= 0;
  // R steps through the styles of the current tool
  function cycleStyle(back) {
    const t = B.tool;
    if (t === "tower") B.levels = back ? ((B.levels + 2) % 4) + 1 : (B.levels % 4) + 1;
    else if (t === "wall") B.style = cyc(Object.keys(STYLE_NAME), B.style, back);
    else if (t === "window") B.wstyle = cyc(Object.keys(WIN_NAME), B.wstyle, back);
    else if (t === "door") B.dstyle = cyc(Object.keys(DOOR_NAME), B.dstyle, back);
    else if (t === "pillar") B.pkind = B.pkind === "pillar" ? "chimney" : "pillar";
    else if (t === "stairs") B.stairDir = (B.stairDir + (back ? 3 : 1)) % 4;
    else if (t === "path") B.pwidth = cyc([1, 2, 3], B.pwidth, back);
    else if (t === "decor") B.drot = (B.drot + (back ? 7 : 1)) % 8;
    else if (t === "copy") B.clipb && (B.clipb.rot = (B.clipb.rot + (back ? 7 : 1)) % 8);
    else if (t === "roof") {
      if (overTower()) B.tshape = cyc(Object.keys(TOP_NAME), B.tshape, back);
      else B.rshape = (B.rshape + (back ? RSHAPES.length - 1 : 1)) % RSHAPES.length;
    }
    B.key = "";
    showStyle();
  }
  function showStyle() {
    const t = B.tool,
      text =
        t === "wall"
          ? STYLE_NAME[B.style]
          : t === "window"
            ? WIN_NAME[B.wstyle]
            : t === "door"
              ? DOOR_NAME[B.dstyle]
              : t === "pillar"
                ? B.pkind === "chimney"
                  ? "Chimney"
                  : "Pillar"
                : t === "tower"
                  ? B.levels + (B.levels > 1 ? " storeys" : " storey")
                  : t === "roof"
                    ? RSHAPES[B.rshape][2].replace(" roof", "") + " \u00b7 tower: " + TOP_NAME[B.tshape].toLowerCase().replace(" roof", "")
                    : t === "path"
                      ? B.pwidth + " m wide"
                      : t === "decor"
                        ? "Turned " + B.drot * 45 + "\u00b0"
                        : t === "copy"
                          ? "Turn the copy"
                        : "";
    const b = $("bstyle");
    b.textContent = text ? "Style: " + text : "Style";
    b.disabled = !text;
  }
  function showMat() {
    if (B.tool === "decor") return void ($("bmat").textContent = "Colour: " + DYES[B.dcol][0]);
    const [k, set] = matCat();
    $("bmat").textContent = "Material: " + set[B[k]].name;
  }
  function pickDecor(kind) {
    B.dkind = kind;
    B.key = "";
    const cat = DECOR[kind].cat;
    for (const b of document.querySelectorAll("#bdcats button")) b.setAttribute("aria-pressed", +b.dataset.cat === cat ? "true" : "false");
    const wrap = $("bditems");
    wrap.textContent = "";
    for (const k of DKEYS) {
      if (DECOR[k].cat !== cat) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = DECOR[k].name;
      b.setAttribute("aria-pressed", k === kind ? "true" : "false");
      b.addEventListener("click", () => (pickDecor(k), canvas.focus()));
      wrap.appendChild(b);
    }
  }
  function cycleMat() {
    if (B.tool === "decor") {
      B.dcol = (B.dcol + 1) % DYES.length;
      B.key = "";
      return showMat();
    }
    const [k, set] = matCat(),
      ids = Object.keys(set);
    B[k] = ids[(ids.indexOf(B[k]) + 1) % ids.length];
    showMat();
    B.key = "";
  }
  // the piece under the cursor, for painting and for picking up its material
  function targetAt() {
    const h = B.hover;
    if (!h || h.F.isNew) return null;
    const S = h.F,
      cell = ck(Math.floor(h.lx), Math.floor(h.lz));
    if (B.tool === "decor") {
      const n = nearestDecor(S, h.lx, h.lz, 0.6);
      return n < 0 ? null : { S, cat: "dcol", get: () => S.decor[n][4] || 0, set: (m) => (S.decor[n][4] = m), item: S.decor[n] };
    }
    if (B.tool === "roof" && h.rlx !== undefined) {
      const gi = S.roofs.findIndex((r) => h.rlx >= r.i0 - 0.4 && h.rlx <= r.i1 + 1.4 && h.rlz >= r.j0 - 0.4 && h.rlz <= r.j1 + 1.4);
      if (gi >= 0) return { S, cat: "rmat", get: () => S.roofs[gi].mat || "thatch", set: (m) => (S.roofs[gi].mat = m) };
      const ri = S.rings.findIndex((r) => r.roof && Math.hypot(h.rlx - r.cx, h.rlz - r.cz) < r.r + 0.5);
      if (ri >= 0) return { S, cat: "rmat", get: () => S.rings[ri].rmat || "thatch", set: (m) => (S.rings[ri].rmat = m) };
    }
    const e = nearestEdge(S, h.lx, h.lz, true),
      fp = pickFree(S, h.lx, h.lz);
    if (fp && fp.dist < 0.35 && (!e || fp.dist < e[3]))
      return fp.kind === "seg" ? { S, cat: "wmat", get: () => S.segs[fp.idx][5] || "timber", set: (m) => (S.segs[fp.idx][5] = m) } : { S, cat: "wmat", get: () => S.rings[fp.ri].mat || "timber", set: (m) => (S.rings[fp.ri].mat = m) };
    if (e && e[3] < 0.35) {
      const k = ek(e[0], e[1], e[2]);
      return { S, cat: "wmat", get: () => S.wmat.get(k) || "timber", set: (m) => S.wmat.set(k, m) };
    }
    if (S.floors.has(cell)) return { S, cat: "fmat", get: () => S.fmat.get(cell) || "planks", set: (m) => S.fmat.set(cell, m) };
    const ri = ringAt(S, h.lx, h.lz);
    if (ri >= 0) return { S, cat: "fmat", get: () => S.rings[ri].fmat || "planks", set: (m) => (S.rings[ri].fmat = m) };
    return null;
  }
  function paint(fresh) {
    const t = targetAt();
    if (!t || t.get() === B[t.cat]) return;
    if (fresh) {
      B.undo.push(snapshot());
      B.redo.length = 0;
    }
    t.set(B[t.cat]);
    rebuild(t.S);
    syncButtons();
  }
  function eyedrop() {
    const t = targetAt();
    if (!t) return;
    if (t.item) ((B.drot = t.item[3] || 0), pickDecor(t.item[2]), showStyle());
    B[t.cat] = t.get();
    showMat();
    B.key = "";
  }
  function toggle() {
    if (P.tool !== "build") {
      B.prevTool = P.tool;
      G.setTool("build");
    } else G.setTool(B.prevTool === "build" ? "axe" : B.prevTool);
  }
  function syncButtons() {
    for (const b of document.querySelectorAll("#bpieces button")) b.setAttribute("aria-pressed", b.dataset.piece === B.tool ? "true" : "false");
    $("bundo").disabled = !B.undo.length;
    $("bredo").disabled = !B.redo.length;
    $("bfree").setAttribute("aria-pressed", B.free ? "true" : "false");
    $("bfree").textContent = B.free ? "Free: on" : "Free: off";
  }
  function enter() {
    B.on = true;
    // building wants a free cursor and a higher, steadier view
    try {
      document.pointerLockElement && document.exitPointerLock();
    } catch {}
    B.camSaved = { pitch: G.cam.pitch, dist: G.cam.dist };
    B.camT = 0.6;
    G.refreshLock && G.refreshLock();
    document.body.classList.add("building");
    $("buildbar").hidden = false;
    for (const S of B.structs) S.gapMesh && (S.gapMesh.visible = true);
    syncButtons();
    hint();
  }
  function exit() {
    B.on = false;
    if (B.camSaved) {
      G.cam.pitch = B.camSaved.pitch;
      G.cam.dist = B.camSaved.dist;
      B.camSaved = null;
    }
    G.refreshLock && G.refreshLock();
    B.drag = null;
    document.body.classList.remove("building");
    $("buildbar").hidden = true;
    ghostGroup.visible = gridGroup.visible = false;
    label("");
    for (const S of B.structs) S.gapMesh && (S.gapMesh.visible = false);
  }

  // UI
  {
    const wrap = $("bpieces");
    TOOLS.forEach((t, n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.piece = t.id;
      b.title = t.hint;
      b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[t.id] + '</svg><span class="name">' + t.name + '</span><span class="key">' + (t.key || (n + 1) % 10) + "</span>";
      b.addEventListener("click", () => {
        setTool(t.id);
        canvas.focus();
      });
      wrap.appendChild(b);
    });
    const lv = document.createElement("div");
    lv.id = "blevel";
    lv.innerHTML = '<button id="blup" type="button" title="Build one storey up (Page Up)">Up</button><span id="blname">Ground</span><button id="bldn" type="button" title="Build one storey down (Page Down)">Down</button><button id="bmat" type="button" title="Material for what you build next (M). P paints the piece under the cursor, I picks its material up">Material: Timber</button><button id="bheight" type="button" title="Ceiling height of the storey under the cursor, or of what you build next (V)">Height: Normal</button><button id="bstyle" type="button" title="Style of the current tool (R, or Shift+R to step back)">Style</button>';
    lv.style.gridTemplateColumns = "auto auto";
    lv.style.columnGap = "4px";
    lv.insertBefore($("bmat") || lv.querySelector("#bmat"), lv.querySelector("#blname"));
    lv.insertBefore(lv.querySelector("#bheight"), lv.querySelector("#bldn"));
    $("buildbar").querySelector(".row").insertBefore(lv, $("buildbar").querySelector(".sep"));
    $("blup").addEventListener("click", () => (setLevel(B.level + 1), canvas.focus()));
    $("bldn").addEventListener("click", () => (setLevel(B.level - 1), canvas.focus()));
    $("bmat").addEventListener("click", () => (cycleMat(), canvas.focus()));
    $("bheight").addEventListener("click", () => (cycleHeight(), canvas.focus()));
    $("bstyle").addEventListener("click", (e) => (cycleStyle(e.shiftKey), canvas.focus()));
    const dp = document.createElement("div");
    dp.id = "bdecor";
    dp.hidden = true;
    dp.innerHTML = '<div id="bdcats" role="group" aria-label="Kinds of decoration"></div><div id="bditems" role="group" aria-label="Decorations"></div>';
    $("buildbar").insertBefore(dp, $("buildbar").querySelector(".row"));
    DCATS.forEach((name, n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.cat = n;
      b.textContent = name;
      b.addEventListener("click", () => (pickDecor(DKEYS.find((k) => DECOR[k].cat === n)), canvas.focus()));
      $("bdcats").appendChild(b);
    });
    pickDecor(B.dkind);
    showStyle();
    $("bundo").addEventListener("click", () => (undo(), canvas.focus()));
    $("bredo").addEventListener("click", () => (redo(), canvas.focus()));
    $("bfree").addEventListener("click", () => {
      B.free = !B.free;
      B.key = "";
      syncButtons();
      canvas.focus();
    });
    $("bdone").addEventListener("click", () => (toggle(), canvas.focus()));
  }
  window.addEventListener("keyup", (e) => {
    if (e.code === "AltLeft" || e.code === "AltRight") B.alt = false;
  });
  window.addEventListener("blur", () => (B.alt = false));

  /* ---------- hooks called by the engine ---------- */
  function collideOnce(e, r, isPlayer, S) {
    let [lx, lz] = toLocal(S, e.x, e.z);
    const prev = e.__bp && e.__bp.id === S.id ? e.__bp : null;
    const ey = e.y === undefined ? 1e9 : e.y;
    const low = ey < S.y0 + FLOOR_T - 0.65;
    const R0 = r + HALF_T,
      wallTop = S.y0 + EAVE * S.hs - 0.65;
    const fx = Math.floor(lx),
      fz = Math.floor(lz),
      px = prev ? Math.floor(prev.lx) : fx,
      pz = prev ? Math.floor(prev.lz) : fz;
    let moved = false;
    if (Math.abs(px - fx) + Math.abs(pz - fz) > 8) return void (e.__bp = { id: S.id, lx, lz });
    for (let j = Math.min(fz, pz) - 1; j <= Math.max(fz, pz) + 2; j++)
      for (let i = Math.min(fx, px) - 1; i <= Math.max(fx, px) + 2; i++)
        for (let d = 0; d < 2; d++) {
          const wk = ek(i, j, d),
            ty = S.walls.get(wk);
          if (ty && ((S.hid.size && S.hid.has(wk)) || (isThick(ty) && ey > wallTop))) continue;
          let block = blocks(ty, isPlayer, low);
          const R = isThick(ty) ? r + 0.52 : R0;
          if (!block && !ty && low) {
            const a = d === 0 ? S.floors.has(ck(i, j - 1)) : S.floors.has(ck(i - 1, j)),
              b = S.floors.has(ck(i, j));
            block = a !== b;
          }
          if (!block) continue;
          // u runs along the edge, w across it
          const u = d === 0 ? lx - i : lz - j,
            w = d === 0 ? lz - j : lx - i;
          if (prev) {
            const pw = d === 0 ? prev.lz - j : prev.lx - i;
            if (pw * w < 0 && u > -r && u < 1 + r && Math.abs(pw) > 1e-3) {
              const nw = Math.sign(pw) * R;
              d === 0 ? (lz = j + nw) : (lx = i + nw);
              moved = true;
              continue;
            }
          }
          const cu = clamp(u, 0, 1),
            du = u - cu,
            dist = Math.hypot(du, w);
          if (dist < R) {
            let nu = du,
              nw = w;
            if (dist < 1e-4) {
              nu = 0;
              nw = 1;
            } else {
              nu /= dist;
              nw /= dist;
            }
            const pu = cu + nu * R,
              pw2 = nw * R;
            if (d === 0) {
              lx = i + pu;
              lz = j + pw2;
            } else {
              lz = j + pu;
              lx = i + pw2;
            }
            moved = true;
          }
        }
    for (const sg of S.colSegs) {
      const ty = sg[4];
      if (!blocks(ty, isPlayer, low) || (isThick(ty) && ey > wallTop)) continue;
      const R = isThick(ty) ? r + 0.52 : R0;
      const ax = sg[0],
        az = sg[1],
        dx = sg[2] - ax,
        dz = sg[3] - az,
        L2 = dx * dx + dz * dz,
        len = Math.sqrt(L2);
      if (prev) {
        const s1 = (prev.lx - ax) * dz - (prev.lz - az) * dx,
          s2 = (lx - ax) * dz - (lz - az) * dx,
          t = ((lx - ax) * dx + (lz - az) * dz) / L2;
        if (s1 * s2 < 0 && t > -0.25 && t < 1.25 && Math.abs(s1) > 1e-4) {
          const push = Math.sign(s1) * R - s2 / len;
          lx += (dz / len) * push;
          lz += (-dx / len) * push;
          moved = true;
          continue;
        }
      }
      const t = clamp(((lx - ax) * dx + (lz - az) * dz) / L2, 0, 1),
        qx = ax + dx * t,
        qz = az + dz * t,
        ex = lx - qx,
        ez = lz - qz,
        dd = Math.hypot(ex, ez);
      if (dd < R && dd > 1e-5) {
        lx = qx + (ex / dd) * R;
        lz = qz + (ez / dd) * R;
        moved = true;
      }
    }
    if (moved) [e.x, e.z] = toWorld(S, lx, lz);
    e.__bp = { id: S.id, lx, lz };
  }
  // The piece interface, version 0 (see ARCHITECTURE.md). Every built element as plain data:
  // what it is, what it is made of, and its size and place in world metres. Simulation systems
  // (structure, heat, salvage) read buildings only through this list, never through build mode's internals.
  function listPieces() {
    const out = [];
    for (const S of B.structs) {
      const h = WALL_H * S.hs;
      const at = (lx, lz) => { const [x, z] = toWorld(S, lx, lz); return { x, z }; };
      const add = (kind, type, material, a, b, y0, y1, extra) => out.push({ id: S.id + ":" + kind + ":" + out.length, struct: S.id, kind, type, material, a, b, y0: S.y0 + y0, y1: S.y0 + y1, ...extra });
      for (const k of S.floors) {
        const [i, j] = parse(k);
        add("floor", "floor", S.fmat.get(k) || "planks", at(i, j), at(i + 1, j + 1), -FLOOR_T, 0, { area: 1, thickness: FLOOR_T });
      }
      for (const [k, type] of S.walls) {
        const [i, j, d] = parse(k);
        const low = isLow(type);
        add(isDoor(type) ? "door" : isWin(type) ? "window" : "wall", type, S.wmat.get(k) || "timber", at(i, j), d === 0 ? at(i + 1, j) : at(i, j + 1), 0, low ? 1 : h, { length: 1, height: low ? 1 : h, thickness: isThick(type) ? 1 : HALF_T * 2 });
      }
      for (const sg of S.segs) {
        const len = Math.hypot(sg[2] - sg[0], sg[3] - sg[1]);
        add("wall", String(sg[4] || "wall"), "timber", at(sg[0], sg[1]), at(sg[2], sg[3]), 0, h, { length: len, height: h, thickness: HALF_T * 2, free: true });
      }
      for (const p of S.pillars) add("post", "pillar", "timber", at(p[0], p[1]), at(p[0], p[1]), 0, h, { height: h });
      for (const r of S.roofs) out.push({ id: S.id + ":roof:" + out.length, struct: S.id, kind: "roof", type: "roof", material: "thatch", raw: { ...r } });
      for (const r of S.rings) out.push({ id: S.id + ":tower:" + out.length, struct: S.id, kind: "tower", type: "tower", material: "stone", raw: { ...r, sides: r.sides.slice() } });
    }
    return out;
  }
  window.__build = {
    pieces: listPieces,
    get version() { return B.version; },
    _t: { copyPick: () => copyPick(), stamp: () => stamp(), topWalk, rebuild },
    key(e) {
      if (e.code === "AltLeft" || e.code === "AltRight") B.alt = true;
      if (e.code === "KeyB" && !e.repeat) {
        toggle();
        return true;
      }
      if (!B.on) {
        if (e.code === "Digit5" && !e.repeat) {
          toggle();
          return true;
        }
        return false;
      }
      if (e.code === "PageUp" || e.code === "BracketRight") return (setLevel(B.level + 1), e.preventDefault(), true);
      if (e.code === "PageDown" || e.code === "BracketLeft") return (setLevel(B.level - 1), e.preventDefault(), true);
      if (e.code === "KeyV" && !e.repeat) return (cycleHeight(), true);
      if (e.code === "KeyL" && !e.repeat) return (setTool("path"), true);
      if (e.code === "KeyF" && !e.repeat) return (setTool("decor"), true);
      if ((e.code === "Comma" || e.code === "Period") && B.tool === "decor") return (pickDecor(cyc(DKEYS, B.dkind, e.code === "Comma")), true);
      if (e.code === "KeyK" && !e.repeat) return (setTool("copy"), true);
      if (e.code === "KeyM" && !e.repeat) return (cycleMat(), true);
      if (e.code === "KeyP") return (paint(!e.repeat), true);
      if (e.code === "KeyI" && !e.repeat) return (eyedrop(), true);
      if (e.code === "Equal" || e.code === "Minus" || e.code === "NumpadAdd" || e.code === "NumpadSubtract") {
        B.lift = clamp(B.lift + (e.code === "Equal" || e.code === "NumpadAdd" ? 0.5 : -0.5), -3, 6);
        setLevel(B.level);
        return true;
      }
      const m = /^Digit([0-9])$/.exec(e.code);
      if (m) {
        setTool(TOOLS[m[1] === "0" ? 9 : +m[1] - 1].id);
        return true;
      }
      if (e.code === "KeyR" && !e.repeat) {
        cycleStyle(e.shiftKey);
      } else if (e.code === "Escape") {
        if (B.tool === "copy" && B.clipb) ((B.clipb = null), hint());
        else if (B.drag) {
          B.drag = null;
          B.key = "";
        } else toggle();
      } else if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") {
        e.preventDefault();
        redo();
      } else if ((e.code === "Delete" || e.code === "Backspace" || e.code === "KeyX") && !e.repeat) setTool("erase");
      return /^Digit/.test(e.code);
    },
    collide(e, r, isPlayer) {
      let near = null;
      for (const S of B.structs) {
        if (Math.hypot(e.x - S.cx, e.z - S.cz) > S.rad + r + 1.5) continue;
        const ey = e.y === undefined ? S.y0 : e.y;
        S.rings.length && ringHold(e, r, S);
        if (S.level ? ey < S.y0 + FLOOR_T - 0.65 || ey > S.y0 + EAVE * S.hs : ey > S.y0 + EAVE * S.hs - 0.3 || ey < S.y0 - 1.2) continue;
        collideOnce(e, r, isPlayer, S);
        collideOnce(e, r, isPlayer, S);
        near = S;
      }
      if (!near) e.__bp = null;
    },
    // true where a floor, tower floor, yard or path lies over the ground: grass and ground cover are hidden there
    covers(x, z) {
      for (const S of B.structs) {
        if (Math.hypot(x - S.cx, z - S.cz) > S.rad + 3) continue;
        const [lx, lz] = toLocal(S, x, z);
        for (const [ax, az] of COVER_TAPS) if (onFloorAt(S, lx + ax, lz + az)) return true;
        for (const sg of S.paths) {
          const dx = sg[2] - sg[0], dz = sg[3] - sg[1], L2 = dx * dx + dz * dz || 1, t = clamp(((lx - sg[0]) * dx + (lz - sg[1]) * dz) / L2, 0, 1);
          if (Math.hypot(lx - sg[0] - dx * t, lz - sg[1] - dz * t) < sg[4] * 0.5 + 0.15) return true;
        }
      }
      return false;
    },
    ground(x, z, y, terrain) {
      let g = terrain;
      for (const S of B.structs) {
        if (Math.hypot(x - S.cx, z - S.cz) > S.rad + 3) continue;
        const [lx, lz] = toLocal(S, x, z);
        const ci = Math.floor(lx),
          cj = Math.floor(lz);
        if ((S.floors.has(ck(ci, cj)) && !wellOver(S, ci, cj)) || ringAt(S, lx, lz, 0.1) >= 0 || polyAt(S, lx, lz) >= 0) {
          const top = S.y0 + FLOOR_T;
          if (y >= top - 0.65) g = Math.max(g, top);
        }
        if (S.thick || S.rings.length) {
          const tw = topWalk(S, lx, lz, y);
          if (tw !== null) g = Math.max(g, tw);
        }
        const sh = stairH(S, lx, lz);
        if (sh !== null && y >= S.y0 + sh - 0.65) g = Math.max(g, S.y0 + sh);
      }
      return g;
    },
    update(dt) {
      flushCover(dt);
      const on = P.tool === "build" && !(P.dead > 0);
      if (on !== B.on) on ? enter() : exit();
      {
        const sd = $("seed") ? $("seed").textContent : "0";
        if (sd !== B.seed) {
          B.seed = sd;
          loadBuilds();
          B.savedV = B.version;
          B.saveT = 0;
        } else if (B.version !== B.savedV && !B.drag) {
          B.saveT += dt;
          if (B.saveT > 1.2) {
            saveBuilds();
            B.savedV = B.version;
            B.saveT = 0;
          }
        }
      }
      // roofs lift away when you are under them or drafting; doors swing; shelter
      let sheltered = false,
        cosy = 0,
        bed = false;
      const lit = [];
      B.smokeT -= dt;
      const puff = B.smokeT <= 0;
      if (puff) B.smokeT = 0.3;
      // which floor you are standing on (if any), found once so that every wing of the same building opens together.
      // The height band reaches well above the floor so the walls do not flap when you jump indoors.
      let homeY = null, homeUnder = false;
      for (const S of B.structs) {
        const [hx, hz] = toLocal(S, P.x, P.z), hi = Math.floor(hx), hj = Math.floor(hz), dy = P.y - (S.y0 + FLOOR_T);
        if ((S.floors.has(ck(hi, hj)) || ringAt(S, hx, hz) >= 0 || polyAt(S, hx, hz) >= 0) && dy > -0.7 && dy < Math.min(2.2, EAVE * S.hs - 0.5)) {
          homeY = S.y0;
          homeUnder = covered(S, hi, hj) || (S.floors.has(ck(hi, hj)) && S.roofs.length > 0);
          break;
        }
      }
      for (const S of B.structs) {
        const [lx, lz] = toLocal(S, P.x, P.z);
        const sameHome = homeY !== null && Math.abs(S.y0 - homeY) < 0.4 && Math.hypot(P.x - S.cx, P.z - S.cz) < S.rad + 5;
        if (S.decor.length && Math.hypot(P.x - S.cx, P.z - S.cz) < S.rad + 45) {
          S.glowMat.color.setScalar(0.86 + 0.14 * Math.sin(performance.now() * 0.011 + S.id * 1.7) * Math.sin(performance.now() * 0.0047 + S.id));
          for (const l of S.lights) lit.push([Math.hypot(l[0] - lx, l[2] - lz), S, l]);
          if (puff)
            for (const q of S.fires) {
              const [wx, wz] = toWorld(S, q[0], q[2]);
              G.burst(wx, S.y0 + q[1], wz, 1, 0x9a968f, 0.25, 1.7, 0.28, 1.5);
            }
          if (Math.abs(P.y - S.y0) < 1.2) for (const q of S.beds) if (Math.hypot(q[0] - lx, q[1] - lz) < 1.6) bed = true;
        }
        const ci = Math.floor(lx),
          cj = Math.floor(lz);
        const under = Math.abs(P.y - S.y0) < EAVE * S.hs - 0.4 && (covered(S, ci, cj) || (S.floors.has(ck(ci, cj)) && S.roofs.length > 0 && lx > S.b.i0 && lx < S.b.i1 && lz > S.b.j0 && lz < S.b.j1));
        {
          const within = lx > S.b.i0 + 0.15 && lx < S.b.i1 - 0.15 && lz > S.b.j0 + 0.15 && lz < S.b.j1 - 0.15;
          S.group.visible = B.on ? S.level <= B.level : !(within && P.y < S.y0 - 0.6);
        }
        const headroom = EAVE * S.hs - 0.4;
        const tri = ringAt(S, lx, lz),
          inTower = tri >= 0 && P.y > S.y0 + 1 && P.y < S.y0 + S.rings[tri].h * EAVE * S.hs - 0.5;
        {
          // open the building up while you stand in it, so rooms read like a floor plan
          const onFloor = sameHome;
          const full = EAVE * S.hs * S.rings.reduce((m, r) => Math.max(m, r.h), 1) + 0.4;
          const cutT = onFloor ? 1.15 : inTower ? P.y - S.y0 + 1.05 : 0;
          if (!B.on && cutT && !(P.dead > 0)) {
            const cur = Math.min(S.cutH, full);
            S.cutH = cur > cutT ? Math.max(cutT, cur - dt * 9) : Math.min(cutT, cur + dt * 9);
          }
          else if (S.cutH < 99) S.cutH = S.cutH + dt * 9 > full ? 99 : S.cutH + dt * 9;
          S.clip.constant = S.cutH >= 99 ? 1e5 : S.y0 + S.cutH;
          // Only the stretch of wall that stands between the camera and you opens: walls nearer the camera than you
          // are, within a few paces to either side of the line of sight. The wall behind you and the walls off to the
          // sides stay up, so the room still reads as a room wherever you stand in it.
          const cp = G.camera.position;
          let fx = P.x - cp.x,
            fz = P.z - cp.z;
          const fl = Math.hypot(fx, fz) || 1;
          fx /= fl;
          fz /= fl;
          S.near.normal.set(fx, 0, fz);
          S.near.constant = -(fx * P.x + fz * P.z) + 0.15;
          const CUT_W = 3, rp = -fz * P.x + fx * P.z;
          S.sideA.normal.set(-fz, 0, fx);
          S.sideA.constant = -rp - CUT_W;
          S.sideB.normal.set(fz, 0, -fx);
          S.sideB.constant = rp - CUT_W;
          for (const dr of S.doors) {
            const [wx, wz] = toWorld(S, dr.mx, dr.mz);
            dr.mesh.visible = S.cutH > 2.2 || fx * (wx - P.x) + fz * (wz - P.z) > -0.15 || Math.abs(-fz * (wx - P.x) + fx * (wz - P.z)) > CUT_W;
          }
        }
        const pi = polyAt(S, lx, lz);
        const inPoly = pi >= 0 && S.polys[pi].roofed && Math.abs(P.y - S.y0) < headroom;
        if (inPoly && Math.abs(P.y - (S.y0 + FLOOR_T)) < 0.5) sheltered = true;
        const ri = ringAt(S, lx, lz);
        const inRing = ri >= 0 && Math.abs(P.y - S.y0) < headroom;
        const underAny = under || inPoly || (inRing && S.rings[ri].roof) || inTower || (sameHome && homeUnder);
        if (inRing && S.rings[ri].roof && S.rings[ri].sides.every((t) => t) && Math.abs(P.y - (S.y0 + FLOOR_T)) < 0.5) ((sheltered = true), (cosy = Math.max(cosy, S.ringCosy[ri] || 0)));
        const target = B.on ? (B.tool === "roof" || B.tool === "erase" ? 1 : 0) : underAny ? 0 : 1;
        if (S.roofOp !== target) {
          S.roofOp = clamp(S.roofOp + Math.sign(target - S.roofOp) * dt * 4, 0, 1);
          S.roofMat.opacity = S.roofOp;
        }
        const room = S.cellRoom.get(ck(ci, cj));
        if (room && room.enclosed && room.roofed && Math.abs(P.y - (S.y0 + FLOOR_T)) < 0.5) ((sheltered = true), (cosy = Math.max(cosy, room.cosy || 0)));
        for (const dr of S.doors) {
          const want = Math.hypot(lx - dr.mx, lz - dr.mz) < dr.reach && !(P.dead > 0) ? 1 : 0;
          if (want && dr.open < 0.05) dr.dir = (lx - dr.mx) * dr.nx + (lz - dr.mz) * dr.nz > 0 ? 1 : -1;
          dr.open = clamp(dr.open + (want ? 1 : -1) * dt * 4.5, 0, 1);
          const ease = dr.open * dr.open * (3 - 2 * dr.open);
          if (dr.kind === "gate") dr.mesh.position.y = 0.04 + ease * dr.lift;
          else dr.mesh.rotation.y = dr.base + dr.sign * dr.dir * ease * 1.75;
        }
      }
      const home = sheltered && cosy >= 5;
      if (sheltered && !(P.dead > 0)) {
        P.hp = Math.min(100, P.hp + (home ? 9 : 4) * dt);
        P.stam = Math.min(100, P.stam + (home ? 22 : 12) * dt);
      }
      {
        // the nearest few flames cast real light, brighter after dark
        const sun = Math.sin((W.time - 0.25) * Math.PI * 2),
          dark = clamp(0.35 - sun, 0, 1),
          fl = 0.9 + 0.1 * Math.sin(performance.now() * 0.013);
        lit.sort((p, q) => p[0] - q[0]);
        lamps.forEach((lamp, n) => {
          const q = lit[n];
          if (!q || q[0] > 40) return void (lamp.intensity = 0);
          const [wx, wz] = toWorld(q[1], q[2][0], q[2][2]);
          lamp.position.set(wx, q[1].y0 + q[2][1] + 0.25, wz);
          lamp.intensity = (1.2 + 11 * dark) * q[2][3] * fl;
        });
        // lie still by a bed at night, under your own roof, and the night passes
        const still = Math.hypot(P.x - (B.lastX || 0), P.z - (B.lastZ || 0)) < 0.004;
        B.lastX = P.x;
        B.lastZ = P.z;
        B.idleT = still && !B.on ? B.idleT + dt : 0;
        const asleep = sheltered && bed && sun < -0.08 && B.idleT > 2.5 && !(P.dead > 0);
        if (asleep) {
          W.time += dt * 0.03;
          if (W.time >= 1) W.time -= 1;
        }
        const mood = asleep ? "Sleeping<small>until morning</small>" : home ? "Home sweet home<small>resting well</small>" : sheltered ? (bed && sun < -0.08 ? "Sheltered<small>stand still by the bed to sleep</small>" : "Sheltered<small>resting</small>") : "";
        if (mood !== B.mood) {
          B.mood = mood;
          $("shelter").hidden = !mood;
          if (mood) $("shelter").innerHTML = mood;
        }
      }
      {
        const sun = Math.sin((W.time - 0.25) * Math.PI * 2),
          want = sheltered && !B.on ? 2.5 + 14 * clamp(0.35 - sun, 0, 1) : 0;
        hearth.intensity += (want - hearth.intensity) * Math.min(1, dt * 4);
        hearth.position.set(P.x, P.y + 1.9, P.z);
      }
      B.sheltered = sheltered;
      if (!B.on) return;
      if (B.camT > 0) {
        B.camT -= dt;
        const k = 1 - Math.exp(-9 * dt);
        G.cam.pitch += (1.12 - G.cam.pitch) * k;
        G.cam.dist += (Math.max(B.camSaved.dist, 27) - G.cam.dist) * k;
      }
      const turn = (G.keys.KeyQ ? 1 : 0) - (G.keys.KeyE ? 1 : 0);
      if (turn) G.cam.yaw += turn * 1.9 * dt;
      updateHover();
      updatePreview();
    },
    reset() {
      for (const S of [...B.structs]) disposeStruct(S);
      B.seed = null;
      B.undo.length = B.redo.length = 0;
      B.drag = null;
      B.key = "";
      B.version++;
      $("bundo") && syncButtons();
    },
    state: B,
    Geo,
    texel,
    shade,
    hash,
    col,
    save: saveBuilds,
    // for on-screen buttons
    cancel() {
      if (B.tool === "copy" && B.clipb) ((B.clipb = null), hint());
      B.drag = null;
      B.aim = false;
      B.tapMode = "";
      B.key = "";
    },
    applyOp,
    computeOp,
    setTool,
    toLocal,
    toWorld,
  };
})();
